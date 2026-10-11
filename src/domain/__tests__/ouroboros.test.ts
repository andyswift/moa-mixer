import { describe, expect, it } from 'vitest';
import type { CircuitChange } from '../circuit/circuit';
import { Mixer } from '../devices/mixer';
import { OURO_INIT, OURO_PRESETS, OuroborosFx } from '../devices/ouroboros';
import { SOFT_UNITY } from '../devices/sendFx';
import type { ToggleControl } from '../devices/controls';
import { Patch } from '../patch/patch';

const set = (d: OuroborosFx, id: string, v: number | string | boolean) => (d.control(id) as { set(v: unknown): void }).set(v);
const param = (d: OuroborosFx, node: string, name: string) => d.circuit.node(node).params[name]!;
// The effective feedback gain, with the clip stage's drive multiplied back in (so it reads as the knob value).
const fb = (d: OuroborosFx, path: string) =>
  Math.round(param(d, `fb${path}`, 'gain') * (1 + (d.control(`ouro.${path[0]!.toLowerCase()}.clip`) as { value: number }).value * 7) * 1e6) / 1e6;
// Link and bounce taps also divide out the source channel's clip drive; multiply it back in to read the intended gain.
const linkGain = (d: OuroborosFx) => Math.round(param(d, 'linkAB', 'gain') * (1 + (d.control('ouro.a.clip') as { value: number }).value * 7) * 1e6) / 1e6;
const bounceGain = (d: OuroborosFx) => Math.round(param(d, 'bounceBA', 'gain') * (1 + (d.control('ouro.b.clip') as { value: number }).value * 7) * 1e6) / 1e6;
const has = (d: OuroborosFx, from: string, to: string, port = 'in') => d.circuit.cables.some((c) => c.from === from && c.to === to && c.port === port);

describe('Ouroboros structure', () => {
  it('has a stereo input, a mono-summed wet path and a dry path, and one output', () => {
    const o = new OuroborosFx();
    expect(o.inputs.map((j) => j.name)).toEqual(['in']);
    expect(o.outputs.map((j) => j.name)).toEqual(['out']);
    expect(o.circuit.node('mono').options.channels).toBe('mono');
    expect(has(o, 'in', 'dry')).toBe(true);
    expect(has(o, 'in', 'mono')).toBe(true);
  });

  it('runs each channel as gain, delay, grit, filter, clip, level in that order', () => {
    const o = new OuroborosFx();
    for (const X of ['A', 'B']) {
      const order = [`in${X}`, `on${X}`, `g${X}`, `sg${X}`, `dly${X}`, `tone${X}`, `crush${X}`, `filt${X}`, `cdrive${X}`, `clip${X}`, `lvl${X}`];
      for (let i = 0; i < order.length - 1; i++) expect(has(o, order[i]!, order[i + 1]!)).toBe(true);
      expect(o.circuit.node(`sg${X}`).options.curve).toBe('soft');
      expect(o.circuit.node(`clip${X}`).options.curve).toBe('soft');
      expect(o.circuit.node(`crush${X}`).options.curve).toBe('crush');
    }
  });

  it('has four feedback paths, each tapped after a clip stage and fed into a channel input that has a delay line', () => {
    const o = new OuroborosFx();
    for (const [from, to] of [['A', 'A'], ['A', 'B'], ['B', 'A'], ['B', 'B']]) {
      expect(has(o, `clip${from}`, `fb${from}${to}`)).toBe(true);
      expect(has(o, `fb${from}${to}`, `in${to}`)).toBe(true);
    }
  });
});

describe('Ouroboros seed', () => {
  it('feeds a very quiet noise floor into both channels so a loop above unity can start from silence', () => {
    const o = new OuroborosFx();
    expect(o.circuit.node('seedNoise').kind).toBe('noise');
    expect(has(o, 'seedGain', 'inA')).toBe(true);
    expect(has(o, 'seedGain', 'inB')).toBe(true);
    expect(param(o, 'seedGain', 'gain')).toBeLessThan(0.002); // under about -54 dB
    expect(param(o, 'seedGain', 'gain')).toBeGreaterThan(0);
  });
});

