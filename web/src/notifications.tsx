import { createContext, useCallback, useContext, useEffect, useRef, useState, type ReactNode } from 'react';
import { Link } from 'react-router-dom';
import { api, type Notification } from './api';
import { useAuth } from './auth';
import { fmtRelative } from './format';
import { Empty, Icon, Loader } from './ui';

type Ctx = { items: Notification[] | null; unread: number; reload: () => void; markRead: (ids?: string[]) => Promise<void> };
const NCtx = createContext<Ctx>({ items: null, unread: 0, reload: () => {}, markRead: async () => {} });
export const useNotifications = () => useContext(NCtx);

/**
 * Опрос уведомлений раз в минуту. Браузерные уведомления (если включены) показывают
 * только безопасный текст без названий добавок и результатов, пока пользователь не разрешит иное.
 */
export function NotificationsProvider({ children }: { children: ReactNode }) {
  const { me } = useAuth();
  const [items, setItems] = useState<Notification[] | null>(null);
  const seen = useRef<Set<string> | null>(null);
  const load = useCallback(async () => {
    try {
      const r = await api.get<{ items: Notification[] }>('/notifications');
      setItems(r.items);
      if (seen.current && me?.settings.channel_browser && 'Notification' in window && Notification.permission === 'granted') {
        for (const n of r.items) {
          if (!n.read_at && !seen.current.has(n.id)) {
            new Notification(me.settings.hide_sensitive ? n.public_title : n.title, { tag: n.id, body: me.settings.hide_sensitive ? '' : n.body });
          }
        }
      }
      seen.current = new Set(r.items.map((n) => n.id));
    } catch { /* сеть недоступна — попробуем позже */ }
  }, [me?.settings.channel_browser, me?.settings.hide_sensitive]);
  useEffect(() => {
    load();
    const t = window.setInterval(load, 60_000);
    const onFocus = () => load();
    window.addEventListener('focus', onFocus);
    return () => { window.clearInterval(t); window.removeEventListener('focus', onFocus); };
  }, [load]);
  const markRead = async (ids?: string[]) => {
    await api.post('/notifications/read', ids ? { ids } : {});
    load();
  };
  const unread = items?.filter((n) => !n.read_at).length ?? 0;
  return <NCtx.Provider value={{ items, unread, reload: load, markRead }}>{children}</NCtx.Provider>;
}

const KIND_ICON: Record<string, string> = {
  intake_reminder: 'clock', scheme_new: 'pill', scheme_updated: 'pill', scheme_cancelled: 'pill', recognition_ready: 'file', recognition_failed: 'alert',
  comment: 'message', question: 'message', control_date: 'calendar', new_labs: 'flask', adverse: 'alert', client_connected: 'users', specialist_connected: 'users', client_revoked: 'lock',
};

export function NotificationsList() {
  const { items, markRead } = useNotifications();
  useEffect(() => {
    if (items?.some((n) => !n.read_at)) {
      const t = window.setTimeout(() => markRead(), 1500);
      return () => window.clearTimeout(t);
    }
  }, [items]); // eslint-disable-line react-hooks/exhaustive-deps
  if (!items) return <Loader />;
  if (!items.length) return <Empty icon="bell" title="Пока тихо">Здесь появятся напоминания, новые схемы и комментарии специалиста</Empty>;
  return (
    <div className="card">
      <div className="list">
        {items.map((n) => {
          const inner = (
            <>
              <span className="ic"><Icon name={KIND_ICON[n.kind] ?? 'bell'} size={18} /></span>
              <span className="grow">
                <span className="list-title" style={{ display: 'block' }}>{n.title}</span>
                {n.body && <span className="small muted" style={{ display: 'block' }}>{n.body}</span>}
                <span className="tiny muted">{fmtRelative(n.created_at)}</span>
              </span>
              {n.link && <Icon name="right" className="chev" />}
            </>
          );
          return n.link
            ? <Link key={n.id} to={n.link} className={`notif ${n.read_at ? '' : 'unread'}`}>{inner}</Link>
            : <div key={n.id} className={`notif ${n.read_at ? '' : 'unread'}`}>{inner}</div>;
        })}
      </div>
    </div>
  );
}
