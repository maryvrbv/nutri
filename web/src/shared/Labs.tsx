import { lazy, Suspense, useEffect, useRef, useState, type DragEvent, type FormEvent } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { api, ApiError, type Comment, type Doc, type Result } from '../api';
import { useAuth } from '../auth';
import { fileSize, fmtDate, fmtDateTime, LOW_FIELDS, num, ty } from '../format';
import { DocBadge, Empty, Field, Icon, Loader, Notice, Seg, Sheet, errorText, useData, useToast } from '../ui';
import { DynamicsChart } from './Chart';
const PdfView = lazy(() => import('./PdfView').then((m) => ({ default: m.PdfView })));

const resultKey = (r: Result) => r.analyte_code ?? `name:${r.name.toLowerCase()}`;

function position(r: Pick<Result, 'value_num' | 'ref_low' | 'ref_high'>): 'low' | 'high' | 'in' | null {
  if (r.value_num == null || (r.ref_low == null && r.ref_high == null)) return null;
  if (r.ref_low != null && r.value_num < r.ref_low) return 'low';
  if (r.ref_high != null && r.value_num > r.ref_high) return 'high';
  return 'in';
}

export function PositionBadge({ r }: { r: Pick<Result, 'value_num' | 'ref_low' | 'ref_high'> }) {
  const p = position(r);
  if (!p) return null;
  if (p === 'in') return <span className="badge taken">в интервале</span>;
  return <span className="badge warn">{p === 'low' ? 'ниже интервала' : 'выше интервала'}</span>;
}

function RangeBar({ r }: { r: Result }) {
  if (r.value_num == null || r.ref_low == null || r.ref_high == null) return null;
  const span = r.ref_high - r.ref_low || 1;
  const lo = r.ref_low - span * 0.5, hi = r.ref_high + span * 0.5;
  const p = (v: number) => `${Math.min(100, Math.max(0, ((v - lo) / (hi - lo)) * 100))}%`;
  return (
    <div className="rangebar" aria-hidden="true">
      <span className="ok" style={{ left: p(r.ref_low), width: `calc(${p(r.ref_high)} - ${p(r.ref_low)})` }} />
      <span className="pin" style={{ left: p(r.value_num) }} />
    </div>
  );
}

// ---------- Обзор ----------

