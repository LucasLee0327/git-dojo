import type { AgentDef } from '../agent/types';
import type { Game } from '../core/game';
import type { ChatMsg, Role } from '../core/types';
import type { PR, World } from '../git/types';

/** 🧑「看過」類任務要真的打開的 PR 分頁（Files changed／Checks／預覽站） */
export type EvTab = 'files' | 'checks' | 'preview';

/** 這個任務需要的「看過」證據：綁定某個 PR；玩家按 Ready／送審查／合併時若缺證據，會跳警告（不擋操作） */
export interface Evidence {
  /** 哪個動作會觸發缺證據的警告 */
  on: ('ready' | 'review' | 'merge')[];
  /** 這個證據是針對哪個 PR */
  pr: (g: Game) => PR | undefined;
  tabs: EvTab[];
  /** true＝任何一版（任何 head commit）看過就算；預設要在 PR「目前」的 head 看過 */
  anyHead?: boolean;
  /** 警告訊息裡引用的規則編號，例如 'P4' */
  rule?: string;
}

export interface Objective {
  id: string;
  label: string;
  /** 需要真的看過哪些分頁才能打勾（done 自己負責檢查；這裡只用來在缺證據時警告） */
  evidence?: Evidence;
  /** 🧑 只有人能做／該由人判斷的步驟 */
  human?: boolean;
  /** 沒給＝一開始就顯示；給了＝條件成立才出現在任務卡上（分階段的關卡用） */
  show?: (g: Game) => boolean;
  done: (g: Game) => boolean;
}

/** 把一關的目標分成幾個有名字的階段（任務卡上會有階段標題；沒給＝照舊平鋪） */
export interface Stage {
  key: string;
  title: string;
  /** 一句話說明「為什麼要有這一步」，不寫指令 */
  why: string;
  /** 屬於這個階段的目標 id（照 objectives 的順序） */
  objectives: string[];
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
  stages?: Stage[];
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
