import type { AudioEngine } from '../audio/engine';
import type { ChoiceControl, NumberControl, ToggleControl } from '../domain/devices/controls';
import type { OuroborosFx } from '../domain/devices/ouroboros';
import { STEPS, fromSlider, toSlider } from './controls';
import { loadSavedPatches, persistPatch } from './patchStorage';
import { type Option, renderSelector } from './polyPanel';
import { el } from './widgets';

const ACCENT = '#c45bd6'; // channel A
const GREEN = '#a8d83a'; // channel B
const MOD = '#4fc3d4';
const NEUTRAL = '#d9d4c7';
const INK = '#cfcac0';
const STORAGE_KEY = 'moa-fx1.patches';
const WIDTH = 1440;
const HEIGHT = 760;

/** Lightens a #rrggbb colour towards white (for text that sits on black). */
function lighten(hex: string, t: number): string {
  const n = parseInt(hex.slice(1), 16);
  const f = (c: number) => Math.round(c + (255 - c) * t);
  return `#${[(n >> 16) & 255, (n >> 8) & 255, n & 255].map((c) => f(c).toString(16).padStart(2, '0')).join('')}`;
}

const TEXT_A = lighten(ACCENT, 0.3);
const TEXT_B = lighten(GREEN, 0.3);

/** A value as 0..1 for a knob or fader. */
interface Model {
  label: string;
  aria: string;
  get: () => number;
  set: (t: number) => void;
  reset: () => void;
  text: () => string;
  subscribe: (fn: () => void) => () => void;
}

const number = (d: OuroborosFx, id: string): NumberControl => {
  const c = d.control(id);
  if (c.kind !== 'number') throw new Error(`${id} is not a number control`);
  return c;
};
const choice = (d: OuroborosFx, id: string): ChoiceControl => {
  const c = d.control(id);
  if (c.kind !== 'choice') throw new Error(`${id} is not a choice control`);
  return c;
};
const toggle = (d: OuroborosFx, id: string): ToggleControl => {
  const c = d.control(id);
  if (c.kind !== 'toggle') throw new Error(`${id} is not a toggle control`);
  return c;
};

function model(c: NumberControl, label: string, text: (v: number) => string, aria = label): Model {
  return {
    label,
    aria,
    get: () => toSlider(c) / STEPS,
    set: (t) => c.set(fromSlider(c, Math.round(Math.min(1, Math.max(0, t)) * STEPS))),
    reset: () => c.set(c.initial),
    text: () => text(c.value),
    subscribe: (fn) => c.onChange(fn),
  };
}

const pct = (v: number) => `${Math.round(v * 100)} %`;
const signed = (v: number) => `${v > 0 ? '+' : ''}${Math.round(v * 100)} %`;
const db = (v: number) => (v <= 0 ? '-inf dB' : `${(20 * Math.log10(v)).toFixed(1)} dB`);
const ms = (v: number) => (v >= 1000 ? `${(v / 1000).toFixed(2)} s` : `${Math.round(v)} ms`);
const hz = (v: number) => (v >= 1000 ? `${(v / 1000).toFixed(1)} kHz` : `${Math.round(v)} Hz`);

function place(node: HTMLElement, left: number, top: number): void {
  node.style.left = `${left}px`;
  node.style.top = `${top}px`;
}

interface KnobOptions {
  color: string;
  pointer?: string;
  px?: number;
  cw?: number;
  bipolar?: boolean;
  /** Two-part label (feedback paths): each part in its own colour. */
  parts?: [string, string, string, string];
}

