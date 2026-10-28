import { useState, type FormEvent } from 'react';
import { Link, useParams } from 'react-router-dom';
import { api, type Scheme, type SchemeItem, type Version } from '../api';
import { addDays, amountLabel, daysBetween, doseLabel, fmtDate, fmtShort, FOOD_LABELS, FORM_LABELS, freqLabel, PART_LABELS, ty, WD_SHORT, weekdayIdx } from '../format';
import { Empty, Field, Icon, Loader, SchemeBadge, Seg, Sheet, errorText, useData, useToast } from '../ui';

export function ItemView({ it, today }: { it: SchemeItem; today: string }) {
  const future = it.start_date > today;
  const ended = it.end_date < today;
  return (
    <div className="list-item" style={{ alignItems: 'flex-start' }}>
      <span className="item-num" aria-hidden="true"><Icon name="pill" size={16} /></span>
      <div className="grow">
        <div className="row wrap between">
          <span className="list-title">{it.name}</span>
          {future && <span className="badge planned">с {fmtDate(it.start_date)}</span>}
          {ended && <span className="badge">завершено</span>}
        </div>
        {it.product && <div className="small muted">{it.product} · {FORM_LABELS[it.form]?.toLowerCase()}</div>}
        <div className="mt-8">
          <b>{amountLabel(it.amount, it.amount_unit)}</b>
          {it.substance_amount != null && it.substance_amount !== '' && <span className="muted"> ({amountLabel(it.substance_amount, it.substance_unit ?? '')} вещества)</span>}
          <span> · {it.doses.map(doseLabel).join(', ')} · {freqLabel(it.frequency)} · {FOOD_LABELS[it.food]}</span>
        </div>
        <div className="small muted">{fmtDate(it.start_date)} — {fmtDate(it.end_date, { year: true })}</div>
        {it.instruction && <div className="intake-note">{it.instruction}</div>}
      </div>
    </div>
  );
}

export function ChangesView({ v }: { v: Version }) {
  if (!v.changes?.length) return null;
  return (
    <div className="diff">
      {v.changes.map((c, k) => (
        <div key={k} className={`diff-item ${c.kind}`}>
          <b>{c.name}</b> — {c.kind === 'added' ? 'добавлено' : c.kind === 'removed' ? 'убрано из схемы' : 'изменено'}
          {c.fields?.map((f) => (
            <div key={f.field} className="small">{f.field}: <del>{f.before}</del> → <b>{f.after}</b></div>
          ))}
        </div>
      ))}
    </div>
  );
}

function SchemeCard({ s }: { s: Scheme }) {
  const v = s.current!;
  const items = [...v.items].sort((a, b) => a.start_date.localeCompare(b.start_date));
  const later = items.filter((i) => i.start_date > s.today);
  const updated = v.number > 1 && v.changes?.length;
  return (
    <div className="card">
      <div className="row between top">
        <div className="grow">
          <h2>{v.title}</h2>
          <p className="small muted">{s.added_by_client ? `Назначил(-а): ${s.specialist_name} · добавлено вами` : `${s.specialist_name} · опубликовано ${fmtDate(v.published_at!.slice(0, 10))}`}</p>
        </div>
        <SchemeBadge status={s.status} />
      </div>
      <div className="row wrap mt-8 small">
        <span><Icon name="calendar" size={16} className="chev" /> {fmtDate(v.start_date)} — {fmtDate(v.end_date, { year: true })}</span>
        {v.control_date && <span className="badge auto">Контрольные анализы {fmtDate(v.control_date)}</span>}
      </div>
      {v.comment && <div className="level spec mt-16"><div className="level-head"><span className="badge spec">Комментарий специалиста</span></div><p>{v.comment}</p></div>}
      {updated ? (
        <div className="notice warn mt-16" style={{ display: 'block' }}>
          <b>{ty(`Схема обновлена — изменения действуют с ${fmtDate(v.effective_from!)}`)}</b>
          <div className="mt-8"><ChangesView v={v} /></div>
        </div>
      ) : null}
      {s.status === 'scheduled' && (
        <div className="list mt-8">{items.map((it) => <ItemView key={it.id} it={it} today={s.today} />)}</div>
      )}
      {s.status !== 'scheduled' && later.length > 0 && (
        <>
          <h3 className="mt-16">Следующие этапы</h3>
          <div className="list">{later.map((it) => <ItemView key={it.id} it={it} today={s.today} />)}</div>
        </>
      )}
      <Link to={`/scheme/${s.id}`} className="btn ghost small mt-8">История версий <Icon name="right" size={16} /></Link>
    </div>
  );
}

