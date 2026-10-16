import { useEffect, useState } from 'react';
import { Link, NavLink, Outlet, useLocation, useParams } from 'react-router-dom';
import { api } from '../api';
import { useAuth } from '../auth';
import { fmtDate, fmtDateTime, fmtRelative, initials, plural, SYMPTOMS, ty } from '../format';
import { NotificationsList, useNotifications } from '../notifications';
import { IntakeHistory, StatsBlock } from '../shared/IntakeHistory';
import { AnalytePage, Comments, DocumentReview, LabsOverview, PositionBadge, UploadForm } from '../shared/Labs';
import { Timeline } from '../shared/Timeline';
import { Empty, Field, Icon, Loader, Notice, SchemeBadge, Seg, errorText, useData, useToast } from '../ui';

export function SpecLayout() {
  const { me } = useAuth();
  const { unread } = useNotifications();
  const nav = [
    { to: '/clients', icon: 'users', label: 'Клиенты' },
    { to: '/invites', icon: 'link', label: 'Приглашения' },
    { to: '/notifications', icon: 'bell', label: 'Уведомления', count: unread },
    { to: '/settings', icon: 'settings', label: 'Настройки' },
  ];
  return (
    <div className="app-spec">
      <a href="#main" className="sr-only">К содержимому</a>
      <aside className="side">
        <Link to="/clients" className="brand"><span className="brand-mark"><Icon name="leaf" size={18} /></span>Нутри</Link>
        <nav aria-label="Разделы" className="stack" style={{ '--gap': '2px' } as any}>
          {nav.map((n) => (
            <NavLink key={n.to} to={n.to} className={({ isActive }) => `nav ${isActive ? 'active' : ''}`}>
              <Icon name={n.icon} />{n.label}{!!n.count && <span className="count">{n.count}</span>}
            </NavLink>
          ))}
        </nav>
        <div className="side-foot"><div className="list-title">{me!.name}</div><div className="subtle">{me!.title || 'Специалист'}</div></div>
      </aside>
      <header className="topbar">
        <Link to="/clients" className="brand" style={{ padding: 0 }}><span className="brand-mark"><Icon name="leaf" size={18} /></span></Link>
        <nav aria-label="Разделы">
          {nav.map((n) => <NavLink key={n.to} to={n.to} className={({ isActive }) => (isActive ? 'active' : '')}>{n.label}{n.count ? ` (${n.count})` : ''}</NavLink>)}
        </nav>
      </header>
      <main className="main" id="main"><div className="main-inner"><Outlet /></div></main>
    </div>
  );
}

// ---------- Список клиентов ----------

const FILTERS = [
  { value: 'all', label: 'Все' },
  { value: 'active', label: 'Активный курс' },
  { value: 'new_labs', label: 'Новые анализы' },
  { value: 'ending', label: 'Завершение курса' },
  { value: 'inactive', label: 'Нет активности' },
];

