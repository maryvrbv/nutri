import { useEffect, useState } from 'react';
import { Link, NavLink, Outlet, useNavigate, useParams } from 'react-router-dom';
import { api, type Me } from '../api';
import { timezoneOptions, useAuth } from '../auth';
import { fmtDate, ty } from '../format';
import { NotificationsList, useNotifications } from '../notifications';
import { AnalytePage, DocumentReview, LabsOverview, UploadForm } from '../shared/Labs';
import { IntakeHistory } from '../shared/IntakeHistory';
import { getTheme, isStandalone, setTheme, type Theme } from '../pwa';
import { Field, Icon, Loader, Notice, Seg, Sheet, errorText, useData, useOnline, useToast } from '../ui';

export function ClientLayout() {
  const { unread } = useNotifications();
  const online = useOnline();
  const hidden = useHideOnScroll();
  const tabs = [
    { to: '/today', icon: 'today', label: 'Сегодня' },
    { to: '/scheme', icon: 'pill', label: 'Схема' },
    { to: '/labs', icon: 'flask', label: 'Анализы' },
    { to: '/diary', icon: 'heart', label: 'Дневник' },
    { to: '/more', icon: 'more', label: 'Ещё', count: unread },
  ];
  return (
    <div className="app-client">
      <a href="#main" className="sr-only">К содержимому</a>
      {!online && <div className="notice warn" style={{ borderRadius: 0 }}><Icon name="alert" />Нет связи. Отметки сохранятся, когда интернет вернётся — попробуйте ещё раз чуть позже.</div>}
      <main id="main"><Outlet /></main>
      <div className={`tabbar ${hidden ? 'hidden' : ''}`}>
        <nav aria-label="Основные разделы">
          {tabs.map((t) => (
            <NavLink key={t.to} to={t.to} className={({ isActive }) => (isActive ? 'active' : '')}>
              <Icon name={t.icon} />
              <span>{t.label}</span>
              {!!t.count && <span className="count" aria-label={`${t.count} новых`}>{t.count > 9 ? '9+' : t.count}</span>}
            </NavLink>
          ))}
        </nav>
      </div>
    </div>
  );
}

/** Панель уходит, когда листаешь вниз, и возвращается при движении вверх или у края страницы. */
function useHideOnScroll() {
  const [hidden, setHidden] = useState(false);
  useEffect(() => {
    let last = window.scrollY;
    const onScroll = () => {
      const y = window.scrollY;
      const nearBottom = window.innerHeight + y >= document.documentElement.scrollHeight - 40;
      if (y < 40 || nearBottom) setHidden(false);
      else if (y > last + 6) setHidden(true);
      else if (y < last - 6) setHidden(false);
      last = y;
    };
    window.addEventListener('scroll', onScroll, { passive: true });
    return () => window.removeEventListener('scroll', onScroll);
  }, []);
  return hidden;
}

export function ClientLabs() {
  return (
    <div className="page">
      <div className="page-head">
        <div><div className="eyebrow">Результаты и документы</div><h1>Анализы</h1></div>
        <Link to="/labs/upload" className="btn primary icon" aria-label="Добавить анализ"><Icon name="plus" /></Link>
      </div>
      <LabsOverview clientId="me" base="/labs" />
    </div>
  );
}
export function ClientUpload() {
  return (
    <div className="page">
      <Link to="/labs" className="back"><Icon name="left" size={18} />Анализы</Link>
      <div className="page-head"><h1>Добавить анализ</h1></div>
      <UploadForm clientId="me" base="/labs" />
    </div>
  );
}
export function ClientDocument() {
  return (
    <div className="page" style={{ maxWidth: 1200 }}>
      <Link to="/labs" className="back"><Icon name="left" size={18} />Анализы</Link>
      <DocumentReview clientId="me" base="/labs" />
    </div>
  );
}
export function ClientAnalyte() {
  return (
    <div className="page">
      <Link to="/labs" className="back"><Icon name="left" size={18} />Анализы</Link>
      <AnalytePage clientId="me" base="/labs" role="client" />
    </div>
  );
}
/** Ссылка из уведомления на конкретный результат ведёт к динамике показателя. */
export function ResultRedirect({ base }: { base: string }) {
  const { id = '' } = useParams();
  const nav = useNavigate();
  const r = useData(() => api.get(`/results/${id}`).then((x) => { nav(`${base}/analyte/${encodeURIComponent(x.analyte_code ?? `name:${x.name.toLowerCase()}`)}`, { replace: true }); return x; }), [id]);
  return <div className="page"><Loader error={r.error} /></div>;
}

