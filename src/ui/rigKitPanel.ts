import { NumberControl } from '../domain/devices/controls';
import { DECAY_OFF } from '../domain/devices/mpc60';
import { DRUM_NAMES, DRUM_SHORT, DRUM_VOICES, RIG_KITS, RIG_PAD_ORDER, RIG_PADS, rigDrumParams, type RigKit, type RigPad } from '../domain/devices/rigKit';
import type { RigSynth } from '../domain/devices/rigSynth';
import { el, renderKnob } from './widgets';

/** The page's kit sounds: the break kits it can cut from the MOA-60's kits, and the samples a pad can play. */
export interface RigKitSource {
  breakKits: readonly string[];
  loadBreakKit(name: string): Promise<RigKit | undefined>;
  samples: readonly (readonly [id: string, name: string])[];
}

/** A turned analogue knob is rendered once it rests this long (a render takes a moment). */
const RENDER_AFTER_MS = 120;
const SAMPLE_SECONDS = 12;

const button = (cls: string, text: string, label?: string) => {
  const b = el('button', cls, text);
  b.type = 'button';
  if (label) b.setAttribute('aria-label', label);
  return b;
};

const field = (label: string, ...nodes: HTMLElement[]) => {
  const f = el('label', 'rig-choice');
  f.append(el('span', 'knob-label', label), ...nodes);
  return f;
};

/**
 * A kit part's panel, in place of the synth's sections: the kit, its sixteen pads (press one to hear it and edit it),
 * and the selected pad: analogue (a MOA-DR voice and its knobs) or sample (a break, from where to where), then tune,
 * decay, level, pan, filter, mute group and reverse.
 */
