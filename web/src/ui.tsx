import { createContext, useCallback, useContext, useEffect, useRef, useState, type ReactNode } from 'react';
import { ApiError } from './api';
import { DOC_STATUS, SCHEME_STATUS, STATE_LABELS } from './format';

// ---------- Иконки (контурные, 24×24, в стиле Lucide) ----------

const P: Record<string, ReactNode> = {
  check: <path d="M20 6 9 17l-5-5" />,
  x: <path d="M18 6 6 18M6 6l12 12" />,
  clock: <><circle cx="12" cy="12" r="9" /><path d="M12 7v5l3 2" /></>,
  pill: <><path d="m10.5 20.5 10-10a4.95 4.95 0 1 0-7-7l-10 10a4.95 4.95 0 1 0 7 7Z" /><path d="m8.5 8.5 7 7" /></>,
  today: <><rect x="3" y="4" width="18" height="18" rx="3" /><path d="M16 2v4M8 2v4M3 10h18" /><path d="m9 16 2 2 4-4" /></>,
  calendar: <><rect x="3" y="4" width="18" height="18" rx="3" /><path d="M16 2v4M8 2v4M3 10h18" /></>,
  flask: <><path d="M9 3h6M10 3v6L4.5 18.5A2 2 0 0 0 6.2 21.5h11.6a2 2 0 0 0 1.7-3L14 9V3" /><path d="M7 15h10" /></>,
  heart: <path d="M19 14c1.5-1.5 3-3.3 3-5.5A5.5 5.5 0 0 0 16.5 3c-1.8 0-3 .5-4.5 2-1.5-1.5-2.7-2-4.5-2A5.5 5.5 0 0 0 2 8.5c0 2.3 1.5 4 3 5.5l7 7Z" />,
  user: <><circle cx="12" cy="8" r="4" /><path d="M4 21a8 8 0 0 1 16 0" /></>,
  users: <><circle cx="9" cy="8" r="4" /><path d="M2 21a7 7 0 0 1 14 0" /><path d="M16 4.5a4 4 0 0 1 0 7M22 21a7 7 0 0 0-4-6.3" /></>,
  settings: <><circle cx="12" cy="12" r="3" /><path d="M19.4 15a1.7 1.7 0 0 0 .3 1.8l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.7 1.7 0 0 0-1.8-.3 1.7 1.7 0 0 0-1 1.5V21a2 2 0 1 1-4 0v-.1a1.7 1.7 0 0 0-1.1-1.5 1.7 1.7 0 0 0-1.8.3l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1a1.7 1.7 0 0 0 .3-1.8 1.7 1.7 0 0 0-1.5-1H3a2 2 0 1 1 0-4h.1a1.7 1.7 0 0 0 1.5-1.1 1.7 1.7 0 0 0-.3-1.8l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1a1.7 1.7 0 0 0 1.8.3H9a1.7 1.7 0 0 0 1-1.5V3a2 2 0 1 1 4 0v.1a1.7 1.7 0 0 0 1 1.5 1.7 1.7 0 0 0 1.8-.3l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1a1.7 1.7 0 0 0-.3 1.8V9a1.7 1.7 0 0 0 1.5 1H21a2 2 0 1 1 0 4h-.1a1.7 1.7 0 0 0-1.5 1Z" /></>,
  bell: <><path d="M6 8a6 6 0 0 1 12 0c0 7 3 9 3 9H3s3-2 3-9" /><path d="M10.3 21a1.9 1.9 0 0 0 3.4 0" /></>,
  plus: <path d="M12 5v14M5 12h14" />,
  minus: <path d="M5 12h14" />,
  upload: <><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" /><path d="m17 8-5-5-5 5M12 3v12" /></>,
  file: <><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8Z" /><path d="M14 2v6h6M8 13h8M8 17h5" /></>,
  right: <path d="m9 18 6-6-6-6" />,
  left: <path d="m15 18-6-6 6-6" />,
  alert: <><path d="m21.7 18-8-14a2 2 0 0 0-3.4 0l-8 14A2 2 0 0 0 4 21h16a2 2 0 0 0 1.7-3Z" /><path d="M12 9v4M12 17h.01" /></>,
  info: <><circle cx="12" cy="12" r="9" /><path d="M12 16v-4M12 8h.01" /></>,
  lock: <><rect x="4" y="11" width="16" height="10" rx="2" /><path d="M8 11V7a4 4 0 0 1 8 0v4" /></>,
  logout: <><path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4" /><path d="m16 17 5-5-5-5M21 12H9" /></>,
  search: <><circle cx="11" cy="11" r="7" /><path d="m21 21-4.3-4.3" /></>,
  link: <><path d="M10 13a5 5 0 0 0 7.5.5l3-3a5 5 0 0 0-7-7l-1.7 1.7" /><path d="M14 11a5 5 0 0 0-7.5-.5l-3 3a5 5 0 0 0 7 7l1.7-1.7" /></>,
  trash: <><path d="M3 6h18M8 6V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6" /></>,
  edit: <><path d="M12 20h9" /><path d="M16.5 3.5a2.1 2.1 0 0 1 3 3L7 19l-4 1 1-4Z" /></>,
  eye: <><path d="M2 12s3.5-7 10-7 10 7 10 7-3.5 7-10 7S2 12 2 12Z" /><circle cx="12" cy="12" r="3" /></>,
  chart: <><path d="M3 3v18h18" /><path d="m7 15 4-4 3 3 5-6" /></>,
  history: <><path d="M3 12a9 9 0 1 0 3-6.7L3 8" /><path d="M3 3v5h5M12 7v5l3 2" /></>,
  more: <><circle cx="5" cy="12" r="1.5" /><circle cx="12" cy="12" r="1.5" /><circle cx="19" cy="12" r="1.5" /></>,
  sun: <><circle cx="12" cy="12" r="4" /><path d="M12 2v2M12 20v2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M2 12h2M20 12h2M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4" /></>,
  moon: <path d="M12 3a6 6 0 0 0 9 9 9 9 0 1 1-9-9Z" />,
  message: <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2Z" />,
  download: <><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" /><path d="m7 10 5 5 5-5M12 15V3" /></>,
  copy: <><rect x="9" y="9" width="13" height="13" rx="2" /><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1" /></>,
  layers: <><path d="m12 2 10 5-10 5L2 7Z" /><path d="m2 17 10 5 10-5M2 12l10 5 10-5" /></>,
  leaf: <><path d="M11 20A7 7 0 0 1 9.8 6.1C15.5 5 17 4.5 19 2c1 2 2 4.2 2 8 0 5.5-4.8 10-10 10Z" /><path d="M2 21c0-3 1.9-5.4 5.1-6C9.5 14.5 12 13 13 12" /></>,
  snooze: <><circle cx="12" cy="13" r="8" /><path d="M5 3 2 6M22 6l-3-3M10 10h4l-4 5h4" /></>,
  skip: <><circle cx="12" cy="12" r="9" /><path d="m15 9-6 6M9 9l6 6" /></>,
  shield: <path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10Z" />,
  refresh: <><path d="M21 12a9 9 0 0 1-15 6.7L3 16" /><path d="M3 21v-5h5M3 12a9 9 0 0 1 15-6.7L21 8" /><path d="M21 3v5h-5" /></>,
};

