import { all, get, run, tx, type DB } from './db.ts';
import { HttpError, audit, bad, clock, id, notFound, nowIso, type User } from './core.ts';
import { adherenceStats, intakeStatus } from './adherence.ts';
import { todayIn } from './time.ts';

export const SKIP_REASONS = ['forgot', 'ran_out', 'felt_unwell', 'other'] as const;

const BASE = `
  SELECT p.id, p.scheme_id, p.version_id, p.item_id, p.group_key, p.date, p.slot, p.time_local, p.due_at, p.status,
         p.snooze_until, p.status_at,
         i.name, i.product, i.form, i.amount, i.amount_unit, i.substance_amount, i.substance_unit, i.food, i.instruction,
         v.number AS version_number, v.title AS scheme_title,
         m.status AS mark_status, m.taken_at, m.reason, m.recorded_at
  FROM planned_intakes p
  JOIN scheme_items i ON i.id = p.item_id
  JOIN scheme_versions v ON v.id = p.version_id
  LEFT JOIN intake_marks m ON m.planned_id = p.id`;

function decorate(rows: any[]) {
  const now = new Date(clock.now()).toISOString();
  return rows.map((r) => ({ ...r, state: intakeStatus(r, now) }));
}

export function intakesForDay(db: DB, clientId: string, date: string) {
  return decorate(all(db, `${BASE} WHERE p.client_id = ? AND p.date = ? AND p.status != 'superseded' ORDER BY p.time_local, i.position`, clientId, date));
}

export function intakeHistory(db: DB, clientId: string, from: string, to: string, name?: string) {
  const rows = all(db, `${BASE} WHERE p.client_id = ? AND p.date BETWEEN ? AND ? AND p.status != 'superseded'
    ${name ? 'AND lower(i.name) = lower(?)' : ''} ORDER BY p.date DESC, p.time_local`, clientId, from, to, ...(name ? [name] : []));
  return decorate(rows);
}

export function stats(db: DB, clientId: string, from: string, to: string) {
  const rows = intakeHistory(db, clientId, from, to);
  return adherenceStats(rows.map((r) => r.state));
}

export function supplementNames(db: DB, clientId: string) {
  return all<{ name: string }>(db, `SELECT DISTINCT i.name FROM planned_intakes p JOIN scheme_items i ON i.id = p.item_id
    WHERE p.client_id = ? ORDER BY i.name`, clientId).map((r) => r.name);
}

type MarkInput = { planned_ids: string[]; status: 'taken' | 'skipped' | null; taken_at?: string; reason?: string; request_id: string };

/**
 * Отметка приёма. Каждая позиция — отдельная запись. Повтор того же запроса
 * (двойное нажатие, повтор после обрыва связи) ничего не меняет: request_id уникален.
 * status = null снимает отметку (исправление ошибки); всё сохраняется в истории.
 */
