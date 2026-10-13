export const PIPE_NAME = 'moa-pipe';
export const SPRING_NAME = 'moa-spring';

/**
 * The MOA-PIPE engine and the spring reverb, as the source text of an audio worklet module. Like the granular
 * engine it is a string, so the app needs no extra build step, and tests evaluate the same text to get `PipeCore`
 * and `SpringCore`: what they check is what ships. (A tight feedback loop shorter than 128 samples cannot be built
 * from DelayNodes, hence a worklet.)
 *
 * PipeCore is eight voices of a physical model. No oscillators:
 *   steam   noise or DC pressure -> low-pass (cutoff follows the note and the envelope) -> ADSR -> gain
 *   pipe    a tuned delay with feedback. Inside the loop: polarity, high-pass, low-pass, dispersion (stiffness,
 *           and a "split" mode with two unequal sections for bells), a saturator (soft to hard, symmetric to
 *           asymmetric). Feedback gain comes from a decay time while the key is held and a release time after.
 *   push    the steam is multiplied by (1 + push * pipe contents): blowing harder when the pipe is "full", which
 *           lets the loop oscillate on its own (flutes, reeds) instead of just ringing.
 * The loop length is sr / f0 minus the delay the filters and dispersion add at f0, so a note stays in tune whatever
 * the tone settings; HP and LP "comp" fade that compensation out for the quirks of an overblown, out-of-tune pipe.
 * One LFO is shared by the voices (pitch, filter, steam, saturation or push). Modes: poly, mono, unison (with
 * glide, legato and detune), a sustain pedal, pitch bend and a mod wheel that adds to the LFO amount.
 *
 * SpringCore is a mono-in, stereo-out spring reverb: two springs of slightly different length. Each is a feedback
 * loop around a delay and a long chain of allpass filters (that chain is what makes the "drip": high frequencies
 * arrive before lows), with a tilt filter and damping in the loop, and a saturating "dwell" drive at the input.
 */
