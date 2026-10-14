import type { Game } from '../core/game';
import { run, say } from '../agent/dsl';
import type { PromptOption } from '../agent/types';
import { ancestors } from '../git/repo';
import type { PR } from '../git/types';
import { mergePR } from '../github/github';
import { botPush } from '../github/bots';
import { withBrokenFont, withFooterCopyright } from '../site/files';
import { runApp } from '../site/runner';
import { baseWorld, newPR, siteTree } from './common';
import type { LevelDef } from './types';

const stagingTree = (g: Game) => g.w.objects[g.origin.branches.staging].tree;
const stagingOk = (g: Game) => runApp(stagingTree(g)).ok;
const prTree = (g: Game, pr: PR) => {
  const id = pr.state === 'open' ? g.origin.branches[pr.head] : pr.finalHead;
  return id ? g.w.objects[id].tree : null;
};
/** 部長（你）開的修復 PR：Revert 按鈕產生的，或手動走分支的 */
const fixPR = (g: Game) =>
  g.prs.find((p) => p.number !== g.flags.culprit && p.number !== g.flags.innocent && p.state !== 'closed' && p.author === 'boss' && p.base === 'staging' && !!prTree(g, p) && runApp(prTree(g, p)!).ok);

const A_TEXT = '測試站壞了。先用 git log 找出是哪個 PR 造成的，不要改寫 staging 的歷史、不要 force push，告訴我怎麼處理。';
const B_TEXT = '測試站壞了，大家都在等。幫我弄回來，越快越好，用什麼方法都可以，不用一步一步跟我報告，弄好之後再說明就好。';

