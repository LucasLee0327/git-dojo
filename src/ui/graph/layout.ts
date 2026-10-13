// 直式分支圖的欄位（lane）配置：最新在上、每個 commit 一列。
// 保證：任何一條線都不會穿過與它無關的節點（見 tests/layout.test.ts）。
//
// 做法：像 `git log --graph`，由上往下掃，每條 lane 記住「它在等哪個 commit」。
// 只有被等待的 commit 才能出現在那條 lane 上，所以 lane 的垂直線不可能穿過別的節點；
// 換 lane 的斜線只發生在兩列之間的「半列」帶狀區域，那裡沒有任何節點。
import { branchKey } from './colors';

export const LANE_W = 16;
export const ROW_H = 44;
export const PAD_X = 14;
export const PAD_Y = 24;
export const NODE_R = 6;
export const RING = 3;
/** 標籤太多、排不進同一行時，每多一行標籤多出來的列高 */
export const CHIP_H = 22;

export interface LCommit {
  parents: string[];
  time: number;
  squashOf?: string[];
}
export interface LRef {
  name: string;
  kind: 'local' | 'remote' | 'github';
  id: string;
}
export interface GraphInput {
  commits: Record<string, LCommit>;
  refs: LRef[];
  extraTips?: string[];
  maxRows?: number;
  /** commit id → 這一列在 commit 訊息上方多放了幾行分支標籤（列高 = ROW_H + 行數 × CHIP_H） */
  rowLines?: Record<string, number>;
}

export type Pt = [number, number];
export interface LPath {
  d: string;
  /** 取樣後的折線（給碰撞測試用；虛線梳狀的每一段各自一條） */
  polys: Pt[][];
}
export interface LNode {
  id: string;
  row: number;
  lane: number;
  x: number;
  y: number;
  /** 這一列的高度（節點在列的正中央） */
  h: number;
  owner: string;
}
export interface LEdge {
  key: string;
  kind: 'parent' | 'squash';
  from: string;
  /** 端點（不算在「無關節點」裡）：parent 邊＝[child, parent]；squash 邊＝[squash commit, ...sources] */
  ends: string[];
  owner: string;
  path: LPath;
}
export interface Layout {
  rows: string[];
  nodes: LNode[];
  edges: LEdge[];
  lanes: number;
  width: number;
  height: number;
  truncated: boolean;
}

export const laneX = (l: number) => PAD_X + l * LANE_W;

function sCurve(x0: number, y0: number, x1: number, y1: number): { d: string; pts: Pt[] } {
  const dy = (y1 - y0) * 0.5;
  const pts: Pt[] = [];
  for (let i = 0; i <= 16; i++) {
    const t = i / 16;
    const u = 1 - t;
    const ax = u * u * u * x0 + 3 * u * u * t * x0 + 3 * u * t * t * x1 + t * t * t * x1;
    const ay = u * u * u * y0 + 3 * u * u * t * (y0 + dy) + 3 * u * t * t * (y1 - dy) + t * t * t * y1;
    pts.push([ax, ay]);
  }
  return { d: `C ${x0} ${y0 + dy} ${x1} ${y1 - dy} ${x1} ${y1}`, pts };
}

class PathBuilder {
  d = '';
  polys: Pt[][] = [];
  private cur: Pt[] = [];
  private pos: Pt = [0, 0];
  move(x: number, y: number) {
    this.d += `${this.d ? ' ' : ''}M ${x} ${y}`;
    this.cur = [[x, y]];
    this.polys.push(this.cur);
    this.pos = [x, y];
  }
  line(x: number, y: number) {
    if (x === this.pos[0] && y === this.pos[1]) return;
    this.d += ` L ${x} ${y}`;
    this.cur.push([x, y]);
    this.pos = [x, y];
  }
  curve(x1: number, y1: number) {
    const [x0, y0] = this.pos;
    if (x0 === x1) return this.line(x1, y1);
    const c = sCurve(x0, y0, x1, y1);
    this.d += ` ${c.d}`;
    this.cur.push(...c.pts.slice(1));
    this.pos = [x1, y1];
  }
  done(): LPath {
    return { d: this.d, polys: this.polys };
  }
}

interface EdgeDraft {
  child: string;
  parent: string;
  /** child 處理時，parent 被哪條 lane 等待 */
  kStart: number;
  second: boolean;
}

