import { fakeSha } from './hash';
import type { Actor, Commit, Files, Head, Repo, RepoName, World } from './types';

export const REMOTE_URL = 'https://github.com/tinynote-club/tinynote.git';
export const REPO_WEB = 'https://github.com/tinynote-club/tinynote';
export const WORK_PATH = '~/tinynote';

export const ACTORS: Record<Actor, { name: string; email: string; label: string }> = {
  me: { name: '你', email: 'you@tinynote.example', label: '你' },
  mei: { name: '小美', email: 'mei@tinynote.example', label: '小美' },
  boss: { name: '部長', email: 'lead@tinynote.example', label: '部長' },
};

export function newRepo(name: RepoName, bare: boolean): Repo {
  return {
    name,
    bare,
    head: { kind: 'branch', name: 'staging' },
    branches: {},
    remotes: {},
    index: {},
    work: {},
    tracking: {},
    config: { pullRebase: false, fetchPrune: true, userName: name === 'mei' ? '小美' : '你', userEmail: name === 'mei' ? 'mei@tinynote.example' : 'you@tinynote.example' },
    reflog: [],
    merge: null,
    stash: [],
    hooks: { preCommit: false },
    conflictBlobs: {},
  };
}

export function createWorld(): World {
  return {
    clock: 0,
    objects: {},
    repos: { me: newRepo('me', false), mei: newRepo('mei', false), origin: newRepo('origin', true) },
    github: { repoName: 'tinynote-club/tinynote', prs: [], nextNumber: 1, issues: [], alerts: [] },
  };
}

export const clone = <T,>(x: T): T => JSON.parse(JSON.stringify(x));

// ---------- commit 物件 ----------
export function makeCommit(
  w: World,
  o: { parents: string[]; message: string; author: Actor; tree: Files; squashOf?: string[]; viaWeb?: boolean },
): string {
  w.clock += 1;
  const tree = { ...o.tree };
  const id = fakeSha(
    JSON.stringify([o.parents, o.message, o.author, w.clock, Object.entries(tree).sort()]),
  );
  const c: Commit = { id, parents: o.parents, message: o.message, author: o.author, time: w.clock, tree };
  if (o.squashOf) c.squashOf = o.squashOf;
  if (o.viaWeb) c.viaWeb = true;
  w.objects[id] = c;
  return id;
}

export const treeOf = (w: World, id: string | null): Files => (id ? w.objects[id]?.tree ?? {} : {});

export function headId(r: Repo): string | null {
  if (r.head.kind === 'detached') return r.head.id;
  return r.branches[r.head.name] ?? null;
}

export const currentBranch = (r: Repo): string | null => (r.head.kind === 'branch' ? r.head.name : null);

export function ancestors(w: World, id: string | null): Set<string> {
  const seen = new Set<string>();
  if (!id) return seen;
  const stack = [id];
  while (stack.length) {
    const c = stack.pop()!;
    if (seen.has(c)) continue;
    seen.add(c);
    for (const p of w.objects[c]?.parents ?? []) stack.push(p);
  }
  return seen;
}

export function isAncestor(w: World, anc: string | null, desc: string | null): boolean {
  if (!anc || !desc) return false;
  return ancestors(w, desc).has(anc);
}

export function mergeBase(w: World, a: string, b: string): string | null {
  const aa = ancestors(w, a);
  const common = [...ancestors(w, b)].filter((x) => aa.has(x));
  if (!common.length) return null;
  // 取不是其他共同祖先之祖先的那個（時間最新）
  common.sort((x, y) => w.objects[y].time - w.objects[x].time);
  return common[0];
}

/** 所有「最佳共同祖先」（不是其他共同祖先之祖先的那些）。多於一個＝交叉合併（criss-cross） */
export function mergeBases(w: World, a: string, b: string): string[] {
  const aa = ancestors(w, a);
  const common = [...ancestors(w, b)].filter((x) => aa.has(x));
  const covered = new Set<string>();
  for (const c of common) for (const p of w.objects[c].parents) for (const x of ancestors(w, p)) covered.add(x);
  return common.filter((c) => !covered.has(c)).sort((x, y) => w.objects[y].time - w.objects[x].time);
}

