// Критерии приёмки первой версии (ТЗ, раздел 13) — сквозные сценарии через HTTP API.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { agent, makePdf, resetNow, setNow, startTestServer, waitFor } from './helpers.ts';
import { tick } from '../src/reminders.ts';
import { all } from '../src/db.ts';

let srv: Awaited<ReturnType<typeof startTestServer>>;
const sp = () => agent(srv.base);
let specialist: ReturnType<typeof agent>;
let client: ReturnType<typeof agent>;
let clientId = '';
let schemeId = '';

const scheme = {
  title: 'Поддержка запасов железа и витамина D',
  comment: 'Через месяц пересдаём ферритин',
  start_date: '2026-10-16',
  end_date: '2026-10-29',
  control_date: '2026-11-05',
  items: [
    { name: 'Магний', product: 'Магний цитрат', form: 'capsule', amount: 2, amount_unit: 'капсулы', substance_amount: 200, substance_unit: 'мг',
      doses: [{ time: '20:00' }], frequency: { type: 'daily' }, food: 'after', instruction: 'После ужина, запить водой' },
    { name: 'Витамин D3', form: 'capsule', amount: 1, amount_unit: 'капсула', substance_amount: 2000, substance_unit: 'МЕ',
      doses: [{ time: '09:00' }], frequency: { type: 'daily' }, food: 'with' },
    { name: 'Омега-3', form: 'softgel', amount: 1, amount_unit: 'капсула', doses: [{ part: 'morning' }, { part: 'evening' }],
      frequency: { type: 'weekdays', days: [1, 2, 3, 4, 5] }, food: 'with' },
  ],
};

before(async () => {
  srv = await startTestServer();
  setNow('2026-10-16T09:00:00Z'); // пятница, 12:00 по Москве
  specialist = sp();
  client = sp();
});
after(async () => { resetNow(); await srv.close(); });

test('1. Специалист приглашает клиента, клиент подтверждает доступ', async () => {
  const r1 = await specialist.post('/api/auth/register', { email: 'doc@example.com', password: 'password123', name: 'Елена Смирнова', role: 'specialist', title: 'Нутрициолог' });
  assert.equal(r1.status, 200);
  const inv = await specialist.post('/api/invitations', { client_hint: 'Анна' });
  assert.equal(inv.status, 200);
  const tokenStr = inv.body.token;

  const r2 = await client.post('/api/auth/register', { email: 'anna@example.com', password: 'password123', name: 'Анна Иванова', timezone: 'Europe/Moscow' });
  clientId = r2.body.id;

  // До подтверждения доступа нет
  assert.equal((await specialist.get(`/api/clients/${clientId}/summary`)).status, 404);
  const preview = await client.get(`/api/invite/${tokenStr}`);
  assert.equal(preview.body.state, 'valid');
  assert.equal(preview.body.specialist_name, 'Елена Смирнова');
  assert.ok(preview.body.scopes.length >= 4);
  assert.equal((await specialist.get(`/api/clients/${clientId}/summary`)).status, 404);

  const acc = await client.post(`/api/invite/${tokenStr}/accept`);
  assert.equal(acc.status, 200);
  assert.equal(acc.body.active.specialist_name, 'Елена Смирнова');
  // Повторно ссылкой воспользоваться нельзя
  assert.equal((await client.post(`/api/invite/${tokenStr}/accept`)).status, 410);

  const list = await specialist.get('/api/clients');
  assert.equal(list.body.length, 1);
  assert.equal(list.body[0].name, 'Анна Иванова');
  assert.equal((await specialist.get(`/api/clients/${clientId}/summary`)).status, 200);
});

test('Приглашение с истёкшим сроком не даёт доступа', async () => {
  const inv = await specialist.post('/api/invitations', {});
  setNow('2026-10-24T09:00:00Z');
  const other = sp();
  await other.post('/api/auth/register', { email: 'late@example.com', password: 'password123', name: 'Пётр' });
  const r = await other.post(`/api/invite/${inv.body.token}/accept`);
  assert.equal(r.status, 410);
  setNow('2026-10-16T09:00:00Z');
});