export function layoutGraph(inp: GraphInput): Layout {
  const { commits } = inp;
  const maxRows = inp.maxRows ?? 40;

  // ---- 1. 可見的 commit ----
  const tips = new Set<string>();
  for (const r of inp.refs) if (commits[r.id]) tips.add(r.id);
  for (const t of inp.extraTips ?? []) if (commits[t]) tips.add(t);
  const reach = new Set<string>();
  const stack = [...tips];
  while (stack.length) {
    const id = stack.pop()!;
    if (reach.has(id) || !commits[id]) continue;
    reach.add(id);
    for (const p of commits[id].parents) stack.push(p);
  }

  // ---- 2. 排序：孩子一定在父母上面，同層以時間新的優先 ----
  const kids = new Map<string, number>();
  for (const id of reach) kids.set(id, 0);
  for (const id of reach) for (const p of commits[id].parents) if (reach.has(p)) kids.set(p, kids.get(p)! + 1);
  const ready: string[] = [...reach].filter((id) => kids.get(id) === 0);
  const order: string[] = [];
  while (ready.length) {
    ready.sort((a, b) => commits[a].time - commits[b].time || (a < b ? -1 : 1));
    const id = ready.pop()!;
    order.push(id);
    for (const p of commits[id].parents) {
      if (!reach.has(p)) continue;
      const n = kids.get(p)! - 1;
      kids.set(p, n);
      if (n === 0) ready.push(p);
    }
  }
  const truncated = order.length > maxRows;
  const rows = order.slice(0, maxRows);
  const rowOf = new Map(rows.map((id, i) => [id, i]));

  // ---- 3. 每個 commit 屬於哪條分支（決定顏色） ----
  const rank = (r: LRef) => {
    const k = branchKey(r.name);
    if (k === 'master') return 0;
    if (k === 'staging') return 1;
    return r.kind === 'remote' ? 3 : 2;
  };
  const refsSorted = [...inp.refs].filter((r) => commits[r.id]).sort((a, b) => rank(a) - rank(b) || commits[b.id].time - commits[a.id].time);
  const owner = new Map<string, string>();
  for (const r of refsSorted) {
    let id: string | undefined = r.id;
    while (id && commits[id] && !owner.has(id)) {
      owner.set(id, branchKey(r.name));
      id = commits[id].parents[0];
    }
  }
  const childOwner = new Map<string, string>();
  for (const id of rows) {
    if (!owner.has(id)) owner.set(id, childOwner.get(id) ?? '');
    for (const p of commits[id].parents) if (!childOwner.has(p)) childOwner.set(p, owner.get(id)!);
  }

  // ---- 4. lane 配置 ----
  const mainIds: string[] = [];
  for (const nm of ['master', 'staging']) {
    const r = inp.refs.find((x) => branchKey(x.name) === nm && commits[x.id] && rowOf.has(x.id));
    if (r && !mainIds.includes(r.id)) mainIds.push(r.id);
  }
  const reserved = mainIds.length;
  const lanes: (string | null)[] = [];
  const isFree = (i: number) => lanes[i] === undefined || lanes[i] === null;
  const free = (from: number): number => {
    for (let i = from; ; i++) if (isFree(i)) return i;
  };
  const nodeLane = new Map<string, number>();
  const drafts: EdgeDraft[] = [];
  for (const id of rows) {
    const waiting: number[] = [];
    lanes.forEach((w, i) => {
      if (w === id) waiting.push(i);
    });
    let L: number;
    if (waiting.length) L = Math.min(...waiting);
    else {
      const j = mainIds.indexOf(id);
      L = j >= 0 && isFree(j) ? j : free(reserved);
    }
    for (const k of waiting) lanes[k] = null;
    nodeLane.set(id, L);
    commits[id].parents.forEach((p, i) => {
      let k = lanes.indexOf(p);
      if (k < 0) {
        if (i === 0 && isFree(L)) k = L;
        else k = free(reserved);
        lanes[k] = p;
      }
      drafts.push({ child: id, parent: p, kStart: k, second: i > 0 });
    });
  }

  // ---- 5. 壓縮掉沒用到的 lane ----
  const used = new Set<number>();
  nodeLane.forEach((l) => used.add(l));
  for (const d of drafts) used.add(d.kStart);
  const sortedUsed = [...used].sort((a, b) => a - b);
  const remap = new Map(sortedUsed.map((l, i) => [l, i]));
  const nLanes = Math.max(1, sortedUsed.length);
  nodeLane.forEach((l, id) => nodeLane.set(id, remap.get(l)!));
  for (const d of drafts) d.kStart = remap.get(d.kStart)!;

  // ---- 6. 幾何 ----
  const hs = rows.map((id) => ROW_H + CHIP_H * Math.max(0, inp.rowLines?.[id] ?? 0));
  let top = PAD_Y - ROW_H / 2;
  const nodes: LNode[] = rows.map((id, r) => {
    const y = top + hs[r] / 2;
    top += hs[r];
    return { id, row: r, lane: nodeLane.get(id)!, x: laneX(nodeLane.get(id)!), y, h: hs[r], owner: owner.get(id) ?? '' };
  });
  const yEnd = top + (truncated ? ROW_H * 0.5 : 0);
  const nodeOf = new Map(nodes.map((n) => [n.id, n]));
  const edges: LEdge[] = [];
  for (const d of drafts) {
    const c = nodeOf.get(d.child)!;
    const p = nodeOf.get(d.parent);
    const xs = laneX(d.kStart);
    const pb = new PathBuilder();
    pb.move(c.x, c.y);
    if (p) {
      if (p.row === c.row + 1) {
        pb.curve(p.x, p.y);
      } else {
        if (c.x !== xs) pb.curve(xs, c.y + c.h * 0.5);
        if (p.x !== xs) {
          pb.line(xs, p.y - p.h * 0.5);
          pb.curve(p.x, p.y);
        } else pb.line(p.x, p.y);
      }
    } else {
      // 父母被截掉了：往下畫到圖的底部
      if (c.x !== xs) pb.curve(xs, c.y + c.h * 0.5);
      pb.line(xs, yEnd);
    }
    // 第二個父母那條線（merge 進來的分支）用父母那一端的顏色
    const ownerKey = d.second && p ? p.owner : c.owner;
    edges.push({
      key: `${d.child}>${d.parent}`,
      kind: 'parent',
      from: d.child,
      ends: p ? [d.child, d.parent] : [d.child],
      owner: ownerKey,
      path: pb.done(),
    });
  }

  // ---- 7. squash 來源的灰色虛線：走右側的「走廊」，不穿過任何 lane 上的節點 ----
  let gi = 0;
  const laneRight = laneX(nLanes - 1);
  for (const id of rows) {
    const src = (commits[id].squashOf ?? []).filter((s) => rowOf.has(s) && s !== id);
    if (!src.length) continue;
    const gx = laneRight + LANE_W * 0.85 + gi * 7;
    gi++;
    const me = nodeOf.get(id)!;
    const ys = src.map((s) => nodeOf.get(s)!.y);
    const yMax = Math.max(...ys, me.y);
    const yMin = Math.min(...ys, me.y);
    const pb = new PathBuilder();
    pb.move(me.x, me.y);
    pb.line(gx, me.y);
    pb.move(gx, yMin);
    pb.line(gx, yMax);
    for (const s of src) {
      const n = nodeOf.get(s)!;
      pb.move(gx, n.y);
      pb.line(n.x, n.y);
    }
    edges.push({ key: `squash:${id}`, kind: 'squash', from: id, ends: [id, ...src], owner: '', path: pb.done() });
  }

  const width = laneRight + PAD_X + (gi ? LANE_W * 0.85 + gi * 7 : 0);
  return { rows, nodes, edges, lanes: nLanes, width, height: yEnd + ROW_H * 0.1, truncated };
}