describe('Ouroboros controls', () => {
  it('master: equal-power mix keeps the dry sound at zero, input and output scale', () => {
    const o = new OuroborosFx();
    set(o, 'ouro.mix', 0);
    expect(param(o, 'dry', 'gain')).toBeCloseTo(1);
    expect(param(o, 'wet', 'gain')).toBeCloseTo(0);
    set(o, 'ouro.mix', 1);
    expect(param(o, 'dry', 'gain')).toBeCloseTo(0);
    expect(param(o, 'wet', 'gain')).toBeCloseTo(1);
    set(o, 'ouro.mix', 0.5);
    expect(param(o, 'dry', 'gain') ** 2 + param(o, 'wet', 'gain') ** 2).toBeCloseTo(1);
    set(o, 'ouro.input', 1.5);
    expect(param(o, 'inGain', 'gain')).toBe(1.5);
    set(o, 'ouro.output', 0.7);
    expect(param(o, 'out', 'gain')).toBe(0.7);
  });

  it('channel controls reach their nodes: gain, delay, grit, filter, clip, level', () => {
    const o = new OuroborosFx();
    set(o, 'ouro.a.gain', 2);
    expect(param(o, 'gA', 'gain')).toBeCloseTo(2 * SOFT_UNITY);
    set(o, 'ouro.b.delay', 800);
    expect(param(o, 'dlyB', 'delayTime')).toBeCloseTo(0.8);
    set(o, 'ouro.a.grit', 0);
    expect(param(o, 'crushA', 'bits')).toBe(16);
    set(o, 'ouro.a.grit', 1);
    expect(param(o, 'crushA', 'bits')).toBe(3);
    set(o, 'ouro.a.cutoff', 5000);
    set(o, 'ouro.a.resonance', 12);
    expect(param(o, 'filtA', 'frequency')).toBe(5000);
    expect(param(o, 'filtA', 'Q')).toBe(12);
    set(o, 'ouro.b.filter', 'hp');
    expect(o.circuit.node('filtB').options.type).toBe('highpass');
    set(o, 'ouro.b.filter', 'lp');
    expect(o.circuit.node('filtB').options.type).toBe('lowpass');
    set(o, 'ouro.a.clip', 1);
    expect(param(o, 'cdriveA', 'gain')).toBeCloseTo(SOFT_UNITY * 8);
    set(o, 'ouro.b.level', 0.4);
    expect(param(o, 'lvlB', 'gain')).toBe(0.4);
  });

  it('a channel switched off shuts its input and cuts every feedback path it touches', () => {
    const o = new OuroborosFx();
    for (const p of ['aa', 'ab', 'ba', 'bb']) set(o, `ouro.fb.${p}`, 0.5);
    set(o, 'ouro.b.on', false);
    expect(param(o, 'onB', 'gain')).toBe(0);
    expect(fb(o, 'AA')).toBe(0.5);
    expect([fb(o, 'AB'), fb(o, 'BA'), fb(o, 'BB')]).toEqual([0, 0, 0]);
    set(o, 'ouro.b.on', true);
    expect(fb(o, 'BB')).toBe(0.5);
  });
});

