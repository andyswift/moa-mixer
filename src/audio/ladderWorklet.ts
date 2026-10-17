export const LADDER_NAME = 'moa-ladder';

/**
 * The MOA-1's ladder filter, as the source text of an audio worklet module (tests evaluate the same text to get
 * `LadderCore`). Mono in, mono out.
 *
 *   in -> x2 oversampling -> four-pole TPT ladder with the saturation inside the resonance loop -> decimation
 *      low-pass (8th-order Butterworth) -> out
 *
 * The saturation sits where the feedback meets the input (as in a transistor ladder), so driving it does not just
 * distort the output: loud notes squash the resonance into the rubbery squelch of a hardware filter rather than a
 * whistle. `drive` raises the level into that stage (with the output scaled back, so it saturates rather than gets
 * louder); `res` (0..1) is the feedback, self-oscillating near the top; the passband is lifted as resonance rises,
 * which a ladder otherwise loses. The cutoff is `cutoff` (Hz) moved by `detune` (cents), an audio-rate input the
 * synth's envelope, key follow and LFO feed, so fast envelope sweeps stay smooth.
 */
export const LADDER_SOURCE = `
const LADDER_PARAMS = [
  ['cutoff', 800, 20, 20000, 'k-rate'], ['detune', 0, -12000, 12000, 'a-rate'], ['res', 0, 0, 1, 'k-rate'], ['drive', 0, 0, 1, 'k-rate'],
];

function ladderTanh(x) {
  if (x > 3) return 1;
  if (x < -3) return -1;
  const x2 = x * x;
  return x * (27 + x2) / (27 + 9 * x2);
}

class LadderCore {
  constructor(sampleRate) {
    this.sr = sampleRate;
    this.s = [0, 0, 0, 0];
    this.d = new Float64Array(8); // the decimation filter: four TPT stages, two states each
    this.prevIn = 0;
  }

  // one TPT low-pass stage of the decimation filter
  dec(i, x, g, k) {
    const s = this.d;
    const hp = (x - (k + g) * s[i] - s[i + 1]) / (1 + g * (k + g));
    const bp = g * hp + s[i];
    const lp = g * bp + s[i + 1];
    s[i] = g * hp + bp;
    s[i + 1] = g * bp + lp;
    return lp;
  }

  // one sample of the ladder at the oversampled rate
  ladder(x, g, k, drive) {
    const G = g / (1 + g), ig = 1 / (1 + g), s = this.s;
    const G2 = G * G;
    const S = (G2 * G * s[0] + G2 * s[1] + G * s[2] + s[3]) * ig;
    const y4 = (G2 * G2 * x + S) / (1 + k * G2 * G2);
    let u = ladderTanh((x - k * y4) * drive) / drive;
    for (let j = 0; j < 4; j++) {
      const v = (u - s[j]) * G;
      const y = v + s[j];
      s[j] = y + v;
      u = y;
    }
    return u;
  }

  // detune: an array (a-rate) or a single value
  process(input, output, n, p, detune) {
    const sr2 = this.sr * 2;
    const k = p.res * 4.15;
    const pre = 0.6 + p.drive * 7; // the level into the loop's saturation
    const comp = (1 + 0.55 * k) * (1 + p.drive * 0.6); // the passband back up, and some make-up
    const gd = Math.tan(Math.PI * Math.min(19000, 0.45 * this.sr) / sr2);
    const maxFc = 0.45 * sr2 * 0.5;
    const many = detune && detune.length > 1;
    for (let i = 0; i < n; i++) {
      const x = input ? input[i] : 0;
      const cents = many ? detune[i] : (detune ? detune[0] : 0);
      const fc = Math.min(maxFc, Math.max(10, p.cutoff * Math.pow(2, cents / 1200)));
      const g = Math.tan(Math.PI * fc / sr2);
      let y = 0;
      for (let j = 1; j <= 2; j++) {
        const xs = this.prevIn + (x - this.prevIn) * (j / 2);
        const v = this.ladder(xs, g, k, pre) * comp;
        y = this.dec(6, this.dec(4, this.dec(2, this.dec(0, v, gd, 1.9616), gd, 1.6629), gd, 1.1111), gd, 0.3902);
      }
      this.prevIn = x;
      output[i] = Number.isFinite(y) ? y : 0;
    }
    if (!Number.isFinite(this.s[3])) { this.s.fill(0); this.d.fill(0); }
  }
}

if (typeof registerProcessor === 'function') {
  class MoaLadder extends AudioWorkletProcessor {
    static get parameterDescriptors() {
      return LADDER_PARAMS.map((d) => ({ name: d[0], defaultValue: d[1], minValue: d[2], maxValue: d[3], automationRate: d[4] }));
    }
    constructor() {
      super();
      this.core = new LadderCore(sampleRate);
      this.p = {};
    }
    process(inputs, outputs, params) {
      const out = outputs[0][0];
      this.p.cutoff = params.cutoff[0];
      this.p.res = params.res[0];
      this.p.drive = params.drive[0];
      const input = inputs[0] && inputs[0][0];
      this.core.process(input, out, out.length, this.p, params.detune);
      return true;
    }
  }
  registerProcessor('${LADDER_NAME}', MoaLadder);
}
`;
