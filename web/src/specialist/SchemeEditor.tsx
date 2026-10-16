import { useEffect, useMemo, useState } from 'react';
import { Link, useLocation, useNavigate, useParams } from 'react-router-dom';
import { api, ApiError, rid, type Dose, type Scheme, type SchemeItem } from '../api';
import { ChangesView, ItemView } from '../client/SchemePage';
import { addDays, amountLabel, daysBetween, fmtDate, fmtDayTitle, FOOD_LABELS, FORM_LABELS, PART_LABELS, ty, WD_SHORT } from '../format';
import { Empty, Field, Icon, Loader, Notice, SchemeBadge, Seg, Sheet, errorText, useData, useToast } from '../ui';

export function SchemesTab() {
  const { id = '' } = useParams();
  const l = useData(() => api.get<Scheme[]>(`/clients/${id}/schemes`), [id]);
  if (!l.data) return <Loader error={l.error} />;
  if (!l.data.length) return <div className="card"><Empty icon="pill" title="Схем пока нет"><Link to={`/clients/${id}/schemes/new`}>Создать первую схему</Link></Empty></div>;
  return (
    <div className="card"><div className="list">
      {l.data.map((s) => {
        const v = s.current ?? s.draft!;
        return (
          <Link key={s.id} to={`/clients/${id}/schemes/${s.id}`} className="list-item">
            <div className="grow">
              <div className="list-title">{v.title}</div>
              <div className="small muted">{fmtDate(v.start_date)} — {fmtDate(v.end_date, { year: true })} · {v.items.length} поз.{s.current ? ` · версия ${s.current.number}` : ''}{s.draft && s.current ? ' · есть черновик изменений' : ''}</div>
            </div>
            <SchemeBadge status={s.status} /><Icon name="right" className="chev" />
          </Link>
        );
      })}
    </div></div>
  );
}

type FormItem = Omit<SchemeItem, 'amount' | 'substance_amount'> & { amount: string; substance_amount: string; _k: string };
type Form = { title: string; comment: string; start_date: string; end_date: string; control_date: string; items: FormItem[] };

const emptyItem = (start: string, end: string): FormItem => ({
  _k: rid(), name: '', product: '', form: 'capsule', amount: '1', amount_unit: 'капсула', substance_amount: '', substance_unit: 'мг',
  doses: [{ part: 'morning' }], frequency: { type: 'daily' }, food: 'with', start_date: start, end_date: end, instruction: '',
});
const toNum = (s: string) => (s === '' ? null : Number(String(s).replace(',', '.')));
const fromVersion = (v: any): Form => ({
  title: v.title, comment: v.comment ?? '', start_date: v.start_date, end_date: v.end_date, control_date: v.control_date ?? '',
  items: v.items.map((it: any) => ({ ...it, _k: rid(), amount: String(it.amount).replace('.', ','), substance_amount: it.substance_amount == null ? '' : String(it.substance_amount).replace('.', ','), substance_unit: it.substance_unit ?? 'мг', product: it.product ?? '', instruction: it.instruction ?? '' })),
});
const toPayload = (f: Form) => ({
  title: f.title, comment: f.comment, start_date: f.start_date, end_date: f.end_date, control_date: f.control_date || null,
  items: f.items.map(({ _k, id, ...it }) => ({ ...it, amount: toNum(it.amount), substance_amount: toNum(it.substance_amount), substance_unit: it.substance_amount ? it.substance_unit : null })),
});