test('2. Специалист создаёт и публикует схему с несколькими БАДами', async () => {
  const bad = await specialist.post(`/api/clients/${clientId}/schemes`, { ...scheme, items: [{ ...scheme.items[0], amount: 0 }] });
  assert.equal(bad.status, 400);
  assert.ok(bad.body.fields['items.0.amount']);

  const d = await specialist.post(`/api/clients/${clientId}/schemes`, scheme);
  assert.equal(d.status, 200);
  schemeId = d.body.scheme_id;

  // Черновик клиенту не виден
  assert.equal((await client.get('/api/clients/me/schemes')).body.length, 0);
  assert.equal((await client.get(`/api/schemes/${schemeId}`)).status, 404);

  const prev = await specialist.post('/api/schemes/preview', { version: scheme, days: 3 });
  assert.equal(prev.status, 200);
  assert.equal(prev.body[0].date, '2026-10-16');
  assert.deepEqual(prev.body[0].groups.map((g: any) => g.time), ['08:00', '09:00', '19:00', '20:00']);

  const pub = await specialist.post(`/api/schemes/${schemeId}/publish`);
  assert.equal(pub.status, 200);
  assert.ok(pub.body.intakes > 30);
  assert.equal(pub.body.scheme.status, 'active');

  const notes = await client.get('/api/notifications');
  assert.ok(notes.body.items.some((n: any) => n.kind === 'scheme_new'));
});

test('3. Клиент видит расписание на сегодня и отмечает приём', async () => {
  const t = await client.get('/api/clients/me/today');
  assert.equal(t.body.date, '2026-10-16');
  const items = t.body.intakes;
  assert.deepEqual(items.map((i: any) => [i.time_local, i.name]), [
    ['08:00', 'Омега-3'], ['09:00', 'Витамин D3'], ['19:00', 'Омега-3'], ['20:00', 'Магний'],
  ]);
  // 09:00 МСК уже прошло — без отметки это «не отмечено», а не пропуск
  assert.equal(items[1].state, 'unmarked');
  assert.equal(items[3].state, 'planned');
  assert.equal(items[3].amount, 2);
  assert.equal(items[3].substance_amount, 200);

  const ids = [items[0].id, items[1].id];
  const m = await client.post('/api/clients/me/intakes/mark', { planned_ids: ids, status: 'taken', request_id: 'req-1' });
  assert.equal(m.status, 200);
  assert.equal(m.body.length, 2);
  // Повторное нажатие не создаёт дублей
  const again = await client.post('/api/clients/me/intakes/mark', { planned_ids: ids, status: 'taken', request_id: 'req-1' });
  assert.ok(again.body.every((x: any) => x.duplicate));
  const hist = all(srv.db, 'SELECT * FROM mark_history WHERE planned_id IN (?, ?)', ...ids);
  assert.equal(hist.length, 2);

  // Специалист не может отмечать за клиента
  assert.equal((await specialist.post(`/api/clients/${clientId}/intakes/mark`, { planned_ids: [items[3].id], status: 'taken', request_id: 'x' })).status, 403);
  // Будущий день отметить нельзя
  const tomorrow = await client.get('/api/clients/me/today?date=2026-10-17');
  assert.equal(tomorrow.body.intakes.length, 2, 'суббота — омега-3 только по будням');
  assert.equal((await client.post('/api/clients/me/intakes/mark', { planned_ids: [tomorrow.body.intakes[0].id], status: 'taken', request_id: 'r2' })).status, 400);
});

test('4. Специалист видит отметки в карточке клиента', async () => {
  const s = await specialist.get(`/api/clients/${clientId}/summary?days=1`);
  assert.equal(s.body.adherence.taken, 2);
  assert.equal(s.body.adherence.past, 2);
  assert.equal(s.body.adherence.future, 2);
  const h = await specialist.get(`/api/clients/${clientId}/intakes?from=2026-10-16&to=2026-10-16`);
  assert.equal(h.body.items.filter((i: any) => i.state === 'taken').length, 2);
});

