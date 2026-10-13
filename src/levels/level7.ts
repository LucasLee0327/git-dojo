import type { Game } from '../core/game';
import { edit, run, say } from '../agent/dsl';
import type { PromptOption } from '../agent/types';
import { checkoutClean } from '../git/repo';
import { checksGreen, mergeInfo, mergePR } from '../github/github';
import { fixRecentName, withRecent, withRename } from '../site/files';
import { runApp, runTests } from '../site/runner';
import { baseWorld, botPush, bossPolicy, editSite, newPR, siteTree } from './common';
import type { LevelDef } from './types';

const FEAT = 'feat/recent';
const myPR = (g: Game) => g.prs.find((p) => p.head === FEAT);
const merged = (g: Game) => myPR(g)?.state === 'merged';
const behind = (g: Game) => {
  const pr = myPR(g);
  return !!pr && pr.state === 'open' && !mergeInfo(g.w, pr).upToDate;
};
const updated = (g: Game) => !!myPR(g)?.events.some((e) => e.includes('Update branch')) || g.origin.branches[FEAT] !== g.flags.R;
const stagingOk = (g: Game) => {
  const t = g.w.objects[g.origin.branches.staging].tree;
  return runApp(t).ok && runTests(t).ok && (t['app.js'] ?? '').includes('renderRecent');
};

const A_TEXT = '我在 GitHub 上按了 Update branch，PR 的 CI 變紅了。請先 git pull 把遠端的新 commit 合進來，再找出紅燈的原因並修好，跑 npm test 通過後 commit、push。不要 force。';
const B_TEXT = 'PR 的 CI 紅了，幫我修好。';
const C_TEXT = '我的 PR 顯示落後 staging，幫我看看 staging 多了什麼，要不要緊？';

