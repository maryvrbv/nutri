import express, { type NextFunction, type Request, type Response } from 'express';
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { all, get, run, tx, type DB } from './db.ts';
import {
  FileStore, HttpError, accessTo, audit, bad, clock, forbidden, id, notFound, notificationSettings, notify, nowIso, requireRole, activeLink, type User,
} from './core.ts';
import { createSession, destroySession, login, register, sessionUser, verifyPassword } from './auth.ts';
import * as care from './care.ts';
import * as schemes from './schemes.ts';
import * as intakes from './intakes.ts';
import * as labs from './labs.ts';
import { validateVersion, ValidationError } from './schedule.ts';
import type { Recognizer } from './recognition.ts';
import { ANALYTES } from './reference.ts';
import { addDays, isDate, isTime, isValidTimeZone, ruDate, todayIn } from './time.ts';

export type AppDeps = {
  db: DB; files: FileStore; recognizer: Recognizer; webDist?: string; secureCookies?: boolean;
  /** false — регистрация только первого аккаунта и клиентов по действующему приглашению */
  openRegistration?: boolean;
};

const COOKIE = 'nutri_sid';

declare global {
  namespace Express { interface Request { user?: User; sid?: string } }
}

function cookie(req: Request, name: string) {
  const raw = req.headers.cookie ?? '';
  for (const part of raw.split(';')) {
    const [k, ...v] = part.trim().split('=');
    if (k === name) return decodeURIComponent(v.join('='));
  }
  return undefined;
}

const h = (fn: (req: Request, res: Response) => unknown) => async (req: Request, res: Response, next: NextFunction) => {
  try {
    const out = await fn(req, res);
    if (!res.headersSent) res.json(out ?? { ok: true });
  } catch (e) { next(e); }
};

const SYMPTOMS = ['headache', 'nausea', 'stomach', 'heartburn', 'rash', 'insomnia', 'drowsiness', 'palpitations', 'anxiety', 'other'];

