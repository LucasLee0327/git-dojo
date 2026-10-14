import type { Game } from '../core/game';
import { isAncestor } from '../git/repo';
import type { PR } from '../git/types';
import { botPush } from '../github/bots';
import { createPR, mergePR } from '../github/github';
import { withBookmark, withDark, withTitle1 } from '../site/files';
import { runApp } from '../site/runner';
import { baseWorld, newPR, siteTree } from './common';
import type { EvTab, LevelDef } from './types';

const EV_MERGE: EvTab[] = ['checks'];

const rel = (g: Game): PR | undefined => g.prs.find((p) => p.head === 'staging' && p.base === 'master');
const masterTree = (g: Game) => g.w.objects[g.origin.branches.master].tree;

export const level10: LevelDef = {
  id: 10,
  title: '上線',
  part: 3,
  minutes: 4,
  rules: ['P6', 'R4'],
  role: 'lead',
  blurb: '把 staging 發布到正式站（master）。合併方式選錯，兩條分支會越分越開。',
  story: [
    '本週在 staging 上累積了三個功能：章節標題改名、深色模式、收藏按鈕。測試站（staging）你已經點過，沒問題。正式站（master）還停在上週。',
    '🧑 上線只有總負責人能做（R4，這一關你就是總負責人）：開一個 staging → master 的 PR，檢查 Checks，然後合併。',
    '重點是合併方式。功能 PR 用 Squash and merge（P6），但「上線」這種 PR 不一樣——你可以兩種都試試看（有「時光倒流」），看看會發生什麼。',
  ],
  setup() {
    const { w } = baseWorld({ meOn: 'staging' });
    const t3 = siteTree();
    void t3;
    const feat = (branch: string, title: string, mut: (t: Record<string, string>) => Record<string, string>) => {
      botPush(w, 'mei', branch, mut, title);
      mergePR(w, newPR(w, { title, head: branch, author: 'mei' }), 'squash', 'boss');
    };
    feat('feat/chapter-title', '第 1 章標題改為「心血管系統」', (t) => withTitle1(t, '第 1 章　心血管系統'));
    feat('feat/dark-mode', '新增深色模式按鈕', (t) => withDark(t));
    feat('feat/bookmark', '新增收藏按鈕', (t) => withBookmark(t, 'ok'));
    const me = w.repos.me;
    const o = w.repos.origin;
    me.branches.staging = o.branches.staging;
    me.remotes['origin/staging'] = o.branches.staging;
    me.index = { ...w.objects[o.branches.staging].tree };
    me.work = { ...w.objects[o.branches.staging].tree };
    return { world: w };
  },
  events: [
    {
      id: 'next-release',
      when: (g) => rel(g)?.state === 'merged' && rel(g)!.mergeMethod === 'squash',
      run: (g) => {
        const w = g.w;
        // 一週後：小美又改了同一行標題，合併進 staging；然後你準備下一次上線
        botPush(w, 'mei', 'feat/chapter-title-2', (t) => ({ ...t, 'app.js': t['app.js'].replace("title: '第 1 章　心血管系統'", "title: '第 1 章　心臟與血管系統'") }), '第 1 章標題再調整');
        const p = newPR(w, { title: '第 1 章標題再調整', head: 'feat/chapter-title-2', author: 'mei' });
        mergePR(w, p, 'squash', 'boss');
        const res = createPR(w, { title: '下次上線：staging → master', body: '', head: 'staging', base: 'master', draft: false, author: 'boss' });
        g.notify('sys', '（一週後）小美又改了同一行標題並合併；你開了下一次的上線 PR——看看它的狀態。', 'alert');
        void res;
      },
    },
  ],
  traps: [
    {
      id: 'squash-release',
      test: (g) =>
        rel(g)?.state === 'merged' && rel(g)!.mergeMethod === 'squash'
          ? '⚠ 你用 Squash 上線了。master 上多了一個「全新的 commit」，Git 不知道它和 staging 上那一串 commit 是同一批東西，兩條分支的歷史從此分岔。一週後小美改了同一行，下一次上線 PR 就出現衝突（看 GitHub 分頁的 PR）。上線請用 Create a merge commit。按「時光倒流」重選。'
          : null,
    },
  ],
  objectives: [
    { id: 'preview', label: '🧑 先到預覽看過「測試站」和「正式站」，確認要發布的內容', human: true, done: (g) => !!(g.flags.visited?.['staging-preview'] && g.flags.visited?.['production-preview']) },
    { id: 'pr', label: '🧑 開一個 PR：head＝staging、base＝master', human: true, done: (g) => !!rel(g) },
    {
      id: 'merged',
      label: '🧑 打開 PR 的 Checks 確認全綠，再用 Create a merge commit 合併；正式站出現新功能',
      human: true,
      evidence: { on: ['merge'], pr: rel, tabs: EV_MERGE },
      done: (g) => {
        const p = rel(g);
        return !!p && p.state === 'merged' && p.mergeMethod === 'merge' && g.checkedPR(p.number, EV_MERGE) && !!p.finalHead && isAncestor(g.w, p.finalHead, g.origin.branches.master) && runApp(masterTree(g)).ok && (masterTree(g)['app.js'] ?? '').includes('toggleBookmark');
      },
    },
  ],
  hints: {
    preview: ['預覽分頁可以切換環境：本機／PR 預覽／測試站／正式站。', '把測試站和正式站各看一次，比較差在哪裡。', '預覽 → 測試站；預覽 → 正式站。'],
    pr: ['到 GitHub 分頁 → Pull requests → New pull request。', '把 base 選 master、compare 選 staging。', '標題寫「上線：staging → master」，建立。'],
    merged: [
      '上線 PR 的合併方式要想一下：Squash 把 staging 上很多 commit 壓成一個新 commit，Git 之後認不出它們是同一批東西。',
      '選 Create a merge commit：master 上會多一個 merge commit，staging 的每個 commit 都原封不動被帶過去。',
      '先在 PR 頁面打開 Checks 分頁看過（任務才會打勾），再選「Create a merge commit」，按合併。沒看就合併也可以，之後回 PR 頁補看。',
    ],
  },
  success: {
    summary: [
      '功能 PR 用 Squash（歷史乾淨，一個功能一個 commit，P6）；上線 PR 用 merge commit（保留 staging 的歷史，兩條長期分支才不會越分越開）。',
      '如果你試過 Squash：master 上那個全新的 commit，和 staging 上對應的那串 commit 內容相同、Git 卻認不出來。之後只要同一行再被改一次，下次上線就衝突。',
    ],
    rules: [
      { code: 'P6', text: '功能 PR 用 Squash；staging → master 的上線 PR 用 merge commit' },
      { code: 'R4', text: '上線（staging → master）只有總負責人能做；這一關你就是' },
    ],
  },
};
