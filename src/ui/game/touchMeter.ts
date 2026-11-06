import { h } from './dom';

/**
 * How hard the last note was played: a bar from 0 to 127 with the dead-note zone shaded up to `threshold`, and a
 * marker where the note landed. For practising soft (dead) notes against normal ones.
 */
/** `numbers`: show the velocity itself (touch setup, on the keyboard's own scale); lessons show only dead or full. */
export function renderTouchMeter(threshold: number, numbers = true): { el: HTMLElement; show(velocity: number): void; setThreshold(t: number): void } {
  const zone = h('div.vr-touch-zone');
  const mark = h('div.vr-touch-mark', { hidden: true });
  const label = h('span.vr-mono', null, 'Touch: play a note');
  const bar = h('div.vr-touch-bar', null, zone, mark);
  const setThreshold = (t: number) => { zone.style.width = `${(t / 127) * 100}%`; };
  setThreshold(threshold);
  let current = threshold;
  return {
    el: h('div.vr-touch', { 'aria-live': 'polite' }, h('div', { style: 'display: flex; justify-content: space-between' }, label, h('span.vr-mono', null, 'dead ← · → full')), bar),
    show(v) {
      mark.hidden = false;
      mark.style.left = `${(v / 127) * 100}%`;
      mark.classList.toggle('dead', v <= current);
      label.textContent = `Touch: ${numbers ? `velocity ${v} · ` : ''}${v <= current ? 'dead note' : 'full note'}`;
    },
    setThreshold(t) { current = t; setThreshold(t); },
  };
}
