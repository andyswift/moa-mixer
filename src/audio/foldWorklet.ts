export const FOLD_NAME = 'moa-fold';

/**
 * A wavefolder for the MOA-1's drive, as the source text of an audio worklet module (tests evaluate the same text to
 * get `FoldCore`). Mono in, mono out.
 *
 *   in -> x2 oversampling -> sine folder (with antiderivative antialiasing) -> pitch-tracking low-pass (24 dB)
 *      -> decimation low-pass (8th-order Butterworth at 19 kHz) -> decimate -> DC blocker -> out
 *
 * - Folding instead of clipping: the input, scaled by `fold` (1 = a gentle saturation, 10 = many folds), drives
 *   sin(); as it rises, harmonics come in one after another instead of jumping to a square wave's wall of them.
 * - `even` biases the fold: 0 is symmetric (odd harmonics only, hollow), up to 1 adds even ones (octaves, warmer).
 * - Antialiasing: the folder is computed from its antiderivative (first-order ADAA), at twice the sample rate, so
 *   harmonics above Nyquist do not fold back as tones unrelated to the note.
 * - Harmonics a long way up the series sound like fizz rather than tone; the synth sends its pitch (cents from A4, the
 *   same CV its oscillators get), and a 24 dB low-pass at `harmonics` times the note frequency keeps that many.
 */
export const FOLD_SOURCE = `
const FOLD_OS = 2; // oversampling (with the steep decimation filter, 2x measured cleaner than 4x)
const FOLD_PARAMS = [
  ['fold', 1, 0.5, 12], ['even', 0, 0, 1], ['harmonics', 48, 2, 128], ['pitch', 0, -6000, 6000],
];

class FoldCore {
  constructor(sampleRate) {
    this.sr = sampleRate;
    this.prevIn = 0;
    this.prevU = 0;
    this.s = new Float64Array(12); // six TPT state-variable low-pass stages, two states each
    this.dcIn = 0;
    this.dcOut = 0;
  }

  // one 12 dB TPT low-pass stage; g and k are precomputed
  lp(i, x, g, k) {
    const s = this.s;
    const hp = (x - (k + g) * s[i] - s[i + 1]) / (1 + g * (k + g));
    const bp = g * hp + s[i];
    const lp = g * bp + s[i + 1];
    s[i] = g * hp + bp;
    s[i + 1] = g * bp + lp;
    return lp;
  }

  // the folder sin(u), first-order ADAA: the mean of sin over the step from the previous u to this one
  fold(u) {
    const d = u - this.prevU;
    const y = Math.abs(d) > 1e-5 ? (Math.cos(this.prevU) - Math.cos(u)) / d : Math.sin(0.5 * (u + this.prevU));
    this.prevU = u;
    return y;
  }

  process(input, output, n, p) {
    const srOs = this.sr * FOLD_OS;
    const gain = p.fold * Math.PI * 0.5;
    const bias = p.even * Math.PI * 0.5;
    const f0 = 440 * Math.pow(2, p.pitch / 1200);
    const fc = Math.min(18000, Math.max(150, p.harmonics * f0));
    const g = Math.tan(Math.PI * fc / srOs);
    const gd = Math.tan(Math.PI * Math.min(19000, 0.45 * this.sr) / srOs);
    for (let i = 0; i < n; i++) {
      const x = input ? input[i] : 0;
      // x2: points along the line from the last sample to this one; the low-passes run at the raised rate, and the
      // last point is kept
      let y = 0;
      for (let j = 1; j <= FOLD_OS; j++) {
        const xs = this.prevIn + (x - this.prevIn) * (j / FOLD_OS);
        const v = this.fold(gain * xs + bias);
        // the pitch-tracking low-pass: a 4th-order Butterworth (stage damping 2 cos(pi/8) and 2 cos(3pi/8))
        const t = this.lp(2, this.lp(0, v, g, 1.8478), g, 0.7654);
        // the decimation low-pass: an 8th-order Butterworth, so nothing above the new Nyquist folds back
        y = this.lp(10, this.lp(8, this.lp(6, this.lp(4, t, gd, 1.9616), gd, 1.6629), gd, 1.1111), gd, 0.3902);
      }
      this.prevIn = x;
      // DC blocker (the bias adds an offset)
      const out = y - this.dcIn + 0.9995 * this.dcOut;
      this.dcIn = y;
      this.dcOut = Math.abs(out) < 1e-20 ? 0 : out;
      output[i] = out;
    }
  }
}

if (typeof registerProcessor === 'function') {
  class MoaFold extends AudioWorkletProcessor {
    static get parameterDescriptors() {
      return FOLD_PARAMS.map((d) => ({ name: d[0], defaultValue: d[1], minValue: d[2], maxValue: d[3], automationRate: 'k-rate' }));
    }
    constructor() {
      super();
      this.core = new FoldCore(sampleRate);
      this.p = {};
    }
    process(inputs, outputs, params) {
      const out = outputs[0][0];
      for (const name in params) this.p[name] = params[name][0];
      const input = inputs[0] && inputs[0][0];
      this.core.process(input, out, out.length, this.p);
      return true;
    }
  }
  registerProcessor('${FOLD_NAME}', MoaFold);
}
`;
