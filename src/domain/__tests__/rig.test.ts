import { describe, expect, it } from 'vitest';
import { RIG_SOURCE } from '../../audio/rigWorklet';
import type { CircuitChange } from '../circuit/circuit';
import type { ChoiceControl, NumberControl } from '../devices/controls';
import { RIG_DESTS, RIG_PARAMS, RIG_SOURCES, type RigSide } from '../devices/rigParams';
import { RIG_PRESETS } from '../devices/rigPresets';
import { RIG_VOICES, RigSynth } from '../devices/rigSynth';

interface Sent { type: string; part?: number; note?: number; vel?: number; counts?: number[]; a?: RigSide; b?: RigSide; name?: string; value?: number; when?: number }
/** A synth and the messages it sends its worklet. */
function setup() {
  const rig = new RigSynth();
  const sent: Sent[] = [];
  rig.circuit.onChange((c: CircuitChange) => { if (c.type === 'message') sent.push(c.data as Sent); });
  return { rig, sent };
}
const notes = (sent: Sent[], type: 'on' | 'off') => sent.filter((m) => m.type === type).map((m) => [m.part, m.note]);

describe('MOA-RIG factory sounds', () => {
  const ids = new Map(RIG_PARAMS.map((p) => [p.id, p]));
  const dests = new Set<string>(RIG_DESTS.map((d) => d[0]));
  it('use only real params, in range, and real routings', () => {
    for (const preset of RIG_PRESETS) for (const side of [preset.a, preset.b ?? preset.a]) {
      for (const [id, v] of Object.entries(side.params)) {
        const p = ids.get(id);
        expect(p, `${preset.name}: ${id}`).toBeDefined();
        expect(v, `${preset.name}: ${id}`).toBeGreaterThanOrEqual(p!.min);
        expect(v, `${preset.name}: ${id}`).toBeLessThanOrEqual(p!.max);
      }
      for (const r of side.matrix) {
        expect(RIG_SOURCES, preset.name).toContain(r.source);
        expect(dests.has(r.dest), `${preset.name}: ${r.dest}`).toBe(true);
        expect(Math.abs(r.amount)).toBeLessThanOrEqual(1);
      }
    }
  });

  it('all sound, and stay finite', () => {
    const { RigCore } = new Function(`${RIG_SOURCE}; return { RigCore };`)() as {
      RigCore: new (sr: number) => { setPatch(p: number, a: RigSide, b?: RigSide): void; noteOn(p: number, n: number, v: number): void; process(l: Float32Array, r: Float32Array, n: number): void };
    };
    for (const preset of RIG_PRESETS) {
      const core = new RigCore(48000);
      core.setPatch(0, preset.a, preset.b);
      core.noteOn(0, 48, 0.9);
      core.noteOn(0, 55, 0.9);
      const l = new Float32Array(128), r = new Float32Array(128);
      let sum = 0, peak = 0;
      for (let b = 0; b < 375 * 1.5; b++) {
        core.process(l, r, 128);
        for (let i = 0; i < 128; i++) {
          expect(Number.isFinite(l[i]!), preset.name).toBe(true);
          sum += l[i]! * l[i]!;
          peak = Math.max(peak, Math.abs(l[i]!));
        }
      }
      expect(Math.sqrt(sum / (128 * 375 * 1.5)), preset.name).toBeGreaterThan(0.003);
      expect(peak, preset.name).toBeLessThan(1.5);
    }
  }, 20_000); // every factory sound for a second and a half each
});

