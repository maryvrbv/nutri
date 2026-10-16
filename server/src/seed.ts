// Демо-данные: специалист, два клиента, курс с историей отметок, версия схемы, анализы и дневник.
// Запуск: npm run seed (добавьте -- --reset, чтобы пересоздать базу).
import { existsSync, readFileSync, rmSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { openDb, run, get } from './db.ts';
import { FileStore, clock, id, nowIso, type User } from './core.ts';
import { register } from './auth.ts';
import { createInvitation, acceptInvitation } from './care.ts';
import { createDraft, publish, startNewVersion, updateDraft, versionItems, draftVersion } from './schemes.ts';
import { intakesForDay, mark } from './intakes.ts';
import { upload, processDocument, confirmDocument } from './labs.ts';
import { builtinRecognizer } from './recognition.ts';
import { addDays, todayIn, zonedToUtc } from './time.ts';

const root = resolve(import.meta.dirname, '../..');
const dataDir = process.env.NUTRI_DATA_DIR ?? join(root, 'data');
const dbFile = join(dataDir, 'nutri.db');
if (existsSync(dbFile)) {
  if (!process.argv.includes('--reset')) { console.error('База уже есть. Запустите с --reset, чтобы пересоздать.'); process.exit(1); }
  rmSync(dataDir, { recursive: true, force: true });
}
const db = openDb(dbFile);
const files = new FileStore(join(dataDir, 'files'), process.env.NUTRI_FILE_KEY);
const TZ = 'Europe/Moscow';
const realNow = Date.now();
const today = todayIn(TZ, realNow);
const at = (date: string, time: string) => { clock.now = () => zonedToUtc(date, time, TZ).getTime(); };

// Простой детерминированный генератор, чтобы демо было одинаковым
let seed = 7;
const rnd = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);

const PASSWORD = 'demo12345';
const spec = register(db, { email: 'elena@demo.nutri', password: PASSWORD, name: 'Елена Смирнова', role: 'specialist', title: 'Нутрициолог', timezone: TZ });
const anna = register(db, { email: 'anna@demo.nutri', password: PASSWORD, name: 'Анна Иванова', role: 'client', timezone: TZ });
const dima = register(db, { email: 'dmitry@demo.nutri', password: PASSWORD, name: 'Дмитрий Орлов', role: 'client', timezone: 'Asia/Dubai' });

const start = addDays(today, -12);
at(addDays(start, -1), '12:00');
for (const c of [anna, dima]) acceptInvitation(db, c, createInvitation(db, spec, c.name).token, false);
// Ещё одно приглашение ждёт ответа
createInvitation(db, spec, 'Ольга, консультация в пятницу');

// Анализ до начала курса
async function addLab(owner: User, by: User, file: string, when: string) {
  at(when, '10:00');
  const docId = upload(db, files, by, owner.id, { file: readFileSync(join(root, 'samples', file)), file_name: file });
  await processDocument(db, files, builtinRecognizer, docId);
  return docId;
}
const d1 = await addLab(anna, anna, 'blank-invitro-2026-09.pdf', addDays(start, -10));
confirmDocument(db, anna, d1);

// Схема
at(addDays(start, -1), '18:00');
const scheme = {
  title: 'Восполнение железа и витамина D',
  comment: 'Цель — поднять ферритин и витамин D. Через месяц пересдаём ферритин, витамин D и B12. Если появится дискомфорт в животе — отметьте в дневнике.',
  start_date: start,
  end_date: addDays(start, 41),
  control_date: addDays(start, 44),
  items: [
    { name: 'Железо', product: 'Железа бисглицинат', form: 'capsule', amount: 1, amount_unit: 'капсула', substance_amount: 25, substance_unit: 'мг',
      doses: [{ time: '10:30' }], frequency: { type: 'every_other_day' }, food: 'before', start_date: start, end_date: addDays(start, 13),
      instruction: 'За 30 минут до еды, запить водой. Не сочетать с кофе и чаем в течение 2 часов.' },
    { name: 'Железо', product: 'Железа бисглицинат', form: 'capsule', amount: 1, amount_unit: 'капсула', substance_amount: 25, substance_unit: 'мг',
      doses: [{ time: '10:30' }], frequency: { type: 'daily' }, food: 'before', start_date: addDays(start, 14), end_date: addDays(start, 41),
      instruction: 'Со второго этапа — каждый день' },
    { name: 'Витамин D3', product: 'Холекальциферол в масле', form: 'drops', amount: 4, amount_unit: 'капли', substance_amount: 2000, substance_unit: 'МЕ',
      doses: [{ time: '09:00' }], frequency: { type: 'daily' }, food: 'with', start_date: start, end_date: addDays(start, 41), instruction: 'Во время завтрака' },
    { name: 'Магний', product: 'Магния цитрат', form: 'capsule', amount: 2, amount_unit: 'капсулы', substance_amount: 200, substance_unit: 'мг',
      doses: [{ time: '21:00' }], frequency: { type: 'daily' }, food: 'after', start_date: start, end_date: addDays(start, 41), instruction: 'После ужина' },
    { name: 'Омега-3', product: '', form: 'softgel', amount: 1, amount_unit: 'капсула', substance_amount: 1000, substance_unit: 'мг',
      doses: [{ part: 'morning' }, { part: 'evening' }], frequency: { type: 'weekdays', days: [1, 2, 3, 4, 5] }, food: 'with', start_date: start, end_date: addDays(start, 41) },
  ],
};
const { scheme_id } = createDraft(db, spec, anna.id, scheme);
publish(db, spec, scheme_id);

