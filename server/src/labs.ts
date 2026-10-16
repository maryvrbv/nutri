import { all, get, run, tx, type DB, type Row } from './db.ts';
import { FileStore, HttpError, activeLink, audit, bad, clock, id, notFound, notify, nowIso, sha256, type User } from './core.ts';
import type { Recognizer } from './recognition.ts';
import { REFERENCE_VERSION, explain, findAnalyte, getAnalyte, normalizeUnit, referenceRange, toBase } from './reference.ts';
import { isDate, todayIn } from './time.ts';

export const MAX_FILE = 20 * 1024 * 1024;

/**
 * Интервал результата: из бланка (ref_source = 'lab'), а если в бланке его нет —
 * справочный для взрослых по полу из профиля ('reference'). Пользователь интервал не вводит.
 */
function resolveRef(db: DB, ownerId: string, r: { analyte_code: string | null; unit: string; ref_low: number | null; ref_high: number | null; ref_text: string; collected_at?: string | null }) {
  if (r.ref_low != null || r.ref_high != null) return { ref_low: r.ref_low, ref_high: r.ref_high, ref_text: r.ref_text, ref_source: 'lab', ref_note: null as string | null };
  const p = get<{ sex: string | null; birth_date: string | null }>(db, 'SELECT sex, birth_date FROM users WHERE id = ?', ownerId) ?? { sex: null, birth_date: null };
  const ref = referenceRange(r.analyte_code, r.unit, p, r.collected_at);
  if (ref && 'missing' in ref) return { ref_low: null, ref_high: null, ref_text: '', ref_source: null, ref_note: 'sex' };
  if (!ref) return { ref_low: null, ref_high: null, ref_text: '', ref_source: null, ref_note: null };
  return { ref_low: ref.low, ref_high: ref.high, ref_text: ref.text, ref_source: 'reference', ref_note: ref.note };
}

/** Пересчитать справочные интервалы клиента (например, после того как указан пол). Интервалы из бланков не трогаются. */
export function refreshReferenceRanges(db: DB, ownerId: string) {
  const rows = all(db, `SELECT * FROM results WHERE owner_id = ? AND (ref_source IS NULL OR ref_source = 'reference')`, ownerId);
  for (const r of rows) {
    const x = resolveRef(db, ownerId, { analyte_code: r.analyte_code, unit: r.unit, collected_at: r.collected_at, ref_low: null, ref_high: null, ref_text: "" });
    run(db, 'UPDATE results SET ref_low = ?, ref_high = ?, ref_text = ?, ref_source = ?, ref_note = ? WHERE id = ?', x.ref_low, x.ref_high, x.ref_text, x.ref_source, x.ref_note, r.id);
    if (r.status === 'confirmed') writeExplanation(db, { ...r, ...x });
  }
}

function writeExplanation(db: DB, r: Row) {
  const input = { name: r.name, analyte_code: r.analyte_code, value_num: r.value_num, value_text: r.value_text, unit: r.unit,
    ref_low: r.ref_low, ref_high: r.ref_high, ref_text: r.ref_text, lab_flag: r.lab_flag, ref_source: r.ref_source, ref_note: r.ref_note };
  const e = explain(input);
  run(db, 'DELETE FROM explanations WHERE result_id = ?', r.id);
  run(db, `INSERT INTO explanations (id, result_id, generator, version, created_at, input, status, text, source_title, source_url)
    VALUES (?,?,?,?,?,?,?,?,?,?)`, id(), r.id, 'rules', REFERENCE_VERSION, nowIso(), JSON.stringify(input), e.status, e.text, e.source?.title ?? null, e.source?.url ?? null);
}

export function sniffMime(buf: Buffer): string | null {
  if (buf.subarray(0, 5).toString('latin1') === '%PDF-') return 'application/pdf';
  if (buf[0] === 0xff && buf[1] === 0xd8 && buf[2] === 0xff) return 'image/jpeg';
  if (buf.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))) return 'image/png';
  return null;
}

type UploadInput = { file: Buffer; file_name: string; lab?: string; collected_at?: string; force?: boolean };

