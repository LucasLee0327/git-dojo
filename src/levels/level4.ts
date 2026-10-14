import type { Game } from '../core/game';
import { ancestors, checkoutClean, logHead, makeCommit, treeOf } from '../git/repo';
import { runApp } from '../site/runner';
import { withFooterCopyright } from '../site/files';
import { baseWorld, bossPolicy, tipTree } from './common';
import type { EvTab, LevelDef } from './types';

const EV_PR: EvTab[] = ['checks'];

const stageB = (g: Game) => !!g.flags['ev:stage-b'];
const localBranches = (g: Game) => Object.keys(g.me.branches).filter((b) => b !== 'staging' && b !== 'master');
const stagingSynced = (g: Game) => g.me.branches.staging === g.origin.branches.staging;
const rescued = (g: Game) => localBranches(g).some((b) => ancestors(g.w, g.me.branches[b]).has(g.flags.F));
const fixBranch = (g: Game) =>
  localBranches(g).find((b) => {
    const t = tipTree(g, b);
    return !!t && !!g.flags.bad && ancestors(g.w, g.me.branches[b]).has(g.flags.bad) && !(t['app.js'] ?? '').includes('COPYRIGHT_TEXT');
  });
const fixPR = (g: Game) => {
  const b = fixBranch(g);
  return b ? g.prs.find((p) => p.head === b && p.author === 'me') : undefined;
};

