import type { Game } from '../core/game';
import { checkoutClean, createWorld, logHead, makeCommit, treeOf } from '../git/repo';
import type { Actor, Files, PR, World } from '../git/types';
import { botPush, syncMei } from '../github/bots';
import {
  addComment,
  checksGreen,
  createPR,
  isApproved,
  mergeInfo,
  mergePR,
  prChecks,
  submitReview,
} from '../github/github';
import { baseSite } from '../site/files';
import type { LevelEvent } from './types';

export const README_V1 = '# 小共筆 TinyNote\n\n迷你共筆站，給系上同學練習協作用。\n';
export const README_V2 = `${README_V1}\n## 開發\n\n用瀏覽器開 index.html 就能看。\n`;
export const GITIGNORE = '.env\nnode_modules/\n';

export function siteTree(): Files {
  return { ...baseSite(), '.gitignore': GITIGNORE, 'README.md': README_V2 };
}

export interface BaseIds {
  c1: string;
  c2: string;
  c3: string;
}

export interface BaseOpts {
  /** me 的電腦目前在哪條分支 */
  meOn?: string;
  /** me 這邊的 staging 落後一個 commit（上次 fetch 之後 GitHub 又更新了） */
  stale?: boolean;
  /** 在 me 的工作資料夾放這些「未追蹤」的檔案 */
  untracked?: Files;
  hook?: boolean;
}

/** 標準起始世界：origin 有 master（C2）與 staging（C3）；你的電腦是 clone */
export function baseWorld(o: BaseOpts = {}): { w: World; ids: BaseIds } {
  const w = createWorld();
  const t3 = siteTree();
  const t2: Files = { ...t3, 'README.md': README_V1 };
  const t1: Files = { ...t2 };
  delete t1['tests/app.test.js'];
  const c1 = makeCommit(w, { parents: [], message: '初始化小共筆', author: 'boss', tree: t1 });
  const c2 = makeCommit(w, { parents: [c1], message: '新增章節目錄與測試', author: 'boss', tree: t2 });
  const c3 = makeCommit(w, { parents: [c2], message: '補上 README 的開發說明', author: 'boss', tree: t3 });
  const origin = w.repos.origin;
  origin.branches = { master: c2, staging: c3 };
  origin.head = { kind: 'branch', name: 'staging' };

  const me = w.repos.me;
  const stagingLocal = o.stale ? c2 : c3;
  me.branches = { staging: stagingLocal };
  me.tracking = { staging: { remote: 'origin', branch: 'staging' } };
  me.remotes = { 'origin/master': c2, 'origin/staging': stagingLocal };
  if (o.meOn === 'master') {
    me.branches.master = c2;
    me.tracking.master = { remote: 'origin', branch: 'master' };
  }
  me.head = { kind: 'branch', name: o.meOn ?? 'staging' };
  me.hooks.preCommit = o.hook ?? true;
  logHead(me, me.branches[me.head.name], "clone: from https://github.com/tinynote-club/tinynote.git");
  checkoutClean(w, 'me');
  if (o.untracked) for (const [p, c] of Object.entries(o.untracked)) me.work[p] = c;

  const mei = w.repos.mei;
  mei.branches = { staging: c3 };
  mei.tracking = { staging: { remote: 'origin', branch: 'staging' } };
  mei.hooks.preCommit = true;
  mei.head = { kind: 'branch', name: 'staging' };
  checkoutClean(w, 'mei');
  syncMei(w);

  w.github.nextNumber = 12;
  return { w, ids: { c1, c2, c3 } };
}

/** AI 留下的雜物：筆記、截圖，以及被 .gitignore 擋住的 .env */
export function leftovers(): Files {
  return {
    'ai-notes.md': '# AI 的工作筆記\n- 試過幾種做法，先記在這\n- TODO: 之後再整理\n',
    'screenshot.png': '<二進位圖片資料>',
    '.env': 'API_KEY=not-a-real-key\nDEBUG=1\n',
  };
}

export function newPR(
  w: World,
  o: { title: string; body?: string; head: string; base?: string; draft?: boolean; author: Actor },
): PR {
  const res = createPR(w, { title: o.title, body: o.body ?? '', head: o.head, base: o.base ?? 'staging', draft: o.draft ?? false, author: o.author });
  if (!res.pr) throw new Error('newPR: ' + res.error);
  return res.pr;
}

export { botPush, treeOf };

// ---------- 部長機器人 ----------
export interface BossOpts {
  id: string;
  /** 只處理符合條件的 PR（預設：作者是你、已 Ready、open） */
  match?: (pr: PR, g: Game) => boolean;
  method?: 'squash' | 'merge';
  /** 回傳字串＝部長挑到毛病，要求修改 */
  nitpick?: (pr: PR, g: Game) => string | null;
}

