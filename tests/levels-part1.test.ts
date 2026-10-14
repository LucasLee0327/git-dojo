import { describe, expect, it } from 'vitest';
import { expectDone, fileOf, lastCode, lastOut, lookAll, notDone, say, start, T } from './helpers';

describe('第 0 關', () => {
  it('標準解', () => {
    const g = start(0);
    expect(notDone(g)).toEqual(['status', 'log', 'tabs', 'ai']);
    T(g, 'git status', 'git log --oneline --graph --all');
    ['preview', 'github', 'editor'].forEach((t) => g.visit(t));
    say(g, 'l0-a');
    expectDone(g);
  });
});

describe('第 1 關', () => {
  it('標準解：分支 → 改 → 只 add 該 add 的 → push -u → PR → 部長合併 → 收尾', () => {
    const g = start(1);
    T(g, 'git status');
    expect(lastOut(g)).toContain('ai-notes.md');
    expect(lastOut(g)).not.toMatch(/^	.env/m);
    T(g, 'git switch staging', 'git pull', 'git switch -c feat/dark-mode');
    expect(notDone(g)[0]).toBe('edit');
    expect(g.applyEdit('dark-mode')).toBe(true);
    T(g, 'git add index.html app.js style.css tests/app.test.js', 'git commit -m "新增深色模式按鈕"');
    expect(lastCode(g)).toBe(0);
    T(g, 'git push -u origin feat/dark-mode');
    expect(lastCode(g)).toBe(0);
    const res = g.ghCreatePR({ title: '新增深色模式按鈕', body: '', head: 'feat/dark-mode', base: 'staging', draft: true });
    expect(res.pr).toBeTruthy();
    lookAll(g, res.pr!.number);
    g.ghReady(res.pr!.number);
    expect(g.prs.find((p) => p.number === res.pr!.number)!.state).toBe('merged');
    T(g, 'git switch staging', 'git pull', 'git branch -d feat/dark-mode');
    expect(lastCode(g)).not.toBe(0);
    expect(lastOut(g)).toContain('not fully merged');
    T(g, 'git branch -D feat/dark-mode');
    expect(lastCode(g)).toBe(0);
    expectDone(g);
    expect(fileOf(g, 'origin', 'staging', 'ai-notes.md')).toBeUndefined();
  });

  it('危險路線：git add . 會把雜物帶進 commit，觸發 banner；用 restore --staged 可救', () => {
    const g = start(1);
    T(g, 'git switch staging', 'git pull', 'git switch -c feat/dark-mode');
    g.applyEdit('dark-mode');
    T(g, 'git add .');
    T(g, 'git status');
    expect(lastOut(g)).toContain('Changes to be committed');
    T(g, 'git restore --staged ai-notes.md screenshot.png', 'git status');
    expect(lastOut(g)).toContain('Untracked files');
  });

  it('危險路線：直接 push 到 staging 觸發陷阱', () => {
    const g = start(1);
    T(g, 'git switch staging', 'git pull');
    g.applyEdit('dark-mode'); // 在 staging 上不可用
    T(g, 'git commit --allow-empty -m x', 'git push');
    expect(g.state.traps).toContain('push-protected');
  });
});

describe('第 2 關', () => {
  function toConflict() {
    const g = start(2);
    T(g, 'git branch --show-current', 'git switch feat/chapter-title', 'git fetch', 'git merge origin/staging');
    return g;
  }
  it('標準解：fetch → merge → 解衝突 → add/commit → push → 部長合併', () => {
    const g = toConflict();
    expect(lastOut(g)).toContain('CONFLICT');
    expect(g.me.work['app.js']).toContain('<<<<<<< HEAD');
    const fixed = g.me.work['app.js']
      .replace(/<<<<<<< HEAD\n[\s\S]*?=======\n[\s\S]*?>>>>>>> [^\n]*\n/, "  { id: 1, title: '第 1 章　心血管系統（含圖解）', body: '心臟有四個腔室：左右心房與左右心室。' },\n");
    g.saveFile('app.js', fixed);
    T(g, 'git add app.js', 'git commit -m "合併 staging，解決標題衝突"');
    expect(lastCode(g)).toBe(0);
    T(g, 'git push');
    expect(lastCode(g)).toBe(0);
    expectDone(g);
  });
  it('危險路線：pre-commit 擋下衝突記號；用 --no-verify 硬 commit → trap', () => {
    const g = toConflict();
    T(g, 'git add app.js', 'git commit -m "oops"');
    expect(lastCode(g)).not.toBe(0);
    T(g, 'git commit --no-verify -m "oops"');
    expect(g.state.traps).toContain('markers-committed');
    expect(notDone(g)).toContain('commit');
  });
});

