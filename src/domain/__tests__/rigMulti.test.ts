import { describe, expect, it } from 'vitest';
import type { CircuitChange } from '../circuit/circuit';
import type { NumberControl } from '../devices/controls';
import { sanitiseMulti, sanitiseSound } from '../devices/rigMulti';
import { RIG_PRESETS } from '../devices/rigPresets';
import { freshPart, RIG_VOICES, RigSynth } from '../devices/rigSynth';

/** A multi with something in every corner: a split, a saved sound, a pattern with locks, a chain. */
function busy(): RigSynth {
  const rig = new RigSynth();
  rig.multiName = 'Dub Session';
  rig.setVoices(0, 12);
  rig.selectPart(1);
  rig.setVoices(1, 8);
  rig.loadSlot(RIG_PRESETS.findIndex((p) => p.name === 'Acid Line'));
  rig.setPartSetting(1, 'channel', 2);
  rig.setPartSetting(1, 'lo', 36);
  rig.setPartName(1, 'Acid');
  rig.selectSide('b');
  (rig.control('lad.cutoff') as NumberControl).set(900);
  const t = rig.seq.patterns[3]!.tracks[1]!;
  t.length = 12;
  t.clock = 48;
  t.direction = 'pingpong';
  t.steps[5]!.notes = [36, 43];
  t.steps[5]!.locks = { 'lad.cutoff': 400 };
  rig.seq.patterns[3]!.length = 32;
  rig.seq.setChain([3, 4]);
  rig.seq.shuffle = 0.12;
  rig.bpm = 132;
  return rig;
}

