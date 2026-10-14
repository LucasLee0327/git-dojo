import type { Game } from '../core/game';
import { ancestors } from '../git/repo';
import { withDark } from '../site/files';
import { baseWorld, bossPolicy, editSite, leftovers, originHas } from './common';
import type { EvTab, LevelDef } from './types';

const EV_READY: EvTab[] = ['files', 'checks', 'preview'];
const featName = (g: Game): string | undefined => g.prs.find((p) => p.author === 'me')?.head ?? Object.keys(g.me.branches).find((b) => /^feat\//.test(b));
const myPR = (g: Game) => g.prs.find((p) => p.author === 'me');
const merged = (g: Game) => myPR(g)?.state === 'merged';
const stagingClean = (g: Game) => {
  const t = g.w.objects[g.origin.branches.staging].tree;
  return !t['ai-notes.md'] && !t['screenshot.png'] && !t['.env'];
};

export const level1: LevelDef = {
  id: 1,
  title: '一個人做一個功能',
  part: 1,
  minutes: 8,
  rules: ['G1', 'G2', 'G4', 'G7', 'G9', 'P1', 'P6', 'R3'],
  role: 'member',
  blurb: '從 Issue 開始，經過分支、commit、push、Draft PR，一路到合併與收尾。',
  story: [
    'Issue #5「深色模式按鈕」指派給你了。你要在小共筆的右上角加一顆切換深色模式的按鈕。',
    '你的電腦現在停在舊的 master 分支，而且上次 fetch 之後，staging 又更新了。工作資料夾裡還有 AI 上次留下的雜物：ai-notes.md、screenshot.png，以及一個被 .gitignore 擋住、git status 看不到的 .env。',
    '流程：切到 staging → pull → 開 feat/dark-mode → 寫程式（按編輯器的「套用修改」代表你寫好了）→ add 要的檔案 → commit → push -u → 🧑 開 Draft PR → 🧑 轉 Ready → 等部長審查合併 → 收尾刪分支。',
  ],
  setup() {
    const { w, ids } = baseWorld({ meOn: 'master', stale: true, untracked: leftovers() });
    w.github.issues.push({ number: 5, title: '深色模式按鈕', body: '目標：右上角加一顆按鈕，點了可以切換深色模式。\n不做：不用記住偏好設定。\n驗收：點按鈕後整個頁面變成深色，再點一次變回來。' });
    return { world: w, flags: { latestStaging: ids.c3 } };
  },
  edits: [
    {
      id: 'dark-mode',
      label: '套用修改：寫好深色模式按鈕',
      hint: '代表你（或 AI）已經把程式寫好了：會修改 index.html、app.js、style.css 和測試。',
      available: (g) => !!g.branch && g.branch !== 'staging' && g.branch !== 'master' && !g.flags['edit:dark-mode'],
      apply: (w) => editSite(w, (f) => withDark(f)),
    },
  ],
  events: [bossPolicy({ id: 'boss-merge' })],
  traps: [
    {
      id: 'notes-committed',
      test: (g) => {
        const f = featName(g);
        const t = f ? g.me.branches[f] && g.w.objects[g.me.branches[f]].tree : null;
        const o = g.origin.branches[f ?? ''];
        const ot = o ? g.w.objects[o].tree : null;
        if ((t && (t['ai-notes.md'] || t['screenshot.png'])) || (ot && (ot['ai-notes.md'] || ot['screenshot.png']))) {
          const pushed = !!(ot && (ot['ai-notes.md'] || ot['screenshot.png']));
          return (
            '⚠ ai-notes.md 或 screenshot.png 被 commit 進去了（G4）。' +
            (pushed
              ? '而且已經 push 到 GitHub：不能改寫已 push 的歷史（G3），用 git rm --cached 把它們移出追蹤，再補一個 commit、push。'
              : '還沒 push：git reset --soft HEAD~1 退回，再 git restore --staged 它們，只 add 要的檔案。')
          );
        }
        return null;
      },
    },
    {
      id: 'push-protected',
      test: (g) => (g.state.hist.some((h) => h.tag === 'push-protected-branch') ? '🚨 你直接 push 到 staging／master 了（G1）。這一關請走分支＋PR；可以按「時光倒流」回到 push 之前。' : null),
    },
    {
      id: 'self-merge',
      test: (g) => (g.ran(/^gh pr merge/, { src: 'user' }) ? '⚠ PR 作者不能合併自己的 PR（R3）。合併要由人在 GitHub 網頁上按，這一關由部長來。' : null),
    },
  ],
  objectives: [
    {
      id: 'branch',
      label: '從最新的 staging 開一條 feat/ 分支（先切到 staging 並 pull）',
      done: (g) => {
        if (merged(g)) return true;
        const f = Object.keys(g.me.branches).find((b) => /^feat\//.test(b));
        if (!f) return false;
        return ancestors(g.w, g.me.branches[f]).has(g.flags.latestStaging);
      },
    },
    { id: 'edit', label: '按編輯器的「套用修改」，代表程式寫好了', done: (g) => !!g.flags['edit:dark-mode'] },
    {
      id: 'commit',
      label: '只 add、commit 這次改的檔案——不要把 ai-notes.md、screenshot.png 帶進去',
      done: (g) => {
        if (merged(g)) return stagingClean(g);
        const f = featName(g);
        const id = f && g.me.branches[f];
        if (!id) return false;
        const t = g.w.objects[id].tree;
        return (t['app.js'] ?? '').includes('toggleTheme') && !t['ai-notes.md'] && !t['screenshot.png'] && !t['.env'];
      },
    },
    {
      id: 'push',
      label: 'push 到 GitHub，並設定追蹤（git push -u）',
      done: (g) => {
        if (merged(g)) return true;
        const f = featName(g);
        return !!f && !!g.me.branches[f] && g.origin.branches[f] === g.me.branches[f] && !!g.me.tracking[f];
      },
    },
    { id: 'pr', label: '🧑 到 GitHub 分頁開一個 Draft PR（目標分支 staging）', human: true, done: (g) => !!myPR(g) },
    {
      id: 'ready',
      label: '🧑 先打開 PR 的 Checks、Files changed、預覽站各看一遍（P4），再轉成 Ready for review',
      human: true,
      evidence: { on: ['ready'], pr: myPR, tabs: EV_READY, rule: 'P4' },
      done: (g) => !!myPR(g) && (!myPR(g)!.draft || merged(g)) && g.checkedPR(myPR(g)!.number, EV_READY),
    },
    {
      id: 'merged',
      label: '部長審查並合併後，測試站預覽出現深色模式按鈕',
      done: (g) => merged(g) && originHas(g, 'staging', 'app.js', 'toggleTheme'),
    },
    {
      id: 'cleanup',
      label: '收尾：回到 staging、pull 最新、刪掉用完的 feat 分支（先試 -d，PR 已 Merged 再用 -D）',
      done: (g) => merged(g) && g.branch === 'staging' && g.me.branches.staging === g.origin.branches.staging && !g.me.branches[myPR(g)!.head],
    },
  ],
  stages: [
    { key: 'A', title: '準備工作', why: '新功能要從團隊最新的版本開始，之後才不會和別人的修改打架。', objectives: ['branch'] },
    { key: 'B', title: '在自己的分支改檔並提交', why: '修改只放在自己的分支上，而且只存這次真的改的檔案，審查的人才看得懂。', objectives: ['edit', 'commit'] },
    { key: 'C', title: '上傳並送審', why: '把分支放上 GitHub 讓團隊看得到，先開 Draft 讓大家早點知道你在做什麼，確認沒問題才請人審。', objectives: ['push', 'pr', 'ready'] },
    { key: 'D', title: '合併後收尾', why: '功能進了 staging 之後，你的舊分支就沒用了，清乾淨才不會下次接著用它出錯。', objectives: ['merged', 'cleanup'] },
  ],
  hints: {
    branch: [
      '規則 G2：分支要從「最新的 staging」開。你現在在 master，而且 staging 也不是最新的。',
      '依序：git switch staging → git pull → git switch -c feat/dark-mode',
      '三行指令：\ngit switch staging\ngit pull\ngit switch -c feat/dark-mode',
    ],
    edit: ['程式要在 feat 分支上寫（G1：不在 staging 上動手）。到「編輯器」分頁找「套用修改」按鈕。', '切到編輯器分頁，按「套用修改：寫好深色模式按鈕」。', '編輯器分頁 → 按鈕。按下後 git status 會看到 4 個檔案被修改。'],
    commit: [
      'git add . 會把 ai-notes.md、screenshot.png 一起加進去（G4 禁止）。先用 git status 看清楚哪些是你改的。',
      '只 add 改過的：git add index.html app.js style.css tests/app.test.js。已經誤加了？用 git restore --staged ai-notes.md screenshot.png 退回來。',
      'git add index.html app.js style.css tests/app.test.js\ngit commit -m "新增深色模式按鈕"\n（誤加了就先 git restore --staged ai-notes.md screenshot.png）',
    ],
    push: [
      '第一次推新分支，要順便告訴 Git「本機這條分支對應 GitHub 的哪一條」。',
      'git push -u origin feat/dark-mode',
      '輸入：git push -u origin feat/dark-mode',
    ],
    pr: ['到「GitHub」分頁，推上去的分支會出現「Compare & pull request」的黃色提示。', '按它，確認目標是 staging，勾選 Draft 後建立。', '標題寫「新增深色模式按鈕」，按 Create draft pull request。'],
    ready: [
      '轉 Ready 之前（P4）：CI 要綠燈、PR 預覽站自己點過一遍、Files changed 沒有無關檔案——要真的打開這三個分頁，任務才會打勾。',
      '到 PR 頁面依序點 Checks（全綠）、Files changed（只有 4 個檔案）、預覽站（按鈕有用），然後按 Ready for review。',
      '在 PR 頁面點 Checks、Files changed、預覽站各一次，再按「Ready for review」。（沒看就按也可以，但這一格不會打勾，之後要回來補看。）',
    ],
    merged: ['轉 Ready 後，部長機器人會自己審查。等一下就好。', '看右上角的通知，部長會留言。', '如果部長退回，看他寫的原因。'],
    cleanup: [
      'PR 合併後，那條分支就不再用了（G9）。先回 staging 並 pull。',
      'git switch staging → git pull → git branch -d feat/dark-mode（會失敗！）→ 確認 PR 是 Merged → git branch -D feat/dark-mode',
      'git switch staging\ngit pull\ngit branch -d feat/dark-mode\ngit branch -D feat/dark-mode',
    ],
  },
  success: {
    summary: [
      '你完成了一個功能從頭到尾的標準流程：從最新的 staging 開分支（G2）、只 add 改過的檔案（G4）、push -u、先開 Draft PR（P1）、確認後轉 Ready（P4），由部長合併（R3），最後清掉舊分支（G9）。',
      'git branch -d 會失敗不是你做錯：功能 PR 用 Squash and merge，GitHub 在 staging 上產生一個全新的 commit，Git 認不出你的分支內容已經合併過。只要 PR 在 GitHub 上顯示 Merged，就可以放心用 -D（G7 的例外）。',
      '🧑 有幾件事只有人能做：決定該 add 哪些檔案、開 PR、自己把預覽點過一遍再轉 Ready。AI 可以幫忙跑指令，但這些判斷要你來。',
    ],
    rules: [
      { code: 'G2', text: '分支從最新的 staging 開，命名 feat/…' },
      { code: 'G4', text: '只 add 這次真的改過的檔案，禁止 git add .' },
      { code: 'P1/P4', text: '早開 Draft PR；轉 Ready 前 CI 全綠、預覽自己點過' },
      { code: 'P6/R3', text: '功能 PR 用 Squash and merge，合併由人在 GitHub 上按' },
      { code: 'G7', text: '丟棄操作前先建備份分支；例外：PR 已 Merged 的本機分支可直接 -D（squash 讓 -d 一定失敗）' },
      { code: 'G9', text: '合併後那條分支不再使用；要接著做，從最新的 staging 開新分支' },
    ],
  },
};
