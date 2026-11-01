/**
 * A MOA-RIG string part (a bass guitar or an electric guitar) as worklet source text, part of RIG_SOURCE. It runs the
 * MOA-BASS's and MOA-GUITAR's strings (`StringCore`, from the string worklet's source, which the same module holds)
 * and their amp and cabinet, from a setup worked out on the main thread (`rigStringSetup`).
 *
 * - The physics of a fretted string is `voiceConfig`'s and a pluck is `pluckAmplitudes`' (bassPhysics.ts), worked
 *   here because the notes come here, on their samples: the length at the fret, the tension (the bend changes it),
 *   the stiff string's modes, their losses, how the pickups hear them, the palm and the released note's damping.
 * - A note goes to the string a player would use: the least hand movement from where the hand last was, an open string
 *   needing none, a string already holding another note avoided (so a chord spreads across the strings); out of reach
 *   it goes up or down an octave. Velocity sets how hard it is plucked; 40 of 127 or softer is a dead note (struck
 *   with the hand damping it). A note off damps its string.
 * - Strums: notes within the strum window are one strum; each string waits the strum time per string crossed from
 *   the strum's first (lowest on a down strum, highest on an up strum). Notes that come on the same sample (a chord
 *   from the sequencer) are one strum in string order.
 * - The bend changes every string's tension (up to two semitones; down too on a guitar, its vibrato arm); the MOD
 *   wheel adds to the palm mute.
 * - The amp: gain into the valve curve (the circuit engine's 'tube' shaper), make-up, the bass / mid / treble stack;
 *   the cabinet: its low resonance and roll-off, the cones' peak, the top end, the mic; blended with the DI. The
 *   filters are the Web Audio biquads the standalone instruments use (shelves at slope 1, low and high passes with
 *   their Q in dB).
 */
