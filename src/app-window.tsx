import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import type { ReactNode, PointerEvent as ReactPointerEvent } from 'react';
import { Folder, Icon } from './ui';
import type { IconName } from './ui';
import { fitWindow, resizeWindow } from './window-geometry';
import type { Edge, Geometry } from './window-geometry';

const viewport = () => ({ width: innerWidth, height: innerHeight });
const edges: Edge[] = ['n', 'ne', 'e', 'se', 's', 'sw', 'w', 'nw'];

export default function AppWindow({ id, title, icon, minimized, maximized, zIndex, onFocus, onMinimize, onMaximize, onClose, children }: {
  id: string; title: string; icon: IconName; minimized: boolean; maximized: boolean; zIndex: number;
  onFocus: () => void; onMinimize: () => void; onMaximize: () => void; onClose: () => void; children: ReactNode;
}) {
  const ref = useRef<HTMLElement>(null);
  const [geometry, setGeometry] = useState<Geometry>();
  const interaction = useRef<{ start: Geometry; next: Geometry; x: number; y: number; edge?: Edge; frame: number; cursor: string } | null>(null);
  function paint() {
    const moving = interaction.current, node = ref.current;
    if (!moving || !node) return;
    moving.frame = 0;
    const { next, start, edge } = moving;
    if (!edge) node.style.transform = `translate3d(${next.x - start.x}px, ${next.y - start.y}px, 0)`;
    else Object.assign(node.style, { left: next.x + 'px', top: next.y + 'px', width: next.width + 'px', height: next.height + 'px' });
  }
  function finish(commit = true) {
    const moving = interaction.current, node = ref.current;
    if (!moving) return;
    cancelAnimationFrame(moving.frame);
    document.documentElement.style.cursor = moving.cursor;
    interaction.current = null;
    if (node) {
      node.style.transform = '';
      Object.assign(node.style, { left: moving.next.x + 'px', top: moving.next.y + 'px', width: moving.next.width + 'px', height: moving.next.height + 'px' });
      delete node.dataset.interaction;
    }
    if (commit) setGeometry(moving.next);
  }
  function start(event: ReactPointerEvent<HTMLElement>, edge?: Edge) {
    if (maximized || event.button !== 0 || !event.isPrimary) return;
    const node = ref.current!, rect = node.getBoundingClientRect();
    const start = fitWindow({ x: rect.left, y: rect.top, width: rect.width, height: rect.height }, viewport());
    // Freeze CSS defaults once; movement writes DOM at most once per animation frame.
    Object.assign(node.style, { left: start.x + 'px', top: start.y + 'px', width: start.width + 'px', height: start.height + 'px' });
    interaction.current = { start, next: start, x: event.clientX, y: event.clientY, edge, frame: 0, cursor: document.documentElement.style.cursor };
    node.dataset.interaction = edge ? 'resize' : 'drag';
    document.documentElement.style.cursor = edge ? edge + '-resize' : 'grabbing';
    window.getSelection()?.removeAllRanges();
    event.currentTarget.setPointerCapture(event.pointerId);
    event.preventDefault();
  }
  function move(event: ReactPointerEvent<HTMLElement>) {
    const moving = interaction.current;
    if (!moving) return;
    const dx = event.clientX - moving.x, dy = event.clientY - moving.y;
    moving.next = moving.edge ? resizeWindow(moving.start, moving.edge, dx, dy, viewport()) : fitWindow({ ...moving.start, x: moving.start.x + dx, y: moving.start.y + dy }, viewport());
    if (!moving.frame) moving.frame = requestAnimationFrame(paint);
  }
  useLayoutEffect(() => {
    if (minimized || maximized) { finish(); return; }
    const resize = () => {
      finish();
      const rect = ref.current!.getBoundingClientRect();
      setGeometry(fitWindow({ x: rect.left, y: rect.top, width: rect.width, height: rect.height }, viewport()));
    };
    resize();
    window.addEventListener('resize', resize);
    return () => window.removeEventListener('resize', resize);
  }, [minimized, maximized]);
  useEffect(() => () => finish(false), []);
  useEffect(() => { if (!minimized) ref.current?.focus({ preventScroll: true }); }, [minimized]);
  return <section className="fp-window app-window" data-app={id} data-maximized={maximized} data-active={zIndex === 12}
    role={id === 'reader' ? 'dialog' : undefined} aria-label={id === 'reader' ? title : title + '窗口'} tabIndex={-1} ref={ref} hidden={minimized} onPointerDownCapture={onFocus} onFocusCapture={onFocus}
    onKeyDown={event => { if (id === 'reader' && event.key === 'Escape') onClose(); }}
    style={{ zIndex, ...(!maximized && geometry ? { left: geometry.x, top: geometry.y, width: geometry.width, height: geometry.height } : {}) }}>
    <header className="fp-titlebar">
      <div className="fp-window-drag" tabIndex={0} aria-label={title + '标题栏，Alt 加方向键移动，Alt Shift 加方向键缩放'}
        onDoubleClick={onMaximize} onKeyDown={event => {
          if (!event.altKey || !event.key.startsWith('Arrow') || maximized) return;
          event.preventDefault(); const rect = ref.current!.getBoundingClientRect();
          const current = { x: rect.left, y: rect.top, width: rect.width, height: rect.height };
          const dx = event.key === 'ArrowLeft' ? -24 : event.key === 'ArrowRight' ? 24 : 0, dy = event.key === 'ArrowUp' ? -24 : event.key === 'ArrowDown' ? 24 : 0;
          setGeometry(event.shiftKey ? resizeWindow(current, 'se', dx, dy, viewport()) : fitWindow({ ...current, x: current.x + dx, y: current.y + dy }, viewport()));
        }} onPointerDown={event => start(event)} onPointerMove={move} onPointerUp={() => finish()} onPointerCancel={() => finish()} onLostPointerCapture={() => finish()}>
        {icon === 'folder' ? <Folder small /> : <Icon name={icon} />}<h1>{title}</h1>
      </div>
      <div className="fp-window-controls">
        <button type="button" aria-label={'最小化' + title} onClick={onMinimize}><Icon name="minimize" /></button>
        <button type="button" aria-label={(maximized ? '还原' : '最大化') + title} onClick={onMaximize}><Icon name="maximize" /></button>
        <button type="button" aria-label={'关闭' + title} onClick={onClose}><Icon name="close" /></button>
      </div>
    </header>
    <div className="app-window-body">{children}</div>
    {!maximized && edges.map(edge => <div key={edge} className="window-resize" data-edge={edge} aria-hidden="true" onPointerDown={event => start(event, edge)} onPointerMove={move} onPointerUp={() => finish()} onPointerCancel={() => finish()} onLostPointerCapture={() => finish()} />)}
  </section>;
}