export const level4: LevelDef = {
  id: 4,
  title: '在 staging 上 commit 了',
  part: 1,
  minutes: 8,
  rules: ['G1', 'G7', '§11'],
  role: 'member',
  blurb: '不小心直接在 staging 上 commit（甚至 push）了，怎麼補救？',
  story: [
    '你剛剛心急，沒有開分支就直接在 staging 上改了頁尾、commit 好了——發現的時候還沒 push。',
    '第一個情境（4a）：先冷靜。🧑 先用 git status 看清楚現在的狀況，再把這個 commit 搬到新的 feat 分支，並讓你本機的 staging 回到跟 GitHub 一樣。',
    '做完之後會有第二個情境（4b）：這種錯誤更慘的版本——已經 push 出去了。',
  ],
  setup() {
    const { w, ids } = baseWorld({ meOn: 'staging' });
    const t = withFooterCopyright(treeOf(w, ids.c3), false);
    const F = makeCommit(w, { parents: [ids.c3], message: '頁尾加上版權年份', author: 'me', tree: t });
    const me = w.repos.me;
    me.branches.staging = F;
    logHead(me, F, 'commit: 頁尾加上版權年份', ids.c3);
    checkoutClean(w, 'me');
    return { world: w, flags: { F, c3: ids.c3 } };
  },
  events: [
    {
      id: 'stage-b',
      when: (g) => g.ran(/^git status/, { src: 'user' }) && rescued(g) && stagingSynced(g) && g.branch !== null,
      run: (g) => {
        const w = g.w;
        const o = w.repos.origin;
        const me = w.repos.me;
        const base = o.branches.staging;
        // 另一天：同樣的錯誤，這次沒攔住，直接 push 了，而且程式有 bug
        const bad = makeCommit(w, { parents: [base], message: '頁尾改用 COPYRIGHT_TEXT', author: 'me', tree: withFooterCopyright(treeOf(w, base), true) });
        o.branches.staging = bad;
        me.branches.staging = bad;
        me.remotes['origin/staging'] = bad;
        me.head = { kind: 'branch', name: 'staging' };
        logHead(me, bad, 'commit: 頁尾改用 COPYRIGHT_TEXT', base);
        checkoutClean(w, 'me');
        g.flags.bad = bad;
        g.flags.bSeq = g.state.seq;
        w.github.alerts.push({ id: 'alert-bad-staging', text: '🚨 測試站部署後 JS 出錯：Uncaught ReferenceError: COPYRIGHT_TEXT is not defined（最新 commit：頁尾改用 COPYRIGHT_TEXT）' });
        g.notify('sys', '情境 4b：過了幾天，你又在 staging 上 commit，而且這次直接 push 了。測試站白屏、跳出警報。到「預覽」看看測試站，再想怎麼補救。', 'alert');
      },
    },
    bossPolicy({ id: 'boss-merge' }),
  ],
  traps: [
    {
      id: 'pushed-before-rescue',
      test: (g) =>
        !g.flags['ev:stage-b'] && g.origin.branches.staging !== g.flags.c3 && g.state.hist.some((h) => h.tag === 'push-protected-branch')
          ? '🚨 你把那個 commit 直接 push 到 staging 了（G1）。4a 的重點是「還沒 push 之前」搬走它——按「時光倒流」回到 push 之前，重做一次。'
          : null,
    },
    {
      id: 'force-on-staging',
      test: (g) =>
        g.flags['ev:stage-b'] && g.state.hist.some((h) => h.tag === 'push-forced' && h.src === 'user')
          ? '🚨 你 force push 了（G6）。staging 是大家共用的，force push 會蓋掉別人的工作。已經 push 的 commit 應該用 git revert「反向補一個」，不是改寫歷史。按「時光倒流」回去。'
          : null,
    },
    {
      id: 'direct-fix-on-staging',
      test: (g) =>
        g.flags['ev:stage-b'] && g.state.hist.some((h) => h.tag === 'push-protected-branch' && h.seq > (g.flags.bSeq ?? 0) && h.src === 'user') && g.origin.branches.staging !== g.flags.bad
          ? '⚠ 你又直接 push 到 staging 了（G1）。就算是修復，也要走 fix 分支加 PR——這樣有人看過、也有 CI。'
          : null,
    },
  ],
  objectives: [
    { id: 'status', label: '🧑 先用 git status 看清楚狀況（別急著動手）', human: true, done: (g) => g.ran(/^git status/, { src: 'user' }) },
    { id: 'rescue', label: '把那個 commit 搬到新的分支（例如 feat/footer-copyright）', done: (g) => rescued(g) },
    { id: 'clean', label: '讓本機 staging 回到跟 origin/staging 一樣（沒有多出來的 commit）', done: (g) => rescued(g) && (stagingSynced(g) || stageB(g)) },
    {
      id: 'revert',
      show: stageB,
      label: '4b：開一條 fix/ 分支，用 git revert 反向補一個 commit（不要改寫歷史）',
      done: (g) => !!fixBranch(g),
    },
    { id: 'push', show: stageB, label: '4b：把 fix 分支 push 上去（-u）', done: (g) => { const b = fixBranch(g); return !!b && (g.origin.branches[b] === g.me.branches[b] || !!fixPR(g)); } },
    {
      id: 'pr',
      show: stageB,
      label: '4b：🧑 開 PR（目標 staging）、打開 Checks 看過，再轉成 Ready',
      human: true,
      evidence: { on: ['ready'], pr: fixPR, tabs: EV_PR, rule: 'P4' },
      done: (g) => { const p = fixPR(g); return !!p && !p.draft && g.checkedPR(p.number, EV_PR); },
    },
    {
      id: 'fixed',
      show: stageB,
      label: '4b：部長合併後，測試站恢復正常（歷史裡那個壞 commit 仍在，只是被反向抵銷）',
      done: (g) => {
        if (!g.flags.bad) return false;
        const id = g.origin.branches.staging;
        return ancestors(g.w, id).has(g.flags.bad) && id !== g.flags.bad && runApp(g.w.objects[id].tree).ok;
      },
    },
  ],
  hints: {
    status: ['第一步永遠是看狀態——很多慘劇是因為沒看就動手。', '在終端機輸入 git status。', 'git status（會看到「Your branch is ahead of origin/staging by 1 commit」）'],
    rescue: [
      '你要的 commit 已經在本機做好了，只缺一條「掛著它的分支」。',
      '在 staging 上直接開新分支，commit 就會跟著走：git switch -c feat/footer-copyright',
      'git switch -c feat/footer-copyright',
    ],
    clean: [
      '現在 staging 還多著那個 commit，要讓它回到跟 GitHub 一樣。先切回 staging。',
      'git switch staging → git reset --hard origin/staging（因為 commit 已經在新分支上，所以不會丟）',
      'git switch staging\ngit reset --hard origin/staging',
    ],
    revert: [
      '已經 push 的 commit 不能改寫歷史（會連累別人）。改用 revert：產生一個「反向」的新 commit。',
      '先 git switch -c fix/revert-footer（從 staging 開），再 git revert <壞 commit 的 sha>（用 git log --oneline 找，或在最新時用 HEAD）',
      'git switch -c fix/revert-footer\ngit revert HEAD --no-edit',
    ],
    push: ['fix 分支也要先推上 GitHub 才能開 PR。', 'git push -u origin fix/revert-footer', 'git push -u origin fix/revert-footer'],
    pr: ['到 GitHub 分頁開 PR，目標 staging，先用 Draft 建立（緊急修復也一樣）。', '建立 PR 後打開 Checks 分頁確認全綠（要真的打開，任務才會打勾），再按 Ready for review。', '部長會審查。若直接以 Ready 開出、沒看 Checks，可以回 PR 頁補看。'],
    fixed: ['等部長合併。', '合併後切到預覽的「測試站」看看是否恢復。', '看右上角通知。'],
  },
  success: {
    summary: [
      '4a：commit 還在本機時，搬家很簡單——在原地開新分支（commit 跟著走），再讓 staging 回到跟 origin 一樣（reset --hard 是 G7 的丟棄操作：這裡因為 commit 已經在新分支上，所以是安全的；不確定時先用 git branch backup/日期-說明 留一份）。關鍵是先 git status，確認自己知道現在的狀態（G1：不在 staging 上動手）。',
      '4b：已經 push 的壞 commit，不能抹掉，只能「反向補一個」（git revert）。走 fix 分支加 PR，有人看過、有 CI，歷史也完整保留（§11）。reset 加 force push 是改寫別人也拉過的歷史，是更大的事故。',
    ],
    rules: [
      { code: 'G1', text: '不在 staging／master 上直接動手，所有修改走分支加 PR' },
      { code: 'G7', text: '丟棄操作（reset、clean、branch -D…）之前，先建立備份分支 backup/日期-說明並徵得同意' },
      { code: '§11', text: '出事時：已 push 的用 revert 補救，走 fix 分支加 PR，不要 force push' },
    ],
  },
};
