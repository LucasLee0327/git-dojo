import type { AgentDef } from '../agent/types';
import type { Game } from '../core/game';
import type { ChatMsg, Role } from '../core/types';
import type { World } from '../git/types';

export interface Objective {
  id: string;
  label: string;
  /** 🧑 只有人能做／該由人判斷的步驟 */
  human?: boolean;
  /** 沒給＝一開始就顯示；給了＝條件成立才出現在任務卡上（分階段的關卡用） */
  show?: (g: Game) => boolean;
  done: (g: Game) => boolean;
}

export interface EditAction {
  id: string;
  label: string;
  hint: string;
  /** 什麼時候可以按 */
  available?: (g: Game) => boolean;
  apply: (w: World, g: Game) => void;
}

export interface LevelEvent {
  id: string;
  when: (g: Game) => boolean;
  run: (g: Game) => void;
  /** true＝可重複觸發（when 必須在 run 之後變成 false） */
  repeat?: boolean;
}

export interface Trap {
  id: string;
  /** 回傳訊息＝這條路有後果 */
  test: (g: Game) => string | null;
}

export type RightTab = 'preview' | 'github' | 'editor';

export interface LevelDef {
  id: number;
  title: string;
  part: 1 | 2 | 3;
  minutes: number;
  rules: string[];
  role: Role;
  blurb: string;
  /** 任務卡上的背景故事（每段一個字串） */
  story: string[];
  setup: () => { world: World; flags?: Record<string, any>; chat?: ChatMsg[] };
  objectives: Objective[];
  edits?: EditAction[];
  events?: LevelEvent[];
  traps?: Trap[];
  /** objective id → [方向, 指令, 直接示範] */
  hints: Record<string, [string, string, string]>;
  agent?: AgentDef;
  startTab?: RightTab;
  success: { summary: string[]; rules: { code: string; text: string }[] };
  optional?: boolean;
  /** 審查者（部長）角色用：Request changes 時可勾選的待辦清單 */
  review?: { todos: { id: string; label: string }[] };
  /** 可手動傳入的 PR 預覽等 */
  free?: boolean;
}
