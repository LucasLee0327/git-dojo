// 關卡畫面：任務卡＋AI 助手＋終端機＋（預覽／GitHub／編輯器）＋常駐 git 狀態面板。
import { useEffect, useMemo, useRef, useState } from 'preact/hooks';
import type { Game } from '../core/game';
import type { Stage } from '../levels/types';
import { DENY_RULES, ASK_RULES } from '../agent/perms';
import { getStatus } from '../git/engine';
import { LEVELS } from '../levels';
import { GIT_FACTS, RULES, RULE_GROUPS, ruleOf, splitCodes, type RuleDef } from '../levels/rules';
import { saveMeta, storageStatus, type Meta, type Speed } from '../store/save';
import { Chat, resetChatMemo } from './chat';
import { BranchChip, Modal, RuleCodes, useGame } from './common';
import { Driver, SPEED_LABEL } from './driver';
import { EditorTab } from './editor';
import { FlowMap } from './flow-map';
import { GithubTab } from './github';
import { resetColors } from './graph/colors';
import { GitPanel } from './git-panel';
import { PreviewTab } from './preview';
import { Terminal } from './terminal';

type Tab = 'preview' | 'github' | 'editor';

export interface LevelProps {
  g: Game;
  meta: Meta;
  setMeta: (m: Meta) => void;
  onMap: () => void;
  onOpen: (id: number) => void;
  onResetLevel: () => void;
  onClearAll: () => void;
}

