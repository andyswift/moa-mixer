import { describe, expect, it } from 'vitest';
import { M2600_SOURCE } from '../../audio/m2600Worklet';
import { M2600_INPUTS, M2600_OUTPUTS, M2600_PARAMS } from '../devices/m2600Params';
import { M2600_FACTORY, M2600_SLOTS } from '../devices/m2600Presets';
import { M2600Synth } from '../devices/m2600Synth';
import { addCord, jackName, orient, parse, resolve, serialize } from '../devices/m2600Cords';

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
  const render = (i: number, withCords: boolean) => {
    const s = new M2600Synth();
    s.loadSlot(i);
    const p: Record<string, number> = { bend: 0, modw: 0 };
    for (const def of M2600_PARAMS) {
      const v = s.control(def.id).value;
      p[def.id] = typeof v === 'boolean' ? (v ? 1 : 0) : typeof v === 'string' ? def.options!.indexOf(v) : v;
    }
    let seed = 7;
    const core = new mod.M26Core(SR, () => ((seed = (seed * 1664525 + 1013904223) >>> 0) / 4294967296)) as unknown as {
      setCords(c: unknown): void; play(n1: number, n2: number, g: boolean, r: boolean): void;
      process(l: Float32Array, r: Float32Array, n: number, p: Record<string, number>): void;
    };
    if (withCords) core.setCords(resolve(s.cords));
    (core as unknown as { seqMessage(m: unknown): void }).seqMessage({ type: 'sq', action: 'run' });
    core.play(60, 60, true, true);
    const l = new Float32Array(SR), r = new Float32Array(SR);
    for (let at = 0; at < SR; at += 128) core.process(l.subarray(at, at + 128), r.subarray(at, at + 128), 128, p);
    return l;
  };
  for (const [i, preset] of M2600_FACTORY.entries()) {
    if (!preset.values.cords) continue;
    it(`"${preset.name}" really depends on its cords`, () => {
      const a = render(i, true), b = render(i, false);
      let diff = 0, ref = 0;
      for (let k = 0; k < a.length; k++) { diff += (a[k]! - b[k]!) ** 2; ref += a[k]! ** 2; }
      expect(Math.sqrt(diff / ref)).toBeGreaterThan(0.2);
    });
  }
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
      const c2 = core as unknown as { setCords(c: unknown): void; seqMessage(m: unknown): void };
      c2.setCords(resolve(s.cords));
      if (s.cords.some((c) => c.from.startsWith('sq.'))) c2.seqMessage({ type: 'sq', action: 'run' });
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