// ---------- Общий план: назначенное и своё вместе, по времени дня ----------

const PARTS = [
  { key: 'morning', label: 'Утро' },
  { key: 'day', label: 'День' },
  { key: 'evening', label: 'Вечер' },
  { key: 'night', label: 'Перед сном' },
  { key: 'any', label: 'Время не указано' },
] as const;
type PartKey = (typeof PARTS)[number]['key'];

function partOfTime(t: string): PartKey {
  const m = Number(t.slice(0, 2)) * 60 + Number(t.slice(3, 5));
  return m < 12 * 60 ? 'morning' : m < 17 * 60 ? 'day' : m < 21 * 60 + 30 ? 'evening' : 'night';
}

/** Время своей добавки записано словами: «утром и вечером», «перед сном», «09:00». */
function partsOfText(text: string): PartKey[] {
  const t = text.toLowerCase();
  const out = new Set<PartKey>();
  if (/утр/.test(t)) out.add('morning');
  if (/(^|[^а-яё])(днём|днем|день)|обед/.test(t)) out.add('day');
  if (/веч|ужин/.test(t)) out.add('evening');
  if (/сном|до сна|ноч/.test(t)) out.add('night');
  for (const m of t.matchAll(/\b(\d{1,2}):(\d{2})\b/g)) out.add(partOfTime(m[1].padStart(2, '0') + ':' + m[2]));
  return out.size ? [...out] : ['any'];
}

type PlanRow = { key: string; part: PartKey; sort: string; own: boolean; name: string; sub: string; detail: string; note?: string; time?: string; ownId?: string; scheme?: string };

function planRows(schemes: Scheme[], own: any[], today: string): PlanRow[] {
  const rows: PlanRow[] = [];
  const several = schemes.length > 1;
  for (const s of schemes) {
    for (const it of s.current!.items) {
      if (it.start_date > today || it.end_date < today) continue;
      it.doses.forEach((d, k) => {
        const part: PartKey = d.time ? partOfTime(d.time) : (d.part as PartKey) ?? 'any';
        rows.push({
          key: `${it.id}-${k}`, part, sort: d.time ?? PART_LABELS[d.part!]?.time ?? '', own: false, name: it.name,
          sub: [it.product, amountLabel(it.amount, it.amount_unit)].filter(Boolean).join(' · '),
          detail: [freqLabel(it.frequency), FOOD_LABELS[it.food]?.toLowerCase(), `до ${fmtDate(it.end_date)}`].filter(Boolean).join(' · '),
          note: it.instruction || undefined, time: d.time || undefined, scheme: several ? s.current!.title : undefined,
        });
      });
    }
  }
  for (const o of own) {
    if (o.end_date && o.end_date < today) continue;
    for (const part of partsOfText(o.schedule ?? '')) {
      rows.push({
        key: `${o.id}-${part}`, part, sort: '99', own: true, name: o.name, sub: o.amount ?? '',
        detail: [o.start_date && o.start_date > today ? `с ${fmtDate(o.start_date)}` : '', o.end_date ? `до ${fmtDate(o.end_date)}` : ''].filter(Boolean).join(' · '),
        note: o.note || undefined, ownId: o.id,
      });
    }
  }
  return rows.sort((a, b) => a.sort.localeCompare(b.sort) || a.name.localeCompare(b.name));
}

