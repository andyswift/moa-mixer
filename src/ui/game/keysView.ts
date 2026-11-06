import { h } from './dom';

const KEYS_FROM = 36; // C2
const KEYS_TO = 84; // C6
const BLACK = new Set([1, 3, 6, 8, 10]);

/** A keyboard picture: held keys light up, guide keys (a chord to copy) are marked; the Cs carry their names. */
export function renderKeys(): { el: HTMLElement; set(held: ReadonlySet<number>): void; guide(keys: readonly number[]): void } {
  const keys = new Map<number, HTMLElement>();
  const whites = h('div.vr-keys-white');
  const blacks = h('div.vr-keys-black');
  let whiteCount = 0;
  for (let n = KEYS_FROM; n <= KEYS_TO; n++) if (!BLACK.has(n % 12)) whiteCount++;
  let w = 0;
  for (let n = KEYS_FROM; n <= KEYS_TO; n++) {
    if (BLACK.has(n % 12)) {
      const k = h('div.vr-key.black', { style: `left: calc(${(w / whiteCount) * 100}% - 0.9%)` });
      keys.set(n, k);
      blacks.append(k);
    } else {
      const k = h('div.vr-key.white', null, n % 12 === 0 ? `C${n / 12 - 1}` : '');
      keys.set(n, k);
      whites.append(k);
      w++;
    }
  }
  return {
    el: h('div.vr-keys', { 'aria-hidden': 'true' }, whites, blacks),
    set(held) { for (const [n, k] of keys) k.classList.toggle('down', held.has(n)); },
    guide(g) { for (const [n, k] of keys) k.classList.toggle('guide', g.includes(n)); },
  };
}
