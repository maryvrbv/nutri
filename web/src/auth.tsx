import { createContext, useContext, useEffect, useState, type FormEvent, type ReactNode } from 'react';
import { Link, useLocation, useNavigate } from 'react-router-dom';
import { api, ApiError, type Me } from './api';
import { Field, Icon, Notice } from './ui';
import { setUserTimezone } from './format';

type Ctx = { me: Me | null; setMe: (m: Me | null) => void; refresh: () => Promise<void> };
const AuthCtx = createContext<Ctx>({ me: null, setMe: () => {}, refresh: async () => {} });
export const useAuth = () => useContext(AuthCtx);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [me, setMe] = useState<Me | null | undefined>(undefined);
  const refresh = async () => {
    try { setMe(await api.get<Me>('/me')); } catch { setMe(null); }
  };
  useEffect(() => {
    refresh();
    const onUnauth = () => setMe(null);
    window.addEventListener('nutri:unauthorized', onUnauth);
    return () => window.removeEventListener('nutri:unauthorized', onUnauth);
  }, []);
  setUserTimezone(me?.timezone);
  if (me === undefined) return <div className="auth"><div className="spinner" aria-label="Загрузка" /></div>;
  return <AuthCtx.Provider value={{ me, setMe, refresh }}>{children}</AuthCtx.Provider>;
}

function Brand() {
  return (
    <div className="brand" style={{ padding: '0 0 20px' }}>
      <span className="brand-mark"><Icon name="leaf" size={18} /></span> Нутри
    </div>
  );
}

export function LoginPage() {
  const { setMe } = useAuth();
  const nav = useNavigate();
  const loc = useLocation();
  const next = new URLSearchParams(loc.search).get('next') || '/';
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [err, setErr] = useState('');
  const [busy, setBusy] = useState(false);
  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setBusy(true); setErr('');
    try {
      setMe(await api.post<Me>('/auth/login', { email, password }));
      nav(next, { replace: true });
    } catch (e) { setErr(e instanceof ApiError ? e.message : 'Не получилось войти'); } finally { setBusy(false); }
  };
  return (
    <div className="auth">
      <div className="auth-card">
        <Brand />
        <div className="card">
          <h1>Вход</h1>
          <p className="muted">Ваш план приёма, анализы и дневник — в&nbsp;одном месте</p>
          <form className="stack mt-24" onSubmit={submit} noValidate>
            <Field label="Почта" htmlFor="email"><input id="email" className="input" type="email" autoComplete="email" inputMode="email" value={email} onChange={(e) => setEmail(e.target.value)} required /></Field>
            <Field label="Пароль" htmlFor="pw"><input id="pw" className="input" type="password" autoComplete="current-password" value={password} onChange={(e) => setPassword(e.target.value)} required /></Field>
            {err && <Notice kind="danger">{err}</Notice>}
            <button className="btn primary block" disabled={busy}>{busy ? 'Входим…' : 'Войти'}</button>
          </form>
        </div>
        <p className="muted small mt-16" style={{ textAlign: 'center' }}>Нет аккаунта? <Link to={`/register${loc.search}`}>Зарегистрироваться</Link></p>
      </div>
    </div>
  );
}

const TIMEZONES = ['Europe/Kaliningrad', 'Europe/Moscow', 'Europe/Samara', 'Asia/Yekaterinburg', 'Asia/Omsk', 'Asia/Novosibirsk', 'Asia/Krasnoyarsk', 'Asia/Irkutsk', 'Asia/Yakutsk', 'Asia/Vladivostok', 'Asia/Magadan', 'Asia/Kamchatka', 'Asia/Dubai', 'Asia/Tbilisi', 'Asia/Yerevan', 'Asia/Almaty', 'Asia/Tashkent', 'Europe/Minsk', 'Europe/Istanbul', 'Europe/Belgrade', 'Europe/Berlin', 'Europe/London', 'Asia/Bangkok', 'America/New_York'];
export function timezoneOptions() {
  const local = Intl.DateTimeFormat().resolvedOptions().timeZone;
  return [...new Set([local, ...TIMEZONES])].filter(Boolean);
}

