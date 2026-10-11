import { Device } from './device';
import { NumberControl, ToggleControl } from './controls';

const LOW_CUT_HZ = 75;
const LOW_CUT_OFF_HZ = 10; // effectively transparent
const EQ_RANGE_DB = 15;

export const BUSES = ['A', 'B', 'C'] as const;
export type Bus = (typeof BUSES)[number];
export const AUX_COUNT = 6;
/** Pre/post is switched per aux pair (1-2, 3-4, 5-6). */
export const AUX_PAIRS = [
  [1, 2],
  [3, 4],
  [5, 6],
] as const;

/**
 * Mixer: N channel strips, optional stereo FX return strips, three independent stereo buses (A/B/C)
 * and six aux buses.
 *
 * Strip: low cut -> EQ -> soft-clipping gain stage -> mute/solo gate -> fader -> pan -> bus assigns.
 * The gain stage is transparent up to 0.6 and eases hot signals into a ceiling at 1.0, like an analogue
 * channel, instead of letting them clip hard.
 * Aux sends tap after the mute gate (pre-fader) or after the fader (post-fader), per pair.
 * FX returns are the same strip in stereo (pan acts as balance, no solo) with all six aux sends. A return
 * can send to its own aux (an effect feeding itself through the desk) and to the other effects (echoing
 * into the reverb): the dub tricks. Every such loop passes through a delay line, and the main output's
 * limiter and ceiling keep even a runaway loop inside the speakers' range.
 * Each bus has a "To main" switch: turn it off and the bus only goes where it is patched (e.g. into an
 * effect that returns on a strip). A return that is fed by a bus can't be assigned back to that bus.
 * A fixed `main` output sums the three buses through a limiter and a hard ceiling just under full scale, so
 * runaway feedback is loud but can never leave the speakers' range.
 */
export class Mixer extends Device {
  readonly name: string;
  private readonly muted = new Set<number>();
  private readonly soloed = new Set<number>();

  /** `returnFeeds` names the bus that feeds a return (by number), so that return has no assign to that bus. */
  constructor(
    readonly channelCount = 1,
    name = 'Mixer',
    readonly returnCount = 0,
    private readonly returnFeeds: Partial<Record<number, Bus>> = {},
  ) {
    super();
    this.name = name;
    const c = this.circuit;

    // Masters: three stereo buses, six aux buses, and the summed main output.
    c.add('main', 'gain', { gain: 1 })
      .add('limiter', 'compressor', { threshold: -2, knee: 0, ratio: 20, attack: 0.002, release: 0.12 })
      .add('ceiling', 'waveshaper', {}, { curve: 'limit' })
      .add('mainMeter', 'meter', {}, { channel: 'mono' })
      .connect('main', 'limiter')
      .connect('limiter', 'ceiling')
      .connect('ceiling', 'mainMeter');
    this.outputList.push({ name: 'main', nodeId: 'ceiling' });
    this.meterList.push({ name: 'main', nodeId: 'mainMeter' });
    for (const bus of BUSES) {
      const id = `bus${bus}`;
      c.add(id, 'gain', { gain: 1 })
        .add(`${id}.toMain`, 'gain', { gain: 1 })
        .add(`${id}.meterL`, 'meter', {}, { channel: 'left' })
        .add(`${id}.meterR`, 'meter', {}, { channel: 'right' })
        .connect(id, `${id}.toMain`)
        .connect(`${id}.toMain`, 'main')
        .connect(id, `${id}.meterL`)
        .connect(id, `${id}.meterR`);
      this.outputList.push({ name: id, nodeId: id });
      this.meterList.push({ name: `${id}.L`, nodeId: `${id}.meterL` }, { name: `${id}.R`, nodeId: `${id}.meterR` });
      this.controlList.push(
        new NumberControl(`${id}.fader`, `Bus ${bus}`, 0, 1.5, 1, '', (v) => c.setParam(id, 'gain', v)),
        new ToggleControl(`${id}.main`, 'To main', true, (on) => c.setParam(`${id}.toMain`, 'gain', on ? 1 : 0)),
      );
    }
    for (let k = 1; k <= AUX_COUNT; k++) {
      c.add(`aux${k}`, 'gain', { gain: 1 });
      this.outputList.push({ name: `aux${k}`, nodeId: `aux${k}` });
      this.controlList.push(
        new NumberControl(`aux${k}.master`, `Aux ${k}`, 0, 1.5, 1, '', (v) => c.setParam(`aux${k}`, 'gain', v)),
      );
    }

    for (let i = 1; i <= channelCount; i++) this.addStrip(`ch${i}`, i, false);
    for (let r = 1; r <= returnCount; r++) this.addStrip(`ret${r}`, r, true);
  }

