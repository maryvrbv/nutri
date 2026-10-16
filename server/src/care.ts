import { all, get, run, tx, type DB } from './db.ts';
import { HttpError, activeLink, audit, bad, clock, id, lastActivity, notFound, notify, nowIso, sha256, token, type User } from './core.ts';
import { latestPublished, schemeStatus } from './schemes.ts';
import { latestResults } from './labs.ts';
import { stats } from './intakes.ts';
import { addDays, todayIn } from './time.ts';

export const SCOPES = [
  { key: 'labs', label: 'Анализы и загруженные документы' },
  { key: 'schemes', label: 'Схемы приёма и самостоятельно принимаемые добавки' },
  { key: 'intakes', label: 'Отметки о приёме и пропусках' },
  { key: 'wellbeing', label: 'Записи о самочувствии' },
];

const INVITE_DAYS = 7;

export function createInvitation(db: DB, actor: User, hint: string) {
  const t = token();
  const inv = { id: id(), expires_at: new Date(clock.now() + INVITE_DAYS * 86400_000).toISOString() };
  run(db, 'INSERT INTO invitations (id, specialist_id, token_hash, client_hint, created_at, expires_at) VALUES (?,?,?,?,?,?)',
    inv.id, actor.id, sha256(t), String(hint ?? '').trim().slice(0, 100), nowIso(), inv.expires_at);
  return { ...inv, token: t };
}

export function listInvitations(db: DB, actor: User) {
  return all(db, `SELECT i.id, i.client_hint, i.created_at, i.expires_at, i.accepted_at, i.revoked_at, u.name AS accepted_by_name
    FROM invitations i LEFT JOIN users u ON u.id = i.accepted_by WHERE i.specialist_id = ? ORDER BY i.created_at DESC LIMIT 50`, actor.id);
}

export function revokeInvitation(db: DB, actor: User, invId: string) {
  const r = run(db, 'UPDATE invitations SET revoked_at = ? WHERE id = ? AND specialist_id = ? AND accepted_at IS NULL AND revoked_at IS NULL', nowIso(), invId, actor.id);
  if (!r.changes) throw notFound();
}

function invitationState(inv: any) {
  if (!inv) return 'not_found';
  if (inv.revoked_at) return 'revoked';
  if (inv.accepted_at) return 'used';
  if (inv.expires_at < nowIso()) return 'expired';
  return 'valid';
}

/** Публичный предпросмотр приглашения: кто приглашает и к чему откроется доступ. Сам по себе доступа не даёт. */
export function previewInvitation(db: DB, t: string) {
  const inv = get(db, `SELECT i.*, u.name AS specialist_name, p.title AS specialist_title FROM invitations i
    JOIN users u ON u.id = i.specialist_id LEFT JOIN specialist_profiles p ON p.user_id = i.specialist_id WHERE i.token_hash = ?`, sha256(String(t)));
  const state = invitationState(inv);
  if (!inv || state === 'not_found') throw notFound();
  return { state, specialist_name: inv.specialist_name, specialist_title: inv.specialist_title ?? '', expires_at: inv.expires_at, scopes: SCOPES };
}

export function acceptInvitation(db: DB, actor: User, t: string, replace: boolean) {
  if (actor.role !== 'client') throw new HttpError(403, 'forbidden', 'Приглашение предназначено для клиента. Войдите в аккаунт клиента.');
  const inv = get(db, 'SELECT * FROM invitations WHERE token_hash = ?', sha256(String(t)));
  const state = invitationState(inv);
  if (!inv) throw notFound();
  if (state !== 'valid') throw new HttpError(410, state, state === 'expired' ? 'Срок действия приглашения истёк. Попросите специалиста прислать новое.' : 'Приглашение уже использовано или отозвано');
  const current = activeLink(db, actor.id);
  if (current?.specialist_id === inv.specialist_id) throw new HttpError(409, 'already_connected', 'Вы уже подключены к этому специалисту');
  if (current && !replace) {
    const name = get(db, 'SELECT name FROM users WHERE id = ?', current.specialist_id)?.name;
    throw new HttpError(409, 'has_specialist', `Сейчас вас сопровождает ${name}. Новое подключение закроет ему доступ.`, { current_specialist: name });
  }
  return tx(db, () => {
    const now = nowIso();
    if (current) {
      run(db, 'UPDATE care_links SET revoked_at = ?, revoked_by = ? WHERE id = ?', now, actor.id, current.id);
      audit(db, { actor: actor.id, client: actor.id, entity: 'access', entity_id: current.id, action: 'revoked', data: { reason: 'replaced' } });
    }
    const linkId = id();
    run(db, 'INSERT INTO care_links (id, client_id, specialist_id, invitation_id, scopes, consented_at) VALUES (?,?,?,?,?,?)',
      linkId, actor.id, inv.specialist_id, inv.id, JSON.stringify(SCOPES.map((s) => s.key)), now);
    run(db, 'UPDATE invitations SET accepted_at = ?, accepted_by = ? WHERE id = ?', now, actor.id, inv.id);
    audit(db, { actor: actor.id, client: actor.id, entity: 'access', entity_id: linkId, action: 'granted', data: { specialist_id: inv.specialist_id } });
    notify(db, inv.specialist_id, { kind: 'client_connected', title: `${actor.name} подключился(-ась) к сопровождению`, public_title: 'Новый клиент', link: `/clients/${actor.id}` });
    return linkId;
  });
}