test('5. Изменение схемы не меняет историю предыдущих приёмов', async () => {
  setNow('2026-10-16T17:30:00Z'); // 20:30 МСК
  const t = await client.get('/api/clients/me/today');
  const mg = t.body.intakes.find((i: any) => i.name === 'Магний');
  await client.post('/api/clients/me/intakes/mark', { planned_ids: [mg.id], status: 'taken', request_id: 'req-mg' });

  const v = await specialist.post(`/api/schemes/${schemeId}/versions`);
  assert.equal(v.status, 200);
  const draft = v.body.draft;
  const items = draft.items.map((it: any) => (it.name === 'Магний' ? { ...it, amount: 3, amount_unit: 'капсулы', instruction: 'Во время ужина' } : it));
  const upd = await specialist.put(`/api/schemes/${schemeId}/draft`, { ...draft, items });
  assert.equal(upd.status, 200);
  assert.equal((await specialist.post(`/api/schemes/${schemeId}/publish`, { effective_from: '2026-10-15' })).status, 400);
  const pub = await specialist.post(`/api/schemes/${schemeId}/publish`, { effective_from: '2026-10-16' });
  assert.equal(pub.status, 200);
  assert.ok(pub.body.changes.some((c: any) => c.kind === 'changed' && c.fields.some((f: any) => f.field === 'Количество')));

  const today = await client.get('/api/clients/me/today');
  const mgToday = today.body.intakes.filter((i: any) => i.name === 'Магний');
  assert.equal(mgToday.length, 1, 'отмеченный приём не задваивается');
  assert.equal(mgToday[0].amount, 2, 'прошлая отметка связана с прежней дозировкой');
  assert.equal(mgToday[0].version_number, 1);
  assert.equal(mgToday[0].state, 'taken');
  const tomorrow = await client.get('/api/clients/me/today?date=2026-10-17');
  const mgTomorrow = tomorrow.body.intakes.find((i: any) => i.name === 'Магний');
  assert.equal(mgTomorrow.amount, 3);
  assert.equal(mgTomorrow.version_number, 2);

  const view = await client.get(`/api/schemes/${schemeId}`);
  assert.equal(view.body.current.number, 2);
  assert.equal(view.body.current.effective_from, '2026-10-16');
  assert.ok((await client.get('/api/notifications')).body.items.some((n: any) => n.kind === 'scheme_updated'));
});

let docId = '';

test('6–7. Клиент загружает анализ, проверяет значения, подтверждённый результат попадает в динамику', async () => {
  const pdf = makePdf([
    'INVITRO laboratory',
    'Date of collection: 10.10.2026',
    'Ferritin 18.4 ng/ml 13 - 150 L',
    'Vitamin D 22.5 ng/ml 30 - 100',
    'Magnesium 0.78 mmol/l 0.66 - 1.07',
  ]);
  const up = await client.raw('POST', '/api/clients/me/documents?name=invitro.pdf', pdf, { 'content-type': 'application/pdf' });
  assert.equal(up.status, 200, JSON.stringify(up.body));
  docId = up.body.id;
  const doc = await waitFor(async () => {
    const d = await client.get(`/api/documents/${docId}`);
    return d.body.status === 'needs_review' ? d.body : undefined;
  });
  assert.equal(doc.lab, 'Инвитро');
  assert.equal(doc.collected_at, '2026-10-10');
  assert.equal(doc.results.length, 3);
  const ferritin = doc.results.find((r: any) => r.analyte_code === 'ferritin');
  assert.equal(ferritin.value_num, 18.4);
  assert.equal(ferritin.ref_low, 13);

  // Повторная загрузка того же файла — предупреждение
  const dup = await client.raw('POST', '/api/clients/me/documents?name=invitro.pdf', pdf, { 'content-type': 'application/pdf' });
  assert.equal(dup.status, 409);
  assert.equal(dup.body.error, 'duplicate');

  // До подтверждения в динамике пусто
  assert.equal((await client.get('/api/clients/me/dynamics/ferritin')).body.series.length, 0);

  // Ручная правка сохраняет исходное значение и автора
  const mg = doc.results.find((r: any) => r.analyte_code === 'magnesium');
  const ed = await client.patch(`/api/results/${mg.id}`, { value_text: '0,8' });
  const edited = ed.body.results.find((r: any) => r.id === mg.id);
  assert.equal(edited.value_num, 0.8);
  assert.equal(edited.recognized.value_text, '0.78');
  assert.equal(edited.edited_by_name, 'Анна Иванова');

  const c = await client.post(`/api/documents/${docId}/confirm`);
  assert.equal(c.status, 200);
  assert.equal(c.body.status, 'confirmed');
  const dyn = await client.get('/api/clients/me/dynamics/ferritin');
  assert.equal(dyn.body.series.length, 1);
  assert.equal(dyn.body.series[0].points[0].value, 18.4);
  assert.equal(dyn.body.series[0].points[0].lab, 'Инвитро');
  assert.ok(dyn.body.events.some((e: any) => e.kind === 'course_start'));

  // Специалист получает уведомление о новых анализах
  assert.ok((await specialist.get('/api/notifications')).body.items.some((n: any) => n.kind === 'new_labs'));
});

