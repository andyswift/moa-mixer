import type { NumberControl, ToggleControl } from '../domain/devices/controls';
import { STEPS, format, formatCompact, fromSlider, toSlider } from './controls';

export function el<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  className?: string,
  text?: string,
): HTMLElementTagNameMap[K] {
  const e = document.createElement(tag);
  if (className) e.className = className;
  if (text !== undefined) e.textContent = text;
  return e;
}

export interface FaderOptions {
  height?: number;
  capHeight?: number;
  tick?: number;
  /** Control value to mark with a unity line. */
  unity?: number;
}

/** Vertical fader: a transparent native range input (pointer, keyboard, a11y) over a drawn cap. */
export function renderFader(
  c: NumberControl,
  section: string,
  label: string,
  { height = 140, capHeight = 36, tick = 14, unity }: FaderOptions = {},
): HTMLElement {
  const wrap = el('div', 'fader');
  wrap.append(el('div', 'fader-label', label));

  const slot = el('div', 'fader-slot');
  slot.style.setProperty('--slot-h', `${height}px`);
  slot.style.setProperty('--cap-h', `${capHeight}px`);
  slot.style.setProperty('--tick', `${tick}px`);
  slot.append(el('div', 'fader-track'));
  if (unity !== undefined) {
    const line = el('div', 'fader-unity');
    const t = (unity - c.min) / (c.max - c.min);
    line.style.top = `${Math.round((1 - t) * (height - capHeight) + capHeight / 2)}px`;
    slot.append(line);
  }
  const cap = el('div', 'fader-cap');
  cap.append(el('span', 'fader-cap-line'));
  slot.append(cap);

  const input = el('input', 'fader-input');
  input.type = 'range';
  input.min = '0';
  input.max = String(STEPS);
  input.setAttribute('aria-label', `${section} ${c.label}`);
  slot.append(input);

  const readout = el('div', 'fader-value');

  const sync = () => {
    input.value = String(toSlider(c));
    const t = Number(input.value) / STEPS;
    cap.style.top = `${Math.round((1 - t) * (height - capHeight))}px`;
    readout.textContent = format(c);
    input.setAttribute('aria-valuetext', readout.textContent);
  };
  input.addEventListener('input', () => {
    c.set(fromSlider(c, Number(input.value)));
    sync();
  });
  slot.addEventListener('dblclick', () => {
    c.set(c.initial);
    sync();
  });
  sync();

  wrap.append(slot, readout);
  return wrap;
}

const KNOB_SWEEP = 270; // degrees, centred on 12 o'clock
const DRAG_PIXELS = 160; // vertical drag for the full range

/** Rotary knob: drag vertically, arrow keys, Home/End, double-click resets. */
export function renderKnob(c: NumberControl, section: string, label: string, size = 34): HTMLElement {
  const wrap = el('div', 'knob-wrap');
  wrap.append(el('div', 'knob-label', label));

  const knob = el('div', 'knob');
  knob.style.width = `${size}px`;
  knob.style.height = `${size}px`;
  knob.tabIndex = 0;
  knob.setAttribute('role', 'slider');
  knob.setAttribute('aria-label', `${section} ${c.label}`);
  knob.setAttribute('aria-orientation', 'vertical');
  knob.setAttribute('aria-valuemin', String(c.min));
  knob.setAttribute('aria-valuemax', String(c.max));
  const pointer = el('div', 'knob-pointer');
  knob.append(pointer);
  const readout = el('div', 'knob-value');

  const sync = () => {
    const t = toSlider(c) / STEPS;
    pointer.style.transform = `rotate(${-KNOB_SWEEP / 2 + t * KNOB_SWEEP}deg)`;
    readout.textContent = formatCompact(c);
    knob.setAttribute('aria-valuenow', String(c.value));
    knob.setAttribute('aria-valuetext', readout.textContent);
  };
  const setT = (t: number) => {
    c.set(fromSlider(c, Math.round(Math.min(1, Math.max(0, t)) * STEPS)));
    sync();
  };

  let drag: { y: number; t: number } | undefined;
  knob.addEventListener('pointerdown', (e) => {
    knob.setPointerCapture(e.pointerId);
    drag = { y: e.clientY, t: toSlider(c) / STEPS };
  });
  knob.addEventListener('pointermove', (e) => {
    if (drag) setT(drag.t + (drag.y - e.clientY) / DRAG_PIXELS);
  });
  const end = () => {
    drag = undefined;
  };
  knob.addEventListener('pointerup', end);
  knob.addEventListener('pointercancel', end);
  knob.addEventListener('dblclick', () => {
    c.set(c.initial);
    sync();
  });
  knob.addEventListener('keydown', (e) => {
    const t = toSlider(c) / STEPS;
    const step = e.shiftKey ? 0.1 : 0.02;
    const next: Record<string, number> = {
      ArrowUp: t + step, ArrowRight: t + step, ArrowDown: t - step, ArrowLeft: t - step, Home: 0, End: 1,
    };
    if (e.key in next) {
      e.preventDefault();
      setT(next[e.key]!);
    }
  });
  sync();

  wrap.append(knob, readout);
  return wrap;
}

/** Push button bound to a toggle control; `text` may change with state (e.g. Pre/Post). */
export function renderToggleButton(
  c: ToggleControl,
  ariaLabel: string,
  text: (on: boolean) => string,
  color: string,
  className = 'btn',
): HTMLButtonElement {
  const b = el('button', className);
  b.type = 'button';
  b.setAttribute('aria-label', ariaLabel);
  const paint = () => {
    b.textContent = text(c.value);
    b.setAttribute('aria-pressed', String(c.value));
    b.style.background = c.value ? color : '';
    b.style.borderColor = c.value ? color : '';
  };
  b.addEventListener('click', () => {
    c.set(!c.value);
    paint();
  });
  paint();
  return b;
}
