// Справочник показателей для распознавания, сопоставления единиц и автоматических пояснений.
// Тексты — справочные, без диагнозов и назначений. Перед работой с реальными
// клиентами справочник должен проверить медицинский редактор (см. docs/README).

export const REFERENCE_VERSION = 'ref-2026.10.2';

type Source = { title: string; url: string };

export type Analyte = {
  code: string;
  name: string;
  aliases: string[];          // в нижнем регистре, без лишних пробелов
  baseUnit: string;           // каноническая единица для динамики
  factors: Record<string, number>; // единица → множитель к baseUnit (проверенные правила)
  about: string;
  source: Source;
  /** Справочные интервалы для взрослых в baseUnit — подставляются, только если в бланке интервала нет */
  ranges?: RefRange[];
};

export type Sex = 'female' | 'male';
export type RefRange = { sex?: Sex; low?: number; high?: number; note?: string; source: Source };

const ML = (slug: string, title: string): Source => ({ title: `MedlinePlus (NIH): ${title}`, url: `https://medlineplus.gov/lab-tests/${slug}/` });

export const ANALYTES: Analyte[] = [
  {
    code: 'ferritin', name: 'Ферритин', aliases: ['ферритин', 'ferritin'],
    baseUnit: 'нг/мл', factors: { 'нг/мл': 1, 'мкг/л': 1 },
    about: 'Ферритин — белок, в котором организм хранит железо. Его уровень помогает оценить запасы железа. На показатель также влияют воспаление и другие состояния, поэтому его смотрят вместе с другими анализами.',
    source: ML('ferritin-blood-test', 'Ferritin Blood Test'),
    ranges: [{ sex: 'female', low: 13, high: 150, source: { title: 'MedlinePlus (NIH): Ferritin blood test', url: 'https://medlineplus.gov/ency/article/003490.htm' } }, { sex: 'male', low: 30, high: 400, source: { title: 'MedlinePlus (NIH): Ferritin blood test', url: 'https://medlineplus.gov/ency/article/003490.htm' } }],
  },
  {
    code: 'vitamin_d', name: 'Витамин D (25-OH)', aliases: ['витамин d', '25-oh витамин d', '25(oh)d', '25-он витамин d', 'витамин d, 25-гидрокси', '25-гидроксикальциферол', 'vitamin d', '25-oh vitamin d', '25-hydroxyvitamin d', 'витамин d (25-oh)', 'витамин 25(oh) d', 'витамин 25(oh)', 'витамин 25-oh', 'витамин 25-oh d', 'витамин d 25(oh)', '25(oh) витамин d', '25-oh d', 'витамин 25 (oh) d'],
    baseUnit: 'нг/мл', factors: { 'нг/мл': 1, 'нмоль/л': 1 / 2.496 },
    about: '25-OH витамин D — основная форма витамина D в крови, по которой оценивают его обеспеченность. Витамин D участвует в обмене кальция и фосфора.',
    source: ML('vitamin-d-test', 'Vitamin D Test'),
    ranges: [{ low: 30, high: 80, note: 'уровень, который рекомендуют многие эксперты', source: { title: 'MedlinePlus (NIH): 25-hydroxy vitamin D test', url: 'https://medlineplus.gov/ency/article/003569.htm' } }],
  },
  {
    code: 'vitamin_b12', name: 'Витамин B12', aliases: ['витамин b12', 'витамин в12', 'цианокобаламин', 'кобаламин', 'vitamin b12', 'b12'],
    baseUnit: 'пг/мл', factors: { 'пг/мл': 1, 'пмоль/л': 1 / 0.738 },
    about: 'Витамин B12 нужен для образования клеток крови и работы нервной системы. Анализ показывает его количество в крови.',
    source: ML('vitamin-b-test', 'Vitamin B Test'),
    ranges: [{ low: 299, high: 1054, source: { title: 'MedlinePlus (NIH): Vitamin B12 level', url: 'https://medlineplus.gov/ency/article/003705.htm' } }],
  },
  {
    code: 'folate', name: 'Фолиевая кислота', aliases: ['фолиевая кислота', 'фолаты', 'витамин b9', 'витамин в9', 'folate', 'folic acid'],
    baseUnit: 'нг/мл', factors: { 'нг/мл': 1, 'нмоль/л': 1 / 2.266 },
    about: 'Фолаты (витамин B9) участвуют в делении клеток и образовании клеток крови. Анализ показывает их уровень в крови.',
    source: ML('vitamin-b-test', 'Vitamin B Test'),
    ranges: [{ low: 2.7, high: 17, source: { title: 'MedlinePlus (NIH): Folic acid test', url: 'https://medlineplus.gov/ency/article/003686.htm' } }],
  },
  {
    code: 'magnesium', name: 'Магний', aliases: ['магний', 'magnesium', 'mg'],
    baseUnit: 'ммоль/л', factors: { 'ммоль/л': 1, 'мг/дл': 1 / 2.431 },
    about: 'Магний участвует в работе мышц, нервов и обмене энергии. Анализ крови показывает его уровень в сыворотке — это лишь часть всего магния в организме.',
    source: ML('magnesium-blood-test', 'Magnesium Blood Test'),
    ranges: [{ low: 0.70, high: 0.91, source: { title: 'MedlinePlus (NIH): Magnesium blood test', url: 'https://medlineplus.gov/ency/article/003487.htm' } }],
  },
  {
    code: 'iron', name: 'Железо сывороточное', aliases: ['железо', 'железо сывороточное', 'сывороточное железо', 'iron', 'serum iron'],
    baseUnit: 'мкмоль/л', factors: { 'мкмоль/л': 1, 'мкг/дл': 1 / 5.585 },
    about: 'Сывороточное железо — количество железа, циркулирующего в крови. Показатель меняется в течение дня, поэтому его оценивают вместе с ферритином и другими параметрами обмена железа.',
    source: ML('iron-tests', 'Iron Tests'),
    ranges: [{ sex: 'female', low: 6.6, high: 25.9, source: { title: 'MedlinePlus (NIH): Serum iron test', url: 'https://medlineplus.gov/ency/article/003488.htm' } }, { sex: 'male', low: 10.6, high: 28.3, source: { title: 'MedlinePlus (NIH): Serum iron test', url: 'https://medlineplus.gov/ency/article/003488.htm' } }],
  },
  {
    code: 'hemoglobin', name: 'Гемоглобин', aliases: ['гемоглобин', 'hgb', 'hb', 'hemoglobin'],
    baseUnit: 'г/л', factors: { 'г/л': 1, 'г/дл': 10 },
    about: 'Гемоглобин — белок эритроцитов, который переносит кислород. Его определяют в общем анализе крови.',
    source: ML('hemoglobin-test', 'Hemoglobin Test'),
    ranges: [{ sex: 'female', low: 121, high: 151, source: { title: 'MedlinePlus (NIH): Hemoglobin', url: 'https://medlineplus.gov/ency/article/003645.htm' } }, { sex: 'male', low: 138, high: 172, source: { title: 'MedlinePlus (NIH): Hemoglobin', url: 'https://medlineplus.gov/ency/article/003645.htm' } }],
  },
  {
    code: 'tsh', name: 'ТТГ', aliases: ['ттг', 'тиреотропный гормон', 'tsh', 'тиреотропный гормон (ттг)', 'tтг', 'ttг', 'ттr', 'ttr', 'ttp', 'tip', 'tif', 'ttf'],
    baseUnit: 'мМЕ/л', factors: { 'мМЕ/л': 1 },
    about: 'ТТГ (тиреотропный гормон) вырабатывается гипофизом и регулирует работу щитовидной железы.',
    source: ML('tsh-thyroid-stimulating-hormone-test', 'TSH Test'),
    ranges: [{ low: 0.4, high: 4.8, source: { title: 'MedlinePlus (NIH): TSH test', url: 'https://medlineplus.gov/ency/article/003684.htm' } }],
  },
  {
    code: 'free_t4', name: 'Т4 свободный', aliases: ['т4 свободный', 'свободный т4', 'free t4', 'ft4', 'тироксин свободный'],
    baseUnit: 'пмоль/л', factors: { 'пмоль/л': 1, 'нг/дл': 1 / 0.0777 },
    about: 'Свободный Т4 — гормон щитовидной железы, не связанный с белками крови. Его обычно смотрят вместе с ТТГ.',
    source: ML('thyroxine-t4-test', 'Thyroxine (T4) Test'),
    ranges: [{ low: 10.3, high: 24.5, source: { title: 'MedlinePlus (NIH): Free T4 test', url: 'https://medlineplus.gov/ency/article/003517.htm' } }],
  },
  {
    code: 'glucose', name: 'Глюкоза', aliases: ['глюкоза', 'глюкоза крови', 'glucose'],
    baseUnit: 'ммоль/л', factors: { 'ммоль/л': 1, 'мг/дл': 1 / 18.016 },
    about: 'Глюкоза — основной источник энергии для клеток. Уровень в крови зависит от приёма пищи, поэтому важно, сдан ли анализ натощак.',
    source: ML('blood-glucose-test', 'Blood Glucose Test'),
    ranges: [{ low: 3.9, high: 5.5, note: 'натощак', source: { title: 'MedlinePlus (NIH): Blood sugar test', url: 'https://medlineplus.gov/ency/article/003482.htm' } }],
  },
  {
    code: 'hba1c', name: 'Гликированный гемоглобин', aliases: ['гликированный гемоглобин', 'hba1c', 'гликозилированный гемоглобин'],
    baseUnit: '%', factors: { '%': 1 },
    about: 'Гликированный гемоглобин отражает средний уровень глюкозы в крови примерно за последние 2–3 месяца.',
    source: ML('hemoglobin-a1c-hba1c-test', 'Hemoglobin A1C (HbA1c) Test'),
    ranges: [{ high: 5.7, source: { title: 'MedlinePlus (NIH): A1C test', url: 'https://medlineplus.gov/ency/article/003640.htm' } }],
  },
  {
    code: 'cholesterol', name: 'Холестерин общий', aliases: ['холестерин', 'холестерин общий', 'общий холестерин', 'cholesterol', 'total cholesterol'],
    baseUnit: 'ммоль/л', factors: { 'ммоль/л': 1, 'мг/дл': 1 / 38.67 },
    about: 'Общий холестерин — сумма холестерина во всех липопротеинах крови. Его оценивают вместе с другими показателями липидного профиля.',
    source: ML('cholesterol-levels', 'Cholesterol Levels'),
  },
  {
    code: 'calcium', name: 'Кальций общий', aliases: ['кальций', 'кальций общий', 'calcium'],
    baseUnit: 'ммоль/л', factors: { 'ммоль/л': 1, 'мг/дл': 1 / 4.008 },
    about: 'Кальций нужен для костей, работы мышц и нервов. Анализ показывает общий кальций в крови.',
    source: ML('calcium-blood-test', 'Calcium Blood Test'),
    ranges: [{ low: 2.20, high: 2.58, source: { title: 'MedlinePlus (NIH): Calcium blood test', url: 'https://medlineplus.gov/ency/article/003477.htm' } }],
  },
  {
    code: 'zinc', name: 'Цинк', aliases: ['цинк', 'zinc', 'zn'],
    baseUnit: 'мкмоль/л', factors: { 'мкмоль/л': 1, 'мкг/дл': 1 / 6.54 },
    about: 'Цинк участвует в работе ферментов и иммунной системы. Уровень в крови зависит от времени забора и приёма пищи.',
    source: { title: 'NIH Office of Dietary Supplements: Zinc', url: 'https://ods.od.nih.gov/factsheets/Zinc-HealthProfessional/' },
  },
  {
    code: 'homocysteine', name: 'Гомоцистеин', aliases: ['гомоцистеин', 'homocysteine'],
    baseUnit: 'мкмоль/л', factors: { 'мкмоль/л': 1 },
    about: 'Гомоцистеин — аминокислота, обмен которой связан с витаминами B12, B6 и фолатами.',
    source: ML('homocysteine-test', 'Homocysteine Test'),
  },
  {
    code: 'crp', name: 'С-реактивный белок', aliases: ['с-реактивный белок', 'срб', 'crp', 'c-реактивный белок', 'с-реактивный белок (срб)'],
    baseUnit: 'мг/л', factors: { 'мг/л': 1, 'мг/дл': 10 },
    about: 'С-реактивный белок вырабатывается печенью и повышается при воспалении. Сам по себе показатель не указывает на причину.',
    source: ML('c-reactive-protein-crp-test', 'C-Reactive Protein (CRP) Test'),
  },
];

