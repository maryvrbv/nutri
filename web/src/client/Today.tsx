import { useEffect, useMemo, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { api, rid, type Intake, type Scheme } from '../api';
import { useAuth } from '../auth';
import { addDays, amountLabel, FOOD_LABELS, fmtDate, fmtDateTime, fmtDayTitle, fmtTime, PART_LABELS, SKIP_REASONS, ty } from '../format';
import { useNotifications } from '../notifications';
import { Icon, Loader, Notice, Sheet, StateBadge, errorText, useData, useToast } from '../ui';
import { WellbeingForm } from './Diary';
import { InstallBanner } from '../pwa';

type Group = { key: string; time: string; slot: string; items: Intake[] };

function groupIntakes(list: Intake[]): Group[] {
  const map = new Map<string, Group>();
  for (const i of list) {
    const key = `${i.time_local}|${i.slot}`;
    const g = map.get(key) ?? { key, time: i.time_local, slot: i.slot, items: [] };
    g.items.push(i);
    map.set(key, g);
  }
  return [...map.values()].sort((a, b) => a.time.localeCompare(b.time));
}

export function TodayPage() {
  const { me } = useAuth();
  const [params, setParams] = useSearchParams();
  const today = me!.today;
  const [date, setDate] = useState(params.get('date') || today);
  const day = useData(() => api.get(`/clients/me/today?date=${date}`), [date]);
  const schemes = useData(() => api.get<Scheme[]>('/clients/me/schemes'), []);
  const { items: notes, markRead } = useNotifications();
  const toast = useToast();
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [skipFor, setSkipFor] = useState<Intake[] | null>(null);
  const [lateFor, setLateFor] = useState<Intake[] | null>(null);
  const [editFor, setEditFor] = useState<Intake | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => { setSelected(new Set()); }, [date]);
  useEffect(() => {
    if (params.get('connected')) { toast('Доступ открыт. Специалист увидит ваши данные.'); params.delete('connected'); setParams(params, { replace: true }); }
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const intakes: Intake[] = day.data?.intakes ?? [];
  const groups = useMemo(() => groupIntakes(intakes), [intakes]);
  const active = intakes.filter((i) => i.state !== 'cancelled');
  const done = active.filter((i) => i.state === 'taken').length;
  const progress = active.length ? Math.round((done / active.length) * 100) : 0;
  const isPast = date < today;
  const isFuture = date > today;

  const mark = async (list: Intake[], status: 'taken' | 'skipped' | null, extra: { reason?: string; taken_at?: string } = {}) => {
    if (!list.length) return;
    setBusy(true);
    const ids = list.map((i) => i.id);
    // Оптимистичное обновление: интерфейс откликается сразу, при ошибке — откат
    const prev = day.data;
    day.setData({ ...day.data, intakes: intakes.map((i) => (ids.includes(i.id) ? { ...i, state: status ?? (i.due_at > new Date().toISOString() ? 'planned' : 'unmarked'), mark_status: status } : i)) });
    try {
      await api.post('/clients/me/intakes/mark', { planned_ids: ids, status, request_id: rid(), ...extra });
      setSelected(new Set());
      if (status === 'taken') toast({ text: list.length > 1 ? `Отмечено: ${list.length}` : `${list[0].name} — принято`, action: { label: 'Отменить', run: () => mark(list, null) } });
      if (status === 'skipped') toast('Пропуск отмечен');
      day.reload();
    } catch (e) {
      day.setData(prev);
      toast(errorText(e));
    } finally { setBusy(false); }
  };

  const snooze = async (list: Intake[]) => {
    try {
      await api.post('/clients/me/intakes/snooze', { planned_ids: list.map((i) => i.id), minutes: 30 });
      toast('Напомним через 30 минут');
      day.reload();
    } catch (e) { toast(errorText(e)); }
  };

  const toggle = (id: string) => {
    const s = new Set(selected);
    s.has(id) ? s.delete(id) : s.add(id);
    setSelected(s);
  };

  const takeGroup = (g: Group) => {
    const open = g.items.filter((i) => i.state === 'planned' || i.state === 'unmarked');
    const chosen = open.filter((i) => selected.has(i.id));
    const list = chosen.length ? chosen : open;
    if (isPast) setLateFor(list); else mark(list, 'taken');
  };

  const fresh = (notes ?? []).filter((n) => !n.read_at && ['scheme_new', 'scheme_updated', 'scheme_cancelled', 'comment', 'control_date'].includes(n.kind)).slice(0, 2);
  const control = (schemes.data ?? []).filter((s) => (s.status === 'active' || s.status === 'scheduled') && s.current?.control_date && s.current.control_date >= today)
    .map((s) => s.current!.control_date!).sort()[0];
  const hasSchemes = (schemes.data ?? []).some((s) => s.status === 'active' || s.status === 'scheduled');

  return (
    <div className="page">
      <div className="page-head">
        <div>
          <div className="eyebrow">{fmtDate(date, { weekday: true })}</div>
          <h1>{date === today ? `Привет, ${me!.name.split(' ')[0]}` : fmtDayTitle(date, today)}</h1>
        </div>
        {active.length > 0 && (
          <div className="ring" style={{ '--p': progress } as any} role="img" aria-label={`Принято ${done} из ${active.length}`}>
            <span>{done}/{active.length}</span>
          </div>
        )}
      </div>

      <div className="daybar">
        <button className="btn icon outline" onClick={() => setDate(addDays(date, -1))} aria-label="Предыдущий день"><Icon name="left" /></button>
        <div className="date">{fmtDayTitle(date, today)}</div>
        <button className="btn icon outline" onClick={() => setDate(addDays(date, 1))} aria-label="Следующий день"><Icon name="right" /></button>
      </div>
      {date !== today && <button className="linkbtn small" style={{ marginTop: -8, marginBottom: 12 }} onClick={() => setDate(today)}>Вернуться к сегодня</button>}

      {date === today && <InstallBanner />}
      {date === today && fresh.length > 0 && (
        <div className="stack" style={{ marginBottom: 8 }}>
          {fresh.map((n) => (
            <Link key={n.id} to={n.link ?? '/notifications'} onClick={() => markRead([n.id])} className="notice info" style={{ textDecoration: 'none' }}>
              <Icon name={n.kind === 'comment' ? 'message' : n.kind === 'control_date' ? 'calendar' : 'pill'} />
              <div className="grow"><b>{n.title}</b>{n.body && <div className="small">{n.body}</div>}</div>
              <Icon name="right" />
            </Link>
          ))}
        </div>
      )}
      {date === today && control && <Notice kind="plain" icon="calendar">{ty(`Контрольная дата — ${fmtDate(control)}. Специалист просил к ней пересдать анализы.`)}</Notice>}

      {!day.data ? <div className="mt-16"><Loader error={day.error} retry={day.reload} /></div> : (
        <>
          {groups.length === 0 && (
            <div className="card mt-16">
              {hasSchemes || isFuture || isPast ? (
                <div className="empty"><Icon name="leaf" /><h3>{isPast ? 'В этот день приёмов не было' : 'В этот день приёмов нет'}</h3></div>
              ) : (
                <div className="empty">
                  <Icon name="pill" />
                  <h3>Схемы приёма пока нет</h3>
                  <p className="small">{ty('Когда специалист опубликует схему, здесь появится план на каждый день. А пока можно добавить анализы или заполнить дневник.')}</p>
                  <div className="row wrap mt-16" style={{ justifyContent: 'center' }}>
                    <Link className="btn" to="/labs/upload"><Icon name="plus" />Добавить анализ</Link>
                  </div>
                </div>
              )}
            </div>
          )}

          {groups.map((g) => {
            const open = g.items.filter((i) => i.state === 'planned' || i.state === 'unmarked');
            const chosen = open.filter((i) => selected.has(i.id)).length;
            const part = PART_LABELS[g.slot];
            return (
              <section className="slot" key={g.key} aria-labelledby={`slot-${g.key}`}>
                <div className="slot-head">
                  <div className="slot-time" id={`slot-${g.key}`}>{part ? part.label : g.time}{part && <small>около {g.time}</small>}</div>
                  {open.length === 0 && g.items.every((i) => i.state === 'taken') && <span className="badge taken"><Icon name="check" />Всё принято</span>}
                </div>
                {g.items.map((i) => (
                  <IntakeCard key={i.id} i={i} selected={selected.has(i.id)} onToggle={() => toggle(i.id)} onEdit={() => setEditFor(i)} canMark={!isFuture} />
                ))}
                {open.length > 0 && !isFuture && (
                  <div className="slot-actions">
                    <button className="btn primary" disabled={busy} onClick={() => takeGroup(g)}>
                      <Icon name="check" />{chosen ? `Принято (${chosen})` : open.length > 1 ? `Принято всё (${open.length})` : 'Принято'}
                    </button>
                    <button className="btn" disabled={busy} onClick={() => setSkipFor(chosen ? open.filter((i) => selected.has(i.id)) : open)} aria-label="Пропустить приём">Пропустить</button>
                    {date === today && <button className="btn icon" onClick={() => snooze(open)} aria-label="Напомнить позже" title="Напомнить через 30 минут"><Icon name="snooze" /></button>}
                  </div>
                )}
              </section>
            );
          })}

          {day.data.self_supplements?.length > 0 && (
            <section className="slot">
              <div className="slot-head"><h3>Принимаю самостоятельно</h3><Link to="/scheme#self" className="small">Изменить</Link></div>
              <div className="card tight flat">
                <div className="list">
                  {day.data.self_supplements.map((s: any) => (
                    <div key={s.id} className="list-item" style={{ padding: '10px 0' }}>
                      <Icon name="leaf" className="chev" />
                      <div className="grow"><div className="list-title">{s.name}</div><div className="small muted">{[s.amount, s.schedule].filter(Boolean).join(' · ')}</div></div>
                    </div>
                  ))}
                </div>
                <p className="tiny muted mt-8">Не входит в схему специалиста</p>
              </div>
            </section>
          )}

          {!isFuture && (
            <section className="slot">
              <div className="slot-head"><h3>Как вы себя чувствуете?</h3><span className="subtle">необязательно</span></div>
              <div className="card">
                <WellbeingForm date={date} initial={day.data.wellbeing} onSaved={day.reload} compact />
              </div>
            </section>
          )}
        </>
      )}

      {skipFor && (
        <Sheet title={skipFor.length > 1 ? `Пропустить ${skipFor.length} позиции` : `Пропустить: ${skipFor[0].name}`} onClose={() => setSkipFor(null)}>
          <SkipForm onSubmit={(reason) => { const l = skipFor; setSkipFor(null); mark(l, 'skipped', { reason }); }} />
        </Sheet>
      )}
      {lateFor && (
        <Sheet title="Когда вы приняли?" onClose={() => setLateFor(null)}>
          <LateForm date={date} defaultTime={lateFor[0].time_local} onSubmit={(iso) => { const l = lateFor; setLateFor(null); mark(l, 'taken', { taken_at: iso }); }} />
        </Sheet>
      )}
      {editFor && (
        <Sheet title={editFor.name} onClose={() => setEditFor(null)}>
          <EditMark i={editFor} onChange={(status, extra) => { const x = editFor; setEditFor(null); if (status === 'skipped') setSkipFor([x]); else if (status === 'taken' && extra?.late) setLateFor([x]); else mark([x], status); }} />
        </Sheet>
      )}
    </div>
  );
}

function IntakeCard({ i, selected, onToggle, onEdit, canMark }: { i: Intake; selected: boolean; onToggle: () => void; onEdit: () => void; canMark: boolean }) {
  const tz = useAuth().me!.timezone;
  const open = i.state === 'planned' || i.state === 'unmarked';
  const parts = [amountLabel(i.amount, i.amount_unit), FOOD_LABELS[i.food]].filter(Boolean);
  return (
    <div className={`intake is-${i.state}`}>
      {open && canMark ? (
        <button className="tick" role="checkbox" aria-checked={selected} onClick={onToggle} aria-label={`Выбрать ${i.name}`}><Icon name="check" /></button>
      ) : (
        <span className="tick" aria-hidden="true">{i.state === 'taken' ? <Icon name="check" /> : i.state === 'skipped' ? <Icon name="x" /> : null}</span>
      )}
      <div className="grow">
        <div className="row between top">
          <div className="grow">
            <div className="intake-name">{i.name}</div>
            {i.product && <div className="small muted">{i.product}</div>}
          </div>
          {!open && i.state !== 'cancelled' && <button className="btn ghost small" onClick={onEdit}>Изменить</button>}
          {i.state === 'cancelled' && <StateBadge state="cancelled" />}
        </div>
        <div className="intake-dose">{parts.join(' · ')}</div>
        {i.substance_amount != null && <div className="small muted">{amountLabel(i.substance_amount, i.substance_unit ?? '')} действующего вещества</div>}
        {i.instruction && <div className="intake-note">{i.instruction}</div>}
        <div className="row wrap mt-8" style={{ '--gap': '6px' } as any}>
          {i.state === 'unmarked' && <StateBadge state="unmarked" />}
          {i.state === 'taken' && i.taken_at && <span className="tiny muted">Принято в {fmtTime(i.taken_at, tz)}</span>}
          {i.state === 'skipped' && <span className="tiny muted">Пропуск{i.reason ? `: ${SKIP_REASONS[i.reason]?.toLowerCase()}` : ''}</span>}
          {i.snooze_until && open && <span className="tiny muted">Напомним в {fmtTime(i.snooze_until, tz)}</span>}
        </div>
      </div>
    </div>
  );
}

function SkipForm({ onSubmit }: { onSubmit: (reason?: string) => void }) {
  const [reason, setReason] = useState<string | undefined>();
  return (
    <div className="stack">
      <p className="muted small">Причину указывать необязательно, но специалисту так проще понять, что происходит</p>
      <div className="chips">
        {Object.entries(SKIP_REASONS).map(([k, v]) => <button key={k} type="button" className="chip" aria-pressed={reason === k} onClick={() => setReason(reason === k ? undefined : k)}>{v}</button>)}
      </div>
      <button className="btn primary block mt-8" onClick={() => onSubmit(reason)}>Отметить пропуск</button>
    </div>
  );
}

function LateForm({ date, defaultTime, onSubmit }: { date: string; defaultTime: string; onSubmit: (iso: string) => void }) {
  const [time, setTime] = useState(defaultTime);
  return (
    <div className="stack">
      <p className="muted small">Запись задним числом: сохраним и время приёма, и время, когда вы его отметили</p>
      <div className="field">
        <label htmlFor="late-time">Время приёма, {fmtDate(date)}</label>
        <input id="late-time" type="time" className="input" value={time} onChange={(e) => setTime(e.target.value)} />
      </div>
      <button className="btn primary block" onClick={() => onSubmit(new Date(`${date}T${time}`).toISOString())}>Сохранить</button>
    </div>
  );
}

function EditMark({ i, onChange }: { i: Intake; onChange: (s: 'taken' | 'skipped' | null, extra?: { late?: boolean }) => void }) {
  const tz = useAuth().me!.timezone;
  const [hist, setHist] = useState<any[] | null>(null);
  useEffect(() => { api.get(`/clients/me/intakes/${i.id}/history`).then(setHist, () => setHist([])); }, [i.id]);
  return (
    <div className="stack">
      <div className="row"><StateBadge state={i.state} /><span className="small muted">{amountLabel(i.amount, i.amount_unit)} · {i.time_local}</span></div>
      {i.state === 'taken' && <button className="btn block" onClick={() => onChange('taken', { late: true })}>Изменить время приёма</button>}
      {i.state !== 'skipped' && <button className="btn block" onClick={() => onChange('skipped')}>Отметить как пропуск</button>}
      {i.state !== 'taken' && <button className="btn block" onClick={() => onChange('taken')}>Отметить как принято</button>}
      <button className="btn ghost block" onClick={() => onChange(null)}>Снять отметку</button>
      {hist && hist.length > 0 && (
        <div className="mt-8">
          <div className="label">История изменений</div>
          <ul className="small muted" style={{ paddingLeft: 18, margin: '6px 0 0' }}>
            {hist.map((h, k) => (
              <li key={k}>{fmtDateTime(h.recorded_at, tz)}: {h.status === 'taken' ? 'принято' : h.status === 'skipped' ? 'пропуск' : 'отметка снята'}</li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}