/** 部長：Ready 的 PR → 看 CI / 衝突 → 通過就 Approve 並合併 */
export function bossPolicy(o: BossOpts): LevelEvent {
  return {
    id: o.id,
    repeat: true,
    when: (g) => g.prs.some((pr) => bossCandidate(g, pr, o)),
    run: (g) => {
      for (const pr of g.prs.filter((p) => bossCandidate(g, p, o))) bossHandle(g, pr, o);
    },
  };
}

function bossCandidate(g: Game, pr: PR, o: BossOpts): boolean {
  if (pr.state !== 'open' || pr.draft) return false;
  const head = g.w.repos.origin.branches[pr.head];
  if (!head) return false;
  if (g.flags[`boss:${pr.number}`] === head) return false;
  return o.match ? o.match(pr, g) : pr.author === 'me';
}

function bossHandle(g: Game, pr: PR, o: BossOpts) {
  const w = g.w;
  const head = w.repos.origin.branches[pr.head];
  g.flags[`boss:${pr.number}`] = head;
  const info = mergeInfo(w, pr);
  if (info.conflicts.length) {
    addComment(pr, 'boss', `這個 PR 有衝突（${info.conflicts.join('、')}），請先把 ${pr.base} 合進你的分支並解掉衝突，再叫我。（P5）`);
    g.notify('boss', `PR #${pr.number} 有衝突，部長退回了。`, 'alert');
    return;
  }
  if (!checksGreen(w, pr)) {
    const bad = prChecks(w, pr).filter((c) => !c.ok).map((c) => c.name).join('、');
    submitReview(w, pr, 'boss', 'changes_requested', `CI 沒過（${bad}），請先修好再轉 Ready。（P4）`, ['修好失敗的 CI']);
    g.notify('boss', `PR #${pr.number} 的 CI 是紅燈，部長退回了。`, 'alert');
    return;
  }
  const nit = o.nitpick?.(pr, g);
  if (nit) {
    submitReview(w, pr, 'boss', 'changes_requested', nit, []);
    g.notify('boss', `部長退回了 PR #${pr.number}：${nit}`, 'alert');
    return;
  }
  submitReview(w, pr, 'boss', 'approved', '看起來沒問題，我來合併。', []);
  const res = mergePR(w, pr, o.method ?? 'squash', 'boss');
  if (res.ok) g.notify('boss', `部長核准並合併了 PR #${pr.number}（${pr.title}）。`, 'good');
  else g.notify('boss', `部長想合併 PR #${pr.number}，但失敗了：${res.error}`, 'alert');
}

export const prIsApproved = isApproved;

export function mergedPR(g: Game, head: string): PR | undefined {
  return g.prs.find((p) => p.head === head && p.state === 'merged');
}

/** 最近一個含關鍵字的檔案是否出現在 origin 分支的樹裡 */
export function originHas(g: Game, branch: string, path: string, needle?: string): boolean {
  const id = g.origin.branches[branch];
  if (!id) return false;
  const t = g.w.objects[id].tree[path];
  if (t === undefined) return false;
  return needle ? t.includes(needle) : true;
}

export function localTreeHas(g: Game, branch: string, path: string, needle?: string): boolean {
  const id = g.me.branches[branch];
  if (!id) return false;
  const t = g.w.objects[id].tree[path];
  if (t === undefined) return false;
  return needle ? t.includes(needle) : true;
}

import { SITE_FILES } from '../site/files';

/** 對「你的電腦」工作資料夾裡的網站檔案套用一個功能修改（模擬寫好程式） */
export function editSite(w: World, fn: (f: Files) => Files) {
  const me = w.repos.me;
  const files: Files = {};
  for (const p of SITE_FILES) if (me.work[p] !== undefined) files[p] = me.work[p];
  Object.assign(me.work, fn(files));
}

/** 這個分支（local）的最新 commit 是否把 origin 某分支的最新狀態包含進來 */
export function containsOrigin(g: Game, local: string, originBranch: string): boolean {
  const tip = g.me.branches[local];
  const o = g.origin.branches[originBranch];
  if (!tip || !o) return false;
  return anc(g, tip).has(o);
}

import { ancestors } from '../git/repo';
export function anc(g: Game, id: string): Set<string> {
  return ancestors(g.w, id);
}

export function tipTree(g: Game, branch: string, where: 'me' | 'origin' = 'me'): Files | null {
  const id = (where === 'me' ? g.me.branches : g.origin.branches)[branch];
  return id ? g.w.objects[id].tree : null;
}
