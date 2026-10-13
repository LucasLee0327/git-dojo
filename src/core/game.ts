// 無頭（headless）的遊戲核心：狀態、動作、機器人事件、判定、AI 腳本執行、時光倒流。
// UI 只是這個類別的薄薄一層；自動化測試也直接操作它。
import { checkCommand } from '../agent/perms';
import type { PromptOption, Step } from '../agent/types';
import { currentBranch, headId } from '../git/repo';
import type { Actor, PR, Repo, World } from '../git/types';
import {
  addComment,
  closePR,
  convertToDraft,
  createPR,
  findPR,
  markReady,
  mergePR,
  prByHead,
  revertPR,
  submitReview,
  updateBranch,
} from '../github/github';
import { syncMei } from '../github/bots';
import { getLevel } from '../levels';
import type { LevelDef, Objective } from '../levels/types';
import { runShellLine, splitCommands } from './shell';
import type { AgentState, ChatMsg, Checkpoint, GameState } from './types';

const MAX_CHECKPOINTS = 10;
type NewChat = ChatMsg extends infer M ? (M extends { id: number } ? Omit<M, 'id'> : never) : never;

export const emptyAgent = (): AgentState => ({ frames: [], status: 'idle', armedTool: null, pendingTool: null });

export class Game {
  state: GameState;
  def: LevelDef;
  checkpoints: Checkpoint[] = [];
  version = 0;
  listeners = new Set<() => void>();
  onChange: ((g: Game) => void) | null = null;
  private cpSeq = 1;

  private constructor(state: GameState) {
    this.state = state;
    this.def = getLevel(state.levelId);
  }

  static create(levelId: number): Game {
    const def = getLevel(levelId);
    const s = def.setup();
    const state: GameState = {
      v: 1,
      levelId,
      world: s.world,
      chat: s.chat ?? [],
      term: [],
      hist: [],
      feed: [],
      flags: s.flags ?? {},
      agent: emptyAgent(),
      hintTier: {},
      done: false,
      traps: [],
      banner: null,
      seq: 1,
    };
    const g = new Game(state);
    syncMei(g.w);
    g.post(false);
    return g;
  }

  static restore(state: GameState, checkpoints: Checkpoint[] = []): Game {
    const g = new Game(state);
    g.checkpoints = checkpoints;
    g.cpSeq = Math.max(0, ...checkpoints.map((c) => c.id)) + 1;
    return g;
  }

  // ---------- 存取 ----------
  get w(): World {
    return this.state.world;
  }
  get me(): Repo {
    return this.state.world.repos.me;
  }
  get origin(): Repo {
    return this.state.world.repos.origin;
  }
  get mei(): Repo {
    return this.state.world.repos.mei;
  }
  get branch(): string | null {
    return currentBranch(this.me);
  }
  get flags() {
    return this.state.flags;
  }
  get head(): string | null {
    return headId(this.me);
  }
  pr(n: number): PR | undefined {
    return findPR(this.w, n);
  }
  prOf(head: string, state?: PR['state']): PR | undefined {
    return prByHead(this.w, head, state);
  }
  get prs(): PR[] {
    return this.w.github.prs;
  }
  /** 有沒有執行過符合的指令 */
  ran(re: RegExp, o: { src?: 'user' | 'agent'; ok?: boolean } = {}): boolean {
    return this.state.hist.some((h) => re.test(h.cmd) && (o.src ? h.src === o.src : true) && (o.ok === undefined ? true : (h.code === 0) === o.ok));
  }
  ranCount(re: RegExp): number {
    return this.state.hist.filter((h) => re.test(h.cmd)).length;
  }
  nextId(): number {
    return this.state.seq++;
  }

  // ---------- 訂閱 / 持久化 ----------
  subscribe(fn: () => void): () => void {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  }
  emit() {
    this.version++;
    this.onChange?.(this);
    this.listeners.forEach((f) => f());
  }