  /** Builds one strip. Channels are mono with solo; returns are stereo, with mute only. */
  private addStrip(prefix: string, i: number, isReturn: boolean): void {
    const c = this.circuit;
    const id = (n: string) => `${prefix}.${n}`;

    c.add(id('lowcut'), 'filter', { frequency: LOW_CUT_OFF_HZ, Q: 0.707, gain: 0 }, { type: 'highpass' })
      .add(id('eqLow'), 'filter', { frequency: 80, Q: 0.707, gain: 0 }, { type: 'lowshelf' })
      .add(id('eqMid'), 'filter', { frequency: 2500, Q: 1, gain: 0 }, { type: 'peaking' })
      .add(id('eqHigh'), 'filter', { frequency: 12000, Q: 0.707, gain: 0 }, { type: 'highshelf' })
      .add(id('drive'), 'gain', { gain: 1 / 3 }) // scales the +/-3 input range onto the 'warm' curve
      .add(id('sat'), 'waveshaper', {}, { curve: 'warm' })
      .add(id('mute'), 'gain', { gain: 1 }) // mute/solo gate: also silences the aux sends
      .add(id('fader'), 'gain', { gain: 0.8 })
      .add(id('pan'), 'pan', { pan: 0 })
      .connect(id('lowcut'), id('eqLow'))
      .connect(id('eqLow'), id('eqMid'))
      .connect(id('eqMid'), id('eqHigh'))
      .connect(id('eqHigh'), id('drive'))
      .connect(id('drive'), id('sat'))
      .connect(id('sat'), id('mute'))
      .connect(id('mute'), id('fader'))
      .connect(id('fader'), id('pan'));
    if (isReturn) {
      // Stereo: a meter per side, after the balance control.
      c.add(id('meterL'), 'meter', {}, { channel: 'left' })
        .add(id('meterR'), 'meter', {}, { channel: 'right' })
        .connect(id('pan'), id('meterL'))
        .connect(id('pan'), id('meterR'));
      this.meterList.push({ name: `${prefix}.L`, nodeId: id('meterL') }, { name: `${prefix}.R`, nodeId: id('meterR') });
    } else {
      c.add(id('meter'), 'meter', {}, { channel: 'mono' }).connect(id('fader'), id('meter'));
      this.meterList.push({ name: prefix, nodeId: id('meter') });
    }
    this.inputList.push({ name: prefix, nodeId: id('lowcut') });

    // Bus assigns: pan -> gate -> bus. (Not the bus that feeds this return: that would be an endless loop.)
    const assignable = BUSES.filter((bus) => !(isReturn && this.returnFeeds[i] === bus));
    for (const bus of assignable) {
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

    this.controlList.push(num('pan', isReturn ? 'Balance' : 'Pan', -1, 1, 0, '', (v) => c.setParam(id('pan'), 'pan', v)));
    if (isReturn) {
      this.controlList.push(new ToggleControl(id('mute'), 'Mute', false, (on) => c.setParam(id('mute'), 'gain', on ? 0 : 1)));
    } else {
      this.controlList.push(
        new ToggleControl(id('mute'), 'Mute', false, (on) => this.setFlag(this.muted, i, on)),
        new ToggleControl(id('solo'), 'Solo', false, (on) => this.setFlag(this.soloed, i, on)),
      );
    }
    for (const bus of assignable) {
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
