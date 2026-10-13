// bash 風格的終端機：歷史、↑↓、Tab 補完、輸出 + 中文解說。
import { useEffect, useRef, useState } from 'preact/hooks';
import type { Game } from '../core/game';
import { colorOf } from './graph/colors';

const COMMANDS = ['git', 'gh', 'ls', 'cat', 'rm', 'echo', 'npm', 'clear', 'help', 'pwd'];
const GIT_SUBS = [
  'status', 'add', 'restore', 'rm', 'commit', 'switch', 'checkout', 'branch', 'log', 'diff', 'show', 'fetch', 'pull', 'push', 'merge', 'rebase',
  'reset', 'revert', 'cherry-pick', 'stash', 'clean', 'reflog', 'config', 'remote', 'rev-parse', 'ls-files',
];
const GH_SUBS = ['pr'];
const GH_PR = ['create', 'view', 'list', 'ready', 'checks', 'merge'];
const FLAGS: Record<string, string[]> = {
  commit: ['-m', '--amend', '--no-verify'],
  push: ['-u', '--force', 'origin'],
  pull: ['--rebase', '--no-rebase', 'origin'],
  fetch: ['--prune', 'origin'],
  branch: ['-d', '-D', '-vv', '-a', '--show-current'],
  log: ['--oneline', '--graph', '--all', '--decorate'],
  switch: ['-c'],
  checkout: ['-b', '--ours', '--theirs', '--'],
  merge: ['--abort', '--no-edit'],
  reset: ['--soft', '--mixed', '--hard'],
  restore: ['--staged'],
  diff: ['--staged', '--stat'],
  add: ['-A', '-u', '.'],
  stash: ['pop', 'list'],
  revert: ['-m'],
};

function commonPrefix(xs: string[]): string {
  if (!xs.length) return '';
  let p = xs[0];
  for (const x of xs) while (!x.startsWith(p)) p = p.slice(0, -1);
  return p;
}

function candidates(g: Game, tokens: string[], partial: string): string[] {
  if (tokens.length === 0) return COMMANDS;
  const first = tokens[0];
  if (first === 'git') {
    if (tokens.length === 1) return GIT_SUBS;
    const sub = tokens[1];
    const names = [...Object.keys(g.me.branches), ...Object.keys(g.me.remotes)];
    const files = [...new Set([...Object.keys(g.me.work), ...Object.keys(g.me.index)])];
    return [...(FLAGS[sub] ?? []), ...names, ...files];
  }
  if (first === 'gh') {
    if (tokens.length === 1) return GH_SUBS;
    if (tokens.length === 2) return GH_PR;
    return ['--draft', '--title', '--body', '--squash', '--merge', '--base', '--head'];
  }
  if (first === 'cat' || first === 'rm' || first === 'ls') return [...new Set([...Object.keys(g.me.work), ...Object.keys(g.me.index)])];
  if (first === 'npm') return ['test'];
  void partial;
  return [];
}

export function Terminal({ g }: { g: Game }) {
  const s = g.state;
  const [text, setText] = useState('');
  const [hidx, setHidx] = useState<number | null>(null);
  const [hint, setHint] = useState<string[] | null>(null);
  const body = useRef<HTMLDivElement>(null);
  const input = useRef<HTMLInputElement>(null);
  const cur = g.branch;
  const history = s.hist.filter((h) => h.src === 'user' && !h.cmd.startsWith('[')).map((h) => h.cmd);

  useEffect(() => {
    const el = body.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [s.term.length, hint]);

  const submit = () => {
    const line = text.trim();
    setText('');
    setHidx(null);
    setHint(null);
    if (line) g.runTerminal(line);
  };

  const complete = () => {
    const m = text.match(/^(.*?)(\S*)$/s);
    const before = m ? m[1] : '';
    const partial = m ? m[2] : '';
    const tokens = before.trim() ? before.trim().split(/\s+/) : [];
    const pool = [...new Set(candidates(g, tokens, partial))];
    const matches = pool.filter((c) => c.startsWith(partial));
    if (!matches.length) return setHint(null);
    if (matches.length === 1) {
      setText(before + matches[0] + (matches[0].endsWith('/') ? '' : ' '));
      return setHint(null);
    }
    const cp = commonPrefix(matches);
    if (cp.length > partial.length) setText(before + cp);
    setHint(matches);
  };

  const onKey = (e: KeyboardEvent) => {
    if (e.key === 'Tab') {
      e.preventDefault();
      complete();
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      if (!history.length) return;
      const i = hidx === null ? history.length - 1 : Math.max(0, hidx - 1);
      setHidx(i);
      setText(history[i]);
    } else if (e.key === 'ArrowDown') {
      e.preventDefault();
      if (hidx === null) return;
      const i = hidx + 1;
      if (i >= history.length) {
        setHidx(null);
        setText('');
      } else {
        setHidx(i);
        setText(history[i]);
      }
    } else if (e.key === 'l' && e.ctrlKey) {
      e.preventDefault();
      g.runTerminal('clear');
    }
  };

  const Prompt = ({ branch }: { branch?: string | null }) => (
    <span class="prompt">
      <span class="p-path">~/tinynote</span>
      {branch ? (
        <span class="p-branch" style={`color:${colorOf(branch)}`}>
          {' '}
          ({branch})
        </span>
      ) : (
        <span class="p-branch detached"> (detached)</span>
      )}
      <span class="p-dollar"> $</span>
    </span>
  );

  return (
    <section class="term" aria-label="終端機" onClick={() => input.current?.focus()}>
      <header class="pane-head">
        <strong>終端機</strong>
        <span class="dim">~/tinynote（你的電腦）</span>
        <span class="spacer" />
        <button class="btn small ghost" onClick={() => g.runTerminal('help')} title="列出這個練習場支援的指令">
          help
        </button>
      </header>
      <div class="term-body" ref={body}>
        {s.term.length === 0 && (
          <div class="term-hello">
            輸入 git 指令，按 Enter 執行。<span class="dim">Tab 補完、↑ 叫出上一個指令。輸出是 git 的英文原文，下面會附中文解說。</span>
          </div>
        )}
        {s.term.map((l, i) => {
          if (l.kind === 'cmd')
            return (
              <div key={i} class="tl cmd">
                <Prompt branch={l.branch} /> <span class="cmdtext">{l.text}</span>
              </div>
            );
          if (l.kind === 'explain')
            return (
              <div key={i} class="tl explain">
                <span class="exp-tag">中文解說</span>
                {l.text}
              </div>
            );
          return (
            <pre key={i} class={`tl ${l.kind}`}>
              {l.text}
            </pre>
          );
        })}
        {hint && <div class="tl hintrow">{hint.join('   ')}</div>}
        <form
          class="tl inputrow"
          onSubmit={(e) => {
            e.preventDefault();
            submit();
          }}
        >
          <Prompt branch={cur} />
          <input
            ref={input}
            value={text}
            onInput={(e) => {
              setText((e.target as HTMLInputElement).value);
              setHint(null);
            }}
            onKeyDown={onKey}
            spellcheck={false}
            autocomplete="off"
            autocapitalize="off"
            aria-label="終端機輸入"
            placeholder="輸入指令…"
          />
        </form>
      </div>
    </section>
  );
}
