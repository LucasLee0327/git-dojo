// 行級 diff 與 diff3 三方合併

export const splitLines = (s: string): string[] => s.split('\n');
export const joinLines = (l: string[]): string => l.join('\n');

/** LCS 配對：回傳 [i, j] 陣列（遞增） */
export function lcsPairs(a: string[], b: string[]): [number, number][] {
  const n = a.length;
  const m = b.length;
  // 去掉共同的頭尾加速
  let pre = 0;
  while (pre < n && pre < m && a[pre] === b[pre]) pre++;
  let suf = 0;
  while (suf < n - pre && suf < m - pre && a[n - 1 - suf] === b[m - 1 - suf]) suf++;
  const pairs: [number, number][] = [];
  for (let i = 0; i < pre; i++) pairs.push([i, i]);
  const an = n - pre - suf;
  const bm = m - pre - suf;
  if (an > 0 && bm > 0) {
    const w = bm + 1;
    const dp = new Uint16Array((an + 1) * w);
    for (let i = an - 1; i >= 0; i--) {
      for (let j = bm - 1; j >= 0; j--) {
        dp[i * w + j] =
          a[pre + i] === b[pre + j]
            ? dp[(i + 1) * w + j + 1] + 1
            : Math.max(dp[(i + 1) * w + j], dp[i * w + j + 1]);
      }
    }
    let i = 0;
    let j = 0;
    while (i < an && j < bm) {
      if (a[pre + i] === b[pre + j]) {
        pairs.push([pre + i, pre + j]);
        i++;
        j++;
      } else if (dp[(i + 1) * w + j] >= dp[i * w + j + 1]) i++;
      else j++;
    }
  }
  for (let k = suf; k > 0; k--) pairs.push([n - k, m - k]);
  return pairs;
}

export interface DiffOp {
  t: ' ' | '+' | '-';
  s: string;
  a?: number; // 舊行號（0 起算）
  b?: number; // 新行號
}

export function diffOps(a: string[], b: string[]): DiffOp[] {
  const pairs = lcsPairs(a, b);
  const ops: DiffOp[] = [];
  let i = 0;
  let j = 0;
  for (const [pi, pj] of pairs) {
    while (i < pi) ops.push({ t: '-', s: a[i], a: i++ });
    while (j < pj) ops.push({ t: '+', s: b[j], b: j++ });
    ops.push({ t: ' ', s: a[i], a: i, b: j });
    i++;
    j++;
  }
  while (i < a.length) ops.push({ t: '-', s: a[i], a: i++ });
  while (j < b.length) ops.push({ t: '+', s: b[j], b: j++ });
  return ops;
}

interface Hunk {
  oStart: number;
  oEnd: number;
  nStart: number;
  nEnd: number;
}

function hunksOf(o: string[], x: string[]): Hunk[] {
  const pairs = lcsPairs(o, x);
  const hunks: Hunk[] = [];
  let pi = -1;
  let pj = -1;
  const all: [number, number][] = [...pairs, [o.length, x.length]];
  for (const [i, j] of all) {
    if (i - pi > 1 || j - pj > 1) {
      hunks.push({ oStart: pi + 1, oEnd: i, nStart: pj + 1, nEnd: j });
    }
    pi = i;
    pj = j;
  }
  return hunks;
}

export interface MergeResult {
  text: string;
  conflicts: number;
}

function applyHunks(o: string[], x: string[], hunks: Hunk[], cs: number, ce: number): string[] {
  const out: string[] = [];
  let pos = cs;
  for (const h of hunks) {
    for (; pos < h.oStart; pos++) out.push(o[pos]);
    for (let k = h.nStart; k < h.nEnd; k++) out.push(x[k]);
    pos = h.oEnd;
  }
  for (; pos < ce; pos++) out.push(o[pos]);
  return out;
}

/** diff3：把 ours / theirs 相對於 base 的修改合併。相鄰或重疊的修改視為衝突（和 git 一致） */
export function merge3(
  baseText: string,
  oursText: string,
  theirsText: string,
  labels: { ours: string; theirs: string },
): MergeResult {
  if (oursText === theirsText) return { text: oursText, conflicts: 0 };
  if (baseText === oursText) return { text: theirsText, conflicts: 0 };
  if (baseText === theirsText) return { text: oursText, conflicts: 0 };
  const o = splitLines(baseText);
  const a = splitLines(oursText);
  const b = splitLines(theirsText);
  const ha = hunksOf(o, a);
  const hb = hunksOf(o, b);
  type Tagged = { side: 'a' | 'b'; h: Hunk };
  const all: Tagged[] = [
    ...ha.map((h) => ({ side: 'a' as const, h })),
    ...hb.map((h) => ({ side: 'b' as const, h })),
  ].sort((p, q) => p.h.oStart - q.h.oStart || p.h.oEnd - q.h.oEnd);

  const out: string[] = [];
  let pos = 0;
  let conflicts = 0;
  let idx = 0;
  while (idx < all.length) {
    const cluster: Tagged[] = [all[idx]];
    let ce = all[idx].h.oEnd;
    const cs = all[idx].h.oStart;
    idx++;
    while (idx < all.length && all[idx].h.oStart <= ce) {
      ce = Math.max(ce, all[idx].h.oEnd);
      cluster.push(all[idx]);
      idx++;
    }
    for (; pos < cs; pos++) out.push(o[pos]);
    const ca = cluster.filter((c) => c.side === 'a').map((c) => c.h);
    const cb = cluster.filter((c) => c.side === 'b').map((c) => c.h);
    if (ca.length && !cb.length) out.push(...applyHunks(o, a, ca, cs, ce));
    else if (cb.length && !ca.length) out.push(...applyHunks(o, b, cb, cs, ce));
    else {
      const ta = applyHunks(o, a, ca, cs, ce);
      const tb = applyHunks(o, b, cb, cs, ce);
      if (ta.join('\n') === tb.join('\n')) out.push(...ta);
      else {
        conflicts++;
        out.push(`<<<<<<< ${labels.ours}`, ...ta, '=======', ...tb, `>>>>>>> ${labels.theirs}`);
      }
    }
    pos = ce;
  }
  for (; pos < o.length; pos++) out.push(o[pos]);
  return { text: joinLines(out), conflicts };
}