const UNIT_ALIASES: Record<string, string> = {
  'нг/мл': 'нг/мл', 'ng/ml': 'нг/мл',
  'мкг/л': 'мкг/л', 'µg/l': 'мкг/л', 'ug/l': 'мкг/л', 'mcg/l': 'мкг/л',
  'нмоль/л': 'нмоль/л', 'nmol/l': 'нмоль/л',
  'пг/мл': 'пг/мл', 'pg/ml': 'пг/мл',
  'пмоль/л': 'пмоль/л', 'pmol/l': 'пмоль/л',
  'ммоль/л': 'ммоль/л', 'mmol/l': 'ммоль/л',
  'мкмоль/л': 'мкмоль/л', 'µmol/l': 'мкмоль/л', 'umol/l': 'мкмоль/л', 'мкмоль/ л': 'мкмоль/л',
  'мг/дл': 'мг/дл', 'mg/dl': 'мг/дл',
  'мкг/дл': 'мкг/дл', 'µg/dl': 'мкг/дл', 'ug/dl': 'мкг/дл', 'mcg/dl': 'мкг/дл',
  'нг/дл': 'нг/дл', 'ng/dl': 'нг/дл',
  'г/л': 'г/л', 'g/l': 'г/л',
  'г/дл': 'г/дл', 'g/dl': 'г/дл',
  'мг/л': 'мг/л', 'mg/l': 'мг/л',
  'мме/л': 'мМЕ/л', 'мкме/мл': 'мМЕ/л', 'мед/л': 'мМЕ/л', 'мкед/мл': 'мМЕ/л',
  'miu/l': 'мМЕ/л', 'µiu/ml': 'мМЕ/л', 'uiu/ml': 'мМЕ/л', 'мме/ л': 'мМЕ/л',
  'ед/л': 'Ед/л', 'u/l': 'Ед/л', 'iu/l': 'Ед/л', 'ме/л': 'Ед/л',
  'млн/мкл': 'млн/мкл', 'тыс/мкл': 'тыс/мкл', '10^12/л': 'млн/мкл', '10^9/л': 'тыс/мкл', '10*12/л': 'млн/мкл', '10*9/л': 'тыс/мкл',
  'фл': 'фл', 'fl': 'фл', 'пг': 'пг', 'pg': 'пг', 'мм/ч': 'мм/ч', 'mm/h': 'мм/ч',
  '%': '%',
};

