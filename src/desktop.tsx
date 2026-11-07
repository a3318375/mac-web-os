import { useEffect, useRef, useState } from 'react';
import type { CSSProperties } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import AppWindow from './app-window';
import Files from './finder';
import Overview from './overview';
import TaskManager from './task-manager';
import Logs from './logs';
import Downloads from './downloads';
import { arrangeIcons, dropIcon, iconCells, nearestCell } from './window-geometry';
import type { Point } from './window-geometry';
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
  { id: 'logs', title: '日志', icon: 'list', color: 'gray' },
  { id: 'downloads', title: '下载', icon: 'download', color: 'green' },
  { id: 'settings', title: '系统设置', icon: 'settings', color: 'gray' },
] as const;
type AppID = typeof apps[number]['id'];
type WindowID = AppID | 'reader';
type WindowState = { open: boolean; minimized: boolean; maximized: boolean };
const iconKey = 'harbor-nas.desktop-icons';
function saved<T>(key: string, fallback: T): T {
  try { return JSON.parse(localStorage.getItem(key) ?? 'null') ?? fallback; } catch { return fallback; }
}
function keep(key: string, value: unknown) { try { localStorage.setItem(key, JSON.stringify(value)); } catch {} }
const cells = () => iconCells({ width: innerWidth, height: innerHeight }, apps.length);
function initialIcons() { return arrangeIcons(apps.map(app => app.id), saved<Record<string, Point>>(iconKey, {}), cells()); }

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
  const drag = useRef<{ id: AppID; startX: number; startY: number; origin: Point; latest: Point; cell: Point; moved: boolean; frame: number; node: HTMLButtonElement } | null>(null);
  const iconGrid = useRef<HTMLDivElement>(null);
  const dropTarget = useRef<HTMLDivElement>(null);
  const skipClick = useRef(false);
  const opener = useRef<HTMLElement>(null);
  const desktopMenu = useRef<HTMLDivElement>(null);
  useEffect(() => { keep('harbor-nas.theme', dark ? 'dark' : 'light'); }, [dark]);
  useEffect(() => { keep('harbor-nas.dock', dock); }, [dock]);
  useEffect(() => {
    const resize = () => { finishIconDrag(false); setIcons(old => { const next = arrangeIcons(apps.map(app => app.id), old, cells()); keep(iconKey, next); return next; }); };
    window.addEventListener('resize', resize); return () => window.removeEventListener('resize', resize);
  }, []);
  useEffect(() => {
    if (pathname === '/copies') { navigate('/logs', { replace: true }); return; }
    if (pathname === '/preview/files') { navigate('/files', { replace: true }); return; }
    if (pathname.startsWith('/files')) { setWindows(old => ({ ...old, files: { ...old.files, open: true, minimized: false } })); focusApp('files'); }
    else if (apps.some(app => pathname === '/' + app.id)) {
      const id = pathname.slice(1) as AppID;
      setWindows(old => ({ ...old, [id]: { ...old[id], open: true, minimized: false } })); focusApp(id);
    }
  }, [pathname]);
  function focusApp(id: WindowID) { setActive(id); setOrder(old => old.at(-1) === id ? old : [...old.filter(item => item !== id), id]); }
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
  function finishIconDrag(commit = true) {
    const moving = drag.current; if (!moving) return;
    cancelAnimationFrame(moving.frame); moving.node.style.transform = ''; delete moving.node.dataset.dragging;
    iconGrid.current?.removeAttribute('data-dragging');
    if (moving.moved) {
      skipClick.current = true;
      if (commit) setIcons(old => { const next = dropIcon(old, moving.id, moving.cell); keep(iconKey, next); return next; });
    }
    drag.current = null;
  }
  useEffect(() => () => finishIconDrag(false), []);
  function resetIcons() { try { localStorage.removeItem(iconKey); } catch {} setIcons(initialIcons()); }
  return <main className="nas-desktop" data-theme={dark ? 'dark' : 'light'} data-window-maximized={active !== 'reader' && windows[active].open && !windows[active].minimized && windows[active].maximized} style={{ '--dock-preferred-size': dock.size + 'px' } as CSSProperties}>
    <div className="fp-wallpaper" aria-hidden="true" onClick={() => setSelectedIcon(undefined)} onContextMenu={event => {
      event.preventDefault(); const menu = desktopMenu.current!; menu.style.left = Math.min(event.clientX, innerWidth - 232) + 'px'; menu.style.top = Math.min(event.clientY, innerHeight - 145) + 'px'; menu.showPopover();
    }} />
    <div className="desktop-icons" aria-label="桌面应用" ref={iconGrid}><div className="desktop-grid" aria-hidden="true">{cells().map((cell, i) => <span key={i} style={{ left: cell.x, top: cell.y }} />)}<div ref={dropTarget} className="desktop-drop-target" /></div>{apps.map(app => <button key={app.id} type="button" className="desktop-icon" aria-label={app.title} data-selected={selectedIcon === app.id}
      style={{ left: icons[app.id].x, top: icons[app.id].y }} onClick={event => {
        if (skipClick.current) { skipClick.current = false; return; }
        setSelectedIcon(app.id); if (event.detail === 0 || matchMedia('(pointer: coarse)').matches) openApp(app.id);
      }} onDoubleClick={() => openApp(app.id)} onKeyDown={event => {
        if (!event.altKey || !event.key.startsWith('Arrow')) return;
        event.preventDefault(); const point = icons[app.id];
        const target = nearestCell({ x: point.x + (event.key === 'ArrowLeft' ? -108 : event.key === 'ArrowRight' ? 108 : 0), y: point.y + (event.key === 'ArrowUp' ? -108 : event.key === 'ArrowDown' ? 108 : 0) }, cells());
        const next = dropIcon(icons, app.id, target); setIcons(next); keep(iconKey, next);
      }} onPointerDown={event => {
        if (!event.isPrimary || event.button !== 0) return;
        setSelectedIcon(app.id); const origin = icons[app.id];
        drag.current = { id: app.id, startX: event.clientX, startY: event.clientY, origin, latest: origin, cell: origin, moved: false, frame: 0, node: event.currentTarget };
        event.currentTarget.setPointerCapture(event.pointerId);
      }} onPointerMove={event => {
        const moving = drag.current; if (!moving || moving.id !== app.id) return;
        const dx = event.clientX - moving.startX, dy = event.clientY - moving.startY;
        if (!moving.moved && Math.hypot(dx, dy) < 6) return;
        moving.moved = true;
        moving.latest = { x: moving.origin.x + dx, y: moving.origin.y + dy };
        moving.cell = nearestCell(moving.latest, cells());
        if (!moving.frame) moving.frame = requestAnimationFrame(() => {
          moving.frame = 0; moving.node.dataset.dragging = 'true';
          moving.node.style.transform = 'translate3d(' + (moving.latest.x - moving.origin.x) + 'px,' + (moving.latest.y - moving.origin.y) + 'px,0)';
          iconGrid.current?.setAttribute('data-dragging', 'true');
          if (dropTarget.current) Object.assign(dropTarget.current.style, { left: moving.cell.x + 'px', top: moving.cell.y + 'px' });
        });
      }} onPointerUp={() => finishIconDrag()} onPointerCancel={() => finishIconDrag(false)} onLostPointerCapture={() => finishIconDrag(false)} title={app.title + ' · 双击打开，Alt + 方向键移动图标'}>
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
      {app.id === 'logs' && !windows.logs.minimized && <Logs />}
      {app.id === 'downloads' && <Downloads />}
      {app.id === 'settings' && <section className="desktop-settings" aria-label="系统设置"><div className="system-settings-heading"><Icon name="settings" /><div><strong>系统设置</strong><p>管理系统外观、程序坞与桌面</p></div></div><h2>外观</h2><p>统一用于桌面、文件管理和应用窗口</p><div className="desktop-theme-options"><button type="button" aria-pressed={!dark} onClick={() => setDark(false)}><Icon name="sun" />浅色</button><button type="button" aria-pressed={dark} onClick={() => setDark(true)}><Icon name="moon" />深色</button></div><h2>程序坞</h2><label>图标大小 <span>{dock.size} px</span><input type="range" min="36" max="54" value={dock.size} onChange={event => setDock({ ...dock, size: event.currentTarget.valueAsNumber })} /></label><label>悬停放大<input type="checkbox" checked={dock.magnify} onChange={event => setDock({ ...dock, magnify: event.currentTarget.checked })} /></label><button type="button" className="desktop-secondary" onClick={() => setDock({ size: 45, magnify: true })}>恢复程序坞默认设置</button><h2>桌面图标</h2><p>拖动时显示网格，松手自动吸附；目标位置已有图标时交换位置。位置自动保存，也可用 Alt + 方向键按格移动。</p><button type="button" className="desktop-secondary" onClick={resetIcons}>重新排列图标</button></section>}
    </AppWindow>)}
    {file && <Reader key={file[3]} file={file} minimized={readerMinimized} zIndex={active === 'reader' ? 12 : 4 + order.indexOf('reader')} onFocus={() => focusApp('reader')} onMinimize={() => { setReaderMinimized(true); focusPrevious('reader'); }} onClose={() => { setFile(undefined); focusPrevious('reader'); opener.current?.focus({ preventScroll: true }); }} />}
    <div ref={desktopMenu} className="fp-context" popover="auto" role="dialog" aria-label="桌面操作"><button type="button" onClick={() => { resetIcons(); desktopMenu.current?.hidePopover(); }}><Icon name="apps" />重新排列图标</button><button type="button" onClick={() => { setDark(!dark); desktopMenu.current?.hidePopover(); }}><Icon name={dark ? 'sun' : 'moon'} />{dark ? '切换浅色外观' : '切换深色外观'}</button><hr /><button type="button" onClick={() => { openApp('settings'); desktopMenu.current?.hidePopover(); }}><Icon name="settings" />系统设置</button></div>
  </main>;
}
