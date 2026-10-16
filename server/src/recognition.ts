import { execFile } from 'node:child_process';
import { mkdtemp, readdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { promisify } from 'node:util';
import { KNOWN_UNIT_PATTERN, findAnalyte, matchAnalyteAtStart, normalizeUnit, type Analyte } from './reference.ts';

export type RecognizedRow = {
  name: string;
  analyte_code: string | null;
  value_num: number | null;
  value_text: string;
  unit: string;
  ref_low: number | null;
  ref_high: number | null;
  ref_text: string;
  lab_flag: string;
  low_confidence: string[]; // поля, в которых распознавание не уверено
};

export type Recognition = {
  recognizer: string;
  pages: number | null;
  text_found: boolean;
  lab: string | null;
  collected_at: string | null;
  patient_name: string | null;
  sex?: 'female' | 'male' | null;
  birth_date?: string | null;
  rows: RecognizedRow[];
  note?: string;
};

/**
 * Распознаватель — сменный модуль. Встроенный разбирает PDF с текстовым слоем
 * (большинство бланков из личных кабинетов лабораторий), а фото и сканы — локальным
 * Tesseract, если он установлен на сервере. Данные внешним сервисам не передаются.
 * Без Tesseract пользователь вносит значения вручную.
 */
export interface Recognizer {
  name: string;
  recognize(file: Buffer, mime: string): Promise<Recognition>;
}

const LABS: [RegExp, string][] = [
  [/инвитро|invitro/i, 'Инвитро'],
  [/гемотест|gemotest/i, 'Гемотест'],
  [/\bkdl\b|кдл/i, 'KDL'],
  [/хеликс|helix/i, 'Хеликс'],
  [/\bcmd\b|цмд/i, 'CMD'],
  [/lab4u/i, 'Lab4U'],
  [/ситилаб|citilab/i, 'Ситилаб'],
  [/диалаб|dialab/i, 'Диалаб'],
  [/синэво|synevo/i, 'Синэво'],
];

const NUM = String.raw`\d+(?:[.,]\d+)?`;
const toNum = (s: string) => Number(s.replace(',', '.'));
const UNIT_RE = new RegExp(String.raw`(?:^|\s|\d)(${KNOWN_UNIT_PATTERN})(?=\s|$|[),;])`, 'i');

export function parseMeta(text: string) {
  let lab: string | null = null;
  for (const [re, name] of LABS) if (re.test(text)) { lab = name; break; }
  let collected_at: string | null = null;
  const dm = text.match(/(?:взят|забор|дата\s+(?:взятия|забора|сбора)|collect)[^\n\d]{0,40}(\d{2})[./](\d{2})[./](\d{4})/i)
    ?? text.match(/(\d{2})[.](\d{2})[.](20\d{2})/);
  if (dm) {
    const iso = `${dm[3]}-${dm[2]}-${dm[1]}`;
    if (!Number.isNaN(Date.parse(iso))) collected_at = iso;
  }
  const pm = text.match(/(?:[Пп]ациент|ПАЦИЕНТ|ФИО|Ф\.\s?И\.\s?О\.)\s*[:\-]?\s*([А-ЯЁ][а-яё]+(?:[ \t]+[А-ЯЁ][а-яё]+\.?){1,2})/);
  const pl = pm ? null : text.match(/(?:Patient|PATIENT|Full name)\s*[:\-]?\s*([A-Z][a-z]+(?:[ \t]+[A-Z][a-z]+\.?){1,2})/);
  const patient = pm?.[1] ?? pl?.[1] ?? null;
  const sm = text.match(/(?:Пол|Sex|Gender)\s*[:\-]?\s*(Жен|Муж|Ж|М|Female|Male|F|M)(?![а-яa-z])/i);
  const sex = sm ? (/^(ж|f)/i.test(sm[1]) ? 'female' as const : 'male' as const) : null;
  const bm = text.match(/(?:Дата рождения|Date of birth|DOB)\s*[:\-]?\s*(\d{2})[./](\d{2})[./](\d{4})/i);
  const birth_date = bm ? `${bm[3]}-${bm[2]}-${bm[1]}` : null;
  return { lab, collected_at, patient_name: patient ? patient.trim() : null, sex, birth_date };
}

/** Разбор хвоста строки после названия показателя: значение, единица, интервал, отметка. */
export function parseValuePart(rest: string, analyte?: Analyte): Omit<RecognizedRow, 'name' | 'analyte_code'> | null {
  // «см. комм.» — интервал вынесен в комментарий; числа после пометки к интервалу результата не относятся
  let s = ' ' + rest.replace(/ /g, ' ').replace(/\s+/g, ' ').replace(/(?:см|cm)\.?\s*(?:комм?|kom{1,2})\.?.*$/i, '') + ' ';
  const low: string[] = [];
  let lab_flag = '';
  const fm = s.match(/(↑|↓|\*|\s[HLВН](?=\s))/);
  if (fm) { lab_flag = fm[1].trim(); s = s.replace(fm[1], ' '); }

  let ref_low: number | null = null, ref_high: number | null = null, ref_text = '';
  const range = s.match(new RegExp(String.raw`(${NUM})\s*[-–—]\s*(${NUM})`));
  // Значение может быть записано как «< 5» — тогда это не интервал. Интервал ищем после значения.
  if (range) {
    ref_low = toNum(range[1]); ref_high = toNum(range[2]); ref_text = `${range[1]}–${range[2]}`;
    s = s.replace(range[0], ' ');
  }

  let unit = '';
  const um = s.match(UNIT_RE);
  if (um) { unit = normalizeUnit(um[1]); s = s.replace(um[1], ' '); }
  else {
    // Единица, искажённая распознаванием фото (например, «Hr/Mn»)
    const tok = s.match(/(?:^|\s)([A-Za-zА-Яа-яµ]{1,6}\/[A-Za-zА-Яа-я]{1,4})(?=\s|$)/);
    if (tok && normalizeUnit(tok[1]) !== tok[1]) { unit = normalizeUnit(tok[1]); s = s.replace(tok[1], ' '); }
  }

  const nums = [...s.matchAll(new RegExp(String.raw`([<>≤≥]\s*)?(${NUM})`, 'g'))];
  if (nums.length === 0) return null;
  const first = nums[0];
  const value_text = (first[1] ? first[1].trim() : '') + first[2];
  const value_num = first[1] ? null : toNum(first[2]);

  if (!range) {
    const rest2 = s.slice((first.index ?? 0) + first[0].length);
    const lt2 = rest2.match(new RegExp(String.raw`(?:<|≤|до)\s*(${NUM})`, 'i'));
    const gt2 = rest2.match(new RegExp(String.raw`(?:>|≥|более|от)\s*(${NUM})`, 'i'));
    if (lt2) { ref_high = toNum(lt2[1]); ref_text = `< ${lt2[1]}`; }
    else if (gt2) { ref_low = toNum(gt2[1]); ref_text = `> ${gt2[1]}`; }
  }
  // Лишние числа — возможно, перепутаны колонки
  if (nums.length > (ref_text && !range ? 2 : 1)) low.push('value');
  if (!unit) low.push('unit');
  else if (analyte && analyte.factors[unit] == null) low.push('unit');
  if (!ref_text) low.push('ref');
  return { value_num, value_text, unit, ref_low, ref_high, ref_text, lab_flag, low_confidence: low };
}

const GENERIC_LINE = new RegExp(String.raw`^([A-Za-zА-Яа-яЁё][A-Za-zА-Яа-яЁё0-9 ,()\-]{2,60}?)\s+([<>]?\s*${NUM}[*↑↓]?\s.*)$`);

export function parseLines(lines: string[]): RecognizedRow[] {
  const rows: RecognizedRow[] = [];
  for (const raw of lines) {
    const line = raw.replace(/ /g, ' ').replace(/[|¦]/g, ' ').replace(/\s+/g, ' ').trim();
    if (line.length < 4 || line.length > 200) continue;
    const m = matchAnalyteAtStart(line);
    if (m) {
      const nameEnd = line.length - m.rest.length;
      const v = parseValuePart(line.slice(nameEnd), m.analyte);
      if (!v) continue;
      rows.push({ name: m.analyte.name, analyte_code: m.analyte.code, ...v });
      continue;
    }
    const g = line.match(GENERIC_LINE);
    if (g && !/дата|тел|стр\.|страница|№|заказ|возраст|пол\b|г\.р\.|лет\b/i.test(g[1])) {
      const v = parseValuePart(g[2]);
      if (!v || (!v.unit && !v.ref_text)) continue;
      const known = findAnalyte(g[1]);
      rows.push({
        name: known?.name ?? g[1].trim(),
        analyte_code: known?.code ?? null,
        ...v,
        low_confidence: known ? v.low_confidence : ['name', ...v.low_confidence],
      });
    }
  }
  // Один показатель дважды на странице — обычно колонтитул или повтор. Оставляем первое вхождение.
  const seen = new Set<string>();
  return rows.filter((r) => {
    const k = (r.analyte_code ?? r.name) + '|' + r.value_text;
    if (seen.has(k)) return false;
    seen.add(k);
    return true;
  });
}

export function parseText(text: string) {
  const meta = parseMeta(text);
  return { ...meta, rows: parseLines(text.split(/\r?\n/)) };
}

async function pdfLines(file: Buffer): Promise<{ pages: number; lines: string[] }> {
  const pdfjs: any = await import('pdfjs-dist/legacy/build/pdf.mjs');
  const doc = await pdfjs.getDocument({ data: new Uint8Array(file), isEvalSupported: false, useSystemFonts: false, verbosity: 0 }).promise;
  const lines: string[] = [];
  try {
    for (let p = 1; p <= doc.numPages; p++) {
      const page = await doc.getPage(p);
      const content = await page.getTextContent();
      // Собираем строки по вертикальной координате
      const byY = new Map<number, { x: number; s: string }[]>();
      for (const it of content.items as any[]) {
        if (!it.str?.trim()) continue;
        const y = Math.round(it.transform[5] / 2) * 2;
        const list = byY.get(y) ?? [];
        list.push({ x: it.transform[4], s: it.str });
        byY.set(y, list);
      }
      for (const y of [...byY.keys()].sort((a, b) => b - a)) {
        lines.push(byY.get(y)!.sort((a, b) => a.x - b.x).map((t) => t.s.trim()).join(' '));
      }
    }
    return { pages: doc.numPages, lines };
  } finally {
    await doc.destroy();
  }
}

const run = promisify(execFile);

let ocrAvailable: Promise<boolean> | null = null;
/** Есть ли на сервере Tesseract с русским языком. Распознавание идёт локально, файл никуда не передаётся. */
export function hasOcr() {
  ocrAvailable ??= run('tesseract', ['--list-langs'], { timeout: 10_000 })
    .then(({ stdout, stderr }) => /\brus\b/.test(stdout + stderr))
    .catch(() => false);
  return ocrAvailable;
}

async function ocrImage(path: string) {
  // psm 6 — единый блок текста: так строки таблицы бланка не разваливаются на колонки
  const { stdout } = await run('tesseract', [path, 'stdout', '-l', 'rus+eng', '--psm', '6'], { timeout: 180_000, maxBuffer: 10 * 1024 * 1024 });
  return stdout;
}

/**
 * Подготовка изображения к распознаванию: поворот по данным камеры, увеличение мелкого текста, серый цвет.
 * Ячейки с цветной заливкой (лаборатории выделяют отклонения белым текстом на красном)
 * инвертируются — иначе Tesseract не видит в них значения.
 */
async function prepare(src: string, dir: string, n: number): Promise<string> {
  const p = (name: string) => join(dir, `${name}-${n}.png`);
  try {
    await run('convert', [src, '-auto-orient', '-resize', '2400x2400<', p('src')], { timeout: 60_000 });
    await run('convert', [p('src'), '-colorspace', 'Gray', p('gray')], { timeout: 60_000 });
    await run('convert', [p('src'), '-channel', 'R', '-separate', p('r')], { timeout: 60_000 });
    await run('convert', [p('src'), '-channel', 'G', '-separate', p('g')], { timeout: 60_000 });
    // Маска «красного»: красный канал заметно ярче зелёного, дыры от букв закрываем
    await run('convert', [p('r'), p('g'), '-compose', 'minus_src', '-composite', '-threshold', '30%', '-morphology', 'Close', 'Disk:8', p('mask')], { timeout: 60_000 });
    await run('convert', [p('gray'), '-negate', p('neg')], { timeout: 60_000 });
    await run('convert', [p('gray'), p('neg'), p('mask'), '-composite', p('prep')], { timeout: 60_000 });
    return p('prep');
  } catch {
    return src; // ImageMagick не установлен — распознаём как есть
  }
}

/** Фото или скан → текст. Временные файлы удаляются сразу после распознавания. */
async function ocr(file: Buffer, mime: string): Promise<{ text: string; pages: number }> {
  const dir = await mkdtemp(join(tmpdir(), 'nutri-ocr-'));
  try {
    if (mime === 'application/pdf') {
      await writeFile(join(dir, 'doc.pdf'), file);
      await run('pdftoppm', ['-r', '300', '-png', '-l', '10', join(dir, 'doc.pdf'), join(dir, 'p')], { timeout: 180_000 });
      const pages = (await readdir(dir)).filter((f) => /^p.*\.png$/.test(f)).sort();
      const texts: string[] = [];
      for (const [i, pg] of pages.entries()) texts.push(await ocrImage(await prepare(join(dir, pg), dir, i)));
      return { text: texts.join('\n'), pages: pages.length };
    }
    const ext = mime === 'image/png' ? 'png' : 'jpg';
    const src = join(dir, `img.${ext}`);
    await writeFile(src, file);
    return { text: await ocrImage(await prepare(src, dir, 0)), pages: 1 };
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}

/** После OCR значения нужно сверить целиком: помечаем каждую строку как требующую проверки результата. */
function fromOcr(name: string, pages: number, text: string): Recognition {
  const r = parseText(text);
  const rows = r.rows.map((x) => ({ ...x, low_confidence: [...new Set(['value', ...x.low_confidence])] }));
  return {
    recognizer: name, pages, text_found: text.replace(/\s/g, '').length > 20, ...r, rows,
    note: rows.length
      ? 'Распознано по изображению — сверьте каждое значение с бланком.'
      : 'Не удалось прочитать показатели на изображении. Попробуйте фото чётче и без бликов или внесите значения вручную.',
  };
}

export const builtinRecognizer: Recognizer = {
  name: 'builtin-pdf-text-1',
  async recognize(file, mime) {
    if (mime === 'application/pdf') {
      const { pages, lines } = await pdfLines(file);
      const text = lines.join('\n');
      if (text.replace(/\s/g, '').length < 20) {
        if (await hasOcr()) {
          const o = await ocr(file, mime);
          return fromOcr('builtin-ocr-tesseract-1', o.pages, o.text);
        }
        return { recognizer: this.name, pages, text_found: false, lab: null, collected_at: null, patient_name: null, rows: [], note: 'В PDF нет текстового слоя (похоже на скан). Внесите значения вручную.' };
      }
      const r = parseText(text);
      return { recognizer: this.name, pages, text_found: true, ...r, note: r.rows.length ? undefined : 'Не удалось найти показатели в документе. Внесите значения вручную.' };
    }
    if (await hasOcr()) {
      const o = await ocr(file, mime);
      return fromOcr('builtin-ocr-tesseract-1', o.pages, o.text);
    }
    return { recognizer: 'none', pages: 1, text_found: false, lab: null, collected_at: null, patient_name: null, rows: [], note: 'Распознавание фото пока не подключено. Внесите значения вручную — это займёт пару минут.' };
  },
};
