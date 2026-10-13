// 「小共筆 TinyNote」的即時預覽：本機／PR 預覽站／測試站／正式站，各自從對應的快照渲染。
import { useEffect, useState } from 'preact/hooks';
import type { Game } from '../core/game';
import type { Files } from '../git/types';
import { deployedTree, prPreviewTree } from '../github/github';
import { buildPreviewHtml, runApp } from '../site/runner';
import { hasConflictMarkers } from '../git/diff';
import { shortId } from './common';

export type Env = 'local' | 'pr' | 'staging' | 'production';

const ENV_INFO: Record<Env, { label: string; url: string; note: string; cls: string }> = {
  local: { label: '本機', url: 'localhost:5173', note: '讀的是你工作資料夾裡的檔案——還沒 commit、沒 push，你自己看得到，別人看不到。', cls: 'env-local' },
  pr: { label: 'PR 預覽站', url: 'pr-preview.tinynote.example', note: '用這個 PR 的分支部署出來的樣子。審查者不用拉程式碼就能點。', cls: 'env-pr' },
  staging: { label: '測試站', url: 'staging.tinynote.example', note: '用 GitHub 上 staging 分支部署的樣子。全隊共用。', cls: 'env-staging' },
  production: { label: '正式站', url: 'tinynote.example', note: '用 GitHub 上 master 分支部署的樣子。使用者看到的就是這個。', cls: 'env-production' },
};

export function SitePreview({ tree, env, sub }: { tree: Files | null; env: Env; sub?: string }) {
  const info = ENV_INFO[env];
  // tree 是會被就地修改的物件（工作資料夾），所以每次繪製都重算，不用 memo
  const res = tree ? runApp(tree) : null;
  const html = tree ? buildPreviewHtml(tree) : '';
  let h = 0;
  for (let i = 0; i < html.length; i++) h = (h * 31 + html.charCodeAt(i)) | 0;
  const key = `${env}-${h}`;
  // 衝突記號（<<<<<<<）還留在網站檔案裡：app.js 會語法錯誤、style.css 會整份失效，所以直接告訴使用者原因
  const conflicted = tree ? ['app.js', 'index.html', 'style.css'].filter((p) => hasConflictMarkers(tree[p] ?? '')) : [];
  const broken = conflicted.length > 0 || (res && !res.ok);
  return (
    <div class={`site ${info.cls}`}>
      <div class="site-bar">
        <span class="site-env">{info.label}</span>
        <span class="site-url mono">https://{info.url}</span>
        {sub && <span class="site-sub">{sub}</span>}
      </div>
      <p class="site-note">{info.note}</p>
      <div class="site-frame">
        {tree ? <iframe key={key} title={`${info.label}預覽`} sandbox="allow-scripts" srcDoc={html} /> : <div class="site-none">（沒有可以預覽的內容）</div>}
        {broken && (
          <div class="site-err" role="alert">
            <div class="site-err-card">
              {conflicted.length > 0 ? (
                <>
                  <b>這個版本的 {conflicted.join('、')} 跑不起來：裡面還有衝突記號 <code>{'<<<<<<<'}</code></b>
                  <p>合併時 Git 把兩邊的修改都留在檔案裡，等你決定怎麼合。到「編輯器」分頁解掉衝突、存檔、git add、git commit，這裡才會恢復。</p>
                </>
              ) : (
                <>
                  <b>程式出錯，網站白屏了</b>
                  <p>頁面的 JavaScript 一載入就出錯，瀏覽器什麼都畫不出來（使用者看到的就是一片白）。</p>
                </>
              )}
              {res && !res.ok && <pre>{res.error}</pre>}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

export function PreviewTab({ g }: { g: Game }) {
  const [env, setEnv] = useState<Env>('local');
  const open = g.prs.filter((p) => p.state === 'open');
  const [prN, setPrN] = useState<number | null>(null);
  const pr = open.find((p) => p.number === prN) ?? open[open.length - 1] ?? null;

  useEffect(() => {
    g.visit(env === 'local' ? 'preview' : env === 'pr' ? 'pr-preview' : env === 'staging' ? 'staging-preview' : 'production-preview');
  }, [env]);

  let tree: Files | null = null;
  let sub = '';
  if (env === 'local') {
    tree = g.me.work;
    sub = g.branch ? `分支 ${g.branch}` : 'detached HEAD';
  } else if (env === 'pr') {
    tree = pr ? prPreviewTree(g.w, pr) : null;
    sub = pr ? `PR #${pr.number}` : '';
  } else {
    const site = env === 'staging' ? 'staging' : 'master';
    tree = deployedTree(g.w, site);
    const id = g.origin.branches[site];
    sub = id ? `${site} @ ${shortId(id)}` : '';
  }

  return (
    <div class="preview-tab">
      <div class="seg env-seg" role="tablist" aria-label="預覽環境">
        {(['local', 'pr', 'staging', 'production'] as Env[]).map((e) => (
          <button key={e} role="tab" aria-selected={env === e} class={env === e ? 'on' : ''} onClick={() => setEnv(e)}>
            {ENV_INFO[e].label}
          </button>
        ))}
        {env === 'pr' && open.length > 1 && (
          <select value={pr?.number} onChange={(e) => setPrN(Number((e.target as HTMLSelectElement).value))} aria-label="選擇 PR">
            {open.map((p) => (
              <option key={p.number} value={p.number}>
                #{p.number} {p.title}
              </option>
            ))}
          </select>
        )}
      </div>
      {env === 'pr' && !pr ? <div class="site-none pad">現在沒有開著的 PR，所以沒有 PR 預覽站。先去 GitHub 分頁開一個。</div> : <SitePreview tree={tree} env={env} sub={sub} />}
    </div>
  );
}
