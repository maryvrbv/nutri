import { scryptSync, randomBytes, timingSafeEqual } from 'node:crypto';
import { get, run, type DB } from './db.ts';
import { HttpError, bad, clock, id, nowIso, sha256, token, type User } from './core.ts';
import { isValidTimeZone } from './time.ts';

const SESSION_DAYS = 30;

export function hashPassword(pw: string) {
  const salt = randomBytes(16);
  const hash = scryptSync(pw, salt, 32, { N: 16384, r: 8, p: 1 });
  return `scrypt$${salt.toString('base64')}$${hash.toString('base64')}`;
}

export function verifyPassword(pw: string, stored: string) {
  const [alg, s, h] = stored.split('$');
  if (alg !== 'scrypt') return false;
  const hash = scryptSync(pw, Buffer.from(s, 'base64'), 32, { N: 16384, r: 8, p: 1 });
  const expected = Buffer.from(h, 'base64');
  return expected.length === hash.length && timingSafeEqual(expected, hash);
}

export function register(db: DB, input: any): User {
  const email = String(input?.email ?? '').trim().toLowerCase();
  const name = String(input?.name ?? '').trim();
  const password = String(input?.password ?? '');
  const role = input?.role === 'specialist' ? 'specialist' : 'client';
  const tz = isValidTimeZone(input?.timezone) ? input.timezone : 'Europe/Moscow';
  const fields: Record<string, string> = {};
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) fields.email = 'Проверьте адрес почты';
  if (name.length < 2) fields.name = 'Как к вам обращаться?';
  if (password.length < 8) fields.password = 'Минимум 8 символов';
  if (Object.keys(fields).length) throw bad(Object.values(fields)[0], { fields });
  if (get(db, 'SELECT 1 FROM users WHERE email = ?', email)) throw new HttpError(409, 'email_taken', 'Аккаунт с этой почтой уже есть. Войдите.', { fields: { email: 'Аккаунт с этой почтой уже есть' } });
  const user: User = { id: id(), email, name, role, timezone: tz };
  run(db, 'INSERT INTO users (id, email, password_hash, name, role, timezone, created_at) VALUES (?,?,?,?,?,?,?)',
    user.id, email, hashPassword(password), name, role, tz, nowIso());
  if (role === 'specialist') run(db, 'INSERT INTO specialist_profiles (user_id, title) VALUES (?, ?)', user.id, String(input?.title ?? '').trim().slice(0, 120));
  return user;
}

// Простая защита от перебора: не больше 10 неудачных попыток за 15 минут на адрес.
const failures = new Map<string, number[]>();

export function login(db: DB, emailRaw: string, password: string): User {
  const email = String(emailRaw ?? '').trim().toLowerCase();
  const now = clock.now();
  const recent = (failures.get(email) ?? []).filter((t) => now - t < 15 * 60_000);
  if (recent.length >= 10) throw new HttpError(429, 'too_many', 'Слишком много попыток. Попробуйте через 15 минут.');
  const row = get(db, 'SELECT * FROM users WHERE email = ?', email);
  if (!row || !verifyPassword(String(password ?? ''), row.password_hash)) {
    failures.set(email, [...recent, now]);
    throw new HttpError(401, 'bad_credentials', 'Неверная почта или пароль');
  }
  failures.delete(email);
  return { id: row.id, email: row.email, name: row.name, role: row.role, timezone: row.timezone };
}

export function createSession(db: DB, userId: string) {
  const t = token();
  const now = clock.now();
  run(db, 'INSERT INTO sessions (token_hash, user_id, created_at, expires_at) VALUES (?,?,?,?)',
    sha256(t), userId, new Date(now).toISOString(), new Date(now + SESSION_DAYS * 86400_000).toISOString());
  return { token: t, maxAge: SESSION_DAYS * 86400 };
}

export function sessionUser(db: DB, t: string | undefined): User | null {
  if (!t) return null;
  const row = get(db, `SELECT u.id, u.email, u.name, u.role, u.timezone, s.expires_at FROM sessions s JOIN users u ON u.id = s.user_id
    WHERE s.token_hash = ?`, sha256(t));
  if (!row || row.expires_at < nowIso()) return null;
  return { id: row.id, email: row.email, name: row.name, role: row.role, timezone: row.timezone };
}

export function destroySession(db: DB, t: string | undefined) {
  if (t) run(db, 'DELETE FROM sessions WHERE token_hash = ?', sha256(t));
}
