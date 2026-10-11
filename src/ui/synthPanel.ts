import type { ChoiceControl, NumberControl, ToggleControl } from '../domain/devices/controls';
import type { Device } from '../domain/devices/device';
import type { Synthesizer } from '../domain/devices/synthesizer';
import { SYNTH_PRESETS } from '../domain/devices/synthPresets';
import { mountKeyboardBed } from './keyboard';
import { renderTransportBlock } from './transportBlock';
import { el, renderFader } from './widgets';

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
    {
      title: 'Oscillator', color: ORANGE, grow: 5, switches: ['osc.range', 'osc.pwSource'],
      faders: ['mix.saw', 'mix.pulse', 'osc.width', 'osc.pwm', 'osc.mod'],
    },
    { title: 'Sub & noise', color: YELLOW, grow: 2, switches: ['osc.sub'], faders: ['mix.sub', 'mix.noise'] },
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

function numberControl(device: Device, id: string): NumberControl {
  const c = device.control(id);
  if (c.kind !== 'number') throw new Error(`${id} is not a number control`);
  return c;
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
  c.onChange(paint);
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

/** Patch selector: previous / next buttons around a drop-down. */
function renderPatchPicker(synth: Synthesizer): HTMLElement {
  const wrap = el('div', 'patch-picker');
  wrap.append(el('div', 'fader-label', 'Patch'));
  const row = el('div', 'patch-picker-row');
  const select = el('select', 'patch-select');
  select.setAttribute('aria-label', 'Synth patch');
  SYNTH_PRESETS.forEach((preset, i) => select.add(new Option(`${String(i).padStart(2, '0')}  ${preset.name}`, String(i))));
  const load = (i: number) => {
    const n = SYNTH_PRESETS.length;
    const index = ((i % n) + n) % n;
    select.value = String(index);
    synth.loadPreset(SYNTH_PRESETS[index]!);
  };
  const step = (label: string, text: string, delta: number) => {
    const b = el('button', 'btn patch-step', text);
    b.type = 'button';
    b.setAttribute('aria-label', label);
    b.addEventListener('click', () => load(Number(select.value) + delta));
    return b;
  };
  select.addEventListener('change', () => load(Number(select.value)));
  // Follow patch changes made elsewhere (e.g. a MIDI program change).
  synth.onPresetChange(() => {
    select.value = String(SYNTH_PRESETS.indexOf(synth.currentPreset));
  });
  row.append(step('Previous patch', '‹', -1), select, step('Next patch', '›', 1));
  wrap.append(row);
  return wrap;
}

/** The synth's front panel, with the keyboard bed fused into its bottom edge. */
export function renderSynthPanel(device: Synthesizer): HTMLElement {
  const panel = el('div', 'synth-panel');
  const header = el('div', 'synth-header');
  const brand = el('div', 'synth-brand');
  brand.append(el('div', 'synth-name', 'MOA-1'), el('div', 'synth-subtitle', 'Mono Synthesizer'));
  header.append(brand, renderTransportBlock(device.transport), renderPatchPicker(device));
  panel.append(header);
  for (const row of ROWS) {
    const r = el('div', 'synth-row');
    for (const spec of row) r.append(renderSection(device, spec));
    panel.append(r);
  }
  panel.append(mountKeyboardBed(device));
  return panel;
}