export function LevelScreen(p: LevelProps) {
  const { g, meta } = p;
  useGame(g);
  const s = g.state;
  const def = g.def;
  const metaRef = useRef(meta);
  metaRef.current = meta;
  const [tab, setTab] = useState<Tab>(def.startTab ?? 'preview');
  const [taskOpen, setTaskOpen] = useState(() => s.hist.length === 0);
  const [modal, setModal] = useState<null | 'rules' | 'flow' | 'settings' | 'rewind' | 'success' | 'restart'>(null);
  const [toasts, setToasts] = useState<{ id: number; text: string; kind: string }[]>([]);
  const lastFeed = useRef(0);

  // 進入關卡時重設顏色與動畫記憶（useMemo 讓它發生在第一次繪製之前）
  useMemo(() => {
    resetColors();
    resetChatMemo(g);
    lastFeed.current = Math.max(0, ...g.state.feed.map((f) => f.id));
  }, [g]);

  const driver = useMemo(() => new Driver(g, () => metaRef.current.speed, () => g.emit()), [g]);
  useEffect(() => {
    driver.start();
    return () => driver.stop();
  }, [driver]);

  // 第 0 關第一次進入：自動開一次流程地圖視窗（記在 meta，之後不再自動開）
  useEffect(() => {
    const m = metaRef.current;
    if (def.id !== 0 || m.seenFlowMap) return;
    if (document.querySelector('.modal-back')) return;
    p.setMeta({ ...m, seenFlowMap: true });
    setModal('flow');
  }, []);

  // 第一次動手之後把任務卡收起來，把空間還給工作區（可以隨時再展開）
  const hadHist = useRef(s.hist.length > 0);
  useEffect(() => {
    if (!hadHist.current && s.hist.length > 0) {
      hadHist.current = true;
      setTaskOpen(false);
    }
  }, [s.hist.length]);

  // 切到分頁就算「看過」
  useEffect(() => {
    g.visit(tab === 'github' ? 'github' : tab === 'editor' ? 'editor' : 'preview');
  }, [tab, g]);

  // 全域 Esc：打斷 AI（有視窗開著時，Esc 先關視窗）
  useEffect(() => {
    const h = (e: KeyboardEvent) => {
      if (e.key !== 'Escape') return;
      if (document.querySelector('.modal-back')) return;
      if (g.state.agent.status !== 'idle') {
        e.preventDefault();
        g.pressEsc();
      }
    };
    window.addEventListener('keydown', h);
    return () => window.removeEventListener('keydown', h);
  }, [g]);

  // 通知（小美、部長、系統）
  useEffect(() => {
    const fresh = s.feed.filter((f) => f.id > lastFeed.current && !(f.kind === 'good'));
    if (s.feed.length) lastFeed.current = Math.max(lastFeed.current, ...s.feed.map((f) => f.id));
    if (!fresh.length) return;
    setToasts((t) => [...t, ...fresh.map((f) => ({ id: f.id, text: `${f.who === 'mei' ? '小美：' : f.who === 'boss' ? '部長：' : ''}${f.text}`, kind: f.kind }))].slice(-4));
    const ids = fresh.map((f) => f.id);
    const timer = window.setTimeout(() => setToasts((t) => t.filter((x) => !ids.includes(x.id))), 8000);
    return () => window.clearTimeout(timer);
  }, [g.version]);

  // 過關：跳出成功畫面（只有「從沒過關變成過關」才跳）
  const wasDone = useRef(s.done);
  useEffect(() => {
    if (s.done && !wasDone.current) {
      const m = metaRef.current;
      if (!m.completed.includes(def.id)) p.setMeta({ ...m, completed: [...m.completed, def.id] });
      const t = window.setTimeout(() => setModal('success'), 900);
      wasDone.current = true;
      return () => window.clearTimeout(t);
    }
    wasDone.current = s.done;
  }, [s.done]);

  const objs = g.objectives().filter((o) => {
    try {
      return !o.show || o.show(g);
    } catch {
      return false;
    }
  });
  const cur = g.currentObjective();
  const doneCount = objs.filter((o) => o.isDone).length;
  // 有分階段的關卡：依 stages 把目標分組；不在任何階段的目標（正常不會有）放在最後一組，不加標題
  const groups = (() => {
    if (!def.stages) return [{ stage: null as Stage | null, letter: '', items: objs }];
    const used = new Set<string>();
    const gs = def.stages.map((st, i) => {
      st.objectives.forEach((id) => used.add(id));
      return { stage: st as Stage | null, letter: String.fromCharCode(65 + i), items: objs.filter((o) => st.objectives.includes(o.id)) };
    });
    const rest = objs.filter((o) => !used.has(o.id));
    if (rest.length) gs.push({ stage: null, letter: '', items: rest });
    return gs.filter((x) => x.items.length > 0);
  })();
  const curGroup = groups.find((x) => cur && x.items.some((o) => o.id === cur.id));
  const st = getStatus(g.w, g.me);
  const hasConflict = st.conflicted.length > 0;
  const openPRs = g.prs.filter((x) => x.state === 'open').length;
  const tier = cur ? s.hintTier[cur.id] ?? 0 : 0;
  const hints = cur ? def.hints[cur.id] : undefined;

  return (
    <div class="lv">
      <header class="lv-top">
        <button class="btn ghost small" onClick={p.onMap}>
          ← 關卡地圖
        </button>
        <h1 class="lv-title">
          {def.free ? '' : `第 ${def.id} 關　`}
          {def.title}
        </h1>
        <span class={`role ${def.role}`} title={def.role === 'lead' ? '這一關你扮演部長（審查者）' : '這一關你扮演部員（PR 作者）'}>
          {def.role === 'lead' ? '你是部長' : '你是部員'}
        </span>
        {!def.free && (
          <span class="progress" title="已完成的目標">
            {doneCount}/{objs.length}
          </span>
        )}
        <RuleCodes codes={def.rules} />
        <span class="spacer" />
        <button class="btn small" onClick={() => setTaskOpen(!taskOpen)} aria-expanded={taskOpen}>
          任務卡 {taskOpen ? '▴' : '▾'}
        </button>
        <button
          class="btn small"
          disabled={!cur || !hints || tier >= 3}
          onClick={() => g.revealHint()}
          title="三段式提示：方向 → 指令 → 直接示範"
        >
          💡 提示 {cur && hints ? `(${tier}/3)` : ''}
        </button>
        <button class="btn small" disabled={g.checkpoints.length === 0} onClick={() => setModal('rewind')} title="回到之前某個動作之前">
          ⏪ 時光倒流 ({g.checkpoints.length})
        </button>
        <button class="btn small" onClick={() => setModal('flow')} title="一張圖看懂改動從哪裡到哪裡">
          🗺 流程地圖
        </button>
        <button class="btn small" onClick={() => setModal('rules')}>
          📖 規則速查
        </button>
        <button class="btn small ghost" onClick={() => setModal('settings')} aria-label="設定">
          ⚙
        </button>
        <button class="btn small ghost" onClick={() => setModal('restart')} title="這一關從頭開始">
          ↻ 重來
        </button>
      </header>

      {taskOpen ? (
        <section class="taskcard">
          <div class="tc-story">
            {def.story.map((t, i) => (
              <p key={i}>{t}</p>
            ))}
            {def.free && <p class="dim">（自由模式沒有過關條件。）</p>}
          </div>
          {!def.free && (
            <div class="tc-obj">
              <h3>這一關要做到</h3>
              {groups.map((gp, gi) => {
                const stDone = gp.items.every((o) => o.isDone);
                const stCur = gp === curGroup;
                return (
                  <div key={gp.stage?.key ?? `rest${gi}`} class={gp.stage ? `stage ${stDone ? 'done' : stCur ? 'cur' : 'todo'}` : undefined}>
                    {gp.stage && (
                      <div class="stage-head">
                        <span class="stage-mark">{stDone ? '✓' : gp.letter}</span>
                        <div>
                          <b>{gp.stage.title}</b>
                          <div class="stage-why">{gp.stage.why}</div>
                        </div>
                      </div>
                    )}
                    <ol class="objs">
                      {gp.items.map((o) => (
                        <li key={o.id} class={`${o.isDone ? 'done' : ''} ${cur?.id === o.id ? 'cur' : ''}`}>
                          <span class="check">{o.isDone ? '✓' : cur?.id === o.id ? '▶' : '○'}</span>
                          <span>
                            {o.human && !o.label.startsWith('🧑') && (
                              <span class="human" title="只有人能做／該由人判斷的步驟">
                                🧑{' '}
                              </span>
                            )}
                            {o.label}
                          </span>
                        </li>
                      ))}
                    </ol>
                  </div>
                );
              })}
              {cur && hints && tier > 0 && (
                <div class="hints">
                  {(['方向', '指令', '直接示範'] as const).slice(0, tier).map((name, i) => (
                    <p key={name} class={`hint t${i + 1}`}>
                      <b>提示 {i + 1}・{name}</b>　{hints[i]}
                    </p>
                  ))}
                </div>
              )}
              <p class="dim small">
                不知道怎麼做：按右上的「💡 提示」，一次多給一點。判定看的是最後的狀態，任何合法的路線都算。
              </p>
            </div>
          )}
          {def.id === 0 && (
            <details class="tc-flow">
              <summary>🗺 流程地圖：改動從哪裡到哪裡（約 90 秒，點開看）</summary>
              <FlowMap />
            </details>
          )}
        </section>
      ) : (
        !def.free &&
        cur && (
          <div class="curline">
            <span class="check">▶</span>
            {curGroup?.stage && (
              <span class="curstage">
                階段 {curGroup.letter}・{curGroup.stage.title}
              </span>
            )}
            {cur.label}
            {hints && tier > 0 && (
              <span class="curhint">
                　💡 {hints[tier - 1]}
              </span>
            )}
          </div>
        )
      )}

      {s.banner && (
        <div class="banner" role="alert">
          <div class="banner-text">{g.bannerText()}</div>
          <div class="banner-btns">
            {g.checkpoints.length > 0 && (
              <button class="btn small danger" onClick={() => setModal('rewind')}>
                ⏪ 時光倒流
              </button>
            )}
            <button
              class="btn small ghost"
              onClick={() => {
                s.banner = null;
                g.emit();
              }}
            >
              知道了
            </button>
          </div>
        </div>
      )}

      <div class="lv-main">
        <div class="col-left">
          <Chat g={g} driver={driver} speed={meta.speed} />
          <Terminal g={g} />
        </div>
        <div class="col-mid">
          <div class="tabs" role="tablist">
            <button role="tab" aria-selected={tab === 'preview'} class={tab === 'preview' ? 'on' : ''} onClick={() => setTab('preview')}>
              預覽
            </button>
            <button role="tab" aria-selected={tab === 'github'} class={tab === 'github' ? 'on' : ''} onClick={() => setTab('github')}>
              GitHub {openPRs > 0 && <span class="gh-count">{openPRs}</span>}
              {g.w.github.alerts.length > 0 && <span class="alert-dot" title="有警報" />}
            </button>
            <button role="tab" aria-selected={tab === 'editor'} class={tab === 'editor' ? 'on' : ''} onClick={() => setTab('editor')}>
              編輯器 {hasConflict && <span class="alert-dot" title="有衝突" />}
            </button>
          </div>
          <div class="tabbody" hidden={tab !== 'preview'}>
            <PreviewTab g={g} />
          </div>
          <div class="tabbody" hidden={tab !== 'github'}>
            <GithubTab g={g} />
          </div>
          <div class="tabbody" hidden={tab !== 'editor'}>
            <EditorTab g={g} />
          </div>
        </div>
        <GitPanel
          g={g}
          open={meta.panelOpen}
          onToggle={() => {
            const m = { ...meta, panelOpen: !meta.panelOpen };
            p.setMeta(m);
          }}
        />
      </div>

      <div class="toasts" aria-live="polite">
        {toasts.map((t) => (
          <div key={t.id} class={`toast ${t.kind}`}>
            {t.text}
          </div>
        ))}
      </div>

      {modal === 'flow' && (
        <Modal onClose={() => setModal(null)} wide>
          <h2>🗺 流程地圖</h2>
          <p class="dim small">一個修改從你的電腦走到正式站，會經過這些地方。看不懂 AI 在做什麼的時候，回來對照這張圖。</p>
          <FlowMap />
          <div class="modal-btns">
            <button class="btn primary" onClick={() => setModal(null)}>
              關閉
            </button>
          </div>
        </Modal>
      )}
      {modal === 'rules' && <RulesModal g={g} onClose={() => setModal(null)} />}
      {modal === 'settings' && <SettingsModal p={p} onClose={() => setModal(null)} />}
      {modal === 'rewind' && (
        <Modal onClose={() => setModal(null)}>
          <h2>⏪ 時光倒流</h2>
          <p class="dim">選一個動作，回到「做這件事之前」。之後發生的一切（包括 AI 的回應、GitHub 上的變化）都會一起退回去。</p>
          <ul class="rewind-list">
            {[...g.checkpoints].reverse().map((c) => (
              <li key={c.id}>
                <button
                  class="btn"
                  onClick={() => {
                    g.undoTo(c.id);
                    resetChatMemo(g);
                    setModal(null);
                    driver.poke();
                  }}
                >
                  回到「{c.label}」之前
                </button>
              </li>
            ))}
          </ul>
          <div class="modal-btns">
            <button class="btn ghost" onClick={() => setModal(null)}>
              取消
            </button>
          </div>
        </Modal>
      )}
      {modal === 'restart' && (
        <Modal onClose={() => setModal(null)}>
          <h2>這一關從頭開始？</h2>
          <p>這一關目前的進度（包括時光倒流的紀錄）會被清掉，回到最初的畫面。其他關卡不受影響。</p>
          <div class="modal-btns">
            <button
              class="btn danger"
              onClick={() => {
                setModal(null);
                p.onResetLevel();
              }}
            >
              重來
            </button>
            <button class="btn ghost" onClick={() => setModal(null)}>
              取消
            </button>
          </div>
        </Modal>
      )}
      {modal === 'success' && <SuccessModal g={g} onClose={() => setModal(null)} onMap={p.onMap} onOpen={p.onOpen} />}
      {s.done && modal === null && (
        <button class="done-pill" onClick={() => setModal('success')}>
          🎉 這一關過關了（看總結）
        </button>
      )}
    </div>
  );
}