/** The design's knob: dark body, pink cap, tick ring and value arc (from the centre for bipolar knobs). */
function renderKnob(m: Model, cx: number, cy: number, o: KnobOptions): HTMLElement {
  const px = o.px ?? 72;
  const cw = o.cw ?? 80;
  const wrap = el('div', 'ouro-knob');
  wrap.style.width = `${cw}px`;
  place(wrap, cx - cw / 2, cy - px / 2);
  const face = el('div', 'ouro-knob-face');
  face.style.width = `${px}px`;
  face.style.height = `${px}px`;
  face.tabIndex = 0;
  face.setAttribute('role', 'slider');
  face.setAttribute('aria-label', m.aria);
  face.setAttribute('aria-orientation', 'vertical');
  face.setAttribute('aria-valuemin', '0');
  face.setAttribute('aria-valuemax', '100');
  const label = el('div', 'ouro-label');
  if (o.parts) {
    const [a, ca, b, cb] = o.parts;
    const first = el('span', undefined, a);
    first.style.color = ca;
    const second = el('span', undefined, b);
    second.style.color = cb;
    label.append(first, second);
  } else {
    label.textContent = m.label;
  }
  const readout = el('div', 'ouro-value');

  const paint = () => {
    const t = m.get();
    const deg = -135 + t * 270;
    let arc: string;
    let dash: string;
    if (!o.bipolar) {
      arc = 'M20.2 59.8 A28 28 0 1 1 59.8 59.8';
      dash = `${(t * 131.95).toFixed(1)} 200`;
    } else {
      const rad = (deg * Math.PI) / 180;
      arc = Math.abs(t - 0.5) < 0.012
        ? 'M40 12 L40 12'
        : `M40 12 A28 28 0 0 ${deg > 0 ? 1 : 0} ${(40 + 28 * Math.sin(rad)).toFixed(2)} ${(40 - 28 * Math.cos(rad)).toFixed(2)}`;
      dash = '200 200';
    }
    // Static markup built from numbers and our own colours only.
    face.innerHTML = `<svg aria-hidden="true" width="${px}" height="${px}" viewBox="0 0 80 80">
      <path d="M16.34 64.42 A34 34 0 1 1 63.66 64.42" fill="none" stroke="#cfcac0" stroke-opacity="0.6" stroke-width="3" stroke-dasharray="1.2 14.8"></path>
      <path d="M20.2 59.8 A28 28 0 1 1 59.8 59.8" fill="none" stroke="#26282c" stroke-width="3"></path>
      <path d="${arc}" fill="none" stroke="${o.color}" stroke-width="3" stroke-dasharray="${dash}"></path>
      <circle cx="40" cy="40" r="25" fill="#060607" stroke="#2c2e33" stroke-width="1.5"></circle>
      <circle cx="40" cy="40" r="16" fill="#d9c3c9" stroke="#8f7a80" stroke-width="1"></circle>
      <path d="M30 36 A11 11 0 0 1 38 29.5" fill="none" stroke="#ffffff" stroke-opacity="0.55" stroke-width="2" stroke-linecap="round"></path>
      <rect x="38.7" y="15" width="2.6" height="10" rx="1.2" fill="${o.pointer ?? o.color}" transform="rotate(${deg.toFixed(1)} 40 40)"></rect>
    </svg>`;
    readout.textContent = m.text();
    face.setAttribute('aria-valuenow', String(Math.round(t * 100)));
    face.setAttribute('aria-valuetext', readout.textContent);
  };
  const setT = (t: number) => {
    m.set(Math.min(1, Math.max(0, t)));
    paint();
  };

  let drag: { y: number; t: number; scale: number } | undefined;
  face.addEventListener('pointerdown', (e) => {
    e.preventDefault();
    face.focus();
    face.setPointerCapture(e.pointerId);
    // The panel is scaled to fit the page, so convert screen pixels back to panel pixels.
    const scale = face.getBoundingClientRect().width / px || 1;
    drag = { y: e.clientY, t: m.get(), scale };
  });
  face.addEventListener('pointermove', (e) => {
    if (drag) setT(drag.t + (drag.y - e.clientY) / drag.scale / (e.shiftKey ? 600 : 160));
  });
  const end = () => {
    drag = undefined;
  };
  face.addEventListener('pointerup', end);
  face.addEventListener('pointercancel', end);
  face.addEventListener('dblclick', () => {
    m.reset();
    paint();
  });
  face.addEventListener('keydown', (e) => {
    const step = e.shiftKey ? 0.1 : 0.02;
    const t = m.get();
    const next: Record<string, number> = {
      ArrowUp: t + step, ArrowRight: t + step, ArrowDown: t - step, ArrowLeft: t - step, Home: 0, End: 1,
    };
    if (e.key in next) {
      e.preventDefault();
      setT(next[e.key]!);
    }
  });
  m.subscribe(paint);
  paint();
  wrap.append(face, label, readout);
  return wrap;
}

/** The modulator's two vertical faders. */
function renderFader(m: Model, cx: number, top: number, h: number, color: string, labelOf: () => string): HTMLElement {
  const wrap = el('div', 'ouro-fader');
  place(wrap, cx - 28, top);
  const span = h - 20;
  const face = el('div', 'ouro-fader-face');
  face.style.height = `${h}px`;
  face.tabIndex = 0;
  face.setAttribute('role', 'slider');
  face.setAttribute('aria-label', m.aria);
  face.setAttribute('aria-orientation', 'vertical');
  face.setAttribute('aria-valuemin', '0');
  face.setAttribute('aria-valuemax', '100');
  const label = el('div', 'ouro-label');
  const readout = el('div', 'ouro-value');
  const ticks = [0, 1, 2, 3, 4].map((i) => `M12 ${10 + (i * span) / 4} H20 M36 ${10 + (i * span) / 4} H44`).join(' ');

  const paint = () => {
    const t = m.get();
    face.innerHTML = `<svg aria-hidden="true" width="56" height="${h}" viewBox="0 0 56 ${h}" style="position:absolute;left:0;top:0">
        <path d="${ticks}" fill="none" stroke="#cfcac0" stroke-opacity="0.6" stroke-width="1.2"></path></svg>
      <div aria-hidden="true" style="position:absolute;left:25px;top:0;bottom:0;width:6px;box-sizing:border-box;border-radius:3px;background:#060607;border:1px solid #3a3d42"></div>
      <div aria-hidden="true" style="position:absolute;left:26px;bottom:0;width:4px;height:${Math.round(t * span + 10)}px;border-radius:2px;background:${color}"></div>
      <div aria-hidden="true" style="position:absolute;left:8px;top:${Math.round((1 - t) * span)}px;width:40px;height:20px;box-sizing:border-box;border-radius:3px;background:#d9c3c9;border:1px solid #8f7a80">
        <div style="position:absolute;left:4px;right:4px;top:8px;height:2px;background:#1b1c1e"></div></div>`;
    label.textContent = labelOf();
    readout.textContent = m.text();
    face.setAttribute('aria-valuenow', String(Math.round(t * 100)));
    face.setAttribute('aria-valuetext', readout.textContent);
  };
  const setT = (t: number) => {
    m.set(Math.min(1, Math.max(0, t)));
    paint();
  };
  let drag: { y: number; t: number; scale: number } | undefined;
  face.addEventListener('pointerdown', (e) => {
    e.preventDefault();
    face.focus();
    face.setPointerCapture(e.pointerId);
    drag = { y: e.clientY, t: m.get(), scale: face.getBoundingClientRect().height / h || 1 };
  });
  face.addEventListener('pointermove', (e) => {
    if (drag) setT(drag.t + (drag.y - e.clientY) / drag.scale / (e.shiftKey ? span * 3.75 : span));
  });
  const end = () => {
    drag = undefined;
  };
  face.addEventListener('pointerup', end);
  face.addEventListener('pointercancel', end);
  face.addEventListener('dblclick', () => {
    m.reset();
    paint();
  });
  face.addEventListener('keydown', (e) => {
    const dir = e.key === 'ArrowUp' || e.key === 'ArrowRight' ? 1 : e.key === 'ArrowDown' || e.key === 'ArrowLeft' ? -1 : 0;
    if (!dir) return;
    e.preventDefault();
    setT(m.get() + dir * 0.02);
  });
  m.subscribe(paint);
  paint();
  wrap.append(face, label, readout);
  return wrap;
}

