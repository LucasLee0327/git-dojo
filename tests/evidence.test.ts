// 🧑「看過」類任務：要真的打開 PR 的分頁，而且綁定 PR 目前的 head commit。
// 按 Ready／送審查／合併不會被擋，但沒看就不打勾、不過關，並跳出警告。
import { describe, expect, it } from 'vitest';
import type { Game } from '../src/core/game';
import { botPush } from '../src/github/bots';
import type { EvTab } from '../src/levels/types';
import { expectDone, look, notDone, say, start, T } from './helpers';

const warned = (g: Game) => g.bannerText().includes('還沒看');
const ALL: EvTab[] = ['files', 'checks', 'preview'];

// ---- 各關「按 Ready 之前」的狀態（回傳 PR 號） ----
function l1(g: Game): number {
  T(g, 'git switch staging', 'git pull', 'git switch -c feat/dark-mode');
  g.applyEdit('dark-mode');
  T(g, 'git add index.html app.js style.css tests/app.test.js', 'git commit -m "新增深色模式按鈕"', 'git push -u origin feat/dark-mode');
  const res = g.ghCreatePR({ title: '新增深色模式按鈕', body: '', head: 'feat/dark-mode', base: 'staging', draft: true });
  return res.pr!.number;
}
function l3(g: Game): number {
  g.applyEdit('footer-style');
  T(g, 'git add style.css', 'git commit -m "幫頁尾加上樣式"', 'git pull origin feat/chapter-count', 'git push -u origin feat/chapter-count');
  return g.prs.find((p) => p.head === 'feat/chapter-count')!.number;
}
function l4Branch(g: Game) {
  T(g, 'git status', 'git switch -c feat/footer-copyright', 'git switch staging', 'git reset --hard origin/staging');
  T(g, 'git switch -c fix/revert-footer', 'git revert HEAD --no-edit', 'git push -u origin fix/revert-footer');
}
function l4(g: Game): number {
  l4Branch(g);
  return g.ghCreatePR({ title: '還原頁尾版權', body: '', head: 'fix/revert-footer', base: 'staging', draft: true }).pr!.number;
}
function l5(g: Game): number {
  say(g, 'l5-a');
  return g.prs.find((p) => p.head === 'feat/bookmark')!.number;
}
function l6(g: Game): number {
  say(g, 'l6-a');
  say(g, 'l6-both');
  say(g, 'l6-push-good');
  return g.prs.find((p) => p.head === 'feat/highlight')!.number;
}
function l7(g: Game): number {
  const n = g.prs.find((p) => p.head === 'feat/recent')!.number;
  say(g, 'l7-c');
  g.ghUpdateBranch(n);
  say(g, 'l7-a');
  return n;
}

/** 合併之後要做的收尾（只有第 1 關有 cleanup 任務） */
const finish = (level: number, g: Game) => {
  if (level === 1) T(g, 'git switch staging', 'git pull', 'git branch -D feat/dark-mode');
};

const CASES: { level: number; name: string; reach: (g: Game) => number; tabs: EvTab[]; id: string }[] = [
  { level: 1, name: '第 1 關', reach: l1, tabs: ['files', 'checks', 'preview'], id: 'ready' },
  { level: 3, name: '第 3 關', reach: l3, tabs: ['checks'], id: 'ready' },
  { level: 4, name: '第 4 關（4b）', reach: l4, tabs: ['checks'], id: 'pr' },
  { level: 5, name: '第 5 關', reach: l5, tabs: ['files', 'checks', 'preview'], id: 'ready' },
  { level: 6, name: '第 6 關', reach: l6, tabs: ['files', 'preview'], id: 'ready' },
  { level: 7, name: '第 7 關', reach: l7, tabs: ['checks', 'preview'], id: 'ready' },
];

