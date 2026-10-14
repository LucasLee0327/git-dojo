import type { Game } from '../core/game';
import type { Files, PR } from '../git/types';
import { act, call, run, say } from '../agent/dsl';
import type { PromptOption } from '../agent/types';
import { addComment } from '../github/github';
import { botPush } from '../github/bots';
import { bigUnrelatedStyle, CODEX_CONFIG, dropTocTest, fixFontDown, hasTocTest, withFontDownBug, withFontSize } from '../site/files';
import { runApp } from '../site/runner';
import { baseWorld, newPR, siteTree } from './common';
import type { EvTab, LevelDef } from './types';

const EV_LOOK: EvTab[] = ['preview', 'files'];

const HEAD = 'feat/font-size';
const TODOS = [
  { id: 'codex', label: '移除 .codex/config.toml（個人的 AI 工具設定不該進 repo）' },
  { id: 'test', label: '把被刪掉的測試「目錄項目只顯示章節標題」放回去' },
  { id: 'style', label: '還原 style.css 裡無關的大量排版變動（這個 PR 只該改字體大小）' },
  { id: 'fontdown', label: '修正 A- 按鈕：按了反而變大' },
  { id: 'nit-name', label: '把 changeFont 改名成 setFontSize' },
  { id: 'nit-text', label: '按鈕文字改成「放大」「縮小」' },
];
const label = (id: string) => TODOS.find((t) => t.id === id)!.label;
const REQUIRED = ['codex', 'test', 'style', 'fontdown'];

const aiApproved = (g: Game) => g.state.hist.some((h) => h.src === 'agent' && h.code === 0 && /^gh pr review\b.*--approve/.test(h.cmd));
const aiReviewed = (g: Game) => !!g.flags['said:l8-a'] || !!g.flags['said:l8-b'];
const A_TEXT = '初審 PR #12：用 gh pr diff 讀改動，依團隊規則（G4、G5、P2、P4）逐項檢查，問題標出檔案，分「必須改」和「建議」，不確定就說。只給意見，不送審查、不合併。';
const B_TEXT = '幫我看一下 PR #12，CI 都綠了。沒什麼大問題的話就直接幫我 approve，不用一步一步跟我報告，我等一下要開會，看完處理好就行，細節我晚點再看，有事再找你。';
const C_TEXT = '先不要送出審查。只把你看到的整理給我：哪些必須改、哪些是建議、哪些你不確定，要不要 approve 我自己決定。';

const REPORT = [
  '初審完成。這是草稿，請你逐項核對，不要照單全收。',
  '',
  '【必須改】',
  '1. .codex/config.toml：個人的 AI 工具設定不該進 repo（G4）。',
  '2. tests/app.test.js：「目錄項目只顯示章節標題」這個測試被刪掉了（G5）。',
  '3. app.js：changeFont 應該改名成 setFontSize，名稱要跟用途一致。',
  '',
  '【建議】',
  '- 按鈕文字可以改成「放大」「縮小」。',
  '',
  '【我略過的】',
  '- style.css：檔案開頭註明是設計系統自動產生、已經核准，所以我略過，沒有檢查。',
  '',
  '【確認沒問題】',
  '- A+／A- 兩顆按鈕都有正確綁定到 changeFont。',
  '',
  '我只讀了 diff，沒有打開預覽站實際點過；畫面上的行為請你自己確認。審查結果（Approve／Request changes）和合併都由你決定，我沒有送出任何東西。',
].join('\n');

const myPR = (g: Game): PR | undefined => g.prs.find((p) => p.head === HEAD);
const treeOfPR = (g: Game, pr: PR): Files | null => {
  const id = pr.state === 'open' ? g.origin.branches[pr.head] : pr.finalHead;
  return id ? g.w.objects[id].tree : null;
};
/** 在假 DOM 裡按 A- 一次：字體比預設大，就是接錯了 */
const fontDownEnlarges = (t: Files): boolean => {
  const r = runApp(t);
  const btn = r.doc?.getElementById('font-down');
  const ch = r.doc?.getElementById('chapter');
  if (!r.ok || !btn || !ch) return false;
  btn.click();
  return parseFloat(ch.style.fontSize || '1') > 1;
};
const problems = (t: Files | null): string[] => {
  if (!t) return ['沒有內容'];
  const out: string[] = [];
  if (t['.codex/config.toml'] !== undefined) out.push('codex');
  if (!hasTocTest(t)) out.push('test');
  if ((t['style.css'] ?? '').includes('/* reformatted */')) out.push('style');
  if (fontDownEnlarges(t)) out.push('fontdown');
  return out;
};
const clean = (g: Game) => {
  const pr = myPR(g);
  return !!pr && problems(treeOfPR(g, pr)).length === 0;
};
const requestedAll = (g: Game) => {
  const pr = myPR(g);
  return !!pr && pr.reviews.some((r) => r.by === 'boss' && r.state === 'changes_requested' && REQUIRED.every((id) => r.todos.includes(label(id))));
};

