import { describe, expect, it } from 'vitest';
import { LEVELS } from '../src/levels';
import { findOverlaps, layoutGraph, NODE_R, RING, type LCommit, type LRef } from '../src/ui/graph/layout';
import { buildModel, chipWidth, layoutModel, planChips, type GraphView, type RefLabel } from '../src/ui/graph/model';
import { checkGraphs, start } from './helpers';

// 可重現的亂數
function rng(seed: number) {
  let s = seed >>> 0;
  return () => {
    s = (s * 1664525 + 1013904223) >>> 0;
    return s / 4294967296;
  };
}

describe('分支圖欄位配置：線不穿過無關的節點', () => {
  it('隨機的歷史（含 merge、多條分支、squash 虛線）也不會重疊', () => {
    for (let seed = 1; seed <= 300; seed++) {
      const r = rng(seed);
      const n = 6 + Math.floor(r() * 30);
      const commits: Record<string, LCommit> = {};
      const ids: string[] = [];
      for (let i = 0; i < n; i++) {
        const id = `c${i}`;
        const parents: string[] = [];
        if (i > 0) {
          // 多半接在最近的 commit 後面，偶爾從很早的地方分岔，偶爾 merge
          const p1 = r() < 0.7 ? ids[i - 1] : ids[Math.floor(r() * i)];
          parents.push(p1);
          if (i > 2 && r() < 0.25) {
            const p2 = ids[Math.floor(r() * i)];
            if (p2 !== p1) parents.push(p2);
          }
        }
        const c: LCommit = { parents, time: i + 1 };
        if (i > 3 && r() < 0.15) c.squashOf = [ids[Math.floor(r() * i)]];
        commits[id] = c;
        ids.push(id);
      }
      // 隨機選幾個 commit 當分支尖端
      const refs: LRef[] = [{ name: 'master', kind: 'local', id: ids[Math.floor(r() * n)] }];
      refs.push({ name: 'staging', kind: 'local' as const, id: ids[Math.floor(r() * n)] });
      const extra = 1 + Math.floor(r() * 5);
      for (let k = 0; k < extra; k++) refs.push({ name: `feat/${k}`, kind: r() < 0.3 ? ('remote' as const) : ('local' as const), id: ids[Math.floor(r() * n)] });
      const maxRows = r() < 0.3 ? 8 : 40;
      // 隨機讓某些列的標籤獨立成 0–3 行（列高不一）
      const rowLines: Record<string, number> = {};
      for (const id of ids) if (r() < 0.4) rowLines[id] = 1 + Math.floor(r() * 3);
      const lay = layoutGraph({ commits, refs, maxRows, rowLines });
      const bad = findOverlaps(lay);
      // 列高不一也不能讓兩列互相重疊
      const byRow = [...lay.nodes].sort((a, b) => a.row - b.row);
      for (let i = 1; i < byRow.length; i++) expect(byRow[i].y - byRow[i - 1].y, `seed ${seed} 列距`).toBeGreaterThanOrEqual((byRow[i].h + byRow[i - 1].h) / 2 - 1e-6);
      expect(bad, `seed ${seed}`).toEqual([]);
      // 每個 parent 邊的兩端都在畫面上（除非被截掉）
      const shown = new Set(lay.rows);
      for (const e of lay.edges.filter((x) => x.kind === 'parent')) {
        expect(shown.has(e.from)).toBe(true);
      }
      // 每列只有一個節點、x 座標不重複於同一列
      expect(new Set(lay.nodes.map((nd) => nd.y)).size).toBe(lay.nodes.length);
    }
  });

  it('最簡單的情況：單線、分岔再 merge', () => {
    const commits: Record<string, LCommit> = {
      a: { parents: [], time: 1 },
      b: { parents: ['a'], time: 2 },
      c: { parents: ['b'], time: 3 },
      f1: { parents: ['b'], time: 4 },
      m: { parents: ['c', 'f1'], time: 5 },
    };
    const lay = layoutGraph({ commits, refs: [{ name: 'master', kind: 'local', id: 'm' }] });
    expect(lay.rows).toEqual(['m', 'f1', 'c', 'b', 'a']);
    expect(findOverlaps(lay)).toEqual([]);
    expect(lay.lanes).toBe(2);
  });

  it('保證的最小間隙大於節點半徑加外圈', () => {
    expect(NODE_R + RING).toBeGreaterThan(0);
    // 故意造一個會穿過的圖來確認檢查器真的會抓到問題
    const commits: Record<string, LCommit> = {
      a: { parents: [], time: 1 },
      b: { parents: ['a'], time: 2 },
      c: { parents: ['b'], time: 3 },
    };
    const lay = layoutGraph({ commits, refs: [{ name: 'master', kind: 'local', id: 'c' }] });
    expect(findOverlaps(lay)).toEqual([]);
    const forged = { ...lay, edges: [{ ...lay.edges[0], ends: ['zzz'] }] };
    expect(findOverlaps(forged).length).toBeGreaterThan(0);
  });
});

describe('每一關的起始畫面（三種視角）都不重疊', () => {
  for (const def of LEVELS) {
    it(`第 ${def.id} 關「${def.title}」`, () => {
      const g = start(def.id);
      for (const view of ['me', 'github', 'mei'] as GraphView[]) {
        const m = buildModel(g.w, view);
        const { lay } = layoutModel(m);
        expect(findOverlaps(lay), `${def.id}/${view}`).toEqual([]);
      }
      checkGraphs(g);
    });
  }
});

describe('分支標籤：同步合併成一顆、永遠不截斷', () => {
  it('本機分支與同名 origin/ 在同一個 commit：只剩一顆標籤，標成已同步', () => {
    const g = start(1);
    for (const view of ['me', 'mei'] as GraphView[]) {
      const m = buildModel(g.w, view);
      for (const ls of Object.values(m.labels)) {
        for (const l of ls) {
          if (l.kind === 'local' && l.synced) expect(ls.some((x) => x.name === 'origin/' + l.name)).toBe(false);
          if (l.kind === 'remote') expect(ls.some((x) => x.kind === 'local' && 'origin/' + x.name === l.name)).toBe(false);
        }
      }
    }
    const m = buildModel(g.w, 'me');
    const all = Object.values(m.labels).flat();
    expect(all.some((l) => l.name === 'staging' && l.synced)).toBe(true);
    expect(all.some((l) => l.name === 'origin/staging')).toBe(false);
  });

  it('標籤放不下時獨立成行（列變高），放得下就和訊息同一行', () => {
    const mk = (names: string[]): RefLabel[] => names.map((name) => ({ name, kind: 'local' as const, current: false, synced: true }));
    const long = mk(['feat/chapter-title', 'feat/highlight-keywords', 'fix/readme-license']);
    const model = { input: { commits: {}, refs: [] }, labels: { x: long, y: mk(['staging']) }, head: null, detached: false, onGithub: new Set<string>() };
    const plan = planChips(model, 300);
    expect(plan.lines.x).toBeGreaterThanOrEqual(1);
    expect(plan.lines.y).toBeUndefined();
    expect(chipWidth(long[0])).toBeGreaterThan(long[0].name.length * 6);
  });
});
