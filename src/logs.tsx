import { useEffect, useState } from 'react';
import { apiResponse, formatBytes } from './disks';
import { Icon } from './ui';
import './activity.css';

type Record = { id: number; at: string; finishedAt?: string; action: string; source: string; target: string; state: string; error: string;
  copy?: { bytes: number; total: number; current: string; fileBytes: number; fileTotal: number; completed: number; files: string[] | null } };
type History = { started: string; limit: number; items: Record[] };
const actions: { [key: string]: string } = { copy: '复制', delete: '删除', create: '新建文件夹', rename: '重命名' };
const states: { [key: string]: string } = { queued: '排队中', running: '进行中', done: '已完成', failed: '失败' };
const time = (date: string) => new Date(date).toLocaleString('zh-CN', { hour12: false });
export default function Logs() {
  const [history, setHistory] = useState<History>();
  const [error, setError] = useState('');
  const [search, setSearch] = useState('');
  const [filter, setFilter] = useState('');
  const [sort, setSort] = useState<{ key: 'at' | 'action' | 'state'; ascending: boolean }>({ key: 'at', ascending: false });
  const [selected, setSelected] = useState<number>();
  useEffect(() => {
    const controller = new AbortController(); let timer: number;
    async function poll() {
      try { const result = await apiResponse<History>('/api/logs', { signal: AbortSignal.any([controller.signal, AbortSignal.timeout(10000)]) }); if (!controller.signal.aborted) { setHistory(result); setError(''); } }
      catch { if (!controller.signal.aborted) setError('暂时无法读取操作日志，正在重试。'); }
      if (!controller.signal.aborted) timer = window.setTimeout(poll, 1500);
    }
    void poll(); return () => { controller.abort(); clearTimeout(timer); };
  }, []);
  const query = search.trim().toLocaleLowerCase();
  const rows = (history?.items ?? []).filter(item => (!filter || item.action === filter) && [item.source, item.target, item.error, actions[item.action], states[item.state], time(item.at)].some(value => value?.toLocaleLowerCase().includes(query)))
    .sort((a, b) => (sort.key === 'at' ? a.id - b.id : (sort.key === 'action' ? actions[a.action] : states[a.state]).localeCompare(sort.key === 'action' ? actions[b.action] : states[b.state], 'zh-CN')) * (sort.ascending ? 1 : -1));
  const detail = history?.items.find(item => item.id === selected);
  function heading(key: typeof sort.key, label: string) { return <th aria-sort={sort.key === key ? sort.ascending ? 'ascending' : 'descending' : 'none'}><button type="button" onClick={() => setSort({ key, ascending: sort.key === key ? !sort.ascending : true })}>{label}<span>{sort.key === key ? sort.ascending ? '↑' : '↓' : '↕'}</span></button></th>; }
  return <section className="activity-app" aria-label="操作日志">
    <header className="activity-toolbar"><label className="activity-search"><Icon name="search" /><input aria-label="搜索日志" placeholder="搜索操作、文件、路径或时间" value={search} onChange={e => setSearch(e.target.value)} /></label><select aria-label="筛选日志操作" value={filter} onChange={e => setFilter(e.target.value)}><option value="">全部操作</option>{Object.entries(actions).map(([key, name]) => <option key={key} value={key}>{name}</option>)}</select><span className="activity-live"><i />自动更新</span></header>
    {error && <p className="activity-error" role="status">{error}</p>}
    <div className="activity-table-wrap"><table className="activity-table log-table"><thead><tr>{heading('at', '时间')}{heading('action', '操作')}<th>项目 / 位置</th>{heading('state', '状态')}<th>详情</th></tr></thead><tbody>{rows.map(item => <tr key={item.id} data-selected={selected === item.id}><td><time dateTime={item.at}>{time(item.at)}</time></td><td><span className="activity-operation"><Icon name={item.action === 'copy' ? 'copy' : item.action === 'delete' ? 'trash' : item.action === 'rename' ? 'rename' : 'folder'} />{actions[item.action]}</span></td><td className="activity-path" title={[item.source, item.target].filter(Boolean).join(' → ')}><strong>{(item.source || item.target).split('/').at(-1)}</strong><small>{item.source || item.target}{item.source && item.target && ' → ' + item.target}</small></td><td><span className="activity-badge" data-state={item.state}>{states[item.state]}</span>{item.copy && item.state === 'running' && <small>{formatBytes(item.copy.bytes)}</small>}</td><td><button type="button" className="activity-detail-button" aria-expanded={selected === item.id} aria-label={'查看日志 ' + item.id} onClick={() => setSelected(selected === item.id ? undefined : item.id)}>详情<Icon name="right" /></button></td></tr>)}</tbody></table>{!rows.length && <p className="activity-empty">{history ? query || filter ? '没有匹配的日志' : '暂无操作记录，文件操作会在这里显示' : '正在读取日志…'}</p>}</div>
    {detail && <aside className="activity-detail" aria-label="日志详情"><header><strong>{actions[detail.action]} · {states[detail.state]}</strong><button type="button" aria-label="关闭日志详情" onClick={() => setSelected(undefined)}><Icon name="close" /></button></header><p>开始 {time(detail.at)}{detail.finishedAt && ' · 结束 ' + time(detail.finishedAt)}</p>{detail.source && <p>来源 {detail.source}</p>}{detail.target && <p>目标 {detail.target}</p>}{detail.copy && <><p>已处理 {formatBytes(detail.copy.bytes)} · {detail.copy.completed} 项{detail.state === 'failed' && '（临时区内容，副本未发布）'}</p>{detail.state === 'running' && <><progress aria-label="复制进度" {...(detail.copy.total > 0 ? { value: detail.copy.bytes, max: detail.copy.total } : detail.copy.fileTotal > 0 ? { value: detail.copy.fileBytes, max: detail.copy.fileTotal } : {})} /><p>正在处理 {detail.copy.current || '准备文件…'}</p></>}{!!detail.copy.files?.length && <details><summary>处理项目（最多 100 项）</summary><ul>{detail.copy.files.map(file => <li key={file}>{file}</li>)}</ul></details>}</>}{detail.error && <p className="activity-error">{detail.error}</p>}</aside>}
    <footer className="activity-footer"><span>{rows.length} / {history?.items.length ?? 0} 条记录</span><span title={history ? '服务启动于 ' + time(history.started) : undefined}>本次服务启动 · 最近 {history?.limit ?? 1000} 条已结束记录</span></footer>
  </section>;
}