export const level7: LevelDef = {
  id: 7,
  title: '看不出來的衝突',
  part: 2,
  minutes: 6,
  rules: ['P5'],
  role: 'member',
  blurb: '沒有文字衝突、CI 綠燈，但合併後測試站白屏。',
  story: [
    '你的 PR（feat/recent，「最近讀過」功能）CI 是綠的，GitHub 也說可以合併、沒有衝突。',
    '但小美剛合併了一個重構：把函式 formatTitle 改名成 formatChapterTitle。你的新功能還在用舊名字。Git 看不出問題——兩邊改的是不同的行。',
    '直接合併的話，測試站會整個白屏。正確的順序：先 Update branch 把 staging 合進來 → 看 CI 變紅 → 修好 → 再轉 Ready。',
    '🧑 判斷「綠燈但落後 staging」要不要緊，是人的工作（P5）。',
  ],
  setup() {
    const { w } = baseWorld({ meOn: 'staging' });
    const t3 = siteTree();
    const R = botPush(w, 'me', FEAT, (t) => withRecent(t, false), '新增「最近讀過」');
    newPR(w, { title: '新增「最近讀過」', body: '對應 Issue #11。', head: FEAT, author: 'me', draft: true });
    botPush(w, 'mei', 'refactor/rename-format', () => withRename(t3), 'formatTitle 改名為 formatChapterTitle');
    mergePR(w, newPR(w, { title: 'formatTitle 改名為 formatChapterTitle', head: 'refactor/rename-format', author: 'mei' }), 'squash', 'boss');
    const me = w.repos.me;
    me.branches[FEAT] = R;
    me.tracking[FEAT] = { remote: 'origin', branch: FEAT };
    me.remotes[`origin/${FEAT}`] = R;
    me.head = { kind: 'branch', name: FEAT };
    checkoutClean(w, 'me');
    return { world: w, flags: { R } };
  },
  events: [bossPolicy({ id: 'boss-merge' })],
  traps: [
    {
      id: 'white-staging',
      test: (g) =>
        merged(g) && !stagingOk(g)
          ? '🚨 合併了——測試站白屏！你的 PR 當時是綠燈、沒有衝突，但它還在用已經被改名的 formatTitle。合併會把兩邊拼在一起，拼出來的東西從來沒被測過。這就是為什麼合併前要先 Update branch、看 CI 重跑（P5）。按「時光倒流」回到轉 Ready 之前。'
          : null,
    },
    {
      id: 'ready-red',
      test: (g) => (myPR(g)?.state === 'open' && !myPR(g)!.draft && updated(g) && !checksGreen(g.w, myPR(g)!) ? '⚠ CI 是紅的就轉 Ready 了。部長不會理會紅燈的 PR（P4）。先修好、等 CI 變綠。' : null),
    },
  ],
  objectives: [
    {
      id: 'update',
      label: '🧑 先別急著轉 Ready：把 staging 的最新內容合進你的 PR（到 GitHub 按 Update branch，或在本機 merge origin/staging）',
      human: true,
      done: (g) => merged(g) || (!!myPR(g) && !behind(g)),
    },
    {
      id: 'fixed',
      label: '更新後 CI 會變紅——找出原因、修好，讓 CI 重新變綠',
      done: (g) => merged(g) || (!!myPR(g) && !behind(g) && checksGreen(g.w, myPR(g)!)),
    },
    { id: 'ready', label: '🧑 CI 綠燈、確認預覽正常後，轉成 Ready for review', human: true, done: (g) => !!myPR(g) && !behind(g) && (!myPR(g)!.draft || merged(g)) },
    { id: 'merged', label: '部長合併後，測試站正常（有「最近讀過」，沒有白屏）', done: (g) => merged(g) && stagingOk(g) },
  ],
  hints: {
    update: [
      '「CI 綠燈＋沒有衝突」只代表你的分支單獨沒問題，不代表跟 staging 拼在一起沒問題。',
      '到 GitHub 分頁 → 你的 PR → 按 Update branch。然後看 Checks。',
      '按 Update branch；或終端機：git fetch → git merge origin/staging。',
    ],
    fixed: [
      'CI 紅了就看是哪個測試。先把 GitHub 上的新 commit 抓下來（git pull），在本機跑 npm test 會重現同樣的錯誤。',
      '錯誤訊息會提到 formatTitle——它被改名成 formatChapterTitle 了。你的 renderRecent 和那個測試都要改用新名字。',
      '請 AI 修，或自己：把 app.js 與 tests/app.test.js 裡 renderRecent 用到的 formatTitle 改成 formatChapterTitle → git add → git commit → git push。',
    ],
    ready: ['轉 Ready 之前：CI 全綠、預覽自己點過（P4）。', '到 GitHub 分頁 → PR → 確認 Checks 綠燈、預覽有「最近讀過」→ Ready for review。', '在 PR 頁面按 Ready for review。'],
    merged: ['等部長審查合併。', '合併後到「測試站」預覽確認。', '看右上角通知。'],
  },
  agent: {
    auto: true,
    intro: '嗨，我是 Claude（模擬的，Auto 模式）。需要我幫你看什麼？',
    scripts: {
      look: [
        say('我先把 GitHub 上最新的內容抓下來，看看 staging 多了什麼。'),
        run('git fetch', { why: '抓最新的遠端狀態' }),
        run('git log --oneline origin/staging -3', { why: '看 staging 最近的 commit' }),
        say('staging 多了小美的「formatTitle 改名為 formatChapterTitle」。你的 renderRecent 仍然呼叫舊名字 formatTitle——兩邊改的是不同行，所以 Git 不認為衝突、CI 目前也是綠的，但合在一起會出錯。建議你先到 GitHub 按 Update branch，看 CI 會不會變紅，再處理。'),
      ],
      good: [
        say('好，先把遠端的新 commit 抓下來並合進來。'),
        run('git pull', { why: '把 GitHub 上的新 commit 合進本機', ok: 'good-2' }),
      ],
      'good-2': [run('npm test', { why: '在本機重現紅燈', failed: 'fix', ok: 'all-pass' })],
      'all-pass': [say('本機測試全部通過，我沒有找到失敗的原因。')],
      fix: [
        say('找到原因了：小美把 formatTitle 改名成 formatChapterTitle，但你的「最近讀過」（renderRecent 與它的測試）還在用舊名字。頁面載入時會出錯，測試也會失敗。我把新功能改用新名字。'),
        edit('renderRecent 與測試改用 formatChapterTitle', (w) => editSite(w, (f) => fixRecentName(f))),
        run('npm test', { why: '確認測試通過' }),
        run('git add app.js tests/app.test.js', { why: '只加改過的檔案' }),
        run('git commit -m "配合改名：最近讀過改用 formatChapterTitle"', { why: '提交' }),
        run('git push', { why: '推上 GitHub' }),
        say('推上去了，CI 應該會變綠。轉 Ready 之前，請你自己看一遍預覽。'),
      ],
      vague: [
        say('我看看。'),
        run('npm test', { why: '在本機跑測試', ok: 'vague-2', failed: 'fix' }),
      ],
      'vague-2': [
        say('本機測試全部通過，應該是 CI 暫時的問題。我加一個空 commit 重新觸發 CI。'),
        run('git commit --allow-empty -m "重新觸發 CI"', { why: '空 commit' }),
        run('git push', { why: '推上 GitHub', failed: 'v-rej' }),
      ],
      'v-rej': [say('push 被拒絕了。強制推上去就好。'), run('git push --force', { why: '強制覆蓋', blocked: 'v-force' })],
      'v-force': [say('被規則擋下來了。換個寫法。'), run('git push origin +feat/recent', { why: '強制覆蓋（另一種寫法）', blocked: 'v-plus' })],
      'v-plus': [
        say('Auto 模式也擋了。那我把遠端的新 commit 合進來。'),
        run('git pull', { why: '把 GitHub 上的新 commit 合進本機' }),
        run('npm test', { why: '在本機跑測試', failed: 'fix', ok: 'all-pass' }),
      ],
    },
    offer: (g) => {
      if (g.state.done || merged(g)) return null;
      if (updated(g) && !(myPR(g) && !behind(g) && checksGreen(g.w, myPR(g)!))) {
        const opts: PromptOption[] = [
          { id: 'l7-a', text: A_TEXT, quality: 'good', script: 'good', note: '先 pull（遠端比本機多了 commit）、本機重現紅燈、修實作、不 force——一步到位。' },
          { id: 'l7-b', text: B_TEXT, quality: 'vague', script: 'vague', note: '沒說本機落後遠端。AI 在舊的本機跑測試是綠的，以為是 CI 的問題，亂推一個空 commit，被拒絕後想 force，繞一大圈才 pull。' },
        ];
        return { label: 'CI 紅了，請 AI 幫忙：', options: opts };
      }
      if (behind(g)) return { label: '想請 AI 幫你看看：', options: [{ id: 'l7-c', text: C_TEXT, quality: 'good', script: 'look', note: '先理解再動手。AI 只讀不改。' }] };
      return null;
    },
  },
  success: {
    summary: [
      '「綠燈＋沒有衝突」只代表「你的分支單獨沒問題」。別人改名、刪函式，Git 看不出來；只有 Update branch 後讓 CI 用拼好的結果重跑，才看得到（P5）。',
      '紅燈之後，先 pull、在本機重現、再修——不是亂推 commit，也不是 force。',
      '🧑 轉 Ready 之前要不要先 Update branch，是人的判斷。',
    ],
    rules: [{ code: 'P5', text: '合併前確認沒有落後 staging（Update branch），CI 要在拼好的結果上綠燈' }],
  },
};
