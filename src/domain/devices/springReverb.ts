import { Device } from './device';
import { NumberControl } from './controls';

/** Every control with its default, so a panel can reset them all. */
export const SPRING_INIT: Record<string, number> = {
  'spring.length': 2, 'spring.tension': 0.5, 'spring.drip': 0.6, 'spring.tilt': 0, 'spring.dwell': 0.4, 'spring.mix': 0.25,
};

/** The wet signal is normalised in the worklet, so a little make-up brings it level with the dry sound. */
const WET_MAKEUP = 1.6;

/**
 * A spring reverb with a dry/wet mix, for putting after any instrument (it sits behind MOA-PIPE on the pipe page).
 *   in -> dry ----------------------------\
 *     \-> spring (two springs, stereo) -> wet -> limiter -> out
 * Controls: Length (how long the tail rings), Tension (a tight spring is short and quick, a slack one long and
 * slow), Drip (how strongly the spring's dispersion chirps), Tilt (darker to brighter tail), Dwell (how hard the
 * input drives the spring: more dwell, more splash and grit) and Mix.
 */
export class SpringReverb extends Device {
  readonly name: string;

  constructor(name = 'Spring') {
    super();
    this.name = name;
    const c = this.circuit;
    c.add('in', 'gain', { gain: 1 })
      .add('spring', 'spring', { tension: 0.5, drip: 0.6, decay: 2, tilt: 0, dwell: 0.4 })
      .add('dry', 'gain', { gain: 1 })
      .add('wet', 'gain', { gain: 0 })
      .add('sum', 'gain', { gain: 1 })
      .add('limiter', 'compressor', { threshold: -2, knee: 0, ratio: 20, attack: 0.002, release: 0.12 })
      .add('out', 'gain', { gain: 1 })
      .add('meterL', 'meter', {}, { channel: 'left' })
      .add('meterR', 'meter', {}, { channel: 'right' })
      .connect('in', 'spring')
      .connect('in', 'dry')
      .connect('spring', 'wet')
      .connect('dry', 'sum')
      .connect('wet', 'sum')
      .connect('sum', 'limiter')
      .connect('limiter', 'out')
      .connect('out', 'meterL')
      .connect('out', 'meterR');
    this.inputList.push({ name: 'in', nodeId: 'in' });
    this.outputList.push({ name: 'out', nodeId: 'out' });
    this.meterList.push({ name: 'out.L', nodeId: 'meterL' }, { name: 'out.R', nodeId: 'meterR' });

    const num = (id: string, label: string, min: number, max: number, unit: string,
      apply: (v: number) => void, curve?: 'linear' | 'log') =>
      this.controlList.push(new NumberControl(id, label, min, max, SPRING_INIT[id]!, unit, apply, curve));
    num('spring.length', 'Length', 0.2, 8, 's', (v) => c.setParam('spring', 'decay', v), 'log');
    num('spring.tension', 'Tension', 0, 1, '', (v) => c.setParam('spring', 'tension', v));
    num('spring.drip', 'Drip', 0, 1, '', (v) => c.setParam('spring', 'drip', v));
    num('spring.tilt', 'Tilt', -1, 1, '', (v) => c.setParam('spring', 'tilt', v));
    num('spring.dwell', 'Dwell', 0, 1, '', (v) => c.setParam('spring', 'dwell', v));
    num('spring.mix', 'Dry / wet', 0, 1, '', (v) => {
      c.setParam('dry', 'gain', Math.cos((v * Math.PI) / 2));
      c.setParam('wet', 'gain', Math.sin((v * Math.PI) / 2) * WET_MAKEUP);
    });
  }

  /** Back to the factory settings. */
  reset(): void {
    for (const c of this.controlList) if (c.kind === 'number') c.set(c.initial);
  }
}
