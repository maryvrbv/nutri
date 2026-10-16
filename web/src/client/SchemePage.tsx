import { useState, type FormEvent } from 'react';
import { Link, useParams } from 'react-router-dom';
import { api, type Scheme, type SchemeItem, type Version } from '../api';
import { amountLabel, doseLabel, fmtDate, FOOD_LABELS, FORM_LABELS, freqLabel, ty } from '../format';
import { Empty, Field, Icon, Loader, SchemeBadge, Sheet, errorText, useData, useToast } from '../ui';

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
  const now = items.filter((i) => i.start_date <= s.today && i.end_date >= s.today);
  const later = items.filter((i) => i.start_date > s.today);
  const updated = v.number > 1 && v.changes?.length;
  return (
    <div className="card">
      <div className="row between top">
        <div className="grow">
          <h2>{v.title}</h2>
          <p className="small muted">{s.specialist_name} · опубликовано {fmtDate(v.published_at!.slice(0, 10))}</p>
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
      <div className="list mt-8">
        {(s.status === 'scheduled' ? items : now).map((it) => <ItemView key={it.id} it={it} today={s.today} />)}
      </div>
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

export function SchemePage() {
  const list = useData(() => api.get<Scheme[]>('/clients/me/schemes'), []);
  const current = list.data?.filter((s) => s.status === 'active' || s.status === 'scheduled') ?? [];
  const past = list.data?.filter((s) => s.status === 'completed' || s.status === 'cancelled') ?? [];
  return (
    <div className="page">
      <div className="page-head"><div><div className="eyebrow">План от специалиста</div><h1>Моя схема</h1></div></div>
      {!list.data ? <Loader error={list.error} retry={list.reload} /> : (
        <div className="stack" style={{ '--gap': '16px' } as any}>
          {current.length === 0 && <div className="card"><Empty icon="pill" title="Активной схемы нет">{ty('Схема появится здесь, когда специалист её опубликует. Мы пришлём уведомление.')}</Empty></div>}
          {current.map((s) => <SchemeCard key={s.id} s={s} />)}
          <SelfSupplements />
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

function SelfSupplements() {
  const list = useData(() => api.get<any[]>('/clients/me/self-supplements'), []);
  const [open, setOpen] = useState(false);
  const toast = useToast();
  const del = async (id: string) => {
    try { await api.del(`/clients/me/self-supplements/${id}`); list.reload(); } catch (e) { toast(errorText(e)); }
  };
  return (
    <div className="card" id="self">
      <div className="card-head">
        <div><h2>Принимаю самостоятельно</h2><p className="small muted">{ty('То, что вы принимаете сами, вне схемы специалиста. Специалист это видит.')}</p></div>
      </div>
      {list.data?.length ? (
        <div className="list">
          {list.data.map((s) => (
            <div key={s.id} className="list-item">
              <Icon name="leaf" className="chev" />
              <div className="grow">
                <div className="list-title">{s.name}</div>
                <div className="small muted">{[s.amount, s.schedule, s.start_date && `с ${fmtDate(s.start_date)}`, s.end_date && `до ${fmtDate(s.end_date)}`].filter(Boolean).join(' · ')}</div>
                {s.note && <div className="small">{s.note}</div>}
              </div>
              <button className="btn ghost icon small" onClick={() => del(s.id)} aria-label={`Удалить ${s.name}`}><Icon name="trash" size={18} /></button>
            </div>
          ))}
        </div>
      ) : list.data ? <p className="small muted">Пока ничего не добавлено</p> : null}
      <button className="btn outline block mt-16" onClick={() => setOpen(true)}><Icon name="plus" />Добавить</button>
      {open && <Sheet title="Добавка вне схемы" onClose={() => setOpen(false)}><SelfForm onDone={() => { setOpen(false); list.reload(); }} /></Sheet>}
    </div>
  );
}

function SelfForm({ onDone }: { onDone: () => void }) {
  const [f, setF] = useState({ name: '', amount: '', schedule: '', start_date: '', end_date: '', note: '' });
  const [err, setErr] = useState('');
  const toast = useToast();
  const set = (k: keyof typeof f) => (e: { target: { value: string } }) => setF({ ...f, [k]: e.target.value });
  const submit = async (e: FormEvent) => {
    e.preventDefault();
    if (!f.name.trim()) { setErr('Укажите название'); return; }
    try { await api.post('/clients/me/self-supplements', f); toast('Добавлено'); onDone(); } catch (e) { setErr(errorText(e)); }
  };
  return (
    <form className="stack" onSubmit={submit}>
      <Field label="Название" htmlFor="ss-name" error={err}><input id="ss-name" className="input" value={f.name} onChange={set('name')} placeholder="Например, витамин C" /></Field>
      <div className="grid-2">
        <Field label="Сколько" htmlFor="ss-amount"><input id="ss-amount" className="input" value={f.amount} onChange={set('amount')} placeholder="1 таблетка" /></Field>
        <Field label="Когда" htmlFor="ss-sch"><input id="ss-sch" className="input" value={f.schedule} onChange={set('schedule')} placeholder="утром" /></Field>
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
