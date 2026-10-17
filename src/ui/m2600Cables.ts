import { type Cord, jackKind, jackName, orient } from '../domain/devices/m2600Cords';
import type { M2600Synth } from '../domain/devices/m2600Synth';

/** Where a jack sits on the panel, in layout units. */
export interface JackSpot {
  el: HTMLElement;
  x: number;
  y: number;
}

const PALETTE = ['#e8402e', '#f2c230', '#2f7fd8', '#3fae5a', '#f08a2c', '#e9e9e4', '#9b59d0', '#1c1c1e'];

/** A stable colour per cord, so a cord keeps its colour when others come and go. */
function colour(c: Cord): string {
  let h = 0;
  for (const ch of `${c.from}>${c.to}`) h = (h * 31 + ch.charCodeAt(0)) >>> 0;
  return PALETTE[h % PALETTE.length]!;
}

/** A hanging cable between two points: the further apart, the deeper it sags. */
function cablePath(x1: number, y1: number, x2: number, y2: number): string {
  const sag = Math.min(140, 22 + Math.hypot(x2 - x1, y2 - y1) * 0.32);
  return `M${x1} ${y1} C${x1} ${y1 + sag} ${x2} ${y2 + sag} ${x2} ${y2}`;
}

function cableMarkup(x1: number, y1: number, x2: number, y2: number, fill: string, live = false): string {
  const d = cablePath(x1, y1, x2, y2);
  const plug = (x: number, y: number) => `<circle cx="${x}" cy="${y}" r="7" fill="${fill}" stroke="#111" stroke-width="2"/><circle cx="${x}" cy="${y}" r="2.6" fill="#111" opacity="0.55"/>`;
  return `<g class="m26-cable${live ? ' m26-cable-live' : ''}">
    <path d="${d}" stroke="rgba(0,0,0,0.45)" stroke-width="7.5" fill="none" stroke-linecap="round" transform="translate(1.5 3)"/>
    <path d="${d}" stroke="#111" stroke-width="6.5" fill="none" stroke-linecap="round"/>
    <path d="${d}" stroke="${fill}" stroke-width="4.5" fill="none" stroke-linecap="round"/>
    ${plug(x1, y1)}${live ? '' : plug(x2, y2)}
  </g>`;
}

/**
 * Patch cords on the desktop panel. Drag from a jack to another to patch; grab a plugged input (or MULT jack) to
 * pull its cord out and take it elsewhere, or drop it on the panel to remove it. Click a jack, then another, does
 * the same without dragging (touch and keyboard: Enter or Space on a jack, Escape cancels, Delete pulls its cords).
 * Double-click a jack to pull out everything plugged into it. Cables hang over the panel but never catch the pointer.
 */
