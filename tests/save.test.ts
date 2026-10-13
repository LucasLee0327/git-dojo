import { describe, expect, it, vi } from 'vitest';
import { Game } from '../src/core/game';
import { clearAll, hasSave, loadLevel, loadMeta, saveLevel, saveMeta, storageStatus } from '../src/store/save';
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
});
