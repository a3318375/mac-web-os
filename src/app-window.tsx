import { useEffect, useRef, useState } from 'react';
import type { ReactNode } from 'react';
import { Folder, Icon } from './ui';
import type { IconName } from './ui';

export default function AppWindow({ id, title, icon, minimized, maximized, zIndex, onFocus, onMinimize, onMaximize, onClose, children }: {
  id: string; title: string; icon: IconName; minimized: boolean; maximized: boolean; zIndex: number;
  onFocus: () => void; onMinimize: () => void; onMaximize: () => void; onClose: () => void; children: ReactNode;
}) {
  const ref = useRef<HTMLElement>(null);
  const drag = useRef<{ x: number; y: number } | null>(null);
  const [position, setPosition] = useState<{ x: number; y: number }>();
  function fit(x: number, y: number) {
    const rect = ref.current!.getBoundingClientRect();
    return { x: Math.max(0, Math.min(x, innerWidth - rect.width)), y: Math.max(0, Math.min(y, innerHeight - rect.height)) };
  }
  useEffect(() => {
    if (minimized || maximized) return;
    const resize = () => setPosition(old => old && fit(old.x, old.y));
    resize();
    window.addEventListener('resize', resize);
    return () => window.removeEventListener('resize', resize);
  }, [minimized, maximized]);
  useEffect(() => { if (!minimized) ref.current?.focus({ preventScroll: true }); }, [minimized]);
  return <section className="fp-window app-window" data-app={id} data-maximized={maximized} data-active={zIndex >= 10}
    role={id === 'reader' ? 'dialog' : undefined} aria-label={id === 'reader' ? title : title + '窗口'} tabIndex={-1} ref={ref} hidden={minimized} onPointerDownCapture={onFocus} onFocusCapture={onFocus}
    onKeyDown={event => { if (id === 'reader' && event.key === 'Escape') onClose(); }}
    style={{ zIndex, ...(position && !maximized ? { left: position.x, top: position.y } : {}) }}>
    <header className="fp-titlebar">
      <div className="fp-window-drag" tabIndex={0} aria-label={title + '标题栏，Alt 加方向键移动窗口'}
        onDoubleClick={onMaximize} onKeyDown={event => {
          if (!event.altKey || !event.key.startsWith('Arrow') || maximized) return;
          event.preventDefault(); const rect = ref.current!.getBoundingClientRect();
          setPosition(fit(rect.left + (event.key === 'ArrowLeft' ? -24 : event.key === 'ArrowRight' ? 24 : 0), rect.top + (event.key === 'ArrowUp' ? -24 : event.key === 'ArrowDown' ? 24 : 0)));
        }} onPointerDown={event => {
          if (maximized || event.button !== 0 || !event.isPrimary) return;
          const rect = ref.current!.getBoundingClientRect(); drag.current = { x: event.clientX - rect.left, y: event.clientY - rect.top };
          event.currentTarget.setPointerCapture(event.pointerId);
        }} onPointerMove={event => {
          if (drag.current) setPosition(fit(event.clientX - drag.current.x, event.clientY - drag.current.y));
        }} onLostPointerCapture={() => { drag.current = null; }}>
        {icon === 'folder' ? <Folder small /> : <Icon name={icon} />}<h1>{title}</h1>
      </div>
      <div className="fp-window-controls">
        <button type="button" aria-label={'最小化' + title} onClick={onMinimize}><Icon name="minimize" /></button>
        <button type="button" aria-label={(maximized ? '还原' : '最大化') + title} onClick={onMaximize}><Icon name="maximize" /></button>
        <button type="button" aria-label={'关闭' + title} onClick={onClose}><Icon name="close" /></button>
      </div>
    </header>
    <div className="app-window-body">{children}</div>
  </section>;
}
