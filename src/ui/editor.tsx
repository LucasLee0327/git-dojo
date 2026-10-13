// 編輯器分頁：看／改工作資料夾的檔案、衝突解決器、「套用修改」按鈕（代表你把程式寫好了）。
import { useEffect, useState } from 'preact/hooks';
import type { Game } from '../core/game';
import { getStatus } from '../git/engine';
import { hasConflictMarkers, parseConflicts, resolveConflictBlock } from '../git/diff';

export function EditorTab({ g }: { g: Game }) {
  const work = g.me.work;
  const st = getStatus(g.w, g.me);
  const paths = [...new Set([...Object.keys(work), ...Object.keys(g.me.index)])].sort();
  const [sel, setSel] = useState<string | null>(null);
  const cur = sel && work[sel] !== undefined ? sel : paths.find((p) => hasConflictMarkers(work[p] ?? '')) ?? paths[0] ?? null;
  const [draft, setDraft] = useState<string | null>(null);

  useEffect(() => setDraft(null), [cur]);
  // 自動選到衝突檔後就「記住」它：解完最後一個衝突時不要跳到別的檔案
  useEffect(() => {
    if (!sel && cur && hasConflictMarkers(work[cur] ?? '')) setSel(cur);
  }, [cur, sel, work]);

  const mark = (p: string): string => {
    if (st.conflicted.includes(p)) return '!';
    if (st.untracked.includes(p)) return 'U';
    if (st.ignored.includes(p)) return '·';
    const u = st.unstaged.find((x) => x.path === p);
    if (u) return u.kind === 'deleted' ? 'D' : 'M';
    const s = st.staged.find((x) => x.path === p);
    if (s) return s.kind === 'new file' ? 'A' : s.kind === 'deleted' ? 'D' : 'M';
    return '';
  };
  const edits = g.def.edits ?? [];
  const text = cur ? work[cur] ?? '' : '';
  const conflict = cur ? hasConflictMarkers(text) : false;

  return (
    <div class="editor">
      {edits.length > 0 && (
        <div class="edits">
          <div class="edits-h">
            <b>套用修改</b> <span class="dim small">（模擬：代表這段程式已經寫好了。按下去會直接改你的工作資料夾）</span>
          </div>
          <div class="edits-list">
            {edits.map((e) => {
              const ok = !e.available || e.available(g);
              const used = g.flags[`edit:${e.id}`];
              return (
                <button key={e.id} class="btn edit-btn" disabled={!ok} title={e.hint} onClick={() => g.applyEdit(e.id)}>
                  {e.label}
                  {used ? <span class="dim small"> ✓×{used}</span> : null}
                  <span class="edit-hint">{e.hint}</span>
                </button>
              );
            })}
          </div>
        </div>
      )}
      <div class="ed-cols">
        <ul class="ed-files" aria-label="檔案">
          {paths.map((p) => (
            <li key={p}>
              <button class={`${p === cur ? 'on' : ''}`} onClick={() => setSel(p)}>
                <span class={`gp-mark m-${mark(p) || 'none'}`}>{mark(p) || ' '}</span>
                <span class={`mono ${st.ignored.includes(p) ? 'dim' : ''}`}>{p}</span>
              </button>
            </li>
          ))}
          {paths.length === 0 && <li class="dim pad">（工作資料夾是空的）</li>}
        </ul>
        <div class="ed-main">
          {cur ? (
            conflict ? (
              <Conflicts g={g} path={cur} text={text} />
            ) : (
              <>
                <div class="ed-bar">
                  <span class="mono">{cur}</span>
                  {st.ignored.includes(cur) && <span class="tag">被 .gitignore 擋住，git status 看不到</span>}
                  <span class="spacer" />
                  {draft !== null && (
                    <>
                      <button class="btn small primary" onClick={() => (g.saveFile(cur, draft), setDraft(null))}>
                        儲存
                      </button>
                      <button class="btn small ghost" onClick={() => setDraft(null)}>
                        還原
                      </button>
                    </>
                  )}
                </div>
                <textarea
                  class="ed-text mono"
                  spellcheck={false}
                  value={draft ?? text}
                  onInput={(e) => setDraft((e.target as HTMLTextAreaElement).value)}
                  aria-label={`編輯 ${cur}`}
                />
              </>
            )
          ) : (
            <p class="dim pad">選一個檔案。</p>
          )}
        </div>
      </div>
    </div>
  );
}

function Conflicts({ g, path, text }: { g: Game; path: string; text: string }) {
  const blocks = parseConflicts(text);
  const [manual, setManual] = useState<string | null>(null);
  let ci = -1;
  return (
    <div class="conflicts">
      <div class="ed-bar">
        <span class="mono">{path}</span>
        <span class="tag bad">有衝突 — 讀過兩邊，再決定怎麼合</span>
        <span class="spacer" />
        <button class="btn small ghost" onClick={() => setManual(manual === null ? text : null)}>
          {manual === null ? '手動編輯' : '取消手動編輯'}
        </button>
      </div>
      {manual !== null ? (
        <>
          <textarea class="ed-text mono" value={manual} spellcheck={false} onInput={(e) => setManual((e.target as HTMLTextAreaElement).value)} aria-label="手動解衝突" />
          <button
            class="btn primary small"
            onClick={() => {
              g.saveFile(path, manual);
              setManual(null);
            }}
          >
            儲存
          </button>
          <p class="dim small">自己改到 &lt;&lt;&lt;&lt;&lt;&lt;&lt;、=======、&gt;&gt;&gt;&gt;&gt;&gt;&gt; 這三種記號都不見為止。</p>
        </>
      ) : (
        <div class="cf-view mono">
          {blocks.map((b, i) => {
            if (b.kind === 'text') return <pre key={i} class="cf-text">{b.lines!.join('\n')}</pre>;
            ci++;
            const idx = ci;
            return (
              <div key={i} class="cf-block">
                <div class="cf-side ours">
                  <div class="cf-label">▲ 你的版本（{b.oursLabel}）</div>
                  <pre>{b.ours!.join('\n')}</pre>
                </div>
                <div class="cf-side theirs">
                  <div class="cf-label">▼ 對方的版本（{b.theirsLabel}）</div>
                  <pre>{b.theirs!.join('\n')}</pre>
                </div>
                <div class="cf-btns">
                  <button class="btn small" onClick={() => g.saveFile(path, resolveConflictBlock(text, idx, 'ours'))}>
                    保留我的
                  </button>
                  <button class="btn small" onClick={() => g.saveFile(path, resolveConflictBlock(text, idx, 'theirs'))}>
                    保留對方的
                  </button>
                  <button class="btn small" onClick={() => g.saveFile(path, resolveConflictBlock(text, idx, 'both'))}>
                    兩者都留
                  </button>
                </div>
              </div>
            );
          })}
        </div>
      )}
      <p class="dim small">解完所有衝突後，到終端機 <code>git add {path}</code>，再 <code>git commit</code>。</p>
    </div>
  );
}
