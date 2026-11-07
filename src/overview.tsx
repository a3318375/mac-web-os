import { useEffect, useId, useState } from 'react';
import { apiResponse, compareDisks, diskName, formatBytes } from './disks';
import type { Disk, useDisks } from './disks';
import './overview.css';

function HddWakeLog() {
  const [entries, setEntries] = useState<string[]>();
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    const controller = new AbortController();
    apiResponse<string[]>('/api/system/hdd-wake-log', { signal: controller.signal })
      .then(setEntries)
      .catch(() => { if (!controller.signal.aborted) setFailed(true); });
    return () => controller.abort();
  }, []);

  return <section className="overview-panel" aria-labelledby="hdd-wake-title">
    <div className="overview-panel-head"><h2 id="hdd-wake-title">硬盘唤醒与休眠</h2></div>
    {entries?.length ? <ul className="overview-wake-log">{entries.map((entry, index) => {
      const match = entry.match(/^(\S+) .*?hdd-power(?:\[\d+\])?: (.+) \((\/dev\/[^)]+)\): (standby -> active\/idle|active\/idle -> standby)$/);
      if (!match) return <li key={index}>{entry}</li>;
      const [, timestamp, volume, device, transition] = match;
      const awake = transition.startsWith('standby');
      return <li key={index}>
        <time dateTime={timestamp}>{timestamp.slice(0, 19).replace('T', ' ')}</time>
        <span><strong>{volume}</strong> <small>{device}</small></span>
        <span className="overview-wake-state" data-awake={awake}>{awake ? '被唤醒' : '进入休眠'}</span>
      </li>;
    })}</ul> :
      <p className="overview-note" role="status">{failed ? '无法读取硬盘唤醒记录。' :
        entries ? '暂无硬盘唤醒记录。' : '正在读取硬盘唤醒记录…'}</p>}
  </section>;
}

type Snapshot = {
  at: number;
  cpu: { busy: number; idle: number; logical: number };
  memory: { total: number; available: number };
  network: { name: string; rx: number; tx: number }[];
};
type Sensor = { name: string; kind: 'cpu' | 'memory' | 'fan'; value: number };
type DiskDetails = {
  at: number;
  space: { mount: string; used: number; free: number }[];
  skipped: number;
  smart?: { passed?: boolean; temperature?: number; cycles?: number; hours?: number; wear?: number };
  smartError?: string;
};
const sampleInterval = 2000;

function useOverviewReading<T>(url?: string) {
  const [reading, setReading] = useState<T>();
  const [error, setError] = useState('');
  useEffect(() => {
    if (!url) return;
    const request = new AbortController();
    const start = window.setTimeout(() => {
      apiResponse<T>(url, { signal: AbortSignal.any([request.signal, AbortSignal.timeout(12000)]) })
        .then(result => { if (!request.signal.aborted) setReading(result); })
        .catch(reason => {
          if (!request.signal.aborted) setError(reason instanceof Error ? reason.message : '读取失败。');
        });
    }, 0);
    return () => { window.clearTimeout(start); request.abort(); };
  }, [url]);
  return { reading, error };
}

function useMetrics() {
  const [sample, setSample] = useState<{ current: Snapshot; previous?: Snapshot }>();
  const [error, setError] = useState('');

  useEffect(() => {
    let controller: AbortController;
    let timer: number | undefined;
    let previous: Snapshot | undefined;

    async function poll(request: AbortController) {
      try {
        const current = await apiResponse<Snapshot>('/api/system/metrics', {
          signal: AbortSignal.any([request.signal, AbortSignal.timeout(5000)]),
        });
        if (request.signal.aborted) return;
        const elapsed = previous ? current.at - previous.at : 0;
        const prior = elapsed > 0 && elapsed <= 3 * sampleInterval ? previous : undefined;
        setSample({ current, previous: prior });
        setError('');
        previous = current;
      } catch (reason) {
        if (request.signal.aborted) return;
        setSample(undefined);
        setError(reason instanceof Error ? reason.message : '暂时无法读取系统指标。');
        previous = undefined;
      } finally {
        if (!request.signal.aborted) timer = window.setTimeout(() => void poll(request), sampleInterval);
      }
    }

    function visibilityChanged() {
      controller?.abort();
      window.clearTimeout(timer);
      previous = undefined;
      if (!document.hidden) {
        controller = new AbortController();
        void poll(controller);
      }
    }

    visibilityChanged();
    document.addEventListener('visibilitychange', visibilityChanged);
    return () => {
      document.removeEventListener('visibilitychange', visibilityChanged);
      controller?.abort();
      window.clearTimeout(timer);
    };
  }, []);

  return { sample, error };
}

