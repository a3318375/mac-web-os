export type Point = { x: number; y: number };
export type Bounds = { width: number; height: number };
export type Geometry = Point & Bounds;
export type Edge = 'n' | 'ne' | 'e' | 'se' | 's' | 'sw' | 'w' | 'nw';
const clamp = (n: number, min: number, max: number) => Math.max(min, Math.min(n, max));
export function fitWindow(rect: Geometry, view: Bounds): Geometry {
  const width = Math.min(rect.width, view.width), height = Math.min(rect.height, view.height);
  return { width, height, x: clamp(rect.x, 0, view.width - width), y: clamp(rect.y, 0, view.height - height) };
}
export function resizeWindow(rect: Geometry, edge: Edge, dx: number, dy: number, view: Bounds): Geometry {
  const minWidth = Math.min(440, edge.includes('w') ? rect.x + rect.width : view.width - rect.x);
  const minHeight = Math.min(300, edge.includes('n') ? rect.y + rect.height : view.height - rect.y);
  let { x, y, width, height } = rect;
  if (edge.includes('e')) width = clamp(width + dx, minWidth, view.width - x);
  if (edge.includes('s')) height = clamp(height + dy, minHeight, view.height - y);
  if (edge.includes('w')) { x = clamp(x + dx, 0, rect.x + rect.width - minWidth); width = rect.x + rect.width - x; }
  if (edge.includes('n')) { y = clamp(y + dy, 0, rect.y + rect.height - minHeight); height = rect.y + rect.height - y; }
  return { x, y, width, height };
}
// Column-first fixed cells; saved positions always map to distinct slots.
export function iconCells(view: Bounds, count: number): Point[] {
  const left = view.width > 690 ? 96 : 12, top = view.width > 690 ? 36 : 70;
  const bottom = view.width > 690 ? 12 : 82;
  const columns = Math.max(1, Math.floor((view.width - left - 12) / 108));
  const rows = Math.max(Math.ceil(count / columns), Math.floor((view.height - top - bottom) / 108));
  const stepX = 108, stepY = 108;
  return Array.from({ length: rows * columns }, (_, i) => ({ x: left + Math.floor(i / rows) * stepX, y: top + i % rows * stepY }));
}
export function nearestCell(point: Point, cells: Point[]) {
  return cells.reduce((best, cell) => Math.hypot(cell.x - point.x, cell.y - point.y) < Math.hypot(best.x - point.x, best.y - point.y) ? cell : best);
}
export function arrangeIcons<T extends string>(ids: readonly T[], stored: Partial<Record<T, Point>>, cells: Point[]): Record<T, Point> {
  const available = [...cells];
  return Object.fromEntries(ids.map(id => {
    const point = stored[id];
    const cell = point && Number.isFinite(point.x) && Number.isFinite(point.y) ? nearestCell(point, available) : available[0];
    available.splice(available.indexOf(cell), 1);
    return [id, cell];
  })) as Record<T, Point>;
}
export function dropIcon<T extends string>(icons: Record<T, Point>, id: T, cell: Point): Record<T, Point> {
  const occupant = (Object.keys(icons) as T[]).find(key => key !== id && icons[key].x === cell.x && icons[key].y === cell.y);
  return { ...icons, ...(occupant ? { [occupant]: icons[id] } : {}), [id]: cell };
}