export function renderRigKitPanel(rig: RigSynth, source?: RigKitSource): HTMLElement & { sync(): void } {
  const panel = el('section', 'rig-section rig-kit') as HTMLElement & { sync(): void };
  panel.style.setProperty('--rig-accent', '#ffa3c7');
  const title = el('h3', 'rig-title', 'KIT');
  const kitSelect = el('select');
  kitSelect.setAttribute('aria-label', 'Kit');
  const kits = el('optgroup');
  kits.label = 'Kits';
  RIG_KITS.forEach((k, i) => kits.append(new Option(k.name, `k${i}`)));
  const breaks = el('optgroup');
  breaks.label = 'Breaks';
  (source?.breakKits ?? []).forEach((name) => breaks.append(new Option(name, `b${name}`)));
  kitSelect.append(new Option('Load a kit…', ''), kits, ...(breaks.children.length ? [breaks] : []));
  const status = el('span', 'rig-multi-status');
  kitSelect.addEventListener('change', async () => {
    const v = kitSelect.value;
    kitSelect.value = '';
    const part = rig.part;
    if (v.startsWith('k')) rig.loadKit(part, RIG_KITS[Number(v.slice(1))]!);
    else if (v.startsWith('b') && source) {
      status.textContent = 'Loading…';
      const kit = await source.loadBreakKit(v.slice(1)).catch(() => undefined);
      status.textContent = kit ? '' : 'Could not load that kit';
      if (kit) rig.loadKit(part, kit);
    }
  });
  const head = el('div', 'rig-field');
  head.append(kitSelect, status);

  // ---- the pads: press to hear, and to edit
  const padRow = el('div', 'rig-kit-pads');
  const padButtons = Array.from({ length: RIG_PADS }, (_, i) => {
    const b = button('rig-kit-pad', '', `Pad ${i + 1}`);
    let down = false;
    b.addEventListener('pointerdown', () => { down = true; rig.selectPad(i); rig.keyDown(60 + i); });
    const up = () => { if (down) { down = false; rig.keyUp(60 + i); } };
    b.addEventListener('pointerup', up);
    b.addEventListener('pointerleave', up);
    b.addEventListener('keydown', (e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); rig.selectPad(i); rig.keyDown(60 + i); setTimeout(() => rig.keyUp(60 + i), 150); } });
    return b;
  });
  // shown in a drum machine's order (each pad keeps its note), numbered as they stand
  padRow.append(...RIG_PAD_ORDER.map((i) => padButtons[i]!));

  // ---- the selected pad (rebuilt when another pad, source or voice is chosen, not while its knobs turn)
  const editor = el('div', 'rig-controls rig-kit-editor');
  let shown = '';
  let shownPad: RigPad | undefined;
  let renderTimer: ReturnType<typeof setTimeout> | undefined;
  const pad = (): RigPad | undefined => rig.parts[rig.part]?.kit?.pads[rig.pad];
  const set = (changes: Partial<RigPad>) => rig.setPad(rig.part, rig.pad, changes);
  const knob = (id: string, label: string, min: number, max: number, value: number, unit: string, put: (v: number) => void, curve?: 'linear' | 'log', format?: (v: number) => string) =>
    renderKnob(new NumberControl(id, label, min, max, value, unit, (v) => { if (built) put(v); }, curve), 'Pad', label.toUpperCase(), 30, format);
  let built = false;

  function build(p: RigPad): void {
    built = false;
    const nodes: HTMLElement[] = [];
    const name = el('input', 'rig-name rig-kit-name');
    name.maxLength = 4;
    name.value = p.name;
    name.setAttribute('aria-label', 'Pad name');
    name.addEventListener('input', () => set({ name: name.value }));
    nodes.push(field('Name', name));
    const src = el('select');
    src.setAttribute('aria-label', 'Pad source');
    src.add(new Option('Analogue', 'analog'));
    src.add(new Option('Sample', 'sample'));
    src.value = p.src;
    src.addEventListener('change', () => set(src.value === 'sample'
      ? { src: 'sample', sound: p.sound || source?.samples[0]?.[0] || '', start: 0, end: 0 }
      : { src: 'analog', name: DRUM_SHORT[p.voice] }));
    nodes.push(field('Source', src));
    if (p.src === 'analog') {
      const voice = el('select');
      voice.setAttribute('aria-label', 'Pad voice');
      for (const v of DRUM_VOICES) voice.add(new Option(DRUM_NAMES[v], v));
      voice.value = p.voice;
      voice.addEventListener('change', () => { const v = voice.value as RigPad['voice']; set({ voice: v, analog: {}, name: DRUM_SHORT[v] }); });
      nodes.push(field('Voice', voice));
      // the MOA-DR's own knobs for the voice; a new sound is rendered once a knob rests
      const knobs: Record<string, number> = { ...p.analog };
      for (const d of rigDrumParams(p.voice)) {
        nodes.push(knob(`pad.${d.id}`, d.label, d.min, d.max, p.analog[d.id] ?? d.def, d.unit, (v) => {
          knobs[d.id] = v;
          clearTimeout(renderTimer);
          renderTimer = setTimeout(() => set({ analog: { ...knobs } }), RENDER_AFTER_MS);
        }, d.curve));
      }
    } else {
      const sample = el('select');
      sample.setAttribute('aria-label', 'Pad sample');
      for (const [id, n] of source?.samples ?? []) sample.add(new Option(n, id));
      if (![...sample.options].some((o) => o.value === p.sound)) sample.add(new Option(p.sound.split('/').pop() || '—', p.sound));
      sample.value = p.sound;
      sample.addEventListener('change', () => set({ sound: sample.value, start: 0, end: 0 }));
      nodes.push(field('Sample', sample));
      nodes.push(knob('pad.start', 'Start', 0, SAMPLE_SECONDS, p.start, 's', (v) => set({ start: v })));
      nodes.push(knob('pad.end', 'End', 0, SAMPLE_SECONDS, p.end, 's', (v) => set({ end: v }), undefined, (v) => (v <= 0 ? 'END' : `${v.toFixed(2)} s`)));
    }
    nodes.push(
      knob('pad.tune', 'Tune', -24, 24, p.tune, 'st', (v) => set({ tune: v })),
      knob('pad.decay', 'Decay', 0.01, DECAY_OFF, p.decay, 's', (v) => set({ decay: v }), 'log', (v) => (v >= DECAY_OFF - 0.01 ? 'FULL' : `${v.toFixed(2)} s`)),
      knob('pad.level', 'Level', 0, 1.5, p.level, '', (v) => set({ level: v })),
      knob('pad.pan', 'Pan', -1, 1, p.pan, '', (v) => set({ pan: v })),
      knob('pad.cutoff', 'Cutoff', 20, 20000, p.cutoff, 'Hz', (v) => set({ cutoff: v }), 'log'),
      knob('pad.reso', 'Resonance', 0, 1, p.reso, '', (v) => set({ reso: v })),
    );
    const group = el('select');
    group.setAttribute('aria-label', 'Pad mute group');
    group.add(new Option('none', '0'));
    for (let g = 1; g <= 8; g++) group.add(new Option(String(g), String(g)));
    group.value = String(p.group);
    group.addEventListener('change', () => set({ group: Number(group.value) }));
    nodes.push(field('Mute group', group));
    const reverse = button('rig-key', '', 'Pad reverse');
    reverse.classList.toggle('on', p.reverse);
    reverse.addEventListener('click', () => { set({ reverse: !pad()!.reverse }); reverse.classList.toggle('on', pad()!.reverse); });
    const rev = el('div', 'rig-toggle');
    rev.append(reverse, el('span', 'knob-label', 'Reverse'));
    nodes.push(rev);
    editor.replaceChildren(...nodes);
    built = true;
  }

  panel.sync = () => {
    const pt = rig.parts[rig.part]!;
    title.textContent = `KIT · ${pt.kit?.name ?? ''}`;
    pt.kit?.pads.forEach((p, i) => {
      const b = padButtons[i]!;
      b.replaceChildren(el('span', 'rig-kit-pad-num', String(RIG_PAD_ORDER.indexOf(i) + 1)), el('span', 'rig-kit-pad-name', p.name), el('span', 'rig-kit-pad-src', p.src === 'analog' ? 'ANA' : 'SMP'));
      b.classList.toggle('selected', i === rig.pad);
      b.classList.toggle('sample', p.src === 'sample');
    });
    const p = pad();
    const key = p ? `${rig.part}:${rig.pad}:${p.src}:${p.voice}:${p.sound}` : '';
    if (p && (key !== shown || p !== shownPad)) { clearTimeout(renderTimer); build(p); }
    shown = key;
    shownPad = p;
  };

  panel.append(title, head, padRow, editor);
  return panel;
}
