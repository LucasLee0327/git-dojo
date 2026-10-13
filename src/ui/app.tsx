// 外殼：歡迎畫面、關卡地圖、關卡畫面的切換，以及存檔。
import { useEffect, useRef, useState } from 'preact/hooks';
import { Game } from '../core/game';
import { LEVELS } from '../levels';
import { clearAll, clearLevel, hasSave, loadLevel, loadMeta, probeStorage, saveLevel, saveMeta, storageStatus, type Meta } from '../store/save';
import { RuleCodes } from './common';
import { LevelScreen } from './level-screen';

type Screen = { kind: 'welcome' } | { kind: 'map' } | { kind: 'level' };

function useNarrow() {
  const [narrow, setNarrow] = useState(() => window.innerWidth < 900);
  useEffect(() => {
    const on = () => setNarrow(window.innerWidth < 900);
    window.addEventListener('resize', on);
    return () => window.removeEventListener('resize', on);
  }, []);
  return narrow;
}

export function App() {
  const narrow = useNarrow();
  const [meta, setMetaState] = useState<Meta>(() => {
    probeStorage();
    return loadMeta();
  });
  const [screen, setScreen] = useState<Screen>({ kind: 'welcome' });
  const [game, setGame] = useState<Game | null>(null);
  const [, bump] = useState(0);
  const saveTimer = useRef<number | null>(null);
  const gameRef = useRef<Game | null>(null);
  gameRef.current = game;

  const setMeta = (m: Meta) => {
    setMetaState(m);
    saveMeta(m);
  };

  const flush = () => {
    if (saveTimer.current !== null) {
      window.clearTimeout(saveTimer.current);
      saveTimer.current = null;
    }
    if (gameRef.current) saveLevel(gameRef.current);
  };
  const schedule = () => {
    if (saveTimer.current !== null) return;
    saveTimer.current = window.setTimeout(() => {
      saveTimer.current = null;
      if (gameRef.current) saveLevel(gameRef.current);
    }, 250);
  };

  useEffect(() => {
    const h = () => flush();
    window.addEventListener('pagehide', h);
    document.addEventListener('visibilitychange', h);
    return () => {
      window.removeEventListener('pagehide', h);
      document.removeEventListener('visibilitychange', h);
    };
  }, []);

  const attach = (g: Game) => {
    g.onChange = schedule;
    gameRef.current = g;
    setGame(g);
    setScreen({ kind: 'level' });
  };

  const openLevel = (id: number) => {
    flush();
    const g = loadLevel(id) ?? Game.create(id);
    saveLevel(g);
    setMeta({ ...loadMeta(), ...meta, lastLevel: id, completed: meta.completed });
    attach(g);
  };

  const toMap = () => {
    flush();
    setScreen({ kind: 'map' });
    bump((n) => n + 1);
  };

  if (narrow) {
    return (
      <div class="gate" role="alert">
        <div class="gate-card">
          <div class="gate-ico">🖥</div>
          <h1>請用電腦開啟</h1>
          <p>git-dojo 需要比較寬的畫面（同時放得下 AI 助手、終端機、GitHub 和分支圖），手機與小視窗沒辦法練習。</p>
          <p class="dim">請改用電腦的瀏覽器，並把視窗放寬到至少 900 像素。</p>
        </div>
      </div>
    );
  }

  if (screen.kind === 'level' && game) {
    return (
      <LevelScreen
        key={`${game.state.levelId}-${(game as any)._k ?? 0}`}
        g={game}
        meta={meta}
        setMeta={setMeta}
        onMap={toMap}
        onOpen={openLevel}
        onResetLevel={() => {
          clearLevel(game.state.levelId);
          const g = Game.create(game.state.levelId);
          (g as any)._k = ((game as any)._k ?? 0) + 1;
          saveLevel(g);
          attach(g);
        }}
        onClearAll={() => {
          clearAll();
          setMetaState(loadMeta());
          gameRef.current = null;
          setGame(null);
          setScreen({ kind: 'welcome' });
        }}
      />
    );
  }

  if (screen.kind === 'map') return <MapScreen meta={meta} onOpen={openLevel} onBack={() => setScreen({ kind: 'welcome' })} />;

  const last = meta.lastLevel !== null && hasSave(meta.lastLevel) ? LEVELS.find((l) => l.id === meta.lastLevel) : undefined;
  return (
    <Welcome
      last={last ? { id: last.id, title: last.title } : null}
      onContinue={() => last && openLevel(last.id)}
      onStart={() => openLevel(0)}
      onMap={() => setScreen({ kind: 'map' })}
      onClear={() => {
        clearAll();
        setMetaState(loadMeta());
        bump((n) => n + 1);
      }}
    />
  );
}

