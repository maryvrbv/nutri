import { addDays, daysBetween, isDate, isTime, weekday } from './time.ts';

export const DAY_PARTS = {
  morning: { label: 'утро', time: '08:00' },
  day: { label: 'день', time: '13:00' },
  evening: { label: 'вечер', time: '19:00' },
  night: { label: 'перед сном', time: '22:00' },
} as const;
export type DayPart = keyof typeof DAY_PARTS;

export const FORMS = ['capsule', 'tablet', 'drops', 'powder', 'liquid', 'softgel', 'sachet', 'other'] as const;
export const FOOD = ['before', 'with', 'after', 'any'] as const;
export type Food = (typeof FOOD)[number];

export type Dose = { time?: string; part?: DayPart };
export type Frequency =
  | { type: 'daily' }
  | { type: 'weekdays'; days: number[] }
  | { type: 'every_other_day' };

export type ItemInput = {
  group_key?: string;
  name: string;
  product?: string;
  form: string;
  amount: number;
  amount_unit: string;
  substance_amount?: number | null;
  substance_unit?: string | null;
  doses: Dose[];
  frequency: Frequency;
  food: Food;
  start_date: string;
  end_date: string;
  instruction?: string;
};

export type VersionInput = {
  title: string;
  comment?: string;
  start_date: string;
  end_date: string;
  control_date?: string | null;
  items: ItemInput[];
};

export type Slot = { date: string; slot: string; time_local: string };

/** Ключ слота: точное время либо часть дня. */
export function doseSlot(d: Dose): { slot: string; time: string } {
  if (d.time) return { slot: d.time, time: d.time };
  const part = DAY_PARTS[d.part as DayPart];
  return { slot: d.part as string, time: part.time };
}

function occursOn(item: Pick<ItemInput, 'frequency' | 'start_date'>, date: string): boolean {
  const f = item.frequency;
  if (f.type === 'daily') return true;
  if (f.type === 'weekdays') return f.days.includes(weekday(date));
  if (f.type === 'every_other_day') return daysBetween(item.start_date, date) % 2 === 0;
  return false;
}

export const MAX_COURSE_DAYS = 366;

/** Все приёмы позиции в интервале [from, to] (обе границы включительно). */
export function slotsFor(item: ItemInput, from: string, to: string): Slot[] {
  const start = item.start_date > from ? item.start_date : from;
  const end = item.end_date < to ? item.end_date : to;
  const out: Slot[] = [];
  if (start > end) return out;
  const doses = [...item.doses].map(doseSlot).sort((a, b) => a.time.localeCompare(b.time));
  for (let d = start, i = 0; d <= end && i <= MAX_COURSE_DAYS; d = addDays(d, 1), i++) {
    if (!occursOn(item, d)) continue;
    for (const ds of doses) out.push({ date: d, slot: ds.slot, time_local: ds.time });
  }
  return out;
}

export class ValidationError extends Error {
  fields: Record<string, string>;
  constructor(fields: Record<string, string>) {
    super(Object.values(fields)[0] ?? 'Проверьте данные');
    this.fields = fields;
  }
}

const num = (v: unknown) => typeof v === 'number' && Number.isFinite(v);