describe('Ouroboros feedback matrix, Kill and Freeze', () => {
  it('feedback knobs set their path, and can go past 100%', () => {
    const o = new OuroborosFx();
    set(o, 'ouro.fb.ab', 0.6);
    set(o, 'ouro.fb.bb', 1.2);
    expect(fb(o, 'AB')).toBe(0.6);
    expect(fb(o, 'BB')).toBe(1.2);
  });

  it('Kill cuts all feedback while held and restores it on release', () => {
    const o = new OuroborosFx();
    for (const p of ['aa', 'ab', 'ba', 'bb']) set(o, `ouro.fb.${p}`, 0.8);
    set(o, 'ouro.kill', true);
    expect(['AA', 'AB', 'BA', 'BB'].map((p) => fb(o, p))).toEqual([0, 0, 0, 0]);
    set(o, 'ouro.kill', false);
    expect(['AA', 'AB', 'BA', 'BB'].map((p) => fb(o, p))).toEqual([0.8, 0.8, 0.8, 0.8]);
  });

  it('Freeze holds each channel\'s own loop at 100% and shuts the input; cross paths and release behave', () => {
    const o = new OuroborosFx();
    set(o, 'ouro.fb.aa', 0.2);
    set(o, 'ouro.fb.ab', 0.3);
    set(o, 'ouro.freeze', true);
    expect(fb(o, 'AA')).toBe(1);
    expect(fb(o, 'BB')).toBe(1);
    expect(fb(o, 'AB')).toBe(0.3);
    expect(param(o, 'srcGate', 'gain')).toBe(0);
    set(o, 'ouro.freeze', false);
    expect(fb(o, 'AA')).toBe(0.2);
    expect(param(o, 'srcGate', 'gain')).toBe(1);
  });

  it('Kill beats Freeze', () => {
    const o = new OuroborosFx();
    set(o, 'ouro.freeze', true);
    set(o, 'ouro.kill', true);
    expect(fb(o, 'AA')).toBe(0);
  });
});

describe('Ouroboros feedback and the clip stage', () => {
  it('Clip adds saturation, not loop gain: the raw path gain divides out the clip drive', () => {
    const o = new OuroborosFx();
    set(o, 'ouro.fb.aa', 0.5);
    set(o, 'ouro.a.clip', 0);
    expect(param(o, 'fbAA', 'gain')).toBeCloseTo(0.5);
    set(o, 'ouro.a.clip', 1);
    expect(param(o, 'fbAA', 'gain')).toBeCloseTo(0.5 / 8);
    // small-signal loop gain through the clip stage (drive 8) is back to the knob value
    expect(param(o, 'fbAA', 'gain') * 8).toBeCloseTo(0.5);
    // the other channel's clip does not affect this path
    set(o, 'ouro.b.clip', 0);
    expect(param(o, 'fbAA', 'gain')).toBeCloseTo(0.5 / 8);
    expect(param(o, 'fbBB', 'gain')).toBeCloseTo(OURO_INIT['ouro.fb.bb'] as number);
  });
});

describe('Ouroboros routing', () => {
  it('the series link and the ping-pong bounce divide out the clip drive, like the feedback paths', () => {
    const o = new OuroborosFx();
    set(o, 'ouro.routing', 'pingpong');
    set(o, 'ouro.a.clip', 1);
    set(o, 'ouro.b.clip', 0);
    expect(param(o, 'linkAB', 'gain')).toBeCloseTo(1 / 8);
    expect(param(o, 'bounceBA', 'gain')).toBeCloseTo(0.5);
    set(o, 'ouro.b.clip', 1);
    expect(param(o, 'bounceBA', 'gain')).toBeCloseTo(0.5 / 8);
  });

  it('parallel runs both channels on the input, hard left and right', () => {
    const o = new OuroborosFx();
    set(o, 'ouro.routing', 'parallel');
    expect([param(o, 'srcA', 'gain'), param(o, 'srcB', 'gain'), linkGain(o)]).toEqual([1, 1, 0]);
    expect([param(o, 'panA', 'pan'), param(o, 'panB', 'pan')]).toEqual([-1, 1]);
    expect(bounceGain(o)).toBe(0);
  });

  it('series feeds A into B, and only B is heard, in the centre', () => {
    const o = new OuroborosFx();
    set(o, 'ouro.routing', 'series');
    expect([param(o, 'srcB', 'gain'), linkGain(o), param(o, 'sendA', 'gain')]).toEqual([0, 1, 0]);
    expect(param(o, 'panB', 'pan')).toBe(0);
  });

  it('ping-pong feeds A into B, hears both left and right, and bounces B back into A', () => {
    const o = new OuroborosFx();
    set(o, 'ouro.routing', 'pingpong');
    expect([param(o, 'srcB', 'gain'), linkGain(o), param(o, 'sendA', 'gain')]).toEqual([0, 1, 1]);
    expect([param(o, 'panA', 'pan'), param(o, 'panB', 'pan')]).toEqual([-1, 1]);
    expect(bounceGain(o)).toBeGreaterThanOrEqual(0.5);
    set(o, 'ouro.kill', true);
    expect(bounceGain(o)).toBe(0);
  });
});

