const paths = {
  columns: 'M3 4h18v16H3zM9 4v16m6-16v16',
  gallery: 'M3 3h18v13H3zM4 21h2m4 0h2m4 0h2m3 0h.1',
  sidebar: 'M3 4h18v16H3zM9 4v16M5 8h2m-2 3h2m-2 3h2',
  warning: 'M12 3 2 21h20zM12 9v5m0 3h.01',
  paste: 'M9 4H5v17h14V4h-4M9 2h6v5H9zM8 12h8m-8 4h5',
  folder: 'M3 7V5a2 2 0 0 1 2-2h5l2 3h7a2 2 0 0 1 2 2v11H3z',
  settings: 'M9 3h6l1 3 3 1 2 5-2 5-3 1-1 3H9l-1-3-3-1-2-5 2-5 3-1zM16 12a4 4 0 1 1-8 0 4 4 0 0 1 8 0',
  apps: 'M4 4h6v6H4zM14 4h6v6h-6zM4 14h6v6H4zM14 14h6v6h-6z',
  download: 'M12 3v12m-5-5 5 5 5-5M4 16v5h16v-5',
  monitor: 'M3 4h18v14H3zM8 22h8m-4-4v4M5 12h3l2-5 4 9 2-5h3',
  star: 'm12 3 3 6 7 1-5 5 1 7-6-3-6 3 1-7-5-5 7-1z',
  external: 'M13 3h8v8m0-8L10 14M10 4H3v17h17v-7',
  drive: 'M3 15 6 4h12l3 11v5H3zM3 15h18m-5 3h2',
  link: 'm10 14 4-4M8 16l-2 2a4 4 0 0 1-6-6l5-5a4 4 0 0 1 6 0m2 1 2-2a4 4 0 0 1 6 6l-5 5a4 4 0 0 1-6 0',
  left: 'm14 6-6 6 6 6', right: 'm9 6 6 6-6 6',
  refresh: 'M20 10a8 8 0 1 0 0 6M20 3v7h-7', search: 'M16 10a6 6 0 1 1-12 0 6 6 0 0 1 12 0m-1 5 6 6',
  trash: 'M3 6h18M9 6V3h6v3M5 6l1 15h12l1-15M10 10v7m4-7v7',
  more: 'M4 12h1m6 0h1m6 0h1', list: 'M8 6h13M8 12h13M8 18h13M3 6h.01M3 12h.01M3 18h.01',
  sort: 'M4 6h12M4 11h9M4 16h6m9-9v14m-3-3 3 3 3-3',
  copy: 'M9 9h12v12H9zM15 9V3H3v12h6', rename: 'M4 17v4h4L21 8l-5-5zM13 6l5 5',
  info: 'M22 12a10 10 0 1 1-20 0 10 10 0 0 1 20 0M12 11v6m0-10h.01',
  sun: 'M16 12a4 4 0 1 1-8 0 4 4 0 0 1 8 0M12 1v3m0 16v3M1 12h3m16 0h3M4 4l2 2m12 12 2 2M4 20l2-2M18 6l2-2',
  moon: 'M21 14a9 9 0 0 1-11-11A9 9 0 1 0 21 14',
  text: 'M5 2h9l5 5v15H5zM14 2v6h5M8 12h8m-8 4h6',
  image: 'M3 3h18v18H3zM3 17l6-7 5 6 3-3 4 5M16 7h.01',
  video: 'M3 4h18v16H3zM10 8l6 4-6 4z',
  close: 'm6 6 12 12M6 18 18 6', minimize: 'M5 12h14', maximize: 'M5 5h14v14H5z',
} as const;
export type IconName = keyof typeof paths;
export function Icon({ name }: { name: IconName }) {
  return <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d={paths[name]} /></svg>;
}
export function Folder({ small = false }: { small?: boolean }) {
  return <span className={`fp-folder ${small ? 'fp-folder-small' : ''}`} aria-hidden="true"><span /></span>;
}
