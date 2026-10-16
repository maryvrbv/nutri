// Работа с датами и часовыми поясами без внешних библиотек.
// Даты в формате YYYY-MM-DD всегда «локальные» для клиента, моменты — ISO в UTC.

const fmtCache = new Map<string, Intl.DateTimeFormat>();

function formatter(tz: string) {
  let f = fmtCache.get(tz);
  if (!f) {
    f = new Intl.DateTimeFormat('en-CA', {
      timeZone: tz, hourCycle: 'h23',
      year: 'numeric', month: '2-digit', day: '2-digit',
      hour: '2-digit', minute: '2-digit', second: '2-digit',
    });
    fmtCache.set(tz, f);
  }
  return f;
}

export function isValidTimeZone(tz: unknown): tz is string {
  if (typeof tz !== 'string' || !tz) return false;
  try { formatter(tz); return true; } catch { return false; }
}

/** Части локального времени в поясе tz для момента ms. */
export function zonedParts(ms: number, tz: string) {
  const parts: Record<string, string> = {};
  for (const p of formatter(tz).formatToParts(new Date(ms))) parts[p.type] = p.value;
  return {
    date: `${parts.year}-${parts.month}-${parts.day}`,
    time: `${parts.hour}:${parts.minute}`,
    y: +parts.year, m: +parts.month, d: +parts.day, hh: +parts.hour, mm: +parts.minute, ss: +parts.second,
  };
}

function offsetMs(ms: number, tz: string) {
  const p = zonedParts(ms, tz);
  const asUtc = Date.UTC(p.y, p.m - 1, p.d, p.hh, p.mm, p.ss);
  return asUtc - Math.floor(ms / 1000) * 1000;
}

/**
 * Локальные дата и время в поясе tz → момент UTC.
 * Несуществующее время (переход на летнее) сдвигается вперёд,
 * неоднозначное (переход на зимнее) берётся первым.
 */
export function zonedToUtc(date: string, time: string, tz: string): Date {
  const [y, m, d] = date.split('-').map(Number);
  const [hh, mm] = time.split(':').map(Number);
  const naive = Date.UTC(y, m - 1, d, hh, mm);
  const g1 = naive - offsetMs(naive, tz);
  const g2 = naive - offsetMs(g1, tz);
  const matches = (ms: number) => {
    const p = zonedParts(ms, tz);
    return p.date === date && p.time === time.slice(0, 5);
  };
  if (matches(Math.min(g1, g2))) return new Date(Math.min(g1, g2));
  if (matches(Math.max(g1, g2))) return new Date(Math.max(g1, g2));
  return new Date(Math.max(g1, g2));
}

export function todayIn(tz: string, now = Date.now()): string {
  return zonedParts(now, tz).date;
}

export function addDays(date: string, n: number): string {
  const [y, m, d] = date.split('-').map(Number);
  const t = new Date(Date.UTC(y, m - 1, d + n));
  return t.toISOString().slice(0, 10);
}

export function daysBetween(a: string, b: string): number {
  const pa = a.split('-').map(Number), pb = b.split('-').map(Number);
  return Math.round((Date.UTC(pb[0], pb[1] - 1, pb[2]) - Date.UTC(pa[0], pa[1] - 1, pa[2])) / 86400000);
}

/** День недели: 1 — понедельник … 7 — воскресенье. */
export function weekday(date: string): number {
  const [y, m, d] = date.split('-').map(Number);
  const w = new Date(Date.UTC(y, m - 1, d)).getUTCDay();
  return w === 0 ? 7 : w;
}

export function isDate(s: unknown): s is string {
  if (typeof s !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(s)) return false;
  return new Date(s + 'T00:00:00Z').toISOString().slice(0, 10) === s;
}

export function isTime(s: unknown): s is string {
  return typeof s === 'string' && /^([01]\d|2[0-3]):[0-5]\d$/.test(s);
}

/** Попадает ли локальное время HH:MM в тихие часы (интервал может переходить через полночь). */
export function inQuietHours(time: string, from?: string | null, to?: string | null): boolean {
  if (!from || !to || from === to) return false;
  return from < to ? time >= from && time < to : time >= from || time < to;
}

const MONTHS = ['января', 'февраля', 'марта', 'апреля', 'мая', 'июня', 'июля', 'августа', 'сентября', 'октября', 'ноября', 'декабря'];
/** «12 октября» — для текстов уведомлений. */
export function ruDate(date: string): string {
  const [, m, d] = date.split('-').map(Number);
  return `${d}\u00a0${MONTHS[m - 1]}`;
}
