import { StrictMode, useRef, useState } from 'react';
import type { CSSProperties } from 'react';
import { createRoot } from 'react-dom/client';
import { HashRouter, Link, NavLink, Route, Routes, useLocation } from 'react-router-dom';
import { Chip } from '@heroui/react';
import Files from './finder';
import Reader from './reader';
import { useDisks } from './disks';
import type { ReadableFile } from './disks';
import './style.css';

function Dashboard() {
  const metrics = [

    { label: 'CPU 使用率', value: '18%', detail: '4 核 · 当前负载', percent: 18 },
    { label: '内存使用率', value: '42%', detail: '3.4 GB / 8 GB', percent: 42 },
    { label: '网络吞吐', value: '24.8 MB/s', detail: '接收 24.8 · 发送 6.2 MB/s' },
  ];

  return <>
    <header className="dash-head">
      <div className="dash-identity">
        <span className="dash-device" aria-hidden="true"><svg viewBox="0 0 32 32" fill="none" stroke="currentColor" strokeWidth="1.5">
          <rect x="4" y="6" width="24" height="20" rx="4" /><path d="M4 13h24M4 19h24M8 9.5h2m-2 7h2m-2 6h2" />
        </svg></span>
        <div><p className="dash-kicker">Harbor NAS <span>·</span> 控制中心</p><h1>系统概览</h1></div>
      </div>
      <div className="device-meta">
        <Chip size="sm" color="success">运行正常</Chip><span className="dash-address">192.168.1.20</span>
        <Link className="dash-open" to="/files">打开文件 <span aria-hidden="true">↗</span></Link>
      </div>
    </header>
    <div className="dash-metrics">{metrics.map(({ label, value, detail, percent }) =>
      <section className="dash-card" key={label}>
        <h2>{label}</h2>
        <div className="metric">{value}</div>
        {percent !== undefined && <div className="track" aria-hidden="true"><span style={{ width: `${percent}%` }} /></div>}
        <p className="muted">{detail}</p>
      </section>
    )}</div>
    <div className="dash-grid">
      <section className="dash-panel trend"><div className="panel-head"><h2>资源趋势</h2><span className="muted">过去 24 小时</span></div>
        <div className="legend"><span>● CPU</span><span>● 内存</span></div>
        <svg viewBox="0 0 560 170" role="img" aria-label="过去 24 小时 CPU 和内存使用率，当前分别为 18% 和 42%">
          <path d="M35 16H550 M35 51H550 M35 86H550 M35 121H550 M35 156H550" stroke="#e6ebf4" />
          <g fill="#687790" fontSize="10"><text x="0" y="20">100%</text><text x="6" y="90">50%</text><text x="12" y="159">0%</text></g>
          <path d="M35 104L65 100L95 103L125 98L155 102L185 94L215 97L245 88L275 94L305 91L335 99L365 96L395 86L425 90L455 94L485 91L515 96L550 97" fill="none" stroke="#008e7d" strokeWidth="2.5" strokeLinejoin="round"/>
          <path d="M35 140L65 135L95 145L125 132L155 136L185 125L215 134L245 106L275 124L305 115L335 133L365 124L395 111L425 125L455 120L485 134L515 121L550 131" fill="none" stroke="#3767e9" strokeWidth="2.5" strokeLinejoin="round"/>
        </svg>
        <div className="chart-time muted"><span>00:00</span><span>06:00</span><span>12:00</span><span>18:00</span><span>现在</span></div>
      </section>
      <section className="dash-panel"><div className="panel-head"><h2>存储池</h2><Chip size="sm" color="success">健康</Chip></div>
        <div className="dash-storage">
          <div className="pool-ring" aria-label="存储空间已用 67.5%"><strong>68%</strong><span>已使用</span></div>
          <div><strong>5.4 TB</strong><span>已用容量 / 总容量 8 TB</span></div>
        </div>
        <div className="line-item"><span>存储池 1</span><strong>RAID 1</strong></div>
        <div className="line-item"><span>剩余空间</span><strong>2.6 TB</strong></div>
      </section>
      <section className="dash-panel"><div className="panel-head"><h2>近期活动</h2><span className="muted">最近 24 小时</span></div>
        <div className="line-item"><span className="activity">定时备份完成</span><span className="muted">今天 03:00</span></div>
        <div className="line-item"><span className="activity">磁盘健康检查通过</span><span className="muted">今天 02:15</span></div>
        <div className="line-item"><span className="activity">媒体库索引完成</span><span className="muted">昨天 22:46</span></div>
      </section>
      <section className="dash-panel"><div className="panel-head"><h2>设备信息</h2><span className="muted">演示环境</span></div>
        <div className="line-item"><span>主机名</span><strong>Harbor NAS</strong></div>
        <div className="line-item"><span>运行时间</span><strong>12 天 8 小时</strong></div>
        <div className="line-item"><span>下次备份</span><strong>明天 03:00</strong></div>
      </section>
    </div>
  </>;
}

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
      <Route path="*" element={<main className="dashboard-page"><Dashboard /></main>} />
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
