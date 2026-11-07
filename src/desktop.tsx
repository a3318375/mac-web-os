import { useEffect, useRef, useState } from 'react';
import type { CSSProperties } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import AppWindow from './app-window';
import Files from './finder';
import Overview from './overview';
import TaskManager from './task-manager';
import CopyTasks from './copy-tasks';
import Reader from './reader';
import { useDisks } from './disks';
import type { ReadableFile } from './disks';
import { Folder, Icon } from './ui';
import type { IconName } from './ui';
import './desktop.css';

const apps = [
  { id: 'files', title: '文件管理', icon: 'folder', color: 'blue' },
  { id: 'overview', title: '系统概览', icon: 'monitor', color: 'gray' },
  { id: 'tasks', title: '任务管理器', icon: 'sort', color: 'blue' },
  { id: 'copies', title: '复制任务', icon: 'copy', color: 'green' },
  { id: 'settings', title: '桌面设置', icon: 'settings', color: 'gray' },
] as const;
type AppID = typeof apps[number]['id'];
type WindowID = AppID | 'reader';
type WindowState = { open: boolean; minimized: boolean; maximized: boolean };
type Point = { x: number; y: number };
const iconKey = 'harbor-nas.desktop-icons';
function saved<T>(key: string, fallback: T): T {
  try { return JSON.parse(localStorage.getItem(key) ?? 'null') ?? fallback; } catch { return fallback; }
}
function keep(key: string, value: unknown) { try { localStorage.setItem(key, JSON.stringify(value)); } catch {} }
function fitIcon(point: Point) { return { x: Math.max(76, Math.min(point.x, Math.max(76, innerWidth - 100))), y: Math.max(20, Math.min(point.y, Math.max(20, innerHeight - 106))) }; }
function initialIcons() {
  const stored = saved<Record<string, Point>>(iconKey, {});
  return Object.fromEntries(apps.map((app, i) => [app.id, fitIcon(Number.isFinite(stored[app.id]?.x) && Number.isFinite(stored[app.id]?.y) ? stored[app.id] : { x: 96 + Math.floor(i / Math.max(1, Math.floor((innerHeight - 48) / 112))) * 108, y: 48 + i % Math.max(1, Math.floor((innerHeight - 48) / 112)) * 112 })])) as Record<AppID, Point>;
}

