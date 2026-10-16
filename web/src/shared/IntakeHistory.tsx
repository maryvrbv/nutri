import { useMemo, useState } from 'react';
import { api, type Intake, type Stats } from '../api';
import { addDays, amountLabel, fmtDate, fmtDateTime, pct, SKIP_REASONS, ty, WD_SHORT, weekdayIdx } from '../format';
import { Empty, Loader, Seg, StateBadge, useData } from '../ui';

export function StatsBlock({ s, compact }: { s: Stats; compact?: boolean }) {
  const w = (n: number) => (s.past ? `${(n / s.past) * 100}%` : '0');
  return (
    <div className="stack">
      <div className="stats">
        <div className="stat"><span className="v">{pct(s.adherence)}</span><span className="k">выполнение</span></div>
        <div className="stat"><span className="v">{pct(s.completeness)}</span><span className="k">полнота отметок</span></div>
        {!compact && <div className="stat"><span className="v">{s.planned_total}</span><span className="k">запланировано</span></div>}
      </div>
      <div className="progress" role="img" aria-label={`Принято ${s.taken}, пропущено ${s.skipped}, без отметки ${s.unmarked}`}>
        <span style={{ width: w(s.taken), background: 'var(--taken)' }} />
        <span style={{ width: w(s.skipped), background: 'var(--skipped)' }} />
        <span style={{ width: w(s.unmarked), background: 'var(--line-strong)' }} />
      </div>
      <div className="legend">
        <span><i style={{ background: 'var(--taken)' }} />принято {s.taken}</span>
        <span><i style={{ background: 'var(--skipped)' }} />пропущено {s.skipped}</span>
        <span><i style={{ background: 'var(--line-strong)' }} />без отметки {s.unmarked}</span>
        {s.future > 0 && <span><i style={{ background: 'var(--primary-soft)' }} />впереди {s.future}</span>}
        {s.cancelled > 0 && <span><i style={{ background: 'var(--surface-3)' }} />отменено {s.cancelled}</span>}
      </div>
      <p className="tiny muted">{ty('Выполнение — доля принятых среди наступивших приёмов. Полнота — сколько из них отмечено вообще: без отметки ≠ пропуск.')}</p>
    </div>
  );
}

export function IntakeHistory({ clientId, today, tz }: { clientId: string; today: string; tz?: string }) {
  const [period, setPeriod] = useState<'7' | '30' | '90'>('30');
  const [name, setName] = useState('');
  const [view, setView] = useState<'calendar' | 'list'>('calendar');
  const [picked, setPicked] = useState<string | null>(null);
  const from = addDays(today, -(Number(period) - 1));
  const to = view === 'calendar' ? addDays(today, 7) : today;
  const d = useData(() => api.get(`/clients/${clientId}/intakes?from=${from}&to=${to}${name ? `&name=${encodeURIComponent(name)}` : ''}`), [clientId, from, to, name]);
  const items: Intake[] = d.data?.items ?? [];
  const byDate = useMemo(() => {
    const m = new Map<string, Intake[]>();
    for (const i of items) m.set(i.date, [...(m.get(i.date) ?? []), i]);
    return m;
  }, [items]);

  return (
    <div className="stack" style={{ '--gap': '16px' } as any}>
      <div className="filters" style={{ marginBottom: 0 }}>
        <Seg label="Период" value={period} onChange={setPeriod} options={[{ value: '7', label: '7 дней' }, { value: '30', label: '30 дней' }, { value: '90', label: '90 дней' }]} />
        <select className="select" style={{ width: 'auto', minWidth: 180 }} value={name} onChange={(e) => setName(e.target.value)} aria-label="Добавка">
          <option value="">Все добавки</option>
          {(d.data?.names ?? []).map((n: string) => <option key={n} value={n}>{n}</option>)}
        </select>
        <Seg label="Вид" value={view} onChange={setView} options={[{ value: 'calendar', label: 'Календарь' }, { value: 'list', label: 'Список' }]} />
      </div>
      {!d.data ? <Loader error={d.error} retry={d.reload} /> : (
        <>
          <div className="card"><StatsBlock s={d.data.stats} /></div>
          {items.length === 0 ? <div className="card"><Empty icon="calendar" title="За этот период приёмов нет" /></div> : view === 'calendar' ? (
            <div className="card">
              <Calendar from={[...byDate.keys()].sort()[0] ?? from} to={to} today={today} byDate={byDate} picked={picked} onPick={setPicked} />
              {picked && <div className="mt-16"><h3>{fmtDate(picked, { weekday: true })}</h3><DayList items={byDate.get(picked) ?? []} tz={tz} /></div>}
            </div>
          ) : (
            <div className="card">
              {[...byDate.entries()].filter(([dt]) => dt <= today).map(([dt, list]) => (
                <div key={dt} style={{ marginBottom: 12 }}>
                  <h3 style={{ marginBottom: 4 }}>{fmtDate(dt, { weekday: true })}</h3>
                  <DayList items={list} tz={tz} />
                </div>
              ))}
            </div>
          )}
        </>
      )}
    </div>
  );
}

