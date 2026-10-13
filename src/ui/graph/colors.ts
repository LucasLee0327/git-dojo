// 每條分支一個顏色：圖、標籤、終端機提示字元、GitHub 頁面都用同一份。
const FIXED: Record<string, string> = {
  master: '#e8832a',
  staging: '#4f8cff',
};
const PALETTE = ['#2fb86b', '#b07cf0', '#ef6f9a', '#27b5c4', '#d9b13a', '#8aa4ff', '#e0623f', '#7fb83a'];
export const NEUTRAL = '#8b93a1';

let assigned = new Map<string, string>();
let next = 0;

/** origin/feat/x → feat/x（遠端追蹤分支跟本機分支同色） */
export const branchKey = (name: string): string => name.replace(/^origin\//, '');

export function resetColors() {
  assigned = new Map();
  next = 0;
}

export function colorOf(name: string | null | undefined): string {
  if (!name) return NEUTRAL;
  const k = branchKey(name);
  if (FIXED[k]) return FIXED[k];
  let c = assigned.get(k);
  if (!c) {
    c = PALETTE[next % PALETTE.length];
    next++;
    assigned.set(k, c);
  }
  return c;
}
