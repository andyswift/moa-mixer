import type { AudioEngine } from '../audio/engine';
import type { ChoiceControl, NumberControl, ToggleControl } from '../domain/devices/controls';

import { PIPE_LFO_DIVISIONS, PIPE_VOICES, type PipeSynth } from '../domain/devices/pipeSynth';
import type { SpringReverb } from '../domain/devices/springReverb';
import { STEPS, format, fromSlider, toSlider } from './controls';
import { type DialModel, controlDial, renderDial } from './dial';
import { mountKeyboardBed } from './keyboard';
import { loadSavedPatches, persistPatch } from './pipeStorage';
import { renderTransportBlock } from './transportBlock';
import { el } from './widgets';

const TEAL = '#5fb3b3';
const BRASS = '#d8a63c';
const BLUE = '#4a9be0';
const GREEN = '#4fb286';
const ORANGE = '#e8742c';
const PINK = '#d9628a';
const COPPER = '#cf7d4e';
const GREY = '#a9adb3';
const PER_BANK = 8;
const BANK_NAMES = ['A', 'B'];

const number = (d: { control(id: string): { kind: string } }, id: string): NumberControl => {
  const c = d.control(id);
  if (c.kind !== 'number') throw new Error(`${id} is not a number control`);
  return c as NumberControl;
};
const choice = (d: { control(id: string): { kind: string } }, id: string): ChoiceControl => {
  const c = d.control(id);
  if (c.kind !== 'choice') throw new Error(`${id} is not a choice control`);
  return c as ChoiceControl;
};
const toggle = (d: { control(id: string): { kind: string } }, id: string): ToggleControl => {
  const c = d.control(id);
  if (c.kind !== 'toggle') throw new Error(`${id} is not a toggle control`);
  return c as ToggleControl;
};

type Dev = { control(id: string): { kind: string } };

/** One row of dials from control ids, each optionally with its own label. */
const dials = (d: Dev, color: string, title: string, ids: (string | [string, string])[]) =>
  ids.map((entry) => {
    const [id, label] = typeof entry === 'string' ? [entry, undefined] : entry;
    return renderDial(controlDial(number(d, id), color, label), title);
  });

/** A small button with an LED (red, like the originals), for an on/off control. */
function ledButton(c: ToggleControl, label: string): HTMLElement {
  const wrap = el('div', 'pipe-led-wrap');
  wrap.append(el('div', 'dial-label', label));
  const b = el('button', 'pipe-led-btn');
  b.type = 'button';
  b.setAttribute('aria-label', label);
  b.append(el('span', 'pipe-led'));
  b.addEventListener('click', () => c.set(!c.value));
  const paint = () => b.setAttribute('aria-pressed', String(c.value));
  c.onChange(paint);
  paint();
  wrap.append(b);
  return wrap;
}

/** A row of pills for a choice control, each with an LED that lights when it is the current choice. */
function pills(c: ChoiceControl, title: string, color: string, labels: Record<string, string> = {}): HTMLElement {
  const wrap = el('div', 'pipe-pills');
  wrap.setAttribute('role', 'group');
  wrap.setAttribute('aria-label', title);
  wrap.style.setProperty('--accent', color);
  const buttons = c.options.map((value) => {
    const b = el('button', 'pipe-pill');
    b.type = 'button';
    b.setAttribute('aria-label', `${title}: ${labels[value] ?? value}`);
    b.append(el('span', 'poly-led'), el('span', undefined, labels[value] ?? value));
    b.addEventListener('click', () => c.set(value));
    wrap.append(b);
    return b;
  });
  const paint = () => buttons.forEach((b, i) => b.setAttribute('aria-pressed', String(c.options[i] === c.value)));
  c.onChange(paint);
  paint();
  return wrap;
}

function section(title: string, color: string, body: HTMLElement[], className = ''): HTMLElement {
  const s = el('section', `pipe-section ${className}`.trim());
  const head = el('div', 'pipe-section-head');
  const bar = el('span', 'pipe-bar');
  bar.style.background = color;
  head.append(bar, el('h2', undefined, title));
  const row = el('div', 'pipe-section-body');
  row.append(...body);
  s.append(head, row);
  return s;
}