function Welcome(p: { last: { id: number; title: string } | null; onContinue: () => void; onStart: () => void; onMap: () => void; onClear: () => void }) {
  const [confirm, setConfirm] = useState(false);
  const mem = storageStatus() === 'memory';
  return (
    <main class="welcome">
      <div class="w-card">
        <div class="w-logo">git-dojo</div>
        <h1>Git 團隊協作練習場</h1>
        <p class="w-lead">
          在瀏覽器裡親手走一遍：開分支、commit、push、開 PR、解衝突、審查、合併、上線。後半段還要學會「指揮 AI」——以及在它走錯路時攔下它。
        </p>
        <ul class="w-points">
          <li>
            <b>不用安裝、不用帳號。</b>終端機、GitHub、AI、預覽網站全部是模擬的，隨便弄壞沒關係，還可以「時光倒流」。
          </li>
          <li>
            <b>真的 git 狀態機。</b>你打的指令會真的改動分支和歷史，右邊的 Git 狀態面板和 VS Code 看到的一樣。
          </li>
          <li>
            <b>判定看最後的狀態。</b>任何合法的做法都算過關，不用背標準答案。
          </li>
        </ul>
        <div class="w-btns">
          {p.last ? (
            <>
              <button class="btn primary big" onClick={p.onContinue}>
                繼續上次進度（{p.last.id === 11 ? '自由模式' : `第 ${p.last.id} 關`}・{p.last.title}）
              </button>
              <button class="btn big" onClick={p.onMap}>
                關卡地圖
              </button>
            </>
          ) : (
            <>
              <button class="btn primary big" onClick={p.onStart}>
                從第 0 關開始
              </button>
              <button class="btn big" onClick={p.onMap}>
                關卡地圖
              </button>
            </>
          )}
        </div>
        <div class={`w-note ${mem ? 'warn' : ''}`}>
          {mem ? (
            <p>
              <b>⚠ 這個瀏覽器不讓網站儲存資料</b>（可能是無痕視窗或封鎖了網站資料），所以進度只會留到你關掉這個分頁。網站仍然可以正常玩。
            </p>
          ) : (
            <p>
              <b>進度存在這個瀏覽器裡</b>（localStorage），每個動作後自動存。
            </p>
          )}
          <p>
            以下情況進度會<b>消失</b>：無痕／隱私視窗、清除網站資料、換電腦、換瀏覽器。沒有後端，也沒有帳號。
          </p>
        </div>
        {(p.last || true) && (
          <div class="w-clear">
            {confirm ? (
              <>
                <span>確定要清掉所有進度？</span>
                <button
                  class="btn danger small"
                  onClick={() => {
                    p.onClear();
                    setConfirm(false);
                  }}
                >
                  確定清除
                </button>
                <button class="btn ghost small" onClick={() => setConfirm(false)}>
                  取消
                </button>
              </>
            ) : (
              <button class="link" onClick={() => setConfirm(true)}>
                清除所有進度，重新開始
              </button>
            )}
          </div>
        )}
        <p class="w-foot dim small">教材為練習用的虛構專案「小共筆 TinyNote」；人物（小美、部長）都是機器人。僅支援電腦版瀏覽器。</p>
      </div>
    </main>
  );
}

function MapScreen({ meta, onOpen, onBack }: { meta: Meta; onOpen: (id: number) => void; onBack: () => void }) {
  const parts: { n: 1 | 2 | 3; title: string; sub: string }[] = [
    { n: 1, title: '第一部：自己動手', sub: '手打 git，建立基本功' },
    { n: 2, title: '第二部：指揮 AI', sub: '全程 Auto 模式；規則擋得到的與擋不到的' },
    { n: 3, title: '第三部：審查與上線', sub: '部長必修、部員選修' },
  ];
  const total = LEVELS.filter((l) => !l.free).length;
  const done = meta.completed.filter((id) => LEVELS.some((l) => l.id === id && !l.free)).length;
  const memberMin = LEVELS.filter((l) => l.id <= 7).reduce((n, l) => n + l.minutes, 0);
  const allMin = LEVELS.reduce((n, l) => n + l.minutes, 0);
  return (
    <main class="map">
      <header class="map-head">
        <button class="btn ghost small" onClick={onBack}>
          ← 首頁
        </button>
        <h1>關卡地圖</h1>
        <span class="progress">
          已完成 {done}/{total}
        </span>
        <span class="dim small">部員主線（0–7）約 {memberMin} 分鐘；全部約 {allMin} 分鐘</span>
      </header>
      {parts.map((pt) => (
        <section key={pt.n} class={`map-part p${pt.n}`}>
          <h2>
            {pt.title} <span class="dim small">{pt.sub}</span>
          </h2>
          <div class="map-cards">
            {LEVELS.filter((l) => l.part === pt.n && !l.free).map((l) => (
              <LevelCard key={l.id} id={l.id} meta={meta} onOpen={onOpen} />
            ))}
            {pt.n === 3 && <LevelCard id={11} meta={meta} onOpen={onOpen} />}
          </div>
        </section>
      ))}
    </main>
  );
}

function LevelCard({ id, meta, onOpen }: { id: number; meta: Meta; onOpen: (id: number) => void }) {
  const l = LEVELS.find((x) => x.id === id)!;
  const completed = meta.completed.includes(id);
  const started = hasSave(id);
  return (
    <button class={`lcard ${completed ? 'done' : started ? 'going' : ''}`} onClick={() => onOpen(id)}>
      <div class="lc-top">
        <span class="lc-num">{l.free ? '★' : l.id}</span>
        <span class="lc-title">{l.title}</span>
        <span class="lc-status">{completed ? '✓ 完成' : started ? '進行中' : ''}</span>
      </div>
      <p class="lc-blurb">{l.blurb}</p>
      <div class="lc-meta">
        <span class={`role ${l.role}`}>{l.role === 'lead' ? '部長' : '部員'}</span>
        {l.minutes > 0 && <span class="dim small">約 {l.minutes} 分鐘</span>}
        {l.part === 3 && !l.free && <span class="tag">部長必修・部員選修</span>}
        {l.free && <span class="tag">沒有任務，想練什麼練什麼</span>}
        <RuleCodes codes={l.rules} />
      </div>
    </button>
  );
}
