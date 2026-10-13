import { describe, expect, it } from 'vitest';
import type { Game } from '../src/core/game';
import { expectDone, notDone, start } from './helpers';
import { checksGreen } from '../src/github/github';

const TODO = (g: Game, id: string) => g.def.review!.todos.find((t) => t.id === id)!.label;

describe('第 8 關（部長審查）', () => {
  const PR = (g: Game) => g.prs.find((p) => p.head === 'feat/font-size')!;

  it('起始狀態：小美的 PR CI 全綠、Ready，但有三個問題', () => {
    const g = start(8);
    expect(g.def.role).toBe('lead');
    expect(PR(g).draft).toBe(false);
    expect(checksGreen(g.w, PR(g))).toBe(true);
    expect(g.w.objects[g.origin.branches['feat/font-size']].tree['.codex/config.toml']).toBeTruthy();
    expect(notDone(g)).toEqual(['look', 'request', 'fixed', 'merged']);
  });

  it('標準解：看預覽與檔案 → Request changes（三個待辦）→ 小美修好 → Approve → Squash', () => {
    const g = start(8);
    g.visit('pr-preview');
    g.visit('pr-files');
    g.ghReview(PR(g).number, 'changes_requested', '有三件事要處理', [TODO(g, 'codex'), TODO(g, 'test'), TODO(g, 'style')]);
    expect(notDone(g)).toEqual(['merged']);
    expect(PR(g).comments.some((c) => c.by === 'mei')).toBe(true);
    g.ghReview(PR(g).number, 'approved', 'LGTM', []);
    expect(g.ghMerge(PR(g).number, 'squash')).toBeNull();
    expectDone(g);
  });

  it('只勾兩個待辦：小美只修那兩個，第三個仍在，要再審一次', () => {
    const g = start(8);
    g.ghReview(PR(g).number, 'changes_requested', '請修改', [TODO(g, 'codex'), TODO(g, 'test')]);
    expect(notDone(g)).toContain('request');
    expect(g.w.objects[g.origin.branches['feat/font-size']].tree['style.css']).toContain('reformatted');
    g.ghReview(PR(g).number, 'changes_requested', '還有 style', [TODO(g, 'codex'), TODO(g, 'test'), TODO(g, 'style')]);
    g.ghReview(PR(g).number, 'approved', 'OK', []);
    g.ghMerge(PR(g).number, 'squash');
    expectDone(g);
  });

  it('危險路線：看到綠燈就 Approve 並合併 → 有問題的東西進了 staging → 時光倒流', () => {
    const g = start(8);
    g.ghReview(PR(g).number, 'approved', 'LGTM', []);
    expect(g.state.traps).toContain('approved-with-problems');
    g.ghMerge(PR(g).number, 'squash');
    expect(g.state.traps).toContain('merged-with-problems');
    expect(notDone(g)).toContain('merged');
    const cp = g.checkpoints.find((c) => c.label.includes('審查'))!;
    g.undoTo(cp.id);
    expect(PR(g).state).toBe('open');
  });

  it('用 merge commit 合併：跳出提醒（P6）', () => {
    const g = start(8);
    g.ghReview(PR(g).number, 'changes_requested', '', [TODO(g, 'codex'), TODO(g, 'test'), TODO(g, 'style')]);
    g.ghReview(PR(g).number, 'approved', '', []);
    g.ghMerge(PR(g).number, 'merge');
    expect(g.state.traps).toContain('merge-commit');
    expect(notDone(g)).toContain('merged');
  });
});

import { say } from './helpers';
import { runApp } from '../src/site/runner';
import type { ChatMsg } from '../src/core/types';

const toolBy = (g: Game, re: RegExp) => g.state.chat.find((m): m is Extract<ChatMsg, { t: 'tool' }> => m.t === 'tool' && re.test(m.cmd));

