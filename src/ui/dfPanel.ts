import type { AudioEngine } from '../audio/engine';
import type { ChoiceControl, NumberControl, ToggleControl } from '../domain/devices/controls';
import { FILTER_TYPES, type FilterBox } from '../domain/devices/filterBox';
import { type DialFace, type DialModel, controlDial, renderDial } from './dial';
import { persistPatch } from './dfStorage';
import { el } from './widgets';

const num = (d: FilterBox, id: string): NumberControl => {
  const c = d.control(id);
  if (c.kind !== 'number') throw new Error(`${id} is not a number control`);
  return c;
};
const choice = (d: FilterBox, id: string): ChoiceControl => {
  const c = d.control(id);
  if (c.kind !== 'choice') throw new Error(`${id} is not a choice control`);
  return c;
};
const toggle = (d: FilterBox, id: string): ToggleControl => {
  const c = d.control(id);
  if (c.kind !== 'toggle') throw new Error(`${id} is not a toggle control`);
  return c;
};

const WHITE = '#f1f1ec';

/** The knob faces of the hardware: a white scale arc, and a black cap with a white pointer or a grey cap with a black one. */
const knobFace = (grey: boolean, size: number): DialFace => (t) => {
  const deg = Math.round((-135 + t * 270) * 10) / 10;
  const cap = grey ? '#a3a39f' : '#1b1b1d';
  const rim = grey ? '#cfcfca' : '#3d3d41';
  const pointer = grey ? '#141414' : WHITE;
  return `<svg aria-hidden="true" width="${size}" height="${size}" viewBox="0 0 64 64">
    <path d="M12.2 51.8 A28 28 0 1 1 51.8 51.8" fill="none" stroke="#e9e9e4" stroke-width="1.6" stroke-linecap="round"></path>
    <circle cx="32" cy="32" r="20.5" fill="${cap}" stroke="${rim}" stroke-width="3"></circle>
    <line x1="32" y1="14" x2="32" y2="26" stroke="${pointer}" stroke-width="3.4" stroke-linecap="round" transform="rotate(${deg} 32 32)"></line>
  </svg>`;
};

function knob(c: NumberControl, section: string, label: string, opts: { grey?: boolean; size?: number } = {}): HTMLElement {
  const model = controlDial(c, WHITE, label);
  const wrap = renderDial(model, section, knobFace(opts.grey ?? false, opts.size ?? 52));
  wrap.classList.add('df-knob');
  if (opts.grey) wrap.classList.add('df-knob-grey');
  return wrap;
}

interface SwitchSpec {
  /** Label above (the first position) and below (the second). */
  top: string;
  bottom: string;
  name?: string;
  aria: string;
  /** True when the switch is in its second (lower) position. */
  down: () => boolean;
  set: (down: boolean) => void;
  subscribe: (fn: () => void) => void;
}

/** A small toggle switch with its two positions labelled; one button, so keyboard and screen readers work. */
function renderSwitch(s: SwitchSpec): HTMLElement {
  const wrap = el('div', 'df-switch');
  wrap.append(el('span', 'df-switch-end', s.top));
  const b = el('button', 'df-switch-body');
  b.type = 'button';
  b.setAttribute('role', 'switch');
  b.setAttribute('aria-label', s.aria);
  b.append(el('i'));
  const sync = () => {
    b.setAttribute('aria-checked', String(s.down()));
    b.title = `${s.aria}: ${s.down() ? s.bottom : s.top}`;
  };
  b.addEventListener('click', () => {
    s.set(!s.down());
    sync();
  });
  s.subscribe(sync);
  sync();
  wrap.append(b, el('span', 'df-switch-end', s.bottom));
  if (s.name) wrap.append(el('span', 'df-switch-name', s.name));
  return wrap;
}

const toggleSwitch = (c: ToggleControl, top: string, bottom: string, aria: string, name?: string): HTMLElement =>
  renderSwitch({ top, bottom, name, aria, down: () => c.value, set: (v) => c.set(v), subscribe: (fn) => void c.onChange(fn) });

/** A choice with two options: the first is the top position. */
const choiceSwitch = (c: ChoiceControl, top: string, bottom: string, aria: string, name?: string): HTMLElement =>
  renderSwitch({ top, bottom, name, aria, down: () => c.value === c.options[1], set: (v) => c.set(c.options[v ? 1 : 0]!), subscribe: (fn) => void c.onChange(fn) });