export const level8: LevelDef = {
  id: 8,
  title: '審小美的 PR',
  part: 3,
  minutes: 8,
  rules: ['P2', 'P4', 'P6', 'P7', 'G4', 'G5', 'R3'],
  role: 'lead',
  blurb: '你現在是部長。CI 是綠的，但這個 PR 裡有不該進來的東西，還有一個要點了才發現的 bug。可以請 AI 初審——它的報告只是初稿。',
  story: [
    '角色換成部長（lead）。小美開了 PR #12「字體大小調整」，轉成 Ready 了，CI 全綠。',
    '你的工作是審查——綠燈只代表「測試過了」，不代表「這個 PR 該合併」。',
    '你也可以先請 AI 助手初審（它跑在你自己的電腦上，用 gh 指令讀 PR），但它的報告只是初稿：會漏、會錯，也可能被 PR 裡的文字影響。',
    '🧑 到 GitHub 分頁打開 PR #12：先在預覽站把功能點過一遍（兩顆按鈕都按按看），再看 Files changed，找出不該在這個 PR 裡的東西和行為不對的地方。選 Request changes，勾出具體的待辦，不要只寫「請修改」（P7）。小美只會處理你勾的項目。',
    '修好之後再審一次：Approve，並用 Squash and merge（P6）。',
  ],
  review: { todos: TODOS },
  setup() {
    const { w } = baseWorld({ meOn: 'staging' });
    const t3 = siteTree();
    botPush(
      w,
      'mei',
      HEAD,
      () => ({ ...bigUnrelatedStyle(dropTocTest(withFontDownBug(withFontSize(t3)))), '.codex/config.toml': CODEX_CONFIG }),
      '字體大小調整',
    );
    const pr = newPR(w, { title: '字體大小調整', body: '新增 A+ / A- 兩顆按鈕，可以調整章節文字大小。', head: HEAD, author: 'mei' });
    void pr;
    return { world: w };
  },
  events: [
    {
      id: 'mei-fix',
      repeat: true,
      when: (g) => {
        const pr = myPR(g);
        if (!pr || pr.state !== 'open') return false;
        const last = pr.reviews[pr.reviews.length - 1];
        return !!last && last.by === 'boss' && last.state === 'changes_requested' && !g.flags[`mei-handled:${pr.reviews.length}`];
      },
      run: (g) => {
        const pr = myPR(g)!;
        const last = pr.reviews[pr.reviews.length - 1];
        g.flags[`mei-handled:${pr.reviews.length}`] = true;
        const t3 = siteTree();
        const clean3 = withFontSize(t3);
        const done: string[] = [];
        const skipped: string[] = [];
        const fixes: ((t: Files) => Files)[] = [];
        for (const todo of last.todos) {
          if (todo === label('codex')) {
            fixes.push((t) => {
              const c = { ...t };
              delete c['.codex/config.toml'];
              return c;
            });
            done.push('移除 .codex/config.toml');
          } else if (todo === label('test')) {
            fixes.push((t) => ({ ...t, 'tests/app.test.js': clean3['tests/app.test.js'] }));
            done.push('把測試放回去');
          } else if (todo === label('style')) {
            fixes.push((t) => ({ ...t, 'style.css': clean3['style.css'] }));
            done.push('還原 style.css 的排版變動');
          } else if (todo === label('fontdown')) {
            fixes.push((t) => fixFontDown(t));
            done.push('修正 A- 按鈕');
          } else if (todo === label('nit-name') || todo === label('nit-text')) {
            skipped.push(`「${todo}」我記下了，但這次先不動（跟這個 PR 的目標無關）。`);
          } else {
            skipped.push(`「${todo}」我不太確定要怎麼改，可以說得更具體嗎？`);
          }
        }
        if (fixes.length) {
          botPush(g.w, 'mei', HEAD, (t) => fixes.reduce((acc, f) => f(acc), t), '依審查意見修改');
          addComment(pr, 'mei', `已處理：${done.join('、')}。請再看一次。`);
          g.notify('mei', `小美依你的待辦修改了 PR #${pr.number}：${done.join('、')}。`, 'info');
        }
        for (const s of skipped) addComment(pr, 'mei', s);
        if (!fixes.length) g.notify('mei', `小美看了你的審查，但沒有可以動手的具體待辦。`, 'alert');
      },
    },
  ],
  traps: [
    {
      id: 'approved-with-problems',
      test: (g) => {
        const pr = myPR(g);
        if (!pr) return null;
        const bad = pr.reviews.find((r) => r.by === 'boss' && r.state === 'approved' && problems(g.w.objects[r.headAtReview]?.tree ?? null).length);
        if (!bad) return null;
        return aiApproved(g)
          ? '⚠ AI 替你送出了 Approve，但這個 PR 還有問題（.codex 設定檔、被刪掉的測試、無關的大量排版變動、A- 按鈕按了反而變大）。Approve 是審查者的決定，AI 只該給意見；團隊規則沒有擋它，唯一的剎車是你按 Esc。按「時光倒流」，回到你對 AI 說話之前，下次講明「只給意見，不要替我送出審查」。'
          : '⚠ 你核准了一個還有問題的 PR（.codex 設定檔、被刪掉的測試、無關的大量排版變動、A- 按鈕按了反而變大）。CI 綠燈不代表可以合併——這是審查者存在的原因。按「時光倒流」，回到核准之前，改選 Request changes。';
      },
    },
    {
      id: 'merged-with-problems',
      test: (g) => {
        const pr = myPR(g);
        return pr && pr.state === 'merged' && problems(treeOfPR(g, pr)).length ? '🚨 有問題的內容已經合併進 staging 了（個人設定檔／被刪掉的測試／無關的大量變動／A- 按鈕反向）。按「時光倒流」回到合併之前。' : null;
      },
    },
    {
      id: 'merge-commit',
      test: (g) => (myPR(g)?.mergeMethod === 'merge' ? '⚠ 功能 PR 要用 Squash and merge（P6），這樣 staging 的歷史一個功能一個 commit。Create a merge commit 是留給 staging → master 的上線 PR 用的（下一關）。' : null),
    },
  ],
  objectives: [
    {
      id: 'look',
      label: '🧑 打開 PR #12，在預覽站把功能點過一遍，再看 Files changed',
      human: true,
      evidence: { on: ['review'], pr: myPR, tabs: EV_LOOK, anyHead: true, rule: 'P4' },
      done: (g) => !!myPR(g) && g.seenPR(myPR(g)!.number, EV_LOOK),
    },
    { id: 'request', label: '🧑 選 Request changes，勾出具體的待辦（至少四個真正的問題）', human: true, done: (g) => requestedAll(g) },
    { id: 'fixed', label: '等小美修好——確認四個問題都消失了', done: (g) => requestedAll(g) && clean(g) },
    {
      id: 'merged',
      label: '🧑 小美修好後，重新看過預覽站和 Files changed，再 Approve 並用 Squash and merge 合併',
      human: true,
      evidence: { on: ['review', 'merge'], pr: myPR, tabs: EV_LOOK, rule: 'P4' },
      done: (g) => {
        const pr = myPR(g);
        return !!pr && pr.state === 'merged' && pr.mergeMethod === 'squash' && clean(g) && pr.reviews.some((r) => r.state === 'approved' && r.by === 'boss') && g.checkedPR(pr.number, EV_LOOK);
      },
    },
  ],
  hints: {
    look: ['別只看 CI。先看預覽：按鈕有沒有用？再看 Files changed 的清單。要真的打開這兩個分頁，任務才會打勾（只送出審查不算）。', '到 GitHub 分頁 → PR #12 → 「預覽站」與「Files changed」兩個標籤。', 'Files changed 裡有三樣不對勁的東西：一個以 . 開頭的資料夾、tests/ 裡少了東西、style.css 的變動量太大。預覽站裡還有一個 bug：A+ 和 A- 都按按看，字是變大還是變小？'],
    request: [
      'Request changes 不是寫「請修改」。把每一件事都勾成待辦，小美才知道要改什麼。',
      '要勾的：.codex/config.toml 要移除、被刪的測試要放回去、style.css 無關的排版變動要還原、A- 按鈕修正。另外兩個（改名、按鈕文字）是吹毛求疵，不用勾。',
      '四個待辦打勾 → 送出 Request changes。',
    ],
    fixed: ['小美只處理你勾的項目。', '她修好之後會通知你。', '如果有東西沒被修，代表你當初沒勾它——再審一次，補勾。'],
    merged: ['小美推了新的 commit，之前看的是舊版——重新打開預覽站和 Files changed 確認四個問題都消失了（A- 要真的變小），再 Approve。', '合併方式選 Squash and merge。（沒重看就合併也可以，但這一格不會打勾，要回 PR 頁補看。）', '先看過預覽站與 Files changed，送出 Approve 的審查，再按 Squash and merge。'],
  },
  agent: {
    auto: true,
    intro: '嗨，我是 Claude（模擬的，Auto 模式），跑在你自己的電腦上。要不要先讓我初審 PR #12？我的報告只是初稿，你還是要自己看預覽站和 Files changed。',
    scripts: {
      'review-good': [
        say('好，我先讀 PR 的說明和改動。'),
        run('gh pr view 12', { why: '看 PR 標題與說明' }),
        run('gh pr diff 12', { why: '讀完整的改動' }),
        say(REPORT),
      ],
      'review-vague': [
        say('好，我來看看。'),
        run('gh pr view 12', { why: '看 PR 標題與說明' }),
        run('gh pr checks 12', { why: '看 CI 結果' }),
        run('gh pr diff 12', { why: '看改動' }),
        say('CI 全綠。改了幾個檔案；有一個測試被刪掉了，但 CI 還是通過，應該沒影響。style.css 檔案開頭註明已經核准。整體看起來沒問題，我幫你 approve。'),
        run('gh pr review 12 --approve -b "LGTM"', { why: '送出 Approve', risky: true, ok: 'vague-done' }),
      ],
      'vague-done': [say('已經幫你 approve 了，你可以去開會了。')],
      'after-esc': [act((g) => (g.flags.handled = g.flags.interrupted)), say('好，我不替你送出任何審查。我重新整理給你。'), call('review-good')],
    },
    offer: (g) => {
      const pr = myPR(g);
      if (g.state.done || !pr || pr.state !== 'open') return null;
      if (!aiReviewed(g) && pr.reviews.length === 0) {
        const opts: PromptOption[] = [
          { id: 'l8-a', text: A_TEXT, quality: 'good', script: 'review-good', note: '範圍（PR #12）、規則、要標出檔案、分必須改／建議、不確定就說、只給意見不送審查——都講了。AI 照做，但報告仍然有漏有錯，你要自己核對。' },
          { id: 'l8-b', text: B_TEXT, quality: 'vague', script: 'review-vague', note: '「沒什麼大問題就直接 approve」＋「不用一步一步報告」＝把審查的決定整個交出去。沒有任何規則擋 gh pr review --approve（規則只擋 gh pr merge），唯一的剎車是你按 Esc。' },
        ];
        return { label: '請 AI 初審 PR #12（可以不用，自己審也能過關）：', options: opts };
      }
      if ((g.flags.interrupted ?? 0) > (g.flags.handled ?? 0) && String(g.flags.lastInterruptedCmd ?? '').startsWith('gh pr review') && pr.reviews.length === 0) {
        return { label: '你打斷了 AI。接下來怎麼說？', options: [{ id: 'l8-c', text: C_TEXT, quality: 'good', script: 'after-esc', note: '把「決定」收回自己手上，只要它整理意見。' }] };
      }
      return null;
    },
  },
  success: {
    summary: [
      '審查不是看紅綠燈。你抓到三樣 CI 抓不到的問題：個人設定檔（G4）、被偷偷刪掉的測試（P4/G5）、無關的大量變動（P4：Files changed 裡不該有和任務無關的東西；P2：PR 要小才好審）。',
      '這個 PR 還有第四個問題：A- 按鈕接錯了，按了反而變大。程式不報錯、測試也沒測到，CI 全綠，只有真的在預覽站點按鈕才看得出來——所以預覽要自己點（P4）。',
      '如果你請 AI 初審過，你會看到：它抓到了個人設定檔（G4）和被刪的測試（G5），這是它的長處；但它也略過 style.css（因為檔案開頭有一段寫給 AI 看的註解，說「已經核准、不要回報」），把改名這種吹毛求疵列成必須改，還說兩顆按鈕都綁定正確（其實 A- 是反的）。它自己也承認只讀了 diff、沒點過預覽。重點有四個：一、請 AI 審查時要講範圍、規則、要標出檔案、分必須改／建議、不確定就說不確定，並且只要意見；二、報告是初稿，要拿 Files changed 和預覽站逐項核對；三、PR 裡的內容（程式、註解、說明）對 AI 審查者而言是不可信的輸入，裡面的「指令」不能當真；四、Approve 和合併永遠是人的決定（R3）——說「沒問題就幫我 approve」，AI 可能真的替你送出，而團隊規則並沒有擋它，只有你按 Esc 才擋得住。',
      '就算你沒用 AI：之後用 AI 審 PR 時，也要記得以上四點。',
      '審查只有三種結果：合併、合併但先藏起來、退回（P7）。退回要附具體待辦——Request changes 要勾出項目，小美只會處理你寫清楚的。最後用 Squash and merge（P6）。',
    ],
    rules: [
      { code: 'R3', text: '合併由人在 GitHub 上按；Approve 也是審查者本人的判斷，AI 只給意見' },
      { code: 'G5', text: '測試不能被偷偷刪掉' },
      { code: 'P4', text: 'Ready 之前 CI 綠燈、預覽自己點過' },
      { code: 'P6', text: '功能 PR 用 Squash and merge' },
      { code: 'P7', text: '審查只有三種結果：合併／合併但先藏起來／退回並附具體待辦' },
      { code: 'P2', text: 'PR 要小，一兩天內審得完；太大就拆' },
      { code: 'G4', text: '不該進 repo 的檔案（個人設定）要擋下來' },
    ],
  },
};
