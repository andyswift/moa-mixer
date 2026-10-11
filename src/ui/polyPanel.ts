import type { ChoiceControl, NumberControl, ToggleControl } from '../domain/devices/controls';
import { LFO_DIVISIONS, POLY_VOICES, type PolySynth } from '../domain/devices/polySynth';
import { STEPS, fromSlider, toSlider } from './controls';
import { type DialModel, controlDial, renderDial } from './dial';
import { mountKeyboardBed } from './keyboard';
import { loadSavedPatches, persistPatch } from './polyStorage';
import { renderTransportBlock } from './transportBlock';
import { el } from './widgets';

const ACCENT = '#3a8fd6';
const ORANGE = '#e8742c';
const BLUE = '#4a9be0';
const YELLOW = '#dcb43c';
const GREEN = '#4fb286';
const PINK = '#d9628a';
const PURPLE = '#a98ae0';

const GLYPH = {
  saw: 'M1 9 L8 2 L8 9 L15 2 L15 9',
  pulse: 'M1 9 L1 2 L7 2 L7 9 L14 9 L14 2 L19 2',
  tri: 'M1 8 L5 2 L10 8 L15 2 L19 6',
  down: 'M1 2 L8 9 L8 2 L15 9 L15 2',
  sqr: 'M1 9 L1 2 L8 2 L8 9 L15 9 L15 2 L19 2',
  rnd: 'M1 6 L1 3 L5 3 L5 8 L9 8 L9 2 L13 2 L13 6 L18 6',
  poly: 'M1 8 L19 8 M1 5 L19 5 M1 2 L19 2',
  mono: 'M1 5 L19 5',
  unison: 'M1 4 L19 4 M1 6 L19 6',
} as const;

interface Option {
  value: string;
  text: string;
  glyph: string;
  aria: string;
}

const WAVES: Option[] = [
  { value: 'saw', text: 'Saw', glyph: GLYPH.saw, aria: 'saw' },
  { value: 'pulse', text: 'Pulse', glyph: GLYPH.pulse, aria: 'pulse' },
  { value: 'tri', text: 'Tri', glyph: GLYPH.tri, aria: 'triangle' },
];
const LFO_WAVES: Option[] = [
  { value: 'tri', text: 'Tri', glyph: GLYPH.tri, aria: 'triangle' },
  { value: 'up', text: 'Up', glyph: GLYPH.saw, aria: 'ramp up' },
  { value: 'down', text: 'Down', glyph: GLYPH.down, aria: 'ramp down' },
  { value: 'sqr', text: 'Square', glyph: GLYPH.sqr, aria: 'square' },
  { value: 'rnd', text: 'Rand', glyph: GLYPH.rnd, aria: 'random' },
];
const MODES: Option[] = [
  { value: 'poly', text: 'Poly', glyph: GLYPH.poly, aria: 'poly' },
  { value: 'mono', text: 'Mono', glyph: GLYPH.mono, aria: 'mono' },
  { value: 'unison', text: 'Unison', glyph: GLYPH.unison, aria: 'unison' },
];

function number(d: PolySynth, id: string): NumberControl {
  const c = d.control(id);
  if (c.kind !== 'number') throw new Error(`${id} is not a number control`);
  return c;
}

function choice(d: PolySynth, id: string): ChoiceControl {
  const c = d.control(id);
  if (c.kind !== 'choice') throw new Error(`${id} is not a choice control`);
  return c;
}

function toggle(d: PolySynth, id: string): ToggleControl {
  const c = d.control(id);
  if (c.kind !== 'toggle') throw new Error(`${id} is not a toggle control`);
  return c;
}

const glyph = (d: string, w = 20, h = 10) =>
  `<svg aria-hidden="true" width="${w}" height="${h}" viewBox="0 0 20 10"><path d="${d}" fill="none" stroke="currentColor" stroke-width="1.4" stroke-linejoin="round" stroke-linecap="round"></path></svg>`;

