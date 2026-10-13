import { merge3 } from './diff';
import { mergeBases, treeOf } from './repo';
import type { Files, World } from './types';

export interface TreeMerge {
  tree: Files;
  conflicts: string[];
  /** 兩邊都改過、自動合併成功的檔案 */
  auto: string[];
  msgs: string[];
  blobs: Record<string, { ours: string | null; theirs: string | null; base: string | null }>;
}

export function mergeTrees(
  base: Files,
  ours: Files,
  theirs: Files,
  labels: { ours: string; theirs: string },
): TreeMerge {
  const tree: Files = {};
  const conflicts: string[] = [];
  const auto: string[] = [];
  const msgs: string[] = [];
  const blobs: TreeMerge['blobs'] = {};
  const paths = new Set([...Object.keys(base), ...Object.keys(ours), ...Object.keys(theirs)]);
  for (const p of [...paths].sort()) {
    const b = base[p];
    const o = ours[p];
    const t = theirs[p];
    if (o === t) {
      if (o !== undefined) tree[p] = o;
      continue;
    }
    if (b === o) {
      if (t !== undefined) tree[p] = t;
      continue;
    }
    if (b === t) {
      if (o !== undefined) tree[p] = o;
      continue;
    }
    // 兩邊都改了
    if (o !== undefined && t !== undefined) {
      msgs.push(`Auto-merging ${p}`);
      const m = merge3(b ?? '', o, t, labels);
      tree[p] = m.text;
      if (m.conflicts > 0) {
        conflicts.push(p);
        msgs.push(b === undefined ? `CONFLICT (add/add): Merge conflict in ${p}` : `CONFLICT (content): Merge conflict in ${p}`);
        blobs[p] = { ours: o, theirs: t, base: b ?? null };
      } else auto.push(p);
    } else if (o === undefined && t !== undefined) {
      tree[p] = t;
      conflicts.push(p);
      msgs.push(`CONFLICT (modify/delete): ${p} deleted in HEAD and modified in ${labels.theirs}.  Version ${labels.theirs} of ${p} left in tree.`);
      blobs[p] = { ours: null, theirs: t, base: b ?? null };
    } else if (t === undefined && o !== undefined) {
      tree[p] = o;
      conflicts.push(p);
      msgs.push(`CONFLICT (modify/delete): ${p} deleted in ${labels.theirs} and modified in HEAD.  Version HEAD of ${p} left in tree.`);
      blobs[p] = { ours: o, theirs: null, base: b ?? null };
    }
  }
  return { tree, conflicts, auto, msgs, blobs };
}

/**
 * 三方合併用的「共同祖先」內容。只有一個最佳共同祖先時就是它；
 * 有多個（交叉合併）時，像 git 一樣先把它們合成一個虛擬的共同祖先。
 */
export function mergeBaseTree(w: World, a: string, b: string): Files {
  const bases = mergeBases(w, a, b);
  if (!bases.length) return {};
  let acc: Files = treeOf(w, bases[0]);
  for (let i = 1; i < bases.length; i++) {
    const inner = mergeBaseTree(w, bases[0], bases[i]);
    acc = mergeTrees(inner, acc, treeOf(w, bases[i]), { ours: 'base1', theirs: 'base2' }).tree;
  }
  return acc;
}
