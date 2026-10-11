import { Device } from './device';
import { ChoiceControl, NumberControl } from './controls';

export const REVERB_SIZES = ['small', 'medium', 'large'] as const;

/**
 * The convolver normalises its tail, so a single drum hit comes back well under the dry sound while a held
 * chord comes back louder. 3.5 balances them: a chord at full send returns about 1.2x its dry level.
 */
const REVERB_MAKEUP = 3.5;

/** Make-up gain that gives the soft-clip curve (a tanh normalised to +/-1) unity gain for small signals. */
const SOFT_UNITY = Math.tanh(2.5) / 2.5;

/** The reverb's output soft-clips at this amplitude, so a reverb fed back into itself on the desk stays bounded. */
const REVERB_CEILING = 2;

/**
 * Send reverb: mono in, stereo out.
 *   in -> pre-delay -> convolver (generated stereo tail) -> low cut -> damping low-pass -> soft ceiling -> out
 * The tail length comes from `size`; the return strip's EQ and fader do the rest. Always 100 % wet:
 * the dry sound stays on the channel and the aux send decides how much goes in.
 */
export class ReverbFx extends Device {
  readonly name: string;

  constructor(name = 'Reverb') {
    super();
    this.name = name;
    const c = this.circuit;
    c.add('in', 'gain', { gain: 1 }, { channels: 'mono' })
      .add('pre', 'delay', { delayTime: 0.02, maxTime: 0.3 })
      .add('conv', 'convolver', {}, { size: 'medium' })
      .add('lowcut', 'filter', { frequency: 150, Q: 0.707, detune: 0 }, { type: 'highpass' })
      .add('damp', 'filter', { frequency: 5000, Q: 0.707, detune: 0 }, { type: 'lowpass' })
      // Make-up gain, then a soft clipper that is transparent at normal levels and caps a runaway feedback loop.
      .add('drive', 'gain', { gain: (REVERB_MAKEUP * SOFT_UNITY) / REVERB_CEILING })
      .add('sat', 'waveshaper', {}, { curve: 'soft' })
      .add('out', 'gain', { gain: REVERB_CEILING })
      .connect('in', 'pre')
      .connect('pre', 'conv')
      .connect('conv', 'lowcut')
      .connect('lowcut', 'damp')
      .connect('damp', 'drive')
      .connect('drive', 'sat')
      .connect('sat', 'out');
    this.inputList.push({ name: 'in', nodeId: 'in' });
    this.outputList.push({ name: 'out', nodeId: 'out' });

    this.controlList.push(
      new ChoiceControl('reverb.size', 'Size', REVERB_SIZES, 'medium', (v) => c.setOption('conv', 'size', v)),
      new NumberControl('reverb.predelay', 'Pre-delay', 0, 250, 20, 'ms', (v) => c.setParam('pre', 'delayTime', v / 1000)),
      new NumberControl('reverb.lowcut', 'Low cut', 40, 600, 150, 'Hz', (v) => c.setParam('lowcut', 'frequency', v), 'log'),
      new NumberControl('reverb.damp', 'Damping', 1000, 16000, 5000, 'Hz', (v) => c.setParam('damp', 'frequency', v), 'log'),
    );
  }
}

/**
 * Send delay for dub: mono in, stereo out, with a saturated, darkening feedback loop.
 *
 * Two delay lines (left and right) each feed back through tone (low-pass), a high-pass that keeps the
 * repeats from turning to mud, and a soft clipper. `spread` moves the feedback from each line to itself
 * (0) towards the other line (1, ping-pong). The clipper keeps the loop bounded, so feedback can go past
 * 100 % and the echoes build into a loud, distorted wash instead of blowing up. `wobble` is a slow
 * tape-style variation of the delay time.
 */
export class DelayFx extends Device {
  readonly name: string;
  private spread = 0.8;
  private feedback = 0.45;