/** Проверка версии схемы. Возвращает нормализованную копию или бросает ValidationError. */
export function validateVersion(v: any): VersionInput {
  const e: Record<string, string> = {};
  const title = String(v?.title ?? '').trim();
  if (!title) e.title = 'Укажите название схемы';
  if (!isDate(v?.start_date)) e.start_date = 'Укажите дату начала';
  if (!isDate(v?.end_date)) e.end_date = 'Укажите дату окончания или длительность';
  if (isDate(v?.start_date) && isDate(v?.end_date)) {
    if (v.end_date < v.start_date) e.end_date = 'Окончание раньше начала';
    else if (daysBetween(v.start_date, v.end_date) > MAX_COURSE_DAYS) e.end_date = 'Курс длиннее года — разбейте на этапы';
  }
  if (v?.control_date != null && v.control_date !== '' && !isDate(v.control_date)) e.control_date = 'Неверная дата';
  const items: ItemInput[] = [];
  if (!Array.isArray(v?.items) || v.items.length === 0) e.items = 'Добавьте хотя бы одну позицию';
  (Array.isArray(v?.items) ? v.items : []).forEach((it: any, i: number) => {
    const p = `items.${i}.`;
    const name = String(it?.name ?? '').trim();
    if (!name) e[p + 'name'] = 'Укажите название БАДа';
    if (!FORMS.includes(it?.form)) e[p + 'form'] = 'Выберите форму выпуска';
    if (!num(it?.amount) || it.amount <= 0) e[p + 'amount'] = 'Укажите количество на приём';
    if (!String(it?.amount_unit ?? '').trim()) e[p + 'amount_unit'] = 'Укажите единицу';
    const hasSub = it?.substance_amount != null && it.substance_amount !== '';
    if (hasSub && (!num(it.substance_amount) || it.substance_amount <= 0)) e[p + 'substance_amount'] = 'Неверное значение';
    if (hasSub && !String(it?.substance_unit ?? '').trim()) e[p + 'substance_unit'] = 'Укажите единицу вещества';
    if (!Array.isArray(it?.doses) || it.doses.length === 0) e[p + 'doses'] = 'Добавьте время приёма';
    const doses: Dose[] = [];
    const seen = new Set<string>();
    for (const d of Array.isArray(it?.doses) ? it.doses : []) {
      if (d?.time && isTime(d.time)) doses.push({ time: d.time });
      else if (d?.part && d.part in DAY_PARTS) doses.push({ part: d.part });
      else { e[p + 'doses'] = 'Неверное время приёма'; continue; }
      const k = doseSlot(doses[doses.length - 1]).slot;
      if (seen.has(k)) e[p + 'doses'] = 'Время приёма повторяется';
      seen.add(k);
    }
    let frequency: Frequency = { type: 'daily' };
    const f = it?.frequency;
    if (f?.type === 'weekdays') {
      const days = Array.isArray(f.days) ? [...new Set(f.days.filter((x: any) => Number.isInteger(x) && x >= 1 && x <= 7))].sort() as number[] : [];
      if (days.length === 0) e[p + 'frequency'] = 'Выберите дни недели';
      frequency = { type: 'weekdays', days };
    } else if (f?.type === 'every_other_day') frequency = { type: 'every_other_day' };
    else if (f?.type !== 'daily') e[p + 'frequency'] = 'Выберите периодичность';
    if (!FOOD.includes(it?.food)) e[p + 'food'] = 'Укажите связь с едой';
    const start = it?.start_date || v?.start_date;
    const end = it?.end_date || v?.end_date;
    if (!isDate(start)) e[p + 'start_date'] = 'Неверная дата начала';
    if (!isDate(end)) e[p + 'end_date'] = 'Неверная дата окончания';
    if (isDate(start) && isDate(end)) {
      if (end < start) e[p + 'end_date'] = 'Окончание раньше начала';
      if (isDate(v?.start_date) && start < v.start_date) e[p + 'start_date'] = 'Раньше начала схемы';
      if (isDate(v?.end_date) && end > v.end_date) e[p + 'end_date'] = 'Позже окончания схемы';
    }
    items.push({
      group_key: typeof it?.group_key === 'string' && it.group_key ? it.group_key : undefined,
      name,
      product: String(it?.product ?? '').trim(),
      form: it?.form,
      amount: Number(it?.amount),
      amount_unit: String(it?.amount_unit ?? '').trim(),
      substance_amount: hasSub ? Number(it.substance_amount) : null,
      substance_unit: hasSub ? String(it.substance_unit).trim() : null,
      doses,
      frequency,
      food: it?.food,
      start_date: start,
      end_date: end,
      instruction: String(it?.instruction ?? '').trim(),
    });
  });
  // Одна и та же добавка с пересекающимися этапами в одно время — вероятная ошибка.
  for (let i = 0; i < items.length; i++) for (let j = i + 1; j < items.length; j++) {
    const a = items[i], b = items[j];
    if (a.name.toLowerCase() !== b.name.toLowerCase() || a.product !== b.product) continue;
    if (a.end_date < b.start_date || b.end_date < a.start_date) continue;
    const sa = new Set(a.doses.map((d) => doseSlot(d).slot));
    if (b.doses.some((d) => sa.has(doseSlot(d).slot))) e[`items.${j}.doses`] = 'Этот приём пересекается с другим этапом той же добавки';
  }
  if (Object.keys(e).length) throw new ValidationError(e);
  return {
    title,
    comment: String(v?.comment ?? '').trim(),
    start_date: v.start_date,
    end_date: v.end_date,
    control_date: v.control_date || null,
    items,
  };
}