function PlanItem({ r, onDelete }: { r: PlanRow; onDelete: (id: string, name: string) => void }) {
  return (
    <div className={`list-item plan-item${r.own ? ' own' : ''}`} style={{ alignItems: 'flex-start' }}>
      <span className="item-num" aria-hidden="true"><Icon name={r.own ? 'leaf' : 'pill'} size={16} /></span>
      <div className="grow">
        <div className="row wrap between">
          <span className="list-title">{r.name}</span>
          {r.own ? <span className="badge auto">Своё</span> : r.time ? <span className="small muted num">{r.time}</span> : null}
        </div>
        {r.sub && <div><b>{r.sub}</b></div>}
        {r.detail && <div className="small muted">{r.detail}</div>}
        {r.scheme && <div className="small muted">{r.scheme}</div>}
        {r.note && <div className="intake-note">{r.note}</div>}
      </div>
      {r.ownId && <button className="btn ghost icon small" onClick={() => onDelete(r.ownId!, r.name)} aria-label={`Удалить ${r.name}`}><Icon name="trash" size={18} /></button>}
    </div>
  );
}

function Plan({ schemes, all }: { schemes: Scheme[]; all: Scheme[] }) {
  const own = useData(() => api.get<any[]>('/clients/me/self-supplements'), []);
  const [open, setOpen] = useState(false);
  const [view, setView] = useState<'list' | 'week'>(() => { try { return localStorage.getItem('nutri-plan-view') === 'week' ? 'week' : 'list'; } catch { return 'list'; } });
  const pickView = (v: 'list' | 'week') => { setView(v); try { localStorage.setItem('nutri-plan-view', v); } catch { /* без хранилища */ } };
  const toast = useToast();
  const today = all[0]?.today ?? schemes[0]?.today ?? new Date().toISOString().slice(0, 10);
  const del = async (id: string, name: string) => {
    if (!confirm(`Убрать «${name}» из плана?`)) return;
    try { await api.del(`/clients/me/self-supplements/${id}`); own.reload(); } catch (e) { toast(errorText(e)); }
  };
  const rows = planRows(schemes.filter((s) => s.status === 'active'), own.data ?? [], today);
  return (
    <div className="card">
      <div style={{ marginBottom: 16 }}><Seg label="Вид" value={view} onChange={pickView} options={[{ value: 'list', label: 'Список' }, { value: 'week', label: 'Неделя' }]} /></div>
      {!own.data ? <Loader error={own.error} /> : view === 'week' ? <WeekView schemes={all} own={own.data} today={today} /> : rows.length === 0 ? (
        <Empty icon="pill" title="План пока пуст">{ty('Здесь будет всё, что вы принимаете: схема специалиста и ваши добавки')}</Empty>
      ) : (
        <div className="stack" style={{ '--gap': '20px' } as any}>
          {PARTS.map((p) => {
            const list = rows.filter((r) => r.part === p.key);
            if (!list.length) return null;
            return (
              <section key={p.key}>
                <h3 className="plan-part">{p.label}</h3>
                <div className="list">{list.map((r) => <PlanItem key={r.key} r={r} onDelete={del} />)}</div>
              </section>
            );
          })}
        </div>
      )}
      <p className="small muted mt-16">{ty('«Своё» — то, что вы принимаете сами, вне схемы. Специалист это тоже видит.')}</p>
      <button className="btn outline block mt-8" onClick={() => setOpen(true)}><Icon name="plus" />Добавить своё</button>
      {open && <Sheet title="Своя добавка" onClose={() => setOpen(false)}><SelfForm onDone={() => { setOpen(false); own.reload(); }} /></Sheet>}
    </div>
  );
}

// ---------- Перенос схем самим клиентом ----------

