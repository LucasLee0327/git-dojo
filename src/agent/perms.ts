// 團隊權限規則（對應 .claude/settings.json 的 deny / ask）＋ Auto 模式自己的擋法。
// 重點：規則只比對指令「字面」。
import { splitCommands } from '../core/shell';

export const DENY_RULES = [
  'git push --force*',
  'git push -f*',
  'git push *--force*',
  'git commit *--no-verify*',
  'git push *--no-verify*',
  'git add .',
  'git add -A*',
  'git add --all*',
  'gh pr merge *',
];

export const ASK_RULES = [
  'git push *staging*',
  'git push *master*',
  'git rebase *',
  'git branch -D *',
  'git reset *',
  'git clean *',
  'git checkout -- *',
  'git restore *',
  'git stash drop*',
];

export type PermDecision =
  | { kind: 'allow' }
  | { kind: 'deny'; rule: string; cmd: string }
  | { kind: 'ask'; rule: string; cmd: string }
  | { kind: 'auto-block'; reason: string; cmd: string };

function globToRe(g: string): RegExp {
  return new RegExp('^' + g.replace(/[.+^${}()|[\]\\]/g, '\\$&').replace(/\*/g, '.*') + '$');
}

export function matchRule(rule: string, cmd: string): boolean {
  return globToRe(rule).test(cmd.replace(/\s+/g, ' ').trim());
}

/** Auto 模式本身會擋的破壞性操作（規則沒列到時才輪到它） */
function autoBlock(cmd: string): string | null {
  const c = cmd.replace(/\s+/g, ' ').trim();
  if (/^git push\b/.test(c) && /(\s\+\S|:\+\S)/.test(c)) return '這是 force push（+ 開頭的 refspec 等同 --force），會覆寫遠端的歷史。';
  if (/^git push\b.*\s--delete\b/.test(c)) return '刪除遠端分支屬於破壞性操作。';
  if (/^rm -rf? \//.test(c)) return '這會刪除大量檔案。';
  return null;
}

export function checkCommand(line: string): PermDecision {
  const parts = splitCommands(line).map((p) => p.cmd.replace(/\s+/g, ' ').trim());
  let ask: PermDecision | null = null;
  let auto: PermDecision | null = null;
  for (const cmd of parts) {
    for (const rule of DENY_RULES) if (matchRule(rule, cmd)) return { kind: 'deny', rule, cmd };
  }
  for (const cmd of parts) {
    for (const rule of ASK_RULES) {
      if (matchRule(rule, cmd)) {
        ask = ask ?? { kind: 'ask', rule, cmd };
        break;
      }
    }
    const reason = autoBlock(cmd);
    if (reason) auto = auto ?? { kind: 'auto-block', reason, cmd };
  }
  // Auto 模式自己的擋法優先：即使 ask 規則也比對到，這種操作根本不會讓你按「允許」
  return auto ?? ask ?? { kind: 'allow' };
}