test('Документ другого человека не попадает в профиль без проверки', async () => {
  const pdf = makePdf(['Patient: Petrova Maria', 'Date of collection: 01.10.2026', 'Ferritin 40 ng/ml 13 - 150']);
  const up = await specialist.raw('POST', `/api/clients/${clientId}/documents?name=other.pdf`, pdf, { 'content-type': 'application/pdf' });
  const id = up.body.id;
  const doc = await waitFor(async () => { const d = await client.get(`/api/documents/${id}`); return d.body.status === 'needs_review' ? d.body : undefined; });
  assert.equal(doc.ownership, 'needs_check');
  assert.equal(doc.uploaded_by_name, 'Елена Смирнова');
  assert.equal((await specialist.post(`/api/documents/${id}/confirm`)).status, 409);
  assert.equal((await specialist.post(`/api/documents/${id}/ownership`, { mine: true })).status, 403);
  const r = await client.post(`/api/documents/${id}/ownership`, { mine: false });
  assert.equal(r.body.result, 'deleted');
  assert.equal((await client.get(`/api/documents/${id}`)).status, 404);
});

test('8–9. Автоматическое пояснение отделено от комментария специалиста; клиент получает уведомление', async () => {
  const d = await client.get(`/api/documents/${docId}`);
  const ferritin = d.body.results.find((r: any) => r.analyte_code === 'ferritin');
  const rv = await client.get(`/api/results/${ferritin.id}`);
  assert.equal(rv.body.explanation.generator, 'rules');
  assert.ok(rv.body.explanation.version);
  assert.match(rv.body.explanation.text, /в пределах интервала/);
  assert.ok(rv.body.explanation.source_url.startsWith('https://'));
  assert.equal(rv.body.explanation.input.value_num, 18.4);

  const internal = await specialist.post(`/api/clients/${clientId}/comments`, { kind: 'internal', body: 'Проверить на следующей встрече', target_type: 'analyte', target_id: 'ferritin' });
  assert.equal(internal.body.kind, 'internal');
  const pub = await specialist.post(`/api/clients/${clientId}/comments`, { kind: 'conclusion', body: 'Ферритин в норме по бланку, но ближе к нижней границе — продолжаем курс.', target_type: 'analyte', target_id: 'ferritin' });
  assert.equal(pub.body.kind, 'conclusion');

  const forClient = await client.get('/api/clients/me/comments');
  assert.equal(forClient.body.length, 1, 'внутренние заметки клиенту не видны');
  assert.equal(forClient.body[0].kind, 'conclusion');
  const notes = await client.get('/api/notifications');
  assert.ok(notes.body.items.some((n: any) => n.kind === 'comment'));
  // Клиент не может опубликовать заключение — его сообщение становится вопросом
  const q = await client.post('/api/clients/me/comments', { kind: 'conclusion', body: 'Нужно ли пересдать?' });
  assert.equal(q.body.kind, 'question');
});

