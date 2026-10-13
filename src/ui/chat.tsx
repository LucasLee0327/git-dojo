// 仿 Claude Code 桌面版的 AI 助手面板：對話泡泡、可展開的工具呼叫卡片、權限視窗、Esc 打斷。
import { useEffect, useMemo, useRef, useState } from 'preact/hooks';
import type { Game } from '../core/game';
import type { ChatMsg } from '../core/types';
import type { Speed } from '../store/save';
import { Driver, typingDelay } from './driver';

type ToolMsg = Extract<ChatMsg, { t: 'tool' }>;

/** 選項的顯示順序固定但不照「好→壞」排，免得玩家靠位置猜答案 */
function shuffled<T extends { id: string }>(xs: T[]): T[] {
  const h = (id: string) => [...id].reduce((n, c) => (n * 31 + c.charCodeAt(0)) % 9973, 7);
  return [...xs].sort((a, b) => h(a.id) - h(b.id));
}

const typed = new Set<number>();
const revealed = new Set<number>();

export function resetChatMemo(g: Game) {
  typed.clear();
  revealed.clear();
  for (const m of g.state.chat) {
    typed.add(m.id);
    revealed.add(m.id);
  }
}

function Inline({ text }: { text: string }) {
  const parts = text.split(/(`[^`]+`)/g);
  return (
    <>
      {parts.map((p, i) => (p.startsWith('`') && p.endsWith('`') && p.length > 2 ? <code key={i}>{p.slice(1, -1)}</code> : <span key={i}>{p}</span>))}
    </>
  );
}

function Typed({ id, text, speed }: { id: number; text: string; speed: Speed }) {
  const [n, setN] = useState(typed.has(id) ? text.length : 0);
  useEffect(() => {
    if (typed.has(id)) {
      setN(text.length);
      return;
    }
    const d = typingDelay(speed);
    if (d === 0) {
      typed.add(id);
      setN(text.length);
      return;
    }
    let i = 0;
    const t = window.setInterval(() => {
      i += 2;
      setN(i);
      if (i >= text.length) {
        window.clearInterval(t);
        typed.add(id);
      }
    }, d);
    return () => window.clearInterval(t);
  }, [id]);
  const shown = n >= text.length ? text : text.slice(0, n);
  return (
    <span class={n < text.length ? 'typing' : ''}>
      <Inline text={shown} />
    </span>
  );
}

const STATE_LABEL: Record<string, string> = {
  pending: '即將執行',
  running: '執行中',
  done: '完成',
  blocked: '已擋下（deny 規則）',
  'auto-blocked': '已擋下（Auto 模式）',
  denied: '你拒絕了',
  interrupted: '已中斷（Esc）',
  awaiting: '等你許可',
};

function ToolCard({ m, speed }: { m: ToolMsg; speed: Speed }) {
  const fake = !revealed.has(m.id) && m.state === 'done' && speed !== 'instant';
  const [showing, setShowing] = useState(fake);
  const [open, setOpen] = useState(true);
  useEffect(() => {
    if (!fake) {
      revealed.add(m.id);
      return;
    }
    const t = window.setTimeout(() => {
      revealed.add(m.id);
      setShowing(false);
    }, speed === 'fast' ? 200 : speed === 'slow' ? 900 : 500);
    return () => window.clearTimeout(t);
  }, []);
  const state = showing ? 'running' : m.state;
  const ok = m.state === 'done' && (m.code === undefined || m.code === 0);
  const cls = state === 'done' ? (ok ? 'ok' : 'fail') : state;
  const out = !showing && m.out ? m.out : '';
  return (
    <div class={`tool ${cls}`}>
      <button class="tool-head" onClick={() => setOpen(!open)} aria-expanded={open}>
        <span class="tool-kind">{m.kind === 'Bash' ? 'Bash' : 'Edit'}</span>
        <span class="tool-cmd mono">{m.kind === 'Bash' ? m.cmd : m.cmd}</span>
        <span class={`tool-state s-${cls}`}>
          {state === 'running' && <i class="spin" />}
          {state === 'done' ? (ok ? '✓ 完成' : `✗ exit ${m.code}`) : STATE_LABEL[state]}
        </span>
      </button>
      {m.why && <div class="tool-why">{m.why}</div>}
      {(m.reason || m.rule) && (
        <div class="tool-reason">
          {m.state === 'blocked' && '⛔ '}
          {m.state === 'auto-blocked' && '🛡 '}
          {m.reason}
          {m.rule && <code> {m.rule}</code>}
        </div>
      )}
      {open && out && <pre class="tool-out">{out}</pre>}
    </div>
  );
}

export function Chat({ g, driver, speed }: { g: Game; driver: Driver; speed: Speed }) {
  const s = g.state;
  const def = g.def;
  const a = s.agent;
  const scroller = useRef<HTMLDivElement>(null);
  const inner = useRef<HTMLDivElement>(null);
  const stick = useRef(true);
  const [tell, setTell] = useState('');
  const [tellOpen, setTellOpen] = useState(false);
  const offer = g.offer();
  const sayLog: { msgId: number; quality: string; note: string }[] = s.flags.sayLog ?? [];
  const idle = a.status === 'idle';

  useEffect(() => {
    const el = scroller.current;
    const body = inner.current;
    if (!el || !body) return;
    const ro = new ResizeObserver(() => {
      if (stick.current) el.scrollTop = el.scrollHeight;
    });
    ro.observe(body);
    return () => ro.disconnect();
  }, []);

  const armedMsg = useMemo(() => (a.armedTool !== null ? g.toolMsg(a.armedTool) : undefined), [g.version, a.armedTool]);
  const pendingMsg = a.status === 'awaiting' ? g.toolMsg(a.pendingTool) : undefined;
  const armedInfo = driver.armed && armedMsg && driver.armed.toolId === armedMsg.id ? driver.armed : null;

  if (!def.agent) {
    return (
      <section class="chat" aria-label="AI 助手">
        <header class="pane-head">
          <span class="claude-dot" /> <strong>Claude</strong>
          <span class="tag off">這一關不用 AI</span>
        </header>
        <div class="chat-body">
          <div class="chat-empty">
            <p>這一關要靠你自己動手：在下面的終端機打 git 指令，右邊的分頁看結果。</p>
            <p class="dim">前幾關先把手打的基本功練好；看得懂 AI 在做什麼，才攔得住它。第 5 關開始會讓 AI 幫忙。</p>
          </div>
        </div>
      </section>
    );
  }

  return (
    <section class="chat" aria-label="AI 助手">
      <header class="pane-head">
        <span class="claude-dot" /> <strong>Claude</strong>
        <span class="tag auto" title="AI 在 Auto 模式下跑：多數操作不問你直接執行，只有團隊規則列到的才會擋下或詢問。你隨時可以按 Esc 打斷它。">
          {def.agent.auto ? 'Auto 模式' : '手動模式'}
        </span>
        <span class="tag sim" title="這是模擬的 AI：回應都是預先寫好的，不連任何 API">
          模擬
        </span>
      </header>
      <div
        class="chat-body"
        ref={scroller}
        onScroll={(e) => {
          const el = e.currentTarget;
          stick.current = el.scrollHeight - el.scrollTop - el.clientHeight < 60;
        }}
      >
        <div ref={inner} class="chat-inner">
          {def.agent.intro && (
            <div class="msg ai">
              <span class="av" />
              <div class="bub">{def.agent.intro}</div>
            </div>
          )}
          {s.chat.map((m) => {
            if (m.t === 'user') {
              const log = sayLog.find((x) => x.msgId === m.id);
              return (
                <div key={m.id} class="msg user">
                  <div class="bub">{m.text}</div>
                  {log && idle && (
                    <details class={`review q-${log.quality}`}>
                      <summary>
                        回顧這句話：{log.quality === 'good' ? '清楚' : log.quality === 'ok' ? '還行' : '太模糊'}
                      </summary>
                      <p>{log.note}</p>
                    </details>
                  )}
                </div>
              );
            }
            if (m.t === 'ai')
              return (
                <div key={m.id} class="msg ai">
                  <span class="av" />
                  <div class="bub">
                    <Typed id={m.id} text={m.text} speed={speed} />
                  </div>
                </div>
              );
            if (m.t === 'sys')
              return (
                <div key={m.id} class={`msg sys ${m.tone ?? ''}`}>
                  {m.text}
                </div>
              );
            return <ToolCard key={m.id} m={m} speed={speed} />;
          })}
          {a.status === 'running' && a.armedTool === null && (
            <div class="msg ai thinking">
              <span class="av" />
              <div class="bub dots">
                <i />
                <i />
                <i />
              </div>
            </div>
          )}
        </div>
      </div>

      {armedMsg && (
        <div class="armed" role="alert">
          <div class="armed-top">
            <b>⏱ Claude 即將執行</b>
            <code class="mono">{armedMsg.cmd}</code>
          </div>
          <div class="armed-sub">沒有規則擋它，也不會問你。要攔就趁現在按 Esc。</div>
          {armedInfo && <div key={armedInfo.toolId} class="armed-bar" style={`animation-duration:${Math.max(1, armedInfo.total)}ms`} />}
          <button class="btn danger" onClick={() => g.pressEsc()}>
            Esc 中斷
          </button>
        </div>
      )}

      {pendingMsg && (
        <div class="perm" role="alertdialog" aria-label="權限視窗">
          <div class="perm-title">Claude 想執行這個指令，可以嗎？</div>
          <code class="perm-cmd mono">$ {pendingMsg.cmd}</code>
          <div class="perm-rule">
            這個指令符合團隊的 <b>ask</b> 規則 <code>{pendingMsg.rule}</code>，所以要問你。
          </div>
          <div class="perm-btns">
            <button
              class="btn primary"
              onClick={() => {
                g.decidePermission('allow');
                driver.poke();
              }}
            >
              允許
            </button>
            <button
              class="btn"
              onClick={() => {
                g.decidePermission('deny');
                driver.poke();
              }}
            >
              拒絕
            </button>
            <button class="btn ghost" onClick={() => setTellOpen(!tellOpen)}>
              告訴 Claude 怎麼做…
            </button>
          </div>
          {tellOpen && (
            <form
              class="perm-tell"
              onSubmit={(e) => {
                e.preventDefault();
                g.decidePermission('tell', tell.trim());
                setTell('');
                setTellOpen(false);
                driver.poke();
              }}
            >
              <input value={tell} onInput={(e) => setTell((e.target as HTMLInputElement).value)} placeholder="例如：不要這樣做，先告訴我原因" aria-label="告訴 Claude 怎麼做" />
              <button class="btn primary" type="submit">
                送出
              </button>
            </form>
          )}
          <div class="perm-esc dim">也可以按 Esc 直接中斷整件事。</div>
        </div>
      )}

      <footer class="chat-input">
        {offer && idle ? (
          <>
            <div class="offer-label">{offer.label}（選一句，它就是你送出的話）</div>
            <div class="offers">
              {shuffled(offer.options).map((o) => (
                <button
                  key={o.id}
                  class="offer"
                  onClick={() => {
                    g.chooseOption(o.id);
                    driver.poke();
                  }}
                >
                  {o.text}
                </button>
              ))}
            </div>
          </>
        ) : a.status === 'running' && !armedMsg ? (
          <div class="busy">
            Claude 正在處理…
            <button class="btn small" onClick={() => g.pressEsc()}>
              Esc 打斷
            </button>
          </div>
        ) : a.status === 'idle' ? (
          <div class="busy dim">Claude 現在沒有可以幫忙的事。繼續用終端機或右邊的分頁吧。</div>
        ) : null}
      </footer>
    </section>
  );
}