/** A flat lever switch: lever up is the top label. */
function renderLever(c: ToggleControl | ChoiceControl, cx: number, cy: number, top: string, bottom: string, isUp: () => boolean,
  setUp: (up: boolean) => void, aria: (up: boolean) => string): HTMLElement {
  const wrap = el('div', 'ouro-toggle');
  place(wrap, cx - 30, cy - 38);
  const topText = el('div', 'ouro-toggle-text', top);
  const bottomText = el('div', 'ouro-toggle-text', bottom);
  const button = el('button');
  button.type = 'button';
  button.setAttribute('role', 'switch');
  const paint = () => {
    const up = isUp();
    const ly = up ? 6 : 38;
    button.innerHTML = `<svg aria-hidden="true" width="40" height="44" viewBox="0 0 40 44" style="display:block">
      <circle cx="20" cy="22" r="10" fill="#1b1c1e" stroke="#6b6f75" stroke-width="1.5"></circle>
      <line x1="20" y1="22" x2="20" y2="${ly}" stroke="#b8a9ae" stroke-width="4" stroke-linecap="round"></line>
      <circle cx="20" cy="${ly}" r="4.5" fill="#d9c3c9" stroke="#8f7a80" stroke-width="1"></circle></svg>`;
    button.setAttribute('aria-checked', String(up));
    button.setAttribute('aria-label', aria(up));
    topText.style.color = up ? '#f1eee6' : '#8d9198';
    bottomText.style.color = up ? '#8d9198' : '#f1eee6';
  };
  button.addEventListener('click', () => {
    setUp(!isUp());
    paint();
  });
  c.onChange(paint);
  paint();
  wrap.append(topText, button, bottomText);
  return wrap;
}

function renderSelectorAt(c: ChoiceControl, title: string, step: string, options: Option[], left: number, top: number, ow: number): HTMLElement {
  const wrap = el('div', 'ouro-selector');
  place(wrap, left, top);
  wrap.style.setProperty('--ow', `${ow}px`);
  wrap.append(renderSelector(c, title, step, options));
  return wrap;
}

const SELECTOR_GLYPH = {
  series: 'M1 5 L19 5',
  parallel: 'M1 2 L19 2 M1 8 L19 8',
  pingpong: 'M2 3 H18 M15 1 L18 3 L15 5 M18 8 H2 M5 6 L2 8 L5 10',
  tri: 'M1 8 L5 2 L10 8 L15 2 L19 6',
  ramp: 'M1 9 L8 2 L8 9 L15 2 L15 9',
  sqr: 'M1 9 L1 2 L8 2 L8 9 L15 9 L15 2 L19 2',
  rnd: 'M1 6 L1 3 L5 3 L5 8 L9 8 L9 2 L13 2 L13 6 L18 6',
};
const ROUTINGS: Option[] = [
  { value: 'series', text: 'Series', glyph: SELECTOR_GLYPH.series, aria: 'series' },
  { value: 'parallel', text: 'Parallel', glyph: SELECTOR_GLYPH.parallel, aria: 'parallel' },
  { value: 'pingpong', text: 'Ping-pong', glyph: SELECTOR_GLYPH.pingpong, aria: 'ping-pong' },
];
const WAVES: Option[] = [
  { value: 'tri', text: 'Tri', glyph: SELECTOR_GLYPH.tri, aria: 'triangle' },
  { value: 'ramp', text: 'Ramp', glyph: SELECTOR_GLYPH.ramp, aria: 'ramp' },
  { value: 'sqr', text: 'Square', glyph: SELECTOR_GLYPH.sqr, aria: 'square' },
  { value: 'rnd', text: 'Random', glyph: SELECTOR_GLYPH.rnd, aria: 'random' },
];