export function ClientHistory() {
  const { me } = useAuth();
  return (
    <div className="page">
      <Link to="/more" className="back"><Icon name="left" size={18} />Ещё</Link>
      <div className="page-head"><h1>История приёма</h1></div>
      <IntakeHistory clientId="me" today={me!.today} tz={me!.timezone} />
    </div>
  );
}

export function NotificationsPage({ back }: { back?: string }) {
  return (
    <div className="page">
      {back && <Link to={back} className="back"><Icon name="left" size={18} />Назад</Link>}
      <div className="page-head"><h1>Уведомления</h1></div>
      <NotificationsList />
    </div>
  );
}

export function MorePage() {
  const { me } = useAuth();
  const { unread } = useNotifications();
  const access = useData(() => api.get('/me/access'), []);
  const links = [
    { to: '/notifications', icon: 'bell', label: 'Уведомления', extra: unread ? <span className="badge danger">{unread}</span> : null },
    { to: '/history', icon: 'history', label: 'История приёма' },
    { to: '/settings', icon: 'settings', label: 'Настройки и уведомления' },
    { to: '/settings/access', icon: 'shield', label: 'Доступ к данным' },
    ...(isStandalone() ? [] : [{ to: '/install', icon: 'download', label: 'Установить приложение' }]),
  ];
  return (
    <div className="page">
      <div className="page-head"><div><div className="eyebrow">{me!.email}</div><h1>{me!.name}</h1></div></div>
      {access.data && (
        <div className="card" style={{ marginBottom: 16 }}>
          {access.data.active ? (
            <div className="row">
              <span className="avatar s"><Icon name="user" size={18} /></span>
              <div className="grow"><div className="small muted">Вас сопровождает</div><div className="list-title">{access.data.active.specialist_name}</div></div>
              <Link to="/settings/access" className="btn small ghost">Доступ</Link>
            </div>
          ) : <p className="small muted">{ty('Специалист пока не подключён. Попросите у него ссылку-приглашение.')}</p>}
        </div>
      )}
      <div className="card"><div className="list">
        {links.map((l) => (
          <Link key={l.to} to={l.to} className="list-item"><Icon name={l.icon} className="chev" /><span className="grow list-title">{l.label}</span>{l.extra}<Icon name="right" className="chev" /></Link>
        ))}
      </div></div>
      <p className="subtle mt-24">{ty('Нутри помогает вести план, который составил специалист. Сервис не ставит диагнозы, не назначает лечение и не предназначен для экстренной помощи. Если состояние резко ухудшилось — звоните 103 или 112.')}</p>
    </div>
  );
}