  // ---------- 時光倒流 ----------
  snapshot(): string {
    return JSON.stringify(this.state);
  }
  pushCheckpoint(label: string) {
    this.checkpoints.push({ id: this.cpSeq++, label, snap: this.snapshot() });
    if (this.checkpoints.length > MAX_CHECKPOINTS) this.checkpoints.shift();
  }
  undoTo(id: number): boolean {
    const i = this.checkpoints.findIndex((c) => c.id === id);
    if (i < 0) return false;
    const cp = this.checkpoints[i];
    this.state = JSON.parse(cp.snap) as GameState;
    this.checkpoints = this.checkpoints.slice(0, i);
    this.state.banner = null;
    this.state.feed.push({ id: this.nextId(), who: 'sys', text: `⏪ 時光倒流：回到「${cp.label}」之前`, kind: 'info' });
    this.emit();
    return true;
  }
  restart() {
    const fresh = Game.create(this.state.levelId);
    this.state = fresh.state;
    this.checkpoints = [];
    this.emit();
  }

  // ---------- 通知 ----------
  notify(who: Actor | 'sys', text: string, kind: 'info' | 'good' | 'alert' = 'info') {
    this.state.feed.push({ id: this.nextId(), who, text, kind });
    if (this.state.feed.length > 60) this.state.feed.shift();
  }

  // ---------- 後處理：機器人事件、陷阱、判定 ----------
  post(emit = true) {
    syncMei(this.w);
    const evs = this.def.events ?? [];
    for (let pass = 0; pass < 8; pass++) {
      let fired = false;
      for (const ev of evs) {
        const key = `ev:${ev.id}`;
        if (!ev.repeat && this.state.flags[key]) continue;
        if (ev.when(this)) {
          if (!ev.repeat) this.state.flags[key] = true;
          ev.run(this);
          syncMei(this.w);
          fired = true;
        }
      }
      if (!fired) break;
    }
    for (const t of this.def.traps ?? []) {
      if (this.state.traps.includes(t.id)) continue;
      const msg = t.test(this);
      if (msg) {
        this.state.traps.push(t.id);
        this.state.banner = { id: t.id, text: msg };
      }
    }
    if (!this.state.done && !this.def.free && this.def.objectives.every((o) => o.done(this))) {
      this.state.done = true;
      this.notify('sys', '🎉 這一關過關了！', 'good');
    }
    if (emit) this.emit();
  }

  /** 橫幅文字依「現在」的狀態重算（例如 commit 之後 AI 又 push 了），算不出來就用觸發當下的文字 */
  bannerText(): string {
    const b = this.state.banner;
    if (!b) return '';
    const t = (this.def.traps ?? []).find((x) => x.id === b.id);
    try {
      return (t && t.test(this)) || b.text;
    } catch {
      return b.text;
    }
  }

  objectives(): (Objective & { isDone: boolean })[] {
    return this.def.objectives.map((o) => ({ ...o, isDone: safe(() => o.done(this)) }));
  }
  currentObjective(): (Objective & { isDone: boolean }) | null {
    return this.objectives().find((o) => !o.isDone && (!o.show || safe(() => o.show!(this)))) ?? null;
  }

  // ---------- 提示 ----------
  revealHint(): boolean {
    const o = this.currentObjective();
    if (!o) return false;
    const cur = this.state.hintTier[o.id] ?? 0;
    if (cur >= 3) return false;
    this.state.hintTier[o.id] = cur + 1;
    this.emit();
    return true;
  }

  // ---------- 終端機 ----------
  runTerminal(line: string) {
    const raw = line.trim();
    if (!raw) return;
    const s = this.state;
    const br = this.branch;
    if (raw === 'clear') {
      s.term = [];
      s.hist.push({ cmd: raw, code: 0, src: 'user', tag: 'clear', branch: br, seq: this.nextId() });
      this.emit();
      return;
    }
    const mutating = isMutating(raw);
    const before = mutating ? JSON.stringify(this.w) : '';
    if (mutating) this.pushCheckpoint(`指令：${raw.length > 30 ? raw.slice(0, 30) + '…' : raw}`);
    s.term.push({ kind: 'cmd', text: raw, branch: br, src: 'user' });
    const res = runShellLine(this.w, 'me', raw, 'me');
    // 沒有改到任何東西（例如被拒絕的指令）就不留檢查點
    if (mutating && JSON.stringify(this.w) === before) this.checkpoints.pop();
    if (res.out) s.term.push({ kind: res.code === 0 ? 'out' : 'err', text: res.out });
    if (res.explain) s.term.push({ kind: 'explain', text: res.explain });
    s.hist.push({ cmd: raw, code: res.code, src: 'user', tag: res.tag, branch: br, seq: this.nextId() });
    if (s.term.length > 400) s.term.splice(0, s.term.length - 400);
    this.post();
  }

