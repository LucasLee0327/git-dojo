import { describe, expect, it } from 'vitest';
import { runShellLine } from '../src/core/shell';
import { baseWorld } from '../src/levels/common';
import { botPush } from '../src/github/bots';
import { mergePR, createPR } from '../src/github/github';
import type { World } from '../src/git/types';
import { withDark, withTitle1, withFooterCount } from '../src/site/files';
import { headId, ancestors } from '../src/git/repo';

function sh(w: World, ...cmds: string[]) {
  let last = { out: '', code: 0, explain: undefined as string | undefined };
  for (const c of cmds) last = runShellLine(w, 'me', c) as typeof last;
  return last;
}
const edit = (w: World, path: string, fn: (s: string) => string) => {
  w.repos.me.work[path] = fn(w.repos.me.work[path]);
};
const parents = (w: World, id: string) => w.objects[id].parents;

describe('git 引擎：fast-forward', () => {
  it('落後 origin 一個 commit 時 git pull 是 fast-forward，沒有 merge commit', () => {
    const { w } = baseWorld({ meOn: 'staging', stale: true });
    const before = w.repos.me.branches.staging;
    const r = sh(w, 'git pull');
    expect(r.code).toBe(0);
    expect(r.out).toContain('Fast-forward');
    expect(w.repos.me.branches.staging).toBe(w.repos.origin.branches.staging);
    expect(parents(w, w.repos.me.branches.staging)).toEqual([before]);
  });
});

describe('git 引擎：三方合併與衝突', () => {
  it('不同檔案的修改自動合併，產生有兩個 parent 的 merge commit', () => {
    const { w } = baseWorld({ meOn: 'staging' });
    sh(w, 'git switch -c feat/a');
    edit(w, 'style.css', (s) => s + '\n.x { color: red; }\n');
    sh(w, 'git add style.css', 'git commit -m a');
    sh(w, 'git switch staging', 'git switch -c feat/b');
    edit(w, 'README.md', (s) => s + '\nhello\n');
    sh(w, 'git add README.md', 'git commit -m b');
    const r = sh(w, 'git merge feat/a');
    expect(r.code).toBe(0);
    const id = headId(w.repos.me)!;
    expect(parents(w, id).length).toBe(2);
    expect(w.objects[id].tree['style.css']).toContain('color: red');
    expect(w.objects[id].tree['README.md']).toContain('hello');
  });

  it('同一行被兩邊改：CONFLICT、檔案有標記、status 顯示 both modified，--abort 可以回復', () => {
    const { w } = baseWorld({ meOn: 'staging' });
    sh(w, 'git switch -c feat/a');
    w.repos.me.work['app.js'] = withTitle1({ 'app.js': w.repos.me.work['app.js'] }, '第 1 章　甲')['app.js'];
    sh(w, 'git add app.js', 'git commit -m a');
    sh(w, 'git switch staging', 'git switch -c feat/b');
    w.repos.me.work['app.js'] = withTitle1({ 'app.js': w.repos.me.work['app.js'] }, '第 1 章　乙')['app.js'];
    sh(w, 'git add app.js', 'git commit -m b');
    const r = sh(w, 'git merge feat/a');
    expect(r.code).not.toBe(0);
    expect(r.out).toContain('CONFLICT (content): Merge conflict in app.js');
    expect(w.repos.me.work['app.js']).toContain('<<<<<<< HEAD');
    expect(w.repos.me.work['app.js']).toContain('>>>>>>> feat/a');
    expect(sh(w, 'git status').out).toContain('both modified:   app.js');
    expect(sh(w, 'git commit -m x').code).not.toBe(0);
    const abort = sh(w, 'git merge --abort');
    expect(abort.code).toBe(0);
    expect(w.repos.me.work['app.js']).not.toContain('<<<<<<<');
    expect(w.repos.me.merge).toBeFalsy();
  });

  it('多重共同祖先（criss-cross）：互相合併過的分支再合併不會冒出假衝突', () => {
    const { w } = baseWorld({ meOn: 'staging' });
    sh(w, 'git switch -c a');
    w.repos.me.work['style.css'] += '\n.a{}\n';
    sh(w, 'git add style.css', 'git commit -m a1', 'git switch staging', 'git switch -c b');
    w.repos.me.work['README.md'] += '\nb\n';
    sh(w, 'git add README.md', 'git commit -m b1');
    sh(w, 'git switch a', 'git merge b', 'git switch b', 'git merge a');
    expect(sh(w, 'git switch a').code).toBe(0);
    expect(sh(w, 'git merge b').code).toBe(0);
  });
});