export default function Desktop() {
  const { pathname } = useLocation();
  const navigate = useNavigate();
  const inventory = useDisks();
  const [dark, setDark] = useState(() => saved<string>('harbor-nas.theme', 'light') === 'dark');
  const [icons, setIcons] = useState(initialIcons);
  const [selectedIcon, setSelectedIcon] = useState<AppID>();
  const [active, setActive] = useState<WindowID>('files');
  const [order, setOrder] = useState<WindowID[]>([...apps.map(app => app.id), 'reader']);
  const [windows, setWindows] = useState<Record<AppID, WindowState>>(() => Object.fromEntries(apps.map(app => [app.id, { open: pathname.startsWith('/' + app.id) || app.id === 'overview' && pathname === '/overview', minimized: false, maximized: app.id === 'tasks' }])) as Record<AppID, WindowState>);
  const [file, setFile] = useState<ReadableFile>();
  const [readerMinimized, setReaderMinimized] = useState(false);
  const [dock, setDock] = useState(() => {
    const value = saved('harbor-nas.dock', { size: 45, magnify: true });
    return { size: Number.isInteger(value?.size) && value.size >= 36 && value.size <= 54 ? value.size : 45, magnify: value?.magnify !== false };
  });
  const drag = useRef<{ id: AppID; startX: number; startY: number; origin: Point; moved: boolean } | null>(null);
  const skipClick = useRef(false);
  const opener = useRef<HTMLElement>(null);
  const desktopMenu = useRef<HTMLDivElement>(null);
  useEffect(() => { keep('harbor-nas.theme', dark ? 'dark' : 'light'); }, [dark]);
  useEffect(() => { keep('harbor-nas.dock', dock); }, [dock]);
  useEffect(() => {
    const resize = () => setIcons(old => Object.fromEntries(apps.map(app => [app.id, fitIcon(old[app.id])])) as Record<AppID, Point>);
    window.addEventListener('resize', resize); return () => window.removeEventListener('resize', resize);
  }, []);
  useEffect(() => {
    if (pathname === '/preview/files') { navigate('/files', { replace: true }); return; }
    if (pathname.startsWith('/files')) { setWindows(old => ({ ...old, files: { ...old.files, open: true, minimized: false } })); focusApp('files'); }
    else if (pathname === '/overview' || pathname === '/tasks') {
      const id = pathname.slice(1) as 'overview' | 'tasks';
      setWindows(old => ({ ...old, [id]: { ...old[id], open: true, minimized: false } })); focusApp(id);
    }
  }, [pathname]);
  function focusApp(id: WindowID) { setActive(id); setOrder(old => [...old.filter(item => item !== id), id]); }
  function focusPrevious(except: WindowID) {
    const next = [...order].reverse().find(item => item !== except && (item === 'reader' ? !!file && !readerMinimized : windows[item].open && !windows[item].minimized));
    if (next) setActive(next);
  }
  function openApp(id: AppID) {
    focusApp(id); setWindows(old => ({ ...old, [id]: { ...old[id], open: true, minimized: false } }));
    if (id === 'files' && !pathname.startsWith('/files')) navigate('/files');
  }
  function changeWindow(id: AppID, change: Partial<WindowState>) {
    setWindows(old => ({ ...old, [id]: { ...old[id], ...change } }));
    if (change.open === false || change.minimized) {
      focusPrevious(id);
    }
  }
  function resetIcons() { try { localStorage.removeItem(iconKey); } catch {} setIcons(initialIcons()); }
  return <main className="nas-desktop" data-theme={dark ? 'dark' : 'light'} data-window-maximized={active !== 'reader' && windows[active].open && !windows[active].minimized && windows[active].maximized} style={{ '--dock-preferred-size': dock.size + 'px' } as CSSProperties}>
    <div className="fp-wallpaper" aria-hidden="true" onClick={() => setSelectedIcon(undefined)} onContextMenu={event => {
      event.preventDefault(); const menu = desktopMenu.current!; menu.style.left = Math.min(event.clientX, innerWidth - 232) + 'px'; menu.style.top = Math.min(event.clientY, innerHeight - 145) + 'px'; menu.showPopover();
    }} />
    <div className="desktop-icons" aria-label="桌面应用">{apps.map(app => <button key={app.id} type="button" className="desktop-icon" aria-label={app.title} data-selected={selectedIcon === app.id}
      style={{ left: icons[app.id].x, top: icons[app.id].y }} onClick={event => {
        if (skipClick.current) { skipClick.current = false; return; }
        setSelectedIcon(app.id); if (event.detail === 0 || matchMedia('(pointer: coarse)').matches) openApp(app.id);
      }} onDoubleClick={() => openApp(app.id)} onKeyDown={event => {
        if (!event.altKey || !event.key.startsWith('Arrow')) return;
        event.preventDefault(); const point = icons[app.id];
        const next = { ...icons, [app.id]: fitIcon({ x: point.x + (event.key === 'ArrowLeft' ? -24 : event.key === 'ArrowRight' ? 24 : 0), y: point.y + (event.key === 'ArrowUp' ? -24 : event.key === 'ArrowDown' ? 24 : 0) }) }; setIcons(next); keep(iconKey, next);
      }} onPointerDown={event => {
        if (!event.isPrimary || event.button !== 0) return;
        setSelectedIcon(app.id); drag.current = { id: app.id, startX: event.clientX, startY: event.clientY, origin: icons[app.id], moved: false }; event.currentTarget.setPointerCapture(event.pointerId);
      }} onPointerMove={event => {
        const moving = drag.current; if (!moving || moving.id !== app.id) return;
        const dx = event.clientX - moving.startX, dy = event.clientY - moving.startY;
        if (!moving.moved && Math.hypot(dx, dy) < 6) return;
        moving.moved = true; setIcons(old => ({ ...old, [app.id]: fitIcon({ x: moving.origin.x + dx, y: moving.origin.y + dy }) }));
      }} onPointerUp={() => {
        if (drag.current?.moved) { skipClick.current = true; keep(iconKey, icons); }
        drag.current = null;
      }} onLostPointerCapture={() => { drag.current = null; }} title={app.title + ' · 双击打开，Alt + 方向键移动图标'}>
      <span className={`fp-app-icon fp-app-${app.color}`}>{app.icon === 'folder' ? <Folder /> : <Icon name={app.icon} />}</span><span>{app.title}</span>
    </button>)}</div>
    <aside className="fp-desktop-status" aria-label="服务器状态"><span><i data-error={!!inventory.error} />{inventory.error ? '后端未连接' : inventory.loading ? '连接中' : '服务器已连接'}</span><span>硬盘 <b>{inventory.disks.length}</b></span><button type="button" aria-label={dark ? '切换浅色外观' : '切换深色外观'} onClick={() => setDark(!dark)}><Icon name={dark ? 'sun' : 'moon'} /></button></aside>
    <nav className="fp-dock" aria-label="程序坞" data-magnify={dock.magnify} onKeyDown={event => {
      if (!['ArrowUp', 'ArrowDown'].includes(event.key)) return; event.preventDefault();
      const buttons = Array.from(event.currentTarget.querySelectorAll<HTMLButtonElement>('button')); const index = buttons.indexOf(document.activeElement as HTMLButtonElement);
      buttons[(index + (event.key === 'ArrowUp' ? -1 : 1) + buttons.length) % buttons.length]?.focus();
    }}>
      {apps.map(app => <button type="button" key={app.id} aria-label={'打开' + app.title} title={app.title} className={windows[app.id].open ? 'fp-dock-active' : ''} data-focused={active === app.id && windows[app.id].open && !windows[app.id].minimized} onClick={() => openApp(app.id)}>{app.icon === 'folder' ? <Folder small /> : <Icon name={app.icon} />}<span className="desktop-dock-label">{app.title}</span></button>)}
      {file && <><span /><button type="button" aria-label={'恢复阅读：' + file[0]} title={file[0]} className="fp-dock-active" data-focused={active === 'reader' && !readerMinimized} onClick={() => { setReaderMinimized(false); focusApp('reader'); }}><Icon name="text" /></button></>}
    </nav>
    {apps.filter(app => windows[app.id].open).map(app => <AppWindow key={app.id} id={app.id} title={app.title} icon={app.icon as IconName} minimized={windows[app.id].minimized} maximized={windows[app.id].maximized}
      zIndex={active === app.id ? 12 : 4 + order.indexOf(app.id)} onFocus={() => focusApp(app.id)}
      onMinimize={() => changeWindow(app.id, { minimized: true })} onMaximize={() => changeWindow(app.id, { maximized: !windows[app.id].maximized })} onClose={() => changeWindow(app.id, { open: false })}>
      {app.id === 'files' && <Files inventory={inventory} onOpenFile={(entry, trigger) => { opener.current = trigger; setFile(entry); setReaderMinimized(false); focusApp('reader'); }} />}
      {app.id === 'overview' && !windows.overview.minimized && <Overview inventory={inventory} />}
      {app.id === 'tasks' && !windows.tasks.minimized && <TaskManager />}
      {app.id === 'copies' && !windows.copies.minimized && <CopyTasks />}
      {app.id === 'settings' && <section className="desktop-settings" aria-label="桌面设置"><h2>外观</h2><p>统一用于桌面、文件管理和应用窗口</p><div className="desktop-theme-options"><button type="button" aria-pressed={!dark} onClick={() => setDark(false)}><Icon name="sun" />浅色</button><button type="button" aria-pressed={dark} onClick={() => setDark(true)}><Icon name="moon" />深色</button></div><h2>程序坞</h2><label>图标大小 <span>{dock.size} px</span><input type="range" min="36" max="54" value={dock.size} onChange={event => setDock({ ...dock, size: event.currentTarget.valueAsNumber })} /></label><label>悬停放大<input type="checkbox" checked={dock.magnify} onChange={event => setDock({ ...dock, magnify: event.currentTarget.checked })} /></label><button type="button" className="desktop-secondary" onClick={() => setDock({ size: 45, magnify: true })}>恢复程序坞默认设置</button><h2>桌面图标</h2><p>拖动图标调整位置，位置自动保存在当前浏览器。也可选中图标后用 Alt + 方向键移动。</p><button type="button" className="desktop-secondary" onClick={resetIcons}>重新排列图标</button></section>}
    </AppWindow>)}
    {file && <Reader key={file[3]} file={file} minimized={readerMinimized} zIndex={active === 'reader' ? 12 : 4 + order.indexOf('reader')} onFocus={() => focusApp('reader')} onMinimize={() => { setReaderMinimized(true); focusPrevious('reader'); }} onClose={() => { setFile(undefined); focusPrevious('reader'); opener.current?.focus({ preventScroll: true }); }} />}
    <div ref={desktopMenu} className="fp-context" popover="auto" role="dialog" aria-label="桌面操作"><button type="button" onClick={() => { resetIcons(); desktopMenu.current?.hidePopover(); }}><Icon name="apps" />重新排列图标</button><button type="button" onClick={() => { setDark(!dark); desktopMenu.current?.hidePopover(); }}><Icon name={dark ? 'sun' : 'moon'} />{dark ? '切换浅色外观' : '切换深色外观'}</button><hr /><button type="button" onClick={() => { openApp('settings'); desktopMenu.current?.hidePopover(); }}><Icon name="settings" />桌面设置</button></div>
  </main>;
}