test('11. При ошибке распознавания доступен ручной ввод', async () => {
  const broken = Buffer.from('%PDF-1.4\nэто не настоящий pdf', 'utf8');
  const up = await client.raw('POST', '/api/clients/me/documents?name=broken.pdf&collected_at=2026-10-12', broken, { 'content-type': 'application/pdf' });
  const id = up.body.id;
  const doc = await waitFor(async () => { const d = await client.get(`/api/documents/${id}`); return d.body.status === 'error' ? d.body : undefined; });
  assert.ok(doc.error);
  const add = await client.post(`/api/documents/${id}/results`, { name: 'Ферритин', value_text: '25', unit: 'нг/мл', ref_low: 13, ref_high: 150 });
  assert.equal(add.status, 200);
  assert.equal(add.body.status, 'needs_review');
  assert.equal(add.body.results[0].analyte_code, 'ferritin');
  assert.equal(add.body.results[0].unit, 'нг/мл');
  assert.equal((await client.post(`/api/documents/${id}/confirm`)).body.status, 'confirmed');
  const dyn = await client.get('/api/clients/me/dynamics/ferritin');
  assert.equal(dyn.body.series[0].points.length, 2);

  // Фото без OCR — сразу ручной ввод
  const jpg = Buffer.concat([Buffer.from([0xff, 0xd8, 0xff, 0xe0]), Buffer.alloc(100)]);
  const up2 = await client.raw('POST', '/api/clients/me/documents?name=photo.jpg', jpg, { 'content-type': 'image/jpeg' });
  const d2 = await waitFor(async () => { const d = await client.get(`/api/documents/${up2.body.id}`); return ['needs_review', 'error'].includes(d.body.status) ? d.body : undefined; }, 15000);
  assert.equal(d2.results.length, 0);
  assert.ok(d2.error, 'есть подсказка внести значения вручную');

  // Неподдерживаемый формат
  const txt = await client.raw('POST', '/api/clients/me/documents?name=a.txt', Buffer.from('hello'), { 'content-type': 'text/plain' });
  assert.equal(txt.status, 415);
});

test('Фото бланка распознаётся локальным OCR, все значения помечены для проверки', async (t) => {
  const { hasOcr } = await import('../src/recognition.ts');
  if (!(await hasOcr())) return t.skip('Tesseract не установлен');
  const { readFileSync } = await import('node:fs');
  const photo = readFileSync(new URL('../../samples/blank-invitro-photo.jpg', import.meta.url));
  const up = await client.raw('POST', '/api/clients/me/documents?name=photo.jpg&force=1', photo, { 'content-type': 'image/jpeg' });
  const d = await waitFor(async () => { const x = await client.get(`/api/documents/${up.body.id}`); return x.body.status === 'needs_review' ? x.body : undefined; }, 60000);
  assert.ok(d.results.length >= 4);
  assert.ok(d.results.every((r: any) => r.low_confidence.includes('value')));
  assert.equal(d.results.find((r: any) => r.analyte_code === 'ferritin')?.value_num, 21.5);
  await client.del(`/api/documents/${up.body.id}`);
});

test('Интервал берётся из бланка или справочника, пользователь его не вводит', async () => {
  const broken = Buffer.from('%PDF-1.4\nне pdf, ручной ввод', 'utf8');
  const up = await client.raw('POST', '/api/clients/me/documents?name=manual.pdf&collected_at=2026-10-13&force=1', broken, { 'content-type': 'application/pdf' });
  await waitFor(async () => { const d = await client.get(`/api/documents/${up.body.id}`); return d.body.status === 'error' ? d.body : undefined; });
  // Пользователь пытается задать свой интервал — он игнорируется
  const add = await client.post(`/api/documents/${up.body.id}/results`, { name: 'Ферритин', value_text: '40', unit: 'нг/мл', ref_low: 1, ref_high: 2 });
  let r = add.body.results[0];
  assert.equal(r.ref_low, null, 'для ферритина интервал зависит от пола, а пол не указан');
  assert.equal(r.ref_note, 'sex');
  await client.patch('/api/me', { sex: 'female', birth_date: '1993-10-01' });
  r = (await client.get(`/api/documents/${up.body.id}`)).body.results[0];
  assert.equal(r.ref_source, 'reference');
  assert.equal(r.ref_low, 13);
  assert.equal(r.ref_high, 150);
  assert.match(r.ref_note, /MedlinePlus/);
  const add2 = await client.post(`/api/documents/${up.body.id}/results`, { name: 'Витамин 25(OH) D', value_text: '25', unit: 'нг/мл' });
  const d = add2.body.results.find((x: any) => x.analyte_code === 'vitamin_d');
  assert.equal(d.ref_text, '30–80');
  await client.post(`/api/documents/${up.body.id}/confirm`);
  const rv = await client.get(`/api/results/${d.id}`);
  assert.match(rv.body.explanation.text, /справочн/);
  assert.match(rv.body.explanation.text, /ниже нижней границы/);
  await client.del(`/api/documents/${up.body.id}`);
});

