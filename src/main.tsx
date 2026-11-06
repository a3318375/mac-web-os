import { StrictMode, useRef, useState } from 'react';
import type { CSSProperties } from 'react';
import { createRoot } from 'react-dom/client';
import { HashRouter, NavLink, Route, Routes, useLocation } from 'react-router-dom';
import Overview from './overview';
import Files from './finder';
import Reader from './reader';
import { useDisks } from './disks';
import type { ReadableFile } from './disks';
import './style.css';

const finderApp = new URL('./assets/finder-app.png', import.meta.url).href;
const dockSettingsKey = 'harbor-nas.dock';
const defaultDockSettings = { size: 45, magnify: true };

function readDockSettings() {
  try {
    const saved = JSON.parse(localStorage.getItem(dockSettingsKey) ?? 'null');
    return {
      size: Number.isInteger(saved?.size) && saved.size >= 36 && saved.size <= 54 ? saved.size : defaultDockSettings.size,
      magnify: typeof saved?.magnify === 'boolean' ? saved.magnify : defaultDockSettings.magnify,
    };
  } catch {
    return defaultDockSettings;
  }
}

function Dock({ readerTitle, onResume }: { readerTitle?: string; onResume: () => void }) {
  const { state } = useLocation();
  const finderTarget = state?.finderResume ?? '/files';
  const [settings, setSettings] = useState(readDockSettings);

  function updateSettings(next: typeof defaultDockSettings) {
    setSettings(next);
    try { localStorage.setItem(dockSettingsKey, JSON.stringify(next)); } catch {}
  }

  return <nav className="dock" aria-label="程序坞" data-magnify={settings.magnify}
    style={{ '--dock-preferred-size': settings.size + 'px' } as CSSProperties} onKeyDown={event => {
    const items = Array.from(event.currentTarget.querySelectorAll<HTMLElement>(':scope > :is(a, button)'));
    const focused = items.findIndex(item => item === document.activeElement);
    const step = event.key === 'ArrowLeft' ? -1 : event.key === 'ArrowRight' ? 1 : 0;
    if (!step || focused < 0) return;
    event.preventDefault();
    items[(focused + step + items.length) % items.length].focus();
  }}>
    <NavLink to={finderTarget} aria-label="访达">
      <img src={finderApp} className="dock-icon" alt="" draggable={false} />
      <span className="dock-label" aria-hidden="true">访达</span>
    </NavLink>
    <NavLink to="/" end aria-label="系统概览">
      <span className="dock-icon dock-overview" aria-hidden="true"><svg viewBox="0 0 48 48" fill="none">
        <path d="M7 14h34M7 24h34M7 34h34M14 7v34M24 7v34M34 7v34" stroke="#ffffff24" />
        <path d="M7 26h10l4-9 5 17 5-11h10" stroke="#67edae" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
      </svg></span>
      <span className="dock-label" aria-hidden="true">系统概览</span>
    </NavLink>
    <button type="button" popoverTarget="dock-settings" aria-haspopup="dialog" aria-label="程序坞设置" className="dock-settings-trigger">
      <span className="dock-icon dock-gear" aria-hidden="true"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinejoin="round">
        <path d="M10 3h4l.7 2.4 1.3.8 2.5-.6 2 3.4-1.8 1.8v1.6l1.8 1.8-2 3.4-2.5-.6-1.3.8L14 20h-4l-.7-2.2-1.3-.8-2.5.6-2-3.4 1.8-1.8v-1.6L3.5 9l2-3.4 2.5.6 1.3-.8z" />
        <circle cx="12" cy="11.6" r="3.2" />
      </svg></span>
      <span className="dock-label" aria-hidden="true">设置</span>
    </button>
    {readerTitle && <><span className="dock-divider" aria-hidden="true" /><button type="button" autoFocus aria-label={'恢复阅读窗口：' + readerTitle} onClick={onResume}>
      <span className="dock-icon dock-reader" aria-hidden="true"><svg viewBox="0 0 36 36" fill="none">
        <rect x="6" y="8" width="24" height="20" rx="3" fill="white" stroke="currentColor" />
        <path d="M6 13h24m-19 6h14m-14 4h10" stroke="currentColor" strokeLinecap="round" />
      </svg></span>
      <span className="dock-label" aria-hidden="true">{readerTitle}</span>
    </button></>}
    <section className="dock-settings" id="dock-settings" popover="auto" role="dialog" aria-labelledby="dock-settings-title">
      <h2 id="dock-settings-title">程序坞设置</h2>
      <div className="dock-settings-size">
        <label htmlFor="dock-size">图标大小</label>
        <span aria-hidden="true">{settings.size} px</span>
        <input id="dock-size" type="range" min="36" max="54" value={settings.size}
          onChange={event => updateSettings({ ...settings, size: event.currentTarget.valueAsNumber })} />
      </div>
      <label className="dock-settings-row">
        悬停放大
        <input type="checkbox" role="switch" checked={settings.magnify}
          onChange={event => updateSettings({ ...settings, magnify: event.currentTarget.checked })} />
      </label>
      <button className="dock-reset" type="button" onClick={() => updateSettings(defaultDockSettings)}>恢复默认设置</button>
    </section>
  </nav>;
}

function Desktop() {
  const inventory = useDisks();
  const [file, setFile] = useState<ReadableFile>();
  const [minimized, setMinimized] = useState(false);
  const opener = useRef<HTMLElement>(null);

  return <>
    <Routes>
      <Route path="/files/*" element={<main className="files-page"><Files inventory={inventory} onOpenFile={(entry, trigger) => {
        opener.current = trigger;
        setFile(entry);
        setMinimized(false);
      }} /></main>} />
      <Route path="*" element={<Overview inventory={inventory} />} />
    </Routes>
    {file && <Reader key={file[0]} file={file} minimized={minimized} onMinimize={() => setMinimized(true)} onClose={() => {
      setFile(undefined);
      opener.current?.focus({ preventScroll: true });
    }} />}
    <Dock readerTitle={minimized ? file?.[0] : undefined} onResume={() => setMinimized(false)} />
  </>;
}

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <HashRouter>
      <Desktop />
    </HashRouter>
  </StrictMode>,
);
