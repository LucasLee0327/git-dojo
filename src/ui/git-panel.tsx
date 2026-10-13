// 常駐的 git 狀態面板：狀態摘要（仿 VS Code Source Control）＋直式分支圖（仿 Source Control Graph）。
import { useMemo, useState } from 'preact/hooks';
import type { Game } from '../core/game';
import { getStatus, upstreamState } from '../git/engine';
import { ACTORS } from '../git/repo';
import type { RepoName } from '../git/types';
import { BranchChip, shortId } from './common';
import { colorOf, NEUTRAL } from './graph/colors';
import { NODE_R, RING, type Layout } from './graph/layout';
import { buildModel, layoutModel, PANEL_W, VIEW_LABEL, type GraphModel, type GraphView, type RefLabel } from './graph/model';

const VIEW_HINT: Record<GraphView, string> = {
  me: '和 VS Code 看到的一樣。origin/… 是你「上次 fetch」時的樣子，不會自己更新。',
  github: 'GitHub 上現在真正的樣子（網頁看到的）。和你的電腦比一比，就知道哪些還沒 fetch／push。',
  mei: '小美的電腦（機器人，依劇本行動）。',
};

export function GitPanel({ g, open, onToggle }: { g: Game; open: boolean; onToggle: () => void }) {
  const [view, setView] = useState<GraphView>('me');
  const model = useMemo(() => buildModel(g.w, view), [g.version, view, g]);
  const { lay, plan } = useMemo(() => layoutModel(model), [model]);

  if (!open) {
    const cur = g.branch;
    return (
      <aside class="gitpanel collapsed" aria-label="Git 狀態面板（已收合）">
        <button class="gp-expand" onClick={onToggle} title="展開 Git 狀態面板">
          <span class="gp-arrow">‹</span>
          <span class="gp-vert">Git 狀態</span>
          <span class="gp-dot" style={`background:${colorOf(cur)}`} title={cur ?? 'HEAD detached'} />
        </button>
      </aside>
    );
  }

  return (
    <aside class="gitpanel" aria-label="Git 狀態面板" style={`width:${PANEL_W}px`}>
      <header class="gp-head">
        <strong>Git 狀態</strong>
        <span class="gp-sub">對照 VS Code 的「原始檔控制」</span>
        <button class="icon-btn" onClick={onToggle} title="收合面板" aria-label="收合 Git 狀態面板">
          ›
        </button>
      </header>
      <div class="gp-views" role="tablist">
        {(['me', 'github', 'mei'] as GraphView[]).map((v) => (
          <button key={v} role="tab" aria-selected={view === v} class={view === v ? 'on' : ''} onClick={() => setView(v)}>
            {VIEW_LABEL[v]}
          </button>
        ))}
      </div>
      <p class="gp-viewhint">{VIEW_HINT[view]}</p>
      {view === 'github' ? <GithubSummary g={g} /> : <StatusSummary g={g} repoName={view as RepoName} />}
      <GraphBody g={g} model={model} lay={lay} view={view} chipLines={plan.lines} />
      <Legend />
    </aside>
  );
}

// ---------------------------------------------------------------- 狀態摘要

function StatusSummary({ g, repoName }: { g: Game; repoName: RepoName }) {
  const repo = g.w.repos[repoName];
  const st = getStatus(g.w, repo);
  const up = upstreamState(g.w, repo);
  const cur = repo.head.kind === 'branch' ? repo.head.name : null;
  const total = st.staged.length + st.unstaged.length + st.untracked.length + st.conflicted.length;
  const sig = JSON.stringify([cur, up, st, !!repo.merge, repo.head]);
  return (
    <section class="gp-status" key={sig}>
      <div class="gp-branchline flash">
        {cur ? (
          <>
            <span class="gp-ico">⎇</span> <BranchChip name={cur} />
          </>
        ) : (
          <span class="bchip detached" title="detached HEAD：不在任何分支上">
            HEAD detached at {shortId(repo.head.kind === 'detached' ? repo.head.id : '')}
          </span>
        )}
        {up && !up.gone && (
          <span class="gp-sync" title={`相對於 ${up.ref}（上次 fetch 的狀態）：領先 ${up.ahead}、落後 ${up.behind}`}>
            <b class={up.ahead ? 'hot' : ''}>↑{up.ahead}</b>
            <b class={up.behind ? 'hot' : ''}>↓{up.behind}</b>
          </span>
        )}
        {up && up.gone && <span class="gp-note">upstream 已不存在</span>}
        {cur && !up && <span class="gp-note" title="還沒設定 upstream，第一次要 git push -u">沒有 upstream</span>}
      </div>
      {up && !up.gone && (
        <div class="gp-upline">
          追蹤 <span class="mono">{up.ref}</span>
        </div>
      )}
      {repo.merge && (
        <div class="gp-merging flash">
          🔀 <b>合併進行中</b>（合併 {repo.merge.otherName}）
          {repo.merge.conflicts.length ? `：還有 ${repo.merge.conflicts.length} 個衝突` : '：衝突已解，等你 commit'}
        </div>
      )}
      {total === 0 && !repo.merge && <div class="gp-clean flash">✓ 工作資料夾乾淨，沒有變更</div>}
      <FileGroup title="衝突" cls="conflict" items={st.conflicted.map((p) => ({ path: p, mark: '!' }))} />
      <FileGroup title="已暫存的變更" cls="staged" items={st.staged.map((s) => ({ path: s.path, mark: s.kind === 'new file' ? 'A' : s.kind === 'deleted' ? 'D' : 'M' }))} />
      <FileGroup title="變更" cls="unstaged" items={st.unstaged.map((s) => ({ path: s.path, mark: s.kind === 'deleted' ? 'D' : 'M' }))} />
      <FileGroup title="未追蹤" cls="untracked" items={st.untracked.map((p) => ({ path: p, mark: 'U' }))} />
    </section>
  );
}

