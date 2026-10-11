import { el } from './widgets';

export interface WheelOptions {
  label: string;
  ariaLabel: string;
  /** True: -1..1 with a centre detent (pitch bend). False: 0..1 (mod wheel). */
  bipolar: boolean;
  /** Scale marks from top to bottom, e.g. ['+2', '0', '-2']. */
  scale: string[];
  /** Springs back to centre when released. */
  springBack: boolean;
  /** Arrow-key step in value units. */
  keyStep: number;
  get: () => number;
  set: (value: number) => void;
  /** Subscribes to changes made elsewhere (e.g. MIDI); returns an unsubscribe. */
  subscribe: (fn: () => void) => () => void;
  format: (value: number) => string;
}

const DEAD_ZONE = 0.04; // pitch wheel snaps to centre inside this

/** A modulation/pitch wheel: drag vertically, arrow keys, optional spring-back. */
export function renderWheel(o: WheelOptions): HTMLElement {
  const wrap = el('div', 'wheel');
  wrap.append(el('div', 'wheel-label', o.label));

  const body = el('div', 'wheel-body');
  const scale = el('div', 'wheel-scale');
  scale.setAttribute('aria-hidden', 'true');
  for (const mark of o.scale) scale.append(el('span', undefined, mark));

  const wheel = el('button', 'wheel-face');
  wheel.type = 'button';
  wheel.setAttribute('role', 'slider');
  wheel.setAttribute('aria-label', o.ariaLabel);
  wheel.setAttribute('aria-orientation', 'vertical');
  wheel.setAttribute('aria-valuemin', o.bipolar ? '-1' : '0');
  wheel.setAttribute('aria-valuemax', '1');
  wheel.append(el('span', 'wheel-ribs'));
  if (o.bipolar) {
    wheel.append(el('span', 'wheel-detent wheel-detent-left'), el('span', 'wheel-detent wheel-detent-right'));
  }

  const marker = el('div', 'wheel-marker');
  marker.setAttribute('aria-hidden', 'true');
  const readout = el('div', 'wheel-readout');

  const unit = (v: number) => (o.bipolar ? (v + 1) / 2 : v); // 0 at the bottom, 1 at the top
  const sync = () => {
    const v = o.get();
    const t = unit(v);
    wheel.style.setProperty('--rib', `${Math.round(v * -60)}px`);
    marker.style.top = `${Math.round((1 - t) * 102)}px`;
    readout.textContent = o.format(v);
    wheel.setAttribute('aria-valuenow', String(v));
    wheel.setAttribute('aria-valuetext', o.format(v));
  };
  const apply = (v: number) => {
    const clamped = Math.min(o.bipolar ? 1 : 1, Math.max(o.bipolar ? -1 : 0, v));
    o.set(o.bipolar && Math.abs(clamped) < DEAD_ZONE ? 0 : clamped);
    sync();
  };
  const fromPointer = (e: PointerEvent) => {
    const r = wheel.getBoundingClientRect();
    const t = Math.min(1, Math.max(0, 1 - (e.clientY - r.top) / r.height));
    apply(o.bipolar ? t * 2 - 1 : t);
  };

  let dragging = false;
  wheel.addEventListener('pointerdown', (e) => {
    wheel.setPointerCapture(e.pointerId);
    dragging = true;
    fromPointer(e);
  });
  wheel.addEventListener('pointermove', (e) => {
    if (dragging) fromPointer(e);
  });
  const release = () => {
    dragging = false;
    if (o.springBack) apply(0);
  };
  wheel.addEventListener('pointerup', release);
  wheel.addEventListener('pointercancel', release);
  wheel.addEventListener('keydown', (e) => {
    const dir = e.key === 'ArrowUp' || e.key === 'ArrowRight' ? 1 : e.key === 'ArrowDown' || e.key === 'ArrowLeft' ? -1 : 0;
    if (!dir) return;
    e.preventDefault();
    apply(o.get() + dir * o.keyStep);
  });
  wheel.addEventListener('keyup', () => {
    if (o.springBack) apply(0);
  });
  wheel.addEventListener('dblclick', () => apply(0));
  o.subscribe(sync);
  sync();

  const markers = el('div', 'wheel-markers');
  markers.append(marker);
  body.append(scale, wheel, markers);
  wrap.append(body, readout);
  return wrap;
}