export function upload(db: DB, files: FileStore, actor: User, ownerId: string, input: UploadInput) {
  if (!input.file?.length) throw bad('Файл пустой');
  if (input.file.length > MAX_FILE) throw new HttpError(413, 'too_large', 'Файл больше 20 МБ');
  const mime = sniffMime(input.file);
  if (!mime) throw new HttpError(415, 'unsupported', 'Поддерживаются PDF, JPG и PNG');
  if (input.collected_at && !isDate(input.collected_at)) throw bad('Неверная дата забора');
  const hash = sha256(input.file);
  if (!input.force) {
    const same = get(db, 'SELECT id, file_name, uploaded_at FROM documents WHERE owner_id = ? AND sha256 = ?', ownerId, hash);
    const similar = !same && input.lab && input.collected_at
      ? get(db, 'SELECT id, file_name, uploaded_at FROM documents WHERE owner_id = ? AND lab = ? AND collected_at = ?', ownerId, input.lab, input.collected_at)
      : undefined;
    const dup = same ?? similar;
    if (dup) throw new HttpError(409, 'duplicate', same ? 'Этот файл уже загружен' : 'Похоже, анализ этой лаборатории за эту дату уже есть', { duplicate: dup });
  }
  const key = files.put(input.file);
  const docId = id();
  const name = (input.file_name || 'документ').replace(/[^\p{L}\p{N} ._()-]/gu, '_').slice(0, 120);
  run(db, `INSERT INTO documents (id, owner_id, uploaded_by, file_name, mime, size, sha256, storage_key, lab, collected_at, uploaded_at, status)
    VALUES (?,?,?,?,?,?,?,?,?,?,?, 'uploaded')`, docId, ownerId, actor.id, name, mime, input.file.length, hash, key,
    input.lab?.trim() || null, input.collected_at || null, nowIso());
  audit(db, { actor: actor.id, client: ownerId, entity: 'document', entity_id: docId, action: 'uploaded', data: { mime } });
  return docId;
}

function nameTokens(s: string) {
  return s.toLowerCase().replace(/ё/g, 'е').split(/[\s.,]+/).filter((t) => t.length >= 2);
}

/** Совпадает ли ФИО в бланке с владельцем профиля. Хватает совпадения имени или фамилии. */
export function sameperson(ownerName: string, patient: string | null) {
  if (!patient) return true;
  const a = new Set(nameTokens(ownerName));
  return nameTokens(patient).some((t) => a.has(t));
}

export async function processDocument(db: DB, files: FileStore, recognizer: Recognizer, docId: string) {
  const doc = get(db, 'SELECT * FROM documents WHERE id = ?', docId);
  if (!doc) return;
  run(db, `UPDATE documents SET status = 'processing' WHERE id = ?`, docId);
  try {
    const r = await recognizer.recognize(files.read(doc.storage_key), doc.mime);
    const owner = get(db, 'SELECT name FROM users WHERE id = ?', doc.owner_id)!;
    tx(db, () => {
      const collected = doc.collected_at ?? r.collected_at;
      const ownership = sameperson(owner.name, r.patient_name) ? 'ok' : 'needs_check';
      run(db, `UPDATE documents SET status = 'needs_review', pages = ?, lab = COALESCE(lab, ?), collected_at = ?, patient_name = ?,
        ownership = ?, recognizer = ?, error = ? WHERE id = ?`,
        r.pages, r.lab, collected, r.patient_name, ownership, r.recognizer, r.note ?? null, docId);
      // Пол и дата рождения из бланка дополняют профиль, если там пусто: по ним подбираются справочные интервалы
      if (ownership === 'ok' && (r.sex || r.birth_date)) {
        run(db, 'UPDATE users SET sex = COALESCE(sex, ?), birth_date = COALESCE(birth_date, ?) WHERE id = ?', r.sex ?? null, r.birth_date ?? null, doc.owner_id);
      }
      r.rows.forEach((row, i) => {
        const ref = resolveRef(db, doc.owner_id, { ...row, collected_at: collected });
        const low = ref.ref_source === 'lab' ? row.low_confidence : row.low_confidence.filter((f) => f !== 'ref');
        run(db, `INSERT INTO results (id, document_id, owner_id, position, analyte_code, name, value_num, value_text, unit, ref_low, ref_high,
          ref_text, ref_source, ref_note, lab_flag, collected_at, low_confidence, recognized, source, status) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?, 'recognized', 'draft')`,
          id(), docId, doc.owner_id, i, row.analyte_code, row.name, row.value_num, row.value_text, row.unit, ref.ref_low, ref.ref_high,
          ref.ref_text, ref.ref_source, ref.ref_note, row.lab_flag, collected, JSON.stringify(low), JSON.stringify(row));
      });
      audit(db, { actor: null, client: doc.owner_id, entity: 'document', entity_id: docId, action: 'recognized', data: { rows: r.rows.length, recognizer: r.recognizer } });
      notify(db, doc.owner_id, { kind: 'recognition_ready', title: 'Анализ распознан — проверьте значения', public_title: 'Документ обработан', link: `/labs/documents/${docId}`, dedupe_key: `rec:${docId}` });
    });
  } catch (e) {
    // Текст ошибки распознавателя может содержать фрагменты документа — в лог пишем только тип.
    console.error(`recognition failed doc=${docId} type=${(e as Error)?.name ?? 'Error'}`);
    run(db, `UPDATE documents SET status = 'error', error = ? WHERE id = ?`, 'Не удалось обработать файл. Можно внести значения вручную.', docId);
    notify(db, doc.owner_id, { kind: 'recognition_failed', title: 'Не удалось распознать анализ — внесите значения вручную', public_title: 'Документ обработан', link: `/labs/documents/${docId}`, dedupe_key: `rec:${docId}` });
  }
}