  // ---------- 編輯器 ----------
  applyEdit(id: string): boolean {
    const e = this.def.edits?.find((x) => x.id === id);
    if (!e) return false;
    if (e.available && !e.available(this)) return false;
    e.apply(this.w, this);
    this.state.flags[`edit:${id}`] = (this.state.flags[`edit:${id}`] ?? 0) + 1;
    this.state.hist.push({ cmd: `[編輯器] ${e.label}`, code: 0, src: 'user', tag: 'edit', branch: this.branch, seq: this.nextId() });
    this.post();
    return true;
  }
  saveFile(path: string, text: string) {
    this.me.work[path] = text;
    this.state.hist.push({ cmd: `[編輯器] 儲存 ${path}`, code: 0, src: 'user', tag: 'save', branch: this.branch, seq: this.nextId() });
    this.post();
  }

  // ---------- GitHub 網頁操作 ----------
  ghCreatePR(o: { title: string; body: string; head: string; base: string; draft: boolean }): { pr?: PR; error?: string } {
    const res = createPR(this.w, { ...o, author: 'me' });
    if (res.pr) {
      this.state.hist.push({ cmd: `[GitHub] 開${o.draft ? ' Draft ' : ' '}PR #${res.pr.number}`, code: 0, src: 'user', tag: 'gh-web-create', seq: this.nextId() });
      this.post();
    }
    return res;
  }
  ghReady(n: number) {
    const pr = this.pr(n);
    if (!pr) return;
    this.pushCheckpoint(`把 PR #${n} 轉成 Ready`);
    markReady(pr, this.def.role === 'lead' ? 'boss' : 'me');
    this.state.hist.push({ cmd: `[GitHub] PR #${n} Ready for review`, code: 0, src: 'user', tag: 'gh-web-ready', seq: this.nextId() });
    this.post();
  }
  ghDraft(n: number) {
    const pr = this.pr(n);
    if (!pr) return;
    convertToDraft(pr, 'me');
    this.post();
  }
  ghUpdateBranch(n: number): string | null {
    const pr = this.pr(n);
    if (!pr) return '找不到 PR';
    this.pushCheckpoint(`按 PR #${n} 的 Update branch`);
    const res = updateBranch(this.w, pr, this.def.role === 'lead' ? 'boss' : 'me');
    if (res.ok) this.state.hist.push({ cmd: `[GitHub] PR #${n} Update branch`, code: 0, src: 'user', tag: 'gh-web-update', seq: this.nextId() });
    else this.checkpoints.pop();
    this.post();
    return res.ok ? null : res.error ?? null;
  }
  ghMerge(n: number, method: 'squash' | 'merge'): string | null {
    const pr = this.pr(n);
    if (!pr) return '找不到 PR';
    this.pushCheckpoint(`合併 PR #${n}（${method === 'squash' ? 'Squash and merge' : 'Create a merge commit'}）`);
    const by: Actor = this.def.role === 'lead' ? 'boss' : 'me';
    const res = mergePR(this.w, pr, method, by);
    if (res.ok) this.state.hist.push({ cmd: `[GitHub] 合併 PR #${n} (${method})`, code: 0, src: 'user', tag: 'gh-web-merge', seq: this.nextId() });
    else this.checkpoints.pop();
    this.post();
    return res.ok ? null : res.error ?? null;
  }
  ghRevert(n: number): string | null {
    this.pushCheckpoint(`按 PR #${n} 的 Revert`);
    const res = revertPR(this.w, n, this.def.role === 'lead' ? 'boss' : 'me');
    if (res.pr) this.state.hist.push({ cmd: `[GitHub] Revert PR #${n}`, code: 0, src: 'user', tag: 'gh-web-revert', seq: this.nextId() });
    else this.checkpoints.pop();
    this.post();
    return res.pr ? null : res.error ?? null;
  }
  ghReview(n: number, state: 'approved' | 'changes_requested' | 'commented', body: string, todos: string[]) {
    const pr = this.pr(n);
    if (!pr) return;
    this.pushCheckpoint(`對 PR #${n} 送出審查`);
    submitReview(this.w, pr, this.def.role === 'lead' ? 'boss' : 'me', state, body, todos);
    this.state.hist.push({ cmd: `[GitHub] 審查 PR #${n}：${state}`, code: 0, src: 'user', tag: 'gh-web-review', seq: this.nextId() });
    this.post();
  }
  ghComment(n: number, body: string) {
    const pr = this.pr(n);
    if (!pr) return;
    addComment(pr, 'me', body);
    this.post();
  }
  ghClose(n: number) {
    const pr = this.pr(n);
    if (!pr) return;
    closePR(pr, 'me');
    this.post();
  }
  visit(tab: string) {
    const v = (this.state.flags.visited ??= {});
    if (!v[tab]) {
      v[tab] = true;
      this.post();
    }
  }