function DayList({ items, tz }: { items: Intake[]; tz?: string }) {
  if (!items.length) return <p className="small muted">Приёмов не было</p>;
  return (
    <div className="list">
      {items.map((i) => (
        <div key={i.id} className="list-item" style={{ padding: '10px 0', alignItems: 'flex-start' }}>
          <span className="num small muted" style={{ width: 44 }}>{i.time_local}</span>
          <div className="grow">
            <div className="list-title">{i.name}</div>
            <div className="small muted">{amountLabel(i.amount, i.amount_unit)} · версия схемы {i.version_number}</div>
            {i.state === 'taken' && i.taken_at && <div className="tiny muted">Принято {fmtDateTime(i.taken_at, tz)}{i.recorded_at && Math.abs(new Date(i.recorded_at).getTime() - new Date(i.taken_at).getTime()) > 30 * 60_000 ? ` · отмечено ${fmtDateTime(i.recorded_at, tz)}` : ''}</div>}
            {i.state === 'skipped' && i.reason && <div className="tiny muted">Причина: {SKIP_REASONS[i.reason]?.toLowerCase()}</div>}
          </div>
          <StateBadge state={i.state} />
        </div>
      ))}
    </div>
  );
}

function Calendar({ from, to, today, byDate, picked, onPick }: { from: string; to: string; today: string; byDate: Map<string, Intake[]>; picked: string | null; onPick: (d: string) => void }) {
  const start = addDays(from, -(weekdayIdx(from) - 1));
  const days: string[] = [];
  for (let d = start; d <= to || weekdayIdx(d) !== 1; d = addDays(d, 1)) days.push(d);
  return (
    <div className="cal" role="grid" aria-label="Календарь приёма">
      {WD_SHORT.map((w) => <div key={w} className="wd">{w}</div>)}
      {days.map((d) => {
        const list = (byDate.get(d) ?? []).filter((i) => i.state !== 'cancelled');
        const n = list.length;
        const c = (s: string) => list.filter((i) => i.state === s).length;
        const out = d < from || d > to;
        return (
          <button key={d} disabled={out || !n} aria-pressed={picked === d} onClick={() => onPick(d)}
            aria-label={`${fmtDate(d)}: ${n ? `принято ${c('taken')} из ${n}` : 'нет приёмов'}`} style={d === today ? { outline: '2px solid var(--primary)', outlineOffset: -2 } : undefined}>
            <span>{Number(d.slice(8))}</span>
            {n > 0 && (
              <span className="bar">
                <span style={{ width: `${(c('taken') / n) * 100}%`, background: 'var(--taken)' }} />
                <span style={{ width: `${(c('skipped') / n) * 100}%`, background: 'var(--skipped)' }} />
                <span style={{ width: `${(c('unmarked') / n) * 100}%`, background: 'var(--line-strong)' }} />
              </span>
            )}
          </button>
        );
      })}
    </div>
  );
}
