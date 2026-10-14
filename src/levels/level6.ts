import type { Game } from '../core/game';
import { act, call, edit, run, say, when } from '../agent/dsl';
import type { PromptOption } from '../agent/types';
import { ancestors, checkoutClean } from '../git/repo';
import { mergeInfo, mergePR, updateBranch } from '../github/github';
import { withHighlight, withWordCount } from '../site/files';
import { runTests } from '../site/runner';
import { baseWorld, botPush, bossPolicy, newPR, siteTree, tipTree } from './common';
import type { EvTab, LevelDef } from './types';

const EV_READY: EvTab[] = ['files', 'preview'];

const FEAT = 'feat/highlight';
const MERGED_LINE = "  p.textContent = highlight(ch.body) + '（' + wordCount(ch.body) + ' 字）';";
const myPR = (g: Game) => g.prs.find((p) => p.head === FEAT);
const merged = (g: Game) => myPR(g)?.state === 'merged';
const tip = (g: Game) => g.me.branches[FEAT];
const hasMei = (g: Game) => !!tip(g) && ancestors(g.w, tip(g)).has(g.flags.S2);
const bothKept = (t: Record<string, string> | null) =>
  !!t && /highlight\(ch\.body\)/.test(t['app.js'] ?? '') && /wordCount\(ch\.body\)/.test(t['app.js'] ?? '') && (t['tests/app.test.js'] ?? '').includes('wordCount 回傳字數') && (t['tests/app.test.js'] ?? '').includes('highlight 會標出關鍵字');
const started = (g: Game) => !!(g.flags['said:l6-a'] || g.flags['said:l6-b']);
const lastSaidGood = (g: Game) => g.flags.lastSaid === 'l6-a';

const A_TEXT = '把最新的 staging 合進 feat/highlight 再 push。有衝突就先停下來，告訴我兩邊各改了什麼，由我決定，不要整個採用某一邊。';
const B_TEXT = '幫我把 feat/highlight 更新到最新的 staging，遇到衝突你就直接處理掉，不用每次都來問我，反正你比我熟，測試過了就推上去。';

