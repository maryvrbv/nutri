import type { Dose, Frequency, IntakeState } from './api';

const NB = ' ';

/**
 * Простой типограф для интерфейсных строк: неразрывный пробел после коротких слов
 * и перед тире, числа вместе с единицами. Полный типограф sbol применяется к статичным текстам.
 */
export function ty(s: string): string {
  if (!s) return s;
  return s
    .replace(/(^|[\s(«"])([А-Яа-яЁёA-Za-z]{1,3})\s+(?=\S)/g, (_m, pre, w) => `${pre}${w}${NB}`)
    .replace(/(^|[\s(«"])([А-Яа-яЁёA-Za-z]{1,3})\s+(?=\S)/g, (_m, pre, w) => `${pre}${w}${NB}`)
    .replace(/\s+—\s*/g, `${NB}— `)
    .replace(/(\d)\s+(?=(мг|мкг|г|мл|МЕ|капс|табл|раз|дн|дней|дня|мин|ч|%|₽|кг|см)\b)/g, `$1${NB}`)
    .replace(/(\d)\s+(?=[А-Яа-яЁё]{1,12})/g, `$1${NB}`);
}

const MONTHS = ['января', 'февраля', 'марта', 'апреля', 'мая', 'июня', 'июля', 'августа', 'сентября', 'октября', 'ноября', 'декабря'];
const MONTHS_SHORT = ['янв', 'фев', 'мар', 'апр', 'мая', 'июн', 'июл', 'авг', 'сен', 'окт', 'ноя', 'дек'];
const WEEKDAYS = ['воскресенье', 'понедельник', 'вторник', 'среда', 'четверг', 'пятница', 'суббота'];
export const WD_SHORT = ['пн', 'вт', 'ср', 'чт', 'пт', 'сб', 'вс'];

const parse = (d: string) => { const [y, m, dd] = d.split('-').map(Number); return new Date(Date.UTC(y, m - 1, dd)); };

export function fmtDate(d: string | null | undefined, opts: { year?: boolean; weekday?: boolean } = {}) {
  if (!d) return '—';
  const dt = parse(d.slice(0, 10));
  let s = `${dt.getUTCDate()}${NB}${MONTHS[dt.getUTCMonth()]}`;
  if (opts.year) s += ` ${dt.getUTCFullYear()}`;
  if (opts.weekday) s = `${WEEKDAYS[dt.getUTCDay()]}, ${s}`;
  return s;
}
export function fmtShort(d: string) {
  const dt = parse(d.slice(0, 10));
  return `${dt.getUTCDate()}${NB}${MONTHS_SHORT[dt.getUTCMonth()]}`;
}
export function fmtDayTitle(d: string, today: string) {
  const diff = Math.round((parse(d).getTime() - parse(today).getTime()) / 86400000);
  if (diff === 0) return 'Сегодня';
  if (diff === -1) return 'Вчера';
  if (diff === 1) return 'Завтра';
  return fmtDate(d, { weekday: true });
}
/** Часовой пояс пользователя: время показываем по нему, а не по настройкам устройства. */
let userTz: string | undefined;
export function setUserTimezone(tz: string | undefined) { userTz = tz; }

export function fmtDateTime(iso: string | null | undefined, tz?: string) {
  if (!iso) return '—';
  const f = new Intl.DateTimeFormat('ru-RU', { day: 'numeric', month: 'long', hour: '2-digit', minute: '2-digit', timeZone: tz ?? userTz });
  return f.format(new Date(iso)).replace(' в ', ', ');
}
export function fmtTime(iso: string, tz?: string) {
  return new Intl.DateTimeFormat('ru-RU', { hour: '2-digit', minute: '2-digit', timeZone: tz ?? userTz }).format(new Date(iso));
}
export function fmtRelative(iso: string | null) {
  if (!iso) return 'нет активности';
  const diff = Date.now() - new Date(iso).getTime();
  const m = Math.round(diff / 60000);
  if (m < 2) return 'только что';
  if (m < 60) return `${m}${NB}мин назад`;
  const h = Math.round(m / 60);
  if (h < 24) return `${h}${NB}ч назад`;
  const d = Math.round(h / 24);
  if (d === 1) return 'вчера';
  if (d < 30) return `${d}${NB}${plural(d, 'день', 'дня', 'дней')} назад`;
  return fmtDateTime(iso).split(',')[0];
}
export function addDays(date: string, n: number) {
  const t = parse(date); t.setUTCDate(t.getUTCDate() + n); return t.toISOString().slice(0, 10);
}
export function daysBetween(a: string, b: string) {
  return Math.round((parse(b).getTime() - parse(a).getTime()) / 86400000);
}
export function weekdayIdx(d: string) { const w = parse(d).getUTCDay(); return w === 0 ? 7 : w; }

export function plural(n: number, one: string, few: string, many: string) {
  const a = Math.abs(n) % 100, b = a % 10;
  if (a > 10 && a < 20) return many;
  if (b > 1 && b < 5) return few;
  if (b === 1) return one;
  return many;
}

export const num = (v: number | null | undefined, digits = 2) =>
  v == null ? '—' : new Intl.NumberFormat('ru-RU', { maximumFractionDigits: digits }).format(v);
export const pct = (v: number | null) => (v == null ? '—' : `${Math.round(v * 100)}%`);

export const FORM_LABELS: Record<string, string> = {
  capsule: 'Капсулы', tablet: 'Таблетки', softgel: 'Мягкие капсулы', drops: 'Капли', powder: 'Порошок', liquid: 'Жидкость', sachet: 'Саше', other: 'Другое',
};
export const FOOD_LABELS: Record<string, string> = { before: 'до еды', with: 'во время еды', after: 'после еды', any: 'независимо от еды' };
export const PART_LABELS: Record<string, { label: string; time: string }> = {
  morning: { label: 'Утро', time: '08:00' }, day: { label: 'День', time: '13:00' }, evening: { label: 'Вечер', time: '19:00' }, night: { label: 'Перед сном', time: '22:00' },
};
export const SKIP_REASONS: Record<string, string> = { forgot: 'Забыл(а)', ran_out: 'Закончился препарат', felt_unwell: 'Плохое самочувствие', other: 'Другое' };
export const STATE_LABELS: Record<IntakeState, string> = { planned: 'Запланировано', taken: 'Принято', skipped: 'Пропущено', unmarked: 'Не отмечено', cancelled: 'Отменено специалистом' };
export const SCHEME_STATUS: Record<string, string> = { draft: 'Черновик', scheduled: 'Запланирована', active: 'Активна', completed: 'Завершена', cancelled: 'Отменена' };
export const DOC_STATUS: Record<string, string> = { uploaded: 'Загружен', processing: 'Обрабатывается', needs_review: 'Требует проверки', confirmed: 'Подтверждён', error: 'Ошибка обработки' };
export const SYMPTOMS: Record<string, string> = {
  headache: 'Головная боль', nausea: 'Тошнота', stomach: 'Дискомфорт в животе', heartburn: 'Изжога', rash: 'Сыпь, зуд',
  insomnia: 'Трудно уснуть', drowsiness: 'Сонливость', palpitations: 'Сердцебиение', anxiety: 'Тревожность', other: 'Другое',
};
export const LOW_FIELDS: Record<string, string> = { name: 'название', value: 'результат', unit: 'единицы', ref: 'интервал' };

export function slotLabel(slot: string, time: string) {
  return PART_LABELS[slot] ? PART_LABELS[slot].label : time;
}
export function doseLabel(d: Dose) { return d.time ? d.time : PART_LABELS[d.part!]?.label.toLowerCase() ?? ''; }
export function freqLabel(f: Frequency) {
  if (f.type === 'daily') return 'ежедневно';
  if (f.type === 'every_other_day') return 'через день';
  return f.days.map((d) => WD_SHORT[d - 1]).join(', ');
}
export function amountLabel(amount: number | string, unit: string) {
  return `${String(amount).replace('.', ',')}${NB}${unit}`;
}
export function initials(name: string) {
  return name.split(/\s+/).filter(Boolean).slice(0, 2).map((w) => w[0]?.toUpperCase()).join('');
}
export function fileSize(n: number) {
  if (n < 1024 * 1024) return `${Math.max(1, Math.round(n / 1024))}${NB}КБ`;
  return `${(n / 1024 / 1024).toFixed(1).replace('.', ',')}${NB}МБ`;
}