describe('第 3 關', () => {
  function toLocalCommit() {
    const g = start(3);
    expect(g.branch).toBe('feat/chapter-count');
    g.applyEdit('footer-style');
    T(g, 'git add style.css', 'git commit -m "幫頁尾加上樣式"');
    expect(lastCode(g)).toBe(0);
    return g;
  }
  it('標準解：push 沒 upstream → push -u 被拒 → pull 無追蹤 → pull origin → push -u', () => {
    const g = toLocalCommit();
    T(g, 'git push');
    expect(lastCode(g)).not.toBe(0);
    expect(lastOut(g)).toContain('no upstream branch');
    T(g, 'git push -u origin feat/chapter-count');
    expect(lastCode(g)).not.toBe(0);
    expect(lastOut(g)).toContain('fetch first');
    T(g, 'git pull');
    expect(lastCode(g)).not.toBe(0);
    expect(lastOut(g)).toContain('no tracking information');
    T(g, 'git pull origin feat/chapter-count');
    expect(lastCode(g)).toBe(0);
    T(g, 'git push -u origin feat/chapter-count');
    expect(lastCode(g)).toBe(0);
    const n = g.prs.find((p) => p.head === 'feat/chapter-count')!.number;
    lookAll(g, n);
    g.ghReady(n);
    expectDone(g);
  });
  it('危險路線：force push 蓋掉部長的 merge commit → trap', () => {
    const g = toLocalCommit();
    T(g, 'git push -u --force origin feat/chapter-count');
    expect(g.state.traps).toContain('push-forced');
  });
});

describe('第 4 關', () => {
  it('標準解 4a + 4b：搬走 commit → staging 對齊 → 壞 commit 被 revert（fix 分支＋PR）', () => {
    const g = start(4);
    T(g, 'git status');
    expect(lastOut(g)).toContain('ahead');
    T(g, 'git switch -c feat/footer-copyright', 'git switch staging', 'git reset --hard origin/staging');
    expect(g.me.branches.staging).toBe(g.origin.branches.staging);
    // 4b 觸發
    expect(g.flags['ev:stage-b']).toBe(true);
    expect(g.w.github.alerts.length).toBe(1);
    expect(g.branch).toBe('staging');
    T(g, 'git switch -c fix/revert-footer', 'git revert HEAD --no-edit');
    expect(lastCode(g)).toBe(0);
    T(g, 'git push -u origin fix/revert-footer');
    expect(lastCode(g)).toBe(0);
    const r = g.ghCreatePR({ title: '還原頁尾版權', body: '', head: 'fix/revert-footer', base: 'staging', draft: true });
    expect(r.pr).toBeTruthy();
    lookAll(g, r.pr!.number);
    g.ghReady(r.pr!.number);
    expectDone(g);
  });
  it('危險路線：4a 直接 push 到 staging → trap', () => {
    const g = start(4);
    T(g, 'git push');
    expect(g.state.traps).toContain('pushed-before-rescue');
    expect(g.w.github.alerts.length).toBe(1);
  });
  it('危險路線：4b 用 force push 抹掉壞 commit → trap', () => {
    const g = start(4);
    T(g, 'git status', 'git switch -c feat/footer-copyright', 'git switch staging', 'git reset --hard origin/staging');
    T(g, 'git reset --hard HEAD~1', 'git push --force');
    expect(g.state.traps).toContain('force-on-staging');
  });
});
