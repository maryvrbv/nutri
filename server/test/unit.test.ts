import { test } from 'node:test';
import assert from 'node:assert/strict';
import { addDays, inQuietHours, todayIn, weekday, zonedParts, zonedToUtc } from '../src/time.ts';
import { diffVersions, slotsFor, validateVersion, ValidationError } from '../src/schedule.ts';
import { adherenceStats } from '../src/adherence.ts';
import { parseText } from '../src/recognition.ts';
import { explain, toBase, getAnalyte } from '../src/reference.ts';
import { sameperson } from '../src/labs.ts';

test('часовые пояса: локальное время → UTC', () => {
  assert.equal(zonedToUtc('2026-10-16', '20:00', 'Europe/Moscow').toISOString(), '2026-10-16T17:00:00.000Z');
  assert.equal(zonedToUtc('2026-10-16', '20:00', 'Asia/Dubai').toISOString(), '2026-10-16T16:00:00.000Z');
  // Переход на летнее время в Нью-Йорке: 02:30 не существует — сдвигаем вперёд
  const gap = zonedToUtc('2026-03-08', '02:30', 'America/New_York');
  assert.equal(zonedParts(gap.getTime(), 'America/New_York').time, '03:30');
  // Обычные дни до и после перехода
  assert.equal(zonedToUtc('2026-03-07', '09:00', 'America/New_York').toISOString(), '2026-03-07T14:00:00.000Z');
  assert.equal(zonedToUtc('2026-03-09', '09:00', 'America/New_York').toISOString(), '2026-03-09T13:00:00.000Z');
  // Неоднозначное время при переходе на зимнее — первое из двух
  assert.equal(zonedToUtc('2026-11-01', '01:30', 'America/New_York').toISOString(), '2026-11-01T05:30:00.000Z');
  assert.equal(todayIn('Asia/Tokyo', Date.parse('2026-10-16T16:00:00Z')), '2026-10-17');
});

test('даты и тихие часы', () => {
  assert.equal(addDays('2026-12-31', 1), '2027-01-01');
  assert.equal(weekday('2026-10-16'), 5);
  assert.equal(weekday('2026-10-18'), 7);
  assert.ok(inQuietHours('23:00', '22:30', '08:00'));
  assert.ok(inQuietHours('07:59', '22:30', '08:00'));
  assert.ok(!inQuietHours('08:00', '22:30', '08:00'));
  assert.ok(inQuietHours('14:00', '13:00', '15:00'));
  assert.ok(!inQuietHours('12:00', null, null));
});

const item = (over: any = {}) => ({
  name: 'Цинк', form: 'tablet', amount: 1, amount_unit: 'таблетка', doses: [{ time: '09:00' }],
  frequency: { type: 'daily' }, food: 'any', start_date: '2026-10-01', end_date: '2026-10-10', ...over,
});

test('расписание: периодичность и несколько приёмов в день', () => {
  assert.equal(slotsFor(item() as any, '2026-10-01', '2026-10-31').length, 10);
  const eod = slotsFor(item({ frequency: { type: 'every_other_day' } }) as any, '2026-10-02', '2026-10-31');
  assert.deepEqual(eod.map((s) => s.date), ['2026-10-03', '2026-10-05', '2026-10-07', '2026-10-09']);
  const wd = slotsFor(item({ frequency: { type: 'weekdays', days: [6, 7] } }) as any, '2026-10-01', '2026-10-10');
  assert.deepEqual(wd.map((s) => s.date), ['2026-10-03', '2026-10-04', '2026-10-10']);
  const twice = slotsFor(item({ doses: [{ part: 'evening' }, { time: '07:30' }] }) as any, '2026-10-01', '2026-10-01');
  assert.deepEqual(twice.map((s) => [s.slot, s.time_local]), [['07:30', '07:30'], ['evening', '19:00']]);
});

