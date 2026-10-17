import type { AudioEngine } from '../audio/engine';
import type { BusCompFx } from '../domain/devices/busComp';
import type { ChoiceControl, NumberControl, ToggleControl } from '../domain/devices/controls';
import type { Mixer } from '../domain/devices/mixer';
import { STEPS, fromSlider, toSlider } from './controls';
import { loadSavedPatches, persistPatch } from './patchStorage';
import { el } from './widgets';

const STORAGE_KEY = 'moa-fx2.patches';
const WIDTH = 1440;
const HEIGHT = 400;
const NS = 'http://www.w3.org/2000/svg';
const CREAM = '#ece2c4';
const DIM = '#c4c2a4';

const number = (d: BusCompFx, id: string): NumberControl => {
  const c = d.control(id);
  if (c.kind !== 'number') throw new Error(`${id} is not a number control`);
  return c;
};
const toggle = (d: BusCompFx, id: string): ToggleControl => {
  const c = d.control(id);
  if (c.kind !== 'toggle') throw new Error(`${id} is not a toggle control`);
  return c;
};

const ms = (v: number) => (v >= 1000 ? `${(v / 1000).toFixed(2)} s` : v < 10 ? `${v.toFixed(1)} ms` : `${Math.round(v)} ms`);
const dbText = (v: number) => `${v > 0 ? '+' : ''}${Math.round(v)} dB`;
const hz = (v: number) => `${Math.round(v)} Hz`;
const pct = (v: number) => `${Math.round(v * 100)} %`;
const ratio = (v: number) => `${v % 1 ? v.toFixed(1) : v}:1`;

function place(node: HTMLElement, left: number, top: number): void {
  node.style.left = `${left}px`;
  node.style.top = `${top}px`;
}

function svgEl(tag: string, attrs: Record<string, string>): SVGElement {
  const e = document.createElementNS(NS, tag);
  for (const [k, v] of Object.entries(attrs)) e.setAttribute(k, v);
  return e;
}

/** Dial scale: tick ring (sweep -135..+135, 96x88 box, centre 48,44) with end labels or step labels. */
function tickRing(labels: string[], majors: number): string {
  const centre = { x: 48, y: 44 };
  const pos = (deg: number, r: number) => {
    const rad = (deg * Math.PI) / 180;
    return [centre.x + r * Math.sin(rad), centre.y - r * Math.cos(rad)] as const;
  };
  const out: string[] = [];
  for (let i = 0; i < majors; i++) {
    const deg = -135 + (270 * i) / (majors - 1);
    const [x1, y1] = pos(deg, 33);
    const [x2, y2] = pos(deg, 40);
    out.push(`<line x1="${x1.toFixed(2)}" y1="${y1.toFixed(2)}" x2="${x2.toFixed(2)}" y2="${y2.toFixed(2)}" stroke="${CREAM}" stroke-width="1.6" stroke-linecap="round"/>`);
    const label = labels[i];
    if (label) {
      const [tx, ty] = pos(deg, 47);
      const anchor = tx < 10 ? 'start' : tx > 86 ? 'end' : 'middle';
      const lx = anchor === 'start' ? 1 : anchor === 'end' ? 95 : tx;
      out.push(`<text x="${lx.toFixed(2)}" y="${(ty + 3).toFixed(2)}" text-anchor="${anchor}" font-family="'DM Mono', monospace" font-size="9" fill="${DIM}">${label}</text>`);
    }
  }
  return out.join('');
}

interface KnobSpec {
  control: NumberControl;
  label: string;
  text: (v: number) => string;
  /** End labels (continuous) or one label per step. */
  scale: string[];
  /** Detent values: the knob snaps to these. */
  steps?: number[];
}

