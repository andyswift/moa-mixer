import type { ChoiceControl, NumberControl, ToggleControl } from '../domain/devices/controls';
import { LYNCH_BANKS, LYNCH_GROUPS, LYNCH_PATCHES } from '../domain/devices/lynchPresets';
import type { LynchSynth } from '../domain/devices/lynchSynth';
import { MIDI_CHANNELS } from '../domain/devices/transport';
import { STEPS, fromSlider, toSlider } from './controls';
import { type DialModel, controlDial, renderDial } from './dial';
import { mountKeyboardBed } from './keyboard';
import { loadSavedPatches, persistPatch } from './lynchStorage';
import { el } from './widgets';

const num = (d: LynchSynth, id: string): NumberControl => {
  const c = d.control(id);
  if (c.kind !== 'number') throw new Error(`${id} is not a number control`);
  return c;
};
const choice = (d: LynchSynth, id: string): ChoiceControl => {
  const c = d.control(id);
  if (c.kind !== 'choice') throw new Error(`${id} is not a choice control`);
  return c;
};
const toggle = (d: LynchSynth, id: string): ToggleControl => {
  const c = d.control(id);
  if (c.kind !== 'toggle') throw new Error(`${id} is not a toggle control`);
  return c;
};

// ---------------------------------------------------------------- sliders

interface SliderModel {
  label: string;
  aria: string;
  /** Number of steps; the slider runs 0..steps. */
  steps: number;
  get: () => number;
  set: (v: number) => void;
  reset: () => void;
  text: () => string;
  subscribe: (fn: () => void) => () => void;
}

/**
 * A vertical slider like the original's: a black slot with white tick lines across it and a short flat black cap.
 * A transparent native range input sits over it, so pointer, keyboard and screen readers all work.
 */
function renderSlider(m: SliderModel, height = 104, capHeight = 16): HTMLElement {
  const wrap = el('div', 'ly-slider');
  wrap.append(el('div', 'ly-slider-label', m.label));
  const slot = el('div', 'ly-slider-slot');
  slot.style.setProperty('--h', `${height}px`);
  slot.style.setProperty('--cap', `${capHeight}px`);
  slot.append(el('div', 'ly-slider-ticks'), el('div', 'ly-slider-track'));
  const cap = el('div', 'ly-slider-cap');
  cap.append(el('span'));
  slot.append(cap);

  const input = el('input', 'ly-slider-input');
  input.type = 'range';
  input.min = '0';
  input.max = String(m.steps);
  input.step = '1';
  input.setAttribute('aria-label', m.aria);
  input.setAttribute('aria-orientation', 'vertical');
  const sync = () => {
    const t = m.get() / m.steps;
    cap.style.top = `${Math.round((1 - t) * (height - capHeight))}px`;
    input.value = String(m.get());
    input.setAttribute('aria-valuetext', m.text());
    input.title = m.text();
  };
  input.addEventListener('input', () => {
    m.set(Number(input.value));
    sync();
  });
  input.addEventListener('dblclick', () => {
    m.reset();
    sync();
  });
  m.subscribe(sync);
  sync();
  slot.append(input);
  wrap.append(slot);
  return wrap;
}

const numberSlider = (c: NumberControl, label: string, aria = `${label} slider`): SliderModel => ({
  label, aria, steps: STEPS,
  get: () => toSlider(c),
  set: (v) => c.set(fromSlider(c, v)),
  reset: () => c.set(c.initial),
  text: () => `${c.label} ${c.value.toFixed(c.max > 100 ? 0 : 2)} ${c.unit}`.trim(),
  subscribe: (fn) => c.onChange(fn),
});

/** A slider over a choice with a few fixed positions (the high-pass has four). */
const choiceSlider = (c: ChoiceControl, label: string): SliderModel => ({
  label, aria: `${label} slider`, steps: c.options.length - 1,
  get: () => c.options.indexOf(c.value),
  set: (v) => c.set(c.options[v]!),
  reset: () => c.set('1'),
  text: () => `position ${c.value}`,
  subscribe: (fn) => c.onChange(fn),
});

