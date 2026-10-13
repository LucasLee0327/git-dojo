// 寫 AI 腳本用的小工具（讓關卡檔案好讀）
import type { Game } from '../core/game';
import type { World } from '../git/types';
import type { DoStep, EditStep, IfStep, RunStep, SayStep, CallStep } from './types';

export const say = (text: string): SayStep => ({ k: 'say', text });
export const run = (cmd: string, o: Partial<Omit<RunStep, 'k' | 'cmd'>> = {}): RunStep => ({ k: 'run', cmd, ...o });
export const edit = (label: string, apply: (w: World) => void, risky = false): EditStep => ({ k: 'edit', label, apply, risky });
export const call = (script: string): CallStep => ({ k: 'call', script });
export const when = (cond: (g: Game) => boolean, then?: string, otherwise?: string): IfStep => ({ k: 'if', cond, then, else: otherwise });
export const act = (fn: (g: Game) => void): DoStep => ({ k: 'do', fn });
export const said = (id: string) => (g: Game) => !!g.flags[`said:${id}`];