export function documentView(db: DB, docId: string) {
  const doc = get(db, `SELECT d.*, u.name AS uploaded_by_name, c.name AS confirmed_by_name FROM documents d
    LEFT JOIN users u ON u.id = d.uploaded_by LEFT JOIN users c ON c.id = d.confirmed_by WHERE d.id = ?`, docId);
  if (!doc) throw notFound();
  const results = all(db, `SELECT r.*, e.name AS edited_by_name FROM results r LEFT JOIN users e ON e.id = r.edited_by
    WHERE r.document_id = ? ORDER BY r.position, r.rowid`, docId)
    .map(parseResult);
  delete doc.storage_key;
  delete doc.sha256;
  return { ...doc, results };
}

function parseResult(r: Row) {
  return { ...r, low_confidence: JSON.parse(r.low_confidence || '[]'), recognized: r.recognized ? JSON.parse(r.recognized) : null };
}

export function documentOwner(db: DB, docId: string) {
  const d = get<{ owner_id: string }>(db, 'SELECT owner_id FROM documents WHERE id = ?', docId);
  if (!d) throw notFound();
  return d.owner_id;
}

function assertEditable(doc: Row) {
  if (doc.status === 'confirmed') throw new HttpError(409, 'confirmed', 'Документ подтверждён. Чтобы исправить значения, откройте его на проверку.');
  if (doc.status === 'processing' || doc.status === 'uploaded') throw new HttpError(409, 'processing', 'Документ ещё обрабатывается');
}

function num(v: any): number | null {
  if (v === null || v === undefined || v === '') return null;
  const n = typeof v === 'number' ? v : Number(String(v).replace(',', '.'));
  return Number.isFinite(n) ? n : null;
}

function cleanResult(input: any) {
  const name = String(input?.name ?? '').trim();
  const value_text = String(input?.value_text ?? '').trim();
  if (!name) throw bad('Укажите название показателя');
  if (!value_text) throw bad('Укажите результат');
  const known = input.analyte_code ? getAnalyte(input.analyte_code) : findAnalyte(name);
  return {
    name,
    analyte_code: known?.code ?? null,
    value_text,
    value_num: /^[<>≤≥]/.test(value_text) ? null : num(value_text),
    unit: normalizeUnit(String(input?.unit ?? '')),

    lab_flag: String(input?.lab_flag ?? '').trim().slice(0, 20),
  };
}

/** Ручная правка: исходное распознанное значение остаётся в поле recognized, автор правки фиксируется. */
export function editResult(db: DB, actor: User, resultId: string, input: any) {
  const r = get(db, 'SELECT * FROM results WHERE id = ?', resultId);
  if (!r) throw notFound();
  const doc = get(db, 'SELECT * FROM documents WHERE id = ?', r.document_id)!;
  assertEditable(doc);
  // Интервал пользователь не правит: из бланка он сохраняется, справочный пересчитывается под новое название и единицы
  const c = cleanResult({ ...r, ...input, lab_flag: input.lab_flag ?? r.lab_flag });
  const keepLab = r.ref_source === 'lab' && c.unit === r.unit;
  const ref = keepLab
    ? { ref_low: r.ref_low, ref_high: r.ref_high, ref_text: r.ref_text, ref_source: 'lab', ref_note: null }
    : resolveRef(db, r.owner_id, { ...c, ref_low: null, ref_high: null, ref_text: '', collected_at: r.collected_at });
  tx(db, () => {
    run(db, `UPDATE results SET name=?, analyte_code=?, value_text=?, value_num=?, unit=?, ref_low=?, ref_high=?, ref_text=?, ref_source=?, ref_note=?, lab_flag=?,
      low_confidence='[]', edited_by=?, edited_at=? WHERE id=?`, c.name, c.analyte_code, c.value_text, c.value_num, c.unit, ref.ref_low, ref.ref_high,
      ref.ref_text, ref.ref_source, ref.ref_note, c.lab_flag, actor.id, nowIso(), resultId);
    audit(db, { actor: actor.id, client: r.owner_id, entity: 'result', entity_id: resultId, action: 'edited',
      data: { before: { value_text: r.value_text, unit: r.unit, ref_text: r.ref_text, name: r.name }, after: { value_text: c.value_text, unit: c.unit, ref_text: ref.ref_text, name: c.name } } });
  });
}

