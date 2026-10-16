import { useState } from 'react';
import { api } from '../api';
import { addDays, daysBetween, fmtShort } from '../format';
import { Loader, Seg, useData } from '../ui';

/**
 * Общая временная шкала: приём, самочувствие, анализы и события курса в одни и те же дни.
 * Ничего не связывает причинно — только показывает рядом.
 */
export function Timeline({ clientId }: { clientId: string }) {
  const [days, setDays] = useState<'14' | '30' | '60'>('30');
  const d = useData(() => api.get(`/clients/${clientId}/timeline?from=${addDays(todayGuess(), -(Number(days) - 1))}`), [clientId, days]);
  return (
    <div className="stack">
      <div className="row between wrap">
        <Seg label="Период" value={days} onChange={setDays} options={[{ value: '14', label: '2 недели' }, { value: '30', label: 'Месяц' }, { value: '60', label: '2 месяца' }]} />
      </div>
      {!d.data ? <Loader error={d.error} rows={1} /> : <TimelineGrid data={d.data} />}
    </div>
  );
}

function todayGuess() { return new Date().toISOString().slice(0, 10); }

function TimelineGrid({ data }: { data: any }) {
  const n = daysBetween(data.from, data.to) + 1;
  const dates = Array.from({ length: n }, (_, i) => addDays(data.from, i));
  const intake = new Map<string, any>(data.intakes.map((x: any) => [x.date, x]));
  const wb = new Map<string, any>(data.wellbeing.map((x: any) => [x.date, x]));
  const labs = new Set<string>(data.labs.map((x: any) => x.date));
  const ev = new Map<string, any[]>();
  for (const e of data.events) ev.set(e.date, [...(ev.get(e.date) ?? []), e]);
  const shade = (v: number | null | undefined) => (v ? `color-mix(in srgb, var(--primary) ${15 + v * 17}%, var(--surface-2))` : undefined);
  const intakeCell = (x: any) => {
    if (!x) return undefined;
    const past = x.taken + x.skipped + x.unmarked;
    if (!past) return undefined;
    const p = x.taken / past;
    return `color-mix(in srgb, var(--taken) ${Math.round(20 + p * 80)}%, var(--surface-2))`;
  };
  const title = (date: string, s: string) => `${fmtShort(date)}: ${s}`;
  const Row = ({ label, render }: { label: string; render: (d: string) => { bg?: string; t: string; mark?: boolean; children?: any } }) => (
    <div className="tl-row">
      <div className="muted">{label}</div>
      <div className="tl-cells">
        {dates.map((dt) => {
          const r = render(dt);
          return <div key={dt} className={`tl-cell ${r.mark ? 'mark' : ''}`} style={{ background: r.bg }} title={title(dt, r.t)}>{r.children}</div>;
        })}
      </div>
    </div>
  );
  return (
    <div className="timeline" role="group" aria-label="Общая временная шкала">
      <div className="tl-row"><div /><div className="tl-cells">{dates.map((dt, i) => {
        const show = i === 0 || i === n - 1 || (i === Math.floor(n / 2) && n > 10);
        const side = i === 0 ? { left: 0 } : i === n - 1 ? { right: 0 } : { left: '50%', transform: 'translateX(-50%)' };
        return <div key={dt} className="tiny muted" style={{ position: 'relative', height: 18 }}>{show && <span style={{ position: 'absolute', top: 0, whiteSpace: 'nowrap', ...side }}>{fmtShort(dt)}</span>}</div>;
      })}</div></div>
      <Row label="Приём" render={(dt) => {
        const x = intake.get(dt);
        if (!x) return { t: 'нет приёмов' };
        return { bg: intakeCell(x), t: `принято ${x.taken}, пропуск ${x.skipped}, без отметки ${x.unmarked}${x.planned ? `, впереди ${x.planned}` : ''}` };
      }} />
      <Row label="Энергия" render={(dt) => ({ bg: shade(wb.get(dt)?.energy), t: wb.get(dt)?.energy ? `${wb.get(dt).energy} из 5` : 'нет записи' })} />
      <Row label="Сон" render={(dt) => ({ bg: shade(wb.get(dt)?.sleep), t: wb.get(dt)?.sleep ? `${wb.get(dt).sleep} из 5` : 'нет записи' })} />
      <Row label="Самочувствие" render={(dt) => {
        const w = wb.get(dt);
        return { bg: w?.adverse ? 'var(--danger-soft)' : shade(w?.overall), t: w ? `${w.overall ?? '—'} из 5${w.adverse ? ', нежелательные ощущения' : ''}` : 'нет записи', mark: !!w?.adverse, children: w?.adverse ? <span className="dot" style={{ color: 'var(--danger)' }} /> : null };
      }} />
      <Row label="Анализы" render={(dt) => ({ t: labs.has(dt) ? 'сданы анализы' : '—', mark: labs.has(dt), bg: labs.has(dt) ? 'var(--auto-soft)' : undefined, children: labs.has(dt) ? <span className="dot" /> : null })} />
      <Row label="Курс" render={(dt) => {
        const e = ev.get(dt);
        return { t: e ? e.map((x) => x.title).join('; ') : '—', mark: !!e, bg: e ? 'var(--auto-soft)' : undefined, children: e ? <span className="dot" /> : null };
      }} />
      <div className="legend mt-8">
        <span><i style={{ background: 'var(--taken)' }} />доля принятых</span>
        <span><i style={{ background: 'var(--primary)' }} />оценка 1–5</span>
        <span><i style={{ background: 'var(--danger-soft)' }} />нежелательные ощущения</span>
        <span><i style={{ background: 'var(--surface-2)' }} />нет данных</span>
      </div>
    </div>
  );
}
