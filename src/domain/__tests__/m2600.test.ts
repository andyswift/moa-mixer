import { describe, expect, it } from 'vitest';
import { M2600_SOURCE } from '../../audio/m2600Worklet';
import { M2600_INPUTS, M2600_OUTPUTS, M2600_PARAMS } from '../devices/m2600Params';
import { M2600_FACTORY, M2600_SLOTS } from '../devices/m2600Presets';
import { M2600Synth } from '../devices/m2600Synth';

const watch = (synth: M2600Synth) => {
  const plays: { n1: number; n2: number; gate: boolean; retrig: boolean }[] = [];
  synth.circuit.onChange((c) => { if (c.type === 'play') plays.push({ n1: c.n1, n2: c.n2, gate: c.gate, retrig: c.retrig }); });
  return plays;
};
const choose = (s: M2600Synth, id: string, v: string) => (s.control(id) as { set(v: string): void }).set(v);

describe('keyboard', () => {
  it('mono plays the lowest held key on both voices, as the original keyboard does', () => {
    const s = new M2600Synth();
    s.keyDown(67);
    s.keyDown(60);
    s.keyDown(64);
    expect(s.assign()).toEqual({ n1: 60, n2: 60 });
  });

  it('duo gives the lowest key to the keyboard CV and the highest to the upper voice', () => {
    const s = new M2600Synth();
    choose(s, 'kb.voice', 'duo');
    s.keyDown(64); s.keyDown(72); s.keyDown(60);
    expect(s.assign()).toEqual({ n1: 60, n2: 72 });
  });

  it('multi trigger retriggers on every key, single only on the first', () => {
    const multi = new M2600Synth();
    const a = watch(multi);
    multi.keyDown(60); multi.keyDown(62);
    expect(a.map((p) => p.retrig)).toEqual([true, true]);
    const single = new M2600Synth();
    choose(single, 'kb.trig', 'single');
    const b = watch(single);
    single.keyDown(60); single.keyDown(62);
    expect(b.map((p) => p.retrig)).toEqual([true, false]);
  });

  it('closes the gate when the last key is released, and the sustain pedal holds it', () => {
    const s = new M2600Synth();
    const plays = watch(s);
    s.handleMidi({ type: 'cc', channel: 1, controller: 64, value: 127 });
    s.keyDown(60); s.keyUp(60);
    expect(plays.at(-1)!.gate).toBe(true);
    s.handleMidi({ type: 'cc', channel: 1, controller: 64, value: 0 });
    expect(plays.at(-1)!.gate).toBe(false);
  });

  it('listens on its MIDI channel only, unless omni', () => {
    const s = new M2600Synth();
    choose(s, 'play.channel', '3');
    s.handleMidi({ type: 'noteOn', channel: 1, note: 60, velocity: 100 });
    expect(s.heldNotes).toEqual([]);
    s.handleMidi({ type: 'noteOn', channel: 3, note: 60, velocity: 100 });
    expect(s.heldNotes).toEqual([60]);
  });
});

describe('the table', () => {
  it('every input normal is a real output or a constant, and every slider a real param', () => {
    const outs = new Set<string>(M2600_OUTPUTS);
    const params = new Set(M2600_PARAMS.map((p) => p.id));
    for (const i of M2600_INPUTS) {
      if (i.normal) expect(outs.has(i.normal) || i.normal === '-10V' || i.normal === '+10V', i.id).toBe(true);
      if (i.slider) expect(params.has(i.slider), i.id).toBe(true);
    }
  });
});

describe('patches', () => {
  it('every factory patch loads (only real controls, right kinds) and the slots are filled', () => {
    const s = new M2600Synth();
    expect(s.slots).toHaveLength(M2600_SLOTS);
    M2600_FACTORY.forEach((_, i) => expect(() => s.loadSlot(i)).not.toThrow());
  });

  it('save keeps the panel in the slot', () => {
    const s = new M2600Synth();
    (s.control('vcf.res') as { set(v: number): void }).set(0.77);
    s.saveSlot(5);
    s.loadSlot(0);
    s.loadSlot(5);
    expect(s.control('vcf.res').value).toBeCloseTo(0.77);
  });

  // Run each factory patch through the real DSP with a held note: it must sound, and stay bounded and finite.
  const mod = new Function(`${M2600_SOURCE}; return { M26Core };`)() as {
    M26Core: new (sr: number, random?: () => number) => {
      play(n1: number, n2: number, gate: boolean, retrig: boolean): void;
      process(l: Float32Array, r: Float32Array, n: number, p: Record<string, number>): void;
    };
  };
  const SR = 48000;
  for (const [i, preset] of M2600_FACTORY.entries()) {
    it(`"${preset.name}" sounds with a held note and stays within ±1`, () => {
      const s = new M2600Synth();
      s.loadSlot(i);
      const p: Record<string, number> = { bend: 0, modw: 0 };
      for (const def of M2600_PARAMS) {
        const v = s.control(def.id).value;
        p[def.id] = typeof v === 'boolean' ? (v ? 1 : 0) : typeof v === 'string' ? def.options!.indexOf(v) : v;
      }
      let seed = 7;
      const core = new mod.M26Core(SR, () => ((seed = (seed * 1664525 + 1013904223) >>> 0) / 4294967296));
      core.play(60, 67, true, true);
      const n = SR * 1.5;
      const l = new Float32Array(n), r = new Float32Array(n);
      for (let at = 0; at < n; at += 128) core.process(l.subarray(at, at + 128), r.subarray(at, at + 128), 128, p);
      let peak = 0, sum = 0;
      for (let k = 0; k < n; k++) {
        expect(Number.isFinite(l[k]!)).toBe(true);
        peak = Math.max(peak, Math.abs(l[k]!), Math.abs(r[k]!));
        sum += l[k]! * l[k]!;
      }
      expect(peak).toBeLessThanOrEqual(1);
      expect(peak).toBeGreaterThan(0.1);
      expect(Math.sqrt(sum / n)).toBeGreaterThan(0.002);
    });
  }
});