export function SettingsPage() {
  const { me, setMe } = useAuth();
  const toast = useToast();
  const [f, setF] = useState({ name: me!.name, timezone: me!.timezone, title: me!.title ?? '', sex: me!.sex ?? '', birth_date: me!.birth_date ?? '', ...me!.settings, quiet_from: me!.settings.quiet_from ?? '', quiet_to: me!.settings.quiet_to ?? '' });
  const [busy, setBusy] = useState(false);
  const [del, setDel] = useState(false);
  const [theme, setThemeState] = useState<Theme>(getTheme);
  const save = async () => {
    setBusy(true);
    try {
      const { name, timezone, title, sex, birth_date, ...settings } = f;
      if (settings.channel_browser && 'Notification' in window && Notification.permission === 'default') await Notification.requestPermission();
      setMe(await api.patch<Me>('/me', { name, timezone, ...(me!.role === 'specialist' ? { title } : { sex, birth_date }), settings }));
      toast('Сохранено');
    } catch (e) { toast(errorText(e)); } finally { setBusy(false); }
  };
  const logout = async () => { await api.post('/auth/logout'); setMe(null); };
  const browserBlocked = 'Notification' in window && Notification.permission === 'denied';
  return (
    <div className={me!.role === 'client' ? 'page' : ''} style={me!.role === 'specialist' ? { maxWidth: 640 } : undefined}>
      {me!.role === 'client' && <Link to="/more" className="back"><Icon name="left" size={18} />Ещё</Link>}
      <div className="page-head"><h1>Настройки</h1></div>
      <div className="stack" style={{ '--gap': '16px' } as any}>
        <div className="card stack">
          <h2>Профиль</h2>
          <Field label="Имя" htmlFor="s-name"><input id="s-name" className="input" value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} /></Field>
          {me!.role === 'specialist' && <Field label="Специализация" htmlFor="s-title"><input id="s-title" className="input" value={f.title} onChange={(e) => setF({ ...f, title: e.target.value })} /></Field>}
          {me!.role === 'client' && (
            <div className="grid-2">
              <Field label="Пол" htmlFor="s-sex" hint="Нужен для справочных интервалов">
                <select id="s-sex" className="select" value={f.sex} onChange={(e) => setF({ ...f, sex: e.target.value as any })}>
                  <option value="">Не указан</option><option value="female">Женский</option><option value="male">Мужской</option>
                </select>
              </Field>
              <Field label="Дата рождения" htmlFor="s-birth"><input id="s-birth" type="date" className="input" value={f.birth_date} onChange={(e) => setF({ ...f, birth_date: e.target.value })} /></Field>
            </div>
          )}
          <Field label="Часовой пояс" htmlFor="s-tz" hint={me!.role === 'client' ? 'При смене пояса время приёмов по местным часам сохранится' : undefined}>
            <select id="s-tz" className="select" value={f.timezone} onChange={(e) => setF({ ...f, timezone: e.target.value })}>
              {[...new Set([f.timezone, ...timezoneOptions()])].map((t) => <option key={t} value={t}>{t.replace('_', ' ')}</option>)}
            </select>
          </Field>
        </div>
        <div className="card stack">
          <h2>Оформление</h2>
          <Seg label="Тема" value={theme} onChange={(t) => { setTheme(t); setThemeState(t); }} options={[{ value: 'clay', label: 'Clay' }, { value: 'pastel', label: 'Пастель' }]} />
          <p className="hint subtle">Сохраняется на этом устройстве</p>
        </div>
        <div className="card stack">
          <h2>Уведомления</h2>
          {me!.role === 'client' && <label className="check"><input type="checkbox" checked={f.intake_reminders} onChange={(e) => setF({ ...f, intake_reminders: e.target.checked })} /><span>Напоминать о приёме<br /><span className="subtle">В запланированное время, если приём ещё не отмечен</span></span></label>}
          <label className="check"><input type="checkbox" checked={f.channel_inapp} disabled onChange={() => {}} /><span>В приложении<br /><span className="subtle">Всегда включено</span></span></label>
          <label className="check"><input type="checkbox" checked={f.channel_browser} onChange={(e) => setF({ ...f, channel_browser: e.target.checked })} disabled={browserBlocked} /><span>Уведомления браузера<br /><span className="subtle">{browserBlocked ? 'Запрещены в настройках браузера' : 'Пока вкладка открыта'}</span></span></label>
          <label className="check"><input type="checkbox" checked={f.hide_sensitive} onChange={(e) => setF({ ...f, hide_sensitive: e.target.checked })} /><span>Скрывать подробности на экране блокировки<br /><span className="subtle">Вместо названий добавок и результатов — «Пора отметить приём»</span></span></label>
          <div>
            <div className="label">Тихие часы</div>
            <div className="row mt-8">
              <input type="time" className="input" style={{ width: 130 }} value={f.quiet_from} onChange={(e) => setF({ ...f, quiet_from: e.target.value })} aria-label="Начало тихих часов" />
              <span>—</span>
              <input type="time" className="input" style={{ width: 130 }} value={f.quiet_to} onChange={(e) => setF({ ...f, quiet_to: e.target.value })} aria-label="Конец тихих часов" />
            </div>
            <p className="hint subtle mt-8">Напоминания в это время придут, когда тихие часы закончатся</p>
          </div>
        </div>
        <button className="btn primary block" onClick={save} disabled={busy}>{busy ? 'Сохраняем…' : 'Сохранить'}</button>
        <div className="card stack">
          <h2>Мои данные</h2>
          {!isStandalone() && <Link className="btn outline block" to="/install"><Icon name="download" />Установить как приложение</Link>}
          <a className="btn outline block" href="/api/me/export" download><Icon name="download" />Скачать все данные (JSON)</a>
          <button className="btn ghost block" onClick={logout}><Icon name="logout" />Выйти</button>
          <button className="btn danger block" onClick={() => setDel(true)}><Icon name="trash" />Удалить аккаунт и данные</button>
        </div>
      </div>
      {del && <Sheet title="Удалить аккаунт?" onClose={() => setDel(false)}><DeleteAccount /></Sheet>}
    </div>
  );
}

