/**
 * Mutable Instruments' effects, as worklet source text: a port to JavaScript of the FxEngine and the effects built on
 * it in Beads and Rings (MIT, Emilie Gillet; see src/audio/mutable/LICENSE). The module code runs in single-precision
 * floats with its delay memory in 16 bits; the port keeps the 16-bit memory (its grain is part of the sound) and
 * computes in doubles, so it follows the original to a small relative error rather than bit for bit.
 *
 * - MiFxEngine: one circular block of delay memory carved into lines, an accumulator that reads, writes, all-passes
 *   and filters along them, and two cosine LFOs updated every 32 samples (stmlib's approximate oscillator).
 * - MiReverb: Beads' reverb, the Griesinger topology of the Dattorro paper (four all-pass diffusers into a loop of
 *   two all-pass pairs and two delays), modulated in the first diffuser and in the long delays; the same as Clouds',
 *   Rings' and Elements' at 32 kHz, made for 48 kHz.
 * - MiWowAndFlutter: Beads' tape transport, a short modulated delay: wow at 0.23 Hz whose speed and depth drift at
 *   random, flutter at 1.99 Hz, a one-pole after.
 * - MiBeadsDelay: Beads' delay mode, synced and running (not frozen): a clock that learns its interval from ticks and
 *   crossfades between two when the tempo changes; DENSITY picks a ratio of it, MULTIPLY how many multiples sound (1 to
 *   16), SHAPE each repeat's envelope; eight taps, each a pitch-shifting window and a latency-free twin crossfaded by how
 *   far PITCH is from unison; FILTER a low- or high-pass on them; and Beads' feedback path (limiter, soft clip, DC
 *   blocker, one-pole) at its 16-bit quality. Its CV hysteresis filters are plain smoothing here (no CV to jitter).
 * - MiEnsemble: Rings' string ensemble, three taps a channel swept by a slow and a fast LFO, 120 degrees apart. Rings
 *   feeds it odd and even strings on two sides; a mono source would come out mono, so the rig can ask (\`spread\`) for the
 *   right side's taps to sweep the other way, its one change to the original.
 */