export function Icon({ name, size = 20, className, label }: { name: keyof typeof P | string; size?: number; className?: string; label?: string }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round"
      className={className} aria-hidden={label ? undefined : true} role={label ? 'img' : undefined} aria-label={label}>
      {P[name]}
    </svg>
  );
}

// ---------- Данные ----------

/** Загрузка данных с повтором. reload() перезапрашивает, сохраняя прежние данные на экране. */
export function useData<T>(fn: () => Promise<T>, deps: unknown[]) {
  const [state, setState] = useState<{ data?: T; error?: ApiError; loading: boolean }>({ loading: true });
  const seq = useRef(0);
  const load = useCallback(() => {
    const n = ++seq.current;
    setState((s) => ({ ...s, loading: true }));
    fn().then(
      (data) => n === seq.current && setState({ data, loading: false }),
      (error) => n === seq.current && setState((s) => ({ ...s, error, loading: false })),
    );
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, deps);
  useEffect(() => { load(); }, [load]);
  return { ...state, reload: load, setData: (d: T) => setState({ data: d, loading: false }) };
}

export function Loader({ error, retry, rows = 3 }: { error?: ApiError; retry?: () => void; rows?: number }) {
  if (error) {
    return (
      <div className="empty" role="alert">
        <Icon name="alert" />
        <h3>{error.status === 404 ? 'Не нашли такую страницу' : 'Не получилось загрузить'}</h3>
        <p className="small">{error.status === 404 ? 'Возможно, доступ к данным закрыт или ссылка устарела.' : error.message}</p>
        {retry && error.status !== 404 && <button className="btn mt-16" onClick={retry}>Повторить</button>}
      </div>
    );
  }
  return (
    <div className="stack" aria-busy="true" aria-label="Загрузка">
      {Array.from({ length: rows }, (_, i) => <div key={i} className="skeleton" style={{ height: i === 0 ? 72 : 96 }} />)}
    </div>
  );
}

// ---------- Уведомления на экране ----------

type ToastT = { text: string; action?: { label: string; run: () => void } };
const ToastCtx = createContext<(t: ToastT | string) => void>(() => {});
export const useToast = () => useContext(ToastCtx);

export function ToastProvider({ children }: { children: ReactNode }) {
  const [t, setT] = useState<ToastT | null>(null);
  const timer = useRef<number>();
  const show = useCallback((x: ToastT | string) => {
    setT(typeof x === 'string' ? { text: x } : x);
    window.clearTimeout(timer.current);
    timer.current = window.setTimeout(() => setT(null), 5000);
  }, []);
  return (
    <ToastCtx.Provider value={show}>
      {children}
      <div aria-live="polite" className="sr-only">{t?.text}</div>
      {t && (
        <div className="toast">
          <span>{t.text}</span>
          {t.action && <button onClick={() => { t.action!.run(); setT(null); }}>{t.action.label}</button>}
        </div>
      )}
    </ToastCtx.Provider>
  );
}

// ---------- Компоненты ----------

export function Sheet({ title, onClose, children, labelledBy }: { title: string; onClose: () => void; children: ReactNode; labelledBy?: string }) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const prev = document.activeElement as HTMLElement | null;
    const el = ref.current;
    el?.querySelector<HTMLElement>('input, select, textarea, button:not([data-close])')?.focus();
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
      if (e.key === 'Tab' && el) {
        const f = [...el.querySelectorAll<HTMLElement>('button, input, select, textarea, a[href]')].filter((x) => !x.hasAttribute('disabled'));
        if (!f.length) return;
        if (e.shiftKey && document.activeElement === f[0]) { e.preventDefault(); f[f.length - 1].focus(); }
        else if (!e.shiftKey && document.activeElement === f[f.length - 1]) { e.preventDefault(); f[0].focus(); }
      }
    };
    document.addEventListener('keydown', onKey);
    document.body.style.overflow = 'hidden';
    return () => { document.removeEventListener('keydown', onKey); document.body.style.overflow = ''; prev?.focus?.(); };
  }, [onClose]);
  const id = labelledBy ?? 'sheet-title';
  return (
    <div className="overlay" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div className="sheet" role="dialog" aria-modal="true" aria-labelledby={id} ref={ref}>
        <div className="row between top" style={{ marginBottom: 4 }}>
          <h2 id={id}>{title}</h2>
          <button className="btn ghost icon small" onClick={onClose} aria-label="Закрыть" data-close><Icon name="x" /></button>
        </div>
        {children}
      </div>
    </div>
  );
}

