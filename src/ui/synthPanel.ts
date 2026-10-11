import type { ChoiceControl, NumberControl, ToggleControl } from '../domain/devices/controls';
import type { Device } from '../domain/devices/device';
import { STEPS, format, fromSlider, toSlider } from './controls';

const SLOT_HEIGHT = 140;
const CAP_HEIGHT = 36;

const PINK = '#d9628a';
const GREEN = '#4fb286';
const ORANGE = '#e8742c';
const YELLOW = '#dcb43c';
const BLUE = '#4a9be0';

interface FaderSpec {
  id: string;
  label?: string;
}

interface SectionSpec {
  title: string;
  color: string;
  grow: number;
  switches?: string[];
  faders: (string | FaderSpec)[];
}

/** Panel layout: which controls appear where. Rows wrap on narrow screens. */
const ROWS: SectionSpec[][] = [
  [
    { title: 'Performance', color: PINK, grow: 2, switches: ['perf.notes'], faders: ['perf.glide'] },
    { title: 'LFO', color: GREEN, grow: 2, switches: ['lfo.wave'], faders: ['lfo.rate'] },
    { title: 'Oscillator', color: ORANGE, grow: 3, switches: ['osc.range'], faders: ['osc.mod', 'osc.width', 'osc.pwm'] },
    { title: 'Source mix', color: YELLOW, grow: 4, switches: ['osc.sub'], faders: ['mix.saw', 'mix.pulse', 'mix.sub', 'mix.noise'] },
  ],
  [
    {
      title: 'Filter', color: BLUE, grow: 5,
      faders: ['filter.cutoff', 'filter.resonance', { id: 'filterEnv.amount', label: 'Env' }, 'filter.lfo', 'filter.keyFollow'],
    },
    { title: 'Filter envelope', color: BLUE, grow: 4, faders: adsr('filterEnv') },
    { title: 'Amp envelope', color: ORANGE, grow: 4, faders: adsr('ampEnv') },
    { title: 'Master', color: PINK, grow: 1, faders: ['level'] },
  ],
];

function adsr(prefix: string): FaderSpec[] {
  return [
    { id: `${prefix}.attack`, label: 'A' },
    { id: `${prefix}.decay`, label: 'D' },
    { id: `${prefix}.sustain`, label: 'S' },
    { id: `${prefix}.release`, label: 'R' },
  ];
}

function el<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  className?: string,
  text?: string,
): HTMLElementTagNameMap[K] {
  const e = document.createElement(tag);
  if (className) e.className = className;
  if (text !== undefined) e.textContent = text;
  return e;
}

function numberControl(device: Device, id: string): NumberControl {
  const c = device.control(id);
  if (c.kind !== 'number') throw new Error(`${id} is not a number control`);
  return c;
}

/** Vertical fader: a transparent native range input (pointer, keyboard, a11y) over a drawn cap. */
function renderFader(c: NumberControl, section: string, label: string): HTMLElement {
  const wrap = el('div', 'fader');
  wrap.append(el('div', 'fader-label', label));

  const slot = el('div', 'fader-slot');
  slot.append(el('div', 'fader-track'));
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
    cap.style.top = `${Math.round((1 - t) * (SLOT_HEIGHT - CAP_HEIGHT))}px`;
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

function renderChoice(c: ChoiceControl, color: string): HTMLElement {
  const wrap = el('div', 'switch');
  wrap.append(el('div', 'fader-label', c.label));
  const group = el('div', 'switch-options');
  group.setAttribute('role', 'group');
  group.setAttribute('aria-label', c.label);
  const buttons = c.options.map((option) => {
    const b = el('button', 'switch-option', option);
    b.type = 'button';
    b.addEventListener('click', () => {
      c.set(option);
      paint();
    });
    group.append(b);
    return b;
  });
  const paint = () => {
    buttons.forEach((b, i) => {
      const on = c.options[i] === c.value;
      b.setAttribute('aria-pressed', String(on));
      b.style.background = on ? color : '';
      b.style.borderColor = on ? color : '';
    });
  };
  paint();
  wrap.append(group);
  return wrap;
}

function renderToggle(c: ToggleControl, color: string): HTMLElement {
  const wrap = el('div', 'switch');
  wrap.append(el('div', 'fader-label', c.label));
  const b = el('button', 'switch-option', c.value ? 'On' : 'Off');
  b.type = 'button';
  const paint = () => {
    b.textContent = c.value ? 'On' : 'Off';
    b.setAttribute('aria-pressed', String(c.value));
    b.style.background = c.value ? color : '';
    b.style.borderColor = c.value ? color : '';
  };
  b.addEventListener('click', () => {
    c.set(!c.value);
    paint();
  });
  paint();
  wrap.append(b);
  return wrap;
}

function renderSection(device: Device, spec: SectionSpec): HTMLElement {
  const section = el('section', 'synth-section');
  section.style.flex = `${spec.grow} 1 0`;
  const head = el('div', 'synth-section-head');
  const bar = el('span', 'synth-section-bar');
  bar.style.background = spec.color;
  head.append(bar, el('h2', undefined, spec.title));

  const body = el('div', 'synth-section-body');
  for (const id of spec.switches ?? []) {
    const c = device.control(id);
    if (c.kind === 'choice') body.append(renderChoice(c, spec.color));
    else if (c.kind === 'toggle') body.append(renderToggle(c, spec.color));
  }
  for (const f of spec.faders) {
    const { id, label } = typeof f === 'string' ? { id: f, label: undefined } : f;
    const c = numberControl(device, id);
    body.append(renderFader(c, spec.title, label ?? c.label));
  }
  section.append(head, body);
  return section;
}

/** The synth's front panel. `headerRight` is shown top-right (e.g. the start-audio button). */
export function renderSynthPanel(device: Device, headerRight: HTMLElement): HTMLElement {
  const panel = el('div', 'synth-panel');
  const header = el('div', 'synth-header');
  const brand = el('div', 'synth-brand');
  brand.append(el('div', 'synth-name', 'MOA-1'), el('div', 'synth-subtitle', 'Mono Synthesizer'));
  header.append(brand, headerRight);
  panel.append(header);
  for (const row of ROWS) {
    const r = el('div', 'synth-row');
    for (const spec of row) r.append(renderSection(device, spec));
    panel.append(r);
  }
  return panel;
}