export function SchemeEditorPage() {
  const { id = '', sid } = useParams();
  const nav = useNavigate();
  const toast = useToast();
  const profile = useData(() => api.get(`/clients/${id}/profile`), [id]);
  const scheme = useData(() => (sid ? api.get<Scheme>(`/schemes/${sid}`) : Promise.resolve(null)), [sid]);
  const [form, setForm] = useState<Form | null>(null);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [saving, setSaving] = useState(false);
  const [publishing, setPublishing] = useState(false);
  const [cancelling, setCancelling] = useState(false);
  const [dirty, setDirty] = useState(false);
  const today = profile.data?.today as string | undefined;
  const loc = useLocation();
  useEffect(() => {
    if ((loc.state as any)?.publish && scheme.data?.draft) { setPublishing(true); nav(loc.pathname, { replace: true, state: null }); }
  }, [scheme.data]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    if (!today) return;
    if (!sid) { const end = addDays(today, 29); setForm({ title: '', comment: '', start_date: today, end_date: end, control_date: '', items: [emptyItem(today, end)] }); }
    else if (scheme.data?.draft) setForm(fromVersion(scheme.data.draft));
    else setForm(null);
  }, [today, sid, scheme.data]);

  if (!profile.data || (sid && !scheme.data)) return <Loader error={profile.error ?? scheme.error} />;
  const s = scheme.data;
  const editing = !!form;

  const update = (f: Form) => { setForm(f); setDirty(true); };
  const save = async (andPublish = false): Promise<string | null> => {
    if (!form) return null;
    setSaving(true); setErrors({});
    try {
      if (!sid) {
        const r = await api.post(`/clients/${id}/schemes`, toPayload(form));
        setDirty(false);
        // Страница пересоздаётся на новом адресе — передаём намерение опубликовать через state
        nav(`/clients/${id}/schemes/${r.scheme_id}`, { replace: true, state: andPublish ? { publish: true } : undefined });
        if (!andPublish) toast('Черновик сохранён. Клиент его не видит.');
        return andPublish ? null : r.scheme_id;
      }
      const r = await api.put<Scheme>(`/schemes/${sid}/draft`, toPayload(form));
      scheme.setData(r); setDirty(false);
      toast('Черновик сохранён');
      return sid;
    } catch (e) {
      if (e instanceof ApiError && e.data?.fields) { setErrors(e.data.fields); toast('Проверьте выделенные поля'); }
      else toast(errorText(e));
      return null;
    } finally { setSaving(false); }
  };
  const startVersion = async () => {
    try { scheme.setData(await api.post<Scheme>(`/schemes/${sid}/versions`)); } catch (e) { toast(errorText(e)); }
  };
  const discard = async () => {
    if (!window.confirm('Удалить черновик? Опубликованная версия не изменится.')) return;
    try { await api.del(`/schemes/${sid}/draft`); if (s?.current) { scheme.reload(); setDirty(false); } else nav(`/clients/${id}/schemes`, { replace: true }); } catch (e) { toast(errorText(e)); }
  };

  return (
    <div>
      <div className="row between wrap" style={{ marginBottom: 16 }}>
        <div>
          <Link to={`/clients/${id}/schemes`} className="back"><Icon name="left" size={18} />Схемы клиента</Link>
          <h2 style={{ fontSize: 24 }}>{!sid ? 'Новая схема' : s?.draft && s.current ? `Изменения: версия ${s.draft.number}` : (s?.current ?? s?.draft)?.title}</h2>
        </div>
        {s && <SchemeBadge status={s.status} />}
      </div>

      {s?.status === 'cancelled' && <Notice kind="warn">Курс отменён {fmtDate(s.cancelled_at!.slice(0, 10))}{s.cancel_reason ? `: ${s.cancel_reason}` : ''}. Будущие приёмы и напоминания отменены, история сохранена.</Notice>}

      {editing ? (
        <div className="builder">
          <div className="stack" style={{ '--gap': '16px' } as any}>
            {s?.current && s.draft && <Notice kind="info">{ty(`Вы редактируете новую версию. Прошлые отметки клиента останутся привязаны к версии ${s.current.number} — к той дозировке, что действовала на момент приёма.`)}</Notice>}
            <SchemeFields form={form!} onChange={update} errors={errors} />
            <div>
              <h3 style={{ marginBottom: 10 }}>Позиции</h3>
              {form!.items.map((it, i) => (
                <ItemEditor key={it._k} n={i + 1} it={it} errors={errors} prefix={`items.${i}.`} scheme={form!}
                  onChange={(x) => update({ ...form!, items: form!.items.map((y, j) => (j === i ? x : y)) })}
                  onRemove={form!.items.length > 1 ? () => update({ ...form!, items: form!.items.filter((_, j) => j !== i) }) : undefined}
                  onStage={() => {
                    const start = addDays(it.end_date < form!.end_date ? it.end_date : addDays(form!.end_date, -1), 1);
                    const end = form!.end_date;
                    const first = { ...it, end_date: it.end_date >= end ? addDays(start, -1) : it.end_date };
                    const next: FormItem = { ...it, _k: rid(), group_key: undefined, id: undefined, start_date: start, end_date: end };
                    const items = [...form!.items]; items[i] = first; items.splice(i + 1, 0, next);
                    update({ ...form!, items });
                  }}
                  onDuplicate={() => { const items = [...form!.items]; items.splice(i + 1, 0, { ...it, _k: rid(), group_key: undefined, id: undefined, name: '' }); update({ ...form!, items }); }} />
              ))}
              <button className="btn outline block mt-16" onClick={() => update({ ...form!, items: [...form!.items, emptyItem(form!.start_date, form!.end_date)] })}><Icon name="plus" />Добавить позицию</button>
            </div>
            <div className="card row wrap" style={{ position: 'sticky', bottom: 12, zIndex: 5 }}>
              <button className="btn" onClick={() => save()} disabled={saving}>{saving ? 'Сохраняем…' : dirty || !sid ? 'Сохранить черновик' : 'Черновик сохранён'}</button>
              <button className="btn primary" onClick={async () => { const ok = dirty || !sid ? await save(true) : sid; if (ok) setPublishing(true); }} disabled={saving}><Icon name="eye" />Проверить и опубликовать</button>
              {sid && <button className="btn ghost" onClick={discard} style={{ marginLeft: 'auto' }}>Удалить черновик</button>}
            </div>
          </div>
          <aside>
            <h3 style={{ marginBottom: 8 }}>Так увидит клиент</h3>
            <Preview form={form!} today={today!} />
          </aside>
        </div>
      ) : s?.current && (
        <div className="cols">
          <div className="span-8 stack" style={{ '--gap': '16px' } as any}>
            <div className="card">
              <div className="card-head wrap">
                <div><h2>Версия {s.current.number}</h2><p className="small muted">опубликована {fmtDate(s.current.published_at!.slice(0, 10), { year: true })} · действует с {fmtDate(s.current.effective_from!)}</p></div>
                {s.status !== 'cancelled' && s.status !== 'completed' && (
                  <div className="row wrap">
                    <button className="btn" onClick={startVersion}><Icon name="edit" size={18} />Изменить схему</button>
                    <button className="btn ghost" onClick={() => setCancelling(true)} style={{ color: 'var(--danger)' }}>Отменить курс</button>
                  </div>
                )}
              </div>
              <div className="row wrap small"><span>{fmtDate(s.current.start_date)} — {fmtDate(s.current.end_date, { year: true })}</span>{s.current.control_date && <span className="badge auto">контроль {fmtDate(s.current.control_date)}</span>}</div>
              {s.current.comment && <p className="mt-8">{s.current.comment}</p>}
              {s.current.changes && <div className="mt-16"><ChangesView v={s.current} /></div>}
              <div className="list mt-8">{s.current.items.map((it) => <ItemView key={it.id} it={it} today={s.today} />)}</div>
            </div>
          </div>
          <div className="span-4">
            <div className="card">
              <h3>Версии</h3>
              <div className="list mt-8">
                {[...s.versions].filter((v) => v.published_at).reverse().map((v) => (
                  <div key={v.id} className="list-item" style={{ padding: '10px 0' }}><div className="grow"><div className="small list-title">Версия {v.number}</div><div className="tiny muted">с {fmtDate(v.effective_from!)} · {v.published_by_name}</div>{v.changes && <div className="tiny muted">{v.changes.length} изм.</div>}</div></div>
                ))}
              </div>
            </div>
          </div>
        </div>
      )}

      {publishing && sid && s && <PublishSheet scheme={s} sid={sid} today={today!} form={form!} onClose={() => setPublishing(false)} onDone={(x) => { setPublishing(false); scheme.setData(x); setForm(null); toast('Опубликовано. Клиент получил уведомление.'); }} />}
      {cancelling && sid && <CancelSheet sid={sid} onClose={() => setCancelling(false)} onDone={(x) => { setCancelling(false); scheme.setData(x); toast('Курс отменён'); }} />}
    </div>
  );
}

