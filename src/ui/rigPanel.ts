import type { Control } from '../domain/devices/controls';
import { RIG_DESTS, RIG_SOURCES, type RigDest, type RigSource } from '../domain/devices/rigParams';
import { RIG_PARTS, type RigSynth } from '../domain/devices/rigSynth';
import { el, renderKnob } from './widgets';

/**
 * The MOA-RIG's first panel: every control of the edited part and side in the SYNTH page's sections, the sixteen
 * part buttons, the part's setup (voices, channel, octave, key range), a sound picker, A/B, and the mod routings as
 * a list. Plain on purpose: it is for hearing the engine; the designed panel (MOD mode, the detail column) replaces it.
 */
const SECTIONS: [title: string, colour: string, ids: string[]][] = [
  ['OSC 1', '#ffb84d', ['osc1.oct', 'osc1.tune', 'osc1.width', 'osc1.blend', 'osc1.sub']],
  ['OSC 2', '#ffb84d', ['osc2.oct', 'osc2.tune', 'osc2.width', 'osc2.blend', 'osc2.sync']],
  ['OSC 3', '#ffb84d', ['osc3.table', 'osc3.oct', 'osc3.tune', 'osc3.pos', 'osc3.interp']],
  ['MIX', '#ffb84d', ['mix.osc1', 'mix.osc2', 'mix.osc3', 'mix.noise', 'noise.type']],
  ['LADDER', '#ff8466', ['lad.cutoff', 'lad.res', 'lad.eg1', 'filter.key', 'drive', 'overdrive']],
  ['SEM', '#ff8466', ['filter.route', 'sem.cutoff', 'sem.res', 'sem.mode', 'sem.eg1', 'sem.bp']],
  ['EG 1', '#5fdccb', ['eg1.a', 'eg1.d', 'eg1.s', 'eg1.r', 'eg1.level', 'eg1.reset']],
  ['EG 2', '#5fdccb', ['eg2.a', 'eg2.d', 'eg2.s', 'eg2.r', 'eg2.level', 'eg2.reset', 'eg2.drone']],
  ['LFO 1', '#ffd84a', ['lfo1.rate', 'lfo1.level', 'lfo1.shape', 'lfo1.sync', 'lfo1.div', 'lfo1.retrig']],
  ['LFO 2', '#ffd84a', ['lfo2.rate', 'lfo2.level', 'lfo2.shape', 'lfo2.sync', 'lfo2.div', 'lfo2.retrig']],
  ['OUTPUT', '#ecece6', ['out.level', 'out.pan', 'out.spin', 'out.morph']],
  ['VOICE', '#ecece6', ['voice.mode', 'voice.unison', 'voice.detune', 'voice.glide', 'voice.bend', 'panner.mode', 'panner.width', 'mod.time']],
];

/** The label inside a section, without the section's name. */
const shortLabel = (c: Control): string =>
  c.id.startsWith('mix.') ? c.label.replace(/ level$/, '') : c.label.replace(/^(EG [12]|Ladder|SEM|OSC [123]|Noise|Panner|Unison|Filter) /, '') || c.label;

const NOTE_NAMES = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B'];
const noteName = (n: number) => `${NOTE_NAMES[n % 12]}${Math.floor(n / 12) - 1}`;

function renderChoice(c: Extract<Control, { kind: 'choice' }>, section: string): HTMLElement {
  const wrap = el('label', 'rig-choice');
  wrap.append(el('span', 'knob-label', shortLabel(c)));
  const select = el('select');
  select.setAttribute('aria-label', `${section} ${c.label}`);
  for (const o of c.options) select.add(new Option(o, o));
  const sync = () => { select.value = c.value; };
  select.addEventListener('change', () => c.set(select.value));
  c.onChange(sync);
  sync();
  wrap.append(select);
  return wrap;
}