export const PIPE_SOURCE = `
const VOICES = 8;
const LINE = 16384;
const MASK = LINE - 1;
const CHUNK = 32;
const DRIVE = 1.3;
const INV_DRIVE = 1 / DRIVE;
const STAGES = 4;
const TWO_PI = Math.PI * 2;
const LN1000 = 6.907755278982137; // ln(10^3): a 60 dB fall

const PIPE_DEFAULTS = {
  atk: 0.005, dec: 0.3, sus: 0.8, rel: 0.3, envKey: 0, vel: 0.5, legato: 0,
  noise: 0.5, nCut: 100, nRes: 0.2, nKey: 0.5, nEnv: 0, onePole: 0, gain: 0.7,
  tune: 0, fine: 0, harm: 0, split: 0, splitPt: 0.5, pol: 0,
  fbDec: 2, fbRel: 0.4, push: 0, satHard: 0.3, satSym: 0,
  hp: -12, lp: 36, hpComp: 1, lpComp: 1,
  mode: 0, detune: 12, glide: 0.1, glideOn: 0, spread: 0.5, volume: 0.8,
  lfoRate: 5, lfoShape: 0, lfoDelay: 0, lfoAmt: 0, lfoDest: 0,
  bend: 0, mod: 0,
};

function midiHz(m) { return 440 * Math.pow(2, (m - 69) / 12); }

// Phase delay, in samples, of the loop's filters at angular frequency w (so the loop length can compensate).
function atan2f(y, x) { return Math.atan2(y, x); }
function delayLowpass(a, w) { // y += a (x - y)
  const b = 1 - a;
  return atan2f(b * Math.sin(w), 1 - b * Math.cos(w)) / w;
}
function delayHighpass(a, w) { // x - lowpass(x)
  const b = 1 - a;
  return -((Math.PI - w) / 2 - atan2f(b * Math.sin(w), 1 - b * Math.cos(w))) / w;
}
function delayAllpass(c, w) { // (c + z^-1) / (1 + c z^-1)
  let ph = atan2f(-Math.sin(w), c + Math.cos(w)) - atan2f(-c * Math.sin(w), 1 + c * Math.cos(w));
  while (ph > 0) ph -= TWO_PI;
  while (ph < -TWO_PI) ph += TWO_PI;
  return -ph / w;
}

class PipeVoice {
  constructor() {
    this.buf = new Float32Array(LINE);
    this.apX = new Float64Array(STAGES * 2);
    this.apY = new Float64Array(STAGES * 2);
    this.reset();
  }
  reset() {
    this.buf.fill(0);
    this.apX.fill(0);
    this.apY.fill(0);
    this.w = 0;
    this.interp = 0;
    this.lpS = 0; this.hpS = 0;
    this.s1 = 0; this.s2 = 0; this.pS = 0;
    this.dcX = 0; this.dcY = 0;
    this.active = false; this.gate = false; this.key = false; this.sustained = false;
    this.note = 60; this.target = 60; this.pitch = 60; this.cents = 0;
    this.vel = 1; this.stage = 0; this.env = 0; this.seq = 0;
    this.D = 100; this.g = 0.9; this.fresh = true; this.peak = 0;
  }
}

class PipeCore {
  constructor(sampleRate, random) {
    this.sr = sampleRate;
    this.rnd = random || Math.random;
    this.voices = [];
    for (let i = 0; i < VOICES; i++) this.voices.push(new PipeVoice());
    this.seq = 0;
    this.stack = [];
    this.pedal = false;
    this.mode = 0;
    this.lfoPhase = 0; this.lfoHeld = 0; this.lfoSh = 0; this.lfoFade = 0;
    this.nz = 1;
  }

  get activeVoices() {
    let n = 0;
    for (const v of this.voices) if (v.active) n++;
    return n;
  }

  voiceFor(note) {
    for (const v of this.voices) if (v.active && v.key && v.note === note) return v;
    return null;
  }

  // ---- notes ----

  start(v, note, velocity, retrigger, glide, cents) {
    if (!v.active) v.reset(); // an idle voice starts from a clean slate
    this.seq += 1;
    v.seq = this.seq;
    v.cents = cents;
    v.vel = velocity;
    v.note = note;
    v.target = note;
    if (!glide) v.pitch = note;
    if (retrigger) v.stage = 1;
    v.active = true;
    v.gate = true; v.key = true; v.sustained = false;
  }

  release(v) {
    v.key = false;
    if (this.pedal) { v.sustained = true; return; }
    v.gate = false;
    if (v.stage > 0) v.stage = 3;
  }

  unisonCents(i, count, detune) {
    return count > 1 ? detune * ((i / (count - 1)) * 2 - 1) : 0;
  }

  noteOn(note, velocity, p) {
    const mode = p ? Math.round(p.mode) : this.mode;
    this.mode = mode;
    const detune = p ? p.detune : 12;
    const glideOn = p ? p.glideOn > 0.5 : false;
    const legato = p ? p.legato > 0.5 : false;
    if (mode === 0) {
      let pick = null;
      for (const v of this.voices) if (!v.active) { pick = v; break; }
      if (!pick) {
        // steal: the released voice that has rung longest, else the oldest sounding one
        let best = Infinity;
        for (const v of this.voices) if (!v.gate && v.seq < best) { best = v.seq; pick = v; }
        if (!pick) for (const v of this.voices) if (v.seq < best) { best = v.seq; pick = v; }
        pick.reset();
      }
      pick.reset();
      this.start(pick, note, velocity, true, false, 0);
      return;
    }
    // mono and unison: a note stack, last note wins, overlapping notes glide (and keep the envelope if legato)
    const stackWasEmpty = this.stack.length === 0;
    this.stack = this.stack.filter((s) => s.note !== note);
    this.stack.push({ note, velocity });
    const used = mode === 1 ? 1 : VOICES;
    for (let i = 0; i < used; i++) {
      const v = this.voices[i];
      const sounding = v.active && v.gate;
      const retrigger = stackWasEmpty || !legato || !sounding;
      this.start(v, note, velocity, retrigger, glideOn && sounding, this.unisonCents(i, used, detune));
    }
  }

  noteOff(note) {
    if (this.mode === 0) {
      for (const v of this.voices) if (v.active && v.key && v.note === note) this.release(v);
      return;
    }
    this.stack = this.stack.filter((s) => s.note !== note);
    const used = this.mode === 1 ? 1 : VOICES;
    if (this.stack.length > 0) {
      const top = this.stack[this.stack.length - 1];
      for (let i = 0; i < used; i++) {
        const v = this.voices[i];
        v.target = top.note; v.note = top.note;
      }
      return;
    }
    for (let i = 0; i < used; i++) if (this.voices[i].active) this.release(this.voices[i]);
  }

  allNotesOff() {
    this.stack = [];
    this.pedal = false;
    for (const v of this.voices) if (v.active && v.gate) { v.key = false; v.sustained = false; v.gate = false; v.stage = 3; }
  }

  sustainPedal(down) {
    this.pedal = down;
    if (!down) {
      for (const v of this.voices) if (v.sustained) { v.sustained = false; v.gate = false; if (v.stage > 0) v.stage = 3; }
    }
  }

  // ---- sound ----

  lfoValue(p, n) {
    const rate = p.lfoRate;
    this.lfoPhase += (rate * n) / this.sr;
    let crossed = false;
    if (this.lfoPhase >= 1) { this.lfoPhase -= Math.floor(this.lfoPhase); crossed = true; }
    const ph = this.lfoPhase;
    switch (Math.round(p.lfoShape)) {
      case 1: return ph < 0.5 ? ph * 4 - 1 : 3 - ph * 4;
      case 2: return ph < 0.5 ? 1 : -1;
      case 3: return ph * 2 - 1;
      case 4:
        if (crossed || this.lfoSh === 0) this.lfoSh = this.rnd() * 2 - 1;
        return this.lfoSh;
      default: return Math.sin(ph * TWO_PI);
    }
  }

  process(outL, outR, n, p) {
    outL.fill(0, 0, n);
    outR.fill(0, 0, n);
    const sr = this.sr;
    const anyHeld = this.voices.some((v) => v.active && v.key);
    if (anyHeld && this.lfoHeld === 0) this.lfoFade = 0;
    this.lfoHeld = anyHeld ? 1 : 0;

    const modeRound = Math.round(p.mode);
    const modeLevel = modeRound === 1 ? 0.8 : modeRound === 2 ? 0.28 : 0.5;
    const spread = p.spread;
    for (let s = 0; s < n; s += CHUNK) {
      const m = Math.min(CHUNK, n - s);
      // shared LFO, faded in after the delay
      const lfoRaw = this.lfoValue(p, m);
      if (anyHeld) this.lfoFade = p.lfoDelay <= 0 ? 1 : Math.min(1, this.lfoFade + m / (p.lfoDelay * sr));
      const amt = Math.min(1, p.lfoAmt + p.mod) * this.lfoFade;
      const l = lfoRaw * amt;
      const dest = Math.round(p.lfoDest);
      const mods = {
        pitch: dest === 0 ? l * 1.5 : 0,
        hp: dest === 1 ? l * 12 : 0,
        lp: dest === 1 ? l * 24 : 0,
        steam: dest === 2 ? l * 0.8 : 0,
        sat: dest === 3 ? l * 0.5 : 0,
        push: dest === 4 ? l * 0.5 : 0,
      };
      for (let vi = 0; vi < VOICES; vi++) {
        const v = this.voices[vi];
        if (!v.active) continue;
        const pan = VOICES > 1 ? (vi / (VOICES - 1)) * 2 - 1 : 0;
        const ang = (pan * spread * 0.5 + 0.5) * (Math.PI / 2);
        this.voiceChunk(v, m, p, mods, Math.cos(ang) * modeLevel * p.volume, Math.sin(ang) * modeLevel * p.volume, outL, outR, s);
      }
    }
  }

  voiceChunk(v, m, p, mods, gL, gR, outL, outR, off) {
    const sr = this.sr;
    // pitch, with glide
    if (p.glideOn > 0.5 && p.glide > 0.001) v.pitch += (v.target - v.pitch) * (1 - Math.exp(-m / (p.glide * sr / 4.6)));
    else v.pitch = v.target;
    const semis = v.pitch + v.cents / 100 + p.tune + p.fine / 100 + p.bend + mods.pitch;
    let f0 = midiHz(semis);
    if (f0 < 12) f0 = 12;
    if (f0 > sr * 0.3) f0 = sr * 0.3;
    const w0 = (TWO_PI * f0) / sr;

    // loop filters, positioned relative to the fundamental
    let hpHz = f0 * Math.pow(2, (p.hp + mods.hp) / 12);
    let lpHz = f0 * Math.pow(2, (p.lp + mods.lp) / 12);
    hpHz = Math.min(Math.max(hpHz, 4), sr * 0.45);
    lpHz = Math.min(Math.max(lpHz, 30), sr * 0.45);
    const aH = 1 - Math.exp((-TWO_PI * hpHz) / sr);
    const aL = 1 - Math.exp((-TWO_PI * lpHz) / sr);

    // dispersion: stiffness (harm), or two unequal sections in split mode. Each allpass has its corner a set
    // number of fundamentals up the spectrum, so the stretching of the partials is the same on every key.
    const half = STAGES / 2;
    const period = (p.pol > 0.5 ? 0.5 : 1) * (sr / f0);
    const corner = (k) => Math.min(0, (Math.tan(Math.min(1.5, (Math.PI * k * f0) / sr)) - 1) / (Math.tan(Math.min(1.5, (Math.PI * k * f0) / sr)) + 1));
    let c1 = 0, c2 = 0;
    if (p.split > 0.5) {
      const kBase = 5 - 3 * p.harm;
      c1 = corner(kBase * 2 * p.splitPt);
      c2 = corner(kBase * 2 * (1 - p.splitPt));
    } else if (p.harm > 0.001) {
      c1 = c2 = corner(14 - 11.5 * p.harm);
    }
    let dispDelay = half * delayAllpass(c1, w0) + half * delayAllpass(c2, w0);
    for (let it = 0; it < 6 && dispDelay > 0.7 * period; it++) { // never let the dispersion eat the loop
      c1 *= 0.7; c2 *= 0.7;
      dispDelay = half * delayAllpass(c1, w0) + half * delayAllpass(c2, w0);
    }

    // the loop's total delay, less what the filters and dispersion add at f0
    const comp = delayLowpass(aL, w0) * p.lpComp + delayHighpass(aH, w0) * p.hpComp + dispDelay;
    // an inverted loop rings an octave low (a closed pipe), so it is half as long to keep the pitch: odd harmonics
    let Dt = period - comp;
    if (Dt < 2.6) Dt = 2.6;
    if (Dt > LINE - 8) Dt = LINE - 8;
    if (v.fresh) { v.D = Dt; v.fresh = false; }

    // feedback gain: a decay time while held, a release time after
    // Decay is the ring time of the fundamental, so divide out what the loop's own filters take away at f0.
    // The cap keeps the loop gain under one at every frequency, so the pipe can only sing through Push.
    const T = Math.max(0.01, v.gate ? p.fbDec : p.fbRel);
    const loopAt = (TWO_PI * f0) / sr;
    const cosw = Math.cos(loopAt);
    const bH = 1 - aH;
    const bL = 1 - aL;
    const magHp = (bH * Math.sqrt(2 - 2 * cosw)) / Math.sqrt(1 + bH * bH - 2 * bH * cosw);
    const magLp = aL / Math.sqrt(1 + bL * bL - 2 * bL * cosw);
    // The loop's gain is highest somewhere near the passband's middle; keep g times that peak just under one,
    // so the pipe cannot grow at any frequency. (Capping g at one instead made high notes die far too fast.)
    let peakMag = magHp * magLp;
    const lowHz = Math.max(8, hpHz * 0.5);
    const highHz = Math.min(sr * 0.49, lpHz * 2);
    for (let k = 0; k < 12; k++) {
      const wk = (TWO_PI * lowHz * Math.pow(highHz / lowHz, k / 11)) / sr;
      const ck = Math.cos(wk);
      const hpk = (bH * Math.sqrt(2 - 2 * ck)) / Math.sqrt(1 + bH * bH - 2 * bH * ck);
      const lpk = aL / Math.sqrt(1 + bL * bL - 2 * bL * ck);
      if (hpk * lpk > peakMag) peakMag = hpk * lpk;
    }
    const gT = Math.min(0.99995 / Math.max(0.05, peakMag), Math.exp((-LN1000 * Dt) / (sr * T)) / Math.max(0.05, magHp * magLp));
    v.g += (gT - v.g) * 0.15;

    // steam: envelope times scale with the note, level with velocity
    const scale = Math.pow(2, (-p.envKey * (v.note - 60)) / 12);
    const atkRate = 1 / Math.max(2, p.atk * scale * sr);
    const decC = 1 - Math.exp(-4.6 / Math.max(2, p.dec * scale * sr));
    const relC = 1 - Math.exp(-4.6 / Math.max(2, p.rel * scale * sr));
    const velScale = 1 - p.vel + p.vel * v.vel;
    const steamGain = p.gain * velScale * Math.max(0, 1 + mods.steam);

    // steam low-pass: cutoff in MIDI pitch, follows the key and the envelope
    const cutNote = p.nCut + p.nKey * (v.note - 60) + p.nEnv * v.env;
    let cutHz = midiHz(Math.min(Math.max(cutNote, 0), 150));
    cutHz = Math.min(cutHz, sr * 0.45);
    const onePole = p.onePole > 0.5;
    const wc = (TWO_PI * cutHz) / sr;
    let b0 = 0, b1 = 0, b2 = 0, a1 = 0, a2 = 0, aOne = 0;
    if (onePole) {
      aOne = 1 - Math.exp(-wc);
    } else {
      const q = 0.5 + p.nRes * 7;
      const alpha = Math.sin(wc) / (2 * q);
      const cs = Math.cos(wc);
      const a0 = 1 + alpha;
      b0 = (1 - cs) / 2 / a0; b1 = (1 - cs) / a0; b2 = b0;
      a1 = (-2 * cs) / a0; a2 = (1 - alpha) / a0;
    }

    // saturator and push
    const hard = Math.min(1, Math.max(0, p.satHard + mods.sat));
    const bias = p.satSym * 0.5;
    const yb = Math.tanh(bias) + (Math.max(-1, Math.min(1, bias)) - Math.tanh(bias)) * hard;
    const push = Math.max(0, p.push + mods.push);
    const pol = p.pol > 0.5 ? -1 : 1;
    const pAc = 1 - Math.exp((-TWO_PI * Math.max(3, f0 * 0.1)) / sr);
    const noiseMix = p.noise;
    const sus = p.sus;

    const buf = v.buf;
    let w = v.w;
    const aps = v.apX;
    const apy = v.apY;
    for (let i = 0; i < m; i++) {
      // envelope
      switch (v.stage) {
        case 1: v.env += atkRate; if (v.env >= 1) { v.env = 1; v.stage = 2; } break;
        case 2: v.env += (sus - v.env) * decC; break;
        case 3: v.env -= v.env * relC; if (v.env < 0.00002) { v.env = 0; v.stage = 0; } break;
        default: break;
      }
      // steam source and filter
      const src = (1 - noiseMix) + noiseMix * (this.rnd() * 2 - 1);
      let sl;
      if (onePole) {
        v.s1 += aOne * (src - v.s1);
        sl = v.s1;
      } else {
        sl = b0 * src + v.s1;
        v.s1 = b1 * src - a1 * sl + v.s2;
        v.s2 = b2 * src - a2 * sl;
      }
      const e = sl * v.env * steamGain;

      // read the pipe, with allpass interpolation of the fractional delay
      v.D += (Dt - v.D) * 0.004;
      const ii = Math.floor(v.D - 0.5);
      const frac = v.D - ii;
      const eta = (1 - frac) / (1 + frac);
      const idx = (w - ii) & MASK;
      const x0 = buf[idx];
      const x1 = buf[(idx - 1) & MASK];
      const p0 = eta * (x0 - v.interp) + x1;
      v.interp = p0;

      // the loop: polarity, high-pass, low-pass, dispersion
      let fb = p0 * pol;
      v.hpS += aH * (fb - v.hpS);
      fb -= v.hpS;
      v.lpS += aL * (fb - v.lpS);
      fb = v.lpS;
      for (let k = 0; k < STAGES; k++) {
        const c = k < half ? c1 : c2;
        const y = c * fb + aps[k] - c * apy[k];
        aps[k] = fb;
        apy[k] = y;
        fb = y;
      }

      // push-pull: the steam is pushed or pulled by the pipe's contents (without the DC the steam itself adds)
      v.pS += pAc * (p0 - v.pS);
      const x = e * (1 + push * pol * (p0 - v.pS)) + v.g * fb;
      // saturator: soft (tanh) to hard (clip), optionally biased for even harmonics. Normalised so small
      // signals pass at unity gain, which keeps the loop's gain below one (so it decays unless pushed).
      const sdr = x * DRIVE + bias;
      const ys = Math.tanh(sdr);
      const yh = sdr > 1 ? 1 : sdr < -1 ? -1 : sdr;
      let y = (ys + (yh - ys) * hard - yb) * INV_DRIVE;
      y += 1e-20 * (1 - 2 * (i & 1));
      buf[w] = y;
      w = (w + 1) & MASK;

      // output: block DC from the steam
      const o = y - v.dcX + 0.9993 * v.dcY;
      v.dcX = y; v.dcY = o;
      outL[off + i] += o * gL;
      outR[off + i] += o * gR;
      const a = Math.abs(y);
      v.peak = a > v.peak ? a : v.peak * 0.9995;
    }
    v.w = w;
    if (v.stage === 0 && !v.gate && v.peak < 0.00001) v.active = false;
  }
}

// ---------------------------------------------------------------- spring reverb

const SPRING_DEFAULTS = { tension: 0.5, drip: 0.6, decay: 2, tilt: 0, dwell: 0.4 };
const SPRING_LINE = 65536;
const SPRING_MASK = SPRING_LINE - 1;
const SPRING_STAGES = 96;

class Spring {
  constructor(sr, scale, dripScale) {
    this.sr = sr;
    this.scale = scale;
    this.dripScale = dripScale;
    this.buf = new Float32Array(SPRING_LINE);
    this.w = 0;
    this.px = new Float64Array(SPRING_STAGES);
    this.py = new Float64Array(SPRING_STAGES);
    this.lp = 0; this.tl = 0; this.drive = 0;
    this.g = 0.8;
    this.D = 0;
  }

  // x is the (dwell-driven) input sample; returns the wet sample
  tick(x, c, g, gl, gh, aTilt, aDamp, D) {
    this.D += (D - this.D) * 0.002;
    const d = this.D;
    const ii = Math.floor(d);
    const fr = d - ii;
    const idx = (this.w - ii) & SPRING_MASK;
    const a = this.buf[idx];
    const b = this.buf[(idx - 1) & SPRING_MASK];
    let y = a + (b - a) * fr;
    // dispersion: the drip
    for (let k = 0; k < SPRING_STAGES; k++) {
      const o = c * y + this.px[k] - c * this.py[k];
      this.px[k] = y;
      this.py[k] = o;
      y = o;
    }
    const wet = y;
    // tilt and damping inside the loop
    this.tl += aTilt * (y - this.tl);
    y = this.tl * gl + (y - this.tl) * gh;
    this.lp += aDamp * (y - this.lp);
    y = this.lp;
    this.buf[this.w] = x + g * y + 1e-20 * (1 - 2 * (this.w & 1));
    this.w = (this.w + 1) & SPRING_MASK;
    return wet;
  }
}

class SpringCore {
  constructor(sampleRate) {
    this.sr = sampleRate;
    this.a = new Spring(sampleRate, 1, 1);
    this.b = new Spring(sampleRate, 1.09, 0.92);
    this.dcA = 0; this.dcB = 0;
  }

  process(input, outL, outR, n, p) {
    const sr = this.sr;
    const tension = Math.min(1, Math.max(0, p.tension));
    const drip = Math.min(1, Math.max(0, p.drip));
    const decay = Math.max(0.1, p.decay);
    const tilt = Math.min(1, Math.max(-1, p.tilt));
    const k = 0.6 + 5 * Math.min(1, Math.max(0, p.dwell));
    const norm = 1 / Math.sqrt(k);
    // a tight spring is short and quick; a slack one is long and slow
    const base = (0.012 + 0.058 * (1 - tension)) * sr;
    const gl = 1 - 0.07 * Math.max(0, tilt);
    const gh = 1 - 0.07 * Math.max(0, -tilt);
    const aTilt = 1 - Math.exp((-TWO_PI * 1500) / sr);
    const aDamp = 1 - Math.exp((-TWO_PI * 5500) / sr);
    const cA = -(0.35 + 0.55 * drip);
    const cB = -(0.35 + 0.55 * drip * 0.92);
    // time one trip round the loop takes, including the dispersion's low-frequency delay
    const tripA = base * this.a.scale + SPRING_STAGES * ((1 - cA) / (1 + cA)) * 0.5;
    const tripB = base * this.b.scale + SPRING_STAGES * ((1 - cB) / (1 + cB)) * 0.5;
    const gA = Math.exp((-LN1000 * tripA) / (sr * decay));
    const gB = Math.exp((-LN1000 * tripB) / (sr * decay));
    // normalise by the loop's energy gain, so a long Length does not also mean a louder reverb
    const nA = Math.sqrt(1 - gA * gA);
    const nB = Math.sqrt(1 - gB * gB);
    const DA = Math.max(8, base * this.a.scale);
    const DB = Math.max(8, base * this.b.scale);
    if (this.a.D === 0) { this.a.D = DA; this.b.D = DB; }
    for (let i = 0; i < n; i++) {
      const x = input ? input[i] : 0;
      const driven = Math.tanh(k * x) * norm;
      const wa = this.a.tick(driven, cA, gA, gl, gh, aTilt, aDamp, DA);
      const wb = this.b.tick(driven, cB, gB, gl, gh, aTilt, aDamp, DB);
      // remove any DC the loops build up
      this.dcA += 0.0005 * (wa - this.dcA);
      this.dcB += 0.0005 * (wb - this.dcB);
      outL[i] = (wa - this.dcA) * nA;
      outR[i] = (wb - this.dcB) * nB;
    }
  }
}

if (typeof registerProcessor === 'function') {
  const kp = (name, def, min, max) => ({ name, defaultValue: def, minValue: min, maxValue: max, automationRate: 'k-rate' });

  class MoaPipe extends AudioWorkletProcessor {
    static get parameterDescriptors() {
      return [
        kp('atk', 0.005, 0.0005, 10), kp('dec', 0.3, 0.001, 10), kp('sus', 0.8, 0, 1), kp('rel', 0.3, 0.001, 20),
        kp('envKey', 0, 0, 1), kp('vel', 0.5, 0, 1), kp('legato', 0, 0, 1),
        kp('noise', 0.5, 0, 1), kp('nCut', 100, 0, 150), kp('nRes', 0.2, 0, 1), kp('nKey', 0.5, 0, 1),
        kp('nEnv', 0, -60, 60), kp('onePole', 0, 0, 1), kp('gain', 0.7, 0, 2),
        kp('tune', 0, -36, 36), kp('fine', 0, -100, 100), kp('harm', 0, 0, 1), kp('split', 0, 0, 1),
        kp('splitPt', 0.5, 0.05, 0.95), kp('pol', 0, 0, 1),
        kp('fbDec', 2, 0.02, 30), kp('fbRel', 0.4, 0.01, 20), kp('push', 0, 0, 1.5), kp('satHard', 0.3, 0, 1),
        kp('satSym', 0, 0, 1), kp('hp', -12, -60, 36), kp('lp', 36, -12, 96), kp('hpComp', 1, 0, 1), kp('lpComp', 1, 0, 1),
        kp('mode', 0, 0, 2), kp('detune', 12, 0, 100), kp('glide', 0.1, 0.001, 5), kp('glideOn', 0, 0, 1),
        kp('spread', 0.5, 0, 1), kp('volume', 0.8, 0, 1.5),
        kp('lfoRate', 5, 0.01, 40), kp('lfoShape', 0, 0, 4), kp('lfoDelay', 0, 0, 10), kp('lfoAmt', 0, 0, 1),
        kp('lfoDest', 0, 0, 4), kp('bend', 0, -12, 12), kp('mod', 0, 0, 1),
      ];
    }
    constructor() {
      super();
      this.core = new PipeCore(sampleRate);
      this.p = {};
      this.sinceView = 0;
      this.port.onmessage = (e) => {
        const m = e.data;
        if (!m || m.type !== 'note') return;
        if (m.note === -1) this.core.allNotesOff();
        else if (m.note === -2) this.core.sustainPedal(m.velocity > 0);
        else if (m.velocity > 0) this.core.noteOn(m.note, m.velocity, this.p.mode === undefined ? null : this.p);
        else this.core.noteOff(m.note);
      };
    }
    process(inputs, outputs, params) {
      const out = outputs[0];
      for (const name in params) this.p[name] = params[name][0];
      this.core.process(out[0], out[1] || out[0], out[0].length, this.p);
      this.sinceView += out[0].length;
      if (this.sinceView >= sampleRate / 30) {
        this.sinceView = 0;
        this.port.postMessage({ active: this.core.voices.map((v) => v.active) });
      }
      return true;
    }
  }
  registerProcessor('${PIPE_NAME}', MoaPipe);

  class MoaSpring extends AudioWorkletProcessor {
    static get parameterDescriptors() {
      return [kp('tension', 0.5, 0, 1), kp('drip', 0.6, 0, 1), kp('decay', 2, 0.1, 12), kp('tilt', 0, -1, 1), kp('dwell', 0.4, 0, 1)];
    }
    constructor() {
      super();
      this.core = new SpringCore(sampleRate);
      this.p = {};
      this.mono = new Float32Array(128);
    }
    process(inputs, outputs, params) {
      const out = outputs[0];
      const n = out[0].length;
      const input = inputs[0];
      let mono = null;
      if (input && input.length > 0) {
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
      return true;
    }
  }
  registerProcessor('${SPRING_NAME}', MoaSpring);
}
`;
