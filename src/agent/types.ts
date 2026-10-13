import type { Game } from '../core/game';
import type { World } from '../git/types';

export interface SayStep {
  k: 'say';
  text: string;
}
export interface RunStep {
  k: 'run';
  cmd: string;
  /** 工具卡上顯示的簡短說明 */
  why?: string;
  /** 危險／刻意不被規則擋的步驟：先顯示「即將執行」視窗，讓玩家有機會按 Esc */
  risky?: boolean;
  /** 成功（exit 0）後呼叫的腳本 */
  ok?: string;
  /** 失敗（exit != 0）後呼叫的腳本 */
  failed?: string;
  /** 被 deny 規則或 Auto 模式擋下後呼叫的腳本 */
  blocked?: string;
  /** 玩家在權限視窗按「拒絕」後呼叫的腳本 */
  denied?: string;
}
export interface EditStep {
  k: 'edit';
  label: string;
  apply: (w: World) => void;
  risky?: boolean;
}
export interface DoStep {
  k: 'do';
  fn: (g: Game) => void;
}
export interface IfStep {
  k: 'if';
  cond: (g: Game) => boolean;
  then?: string;
  else?: string;
}
export interface CallStep {
  k: 'call';
  script: string;
}
export type Step = SayStep | RunStep | EditStep | DoStep | IfStep | CallStep;

export interface PromptOption {
  id: string;
  text: string;
  quality: 'good' | 'ok' | 'vague';
  script: string;
  /** 事後解說：為什麼這句好／不好 */
  note: string;
}

export interface AgentDef {
  scripts: Record<string, Step[]>;
  /** AI 閒置時，提供給玩家選的下一句話；沒有就回傳 null */
  offer: (g: Game) => { label: string; options: PromptOption[] } | null;
  intro?: string;
  auto: boolean;
}
