import { describe, expect, it } from 'vitest';
import type { ChatMsg } from '../src/core/types';
import { expectDone, fileOf, notDone, say, start, T } from './helpers';
import type { Game } from '../src/core/game';

const tools = (g: Game) => g.state.chat.filter((m): m is Extract<ChatMsg, { t: 'tool' }> => m.t === 'tool');
const toolBy = (g: Game, re: RegExp) => tools(g).find((m) => re.test(m.cmd));

describe('第 5 關', () => {
  it('標準解（選 A）：add . 被擋 → 測試失敗 → AI 修程式 → Draft PR → gh pr merge 被擋 → 人轉 Ready → 部長合併', () => {
    const g = start(5);
    expect(say(g, 'l5-a')).toBe('idle');
    expect(toolBy(g, /^git add \.$/)!.state).toBe('blocked');
    expect(toolBy(g, /--no-verify/)).toBeUndefined();
    expect(toolBy(g, /^gh pr merge/)!.state).toBe('blocked');
    const pr = g.prs.find((p) => p.head === 'feat/bookmark')!;
    expect(pr.draft).toBe(true);
    expect(notDone(g)).toEqual(['ready', 'merged']);
    g.ghReady(pr.number);
    expectDone(g);
    expect(fileOf(g, 'origin', 'staging', 'app.js')).toContain('toggleBookmark');
  });

  it('危險路線 B：沒講界線 → --no-verify 被擋 → AI 刪測試（沒人擋）→ 後果＋時光倒流', () => {
    const g = start(5);
    g.chooseOption('l5-b');
    expect(g.agentRun({ stopAtArmed: true })).toBe('armed');
    expect(toolBy(g, /--no-verify/)!.state).toBe('blocked');
    g.agentRun();
    expect(g.state.traps).toContain('ai-deleted-test');
    const pr = g.prs.find((p) => p.head === 'feat/bookmark')!;
    expect(notDone(g)).toContain('tests');
    g.ghReady(pr.number);
    expect(notDone(g)).toContain('tests'); // 即使合併了，測試仍然不見
    // 時光倒流：回到說話之前
    const cp = g.checkpoints.find((c) => c.label.startsWith('對 AI 說'))!;
    expect(g.undoTo(cp.id)).toBe(true);
    expect(g.state.chat.length).toBe(0);
    expect(g.offer()).toBeTruthy();
  });

  it('B 路線：在 AI 要刪測試時按 Esc → 改叫它修程式 → 通過', () => {
    const g = start(5);
    g.chooseOption('l5-b');
    expect(g.agentRun({ stopAtArmed: true })).toBe('armed');
    expect(g.pressEsc()).toBe(true);
    const off = g.offer()!;
    expect(off.options.map((o) => o.id)).toEqual(['l5-fix', 'l5-whatever']);
    say(g, 'l5-fix');
    expect(g.state.traps).not.toContain('ai-deleted-test');
    const pr = g.prs.find((p) => p.head === 'feat/bookmark')!;
    g.ghReady(pr.number);
    expectDone(g);
  });

  it('危險路線 C：模糊提示 → AI 在 staging 上 git push（沒被擋）→ 警報＋陷阱', () => {
    const g = start(5);
    g.chooseOption('l5-c');
    g.agentRun();
    expect(toolBy(g, /^git push$/)!.state).toBe('done');
    expect(g.w.github.alerts.length).toBe(1);
    expect(g.state.traps).toContain('ai-pushed-staging');
    expect(notDone(g)).toContain('pr');
  });

  it('C 路線：在 git push 前按 Esc → 請 AI 搬到分支（reset 跳權限視窗）→ 通過', () => {
    const g = start(5);
    g.chooseOption('l5-c');
    expect(g.agentRun({ stopAtArmed: true })).toBe('armed');
    expect(g.w.github.alerts.length).toBe(0);
    g.pressEsc();
    expect(g.origin.branches.staging).not.toBe(g.me.branches.staging);
    g.chooseOption('l5-move');
    expect(g.agentRun()).toBe('awaiting');
    expect(toolBy(g, /^git reset --hard/)!.state).toBe('awaiting');
    g.decidePermission('allow');
    expect(g.agentRun()).toBe('idle');
    expect(g.me.branches.staging).toBe(g.origin.branches.staging);
    const pr = g.prs.find((p) => p.head === 'feat/bookmark')!;
    expect(pr).toBeTruthy();
    g.ghReady(pr.number);
    expectDone(g);
  });

  it('玩家自己在終端機打 gh pr merge 觸發 self-merge 提示', () => {
    const g = start(5);
    say(g, 'l5-a');
    T(g, 'gh pr merge --squash');
    expect(g.state.traps).toContain('self-merge');
  });
});

