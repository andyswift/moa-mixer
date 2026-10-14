import type { AudioEngine } from '../audio/engine';
import type { ChoiceControl, NumberControl, ToggleControl } from '../domain/devices/controls';
import type { DuoSynth } from '../domain/devices/duoSynth';
import { STEPS, fromSlider, toSlider } from './controls';
import { type DialFace, type DialModel, controlDial, renderDial } from './dial';
import { DUO_DECOR, DUO_VIEWBOX } from './duoDecor';
import { persistPatch } from './duoStorage';
import { el } from './widgets';

const num = (d: DuoSynth, id: string): NumberControl => {
  const c = d.control(id);
  if (c.kind !== 'number') throw new Error(`${id} is not a number control`);
  return c;
};
const choice = (d: DuoSynth, id: string): ChoiceControl => {
  const c = d.control(id);
  if (c.kind !== 'choice') throw new Error(`${id} is not a choice control`);
  return c;
};
const toggle = (d: DuoSynth, id: string): ToggleControl => {
  const c = d.control(id);
  if (c.kind !== 'toggle') throw new Error(`${id} is not a toggle control`);
  return c;
};

// ---------------------------------------------------------------- knobs

/** Shared gradients for the knob faces, rendered once so every knob can point at them. */
const DEFS = `<svg width="0" height="0" style="position:absolute" aria-hidden="true" focusable="false"><defs>
  <radialGradient id="duoSkirt" cx="50%" cy="38%" r="65%"><stop offset="0" stop-color="#2c2c2e"/><stop offset="1" stop-color="#09090a"/></radialGradient>
  <radialGradient id="duoCap" cx="42%" cy="36%" r="70%"><stop offset="0" stop-color="#f7f7f7"/><stop offset="0.55" stop-color="#bcbcbc"/><stop offset="1" stop-color="#8a8a8a"/></radialGradient>
</defs></svg>`;

/** A black fluted knob with a brushed-silver cap and a white pointer (`dark`: a small all-black knob). */
const knobFace = (dark = false): DialFace => (t) => {
  const deg = Math.round((-135 + t * 270) * 10) / 10;
  const cap = dark
    ? '<circle cx="50" cy="50" r="22" fill="#1d1d1f" stroke="#3a3a3d" stroke-width="1.5"></circle>'
    : `<circle cx="50" cy="50" r="36" fill="url(#duoCap)" stroke="#555" stroke-width="1"></circle>
       <g opacity="0.35" fill="#ffffff"><path d="M50 50 L86 50 A36 36 0 0 0 68 18.8 Z"></path><path d="M50 50 L14 50 A36 36 0 0 0 32 81.2 Z"></path></g>`;
  return `<svg aria-hidden="true" viewBox="0 0 100 100" width="100%" height="100%">
    <circle cx="50" cy="50" r="47" fill="url(#duoSkirt)"></circle>
    <circle cx="50" cy="50" r="45" fill="none" stroke="#1f1f21" stroke-width="5" stroke-dasharray="4.1 4.1"></circle>
    ${cap}
    <rect x="47.5" y="5" width="5" height="${dark ? 12 : 15}" rx="2" fill="#f4f4f0" transform="rotate(${deg} 50 50)"></rect>
  </svg>`;
};

function knob(c: NumberControl, section: string, label: string, dark = false): HTMLElement {
  const wrap = renderDial(controlDial(c, '#f4f4f0', label), section, knobFace(dark));
  wrap.classList.add('duo-knob');
  return wrap;
}