  constructor(name = 'Delay') {
    super();
    this.name = name;
    const c = this.circuit;

    c.add('in', 'gain', { gain: 1 }, { channels: 'mono' })
      .add('out', 'gain', { gain: 0.5 })
      .add('wobble', 'oscillator', { frequency: 0.9, detune: 0 }, { waveform: 'sine' })
      .add('wobbleDepth', 'gain', { gain: 0.0006 }); // seconds of delay-time swing
    for (const side of ['L', 'R'] as const) {
      const n = (name: string) => `${name}${side}`;
      c.add(n('inGain'), 'gain', { gain: 1 })
        .add(n('dly'), 'delay', { delayTime: 0.375, maxTime: 2 })
        .add(n('tone'), 'filter', { frequency: 3200, Q: 0.707, detune: 0 }, { type: 'lowpass' })
        .add(n('hp'), 'filter', { frequency: 120, Q: 0.707, detune: 0 }, { type: 'highpass' })
        .add(n('drive'), 'gain', { gain: 1.9 })
        .add(n('sat'), 'waveshaper', {}, { curve: 'soft' })
        .add(n('make'), 'gain', { gain: SOFT_UNITY / 1.9 })
        .add(n('fbSelf'), 'gain', { gain: 0 })
        .add(n('fbCross'), 'gain', { gain: 0 })
        .add(n('pan'), 'pan', { pan: side === 'L' ? -1 : 1 })
        .connect('in', n('inGain'))
        .connect(n('inGain'), n('dly'))
        .connect(n('dly'), n('tone'))
        .connect(n('tone'), n('hp'))
        .connect(n('hp'), n('drive'))
        .connect(n('drive'), n('sat'))
        .connect(n('sat'), n('make'))
        .connect(n('make'), n('fbSelf'))
        .connect(n('make'), n('fbCross'))
        .connect(n('sat'), n('pan'))
        .connect(n('pan'), 'out')
        .connect('wobbleDepth', n('dly'), 'delayTime');
    }
    c.connect('fbSelfL', 'dlyL')
      .connect('fbCrossL', 'dlyR')
      .connect('fbSelfR', 'dlyR')
      .connect('fbCrossR', 'dlyL')
      .connect('wobble', 'wobbleDepth');
    this.inputList.push({ name: 'in', nodeId: 'in' });
    this.outputList.push({ name: 'out', nodeId: 'out' });

    const both = (fn: (side: 'L' | 'R') => void) => {
      fn('L');
      fn('R');
    };
    this.controlList.push(
      new NumberControl('delay.time', 'Time', 20, 1500, 375, 'ms', (v) =>
        both((s) => c.setParam(`dly${s}`, 'delayTime', v / 1000)), 'log'),
      new NumberControl('delay.feedback', 'Feedback', 0, 1.1, 0.45, '', (v) => {
        this.feedback = v;
        this.applyFeedback();
      }),
      new NumberControl('delay.tone', 'Tone', 400, 12000, 3200, 'Hz', (v) =>
        both((s) => c.setParam(`tone${s}`, 'frequency', v)), 'log'),
      new NumberControl('delay.spread', 'Ping-pong', 0, 1, 0.8, '', (v) => {
        this.spread = v;
        this.applyFeedback();
        // Spread 1 feeds only the left line, so the echoes bounce; 0 feeds both lines equally.
        c.setParam('inGainR', 'gain', 1 - v);
      }),
      new NumberControl('delay.wobble', 'Wobble', 0, 1, 0.15, '', (v) => c.setParam('wobbleDepth', 'gain', v * 0.004)),
      new NumberControl('delay.drive', 'Drive', 0, 1, 0.3, '', (v) => {
        const drive = 1 + v * 3;
        both((s) => {
          c.setParam(`drive${s}`, 'gain', drive);
          c.setParam(`make${s}`, 'gain', SOFT_UNITY / drive);
        });
      }),
    );
  }

  /** Feedback splits between a line's own loop and the cross-feed into the other line. */
  private applyFeedback(): void {
    const c = this.circuit;
    for (const side of ['L', 'R']) {
      c.setParam(`fbSelf${side}`, 'gain', this.feedback * (1 - this.spread));
      c.setParam(`fbCross${side}`, 'gain', this.feedback * this.spread);
    }
  }
}
