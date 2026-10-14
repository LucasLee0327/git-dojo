import { botPush, baseWorld, newPR } from './common';
import { withBookmark } from '../site/files';
import type { LevelDef } from './types';

export const level0: LevelDef = {
  id: 0,
  title: '認識畫面',
  part: 1,
  minutes: 3,
  rules: [],
  role: 'member',
  blurb: '先看看這個練習場的每個面板，各自是做什麼用的。',
  story: [
    '歡迎來到 git-dojo！這裡模擬一個真實的團隊：你是「小共筆 TinyNote」專案的新進部員，組員是小美，部長是你的直屬長官。',
    '畫面分成幾塊：左上是 AI 助手（模擬的 Claude Code），左下是終端機，中間是預覽／GitHub／編輯器，最右邊是一直都在的「Git 狀態」面板——現在的分支、檔案狀態、分支圖都在那裡，每個指令之後會即時更新。',
    '這一關很短：跟著任務清單每項都點一點、打一打，熟悉一下就好。',
  ],
  setup() {
    const { w, ids } = baseWorld({ meOn: 'staging' });
    // 小美正在做一個功能，已經推上 GitHub 並開了 PR，讓分支圖與 GitHub 頁面有東西可看
    botPush(w, 'mei', 'feat/bookmark-preview', (t) => withBookmark(t, 'ok'), '新增收藏按鈕的草稿');
    newPR(w, { title: '收藏按鈕（草稿）', body: '先放上來給大家看看。', head: 'feat/bookmark-preview', author: 'mei', draft: true });
    w.repos.me.remotes['origin/feat/bookmark-preview'] = w.repos.origin.branches['feat/bookmark-preview'];
    void ids;
    return { world: w };
  },
  objectives: [
    { id: 'status', label: '在終端機輸入 git status，看看目前的狀態', done: (g) => g.ran(/^git status/, { src: 'user' }) },
    { id: 'log', label: '輸入 git log --oneline --graph --all，看看歷史長什麼樣子', done: (g) => g.ran(/^git log\b.*--graph/, { src: 'user' }) && g.ran(/^git log\b.*--all/, { src: 'user' }) },
    {
      id: 'tabs',
      label: '把中間的「預覽」「GitHub」「編輯器」三個分頁都點開看一眼',
      done: (g) => !!(g.flags.visited?.preview && g.flags.visited?.github && g.flags.visited?.editor),
    },
    { id: 'ai', label: '請 AI 助手幫你看一下現在的狀態（從選項選一句話送出）', done: (g) => !!(g.flags['said:l0-a'] || g.flags['said:l0-b']) },
  ],
  hints: {
    status: [
      '終端機在左下角。點進輸入框，輸入 git status 後按 Enter。',
      '指令是：git status',
      '在左下角的終端機輸入：git status（照打，然後 Enter）。',
    ],
    log: [
      'git log 會列出歷史。加上 --graph 會畫出分支的樣子，--all 會包含所有分支。',
      'git log --oneline --graph --all',
      '輸入：git log --oneline --graph --all，然後比對右側 Git 狀態面板的分支圖。',
    ],
    tabs: ['中間區塊上方有三個分頁標籤。', '依序點「預覽」「GitHub」「編輯器」。', '各點一下就算完成，不需要做別的事。'],
    ai: ['左上角的 AI 助手下方有兩句話可以選。', '選哪一句都可以，點一下就會送出。', '點選項，AI 會自己跑指令回報給你。'],
  },
  agent: {
    auto: false,
    intro: '嗨！我是你的 AI 助手（模擬的）。你從下方選一句話，那句話就是你實際對我說的話。',
    scripts: {
      look: [
        { k: 'say', text: '好的，我先看一下目前的分支和狀態。' },
        { k: 'run', cmd: 'git branch --show-current', why: '確認所在分支' },
        { k: 'run', cmd: 'git status', why: '看有沒有未 commit 的修改' },
        {
          k: 'say',
          text: '你目前在 staging 分支，工作資料夾是乾淨的，沒有未 commit 的修改。右邊的「Git 狀態」面板會即時反映這些資訊——之後我做的每一個動作，你都能在那裡看到變化。',
        },
      ],
    },
    offer: (g) =>
      g.flags['said:l0-a'] || g.flags['said:l0-b']
        ? null
        : {
            label: '你想對 AI 說什麼？',
            options: [
              { id: 'l0-a', text: '告訴我現在在哪個分支，有沒有還沒 commit 的修改。', quality: 'good', script: 'look', note: '具體說明你要確認什麼——AI 能照做，你也容易驗證。' },
              { id: 'l0-b', text: '我剛接手這個專案，想先了解一下目前的狀態，麻煩你幫我看看。', quality: 'ok', script: 'look', note: '可以，但「狀態」很籠統，之後的關卡你會發現說得越具體越安全。' },
            ],
          },
  },
  success: {
    summary: [
      '你已經認識所有面板：AI 助手負責「聽你說、幫你跑指令」，終端機讓你自己動手，預覽顯示小專案的樣子，GitHub 分頁是模擬的 GitHub，右邊常駐的 Git 狀態面板隨時告訴你目前的分支與歷史。',
      '提醒：進度會自動存在這個瀏覽器裡；用無痕視窗、清除網站資料或換電腦就會消失。',
    ],
    rules: [],
  },
};
