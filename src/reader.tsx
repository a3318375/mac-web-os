import { useId, useLayoutEffect, useRef, useState } from 'react';
import type { PointerEvent } from 'react';
import { fileKinds } from './disks';
import type { ReadableFile } from './disks';
import FileText from './file-text';
import './reader.css';

type Point = { x: number; y: number };
type ReaderProps = {
  file: ReadableFile;
  minimized: boolean;
  onMinimize: () => void;
  onClose: () => void;
};

function fit(point: Point, bounds: DOMRect): Point {
  return {
    x: Math.max(0, Math.min(point.x, document.documentElement.clientWidth - bounds.width)),
    y: Math.max(0, Math.min(point.y, document.documentElement.clientHeight - bounds.height)),
  };
}

const controlPaths = {
  minimize: 'M3 8h10',
  maximize: 'M3 3h10v10H3z',
  restore: 'M3 5h8v8H3zM5 5V3h8v8h-2',
  close: 'm3.5 3.5 9 9m0-9-9 9',
};

const fileIcons = {
  text: 'M6 3h8l4 4v14H6zM14 3v5h4M9 12h6m-6 4h6',
  image: 'M3 4h18v16H3zM3 17l6-6 4 4 3-3 5 5m-6-9h.1',
  video: 'M3 4h18v16H3zM10 8l6 4-6 4z',
};

function WindowControl({ icon, label, action }: { icon: keyof typeof controlPaths; label: string; action: () => void }) {
  return <button type="button" aria-label={label} title={label} data-action={icon} onClick={action}>
    <svg viewBox="0 0 16 16" aria-hidden="true"><path d={controlPaths[icon]} /></svg>
  </button>;
}

export default function Reader({ file, minimized, onMinimize, onClose }: ReaderProps) {
  const [name, kind, size, source] = file;
  const titleId = useId();
  const windowRef = useRef<HTMLElement>(null);
  const videoRef = useRef<HTMLVideoElement>(null);
  const drag = useRef<{ id: number; offset: Point } | null>(null);
  const [position, setPosition] = useState<Point>();
  const [maximized, setMaximized] = useState(false);
  const [failedVideo, setFailedVideo] = useState<string>();

  useLayoutEffect(() => {
    if (minimized) videoRef.current?.pause();
    else windowRef.current?.focus({ preventScroll: true });
  }, [file, minimized]);

  useLayoutEffect(() => {
    const video = videoRef.current;
    return () => video?.pause();
  }, [source]);

  useLayoutEffect(() => {
    if (maximized || minimized) return;
    const clamp = () => {
      const bounds = windowRef.current?.getBoundingClientRect();
      if (bounds) setPosition(point => point && fit(point, bounds));
    };
    clamp();
    window.addEventListener('resize', clamp);
    return () => window.removeEventListener('resize', clamp);
  }, [maximized, minimized]);

  function startDrag(event: PointerEvent<HTMLDivElement>) {
    if (maximized || !event.isPrimary || event.button !== 0) return;
    const bounds = windowRef.current!.getBoundingClientRect();
    event.currentTarget.setPointerCapture(event.pointerId);
    drag.current = { id: event.pointerId, offset: { x: event.clientX - bounds.left, y: event.clientY - bounds.top } };
  }

  function moveDrag(event: PointerEvent<HTMLDivElement>) {
    const active = drag.current;
    if (active?.id !== event.pointerId) return;
    setPosition(fit({ x: event.clientX - active.offset.x, y: event.clientY - active.offset.y },
      windowRef.current!.getBoundingClientRect()));
  }

  const toggleMaximized = () => setMaximized(value => !value);

  return <section className="reader-window" role="dialog" aria-labelledby={titleId} tabIndex={-1}
    ref={windowRef} hidden={minimized} data-maximized={maximized}
    style={position && !maximized ? { left: position.x, top: position.y, translate: 'none' } : undefined}
    onKeyDown={event => { if (event.key === 'Escape') onClose(); }}>
    <header className="reader-titlebar">
      <div className="reader-drag" onPointerDown={startDrag} onPointerMove={moveDrag}
        onLostPointerCapture={() => { drag.current = null; }} onDoubleClick={toggleMaximized}>
        <svg viewBox="0 0 24 24" aria-hidden="true">
          <path d={fileIcons[kind]} />
        </svg>
        <h2 id={titleId}>{name}</h2>
      </div>
      <div className="reader-controls" role="group" aria-label="窗口控制">
        <WindowControl icon="minimize" label="最小化" action={onMinimize} />
        <WindowControl icon={maximized ? 'restore' : 'maximize'} label={maximized ? '还原窗口' : '最大化'} action={toggleMaximized} />
        <WindowControl icon="close" label="关闭阅读窗口" action={onClose} />
      </div>
    </header>
    {kind === 'image'
      ? <div className="reader-image"><img src={source} alt={name} draggable={false} /></div>
      : kind === 'video' ? <div className="reader-image reader-video">
        {failedVideo === source
          ? <p role="status">无法播放此视频。你可以下载文件后用本地播放器打开。</p>
          : <video ref={videoRef} src={source} controls playsInline preload="metadata" aria-label={name}
            onError={() => setFailedVideo(source)} />}
      </div> : <div className="reader-text" tabIndex={0} aria-label="文本文稿"><FileText key={source} source={source} /></div>}
    <footer className="reader-footer"><span>{fileKinds[kind]} · {size}</span>
      <a href={source + '&download=1'} download={name}>下载文件</a>
    </footer>
  </section>;
}
