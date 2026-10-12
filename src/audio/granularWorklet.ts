export const GRANULAR_NAME = 'moa-granular';

/**
 * The granular engine, as the source text of an audio worklet module. It is a string (like the follower) so the
 * app needs no extra build step; tests evaluate the same text to get `GrainCore`, so what they check is what ships.
 *
 * GrainCore records a mono input into a ring buffer and plays overlapping windowed grains from it:
 *  - `position` is how far back from the write head a grain starts (0 = now, 1 = the oldest audio), scattered by `cloud`;
 *  - `size` is the grain length in seconds, `rate` how many start per second (their spacing is scattered by `cloud`);
 *  - `pitch` (semitones) and `detune` (random cents per grain) set the playback speed, `reverse` the chance a grain plays backwards;
 *  - `spread` scatters grains across the stereo field, `shape` morphs the window from a smooth Hann to a sharp, percussive one;
 *  - `feedback` writes the (soft-clipped) output back into the buffer, and `freeze` stops recording so the buffer holds still.
 * Output is normalised by the expected overlap so changing size or rate does not change the level much.
 */
export const GRANULAR_SOURCE = `
const MAX_GRAINS = 64;
const BINS = 96;

class GrainCore {
  constructor(sampleRate, seconds, random) {
    this.sr = sampleRate;
    this.rnd = random || Math.random;
    this.len = Math.max(1024, Math.floor(sampleRate * seconds));
    this.buf = new Float32Array(this.len);
    this.w = 0;
    this.filled = 0;
    this.timer = 0;
    this.last = 0;
    this.pos = new Float64Array(MAX_GRAINS);
    this.step = new Float64Array(MAX_GRAINS);
    this.total = new Float64Array(MAX_GRAINS);
    this.age = new Float64Array(MAX_GRAINS);
    this.gl = new Float32Array(MAX_GRAINS);
    this.gr = new Float32Array(MAX_GRAINS);
    this.live = new Uint8Array(MAX_GRAINS);
    this.shape = 0;
    this.peaks = new Float32Array(BINS);
    this.binSize = this.len / BINS;
    this.curBin = 0;
  }

  /**
   * What a display needs: the buffer's peak level in BINS slices from oldest to newest, and the live grains as
   * [x, width] pairs (x: where along that oldest..newest axis a grain is reading, width: the stretch it spans).
   */
  snapshot() {
    const peaks = new Float32Array(BINS);
    for (let i = 0; i < BINS; i++) peaks[i] = this.peaks[(this.curBin + 1 + i) % BINS];
    const grains = [];
    for (let k = 0; k < MAX_GRAINS; k++) {
      if (!this.live[k]) continue;
      const age = (((this.w - this.pos[k]) % this.len) + this.len) % this.len;
      grains.push(Math.max(0, 1 - age / this.len), Math.min(1, (this.total[k] * Math.abs(this.step[k])) / this.len));
    }
    return { peaks, grains };
  }

  get activeGrains() {
    let n = 0;
    for (let k = 0; k < MAX_GRAINS; k++) n += this.live[k];
    return n;
  }

  spawn(p) {
    let k = 0;
    while (k < MAX_GRAINS && this.live[k]) k++;
    if (k === MAX_GRAINS) return;
    const r = this.rnd;
    const size = Math.max(64, p.size * this.sr);
    const cents = p.detune * (r() * 2 - 1);
    const ratio = Math.pow(2, (p.pitch + cents / 100) / 12);
    const dir = r() < p.reverse ? -1 : 1;
    const span = this.filled;
    const scatter = p.cloud * (r() * 2 - 1) * 0.25 * span;
    // A grain must not run into the write head: leave room for the span it will read.
    const minAge = size * Math.max(1, ratio) + 32;
    let age = p.position * span + scatter;
    age = Math.min(Math.max(age, minAge), Math.max(minAge, span));
    // age is how far back the grain's older end sits; a reverse grain starts at its newer end and reads towards it.
    let start = this.w - age;
    if (dir < 0) start += size * ratio;
    start = ((start % this.len) + this.len) % this.len;
    const pan = p.spread * (r() * 2 - 1);
    const angle = (pan + 1) * Math.PI / 4;
    this.pos[k] = start;
    this.step[k] = dir * ratio;
    this.total[k] = size;
    this.age[k] = 0;
    this.gl[k] = Math.cos(angle);
    this.gr[k] = Math.sin(angle);
    this.live[k] = 1;
  }

  /** Window value for a grain at phase t in 0..1: Hann blended with a fast-attack, decaying shape. */
  window(t, shape) {
    const hann = 0.5 - 0.5 * Math.cos(2 * Math.PI * t);
    if (shape <= 0) return hann;
    const sharp = Math.min(1, t * 40) * Math.exp(-5 * t) * 1.6;
    return hann + shape * (sharp - hann);
  }

  /** Renders n samples. input is mono (or null); p holds plain numbers for every parameter. */
  process(input, outL, outR, n, p) {
    const buf = this.buf, len = this.len, sr = this.sr;
    const frozen = p.freeze > 0.5;
    const gain = 1 / Math.sqrt(Math.max(1, p.rate * p.size * 0.6));
    const fb = p.feedback;
    for (let i = 0; i < n; i++) {
      if (!frozen) {
        const sample = (input ? input[i] : 0) + fb * Math.tanh(this.last);
        buf[this.w] = sample;
        const bin = Math.min(BINS - 1, Math.floor(this.w / this.binSize));
        if (bin !== this.curBin) { this.curBin = bin; this.peaks[bin] = 0; }
        const mag = Math.abs(sample);
        if (mag > this.peaks[bin]) this.peaks[bin] = mag;
        this.w = (this.w + 1) % len;
        if (this.filled < len - 1) this.filled++;
      }
      this.timer -= 1;
      if (this.timer <= 0) {
        this.spawn(p);
        this.timer += (sr / Math.max(0.1, p.rate)) * (1 + p.cloud * (this.rnd() * 2 - 1) * 0.8);
      }
      let l = 0, r = 0;
      for (let k = 0; k < MAX_GRAINS; k++) {
        if (!this.live[k]) continue;
        const t = this.age[k] / this.total[k];
        if (t >= 1) { this.live[k] = 0; continue; }
        let pos = this.pos[k];
        const i0 = Math.floor(pos);
        const frac = pos - i0;
        const a = buf[((i0 % len) + len) % len];
        const b = buf[(((i0 + 1) % len) + len) % len];
        const s = (a + (b - a) * frac) * this.window(t, p.shape);
        l += s * this.gl[k];
        r += s * this.gr[k];
        pos += this.step[k];
        this.pos[k] = ((pos % len) + len) % len;
        this.age[k] += 1;
      }
      outL[i] = l * gain;
      outR[i] = r * gain;
      this.last = (outL[i] + outR[i]) * 0.5;
    }
  }
}

if (typeof registerProcessor === 'function') {
  class MoaGranular extends AudioWorkletProcessor {
    static get parameterDescriptors() {
      const k = (name, def, min, max) => ({ name, defaultValue: def, minValue: min, maxValue: max, automationRate: 'k-rate' });
      return [
        k('position', 0.3, 0, 1), k('size', 0.12, 0.002, 4), k('pitch', 0, -48, 48), k('rate', 12, 0.1, 200),
        k('spread', 0.5, 0, 1), k('cloud', 0.2, 0, 1), k('detune', 0, 0, 1200), k('shape', 0.3, 0, 1),
        k('reverse', 0, 0, 1), k('feedback', 0, 0, 1), k('freeze', 0, 0, 1),
      ];
    }
    constructor(options) {
      super();
      const seconds = (options.processorOptions && options.processorOptions.seconds) || 20;
      this.core = new GrainCore(sampleRate, seconds);
      this.mono = new Float32Array(128);
      this.p = {};
      this.sinceView = 0;
    }
    process(inputs, outputs, params) {
      const out = outputs[0];
      const n = out[0].length;
      const input = inputs[0];
      let mono = null;
      if (input.length > 0) {
        if (this.mono.length < n) this.mono = new Float32Array(n);
        mono = this.mono;
        for (let i = 0; i < n; i++) {
          let s = 0;
          for (let ch = 0; ch < input.length; ch++) s += input[ch][i];
          mono[i] = s / input.length;
        }
      }
      for (const name in params) this.p[name] = params[name][0];
      this.core.process(mono, out[0], out[1] || out[0], n, this.p);
      this.sinceView += n;
      if (this.sinceView >= sampleRate / 30) {
        this.sinceView = 0;
        this.port.postMessage(this.core.snapshot());
      }
      return true;
    }
  }
  registerProcessor('${GRANULAR_NAME}', MoaGranular);
}
`;
