import { ACTORS, commitsFrom, fmtDate, headId } from './repo';
import { short } from './hash';
import type { Repo, World } from './types';

/** commit id → 指向它的 ref 名稱（含 HEAD ->） */
export function decorations(w: World, r: Repo): Record<string, string[]> {
  const map: Record<string, string[]> = {};
  const add = (id: string, name: string) => (map[id] ??= []).push(name);
  const head = headId(r);
  const cur = r.head.kind === 'branch' ? r.head.name : null;
  if (head) {
    if (cur) add(head, `HEAD -> ${cur}`);
    else add(head, 'HEAD');
  }
  for (const b of Object.keys(r.branches).sort()) if (b !== cur) add(r.branches[b], b);
  for (const b of Object.keys(r.remotes).sort()) add(r.remotes[b], b);
  return map;
}

export function decoStr(map: Record<string, string[]>, id: string): string {
  const d = map[id];
  return d && d.length ? ` (${d.join(', ')})` : '';
}

export function firstLine(msg: string) {
  return msg.split('\n')[0];
}

export interface LogOpts {
  oneline: boolean;
  graph: boolean;
  all: boolean;
  limit: number | null;
}

/** 回傳要列出的 commit（由新到舊），支援 A..B */
export function selectCommits(w: World, r: Repo, tips: string[], exclude: string[], all: boolean): string[] {
  let t = tips;
  if (all) t = [...Object.values(r.branches), ...Object.values(r.remotes), ...(headId(r) ? [headId(r)!] : [])];
  let ids = commitsFrom(w, t);
  if (exclude.length) {
    const ex = new Set(commitsFrom(w, exclude));
    ids = ids.filter((i) => !ex.has(i));
  }
  return ids;
}

export function formatLog(w: World, r: Repo, ids: string[], o: LogOpts): string {
  if (o.limit !== null) ids = ids.slice(0, o.limit);
  const deco = decorations(w, r);
  if (!o.graph) {
    if (o.oneline) return ids.map((id) => `${short(id)}${decoStr(deco, id)} ${firstLine(w.objects[id].message)}`).join('\n');
    return ids
      .map((id) => {
        const c = w.objects[id];
        const a = ACTORS[c.author];
        const merge = c.parents.length > 1 ? `\nMerge: ${c.parents.map(short).join(' ')}` : '';
        const body = c.message
          .split('\n')
          .map((l) => (l ? `    ${l}` : ''))
          .join('\n');
        return `commit ${id}${decoStr(deco, id)}${merge}\nAuthor: ${a.name} <${a.email}>\nDate:   ${fmtDate(c.time)}\n\n${body}\n`;
      })
      .join('\n');
  }
  return asciiGraph(w, ids, deco);
}

/** 近似 git log --graph 的 ASCII 圖 */
export function asciiGraph(w: World, ids: string[], deco: Record<string, string[]>): string {
  const inSet = new Set(ids);
  const cols: (string | null)[] = [];
  const out: string[] = [];
  const render = (mark: number | null) =>
    cols
      .map((c, i) => (i === mark ? '*' : c !== null ? '|' : ' '))
      .join(' ')
      .replace(/\s+$/, '');
  const collapseLine = (j: number) =>
    cols
      .slice(0, j)
      .map((x) => (x !== null ? '|' : ' '))
      .join(' ') + '/';
  for (const id of ids) {
    const c = w.objects[id];
    let idxs = cols.map((x, i) => (x === id ? i : -1)).filter((i) => i >= 0);
    if (!idxs.length) {
      let free = cols.indexOf(null);
      if (free < 0) {
        cols.push(null);
        free = cols.length - 1;
      }
      cols[free] = id;
      idxs = [free];
    }
    const idx = idxs[0];
    out.push(render(idx) + ' ' + short(id) + decoStr(deco, id) + ' ' + firstLine(c.message));
    for (const j of idxs.slice(1)) {
      cols[j] = null;
      out.push(collapseLine(j));
    }
    const parents = c.parents.filter((p) => inSet.has(p));
    if (parents.length === 0) cols[idx] = null;
    else {
      const p0 = parents[0];
      const existing = cols.indexOf(p0);
      if (existing >= 0 && existing !== idx) {
        cols[idx] = null;
        if (existing < idx) out.push(collapseLine(idx));
      } else cols[idx] = p0;
      for (const p of parents.slice(1)) {
        if (cols.includes(p)) continue;
        cols.splice(idx + 1, 0, p);
        out.push(
          cols
            .slice(0, idx + 1)
            .map((x) => (x !== null ? '|' : ' '))
            .join(' ') + '\\',
        );
      }
    }
    while (cols.length && cols[cols.length - 1] === null) cols.pop();
  }
  return out.map((l) => l.replace(/\s+$/, '')).join('\n');
}
