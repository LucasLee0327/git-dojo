// 假 GitHub：PR、CI checks、預覽站、review、Update branch、合併、Revert。
import { unifiedHunks, type UHunk } from '../git/diff';
import { mergeBaseTree, mergeTrees } from '../git/merge';
import { ancestors, isAncestor, makeCommit, mergeBase, treeOf, headId } from '../git/repo';
import type { Actor, Files, PR, Review, World } from '../git/types';
import { runApp, runTests } from '../site/runner';

export const BASE_BRANCHES = ['staging', 'master'];

export interface CheckResult {
  name: string;
  ok: boolean;
  log: string;
}

const checkCache = new Map<string, CheckResult[]>();

/** 對某個 commit 的內容跑 CI（內容不可變，所以可以快取） */
export function checksForCommit(w: World, id: string): CheckResult[] {
  const hit = checkCache.get(id);
  if (hit) return hit;
  const tree = treeOf(w, id);
  const t = runTests(tree);
  const a = runApp(tree);
  const res: CheckResult[] = [
    { name: 'test', ok: t.ok, log: t.log },
    { name: 'build', ok: a.ok, log: a.ok ? '✓ 頁面載入成功' : `✗ 頁面載入失敗\n  ${a.error}` },
  ];
  checkCache.set(id, res);
  return res;
}

export const findPR = (w: World, n: number): PR | undefined => w.github.prs.find((p) => p.number === n);

export function prByHead(w: World, head: string, state?: PR['state']): PR | undefined {
  return w.github.prs.find((p) => p.head === head && (state ? p.state === state : true));
}

export interface MergeInfo {
  headId: string | null;
  baseId: string | null;
  upToDate: boolean;
  behindBy: number;
  conflicts: string[];
  mergeable: boolean;
  tree: Files | null;
}

export function mergeInfo(w: World, pr: PR): MergeInfo {
  const o = w.repos.origin;
  const h = pr.state === 'open' ? o.branches[pr.head] ?? null : pr.finalHead ?? null;
  const b = o.branches[pr.base] ?? null;
  if (!h || !b) return { headId: h, baseId: b, upToDate: false, behindBy: 0, conflicts: [], mergeable: false, tree: null };
  const hs = ancestors(w, h);
  const behindBy = [...ancestors(w, b)].filter((x) => !hs.has(x)).length;
  if (behindBy === 0) return { headId: h, baseId: b, upToDate: true, behindBy, conflicts: [], mergeable: true, tree: treeOf(w, h) };
  const res = mergeTrees(mergeBaseTree(w, h, b), treeOf(w, h), treeOf(w, b), { ours: pr.head, theirs: pr.base });
  return { headId: h, baseId: b, upToDate: false, behindBy, conflicts: res.conflicts, mergeable: res.conflicts.length === 0, tree: res.tree };
}

export function aheadCount(w: World, head: string, base: string): number {
  const o = w.repos.origin;
  const h = o.branches[head];
  const b = o.branches[base];
  if (!h || !b) return 0;
  const bs = ancestors(w, b);
  return [...ancestors(w, h)].filter((x) => !bs.has(x)).length;
}

export interface FileChange {
  path: string;
  status: 'added' | 'modified' | 'deleted';
  add: number;
  del: number;
  hunks: UHunk[];
}

export function diffFiles(from: Files, to: Files): FileChange[] {
  const paths = [...new Set([...Object.keys(from), ...Object.keys(to)])].filter((p) => from[p] !== to[p]).sort();
  return paths.map((p) => {
    const hunks = unifiedHunks(from[p] ?? '', to[p] ?? '');
    const add = hunks.reduce((n, h) => n + h.ops.filter((o) => o.t === '+').length, 0);
    const del = hunks.reduce((n, h) => n + h.ops.filter((o) => o.t === '-').length, 0);
    return { path: p, status: from[p] === undefined ? 'added' : to[p] === undefined ? 'deleted' : 'modified', add, del, hunks };
  });
}

/** PR 的「基底 → 目前 head」兩份內容（Files changed 與 gh pr diff 共用） */
export function prTrees(w: World, pr: PR): { from: Files; to: Files } | null {
  const o = w.repos.origin;
  const h = pr.state === 'open' ? o.branches[pr.head] : pr.finalHead;
  if (!h) return null;
  const b = pr.state === 'open' ? o.branches[pr.base] : pr.finalBase;
  const mb = b ? mergeBase(w, h, b) : null;
  return { from: treeOf(w, mb), to: treeOf(w, h) };
}