// ---------------------------------------------------------------- 視窗

function RulesModal({ g, onClose }: { g: Game; onClose: () => void }) {
  const mine = new Set(g.def.rules.flatMap(splitCodes));
  const groups = (Object.keys(RULE_GROUPS) as RuleDef['group'][]).map((k) => ({ k, items: RULES.filter((r) => r.group === k) }));
  return (
    <Modal onClose={onClose} wide>
      <h2>📖 協作規則速查</h2>
      <p class="dim small">這一關相關的規則有標色。代號對應任務卡上的 G1、P6、§11 等。</p>
      <p class="rules-note">
        下面的 G／P／R／A／§ 規則是<b>這個團隊的約定</b>，別的團隊可能不一樣（例如有的團隊用 rebase、有的禁止 squash）。在這裡請照著做，但要知道它們是團隊的選擇，不是 Git 本身的規定。
      </p>
      <div class="rules-grid">
        {groups.map((gp) => (
          <div key={gp.k}>
            <h3>{RULE_GROUPS[gp.k]}</h3>
            <ul class="rules">
              {gp.items.map((r) => (
                <li key={r.code} class={mine.has(r.code) ? 'mine' : ''}>
                  <span class="rulecode">{r.code}</span> {r.text}
                </li>
              ))}
            </ul>
          </div>
        ))}
      </div>
      <h3>Git 本身的機制（每個團隊都一樣）</h3>
      <ul class="rules facts">
        {GIT_FACTS.map((f) => (
          <li key={f}>{f}</li>
        ))}
      </ul>
      <h3>AI 的權限規則（團隊設定，只比對指令的字面）</h3>
      <div class="perm-cols">
        <div>
          <b>deny（直接擋下）</b>
          <ul class="mono small">
            {DENY_RULES.map((r) => (
              <li key={r}>Bash({r})</li>
            ))}
          </ul>
        </div>
        <div>
          <b>ask（跳出視窗問你）</b>
          <ul class="mono small">
            {ASK_RULES.map((r) => (
              <li key={r}>Bash({r})</li>
            ))}
          </ul>
        </div>
      </div>
      <p class="dim small">Auto 模式自己還會擋 force push（包含 +refspec 的寫法）、刪除遠端分支等破壞性操作。規則沒列到、Auto 也不擋的事（例如刪測試、在 staging 上 push、衝突時整個採用一邊），只能靠你的眼睛和 Esc。</p>
      <div class="modal-btns">
        <button class="btn primary" onClick={onClose}>
          關閉
        </button>
      </div>
    </Modal>
  );
}

