// AI 腳本的「節拍器」：每隔一小段時間叫 Game 前進一步，讓畫面上看起來像 AI 在一步一步做事。
import type { Game } from '../core/game';
import type { Speed } from '../store/save';

export const SPEED_LABEL: Record<Speed, string> = {
  slow: '慢',
  normal: '正常',
  fast: '快',
  instant: '瞬間（不給你按 Esc 的時間）',
};
const MULT: Record<Speed, number> = { slow: 1.6, normal: 1, fast: 0.45, instant: 0 };
const ARMED_MULT: Record<Speed, number> = { slow: 1.3, normal: 1, fast: 0.8, instant: 0 };

export const typingDelay = (s: Speed) => (s === 'instant' ? 0 : s === 'fast' ? 10 : s === 'slow' ? 34 : 20);

export interface ArmedInfo {
  toolId: number;
  total: number;
  until: number;
}

export class Driver {
  timer: number | null = null;
  stopped = false;
  armed: ArmedInfo | null = null;
  constructor(
    private g: Game,
    private getSpeed: () => Speed,
    private onArmed: () => void,
  ) {}

  start() {
    this.stopped = false;
    this.schedule(50);
  }
  stop() {
    this.stopped = true;
    if (this.timer !== null) window.clearTimeout(this.timer);
    this.timer = null;
  }
  /** 外部（例如玩家選了選項、按了允許）叫醒節拍器 */
  poke() {
    if (this.stopped) return;
    if (this.timer !== null) window.clearTimeout(this.timer);
    this.schedule(20);
  }
  private schedule(ms: number) {
    if (this.stopped) return;
    this.timer = window.setTimeout(() => this.tick(), ms);
  }
  private tick() {
    this.timer = null;
    if (this.stopped) return;
    const g = this.g;
    const a = g.state.agent;
    if (a.status === 'idle') {
      this.armed = null;
      return this.schedule(250);
    }
    if (a.status === 'awaiting') {
      this.armed = null;
      return this.schedule(250);
    }
    const speed = this.getSpeed();
    // 已經「即將執行」：給玩家按 Esc 的時間，時間到才真的執行
    if (a.armedTool !== null) {
      const total = 4500 * ARMED_MULT[speed];
      if (!this.armed || this.armed.toolId !== a.armedTool) {
        this.armed = { toolId: a.armedTool, total, until: performance.now() + total };
        this.onArmed();
      }
      const left = this.armed.until - performance.now();
      if (left > 0) return this.schedule(Math.min(left, 200));
      this.armed = null;
    }
    const r = g.agentStep();
    if (r.armed) {
      const m = g.state.agent.armedTool;
      if (m !== null) {
        const total = 4500 * ARMED_MULT[speed];
        this.armed = { toolId: m, total, until: performance.now() + total };
        this.onArmed();
      }
      return this.schedule(Math.min(200, 4500 * ARMED_MULT[speed]));
    }
    if (r.waiting) return this.schedule(250);
    if (r.done) return this.schedule(250);
    this.schedule(Math.max(0, r.delay * MULT[speed]));
  }
}