function section(title: string, ...children: HTMLElement[]): HTMLElement {
  const box = el('section', 'df-box');
  box.append(el('h2', 'df-box-title', title), ...children);
  return box;
}
const row = (cls: string, ...children: HTMLElement[]): HTMLElement => {
  const r = el('div', cls);
  r.append(...children);
  return r;
};

const led = (): HTMLElement => {
  const l = el('i', 'df-led');
  l.setAttribute('aria-hidden', 'true');
  return l;
};

// ---- the FILTER TYPE knob: eight positions on an arc, GEN R-8 on the left and 2045 on the right ----

const TYPE_ANGLES = [-135, -96.4, -57.9, -19.3, 19.3, 57.9, 96.4, 135];
const TYPE_SHORT = ['LP', 'BP', 'HP', 'NOTCH', 'LP', 'BP+', 'NOTCH+', 'BANDSTOP+'];

function renderTypeKnob(c: ChoiceControl, section: string): HTMLElement {
  const wrap = el('div', 'df-type');
  const face: DialFace = (t) => `<svg aria-hidden="true" width="250" height="196" viewBox="0 0 250 196">
    <path d="M62 150 A74 74 0 1 1 188 150" fill="none" stroke="#e9e9e4" stroke-width="1.6" stroke-linecap="round"></path>
    <circle cx="125" cy="108" r="30" fill="#1b1b1d" stroke="#3d3d41" stroke-width="4"></circle>
    <line x1="125" y1="84" x2="125" y2="100" stroke="${WHITE}" stroke-width="4" stroke-linecap="round" transform="rotate(${-135 + t * 270} 125 108)"></line>
  </svg>`;
  const index = () => c.options.indexOf(c.value);
  const model: DialModel = {
    label: 'Filter type', color: WHITE, step: 1 / 7,
    get: () => index() / 7,
    set: (t) => c.set(c.options[Math.round(Math.min(1, Math.max(0, t)) * 7)]!),
    reset: () => c.set(c.options[0]!),
    text: () => c.value,
    subscribe: (fn) => c.onChange(fn),
  };
  const dial = renderDial(model, section, face);
  dial.classList.add('df-type-dial');
  wrap.append(dial);
  // The labels around the arc are buttons too, so a position can be picked directly.
  const labels = TYPE_ANGLES.map((a, i) => {
    const r = 88;
    const rad = (a * Math.PI) / 180;
    const b = el('button', 'df-type-pos', TYPE_SHORT[i]);
    b.type = 'button';
    b.style.left = `${Math.round(125 + r * Math.sin(rad))}px`;
    b.style.top = `${Math.round(108 - r * Math.cos(rad))}px`;
    b.setAttribute('aria-label', `${section} filter type ${FILTER_TYPES[i]}`);
    b.addEventListener('click', () => c.set(FILTER_TYPES[i]!));
    return b;
  });
  const paint = () => labels.forEach((b, i) => b.classList.toggle('on', i === index()));
  c.onChange(paint);
  paint();
  wrap.append(...labels, el('span', 'df-type-side df-type-left', 'GEN R-8'), el('span', 'df-type-side df-type-right', '2045'));
  return wrap;
}

// ---- the OPEN button: holds the envelope's gate open while pressed ----

function renderOpen(label: string, onHold: (on: boolean) => void): HTMLElement {
  const b = el('button', 'df-open', 'OPEN');
  b.type = 'button';
  b.setAttribute('aria-label', label);
  let down = false;
  const set = (on: boolean) => {
    if (down === on) return;
    down = on;
    b.classList.toggle('on', on);
    onHold(on);
  };
  b.addEventListener('pointerdown', (e) => {
    b.setPointerCapture(e.pointerId);
    set(true);
  });
  b.addEventListener('pointerup', () => set(false));
  b.addEventListener('pointercancel', () => set(false));
  b.addEventListener('keydown', (e) => {
    if (e.key === ' ' || e.key === 'Enter') {
      e.preventDefault();
      set(true);
    }
  });
  b.addEventListener('keyup', (e) => {
    if (e.key === ' ' || e.key === 'Enter') set(false);
  });
  b.addEventListener('blur', () => set(false));
  return b;
}

// ---- the panel ----