function cpuPercent(current: Snapshot, previous?: Snapshot) {
  if (!previous || current.cpu.logical !== previous.cpu.logical) return null;
  const busy = current.cpu.busy - previous.cpu.busy;
  const idle = current.cpu.idle - previous.cpu.idle;
  return busy >= 0 && idle >= 0 && busy + idle > 0 ? busy / (busy + idle) * 100 : null;
}

function memoryPercent({ memory }: Snapshot) {
  return (memory.total - memory.available) / memory.total * 100;
}

function rate(bytes?: number, previous?: number, seconds = 0) {
  return bytes === undefined || previous === undefined || bytes < previous || seconds <= 0
    ? '—' : `${formatBytes(Math.round((bytes - previous) / seconds))}/s`;
}

const percentLabel = (value: number | null) => value === null ? '—' : `${value.toFixed(1)}%`;
const clock = new Intl.DateTimeFormat('zh-CN', { hour: '2-digit', minute: '2-digit', second: '2-digit' });
const temp = (value?: number) => value === undefined ? '—' : `${Math.round(value)} °C`;
const icons = {
  cpu: 'M8 6h8a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2Zm2 4h4v4h-4zM9 3v3m6-3v3M9 18v3m6-3v3M3 9h3m-3 6h3m12-6h3m-3 6h3',
  memory: 'M4 6h16v11H4zM7 17v3m5-3v3m5-3v3M8 10h2v3H8zm6 0h2v3h-2z',
  network: 'M8 19V5m-4 4 4-4 4 4m4-4v14m-4-4 4 4 4-4',
  temperature: 'M10 14.5V5a2 2 0 1 1 4 0v9.5a4 4 0 1 1-4 0ZM12 10v7',
  fan: 'M12 10c-2-1-3-5-1-7 3 0 5 3 3 7m0 2c2-1 6 0 7 3-2 3-5 3-8-1m-2 0c0 3-2 6-5 6-2-2-1-5 3-8m5 0a2 2 0 1 1-4 0 2 2 0 0 1 4 0Z',
  disk: 'M4 14h16M4 14l2-7a2 2 0 0 1 2-1h8a2 2 0 0 1 2 1l2 7v3a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2Zm12 2.5h1',
};

function Icon({ name }: { name: keyof typeof icons }) {
  return <span className={`overview-icon overview-icon-${name}`} aria-hidden="true">
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round"><path d={icons[name]} /></svg>
  </span>;
}

