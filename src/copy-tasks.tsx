import { useEffect, useState } from 'react';
import { apiResponse, formatBytes } from './disks';

type Task = {
  id: number;
  source: string;
  target: string;
  state: 'queued' | 'running' | 'done' | 'failed';
  bytes: number;
  total: number;
  current: string;
  fileBytes: number;
  fileTotal: number;
  completed: number;
  files: string[] | null;
  error: string;
};

const labels = { queued: '排队中', running: '复制中', done: '已完成', failed: '失败' };

export default function CopyTasks() {
  const [open, setOpen] = useState(false);
  const [tasks, setTasks] = useState<Task[]>();
  const [error, setError] = useState('');
  const [clearing, setClearing] = useState(false);

  useEffect(() => {
    if (!open || clearing) return;
    const controller = new AbortController();
    let timer: number;
    async function poll() {
      try {
        const result = await apiResponse<Task[]>('/api/copy-tasks', { signal: controller.signal });
        if (!controller.signal.aborted) { setTasks(result); setError(''); }
      } catch {
        if (!controller.signal.aborted) setError('暂时无法读取复制任务。');
      }
      if (!controller.signal.aborted) timer = window.setTimeout(poll, 1000);
    }
    void poll();
    return () => { controller.abort(); window.clearTimeout(timer); };
  }, [open, clearing]);

  async function clear() {
    setClearing(true);
    try {
      setTasks(await apiResponse<Task[]>('/api/copy-tasks', { method: 'DELETE' }));
      setError('');
    } catch {
      setError('无法清除任务记录。');
    } finally {
      setClearing(false);
    }
  }

  return <section id="dock-copy-tasks" className="dock-settings copy-tasks" popover="auto"
    role="dialog" aria-labelledby="copy-tasks-title" onToggle={event => setOpen(event.newState === 'open')}>
    <header>
      <h2 id="copy-tasks-title">复制任务</h2>
      <button className="dock-reset" type="button" disabled={clearing || !tasks?.some(task => task.state === 'done' || task.state === 'failed')}
        onClick={() => void clear()}>清除已结束</button>
    </header>
    {error && <p role="status">{error}</p>}
    {!tasks?.length && !error && <p>{tasks ? '暂无复制任务。' : '正在读取任务…'}</p>}
    {tasks?.map(task => <details key={task.id} className="copy-task">
      <summary><strong>{task.source.split('/').at(-1)}</strong><span data-state={task.state}>
        {labels[task.state]}{task.state === 'running' && ' · ' + formatBytes(task.bytes)}
      </span></summary>
      <div className="copy-task-progress">
        <span>{formatBytes(task.bytes)}{task.total > 0 ? ' / ' + formatBytes(task.total) : ' 已读取'}</span>
        {task.total > 0 && <progress aria-label="复制进度" value={Math.min(task.bytes, task.total)} max={task.total} />}
        {task.state === 'running' && task.total === 0 && (task.fileTotal > 0 ?
          <progress aria-label="当前文件进度" value={Math.min(task.fileBytes, task.fileTotal)} max={task.fileTotal} /> :
          <progress aria-label="正在复制" />)}
      </div>
      <p>来源 {task.source}</p><p>目标目录 {task.target}</p>
      {task.current && task.state === 'running' && <p>正在处理 {task.current}</p>}
      {task.error && <p className="copy-task-error">{task.current && <>处理项 {task.current}<br /></>}{task.error}</p>}
      {task.completed > 0 && <>
        <p>{task.state === 'done' ? '已复制' : task.state === 'failed' ? '失败前已写入临时区，副本未发布' : '已写入临时区'} {task.completed} 项</p>
        <ul>{task.files?.map(file => <li key={file}>{file}</li>)}</ul>
        {task.completed > (task.files?.length ?? 0) && <p>仅显示前 100 项。</p>}
      </>}
    </details>)}
  </section>;
}