test('Ручной ввод анализа без файла', async () => {
  assert.equal((await client.post('/api/clients/me/documents/manual', { results: [{ name: 'Магний', value_text: '0,8', unit: 'ммоль/л' }] })).status, 400, 'нужна дата анализа');
  const r = await client.post('/api/clients/me/documents/manual', { lab: 'Гемотест', collected_at: '2026-10-11', results: [
    { name: 'Магний', value_text: '0,8', unit: 'ммоль/л' }, { name: '', value_text: '' }] });
  assert.equal(r.status, 200, JSON.stringify(r.body));
  const d = (await client.get(`/api/documents/${r.body.id}`)).body;
  assert.equal(d.status, 'confirmed');
  assert.equal(d.mime, 'manual');
  assert.equal(d.results.length, 1);
  assert.equal(d.results[0].ref_source, 'reference');
  assert.equal((await client.get(`/api/documents/${r.body.id}/file`)).status, 404);
  await client.del(`/api/documents/${r.body.id}`);
});

test('Напоминания уважают тихие часы и отметки', async () => {
  // 17.10 (суббота) 09:00 МСК: витамин D
  setNow('2026-10-17T06:00:30Z');
  tick(srv.db);
  const n = (await client.get('/api/notifications')).body.items.filter((x: any) => x.kind === 'intake_reminder');
  assert.equal(n.length, 1);
  assert.match(n[0].title, /Витамин D3/);
  assert.equal(n[0].public_title, 'Пора отметить приём', 'на экране блокировки — без названий БАДов');
  tick(srv.db);
  assert.equal((await client.get('/api/notifications')).body.items.filter((x: any) => x.kind === 'intake_reminder').length, 1, 'без повторов');

  // Тихие часы 08:30–09:30: напоминание о 09:00 приходит в 09:30
  await client.patch('/api/me', { settings: { quiet_from: '08:30', quiet_to: '09:30' } });
  const count = async () => (await client.get('/api/notifications')).body.items.filter((x: any) => x.kind === 'intake_reminder').length;
  setNow('2026-10-18T06:00:30Z');
  tick(srv.db);
  assert.equal(await count(), 1);
  setNow('2026-10-18T06:30:30Z');
  tick(srv.db);
  assert.equal(await count(), 2);
  await client.patch('/api/me', { settings: { quiet_from: '22:30', quiet_to: '08:00' } });
  setNow('2026-10-17T06:00:30Z');
});

test('12. Отменённые будущие приёмы не создают напоминаний', async () => {
  const before = (await client.get('/api/clients/me/intakes?from=2026-10-17&to=2026-10-29')).body.items;
  const c = await specialist.post(`/api/schemes/${schemeId}/cancel`, { reason: 'Курс завершаем досрочно' });
  assert.equal(c.status, 200);
  assert.ok(c.body.cancelled_intakes > 0);
  assert.equal(c.body.scheme.status, 'cancelled');
  const afterItems = (await client.get('/api/clients/me/intakes?from=2026-10-17&to=2026-10-29')).body.items;
  assert.equal(afterItems.length, before.length, 'история сохраняется');
  assert.ok(afterItems.filter((i: any) => i.date > '2026-10-17').every((i: any) => i.state === 'cancelled'));
  const past = (await client.get('/api/clients/me/intakes?from=2026-10-16&to=2026-10-16')).body.items;
  assert.equal(past.filter((i: any) => i.state === 'taken').length, 3);

  const count = () => all(srv.db, `SELECT * FROM notifications WHERE kind = 'intake_reminder'`).length;
  const n0 = count();
  for (const t of ['2026-10-18T17:00:30Z', '2026-10-20T05:00:30Z', '2026-10-20T16:00:30Z']) { setNow(t); tick(srv.db); }
  assert.equal(count(), n0);
  // Отменённый приём нельзя отметить
  const cancelled = afterItems.find((i: any) => i.state === 'cancelled');
  setNow(cancelled.date + 'T20:00:00Z');
  assert.equal((await client.post('/api/clients/me/intakes/mark', { planned_ids: [cancelled.id], status: 'taken', request_id: 'c1' })).status, 409);
  setNow('2026-10-17T09:00:00Z');
});