/** The MOA-DF2 front panel. */
export function renderDfPanel(d: FilterBox, engine?: AudioEngine): HTMLElement {
  const tickers: (() => void)[] = [];
  const root = el('div', 'df-panel');

  // header: wordmark, tagline, patch selector, power LED
  const header = el('div', 'df-header');
  header.innerHTML = `<svg class="df-logo" viewBox="0 0 300 64" role="img" aria-label="MOA-DF2" fill="none" stroke="${WHITE}" stroke-width="7" stroke-linecap="round" stroke-linejoin="round">
    <g transform="translate(6 8)"><path d="M4 44 V6 L19 28 L34 6 V44"/></g>
    <g transform="translate(52 8)"><ellipse cx="19" cy="25" rx="16" ry="21"/></g>
    <g transform="translate(96 8)"><path d="M4 44 L19 5 L34 44 M10 31 H28"/></g>
    <g transform="translate(138 8)"><path d="M6 27 H22"/></g>
    <g transform="translate(160 8)"><path d="M4 6 V44 H15 C31 44 36 34 36 25 C36 14 30 6 15 6 Z"/></g>
    <g transform="translate(206 8)"><path d="M4 44 V6 H30 M4 25 H24"/></g>
    <g transform="translate(250 8)"><path d="M4 14 C4 -2 32 -2 32 14 C32 28 4 34 4 44 H34"/></g>
  </svg>`; // static markup, no user data
  header.append(el('div', 'df-tagline', 'DUAL DYNAMIC MULTI-FILTER'), el('div', 'df-spacer'));

  const patch = el('div', 'df-patch');
  const prev = el('button', 'df-patch-btn', '<');
  prev.type = 'button';
  prev.setAttribute('aria-label', 'Previous patch');
  const next = el('button', 'df-patch-btn', '>');
  next.type = 'button';
  next.setAttribute('aria-label', 'Next patch');
  const patchName = el('div', 'df-patch-name');
  patchName.setAttribute('role', 'status');
  patchName.setAttribute('aria-label', 'Patch');
  const save = el('button', 'df-patch-btn df-patch-save', 'SAVE');
  save.type = 'button';
  save.setAttribute('aria-label', 'Save the panel into this patch slot');
  const step = (delta: number) => d.loadSlot((d.currentSlot + delta + d.slots.length) % d.slots.length);
  prev.addEventListener('click', () => step(-1));
  next.addEventListener('click', () => step(1));
  let flash = false;
  const paintPatch = () => {
    patchName.textContent = `${String(d.currentSlot + 1).padStart(2, '0')}  ${d.currentPreset.name}${flash ? '  SAVED' : ''}`;
  };
  save.addEventListener('click', () => {
    persistPatch(d.currentSlot, d.saveSlot(d.currentSlot));
    flash = true;
    paintPatch();
    window.setTimeout(() => {
      flash = false;
      paintPatch();
    }, 1500);
  });
  d.onPresetChange(paintPatch);
  paintPatch();
  patch.append(prev, patchName, next, save);
  const power = el('div', 'df-power');
  power.append(led(), el('span', undefined, 'POWER'));
  power.firstElementChild!.classList.add('on');
  header.append(patch, power);

  // row A: envelopes and sample & hold
  const envBlock = (n: 1 | 2): { block: HTMLElement; led: HTMLElement } => {
    const e = `env${n}`;
    const name = `Envelope ${n === 1 ? 'I' : 'II'}`;
    const gateLed = led();
    const title = row('df-env-title', el('span', undefined, name.toUpperCase()), gateLed);
    const block = el('div', 'df-env');
    block.append(
      title,
      row('df-knobs', knob(num(d, `${e}.attack`), name, 'ATTACK'), knob(num(d, `${e}.decay`), name, 'DECAY'),
        knob(num(d, `${e}.sustain`), name, 'SUSTAIN'), knob(num(d, `${e}.release`), name, 'RELEASE')),
      row('df-switches',
        choiceSwitch(choice(d, `${e}.mode`), 'ADSR', 'AR LOOP', `${name} mode`),
        choiceSwitch(choice(d, `${e}.curve`), 'LIN', 'EXP', `${name} curve`),
        choiceSwitch(choice(d, `${e}.trig`), 'KEYS', 'THRESH', `${name} gate source`)),
    );
    return { block, led: gateLed };
  };
  const env1 = envBlock(1);
  const env2 = envBlock(2);
  const rowA = row('df-row df-row-a',
    section('ENVELOPES', row('df-env-pair', env1.block, env2.block)),
    section('SAMPLE & HOLD', row('df-knobs df-knobs-wide',
      knob(num(d, 'sh.rate'), 'Sample and hold', 'RATE'), knob(num(d, 'sh.slew'), 'Sample and hold', 'SLEW'),
      choiceSwitch(choice(d, 'sh.source'), 'NOISE', 'ENV I', 'Sample and hold source'))),
  );

  // row B: the filters, with the links between them
  const filterBox = (n: 1 | 2): { box: HTMLElement; led: HTMLElement } => {
    const f = `f${n}`;
    const name = `Filter ${n === 1 ? 'I' : 'II'}`;
    const openLed = led();
    const cutoff = knob(num(d, `${f}.cutoff`), name, 'CUTOFF', { grey: true, size: 104 });
    cutoff.classList.add('df-cutoff');
    const gate = el('div', 'df-gate');
    gate.append(
      el('span', 'df-gate-title', 'GATE'),
      knob(num(d, `${f}.threshold`), name, 'THRESHOLD', { grey: true, size: 44 }),
      toggleSwitch(toggle(d, `${f}.gate`), 'OFF', 'ON', `${name} audio threshold gate`),
      row('df-open-wrap', openLed, renderOpen(`${name}: hold the envelope gate open`, (on) => d.setOpen(n, on))),
    );
    const box = section(name.toUpperCase(),
      row('df-filter-top',
        renderTypeKnob(choice(d, `${f}.type`), name),
        row('df-filter-side', cutoff,
          row('df-knobs', knob(num(d, `${f}.res`), name, 'RESONANCE', { size: 46 }), knob(num(d, `${f}.depth`), name, 'DEPTH −/+', { size: 46 }),
            knob(num(d, `${f}.noise`), name, 'NOISE', { size: 46 })))),
      row('df-filter-bottom',
        row('df-switches',
          choiceSwitch(choice(d, `${f}.source`), 'ENV', 'S&H', `${name} cutoff modulation source`, 'SOURCE'),
          toggleSwitch(toggle(d, `${f}.inv`), 'OFF', 'INV', `${name} invert envelope`, 'INV ENV'),
          toggleSwitch(toggle(d, `${f}.vca`), 'OFF', 'ENV', `${name} VCA follows envelope`, 'VCA')),
        gate),
    );
    box.classList.add('df-filter');
    return { box, led: openLed };
  };
  const filter1 = filterBox(1);
  const filter2 = filterBox(2);
  const links = row('df-links',
    toggleSwitch(toggle(d, 'link.env'), 'OFF', 'ON', 'Envelope I link: filter II uses envelope I', 'ENV I LINK'),
    toggleSwitch(toggle(d, 'link.cutoff'), 'OFF', 'ON', 'Cutoff link: filter II takes filter I cutoff', 'C.OFF LINK'));
  const rowB = row('df-row df-row-b', filter1.box, links, filter2.box);

  // row C: delay and mixer
  const rowC = row('df-row df-row-c',
    section('DELAY', row('df-knobs df-knobs-wide',
      knob(num(d, 'delay.time'), 'Delay', 'TIME'), knob(num(d, 'delay.repeats'), 'Delay', 'REPEATS'),
      knob(num(d, 'delay.level'), 'Delay', 'LEVEL'), knob(num(d, 'delay.mod'), 'Delay', 'MOD DEPTH'),
      choiceSwitch(choice(d, 'delay.source'), 'S&H', 'ENV II', 'Delay modulation source'))),
    section('MIXER', row('df-knobs df-knobs-wide',
      knob(num(d, 'mix.a'), 'Mixer', 'FILTER I'), knob(num(d, 'mix.b'), 'Mixer', 'FILTER II'),
      knob(num(d, 'mix.volume'), 'Mixer', 'VOLUME', { grey: true, size: 60 }),
      choiceSwitch(choice(d, 'mix.mode'), 'STEREO', 'MONO', 'Output mode'))),
  );

  root.append(header, rowA, rowB, rowC);

  // LEDs follow the worklet's report of which gates are open.
  if (engine) {
    tickers.push(() => {
      const view = engine.readDF('box', 'box');
      const linked = toggle(d, 'link.env').value;
      const g1 = view?.gate[0] === true;
      const g2 = linked ? g1 : view?.gate[1] === true;
      env1.led.classList.toggle('on', g1);
      env2.led.classList.toggle('on', view?.gate[1] === true);
      filter1.led.classList.toggle('on', g1);
      filter2.led.classList.toggle('on', g2);
    });
    const tick = () => {
      for (const t of tickers) t();
      requestAnimationFrame(tick);
    };
    requestAnimationFrame(tick);
  }
  return root;
}