/** A knob over a choice with a few fixed positions (the routing knobs): drag, arrows or click a label. */
function choiceKnob(c: ChoiceControl, section: string, label: string): HTMLElement {
  const last = c.options.length - 1;
  const model: DialModel = {
    label, color: '#f4f4f0', step: 1 / last,
    get: () => c.options.indexOf(c.value) / last,
    set: (t) => c.set(c.options[Math.round(Math.min(1, Math.max(0, t)) * last)]!),
    reset: () => c.set(c.options[0]!),
    text: () => c.value.toUpperCase(),
    subscribe: (fn) => c.onChange(fn),
  };
  // the pointer sweeps 90 degrees over the positions, like the real switch
  const face: DialFace = (t) => {
    const deg = -45 + t * 90;
    return `<svg aria-hidden="true" viewBox="0 0 100 100" width="100%" height="100%">
      <circle cx="50" cy="50" r="47" fill="url(#duoSkirt)"></circle>
      <circle cx="50" cy="50" r="45" fill="none" stroke="#1f1f21" stroke-width="5" stroke-dasharray="4.1 4.1"></circle>
      <circle cx="50" cy="50" r="36" fill="url(#duoCap)" stroke="#555" stroke-width="1"></circle>
      <g opacity="0.35" fill="#ffffff"><path d="M50 50 L86 50 A36 36 0 0 0 68 18.8 Z"></path><path d="M50 50 L14 50 A36 36 0 0 0 32 81.2 Z"></path></g>
      <rect x="47.5" y="5" width="5" height="15" rx="2" fill="#f4f4f0" transform="rotate(${deg} 50 50)"></rect>
    </svg>`;
  };
  const wrap = renderDial(model, section, face);
  wrap.classList.add('duo-knob', 'duo-knob-choice');
  return wrap;
}

// ---------------------------------------------------------------- sliders

interface SliderModel {
  label: string;
  steps: number;
  get: () => number;
  set: (v: number) => void;
  reset: () => void;
  text: () => string;
  subscribe: (fn: () => void) => () => void;
}

const numberSlider = (c: NumberControl, label: string): SliderModel => ({
  label, steps: STEPS,
  get: () => toSlider(c),
  set: (v) => c.set(fromSlider(c, v)),
  reset: () => c.set(c.initial),
  text: () => `${c.label} ${Math.abs(c.value) >= 100 ? c.value.toFixed(0) : c.value.toFixed(2)} ${c.unit}`.trim(),
  subscribe: (fn) => c.onChange(fn),
});

/**
 * A vertical slider: a black slot with a small black cap and a white line. A transparent native range input
 * sits over it, so pointer, keyboard and screen readers all work. Its size comes from the CSS variables
 * --h (slot height), --cap and --w, so it can be fixed pixels on a phone and scale with the panel on a desktop.
 */