describe('git 引擎：push 被拒絕與追蹤關係', () => {
  it('遠端有本機沒有的 commit：fetch first；fetch 之後再 push 變成 non-fast-forward', () => {
    const { w } = baseWorld({ meOn: 'staging' });
    sh(w, 'git switch -c feat/x');
    edit(w, 'README.md', (s) => s + '\nA\n');
    sh(w, 'git add README.md', 'git commit -m a', 'git push -u origin feat/x');
    botPush(w, 'mei', 'feat/x', (t) => ({ ...t, 'style.css': t['style.css'] + '\n.mei{}\n' }), 'mei');
    edit(w, 'README.md', (s) => s + '\nB\n');
    sh(w, 'git add README.md', 'git commit -m b');
    let r = sh(w, 'git push');
    expect(r.code).not.toBe(0);
    expect(r.out).toContain('(fetch first)');
    sh(w, 'git fetch');
    r = sh(w, 'git push');
    expect(r.out).toContain('(non-fast-forward)');
    expect(r.out).toContain('rejected');
    // 正解：pull 之後可以 push
    expect(sh(w, 'git pull').code).toBe(0);
    expect(sh(w, 'git push').code).toBe(0);
  });

  it('沒設 upstream：git push / git pull 都有明確錯誤；push -u 之後正常，status 與 branch -vv 顯示追蹤', () => {
    const { w } = baseWorld({ meOn: 'staging' });
    sh(w, 'git switch -c feat/y');
    edit(w, 'README.md', (s) => s + '\nA\n');
    sh(w, 'git add README.md', 'git commit -m a');
    const p = sh(w, 'git push');
    expect(p.code).not.toBe(0);
    expect(p.out).toContain('has no upstream branch');
    const pl = sh(w, 'git pull');
    expect(pl.out).toContain('There is no tracking information for the current branch');
    expect(sh(w, 'git push -u origin feat/y').code).toBe(0);
    expect(sh(w, 'git branch -vv').out).toMatch(/feat\/y\s+\w+ \[origin\/feat\/y\]/);
    edit(w, 'README.md', (s) => s + '\nB\n');
    sh(w, 'git add README.md', 'git commit -m b');
    expect(sh(w, 'git status').out).toContain("Your branch is ahead of 'origin/feat/y' by 1 commit");
    expect(sh(w, 'git branch -vv').out).toContain('[origin/feat/y: ahead 1]');
  });

  it('push 到 staging 沒有被擋，但會跳警報（沒有分支保護）', () => {
    const { w } = baseWorld({ meOn: 'staging' });
    edit(w, 'README.md', (s) => s + '\nA\n');
    sh(w, 'git add README.md', 'git commit -m a');
    const r = sh(w, 'git push');
    expect(r.code).toBe(0);
    expect(w.github.alerts.length).toBe(1);
  });
});