/** One knurled brass knob with its tick ring, label and readout. Drag up/down, arrows, double-click to reset. */
function renderKnob(spec: KnobSpec): HTMLElement {
  const c = spec.control;
  const wrap = el('div', 'bc-knob');
  const box = el('div', 'bc-knob-box');
  const ring = svgEl('svg', { width: '96', height: '88', viewBox: '0 0 96 88', 'aria-hidden': 'true' });
  ring.style.cssText = 'position:absolute;left:0;top:0';
  const majors = spec.steps ? spec.steps.length : 11;
  const labels = spec.steps ? spec.scale : [spec.scale[0] ?? '', ...Array(9).fill(''), spec.scale[1] ?? ''];
  ring.innerHTML = tickRing(labels, majors); // numbers and our own colours only
  const cap = el('div', 'bc-knob-cap');
  cap.tabIndex = 0;
  cap.setAttribute('role', 'slider');
  cap.setAttribute('aria-label', spec.label);
  cap.setAttribute('aria-valuemin', '0');
  cap.setAttribute('aria-valuemax', '100');
  cap.innerHTML = '<div class="bc-knob-knurl"></div><div class="bc-knob-brass"></div><div class="bc-knob-pointer"></div>';
  box.append(ring, cap);
  const name = el('div', 'bc-silk', spec.label);
  name.style.fontSize = '13px';
  const readout = el('div', 'bc-readout');
  wrap.append(box, name, readout);

  const nearest = (v: number) => {
    const steps = spec.steps!;
    return steps.reduce((best, s, i) => (Math.abs(s - v) < Math.abs(steps[best]! - v) ? i : best), 0);
  };
  const getT = () => (spec.steps ? nearest(c.value) / (spec.steps.length - 1) : toSlider(c) / STEPS);
  const setT = (t: number) => {
    const clamped = Math.min(1, Math.max(0, t));
    if (spec.steps) c.set(spec.steps[Math.round(clamped * (spec.steps.length - 1))]!);
    else c.set(fromSlider(c, Math.round(clamped * STEPS)));
  };
  const paint = () => {
    const t = getT();
    cap.style.transform = `rotate(${(-135 + t * 270).toFixed(1)}deg)`;
    readout.textContent = spec.text(c.value);
    cap.setAttribute('aria-valuenow', String(Math.round(t * 100)));
    cap.setAttribute('aria-valuetext', readout.textContent);
  };

  let drag: { y: number; t: number; scale: number } | undefined;
  cap.addEventListener('pointerdown', (e) => {
    e.preventDefault();
    cap.focus();
    cap.setPointerCapture(e.pointerId);
    drag = { y: e.clientY, t: getT(), scale: cap.getBoundingClientRect().width / 56 || 1 };
  });
  cap.addEventListener('pointermove', (e) => {
    if (!drag) return;
    const per = spec.steps ? 90 : e.shiftKey ? 600 : 160;
    setT(drag.t + (drag.y - e.clientY) / drag.scale / per);
  });
  const end = () => {
    drag = undefined;
  };
  cap.addEventListener('pointerup', end);
  cap.addEventListener('pointercancel', end);
  cap.addEventListener('dblclick', () => c.set(c.initial));
  cap.addEventListener('keydown', (e) => {
    const step = spec.steps ? 1 / (spec.steps.length - 1) : e.shiftKey ? 0.1 : 0.02;
    const t = getT();
    const next: Record<string, number> = {
      ArrowUp: t + step, ArrowRight: t + step, ArrowDown: t - step, ArrowLeft: t - step, Home: 0, End: 1,
    };
    if (e.key in next) {
      e.preventDefault();
      setT(next[e.key]!);
    }
  });
  c.onChange(paint);
  paint();
  return wrap;
}

/** The VU face. Needle pivot (144,214); 0 dB at +50 degrees, -20 dB at -50. */
function vuFaceSvg(): string {
  const cx = 144;
  const cy = 214;
  const pt = (deg: number, r: number) => {
    const rad = (deg * Math.PI) / 180;
    return [cx + r * Math.sin(rad), cy - r * Math.cos(rad)] as const;
  };
  const f = (n: number) => n.toFixed(2);
  const parts: string[] = [];
  const [ax, ay] = pt(-50, 156);
  const [bx, by] = pt(50, 156);
  parts.push(`<path d="M ${f(ax)} ${f(ay)} A 156 156 0 0 1 ${f(bx)} ${f(by)}" fill="none" stroke="#2a2417" stroke-width="1.5"/>`);
  const [rx0, ry0] = pt(-50, 160);
  const [rx1, ry1] = pt(-20, 160);
  parts.push(`<path d="M ${f(rx0)} ${f(ry0)} A 160 160 0 0 1 ${f(rx1)} ${f(ry1)}" fill="none" stroke="#9c2616" stroke-width="7"/>`);
  for (let db = 0; db <= 20; db++) {
    const deg = 50 - db * 5;
    const major = db % 2 === 0;
    const red = db >= 14;
    const [x1, y1] = pt(deg, 156);
    const [x2, y2] = pt(deg, major ? 142 : 148);
    parts.push(`<line x1="${f(x1)}" y1="${f(y1)}" x2="${f(x2)}" y2="${f(y2)}" stroke="${red ? '#9c2616' : '#2a2417'}" stroke-width="${major ? 2 : 1}"/>`);
    if (major) {
      const [tx, ty] = pt(deg, 128);
      parts.push(`<text x="${f(tx)}" y="${f(ty + 5)}" text-anchor="middle" font-family="'Barlow Condensed', sans-serif" font-weight="700" font-size="15" fill="${red ? '#9c2616' : '#2a2417'}">${db}</text>`);
    }
  }
  return parts.join('');
}