export function ClientsPage() {
  const [filter, setFilter] = useState('all');
  const [q, setQ] = useState('');
  const list = useData(() => api.get<any[]>(`/clients?filter=${filter === 'all' ? '' : filter}`), [filter]);
  const shown = (list.data ?? []).filter((c) => c.name.toLowerCase().includes(q.trim().toLowerCase()));
  return (
    <div>
      <div className="page-head" style={{ paddingTop: 0 }}>
        <div><h1>Клиенты</h1><p className="muted">{list.data ? `${list.data.length} ${plural(list.data.length, 'клиент', 'клиента', 'клиентов')} с открытым доступом` : ''}</p></div>
        <Link to="/invites" className="btn primary"><Icon name="plus" />Пригласить</Link>
      </div>
      <div className="filters">
        <div className="search"><Icon name="search" /><input className="input" placeholder="Поиск по имени" value={q} onChange={(e) => setQ(e.target.value)} aria-label="Поиск по имени" /></div>
        <Seg label="Фильтр" value={filter} onChange={setFilter} options={FILTERS} />
      </div>
      {!list.data ? <Loader error={list.error} retry={list.reload} /> : shown.length === 0 ? (
        <div className="card"><Empty icon="users" title={list.data.length ? 'Никого не нашли' : 'Клиентов пока нет'}>{!list.data.length && <>Отправьте клиенту <Link to="/invites">ссылку-приглашение</Link>. Доступ откроется после его подтверждения.</>}</Empty></div>
      ) : (
        <div className="card" style={{ padding: 0 }}>
          <div className="table-wrap" style={{ margin: 0, padding: 0 }}>
            <table className="table">
              <thead><tr><th style={{ paddingLeft: 18 }}>Клиент</th><th>Схема</th><th>Активность</th><th>Сигналы</th><th>Контроль</th></tr></thead>
              <tbody>
                {shown.map((c) => (
                  <tr key={c.id}>
                    <td style={{ paddingLeft: 18 }}>
                      <Link to={`/clients/${c.id}`} className="row" style={{ color: 'inherit' }}><span className="avatar s">{initials(c.name)}</span><span className="list-title">{c.name}</span></Link>
                    </td>
                    <td>{c.active_scheme ? <><span className="badge taken">активна</span>{c.ending_soon && <div className="tiny muted mt-8">заканчивается на этой неделе</div>}</> : <span className="badge">нет активной</span>}</td>
                    <td className="nowrap small">{fmtRelative(c.last_activity)}</td>
                    <td><div className="flags">
                      {c.new_labs > 0 && <span className="badge auto"><Icon name="flask" />анализы: {c.new_labs}</span>}
                      {c.adverse_recent > 0 && <span className="badge danger"><Icon name="alert" />ощущения</span>}
                      {!c.new_labs && !c.adverse_recent && <span className="subtle">—</span>}
                    </div></td>
                    <td className="nowrap small">{c.next_control_date ? fmtDate(c.next_control_date) : '—'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  );
}

// ---------- Приглашения ----------

export function InvitesPage() {
  const list = useData(() => api.get<any[]>('/invitations'), []);
  const [hint, setHint] = useState('');
  const [link, setLink] = useState<string | null>(null);
  const toast = useToast();
  const create = async () => {
    try {
      const r = await api.post('/invitations', { client_hint: hint });
      setLink(`${location.origin}/invite/${r.token}`);
      setHint('');
      list.reload();
    } catch (e) { toast(errorText(e)); }
  };
  const copy = async () => { try { await navigator.clipboard.writeText(link!); toast('Ссылка скопирована'); } catch { toast('Скопируйте ссылку вручную'); } };
  const revoke = async (id: string) => { try { await api.del(`/invitations/${id}`); list.reload(); } catch (e) { toast(errorText(e)); } };
  const state = (i: any) => i.accepted_at ? <span className="badge taken">принято{i.accepted_by_name ? `: ${i.accepted_by_name}` : ''}</span>
    : i.revoked_at ? <span className="badge">отозвано</span>
    : i.expires_at < new Date().toISOString() ? <span className="badge">истекло</span> : <span className="badge planned">ждёт</span>;
  return (
    <div style={{ maxWidth: 760 }}>
      <div className="page-head" style={{ paddingTop: 0 }}><div><h1>Приглашения</h1><p className="muted">{ty('Ссылка действует 7 дней. Доступ к данным откроется только после подтверждения клиентом.')}</p></div></div>
      <div className="card stack">
        <Field label="Для кого" htmlFor="inv-hint" hint="Видно только вам, чтобы не путать ссылки"><input id="inv-hint" className="input" value={hint} onChange={(e) => setHint(e.target.value)} placeholder="Например, Анна, консультация 12 октября" /></Field>
        <button className="btn primary" style={{ alignSelf: 'flex-start' }} onClick={create}><Icon name="link" />Создать ссылку</button>
        {link && (
          <Notice kind="info" icon="link">
            <b>Ссылка готова — отправьте её клиенту</b>
            <div className="row mt-8"><input className="input" readOnly value={link} onFocus={(e) => e.target.select()} aria-label="Ссылка-приглашение" /><button className="btn" onClick={copy}><Icon name="copy" />Копировать</button></div>
            <div className="tiny mt-8">Ссылку показываем один раз. Если потеряете — создайте новую.</div>
          </Notice>
        )}
      </div>
      <h2 className="mt-24" style={{ marginBottom: 10 }}>Отправленные</h2>
      <div className="card">
        {!list.data ? <Loader /> : list.data.length === 0 ? <p className="small muted">Пока не было приглашений</p> : (
          <div className="list">
            {list.data.map((i) => (
              <div key={i.id} className="list-item">
                <div className="grow"><div className="list-title">{i.client_hint || 'Без подписи'}</div><div className="small muted">создано {fmtDateTime(i.created_at)} · до {fmtDate(i.expires_at.slice(0, 10))}</div></div>
                {state(i)}
                {!i.accepted_at && !i.revoked_at && i.expires_at > new Date().toISOString() && <button className="btn ghost small" onClick={() => revoke(i.id)}>Отозвать</button>}
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

// ---------- Карточка клиента ----------

export function ClientCard() {
  const { id = '' } = useParams();
  const profile = useData(() => api.get(`/clients/${id}/profile`), [id]);
  const loc = useLocation();
  const base = `/clients/${id}`;
  const tabs = [
    { to: base, label: 'Сводка', end: true },
    { to: `${base}/labs`, label: 'Анализы' },
    { to: `${base}/schemes`, label: 'Схемы приёма' },
    { to: `${base}/intakes`, label: 'Фактический приём' },
    { to: `${base}/wellbeing`, label: 'Самочувствие' },
    { to: `${base}/events`, label: 'История событий' },
  ];
  if (profile.error) return <Loader error={profile.error} />;
  return (
    <div>
      <Link to="/clients" className="back"><Icon name="left" size={18} />Клиенты</Link>
      <div className="client-head">
        <span className="avatar">{profile.data ? initials(profile.data.name) : ''}</span>
        <div className="grow">
          <h1>{profile.data?.name ?? '…'}</h1>
          <p className="small muted">{profile.data?.timezone} · у клиента {profile.data ? fmtDate(profile.data.today, { weekday: true }) : ''}</p>
        </div>
        {!loc.pathname.includes('/schemes/') && <Link to={`${base}/schemes/new`} className="btn primary"><Icon name="plus" />Новая схема</Link>}
      </div>
      <nav className="tabs" aria-label="Разделы карточки">
        {tabs.map((t) => <NavLink key={t.to} to={t.to} end={t.end} className={({ isActive }) => (isActive ? 'active' : '')}>{t.label}</NavLink>)}
      </nav>
      {profile.data && <Outlet context={profile.data} />}
    </div>
  );
}

export function ClientSummary() {
  const { id = '' } = useParams();
  const [days, setDays] = useState<'7' | '14' | '30'>('14');
  const s = useData(() => api.get(`/clients/${id}/summary?days=${days}`), [id, days]);
  // Отметка о просмотре — после показа, чтобы блок «изменения» успел отрисоваться
  useEffect(() => {
    if (!s.data) return;
    const t = window.setTimeout(() => api.post(`/clients/${id}/viewed`).catch(() => {}), 3000);
    return () => window.clearTimeout(t);
  }, [s.data, id]);
  if (!s.data) return <Loader error={s.error} />;
  const d = s.data;
  return (
    <div className="cols">
      <div className="span-8 stack" style={{ '--gap': '16px' } as any}>
        {d.changes.length > 0 && (
          <div className="card">
            <div className="card-head"><h2>С прошлого просмотра</h2><span className="subtle">{fmtDateTime(d.last_viewed_at)}</span></div>
            <div className="list">
              {d.changes.slice(0, 8).map((e: any, k: number) => (
                <div key={k} className="list-item" style={{ padding: '8px 0' }}><span className="grow small">{e.text}{e.data?.title ? `: «${e.data.title}»` : ''}</span><span className="tiny muted nowrap">{fmtRelative(e.at)}</span></div>
              ))}
            </div>
            {d.changes.length > 8 && <Link className="small" to={`/clients/${id}/events`}>Все события ({d.changes.length})</Link>}
          </div>
        )}
        <div className="card">
          <div className="card-head"><h2>Текущая схема</h2><Link to={`/clients/${id}/schemes`} className="small">Все схемы</Link></div>
          {d.schemes.length === 0 ? <Empty icon="pill" title="Активной схемы нет"><Link to={`/clients/${id}/schemes/new`}>Создать схему</Link></Empty> : (
            <div className="list">
              {d.schemes.map((x: any) => (
                <Link key={x.id} to={`/clients/${id}/schemes/${x.id}`} className="list-item">
                  <div className="grow"><div className="list-title">{x.title}</div><div className="small muted">{fmtDate(x.start_date)} — {fmtDate(x.end_date, { year: true })} · версия {x.version}{x.control_date ? ` · контроль ${fmtDate(x.control_date)}` : ''}</div></div>
                  <SchemeBadge status={x.status} /><Icon name="right" className="chev" />
                </Link>
              ))}
            </div>
          )}
        </div>
        <div className="card">
          <div className="card-head wrap"><h2>Отметки о приёме</h2><Seg label="Период" value={days} onChange={setDays} options={[{ value: '7', label: '7 дней' }, { value: '14', label: '14 дней' }, { value: '30', label: '30 дней' }]} /></div>
          <StatsBlock s={d.adherence} />
        </div>
        <div className="card"><h2 style={{ marginBottom: 12 }}>Общая шкала</h2><Timeline clientId={id} /></div>
      </div>
      <div className="span-4 stack" style={{ '--gap': '16px' } as any}>
        <div className="card">
          <div className="card-head"><h2>Анализы</h2><Link to={`/clients/${id}/labs`} className="small">Все</Link></div>
          {d.latest_results.length === 0 ? <p className="small muted">Подтверждённых результатов пока нет</p> : (
            <div className="list">
              {d.latest_results.map((r: any) => (
                <Link key={r.id} to={`/clients/${id}/labs/analyte/${encodeURIComponent(r.key)}`} className="list-item" style={{ padding: '10px 0' }}>
                  <div className="grow"><div className="list-title small">{r.name}</div><div className="tiny muted">{fmtDate(r.collected_at)}</div></div>
                  <div style={{ textAlign: 'right' }}><b className="num">{r.value_text}</b> <span className="tiny muted">{r.unit}</span><div><PositionBadge r={r} /></div></div>
                </Link>
              ))}
            </div>
          )}
        </div>
        <div className="card">
          <div className="card-head"><h2>Самочувствие</h2><Link to={`/clients/${id}/wellbeing`} className="small">Дневник</Link></div>
          {d.wellbeing.length === 0 ? <p className="small muted">Записей за период нет</p> : (
            <div className="list">
              {d.wellbeing.slice(0, 6).map((w: any) => (
                <div key={w.id} className="list-item" style={{ padding: '10px 0', alignItems: 'flex-start' }}>
                  <div className="grow">
                    <div className="row wrap"><span className="small list-title">{fmtDate(w.date)}</span>{!!w.adverse && <span className="badge danger">нежелательные ощущения</span>}</div>
                    <div className="tiny muted">{[w.energy && `энергия ${w.energy}`, w.sleep && `сон ${w.sleep}`, w.overall && `самочувствие ${w.overall}`].filter(Boolean).join(' · ')}{w.symptoms.length ? ` · ${w.symptoms.map((x: string) => SYMPTOMS[x]?.toLowerCase()).join(', ')}` : ''}</div>
                    {w.comment && <div className="small">{w.comment}</div>}
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
        <SelfSupplementsView clientId={id} />
        <Comments clientId={id} targetType="general" role="specialist" />
      </div>
    </div>
  );
}

function SelfSupplementsView({ clientId }: { clientId: string }) {
  const l = useData(() => api.get<any[]>(`/clients/${clientId}/self-supplements`), [clientId]);
  if (!l.data?.length) return null;
  return (
    <div className="card">
      <h2>Принимает самостоятельно</h2>
      <p className="tiny muted mt-8">Вне ваших схем, со слов клиента</p>
      <div className="list mt-8">{l.data.map((s) => <div key={s.id} className="list-item" style={{ padding: '8px 0' }}><div className="grow"><div className="small list-title">{s.name}</div><div className="tiny muted">{[s.amount, s.schedule].filter(Boolean).join(' · ')}</div></div></div>)}</div>
    </div>
  );
}

export function ClientLabsTab() {
  const { id = '' } = useParams();
  return <LabsOverview clientId={id} base={`/clients/${id}/labs`} />;
}
export function ClientUploadTab() {
  const { id = '' } = useParams();
  return <div style={{ maxWidth: 640 }}><h2 style={{ marginBottom: 12 }}>Добавить анализ клиента</h2><UploadForm clientId={id} base={`/clients/${id}/labs`} /></div>;
}
export function ClientDocTab() {
  const { id = '' } = useParams();
  return <DocumentReview clientId={id} base={`/clients/${id}/labs`} />;
}
export function ClientAnalyteTab() {
  const { id = '' } = useParams();
  return <div style={{ maxWidth: 900 }}><AnalytePage clientId={id} base={`/clients/${id}/labs`} role="specialist" /></div>;
}
export function ClientIntakesTab() {
  const { id = '' } = useParams();
  const p = useData(() => api.get(`/clients/${id}/profile`), [id]);
  return p.data ? <IntakeHistory clientId={id} today={p.data.today} tz={p.data.timezone} /> : <Loader />;
}
export function ClientWellbeingTab() {
  const { id = '' } = useParams();
  const l = useData(() => api.get<any[]>(`/clients/${id}/wellbeing?from=2000-01-01`), [id]);
  return (
    <div className="stack" style={{ '--gap': '16px' } as any}>
      <div className="card"><h2 style={{ marginBottom: 12 }}>Приём, самочувствие и анализы рядом</h2><Timeline clientId={id} /><p className="tiny muted mt-16">{ty('Совпадение по датам не означает, что изменения вызваны конкретной добавкой.')}</p></div>
      <div className="card">
        <h2>Записи дневника</h2>
        {!l.data ? <Loader /> : l.data.length === 0 ? <p className="small muted mt-8">Клиент пока не вёл дневник</p> : (
          <div className="table-wrap mt-8"><table className="table">
            <thead><tr><th>Дата</th><th className="num">Энергия</th><th className="num">Сон</th><th className="num">Самочувствие</th><th>Симптомы</th><th>Комментарий</th></tr></thead>
            <tbody>{l.data.map((w) => (
              <tr key={w.id}>
                <td className="nowrap">{fmtDate(w.date, { year: true })}{w.adverse && <div><span className="badge danger">нежелательные ощущения</span></div>}</td>
                <td className="num">{w.energy ?? '—'}</td><td className="num">{w.sleep ?? '—'}</td><td className="num">{w.overall ?? '—'}</td>
                <td className="small">{w.symptoms.map((x: string) => SYMPTOMS[x]).join(', ') || '—'}</td>
                <td className="small">{w.comment || '—'}</td>
              </tr>
            ))}</tbody>
          </table></div>
        )}
      </div>
    </div>
  );
}
export function ClientEventsTab() {
  const { id = '' } = useParams();
  const l = useData(() => api.get<any[]>(`/clients/${id}/events`), [id]);
  if (!l.data) return <Loader error={l.error} />;
  return (
    <div className="card">
      {l.data.length === 0 ? <Empty title="Событий пока нет" /> : (
        <div className="list">
          {l.data.map((e, k) => (
            <div key={k} className="list-item" style={{ padding: '10px 0', alignItems: 'flex-start' }}>
              <span className="tiny muted nowrap" style={{ width: 130 }}>{fmtDateTime(e.at)}</span>
              <div className="grow"><div className="small">{e.text}{e.data?.title ? `: «${e.data.title}»` : ''}{e.data?.number ? ` (версия ${e.data.number})` : ''}</div><div className="tiny muted">{e.actor_name}</div></div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

export function SpecNotifications() {
  return <div style={{ maxWidth: 760 }}><div className="page-head" style={{ paddingTop: 0 }}><h1>Уведомления</h1></div><NotificationsList /></div>;
}