function renderToggle(c: Extract<Control, { kind: 'toggle' }>, section: string): HTMLElement {
  const wrap = el('div', 'rig-toggle');
  const button = el('button', 'rig-key');
  button.type = 'button';
  button.setAttribute('aria-label', `${section} ${c.label}`);
  const sync = () => {
    button.classList.toggle('on', c.value);
    button.setAttribute('aria-pressed', String(c.value));
  };
  button.addEventListener('click', () => c.set(!c.value));
  c.onChange(sync);
  sync();
  wrap.append(button, el('span', 'knob-label', shortLabel(c)));
  return wrap;
}

export function renderRigPanel(rig: RigSynth): HTMLElement {
  const panel = el('div', 'rig-panel');

  // ---- the sixteen parts
  const partRow = el('div', 'rig-parts');
  const partButtons = Array.from({ length: RIG_PARTS }, (_, p) => {
    const b = el('button', 'rig-part');
    b.type = 'button';
    b.addEventListener('click', () => rig.selectPart(p));
    partRow.append(b);
    return b;
  });

  // ---- the edited part's setup and sound
  const setup = el('div', 'rig-setup');
  const sound = el('select');
  sound.setAttribute('aria-label', 'Sound');
  rig.slots.forEach((s, i) => sound.add(new Option(s.name, String(i))));
  sound.addEventListener('change', () => rig.loadSlot(Number(sound.value)));
  const voices = el('output', 'rig-readout');
  const less = el('button', 'rig-small', '−');
  const more = el('button', 'rig-small', '+');
  less.setAttribute('aria-label', 'Fewer voices');
  more.setAttribute('aria-label', 'More voices');
  less.addEventListener('click', () => rig.setVoices(rig.part, rig.parts[rig.part]!.voices - 1));
  more.addEventListener('click', () => rig.setVoices(rig.part, rig.parts[rig.part]!.voices + 1));
  const channel = el('select');
  channel.setAttribute('aria-label', 'MIDI channel');
  channel.add(new Option('All', '0'));
  for (let ch = 1; ch <= 16; ch++) channel.add(new Option(String(ch), String(ch)));
  channel.addEventListener('change', () => rig.setPartSetting(rig.part, 'channel', Number(channel.value)));
  const octave = el('select');
  octave.setAttribute('aria-label', 'Octave');
  for (let o = -2; o <= 2; o++) octave.add(new Option(o > 0 ? `+${o}` : String(o), String(o)));
  octave.addEventListener('change', () => rig.setPartSetting(rig.part, 'octave', Number(octave.value)));
  const range = (setting: 'lo' | 'hi', label: string) => {
    const s = el('select');
    s.setAttribute('aria-label', label);
    for (let n = 0; n <= 127; n++) s.add(new Option(noteName(n), String(n)));
    s.addEventListener('change', () => rig.setPartSetting(rig.part, setting, Number(s.value)));
    return s;
  };
  const lo = range('lo', 'Lowest note'), hi = range('hi', 'Highest note');
  const sideA = el('button', 'rig-key rig-side', 'A');
  const sideB = el('button', 'rig-key rig-side', 'B');
  sideA.addEventListener('click', () => rig.selectSide('a'));
  sideB.addEventListener('click', () => rig.selectSide('b'));
  const copy = el('button', 'rig-small rig-wide', 'COPY TO OTHER SIDE');
  copy.addEventListener('click', () => rig.copySide());
  const field = (label: string, ...nodes: HTMLElement[]) => {
    const f = el('div', 'rig-field');
    f.append(el('span', 'knob-label', label), ...nodes);
    return f;
  };
  setup.append(
    field('Sound', sound), field('Voices', less, voices, more), field('Channel', channel), field('Octave', octave),
    field('Range', lo, hi), field('Side', sideA, sideB, copy),
  );

  // ---- the sections
  const grid = el('div', 'rig-grid');
  for (const [title, colour, ids] of SECTIONS) {
    const sec = el('section', 'rig-section');
    sec.style.setProperty('--rig-accent', colour);
    sec.append(el('h3', 'rig-title', title));
    const body = el('div', 'rig-controls');
    for (const id of ids) {
      const c = rig.control(id);
      if (c.kind === 'number') body.append(renderKnob(c, title, shortLabel(c), 34));
      else if (c.kind === 'choice') body.append(renderChoice(c, title));
      else if (c.kind === 'toggle') body.append(renderToggle(c, title));
    }
    sec.append(body);
    grid.append(sec);
  }

  // ---- mod routings of the edited side
  const mod = el('section', 'rig-section rig-mod');
  mod.style.setProperty('--rig-accent', '#ffd84a');
  mod.append(el('h3', 'rig-title', 'MOD ROUTINGS'));
  const list = el('div', 'rig-routes');
  const add = el('button', 'rig-small rig-wide', 'ADD ROUTING');
  add.addEventListener('click', () => rig.setRoutes([...rig.routes, { source: 'lfo1', dest: 'lad.cutoff', amount: 0 }]));
  mod.append(list, add);

  const renderRoutes = () => {
    list.replaceChildren();
    rig.routes.forEach((r, i) => {
      const row = el('div', 'rig-route');
      const src = el('select');
      src.setAttribute('aria-label', `Routing ${i + 1} source`);
      for (const s of RIG_SOURCES) src.add(new Option(s.toUpperCase(), s, false, s === r.source));
      const dst = el('select');
      dst.setAttribute('aria-label', `Routing ${i + 1} destination`);
      for (const [d] of RIG_DESTS) dst.add(new Option(d, d, false, d === r.dest));
      const amt = el('input');
      amt.type = 'range';
      amt.min = '-1'; amt.max = '1'; amt.step = '0.005';
      amt.value = String(r.amount);
      amt.setAttribute('aria-label', `Routing ${i + 1} amount`);
      const readout = el('output', 'rig-readout', r.amount.toFixed(3));
      const del = el('button', 'rig-small', '×');
      del.setAttribute('aria-label', `Remove routing ${i + 1}`);
      const write = () => {
        const routes = rig.routes.map((x) => ({ ...x }));
        routes[i] = { source: src.value as RigSource, dest: dst.value as RigDest, amount: Number(amt.value) };
        rig.setRoutes(routes);
        readout.textContent = Number(amt.value).toFixed(3);
      };
      src.addEventListener('change', write);
      dst.addEventListener('change', write);
      amt.addEventListener('input', write);
      del.addEventListener('click', () => { rig.setRoutes(rig.routes.filter((_, k) => k !== i)); renderRoutes(); });
      row.append(src, dst, amt, readout, del);
      list.append(row);
    });
  };
  add.addEventListener('click', renderRoutes);

  const sync = () => {
    rig.parts.forEach((pt, p) => {
      const b = partButtons[p]!;
      b.classList.toggle('selected', p === rig.part);
      b.classList.toggle('empty', pt.voices === 0);
      b.innerHTML = '';
      b.append(el('span', 'rig-part-num', String(p + 1)), el('span', 'rig-part-name', pt.voices > 0 ? pt.name || 'Part' : 'EMPTY'),
        el('span', 'rig-part-meta', `${pt.channel ? `CH ${pt.channel}` : 'ALL'} · ${pt.voices} V`));
      b.setAttribute('aria-pressed', String(p === rig.part));
    });
    const pt = rig.parts[rig.part]!;
    sound.value = String(pt.slot);
    voices.textContent = `${pt.voices} (${rig.freeVoices} free)`;
    channel.value = String(pt.channel);
    octave.value = String(pt.octave);
    lo.value = String(pt.lo);
    hi.value = String(pt.hi);
    sideA.classList.toggle('on', rig.side === 'a');
    sideB.classList.toggle('on', rig.side === 'b');
    renderRoutes();
  };
  rig.onPartChange(sync);
  sync();

  panel.append(partRow, setup, grid, mod);
  return panel;
}