describe('MOA-RIG device', () => {
  it('starts as one part with the whole pool, and keeps the multi in its state option for a worklet built later', () => {
    const { rig } = setup();
    expect(rig.parts[0]!.voices).toBe(RIG_VOICES);
    expect(rig.freeVoices).toBe(0);
    const state = JSON.parse(rig.circuit.node('synth').options.state!) as { counts: number[]; patches: unknown[] };
    expect(state.counts[0]).toBe(RIG_VOICES);
    expect(state.patches).toHaveLength(16);
  });

  it('edits the selected part and side, and the controls follow the selection', () => {
    const { rig, sent } = setup();
    rig.selectPart(2);
    (rig.control('lad.cutoff') as NumberControl).set(500);
    rig.selectSide('b');
    (rig.control('osc3.table') as ChoiceControl).set('VOX CHOIR');
    expect(rig.parts[2]!.a.params['lad.cutoff']).toBe(500);
    expect(rig.parts[2]!.b.params['osc3.table']).toBe(5);
    expect(rig.parts[2]!.a.params['osc3.table']).toBeUndefined();
    const last = sent.filter((m) => m.type === 'patch').at(-1)!;
    expect(last.part).toBe(2);
    expect(last.b!.params['osc3.table']).toBe(5);
    rig.selectPart(0);
    expect((rig.control('lad.cutoff') as { value: number }).value).toBe(2000);
    rig.selectPart(2);
    rig.selectSide('a');
    expect((rig.control('lad.cutoff') as { value: number }).value).toBe(500);
    expect((rig.control('osc3.table') as { value: string }).value).toBe('PPG RESO');
  });

  it('loads a factory sound into the edited part and shows it', () => {
    const { rig } = setup();
    const acid = RIG_PRESETS.findIndex((p) => p.name === 'Acid Line');
    rig.loadSlot(acid);
    expect(rig.parts[0]!.name).toBe('Acid Line');
    expect((rig.control('voice.mode') as { value: string }).value).toBe('legato');
    const state = JSON.parse(rig.circuit.node('synth').options.state!) as { patches: { a: RigSide }[] };
    expect(state.patches[0]!.a.params['lad.res']).toBe(0.75);
  });

  it('plays the edited part from the keyboard bed, an octave up when the part says so', () => {
    const { rig, sent } = setup();
    rig.setVoices(0, 8);
    rig.selectPart(1);
    rig.setVoices(1, 8);
    rig.setPartSetting(1, 'octave', 1);
    rig.keyDown(60);
    rig.keyUp(60);
    expect(notes(sent, 'on')).toEqual([[1, 72]]);
    expect(notes(sent, 'off')).toEqual([[1, 72]]);
  });

  it('sends MIDI to the parts on its channel and inside their key range, and stops them even after a change', () => {
    const { rig, sent } = setup();
    rig.setVoices(0, 8);
    rig.setVoices(1, 8);
    rig.setVoices(2, 8);
    rig.setPartSetting(0, 'channel', 1);
    rig.setPartSetting(0, 'hi', 59);
    rig.setPartSetting(1, 'channel', 1);
    rig.setPartSetting(1, 'lo', 60);
    rig.setPartSetting(2, 'channel', 3);
    rig.handleMidi({ type: 'noteOn', channel: 1, note: 48, velocity: 127 });
    rig.handleMidi({ type: 'noteOn', channel: 1, note: 64, velocity: 64 });
    rig.handleMidi({ type: 'noteOn', channel: 3, note: 64, velocity: 100 });
    expect(notes(sent, 'on')).toEqual([[0, 48], [1, 64], [2, 64]]);
    rig.setPartSetting(1, 'channel', 5);
    rig.handleMidi({ type: 'noteOff', channel: 1, note: 64, velocity: 0 });
    expect(notes(sent, 'off')).toEqual([[1, 64]]);
  });

  it('never gives out more voices than the pool has', () => {
    const { rig, sent } = setup();
    rig.setVoices(1, 10);
    expect(rig.parts[1]!.voices).toBe(0);
    rig.setVoices(0, 16);
    rig.setVoices(1, RIG_VOICES);
    expect(rig.parts[1]!.voices).toBe(RIG_VOICES - 16);
    expect(rig.freeVoices).toBe(0);
    expect(sent.filter((m) => m.type === 'layout').at(-1)!.counts!.slice(0, 2)).toEqual([16, RIG_VOICES - 16]);
  });

  it('sends the wheels to every part', () => {
    const { rig, sent } = setup();
    rig.handleMidi({ type: 'cc', channel: 1, controller: 1, value: 127 });
    const mods = sent.filter((m) => m.type === 'ctrl' && m.name === 'mod');
    expect(mods).toHaveLength(16);
    expect(mods.every((m) => m.value === 1)).toBe(true);
    expect(rig.modWheel).toBe(1);
  });
});