describe('第 9 關（測試站壞了）', () => {
  it('起始狀態：測試站白屏、警報、#12 與 #13 都已合併', () => {
    const g = start(9);
    expect(runApp(g.w.objects[g.origin.branches.staging].tree).ok).toBe(false);
    expect(g.w.github.alerts.length).toBe(1);
    expect(g.prs.filter((p) => p.state === 'merged').length).toBe(2);
    expect(g.flags.culprit).toBe(12);
  });

  it('標準解：好提示（AI 只查不改）→ Revert 按鈕 → 合併反向 PR', () => {
    const g = start(9);
    g.visit('staging-preview');
    expect(say(g, 'l9-a')).toBe('idle');
    expect(toolBy(g, /reset/)).toBeUndefined();
    expect(g.ghRevert(12)).toBeNull();
    const rev = g.prs.find((p) => p.revertOf === 12)!;
    expect(rev).toBeTruthy();
    expect(notDone(g)).toEqual(['merged']);
    expect(g.ghMerge(rev.number, 'squash')).toBeNull();
    expectDone(g);
    expect(runApp(g.w.objects[g.origin.branches.staging].tree).ok).toBe(true);
  });

  it('危險路線：「快一點」→ reset 跳權限視窗 → 允許 → force 被擋、+staging 被 Auto 擋（不是 ask）→ 本機 staging 被退回', () => {
    const g = start(9);
    g.chooseOption('l9-b');
    expect(g.agentRun()).toBe('awaiting');
    expect(toolBy(g, /^git reset --hard/)!.state).toBe('awaiting');
    g.decidePermission('allow');
    expect(g.agentRun()).toBe('idle');
    expect(toolBy(g, /^git push --force/)!.state).toBe('blocked');
    expect(toolBy(g, /\+staging/)!.state).toBe('auto-blocked');
    expect(g.state.traps).toContain('ai-reset-staging');
    expect(g.me.branches.staging).not.toBe(g.origin.branches.staging);
    // 之後仍可走 Revert 過關
    g.ghRevert(12);
    g.ghMerge(g.prs.find((p) => p.revertOf === 12)!.number, 'squash');
    expectDone(g);
  });

  it('在權限視窗按拒絕：什麼都沒發生', () => {
    const g = start(9);
    g.chooseOption('l9-b');
    g.agentRun();
    g.decidePermission('deny');
    g.agentRun();
    expect(g.me.branches.staging).toBe(g.origin.branches.staging);
    expect(g.state.traps).not.toContain('ai-reset-staging');
  });

  it('玩家自己 force push：觸發陷阱', () => {
    const g = start(9);
    g.runTerminal('git reset --hard HEAD~2');
    g.runTerminal('git push --force origin staging');
    expect(g.state.traps).toContain('force-staging');
  });
});

import { createPR, mergeInfo, mergePR } from '../src/github/github';
import { botPush } from '../src/github/bots';
import { newPR } from '../src/levels/common';

describe('第 10 關（上線）', () => {
  const open = (g: Game) => g.ghCreatePR({ title: '上線：staging → master', body: '', head: 'staging', base: 'master', draft: false }).pr!;

  it('起始狀態：master 落後 staging 三個功能', () => {
    const g = start(10);
    expect(g.def.role).toBe('lead');
    expect(g.origin.branches.master).not.toBe(g.origin.branches.staging);
    expect((g.w.objects[g.origin.branches.master].tree['app.js'] ?? '')).not.toContain('toggleTheme');
  });

  it('標準解：開 PR（staging → master）→ Create a merge commit', () => {
    const g = start(10);
    g.visit('staging-preview');
    g.visit('production-preview');
    const pr = open(g);
    expect(g.ghMerge(pr.number, 'merge')).toBeNull();
    expectDone(g);
    expect(g.state.traps).toEqual([]);
  });

  it('危險路線：Squash 上線 → 兩條分支分岔 → 下一次上線 PR 衝突 → 時光倒流後改用 merge commit', () => {
    const g = start(10);
    const pr = open(g);
    g.ghMerge(pr.number, 'squash');
    expect(g.state.traps).toContain('squash-release');
    const next = g.prs.find((p) => p.number !== pr.number && p.head === 'staging' && p.base === 'master')!;
    expect(next).toBeTruthy();
    expect(mergeInfo(g.w, next).conflicts).toEqual(['app.js']);
    expect(notDone(g)).toContain('merged');
    const cp = g.checkpoints.find((c) => c.label.includes('Squash'))!;
    g.undoTo(cp.id);
    expect(g.prs.find((p) => p.head === 'staging')!.state).toBe('open');
    g.ghMerge(pr.number, 'merge');
    expectDone(g);
  });

  it('對照：merge commit 上線後，同一行再被改一次，下次上線 PR 沒有衝突', () => {
    const g = start(10);
    const pr = open(g);
    g.ghMerge(pr.number, 'merge');
    botPush(g.w, 'mei', 'feat/chapter-title-2', (t) => ({ ...t, 'app.js': t['app.js'].replace("title: '第 1 章　心血管系統'", "title: '第 1 章　心臟與血管系統'") }), '第 1 章標題再調整');
    mergePR(g.w, newPR(g.w, { title: '第 1 章標題再調整', head: 'feat/chapter-title-2', author: 'mei' }), 'squash', 'boss');
    const next = createPR(g.w, { title: '下次上線', body: '', head: 'staging', base: 'master', draft: false, author: 'boss' }).pr!;
    expect(mergeInfo(g.w, next).conflicts).toEqual([]);
    expect(mergeInfo(g.w, next).mergeable).toBe(true);
  });
});
