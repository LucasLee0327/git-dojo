import type { Game } from '../core/game';
import { ancestors } from '../git/repo';
import { mergePR, updateBranch } from '../github/github';
import { withFooterCount } from '../site/files';
import { baseWorld, botPush, bossPolicy, editSite, newPR, siteTree } from './common';
import { checkoutClean } from '../git/repo';
import type { EvTab, LevelDef } from './types';

const EV_READY: EvTab[] = ['checks'];

const FEAT = 'feat/chapter-count';
const STYLE_RULE = '\n#footer { color: #666; font-size: 0.9em; }\n';
const myPR = (g: Game) => g.prs.find((p) => p.head === FEAT);
const merged = (g: Game) => myPR(g)?.state === 'merged';
const tip = (g: Game) => g.me.branches[FEAT];
const hasUpd = (g: Game) => !!tip(g) && ancestors(g.w, tip(g)).has(g.flags.upd);
const hasStyle = (g: Game) => !!tip(g) && (g.w.objects[tip(g)].tree['style.css'] ?? '').includes('#footer { color: #666');

export const level3: LevelDef = {
  id: 3,
  title: 'push 被拒絕了',
  part: 1,
  minutes: 8,
  rules: ['G6', 'P5'],
  role: 'member',
  blurb: '你的分支在 GitHub 上被別人「更新」過了。為什麼 push 被擋？怎麼辦？',
  story: [
    '昨天你把 feat/chapter-count（頁尾顯示共幾章）推上 GitHub 並開了 PR。今天 PR 頁面上，部長看到分支落後 staging，按了 Update branch——GitHub 在你的分支上多做了一個 merge commit。',
    '你的電腦完全不知道這件事。你現在想補一個小修改（頁尾文字的樣式），commit 之後 push——然後事情就不順了。',
    '這一關練習：看懂 push 被拒絕的原因、用 pull 把 GitHub 上多出來的東西合進來、第一次 push 時用 -u 設追蹤。不要用 --force（G6）。',
  ],
  setup() {
    const { w } = baseWorld({ meOn: 'staging' });
    const t3 = siteTree();
    // 昨天：你把頁尾章數推上去（沒有設 upstream）
    const first = botPush(w, 'me', FEAT, () => withFooterCount(t3), '頁尾顯示共幾章');
    const me = w.repos.me;
    me.branches[FEAT] = first;
    me.remotes[`origin/${FEAT}`] = first;
    me.head = { kind: 'branch', name: FEAT };
    checkoutClean(w, 'me');
    const pr = newPR(w, { title: '頁尾顯示共幾章', body: '對應 Issue #9。', head: FEAT, author: 'me', draft: true });
    // 今天：小美的 README 修正先合併，部長按 Update branch
    botPush(w, 'mei', 'fix/readme-typo', (t) => ({ ...t, 'README.md': t['README.md'] + '\n## 授權\n\n教材僅供系上同學內部使用。\n' }), '補上 README 授權說明');
    const meiPR = newPR(w, { title: '補上 README 授權說明', head: 'fix/readme-typo', author: 'mei' });
    mergePR(w, meiPR, 'squash', 'boss');
    updateBranch(w, pr, 'boss');
    return { world: w, flags: { upd: w.repos.origin.branches[FEAT] } };
  },
  edits: [
    {
      id: 'footer-style',
      label: '套用修改：幫頁尾文字加上樣式',
      hint: '在 style.css 最後面加一條 #footer 的樣式。',
      available: (g) => g.branch === FEAT && !(g.me.work['style.css'] ?? '').includes('#footer { color: #666'),
      apply: (w) => editSite(w, (f) => ({ 'style.css': f['style.css'] + STYLE_RULE })),
    },
  ],
  events: [bossPolicy({ id: 'boss-merge' })],
  traps: [
    {
      id: 'push-forced',
      test: (g) =>
        g.state.hist.some((h) => h.tag === 'push-forced' && h.src === 'user')
          ? '🚨 你 force push 了！部長在 GitHub 上做的 merge commit 被你的版本蓋掉（G6）。按「時光倒流」回到 push 之前，改用 git pull 把它合進來。'
          : null,
    },
  ],
  objectives: [
    { id: 'edit', label: '按編輯器的「套用修改」，幫頁尾文字加上樣式', done: (g) => merged(g) || !!g.flags['edit:footer-style'] },
    { id: 'commit', label: 'git add、git commit 這個修改', done: (g) => merged(g) || hasStyle(g) },
    {
      id: 'sync',
      label: 'push 被拒絕後，把 GitHub 上多出來的 commit 合進本機（git pull origin feat/chapter-count）',
      done: (g) => merged(g) || hasUpd(g),
    },
    {
      id: 'push',
      label: 'push 成功，而且這條分支設好追蹤（git push -u）',
      done: (g) => merged(g) || (!!tip(g) && g.origin.branches[FEAT] === tip(g) && !!g.me.tracking[FEAT] && hasStyle(g) && hasUpd(g)),
    },
    {
      id: 'ready',
      label: '🧑 先打開 PR 的 Checks 確認全綠（P4），再轉成 Ready for review',
      human: true,
      evidence: { on: ['ready'], pr: myPR, tabs: EV_READY, rule: 'P4' },
      done: (g) => !!myPR(g) && (!myPR(g)!.draft || merged(g)) && g.checkedPR(myPR(g)!.number, EV_READY),
    },
    { id: 'merged', label: '部長審查並合併', done: (g) => merged(g) },
  ],
  hints: {
    edit: ['你在 feat/chapter-count 上。到編輯器分頁找「套用修改」。', '編輯器分頁 → 「套用修改：幫頁尾文字加上樣式」。', '按下按鈕後 git status 會看到 style.css 被修改。'],
    commit: ['先 add 再 commit，只加改過的那一個檔案。', 'git add style.css → git commit -m "…"', 'git add style.css\ngit commit -m "幫頁尾加上樣式"'],
    sync: [
      '先試著 git push，看它怎麼說——錯誤訊息會告訴你該做什麼。',
      '它會說沒有 upstream。照提示用 git push -u origin feat/chapter-count，會被拒絕（fetch first）。這時用 git pull origin feat/chapter-count 把 GitHub 的東西合進來。',
      'git push -u origin feat/chapter-count   （會被拒絕，這是正常的）\ngit pull origin feat/chapter-count\n（直接輸入 git pull 會告訴你「沒有 tracking information」，因為還沒設追蹤）',
    ],
    push: ['合併完成後再 push 一次，這次記得告訴 Git 追蹤哪條遠端分支。', 'git push -u origin feat/chapter-count', '輸入：git push -u origin feat/chapter-count'],
    ready: ['到 GitHub 分頁打開 PR 的 Checks 分頁，確認全綠再轉 Ready（要真的打開，任務才會打勾）。', '點 Checks 分頁看過，再回對話分頁按 Ready for review。', '在 PR 頁面點 Checks，再按 Ready for review。'],
    merged: ['等部長審查。', '看右上角通知。', '如果被退回，看他寫的原因。'],
  },
  success: {
    summary: [
      'push 被拒絕不是壞事：Git 在保護你，免得你把別人（這次是部長按 Update branch 做的 merge commit）的工作蓋掉。正確的做法永遠是先 pull（把它合進來）、再 push；不是 --force（G6）。',
      '你也看到了「no tracking information」：本機分支沒有設追蹤，git pull / git push 不知道要對應哪一條遠端分支。第一次 push 新分支時一定要用 git push -u origin 分支名。',
      '補充：這個練習用的 repo 已經先設好團隊的選擇 git config pull.rebase false（pull 一律用 merge），所以你的 git pull 直接成功。在一台全新的電腦上，如果兩邊都有新 commit，較新版本的 Git 會在 git pull 時報 fatal: Need to specify how to reconcile divergent branches。處理方式：執行一次 git config pull.rebase false，或只這一次用 git pull --no-rebase——不要用 force push 來解。',
    ],
    rules: [
      { code: 'G6', text: '禁止 --force；push 被拒絕＝先 pull 再 push' },
      { code: 'P5', text: '合併前確認 PR 沒有落後 staging、CI 是綠的' },
    ],
  },
};
