// 由關卡定義產生 docs/design/04-關卡劇本.md：每一關的故事、目標、三層提示、AI 台詞與選項、機器人事件、陷阱訊息與過關說明。
// 用法：npm run docs:levels
// 選項、機器人訊息與陷阱訊息是「動態」的（取決於玩家做了什麼），所以這裡用無頭的 Game 把 AI 的選項樹走一遍（含「允許／拒絕／Esc」分支）來蒐集。
import { writeFileSync } from 'node:fs';
import { Game } from '../src/core/game';
import { LEVELS } from '../src/levels';
import type { LevelDef } from '../src/levels/types';
import type { PromptOption, Step } from '../src/agent/types';
import { RULES, ruleOf, splitCodes } from '../src/levels/rules';

const clone = (g: Game): Game => Game.restore(JSON.parse(JSON.stringify(g.state)));

interface Collected {
  options: Map<string, { label: string; opt: PromptOption }>;
  feed: Map<string, string>;
  banners: Map<string, string>;
  perms: Map<string, string>;
  nodes: number;
}

function collect(def: LevelDef): Collected {
  const c: Collected = { options: new Map(), feed: new Map(), banners: new Map(), perms: new Map(), nodes: 0 };
  const g0 = Game.create(def.id);
  const record = (g: Game) => {
    for (const f of g.state.feed) if (f.who !== 'sys') c.feed.set(`${f.who}|${f.text}`, f.text);
    if (g.state.banner) c.banners.set(g.state.banner.id, g.state.banner.text);
    for (const m of g.state.chat) if (m.t === 'tool' && m.state === 'awaiting' && m.rule) c.perms.set(m.cmd, m.rule);
  };
  const seen = new Set<string>();
  const explore = (g: Game, budget: number) => {
    if (++c.nodes > 3000) return;
    record(g);
    const off = g.offer();
    if (!off || budget <= 0) return;
    for (const o of off.options) {
      if (!c.options.has(o.id)) c.options.set(o.id, { label: off.label, opt: o });
      const g2 = clone(g);
      g2.chooseOption(o.id);
      drive(g2, budget - 1);
    }
  };
  const drive = (g: Game, budget: number) => {
    if (c.nodes > 3000) return;
    const r = g.agentRun({ stopAtArmed: true });
    record(g);
    if (r === 'idle') {
      const key = JSON.stringify([g.state.flags, g.state.chat.length, g.state.hist.length]);
      if (seen.has(key)) return;
      seen.add(key);
      explore(g, budget);
    } else if (r === 'awaiting') {
      for (const ch of ['allow', 'deny'] as const) {
        const g2 = clone(g);
        g2.decidePermission(ch);
        drive(g2, budget);
      }
    } else {
      const g2 = clone(g);
      g2.agentStep();
      drive(g2, budget);
      const g3 = clone(g);
      g3.pressEsc();
      drive(g3, budget);
    }
  };
  if (def.agent) explore(g0, 5);
  record(g0);
  return c;
}

const q = (s: string) => s.replace(/\n/g, '\n  ');
const QUALITY: Record<string, string> = { good: '好', ok: '還行', vague: '太模糊／危險' };

