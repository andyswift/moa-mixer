import { calibrate, type TouchSetup } from '../../domain/game/touch';
import { button, h } from './dom';
import type { Game } from './game';
import { renderTouchMeter } from './touchMeter';

const TOUCH_NOTES = 4;

/**
 * Setting the player's touch: four notes as soft as they can, four played normally, the dead-note threshold between.
 * Saved as soon as it is worked out, so the next note already uses it; then the player can try it on the meter.
 * Used as a setup screen of its own and inside a lesson. Feed it the keyboard's own (raw) velocities.
 */
export function renderTouchSetup(game: Game, opts: { compact?: boolean; onDone?(setup: TouchSetup): void } = {}): {
  el: HTMLElement;
  /** A note played, at the keyboard's own velocity. */
  note(rawVelocity: number): void;
  reset(): void;
} {
  const soft: number[] = [];
  const normal: number[] = [];
  const kicker = h('span.vr-kicker.hot');
  const ask = h(opts.compact ? 'span.vr-touch-ask' : 'h1.vr-title' as 'span');
  const steps = h('div.vr-touch-steps');
  const text = h(opts.compact ? 'span.vr-mono' : 'p.vr-lede' as 'span');
  const meter = renderTouchMeter(game.progress.touch?.threshold ?? 40);
  const again = button('Start over', () => reset());

  function render(): void {
    const phase = soft.length < TOUCH_NOTES ? 'soft' : normal.length < TOUCH_NOTES ? 'normal' : 'done';
    const list = phase === 'soft' ? soft : normal;
    kicker.textContent = `Your touch · ${phase === 'soft' ? 'step 1 of 2' : phase === 'normal' ? 'step 2 of 2' : 'done'}`;
    ask.textContent = phase === 'soft' ? 'Play four notes as softly as you can' : phase === 'normal' ? 'Now four notes played normally' : 'Try it';
    steps.replaceChildren(...Array.from({ length: TOUCH_NOTES }, (_, i) => h(`div.vr-touch-step${i < list.length ? '.done' : ''}` as 'div', null, i < list.length ? String(list[i]) : '·')));
    steps.hidden = phase === 'done';
    if (phase !== 'done') {
      text.textContent = 'The bass plays very soft notes as dead notes. Keyboards answer touch differently, so this sets where soft ends for yours.';
      return;
    }
    const setup = calibrate(soft, normal);
    game.progress = { ...game.progress, touch: setup };
    game.save();
    meter.setThreshold(setup.threshold);
    text.textContent = setup.sensitive
      ? `Your dead notes: velocity ${setup.threshold} or softer. Play a few soft and normal notes and watch where they land.`
      : 'Your keyboard hardly changes velocity between soft and normal notes, so dead notes will be hard on it. Check its velocity setting and try again.';
    opts.onDone?.(setup);
  }
  function reset(): void {
    soft.length = 0;
    normal.length = 0;
    render();
  }
  render();
  return {
    el: h('div', { style: 'display: flex; flex-direction: column; gap: 14px' },
      h('div', { style: 'display: flex; flex-direction: column; gap: 6px' }, kicker, ask, text), steps, meter.el, h('div.vr-row', { style: 'max-width: 640px' }, again)),
    note(v) {
      meter.show(v);
      if (soft.length < TOUCH_NOTES) soft.push(v);
      else if (normal.length < TOUCH_NOTES) normal.push(v);
      else return;
      render();
    },
    reset,
  };
}