/** The static drawing: frames, flow lines with arrowheads, and labels. */
const FRAME_SVG = `<svg aria-hidden="true" width="${WIDTH}" height="754" viewBox="0 0 ${WIDTH} 754" style="position:absolute;left:0;top:0">
<g fill="none" stroke="#cfcac0" stroke-opacity="0.55" stroke-width="1.2">
<rect x="36" y="56" width="464" height="376" rx="12"></rect><rect x="940" y="56" width="464" height="376" rx="12"></rect>
<rect x="36" y="448" width="364" height="228" rx="12"></rect><rect x="420" y="448" width="984" height="228" rx="12"></rect></g>
<g fill="none" stroke="#cfcac0" stroke-opacity="0.85" stroke-width="1.2" stroke-linecap="round" stroke-linejoin="round">
<path d="M36 186 H60 M140 186 H174 M254 186 H288 M368 186 H402"></path><path d="M442 252 V310"></path>
<path d="M402 346 H358 M298 346 H254 M174 346 H140 M60 346 H36"></path>
<path d="M1404 186 H1380 M1300 186 H1266 M1186 186 H1152 M1072 186 H1038"></path><path d="M998 252 V310"></path>
<path d="M1038 346 H1082 M1142 346 H1186 M1266 346 H1300 M1380 346 H1404"></path>
<path d="M140 520 H178 M258 520 H296"></path><path d="M704 581 V548"></path><path d="M888 548 H904 M1074 550 H1088"></path>
<path d="M100 466 V483 M336 484 V467"></path>
<circle cx="704" cy="590" r="9"></circle><circle cx="1326" cy="468" r="9"></circle><circle cx="1368" cy="468" r="9"></circle>
<circle cx="500" cy="140" r="4" fill="#111214"></circle><circle cx="500" cy="400" r="4" fill="#111214"></circle>
<circle cx="940" cy="140" r="4" fill="#111214"></circle><circle cx="940" cy="400" r="4" fill="#111214"></circle></g>
<g fill="#cfcac0" fill-opacity="0.9" stroke="none">
<polygon points="60,186 52,182 52,190"></polygon><polygon points="174,186 166,182 166,190"></polygon><polygon points="288,186 280,182 280,190"></polygon>
<polygon points="402,186 394,182 394,190"></polygon><polygon points="442,310 438,302 446,302"></polygon>
<polygon points="358,346 366,342 366,350"></polygon><polygon points="254,346 262,342 262,350"></polygon><polygon points="140,346 148,342 148,350"></polygon>
<polygon points="36,346 44,342 44,350"></polygon><polygon points="1380,186 1388,182 1388,190"></polygon><polygon points="1266,186 1274,182 1274,190"></polygon>
<polygon points="1152,186 1160,182 1160,190"></polygon><polygon points="1038,186 1046,182 1046,190"></polygon><polygon points="998,310 994,302 1002,302"></polygon>
<polygon points="1082,346 1074,342 1074,350"></polygon><polygon points="1186,346 1178,342 1178,350"></polygon><polygon points="1300,346 1292,342 1292,350"></polygon>
<polygon points="1404,346 1396,342 1396,350"></polygon><polygon points="178,520 170,516 170,524"></polygon><polygon points="296,520 288,516 288,524"></polygon>
<polygon points="704,548 700,556 708,556"></polygon><polygon points="904,548 896,544 896,552"></polygon><polygon points="1088,550 1080,546 1080,554"></polygon>
<polygon points="100,484 96,476 104,476"></polygon><polygon points="336,466 332,474 340,474"></polygon></g>
<g font-family="'IBM Plex Mono', ui-monospace, monospace" font-size="11" fill="#a9adb3">
<text x="40" y="176">IN</text><text x="40" y="336">OUT</text><text x="1400" y="176" text-anchor="end">IN</text><text x="1400" y="336" text-anchor="end">OUT</text>
<text x="704" y="614" text-anchor="middle">GATE IN</text><text x="1306" y="472" text-anchor="end">MOD OUT</text>
<text x="1326" y="472" text-anchor="middle" fill="#e8e4da">+</text><text x="1368" y="472" text-anchor="middle" fill="#e8e4da">-</text></g></svg>`;

const FEEDBACK_PATHS = {
  aa: { d: 'M504 140 H560 V400 H504', color: ACCENT },
  bb: { d: 'M936 140 H880 V400 H936', color: GREEN },
  ab: { d: 'M560 160 L880 380', color: ACCENT },
  ba: { d: 'M880 160 L560 380', color: GREEN },
} as const;

/** The live feedback diagram: line weight and glow follow what each path is really doing (Kill, Freeze and On included). */
function renderFeedbackDiagram(d: OuroborosFx, tickers: (() => void)[]): { svg: SVGSVGElement; status: HTMLElement } {
  const NS = 'http://www.w3.org/2000/svg';
  const svg = document.createElementNS(NS, 'svg');
  for (const [k, v] of Object.entries({ 'aria-hidden': 'true', width: String(WIDTH), height: '754', viewBox: `0 0 ${WIDTH} 754` })) svg.setAttribute(k, v);
  svg.style.cssText = 'position:absolute;left:0;top:0;pointer-events:none';
  const paths = new Map<string, SVGPathElement>();
  const heads = new Map<string, SVGPolygonElement>();
  const group = document.createElementNS(NS, 'g');
  group.setAttribute('fill', 'none');
  group.setAttribute('stroke-linecap', 'round');
  group.setAttribute('stroke-linejoin', 'round');
  const headGroup = document.createElementNS(NS, 'g');
  const headPoints: Record<string, string> = {
    aa: '504,400 512,396 512,404', bb: '936,400 928,396 928,404', ab: '878,378.6 868.3,376.8 872.9,370.2', ba: '562,378.6 571.7,376.8 567.1,370.2',
  };
  for (const key of ['aa', 'bb', 'ab', 'ba'] as const) {
    const path = document.createElementNS(NS, 'path');
    path.setAttribute('d', FEEDBACK_PATHS[key].d);
    path.setAttribute('stroke', FEEDBACK_PATHS[key].color);
    group.append(path);
    paths.set(key, path);
    const head = document.createElementNS(NS, 'polygon');
    head.setAttribute('points', headPoints[key]!);
    head.setAttribute('fill', FEEDBACK_PATHS[key].color);
    headGroup.append(head);
    heads.set(key, head);
  }
  for (const [cx, cy, color] of [[560, 160, ACCENT], [880, 160, GREEN]] as const) {
    const dot = document.createElementNS(NS, 'circle');
    for (const [k, v] of Object.entries({ cx: String(cx), cy: String(cy), r: '3', fill: color })) dot.setAttribute(k, v);
    headGroup.append(dot);
  }
  svg.append(group, headGroup);

  const status = el('div');
  status.style.cssText = "margin-top:4px;font-family:'IBM Plex Mono',ui-monospace,monospace;font-size:11px";
  let last = '';
  tickers.push(() => {
    const key = `${['AA', 'BB', 'AB', 'BA'].map((p) => d.circuit.node(`fb${p}`).params.gain).join()}${toggle(d, 'ouro.kill').value}${toggle(d, 'ouro.freeze').value}`;
    if (key === last) return;
    last = key;
    for (const p of ['aa', 'bb', 'ab', 'ba'] as const) {
      const e = Math.min(1.2, d.circuit.node(`fb${p.toUpperCase()}`).params.gain!);
      const path = paths.get(p)!;
      path.setAttribute('stroke-width', (1.2 + e * 3.6).toFixed(2));
      path.setAttribute('stroke-opacity', (0.3 + Math.min(1, e) * 0.7).toFixed(2));
      path.style.filter = `drop-shadow(0 0 ${(e * 7).toFixed(1)}px ${FEEDBACK_PATHS[p].color})`;
      heads.get(p)!.setAttribute('fill-opacity', (0.3 + Math.min(1, e) * 0.7).toFixed(2));
    }
    const killed = toggle(d, 'ouro.kill').value;
    const frozen = toggle(d, 'ouro.freeze').value;
    status.textContent = killed ? 'KILLED  0 %' : frozen ? 'FROZEN  100 %' : 'LOOP OPEN';
    status.style.color = killed ? '#f08a84' : frozen ? '#8fd8f2' : '#a9adb3';
  });
  return { svg, status };
}

