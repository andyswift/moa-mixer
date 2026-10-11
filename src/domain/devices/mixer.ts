import { Device } from './device';
import { NumberControl, ToggleControl } from './controls';

const LOW_CUT_HZ = 75;
const LOW_CUT_OFF_HZ = 10; // effectively transparent
const EQ_RANGE_DB = 15;

export const BUSES = ['A', 'B', 'C'] as const;
export const AUX_COUNT = 6;
/** Pre/post is switched per aux pair (1-2, 3-4, 5-6). */
export const AUX_PAIRS = [
  [1, 2],
  [3, 4],
  [5, 6],
] as const;

/**
 * Mixer: N channel strips, three independent stereo buses (A/B/C) and six aux buses.
 *
 * Strip: low cut -> EQ -> mute/solo gate -> fader -> pan -> bus assigns.
 * Aux sends tap after the mute gate (pre-fader) or after the fader (post-fader), per pair.
 * A fixed `main` output sums the three buses so the browser's single stereo output can hear them.
 */
export class Mixer extends Device {
  readonly name: string;
  private readonly muted = new Set<number>();
  private readonly soloed = new Set<number>();

  constructor(readonly channelCount = 1, name = 'Mixer') {
    super();
    this.name = name;
    const c = this.circuit;

    // Masters: three stereo buses, six aux buses, and the summed main output.
    c.add('main', 'gain', { gain: 1 });
    this.outputList.push({ name: 'main', nodeId: 'main' });
    for (const bus of BUSES) {
      const id = `bus${bus}`;
      c.add(id, 'gain', { gain: 1 })
        .add(`${id}.meterL`, 'meter', {}, { channel: 'left' })
        .add(`${id}.meterR`, 'meter', {}, { channel: 'right' })
        .connect(id, 'main')
        .connect(id, `${id}.meterL`)
        .connect(id, `${id}.meterR`);
      this.outputList.push({ name: id, nodeId: id });
      this.meterList.push({ name: `${id}.L`, nodeId: `${id}.meterL` }, { name: `${id}.R`, nodeId: `${id}.meterR` });
      this.controlList.push(
        new NumberControl(`${id}.fader`, `Bus ${bus}`, 0, 1.5, 1, '', (v) => c.setParam(id, 'gain', v)),
      );
    }
    for (let k = 1; k <= AUX_COUNT; k++) {
      c.add(`aux${k}`, 'gain', { gain: 1 });
      this.outputList.push({ name: `aux${k}`, nodeId: `aux${k}` });
      this.controlList.push(
        new NumberControl(`aux${k}.master`, `Aux ${k}`, 0, 1.5, 1, '', (v) => c.setParam(`aux${k}`, 'gain', v)),
      );
    }

    for (let i = 1; i <= channelCount; i++) this.addStrip(i);
  }

  private addStrip(i: number): void {
    const c = this.circuit;
    const id = (n: string) => `ch${i}.${n}`;

    c.add(id('lowcut'), 'filter', { frequency: LOW_CUT_OFF_HZ, Q: 0.707, gain: 0 }, { type: 'highpass' })
      .add(id('eqLow'), 'filter', { frequency: 80, Q: 0.707, gain: 0 }, { type: 'lowshelf' })
      .add(id('eqMid'), 'filter', { frequency: 2500, Q: 1, gain: 0 }, { type: 'peaking' })
      .add(id('eqHigh'), 'filter', { frequency: 12000, Q: 0.707, gain: 0 }, { type: 'highshelf' })
      .add(id('mute'), 'gain', { gain: 1 }) // mute/solo gate: also silences the aux sends
      .add(id('fader'), 'gain', { gain: 0.8 })
      .add(id('pan'), 'pan', { pan: 0 })
      .add(id('meter'), 'meter', {}, { channel: 'mono' })
      .connect(id('lowcut'), id('eqLow'))
      .connect(id('eqLow'), id('eqMid'))
      .connect(id('eqMid'), id('eqHigh'))
      .connect(id('eqHigh'), id('mute'))
      .connect(id('mute'), id('fader'))
      .connect(id('fader'), id('pan'))
      .connect(id('fader'), id('meter'));
    this.inputList.push({ name: `ch${i}`, nodeId: id('lowcut') });
    this.meterList.push({ name: `ch${i}`, nodeId: id('meter') });

    // Bus assigns: pan -> gate -> bus.
    for (const bus of BUSES) {
      c.add(id(`assign${bus}`), 'gain', { gain: 0 }).connect(id('pan'), id(`assign${bus}`)).connect(id(`assign${bus}`), `bus${bus}`);
    }

    // Aux sends: pre tap (after mute, before fader) and post tap (after fader), each gated by pre/post.
    for (let k = 1; k <= AUX_COUNT; k++) {
      c.add(id(`aux${k}.pre`), 'gain', { gain: 0 })
        .add(id(`aux${k}.post`), 'gain', { gain: 1 })
        .add(id(`aux${k}`), 'gain', { gain: 0 })
        .connect(id('mute'), id(`aux${k}.pre`))
        .connect(id('fader'), id(`aux${k}.post`))
        .connect(id(`aux${k}.pre`), id(`aux${k}`))
        .connect(id(`aux${k}.post`), id(`aux${k}`))
        .connect(id(`aux${k}`), `aux${k}`);
    }

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
      num('eqMidFreq', 'Freq', 100, 8000, 2500, 'Hz', (v) => c.setParam(id('eqMid'), 'frequency', v), 'log'),
      gainDb('eqLow', 'Low', 'eqLow'),
    );

    for (let k = 1; k <= AUX_COUNT; k++) {
      this.controlList.push(num(`aux${k}`, `${k}`, 0, 1, 0, '', (v) => c.setParam(id(`aux${k}`), 'gain', v)));
    }
    for (const [a, b] of AUX_PAIRS) {
      this.controlList.push(
        new ToggleControl(id(`auxPre${a}${b}`), `Pre ${a}-${b}`, false, (pre) => {
          for (const k of [a, b]) {
            c.setParam(id(`aux${k}.pre`), 'gain', pre ? 1 : 0);
            c.setParam(id(`aux${k}.post`), 'gain', pre ? 0 : 1);
          }
        }),
      );
    }

    this.controlList.push(
      num('pan', 'Pan', -1, 1, 0, '', (v) => c.setParam(id('pan'), 'pan', v)),
      new ToggleControl(id('mute'), 'Mute', false, (on) => this.setFlag(this.muted, i, on)),
      new ToggleControl(id('solo'), 'Solo', false, (on) => this.setFlag(this.soloed, i, on)),
    );
    for (const bus of BUSES) {
      this.controlList.push(
        new ToggleControl(id(`bus${bus}`), bus, bus === 'A', (on) => c.setParam(id(`assign${bus}`), 'gain', on ? 1 : 0)),
      );
    }
    this.controlList.push(num('fader', 'Fader', 0, 1.5, 0.8, '', (v) => c.setParam(id('fader'), 'gain', v)));
  }

  /** True while any channel is soloed (the UI lights a "solo active" indicator). */
  get soloActive(): boolean {
    return this.soloed.size > 0;
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