/** 解析 ref（HEAD、分支、origin/x、短 sha、~N、^） */
export function resolveRef(w: World, repoName: RepoName, spec: string): string | null {
  const r = w.repos[repoName];
  let base = spec;
  const suffixes: string[] = [];
  const m = spec.match(/^(.*?)((?:[~^]\d*)+)$/);
  if (m && m[1]) {
    base = m[1];
    for (const s of m[2].match(/[~^]\d*/g) ?? []) suffixes.push(s);
  } else if (spec.startsWith('HEAD') || spec === '@') {
    // 'HEAD' 本身
  }
  let id = resolveBase(w, r, base);
  if (!id) return null;
  for (const s of suffixes) {
    const n = s.length > 1 ? parseInt(s.slice(1), 10) : 1;
    if (s[0] === '~') {
      for (let i = 0; i < n; i++) {
        id = w.objects[id!]?.parents[0] ?? null;
        if (!id) return null;
      }
    } else {
      id = w.objects[id!]?.parents[n - 1] ?? null;
      if (!id) return null;
    }
  }
  return id;
}

function resolveBase(w: World, r: Repo, base: string): string | null {
  if (base === 'HEAD' || base === '@') return headId(r);
  if (base.startsWith('refs/heads/')) return r.branches[base.slice(11)] ?? null;
  if (base.startsWith('refs/remotes/')) return r.remotes[base.slice(13)] ?? null;
  if (r.branches[base] !== undefined) return r.branches[base];
  if (r.remotes[base] !== undefined) return r.remotes[base];
  if (/^[0-9a-f]{4,40}$/.test(base)) {
    const hits = Object.keys(w.objects).filter((k) => k.startsWith(base));
    if (hits.length === 1) return hits[0];
  }
  return null;
}

export function logHead(r: Repo, to: string, msg: string, from?: string | null) {
  r.reflog.unshift({ ref: 'HEAD', from: from ?? null, to, msg });
  if (r.reflog.length > 200) r.reflog.length = 200;
}

/** 依時間由新到舊列出可由 tips 到達的 commit */
export function commitsFrom(w: World, tips: string[]): string[] {
  const set = new Set<string>();
  for (const t of tips) for (const a of ancestors(w, t)) set.add(a);
  return [...set].sort((a, b) => w.objects[b].time - w.objects[a].time);
}

export function setHeadBranch(r: Repo, name: string) {
  r.head = { kind: 'branch', name } as Head;
}

export function ahead_behind(w: World, a: string | null, b: string | null): { ahead: number; behind: number } {
  if (!a || !b) return { ahead: 0, behind: 0 };
  const aa = ancestors(w, a);
  const bb = ancestors(w, b);
  let ahead = 0;
  let behind = 0;
  for (const x of aa) if (!bb.has(x)) ahead++;
  for (const x of bb) if (!aa.has(x)) behind++;
  return { ahead, behind };
}

// ---------- 日期 ----------
const DAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const EPOCH = Date.UTC(2026, 9, 12, 1, 0, 0); // 2026-10-12 09:00 +0800
export function fmtDate(t: number): string {
  const d = new Date(EPOCH + t * 7 * 60 * 1000 + 8 * 3600 * 1000);
  const p = (n: number) => String(n).padStart(2, '0');
  return `${DAYS[d.getUTCDay()]} ${MONTHS[d.getUTCMonth()]} ${d.getUTCDate()} ${p(d.getUTCHours())}:${p(d.getUTCMinutes())}:${p(d.getUTCSeconds())} ${d.getUTCFullYear()} +0800`;
}

// ---------- 小工具 ----------
export function writeFile(w: World, repo: RepoName, path: string, content: string) {
  w.repos[repo].work[path] = content;
}

/** 把 files 設為完整工作資料夾內容（不動 index） */
export function setWork(w: World, repo: RepoName, files: Files) {
  w.repos[repo].work = { ...files };
}

/** 機器人／劇本用：直接在某個 repo 的某分支上做一個 commit（不經過指令，不檢查 hook） */
export function plainCommit(
  w: World,
  repo: RepoName,
  branch: string,
  files: Files,
  message: string,
  author: Actor,
): string {
  const r = w.repos[repo];
  const parent = r.branches[branch] ?? null;
  const id = makeCommit(w, { parents: parent ? [parent] : [], message, author, tree: files });
  r.branches[branch] = id;
  return id;
}

/** 確保 repo 的 index/work 與 HEAD 同步（劇本設定用） */
export function checkoutClean(w: World, repoName: RepoName) {
  const r = w.repos[repoName];
  const t = treeOf(w, headId(r));
  r.index = { ...t };
  r.work = { ...t };
}