function ImportOwn({ onDone }: { onDone: () => void }) {
  const access = useData(() => api.get('/me/access'), []);
  const mine: string | undefined = access.data?.active?.specialist_name;
  const [by, setBy] = useState<'mine' | 'other' | null>(null);
  const [name, setName] = useState('');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');
  const toast = useToast();
  const who = by ?? (mine ? 'mine' : 'other');
  const [text, setText] = useState('');
  const send = async (raw: string) => {
    setBusy(true); setErr('');
    try {
      const data = JSON.parse(raw);
      const body = { ...(Array.isArray(data) ? { schemes: data } : data), prescribed_by: who, specialist_name: name };
      const r = await api.post<{ imported: number }>('/clients/me/schemes/import', body);
      toast(`Перенесено схем: ${r.imported}`);
      setText('');
      onDone();
    } catch (e) { setErr(e instanceof SyntaxError ? 'Не похоже на схемы: скопируйте текст целиком, от первой { до последней }' : errorText(e)); } finally { setBusy(false); }
  };
  const pick = async (file: File | undefined) => { if (file) await send(await file.text()); };
  return (
    <div className="card stack">
      <div><h3>Перенести схемы</h3><p className="small muted">{ty('Схемы, которые назначали раньше или вне сервиса. Прошлые попадут в историю, текущие — в план.')}</p></div>
      <div>
        <div className="label">Кто назначил</div>
        <div className="mt-8"><Seg label="Кто назначил" value={who} onChange={(v) => setBy(v)}
          options={[...(mine ? [{ value: 'mine' as const, label: mine }] : []), { value: 'other' as const, label: 'Другой специалист' }]} /></div>
      </div>
      {who === 'other' && (
        <Field label="Имя специалиста" htmlFor="imp-name" hint="Необязательно"><input id="imp-name" className="input" value={name} onChange={(e) => setName(e.target.value)} placeholder="Например, Анна Петрова" /></Field>
      )}
      <Field label="Текст схем" htmlFor="imp-text" hint="Вставьте скопированный текст или выберите файл">
        <textarea id="imp-text" className="textarea" rows={4} value={text} onChange={(e) => setText(e.target.value)} placeholder='{"schemes": [...]}' spellCheck={false} />
      </Field>
      {text.trim() ? (
        <button className="btn primary block" disabled={busy} onClick={() => send(text)}>{busy ? 'Переносим…' : 'Перенести'}</button>
      ) : (
        <label className={`btn outline block${busy ? ' disabled' : ''}`}>
          <Icon name="upload" />{busy ? 'Переносим…' : 'Выбрать файл'}
          <input type="file" accept=".json,application/json,text/plain" hidden disabled={busy} onChange={(e) => { pick(e.target.files?.[0]); e.target.value = ''; }} />
        </label>
      )}
      {err && <p className="small" style={{ color: 'var(--danger)' }} role="alert">{err}</p>}
    </div>
  );
}

// ---------- Календарь на неделю ----------

function occurs(it: SchemeItem, d: string) {
  if (d < it.start_date || d > it.end_date) return false;
  const f = it.frequency;
  if (f.type === 'weekdays') return f.days.includes(weekdayIdx(d));
  if (f.type === 'every_other_day') return daysBetween(it.start_date, d) % 2 === 0;
  return true;
}

type CalRow = { key: string; part: PartKey; name: string; sub: string; own: boolean; on: (d: string) => boolean };

function calRows(schemes: Scheme[], own: any[], days: string[]): CalRow[] {
  const map = new Map<string, CalRow>();
  const add = (r: CalRow) => {
    const prev = map.get(r.key);
    // Этапы одной добавки (например, цинк 2 недели из 4) — одна строка
    map.set(r.key, prev ? { ...prev, on: (d) => prev.on(d) || r.on(d) } : r);
  };
  for (const s of schemes) for (const it of s.current!.items) {
    if (it.end_date < days[0] || it.start_date > days[6]) continue;
    const parts = new Set(it.doses.map((d) => (d.time ? partOfTime(d.time) : (d.part as PartKey) ?? 'any')));
    const sub = amountLabel(it.amount, it.amount_unit) + (it.substance_amount != null && it.substance_amount !== '' ? ` · ${amountLabel(it.substance_amount, it.substance_unit ?? '')}` : '');
    for (const part of parts) add({ key: `s|${part}|${it.name}|${sub}`, part, name: it.name, sub, own: false, on: (d) => occurs(it, d) });
  }
  for (const o of own) {
    if ((o.end_date && o.end_date < days[0]) || (o.start_date && o.start_date > days[6])) continue;
    for (const part of partsOfText(o.schedule ?? '')) {
      add({ key: `o|${part}|${o.id}`, part, name: o.name, sub: o.amount ?? '', own: true,
        on: (d) => (!o.start_date || o.start_date <= d) && (!o.end_date || o.end_date >= d) });
    }
  }
  return [...map.values()].filter((r) => days.some(r.on));
}