describe('MOA-RIG multis', () => {
  it('come back exactly as saved, through JSON and the sanitiser', () => {
    const m = busy().toMulti();
    const back = sanitiseMulti(JSON.parse(JSON.stringify(m)), freshPart)!;
    expect(back).toEqual(m);
  });

  it('load into another synth: parts, sounds, patterns, chain, tempo, and the worklet hears it all', () => {
    const m = busy().toMulti();
    const rig = new RigSynth();
    const sent: { type: string; part?: number; counts?: number[]; bpm?: number }[] = [];
    rig.circuit.onChange((c: CircuitChange) => { if (c.type === 'message') sent.push(c.data as never); });
    rig.loadMulti(m);
    expect(rig.toMulti()).toEqual(m);
    expect(rig.multiName).toBe('Dub Session');
    expect(rig.part).toBe(0);
    expect(sent.find((x) => x.type === 'layout')!.counts!.slice(0, 3)).toEqual([12, 8, 0]);
    expect(new Set(sent.filter((x) => x.type === 'patch').map((x) => x.part)).size).toBe(16);
    expect(sent.find((x) => x.type === 'bpm')!.bpm).toBe(132);
    rig.selectPart(1);
    rig.selectSide('b');
    expect((rig.control('lad.cutoff') as NumberControl).value).toBe(900);
    const state = JSON.parse(rig.circuit.node('synth').options.state!) as { counts: number[] };
    expect(state.counts[1]).toBe(8);
  });

  it('load what they can from a damaged save, and never more voices than the pool', () => {
    const m = busy().toMulti() as unknown as Record<string, unknown>;
    const parts = m.parts as Record<string, unknown>[];
    parts[0]!.voices = RIG_VOICES - 4; // the two together ask for more than the pool has
    parts[1]!.voices = RIG_VOICES - 4;
    (parts[1]!.a as { params: Record<string, unknown> }).params = { 'lad.cutoff': 1e9, 'osc3.table': 2.7, 'no.such': 1, 'lad.res': 'loud' };
    (parts[1]!.a as { matrix: unknown[] }).matrix = [{ source: 'lfo1', dest: 'lad.cutoff', amount: 5 }, { source: 'nope', dest: 'lad.cutoff', amount: 1 }];
    parts[2] = 'junk' as never;
    const patterns = m.patterns as { tracks: { clock: unknown; steps: { notes: unknown[] }[] }[] }[];
    patterns[3]!.tracks[1]!.clock = 7;
    patterns[3]!.tracks[1]!.steps[5]!.notes = [36, 200, 'x', 43.5];
    m.chain = [3, 99];
    const back = sanitiseMulti(m, freshPart)!;
    expect(back.parts[1]!.a.params).toEqual({ 'lad.cutoff': 20000, 'osc3.table': 3 });
    expect(back.parts[1]!.a.matrix).toEqual([{ source: 'lfo1', dest: 'lad.cutoff', amount: 1 }]);
    expect(back.parts[2]).toEqual(freshPart(2));
    expect(back.patterns[3]!.tracks[1]!.clock).toBe(24);
    expect(back.patterns[3]!.tracks[1]!.steps[5]!.notes).toEqual([36]);
    expect(back.chain).toEqual([3]);
    const rig = new RigSynth();
    rig.loadMulti(back);
    expect(rig.parts.slice(0, 2).map((p) => p.voices)).toEqual([RIG_VOICES - 4, 4]);
    expect(sanitiseMulti({ name: 'x' }, freshPart)).toBeUndefined();
    expect(sanitiseMulti('{', freshPart)).toBeUndefined();
  });

  it('find a part’s sound again by name when the list of sounds has moved since the multi was saved', () => {
    const rig = new RigSynth();
    rig.saveSound('Mine');
    const m = rig.toMulti();
    expect(m.parts[0]!.sound).toBe('Mine');
    // another sound saved before it (as more factory sounds would be): 'Mine' is one slot further on
    const other = { name: 'Other', a: m.parts[0]!.a };
    const later = new RigSynth();
    later.setSavedSounds([other, ...rig.savedSounds]);
    later.loadMulti(sanitiseMulti(JSON.parse(JSON.stringify(m)), freshPart)!);
    expect(later.slots[later.parts[0]!.slot]!.name).toBe('Mine');
    // a save from before parts kept the name still loads by slot
    const old = JSON.parse(JSON.stringify(m)) as { parts: { sound?: string; slot: number }[] };
    delete old.parts[0]!.sound;
    later.loadMulti(sanitiseMulti(old, freshPart)!);
    expect(later.parts[0]!.slot).toBe(m.parts[0]!.slot);
  });

  it('save a part’s sound for any part to load, replacing a saved one of the same name but never a factory one', () => {
    const rig = new RigSynth();
    (rig.control('lad.cutoff') as NumberControl).set(700);
    const slot = rig.saveSound('Warm');
    expect(slot).toBe(rig.factorySounds);
    expect(rig.parts[0]!.name).toBe('Warm');
    (rig.control('lad.cutoff') as NumberControl).set(800);
    expect(rig.saveSound('Warm')).toBe(slot);
    expect(rig.saveSound('Init')).toBe(slot + 1); // a factory name makes a new saved sound
    expect(rig.slots[0]!.a.params['lad.cutoff']).toBeUndefined();
    rig.selectPart(4);
    rig.loadSlot(slot);
    expect(rig.parts[4]!.a.params['lad.cutoff']).toBe(800);
    expect(rig.savedSounds.map((s) => s.name)).toEqual(['Warm', 'Init']);
    expect(sanitiseSound(JSON.parse(JSON.stringify(rig.savedSounds[0])))).toEqual(rig.savedSounds[0]);
    expect(sanitiseSound({ name: '' })).toBeUndefined();
  });

  it('tell the page about every change worth saving', () => {
    const rig = new RigSynth();
    let edits = 0;
    rig.onEdit(() => edits++);
    const changes: (() => void)[] = [
      () => (rig.control('lad.res') as NumberControl).set(0.4),
      () => rig.setRoutes([{ source: 'lfo1', dest: 'lad.cutoff', amount: 0.2 }]),
      () => rig.copySide(),
      () => rig.setVoices(0, 10),
      () => rig.setPartSetting(0, 'octave', 1),
      () => rig.setPartName(0, 'Lead'),
      () => { rig.bpm = 100; },
      () => { rig.multiName = 'Live'; },
      () => rig.saveSound('Lead'),
    ];
    for (const change of changes) {
      const before = edits;
      change();
      expect(edits, change.toString()).toBeGreaterThan(before);
    }
  });

  it('start over with NEW', () => {
    const rig = busy();
    rig.newMulti();
    expect(rig.toMulti()).toEqual(new RigSynth().toMulti());
  });

  it('keep the mix: the desk’s controls go to the worklet, into its state, and into the multi (not the throws)', () => {
    const rig = new RigSynth();
    const sent: { type: string; id?: string; value?: number }[] = [];
    rig.circuit.onChange((c: CircuitChange) => { if (c.type === 'message') sent.push(c.data as never); });
    (rig.deskControl('p3.fader') as NumberControl).set(0.5);
    (rig.deskControl('rev.type') as unknown as { set(v: string): void }).set('HALL');
    (rig.deskControl('rA.throw') as unknown as { set(v: boolean): void }).set(true);
    expect(sent.filter((m) => m.type === 'mix')).toEqual([
      { type: 'mix', id: 'p3.fader', value: 0.5 }, { type: 'mix', id: 'rev.type', value: 2 }, { type: 'mix', id: 'rA.throw', value: 1 },
    ]);
    expect(JSON.parse(rig.circuit.node('synth').options.state!).mix['p3.fader']).toBe(0.5);
    const m = sanitiseMulti(JSON.parse(JSON.stringify(rig.toMulti())), freshPart)!;
    expect(m.mix['p3.fader']).toBe(0.5);
    expect(m.mix['rev.type']).toBe(2);
    expect('rA.throw' in m.mix).toBe(false);
    const other = new RigSynth();
    other.loadMulti(m);
    expect((other.deskControl('p3.fader') as NumberControl).value).toBe(0.5);
    expect((other.deskControl('rev.type') as unknown as { value: string }).value).toBe('HALL');
  });
});