test('схема: проверка полей, этапы и пересечения', () => {
  const base = { title: 'Курс', start_date: '2026-10-01', end_date: '2026-10-30' };
  // Поэтапная смена дозировки — две позиции одной добавки на разных периодах
  const ok = validateVersion({ ...base, items: [item({ end_date: '2026-10-14' }), item({ amount: 2, start_date: '2026-10-15', end_date: '2026-10-30' })] });
  assert.equal(ok.items.length, 2);
  assert.throws(() => validateVersion({ ...base, items: [item(), item({ start_date: '2026-10-05', end_date: '2026-10-20' })] }), ValidationError);
  try {
    validateVersion({ ...base, items: [item({ amount: -1, substance_amount: 50, substance_unit: '', food: 'x', doses: [] })] });
    assert.fail();
  } catch (e) {
    const f = (e as ValidationError).fields;
    assert.ok(f['items.0.amount'] && f['items.0.substance_unit'] && f['items.0.food'] && f['items.0.doses']);
  }
  assert.throws(() => validateVersion({ ...base, items: [item({ end_date: '2026-11-15' })] }), /Позже окончания схемы|Проверьте/);
});

test('сравнение версий показывает, что изменилось', () => {
  const a = [{ ...item(), group_key: 'g1' }, { ...item({ name: 'Йод' }), group_key: 'g2' }] as any;
  const b = [{ ...item({ amount: 2 }), group_key: 'g1' }, { ...item({ name: 'Селен' }), group_key: 'g3' }] as any;
  const d = diffVersions(a, b);
  assert.deepEqual(d.map((c) => [c.kind, c.name]), [['changed', 'Цинк'], ['added', 'Селен'], ['removed', 'Йод']]);
  assert.deepEqual(d[0].fields, [{ field: 'Количество', before: '1 таблетка', after: '2 таблетка' }]);
});

test('статистика выполнения: проценты только по наступившим, без отменённых', () => {
  const s = adherenceStats(['taken', 'taken', 'skipped', 'unmarked', 'planned', 'cancelled']);
  assert.equal(s.past, 4);
  assert.equal(s.adherence, 0.5);
  assert.equal(s.completeness, 0.75);
  assert.equal(s.future, 1);
  assert.equal(s.cancelled, 1);
  assert.equal(adherenceStats(['planned']).adherence, null);
});

test('распознавание русского бланка', () => {
  const r = parseText([
    'ООО «ГЕМОТЕСТ»',
    'Ф.И.О.: Иванова Анна',
    'Дата забора: 03.09.2026',
    'Исследование Результат Ед. изм. Референсные значения',
    'Витамин B12 245 пг/мл 187 - 883',
    'Гемоглобин 128 г/л 117 - 155',
    'ТТГ 5,8 мкМЕ/мл 0,4-4,0 ↑',
  ].join('\n'));
  assert.equal(r.lab, 'Гемотест');
  assert.equal(r.collected_at, '2026-09-03');
  assert.equal(r.patient_name, 'Иванова Анна');
  assert.deepEqual(r.rows.map((x) => [x.analyte_code, x.value_num, x.unit, x.ref_low, x.ref_high]), [
    ['vitamin_b12', 245, 'пг/мл', 187, 883],
    ['hemoglobin', 128, 'г/л', 117, 155],
    ['tsh', 5.8, 'мМЕ/л', 0.4, 4],
  ]);
  assert.equal(r.rows[2].lab_flag, '↑');
});

test('пояснение: без диагноза, с источником, честно про недостаток данных', () => {
  const tsh = explain({ name: 'ТТГ', analyte_code: 'tsh', value_num: 5.8, value_text: '5,8', unit: 'мМЕ/л', ref_low: 0.4, ref_high: 4, ref_text: '0,4–4,0', lab_flag: '↑' });
  assert.equal(tsh.status, 'ok');
  assert.match(tsh.text, /выше верхней границы/);
  assert.match(tsh.text, /не диагноз/);
  assert.ok(tsh.source?.url);
  assert.doesNotMatch(tsh.text, /гипотиреоз|назнач|принимайте/i);
  assert.equal(explain({ name: 'ТТГ', analyte_code: 'tsh', value_num: 2, value_text: '2', unit: 'мМЕ/л', ref_low: null, ref_high: null, ref_text: '', lab_flag: '' }).status, 'insufficient');
  assert.equal(explain({ name: 'Лейкоциты', analyte_code: null, value_num: 6, value_text: '6', unit: '', ref_low: 4, ref_high: 9, ref_text: '', lab_flag: '' }).status, 'insufficient');
});

test('перевод единиц — только по проверенным правилам', () => {
  const d = getAnalyte('vitamin_d');
  assert.equal(Math.round(toBase(d, 75, 'нмоль/л')!.value * 10) / 10, 30);
  assert.equal(toBase(d, 30, 'мг/л'), null);
  assert.equal(toBase(undefined, 1, 'нг/мл'), null);
});