export function prFiles(w: World, pr: PR): FileChange[] {
  const t = prTrees(w, pr);
  return t ? diffFiles(t.from, t.to) : [];
}

export function prChecks(w: World, pr: PR): CheckResult[] {
  const h = pr.state === 'open' ? w.repos.origin.branches[pr.head] : pr.finalHead;
  return h ? checksForCommit(w, h) : [];
}

export const checksGreen = (w: World, pr: PR) => prChecks(w, pr).every((c) => c.ok);

export function approvals(pr: PR): Review[] {
  // 取每位審查者最新一則
  const last = new Map<Actor, Review>();
  for (const r of pr.reviews) if (r.state !== 'commented') last.set(r.by, r);
  return [...last.values()];
}
export const isApproved = (pr: PR) => approvals(pr).some((r) => r.state === 'approved') && !approvals(pr).some((r) => r.state === 'changes_requested');
export const hasChangesRequested = (pr: PR) => approvals(pr).some((r) => r.state === 'changes_requested');

// ---------- 建立 / 修改 ----------
export function createPR(
  w: World,
  o: { title: string; body: string; head: string; base: string; draft: boolean; author: Actor },
): { pr?: PR; error?: string } {
  const g = w.github;
  const origin = w.repos.origin;
  if (origin.branches[o.head] === undefined) return { error: `GitHub 上沒有分支「${o.head}」，要先 git push。` };
  if (origin.branches[o.base] === undefined) return { error: `GitHub 上沒有分支「${o.base}」。` };
  if (o.head === o.base) return { error: 'head 和 base 不能是同一條分支。' };
  const dup = g.prs.find((p) => p.head === o.head && p.base === o.base && p.state === 'open');
  if (dup) return { error: `已經有一個開著的 PR（#${dup.number}）。` };
  if (aheadCount(w, o.head, o.base) === 0 && !isAncestor(w, origin.branches[o.base], origin.branches[o.head])) {
    return { error: '這兩個分支之間沒有差異，不需要 PR。' };
  }
  if (aheadCount(w, o.head, o.base) === 0) return { error: `No commits between ${o.base} and ${o.head}：沒有可以合併的 commit。` };
  const pr: PR = {
    number: g.nextNumber++,
    title: o.title,
    body: o.body,
    author: o.author,
    head: o.head,
    base: o.base,
    draft: o.draft,
    state: 'open',
    reviews: [],
    comments: [],
    headDeleted: false,
    wasDraft: o.draft,
    events: [o.draft ? `${o.author} 開了 Draft PR` : `${o.author} 開了 PR`],
  };
  g.prs.push(pr);
  return { pr };
}

export function markReady(pr: PR, by: Actor) {
  if (!pr.draft) return;
  pr.draft = false;
  pr.events.push(`${by} 把 PR 轉成 Ready for review`);
}

export function convertToDraft(pr: PR, by: Actor) {
  pr.draft = true;
  pr.events.push(`${by} 把 PR 轉回 Draft`);
}

export function submitReview(w: World, pr: PR, by: Actor, state: Review['state'], body: string, todos: string[] = []) {
  const head = w.repos.origin.branches[pr.head] ?? '';
  pr.reviews.push({ by, state, body, todos, headAtReview: head });
  pr.events.push(`${by} ${state === 'approved' ? 'Approved' : state === 'changes_requested' ? '要求修改（Request changes）' : '留言'}`);
}

export function addComment(pr: PR, by: Actor, body: string) {
  pr.comments.push({ by, body });
}

export function updateBranch(w: World, pr: PR, by: Actor): { ok: boolean; error?: string } {
  const info = mergeInfo(w, pr);
  if (pr.state !== 'open') return { ok: false, error: 'PR 已經關閉。' };
  if (info.upToDate) return { ok: false, error: '這個分支已經是最新的。' };
  if (!info.mergeable || !info.tree || !info.headId || !info.baseId) return { ok: false, error: 'This branch has conflicts that must be resolved：有衝突，不能用 Update branch，要在本機合併並解衝突。' };
  const id = makeCommit(w, {
    parents: [info.headId, info.baseId],
    message: `Merge branch '${pr.base}' into ${pr.head}`,
    author: by,
    tree: info.tree,
    viaWeb: true,
  });
  w.repos.origin.branches[pr.head] = id;
  pr.events.push(`${by} 按了 Update branch：把 ${pr.base} merge 進 ${pr.head}`);
  return { ok: true };
}