export const KNOWN_UNIT_PATTERN = Object.keys(UNIT_ALIASES)
  .sort((a, b) => b.length - a.length)
  .map((u) => u.replace(/[.*+?^${}()|[\]\\/]/g, '\\$&'))
  .join('|');

const TO_CYR: Record<string, string> = { a: 'а', b: 'в', c: 'с', e: 'е', h: 'н', k: 'к', m: 'м', n: 'п', o: 'о', p: 'р', r: 'г', t: 'т', u: 'и', x: 'х', y: 'у' };

export function normalizeUnit(raw: string): string {
  const k = raw.trim().toLowerCase().replace(/\s+/g, '');
  const hit = UNIT_ALIASES[k] ?? UNIT_ALIASES[raw.trim().toLowerCase()];
  if (hit) return hit;
  // Единицы после распознавания фото: «Hr/Mn» → «нг/мл». Латиницу, похожую на кириллицу, переводим,
  // а «п» после косой черты — частая ошибка вместо «л».
  if (k.includes('/')) {
    const cyr = k.replace(/[a-z]/g, (c) => TO_CYR[c] ?? c);
    const [num, den = ''] = cyr.split('/');
    const fixed = `${num}/${den.replace(/^мп$/, 'мл').replace(/п$/, 'л')}`;
    if (UNIT_ALIASES[fixed]) return UNIT_ALIASES[fixed];
  }
  return raw.trim();
}