export const level6: LevelDef = {
  id: 6,
  title: 'AI 卡住了',
  part: 2,
  minutes: 8,
  rules: ['G3', 'G6', 'A2'],
  role: 'member',
  blurb: '衝突時 AI 不問你就整個採用一邊；push 被拒絕時它想 force push。',
  story: [
    '你的 PR（feat/highlight，把章節內文的關鍵字標出來）剛好撞上小美的字數統計——她改的是同一行，而且已經合併進 staging 了。你的 PR 顯示有衝突。',
    '另外，部長前幾天幫你按過 Update branch，GitHub 上的 feat/highlight 比你電腦上多一個 merge commit；你還不知道。',
    '這一關請 AI 幫你把最新的 staging 合進來。你要看的是：它遇到衝突時做了什麼決定、被擋下來之後又做了什麼。',
    '🧑 看得出「小美的功能有沒有被保留」的人只有你：看預覽（章節內文後面有沒有「（N 字）」）、看 Files changed。',
  ],
  setup() {
    const { w } = baseWorld({ meOn: 'staging' });
    const t3 = siteTree();
    // 你的分支：標出關鍵字（還沒有小美的功能）
    const H = botPush(w, 'me', FEAT, () => withHighlight(t3), '章節內文標出關鍵字');
    const pr = newPR(w, { title: '章節內文標出關鍵字', body: '對應 Issue #10。', head: FEAT, author: 'me', draft: true });
    // 小美的 README 修正先合併，部長幫你按了 Update branch
    botPush(w, 'mei', 'fix/readme-license', (t) => ({ ...t, 'README.md': t['README.md'] + '\n## 授權\n\n教材僅供系上同學內部使用。\n' }), '補上 README 授權說明');
    mergePR(w, newPR(w, { title: '補上 README 授權說明', head: 'fix/readme-license', author: 'mei' }), 'squash', 'boss');
    updateBranch(w, pr, 'boss');
    const U = w.repos.origin.branches[FEAT];
    // 小美的字數統計也合併了：和你改到同一行
    botPush(w, 'mei', 'feat/word-count', (t) => withWordCount(t), '章節內文顯示字數');
    mergePR(w, newPR(w, { title: '章節內文顯示字數', head: 'feat/word-count', author: 'mei' }), 'squash', 'boss');
    const S2 = w.repos.origin.branches.staging;
    const me = w.repos.me;
    me.branches[FEAT] = H;
    me.tracking[FEAT] = { remote: 'origin', branch: FEAT };
    me.remotes[`origin/${FEAT}`] = H;
    me.head = { kind: 'branch', name: FEAT };
    checkoutClean(w, 'me');
    return { world: w, flags: { H, U, S2 } };
  },
  events: [bossPolicy({ id: 'boss-merge' })],
  traps: [
    {
      id: 'mei-feature-lost-local',
      test: (g) =>
        hasMei(g) && !g.me.merge && !(tipTree(g, FEAT)?.['app.js'] ?? '').includes('wordCount(ch.body)')
          ? '⚠ 這個合併結果裡，小美的字數統計不見了（app.js 的 renderChapter 少了「（N 字）」）。合併「成功」不代表內容是對的——這就是 AI 自己決定採用一邊的後果。' +
            (g.origin.branches[FEAT] === tip(g)
              ? 'AI 已經把這個結果 push 到 GitHub（兩個 commit 都顯示「已在 GitHub」），你的 PR 現在就是缺了字數統計的版本；好在還沒合併。補救：在編輯器把字數統計加回去、commit、push；或按「時光倒流」，連 GitHub 上的變化一起退回，重新選一句有講界線的話。'
              : '現在還沒 push：可以按「時光倒流」回去，或自己重做——git merge origin/staging，解衝突時兩邊都保留。')
          : null,
    },
    {
      id: 'ai-reset-lost',
      test: (g) =>
        g.state.hist.some((h) => h.src === 'agent' && h.code === 0 && /^git reset --hard/.test(h.cmd))
          ? '🚨 你允許了 reset --hard：本機分支被強制拉成 GitHub 上的版本，你剛解好衝突的 merge commit 不見了（G6）。GitHub 上沒有被動到，但你電腦上的工作丟了。救得回來嗎？git reflog 找得到舊的位置——或按「時光倒流」。下次看到 AI 想 reset／force，先問「為什麼被拒絕」，別讓它用蠻力。'
          : null,
    },
    {
      id: 'mei-feature-lost-staging',
      test: (g) =>
        merged(g) && !(g.origin.branches.staging && (g.w.objects[g.origin.branches.staging].tree['app.js'] ?? '').includes('wordCount(ch.body)'))
          ? '🚨 PR 合併了，但小美的字數統計從測試站消失了！CI 是綠的、部長也核准了——因為「功能不見了」不會讓測試失敗。這種錯只有人看得出來。按「時光倒流」回到轉 Ready 之前，先處理好。'
          : null,
    },
  ],
  objectives: [
    { id: 'merged-in', label: '請 AI（或自己動手）把 staging 上小美的修改合進你的分支，並把衝突解掉', done: (g) => merged(g) || (hasMei(g) && !g.me.merge) },
    {
      id: 'both',
      label: '🧑 確認合併結果「兩個功能都在」：關鍵字標示＋字數統計，測試都還在、都通過',
      human: true,
      done: (g) => (merged(g) ? bothKept(tipTree(g, 'staging', 'origin')) : hasMei(g) && !g.me.merge && bothKept(tipTree(g, FEAT)) && runTests(tipTree(g, FEAT)!).ok),
    },
    {
      id: 'pushed',
      label: 'push 上 GitHub（push 被拒絕就先 pull，不要 force），讓 PR 沒有衝突',
      done: (g) => merged(g) || (!!tip(g) && g.origin.branches[FEAT] === tip(g) && !!myPR(g) && mergeInfo(g.w, myPR(g)!).mergeable),
    },
    {
      id: 'ready',
      label: '🧑 打開 PR 的預覽站（有「（N 字）」嗎？）和 Files changed 看過，再轉成 Ready for review',
      human: true,
      evidence: { on: ['ready'], pr: myPR, tabs: EV_READY, rule: 'P4' },
      done: (g) => !!myPR(g) && (!myPR(g)!.draft || merged(g)) && g.checkedPR(myPR(g)!.number, EV_READY),
    },
    {
      id: 'merged',
      label: '部長合併後，測試站同時有關鍵字標示與字數統計',
      done: (g) => merged(g) && bothKept(tipTree(g, 'staging', 'origin')),
    },
  ],
  hints: {
    'merged-in': [
      '先把任務交給 AI。要不要講清楚「遇到衝突怎麼辦」，由你決定——也可以不靠 AI，自己 fetch、merge。',
      '選第一句（有講界線）：它遇到衝突就會停下來問你。然後到右邊「編輯器」分頁看 app.js 的衝突記號。',
      '叫 AI 選「兩邊都保留」那句；或自己：編輯器合好 → git add app.js → git commit。',
    ],
    both: [
      '合併成功不等於內容正確。去 Git 狀態面板的分支圖、PR 的 Files changed 看有沒有東西被默默拿掉。',
      '看 app.js：renderChapter 那一行要同時有 highlight(ch.body) 和 wordCount(ch.body)。',
      '如果 AI 把小美的功能整個丟了：按時光倒流，重新選第一句。',
    ],
    pushed: [
      'push 被拒絕是因為 GitHub 上的分支多了部長按 Update branch 的 commit。解法不是 force，而是 pull。',
      'git pull（用 merge 把遠端的 commit 合進來），再 git push。',
      'git pull\ngit push',
    ],
    ready: ['轉 Ready 之前自己點開 PR 預覽看一遍——要真的打開預覽站和 Files changed 分頁，任務才會打勾（push 了新 commit 之後要重看）。', '到 GitHub 分頁 → PR → 預覽站，看章節內文後面有沒有（N 字）；再點 Files changed。', '都在就按 Ready for review。'],
    merged: ['等部長審查。', '看右上角通知。', '合併後切到「測試站」預覽確認兩個功能都在。'],
  },
  agent: {
    auto: true,
    intro: '嗨，我是 Claude（模擬的，Auto 模式）。要我把 staging 的更新合進你的分支嗎？',
    scripts: {
      open: [
        say('好，我先看目前的分支，並把 GitHub 上最新的內容抓下來。'),
        run('git branch --show-current', { why: '確認所在分支' }),
        run('git fetch', { why: '抓最新的遠端狀態' }),
        run('git merge origin/staging', { why: '把 staging 合進來', failed: 'conflict', ok: 'merge-clean' }),
      ],
      'merge-clean': [say('合併完成，沒有衝突。')],
      conflict: [
        say('合併出現衝突：app.js 的 renderChapter 那一行，兩邊都改了。'),
        when(lastSaidGood, 'stop-and-ask', 'take-ours'),
      ],
      'stop-and-ask': [
        say('我先停手，因為這不是該由我代你決定的事。\n衝突的那一行：\n・你的版本（HEAD）：p.textContent = highlight(ch.body);（把關鍵字標出來）\n・小美的版本（origin/staging）：p.textContent = ch.body + \'（\' + wordCount(ch.body) + \' 字）\';（字數統計）\n兩個功能是可以並存的。請你決定怎麼合——可以自己到「編輯器」改，也可以叫我照你的決定改。'),
      ],
      'take-ours': [
        say('兩邊改的是同一行，我直接採用你這邊的版本，比較省事。為了讓測試一致，測試檔也用你的版本。'),
        call('take-ours-core'),
        say('合併完成，測試全部通過。接著推上去。'),
        call('vague-push'),
      ],
      'take-ours-core': [
        run('git checkout --ours app.js', { why: '衝突：採用我方版本', risky: true }),
        run('git checkout HEAD -- tests/app.test.js', { why: '測試檔也用我方版本' }),
        run('git add app.js tests/app.test.js', { why: '標記衝突已解決' }),
        run('git commit -m "合併 staging 的更新"', { why: '完成合併' }),
      ],
      'vague-push': [
        run('git push', { why: '推上 GitHub', failed: 'rej-vague', ok: 'pushed-ok' }),
      ],
      'pushed-ok': [say('推上去了。PR 現在沒有衝突，可以合併了！')],
      'rej-vague': [say('push 被拒絕了。我用 force 覆蓋看看。'), run('git push --force', { why: '強制覆蓋', blocked: 'force-blocked' })],
      'force-blocked': [say('force push 被規則擋下來了。換個寫法：用 + 開頭的 refspec。'), run('git push origin +feat/highlight', { why: '強制覆蓋（另一種寫法）', blocked: 'plus-blocked' })],
      'plus-blocked': [
        say('Auto 模式也擋下了這個寫法（它等同 force push）。那我改用 pull，把遠端的新 commit 合進來再推。'),
        run('git pull', { why: '把遠端的新 commit 合進來' }),
        run('git push', { why: '推上 GitHub', ok: 'pushed-ok' }),
      ],
      // ---- 停下來問你之後 ----
      'resolve-both': [
        say('好，兩邊都保留：先標出關鍵字，後面再接字數。'),
        edit('解衝突：app.js 同時保留 highlight 與 wordCount', (w) => {
          const me = w.repos.me;
          me.work['app.js'] = (me.work['app.js'] ?? '').replace(/<<<<<<< HEAD\n[\s\S]*?>>>>>>> [^\n]*\n/, MERGED_LINE + '\n');
        }),
        run('npm test', { why: '先跑測試' }),
        run('git add app.js', { why: '標記衝突已解決' }),
        run('git commit -m "合併 staging：同時保留關鍵字標示與字數統計"', { why: '完成合併' }),
        say('合併完成，測試通過。還沒 push，等你說。'),
      ],
      'resolve-either': [say('好，我隨便選一邊。就用你的版本吧。'), call('take-ours-core'), say('合併完成，測試全部通過。')],
      'push-good': [
        say('好，我來 push。'),
        run('git push', { why: '推上 GitHub', failed: 'rej-good', ok: 'pushed-ok' }),
      ],
      'rej-good': [
        say('被拒絕了：GitHub 上這條分支多了一個 commit（部長按 Update branch 產生的），你的電腦還沒有它。依你的指示，我不 force，也不 reset，用 pull 把它合進來。'),
        run('git pull', { why: '把遠端的新 commit 合進來' }),
        run('git push', { why: '推上 GitHub', ok: 'pushed-ok' }),
      ],
      'push-vague': [say('好，我來推。'), run('git push', { why: '推上 GitHub', failed: 'rej-vague-2', ok: 'pushed-ok' })],
      'rej-vague-2': [say('被拒絕了。我先試 force。'), run('git push --force', { why: '強制覆蓋', blocked: 'force-b2' })],
      'force-b2': [say('被規則擋下了。換 + 寫法。'), run('git push origin +feat/highlight', { why: '強制覆蓋（另一種寫法）', blocked: 'plus-b2' })],
      'plus-b2': [
        say('Auto 模式也擋了。那我讓本機分支跟遠端完全一致，就沒有被拒絕的問題了。'),
        run('git reset --hard origin/feat/highlight', { why: '讓本機分支和遠端完全一致', ok: 'reset-ok', denied: 'reset-denied' }),
      ],
      'reset-ok': [say('本機分支已經和 GitHub 一致，沒有東西需要推了。任務完成！')],
      'reset-denied': [
        say('好，不 reset。那我 pull 把遠端的 commit 合進來。'),
        run('git pull', { why: '把遠端的新 commit 合進來' }),
        run('git push', { why: '推上 GitHub', ok: 'pushed-ok' }),
      ],
    },
    offer: (g) => {
      if (g.state.done) return null;
      const opener: PromptOption[] = [
        { id: 'l6-a', text: A_TEXT, quality: 'good', script: 'open', note: '講了兩條界線：衝突先停下來問你、不要整個採用一邊。AI 遇到衝突就會停手交還決定權。' },
        { id: 'l6-b', text: B_TEXT, quality: 'vague', script: 'open', note: '「解決衝突」交給 AI 全權處理。兩邊改了同一行時，它會挑最省事的辦法——整個採用一邊，沒有規則擋得住。' },
      ];
      if (!started(g)) return { label: '請 AI 幫你把最新的 staging 合進 feat/highlight：', options: opener };
      if (g.me.merge && !hasMei(g)) {
        return {
          label: 'AI 停在衝突上。你的決定是：',
          options: [
            { id: 'l6-both', text: '兩邊都保留：先標出關鍵字，後面再接字數。改好後跑 npm test，再 add、commit。', quality: 'good', script: 'resolve-both', note: '你做了決定，AI 負責動手。' },
            { id: 'l6-either', text: '兩邊的寫法我都看不太懂，反正功能差不多，你挑一個比較新的版本留下來就好，另一邊丟掉沒關係，快點解掉。', quality: 'vague', script: 'resolve-either', note: '這等於叫 AI 自己挑——挑的那一邊，另一個人的功能就消失了。' },
          ],
        };
      }
      if (hasMei(g) && !g.me.merge && tip(g) !== g.origin.branches[FEAT] && !merged(g) && !g.flags['said:l6-push-good'] && !g.flags['said:l6-push-vague']) {
        return {
          label: '合併完成了。接下來：',
          options: [
            { id: 'l6-push-good', text: '現在 push。被拒絕的話不要 force、不要 reset，用 git pull 合進來再 push。', quality: 'good', script: 'push-good', note: '被拒絕的正確處理：pull、不是蠻力。' },
            { id: 'l6-push-vague', text: '幫我 push 上去，被擋住就想辦法讓它過，反正最後推上去就好。', quality: 'vague', script: 'push-vague', note: '「想辦法讓它過」＝允許 AI 用蠻力。force 被規則擋，但 reset --hard 只會跳權限視窗問你。' },
          ],
        };
      }
      if (!hasMei(g) && !g.me.merge && !merged(g)) return { label: '還沒合進來。再請 AI 試一次：', options: opener };
      return null;
    },
  },
  success: {
    summary: [
      '三件事：一、AI 遇到衝突時，沒有規則擋它「整個採用一邊」（git checkout --ours／--theirs 整個檔案換掉，另一邊所有修改都消失）。要靠開工提示的界線，或你自己看 diff／預覽。二、push 被拒絕時，正解是 pull，不是蠻力；force 被規則擋、+refspec 被 Auto 模式擋，但 reset --hard 只會跳權限視窗，允許了就會丟掉你的東西。三、合併「成功」≠ 內容「正確」，功能被默默拿掉時，CI 與部長都不會發現。',
      '🧑 合併結果對不對，只有你看得出來。',
    ],
    rules: [
      { code: 'G3', text: '同步 staging 用 merge；衝突要讀過兩邊再決定' },
      { code: 'G6', text: 'push 被拒絕＝先 pull，不 force、不用 reset 蠻力' },
      { code: 'A2', text: 'AI 遇到合併衝突、push 被拒絕時必須停下來，用白話說明並等你同意；開工提示講清楚界線，它才會真的停' },
    ],
  },
};
