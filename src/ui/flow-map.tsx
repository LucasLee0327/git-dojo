// 流程地圖：一張「改動從哪裡到哪裡」的心智模型小圖。純 HTML／CSS，關卡視窗與第 0 關任務卡共用。
import { Fragment } from 'preact';

interface Node {
  name: string;
  note?: string;
  /** 連到下一個節點的箭頭上要寫的指令 */
  next?: string;
}

const LOCAL: Node[] = [
  { name: '工作資料夾', note: '你或 AI 改的檔案', next: 'git add' },
  { name: '暫存區', note: 'staging area', next: 'git commit' },
  { name: '本機 feat/ 分支', note: '存檔點記在這裡' },
];

const REMOTE: Node[] = [
  { name: 'GitHub 上的 feat/ 分支', next: '開 PR' },
  { name: 'PR', note: '審查＋CI', next: '部長合併' },
  { name: 'staging 分支', note: '團隊測試站', next: '上線 PR' },
  { name: 'master 分支', note: '正式站' },
];

const TERMS: [string, string][] = [
  ['branch 分支', '一條可以獨立往前走的歷史線，你的修改先在自己的分支上做，不影響別人。'],
  ['commit', '把暫存區裡的檔案存成一個「存檔點」，附上一句說明。'],
  ['push', '把本機分支的 commit 上傳到 GitHub。'],
  ['pull／fetch', 'fetch 只下載 GitHub 的新狀態；pull ＝ fetch ＋ 把它合進目前的分支。'],
  ['PR', 'Pull Request：請團隊把你的分支合進 staging 的申請單，審查與討論都在這裡。'],
  ['CI', 'PR 一更新就自動跑測試，綠燈才算過。'],
];

const AI_CAN = ['跑 git 指令：切分支、add、commit、push、pull', '寫程式、跑測試、修錯誤', '查歷史、用白話說明發生了什麼事'];
const YOU_DECIDE = [
  '決定這次該 add 哪些檔案（G4）',
  '開 PR；轉 Ready 前自己點預覽、看 Files changed（P4）',
  '在 GitHub 上按合併（R3）；上線只有總負責人（R4）',
  'AI 停下來問你的時候，決定要不要同意（A2）',
];

function Flow({ nodes }: { nodes: Node[] }) {
  return (
    <div class="fm-flow">
      {nodes.map((n, i) => (
        <Fragment key={n.name}>
          <div class="fm-node">
            <b>{n.name}</b>
            {n.note && <span>{n.note}</span>}
          </div>
          {n.next && i < nodes.length - 1 && (
            <div class="fm-arrow" aria-hidden="true">
              <code>{n.next}</code>
              <span>→</span>
            </div>
          )}
        </Fragment>
      ))}
    </div>
  );
}

export function FlowMap() {
  return (
    <div class="flowmap">
      <div class="fm-zone fm-local">
        <h4>你的電腦</h4>
        <Flow nodes={LOCAL} />
      </div>
      <div class="fm-bridge" aria-hidden="true">
        <code>git push</code> ↓　　<code>git fetch／pull</code> ↑
      </div>
      <div class="fm-zone fm-remote">
        <h4>GitHub／團隊</h4>
        <Flow nodes={REMOTE} />
        <p class="fm-sub">上線 PR 把 staging 合進 master，由總負責人處理。</p>
      </div>

      <div class="fm-callout" role="note">
        <b>注意：兩個「staging」是不同的東西。</b>「暫存區（staging area，git add 放進去的地方）」和「staging 分支（這個團隊的測試站分支）」是兩回事，只是英文剛好同名。
      </div>

      <dl class="fm-terms">
        {TERMS.map(([k, v]) => (
          <div key={k}>
            <dt>{k}</dt>
            <dd>{v}</dd>
          </div>
        ))}
      </dl>

      <div class="fm-roles">
        <div>
          <h4>🤖 AI 可以幫你做</h4>
          <ul>
            {AI_CAN.map((t) => (
              <li key={t}>{t}</li>
            ))}
          </ul>
        </div>
        <div>
          <h4>🧑 要你自己判斷</h4>
          <ul>
            {YOU_DECIDE.map((t) => (
              <li key={t}>{t}</li>
            ))}
          </ul>
        </div>
      </div>
    </div>
  );
}