export function addResult(db: DB, actor: User, docId: string, input: any) {
  const doc = get(db, 'SELECT * FROM documents WHERE id = ?', docId);
  if (!doc) throw notFound();
  if (doc.status === 'error') run(db, `UPDATE documents SET status = 'needs_review' WHERE id = ?`, docId);
  else assertEditable(doc);
  const c = cleanResult(input);
  const ref = resolveRef(db, doc.owner_id, { ...c, ref_low: null, ref_high: null, ref_text: '', collected_at: doc.collected_at });
  const rid = id();
  const pos = get<{ n: number }>(db, 'SELECT COALESCE(MAX(position), -1) + 1 AS n FROM results WHERE document_id = ?', docId)!.n;
  run(db, `INSERT INTO results (id, document_id, owner_id, position, analyte_code, name, value_num, value_text, unit, ref_low, ref_high, ref_text,
    ref_source, ref_note, lab_flag, collected_at, source, status, edited_by, edited_at) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?, 'manual', 'draft', ?, ?)`,
    rid, docId, doc.owner_id, pos, c.analyte_code, c.name, c.value_num, c.value_text, c.unit, ref.ref_low, ref.ref_high, ref.ref_text, ref.ref_source, ref.ref_note, c.lab_flag,
    doc.collected_at, actor.id, nowIso());
  audit(db, { actor: actor.id, client: doc.owner_id, entity: 'result', entity_id: rid, action: 'added_manually', data: { name: c.name } });
  return rid;
}

export function deleteResult(db: DB, actor: User, resultId: string) {
  const r = get(db, 'SELECT * FROM results WHERE id = ?', resultId);
  if (!r) throw notFound();
  assertEditable(get(db, 'SELECT * FROM documents WHERE id = ?', r.document_id)!);
  run(db, 'DELETE FROM results WHERE id = ?', resultId);
  audit(db, { actor: actor.id, client: r.owner_id, entity: 'result', entity_id: resultId, action: 'deleted', data: { name: r.name, value_text: r.value_text } });
}

export function updateDocumentMeta(db: DB, actor: User, docId: string, input: { lab?: string; collected_at?: string }) {
  const doc = get(db, 'SELECT * FROM documents WHERE id = ?', docId);
  if (!doc) throw notFound();
  assertEditable(doc);
  if (input.collected_at !== undefined && !isDate(input.collected_at)) throw bad('Неверная дата забора');
  const lab = input.lab !== undefined ? String(input.lab).trim().slice(0, 100) || null : doc.lab;
  const collected = input.collected_at ?? doc.collected_at;
  run(db, 'UPDATE documents SET lab = ?, collected_at = ? WHERE id = ?', lab, collected, docId);
  run(db, 'UPDATE results SET collected_at = ? WHERE document_id = ?', collected, docId);
  audit(db, { actor: actor.id, client: doc.owner_id, entity: 'document', entity_id: docId, action: 'meta_updated', data: { lab, collected_at: collected } });
}

/** Ответ владельца на вопрос «это ваш документ?». Чужой документ удаляется целиком. */
export function resolveOwnership(db: DB, files: FileStore, actor: User, docId: string, mine: boolean) {
  const doc = get(db, 'SELECT * FROM documents WHERE id = ?', docId);
  if (!doc) throw notFound();
  if (actor.id !== doc.owner_id) throw new HttpError(403, 'forbidden', 'Подтвердить принадлежность документа может только владелец профиля');
  if (mine) {
    run(db, `UPDATE documents SET ownership = 'confirmed' WHERE id = ?`, docId);
    audit(db, { actor: actor.id, client: doc.owner_id, entity: 'document', entity_id: docId, action: 'ownership_confirmed' });
    return 'kept';
  }
  tx(db, () => {
    run(db, 'DELETE FROM documents WHERE id = ?', docId);
    audit(db, { actor: actor.id, client: doc.owner_id, entity: 'document', entity_id: docId, action: 'deleted_not_owner' });
  });
  files.remove(doc.storage_key);
  return 'deleted';
}

