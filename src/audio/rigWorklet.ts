import { RIG_DESTS, RIG_DIVISION_BEATS, RIG_PARAMS, RIG_SOURCES, RIG_TABLES } from '../domain/devices/rigParams';

export const RIG_NAME = 'moa-rig';

// name, default, min, max, and how morph blends it: 0 switches at the middle (choices, toggles), 1 linear, 2 in log
const DEFS = RIG_PARAMS.map((p) => [p.id, p.def, p.min, p.max, p.kind !== 'number' ? 0 : p.curve === 'log' ? 2 : 1]);

/**
 * The MOA-RIG's voices as the source text of an audio worklet module (tests evaluate the same text to get `RigCore`,
 * so what they check is what ships). Sixteen parts share one pool of voices, as the NINA's four layers share its
 * twelve: each part owns a fixed number of them (`setLayout`), and a part with none is silent.
 *
 * One voice, per sample:
 *
 *   OSC 3 (wavetable) -> OSC 1, OSC 2 (WAVE can FM them) -> mixer with noise -> drive -> ladder (24 dB)
 *     -> SEM (12 dB SVF; off, after the ladder, or beside it) -> amp (EG 2) -> infinite pan -> its part's stereo bus
 *
 * Every 8 samples a control tick reads the sixteen mod sources, sums the matrix, blends sides A and B by the morph
 * (which the matrix can move too) and works out the oscillator increments, filter coefficients and envelope rates.
 * Each part's voices are summed into the part's own stereo bus (`partL`, `partR`), so a mixer strip per part can come
 * later; `process` also writes the sum of all parts.
 *
 * Oscillators are band-limited: polyBLEP on the steps, polyBLAMP on the shape's corners, and a mip level per octave
 * for the wavetables. The ladder is the MOA-1's (saturation inside the resonance loop), here without oversampling.
 */
