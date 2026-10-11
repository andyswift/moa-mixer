import { describe, expect, it } from 'vitest';
import { Circuit } from '../circuit/circuit';
import { Mixer } from '../devices/mixer';
import { Synthesizer } from '../devices/synthesizer';
import { Patch } from '../patch/patch';

describe('Circuit', () => {
  it('rejects duplicate nodes and unknown endpoints', () => {
    const c = new Circuit().add('a', 'gain', { gain: 1 });
    expect(() => c.add('a', 'gain')).toThrow();
    expect(() => c.connect('a', 'missing')).toThrow();
  });

  it('allows CV cables to params but not to unknown params', () => {
    const c = new Circuit()
      .add('lfo', 'oscillator', { frequency: 5 }, { waveform: 'sine' })
      .add('g', 'gain', { gain: 1 });
    expect(() => c.connect('lfo', 'g', 'gain')).not.toThrow();
    expect(() => c.connect('lfo', 'g', 'nope')).toThrow();
  });

  it('emits changes', () => {
    const c = new Circuit().add('g', 'gain', { gain: 1 });
    const seen: number[] = [];
    c.onChange((ch) => ch.type === 'param' && seen.push(ch.value));
    c.setParam('g', 'gain', 0.3);
    expect(seen).toEqual([0.3]);
  });
});

describe('Synthesizer', () => {
  it('maps controls to circuit params and clamps', () => {
    const s = new Synthesizer();
    const cutoff = s.control('cutoff');
    if (cutoff.kind !== 'number') throw new Error('expected number');
    cutoff.set(999999);
    expect(cutoff.value).toBe(20000);
    expect(s.circuit.node('filter').params.frequency).toBe(20000);
  });

  it('gates notes', () => {
    const s = new Synthesizer();
    s.noteOn(220);
    expect(s.circuit.node('osc').params.frequency).toBe(220);
    expect(s.circuit.node('gate').params.gain).toBe(1);
    s.noteOff();
    expect(s.circuit.node('gate').params.gain).toBe(0);
  });
});

describe('Mixer', () => {
  it('mute silences the strip', () => {
    const m = new Mixer(2);
    const mute = m.control('ch2.mute');
    if (mute.kind !== 'toggle') throw new Error('expected toggle');
    mute.set(true);
    expect(m.circuit.node('ch2.mute').params.gain).toBe(0);
    mute.set(false);
    expect(m.circuit.node('ch2.mute').params.gain).toBe(1);
  });
});

describe('Patch', () => {
  it('default patch routes synth to mixer channel 1', () => {
    const p = Patch.default();
    expect(p.connections).toHaveLength(1);
    expect(p.output).toEqual({ device: 'mixer', jack: 'main' });
  });

  it('rejects unknown jacks', () => {
    const p = Patch.default();
    expect(() => p.connect({ device: 'synth', jack: 'nope' }, { device: 'mixer', jack: 'ch1' })).toThrow();
  });
});
