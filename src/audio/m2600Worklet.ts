import { M2600_INPUTS, M2600_OUTPUTS, M2600_PARAMS, M2600_PERFORMANCE } from '../domain/devices/m2600Params';

export const M2600_NAME = 'moa-2600';

const DEFS = [...M2600_PARAMS, ...M2600_PERFORMANCE].map((p) => [p.id, p.def, p.min, p.max]);
const INPUTS = M2600_INPUTS.map((i) => ({ id: i.id, normal: i.normal ?? null }));

/**
 * The MOA-2600 as the source text of an audio worklet module (see `pipeWorklet.ts`: tests evaluate the same text to
 * get `M26Core`, so what they check is what ships). One voice, stereo out, per sample.
 *
 * Built like the semi-modular it copies: every module writes its output jacks into one signal array (`sig`, indexed
 * by `M2600_OUTPUTS`, in volts), and every input reads `sig[source]`, where the source is the input's normal from
 * `M2600_INPUTS` unless a cord (`setCords`) overrides it. Modules run in a fixed order each sample; an input that
 * reads a module further down the order hears the previous sample, as a cord would.
 *
 *   keyboard + LFO -> noise -> S/H -> ADSR, AR -> VCO 1, 2, 3 -> ring mod -> preamp, env follower
 *     -> VCF (4012 / 4072) -> SEM (LP-notch-HP / BP; off, series or parallel) -> VCA -> mixer -> reverb -> out
 *     -> voltage processors, electronic switch
 *
 * The params are the control ids of `m2600Params.ts` (choices arrive as option indices, toggles as 0 / 1). Notes
 * arrive as `play` messages: n1 the lower (main) voice, n2 the upper voice (the device sends n1 === n2 in mono).
 * Not circuit-exact: it aims at the character.
 */
