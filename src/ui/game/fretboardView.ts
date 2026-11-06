import { BASS_STRINGS, bassPosition, SHOWN_FRETS, type FretPosition } from '../../domain/game/fretboard';
import { h } from './dom';

const INLAYS = new Set([3, 5, 7]);

/**
 * The bass neck as a player looks down at it in a diagram: the G string on top, the low E at the bottom, the nut on
 * the left and frets 1-7. Held notes light up where a beginner plays them; guide positions (what to copy) are marked.
 */
export function renderFretboard(): { el: HTMLElement; set(held: ReadonlySet<number>): void; guide(positions: readonly FretPosition[]): void } {
  const cells = new Map<string, HTMLElement>();
  const key = (s: number, f: number) => `${s}:${f}`;
  const rows = [...BASS_STRINGS.keys()].reverse().map((s) =>
    h('div.vr-fb-row', null,
      h('span.vr-fb-name', null, BASS_STRINGS[s]!),
      ...Array.from({ length: SHOWN_FRETS + 1 }, (_, f) => {
        const dot = h('span.vr-fb-dot');
        const cell = h(`div.vr-fb-cell${f === 0 ? '.open' : ''}` as 'div', null, dot);
        cells.set(key(s, f), cell);
        return cell;
      })));
  const numbers = h('div.vr-fb-row.numbers', null, h('span.vr-fb-name'),
    ...Array.from({ length: SHOWN_FRETS + 1 }, (_, f) => h(`span.vr-fb-num${INLAYS.has(f) ? '.inlay' : ''}` as 'span', null, f === 0 ? 'open' : String(f))));
  return {
    el: h('div.vr-fretboard', { 'aria-hidden': 'true' }, ...rows, numbers),
    set(held) {
      const lit = new Set<string>();
      for (const n of held) {
        const p = bassPosition(n);
        if (p && p.fret <= SHOWN_FRETS) lit.add(key(p.string, p.fret));
      }
      for (const [k, c] of cells) c.classList.toggle('down', lit.has(k));
    },
    guide(positions) {
      const g = new Map(positions.map((p, i) => [key(p.string, p.fret), i + 1]));
      for (const [k, c] of cells) {
        c.classList.toggle('guide', g.has(k));
        c.firstElementChild!.textContent = positions.length > 1 && g.has(k) ? String(g.get(k)) : '';
      }
    },
  };
}
