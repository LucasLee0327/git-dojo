import type { Game } from '../core/game';
import { call, edit, run, say } from '../agent/dsl';
import { botPush } from '../github/bots';
import { markReady, mergePR } from '../github/github';
import { withBookmark, withBrokenFont, withDark, withFooterCount, withTitle1 } from '../site/files';
import { baseWorld, bossPolicy, editSite, newPR } from './common';
import type { EditAction, LevelDef } from './types';
import type { Files, World } from '../git/types';

const once = (id: string) => (g: Game) => !g.flags[`edit:${id}`];

function tryEdit(w: World, fn: (f: Files) => Files) {
  try {
    editSite(w, fn);
  } catch {
    /* 已經套用過了 */
  }
}

const EDITS: EditAction[] = [
  {
    id: 'my-dark',
    label: '我：寫好深色模式按鈕',
    hint: '修改 index.html、app.js、style.css 和測試（在你目前的分支上）。',
    available: once('my-dark'),
    apply: (w) => tryEdit(w, (f) => withDark(f)),
  },
  {
    id: 'my-title',
    label: '我：把第 1 章標題改成「循環系統（含圖解）」',
    hint: '改 app.js 裡章節標題那一行。和小美的「改標題」同一行，用來練習衝突。',
    available: once('my-title'),
    apply: (w) => tryEdit(w, (f) => withTitle1(f, '第 1 章　循環系統（含圖解）')),
  },
  {
    id: 'my-footer',
    label: '我：頁尾顯示共幾章',
    hint: '改 app.js 的頁尾那一行。',
    available: once('my-footer'),
    apply: (w) => tryEdit(w, (f) => withFooterCount(f)),
  },
  {
    id: 'mei-draft',
    label: '小美：開一個收藏按鈕的 Draft PR',
    hint: '小美推 feat/bookmark-mei 並開 Draft PR。',
    available: once('mei-draft'),
    apply: (w) => {
      botPush(w, 'mei', 'feat/bookmark-mei', (t) => withBookmark(t, 'ok'), '新增收藏按鈕');
      newPR(w, { title: '新增收藏按鈕（小美）', body: '先放上來給大家看。', head: 'feat/bookmark-mei', author: 'mei', draft: true });
    },
  },
  {
    id: 'mei-ready',
    label: '小美：把她的 PR 轉成 Ready（部長會合併）',
    hint: '小美的 Draft PR 轉 Ready，部長機器人審查並 Squash 合併進 staging；你的 staging 會落後。',
    available: (g) => g.prs.some((p) => p.author === 'mei' && p.state === 'open' && p.draft),
    apply: (w) => {
      for (const p of w.github.prs) if (p.author === 'mei' && p.state === 'open' && p.draft) markReady(p, 'mei');
    },
  },
  {
    id: 'mei-title',
    label: '小美：改第 1 章標題為「心血管系統」並合併進 staging',
    hint: '小美的標題 PR 直接被合併。你的 staging 會落後；和你的標題修改同一行。',
    available: once('mei-title'),
    apply: (w) => {
      botPush(w, 'mei', 'feat/title-mei', (t) => withTitle1(t, '第 1 章　心血管系統'), '第 1 章標題改為「心血管系統」');
      mergePR(w, newPR(w, { title: '第 1 章標題改為「心血管系統」', head: 'feat/title-mei', author: 'mei' }), 'squash', 'boss');
    },
  },
  {
    id: 'mei-broken',
    label: '小美：合併一個會讓測試站白屏的 PR',
    hint: '用來練習 Revert（像第 9 關）。',
    available: once('mei-broken'),
    apply: (w) => {
      botPush(w, 'mei', 'feat/font-mei', (t) => withBrokenFont(t), '字體大小調整');
      mergePR(w, newPR(w, { title: '字體大小調整（小美）', head: 'feat/font-mei', author: 'mei' }), 'squash', 'boss');
    },
  },
];

export const level11: LevelDef = {
  id: 11,
  title: '自由模式 ★',
  part: 3,
  minutes: 0,
  rules: [],
  role: 'member',
  free: true,
  optional: true,
  blurb: '沒有任務。想練什麼就練什麼：叫小美做事、請 AI 幫忙、自己打指令。',
  story: [
    '這裡沒有任務卡，也不會過關。你可以：自己在終端機打指令、用「我」的按鈕寫程式修改、叫小美做事（開 PR、改標題、合併一個會弄壞測試站的 PR……），或請 AI 幫忙。',
    '想重來？按「重置」。想回到上一步？按「時光倒流」。',
  ],
  setup() {
    const { w } = baseWorld({ meOn: 'staging' });
    return { world: w };
  },
  edits: EDITS,
  events: [bossPolicy({ id: 'boss-merge', match: (pr) => pr.author === 'me' || pr.author === 'mei' })],
  objectives: [],
  hints: {},
  agent: {
    auto: true,
    intro: '自由模式：我是 Claude（模擬的，Auto 模式）。選一個我能做的事吧。',
    scripts: {
      look: [
        say('我看一下目前的狀態和歷史。'),
        run('git status', { why: '看工作資料夾' }),
        run('git log --oneline --graph --all -8', { why: '看最近的歷史' }),
        say('就這些。想接著做什麼？'),
      ],
      sync: [
        say('我把最新的 staging 合進目前的分支。'),
        run('git fetch', { why: '抓最新的遠端狀態' }),
        run('git merge origin/staging', { why: '把 staging 合進來', failed: 'conflict', ok: 'merged-ok' }),
      ],
      'merged-ok': [say('合併完成，沒有衝突。')],
      conflict: [say('有衝突。我不替你決定怎麼合——請到「編輯器」分頁看衝突記號，解完後 git add、git commit。')],
      branch: [
        say('我開一條新分支，做一個小修改。'),
        run('git switch -c feat/ai-tweak', { why: '開功能分支', failed: 'fail' }),
        edit('頁尾顯示共幾章', (w) => tryEdit(w, (f) => withFooterCount(f))),
        run('git add app.js', { why: '只加改過的檔案' }),
        run('git commit -m "頁尾顯示共幾章"', { why: '提交', failed: 'fail' }),
        say('做好了，已經 commit。還沒推上去。'),
      ],
      pr: [
        say('我把目前的分支推上去，並開 Draft PR。'),
        run('git push -u origin feat/ai-tweak', { why: '推上 GitHub', failed: 'fail' }),
        run('gh pr create --draft --title "頁尾顯示共幾章" --body "自由模式練習"', { why: '開 Draft PR', failed: 'fail' }),
        say('Draft PR 開好了。'),
      ],
      fail: [say('這一步沒成功，請看一下輸出再決定下一步。')],
    },
    offer: () => ({
      label: '請 AI 做：',
      options: [
        { id: 'f-look', text: '看一下目前的狀態和歷史。', quality: 'good', script: 'look', note: '只讀不改，隨時可以做。' },
        { id: 'f-sync', text: '把最新的 staging 合進目前的分支；有衝突就停下來問我。', quality: 'good', script: 'sync', note: '同步 staging 用 merge；衝突不替你決定。' },
        { id: 'f-branch', text: '開一條 feat/ai-tweak 分支，頁尾顯示共幾章，只 add 改過的檔案並 commit。', quality: 'good', script: 'branch', note: '具體說明分支、範圍。' },
        { id: 'f-pr', text: '把目前這條分支推上去，開 Draft PR。', quality: 'ok', script: 'pr', note: '需要你已經在 feat/ai-tweak 分支。' },
      ],
    }),
  },
  success: { summary: [], rules: [] },
};

void call;