  // ---------- AI：對話 ----------
  addChat(m: NewChat): ChatMsg {
    const msg = { ...m, id: this.nextId() } as ChatMsg;
    this.state.chat.push(msg);
    return msg;
  }
  toolMsg(id: number | null) {
    return this.state.chat.find((m) => m.t === 'tool' && m.id === id) as Extract<ChatMsg, { t: 'tool' }> | undefined;
  }
  get agentBusy() {
    return this.state.agent.status !== 'idle';
  }
  offer(): { label: string; options: PromptOption[] } | null {
    if (!this.def.agent || this.agentBusy) return null;
    return this.def.agent.offer(this);
  }
  chooseOption(optionId: string): boolean {
    const off = this.offer();
    const opt = off?.options.find((o) => o.id === optionId);
    if (!opt) return false;
    this.pushCheckpoint(`對 AI 說：「${opt.text.length > 28 ? opt.text.slice(0, 28) + '…' : opt.text}」`);
    const um = this.addChat({ t: 'user', text: opt.text });
    (this.state.flags.sayLog ??= []).push({ msgId: um.id, text: opt.text, quality: opt.quality, note: opt.note });
    this.state.flags[`said:${opt.id}`] = (this.state.flags[`said:${opt.id}`] ?? 0) + 1;
    this.state.flags.lastSaid = opt.id;
    this.state.hist.push({ cmd: `[對 AI 說] ${opt.text}`, code: 0, src: 'user', tag: 'say', seq: this.nextId() });
    const a = this.state.agent;
    a.frames = [{ script: opt.script, pc: 0 }];
    a.status = 'running';
    this.post();
    return true;
  }
  private callScript(id?: string) {
    if (id) this.state.agent.frames.push({ script: id, pc: 0 });
  }
  private script(id: string): Step[] {
    return this.def.agent?.scripts[id] ?? [];
  }

  /** 前進一步。回傳建議的等待時間（毫秒）；waiting＝正在等玩家回覆權限視窗 */
  agentStep(): { delay: number; waiting?: boolean; done?: boolean; armed?: boolean } {
    const a = this.state.agent;
    if (a.status === 'awaiting') return { delay: 0, waiting: true };
    if (a.armedTool !== null) return this.runArmed();
    while (a.frames.length) {
      const f = a.frames[a.frames.length - 1];
      const sc = this.script(f.script);
      if (f.pc >= sc.length) {
        a.frames.pop();
        continue;
      }
      return this.runStep(sc[f.pc]);
    }
    a.status = 'idle';
    this.emit();
    return { delay: 0, done: true };
  }

  private topFrame() {
    const fr = this.state.agent.frames;
    return fr[fr.length - 1];
  }