export function mergePR(w: World, pr: PR, method: 'squash' | 'merge', by: Actor): { ok: boolean; error?: string } {
  const info = mergeInfo(w, pr);
  if (pr.state !== 'open') return { ok: false, error: 'PR 已經不是 open。' };
  if (pr.draft) return { ok: false, error: 'Draft PR 不能合併，要先轉成 Ready for review。' };
  if (!info.mergeable || !info.tree || !info.headId || !info.baseId) return { ok: false, error: 'This branch has conflicts that must be resolved：有衝突，不能合併。' };
  const o = w.repos.origin;
  let id: string;
  if (method === 'squash') {
    id = makeCommit(w, {
      parents: [info.baseId],
      message: `${pr.title} (#${pr.number})`,
      author: pr.author,
      tree: info.tree,
      squashOf: [info.headId],
      viaWeb: true,
    });
  } else {
    id = makeCommit(w, {
      parents: [info.baseId, info.headId],
      message: `Merge pull request #${pr.number} from tinynote-club/${pr.head}\n\n${pr.title}`,
      author: by,
      tree: info.tree,
      viaWeb: true,
    });
  }
  pr.finalHead = info.headId;
  pr.finalBase = info.baseId;
  o.branches[pr.base] = id;
  pr.state = 'merged';
  pr.mergeMethod = method;
  pr.mergeSha = id;
  pr.mergedBy = by;
  pr.events.push(`${by} 用 ${method === 'squash' ? 'Squash and merge' : 'Create a merge commit'} 合併了 PR`);
  // 合併後自動刪除 head 分支
  if (!BASE_BRANCHES.includes(pr.head)) {
    delete o.branches[pr.head];
    pr.headDeleted = true;
    pr.events.push(`GitHub 自動刪除了分支 ${pr.head}`);
  }
  return { ok: true };
}

export function closePR(pr: PR, by: Actor) {
  pr.state = 'closed';
  pr.events.push(`${by} 關閉了 PR`);
}

/** Revert 按鈕：開出反向 PR */
export function revertPR(w: World, n: number, by: Actor): { pr?: PR; error?: string } {
  const orig = findPR(w, n);
  if (!orig || orig.state !== 'merged' || !orig.mergeSha) return { error: '只有已合併的 PR 可以 Revert。' };
  const o = w.repos.origin;
  const tip = o.branches[orig.base];
  if (!tip) return { error: '找不到 base 分支。' };
  const mc = w.objects[orig.mergeSha];
  const parentTree = treeOf(w, mc.parents[0] ?? null);
  const res = mergeTrees(mc.tree, treeOf(w, tip), parentTree, { ours: orig.base, theirs: 'revert' });
  if (res.conflicts.length) return { error: '後來的修改和這個 PR 衝突，無法自動 Revert。' };
  const branch = `revert-${n}-${orig.head.replace(/\//g, '-')}`;
  const id = makeCommit(w, {
    parents: [tip],
    message: `Revert "${orig.title}"\n\nThis reverts commit ${orig.mergeSha}.`,
    author: by,
    tree: res.tree,
    viaWeb: true,
  });
  o.branches[branch] = id;
  const r = createPR(w, {
    title: `Revert "${orig.title}"`,
    body: `Reverts #${n}`,
    head: branch,
    base: orig.base,
    draft: false,
    author: by,
  });
  if (r.pr) r.pr.revertOf = n;
  return r;
}

export function deployedTree(w: World, site: 'staging' | 'master'): Files | null {
  const id = w.repos.origin.branches[site];
  return id ? treeOf(w, id) : null;
}

export function prPreviewTree(w: World, pr: PR): Files | null {
  // 已合併的 PR：顯示合併前最後一版（讓「回去補看」成立）；關閉未合併的沒有預覽
  if (pr.state === 'merged') return pr.finalHead ? treeOf(w, pr.finalHead) : null;
  if (pr.state !== 'open') return null;
  const id = w.repos.origin.branches[pr.head];
  return id ? treeOf(w, id) : null;
}

export function originHead(w: World, branch: string): string | null {
  return w.repos.origin.branches[branch] ?? null;
}

export { headId };
