import { useEffect, useState } from 'react';
import { apiResponse, formatBytes } from './disks';
import './task-manager.css';

type Process = {
  pid: number; name: string; state: string; uid: string; threads: number;
  memory: number; ticks: number; started: number;
};
type Snapshot = {
  at: number;
  cpu: { busy: number; idle: number; logical: number };
  memory: { total: number; available: number };
  processes: Process[];
  skipped: number;
};
type Row = Process & { cpu: number | null };
type SortKey = 'name' | 'pid' | 'cpu' | 'memory' | 'threads' | 'uid' | 'state';
const columns: { key: SortKey; label: string }[] = [
  { key: 'name', label: '进程名称' }, { key: 'pid', label: 'PID' },
  { key: 'cpu', label: 'CPU %' }, { key: 'memory', label: '内存 (RSS)' },
  { key: 'threads', label: '线程' }, { key: 'uid', label: '用户 UID' }, { key: 'state', label: '状态' },
];
const states: Record<string, string> = { R: '运行', S: '睡眠', D: '磁盘等待', T: '已停止', t: '跟踪停止', Z: '僵尸', I: '空闲', X: '已退出', P: '已停驻' };
const clock = new Intl.DateTimeFormat('zh-CN', { hour: '2-digit', minute: '2-digit', second: '2-digit' });
const collator = new Intl.Collator('zh-CN', { numeric: true });
const percent = (value: number | null) => value === null ? '—' : `${value.toFixed(1)}%`;

export default function TaskManager() {
  const [sample, setSample] = useState<{ current: Snapshot; previous?: Snapshot }>();
  const [error, setError] = useState('');
  const [query, setQuery] = useState('');
  const [sort, setSort] = useState<{ key: SortKey; descending: boolean }>({ key: 'cpu', descending: true });

  useEffect(() => {
    let controller: AbortController | undefined;
    let timer: number | undefined;
    let previous: Snapshot | undefined;
    async function poll(request: AbortController) {
      try {
        const current = await apiResponse<Snapshot>('/api/system/processes', {
          signal: AbortSignal.any([request.signal, AbortSignal.timeout(10000)]),
        });
        if (request.signal.aborted) return;
        const elapsed = previous ? current.at - previous.at : 0;
        setSample({ current, previous: elapsed > 0 && elapsed <= 10000 ? previous : undefined });
        previous = current;
        setError('');
      } catch (reason) {
        if (request.signal.aborted) return;
        setError(reason instanceof Error ? reason.message : '暂时无法读取进程信息。');
        previous = undefined;
      }
      if (!request.signal.aborted) timer = window.setTimeout(() => void poll(request), 2000);
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

  const current = sample?.current;
  const previous = sample?.previous;
  const busy = current && previous ? current.cpu.busy - previous.cpu.busy : -1;
  const idle = current && previous ? current.cpu.idle - previous.cpu.idle : -1;
  const total = busy + idle;
  const valid = !!current && !!previous && current.cpu.logical === previous.cpu.logical && busy >= 0 && idle >= 0 && total > 0;
  const prior = new Map(previous?.processes.map(p => [p.pid, p]));
  const rows: Row[] = (current?.processes ?? []).map(p => {
    const old = prior.get(p.pid);
    const cpu = valid && old && old.started === p.started && p.ticks >= old.ticks
      ? (p.ticks - old.ticks) / total * current!.cpu.logical * 100 : null;
    return { ...p, cpu };
  });
  const search = query.trim().toLocaleLowerCase();
  const filtered = rows.filter(p => `${p.name}\n${p.pid}\n${p.uid}`.toLocaleLowerCase().includes(search));
  filtered.sort((a, b) => {
    const left = a[sort.key], right = b[sort.key];
    // Unsampled processes stay at the bottom in either direction.
    if (left === null || right === null) return Number(left === null) - Number(right === null) || a.pid - b.pid;
    const compared = typeof left === 'number' && typeof right === 'number' ? left - right : collator.compare(String(left), String(right));
    return compared * (sort.descending ? -1 : 1) || a.pid - b.pid;
  });

  return <section className="task-manager" aria-label="任务管理器">
    <section className="task-panel" aria-label="进程列表">
      <div className="task-toolbar">
        <label>搜索进程<input type="search" placeholder="名称、PID 或 UID" value={query} onChange={event => setQuery(event.target.value)} /></label>
        <dl className="task-summary" aria-label="主机资源概况">
          <div title={current ? `${current.cpu.logical} 个逻辑核心 · 全机占用` : undefined}>
            <dt>CPU</dt><dd>{percent(valid ? busy / total * 100 : null)}</dd>
          </div>
          <div title={current ? `${formatBytes(current.memory.total - current.memory.available)} / ${formatBytes(current.memory.total)}` : undefined}>
            <dt>内存</dt><dd>{percent(current ? (current.memory.total - current.memory.available) / current.memory.total * 100 : null)}</dd>
          </div>
          <div title={current ? `${rows.filter(p => p.state === 'R').length} 个运行中 · ${rows.reduce((sum, p) => sum + p.threads, 0)} 个线程` : undefined}>
            <dt>进程</dt><dd>{current ? rows.length : '—'}</dd>
          </div>
        </dl>
      </div>
      <div className="task-table-scroll" tabIndex={0} role="region" aria-label="可横向滚动的进程表格">
        <table>
          <caption className="task-table-caption">进程占用，点击列标题排序，再次点击切换升降序</caption>
          <thead><tr>{columns.map(column => <th key={column.key} scope="col"
            aria-sort={sort.key === column.key ? sort.descending ? 'descending' : 'ascending' : 'none'}>
            <button type="button" onClick={() => setSort({ key: column.key,
              descending: sort.key === column.key ? !sort.descending : ['cpu', 'memory', 'threads'].includes(column.key) })}>
              {column.label}<span aria-hidden="true">{sort.key === column.key ? sort.descending ? ' ↓' : ' ↑' : ' ↕'}</span>
            </button>
          </th>)}</tr></thead>
          <tbody>{filtered.map(p => <tr key={`${p.pid}:${p.started}`}>
            <td title={p.name}>{p.name}</td><td>{p.pid}</td><td className="task-cpu">{percent(p.cpu)}</td>
            <td>{formatBytes(p.memory)} <small>({percent(current ? p.memory / current.memory.total * 100 : null)})</small></td>
            <td>{p.threads}</td><td>{p.uid}</td><td><span className="task-state" data-running={p.state === 'R'}>{states[p.state] ?? p.state}</span></td>
          </tr>)}</tbody>
        </table>
        {!filtered.length && <p className="task-empty">{!current ? error ? '尚无进程数据，请检查后端连接。' : '正在读取进程…' : search ? '没有匹配的进程。' : '暂无可读取的进程。'}</p>}
      </div>
      <footer className="task-footer">
        <span>{filtered.length} / {rows.length} 个进程{current && current.skipped > 0 ? ` · ${current.skipped} 个已退出或无权读取的进程已跳过` : ''}</span>
        <p className="task-status" role="status">{error ? `${error}${current ? ' 显示上次数据。' : ' 将自动重试。'}` :
          current ? `每 2 秒刷新 · ${clock.format(current.at)}` : '正在连接 Linux 主机…'}</p>
        <span>CPU：单核满载为 100%，多核可超过 100%。内存：常驻物理内存，含共享页。</span>
        {current && !previous && <span>CPU 占用需两次采样，等待下一次刷新。</span>}
      </footer>
    </section>
  </section>;
}
