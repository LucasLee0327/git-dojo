// 終端機：把一行文字解析成指令（git / gh / ls / cat …）並執行。
import { execGit, getStatus, isIgnored } from '../git/engine';
import { REPO_WEB, currentBranch } from '../git/repo';
import type { Actor, CmdResult, RepoName, World } from '../git/types';
import {
  checksGreen,
  createPR,
  findPR,
  isApproved,
  markReady,
  mergePR,
  prByHead,
  prChecks,
} from '../github/github';
import { runTests } from '../site/runner';

export function tokenize(line: string): string[] {
  const out: string[] = [];
  let cur = '';
  let q: string | null = null;
  let has = false;
  for (let i = 0; i < line.length; i++) {
    const c = line[i];
    if (q) {
      if (c === q) q = null;
      else if (c === '\\' && q === '"' && i + 1 < line.length && '"\\$`'.includes(line[i + 1])) cur += line[++i];
      else cur += c;
    } else if (c === '"' || c === "'") {
      q = c;
      has = true;
    } else if (/\s/.test(c)) {
      if (cur || has) out.push(cur);
      cur = '';
      has = false;
    } else if (c === '\\' && i + 1 < line.length) {
      cur += line[++i];
    } else cur += c;
  }
  if (cur || has) out.push(cur);
  return out;
}

/** 依 && ; 切成多個指令（引號內不切） */
export function splitCommands(line: string): { cmd: string; op: '&&' | ';' | null }[] {
  const parts: { cmd: string; op: '&&' | ';' | null }[] = [];
  let cur = '';
  let q: string | null = null;
  for (let i = 0; i < line.length; i++) {
    const c = line[i];
    if (q) {
      cur += c;
      if (c === q) q = null;
      continue;
    }
    if (c === '"' || c === "'") {
      q = c;
      cur += c;
    } else if (c === '&' && line[i + 1] === '&') {
      parts.push({ cmd: cur.trim(), op: '&&' });
      cur = '';
      i++;
    } else if (c === ';') {
      parts.push({ cmd: cur.trim(), op: ';' });
      cur = '';
    } else cur += c;
  }
  if (cur.trim()) parts.push({ cmd: cur.trim(), op: null });
  return parts.filter((p) => p.cmd);
}

export const HELP_TEXT = `這個練習場的終端機支援：
  git status | add | restore | commit | switch | checkout | branch | log | diff | show
      fetch | pull | push | merge | rebase | reset | revert | cherry-pick | stash | reflog | config
  gh pr create | view | list | ready | checks | merge
  ls [-a] | cat <檔案> | rm <檔案> | echo | pwd | clear | npm test
小技巧：↑/↓ 叫出上一個指令；Tab 自動補完分支或檔名。`;

