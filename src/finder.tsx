import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import type { MouseEvent, ReactNode } from 'react';
import { Link, useLocation, useNavigate, useNavigationType } from 'react-router-dom';
import { apiResponse, diskKind, diskName, diskURL, fileKinds, formatBytes } from './disks';
import type { Disk, Entry, ReadableFile, useDisks } from './disks';
import FileText from './file-text';
import './finder.css';

const root = '/files';
const route = (path = '') => root + (path ? '/' + path.split('/').map(encodeURIComponent).join('/') : '');
const join = (path: string, name: string) => path ? path + '/' + name : name;
const segment = (entry: Entry) => entry.segment ?? entry.name;

const symbols = {
  back: 'm14 5-7 7 7 7', next: 'm10 5 7 7-7 7',
  icons: 'M3 3h7v7H3zM14 3h7v7h-7zM3 14h7v7H3zM14 14h7v7h-7z',
  list: 'M8 5h13M8 12h13M8 19h13M3 5h.1M3 12h.1M3 19h.1',
  columns: 'M3 4h18v16H3zM9 4v16m6-16v16',
  gallery: 'M3 3h18v13H3zM4 21h2m4 0h2m4 0h2m3 0h.1',
  sort: 'M4 4h16v5H4zM4 13h6v7H4zM14 13h6v7h-6z',
  sidebar: 'M3 4h18v16H3zM9 4v16M5 8h2m-2 3h2m-2 3h2',
  search: 'M16.5 16.5 22 22M19 11a8 8 0 1 1-16 0 8 8 0 0 1 16 0Z',
  more: 'M5 12h.1m6.9 0h.1m6.9 0h.1',
  share: 'M12 15V2m-4 4 4-4 4 4M7 9H4v12h16V9h-3',
  tag: 'M3 12 12 3h7l2 2v7l-9 9Z M16 8h.1',
  folder: 'M3 7V5h7l2 2h9v13H3zM3 9h18',
  file: 'M6 3h8l4 4v14H6zM14 3v5h4',
  media: 'M3 4h18v16H3zM3 17l6-6 4 4 3-3 5 5m-6-9h.1',
  video: 'M3 4h18v16H3zM10 8l6 4-6 4z',
  refresh: 'M20 11a8 8 0 1 0-2 6m2-12v6h-6',
  disk: 'M6 4h12l3 11v5H3v-5L6 4ZM3 15h18m-5 2.5h.1m2.9 0h.1',
} as const;

function Glyph({ name }: { name: keyof typeof symbols }) {
  return <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.65" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d={symbols[name]} /></svg>;
}

const modes = { icons: '图标视图', list: '列表视图', columns: '分栏视图', gallery: '画廊视图' } as const;
type Mode = keyof typeof modes;
type DiskState = ReturnType<typeof useDisks>;
type OpenFile = (file: ReadableFile, opener: HTMLElement) => void;

const historyPaths = new Map<number, string>();

export default function Files({ onOpenFile, inventory }: { onOpenFile: OpenFile; inventory: DiskState }) {
  const { pathname } = useLocation();
  const navigationType = useNavigationType();
  const navigate = useNavigate();
  const index: number = window.history.state?.idx ?? 0;
  const [view, setView] = useState<Mode>('list');
  const [sidebar, setSidebar] = useState(true);
  const [status, setStatus] = useState(true);
  const [tagged, setTagged] = useState<string[]>([]);
  useLayoutEffect(() => {
    if (navigationType === 'PUSH') for (const entry of historyPaths.keys()) {
      if (entry >= index) historyPaths.delete(entry);
    }
    historyPaths.set(index, pathname);
  }, [index, navigationType, pathname]);

  let path = '';
  try { path = decodeURIComponent(pathname.slice(root.length + 1)); } catch {}
  const disk = inventory.disks.find(device => device.id === path.split('/')[0]);
  const diskKey = disk ? [disk.id, ...disk.volumes.map(volume => volume.id)].join(':') : '';
  const [approved, setApproved] = useState('');
  useEffect(() => {
    setApproved(current => current === diskKey ? current : '');
  }, [diskKey]);
  const confirmed = !!diskKey && diskKey === approved;

  return <Finder key={pathname + ':' + diskKey} path={path} inventory={inventory} disk={disk} confirmed={confirmed} approve={() => setApproved(diskKey)} view={view} setView={setView} onOpenFile={onOpenFile}
    sidebar={sidebar} toggleSidebar={() => setSidebar(!sidebar)}
    status={status} toggleStatus={() => setStatus(!status)}
    tagged={tagged} toggleTag={key => setTagged(items => items.includes(key) ? items.filter(item => item !== key) : [...items, key])}
    back={historyPaths.has(index - 1) ? () => navigate(-1) : path ? () => navigate(route(path.split('/').slice(0, -1).join('/'))) : undefined}
    forward={navigationType === 'POP' && historyPaths.has(index + 1) ? () => navigate(1) : undefined} />;
}