describe('patch cords', () => {
  it('orients a cord whichever end you start from, and refuses two outputs, two inputs or two MULT jacks', () => {
    expect(orient('vcf.cv.vco2', 'sh.out')).toEqual({ from: 'sh.out', to: 'vcf.cv.vco2' });
    expect(orient('vco1.saw', 'vco2.saw')).toBeUndefined();
    expect(orient('vcf.in.vco1', 'vcf.in.vco2')).toBeUndefined();
    expect(orient('mult.1', 'mult.2')).toBeUndefined();
    expect(orient('vcf.in.vco1', 'mult.3')).toEqual({ from: 'mult.3', to: 'vcf.in.vco1' });
    expect(orient('nope', 'vcf.out')).toBeUndefined();
  });

  it('an input takes one plug (a new cord replaces it); outputs stack', () => {
    let cords = addCord([], { from: 'sh.out', to: 'vcf.cv.vco2' });
    cords = addCord(cords, { from: 'sh.out', to: 'vco1.fm.sh' });
    expect(cords).toHaveLength(2);
    cords = addCord(cords, { from: 'lfo.tri', to: 'vcf.cv.vco2' });
    expect(cords).toEqual([{ from: 'sh.out', to: 'vco1.fm.sh' }, { from: 'lfo.tri', to: 'vcf.cv.vco2' }]);
  });

  it('the MULT passes its one source to every cord out of it', () => {
    let cords = addCord([], { from: 'lfo.tri', to: 'mult.1' });
    cords = addCord(cords, { from: 'mult.2', to: 'vcf.cv.vco2' });
    cords = addCord(cords, { from: 'mult.4', to: 'vco2.pwm' });
    expect(resolve(cords)).toEqual([{ from: 'lfo.tri', to: 'vcf.cv.vco2' }, { from: 'lfo.tri', to: 'vco2.pwm' }]);
    cords = addCord(cords, { from: 'adsr.out', to: 'mult.3' }); // a second source replaces the first
    expect(resolve(cords).map((c) => c.from)).toEqual(['adsr.out', 'adsr.out']);
    expect(resolve([{ from: 'mult.2', to: 'vcf.cv.vco2' }])).toEqual([]); // nothing feeds it
  });

  it('round-trips through patch text, dropping anything invalid', () => {
    const cords = parse('lfo.tri>mult.1;mult.2>vcf.cv.vco2;junk>vcf.out;vco1.saw>vco2.saw');
    expect(serialize(cords)).toBe('lfo.tri>mult.1;mult.2>vcf.cv.vco2');
  });

  it('the synth sends resolved cords to the worklet, keeps them on the node, and saves them in patches', () => {
    const s = new M2600Synth();
    const sent: unknown[] = [];
    s.circuit.onChange((c) => { if (c.type === 'message') sent.push(c.data); });
    expect(s.connect('vcf.cv.vco2', 'sh.out')).toBe(true);
    expect(s.connect('vco1.saw', 'vco2.saw')).toBe(false);
    expect(sent.at(-1)).toEqual({ type: 'cords', cords: [{ from: 'sh.out', to: 'vcf.cv.vco2' }] });
    expect(JSON.parse(s.circuit.node('synth').options.cords!)).toEqual([{ from: 'sh.out', to: 'vcf.cv.vco2' }]);
    s.saveSlot(20);
    s.loadSlot(0);
    expect(s.cords).toEqual([]); // Init has no cords
    s.loadSlot(20);
    expect(s.cords).toEqual([{ from: 'sh.out', to: 'vcf.cv.vco2' }]);
    s.unplug('sh.out');
    expect(s.cords).toEqual([]);
  });

  it('names jacks for people', () => {
    expect(jackName('vcf.in.vco1')).toBe('VCF · Audio VCO 1');
    expect(jackName('vco2.sine')).toBe('VCO 2 · sine');
    expect(jackName('mult.3')).toBe('Mult · 3');
  });

  it('every jack on the table has a readable name', () => {
    for (const id of ['kb.cv', 'kb.upper', 'esw.c', 'vp.inv1', 'sh.extclk', 'out.left']) expect(jackName(id)).not.toMatch(/undefined/);
  });
});

describe('MOA-SQ16 on the device', () => {
  it('steps on MIDI clock at the chosen division when synced, and follows MIDI start and stop', () => {
    const s = new M2600Synth();
    const sent: unknown[] = [];
    s.circuit.onChange((c) => { if (c.type === 'message') sent.push(c.data); });
    s.handleMidi({ type: 'clock' });
    expect(sent).toEqual([]); // internal clock: MIDI clock ignored
    choose(s, 'sq.sync', 'midi');
    choose(s, 'sq.div', '1/8');
    s.handleMidi({ type: 'start' });
    for (let i = 0; i < 24; i++) s.handleMidi({ type: 'clock' });
    expect(sent.filter((m) => (m as { type: string }).type === 'sqtick')).toHaveLength(2);
    expect(sent.slice(0, 2)).toEqual([{ type: 'sq', action: 'reset' }, { type: 'sq', action: 'run' }]);
    s.handleMidi({ type: 'stop' });
    expect(sent.at(-1)).toEqual({ type: 'sq', action: 'stop' });
  });

  it('the sequencer jacks patch like any other, with their own MULT', () => {
    const s = new M2600Synth();
    expect(s.connect('sq.cgate1', 'adsr.gate')).toBe(true);
    expect(s.connect('sq.qa', 'sq.mult.1')).toBe(true);
    expect(s.connect('sq.mult.2', 'vco1.fm.kybd')).toBe(true);
    expect(resolve(s.cords)).toEqual([{ from: 'sq.cgate1', to: 'adsr.gate' }, { from: 'sq.qa', to: 'vco1.fm.kybd' }]);
    expect(jackName('sq.cgate1')).toBe('SQ16 · clocked gate 1');
  });
});

describe('retired controls', () => {
  it('a patch saved with the old SEM route switch still loads (the value is ignored)', () => {
    const s = new M2600Synth();
    s.slots[30] = { name: 'Old', values: { 'sem.route': 'series', 'vcf.res': 0.4 } };
    expect(() => s.loadSlot(30)).not.toThrow();
    expect(s.control('vcf.res').value).toBeCloseTo(0.4);
    expect(s.snapshot()['sem.route']).toBeUndefined();
  });
});