function SchemeFields({ form, onChange, errors }: { form: Form; onChange: (f: Form) => void; errors: Record<string, string> }) {
  const [mode, setMode] = useState<'end' | 'days'>('days');
  const days = daysBetween(form.start_date, form.end_date) + 1;
  const set = (patch: Partial<Form>) => {
    const next = { ...form, ...patch };
    // Позиции, совпадавшие с границами схемы, двигаем вместе с ней
    if (patch.start_date || patch.end_date) {
      next.items = form.items.map((it) => ({
        ...it,
        start_date: it.start_date === form.start_date ? next.start_date : it.start_date,
        end_date: it.end_date === form.end_date ? next.end_date : it.end_date,
      }));
    }
    onChange(next);
  };
  return (
    <div className="card stack">
      <Field label="Название" htmlFor="sc-title" error={errors.title}><input id="sc-title" className="input" value={form.title} onChange={(e) => set({ title: e.target.value })} placeholder="Например, восполнение железа и витамина D" aria-invalid={!!errors.title} /></Field>
      <div className="grid-3">
        <Field label="Начало" htmlFor="sc-start" error={errors.start_date}><input id="sc-start" type="date" className="input" value={form.start_date} onChange={(e) => e.target.value && set({ start_date: e.target.value, ...(mode === 'days' ? { end_date: addDays(e.target.value, days - 1) } : {}) })} /></Field>
        <div className="field">
          <div className="row between"><label htmlFor="sc-end" className="label">{mode === 'days' ? 'Длительность, дней' : 'Окончание'}</label><button type="button" className="linkbtn tiny" onClick={() => setMode(mode === 'days' ? 'end' : 'days')}>{mode === 'days' ? 'датой' : 'в днях'}</button></div>
          {mode === 'days'
            ? <input id="sc-end" type="number" min={1} max={366} className="input" value={days} onChange={(e) => { const n = Math.max(1, Math.min(366, Number(e.target.value) || 1)); set({ end_date: addDays(form.start_date, n - 1) }); }} />
            : <input id="sc-end" type="date" className="input" value={form.end_date} min={form.start_date} onChange={(e) => e.target.value && set({ end_date: e.target.value })} />}
          {errors.end_date ? <span className="err">{errors.end_date}</span> : <span className="hint">{mode === 'days' ? `до ${fmtDate(form.end_date, { year: true })}` : `${days} дн.`}</span>}
        </div>
        <Field label="Контрольная дата" htmlFor="sc-ctl" hint="Когда пересдать анализы. Необязательно" error={errors.control_date}><input id="sc-ctl" type="date" className="input" value={form.control_date} onChange={(e) => set({ control_date: e.target.value })} /></Field>
      </div>
      <Field label="Общий комментарий для клиента" htmlFor="sc-comment"><textarea id="sc-comment" className="textarea" value={form.comment} onChange={(e) => set({ comment: e.target.value })} placeholder="Цель курса и на что обратить внимание" /></Field>
    </div>
  );
}