function Drive({ disk }: { disk: Disk }) {
  const panelId = useId();
  const [expanded, setExpanded] = useState(false);
  const protectedDisk = disk.kind !== 'ssd';
  const { reading: details, error } = useOverviewReading<DiskDetails>(protectedDisk ? undefined :
    `/api/system/disks/${encodeURIComponent(disk.id)}/details`);

  const used = details?.space.reduce((total, volume) => total + volume.used, 0) ?? 0;
  const free = details?.space.reduce((total, volume) => total + volume.free, 0) ?? 0;
  const unallocated = disk.unallocated ?? 0;
  const scale = Math.max(disk.bytes, used + free + unallocated, 1);
  const smart = details?.smart;
  const formatCount = (value: number | undefined, unit: string) => value === undefined ? '—' : `${value.toLocaleString('zh-CN')} ${unit}`;
  const spaceKnown = !!details?.space.length;
  return <li className="overview-drive">
    <div className="overview-drive-row">
      <div className="overview-drive-id">
        <Icon name="disk" />
        <div className="overview-disk-name"><strong>{diskName(disk)} <small>{disk.kind === 'ssd' ? 'SSD' : disk.kind === 'hdd' ? '机械盘' : '类型未知'}</small></strong>
          <span>{[disk.id, disk.model].filter(Boolean).join(' · ')}</span></div>
      </div>
      <div className="overview-drive-space">
        <div className="overview-capacity" aria-hidden="true">
          <span className="space-used" style={{ width: `${used / scale * 100}%` }} />
          <span className="space-free" style={{ width: `${free / scale * 100}%` }} />
          <span className="space-unmeasured" />
          <span className="space-unallocated" style={{ width: `${unallocated / scale * 100}%` }} />
        </div>
        <div className="overview-space-labels">
          {spaceKnown ? <><span data-space="used">已用 {formatBytes(used)}</span><span data-space="free">空闲 {formatBytes(free)}</span></> :
            <span>{protectedDisk ? '休眠保护 · 用量未读取' : error ? '容量读取失败' : !details ? '正在读取容量…' : disk.volumes.length ? '挂载卷用量不可用' : '未挂载'}</span>}
          {unallocated > 0 && <span data-space="unallocated">未分配 {formatBytes(unallocated)}</span>}
        </div>
      </div>
      <div className="overview-drive-end">
        <div className="overview-disk-size"><strong>{disk.bytes ? formatBytes(disk.bytes) : '—'}</strong>
          {smart?.temperature !== undefined && <span>{temp(smart.temperature)}</span>}</div>
        <button className="overview-button overview-disclosure" aria-expanded={expanded} aria-controls={panelId} onClick={() => setExpanded(!expanded)} type="button">
          详情 <span aria-hidden="true" />
        </button>
      </div>
    </div>
    <div className="overview-drive-detail" id={panelId} hidden={!expanded}>
      {protectedDisk ? <>
        <p className="overview-note">休眠保护已开启。概览仅读取内核记录的分区和挂载信息，已用空间、空闲空间、温度和 SMART 留空。</p>
        {disk.volumes.map(volume => <p className="overview-volume" key={volume.id}><code>{volume.mount}</code><span>已挂载</span></p>)}
      </> :
        error ? <p className="overview-note" role="status">{error}</p> : !details ? <p className="overview-note">正在读取硬盘详情…</p> : <>
          <dl className="overview-health">
            <div><dt>SMART 健康状态</dt><dd data-health={smart?.passed}>{smart?.passed === true ? '通过' : smart?.passed === false ? '异常' : '—'}</dd></div>
            <div><dt>温度</dt><dd>{temp(smart?.temperature)}</dd></div>
            <div><dt>通电次数</dt><dd>{formatCount(smart?.cycles, '次')}</dd></div>
            <div><dt>通电时长</dt><dd>{formatCount(smart?.hours, '小时')}</dd></div>
            {smart?.wear !== undefined && <div><dt>耐久度已用</dt><dd>{smart.wear}%</dd></div>}
          </dl>
          {details.smartError && <p className="overview-note">{details.smartError}</p>}
          {details.space.map(volume => <p className="overview-volume" key={volume.mount}><code>{volume.mount}</code>
            <span>已用 {formatBytes(volume.used)} · 空闲 {formatBytes(volume.free)}</span></p>)}
          {details.skipped > 0 && <p className="overview-note">部分挂载卷无法安全归属或读取，容量条仅计入已统计的卷。</p>}
          <p className="overview-note">本次进入页面读取于 {clock.format(details.at)}</p>
        </>}
    </div>
  </li>;
}

function SensorCards() {
  const { reading: sensors, error } = useOverviewReading<Sensor[]>('/api/system/sensors');
  const cards = [
    { title: 'CPU 温度', kind: 'cpu', icon: 'temperature', preferred: /^(Package\b|Tdie$)/i },
    { title: '内存温度', kind: 'memory', icon: 'temperature' },
    { title: '风扇转速', kind: 'fan', icon: 'fan', preferred: /^CPU/i },
  ] as const;

  return cards.map(card => {
    const readings = (sensors ?? []).filter(sensor => sensor.kind === card.kind).sort((a, b) => b.value - a.value);
    const preferred = 'preferred' in card ? card.preferred : undefined;
    const reading = readings.find(sensor => preferred?.test(sensor.name)) ?? readings[0];
    const value = card.kind === 'fan' && reading ? `${reading.value} RPM` : temp(reading?.value);
    return <section className="overview-panel overview-metric" key={card.kind}>
      <div className="overview-metric-head"><Icon name={card.icon} /><h2>{card.title}</h2></div>
      <div className="overview-value">{value}</div>
      <p className="overview-note">{error || (reading ? `进页采样 · ${reading.name}` : sensors ? '未检测到传感器' : '正在读取传感器…')}</p>
    </section>;
  });
}

