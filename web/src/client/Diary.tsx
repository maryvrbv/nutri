import { useEffect, useState } from 'react';
import { api, type Wellbeing } from '../api';
import { useAuth } from '../auth';
import { fmtDate, fmtDayTitle, SYMPTOMS, ty } from '../format';
import { Empty, Icon, Loader, Notice, Scale, errorText, useData, useToast } from '../ui';
import { Timeline } from '../shared/Timeline';

export function WellbeingForm({ date, initial, onSaved, compact }: { date: string; initial: Wellbeing | null; onSaved?: () => void; compact?: boolean }) {
  const toast = useToast();
  const [v, setV] = useState({ energy: null as number | null, sleep: null as number | null, overall: null as number | null, symptoms: [] as string[], adverse: false, comment: '' });
  const [more, setMore] = useState(!compact);
  const [busy, setBusy] = useState(false);
  const [saved, setSaved] = useState(false);
  useEffect(() => {
    setV({ energy: initial?.energy ?? null, sleep: initial?.sleep ?? null, overall: initial?.overall ?? null, symptoms: initial?.symptoms ?? [], adverse: !!initial?.adverse, comment: initial?.comment ?? '' });
    setSaved(!!initial);
    if (initial && (initial.symptoms.length || initial.comment || initial.adverse)) setMore(true);
  }, [initial, date]);
  const set = (patch: Partial<typeof v>) => { setV({ ...v, ...patch }); setSaved(false); };
  const save = async () => {
    setBusy(true);
    try {
      await api.put(`/clients/me/wellbeing/${date}`, v);
      setSaved(true);
      toast('Запись сохранена');
      onSaved?.();
    } catch (e) { toast(errorText(e)); } finally { setBusy(false); }
  };
  const toggleSym = (s: string) => set({ symptoms: v.symptoms.includes(s) ? v.symptoms.filter((x) => x !== s) : [...v.symptoms, s] });
  return (
    <div className="stack" style={{ '--gap': '16px' } as any}>
      <Scale label="Энергия" value={v.energy} onChange={(x) => set({ energy: x })} low="без сил" high="бодро" />
      <Scale label="Сон" value={v.sleep} onChange={(x) => set({ sleep: x })} low="плохо" high="отлично" />
      <Scale label="Общее самочувствие" value={v.overall} onChange={(x) => set({ overall: x })} low="плохо" high="отлично" />
      {!more ? (
        <button className="linkbtn small" style={{ alignSelf: 'flex-start' }} onClick={() => setMore(true)}>+ Симптомы и комментарий</button>
      ) : (
        <>
          <div>
            <div className="label">Симптомы</div>
            <div className="chips mt-8">
              {Object.entries(SYMPTOMS).map(([k, l]) => <button key={k} type="button" className="chip" aria-pressed={v.symptoms.includes(k)} onClick={() => toggleSym(k)}>{l}</button>)}
            </div>
          </div>
          <label className="check">
            <input type="checkbox" checked={v.adverse} onChange={(e) => set({ adverse: e.target.checked })} />
            <span>Есть нежелательные ощущения, которые могут быть связаны с приёмом<br /><span className="subtle">Специалист увидит отметку в карточке</span></span>
          </label>
          <div className="field">
            <label htmlFor={`c-${date}`}>Комментарий</label>
            <textarea id={`c-${date}`} className="textarea" value={v.comment} onChange={(e) => set({ comment: e.target.value })} placeholder="Что заметили за день" maxLength={2000} />
          </div>
          {v.adverse && <Notice kind="warn">{ty('Специалист прочитает запись не сразу. Если состояние ухудшается — обратитесь к врачу или вызовите скорую: 103 или 112.')}</Notice>}
        </>
      )}
      <button className="btn primary block" onClick={save} disabled={busy || saved}>{saved ? <><Icon name="check" />Сохранено</> : busy ? 'Сохраняем…' : 'Сохранить'}</button>
    </div>
  );
}

export function DiaryPage() {
  const { me } = useAuth();
  const [date, setDate] = useState(me!.today);
  const list = useData(() => api.get<Wellbeing[]>('/clients/me/wellbeing'), []);
  const current = list.data?.find((w) => w.date === date) ?? null;
  return (
    <div className="page">
      <div className="page-head"><div><div className="eyebrow">Самочувствие</div><h1>Дневник</h1></div></div>
      <div className="card">
        <div className="row between" style={{ marginBottom: 14 }}>
          <h2>{fmtDayTitle(date, me!.today)}</h2>
          <input type="date" className="input" style={{ width: 'auto' }} value={date} max={me!.today} onChange={(e) => e.target.value && setDate(e.target.value)} aria-label="Дата записи" />
        </div>
        {list.data ? <WellbeingForm date={date} initial={current} onSaved={list.reload} /> : <Loader />}
      </div>

      <h2 className="mt-24" style={{ marginBottom: 10 }}>Общая картина</h2>
      <div className="card"><Timeline clientId="me" /></div>

      <h2 className="mt-24" style={{ marginBottom: 10 }}>Записи</h2>
      {!list.data ? <Loader error={list.error} /> : list.data.length === 0 ? (
        <div className="card"><Empty icon="heart" title="Записей пока нет">Оценки за пару секунд в день помогают специалисту видеть, как идёт курс</Empty></div>
      ) : (
        <div className="card"><div className="list">
          {list.data.map((w) => (
            <button key={w.id} className="list-item" style={{ background: 'none', border: 0, width: '100%', textAlign: 'left', cursor: 'pointer' }} onClick={() => { setDate(w.date); window.scrollTo({ top: 0, behavior: 'smooth' }); }}>
              <div className="grow">
                <div className="row wrap"><span className="list-title">{fmtDate(w.date, { weekday: true })}</span>{!!w.adverse && <span className="badge danger">Нежелательные ощущения</span>}</div>
                <div className="small muted">
                  {[w.energy && `энергия ${w.energy}/5`, w.sleep && `сон ${w.sleep}/5`, w.overall && `самочувствие ${w.overall}/5`].filter(Boolean).join(' · ') || 'без оценок'}
                  {w.symptoms.length > 0 && ` · ${w.symptoms.map((s) => SYMPTOMS[s]?.toLowerCase()).join(', ')}`}
                </div>
                {w.comment && <div className="small mt-8">{w.comment}</div>}
              </div>
              <Icon name="right" className="chev" />
            </button>
          ))}
        </div></div>
      )}
      <p className="subtle mt-16">{ty('Графики показывают, что происходило в одни и те же дни. Они не доказывают, что изменения вызваны конкретной добавкой.')}</p>
    </div>
  );
}
