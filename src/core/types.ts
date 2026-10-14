import type { Actor, World } from '../git/types';

export type Role = 'member' | 'lead';

export interface TermLine {
  kind: 'cmd' | 'out' | 'err' | 'explain' | 'sys';
  text: string;
  branch?: string | null;
  src?: 'user' | 'agent';
}

export interface HistEntry {
  cmd: string;
  code: number;
  src: 'user' | 'agent';
  tag?: string;
  branch?: string | null;
  seq: number;
  /** 指令執行前是否有「乾淨」的工作資料夾（給「先 status」之類判定用） */
  note?: string;
}

export interface FeedItem {
  id: number;
  who: Actor | 'sys';
  text: string;
  kind: 'info' | 'good' | 'alert';
}

export type ToolState = 'pending' | 'running' | 'done' | 'blocked' | 'auto-blocked' | 'denied' | 'interrupted' | 'awaiting';

export type ChatMsg =
  | { t: 'user'; id: number; text: string }
  | { t: 'ai'; id: number; text: string }
  | {
      t: 'tool';
      id: number;
      kind: 'Bash' | 'Edit';
      cmd: string;
      state: ToolState;
      out?: string;
      code?: number;
      reason?: string;
      rule?: string;
      why?: string;
    }
  | { t: 'sys'; id: number; text: string; tone?: 'warn' | 'info' };

export interface AgentFrame {
  script: string;
  pc: number;
}

export interface AgentState {
  frames: AgentFrame[];
  status: 'idle' | 'running' | 'awaiting';
  /** 已顯示「即將執行」、等待執行視窗結束的工具卡 */
  armedTool: number | null;
  /** 正在等玩家回覆權限視窗的工具卡 */
  pendingTool: number | null;
}

export interface Banner {
  id: string;
  text: string;
  /** 附加的警告（例如「還沒看就轉 Ready」），接在關卡陷阱訊息後面 */
  extra?: string;
}

export interface GameState {
  v: 1;
  levelId: number;
  world: World;
  chat: ChatMsg[];
  term: TermLine[];
  hist: HistEntry[];
  feed: FeedItem[];
  flags: Record<string, any>;
  agent: AgentState;
  hintTier: Record<string, number>;
  done: boolean;
  traps: string[];
  banner: Banner | null;
  seq: number;
}

export interface Checkpoint {
  id: number;
  label: string;
  snap: string;
}