export function mark(db: DB, actor: User, clientId: string, input: MarkInput) {
  if (actor.id !== clientId) throw new HttpError(403, 'forbidden', 'Отмечать приём может только сам клиент');
  if (!Array.isArray(input.planned_ids) || input.planned_ids.length === 0 || input.planned_ids.length > 50) throw bad('Выберите приёмы');
  if (!input.request_id || typeof input.request_id !== 'string' || input.request_id.length > 100) throw bad('Нет идентификатора запроса');
  if (input.status !== null && input.status !== 'taken' && input.status !== 'skipped') throw bad('Неверный статус');
  if (input.reason && !SKIP_REASONS.includes(input.reason as any)) throw bad('Неверная причина');
  const now = nowIso();
  let takenAt: string | null = null;
  if (input.status === 'taken') {
    takenAt = input.taken_at ? new Date(input.taken_at).toISOString() : now;
    if (Number.isNaN(Date.parse(takenAt))) throw bad('Неверное время приёма');
    if (takenAt > new Date(clock.now() + 5 * 60_000).toISOString()) throw bad('Время приёма не может быть в будущем');
  }
  const tz = get<{ timezone: string }>(db, 'SELECT timezone FROM users WHERE id = ?', clientId)!.timezone;
  const today = todayIn(tz, clock.now());

  return tx(db, () => {
    const results: { planned_id: string; state: string; duplicate: boolean }[] = [];
    for (const pid of input.planned_ids) {
      const reqKey = `${input.request_id}:${pid}`;
      const p = get(db, 'SELECT * FROM planned_intakes WHERE id = ? AND client_id = ?', pid, clientId);
      if (!p) throw notFound();
      if (get(db, 'SELECT 1 FROM mark_history WHERE request_id = ?', reqKey)) {
        const cur = get(db, 'SELECT status FROM intake_marks WHERE planned_id = ?', pid);
        results.push({ planned_id: pid, state: cur?.status ?? 'none', duplicate: true });
        continue;
      }
      if (p.status === 'superseded') throw new HttpError(409, 'superseded', 'Этот приём заменён новой версией схемы');
      if (p.status === 'cancelled' && input.status !== null) throw new HttpError(409, 'cancelled', 'Специалист отменил этот приём');
      if (p.date > today) throw bad('Нельзя отметить приём в будущем дне');
      const cur = get(db, 'SELECT * FROM intake_marks WHERE planned_id = ?', pid);
      run(db, 'INSERT INTO mark_history (id, planned_id, request_id, status, taken_at, reason, recorded_at, recorded_by) VALUES (?,?,?,?,?,?,?,?)',
        id(), pid, reqKey, input.status, takenAt, input.status === 'skipped' ? input.reason ?? null : null, now, actor.id);
      if (input.status === null) {
        run(db, 'DELETE FROM intake_marks WHERE planned_id = ?', pid);
      } else if (cur) {
        run(db, 'UPDATE intake_marks SET status = ?, taken_at = ?, reason = ?, recorded_at = ?, recorded_by = ? WHERE planned_id = ?',
          input.status, takenAt, input.status === 'skipped' ? input.reason ?? null : null, now, actor.id, pid);
      } else {
        run(db, 'INSERT INTO intake_marks (planned_id, client_id, status, taken_at, reason, recorded_at, recorded_by) VALUES (?,?,?,?,?,?,?)',
          pid, clientId, input.status, takenAt, input.status === 'skipped' ? input.reason ?? null : null, now, actor.id);
      }
      run(db, 'UPDATE planned_intakes SET snooze_until = NULL WHERE id = ?', pid);
      audit(db, {
        actor: actor.id, client: clientId, entity: 'intake', entity_id: pid,
        action: input.status === null ? 'mark_removed' : cur ? 'mark_changed' : 'marked',
        data: { status: input.status, before: cur?.status ?? null, date: p.date, slot: p.slot, late: p.date < today },
      });
      results.push({ planned_id: pid, state: input.status ?? 'none', duplicate: false });
    }
    return results;
  });
}

export function markHistory(db: DB, clientId: string, plannedId: string) {
  const p = get(db, 'SELECT id FROM planned_intakes WHERE id = ? AND client_id = ?', plannedId, clientId);
  if (!p) throw notFound();
  return all(db, `SELECT h.status, h.taken_at, h.reason, h.recorded_at, u.name AS recorded_by_name
    FROM mark_history h LEFT JOIN users u ON u.id = h.recorded_by WHERE h.planned_id = ? ORDER BY h.recorded_at`, plannedId);
}

export function snooze(db: DB, actor: User, plannedIds: string[], minutes: number) {
  if (!Number.isInteger(minutes) || minutes < 5 || minutes > 240) throw bad('Неверный интервал');
  const until = new Date(clock.now() + minutes * 60_000).toISOString();
  tx(db, () => {
    for (const pid of plannedIds) {
      const p = get(db, `SELECT id FROM planned_intakes WHERE id = ? AND client_id = ? AND status = 'planned'`, pid, actor.id);
      if (!p) throw notFound();
      run(db, 'UPDATE planned_intakes SET snooze_until = ? WHERE id = ?', until, pid);
    }
  });
  return until;
}