export function createApp(deps: AppDeps) {
  const { db, files, recognizer } = deps;
  const app = express();
  app.disable('x-powered-by');
  app.set('trust proxy', 1);

  app.use((req, res, next) => {
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('Referrer-Policy', 'no-referrer');
    res.setHeader('X-Frame-Options', 'SAMEORIGIN');
    res.setHeader('Permissions-Policy', 'camera=(self), microphone=(), geolocation=()');
    res.setHeader('Content-Security-Policy', "default-src 'self'; img-src 'self' blob: data:; style-src 'self' 'unsafe-inline'; font-src 'self'; frame-src 'self' blob:; object-src 'self' blob:; frame-ancestors 'self'; base-uri 'none'; form-action 'self'");
    next();
  });

  // Технический лог без тел запросов и параметров: медицинские данные в обычные логи не попадают.
  app.use('/api', (req, res, next) => {
    const t = Date.now();
    res.on('finish', () => {
      const route = (req.route?.path as string | undefined) ?? req.path.replace(/[0-9a-f-]{36}/g, ':id').replace(/\/[A-Za-z0-9_-]{30,}/g, '/:token');
      if (process.env.NODE_ENV !== 'test') console.log(`${req.method} ${req.baseUrl}${route} ${res.statusCode} ${Date.now() - t}ms`);
    });
    res.setHeader('Cache-Control', 'no-store');
    next();
  });

  app.use('/api', express.json({ limit: '1mb' }));

  // Сессия + защита от CSRF: изменяющие запросы обязаны прислать собственный заголовок,
  // который браузер не отправит с чужого сайта без CORS.
  app.use('/api', (req, _res, next) => {
    const sid = cookie(req, COOKIE);
    req.sid = sid;
    req.user = sessionUser(db, sid) ?? undefined;
    if (!['GET', 'HEAD', 'OPTIONS'].includes(req.method) && req.get('x-nutri') !== '1') return next(forbidden('Запрос отклонён'));
    next();
  });

  const auth = (req: Request) => {
    if (!req.user) throw new HttpError(401, 'unauthorized', 'Войдите в аккаунт');
    return req.user;
  };
  const setSession = (res: Response, userId: string) => {
    const s = createSession(db, userId);
    res.setHeader('Set-Cookie', `${COOKIE}=${s.token}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${s.maxAge}${deps.secureCookies ? '; Secure' : ''}`);
  };

  const me = (u: User) => {
    const s = notificationSettings(db, u.id);
    const sp = u.role === 'specialist' ? get(db, 'SELECT title FROM specialist_profiles WHERE user_id = ?', u.id) : null;
    const prof = get(db, 'SELECT sex, birth_date FROM users WHERE id = ?', u.id);
    return { ...u, title: sp?.title ?? null, sex: prof?.sex ?? null, birth_date: prof?.birth_date ?? null, today: todayIn(u.timezone, clock.now()), settings: settingsOut(s) };
  };
  const settingsOut = (s: any) => ({
    quiet_from: s.quiet_from, quiet_to: s.quiet_to, channel_inapp: !!s.channel_inapp, channel_browser: !!s.channel_browser,
    hide_sensitive: !!s.hide_sensitive, intake_reminders: !!s.intake_reminders,
  });

  // ---------- Аккаунт ----------

  app.post('/api/auth/register', h((req, res) => {
    if (deps.openRegistration === false) {
      const first = !get(db, 'SELECT 1 FROM users LIMIT 1');
      const invited = typeof req.body?.invite === 'string' && care.invitationIsValid(db, req.body.invite);
      if (!first && !invited) throw new HttpError(403, 'registration_closed', 'Регистрация по приглашению. Попросите специалиста прислать ссылку.');
      if (!first && invited) req.body.role = 'client';
    }
    const u = register(db, req.body);
    setSession(res, u.id);
    return me(u);
  }));
  app.post('/api/auth/login', h((req, res) => {
    const u = login(db, req.body?.email, req.body?.password);
    setSession(res, u.id);
    return me(u);
  }));
  app.post('/api/auth/logout', h((req, res) => {
    destroySession(db, req.sid);
    res.setHeader('Set-Cookie', `${COOKIE}=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0`);
    return { ok: true };
  }));
  app.get('/api/me', h((req) => me(auth(req))));
  app.get('/api/auth/options', h(() => ({ open_registration: deps.openRegistration !== false || !get(db, 'SELECT 1 FROM users LIMIT 1') })));

  app.patch('/api/me', h((req) => {
    const u = auth(req);
    const b = req.body ?? {};
    tx(db, () => {
      if (b.name !== undefined) {
        const name = String(b.name).trim();
        if (name.length < 2) throw bad('Слишком короткое имя');
        run(db, 'UPDATE users SET name = ? WHERE id = ?', name, u.id);
      }
      if (b.timezone !== undefined) {
        if (!isValidTimeZone(b.timezone)) throw bad('Неизвестный часовой пояс');
        run(db, 'UPDATE users SET timezone = ? WHERE id = ?', b.timezone, u.id);
        if (u.role === 'client') schemes.rescheduleForTimezone(db, u.id, b.timezone);
      }
      if (b.sex !== undefined || b.birth_date !== undefined) {
        if (b.sex !== undefined && ![null, '', 'female', 'male'].includes(b.sex)) throw bad('Неверное значение пола');
        if (b.birth_date !== undefined && b.birth_date !== null && b.birth_date !== '' && !isDate(b.birth_date)) throw bad('Неверная дата рождения');
        if (b.sex !== undefined) run(db, 'UPDATE users SET sex = ? WHERE id = ?', b.sex || null, u.id);
        if (b.birth_date !== undefined) run(db, 'UPDATE users SET birth_date = ? WHERE id = ?', b.birth_date || null, u.id);
        labs.refreshReferenceRanges(db, u.id);
      }
      if (b.title !== undefined && u.role === 'specialist') run(db, 'UPDATE specialist_profiles SET title = ? WHERE user_id = ?', String(b.title).slice(0, 120), u.id);
      const s = b.settings;
      if (s) {
        notificationSettings(db, u.id);
        for (const k of ['quiet_from', 'quiet_to'] as const) if (s[k] !== undefined && s[k] !== null && s[k] !== '' && !isTime(s[k])) throw bad('Неверное время тихих часов');
        run(db, `UPDATE notification_settings SET quiet_from = COALESCE(?, quiet_from), quiet_to = COALESCE(?, quiet_to),
          channel_inapp = COALESCE(?, channel_inapp), channel_browser = COALESCE(?, channel_browser), hide_sensitive = COALESCE(?, hide_sensitive),
          intake_reminders = COALESCE(?, intake_reminders) WHERE user_id = ?`,
          s.quiet_from === '' ? null : s.quiet_from ?? null, s.quiet_to === '' ? null : s.quiet_to ?? null,
          b2i(s.channel_inapp), b2i(s.channel_browser), b2i(s.hide_sensitive), b2i(s.intake_reminders), u.id);
        if (s.quiet_from === '' || s.quiet_to === '') run(db, 'UPDATE notification_settings SET quiet_from = NULL, quiet_to = NULL WHERE user_id = ?', u.id);
      }
    });
    return me(userOrThrow(u.id));
  }));

  const userOrThrow = (uid: string) => {
    const u = get<User>(db, 'SELECT id, email, name, role, timezone FROM users WHERE id = ?', uid);
    if (!u) throw notFound();
    return u;
  };

  /** Экспорт всех данных пользователя одним JSON. Файлы скачиваются отдельно по ссылкам. */
  app.get('/api/me/export', h((req, res) => {
    const u = auth(req);
    const q = (sql: string) => all(db, sql, u.id);
    const data = u.role === 'client' ? {
      exported_at: nowIso(),
      profile: me(u),
      access: q('SELECT l.consented_at, l.revoked_at, l.scopes, s.name AS specialist FROM care_links l LEFT JOIN users s ON s.id = l.specialist_id WHERE l.client_id = ?'),
      documents: q('SELECT id, file_name, mime, lab, collected_at, uploaded_at, status FROM documents WHERE owner_id = ?')
        .map((d) => ({ ...d, file_url: d.mime === 'manual' ? null : `/api/documents/${d.id}/file` })),
      results: q('SELECT name, analyte_code, value_text, value_num, unit, ref_text, lab_flag, collected_at, status, source, recognized FROM results WHERE owner_id = ?'),
      explanations: q('SELECT e.* FROM explanations e JOIN results r ON r.id = e.result_id WHERE r.owner_id = ?'),
      comments: q(`SELECT kind, target_type, target_id, body, created_at FROM comments WHERE client_id = ? AND kind != 'internal'`),
      schemes: schemes.listSchemes(db, u.id, { includeDrafts: false }),
      intakes: intakes.intakeHistory(db, u.id, '2000-01-01', '2100-01-01'),
      mark_history: q('SELECT h.* FROM mark_history h JOIN planned_intakes p ON p.id = h.planned_id WHERE p.client_id = ?'),
      self_supplements: q('SELECT * FROM self_supplements WHERE client_id = ?'),
      wellbeing: q('SELECT * FROM wellbeing WHERE client_id = ?'),
      notifications: q('SELECT kind, title, created_at, read_at FROM notifications WHERE user_id = ?'),
    } : {
      exported_at: nowIso(),
      profile: me(u),
      invitations: care.listInvitations(db, u),
      comments: q('SELECT client_id, kind, target_type, body, created_at FROM comments WHERE author_id = ?'),
    };
    res.setHeader('Content-Disposition', `attachment; filename="nutri-export-${todayIn(u.timezone, clock.now())}.json"`);
    return data;
  }));

  /** Удаление аккаунта и всех данных. Требует пароль. */
  app.post('/api/me/delete', h((req, res) => {
    const u = auth(req);
    const row = get(db, 'SELECT password_hash FROM users WHERE id = ?', u.id)!;
    if (!verifyPassword(String(req.body?.password ?? ''), row.password_hash)) throw new HttpError(401, 'bad_credentials', 'Неверный пароль');
    const keys = all<{ storage_key: string }>(db, 'SELECT storage_key FROM documents WHERE owner_id = ?', u.id);
    tx(db, () => {
      const link = activeLink(db, u.id);
      if (link) notify(db, link.specialist_id, { kind: 'client_revoked', title: `${u.name} удалил(-а) аккаунт`, public_title: 'Изменение доступа клиента' });
      run(db, 'DELETE FROM audit_log WHERE client_id = ?', u.id);
      run(db, 'DELETE FROM comments WHERE client_id = ? OR author_id = ?', u.id, u.id);
      run(db, 'DELETE FROM specialist_views WHERE client_id = ? OR specialist_id = ?', u.id, u.id);
      run(db, 'DELETE FROM users WHERE id = ?', u.id);
    });
    for (const k of keys) files.remove(k.storage_key);
    res.setHeader('Set-Cookie', `${COOKIE}=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0`);
    return { ok: true };
  }));

  // ---------- Уведомления ----------

  app.get('/api/notifications', h((req) => {
    const u = auth(req);
    const items = all(db, 'SELECT id, kind, title, body, public_title, link, created_at, read_at FROM notifications WHERE user_id = ? ORDER BY created_at DESC LIMIT 100', u.id);
    return { items, unread: items.filter((n) => !n.read_at).length };
  }));
  app.post('/api/notifications/read', h((req) => {
    const u = auth(req);
    const ids: string[] | undefined = Array.isArray(req.body?.ids) ? req.body.ids : undefined;
    if (ids) for (const nid of ids) run(db, 'UPDATE notifications SET read_at = ? WHERE id = ? AND user_id = ? AND read_at IS NULL', nowIso(), nid, u.id);
    else run(db, 'UPDATE notifications SET read_at = ? WHERE user_id = ? AND read_at IS NULL', nowIso(), u.id);
  }));

  // ---------- Приглашения и доступ ----------

  app.post('/api/invitations', h((req) => {
    const u = auth(req); requireRole(u, 'specialist');
    return care.createInvitation(db, u, req.body?.client_hint);
  }));
  app.get('/api/invitations', h((req) => {
    const u = auth(req); requireRole(u, 'specialist');
    return care.listInvitations(db, u);
  }));
  app.delete('/api/invitations/:id', h((req) => {
    const u = auth(req); requireRole(u, 'specialist');
    care.revokeInvitation(db, u, String(req.params.id));
  }));
  app.get('/api/invite/:token', h((req) => care.previewInvitation(db, String(req.params.token))));
  app.post('/api/invite/:token/accept', h((req) => {
    const u = auth(req);
    care.acceptInvitation(db, u, String(req.params.token), !!req.body?.replace);
    return care.accessInfo(db, u);
  }));
  app.get('/api/me/access', h((req) => {
    const u = auth(req); requireRole(u, 'client');
    return care.accessInfo(db, u);
  }));
  app.delete('/api/me/access', h((req) => {
    const u = auth(req); requireRole(u, 'client');
    care.revokeAccess(db, u);
    return care.accessInfo(db, u);
  }));

  // ---------- Специалист: клиенты ----------

  app.get('/api/clients', h((req) => {
    const u = auth(req); requireRole(u, 'specialist');
    return care.listClients(db, u, req.query.filter as string, req.query.q as string);
  }));

  /** Разрешает обращение к данным клиента: «me» для самого клиента, id — для специалиста. */
  const client = (req: Request) => {
    const u = auth(req);
    const cid = req.params.clientId === 'me' ? u.id : String(req.params.clientId);
    const access = accessTo(db, u, cid);
    return { u, cid, access };
  };

  app.get('/api/clients/:clientId/summary', h((req) => {
    const { u, cid } = client(req); requireRole(u, 'specialist');
    const s = care.summary(db, u, cid, care.validateDays(req.query.days));
    if (req.query.mark_viewed === '1') care.markViewed(db, u, cid);
    return s;
  }));
  app.post('/api/clients/:clientId/viewed', h((req) => {
    const { u, cid } = client(req); requireRole(u, 'specialist');
    care.markViewed(db, u, cid);
  }));
  app.get('/api/clients/:clientId/events', h((req) => {
    const { u, cid } = client(req);
    requireRole(u, 'specialist');
    return care.events(db, u, cid, { limit: 300 });
  }));
  app.get('/api/clients/:clientId/profile', h((req) => {
    const { cid } = client(req);
    const c = get(db, 'SELECT id, name, timezone FROM users WHERE id = ?', cid)!;
    return { ...c, today: todayIn(c.timezone, clock.now()) };
  }));

  // ---------- Схемы ----------

  app.get('/api/clients/:clientId/schemes', h((req) => {
    const { access, cid } = client(req);
    return schemes.listSchemes(db, cid, { includeDrafts: access === 'specialist' });
  }));
  app.post('/api/clients/:clientId/schemes', h((req) => {
    const { u, cid } = client(req); requireRole(u, 'specialist');
    return schemes.createDraft(db, u, cid, req.body);
  }));
  app.post('/api/schemes/preview', h((req) => {
    const u = auth(req); requireRole(u, 'specialist');
    const v = validateVersion(req.body?.version);
    const from = isDate(req.body?.from) ? req.body.from : v.start_date;
    return schemes.previewSchedule(v, from, Math.min(Number(req.body?.days) || 7, 31));
  }));

  const schemeAccess = (req: Request) => {
    const u = auth(req);
    const s = get(db, 'SELECT * FROM schemes WHERE id = ?', String(req.params.id));
    if (!s) throw notFound();
    const access = accessTo(db, u, s.client_id);
    return { u, s, access };
  };

  app.get('/api/schemes/:id', h((req) => {
    const { access, s } = schemeAccess(req);
    const v = schemes.schemeView(db, s.id, { includeDraft: access === 'specialist' });
    if (access === 'self' && v.status === 'draft') throw notFound();
    return v;
  }));
  app.put('/api/schemes/:id/draft', h((req) => {
    const { u, s } = schemeAccess(req); requireRole(u, 'specialist');
    schemes.updateDraft(db, u, s.id, req.body);
    return schemes.schemeView(db, s.id, { includeDraft: true });
  }));
  app.post('/api/schemes/:id/versions', h((req) => {
    const { u, s } = schemeAccess(req); requireRole(u, 'specialist');
    schemes.startNewVersion(db, u, s.id);
    return schemes.schemeView(db, s.id, { includeDraft: true });
  }));
  app.delete('/api/schemes/:id/draft', h((req) => {
    const { u, s } = schemeAccess(req); requireRole(u, 'specialist');
    schemes.discardDraft(db, u, s.id);
  }));
  app.post('/api/schemes/:id/publish', h((req) => {
    const { u, s } = schemeAccess(req); requireRole(u, 'specialist');
    const r = schemes.publish(db, u, s.id, { effective_from: req.body?.effective_from });
    return { ...r, scheme: schemes.schemeView(db, s.id, { includeDraft: true }) };
  }));
  app.post('/api/schemes/:id/cancel', h((req) => {
    const { u, s } = schemeAccess(req); requireRole(u, 'specialist');
    const r = schemes.cancelScheme(db, u, s.id, String(req.body?.reason ?? '').slice(0, 500));
    return { ...r, scheme: schemes.schemeView(db, s.id, { includeDraft: true }) };
  }));

  // ---------- Приём ----------

  app.get('/api/clients/:clientId/today', h((req) => {
    const { cid } = client(req);
    const tz = get<{ timezone: string }>(db, 'SELECT timezone FROM users WHERE id = ?', cid)!.timezone;
    const today = todayIn(tz, clock.now());
    const date = isDate(req.query.date) ? (req.query.date as string) : today;
    const wb = get(db, 'SELECT * FROM wellbeing WHERE client_id = ? AND date = ?', cid, date);
    return {
      date, today,
      intakes: intakes.intakesForDay(db, cid, date),
      wellbeing: wb ? { ...wb, symptoms: JSON.parse(wb.symptoms) } : null,
      self_supplements: all(db, 'SELECT * FROM self_supplements WHERE client_id = ? AND (end_date IS NULL OR end_date >= ?) AND (start_date IS NULL OR start_date <= ?) ORDER BY name', cid, date, date),
    };
  }));
  app.get('/api/clients/:clientId/intakes', h((req) => {
    const { cid } = client(req);
    const tz = get<{ timezone: string }>(db, 'SELECT timezone FROM users WHERE id = ?', cid)!.timezone;
    const today = todayIn(tz, clock.now());
    const to = isDate(req.query.to) ? (req.query.to as string) : today;
    const from = isDate(req.query.from) ? (req.query.from as string) : addDays(to, -29);
    if (from > to) throw bad('Неверный период');
    const name = typeof req.query.name === 'string' && req.query.name ? req.query.name : undefined;
    const items = intakes.intakeHistory(db, cid, from, to, name);
    const statsTo = to < today ? to : today;
    return {
      from, to, today, items,
      stats: intakes.stats(db, cid, from, statsTo),
      names: intakes.supplementNames(db, cid),
    };
  }));
  app.post('/api/clients/:clientId/intakes/mark', h((req) => {
    const { u, cid } = client(req);
    return intakes.mark(db, u, cid, req.body);
  }));
  app.post('/api/clients/:clientId/intakes/snooze', h((req) => {
    const { u, access } = client(req);
    if (access !== 'self') throw forbidden();
    return { until: intakes.snooze(db, u, req.body?.planned_ids ?? [], Number(req.body?.minutes ?? 30)) };
  }));
  app.get('/api/clients/:clientId/intakes/:pid/history', h((req) => {
    const { cid } = client(req);
    return intakes.markHistory(db, cid, String(req.params.pid));
  }));

  // ---------- Самостоятельные добавки ----------

  app.get('/api/clients/:clientId/self-supplements', h((req) => {
    const { cid } = client(req);
    return all(db, 'SELECT * FROM self_supplements WHERE client_id = ? ORDER BY created_at DESC', cid);
  }));
  app.post('/api/clients/:clientId/self-supplements', h((req) => {
    const { u, cid, access } = client(req);
    if (access !== 'self') throw forbidden('Самостоятельный приём вносит сам клиент');
    const b = req.body ?? {};
    const name = String(b.name ?? '').trim();
    if (!name) throw bad('Укажите название');
    for (const k of ['start_date', 'end_date']) if (b[k] && !isDate(b[k])) throw bad('Неверная дата');
    const sid = id();
    run(db, 'INSERT INTO self_supplements (id, client_id, name, amount, schedule, start_date, end_date, note, created_at) VALUES (?,?,?,?,?,?,?,?,?)',
      sid, cid, name.slice(0, 120), String(b.amount ?? '').slice(0, 120), String(b.schedule ?? '').slice(0, 200), b.start_date || null, b.end_date || null, String(b.note ?? '').slice(0, 1000), nowIso());
    audit(db, { actor: u.id, client: cid, entity: 'self_supplement', entity_id: sid, action: 'added', data: { name } });
    return { id: sid };
  }));
  app.delete('/api/clients/:clientId/self-supplements/:sid', h((req) => {
    const { u, cid, access } = client(req);
    if (access !== 'self') throw forbidden();
    const r = run(db, 'DELETE FROM self_supplements WHERE id = ? AND client_id = ?', String(req.params.sid), cid);
    if (!r.changes) throw notFound();
    audit(db, { actor: u.id, client: cid, entity: 'self_supplement', entity_id: String(req.params.sid), action: 'deleted' });
  }));

  // ---------- Самочувствие ----------

  app.get('/api/clients/:clientId/wellbeing', h((req) => {
    const { cid } = client(req);
    const tz = get<{ timezone: string }>(db, 'SELECT timezone FROM users WHERE id = ?', cid)!.timezone;
    const to = isDate(req.query.to) ? (req.query.to as string) : todayIn(tz, clock.now());
    const from = isDate(req.query.from) ? (req.query.from as string) : addDays(to, -29);
    return all(db, 'SELECT * FROM wellbeing WHERE client_id = ? AND date BETWEEN ? AND ? ORDER BY date DESC', cid, from, to)
      .map((w) => ({ ...w, symptoms: JSON.parse(w.symptoms), adverse: !!w.adverse }));
  }));
  app.put('/api/clients/:clientId/wellbeing/:date', h((req) => {
    const { u, cid, access } = client(req);
    if (access !== 'self') throw forbidden('Записи о самочувствии вносит сам клиент');
    const date = String(req.params.date);
    const today = todayIn(u.timezone, clock.now());
    if (!isDate(date) || date > today) throw bad('Неверная дата');
    const b = req.body ?? {};
    const score = (v: any) => (v === null || v === undefined || v === '' ? null : Number.isInteger(v) && v >= 1 && v <= 5 ? v : (() => { throw bad('Оценка от 1 до 5'); })());
    const symptoms = Array.isArray(b.symptoms) ? [...new Set(b.symptoms.filter((s: any) => SYMPTOMS.includes(s)))] : [];
    const adverse = b.adverse ? 1 : 0;
    const prev = get(db, 'SELECT adverse FROM wellbeing WHERE client_id = ? AND date = ?', cid, date);
    tx(db, () => {
      run(db, `INSERT INTO wellbeing (id, client_id, date, energy, sleep, overall, symptoms, adverse, comment, updated_at) VALUES (?,?,?,?,?,?,?,?,?,?)
        ON CONFLICT (client_id, date) DO UPDATE SET energy=excluded.energy, sleep=excluded.sleep, overall=excluded.overall, symptoms=excluded.symptoms,
        adverse=excluded.adverse, comment=excluded.comment, updated_at=excluded.updated_at`,
        id(), cid, date, score(b.energy), score(b.sleep), score(b.overall), JSON.stringify(symptoms), adverse, String(b.comment ?? '').slice(0, 2000), nowIso());
      audit(db, { actor: u.id, client: cid, entity: 'wellbeing', entity_id: date, action: 'saved', data: { adverse: !!adverse } });
      const link = activeLink(db, cid);
      if (adverse && !prev?.adverse && link) {
        notify(db, link.specialist_id, { kind: 'adverse', title: `${u.name}: запись о нежелательных ощущениях за ${ruDate(date)}`, public_title: 'Новая запись клиента', link: `/clients/${cid}/wellbeing`, dedupe_key: `adv:${cid}:${date}` });
      }
    });
    return { ok: true };
  }));

  // ---------- Анализы ----------

  app.get('/api/clients/:clientId/documents', h((req) => {
    const { cid } = client(req);
    return labs.listDocuments(db, cid);
  }));
  app.post('/api/clients/:clientId/documents', express.raw({ type: () => true, limit: labs.MAX_FILE + 1024 }), h(async (req) => {
    const { u, cid } = client(req);
    const q = req.query as Record<string, string>;
    const docId = labs.upload(db, files, u, cid, {
      file: Buffer.isBuffer(req.body) ? req.body : Buffer.alloc(0),
      file_name: q.name ?? 'документ',
      lab: q.lab || undefined,
      collected_at: q.collected_at || undefined,
      force: q.force === '1',
    });
    // Распознавание идёт в фоне; клиент опрашивает статус документа.
    setImmediate(() => { labs.processDocument(db, files, recognizer, docId).catch(() => {}); });
    return { id: docId };
  }));

  app.post('/api/clients/:clientId/documents/manual', h((req) => {
    const { u, cid } = client(req);
    return { id: labs.createManualDocument(db, u, cid, req.body) };
  }));

  const docAccess = (req: Request) => {
    const u = auth(req);
    const owner = labs.documentOwner(db, String(req.params.id));
    const access = accessTo(db, u, owner);
    return { u, owner, access, docId: String(req.params.id) };
  };

  app.get('/api/documents/:id', h((req) => {
    const { docId } = docAccess(req);
    return labs.documentView(db, docId);
  }));
  app.get('/api/documents/:id/file', h((req, res) => {
    const { docId } = docAccess(req);
    const d = get(db, 'SELECT storage_key, mime, file_name FROM documents WHERE id = ?', docId)!;
    if (d.mime === 'manual') throw notFound();
    const buf = files.read(d.storage_key);
    res.setHeader('Content-Type', d.mime);
    res.setHeader('Content-Disposition', `inline; filename*=UTF-8''${encodeURIComponent(d.file_name)}`);
    // Для изображений — максимально строгая политика; PDF открывается встроенным просмотрщиком браузера, которому sandbox мешает.
    if (d.mime !== 'application/pdf') res.setHeader('Content-Security-Policy', "default-src 'none'; img-src 'self'; style-src 'unsafe-inline'; sandbox");
    res.setHeader('Cache-Control', 'private, no-store');
    res.end(buf);
  }));
  app.patch('/api/documents/:id', h((req) => {
    const { u, docId } = docAccess(req);
    labs.updateDocumentMeta(db, u, docId, req.body ?? {});
    return labs.documentView(db, docId);
  }));
  app.post('/api/documents/:id/results', h((req) => {
    const { u, docId } = docAccess(req);
    labs.addResult(db, u, docId, req.body);
    return labs.documentView(db, docId);
  }));
  app.post('/api/documents/:id/confirm', h((req) => {
    const { u, docId } = docAccess(req);
    labs.confirmDocument(db, u, docId);
    return labs.documentView(db, docId);
  }));
  app.post('/api/documents/:id/reopen', h((req) => {
    const { u, docId } = docAccess(req);
    labs.reopenDocument(db, u, docId);
    return labs.documentView(db, docId);
  }));
  app.post('/api/documents/:id/ownership', h((req) => {
    const { u, docId } = docAccess(req);
    return { result: labs.resolveOwnership(db, files, u, docId, !!req.body?.mine) };
  }));
  app.post('/api/documents/:id/retry', h((req) => {
    const { docId } = docAccess(req);
    const d = get(db, 'SELECT status, mime FROM documents WHERE id = ?', docId)!;
    if (d.mime === 'manual') throw new HttpError(409, 'bad_state', 'Анализ внесён вручную — распознавать нечего');
    // Повтор — после ошибки или если распознавание ничего не нашло (например, фото загрузили до подключения OCR)
    // Повтор — до подтверждения: распознанные строки заменяются, внесённые вручную остаются
    if (d.status !== 'error' && d.status !== 'needs_review') throw new HttpError(409, 'bad_state', 'Подтверждённый документ сначала откройте на проверку');
    run(db, `DELETE FROM results WHERE document_id = ? AND source = 'recognized'`, docId);
    setImmediate(() => { labs.processDocument(db, files, recognizer, docId).catch(() => {}); });
  }));
  app.delete('/api/documents/:id', h((req) => {
    const { u, docId } = docAccess(req);
    labs.deleteDocument(db, files, u, docId);
  }));

  const resultAccess = (req: Request) => {
    const u = auth(req);
    const r = get(db, 'SELECT owner_id, document_id FROM results WHERE id = ?', String(req.params.id));
    if (!r) throw notFound();
    const access = accessTo(db, u, r.owner_id);
    return { u, owner: r.owner_id as string, docId: r.document_id as string, access, rid: String(req.params.id) };
  };
  app.get('/api/results/:id', h((req) => {
    const { rid } = resultAccess(req);
    return labs.resultView(db, rid);
  }));
  app.patch('/api/results/:id', h((req) => {
    const { u, rid, docId } = resultAccess(req);
    labs.editResult(db, u, rid, req.body ?? {});
    return labs.documentView(db, docId);
  }));
  app.delete('/api/results/:id', h((req) => {
    const { u, rid, docId } = resultAccess(req);
    labs.deleteResult(db, u, rid);
    return labs.documentView(db, docId);
  }));

  app.get('/api/clients/:clientId/labs', h((req) => {
    const { cid } = client(req);
    return { latest: labs.latestResults(db, cid), documents: labs.listDocuments(db, cid) };
  }));
  app.get('/api/clients/:clientId/dynamics/:key', h((req) => {
    const { cid } = client(req);
    return { ...labs.dynamics(db, cid, String(req.params.key)), events: labs.courseEvents(db, cid) };
  }));
  app.get('/api/clients/:clientId/timeline', h((req) => {
    const { cid } = client(req);
    const tz = get<{ timezone: string }>(db, 'SELECT timezone FROM users WHERE id = ?', cid)!.timezone;
    const to = isDate(req.query.to) ? (req.query.to as string) : todayIn(tz, clock.now());
    const from = isDate(req.query.from) ? (req.query.from as string) : addDays(to, -29);
    const rows = intakes.intakeHistory(db, cid, from, to);
    const byDay = new Map<string, { taken: number; skipped: number; unmarked: number; planned: number }>();
    for (const r of rows) {
      const d = byDay.get(r.date) ?? { taken: 0, skipped: 0, unmarked: 0, planned: 0 };
      if (r.state === 'taken') d.taken++; else if (r.state === 'skipped') d.skipped++; else if (r.state === 'unmarked') d.unmarked++; else if (r.state === 'planned') d.planned++;
      byDay.set(r.date, d);
    }
    return {
      from, to,
      intakes: [...byDay.entries()].map(([date, v]) => ({ date, ...v })),
      wellbeing: all(db, 'SELECT date, energy, sleep, overall, adverse, symptoms FROM wellbeing WHERE client_id = ? AND date BETWEEN ? AND ? ORDER BY date', cid, from, to)
        .map((w) => ({ ...w, symptoms: JSON.parse(w.symptoms), adverse: !!w.adverse })),
      labs: all(db, `SELECT collected_at AS date, COUNT(*) AS n FROM results WHERE owner_id = ? AND status = 'confirmed' AND collected_at BETWEEN ? AND ? GROUP BY collected_at`, cid, from, to),
      events: labs.courseEvents(db, cid).filter((e) => e.date >= from && e.date <= to),
    };
  }));

  app.get('/api/reference/analytes', h(() => ANALYTES.map((a) => ({ code: a.code, name: a.name, unit: a.baseUnit, units: Object.keys(a.factors) }))));

  // ---------- Комментарии ----------

  app.get('/api/clients/:clientId/comments', h((req) => {
    const { u, cid, access } = client(req);
    const tt = req.query.target_type as string | undefined;
    const tid = req.query.target_id as string | undefined;
    return all(db, `SELECT c.id, c.kind, c.target_type, c.target_id, c.body, c.created_at, c.author_id, u.name AS author_name, u.role AS author_role
      FROM comments c LEFT JOIN users u ON u.id = c.author_id
      WHERE c.client_id = ? ${access === 'self' ? `AND c.kind != 'internal'` : `AND (c.kind != 'internal' OR c.author_id = ?)`}
      ${tt ? 'AND c.target_type = ?' : ''} ${tid ? 'AND c.target_id = ?' : ''} ORDER BY c.created_at DESC LIMIT 200`,
      cid, ...(access === 'self' ? [] : [u.id]), ...(tt ? [tt] : []), ...(tid ? [tid] : []));
  }));
  app.post('/api/clients/:clientId/comments', h((req) => {
    const { u, cid, access } = client(req);
    const b = req.body ?? {};
    const body = String(b.body ?? '').trim();
    if (!body) throw bad('Напишите текст');
    if (body.length > 5000) throw bad('Слишком длинный текст');
    const kind = access === 'self' ? 'question' : b.kind === 'internal' ? 'internal' : 'conclusion';
    const target_type = ['general', 'document', 'result', 'analyte'].includes(b.target_type) ? b.target_type : 'general';
    const target_id = target_type === 'general' ? null : String(b.target_id ?? '');
    const cmid = id();
    tx(db, () => {
      run(db, 'INSERT INTO comments (id, client_id, author_id, kind, target_type, target_id, body, created_at) VALUES (?,?,?,?,?,?,?,?)',
        cmid, cid, u.id, kind, target_type, target_id, body, nowIso());
      if (kind !== 'internal') audit(db, { actor: u.id, client: cid, entity: 'comment', entity_id: cmid, action: kind, data: { target_type } });
      const link = target_type === 'analyte' ? `/labs/analyte/${target_id}` : target_type === 'document' ? `/labs/documents/${target_id}` : target_type === 'result' ? `/labs/results/${target_id}` : '/labs';
      if (kind === 'conclusion') notify(db, cid, { kind: 'comment', title: `${u.name} оставил(-а) комментарий к анализам`, body: body.slice(0, 140), public_title: 'Новое сообщение от специалиста', link });
      if (kind === 'question') {
        const l = activeLink(db, cid);
        if (l) notify(db, l.specialist_id, { kind: 'question', title: `${u.name} задал(-а) вопрос`, body: body.slice(0, 140), public_title: 'Новый вопрос клиента', link: `/clients/${cid}/labs` });
      }
    });
    return { id: cmid, kind };
  }));
  app.delete('/api/comments/:id', h((req) => {
    const u = auth(req);
    const c = get(db, 'SELECT * FROM comments WHERE id = ?', String(req.params.id));
    if (!c || c.author_id !== u.id) throw notFound();
    run(db, 'DELETE FROM comments WHERE id = ?', c.id);
  }));

  // ---------- Ошибки и статика ----------

  app.use('/api', (_req, _res, next) => next(notFound()));

  if (deps.webDist && existsSync(deps.webDist)) {
    app.use(express.static(deps.webDist, {
      index: false, maxAge: '1h',
      // Сервис-воркер и манифест должны обновляться сразу; файлы сборки с хешем можно кэшировать надолго
      setHeaders: (res, path) => {
        if (/sw\.js$|\.webmanifest$/.test(path)) res.setHeader('Cache-Control', 'no-cache');
        else if (/[\\/]assets[\\/]/.test(path)) res.setHeader('Cache-Control', 'public, max-age=31536000, immutable');
      },
    }));
    app.get(/^(?!\/api\/).*/, (_req, res) => { res.setHeader('Cache-Control', 'no-cache'); res.sendFile(join(deps.webDist!, 'index.html')); });
  }

  app.use((err: any, _req: Request, res: Response, _next: NextFunction) => {
    if (err instanceof ValidationError) return res.status(400).json({ error: 'validation', message: err.message, fields: err.fields });
    if (err instanceof HttpError) return res.status(err.status).json({ error: err.code, message: err.message, ...err.extra });
    if (err?.type === 'entity.too.large') return res.status(413).json({ error: 'too_large', message: 'Файл больше 20 МБ' });
    if (err?.type === 'entity.parse.failed') return res.status(400).json({ error: 'bad_json', message: 'Неверный формат запроса' });
    console.error('unhandled error', err?.name, err?.code, process.env.NODE_ENV === 'test' ? err?.stack : '');
    res.status(500).json({ error: 'internal', message: 'Что-то пошло не так. Попробуйте ещё раз.' });
  });

  return app;
}

function b2i(v: unknown) {
  return v === undefined || v === null ? null : v ? 1 : 0;
}