export function RegisterPage() {
  const { setMe } = useAuth();
  const nav = useNavigate();
  const loc = useLocation();
  const params = new URLSearchParams(loc.search);
  const next = params.get('next') || '/';
  const fromInvite = next.startsWith('/invite/');
  const [role, setRole] = useState<'client' | 'specialist'>(fromInvite ? 'client' : (params.get('role') as any) || 'client');
  const [f, setF] = useState({ name: '', email: '', password: '', title: '', timezone: Intl.DateTimeFormat().resolvedOptions().timeZone || 'Europe/Moscow' });
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [err, setErr] = useState('');
  const [busy, setBusy] = useState(false);
  const set = (k: keyof typeof f) => (e: { target: { value: string } }) => setF({ ...f, [k]: e.target.value });
  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setBusy(true); setErr(''); setErrors({});
    try {
      setMe(await api.post<Me>('/auth/register', { ...f, role }));
      nav(next, { replace: true });
    } catch (e) {
      if (e instanceof ApiError && e.data?.fields) setErrors(e.data.fields);
      else setErr(e instanceof ApiError ? e.message : 'Не получилось зарегистрироваться');
    } finally { setBusy(false); }
  };
  return (
    <div className="auth">
      <div className="auth-card">
        <Brand />
        <div className="card">
          <h1>Регистрация</h1>
          {fromInvite && <p className="muted">После регистрации вернём вас к&nbsp;приглашению специалиста</p>}
          <form className="stack mt-24" onSubmit={submit} noValidate>
            {!fromInvite && (
              <div className="role-pick" role="group" aria-label="Кто вы">
                <button type="button" aria-pressed={role === 'client'} onClick={() => setRole('client')}><b>Клиент</b><span>Веду план приёма и&nbsp;дневник</span></button>
                <button type="button" aria-pressed={role === 'specialist'} onClick={() => setRole('specialist')}><b>Специалист</b><span>Сопровождаю клиентов</span></button>
              </div>
            )}
            <Field label="Как к вам обращаться" htmlFor="name" error={errors.name}><input id="name" className="input" autoComplete="name" value={f.name} onChange={set('name')} aria-invalid={!!errors.name} /></Field>
            {role === 'specialist' && <Field label="Специализация" htmlFor="title" hint="Её увидят клиенты в приглашении"><input id="title" className="input" placeholder="Например, нутрициолог" value={f.title} onChange={set('title')} /></Field>}
            <Field label="Почта" htmlFor="email" error={errors.email}><input id="email" className="input" type="email" autoComplete="email" inputMode="email" value={f.email} onChange={set('email')} aria-invalid={!!errors.email} /></Field>
            <Field label="Пароль" htmlFor="pw" error={errors.password} hint="Не короче 8 символов"><input id="pw" className="input" type="password" autoComplete="new-password" value={f.password} onChange={set('password')} aria-invalid={!!errors.password} /></Field>
            <Field label="Часовой пояс" htmlFor="tz" hint="По нему считаем время приёма и напоминаний">
              <select id="tz" className="select" value={f.timezone} onChange={set('timezone')}>
                {timezoneOptions().map((t) => <option key={t} value={t}>{t.replace('_', ' ')}</option>)}
              </select>
            </Field>
            {err && <Notice kind="danger">{err}</Notice>}
            <button className="btn primary block" disabled={busy}>{busy ? 'Создаём аккаунт…' : 'Создать аккаунт'}</button>
            <p className="subtle">Сервис помогает вести план, который составил специалист. Он не ставит диагнозы и не заменяет консультацию врача.</p>
          </form>
        </div>
        <p className="muted small mt-16" style={{ textAlign: 'center' }}>Уже есть аккаунт? <Link to={`/login${loc.search}`}>Войти</Link></p>
      </div>
    </div>
  );
}