function modPoints(d: OuroborosFx): { points: string; text: string } {
  const mode = choice(d, 'ouro.mod.mode').value;
  const wave = choice(d, 'ouro.mod.wave').value;
  const rate = number(d, 'ouro.mod.rate');
  const rateT = toSlider(rate) / STEPS;
  const depth = number(d, 'ouro.mod.depth').value;
  const N = 84;
  const amp = 6 + 22 * depth;
  const cycles = mode === 'lfo' ? 1 + Math.round(rateT * 5) : 2;
  const hash = (k: number) => {
    const x = Math.sin(k * 12.9898 + 4.1) * 43758.5453;
    return (x - Math.floor(x)) * 2 - 1;
  };
  const pts: string[] = [];
  for (let i = 0; i <= N; i++) {
    const t = (i / N) * cycles;
    const f = t - Math.floor(t);
    let v: number;
    if (mode === 'env') v = 2 * Math.exp(-(12 - rateT * 10) * f) - 1;
    else if (wave === 'tri') v = 1 - 4 * Math.abs(f - 0.5);
    else if (wave === 'ramp') v = 2 * f - 1;
    else if (wave === 'sqr') v = f < 0.5 ? 1 : -1;
    else v = hash(Math.floor(t * 2));
    pts.push(`${((i / N) * 168).toFixed(1)},${(32 - v * amp).toFixed(1)}`);
  }
  const rateText = mode === 'lfo' ? `${rate.value >= 10 ? rate.value.toFixed(0) : rate.value.toFixed(1)} Hz` : `${hz(rate.value)}`;
  return {
    points: pts.join(' '),
    text: mode === 'lfo' ? `LFO ${wave.toUpperCase()}  ${rateText}` : `ENV FOLLOW  ${rateText}`,
  };
}

/**
 * The Ouroboros front panel: a fixed 1440x760 matte-black layout that scales to fit the page.
 * Signal flow is drawn as lines; the feedback diagram glows with what each path is doing.
 */
