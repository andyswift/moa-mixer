import type { NumberControl } from '../domain/devices/controls';
import { STEPS, format, fromSlider, toSlider } from './controls';
import { el } from './widgets';

const SWEEP = 270; // degrees, centred on 12 o'clock
const DRAG_PIXELS = 160; // vertical drag for the full range
const FINE_PIXELS = 600; // with Shift
const ARC_LENGTH = 131.95; // 270 degrees of the r=28 value arc

/** A dial's value as 0..1, so it can drive a number control or any other stepped value. */
export interface DialModel {
  label: string;
  color: string;
  get: () => number;
  set: (t: number) => void;
  reset: () => void;
  text: () => string;
  /** Follows changes made elsewhere (e.g. loading a patch); returns an unsubscribe. */
  subscribe: (fn: () => void) => () => void;
  /** Keyboard step in 0..1 units. */
  step?: number;
}

/** A number control as a dial. */
export function controlDial(c: NumberControl, color: string, label = c.label): DialModel {
  return {
    label,
    color,
    get: () => toSlider(c) / STEPS,
    set: (t) => c.set(fromSlider(c, Math.round(Math.min(1, Math.max(0, t)) * STEPS))),
    reset: () => c.set(c.initial),
    text: () => format(c),
    subscribe: (fn) => c.onChange(fn),
  };
}

const svg = (t: number, color: string) => {
  const deg = Math.round((-SWEEP / 2 + t * SWEEP) * 10) / 10;
  return `<svg aria-hidden="true" width="72" height="72" viewBox="0 0 80 80">
    <path d="M16.34 64.42 A34 34 0 1 1 63.66 64.42" fill="none" stroke="#6b6f75" stroke-width="4" stroke-dasharray="1.2 14.8"></path>
    <path d="M20.2 59.8 A28 28 0 1 1 59.8 59.8" fill="none" stroke="#33363b" stroke-width="3"></path>
    <path d="M20.2 59.8 A28 28 0 1 1 59.8 59.8" fill="none" stroke="${color}" stroke-width="3" stroke-dasharray="${(t * ARC_LENGTH).toFixed(1)} 200"></path>
    <circle cx="40" cy="40" r="22" fill="#101112" stroke="#4a4e54" stroke-width="1.5"></circle>
    <circle cx="40" cy="40" r="15" fill="#25282c" stroke="#3a3d42" stroke-width="1"></circle>
    <rect x="38.8" y="21.5" width="2.4" height="15" rx="1.2" fill="#f1eee6" transform="rotate(${deg} 40 40)"></rect>
  </svg>`;
};

/** Flat rotary dial: drag vertically (Shift for fine), arrow keys, Home/End, double-click resets. */
export function renderDial(model: DialModel, section: string): HTMLElement {
  const wrap = el('div', 'dial');
  const face = el('div', 'dial-face');
  face.tabIndex = 0;
  face.setAttribute('role', 'slider');
  face.setAttribute('aria-label', `${section} ${model.label}`);
  face.setAttribute('aria-orientation', 'vertical');
  face.setAttribute('aria-valuemin', '0');
  face.setAttribute('aria-valuemax', '100');
  const label = el('div', 'dial-label', model.label);
  const readout = el('div', 'dial-value');

  const sync = () => {
    const t = model.get();
    face.innerHTML = svg(t, model.color); // static markup built from numbers and our own colours only
    readout.textContent = model.text();
    face.setAttribute('aria-valuenow', String(Math.round(t * 100)));
    face.setAttribute('aria-valuetext', readout.textContent);
  };
  const setT = (t: number) => {
    model.set(Math.min(1, Math.max(0, t)));
    sync();
  };

  let drag: { y: number; t: number } | undefined;
  face.addEventListener('pointerdown', (e) => {
    e.preventDefault();
    face.focus();
    face.setPointerCapture(e.pointerId);
    drag = { y: e.clientY, t: model.get() };
  });
  face.addEventListener('pointermove', (e) => {
    if (drag) setT(drag.t + (drag.y - e.clientY) / (e.shiftKey ? FINE_PIXELS : DRAG_PIXELS));
  });
  const end = () => {
    drag = undefined;
  };
  face.addEventListener('pointerup', end);
  face.addEventListener('pointercancel', end);
  face.addEventListener('dblclick', () => {
    model.reset();
    sync();
  });
  face.addEventListener('keydown', (e) => {
    const step = (e.shiftKey ? 5 : 1) * (model.step ?? 0.02);
    const t = model.get();
    const next: Record<string, number> = {
      ArrowUp: t + step, ArrowRight: t + step, ArrowDown: t - step, ArrowLeft: t - step, Home: 0, End: 1,
    };
    if (e.key in next) {
      e.preventDefault();
      setT(next[e.key]!);
    }
  });
  model.subscribe(sync);
  sync();

  wrap.append(face, label, readout);
  return wrap;
}