function stepLine(s: Step): string | null {
  switch (s.k) {
    case 'say':
      return `- 🤖 ${q(s.text)}`;
    case 'run':
      return `- 🔧 \`${s.cmd}\`${s.why ? `（${s.why}）` : ''}${s.risky ? ' ⏱即將執行（可按 Esc）' : ''}${s.ok ? ` → 成功：\`${s.ok}\`` : ''}${s.failed ? ` → 失敗：\`${s.failed}\`` : ''}${s.blocked ? ` → 被擋下：\`${s.blocked}\`` : ''}${s.denied ? ` → 你拒絕：\`${s.denied}\`` : ''}`;
    case 'edit':
      return `- ✏️ 改檔：${s.label}${s.risky ? ' ⏱即將執行（可按 Esc）' : ''}`;
    case 'call':
      return `- ↪ 接著跑 \`${s.script}\``;
    case 'if':
      return `- ❓ 條件分支：${s.then ? `成立 → \`${s.then}\`` : ''}${s.else ? `　不成立 → \`${s.else}\`` : ''}`;
    default:
      return null; // 'do'：只改內部旗標，沒有玩家看得到的文字
  }
}

function level(def: LevelDef): string {
  const out: string[] = [];
  out.push(`## ${def.id === 11 ? '★' : `第 ${def.id} 關`}　${def.title}`);
  out.push('');
  out.push(
    `- 第 ${def.part} 部　・　角色：${def.role === 'lead' ? '部長' : '部員'}　・　約 ${def.minutes} 分鐘${def.optional ? '　・　部長必修、部員選修' : ''}`,
  );
  out.push(`- 規則：${def.rules.length ? def.rules.join('、') : '（無）'}`);
  out.push(`- 地圖卡簡介：${def.blurb}`);
  out.push('');
  out.push('### 故事（任務卡）');
  out.push('');
  for (const s of def.story) out.push(s, '');

  out.push('### 目標與三層提示');
  out.push('');
  if (def.free) out.push('（自由模式沒有固定目標，也不會過關。）', '');
  for (const o of def.objectives) {
    out.push(`**${o.human ? '🧑 ' : ''}${o.id}**：${o.label}`, '');
    const h = def.hints[o.id];
    if (h) {
      out.push(`1. 方向：${h[0]}`);
      out.push(`2. 指令：${h[1]}`);
      out.push(`3. 示範：${h[2]}`, '');
    }
  }

  if (def.edits?.length) {
    out.push('### 編輯器按鈕（代表你把程式寫好了）', '');
    for (const e of def.edits) out.push(`- 「${e.label}」：${e.hint}`);
    out.push('');
  }

  if (def.review) {
    out.push('### 審查待辦清單（Request changes 時可勾選）', '');
    for (const t of def.review.todos) out.push(`- ${t.label}`);
    out.push('');
  }

  const c = collect(def);

  if (def.agent) {
    out.push('### AI 腳本', '');
    out.push(`模式：${def.agent.auto ? 'Auto 模式' : '手動模式'}。開場白：${def.agent.intro ?? '（無）'}`, '');
    for (const [name, steps] of Object.entries(def.agent.scripts)) {
      out.push(`#### 腳本 \`${name}\``, '');
      for (const st of steps) {
        const l = stepLine(st);
        if (l) out.push(l);
      }
      out.push('');
    }

    out.push('### 給玩家選的話（含刻意模糊的壞選項）', '');
    if (!c.options.size) out.push('（這一關沒有選項。）', '');
    const byLabel = new Map<string, PromptOption[]>();
    for (const { label, opt } of c.options.values()) byLabel.set(label, [...(byLabel.get(label) ?? []), opt]);
    for (const [label, opts] of byLabel) {
      out.push(`- **${label}**`);
      for (const opt of opts) {
        out.push(`  - \`${opt.id}\`［${QUALITY[opt.quality]}］${q(opt.text)}`);
        out.push(`    - 事後解說：${q(opt.note)}`);
      }
    }
    out.push('');
    if (c.perms.size) {
      out.push('### 權限視窗（ask 規則）', '');
      for (const [cmd, rule] of c.perms) out.push(`- \`${cmd}\` 符合 ask 規則 \`${rule}\``);
      out.push('');
    }
  }

  if (c.feed.size) {
    out.push('### 機器人與同學的動態（走一遍選項樹時蒐集到的）', '');
    for (const t of c.feed.keys()) out.push(`- ${t.replace('|', '：')}`);
    out.push('');
  }

  const bannerIds = (def.traps ?? []).map((t) => t.id);
  if (bannerIds.length) {
    out.push('### 陷阱（走錯路的後果）', '');
    out.push(`陷阱 id：${bannerIds.map((i) => `\`${i}\``).join('、')}`, '');
    for (const [id, text] of c.banners) out.push(`- \`${id}\`：${q(text)}`);
    out.push('');
  }

  out.push('### 過關畫面', '');
  for (const s of def.success.summary) out.push(`- ${q(s)}`);
  if (def.success.rules.length) {
    out.push('', '這一關練到的規則：', '');
    for (const r of def.success.rules) out.push(`- **${r.code}**　${r.text}`);
  }
  out.push('');
  return out.join('\n');
}

const head = `# 04　關卡劇本（自動產生）

> 這份檔案由 \`npm run docs:levels\`（\`scripts/gen-level-script.ts\`）從 \`src/levels/\` 的關卡定義直接產生，**請改關卡定義，不要手改這裡**。
> 它的用途是讓審稿的人不用讀程式碼，就能看到每一關寫給玩家的全部文字：故事、目標、三層提示、AI 的台詞、玩家可選的話（含刻意模糊的壞選項）、機器人事件、走錯路的後果與過關說明。
> 選項、機器人動態與陷阱訊息會依玩家的行動而不同；產生器用無頭的遊戲核心把 AI 的選項樹走了一遍（包含「允許／拒絕／Esc」的分支），所以涵蓋到實際可能出現的文字。若有某句話只在很特殊的操作順序下才會出現，這裡可能漏掉——以程式碼為準。
>
> 全部內容為虛構：專案「小共筆 TinyNote」、人物「小美」「部長」都是機器人，規則代號（G1、P5、§11…）只是練習用的編號。

`;

const rulesSection = `## 規則速查（遊戲內「規則速查」面板的文字）

${RULES
  .map((r) => `- **${r.code}**　${r.text}`)
  .join('\n')}

`;

void ruleOf;
void splitCodes;

const body = LEVELS.map(level).join('\n---\n\n');
writeFileSync(new URL('../docs/design/04-關卡劇本.md', import.meta.url), head + rulesSection + '---\n\n' + body + '\n', { encoding: 'utf8' });
console.log('wrote docs/design/04-關卡劇本.md');