/** A button that steps through the options, with an LED row beside it showing (and picking) the current one. */
function renderSelector(c: ChoiceControl, title: string, stepLabel: string, options: Option[]): HTMLElement {
  const wrap = el('div', 'poly-selector');
  const stepper = el('div', 'poly-step-wrap');
  const step = el('button', 'poly-key');
  step.type = 'button';
  step.setAttribute('aria-label', stepLabel);
  step.innerHTML = '<svg aria-hidden="true" width="16" height="16" viewBox="0 0 16 16"><path d="M3 6 L8 11 L13 6" fill="none" stroke="#1b1c1e" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"></path></svg>';
  step.addEventListener('click', () => c.set(options[(options.findIndex((o) => o.value === c.value) + 1) % options.length]!.value));
  stepper.append(step, el('div', 'poly-mini-label', title));

  const list = el('div', 'poly-options');
  const buttons = options.map((o) => {
    const b = el('button', 'poly-option');
    b.type = 'button';
    b.setAttribute('aria-label', `${title}: ${o.aria}`);
    b.innerHTML = `<span class="poly-led" aria-hidden="true"></span>${glyph(o.glyph)}<span>${o.text}</span>`;
    b.addEventListener('click', () => c.set(o.value));
    list.append(b);
    return b;
  });
  const paint = () => {
    buttons.forEach((b, i) => b.setAttribute('aria-pressed', String(options[i]!.value === c.value)));
  };
  c.onChange(paint);
  paint();
  wrap.append(stepper, list);
  return wrap;
}

function renderSyncButton(c: ToggleControl): HTMLElement {
  const b = el('button', 'poly-sync');
  b.type = 'button';
  b.setAttribute('aria-label', 'LFO tempo sync');
  b.innerHTML = '<span class="poly-led" aria-hidden="true"></span><span>Sync</span>';
  b.addEventListener('click', () => c.set(!c.value));
  const paint = () => b.setAttribute('aria-pressed', String(c.value));
  c.onChange(paint);
  paint();
  return b;
}

/** The LFO rate dial doubles as a note-division dial while Sync is on. */
function rateModel(d: PolySynth): DialModel {
  const rate = number(d, 'lfo.rate');
  const division = choice(d, 'lfo.division');
  const sync = toggle(d, 'lfo.sync');
  const last = LFO_DIVISIONS.length - 1;
  return {
    label: 'Rate',
    color: GREEN,
    get: () => (sync.value ? LFO_DIVISIONS.indexOf(division.value as (typeof LFO_DIVISIONS)[number]) / last : toSlider(rate) / STEPS),
    set: (t) => (sync.value ? division.set(LFO_DIVISIONS[Math.round(t * last)]!) : rate.set(fromSlider(rate, Math.round(t * STEPS)))),
    reset: () => (sync.value ? division.set('1/8') : rate.set(rate.initial)),
    text: () => (sync.value ? division.value : `${rate.value.toFixed(1)} Hz`),
    subscribe: (fn) => {
      const offs = [rate.onChange(fn), division.onChange(fn), sync.onChange(fn)];
      return () => offs.forEach((off) => off());
    },
    get step() {
      return sync.value ? 1 / last : 0.02;
    },
  };
}

interface SectionSpec {
  title: string;
  color: string;
  grow: number;
  body: (d: PolySynth) => HTMLElement[];
}

const dials = (d: PolySynth, color: string, title: string, ids: (string | [string, string])[]) =>
  ids.map((entry) => {
    const [id, label] = typeof entry === 'string' ? [entry, undefined] : entry;
    return renderDial(controlDial(number(d, id), color, label), title);
  });

/** EG1 display: the envelope curve drawn from the four knobs, with their 0-99 values. */
function renderEnvelopeDisplay(d: PolySynth): HTMLElement {
  const box = el('div', 'poly-display');
  box.append(el('div', 'poly-display-title', 'EG1'));
  const NS = 'http://www.w3.org/2000/svg';
  const svg = document.createElementNS(NS, 'svg');
  svg.setAttribute('role', 'img');
  svg.setAttribute('aria-label', 'Filter envelope curve');
  svg.setAttribute('width', '188');
  svg.setAttribute('height', '64');
  svg.setAttribute('viewBox', '0 0 188 64');
  const base = document.createElementNS(NS, 'line');
  for (const [k, v] of Object.entries({ x1: '0', y1: '56', x2: '188', y2: '56', stroke: '#2c3036', 'stroke-width': '1' })) base.setAttribute(k, v);
  const line = document.createElementNS(NS, 'polyline');
  for (const [k, v] of Object.entries({ fill: 'none', stroke: '#8cc6f2', 'stroke-width': '1.6', 'stroke-linejoin': 'round', 'stroke-linecap': 'round' })) line.setAttribute(k, v);
  svg.append(base, line);
  const text = el('div', 'poly-display-text');
  box.append(svg, text);

  const controls = ['attack', 'decay', 'sustain', 'release'].map((p) => number(d, `env1.${p}`));
  const paint = () => {
    const [a, dc, s, r] = controls.map((c) => toSlider(c) / STEPS) as [number, number, number, number];
    const x1 = 6 + a * 46;
    const x2 = x1 + dc * 52;
    const x3 = x2 + 30;
    const x4 = x3 + r * 46;
    const ys = 56 - s * 46;
    const f = (n: number) => Math.round(n * 10) / 10;
    line.setAttribute('points', `6,56 ${f(x1)},10 ${f(x2)},${f(ys)} ${f(x3)},${f(ys)} ${f(x4)},56`);
    const n99 = (t: number) => String(Math.round(t * 99));
    text.textContent = `A ${n99(a)}  D ${n99(dc)}  S ${n99(s)}  R ${n99(r)}`;
  };
  for (const c of controls) c.onChange(paint);
  paint();
  return box;
}