// ---------------------------------------------------------------- keys

type Tone = 'cream' | 'orange' | 'blue';

interface KeySpec {
  label: string;
  aria: string;
  tone: Tone;
  on: () => boolean;
  click: () => void;
  subscribe: (fn: () => void) => void;
  width?: number;
}

/** A rectangular key with a red LED above it. */
function renderKey(k: KeySpec): HTMLElement {
  const wrap = el('div', 'ly-key-wrap');
  wrap.append(el('i', 'ly-led'));
  const b = el('button', `ly-key ly-key-${k.tone}`, k.label);
  b.type = 'button';
  b.setAttribute('aria-label', k.aria);
  if (k.width) b.style.width = `${k.width}px`;
  b.addEventListener('click', k.click);
  const paint = () => {
    const on = k.on();
    b.setAttribute('aria-pressed', String(on));
    wrap.classList.toggle('lit', on);
  };
  k.subscribe(paint);
  paint();
  wrap.append(b);
  return wrap;
}

const toggleKey = (c: ToggleControl, label: string, tone: Tone, aria = label, width?: number): HTMLElement =>
  renderKey({ label, aria, tone, width, on: () => c.value, click: () => c.set(!c.value), subscribe: (fn) => void c.onChange(fn) });

const choiceKey = (c: ChoiceControl, value: string, label: string, tone: Tone, aria: string, width?: number): HTMLElement =>
  renderKey({ label, aria, tone, width, on: () => c.value === value, click: () => c.set(value), subscribe: (fn) => void c.onChange(fn) });

/** The label above a group of keys (`ly-cap-label`) and the group itself. */
function group(title: string, children: HTMLElement[], className = ''): HTMLElement {
  const g = el('div', `ly-group ${className}`.trim());
  g.append(el('div', 'ly-group-title', title));
  const row = el('div', 'ly-group-row');
  row.append(...children);
  g.append(row);
  return g;
}

function section(title: string, body: HTMLElement[], grow: number, blue = false): HTMLElement {
  const s = el('section', 'ly-section');
  s.style.flex = `${grow} 1 0`;
  s.append(el('div', `ly-bar${blue ? ' ly-bar-blue' : ''}`, title));
  const b = el('div', 'ly-section-body');
  b.append(...body);
  s.append(b);
  return s;
}

// ---------------------------------------------------------------- the black cheek: knobs, bender, lever

/** The knob face: a black cap with a white pointer, a dotted scale and 0 and 10 at its ends. */
const knobFace = (t: number): string => {
  const deg = Math.round((-135 + t * 270) * 10) / 10;
  return `<svg aria-hidden="true" width="76" height="66" viewBox="0 0 84 74">
    <path d="M17 58 A28 28 0 1 1 67 58" fill="none" stroke="#d9d5ce" stroke-width="1.3" stroke-dasharray="1 5.2"></path>
    <text x="13" y="70" font-family="Barlow Condensed, sans-serif" font-size="11" font-weight="600" fill="#f4f1ea">0</text>
    <text x="63" y="70" font-family="Barlow Condensed, sans-serif" font-size="11" font-weight="600" fill="#f4f1ea">10</text>
    <circle cx="42" cy="38" r="19" fill="#0b0b0c" stroke="#3f3d42" stroke-width="1.5"></circle>
    <circle cx="42" cy="38" r="13" fill="#161617" stroke="#2c2b2e" stroke-width="1"></circle>
    <rect x="40.8" y="21" width="2.4" height="13" rx="1.2" fill="#f4f1ea" transform="rotate(${deg} 42 38)"></rect>
  </svg>`;
};

function knob(d: LynchSynth, id: string, label: string): HTMLElement {
  const model: DialModel = controlDial(num(d, id), '#f4f1ea', label);
  const dial = renderDial(model, 'Lynch', (t) => knobFace(t));
  dial.classList.add('ly-knob');
  return dial;
}