function FileGroup({ title, cls, items }: { title: string; cls: string; items: { path: string; mark: string }[] }) {
  if (!items.length) return null;
  return (
    <details open class={`gp-group ${cls}`}>
      <summary>
        {title} <span class="gp-count">{items.length}</span>
      </summary>
      <ul>
        {items.map((it) => (
          <li key={it.path} class="flash">
            <span class={`gp-mark m-${it.mark}`}>{it.mark}</span>
            <span class="mono">{it.path}</span>
          </li>
        ))}
      </ul>
    </details>
  );
}

function GithubSummary({ g }: { g: Game }) {
  const o = g.origin;
  const names = Object.keys(o.branches).sort();
  const sig = JSON.stringify([o.branches, g.prs.map((p) => [p.number, p.state, p.draft])]);
  return (
    <section class="gp-status" key={sig}>
      <div class="gp-branchline">
        <span class="gp-ico">☁</span> <b>GitHub 上的分支</b> <span class="gp-note">{names.length} 條</span>
      </div>
      <ul class="gp-ghlist">
        {names.map((b) => {
          const prs = g.prs.filter((p) => p.head === b && p.state === 'open');
          const msg = g.w.objects[o.branches[b]]?.message.split('\n')[0] ?? '';
          return (
            <li key={b} class="flash">
              <BranchChip name={b} />
              {prs.map((p) => (
                <span key={p.number} class="gp-prtag">
                  #{p.number}
                  {p.draft ? ' Draft' : ''}
                </span>
              ))}
              <span class="gp-msg">{msg}</span>
            </li>
          );
        })}
      </ul>
      {g.w.github.alerts.map((a) => (
        <div key={a.id} class="gp-alert">
          {a.text}
        </div>
      ))}
    </section>
  );
}

// ---------------------------------------------------------------- 分支圖

function Chip({ l }: { l: RefLabel }) {
  const color = colorOf(l.name);
  if (l.kind === 'remote') {
    return (
      <span class="lbl remote" style={`--bc:${color}`} title="遠端追蹤分支：上次 fetch 時 GitHub 上的位置">
        ☁ {l.name}
      </span>
    );
  }
  const cloud = l.synced || l.kind === 'github';
  return (
    <span
      class={`lbl local${l.current ? ' cur' : ''}`}
      style={`--bc:${color}`}
      title={`${l.current ? '你在這裡（HEAD 指向這條分支）。' : ''}${l.kind === 'github' ? 'GitHub 上的分支' : cloud ? '本機分支，而且和 GitHub 上同名的分支在同一個 commit（已同步）' : '本機分支，GitHub 上還沒有或還沒更新'}`}
    >
      {l.current && <span class="here-ico">▶</span>}
      {l.name}
      {cloud && <span class="cloud-ico">☁</span>}
    </span>
  );
}