describe('Ouroboros modulator', () => {
  it('switches between LFO and envelope follower, and picks the LFO wave', () => {
    const o = new OuroborosFx();
    expect([param(o, 'lfoGate', 'gain'), param(o, 'envGate', 'gain')]).toEqual([1, 0]);
    set(o, 'ouro.mod.mode', 'env');
    expect([param(o, 'lfoGate', 'gain'), param(o, 'envGate', 'gain')]).toEqual([0, 1]);
    set(o, 'ouro.mod.wave', 'ramp');
    expect(o.circuit.node('lfoOsc').options.waveform).toBe('sawtooth');
    set(o, 'ouro.mod.wave', 'sqr');
    expect(o.circuit.node('lfoOsc').options.waveform).toBe('square');
    set(o, 'ouro.mod.wave', 'rnd');
    expect([param(o, 'lfoOscOut', 'gain'), param(o, 'lfoRndOut', 'gain')]).toEqual([0, 1]);
  });

  it('rate drives the LFO, the follower speed and the trigger decay; depth scales the whole modulator', () => {
    const o = new OuroborosFx();
    set(o, 'ouro.mod.rate', 3);
    expect(param(o, 'lfoOsc', 'frequency')).toBe(3);
    expect(param(o, 'followLp', 'frequency')).toBe(3);
    expect(param(o, 'modTrig', 'decay')).toBeCloseTo(0.5);
    set(o, 'ouro.mod.depth', 0.9);
    expect(param(o, 'modOut', 'gain')).toBe(0.9);
  });

  it('destination knobs are bipolar and scale to seconds, cents and gain', () => {
    const o = new OuroborosFx();
    set(o, 'ouro.mod.dlyA', 1);
    expect(param(o, 'mDlyA', 'gain')).toBeCloseTo(0.25);
    set(o, 'ouro.mod.cutB', -0.5);
    expect(param(o, 'mCutB', 'gain')).toBeCloseTo(-1800);
    set(o, 'ouro.mod.gainA', 0.5);
    expect(param(o, 'mGainA', 'gain')).toBeCloseTo(0.4);
    expect(o.circuit.cables).toContainEqual({ from: 'mDlyA', to: 'dlyA', port: 'delayTime' });
    expect(o.circuit.cables).toContainEqual({ from: 'mCutB', to: 'filtB', port: 'detune' });
    expect(o.circuit.cables).toContainEqual({ from: 'mGainA', to: 'gA', port: 'gain' });
  });

  it('the trigger key fires the modulator envelope when pressed, not when released', () => {
    const o = new OuroborosFx();
    const log: CircuitChange[] = [];
    o.circuit.onChange((c) => log.push(c));
    set(o, 'ouro.mod.trigger', true);
    set(o, 'ouro.mod.trigger', false);
    expect(log.filter((c) => c.type === 'trigger')).toHaveLength(1);
  });
});

