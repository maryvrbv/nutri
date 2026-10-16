import { all, get, run, tx, type DB } from './db.ts';
import { clock, notificationSettings, notify, nowIso } from './core.ts';
import { latestPublished } from './schemes.ts';
import { addDays, inQuietHours, ruDate, todayIn, zonedParts, zonedToUtc } from './time.ts';

const MAX_LATE_MS = 2 * 3600_000; // после перезапуска не рассылаем напоминания старше двух часов

/**
 * Один проход планировщика: напоминания о приёмах и контрольных датах.
 * Отменённые и заменённые приёмы не участвуют — по ним напоминаний нет.
 */
export function tick(db: DB) {
  const now = clock.now();
  const nowS = new Date(now).toISOString();
  const lateS = new Date(now - MAX_LATE_MS).toISOString();
  const due = all(db, `SELECT p.id, p.client_id, p.due_at, p.time_local, p.snooze_until, i.name, u.timezone
    FROM planned_intakes p JOIN scheme_items i ON i.id = p.item_id JOIN users u ON u.id = p.client_id
    WHERE p.status = 'planned' AND p.id NOT IN (SELECT planned_id FROM intake_marks)
      AND ((p.snooze_until IS NULL AND p.reminded_at IS NULL AND p.due_at <= ? AND p.due_at > ?)
        OR (p.snooze_until IS NOT NULL AND p.snooze_until <= ?))
    ORDER BY p.client_id, p.due_at`, nowS, lateS, nowS);

  const groups = new Map<string, typeof due>();
  for (const r of due) {
    const k = r.client_id;
    groups.set(k, [...(groups.get(k) ?? []), r]);
  }
  let sent = 0;
  for (const [clientId, rows] of groups) {
    const s = notificationSettings(db, clientId);
    const tz = rows[0].timezone;
    const local = zonedParts(now, tz);
    tx(db, () => {
      if (!s.intake_reminders) {
        for (const r of rows) run(db, 'UPDATE planned_intakes SET reminded_at = ?, snooze_until = NULL WHERE id = ?', nowS, r.id);
        return;
      }
      if (inQuietHours(local.time, s.quiet_from, s.quiet_to)) {
        // Переносим на конец тихих часов
        let date = local.date;
        if (local.time >= s.quiet_to) date = addDays(date, 1);
        const until = zonedToUtc(date, s.quiet_to, tz).toISOString();
        for (const r of rows) run(db, 'UPDATE planned_intakes SET snooze_until = ? WHERE id = ?', until, r.id);
        return;
      }
      const names = [...new Set(rows.map((r) => r.name))];
      notify(db, clientId, {
        kind: 'intake_reminder',
        title: `Пора принять: ${names.join(', ')}`,
        public_title: 'Пора отметить приём',
        link: '/today',
      });
      for (const r of rows) run(db, 'UPDATE planned_intakes SET reminded_at = ?, snooze_until = NULL WHERE id = ?', nowS, r.id);
      sent++;
    });
  }

  // Контрольные даты: клиенту — накануне, специалисту — за три дня.
  const versions = all(db, `SELECT s.id AS scheme_id, s.client_id, s.specialist_id, u.timezone, u.name AS client_name
    FROM schemes s JOIN users u ON u.id = s.client_id WHERE s.cancelled_at IS NULL`);
  for (const v of versions) {
    const pub = latestPublished(db, v.scheme_id);
    if (!pub?.control_date) continue;
    const today = todayIn(v.timezone, now);
    if (addDays(today, 1) === pub.control_date || today === pub.control_date) {
      notify(db, v.client_id, { kind: 'control_date', title: `${ruDate(pub.control_date)} — контрольная дата: специалист просил пересдать анализы`, public_title: 'Напоминание от специалиста', link: '/labs', dedupe_key: `ctl:c:${v.scheme_id}:${pub.control_date}` });
    }
    const link = get(db, 'SELECT 1 FROM care_links WHERE client_id = ? AND specialist_id = ? AND revoked_at IS NULL', v.client_id, v.specialist_id);
    if (link && addDays(today, 3) >= pub.control_date && today <= pub.control_date) {
      notify(db, v.specialist_id, { kind: 'control_date', title: `${v.client_name}: контрольная дата ${ruDate(pub.control_date)}`, public_title: 'Приближается контрольная дата', link: `/clients/${v.client_id}`, dedupe_key: `ctl:s:${v.scheme_id}:${pub.control_date}` });
    }
  }
  return { sent, checked: due.length, at: nowIso() };
}

export function startScheduler(db: DB, everyMs = 60_000) {
  const t = setInterval(() => {
    try { tick(db); } catch (e) { console.error('scheduler tick failed', (e as Error).name); }
  }, everyMs);
  t.unref();
  return () => clearInterval(t);
}