export function confirmDocument(db: DB, actor: User, docId: string) {
  const doc = get(db, 'SELECT * FROM documents WHERE id = ?', docId);
  if (!doc) throw notFound();
  if (doc.status !== 'needs_review' && doc.status !== 'error') throw new HttpError(409, 'bad_state', 'Документ нельзя подтвердить в текущем статусе');
  if (doc.ownership === 'needs_check') throw new HttpError(409, 'ownership', 'Сначала подтвердите, что документ принадлежит владельцу профиля');
  if (!doc.collected_at) throw bad('Укажите дату забора материала', { field: 'collected_at' });
  const results = all(db, 'SELECT * FROM results WHERE document_id = ?', docId);
  if (results.length === 0) throw bad('Добавьте хотя бы один показатель');
  const now = nowIso();
  tx(db, () => {
    run(db, `UPDATE results SET status = 'confirmed', confirmed_by = ?, confirmed_at = ?, collected_at = ? WHERE document_id = ?`, actor.id, now, doc.collected_at, docId);
    run(db, `UPDATE documents SET status = 'confirmed', confirmed_by = ?, confirmed_at = ?, error = NULL WHERE id = ?`, actor.id, now, docId);
    for (const r of results) writeExplanation(db, r);
    audit(db, { actor: actor.id, client: doc.owner_id, entity: 'document', entity_id: docId, action: 'confirmed', data: { results: results.length } });
    const link = activeLink(db, doc.owner_id);
    if (link && link.specialist_id !== actor.id) {
      const owner = get(db, 'SELECT name FROM users WHERE id = ?', doc.owner_id)!;
      notify(db, link.specialist_id, { kind: 'new_labs', title: `${owner.name}: новые анализы (${results.length})`, public_title: 'Новые анализы у клиента', link: `/clients/${doc.owner_id}/labs`, dedupe_key: `labs:${docId}:${now}` });
    }
  });
}

export function reopenDocument(db: DB, actor: User, docId: string) {
  const doc = get(db, 'SELECT * FROM documents WHERE id = ?', docId);
  if (!doc) throw notFound();
  if (doc.status !== 'confirmed') throw new HttpError(409, 'bad_state', 'Документ не подтверждён');
  tx(db, () => {
    run(db, `UPDATE results SET status = 'draft' WHERE document_id = ?`, docId);
    run(db, `UPDATE documents SET status = 'needs_review' WHERE id = ?`, docId);
    audit(db, { actor: actor.id, client: doc.owner_id, entity: 'document', entity_id: docId, action: 'reopened' });
  });
}

export function deleteDocument(db: DB, files: FileStore, actor: User, docId: string) {
  const doc = get(db, 'SELECT * FROM documents WHERE id = ?', docId);
  if (!doc) throw notFound();
  if (actor.id !== doc.owner_id && actor.id !== doc.uploaded_by) throw new HttpError(403, 'forbidden', 'Удалить документ может владелец или автор загрузки');
  tx(db, () => {
    run(db, 'DELETE FROM documents WHERE id = ?', docId);
    audit(db, { actor: actor.id, client: doc.owner_id, entity: 'document', entity_id: docId, action: 'deleted', data: { file_name: doc.file_name } });
  });
  files.remove(doc.storage_key);
}

export function listDocuments(db: DB, ownerId: string) {
  return all(db, `SELECT d.id, d.file_name, d.mime, d.size, d.pages, d.lab, d.collected_at, d.uploaded_at, d.status, d.ownership, d.error,
    d.uploaded_by, u.name AS uploaded_by_name, (SELECT COUNT(*) FROM results r WHERE r.document_id = d.id) AS results_count
    FROM documents d LEFT JOIN users u ON u.id = d.uploaded_by WHERE d.owner_id = ? ORDER BY COALESCE(d.collected_at, substr(d.uploaded_at,1,10)) DESC, d.uploaded_at DESC`, ownerId);
}

/** Последние подтверждённые результаты по каждому показателю. */
export function latestResults(db: DB, ownerId: string) {
  const rows = all(db, `SELECT r.*, d.lab FROM results r JOIN documents d ON d.id = r.document_id
    WHERE r.owner_id = ? AND r.status = 'confirmed' ORDER BY r.collected_at DESC, r.confirmed_at DESC`, ownerId);
  const seen = new Map<string, Row & { count: number }>();
  for (const r of rows) {
    const k = r.analyte_code ?? 'name:' + r.name.toLowerCase();
    const cur = seen.get(k);
    if (cur) cur.count++;
    else seen.set(k, { ...parseResult(r), key: k, count: 1 });
  }
  return [...seen.values()];
}

