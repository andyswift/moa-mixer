export const DUO_NAME = 'moa-duo';

/**
 * The MOA-DUO synth as the source text of an audio worklet module (see `pipeWorklet.ts`: tests evaluate the same
 * text to get `DuoCore`, so what they check is what ships). Stereo out, per sample.
 *
 *   osc 1 (saw / pulse) \                     /- filter 1 \
 *   osc 2 (saw / tri, sync, detune) >- VCO route -         >- VCF route -> VCA -> reverb -> out
 *   noise               /                     \- filter 2 /   (VCO route VCA goes straight to the VCA)
 *
 * Two 12 dB state-variable filters share CUTOFF and RESONANCE; POST offsets filter 2. Three routing switches pick
 * where the oscillators go (VCO), how the filters connect (VCF) and which modulator moves which filter (MOD).
 * Three modulators (filter 1, filter 2, VCA) share one design: RISE and FALL times, HOLD (fall becomes a release)
 * and LFO (the envelope loops). The reverb is a four-line feedback delay network whose DECAY reaches infinity.
 * Notes arrive as `play` messages (`play(n1, n2, gate, retrig)`): the page does the paraphonic note assignment.
 * Not circuit-exact: this aims at the character of a small paraphonic analogue synth.
 */
export const DUO_SOURCE = `
const DUO_TWO_PI = Math.PI * 2;

// name, default, min, max
const DUO_PARAM_DEFS = [
  ['o1Wave', 0, 0, 1], ['o1Off', -12, -36, 12], ['o1Pw', 0, 0, 1], ['o1Lvl', 0.8, 0, 1], ['o1Gld', 0, 0, 1],
  ['o2Wave', 0, 0, 1], ['o2Off', 0, -36, 12], ['o2Dtn', 0, 0, 24], ['o2Lvl', 0.8, 0, 1], ['o2Gld', 0, 0, 1],
  ['tune', 0, -100, 100], ['sync', 0, 0, 1], ['vibRate', 5, 0.1, 20], ['vibLvl', 0, 0, 1], ['noise', 0, 0, 1],
  ['vcoRoute', 0, 0, 3], ['vcfRoute', 0, 0, 3], ['modRoute', 0, 0, 3],
  ['cutoff', 1500, 20, 20000], ['res', 0.2, 0, 1], ['post', 0, -4, 4],
  ['m1Rise', 0.01, 0.001, 5], ['m1Fall', 0.4, 0.01, 15], ['m1Hold', 0, 0, 1], ['m1Lfo', 0, 0, 1], ['m1Lvl', 0.3, 0, 1],
  ['m2Rise', 0.01, 0.001, 5], ['m2Fall', 0.4, 0.01, 15], ['m2Hold', 0, 0, 1], ['m2Lfo', 0, 0, 1], ['m2Lvl', 0, 0, 1],
  ['vcaRise', 0.005, 0.001, 5], ['vcaFall', 0.4, 0.01, 15], ['vcaHold', 1, 0, 1], ['vcaLfo', 0, 0, 1], ['level', 0.8, 0, 1.5],
  ['rvTime', 0.02, 0, 1], ['rvDecay', 0.4, 0, 1], ['rvMix', 0.2, 0, 1],
  ['bend', 0, -3, 3], ['modw', 0, 0, 1],
];
const DUO_DEFAULTS = {};
for (const d of DUO_PARAM_DEFS) DUO_DEFAULTS[d[0]] = d[1];

function duoTanh(x) {
  if (x > 3) return 1;
  if (x < -3) return -1;
  const x2 = x * x;
  return x * (27 + x2) / (27 + 9 * x2);
}

// PolyBLEP step correction for a discontinuity at phase 0 (t = phase, dt = increment).
function duoBlep(t, dt) {
  if (t < dt) { t /= dt; return t + t - t * t - 1; }
  if (t > 1 - dt) { t = (t - 1) / dt; return t * t + t + t + 1; }
  return 0;
}

// A modulator: rise and fall, optional hold (fall becomes release) and optional LFO (loops).
class DuoMod {
  constructor(sr) { this.sr = sr; this.v = 0; this.stage = 0; this.gate = false; }

  // stage: 0 idle, 1 rising, 2 falling (decay), 3 holding at max, 4 releasing
  tick(gate, trig, rise, fall, hold, lfo) {
    const sr = this.sr;
    if (lfo) {
      if (hold && gate) { this.v = 1; this.stage = 3; this.gate = gate; return 1; }
      if (this.stage === 0 || this.stage === 3) this.stage = 1;
    } else {
      if (trig && gate) this.stage = 1;
      else if (gate && !this.gate) this.stage = 1;
      else if (!gate && this.gate && hold && (this.stage === 1 || this.stage === 3)) this.stage = 4;
    }
    this.gate = gate;
    switch (this.stage) {
      case 1:
        this.v += (1.2 - this.v) * (1 - Math.exp(-1.79 / (rise * sr)));
        if (this.v >= 1) {
          this.v = 1;
          this.stage = lfo ? 2 : (hold ? (gate ? 3 : 4) : 2);
        }
        break;
      case 2: case 4:
        this.v -= this.v * (1 - Math.exp(-4.6 / (fall * sr)));
        if (this.v < (lfo ? 0.02 : 0.002)) { this.v = lfo ? 0.02 : 0; this.stage = lfo ? 1 : 0; }
        break;
      case 3:
        this.v = 1;
        break;
      default:
        this.v = 0;
    }
    return this.v;
  }
}

// 12 dB state-variable filter (zero-delay feedback, tanh-saturated integrators), self-oscillating.
class DuoSvf {
  constructor(sr) { this.sr = sr; this.s1 = 0; this.s2 = 0; this.lp = 0; this.hp = 0; this.seed = 777; }
  run(x, fc, res) {
    const sr = this.sr;
    const g = Math.tan(Math.PI * Math.min(fc, 0.45 * sr) / sr);
    const k = 1.8 * (1 - res) - 0.07 * Math.pow(res, 8);
    this.seed = (this.seed * 1664525 + 1013904223) >>> 0;
    const xin = x + (this.seed / 4294967296 - 0.5) * 2e-5;
    const hp = (xin - (k + g) * this.s1 - this.s2) / (1 + g * (k + g));
    const bp = g * hp + this.s1;
    const lp = g * bp + this.s2;
    this.s1 = duoTanh((g * hp + bp) * 0.8) / 0.8;
    this.s2 = duoTanh((g * bp + lp) * 0.8) / 0.8;
    this.lp = lp;
    this.hp = hp;
  }
}

class DuoReverb {
  constructor(sr) {
    this.sr = sr;
    const scale = sr / 44100;
    const lens = [1117, 1559, 1877, 2203].map((n) => Math.round(n * scale));
    this.lens = lens;
    this.lines = lens.map((n) => new Float32Array(n));
    this.pos = [0, 0, 0, 0];
    this.damp = [0, 0, 0, 0];
    this.dc = [0, 0, 0, 0];
    this.y = [0, 0, 0, 0];
    this.pre = new Float32Array(Math.ceil(0.3 * sr) + 4);
    this.prePos = 0;
    this.ap = [new Float32Array(Math.round(347 * scale)), new Float32Array(Math.round(113 * scale))];
    this.apPos = [0, 0];
  }

  // in: mono; writes the wet stereo pair into out[0], out[1]
  tick(x, time, decay, out) {
    const sr = this.sr;
    // pre-delay (the TIME knob) and a loop that brightens as it grows
    const preLen = Math.max(1, Math.floor(time * 0.25 * sr));
    this.pre[this.prePos] = x;
    let rp = this.prePos - preLen; if (rp < 0) rp += this.pre.length;
    this.prePos = (this.prePos + 1) % this.pre.length;
    let s = this.pre[rp];
    for (let i = 0; i < 2; i++) {
      const buf = this.ap[i];
      const p = this.apPos[i];
      const d = buf[p];
      const v = s + 0.6 * d;
      buf[p] = v;
      s = d - 0.6 * v;
      this.apPos[i] = (p + 1) % buf.length;
    }
    const bright = 0.25 + 0.7 * time;
    const dampA = 1 - Math.exp(-DUO_TWO_PI * (2500 + 9000 * bright) / sr);
    let sum = 0;
    const y = this.y;
    for (let i = 0; i < 4; i++) { y[i] = this.lines[i][this.pos[i]]; sum += y[i]; }
    const mix = sum * 0.5;
    const infinite = decay >= 0.995;
    // decay 0..1: RT60 from 0.25 s up to about 25 s, then infinite at the top
    const rt = 0.25 * Math.pow(100, Math.min(decay, 0.99));
    for (let i = 0; i < 4; i++) {
      const g = infinite ? 1 : Math.exp(-6.9078 * this.lens[i] / (sr * rt));
      let w = y[i] - mix;
      this.damp[i] += (w - this.damp[i]) * dampA;
      w = this.damp[i] * g;
      this.dc[i] += (w - this.dc[i]) * 0.0007;
      w = duoTanh((w - this.dc[i] + s * 0.5) * 0.9) / 0.9;
      this.lines[i][this.pos[i]] = w;
      this.pos[i] = (this.pos[i] + 1) % this.lens[i];
    }
    out[0] = (y[0] + y[2]) * 0.7;
    out[1] = (y[1] + y[3]) * 0.7;
  }
}

class DuoCore {
  constructor(sampleRate, random) {
    this.sr = sampleRate;
    this.random = random || Math.random;
    this.n1 = 60; this.n2 = 60;
    this.p1 = 60; this.p2 = 60;
    this.gate = false; this.trig = false;
    this.ph1 = 0; this.ph2 = 0;
    this.vibPh = 0;
    this.drift = 0; this.drift2 = 0;
    this.f1 = new DuoSvf(sampleRate);
    this.f2 = new DuoSvf(sampleRate);
    this.logCut = -1;
    this.m1 = new DuoMod(sampleRate);
    this.m2 = new DuoMod(sampleRate);
    this.mv = new DuoMod(sampleRate);
    this.rev = new DuoReverb(sampleRate);
    this.wet = [0, 0];
    this.started = false;
    this.view = { m: [0, 0, 0], gate: false };
  }

  play(n1, n2, gate, retrig) {
    this.n1 = n1; this.n2 = n2;
    if (!this.started) { this.p1 = n1; this.p2 = n2; this.started = true; }
    if (gate && retrig) this.trig = true;
    this.gate = !!gate;
  }

  process(outL, outR, n, p) {
    const sr = this.sr;
    const rnd = this.random;
    const gl1 = p.o1Gld < 0.001 ? 1 : 1 - Math.exp(-1 / (p.o1Gld * p.o1Gld * 2 * sr));
    const gl2 = p.o2Gld < 0.001 ? 1 : 1 - Math.exp(-1 / (p.o2Gld * p.o2Gld * 2 * sr));
    const cutSm = 1 - Math.exp(-1 / (0.006 * sr));
    const cutLog = Math.log2(Math.max(20, p.cutoff));
    if (this.logCut < 0) this.logCut = cutLog;
    const vcoR = Math.round(p.vcoRoute), vcfR = Math.round(p.vcfRoute), modR = Math.round(p.modRoute);
    const sync = p.sync > 0.5;
    const pw = 0.5 - p.o1Pw * 0.45;
    const vibDepth = Math.min(1, p.vibLvl + p.modw) * 0.8; // semitones
    const vibInc = p.vibRate / sr;
    const lvl1 = p.o1Lvl * 0.5, lvl2 = p.o2Lvl * 0.5, nz = p.noise * 0.5;
    const m1d = p.m1Lvl * 6, m2d = p.m2Lvl * 6;
    for (let i = 0; i < n; i++) {
      // modulators
      const trig = this.trig; this.trig = false;
      const a = this.m1.tick(this.gate, trig, p.m1Rise, p.m1Fall, p.m1Hold > 0.5, p.m1Lfo > 0.5);
      const b = this.m2.tick(this.gate, trig, p.m2Rise, p.m2Fall, p.m2Hold > 0.5, p.m2Lfo > 0.5);
      const c = this.mv.tick(this.gate, trig, p.vcaRise, p.vcaFall, p.vcaHold > 0.5, p.vcaLfo > 0.5);

      // pitch: glide, vibrato, bend, tune and a slow wander
      this.p1 += (this.n1 - this.p1) * gl1;
      this.p2 += (this.n2 - this.p2) * gl2;
      this.vibPh += vibInc; if (this.vibPh >= 1) this.vibPh -= 1;
      const vib = Math.sin(DUO_TWO_PI * this.vibPh) * vibDepth;
      this.drift += (rnd() * 2 - 1 - this.drift) * 0.00002;
      this.drift2 += (rnd() * 2 - 1 - this.drift2) * 0.00002;
      const semi = p.bend + vib;
      const hz1 = 440 * Math.pow(2, (this.p1 + p.o1Off - 69 + semi + this.drift * 0.08) / 12);
      // TUNE moves oscillator 2 only, so it detunes against oscillator 1
      const hz2 = 440 * Math.pow(2, (this.p2 + p.o2Off + p.o2Dtn - 69 + semi + p.tune * 0.01 + this.drift2 * 0.08) / 12);
      const dt1 = Math.min(0.45, hz1 / sr), dt2 = Math.min(0.45, hz2 / sr);

      // osc 1: saw or pulse
      this.ph1 += dt1;
      let wrapped = false, wrapFrac = 0;
      if (this.ph1 >= 1) { this.ph1 -= 1; wrapped = true; wrapFrac = this.ph1 / dt1; }
      let o1;
      if (p.o1Wave < 0.5) o1 = 2 * this.ph1 - 1 - duoBlep(this.ph1, dt1);
      else {
        o1 = this.ph1 < pw ? 1 : -1;
        o1 += duoBlep(this.ph1, dt1);
        let t2 = this.ph1 - pw; if (t2 < 0) t2 += 1;
        o1 -= duoBlep(t2, dt1);
      }
      // osc 2: saw or triangle, hard-synced to osc 1
      this.ph2 += dt2;
      if (this.ph2 >= 1) this.ph2 -= 1;
      if (sync && wrapped) this.ph2 = Math.min(0.999, wrapFrac * dt2);
      const o2 = p.o2Wave < 0.5
        ? 2 * this.ph2 - 1 - duoBlep(this.ph2, dt2)
        : (this.ph2 < 0.5 ? 4 * this.ph2 - 1 : 3 - 4 * this.ph2);

      const noise = (rnd() * 2 - 1) * nz;
      const s1 = o1 * lvl1, s2 = o2 * lvl2;

      // VCO route
      let in1 = 0, in2 = 0, direct = 0;
      if (vcoR === 0) in1 = s1 + s2 + noise;
      else if (vcoR === 1) { in1 = s1 + noise; in2 = s2; }
      else if (vcoR === 2) in2 = s1 + s2 + noise;
      else direct = s1 + s2 + noise;

      // filter cutoffs: shared CUTOFF, POST on filter 2, modulators per the MOD route
      this.logCut += (cutLog - this.logCut) * cutSm;
      let mod1 = 0, mod2 = 0;
      if (modR === 0) { mod1 = a * m1d; mod2 = a * m1d; }
      else if (modR === 1) { mod1 = a * m1d + b * m2d; mod2 = mod1; }
      else if (modR === 2) { mod1 = a * m1d; mod2 = b * m2d; }
      else { mod1 = a * m1d; mod2 = a * m1d + b * m2d; }
      const fc1 = Math.min(20000, Math.pow(2, this.logCut + mod1));
      const fc2 = Math.min(20000, Math.pow(2, this.logCut + p.post + mod2));
      let out;
      if (vcfR <= 1) {
        // series: filter 2 takes filter 1's output plus whatever the VCO route sends it directly
        this.f1.run(in1, fc1, p.res);
        const mid = vcfR === 0 ? this.f1.lp : this.f1.hp;
        this.f2.run(mid + in2, fc2, p.res);
        out = vcfR === 0 ? this.f2.lp : this.f2.hp;
      } else {
        this.f1.run(in1, fc1, p.res);
        this.f2.run(in2, fc2, p.res);
        out = this.f1.lp + (vcfR === 2 ? this.f2.lp : this.f2.hp);
      }
      out = (duoTanh(out) + direct) * 0.95;

      // VCA and reverb
      const dry = out * c * p.level;
      this.rev.tick(dry, p.rvTime, p.rvDecay, this.wet);
      const wetMix = p.rvMix, dryMix = 1 - p.rvMix * 0.5;
      const l = dry * dryMix + this.wet[0] * wetMix;
      const r = dry * dryMix + this.wet[1] * wetMix;
      outL[i] = duoTanh(l * 0.9) / 0.9;
      outR[i] = duoTanh(r * 0.9) / 0.9;
      this.view.m[0] = a; this.view.m[1] = b; this.view.m[2] = c;
    }
    this.view.gate = this.gate;
  }
}

if (typeof registerProcessor === 'function') {
  class MoaDuo extends AudioWorkletProcessor {
    static get parameterDescriptors() {
      return DUO_PARAM_DEFS.map((d) => ({ name: d[0], defaultValue: d[1], minValue: d[2], maxValue: d[3], automationRate: 'k-rate' }));
    }
    constructor() {
      super();
      this.core = new DuoCore(sampleRate);
      this.p = Object.assign({}, DUO_DEFAULTS);
      this.sinceView = 0;
      this.port.onmessage = (e) => {
        const m = e.data;
        if (m && m.type === 'play') this.core.play(m.n1, m.n2, m.gate, m.retrig);
      };
    }
    process(inputs, outputs, params) {
      const out = outputs[0];
      for (const name in params) this.p[name] = params[name][0];
      const n = out[0].length;
      this.core.process(out[0], out[1] || out[0], n, this.p);
      this.sinceView += n;
      if (this.sinceView >= sampleRate / 30) {
        this.sinceView = 0;
        this.port.postMessage({ m: this.core.view.m.slice(), gate: this.core.view.gate });
      }
      return true;
    }
  }
  registerProcessor('${DUO_NAME}', MoaDuo);
}
`;