export const MUTABLE_FX_SOURCE = `
// ---- stmlib
function miClip16(x) { return x < -32768 ? -32768 : x > 32767 ? 32767 : x; }
// stmlib's cosine oscillator, in its cheap approximate form (a resonant two-pole run at a 32nd of the rate)
class MiCosineOscillator {
  constructor() { this.y0 = 0.5; this.y1 = 0; this.k = 0; this.a0 = 0; }
  initApproximate(frequency) {
    let sign = 16;
    frequency -= 0.25;
    if (frequency < 0) frequency = -frequency;
    else if (frequency > 0.5) frequency -= 0.5;
    else sign = -16;
    this.k = sign * frequency * (1 - 2 * frequency);
    this.a0 = this.k * 0.25;
    this.y1 = this.a0; this.y0 = 0.5;
  }
  value() { return this.y1 + 0.5; }
  next() { const t = this.y0; this.y0 = this.k * this.y0 - this.y1; this.y1 = t; return t + 0.5; }
}
// a deterministic generator for the module's Random::GetFloat (seeded as stmlib's is)
class MiRandom {
  constructor() { this.state = 0x21; }
  word() { this.state = (Math.imul(this.state, 1664525) + 1013904223) >>> 0; return this.state; }
  float() { return this.word() / 4294967296; }
}

// ---- the FxEngine: lines are [base, length] in one power-of-two block of 16-bit memory
class MiFxEngine {
  constructor(size) {
    this.size = size; this.mask = size - 1; this.buffer = new Int16Array(size); this.writePtr = 0;
    this.lfo = [new MiCosineOscillator(), new MiCosineOscillator()];
    this.acc = 0; this.previousRead = 0; this.lfoValue = [0, 0];
  }
  /** Lines laid out as FxEngine's Reserve<...> chain: each takes its length and one more. */
  static lines(lengths) {
    let base = 0;
    return lengths.map((length) => { const d = [base, length]; base += length + 1; return d; });
  }
  clear() { this.buffer.fill(0); this.writePtr = 0; }
  setLfoFrequency(index, frequency) { this.lfo[index].initApproximate(frequency * 32); }
  start() {
    if (--this.writePtr < 0) this.writePtr += this.size;
    this.acc = 0; this.previousRead = 0;
    if ((this.writePtr & 31) === 0) { this.lfoValue[0] = this.lfo[0].next(); this.lfoValue[1] = this.lfo[1].next(); }
    else { this.lfoValue[0] = this.lfo[0].value(); this.lfoValue[1] = this.lfo[1].value(); }
  }
  load(value) { this.acc = value; }
  readValue(value, scale) { this.acc += value * scale; }
  /** The accumulator out (as Context::Write(float&, scale)): returns it, and scales it. */
  take(scale = 1) { const v = this.acc; this.acc *= scale; return v; }
  // offset -1 is the line's tail (TAIL)
  write(d, offset, scale) {
    const at = offset === -1 ? this.writePtr + d[0] + d[1] - 1 : this.writePtr + d[0] + offset;
    this.buffer[at & this.mask] = miClip16(Math.trunc(this.acc * 32768));
    this.acc *= scale;
  }
  writeAllPass(d, offset, scale) { this.write(d, offset, scale); this.acc += this.previousRead; }
  read(d, offset, scale) {
    const at = offset === -1 ? this.writePtr + d[0] + d[1] - 1 : this.writePtr + d[0] + offset;
    const r = this.buffer[at & this.mask] / 32768;
    this.previousRead = r;
    this.acc += r * scale;
  }
  interpolate(d, offset, scale) {
    const i = Math.trunc(offset), f = offset - i;
    const a = this.buffer[(this.writePtr + i + d[0]) & this.mask] / 32768;
    const b = this.buffer[(this.writePtr + i + d[0] + 1) & this.mask] / 32768;
    const x = a + (b - a) * f;
    this.previousRead = x;
    this.acc += x * scale;
  }
  interpolateLfo(d, offset, lfo, amplitude, scale) { this.interpolate(d, offset + amplitude * this.lfoValue[lfo], scale); }
  /** A one-pole low-pass on the accumulator: returns the filter's new state. */
  lp(state, coefficient) { state += coefficient * (this.acc - state); this.acc = state; return state; }
}

// ---- Beads' reverb
const MI_REVERB_LINES = MiFxEngine.lines([150, 214, 319, 527, 2182, 2690, 4501, 2525, 2197, 6312]);
class MiReverb {
  constructor(sampleRate) {
    this.engine = new MiFxEngine(32768);
    this.mix = 0; this.time = 0.5; this.lpCoefficient = 0.7;
    this.reset(sampleRate);
  }
  reset(sampleRate) {
    this.engine.setLfoFrequency(0, 0.5 / sampleRate);
    this.engine.setLfoFrequency(1, 0.3 / sampleRate);
    this.lp1 = 0; this.lp2 = 0; this.wet = 0; this.dry = 0; this.send = 0;
  }
  clear() { this.engine.clear(); }
  /** In place over a block: the parameters glide across it, as the module's ParameterInterpolators do. */
  process(left, right, size) {
    const e = this.engine, [ap1, ap2, ap3, ap4, dap1a, dap1b, del1, dap2a, dap2b, del2] = MI_REVERB_LINES;
    const kap = 0.625, klp = this.lpCoefficient, krt = this.time;
    const inputGain = 0.2 * (1 - 0.333 * krt), outputGain = 0.4 / inputGain;
    const sendSqrt = this.mix * (2 - this.mix), send = sendSqrt * (2 - sendSqrt);
    const dry = (1 - this.mix) * (1 + this.mix);
    const dWet = (outputGain - this.wet) / size, dDry = (dry - this.dry) / size, dSend = (send * inputGain - this.send) / size;
    for (let i = 0; i < size; i++) {
      this.dry += dDry; this.wet += dWet; this.send += dSend;
      e.start();
      // smear the first all-pass, inside the loop
      e.interpolateLfo(ap1, 10, 0, 80, 1);
      e.write(ap1, 100, 0);
      e.readValue(left[i] + right[i], this.send);
      // diffuse through four all-passes
      e.read(ap1, -1, kap); e.writeAllPass(ap1, 0, -kap);
      e.read(ap2, -1, kap); e.writeAllPass(ap2, 0, -kap);
      e.read(ap3, -1, kap); e.writeAllPass(ap3, 0, -kap);
      e.read(ap4, -1, kap); e.writeAllPass(ap4, 0, -kap);
      const apout = e.take();
      // the loop
      e.load(apout);
      e.interpolateLfo(del2, 6261, 1, 50, krt);
      this.lp1 = e.lp(this.lp1, klp);
      e.read(dap1a, -1, -kap); e.writeAllPass(dap1a, 0, kap);
      e.read(dap1b, -1, kap); e.writeAllPass(dap1b, 0, -kap);
      e.write(del1, 0, 1);
      const wetL = e.take();
      left[i] = left[i] * this.dry + wetL * this.wet;
      e.load(apout);
      e.interpolateLfo(del1, 4460, 0, 40, krt);
      this.lp2 = e.lp(this.lp2, klp);
      e.read(dap2a, -1, kap); e.writeAllPass(dap2a, 0, -kap);
      e.read(dap2b, -1, -kap); e.writeAllPass(dap2b, 0, kap);
      e.write(del2, 0, 1);
      const wetR = e.take();
      right[i] = right[i] * this.dry + wetR * this.wet;
    }
  }
}

// ---- Beads' sine oscillator (its table: a sine sampled 1024 times a turn, a quarter turn more for cosines)
const MI_SINE = Float64Array.from({ length: 1281 }, (_, i) => Math.sin(2 * Math.PI * i / 1024));
class MiSineOscillator {
  constructor() { this.phase = 0; this.frequency = 0; }
  render(frequency) {
    this.frequency = frequency;
    this.phase += this.frequency;
    if (this.phase >= 1) this.phase -= 1;
    const x = this.phase * 1024, i = Math.trunc(x);
    return 0.5 + 0.5 * (MI_SINE[i] + (MI_SINE[i + 1] - MI_SINE[i]) * (x - i));
  }
}

// ---- Beads' wow and flutter: a block sets the delay it glides to; then a sample at a time
class MiWowAndFlutter {
  constructor(sampleRate) {
    this.lines = [new Float64Array(128), new Float64Array(128)];
    this.writePtr = 0;
    this.wow = new MiSineOscillator(); this.flutter = new MiSineOscillator(); this.randomModulation = new MiSineOscillator();
    this.random = new MiRandom();
    this.oneHertz = 1 / sampleRate;
    this.randomFrequency = 0.125 * this.oneHertz;
    this.delay = 0; this.amount = 1; this.lpCoefficient = 1;
    this.lpL = 0; this.lpR = 0;
    this.step = 0;
  }
  /** Starts a block of \`size\` samples: where the tape's speed has wandered to. */
  begin(size) {
    const previousPhase = this.randomModulation.phase;
    const rm = this.randomModulation.render(this.randomFrequency * size);
    if (this.randomModulation.phase >= 0.25 && previousPhase < 0.25) this.randomFrequency = this.oneHertz * (0.05 + this.random.float() * 0.2);
    const fm = 0.5 + 1.5 * rm * rm;
    const amount = (1 - 0.4 * rm) * this.amount;
    const wow = this.wow.render(this.oneHertz * 0.23 * size * fm);
    const flutter = this.flutter.render(this.oneHertz * 1.99 * size);
    const target = 1 + (105 * wow + 17 * flutter) * amount;
    this.step = (target - this.delay) / size;
  }
  /** One sample of each channel, into \`out\` [left, right]. */
  process(l, r, out) {
    this.delay += this.step;
    const lines = this.lines, i = Math.trunc(this.delay), f = this.delay - i;
    // stmlib's WriteRead: write, step the pointer back, then read from it
    lines[0][this.writePtr] = l; lines[1][this.writePtr] = r;
    this.writePtr = (this.writePtr + 127) & 127;
    const a = (this.writePtr + i) & 127, b = (this.writePtr + i + 1) & 127;
    this.lpL += this.lpCoefficient * (lines[0][a] + (lines[0][b] - lines[0][a]) * f - this.lpL);
    this.lpR += this.lpCoefficient * (lines[1][a] + (lines[1][b] - lines[1][a]) * f - this.lpR);
    out[0] = this.lpL; out[1] = this.lpR;
  }
}

// ---- Rings' ensemble: its table (a sine sampled 4096 times a turn), two lines of the engine, three taps each
const MI_SINE_4096 = Float64Array.from({ length: 4096 }, (_, i) => Math.sin(2 * Math.PI * i / 4096));
const MI_ENSEMBLE_LINES = MiFxEngine.lines([2047, 2047]);
class MiEnsemble {
  constructor() { this.engine = new MiFxEngine(4096); this.phase1 = 0; this.phase2 = 0; this.amount = 1; this.depth = 0; this.rate = 1; this.spread = false; }
  setDepth(depth) { this.depth = depth * 128; }
  /** \`rate\` scales both LFOs (1 is Rings' own: 0.75 and 6.6 Hz at 48 kHz). Writes the wet signal only, if \`wetOnly\`. */
  process(left, right, size, wetOnly) {
    const e = this.engine, [lineL, lineR] = MI_ENSEMBLE_LINES, S = MI_SINE_4096;
    for (let i = 0; i < size; i++) {
      e.start();
      const dryAmount = wetOnly ? 0 : 1 - this.amount * 0.5;
      this.phase1 += 1.57e-05 * this.rate;
      if (this.phase1 >= 1) this.phase1 -= 1;
      this.phase2 += 1.37e-04 * this.rate;
      if (this.phase2 >= 1) this.phase2 -= 1;
      const phi1 = Math.trunc(this.phase1 * 4096), phi2 = Math.trunc(this.phase2 * 4096);
      const a = this.depth, b = this.depth * 0.1;
      const mod1 = S[phi1 & 4095] * a + S[phi2 & 4095] * b;
      const mod2 = S[(phi1 + 1365) & 4095] * a + S[(phi2 + 1365) & 4095] * b;
      const mod3 = S[(phi1 + 2730) & 4095] * a + S[(phi2 + 2730) & 4095] * b;
      e.readValue(left[i], 1); e.write(lineL, 0, 0);
      e.readValue(right[i], 1); e.write(lineR, 0, 0);
      e.interpolate(lineL, mod1 + 1024, 0.33); e.interpolate(lineL, mod2 + 1024, 0.33); e.interpolate(lineR, mod3 + 1024, 0.33);
      const wetL = e.take(0);
      const k = this.spread ? -1 : 1;
      e.interpolate(lineR, k * mod1 + 1024, 0.33); e.interpolate(lineR, k * mod2 + 1024, 0.33); e.interpolate(lineL, k * mod3 + 1024, 0.33);
      const wetR = e.take(0);
      left[i] = wetL * this.amount + left[i] * dryAmount;
      right[i] = wetR * this.amount + right[i] * dryAmount;
    }
  }
}
// ---- Beads' delay
const MI_MIN_DELAY = 64 + 4;
const MI_DELAY_RATIOS = [1 / 16, 1 / 16, 1 / 8, 1 / 8, 1 / 4, 1 / 4, 1 / 2, 1 / 2, 1, 1,
  1, 1, 1 / 2, 1 / 3, 1 / 4, 1 / 6, 1 / 8, 1 / 10, 1 / 12, 1 / 16, 1 / 16, 1 / 16];
function miSoftClip(x) { return x < -3 ? -1 : x > 3 ? 1 : x * (27 + x * x) / (27 + 9 * x * x); }
// stmlib's fast tangent, for its SVF
function miTanFast(f) { const a = 3.260e-01 * Math.PI ** 3, b = 1.823e-01 * Math.PI ** 5, f2 = f * f; return f * (Math.PI + f2 * (a + b * f2)); }
class MiSvf {
  constructor() { this.g = 0; this.r = 0; this.h = 0; this.s1 = 0; this.s2 = 0; }
  setFQ(f, q) { this.g = miTanFast(f); this.r = 1 / q; this.h = 1 / (1 + this.r * this.g + this.g * this.g); }
  /** mode 0 low-pass, 2 high-pass */
  process(input, mode) {
    const hp = (input - this.r * this.s1 - this.g * this.s1 - this.s2) * this.h;
    const bp = this.g * hp + this.s1;
    this.s1 = this.g * hp + bp;
    const lp = this.g * bp + this.s2;
    this.s2 = this.g * bp + lp;
    return mode === 0 ? lp : hp;
  }
}
class MiLimiter {
  constructor(decay, maxPeak) { this.peak = 0.5; this.peakLp = 0.5; this.decay = decay; this.maxPeak = maxPeak; }
  /** the gain for a frame */
  gain(l, r) {
    const peak = Math.min(Math.max(Math.abs(l), Math.abs(r)), 40);
    this.peak += (peak > this.peak ? 0.1 : this.decay) * (peak - this.peak);
    this.peakLp += (this.peak > this.peakLp ? 0.5 : this.decay) * (this.peak - this.peakLp);
    return this.peakLp <= this.maxPeak ? 1 : this.maxPeak / this.peakLp;
  }
}
class MiDelayClock {
  constructor(sampleRate) {
    this.interval = [sampleRate * 0.25, sampleRate * 0.25]; this.average = sampleRate * 0.25;
    this.maxInterval = Math.trunc(sampleRate * 4); this.fade = 1;
    this.minFadeIncrement = 1 / (sampleRate * 0.25); this.maxFadeIncrement = 1 / (sampleRate * 0.02);
    this.fadeIncrement = this.maxFadeIncrement;
    this.acceptableJitter = sampleRate * 0.001; this.jitterSensitivity = 1;
    this.scheduleChange = false; this.nextInterval = 0; this.rotate = 0;
  }
  process(tick) {
    this.nextInterval++;
    this.fade = Math.min(1, this.fade + this.fadeIncrement);
    if (tick) {
      if (this.nextInterval < this.maxInterval) {
        const interval = this.nextInterval;
        const bigChange = Math.abs(interval - this.interval[1]) > this.acceptableJitter;
        const smallChange = Math.abs(this.average - this.interval[1]) > this.jitterSensitivity * this.acceptableJitter;
        if (bigChange) { this.jitterSensitivity = 1; this.average = interval; }
        else { this.average += 0.1 * (interval - this.average); this.jitterSensitivity = Math.max(0.05, this.jitterSensitivity * 0.95); }
        this.scheduleChange = this.scheduleChange || bigChange || smallChange;
      }
      this.nextInterval = 0;
    }
    if (this.scheduleChange && this.fade >= 1) {
      this.rotate++;
      this.interval[0] = this.interval[1];
      this.interval[1] = this.average;
      this.fade = 0;
      this.fadeIncrement = Math.min(this.maxFadeIncrement, Math.max(this.minFadeIncrement, 2 / this.average));
      this.scheduleChange = false;
    }
  }
  intervalOf(i) { return this.interval[(i + this.rotate) % 2]; }
  gainOf(i) { return (i + this.rotate) % 2 ? this.fade : 1 - this.fade; }
  retrig() { return this.fade === 0 && !this.nextInterval; }
  newIntervalIndex() { return (this.rotate + 1) % 2; }
}
function miTriangle(phase, pw) { return phase < pw ? phase / pw : 1 - (phase - pw) / (1 - pw); }
const MI_TAP_PW = [0, 0.001, 0.01, 0.5, 0.75, 0.999];
function miInterpolate6(table, x) { const v = x * 5, i = Math.trunc(v), f = v - i; return table[i] + (table[Math.min(5, i + 1)] - table[i]) * f; }
class MiTapEnvelope {
  constructor() { this.phase = 0; this.increment = 0; }
  init() { this.phase = 0; this.increment = 0; }
  render(shape) {
    const envelope = shape < 0.2
      ? 1 + (miTriangle(this.phase, MI_TAP_PW[1]) - 1) * shape * 5
      : miTriangle(this.phase, miInterpolate6(MI_TAP_PW, shape));
    this.phase += this.increment;
    if (this.phase >= 1) this.phase -= 1;
    return envelope;
  }
}
// the stereo line, read Hermite-interpolated at a delay in 1024ths of a sample (as Beads' DelayLine)
class MiStereoLine {
  constructor(length) { this.n = length; this.l = new Float32Array(length); this.r = new Float32Array(length); this.writePtr = 0; this.out = [0, 0]; }
  write(l, r) { this.l[this.writePtr] = l; this.r[this.writePtr] = r; this.writePtr = this.writePtr === 0 ? this.n - 1 : this.writePtr - 1; }
  read(delay) {
    const di = delay >> 10, t = (delay & 1023) / 1024, n = this.n;
    let i = (this.writePtr + di + n - 1) % n;
    if (i < 0) i += n;
    const out = this.out;
    for (let c = 0; c < 2; c++) {
      const b = c ? this.r : this.l;
      const x0 = b[i], x1 = b[(i + 1) % n], x2 = b[(i + 2) % n], x3 = b[(i + 3) % n];
      const cc = (x2 - x0) * 0.5, v = x1 - x2, w = cc + v, a = w + v + (x3 - x1) * 0.5, bNeg = w + a;
      out[c] = (((a * t) - bNeg) * t + cc) * t + x1;
    }
    return out;
  }
}
// one of the multitap's taps: a pitch-shifting window, or (windowSize 1) a plain read
class MiBeadsTap {
  constructor(windowSize) { this.window = windowSize; this.phase = 0; }
  render(line, delay, gain, speed, acc) {
    if (delay === 0) return;
    if (this.window === 1) { const x = line.read(delay); acc[0] += gain * x[0]; acc[1] += gain * x[1]; return; }
    const full = 1024 * this.window, half = full >> 1;
    this.phase += Math.trunc(1024 * (speed - 1));
    if (this.phase >= full) this.phase -= full; else if (this.phase < 0) this.phase += full;
    delay = Math.max(full + 1, delay + half);
    const p = this.phase / full, tri = p < 0.5 ? 2 * p : 2 - 2 * p;
    const h1 = line.read(-this.phase + delay), h1l = h1[0], h1r = h1[1];
    const h2 = line.read(-((this.phase + half) % full) + delay);
    acc[0] += (h2[0] + (h1l - h2[0]) * tri) * gain;
    acc[1] += (h2[1] + (h1r - h2[1]) * tri) * gain;
  }
}
const MI_NUM_TAPS = 8, MI_NUM_HEADS = 4;
class MiBeadsDelay {
  constructor(sampleRate, maxSeconds = 8) {
    this.sr = sampleRate;
    this.maxDelay = Math.trunc(sampleRate * maxSeconds);
    this.line = new MiStereoLine(this.maxDelay + 2048 + 8); // room for the pitch windows past the longest delay
    this.clock = new MiDelayClock(sampleRate);
    this.envelopes = Array.from({ length: MI_NUM_TAPS }, () => new MiTapEnvelope());
    this.taps = Array.from({ length: MI_NUM_TAPS }, () => new MiBeadsTap(2048));
    this.noLatencyTaps = Array.from({ length: MI_NUM_TAPS }, () => new MiBeadsTap(1));
    this.tapDelay = new Int32Array(MI_NUM_TAPS); this.tapGain = new Float64Array(MI_NUM_TAPS);
    this.filter = [new MiSvf(), new MiSvf()];
    this.dcBlocker = [new MiSvf(), new MiSvf()];
    for (const f of this.dcBlocker) f.setFQ(40 / sampleRate, 0.5);
    this.limiter = new MiLimiter(1 / sampleRate, 0.95);
    this.multiplierLp = 0; this.shape = 0; this.density = 0; this.feedback = 0; this.speed = 1; this.bandwidth = 0.5;
    this.previousL = 0; this.previousR = 0;
    this.tickPhase = 0;
    this.acc = [0, 0];
  }
  clear() { this.line.l.fill(0); this.line.r.fill(0); this.previousL = this.previousR = 0; }
  /**
   * A block. \`p\`: interval (the clock's, in samples), density, multiply and shape (0..1), pitch (semitones),
   * bandwidth (0..1, 0.5 open), feedback (0..1). In from inL/inR, the wet signal out.
   */
  process(inL, inR, outL, outR, size, p) {
    const lpCoefficient = 0.9, softLimitGain = 1.3, maxFeedbackGain = 1.5; // Beads' 16-bit quality
    const dShape = (p.shape * 0.995 - this.shape) / size, dDensity = (p.density - this.density) / size;
    const dFeedback = (p.feedback - this.feedback) / size;
    const speedTarget = Math.pow(2, p.pitch / 12), dSpeed = (speedTarget - this.speed) / size;
    const dBandwidth = (p.bandwidth - this.bandwidth) / size;
    const tapRatio = [0, 0], tapGain = [0, 0], acc = this.acc;
    const sliceModulation = 1.005 * p.multiply;
    for (let k = 0; k < size; k++) {
      // the clock, ticked at the interval (Beads' gate input)
      this.tickPhase += 1;
      let tick = false;
      if (this.tickPhase >= p.interval) { this.tickPhase -= p.interval; tick = true; }
      this.clock.process(tick);
      this.density += dDensity; this.shape += dShape;
      // DENSITY picks two neighbouring ratios of the clock and fades between them
      const density = Math.min(1, Math.max(0, this.density));
      const ratio = density * 20, ri = Math.trunc(ratio);
      let rf = (ratio - ri - 0.5) * (density < 0.5 ? 4 : 1.5) + 0.5;
      rf = Math.min(1, Math.max(0, rf));
      const flip = ri & 1;
      tapRatio[flip] = MI_DELAY_RATIOS[ri]; tapRatio[1 - flip] = MI_DELAY_RATIOS[ri + 1];
      tapGain[flip] = 1 - rf; tapGain[1 - flip] = rf;
      // the envelopes that fade in start again
      if (this.clock.retrig()) {
        const start = this.clock.newIntervalIndex() * MI_NUM_HEADS;
        for (let i = start; i < start + MI_NUM_HEADS; i++) this.envelopes[i].init();
      }
      // MULTIPLY: how many multiples of the interval sound, fading between two counts
      this.multiplierLp += 0.01 * (sliceModulation - this.multiplierLp);
      let multiplier = Math.min(16, Math.max(1, this.multiplierLp * 15 + 1));
      const mi = Math.trunc(multiplier);
      let mf = 0.5 + 8 * (multiplier - mi - 0.5);
      mf = Math.min(1, Math.max(0, mf));
      for (let t = 0; t < MI_NUM_TAPS; t++) {
        const interval = Math.trunc(t / MI_NUM_HEADS), r = Math.trunc(t / 2) % 2, tap = t & 1;
        const i = (2 * r + ((mi & 1) ? tap : 1 - tap)) + interval * MI_NUM_HEADS;
        let delayTime = this.clock.intervalOf(interval) * tapRatio[r] * (mi + tap);
        delayTime = Math.min(this.maxDelay, Math.max(MI_MIN_DELAY, delayTime));
        this.envelopes[i].increment = 1 / delayTime;
        this.tapDelay[i] = Math.trunc(delayTime * 1024);
        const baseGain = tapGain[r] * (tap ? mf : 1 - mf) * this.clock.gainOf(interval);
        this.tapGain[i] = baseGain * this.envelopes[i].render(this.shape);
      }
      // the feedback path: the last output back in, limited and soft-clipped
      this.feedback += dFeedback;
      const fb = this.feedback, inl = inL[k], inr = inR[k];
      let sl = inl + this.previousL * fb * (maxFeedbackGain / softLimitGain);
      let sr = inr + this.previousR * fb * (maxFeedbackGain / softLimitGain);
      const g = this.limiter.gain(sl, sr);
      sl = miSoftClip(sl * g * softLimitGain); sr = miSoftClip(sr * g * softLimitGain);
      this.line.write(inl + fb * (sl - inl), inr + fb * (sr - inr));
      // the taps
      this.speed += dSpeed; this.bandwidth += dBandwidth;
      const speed = this.speed;
      let pitchGain = 100 * (Math.abs(speed - 1) - 0.01);
      pitchGain = Math.min(1, Math.max(0, pitchGain));
      acc[0] = 0; acc[1] = 0;
      for (let i = 0; i < MI_NUM_TAPS; i++) {
        this.taps[i].render(this.line, this.tapDelay[i], this.tapGain[i] * pitchGain, speed, acc);
        this.noLatencyTaps[i].render(this.line, this.tapDelay[i], this.tapGain[i] * (1 - pitchGain), speed, acc);
      }
      // FILTER: low-pass below the middle, high-pass above
      const bw = this.bandwidth, amount = Math.abs(2 * bw - 1);
      const octave = bw < 0.5 ? -7 + bw * 10 : -8 + (bw - 0.5) * 10;
      const f = 0.49 * Math.pow(2, octave), q = 1 + 16 * amount * f;
      const wetSqrt = amount * (2 - amount), wetAmount = wetSqrt * (2 - wetSqrt);
      this.filter[0].setFQ(f, q); this.filter[1].g = this.filter[0].g; this.filter[1].r = this.filter[0].r; this.filter[1].h = this.filter[0].h;
      const mode = bw < 0.5 ? 0 : 2;
      const wl = this.filter[0].process(acc[0], mode), wr = this.filter[1].process(acc[1], mode);
      const ol = acc[0] + (wl - acc[0]) * wetAmount, or = acc[1] + (wr - acc[1]) * wetAmount;
      outL[k] = ol; outR[k] = or;
      this.previousL += lpCoefficient * (this.dcBlocker[0].process(ol, 2) - this.previousL);
      this.previousR += lpCoefficient * (this.dcBlocker[1].process(or, 2) - this.previousR);
    }
  }
}
`;