function renderVoiceLeds(d: PolySynth, tickers: (() => void)[]): HTMLElement {
  const wrap = el('div', 'poly-voices');
  const row = el('div', 'poly-voice-leds');
  row.setAttribute('role', 'img');
  row.setAttribute('aria-label', 'Voice activity');
  const leds = Array.from({ length: POLY_VOICES }, () => {
    const led = el('span', 'poly-led poly-led-big');
    row.append(led);
    return led;
  });
  wrap.append(row, el('div', 'poly-mini-label', 'Voices'));
  tickers.push(() => {
    let active = 0;
    leds.forEach((led, i) => {
      const on = d.voiceActive(i);
      led.classList.toggle('on', on);
      if (on) active++;
    });
    row.setAttribute('aria-label', `Voice activity: ${active} of ${POLY_VOICES} voices sounding`);
  });
  return wrap;
}

function sections(tickers: (() => void)[]): SectionSpec[][] {
  return [
    [
      {
        title: 'Oscillator', color: ORANGE, grow: 5.2,
        body: (d) => [
          renderSelector(choice(d, 'osc.wave'), 'Wave', 'Step oscillator waveform', WAVES),
          ...dials(d, ORANGE, 'Oscillator', ['osc.width', 'osc.pwm', 'osc.vibrato', 'osc.sub']),
        ],
      },
      {
        title: 'Filter', color: BLUE, grow: 5,
        body: (d) => dials(d, BLUE, 'Filter', ['filter.cutoff', 'filter.resonance', 'filter.env', 'filter.lfo', 'filter.key']),
      },
      {
        title: 'Amplifier', color: PINK, grow: 3,
        body: (d) => dials(d, PINK, 'Amplifier', ['amp.lfo', 'amp.key', 'level']),
      },
    ],
    [
      {
        title: 'LFO', color: GREEN, grow: 3.6,
        body: (d) => [
          renderSelector(choice(d, 'lfo.wave'), 'Wave', 'Step LFO waveform', LFO_WAVES),
          renderDial(rateModel(d), 'LFO'),
          renderSyncButton(toggle(d, 'lfo.sync')),
        ],
      },
      {
        title: 'Envelope generator 1', color: BLUE, grow: 5.4,
        body: (d) => [
          renderEnvelopeDisplay(d),
          ...dials(d, BLUE, 'Envelope 1', ['env1.attack', 'env1.decay', 'env1.sustain', 'env1.release']),
        ],
      },
      {
        title: 'Envelope generator 2', color: PINK, grow: 4,
        body: (d) => dials(d, PINK, 'Envelope 2', ['env2.attack', 'env2.decay', 'env2.sustain', 'env2.release']),
      },
    ],
    [
      {
        title: 'Voices mode', color: YELLOW, grow: 5,
        body: (d) => [
          renderSelector(choice(d, 'voices.mode'), 'Mode', 'Step voice mode', MODES),
          ...dials(d, YELLOW, 'Voices', ['voices.portamento', 'voices.detune']),
          renderVoiceLeds(d, tickers),
        ],
      },
      {
        title: 'Effects', color: PURPLE, grow: 4.4,
        body: (d) => dials(d, PURPLE, 'Effects', ['fx.chorus', 'fx.delayTime', 'fx.feedback', 'fx.mix']),
      },
    ],
  ];
}

const BANK_NAMES = ['A', 'B'];
const PER_BANK = 8;

