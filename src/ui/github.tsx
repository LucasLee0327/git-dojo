// 假 GitHub 網頁：repo 首頁、PR 列表、PR 頁（對話／Files changed／Checks／預覽）、開 PR 表單。
import { useEffect, useState } from 'preact/hooks';
import type { Game } from '../core/game';
import { ACTORS, REPO_WEB } from '../git/repo';
import type { PR } from '../git/types';
import { approvals, hasChangesRequested, isApproved, mergeInfo, prChecks, prFiles, prPreviewTree } from '../github/github';
import { BranchChip, shortId } from './common';
import { SitePreview } from './preview';

type Route = { page: 'home' } | { page: 'prs' } | { page: 'new'; head?: string } | { page: 'pr'; n: number; tab: 'conv' | 'files' | 'checks' | 'preview' };

const who = (a: string) => ACTORS[a as 'me']?.label ?? a;

export function GithubTab({ g }: { g: Game }) {
  const [route, setRoute] = useState<Route>({ page: 'home' });
  const repo = g.w.github.repoName;
  const openCount = g.prs.filter((p) => p.state === 'open').length;
  const go = (r: Route) => setRoute(r);
  return (
    <div class="gh">
      <header class="gh-head">
        <div class="gh-title">
          <span class="gh-octo">◉</span>
          <span class="gh-repo">{repo}</span>
          <span class="gh-vis">Public</span>
        </div>
        <nav class="gh-nav">
          <button class={route.page === 'home' ? 'on' : ''} onClick={() => go({ page: 'home' })}>
            &lt;&gt; Code
          </button>
          <button class={route.page === 'prs' || route.page === 'pr' || route.page === 'new' ? 'on' : ''} onClick={() => go({ page: 'prs' })}>
            Pull requests <span class="gh-count">{openCount}</span>
          </button>
        </nav>
      </header>
      {g.w.github.alerts.map((a) => (
        <div key={a.id} class="gh-alert" role="alert">
          {a.text}
        </div>
      ))}
      <div class="gh-main">
        {route.page === 'home' && <Home g={g} go={go} />}
        {route.page === 'prs' && <PRList g={g} go={go} />}
        {route.page === 'new' && <NewPR g={g} go={go} head={route.head} />}
        {route.page === 'pr' && <PRPage g={g} n={route.n} tab={route.tab} go={go} />}
      </div>
    </div>
  );
}

// ---------------------------------------------------------------- 首頁

