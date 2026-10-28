import { all, get, run, tx, type DB, type Row } from './db.ts';
import { HttpError, activeLink, audit, bad, id, notFound, notify, nowIso, clock, type User } from './core.ts';
import { diffVersions, slotsFor, validateVersion, type ItemInput, type VersionInput } from './schedule.ts';
import { addDays, ruDate, todayIn, zonedToUtc } from './time.ts';

export type SchemeStatus = 'draft' | 'scheduled' | 'active' | 'completed' | 'cancelled';

export function itemFromRow(r: Row): ItemInput & { id: string } {
  return {
    id: r.id, group_key: r.group_key, name: r.name, product: r.product, form: r.form,
    amount: r.amount, amount_unit: r.amount_unit, substance_amount: r.substance_amount, substance_unit: r.substance_unit,
    doses: JSON.parse(r.doses), frequency: JSON.parse(r.frequency), food: r.food,
    start_date: r.start_date, end_date: r.end_date, instruction: r.instruction,
  };
}

export function versionItems(db: DB, versionId: string) {
  return all(db, 'SELECT * FROM scheme_items WHERE version_id = ? ORDER BY position', versionId).map(itemFromRow);
}

function insertItems(db: DB, versionId: string, items: ItemInput[]) {
  items.forEach((it, i) => {
    run(db, `INSERT INTO scheme_items (id, version_id, group_key, position, name, product, form, amount, amount_unit,
      substance_amount, substance_unit, doses, frequency, food, start_date, end_date, instruction)
      VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
      id(), versionId, it.group_key || id(), i, it.name, it.product ?? '', it.form, it.amount, it.amount_unit,
      it.substance_amount ?? null, it.substance_unit ?? null, JSON.stringify(it.doses), JSON.stringify(it.frequency),
      it.food, it.start_date, it.end_date, it.instruction ?? '');
  });
}

export function latestPublished(db: DB, schemeId: string) {
  return get(db, 'SELECT * FROM scheme_versions WHERE scheme_id = ? AND published_at IS NOT NULL ORDER BY number DESC LIMIT 1', schemeId);
}
export function draftVersion(db: DB, schemeId: string) {
  return get(db, 'SELECT * FROM scheme_versions WHERE scheme_id = ? AND published_at IS NULL ORDER BY number DESC LIMIT 1', schemeId);
}

export function schemeStatus(scheme: Row, published: Row | undefined, today: string): SchemeStatus {
  if (scheme.cancelled_at) return 'cancelled';
  if (!published) return 'draft';
  if (published.start_date > today) return 'scheduled';
  if (published.end_date < today) return 'completed';
  return 'active';
}

function tzOf(db: DB, clientId: string) {
  return get<{ timezone: string }>(db, 'SELECT timezone FROM users WHERE id = ?', clientId)!.timezone;
}

export function createDraft(db: DB, actor: User, clientId: string, input: unknown, owner: { specialistId?: string; prescribedBy?: string | null } = {}) {
  const v = validateVersion(input);
  return tx(db, () => {
    const schemeId = id();
    run(db, 'INSERT INTO schemes (id, client_id, specialist_id, created_at, prescribed_by, added_by) VALUES (?,?,?,?,?,?)',
      schemeId, clientId, owner.specialistId ?? actor.id, nowIso(), owner.prescribedBy ?? null, actor.id);
    const vid = id();
    run(db, `INSERT INTO scheme_versions (id, scheme_id, number, title, comment, start_date, end_date, control_date, created_at)
      VALUES (?,?,?,?,?,?,?,?,?)`, vid, schemeId, 1, v.title, v.comment ?? '', v.start_date, v.end_date, v.control_date ?? null, nowIso());
    insertItems(db, vid, v.items);
    audit(db, { actor: actor.id, client: clientId, entity: 'scheme', entity_id: schemeId, action: 'draft_created', data: { title: v.title } });
    return { scheme_id: schemeId, version_id: vid };
  });
}

export function updateDraft(db: DB, actor: User, schemeId: string, input: unknown) {
  const scheme = get(db, 'SELECT * FROM schemes WHERE id = ?', schemeId);
  if (!scheme) throw notFound();
  if (scheme.cancelled_at) throw bad('Курс отменён');
  const draft = draftVersion(db, schemeId);
  if (!draft) throw bad('Нет черновика. Создайте новую версию.');
  const v = validateVersion(input);
  tx(db, () => {
    run(db, 'UPDATE scheme_versions SET title=?, comment=?, start_date=?, end_date=?, control_date=? WHERE id=?',
      v.title, v.comment ?? '', v.start_date, v.end_date, v.control_date ?? null, draft.id);
    run(db, 'DELETE FROM scheme_items WHERE version_id = ?', draft.id);
    insertItems(db, draft.id, v.items);
    audit(db, { actor: actor.id, client: scheme.client_id, entity: 'scheme', entity_id: schemeId, action: 'draft_updated' });
  });
  return draft.id as string;
}

/** Черновик новой версии на основе опубликованной. Ключи позиций сохраняются для сравнения. */
export function startNewVersion(db: DB, actor: User, schemeId: string) {
  const scheme = get(db, 'SELECT * FROM schemes WHERE id = ?', schemeId);
  if (!scheme) throw notFound();
  if (scheme.cancelled_at) throw bad('Курс отменён');
  const existing = draftVersion(db, schemeId);
  if (existing) return existing.id as string;
  const pub = latestPublished(db, schemeId);
  if (!pub) throw bad('Схема ещё не опубликована');
  return tx(db, () => {
    const vid = id();
    run(db, `INSERT INTO scheme_versions (id, scheme_id, number, title, comment, start_date, end_date, control_date, created_at)
      VALUES (?,?,?,?,?,?,?,?,?)`, vid, schemeId, pub.number + 1, pub.title, pub.comment, pub.start_date, pub.end_date, pub.control_date, nowIso());
    insertItems(db, vid, versionItems(db, pub.id));
    audit(db, { actor: actor.id, client: scheme.client_id, entity: 'scheme', entity_id: schemeId, action: 'version_draft_created', data: { number: pub.number + 1 } });
    return vid;
  });
}

export function discardDraft(db: DB, actor: User, schemeId: string) {
  const scheme = get(db, 'SELECT * FROM schemes WHERE id = ?', schemeId);
  if (!scheme) throw notFound();
  const draft = draftVersion(db, schemeId);
  if (!draft) throw bad('Нет черновика');
  tx(db, () => {
    if (draft.number === 1) run(db, 'DELETE FROM schemes WHERE id = ?', schemeId);
    else run(db, 'DELETE FROM scheme_versions WHERE id = ?', draft.id);
    audit(db, { actor: actor.id, client: scheme.client_id, entity: 'scheme', entity_id: schemeId, action: 'draft_discarded' });
  });
}

/** Предпросмотр: расписание в том виде, как его увидит клиент, на ближайшие дни. */
export function previewSchedule(input: VersionInput, from: string, days = 7) {
  const to = addDays(from, days - 1);
  const byDate = new Map<string, { time: string; slot: string; items: { name: string; amount: number; amount_unit: string; food: string; instruction?: string }[] }[]>();
  for (const it of input.items) {
    for (const s of slotsFor(it, from, to)) {
      const day = byDate.get(s.date) ?? [];
      let g = day.find((x) => x.slot === s.slot);
      if (!g) { g = { time: s.time_local, slot: s.slot, items: [] }; day.push(g); }
      g.items.push({ name: it.name, amount: it.amount, amount_unit: it.amount_unit, food: it.food, instruction: it.instruction });
      byDate.set(s.date, day);
    }
  }
  return [...byDate.entries()].sort().map(([date, groups]) => ({ date, groups: groups.sort((a, b) => a.time.localeCompare(b.time)) }));
}

function generateIntakes(db: DB, clientId: string, schemeId: string, versionId: string, from: string, tz: string) {
  const marked = new Set(all(db, `SELECT p.group_key, p.date, p.slot FROM planned_intakes p JOIN intake_marks m ON m.planned_id = p.id
    WHERE p.scheme_id = ? AND p.date >= ?`, schemeId, from).map((r) => `${r.group_key}|${r.date}|${r.slot}`));
  const items = all(db, 'SELECT * FROM scheme_items WHERE version_id = ? ORDER BY position', versionId);
  const ins = db.prepare(`INSERT INTO planned_intakes (id, client_id, scheme_id, version_id, item_id, group_key, date, slot, time_local, due_at, status)
    VALUES (?,?,?,?,?,?,?,?,?,?, 'planned')`);
  let n = 0;
  for (const r of items) {
    const it = itemFromRow(r);
    for (const s of slotsFor(it, from, it.end_date)) {
      if (marked.has(`${r.group_key}|${s.date}|${s.slot}`)) continue;
      ins.run(id(), clientId, schemeId, versionId, r.id, r.group_key, s.date, s.slot, s.time_local, zonedToUtc(s.date, s.time_local, tz).toISOString());
      n++;
    }
  }
  return n;
}

/**
 * Публикация версии. Для первой версии создаются запланированные приёмы.
 * Для следующих — будущие неотмеченные приёмы прошлой версии заменяются начиная с даты вступления в силу,
 * а уже отмеченные остаются привязаны к той дозировке и инструкции, что действовали на момент приёма.
 */
export function publish(db: DB, actor: User, schemeId: string, opts: { effective_from?: string; silent?: boolean } = {}) {
  const scheme = get(db, 'SELECT * FROM schemes WHERE id = ?', schemeId);
  if (!scheme) throw notFound();
  if (scheme.cancelled_at) throw bad('Курс отменён');
  const draft = draftVersion(db, schemeId);
  if (!draft) throw bad('Нет черновика для публикации');
  const tz = tzOf(db, scheme.client_id);
  const today = todayIn(tz, clock.now());
  const items = versionItems(db, draft.id);
  validateVersion({ ...draft, items });
  const prev = latestPublished(db, schemeId);
  let effective: string;
  if (!prev) {
    effective = draft.start_date;
  } else {
    effective = opts.effective_from || today;
    if (effective < today) throw bad('Изменения не могут вступить в силу в прошлом', { field: 'effective_from' });
    if (effective > draft.end_date) throw bad('Дата вступления в силу позже окончания курса', { field: 'effective_from' });
  }
  const genFrom = effective > today ? effective : today;
  return tx(db, () => {
    let changes = null;
    if (prev) {
      changes = diffVersions(versionItems(db, prev.id), items);
      run(db, `UPDATE planned_intakes SET status = 'superseded', status_at = ?
        WHERE scheme_id = ? AND status = 'planned' AND date >= ? AND id NOT IN (SELECT planned_id FROM intake_marks)`, nowIso(), schemeId, genFrom);
    }
    run(db, 'UPDATE scheme_versions SET published_at = ?, published_by = ?, effective_from = ?, changes = ? WHERE id = ?',
      nowIso(), actor.id, effective, changes ? JSON.stringify(changes) : null, draft.id);
    const n = generateIntakes(db, scheme.client_id, schemeId, draft.id, genFrom, tz);
    audit(db, { actor: actor.id, client: scheme.client_id, entity: 'scheme', entity_id: schemeId, action: prev ? 'version_published' : 'published', data: { number: draft.number, effective_from: effective, intakes: n, title: draft.title } });
    if (!opts.silent) notify(db, scheme.client_id, prev
      ? { kind: 'scheme_updated', title: `Специалист обновил схему «${draft.title}»`, body: `Изменения действуют с ${ruDate(effective)}`, public_title: 'Обновление в схеме', link: `/scheme/${schemeId}` }
      : { kind: 'scheme_new', title: `Новая схема приёма: «${draft.title}»`, body: `Начало — ${ruDate(draft.start_date)}`, public_title: 'Новая схема приёма', link: `/scheme/${schemeId}` });
    return { version_id: draft.id as string, effective_from: effective, intakes: n, changes };
  });
}

/**
 * Перенос прошлых и текущих схем из таблицы или другого сервиса: каждая схема создаётся и сразу публикуется.
 * Приёмы генерируются только с сегодняшнего дня, поэтому прошлые схемы не дают «пропусков» в статистике.
 */
export function importSchemes(db: DB, actor: User, clientId: string, input: unknown) {
  // Клиент переносит сам: указывает своего специалиста или другого (по имени, можно без имени)
  let owner: { specialistId?: string; prescribedBy?: string | null } = {};
  if (actor.role === 'client') {
    const by = (input as any)?.prescribed_by;
    if (by === 'mine') {
      const link = activeLink(db, clientId);
      if (!link) throw bad('Специалист не подключён — выберите «Другой специалист»');
      owner = { specialistId: link.specialist_id };
    } else {
      owner = { specialistId: clientId, prescribedBy: String((input as any)?.specialist_name ?? '').trim().slice(0, 120) };
    }
  }
  const list = Array.isArray((input as any)?.schemes) ? (input as any).schemes : [];
  if (!list.length || list.length > 50) throw bad('В файле нет схем');
  list.forEach((v: any, i: number) => {
    try { validateVersion(v); } catch (e: any) { throw bad(`Схема ${i + 1} «${v?.title ?? ''}»: ${e.message}`, { fields: e.fields }); }
  });
  const today = todayIn(tzOf(db, clientId), clock.now());
  return tx(db, () => list.map((v: any) => {
    const { scheme_id } = createDraft(db, actor, clientId, v, owner);
    publish(db, actor, scheme_id, { silent: actor.role === 'client' || v.end_date < today });
    return scheme_id;
  }));
}

/** Отмена курса: будущие приёмы и напоминания отменяются, история сохраняется. */
export function cancelScheme(db: DB, actor: User, schemeId: string, reason: string) {
  const scheme = get(db, 'SELECT * FROM schemes WHERE id = ?', schemeId);
  if (!scheme) throw notFound();
  if (scheme.cancelled_at) throw new HttpError(409, 'already_cancelled', 'Курс уже отменён');
  const pub = latestPublished(db, schemeId);
  if (!pub) throw bad('Черновик можно просто удалить');
  return tx(db, () => {
    const now = nowIso();
    const r = run(db, `UPDATE planned_intakes SET status = 'cancelled', status_at = ?
      WHERE scheme_id = ? AND status = 'planned' AND due_at > ? AND id NOT IN (SELECT planned_id FROM intake_marks)`, now, schemeId, now);
    run(db, 'DELETE FROM scheme_versions WHERE scheme_id = ? AND published_at IS NULL', schemeId);
    run(db, 'UPDATE schemes SET cancelled_at = ?, cancel_reason = ? WHERE id = ?', now, reason || null, schemeId);
    audit(db, { actor: actor.id, client: scheme.client_id, entity: 'scheme', entity_id: schemeId, action: 'cancelled', data: { reason, cancelled_intakes: Number(r.changes) } });
    notify(db, scheme.client_id, { kind: 'scheme_cancelled', title: `Специалист завершил курс «${pub.title}»`, body: reason || '', public_title: 'Обновление в схеме', link: `/scheme/${schemeId}` });
    return { cancelled_intakes: Number(r.changes) };
  });
}

/** При смене часового пояса клиента локальное время приёмов сохраняется, момент напоминания пересчитывается. */
export function rescheduleForTimezone(db: DB, clientId: string, tz: string) {
  const now = nowIso();
  const rows = all(db, `SELECT id, date, time_local FROM planned_intakes WHERE client_id = ? AND status = 'planned' AND due_at > ?
    AND id NOT IN (SELECT planned_id FROM intake_marks)`, clientId, now);
  const upd = db.prepare('UPDATE planned_intakes SET due_at = ? WHERE id = ?');
  for (const r of rows) upd.run(zonedToUtc(r.date, r.time_local, tz).toISOString(), r.id);
}

export function schemeView(db: DB, schemeId: string, opts: { includeDraft: boolean }) {
  const scheme = get(db, 'SELECT * FROM schemes WHERE id = ?', schemeId);
  if (!scheme) throw notFound();
  const tz = tzOf(db, scheme.client_id);
  const today = todayIn(tz, clock.now());
  const versions = all(db, `SELECT v.*, u.name AS published_by_name FROM scheme_versions v LEFT JOIN users u ON u.id = v.published_by
    WHERE v.scheme_id = ? ${opts.includeDraft ? '' : 'AND v.published_at IS NOT NULL'} ORDER BY v.number`, schemeId)
    .map((v): Row => ({ ...v, changes: v.changes ? JSON.parse(v.changes) : null, items: versionItems(db, v.id) }));
  const published = latestPublished(db, schemeId);
  const specialist = get(db, 'SELECT name FROM users WHERE id = ?', scheme.specialist_id);
  const other = scheme.specialist_id === scheme.client_id;
  return {
    id: scheme.id,
    client_id: scheme.client_id,
    specialist_name: other ? (scheme.prescribed_by || 'Другой специалист') : specialist?.name ?? 'Специалист',
    added_by_client: scheme.added_by === scheme.client_id,
    status: schemeStatus(scheme, published, today),
    created_at: scheme.created_at,
    cancelled_at: scheme.cancelled_at,
    cancel_reason: scheme.cancel_reason,
    current: versions.filter((v) => v.published_at).at(-1) ?? null,
    draft: opts.includeDraft ? versions.find((v) => !v.published_at) ?? null : null,
    versions,
    today,
  };
}

export function listSchemes(db: DB, clientId: string, opts: { includeDrafts: boolean }) {
  const rows = all(db, 'SELECT id FROM schemes WHERE client_id = ? ORDER BY created_at DESC', clientId);
  return rows
    .map((r) => schemeView(db, r.id, { includeDraft: opts.includeDrafts }))
    .filter((s) => opts.includeDrafts || s.status !== 'draft');
}