function SettingsModal({ p, onClose }: { p: LevelProps; onClose: () => void }) {
  const [confirm, setConfirm] = useState(false);
  return (
    <Modal onClose={onClose}>
      <h2>⚙ 設定</h2>
      <label class="gh-field">
        AI 的速度
        <select value={p.meta.speed} onChange={(e) => p.setMeta({ ...p.meta, speed: (e.target as HTMLSelectElement).value as Speed })}>
          {(Object.keys(SPEED_LABEL) as Speed[]).map((k) => (
            <option key={k} value={k}>
              {SPEED_LABEL[k]}
            </option>
          ))}
        </select>
      </label>
      <p class="small dim">
        「即將執行」的視窗讓你有時間按 Esc；選「瞬間」就沒有了。
      </p>
      <h3>存檔</h3>
      <p class="small">
        {storageStatus() === 'ok' ? '進度存在這個瀏覽器的 localStorage，每個動作後自動存。' : '⚠ 這個瀏覽器不讓網站存資料，進度只會留到你關掉這個分頁。'}
      </p>
      <ul class="small dim">
        <li>無痕／隱私視窗、清除網站資料、換電腦或換瀏覽器，進度都會消失。</li>
        <li>沒有後端、沒有帳號，也不會有人看到你的進度。</li>
      </ul>
      {confirm ? (
        <div class="modal-btns">
          <button class="btn danger" onClick={p.onClearAll}>
            確定，清掉全部進度
          </button>
          <button class="btn ghost" onClick={() => setConfirm(false)}>
            取消
          </button>
        </div>
      ) : (
        <button class="btn danger small" onClick={() => setConfirm(true)}>
          清除全部進度…
        </button>
      )}
      <div class="modal-btns">
        <button class="btn primary" onClick={onClose}>
          關閉
        </button>
      </div>
    </Modal>
  );
}

