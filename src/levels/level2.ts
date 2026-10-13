import type { Game } from '../core/game';
import { hasConflictMarkers } from '../git/diff';
import { ancestors } from '../git/repo';
import { mergeInfo, mergePR, submitReview } from '../github/github';
import { runTests } from '../site/runner';
import { siteTree, baseWorld, botPush, bossPolicy, newPR, tipTree } from './common';
import { withTitle1 } from '../site/files';
import type { LevelDef } from './types';

const FEAT = 'feat/chapter-title';
const myPR = (g: Game) => g.prs.find((p) => p.head === FEAT);
const merged = (g: Game) => myPR(g)?.state === 'merged';
const tip = (g: Game) => g.me.branches[FEAT];
const mergedIn = (g: Game) => !!tip(g) && ancestors(g.w, tip(g)).has(g.flags.M);

export const level2: LevelDef = {
  id: 2,
  title: '衝突',
  part: 1,
  minutes: 8,
  rules: ['G3', 'P5'],
  role: 'member',
  blurb: '你和小美改了同一行，她先合併了，你的 PR 出現 conflicts。',
  story: [
    '你的 PR（feat/chapter-title）把第 1 章的標題改成「循環系統（含圖解）」。但小美同時間也改了同一行——改成「心血管系統」，而且她的 PR 先被合併進 staging 了。',
    'GitHub 上你的 PR 顯示「This branch has conflicts that must be resolved」，部長也留言退回。你的電腦還停在 staging，沒有 fetch 過，看不到小美的修改。',
    '流程：先確認自己在哪條分支（git branch --show-current）→ 切到你的分支 → git fetch → git merge origin/staging（同步 staging 一律用 merge，不用 rebase，G3）→ 🧑 在編輯器面板讀衝突記號、決定怎麼合 → add → commit → push。',
  ],
  setup() {
    const { w, ids } = baseWorld({ meOn: 'staging' });
    const t3 = siteTree();
    // 你的分支
    const mine = botPush(w, 'me', FEAT, () => withTitle1(t3, '第 1 章　循環系統（含圖解）'), '第 1 章標題加上「含圖解」');
    const me = w.repos.me;
    me.branches[FEAT] = mine;
    me.tracking[FEAT] = { remote: 'origin', branch: FEAT };
    me.remotes[`origin/${FEAT}`] = mine;
    const pr = newPR(w, { title: '第 1 章標題加上「含圖解」', body: '對應 Issue #8。', head: FEAT, author: 'me' });
    submitReview(w, pr, 'boss', 'approved', '內容 OK，等 CI。', []);
    // 小美的分支與 PR，先被合併
    botPush(w, 'mei', 'feat/rename-title', () => withTitle1(t3, '第 1 章　心血管系統'), '第 1 章標題改為「心血管系統」');
    const meiPR = newPR(w, { title: '第 1 章標題改為「心血管系統」', head: 'feat/rename-title', author: 'mei' });
    mergePR(w, meiPR, 'squash', 'boss');
    return { world: w, flags: { M: w.repos.origin.branches.staging, c3: ids.c3 } };
  },
  events: [bossPolicy({ id: 'boss-merge' })],
  traps: [
    {
      id: 'markers-committed',
      test: (g) => {
        const t = tipTree(g, FEAT);
        return t && Object.values(t).some((c) => hasConflictMarkers(c))
          ? '⚠ 衝突記號（<<<<<<<）被 commit 進去了！網站的 app.js 現在是壞的' +
            (g.origin.branches[FEAT] === g.me.branches[FEAT] ? '，GitHub 上的 CI 會變紅（P4）。' : '，push 上去之後 CI 會變紅（P4）。') +
            '回到編輯器把記號清掉，再 commit 一次。'
          : null;
      },
    },
  ],
  objectives: [
    { id: 'where', label: '🧑 先確認自己在哪條分支（git branch --show-current），再切到 feat/chapter-title', human: true, done: (g) => merged(g) || (g.ran(/^git (branch --show-current|status)/) && (g.branch === FEAT || mergedIn(g))) },
    { id: 'merge', label: '用 git fetch 加 git merge origin/staging，把 staging 合進你的分支（會出現衝突）', done: (g) => merged(g) || mergedIn(g) || !!g.me.merge },
    {
      id: 'resolve',
      label: '🧑 在編輯器面板讀衝突記號，決定標題要怎麼合，存檔',
      human: true,
      done: (g) => {
        if (merged(g)) return true;
        if (g.me.merge) return !hasConflictMarkers(g.me.work['app.js'] ?? '<<<<<<< ');
        return mergedIn(g) && !hasConflictMarkers(tipTree(g, FEAT)!['app.js']);
      },
    },
    {
      id: 'commit',
      label: 'git add 衝突的檔案，再 git commit 完成合併',
      done: (g) => merged(g) || (mergedIn(g) && !Object.values(tipTree(g, FEAT)!).some(hasConflictMarkers) && runTests(tipTree(g, FEAT)!).ok),
    },
    { id: 'push', label: 'git push，讓 PR 的 conflicts 消失、CI 變綠', done: (g) => merged(g) || (!!tip(g) && g.origin.branches[FEAT] === tip(g) && !!myPR(g) && mergeInfo(g.w, myPR(g)!).mergeable && mergedIn(g)) },
    { id: 'merged', label: '部長確認後合併你的 PR', done: (g) => merged(g) },
  ],
  hints: {
    where: [
      '打指令之前先確認自己站在哪裡——很多「莫名其妙的衝突」是因為在錯的分支上操作。',
      'git branch --show-current 看目前分支；要去你的分支：git switch feat/chapter-title',
      'git branch --show-current\ngit switch feat/chapter-title',
    ],
    merge: [
      '要先把 GitHub 上的新狀態抓下來（fetch），再把 origin/staging 合進來（merge）。',
      'git fetch → git merge origin/staging',
      'git fetch\ngit merge origin/staging\n（出現 CONFLICT 是正常的，下一步處理）',
    ],
    resolve: [
      '切到右邊的「編輯器」分頁，打開 app.js。<<<<<<< HEAD 到 ======= 是你的版本，======= 到 >>>>>>> 是小美的版本。',
      '你可以按「保留我的」「保留對方的」「兩者都留」，或手動編輯。兩邊的意思都想留的話，可以手動寫成「第 1 章　心血管系統（含圖解）」。',
      '沒有唯一正解——重點是你「讀過、想過」。建議手動編輯成：第 1 章　心血管系統（含圖解），存檔後記得 git add。',
    ],
    commit: ['解完衝突後，Git 還不知道你處理好了。先 add 那個檔案，再 commit。', 'git add app.js → git commit -m "合併 staging，解決標題衝突"', 'git add app.js\ngit commit -m "合併 staging，解決第 1 章標題衝突"'],
    push: ['你的分支現在包含了 staging 的修改，可以推了。', 'git push（這條分支已經有 upstream）', '輸入 git push'],
    merged: ['推上去後 GitHub 會重新跑 CI。綠燈且沒有衝突，部長就會合併。', '看通知。', '如果部長退回了，看他留的言。'],
  },
  success: {
    summary: [
      '衝突不是壞事，是「兩個人改了同一個地方，Git 不敢替你決定」。你做對的事：先確認所在分支、fetch 再 merge origin/staging（G3：同步 staging 用 merge，不 rebase）、自己讀過兩邊的內容再決定。',
      '🧑 解衝突的「決定」只有人能做——AI 可以幫你打指令，但「小美的修改要不要留」要你判斷。到下一部你會看到 AI 自作主張選一邊的後果。',
    ],
    rules: [
      { code: 'G3', text: '同步 staging 一律用 merge，已 push 的分支不改寫歷史' },
      { code: 'P5', text: '合併前 PR 如果落後 staging，先同步並等 CI 重跑變綠' },
    ],
  },
};
