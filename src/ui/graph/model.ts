// 把 World 轉成分支圖的輸入（純資料，不碰 DOM）。三種視角：你的電腦／GitHub 實際狀態／小美的電腦。
import { ancestors, headId } from '../../git/repo';
import type { RepoName, World } from '../../git/types';
import { layoutGraph, type GraphInput, type LCommit, type Layout, type LRef } from './layout';

export type GraphView = 'me' | 'github' | 'mei';

export interface RefLabel {
  name: string;
  kind: 'local' | 'remote' | 'github';
  /** 目前所在的分支（HEAD -> name） */
  current: boolean;
  /** 本機分支和同名的 origin/… 在同一個 commit：合併成一顆標籤，雲朵代表「已同步」 */
  synced?: boolean;
}

export interface GraphModel {
  input: GraphInput;
  labels: Record<string, RefLabel[]>;
  /** HEAD 所在的 commit（GitHub 視角沒有 HEAD） */
  head: string | null;
  detached: boolean;
  /** 已經在 GitHub 上（origin 的某條分支可以走到）的 commit */
  onGithub: Set<string>;
}

export const VIEW_LABEL: Record<GraphView, string> = {
  me: '你的電腦',
  github: 'GitHub 實際狀態',
  mei: '小美的電腦',
};

export function onGithubSet(w: World): Set<string> {
  const s = new Set<string>();
  for (const id of Object.values(w.repos.origin.branches)) for (const a of ancestors(w, id)) s.add(a);
  return s;
}

export function buildModel(w: World, view: GraphView): GraphModel {
  const refs: LRef[] = [];
  const labels: Record<string, RefLabel[]> = {};
  const add = (r: LRef, current = false) => {
    refs.push(r);
    (labels[r.id] ??= []).push({ name: r.name, kind: r.kind, current });
  };
  let head: string | null = null;
  let detached = false;
  const extraTips: string[] = [];
  if (view === 'github') {
    for (const [b, id] of Object.entries(w.repos.origin.branches)) add({ name: b, kind: 'github', id });
  } else {
    const r = w.repos[view as RepoName];
    const cur = r.head.kind === 'branch' ? r.head.name : null;
    for (const [b, id] of Object.entries(r.branches)) add({ name: b, kind: 'local', id }, b === cur);
    for (const [b, id] of Object.entries(r.remotes)) add({ name: b, kind: 'remote', id });
    head = headId(r);
    detached = r.head.kind === 'detached';
    if (head) extraTips.push(head);
  }
  // 同名的本機分支與 origin/ 指到同一個 commit：只留一顆標籤（像 VS Code），標成已同步
  for (const id of Object.keys(labels)) {
    const ls = labels[id];
    const drop = new Set<RefLabel>();
    for (const l of ls) {
      if (l.kind !== 'local') continue;
      const twin = ls.find((x) => x.kind === 'remote' && x.name === 'origin/' + l.name);
      if (twin) {
        l.synced = true;
        drop.add(twin);
      }
    }
    labels[id] = ls.filter((l) => !drop.has(l));
  }
  const commits: Record<string, LCommit> = {};
  for (const [id, c] of Object.entries(w.objects)) commits[id] = { parents: c.parents, time: c.time, squashOf: c.squashOf };
  return { input: { commits, refs, extraTips }, labels, head, detached, onGithub: onGithubSet(w) };
}

// ---- 標籤排版估算：標籤永遠完整顯示（不截斷）；排不下就換到 commit 訊息上方、自己佔一到數行 ----
const CJK = /[⺀-鿿＀-￯]/;
export function chipWidth(l: RefLabel): number {
  let w = 16;
  for (const ch of l.name) w += CJK.test(ch) ? 12 : 6.9;
  if (l.synced || l.kind !== 'local') w += 15;
  if (l.current) w += 14;
  return Math.ceil(w * 1.06) + 4;
}

export interface ChipPlan {
  /** commit id → 標籤獨立成幾行（0＝標籤和訊息放同一行，或根本沒有標籤） */
  lines: Record<string, number>;
}

export function planChips(model: GraphModel, textW: number): ChipPlan {
  const lines: Record<string, number> = {};
  const ids = new Set<string>([...Object.keys(model.labels), ...(model.head ? [model.head] : [])]);
  for (const id of ids) {
    const ws = (model.labels[id] ?? []).map(chipWidth);
    if (model.detached && model.head === id) ws.push(80);
    if (!ws.length) continue;
    const total = ws.reduce((a, b) => a + b, 0);
    if (total + 96 <= textW) continue;
    let n = 1;
    let cur = 0;
    for (const w of ws) {
      if (cur && cur + w > textW) {
        n++;
        cur = 0;
      }
      cur += w;
    }
    lines[id] = n;
  }
  return { lines };
}

/** 面板寬度（要和 CSS 的 .gitpanel 寬度一致） */
export const PANEL_W = 400;

/** 兩階段排版：先用預設列高排一次拿到圖的寬度，算出各 commit 的標籤要不要獨立成行，再依列高重排 */
export function layoutModel(model: GraphModel, panelW = PANEL_W): { lay: Layout; plan: ChipPlan } {
  const base = layoutGraph(model.input);
  const plan = planChips(model, panelW - 2 - base.width - 8 - 12);
  return { lay: layoutGraph({ ...model.input, rowLines: plan.lines }), plan };
}