function ItemEditor({ n, it, errors, prefix, scheme, onChange, onRemove, onStage, onDuplicate }: {
  n: number; it: FormItem; errors: Record<string, string>; prefix: string; scheme: Form;
  onChange: (x: FormItem) => void; onRemove?: () => void; onStage: () => void; onDuplicate: () => void;
}) {
  const [time, setTime] = useState('');
  const e = (k: string) => errors[prefix + k];
  const set = (patch: Partial<FormItem>) => onChange({ ...it, ...patch });
  const addDose = (d: Dose) => {
    const key = d.time ?? d.part;
    if (it.doses.some((x) => (x.time ?? x.part) === key)) return;
    set({ doses: [...it.doses, d].sort((a, b) => (a.time ?? PART_LABELS[a.part!].time).localeCompare(b.time ?? PART_LABELS[b.part!].time)) });
  };
  const idp = `it-${it._k}`;
  const partial = it.start_date !== scheme.start_date || it.end_date !== scheme.end_date;
  return (
    <div className="item-card">
      <div className="item-head">
        <div className="row"><span className="item-num">{n}</span><b>{it.name || 'Новая позиция'}</b>{partial && <span className="badge planned">{fmtDate(it.start_date)} — {fmtDate(it.end_date)}</span>}</div>
        <div className="row" style={{ '--gap': '2px' } as any}>
          <button className="btn ghost small" onClick={onStage} title="Сменить дозировку с определённой даты">+ этап</button>
          <button className="btn ghost icon small" onClick={onDuplicate} aria-label="Дублировать позицию"><Icon name="copy" size={18} /></button>
          {onRemove && <button className="btn ghost icon small" onClick={onRemove} aria-label="Удалить позицию"><Icon name="trash" size={18} /></button>}
        </div>
      </div>
      <div className="item-grid">
        <div className="c3"><Field label="Название БАДа" htmlFor={`${idp}-n`} error={e('name')}><input id={`${idp}-n`} className="input" value={it.name} onChange={(x) => set({ name: x.target.value })} placeholder="Магний" aria-invalid={!!e('name')} /></Field></div>
        <div className="c3"><Field label="Бренд или продукт" htmlFor={`${idp}-p`} hint="Необязательно"><input id={`${idp}-p`} className="input" value={it.product} onChange={(x) => set({ product: x.target.value })} placeholder="Магний цитрат, производитель" /></Field></div>
        <div className="c2"><Field label="Форма выпуска" htmlFor={`${idp}-f`} error={e('form')}><select id={`${idp}-f`} className="select" value={it.form} onChange={(x) => set({ form: x.target.value })}>{Object.entries(FORM_LABELS).map(([k, v]) => <option key={k} value={k}>{v}</option>)}</select></Field></div>
        <div className="c2">
          <div className="field">
            <label htmlFor={`${idp}-a`}>На один приём</label>
            <div className="row" style={{ '--gap': '6px' } as any}>
              <input id={`${idp}-a`} className="input" style={{ width: 72 }} inputMode="decimal" value={it.amount} onChange={(x) => set({ amount: x.target.value })} aria-invalid={!!e('amount')} />
              <input className="input" value={it.amount_unit} onChange={(x) => set({ amount_unit: x.target.value })} aria-label="Единица количества" placeholder="капсулы" aria-invalid={!!e('amount_unit')} />
            </div>
            {(e('amount') || e('amount_unit')) ? <span className="err">{e('amount') || e('amount_unit')}</span> : <span className="hint">Количество продукта</span>}
          </div>
        </div>
        <div className="c2">
          <div className="field">
            <label htmlFor={`${idp}-s`}>Действующее вещество</label>
            <div className="row" style={{ '--gap': '6px' } as any}>
              <input id={`${idp}-s`} className="input" style={{ width: 84 }} inputMode="decimal" value={it.substance_amount} onChange={(x) => set({ substance_amount: x.target.value })} placeholder="200" />
              <select className="select" value={it.substance_unit ?? 'мг'} onChange={(x) => set({ substance_unit: x.target.value })} aria-label="Единица вещества">{['мг', 'мкг', 'г', 'МЕ', 'мл', 'КОЕ'].map((u) => <option key={u}>{u}</option>)}</select>
            </div>
            {e('substance_amount') || e('substance_unit') ? <span className="err">{e('substance_amount') || e('substance_unit')}</span> : <span className="hint">Необязательно, отдельно от количества</span>}
          </div>
        </div>
        <div className="c6">
          <div className="field">
            <span className="label">Время приёма</span>
            <div className="dose-row">
              {it.doses.map((d) => (
                <span key={d.time ?? d.part} className="dose-pill">{d.time ?? `${PART_LABELS[d.part!].label.toLowerCase()} (${PART_LABELS[d.part!].time})`}
                  <button type="button" onClick={() => set({ doses: it.doses.filter((x) => x !== d) })} aria-label="Убрать время"><Icon name="x" size={14} /></button></span>
              ))}
            </div>
            <div className="row wrap mt-8" style={{ '--gap': '6px' } as any}>
              {Object.entries(PART_LABELS).map(([k, v]) => <button key={k} type="button" className="chip" onClick={() => addDose({ part: k })}>+ {v.label.toLowerCase()}</button>)}
              <span className="row" style={{ '--gap': '4px' } as any}>
                <input type="time" className="input" style={{ width: 120, minHeight: 36 }} value={time} onChange={(x) => setTime(x.target.value)} aria-label="Точное время" />
                <button type="button" className="btn small" disabled={!time} onClick={() => { addDose({ time }); setTime(''); }}>Добавить</button>
              </span>
            </div>
            {e('doses') && <span className="err">{e('doses')}</span>}
          </div>
        </div>
        <div className="c3">
          <div className="field">
            <span className="label">Периодичность</span>
            <Seg label="Периодичность" value={it.frequency.type} onChange={(t) => set({ frequency: t === 'weekdays' ? { type: 'weekdays', days: [1, 2, 3, 4, 5] } : { type: t } as any })}
              options={[{ value: 'daily', label: 'Ежедневно' }, { value: 'weekdays', label: 'По дням' }, { value: 'every_other_day', label: 'Через день' }]} />
            {it.frequency.type === 'weekdays' && (
              <div className="weekdays mt-8" role="group" aria-label="Дни недели">
                {WD_SHORT.map((w, i) => {
                  const days = (it.frequency as any).days as number[];
                  const on = days.includes(i + 1);
                  return <button key={w} type="button" aria-pressed={on} onClick={() => set({ frequency: { type: 'weekdays', days: on ? days.filter((x) => x !== i + 1) : [...days, i + 1].sort() } })}>{w}</button>;
                })}
              </div>
            )}
            {e('frequency') && <span className="err">{e('frequency')}</span>}
          </div>
        </div>
        <div className="c3">
          <div className="field">
            <span className="label">Связь с едой</span>
            <Seg label="Связь с едой" value={it.food} onChange={(v) => set({ food: v })} options={[{ value: 'before', label: 'До' }, { value: 'with', label: 'Во время' }, { value: 'after', label: 'После' }, { value: 'any', label: 'Неважно' }]} />
          </div>
        </div>
        <div className="c3"><Field label="Принимать с" htmlFor={`${idp}-sd`} error={e('start_date')}><input id={`${idp}-sd`} type="date" className="input" value={it.start_date} min={scheme.start_date} max={scheme.end_date} onChange={(x) => x.target.value && set({ start_date: x.target.value })} /></Field></div>
        <div className="c3"><Field label="по" htmlFor={`${idp}-ed`} error={e('end_date')}><input id={`${idp}-ed`} type="date" className="input" value={it.end_date} min={scheme.start_date} max={scheme.end_date} onChange={(x) => x.target.value && set({ end_date: x.target.value })} /></Field></div>
        <div className="c6"><Field label="Инструкция" htmlFor={`${idp}-i`}><textarea id={`${idp}-i`} className="textarea" style={{ minHeight: 64 }} value={it.instruction} onChange={(x) => set({ instruction: x.target.value })} placeholder="Например, запивать водой, не сочетать с кофе" /></Field></div>
      </div>
    </div>
  );
}

