import { useEffect, useRef, useState } from 'react';
import { Icon } from './ui';
import { formatBytes } from './disks';
import './activity.css';
import './downloads.css';

type Download = { id: number; name: string; url: string; size: number; progress: number; state: 'running' | 'paused' | 'done'; folder: string };
const samples: Download[] = [
  { id: 1, name: 'Debian-13.1.0-amd64.iso', url: 'https://example.com/debian.iso', size: 4.2 * 1024 ** 3, progress: 42, state: 'running', folder: 'volume1 / Downloads' },
  { id: 2, name: '旅行照片.zip', url: 'https://example.com/photos.zip', size: 860 * 1024 ** 2, progress: 68, state: 'paused', folder: 'volume1 / Downloads' },
  { id: 3, name: '设计素材合集.zip', url: 'https://example.com/design.zip', size: 245 * 1024 ** 2, progress: 100, state: 'done', folder: 'volume1 / Downloads' },
  { id: 4, name: '使用手册.pdf', url: 'https://example.com/manual.pdf', size: 12.8 * 1024 ** 2, progress: 100, state: 'done', folder: 'volume1 / Downloads' },
];
const labels = { running: '下载中', paused: '已暂停', done: '已完成' };
export default function Downloads() {
  const [items, setItems] = useState(samples);
  const [tab, setTab] = useState('all');
  const [search, setSearch] = useState('');
  const [url, setUrl] = useState('');
  const [folder, setFolder] = useState('volume1 / Downloads');
  const dialog = useRef<HTMLDialogElement>(null);
  const nextID = useRef(5);
  useEffect(() => {
    const timer = window.setInterval(() => setItems(old => old.map(item => {
      if (item.state !== 'running') return item;
      const progress = Math.min(100, item.progress + .15);
      return { ...item, progress, state: progress >= 100 ? 'done' : 'running' };
    })), 1000);
    return () => clearInterval(timer);
  }, []);
  const active = items.filter(item => item.state !== 'done'), completed = items.filter(item => item.state === 'done');
  const visible = items.filter(item => (tab === 'all' || tab === 'active' && item.state !== 'done' || tab === 'done' && item.state === 'done') && item.name.toLocaleLowerCase().includes(search.trim().toLocaleLowerCase()));
  function toggle(id: number) { setItems(old => old.map(item => item.id === id ? { ...item, state: item.state === 'running' ? 'paused' : 'running' } : item)); }
  return <section className="downloads" aria-label="下载 Demo"><aside className="downloads-sidebar"><div className="downloads-brand"><span><Icon name="download" /></span><strong>下载中心</strong><small>让文件有序到达</small></div><nav aria-label="下载分类">{[['all', '全部任务', items.length], ['active', '正在下载', active.length], ['done', '已完成', completed.length]].map(([key, title, count]) => <button key={key} type="button" aria-pressed={tab === key} onClick={() => setTab(String(key))}><Icon name={key === 'done' ? 'folder' : key === 'active' ? 'download' : 'list'} /><span>{title}</span><small>{count}</small></button>)}</nav><div className="downloads-demo-label"><span>DEMO</span><p>仅界面演示<br />刷新后恢复示例数据</p></div></aside>
    <div className="downloads-main"><header className="activity-toolbar"><button type="button" className="download-new" onClick={() => { setUrl(''); dialog.current?.showModal(); }}>＋ 新建下载</button><label className="activity-search"><Icon name="search" /><input aria-label="搜索下载" placeholder="搜索下载任务" value={search} onChange={e => setSearch(e.target.value)} /></label></header>
      <div className="downloads-summary"><div><small>进行中</small><strong>{active.length}<span>个任务</span></strong></div><div><small>模拟速度</small><strong>{items.some(item => item.state === 'running') ? '6.6' : '0'}<span>MB/s</span></strong></div><p><Icon name="info" />前端设计预览，任务和进度均为模拟，不会实际下载文件。</p></div>
      <div className="activity-table-wrap"><table className="activity-table downloads-table"><thead><tr><th>文件名称</th><th>进度 / 状态</th><th>大小</th><th>操作</th></tr></thead><tbody>{visible.map(item => <tr key={item.id}><td className="download-file"><span><Icon name="download" /></span><div><strong title={item.name}>{item.name}</strong><small title={item.folder}>{item.folder}</small></div></td><td><div className="download-progress"><span>{labels[item.state]}</span><small>{Math.floor(item.progress)}%</small></div><progress aria-label={item.name + ' 模拟进度'} value={item.progress} max="100" data-state={item.state} /></td><td>{formatBytes(item.size)}</td><td><div className="download-actions">{item.state !== 'done' && <button type="button" aria-label={(item.state === 'running' ? '暂停 ' : '继续 ') + item.name} onClick={() => toggle(item.id)}>{item.state === 'running' ? 'Ⅱ' : '▷'}</button>}<button type="button" aria-label={'移除演示任务 ' + item.name} onClick={() => setItems(old => old.filter(task => task.id !== item.id))}><Icon name="trash" /></button></div></td></tr>)}</tbody></table>{!visible.length && <p className="activity-empty">{search ? '没有匹配的下载任务' : '暂无任务'}</p>}</div><footer className="activity-footer"><span>{visible.length} 个任务</span><span>演示数据 · 未连接下载服务</span></footer></div>
    <dialog ref={dialog} className="finder-edit-dialog download-dialog" aria-labelledby="download-dialog-title"><form onSubmit={event => {
      event.preventDefault(); const address = new URL(url); const last = address.pathname.split('/').filter(Boolean).at(-1);
      let name = last || '新建演示下载'; try { name = decodeURIComponent(name); } catch {}
      setItems(old => [{ id: nextID.current++, name, url: address.href, size: 256 * 1024 ** 2, progress: 0, state: 'running', folder }, ...old]); setTab('all'); setSearch(''); dialog.current?.close();
    }}><header><Icon name="download" /><div><h2 id="download-dialog-title">新建下载</h2><p>Demo · 仅生成本地模拟任务</p></div></header><label htmlFor="download-url">下载链接</label><input id="download-url" type="url" pattern="https?://.+" placeholder="https://example.com/file.zip" required value={url} onChange={e => setUrl(e.target.value)} autoFocus /><label htmlFor="download-folder">保存位置（演示）</label><select id="download-folder" value={folder} onChange={e => setFolder(e.target.value)}><option>volume1 / Downloads</option><option>volume2 / Downloads</option></select><p>此处不请求链接、不写入硬盘。协议、保存路径和下载服务待后续确定。</p><footer><button type="button" onClick={() => dialog.current?.close()}>取消</button><button type="submit">添加演示任务</button></footer></form></dialog>
  </section>;
}