function WeekView({ schemes, own, today }: { schemes: Scheme[]; own: any[]; today: string }) {
  const [start, setStart] = useState(() => addDays(today, 1 - weekdayIdx(today)));
  const days = Array.from({ length: 7 }, (_, i) => addDays(start, i));
  const rows = calRows(schemes, own, days);
  return (
    <div>
      <div className="row between">
        <button className="btn ghost icon small" onClick={() => setStart(addDays(start, -7))} aria-label="Предыдущая неделя"><Icon name="left" size={18} /></button>
        <button className="btn ghost small" onClick={() => setStart(addDays(today, 1 - weekdayIdx(today)))} disabled={days.includes(today)}>
          {fmtShort(days[0])} — {fmtShort(days[6])}
        </button>
        <button className="btn ghost icon small" onClick={() => setStart(addDays(start, 7))} aria-label="Следующая неделя"><Icon name="right" size={18} /></button>
      </div>
      {rows.length === 0 ? <p className="small muted mt-16" style={{ textAlign: 'center' }}>{ty('На этой неделе приёмов нет')}</p> : (
        <div className="week" role="table" aria-label={`Приёмы ${fmtShort(days[0])} — ${fmtShort(days[6])}`}>
          <div className="week-row week-head" role="row">
            <span role="columnheader" />
            {days.map((d) => (
              <span key={d} role="columnheader" className={d === today ? 'is-today' : ''}><span>{WD_SHORT[weekdayIdx(d) - 1]}</span><b>{Number(d.slice(8))}</b></span>
            ))}
          </div>
          {PARTS.map((p) => {
            const list = rows.filter((r) => r.part === p.key);
            if (!list.length) return null;
            return (
              <div key={p.key} role="rowgroup">
                <div className="week-part">{p.label}</div>
                {list.map((r) => (
                  <div key={r.key} className={`week-row${r.own ? ' own' : ''}`} role="row">
                    <span role="rowheader" className="week-name"><b>{r.name}</b>{r.sub && <small>{r.sub}</small>}</span>
                    {days.map((d) => (
                      <span key={d} role="cell" className={d === today ? 'is-today' : ''} aria-label={`${WD_SHORT[weekdayIdx(d) - 1]}: ${r.on(d) ? 'принять' : 'нет'}`}>
                        {r.on(d) && <i className="week-dot" />}
                      </span>
                    ))}
                  </div>
                ))}
              </div>
            );
          })}
        </div>
      )}
      <p className="small muted mt-8"><i className="week-dot own-dot" /> {ty('— своё, вне схемы')}</p>
    </div>
  );
}

