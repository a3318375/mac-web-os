import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import type { MouseEvent, ReactNode } from 'react';
import { Link, useLocation, useNavigate, useNavigationType } from 'react-router-dom';
import { apiResponse, compareDisks, diskKind, diskLocation, diskName, diskURL, fileKinds, formatBytes, systemRoot } from './disks';
import type { Disk, Entry, FileLocation, ReadableFile, useDisks } from './disks';
import FileText from './file-text';
import { Folder, Icon } from './ui';
import './finder.css';

const root = '/files';
const route = (path = '') => root + (path ? '/' + path.split('/').map(encodeURIComponent).join('/') : '');
const join = (path: string, name: string) => path ? path + '/' + name : name;
const segment = (entry: Entry) => entry.segment ?? entry.name;

const modes = { icons: '图标视图', list: '列表视图', columns: '分栏视图', gallery: '画廊视图' } as const;
type Mode = keyof typeof modes;
type DiskState = ReturnType<typeof useDisks>;
type OpenFile = (file: ReadableFile, opener: HTMLElement) => void;
type CopiedFile = { name: string; source: FileLocation };

const historyPaths = new Map<number, string>();

export default function Files({ onOpenFile, inventory }: { onOpenFile: OpenFile; inventory: DiskState }) {
  const { pathname } = useLocation();
  const navigationType = useNavigationType();
  const navigate = useNavigate();
  const index: number = window.history.state?.idx ?? 0;
  const [view, setView] = useState<Mode>('list');
  const [sidebar, setSidebar] = useState(true);
  const [favorites, setFavorites] = useState<Record<string, boolean>>(() => {
    try { const stored = JSON.parse(localStorage.getItem('harbor-nas.favorites') ?? '{}'); return stored && !Array.isArray(stored) && typeof stored === 'object' ? Object.fromEntries(Object.entries(stored).filter(([, value]) => typeof value === 'boolean')) as Record<string, boolean> : {}; } catch { return {}; }
  });
  useEffect(() => { try { localStorage.setItem('harbor-nas.favorites', JSON.stringify(favorites)); } catch {} }, [favorites]);
  const [copied, setCopied] = useState<CopiedFile>();
  useLayoutEffect(() => {
    if (navigationType === 'PUSH') for (const entry of historyPaths.keys()) {
      if (entry >= index) historyPaths.delete(entry);
    }
    historyPaths.set(index, pathname);
  }, [index, navigationType, pathname]);

  const lastPath = useRef('');
  if (pathname === root || pathname.startsWith(root + '/')) {
    try { lastPath.current = decodeURIComponent(pathname.slice(root.length + 1)); } catch { lastPath.current = ''; }
  }
  const path = lastPath.current;
  const disk = inventory.disks.find(device => device.id === path.split('/')[0]);
  const diskKey = disk ? [disk.id, ...disk.volumes.map(volume => volume.id)].join(':') : '';
  const [approved, setApproved] = useState('');
  useEffect(() => {
    setApproved(current => current === diskKey ? current : '');
  }, [diskKey]);
  const confirmed = !!diskKey && diskKey === approved;

  return <Finder key={pathname + ':' + diskKey} path={path} inventory={inventory} disk={disk} confirmed={confirmed} approve={() => setApproved(diskKey)} view={view} setView={setView} onOpenFile={onOpenFile}
    sidebar={sidebar} toggleSidebar={() => setSidebar(!sidebar)} copied={copied} setCopied={setCopied}
    favorites={favorites} toggleTag={(key, folder) => setFavorites(items => {
      const next = { ...items }; if (key in next) delete next[key]; else next[key] = folder; return next;
    })} updateFavorites={(oldKey, newKey) => setFavorites(items => Object.fromEntries(Object.entries(items).flatMap(([key, folder]) => key === oldKey || key.startsWith(oldKey + '/') ? newKey ? [[newKey + key.slice(oldKey.length), folder]] : [] : [[key, folder]])))}
    back={historyPaths.has(index - 1) ? () => navigate(-1) : path ? () => navigate(route(path.split('/').slice(0, -1).join('/'))) : undefined}
    forward={navigationType === 'POP' && historyPaths.has(index + 1) ? () => navigate(1) : undefined} />;
}

type FinderProps = {
  path: string;
  inventory: DiskState;
  disk?: Disk;
  confirmed: boolean;
  approve: () => void;
  copied?: CopiedFile;
  setCopied: (file: CopiedFile) => void;
  view: Mode;
  setView: (mode: Mode) => void;
  onOpenFile: OpenFile;
  sidebar: boolean;
  toggleSidebar: () => void;
  favorites: Record<string, boolean>;
  toggleTag: (key: string, folder: boolean) => void;
  updateFavorites: (oldKey: string, newKey?: string) => void;
  back?: () => void;
  forward?: () => void;
};