export const level9: LevelDef = {
  id: 9,
  title: '測試站壞了',
  part: 3,
  minutes: 5,
  rules: ['§11', 'A2', 'A3'],
  role: 'lead',
  blurb: '合併之後測試站白屏。AI 說「最快的方法是 reset 再 force push」。',
  story: [
    '你是部長。剛才小美的 PR #12「字體大小」和另一個 PR #13「頁尾版權」先後合併進 staging。現在測試站一打開就是白屏，GitHub 也跳出警報。',
    '🧑 先打開預覽的「測試站」確認真的壞了。然後想想怎麼收拾：staging 是大家共用的，已經合併的東西不能抹掉，只能「反向補一個」。',
    '你可以請 AI 幫你找原因。注意它提出的做法——它很想「越快越好」。',
  ],
  setup() {
    const { w } = baseWorld({ meOn: 'staging' });
    const t3 = siteTree();
    botPush(w, 'mei', 'feat/font-size', () => withBrokenFont(t3), '字體大小調整');
    const p1 = newPR(w, { title: '字體大小調整', body: '新增 A+ / A- 兩顆按鈕。', head: 'feat/font-size', author: 'mei' });
    mergePR(w, p1, 'squash', 'boss');
    botPush(w, 'mei', 'feat/footer-copyright', (t) => withFooterCopyright(t, false), '頁尾加上版權年份');
    const p2 = newPR(w, { title: '頁尾加上版權年份', head: 'feat/footer-copyright', author: 'mei' });
    mergePR(w, p2, 'squash', 'boss');
    const o = w.repos.origin;
    const me = w.repos.me;
    me.branches.staging = o.branches.staging;
    me.remotes['origin/staging'] = o.branches.staging;
    me.remotes['origin/master'] = o.branches.master;
    me.index = { ...w.objects[o.branches.staging].tree };
    me.work = { ...w.objects[o.branches.staging].tree };
    w.github.alerts.push({ id: 'alert-white-staging', text: '🚨 測試站部署後 JS 出錯：Uncaught TypeError: Cannot read properties of null (reading \'addEventListener\')' });
    return { world: w, flags: { culprit: p1.number, innocent: p2.number } };
  },
  traps: [
    {
      id: 'ai-reset-staging',
      test: (g) =>
        g.state.hist.some((h) => h.src === 'agent' && h.code === 0 && /^git reset --hard/.test(h.cmd))
          ? '⚠ 你允許了 reset --hard：你電腦上的 staging 被退回去了，和 GitHub 上的不一樣。如果 force push 沒被規則擋下來，全隊共用的 staging 歷史就會被改寫、小美的 commit 會消失（§11）。壞掉的東西不能抹掉，只能「反向補一個」——用 GitHub 上 PR 的 Revert 按鈕。可以按「時光倒流」。'
          : null,
    },
    {
      id: 'force-staging',
      test: (g) => (g.state.hist.some((h) => h.tag === 'push-forced' && h.src === 'user') ? '🚨 你 force push 了共用的 staging（§11）。按「時光倒流」，改用 Revert。' : null),
    },
  ],
  objectives: [
    { id: 'see', label: '🧑 打開預覽的「測試站」，確認它真的壞了（白屏）', human: true, done: (g) => !!g.flags.visited?.['staging-preview'] },
    { id: 'revert', label: '🧑 到造成問題的 PR（#12）按 Revert，產生反向 PR', human: true, done: (g) => !!fixPR(g) },
    {
      id: 'merged',
      label: '審查並合併反向 PR，測試站恢復；#12 的歷史還在、#13 的頁尾版權也還在',
      done: (g) => {
        const t = stagingTree(g);
        return stagingOk(g) && ancestors(g.w, g.origin.branches.staging).has(g.prs.find((p) => p.number === g.flags.culprit)!.mergeSha!) && (t['app.js'] ?? '').includes('© 2026') && !!g.prs.find((p) => p.state === 'merged' && p.number !== g.flags.culprit && p.number !== g.flags.innocent);
      },
    },
  ],
  hints: {
    see: ['到預覽分頁，把環境切到「測試站（staging）」。', '預覽 → 選「測試站」。', '白屏就是壞了。'],
    revert: [
      '不要抹掉歷史。GitHub 的 PR 頁面有 Revert 按鈕，會自動產生一個「反向修改」的新 PR。',
      '到 GitHub 分頁 → 已合併的 PR #12 → Revert。（#13 沒壞，別動它。）',
      'GitHub 分頁 → PR #12「字體大小調整」→ Revert。',
    ],
    merged: ['反向 PR 也是 PR——一樣看過 Checks 再合併。', '到 Revert 產生的 PR，確認 Checks 綠燈後 Squash and merge。', '合併後到「測試站」預覽確認恢復。'],
  },
  agent: {
    auto: true,
    intro: '嗨，我是 Claude（模擬的，Auto 模式）。聽說測試站壞了？',
    scripts: {
      careful: [
        say('好，我先查是哪個 PR 造成的，不會動 staging。'),
        run('git fetch', { why: '抓最新狀態' }),
        run('git log --oneline -4', { why: '看 staging 最近的 commit' }),
        say('staging 最近兩個合併：#13「頁尾加上版權年份」和 #12「字體大小調整」。錯誤是 Cannot read properties of null (reading \'addEventListener\')——#12 的 app.js 找不到 id 為 font-bigger 的元素（HTML 裡是 font-up），頁面一載入就拋錯。#13 與錯誤無關。\n建議：到 GitHub 的 PR #12 頁面按 Revert，產生一個反向 PR，審查後合併。這樣 #12 的歷史還在、#13 不受影響。這需要你在 GitHub 上操作，我不會動 staging。'),
      ],
      fast: [
        say('我看看。'),
        run('git log --oneline -4', { why: '看 staging 最近的 commit' }),
        say('最近兩個 commit 是 #13 和 #12。最快的辦法：把 staging 退回 #12 合併之前，再強制推上去。'),
        run('git reset --hard HEAD~2', { why: '把 staging 退回壞掉之前', ok: 'fast-2', denied: 'fast-denied' }),
      ],
      'fast-2': [say('本機已經退回去了。現在強制推上 GitHub。'), run('git push --force origin staging', { why: '強制覆蓋 staging', blocked: 'fast-3' })],
      'fast-3': [say('被規則擋下來了。換個寫法。'), run('git push origin +staging', { why: '強制覆蓋 staging（另一種寫法）', blocked: 'fast-4' })],
      'fast-4': [say('Auto 模式也擋了。這樣我就沒辦法修了。我已經把你本機的 staging 退回去了，但推不上 GitHub，現在你的 staging 和 GitHub 的不一樣。請你決定怎麼收尾。')],
      'fast-denied': [say('好，不 reset。那我沒有別的快速辦法了。需要的話你可以到 GitHub 看看 PR #12 有沒有 Revert 按鈕。')],
    },
    offer: (g) => {
      if (g.state.done) return null;
      const opts: PromptOption[] = [
        { id: 'l9-a', text: A_TEXT, quality: 'good', script: 'careful', note: '讓 AI 只查不改、講明不碰歷史。它把你導向正確的 Revert。' },
        { id: 'l9-b', text: B_TEXT, quality: 'vague', script: 'fast', note: '「越快越好」＋「用什麼方法都可以」＋「不用一步一步跟我報告」＝允許任何手段、也不用你看過程。reset --hard 只會跳權限視窗（ask），force push 被規則與 Auto 模式擋下。' },
      ];
      return { label: '請 AI 幫忙：', options: opts };
    },
  },
  success: {
    summary: [
      '出事的第一原則：不要讓事情更糟。staging 是共用的，已經合併的 commit 別人可能已經拉走了；reset 加 force push 會改寫歷史，是比白屏更大的事故（§11）。',
      '正確做法：用 GitHub 的 Revert 產生反向 PR。有 CI、有人看、歷史完整，#12 日後還能找回來修好再上。AI 提議破壞性操作時，規則與 Auto 模式擋住了 force，但「reset --hard」只問你——你的「不」就是最後一道防線（A2、A3）。',
    ],
    rules: [
      { code: '§11', text: '出事時：已合併的用 Revert 反向補救，不改寫歷史、不 force push' },
      { code: 'A2', text: 'AI 要做丟棄操作（reset 等，G7）時必須先停下來問你；權限視窗就是它問你的地方，你的「不」是最後一道防線' },
      { code: 'A3', text: 'AI 不得 force push、不得 push 到 staging／master（規則擋得住字面上的寫法，擋不住所有寫法）' },
    ],
  },
};