export function renderOuroPanel(d: OuroborosFx, deviceId: string, engine: AudioEngine): HTMLElement {
  loadSavedPatches(STORAGE_KEY, d);
  d.loadSlot(d.currentSlot);

  const wrap = el('div', 'ouro-wrap');
  const panel = el('div', 'ouro-panel');
  const tickers: (() => void)[] = [];
  wrap.append(panel);
  panel.insertAdjacentHTML('beforeend', FRAME_SVG); // static drawing: numbers and our own colours only

  const feedback = renderFeedbackDiagram(d, tickers);
  panel.append(feedback.svg);

  // Header
  const title = el('div', 'ouro-abs');
  title.style.cssText = 'left:36px;top:8px;display:flex;align-items:baseline;gap:16px';
  const name = el('div', undefined, 'OUROBOROS');
  name.style.cssText = 'font-size:38px;font-weight:700;letter-spacing:.1em;line-height:1';
  const sub = el('div', undefined, 'Dual Feedback Delay');
  sub.style.cssText = 'font-size:14px;font-weight:500;letter-spacing:.32em;color:#a9adb3;text-transform:uppercase';
  title.append(name, sub);
  const code = el('div', 'ouro-abs');
  code.style.cssText = 'right:36px;top:16px;display:flex;align-items:center;gap:10px;font-size:13px;letter-spacing:.2em;color:#a9adb3;text-transform:uppercase';
  const dot = el('span');
  dot.style.cssText = `width:10px;height:10px;border-radius:50%;background:${ACCENT};box-shadow:0 0 10px ${ACCENT}`;
  code.append(el('span', undefined, 'MOA-FX1'), dot);
  panel.append(title, code);

  // Channel boxes and titles
  const channelHeads = [
    { side: 'a' as const, letter: 'A', box: 52, titleLeft: 124, align: 'left', color: ACCENT, text: TEXT_A },
    { side: 'b' as const, letter: 'B', box: 1328, titleLeft: 1016, align: 'right', color: GREEN, text: TEXT_B },
  ];
  for (const ch of channelHeads) {
    const box = el('div', 'ouro-abs', ch.letter);
    box.style.cssText = `left:${ch.box}px;top:70px;width:60px;height:52px;box-sizing:border-box;border:2px solid ${ch.color};border-radius:12px;display:flex;align-items:center;justify-content:center;font-size:38px;font-weight:700;line-height:1;color:${ch.text}`;
    const heading = el('div', 'ouro-abs');
    heading.style.cssText = `left:${ch.titleLeft}px;top:74px;width:300px;text-align:${ch.align}`;
    const h2 = el('h2', undefined, `Channel ${ch.letter}`);
    h2.style.cssText = 'margin:0;font-size:22px;font-weight:600;letter-spacing:.22em;text-transform:uppercase';
    const chain = el('div', undefined, 'Gain > Delay > Grit > Filter > Clip');
    chain.style.cssText = 'margin-top:4px;font-size:12px;font-weight:500;letter-spacing:.14em;text-transform:uppercase;color:#a9adb3';
    heading.append(h2, chain);
    panel.append(box, heading);
    const on = toggle(d, `ouro.${ch.side}.on`);
    const paintBox = () => {
      box.style.borderColor = on.value ? ch.color : '#5a5e64';
      box.style.color = on.value ? ch.text : '#8d9198';
    };
    on.onChange(paintBox);
    paintBox();
  }
  const fbTitle = el('div', 'ouro-abs');
  fbTitle.style.cssText = 'left:620px;top:66px;width:200px;text-align:center';
  const fbH = el('h2', undefined, 'Feedback');
  fbH.style.cssText = 'margin:0;font-size:20px;font-weight:600;letter-spacing:.3em;text-transform:uppercase';
  fbTitle.append(fbH, feedback.status);
  panel.append(fbTitle);

  // Section labels and the bus tags
  const labels: [string, string][] = [
    ['left:160px;top:458px;font-size:14px;font-weight:600;letter-spacing:.14em;text-transform:uppercase;white-space:nowrap', 'Input / Routing'],
    ['left:436px;top:458px;font-size:15px;font-weight:600;letter-spacing:.22em;text-transform:uppercase', 'Modulator'],
  ];
  for (const [css, text] of labels) {
    const l = el('div', 'ouro-abs', text);
    l.style.cssText += css;
    panel.append(l);
  }
  const tag = (left: number, width: number, size: number, spacing: string, text: string) => {
    const t = el('div', 'ouro-abs', text);
    t.style.cssText = `left:${left}px;top:446px;width:${width}px;height:20px;box-sizing:border-box;z-index:1;background:#111214;border:1px solid ${ACCENT};border-radius:10px;color:${TEXT_A};font-size:${size}px;font-weight:600;letter-spacing:${spacing};line-height:18px;text-align:center;white-space:nowrap`;
    return t;
  };
  panel.append(tag(56, 88, 12, '.1em', 'IN: BUS C'), tag(274, 124, 11, '.08em', 'OUT: FX 3 RETURN'));

  // Knobs: master
  panel.append(
    renderKnob(model(number(d, 'ouro.input'), 'Input', db), 100, 520, { color: NEUTRAL }),
    renderKnob(model(number(d, 'ouro.mix'), 'Dry/Wet', pct), 218, 520, { color: NEUTRAL }),
    renderKnob(model(number(d, 'ouro.output'), 'Output', db), 336, 520, { color: NEUTRAL }),
  );

  // Channels: B is the mirror of A.
  for (const ch of channelHeads) {
    const X = (x: number) => (ch.side === 'b' ? WIDTH - x : x);
    const id = (k: string) => `ouro.${ch.side}.${k}`;
    const aria = (what: string) => `Channel ${ch.letter} ${what}`;
    const k = (key: string, label: string, text: (v: number) => string, cx: number, cy: number) =>
      renderKnob(model(number(d, id(key)), label, text, aria(label)), X(cx), cy, { color: ch.color });
    panel.append(
      k('gain', 'Gain', (v) => `${v >= 1 ? '+' : ''}${db(v)}`, 100, 186),
      k('delay', 'Delay', ms, 214, 186),
      k('grit', 'Grit', (v) => `${Math.round(16 - v * 13)} bit`, 328, 186),
      k('cutoff', 'Cutoff', hz, 442, 186),
      k('resonance', 'Resonance', (v) => v.toFixed(1), 442, 346),
      k('clip', 'Clip', pct, 214, 346),
      k('level', 'Level', pct, 100, 346),
    );
    const filter = choice(d, id('filter'));
    panel.append(
      renderLever(filter, X(328), 346, 'HP', 'LP', () => filter.value === 'hp',
        (up) => filter.set(up ? 'hp' : 'lp'), (up) => `Channel ${ch.letter} filter: ${up ? 'high-pass' : 'low-pass'}`),
    );
    const on = toggle(d, id('on'));
    panel.append(
      renderLever(on, ch.side === 'a' ? 460 : 980, 100, 'ON', 'OFF', () => on.value, (up) => on.set(up),
        (up) => `Channel ${ch.letter} ${up ? 'on' : 'off'}`),
    );
  }

  // Feedback matrix
  const fbKnob = (path: 'aa' | 'ab' | 'ba' | 'bb', cx: number, cy: number) => {
    const from = path[0]!.toUpperCase();
    const to = path[1]!.toUpperCase();
    const colorOf = (s: string) => (s === 'A' ? ACCENT : GREEN);
    const textOf = (s: string) => (s === 'A' ? TEXT_A : TEXT_B);
    return renderKnob(model(number(d, `ouro.fb.${path}`), `${from}>${to}`, pct, `Feedback ${from} to ${to}`), cx, cy, {
      color: colorOf(from), parts: [`${from}>`, textOf(from), to, textOf(to)],
    });
  };
  panel.append(fbKnob('aa', 560, 270), fbKnob('bb', 880, 270), fbKnob('ab', 656, 233), fbKnob('ba', 784, 233));

  // Modulator
  const modeControl = choice(d, 'ouro.mod.mode');
  const rateModel = model(number(d, 'ouro.mod.rate'), 'Rate', (v) => (modeControl.value === 'lfo' ? `${v >= 10 ? v.toFixed(0) : v.toFixed(1)} Hz` : hz(v)), 'Modulator rate');
  const baseSubscribe = rateModel.subscribe;
  rateModel.subscribe = (fn) => {
    const offs = [baseSubscribe(fn), modeControl.onChange(fn)];
    return () => offs.forEach((off) => off());
  };
  panel.append(
    renderFader(rateModel, 550, 490, 100, MOD, () => (modeControl.value === 'lfo' ? 'Rate' : 'Speed')),
    renderFader(model(number(d, 'ouro.mod.depth'), 'Depth', pct, 'Modulator depth'), 620, 490, 100, MOD, () => 'Depth'),
    renderLever(modeControl, 471, 540, 'LFO', 'ENV', () => modeControl.value === 'lfo', (up) => modeControl.set(up ? 'lfo' : 'env'),
      (up) => `Modulator mode: ${up ? 'LFO' : 'envelope follower'}`),
    renderSelectorAt(choice(d, 'ouro.mod.wave'), 'Wave', 'Step modulator wave', WAVES, 756, 500, 80),
  );
  const dests: [string, string, string, number][] = [
    ['dlyA', 'To Delay A', ACCENT, 1138], ['cutA', 'To Cutoff A', ACCENT, 1236], ['gainA', 'To Gain A', ACCENT, 1334],
    ['dlyB', 'To Delay B', GREEN, 1138], ['cutB', 'To Cutoff B', GREEN, 1236], ['gainB', 'To Gain B', GREEN, 1334],
  ];
  dests.forEach(([key, label, color, cx], i) => {
    panel.append(renderKnob(model(number(d, `ouro.mod.${key}`), label, signed), cx, i < 3 ? 520 : 606, {
      color, px: 52, cw: 96, bipolar: true,
    }));
  });
  // Trigger key, and the modulator display
  const trig = toggle(d, 'ouro.mod.trigger');
  const trigWrap = el('div', 'ouro-abs');
  trigWrap.style.cssText = 'left:664px;top:500px;z-index:1;background:#111214';
  const trigButton = el('button', 'ouro-key', 'Trigger');
  trigButton.type = 'button';
  trigButton.style.cssText = 'width:80px;font-size:14px;letter-spacing:.14em';
  trigButton.setAttribute('aria-label', 'Trigger envelope');
  const trigOn = () => {
    trig.set(true);
    trigButton.setAttribute('aria-pressed', 'true');
    trigButton.style.background = MOD;
  };
  const trigOff = () => {
    trig.set(false);
    trigButton.setAttribute('aria-pressed', 'false');
    trigButton.style.background = '';
  };
  trigButton.addEventListener('pointerdown', trigOn);
  for (const ev of ['pointerup', 'pointerleave', 'pointercancel']) trigButton.addEventListener(ev, trigOff);
  trigButton.addEventListener('keydown', (e) => {
    if ((e.key === ' ' || e.key === 'Enter') && !e.repeat) {
      e.preventDefault();
      trigOn();
    }
  });
  trigButton.addEventListener('keyup', trigOff);
  trigWrap.append(trigButton);
  panel.append(trigWrap);

  const display = el('div', 'ouro-display');
  display.style.cssText = 'left:904px;top:500px;width:170px';
  display.append(el('div', 'ouro-display-title', 'MOD'));
  const NS = 'http://www.w3.org/2000/svg';
  const wave = document.createElementNS(NS, 'svg');
  for (const [k, v] of Object.entries({ role: 'img', 'aria-label': 'Modulator waveform', width: '168', height: '64', viewBox: '0 0 168 64' })) wave.setAttribute(k, v);
  const axis = document.createElementNS(NS, 'line');
  for (const [k, v] of Object.entries({ x1: '0', y1: '32', x2: '168', y2: '32', stroke: '#2c3036', 'stroke-width': '1' })) axis.setAttribute(k, v);
  const line = document.createElementNS(NS, 'polyline');
  for (const [k, v] of Object.entries({ fill: 'none', stroke: TEXT_A, 'stroke-width': '1.6', 'stroke-linejoin': 'round', 'stroke-linecap': 'round' })) line.setAttribute(k, v);
  wave.append(axis, line);
  const modText = el('div', 'ouro-display-text');
  display.append(wave, modText);
  panel.append(display);
  const paintMod = () => {
    const m = modPoints(d);
    line.setAttribute('points', m.points);
    modText.textContent = m.text;
  };
  for (const id of ['ouro.mod.mode', 'ouro.mod.wave', 'ouro.mod.rate', 'ouro.mod.depth']) d.control(id).onChange(paintMod);
  paintMod();

  // Routing, Kill, Freeze, level meter
  panel.append(renderSelectorAt(choice(d, 'ouro.routing'), 'Routing', 'Step routing', ROUTINGS, 52, 598, 106));
  const buttons = el('div', 'ouro-abs');
  buttons.style.cssText = 'left:222px;top:600px;display:flex;gap:8px;z-index:1';
  const kill = toggle(d, 'ouro.kill');
  const killButton = el('button', 'ouro-key');
  killButton.type = 'button';
  killButton.style.cssText = 'width:80px;font-size:16px;letter-spacing:.16em';
  killButton.setAttribute('aria-label', 'Kill: hold to cut all feedback');
  const killLed = el('span', 'ouro-led');
  killButton.append(killLed, el('span', undefined, 'Kill'));
  const paintKill = () => {
    killButton.setAttribute('aria-pressed', String(kill.value));
    killButton.style.background = kill.value ? '#e0524a' : '';
    killLed.style.background = kill.value ? '#1a0707' : '';
  };
  kill.onChange(paintKill);
  const killOn = () => kill.set(true);
  const killOff = () => kill.set(false);
  killButton.addEventListener('pointerdown', killOn);
  for (const ev of ['pointerup', 'pointerleave', 'pointercancel']) killButton.addEventListener(ev, killOff);
  killButton.addEventListener('keydown', (e) => {
    if ((e.key === ' ' || e.key === 'Enter') && !e.repeat) {
      e.preventDefault();
      killOn();
    }
  });
  killButton.addEventListener('keyup', killOff);
  paintKill();

  const freeze = toggle(d, 'ouro.freeze');
  const freezeButton = el('button', 'ouro-key');
  freezeButton.type = 'button';
  freezeButton.style.cssText = 'width:80px;font-size:16px;letter-spacing:.12em';
  freezeButton.setAttribute('aria-label', 'Freeze: latch feedback at 100 percent');
  const freezeLed = el('span', 'ouro-led');
  freezeButton.append(freezeLed, el('span', undefined, 'Freeze'));
  const paintFreeze = () => {
    freezeButton.setAttribute('aria-pressed', String(freeze.value));
    freezeButton.style.background = freeze.value ? '#7fd0f0' : '';
    freezeLed.style.background = freeze.value ? '#06222e' : '';
  };
  freeze.onChange(paintFreeze);
  freezeButton.addEventListener('click', () => freeze.set(!freeze.value));
  paintFreeze();
  buttons.append(killButton, freezeButton);
  panel.append(buttons);

  const meter = el('div', 'ouro-meter');
  meter.style.cssText += 'left:222px;top:654px';
  meter.setAttribute('role', 'img');
  meter.setAttribute('aria-label', 'Output level');
  const meterRows = (['L', 'R'] as const).map((side) => {
    const row = el('div', 'ouro-meter-row');
    const segs = Array.from({ length: 10 }, () => el('span', 'ouro-seg'));
    row.append(...segs);
    meter.append(row);
    const nodeId = d.meters.find((m) => m.name === side)!.nodeId;
    return { segs, nodeId };
  });
  panel.append(meter);
  let level = 0;
  tickers.push(() => {
    level = 0;
    for (const { segs, nodeId } of meterRows) {
      const peak = engine.readLevel(deviceId, nodeId);
      level = Math.max(level, peak);
      const dbv = peak > 0 ? 20 * Math.log10(peak) : -48;
      const lit = Math.round(Math.min(1, Math.max(0, (dbv + 48) / 48)) * 10);
      segs.forEach((s, i) => {
        s.style.background = i < lit ? (i >= 9 ? '#e0524a' : i >= 7 ? '#dcb43c' : '#4fb286') : '';
      });
    }
  });

  panel.append(renderPatchStrip(d, tickers, () => level));

  // Scale the fixed layout to the width it is given.
  const fit = () => {
    if (!wrap.clientWidth) return; // not attached yet
    const scale = wrap.clientWidth / WIDTH;
    panel.style.transform = `scale(${scale})`;
    wrap.style.height = `${Math.round(HEIGHT * scale)}px`;
  };
  wrap.style.height = `${HEIGHT}px`;
  new ResizeObserver(fit).observe(wrap);
  window.requestAnimationFrame(fit);

  const tick = () => {
    for (const t of tickers) t();
    requestAnimationFrame(tick);
  };
  requestAnimationFrame(tick);
  return wrap;
}

