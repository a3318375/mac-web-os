import { useEffect, useRef, useState } from 'react';
import AppWindow from './app-window';
import { fileKinds } from './disks';
import type { ReadableFile } from './disks';
import FileText from './file-text';
import './reader.css';

export default function Reader({ file, minimized, zIndex, onFocus, onMinimize, onClose }: { file: ReadableFile; minimized: boolean; zIndex: number; onFocus: () => void; onMinimize: () => void; onClose: () => void }) {
  const [name, kind, size, source] = file;
  const videoRef = useRef<HTMLVideoElement>(null);
  const [maximized, setMaximized] = useState(false);
  const [failedVideo, setFailedVideo] = useState<string>();
  useEffect(() => { if (minimized) videoRef.current?.pause(); }, [minimized]);
  return <AppWindow id="reader" title={name} icon={kind === 'text' ? 'text' : kind} minimized={minimized} maximized={maximized} zIndex={zIndex}
    onFocus={onFocus} onMinimize={onMinimize} onMaximize={() => setMaximized(!maximized)} onClose={onClose}>
    <div className="reader-body">
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
    </div>
  </AppWindow>;
}
