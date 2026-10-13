import { describe, expect, it } from 'vitest';
import { PIPE_SOURCE } from '../../audio/pipeWorklet';
import type { CircuitChange } from '../circuit/circuit';
import { PIPE_BANKS, PIPE_INIT, PIPE_PRESETS } from '../devices/pipePresets';
import { PIPE_LFO_DIVISIONS, PipeSynth } from '../devices/pipeSynth';
import { SPRING_INIT, SpringReverb } from '../devices/springReverb';
import { MidiClock } from '../midi/clock';
import { Patch } from '../patch/patch';

const synth = () => new PipeSynth('Pipe', new MidiClock());
const params = (s: PipeSynth) => s.circuit.node('pipe').params;
const record = (s: PipeSynth): CircuitChange[] => {
  const log: CircuitChange[] = [];
  s.circuit.onChange((c) => log.push(c));
  return log;
};

describe('PipeSynth controls', () => {
  it('maps controls onto the engine params in the right units', () => {
    const s = synth();
    s.control('env.attack').kind === 'number' && (s.control('env.attack') as never as { set(v: number): void }).set(250);
    expect(params(s).atk).toBeCloseTo(0.25, 5);
    (s.control('fb.decay') as never as { set(v: number): void }).set(6);
    expect(params(s).fbDec).toBeCloseTo(6, 5);
    (s.control('delay.tune') as never as { set(v: number): void }).set(-7);
    expect(params(s).tune).toBe(-7);
    (s.control('delay.polarity') as never as { set(v: boolean): void }).set(true);
    expect(params(s).pol).toBe(1);
  });

  it('clamps values to their range', () => {
    const s = synth();
    const c = s.control('fb.push');
    if (c.kind !== 'number') throw new Error('not a number');
    c.set(99);
    expect(c.value).toBe(c.max);
    c.set(-5);
    expect(c.value).toBe(0);
  });

  it('voice mode and LFO choices become numbers for the worklet', () => {
    const s = synth();
    const mode = s.control('voice.mode');
    const wave = s.control('lfo.wave');
    const dest = s.control('lfo.dest');
    if (mode.kind !== 'choice' || wave.kind !== 'choice' || dest.kind !== 'choice') throw new Error('not choices');
    mode.set('unison');
    wave.set('rnd');
    dest.set('push');
    expect(params(s).mode).toBe(2);
    expect(params(s).lfoShape).toBe(4);
    expect(params(s).lfoDest).toBe(4);
  });

  it('the reverb mix is an equal-power crossfade', () => {
    const s = synth();
    const mix = s.control('rev.mix');
    if (mix.kind !== 'number') throw new Error('not a number');
    mix.set(0);
    expect(s.circuit.node('dry').params.gain).toBeCloseTo(1, 5);
    expect(s.circuit.node('wet').params.gain).toBeCloseTo(0, 5);
    mix.set(0.5);
    const d = s.circuit.node('dry').params.gain!;
    const w = s.circuit.node('wet').params.gain! / 3; // 3 is the reverb make-up
    expect(d * d + w * w).toBeCloseTo(1, 4);
  });

  it('a tempo-synced LFO follows the transport tempo and division', () => {
    const s = synth();
    const sync = s.control('lfo.sync');
    const div = s.control('lfo.division');
    if (sync.kind !== 'toggle' || div.kind !== 'choice') throw new Error('wrong kinds');
    s.transport.tempo.set(120);
    sync.set(true);
    div.set('1/4');
    expect(params(s).lfoRate).toBeCloseTo(2, 5); // 120 BPM: a quarter note is 2 Hz
    div.set('1/8');
    expect(params(s).lfoRate).toBeCloseTo(4, 5);
    expect(PIPE_LFO_DIVISIONS).toContain('1/32');
  });
});