export const RIG_SOURCE = `
const RIG_PARAM_DEFS = ${JSON.stringify(DEFS)};
const RIG_NP = RIG_PARAM_DEFS.length;
const RIG_P = {};
RIG_PARAM_DEFS.forEach((d, i) => { RIG_P[d[0]] = i; });
const RIG_DEFAULTS = {};
for (const d of RIG_PARAM_DEFS) RIG_DEFAULTS[d[0]] = d[1];
const RIG_SRC = ${JSON.stringify(RIG_SOURCES)};
const RIG_DEST = ${JSON.stringify(RIG_DESTS)};
const RIG_NSRC = RIG_SRC.length, RIG_NDEST = RIG_DEST.length;
const RIG_S = {};
RIG_SRC.forEach((s, i) => { RIG_S[s] = i; });
const RIG_D = {};
RIG_DEST.forEach((d, i) => { RIG_D[d[0]] = i; });
const RIG_DEST_PARAM = Int32Array.from(RIG_DEST.map((d) => RIG_P[d[0]]));
// 0 pitch, 1 freq, 2 rate, 3 time, 4 lin (see RIG_DESTS)
const RIG_DEST_KIND = Int32Array.from(RIG_DEST.map((d) => ['pitch', 'freq', 'rate', 'time', 'lin'].indexOf(d[1])));
const RIG_DIV_BEATS = ${JSON.stringify(RIG_DIVISION_BEATS)};
const RIG_TABLE_NAMES = ${JSON.stringify(RIG_TABLES)};
const RIG_CTRL = 8;
const RIG_MAX_BLOCK = 512;

// param indices the voice reads every tick
const Q_O1_OCT = RIG_P['osc1.oct'], Q_O1_TUNE = RIG_P['osc1.tune'], Q_O1_W = RIG_P['osc1.width'], Q_O1_B = RIG_P['osc1.blend'], Q_O1_SUB = RIG_P['osc1.sub'];
const Q_O2_OCT = RIG_P['osc2.oct'], Q_O2_TUNE = RIG_P['osc2.tune'], Q_O2_W = RIG_P['osc2.width'], Q_O2_B = RIG_P['osc2.blend'], Q_O2_SYNC = RIG_P['osc2.sync'];
const Q_O3_MODE = RIG_P['osc3.mode'], Q_O3_MODEL = RIG_P['osc3.model'], Q_O3_HARM = RIG_P['osc3.harm'];
const Q_O3_TIMBRE = RIG_P['osc3.timbre'], Q_O3_MORPH = RIG_P['osc3.morph'], Q_O3_AUX = RIG_P['osc3.aux'];
// Plaits' engines (PL_ENGINES, from the Plaits worklet source), if the module has them
const RIG_HAS_MACRO = typeof PL_ENGINES !== 'undefined';
const Q_O3_OCT = RIG_P['osc3.oct'], Q_O3_TUNE = RIG_P['osc3.tune'], Q_O3_TAB = RIG_P['osc3.table'], Q_O3_POS = RIG_P['osc3.pos'], Q_O3_INT = RIG_P['osc3.interp'];
const Q_M1 = RIG_P['mix.osc1'], Q_M2 = RIG_P['mix.osc2'], Q_M3 = RIG_P['mix.osc3'], Q_MN = RIG_P['mix.noise'], Q_NTYPE = RIG_P['noise.type'];
const Q_DRIVE = RIG_P['drive'], Q_OD = RIG_P['overdrive'];
const Q_LCUT = RIG_P['lad.cutoff'], Q_LRES = RIG_P['lad.res'], Q_LEG = RIG_P['lad.eg1'];
const Q_SCUT = RIG_P['sem.cutoff'], Q_SRES = RIG_P['sem.res'], Q_SMODE = RIG_P['sem.mode'], Q_SBP = RIG_P['sem.bp'], Q_SEG = RIG_P['sem.eg1'];
const Q_ROUTE = RIG_P['filter.route'], Q_KEY = RIG_P['filter.key'];
const Q_E1 = [RIG_P['eg1.a'], RIG_P['eg1.d'], RIG_P['eg1.s'], RIG_P['eg1.r'], RIG_P['eg1.level'], RIG_P['eg1.reset']];
const Q_E2 = [RIG_P['eg2.a'], RIG_P['eg2.d'], RIG_P['eg2.s'], RIG_P['eg2.r'], RIG_P['eg2.level'], RIG_P['eg2.reset']];
const Q_DRONE = RIG_P['eg2.drone'];
const Q_L = [1, 2].map((k) => [RIG_P['lfo' + k + '.rate'], RIG_P['lfo' + k + '.level'], RIG_P['lfo' + k + '.shape'], RIG_P['lfo' + k + '.sync'], RIG_P['lfo' + k + '.div'], RIG_P['lfo' + k + '.retrig']]);
const Q_LEVEL = RIG_P['out.level'], Q_PAN = RIG_P['out.pan'], Q_SPIN = RIG_P['out.spin'], Q_MORPH = RIG_P['out.morph'];
const Q_MODE = RIG_P['voice.mode'], Q_UNI = RIG_P['voice.unison'], Q_DET = RIG_P['voice.detune'], Q_GLIDE = RIG_P['voice.glide'], Q_BEND = RIG_P['voice.bend'];
const Q_PANNER = RIG_P['panner.mode'], Q_PWIDTH = RIG_P['panner.width'], Q_TIME = RIG_P['mod.time'];

// mod destinations the voice reads
const D_O1_TUNE = RIG_D['osc1.tune'], D_O2_TUNE = RIG_D['osc2.tune'], D_O3_TUNE = RIG_D['osc3.tune'];
const D_LCUT = RIG_D['lad.cutoff'], D_SCUT = RIG_D['sem.cutoff'];
const D_L_RATE = [RIG_D['lfo1.rate'], RIG_D['lfo2.rate']];
const D_E1 = [RIG_D['eg1.a'], RIG_D['eg1.d'], RIG_D['eg1.s'], RIG_D['eg1.r'], RIG_D['eg1.level']];
const D_E2 = [RIG_D['eg2.a'], RIG_D['eg2.d'], RIG_D['eg2.s'], RIG_D['eg2.r'], RIG_D['eg2.level']];
const D_MORPH = RIG_D['out.morph'], D_PAN = RIG_D['out.pan'];
const S_EG1 = RIG_S.eg1, S_EG2 = RIG_S.eg2, S_LFO1 = RIG_S.lfo1, S_LFO2 = RIG_S.lfo2, S_WAVE = RIG_S.wave, S_KBD = RIG_S.kbd;
const S_VEL = RIG_S.vel, S_AFT = RIG_S.aft, S_MOD = RIG_S.mod, S_EXP = RIG_S.exp, S_PANNER = RIG_S.pan, S_TIME = RIG_S.time;
const S_CC = RIG_S.cc, S_SEQ = RIG_S.seq, S_RAND = RIG_S.rand, S_SET = RIG_S.set;

function rigTanh(x) {
  if (x > 3) return 1;
  if (x < -3) return -1;
  const x2 = x * x;
  return x * (27 + x2) / (27 + 9 * x2);
}

// PolyBLEP: the correction for an upward step of 2 at phase 0 (t = phase, dt = increment)
function rigBlep(t, dt) {
  if (t < dt) { t /= dt; return t + t - t * t - 1; }
  if (t > 1 - dt) { t = (t - 1) / dt; return t * t + t + t + 1; }
  return 0;
}

// PolyBLAMP: the correction for a corner at phase 0 where the slope rises by one unit per sample
function rigBlamp(t, dt) {
  if (t < dt) { t = t / dt - 1; return -t * t * t / 3; }
  if (t > 1 - dt) { t = (t - 1) / dt + 1; return t * t * t / 3; }
  return 0;
}

// ---- wavetables: 32 frames each, built from a spectrum, one band-limited copy per octave

function rigFft(re, im, inverse) {
  const n = re.length;
  for (let i = 1, j = 0; i < n; i++) {
    let bit = n >> 1;
    for (; j & bit; bit >>= 1) j ^= bit;
    j ^= bit;
    if (i < j) {
      let t = re[i]; re[i] = re[j]; re[j] = t;
      t = im[i]; im[i] = im[j]; im[j] = t;
    }
  }
  for (let len = 2; len <= n; len <<= 1) {
    const ang = (inverse ? 2 : -2) * Math.PI / len, wr = Math.cos(ang), wi = Math.sin(ang), half = len >> 1;
    for (let i = 0; i < n; i += len) {
      let cr = 1, ci = 0;
      for (let k = 0; k < half; k++) {
        const a = i + k, b = a + half;
        const br = re[b] * cr - im[b] * ci, bi = re[b] * ci + im[b] * cr;
        re[b] = re[a] - br; im[b] = im[a] - bi;
        re[a] += br; im[a] += bi;
        const t = cr * wr - ci * wi;
        ci = cr * wi + ci * wr;
        cr = t;
      }
    }
  }
}

const RIG_FRAMES = 32, RIG_LEVELS = 10;

// Formants (Hz) of five vowels, and their bandwidths and levels.
const RIG_MALE = { A: [730, 1090, 2440], E: [530, 1840, 2480], I: [270, 2290, 3010], O: [570, 840, 2410], U: [300, 870, 2240] };
const RIG_FEMALE = { A: [850, 1220, 2810], E: [610, 1900, 2530], I: [310, 2790, 3310], O: [590, 920, 2710], U: [370, 950, 2670] };

// Harmonic amplitudes of a voice at f0 singing through the vowels in order, t scanning from the first to the last.
function rigVowels(t, set, order, f0, tilt, bw) {
  const pos = t * (order.length - 1), i = Math.min(order.length - 2, Math.floor(pos)), fr = pos - i;
  const va = set[order[i]], vb = set[order[i + 1]];
  const f = [0, 1, 2].map((k) => Math.exp(Math.log(va[k]) + (Math.log(vb[k]) - Math.log(va[k])) * fr));
  const gains = [1, 0.55, 0.3];
  const amps = new Float64Array(1025);
  for (let h = 1; h <= 1024; h++) {
    const hz = h * f0;
    let a = 0.04;
    for (let k = 0; k < 3; k++) { const d = (hz - f[k]) / (bw[k] / 2); a += gains[k] / (1 + d * d); }
    amps[h] = a / Math.pow(h, tilt) * (hz > 6000 ? Math.exp(-(hz - 6000) / 1500) : 1);
  }
  return { amps };
}

// One generator per table in RIG_TABLE_NAMES; t runs 0..1 across the frames. Each returns a single cycle
// (wave, 2048 samples) or sine amplitudes by harmonic (amps, index 1..1024).
const RIG_GENS = [
  // PPG RESO: a saw whose harmonics swell around a peak that climbs from the 2nd to about the 48th
  (t) => {
    const amps = new Float64Array(1025), c = 2 + 46 * Math.pow(t, 1.5), w = 1 + 0.15 * c;
    for (let h = 1; h <= 1024; h++) amps[h] = (0.35 + 6 * Math.exp(-((h - c) / w) * ((h - c) / w))) / h;
    return { amps };
  },
  // PPG SYNC: a saw hard-synced to the cycle, the slave from one to eight times as fast
  (t) => {
    const wave = new Float64Array(2048), r = 1 + 7 * t;
    for (let i = 0; i < 2048; i++) { const p = (i / 2048) * r; wave[i] = 2 * (p - Math.floor(p)) - 1; }
    return { wave };
  },
  // PPG DIGI: a phase-bent sine on fewer and fewer steps
  (t) => {
    const wave = new Float64Array(2048), q = Math.round(2 + 14 * (1 - t));
    for (let i = 0; i < 2048; i++) {
      const x = 2 * Math.PI * i / 2048;
      wave[i] = Math.round(Math.sin(x + t * 2.5 * Math.sin(x)) * q) / q;
    }
    return { wave };
  },
  // PPG PULSE: from a square to a 2 % sliver
  (t) => {
    const wave = new Float64Array(2048), pw = 0.5 - 0.48 * t;
    for (let i = 0; i < 2048; i++) wave[i] = i / 2048 < pw ? 1 : -1;
    return { wave };
  },
  // VOX AEIOU: a man's voice through the five vowels
  (t) => rigVowels(t, RIG_MALE, 'AEIOU', 110, 1, [90, 110, 160]),
  // VOX CHOIR: a softer, higher voice, oo to ee
  (t) => rigVowels(t, RIG_FEMALE, 'UOAEI', 220, 1.3, [130, 160, 220]),
];

// Level j keeps harmonics up to 1024 >> j, in a table of size max(128, min(2048, 4 * that)) (a power of two).
function rigBuildTable(gen) {
  const levels = [];
  for (let j = 0; j < RIG_LEVELS; j++) {
    const h = 1024 >> j, size = Math.max(128, Math.min(2048, 4 * h));
    levels.push({ h, size, data: new Float32Array(size * RIG_FRAMES) });
  }
  const re = new Float64Array(2048), im = new Float64Array(2048);
  const yr = new Float64Array(1025), yi = new Float64Array(1025);
  const work = {};
  for (let f = 0; f < RIG_FRAMES; f++) {
    const g = gen(f / (RIG_FRAMES - 1));
    if (g.wave) {
      re.set(g.wave); im.fill(0);
      rigFft(re, im, false);
      for (let k = 1; k <= 1024; k++) { yr[k] = re[k] / 2048; yi[k] = im[k] / 2048; }
    } else {
      for (let k = 1; k <= 1024; k++) { yr[k] = 0; yi[k] = -g.amps[k] / 2; }
    }
    let peak = 0;
    for (const lv of levels) {
      const s = lv.size;
      const w = work[s] || (work[s] = [new Float64Array(s), new Float64Array(s)]);
      const wr = w[0], wi = w[1];
      wr.fill(0); wi.fill(0);
      for (let k = 1; k <= Math.min(lv.h, s / 2 - 1); k++) { wr[k] = yr[k]; wi[k] = yi[k]; wr[s - k] = yr[k]; wi[s - k] = -yi[k]; }
      rigFft(wr, wi, true);
      if (lv === levels[0]) for (let i = 0; i < s; i++) peak = Math.max(peak, Math.abs(wr[i]));
      const scale = peak > 0 ? 1 / peak : 1;
      for (let i = 0; i < s; i++) lv.data[f * s + i] = wr[i] * scale;
    }
  }
  return levels;
}

let RIG_TABLE_CACHE = null;
function rigTables() {
  if (!RIG_TABLE_CACHE) RIG_TABLE_CACHE = RIG_GENS.map(rigBuildTable);
  return RIG_TABLE_CACHE;
}

// ---- one voice

class RigVoice {
  constructor(seed) {
    this.part = -1;
    this.active = false;
    this.gate = false;
    this.note = 60; this.target = 60; this.pitch = 60;
    this.vel = 0; this.age = 0; this.uni = 0; this.uniN = 1;
    this.panPos = 0; this.rand = 0; this.time = 0;
    this.p1 = 0; this.p2 = 0; this.p3 = 0; this.sub = 1;
    this.e1 = 0; this.st1 = 0; this.e2 = 0; this.st2 = 0;
    this.lph = [0, 0]; this.lval = [0, 0]; this.lhold = [0, 0];
    this.ld0 = 0; this.ld1 = 0; this.ld2 = 0; this.ld3 = 0;
    this.v1 = 0; this.v2 = 0;
    this.b0 = 0; this.b1 = 0; this.b2 = 0;
    this.seed = seed >>> 0 || 1;
    this.w3 = 0;
    // OSC 3 in MACRO mode: a Plaits engine of this voice's own (made when a model is first chosen)
    this.macro = null; this.macroModel = -1; this.macroTrig = false;
    this.mOut = new Float32Array(RIG_CTRL); this.mAux = new Float32Array(RIG_CTRL);
    this.mp = { trigger: 0, note: 60, timbre: 0.5, morph: 0.5, harmonics: 0.5, accent: 0.8 };
    this.mLimOut = null; this.mLimAux = null;
    this.q = new Float64Array(RIG_NP);
    this.md = new Float64Array(RIG_NDEST);
    this.src = new Float64Array(RIG_NSRC);
  }
  noise() {
    let x = this.seed;
    x ^= x << 13; x >>>= 0; x ^= x >>> 17; x ^= x << 5; x >>>= 0;
    this.seed = x;
    return x / 2147483648 - 1;
  }
}

function rigClamp(x, lo, hi) { return x < lo ? lo : x > hi ? hi : x; }

class RigCore {
  constructor(sampleRate, voices = 24, parts = 16, random = Math.random) {
    this.sr = sampleRate;
    this.random = random;
    if (typeof plSetSampleRate === 'function') plSetSampleRate(sampleRate);
    this.bpm = 120;
    this.clock = 0;
    // timed messages ({ frame, m }) in time order, and the absolute frame the next block starts on
    this.queue = [];
    this.frame = 0;
    // the frame a message handled now takes effect on (inside a block, where the block was split for it)
    this.at = 0;
    // kit parts: a MOA-60 sampler each (SamplerCore, from the sampler's worklet source), all sharing one store of sounds
    this.samples = new Map();
    this.kits = [];
    this.kitL = new Float32Array(RIG_MAX_BLOCK);
    this.kitR = new Float32Array(RIG_MAX_BLOCK);
    // the mixer and effects (RigMixer, from the mixer's worklet source); without it the parts are simply summed
    this.mix = typeof RigMixer === 'function' ? new RigMixer(sampleRate, parts) : null;
    this.tables = rigTables();
    this.voices = [];
    for (let i = 0; i < voices; i++) {
      const v = new RigVoice(Math.floor(random() * 4294967295) + i);
      for (let k = 0; k < 2; k++) v.lph[k] = random();
      this.voices.push(v);
    }
    this.parts = [];
    this.partL = [];
    this.partR = [];
    for (let p = 0; p < parts; p++) {
      const a = new Float64Array(RIG_NP), b = new Float64Array(RIG_NP);
      for (let i = 0; i < RIG_NP; i++) { a[i] = RIG_PARAM_DEFS[i][1]; b[i] = a[i]; }
      this.parts.push({
        a, b, baseA: Float64Array.from(a), baseB: Float64Array.from(b), locks: new Map(),
        routes: [], fm1: [0, 0], fm2: [0, 0],
        ctrl: { bend: 0, mod: 0, aft: 0, exp: 0, cc: 0, seq: 0 },
        voices: [], stack: [], lastNote: 60, panIdx: 0, lfoPh: [0, 0],
      });
      this.partL.push(new Float32Array(RIG_MAX_BLOCK));
      this.partR.push(new Float32Array(RIG_MAX_BLOCK));
    }
    const all = new Array(parts).fill(0);
    all[0] = voices;
    this.setLayout(all);
  }

  // Voices per part, handed out from the pool in part order; whatever does not fit is left off.
  setLayout(counts) {
    let next = 0;
    for (const v of this.voices) { v.part = -1; v.active = false; v.gate = false; v.st1 = 0; v.st2 = 0; v.e1 = 0; v.e2 = 0; }
    this.parts.forEach((pt, p) => {
      pt.voices = [];
      pt.stack = [];
      const want = Math.max(0, Math.floor(counts[p] || 0));
      for (let k = 0; k < want && next < this.voices.length; k++) {
        const v = this.voices[next++];
        v.part = p;
        pt.voices.push(v);
      }
    });
  }

  // a, b: { params: { id: value }, matrix: [{ source, dest, amount }] }; with no b, side B is a copy of A.
  setPatch(part, a, b) {
    const pt = this.parts[part];
    const sb = b || a;
    for (let i = 0; i < RIG_NP; i++) {
      const id = RIG_PARAM_DEFS[i][0], def = RIG_PARAM_DEFS[i][1];
      const va = a.params[id], vb = sb.params[id];
      pt.baseA[i] = va === undefined ? def : va;
      pt.baseB[i] = vb === undefined ? def : vb;
    }
    this.applyLocks(pt);
    const map = new Map();
    const add = (list, side) => {
      for (const r of list || []) {
        const s = RIG_S[r.source], d = RIG_D[r.dest];
        if (s === undefined || d === undefined) continue;
        const key = s * RIG_NDEST + d;
        let e = map.get(key);
        if (!e) { e = { s, d, a: 0, b: 0, sens: 0 }; map.set(key, e); }
        e[side] += r.amount;
      }
    };
    add(a.matrix, 'a');
    add(sb.matrix, 'b');
    pt.routes = [];
    pt.fm1 = [0, 0];
    pt.fm2 = [0, 0];
    for (const e of map.values()) {
      // WAVE into OSC 1 or 2's tune is audio-rate FM, done per sample rather than at the tick
      if (e.s === S_WAVE && e.d === D_O1_TUNE) { pt.fm1 = [e.a, e.b]; continue; }
      if (e.s === S_WAVE && e.d === D_O2_TUNE) { pt.fm2 = [e.a, e.b]; continue; }
      if (e.s === S_VEL && (e.d === D_E1[4] || e.d === D_E2[4])) e.sens = 1;
      pt.routes.push(e);
    }
  }

  // A part becomes a kit ('kit'), its notes 36 to 51 playing pads 1 to 16, or goes back to being a synth ('synth').
  setKind(part, kind) {
    if (!this.parts[part]) return;
    this.allNotesOff(part);
    if (kind === 'kit') {
      if (this.kits[part]) return;
      const k = new SamplerCore(this.sr);
      k.samples = this.samples;
      this.kits[part] = k;
    } else this.kits[part] = null;
  }

  addSample(id, rate, channels) {
    this.samples.set(id, { rate, channels, length: channels[0] ? channels[0].length : 0 });
  }

  dropSample(id) {
    this.samples.delete(id);
    for (const k of this.kits) if (k) k.voices = k.voices.filter((v) => v.sample !== id);
  }

  setPad(part, pad, settings) {
    const k = this.kits[part];
    if (k) k.setPad(pad, settings);
  }

  // A sequencer step's parameter locks ({ id: value }): they hold the params on both sides until the next call.
  setLocks(part, locks) {
    const pt = this.parts[part];
    if (!pt) return;
    pt.locks = new Map();
    for (const id in locks || {}) if (RIG_P[id] !== undefined) pt.locks.set(RIG_P[id], locks[id]);
    this.applyLocks(pt);
  }

  applyLocks(pt) {
    pt.a.set(pt.baseA);
    pt.b.set(pt.baseB);
    for (const [i, v] of pt.locks) { pt.a[i] = v; pt.b[i] = v; }
  }

  // A message from the device; with a frame (an absolute sample time) it waits for that sample.
  post(m, frame) {
    if (frame === undefined || frame <= this.frame) { this.at = this.frame; this.handle(m); return; }
    let i = this.queue.length;
    while (i > 0 && this.queue[i - 1].frame > frame) i--;
    this.queue.splice(i, 0, { frame, m });
  }

  handle(m) {
    if (m.type === 'patch') this.setPatch(m.part, m.a, m.b);
    else if (m.type === 'layout') this.setLayout(m.counts);
    else if (m.type === 'on') this.noteOn(m.part, m.note, m.vel);
    else if (m.type === 'off') this.noteOff(m.part, m.note);
    else if (m.type === 'lock') this.setLocks(m.part, m.locks);
    else if (m.type === 'kind') this.setKind(m.part, m.kind);
    else if (m.type === 'sample') this.addSample(m.id, m.rate, m.channels);
    else if (m.type === 'drop') this.dropSample(m.id);
    else if (m.type === 'pad') this.setPad(m.part, m.pad, m.settings);
    else if (m.type === 'ctrl') this.setControl(m.part, m.name, m.value);
    else if (m.type === 'bpm') this.bpm = m.bpm;
    else if (m.type === 'mix') { if (this.mix) this.mix.set(m.id, m.value); }
    else if (m.type === 'flush') this.queue = [];
    else if (m.type === 'panic') { this.queue = []; for (let p = 0; p < this.parts.length; p++) this.allNotesOff(p); }
  }

  setControl(part, name, value) {
    const c = this.parts[part].ctrl;
    if (name in c) c[name] = value;
  }

  // The voice to take for a new note in poly: a free one, else the oldest releasing, else the oldest.
  pick(pt, taken) {
    let best = null, bestScore = Infinity;
    for (const v of pt.voices) {
      if (taken.indexOf(v) >= 0) continue;
      const score = !v.active ? -1e15 + v.age : !v.gate ? -1e14 + v.age : v.age;
      if (score < bestScore) { bestScore = score; best = v; }
    }
    return best;
  }

  start(v, pt, note, vel, retrig) {
    const a = pt.a;
    v.vel = vel;
    v.target = note;
    if (retrig) {
      v.age = this.clock++;
      v.time = 0;
      v.macroTrig = true;
      v.rand = this.random() * 2 - 1;
      if (a[Q_E1[5]] >= 0.5) v.e1 = 0;
      if (a[Q_E2[5]] >= 0.5) v.e2 = 0;
      v.st1 = 1; v.st2 = 1;
      for (let k = 0; k < 2; k++) if (a[Q_L[k][5]] === 0) { v.lph[k] = 0; v.lhold[k] = this.random() * 2 - 1; }
    }
    v.gate = true;
    v.active = true;
  }

  noteOn(part, note, vel = 1) {
    const kit = this.kits[part];
    if (kit) { if (note >= 36 && note < 52) kit.hit(note - 36, vel, this.at); return; }
    const pt = this.parts[part];
    if (!pt || pt.voices.length === 0) return;
    const a = pt.a;
    const mode = a[Q_MODE], uniN = Math.min(pt.voices.length, Math.round(a[Q_UNI]) + 1);
    let pos = 0;
    const pm = a[Q_PANNER], w = a[Q_PWIDTH];
    if (pm === 1) pos = w * [-1, 0.5, -0.5, 1, 0][pt.panIdx++ % 5];
    else if (pm === 2) pos = w * (pt.panIdx++ % 2 ? 1 : -1);
    if (mode === 0) {
      const taken = [];
      for (let u = 0; u < uniN; u++) {
        const v = this.pick(pt, taken);
        if (!v) break;
        taken.push(v);
        v.note = note;
        v.uni = u; v.uniN = uniN;
        v.panPos = pos;
        if (a[Q_GLIDE] <= 0 || !v.active) v.pitch = a[Q_GLIDE] > 0 ? pt.lastNote : note;
        this.start(v, pt, note, vel, true);
      }
    } else {
      const held = pt.stack.length > 0;
      pt.stack = pt.stack.filter((x) => x !== note);
      pt.stack.push(note);
      const retrig = !(mode === 2 && held);
      for (let u = 0; u < uniN; u++) {
        const v = pt.voices[u];
        v.note = note;
        v.uni = u; v.uniN = uniN;
        if (retrig) v.panPos = pos;
        if (a[Q_GLIDE] <= 0) v.pitch = note;
        this.start(v, pt, note, vel, retrig);
      }
    }
    pt.lastNote = note;
  }

  noteOff(part, note) {
    const kit = this.kits[part];
    if (kit) { if (note >= 36 && note < 52) kit.release(note - 36, this.at); return; }
    const pt = this.parts[part];
    if (!pt) return;
    if (pt.a[Q_MODE] === 0) {
      for (const v of pt.voices) if (v.gate && v.note === note) { v.gate = false; v.st1 = 3; v.st2 = 3; }
      return;
    }
    const top = pt.stack[pt.stack.length - 1];
    pt.stack = pt.stack.filter((x) => x !== note);
    if (pt.stack.length > 0) {
      if (top === note) {
        const back = pt.stack[pt.stack.length - 1];
        for (const v of pt.voices) if (v.gate) { v.note = back; v.target = back; if (pt.a[Q_GLIDE] <= 0) v.pitch = back; }
      }
      return;
    }
    for (const v of pt.voices) if (v.gate) { v.gate = false; v.st1 = 3; v.st2 = 3; }
  }

  allNotesOff(part) {
    if (this.kits[part]) this.kits[part].stopAll();
    const pt = this.parts[part];
    pt.stack = [];
    for (const v of pt.voices) if (v.gate) { v.gate = false; v.st1 = 3; v.st2 = 3; }
  }

  // Number of voices sounding in a part.
  sounding(part) {
    return this.parts[part].voices.filter((v) => v.active).length;
  }

  // Renders n samples, handling the queued messages on their samples (the block is split at each).
  process(outL, outR, n) {
    let at = 0;
    while (at < n) {
      this.at = this.frame + at;
      while (this.queue.length && this.queue[0].frame <= this.frame + at) this.handle(this.queue.shift().m);
      const next = this.queue.length ? this.queue[0].frame - this.frame : n;
      const end = Math.min(n, Math.max(at + 1, next));
      if (at === 0 && end === n) this.render(outL, outR, 0, n);
      else this.render(outL, outR, at, end - at);
      at = end;
    }
    // the kits play their hits on their own frames, so they render the whole block at once
    for (let p = 0; p < this.kits.length; p++) {
      const k = this.kits[p];
      if (!k || (!k.voices.length && !k.queue.length)) continue;
      const L = this.kitL.subarray(0, n), R = this.kitR.subarray(0, n), pL = this.partL[p], pR = this.partR[p];
      k.frame = this.frame;
      k.process(L, R, n, 1);
      for (let i = 0; i < n; i++) { pL[i] += L[i]; pR[i] += R[i]; outL[i] += L[i]; outR[i] += R[i]; }
    }
    if (this.mix) this.mix.process(this.partL, this.partR, outL, outR, n, this.bpm);
    this.frame += n;
  }

  // Renders len samples into out (and each part's buffer) from sample off.
  render(outL, outR, off, len) {
    const whole = off === 0;
    const n = len;
    for (let p = 0; p < this.parts.length; p++) { this.partL[p].fill(0, off, off + n); this.partR[p].fill(0, off, off + n); }
    for (const pt of this.parts) {
      for (let k = 0; k < 2; k++) {
        const a = pt.a, L = Q_L[k];
        const rate = a[L[3]] >= 0.5 ? this.bpm / 60 / RIG_DIV_BEATS[a[L[4]]] : a[L[0]];
        pt.lfoPh[k] = (pt.lfoPh[k] + rate * n / this.sr) % 1;
      }
    }
    for (const v of this.voices) {
      if (!v.active || v.part < 0) continue;
      const L = this.partL[v.part], R = this.partR[v.part];
      this.runVoice(v, this.parts[v.part], whole ? L : L.subarray(off), whole ? R : R.subarray(off), n);
    }
    for (let i = off; i < off + n; i++) {
      let l = 0, r = 0;
      for (let p = 0; p < this.parts.length; p++) { l += this.partL[p][i]; r += this.partR[p][i]; }
      outL[i] = l;
      outR[i] = r;
    }
  }

  runVoice(v, pt, busL, busR, n) {
    const sr = this.sr, A = pt.a, B = pt.b, q = v.q, md = v.md, src = v.src, ctl = pt.ctrl;
    const drone = A[Q_DRONE] >= 0.5;
    for (let at = 0; at < n; at += RIG_CTRL) {
      const len = Math.min(RIG_CTRL, n - at);
      const tick = len / sr;

      // ---- sources (envelopes and LFOs as the last tick left them)
      src[S_EG1] = v.e1 * q[Q_E1[4]];
      src[S_EG2] = v.e2 * q[Q_E2[4]];
      src[S_WAVE] = v.w3;
      src[S_KBD] = (v.note - 60) / 64;
      src[S_VEL] = v.vel;
      src[S_AFT] = ctl.aft; src[S_MOD] = ctl.mod; src[S_EXP] = ctl.exp; src[S_CC] = ctl.cc; src[S_SEQ] = ctl.seq;
      src[S_PANNER] = v.panPos;
      src[S_RAND] = v.rand;
      src[S_SET] = 1;

      // ---- the matrix, at the morph the knob sets; then the morph the matrix moves
      const m0 = A[Q_MORPH];
      md.fill(0);
      let sensE1 = 1, sensE2 = 1;
      for (const r of pt.routes) {
        const amt = r.a + (r.b - r.a) * m0;
        if (amt === 0) continue;
        if (r.sens) {
          const s = Math.abs(amt), f = (1 - s) + s * (amt > 0 ? v.vel : 1 - v.vel);
          if (r.d === D_E1[4]) sensE1 *= f; else sensE2 *= f;
          continue;
        }
        md[r.d] += amt * src[r.s];
      }
      const m = rigClamp(m0 + md[D_MORPH], 0, 1);
      for (let i = 0; i < RIG_NP; i++) {
        const blend = RIG_PARAM_DEFS[i][4], x = A[i], y = B[i];
        q[i] = m === 0 || x === y ? x : blend === 0 ? (m < 0.5 ? x : y) : blend === 2 && x > 0 && y > 0 ? x * Math.pow(y / x, m) : x + (y - x) * m;
      }
      for (let d = 0; d < RIG_NDEST; d++) {
        const kind = RIG_DEST_KIND[d];
        if (md[d] === 0 || kind !== 4) continue;
        const pi = RIG_DEST_PARAM[d], lo = RIG_PARAM_DEFS[pi][2], hi = RIG_PARAM_DEFS[pi][3];
        q[pi] = rigClamp(q[pi] + md[d] * (hi - lo), d === D_PAN ? -2 : lo, d === D_PAN ? 2 : hi);
      }
      for (let d = 0; d < RIG_NDEST; d++) {
        if (md[d] === 0) continue;
        const kind = RIG_DEST_KIND[d], pi = RIG_DEST_PARAM[d];
        if (kind === 2) q[pi] *= Math.pow(2, 5 * md[d]);
        else if (kind === 3) q[pi] = rigClamp(q[pi] * Math.pow(2, 8 * md[d]), 0.0005, 30);
      }
      // mixer levels go bipolar under modulation (a negative level inverts the source)
      const lv1 = rigClamp(A[Q_M1] + (B[Q_M1] - A[Q_M1]) * m + md[RIG_D['mix.osc1']], -1, 1);
      const lv2 = rigClamp(A[Q_M2] + (B[Q_M2] - A[Q_M2]) * m + md[RIG_D['mix.osc2']], -1, 1);
      const lv3 = rigClamp(A[Q_M3] + (B[Q_M3] - A[Q_M3]) * m + md[RIG_D['mix.osc3']], -1, 1);
      const lvn = rigClamp(A[Q_MN] + (B[Q_MN] - A[Q_MN]) * m + md[RIG_D['mix.noise']], -1, 1);

      // ---- LFOs
      for (let k = 0; k < 2; k++) {
        const L = Q_L[k];
        const rate = q[L[3]] >= 0.5 ? this.bpm / 60 / RIG_DIV_BEATS[q[L[4]]] * Math.pow(2, 5 * md[D_L_RATE[k]]) : q[L[0]];
        let ph;
        if (q[L[5]] === 2) {
          ph = pt.lfoPh[k];
        } else {
          ph = v.lph[k] + rate * tick;
          if (ph >= 1) { ph -= Math.floor(ph); v.lhold[k] = this.random() * 2 - 1; }
          v.lph[k] = ph;
        }
        const shape = q[L[2]];
        const x = shape === 0 ? Math.sin(2 * Math.PI * ph)
          : shape === 1 ? (ph < 0.25 ? 4 * ph : ph < 0.75 ? 2 - 4 * ph : 4 * ph - 4)
          : shape === 2 ? (ph < 0.5 ? 1 : -1)
          : shape === 3 ? 2 * ph - 1
          : shape === 4 ? 1 - 2 * ph
          : v.lhold[k];
        v.lval[k] = x * q[L[1]];
      }
      src[S_LFO1] = v.lval[0];
      src[S_LFO2] = v.lval[1];
      v.time += tick;
      src[S_TIME] = Math.min(1, v.time / q[Q_TIME]);

      // ---- pitch
      const glide = q[Q_GLIDE];
      v.pitch = glide > 0 ? v.pitch + (v.target - v.pitch) * (1 - Math.exp(-tick * 4.6 / glide)) : v.target;
      const spread = v.uniN > 1 ? (v.uni / (v.uniN - 1)) * 2 - 1 : 0;
      const base = v.pitch + ctl.bend * q[Q_BEND] + spread * q[Q_DET] * 0.4;
      const hz = (st) => 440 * Math.pow(2, (st - 69) / 12);
      const lim = 0.45;
      const dt1 = Math.min(lim, hz(base + (q[Q_O1_OCT] - 2) * 12 + q[Q_O1_TUNE] + md[D_O1_TUNE] * 64) / sr);
      const dt2 = Math.min(lim, hz(base + (q[Q_O2_OCT] - 2) * 12 + q[Q_O2_TUNE] + md[D_O2_TUNE] * 64) / sr);
      const dt3 = Math.min(lim, hz(base + (q[Q_O3_OCT] - 2) * 12 + q[Q_O3_TUNE] + md[D_O3_TUNE] * 64) / sr);
      const fm1 = (pt.fm1[0] + (pt.fm1[1] - pt.fm1[0]) * m) * 64 / 12, fm2 = (pt.fm2[0] + (pt.fm2[1] - pt.fm2[0]) * m) * 64 / 12;
      const w1 = rigClamp(q[Q_O1_W], 0, 1), w2 = rigClamp(q[Q_O2_W], 0, 1);
      const bl1 = rigClamp(q[Q_O1_B], 0, 1), bl2 = rigClamp(q[Q_O2_B], 0, 1);
      const sub = q[Q_O1_SUB] >= 0.5, sync = q[Q_O2_SYNC] >= 0.5;
      const k1base = 1 - 0.5 * w1, k2base = 1 - 0.5 * w2;
      const pw1 = 0.5 - 0.45 * w1, pw2 = 0.5 - 0.45 * w2;

      // OSC 3: the octave's band-limited copy, and the frames either side of the position
      const levels = this.tables[Math.min(this.tables.length - 1, q[Q_O3_TAB] | 0)];
      const maxH = 0.45 / dt3;
      let lj = 0;
      while (lj < RIG_LEVELS - 1 && levels[lj].h > maxH) lj++;
      const tab = levels[lj], tsize = tab.size, tdata = tab.data;
      const fpos = rigClamp(q[Q_O3_POS], 0, 1) * (RIG_FRAMES - 1);
      const interp = q[Q_O3_INT] >= 0.5;
      const fa = interp ? Math.min(RIG_FRAMES - 2, Math.floor(fpos)) : Math.round(fpos);
      const ff = interp ? fpos - fa : 0;
      const offA = fa * tsize, offB = (interp ? fa + 1 : fa) * tsize;
      const ntype = q[Q_NTYPE];

      // OSC 3 in MACRO mode: the engine renders this tick's samples, at OSC 3's pitch, with the macro knobs
      const macro = RIG_HAS_MACRO && q[Q_O3_MODE] >= 0.5;
      let mOut = null, mAux = null, auxMix = 0;
      if (macro) {
        const model = Math.max(0, Math.min(PL_ENGINES.length - 1, q[Q_O3_MODEL] | 0));
        const E = PL_ENGINES[model];
        if (v.macroModel !== model) {
          v.macro = new E[0](); v.macro.reset(); v.macroModel = model;
          v.mLimOut = new PlLimiter(); v.mLimAux = new PlLimiter();
        }
        const mp = v.mp;
        mp.note = base + (q[Q_O3_OCT] - 2) * 12 + q[Q_O3_TUNE] + md[D_O3_TUNE] * 64;
        mp.harmonics = rigClamp(q[Q_O3_HARM], 0, 1);
        mp.timbre = rigClamp(q[Q_O3_TIMBRE], 0, 1);
        mp.morph = rigClamp(q[Q_O3_MORPH], 0, 1);
        mp.accent = v.vel;
        mp.trigger = v.macroTrig ? PL_TRIGGER_RISING_EDGE | PL_TRIGGER_HIGH : v.gate ? PL_TRIGGER_HIGH : PL_TRIGGER_LOW;
        v.macroTrig = false;
        mOut = v.mOut; mAux = v.mAux;
        v.macro.render(mp, mOut, mAux, len);
        const go = E[1], ga = E[2];
        if (go < 0) v.mLimOut.process(-go, mOut, len); else for (let i = 0; i < len; i++) mOut[i] *= go;
        if (ga < 0) v.mLimAux.process(-ga, mAux, len); else for (let i = 0; i < len; i++) mAux[i] *= ga;
        auxMix = rigClamp(q[Q_O3_AUX], 0, 1);
      }

      // ---- drive (clean at zero, as on the NINA) and filters
      const dr = rigClamp(q[Q_DRIVE], 0, 1);
      const gd = (1 + 8 * dr * dr) * (q[Q_OD] >= 0.5 ? 4 : 1), gdOut = 2 / (1 + 0.12 * (gd - 1));
      const key = (v.note - 60) * q[Q_KEY];
      const e1 = src[S_EG1] * sensE1;
      const ny = 0.45 * sr;
      const lfc = rigClamp(q[Q_LCUT] * Math.pow(2, (key + e1 * q[Q_LEG] * 120 + md[D_LCUT] * 64) / 12), 10, ny);
      const sfc = rigClamp(q[Q_SCUT] * Math.pow(2, (key + e1 * q[Q_SEG] * 120 + md[D_SCUT] * 64) / 12), 10, ny);
      const lg = Math.tan(Math.PI * lfc / sr), LG = lg / (1 + lg), lig = 1 / (1 + lg), LG2 = LG * LG, LG4 = LG2 * LG2;
      const lk = rigClamp(q[Q_LRES], 0, 1) * 4.15, lcomp = 1 + 0.55 * lk;
      const sg = Math.tan(Math.PI * sfc / sr), damp = 2 * (1 - 0.97 * rigClamp(q[Q_SRES], 0, 1));
      const sh = 1 / (1 + damp * sg + sg * sg);
      const smode = rigClamp(q[Q_SMODE], 0, 1), sbp = q[Q_SBP] >= 0.5, route = q[Q_ROUTE];

      // ---- envelopes: one-pole stages; attack aims past 1 so it lands in time, decay and release are 99 % times
      const e2lev = rigClamp(q[Q_E2[4]], 0, 1) * sensE2;
      const ca1 = 1 - Math.exp(-1.609 / (Math.max(0.0005, q[Q_E1[0]]) * sr)), cd1 = 1 - Math.exp(-4.6 / (Math.max(0.0005, q[Q_E1[1]]) * sr));
      const cr1 = 1 - Math.exp(-4.6 / (Math.max(0.0005, q[Q_E1[3]]) * sr)), sus1 = rigClamp(q[Q_E1[2]], 0, 1);
      const ca2 = 1 - Math.exp(-1.609 / (Math.max(0.0005, q[Q_E2[0]]) * sr)), cd2 = 1 - Math.exp(-4.6 / (Math.max(0.0005, q[Q_E2[1]]) * sr));
      const cr2 = 1 - Math.exp(-4.6 / (Math.max(0.0005, q[Q_E2[3]]) * sr)), sus2 = rigClamp(q[Q_E2[2]], 0, 1);

      // ---- output: infinite pan (past ±1 into anti-phase), with unison spread and the panner
      let pan = q[Q_PAN] + q[Q_SPIN] + spread * 0.8 * (v.uniN > 1 ? 1 : 0);
      if (A[Q_PANNER] > 0) pan += v.panPos;
      pan = rigClamp(pan, -2, 2);
      const th = (pan + 1) * Math.PI / 4, gL = Math.cos(th), gR = Math.sin(th);
      const level = rigClamp(q[Q_LEVEL], 0, 1) * 0.3;

      let p1 = v.p1, p2 = v.p2, p3 = v.p3, subS = v.sub;
      let s0 = v.ld0, s1 = v.ld1, s2 = v.ld2, s3 = v.ld3, sv1 = v.v1, sv2 = v.v2;
      let en1 = v.e1, st1 = v.st1, en2 = v.e2, st2 = v.st2, w3 = v.w3;
      for (let i = at; i < at + len; i++) {
        // OSC 3
        if (macro) {
          const k = i - at;
          w3 = mOut[k] + (mAux[k] - mOut[k]) * auxMix;
        } else {
          p3 += dt3;
          if (p3 >= 1) p3 -= 1;
          const x3 = p3 * tsize, i0 = x3 | 0, fr = x3 - i0, i1 = (i0 + 1) & (tsize - 1);
          const ra = tdata[offA + i0] + (tdata[offA + i1] - tdata[offA + i0]) * fr;
          w3 = ff > 0 ? ra + (tdata[offB + i0] + (tdata[offB + i1] - tdata[offB + i0]) * fr - ra) * ff : ra;
        }

        // OSC 1
        const d1 = fm1 !== 0 ? Math.min(lim, dt1 * Math.pow(2, fm1 * w3)) : dt1;
        p1 += d1;
        let wrapped = false, frac = 0;
        if (p1 >= 1) { p1 -= 1; wrapped = true; frac = p1 / d1; subS = -subS; }
        const k1 = rigClamp(k1base, 2 * d1, 1 - 2 * d1), corner1 = 2 / k1 + 2 / (1 - k1);
        let ts1 = p1 < k1 ? 2 * p1 / k1 - 1 : 1 - 2 * (p1 - k1) / (1 - k1);
        let tk = p1 - k1; if (tk < 0) tk += 1;
        ts1 += corner1 * d1 * (rigBlamp(p1, d1) - rigBlamp(tk, d1));
        let pl1;
        if (sub) {
          pl1 = subS + (p1 < d1 ? subS : -subS) * rigBlep(p1, d1);
        } else {
          let tp = p1 - pw1; if (tp < 0) tp += 1;
          pl1 = (p1 < pw1 ? 1 : -1) + rigBlep(p1, d1) - rigBlep(tp, d1);
        }
        const o1 = ts1 + (pl1 - ts1) * bl1;

        // OSC 2 (hard sync: restarts where OSC 1 wrapped)
        const d2 = fm2 !== 0 ? Math.min(lim, dt2 * Math.pow(2, fm2 * w3)) : dt2;
        p2 += d2;
        if (p2 >= 1) p2 -= 1;
        if (sync && wrapped) p2 = Math.min(0.999, frac * d2);
        const k2 = rigClamp(k2base, 2 * d2, 1 - 2 * d2), corner2 = 2 / k2 + 2 / (1 - k2);
        let ts2 = p2 < k2 ? 2 * p2 / k2 - 1 : 1 - 2 * (p2 - k2) / (1 - k2);
        let tk2 = p2 - k2; if (tk2 < 0) tk2 += 1;
        ts2 += corner2 * d2 * (rigBlamp(p2, d2) - rigBlamp(tk2, d2));
        let tp2 = p2 - pw2; if (tp2 < 0) tp2 += 1;
        const pl2 = (p2 < pw2 ? 1 : -1) + rigBlep(p2, d2) - rigBlep(tp2, d2);
        const o2 = ts2 + (pl2 - ts2) * bl2;

        // noise
        let nz = 0;
        if (lvn !== 0) {
          if (ntype === 2) nz = (p1 < pw1 ? 1 : -1) * (p2 < pw2 ? 1 : -1);
          else {
            const white = v.noise();
            if (ntype === 1) {
              v.b0 = 0.99765 * v.b0 + white * 0.099046;
              v.b1 = 0.963 * v.b1 + white * 0.2965164;
              v.b2 = 0.57 * v.b2 + white * 1.0526913;
              nz = (v.b0 + v.b1 + v.b2 + white * 0.1848) * 0.25;
            } else nz = white;
          }
        }

        // mixer, drive
        let x = o1 * lv1 + o2 * lv2 + w3 * lv3 + nz * lvn;
        if (gd > 1) x = rigTanh(x * gd * 0.5) * gdOut;

        // ladder: four TPT one-poles with the saturation where the feedback meets the input
        const S = (LG2 * LG * s0 + LG2 * s1 + LG * s2 + s3) * lig;
        const y4 = (LG4 * x + S) / (1 + lk * LG4);
        let u = rigTanh(x - lk * y4), vv, yy;
        vv = (u - s0) * LG; yy = vv + s0; s0 = yy + vv; u = yy;
        vv = (u - s1) * LG; yy = vv + s1; s1 = yy + vv; u = yy;
        vv = (u - s2) * LG; yy = vv + s2; s2 = yy + vv; u = yy;
        vv = (u - s3) * LG; yy = vv + s3; s3 = yy + vv; u = yy;
        const lad = u * lcomp;

        // SEM: a TPT state-variable filter, its band-pass state softly limited so it can ring without blowing up
        let out = lad;
        if (route > 0) {
          const xin = route === 1 ? lad : x;
          const hp = (xin - (damp + sg) * sv1 - sv2) * sh;
          const bp = sg * hp + sv1;
          sv1 = rigTanh((sg * hp + bp) * 0.3) / 0.3;
          const lp = sg * bp + sv2;
          sv2 = sg * bp + lp;
          let sem;
          if (sbp) sem = bp * damp;
          else if (smode < 0.5) sem = lp + hp * (smode * 2);
          else sem = hp + lp * (2 - smode * 2);
          out = route === 1 ? sem : (lad + sem) * 0.6;
        }

        // envelopes and the amp
        if (st1 === 1) { en1 += (1.25 - en1) * ca1; if (en1 >= 1) { en1 = 1; st1 = 2; } }
        else if (st1 === 2) en1 += (sus1 - en1) * cd1;
        else if (st1 === 3) { en1 -= en1 * cr1; if (en1 < 1e-5) { en1 = 0; st1 = 0; } }
        if (st2 === 1) { en2 += (1.25 - en2) * ca2; if (en2 >= 1) { en2 = 1; st2 = 2; } }
        else if (st2 === 2) en2 += (sus2 - en2) * cd2;
        else if (st2 === 3) { en2 -= en2 * cr2; if (en2 < 1e-5) { en2 = 0; st2 = 0; } }

        const y = out * (drone ? 1 : en2) * e2lev * level;
        busL[i] += y * gL;
        busR[i] += y * gR;
      }
      v.p1 = p1; v.p2 = p2; v.p3 = p3; v.sub = subS; v.w3 = w3;
      v.ld0 = s0; v.ld1 = s1; v.ld2 = s2; v.ld3 = s3; v.v1 = sv1; v.v2 = sv2;
      v.e1 = en1; v.st1 = st1; v.e2 = en2; v.st2 = st2;
      if (!Number.isFinite(s3) || !Number.isFinite(sv2)) { v.ld0 = v.ld1 = v.ld2 = v.ld3 = 0; v.v1 = v.v2 = 0; }
    }
    if (!drone && v.st2 === 0 && !v.gate) v.active = false;
  }
}

if (typeof registerProcessor === 'function') {
  class MoaRig extends AudioWorkletProcessor {
    constructor(options) {
      super();
      this.core = new RigCore(sampleRate);
      const st = (options && options.processorOptions && options.processorOptions.state) || {};
      if (st.counts) this.core.setLayout(st.counts);
      for (const p of st.patches || []) this.core.setPatch(p.part, p.a, p.b);
      if (st.bpm) this.core.bpm = st.bpm;
      (st.kinds || []).forEach((kind, p) => this.core.setKind(p, kind));
      if (this.core.mix) for (const id in st.mix || {}) this.core.mix.set(id, st.mix[id]);
      this.since = 0;
      // \`when\` (an audio-clock time) places a message on its sample: the sequencer sends ahead of time
      this.port.onmessage = (e) => {
        const m = e.data;
        this.core.post(m, m.when === undefined ? undefined : Math.round(m.when * sampleRate));
      };
      this.port.postMessage({ type: 'ready' }); // the device sends the kits' sounds and pads when it hears this
    }
    process(inputs, outputs) {
      const out = outputs[0];
      this.core.frame = currentFrame;
      if (this.core.mix && (this.since += out[0].length) >= sampleRate / 30) {
        this.since = 0;
        this.port.postMessage({ type: 'meters', ...this.core.mix.meters() });
      }
      this.core.process(out[0], out[1] || out[0], out[0].length);
      return true;
    }
  }
  registerProcessor('${RIG_NAME}', MoaRig);
}
`;