/** Patch name display, bank buttons, eight preset keys, Save, and the MIDI LED. */
function renderPatchStrip(d: PolySynth, tickers: (() => void)[]): HTMLElement {
  const strip = el('section', 'poly-patch');
  const head = el('div', 'poly-section-head');
  const bar = el('span', 'poly-bar');
  bar.style.background = ACCENT;
  head.append(bar, el('h2', undefined, 'Patch'));

  const display = el('div', 'poly-patch-display');
  display.setAttribute('role', 'status');
  display.setAttribute('aria-label', 'Current patch');
  const name = el('span', 'poly-patch-name');
  const tag = el('span', 'poly-patch-tag');
  display.append(name, tag);

  let bank = Math.floor(d.currentSlot / PER_BANK);
  let savedFlash = false;
  const keys = el('div', 'poly-preset-keys');
  const presetButtons: { led: HTMLElement; button: HTMLButtonElement }[] = [];
  for (let n = 0; n < PER_BANK; n++) {
    const cell = el('div', 'poly-preset');
    const led = el('span', 'poly-led');
    const button = el('button', 'poly-key poly-key-number', String(n + 1));
    button.type = 'button';
    button.addEventListener('click', () => d.loadSlot(bank * PER_BANK + n));
    cell.append(led, button);
    keys.append(cell);
    presetButtons.push({ led, button });
  }

  const paint = () => {
    const slot = d.currentSlot;
    name.textContent = `${String(slot % PER_BANK + 1).padStart(2, '0')} ${d.currentPreset.name}`;
    tag.textContent = savedFlash ? 'Saved' : `Bank ${BANK_NAMES[Math.floor(slot / PER_BANK)]}`;
    presetButtons.forEach(({ led, button }, n) => {
      const on = bank * PER_BANK + n === slot;
      const preset = d.slots[bank * PER_BANK + n]!;
      led.classList.toggle('on', on);
      button.setAttribute('aria-pressed', String(on));
      button.setAttribute('aria-label', `Preset ${n + 1}, ${preset.name}`);
      button.title = preset.name;
    });
  };
  const flip = (label: string, text: string) => {
    const b = el('button', 'poly-key poly-key-bank', text);
    b.type = 'button';
    b.setAttribute('aria-label', label);
    b.addEventListener('click', () => {
      bank = (bank + 1) % BANK_NAMES.length; // two banks: previous and next are the same flip
      paint();
    });
    return b;
  };
  const banks = el('div', 'poly-bank-keys');
  banks.append(flip('Previous bank', '<'), flip('Next bank', '>'));

  const save = el('button', 'poly-key poly-save', 'Save');
  save.type = 'button';
  save.setAttribute('aria-label', 'Save patch');
  save.addEventListener('click', () => {
    persistPatch(d.currentSlot, d.saveSlot(d.currentSlot));
    savedFlash = true;
    paint();
    window.setTimeout(() => {
      savedFlash = false;
      paint();
    }, 1500);
  });

  const midi = el('div', 'poly-midi');
  const midiLed = el('span', 'poly-led');
  midiLed.style.setProperty('--glow', '1');
  midi.append(el('span', undefined, 'MIDI'), midiLed);
  let lastNote = 0;
  d.onNoteChange(() => {
    lastNote = performance.now();
  });
  tickers.push(() => midiLed.classList.toggle('on', performance.now() - lastNote < 150));

  d.onPresetChange(() => {
    bank = Math.floor(d.currentSlot / PER_BANK);
    paint();
  });
  paint();
  strip.append(head, display, banks, keys, save, el('div', 'poly-spacer'), midi);
  return strip;
}

/** The MOA-6 front panel: knob sections, patch strip, and the shared keyboard bed. */
export function renderPolyPanel(d: PolySynth): HTMLElement {
  loadSavedPatches(d);
  d.loadSlot(d.currentSlot);

  const panel = el('div', 'poly-panel');
  const header = el('div', 'poly-header');
  const brand = el('div', 'synth-brand');
  brand.append(el('div', 'synth-name', 'MOA-6'), el('div', 'synth-subtitle', 'Poly Synthesizer'));
  header.append(brand, renderTransportBlock(d.transport, { running: () => false, followStartStop: false }));
  panel.append(header);

  const tickers: (() => void)[] = [];
  for (const row of sections(tickers)) {
    const r = el('div', 'poly-row');
    for (const spec of row) {
      const section = el('section', 'poly-section');
      section.style.flex = `${spec.grow} 1 0`;
      const head = el('div', 'poly-section-head');
      const bar = el('span', 'poly-bar');
      bar.style.background = spec.color;
      head.append(bar, el('h2', undefined, spec.title));
      const body = el('div', 'poly-section-body');
      body.append(...spec.body(d));
      section.append(head, body);
      r.append(section);
    }
    panel.append(r);
  }
  panel.append(renderPatchStrip(d, tickers), mountKeyboardBed(d));

  const tick = () => {
    for (const t of tickers) t();
    requestAnimationFrame(tick);
  };
  requestAnimationFrame(tick);
  return panel;
}
