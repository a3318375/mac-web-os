import { useCallback, useEffect, useRef, useState } from 'react';

export type Disk = {
  id: string;
  model: string;
  kind: 'ssd' | 'hdd' | 'unknown';
  bytes: number;
  system: boolean;
  mayWake: boolean;
  volumes: { id: string; mount: string }[];
};
export type Entry = {
  name: string;
  kind: 'directory' | 'text' | 'image' | 'video' | 'file';
  bytes: number;
  modified?: string;
  segment?: string;
  detail?: string;
};

export const fileKinds = { text: '文本文稿', image: '图像', video: '视频', file: '文件', directory: '文件夹' } as const;
export type ReadableFile = [name: string, kind: 'text' | 'image' | 'video', size: string, source: string];

export function formatBytes(bytes: number) {
  if (bytes < 1000) return bytes + ' B';
  const unit = Math.min(4, Math.floor(Math.log10(bytes) / 3));
  return new Intl.NumberFormat('zh-CN', { maximumFractionDigits: 1 }).format(bytes / 1000 ** unit) +
    ' ' + ['B', 'KB', 'MB', 'GB', 'TB'][unit];
}

export function diskName(disk: Disk) {
  return disk.system ? 'Debian 系统盘 · ' + disk.id : disk.id;
}

export function diskKind(disk: Disk) {
  const kind = { ssd: '固态硬盘', hdd: '机械硬盘', unknown: '硬盘' }[disk.kind];
  return kind + (disk.volumes.length ? '' : ' · 未挂载');
}

export async function apiResponse<T>(url: string, signal?: AbortSignal): Promise<T> {
  const response = await fetch(url, { signal });
  if (!response.headers.get('Content-Type')?.includes('application/json')) throw new Error('无法连接 Go 后端。');
  const result = await response.json();
  if (!response.ok) throw new Error(result.error || '读取失败。');
  return result;
}

export function diskURL(disk: Disk, path: string, action: 'entries' | 'file', confirmed: boolean) {
  const parts = path.split('/').slice(1);
  const volume = disk.volumes.length === 1 ? disk.volumes[0] : disk.volumes.find(candidate => candidate.id === parts[0]);
  if (!volume) return;
  const relative = (disk.volumes.length > 1 ? parts.slice(1) : parts).join('/');
  const params = new URLSearchParams({ volume: volume.id, path: relative });
  if (confirmed) params.set('confirmed', '1');
  return '/api/disks/' + encodeURIComponent(disk.id) + '/' + action + '?' + params;
}

export function useDisks() {
  const [disks, setDisks] = useState<Disk[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const request = useRef<AbortController>(null);

  const refresh = useCallback(() => {
    request.current?.abort();
    const controller = new AbortController();
    request.current = controller;
    setLoading(true);
    setError('');
    return apiResponse<Disk[]>('/api/disks', controller.signal)
      .then(result => { if (!controller.signal.aborted) setDisks(result); })
      .catch(reason => {
        if (!controller.signal.aborted) {
          setDisks([]);
          setError(reason instanceof Error ? reason.message : '无法读取硬盘。');
        }
      }).finally(() => { if (!controller.signal.aborted) setLoading(false); });
  }, []);

  useEffect(() => {
    void refresh();
    return () => request.current?.abort();
  }, [refresh]);

  return { disks, loading, error, refresh };
}
