import { describe, expect, it } from 'vitest';
import type { CircuitChange } from '../circuit/circuit';
import { padSoundId, RIG_KITS, rigDrumParams, type RigPad } from '../devices/rigKit';
import { sanitiseMulti } from '../devices/rigMulti';
import { freshPart, RIG_VOICES, RigSynth } from '../devices/rigSynth';

interface Sent { type: string; part?: number; pad?: number; note?: number; id?: string; kind?: string; settings?: { sample: string; start: number; end: number } }
/** A synth whose kit sounds arrive at once: one second of silence at 48 kHz, whatever the pad. */
function setup() {
  const rig = new RigSynth();
  const sent: Sent[] = [];
  const asked: RigPad[] = [];
  rig.circuit.onChange((c: CircuitChange) => { if (c.type === 'message') sent.push(c.data as Sent); });
  rig.kitSounds = (pad) => { asked.push(pad); return Promise.resolve({ rate: 48000, channels: [new Float32Array(48000)] }); };
  return { rig, sent, asked };
}
const settle = () => new Promise((r) => setTimeout(r, 0));

describe('MOA-RIG kits', () => {
  it('give every analogue pad the MOA-DR’s own knobs for its voice', () => {
    expect(rigDrumParams('kick').map((p) => p.id)).toEqual(['kick.tune', 'kick.decay', 'kick.click']);
    for (const kit of RIG_KITS) {
      expect(kit.pads).toHaveLength(16);
      for (const pad of kit.pads.filter((p) => p.src === 'analog')) {
        const ids = new Set(rigDrumParams(pad.voice).map((p) => p.id));
        for (const id of Object.keys(pad.analog)) expect(ids.has(id), `${kit.name} ${pad.name} ${id}`).toBe(true);
      }
    }
    expect(RIG_KITS.some((k) => k.pads.some((p) => p.src === 'sample') && k.pads.some((p) => p.src === 'analog'))).toBe(true);
  });

  it('make a part a kit: it gives its voices back, and its sounds and pads go to the worklet', async () => {
    const { rig, sent, asked } = setup();
    rig.setKind(0, 'kit');
    expect(rig.parts[0]!.voices).toBe(0);
    expect(rig.freeVoices).toBe(RIG_VOICES);
    expect(sent.find((m) => m.type === 'kind')).toMatchObject({ part: 0, kind: 'kit' });
    await settle();
    const ids = new Set(rig.parts[0]!.kit!.pads.map(padSoundId));
    expect(asked).toHaveLength(ids.size); // pads with the same sound share it
    expect(new Set(sent.filter((m) => m.type === 'sample').map((m) => m.id))).toEqual(ids);
    const pads = sent.filter((m) => m.type === 'pad');
    expect(new Set(pads.map((m) => m.pad))).toEqual(new Set(Array.from({ length: 16 }, (_, i) => i)));
    rig.setVoices(0, 8);
    expect(rig.parts[0]!.voices).toBe(0);
  });

  it('play pads from the keyboard bed (middle C is pad 1) and from MIDI (note 36 is pad 1)', () => {
    const { rig, sent } = setup();
    rig.setKind(0, 'kit');
    rig.setPartSetting(0, 'octave', 1); // a kit ignores its octave
    rig.keyDown(60);
    rig.handleMidi({ type: 'noteOn', channel: 1, note: 38, velocity: 100 });
    expect(sent.filter((m) => m.type === 'on').map((m) => m.note)).toEqual([36, 38]);
  });

  it('render a new sound when an analogue knob turns, and let the worklet forget the old one', async () => {
    const { rig, sent, asked } = setup();
    rig.setKind(0, 'kit');
    await settle();
    const old = padSoundId(rig.parts[0]!.kit!.pads[0]!);
    rig.setPad(0, 0, { analog: { 'kick.tune': 60 } });
    await settle();
    expect(asked.at(-1)!.analog).toEqual({ 'kick.tune': 60 });
    const pad = sent.filter((m) => m.type === 'pad' && m.pad === 0).at(-1)!;
    expect(pad.settings!.sample).toBe(padSoundId(rig.parts[0]!.kit!.pads[0]!));
    expect(sent.filter((m) => m.type === 'drop').map((m) => m.id)).toEqual([old]);
  });

  it('send a sample pad’s start and end in frames of its sound', async () => {
    const { rig, sent } = setup();
    rig.setKind(0, 'kit');
    rig.setPad(0, 3, { src: 'sample', sound: 'MOA Drums 60/f.break', start: 0.25, end: 0.5 });
    await settle();
    expect(sent.filter((m) => m.type === 'pad' && m.pad === 3).at(-1)!.settings).toMatchObject({ sample: 'MOA Drums 60/f.break', start: 12000, end: 24000 });
  });

  it('send everything again to a worklet built later', async () => {
    const { rig, sent } = setup();
    rig.setKind(2, 'kit');
    await settle();
    sent.length = 0;
    rig.circuit.nodeReady('synth');
    await settle();
    expect(sent.filter((m) => m.type === 'pad')).toHaveLength(16);
    expect(sent.some((m) => m.type === 'sample')).toBe(true);
    expect(JSON.parse(rig.circuit.node('synth').options.state!).kinds[2]).toBe('kit');
  });

  it('come back from a saved multi, kit and all', async () => {
    const { rig } = setup();
    rig.loadKit(4, RIG_KITS[1]!);
    rig.setPad(4, 2, { tune: -3, analog: { 'snare.snap': 0.9 } });
    const m = sanitiseMulti(JSON.parse(JSON.stringify(rig.toMulti())), freshPart)!;
    expect(m).toEqual(rig.toMulti());
    const other = setup();
    other.rig.loadMulti(m);
    await settle();
    expect(other.rig.parts[4]!.kind).toBe('kit');
    expect(other.rig.parts[4]!.kit!.pads[2]).toMatchObject({ tune: -3, analog: { 'snare.snap': 0.9 } });
    expect(other.sent.filter((x) => x.type === 'pad' && x.part === 4)).toHaveLength(16);
  });

  it('the drum grid: a cell puts a hit in or takes it out, and each hit plays at its own velocity', () => {
    const { rig, sent } = setup();
    rig.setKind(1, 'kit');
    rig.toggleHit(1, 0, 36);
    rig.toggleHit(1, 0, 38);
    rig.setHitVelocity(1, 0, 38, 0.3);
    rig.setHitVelocity(1, 0, 40, 1); // no hit there: nothing
    const step = rig.seq.pattern.tracks[1]!.steps[0]!;
    expect(step.notes).toEqual([36, 38]);
    expect(step.vels).toEqual({ 38: 0.3 });
    rig.play();
    rig.seq.schedule(0);
    expect(sent.filter((m) => m.type === 'on').map((m) => [m.note, (m as { vel?: number }).vel])).toEqual([[36, 0.8], [38, 0.3]]);
    rig.stop();
    rig.toggleHit(1, 0, 38);
    expect(step.notes).toEqual([36]);
    expect(step.vels).toBeUndefined();
  });

  it('records a kit pass by pass: hits are added to what the step has, each at its velocity', () => {
    const { rig } = setup();
    rig.setKind(0, 'kit');
    let t = 0;
    rig.now = () => t;
    rig.setRecording(true);
    rig.play();
    for (; t < 0.1; t += 0.025) rig.seq.schedule(t);
    const at = (step: number) => 0.05 + 0.125 * step;
    t = at(4); rig.handleMidi({ type: 'noteOn', channel: 1, note: 36, velocity: 127 }); rig.handleMidi({ type: 'noteOff', channel: 1, note: 36, velocity: 0 });
    t = at(4 + 16); rig.handleMidi({ type: 'noteOn', channel: 1, note: 42, velocity: 40 }); rig.handleMidi({ type: 'noteOff', channel: 1, note: 42, velocity: 0 });
    const step = rig.seq.pattern.tracks[0]!.steps[4]!;
    expect(step.notes).toEqual([36, 42]);
    expect(step.vels![42]).toBeCloseTo(40 / 127, 6);
  });

  it('keeps hit velocities through a save and a transpose', () => {
    const { rig } = setup();
    const s = rig.seq.pattern.tracks[0]!.steps[2]!;
    s.notes = [36, 38];
    s.vels = { 38: 0.25 };
    expect(sanitiseMulti(JSON.parse(JSON.stringify(rig.toMulti())), freshPart)!.patterns[0]!.tracks[0]!.steps[2]!.vels).toEqual({ 38: 0.25 });
    rig.transposeStep(0, 2, 2);
    expect(s.vels).toEqual({ 40: 0.25 });
  });

  it('clears a row of the drum grid: the pad’s hits on every step, and nothing else', () => {
    const { rig } = setup();
    const steps = rig.seq.pattern.tracks[1]!.steps;
    for (const i of [0, 4, 40]) rig.toggleHit(1, i, 38);
    rig.toggleHit(1, 4, 36);
    rig.setHitVelocity(1, 4, 38, 0.3);
    rig.clearHits(1, 38);
    expect(steps.filter((s) => s.notes.includes(38))).toEqual([]);
    expect(steps[4]!.notes).toEqual([36]);
    expect(steps[4]!.vels).toBeUndefined();
  });

  it('moves drum-grid rows up and down, swapping past the rows they pass instead of overwriting them', () => {
    const { rig } = setup();
    const steps = rig.seq.pattern.tracks[0]!.steps;
    const rows = () => Array.from({ length: 4 }, (_, pad) => steps.slice(0, 8).flatMap((s, i) => (s.notes.includes(36 + pad) ? [i] : [])));
    rig.toggleHit(0, 0, 36); // pad 1 (BD) on step 0
    rig.toggleHit(0, 2, 37); // pad 2 on step 2
    rig.toggleHit(0, 4, 38); // pad 3 on steps 4 and 6
    rig.toggleHit(0, 6, 38);
    rig.setHitVelocity(0, 6, 38, 0.3);
    // pad 3 up: it swaps with pad 2, which is not lost
    expect(rig.moveRows(0, [2], -1)).toEqual([1]);
    expect(rows()).toEqual([[0], [4, 6], [2], []]);
    expect(steps[6]!.vels).toEqual({ 37: 0.3 });
    // pads 1 and 2 down together: pad 3's row comes up above them
    expect(rig.moveRows(0, [0, 1], 1)).toEqual([1, 2]);
    expect(rows()).toEqual([[2], [0], [4, 6], []]);
    // at the top, nothing moves
    expect(rig.moveRows(0, [0, 2], -1)).toEqual([0, 2]);
    expect(rows()).toEqual([[2], [0], [4, 6], []]);
  });
});

