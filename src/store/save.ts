// localStorage 存檔：版本化 key；所有讀寫都包 try/catch；storage 壞掉時退回記憶體，網站照常運作。
import type { Game } from '../core/game';
import { Game as GameClass } from '../core/game';
import type { Checkpoint, GameState } from '../core/types';

export const SAVE_VERSION = 1;
const PREFIX = `git-dojo:v${SAVE_VERSION}:`;
const META_KEY = `${PREFIX}meta`;
// 關卡內容版本：只影響「進行中的關卡存檔」，不影響 META（完成紀錄、速度等）。
// 維護者注意：只要任何關卡的初始設定或目標做了不相容的修改（舊存檔還原出來會和新關卡定義對不上），
// 就把 LEVEL_REV 加一。舊版本的進行中存檔會被忽略並清掉；完成紀錄保留。
export const LEVEL_REV = 2;
const levelKey = (id: number) => `${PREFIX}level:r${LEVEL_REV}:${id}`;
const MAX_LEVEL_ID = 20;

/** 清掉舊格式（無版本號）與舊版本號的關卡存檔。盡力而為，絕不丟例外。 */
function purgeStale(id: number) {
  try {
    rawRemove(`${PREFIX}level:${id}`);
    for (let r = 1; r < LEVEL_REV; r++) rawRemove(`${PREFIX}level:r${r}:${id}`);
  } catch {
    /* 忽略 */
  }
}
let swept = false;
function sweepStale() {
  if (swept) return;
  swept = true;
  for (let i = 0; i <= MAX_LEVEL_ID; i++) purgeStale(i);
}

export type Speed = 'slow' | 'normal' | 'fast' | 'instant';

export interface Meta {
  v: 1;
  lastLevel: number | null;
  completed: number[];
  speed: Speed;
  panelOpen: boolean;
  seenWelcome: boolean;
  /** 第 0 關的流程地圖視窗是否已自動開過一次（舊存檔沒有此欄位，預設 false） */
  seenFlowMap?: boolean;
}

const DEFAULT_META: Meta = { v: 1, lastLevel: null, completed: [], speed: 'normal', panelOpen: true, seenWelcome: false, seenFlowMap: false };

// ---- 最底層：能用 localStorage 就用，否則退回記憶體 ----
const mem = new Map<string, string>();
let persistent = true;
let warned = false;

export const storageStatus = (): 'ok' | 'memory' => (persistent ? 'ok' : 'memory');

function rawGet(k: string): string | null {
  try {
    const v = window.localStorage.getItem(k);
    if (v !== null) return v;
  } catch {
    persistent = false;
  }
  return mem.get(k) ?? null;
}

function rawSet(k: string, v: string): boolean {
  try {
    window.localStorage.setItem(k, v);
    mem.delete(k);
    return true;
  } catch {
    persistent = false;
    mem.set(k, v);
    return false;
  }
}

function rawRemove(k: string) {
  mem.delete(k);
  try {
    window.localStorage.removeItem(k);
  } catch {
    persistent = false;
  }
}

export function probeStorage(): boolean {
  try {
    const k = `${PREFIX}probe`;
    window.localStorage.setItem(k, '1');
    window.localStorage.removeItem(k);
    persistent = true;
  } catch {
    persistent = false;
  }
  return persistent;
}

// ---- 中繼資料 ----
export function loadMeta(): Meta {
  try {
    const raw = rawGet(META_KEY);
    if (!raw) return { ...DEFAULT_META };
    const m = JSON.parse(raw) as Partial<Meta>;
    if (m.v !== 1) return { ...DEFAULT_META };
    return {
      ...DEFAULT_META,
      ...m,
      completed: Array.isArray(m.completed) ? m.completed.filter((x) => typeof x === 'number') : [],
    } as Meta;
  } catch {
    return { ...DEFAULT_META };
  }
}

export function saveMeta(m: Meta) {
  try {
    rawSet(META_KEY, JSON.stringify(m));
  } catch {
    /* 忽略 */
  }
}

// ---- 單一關卡的存檔 ----
interface Slot {
  v: 1;
  state: GameState;
  checkpoints: Checkpoint[];
  savedAt: number;
}

export function hasSave(id: number): boolean {
  sweepStale();
  purgeStale(id);
  return rawGet(levelKey(id)) !== null;
}

export function loadLevel(id: number): Game | null {
  sweepStale();
  purgeStale(id);
  try {
    const raw = rawGet(levelKey(id));
    if (!raw) return null;
    const slot = JSON.parse(raw) as Slot;
    if (slot.v !== 1 || !slot.state || slot.state.v !== 1 || slot.state.levelId !== id) return null;
    if (!slot.state.world || !slot.state.world.repos || !slot.state.world.objects) return null;
    let cps: Checkpoint[] = [];
    try {
      cps = (Array.isArray(slot.checkpoints) ? slot.checkpoints : []).map((c) => ({ ...c, snap: restoreObjects(c.snap, slot.state.world.objects) }));
    } catch {
      cps = [];
    }
    return GameClass.restore(slot.state, cps);
  } catch {
    return null;
  }
}

/**
 * commit 物件池只增不減，而且佔了存檔的大宗；檢查點存檔時把它拿掉，載入時再從目前的狀態補回去，
 * 這樣十個檢查點加起來也只有一般存檔的零頭大小。
 */
function stripObjects(snap: string): string {
  const s = JSON.parse(snap) as GameState;
  (s.world as { objects: unknown }).objects = {};
  return JSON.stringify(s);
}
function restoreObjects(snap: string, objects: GameState['world']['objects']): string {
  const s = JSON.parse(snap) as GameState;
  s.world.objects = objects;
  return JSON.stringify(s);
}

/** 存檔。太大（超過配額）時先丟掉時光倒流的檢查點再試一次。 */
export function saveLevel(g: Game): void {
  try {
    const cps = g.checkpoints.map((c) => ({ ...c, snap: stripObjects(c.snap) }));
    const slot: Slot = { v: 1, state: g.state, checkpoints: cps, savedAt: Date.now() };
    if (rawSet(levelKey(g.state.levelId), JSON.stringify(slot))) return;
    if (!persistent) return;
    const slim: Slot = { ...slot, checkpoints: cps.slice(-2) };
    rawSet(levelKey(g.state.levelId), JSON.stringify(slim));
  } catch {
    /* 序列化失敗也不能讓遊戲壞掉 */
  }
}

export function clearLevel(id: number) {
  rawRemove(levelKey(id));
}

export function clearAll() {
  for (let i = 0; i <= MAX_LEVEL_ID; i++) {
    purgeStale(i);
    rawRemove(levelKey(i));
  }
  rawRemove(META_KEY);
}

export function noteWarned(): boolean {
  const was = warned;
  warned = true;
  return was;
}
