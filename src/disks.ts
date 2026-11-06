import { useCallback, useEffect, useRef, useState } from 'react';

export type Disk = {
  id: string;
  model: string;
  kind: 'ssd' | 'hdd' | 'unknown';
  bytes: number;
  unallocated?: number;
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
export type FileLocation = { disk: string; volume: string; path: string; confirmed: boolean };
const diskNames = new Intl.Collator('zh-CN', { numeric: true });

export function formatBytes(bytes: number) {
  if (bytes < 1000) return bytes + ' B';
  const unit = Math.min(4, Math.floor(Math.log10(bytes) / 3));
  return new Intl.NumberFormat('zh-CN', { maximumFractionDigits: 1 }).format(bytes / 1000 ** unit) +
    ' ' + ['B', 'KB', 'MB', 'GB', 'TB'][unit];
}

export function diskName(disk: Disk) {
  if (disk.system) return 'system';
  return disk.volumes[0]?.mount.split('/').filter(Boolean).at(-1) ?? disk.id;
}

export function compareDisks(a: Disk, b: Disk, descending = false) {
  return Number(b.system) - Number(a.system) ||
    Number(b.volumes.length > 0) - Number(a.volumes.length > 0) ||
    diskNames.compare(diskName(a), diskName(b)) * (descending ? -1 : 1);
}

export function systemRoot(disk?: Disk) {
  return disk?.system ? disk.volumes.find(volume => volume.mount === '/') : undefined;
}

export function diskKind(disk: Disk) {
  const kind = { ssd: '固态硬盘', hdd: '机械硬盘', unknown: '硬盘' }[disk.kind];
  return kind + (disk.volumes.length ? '' : ' · 未挂载');
}

export async function apiResponse<T>(url: string, init?: RequestInit): Promise<T> {
  const response = await fetch(url, init);
  if (!response.headers.get('Content-Type')?.includes('application/json')) throw new Error('无法连接 Go 后端。');
  const result = await response.json();
  if (!response.ok) throw new Error(result.error || '读取失败。');
  return result;
}

export function diskLocation(disk: Disk, path: string, confirmed: boolean): FileLocation | undefined {
  const parts = path.split('/').slice(1);
  const volume = disk.volumes.length === 1 ? disk.volumes[0]
    : parts.length ? disk.volumes.find(candidate => candidate.id === parts[0]) : systemRoot(disk);
  if (!volume) return;
  return { disk: disk.id, volume: volume.id, path: (disk.volumes.length > 1 ? parts.slice(1) : parts).join('/'), confirmed };
}

export function diskURL(disk: Disk, path: string, action: 'entries' | 'file', confirmed: boolean) {
  const location = diskLocation(disk, path, confirmed);
  if (!location) return;
  const params = new URLSearchParams({ volume: location.volume, path: location.path });
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
    return apiResponse<Disk[]>('/api/disks', { signal: controller.signal })
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