  private runStep(step: Step): { delay: number; waiting?: boolean; armed?: boolean } {
    const a = this.state.agent;
    const f = this.topFrame();
    switch (step.k) {
      case 'say': {
        f.pc++;
        this.addChat({ t: 'ai', text: step.text });
        this.emit();
        return { delay: Math.min(2600, 500 + step.text.length * 22) };
      }
      case 'do': {
        f.pc++;
        step.fn(this);
        this.post();
        return { delay: 250 };
      }
      case 'call': {
        f.pc++;
        this.callScript(step.script);
        return this.agentStep();
      }
      case 'if': {
        f.pc++;
        this.callScript(step.cond(this) ? step.then : step.else);
        return this.agentStep();
      }
      case 'edit': {
        const m = this.addChat({ t: 'tool', kind: 'Edit', cmd: step.label, state: step.risky ? 'pending' : 'running' }) as Extract<ChatMsg, { t: 'tool' }>;
        if (step.risky) {
          a.armedTool = m.id;
          this.emit();
          return { delay: 4500, armed: true };
        }
        step.apply(this.w);
        m.state = 'done';
        f.pc++;
        this.post();
        return { delay: 700 };
      }
      case 'run': {
        const m = this.addChat({ t: 'tool', kind: 'Bash', cmd: step.cmd, state: 'running', why: step.why }) as Extract<ChatMsg, { t: 'tool' }>;
        const d = checkCommand(step.cmd);
        if (d.kind === 'deny') {
          m.state = 'blocked';
          m.rule = `Bash(${d.rule})`;
          m.reason = '命中團隊的 deny 規則，已擋下，沒有執行。';
          f.pc++;
          this.callScript(step.blocked);
          this.state.hist.push({ cmd: `[AI 被擋] ${step.cmd}`, code: 1, src: 'agent', tag: 'blocked', seq: this.nextId() });
          this.post();
          return { delay: 1100 };
        }
        if (d.kind === 'auto-block') {
          m.state = 'auto-blocked';
          m.reason = `Auto 模式自己的安全機制擋下了：${d.reason}`;
          f.pc++;
          this.callScript(step.blocked);
          this.state.hist.push({ cmd: `[AI 被擋] ${step.cmd}`, code: 1, src: 'agent', tag: 'auto-blocked', seq: this.nextId() });
          this.post();
          return { delay: 1100 };
        }
        if (d.kind === 'ask') {
          m.state = 'awaiting';
          m.rule = `Bash(${d.rule})`;
          a.status = 'awaiting';
          a.pendingTool = m.id;
          this.emit();
          return { delay: 0, waiting: true };
        }
        if (step.risky) {
          m.state = 'pending';
          a.armedTool = m.id;
          this.emit();
          return { delay: 4500, armed: true };
        }
        return this.finishRun(m, step);
      }
    }
  }

  private finishRun(m: Extract<ChatMsg, { t: 'tool' }>, step: Extract<Step, { k: 'run' }>): { delay: number } {
    const f = this.topFrame();
    const br = this.branch;
    m.state = 'running';
    const res = runShellLine(this.w, 'me', step.cmd, 'me');
    m.out = [res.out].filter(Boolean).join('\n');
    m.code = res.code;
    m.state = 'done';
    this.state.hist.push({ cmd: step.cmd, code: res.code, src: 'agent', tag: res.tag, branch: br, seq: this.nextId() });
    f.pc++;
    this.callScript(res.code === 0 ? step.ok : step.failed);
    this.post();
    return { delay: 900 };
  }

  private runArmed(): { delay: number } {
    const a = this.state.agent;
    const id = a.armedTool;
    a.armedTool = null;
    const m = this.toolMsg(id);
    const f = this.topFrame();
    const step = f ? this.script(f.script)[f.pc] : undefined;
    if (!m || !step) return { delay: 0 };
    if (step.k === 'edit') {
      step.apply(this.w);
      m.state = 'done';
      f.pc++;
      this.post();
      return { delay: 700 };
    }
    if (step.k === 'run') return this.finishRun(m, step);
    return { delay: 0 };
  }