describe('PipeSynth playing and MIDI', () => {
  it('keys send notes to the pipe node and track what is held', () => {
    const s = synth();
    const log = record(s);
    s.keyDown(60, 0.5);
    s.keyDown(64);
    expect(s.heldNotes).toEqual([60, 64]);
    s.keyUp(60);
    expect(s.heldNotes).toEqual([64]);
    const notes = log.filter((c) => c.type === 'note') as Extract<CircuitChange, { type: 'note' }>[];
    expect(notes.map((n) => [n.note, n.velocity > 0])).toEqual([[60, true], [64, true], [60, false]]);
    expect(notes[0]!.velocity).toBeCloseTo(0.5, 5);
  });

  it('pitch bend, mod wheel and sustain pedal reach the engine', () => {
    const s = synth();
    const log = record(s);
    s.handleMidi({ type: 'pitchBend', channel: 1, value: 1 });
    expect(params(s).bend).toBeCloseTo(2, 5);
    s.handleMidi({ type: 'cc', channel: 1, controller: 1, value: 127 });
    expect(params(s).mod).toBeCloseTo(1, 5);
    s.handleMidi({ type: 'cc', channel: 1, controller: 64, value: 127 });
    s.handleMidi({ type: 'cc', channel: 1, controller: 64, value: 0 });
    const pedal = log.filter((c) => c.type === 'note' && c.note === -2) as Extract<CircuitChange, { type: 'note' }>[];
    expect(pedal.map((p) => p.velocity)).toEqual([1, 0]);
  });

  it('respects the MIDI channel and takes program changes', () => {
    const s = synth();
    s.transport.channel.set('3');
    s.handleMidi({ type: 'noteOn', channel: 1, note: 60, velocity: 100 });
    expect(s.heldNotes).toEqual([]);
    s.handleMidi({ type: 'noteOn', channel: 3, note: 60, velocity: 100 });
    expect(s.heldNotes).toEqual([60]);
    s.handleMidi({ type: 'programChange', channel: 3, program: 5 });
    expect(s.currentSlot).toBe(5);
    expect(s.currentPreset.name).toBe(PIPE_PRESETS[5]!.name);
  });

  it('changing the voice mode releases everything', () => {
    const s = synth();
    s.keyDown(60);
    const log = record(s);
    const mode = s.control('voice.mode');
    if (mode.kind !== 'choice') throw new Error('not a choice');
    mode.set('mono');
    expect(log.some((c) => c.type === 'note' && c.note === -1)).toBe(true);
    expect(s.heldNotes).toEqual([]);
  });
});

describe('PipeSynth patches', () => {
  it('ships sixteen patches in two banks of eight with distinct names', () => {
    expect(PIPE_BANKS.map((b) => b.length)).toEqual([8, 8]);
    expect(new Set(PIPE_PRESETS.map((p) => p.name)).size).toBe(16);
  });

  it('every patch loads, and only names controls that exist', () => {
    const s = synth();
    const ids = new Set(s.controls.map((c) => c.id));
    expect(Object.keys(PIPE_INIT).sort()).toEqual([...ids].sort());
    for (const preset of PIPE_PRESETS) {
      for (const id of Object.keys(preset.values)) expect(ids.has(id), `${preset.name}: ${id}`).toBe(true);
      expect(() => s.loadPreset(preset)).not.toThrow();
    }
  });

  it('loading a patch resets everything the patch does not mention', () => {
    const s = synth();
    s.loadSlot(14); // Steam Drone: unison, long envelopes
    s.loadSlot(0);
    const mode = s.control('voice.mode');
    const attack = s.control('env.attack');
    if (mode.kind !== 'choice' || attack.kind !== 'number') throw new Error('wrong kinds');
    expect(mode.value).toBe('poly');
    expect(attack.value).toBeCloseTo(1, 5);
  });

  it('snapshot and save keep the sound, and the slot name', () => {
    const s = synth();
    s.loadSlot(3);
    const c = s.control('fb.decay');
    if (c.kind !== 'number') throw new Error('not a number');
    c.set(9);
    const saved = s.saveSlot(3);
    expect(saved.name).toBe(PIPE_PRESETS[3]!.name);
    expect(saved.values['fb.decay']).toBeCloseTo(9, 5);
    c.set(1);
    s.loadSlot(3);
    expect(c.value).toBeCloseTo(9, 5);
  });
});