function Home({ g, go }: { g: Game; go: (r: Route) => void }) {
  const o = g.origin;
  const names = Object.keys(o.branches).sort((a, b) => (a === 'master' ? -1 : b === 'master' ? 1 : a === 'staging' ? -1 : b === 'staging' ? 1 : a.localeCompare(b)));
  const open = g.prs.filter((p) => p.state === 'open');
  return (
    <>
      {names
        .filter((b) => b !== 'staging' && b !== 'master' && !open.some((p) => p.head === b))
        .map((b) => (
          <div key={b} class="gh-recent">
            <span>
              <BranchChip name={b} /> 剛剛有 push
            </span>
            <button class="btn small primary" onClick={() => go({ page: 'new', head: b })}>
              Compare &amp; pull request
            </button>
          </div>
        ))}
      <h3 class="gh-h">分支（{names.length}）</h3>
      <table class="gh-table">
        <tbody>
          {names.map((b) => {
            const id = o.branches[b];
            const c = g.w.objects[id];
            const pr = g.prs.find((p) => p.head === b && p.state === 'open');
            return (
              <tr key={b}>
                <td>
                  <BranchChip name={b} />
                  {(b === 'staging' || b === 'master') && <span class="gh-badge">{b === 'master' ? '正式站' : '測試站'}</span>}
                </td>
                <td class="dim">{c?.message.split('\n')[0]}</td>
                <td class="mono dim">{shortId(id)}</td>
                <td>
                  {pr && (
                    <button class="link" onClick={() => go({ page: 'pr', n: pr.number, tab: 'conv' })}>
                      PR #{pr.number}
                    </button>
                  )}
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
      <p class="dim small">
        repo 位址：<span class="mono">{REPO_WEB}</span>（練習用的假網址）
      </p>
    </>
  );
}

// ---------------------------------------------------------------- PR 列表

function prBadge(p: PR) {
  if (p.state === 'merged') return <span class="pr-badge merged">Merged</span>;
  if (p.state === 'closed') return <span class="pr-badge closed">Closed</span>;
  return p.draft ? <span class="pr-badge draft">Draft</span> : <span class="pr-badge open">Open</span>;
}

function PRList({ g, go }: { g: Game; go: (r: Route) => void }) {
  const [show, setShow] = useState<'open' | 'all'>('open');
  const list = [...g.prs].filter((p) => show === 'all' || p.state === 'open').sort((a, b) => b.number - a.number);
  return (
    <>
      <div class="gh-toolbar">
        <div class="seg">
          <button class={show === 'open' ? 'on' : ''} onClick={() => setShow('open')}>
            Open
          </button>
          <button class={show === 'all' ? 'on' : ''} onClick={() => setShow('all')}>
            全部
          </button>
        </div>
        <span class="spacer" />
        <button class="btn primary small" onClick={() => go({ page: 'new' })}>
          New pull request
        </button>
      </div>
      {list.length === 0 && <p class="dim pad">沒有符合的 PR。</p>}
      <ul class="pr-list">
        {list.map((p) => {
          const checks = p.state === 'open' ? prChecks(g.w, p) : [];
          const red = checks.some((c) => !c.ok);
          return (
            <li key={p.number}>
              <button class="pr-row" onClick={() => go({ page: 'pr', n: p.number, tab: 'conv' })}>
                {prBadge(p)}
                <span class="pr-title">{p.title}</span>
                <span class="dim small">
                  #{p.number} · {who(p.author)} · <BranchChip name={p.head} /> → <BranchChip name={p.base} />
                </span>
                {p.state === 'open' && checks.length > 0 && <span class={`ci ${red ? 'red' : 'green'}`}>{red ? '✗ checks' : '✓ checks'}</span>}
              </button>
            </li>
          );
        })}
      </ul>
    </>
  );
}

// ---------------------------------------------------------------- 開 PR

function NewPR({ g, go, head }: { g: Game; go: (r: Route) => void; head?: string }) {
  const branches = Object.keys(g.origin.branches).sort();
  const heads = branches.filter((b) => b !== 'master');
  const [base, setBase] = useState('staging');
  const [cmp, setCmp] = useState(head ?? heads.find((b) => b !== 'staging') ?? heads[0] ?? '');
  const tip = g.w.objects[g.origin.branches[cmp] ?? '']?.message.split('\n')[0] ?? '';
  const [title, setTitle] = useState(head ? tip : '');
  const [body, setBody] = useState('');
  const [draft, setDraft] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  return (
    <form
      class="gh-form"
      onSubmit={(e) => {
        e.preventDefault();
        const res = g.ghCreatePR({ title: title.trim() || tip || cmp, body, head: cmp, base, draft });
        if (res.error) setErr(res.error);
        else if (res.pr) go({ page: 'pr', n: res.pr.number, tab: 'conv' });
      }}
    >
      <h3 class="gh-h">Open a pull request</h3>
      <div class="gh-compare">
        <label>
          base
          <select value={base} onChange={(e) => setBase((e.target as HTMLSelectElement).value)}>
            {['staging', 'master'].map((b) => (
              <option key={b}>{b}</option>
            ))}
          </select>
        </label>
        <span>←</span>
        <label>
          compare
          <select
            value={cmp}
            onChange={(e) => {
              const v = (e.target as HTMLSelectElement).value;
              setCmp(v);
              setErr(null);
              if (!title) setTitle('');
            }}
          >
            {heads.map((b) => (
              <option key={b}>{b}</option>
            ))}
          </select>
        </label>
      </div>
      <label class="gh-field">
        標題
        <input value={title} placeholder={tip} onInput={(e) => setTitle((e.target as HTMLInputElement).value)} />
      </label>
      <label class="gh-field">
        說明
        <textarea rows={4} value={body} onInput={(e) => setBody((e.target as HTMLTextAreaElement).value)} placeholder="這個 PR 做了什麼？怎麼驗證？" />
      </label>
      <label class="check">
        <input type="checkbox" checked={draft} onChange={(e) => setDraft((e.target as HTMLInputElement).checked)} /> 以 Draft（草稿）建立
      </label>
      {err && <div class="gh-err">{err}</div>}
      <div class="row">
        <button class="btn primary" type="submit">
          {draft ? 'Create draft pull request' : 'Create pull request'}
        </button>
        <button type="button" class="btn ghost" onClick={() => go({ page: 'prs' })}>
          取消
        </button>
      </div>
    </form>
  );
}

// ---------------------------------------------------------------- PR 頁

function PRPage({ g, n, tab, go }: { g: Game; n: number; tab: 'conv' | 'files' | 'checks' | 'preview'; go: (r: Route) => void }) {
  const pr = g.pr(n);
  useEffect(() => {
    if (tab === 'files') g.visit('pr-files');
    if (tab === 'preview') g.visit('pr-preview');
  }, [tab, n]);
  if (!pr) return <p class="pad">找不到這個 PR。</p>;
  const files = prFiles(g.w, pr);
  const checks = prChecks(g.w, pr);
  const red = checks.some((c) => !c.ok);
  const T = (t: typeof tab, label: string, extra?: string) => (
    <button class={tab === t ? 'on' : ''} onClick={() => go({ page: 'pr', n, tab: t })}>
      {label} {extra && <span class="gh-count">{extra}</span>}
    </button>
  );
  return (
    <div class="prpage">
      <button class="link back" onClick={() => go({ page: 'prs' })}>
        ← 所有 PR
      </button>
      <h2 class="pr-h">
        {pr.title} <span class="dim">#{pr.number}</span>
      </h2>
      <div class="pr-meta">
        {prBadge(pr)}
        <span>
          {who(pr.author)} 想把 <BranchChip name={pr.head} /> 合併進 <BranchChip name={pr.base} />
          {pr.headDeleted && <span class="dim">（分支已自動刪除）</span>}
        </span>
      </div>
      <nav class="gh-subnav">
        {T('conv', '對話')}
        {T('files', 'Files changed', String(files.length))}
        {T('checks', 'Checks', checks.length ? (red ? '✗' : '✓') : '')}
        {pr.state === 'open' && T('preview', '預覽站')}
      </nav>
      {tab === 'conv' && <Conversation g={g} pr={pr} />}
      {tab === 'files' && <Files files={files} />}
      {tab === 'checks' && <Checks checks={checks} />}
      {tab === 'preview' && <SitePreview tree={prPreviewTree(g.w, pr)} env="pr" sub={`PR #${pr.number}`} />}
    </div>
  );
}

function Files({ files }: { files: ReturnType<typeof prFiles> }) {
  if (!files.length) return <p class="dim pad">沒有檔案變更。</p>;
  return (
    <div class="files">
      <p class="dim small">共 {files.length} 個檔案被改動</p>
      {files.map((f) => (
        <details key={f.path} class="diff" open={f.add + f.del < 120}>
          <summary>
            <span class={`fstat ${f.status}`}>{f.status === 'added' ? '新增' : f.status === 'deleted' ? '刪除' : '修改'}</span>
            <span class="mono">{f.path}</span>
            <span class="plus">+{f.add}</span>
            <span class="minus">-{f.del}</span>
          </summary>
          <pre class="diff-body">
            {f.hunks.map((h, i) => (
              <div key={i}>
                <div class="hunk">{h.header}</div>
                {h.ops.slice(0, 160).map((op, j) => (
                  <div key={j} class={op.t === '+' ? 'add' : op.t === '-' ? 'del' : 'ctx'}>
                    {op.t} {op.s}
                  </div>
                ))}
                {h.ops.length > 160 && <div class="hunk">… 還有 {h.ops.length - 160} 行</div>}
              </div>
            ))}
          </pre>
        </details>
      ))}
    </div>
  );
}

function Checks({ checks }: { checks: ReturnType<typeof prChecks> }) {
  if (!checks.length) return <p class="dim pad">沒有 checks。</p>;
  return (
    <ul class="checks">
      {checks.map((c) => (
        <li key={c.name}>
          <div class={`check-row ${c.ok ? 'ok' : 'bad'}`}>
            <b>{c.ok ? '✓' : '✗'}</b> {c.name}
            <span class="dim small">{c.ok ? '通過' : '失敗'}</span>
          </div>
          <pre class="tool-out">{c.log}</pre>
        </li>
      ))}
    </ul>
  );
}

function Conversation({ g, pr }: { g: Game; pr: PR }) {
  const info = pr.state === 'open' ? mergeInfo(g.w, pr) : null;
  const checks = pr.state === 'open' ? prChecks(g.w, pr) : [];
  const red = checks.some((c) => !c.ok);
  const [msg, setMsg] = useState<string | null>(null);
  const [method, setMethod] = useState<'squash' | 'merge'>('squash');
  const [comment, setComment] = useState('');
  const canReview = g.def.role === 'lead' || !!g.def.free;
  return (
    <div class="conv">
      <div class="cbox">
        <div class="cbox-h">{who(pr.author)} 的說明</div>
        <div class="cbox-b">{pr.body || <span class="dim">（沒有說明）</span>}</div>
      </div>

      {pr.events.length > 0 && (
        <ul class="timeline">
          {pr.events.map((e, i) => (
            <li key={i}>{e.replace(/^(me|mei|boss)(?= )/, (m) => who(m))}</li>
          ))}
        </ul>
      )}

      {pr.reviews.map((r, i) => (
        <div key={i} class={`cbox review ${r.state}`}>
          <div class="cbox-h">
            {who(r.by)}{' '}
            {r.state === 'approved' ? '核准了（Approved）' : r.state === 'changes_requested' ? '要求修改（Changes requested）' : '留言'}
          </div>
          <div class="cbox-b">
            {r.body && <p>{r.body}</p>}
            {r.todos.length > 0 && (
              <ul class="todos">
                {r.todos.map((t) => (
                  <li key={t}>☐ {t}</li>
                ))}
              </ul>
            )}
          </div>
        </div>
      ))}
      {pr.comments.map((c, i) => (
        <div key={i} class="cbox">
          <div class="cbox-h">{who(c.by)} 留言</div>
          <div class="cbox-b">{c.body}</div>
        </div>
      ))}

      {pr.state === 'open' && info && (
        <div class="mergebox">
          <ul class="mb-lines">
            <li class={pr.draft ? 'warn' : 'ok'}>{pr.draft ? '⚠ 這是 Draft PR：還在進行中，要先按 Ready for review' : '✓ 已經是 Ready for review'}</li>
            <li class={checks.length ? (red ? 'bad' : 'ok') : 'dim'}>{checks.length ? (red ? '✗ 有 checks 失敗（看 Checks 分頁）' : '✓ 所有 checks 通過') : '沒有 checks'}</li>
            {hasChangesRequested(pr) ? (
              <li class="bad">✗ 審查者要求修改（Changes requested）</li>
            ) : isApproved(pr) ? (
              <li class="ok">✓ 已經有人核准（Approved）</li>
            ) : (
              <li class="dim">還沒有人審查</li>
            )}
            {info.conflicts.length > 0 ? (
              <li class="bad">
                ✗ This branch has conflicts that must be resolved
                <div class="small dim">衝突的檔案：{info.conflicts.join('、')}（要在本機合併、解衝突後再 push）</div>
              </li>
            ) : info.upToDate ? (
              <li class="ok">✓ 這個分支和 {pr.base} 同步，沒有衝突</li>
            ) : (
              <li class="warn">
                ⚠ This branch is out-of-date with the base branch（落後 {pr.base} {info.behindBy} 個 commit，但沒有衝突）
                <button
                  class="btn small"
                  onClick={() => {
                    setMsg(g.ghUpdateBranch(pr.number));
                  }}
                >
                  Update branch
                </button>
              </li>
            )}
          </ul>
          <div class="mb-actions">
            {pr.draft && (
              <button class="btn" onClick={() => g.ghReady(pr.number)}>
                Ready for review
              </button>
            )}
            <div class="mergebtn">
              <button
                class="btn merge"
                onClick={() => {
                  setMsg(g.ghMerge(pr.number, method));
                }}
              >
                {method === 'squash' ? 'Squash and merge' : 'Create a merge commit'}
              </button>
              <select value={method} aria-label="合併方式" onChange={(e) => setMethod((e.target as HTMLSelectElement).value as 'squash' | 'merge')}>
                <option value="squash">Squash and merge</option>
                <option value="merge">Create a merge commit</option>
                <option value="rebase" disabled>
                  Rebase and merge（已停用）
                </option>
              </select>
            </div>
            {!pr.draft && pr.author === 'me' && (
              <button class="btn ghost small" onClick={() => g.ghDraft(pr.number)}>
                轉回 Draft
              </button>
            )}
            <button class="btn ghost small" onClick={() => g.ghClose(pr.number)}>
              Close pull request
            </button>
          </div>
          {msg && <div class="gh-err">{msg}</div>}
        </div>
      )}

      {pr.state === 'merged' && (
        <div class="mergebox merged">
          <div>
            🟣 <b>Merged</b>：{who(pr.mergedBy ?? 'boss')} 用 {pr.mergeMethod === 'squash' ? 'Squash and merge' : 'Create a merge commit'} 合併了這個 PR。
            {pr.headDeleted && <span class="dim"> GitHub 已自動刪除分支 {pr.head}。</span>}
          </div>
          <div class="mb-actions">
            <button
              class="btn"
              onClick={() => {
                setMsg(g.ghRevert(pr.number));
              }}
            >
              Revert
            </button>
            <span class="dim small">Revert 會開一個「反向修改」的新 PR，不會改寫歷史。</span>
          </div>
          {msg && <div class="gh-err">{msg}</div>}
        </div>
      )}
      {pr.state === 'closed' && <div class="mergebox">🔴 這個 PR 已關閉。</div>}

      {pr.state === 'open' && canReview && <ReviewForm g={g} pr={pr} />}

      {pr.state === 'open' && (
        <div class="cbox">
          <div class="cbox-h">留言</div>
          <div class="cbox-b">
            <textarea rows={2} value={comment} onInput={(e) => setComment((e.target as HTMLTextAreaElement).value)} placeholder="留一句話…" />
            <button
              class="btn small"
              disabled={!comment.trim()}
              onClick={() => {
                g.ghComment(pr.number, comment.trim());
                setComment('');
              }}
            >
              Comment
            </button>
          </div>
        </div>
      )}
      <p class="dim small">審查狀態：{approvals(pr).map((r) => `${who(r.by)}：${r.state}`).join('；') || '無'}</p>
    </div>
  );
}

function ReviewForm({ g, pr }: { g: Game; pr: PR }) {
  const [kind, setKind] = useState<'commented' | 'approved' | 'changes_requested'>('commented');
  const [body, setBody] = useState('');
  const [picked, setPicked] = useState<string[]>([]);
  const todos = g.def.review?.todos ?? [];
  const toggle = (label: string) => setPicked(picked.includes(label) ? picked.filter((x) => x !== label) : [...picked, label]);
  return (
    <div class="cbox reviewform">
      <div class="cbox-h">Finish your review</div>
      <div class="cbox-b">
        <textarea rows={2} value={body} onInput={(e) => setBody((e.target as HTMLTextAreaElement).value)} placeholder="給作者的話（可以留空）" />
        <div class="radios">
          {(
            [
              ['commented', 'Comment', '只留言，不表態'],
              ['approved', 'Approve', '核准：可以合併了'],
              ['changes_requested', 'Request changes', '要求修改：勾出具體待辦'],
            ] as const
          ).map(([k, label, tip]) => (
            <label key={k} class="radio">
              <input type="radio" name={`rv-${pr.number}`} checked={kind === k} onChange={() => setKind(k)} /> <b>{label}</b> <span class="dim small">{tip}</span>
            </label>
          ))}
        </div>
        {kind === 'changes_requested' && todos.length > 0 && (
          <div class="todopick">
            <div class="small dim">勾出要作者處理的待辦（作者只會處理你勾的）：</div>
            {todos.map((t) => (
              <label key={t.id} class="check">
                <input type="checkbox" checked={picked.includes(t.label)} onChange={() => toggle(t.label)} /> {t.label}
              </label>
            ))}
          </div>
        )}
        <button
          class="btn primary"
          onClick={() => {
            g.ghReview(pr.number, kind, body.trim(), kind === 'changes_requested' ? picked : []);
            setBody('');
            setPicked([]);
            setKind('commented');
          }}
        >
          Submit review
        </button>
      </div>
    </div>
  );
}