function ghPr(w: World, repo: RepoName, args: string[], actor: Actor): CmdResult {
  const r = w.repos[repo];
  const sub = args[0];
  const flag = (names: string[]) => {
    const i = args.findIndex((a) => names.includes(a));
    return i >= 0 ? args[i + 1] : undefined;
  };
  const has = (...n: string[]) => args.some((a) => n.includes(a));
  const numArg = args.slice(1).find((a) => /^\d+$/.test(a));
  const url = (n: number) => `${REPO_WEB}/pull/${n}`;
  if (sub === 'create') {
    const head = flag(['--head', '-H']) ?? currentBranch(r);
    if (!head) return { out: 'could not determine current branch: detached HEAD', code: 1 };
    if (w.repos.origin.branches[head] === undefined) {
      return { out: 'aborted: you must first push the current branch to a remote, or use the --head flag', code: 1, explain: '要先 git push -u origin 分支名，GitHub 上有這條分支，才能開 PR。', tag: 'gh-pr-create-nopush' };
    }
    const title = flag(['--title', '-t']);
    const body = flag(['--body', '-b']) ?? '';
    if (!title && !has('--fill', '-f')) {
      return { out: 'must provide `--title` and `--body` (or `--fill` or `fill-first` or `--fillverbose`) when not running interactively', code: 1, tag: 'gh-pr-create' };
    }
    const base = flag(['--base', '-B']) ?? 'staging';
    const res = createPR(w, { title: title ?? head, body, head, base, draft: has('--draft', '-d'), author: actor });
    if (!res.pr) return { out: `error: ${res.error}`, code: 1, tag: 'gh-pr-create' };
    return {
      out: `\nCreating pull request for ${head} into ${base} in tinynote-club/tinynote\n\n${url(res.pr.number)}`,
      code: 0,
      explain: res.pr.draft ? `已開出 Draft PR #${res.pr.number}。Draft＝還沒準備好審查（P1：早開 Draft PR）。` : `已開出 PR #${res.pr.number}。`,
      tag: 'gh-pr-create',
    };
  }
  if (sub === 'list') {
    const lines = w.github.prs.filter((p) => p.state === 'open').map((p) => `#${p.number}\t${p.title}\t${p.head}${p.draft ? '\tDRAFT' : ''}`);
    return { out: lines.join('\n') || 'no open pull requests match your search', code: 0, tag: 'gh-pr-list' };
  }
  const pr = numArg ? findPR(w, parseInt(numArg, 10)) : prByHead(w, currentBranch(r) ?? '', 'open') ?? prByHead(w, currentBranch(r) ?? '');
  if (!pr) return { out: `no pull requests found for branch "${currentBranch(r)}"`, code: 1, tag: 'gh-pr' };
  if (sub === 'view') {
    const lines = [
      `${pr.title} #${pr.number}`,
      `${pr.state === 'merged' ? 'Merged' : pr.state === 'closed' ? 'Closed' : pr.draft ? 'Draft' : 'Open'} • ${pr.head} → ${pr.base}`,
      '',
      pr.body || '(no description)',
      '',
      `View this pull request on GitHub: ${url(pr.number)}`,
    ];
    return { out: lines.join('\n'), code: 0, tag: 'gh-pr-view' };
  }
  if (sub === 'ready') {
    markReady(pr, actor);
    return { out: `✓ Pull request #${pr.number} is marked as "ready for review"`, code: 0, tag: 'gh-pr-ready' };
  }
  if (sub === 'checks') {
    const cs = prChecks(w, pr);
    return { out: cs.map((c) => `${c.ok ? '✓' : 'X'}\t${c.name}`).join('\n') || 'no checks reported', code: cs.every((c) => c.ok) ? 0 : 1, tag: 'gh-pr-checks' };
  }
  if (sub === 'merge') {
    const method = has('--merge', '-m') ? 'merge' : 'squash';
    const res = mergePR(w, pr, method, actor);
    if (!res.ok) return { out: `X Pull request #${pr.number} is not mergeable: ${res.error}`, code: 1, tag: 'gh-pr-merge' };
    return {
      out: `✓ ${method === 'squash' ? 'Squashed and merged' : 'Merged'} pull request #${pr.number} (${pr.title})`,
      code: 0,
      explain: '⚠ 合併一律由人在 GitHub 網頁上按（R3）；PR 作者不合併自己的 PR，AI 更不能合併任何 PR（A3）。',
      tag: 'gh-pr-merge',
    };
  }
  void checksGreen;
  void isApproved;
  return { out: `unknown command "${sub}" for "gh pr"`, code: 1, tag: 'gh-pr' };
}

