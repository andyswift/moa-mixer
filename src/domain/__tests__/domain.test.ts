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

  it('gates both envelopes with notes', () => {
    const s = new Synthesizer();
    s.noteOn(220);
    expect(s.circuit.node('pitch').params.offset).toBeCloseTo(-1200); // A3 = one octave below A4
    expect(s.circuit.node('ampEnv').params.gate).toBe(1);
    expect(s.circuit.node('filterEnv').params.gate).toBe(1);
    s.noteOff();
    expect(s.circuit.node('ampEnv').params.gate).toBe(0);
    expect(s.circuit.node('filterEnv').params.gate).toBe(0);
  });

  it('pitch CV and range feed every oscillator, so the sub tracks', () => {
    const { cables } = new Synthesizer().circuit;
    for (const osc of ['sawOsc', 'pulseOsc', 'subOsc']) {
      expect(cables).toContainEqual({ from: 'pitch', to: osc, port: 'detune' });
      expect(cables).toContainEqual({ from: 'range', to: osc, port: 'detune' });
    }
  });

  it('range, sub mode and pulse width map to CV offsets', () => {
    const s = new Synthesizer();
    const choice = (id: string, v: string) => {
      const c = s.control(id);
      if (c.kind !== 'choice') throw new Error('expected choice');
      c.set(v);
    };
    choice('osc.range', "4'");
    choice('osc.sub', '-2');
    const width = s.control('osc.width');
    if (width.kind !== 'number') throw new Error('expected number');
    width.set(25);
    expect(s.circuit.node('range').params.offset).toBe(1200);
    expect(s.circuit.node('subShift').params.offset).toBe(-2400);
    expect(s.circuit.node('pulseWidthCv').params.offset).toBeCloseTo(0.5);
    width.set(50);
    expect(s.circuit.node('pulseWidthCv').params.offset).toBeCloseTo(0);
  });

  it('source mix levels set the mix gains', () => {
    const s = new Synthesizer();
    const pulse = s.control('mix.pulse');
    if (pulse.kind !== 'number') throw new Error('expected number');
    pulse.set(0.7);
    expect(s.circuit.node('mix.pulse').params.gain).toBe(0.7);
  });

  it('wires ampEnv to the VCA and filterEnv to the filter cutoff', () => {
    const { cables } = new Synthesizer().circuit;
    expect(cables).toContainEqual({ from: 'ampEnv', to: 'amp', port: 'gain' });
    expect(cables).toContainEqual({ from: 'filterEnv', to: 'filterEnvDepth', port: 'in' });
    expect(cables).toContainEqual({ from: 'filterEnvDepth', to: 'filter', port: 'detune' });
  });

  it('envelope controls set ADSR params; amount is in octaves (cents internally)', () => {
    const s = new Synthesizer();
    const set = (id: string, v: number) => {
      const c = s.control(id);
      if (c.kind !== 'number') throw new Error('expected number');
      c.set(v);
    };
    set('ampEnv.attack', 0.5);
    set('filterEnv.sustain', 0.1);
    set('filterEnv.amount', 3);
    expect(s.circuit.node('ampEnv').params.attack).toBe(0.5);
    expect(s.circuit.node('filterEnv').params.sustain).toBe(0.1);
    expect(s.circuit.node('filterEnvDepth').params.gain).toBe(3600);
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

describe('Mixer strip', () => {
  const toggle = (m: Mixer, id: string) => {
    const c = m.control(id);
    if (c.kind !== 'toggle') throw new Error('expected toggle');
    return c;
  };

  it('solo silences other channels and restores them', () => {
    const m = new Mixer(3);
    toggle(m, 'ch2.solo').set(true);
    expect(m.circuit.node('ch1.mute').params.gain).toBe(0);
    expect(m.circuit.node('ch2.mute').params.gain).toBe(1);
    expect(m.circuit.node('ch3.mute').params.gain).toBe(0);
    toggle(m, 'ch2.solo').set(false);
    expect(m.circuit.node('ch1.mute').params.gain).toBe(1);
  });

  it('mute wins over solo on the same channel', () => {
    const m = new Mixer(2);
    toggle(m, 'ch1.solo').set(true);
    toggle(m, 'ch1.mute').set(true);
    expect(m.circuit.node('ch1.mute').params.gain).toBe(0);
  });

  it('low cut toggles the high-pass frequency', () => {
    const m = new Mixer(1);
    toggle(m, 'ch1.lowcutOn').set(true);
    expect(m.circuit.node('ch1.lowcut').params.frequency).toBe(75);
    toggle(m, 'ch1.lowcutOn').set(false);
    expect(m.circuit.node('ch1.lowcut').params.frequency).toBe(10);
  });

  it('EQ gain is limited to +/-15 dB and pan to +/-1', () => {
    const m = new Mixer(1);
    const high = m.control('ch1.eqHigh');
    const pan = m.control('ch1.pan');
    if (high.kind !== 'number' || pan.kind !== 'number') throw new Error('expected number');
    high.set(40);
    pan.set(-5);
    expect(m.circuit.node('ch1.eqHigh').params.gain).toBe(15);
    expect(m.circuit.node('ch1.pan').params.pan).toBe(-1);
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
