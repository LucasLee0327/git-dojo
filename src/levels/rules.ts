// 協作規則速查（簡化、去識別版）。代號對應關卡任務卡上的 G1、P6、§11 等。

export interface RuleDef {
  code: string;
  group: 'G' | 'P' | 'R' | 'A' | 'S';
  text: string;
}

export const RULE_GROUPS: Record<RuleDef['group'], string> = {
  G: 'Git 操作',
  P: 'PR 與審查',
  R: '角色分工',
  A: '指揮 AI',
  S: '出事時',
};

export const RULES: RuleDef[] = [
  { code: 'G1', group: 'G', text: '不在 staging／master 上 commit，也不 push 到 staging／master；所有修改走功能分支，再用 PR 進 staging。' },
  { code: 'G2', group: 'G', text: '功能分支從最新的 staging 開，命名 feat/…（修錯誤用 fix/…）。' },
  { code: 'G3', group: 'G', text: '同步 staging 一律用 merge，不用 rebase；已 push 的分支不得改寫歷史（不 amend、不 rebase、不 force push）。' },
  { code: 'G4', group: 'G', text: '只 add 這次真的改過的檔案；禁止 git add .；個人設定、截圖、筆記不進 repo。' },
  { code: 'G5', group: 'G', text: '測試失敗就修程式；不刪測試，不用 --no-verify。' },
  { code: 'G6', group: 'G', text: 'push 被拒絕＝先 pull 再 push；禁止 force push。' },
  { code: 'G7', group: 'G', text: '任何會丟掉修改的操作（reset、checkout -- .、restore .、clean、stash drop、branch -D），執行前先建立備份分支 backup/日期-說明，並徵得同意。例外：PR 在 GitHub 上已顯示 Merged、合併後沒有再 commit 的本機分支，可直接 branch -D（squash 合併讓 -d 一定失敗，這是正常的）。' },
  { code: 'G9', group: 'G', text: 'PR 合併之後，那條分支就不再使用；要接著做，從最新的 staging 開新分支。squash 會在 staging 上產生一個全新的 commit，和你分支上的 commit 沒有祖先關係，繼續用舊分支會產生重複修改和莫名衝突。' },
  { code: 'P1', group: 'P', text: '早開 Draft PR，目標分支是 staging；做到一半就可以開。' },
  { code: 'P2', group: 'P', text: 'PR 要小：盡量少於 400 行（不含自動產生的檔案），一兩天內可以審完；太大就拆。' },
  { code: 'P4', group: 'P', text: '轉成 Ready for review 之前：CI 全綠、PR 預覽站自己點過一遍、Files changed 裡沒有和任務無關的檔案。' },
  { code: 'P5', group: 'P', text: '合併前 PR 如果落後 staging，先同步（用 merge）並等 CI 重跑變綠。用 Update branch 之後，本機要先 git pull 再繼續改，否則下一次 push 會被拒絕。' },
  { code: 'P6', group: 'P', text: '功能 PR 用 Squash and merge；staging → master 的上線 PR 用 Create a merge commit。' },
  { code: 'P7', group: 'P', text: '審查只有三種結果：合併／合併但先藏起來（放 /experimental 路由、功能開關預設關閉，或只開放特定角色）／退回——附上具體的待辦清單，不說「再改改」。' },
  { code: 'R3', group: 'R', text: '合併由人在 GitHub 上按，AI 不合併 PR。' },
  { code: 'R4', group: 'R', text: '上線（staging → master）只有總負責人能做。' },
  { code: 'A2', group: 'A', text: 'AI 遇到合併衝突、push 被拒絕、pre-commit 或 CI 失敗、需要動高風險區、需要做 G7 的丟棄操作時，必須停下來，用白話說明發生什麼事、打算怎麼做，等你同意。（開工提示裡把界線講清楚，是讓它真的停下來的做法。）' },
  { code: 'A3', group: 'A', text: 'AI 不得合併 PR（gh pr merge），不得 push 到 staging／master，不得 force push。' },
  { code: '§11', group: 'S', text: '出事時：按 Esc 讓 AI 停下來；已經 push 或動到別人的分支，立刻通知部長；已經合併進 staging 的錯誤，用 GitHub 的 Revert 處理，不改寫歷史、不 force push。' },
];

/** Git 本身的行為（不是團隊約定）：上面的規則是建立在這些事實上 */
export const GIT_FACTS: string[] = [
  'push 時如果 GitHub 上有你本機沒有的 commit，會被拒絕——Git 不讓你蓋掉別人的東西。',
  'git pull ＝ git fetch ＋ 合併（merge）；設定 pull.rebase 的話，第二步改成 rebase。',
  'git add 是把檔案放進「暫存區（staging area）」，和 staging 分支沒有關係。',
  'Squash and merge 會在目標分支上產生一個全新的 commit，所以 git branch -d 認不出你的分支已經合併過，才需要 -D。',
  'git revert 是新增一個 commit 去抵銷舊的，歷史不變；git reset 是把分支指標移回去，commit 之後不容易找回來。',
  '已經 push 的歷史如果被改寫（amend、rebase、reset），就得 force push 才推得上去，會蓋掉別人在同一條分支上的 commit。',
];

export const ruleOf = (code: string): RuleDef | undefined => RULES.find((r) => r.code === code);

/** 'G7/G9' 這種合併寫法拆成多個代號 */
export const splitCodes = (code: string): string[] => code.split('/').map((c) => c.trim());