function GraphBody({ g, model, lay, view, chipLines }: { g: Game; model: GraphModel; lay: Layout; view: GraphView; chipLines: Record<string, number> }) {
  const nodeById = new Map(lay.nodes.map((n) => [n.id, n]));
  const textLeft = lay.width + 8;
  return (
    <section class="gp-graph" aria-label="分支圖">
      <div class="gp-graph-scroll">
        <div class="gp-graph-inner" style={`height:${lay.height + 6}px`}>
          <svg class="gp-svg" width={lay.width} height={lay.height + 6} aria-hidden="true">
            {lay.edges.map((e) => {
              if (e.kind === 'squash') {
                return <path key={e.key} class="gedge squash" d={e.path.d} style={`d:path("${e.path.d}")`} />;
              }
              const child = e.from;
              const local = view !== 'github' && !model.onGithub.has(child);
              return (
                <path
                  key={e.key}
                  class={`gedge${local ? ' local' : ''}`}
                  d={e.path.d}
                  style={`d:path("${e.path.d}");stroke:${e.owner ? colorOf(e.owner) : NEUTRAL}`}
                />
              );
            })}
            {lay.nodes.map((n) => {
              const isHead = model.head === n.id;
              const local = view !== 'github' && !model.onGithub.has(n.id);
              const c = n.owner ? colorOf(n.owner) : NEUTRAL;
              return (
                <g key={n.id} class="gnode" style={`transform:translate(${n.x}px,${n.y}px)`}>
                  {isHead && <circle class="ghead" r={NODE_R + RING + 2.5} />}
                  <circle class="gring" r={NODE_R + RING} />
                  <circle class={`gdot${local ? ' hollow' : ''}`} r={NODE_R - (local ? 1 : 0)} style={`--c:${c}`} />
                </g>
              );
            })}
          </svg>
          {lay.nodes.map((n) => {
            const c = g.w.objects[n.id];
            const labels = [...(model.labels[n.id] ?? [])].sort((a, b) => Number(b.current) - Number(a.current) || a.kind.localeCompare(b.kind));
            const isHead = model.head === n.id;
            const onGh = model.onGithub.has(n.id);
            const first = c.message.split('\n')[0];
            const chips = (
              <>
                {isHead && model.detached && (
                  <span class="lbl here" title="HEAD 指在這個 commit，不在任何分支上（detached HEAD）">
                    ▶ HEAD
                  </span>
                )}
                {labels.map((l) => (
                  <Chip key={`${l.name}@${n.id}`} l={l} />
                ))}
              </>
            );
            const stacked = (chipLines[n.id] ?? 0) > 0;
            return (
              <div
                key={n.id}
                class={`grow${isHead ? ' head' : ''}`}
                style={`transform:translateY(${n.y - n.h / 2}px);height:${n.h}px;padding-left:${textLeft}px`}
                title={`${shortId(n.id)}  ${first}\n作者：${ACTORS[c.author].label}\n${view === 'github' || onGh ? '已經在 GitHub 上' : '只在本機（還沒 push）'}`}
              >
                {stacked && <div class="gchips">{chips}</div>}
                <div class="gl1">
                  {!stacked && chips}
                  <span class="gmsg">{first}</span>
                </div>
                <div class="gl2">
                  {isHead && <b class="here-mark">▶ 你在這裡{model.detached ? '（detached）' : ''} · </b>}
                  <span class="mono">{shortId(n.id)}</span> · {ACTORS[c.author].label}
                  {view !== 'github' && <span class={onGh ? 'gh-on' : 'gh-off'}>{onGh ? ' · 已在 GitHub' : ' · 只在本機'}</span>}
                  {c.squashOf && <span class="gh-sq"> · squash</span>}
                </div>
              </div>
            );
          })}
          {lay.nodes.length === 0 && <p class="gp-empty">還沒有任何 commit。</p>}
          {lay.truncated && <p class="gp-trunc" style={`top:${lay.height}px`}>… 更早的 commit 沒有畫出來</p>}
        </div>
      </div>
      <span hidden>{nodeById.size}</span>
    </section>
  );
}

function Legend() {
  return (
    <footer class="gp-legend" aria-label="圖例">
      <span>
        <svg width="16" height="14" aria-hidden="true">
          <circle cx="8" cy="7" r="5.5" class="lg-solid" />
        </svg>
        已在 GitHub
      </span>
      <span>
        <svg width="16" height="14" aria-hidden="true">
          <circle cx="8" cy="7" r="4.5" class="lg-hollow" />
        </svg>
        只在本機
      </span>
      <span>
        <svg width="22" height="14" aria-hidden="true">
          <path d="M1 7 H21" class="lg-squash" />
        </svg>
        squash 內容來源
      </span>
      <span class="lg-chips">
        <i class="lg-pill local">main ☁</i> 本機和 GitHub 同步
      </span>
      <span class="lg-chips">
        <i class="lg-pill local">feat/x</i> 只在本機
      </span>
      <span class="lg-chips">
        <i class="lg-pill remote">☁ origin/x</i> 上次 fetch 的 GitHub
      </span>
    </footer>
  );
}