describe('第 6 關', () => {
  const PR = (g: Game) => g.prs.find((p) => p.head === 'feat/highlight')!;

  it('起始狀態：PR 有衝突、GitHub 分支比本機多一個 commit', () => {
    const g = start(6);
    expect(g.branch).toBe('feat/highlight');
    expect(g.me.branches['feat/highlight']).not.toBe(g.origin.branches['feat/highlight']);
    expect(notDone(g)[0]).toBe('merged-in');
  });

  it('標準解（好提示）：AI 在衝突停下 → 我說兩邊保留 → 說 push（被拒絕改 pull）→ Ready → 合併', () => {
    const g = start(6);
    expect(say(g, 'l6-a')).toBe('idle');
    expect(g.me.merge).toBeTruthy();
    expect(toolBy(g, /^git checkout --ours/)).toBeUndefined();
    expect(g.offer()!.options.map((o) => o.id)).toEqual(['l6-both', 'l6-either']);
    say(g, 'l6-both');
    expect(g.me.merge).toBeFalsy();
    expect(g.offer()!.options.map((o) => o.id)).toEqual(['l6-push-good', 'l6-push-vague']);
    say(g, 'l6-push-good');
    expect(toolBy(g, /^git push$/)!.state).toBe('done');
    expect(g.origin.branches['feat/highlight']).toBe(g.me.branches['feat/highlight']);
    expect(notDone(g)).toEqual(['ready', 'merged']);
    g.ghReady(PR(g).number);
    expectDone(g);
  });

  it('危險路線 B：模糊提示 → AI 整個採用我方檔案 → force 被擋 → +refspec 被擋 → pull → 小美功能從測試站消失', () => {
    const g = start(6);
    g.chooseOption('l6-b');
    expect(g.agentRun({ stopAtArmed: true })).toBe('armed');
    expect(toolBy(g, /^git checkout --ours/)!.state).toBe('pending');
    expect(g.agentRun()).toBe('idle');
    expect(toolBy(g, /^git push --force$/)!.state).toBe('blocked');
    expect(toolBy(g, /\+feat\/highlight/)!.state).toBe('auto-blocked');
    expect(g.state.traps).toContain('mei-feature-lost-local');
    expect(g.origin.branches['feat/highlight']).toBe(g.me.branches['feat/highlight']);
    g.ghReady(PR(g).number);
    expect(PR(g).state).toBe('merged');
    expect(g.state.traps).toContain('mei-feature-lost-staging');
    expect(notDone(g)).toContain('both');
    // 時光倒流
    const cp = g.checkpoints.find((c) => c.label.startsWith('對 AI 說'))!;
    g.undoTo(cp.id);
    expect(g.offer()).toBeTruthy();
  });

  it('危險路線 B 的 Esc：看到 --ours 就按 Esc 打斷', () => {
    const g = start(6);
    g.chooseOption('l6-b');
    g.agentRun({ stopAtArmed: true });
    g.pressEsc();
    expect(g.me.merge).toBeTruthy();
    expect(g.offer()!.options.map((o) => o.id)).toEqual(['l6-both', 'l6-either']); // 衝突狀態中，可繼續指示 AI，或自己動手
  });

  it('危險路線：push 被擋 → 「想辦法」→ force 擋、+ 擋、reset --hard 跳權限視窗 → 允許會弄丟 merge commit', () => {
    const g = start(6);
    say(g, 'l6-a');
    say(g, 'l6-both');
    const mergeCommit = g.me.branches['feat/highlight'];
    g.chooseOption('l6-push-vague');
    expect(g.agentRun()).toBe('awaiting');
    expect(toolBy(g, /^git push --force$/)!.state).toBe('blocked');
    expect(toolBy(g, /\+feat/)!.state).toBe('auto-blocked');
    expect(toolBy(g, /^git reset --hard/)!.state).toBe('awaiting');
    g.decidePermission('allow');
    g.agentRun();
    expect(g.me.branches['feat/highlight']).not.toBe(mergeCommit);
    expect(g.state.traps).toContain('ai-reset-lost');
    expect(mergeInfoConflicts(g)).toBeGreaterThan(0); // PR 還是有衝突
  });

  it('同一條路，在權限視窗按拒絕 → AI 改用 pull → 成功', () => {
    const g = start(6);
    say(g, 'l6-a');
    say(g, 'l6-both');
    g.chooseOption('l6-push-vague');
    expect(g.agentRun()).toBe('awaiting');
    g.decidePermission('deny');
    expect(g.agentRun()).toBe('idle');
    expect(g.origin.branches['feat/highlight']).toBe(g.me.branches['feat/highlight']);
    g.ghReady(PR(g).number);
    expectDone(g);
  });

  it('不靠 AI：自己 fetch、merge、在編輯器解、commit、pull、push 也能過關', () => {
    const g = start(6);
    T(g, 'git fetch', 'git merge origin/staging');
    g.saveFile('app.js', g.me.work['app.js'].replace(/<<<<<<< HEAD\n[\s\S]*?>>>>>>> [^\n]*\n/, "  p.textContent = highlight(ch.body) + '（' + wordCount(ch.body) + ' 字）';\n"));
    T(g, 'git add app.js', 'git commit -m "合併 staging"', 'git push', 'git pull', 'git push');
    g.ghReady(PR(g).number);
    expectDone(g);
  });
});

