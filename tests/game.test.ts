import { describe, expect, it } from 'vitest';
import { Game } from '../src/core/game';
import { LEVELS } from '../src/levels';
import { start } from './helpers';

describe('所有關卡的共通性質', () => {
  for (const def of LEVELS) {
    it(`第 ${def.id} 關「${def.title}」：可建立、可序列化、物件池完整、判定不丟例外`, () => {
      const g = start(def.id);
      // 狀態是純 JSON：可以存、可以還原
      const json = JSON.stringify(g.state);
      const g2 = Game.restore(JSON.parse(json));
      expect(g2.objectives().map((o) => o.isDone)).toEqual(g.objectives().map((o) => o.isDone));
      // 每個 ref 指到的 commit 都存在
      const w = g.w;
      for (const r of Object.values(w.repos)) {
        for (const id of Object.values(r.branches)) expect(w.objects[id]).toBeTruthy();
        for (const id of Object.values(r.remotes)) expect(w.objects[id]).toBeTruthy();
      }
      // 每個目標都有三層提示（free 除外）
      if (!def.free) {
        for (const o of def.objectives) {
          expect(def.hints[o.id], `${def.id}/${o.id} 缺提示`).toBeTruthy();
          expect(def.hints[o.id]).toHaveLength(3);
        }
        expect(def.success.summary.length).toBeGreaterThan(0);
        expect(g.state.done).toBe(false);
      }
      expect(def.story.length).toBeGreaterThan(0);
    });
  }

  it('自由模式不會過關，小美的按鈕與 AI 選項都能用', () => {
    const g = start(11);
    for (const e of g.def.edits!) {
      if (!e.available || e.available(g)) g.applyEdit(e.id);
    }
    g.chooseOption('f-look');
    g.agentRun();
    g.chooseOption('f-sync');
    g.agentRun();
    expect(g.state.done).toBe(false);
    expect(g.prs.length).toBeGreaterThan(0);
  });

  it('時光倒流最多保留 10 個檢查點', () => {
    const g = start(1);
    for (let i = 0; i < 15; i++) g.pushCheckpoint('x' + i);
    expect(g.checkpoints.length).toBe(10);
  });
  it('終端機裡會改動狀態的指令會建立檢查點，唯讀指令不會，倒流後狀態與輸入前完全一致', () => {
    const g = start(1);
    g.runTerminal('git status');
    g.runTerminal('git log --oneline');
    expect(g.checkpoints.length).toBe(0);
    const before = JSON.stringify(g.w);
    g.runTerminal('git switch -c feat/rewind-test');
    expect(g.checkpoints.length).toBe(1);
    expect(g.branch).toBe('feat/rewind-test');
    g.runTerminal('git switch -c feat/other');
    expect(g.checkpoints.length).toBe(2);
    // 失敗的指令（沒有改動世界）不留檢查點
    g.runTerminal('git switch no-such-branch');
    expect(g.checkpoints.length).toBe(2);
    expect(g.undoTo(g.checkpoints[0].id)).toBe(true);
    expect(JSON.stringify(g.w)).toBe(before);
    expect(g.checkpoints.length).toBe(0);
    expect(g.state.term.some((l) => l.text.includes('feat/rewind-test'))).toBe(false);
  });

  it('檢查點經過存檔（物件池剝除、讀回還原）後仍能倒流', () => {
    const g = start(1);
    g.runTerminal('git switch -c feat/persist');
    const json = JSON.parse(JSON.stringify({ state: g.state, cps: g.checkpoints }));
    const g2 = Game.restore(json.state, json.cps);
    expect(g2.undoTo(g2.checkpoints[0].id)).toBe(true);
    expect(g2.branch).not.toBe('feat/persist');
  });
});

describe('任務卡的階段分組', () => {
  for (const def of LEVELS.filter((l) => l.stages)) {
    it(`第 ${def.id} 關：階段引用的目標都存在，每個目標恰好屬於一個階段，順序一致`, () => {
      const ids = def.objectives.map((o) => o.id);
      const staged = def.stages!.flatMap((st) => st.objectives);
      for (const id of staged) expect(ids, `階段引用了不存在的目標 ${id}`).toContain(id);
      expect([...staged].sort()).toEqual([...ids].sort());
      expect(staged).toEqual(ids);
      for (const st of def.stages!) {
        expect(st.title.length).toBeGreaterThan(0);
        expect(st.why.length).toBeGreaterThan(0);
      }
    });
  }

  it('第 1 關是 A–D 四個階段', () => {
    const def = LEVELS.find((l) => l.id === 1)!;
    expect(def.stages!.map((s) => s.objectives)).toEqual([['branch'], ['edit', 'commit'], ['push', 'pr', 'ready'], ['merged', 'cleanup']]);
  });
});

describe('提示文字', () => {
  it('沒有任何提示提到不存在的「貼到終端機」按鈕', () => {
    for (const def of LEVELS) for (const hs of Object.values(def.hints)) for (const h of hs) expect(h).not.toContain('貼到終端機');
  });
});