type FinderProps = {
  path: string;
  inventory: DiskState;
  disk?: Disk;
  confirmed: boolean;
  approve: () => void;
  view: Mode;
  setView: (mode: Mode) => void;
  onOpenFile: OpenFile;
  sidebar: boolean;
  toggleSidebar: () => void;
  status: boolean;
  toggleStatus: () => void;
  tagged: string[];
  toggleTag: (key: string) => void;
  back?: () => void;
  forward?: () => void;
};

function Finder({ path, inventory, disk, confirmed, approve, view, setView, onOpenFile, sidebar, toggleSidebar, status, toggleStatus, tagged, toggleTag, back, forward }: FinderProps) {
  const navigate = useNavigate();
  const [query, setQuery] = useState('');
  const [searching, setSearching] = useState(false);
  const [descending, setDescending] = useState(false);
  const [foldersFirst, setFoldersFirst] = useState(true);
  const [selected, setSelected] = useState('');
  const [expanded, setExpanded] = useState<string[]>([]);
  const [menu, setMenu] = useState<'sort' | 'more'>();
  const menuRef = useRef<HTMLDivElement>(null);
  const selectedRef = useRef<HTMLAnchorElement>(null);
  const columnsRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const columns = columnsRef.current;
    if (columns) columns.parentElement?.scrollTo({ left: columns.scrollWidth });
  }, [view, path]);
  const { disks, loading, error, refresh } = inventory;
  const parts = path ? path.split('/') : [];
  const ancestors = ['', ...parts.map((_, i) => parts.slice(0, i + 1).join('/'))];
  const [contents, setContents] = useState<Record<string, { entries: Entry[]; error?: string }>>({});
  const gated = !!disk && disk.volumes.length > 0 && (disk.system || disk.mayWake) && !confirmed;
  const activeURL = disk && !gated ? diskURL(disk, path, 'entries', confirmed) : undefined;
  const volumeRoot = !!disk && disk.volumes.length > 1 && parts.length === 1;
  const title = path ? locationName(path) : '硬盘';

  function locationName(directory: string) {
    if (!directory) return '硬盘';
    const segments = directory.split('/');
    if (segments.length === 1 && disk) return diskName(disk);
    if (segments.length === 2 && disk && disk.volumes.length > 1) {
      return disk.volumes.find(volume => volume.id === segments[1])?.mount ?? segments[1];
    }
    return segments.at(-1) ?? directory;
  }

  function readDirectory(directory: string, url: string, signal?: AbortSignal) {
    return apiResponse<Entry[]>(url, signal).then(entries => {
      if (!signal?.aborted) setContents(previous => ({ ...previous, [directory]: { entries } }));
    }).catch(reason => {
      if (!signal?.aborted) setContents(previous => ({
        ...previous, [directory]: { entries: [], error: reason instanceof Error ? reason.message : '无法读取目录。' },
      }));
    });
  }

  useEffect(() => {
    if (!activeURL || !disk) return;
    const request = new AbortController();
    void readDirectory(path, activeURL, request.signal);
    return () => request.abort();
  }, [activeURL, path]);

  useEffect(() => {
    if (!activeURL || !disk || view !== 'columns') return;
    const request = new AbortController();
    for (const parent of ancestors.slice(1, -1)) {
      const url = diskURL(disk, parent, 'entries', confirmed);
      if (url) void readDirectory(parent, url, request.signal);
    }
    return () => request.abort();
  }, [activeURL, path, view]);

  function getRows(directory: string) {
    let entries: Entry[] = [];
    if (!directory) entries = disks.map(device => ({
      name: diskName(device), segment: device.id, kind: 'directory',
      bytes: device.bytes, detail: diskKind(device),
    }));
    else if (!gated && disk) {
      entries = directory === disk.id && disk.volumes.length > 1
        ? disk.volumes.map(volume => ({ name: volume.mount, segment: volume.id, kind: 'directory', bytes: 0, detail: '挂载分区' }))
        : contents[directory]?.entries ?? [];
    }
    return entries.filter(entry => entry.name.toLocaleLowerCase().includes(query.trim().toLocaleLowerCase()))
      .sort((a, b) =>
        (foldersFirst ? Number(b.kind === 'directory') - Number(a.kind === 'directory') : 0) ||
        a.name.localeCompare(b.name, 'zh-CN') * (descending ? -1 : 1));
  }

  const rows = getRows(path);
  const preview = rows.find(entry => join(path, segment(entry)) === selected) ?? rows[0];
  const previewURL = preview && disk && !gated && preview.kind !== 'directory'
    ? diskURL(disk, join(path, segment(preview)), 'file', confirmed) : undefined;
  const message = error || (loading && !disks.length ? '正在读取硬盘信息…' :
    path && !disk ? '找不到此硬盘。请刷新硬盘列表。' :
    disk && !disk.volumes.length ? '此硬盘没有已挂载的分区。请在 Debian 挂载后刷新硬盘。' :
    contents[path]?.error || (activeURL && !contents[path] ? '正在读取目录…' :
    path && !gated && !volumeRoot && !activeURL ? '分区挂载已变化，请返回硬盘列表。' : ''));

  function item(entry: Entry, directory: string, children: ReactNode, openFolderOnClick = false) {
    const key = join(directory, segment(entry));
    const folder = entry.kind === 'directory';
    const url = !folder && disk ? diskURL(disk, key, 'file', confirmed) : undefined;
    const modified = (event: MouseEvent) => event.metaKey || event.ctrlKey || event.shiftKey || event.altKey;
    function open(element: HTMLAnchorElement) {
      if (folder) navigate(route(key));
      else if (entry.kind !== 'directory' && entry.kind !== 'file' && url) {
        onOpenFile([entry.name, entry.kind, formatBytes(entry.bytes), url], element);
      } else element.click();
    }
    return <a href={folder ? '#' + route(key) : url && url + '&download=1'}
      download={folder ? undefined : entry.name} ref={selected === key ? selectedRef : undefined}
      onClick={event => {
        if (modified(event) || (!event.detail && entry.kind === 'file')) return;
        event.preventDefault();
        if (event.detail && !(folder && openFolderOnClick)) setSelected(key);
        else open(event.currentTarget);
      }}
      onDoubleClick={event => {
        if (modified(event) || (folder && openFolderOnClick)) return;
        open(event.currentTarget);
      }}>{children}{tagged.includes(key) && <i className="finder-tag" aria-label="蓝色标签" />}</a>;
  }

  function listRows(entries: Entry[], directory: string, depth = 0): ReactNode {
    return entries.flatMap(entry => {
      const { name, kind, bytes, modified, detail } = entry;
      const folder = kind === 'directory';
      const key = join(directory, segment(entry));
      const open = expanded.includes(key);
      const row = <tr key={key} data-selected={selected === key} onClick={event => {
        if (!(event.target as Element).closest('a, button')) setSelected(key);
      }}>
        <td><div className="finder-name" style={{ paddingInlineStart: depth * 15 }}>
          {folder && directory ? <button className="finder-disclosure" type="button" aria-label={(open ? '折叠 ' : '展开 ') + name}
            aria-expanded={open} onClick={() => {
              setExpanded(open ? expanded.filter(value => value !== key) : [...expanded, key]);
              const url = disk && !gated ? diskURL(disk, key, 'entries', confirmed) : undefined;
              if (!open && url && !contents[key]?.entries.length) void readDirectory(key, url);
            }}><Glyph name="next" /></button>
            : <span className="finder-disclosure" />}
          {item(entry, directory, <><FileIcon type={kind} />{name}</>)}
        </div></td>
        <td>{modified ? new Date(modified).toLocaleString('zh-CN') : '—'}</td><td>{!folder || bytes ? formatBytes(bytes) : '—'}</td><td>{detail ?? fileKinds[kind]}</td>
      </tr>;
      if (!open) return [row];
      const children = getRows(key);
      return children.length ? [row, listRows(children, key, depth + 1)] : [
        row, <tr key={key + ':empty'}><td colSpan={4} style={{ paddingInlineStart: 28 + depth * 15 }}>
          {contents[key]?.error ?? (contents[key] ? '此目录为空' : '正在读取目录…')}
        </td></tr>,
      ];
    });
  }

  function showMenu(which: 'sort' | 'more') {
    setMenu(menu === which ? undefined : which);
  }

  return <section className="finder" data-sidebar={sidebar} aria-label="文件管理"
    onPointerDown={event => { if (!menuRef.current?.contains(event.target as Node)) setMenu(undefined); }}
    onKeyDown={event => {
      if (event.key === 'Escape') {
        if (menu) setMenu(undefined);
        else if (searching) { setQuery(''); setSearching(false); }
        else setSelected('');
      }
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === 'f') {
        event.preventDefault();
        setSearching(true);
      }
    }}>
    <aside className="finder-sidebar">
      <div className="finder-sidebar-head">
        <div className="finder-lights">
          <Link to="/" aria-label="关闭文件管理" title="关闭文件管理" />
          <Link to="/" state={{ finderResume: route(path) }} aria-label="将文件管理收起到程序坞" title="最小化" />
          <button type="button" aria-label="切换全屏" title="切换全屏" onClick={() => {
            const transition = document.fullscreenElement ? document.exitFullscreen() : document.documentElement.requestFullscreen();
            void transition.catch(() => {});
          }} />
        </div>
        <button className="finder-pill finder-sidebar-toggle" type="button" aria-label="隐藏边栏" onClick={toggleSidebar}><Glyph name="sidebar" /></button>
      </div>
      <nav aria-label="Finder 边栏">
        <Link to={root} aria-current={!path ? 'location' : undefined}><Glyph name="disk" />所有硬盘</Link>
        <p>位置</p>
        {disks.map(device => <Link key={device.id} to={route(device.id)} aria-current={device.id === disk?.id ? 'location' : undefined}
          title={[diskName(device), device.model, diskKind(device)].filter(Boolean).join(' · ')}>
          <Glyph name="disk" /><span>{diskName(device)}</span>
        </Link>)}
      </nav>
    </aside>
    <div className="finder-content">
      <header className="finder-toolbar">
        {!sidebar && <button className="finder-pill finder-sidebar-toggle" type="button" aria-label="显示边栏" onClick={toggleSidebar}><Glyph name="sidebar" /></button>}
        <div className="finder-pill finder-history" role="group" aria-label="浏览历史">
          <button type="button" aria-label="后退" title="后退" disabled={!back} onClick={back}><Glyph name="back" /></button>
          <button type="button" aria-label="前进" title="前进" disabled={!forward} onClick={forward}><Glyph name="next" /></button>
        </div>
        <h1>{title}</h1>
        <button className="finder-pill finder-refresh" type="button" aria-label="刷新硬盘" title="刷新硬盘"
          disabled={loading} onClick={() => void refresh()}><Glyph name="refresh" /></button>
        <div className="finder-pill finder-views" role="group" aria-label="显示方式">
          {(Object.keys(modes) as Mode[]).map(mode => <button key={mode} type="button" aria-label={modes[mode]}
            aria-pressed={view === mode} title={modes[mode]} onClick={() => setView(mode)}><Glyph name={mode} /></button>)}
        </div>
        <div className="finder-actions" ref={menuRef}>
          <button className="finder-pill finder-order" type="button" aria-label="排序" aria-expanded={menu === 'sort'} onClick={() => showMenu('sort')}><Glyph name="sort" /><Glyph name="next" /></button>
          <div className="finder-pill finder-tools">
            <button type="button" aria-label="拷贝所在位置链接" title="拷贝所在位置链接" disabled={!selected} onClick={() => {
              const url = new URL(window.location.href);
              url.hash = route(selectedRef.current?.getAttribute('href')?.startsWith('#/files/') ? selected : selected.split('/').slice(0, -1).join('/'));
              if (navigator.clipboard) {
                void navigator.clipboard.writeText(url.href).catch(() => window.prompt('拷贝位置链接', url.href));
              } else {
                window.prompt('拷贝位置链接', url.href);
              }
            }}><Glyph name="share" /></button>
            <button type="button" aria-label="切换蓝色标签" title="切换蓝色标签" disabled={!selected}
              aria-pressed={tagged.includes(selected)} onClick={() => toggleTag(selected)}><Glyph name="tag" /></button>
            <button type="button" aria-label="更多操作" aria-expanded={menu === 'more'} onClick={() => showMenu('more')}><Glyph name="more" /></button>
          </div>
          {menu && <div className="finder-menu" aria-label={menu === 'sort' ? '排序选项' : '更多操作'}>
            {menu === 'sort' ? <>
              <button type="button" onClick={() => { setDescending(false); setMenu(undefined); }}>{!descending ? '✓ ' : ''}名称升序</button>
              <button type="button" onClick={() => { setDescending(true); setMenu(undefined); }}>{descending ? '✓ ' : ''}名称降序</button>
              <hr /><button type="button" onClick={() => { setFoldersFirst(!foldersFirst); setMenu(undefined); }}>{foldersFirst ? '✓ ' : ''}文件夹排在前面</button>
            </> : <>
              <button type="button" disabled={!selected} onClick={() => { selectedRef.current?.click(); setMenu(undefined); }}>打开</button>
              <hr /><button type="button" onClick={() => { toggleStatus(); setMenu(undefined); }}>{status ? '隐藏' : '显示'}路径栏和状态栏</button>
            </>}
          </div>}
        </div>
        {searching ? <label className="finder-pill finder-search"><Glyph name="search" /><input autoFocus type="search"
          aria-label="搜索当前目录" placeholder="搜索" value={query} onChange={event => { setQuery(event.target.value); setSelected(''); }}
          onBlur={() => { if (!query) setSearching(false); }} /></label>
          : <button className="finder-pill finder-search-toggle" type="button" aria-label="搜索当前目录" title="搜索" onClick={() => setSearching(true)}><Glyph name="search" /></button>}
      </header>
      <div className="finder-browser" onClick={event => { if (event.target === event.currentTarget) setSelected(''); }}>
        {gated ? <div className="finder-disk-notice" role="region" aria-label="硬盘访问确认">
          <Glyph name="disk" />
          <h2>{disk.system ? '系统盘，请谨慎修改' : '此硬盘可能正在休眠'}</h2>
          {disk.system && <p>这里是 Debian 系统盘。文件管理器以只读方式打开。</p>}
          {disk.mayWake && <p>继续读取目录可能会唤醒硬盘。</p>}
          <div><Link to={root}>返回硬盘列表</Link><button type="button" onClick={approve}>继续打开</button></div>
        </div> : message ? <p className="finder-empty" role="status">{message}</p> : <>
        {view === 'list' && <div className="finder-list">
          <table>
            <thead><tr><th scope="col" aria-sort={descending ? 'descending' : 'ascending'}>
              <button type="button" onClick={() => setDescending(!descending)}>名称<span data-descending={descending}><Glyph name="next" /></span></button>
            </th><th scope="col">修改日期</th><th scope="col">大小</th><th scope="col">种类</th></tr></thead>
            <tbody>{listRows(rows, path)}</tbody>
          </table>
          <div className="finder-stripes" aria-hidden="true" />
        </div>}
        {view === 'icons' && <ul className="finder-grid">{rows.map(entry => <li key={segment(entry)} data-selected={selected === join(path, segment(entry))}>
          {item(entry, path, <><FileIcon type={entry.kind} /><span>{entry.name}</span></>)}
        </li>)}</ul>}
        {view === 'columns' && <div className="finder-columns" ref={columnsRef}>{ancestors.map((directory, i) => <ul key={directory} aria-label={locationName(directory)}>
          {(i === parts.length ? rows : getRows(directory)).map(entry => <li key={segment(entry)}
            data-selected={parts[i] === segment(entry) || selected === join(directory, segment(entry))}>
            {item(entry, directory, <><FileIcon type={entry.kind} /><span>{entry.name}</span>{entry.kind === 'directory' && <Glyph name="next" />}</>, true)}
          </li>)}
        </ul>)}</div>}
        {view === 'gallery' && preview && <div className="finder-gallery">
          <div className="finder-preview">
            {preview.kind === 'image' && previewURL ? <img className="finder-preview-image" src={previewURL} alt="" /> :
              preview.kind === 'video' && previewURL ? <video className="finder-preview-image" src={previewURL} muted playsInline preload="metadata" aria-hidden="true" /> :
              preview.kind === 'text' && previewURL ? <FileText key={previewURL} source={previewURL} /> : <FileIcon type={preview.kind} />}
            <h2>{preview.name}</h2></div>
          <ul className="finder-grid">{rows.map(entry => <li key={segment(entry)} data-selected={segment(entry) === segment(preview)}>
            {item(entry, path, <><FileIcon type={entry.kind} /><span>{entry.name}</span></>)}
          </li>)}</ul>
        </div>}
        {!rows.length && <p className="finder-empty">{query.trim() ? '没有匹配的项目' : path ? '此目录为空' : '未发现硬盘'}</p>}
        </>}
      </div>
      {status && <footer className="finder-status">
        <nav aria-label="当前路径"><Link to={root}><Glyph name="disk" />硬盘</Link>
          {ancestors.slice(1).map((directory) => <span key={directory}><Glyph name="next" /><Link to={route(directory)}><FileIcon type="directory" />{locationName(directory)}</Link></span>)}
        </nav>
        <span aria-live="polite">{selected ? '已选中 1 项，共 ' : ''}{rows.length} 个项目</span>
      </footer>}
    </div>
  </section>;
}

function FileIcon({ type }: { type: string }) {
  return type === 'directory' ? <img className="finder-file-icon" src={new URL('./assets/finder-folder.png', import.meta.url).href} alt="" />
    : <span className="finder-file-icon finder-document"><Glyph name={type === 'image' ? 'media' : type === 'video' ? 'video' : 'file'} /></span>;
}