function DeleteAccount() {
  const { setMe } = useAuth();
  const [pw, setPw] = useState('');
  const [err, setErr] = useState('');
  const go = async () => {
    try { await api.post('/me/delete', { password: pw }); setMe(null); } catch (e) { setErr(errorText(e)); }
  };
  return (
    <div className="stack">
      <p>{ty('Удалим профиль, анализы, файлы, схемы, отметки и дневник. Восстановить их будет нельзя. Перед удалением можно скачать данные.')}</p>
      <Field label="Пароль для подтверждения" htmlFor="del-pw" error={err}><input id="del-pw" type="password" className="input" value={pw} onChange={(e) => setPw(e.target.value)} autoComplete="current-password" /></Field>
      <button className="btn danger block" disabled={!pw} onClick={go}>Удалить навсегда</button>
    </div>
  );
}

export function AccessPage() {
  const a = useData(() => api.get('/me/access'), []);
  const toast = useToast();
  const [confirm, setConfirm] = useState(false);
  const revoke = async () => {
    try { a.setData(await api.del('/me/access')); setConfirm(false); toast('Доступ закрыт'); } catch (e) { toast(errorText(e)); }
  };
  return (
    <div className="page">
      <Link to="/more" className="back"><Icon name="left" size={18} />Ещё</Link>
      <div className="page-head"><h1>Доступ к данным</h1></div>
      {!a.data ? <Loader error={a.error} /> : (
        <div className="stack" style={{ '--gap': '16px' } as any}>
          {a.data.active ? (
            <div className="card stack">
              <div className="row"><span className="avatar"><Icon name="user" /></span><div><h2>{a.data.active.specialist_name}</h2>{a.data.active.specialist_title && <p className="small muted">{a.data.active.specialist_title}</p>}</div></div>
              <p className="small muted">Доступ открыт {fmtDate(a.data.active.consented_at.slice(0, 10), { year: true })}. Специалист видит:</p>
              <ul className="small" style={{ margin: 0, paddingLeft: 18 }}>{a.data.active.scopes.map((s: any) => <li key={s.key}>{s.label}</li>)}</ul>
              <button className="btn danger block" onClick={() => setConfirm(true)}>Закрыть доступ</button>
            </div>
          ) : (
            <div className="card"><Notice kind="plain" icon="lock">{ty('Сейчас ни у кого нет доступа к вашим данным. Чтобы подключить специалиста, откройте его ссылку-приглашение.')}</Notice></div>
          )}
          {a.data.history.length > 0 && (
            <div className="card">
              <h3>История доступа</h3>
              <div className="list mt-8">
                {a.data.history.map((h: any, k: number) => (
                  <div key={k} className="list-item"><div className="grow"><div className="list-title">{h.specialist_name ?? 'Специалист удалил аккаунт'}</div><div className="small muted">с {fmtDate(h.consented_at.slice(0, 10), { year: true })}{h.revoked_at ? ` по ${fmtDate(h.revoked_at.slice(0, 10), { year: true })}` : ' · сейчас'}</div></div></div>
                ))}
              </div>
            </div>
          )}
        </div>
      )}
      {confirm && (
        <Sheet title="Закрыть доступ?" onClose={() => setConfirm(false)}>
          <div className="stack">
            <p>{ty(`${a.data?.active?.specialist_name} перестанет видеть ваши анализы, схемы, отметки и дневник. Ваш кабинет и вся история останутся у вас.`)}</p>
            <button className="btn danger block" onClick={revoke}>Закрыть доступ</button>
            <button className="btn block" onClick={() => setConfirm(false)}>Отмена</button>
          </div>
        </Sheet>
      )}
    </div>
  );
}