// ---- 碰撞檢查（測試與開發除錯用） ----
function distPtSeg(px: number, py: number, a: Pt, b: Pt): number {
  const dx = b[0] - a[0];
  const dy = b[1] - a[1];
  const len2 = dx * dx + dy * dy;
  let t = len2 ? ((px - a[0]) * dx + (py - a[1]) * dy) / len2 : 0;
  t = Math.max(0, Math.min(1, t));
  return Math.hypot(px - (a[0] + t * dx), py - (a[1] + t * dy));
}

/** 回傳違規清單：有哪條邊離哪個「無關節點」太近（小於節點半徑＋外圈） */
export function findOverlaps(l: Layout, minGap = NODE_R + RING): string[] {
  const bad: string[] = [];
  for (const e of l.edges) {
    for (const n of l.nodes) {
      if (e.ends.includes(n.id)) continue;
      let hit = false;
      for (const poly of e.path.polys) {
        for (let i = 0; i + 1 < poly.length && !hit; i++) {
          const dd = distPtSeg(n.x, n.y, poly[i], poly[i + 1]);
          if (dd < minGap) {
            bad.push(`${e.key} 穿過 ${n.id.slice(0, 7)}（距離 ${dd.toFixed(1)}）`);
            hit = true;
          }
        }
        if (hit) break;
      }
    }
  }
  return bad;
}