describe.each(CASES)('$name：Ready 要看過對應分頁', ({ level, reach, tabs, id }) => {
  it('(a) 沒看就轉 Ready：不擋、跳警告，但這一格沒打勾、不過關', () => {
    const g = start(level);
    const n = reach(g);
    expect(notDone(g)).toContain(id);
    g.ghReady(n);
    expect(g.pr(n)!.draft).toBe(false); // 沒被擋
    expect(warned(g)).toBe(true);
    expect(g.bannerText()).toContain('不會打勾');
    expect(notDone(g)).toContain(id);
    expect(g.state.done).toBe(false);
  });

  it('(b) 看完該看的分頁再轉 Ready：打勾、沒有警告、過關', () => {
    const g = start(level);
    const n = reach(g);
    look(g, n, ...tabs);
    expect(g.checkedPR(n, tabs)).toBe(true);
    g.ghReady(n);
    expect(warned(g)).toBe(false);
    expect(notDone(g)).not.toContain(id);
    finish(level, g);
    expectDone(g);
  });

  it('只看一部分：缺的分頁會被點名，仍不打勾', () => {
    if (tabs.length < 2) return;
    const g = start(level);
    const n = reach(g);
    look(g, n, tabs[0]);
    g.ghReady(n);
    expect(warned(g)).toBe(true);
    expect(g.bannerText()).toContain({ files: 'Files changed', checks: 'Checks', preview: '預覽站' }[tabs[1]]);
    expect(notDone(g)).toContain(id);
  });

  it('(d) 沒看就轉 Ready、PR 被部長合併之後，回去補看（finalHead）就能打勾過關', () => {
    const g = start(level);
    const n = reach(g);
    g.ghReady(n);
    expect(g.pr(n)!.state).toBe('merged');
    expect(g.state.done).toBe(false);
    look(g, n, ...tabs);
    expect(notDone(g)).not.toContain(id);
    finish(level, g);
    expectDone(g);
  });
});

describe('PR 有新 commit 之後，舊的「看過」不算（綁定 head commit）', () => {
  it('第 1 關：看完三個分頁 → 又 push 新 commit → 要重看；警告說明看的是舊版', () => {
    const g = start(1);
    const n = l1(g);
    look(g, n);
    const sha0 = g.headSha(g.pr(n)!)!;
    expect(g.checkedPR(n, ALL)).toBe(true);
    g.saveFile('README.md', '# 小共筆\n多一行\n');
    T(g, 'git add README.md', 'git commit -m "補充說明"', 'git push');
    expect(g.headSha(g.pr(n)!)).not.toBe(sha0);
    expect(g.checkedPR(n, ['files'])).toBe(false);
    expect(g.seenPR(n, ['files'])).toBe(true); // 舊版看過，但不算數
    g.ghReady(n);
    expect(warned(g)).toBe(true);
    expect(g.bannerText()).toContain('舊版');
    expect(notDone(g)).toContain('ready');
    // 部長已合併；補看 finalHead
    expect(g.pr(n)!.state).toBe('merged');
    look(g, n);
    expect(notDone(g)).not.toContain('ready');
  });

  it('第 5 關：看過之後 PR 的 head 前進，要重看才打勾', () => {
    const g = start(5);
    const n = l5(g);
    look(g, n);
    expect(g.checkedPR(n, ALL)).toBe(true);
    const before = g.origin.branches['feat/bookmark'];
    botPush(g.w, 'me', 'feat/bookmark', (t) => ({ ...t, 'README.md': t['README.md'] + '\n補一行\n' }), '補一行');
    expect(g.origin.branches['feat/bookmark']).not.toBe(before);
    expect(g.checkedPR(n, ALL)).toBe(false);
    g.ghReady(n);
    expect(warned(g)).toBe(true);
    expect(notDone(g)).toContain('ready');
    look(g, n);
    expect(notDone(g)).not.toContain('ready');
  });

  it('時光倒流：證據跟著狀態一起倒回去', () => {
    const g = start(1);
    const n = l1(g);
    g.ghReady(n); // 沒看就轉 Ready（先建立檢查點）
    look(g, n);
    expect(g.checkedPR(n, ALL)).toBe(true);
    const cp = g.checkpoints.find((c) => c.label.includes('Ready'))!;
    g.undoTo(cp.id);
    expect(g.pr(n)!.draft).toBe(true);
    expect(g.checkedPR(n, ['files'])).toBe(false);
    expect(g.state.flags.evidence ?? []).toEqual([]);
  });

  it('證據的資料結構：{ pr, tab, sha }，同一個 head 不重複記', () => {
    const g = start(5);
    const n = l5(g);
    expect(g.seenPR(n, ['preview'])).toBe(false);
    g.viewPR(n, 'preview');
    g.viewPR(n, 'preview');
    expect(g.state.flags.evidence).toEqual([{ pr: n, tab: 'preview', sha: g.origin.branches['feat/bookmark'] }]);
  });
});

describe('第 4 關：直接以 Ready 開出修復 PR', () => {
  it('沒看 Checks 就以 Ready 開出：警告；部長合併後回去補看 Checks 才打勾', () => {
    const g = start(4);
    l4Branch(g);
    const r = g.ghCreatePR({ title: '還原頁尾版權', body: '', head: 'fix/revert-footer', base: 'staging', draft: false });
    expect(warned(g)).toBe(true);
    expect(notDone(g)).toContain('pr');
    expect(g.state.done).toBe(false);
    look(g, r.pr!.number, 'checks');
    expectDone(g);
  });
});