function renderPatchStrip(d: OuroborosFx, tickers: (() => void)[], level: () => number): HTMLElement {
  const strip = el('section', 'ouro-patch');
  strip.setAttribute('aria-label', 'Patch');
  const head = el('div');
  head.style.cssText = 'display:flex;align-items:center;gap:10px';
  const bar = el('span');
  bar.style.cssText = `width:28px;height:5px;border-radius:2px;background:${ACCENT}`;
  head.append(bar, el('h2', undefined, 'Patch'));

  const display = el('div', 'ouro-patch-display');
  display.setAttribute('role', 'status');
  display.setAttribute('aria-label', 'Current patch');
  const name = el('span');
  name.style.cssText = `font-family:'IBM Plex Mono',ui-monospace,monospace;font-size:18px;color:${TEXT_A};white-space:nowrap`;
  const tag = el('span');
  tag.style.cssText = "font-family:'IBM Plex Mono',ui-monospace,monospace;font-size:11px;color:#a9adb3;white-space:nowrap";
  display.append(name, tag);

  const keys = el('div');
  keys.style.cssText = 'display:flex;gap:8px;flex:none';
  const presetButtons = d.slots.map((_, i) => {
    const b = el('button', 'ouro-key ouro-preset', String(i + 1));
    b.type = 'button';
    b.addEventListener('click', () => d.loadSlot(i));
    keys.append(b);
    return b;
  });

  const routingNames: Record<string, string> = { series: 'Series', parallel: 'Parallel', pingpong: 'Ping-pong' };
  let savedFlash = false;
  const paint = () => {
    name.textContent = `${String(d.currentSlot + 1).padStart(2, '0')} ${d.currentPreset.name}`;
    tag.textContent = savedFlash ? 'Saved' : routingNames[choice(d, 'ouro.routing').value] ?? '';
    presetButtons.forEach((b, i) => {
      const on = i === d.currentSlot;
      b.setAttribute('aria-pressed', String(on));
      b.setAttribute('aria-label', `Preset ${i + 1}, ${d.slots[i]!.name}`);
      b.title = d.slots[i]!.name;
      b.style.background = on ? ACCENT : '';
      b.style.borderColor = on ? ACCENT : '';
      b.style.boxShadow = on ? `0 0 10px ${ACCENT}` : '';
    });
  };
  d.onPresetChange(paint);
  choice(d, 'ouro.routing').onChange(paint);

  const save = el('button', 'ouro-key', 'Save');
  save.type = 'button';
  save.style.cssText = 'padding:0 18px;font-size:15px;letter-spacing:.16em;flex:none';
  save.setAttribute('aria-label', 'Save patch');
  save.addEventListener('click', () => {
    persistPatch(STORAGE_KEY, d.currentSlot, d.saveSlot(d.currentSlot));
    savedFlash = true;
    paint();
    window.setTimeout(() => {
      savedFlash = false;
      paint();
    }, 1500);
  });

  const spacer = el('div');
  spacer.style.flex = '1';
  const signal = el('div');
  signal.style.cssText = 'display:flex;align-items:center;gap:10px;font-size:13px;letter-spacing:.2em;color:#a9adb3;text-transform:uppercase;flex:none';
  const led = el('span');
  led.style.cssText = 'width:10px;height:10px;border-radius:50%;background:#3a3d42';
  signal.append(el('span', undefined, 'Signal'), led);
  tickers.push(() => {
    const on = level() > 0.002;
    led.style.background = on ? ACCENT : '#3a3d42';
    led.style.boxShadow = on ? `0 0 10px ${ACCENT}` : 'none';
  });
  paint();
  strip.append(head, display, keys, save, spacer, signal);
  return strip;
}