test('Самочувствие: запись о нежелательных ощущениях уведомляет специалиста', async () => {
  const r = await client.put('/api/clients/me/wellbeing/2026-10-17', { energy: 3, sleep: 4, overall: 3, symptoms: ['nausea'], adverse: true, comment: 'Подташнивало после магния' });
  assert.equal(r.status, 200);
  assert.equal((await specialist.put(`/api/clients/${clientId}/wellbeing/2026-10-17`, { energy: 1 })).status, 403);
  const n = (await specialist.get('/api/notifications')).body.items;
  assert.ok(n.some((x: any) => x.kind === 'adverse'));
  const list = await specialist.get('/api/clients');
  assert.ok(list.body[0].adverse_recent >= 1);
});

test('10. После отзыва доступа специалист не может открыть данные клиента', async () => {
  const r = await client.del('/api/me/access');
  assert.equal(r.status, 200);
  assert.equal(r.body.active, null);
  for (const p of [`/api/clients/${clientId}/summary`, `/api/clients/${clientId}/documents`, `/api/documents/${docId}`, `/api/documents/${docId}/file`, `/api/schemes/${schemeId}`, `/api/clients/${clientId}/wellbeing`]) {
    assert.equal((await specialist.get(p)).status, 404, p);
  }
  assert.equal((await specialist.get('/api/clients')).body.length, 0);
  // Личный кабинет и история клиента сохраняются
  assert.equal((await client.get('/api/clients/me/documents')).body.length, 3);
  assert.equal((await client.get(`/api/schemes/${schemeId}`)).status, 200);
});

test('Экспорт и удаление аккаунта', async () => {
  const ex = await client.get('/api/me/export');
  assert.equal(ex.status, 200);
  assert.ok(ex.body.results.length >= 4);
  assert.ok(ex.body.intakes.length > 0);
  assert.equal((await client.post('/api/me/delete', { password: 'wrong' })).status, 401);
  assert.equal((await client.post('/api/me/delete', { password: 'password123' })).status, 200);
  assert.equal(all(srv.db, 'SELECT * FROM results').length, 0);
  assert.equal(all(srv.db, 'SELECT * FROM documents').length, 0);
});

test('CSRF: изменяющий запрос без служебного заголовка отклоняется', async () => {
  const r = await fetch(srv.base + '/api/auth/login', { method: 'POST', headers: { 'content-type': 'application/json' }, body: '{}' });
  assert.equal(r.status, 403);
});

test('Закрытая регистрация: только первый аккаунт и клиенты по приглашению', async () => {
  const { mkdtempSync } = await import('node:fs');
  const { tmpdir } = await import('node:os');
  const { join } = await import('node:path');
  const { openDb } = await import('../src/db.ts');
  const { FileStore } = await import('../src/core.ts');
  const { createApp } = await import('../src/app.ts');
  const { builtinRecognizer } = await import('../src/recognition.ts');
  const dir = mkdtempSync(join(tmpdir(), 'nutri-closed-'));
  const app = createApp({ db: openDb(join(dir, 'db')), files: new FileStore(join(dir, 'f')), recognizer: builtinRecognizer, openRegistration: false });
  const server = app.listen(0);
  await new Promise((r) => server.once('listening', r));
  const base = `http://127.0.0.1:${(server.address() as any).port}`;
  const owner = agent(base);
  assert.equal((await owner.post('/api/auth/register', { email: 'me@x.io', password: 'password123', name: 'Мария', role: 'specialist' })).status, 200);
  const stranger = agent(base);
  assert.equal((await stranger.post('/api/auth/register', { email: 's@x.io', password: 'password123', name: 'Чужой' })).status, 403);
  const inv = await owner.post('/api/invitations', {});
  const invited = agent(base);
  const r = await invited.post('/api/auth/register', { email: 'c@x.io', password: 'password123', name: 'Мария', role: 'specialist', invite: inv.body.token });
  assert.equal(r.status, 200);
  assert.equal(r.body.role, 'client', 'по приглашению создаётся только клиент');
  await new Promise((res) => server.close(res));
});