export interface ConflictBlock {
  kind: 'text' | 'conflict';
  lines?: string[];
  ours?: string[];
  theirs?: string[];
  oursLabel?: string;
  theirsLabel?: string;
}

/** 解析含衝突記號的檔案 */
export function parseConflicts(text: string): ConflictBlock[] {
  const lines = splitLines(text);
  const blocks: ConflictBlock[] = [];
  let cur: string[] = [];
  let i = 0;
  while (i < lines.length) {
    if (lines[i].startsWith('<<<<<<< ')) {
      let j = i + 1;
      const ours: string[] = [];
      while (j < lines.length && lines[j] !== '=======') ours.push(lines[j++]);
      j++;
      const theirs: string[] = [];
      while (j < lines.length && !lines[j].startsWith('>>>>>>> ')) theirs.push(lines[j++]);
      if (cur.length) blocks.push({ kind: 'text', lines: cur });
      cur = [];
      blocks.push({
        kind: 'conflict',
        ours,
        theirs,
        oursLabel: lines[i].slice(8),
        theirsLabel: (lines[j] || '').slice(8),
      });
      i = j + 1;
    } else cur.push(lines[i++]);
  }
  if (cur.length) blocks.push({ kind: 'text', lines: cur });
  return blocks;
}

export const hasConflictMarkers = (text: string) => /^<<<<<<< /m.test(text) && /^>>>>>>> /m.test(text);

/** 將衝突區塊套用選擇，回傳新文字 */
export function resolveConflictBlock(
  text: string,
  blockIndex: number,
  choice: 'ours' | 'theirs' | 'both',
): string {
  const blocks = parseConflicts(text);
  let ci = -1;
  const rebuilt: string[] = [];
  for (const b of blocks) {
    if (b.kind === 'text') {
      rebuilt.push(...b.lines!);
      continue;
    }
    ci++;
    if (ci === blockIndex) {
      if (choice === 'ours') rebuilt.push(...b.ours!);
      else if (choice === 'theirs') rebuilt.push(...b.theirs!);
      else rebuilt.push(...b.ours!, ...b.theirs!);
    } else {
      rebuilt.push(`<<<<<<< ${b.oursLabel}`, ...b.ours!, '=======', ...b.theirs!, `>>>>>>> ${b.theirsLabel}`);
    }
  }
  return joinLines(rebuilt);
}

/** unified diff（給 git diff 輸出與 Files changed 使用） */
export interface UHunk {
  header: string;
  ops: DiffOp[];
}

export function unifiedHunks(oldText: string, newText: string, ctx = 3): UHunk[] {
  const ops = diffOps(splitLines(oldText), splitLines(newText));
  const keep = new Array(ops.length).fill(false);
  ops.forEach((op, i) => {
    if (op.t !== ' ') for (let k = Math.max(0, i - ctx); k <= Math.min(ops.length - 1, i + ctx); k++) keep[k] = true;
  });
  const hunks: UHunk[] = [];
  let i = 0;
  while (i < ops.length) {
    if (!keep[i]) {
      i++;
      continue;
    }
    let j = i;
    while (j < ops.length && keep[j]) j++;
    const slice = ops.slice(i, j);
    const oldStart = slice.find((o) => o.a !== undefined)?.a ?? 0;
    const newStart = slice.find((o) => o.b !== undefined)?.b ?? 0;
    const oldCount = slice.filter((o) => o.t !== '+').length;
    const newCount = slice.filter((o) => o.t !== '-').length;
    hunks.push({
      header: `@@ -${oldStart + 1},${oldCount} +${newStart + 1},${newCount} @@`,
      ops: slice,
    });
    i = j;
  }
  return hunks;
}

export function countChanges(oldText: string, newText: string): { add: number; del: number } {
  const ops = diffOps(splitLines(oldText), splitLines(newText));
  return { add: ops.filter((o) => o.t === '+').length, del: ops.filter((o) => o.t === '-').length };
}