describe('git 引擎：squash merge、branch -d、revert、reset', () => {
  function featureMerged() {
    const { w } = baseWorld({ meOn: 'staging' });
    sh(w, 'git switch -c feat/dark');
    for (const [p, c] of Object.entries(withDark({ ...w.repos.me.work }))) w.repos.me.work[p] = c;
    sh(w, 'git add index.html app.js style.css tests/app.test.js', 'git commit -m dark', 'git push -u origin feat/dark');
    const pr = createPR(w, { title: 'dark', body: '', head: 'feat/dark', base: 'staging', draft: false, author: 'me' }).pr!;
    expect(mergePR(w, pr, 'squash', 'boss').ok).toBe(true);
    return { w, pr };
  }

  it('Squash 合併後：本機 git branch -d 失敗（不是 ancestor），-D 成功；squash commit 只有一個 parent', () => {
    const { w, pr } = featureMerged();
    const sq = w.objects[pr.mergeSha!];
    expect(sq.parents.length).toBe(1);
    sh(w, 'git switch staging', 'git pull');
    expect(ancestors(w, headId(w.repos.me)!).has(w.repos.me.branches['feat/dark'])).toBe(false);
    const d = sh(w, 'git branch -d feat/dark');
    expect(d.code).not.toBe(0);
    expect(d.out).toContain('not fully merged');
    expect(sh(w, 'git branch -D feat/dark').code).toBe(0);
    expect(w.repos.me.branches['feat/dark']).toBeUndefined();
  });

  it('merge commit 合併後 branch -d 成功（是 ancestor）', () => {
    const { w } = baseWorld({ meOn: 'staging' });
    sh(w, 'git switch -c feat/z');
    edit(w, 'README.md', (s) => s + '\nz\n');
    sh(w, 'git add README.md', 'git commit -m z', 'git push -u origin feat/z');
    const pr = createPR(w, { title: 'z', body: '', head: 'feat/z', base: 'staging', draft: false, author: 'me' }).pr!;
    mergePR(w, pr, 'merge', 'boss');
    sh(w, 'git switch staging', 'git pull');
    expect(sh(w, 'git branch -d feat/z').code).toBe(0);
  });

  it('git revert：產生反向 commit，歷史保留；revert merge commit 需要 -m 1', () => {
    const { w } = baseWorld({ meOn: 'staging' });
    edit(w, 'README.md', (s) => s + '\nBAD\n');
    sh(w, 'git add README.md', 'git commit -m bad');
    const bad = headId(w.repos.me)!;
    const r = sh(w, 'git revert HEAD --no-edit');
    expect(r.code).toBe(0);
    const head = headId(w.repos.me)!;
    expect(parents(w, head)).toEqual([bad]);
    expect(w.objects[head].tree['README.md']).not.toContain('BAD');
    expect(ancestors(w, head).has(bad)).toBe(true);
    sh(w, 'git switch -c feat/m');
    edit(w, 'style.css', (s) => s + '\n.m{}\n');
    sh(w, 'git add style.css', 'git commit -m m', 'git switch staging', 'git merge --no-ff feat/m -m merge-m');
    const mc = headId(w.repos.me)!;
    expect(parents(w, mc).length).toBe(2);
    expect(sh(w, 'git revert HEAD --no-edit').code).not.toBe(0);
    expect(sh(w, 'git revert -m 1 HEAD --no-edit').code).toBe(0);
  });

  it('git reset：--soft 保留暫存、--mixed 保留工作資料夾、--hard 全部丟掉；reflog 有紀錄', () => {
    const { w } = baseWorld({ meOn: 'staging' });
    const base = headId(w.repos.me)!;
    edit(w, 'README.md', (s) => s + '\nR\n');
    sh(w, 'git add README.md', 'git commit -m r');
    const c = headId(w.repos.me)!;
    sh(w, 'git reset --soft HEAD~1');
    expect(headId(w.repos.me)).toBe(base);
    expect(w.repos.me.index['README.md']).toContain('R');
    sh(w, 'git commit -m r');
    sh(w, 'git reset --mixed HEAD~1');
    expect(w.repos.me.index['README.md']).not.toContain('\nR\n');
    expect(w.repos.me.work['README.md']).toContain('\nR\n');
    sh(w, 'git add README.md', 'git commit -m r');
    sh(w, 'git reset --hard HEAD~1');
    expect(w.repos.me.work['README.md']).not.toContain('\nR\n');
    expect(sh(w, 'git reflog').out).toContain('reset');
    expect(Object.keys(w.objects)).toContain(c);
  });

  it('dirty 工作資料夾切換分支：被拒絕並說明', () => {
    const { w } = baseWorld({ meOn: 'staging' });
    sh(w, 'git switch -c feat/q');
    edit(w, 'README.md', (s) => s + '\nQ\n');
    sh(w, 'git add README.md', 'git commit -m q', 'git switch staging');
    edit(w, 'README.md', (s) => s + '\ndirty\n');
    const r = sh(w, 'git switch feat/q');
    expect(r.code).not.toBe(0);
    expect(r.out).toContain('would be overwritten');
  });
});

describe('git 引擎：origin/* 是上次 fetch 的樣子', () => {
  it('小美推了新 commit：fetch 之前 status 還是 up to date，fetch 之後才顯示 behind', () => {
    const { w } = baseWorld({ meOn: 'staging' });
    botPush(w, 'mei', 'staging', (t) => withFooterCount(t), 'x', 'staging');
    expect(sh(w, 'git status').out).toContain('up to date');
    sh(w, 'git fetch');
    expect(sh(w, 'git status').out).toContain('behind');
  });
});

describe('git 引擎：pull.rebase 設定', () => {
  // 本機與遠端各有一個對方沒有的 commit（分岔）
  const diverge = (pullRebase: boolean | null) => {
    const { w } = baseWorld({ meOn: 'staging' });
    sh(w, 'git switch -c feat/z');
    edit(w, 'README.md', (s) => s + '\nA\n');
    sh(w, 'git add README.md', 'git commit -m a', 'git push -u origin feat/z');
    botPush(w, 'mei', 'feat/z', (t) => ({ ...t, 'style.css': t['style.css'] + '\n.mei{}\n' }), 'mei');
    edit(w, 'README.md', (s) => s + '\nB\n');
    sh(w, 'git add README.md', 'git commit -m b');
    w.repos.me.config.pullRebase = pullRebase;
    return w;
  };

  it('沒設 pull.rebase、分支分岔：git pull 失敗並顯示 Need to specify how to reconcile；git config pull.rebase false 之後 pull 以 merge 成功', () => {
    const w = diverge(null);
    const before = w.repos.me.branches['feat/z'];
    const r = sh(w, 'git pull');
    expect(r.code).not.toBe(0);
    expect(r.out).toContain('Need to specify how to reconcile divergent branches');
    expect(w.repos.me.branches['feat/z']).toBe(before);
    expect(sh(w, 'git config pull.rebase false').code).toBe(0);
    expect(sh(w, 'git pull').code).toBe(0);
    expect(parents(w, w.repos.me.branches['feat/z'])).toHaveLength(2);
  });

  it('練習用 repo 預設 pull.rebase=false：分岔時 git pull 直接 merge', () => {
    const w = diverge(false);
    expect(sh(w, 'git pull').code).toBe(0);
    expect(parents(w, w.repos.me.branches['feat/z'])).toHaveLength(2);
  });
});