// Отметки за прошедшие дни
const reasons = ['forgot', 'forgot', 'ran_out', 'felt_unwell', undefined];
function simulateDay(date: string, uptoTime = '23:59') {
  at(date, '23:30');
  const list = intakesForDay(db, anna.id, date).filter((i) => i.state !== 'cancelled' && i.time_local <= uptoTime);
  for (const i of list) {
    const r = rnd();
    at(date, i.time_local);
    const t = clock.now() + Math.round(rnd() * 40) * 60_000;
    clock.now = () => t;
    if (r < 0.8) mark(db, anna, anna.id, { planned_ids: [i.id], status: 'taken', request_id: id() });
    else if (r < 0.9) mark(db, anna, anna.id, { planned_ids: [i.id], status: 'skipped', reason: reasons[Math.floor(rnd() * reasons.length)], request_id: id() });
  }
}
for (let d = start; d < addDays(today, -4); d = addDays(d, 1)) simulateDay(d);

// Новая версия: магний вечером увеличен, добавлено время для D3
at(addDays(today, -4), '08:00');
startNewVersion(db, spec, scheme_id);
const draft = draftVersion(db, scheme_id)!;
const items = versionItems(db, draft.id).map((it) => (it.name === 'Магний' ? { ...it, amount: 3, substance_amount: 300, instruction: 'После ужина. Дозировку увеличили: сон пока не наладился' } : it));
updateDraft(db, spec, scheme_id, { ...draft, items });
publish(db, spec, scheme_id, { effective_from: addDays(today, -4) });
for (let d = addDays(today, -4); d < today; d = addDays(d, 1)) simulateDay(d);
// Сегодня отмечены утренние приёмы
simulateDay(today, '09:00');

// Дневник
for (let d = start; d <= today; d = addDays(d, 1)) {
  if (rnd() < 0.3) continue;
  const k = Math.min(1, (Date.parse(d) - Date.parse(start)) / (Date.parse(today) - Date.parse(start)));
  const s = (base: number) => Math.max(1, Math.min(5, Math.round(base + k * 1.5 + (rnd() - 0.5) * 1.5)));
  const adverse = d === addDays(start, 3);
  at(d, '22:00');
  run(db, `INSERT INTO wellbeing (id, client_id, date, energy, sleep, overall, symptoms, adverse, comment, updated_at) VALUES (?,?,?,?,?,?,?,?,?,?)`,
    id(), anna.id, d, s(2.5), s(2), s(3), JSON.stringify(adverse ? ['stomach', 'nausea'] : rnd() < 0.15 ? ['headache'] : []), adverse ? 1 : 0,
    adverse ? 'После железа на голодный желудок немного подташнивало' : d === addDays(today, -2) ? 'Сплю заметно лучше' : '', nowIso());
}

// Свежий анализ: распознан и подтверждён клиентом
const d2 = await addLab(anna, anna, 'blank-invitro-2026-10.pdf', addDays(today, -1));
at(addDays(today, -1), '10:05');
confirmDocument(db, anna, d2);

// Комментарий специалиста и внутренняя заметка
at(addDays(today, -1), '19:00');
run(db, 'INSERT INTO comments (id, client_id, author_id, kind, target_type, target_id, body, created_at) VALUES (?,?,?,?,?,?,?,?)',
  id(), anna.id, spec.id, 'conclusion', 'analyte', 'ferritin', 'Ферритин подрос с 14 до 21 — движемся в нужную сторону. Продолжаем по схеме, через месяц пересдадим.', nowIso());
run(db, 'INSERT INTO comments (id, client_id, author_id, kind, target_type, target_id, body, created_at) VALUES (?,?,?,?,?,?,?,?)',
  id(), anna.id, spec.id, 'internal', 'analyte', 'ferritin', 'Если к контролю будет ниже 30 — обсудить очную консультацию у терапевта.', nowIso());
run(db, `INSERT INTO notifications (id, user_id, kind, title, body, public_title, link, created_at) VALUES (?,?,?,?,?,?,?,?)`,
  id(), anna.id, 'comment', 'Елена Смирнова оставила комментарий к анализам', 'Ферритин подрос с 14 до 21 — движемся в нужную сторону…', 'Новое сообщение от специалиста', '/labs/analyte/ferritin', nowIso());

// Самостоятельный приём
run(db, 'INSERT INTO self_supplements (id, client_id, name, amount, schedule, start_date, note, created_at) VALUES (?,?,?,?,?,?,?,?)',
  id(), anna.id, 'Витамин C', '500 мг', 'утром', addDays(today, -30), 'Пью с осени, по совету подруги', nowIso());

// У второго клиента — новый неподтверждённый анализ
const d3 = await addLab(dima, dima, 'blank-invitro-2026-10.pdf', today);
void d3; // ФИО в бланке не совпадает — пример проверки принадлежности

clock.now = () => realNow;
const n = get<{ n: number }>(db, 'SELECT COUNT(*) AS n FROM intake_marks')!.n;
console.log(`Готово. Отметок: ${n}. Вход:\n  специалист  elena@demo.nutri / ${PASSWORD}\n  клиент      anna@demo.nutri / ${PASSWORD}\n  клиент      dmitry@demo.nutri / ${PASSWORD}`);
