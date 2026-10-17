import { useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { api, ApiError } from './api';
import { useAuth } from './auth';
import { fmtDate } from './format';
import { Icon, Loader, Notice, errorText, useData } from './ui';

export function InvitePage() {
  const { token = '' } = useParams();
  const { me, refresh } = useAuth();
  const nav = useNavigate();
  const inv = useData(() => api.get(`/invite/${token}`), [token]);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');
  const [replace, setReplace] = useState<string | null>(null);

  const accept = async (rep = false) => {
    setBusy(true); setErr('');
    try {
      await api.post(`/invite/${token}/accept`, { replace: rep });
      await refresh();
      nav('/today?connected=1', { replace: true });
    } catch (e) {
      if (e instanceof ApiError && e.code === 'has_specialist') setReplace(e.data.current_specialist);
      else setErr(errorText(e));
    } finally { setBusy(false); }
  };

  const next = encodeURIComponent(`/invite/${token}`);
  return (
    <div className="auth">
      <div className="auth-card">
        <div className="brand" style={{ padding: '0 0 20px' }}><span className="brand-mark"><Icon name="leaf" size={18} /></span> Нутри</div>
        <div className="card">
          {!inv.data ? <Loader error={inv.error} /> : inv.data.state !== 'valid' ? (
            <div className="stack">
              <h1>Приглашение недействительно</h1>
              <p className="muted">{inv.data.state === 'expired' ? 'Срок действия ссылки истёк.' : 'Ссылка уже использована или отозвана.'} Попросите специалиста прислать новую.</p>
              {me && <Link className="btn block" to="/">На главную</Link>}
            </div>
          ) : (
            <div className="stack" style={{ '--gap': '16px' } as any}>
              <div>
                <p className="muted small">Приглашение в сопровождение</p>
                <h1 style={{ marginTop: 4 }}>{inv.data.specialist_name}</h1>
                {inv.data.specialist_title && <p className="muted">{inv.data.specialist_title}</p>}
              </div>
              <div>
                <h3>После подтверждения специалист увидит</h3>
                <ul className="stack mt-8" style={{ '--gap': '8px', listStyle: 'none', padding: 0, margin: '10px 0 0' } as any}>
                  {inv.data.scopes.map((s: any) => (
                    <li key={s.key} className="row top small"><Icon name="check" size={18} className="chev" /><span>{s.label}</span></li>
                  ))}
                </ul>
              </div>
              <Notice kind="plain" icon="lock">Доступ можно закрыть в любой момент в настройках. Ваши данные и история останутся у вас.</Notice>
              {!me && (
                <>
                  <Link className="btn primary block" to={`/register?next=${next}`}>Создать аккаунт и подключиться</Link>
                  <Link className="btn block" to={`/login?next=${next}`}>У меня уже есть аккаунт</Link>
                </>
              )}
              {me && me.role === 'specialist' && <Notice kind="warn">Вы вошли как специалист. Чтобы принять приглашение, войдите в аккаунт клиента.</Notice>}
              {me && me.role === 'client' && !replace && (
                <button className="btn primary block" disabled={busy} onClick={() => accept(false)}>{busy ? 'Подключаем…' : 'Открыть доступ'}</button>
              )}
              {replace && (
                <div className="stack">
                  <Notice kind="warn">Сейчас вас сопровождает {replace}. Если подключиться к новому специалисту, у {replace} закроется доступ к вашим данным. Ваша история сохранится.</Notice>
                  <button className="btn primary block" disabled={busy} onClick={() => accept(true)}>Сменить специалиста</button>
                  <button className="btn block" onClick={() => nav('/')}>Оставить как есть</button>
                </div>
              )}
              {err && <Notice kind="danger">{err}</Notice>}
              <p className="subtle">Ссылка действует до {fmtDate(inv.data.expires_at, { year: true })}</p>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

/** Ссылка от клиента для специалиста: регистрация специалиста и подключение к клиенту. */
export function JoinPage() {
  const { token = '' } = useParams();
  const { me } = useAuth();
  const nav = useNavigate();
  const inv = useData(() => api.get(`/join/${token}`), [token]);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');
  const accept = async () => {
    setBusy(true); setErr('');
    try {
      const r = await api.post<{ client_id: string }>(`/join/${token}/accept`, {});
      nav(`/clients/${r.client_id}`, { replace: true });
    } catch (e) { setErr(errorText(e)); } finally { setBusy(false); }
  };
  const next = encodeURIComponent(`/join/${token}`);
  return (
    <div className="auth">
      <div className="auth-card">
        <div className="brand" style={{ padding: '0 0 20px' }}><span className="brand-mark"><Icon name="leaf" size={18} /></span> Нутри</div>
        <div className="card">
          {!inv.data ? <Loader error={inv.error} /> : inv.data.state !== 'valid' ? (
            <div className="stack">
              <h1>Ссылка недействительна</h1>
              <p className="muted">{inv.data.state === 'expired' ? 'Срок действия ссылки истёк.' : 'Ссылка уже использована или отозвана.'} Попросите клиента прислать новую.</p>
              {me && <Link className="btn block" to="/">На главную</Link>}
            </div>
          ) : (
            <div className="stack" style={{ '--gap': '16px' } as any}>
              <div>
                <p className="muted small">Приглашение для специалиста</p>
                <h1 style={{ marginTop: 4 }}>{inv.data.client_name}</h1>
                <p className="muted">приглашает вас вести сопровождение</p>
              </div>
              <div>
                <h3>Вы увидите</h3>
                <ul className="stack mt-8" style={{ '--gap': '8px', listStyle: 'none', padding: 0, margin: '10px 0 0' } as any}>
                  {inv.data.scopes.map((s: any) => (
                    <li key={s.key} className="row top small"><Icon name="check" size={18} className="chev" /><span>{s.label}</span></li>
                  ))}
                </ul>
              </div>
              {!me && (
                <>
                  <Link className="btn primary block" to={`/register?next=${next}`}>Создать аккаунт специалиста</Link>
                  <Link className="btn block" to={`/login?next=${next}`}>У меня уже есть аккаунт</Link>
                </>
              )}
              {me && me.role === 'client' && <Notice kind="warn">Вы вошли как клиент. Эта ссылка для специалиста: выйдите и создайте аккаунт специалиста с другой почтой.</Notice>}
              {me && me.role === 'specialist' && (
                <button className="btn primary block" disabled={busy} onClick={accept}>{busy ? 'Подключаем…' : 'Начать сопровождение'}</button>
              )}
              {err && <Notice kind="danger">{err}</Notice>}
              <p className="subtle">Ссылка действует до {fmtDate(inv.data.expires_at, { year: true })}</p>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