describe('Ouroboros patches', () => {
  it('ships eight patches with the names from the design', () => {
    expect(OURO_PRESETS.map((x) => x.name)).toEqual([
      'Tape Spiral', 'Karaoke Drone', 'Ping Pong Mayhem', 'Dub Wash', 'Self Oscillator', 'Broken Echo', 'Filter Scream', 'Slow Rot',
    ]);
  });

  it('every patch loads, and loading one resets what the previous one changed', () => {
    const o = new OuroborosFx();
    for (const preset of OURO_PRESETS) expect(() => o.loadPreset(preset)).not.toThrow();
    o.loadPreset(OURO_PRESETS.find((x) => x.name === 'Filter Scream')!);
    expect(o.circuit.node('filtA').options.type).toBe('highpass');
    o.loadPreset({ name: 'Plain', values: {} });
    expect(o.circuit.node('filtA').options.type).toBe('lowpass');
    expect(param(o, 'filtA', 'frequency')).toBe(OURO_INIT['ouro.a.cutoff']);
    expect(param(o, 'srcB', 'gain')).toBe(1); // routing back to parallel
  });

  it('keeps each patch\'s loop gain below 1 so echoes die away, except the two meant to drone', () => {
    const o = new OuroborosFx();
    const drones = ['Karaoke Drone', 'Self Oscillator'];
    for (const preset of OURO_PRESETS) {
      o.loadPreset(preset);
      const v = (id: string) => (o.control(id) as { value: number }).value;
      const routing = (o.control('ouro.routing') as { value: string }).value;
      const link = routing === 'parallel' ? 0 : 1;
      const bounce = routing === 'pingpong' ? 0.5 : 0;
      // loop gain of the four paths with the series link on A > B (ignoring filter resonance peaks, which are narrow)
      const aa = v('ouro.fb.aa'), bb = v('ouro.fb.bb'), ab = v('ouro.fb.ab') + link, ba = v('ouro.fb.ba') + bounce;
      const radius = (aa + bb) / 2 + Math.sqrt(((aa - bb) / 2) ** 2 + ab * ba);
      if (drones.includes(preset.name)) expect(radius, preset.name).toBeGreaterThan(1);
      else expect(radius, preset.name).toBeLessThan(1);
    }
  });

  it('announces patch loads', () => {
    const o = new OuroborosFx();
    let n = 0;
    o.onPresetChange(() => n++);
    o.loadPreset(OURO_PRESETS[2]!);
    expect(n).toBe(1);
    expect(o.currentPreset.name).toBe('Ping Pong Mayhem');
  });
});

describe('Ouroboros patch slots and meters', () => {
  it('saves the current sound into a slot (not Kill or the trigger) and loads it back', () => {
    const o = new OuroborosFx();
    set(o, 'ouro.a.cutoff', 777);
    set(o, 'ouro.routing', 'pingpong');
    set(o, 'ouro.fb.ab', 0.9);
    set(o, 'ouro.kill', true);
    const saved = o.saveSlot(3);
    expect(saved.name).toBe('Dub Wash'); // the slot keeps its name
    expect(saved.values['ouro.kill']).toBeUndefined();
    expect(saved.values['ouro.mod.trigger']).toBeUndefined();
    set(o, 'ouro.kill', false);
    o.loadSlot(0);
    expect(param(o, 'filtA', 'frequency')).not.toBe(777);
    o.loadSlot(3);
    expect(param(o, 'filtA', 'frequency')).toBe(777);
    expect(fb(o, 'AB')).toBe(0.9);
    expect(o.currentSlot).toBe(3);
  });

  it('snapshot covers every control except Kill and the trigger, and a missing slot is rejected', () => {
    const o = new OuroborosFx();
    const ids = o.controls.map((c) => c.id).filter((id) => id !== 'ouro.kill' && id !== 'ouro.mod.trigger').sort();
    expect(Object.keys(o.snapshot()).sort()).toEqual(ids);
    expect(() => o.loadSlot(8)).toThrow();
  });

  it('has an L/R output meter pair', () => {
    const o = new OuroborosFx();
    expect(o.meters.map((m) => m.name)).toEqual(['L', 'R']);
    expect(o.circuit.node('meterL').options.channel).toBe('left');
    expect(o.circuit.node('meterR').options.channel).toBe('right');
  });
});

describe('Ouroboros on bus C in the default patch', () => {
  it('bus C feeds it, it returns on strip 3, and bus C is off main', () => {
    const p = Patch.default();
    const has = (from: [string, string], to: [string, string]) =>
      p.connections.some((c) => c.from.device === from[0] && c.from.jack === from[1] && c.to.device === to[0] && c.to.jack === to[1]);
    expect(has(['mixer', 'busC'], ['ouroboros', 'in'])).toBe(true);
    expect(has(['ouroboros', 'out'], ['mixer', 'ret3'])).toBe(true);
    const mixer = p.device<Mixer>('mixer');
    expect((mixer.control('busC.main') as ToggleControl).value).toBe(false);
    expect((mixer.control('busA.main') as ToggleControl).value).toBe(true);
    expect(mixer.controls.some((c) => c.id === 'ret3.busC')).toBe(false); // would loop back into itself
    expect(mixer.circuit.node('busC.toMain').params.gain).toBe(0);
  });
});
