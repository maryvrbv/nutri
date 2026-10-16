import { useEffect, useState, type ReactNode } from 'react';
import { Link } from 'react-router-dom';
import { Icon } from './ui';

// ---------- Установка как приложения (PWA) ----------

type PromptEvent = Event & { prompt: () => Promise<void>; userChoice: Promise<{ outcome: 'accepted' | 'dismissed' }> };

// Событие приходит один раз и рано — ловим его до того, как откроется экран установки
let deferred: PromptEvent | null = null;
const listeners = new Set<() => void>();
const notify = () => listeners.forEach((f) => f());
if (typeof window !== 'undefined') {
  window.addEventListener('beforeinstallprompt', (e) => { e.preventDefault(); deferred = e as PromptEvent; notify(); });
  window.addEventListener('appinstalled', () => { deferred = null; installedNow = true; notify(); });
}
let installedNow = false;

export function isStandalone() {
  return window.matchMedia?.('(display-mode: standalone)').matches || (navigator as any).standalone === true;
}

export type Platform = {
  os: 'ios' | 'android' | 'mac' | 'windows' | 'other';
  browser: 'safari' | 'chrome' | 'edge' | 'firefox' | 'samsung' | 'yandex' | 'opera' | 'inapp' | 'other';
  tablet: boolean;
};