function SuccessModal({ g, onClose, onMap, onOpen }: { g: Game; onClose: () => void; onMap: () => void; onOpen: (id: number) => void }) {
  const def = g.def;
  const sayLog: { text: string; quality: string; note: string }[] = g.state.flags.sayLog ?? [];
  const next = LEVELS.find((l) => l.id === def.id + 1);
  const traps = g.state.traps.length;
  return (
    <Modal onClose={onClose} wide>
      <h2>🎉 第 {def.id} 關過關：{def.title}</h2>
      {def.success.summary.map((t, i) => (
        <p key={i}>{t}</p>
      ))}
      {def.success.rules.length > 0 && (
        <>
          <h3>這一關練到的規則</h3>
          <ul class="rules">
            {def.success.rules.map((r) => (
              <li key={r.code + r.text}>
                <span class="rulecode">{r.code}</span> {r.text}
              </li>
            ))}
          </ul>
        </>
      )}
      {sayLog.length > 0 && (
        <>
          <h3>你對 AI 說過的話</h3>
          <ul class="saylog">
            {sayLog.map((x, i) => (
              <li key={i} class={`q-${x.quality}`}>
                <b>{x.quality === 'good' ? '清楚' : x.quality === 'ok' ? '還行' : '太模糊'}</b>「{x.text}」<div class="dim small">{x.note}</div>
              </li>
            ))}
          </ul>
        </>
      )}
      <p class="dim small">
        {traps > 0 ? `這一關你踩到 ${traps} 個陷阱——這正是練習的目的，真的發生時你知道怎麼退回來。` : '這一關沒有踩到任何陷阱。可以回到上面的「時光倒流」，故意走走看危險的路線，看看後果。'}
      </p>
      <div class="modal-btns">
        {next && (
          <button class="btn primary" onClick={() => onOpen(next.id)}>
            下一關：{next.id === 11 ? '自由模式 ★' : `第 ${next.id} 關 ${next.title}`}
          </button>
        )}
        <button class="btn" onClick={onClose}>
          留在這裡繼續玩
        </button>
        <button class="btn ghost" onClick={onMap}>
          回到關卡地圖
        </button>
      </div>
    </Modal>
  );
}

void BranchChip;
void ruleOf;
