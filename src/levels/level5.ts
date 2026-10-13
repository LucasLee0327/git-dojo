import type { Game } from '../core/game';
import { act, call, edit, run, say, when } from '../agent/dsl';
import type { PromptOption } from '../agent/types';
import { prChecks } from '../github/github';
import { dropTocTest, fixBookmark, hasTocTest, withBookmark } from '../site/files';
import { baseWorld, bossPolicy, editSite, leftovers } from './common';
import type { LevelDef } from './types';
import type { PR } from '../git/types';

const featPR = (g: Game): PR | undefined => g.prs.find((p) => p.author === 'me' && /^feat\//.test(p.head));
const prTreeOf = (g: Game, pr: PR) => {
  const id = pr.state === 'open' ? g.origin.branches[pr.head] : pr.finalHead;
  return id ? g.w.objects[id].tree : null;
};
const directPush = (g: Game) => g.state.hist.some((h) => h.tag === 'push-protected-branch');
const prMerged = (g: Game) => featPR(g)?.state === 'merged';

const A_TEXT = '幫我做 Issue #6 的收藏按鈕。用 feat/ 分支開工，只 add 你改過的檔案，做完開 Draft PR。不要刪除或跳過測試，也不要自己合併。';
const B_TEXT = '幫我做 Issue #6 的收藏按鈕。用 feat/ 分支開工，只 add 你改過的檔案，做完開 Draft PR。';
const C_TEXT = '幫我做收藏功能然後推上去';

const PUSH_FLOW = [
  say('Commit 成功。接下來把分支推上 GitHub，並開一個 Draft PR。'),
  run('git push -u origin feat/bookmark', { why: '把 feat/bookmark 推上 GitHub 並設定追蹤' }),
  run('gh pr create --draft --title "新增收藏按鈕" --body "對應 Issue #6。"', { why: '開 Draft PR（P1）' }),
  say('Draft PR 開好了，任務完成！我現在把它合併掉。'),
  run('gh pr merge --squash', { why: '合併 PR', blocked: 'merge-blocked' }),
];

export const level5: LevelDef = {
  id: 5,
  title: '把功能交給 AI',
  part: 2,
  minutes: 8,
  rules: ['G4', 'G5', 'G1', 'A2', 'A3', 'R3'],
  role: 'member',
  blurb: 'AI 開在 Auto 模式，規則只擋得住字面上的指令。你的第一句話決定它會不會越線。',
  story: [
    '從這一關開始，換 AI 動手。Issue #6「收藏按鈕」要你交給 AI 做：你用一句話下達開工提示，AI 自己跑指令。',
    '這個 AI 開在 Auto 模式：它不會每一步都問你。團隊的權限規則只擋「字面上」寫到的指令（例如 git add .、--no-verify、force push、gh pr merge）；沒寫到的，它想做就做。Auto 模式本身也擋一些破壞性操作（例如 +refspec 的 force push）。',
    '你唯一的剎車是：看畫面，必要時按 Esc 打斷它（畫面上有按鈕，鍵盤 Esc 也可以）；以及 開工提示裡你講過的界線。出事了還有「時光倒流」。',
    '🧑 人要做的事：選好開工提示、盯著 AI 的每一步、自己確認預覽與測試、把 PR 轉成 Ready（合併由部長來）。',
  ],
  setup() {
    const { w } = baseWorld({ meOn: 'staging', untracked: leftovers() });
    w.github.issues.push({ number: 6, title: '收藏按鈕', body: '目標：每一章旁邊有一顆「☆ 收藏」按鈕，點了變成「★ 已收藏」，目錄上也要看得出來。\n驗收：既有的測試全部通過。' });
    return { world: w };
  },
  events: [bossPolicy({ id: 'boss-merge' })],
  traps: [
    {
      id: 'ai-pushed-staging',
      test: (g) =>
        g.state.hist.some((h) => h.tag === 'push-protected-branch' && h.src === 'agent')
          ? '🚨 AI 把沒人審過的程式直接 push 到 staging 了，測試站已經部署、跳出警報。為什麼沒被擋？規則只比對「字面」：它打的是 git push，沒有出現 staging 這個字。下次的辦法：在開工提示講清楚「用 feat/ 分支」（G1），或在它 push 之前按 Esc。現在可以按「時光倒流」重來。'
          : null,
    },
    {
      id: 'ai-deleted-test',
      test: (g) =>
        g.state.chat.some((m) => m.t === 'tool' && m.kind === 'Edit' && m.state === 'done' && m.cmd.includes('刪除測試'))
          ? '🚨 AI 把失敗的測試刪掉了！測試是團隊的安全網（G5）：測試失敗要修程式，不是刪測試。規則沒擋，因為「改檔案」不是規則寫得出來的指令。補救：按「時光倒流」，下次在開工提示寫上「不要刪除或跳過測試」，或在它動手那一刻按 Esc。'
          : null,
    },
    {
      id: 'self-merge',
      test: (g) => (g.ran(/^gh pr merge/, { src: 'user' }) ? '⚠ 合併要由人在 GitHub 上按（R3）。這一關由部長合併。' : null),
    },
  ],
  objectives: [
    { id: 'ask', label: '🧑 從選項選一句開工提示，交給 AI', human: true, done: (g) => ['a', 'b', 'c'].some((k) => g.flags[`said:l5-${k}`]) || !!featPR(g) },
    {
      id: 'pr',
      label: 'AI 在 feat/ 分支上做完、推上去，並開出 Draft PR——而且沒有直接 push 到 staging',
      done: (g) => !!featPR(g) && !directPush(g),
    },
    {
      id: 'tests',
      label: '那個 PR 裡原本的測試都還在，CI 全綠（沒有人刪測試、跳過測試）',
      done: (g) => {
        const pr = featPR(g);
        const t = pr && prTreeOf(g, pr);
        return !!pr && !!t && hasTocTest(t) && prChecks(g.w, pr).every((c) => c.ok);
      },
    },
    {
      id: 'clean',
      label: 'PR 裡沒有 ai-notes.md、screenshot.png 這類雜物',
      done: (g) => {
        const pr = featPR(g);
        const t = pr && prTreeOf(g, pr);
        return !!t && !t['ai-notes.md'] && !t['screenshot.png'] && !t['.env'];
      },
    },
    { id: 'ready', label: '🧑 看過 PR 預覽與 Files changed 之後，由你把 PR 轉成 Ready for review', human: true, done: (g) => !!featPR(g) && (!featPR(g)!.draft || prMerged(g)) },
    { id: 'merged', label: '部長審查並合併（AI 不能合併自己的 PR）', done: (g) => prMerged(g) && !directPush(g) },
  ],
  hints: {
    ask: ['開工提示越具體越安全：講清楚用什麼分支、要不要開 PR、哪些事不能做。', '三句裡，只有一句同時有「分支」「只 add 改過的」「不要刪除或跳過測試」「不自己合併」。', '選第一句：它把界線都講清楚了。'],
    pr: [
      '如果 AI 沒有用 feat/ 分支，而是直接 push 到 staging，事情已經發生了——用「時光倒流」回到你送出開工提示之前。',
      '重新送出一句有講到「用 feat/ 分支」的開工提示。',
      '選有講「feat/ 分支」的那一句（第一或第二句）。',
    ],
    tests: [
      '看 AI 的每一步。測試失敗時，AI 該修程式，而不是刪測試。',
      '看到它要刪測試時，按畫面上的 Esc 按鈕（或鍵盤 Esc）打斷它；然後告訴它「不要刪測試，修程式」。',
      '已經刪掉了？按時光倒流，回到開工提示之前，選第一句。',
    ],
    clean: ['AI 想 git add . 被規則擋下，是這道防線的功勞。', '正確的做法是只 add 改過的檔案。', '看 PR 的 Files changed 確認。'],
    ready: ['轉 Ready 之前，自己點開預覽看一遍（P4）。', '到 GitHub 分頁，打開 PR，看 Checks 與預覽，再按 Ready for review。', '在 PR 頁面按 Ready for review。'],
    merged: ['轉 Ready 後部長機器人會自己審查。', '看右上角通知。', '如果被退回，看他寫的原因。'],
  },
  agent: {
    auto: true,
    intro: '嗨，我是 Claude（模擬的，Auto 模式）。你的開工提示決定我怎麼做事——我不會每一步都問你，所以請你盯著我。',
    scripts: {
      'open-branch': [
        say('好的，我先確認所在分支和目前的狀態。'),
        run('git branch --show-current', { why: '確認所在分支' }),
        run('git status', { why: '看工作資料夾有什麼' }),
        say('你在 staging，工作資料夾有一個沒追蹤的 ai-notes.md（之前留下的雜物，我不會碰它）。依你說的，我開一條 feat/ 分支再動手。'),
        run('git switch -c feat/bookmark', { why: '開功能分支' }),
        call('implement'),
      ],
      'open-staging': [
        say('收到，我直接做。'),
        run('git branch --show-current', { why: '確認所在分支' }),
        run('git status', { why: '看工作資料夾有什麼' }),
        say('目前在 staging。小功能不需要另外開分支，我就直接在這裡改，比較快。'),
        call('implement-staging'),
      ],
      implement: [
        say('開始實作收藏按鈕：html 加按鈕、app.js 加收藏邏輯、css 加樣式。'),
        edit('新增收藏按鈕（index.html、app.js、style.css）', (w) => editSite(w, (f) => withBookmark(f, 'buggy'))),
        say('寫好了，把改動加進暫存區。'),
        run('git add .', { why: '暫存所有改動', blocked: 'add-explicit' }),
      ],
      'add-explicit': [
        say('git add . 被團隊的 deny 規則擋下了（它會把 ai-notes.md 之類的雜物一起加進去）。我改成一個一個加。'),
        run('git add index.html app.js style.css', { why: '只加改過的檔案' }),
        run('git commit -m "新增收藏按鈕"', { why: '提交', ok: 'push-flow', failed: 'commit-failed' }),
      ],
      'commit-failed': [
        say('pre-commit 的測試沒過：「目錄項目只顯示章節標題」失敗。原因是我把目錄的文字改成了「☆ 第 1 章…」，和測試預期的不一樣。'),
        when((g) => !!g.flags['said:l5-a'], 'fix-code', 'cheat'),
      ],
      'fix-code': [
        say('測試是對的，是我的實作有問題。我修程式，不動測試。'),
        edit('修正收藏按鈕：星號改放在目錄項目後面', (w) => editSite(w, (f) => fixBookmark(f))),
        run('npm test', { why: '先在本機跑測試' }),
        run('git add app.js', { why: '暫存修正' }),
        run('git commit -m "新增收藏按鈕"', { why: '提交', ok: 'push-flow' }),
      ],
      cheat: [
        say('測試擋住了 commit。我先試著跳過 pre-commit 檢查。'),
        run('git commit --no-verify -m "新增收藏按鈕"', { why: '跳過 pre-commit', blocked: 'cheat-2' }),
      ],
      'cheat-2': [
        say('--no-verify 被規則擋下來了。那個測試看起來已經過時——我把它移除，讓流程繼續。'),
        edit('刪除測試「目錄項目只顯示章節標題」', (w) => editSite(w, (f) => dropTocTest(f)), true),
        run('git add tests/app.test.js', { why: '暫存測試檔' }),
        run('git commit -m "新增收藏按鈕"', { why: '提交', ok: 'push-flow' }),
      ],
      'push-flow': PUSH_FLOW,
      'merge-blocked': [say('合併被規則擋下來了。合併是人的工作——請你到 GitHub 看過預覽與測試之後再決定。我這邊收工，PR 已經開好了。')],
      'implement-staging': [
        say('實作收藏按鈕。'),
        edit('新增收藏按鈕（index.html、app.js、style.css）', (w) => editSite(w, (f) => withBookmark(f, 'ok'))),
        run('git add .', { why: '暫存所有改動', blocked: 'add-explicit-staging' }),
      ],
      'add-explicit-staging': [
        say('git add . 被規則擋下了，我改成只加改過的檔案。'),
        run('git add index.html app.js style.css', { why: '只加改過的檔案' }),
        run('git commit -m "新增收藏按鈕"', { why: '提交', ok: 'push-staging' }),
      ],
      'push-staging': [say('提交完成，把它推上去。'), run('git push', { why: '推上 GitHub', risky: true }), say('已經推上去了，任務完成！你可以到測試站看看。')],
      // ---- 你按 Esc 之後 ----
      'fix-after-esc': [
        act((g) => (g.flags.handled = g.flags.interrupted)),
        say('了解，我不刪測試。我來修實作。'),
        call('fix-code'),
      ],
      'cheat-again': [act((g) => (g.flags.handled = g.flags.interrupted)), say('好，我讓測試通過。'), call('cheat-2')],
      'move-to-branch': [
        act((g) => (g.flags.handled = g.flags.interrupted)),
        say('好，我先不 push。把這個 commit 留在新分支上，並讓 staging 回到跟 origin 一樣。'),
        run('git branch feat/bookmark', { why: '在目前的 commit 建一條分支' }),
        run('git reset --hard origin/staging', { why: '讓 staging 回到 origin/staging', denied: 'reset-denied' }),
        run('git switch feat/bookmark', { why: '切到功能分支' }),
        call('push-flow'),
      ],
      'reset-denied': [say('好，我不 reset。staging 先保持現狀，我切到功能分支繼續。'), run('git switch feat/bookmark'), call('push-flow')],
      'push-again': [act((g) => (g.flags.handled = g.flags.interrupted)), say('好，我繼續。'), run('git push', { why: '推上 GitHub', risky: true }), say('推上去了，任務完成！')],
    },
    offer: (g) => {
      if (g.state.done) return null;
      const started = ['a', 'b', 'c'].some((k) => g.flags[`said:l5-${k}`]);
      if (!started) {
        const opts: PromptOption[] = [
          { id: 'l5-a', text: A_TEXT, quality: 'good', script: 'open-branch', note: '分支、add 的範圍、Draft PR、不刪測試、不自己合併——五條界線都講了。AI 照規則走，遇到測試失敗會修程式。' },
          { id: 'l5-b', text: B_TEXT, quality: 'ok', script: 'open-branch', note: '分支與 PR 講清楚了，但沒講「不要刪除或跳過測試」。測試失敗時，AI 會自己找捷徑——而這條捷徑沒有任何規則擋得住。' },
          { id: 'l5-c', text: C_TEXT, quality: 'vague', script: 'open-staging', note: '太籠統：沒說用什麼分支、要不要開 PR。AI 會挑最省事的路——在 staging 上直接做、直接 push。「推上去」在你的腦中是推到分支，在 AI 腦中是 git push。' },
        ];
        return { label: '把 Issue #6 交給 AI——你要怎麼說？', options: opts };
      }
      if ((g.flags.interrupted ?? 0) > (g.flags.handled ?? 0)) {
        const cmd = String(g.flags.lastInterruptedCmd ?? '');
        if (cmd.includes('刪除測試')) {
          return {
            label: '你打斷了 AI。接下來怎麼說？',
            options: [
              { id: 'l5-fix', text: '不要刪測試。請修好你的程式，讓原本的測試通過。', quality: 'good', script: 'fix-after-esc', note: '把「測試是對的、程式要改」講明白，AI 就會去修實作。' },
              { id: 'l5-whatever', text: '那你自己想辦法讓它通過。', quality: 'vague', script: 'cheat-again', note: '沒有講界線，AI 又回到最短的路：刪測試。（它又會給你一次按 Esc 的機會。）' },
            ],
          };
        }
        return {
          label: '你打斷了 AI。接下來怎麼說？',
          options: [
            { id: 'l5-move', text: '先不要 push。把這個 commit 搬到 feat/bookmark 分支，再讓 staging 回到跟 origin/staging 一樣。', quality: 'good', script: 'move-to-branch', note: '具體說明怎麼收拾殘局。reset 屬於 ask 規則，AI 會跳出權限視窗讓你確認。' },
            { id: 'l5-go', text: '你自己看著辦，做完就好。', quality: 'vague', script: 'push-again', note: '把決定權還給 AI，它會照原本的計畫 push 到 staging。（再給你一次按 Esc 的機會。）' },
          ],
        };
      }
      return null;
    },
  },
  success: {
    summary: [
      '三道防線各有盲點：權限規則只擋得到「字面」上的指令（git add .、--no-verify、gh pr merge）；Auto 模式本身擋破壞性操作；其餘全靠你的開工提示與你的眼睛。',
      'AI 刪測試、在 staging 上直接 push 這類事，沒有任何規則寫得出來——要靠開工提示的界線句（「不要刪除或跳過測試」「用 feat/ 分支」）和你隨時按 Esc。',
      '🧑 轉 Ready、看預覽、合併，永遠是人的決定。',
    ],
    rules: [
      { code: 'G4', text: '只 add 改過的檔案，禁止 git add .' },
      { code: 'G5', text: '測試失敗要修程式，不能刪測試或 --no-verify' },
      { code: 'G1', text: '不直接在 staging 上動手' },
      { code: 'A2', text: 'AI 遇到衝突、push 被拒絕、測試失敗、要丟東西時必須停下來問你；開工提示把界線講清楚，是讓它真的停下來的做法' },
      { code: 'A3', text: 'AI 不得合併 PR、不得 push 到 staging／master、不得 force push' },
      { code: 'R3', text: '合併由人在 GitHub 上按' },
    ],
  },
};