function slider(m: SliderModel, section: string): HTMLElement {
  const wrap = el('div', 'duo-slider');
  wrap.append(el('div', 'duo-slider-track'));
  const cap = el('div', 'duo-slider-cap');
  cap.append(el('span'));
  wrap.append(cap);
  const input = el('input', 'duo-slider-input');
  input.type = 'range';
  input.min = '0';
  input.max = String(m.steps);
  input.step = '1';
  input.setAttribute('aria-label', `${section} ${m.label}`);
  input.setAttribute('aria-orientation', 'vertical');
  const sync = () => {
    wrap.style.setProperty('--t', String(m.get() / m.steps));
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
  wrap.append(input);
  return wrap;
}

// ---------------------------------------------------------------- toggles

interface ToggleModel {
  /** Names of the positions, first to last (up to down, or left to right). */
  positions: readonly string[];
  aria: string;
  get: () => number;
  set: (i: number) => void;
  subscribe: (fn: () => void) => void;
}

const toggleModel = (c: ToggleControl, aria: string, positions: readonly string[] = ['off', 'on']): ToggleModel => ({
  positions, aria, get: () => (c.value ? 1 : 0), set: (i) => c.set(i === 1), subscribe: (fn) => void c.onChange(fn),
});
const choiceToggle = (c: ChoiceControl, aria: string): ToggleModel => ({
  positions: c.options, aria, get: () => c.options.indexOf(c.value), set: (i) => c.set(c.options[i]!), subscribe: (fn) => void c.onChange(fn),
});

/** A small metal toggle lever: `vertical` ones point up or down, `horizontal` ones tilt left, centre or right. */
function metalToggle(m: ToggleModel, vertical: boolean): HTMLElement {
  const b = el('button', 'duo-toggle');
  b.type = 'button';
  b.setAttribute('role', 'switch');
  b.setAttribute('aria-label', m.aria);
  b.append(el('i'));
  const last = m.positions.length - 1;
  const sync = () => {
    const i = m.get();
    const angle = vertical ? (i === 0 ? 0 : 180) : -35 + (70 * i) / last;
    b.style.setProperty('--a', `${angle}deg`);
    b.setAttribute('aria-checked', String(i > 0));
    b.title = `${m.aria}: ${m.positions[i]}`;
  };
  b.addEventListener('click', () => {
    m.set((m.get() + 1) % m.positions.length);
    sync();
  });
  m.subscribe(sync);
  sync();
  return b;
}

function led(on: () => boolean, subscribe: (fn: () => void) => void): HTMLElement {
  const l = el('i', 'duo-led');
  l.setAttribute('aria-hidden', 'true');
  const sync = () => l.classList.toggle('on', on());
  subscribe(sync);
  sync();
  return l;
}

// ---------------------------------------------------------------- the panel

const place = (child: HTMLElement, cx: number, cy: number, w: number, h = w): HTMLElement => {
  child.classList.add('duo-placed');
  child.style.left = `${(((cx - w / 2 - DUO_VIEWBOX.x) / DUO_VIEWBOX.w) * 100).toFixed(3)}%`;
  child.style.top = `${(((cy - h / 2 - DUO_VIEWBOX.y) / DUO_VIEWBOX.h) * 100).toFixed(3)}%`;
  child.style.width = `${((w / DUO_VIEWBOX.w) * 100).toFixed(3)}%`;
  child.style.height = `${((h / DUO_VIEWBOX.h) * 100).toFixed(3)}%`;
  return child;
};
/** Photo pixels as container-width units, for sizes inside a placed control. */
const cq = (px: number): string => `${((px / DUO_VIEWBOX.w) * 100).toFixed(3)}cqw`;

/** The MOA-DUO front panel: the photo-faithful layout on wide screens, stacked sections on narrow ones. */
export function renderDuoPanel(d: DuoSynth, engine?: AudioEngine): HTMLElement {
  const root = el('div', 'duo-case');
  root.insertAdjacentHTML('afterbegin', DEFS); // static markup, no user data
  const desktop = buildDesktop(d);
  const mobile = buildMobile(d);
  root.append(desktop, mobile);

  // The LED beside the patch display flashes with the oscillators' gate.
  if (engine) {
    const lights = [...root.querySelectorAll<HTMLElement>('.duo-gate-led')];
    const tick = () => {
      const open = engine.readDuo('duo', 'synth')?.gate === true;
      for (const l of lights) l.classList.toggle('on', open);
      requestAnimationFrame(tick);
    };
    requestAnimationFrame(tick);
  }
  return root;
}

/** The patch display and its buttons (shared by both layouts). */
function patchStrip(d: DuoSynth, cls: string): { name: HTMLElement; buttons: HTMLElement[] } {
  const name = el('div', `duo-patch-name ${cls}`);
  name.setAttribute('role', 'status');
  name.setAttribute('aria-label', 'Patch');
  let flash = false;
  const paint = () => {
    name.textContent = `${String(d.currentSlot + 1).padStart(2, '0')}  ${d.currentPreset.name}${flash ? '  SAVED' : ''}`;
  };
  d.onPresetChange(paint);
  paint();
  const button = (text: string, aria: string, click: () => void): HTMLElement => {
    const b = el('button', 'duo-patch-btn', text);
    b.type = 'button';
    b.setAttribute('aria-label', aria);
    b.addEventListener('click', click);
    return b;
  };
  const step = (delta: number) => d.loadSlot((d.currentSlot + delta + d.slots.length) % d.slots.length);
  return {
    name,
    buttons: [
      button('<', 'Previous patch', () => step(-1)),
      button('>', 'Next patch', () => step(1)),
      button('SAVE', 'Save the panel into this patch slot', () => {
        persistPatch(d.currentSlot, d.saveSlot(d.currentSlot));
        flash = true;
        paint();
        window.setTimeout(() => {
          flash = false;
          paint();
        }, 1500);
      }),
    ],
  };
}

function buildDesktop(d: DuoSynth): HTMLElement {
  const root = el('div', 'duo-desktop');
  root.insertAdjacentHTML('afterbegin', DUO_DECOR); // static markup, no user data
  const add = (e: HTMLElement) => root.append(e);

  // routing knobs, with clickable labels over the printed strips
  add(place(choiceKnob(choice(d, 'route.vco'), 'Routing', 'VCO'), 172, 190, 135));
  add(place(choiceKnob(choice(d, 'route.vcf'), 'Routing', 'VCF'), 543, 185, 112));
  add(place(choiceKnob(choice(d, 'route.mod'), 'Routing', 'Mod root'), 748, 672, 128));
  const strip = (c: ChoiceControl, x: number, ys: number[], right: boolean) => {
    c.options.forEach((o, i) => {
      const b = el('button', 'duo-pick');
      b.type = 'button';
      b.setAttribute('aria-label', `${c.label} ${o}`);
      b.addEventListener('click', () => c.set(o));
      const paint = () => b.classList.toggle('on', c.value === o);
      c.onChange(paint);
      paint();
      add(place(b, x, ys[i]!, 74, 34));
      void right;
    });
  };
  strip(choice(d, 'route.vco'), 312, [148, 185, 222, 261], false);
  strip(choice(d, 'route.vcf'), 402, [148, 185, 222, 261], false);
  strip(choice(d, 'route.mod'), 866, [615, 656, 695, 734], true);

  // reverb and settings
  add(place(knob(num(d, 'reverb.time'), 'Reverb', 'Time'), 750, 168, 105));
  add(place(knob(num(d, 'reverb.decay'), 'Reverb', 'Decay'), 950, 165, 110));
  add(place(knob(num(d, 'reverb.mix'), 'Reverb', 'Mix'), 1145, 168, 110));
  add(place(metalToggle(toggleModel(toggle(d, 'play.legato'), 'Legato', ['off', 'legato']), true), 1310, 190, 44));
  add(place(metalToggle(choiceToggle(choice(d, 'play.mode'), 'Mode, mono or duo'), true), 1420, 190, 44));
  add(place(metalToggle(toggleModel(toggle(d, 'play.channel'), 'MIDI channel, omni or locked', ['omni', 'chan']), true), 1527, 190, 44));

  // oscillators, tune and vibrato
  add(place(metalToggle(choiceToggle(choice(d, 'osc1.octave'), 'Oscillator 1 octave'), false), 150, 400, 44));
  add(place(metalToggle(choiceToggle(choice(d, 'osc2.octave'), 'Oscillator 2 octave'), false), 527, 400, 44));
  add(place(knob(num(d, 'tune'), 'Oscillator 2', 'Tune'), 355, 445, 215));
  add(place(metalToggle(toggleModel(toggle(d, 'sync'), 'Oscillator sync'), false), 352, 652, 44));
  add(place(led(() => toggle(d, 'sync').value, (fn) => void toggle(d, 'sync').onChange(fn)), 355, 740, 16));
  add(place(metalToggle(choiceToggle(choice(d, 'osc1.wave'), 'Oscillator 1 wave'), true), 213, 925, 44));
  add(place(metalToggle(choiceToggle(choice(d, 'osc2.wave'), 'Oscillator 2 wave'), true), 493, 925, 44));
  const sl = (id: string, section: string, label: string, cx: number, top: number, bottom: number) => {
    const s = slider(numberSlider(num(d, id), label), section);
    s.style.setProperty('--h', cq(bottom - top));
    s.style.setProperty('--w', cq(40));
    s.style.setProperty('--cap', cq(34));
    add(place(s, cx, (top + bottom) / 2, 40, bottom - top));
  };
  sl('osc1.pw', 'Oscillator 1', 'Pulse width', 128, 480, 715);
  sl('osc1.glide', 'Oscillator 1', 'Glide', 225, 480, 715);
  sl('osc2.detune', 'Oscillator 2', 'Detune', 485, 480, 715);
  sl('osc2.glide', 'Oscillator 2', 'Glide', 579, 480, 715);
  sl('osc1.level', 'Oscillator 1', 'Level', 128, 805, 1040);
  sl('vib.rate', 'Vibrato', 'Rate', 307, 805, 1040);
  sl('vib.level', 'Vibrato', 'Level', 403, 805, 1040);
  sl('osc2.level', 'Oscillator 2', 'Level', 579, 805, 1040);

  // filter and modulators
  add(place(knob(num(d, 'filter.cutoff'), 'Filter', 'Cutoff'), 793, 445, 200));
  sl('filter.post', 'Filter', 'Post', 1060, 420, 655);
  sl('filter.res', 'Filter', 'Resonance', 1155, 420, 655);
  const mod = (n: '1' | '2', riseX: number, holdX: number, lfoX: number, holdLedX: number) => {
    const id = `mod${n}`;
    const name = `Modulator ${n}`;
    sl(`${id}.rise`, name, 'Rise', riseX, 805, 1040);
    sl(`${id}.fall`, name, 'Fall', riseX + 95, 805, 1040);
    sl(`${id}.level`, name, 'Level', riseX + 190, 805, 1040);
    add(place(metalToggle(toggleModel(toggle(d, `${id}.hold`), `${name} hold`), true), holdX, 830, 44));
    add(place(metalToggle(toggleModel(toggle(d, `${id}.lfo`), `${name} LFO`), true), lfoX, 1025, 44));
    add(place(led(() => toggle(d, `${id}.hold`).value, (fn) => void toggle(d, `${id}.hold`).onChange(fn)), holdLedX, 922, 16));
  };
  mod('1', 778, 698, 698, 698);
  mod('2', 1065, 1340, 1340, 1331);

  // VCA
  add(place(knob(num(d, 'vca.level'), 'VCA', 'Level'), 1440, 500, 215));
  add(place(metalToggle(toggleModel(toggle(d, 'vca.hold'), 'VCA hold'), false), 1310, 686, 44));
  add(place(metalToggle(toggleModel(toggle(d, 'vca.lfo'), 'VCA LFO'), false), 1523, 686, 44));
  sl('vca.rise', 'VCA', 'Rise', 1441, 805, 1040);
  sl('vca.fall', 'VCA', 'Fall', 1537, 805, 1040);

  // the right panel: noise and patches (the hardware's jacks are left out)
  add(place(knob(num(d, 'noise'), 'Noise', 'Noise', true), 1768, 350, 70));
  const patch = patchStrip(d, 'duo-patch-desktop');
  add(place(patch.name, 1768, 652, 284, 84));
  add(place(patch.buttons[0]!, 1668, 752, 78, 56));
  add(place(patch.buttons[1]!, 1768, 752, 78, 56));
  add(place(patch.buttons[2]!, 1862, 752, 96, 56));
  const gateLed = led(() => d.heldNotes.length > 0, (fn) => void d.onNoteChange(fn));
  gateLed.classList.add('duo-gate-led');
  add(place(gateLed, 1768, 1030, 22));
  return root;
}

function buildMobile(d: DuoSynth): HTMLElement {
  const root = el('div', 'duo-mobile');

  const card = (title: string, ...children: HTMLElement[]): HTMLElement => {
    const c = el('section', 'duo-card');
    c.append(el('h2', 'duo-card-title', title), ...children);
    return c;
  };
  const row = (cls: string, ...children: HTMLElement[]): HTMLElement => {
    const r = el('div', cls);
    r.append(...children);
    return r;
  };
  const labelled = (text: string, child: HTMLElement): HTMLElement => {
    const w = el('div', 'duo-item');
    w.append(child, el('span', 'duo-item-label', text));
    return w;
  };
  const sl = (id: string, section: string, label: string): HTMLElement => labelled(label, slider(numberSlider(num(d, id), label), section));
  const kn = (id: string, section: string, label: string, dark = false): HTMLElement => {
    const k = knob(num(d, id), section, label, dark);
    return k;
  };
  const sw = (m: ToggleModel, vertical: boolean, top: string, bottom: string): HTMLElement => {
    const w = el('div', 'duo-item duo-item-switch');
    w.append(el('span', 'duo-item-label', top), metalToggle(m, vertical), el('span', 'duo-item-label', bottom));
    return w;
  };
  const segmented = (c: ChoiceControl, label: string): HTMLElement => {
    const w = el('div', 'duo-segmented');
    w.setAttribute('role', 'group');
    w.setAttribute('aria-label', label);
    w.append(el('span', 'duo-segmented-name', label));
    const buttons = c.options.map((o) => {
      const b = el('button', 'duo-pick', o.toUpperCase());
      b.type = 'button';
      b.addEventListener('click', () => c.set(o));
      w.append(b);
      return [o, b] as const;
    });
    const paint = () => buttons.forEach(([o, b]) => {
      b.classList.toggle('on', c.value === o);
      b.setAttribute('aria-pressed', String(c.value === o));
    });
    c.onChange(paint);
    paint();
    return w;
  };

  const patch = patchStrip(d, 'duo-patch-mobile');
  const noiseKnob = labelled('NOISE', kn('noise', 'Noise', 'Noise', true));
  const patchRow = row('duo-patch-row', patch.buttons[0]!, patch.name, patch.buttons[1]!, patch.buttons[2]!);
  const gateLed = led(() => d.heldNotes.length > 0, (fn) => void d.onNoteChange(fn));
  gateLed.classList.add('duo-gate-led');
  root.append(
    patchRow,
    card('ROUTING', segmented(choice(d, 'route.vco'), 'VCO'), segmented(choice(d, 'route.vcf'), 'VCF'), segmented(choice(d, 'route.mod'), 'MOD')),
    card('OSC 1', segmented(choice(d, 'osc1.octave'), 'OCT'), row('duo-row',
      sw(choiceToggle(choice(d, 'osc1.wave'), 'Oscillator 1 wave'), true, 'SAW', 'SQUARE'),
      sl('osc1.pw', 'Oscillator 1', 'PW'), sl('osc1.glide', 'Oscillator 1', 'GLD'), sl('osc1.level', 'Oscillator 1', 'LVL'))),
    card('OSC 2', segmented(choice(d, 'osc2.octave'), 'OCT'), row('duo-row',
      sw(choiceToggle(choice(d, 'osc2.wave'), 'Oscillator 2 wave'), true, 'SAW', 'TRI'),
      sl('osc2.detune', 'Oscillator 2', 'DTN'), sl('osc2.glide', 'Oscillator 2', 'GLD'), sl('osc2.level', 'Oscillator 2', 'LVL'))),
    card('TUNE & VIBRATO', row('duo-row',
      labelled('TUNE', kn('tune', 'Oscillators', 'Tune')),
      sw(toggleModel(toggle(d, 'sync'), 'Oscillator sync'), false, 'SYNC OFF', 'ON'),
      sl('vib.rate', 'Vibrato', 'RATE'), sl('vib.level', 'Vibrato', 'LVL'), noiseKnob)),
    card('DUAL FILTER',
      row('duo-row', labelled('CUTOFF', kn('filter.cutoff', 'Filter', 'Cutoff')), sl('filter.post', 'Filter', 'POST'), sl('filter.res', 'Filter', 'RES')),
      ...(['1', '2'] as const).map((n) => {
        const id = `mod${n}`;
        const name = `Modulator ${n}`;
        const box = el('div', 'duo-sub');
        box.append(el('h3', 'duo-sub-title', `MOD ${n}`), row('duo-row',
          sw(toggleModel(toggle(d, `${id}.hold`), `${name} hold`), true, 'OFF', 'HOLD'),
          sw(toggleModel(toggle(d, `${id}.lfo`), `${name} LFO`), true, 'ENV', 'LFO'),
          sl(`${id}.rise`, name, 'RISE'), sl(`${id}.fall`, name, 'FALL'), sl(`${id}.level`, name, 'LVL')));
        return box;
      })),
    card('VCA', row('duo-row',
      labelled('LEVEL', kn('vca.level', 'VCA', 'Level')),
      sw(toggleModel(toggle(d, 'vca.hold'), 'VCA hold'), true, 'OFF', 'HOLD'),
      sw(toggleModel(toggle(d, 'vca.lfo'), 'VCA LFO'), true, 'ENV', 'LFO'),
      sl('vca.rise', 'VCA', 'RISE'), sl('vca.fall', 'VCA', 'FALL'))),
    card('REVERB', row('duo-row', labelled('TIME', kn('reverb.time', 'Reverb', 'Time')), labelled('DECAY', kn('reverb.decay', 'Reverb', 'Decay')), labelled('MIX', kn('reverb.mix', 'Reverb', 'Mix')))),
    card('SETTINGS', row('duo-row',
      sw(toggleModel(toggle(d, 'play.legato'), 'Legato', ['off', 'legato']), true, 'OFF', 'LEG'),
      sw(choiceToggle(choice(d, 'play.mode'), 'Mode, mono or duo'), true, 'MONO', 'DUO'),
      sw(toggleModel(toggle(d, 'play.channel'), 'MIDI channel, omni or locked', ['omni', 'chan']), true, 'OMNI', 'CHAN'),
      row('duo-led-item', gateLed, el('span', 'duo-item-label', 'GATE')))),
  );
  return root;
}
