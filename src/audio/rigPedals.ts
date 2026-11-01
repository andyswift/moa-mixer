import { PEDAL_CHOICE_SCALE, PEDAL_KNOBS, PEDAL_SLOTS, PEDAL_SYNC_BEATS, PEDAL_TYPES } from '../domain/devices/rigPedals';

/**
 * The pedals' DSP, as worklet source text: `MixPedal`, one running pedal, and `mixPedalChain`, which runs a part's
 * slots in order over its bus. Part of RIG_MIX_SOURCE (it uses the mixer's MixLine, mixSoft and MIX_TAU, and Mutable
 * Instruments' ensemble and Beads from src/audio/mutable).
 *
 * Each block a slot's knobs are read as what they mean (rigPedals.ts); the pedal works on the part's audio in place,
 * and MIX blends what it made with what came in: the dry at full up to half way and fading after, the wet the other
 * way, so 0.5 is both at full. A slot that is OFF, or switched off, is skipped (the sound passes untouched); a slot
 * whose type changes starts again from silence.
 */
export const RIG_PEDALS_SOURCE = `
const PEDAL_SPECS = ${JSON.stringify(PEDAL_TYPES.map((t) => t.knobs.map((k) => [k.min, k.max, k.curve === 'log' ? 1 : 0, k.options ? k.options.length : 0])))};
const PEDAL_SLOTS = ${PEDAL_SLOTS}, PEDAL_KNOBS = ${PEDAL_KNOBS}, PEDAL_CHOICE_SCALE = ${PEDAL_CHOICE_SCALE};
const PEDAL_SYNC_BEATS = ${JSON.stringify(PEDAL_SYNC_BEATS)};
const PD = { OFF: 0, DRIVE: 1, COMP: 2, FILTER: 3, PHASER: 4, FLANGER: 5, CHORUS: 6, TREMOLO: 7, RING: 8, CRUSH: 9, DELAY: 10, BEADS: 11 };

function pedalDecode(spec, x) {
  const u = x < 0 ? 0 : x > 1 ? 1 : x, min = spec[0], max = spec[1];
  if (spec[3]) return Math.min(spec[3] - 1, Math.round(u * PEDAL_CHOICE_SCALE));
  return spec[2] ? min * Math.pow(max / min, u) : min + (max - min) * u;
}
/** A rate in Hz: the knob, or the tempo's division when SYNC is set. */
function pedalRate(hz, syncIdx, bpm) { return syncIdx > 0 ? bpm / 60 / PEDAL_SYNC_BEATS[syncIdx] : hz; }
/** An LFO's shape at phase ph (0..1): 0 sine, 1 triangle, 2 square; -1..1. */
function pedalWave(shape, ph) {
  return shape === 0 ? Math.sin(MIX_TAU * ph) : shape === 1 ? (ph < 0.5 ? 4 * ph - 1 : 3 - 4 * ph) : (ph < 0.5 ? 1 : -1);
}

class MixPedal {
  constructor(sr, type) {
    this.sr = sr; this.type = type; this.v = new Float64Array(PEDAL_KNOBS); this.ph = 0; this.ph2 = 0;
    const T = PD;
    if (type === T.DRIVE) this.lp = [0, 0];
    else if (type === T.COMP) this.gr = 0;
    else if (type === T.FILTER) { this.s1 = [0, 0]; this.s2 = [0, 0]; this.env = 0; this.nz = [0, 0]; this.seed = 987654321; }
    else if (type === T.PHASER) { this.ap = [new Float64Array(12), new Float64Array(12)]; this.fb = [0, 0]; }
    else if (type === T.FLANGER) { this.lines = [new MixLine(Math.ceil(sr * 0.03)), new MixLine(Math.ceil(sr * 0.03))]; this.fb = [0, 0]; }
    else if (type === T.CHORUS) { this.line = new MixLine(Math.ceil(sr * 0.05)); this.lp = [0, 0]; this.ens = new MiEnsemble(); this.ens.spread = true; }
    else if (type === T.CRUSH) { this.hold = [0, 0]; this.acc = 0; this.lp = [0, 0]; }
    else if (type === T.DELAY) {
      this.L = new MixLine(Math.ceil(sr * 2.2)); this.R = new MixLine(Math.ceil(sr * 2.2)); this.d = 0;
      this.t = [0, 0]; this.h = [0, 0]; this.a2 = [0, 0]; this.seed = 1234567;
    } else if (type === T.BEADS) { this.beads = new MiBeadsDelay(sr); this.p = {}; this.oL = new Float32Array(MIX_BLOCK); this.oR = new Float32Array(MIX_BLOCK); }
  }

  // the knobs (0..1 each, from the mixer's table at \`base\`) as what they mean
  read(table, base) {
    const spec = PEDAL_SPECS[this.type];
    for (let i = 0; i < spec.length; i++) this.v[i] = pedalDecode(spec[i], table[base + i]);
  }

  run(L, R, n, bpm) {
    const T = PD, t = this.type;
    if (t === T.DRIVE) this.drive(L, R, n);
    else if (t === T.COMP) this.comp(L, R, n);
    else if (t === T.FILTER) this.filter(L, R, n, bpm);
    else if (t === T.PHASER) this.phaser(L, R, n, bpm);
    else if (t === T.FLANGER) this.flanger(L, R, n, bpm);
    else if (t === T.CHORUS) this.chorus(L, R, n);
    else if (t === T.TREMOLO) this.tremolo(L, R, n, bpm);
    else if (t === T.RING) this.ring(L, R, n);
    else if (t === T.CRUSH) this.crush(L, R, n);
    else if (t === T.DELAY) this.delay(L, R, n, bpm);
    else if (t === T.BEADS) this.runBeads(L, R, n, bpm);
  }

  // the mixer's old drive insert
  drive(L, R, n) {
    const v = this.v, type = v[0], amt = v[1], level = v[3];
    const g = 1 + amt * [24, 40, 150][type], comp = 1 / (1 + amt * [4, 5, 7][type]);
    const lc = 1 - Math.exp(-MIX_TAU * 800 * Math.pow(25, v[2]) / this.sr);
    for (let c = 0; c < 2; c++) {
      const X = c ? R : L;
      let lp = this.lp[c];
      for (let i = 0; i < n; i++) {
        const u = X[i] * g;
        let y;
        if (type === 0) y = Math.tanh(u + 0.25) - 0.2449186624037092;
        else if (type === 1) y = u >= 0 ? 1 - Math.exp(-u) : -0.8 * (1 - Math.exp(u / 0.8));
        else { const s = u < 0 ? -1 : 1; y = s * Math.min(0.85, 1 - Math.exp(-Math.abs(u))); }
        lp += (y - lp) * lc;
        X[i] = lp * comp * level;
      }
      this.lp[c] = lp;
    }
  }

  // a stereo-linked compressor, peak-sensing with a soft knee
  comp(L, R, n) {
    const v = this.v, sr = this.sr, thr = v[0], slope = 1 / v[1] - 1, knee = 6;
    const atk = 1 - Math.exp(-1 / (v[2] / 1000 * sr)), rel = 1 - Math.exp(-1 / (v[3] / 1000 * sr)), makeup = v[4];
    let gr = this.gr;
    for (let i = 0; i < n; i++) {
      const a = Math.max(Math.abs(L[i]), Math.abs(R[i]));
      const over = 20 * Math.log10(a + 1e-9) - thr;
      const want = over <= -knee / 2 ? 0 : over < knee / 2 ? slope * (over + knee / 2) * (over + knee / 2) / (2 * knee) : slope * over;
      gr += (want - gr) * (want < gr ? atk : rel);
      const g = Math.pow(10, (gr + makeup) / 20);
      L[i] *= g; R[i] *= g;
    }
    this.gr = gr;
  }

  // a TPT state-variable filter, its cutoff moved by an LFO, the input's level or noise, set every 16 samples
  filter(L, R, n, bpm) {
    const v = this.v, sr = this.sr, mode = v[0], cutoff = v[1], k = 2 - 1.96 * v[2], env = v[3] === 1, noise = v[3] === 2, depth = v[4];
    // the noise: white, through two one-pole low-passes at RATE x 100 Hz (gained so it spreads as far as the LFO's sine, whatever the rate)
    const nc = 1 - Math.exp(-MIX_TAU * Math.min(sr * 0.2, v[5] * 100) / sr), ng = 4.8 / Math.sqrt(nc);
    const rate = pedalRate(v[5], v[6], bpm), drive = 1 + v[7] * 8, dcomp = 1 / Math.sqrt(drive);
    const ea = 1 - Math.exp(-1 / (0.004 * sr)), er = 1 - Math.exp(-1 / (0.12 * sr));
    let a1 = 0, a2 = 0, a3 = 0;
    for (let i = 0; i < n; i++) {
      if (env) { const a = Math.abs(L[i]) + Math.abs(R[i]); this.env += (a - this.env) * (a > this.env ? ea : er); }
      else if (noise) {
        this.seed = (this.seed * 1664525 + 1013904223) >>> 0;
        this.nz[0] += (this.seed / 4294967296 - 0.5 - this.nz[0]) * nc; this.nz[1] += (this.nz[0] - this.nz[1]) * nc;
      } else { this.ph += rate / sr; if (this.ph >= 1) this.ph -= 1; }
      if ((i & 15) === 0) {
        const m = env ? Math.min(1, this.env * 2) * 2 - 0.5 : noise ? Math.max(-1.5, Math.min(1.5, this.nz[1] * ng)) : Math.sin(MIX_TAU * this.ph);
        const fc = Math.min(sr * 0.45, Math.max(20, cutoff * Math.pow(2, depth * 4 * m)));
        const g = Math.tan(Math.PI * fc / sr);
        a1 = 1 / (1 + g * (g + k)); a2 = g * a1; a3 = g * a2;
      }
      for (let c = 0; c < 2; c++) {
        const X = c ? R : L;
        let x = X[i];
        if (drive > 1) x = Math.tanh(x * drive) * dcomp;
        const v3 = x - this.s2[c], v1 = a1 * this.s1[c] + a2 * v3, v2 = this.s2[c] + a2 * this.s1[c] + a3 * v3;
        this.s1[c] = 2 * v1 - this.s1[c]; this.s2[c] = 2 * v2 - this.s2[c];
        X[i] = mode === 0 ? v2 : mode === 1 ? v1 * k : x - k * v1 - v2;
      }
    }
    if (!Number.isFinite(this.s1[0] + this.s1[1] + this.s2[0] + this.s2[1])) { this.s1 = [0, 0]; this.s2 = [0, 0]; }
  }

  // first-order all-passes in a row, their corner swept by an LFO (the right side a quarter turn on), fed back
  phaser(L, R, n, bpm) {
    const v = this.v, sr = this.sr, rate = pedalRate(v[0], v[1], bpm), depth = v[2], fb = v[3], stages = [4, 8, 12][v[4]], centre = v[5];
    let c0 = 0, c1 = 0;
    for (let i = 0; i < n; i++) {
      this.ph += rate / sr; if (this.ph >= 1) this.ph -= 1;
      if ((i & 15) === 0) {
        const coef = (m) => { const f = Math.min(sr * 0.45, centre * Math.pow(2, depth * 2 * m)), t = Math.tan(Math.PI * f / sr); return (t - 1) / (t + 1); };
        c0 = coef(Math.sin(MIX_TAU * this.ph)); c1 = coef(Math.sin(MIX_TAU * (this.ph + 0.25)));
      }
      for (let c = 0; c < 2; c++) {
        const X = c ? R : L, ap = this.ap[c], a = c ? c1 : c0;
        let x = X[i] + this.fb[c] * fb;
        for (let s = 0; s < stages; s++) { const y = a * x + ap[s]; ap[s] = x - a * y; x = y; }
        this.fb[c] = x;
        X[i] = x;
      }
    }
    if (!Number.isFinite(this.fb[0] + this.fb[1])) { this.ap[0].fill(0); this.ap[1].fill(0); this.fb = [0, 0]; }
  }

  // a short delay swept by an LFO (the right side opposite), fed back; with the dry it combs
  flanger(L, R, n, bpm) {
    const v = this.v, sr = this.sr, rate = pedalRate(v[0], v[1], bpm), depth = v[2], base = v[3] / 1000 * sr, fb = v[4];
    for (let i = 0; i < n; i++) {
      this.ph += rate / sr; if (this.ph >= 1) this.ph -= 1;
      const tri = this.ph < 0.5 ? 4 * this.ph - 1 : 3 - 4 * this.ph;
      for (let c = 0; c < 2; c++) {
        const X = c ? R : L, line = this.lines[c];
        const d = Math.max(1, base * (1 + depth * 0.95 * (c ? -tri : tri)));
        const y = line.read(d);
        line.push(mixSoft(X[i] + y * fb));
        X[i] = y;
      }
    }
  }

  // the mixer's old send D: the Juno's two taps swept apart, or Rings' ensemble
  chorus(L, R, n) {
    const v = this.v, sr = this.sr, mode = v[0], w = v[3];
    if (mode === 3) {
      const en = this.ens;
      en.setDepth(v[2]);
      en.rate = Math.pow(4, (v[1] - 0.5) * 2);
      en.process(L, R, n, true);
    } else {
      const rate = [0.513, 0.863, 9.75][mode] * Math.pow(4, (v[1] - 0.5) * 2);
      const depth = [1.85, 1.85, 0.3][mode] * 2 * v[2] * sr / 1000, centre = 3.5 * sr / 1000;
      const c = 1 - Math.exp(-MIX_TAU * 9000 / sr);
      for (let i = 0; i < n; i++) {
        this.line.push((L[i] + R[i]) * 0.5);
        this.ph += rate / sr; if (this.ph > 1) this.ph -= 1;
        const tri = this.ph < 0.5 ? 4 * this.ph - 1 : 3 - 4 * this.ph;
        this.lp[0] += (this.line.read(centre + tri * depth) - this.lp[0]) * c;
        this.lp[1] += (this.line.read(centre - tri * depth) - this.lp[1]) * c;
        L[i] = this.lp[0]; R[i] = this.lp[1];
      }
    }
    for (let i = 0; i < n; i++) { const l = L[i], r = R[i]; L[i] = l * (1 + w) / 2 + r * (1 - w) / 2; R[i] = r * (1 + w) / 2 + l * (1 - w) / 2; }
  }

  // the level dipped by an LFO; PAN turns it into an auto-pan (the sides dip in turn)
  tremolo(L, R, n, bpm) {
    const v = this.v, sr = this.sr, rate = pedalRate(v[0], v[1], bpm), depth = v[2], shape = v[3], pan = v[4];
    for (let i = 0; i < n; i++) {
      this.ph += rate / sr; if (this.ph >= 1) this.ph -= 1;
      const m = pedalWave(shape, this.ph);
      const gT = 1 - depth * (0.5 - 0.5 * m), gL = 1 - depth * (0.5 + 0.5 * m) * pan, gR = 1 - depth * (0.5 - 0.5 * m) * pan;
      L[i] *= gT * (1 - pan) + gL * pan; R[i] *= gT * (1 - pan) + gR * pan;
    }
  }

  // multiplied by a sine or square, its frequency wandering with a slow LFO
  ring(L, R, n) {
    const v = this.v, sr = this.sr, freq = v[0], square = v[1] === 1, lrate = v[2], ldepth = v[3];
    for (let i = 0; i < n; i++) {
      this.ph2 += lrate / sr; if (this.ph2 >= 1) this.ph2 -= 1;
      this.ph += freq * Math.pow(2, ldepth * 2 * Math.sin(MIX_TAU * this.ph2)) / sr; if (this.ph >= 1) this.ph -= Math.floor(this.ph);
      const c = square ? (this.ph < 0.5 ? 1 : -1) : Math.sin(MIX_TAU * this.ph);
      L[i] *= c; R[i] *= c;
    }
  }

  // held at a lower rate and cut to fewer bits, then a tone low-pass
  crush(L, R, n) {
    const v = this.v, sr = this.sr, steps = Math.pow(2, v[0] - 1), step = Math.min(1, v[1] / sr), level = v[3];
    const lc = 1 - Math.exp(-MIX_TAU * Math.min(sr * 0.45, 500 * Math.pow(40, v[2])) / sr);
    for (let i = 0; i < n; i++) {
      this.acc += step;
      if (this.acc >= 1) { this.acc -= 1; this.hold[0] = Math.round(L[i] * steps) / steps; this.hold[1] = Math.round(R[i] * steps) / steps; }
      this.lp[0] += (this.hold[0] - this.lp[0]) * lc; this.lp[1] += (this.hold[1] - this.lp[1]) * lc;
      L[i] = this.lp[0] * level; R[i] = this.lp[1] * level;
    }
  }

  // a delay timed to the part: TAPE (wow, darkening, saturating) or BBD (swept, gritty), mono in, ping-pong or not
  delay(L, R, n, bpm) {
    const v = this.v, sr = this.sr, bbd = v[0] === 1;
    const time = v[2] > 0 ? 60 / bpm * PEDAL_SYNC_BEATS[v[2]] : v[1] / 1000;
    const target = Math.min(2, Math.max(0.005, time)) * sr, fb = v[3], ping = v[5] === 1, mod = v[6];
    const lc = 1 - Math.exp(-MIX_TAU * v[4] / sr), hc = 1 - Math.exp(-MIX_TAU * 90 / sr);
    const glide = 1 - Math.exp(-1 / ((bbd ? 0.05 : 0.15) * sr));
    const wow = mod * (bbd ? 0.006 : 0.0025) * sr, rate = bbd ? 0.6 : 0.45;
    if (this.d === 0) this.d = target;
    const out = [0, 0];
    for (let i = 0; i < n; i++) {
      this.d += (target - this.d) * glide;
      this.ph += rate / sr; if (this.ph > 1) this.ph -= 1;
      const w = wow * (bbd ? (this.ph < 0.5 ? 4 * this.ph - 1 : 3 - 4 * this.ph) : Math.sin(MIX_TAU * this.ph));
      const x = (L[i] + R[i]) * 0.5;
      for (let c = 0; c < 2; c++) {
        const line = c ? this.R : this.L;
        let y = line.read(Math.max(1, this.d * (c && !ping ? 1.012 : 1) + (c ? -w : w)));
        this.t[c] += (y - this.t[c]) * lc;
        if (bbd) { this.a2[c] += (this.t[c] - this.a2[c]) * lc; y = this.a2[c]; this.seed = (this.seed * 1664525 + 1013904223) >>> 0; y = mixSoft(y * 1.2) / 1.2 + (this.seed / 4294967296 - 0.5) * 0.002 * Math.abs(y); }
        else { this.h[c] += (this.t[c] - this.h[c]) * hc; y = mixSoft((this.t[c] - this.h[c]) * 3) / 3; }
        out[c] = y;
      }
      if (ping) { this.L.push(x + out[1] * fb); this.R.push(out[0] * fb); }
      else { this.L.push(x + out[0] * fb); this.R.push(x + out[1] * fb); }
      L[i] = out[0]; R[i] = out[1];
    }
    if (!Number.isFinite(this.t[0] + this.t[1] + this.a2[0] + this.a2[1])) { this.L.buf.fill(0); this.R.buf.fill(0); this.t = [0, 0]; this.h = [0, 0]; this.a2 = [0, 0]; }
  }

  // Beads' delay, its clock ticked at the pedal's time
  runBeads(L, R, n, bpm) {
    const v = this.v, p = this.p;
    const time = v[1] > 0 ? 60 / bpm * PEDAL_SYNC_BEATS[v[1]] : v[0] / 1000;
    p.interval = Math.max(MI_MIN_DELAY, time * this.sr); p.feedback = Math.min(1, v[2]);
    p.density = v[3]; p.multiply = v[4]; p.shape = v[5]; p.pitch = v[6]; p.bandwidth = v[7];
    this.beads.process(L, R, this.oL, this.oR, n, p);
    if (!Number.isFinite(this.oL[n - 1] + this.oR[n - 1])) { this.beads.clear(); this.oL.fill(0); this.oR.fill(0); }
    L.set(this.oL.subarray(0, n)); R.set(this.oR.subarray(0, n));
  }
}

/**
 * A part's chain, run over its bus (L, R, in place): each slot that is on, in order, MIX blending (glided across the
 * block) what it made with what came in. \`chain\` keeps the part's running pedals and their MIX; \`v\` is the mixer's
 * table and \`base\` where the part's first slot starts in it.
 */
function mixPedalChain(chain, v, base, L, R, n, bpm, sr, dryL, dryR) {
  for (let s = 0; s < PEDAL_SLOTS; s++) {
    const o = base + s * (3 + PEDAL_KNOBS), type = Math.round(v[o]);
    if (type <= 0 || v[o + 1] < 0.5) { chain[s] = null; continue; }
    let ped = chain[s];
    if (!ped || ped.type !== type) { ped = chain[s] = new MixPedal(sr, type); ped.mix = v[o + 2]; }
    ped.read(v, o + 3);
    const mix = v[o + 2], m0 = ped.mix, dm = (mix - m0) / n;
    if (mix >= 1 && m0 >= 1) { ped.run(L, R, n, bpm); continue; }
    dryL.set(L.subarray(0, n)); dryR.set(R.subarray(0, n));
    ped.run(L, R, n, bpm);
    let m = m0;
    for (let i = 0; i < n; i++) {
      m += dm;
      const gd = m < 0.5 ? 1 : 2 - 2 * m, gw = m > 0.5 ? 1 : 2 * m;
      L[i] = dryL[i] * gd + L[i] * gw; R[i] = dryR[i] * gd + R[i] * gw;
    }
    ped.mix = mix;
  }
}
`;
