// 模擬 git 的指令引擎：純資料、可序列化。輸出模仿真的 git（英文原文）＋中文解說。
import { runTests } from '../site/runner';
import { countChanges, hasConflictMarkers, unifiedHunks } from './diff';
import { short, fakeSha } from './hash';
import { decorations, firstLine, formatLog, selectCommits } from './log';
import { mergeBaseTree, mergeTrees } from './merge';
import {
  ACTORS,
  REMOTE_URL,
  REPO_WEB,
  WORK_PATH,
  ahead_behind,
  ancestors,
  currentBranch,
  fmtDate,
  headId,
  isAncestor,
  logHead,
  makeCommit,
  mergeBase,
  resolveRef,
  treeOf,
} from './repo';
import type { CmdResult, Files, Repo, RepoName, World } from './types';

const ok = (out = '', explain?: string, tag?: string): CmdResult => ({ out, code: 0, explain, tag });
const fail = (out: string, explain?: string, tag?: string, code = 1): CmdResult => ({ out, code, explain, tag });
const fatal = (msg: string, explain?: string, tag?: string) => fail(`fatal: ${msg}`, explain, tag, 128);

// ---------- .gitignore ----------
export function isIgnored(r: Repo, path: string): boolean {
  const gi = r.work['.gitignore'];
  if (!gi) return false;
  const segs = path.split('/');
  for (const raw of gi.split('\n')) {
    const line = raw.trim();
    if (!line || line.startsWith('#')) continue;
    const dirOnly = line.endsWith('/');
    const pat = line.replace(/\/$/, '').replace(/^\//, '');
    const re = new RegExp('^' + pat.replace(/[.+^${}()|[\]\\]/g, '\\$&').replace(/\*/g, '[^/]*').replace(/\?/g, '[^/]') + '$');
    for (let i = 0; i < segs.length; i++) {
      const isLast = i === segs.length - 1;
      if (dirOnly && isLast) continue;
      if (re.test(segs[i])) return true;
    }
  }
  return false;
}

// ---------- 狀態 ----------
export interface StatusInfo {
  staged: { path: string; kind: 'new file' | 'modified' | 'deleted' }[];
  unstaged: { path: string; kind: 'modified' | 'deleted' }[];
  untracked: string[];
  conflicted: string[];
  ignored: string[];
}

export function getStatus(w: World, r: Repo): StatusInfo {
  const head = treeOf(w, headId(r));
  const st: StatusInfo = { staged: [], unstaged: [], untracked: [], conflicted: [...(r.merge?.conflicts ?? [])], ignored: [] };
  const conflict = new Set(st.conflicted);
  const paths = new Set([...Object.keys(head), ...Object.keys(r.index)]);
  for (const p of [...paths].sort()) {
    if (conflict.has(p)) continue;
    const h = head[p];
    const i = r.index[p];
    if (h === undefined && i !== undefined) st.staged.push({ path: p, kind: 'new file' });
    else if (h !== undefined && i === undefined) st.staged.push({ path: p, kind: 'deleted' });
    else if (h !== i) st.staged.push({ path: p, kind: 'modified' });
  }
  for (const p of Object.keys(r.index).sort()) {
    if (conflict.has(p)) continue;
    const wv = r.work[p];
    if (wv === undefined) st.unstaged.push({ path: p, kind: 'deleted' });
    else if (wv !== r.index[p]) st.unstaged.push({ path: p, kind: 'modified' });
  }
  for (const p of Object.keys(r.work).sort()) {
    if (r.index[p] !== undefined || conflict.has(p)) continue;
    if (isIgnored(r, p)) st.ignored.push(p);
    else st.untracked.push(p);
  }
  return st;
}

/** 未追蹤清單：整個資料夾都未追蹤時折疊成 dir/ */
function foldUntracked(r: Repo, list: string[]): string[] {
  const out: string[] = [];
  const seen = new Set<string>();
  for (const p of list) {
    const top = p.split('/')[0];
    if (p.includes('/')) {
      const tracked = Object.keys(r.index).some((k) => k.startsWith(top + '/'));
      if (!tracked) {
        if (!seen.has(top)) {
          seen.add(top);
          out.push(top + '/');
        }
        continue;
      }
    }
    out.push(p);
  }
  return out;
}

export function upstreamOf(r: Repo): { remote: string; branch: string; ref: string } | null {
  const cur = currentBranch(r);
  if (!cur) return null;
  const t = r.tracking[cur];
  if (!t) return null;
  return { remote: t.remote, branch: t.branch, ref: `${t.remote}/${t.branch}` };
}

export function upstreamState(w: World, r: Repo, branch = currentBranch(r)) {
  if (!branch) return null;
  const t = r.tracking[branch];
  if (!t) return null;
  const ref = `${t.remote}/${t.branch}`;
  const rid = r.remotes[ref];
  if (!rid) return { ref, gone: true, ahead: 0, behind: 0 };
  const { ahead, behind } = ahead_behind(w, r.branches[branch], rid);
  return { ref, gone: false, ahead, behind };
}

function branchStatusLines(w: World, r: Repo): string[] {
  const cur = currentBranch(r);
  const lines: string[] = [];
  if (!cur) {
    lines.push(`HEAD detached at ${short(headId(r) ?? '')}`);
    return lines;
  }
  lines.push(`On branch ${cur}`);
  const u = upstreamState(w, r);
  if (u) {
    if (u.gone) lines.push(`Your branch is based on '${u.ref}', but the upstream is gone.`, '  (use "git branch --unset-upstream" to fixup)');
    else if (!u.ahead && !u.behind) lines.push(`Your branch is up to date with '${u.ref}'.`);
    else if (u.ahead && !u.behind)
      lines.push(`Your branch is ahead of '${u.ref}' by ${u.ahead} commit${u.ahead > 1 ? 's' : ''}.`, '  (use "git push" to publish your local commits)');
    else if (!u.ahead && u.behind)
      lines.push(
        `Your branch is behind '${u.ref}' by ${u.behind} commit${u.behind > 1 ? 's' : ''}, and can be fast-forwarded.`,
        '  (use "git pull" to update your local branch)',
      );
    else
      lines.push(
        `Your branch and '${u.ref}' have diverged,`,
        `and have ${u.ahead} and ${u.behind} different commits each, respectively.`,
        '  (use "git pull" if you want to integrate the remote branch with yours)',
      );
  }
  return lines;
}

function cmdStatus(w: World, r: Repo, args: string[]): CmdResult {
  const st = getStatus(w, r);
  const short_ = args.includes('-s') || args.includes('--short') || args.includes('-sb');
  if (short_) {
    const lines: string[] = [];
    if (args.includes('-sb')) {
      const cur = currentBranch(r);
      const u = upstreamState(w, r);
      lines.push(`## ${cur ?? 'HEAD (no branch)'}${u && !u.gone ? `...${u.ref}${u.ahead || u.behind ? ` [${u.ahead ? 'ahead ' + u.ahead : ''}${u.ahead && u.behind ? ', ' : ''}${u.behind ? 'behind ' + u.behind : ''}]` : ''}` : ''}`);
    }
    for (const c of st.conflicted) lines.push(`UU ${c}`);
    const map = new Map<string, [string, string]>();
    for (const s of st.staged) map.set(s.path, [s.kind === 'new file' ? 'A' : s.kind === 'deleted' ? 'D' : 'M', ' ']);
    for (const s of st.unstaged) {
      const cur = map.get(s.path) ?? [' ', ' '];
      cur[1] = s.kind === 'deleted' ? 'D' : 'M';
      map.set(s.path, cur);
    }
    for (const [p, [a, b]] of [...map.entries()].sort()) lines.push(`${a}${b} ${p}`);
    for (const u of foldUntracked(r, st.untracked)) lines.push(`?? ${u}`);
    return ok(lines.join('\n'), '短格式：左欄＝已暫存，右欄＝未暫存，?? ＝未追蹤。', 'status');
  }
  const out: string[] = branchStatusLines(w, r);
  const mergingNote: string[] = [];
  if (r.merge) {
    if (st.conflicted.length) {
      mergingNote.push('You have unmerged paths.', '  (fix conflicts and run "git commit")', '  (use "git merge --abort" to abort the merge)');
    } else {
      mergingNote.push('All conflicts fixed but you are still merging.', '  (use "git commit" to conclude merge)');
    }
    out.push('', ...mergingNote);
  }
  if (st.staged.length) {
    out.push('', 'Changes to be committed:', '  (use "git restore --staged <file>..." to unstage)');
    for (const s of st.staged) out.push(`\t${(s.kind + ':').padEnd(12)} ${s.path}`);
  }
  if (st.conflicted.length) {
    out.push('', 'Unmerged paths:', '  (use "git add <file>..." to mark resolution)');
    for (const c of st.conflicted) out.push(`\tboth modified:   ${c}`);
  }
  if (st.unstaged.length) {
    out.push('', 'Changes not staged for commit:', '  (use "git add <file>..." to update what will be committed)', '  (use "git restore <file>..." to discard changes in working directory)');
    for (const s of st.unstaged) out.push(`\t${(s.kind + ':').padEnd(12)} ${s.path}`);
  }
  const folded = foldUntracked(r, st.untracked);
  if (folded.length) {
    out.push('', 'Untracked files:', '  (use "git add <file>..." to include in what will be committed)');
    for (const u of folded) out.push(`\t${u}`);
  }
  if (!st.staged.length && !st.unstaged.length && !st.conflicted.length) {
    if (folded.length) out.push('', 'nothing added to commit but untracked files present (use "git add" to track)');
    else if (!r.merge) out.push('', 'nothing to commit, working tree clean');
  } else if (!st.staged.length && !st.conflicted.length) {
    out.push('', 'no changes added to commit (use "git add" and/or "git commit -a")');
  }
  // 中文解說
  const ex: string[] = [];
  const cur = currentBranch(r);
  ex.push(cur ? `你現在在「${cur}」分支。` : '你現在是 detached HEAD（不在任何分支上）。');
  const u = upstreamState(w, r);
  if (u && !u.gone && (u.ahead || u.behind)) {
    ex.push(
      u.ahead && u.behind
        ? `和 ${u.ref} 已經分岔：你有 ${u.ahead} 個 commit 還沒推上去，對方有 ${u.behind} 個你還沒拿到。（注意：${u.ref} 是你上次 fetch 時的狀態。）`
        : u.ahead
          ? `你有 ${u.ahead} 個 commit 還沒推上 GitHub。`
          : `GitHub 上有 ${u.behind} 個你還沒拿到的 commit（以你上次 fetch 的結果為準）。`,
    );
  } else if (cur && !u) ex.push('這條分支還沒有設定 upstream（追蹤的遠端分支）。');
  if (st.conflicted.length) ex.push(`有 ${st.conflicted.length} 個檔案衝突：打開檔案處理衝突記號，存檔後 git add，再 git commit。`);
  if (st.staged.length) ex.push(`綠色區（Changes to be committed）：${st.staged.length} 個檔案已暫存，下一次 commit 會包含它們。`);
  if (st.unstaged.length) ex.push(`紅色區（Changes not staged）：${st.unstaged.length} 個已追蹤的檔案有修改但還沒 add。`);
  if (folded.length) ex.push(`Untracked：${folded.length} 項是 Git 還沒管的新檔案，沒 add 就不會進 commit。`);
  if (st.ignored.length) ex.push(`另外有 ${st.ignored.length} 個檔案（${st.ignored.join('、')}）被 .gitignore 擋住，git status 不會顯示它們。`);
  if (!st.staged.length && !st.unstaged.length && !folded.length && !st.conflicted.length && !r.merge) ex.push('工作資料夾是乾淨的。');
  return ok(out.join('\n'), ex.join('\n'), 'status');
}

// ---------- 輔助 ----------
function bareName(spec: string) {
  return spec.replace(/^refs\/heads\//, '');
}

function mkstat(from: Files, to: Files): { lines: string[]; summary: string; created: string[]; deleted: string[] } {
  const paths = [...new Set([...Object.keys(from), ...Object.keys(to)])].sort().filter((p) => from[p] !== to[p]);
  const lines: string[] = [];
  const created: string[] = [];
  const deleted: string[] = [];
  let ins = 0;
  let del = 0;
  const width = Math.max(0, ...paths.map((p) => p.length));
  for (const p of paths) {
    const { add, del: d } = countChanges(from[p] ?? '', to[p] ?? '');
    const a = from[p] === undefined ? to[p].split('\n').length - (to[p].endsWith('\n') ? 1 : 0) : add;
    const dd = to[p] === undefined ? from[p].split('\n').length - (from[p].endsWith('\n') ? 1 : 0) : d;
    ins += a;
    del += dd;
    if (from[p] === undefined) created.push(p);
    if (to[p] === undefined) deleted.push(p);
    lines.push(` ${p.padEnd(width)} | ${String(a + dd).padStart(2)} ${'+'.repeat(Math.min(a, 12))}${'-'.repeat(Math.min(dd, 12))}`);
  }
  const summary = paths.length
    ? ` ${paths.length} file${paths.length > 1 ? 's' : ''} changed${ins ? `, ${ins} insertion${ins > 1 ? 's' : ''}(+)` : ''}${del ? `, ${del} deletion${del > 1 ? 's' : ''}(-)` : ''}`
    : '';
  return { lines, summary, created, deleted };
}

function changedPaths(a: Files, b: Files): string[] {
  return [...new Set([...Object.keys(a), ...Object.keys(b)])].filter((p) => a[p] !== b[p]).sort();
}

/** 在切換 / 合併前檢查：會被覆蓋的本地修改 */
function dirtyOverlap(w: World, r: Repo, fromTree: Files, toTree: Files): { modified: string[]; untracked: string[] } {
  const modified: string[] = [];
  const untracked: string[] = [];
  for (const p of changedPaths(fromTree, toTree)) {
    const inIndex = r.index[p] !== undefined;
    if (inIndex || fromTree[p] !== undefined) {
      const dirty = r.work[p] !== fromTree[p] || r.index[p] !== fromTree[p];
      if (dirty) modified.push(p);
    } else if (r.work[p] !== undefined && toTree[p] !== undefined && r.work[p] !== toTree[p]) {
      untracked.push(p);
    }
  }
  return { modified, untracked };
}

/** 把工作資料夾與 index 移到 toTree（保留不相干的本地修改） */
function moveTo(r: Repo, fromTree: Files, toTree: Files) {
  for (const p of changedPaths(fromTree, toTree)) {
    if (toTree[p] === undefined) {
      delete r.index[p];
      delete r.work[p];
    } else {
      r.index[p] = toTree[p];
      r.work[p] = toTree[p];
    }
  }
}

function setHard(r: Repo, tree: Files) {
  r.index = { ...tree };
  const keepUntracked: Files = {};
  for (const p of Object.keys(r.work)) if (r.index[p] === undefined && !(p in tree)) keepUntracked[p] = r.work[p];
  r.work = { ...tree, ...keepUntracked };
}

function author(r: Repo): 'me' | 'mei' {
  return r.name === 'mei' ? 'mei' : 'me';
}

function advanceHead(w: World, r: Repo, id: string, msg: string) {
  const from = headId(r);
  if (r.head.kind === 'branch') r.branches[r.head.name] = id;
  else r.head = { kind: 'detached', id };
  logHead(r, id, msg, from);
}

function writeTree(r: Repo, tree: Files) {
  r.index = { ...tree };
}

// ---------- add / restore / rm ----------
function matchPaths(paths: string[], spec: string): string[] {
  if (spec === '.' || spec === './') return paths;
  const s = spec.replace(/^\.\//, '').replace(/\/$/, '');
  if (s.includes('*')) {
    const re = new RegExp('^' + s.replace(/[.+^${}()|[\]\\]/g, '\\$&').replace(/\*/g, '.*') + '$');
    return paths.filter((p) => re.test(p));
  }
  return paths.filter((p) => p === s || p.startsWith(s + '/'));
}

function cmdAdd(w: World, r: Repo, args: string[]): CmdResult {
  const flags = args.filter((a) => a.startsWith('-') && a !== '--');
  const specs = args.filter((a) => !a.startsWith('-') || a === '--').filter((a) => a !== '--');
  const all = flags.includes('-A') || flags.includes('--all');
  const upd = flags.includes('-u') || flags.includes('--update');
  const force = flags.includes('-f') || flags.includes('--force');
  if (!specs.length && !all && !upd) {
    return ok('Nothing specified, nothing added.\nhint: Maybe you wanted to say \'git add .\'?\nhint: Turn this message off by running\nhint: "git config advice.addEmptyPathspec false"', '`git add` 後面要接檔名。', 'add');
  }
  const targets = specs.length ? specs : ['.'];
  const worldPaths = Object.keys(r.work);
  const indexPaths = Object.keys(r.index);
  const touched: string[] = [];
  const ignoredHits: string[] = [];
  for (const spec of targets) {
    const hits = new Set<string>([...matchPaths(worldPaths, spec), ...matchPaths(indexPaths, spec)]);
    if (!hits.size && !all && !upd) {
      return fatal(`pathspec '${spec}' did not match any files`, `找不到叫做「${spec}」的檔案。用 ls 或 git status 確認檔名拼對了沒。`, 'add');
    }
    for (const p of hits) {
      const isIgn = isIgnored(r, p) && r.index[p] === undefined;
      if (isIgn && !force) {
        if (spec === '.' || spec === './' || all || spec.includes('*') || spec.endsWith('/')) continue; // 目錄展開時默默略過
        ignoredHits.push(p);
        continue;
      }
      if (upd && r.index[p] === undefined) continue;
      touched.push(p);
    }
  }
  if (ignoredHits.length) {
    return fail(
      `The following paths are ignored by one of your .gitignore files:\n${ignoredHits.join('\n')}\nhint: Use -f if you really want to add them.\nhint: Turn this message off by running\nhint: "git config advice.addIgnoredFile false"`,
      '這些檔案被 .gitignore 擋住了（例如 .env 放機密設定）。Git 刻意不讓你加進去，不要用 -f 硬加（S2）。',
      'add-ignored',
    );
  }
  for (const p of touched) {
    if (r.work[p] === undefined) delete r.index[p];
    else r.index[p] = r.work[p];
    if (r.merge) r.merge.conflicts = r.merge.conflicts.filter((c) => c !== p);
  }
  if (r.merge && !r.merge.conflicts.length) r.conflictBlobs = {};
  const dotLike = targets.some((t) => t === '.' || t === './') || all;
  return ok(
    '',
    dotLike
      ? '「git add .」會把所有改過的、新增的檔案一次放進暫存區，包括你沒打算提交的（例如 AI 留下的筆記、截圖）。團隊規則 G4 禁止這樣做：用 git status 看清楚，再一個一個 add。'
      : `已把 ${touched.length ? touched.join('、') : '指定的檔案'} 放進暫存區（staging area）。用 git status 可以確認。`,
    dotLike ? 'add-dot' : 'add',
  );
}

function cmdRestore(w: World, r: Repo, args: string[]): CmdResult {
  const staged = args.includes('--staged') || args.includes('-S');
  const worktree = args.includes('--worktree') || args.includes('-W') || !staged;
  const srcArg = args.find((a) => a.startsWith('--source='));
  const specs = args.filter((a) => !a.startsWith('-'));
  if (!specs.length) return fatal('you must specify path(s) to restore', undefined, 'restore');
  const headTree = treeOf(w, headId(r));
  const srcTree = srcArg ? treeOf(w, resolveRef(w, r.name, srcArg.slice(9))) : headTree;
  let n = 0;
  for (const spec of specs) {
    const hits = new Set([...matchPaths(Object.keys(r.index), spec), ...matchPaths(Object.keys(r.work), spec), ...matchPaths(Object.keys(headTree), spec)]);
    if (!hits.size) return fail(`error: pathspec '${spec}' did not match any file(s) known to git`, undefined, 'restore');
    for (const p of hits) {
      if (staged) {
        if (headTree[p] === undefined) delete r.index[p];
        else r.index[p] = srcArg ? srcTree[p] : headTree[p];
        n++;
      }
      if (worktree && (!staged || args.includes('--worktree'))) {
        const from = staged ? srcTree : r.index;
        if (from[p] === undefined) {
          if (r.index[p] !== undefined || staged) delete r.work[p];
        } else r.work[p] = from[p];
        n++;
      }
    }
  }
  return ok(
    '',
    staged && !worktree
      ? '已把檔案從暫存區拿回來（unstage）。檔案內容沒有變，只是不會進下一次 commit。'
      : '已把工作資料夾的檔案還原成暫存區（或指定版本）的內容。這會丟掉你未存的修改！（團隊規則 G7：先做備份再執行）',
    staged ? 'restore-staged' : 'restore-work',
  );
}

function cmdRm(w: World, r: Repo, args: string[]): CmdResult {
  const cached = args.includes('--cached');
  const specs = args.filter((a) => !a.startsWith('-'));
  const out: string[] = [];
  for (const spec of specs) {
    const hits = matchPaths(Object.keys(r.index), spec);
    if (!hits.length) return fatal(`pathspec '${spec}' did not match any files`, undefined, 'rm');
    for (const p of hits) {
      delete r.index[p];
      if (!cached) delete r.work[p];
      out.push(`rm '${p}'`);
    }
  }
  return ok(out.join('\n'), cached ? '只從 Git 的追蹤中移除，檔案還留在你的資料夾。' : '檔案已刪除，且這個刪除已放進暫存區。', 'rm');
}

// ---------- commit ----------
function hookRun(w: World, r: Repo, tree: Files): { ok: boolean; out: string } {
  const run = runTests(tree);
  const dots = '.'.repeat(44);
  if (run.ok) return { ok: true, out: `tinynote tests${dots}Passed` };
  return {
    ok: false,
    out: `tinynote tests${dots}Failed\n- hook id: tinynote-tests\n- exit code: 1\n\n${run.log}`,
  };
}

function cmdCommit(w: World, r: Repo, args: string[]): CmdResult {
  let msg: string | null = null;
  let all = false;
  let noVerify = false;
  let amend = false;
  let allowEmpty = false;
  for (let i = 0; i < args.length; i++) {
    const a = args[i];
    if (a === '-m' || a === '--message') msg = args[++i] ?? '';
    else if (a.startsWith('-m') && a.length > 2 && !a.startsWith('--')) {
      if (a === '-am') {
        all = true;
        msg = args[++i] ?? '';
      } else msg = a.slice(2);
    } else if (a.startsWith('--message=')) msg = a.slice(10);
    else if (a === '-a' || a === '--all') all = true;
    else if (a === '--no-verify' || a === '-n') noVerify = true;
    else if (a === '--amend') amend = true;
    else if (a === '--allow-empty') allowEmpty = true;
    else if (a === '--no-edit') msg = msg ?? null;
  }
  if (all) {
    for (const p of Object.keys(r.index)) {
      if (r.merge?.conflicts.includes(p)) continue;
      if (r.work[p] === undefined) delete r.index[p];
      else r.index[p] = r.work[p];
    }
  }
  if (r.merge && r.merge.conflicts.length) {
    return fail(
      `U\t${r.merge.conflicts.join('\nU\t')}\nerror: Committing is not possible because you have unmerged files.\nhint: Fix them up in the work tree, and then use 'git add/rm <file>'\nhint: as appropriate to mark resolution and make a commit.\nfatal: Exiting because of an unresolved conflict.`,
      '還有檔案在衝突中。先處理衝突記號（<<<<<<< ======= >>>>>>>），存檔後 git add，才能 commit。',
      'commit-unmerged',
    );
  }
  const head = headId(r);
  const headTree = treeOf(w, head);
  const merging = r.merge;
  if (!amend && !merging && !allowEmpty && JSON.stringify(sortObj(r.index)) === JSON.stringify(sortObj(headTree))) {
    const st = getStatus(w, r);
    const base = cmdStatus(w, r, []);
    void st;
    return fail(base.out, '沒有任何已暫存的修改，所以沒有東西可以 commit。要先 git add。', 'commit-empty');
  }
  if (msg === null || msg === '') {
    if (merging) msg = merging.message;
    else if (amend && head) msg = w.objects[head].message;
    else return fail('Aborting commit due to empty commit message.', '需要用 -m "訊息" 寫上這次做了什麼（G8：用中文寫清楚）。', 'commit-nomsg');
  }
  const cur = currentBranch(r);
  let hookOut = '';
  if (r.hooks.preCommit && !noVerify) {
    const h = hookRun(w, r, r.index);
    hookOut = h.out + '\n';
    if (!h.ok) {
      return fail(
        h.out,
        'pre-commit 擋下了這次 commit：測試沒過。正確做法是修程式讓測試通過（G5）；不要用 --no-verify 跳過，也不要刪掉測試。',
        'commit-hook-failed',
      );
    }
  }
  const parents = amend && head ? [...w.objects[head].parents] : head ? [head] : [];
  if (merging && !amend) parents.push(merging.other);
  const id = makeCommit(w, { parents, message: msg, author: author(r), tree: r.index });
  const from = head;
  if (r.head.kind === 'branch') r.branches[r.head.name] = id;
  else r.head = { kind: 'detached', id };
  logHead(r, id, amend ? `commit (amend): ${firstLine(msg)}` : merging ? `commit (merge): ${firstLine(msg)}` : `commit: ${firstLine(msg)}`, from);
  r.merge = null;
  r.conflictBlobs = {};
  const parentTree = parents.length ? treeOf(w, parents[0]) : {};
  const stat = mkstat(parentTree, r.index);
  const lines = [`[${cur ?? 'detached HEAD'}${!head ? ' (root-commit)' : ''} ${short(id)}] ${firstLine(msg)}`];
  if (!merging || parents.length < 2) {
    if (stat.summary) lines.push(stat.summary.trimStart().replace(/^/, ' '));
    for (const c of stat.created) lines.push(` create mode 100644 ${c}`);
    for (const d of stat.deleted) lines.push(` delete mode 100644 ${d}`);
  }
  const files = stat.created.length + stat.deleted.length;
  void files;
  return ok(
    hookOut + lines.join('\n'),
    `建立了新的 commit ${short(id)}，記錄在「${cur ?? 'detached HEAD'}」上。這個 commit 只在你的電腦裡，還沒推到 GitHub（要 git push）。${merging ? '這是一個 merge commit，把兩條歷史接在一起。' : ''}`,
    merging ? 'commit-merge' : 'commit',
  );
}

function sortObj(o: Files): [string, string][] {
  return Object.entries(o).sort(([a], [b]) => (a < b ? -1 : 1));
}

// ---------- branch / switch / checkout ----------
function trackingMessage(name: string, up: string) {
  return `branch '${name}' set up to track '${up}'.`;
}

function switchTo(w: World, r: Repo, target: { branch?: string; id: string; create?: { name: string; track?: string } }): CmdResult {
  const fromTree = treeOf(w, headId(r));
  const toTree = treeOf(w, target.id);
  const same = target.branch !== undefined && r.head.kind === 'branch' && r.head.name === target.branch;
  if (!same) {
    const bad = dirtyOverlap(w, r, fromTree, toTree);
    if (bad.modified.length) {
      return fail(
        `error: Your local changes to the following files would be overwritten by checkout:\n${bad.modified.map((p) => '\t' + p).join('\n')}\nPlease commit your changes or stash them before you switch branches.\nAborting`,
        '你有還沒 commit 的修改，切換分支會蓋掉它們，所以 Git 拒絕了。先 commit，或用 git stash 暫存起來。',
        'switch-dirty',
      );
    }
    if (bad.untracked.length) {
      return fail(
        `error: The following untracked working tree files would be overwritten by checkout:\n${bad.untracked.map((p) => '\t' + p).join('\n')}\nPlease move or remove them before you switch branches.\nAborting`,
        '有未追蹤的檔案會被目標分支的同名檔案蓋掉。',
        'switch-untracked',
      );
    }
  }
  const from = headId(r);
  const fromName = r.head.kind === 'branch' ? r.head.name : short(from ?? '');
  if (target.create) {
    r.branches[target.create.name] = target.id;
    if (target.create.track) {
      const [remote, ...rest] = target.create.track.split('/');
      r.tracking[target.create.name] = { remote, branch: rest.join('/') };
    }
    r.head = { kind: 'branch', name: target.create.name };
  } else if (target.branch) r.head = { kind: 'branch', name: target.branch };
  else r.head = { kind: 'detached', id: target.id };
  moveTo(r, fromTree, toTree);
  logHead(r, target.id, `checkout: moving from ${fromName} to ${r.head.kind === 'branch' ? r.head.name : short(target.id)}`, from);
  const lines: string[] = [];
  if (target.create?.track) lines.push(trackingMessage(target.create.name, target.create.track));
  if (target.create) lines.push(`Switched to a new branch '${target.create.name}'`);
  else if (target.branch) {
    lines.push(same ? `Already on '${target.branch}'` : `Switched to branch '${target.branch}'`);
    const u = upstreamState(w, r);
    if (u && !u.gone) {
      if (!u.ahead && !u.behind) lines.push(`Your branch is up to date with '${u.ref}'.`);
      else if (u.ahead && !u.behind) lines.push(`Your branch is ahead of '${u.ref}' by ${u.ahead} commit${u.ahead > 1 ? 's' : ''}.`, '  (use "git push" to publish your local commits)');
      else if (!u.ahead && u.behind)
        lines.push(`Your branch is behind '${u.ref}' by ${u.behind} commit${u.behind > 1 ? 's' : ''}, and can be fast-forwarded.`, '  (use "git pull" to update your local branch)');
      else lines.push(`Your branch and '${u.ref}' have diverged,`, `and have ${u.ahead} and ${u.behind} different commits each, respectively.`, '  (use "git pull" if you want to integrate the remote branch with yours)');
    }
  } else
    lines.push(
      `Note: switching to '${short(target.id)}'.\n\nYou are in 'detached HEAD' state. You can look around, make experimental\nchanges and commit them, and you can discard any commits you make in this\nstate without impacting any branches by switching back to a branch.`,
      `HEAD is now at ${short(target.id)} ${firstLine(w.objects[target.id].message)}`,
    );
  const name = target.create?.name ?? target.branch;
  return ok(
    lines.join('\n'),
    target.create
      ? `建立並切換到新分支「${name}」。新分支從 ${short(target.id)} 這個 commit 長出來。注意：它還只存在你的電腦，推上 GitHub 要用 git push -u origin ${name}。${target.create.track ? `\n⚠ 它被設成追蹤 ${target.create.track}，之後直接 git push 可能會想推到錯的地方，推新分支請用 git push -u origin ${name}。` : ''}`
      : target.branch
        ? same
          ? '你本來就在這條分支上。'
          : `已切換到「${target.branch}」。工作資料夾的檔案換成這條分支的內容。`
        : '你進入 detached HEAD：現在不在任何分支上，在這裡 commit 會很容易弄丟。',
    'switch',
  );
}

function cmdSwitch(w: World, r: Repo, args: string[], viaCheckout = false): CmdResult {
  let create: string | null = null;
  let force = false;
  let detach = false;
  const pos: string[] = [];
  for (let i = 0; i < args.length; i++) {
    const a = args[i];
    if (a === '-c' || a === '-b' || a === '-C' || a === '-B' || a === '--create') create = args[++i];
    else if (a === '-f' || a === '--force' || a === '--discard-changes') force = true;
    else if (a === '-d' || a === '--detach') detach = true;
    else if (a.startsWith('-') && a !== '-') return fail(`error: unknown switch \`${a.slice(1)}'`, undefined, 'switch', 129);
    else pos.push(a);
  }
  void force;
  if (create) {
    if (r.branches[create] !== undefined) return fatal(`a branch named '${create}' already exists`, `已經有叫「${create}」的分支了，換個名字，或直接 switch 過去。`, 'switch-exists');
    const startSpec = pos[0] ?? 'HEAD';
    const id = resolveRef(w, r.name, startSpec);
    if (!id) return fatal(`invalid reference: ${startSpec}`, undefined, 'switch');
    const track = r.remotes[startSpec] !== undefined ? startSpec : undefined;
    return switchTo(w, r, { id, create: { name: create, track } });
  }
  const name = pos[0];
  if (!name) return fatal('missing branch or commit argument', undefined, 'switch');
  if (r.branches[name] !== undefined && !detach) return switchTo(w, r, { branch: name, id: r.branches[name] });
  // 遠端分支：自動建立追蹤
  const remoteRef = `origin/${name}`;
  if (r.remotes[remoteRef] !== undefined && !detach) {
    return switchTo(w, r, { id: r.remotes[remoteRef], create: { name, track: remoteRef } });
  }
  const id = resolveRef(w, r.name, name);
  if (id && (detach || viaCheckout || /^[0-9a-f]{4,}$/.test(name) || r.remotes[name] !== undefined)) return switchTo(w, r, { id });
  return viaCheckout
    ? fail(`error: pathspec '${name}' did not match any file(s) known to git`, '找不到這個分支或檔案。用 git branch -a 看有哪些分支。', 'switch-missing')
    : fatal(`invalid reference: ${name}`, '找不到這個分支。用 git branch -a 看有哪些分支。', 'switch-missing');
}

function cmdCheckout(w: World, r: Repo, args: string[]): CmdResult {
  const dd = args.indexOf('--');
  if (args[0] === '--ours' || args[0] === '--theirs') {
    const side = args[0] === '--ours' ? 'ours' : 'theirs';
    const files = args.slice(1).filter((a) => a !== '--');
    if (!r.merge) return fail(`error: path '${files[0]}' does not have all necessary versions`, undefined, 'checkout-side');
    for (const f of files) {
      const blob = r.conflictBlobs[f];
      if (!blob) return fail(`error: path '${f}' does not have our version`, undefined, 'checkout-side');
      const v = blob[side];
      if (v === null) delete r.work[f];
      else r.work[f] = v;
    }
    return ok(
      `Updated ${files.length} path${files.length > 1 ? 's' : ''} from the index`,
      `⚠ 這個指令把整個檔案換成「${side === 'ours' ? '你這邊（ours）' : '對方那邊（theirs）'}」的版本，另一邊所有的修改（不只衝突的那幾行）都會消失！`,
      'checkout-side',
    );
  }
  if (dd >= 0) {
    const files = args.slice(dd + 1);
    const before = args.slice(0, dd);
    const src = before[0] ? resolveRef(w, r.name, before[0]) : null;
    const tree = src ? treeOf(w, src) : r.index;
    for (const spec of files) {
      const hits = matchPaths([...new Set([...Object.keys(tree), ...Object.keys(r.work)])], spec);
      if (!hits.length) return fail(`error: pathspec '${spec}' did not match any file(s) known to git`, undefined, 'checkout-file');
      for (const p of hits) {
        if (tree[p] === undefined) delete r.work[p];
        else {
          r.work[p] = tree[p];
          if (src) r.index[p] = tree[p];
        }
      }
    }
    return ok('', '已把檔案還原。未存的修改被丟掉了（G7：丟掉修改前要先備份）。', 'checkout-file');
  }
  if (args[0] === '-b' || args[0] === '-B') return cmdSwitch(w, r, args, true);
  // checkout <branch|commit> 或 checkout <file>
  const first = args.find((a) => !a.startsWith('-'));
  if (first && r.branches[first] === undefined && r.remotes[`origin/${first}`] === undefined && resolveRef(w, r.name, first) === null) {
    if (r.index[first] !== undefined || r.work[first] !== undefined) {
      if (r.index[first] === undefined) delete r.work[first];
      else r.work[first] = r.index[first];
      return ok('Updated 1 path from the index', '已把檔案還原成暫存區的內容。', 'checkout-file');
    }
  }
  return cmdSwitch(w, r, args, true);
}

function cmdBranch(w: World, r: Repo, args: string[]): CmdResult {
  const flags = args.filter((a) => a.startsWith('-'));
  const pos = args.filter((a) => !a.startsWith('-'));
  const has = (...f: string[]) => flags.some((x) => f.includes(x));
  if (has('--show-current')) return ok(currentBranch(r) ?? '', undefined, 'branch-show');
  if (has('-d', '--delete', '-D')) {
    const force = has('-D') || (has('-d') && has('-f', '--force'));
    const out: string[] = [];
    let code = 0;
    let ex = '';
    let tag = 'branch-delete';
    for (const name of pos) {
      const id = r.branches[name];
      if (id === undefined) {
        out.push(`error: branch '${name}' not found.`);
        code = 1;
        continue;
      }
      if (r.head.kind === 'branch' && r.head.name === name) {
        out.push(`error: cannot delete branch '${name}' used by worktree at '${WORK_PATH}'`);
        code = 1;
        ex = '不能刪除你現在所在的分支。先 git switch 到別的分支（例如 staging）再刪。';
        tag = 'branch-delete-current';
        continue;
      }
      if (!force) {
        const up = r.tracking[name] ? r.remotes[`${r.tracking[name].remote}/${r.tracking[name].branch}`] : undefined;
        const merged = isAncestor(w, id, headId(r)) || (up && isAncestor(w, id, up));
        if (!merged) {
          out.push(`error: the branch '${name}' is not fully merged`, `hint: If you are sure you want to delete it, run 'git branch -D ${name}'`);
          code = 1;
          ex =
            '這是預期中的失敗，不是出事了：功能 PR 用 Squash and merge，GitHub 在 staging 上產生一個「全新的 commit」，Git 認不出你的分支內容已經合併過，所以 -d 拒絕。\n（合併後 GitHub 刪掉了遠端分支，而你的 git 設了 fetch.prune，origin/… 也跟著清掉了，Git 手上沒有任何「已經合併」的證據。）\n確認 PR 在 GitHub 上顯示 Merged 後，可以用 git branch -D（G7 例外）。若 PR 還沒合併，千萬別 -D，你的工作會丟掉。';
          tag = 'branch-d-unmerged';
          continue;
        }
      }
      delete r.branches[name];
      delete r.tracking[name];
      out.push(`Deleted branch ${name} (was ${short(id)}).`);
      if (!ex) ex = `已刪除本機分支「${name}」。遠端（GitHub）的分支不受影響。`;
    }
    return { out: out.join('\n'), code, explain: ex, tag };
  }
  if (has('-m', '-M')) {
    const [a, b] = pos.length === 2 ? pos : [currentBranch(r) ?? '', pos[0]];
    if (r.branches[a] === undefined) return fail(`error: refname refs/heads/${a} not found`, undefined, 'branch');
    r.branches[b] = r.branches[a];
    delete r.branches[a];
    if (r.tracking[a]) {
      r.tracking[b] = r.tracking[a];
      delete r.tracking[a];
    }
    if (r.head.kind === 'branch' && r.head.name === a) r.head = { kind: 'branch', name: b };
    return ok('', `分支改名為「${b}」（只改本機；GitHub 上的舊名字還在）。`, 'branch');
  }
  const ustr = flags.find((f) => f.startsWith('--set-upstream-to='));
  if (ustr || has('-u', '--set-upstream-to')) {
    const up = ustr ? ustr.slice(18) : pos[0];
    const name = ustr ? pos[0] ?? currentBranch(r) : pos[1] ?? currentBranch(r);
    if (!up || !name) return fatal('no such branch', undefined, 'branch');
    if (r.remotes[up] === undefined) return fatal(`the requested upstream branch '${up}' does not exist`, '遠端沒有這條分支（或你還沒 fetch）。', 'branch-upstream');
    const [remote, ...rest] = up.split('/');
    r.tracking[name] = { remote, branch: rest.join('/') };
    return ok(trackingMessage(name, up), `設定好了：之後在「${name}」上直接 git pull / git push 就會對應到 ${up}。`, 'branch-upstream');
  }
  if (has('--unset-upstream')) {
    const name = pos[0] ?? currentBranch(r);
    if (name) delete r.tracking[name];
    return ok('', undefined, 'branch');
  }
  if (has('-f', '--force') && pos.length >= 1) {
    const name = pos[0];
    const id = resolveRef(w, r.name, pos[1] ?? 'HEAD');
    if (!id) return fatal(`not a valid object name: '${pos[1]}'`, undefined, 'branch');
    if (r.head.kind === 'branch' && r.head.name === name) return fatal(`cannot force update the branch '${name}' used by worktree at '${WORK_PATH}'`, undefined, 'branch');
    r.branches[name] = id;
    return ok('', `把分支「${name}」移到 ${short(id)}。`, 'branch');
  }
  if (pos.length && !has('-a', '--all', '-r', '--remotes', '-l', '--list', '-v', '-vv')) {
    const name = pos[0];
    if (r.branches[name] !== undefined) return fatal(`a branch named '${name}' already exists`, undefined, 'branch');
    const id = resolveRef(w, r.name, pos[1] ?? 'HEAD');
    if (!id) return fatal(`not a valid object name: '${pos[1] ?? 'HEAD'}'`, undefined, 'branch');
    r.branches[name] = id;
    if (pos[1] && r.remotes[pos[1]] !== undefined) {
      const [remote, ...rest] = pos[1].split('/');
      r.tracking[name] = { remote, branch: rest.join('/') };
    }
    return ok('', `在目前位置（${short(id)}）建立了分支「${name}」，但沒有切換過去。要用 git switch ${name} 切過去。`, 'branch-create');
  }
  // 列表
  const cur = currentBranch(r);
  const lines: string[] = [];
  const verbose = has('-v', '-vv', '--verbose');
  const showLocal = !has('-r', '--remotes');
  const showRemote = has('-a', '--all', '-r', '--remotes');
  const width = Math.max(0, ...Object.keys(r.branches).map((b) => b.length), ...(showRemote ? Object.keys(r.remotes).map((b) => b.length + 8) : []));
  if (showLocal) {
    if (r.head.kind === 'detached') lines.push(`* (HEAD detached at ${short(r.head.id)})`);
    for (const b of Object.keys(r.branches).sort()) {
      const id = r.branches[b];
      let line = `${b === cur ? '*' : ' '} ${b}`;
      if (verbose) {
        line = `${b === cur ? '*' : ' '} ${b.padEnd(width)} ${short(id)}`;
        if (has('-vv') && r.tracking[b]) {
          const u = upstreamState(w, r, b)!;
          const st = u.gone ? ': gone' : u.ahead || u.behind ? `: ${[u.ahead ? 'ahead ' + u.ahead : '', u.behind ? 'behind ' + u.behind : ''].filter(Boolean).join(', ')}` : '';
          line += ` [${u.ref}${st}]`;
        }
        line += ` ${firstLine(w.objects[id].message)}`;
      }
      lines.push(line);
    }
  }
  if (showRemote) {
    for (const b of Object.keys(r.remotes).sort()) {
      const id = r.remotes[b];
      lines.push(verbose ? `  ${('remotes/' + b).padEnd(width)} ${short(id)} ${firstLine(w.objects[id].message)}` : `  remotes/${b}`);
    }
  }
  return ok(
    lines.join('\n'),
    '「*」是你目前所在的分支。remotes/origin/… 是你上次 fetch 時看到的 GitHub 狀態，不會自動更新。',
    'branch-list',
  );
}

// ---------- log / diff / show ----------
function cmdLog(w: World, r: Repo, args: string[]): CmdResult {
  let oneline = false;
  let graph = false;
  let all = false;
  let limit: number | null = null;
  const revs: string[] = [];
  for (let i = 0; i < args.length; i++) {
    const a = args[i];
    if (a === '--oneline') oneline = true;
    else if (a === '--graph') graph = true;
    else if (a === '--all') all = true;
    else if (a === '--decorate' || a === '--stat' || a === '--no-color' || a === '--color') continue;
    else if (a === '-n') limit = parseInt(args[++i], 10);
    else if (/^-\d+$/.test(a)) limit = parseInt(a.slice(1), 10);
    else if (a.startsWith('-n') && /^\d+$/.test(a.slice(2))) limit = parseInt(a.slice(2), 10);
    else if (a.startsWith('--pretty') || a.startsWith('--format')) oneline = true;
    else if (a === '--') break;
    else if (!a.startsWith('-')) revs.push(a);
  }
  const tips: string[] = [];
  const exclude: string[] = [];
  for (const rv of revs) {
    if (rv.includes('...')) {
      const [x, y] = rv.split('...');
      const a = resolveRef(w, r.name, x || 'HEAD');
      const b = resolveRef(w, r.name, y || 'HEAD');
      if (!a || !b) return fatal(`ambiguous argument '${rv}': unknown revision or path not in the working tree.`, undefined, 'log');
      tips.push(a, b);
      const mb = mergeBase(w, a, b);
      if (mb) exclude.push(mb);
    } else if (rv.includes('..')) {
      const [x, y] = rv.split('..');
      const a = resolveRef(w, r.name, x || 'HEAD');
      const b = resolveRef(w, r.name, y || 'HEAD');
      if (!a || !b) return fatal(`ambiguous argument '${rv}': unknown revision or path not in the working tree.`, undefined, 'log');
      exclude.push(a);
      tips.push(b);
    } else {
      const id = resolveRef(w, r.name, rv);
      if (!id) return fatal(`ambiguous argument '${rv}': unknown revision or path not in the working tree.\nUse '--' to separate paths from revisions, like this:\n'git <command> [<revision>...] -- [<file>...]'`, undefined, 'log');
      tips.push(id);
    }
  }
  if (!tips.length && !all) {
    const h = headId(r);
    if (!h) return fatal(`your current branch '${currentBranch(r)}' does not have any commits yet`, undefined, 'log');
    tips.push(h);
  }
  const ids = selectCommits(w, r, tips, exclude, all);
  const out = formatLog(w, r, ids, { oneline, graph, all, limit });
  const ex = graph
    ? '每個 * 是一個 commit；括號裡是指向它的分支名稱：HEAD -> x 是你目前的位置，origin/x 是你上次 fetch 時 GitHub 上的位置。線條往右分叉代表不同的分支。'
    : oneline
      ? '每行一個 commit：前面是縮寫的 id，括號是指向它的分支，後面是訊息。最新的在最上面。'
      : undefined;
  return ok(out, ex, 'log');
}

function fileDiff(path: string, a: string | undefined, b: string | undefined): string {
  if (a === b) return '';
  const lines = [`diff --git a/${path} b/${path}`];
  if (a === undefined) lines.push('new file mode 100644', `index 0000000..${fakeSha(b!).slice(0, 7)}`, '--- /dev/null', `+++ b/${path}`);
  else if (b === undefined) lines.push('deleted file mode 100644', `index ${fakeSha(a).slice(0, 7)}..0000000`, `--- a/${path}`, '+++ /dev/null');
  else lines.push(`index ${fakeSha(a).slice(0, 7)}..${fakeSha(b).slice(0, 7)} 100644`, `--- a/${path}`, `+++ b/${path}`);
  for (const h of unifiedHunks(a ?? '', b ?? '')) {
    lines.push(h.header);
    for (const op of h.ops) lines.push(`${op.t}${op.s}`);
  }
  return lines.join('\n');
}

export function diffTrees(from: Files, to: Files, paths?: string[]): string {
  const ps = (paths ?? changedPaths(from, to)).filter((p) => from[p] !== to[p]);
  return ps.map((p) => fileDiff(p, from[p], to[p])).join('\n');
}

function cmdDiff(w: World, r: Repo, args: string[]): CmdResult {
  const staged = args.includes('--staged') || args.includes('--cached');
  const stat = args.includes('--stat');
  const nameOnly = args.includes('--name-only');
  const dd = args.indexOf('--');
  const pathSpecs = dd >= 0 ? args.slice(dd + 1) : [];
  const pos = (dd >= 0 ? args.slice(0, dd) : args).filter((a) => !a.startsWith('-'));
  let from: Files;
  let to: Files;
  const head = treeOf(w, headId(r));
  const maybePaths: string[] = [];
  const revs: string[] = [];
  for (const p of pos) {
    if (p.includes('..') || resolveRef(w, r.name, p) !== null) revs.push(p);
    else maybePaths.push(p);
  }
  const specs = [...pathSpecs, ...maybePaths];
  if (revs.length === 1 && revs[0].includes('...')) {
    const [x, y] = revs[0].split('...');
    const a = resolveRef(w, r.name, x || 'HEAD');
    const b = resolveRef(w, r.name, y || 'HEAD');
    if (!a || !b) return fatal(`ambiguous argument '${revs[0]}': unknown revision or path not in the working tree.`, undefined, 'diff');
    const mb = mergeBase(w, a, b);
    from = treeOf(w, mb);
    to = treeOf(w, b);
  } else if (revs.length === 1 && revs[0].includes('..')) {
    const [x, y] = revs[0].split('..');
    from = treeOf(w, resolveRef(w, r.name, x || 'HEAD'));
    to = treeOf(w, resolveRef(w, r.name, y || 'HEAD'));
  } else if (revs.length === 2) {
    from = treeOf(w, resolveRef(w, r.name, revs[0]));
    to = treeOf(w, resolveRef(w, r.name, revs[1]));
  } else if (revs.length === 1) {
    from = treeOf(w, resolveRef(w, r.name, revs[0]));
    to = staged ? r.index : r.work;
    if (!staged) to = { ...Object.fromEntries(Object.entries(r.work).filter(([p]) => r.index[p] !== undefined || from[p] !== undefined)) };
  } else if (staged) {
    from = head;
    to = r.index;
  } else {
    from = r.index;
    to = Object.fromEntries(Object.entries(r.work).filter(([p]) => r.index[p] !== undefined));
    // 已刪除的檔案：work 沒有，但 index 有 → to 缺少該 path，自然顯示為刪除
  }
  let paths = changedPaths(from, to);
  if (specs.length) paths = paths.filter((p) => specs.some((s) => matchPaths([p], s).length));
  if (nameOnly) return ok(paths.join('\n'), undefined, 'diff');
  if (stat) {
    const st = mkstat(
      Object.fromEntries(paths.filter((p) => from[p] !== undefined).map((p) => [p, from[p]])),
      Object.fromEntries(paths.filter((p) => to[p] !== undefined).map((p) => [p, to[p]])),
    );
    return ok([...st.lines, st.summary].filter(Boolean).join('\n'), undefined, 'diff');
  }
  const out = diffTrees(from, to, paths);
  return ok(
    out,
    out ? '+ 開頭（綠色）是新增的行，- 開頭（紅色）是被刪掉的行。git diff 沒加參數時，只比較「工作資料夾 vs 暫存區」；已暫存的修改要用 git diff --staged 看。' : '沒有差異（或差異都已經在暫存區：試試 git diff --staged）。',
    'diff',
  );
}

function cmdShow(w: World, r: Repo, args: string[]): CmdResult {
  const spec = args.find((a) => !a.startsWith('-')) ?? 'HEAD';
  const id = resolveRef(w, r.name, spec);
  if (!id) return fatal(`ambiguous argument '${spec}': unknown revision or path not in the working tree.`, undefined, 'show');
  const c = w.objects[id];
  const a = ACTORS[c.author];
  const deco = decorations(w, r);
  const d = deco[id] ? ` (${deco[id].join(', ')})` : '';
  const head = `commit ${id}${d}\n${c.parents.length > 1 ? `Merge: ${c.parents.map(short).join(' ')}\n` : ''}Author: ${a.name} <${a.email}>\nDate:   ${fmtDate(c.time)}\n\n${c.message.split('\n').map((l) => (l ? '    ' + l : '')).join('\n')}\n`;
  const diff = c.parents.length <= 1 ? diffTrees(treeOf(w, c.parents[0] ?? null), c.tree) : '';
  return ok(head + (diff ? '\n' + diff : ''), undefined, 'show');
}

// ---------- fetch / pull / push ----------
function fetchFrom(w: World, r: Repo, prune: boolean, only?: string): string[] {
  const origin = w.repos.origin;
  const lines: string[] = [];
  const names = Object.keys(origin.branches).sort();
  for (const b of names) {
    if (only && b !== only) continue;
    const ref = `origin/${b}`;
    const nid = origin.branches[b];
    const old = r.remotes[ref];
    if (old === nid) continue;
    r.remotes[ref] = nid;
    if (!old) lines.push(` * [new branch]      ${b.padEnd(14)} -> ${ref}`);
    else {
      const ff = isAncestor(w, old, nid);
      lines.push(ff ? `   ${short(old)}..${short(nid)}  ${b.padEnd(14)} -> ${ref}` : ` + ${short(old)}...${short(nid)} ${b.padEnd(14)} -> ${ref} (forced update)`);
    }
  }
  if (prune && !only) {
    for (const ref of Object.keys(r.remotes)) {
      const b = ref.replace(/^origin\//, '');
      if (origin.branches[b] === undefined) {
        lines.push(` - [deleted]         (none)         -> ${ref}`);
        delete r.remotes[ref];
      }
    }
  }
  return lines;
}

function cmdFetch(w: World, r: Repo, args: string[]): CmdResult {
  const prune = args.includes('--prune') || args.includes('-p') || r.config.fetchPrune === true;
  const pos = args.filter((a) => !a.startsWith('-'));
  if (pos[0] && pos[0] !== 'origin') return fatal(`'${pos[0]}' does not appear to be a git repository\nfatal: Could not read from remote repository.\n\nPlease make sure you have the correct access rights\nand the repository exists.`, undefined, 'fetch');
  const lines = fetchFrom(w, r, prune, pos[1]);
  const out = lines.length ? `From ${REPO_WEB}\n${lines.join('\n')}` : '';
  return ok(
    out,
    lines.length
      ? '已經把 GitHub 上的新狀態下載到你的電腦（更新了 origin/… 這些「遠端追蹤分支」），但你自己的分支和檔案都沒有被動到。要把它們合進來才用 git merge。'
      : '沒有新東西：你看到的 origin/… 已經是 GitHub 上最新的。',
    'fetch',
  );
}

function divergedHint() {
  return [
    'hint: You have divergent branches and need to specify how to reconcile them.',
    'hint: You can do so by running one of the following commands sometime before',
    'hint: your next pull:',
    'hint:',
    'hint:   git config pull.rebase false  # merge',
    'hint:   git config pull.rebase true   # rebase',
    'hint:   git config pull.ff only       # fast-forward only',
    'hint:',
    'hint: You can replace "git config" with "git config --global" to set a default',
    'hint: preference for all repositories. You can also pass --rebase, --no-rebase,',
    'hint: or --ff-only on the command line to override the configured default per',
    'hint: invocation.',
    'fatal: Need to specify how to reconcile divergent branches.',
  ].join('\n');
}

interface MergeOpts {
  noFf?: boolean;
  ffOnly?: boolean;
  message?: string;
}

function doMerge(w: World, r: Repo, otherId: string, label: string, mo: MergeOpts = {}): CmdResult {
  const head = headId(r);
  if (r.merge) return fatal('You have not concluded your merge (MERGE_HEAD exists).\nPlease, commit your changes before you merge.', undefined, 'merge-inprogress');
  if (!head) return fatal('no commits yet', undefined, 'merge');
  if (isAncestor(w, otherId, head)) return ok('Already up to date.', '你已經有對方所有的 commit 了，不需要合併。', 'merge-uptodate');
  const cur = currentBranch(r);
  const headTree = treeOf(w, head);
  const otherTree = treeOf(w, otherId);
  if (isAncestor(w, head, otherId) && !mo.noFf) {
    const bad = dirtyOverlap(w, r, headTree, otherTree);
    if (bad.modified.length || bad.untracked.length) {
      return fail(
        `error: Your local changes to the following files would be overwritten by merge:\n${[...bad.modified, ...bad.untracked].map((p) => '\t' + p).join('\n')}\nPlease commit your changes or stash them before you merge.\nAborting`,
        '你有未 commit 的修改和要合進來的檔案重疊，先 commit 或 stash。',
        'merge-dirty',
      );
    }
    const st = mkstat(headTree, otherTree);
    advanceHead(w, r, otherId, `merge ${label}: Fast-forward`);
    moveTo(r, headTree, otherTree);
    return ok(
      `Updating ${short(head)}..${short(otherId)}\nFast-forward\n${[...st.lines, st.summary].filter(Boolean).join('\n')}`,
      `Fast-forward：你的分支沒有自己的新 commit，所以 Git 只是把「${cur}」往前移到 ${short(otherId)}，沒有產生新的 merge commit。`,
      'merge-ff',
    );
  }
  if (mo.ffOnly) return fatal('Not possible to fast-forward, aborting.', undefined, 'merge-noff');
  const baseTree = mergeBaseTree(w, head, otherId);
  const bad = dirtyOverlap(w, r, headTree, otherTree);
  if (bad.modified.length) {
    return fail(
      `error: Your local changes to the following files would be overwritten by merge:\n${bad.modified.map((p) => '\t' + p).join('\n')}\nPlease commit your changes or stash them before you merge.\nAborting`,
      '你有未 commit 的修改和要合進來的檔案重疊，先 commit 或 stash。',
      'merge-dirty',
    );
  }
  const res = mergeTrees(baseTree, headTree, otherTree, { ours: 'HEAD', theirs: label });
  const message = mo.message ?? `Merge branch '${label}' into ${cur ?? 'HEAD'}`;
  if (!res.conflicts.length) {
    const id = makeCommit(w, { parents: [head, otherId], message, author: author(r), tree: res.tree });
    advanceHead(w, r, id, `merge ${label}: Merge made by the 'ort' strategy.`);
    moveTo(r, headTree, res.tree);
    const st = mkstat(headTree, res.tree);
    return ok(
      `${res.msgs.filter((m) => m.startsWith('Auto-merging')).join('\n')}${res.msgs.length ? '\n' : ''}Merge made by the 'ort' strategy.\n${[...st.lines, st.summary].filter(Boolean).join('\n')}`,
      '兩邊都有新 commit，Git 自動把它們接起來，並建立了一個 merge commit（有兩個 parent）。沒有衝突。',
      'merge-auto',
    );
  }
  // 衝突
  for (const p of changedPaths(headTree, res.tree)) {
    if (res.conflicts.includes(p)) continue;
    if (res.tree[p] === undefined) {
      delete r.index[p];
      delete r.work[p];
    } else {
      r.index[p] = res.tree[p];
      r.work[p] = res.tree[p];
    }
  }
  for (const p of res.conflicts) {
    r.work[p] = res.tree[p];
    r.index[p] = headTree[p] ?? res.tree[p];
  }
  r.merge = { other: otherId, otherName: label, message, conflicts: [...res.conflicts] };
  r.conflictBlobs = res.blobs;
  return {
    out: `${res.msgs.join('\n')}\nAutomatic merge failed; fix conflicts and then commit the result.`,
    code: 1,
    explain: `合併發生衝突：${res.conflicts.join('、')} 裡，兩邊改了同一個地方，Git 不知道要選哪個。檔案裡已經被標上衝突記號：\n<<<<<<< HEAD（你的版本）\n=======\n>>>>>>> ${label}（對方的版本）\n請到編輯器面板決定怎麼合，存檔後 git add 該檔案，再 git commit。（想放棄就 git merge --abort）`,
    tag: 'merge-conflict',
  };
}

function cmdMerge(w: World, r: Repo, args: string[]): CmdResult {
  if (args.includes('--abort')) {
    if (!r.merge) return fatal('There is no merge to abort (MERGE_HEAD missing).', undefined, 'merge-abort');
    const h = treeOf(w, headId(r));
    r.merge = null;
    r.conflictBlobs = {};
    setHard(r, h);
    return ok('', '已經放棄這次合併，回到合併之前的狀態。', 'merge-abort');
  }
  const noFf = args.includes('--no-ff');
  const ffOnly = args.includes('--ff-only');
  let message: string | undefined;
  const mi = args.indexOf('-m');
  if (mi >= 0) message = args[mi + 1];
  const target = args.find((a, i) => !a.startsWith('-') && args[i - 1] !== '-m');
  if (!target) return fatal('No remote for the current branch.', undefined, 'merge');
  if (args.includes('--squash')) {
    return fail('error: --squash 在練習場裡沒有開放；功能 PR 的 squash 請在 GitHub 上按 Squash and merge。', undefined, 'merge');
  }
  const id = resolveRef(w, r.name, target);
  if (!id) return fail(`merge: ${target} - not something we can merge`, '找不到這個分支。如果是遠端分支，要寫 origin/分支名（先 git fetch）。', 'merge-missing');
  const isRemote = r.remotes[target] !== undefined;
  const label = target;
  const res = doMerge(w, r, id, label, { noFf, ffOnly, message: message ?? (isRemote ? `Merge remote-tracking branch '${target}' into ${currentBranch(r) ?? 'HEAD'}` : undefined) });
  return res;
}

function rebaseOnto(w: World, r: Repo, upstreamId: string, label: string): CmdResult {
  const head = headId(r)!;
  const st = getStatus(w, r);
  if (st.staged.length || st.unstaged.length) return fail('error: cannot rebase: You have unstaged changes.', '先 commit 或 stash。', 'rebase-dirty');
  if (isAncestor(w, upstreamId, head)) return ok(`Current branch ${currentBranch(r)} is up to date.`, undefined, 'rebase');
  const up = ancestors(w, upstreamId);
  const mine = [...ancestors(w, head)].filter((x) => !up.has(x)).sort((a, b) => w.objects[a].time - w.objects[b].time).filter((x) => w.objects[x].parents.length <= 1);
  let cur = upstreamId;
  for (const cid of mine) {
    const c = w.objects[cid];
    const res = mergeTrees(treeOf(w, c.parents[0] ?? null), treeOf(w, cur), c.tree, { ours: 'HEAD', theirs: short(cid) });
    if (res.conflicts.length) {
      return fail(
        `Auto-merging ${res.conflicts[0]}\nCONFLICT (content): Merge conflict in ${res.conflicts[0]}\nerror: could not apply ${short(cid)}... ${firstLine(c.message)}\n（練習場的 rebase 不支援中途解衝突，已自動中止，你的分支沒有被改動。）`,
        'rebase 會改寫歷史，團隊規則 G3 禁止；同步 staging 請用 merge。',
        'rebase-conflict',
      );
    }
    cur = makeCommit(w, { parents: [cur], message: c.message, author: c.author, tree: res.tree });
  }
  const from = headId(r);
  const oldTree = treeOf(w, head);
  advanceHead(w, r, cur, `rebase (finish): returning to refs/heads/${currentBranch(r)}`);
  moveTo(r, oldTree, treeOf(w, cur));
  void from;
  return ok(
    `Successfully rebased and updated refs/heads/${currentBranch(r)}.`,
    `rebase 把你的 ${mine.length} 個 commit「重新蓋」在 ${label} 後面——它們變成全新的 commit（id 全都變了）。已經 push 過的分支這樣做會需要 force push，團隊規則 G3 因此禁止。`,
    'rebase',
  );
}

function cmdRebase(w: World, r: Repo, args: string[]): CmdResult {
  if (args.includes('--abort')) return fatal('No rebase in progress?', undefined, 'rebase');
  const target = args.find((a) => !a.startsWith('-'));
  if (!target) return fatal('missing upstream', undefined, 'rebase');
  const id = resolveRef(w, r.name, target);
  if (!id) return fatal(`invalid upstream '${target}'`, undefined, 'rebase');
  if (!headId(r) || r.head.kind !== 'branch') return fatal('not on a branch', undefined, 'rebase');
  return rebaseOnto(w, r, id, target);
}

function cmdPull(w: World, r: Repo, args: string[]): CmdResult {
  let rebase: boolean | null = null;
  let ffOnly = false;
  const pos: string[] = [];
  for (const a of args) {
    if (a === '--rebase' || a === '-r') rebase = true;
    else if (a === '--no-rebase') rebase = false;
    else if (a === '--ff-only') ffOnly = true;
    else if (a === '--ff' || a === '--no-edit' || a === '--no-ff') continue;
    else if (!a.startsWith('-')) pos.push(a);
  }
  const cur = currentBranch(r);
  if (!cur) return fatal('You are not currently on a branch.\nPlease specify which branch you want to merge with.', undefined, 'pull');
  let remoteBranch: string;
  let named = false;
  if (pos.length >= 2) {
    if (pos[0] !== 'origin') return fatal(`'${pos[0]}' does not appear to be a git repository`, undefined, 'pull');
    remoteBranch = pos[1];
    named = true;
  } else if (pos.length === 1) {
    if (pos[0] !== 'origin') return fatal(`'${pos[0]}' does not appear to be a git repository`, undefined, 'pull');
    const t = r.tracking[cur];
    if (!t) {
      return fail(`You asked to pull from the remote 'origin', but did not specify\na branch. Because this is not the default configured remote\nfor your current branch, you must specify a branch on the command line.`, undefined, 'pull');
    }
    remoteBranch = t.branch;
  } else {
    const t = r.tracking[cur];
    if (!t) {
      return fail(
        `There is no tracking information for the current branch.\nPlease specify which branch you want to merge with.\nSee git-pull(1) for details.\n\n    git pull <remote> <branch>\n\nIf you wish to set tracking information for this branch you can do so with:\n\n    git branch --set-upstream-to=origin/<branch> ${cur}\n`,
        '「沒有追蹤資訊」：你的本機分支還沒有跟任何遠端分支綁定，所以 Git 不知道要從哪裡 pull。\n兩種解法：\n① 一次性：git pull origin 分支名\n② 一勞永逸：git branch --set-upstream-to=origin/分支名（或之後第一次 push 時用 git push -u origin 分支名）',
        'pull-no-tracking',
      );
    }
    remoteBranch = t.branch;
  }
  const origin = w.repos.origin;
  if (origin.branches[remoteBranch] === undefined) {
    return fatal(`couldn't find remote ref ${remoteBranch}`, '遠端沒有這個分支。', 'pull');
  }
  const lines = fetchFrom(w, r, r.config.fetchPrune === true && !named);
  if (named) lines.unshift(` * branch            ${remoteBranch.padEnd(14)} -> FETCH_HEAD`);
  const header = lines.length ? `From ${REPO_WEB}\n${lines.join('\n')}\n` : '';
  const otherId = origin.branches[remoteBranch];
  const head = headId(r);
  const diverged = head && !isAncestor(w, head, otherId) && !isAncestor(w, otherId, head);
  const useRebase = rebase ?? (r.config.pullRebase === null ? null : r.config.pullRebase);
  if (diverged && useRebase === null && !ffOnly) {
    return fail(header + divergedHint(), '你的分支和遠端「分岔」了，Git 要你先決定怎麼合：merge 還是 rebase。團隊規則 E4：git config --global pull.rebase false（一律 merge）。這次可以加 --no-rebase 先過關。', 'pull-diverged');
  }
  if (diverged && ffOnly) return fatal('Not possible to fast-forward, aborting.', undefined, 'pull');
  let res: CmdResult;
  if (useRebase && diverged) res = rebaseOnto(w, r, otherId, `origin/${remoteBranch}`);
  else {
    const label = named || !r.remotes[`origin/${remoteBranch}`] ? remoteBranch : remoteBranch;
    res = doMerge(w, r, otherId, label, { message: `Merge branch '${label}' of ${REPO_WEB} into ${cur}`, ffOnly });
  }
  res.out = header + res.out;
  res.tag = 'pull-' + (res.tag ?? '');
  if (res.code === 0 && res.explain) res.explain = 'git pull ＝ git fetch（下載 GitHub 的新狀態）＋ git merge（合進目前分支）。\n' + res.explain;
  return res;
}

function pushHint(kind: 'fetch first' | 'non-fast-forward'): string[] {
  return kind === 'fetch first'
    ? [
        'hint: Updates were rejected because the remote contains work that you do not',
        'hint: have locally. This is usually caused by another repository pushing to',
        'hint: the same ref. If you want to integrate the remote changes, use',
        "hint: 'git pull' before pushing again.",
        "hint: See the 'Note about fast-forwards' in 'git push --help' for details.",
      ]
    : [
        'hint: Updates were rejected because the tip of your current branch is behind',
        'hint: its remote counterpart. If you want to integrate the remote changes,',
        "hint: use 'git pull' before pushing again.",
        "hint: See the 'Note about fast-forwards' in 'git push --help' for details.",
      ];
}

function knownCommits(w: World, r: Repo): Set<string> {
  const s = new Set<string>();
  for (const id of [...Object.values(r.branches), ...Object.values(r.remotes)]) for (const a of ancestors(w, id)) s.add(a);
  return s;
}

function cmdPush(w: World, r: Repo, args: string[]): CmdResult {
  let setUp = false;
  let force = false;
  let del = false;
  const pos: string[] = [];
  for (const a of args) {
    if (a === '-u' || a === '--set-upstream') setUp = true;
    else if (a === '-f' || a === '--force' || a.startsWith('--force-with-lease')) force = true;
    else if (a === '-d' || a === '--delete') del = true;
    else if (a === '--no-verify' || a === '--tags' || a === '--follow-tags') continue;
    else if (!a.startsWith('-')) pos.push(a);
  }
  const cur = currentBranch(r);
  const origin = w.repos.origin;
  let refspecs: string[];
  if (pos.length && pos[0] !== 'origin') return fatal(`'${pos[0]}' does not appear to be a git repository\nfatal: Could not read from remote repository.\n\nPlease make sure you have the correct access rights\nand the repository exists.`, '遠端只有一個，叫 origin。', 'push');
  if (pos.length <= 1) {
    if (!cur) return fatal('You are not currently on a branch.\nTo push the history leading to the current (detached HEAD)\nstate now, use\n\n    git push origin HEAD:<name-of-remote-branch>\n', undefined, 'push');
    const t = r.tracking[cur];
    if (!t) {
      return fail(
        `fatal: The current branch ${cur} has no upstream branch.\nTo push the current branch and set the remote as upstream, use\n\n    git push --set-upstream origin ${cur}\n\nTo have this happen automatically for branches without a tracking\nupstream, see 'push.autoSetupRemote' in 'git help config'.\n`,
        '這條分支還沒有 upstream。第一次推一條新分支，請用 git push -u origin 分支名（-u ＝ 順便設定追蹤，之後就能直接 git push / git pull）。',
        'push-no-upstream',
      );
    }
    if (t.branch !== cur) {
      return fail(
        `fatal: The upstream branch of your current branch does not match\nthe name of your current branch.  To push to the upstream branch\non the remote, use\n\n    git push origin HEAD:${t.branch}\n\nTo push to the branch of the same name on the remote, use\n\n    git push origin HEAD\n\nTo choose either option permanently, see push.default in 'git help config'.\n`,
        `這條分支追蹤的是 origin/${t.branch}（名字和它不同），Git 怕你推錯地方所以拒絕。推新分支請用 git push -u origin ${cur}。`,
        'push-upstream-mismatch',
      );
    }
    refspecs = [`${cur}:${t.branch}`];
  } else refspecs = pos.slice(1);
  const lines: string[] = [];
  const remoteMsgs: string[] = [];
  let anyReject = false;
  let rejectKind: 'fetch first' | 'non-fast-forward' = 'non-fast-forward';
  let ex = '';
  let tag = 'push';
  let changed = false;
  const known = knownCommits(w, r);
  for (let spec of refspecs) {
    let f = force;
    if (spec.startsWith('+')) {
      f = true;
      spec = spec.slice(1);
    }
    let src: string;
    let dst: string;
    if (del) {
      src = '';
      dst = bareName(spec);
    } else if (spec.includes(':')) {
      [src, dst] = spec.split(':');
      dst = bareName(dst);
    } else {
      src = spec;
      dst = spec === 'HEAD' ? (cur ?? 'HEAD') : bareName(spec);
    }
    if (!src) {
      if (origin.branches[dst] === undefined) return fail(`error: unable to delete '${dst}': remote ref does not exist`, undefined, 'push-delete');
      delete origin.branches[dst];
      delete r.remotes[`origin/${dst}`];
      lines.push(` - [deleted]         ${dst}`);
      changed = true;
      ex = `已刪除 GitHub 上的分支「${dst}」。`;
      continue;
    }
    const newId = resolveRef(w, r.name, src);
    if (!newId) return fail(`error: src refspec ${src} does not match any\nerror: failed to push some refs to '${REMOTE_URL}'`, '找不到要推的分支或 commit，檢查名字。', 'push');
    const old = origin.branches[dst];
    const srcBranch = src === 'HEAD' ? cur : bareName(src);
    if (old === newId) {
      lines.push('Everything up-to-date');
      if (setUp && srcBranch && r.branches[srcBranch] !== undefined) {
        r.tracking[srcBranch] = { remote: 'origin', branch: dst };
        r.remotes[`origin/${dst}`] = newId;
        lines.push(trackingMessage(srcBranch, `origin/${dst}`));
      }
      continue;
    }
    const pad = (s: string) => s.padEnd(18);
    if (old && !isAncestor(w, old, newId)) {
      if (!f) {
        const kind = known.has(old) ? 'non-fast-forward' : 'fetch first';
        rejectKind = kind;
        anyReject = true;
        lines.push(` ! ${pad('[rejected]')} ${src === 'HEAD' ? dst : src} -> ${dst} (${kind})`);
        tag = kind === 'fetch first' ? 'push-rejected-fetch-first' : 'push-rejected';
        ex =
          kind === 'fetch first'
            ? '被拒絕了：GitHub 上的這條分支有你還沒下載的 commit（例如部長按了 Update branch，或小美推了東西）。\n正確做法（G6）：先 git pull（＝ fetch ＋ merge）把它們合進來，再 git push。絕對不要 --force。\n（先 git fetch 過再 push，錯誤會變成 non-fast-forward，意思一樣。）'
            : '被拒絕了（non-fast-forward）：GitHub 上這條分支比你的本機多了你沒有的 commit。\n正確做法（G6）：先 git pull（merge）把遠端的修改合進來，再 git push。絕對不要 --force——那會覆蓋掉別人的修改。';
        continue;
      }
      lines.push(` + ${short(old)}...${short(newId)} ${(src === 'HEAD' ? dst : src)} -> ${dst} (forced update)`);
      ex = '⚠ force push 成功了：GitHub 上這條分支被你的版本直接覆蓋，原本在上面、你本機沒有的 commit 從遠端消失了！（團隊規則 G6、A3 禁止）';
      tag = 'push-forced';
    } else if (!old) {
      lines.push(` * ${pad('[new branch]')} ${src === 'HEAD' ? dst : src} -> ${dst}`);
      if (dst !== 'staging' && dst !== 'master') {
        remoteMsgs.push(`remote: Create a pull request for '${dst}' on GitHub by visiting:`, `remote:      ${REPO_WEB}/pull/new/${dst}`, 'remote:');
      }
      ex = `第一次把「${dst}」推上 GitHub，遠端新建了這條分支。${setUp ? '因為有 -u，本機分支也和 origin/' + dst + ' 綁定了（之後可以直接 git push / git pull）。' : '注意：沒有加 -u，本機分支還沒和遠端綁定。'}\n下一步：到 GitHub 開 Draft PR（P1）。`;
    } else {
      lines.push(`   ${short(old)}..${short(newId)}  ${(src === 'HEAD' ? dst : src).padEnd(14)} -> ${dst}`);
      ex = `已把你的新 commit 推上 GitHub 的「${dst}」。`;
    }
    origin.branches[dst] = newId;
    r.remotes[`origin/${dst}`] = newId;
    changed = true;
    if (setUp && srcBranch && r.branches[srcBranch] !== undefined) {
      r.tracking[srcBranch] = { remote: 'origin', branch: dst };
      lines.push(trackingMessage(srcBranch, `origin/${dst}`));
    }
    if (dst === 'staging' || dst === 'master') {
      w.github.alerts.push({ id: `push-${dst}-${w.clock}`, text: `🚨 有人直接 push 到 ${dst}（沒有經過 PR）：${short(newId)} ${firstLine(w.objects[newId].message)}` });
      ex += `\n🚨 你推到了 ${dst}！團隊規則 G1 禁止：所有修改都要走 PR。GitHub 沒有開分支保護，所以 push 會成功，且測試站已經自動部署了這個沒人審過的版本。`;
      if (tag === 'push') tag = 'push-protected-branch';
    }
  }
  if (anyReject) {
    return fail(
      [`To ${REMOTE_URL}`, ...lines, `error: failed to push some refs to '${REMOTE_URL}'`, ...pushHint(rejectKind)].join('\n'),
      ex,
      tag,
    );
  }
  void changed;
  const head = lines[0] === 'Everything up-to-date' ? '' : `Enumerating objects: 5, done.\nCounting objects: 100% (5/5), done.\nWriting objects: 100% (3/3), done.\n${remoteMsgs.length ? remoteMsgs.join('\n') + '\n' : ''}To ${REMOTE_URL}\n`;
  const body = lines.join('\n');
  return ok(head + body, ex || (lines[0] === 'Everything up-to-date' ? '沒有新東西需要推。' : undefined), tag);
}

// ---------- reset / revert / cherry-pick / stash ----------
function cmdReset(w: World, r: Repo, args: string[]): CmdResult {
  const mode = args.includes('--hard') ? 'hard' : args.includes('--soft') ? 'soft' : 'mixed';
  const pos = args.filter((a) => !a.startsWith('-'));
  const headTree = treeOf(w, headId(r));
  // reset <path> ＝ unstage
  if (pos.length && resolveRef(w, r.name, pos[0]) === null) {
    for (const spec of pos) {
      for (const p of matchPaths([...new Set([...Object.keys(r.index), ...Object.keys(headTree)])], spec)) {
        if (headTree[p] === undefined) delete r.index[p];
        else r.index[p] = headTree[p];
      }
    }
    return ok('', '已把檔案從暫存區拿回來。', 'restore-staged');
  }
  const spec = pos[0] ?? 'HEAD';
  const id = resolveRef(w, r.name, spec);
  if (!id) return fatal(`ambiguous argument '${spec}': unknown revision or path not in the working tree.`, undefined, 'reset');
  const from = headId(r);
  if (r.head.kind === 'branch') r.branches[r.head.name] = id;
  else r.head = { kind: 'detached', id };
  logHead(r, id, `reset: moving to ${spec}`, from);
  const tree = treeOf(w, id);
  r.merge = null;
  r.conflictBlobs = {};
  let out = '';
  if (mode === 'hard') {
    setHard(r, tree);
    out = `HEAD is now at ${short(id)} ${firstLine(w.objects[id].message)}`;
  } else if (mode === 'mixed') {
    r.index = { ...tree };
    const dirty = Object.keys(r.work).filter((p) => r.index[p] !== undefined && r.work[p] !== r.index[p]);
    if (dirty.length) out = `Unstaged changes after reset:\n${dirty.map((p) => `M\t${p}`).join('\n')}`;
  }
  const lost = from && id !== from && !isAncestor(w, from, id) ? [...ancestors(w, from)].filter((x) => !ancestors(w, id).has(x)).length : 0;
  return ok(
    out,
    mode === 'hard'
      ? `⚠ 分支「${currentBranch(r)}」被移到 ${short(id)}，而且工作資料夾與暫存區的修改全部丟掉。${lost ? `原本分支上的 ${lost} 個 commit 不再被任何分支指到（仍可用 git reflog 救回）。` : ''}團隊規則 G7：執行前要先建立備份分支。`
      : mode === 'soft'
        ? `分支移回 ${short(id)}，但檔案和暫存區都保留——剛剛那些 commit 的內容變成「已暫存」。`
        : `分支移回 ${short(id)}；那些 commit 的修改留在工作資料夾（未暫存）。`,
    'reset-' + mode,
  );
}

function revertCommit(w: World, r: Repo, spec: string, mainline: number | null): CmdResult {
  const id = resolveRef(w, r.name, spec);
  if (!id) return fatal(`bad revision '${spec}'`, undefined, 'revert');
  const c = w.objects[id];
  if (c.parents.length > 1 && mainline === null) {
    return fail(`error: commit ${id} is a merge but no -m option was given.\nfatal: revert failed`, '這是 merge commit，要用 -m 1 指定以哪一邊為主線。', 'revert');
  }
  const head = headId(r);
  if (!head) return fatal('no commits', undefined, 'revert');
  const st = getStatus(w, r);
  if (st.staged.length || st.unstaged.length) return fail('error: your local changes would be overwritten by revert.\nhint: commit your changes or stash them to proceed.\nfatal: revert failed', undefined, 'revert');
  const parentTree = treeOf(w, c.parents[(mainline ?? 1) - 1] ?? null);
  const res = mergeTrees(c.tree, treeOf(w, head), parentTree, { ours: 'HEAD', theirs: `parent of ${short(id)} (${firstLine(c.message)})` });
  if (res.conflicts.length) {
    return fail(
      `${res.msgs.join('\n')}\nerror: could not revert ${short(id)}... ${firstLine(c.message)}\nhint: After resolving the conflicts, mark them with\nhint: "git add/rm <pathspec>", then run\nhint: "git revert --continue".`,
      '這個 revert 和後來的修改衝突了（練習場不支援中途解 revert 衝突）。',
      'revert-conflict',
    );
  }
  const msg = `Revert "${firstLine(c.message)}"\n\nThis reverts commit ${id}.`;
  const nid = makeCommit(w, { parents: [head], message: msg, author: author(r), tree: res.tree });
  const old = treeOf(w, head);
  advanceHead(w, r, nid, `revert: Revert "${firstLine(c.message)}"`);
  moveTo(r, old, res.tree);
  const stat = mkstat(old, res.tree);
  return ok(
    `[${currentBranch(r) ?? 'detached HEAD'} ${short(nid)}] Revert "${firstLine(c.message)}"\n Date: ${fmtDate(w.objects[nid].time)}\n${[stat.summary].filter(Boolean).join('\n')}`,
    `revert 不會改寫歷史：它新增一個「反向」的 commit，把 ${short(id)} 的修改抵消掉。已經 push 出去的錯誤，用 revert 收拾（§11），不要 reset + force push。`,
    'revert',
  );
}

function cmdRevert(w: World, r: Repo, args: string[]): CmdResult {
  let mainline: number | null = null;
  const pos: string[] = [];
  for (let i = 0; i < args.length; i++) {
    const a = args[i];
    if (a === '-m' || a === '--mainline') mainline = parseInt(args[++i], 10);
    else if (a.startsWith('-m') && /^\d+$/.test(a.slice(2))) mainline = parseInt(a.slice(2), 10);
    else if (!a.startsWith('-')) pos.push(a);
  }
  if (!pos.length) return fatal('revert needs a commit', undefined, 'revert');
  return revertCommit(w, r, pos[0], mainline);
}

function cmdCherryPick(w: World, r: Repo, args: string[]): CmdResult {
  const spec = args.find((a) => !a.startsWith('-'));
  if (!spec) return fatal('cherry-pick needs a commit', undefined, 'cherry-pick');
  const id = resolveRef(w, r.name, spec);
  if (!id) return fatal(`bad revision '${spec}'`, undefined, 'cherry-pick');
  const c = w.objects[id];
  const head = headId(r)!;
  const res = mergeTrees(treeOf(w, c.parents[0] ?? null), treeOf(w, head), c.tree, { ours: 'HEAD', theirs: `${short(id)} (${firstLine(c.message)})` });
  if (res.conflicts.length) return fail(`${res.msgs.join('\n')}\nerror: could not apply ${short(id)}... ${firstLine(c.message)}`, '練習場的 cherry-pick 不支援中途解衝突。', 'cherry-pick');
  const nid = makeCommit(w, { parents: [head], message: c.message, author: author(r), tree: res.tree });
  const old = treeOf(w, head);
  advanceHead(w, r, nid, `cherry-pick: ${firstLine(c.message)}`);
  moveTo(r, old, res.tree);
  return ok(`[${currentBranch(r) ?? 'detached HEAD'} ${short(nid)}] ${firstLine(c.message)}`, `把 ${short(id)} 的修改複製一份到目前分支（內容相同，但是全新的 commit）。`, 'cherry-pick');
}

function cmdStash(w: World, r: Repo, args: string[]): CmdResult {
  const sub = args[0] && !args[0].startsWith('-') ? args[0] : 'push';
  if (sub === 'list') {
    return ok(r.stash.map((s, i) => `stash@{${i}}: ${s.message}`).join('\n'), undefined, 'stash');
  }
  if (sub === 'drop') {
    if (!r.stash.length) return fail('error: No stash entries found.', undefined, 'stash');
    r.stash.shift();
    return ok('Dropped refs/stash@{0}', '⚠ stash 被丟棄了（G7）。', 'stash-drop');
  }
  if (sub === 'pop' || sub === 'apply') {
    const s = r.stash[0];
    if (!s) return fail('error: No stash entries found.', undefined, 'stash');
    for (const p of Object.keys(s.work)) {
      r.work[p] = s.work[p];
      if (s.index[p] !== undefined) r.index[p] = s.index[p];
    }
    for (const p of Object.keys(s.index)) if (r.index[p] === undefined) r.index[p] = s.index[p];
    if (sub === 'pop') r.stash.shift();
    return ok(cmdStatus(w, r, []).out + (sub === 'pop' ? '\nDropped refs/stash@{0}' : ''), '把暫存的修改放回來了。', 'stash-pop');
  }
  const st = getStatus(w, r);
  if (!st.staged.length && !st.unstaged.length) return ok('No local changes to save', undefined, 'stash');
  const head = headId(r)!;
  const mi = args.indexOf('-m');
  r.stash.unshift({ message: `WIP on ${currentBranch(r)}: ${short(head)} ${firstLine(w.objects[head].message)}`, index: { ...r.index }, work: { ...r.work }, base: head });
  if (mi >= 0 && args[mi + 1]) r.stash[0].message = args[mi + 1];
  const tree = treeOf(w, head);
  const untracked = Object.fromEntries(Object.entries(r.work).filter(([p]) => r.index[p] === undefined));
  r.index = { ...tree };
  r.work = { ...tree, ...untracked };
  return ok(`Saved working directory and index state ${r.stash[0].message}`, '把未 commit 的修改暫時收起來，工作資料夾回到乾淨狀態。用 git stash pop 拿回來。', 'stash');
}

function cmdClean(w: World, r: Repo, args: string[]): CmdResult {
  const dry = args.includes('-n') || args.includes('--dry-run');
  const force = args.some((a) => /^-[a-z]*f/.test(a)) || args.includes('--force');
  const st = getStatus(w, r);
  if (!dry && !force) return fatal('clean.requireForce defaults to true and neither -i, -n, nor -f given; refusing to clean', undefined, 'clean');
  const out: string[] = [];
  for (const p of st.untracked) {
    if (!dry) delete r.work[p];
    out.push(`${dry ? 'Would remove' : 'Removing'} ${p}`);
  }
  return ok(out.join('\n'), dry ? '預覽：這些未追蹤檔案會被刪掉。' : '⚠ 未追蹤的檔案被刪掉了，而且救不回來（G7）。', 'clean');
}

function cmdReflog(w: World, r: Repo): CmdResult {
  const lines = r.reflog.slice(0, 30).map((e, i) => `${short(e.to)} HEAD@{${i}}: ${e.msg}`);
  return ok(lines.join('\n'), 'reflog 記錄了 HEAD 走過的每一步（只存在你的電腦）。誤操作後，從這裡找回 commit id，再 git switch -c 備份名 id 就能救回。', 'reflog');
}

function cmdConfig(w: World, r: Repo, args: string[]): CmdResult {
  const rest = args.filter((a) => a !== '--global' && a !== '--local' && a !== '--system');
  if (rest[0] === '--list' || rest[0] === '-l') {
    const l = [`user.name=${r.config.userName}`, `user.email=${r.config.userEmail}`, 'remote.origin.url=' + REMOTE_URL];
    if (r.config.pullRebase !== null) l.push(`pull.rebase=${r.config.pullRebase}`);
    if (r.config.fetchPrune) l.push('fetch.prune=true');
    return ok(l.join('\n'), undefined, 'config');
  }
  if (rest[0] === '--get') rest.shift();
  const [key, val] = rest;
  if (!key) return fail('usage: git config [<options>]', undefined, 'config', 129);
  if (key === 'pull.rebase') {
    if (val === undefined) return r.config.pullRebase === null ? fail('', undefined, 'config') : ok(String(r.config.pullRebase), undefined, 'config');
    r.config.pullRebase = val === 'true' || val === 'merges' || val === 'interactive';
    return ok('', r.config.pullRebase ? '之後 git pull 會用 rebase（團隊規則 G3 不允許，E4 要求設成 false）。' : '設好了：之後 git pull 一律用 merge（團隊規則 E4）。', 'config-pull');
  }
  if (key === 'user.name') {
    if (val === undefined) return ok(r.config.userName, undefined, 'config');
    r.config.userName = val;
    return ok('', undefined, 'config');
  }
  if (key === 'user.email') {
    if (val === undefined) return ok(r.config.userEmail, undefined, 'config');
    r.config.userEmail = val;
    return ok('', undefined, 'config');
  }
  if (key === 'remote.origin.url') return ok(REMOTE_URL, undefined, 'config');
  return val === undefined ? fail('', undefined, 'config') : ok('', undefined, 'config');
}

function cmdRemote(w: World, r: Repo, args: string[]): CmdResult {
  if (args.includes('-v') || args.includes('--verbose')) return ok(`origin\t${REMOTE_URL} (fetch)\norigin\t${REMOTE_URL} (push)`, 'origin 就是 GitHub 上的那個 repo。', 'remote');
  return ok('origin', undefined, 'remote');
}

function cmdRevParse(w: World, r: Repo, args: string[]): CmdResult {
  if (args.includes('--show-toplevel')) return ok(WORK_PATH.replace('~', '/home/you'), undefined, 'rev-parse');
  if (args.includes('--abbrev-ref')) {
    const spec = args.find((a) => !a.startsWith('-')) ?? 'HEAD';
    if (spec === 'HEAD') return ok(currentBranch(r) ?? 'HEAD', undefined, 'rev-parse');
    return ok(spec, undefined, 'rev-parse');
  }
  const spec = args.find((a) => !a.startsWith('-')) ?? 'HEAD';
  const id = resolveRef(w, r.name, spec);
  if (!id) return fatal(`ambiguous argument '${spec}': unknown revision or path not in the working tree.`, undefined, 'rev-parse');
  return ok(args.includes('--short') ? short(id) : id, undefined, 'rev-parse');
}

// ---------- 入口 ----------
export function execGit(w: World, repoName: RepoName, argv: string[]): CmdResult {
  const r = w.repos[repoName];
  // 去掉全域旗標 -C <dir> / --no-pager
  const args = argv.filter((a) => a !== '--no-pager' && a !== '--no-color');
  const [sub, ...rest] = args;
  if (!sub) return ok('usage: git [-v | --version] [-h | --help] <command> [<args>]', undefined, 'git');
  switch (sub) {
    case 'status':
      return cmdStatus(w, r, rest);
    case 'add':
      return cmdAdd(w, r, rest);
    case 'restore':
      return cmdRestore(w, r, rest);
    case 'rm':
      return cmdRm(w, r, rest);
    case 'commit':
      return cmdCommit(w, r, rest);
    case 'switch':
      return cmdSwitch(w, r, rest);
    case 'checkout':
      return cmdCheckout(w, r, rest);
    case 'branch':
      return cmdBranch(w, r, rest);
    case 'log':
      return cmdLog(w, r, rest);
    case 'diff':
      return cmdDiff(w, r, rest);
    case 'show':
      return cmdShow(w, r, rest);
    case 'fetch':
      return cmdFetch(w, r, rest);
    case 'pull':
      return cmdPull(w, r, rest);
    case 'push':
      return cmdPush(w, r, rest);
    case 'merge':
      return cmdMerge(w, r, rest);
    case 'rebase':
      return cmdRebase(w, r, rest);
    case 'reset':
      return cmdReset(w, r, rest);
    case 'revert':
      return cmdRevert(w, r, rest);
    case 'cherry-pick':
      return cmdCherryPick(w, r, rest);
    case 'stash':
      return cmdStash(w, r, rest);
    case 'clean':
      return cmdClean(w, r, rest);
    case 'reflog':
      return cmdReflog(w, r);
    case 'config':
      return cmdConfig(w, r, rest);
    case 'remote':
      return cmdRemote(w, r, rest);
    case 'rev-parse':
      return cmdRevParse(w, r, rest);
    case 'ls-files':
      return ok(Object.keys(r.index).sort().join('\n'), undefined, 'ls-files');
    case 'version':
    case '--version':
    case '-v':
      return ok('git version 2.47.0', undefined, 'git');
    case 'help':
    case '--help':
    case '-h':
      return ok('usage: git [-v | --version] [-h | --help] <command> [<args>]\n\n常用指令：status add commit switch branch log diff fetch pull push merge revert reset restore stash', undefined, 'git');
    default:
      return fail(`git: '${sub}' is not a git command. See 'git --help'.`, `Git 沒有「${sub}」這個指令，檢查是不是打錯字了。輸入 help 可以看練習場支援的指令。`, 'git-unknown');
  }
}

export { hasConflictMarkers };