export function SchemePage() {
  const list = useData(() => api.get<Scheme[]>('/clients/me/schemes'), []);
  const current = list.data?.filter((s) => s.status === 'active' || s.status === 'scheduled') ?? [];
  const past = list.data?.filter((s) => s.status === 'completed' || s.status === 'cancelled') ?? [];
  return (
    <div className="page">
      <div className="page-head"><div><div className="eyebrow">Что принимаю</div><h1>Моя схема</h1></div></div>
      {!list.data ? <Loader error={list.error} retry={list.reload} /> : (
        <div className="stack" style={{ '--gap': '16px' } as any}>
          <Plan schemes={current} all={list.data.filter((s) => s.current && s.status !== 'cancelled' && s.status !== 'draft')} />
          {current.length > 0 && <h2 style={{ margin: '8px 0 -6px' }}>{current.length > 1 ? 'Схемы специалиста' : 'Схема специалиста'}</h2>}
          {current.map((s) => <SchemeCard key={s.id} s={s} />)}
          <ImportOwn onDone={list.reload} />
          {past.length > 0 && (
            <div>
              <h2 style={{ marginBottom: 10 }}>Завершённые и отменённые</h2>
              <div className="card"><div className="list">
                {past.map((s) => (
                  <Link key={s.id} to={`/scheme/${s.id}`} className="list-item">
                    <div className="grow">
                      <div className="list-title">{s.current?.title}</div>
                      <div className="small muted">{fmtDate(s.current!.start_date)} — {fmtDate(s.current!.end_date, { year: true })}{s.cancel_reason ? ` · ${s.cancel_reason}` : ''}</div>
                    </div>
                    <SchemeBadge status={s.status} />
                    <Icon name="right" className="chev" />
                  </Link>
                ))}
              </div></div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

function SelfForm({ onDone }: { onDone: () => void }) {
  const [f, setF] = useState({ name: '', amount: '', start_date: '', end_date: '', note: '' });
  const [parts, setParts] = useState<string[]>([]);
  const toggle = (l: string) => setParts((p) => p.includes(l) ? p.filter((x) => x !== l) : [...p, l]);
  const [err, setErr] = useState('');
  const toast = useToast();
  const set = (k: keyof typeof f) => (e: { target: { value: string } }) => setF({ ...f, [k]: e.target.value });
  const submit = async (e: FormEvent) => {
    e.preventDefault();
    if (!f.name.trim()) { setErr('Укажите название'); return; }
    const schedule = PARTS.filter((p) => parts.includes(p.label)).map((p) => p.label.toLowerCase()).join(', ');
    try { await api.post('/clients/me/self-supplements', { ...f, schedule }); toast('Добавлено'); onDone(); } catch (e) { setErr(errorText(e)); }
  };
  return (
    <form className="stack" onSubmit={submit}>
      <Field label="Название" htmlFor="ss-name" error={err}><input id="ss-name" className="input" value={f.name} onChange={set('name')} placeholder="Например, витамин C" /></Field>
      <Field label="Сколько" htmlFor="ss-amount"><input id="ss-amount" className="input" value={f.amount} onChange={set('amount')} placeholder="1 таблетка" /></Field>
      <div>
        <div className="label">Когда</div>
        <div className="chips mt-8" role="group" aria-label="Когда принимаю">
          {PARTS.filter((p) => p.key !== 'any').map((p) => (
            <button type="button" key={p.key} className="chip" aria-pressed={parts.includes(p.label)} onClick={() => toggle(p.label)}>{p.label}</button>
          ))}
        </div>
      </div>
      <div className="grid-2">
        <Field label="С какого дня" htmlFor="ss-s"><input id="ss-s" type="date" className="input" value={f.start_date} onChange={set('start_date')} /></Field>
        <Field label="До какого дня" htmlFor="ss-e"><input id="ss-e" type="date" className="input" value={f.end_date} onChange={set('end_date')} /></Field>
      </div>
      <Field label="Заметка" htmlFor="ss-note"><textarea id="ss-note" className="textarea" value={f.note} onChange={set('note')} /></Field>
      <button className="btn primary block">Сохранить</button>
    </form>
  );
}

export function SchemeHistoryPage() {
  const { id = '' } = useParams();
  const s = useData(() => api.get<Scheme>(`/schemes/${id}`), [id]);
  return (
    <div className="page">
      <Link to="/scheme" className="back"><Icon name="left" size={18} />Моя схема</Link>
      {!s.data ? <Loader error={s.error} /> : (
        <>
          <div className="page-head"><div><div className="eyebrow">{s.data.specialist_name}</div><h1>{s.data.current?.title}</h1></div><SchemeBadge status={s.data.status} /></div>
          {s.data.cancelled_at && <div className="notice warn" style={{ marginBottom: 16 }}><Icon name="info" /><div>Курс отменён {fmtDate(s.data.cancelled_at.slice(0, 10))}{s.data.cancel_reason ? `: ${s.data.cancel_reason}` : ''}. История приёма сохранена.</div></div>}
          <div className="stack" style={{ '--gap': '16px' } as any}>
            {[...s.data.versions].reverse().map((v) => (
              <div key={v.id} className="card">
                <div className="row between">
                  <h3>Версия {v.number}</h3>
                  <span className="small muted">действует с {fmtDate(v.effective_from ?? v.start_date, { year: true })}</span>
                </div>
                {v.changes && <div className="mt-8"><ChangesView v={v} /></div>}
                <div className="list mt-8">{v.items.map((it) => <ItemView key={it.id} it={it} today={s.data!.today} />)}</div>
              </div>
            ))}
          </div>
        </>
      )}
    </div>
  );
}