export function revokeAccess(db: DB, actor: User) {
  const link = activeLink(db, actor.id);
  if (!link) throw notFound();
  tx(db, () => {
    run(db, 'UPDATE care_links SET revoked_at = ?, revoked_by = ? WHERE id = ?', nowIso(), actor.id, link.id);
    audit(db, { actor: actor.id, client: actor.id, entity: 'access', entity_id: link.id, action: 'revoked' });
    notify(db, link.specialist_id, { kind: 'client_revoked', title: `${actor.name} закрыл(-а) доступ к своим данным`, public_title: 'Изменение доступа клиента' });
  });
}

export function accessInfo(db: DB, actor: User) {
  const link = activeLink(db, actor.id);
  const history = all(db, `SELECT l.consented_at, l.revoked_at, u.name AS specialist_name FROM care_links l
    LEFT JOIN users u ON u.id = l.specialist_id WHERE l.client_id = ? ORDER BY l.consented_at DESC`, actor.id);
  if (!link) return { active: null, history };
  const sp = get(db, 'SELECT u.name, p.title FROM users u LEFT JOIN specialist_profiles p ON p.user_id = u.id WHERE u.id = ?', link.specialist_id);
  const keys: string[] = JSON.parse(link.scopes);
  return { active: { specialist_name: sp?.name, specialist_title: sp?.title ?? '', consented_at: link.consented_at, scopes: SCOPES.filter((s) => keys.includes(s.key)) }, history };
}

// ---------- Кабинет специалиста ----------

function clientRow(db: DB, specialistId: string, c: any) {
  const today = todayIn(c.timezone, clock.now());
  const view = get(db, 'SELECT last_viewed_at FROM specialist_views WHERE specialist_id = ? AND client_id = ?', specialistId, c.id);
  const since = view?.last_viewed_at ?? c.consented_at;
  const schemes = all(db, 'SELECT * FROM schemes WHERE client_id = ?', c.id).map((s) => {
    const pub = latestPublished(db, s.id);
    return { s, pub, status: schemeStatus(s, pub, today) };
  });
  const active = schemes.filter((x) => x.status === 'active');
  const controlDates = schemes.filter((x) => x.pub?.control_date && x.status !== 'cancelled' && x.pub.control_date >= today).map((x) => x.pub!.control_date as string).sort();
  const endingSoon = active.some((x) => x.pub!.end_date <= addDays(today, 7));
  const newLabs = get<{ n: number }>(db, `SELECT COUNT(*) AS n FROM documents WHERE owner_id = ? AND (uploaded_at > ? OR confirmed_at > ?)`, c.id, since, since)!.n;
  const adverse = get<{ n: number }>(db, 'SELECT COUNT(*) AS n FROM wellbeing WHERE client_id = ? AND adverse = 1 AND updated_at > ?', c.id, since)!.n;
  const adverseRecent = get<{ n: number }>(db, 'SELECT COUNT(*) AS n FROM wellbeing WHERE client_id = ? AND adverse = 1 AND date >= ?', c.id, addDays(today, -14))!.n;
  return {
    id: c.id, name: c.name, connected_at: c.consented_at,
    active_scheme: active.length > 0, active_titles: active.map((x) => x.pub!.title),
    last_activity: lastActivity(db, c.id),
    new_labs: newLabs, adverse_new: adverse, adverse_recent: adverseRecent,
    next_control_date: controlDates[0] ?? null, ending_soon: endingSoon,
    last_viewed_at: view?.last_viewed_at ?? null,
  };
}

export function listClients(db: DB, actor: User, filter?: string, q?: string) {
  const rows = all(db, `SELECT u.id, u.name, u.timezone, l.consented_at FROM care_links l JOIN users u ON u.id = l.client_id
    WHERE l.specialist_id = ? AND l.revoked_at IS NULL ORDER BY u.name`, actor.id);
  let list = rows.map((c) => clientRow(db, actor.id, c));
  if (q) list = list.filter((c) => c.name.toLowerCase().includes(q.toLowerCase()));
  const weekAgo = new Date(clock.now() - 7 * 86400_000).toISOString();
  if (filter === 'active') list = list.filter((c) => c.active_scheme);
  if (filter === 'new_labs') list = list.filter((c) => c.new_labs > 0);
  if (filter === 'ending') list = list.filter((c) => c.ending_soon);
  if (filter === 'inactive') list = list.filter((c) => !c.last_activity || c.last_activity < weekAgo);
  return list;
}

