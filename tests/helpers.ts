import { expect } from 'vitest';
import { Game } from '../src/core/game';
import { findOverlaps } from '../src/ui/graph/layout';
import { buildModel, layoutModel, type GraphView } from '../src/ui/graph/model';

/** 三種視角的分支圖都不能有「線穿過無關節點」 */
export function checkGraphs(g: Game) {
  for (const view of ['me', 'github', 'mei'] as GraphView[]) {
    const bad = findOverlaps(layoutModel(buildModel(g.w, view)).lay);
    if (bad.length) throw new Error(`第 ${g.state.levelId} 關 ${view} 視角分支圖重疊：${bad.join('；')}`);
  }
}

/** 建立關卡；之後每一次狀態改變（emit）都會檢查分支圖，所以所有關卡測試的每個中間狀態都被涵蓋 */
export function start(id: number): Game {
  const g = Game.create(id);
  g.onChange = checkGraphs;
  checkGraphs(g);
  return g;
}

/** 依序在玩家的終端機輸入指令 */
export function T(g: Game, ...cmds: string[]) {
  for (const c of cmds) g.runTerminal(c);
}

/** 最後一個指令的輸出（含說明）文字 */
export function lastOut(g: Game): string {
  const t = g.state.term;
  let i = t.length - 1;
  const parts: string[] = [];
  while (i >= 0 && t[i].kind !== 'cmd') parts.unshift(t[i--].text);
  return parts.join('\n');
}

/** 檢查：每個指令的結果碼（在 hist 的最後一筆） */
export function lastCode(g: Game): number {
  return g.state.hist[g.state.hist.length - 1].code;
}

export function notDone(g: Game): string[] {
  return g.objectives().filter((o) => !o.isDone).map((o) => o.id);
}

export function expectDone(g: Game) {
  expect(notDone(g)).toEqual([]);
  expect(g.state.done).toBe(true);
}

/** 對 AI 說某個選項，並讓腳本一路跑完（遇到權限視窗就停下） */
export function say(g: Game, optionId: string, stop: 'idle' | 'awaiting' | 'armed' | undefined = undefined) {
  expect(g.chooseOption(optionId)).toBe(true);
  return g.agentRun({ stopAtArmed: stop === 'armed' });
}

export function tipOf(g: Game, where: 'me' | 'origin', branch: string): string | undefined {
  return (where === 'me' ? g.me.branches : g.origin.branches)[branch];
}

export function fileOf(g: Game, where: 'me' | 'origin', branch: string, path: string): string | undefined {
  const id = tipOf(g, where, branch);
  return id ? g.w.objects[id].tree[path] : undefined;
}