/**
 * The bender lever in its slot: drag left and right to bend the pitch, push it up (away from you) for LFO
 * modulation. It springs back when let go. Arrow keys do the same while held.
 */
function renderLever(d: LynchSynth): HTMLElement {
  const wrap = el('div', 'ly-lever-wrap');
  const slot = el('div', 'ly-lever');
  slot.tabIndex = 0;
  slot.setAttribute('role', 'application');
  slot.setAttribute('aria-roledescription', 'bender lever');
  slot.setAttribute('aria-label', 'Bender lever: left and right bend the pitch, up adds modulation');
  const handle = el('div', 'ly-lever-handle');
  slot.append(handle);

  const place = () => {
    handle.style.transform = `translate(${d.pitchBend * 54}px, ${-d.modWheel * 5}px)`;
  };
  d.onPerformanceChange(place);
  place();

  let drag: { x: number; y: number; bend: number; mod: number } | undefined;
  slot.addEventListener('pointerdown', (e) => {
    e.preventDefault();
    slot.focus();
    slot.setPointerCapture(e.pointerId);
    drag = { x: e.clientX, y: e.clientY, bend: d.pitchBend, mod: d.modWheel };
  });
  slot.addEventListener('pointermove', (e) => {
    if (!drag) return;
    d.setPitchBend(drag.bend + (e.clientX - drag.x) / 54);
    d.setModWheel(drag.mod + (drag.y - e.clientY) / 40);
  });
  const release = () => {
    if (!drag) return;
    drag = undefined;
    d.setPitchBend(0);
    d.setModWheel(0);
  };
  slot.addEventListener('pointerup', release);
  slot.addEventListener('pointercancel', release);
  slot.addEventListener('keydown', (e) => {
    if (e.repeat) return;
    if (e.key === 'ArrowLeft') d.setPitchBend(-1);
    else if (e.key === 'ArrowRight') d.setPitchBend(1);
    else if (e.key === 'ArrowUp') d.setModWheel(1);
    else return;
    e.preventDefault();
  });
  slot.addEventListener('keyup', (e) => {
    if (e.key === 'ArrowLeft' || e.key === 'ArrowRight') d.setPitchBend(0);
    else if (e.key === 'ArrowUp') d.setModWheel(0);
  });

  const arrows = el('div', 'ly-lever-arrows');
  arrows.innerHTML = '<svg aria-hidden="true" width="110" height="10" viewBox="0 0 110 10"><path d="M4 5 H106 M4 5 L9 2 M4 5 L9 8 M106 5 L101 2 M106 5 L101 8" fill="none" stroke="#f4f1ea" stroke-width="1.2"></path></svg>';
  wrap.append(slot, arrows);
  return wrap;
}