export function Field({ label, hint, error, children, htmlFor }: { label: string; hint?: ReactNode; error?: string; children: ReactNode; htmlFor?: string }) {
  return (
    <div className="field">
      <label htmlFor={htmlFor}>{label}</label>
      {children}
      {error ? <span className="err" role="alert">{error}</span> : hint ? <span className="hint">{hint}</span> : null}
    </div>
  );
}

export function Empty({ icon = 'info', title, children }: { icon?: string; title: string; children?: ReactNode }) {
  return (
    <div className="empty">
      <Icon name={icon} />
      <h3>{title}</h3>
      {children && <div className="small">{children}</div>}
    </div>
  );
}

export function Notice({ kind = 'info', icon, children }: { kind?: 'info' | 'warn' | 'danger' | 'auto' | 'plain'; icon?: string; children: ReactNode }) {
  return (
    <div className={`notice ${kind}`} role={kind === 'danger' ? 'alert' : undefined}>
      <Icon name={icon ?? (kind === 'warn' || kind === 'danger' ? 'alert' : 'info')} />
      <div>{children}</div>
    </div>
  );
}

export function StateBadge({ state }: { state: keyof typeof STATE_LABELS }) {
  const icon = state === 'taken' ? 'check' : state === 'skipped' ? 'skip' : state === 'planned' ? 'clock' : null;
  return <span className={`badge ${state}`}>{icon && <Icon name={icon} />}{STATE_LABELS[state]}</span>;
}

