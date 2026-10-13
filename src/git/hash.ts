// 確定性的偽 SHA-1（只求看起來像、可重現）
function cyrb(str: string, seed: number): number {
  let h1 = 0xdeadbeef ^ seed;
  let h2 = 0x41c6ce57 ^ seed;
  for (let i = 0; i < str.length; i++) {
    const ch = str.charCodeAt(i);
    h1 = Math.imul(h1 ^ ch, 2654435761);
    h2 = Math.imul(h2 ^ ch, 1597334677);
  }
  h1 = Math.imul(h1 ^ (h1 >>> 16), 2246822507) ^ Math.imul(h2 ^ (h2 >>> 13), 3266489909);
  h2 = Math.imul(h2 ^ (h2 >>> 16), 2246822507) ^ Math.imul(h1 ^ (h1 >>> 13), 3266489909);
  return (h2 >>> 0) * 0x100000 + ((h1 >>> 0) & 0xfffff);
}

export function fakeSha(input: string): string {
  let out = '';
  for (let s = 0; out.length < 40; s++) {
    out += cyrb(input, s * 7919 + 1).toString(16).padStart(14, '0');
  }
  return out.slice(0, 40);
}

export const short = (id: string) => id.slice(0, 7);