function renderCheek(d: LynchSynth): HTMLElement {
  const cheek = el('div', 'ly-cheek');
  const knobs = el('div', 'ly-knobs');
  knobs.append(knob(d, 'master.volume', 'Volume'), knob(d, 'master.portamento', 'Portamento'));

  const bender = el('div', 'ly-bender');
  const scale = el('div', 'ly-bender-scale');
  scale.innerHTML = '<span>10</span><span>5</span><span>0</span>';
  const sliders = el('div', 'ly-bender-sliders');
  for (const [id, label] of [['bend.dco', 'DCO'], ['bend.vcf', 'VCF'], ['bend.lfo', 'LFO']] as const) {
    sliders.append(renderSlider(numberSlider(num(d, id), label, `Bender ${label} sensitivity`), 56, 12));
  }
  const trig = el('div', 'ly-trig');
  const off = el('span', undefined, 'OFF');
  const on = el('span', undefined, 'ON');
  const lever = el('button', 'ly-trig-switch');
  lever.type = 'button';
  lever.setAttribute('aria-label', 'LFO trigger from the lever');
  lever.append(el('i'));
  const trigControl = toggle(d, 'bend.lfoTrig');
  lever.addEventListener('click', () => trigControl.set(!trigControl.value));
  const paintTrig = () => lever.setAttribute('aria-pressed', String(trigControl.value));
  trigControl.onChange(paintTrig);
  paintTrig();
  trig.append(off, lever, on);
  bender.append(scale, sliders, trig);

  const routing = el('div', 'ly-routing');
  routing.innerHTML = `<svg aria-hidden="true" width="196" height="26" viewBox="0 0 196 26">
    <path d="M52 0 V10 H92 V22 M82 0 V6 H92 M112 0 V10 H92 M170 0 V14 H132 V22" fill="none" stroke="#f4f1ea" stroke-width="1.2"></path>
    <text x="138" y="25" font-family="Barlow Condensed, sans-serif" font-size="10" font-weight="700" fill="#f4f1ea" letter-spacing="1">LFO TRIG</text>
  </svg>`;
  cheek.append(knobs, bender, routing, el('div', 'ly-bender-name', 'BENDER'), renderLever(d));
  return cheek;
}

// ---------------------------------------------------------------- the header: patch name and the logo

const LOGO = `<svg role="img" aria-label="Lynch 106" width="420" height="58" viewBox="-2 -2 350 48" class="ly-logo">
  <g fill="none" stroke="#efe9d6" stroke-width="8" stroke-linejoin="round" stroke-linecap="round">
    <path d="M4 4 V40 H28"></path>
    <g transform="translate(42 0)"><path d="M4 4 L17 22 L30 4 M17 22 V40"></path></g>
    <g transform="translate(84 0)"><path d="M4 40 V4 L30 40 V4"></path></g>
    <g transform="translate(126 0)"><path d="M30 15 V14 Q30 4 20 4 H14 Q4 4 4 14 V30 Q4 40 14 40 H20 Q30 40 30 30 V29"></path></g>
    <g transform="translate(168 0)"><path d="M4 4 V40 M30 4 V40 M4 22 H30"></path></g>
    <g transform="translate(210 0)"><path d="M4 22 H16"></path></g>
    <g transform="translate(238 0)"><path d="M4 14 L14 4 V40"></path></g>
    <g transform="translate(270 0)"><path d="M14 4 H20 Q30 4 30 14 V30 Q30 40 20 40 H14 Q4 40 4 30 V14 Q4 4 14 4 Z"></path></g>
    <g transform="translate(312 0)"><path d="M28 4 H14 Q4 4 4 14 V30 Q4 40 14 40 H20 Q30 40 30 30 Q30 22 20 22 H4"></path></g>
  </g>
</svg>`;

function renderHeader(d: LynchSynth): HTMLElement {
  const header = el('header', 'ly-header');
  const left = el('div', 'ly-patch-name');
  left.append(el('div', 'ly-small-label', 'Patch'));
  const name = el('div', 'ly-patch-text');
  name.setAttribute('role', 'status');
  const channel = el('label', 'ly-channel');
  channel.append(el('span', undefined, 'MIDI channel'));
  const select = el('select');
  for (const ch of MIDI_CHANNELS) select.add(new Option(ch === 'omni' ? 'Omni' : ch, ch, false, ch === d.transport.channel.value));
  select.addEventListener('change', () => d.transport.channel.set(select.value));
  channel.append(select);
  left.append(name, channel);

  const brand = el('div', 'ly-brand');
  brand.innerHTML = `<div class="ly-stripe"></div>${LOGO}<div class="ly-stripe ly-stripe-thin"></div><div class="ly-tagline">Programmable Polyphonic Synthesizer</div>`;
  header.append(left, brand);

  const paint = () => {
    name.textContent = d.manual ? 'MANUAL' : d.currentPreset.name.toUpperCase();
  };
  d.onPresetChange(paint);
  paint();
  return header;
}

