import { MUTABLE_FX_SOURCE } from './mutable';
import {
  RIG_DELAY_DIV_BEATS, RIG_MIX_PARAMS, RIG_MIX_PARTS, RIG_STRIPS,
} from '../domain/devices/rigMix';

const DEFS = RIG_MIX_PARAMS.map((p) => [p.id, p.def]);

/**
 * The MOA-RIG's mixer and effects, as worklet source text (`RigMixer`). The rig's worklet hands it every part's
 * stereo bus each block and takes the master out of it; tests evaluate the same text.
 *
 *   part bus -> [drive, if it is the drive's part] -> strip -> master bus -> compressor -> tape (and its wow) -> master fader -> ceiling
 *                                                        \-> sends A-D (after the fader and pan)
 *   send A -> dub delay, B -> BBD, C -> reverb, D -> chorus -> return strips A-D -> master bus
 *                                                                  \-> sends A-D (themselves too)
 *
 * A strip: low shelf, mid peak, high shelf (RBJ biquads), the one-knob filter (a TPT state-variable filter, low-pass
 * to the left, high-pass to the right), balance, mute and solo, the fader. Gains glide across each block.
 * The returns' sends reach the effects a block later (2.7 ms at 48 kHz), which is what lets a return feed itself;
 * with FEEDBACK LIMIT on, each send bus passes a soft clipper, so a loop past unity grows into a bounded roar.
 * Every effect is fully wet; the dry sound stays on its strip.
 */