export const RIG_STRINGS_SOURCE = `
const RS_MAX_MODES = 128;
const RS_BEND_SEMITONES = 2;
const RS_BUSY = 6;
const RS_DEAD = 40 / 127;
/** The level a string part leaves at, to sit with the synth parts (a played note's loudness near a bass preset's). */
const RS_GAIN = 0.26;

// A Web Audio biquad's coefficients (b0, b1, b2, a1, a2 over a0).
function rsBiquad(type, f, q, gain, sr) {
  const w0 = 2 * Math.PI * Math.min(f, 0.49 * sr) / sr, c = Math.cos(w0), s = Math.sin(w0);
  const A = Math.pow(10, gain / 40);
  let b0, b1, b2, a0, a1, a2;
  if (type === 'lowpass' || type === 'highpass') {
    const alpha = s / (2 * Math.pow(10, q / 20));
    if (type === 'lowpass') { b0 = (1 - c) / 2; b1 = 1 - c; b2 = b0; }
    else { b0 = (1 + c) / 2; b1 = -(1 + c); b2 = b0; }
    a0 = 1 + alpha; a1 = -2 * c; a2 = 1 - alpha;
  } else if (type === 'peaking') {
    const alpha = s / (2 * q);
    b0 = 1 + alpha * A; b1 = -2 * c; b2 = 1 - alpha * A; a0 = 1 + alpha / A; a1 = -2 * c; a2 = 1 - alpha / A;
  } else {
    const alpha = s / 2 * Math.SQRT2, k = 2 * Math.sqrt(A) * alpha;
    if (type === 'lowshelf') {
      b0 = A * ((A + 1) - (A - 1) * c + k); b1 = 2 * A * ((A - 1) - (A + 1) * c); b2 = A * ((A + 1) - (A - 1) * c - k);
      a0 = (A + 1) + (A - 1) * c + k; a1 = -2 * ((A - 1) + (A + 1) * c); a2 = (A + 1) + (A - 1) * c - k;
    } else {
      b0 = A * ((A + 1) + (A - 1) * c + k); b1 = -2 * A * ((A - 1) + (A + 1) * c); b2 = A * ((A + 1) + (A - 1) * c - k);
      a0 = (A + 1) - (A - 1) * c + k; a1 = 2 * ((A - 1) - (A + 1) * c); a2 = (A + 1) - (A - 1) * c - k;
    }
  }
  return [b0 / a0, b1 / a0, b2 / a0, a1 / a0, a2 / a0];
}

// sin^2 damping where something touches the string (contactDamping).
function rsContact(length, count, position, strength) {
  const out = new Float64Array(count);
  for (let k = 0; k < count; k++) { const s = Math.sin(((k + 1) * Math.PI * position) / length); out[k] = strength * s * s; }
  return out;
}

class RigStrings {
  constructor(sr) {
    this.sr = sr;
    this.setup = null;
    this.strings = [];
    this.events = [];
    this.hand = 3;
    this.bend = 0;
    this.mod = 0;
    this.strum = null;
    this.mono = new Float32Array(128);
    this.tmp = new Float32Array(128);
    this.filters = [];
    this.quiet = 0;
    this.p = { level: 0.5, tone: 3500 };
  }

  configure(setup) {
    this.setup = setup;
    while (this.strings.length < setup.strings.length) this.strings.push({ core: new StringCore(this.sr), note: undefined, key: undefined, fret: 0, length: 0, hz: [] });
    this.strings.length = setup.strings.length;
    this.p.tone = setup.tone;
    const a = setup.amp, sr = this.sr, old = this.filters;
    const specs = [
      ['lowshelf', a.stack.bass, 0.707, a.bass], ['peaking', a.stack.mid, 0.8, a.mid], ['highshelf', a.stack.treble, 0.707, a.treble],
      ['highpass', a.cab.hp, a.cab.hpQ, 0], ['peaking', a.cab.bumpHz, 1.2, a.cab.bumpDb], ['peaking', a.cab.coneHz, a.cab.coneQ, a.cab.coneDb],
      ['lowpass', a.cab.top, 0.707, 0], ['lowpass', a.cab.top, 0.707, 0], ['highshelf', 3000, 0.707, a.mic],
    ];
    this.filters = specs.map((f, i) => ({ c: rsBiquad(f[0], f[1], f[2], f[3], sr), z: old[i] ? old[i].z : [0, 0, 0, 0] }));
    this.reconfigureAll();
  }

  get palm() { return Math.min(1, this.setup.palm + this.mod); }

  // voiceConfig: string i's modes at a fret under the present bend and palm.
  modes(i, fret) {
    const st = this.setup, s = st.strings[i];
    const length = st.scale / Math.pow(2, fret / 12);
    const T = s.T * Math.pow(2, (2 * this.bend * RS_BEND_SEMITONES) / 12);
    const f1 = Math.sqrt(T / s.mu) / (2 * length);
    const B = (Math.PI * Math.PI * s.EI) / (T * length * length);
    const maxHz = Math.min(12000, 0.45 * this.sr);
    const hz = [], sigma = [];
    for (let k = 1; k <= RS_MAX_MODES; k++) {
      const f = k * f1 * Math.sqrt(1 + B * k * k);
      if (f > maxHz) break;
      hz.push(f);
      sigma.push(0.5 + s.b2 * f * f);
    }
    const count = hz.length;
    const pickup = new Float64Array(count);
    for (const c of s.coils) {
      for (let k = 0; k < count; k++) {
        const kk = ((k + 1) * Math.PI) / length, half = (kk * 0.01) / 2;
        pickup[k] += c.gain * Math.sin(kk * c.position) * (half < 1e-9 ? 1 : Math.sin(half) / half);
      }
    }
    const strainK = new Float64Array(count);
    for (let k = 0; k < count; k++) strainK[k] = (((k + 1) * Math.PI) / length) ** 2 / 8;
    const mute = rsContact(length, count, Math.max(0.005, length - 0.015), 140);
    for (let k = 0; k < count; k++) mute[k] += 30;
    return {
      length, hz, sigma, pickup, strainK, stretch: s.EA / T,
      palm: rsContact(length, count, st.palmAt, this.palm * 600), mute,
    };
  }

  reconfigure(i) {
    const s = this.strings[i], cfg = this.modes(i, s.fret);
    s.core.configure(cfg);
    s.length = cfg.length;
    s.hz = cfg.hz;
  }

  reconfigureAll() {
    for (let i = 0; i < this.strings.length; i++) this.reconfigure(i);
  }

  // chooseString: the least hand movement, an open string half a fret's worth, a busy string six frets' worth.
  choose(note) {
    const st = this.setup;
    let best, bestCost = Infinity;
    for (let i = 0; i < st.strings.length; i++) {
      const fret = note - st.strings[i].note;
      if (fret < 0 || fret > st.frets) continue;
      const s = this.strings[i];
      const cost = (fret === 0 ? 0.5 : Math.abs(fret - this.hand)) + (s.note !== undefined && s.note !== note ? RS_BUSY : 0);
      if (cost < bestCost) { bestCost = cost; best = i; }
    }
    return best;
  }

  noteOn(key, vel, frame) {
    const st = this.setup;
    if (!st) return;
    let lo = Infinity, hi = -Infinity;
    for (const s of st.strings) { lo = Math.min(lo, s.note); hi = Math.max(hi, s.note + st.frets); }
    let note = key;
    while (note < lo) note += 12;
    while (note > hi) note -= 12;
    const i = this.choose(note);
    if (i === undefined) return;
    const s = this.strings[i];
    s.note = note;
    s.key = key;
    const fret = note - st.strings[i].note;
    if (fret > 0) this.hand = fret;
    this.events = this.events.filter((e) => e.i !== i || e.mute); // a pluck still waiting on this string gives way
    const strength = Math.min(1, Math.max(0.05, st.pluck.strength * vel * 127 / 96));
    const dead = vel <= RS_DEAD + 1e-9;
    const ev = { due: frame, i, fret, strength, dead };
    this.events.push(ev);
    if (dead || !st.strum.mode) return;
    if (!this.strum || frame - this.strum.frame > st.strum.window * this.sr) this.strum = { frame, events: [] };
    const strum = this.strum;
    strum.events = strum.events.filter((e) => this.events.indexOf(e) >= 0);
    strum.events.push(ev);
    let anchor = ev.i;
    for (const e of strum.events) anchor = st.strum.mode === 1 ? Math.min(anchor, e.i) : Math.max(anchor, e.i);
    const step = st.strum.time * this.sr;
    for (const e of strum.events) if (e.due >= frame) e.due = Math.max(frame, Math.round(strum.frame + Math.abs(e.i - anchor) * step));
  }

  noteOff(key, frame) {
    for (let i = 0; i < this.strings.length; i++) {
      const s = this.strings[i];
      if (s.key !== key) continue;
      s.note = undefined;
      s.key = undefined;
      this.events = this.events.filter((e) => e.i !== i);
      this.events.push({ due: frame, i, mute: true });
    }
  }

  stopAll() {
    this.events = [];
    this.strum = null;
    for (const s of this.strings) { s.note = undefined; s.key = undefined; s.core.setMuted(true, false); }
  }

  apply(e) {
    const s = this.strings[e.i];
    if (e.mute) { s.core.setMuted(true, false); return; }
    const st = this.setup;
    s.fret = e.fret;
    this.reconfigure(e.i);
    const L = s.length, hz = s.hz, count = hz.length;
    const xp = Math.min(Math.max(Math.min(Math.max(st.pluck.position, 0.01), L - 0.01), 0.002), L - 0.002);
    const height = st.pluck.low * Math.pow(st.pluck.high / st.pluck.low, e.strength);
    const amps = new Float64Array(count);
    for (let n = 1; n <= count; n++) {
      const k = (n * Math.PI) / L;
      const triangle = (2 * height * L * L) / (n * n * Math.PI * Math.PI * xp * (L - xp)) * Math.sin(k * xp);
      const half = (k * st.pluck.width) / 2;
      const width = half < 1e-9 ? 1 : Math.sin(half) / half;
      const soft = 1 / Math.sqrt(1 + (2 * Math.PI * hz[n - 1] * st.pluck.release) ** 2);
      amps[n - 1] = triangle * width * soft;
    }
    const at = Math.min(Math.max(st.pluck.position, 0.01), L - 0.01);
    const grab = rsContact(L, count, at, 0.9);
    for (let k = 0; k < count; k++) grab[k] = 1 - grab[k];
    s.core.setMuted(false);
    s.core.pluck(amps, grab);
    if (e.dead) s.core.setMuted(true, true);
  }

  // Renders n samples from absolute frame 'frame', adding them to l and r; 'bend' and 'mod' are the part's wheels.
  process(l, r, n, frame, bend, mod) {
    const st = this.setup;
    if (!st) return;
    const b = Math.max(st.bendDown ? -1 : 0, Math.min(1, bend)), m = Math.max(0, Math.min(1, mod));
    if (b !== this.bend || m !== this.mod) { this.bend = b; this.mod = m; this.reconfigureAll(); }
    if (this.mono.length < n) { this.mono = new Float32Array(n); this.tmp = new Float32Array(n); }
    const mono = this.mono, tmp = this.tmp;
    mono.fill(0, 0, n);
    if (this.events.length > 1) this.events.sort((x, y) => x.due - y.due);
    let at = 0;
    while (at < n) {
      while (this.events.length && this.events[0].due <= frame + at) this.apply(this.events.shift());
      const next = this.events.length ? this.events[0].due - frame : n;
      const end = Math.min(n, Math.max(at + 1, next));
      for (const s of this.strings) {
        const seg = tmp.subarray(at, end);
        s.core.process(seg, end - at, this.p);
        for (let i = at; i < end; i++) mono[i] += tmp[i];
      }
      at = end;
    }
    let peak = 0;
    for (let i = 0; i < n; i++) peak = Math.max(peak, Math.abs(mono[i]));
    if (peak < 1e-9) { if (++this.quiet > 200) return; } else this.quiet = 0;
    const a = st.amp, f = this.filters, lv = a.level * RS_GAIN;
    const D = 2.2, BIAS = 0.35, T0 = Math.tanh(BIAS), SLOPE = D * (1 - T0 * T0);
    for (let i = 0; i < n; i++) {
      const x = mono[i];
      const u = Math.max(-1, Math.min(1, x * a.pre));
      let y = ((Math.tanh(D * u + BIAS) - T0) / SLOPE) * a.post;
      for (let k = 0; k < f.length; k++) {
        const c = f[k].c, z = f[k].z;
        const o = c[0] * y + c[1] * z[0] + c[2] * z[1] - c[3] * z[2] - c[4] * z[3];
        z[1] = z[0]; z[0] = y; z[3] = z[2]; z[2] = o;
        y = o;
      }
      const out = (y * a.wet + x * a.di) * lv;
      l[i] += out;
      r[i] += out;
    }
  }
}
`;