const SEGMENTS = 14;

interface SourceOption {
  value: string;
  label: string;
}

/**
 * The MOA-FX2 front panel: a fixed 1440x400 vintage rack compressor that scales to fit the page. The VU needle
 * shows gain reduction (compressor plus ducker), or the input or output level.
 */
export function renderBusCompPanel(d: BusCompFx, mixer: Mixer | undefined, deviceId: string, engine: AudioEngine,
  sources: SourceOption[]): HTMLElement {
  loadSavedPatches(STORAGE_KEY, d);
  d.loadSlot(d.currentSlot);

  const wrap = el('div', 'bc-wrap');
  const panel = el('div', 'bc-panel');
  wrap.append(panel);
  const tickers: (() => void)[] = [];

  // Brushed plate and rack ears (decoration).
  const ear = (left: number, flip: boolean) => {
    const e = el('div', 'bc-ear');
    place(e, left, 0);
    e.style.boxShadow = flip ? 'inset 2px 0 0 rgba(0,0,0,.5), inset 3px 0 0 rgba(255,255,255,.08)'
      : 'inset -2px 0 0 rgba(0,0,0,.5), inset -3px 0 0 rgba(255,255,255,.08)';
    e.innerHTML = '<i class="bc-slot" style="top:40px"></i><i class="bc-slot" style="top:348px"></i>'
      + '<i class="bc-screw" style="top:13px;transform:rotate(20deg)"></i><i class="bc-screw" style="top:369px;transform:rotate(75deg)"></i>';
    return e;
  };
  panel.append(ear(0, false), ear(1400, true));
  const plate = el('div', 'bc-abs');
  place(plate, 40, 0);
  plate.style.cssText += 'width:1360px;height:400px';
  panel.append(plate);

  // Name plate, pilot, bypass, jacks.
  const left = el('div', 'bc-abs');
  left.style.cssText = 'left:14px;top:20px;width:176px;height:282px;display:flex;flex-direction:column;gap:14px';
  const nameplate = el('div', 'bc-nameplate');
  nameplate.innerHTML = '<div class="bc-brand">MOA-FX2</div><div class="bc-silk" style="font-size:21px;font-weight:700;letter-spacing:.3em;color:#e2bd73">BUS COMP</div>'
    + '<div style="display:flex;align-items:center;gap:6px"><div style="flex:1;height:1px;background:#8a6a30"></div><div class="bc-silk" style="font-size:10px;letter-spacing:.32em;color:#c9a05a">SIDECHAIN</div><div style="flex:1;height:1px;background:#8a6a30"></div></div>';
  const pilot = el('div');
  pilot.style.cssText = 'display:flex;align-items:center;gap:12px;height:32px';
  pilot.innerHTML = '<div role="img" aria-label="Power on" class="bc-pilot"></div><div class="bc-silk" style="font-size:13px">Power</div>';
  const bypass = toggle(d, 'bc.bypass');
  const bypassButton = el('button', 'bc-wide');
  bypassButton.type = 'button';
  bypassButton.innerHTML = '<i class="bc-lamp"></i><span class="bc-silk" style="font-size:16px;font-weight:700;letter-spacing:.22em;color:#2a2417">Bypass</span>';
  const bypassLamp = bypassButton.querySelector('.bc-lamp') as HTMLElement;
  const paintBypass = () => {
    bypassButton.setAttribute('aria-pressed', String(bypass.value));
    bypassButton.classList.toggle('bc-lit', bypass.value);
    bypassLamp.style.background = bypass.value ? '#e0452b' : '#5b4a2a';
    bypassLamp.style.boxShadow = bypass.value ? '0 0 8px 2px rgba(255,80,40,.8)' : 'none';
  };
  bypassButton.addEventListener('click', () => bypass.set(!bypass.value));
  bypass.onChange(paintBypass);
  paintBypass();
  const jacks = el('div');
  jacks.style.cssText = 'display:flex;justify-content:space-around;align-items:flex-end;flex:1';
  const jack = (text: string) => `<div aria-hidden="true" style="display:flex;flex-direction:column;align-items:center;gap:4px"><div class="bc-jack"><div class="bc-jack-hole"><div class="bc-jack-pin"></div></div></div><div class="bc-silk" style="font-size:11px">${text}</div></div>`;
  jacks.innerHTML = jack('Input') + jack('Output');
  left.append(nameplate, pilot, bypassButton, jacks);
  plate.append(left);

  // Compressor knobs.
  const comp = el('div', 'bc-abs');
  comp.style.cssText = 'left:214px;top:20px;width:420px;height:282px;display:flex;flex-direction:column;gap:8px';
  comp.append(sectionRule('Compressor'));
  const grid = el('div');
  grid.style.cssText = 'display:grid;grid-template-columns:repeat(4,96px);justify-content:space-between;row-gap:6px';
  grid.append(
    renderKnob({ control: number(d, 'bc.threshold'), label: 'Threshold', text: dbText, scale: ['-60', '0'] }),
    renderKnob({ control: number(d, 'bc.ratio'), label: 'Ratio', text: ratio, scale: ['1.5', '2', '4', '8', '20'], steps: [1.5, 2, 4, 8, 20] }),
    renderKnob({ control: number(d, 'bc.attack'), label: 'Attack', text: ms, scale: ['0.3', '1', '3', '10', '30'], steps: [0.3, 1, 3, 10, 30] }),
    renderKnob({ control: number(d, 'bc.release'), label: 'Release', text: ms, scale: ['50', '100', '200', '400', '800'], steps: [50, 100, 200, 400, 800] }),
    renderKnob({ control: number(d, 'bc.knee'), label: 'Knee', text: dbText, scale: ['0', '30'] }),
    renderKnob({ control: number(d, 'bc.makeup'), label: 'Make-up', text: dbText, scale: ['0', '+24'] }),
    renderKnob({ control: number(d, 'bc.mix'), label: 'Mix', text: pct, scale: ['DRY', 'WET'] }),
  );
  // Meter mode rotary (GR / IN / OUT).
  const modes = ['GR', 'IN', 'OUT'] as const;
  let mode = 0;
  const modeBox = el('button', 'bc-knob');
  modeBox.type = 'button';
  const modeRing = svgEl('svg', { width: '96', height: '88', viewBox: '0 0 96 88', 'aria-hidden': 'true' });
  modeRing.style.cssText = 'position:absolute;left:0;top:0';
  modeRing.innerHTML = tickRing([...modes], 3);
  const modeCap = el('div', 'bc-knob-cap');
  modeCap.innerHTML = '<div class="bc-knob-knurl"></div><div class="bc-knob-brass"></div><div class="bc-knob-pointer"></div>';
  const modeFace = el('div', 'bc-knob-box');
  modeFace.append(modeRing, modeCap);
  const modeName = el('div', 'bc-silk', 'Meter');
  modeName.style.fontSize = '13px';
  const modeReadout = el('div', 'bc-readout');
  modeBox.append(modeFace, modeName, modeReadout);
  const caption = svgEl('text', {
    x: '144', y: '156', 'text-anchor': 'middle', 'font-family': "'Barlow Condensed', sans-serif", 'font-weight': '600',
    'font-size': '12', fill: '#2a2417', 'letter-spacing': '3.5',
  });
  const captions = ['GAIN REDUCTION', 'INPUT LEVEL', 'OUTPUT LEVEL'];
  const paintMode = () => {
    modeCap.style.transform = `rotate(${-135 + mode * 135}deg)`;
    modeReadout.textContent = modes[mode]!;
    modeBox.setAttribute('aria-label', `Meter mode ${modes[mode]}, press to change`);
    caption.textContent = captions[mode]!;
  };
  modeBox.addEventListener('click', () => {
    mode = (mode + 1) % 3;
    paintMode();
  });
  grid.append(modeBox);
  comp.append(grid);
  plate.append(comp);

  // VU meter.
  const vu = el('div', 'bc-abs');
  vu.style.cssText = 'left:650px;top:22px;width:304px;display:flex;flex-direction:column;gap:10px;align-items:center';
  const bezel = el('div', 'bc-vu-bezel');
  const face = svgEl('svg', { width: '288', height: '230', viewBox: '0 0 288 230', role: 'img', 'aria-label': 'Gain reduction VU meter' });
  face.style.display = 'block';
  face.innerHTML = `<defs><radialGradient id="bc-vuface" cx="50%" cy="85%" r="95%"><stop offset="0" stop-color="#fbeab4"/><stop offset="0.6" stop-color="#efd890"/><stop offset="1" stop-color="#d4aa5a"/></radialGradient></defs>
    <rect width="288" height="230" fill="url(#bc-vuface)"/>${vuFaceSvg()}
    <text x="144" y="132" text-anchor="middle" font-family="'Alfa Slab One', serif" font-size="22" fill="#2a2417" letter-spacing="2">dB</text>
    <text x="22" y="30" font-family="'Barlow Condensed', sans-serif" font-weight="600" font-size="11" fill="#2a2417" letter-spacing="2">MOA-FX2</text>`;
  face.append(caption);
  const needle = svgEl('g', {});
  needle.innerHTML = '<line x1="146" y1="216" x2="146" y2="56" stroke="rgba(60,30,0,0.28)" stroke-width="2.4"/>'
    + '<line x1="144" y1="214" x2="144" y2="54" stroke="#17140d" stroke-width="2"/><line x1="144" y1="90" x2="144" y2="54" stroke="#b02a18" stroke-width="2"/>';
  face.append(needle);
  const hub = svgEl('g', {});
  hub.innerHTML = '<circle cx="144" cy="214" r="24" fill="#17140d"/><circle cx="144" cy="214" r="24" fill="none" stroke="#6f5a2c" stroke-width="2"/><circle cx="144" cy="214" r="5" fill="#cfa65c"/>';
  face.append(hub);
  const faceHolder = el('div', 'bc-vu-face');
  faceHolder.append(face);
  bezel.append(faceHolder);
  const insert = el('div');
  insert.style.cssText = 'display:flex;align-items:center;gap:10px;width:304px';
  insert.innerHTML = '<div style="flex:1;height:1px;background:#c4c2a4;opacity:.5"></div><div class="bc-silk" style="font-size:11px;letter-spacing:.3em;color:#c4c2a4">Bus B insert</div><div style="flex:1;height:1px;background:#c4c2a4;opacity:.5"></div>';
  vu.append(bezel, insert);
  plate.append(vu);
  paintMode();

  // Output ladder.
  const ladder = el('div', 'bc-abs');
  ladder.style.cssText = 'left:966px;top:22px;width:52px;display:flex;flex-direction:column;gap:8px;align-items:center';
  ladder.append(el('div', 'bc-silk', 'Out'));
  (ladder.firstChild as HTMLElement).style.cssText = 'font-size:12px;color:#c4c2a4';
  const columns = el('div');
  columns.style.cssText = 'display:flex;gap:8px;justify-content:center';
  const ladderCols = (['L', 'R'] as const).map((side) => {
    const col = el('div');
    col.style.cssText = 'display:flex;flex-direction:column;align-items:center;gap:5px';
    const stack = el('div', 'bc-ladder');
    const segs = Array.from({ length: SEGMENTS }, () => el('div', 'bc-seg'));
    stack.append(...[...segs].reverse());
    const l = el('div', 'bc-silk', side);
    l.style.fontSize = '13px';
    col.append(stack, l);
    columns.append(col);
    return { segs, nodeId: d.meters.find((m) => m.name === `out.${side}`)!.nodeId };
  });
  ladder.append(columns);
  plate.append(ladder);

  // Sidechain.
  const side = el('div', 'bc-sidechain');
  place(side, 1032, 14);
  const sideTitle = el('div', 'bc-side-title');
  sideTitle.append(el('div', 'bc-silk', 'Sidechain'));
  (sideTitle.firstChild as HTMLElement).style.cssText = 'font-size:15px;font-weight:700;letter-spacing:.34em';
  const knobs = el('div');
  knobs.style.cssText = 'display:flex;justify-content:space-between';
  knobs.append(
    renderKnob({ control: number(d, 'bc.duck.depth'), label: 'Duck depth', text: pct, scale: ['0', '100'] }),
    renderKnob({ control: number(d, 'bc.duck.release'), label: 'Duck release', text: ms, scale: ['20', '800'] }),
    renderKnob({ control: number(d, 'bc.duck.keyHp'), label: 'Key HP', text: hz, scale: ['20', '300'] }),
  );
  const keyBlock = el('div');
  keyBlock.style.cssText = 'display:flex;flex-direction:column;gap:4px';
  const keyLabel = el('div', 'bc-silk', 'Key source');
  keyLabel.style.cssText = 'font-size:11px;color:#c4c2a4';
  const keyGrid = el('div');
  keyGrid.style.cssText = 'display:grid;grid-template-columns:repeat(5,minmax(0,1fr));gap:4px';
  const source = mixer?.control('key.source') as ChoiceControl | undefined;
  const sourceButtons = (source ? sources : []).map((s) => {
    const b = el('button', 'bc-keybtn', s.label);
    b.type = 'button';
    b.addEventListener('click', () => source?.set(s.value));
    keyGrid.append(b);
    return { b, value: s.value };
  });
  const listen = toggle(d, 'bc.listen');
  const listenButton = el('button', 'bc-keybtn', 'Listen');
  listenButton.type = 'button';
  listenButton.addEventListener('click', () => listen.set(!listen.value));
  keyGrid.append(listenButton);
  const paintKeys = () => {
    for (const { b, value } of sourceButtons) {
      b.setAttribute('aria-pressed', String(source?.value === value));
      b.classList.toggle('bc-lit', source?.value === value);
    }
    listenButton.setAttribute('aria-pressed', String(listen.value));
    listenButton.classList.toggle('bc-lit', listen.value);
  };
  source?.onChange(paintKeys);
  listen.onChange(paintKeys);
  paintKeys();
  if (!source) {
    keyLabel.textContent = 'Key source is chosen on the mixer';
    keyGrid.style.gridTemplateColumns = '1fr';
  }
  keyBlock.append(keyLabel, keyGrid);
  const activity = el('div');
  activity.style.cssText = 'display:flex;align-items:center;gap:8px;margin-top:2px';
  const keyLamp = el('div', 'bc-keylamp');
  keyLamp.setAttribute('role', 'img');
  const keyTag = el('div');
  keyTag.style.cssText = 'display:flex;align-items:center;gap:5px';
  keyTag.append(keyLamp, el('div', 'bc-silk', 'Key'));
  (keyTag.lastChild as HTMLElement).style.fontSize = '11px';
  const duckBar = el('div', 'bc-duckbar');
  const duckSegs = Array.from({ length: 12 }, () => {
    const s = el('div', 'bc-duckseg');
    duckBar.append(s);
    return s;
  });
  const duckText = el('div', 'bc-silk', 'Duck');
  duckText.style.fontSize = '11px';
  activity.append(keyTag, duckBar, duckText);
  side.append(sideTitle, knobs, keyBlock, activity);
  plate.append(side);

  // Preset strip.
  const strip = el('div', 'bc-strip');
  const stripTitle = el('div', 'bc-silk', 'Preset');
  stripTitle.style.cssText = 'font-size:14px;font-weight:700;letter-spacing:.26em;width:74px';
  strip.append(stripTitle);
  const presetButtons = d.slots.map((_, i) => {
    const b = el('button', 'bc-preset');
    b.type = 'button';
    b.innerHTML = '<i class="bc-preset-led"></i><span></span>';
    b.addEventListener('click', () => d.loadSlot(i));
    strip.append(b);
    return b;
  });
  const divider = el('div');
  divider.style.cssText = 'width:2px;align-self:stretch;margin:12px 4px;background:rgba(0,0,0,.35)';
  const save = el('button', 'bc-save', 'Save');
  save.type = 'button';
  save.setAttribute('aria-label', 'Save patch');
  let savedFlash = false;
  const paintPresets = () => {
    presetButtons.forEach((b, i) => {
      const on = i === d.currentSlot;
      b.setAttribute('aria-pressed', String(on));
      b.classList.toggle('bc-lit', on);
      b.querySelector('span')!.textContent = d.slots[i]!.name;
    });
    save.textContent = savedFlash ? 'Saved' : 'Save';
  };
  save.addEventListener('click', () => {
    persistPatch(STORAGE_KEY, d.currentSlot, d.saveSlot(d.currentSlot));
    savedFlash = true;
    paintPresets();
    window.setTimeout(() => {
      savedFlash = false;
      paintPresets();
    }, 1500);
  });
  d.onPresetChange(paintPresets);
  paintPresets();
  strip.append(divider, save);
  plate.append(strip);

  // Live meters: needle with ballistics, output ladder, key activity.
  const inNode = d.meters.find((m) => m.name === 'in')!.nodeId;
  const duckNode = d.meters.find((m) => m.name === 'duck')!.nodeId;
  const depth = number(d, 'bc.duck.depth');
  let needleDb = 0;
  let last = performance.now();
  const dbOf = (v: number) => (v > 0 ? 20 * Math.log10(v) : -60);
  tickers.push(() => {
    const now = performance.now();
    const dt = Math.min(0.1, (now - last) / 1000);
    last = now;
    const duckLevel = engine.readLevel(deviceId, duckNode);
    let target: number; // dB below 0, positive
    if (mode === 0) {
      const duckDb = -dbOf(Math.max(0.001, 1 - depth.value * duckLevel));
      target = bypass.value ? 0 : Math.max(0, -engine.readReduction(deviceId, 'comp')) + duckDb;
    } else if (mode === 1) {
      target = -dbOf(engine.readLevel(deviceId, inNode));
    } else {
      target = -Math.max(...ladderCols.map((c) => dbOf(engine.readLevel(deviceId, c.nodeId))));
    }
    target = Math.min(20, Math.max(0, mode === 0 ? target : Math.min(20, target)));
    // GR rises quickly and falls slowly, like a VU needle; levels are smoothed the same way.
    const rate = target > needleDb ? 12 : 5;
    needleDb += (target - needleDb) * Math.min(1, rate * dt);
    needle.setAttribute('transform', `rotate(${(50 - 5 * needleDb).toFixed(2)} 144 214)`);
    face.setAttribute('aria-label', `${captions[mode]!.toLowerCase()} meter, minus ${needleDb.toFixed(1)} dB`);

    for (const { segs, nodeId } of ladderCols) {
      const dbv = dbOf(engine.readLevel(deviceId, nodeId));
      segs.forEach((s, i) => {
        const on = dbv > -42 + 3 * i;
        const color = i >= 13 ? '#e0452b' : i >= 11 ? '#ffb347' : '#8fd46a';
        s.style.background = on ? color : '';
        s.style.boxShadow = on ? `0 0 6px ${color}` : '';
      });
    }
    const lit = Math.round(Math.min(1, duckLevel * depth.value) * 12);
    duckSegs.forEach((s, i) => {
      const color = i >= 10 ? '#e0452b' : i >= 7 ? '#ffb347' : '#8fd46a';
      s.style.background = i < lit ? color : '';
      s.style.boxShadow = i < lit ? `0 0 5px ${color}` : '';
    });
    const keyed = duckLevel > 0.02;
    keyLamp.style.background = keyed ? '#ffb347' : '#4a3a22';
    keyLamp.style.boxShadow = keyed ? '0 0 8px 2px rgba(255,170,60,.8)' : 'none';
    keyLamp.setAttribute('aria-label', `Key signal ${keyed ? 'active' : 'off'}`);
  });

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

function sectionRule(text: string): HTMLElement {
  const row = el('div');
  row.style.cssText = 'display:flex;align-items:center;gap:10px;height:18px';
  row.innerHTML = `<div style="flex:1;height:2px;background:${DIM};opacity:.6"></div><div class="bc-silk" style="font-size:14px;letter-spacing:.32em">${text}</div><div style="flex:1;height:2px;background:${DIM};opacity:.6"></div>`;
  return row;
}