export function detectPlatform(ua = navigator.userAgent): Platform {
  const iPadOS = navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1;
  const os: Platform['os'] = /iPhone|iPad|iPod/.test(ua) || iPadOS ? 'ios' : /Android/.test(ua) ? 'android' : /Mac OS X/.test(ua) ? 'mac' : /Windows/.test(ua) ? 'windows' : 'other';
  const tablet = /iPad/.test(ua) || iPadOS || (/Android/.test(ua) && !/Mobile/.test(ua));
  let browser: Platform['browser'] = 'other';
  if (/Instagram|FBAN|FBAV|Telegram|VKClient|WhatsApp|; wv\)/.test(ua)) browser = 'inapp';
  else if (/YaBrowser|YaApp/.test(ua)) browser = 'yandex';
  else if (/SamsungBrowser/.test(ua)) browser = 'samsung';
  else if (/EdgiOS|EdgA|Edg\//.test(ua)) browser = 'edge';
  else if (/OPR\/|OPT\//.test(ua)) browser = 'opera';
  else if (/FxiOS|Firefox\//.test(ua)) browser = 'firefox';
  else if (/CriOS|Chrome\//.test(ua)) browser = 'chrome';
  else if (/Safari\//.test(ua)) browser = 'safari';
  return { os, browser, tablet };
}

export function useInstall() {
  const [, force] = useState(0);
  useEffect(() => {
    const f = () => force((n) => n + 1);
    listeners.add(f);
    return () => { listeners.delete(f); };
  }, []);
  return {
    canPrompt: !!deferred,
    installed: installedNow || isStandalone(),
    prompt: async () => {
      if (!deferred) return false;
      const e = deferred;
      await e.prompt();
      const { outcome } = await e.userChoice;
      if (outcome === 'accepted') { deferred = null; notify(); }
      return outcome === 'accepted';
    },
  };
}

// Значки, похожие на кнопки в браузерах, — чтобы было понятно, что искать
const ShareIOS = () => (
  <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
    <path d="M12 3v12M8 7l4-4 4 4" /><path d="M6 11H5a1 1 0 0 0-1 1v8a1 1 0 0 0 1 1h14a1 1 0 0 0 1-1v-8a1 1 0 0 0-1-1h-1" />
  </svg>
);
const Dots = () => (
  <svg width="20" height="20" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><circle cx="12" cy="5" r="2" /><circle cx="12" cy="12" r="2" /><circle cx="12" cy="19" r="2" /></svg>
);
const AddBox = () => (
  <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" aria-hidden="true"><rect x="3" y="3" width="18" height="18" rx="4" /><path d="M12 8v8M8 12h8" /></svg>
);
const K = ({ children }: { children: ReactNode }) => <span className="kbd">{children}</span>;

type Guide = { title: string; steps: ReactNode[]; note?: ReactNode };

export function guideFor(p: Platform): Guide {
  const home = <b>На экран «Домой»</b>;
  if (p.browser === 'inapp') {
    return {
      title: 'Сначала откройте сайт в браузере',
      steps: [
        <>Нажмите <K><Dots /></K> или <K>⋯</K> в углу экрана</>,
        <>Выберите <b>«Открыть в браузере»</b></>,
        <>Вернитесь на этот экран — там будет инструкция для вашего браузера</>,
      ],
      note: 'Встроенный браузер мессенджера не умеет устанавливать приложения',
    };
  }
  if (p.os === 'ios') {
    if (p.browser === 'safari') {
      return {
        title: p.tablet ? 'Установка на iPad' : 'Установка на iPhone',
        steps: [
          <>Нажмите <K><ShareIOS /></K> <b>«Поделиться»</b> {p.tablet ? 'вверху справа' : 'внизу экрана'}. Если кнопки не видно, сначала нажмите <K>⋯</K> в адресной строке</>,
          <>Пролистайте вниз и выберите <K><AddBox /></K> {home}</>,
          <>Нажмите <b>«Добавить»</b> — значок Нутри появится рядом с другими приложениями</>,
        ],
      };
    }
    return {
      title: 'Установка на iPhone',
      steps: [
        <>Нажмите <K><ShareIOS /></K> <b>«Поделиться»</b> в адресной строке</>,
        <>Выберите <K><AddBox /></K> {home} и нажмите <b>«Добавить»</b></>,
      ],
      note: <>Если такого пункта нет, откройте этот адрес в <b>Safari</b>: на iPhone установка надёжнее всего работает через него</>,
    };
  }
  if (p.os === 'android') {
    if (p.browser === 'samsung') {
      return { title: 'Установка в Samsung Internet', steps: [
        <>Нажмите <K>≡</K> внизу экрана</>,
        <>Выберите <b>«Добавить страницу на»</b> → <b>«Главный экран»</b></>,
        <>Подтвердите — значок появится на рабочем столе</>,
      ] };
    }
    if (p.browser === 'yandex') {
      return { title: 'Установка в Яндекс Браузере', steps: [
        <>Нажмите <K><Dots /></K> в адресной строке или внизу экрана</>,
        <>Выберите <b>«Добавить ярлык»</b> или <b>«Установить приложение»</b></>,
        <>Подтвердите — значок появится на рабочем столе</>,
      ] };
    }
    if (p.browser === 'firefox') {
      return { title: 'Установка в Firefox', steps: [
        <>Нажмите <K><Dots /></K> справа от адресной строки</>,
        <>Выберите <b>«Установить»</b> или <b>«Добавить на главный экран»</b></>,
      ] };
    }
    return { title: 'Установка на Android', steps: [
      <>Нажмите <K><Dots /></K> справа вверху</>,
      <>Выберите <b>«Установить приложение»</b> или <b>«Добавить на главный экран»</b></>,
      <>Нажмите <b>«Установить»</b></>,
    ] };
  }
  if (p.os === 'mac' && p.browser === 'safari') {
    return { title: 'Установка на Mac', steps: [
      <>В меню вверху выберите <b>«Файл»</b> → <b>«Добавить в Dock»</b></>,
      <>Нажмите <b>«Добавить»</b> — Нутри появится в Dock и в Launchpad</>,
    ], note: 'Нужна macOS Sonoma или новее' };
  }
  if (p.browser === 'firefox') {
    return { title: 'Firefox не устанавливает сайты как приложения', steps: [
      <>Откройте этот адрес в <b>Chrome</b>, <b>Edge</b> или <b>Яндекс Браузере</b></>,
      <>Вернитесь на этот экран — появится кнопка установки</>,
    ] };
  }
  return { title: 'Установка на компьютер', steps: [
    <>Нажмите значок установки <K><AddBox /></K> справа в адресной строке</>,
    <>Или откройте меню <K><Dots /></K> → <b>«Установить Нутри»</b> (может называться «Приложения» → «Установить»)</>,
  ] };
}

export function InstallGuide() {
  const { canPrompt, installed, prompt } = useInstall();
  const [p] = useState(detectPlatform);
  if (installed) {
    return (
      <div className="card install-done">
        <Icon name="check" size={28} />
        <div><h2>Приложение установлено</h2><p className="muted small">Открывайте Нутри значком на экране — так быстрее отмечать приём</p></div>
      </div>
    );
  }
  const g = guideFor(p);
  return (
    <div className="stack" style={{ '--gap': '16px' } as any}>
      <div className="card install-hero">
        <img src="/icon-192.png" alt="" width={64} height={64} />
        <div>
          <h2>Нутри на {p.os === 'ios' || p.os === 'android' ? 'телефоне' : 'компьютере'}</h2>
          <p className="muted small">Значок на экране, открывается без адресной строки, работает даже при слабом интернете</p>
        </div>
      </div>
      {canPrompt ? (
        <button className="btn primary block" onClick={prompt}><Icon name="download" />Установить приложение</button>
      ) : (
        <div className="card">
          <h3>{g.title}</h3>
          <ol className="install-steps">
            {g.steps.map((s, i) => <li key={i}><span className="n">{i + 1}</span><span>{s}</span></li>)}
          </ol>
          {g.note && <p className="small muted mt-8">{g.note}</p>}
        </div>
      )}
      <p className="tiny muted">Это тот же сайт: данные и вход общие, отдельно ничего скачивать из магазина приложений не нужно.</p>
    </div>
  );
}

const DISMISS_KEY = 'nutri:install-banner-dismissed';

/** Ненавязчивое предложение установить — один раз, пока не закроют. */
export function InstallBanner() {
  const { installed } = useInstall();
  const [hidden, setHidden] = useState(() => { try { return localStorage.getItem(DISMISS_KEY) === '1'; } catch { return false; } });
  if (installed || hidden) return null;
  const close = () => { setHidden(true); try { localStorage.setItem(DISMISS_KEY, '1'); } catch { /* хранилище недоступно — просто скрываем */ } };
  return (
    <div className="install-banner">
      <img src="/icon-192.png" alt="" width={40} height={40} />
      <div className="grow">
        <div className="list-title">Установите Нутри на телефон</div>
        <div className="small muted">Так быстрее отмечать приём</div>
      </div>
      <Link to="/install" className="btn small primary">Как</Link>
      <button className="btn ghost icon small" onClick={close} aria-label="Скрыть"><Icon name="x" size={18} /></button>
    </div>
  );
}

export function InstallPage({ back }: { back?: string }) {
  return (
    <div className={back ? 'page' : ''} style={back ? undefined : { maxWidth: 640 }}>
      {back && <Link to={back} className="back"><Icon name="left" size={18} />Ещё</Link>}
      <div className="page-head"><h1>Установить приложение</h1></div>
      <InstallGuide />
    </div>
  );
}
