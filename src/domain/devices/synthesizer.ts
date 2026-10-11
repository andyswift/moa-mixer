import { Device } from './device';
import { ChoiceControl, NumberControl } from './controls';
import type { Circuit } from '../circuit/circuit';

export const WAVEFORMS = ['sine', 'triangle', 'sawtooth', 'square'] as const;

const CENTS_PER_OCTAVE = 1200;

/**
 * Monophonic subtractive synth:
 *   oscillator -> filter -> amp (VCA) -> level
 * with two ADSR envelopes: ampEnv drives the VCA, filterEnv sweeps the filter cutoff.
 */
export class Synthesizer extends Device {
  readonly name: string;

  constructor(name = 'Synth') {
    super();
    this.name = name;
    const c = this.circuit;
    c.add('osc', 'oscillator', { frequency: 440, detune: 0 }, { waveform: 'sawtooth' })
      .add('filter', 'filter', { frequency: 800, Q: 1, detune: 0 }, { type: 'lowpass' })
      .add('amp', 'gain', { gain: 0 }) // silent until the amp envelope opens it
      .add('level', 'gain', { gain: 0.5 })
      .add('ampEnv', 'envelope', { attack: 0.005, decay: 0.2, sustain: 0.7, release: 0.3, gate: 0 })
      .add('filterEnv', 'envelope', { attack: 0.005, decay: 0.3, sustain: 0.3, release: 0.3, gate: 0 })
      .add('filterEnvDepth', 'gain', { gain: 2 * CENTS_PER_OCTAVE }) // envelope 0..1 -> cents
      .connect('osc', 'filter')
      .connect('filter', 'amp')
      .connect('amp', 'level')
      .connect('ampEnv', 'amp', 'gain')
      .connect('filterEnv', 'filterEnvDepth')
      .connect('filterEnvDepth', 'filter', 'detune');
    this.outputList.push({ name: 'out', nodeId: 'level' });

    this.controlList.push(
      new ChoiceControl('waveform', 'Waveform', WAVEFORMS, 'sawtooth', (v) =>
        c.setOption('osc', 'waveform', v)),
      new NumberControl('cutoff', 'Cutoff', 20, 20000, 800, 'Hz', (v) =>
        c.setParam('filter', 'frequency', v), 'log'),
      new NumberControl('resonance', 'Resonance', 0.1, 20, 1, '', (v) => c.setParam('filter', 'Q', v)),
      new NumberControl('level', 'Level', 0, 1, 0.5, '', (v) => c.setParam('level', 'gain', v)),
      new NumberControl('filterEnv.amount', 'Amount', 0, 6, 2, 'oct', (v) =>
        c.setParam('filterEnvDepth', 'gain', v * CENTS_PER_OCTAVE)),
      ...adsr(c, 'filterEnv', { attack: 0.005, decay: 0.3, sustain: 0.3, release: 0.3 }),
      ...adsr(c, 'ampEnv', { attack: 0.005, decay: 0.2, sustain: 0.7, release: 0.3 }),
    );
  }

  noteOn(hz: number): void {
    this.circuit.setParam('osc', 'frequency', hz);
    this.circuit.setParam('ampEnv', 'gate', 1);
    this.circuit.setParam('filterEnv', 'gate', 1);
  }

  noteOff(): void {
    this.circuit.setParam('ampEnv', 'gate', 0);
    this.circuit.setParam('filterEnv', 'gate', 0);
  }
}

function adsr(
  c: Circuit,
  node: string,
  d: { attack: number; decay: number; sustain: number; release: number },
): NumberControl[] {
  const time = (id: 'attack' | 'decay' | 'release', label: string, min: number, max: number) =>
    new NumberControl(`${node}.${id}`, label, min, max, d[id], 's', (v) => c.setParam(node, id, v), 'log');
  return [
    time('attack', 'Attack', 0.001, 5),
    time('decay', 'Decay', 0.005, 5),
    new NumberControl(`${node}.sustain`, 'Sustain', 0, 1, d.sustain, '', (v) => c.setParam(node, 'sustain', v)),
    time('release', 'Release', 0.005, 10),
  ];
}