function Preview({ form, today }: { form: Form; today: string }) {
  const [data, setData] = useState<any[] | null>(null);
  const [err, setErr] = useState('');
  const from = form.start_date > today ? form.start_date : today;
  const payload = useMemo(() => JSON.stringify(toPayload(form)), [form]);
  useEffect(() => {
    const t = window.setTimeout(async () => {
      try { setData(await api.post('/schemes/preview', { version: JSON.parse(payload), from, days: 7 })); setErr(''); }
      catch (e) { setErr(e instanceof ApiError && e.data?.fields ? 'Заполните обязательные поля, чтобы увидеть расписание' : errorText(e)); }
    }, 400);
    return () => window.clearTimeout(t);
  }, [payload, from]);
  return (
    <div className="phone-frame">
      {err ? <p className="small muted">{err}</p> : !data ? <div className="spinner" /> : data.length === 0 ? <p className="small muted">В ближайшие 7 дней приёмов нет</p> : data.map((d) => (
        <div key={d.date} className="preview-day">
          <h4>{fmtDayTitle(d.date, today)}{d.date !== today ? '' : ` · ${fmtDate(d.date)}`}</h4>
          {d.groups.map((g: any) => (
            <div key={g.slot} className="preview-slot">
              <div className="row between"><b className="num">{PART_LABELS[g.slot]?.label ?? g.time}</b>{PART_LABELS[g.slot] && <span className="tiny muted">около {g.time}</span>}</div>
              {g.items.map((it: any, k: number) => (
                <div key={k} className="small mt-8"><b>{it.name}</b> · {amountLabel(it.amount, it.amount_unit)} · {FOOD_LABELS[it.food]}{it.instruction && <div className="tiny muted">{it.instruction}</div>}</div>
              ))}
            </div>
          ))}
        </div>
      ))}
    </div>
  );
}