const EVENT_TEXT: Record<string, string> = {
  'document:uploaded': 'Загружен документ анализа',
  'document:recognized': 'Документ распознан',
  'document:confirmed': 'Подтверждены результаты анализа',
  'document:reopened': 'Документ открыт на проверку',
  'document:deleted': 'Документ удалён',
  'document:deleted_not_owner': 'Удалён документ другого человека',
  'document:ownership_confirmed': 'Подтверждена принадлежность документа',
  'result:edited': 'Исправлено значение показателя',
  'result:added_manually': 'Показатель внесён вручную',
  'result:deleted': 'Показатель удалён из документа',
  'scheme:published': 'Опубликована схема',
  'scheme:version_published': 'Опубликована новая версия схемы',
  'scheme:cancelled': 'Курс отменён',
  'scheme:draft_created': 'Создан черновик схемы',
  'intake:marked': 'Отмечен приём',
  'intake:mark_changed': 'Исправлена отметка о приёме',
  'intake:mark_removed': 'Снята отметка о приёме',
  'wellbeing:saved': 'Запись о самочувствии',
  'comment:conclusion': 'Опубликовано заключение',
  'comment:question': 'Вопрос клиента',
  'access:granted': 'Доступ открыт',
  'access:revoked': 'Доступ закрыт',
  'self_supplement:added': 'Добавлена самостоятельная добавка',
  'self_supplement:deleted': 'Удалена самостоятельная добавка',
};

export function events(db: DB, actor: User, clientId: string, opts: { since?: string; limit?: number } = {}) {
  const rows = all(db, `SELECT a.at, a.entity, a.action, a.data, a.actor_id, u.name AS actor_name FROM audit_log a
    LEFT JOIN users u ON u.id = a.actor_id WHERE a.client_id = ? ${opts.since ? 'AND a.at > ?' : ''}
    AND a.entity != 'comment_internal' ORDER BY a.at DESC LIMIT ?`, clientId, ...(opts.since ? [opts.since] : []), opts.limit ?? 200);
  return rows
    .filter((r) => !(r.entity === 'scheme' && r.action.startsWith('draft') && actor.role === 'client'))
    .map((r) => {
      const data = JSON.parse(r.data);
      return { at: r.at, type: `${r.entity}:${r.action}`, text: EVENT_TEXT[`${r.entity}:${r.action}`] ?? `${r.entity}: ${r.action}`, actor_name: r.actor_id ? r.actor_name : 'Система', data };
    });
}

export function summary(db: DB, actor: User, clientId: string, days: number) {
  const c = get(db, 'SELECT id, name, timezone FROM users WHERE id = ?', clientId);
  if (!c) throw notFound();
  const today = todayIn(c.timezone, clock.now());
  const from = addDays(today, -(days - 1));
  const view = get(db, 'SELECT last_viewed_at FROM specialist_views WHERE specialist_id = ? AND client_id = ?', actor.id, clientId);
  const changes = view ? events(db, actor, clientId, { since: view.last_viewed_at, limit: 50 }).filter((e) => e.actor_name !== actor.name) : [];
  const schemes = all(db, 'SELECT * FROM schemes WHERE client_id = ? ORDER BY created_at DESC', clientId).map((s) => {
    const pub = latestPublished(db, s.id);
    return { id: s.id, title: pub?.title, status: schemeStatus(s, pub, today), start_date: pub?.start_date, end_date: pub?.end_date, control_date: pub?.control_date, version: pub?.number };
  }).filter((s) => s.status === 'active' || s.status === 'scheduled');
  const wellbeing = all(db, 'SELECT * FROM wellbeing WHERE client_id = ? AND date BETWEEN ? AND ? ORDER BY date DESC', clientId, from, today)
    .map((w) => ({ ...w, symptoms: JSON.parse(w.symptoms) }));
  return {
    client: { id: c.id, name: c.name, timezone: c.timezone },
    period: { from, to: today, days },
    schemes,
    latest_results: latestResults(db, clientId).slice(0, 12),
    adherence: stats(db, clientId, from, today),
    wellbeing,
    changes,
    last_viewed_at: view?.last_viewed_at ?? null,
  };
}

export function markViewed(db: DB, actor: User, clientId: string) {
  run(db, `INSERT INTO specialist_views (specialist_id, client_id, last_viewed_at) VALUES (?,?,?)
    ON CONFLICT (specialist_id, client_id) DO UPDATE SET last_viewed_at = excluded.last_viewed_at`, actor.id, clientId, nowIso());
}

export function validateDays(v: unknown) {
  const n = Number(v ?? 14);
  if (!Number.isInteger(n) || n < 1 || n > 366) throw bad('Неверный период');
  return n;
}
