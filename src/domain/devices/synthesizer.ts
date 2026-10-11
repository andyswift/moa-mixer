import { Device } from './device';
import { ChoiceControl, NumberControl } from './controls';

export const WAVEFORMS = ['sine', 'triangle', 'sawtooth', 'square'] as const;

/** Monophonic subtractive synth: oscillator -> filter -> gate -> level. */
export class Synthesizer extends Device {
  readonly name: string;

  constructor(name = 'Synth') {
    super();
    this.name = name;
    const c = this.circuit;
    c.add('osc', 'oscillator', { frequency: 440, detune: 0 }, { waveform: 'sawtooth' })
      .add('filter', 'filter', { frequency: 2000, Q: 1 }, { type: 'lowpass' })
      .add('gate', 'gain', { gain: 0 })
      .add('level', 'gain', { gain: 0.5 })
      .connect('osc', 'filter')
      .connect('filter', 'gate')
      .connect('gate', 'level');
    this.outputList.push({ name: 'out', nodeId: 'level' });

    this.controlList.push(
      new ChoiceControl('waveform', 'Waveform', WAVEFORMS, 'sawtooth', (v) =>
        c.setOption('osc', 'waveform', v),
      ),
      new NumberControl('cutoff', 'Cutoff', 20, 20000, 2000, 'Hz', (v) =>
        c.setParam('filter', 'frequency', v), 'log'),
      new NumberControl('resonance', 'Resonance', 0.1, 20, 1, '', (v) =>
        c.setParam('filter', 'Q', v)),
      new NumberControl('level', 'Level', 0, 1, 0.5, '', (v) => c.setParam('level', 'gain', v)),
    );
  }

  noteOn(hz: number): void {
    this.circuit.setParam('osc', 'frequency', hz);
    this.circuit.setParam('gate', 'gain', 1);
  }

  noteOff(): void {
    this.circuit.setParam('gate', 'gain', 0);
  }
}