export function SchemeBadge({ status }: { status: string }) {
  const cls = status === 'active' ? 'taken' : status === 'scheduled' ? 'planned' : status === 'cancelled' ? 'danger' : status === 'draft' ? 'warn' : '';
  return <span className={`badge ${cls}`}>{SCHEME_STATUS[status] ?? status}</span>;
}

export function DocBadge({ status }: { status: string }) {
  const cls = status === 'confirmed' ? 'taken' : status === 'needs_review' ? 'warn' : status === 'error' ? 'danger' : 'planned';
  return <span className={`badge ${cls}`}>{status === 'processing' && <span className="spinner" style={{ width: 12, height: 12, borderWidth: 2 }} />}{DOC_STATUS[status] ?? status}</span>;
}

export function Seg<T extends string>({ value, options, onChange, label }: { value: T; options: { value: T; label: string }[]; onChange: (v: T) => void; label: string }) {
  return (
    <div className="seg" role="group" aria-label={label}>
      {options.map((o) => <button key={o.value} type="button" aria-pressed={value === o.value} onClick={() => onChange(o.value)}>{o.label}</button>)}
    </div>
  );
}

export function Scale({ value, onChange, label, low, high }: { value: number | null; onChange: (v: number | null) => void; label: string; low: string; high: string }) {
  return (
    <div>
      <div className="label" id={`sc-${label}`}>{label}</div>
      <div className="scale mt-8" role="group" aria-labelledby={`sc-${label}`}>
        {[1, 2, 3, 4, 5].map((n) => (
          <button key={n} type="button" aria-pressed={value === n} onClick={() => onChange(value === n ? null : n)} aria-label={`${label}: ${n} из 5`}>{n}</button>
        ))}
      </div>
      <div className="scale-legend"><span>{low}</span><span>{high}</span></div>
    </div>
  );
}

export function useOnline() {
  const [on, setOn] = useState(navigator.onLine);
  useEffect(() => {
    const a = () => setOn(true), b = () => setOn(false);
    window.addEventListener('online', a); window.addEventListener('offline', b);
    return () => { window.removeEventListener('online', a); window.removeEventListener('offline', b); };
  }, []);
  return on;
}

export function errorText(e: unknown) {
  return e instanceof ApiError ? e.message : 'Что-то пошло не так. Попробуйте ещё раз.';
}