// Every patch, played for real through the engine the page ships.
describe('every patch makes a sound', () => {
  const mod = new Function(`${PIPE_SOURCE}; return { PipeCore };`)() as {
    PipeCore: new (sr: number, random?: () => number) => {
      noteOn(n: number, v: number, p?: Record<string, number>): void;
      process(l: Float32Array, r: Float32Array, n: number, p: Record<string, number>): void;
    };
  };
  const SR = 48000;
  let seed = 7;
  const random = () => ((seed = (seed * 1664525 + 1013904223) >>> 0) / 4294967296);

  for (const [index, preset] of PIPE_PRESETS.entries()) {
    it(`${preset.name}: audible, finite and bounded`, () => {
      const s = synth();
      s.loadSlot(index);
      const p = { ...params(s) };
      const core = new mod.PipeCore(SR, random);
      core.noteOn(60, 0.8, p);
      core.noteOn(67, 0.8, p);
      const n = SR; // one second
      const l = new Float32Array(n);
      const r = new Float32Array(n);
      for (let at = 0; at < n; at += 128) core.process(l.subarray(at, at + 128), r.subarray(at, at + 128), 128, p);
      let peak = 0, early = 0;
      for (let i = 0; i < n; i++) {
        expect(Number.isFinite(l[i]!) && Number.isFinite(r[i]!)).toBe(true);
        peak = Math.max(peak, Math.abs(l[i]!), Math.abs(r[i]!));
        if (i > 0.05 * SR && i < 0.6 * SR) early += l[i]! * l[i]! + r[i]! * r[i]!;
      }
      expect(Math.sqrt(early / (0.55 * SR * 2)), 'level').toBeGreaterThan(0.002);
      expect(peak).toBeLessThan(4);
    });
  }
});

describe('SpringReverb and the pipe patch', () => {
  it('maps its controls and does an equal-power dry/wet', () => {
    const sp = new SpringReverb();
    const set = (id: string, v: number) => {
      const c = sp.control(id);
      if (c.kind !== 'number') throw new Error('not a number');
      c.set(v);
    };
    set('spring.length', 4);
    set('spring.tension', 0.2);
    set('spring.drip', 0.9);
    set('spring.tilt', -0.5);
    set('spring.dwell', 0.7);
    const node = sp.circuit.node('spring').params;
    expect([node.decay, node.tension, node.drip, node.tilt, node.dwell]).toEqual([4, 0.2, 0.9, -0.5, 0.7]);
    set('spring.mix', 0);
    expect(sp.circuit.node('dry').params.gain).toBeCloseTo(1, 5);
    expect(sp.circuit.node('wet').params.gain).toBeCloseTo(0, 5);
    set('spring.mix', 1);
    expect(sp.circuit.node('dry').params.gain).toBeCloseTo(0, 5);
    expect(sp.circuit.node('wet').params.gain!).toBeGreaterThan(1);
  });

  it('resets to the factory settings', () => {
    const sp = new SpringReverb();
    for (const c of sp.controls) if (c.kind === 'number') c.set(c.max);
    sp.reset();
    for (const c of sp.controls) if (c.kind === 'number') expect(c.value).toBeCloseTo(SPRING_INIT[c.id]!, 5);
  });

  it('Patch.pipe wires the pipe into the spring and out', () => {
    const patch = Patch.pipe();
    expect([...patch.devices.keys()]).toEqual(['pipe', 'spring']);
    expect(patch.connections).toEqual([{ from: { device: 'pipe', jack: 'out' }, to: { device: 'spring', jack: 'in' } }]);
    expect(patch.output).toEqual({ device: 'spring', jack: 'out' });
  });
});