export function resultView(db: DB, resultId: string) {
  const r = get(db, `SELECT r.*, d.lab, d.file_name, c.name AS confirmed_by_name FROM results r JOIN documents d ON d.id = r.document_id
    LEFT JOIN users c ON c.id = r.confirmed_by WHERE r.id = ?`, resultId);
  if (!r) throw notFound();
  const explanation = r.status === 'confirmed' ? get(db, 'SELECT * FROM explanations WHERE result_id = ? ORDER BY created_at DESC LIMIT 1', resultId) : null;
  return { ...parseResult(r), explanation: explanation ? { ...explanation, input: JSON.parse(explanation.input) } : null, about: getAnalyte(r.analyte_code)?.about ?? null };
}

/**
 * Динамика показателя. Значения в разных единицах объединяются, только если для показателя
 * есть проверенное правило перевода; иначе каждая единица — отдельный ряд.
 */
export function dynamics(db: DB, ownerId: string, key: string) {
  const isName = key.startsWith('name:');
  const rows = all(db, `SELECT r.*, d.lab, d.id AS doc_id, d.file_name FROM results r JOIN documents d ON d.id = r.document_id
    WHERE r.owner_id = ? AND r.status = 'confirmed' AND ${isName ? 'r.analyte_code IS NULL AND lower(r.name) = ?' : 'r.analyte_code = ?'}
    ORDER BY r.collected_at, r.confirmed_at`, ownerId, isName ? key.slice(5) : key);
  const a = isName ? undefined : getAnalyte(key);
  const series = new Map<string, { unit: string; converted: boolean; points: Row[] }>();
  for (const r of rows) {
    const base = toBase(a, r.value_num, r.unit);
    const sKey = base ? `base:${base.unit}` : `raw:${r.unit}`;
    const s = series.get(sKey) ?? { unit: base?.unit ?? r.unit, converted: !!base, points: [] as Row[] };
    const f = base ? base.factor : 1;
    s.points.push({
      result_id: r.id, document_id: r.doc_id, file_name: r.file_name, date: r.collected_at, lab: r.lab,
      value: base ? base.value : r.value_num, value_text: r.value_text, original_unit: r.unit,
      ref_low: r.ref_low != null ? r.ref_low * f : null, ref_high: r.ref_high != null ? r.ref_high * f : null, ref_text: r.ref_text, ref_source: r.ref_source,
      lab_flag: r.lab_flag, converted: base ? r.unit !== base.unit : false,
    });
    series.set(sKey, s);
  }
  return { key, name: a?.name ?? rows[0]?.name ?? key.slice(5), about: a?.about ?? null, series: [...series.values()] };
}

/** События курсов для наложения на графики и общую временную шкалу. */
export function courseEvents(db: DB, clientId: string) {
  const out: { date: string; kind: string; title: string; scheme_id: string }[] = [];
  const schemes = all(db, 'SELECT * FROM schemes WHERE client_id = ?', clientId);
  const tz = get<{ timezone: string }>(db, 'SELECT timezone FROM users WHERE id = ?', clientId)?.timezone ?? 'UTC';
  const today = todayIn(tz, clock.now());
  for (const s of schemes) {
    const versions = all(db, 'SELECT * FROM scheme_versions WHERE scheme_id = ? AND published_at IS NOT NULL ORDER BY number', s.id);
    if (!versions.length) continue;
    out.push({ date: versions[0].start_date, kind: 'course_start', title: `Начало курса «${versions[0].title}»`, scheme_id: s.id });
    for (const v of versions.slice(1)) out.push({ date: v.effective_from, kind: 'course_change', title: `Изменение схемы (версия ${v.number})`, scheme_id: s.id });
    const last = versions.at(-1)!;
    if (s.cancelled_at) out.push({ date: s.cancelled_at.slice(0, 10), kind: 'course_cancel', title: `Курс «${last.title}» отменён`, scheme_id: s.id });
    else if (last.end_date <= today) out.push({ date: last.end_date, kind: 'course_end', title: `Завершение курса «${last.title}»`, scheme_id: s.id });
  }
  return out.sort((a, b) => a.date.localeCompare(b.date));
}