function PublishSheet({ scheme, sid, today, form, onClose, onDone }: { scheme: Scheme; sid: string; today: string; form: Form; onClose: () => void; onDone: (s: Scheme) => void }) {
  const isUpdate = !!scheme.current;
  const [eff, setEff] = useState(today > form.start_date ? today : form.start_date);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');
  const go = async () => {
    setBusy(true); setErr('');
    try { const r = await api.post(`/schemes/${sid}/publish`, isUpdate ? { effective_from: eff } : {}); onDone(r.scheme); }
    catch (e) { setErr(errorText(e)); } finally { setBusy(false); }
  };
  return (
    <Sheet title={isUpdate ? `Опубликовать версию ${scheme.draft?.number}` : 'Опубликовать схему'} onClose={onClose}>
      <div className="stack">
        {isUpdate ? (
          <>
            <Field label="Изменения вступают в силу" htmlFor="eff" hint="Неотмеченные приёмы с этой даты заменятся новыми; уже отмеченные останутся как были">
              <input id="eff" type="date" className="input" value={eff} min={today} max={form.end_date} onChange={(e) => setEff(e.target.value)} />
            </Field>
          </>
        ) : (
          <p>{ty(`Клиент получит уведомление и увидит план с ${fmtDate(form.start_date)}. Приёмы будут созданы на весь курс: ${daysBetween(form.start_date, form.end_date) + 1} дн.`)}</p>
        )}
        <div className="card flat tight">
          <b>{form.title}</b>
          <ul className="small" style={{ margin: '6px 0 0', paddingLeft: 18 }}>
            {form.items.map((it) => <li key={it._k}>{it.name} — {amountLabel(it.amount, it.amount_unit)}, {it.doses.map((d) => d.time ?? PART_LABELS[d.part!].label.toLowerCase()).join(', ')}</li>)}
          </ul>
        </div>
        {err && <Notice kind="danger">{err}</Notice>}
        <button className="btn primary block" onClick={go} disabled={busy}>{busy ? 'Публикуем…' : 'Опубликовать'}</button>
      </div>
    </Sheet>
  );
}

function CancelSheet({ sid, onClose, onDone }: { sid: string; onClose: () => void; onDone: (s: Scheme) => void }) {
  const [reason, setReason] = useState('');
  const [err, setErr] = useState('');
  const go = async () => {
    try { const r = await api.post(`/schemes/${sid}/cancel`, { reason }); onDone(r.scheme); } catch (e) { setErr(errorText(e)); }
  };
  return (
    <Sheet title="Отменить курс?" onClose={onClose}>
      <div className="stack">
        <p>{ty('Будущие приёмы и напоминания отменятся. Уже отмеченные приёмы и история останутся.')}</p>
        <Field label="Причина для клиента" htmlFor="cr" hint="Необязательно"><textarea id="cr" className="textarea" value={reason} onChange={(e) => setReason(e.target.value)} /></Field>
        {err && <Notice kind="danger">{err}</Notice>}
        <button className="btn danger block" onClick={go}>Отменить курс</button>
      </div>
    </Sheet>
  );
}