// ---------- Сравнение версий: что изменилось для клиента ----------

export type ItemChange = { kind: 'added' | 'removed' | 'changed'; name: string; fields?: { field: string; before: string; after: string }[] };

const FORM_LABEL: Record<string, string> = {
  capsule: 'капсулы', tablet: 'таблетки', drops: 'капли', powder: 'порошок', liquid: 'жидкость', softgel: 'мягкие капсулы', sachet: 'саше', other: 'другое',
};
const FOOD_LABEL: Record<Food, string> = { before: 'до еды', with: 'во время еды', after: 'после еды', any: 'независимо от еды' };
const WD = ['', 'пн', 'вт', 'ср', 'чт', 'пт', 'сб', 'вс'];

export function describeDoses(doses: Dose[]) {
  return doses.map((d) => (d.time ? d.time : DAY_PARTS[d.part as DayPart].label)).join(', ');
}
export function describeFrequency(f: Frequency) {
  if (f.type === 'daily') return 'ежедневно';
  if (f.type === 'every_other_day') return 'через день';
  return f.days.map((d) => WD[d]).join(', ');
}
export function describeAmount(i: Pick<ItemInput, 'amount' | 'amount_unit'>) {
  return `${String(i.amount).replace('.', ',')} ${i.amount_unit}`;
}
export function describeSubstance(i: Pick<ItemInput, 'substance_amount' | 'substance_unit'>) {
  return i.substance_amount ? `${String(i.substance_amount).replace('.', ',')} ${i.substance_unit}` : '—';
}

export function diffVersions(prev: ItemInput[], next: ItemInput[]): ItemChange[] {
  const out: ItemChange[] = [];
  const byKey = (list: ItemInput[]) => new Map(list.map((i) => [i.group_key!, i]));
  const a = byKey(prev), b = byKey(next);
  for (const [k, n] of b) {
    const p = a.get(k);
    if (!p) { out.push({ kind: 'added', name: n.name }); continue; }
    const fields: { field: string; before: string; after: string }[] = [];
    const cmp = (field: string, x: string, y: string) => { if (x !== y) fields.push({ field, before: x, after: y }); };
    cmp('Название', p.name, n.name);
    cmp('Продукт', p.product || '—', n.product || '—');
    cmp('Форма', FORM_LABEL[p.form] ?? p.form, FORM_LABEL[n.form] ?? n.form);
    cmp('Количество', describeAmount(p), describeAmount(n));
    cmp('Действующее вещество', describeSubstance(p), describeSubstance(n));
    cmp('Время', describeDoses(p.doses), describeDoses(n.doses));
    cmp('Периодичность', describeFrequency(p.frequency), describeFrequency(n.frequency));
    cmp('Связь с едой', FOOD_LABEL[p.food], FOOD_LABEL[n.food]);
    cmp('Период', `${p.start_date} — ${p.end_date}`, `${n.start_date} — ${n.end_date}`);
    cmp('Инструкция', p.instruction || '—', n.instruction || '—');
    if (fields.length) out.push({ kind: 'changed', name: n.name, fields });
  }
  for (const [k, p] of a) if (!b.has(k)) out.push({ kind: 'removed', name: p.name });
  return out;
}