export function mountCables(
  root: HTMLElement,
  synth: M2600Synth,
  jacks: ReadonlyMap<string, JackSpot>,
  w: number,
  h: number,
  say: (text: string) => void,
): void {
  const layer = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  layer.setAttribute('class', 'm26-cables');
  layer.setAttribute('viewBox', `0 0 ${w} ${h}`);
  layer.setAttribute('aria-hidden', 'true');
  root.append(layer);

  /** The jack a cord is being patched from (a click-click selection or a drag), and where the pointer is. */
  let anchor: string | undefined;
  let pointer: { x: number; y: number } | undefined;

  const draw = () => {
    let svg = '';
    for (const c of synth.cords) {
      const a = jacks.get(c.from), b = jacks.get(c.to);
      if (a && b) svg += cableMarkup(a.x, a.y, b.x, b.y, colour(c));
    }
    const from = anchor ? jacks.get(anchor) : undefined;
    if (from && pointer) svg += cableMarkup(from.x, from.y, pointer.x, pointer.y, '#f4f4f0', true);
    layer.innerHTML = svg; // built from layout numbers and a fixed palette only
    const plugged = new Set(synth.cords.flatMap((c) => [c.from, c.to]));
    for (const [id, spot] of jacks) {
      spot.el.classList.toggle('m26-plugged', plugged.has(id));
      spot.el.classList.toggle('m26-anchor', id === anchor);
      spot.el.classList.toggle('m26-target', !!anchor && id !== anchor && !!orient(anchor, id));
    }
  };
  synth.onCordsChange(draw);

  const begin = (id: string) => {
    anchor = id;
    say(`Patching from ${jackName(id)}: drop or click on a jack (Esc cancels)`);
    draw();
  };
  const cancel = () => {
    anchor = undefined;
    pointer = undefined;
    draw();
  };
  const finish = (to: string) => {
    const from = anchor!;
    anchor = undefined;
    pointer = undefined;
    if (synth.connect(from, to)) say(`Patched ${jackName(from)} → ${jackName(to)}`);
    else say(`${jackName(from)} and ${jackName(to)} can't be joined (an output goes to an input or a MULT)`);
    draw();
  };
  /** The cord plugged into a one-plug jack (an input or a MULT jack), if any. */
  const cordIn = (id: string): Cord | undefined =>
    jackKind(id) === 'out' ? undefined : synth.cords.find((c) => c.from === id || c.to === id);

  const toLayout = (e: PointerEvent) => {
    const r = root.getBoundingClientRect();
    return { x: ((e.clientX - r.left) / r.width) * w, y: ((e.clientY - r.top) / r.height) * h };
  };
  const jackAt = (e: PointerEvent): string | undefined =>
    (document.elementFromPoint(e.clientX, e.clientY)?.closest('[data-jack]') as HTMLElement | null)?.dataset.jack;

  for (const [id, spot] of jacks) {
    const el = spot.el;
    let down: { x: number; y: number; picked?: Cord } | undefined;

    el.addEventListener('pointerdown', (e) => {
      if (e.button !== 0) return;
      e.preventDefault();
      el.setPointerCapture(e.pointerId);
      // a plugged one-plug jack: pick its cord up by this end and carry it from the other end
      const picked = anchor ? undefined : cordIn(id);
      down = { x: e.clientX, y: e.clientY, picked };
      if (picked) {
        synth.setCords(synth.cords.filter((c) => c !== picked));
        begin(picked.from === id ? picked.to : picked.from);
        pointer = toLayout(e);
        draw();
      }
    });
    el.addEventListener('pointermove', (e) => {
      if (!down || !el.hasPointerCapture(e.pointerId)) return;
      if (!anchor && Math.hypot(e.clientX - down.x, e.clientY - down.y) > 5) begin(id);
      if (anchor) {
        pointer = toLayout(e);
        draw();
      }
    });
    el.addEventListener('pointerup', (e) => {
      if (!down) return;
      const { picked } = down;
      const moved = Math.hypot(e.clientX - down.x, e.clientY - down.y) > 5;
      down = undefined;
      if (moved) {
        const target = jackAt(e);
        if (target && target !== anchor) finish(target);
        else {
          if (picked) say(`Pulled out ${jackName(picked.from)} → ${jackName(picked.to)}`);
          cancel();
        }
        return;
      }
      // a click: put back anything picked up, then select, complete or cancel
      if (picked) {
        synth.setCords([...synth.cords, picked]);
        anchor = undefined;
      }
      pointer = undefined;
      if (!anchor) begin(id);
      else if (anchor === id) cancel();
      else finish(id);
    });
    el.addEventListener('pointercancel', () => {
      down = undefined;
      cancel();
    });
    el.addEventListener('dblclick', () => {
      synth.unplug(id);
      cancel();
      say(`Pulled every cord out of ${jackName(id)}`);
    });
    el.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' || e.key === ' ') {
        e.preventDefault();
        if (!anchor) begin(id);
        else if (anchor === id) cancel();
        else finish(id);
      } else if (e.key === 'Delete' || e.key === 'Backspace') {
        e.preventDefault();
        synth.unplug(id);
        say(`Pulled every cord out of ${jackName(id)}`);
      }
    });
  }
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && anchor) cancel();
  });
  // the click-click mode follows the pointer too, so you can see where the cable will go; a click off the jacks cancels it
  root.addEventListener('pointermove', (e) => {
    if (anchor) {
      pointer = toLayout(e);
      draw();
    }
  });
  root.addEventListener('pointerdown', (e) => {
    if (anchor && !(e.target as HTMLElement).closest('[data-jack]')) cancel();
  });
  draw();
}