export const M2600_SOURCE = `
const M26_TWO_PI = Math.PI * 2;
// name, default, min, max
const M26_PARAM_DEFS = ${JSON.stringify(DEFS)};
const M26_DEFAULTS = {};
for (const d of M26_PARAM_DEFS) M26_DEFAULTS[d[0]] = d[1];
const M26_OUTPUTS = ${JSON.stringify(M2600_OUTPUTS)};
const M26_INPUTS = ${JSON.stringify(INPUTS)};
const M26_O = {};
M26_OUTPUTS.forEach((id, i) => { M26_O[id] = i; });
// three constant signals after the outputs: -10 V, +10 V and silence (for inputs with no normal)
const M26_NEG10 = M26_OUTPUTS.length, M26_POS10 = M26_NEG10 + 1, M26_ZERO = M26_NEG10 + 2, M26_NSIG = M26_NEG10 + 3;
const M26_I = {};
M26_INPUTS.forEach((x, i) => { M26_I[x.id] = i; });
const M26_NORMALS = Int32Array.from(M26_INPUTS.map((x) =>
  x.normal === '-10V' ? M26_NEG10 : x.normal === '+10V' ? M26_POS10 : x.normal ? M26_O[x.normal] : M26_ZERO));
const M26_FACTORS = [0.5, 1, 2];
const M26_PRE_RANGES = [10, 100, 1000];

function m26Tanh(x) {
  if (x > 3) return 1;
  if (x < -3) return -1;
  const x2 = x * x;
  return x * (27 + x2) / (27 + 9 * x2);
}

// PolyBLEP step correction for a discontinuity at phase 0 (t = phase, dt = increment).
function m26Blep(t, dt) {
  if (t < dt) { t /= dt; return t + t - t * t - 1; }
  if (t > 1 - dt) { t = (t - 1) / dt; return t * t + t + t + 1; }
  return 0;
}

// An oscillator with every waveform out at once (±5 V). resetFrac >= 0 hard-syncs it (the master wrapped that
// fraction of a sample ago).
class M26Vco {
  constructor() { this.ph = 0; this.saw = 0; this.pulse = 0; this.tri = 0; this.sine = 0; this.wrapped = false; this.frac = 0; }
  run(dt, pw, resetFrac) {
    this.ph += dt;
    this.wrapped = false;
    if (this.ph >= 1) { this.ph -= Math.floor(this.ph); this.wrapped = true; this.frac = this.ph / dt; }
    if (resetFrac >= 0) this.ph = Math.min(0.999, resetFrac * dt);
    const ph = this.ph;
    this.saw = 5 * (2 * ph - 1 - m26Blep(ph, dt));
    let pl = ph < pw ? 1 : -1;
    pl += m26Blep(ph, dt);
    let t2 = ph - pw; if (t2 < 0) t2 += 1;
    pl -= m26Blep(t2, dt);
    this.pulse = 5 * pl;
    this.tri = 5 * (ph < 0.5 ? 4 * ph - 1 : 3 - 4 * ph);
    this.sine = 5 * Math.sin(M26_TWO_PI * ph);
  }
}

// ADSR (0..10 V): a gate opening or a trigger restarts the attack from wherever the level is.
class M26Adsr {
  constructor() { this.v = 0; this.stage = 0; this.g = false; }
  tick(gate, trig, aRate, dCoef, sus, rCoef) {
    if ((gate && !this.g) || (gate && trig)) this.stage = 1;
    else if (!gate && this.g) this.stage = 3;
    this.g = gate;
    if (this.stage === 1) {
      this.v += aRate;
      if (this.v >= 10) { this.v = 10; this.stage = 2; }
    } else if (this.stage === 2) this.v += (sus - this.v) * dCoef;
    else if (this.stage === 3) {
      this.v -= this.v * rCoef;
      if (this.v < 1e-4) { this.v = 0; this.stage = 0; }
    }
    return this.v;
  }
}

// TPT ladder (zero-delay feedback, solved linearly, the input stage saturated): four one-poles in a resonant loop.
class M26Ladder {
  constructor() { this.s = [0, 0, 0, 0]; this.y = 0; }
  run(x, g, k, drive) {
    const G = g / (1 + g), ig = 1 / (1 + g), s = this.s;
    const G2 = G * G;
    const S = (G2 * G * s[0] + G2 * s[1] + G * s[2] + s[3]) * ig;
    const y4 = (G2 * G2 * x + S) / (1 + k * G2 * G2);
    let u = m26Tanh((x - k * y4) * drive) / drive;
    for (let j = 0; j < 4; j++) {
      const v = (u - s[j]) * G;
      const y = v + s[j];
      s[j] = y + v;
      u = y;
    }
    this.y = u;
    return u;
  }
}

// 12 dB TPT state-variable filter with saturating integrators (the SEM).
class M26Svf {
  constructor() { this.s1 = 0; this.s2 = 0; this.lp = 0; this.bp = 0; this.hp = 0; }
  run(x, g, k) {
    const hp = (x - (k + g) * this.s1 - this.s2) / (1 + g * (k + g));
    const bp = g * hp + this.s1;
    const lp = g * bp + this.s2;
    this.s1 = m26Tanh((g * hp + bp) * 0.7) / 0.7;
    this.s2 = m26Tanh((g * bp + lp) * 0.7) / 0.7;
    this.lp = lp; this.bp = bp; this.hp = hp;
  }
}

// A compact stereo spring-ish reverb: per side a damped feedback delay with an allpass chain inside the loop (the
// chirpy dispersion), a little cross-feed, and a soft clip in the loop so it stays bounded.
class M26Reverb {
  constructor(sr) {
    const sc = sr / 44100;
    const mk = (n) => new Float32Array(Math.max(2, Math.round(n * sc)));
    this.lines = [mk(1601), mk(1777)];
    this.pos = [0, 0];
    this.aps = [[mk(142), mk(107), mk(379), mk(53)], [mk(151), mk(113), mk(397), mk(61)]];
    this.apPos = [[0, 0, 0, 0], [0, 0, 0, 0]];
    this.damp = [0, 0];
    this.dc = [0, 0];
    this.out = [0, 0];
    this.dampA = 1 - Math.exp(-M26_TWO_PI * 4200 / sr);
  }
  tick(x) {
    const yl = this.lines[0][this.pos[0]], yr = this.lines[1][this.pos[1]];
    this.out[0] = yl * 5; this.out[1] = yr * 5;
    const ys = [yl, yr];
    for (let c = 0; c < 2; c++) {
      this.damp[c] += (ys[c] * 0.88 + ys[1 - c] * 0.1 - this.damp[c]) * this.dampA;
      let v = x * 0.06 + this.damp[c] * 0.8;
      this.dc[c] += (v - this.dc[c]) * 0.0005;
      v -= this.dc[c];
      const bufs = this.aps[c], ps = this.apPos[c];
      for (let j = 0; j < 4; j++) {
        const b = bufs[j], p = ps[j], d = b[p];
        const w = v + 0.55 * d;
        b[p] = w;
        v = d - 0.55 * w;
        ps[j] = p + 1 === b.length ? 0 : p + 1;
      }
      this.lines[c][this.pos[c]] = m26Tanh(v);
      this.pos[c] = this.pos[c] + 1 === this.lines[c].length ? 0 : this.pos[c] + 1;
    }
  }
}

class M26Core {
  constructor(sampleRate, random) {
    this.sr = sampleRate;
    this.random = random || Math.random;
    this.sig = new Float64Array(M26_NSIG);
    this.sig[M26_NEG10] = -10;
    this.sig[M26_POS10] = 10;
    this.cord = new Int32Array(M26_INPUTS.length).fill(-1);
    /** An output index to send straight to both channels (volts / 5) instead of the mix, for tests and scopes. */
    this.probe = -1;
    // keyboard
    this.n1 = 60; this.n2 = 60; this.keyGate = false; this.trigReq = false; this.started = false;
    this.cvLo = 0; this.cvHi = 0; this.trigLeft = 0; this.vibT = 0; this.autoGate = false;
    this.manualOn = false;
    // modules
    this.lfoPh = 0; this.lfoSq = false;
    this.pk = [0, 0, 0, 0, 0, 0, 0]; this.lfNoise = 0;
    this.shPh = 0; this.shHigh = false; this.extClk = false; this.held = 0; this.esw = 0;
    this.adsr = new M26Adsr(); this.ar = new M26Adsr(); this.trigPrev = false;
    this.v1 = new M26Vco(); this.v2 = new M26Vco(); this.v3 = new M26Vco();
    this.ringHa = [0, 0]; this.ringHb = [0, 0];
    this.envf = 0;
    this.vcf = new M26Ladder(); this.sem = new M26Svf();
    this.lag = 0;
    this.rev = new M26Reverb(sampleRate);
    this.seed = 12345;
    this.view = { gate: false, lfo: false, clk: false, esw: 0, adsr: 0, ar: 0 };
  }

  play(n1, n2, gate, retrig) {
    this.n1 = n1; this.n2 = n2;
    if (!this.started) { this.cvLo = (n1 - 60) / 12; this.cvHi = (n2 - 60) / 12; this.started = true; }
    if (gate && (retrig || !this.keyGate)) this.trigReq = true;
    if (gate && !this.keyGate) this.vibT = 0;
    this.keyGate = !!gate;
  }

  manual(on) { this.manualOn = !!on; }

  /** Patch cords: a list of { from: output id, to: input id }; replaces every cord. Unknown ids are skipped. */
  setCords(list) {
    this.cord.fill(-1);
    for (const c of list || []) {
      const i = M26_I[c.to], o = M26_O[c.from];
      if (i !== undefined && o !== undefined) this.cord[i] = o;
    }
  }

  src(id) { const i = M26_I[id]; return this.cord[i] >= 0 ? this.cord[i] : M26_NORMALS[i]; }
  patched(id) { return this.cord[M26_I[id]] >= 0; }

  process(outL, outR, n, p) {
    const sr = this.sr, rnd = this.random, sig = this.sig, O = M26_O;
    const src = (id) => this.src(id);
    // ---- per-block: sources
    const sExtVib = src('kb.extvib'), sPre = src('pre.in'), sEnvf = src('envf.in');
    const sRingA = src('ring.a'), sRingB = src('ring.b');
    const s1k = src('vco1.fm.kybd'), s1sh = src('vco1.fm.sh'), s1ad = src('vco1.fm.adsr'), s1lfo = src('vco1.fm.lfo');
    const s2k = src('vco2.fm.kybd'), s2sh = src('vco2.fm.sh'), s2ad = src('vco2.fm.adsr'), s2v1 = src('vco2.fm.vco1'), s2pwm = src('vco2.pwm');
    const s3k = src('vco3.fm.kybd'), s3nz = src('vco3.fm.noise'), s3ad = src('vco3.fm.adsr'), s3v2 = src('vco3.fm.vco2'), s3pwm = src('vco3.pwm');
    const sfRing = src('vcf.in.ring'), sfV1 = src('vcf.in.vco1'), sfV2 = src('vcf.in.vco2'), sfV3 = src('vcf.in.vco3'), sfNz = src('vcf.in.noise');
    const sfK = src('vcf.cv.kybd'), sfAd = src('vcf.cv.adsr'), sfV2c = src('vcf.cv.vco2');
    const ssV1 = src('sem.in.vco1'), ssV2 = src('sem.in.vco2'), ssV3 = src('sem.in.vco3'), ssNz = src('sem.in.noise');
    const ssK = src('sem.cv.kybd'), ssAd = src('sem.cv.adsr'), ssLfo = src('sem.cv.lfo');
    const sAdGate = src('adsr.gate'), sAdTrig = src('adsr.trig');
    const sVcaAr = src('vca.cv.ar'), sVcaAd = src('vca.cv.adsr'), sVcaRing = src('vca.in.ring');
    const sVp = [src('vp.1'), src('vp.2'), src('vp.3'), src('vp.4'), src('vp.5'), src('vp.6'), src('vp.7')];
    const sShIn = src('sh.in'), sExtClk = src('sh.extclk'), extClk = this.patched('sh.extclk');
    const sEswA = src('esw.a'), sEswB = src('esw.b'), sOutL = src('out.left'), sOutR = src('out.right');
    const arPatched = this.patched('ar.gate'), sArGate = src('ar.gate');
    const route = Math.round(p['sem.route']); // 0 off, 1 series, 2 parallel
    const filterBus = route === 1 ? O['sem.out'] : O['vcf.out'];
    const sVcaVcf = this.patched('vca.in.vcf') ? src('vca.in.vcf') : filterBus;
    const sMixVcf = this.patched('mix.in.vcf') ? src('mix.in.vcf') : filterBus;
    const sVcaSem = this.patched('vca.in.sem') ? src('vca.in.sem') : (route === 2 ? O['sem.out'] : M26_ZERO);
    const sMixVca = src('mix.in.vca');
    const k1Patched = this.patched('vco1.fm.kybd'), k2Patched = this.patched('vco2.fm.kybd'), k3Patched = this.patched('vco3.fm.kybd');

    // ---- per-block: params
    const portaC = p['kb.portaOn'] > 0.5 && p['kb.porta'] > 0.001 ? 1 - Math.exp(-1 / (p['kb.porta'] * p['kb.porta'] * 2 * sr)) : 1;
    const repeat = Math.round(p['kb.repeat']); // 0 kybd, 1 off, 2 auto
    const lfoInc = p['lfo.speed'] / sr;
    const vibDelay = p['lfo.delay'];
    const vibDepth = Math.min(1, p['lfo.depth'] + p.modw) * 0.25;
    const bendV = p.bend / 12;
    const preGain = p['pre.gain'] * M26_PRE_RANGES[Math.round(p['pre.range'])];
    const envfGain = p['envf.gain'];
    const ringDc = p['ring.mode'] > 0.5, ringA = p['ring.a'], ringB = p['ring.b'];
    const ringHpA = 1 - Math.exp(-M26_TWO_PI * 10 / sr);
    const color = p['noise.color'], noiseLvl = p['noise.level'] * 5;
    const lfA = 1 - Math.exp(-M26_TWO_PI * 6 / sr);
    const vco = [1, 2, 3].map((k) => {
      const lf = p['vco' + k + '.range'] > 0.5;
      return { base: p['vco' + k + '.freq'] * Math.pow(2, p['vco' + k + '.fine'] / 12) / (lf ? 333.33 : 1), lf, pw: p['vco' + k + '.pw'] };
    });
    const sync2 = p['vco2.sync'] > 0.5, sync3 = p['vco3.sync'] > 0.5;
    const f1sh = p['vco1.fm.sh'], f1ad = p['vco1.fm.adsr'], f1lfo = p['vco1.fm.lfo'];
    const f2sh = p['vco2.fm.sh'], f2ad = p['vco2.fm.adsr'], f2v1 = p['vco2.fm.vco1'], f2pwm = p['vco2.pwm'];
    const f3nz = p['vco3.fm.noise'], f3ad = p['vco3.fm.adsr'], f3v2 = p['vco3.fm.vco2'], f3pwm = p['vco3.pwm'];
    const maxHz = 0.45 * sr;
    const vcfBase = p['vcf.freq'] * Math.pow(2, p['vcf.fine']);
    const vcfK = p['vcf.res'] * 4.8;
    const is4012 = p['vcf.mode'] < 0.5;
    const vcfDrive = is4012 ? 1.2 : 0.8;
    const vcfComp = is4012 ? 2 : 1 + vcfK * 0.3;
    const fRing = p['vcf.in.ring'], fV1 = p['vcf.in.vco1'], fV2 = p['vcf.in.vco2'], fV3 = p['vcf.in.vco3'], fNz = p['vcf.in.noise'];
    const fK = p['vcf.cv.kybd'], fAd = p['vcf.cv.adsr'], fV2c = p['vcf.cv.vco2'];
    const semBase = p['sem.freq'], semRes = p['sem.res'];
    const semK = 2 * (1 - semRes * 0.98) - 0.06 * Math.pow(semRes, 8);
    const semMode = p['sem.mode'], semBp = p['sem.bp'] > 0.5;
    const sV1 = p['sem.in.vco1'], sV2 = p['sem.in.vco2'], sV3 = p['sem.in.vco3'], sNz = p['sem.in.noise'];
    const sK = p['sem.cv.kybd'], sAd = p['sem.cv.adsr'], sLfo = p['sem.cv.lfo'];
    const adF = M26_FACTORS[Math.round(p['adsr.factor'])] || 1;
    const adA = 10 / (Math.max(0.0005, p['adsr.attack'] * adF) * sr);
    const adD = 1 - Math.exp(-4.6 / (Math.max(0.001, p['adsr.decay'] * adF) * sr));
    const adS = p['adsr.sustain'] * 10;
    const adR = 1 - Math.exp(-4.6 / (Math.max(0.001, p['adsr.release'] * adF) * sr));
    const arF = M26_FACTORS[Math.round(p['ar.factor'])] || 1;
    const arA = 10 / (Math.max(0.0005, p['ar.attack'] * arF) * sr);
    const arR = 1 - Math.exp(-4.6 / (Math.max(0.001, p['ar.release'] * arF) * sr));
    const arSh = p['ar.source'] > 0.5;
    const vGain = p['vca.gain'], vVcf = p['vca.in.vcf'], vSem = p['vca.in.sem'], vRing = p['vca.in.ring'], vAr = p['vca.cv.ar'], vAd = p['vca.cv.adsr'];
    const vp2 = p['vp.2'], vp4 = p['vp.4'], vp6 = p['vp.6'];
    const lagC = 1 - Math.exp(-1 / (0.001 * Math.pow(2000, p['vp.lag']) * sr));
    const shLvl = p['sh.level'], shInc = p['sh.rate'] / sr;
    const mVcf = p['mix.vcf'], mVca = p['mix.vca'], revL = p['reverb.left'], revR = p['reverb.right'];
    const panA = (Math.min(1, Math.max(-1, p['mix.pan'])) + 1) * Math.PI / 4;
    const gL = Math.cos(panA) * Math.SQRT2, gR = Math.sin(panA) * Math.SQRT2;
    const outGain = 0.25 * p['out.volume'];
    const trigLen = Math.round(0.002 * sr);
    const v1 = this.v1, v2 = this.v2, v3 = this.v3, pk = this.pk;

    for (let i = 0; i < n; i++) {
      // ---- keyboard controller and LFO
      this.lfoPh += lfoInc;
      let lfoRise = false;
      if (this.lfoPh >= 1) { this.lfoPh -= 1; lfoRise = true; }
      const lph = this.lfoPh;
      const lfoTri = 5 * (lph < 0.5 ? 4 * lph - 1 : 3 - 4 * lph);
      this.lfoSq = lph < 0.5;
      sig[O['lfo.tri']] = lfoTri;
      sig[O['lfo.square']] = this.lfoSq ? 5 : -5;
      let gate = this.keyGate;
      if (repeat === 2) gate = gate || this.lfoSq;
      if (gate) this.vibT += 1 / sr;
      const fade = vibDelay <= 0 ? 1 : Math.min(1, this.vibT / vibDelay);
      sig[O['lfo.delayed']] = lfoTri * fade;
      if (this.trigReq) { this.trigLeft = trigLen; this.trigReq = false; }
      if (lfoRise && repeat !== 1 && gate) this.trigLeft = trigLen;
      const vib = (lfoTri * fade + sig[sExtVib]) / 5 * vibDepth + bendV;
      this.cvLo += ((this.n1 - 60) / 12 - this.cvLo) * portaC;
      this.cvHi += ((this.n2 - 60) / 12 - this.cvHi) * portaC;
      sig[O['kb.cv']] = this.cvLo + vib;
      sig[O['kb.upper']] = this.cvHi + vib;
      sig[O['kb.gate']] = gate ? 10 : 0;
      sig[O['kb.trig']] = this.trigLeft > 0 ? 10 : 0;
      if (this.trigLeft > 0) this.trigLeft--;

      // ---- noise: white > pink > low-frequency random
      const w = rnd() * 2 - 1;
      pk[0] = 0.99886 * pk[0] + w * 0.0555179; pk[1] = 0.99332 * pk[1] + w * 0.0750759;
      pk[2] = 0.969 * pk[2] + w * 0.153852; pk[3] = 0.8665 * pk[3] + w * 0.3104856;
      pk[4] = 0.55 * pk[4] + w * 0.5329522; pk[5] = -0.7616 * pk[5] - w * 0.016898;
      const pink = (pk[0] + pk[1] + pk[2] + pk[3] + pk[4] + pk[5] + pk[6] + w * 0.5362) * 0.11;
      pk[6] = w * 0.115926;
      this.lfNoise += (w - this.lfNoise) * lfA;
      const low = m26Tanh(this.lfNoise * 40);
      const nz = color < 0.5 ? w * (1 - 2 * color) + pink * 2 * color : pink * (2 - 2 * color) + low * (2 * color - 1);
      sig[O['noise.out']] = nz * noiseLvl;

      // ---- sample-and-hold, its clock and the electronic switch
      let clkRise = false;
      if (extClk) {
        const hi = sig[sExtClk] > 2;
        clkRise = hi && !this.extClk;
        this.extClk = hi;
        this.shHigh = hi;
      } else {
        this.shPh += shInc;
        if (this.shPh >= 1) { this.shPh -= 1; clkRise = true; }
        this.shHigh = this.shPh < 0.5;
      }
      if (clkRise) { this.held = sig[sShIn] * shLvl; this.esw ^= 1; }
      sig[O['sh.out']] = this.held;
      sig[O['sh.clk']] = this.shHigh ? 10 : 0;

      // ---- envelopes
      const trigHi = sig[sAdTrig] > 2;
      const ad = this.adsr.tick(sig[sAdGate] > 2, trigHi && !this.trigPrev, adA, adD, adS, adR);
      this.trigPrev = trigHi;
      sig[O['adsr.out']] = ad;
      const arGate = (arPatched ? sig[sArGate] > 2 : (arSh ? this.shHigh : sig[O['kb.gate']] > 2)) || this.manualOn;
      const arv = this.ar.tick(arGate, false, arA, 0, 10, arR);
      sig[O['ar.out']] = arv;

      // ---- oscillators
      let fm = sig[s1sh] * f1sh + sig[s1ad] * f1ad + sig[s1lfo] * f1lfo;
      if (!vco[0].lf || k1Patched) fm += sig[s1k];
      let hz = Math.min(maxHz, vco[0].base * Math.pow(2, fm));
      v1.run(Math.max(1e-7, hz / sr), vco[0].pw, -1);
      sig[O['vco1.saw']] = v1.saw; sig[O['vco1.pulse']] = v1.pulse;
      const reset = v1.wrapped ? v1.frac : -1;

      fm = sig[s2sh] * f2sh + sig[s2ad] * f2ad + sig[s2v1] * f2v1;
      if (!vco[1].lf || k2Patched) fm += sig[s2k];
      hz = Math.min(maxHz, vco[1].base * Math.pow(2, fm));
      let pw = Math.min(0.95, Math.max(0.05, vco[1].pw + sig[s2pwm] * f2pwm / 10));
      v2.run(Math.max(1e-7, hz / sr), pw, sync2 ? reset : -1);
      sig[O['vco2.tri']] = v2.tri; sig[O['vco2.saw']] = v2.saw; sig[O['vco2.sine']] = v2.sine; sig[O['vco2.pulse']] = v2.pulse;

      fm = sig[s3nz] * f3nz + sig[s3ad] * f3ad + sig[s3v2] * f3v2;
      if (!vco[2].lf || k3Patched) fm += sig[s3k];
      hz = Math.min(maxHz, vco[2].base * Math.pow(2, fm));
      pw = Math.min(0.95, Math.max(0.05, vco[2].pw + sig[s3pwm] * f3pwm / 10));
      v3.run(Math.max(1e-7, hz / sr), pw, sync3 ? reset : -1);
      sig[O['vco3.tri']] = v3.tri; sig[O['vco3.saw']] = v3.saw; sig[O['vco3.sine']] = v3.sine; sig[O['vco3.pulse']] = v3.pulse;

      // ---- ring modulator (audio: AC-coupled inputs; dc: direct)
      let ra = sig[sRingA] * ringA, rb = sig[sRingB] * ringB;
      if (!ringDc) {
        this.ringHa[0] += (ra - this.ringHa[0]) * ringHpA; ra -= this.ringHa[0];
        this.ringHb[0] += (rb - this.ringHb[0]) * ringHpA; rb -= this.ringHb[0];
      }
      sig[O['ring.out']] = ra * rb / 5;

      // ---- preamp and envelope follower
      sig[O['pre.out']] = 10 * m26Tanh(sig[sPre] * preGain / 10);
      const ef = Math.abs(sig[sEnvf] * envfGain) * 2;
      this.envf += (ef - this.envf) * (ef > this.envf ? 0.004 : 0.0003);
      sig[O['envf.out']] = Math.min(10, this.envf);

      // ---- VCF (in units of 5 V)
      this.seed = (this.seed * 1664525 + 1013904223) >>> 0;
      const tiny = (this.seed / 4294967296 - 0.5) * 2e-6;
      const fx = (sig[sfRing] * fRing + sig[sfV1] * fV1 + sig[sfV2] * fV2 + sig[sfV3] * fV3 + sig[sfNz] * fNz) / 5 + tiny;
      const fcv = sig[sfK] * fK + sig[sfAd] * fAd + sig[sfV2c] * fV2c;
      const fc = Math.min(maxHz, Math.max(5, vcfBase * Math.pow(2, fcv)));
      const fy = this.vcf.run(fx, Math.tan(Math.PI * fc / sr), vcfK, vcfDrive);
      sig[O['vcf.out']] = 10 * m26Tanh(fy * vcfComp * 0.5);

      // ---- SEM
      if (route === 0) sig[O['sem.out']] = 0;
      else {
        let sx = (sig[ssV1] * sV1 + sig[ssV2] * sV2 + sig[ssV3] * sV3 + sig[ssNz] * sNz) / 5 + tiny;
        if (route === 1) sx += sig[O['vcf.out']] / 5;
        const scv = sig[ssK] * sK + sig[ssAd] * sAd + sig[ssLfo] * sLfo;
        const sfc = Math.min(maxHz, Math.max(5, semBase * Math.pow(2, scv)));
        const sem = this.sem;
        sem.run(sx, Math.tan(Math.PI * sfc / sr), semK);
        let sy;
        if (semBp) sy = sem.bp;
        else if (semMode < 0.5) sy = sem.lp + sem.hp * 2 * semMode;
        else sy = sem.lp * (2 - 2 * semMode) + sem.hp;
        sig[O['sem.out']] = 10 * m26Tanh(sy * 0.5);
      }

      // ---- VCA (AR linear, ADSR exponential)
      const ax = sig[sVcaVcf] * vVcf + sig[sVcaSem] * vSem + sig[sVcaRing] * vRing;
      const adV = Math.min(1, Math.max(0, sig[sVcaAd] / 10));
      const g = Math.min(1, Math.max(0, vGain + vAr * sig[sVcaAr] / 10 + vAd * (Math.pow(100, adV) - 1) / 99));
      sig[O['vca.out']] = ax * g;

      // ---- mixer, reverb and output
      const mix = sig[sMixVcf] * mVcf + sig[sMixVca] * mVca;
      sig[O['mix.out']] = mix;
      this.rev.tick(mix / 5);
      const wl = this.rev.out[0], wr = this.rev.out[1];
      sig[O['reverb.out']] = (wl + wr) * 0.5;

      // ---- voltage processors and the electronic switch
      sig[O['vp.inv1']] = -(sig[sVp[0]] + sig[sVp[2]] + sig[sVp[1]] * vp2 + sig[sVp[3]] * vp4);
      sig[O['vp.inv2']] = -(sig[sVp[4]] + sig[sVp[5]] * vp6);
      this.lag += (sig[sVp[6]] - this.lag) * lagC;
      sig[O['vp.lag']] = this.lag;
      sig[O['esw.c']] = this.esw ? sig[sEswB] : sig[sEswA];

      if (this.probe >= 0) {
        outL[i] = outR[i] = sig[this.probe] / 5;
        continue;
      }
      const l = mix * gL + wl * revL + sig[sOutL];
      const r = mix * gR + wr * revR + sig[sOutR];
      outL[i] = m26Tanh(l * outGain);
      outR[i] = m26Tanh(r * outGain);
    }
    // keep the filter and reverb states clear of NaN (a bad cord could feed one in)
    if (!(this.vcf.s[0] === this.vcf.s[0]) || !(this.sem.s1 === this.sem.s1)) {
      this.vcf = new M26Ladder(); this.sem = new M26Svf();
    }
    const v = this.view;
    v.gate = this.keyGate; v.lfo = this.lfoSq; v.clk = this.shHigh; v.esw = this.esw;
    v.adsr = this.adsr.v; v.ar = this.ar.v;
  }
}

if (typeof registerProcessor === 'function') {
  class Moa2600 extends AudioWorkletProcessor {
    static get parameterDescriptors() {
      return M26_PARAM_DEFS.map((d) => ({ name: d[0], defaultValue: d[1], minValue: d[2], maxValue: d[3], automationRate: 'k-rate' }));
    }
    constructor(options) {
      super();
      this.core = new M26Core(sampleRate);
      // the cords patched before audio started
      const cords = options && options.processorOptions && options.processorOptions.cords;
      if (cords) this.core.setCords(cords);
      this.p = Object.assign({}, M26_DEFAULTS);
      this.sinceView = 0;
      this.port.onmessage = (e) => {
        const m = e.data;
        if (!m) return;
        if (m.type === 'play') this.core.play(m.n1, m.n2, m.gate, m.retrig);
        else if (m.type === 'manual') this.core.manual(m.on);
        else if (m.type === 'cords') this.core.setCords(m.cords);
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
        this.port.postMessage(Object.assign({}, this.core.view));
      }
      return true;
    }
  }
  registerProcessor('${M2600_NAME}', Moa2600);
}
`;
