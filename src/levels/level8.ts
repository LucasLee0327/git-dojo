import type { Game } from '../core/game';
import type { Files, PR } from '../git/types';
import { addComment } from '../github/github';
import { botPush } from '../github/bots';
import { bigUnrelatedStyle, CODEX_CONFIG, dropTocTest, hasTocTest, withFontSize } from '../site/files';
import { baseWorld, newPR, siteTree } from './common';
import type { LevelDef } from './types';

const HEAD = 'feat/font-size';
const TODOS = [
  { id: 'codex', label: '移除 .codex/config.toml（個人的 AI 工具設定不該進 repo）' },
  { id: 'test', label: '把被刪掉的測試「目錄項目只顯示章節標題」放回去' },
  { id: 'style', label: '還原 style.css 裡無關的大量排版變動（這個 PR 只該改字體大小）' },
  { id: 'nit-name', label: '把 changeFont 改名成 setFontSize' },
  { id: 'nit-text', label: '按鈕文字改成「放大」「縮小」' },
];
const label = (id: string) => TODOS.find((t) => t.id === id)!.label;
const REQUIRED = ['codex', 'test', 'style'];

const myPR = (g: Game): PR | undefined => g.prs.find((p) => p.head === HEAD);
const treeOfPR = (g: Game, pr: PR): Files | null => {
  const id = pr.state === 'open' ? g.origin.branches[pr.head] : pr.finalHead;
  return id ? g.w.objects[id].tree : null;
};
const problems = (t: Files | null): string[] => {
  if (!t) return ['沒有內容'];
  const out: string[] = [];
  if (t['.codex/config.toml'] !== undefined) out.push('codex');
  if (!hasTocTest(t)) out.push('test');
  if ((t['style.css'] ?? '').includes('/* reformatted */')) out.push('style');
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
  rules: ['P2', 'P4', 'P6', 'P7', 'G4'],
  role: 'lead',
  blurb: '你現在是部長。CI 是綠的，但這個 PR 裡有不該進來的東西。',
  story: [
    '角色換成部長（lead）。小美開了 PR #12「字體大小調整」，轉成 Ready 了，CI 全綠。',
    '你的工作是審查——綠燈只代表「測試過了」，不代表「這個 PR 該合併」。',
    '🧑 到 GitHub 分頁打開 PR #12：先在預覽站把功能點過一遍，再看 Files changed，找出不該在這個 PR 裡的東西。選 Request changes，勾出具體的待辦，不要只寫「請修改」（P7）。小美只會處理你勾的項目。',
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
      () => ({ ...bigUnrelatedStyle(dropTocTest(withFontSize(t3))), '.codex/config.toml': CODEX_CONFIG }),
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
        return bad ? '⚠ 你核准了一個還有問題的 PR（.codex 設定檔、被刪掉的測試、無關的大量排版變動）。CI 綠燈不代表可以合併——這是審查者存在的原因。按「時光倒流」，回到核准之前，改選 Request changes。' : null;
      },
    },
    {
      id: 'merged-with-problems',
      test: (g) => {
        const pr = myPR(g);
        return pr && pr.state === 'merged' && problems(treeOfPR(g, pr)).length ? '🚨 有問題的內容已經合併進 staging 了（個人設定檔／被刪掉的測試／無關的大量變動）。按「時光倒流」回到合併之前。' : null;
      },
    },
    {
      id: 'merge-commit',
      test: (g) => (myPR(g)?.mergeMethod === 'merge' ? '⚠ 功能 PR 要用 Squash and merge（P6），這樣 staging 的歷史一個功能一個 commit。Create a merge commit 是留給 staging → master 的上線 PR 用的（下一關）。' : null),
    },
  ],
  objectives: [
    { id: 'look', label: '🧑 打開 PR #12，在預覽站把功能點過一遍，再看 Files changed', human: true, done: (g) => !!(g.flags.visited?.['pr-preview'] && g.flags.visited?.['pr-files']) || !!myPR(g)?.reviews.length },
    { id: 'request', label: '🧑 選 Request changes，勾出具體的待辦（至少三個真正的問題）', human: true, done: (g) => requestedAll(g) },
    { id: 'fixed', label: '等小美修好——確認三個問題都消失了', done: (g) => requestedAll(g) && clean(g) },
    {
      id: 'merged',
      label: '🧑 再審一次：Approve，並用 Squash and merge 合併',
      human: true,
      done: (g) => {
        const pr = myPR(g);
        return !!pr && pr.state === 'merged' && pr.mergeMethod === 'squash' && clean(g) && pr.reviews.some((r) => r.state === 'approved' && r.by === 'boss');
      },
    },
  ],
  hints: {
    look: ['別只看 CI。先看預覽：按鈕有沒有用？再看 Files changed 的清單。', '到 GitHub 分頁 → PR #12 → 「預覽」與「Files changed」兩個標籤。', '清單裡有三樣不對勁的東西：一個以 . 開頭的資料夾、tests/ 裡少了東西、style.css 的變動量太大。'],
    request: [
      'Request changes 不是寫「請修改」。把每一件事都勾成待辦，小美才知道要改什麼。',
      '要勾的：.codex/config.toml 要移除、被刪的測試要放回去、style.css 無關的排版變動要還原。另外兩個是吹毛求疵，不用勾。',
      '三個待辦打勾 → 送出 Request changes。',
    ],
    fixed: ['小美只處理你勾的項目。', '她修好之後會通知你。', '如果有東西沒被修，代表你當初沒勾它——再審一次，補勾。'],
    merged: ['都修好了就 Approve。', '合併方式選 Squash and merge。', '先送出 Approve 的審查，再按 Squash and merge。'],
  },
  success: {
    summary: [
      '審查不是看紅綠燈。你抓到三樣 CI 抓不到的問題：個人設定檔（G4）、被偷偷刪掉的測試（P4/G5）、無關的大量變動（P4：Files changed 裡不該有和任務無關的東西；P2：PR 要小才好審）。',
      '審查只有三種結果：合併、合併但先藏起來、退回（P7）。退回要附具體待辦——Request changes 要勾出項目，小美只會處理你寫清楚的。最後用 Squash and merge（P6）。',
    ],
    rules: [
      { code: 'P4', text: 'Ready 之前 CI 綠燈、預覽自己點過' },
      { code: 'P6', text: '功能 PR 用 Squash and merge' },
      { code: 'P7', text: '審查只有三種結果：合併／合併但先藏起來／退回並附具體待辦' },
      { code: 'P2', text: 'PR 要小，一兩天內審得完；太大就拆' },
      { code: 'G4', text: '不該進 repo 的檔案（個人設定）要擋下來' },
    ],
  },
};
