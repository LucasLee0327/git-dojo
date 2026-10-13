import { useEffect, useState } from 'preact/hooks';
import type { ComponentChildren } from 'preact';
import type { Game } from '../core/game';
import { ruleOf, splitCodes } from '../levels/rules';
import { colorOf } from './graph/colors';

/** 訂閱 Game：每次 emit 都重新繪製 */
export function useGame(g: Game) {
  const [, set] = useState(0);
  useEffect(() => g.subscribe(() => set((n) => n + 1)), [g]);
}

/** 分支名稱的色塊：同一條分支在所有地方同色 */
export function BranchChip({ name, remote, title }: { name: string; remote?: boolean; title?: string }) {
  const c = colorOf(name);
  return (
    <span class={`bchip${remote ? ' remote' : ''}`} style={`--bc:${c}`} title={title ?? name}>
      <i class="bdot" />
      {remote ? `origin/${name}` : name}
    </span>
  );
}

export function RuleCodes({ codes }: { codes: string[] }) {
  const all = codes.flatMap(splitCodes);
  return (
    <span class="rulecodes">
      {all.map((c) => (
        <span key={c} class="rulecode" title={ruleOf(c)?.text ?? c}>
          {c}
        </span>
      ))}
    </span>
  );
}

export function Modal({ children, onClose, wide }: { children: ComponentChildren; onClose?: () => void; wide?: boolean }) {
  useEffect(() => {
    if (!onClose) return;
    const h = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', h);
    return () => window.removeEventListener('keydown', h);
  }, [onClose]);
  return (
    <div class="modal-back" onClick={(e) => e.target === e.currentTarget && onClose?.()}>
      <div class={`modal${wide ? ' wide' : ''}`} role="dialog" aria-modal="true">
        {children}
      </div>
    </div>
  );
}

export const shortId = (id: string | null | undefined) => (id ? id.slice(0, 7) : '');