import { mergeInfo } from '../src/github/github';
function mergeInfoConflicts(g: Game) {
  return mergeInfo(g.w, g.prs.find((p) => p.head === 'feat/highlight')!).conflicts.length;
}

describe('第 7 關', () => {
  const PR = (g: Game) => g.prs.find((p) => p.head === 'feat/recent')!;
  const green = (g: Game) => checksGreen(g.w, PR(g));

  it('起始狀態：CI 綠、可合併，但落後 staging', () => {
    const g = start(7);
    expect(green(g)).toBe(true);
    expect(mergeInfo(g.w, PR(g)).mergeable).toBe(true);
    expect(mergeInfo(g.w, PR(g)).upToDate).toBe(false);
    expect(notDone(g)).toEqual(['update', 'fixed', 'ready', 'merged']);
  });

  it('標準解：Update branch → CI 紅 → 好提示（pull、修、push）→ 綠 → Ready → 部長合併', () => {
    const g = start(7);
    expect(g.offer()!.options.map((o) => o.id)).toEqual(['l7-c']);
    say(g, 'l7-c');
    expect(g.ghUpdateBranch(PR(g).number)).toBeNull();
    expect(green(g)).toBe(false);
    expect(notDone(g)).toEqual(['fixed', 'ready', 'merged']);
    expect(g.offer()!.options.map((o) => o.id)).toEqual(['l7-a', 'l7-b']);
    say(g, 'l7-a');
    expect(green(g)).toBe(true);
    g.ghReady(PR(g).number);
    expectDone(g);
  });

  it('危險路線：綠燈就直接轉 Ready → 部長合併 → 測試站白屏 → 時光倒流', () => {
    const g = start(7);
    g.ghReady(PR(g).number);
    expect(PR(g).state).toBe('merged');
    expect(g.state.traps).toContain('white-staging');
    expect(runApp(g.w.objects[g.origin.branches.staging].tree).ok).toBe(false);
    const cp = g.checkpoints.find((c) => c.label.includes('Ready'))!;
    g.undoTo(cp.id);
    expect(PR(g).state).toBe('open');
    expect(runApp(g.w.objects[g.origin.branches.staging].tree).ok).toBe(true);
  });

  it('CI 紅燈時轉 Ready：部長退回', () => {
    const g = start(7);
    g.ghUpdateBranch(PR(g).number);
    g.ghReady(PR(g).number);
    expect(PR(g).state).toBe('open');
    expect(PR(g).reviews.some((r) => r.state === 'changes_requested')).toBe(true);
    expect(g.state.traps).toContain('ready-red');
  });

  it('模糊提示：繞遠路（空 commit → 被拒絕 → force 擋 → + 擋 → pull → 修好）也能成功', () => {
    const g = start(7);
    g.ghUpdateBranch(PR(g).number);
    say(g, 'l7-b');
    expect(toolBy(g, /^git push --force$/)!.state).toBe('blocked');
    expect(toolBy(g, /\+feat\/recent/)!.state).toBe('auto-blocked');
    expect(green(g)).toBe(true);
    g.ghReady(PR(g).number);
    expectDone(g);
  });

  it('不靠 AI：自己 merge origin/staging、修、push', () => {
    const g = start(7);
    T(g, 'git fetch', 'git merge origin/staging');
    T(g, 'npm test');
    expect(g.state.hist[g.state.hist.length - 1].code).not.toBe(0);
    g.me.work['app.js'] = g.me.work['app.js'].split('return formatTitle(CHAPTERS').join('return formatChapterTitle(CHAPTERS');
    g.me.work['tests/app.test.js'] = g.me.work['tests/app.test.js'].split('toContain(formatTitle(').join('toContain(formatChapterTitle(');
    T(g, 'git add app.js tests/app.test.js', 'git commit -m fix', 'git push');
    g.ghReady(PR(g).number);
    expectDone(g);
  });
});

import { checksGreen } from '../src/github/github';
import { runApp } from '../src/site/runner';