describe('第 8 關：審查要真的看過', () => {
  const PR = (g: Game) => g.prs.find((p) => p.head === 'feat/font-size')!;
  const TODO = (g: Game, id: string) => g.def.review!.todos.find((t) => t.id === id)!.label;
  const REQ = (g: Game) => [TODO(g, 'codex'), TODO(g, 'test'), TODO(g, 'style'), TODO(g, 'fontdown')];

  it('(a) 沒看就送 Request changes：look 不再因為「送出過審查」而打勾，並跳警告', () => {
    const g = start(8);
    g.ghReview(PR(g).number, 'changes_requested', '', REQ(g));
    expect(warned(g)).toBe(true);
    expect(notDone(g)).toContain('look');
    expect(notDone(g)).not.toContain('request');
  });

  it('(b) 只看預覽或只看 Files changed：look 仍未打勾；兩個都看才打勾', () => {
    const g = start(8);
    look(g, PR(g).number, 'preview');
    expect(notDone(g)).toContain('look');
    look(g, PR(g).number, 'files');
    expect(notDone(g)).not.toContain('look');
  });

  it('(c)(d) 小美推了修正之後，沒重看就 Approve＋合併：merged 不打勾、跳警告；補看 finalHead 後過關', () => {
    const g = start(8);
    const n = PR(g).number;
    look(g, n, 'preview', 'files');
    g.ghReview(n, 'changes_requested', '', REQ(g));
    expect(warned(g)).toBe(false); // 第一次審查前有看過
    expect(notDone(g)).toEqual(['merged']);
    g.ghReview(n, 'approved', 'OK', []);
    expect(warned(g)).toBe(true);
    expect(g.bannerText()).toContain('舊版');
    g.ghMerge(n, 'squash');
    expect(PR(g).state).toBe('merged');
    expect(notDone(g)).toEqual(['merged']);
    expect(g.state.done).toBe(false);
    // 合併後回去補看（已合併 PR 的預覽顯示合併前最後一版）
    look(g, n, 'preview', 'files');
    expectDone(g);
  });

  it('小美修好後重看再 Approve＋合併：沒有警告，過關', () => {
    const g = start(8);
    const n = PR(g).number;
    look(g, n, 'preview', 'files');
    g.ghReview(n, 'changes_requested', '', REQ(g));
    look(g, n, 'preview', 'files');
    g.ghReview(n, 'approved', 'OK', []);
    g.ghMerge(n, 'squash');
    expect(warned(g)).toBe(false);
    expectDone(g);
  });
});

describe('第 9 關：see 只認「真的打開測試站預覽」', () => {
  it('直接按 Revert 不會讓 see 打勾；回去看測試站才打勾並過關', () => {
    const g = start(9);
    expect(g.ghRevert(12)).toBeNull();
    expect(notDone(g)).toContain('see');
    g.ghMerge(g.prs.find((p) => p.revertOf === 12)!.number, 'squash');
    expect(notDone(g)).toEqual(['see']);
    expect(g.state.done).toBe(false);
    g.visit('staging-preview');
    expectDone(g);
  });
});

describe('第 10 關：上線 PR 合併前要看 Checks', () => {
  const open = (g: Game) => g.ghCreatePR({ title: '上線：staging → master', body: '', head: 'staging', base: 'master', draft: false }).pr!;

  it('開 PR 不會讓 preview 打勾；看過測試站與正式站才打勾', () => {
    const g = start(10);
    open(g);
    expect(notDone(g)).toContain('preview');
    g.visit('staging-preview');
    g.visit('production-preview');
    expect(notDone(g)).not.toContain('preview');
  });

  it('(a)(d) 沒看 Checks 就合併：不擋、跳警告、不過關；補看 Checks 後過關', () => {
    const g = start(10);
    g.visit('staging-preview');
    g.visit('production-preview');
    const pr = open(g);
    expect(g.ghMerge(pr.number, 'merge')).toBeNull();
    expect(warned(g)).toBe(true);
    expect(notDone(g)).toEqual(['merged']);
    expect(g.state.done).toBe(false);
    look(g, pr.number, 'checks');
    expectDone(g);
  });

  it('(b) 先看 Checks 再合併：沒有警告，過關', () => {
    const g = start(10);
    g.visit('staging-preview');
    g.visit('production-preview');
    const pr = open(g);
    look(g, pr.number, 'checks');
    g.ghMerge(pr.number, 'merge');
    expect(warned(g)).toBe(false);
    expectDone(g);
  });
});