function Finder({ path, inventory, disk, confirmed, approve, view, setView, onOpenFile, sidebar, toggleSidebar, favorites, toggleTag, updateFavorites, back, forward, copied, setCopied }: FinderProps) {
  const navigate = useNavigate();
  const [query, setQuery] = useState('');
  const searchInput = useRef<HTMLInputElement>(null);
  const [descending, setDescending] = useState(false);
  const [foldersFirst, setFoldersFirst] = useState(true);
  const { state } = useLocation();
  const [selected, setSelected] = useState<string>(typeof state?.selection === 'string' ? state.selection : '');
  useEffect(() => { if (typeof state?.selection === 'string') setSelected(state.selection); }, [state?.selection]);
  const tagged = Object.keys(favorites);
  const [expanded, setExpanded] = useState<string[]>([]);
  const [context, setContext] = useState<{ x: number; y: number; source?: CopiedFile; directory: string; parent: string; entry?: Entry }>();
  const [edit, setEdit] = useState<{ directory: string; entry?: Entry }>();
  const [editError, setEditError] = useState('');
  const [savingEdit, setSavingEdit] = useState(false);
  const [action, setAction] = useState<{ kind: 'delete' | 'details' | 'wake'; directory: string; entry?: Entry }>();
  const actionDialog = useRef<HTMLDialogElement>(null);
  const [actionError, setActionError] = useState('');
  const [deleting, setDeleting] = useState(false);
  const editDialog = useRef<HTMLDialogElement>(null);
  const editInput = useRef<HTMLInputElement>(null);
  const [pendingCopies, setPendingCopies] = useState<{ id: number; directory: string; url: string; name: string }[]>([]);
  const [fileMessage, setFileMessage] = useState('');
  const [pasting, setPasting] = useState(false);
  const contextRef = useRef<HTMLDivElement>(null);
  const browserRef = useRef<HTMLDivElement>(null);
  const selectedRef = useRef<HTMLAnchorElement>(null);
  const columnsRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const columns = columnsRef.current;
    if (columns) columns.parentElement?.scrollTo({ left: columns.scrollWidth });
  }, [view, path]);
  const { loading, error, refresh } = inventory;
  const disks = [...inventory.disks].sort(compareDisks);
  const parts = path ? path.split('/') : [];
  const rootVolume = systemRoot(disk);
  // Keep existing mount-ID URLs, while presenting the root volume as the disk itself.
  const rootVolumePath = disk && rootVolume && disk.volumes.length > 1 ? join(disk.id, rootVolume.id) : undefined;
  const ancestors = ['', ...parts.map((_, i) => parts.slice(0, i + 1).join('/'))]
    .filter(directory => directory !== rootVolumePath);
  const [contents, setContents] = useState<Record<string, { entries: Entry[]; error?: string }>>({});
  const gated = !!disk && disk.volumes.length > 0 && (disk.system || disk.mayWake) && !confirmed;
  const activeURL = disk && !gated ? diskURL(disk, path, 'entries', confirmed) : undefined;
  const listsVolumes = !!disk && disk.volumes.length > 1 && !rootVolume;

  function entryPath(directory: string, entry: Entry) {
    return join(directory === disk?.id && rootVolumePath ? rootVolumePath : directory, segment(entry));
  }

  function locationName(directory: string) {
    if (!directory) return '硬盘';
    const segments = directory.split('/');
    if (disk && (segments.length === 1 || directory === rootVolumePath)) return diskName(disk);
    if (segments.length === 2 && disk && disk.volumes.length > 1) {
      return disk.volumes.find(volume => volume.id === segments[1])?.mount ?? segments[1];
    }
    return segments.at(-1) ?? directory;
  }

  function readDirectory(directory: string, url: string, signal?: AbortSignal) {
    return apiResponse<Entry[]>(url, { signal }).then(entries => {
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
    if (!directory) {
      const orderedDisks = descending ? [...disks].sort((a, b) => compareDisks(a, b, true)) : disks;
      return orderedDisks.map(device => ({
        name: diskName(device), segment: device.id, kind: 'directory',
        bytes: device.bytes, detail: diskKind(device),
      } satisfies Entry)).filter(entry => entry.name.toLocaleLowerCase().includes(query.trim().toLocaleLowerCase()));
    }
    if (!gated && disk) {
      entries = directory === disk.id && listsVolumes
        ? disk.volumes.map(volume => ({ name: volume.mount, segment: volume.id, kind: 'directory', bytes: 0, detail: '挂载分区' }))
        : contents[directory]?.entries ?? [];
    }
    return entries.filter(entry => entry.name.toLocaleLowerCase().includes(query.trim().toLocaleLowerCase()))
      .sort((a, b) =>
        (foldersFirst ? Number(b.kind === 'directory') - Number(a.kind === 'directory') : 0) ||
        a.name.localeCompare(b.name, 'zh-CN') * (descending ? -1 : 1));
  }

  const rows = getRows(path);
  const selection = rows.find(entry => entryPath(path, entry) === selected);
  const selectedItem = selection ? { entry: selection, directory: path } : Object.entries(contents).flatMap(([directory, data]) => data.entries.map(entry => ({ entry, directory }))).find(item => entryPath(item.directory, item.entry) === selected);
  const preview = rows.find(entry => entryPath(path, entry) === selected) ?? rows[0];
  const previewURL = preview && disk && !gated && preview.kind !== 'directory'
    ? diskURL(disk, entryPath(path, preview), 'file', confirmed) : undefined;
  const message = error || (loading && !disks.length ? '正在读取硬盘信息…' :
    path && !disk ? '找不到此硬盘。请刷新硬盘列表。' :
    disk && !disk.volumes.length ? '此硬盘没有已挂载的分区。请在 Debian 挂载后刷新硬盘。' :
    contents[path]?.error || (activeURL && !contents[path] ? '正在读取目录…' :
    path && !gated && !(listsVolumes && parts.length === 1) && !activeURL ? '分区挂载已变化，请返回硬盘列表。' : ''));

  function copySource(entry: Entry, directory: string): CopiedFile | undefined {
    if (!disk || gated) return;
    const source = diskLocation(disk, entryPath(directory, entry), confirmed);
    return source && { name: entry.name, source };
  }

  function copy(file: CopiedFile) {
    setCopied(file);
    setFileMessage('已复制「' + file.name + '」');
    setContext(undefined);
    selectedRef.current?.focus({ preventScroll: true });
  }

  function pasteTarget(directory: string) {
    if (!disk || disk.system || gated || (!activeURL && directory === path) || pasting) return;
    return diskLocation(disk, directory, confirmed);
  }

  useEffect(() => {
    if (!pendingCopies.length) return;
    const controller = new AbortController();
    let timer: number;
    async function poll() {
      try {
        const tasks = await apiResponse<{ id: number; state: string; error: string }[]>('/api/copy-tasks', { signal: controller.signal });
        if (controller.signal.aborted) return;
        const finished = pendingCopies.filter(copy => !tasks.some(task => task.id === copy.id && (task.state === 'queued' || task.state === 'running')));
        for (const copy of finished) {
          const task = tasks.find(task => task.id === copy.id);
          setFileMessage(task?.error || (task ? '已粘贴「' + copy.name + '」' : '复制任务记录已清除。'));
          void readDirectory(copy.directory, copy.url);
        }
        if (finished.length) {
          setPendingCopies(current => current.filter(copy => !finished.some(item => item.id === copy.id)));
          return;
        }
      } catch {}
      if (!controller.signal.aborted) timer = window.setTimeout(poll, 1000);
    }
    timer = window.setTimeout(poll, 1000);
    return () => { controller.abort(); window.clearTimeout(timer); };
  }, [pendingCopies]);

  function editItem(directory: string, entry?: Entry) {
    setContext(undefined);
    setEditError('');
    setEdit({ directory, entry });
  }

  useLayoutEffect(() => {
    if (!edit) return;
    editDialog.current?.showModal();
    editInput.current?.select();
  }, [edit]);

  function closeEdit(saved = false) {
    editDialog.current?.close();
    setEdit(undefined);
    (saved ? browserRef.current : selectedRef.current ?? browserRef.current)?.focus({ preventScroll: true });
  }

  function inspect(kind: 'delete' | 'details', directory: string, entry: Entry) {
    setContext(undefined); setActionError(''); setAction({ kind, directory, entry });
  }
  useLayoutEffect(() => { if (action) actionDialog.current?.showModal(); }, [action]);
  function closeAction() { actionDialog.current?.close(); setAction(undefined); setActionError(''); }
  async function deleteItem() {
    if (!action?.entry || !disk || disk.system || gated || deleting) return;
    const directory = diskLocation(disk, action.directory, confirmed);
    const url = diskURL(disk, action.directory, 'entries', confirmed);
    if (!directory || !url) return;
    setDeleting(true); setActionError('');
    try {
      await apiResponse('/api/file-edit', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ action: 'delete', confirmDelete: true, directory, name: action.entry.name }) });
      updateFavorites(entryPath(action.directory, action.entry));
      setSelected(''); setExpanded([]); setFileMessage('已永久删除「' + action.entry.name + '」'); closeAction();
    } catch (reason) { setActionError(reason instanceof Error ? reason.message : '删除未完成，请刷新检查。'); }
    finally { setDeleting(false); void readDirectory(action.directory, url); }
  }

  async function copyLink(key: string) {
    const url = new URL(location.href); url.hash = route(key);
    try { await navigator.clipboard.writeText(url.href); setFileMessage('已复制位置链接'); }
    catch { setFileMessage('无法访问剪贴板。位置链接：' + url.href); }
    setContext(undefined);
  }

  async function saveEdit() {
    if (!edit || savingEdit) return;
    const { directory, entry } = edit;
    if (!disk || disk.system || gated) return;
    const location = diskLocation(disk, directory, confirmed);
    const url = diskURL(disk, directory, 'entries', confirmed);
    if (!location || !url) return;
    const name = editInput.current?.value ?? '';
    if (name === entry?.name) {
      closeEdit();
      return;
    }
    if (!name.trim() || name === '.' || name === '..' || /[/\\\x00]/.test(name)) {
      setEditError('请输入有效名称，名称不能包含路径分隔符。');
      editInput.current?.focus();
      return;
    }
    setSavingEdit(true);
    setEditError('');
    try {
      await apiResponse('/api/file-edit', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ directory: location, name, oldName: entry?.name }),
      });
      if (entry) updateFavorites(entryPath(directory, entry), entryPath(directory, { ...entry, name }));
      setSelected('');
      closeEdit(true);
      void readDirectory(directory, url);
      setFileMessage(entry ? '已重命名为「' + name + '」' : '已新建「' + name + '」');
    } catch (reason) {
      setEditError(reason instanceof Error ? reason.message : '操作失败。');
      editInput.current?.focus();
    } finally {
      setSavingEdit(false);
    }
  }

  async function paste(directory: string, sourceApproved = false) {
    const target = pasteTarget(directory);
    if (!target || !copied) return;
    setContext(undefined);
    browserRef.current?.focus({ preventScroll: true });
    const sourceDisk = disks.find(device => device.id === copied.source.disk);
    if (sourceDisk?.mayWake && sourceDisk.id !== target.disk && !sourceApproved) { setActionError(''); setAction({ kind: 'wake', directory }); return; }
    setPasting(true);
    setFileMessage('正在粘贴「' + copied.name + '」…');
    try {
      const result = await apiResponse<{ id: number }>('/api/paste', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ source: copied.source, target }),
      });
      const url = disk && diskURL(disk, directory, 'entries', confirmed);
      if (url) setPendingCopies(current => [...current, { id: result.id, directory, url, name: copied.name }]);
      setFileMessage('已加入复制队列，可在“日志”查看进度。');
    } catch (reason) {
      setFileMessage(reason instanceof Error ? reason.message : '粘贴失败。');
    } finally {
      setPasting(false);
    }
  }

  function showContext(event: MouseEvent, entry?: Entry, directory = path) {
    event.preventDefault();
    event.stopPropagation();
    showFileMenu(event.clientX, event.clientY, entry, directory);
  }

  function showFileMenu(x: number, y: number, entry?: Entry, directory = path) {
    const key = entry && entryPath(directory, entry);
    if (key) setSelected(key);
    setContext({
      x: Math.max(6, Math.min(x, window.innerWidth - 238)),
      y: Math.max(6, Math.min(y, window.innerHeight - 390)),
      parent: directory,
      entry,
      source: entry && copySource(entry, directory),
      directory: entry?.kind === 'directory' && directory && key ? key : directory,
    });
  }

  function item(entry: Entry, directory: string, children: ReactNode, openFolderOnClick = false) {
    const key = entryPath(directory, entry);
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
      onContextMenu={event => showContext(event, entry, directory)}
      onClick={event => {
        if (modified(event) || (!event.detail && entry.kind === 'file')) return;
        event.preventDefault();
        if (event.detail && !(folder && openFolderOnClick)) setSelected(key);
        else open(event.currentTarget);
      }}
      onDoubleClick={event => {
        if (modified(event) || (folder && openFolderOnClick)) return;
        open(event.currentTarget);
      }}>{children}{tagged.includes(key) && <i className="finder-tag" aria-label="已收藏" />}</a>;
  }

  function listRows(entries: Entry[], directory: string, depth = 0): ReactNode {
    return entries.flatMap(entry => {
      const { name, kind, bytes, modified, detail } = entry;
      const folder = kind === 'directory';
      const key = entryPath(directory, entry);
      const open = expanded.includes(key);
      const row = <tr key={key} data-selected={selected === key} onContextMenu={event => showContext(event, entry, directory)} onClick={event => {
        if (!(event.target as Element).closest('a, button')) setSelected(key);
      }}>
        <td><div className="finder-name" style={{ paddingInlineStart: depth * 15 }}>
          {folder && directory ? <button className="finder-disclosure" type="button" aria-label={(open ? '折叠 ' : '展开 ') + name}
            aria-expanded={open} onClick={() => {
              setExpanded(open ? expanded.filter(value => value !== key) : [...expanded, key]);
              const url = disk && !gated ? diskURL(disk, key, 'entries', confirmed) : undefined;
              if (!open && url && !contents[key]?.entries.length) void readDirectory(key, url);
            }}><Icon name="right" /></button>
            : <span className="finder-disclosure" />}
          {item(entry, directory, <><FileIcon type={kind} />{name}</>)}
        </div></td>
        <td>{modified ? new Date(modified).toLocaleString('zh-CN') : '—'}</td><td>{disk ? diskName(disk) : name}</td><td>{detail ?? fileKinds[kind]}</td><td>{!folder || bytes ? formatBytes(bytes) : '—'}</td>
      </tr>;
      if (!open) return [row];
      const children = getRows(key);
      return children.length ? [row, listRows(children, key, depth + 1)] : [
        row, <tr key={key + ':empty'}><td colSpan={5} style={{ paddingInlineStart: 28 + depth * 15 }}>
          {contents[key]?.error ?? (contents[key] ? '此目录为空' : '正在读取目录…')}
        </td></tr>,
      ];
    });
  }


  useEffect(() => {
    if (document.activeElement === document.body) browserRef.current?.focus({ preventScroll: true });
  }, []);

  useEffect(() => {
    if (!context) return;
    contextRef.current?.showPopover();
    const dismiss = (event: PointerEvent) => {
      if (!contextRef.current?.contains(event.target as Node)) setContext(undefined);
    };
    document.addEventListener('pointerdown', dismiss);
    contextRef.current?.focus({ preventScroll: true });
    return () => { document.removeEventListener('pointerdown', dismiss); contextRef.current?.hidePopover(); };
  }, [context]);

  return <section className="finder" data-sidebar={sidebar} aria-label="文件管理"
    onKeyDown={event => {
      if (event.key === 'Escape') {
        if (context) { setContext(undefined); (selectedRef.current ?? browserRef.current)?.focus({ preventScroll: true }); }
        else if (query) setQuery('');
        else setSelected('');
      }
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === 'f') {
        event.preventDefault();
        searchInput.current?.focus();
      }
      if (event.shiftKey && event.key === 'F10' && selectedItem) {
        event.preventDefault(); const rect = selectedRef.current?.getBoundingClientRect();
        showFileMenu(rect?.left ?? 100, rect?.bottom ?? 100, selectedItem.entry, selectedItem.directory);
      }
      if (!(event.metaKey || event.ctrlKey) || (event.target as Element).closest('input, textarea, [contenteditable]')) return;
      const shortcut = event.key.toLowerCase();
      if (shortcut === 'c' && selected && window.getSelection()?.isCollapsed) {
        const url = disk && !gated && selectedRef.current && diskLocation(disk, selected, confirmed);
        const name = selected.split('/').pop();
        if (url && name) { event.preventDefault(); copy({ name, source: url }); }
      }
      if (shortcut === 'v' && copied && pasteTarget(path)) {
        event.preventDefault();
        void paste(path);
      }
    }}>
    <aside className="fp-sidebar finder-sidebar">
      <nav aria-label="硬盘位置">
        <Link to={root} data-active={!path} aria-current={!path ? 'location' : undefined}><Icon name="apps" /><span>所有硬盘</span></Link>
        <p className="finder-sidebar-label">位置</p>
        {disks.map(device => <Link key={device.id} to={route(device.id)} data-active={device.id === disk?.id} aria-current={device.id === disk?.id ? 'location' : undefined}
          title={[device.id, ...device.volumes.map(volume => volume.mount), device.model, diskKind(device)].filter(Boolean).join(' · ')}>
          <Icon name="drive" /><span>{diskName(device)}</span>{(device.system || device.mayWake) && <span className="finder-disk-badge"><Icon name={device.system ? 'warning' : 'moon'} /></span>}
        </Link>)}
        {!!tagged.length && <><p className="finder-sidebar-label">收藏的位置</p>{tagged.map(key => <Link key={key} to={route(favorites[key] ? key : key.split('/').slice(0, -1).join('/'))} title={key} state={favorites[key] ? undefined : { selection: key }}><Icon name="star" /><span>{key.split('/').at(-1)}</span></Link>)}</>}
      </nav>
      <div className="fp-sidebar-footer"><Icon name="drive" /><span><strong>{disks.length} 个硬盘</strong><small>{error ? '连接异常' : '仅枚举内核元数据'}</small></span></div>
    </aside>
    <div className="finder-content fp-content">
      <header className="fp-locationbar">
        {!sidebar && <button className="fp-refresh" type="button" aria-label="显示边栏" onClick={toggleSidebar}><Icon name="sidebar" /></button>}
        <div className="fp-history" role="group" aria-label="浏览历史"><button type="button" aria-label="后退" disabled={!back} onClick={back}><Icon name="left" /></button><button type="button" aria-label="前进" disabled={!forward} onClick={forward}><Icon name="right" /></button></div>
        <button className="fp-refresh" type="button" aria-label="刷新当前目录" disabled={loading} onClick={() => { if (activeURL) void readDirectory(path, activeURL); else void refresh(); }}><Icon name="refresh" /></button>
        <nav className="fp-breadcrumb" aria-label="当前位置"><span><Link to={root}>所有硬盘</Link></span>{ancestors.slice(1).map(directory => <span key={directory}><Icon name="right" /><Link to={route(directory)}>{locationName(directory)}</Link></span>)}</nav>
        <label className="fp-search"><Icon name="search" /><input ref={searchInput} type="search" aria-label="搜索当前目录" placeholder="搜索" value={query} onChange={event => { setQuery(event.target.value); setSelected(''); }} /></label>
      </header>
      <div className="fp-actions">
        <button type="button" aria-label="新建文件夹" title="新建文件夹" disabled={!activeURL || disk?.system || gated} onClick={() => editItem(path)}><Icon name="folder" /><span>新建文件夹</span></button>
        <button type="button" aria-label="粘贴" title="粘贴" disabled={!copied || !pasteTarget(path)} onClick={() => void paste(path)}><Icon name="paste" /><span>粘贴</span></button>
        <button type="button" aria-label="重命名" title="重命名" disabled={!selectedItem || !disk || gated || disk.system} onClick={() => selectedItem && editItem(selectedItem.directory, selectedItem.entry)}><Icon name="rename" /><span>重命名</span></button>
        <button type="button" aria-label="删除" title="删除" disabled={!selectedItem || !disk || gated || disk.system} onClick={() => selectedItem && inspect('delete', selectedItem.directory, selectedItem.entry)}><Icon name="trash" /><span>删除</span></button>
        <button type="button" aria-label="更多文件操作" onClick={event => { const rect = event.currentTarget.getBoundingClientRect(); showFileMenu(rect.left, rect.bottom + 6, selectedItem?.entry, selectedItem?.directory ?? path); }}><Icon name="more" /><span>更多</span></button>
        <div className="fp-view-actions"><button type="button" aria-label="名称排序" aria-pressed={descending} onClick={() => setDescending(!descending)}><Icon name="sort" /></button><button type="button" aria-label={sidebar ? '隐藏边栏' : '显示边栏'} onClick={toggleSidebar}><Icon name="sidebar" /></button><div>{(Object.keys(modes) as Mode[]).map(mode => <button key={mode} type="button" aria-label={modes[mode]} aria-pressed={view === mode} title={modes[mode]} onClick={() => setView(mode)}><Icon name={mode === 'icons' ? 'apps' : mode} /></button>)}</div></div>
      </div>
      <div className="finder-browser" ref={browserRef} tabIndex={-1} onContextMenu={event => showContext(event)}
        onClick={event => { if (event.target === event.currentTarget) setSelected(''); }}>
        {gated ? <div className="finder-disk-notice" role="region" aria-label="硬盘访问确认">
          <Icon name={disk.system ? 'warning' : 'moon'} />
          <h2>{disk.system ? '系统盘，请谨慎修改' : '此硬盘可能正在休眠'}</h2>
          {disk.system && <p>这里是 Debian 系统盘。文件管理器以只读方式打开。</p>}
          {disk.mayWake && <p>继续读取目录可能会唤醒硬盘。</p>}
          <div><Link to={root}>返回硬盘列表</Link><button type="button" onClick={approve}>继续打开</button></div>
        </div> : message ? <p className="finder-empty" role="status">{message}</p> : <>
        {view === 'list' && <div className="finder-list">
          <table className="fp-file-table">
            <thead><tr><th scope="col" aria-sort={descending ? 'descending' : 'ascending'}>
              <button type="button" onClick={() => setDescending(!descending)}>名称<span data-descending={descending}><Icon name="right" /></span></button>
            </th><th scope="col">修改时间</th><th scope="col">所在位置</th><th scope="col">类型</th><th scope="col">大小</th></tr></thead>
            <tbody>{listRows(rows, path)}</tbody>
          </table>
        </div>}
        {view === 'icons' && <ul className="finder-grid">{rows.map(entry => <li key={segment(entry)} data-selected={selected === entryPath(path, entry)}>
          {item(entry, path, <><FileIcon type={entry.kind} /><span>{entry.name}</span></>)}
        </li>)}</ul>}
        {view === 'columns' && <div className="finder-columns" ref={columnsRef}>{ancestors.map((directory, i) => <ul key={directory} aria-label={locationName(directory)}>
          {(i === ancestors.length - 1 ? rows : getRows(directory)).map(entry => <li key={segment(entry)}
            data-selected={ancestors[i + 1] === entryPath(directory, entry) || selected === entryPath(directory, entry)}>
            {item(entry, directory, <><FileIcon type={entry.kind} /><span>{entry.name}</span>{entry.kind === 'directory' && <Icon name="right" />}</>, true)}
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
      {context && <div ref={contextRef} tabIndex={-1} className="fp-context finder-context-menu" popover="manual" role="dialog" aria-label="文件快捷操作" style={{ left: context.x, top: context.y }}>
        {context.entry ? <>
          <button type="button" onClick={() => { selectedRef.current?.click(); setContext(undefined); }}><Icon name="external" />打开<span>↵</span></button>
          {context.entry.kind !== 'directory' && context.source && disk && <button type="button" onClick={() => { const url = diskURL(disk, entryPath(context.parent, context.entry!), 'file', confirmed); if (url) window.location.assign(url + '&download=1'); setContext(undefined); }}><Icon name="download" />下载</button>}
          <hr />
          {context.source && <button type="button" onClick={() => { if (context.source) copy(context.source); }}><Icon name="copy" />复制<span>Ctrl/⌘ C</span></button>}
          {context.entry.kind === 'directory' && disk && !disk.system && <button type="button" disabled={!copied || !pasteTarget(context.directory)} onClick={() => void paste(context.directory)}><Icon name="paste" />粘贴到此文件夹</button>}
          {context.source && disk && !disk.system && <><button type="button" onClick={() => editItem(context.parent, context.entry)}><Icon name="rename" />重命名</button><button type="button" className="finder-danger" onClick={() => inspect('delete', context.parent, context.entry!)}><Icon name="trash" />删除</button></>}
          <hr /><button type="button" onClick={() => { toggleTag(entryPath(context.parent, context.entry!), context.entry!.kind === 'directory'); setContext(undefined); }}><Icon name="star" />{tagged.includes(entryPath(context.parent, context.entry)) ? '取消收藏' : '收藏'}</button>
          <button type="button" onClick={() => void copyLink(context.entry?.kind === 'directory' ? entryPath(context.parent, context.entry) : context.parent)}><Icon name="link" />复制位置链接</button>
          <button type="button" onClick={() => inspect('details', context.parent, context.entry!)}><Icon name="info" />详细信息</button>
        </> : <>
          {activeURL && disk && !disk.system && <><button type="button" onClick={() => editItem(context.directory)}><Icon name="folder" />新建文件夹</button><button type="button" disabled={!copied || !pasteTarget(context.directory)} onClick={() => void paste(context.directory)}><Icon name="paste" />粘贴项目<span>Ctrl/⌘ V</span></button><hr /></>}
          <button type="button" onClick={() => { if (activeURL) void readDirectory(path, activeURL); else void inventory.refresh(); setContext(undefined); }}><Icon name="refresh" />{activeURL ? '刷新当前目录' : '刷新硬盘'}</button>
          <button type="button" onClick={() => { setDescending(!descending); setContext(undefined); }}><Icon name="sort" />{descending ? '名称升序' : '名称降序'}</button>
          <button type="button" onClick={() => { setFoldersFirst(!foldersFirst); setContext(undefined); }}><Icon name="folder" />{foldersFirst ? '取消文件夹优先' : '文件夹排在前面'}</button>
        </>}
      </div>}
      {edit && <dialog ref={editDialog} className="finder-edit-dialog" aria-labelledby="finder-edit-title"
        onKeyDown={event => event.stopPropagation()} onCancel={event => {
          event.preventDefault();
          if (!savingEdit) closeEdit();
        }}>
        <form onSubmit={event => { event.preventDefault(); void saveEdit(); }} aria-busy={savingEdit}>
          <header>
            <FileIcon type={edit.entry?.kind ?? 'directory'} />
            <div>
              <h2 id="finder-edit-title">{edit.entry ? '重命名' : '新建文件夹'}</h2>
              <p>{edit.entry ? '为所选项目输入新名称' : '在「' + locationName(edit.directory) + '」中创建文件夹'}</p>
            </div>
          </header>
          <label htmlFor="finder-edit-name">名称</label>
          <input ref={editInput} id="finder-edit-name" autoFocus autoComplete="off" spellCheck={false}
            defaultValue={edit.entry?.name ?? '新建文件夹'} readOnly={savingEdit}
            aria-invalid={!!editError} aria-describedby={editError ? 'finder-edit-error' : undefined}
            onChange={() => setEditError('')} />
          {editError && <p id="finder-edit-error" className="finder-edit-error" role="alert">{editError}</p>}
          <footer>
            <button type="button" disabled={savingEdit} onClick={() => closeEdit()}>取消</button>
            <button type="submit" disabled={savingEdit}>{savingEdit ? '处理中…' : edit.entry ? '保存' : '创建'}</button>
          </footer>
        </form>
      </dialog>}
      {action && <dialog ref={actionDialog} className="fp-dialog finder-action-dialog" aria-labelledby="finder-action-title" onKeyDown={event => event.stopPropagation()} onCancel={event => { event.preventDefault(); if (!deleting) closeAction(); }}>
        <h2 id="finder-action-title">{action.kind === 'delete' ? '永久删除项目' : action.kind === 'wake' ? '源硬盘可能正在休眠' : '详细信息'}</h2>
        {action.kind === 'delete' ? <><div className="finder-warning-icon"><Icon name="warning" /></div><p>确定永久删除「{action.entry?.name}」？</p><p className="finder-action-note">文件夹及其中所有内容都会被删除，此操作无法恢复。</p></> : action.kind === 'wake' ? <><div className="finder-warning-icon"><Icon name="moon" /></div><p>粘贴需要重新读取源硬盘，可能将它从休眠中唤醒。</p></> : <dl><dt>名称</dt><dd>{action.entry?.name}</dd><dt>类型</dt><dd>{action.entry && (action.entry.detail ?? fileKinds[action.entry.kind])}</dd><dt>大小</dt><dd>{action.entry?.kind === 'directory' ? '—' : formatBytes(action.entry?.bytes ?? 0)}</dd><dt>修改时间</dt><dd>{action.entry?.modified ? new Date(action.entry.modified).toLocaleString('zh-CN') : '—'}</dd><dt>位置</dt><dd>{action.entry && entryPath(action.directory, action.entry)}</dd><dt>磁盘</dt><dd>{disk ? diskName(disk) : action.entry?.name}</dd></dl>}
        {actionError && <p className="finder-edit-error" role="alert">{actionError}</p>}
        <footer><button type="button" disabled={deleting} onClick={closeAction}>{action.kind === 'details' ? '关闭' : '取消'}</button>{action.kind === 'delete' && <button type="button" className="finder-delete-confirm" disabled={deleting} onClick={() => void deleteItem()}>{deleting ? '正在删除…' : '永久删除'}</button>}{action.kind === 'wake' && <button type="button" className="fp-primary" onClick={() => { const directory = action.directory; closeAction(); void paste(directory, true); }}>继续粘贴</button>}</footer>
      </dialog>}
      {fileMessage && <p className="finder-file-message" role="status">{fileMessage}</p>}
      {<footer className="finder-status fp-file-status">
        <nav aria-label="当前路径"><Link to={root}><Icon name="drive" />硬盘</Link>
          {ancestors.slice(1).map((directory) => <span key={directory}><Icon name="right" /><Link to={route(directory)}><FileIcon type="directory" />{locationName(directory)}</Link></span>)}
        </nav>
        <span aria-live="polite">{selected ? '已选中 1 项，共 ' : ''}{rows.length} 个项目</span>
      </footer>}
    </div>
  </section>;
}

function FileIcon({ type }: { type: string }) {
  return type === 'directory' ? <span className="finder-file-icon"><Folder small /></span> : <span className={'finder-file-icon fp-document fp-document-' + type}><Icon name={type === 'image' ? 'image' : type === 'video' ? 'video' : 'text'} /></span>;
}