describe('MOA-RIG sequencer on the device', () => {
  it('sends the tracks to their parts, each note with its time', () => {
    const { rig, sent } = setup();
    rig.bpm = 120;
    rig.seq.pattern.tracks[3]!.steps[0]!.notes = [50];
    rig.now = () => 2;
    rig.play();
    rig.seq.schedule(2);
    expect(sent.filter((m) => m.type === 'on')).toEqual([{ type: 'on', part: 3, note: 50, vel: 0.8, when: 2.05 }]);
    rig.stop();
    expect(sent.at(-1)!.type).toBe('off');
    expect(sent.some((m) => m.type === 'flush')).toBe(true);
  });

  it('with a step held, a control locks onto the step and shows its value; let go, it shows the sound again', () => {
    const { rig, sent } = setup();
    rig.selectStep(2, 5);
    rig.holdStep();
    const before = sent.length;
    (rig.control('lad.cutoff') as NumberControl).set(400);
    (rig.control('osc3.table') as ChoiceControl).set('VOX AEIOU');
    expect(rig.seq.pattern.tracks[2]!.steps[5]!.locks).toEqual({ 'lad.cutoff': 400, 'osc3.table': 4 });
    expect(rig.parts[2]!.a.params['lad.cutoff']).toBeUndefined();
    expect(sent.slice(before).filter((m) => m.type === 'patch')).toEqual([]);
    rig.releaseStep();
    expect((rig.control('lad.cutoff') as NumberControl).value).toBe(2000);
    rig.selectStep(2, 5);
    rig.holdStep();
    expect((rig.control('lad.cutoff') as NumberControl).value).toBe(400);
    rig.selectPart(0);
    expect(rig.holding).toBe(false);
  });

  it('records a chord onto the selected step when stopped, then moves on a step', () => {
    const { rig } = setup();
    rig.selectStep(0, 3);
    rig.setRecording(true);
    rig.keyDown(60);
    rig.keyDown(64);
    rig.keyUp(60);
    rig.keyUp(64);
    expect(rig.seq.pattern.tracks[0]!.steps[3]!.notes).toEqual([60, 64]);
    expect(rig.step).toBe(4);
    rig.keyDown(62);
    rig.keyUp(62);
    expect(rig.seq.pattern.tracks[0]!.steps[4]!.notes).toEqual([62]);
  });

  it('records live onto the nearest step, with the gate it was held for, and does not play it twice', () => {
    const { rig, sent } = setup();
    rig.bpm = 120; // a sixteenth is 0.125 s
    let t = 0;
    rig.now = () => t;
    rig.setRecording(true);
    rig.play();
    for (; t < 0.1; t += 0.025) rig.seq.schedule(t);
    t = 0.05 + 0.125 * 3.9; // just before step 4
    rig.keyDown(67);
    t += 0.125 * 2;
    rig.keyUp(67);
    const step = rig.seq.pattern.tracks[0]!.steps[4]!;
    expect(step.notes).toEqual([67]);
    expect(step.gate).toBe(2);
    const before = sent.length;
    for (; t < 0.05 + 0.125 * 16.5; t += 0.025) rig.seq.schedule(t);
    expect(sent.slice(before).filter((m) => m.type === 'on').map((m) => +((m.when! - 0.05) / 0.125).toFixed(3))).toEqual([]);
    for (; t < 0.05 + 0.125 * 20.5; t += 0.025) rig.seq.schedule(t);
    expect(sent.slice(before).filter((m) => m.type === 'on').map((m) => +((m.when! - 0.05) / 0.125).toFixed(3))).toEqual([20]);
  });

  it('sets the selected step’s notes from the keys when stopped, without REC and without moving on', () => {
    const { rig } = setup();
    const steps = rig.seq.pattern.tracks[0]!.steps;
    rig.keyDown(60);
    rig.keyUp(60);
    expect(steps.every((s) => !s.notes.length)).toBe(true); // no step selected: just playing
    steps[2]!.notes = [48];
    rig.selectStep(0, 2);
    rig.keyDown(55);
    rig.keyDown(58);
    rig.keyUp(55);
    rig.keyUp(58);
    expect(steps[2]!.notes).toEqual([55, 58]);
    expect(rig.step).toBe(2);
    rig.keyDown(53);
    rig.keyUp(53);
    expect(steps[2]!.notes).toEqual([53]);
  });

  it('transposes a step’s chord, keeping its shape inside the MIDI range', () => {
    const { rig } = setup();
    const s = rig.seq.pattern.tracks[1]!.steps[0]!;
    s.notes = [60, 64, 67];
    rig.transposeStep(1, 0, -12);
    expect(s.notes).toEqual([48, 52, 55]);
    rig.transposeStep(1, 0, 100);
    expect(s.notes).toEqual([120, 124, 127]);
  });

  it('with MIDI to the edited part, plays only that part from any channel, follows it, and still lets go of notes', () => {
    const { rig, sent } = setup();
    rig.setVoices(0, 8);
    rig.setVoices(1, 8);
    rig.setPartSetting(1, 'lo', 72); // its range does not matter now
    rig.midiToEdited = true;
    rig.selectPart(1);
    rig.handleMidi({ type: 'noteOn', channel: 7, note: 60, velocity: 100 });
    rig.selectPart(0);
    rig.handleMidi({ type: 'noteOn', channel: 1, note: 64, velocity: 100 });
    rig.handleMidi({ type: 'noteOff', channel: 7, note: 60, velocity: 0 });
    expect(notes(sent, 'on')).toEqual([[1, 60], [0, 64]]);
    expect(notes(sent, 'off')).toEqual([[1, 60]]);
    rig.midiToEdited = false;
    rig.handleMidi({ type: 'noteOn', channel: 2, note: 50, velocity: 100 });
    expect(notes(sent, 'on').at(-1)).toEqual([0, 50]); // part 1 hears all channels; part 2's range starts at 72
  });

  it('with MIDI to the edited part, the wheels go to that part and move over with it', () => {
    const { rig, sent } = setup();
    rig.midiToEdited = true;
    rig.handleMidi({ type: 'cc', channel: 1, controller: 1, value: 127 });
    const mods = () => sent.filter((m) => m.type === 'ctrl' && m.name === 'mod').map((m) => [m.part, m.value]);
    expect(mods()).toEqual([[0, 1]]);
    rig.selectPart(3);
    expect(mods().slice(1)).toEqual([[0, 0], [3, 1]]);
  });
});