test('Клиент приглашает своего специалиста при закрытой регистрации', async () => {
  const { mkdtempSync } = await import('node:fs');
  const { tmpdir } = await import('node:os');
  const { join } = await import('node:path');
  const { openDb } = await import('../src/db.ts');
  const { FileStore } = await import('../src/core.ts');
  const { createApp } = await import('../src/app.ts');
  const { builtinRecognizer } = await import('../src/recognition.ts');
  const dir = mkdtempSync(join(tmpdir(), 'nutri-join-'));
  const app = createApp({ db: openDb(join(dir, 'db')), files: new FileStore(join(dir, 'f')), recognizer: builtinRecognizer, openRegistration: false });
  const server = app.listen(0);
  await new Promise((r) => server.once('listening', r));
  const base = `http://127.0.0.1:${(server.address() as any).port}`;
  const me = agent(base);
  const owner = await me.post('/api/auth/register', { email: 'me@x.io', password: 'password123', name: 'Мария' });
  assert.equal(owner.body.role, 'client');
  const old = await me.post('/api/me/specialist-invite', {});
  const inv = await me.post('/api/me/specialist-invite', {});
  assert.equal(inv.status, 200);
  assert.equal((await agent(base).get(`/api/join/${old.body.token}`)).body.state, 'revoked', 'новая ссылка отменяет прежнюю');
  const doc = agent(base);
  const preview = await doc.get(`/api/join/${inv.body.token}`);
  assert.equal(preview.body.client_name, 'Мария');
  // Регистрация по чужой или старой ссылке закрыта
  assert.equal((await agent(base).post('/api/auth/register', { email: 'x@x.io', password: 'password123', name: 'Икс', join: old.body.token })).status, 403);
  const r = await doc.post('/api/auth/register', { email: 'doc@x.io', password: 'password123', name: 'Ольга', join: inv.body.token });
  assert.equal(r.status, 200);
  assert.equal(r.body.role, 'specialist');
  assert.equal((await doc.get(`/api/clients/${owner.body.id}/summary`)).status, 200, 'доступ открыт сразу');
  assert.equal((await me.get('/api/me/access')).body.active.specialist_name, 'Ольга');
  assert.equal((await doc.post(`/api/join/${inv.body.token}/accept`, {})).status, 410, 'ссылка одноразовая');
  await new Promise((res) => server.close(res));
});

test('Перенос схем из файла: прошлые — в историю без приёмов и уведомлений', async () => {
  const past = { title: 'Прошлый курс', start_date: '2025-11-08', end_date: '2025-12-09', items: [
    { name: 'Селен', form: 'capsule', amount: 1, amount_unit: 'капсула', substance_amount: 100, substance_unit: 'мкг', doses: [{ part: 'morning' }], frequency: { type: 'daily' }, food: 'any', start_date: '2025-11-08', end_date: '2025-12-09' },
  ] };
  const specialist = sp(), client = sp();
  await specialist.post('/api/auth/register', { email: 'imp-doc@example.com', password: 'password123', name: 'Ольга', role: 'specialist' });
  const inv = await specialist.post('/api/invitations', {});
  const c = await client.post('/api/auth/register', { email: 'imp@example.com', password: 'password123', name: 'Ира' });
  await client.post(`/api/invite/${inv.body.token}/accept`);
  const clientId = c.body.id;
  const count = async () => { const b = (await client.get('/api/notifications')).body; return (b.items ?? b).length; };
  const before = await count();
  const r = await specialist.post(`/api/clients/${clientId}/schemes/import`, { schemes: [past] });
  assert.equal(r.status, 200);
  assert.equal(r.body.imported, 1);
  const list = (await client.get('/api/clients/me/schemes')).body;
  const imported = list.find((s: any) => s.current?.title === 'Прошлый курс');
  assert.equal(imported.status, 'completed');
  assert.equal(await count(), before, 'о прошлых схемах не уведомляем');
  const bad = await specialist.post(`/api/clients/${clientId}/schemes/import`, { schemes: [{ ...past, items: [] }] });
  assert.equal(bad.status, 400);
  assert.equal((await client.post(`/api/clients/${clientId}/schemes/import`, { schemes: [past] })).status, 403);
});
