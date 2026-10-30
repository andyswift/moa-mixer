import type { Control } from '../domain/devices/controls';
import { RIG_DESTS, RIG_MACRO_AUX, RIG_SOURCES, type RigDest, type RigSource } from '../domain/devices/rigParams';
import type { RigMulti } from '../domain/devices/rigMulti';
import { RIG_PARTS, type RigSynth } from '../domain/devices/rigSynth';
import { renderRigKitPanel, type RigKitSource } from './rigKitPanel';
import { el, renderKnob } from './widgets';

/**
 * The MOA-RIG's first panel: every control of the edited part and side in the SYNTH page's sections, the sixteen
 * part buttons, the part's setup (voices, channel, octave, key range), a sound picker, A/B, and MOD mode: pick a
 * source and every knob it can reach shows and sets its amount on a ring.
 */
const DEST_IDS = new Set<string>(RIG_DESTS.map((d) => d[0]));
/** OSC 3 shows the wavetable's controls or the macro oscillator's, as its MODE says. */
const WAVETABLE_ONLY = new Set(['osc3.table', 'osc3.pos', 'osc3.interp']);
const MACRO_ONLY = new Set(['osc3.model', 'osc3.harm', 'osc3.timbre', 'osc3.morph', 'osc3.aux']);
const SECTIONS: [title: string, colour: string, ids: string[]][] = [
  ['OSC 1', '#ffb84d', ['osc1.oct', 'osc1.tune', 'osc1.width', 'osc1.blend', 'osc1.sub']],
  ['OSC 2', '#ffb84d', ['osc2.oct', 'osc2.tune', 'osc2.width', 'osc2.blend', 'osc2.sync']],
  ['OSC 3', '#ffb84d', ['osc3.mode', 'osc3.table', 'osc3.model', 'osc3.oct', 'osc3.tune', 'osc3.pos', 'osc3.harm', 'osc3.timbre', 'osc3.morph', 'osc3.aux', 'osc3.interp']],
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

export function renderChoice(c: Extract<Control, { kind: 'choice' }>, section: string): HTMLElement {
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

export function renderToggle(c: Extract<Control, { kind: 'toggle' }>, section: string): HTMLElement {
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

/** Where multis are kept (the page's storage): sixteen slots, and which one the working multi came from. */
export interface RigMultiStore {
  slot: number;
  names(): (string | undefined)[];
  load(slot: number): RigMulti | undefined;
  save(slot: number, multi: RigMulti): boolean;
}

export function renderRigPanel(rig: RigSynth, kits?: RigKitSource): HTMLElement {
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
  const fillSounds = () => {
    const factory = el('optgroup');
    factory.label = 'Factory';
    const saved = el('optgroup');
    saved.label = 'Saved';
    rig.slots.forEach((s, i) => (i < rig.factorySounds ? factory : saved).append(new Option(s.name, String(i))));
    sound.replaceChildren(factory, ...(saved.children.length ? [saved] : []));
  };
  sound.addEventListener('change', () => rig.loadSlot(Number(sound.value)));
  const kind = el('select');
  kind.setAttribute('aria-label', 'Part type');
  kind.add(new Option('Synth', 'synth'));
  kind.add(new Option('Kit', 'kit'));
  kind.addEventListener('change', () => rig.setKind(rig.part, kind.value as 'synth' | 'kit'));
  const partName = el('input', 'rig-name');
  partName.setAttribute('aria-label', 'Part name');
  partName.maxLength = 24;
  partName.addEventListener('input', () => rig.setPartName(rig.part, partName.value));
  const saveSound = el('button', 'rig-small rig-wide', 'SAVE SOUND');
  saveSound.type = 'button';
  saveSound.title = 'Save this part’s sound under the part’s name, for any part to load';
  saveSound.addEventListener('click', () => rig.saveSound(partName.value || rig.parts[rig.part]!.name));
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
  const synthOnly = [field('Sound', sound, saveSound), field('Voices', less, voices, more)];
  const sideField = field('Side', sideA, sideB, copy);
  setup.append(
    field('Type', kind), field('Name', partName), ...synthOnly, field('Channel', channel), field('Octave', octave),
    field('Range', lo, hi), sideField,
  );
  const kitPanel = renderRigKitPanel(rig, kits);

  // ---- MOD mode: pick a source, and every knob it can reach shows (and sets) that source's amount on a ring
  let modSource: RigSource | undefined;
  let lastSource: RigSource = 'lfo1';
  const rings = new Map<RigDest, HTMLElement>();
  const amountOf = (dest: RigDest) => rig.routes.find((r) => r.source === modSource && r.dest === dest)?.amount ?? 0;
  const setAmount = (dest: RigDest, amount: number) => {
    if (!modSource) return;
    const a = Math.round(Math.max(-1, Math.min(1, amount)) * 1000) / 1000;
    const routes = rig.routes.map((r) => ({ ...r }));
    const at = routes.findIndex((r) => r.source === modSource && r.dest === dest);
    if (Math.abs(a) < 0.005) { if (at >= 0) routes.splice(at, 1); }
    else if (at >= 0) routes[at]!.amount = a;
    else routes.push({ source: modSource, dest, amount: a });
    rig.setRoutes(routes);
    syncRings();
  };
  /** Puts a ring round a knob; in MOD mode the ring takes the drag (up and down), the wheel, and a double-click (none). */
  function withRing(knobWrap: HTMLElement, dest: RigDest): HTMLElement {
    const knob = knobWrap.querySelector<HTMLElement>('.knob');
    if (!knob) return knobWrap;
    const holder = el('span', 'rig-ringwrap');
    const ring = el('span', 'rig-ring');
    ring.setAttribute('role', 'slider');
    ring.setAttribute('aria-valuemin', '-1');
    ring.setAttribute('aria-valuemax', '1');
    ring.tabIndex = -1;
    knob.replaceWith(holder);
    holder.append(knob, ring);
    ring.addEventListener('pointerdown', (e) => {
      if (!modSource) return;
      e.preventDefault();
      const y0 = e.clientY, a0 = amountOf(dest);
      ring.setPointerCapture(e.pointerId);
      const move = (m: PointerEvent) => setAmount(dest, a0 + (y0 - m.clientY) / (m.shiftKey ? 600 : 150));
      const up = () => { ring.removeEventListener('pointermove', move); ring.removeEventListener('pointerup', up); };
      ring.addEventListener('pointermove', move);
      ring.addEventListener('pointerup', up);
    });
    ring.addEventListener('wheel', (e) => { if (!modSource) return; e.preventDefault(); setAmount(dest, amountOf(dest) + Math.sign(-e.deltaY) * 0.02); }, { passive: false });
    ring.addEventListener('dblclick', () => setAmount(dest, 0));
    ring.addEventListener('keydown', (e) => {
      if (!modSource || (e.key !== 'ArrowUp' && e.key !== 'ArrowDown')) return;
      e.preventDefault();
      setAmount(dest, amountOf(dest) + (e.key === 'ArrowUp' ? 1 : -1) * (e.shiftKey ? 0.1 : 0.02));
    });
    rings.set(dest, ring);
    return knobWrap;
  }
  function syncRings(): void {
    if (modSource) lastSource = modSource;
    // what is in use, without picking each source: a dot on a source with routings, a mark on a knob something moves
    const routes = rig.routes.filter((r) => r.amount !== 0);
    for (const [src, b] of sourceButtons) {
      b.classList.toggle('on', src === modSource);
      b.classList.toggle('used', routes.some((r) => r.source === src));
    }
    modMode.classList.toggle('on', !!modSource);
    panel.classList.toggle('modmode', !!modSource);
    for (const [dest, ring] of rings) {
      const a = modSource ? amountOf(dest) : 0;
      ring.style.setProperty('--amt', String(a));
      ring.classList.toggle('active', !!modSource);
      ring.classList.toggle('has', a !== 0);
      ring.classList.toggle('moved', !modSource && routes.some((r) => r.dest === dest));
      ring.tabIndex = modSource ? 0 : -1;
      ring.setAttribute('aria-label', `${modSource?.toUpperCase() ?? ''} to ${dest}`);
      ring.setAttribute('aria-valuenow', String(a));
      ring.title = modSource ? `${modSource.toUpperCase()} → ${dest}: ${a.toFixed(3)} (drag, wheel; double-click: none)` : '';
    }
  }

  // ---- the sections
  const modal: [string, HTMLElement][] = [];
  const showMode = () => {
    const isMacro = (rig.control('osc3.mode') as { value: string }).value === 'MACRO';
    for (const [id, node] of modal) node.hidden = MACRO_ONLY.has(id) ? !isMacro : isMacro;
    // OUT/AUX says what AUX is for the model
    const model = (rig.control('osc3.model') as { value: string }).value as keyof typeof RIG_MACRO_AUX;
    const auxLabel = modal.find(([id]) => id === 'osc3.aux')?.[1].querySelector('.knob-label');
    if (auxLabel) auxLabel.textContent = `OUT/${RIG_MACRO_AUX[model] ?? 'AUX'}`;
  };
  const grid = el('div', 'rig-grid');
  for (const [title, colour, ids] of SECTIONS) {
    const sec = el('section', 'rig-section');
    sec.style.setProperty('--rig-accent', colour);
    sec.append(el('h3', 'rig-title', title));
    const body = el('div', 'rig-controls');
    for (const id of ids) {
      const c = rig.control(id);
      let node: HTMLElement | undefined;
      if (c.kind === 'number') {
        const knob = renderKnob(c, title, shortLabel(c), 34);
        node = DEST_IDS.has(id) ? withRing(knob, id as RigDest) : knob;
      }
      else if (c.kind === 'choice') node = renderChoice(c, title);
      else if (c.kind === 'toggle') node = renderToggle(c, title);
      if (!node) continue;
      body.append(node);
      if (WAVETABLE_ONLY.has(id) || MACRO_ONLY.has(id)) modal.push([id, node]);
    }
    sec.append(body);
    grid.append(sec);
  }

  // ---- mod routings of the edited side
  const mod = el('section', 'rig-section rig-mod');
  mod.style.setProperty('--rig-accent', '#ffd84a');
  mod.append(el('h3', 'rig-title', 'MOD · PICK A SOURCE, EVERY KNOB SHOWS ITS AMOUNT'));
  const sourceRow = el('div', 'rig-mod-sources');
  const sourceButtons = RIG_SOURCES.map((src) => {
    const b = el('button', 'rig-key rig-mod-source', src.toUpperCase());
    b.type = 'button';
    b.setAttribute('aria-label', `Mod source ${src.toUpperCase()}`);
    b.addEventListener('click', () => { modSource = modSource === src ? undefined : src; syncRings(); });
    sourceRow.append(b);
    return [src, b] as const;
  });
  const modMode = el('button', 'rig-key rig-wide rig-mod-mode', 'MOD MODE');
  modMode.type = 'button';
  modMode.title = 'On while a source is picked: turning a ringed knob sets that source’s amount. Click to leave.';
  modMode.addEventListener('click', () => { modSource = modSource ? undefined : lastSource; syncRings(); });
  const reset = el('button', 'rig-small rig-wide', 'RESET SOURCE');
  reset.type = 'button';
  reset.title = 'Remove every routing from the picked source (on this side)';
  reset.addEventListener('click', () => { if (modSource) { const s0 = modSource; rig.setRoutes(rig.routes.filter((r) => r.source !== s0)); syncRings(); } });
  sourceRow.append(modMode, reset);
  mod.append(sourceRow);

  const sync = () => {
    rig.parts.forEach((pt, p) => {
      const b = partButtons[p]!;
      b.classList.toggle('selected', p === rig.part);
      b.innerHTML = '';
      const on = pt.voices > 0 || pt.kind === 'kit';
      b.classList.toggle('empty', !on);
      b.classList.toggle('kit', pt.kind === 'kit');
      b.append(el('span', 'rig-part-num', String(p + 1)), el('span', 'rig-part-name', on ? pt.name || 'Part' : 'EMPTY'),
        el('span', 'rig-part-meta', `${pt.channel ? `CH ${pt.channel}` : 'ALL'} · ${pt.kind === 'kit' ? 'KIT' : `${pt.voices} V`}`));
      b.setAttribute('aria-pressed', String(p === rig.part));
    });
    const pt = rig.parts[rig.part]!;
    const isKit = pt.kind === 'kit';
    kind.value = pt.kind;
    for (const n of [...synthOnly, sideField, grid, mod]) n.hidden = isKit;
    octave.disabled = isKit;
    kitPanel.hidden = !isKit;
    if (isKit) kitPanel.sync();
    if (sound.options.length !== rig.slots.length || [...sound.options].some((o, i) => o.text !== rig.slots[i]!.name)) fillSounds();
    sound.value = String(pt.slot);
    if (document.activeElement !== partName) partName.value = pt.name;
    voices.textContent = `${pt.voices} (${rig.freeVoices} free)`;
    channel.value = String(pt.channel);
    octave.value = String(pt.octave);
    lo.value = String(pt.lo);
    hi.value = String(pt.hi);
    sideA.classList.toggle('on', rig.side === 'a');
    sideB.classList.toggle('on', rig.side === 'b');
    syncRings();
    showMode();
  };
  rig.control('osc3.mode').onChange(showMode);
  rig.control('osc3.model').onChange(showMode);
  rig.onPartChange(sync);
  rig.onEdit(syncRings); // routings changed elsewhere: a loaded sound, the other side copied over
  sync();

  panel.append(partRow, setup, kitPanel, grid, mod);
  return panel;
}

/** The multi: its name, the slots it is saved in and loaded from, NEW, and whether MIDI follows the edited part. */
export function renderRigMultiBar(rig: RigSynth, store?: RigMultiStore): HTMLElement {
  // ---- the multi: its name, and the slots it is saved in and loaded from
  const multiBar = el('div', 'rig-setup rig-multi');
  const multiName = el('input', 'rig-name');
  multiName.setAttribute('aria-label', 'Multi name');
  multiName.maxLength = 24;
  multiName.addEventListener('input', () => { rig.multiName = multiName.value; });
  const slotSelect = el('select');
  slotSelect.setAttribute('aria-label', 'Multi slot');
  const fillSlots = () => {
    const names = store?.names() ?? [];
    slotSelect.replaceChildren(...Array.from({ length: 16 }, (_, i) => new Option(`${i + 1} · ${names[i] ?? '—'}`, String(i))));
    slotSelect.value = String(Math.max(0, store?.slot ?? 0));
  };
  const status = el('span', 'rig-multi-status');
  const say = (t: string) => { status.textContent = t; };
  const load = el('button', 'rig-small rig-wide', 'LOAD');
  load.addEventListener('click', () => {
    const slot = Number(slotSelect.value);
    const m = store?.load(slot);
    if (!m) { say(`Slot ${slot + 1} is empty`); return; }
    rig.loadMulti(m);
    if (store) store.slot = slot;
    say(`Loaded ${m.name} from slot ${slot + 1}`);
  });
  const save = el('button', 'rig-small rig-wide', 'SAVE');
  save.addEventListener('click', () => {
    const slot = Number(slotSelect.value);
    const names = store?.names() ?? [];
    if (names[slot] !== undefined && store?.slot !== slot && !confirm(`Replace ${names[slot]} in slot ${slot + 1}?`)) return;
    const ok = store?.save(slot, rig.toMulti()) ?? false;
    if (ok && store) store.slot = slot;
    fillSlots();
    say(ok ? `Saved ${rig.multiName} in slot ${slot + 1}` : 'Not saved: this browser is not keeping data for the page');
  });
  const fresh = el('button', 'rig-small rig-wide', 'NEW');
  fresh.addEventListener('click', () => {
    if (!confirm('Start a new multi? Save this one first if you want to keep it.')) return;
    rig.newMulti();
    if (store) store.slot = -1;
    say('New multi');
  });
  for (const b of [load, save, fresh]) b.type = 'button';
  const follow = el('button', 'rig-small rig-wide rig-follow', 'MIDI → EDITED PART');
  follow.type = 'button';
  follow.title = 'On: MIDI on any channel plays only the part being edited. Off: each part plays its own channel.';
  follow.addEventListener('click', () => { rig.midiToEdited = !rig.midiToEdited; });
  multiBar.append(el('span', 'knob-label', 'Multi'), multiName, slotSelect, load, save, fresh, status, follow);
  if (!store) multiBar.hidden = true;
  fillSlots();
  const sync = () => {
    if (document.activeElement !== multiName) multiName.value = rig.multiName;
    follow.classList.toggle('on', rig.midiToEdited);
    follow.setAttribute('aria-pressed', String(rig.midiToEdited));
  };
  rig.onPartChange(sync);
  sync();
  return multiBar;

}