function runSimple(w: World, repo: RepoName, tokens: string[], actor: Actor): CmdResult {
  const r = w.repos[repo];
  const [cmd, ...args] = tokens;
  switch (cmd) {
    case 'git':
      return execGit(w, repo, args);
    case 'gh':
      if (args[0] === 'pr') return ghPr(w, repo, args.slice(1), actor);
      return { out: 'gh：練習場只支援 gh pr create / view / list / ready / checks / merge', code: 1, tag: 'gh' };
    case 'ls': {
      const all = args.some((a) => a.startsWith('-') && a.includes('a'));
      const tops = new Set<string>();
      for (const p of Object.keys(r.work)) {
        const top = p.includes('/') ? p.split('/')[0] + '/' : p;
        if (!all && top.startsWith('.')) continue;
        tops.add(top);
      }
      return { out: [...tops].sort().join('  '), code: 0, explain: all ? undefined : '預設的 ls 不會列出以 . 開頭的隱藏檔（例如 .env、.gitignore）。想看全部用 ls -a。', tag: 'ls' };
    }
    case 'cat': {
      const out: string[] = [];
      let code = 0;
      for (const f of args.filter((a) => !a.startsWith('-'))) {
        if (r.work[f] === undefined) {
          out.push(`cat: ${f}: No such file or directory`);
          code = 1;
        } else out.push(r.work[f].replace(/\n$/, ''));
      }
      return { out: out.join('\n'), code, tag: 'cat' };
    }
    case 'rm': {
      const recursive = args.some((a) => /^-[a-z]*r/.test(a));
      const files = args.filter((a) => !a.startsWith('-'));
      const out: string[] = [];
      let code = 0;
      for (const f of files) {
        const hits = Object.keys(r.work).filter((p) => p === f || (recursive && p.startsWith(f.replace(/\/$/, '') + '/')));
        if (!hits.length) {
          if (!args.some((a) => /^-[a-z]*f/.test(a))) {
            out.push(`rm: cannot remove '${f}': No such file or directory`);
            code = 1;
          }
          continue;
        }
        for (const p of hits) delete r.work[p];
      }
      return { out: out.join('\n'), code, explain: code ? undefined : '檔案從工作資料夾刪除了（Git 會把它當成「已刪除、未暫存」的修改）。', tag: 'rm-file' };
    }
    case 'pwd':
      return { out: '/home/you/tinynote', code: 0, tag: 'pwd' };
    case 'cd':
    case 'mkdir':
    case 'touch':
      if (cmd === 'touch') for (const f of args) if (r.work[f] === undefined) r.work[f] = '';
      return { out: '', code: 0, tag: cmd };
    case 'echo': {
      const gt = args.findIndex((a) => a === '>' || a === '>>');
      if (gt >= 0 && args[gt + 1]) {
        const text = args.slice(0, gt).join(' ') + '\n';
        const f = args[gt + 1];
        r.work[f] = args[gt] === '>>' ? (r.work[f] ?? '') + text : text;
        return { out: '', code: 0, tag: 'echo' };
      }
      return { out: args.join(' '), code: 0, tag: 'echo' };
    }
    case 'clear':
      return { out: '', code: 0, tag: 'clear' };
    case 'help':
      return { out: HELP_TEXT, code: 0, tag: 'help' };
    case 'npm': {
      if (args[0] === 'test' || (args[0] === 'run' && args[1] === 'test')) {
        const t = runTests(r.work);
        return { out: `> tinynote@1.0.0 test\n\n${t.log}`, code: t.ok ? 0 : 1, tag: 'npm-test', explain: t.ok ? '本機測試通過。pre-commit 和 CI 跑的是同一批測試。' : '有測試沒過。要修程式讓它通過，不要刪掉測試（G5）。' };
      }
      return { out: '', code: 0, tag: 'npm' };
    }
    case 'code':
      return { out: '（練習場請用右側的「編輯器」分頁）', code: 0, tag: 'code' };
    case 'sudo':
      return { out: 'you is not in the sudoers file.  This incident will be reported.', code: 1, tag: 'sudo' };
    default:
      return {
        out: `bash: ${cmd}: command not found`,
        code: 127,
        explain: `找不到指令「${cmd}」。輸入 help 看看練習場支援哪些指令。`,
        tag: 'not-found',
      };
  }
}

export function runShellLine(w: World, repo: RepoName, line: string, actor: Actor = 'me'): CmdResult {
  const parts = splitCommands(line);
  if (!parts.length) return { out: '', code: 0 };
  const outs: string[] = [];
  const exps: string[] = [];
  let last: CmdResult = { out: '', code: 0 };
  let skip = false;
  for (const p of parts) {
    if (skip) {
      // 前一個 && 失敗，略過
      skip = p.op === '&&';
      continue;
    }
    last = runSimple(w, repo, tokenize(p.cmd), actor);
    if (last.out) outs.push(last.out);
    if (last.explain) exps.push(last.explain);
    if (p.op === '&&' && last.code !== 0) skip = true;
  }
  return { out: outs.join('\n'), code: last.code, explain: exps.join('\n') || undefined, tag: last.tag };
}

export { getStatus, isIgnored };
