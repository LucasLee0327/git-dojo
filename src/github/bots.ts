// 機器人（小美、部長）的動作：直接改 origin 與小美的電腦，模擬他們在 GitHub／自己電腦上做事。
import { makeCommit, treeOf } from '../git/repo';
import type { Actor, Files, World } from '../git/types';

/** 讓小美的電腦隨時追上 GitHub 的狀態（她總是勤勞地 fetch） */
export function syncMei(w: World) {
  const mei = w.repos.mei;
  const o = w.repos.origin;
  mei.remotes = {};
  for (const [b, id] of Object.entries(o.branches)) mei.remotes[`origin/${b}`] = id;
  for (const b of Object.keys(mei.branches)) {
    if (o.branches[b] === undefined && mei.tracking[b]) {
      // 遠端已刪除的分支：保留在她電腦上，不處理
    }
  }
  const st = o.branches['staging'];
  if (st && mei.head.kind === 'branch' && mei.head.name === 'staging') {
    mei.branches['staging'] = st;
    mei.index = { ...treeOf(w, st) };
    mei.work = { ...treeOf(w, st) };
  }
}

/**
 * 某人在 origin 的 branch 上推了一個 commit。
 * branch 不存在時，從 fromBranch 開出來。mutate 收到目前樹，回傳新樹。
 */
export function botPush(
  w: World,
  actor: Actor,
  branch: string,
  mutate: (tree: Files) => Files,
  message: string,
  fromBranch = 'staging',
): string {
  const o = w.repos.origin;
  const parent = o.branches[branch] ?? o.branches[fromBranch];
  const tree = mutate({ ...treeOf(w, parent) });
  const id = makeCommit(w, { parents: parent ? [parent] : [], message, author: actor, tree });
  o.branches[branch] = id;
  if (actor === 'mei') {
    w.repos.mei.branches[branch] = id;
    w.repos.mei.tracking[branch] = { remote: 'origin', branch };
  }
  syncMei(w);
  return id;
}