  /** 玩家對權限視窗的回覆 */
  decidePermission(choice: 'allow' | 'deny' | 'tell', text?: string) {
    const a = this.state.agent;
    if (a.status !== 'awaiting') return;
    const m = this.toolMsg(a.pendingTool);
    const f = this.topFrame();
    const step = f ? this.script(f.script)[f.pc] : undefined;
    if (!m || !step || step.k !== 'run') {
      a.status = 'running';
      return;
    }
    this.pushCheckpoint(`${choice === 'allow' ? '允許' : '拒絕'} AI 執行 ${step.cmd.length > 26 ? step.cmd.slice(0, 26) + '…' : step.cmd}`);
    a.status = 'running';
    a.pendingTool = null;
    if (choice === 'allow') {
      this.finishRun(m, step);
    } else {
      m.state = 'denied';
      m.reason = choice === 'tell' ? `你告訴 Claude：「${text || '換個方法'}」` : '你拒絕了這個操作。';
      if (choice === 'tell') this.addChat({ t: 'user', text: text || '不要這樣做，換個方法' });
      f.pc++;
      this.callScript(step.denied);
      this.state.hist.push({ cmd: `[拒絕] ${step.cmd}`, code: 1, src: 'user', tag: 'perm-denied', seq: this.nextId() });
      this.post();
    }
  }

  pressEsc(): boolean {
    const a = this.state.agent;
    if (a.status === 'idle') return false;
    const armed = this.toolMsg(a.armedTool);
    const pending = this.toolMsg(a.pendingTool);
    if (armed) armed.state = 'interrupted';
    if (pending) pending.state = 'denied';
    a.frames = [];
    a.armedTool = null;
    a.pendingTool = null;
    a.status = 'idle';
    this.state.flags.interrupted = (this.state.flags.interrupted ?? 0) + 1;
    this.state.flags.lastInterruptedCmd = armed?.cmd ?? pending?.cmd ?? '';
    this.addChat({ t: 'sys', text: '⎿ 已中斷（你按了 Esc）', tone: 'warn' });
    this.state.hist.push({ cmd: '[Esc] 打斷 AI', code: 0, src: 'user', tag: 'esc', seq: this.nextId() });
    this.post();
    return true;
  }

  /** 無頭模式：一路執行到閒置／等權限／（可選）armed。回傳停在哪裡。 */
  agentRun(o: { stopAtArmed?: boolean; maxSteps?: number } = {}): 'idle' | 'awaiting' | 'armed' {
    for (let i = 0; i < (o.maxSteps ?? 400); i++) {
      const a = this.state.agent;
      if (a.status === 'awaiting') return 'awaiting';
      if (o.stopAtArmed && a.armedTool !== null) return 'armed';
      const r = this.agentStep();
      if (r.done) return 'idle';
      if (r.waiting) return 'awaiting';
      if (o.stopAtArmed && r.armed) return 'armed';
    }
    throw new Error('agentRun: 步數超過上限');
  }
}

/** 會改動 repo / 工作資料夾 / GitHub 的指令：執行前先留一個時光倒流的檢查點 */
export function isMutating(line: string): boolean {
  return splitCommands(line).some((p) => {
    const c = p.cmd.replace(/\s+/g, ' ').trim();
    if (/^git (add|commit|push|pull|merge|rebase|reset|revert|cherry-pick|switch|checkout|restore|rm|stash|clean|config|remote|fetch|mv|tag)\b/.test(c)) return true;
    if (/^git branch\b/.test(c)) return /\s-(d|D|m|M|u)\b|--set-upstream-to|--unset-upstream|--delete|--move/.test(c) || /^git branch [^-]/.test(c);
    if (/^gh pr (create|merge|ready)\b/.test(c)) return true;
    if (/^(rm|touch|mkdir)\b/.test(c) || /^echo .*>/.test(c)) return true;
    return false;
  });
}

function safe(fn: () => boolean): boolean {
  try {
    return fn();
  } catch {
    return false;
  }
}