export function LabsOverview({ clientId, base }: { clientId: string; base: string }) {
  const d = useData(() => api.get<{ latest: Result[]; documents: Doc[] }>(`/clients/${clientId}/labs`), [clientId]);
  const pending = d.data?.documents.filter((x) => x.status !== 'confirmed') ?? [];
  useEffect(() => {
    if (pending.some((x) => x.status === 'processing' || x.status === 'uploaded')) {
      const t = window.setTimeout(d.reload, 2000);
      return () => window.clearTimeout(t);
    }
  }, [d.data]); // eslint-disable-line react-hooks/exhaustive-deps
  if (!d.data) return <Loader error={d.error} retry={d.reload} />;
  return (
    <div className="stack" style={{ '--gap': '16px' } as any}>
      {pending.length > 0 && (
        <div className="card">
          <h3>Ждут проверки</h3>
          <div className="list mt-8">
            {pending.map((doc) => (
              <Link key={doc.id} to={`${base}/documents/${doc.id}`} className="list-item">
                <Icon name="file" className="chev" />
                <div className="grow">
                  <div className="list-title">{doc.lab ?? doc.file_name}</div>
                  <div className="small muted">{doc.collected_at ? `забор ${fmtDate(doc.collected_at)}` : `загружен ${fmtDateTime(doc.uploaded_at)}`} · {doc.uploaded_by_name}</div>
                </div>
                <DocBadge status={doc.status} />
                <Icon name="right" className="chev" />
              </Link>
            ))}
          </div>
        </div>
      )}

      <div className="card">
        <div className="card-head"><h2>Показатели</h2><span className="subtle">последние подтверждённые</span></div>
        {d.data.latest.length === 0 ? (
          <Empty icon="flask" title="Пока нет подтверждённых результатов">{ty('Загрузите бланк из лаборатории — мы распознаем значения, а вы их проверите.')}</Empty>
        ) : (
          <div className="list">
            {d.data.latest.map((r) => (
              <Link key={r.id} to={`${base}/analyte/${encodeURIComponent(resultKey(r))}`} className="list-item">
                <div className="grow">
                  <div className="row wrap"><span className="list-title">{r.name}</span><PositionBadge r={r} /></div>
                  <div className="small muted">{fmtDate(r.collected_at, { year: true })}{r.lab ? ` · ${r.lab}` : ''}{(r.count ?? 1) > 1 ? ` · ${r.count} измерения` : ''}</div>
                </div>
                <div style={{ textAlign: 'right' }}>
                  <div className="value" style={{ fontSize: 18 }}>{r.value_text}<small>{r.unit}</small></div>
                  {r.ref_text && <div className="tiny muted">{r.ref_text}</div>}
                </div>
                <Icon name="right" className="chev" />
              </Link>
            ))}
          </div>
        )}
      </div>

      <div className="card">
        <div className="card-head"><h2>Документы</h2><Link to={`${base}/upload`} className="btn small primary"><Icon name="upload" size={16} />Загрузить</Link></div>
        {d.data.documents.length === 0 ? <p className="small muted">Документов пока нет</p> : (
          <div className="list">
            {d.data.documents.map((doc) => (
              <Link key={doc.id} to={`${base}/documents/${doc.id}`} className="list-item">
                <Icon name="file" className="chev" />
                <div className="grow">
                  <div className="list-title">{doc.lab ?? doc.file_name}</div>
                  <div className="small muted">{doc.collected_at ? fmtDate(doc.collected_at, { year: true }) : 'дата не указана'} · {doc.results_count} {doc.results_count === 1 ? 'показатель' : 'показателей'}</div>
                </div>
                <DocBadge status={doc.status} />
              </Link>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

// ---------- Загрузка ----------

export function UploadForm({ clientId, base }: { clientId: string; base: string }) {
  const nav = useNavigate();
  const [file, setFile] = useState<File | null>(null);
  const [lab, setLab] = useState('');
  const [date, setDate] = useState('');
  const [drag, setDrag] = useState(false);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');
  const [dup, setDup] = useState<any>(null);
  const input = useRef<HTMLInputElement>(null);

  const pick = (f?: File | null) => {
    setErr(''); setDup(null);
    if (!f) return;
    if (!['application/pdf', 'image/jpeg', 'image/png'].includes(f.type)) { setErr('Подойдёт PDF, JPG или PNG'); return; }
    if (f.size > 20 * 1024 * 1024) { setErr('Файл больше 20 МБ'); return; }
    setFile(f);
  };
  const onDrop = (e: DragEvent) => { e.preventDefault(); setDrag(false); pick(e.dataTransfer.files?.[0]); };
  const submit = async (force = false) => {
    if (!file) return;
    setBusy(true); setErr('');
    try {
      const q = new URLSearchParams({ name: file.name, ...(lab ? { lab } : {}), ...(date ? { collected_at: date } : {}), ...(force ? { force: '1' } : {}) });
      const r = await api.upload<{ id: string }>(`/clients/${clientId}/documents?${q}`, file);
      nav(`${base}/documents/${r.id}`, { replace: true });
    } catch (e) {
      if (e instanceof ApiError && e.code === 'duplicate') setDup(e.data);
      else setErr(errorText(e));
    } finally { setBusy(false); }
  };

  return (
    <div className="stack" style={{ '--gap': '16px' } as any}>
      <div className={`dropzone ${drag ? 'drag' : ''}`} onClick={() => input.current?.click()} onDragOver={(e) => { e.preventDefault(); setDrag(true); }} onDragLeave={() => setDrag(false)} onDrop={onDrop}
        role="button" tabIndex={0} onKeyDown={(e) => (e.key === 'Enter' || e.key === ' ') && input.current?.click()} aria-label="Выбрать файл анализа">
        <Icon name={file ? 'file' : 'upload'} />
        {file ? (
          <><p className="list-title mt-8">{file.name}</p><p className="small muted">{fileSize(file.size)} · нажмите, чтобы выбрать другой</p></>
        ) : (
          <><p className="list-title mt-8">Выберите файл или сделайте фото</p><p className="small muted">PDF, JPG или PNG до 20 МБ, можно многостраничный PDF</p></>
        )}
        <input ref={input} type="file" accept="application/pdf,image/jpeg,image/png" capture={undefined} hidden onChange={(e) => pick(e.target.files?.[0])} />
      </div>
      <div className="grid-2">
        <Field label="Лаборатория" htmlFor="up-lab" hint="Если не укажете, попробуем найти в бланке"><input id="up-lab" className="input" value={lab} onChange={(e) => setLab(e.target.value)} placeholder="Например, Инвитро" /></Field>
        <Field label="Дата забора" htmlFor="up-date" hint="Можно уточнить позже"><input id="up-date" type="date" className="input" value={date} onChange={(e) => setDate(e.target.value)} /></Field>
      </div>
      {err && <Notice kind="danger">{err}</Notice>}
      {dup && (
        <Notice kind="warn">
          <b>{dup.message}</b>
          <div className="small">Загружен {fmtDateTime(dup.duplicate.uploaded_at)}: {dup.duplicate.file_name}</div>
          <div className="row wrap mt-8">
            <Link className="btn small" to={`${base}/documents/${dup.duplicate.id}`}>Открыть загруженный</Link>
            <button className="btn small ghost" onClick={() => submit(true)}>Всё равно загрузить</button>
          </div>
        </Notice>
      )}
      <button className="btn primary block" disabled={!file || busy} onClick={() => submit(false)}>{busy ? 'Загружаем…' : 'Загрузить и распознать'}</button>
      <p className="subtle">{ty('Файл хранится в зашифрованном виде и доступен только вам и специалисту, которому вы открыли доступ.')}</p>
    </div>
  );
}

// ---------- Проверка распознавания ----------

type Draft = { name: string; value_text: string; unit: string };
const toDraft = (r: Result): Draft => ({ name: r.name, value_text: r.value_text, unit: r.unit });

/** Интервал не редактируется: он из бланка или справочный — и это подписано. */
export function RefInfo({ r }: { r: Pick<Result, 'ref_text' | 'ref_source' | 'ref_note'> }) {
  if (r.ref_text) {
    return (
      <div>
        <div className="num">{r.ref_text}</div>
        <div className="tiny muted" title={r.ref_note ?? undefined}>{r.ref_source === 'reference' ? 'справочный' : 'из бланка'}</div>
      </div>
    );
  }
  return <div className="tiny muted">{r.ref_note === 'sex' ? 'укажите пол в профиле' : 'нет интервала'}</div>;
}

export function DocumentReview({ base }: { clientId?: string; base: string }) {
  const { docId: id = '' } = useParams();
  const { me } = useAuth();
  const nav = useNavigate();
  const toast = useToast();
  const d = useData(() => api.get<Doc>(`/documents/${id}`), [id]);
  const [busy, setBusy] = useState(false);
  const [adding, setAdding] = useState(false);
  const [meta, setMeta] = useState({ lab: '', collected_at: '' });
  const doc = d.data;
  useEffect(() => {
    if (doc) setMeta({ lab: doc.lab ?? '', collected_at: doc.collected_at ?? '' });
    if (doc && (doc.status === 'processing' || doc.status === 'uploaded')) {
      const t = window.setTimeout(d.reload, 1500);
      return () => window.clearTimeout(t);
    }
  }, [doc]); // eslint-disable-line react-hooks/exhaustive-deps

  if (!doc) return <Loader error={d.error} />;
  const editable = doc.status === 'needs_review' || doc.status === 'error';
  const isOwner = me!.id === doc.owner_id;
  const lowCount = doc.results.filter((r) => r.low_confidence.length).length;

  const act = async (fn: () => Promise<any>, ok?: string) => {
    setBusy(true);
    try { const r = await fn(); if (r?.id) d.setData(r); else d.reload(); if (ok) toast(ok); } catch (e) { toast(errorText(e)); } finally { setBusy(false); }
  };
  const saveMeta = () => act(() => api.patch(`/documents/${id}`, { lab: meta.lab, collected_at: meta.collected_at || undefined }));
  const confirm = async () => {
    if (meta.lab !== (doc.lab ?? '') || meta.collected_at !== (doc.collected_at ?? '')) {
      if (!meta.collected_at) { toast('Укажите дату забора'); return; }
      await api.patch(`/documents/${id}`, { lab: meta.lab, collected_at: meta.collected_at }).catch(() => {});
    }
    act(() => api.post(`/documents/${id}/confirm`), 'Результаты подтверждены и добавлены в динамику');
  };
  const remove = async () => {
    if (!window.confirm('Удалить документ и все его значения?')) return;
    try { await api.del(`/documents/${id}`); toast('Документ удалён'); nav(base, { replace: true }); } catch (e) { toast(errorText(e)); }
  };

  return (
    <div className="stack" style={{ '--gap': '16px' } as any}>
      <div className="row between wrap">
        <div>
          <h1 style={{ fontSize: 24 }}>{doc.lab ?? doc.file_name}</h1>
          <p className="small muted">Загрузил(а) {doc.uploaded_by_name} · {fmtDateTime(doc.uploaded_at)}{doc.pages ? ` · ${doc.pages} стр.` : ''}</p>
        </div>
        <DocBadge status={doc.status} />
      </div>

      {(doc.status === 'processing' || doc.status === 'uploaded') && <Notice><span className="row"><span className="spinner" /> Распознаём документ. Обычно это несколько секунд.</span></Notice>}
      {doc.ownership === 'needs_check' && (
        <Notice kind="warn">
          <b>{ty(`В бланке указан другой человек: ${doc.patient_name}`)}</b>
          <div className="small">{ty('Пока принадлежность не подтверждена, результаты не попадут в профиль.')}</div>
          {isOwner ? (
            <div className="row wrap mt-8">
              <button className="btn small" disabled={busy} onClick={() => act(() => api.post(`/documents/${id}/ownership`, { mine: true }), 'Отмечено: документ ваш')}>Это мой документ</button>
              <button className="btn small ghost" disabled={busy} onClick={async () => { await api.post(`/documents/${id}/ownership`, { mine: false }); toast('Чужой документ удалён'); nav(base, { replace: true }); }}>Не мой — удалить</button>
            </div>
          ) : <div className="small mt-8">Подтвердить принадлежность может только сам клиент.</div>}
        </Notice>
      )}
      {doc.error && doc.status !== 'confirmed' && <Notice kind={doc.status === 'error' ? 'danger' : 'warn'}>{doc.error}</Notice>}

      <div className="review">
        <div className="viewer">
          {doc.mime === 'application/pdf'
            ? <Suspense fallback={<div style={{ padding: 24 }}><div className="spinner" /></div>}><PdfView src={`/api/documents/${id}/file`} /></Suspense>
            : <img src={`/api/documents/${id}/file`} alt="Исходный документ" />}
          <div className="row between" style={{ padding: '8px 12px' }}><span className="small muted">Исходный файл</span><a className="small" href={`/api/documents/${id}/file`} target="_blank" rel="noreferrer">Открыть отдельно</a></div>
        </div>

        <div className="card">
          <div className="grid-2">
            <Field label="Лаборатория" htmlFor="m-lab"><input id="m-lab" className="input" value={meta.lab} disabled={!editable} onChange={(e) => setMeta({ ...meta, lab: e.target.value })} onBlur={() => editable && meta.lab !== (doc.lab ?? '') && saveMeta()} /></Field>
            <Field label="Дата забора" htmlFor="m-date" error={editable && !meta.collected_at ? 'Нужна для динамики' : undefined}><input id="m-date" type="date" className="input" value={meta.collected_at} disabled={!editable} onChange={(e) => setMeta({ ...meta, collected_at: e.target.value })} onBlur={() => editable && meta.collected_at && meta.collected_at !== doc.collected_at && saveMeta()} /></Field>
          </div>

          <div className="row between mt-24">
            <h3>Значения</h3>
            {editable && lowCount > 0 && <span className="badge warn">Проверьте выделенные: {lowCount}</span>}
          </div>
          {editable && <p className="small muted mt-8">{ty('Сверьте с исходным бланком. Исправленные значения сохранятся вместе с распознанным оригиналом.')}</p>}

          <div className="mt-8">
            <div className="rrow rrow-head"><span>Показатель</span><span>Результат</span><span>Единицы</span><span>Интервал</span><span /></div>
            {doc.results.map((r) => <ResultRow key={r.id} r={r} editable={editable} onChange={(nd) => d.setData(nd)} />)}
            {doc.results.length === 0 && <p className="small muted" style={{ padding: '12px 0' }}>Значений пока нет — добавьте их вручную</p>}
          </div>
          {editable && <button className="btn outline block mt-16" onClick={() => setAdding(true)}><Icon name="plus" />Добавить показатель</button>}

          {editable && (
            <div className="stack mt-24">
              <button className="btn primary block" disabled={busy || doc.results.length === 0 || doc.ownership === 'needs_check'} onClick={confirm}><Icon name="check" />Всё верно, подтвердить</button>
              <p className="tiny muted">{ty('До подтверждения значения не попадают в динамику и не получают пояснений.')}</p>
            </div>
          )}
          {doc.status === 'confirmed' && (
            <div className="stack mt-16">
              <Notice kind="info" icon="check">Подтвердил(а) {doc.confirmed_by_name} · {fmtDateTime(doc.confirmed_at)}</Notice>
              <div className="row wrap">
                <button className="btn small" disabled={busy} onClick={() => act(() => api.post(`/documents/${id}/reopen`))}><Icon name="edit" size={16} />Исправить значения</button>
                {doc.results.slice(0, 1).map((r) => <Link key={r.id} className="btn small ghost" to={`${base}/analyte/${encodeURIComponent(resultKey(r))}`}>К динамике</Link>)}
              </div>
            </div>
          )}
          {(doc.status === 'error' || doc.status === 'needs_review') && <button className="btn ghost small mt-16" disabled={busy} onClick={() => act(() => api.post(`/documents/${id}/retry`))}><Icon name="refresh" size={16} />Распознать ещё раз</button>}
          <button className="btn ghost small mt-16" onClick={remove} style={{ color: 'var(--danger)' }}><Icon name="trash" size={16} />Удалить документ</button>
        </div>
      </div>
      {adding && <Sheet title="Новый показатель" onClose={() => setAdding(false)}><AddResultForm docId={id} onDone={(nd) => { setAdding(false); d.setData(nd); }} /></Sheet>}
    </div>
  );
}

function ResultRow({ r, editable, onChange }: { r: Result; editable: boolean; onChange: (d: Doc) => void }) {
  const [v, setV] = useState<Draft>(toDraft(r));
  const [err, setErr] = useState('');
  const toast = useToast();
  useEffect(() => { setV(toDraft(r)); }, [r]);
  const low = (f: string) => r.low_confidence.includes(f);
  const dirty = JSON.stringify(v) !== JSON.stringify(toDraft(r));
  const save = async () => {
    if (!dirty) return;
    setErr('');
    try { onChange(await api.patch<Doc>(`/results/${r.id}`, v)); } catch (e) { setErr(errorText(e)); }
  };
  const del = async () => {
    try { onChange(await api.del<Doc>(`/results/${r.id}`)); } catch (e) { toast(errorText(e)); }
  };
  if (!editable) {
    return (
      <div className="rrow">
        <div className="name"><b>{r.name}</b>{r.edited_by_name && <div className="tiny muted">исправил(а) {r.edited_by_name}{r.recognized ? `, распознано: ${r.recognized.value_text} ${r.recognized.unit}` : ''}</div>}</div>
        <div className="num"><b>{r.value_text}</b> {r.lab_flag && <span className="badge warn">{r.lab_flag}</span>}</div>
        <div>{r.unit || '—'}</div>
        <RefInfo r={r} />
        <PositionBadge r={r} />
      </div>
    );
  }
  const inp = (k: keyof Draft, label: string, field: string, extra: any = {}) => (
    <input className={`input ${low(field) ? 'low' : ''}`} value={v[k]} onChange={(e) => setV({ ...v, [k]: e.target.value })} onBlur={save} aria-label={`${label}: ${r.name}`} {...extra} />
  );
  return (
    <div className="rrow">
      <div className="name">{inp('name', 'Показатель', 'name')}{low('name') && <div className="tiny" style={{ color: 'var(--warn)' }}>нет в справочнике — проверьте название</div>}</div>
      <div><span className="rlabel">Результат</span>{inp('value_text', 'Результат', 'value', { inputMode: 'decimal' })}</div>
      <div><span className="rlabel">Единицы</span>{inp('unit', 'Единицы', 'unit')}</div>
      <div><span className="rlabel">Интервал</span><RefInfo r={r} /></div>
      <button className="btn ghost icon small" onClick={del} aria-label={`Удалить ${r.name}`}><Icon name="trash" size={18} /></button>
      {(r.low_confidence.length > 0 || err || r.edited_by_name) && (
        <div className="tiny" style={{ gridColumn: '1 / -1', color: err ? 'var(--danger)' : 'var(--text-3)' }}>
          {err || (r.low_confidence.length > 0 ? `Не уверены: ${r.low_confidence.map((f) => LOW_FIELDS[f]).join(', ')}` : '')}
          {r.edited_by_name && !err && ` Исправил(а) ${r.edited_by_name}${r.recognized ? ` · распознано: ${r.recognized.value_text} ${r.recognized.unit} ${r.recognized.ref_text}` : ''}`}
        </div>
      )}
    </div>
  );
}

function AddResultForm({ docId, onDone }: { docId: string; onDone: (d: Doc) => void }) {
  const ref = useData(() => api.get<{ code: string; name: string; unit: string }[]>('/reference/analytes'), []);
  const [v, setV] = useState({ name: '', value_text: '', unit: '' });
  const [err, setErr] = useState('');
  const set = (k: keyof typeof v) => (e: { target: { value: string } }) => setV({ ...v, [k]: e.target.value });
  const submit = async (e: FormEvent) => {
    e.preventDefault();
    try { onDone(await api.post<Doc>(`/documents/${docId}/results`, v)); } catch (e) { setErr(errorText(e)); }
  };
  return (
    <form className="stack" onSubmit={submit}>
      <Field label="Показатель" htmlFor="ar-name" hint="Начните вводить — подскажем из справочника">
        <input id="ar-name" className="input" list="analytes" value={v.name} onChange={(e) => {
          const a = ref.data?.find((x) => x.name === e.target.value);
          setV({ ...v, name: e.target.value, unit: a && !v.unit ? a.unit : v.unit });
        }} />
        <datalist id="analytes">{ref.data?.map((a) => <option key={a.code} value={a.name} />)}</datalist>
      </Field>
      <div className="grid-2">
        <Field label="Результат" htmlFor="ar-v"><input id="ar-v" className="input" inputMode="decimal" value={v.value_text} onChange={set('value_text')} placeholder="18,4" /></Field>
        <Field label="Единицы" htmlFor="ar-u"><input id="ar-u" className="input" value={v.unit} onChange={set('unit')} placeholder="нг/мл" /></Field>
      </div>
      <p className="tiny muted">{ty('Интервал вводить не нужно: подставим справочный для взрослых и подпишем, откуда он.')}</p>
      {err && <Notice kind="danger">{err}</Notice>}
      <button className="btn primary block">Добавить</button>
    </form>
  );
}

// ---------- Показатель: динамика, пояснение, комментарии ----------

export function AnalytePage({ clientId, base, role }: { clientId: string; base: string; role: 'client' | 'specialist' }) {
  const { key = '' } = useParams();
  const d = useData(() => api.get(`/clients/${clientId}/dynamics/${encodeURIComponent(key)}`), [clientId, key]);
  const [showEvents, setShowEvents] = useState(true);
  const [si, setSi] = useState(0);
  const last = d.data?.series?.[si]?.points?.at(-1);
  const r = useData(() => (last ? api.get(`/results/${last.result_id}`) : Promise.resolve(null)), [last?.result_id]);
  if (!d.data) return <Loader error={d.error} />;
  const series = d.data.series;
  if (!series.length) return <Empty icon="chart" title="Нет подтверждённых результатов">Динамика появится после подтверждения анализов</Empty>;
  const s = series[Math.min(si, series.length - 1)];
  return (
    <div className="stack" style={{ '--gap': '16px' } as any}>
      <div>
        <h1 style={{ fontSize: 26 }}>{d.data.name}</h1>
        {last && <div className="row wrap mt-8"><span className="value">{last.value_text}<small>{last.original_unit}</small></span><PositionBadge r={{ value_num: last.value, ref_low: last.ref_low, ref_high: last.ref_high }} /><span className="small muted">{fmtDate(last.date, { year: true })}{last.lab ? ` · ${last.lab}` : ''}</span></div>}
      </div>

      <div className="card">
        <div className="card-head wrap">
          <h2>Динамика</h2>
          <label className="check small"><input type="checkbox" checked={showEvents} onChange={(e) => setShowEvents(e.target.checked)} />События курса</label>
        </div>
        {series.length > 1 && (
          <div style={{ marginBottom: 12 }}>
            <Seg label="Единицы" value={String(si)} onChange={(v) => setSi(Number(v))} options={series.map((x: any, i: number) => ({ value: String(i), label: x.unit || 'без единиц' }))} />
            <p className="tiny muted mt-8">{ty('Результаты в этих единицах нельзя надёжно перевести друг в друга, поэтому они показаны отдельно.')}</p>
          </div>
        )}
        <DynamicsChart points={s.points} unit={s.unit} events={d.data.events} showEvents={showEvents} />
        <div className="legend mt-8">
          <span><i style={{ background: 'var(--ref-band)' }} />интервал лаборатории</span>
          {showEvents && <span><i style={{ background: 'var(--auto)' }} />события курса</span>}
        </div>
        <div className="table-wrap mt-16">
          <table className="table">
            <thead><tr><th>Дата забора</th><th className="num">Результат</th><th>Интервал</th><th>Лаборатория</th><th /></tr></thead>
            <tbody>
              {[...s.points].reverse().map((p: any) => (
                <tr key={p.result_id}>
                  <td className="nowrap">{fmtDate(p.date, { year: true })}</td>
                  <td className="num nowrap"><b>{p.value_text}</b> {p.original_unit}{p.converted && <div className="tiny muted">= {num(p.value)} {s.unit}</div>}</td>
                  <td className="nowrap">{p.ref_text || '—'}{p.ref_source === 'reference' && <div className="tiny muted">справочный</div>}</td>
                  <td>{p.lab ?? '—'}</td>
                  <td><Link to={`${base}/documents/${p.document_id}`} className="small nowrap">Бланк</Link></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      <Explanation r={r.data} />
      <Comments clientId={clientId} targetType="analyte" targetId={key} role={role} />
    </div>
  );
}

function Explanation({ r }: { r: any }) {
  if (!r) return null;
  const e = r.explanation;
  return (
    <div className="stack">
      <div className="level">
        <div className="level-head"><span className="badge">Данные лаборатории</span><span className="tiny muted">из бланка, {fmtDate(r.collected_at, { year: true })}</span></div>
        <div className="row wrap"><span className="value">{r.value_text}<small>{r.unit}</small></span>{r.ref_text && <span className="small muted">{r.ref_source === 'reference' ? 'справочный интервал' : 'интервал из бланка'} {r.ref_text} {r.unit}</span>}{r.lab_flag && <span className="badge warn">отметка лаборатории: {r.lab_flag}</span>}</div>
        <RangeBar r={r} />
        {r.ref_source === 'reference' && r.ref_note && <p className="tiny muted mt-8">{r.ref_note}. В бланке интервала нет — лаборатории могут использовать свои значения.</p>}
        {!r.ref_text && r.ref_note === 'sex' && <p className="tiny muted mt-8">Интервал зависит от пола — укажите его в <Link to="/settings">настройках профиля</Link>.</p>}
      </div>
      {e && (
        <div className="level auto">
          <div className="level-head">
            <span className="badge auto"><Icon name="info" />Автоматическое пояснение</span>
            <span className="tiny" style={{ color: 'var(--auto)' }}>не проверено специалистом</span>
          </div>
          {e.text.split('\n\n').map((p: string, k: number) => <p key={k}>{ty(p)}</p>)}
          {e.source_url && <p className="tiny mt-8">Источник: <a href={e.source_url} target="_blank" rel="noreferrer noopener">{e.source_title}</a></p>}
          <p className="tiny muted mt-8">Сформировано {fmtDateTime(e.created_at)} · справочник {e.version} · по подтверждённому значению {e.input.value_text} {e.input.unit}</p>
        </div>
      )}
    </div>
  );
}

export function Comments({ clientId, targetType, targetId, role }: { clientId: string; targetType: string; targetId?: string; role: 'client' | 'specialist' }) {
  const q = `target_type=${targetType}${targetId ? `&target_id=${encodeURIComponent(targetId)}` : ''}`;
  const list = useData(() => api.get<Comment[]>(`/clients/${clientId}/comments?${q}`), [clientId, q]);
  const [text, setText] = useState('');
  const [kind, setKind] = useState<'conclusion' | 'internal'>('conclusion');
  const [busy, setBusy] = useState(false);
  const toast = useToast();
  const send = async (e: FormEvent) => {
    e.preventDefault();
    if (!text.trim()) return;
    setBusy(true);
    try {
      await api.post(`/clients/${clientId}/comments`, { body: text, kind, target_type: targetType, target_id: targetId });
      setText('');
      toast(role === 'client' ? 'Вопрос отправлен специалисту' : kind === 'internal' ? 'Заметка сохранена' : 'Комментарий опубликован, клиент получит уведомление');
      list.reload();
    } catch (e) { toast(errorText(e)); } finally { setBusy(false); }
  };
  const items = list.data ?? [];
  return (
    <div className="card">
      <h2>{role === 'client' ? 'Комментарии специалиста' : 'Комментарии и заметки'}</h2>
      <div className="stack mt-16">
        {items.length === 0 && <p className="small muted">{role === 'client' ? 'Специалист пока не оставил комментариев к этому показателю' : 'Пока ничего нет'}</p>}
        {items.map((c) => (
          <div key={c.id} className={`level ${c.kind === 'conclusion' ? 'spec' : ''}`} style={c.kind === 'internal' ? { borderStyle: 'dashed' } : undefined}>
            <div className="level-head">
              <span className={`badge ${c.kind === 'conclusion' ? 'spec' : c.kind === 'internal' ? 'warn' : ''}`}>
                {c.kind === 'conclusion' ? 'Комментарий специалиста' : c.kind === 'internal' ? <><Icon name="lock" />Внутренняя заметка — клиент не видит</> : 'Вопрос клиента'}
              </span>
              <span className="tiny muted">{c.author_name} · {fmtDateTime(c.created_at)}</span>
            </div>
            <p style={{ whiteSpace: 'pre-wrap' }}>{c.body}</p>
          </div>
        ))}
      </div>
      <form className="stack mt-16" onSubmit={send}>
        {role === 'specialist' && (
          <Seg label="Тип записи" value={kind} onChange={setKind} options={[{ value: 'conclusion', label: 'Для клиента' }, { value: 'internal', label: 'Внутренняя заметка' }]} />
        )}
        <textarea className="textarea" value={text} onChange={(e) => setText(e.target.value)} aria-label="Текст"
          placeholder={role === 'client' ? 'Задать вопрос специалисту' : kind === 'internal' ? 'Видно только вам' : 'Интерпретация и рекомендации — клиент увидит это и получит уведомление'} />
        <button className="btn primary" disabled={busy || !text.trim()} style={{ alignSelf: 'flex-start' }}>
          {role === 'client' ? 'Отправить вопрос' : kind === 'internal' ? 'Сохранить заметку' : 'Опубликовать'}
        </button>
        {role === 'client' && <p className="tiny muted">{ty('Специалист ответит, когда увидит сообщение. Это не канал для срочной помощи.')}</p>}
      </form>
    </div>
  );
}