// Распознавание путает похожие кириллические и латинские буквы («ОН» и «OH», «D» и «В»),
// поэтому названия сравниваются после сведения похожих букв к одной форме. Замена 1:1, длина строки не меняется.
const LOOKALIKE: Record<string, string> = { а: 'a', в: 'b', е: 'e', к: 'k', м: 'm', н: 'h', о: 'o', р: 'p', с: 'c', т: 't', у: 'y', х: 'x', d: 'b' };
const fold = (s: string) => s.replace(/[авекмнорстухd]/g, (c) => LOOKALIKE[c] ?? c);
const norm = (s: string) => fold(s.toLowerCase().replace(/ё/g, 'е').replace(/[«»"]/g, '').replace(/\s+/g, ' ').trim());

const aliasIndex: { alias: string; a: Analyte }[] = ANALYTES
  .flatMap((a) => a.aliases.map((alias) => ({ alias: norm(alias), a })))
  .sort((x, y) => y.alias.length - x.alias.length);

export function findAnalyte(name: string): Analyte | undefined {
  const n = norm(name);
  const exact = aliasIndex.find((x) => x.alias === n);
  if (exact) return exact.a;
  // Названия в бланках часто с уточнениями: «Ферритин (сыворотка)»
  return aliasIndex.find((x) => x.alias.length >= 3 && (n.startsWith(x.alias + ' ') || n.startsWith(x.alias + ',') || n.startsWith(x.alias + ' (')))?.a;
}

/** Начинается ли строка с известного показателя — для распознавания. */
export function matchAnalyteAtStart(line: string): { analyte: Analyte; rest: string } | undefined {
  const n = norm(line);
  for (const { alias, a } of aliasIndex) {
    if (alias.length < 3 && !/^[a-zа-я]{2}\b/.test(alias)) continue;
    if (n.startsWith(alias)) {
      const next = n.charAt(alias.length);
      if (next && /[a-zа-я0-9]/.test(next)) continue;
      return { analyte: a, rest: n.slice(alias.length) };
    }
  }
  return undefined;
}

export const getAnalyte = (code?: string | null) => ANALYTES.find((a) => a.code === code);

/** Переводит значение в базовую единицу показателя, только если правило перевода известно. */
export function toBase(a: Analyte | undefined, value: number | null, unit: string): { value: number; unit: string; factor: number } | null {
  if (!a || value == null) return null;
  const f = a.factors[normalizeUnit(unit)];
  if (f == null) return null;
  return { value: value * f, unit: a.baseUnit, factor: f };
}

// ---------- Справочные интервалы ----------

export type Profile = { sex?: string | null; birth_date?: string | null };

export function ageOn(birth: string | null | undefined, date: string) {
  if (!birth) return null;
  const [by, bm, bd] = birth.split('-').map(Number);
  const [y, m, d] = date.split('-').map(Number);
  return y - by - (m < bm || (m === bm && d < bd) ? 1 : 0);
}

/**
 * Справочный интервал для взрослых в единицах результата. null — если для показателя
 * нет данных, единицы нельзя перевести, интервал зависит от пола, а пол не указан, или человек младше 18.
 */
export function referenceRange(code: string | null, unit: string, profile: Profile, date?: string | null) {
  const a = getAnalyte(code);
  if (!a?.ranges?.length) return null;
  const age = date ? ageOn(profile.birth_date, date) : null;
  if (age != null && age < 18) return null;
  const bySex = a.ranges.some((r) => r.sex);
  const r = bySex ? a.ranges.find((x) => x.sex === profile.sex) : a.ranges[0];
  if (!r) return { missing: 'sex' as const };
  const f = a.factors[normalizeUnit(unit)];
  if (f == null) return null;
  const conv = (v?: number) => (v == null ? null : Math.round((v / f) * 1000) / 1000);
  const low = conv(r.low), high = conv(r.high);
  const text = low != null && high != null ? `${fmt(low)}–${fmt(high)}` : high != null ? `< ${fmt(high)}` : `> ${fmt(low!)}`;
  const who = r.sex === 'female' ? 'для взрослых женщин' : r.sex === 'male' ? 'для взрослых мужчин' : 'для взрослых';
  return { low, high, text, note: `Справочный интервал ${who}${r.note ? `, ${r.note}` : ''}. Источник: ${r.source.title}`, source: r.source };
}

// ---------- Автоматическое пояснение ----------

export type ExplanationInput = {
  name: string; analyte_code: string | null; value_num: number | null; value_text: string;
  unit: string; ref_low: number | null; ref_high: number | null; ref_text: string; lab_flag: string;
  ref_source?: string | null; ref_note?: string | null;
};

export type Explanation = { status: 'ok' | 'insufficient'; text: string; source?: Source };

const fmt = (n: number) => String(Math.round(n * 1000) / 1000).replace('.', ',');

export function explain(r: ExplanationInput): Explanation {
  const a = getAnalyte(r.analyte_code);
  if (!a) {
    return { status: 'insufficient', text: `В справочнике пока нет описания показателя «${r.name}», поэтому автоматическое пояснение не сформировано. Значение и интервал из бланка показаны выше.` };
  }
  const parts = [a.about];
  if (r.value_num == null) {
    parts.push(`Результат записан как «${r.value_text}» — это не число, поэтому сравнить его с интервалом автоматически нельзя.`);
    return { status: 'insufficient', text: parts.join('\n\n'), source: a.source };
  }
  const v = `${fmt(r.value_num)} ${r.unit}`.trim();
  if (r.ref_low == null && r.ref_high == null) {
    parts.push(r.ref_note === 'sex'
      ? `Результат: ${v}. Интервал для этого показателя зависит от пола — укажите пол в профиле, и мы сравним значение со справочным.`
      : `Результат: ${v}. В бланке нет референсного интервала, а справочного для этого показателя у нас нет, поэтому автоматически сравнить значение не получится.`);
    return { status: 'insufficient', text: parts.join('\n\n'), source: a.source };
  }
  const ref = r.ref_text || [r.ref_low != null ? `от ${fmt(r.ref_low)}` : '', r.ref_high != null ? `до ${fmt(r.ref_high)}` : ''].filter(Boolean).join(' ');
  let pos = 'в пределах интервала, указанного лабораторией';
  if (r.ref_low != null && r.value_num < r.ref_low) pos = 'ниже нижней границы интервала, указанного лабораторией';
  if (r.ref_high != null && r.value_num > r.ref_high) pos = 'выше верхней границы интервала, указанного лабораторией';
  if (r.ref_source === 'reference') {
    pos = pos.replace('указанного лабораторией', 'справочного');
    parts.push(`Результат: ${v}. В бланке нет интервала, поэтому сравниваем со справочным: ${ref}${r.unit ? ' ' + r.unit : ''}. Значение ${pos}. Лаборатории могут использовать свои интервалы — если в бланке есть комментарий, ориентируйтесь на него.`);
  } else {
    parts.push(`Результат: ${v}. Интервал из бланка: ${ref}${r.unit ? ' ' + r.unit : ''}. Значение ${pos}.`);
  }
  if (r.lab_flag) parts.push(`В бланке есть отметка лаборатории: «${r.lab_flag}».`);
  parts.push('Выход за интервал сам по себе не диагноз: у отклонений бывают разные причины. Что это значит именно для вас, объяснит специалист.');
  return { status: 'ok', text: parts.join('\n\n'), source: a.source };
}