/** The LFO rate dial doubles as a note-division dial while Sync is on. */
function rateModel(d: PipeSynth): DialModel {
  const rate = number(d, 'lfo.rate');
  const division = choice(d, 'lfo.division');
  const sync = toggle(d, 'lfo.sync');
  const last = PIPE_LFO_DIVISIONS.length - 1;
  return {
    label: 'Speed',
    color: ORANGE,
    get: () => (sync.value ? PIPE_LFO_DIVISIONS.indexOf(division.value as (typeof PIPE_LFO_DIVISIONS)[number]) / last : toSlider(rate) / STEPS),
    set: (t) => (sync.value ? division.set(PIPE_LFO_DIVISIONS[Math.round(t * last)]!) : rate.set(fromSlider(rate, Math.round(t * STEPS)))),
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

/** A knurled encoder: drag, scroll or use the arrow keys to step. */
function encoder(label: string, onStep: (delta: number) => void): HTMLElement {
  const wrap = el('div', 'pipe-encoder');
  const knob = el('div', 'pipe-encoder-knob');
  knob.tabIndex = 0;
  knob.setAttribute('role', 'spinbutton');
  knob.setAttribute('aria-label', label);
  let angle = 0;
  let acc = 0;
  let lastY = 0;
  let dragging = false;
  const turn = (steps: number) => {
    angle += steps * 24;
    knob.style.transform = `rotate(${angle}deg)`;
    onStep(steps);
  };
  knob.addEventListener('pointerdown', (e) => {
    e.preventDefault();
    knob.focus();
    knob.setPointerCapture(e.pointerId);
    dragging = true;
    lastY = e.clientY;
    acc = 0;
  });
  knob.addEventListener('pointermove', (e) => {
    if (!dragging) return;
    acc += lastY - e.clientY;
    lastY = e.clientY;
    while (Math.abs(acc) >= 14) {
      const dir = acc > 0 ? 1 : -1;
      acc -= dir * 14;
      turn(dir);
    }
  });
  const end = () => {
    dragging = false;
  };
  knob.addEventListener('pointerup', end);
  knob.addEventListener('pointercancel', end);
  knob.addEventListener('wheel', (e) => {
    e.preventDefault();
    turn(e.deltaY < 0 ? 1 : -1);
  }, { passive: false });
  knob.addEventListener('keydown', (e) => {
    if (e.key === 'ArrowUp' || e.key === 'ArrowRight') { e.preventDefault(); turn(1); }
    if (e.key === 'ArrowDown' || e.key === 'ArrowLeft') { e.preventDefault(); turn(-1); }
  });
  wrap.append(knob, el('div', 'dial-label', label));
  return wrap;
}

/** The brand, the OLED-style display, the two encoders and the patch keys. */
function renderBrand(d: PipeSynth, engine: AudioEngine | undefined, tickers: (() => void)[], touched: { label: string; value: string }): HTMLElement {
  const card = el('section', 'pipe-brand');
  const name = el('div', 'pipe-name');
  name.innerHTML = 'MOA<span>-</span>PIPE';
  const sub = el('div', 'pipe-subtitle', 'Physical modelling');
  const title = el('div', 'pipe-title');
  title.append(name, sub);

  // --- the display ---
  const oled = el('div', 'pipe-oled');
  oled.setAttribute('role', 'status');
  oled.setAttribute('aria-label', 'Display');
  const top = el('div', 'pipe-oled-row');
  const slotText = el('span');
  const modeText = el('span');
  top.append(slotText, modeText);
  const patchName = el('div', 'pipe-oled-name');
  const bottom = el('div', 'pipe-oled-row pipe-oled-dim');
  const paramText = el('span');
  const leds = el('span', 'pipe-voice-leds');
  leds.setAttribute('aria-hidden', 'true');
  const ledEls = Array.from({ length: PIPE_VOICES }, () => leds.appendChild(el('i')));
  bottom.append(paramText, leds);
  oled.append(top, patchName, bottom);

  let savedFlash = false;
  let bank = Math.floor(d.currentSlot / PER_BANK);
  const modeControl = choice(d, 'voice.mode');
  const paint = () => {
    const slot = d.currentSlot;
    slotText.textContent = `PRESET ${String(slot + 1).padStart(2, '0')}${savedFlash ? '  SAVED' : ''}`;
    modeText.textContent = `${modeControl.value.toUpperCase()}  ${PIPE_VOICES} VOICES`;
    patchName.textContent = d.currentPreset.name;
    paramText.textContent = touched.label ? `${touched.label.toUpperCase()}  ${touched.value}` : `BANK ${BANK_NAMES[Math.floor(slot / PER_BANK)]}`;
  };

  // --- encoders ---
  const stepPreset = (delta: number) => {
    const next = (d.currentSlot + delta + d.slots.length) % d.slots.length;
    d.loadSlot(next);
  };
  const volume = number(d, 'patch.volume');
  const encoders = el('div', 'pipe-encoders');
  encoders.append(
    encoder('Preset', stepPreset),
    encoder('Volume', (delta) => volume.set(volume.value + delta * (volume.max - volume.min) * 0.03)),
  );

  const row = el('div', 'pipe-brand-row');
  row.append(oled, encoders);

  // --- patch keys ---
  const keys = el('div', 'pipe-keys');
  const bankKeys = el('div', 'pipe-bank-keys');
  const flip = (label: string, text: string) => {
    const b = el('button', 'pipe-key', text);
    b.type = 'button';
    b.setAttribute('aria-label', label);
    b.addEventListener('click', () => {
      bank = (bank + 1) % BANK_NAMES.length;
      paintKeys();
    });
    return b;
  };
  bankKeys.append(flip('Previous bank', '<'), flip('Next bank', '>'));
  const numbered = Array.from({ length: PER_BANK }, (_, n) => {
    const b = el('button', 'pipe-key pipe-key-number', String(n + 1));
    b.type = 'button';
    b.addEventListener('click', () => d.loadSlot(bank * PER_BANK + n));
    return b;
  });
  const save = el('button', 'pipe-key pipe-key-save', 'Save');
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
  const paintKeys = () => {
    numbered.forEach((b, n) => {
      const index = bank * PER_BANK + n;
      const preset = d.slots[index]!;
      b.setAttribute('aria-pressed', String(index === d.currentSlot));
      b.setAttribute('aria-label', `Preset ${index + 1}, ${preset.name}`);
      b.title = preset.name;
    });
  };
  keys.append(bankKeys, ...numbered, save);

  d.onPresetChange(() => {
    bank = Math.floor(d.currentSlot / PER_BANK);
    paintKeys();
    paint();
  });
  modeControl.onChange(paint);
  paint();
  paintKeys();

  // Voice LEDs follow the worklet's report of which voices are sounding.
  tickers.push(() => {
    const view = engine?.readPipe('pipe', 'pipe');
    ledEls.forEach((led, i) => led.classList.toggle('on', view?.active[i] === true));
    paint();
  });

  card.append(title, row, keys);
  return card;
}

/** The pipe synth's front panel, with the spring reverb beside the built-in reverb. */
export function renderPipePanel(d: PipeSynth, spring: SpringReverb, engine?: AudioEngine): HTMLElement {
  loadSavedPatches(d);
  d.loadSlot(d.currentSlot);

  const tickers: (() => void)[] = [];
  const touched = { label: '', value: '' };

  const root = el('div', 'pipe-case');
  root.append(el('div', 'pipe-cheek pipe-cheek-left'));
  const panel = el('div', 'pipe-panel');
  const columns = el('div', 'pipe-columns');

  // --- left column ---
  const left = el('div', 'pipe-col pipe-col-left');
  left.append(
    section('Envelope', TEAL, [
      ...dials(d, TEAL, 'Envelope', ['env.attack', 'env.decay', 'env.sustain', 'env.release', 'env.keytrack', 'env.velocity']),
      ledButton(toggle(d, 'env.legato'), 'Legato'),
    ]),
    section('Generator', TEAL, [
      ...dials(d, TEAL, 'Generator', [['gen.noise', 'DC / Noise'], 'gen.cutoff', ['gen.reso', 'Reso'], ['gen.keytrack', 'Keytrack'], ['gen.envAmt', 'Env amt'], 'gen.gain']),
      ledButton(toggle(d, 'gen.onePole'), '1-pole'),
    ]),
  );
  const row3 = el('div', 'pipe-row');
  row3.append(
    section('Feedback', BRASS, dials(d, BRASS, 'Feedback', ['fb.push', 'fb.decay', 'fb.release']), 'pipe-grow-3'),
    section('Saturation', BRASS, dials(d, BRASS, 'Saturation', [['sat.hardness', 'Soft/Hard'], ['sat.symmetry', 'Symmetry']]), 'pipe-grow-2'),
    section('Patch', GREY, dials(d, GREY, 'Patch', [['patch.volume', 'Volume']]), 'pipe-grow-1'),
  );
  left.append(
    row3,
    section('Delay box', BRASS, [
      ...dials(d, BRASS, 'Delay box', ['delay.tune', 'delay.fine', 'delay.harmonics', ['delay.splitPoint', 'Split pt']]),
      ledButton(toggle(d, 'delay.split'), 'Split'),
      ledButton(toggle(d, 'delay.polarity'), 'Polarity'),
    ]),
  );
  const row5 = el('div', 'pipe-row');
  row5.append(
    section('Filter', BLUE, dials(d, BLUE, 'Filter', [['filter.highpass', 'Highpass'], ['filter.lowpass', 'Lowpass'], ['filter.hpComp', 'HP comp'], ['filter.lpComp', 'LP comp']]), 'pipe-grow-1'),
    section('Voice', GREEN, [
      ...dials(d, GREEN, 'Voice', ['voice.detune', 'voice.glide']),
      ledButton(toggle(d, 'voice.glideOn'), 'Glide'),
      pills(choice(d, 'voice.mode'), 'Voice mode', GREEN, { poly: 'Poly', mono: 'Mono', unison: 'Unison' }),
    ], 'pipe-grow-1'),
  );
  left.append(row5);

  // --- right column ---
  const right = el('div', 'pipe-col pipe-col-right');
  right.append(
    renderBrand(d, engine, tickers, touched),
    section('Reverb', PINK, [
      ...dials(d, PINK, 'Reverb', [['rev.spread', 'Spread'], 'rev.mix', 'rev.bass', 'rev.treble']),
      pills(choice(d, 'rev.size'), 'Reverb size', PINK, { small: 'Small', medium: 'Medium', large: 'Large' }),
    ]),
    section('Spring', COPPER, [
      ...dials(spring, COPPER, 'Spring', [['spring.length', 'Length'], 'spring.tension', 'spring.drip', 'spring.tilt', 'spring.dwell', ['spring.mix', 'Dry / wet']]),
    ], 'pipe-spring'),
    section('LFO', ORANGE, [
      renderDial(rateModel(d), 'LFO'),
      ...dials(d, ORANGE, 'LFO', [['lfo.delay', 'Delay'], ['lfo.amount', 'Amount']]),
      ledButton(toggle(d, 'lfo.sync'), 'Sync'),
      pills(choice(d, 'lfo.wave'), 'LFO wave', ORANGE, { sine: 'Sine', tri: 'Tri', sqr: 'Square', ramp: 'Ramp', rnd: 'Rand' }),
      pills(choice(d, 'lfo.dest'), 'LFO destination', ORANGE, { pitch: 'Pitch', filter: 'Filter', steam: 'Steam', sat: 'Sat', push: 'Push' }),
    ]),
  );
  columns.append(left, right);

  const header = el('div', 'pipe-header');
  header.append(renderTransportBlock(d.transport, { running: () => false, followStartStop: false }));
  panel.append(header, columns, mountKeyboardBed(d));
  root.append(panel, el('div', 'pipe-cheek pipe-cheek-right'));

  // The display shows the control you last moved by hand (not the ones a patch load sets).
  let lastInput = 0;
  const mark = () => {
    lastInput = performance.now();
  };
  // Only a hand on a dial, button, pill or encoder counts; the preset keys load many controls at once.
  const handOn = (e: Event) => (e.target as Element | null)?.closest('.dial-face, .pipe-led-btn, .pipe-pill, .pipe-encoder-knob') != null;
  panel.addEventListener('pointerdown', (e) => handOn(e) && mark(), true);
  panel.addEventListener('keydown', (e) => handOn(e) && mark(), true);
  panel.addEventListener('pointermove', (e) => {
    if (e.buttons && handOn(e)) mark();
  }, true);
  panel.addEventListener('wheel', (e) => handOn(e) && mark(), true);
  for (const c of [...d.controls, ...spring.controls]) {
    if (c.kind !== 'number') continue;
    c.onChange(() => {
      if (performance.now() - lastInput > 1500) return;
      touched.label = c.label;
      touched.value = format(c);
    });
  }

  const tick = () => {
    for (const t of tickers) t();
    requestAnimationFrame(tick);
  };
  requestAnimationFrame(tick);
  return root;
}
