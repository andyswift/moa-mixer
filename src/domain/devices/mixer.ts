import { Device } from './device';
import { NumberControl, ToggleControl } from './controls';

const LOW_CUT_HZ = 75;
const LOW_CUT_OFF_HZ = 10; // effectively transparent
const EQ_RANGE_DB = 15;

/** Mixer with N channel strips feeding one stereo bus. (More buses/aux come in later iterations.) */
export class Mixer extends Device {
  readonly name: string;
  private readonly muted = new Set<number>();
  private readonly soloed = new Set<number>();

  constructor(readonly channelCount = 1, name = 'Mixer') {
    super();
    this.name = name;
    const c = this.circuit;
    c.add('main', 'gain', { gain: 1 });
    this.outputList.push({ name: 'main', nodeId: 'main' });

    for (let i = 1; i <= channelCount; i++) {
      const id = (n: string) => `ch${i}.${n}`;
      // low cut -> EQ (low shelf, sweep mid, high shelf) -> fader -> mute/solo gate -> pan -> main
      c.add(id('lowcut'), 'filter', { frequency: LOW_CUT_OFF_HZ, Q: 0.707, gain: 0 }, { type: 'highpass' })
        .add(id('eqLow'), 'filter', { frequency: 80, Q: 0.707, gain: 0 }, { type: 'lowshelf' })
        .add(id('eqMid'), 'filter', { frequency: 2500, Q: 1, gain: 0 }, { type: 'peaking' })
        .add(id('eqHigh'), 'filter', { frequency: 12000, Q: 0.707, gain: 0 }, { type: 'highshelf' })
        .add(id('fader'), 'gain', { gain: 0.8 })
        .add(id('mute'), 'gain', { gain: 1 })
        .add(id('pan'), 'pan', { pan: 0 })
        .connect(id('lowcut'), id('eqLow'))
        .connect(id('eqLow'), id('eqMid'))
        .connect(id('eqMid'), id('eqHigh'))
        .connect(id('eqHigh'), id('fader'))
        .connect(id('fader'), id('mute'))
        .connect(id('mute'), id('pan'))
        .connect(id('pan'), 'main');
      this.inputList.push({ name: `ch${i}`, nodeId: id('lowcut') });

      const num = (cid: string, label: string, min: number, max: number, init: number, unit: string,
        apply: (v: number) => void, curve?: 'linear' | 'log') =>
        new NumberControl(id(cid), label, min, max, init, unit, apply, curve);
      const gainDb = (cid: string, label: string, node: string) =>
        num(cid, label, -EQ_RANGE_DB, EQ_RANGE_DB, 0, 'dB', (v) => c.setParam(id(node), 'gain', v));

      this.controlList.push(
        new ToggleControl(id('lowcutOn'), 'Low cut', false, (on) =>
          c.setParam(id('lowcut'), 'frequency', on ? LOW_CUT_HZ : LOW_CUT_OFF_HZ)),
        gainDb('eqHigh', 'High', 'eqHigh'),
        gainDb('eqMid', 'Mid', 'eqMid'),
        num('eqMidFreq', 'Mid freq', 100, 8000, 2500, 'Hz', (v) => c.setParam(id('eqMid'), 'frequency', v), 'log'),
        gainDb('eqLow', 'Low', 'eqLow'),
        num('pan', 'Pan', -1, 1, 0, '', (v) => c.setParam(id('pan'), 'pan', v)),
        new ToggleControl(id('mute'), 'Mute', false, (on) => this.setFlag(this.muted, i, on)),
        new ToggleControl(id('solo'), 'Solo', false, (on) => this.setFlag(this.soloed, i, on)),
        num('fader', 'Fader', 0, 1.5, 0.8, '', (v) => c.setParam(id('fader'), 'gain', v)),
      );
    }

    this.controlList.push(
      new NumberControl('main.fader', 'Fader', 0, 1.5, 1, '', (v) => c.setParam('main', 'gain', v)),
    );
  }

  /** Solo-in-place: while any channel is soloed, all non-soloed channels are silenced. */
  private setFlag(set: Set<number>, channel: number, on: boolean): void {
    if (on) set.add(channel);
    else set.delete(channel);
    // Controls apply during construction before every strip exists; skip nodes not yet added.
    for (let i = 1; i <= this.channelCount; i++) {
      const id = `ch${i}.mute`;
      if (!this.circuit.nodes.has(id)) continue;
      const silent = this.muted.has(i) || (this.soloed.size > 0 && !this.soloed.has(i));
      this.circuit.setParam(id, 'gain', silent ? 0 : 1);
    }
  }
}
