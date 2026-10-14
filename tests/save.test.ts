import { describe, expect, it, vi } from 'vitest';
import { Game } from '../src/core/game';
import { clearAll, hasSave, loadLevel, loadMeta, probeStorage, saveLevel, saveMeta, storageStatus } from '../src/store/save';
import { start } from './helpers';

// node 環境沒有 localStorage：存檔層必須退回記憶體模式、而且不丟例外
describe('存檔層：localStorage 不可用時也能運作', () => {
  it('寫入、讀回、倒流檢查點都正常（記憶體模式）', () => {
    clearAll();
    const g = start(1);
    g.runTerminal('git switch -c feat/save-test');
    saveLevel(g);
    expect(hasSave(1)).toBe(true);
    const g2 = loadLevel(1) as Game;
    expect(g2).toBeTruthy();
    expect(g2.branch).toBe('feat/save-test');
    expect(g2.checkpoints.length).toBe(1);
    expect(g2.undoTo(g2.checkpoints[0].id)).toBe(true);
    expect(g2.branch).not.toBe('feat/save-test');
  });

  it('meta 讀寫不丟例外，預設值完整', () => {
    saveMeta({ ...loadMeta(), lastLevel: 3 });
    expect(loadMeta().lastLevel).toBe(3);
    expect(['ok', 'memory']).toContain(storageStatus());
  });

  it('localStorage 每次存取都丟例外時，仍然可讀可寫', () => {
    const boom = () => {
      throw new Error('SecurityError');
    };
    vi.stubGlobal('localStorage', {
      getItem: boom,
      setItem: boom,
      removeItem: boom,
      clear: boom,
      key: boom,
      get length(): number {
        return boom();
      },
    });
    try {
      const g = start(2);
      expect(() => saveLevel(g)).not.toThrow();
      expect(() => loadLevel(2)).not.toThrow();
      expect(() => clearAll()).not.toThrow();
      expect(() => saveMeta(loadMeta())).not.toThrow();
    } finally {
      vi.unstubAllGlobals();
    }
  });

  it('壞掉或版本不符的存檔會被忽略而不是讓網站當掉', () => {
    const store: Record<string, string> = { 'git-dojo:v1:level:4': '{not json', 'git-dojo:v1:level:5': '{"v":99}' };
    vi.stubGlobal('localStorage', {
      getItem: (k: string) => store[k] ?? null,
      setItem: (k: string, v: string) => void (store[k] = v),
      removeItem: (k: string) => void delete store[k],
    });
    try {
      expect(loadLevel(4)).toBeNull();
      expect(loadLevel(5)).toBeNull();
    } finally {
      vi.unstubAllGlobals();
    }
  });

  it('內容改版：舊格式的進行中關卡存檔不載入並被清掉，meta 保留，新存檔可往返', () => {
    const store: Record<string, string> = {};
    // 存檔層走的是 window.localStorage，node 環境要連 window 一起假造
    vi.stubGlobal('window', {
      localStorage: {
        getItem: (k: string) => store[k] ?? null,
        setItem: (k: string, v: string) => void (store[k] = v),
        removeItem: (k: string) => void delete store[k],
      },
    });
    try {
      probeStorage(); // 前面的測試可能已把存檔層標成記憶體模式
      // 先用目前版本產生一份合法存檔，再把它放到舊格式的 key 底下
      const old = start(3);
      old.runTerminal('git switch -c feat/old-world');
      saveLevel(old);
      const [curKey] = Object.keys(store).filter((k) => k.includes(':level:'));
      expect(curKey).toMatch(/:level:r[0-9]+:3$/);
      const legacyKey = 'git-dojo:v1:level:3';
      store[legacyKey] = store[curKey];
      delete store[curKey];
      store['git-dojo:v1:meta'] = JSON.stringify({ v: 1, lastLevel: 3, completed: [1, 2], speed: 'fast', panelOpen: false, seenWelcome: true });

      expect(hasSave(3)).toBe(false);
      expect(loadLevel(3)).toBeNull();
      expect(store[legacyKey]).toBeUndefined();
      const m = loadMeta();
      expect(m.completed).toEqual([1, 2]);
      expect(m.speed).toBe('fast');
      expect(m.seenWelcome).toBe(true);
      expect(m.seenFlowMap).toBe(false);

      const fresh = start(3);
      fresh.runTerminal('git switch -c feat/new-world');
      saveLevel(fresh);
      expect(hasSave(3)).toBe(true);
      expect((loadLevel(3) as Game).branch).toBe('feat/new-world');
    } finally {
      vi.unstubAllGlobals();
    }
  });
});