// ---------------------------------------------------------------- the panel

/** The Lynch 106 front panel: three rows of controls, the bender cheek and the keys. */
export function renderLynchPanel(d: LynchSynth): HTMLElement {
  loadSavedPatches(d);
  const nothing = (_fn: () => void) => undefined;
  const onPatch = (fn: () => void) => void d.onPresetChange(fn);

  const root = el('div', 'ly-case');
  root.append(el('div', 'ly-end ly-end-left'));
  const panel = el('div', 'ly-panel');
  panel.append(renderHeader(d));

  // Row 1: LFO, DCO, HPF, VCF
  const row1 = el('div', 'ly-row');
  const range = choice(d, 'dco.range');
  const pwmSource = choice(d, 'dco.pwmSource');
  row1.append(
    section('LFO', [renderSlider(numberSlider(num(d, 'lfo.rate'), 'Rate')), renderSlider(numberSlider(num(d, 'lfo.delay'), 'Delay'))], 2),
    section('DCO', [
      (() => {
        const top = el('div', 'ly-top-row');
        top.append(
          group('Range', [
            choiceKey(range, '16', '16', 'cream', 'Range 16 foot', 34),
            choiceKey(range, '8', '8', 'cream', 'Range 8 foot', 34),
            choiceKey(range, '4', '4', 'cream', 'Range 4 foot', 34),
          ]),
          group('Wave', [toggleKey(toggle(d, 'dco.pulse'), 'Pulse', 'cream', 'Pulse wave', 44), toggleKey(toggle(d, 'dco.saw'), 'Saw', 'cream', 'Sawtooth wave', 44)]),
          group('PWM', [
            choiceKey(pwmSource, 'man', 'Man', 'orange', 'Pulse width manual', 38),
            choiceKey(pwmSource, 'lfo', 'LFO', 'orange', 'Pulse width from LFO', 38),
          ]),
        );
        return top;
      })(),
      renderSlider(numberSlider(num(d, 'dco.lfo'), 'LFO')),
      renderSlider(numberSlider(num(d, 'dco.pwm'), 'PWM')),
      renderSlider(numberSlider(num(d, 'dco.sub'), 'Sub')),
      renderSlider(numberSlider(num(d, 'dco.noise'), 'Noise')),
    ], 7),
    section('HPF', [renderSlider(choiceSlider(choice(d, 'hpf.freq'), 'Freq'))], 1.3),
    section('VCF', [
      renderSlider(numberSlider(num(d, 'vcf.freq'), 'Freq')),
      renderSlider(numberSlider(num(d, 'vcf.res'), 'Res')),
      renderSlider(numberSlider(num(d, 'vcf.env'), 'Env')),
      renderSlider(numberSlider(num(d, 'vcf.lfo'), 'LFO')),
      renderSlider(numberSlider(num(d, 'vcf.kybd'), 'Kybd')),
      (() => {
        const p = choice(d, 'vcf.polarity');
        return group('Env', [choiceKey(p, 'plus', '+', 'orange', 'Envelope polarity positive', 30), choiceKey(p, 'minus', '-', 'orange', 'Envelope polarity inverted', 30)], 'ly-stack');
      })(),
    ], 5.5),
  );

  // Row 2: VCA, ENV, CHORUS, KEY
  const vca = choice(d, 'vca.mode');
  const i = toggle(d, 'chorus.i');
  const ii = toggle(d, 'chorus.ii');
  const onChorus = (fn: () => void) => {
    i.onChange(fn);
    ii.onChange(fn);
  };
  const transpose = choice(d, 'key.transpose');
  const assign = choice(d, 'assign.mode');
  const row2 = el('div', 'ly-row');
  row2.append(
    section('VCA', [
      renderSlider(numberSlider(num(d, 'vca.level'), 'Level')),
      group('Mode', [choiceKey(vca, 'env', 'Env', 'orange', 'VCA from envelope', 34), choiceKey(vca, 'gate', 'Gate', 'orange', 'VCA from gate', 34)], 'ly-stack'),
    ], 2.2),
    section('ENV', ['attack', 'decay', 'sustain', 'release'].map((p, n) => renderSlider(numberSlider(num(d, `env.${p}`), 'ADSR'[n]!))), 4),
    section('Chorus', [group('', [
      renderKey({ label: 'Off', aria: 'Chorus off', tone: 'cream', width: 40, on: () => !i.value && !ii.value, click: () => { i.set(false); ii.set(false); }, subscribe: (fn) => onChorus(fn) }),
      toggleKey(i, 'I', 'orange', 'Chorus I', 34),
      toggleKey(ii, 'II', 'orange', 'Chorus II', 34),
    ])], 2.8),
    section('Key', [group('', [
      renderKey({
        label: 'Transpose', aria: 'Key transpose, steps through five octave settings', tone: 'orange', width: 70, on: () => transpose.value !== '0',
        click: () => transpose.set(transpose.options[(transpose.options.indexOf(transpose.value) + 1) % transpose.options.length]!),
        subscribe: (fn) => void transpose.onChange(fn),
      }),
      toggleKey(toggle(d, 'key.hold'), 'Hold', 'cream', 'Hold', 40),
      choiceKey(assign, 'poly1', 'Poly 1', 'cream', 'Assign mode poly 1', 46),
      choiceKey(assign, 'poly2', 'Poly 2', 'cream', 'Assign mode poly 2', 46),
      choiceKey(assign, 'unison', 'Unison', 'cream', 'Assign mode unison', 48),
    ])], 4.6),
  );

  // Row 3: patch memory
  const display = el('div', 'ly-display');
  display.setAttribute('role', 'status');
  display.setAttribute('aria-label', 'Bank and patch number');
  const digits = [el('span'), el('span')];
  display.append(...digits);
  const paintDisplay = () => {
    digits[0]!.textContent = String(d.bank);
    digits[1]!.textContent = String(d.patchNumber.patch);
  };
  onPatch(paintDisplay);
  paintDisplay();

  const numbered = (what: string, pressed: (n: number) => boolean, click: (n: number) => void) =>
    Array.from({ length: LYNCH_BANKS }, (_, n) =>
      renderKey({ label: String(n + 1), aria: `${what} ${n + 1}`, tone: 'blue', width: 30, on: () => pressed(n + 1), click: () => click(n + 1), subscribe: onPatch }));
  const row3 = el('div', 'ly-row');
  row3.append(
    section('Group', LYNCH_GROUPS.map((g, n) => renderKey({ label: g, aria: `Group ${g}`, tone: 'cream', width: 30, on: () => d.group === n, click: () => d.selectGroup(n), subscribe: onPatch })), 1.4, true),
    section('Bank', numbered('Bank', (n) => d.bank === n, (n) => d.selectBank(n)), 3.4, true),
    section('Number', [display], 1.3, true),
    section('Patch number', numbered('Patch', (n) => !d.manual && d.patchNumber.patch === n && d.patchNumber.bank === d.bank && d.patchNumber.group === d.group, (n) => d.selectPatch(n)).slice(0, LYNCH_PATCHES), 3.4, true),
    section('Memory', [
      renderKey({ label: 'Manual', aria: 'Manual: the panel is the sound', tone: 'cream', width: 50, on: () => d.manual, click: () => d.selectManual(), subscribe: onPatch }),
      renderKey({
        label: 'Write', aria: 'Write the sound to the selected patch', tone: 'orange', width: 46, on: () => false,
        click: () => {
          const preset = d.write();
          persistPatch(d.currentSlot, preset);
        },
        subscribe: nothing,
      }),
    ], 1.8),
  );

  panel.append(row1, row2, row3, mountKeyboardBed(d, renderCheek(d)));
  root.append(panel, el('div', 'ly-end ly-end-right'));
  return root;
}
