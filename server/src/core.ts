import { createCipheriv, createDecipheriv, createHash, randomBytes, randomUUID } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { all, get, run, type DB } from './db.ts';

export class HttpError extends Error {
  status: number;
  code: string;
  extra?: Record<string, unknown>;
  constructor(status: number, code: string, message: string, extra?: Record<string, unknown>) {
    super(message);
    this.status = status;
    this.code = code;
    this.extra = extra;
  }
}
export const notFound = () => new HttpError(404, 'not_found', 'Не найдено');
export const forbidden = (m = 'Недостаточно прав') => new HttpError(403, 'forbidden', m);
export const bad = (m: string, extra?: Record<string, unknown>) => new HttpError(400, 'bad_request', m, extra);

export const id = () => randomUUID();
export const sha256 = (b: Buffer | string) => createHash('sha256').update(b).digest('hex');
export const token = (bytes = 32) => randomBytes(bytes).toString('base64url');

/** Время сервиса. В тестах подменяется. */
export const clock = { now: () => Date.now() };
export const nowIso = () => new Date(clock.now()).toISOString();

export type User = { id: string; email: string; name: string; role: 'client' | 'specialist'; timezone: string };

// ---------- Журнал изменений ----------

export function audit(db: DB, e: { actor: string | null; client: string | null; entity: string; entity_id?: string | null; action: string; data?: unknown }) {
  run(db, 'INSERT INTO audit_log (id, at, actor_id, client_id, entity, entity_id, action, data) VALUES (?,?,?,?,?,?,?,?)',
    id(), nowIso(), e.actor, e.client, e.entity, e.entity_id ?? null, e.action, JSON.stringify(e.data ?? {}));
}

// ---------- Доступ ----------

export type Access = 'self' | 'specialist';

export function activeLink(db: DB, clientId: string) {
  return get(db, 'SELECT * FROM care_links WHERE client_id = ? AND revoked_at IS NULL', clientId);
}

/**
 * Проверка доступа на сервере. Специалист видит только клиентов с активной связью.
 * Чужие и несуществующие клиенты одинаково отвечают 404, чтобы не раскрывать факт наличия аккаунта.
 */
export function accessTo(db: DB, actor: User, clientId: string): Access {
  if (actor.role === 'client') {
    if (actor.id === clientId) return 'self';
    throw notFound();
  }
  const link = get(db, 'SELECT id FROM care_links WHERE client_id = ? AND specialist_id = ? AND revoked_at IS NULL', clientId, actor.id);
  if (!link) throw notFound();
  return 'specialist';
}

export function requireRole(actor: User, role: User['role']) {
  if (actor.role !== role) throw forbidden();
}

export function userById(db: DB, uid: string) {
  return get<User>(db, 'SELECT id, email, name, role, timezone FROM users WHERE id = ?', uid);
}

// ---------- Уведомления ----------

export type NotifyInput = {
  kind: string;
  title: string;          // полный текст — виден только внутри приложения
  body?: string;
  public_title: string;   // безопасный текст для экрана блокировки и браузерных уведомлений
  link?: string;
  dedupe_key?: string;
};

export function notify(db: DB, userId: string, n: NotifyInput) {
  if (n.dedupe_key && get(db, 'SELECT 1 FROM notifications WHERE dedupe_key = ?', n.dedupe_key)) return;
  run(db, 'INSERT INTO notifications (id, user_id, kind, title, body, public_title, link, dedupe_key, created_at) VALUES (?,?,?,?,?,?,?,?,?)',
    id(), userId, n.kind, n.title, n.body ?? '', n.public_title, n.link ?? null, n.dedupe_key ?? null, nowIso());
}

export function notificationSettings(db: DB, userId: string) {
  let s = get(db, 'SELECT * FROM notification_settings WHERE user_id = ?', userId);
  if (!s) {
    run(db, 'INSERT INTO notification_settings (user_id, quiet_from, quiet_to) VALUES (?, ?, ?)', userId, '22:30', '08:00');
    s = get(db, 'SELECT * FROM notification_settings WHERE user_id = ?', userId)!;
  }
  return s;
}

// ---------- Закрытое хранилище файлов ----------

/**
 * Файлы анализов хранятся зашифрованными (AES-256-GCM) и отдаются только через API
 * с проверкой доступа. Ключ берётся из NUTRI_FILE_KEY (32 байта в base64).
 */
export class FileStore {
  dir: string;
  key: Buffer;
  constructor(dir: string, keyB64?: string) {
    this.dir = dir;
    mkdirSync(dir, { recursive: true });
    if (keyB64) this.key = Buffer.from(keyB64, 'base64');
    else {
      const keyFile = join(dir, '.dev-file-key');
      if (!existsSync(keyFile)) writeFileSync(keyFile, randomBytes(32).toString('base64'), { mode: 0o600 });
      this.key = Buffer.from(readFileSync(keyFile, 'utf8'), 'base64');
    }
    if (this.key.length !== 32) throw new Error('NUTRI_FILE_KEY должен содержать 32 байта в base64');
  }
  put(data: Buffer): string {
    const key = token(18);
    const iv = randomBytes(12);
    const c = createCipheriv('aes-256-gcm', this.key, iv);
    const enc = Buffer.concat([c.update(data), c.final()]);
    writeFileSync(join(this.dir, key), Buffer.concat([iv, c.getAuthTag(), enc]), { mode: 0o600 });
    return key;
  }
  read(key: string): Buffer {
    if (!/^[A-Za-z0-9_-]+$/.test(key)) throw notFound();
    const raw = readFileSync(join(this.dir, key));
    const d = createDecipheriv('aes-256-gcm', this.key, raw.subarray(0, 12));
    d.setAuthTag(raw.subarray(12, 28));
    return Buffer.concat([d.update(raw.subarray(28)), d.final()]);
  }
  remove(key: string) {
    if (/^[A-Za-z0-9_-]+$/.test(key)) rmSync(join(this.dir, key), { force: true });
  }
}

export function clientNameFor(db: DB, uid: string) {
  return get<{ name: string }>(db, 'SELECT name FROM users WHERE id = ?', uid)?.name ?? 'Клиент';
}

export function lastActivity(db: DB, clientId: string): string | null {
  return get<{ at: string | null }>(db, 'SELECT MAX(at) AS at FROM audit_log WHERE client_id = ? AND actor_id = ?', clientId, clientId)?.at ?? null;
}

export { all, get, run };