export default function Overview({ inventory }: { inventory: ReturnType<typeof useDisks> }) {
  const { sample, error } = useMetrics();
  const [interfaceName, setInterfaceName] = useState('');
  const current = sample?.current;
  const previous = sample?.previous;
  const network = current?.network.find(item => item.name === interfaceName) ?? current?.network[0];
  const priorNetwork = previous?.network.find(item => item.name === network?.name);
  const seconds = current && previous ? (current.at - previous.at) / 1000 : 0;
  const { disks, loading, error: diskError, refresh } = inventory;

  return <section className="overview" aria-label="系统概览">
    <div className="overview-content">
      <div className="overview-section-head">
        <h1>资源概况</h1>
        <p className="overview-status" data-state={error ? 'error' : current ? 'live' : 'waiting'}>
          <span aria-hidden="true" />{error || (current ? `最近更新 ${clock.format(current.at)}` : '正在连接系统监控…')}
        </p>
      </div>
      <div className="overview-metrics">
        {([
          { name: 'cpu', title: 'CPU 使用率', value: current ? cpuPercent(current, previous) : null,
            detail: current ? `${current.cpu.logical} 个逻辑核心${previous ? '' : ' · 等待下一次采样'}` : '全机 CPU' },
          { name: 'memory', title: '内存使用率', value: current ? memoryPercent(current) : null,
            detail: current ? `${formatBytes(current.memory.total - current.memory.available)} / ${formatBytes(current.memory.total)}` : '已用 / 总内存' },
        ] as const).map(metric => <section className="overview-panel overview-metric" key={metric.name}>
          <div className="overview-metric-head"><Icon name={metric.name} /><h2>{metric.title}</h2></div>
          <div className="overview-value">{percentLabel(metric.value)}</div>
          <div className={`overview-meter overview-series-${metric.name}`} aria-hidden="true"><span style={{ width: `${metric.value ?? 0}%` }} /></div>
          <p className="overview-note">{metric.detail}</p>
        </section>)}
        <section className="overview-panel overview-metric">
          <div className="overview-metric-head"><Icon name="network" /><h2>网络速率</h2>
            {network && <select aria-label="监控网卡" value={network.name} onChange={event => setInterfaceName(event.target.value)}>
              {current?.network.map(item => <option key={item.name} value={item.name}>{item.name}</option>)}
            </select>}
          </div>
          <dl className="overview-network">
            <div><dt><span aria-hidden="true">↓</span> 接收</dt><dd>{rate(network?.rx, priorNetwork?.rx, seconds)}</dd></div>
            <div><dt><span aria-hidden="true">↑</span> 发送</dt><dd>{rate(network?.tx, priorNetwork?.tx, seconds)}</dd></div>
          </dl>
          <p className="overview-note">{current && !network ? '未发现非回环网卡' : network && !priorNetwork ? '等待下一次采样' : '所选网卡的收发速度'}</p>
        </section>
        <SensorCards />
      </div>
      <div className="overview-details">
        <section className="overview-panel" aria-labelledby="storage-title">
          <div className="overview-panel-head"><div className="overview-storage-title"><h2 id="storage-title">物理硬盘</h2>
            {!diskError && (!loading || disks.length > 0) && <span>{disks.length} 块</span>}</div>
            <button className="overview-button" type="button" disabled={loading} onClick={() => void refresh()}>{loading ? '读取中…' : '刷新硬盘'}</button>
          </div>
          <p className="overview-note">容量条按物理容量显示已统计的文件系统用量和分区外空间。固态盘详情只在进入页面时读取，机械盘保持休眠保护。</p>
          {diskError ? <p className="overview-disk-message" role="status">{diskError}</p> : !disks.length ?
            <p className="overview-disk-message">{loading ? '正在读取硬盘清单…' : '未发现物理硬盘。'}</p> :
            <ul className="overview-disks">{[...disks].sort((a, b) => compareDisks(a, b)).map(disk =>
              <Drive disk={disk} key={`${disk.id}:${disk.kind}:${disk.model}:${disk.bytes}`} />)}</ul>}
        </section>
        <HddWakeLog />
      </div>
    </div>
  </section>;
}