test('сверка ФИО в документе', () => {
  assert.ok(sameperson('Анна Иванова', 'Иванова Анна Сергеевна'));
  assert.ok(sameperson('Анна', 'ИВАНОВА АННА'));
  assert.ok(!sameperson('Анна Иванова', 'Петрова Мария'));
  assert.ok(sameperson('Анна Иванова', null));
});

test('бланк Инвитро: интервал «см. комм.» не путается с числами из комментария', async () => {
  const { parseText } = await import('../src/recognition.ts');
  const r = parseText(['Пол: Жен', 'Дата рождения: 01.10.1993', 'Дата взятия образца: 14.10.2026 12:32',
    'Ферритин 58 мкг/л 15 - 204 Рекомендуемые значения', 'Витамин 25(OH) D 25.0* нг/мл см.комм. < 10 нг/мл - выраженный дефицит;'].join('\n'));
  assert.equal(r.sex, 'female');
  assert.equal(r.birth_date, '1993-10-01');
  assert.equal(r.collected_at, '2026-10-14');
  const d = r.rows.find((x) => x.analyte_code === 'vitamin_d')!;
  assert.equal(d.value_num, 25);
  assert.equal(d.ref_high, null);
  assert.equal(d.lab_flag, '*');
});

test('справочные интервалы: по полу, в единицах результата', async () => {
  const { referenceRange } = await import('../src/reference.ts');
  assert.deepEqual((referenceRange('ferritin', 'мкг/л', { sex: 'male' }) as any).low, 30);
  assert.ok('missing' in (referenceRange('ferritin', 'нг/мл', {}) as any));
  const d = referenceRange('vitamin_d', 'нмоль/л', {}) as any;
  assert.equal(Math.round(d.low), 75);
  assert.equal(referenceRange('ferritin', 'нг/мл', { sex: 'female', birth_date: '2015-01-01' }, '2026-10-14'), null, 'для детей не подставляем');
  assert.equal(referenceRange('crp', 'мг/л', {}), null);
});

test('фото бланка: значение на красной заливке и единицы, искажённые OCR', async (t) => {
  const { builtinRecognizer, hasOcr } = await import('../src/recognition.ts');
  if (!(await hasOcr())) return t.skip('Tesseract не установлен');
  const { readFileSync } = await import('node:fs');
  const r = await builtinRecognizer.recognize(readFileSync(new URL('../../samples/blank-invitro-red-cell.jpg', import.meta.url)), 'image/jpeg');
  const d = r.rows.find((x) => x.analyte_code === 'vitamin_d');
  assert.ok(d, 'витамин D найден');
  assert.equal(d!.value_num, 25);
  assert.equal(d!.unit, 'нг/мл');
  assert.equal(d!.ref_text, '', 'числа из комментария не стали интервалом');
  assert.equal(r.rows.find((x) => x.analyte_code === 'ferritin')?.value_num, 58);
});

test('единицы после OCR приводятся к правильным', async () => {
  const { normalizeUnit } = await import('../src/reference.ts');
  assert.equal(normalizeUnit('Hr/Mn'), 'нг/мл');
  assert.equal(normalizeUnit('мкг/п'), 'мкг/л');
  assert.equal(normalizeUnit('ng/ml'), 'нг/мл');
});

test('общий анализ крови: названия с точками и «%», счётные единицы', () => {
  const r = parseText(['MCV (ср. объем эритр.) 91.0 фл 81 - 100', 'Тромбоциты 287 тыс/мкл 150 - 400',
    'Нейтрофилы (общ.число), 51.9 % 48 - 78', 'Базофилы, абс. 0.02 тыс/мкл < 0.2', 'АсАТ 15 Ед/л < 31',
    'выявленных заболеваний, <70 мкг/л'].join('\n'));
  assert.deepEqual(r.rows.map((x) => [x.name, x.value_num, x.unit, x.ref_text]), [
    ['MCV (ср. объем эритр.)', 91, 'фл', '81–100'],
    ['Тромбоциты', 287, 'тыс/мкл', '150–400'],
    ['Нейтрофилы (общ.число)', 51.9, '%', '48–78'],
    ['Базофилы, абс.', 0.02, 'тыс/мкл', '< 0.2'],
    ['АсАТ', 15, 'Ед/л', '< 31'],
  ]);
});