export const RIG_MIX_SOURCE = `
${MUTABLE_FX_SOURCE}
const MIX_DEFS = ${JSON.stringify(DEFS)};
const MIX_N = MIX_DEFS.length;
const MIX_P = {};
MIX_DEFS.forEach((d, i) => { MIX_P[d[0]] = i; });
const MIX_STRIPS = ${JSON.stringify(RIG_STRIPS)};
const MIX_PARTS = ${RIG_MIX_PARTS};
const MIX_DIV_BEATS = ${JSON.stringify(RIG_DELAY_DIV_BEATS)};
const MIX_BLOCK = 512;
const MIX_TAU = Math.PI * 2;
// strip param offsets (in the order rigMix.ts lists them)
const S_HI = 0, S_MID = 1, S_LO = 2, S_FILTER = 3, S_PAN = 4, S_SEND = 5, S_MUTE = 9, S_SOLO = 10, S_THROW = 11, S_FADER = 12, S_NP = 13;

// RBJ biquad coefficients [b0, b1, b2, a1, a2] (a0 normalised): 0 low shelf, 1 peak, 2 high shelf
function mixBiquad(type, f, q, db, sr) {
  const A = Math.pow(10, db / 40), w = MIX_TAU * f / sr, cw = Math.cos(w), sw = Math.sin(w);
  if (type === 1) {
    const al = sw / (2 * q), a0 = 1 + al / A;
    return [(1 + al * A) / a0, -2 * cw / a0, (1 - al * A) / a0, -2 * cw / a0, (1 - al / A) / a0];
  }
  const al = sw / 2 * Math.SQRT2, sA = 2 * Math.sqrt(A) * al;
  if (type === 0) {
    const a0 = (A + 1) + (A - 1) * cw + sA;
    return [A * ((A + 1) - (A - 1) * cw + sA) / a0, 2 * A * ((A - 1) - (A + 1) * cw) / a0, A * ((A + 1) - (A - 1) * cw - sA) / a0,
      -2 * ((A - 1) + (A + 1) * cw) / a0, ((A + 1) + (A - 1) * cw - sA) / a0];
  }
  const a0 = (A + 1) - (A - 1) * cw + sA;
  return [A * ((A + 1) + (A - 1) * cw + sA) / a0, -2 * A * ((A - 1) + (A + 1) * cw) / a0, A * ((A + 1) + (A - 1) * cw - sA) / a0,
    2 * ((A - 1) - (A + 1) * cw) / a0, ((A + 1) - (A - 1) * cw - sA) / a0];
}

// soft clipper: unity for small signals, bounded at +-1
// the CLOUDS reverb's level against the delay network's, matched by ear and RMS (see the mixer tests)
const CLOUDS_GAIN = 0.75;
function mixSoft(x) { return x > 3 ? 1 : x < -3 ? -1 : x * (27 + x * x) / (27 + 9 * x * x); }

// a delay line that reads between samples
class MixLine {
  constructor(n) { this.buf = new Float32Array(n); this.w = 0; this.n = n; }
  push(x) { this.buf[this.w] = x; this.w = (this.w + 1) % this.n; }
  // \`d\` samples ago (d >= 1), linear between samples
  read(d) {
    const p = this.w - d;
    let i = Math.floor(p);
    const f = p - i;
    i = ((i % this.n) + this.n) % this.n;
    const a = this.buf[i], b = this.buf[(i + 1) % this.n];
    return a + (b - a) * f;
  }
}

class MixStrip {
  constructor() {
    this.eq = [new Float64Array(5), new Float64Array(5), new Float64Array(5)];
    this.on = [false, false, false];
    this.z = new Float64Array(12); // 3 biquads x 2 channels x 2 states
    this.s1 = [0, 0]; this.s2 = [0, 0]; // filter
    this.fc = 0; // the filter knob, glided
    this.gL = 0; this.gR = 0; this.send = [0, 0, 0, 0];
    this.eqKey = '';
    this.started = false; // the first block starts at the settings rather than gliding up to them
    this.peakL = 0; this.peakR = 0;
    this.sqL = 0; this.sqR = 0; this.count = 0; // for the RMS since the meters were last read
  }
}

class RigMixer {
  constructor(sr, parts = MIX_PARTS) {
    this.sr = sr;
    this.parts = parts;
    this.v = new Float64Array(MIX_N);
    for (let i = 0; i < MIX_N; i++) this.v[i] = MIX_DEFS[i][1];
    this.strips = MIX_STRIPS.map(() => new MixStrip());
    const buf = () => new Float32Array(MIX_BLOCK);
    this.busL = [buf(), buf(), buf(), buf()]; this.busR = [buf(), buf(), buf(), buf()];
    // what the returns sent last block, for the effects this block
    this.carryL = [buf(), buf(), buf(), buf()]; this.carryR = [buf(), buf(), buf(), buf()];
    this.retL = [buf(), buf(), buf(), buf()]; this.retR = [buf(), buf(), buf(), buf()];
    this.mixL = buf(); this.mixR = buf(); this.tmpL = buf(); this.tmpR = buf();
    this.dub = { L: new MixLine(Math.ceil(sr * 2.2)), R: new MixLine(Math.ceil(sr * 2.2)), d: sr * 0.375, ph: 0, ph2: 0, tL: 0, tR: 0, hL: 0, hR: 0, drift: 0 };
    this.bbd = { L: new MixLine(Math.ceil(sr * 0.7)), R: new MixLine(Math.ceil(sr * 0.7)), d: sr * 0.32, ph: 0, a1: [0, 0], a2: [0, 0], seed: 22222 };
    this.rev = this.makeReverb();
    // Mutable Instruments' (src/audio/mutable): the CLOUDS reverb, the ENSEMBLE chorus, wow and flutter in the dub's loop
    // and on the tape; blocks of the reverb's in and out
    this.miReverb = new MiReverb(sr); this.miEnsemble = new MiEnsemble(); this.miEnsemble.spread = true;
    this.beads = null; // Beads' delay (8 s of stereo line): made when first chosen
    this.dubFlutter = new MiWowAndFlutter(sr); this.tapeWow = new MiWowAndFlutter(sr);
    this.miL = new Float64Array(MIX_BLOCK); this.miR = new Float64Array(MIX_BLOCK); this.miOut = [0, 0];
    this.cho = { line: new MixLine(Math.ceil(sr * 0.05)), ph: 0, lp: [0, 0] };
    this.drv = { lp: [0, 0] };
    this.cmp = { gr: 0, hp: 0, hx: 0, minGr: 0 };
    this.tape = { lpL: 0, lpR: 0, dcL: 0, dcR: 0 };
    this.masterG = 1;
    this.peak = [0, 0];
    this.masterSq = [0, 0]; this.masterCount = 0;
  }

  set(id, value) {
    const i = MIX_P[id];
    if (i !== undefined) this.v[i] = value;
  }

  p(id) { return this.v[MIX_P[id]]; }

  // ---- strips

  updateEq(st, base) {
    const v = this.v, key = v[base + S_LO] + ',' + v[base + S_MID] + ',' + v[base + S_HI];
    if (key === st.eqKey) return;
    st.eqKey = key;
    const bands = [[0, 250, 0.707, v[base + S_LO]], [1, 1000, 0.7, v[base + S_MID]], [2, 4000, 0.707, v[base + S_HI]]];
    bands.forEach((b, k) => {
      st.on[k] = Math.abs(b[3]) > 0.01;
      if (st.on[k]) st.eq[k].set(mixBiquad(b[0], b[1], b[2], b[3], this.sr));
    });
  }

  // one strip: \`inL/inR\` -> EQ, filter, gains -> adds to the mix and to the four send buses (sL/sR)
  runStrip(s, inL, inR, n, soloed, sL, sR) {
    const st = this.strips[s], v = this.v, base = s * S_NP, sr = this.sr;
    this.updateEq(st, base);
    const muted = v[base + S_MUTE] >= 0.5 || (soloed && v[base + S_SOLO] < 0.5);
    const fader = muted ? 0 : v[base + S_FADER], pan = v[base + S_PAN];
    const tL = fader * (pan > 0 ? 1 - pan : 1), tR = fader * (pan < 0 ? 1 + pan : 1);
    const throwA = v[base + S_THROW] >= 0.5;
    const tSend = [throwA ? 1 : v[base + S_SEND], v[base + S_SEND + 1], v[base + S_SEND + 2], v[base + S_SEND + 3]];
    // the filter knob glides, and sets a TPT SVF: low-pass from 20 kHz down to 100 Hz, or high-pass from 20 Hz up to 5 kHz
    const target = v[base + S_FILTER];
    if (!st.started) { st.started = true; st.gL = tL; st.gR = tR; st.send = tSend.slice(); st.fc = target; }
    st.fc += (target - st.fc) * Math.min(1, n / (0.03 * sr));
    const f = st.fc, filt = Math.abs(f) > 0.01;
    const fcHz = f < 0 ? 20000 * Math.pow(0.005, -f) : 20 * Math.pow(250, f);
    const g = Math.tan(Math.PI * Math.min(fcHz, sr * 0.45) / sr), k = 1.1, a1 = 1 / (1 + g * (g + k)), a2 = g * a1, a3 = g * a2;
    const z = st.z, E = st.eq, on = st.on;
    const dL = (tL - st.gL) / n, dR = (tR - st.gR) / n;
    const dS = tSend.map((x, j) => (x - st.send[j]) / n);
    let gL = st.gL, gR = st.gR, pkL = st.peakL, pkR = st.peakR, sqL = st.sqL, sqR = st.sqR;
    const snd = st.send.slice();
    for (let i = 0; i < n; i++) {
      let xl = inL[i], xr = inR[i];
      for (let b = 0; b < 3; b++) {
        if (!on[b]) continue;
        const c = E[b], o = b * 4;
        let y = c[0] * xl + z[o];
        z[o] = c[1] * xl - c[3] * y + z[o + 1]; z[o + 1] = c[2] * xl - c[4] * y; xl = y;
        y = c[0] * xr + z[o + 2];
        z[o + 2] = c[1] * xr - c[3] * y + z[o + 3]; z[o + 3] = c[2] * xr - c[4] * y; xr = y;
      }
      if (filt) {
        for (let ch = 0; ch < 2; ch++) {
          const x = ch ? xr : xl;
          const v3 = x - st.s2[ch], v1 = a1 * st.s1[ch] + a2 * v3, v2 = st.s2[ch] + a2 * st.s1[ch] + a3 * v3;
          st.s1[ch] = 2 * v1 - st.s1[ch]; st.s2[ch] = 2 * v2 - st.s2[ch];
          const y = f < 0 ? v2 : x - k * v1 - v2;
          if (ch) xr = y; else xl = y;
        }
      }
      gL += dL; gR += dR;
      const ol = xl * gL, or = xr * gR;
      this.mixL[i] += ol; this.mixR[i] += or;
      for (let j = 0; j < 4; j++) {
        snd[j] += dS[j];
        if (snd[j] > 1e-6) { sL[j][i] += ol * snd[j]; sR[j][i] += or * snd[j]; }
      }
      const al = ol < 0 ? -ol : ol, ar = or < 0 ? -or : or;
      if (al > pkL) pkL = al;
      if (ar > pkR) pkR = ar;
      sqL += ol * ol; sqR += or * or;
    }
    st.gL = tL; st.gR = tR; st.send = tSend;
    st.peakL = pkL; st.peakR = pkR; st.sqL = sqL; st.sqR = sqR; st.count += n;
    if (!Number.isFinite(st.s1[0] + st.s1[1] + st.s2[0] + st.s2[1] + z[0] + z[2] + z[4] + z[6] + z[8] + z[10])) { st.z.fill(0); st.s1 = [0, 0]; st.s2 = [0, 0]; }
  }

  // ---- the drive insert

  runDrive(L, R, n) {
    const v = this.v, d = this.drv, type = Math.round(this.p('drv.type'));
    const amt = this.p('drv.drive'), blend = this.p('drv.blend'), level = this.p('drv.level');
    const g = 1 + amt * [24, 40, 150][type];
    const comp = 1 / (1 + amt * [4, 5, 7][type]); // turning the drive up mostly changes the tone, not the level
    const lc = 1 - Math.exp(-MIX_TAU * 800 * Math.pow(25, this.p('drv.tone')) / this.sr);
    for (let ch = 0; ch < 2; ch++) {
      const X = ch ? R : L;
      let lp = d.lp[ch];
      for (let i = 0; i < n; i++) {
        const x = X[i], u = x * g;
        let y;
        if (type === 0) y = Math.tanh(u + 0.25) - 0.2449186624037092; // tube: lop-sided, so even harmonics too
        else if (type === 1) y = u >= 0 ? 1 - Math.exp(-u) : -0.8 * (1 - Math.exp(u / 0.8)); // diode
        else { const s = u < 0 ? -1 : 1; y = s * Math.min(0.85, 1 - Math.exp(-Math.abs(u))); } // fuzz, squared off
        lp += (y - lp) * lc;
        X[i] = (x * (1 - blend) + lp * comp * blend) * level;
      }
      d.lp[ch] = lp;
    }
  }

  // ---- A: dub delay

  runDub(inL, inR, outL, outR, n, bpm) {
    const e = this.dub, sr = this.sr;
    const time = this.p('dub.sync') >= 0.5 ? 60 / bpm * MIX_DIV_BEATS[Math.round(this.p('dub.div'))] : this.p('dub.time');
    const target = Math.min(2, Math.max(0.005, time)) * sr;
    const fb = this.p('dub.throw') >= 0.5 ? 1.08 : this.p('dub.fdbk');
    const lc = 1 - Math.exp(-MIX_TAU * this.p('dub.tone') / sr), hc = 1 - Math.exp(-MIX_TAU * 90 / sr);
    const wow = this.p('dub.wow') * 0.0025 * sr, sat = 1 + this.p('dub.sat') * 5;
    const glide = 1 - Math.exp(-1 / (0.15 * sr)); // tape: a new time glides, pitching what is in the loop
    if (!e.started) { e.started = true; e.d = target; }
    const flutter = this.p('dub.flutter');
    if (flutter > 0) { this.runDubFlutter(inL, inR, outL, outR, n, target, fb, lc, hc, wow, sat, glide, flutter); return; }
    for (let i = 0; i < n; i++) {
      e.d += (target - e.d) * glide;
      e.ph += 0.45 / sr; e.ph2 += 5.3 / sr;
      if (e.ph > 1) e.ph -= 1;
      if (e.ph2 > 1) e.ph2 -= 1;
      const w = wow * (Math.sin(MIX_TAU * e.ph) + 0.15 * Math.sin(MIX_TAU * e.ph2));
      const x = (inL[i] + inR[i]) * 0.5;
      for (let ch = 0; ch < 2; ch++) {
        const line = ch ? e.R : e.L;
        let y = line.read(Math.max(1, e.d * (ch ? 1.012 : 1) + (ch ? -w : w)));
        if (ch) { e.tR += (y - e.tR) * lc; e.hR += (e.tR - e.hR) * hc; y = e.tR - e.hR; }
        else { e.tL += (y - e.tL) * lc; e.hL += (e.tL - e.hL) * hc; y = e.tL - e.hL; }
        y = mixSoft(y * sat) / sat;
        line.push(x + y * fb);
        if (ch) outR[i] = y; else outL[i] = y;
      }
    }
    if (!Number.isFinite(e.tL + e.tR)) { e.L.buf.fill(0); e.R.buf.fill(0); e.tL = e.tR = e.hL = e.hR = 0; }
  }

  // the dub delay with Beads' wow and flutter in its loop: the same, with both sides' repeats through the transport
  // before they go round again (so each repeat wanders further than the one before)
  runDubFlutter(inL, inR, outL, outR, n, target, fb, lc, hc, wow, sat, glide, flutter) {
    const e = this.dub, sr = this.sr, wf = this.dubFlutter, o = this.miOut;
    wf.amount = flutter;
    wf.begin(n);
    for (let i = 0; i < n; i++) {
      e.d += (target - e.d) * glide;
      e.ph += 0.45 / sr; e.ph2 += 5.3 / sr;
      if (e.ph > 1) e.ph -= 1;
      if (e.ph2 > 1) e.ph2 -= 1;
      const w = wow * (Math.sin(MIX_TAU * e.ph) + 0.15 * Math.sin(MIX_TAU * e.ph2));
      const x = (inL[i] + inR[i]) * 0.5;
      let yL = e.L.read(Math.max(1, e.d + w)), yR = e.R.read(Math.max(1, e.d * 1.012 - w));
      e.tL += (yL - e.tL) * lc; e.hL += (e.tL - e.hL) * hc; yL = e.tL - e.hL;
      e.tR += (yR - e.tR) * lc; e.hR += (e.tR - e.hR) * hc; yR = e.tR - e.hR;
      wf.process(mixSoft(yL * sat) / sat, mixSoft(yR * sat) / sat, o);
      e.L.push(x + o[0] * fb); e.R.push(x + o[1] * fb);
      outL[i] = o[0]; outR[i] = o[1];
    }
    if (!Number.isFinite(e.tL + e.tR + o[0] + o[1])) { e.L.buf.fill(0); e.R.buf.fill(0); e.tL = e.tR = e.hL = e.hR = 0; wf.lpL = wf.lpR = 0; wf.lines[0].fill(0); wf.lines[1].fill(0); }
  }

  // ---- B: bucket-brigade delay

  runBbd(inL, inR, outL, outR, n, bpm) {
    const e = this.bbd, sr = this.sr;
    const time = this.p('bbd.sync') >= 0.5 ? 60 / bpm * MIX_DIV_BEATS[Math.round(this.p('bbd.div'))] : this.p('bbd.time');
    if (this.p('bbd.mode') >= 0.5) {
      // Beads' delay, its clock ticked at B's time
      if (!this.beads) this.beads = new MiBeadsDelay(sr);
      const p = this.beadsParams || (this.beadsParams = {});
      p.interval = Math.max(MI_MIN_DELAY, time * sr);
      p.density = this.p('bds.density'); p.multiply = this.p('bds.multiply'); p.shape = this.p('bds.shape');
      p.pitch = this.p('bds.pitch'); p.bandwidth = this.p('bds.filter'); p.feedback = Math.min(1, this.p('bbd.fdbk'));
      this.beads.process(inL, inR, outL, outR, n, p);
      if (!Number.isFinite(outL[n - 1] + outR[n - 1])) this.beads.clear();
      return;
    }
    const target = Math.min(0.6, Math.max(0.005, time)) * sr;
    const fb = this.p('bbd.fdbk'), age = this.p('bbd.age'), ping = this.p('bbd.ping') >= 0.5;
    const depth = this.p('bbd.mod') * 0.006 * sr, rate = this.p('bbd.rate');
    // the anti-alias and reconstruction filters close as the chip ages (and as the time gets longer, as on a real one)
    const fc = Math.max(1200, 9000 * (1 - age * 0.7) * Math.min(1, 0.12 * sr / Math.max(1, target)));
    const c = 1 - Math.exp(-MIX_TAU * fc / sr), grit = age * 0.004;
    const glide = 1 - Math.exp(-1 / (0.05 * sr));
    if (!e.started) { e.started = true; e.d = target; }
    for (let i = 0; i < n; i++) {
      e.d += (target - e.d) * glide;
      e.ph += rate / sr;
      if (e.ph > 1) e.ph -= 1;
      const tri = e.ph < 0.5 ? 4 * e.ph - 1 : 3 - 4 * e.ph;
      const x = (inL[i] + inR[i]) * 0.5;
      const out = [0, 0];
      for (let ch = 0; ch < 2; ch++) {
        const line = ch ? e.R : e.L;
        let y = line.read(Math.max(1, e.d + (ch ? -tri : tri) * depth));
        e.a1[ch] += (y - e.a1[ch]) * c; e.a2[ch] += (e.a1[ch] - e.a2[ch]) * c; y = e.a2[ch];
        e.seed = (e.seed * 1664525 + 1013904223) >>> 0;
        y = mixSoft(y * 1.2) / 1.2 + (e.seed / 4294967296 - 0.5) * grit * Math.abs(y); // grit rides the signal: silence stays silent
        out[ch] = y;
      }
      if (ping) { e.L.push(x + out[1] * fb); e.R.push(out[0] * fb); }
      else { e.L.push(x + out[0] * fb); e.R.push(x + out[1] * fb); }
      outL[i] = out[0]; outR[i] = out[1];
    }
    if (!Number.isFinite(e.a2[0] + e.a2[1])) { e.L.buf.fill(0); e.R.buf.fill(0); e.a1 = [0, 0]; e.a2 = [0, 0]; }
  }

  // ---- C: reverb, an eight-line feedback delay network

  makeReverb() {
    const sr = this.sr, max = Math.ceil(sr * 0.25);
    return {
      lines: Array.from({ length: 8 }, () => new MixLine(max)), lp: new Float64Array(8), pre: new MixLine(Math.ceil(sr * 0.25)),
      ap: [4.7, 3.6, 12.7, 9.3].map((ms) => new MixLine(Math.ceil(sr * ms / 1000) + 1)),
      apLen: [4.7, 3.6, 12.7, 9.3].map((ms) => Math.round(sr * ms / 1000)),
      disp: new Float64Array(16), // the spring's chirp: a chain of first-order all-passes
      ph: 0, x: new Float64Array(8), toneL: [0, 0], toneH: [0, 0],
      sh: new MixLine(Math.ceil(sr * 0.1)), shPh: 0, shLp: 0, fbL: 0, fbR: 0,
    };
  }

  runReverb(inL, inR, outL, outR, n) {
    const r = this.rev, sr = this.sr;
    const type = Math.round(this.p('rev.type')), size = this.p('rev.size'), freeze = this.p('rev.freeze') >= 0.5;
    if (type === 3) { this.runCloudsReverb(inL, inR, outL, outR, n); return; }
    // line lengths (ms) and decay range per type: spring, plate, hall
    const LEN = [[9.1, 11.3, 13.7, 15.1, 17.9, 19.3, 21.1, 23.7], [10.3, 12.9, 15.7, 18.1, 21.3, 23.9, 27.1, 30.7], [29.7, 37.1, 41.1, 43.7, 53.3, 59.9, 67.1, 73.9]][type];
    const RT = [[0.6, 4], [0.5, 6], [1.2, 12]][type];
    const scale = [1, 0.7 + size * 0.8, 0.6 + size * 1.4][type];
    const rt = RT[0] * Math.pow(RT[1] / RT[0], size);
    const lens = LEN.map((ms) => Math.min(r.lines[0].n - 2, ms * scale * sr / 1000));
    const gains = lens.map((l) => (freeze ? 1 : Math.pow(10, -3 * l / (rt * sr))));
    const dc = freeze ? 1 : 1 - Math.exp(-MIX_TAU * 12000 * Math.pow(0.06, this.p('rev.damp')) / sr);
    const pre = Math.max(1, this.p('rev.pre') * sr), shimmer = this.p('rev.shimmer');
    const tone = this.p('rev.tone');
    const tlc = tone < 0.5 ? 1 - Math.exp(-MIX_TAU * 1500 * Math.pow(13, tone * 2) / sr) : 1;
    const thc = tone > 0.5 ? 1 - Math.exp(-MIX_TAU * 20 * Math.pow(25, (tone - 0.5) * 2) / sr) : 0;
    const inGain = freeze ? 0 : 1, mod = type === 0 ? 0 : 0.0004 * sr;
    const x = r.x, sc = 1 / Math.sqrt(8);
    for (let i = 0; i < n; i++) {
      r.pre.push((inL[i] + inR[i]) * 0.5 * inGain);
      let u = r.pre.read(pre);
      // shimmer: the reverb an octave up (two taps sweeping a 50 ms window at twice the speed), back into its input
      if (shimmer > 0) {
        r.sh.push((r.fbL + r.fbR) * 0.5);
        r.shPh = (r.shPh + 1 / (0.05 * sr)) % 1;
        const win = 0.05 * sr, p1 = r.shPh, p2 = (r.shPh + 0.5) % 1;
        const s = r.sh.read(1 + (1 - p1) * win) * Math.sin(Math.PI * p1) + r.sh.read(1 + (1 - p2) * win) * Math.sin(Math.PI * p2);
        r.shLp += (s - r.shLp) * 0.3;
        u += r.shLp * shimmer * 0.6;
      }
      for (let a = 0; a < 4; a++) {
        const line = r.ap[a], d = line.read(r.apLen[a]), w = u + 0.6 * d;
        line.push(w);
        u = d - 0.6 * w;
      }
      if (type === 0) {
        // a spring disperses: highs arrive before lows, the chirp
        for (let a = 0; a < 16; a++) { const y = -0.62 * u + r.disp[a]; r.disp[a] = u + 0.62 * y; u = y; }
      }
      r.ph += 0.7 / sr;
      if (r.ph > 1) r.ph -= 1;
      const m = Math.sin(MIX_TAU * r.ph) * mod;
      for (let k = 0; k < 8; k++) {
        const y = r.lines[k].read(lens[k] + (k === 0 ? m : k === 4 ? -m : 0));
        r.lp[k] += (y - r.lp[k]) * dc;
        x[k] = r.lp[k] * gains[k];
      }
      // Hadamard mixing (fast, in place)
      for (let h = 1; h < 8; h *= 2) {
        for (let j = 0; j < 8; j += h * 2) {
          for (let q = j; q < j + h; q++) { const a = x[q], b = x[q + h]; x[q] = a + b; x[q + h] = a - b; }
        }
      }
      for (let k = 0; k < 8; k++) r.lines[k].push(mixSoft(x[k] * sc + u));
      let l = r.lp[0] - r.lp[2] + r.lp[4] - r.lp[6], rr = r.lp[1] - r.lp[3] + r.lp[5] - r.lp[7];
      r.fbL = l; r.fbR = rr;
      r.toneL[0] += (l - r.toneL[0]) * tlc; r.toneL[1] += (rr - r.toneL[1]) * tlc;
      l = r.toneL[0]; rr = r.toneL[1];
      if (thc > 0) { r.toneH[0] += (l - r.toneH[0]) * thc; r.toneH[1] += (rr - r.toneH[1]) * thc; l -= r.toneH[0]; rr -= r.toneH[1]; }
      outL[i] = l * 0.5; outR[i] = rr * 0.5;
    }
    if (!Number.isFinite(r.lp[0] + r.lp[7])) { for (const ln of r.lines) ln.buf.fill(0); r.lp.fill(0); r.disp.fill(0); }
  }

  // ---- C as CLOUDS: Beads' reverb (src/audio/mutable) in place of the delay network, with the same pre-delay, shimmer,
  // tone and freeze around it. SIZE is its time, as on Clouds (0.35 to 0.98), DAMP closes its loop's low-pass (0.97 to
  // 0.6); FREEZE holds it, the loop lossless and nothing coming in. The shimmer hears the last block's output.

  runCloudsReverb(inL, inR, outL, outR, n) {
    const r = this.rev, m = this.miReverb, sr = this.sr, L = this.miL, R = this.miR;
    const freeze = this.p('rev.freeze') >= 0.5, size = this.p('rev.size'), damp = this.p('rev.damp');
    m.mix = 1;
    m.time = freeze ? 1 : 0.35 + 0.63 * size;
    m.lpCoefficient = freeze ? 1 : 0.97 - 0.37 * damp;
    const pre = Math.max(1, this.p('rev.pre') * sr), shimmer = this.p('rev.shimmer'), tone = this.p('rev.tone');
    const tlc = tone < 0.5 ? 1 - Math.exp(-MIX_TAU * 1500 * Math.pow(13, tone * 2) / sr) : 1;
    const thc = tone > 0.5 ? 1 - Math.exp(-MIX_TAU * 20 * Math.pow(25, (tone - 0.5) * 2) / sr) : 0;
    const inGain = freeze ? 0 : 1;
    for (let i = 0; i < n; i++) {
      r.pre.push((inL[i] + inR[i]) * 0.5 * inGain);
      let u = r.pre.read(pre);
      if (shimmer > 0) {
        r.shPh = (r.shPh + 1 / (0.05 * sr)) % 1;
        const win = 0.05 * sr, p1 = r.shPh, p2 = (r.shPh + 0.5) % 1;
        const s = r.sh.read(1 + (1 - p1) * win) * Math.sin(Math.PI * p1) + r.sh.read(1 + (1 - p2) * win) * Math.sin(Math.PI * p2);
        r.shLp += (s - r.shLp) * 0.3;
        u += r.shLp * shimmer * 0.6;
      }
      L[i] = u; R[i] = u;
    }
    m.process(L, R, n);
    for (let i = 0; i < n; i++) {
      let l = L[i] * CLOUDS_GAIN, rr = R[i] * CLOUDS_GAIN;
      r.sh.push((l + rr) * 0.5);
      r.toneL[0] += (l - r.toneL[0]) * tlc; r.toneL[1] += (rr - r.toneL[1]) * tlc;
      l = r.toneL[0]; rr = r.toneL[1];
      if (thc > 0) { r.toneH[0] += (l - r.toneH[0]) * thc; r.toneH[1] += (rr - r.toneH[1]) * thc; l -= r.toneH[0]; rr -= r.toneH[1]; }
      outL[i] = l; outR[i] = rr;
    }
    if (!Number.isFinite(L[n - 1] + R[n - 1])) m.clear();
  }

  // ---- D: chorus, after the Juno's: two taps on one line, swept in opposite directions; or ENSEMBLE, Rings'

  runChorus(inL, inR, outL, outR, n) {
    const e = this.cho, sr = this.sr, mode = Math.round(this.p('cho.mode'));
    if (mode === 3) {
      // Rings' ensemble, wet only (the dry stays on its strip): RATE scales its LFOs, DEPTH their sweep, WIDTH as below
      const en = this.miEnsemble, w = this.p('cho.width');
      en.setDepth(this.p('cho.depth'));
      en.rate = Math.pow(4, (this.p('cho.rate') - 0.5) * 2);
      for (let i = 0; i < n; i++) { outL[i] = inL[i]; outR[i] = inR[i]; }
      en.process(outL, outR, n, true);
      for (let i = 0; i < n; i++) {
        const l = outL[i], r = outR[i];
        outL[i] = l * (1 + w) / 2 + r * (1 - w) / 2;
        outR[i] = r * (1 + w) / 2 + l * (1 - w) / 2;
      }
      return;
    }
    const rate = [0.513, 0.863, 9.75][mode] * Math.pow(4, (this.p('cho.rate') - 0.5) * 2);
    const depth = [1.85, 1.85, 0.3][mode] * 2 * this.p('cho.depth') * sr / 1000;
    const centre = 3.5 * sr / 1000, w = this.p('cho.width');
    const c = 1 - Math.exp(-MIX_TAU * 9000 / sr);
    for (let i = 0; i < n; i++) {
      e.line.push((inL[i] + inR[i]) * 0.5);
      e.ph += rate / sr;
      if (e.ph > 1) e.ph -= 1;
      const tri = e.ph < 0.5 ? 4 * e.ph - 1 : 3 - 4 * e.ph;
      const a = e.line.read(centre + tri * depth), b = e.line.read(centre - tri * depth);
      e.lp[0] += (a - e.lp[0]) * c; e.lp[1] += (b - e.lp[1]) * c;
      const l = e.lp[0], r = e.lp[1];
      outL[i] = l * (1 + w) / 2 + r * (1 - w) / 2;
      outR[i] = r * (1 + w) / 2 + l * (1 - w) / 2;
    }
  }

  // ---- the master compressor

  runComp(L, R, keyL, keyR, n) {
    const e = this.cmp, sr = this.sr;
    const thr = this.p('cmp.thresh'), ratio = this.p('cmp.ratio'), knee = 6;
    const atk = 1 - Math.exp(-1 / (this.p('cmp.atk') / 1000 * sr)), rel = 1 - Math.exp(-1 / (this.p('cmp.rel') / 1000 * sr));
    const makeup = this.p('cmp.makeup'), mix = this.p('cmp.mix');
    const hc = 1 - Math.exp(-MIX_TAU * this.p('cmp.hpf') / sr);
    let minGr = 0;
    for (let i = 0; i < n; i++) {
      const k = keyL ? (keyL[i] + keyR[i]) * 0.5 : (L[i] + R[i]) * 0.5;
      e.hp += (k - e.hp) * hc;
      const kx = Math.abs(k - e.hp);
      const lvl = 20 * Math.log10(kx + 1e-9), over = lvl - thr, slope = 1 / ratio - 1;
      const want = over <= -knee / 2 ? 0 : over < knee / 2 ? slope * (over + knee / 2) * (over + knee / 2) / (2 * knee) : slope * over;
      e.gr += (want - e.gr) * (want < e.gr ? atk : rel);
      if (e.gr < minGr) minGr = e.gr;
      const g = Math.pow(10, (e.gr + makeup) / 20), wet = mix * g + (1 - mix);
      L[i] *= wet; R[i] *= wet;
    }
    if (minGr < e.minGr) e.minGr = minGr; // the deepest since the meters were last read
  }

  // ---- the tape: the master driven into a soft curve, a little lop-sided (tape's even harmonics), half the drive
  // given back, so quiet passages come up a little and peaks are rounded; then tape's loss of highs (TONE) and a DC
  // blocker for the lop-side. At 0 dB of drive the master passes untouched.

  runTape(L, R, n) {
    const drive = this.p('tape.drive');
    if (drive <= 0) return;
    const t = this.tape, g = Math.pow(10, drive / 20), out = 1 / Math.sqrt(g), bias = 0.1, off = Math.tanh(bias);
    const fc = Math.min(20000 * Math.pow(0.3, this.p('tape.tone')), this.sr * 0.45);
    const a = 1 - Math.exp(-2 * Math.PI * fc / this.sr), dc = 1 - Math.exp(-2 * Math.PI * 10 / this.sr);
    for (let i = 0; i < n; i++) {
      const l = (Math.tanh(L[i] * g + bias) - off) * out, r = (Math.tanh(R[i] * g + bias) - off) * out;
      t.lpL += (l - t.lpL) * a; t.lpR += (r - t.lpR) * a;
      t.dcL += (t.lpL - t.dcL) * dc; t.dcR += (t.lpR - t.dcR) * dc;
      L[i] = t.lpL - t.dcL; R[i] = t.lpR - t.dcR;
    }
  }

  // ---- a block: every part's bus in, the master out

  process(partL, partR, outL, outR, n, bpm) {
    const v = this.v, NS = this.strips.length;
    this.mixL.fill(0, 0, n); this.mixR.fill(0, 0, n);
    for (let j = 0; j < 4; j++) {
      this.busL[j].set(this.carryL[j].subarray(0, n)); this.busR[j].set(this.carryR[j].subarray(0, n));
      this.carryL[j].fill(0, 0, n); this.carryR[j].fill(0, 0, n);
    }
    let soloed = false;
    for (let s = 0; s < NS; s++) if (v[s * S_NP + S_SOLO] >= 0.5) { soloed = true; break; }
    const drivePart = Math.round(this.p('drv.part')) - 1;
    for (let p = 0; p < this.parts; p++) {
      let L = partL[p], R = partR[p];
      if (p === drivePart) {
        this.tmpL.set(L.subarray(0, n)); this.tmpR.set(R.subarray(0, n));
        L = this.tmpL; R = this.tmpR;
        this.runDrive(L, R, n);
      }
      this.runStrip(p, L, R, n, soloed, this.busL, this.busR);
    }
    if (this.p('master.limit') >= 0.5) {
      for (let j = 0; j < 4; j++) for (let i = 0; i < n; i++) { this.busL[j][i] = mixSoft(this.busL[j][i]); this.busR[j][i] = mixSoft(this.busR[j][i]); }
    }
    const bpmv = bpm || 120;
    this.runDub(this.busL[0], this.busR[0], this.retL[0], this.retR[0], n, bpmv);
    this.runBbd(this.busL[1], this.busR[1], this.retL[1], this.retR[1], n, bpmv);
    this.runReverb(this.busL[2], this.busR[2], this.retL[2], this.retR[2], n);
    this.runChorus(this.busL[3], this.busR[3], this.retL[3], this.retR[3], n);
    for (let r = 0; r < 4; r++) this.runStrip(this.parts + r, this.retL[r], this.retR[r], n, soloed, this.carryL, this.carryR);
    const key = Math.round(this.p('cmp.key')) - 1;
    if (this.p('cmp.ratio') > 1.001) this.runComp(this.mixL, this.mixR, key >= 0 ? partL[key] : null, key >= 0 ? partR[key] : null, n);
    this.runTape(this.mixL, this.mixR, n);
    if (this.p('tape.wow') > 0) {
      const wf = this.tapeWow, o = this.miOut;
      wf.amount = this.p('tape.wow');
      wf.begin(n);
      for (let i = 0; i < n; i++) { wf.process(this.mixL[i], this.mixR[i], o); this.mixL[i] = o[0]; this.mixR[i] = o[1]; }
    }
    const target = this.p('master.fader'), d = (target - this.masterG) / n;
    let g = this.masterG, pl = this.peak[0], pr = this.peak[1], ml = this.masterSq[0], mr = this.masterSq[1];
    for (let i = 0; i < n; i++) {
      g += d;
      // the ceiling: untouched up to 0.9, then bends into 1
      let l = this.mixL[i] * g, r = this.mixR[i] * g;
      const al = Math.abs(l), ar = Math.abs(r);
      if (al > 0.9) l = Math.sign(l) * (0.9 + 0.099 * Math.tanh((al - 0.9) / 0.099));
      if (ar > 0.9) r = Math.sign(r) * (0.9 + 0.099 * Math.tanh((ar - 0.9) / 0.099));
      outL[i] = l; outR[i] = r;
      if (al > pl) pl = al;
      if (ar > pr) pr = ar;
      ml += l * l; mr += r * r;
    }
    this.masterG = target;
    this.peak[0] = pl; this.peak[1] = pr;
    this.masterSq[0] = ml; this.masterSq[1] = mr; this.masterCount += n;
  }

  // Peaks and RMS since the last call (then cleared): per strip [L, R], the master [L, R], and the compressor's
  // deepest reduction (dB).
  meters() {
    const strips = new Float32Array(this.strips.length * 2), rms = new Float32Array(this.strips.length * 2);
    this.strips.forEach((st, s) => {
      strips[s * 2] = st.peakL; strips[s * 2 + 1] = st.peakR;
      const c = Math.max(1, st.count);
      rms[s * 2] = Math.sqrt(st.sqL / c); rms[s * 2 + 1] = Math.sqrt(st.sqR / c);
      st.peakL = 0; st.peakR = 0; st.sqL = 0; st.sqR = 0; st.count = 0;
    });
    const mc = Math.max(1, this.masterCount);
    const out = { strips, rms, master: [this.peak[0], this.peak[1]], masterRms: [Math.sqrt(this.masterSq[0] / mc), Math.sqrt(this.masterSq[1] / mc)], gr: this.cmp.minGr };
    this.peak = [0, 0];
    this.masterSq = [0, 0]; this.masterCount = 0;
    this.cmp.minGr = 0;
    return out;
  }
}
`;
