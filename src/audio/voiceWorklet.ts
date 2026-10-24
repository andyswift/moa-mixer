export const VOICE_NAME = 'moa-voice';

/**
 * A singing voice, physically modelled, as the source text of an audio worklet module (tests evaluate the same text to
 * get `VoiceCore`). No input, mono out.
 *
 * - The vocal folds: the Liljencrants-Fant (LF) model of the glottal flow's derivative, one pulse a period, its shape
 *   set by a single voice-quality parameter Rd (Fant 1995): tense voices (small Rd) close the glottis sharply and are
 *   bright, lax ones (large Rd) close gently and are soft and breathy. The pulse's timing follows the pitch, which
 *   glides to each note, with vibrato (fading in after the note starts) and a slow random drift of a few cents, as no
 *   singer holds a pitch dead still. Turbulence at the glottis (aspiration noise) is louder while it is open.
 * - The vocal tract: a Kelly-Lochbaum tube of `n` cylindrical sections from the glottis to the lips, two steps each
 *   sample (a section is the distance sound travels in half a sample, so `n` sets the tract's length). At each
 *   junction a pressure wave is partly reflected, by the change of area. The glottis end reflects most of the wave
 *   back; the open lips reflect it inverted and let a little out, which is the sound.
 * - The nose: a second tube, joined to the tract at the velum by a three-way junction; the velum's opening is the area
 *   of the join (nearly closed for a clear vowel, open for a hum or a nasal vowel).
 * - The shape: the tract's diameter along its length, from the tongue (where its body is, from the throat to the
 *   front of the mouth, and how high: a smaller diameter closes the tract above it) and the lips (their opening),
 *   modelled as in Neil Thapen's Pink Trombone. The diameters move toward the shape asked for at the speed a tongue
 *   moves, so a change of vowel glides; reflections change smoothly through each block.
 */
export const VOICE_SOURCE = `
/** The speed of sound in warm, moist air, m/s. */
const VOICE_C = 350;

class VoiceCore {
  constructor(sampleRate, lengthCm) {
    this.sr = sampleRate;
    this.seed = 12345;
    // the voice
    this.on = false;
    this.hz = 220; this.targetHz = 220; this.glide = 0.06;
    this.amp = 0; this.targetAmp = 0; this.attack = 0.08; this.release = 0.25;
    this.tension = 0.6; this.breath = 0.25;
    this.vibRate = 5.5; this.vibDepth = 30; this.vibDelay = 0.35; this.vibPhase = 0; this.sinceOn = 0;
    this.bend = 0; // semitones
    this.drift = 0; this.driftTarget = 0; this.driftAt = 0;
    this.phase = 0; // through the glottal period, 0..1
    this.lf = null;
    this.setLength(lengthCm || 16.5);
    this.shape = { tongueIndex: 14, tongueDiameter: 2.8, lips: 1.5, velum: 0.01 };
    this.setShape(this.shape, true);
    this.updateTract(1); this.updateTract(1); // the areas and reflections, before the first block
    // aspiration noise: a band-pass, and the output's DC blocker
    this.bp = [0, 0, 0, 0];
    this.hpX = 0; this.hpY = 0;
  }

  /** The tract's length, cm: the number of sections (each half a sample of travel). */
  setLength(cm) {
    const step = VOICE_C / (2 * this.sr);
    const n = Math.max(24, Math.min(80, Math.round(cm / 100 / step)));
    if (n === this.n) return;
    this.n = n;
    this.R = new Float64Array(n); this.L = new Float64Array(n);
    this.jR = new Float64Array(n + 1); this.jL = new Float64Array(n + 1);
    this.diameter = new Float64Array(n); this.target = new Float64Array(n); this.rest = new Float64Array(n);
    this.A = new Float64Array(n);
    this.refl = new Float64Array(n + 1); this.newRefl = new Float64Array(n + 1);
    const at = (k) => Math.round((k * n) / 44); // landmarks on Pink Trombone's 44-section grid, scaled
    this.bladeStart = at(10); this.tipStart = at(32); this.lipStart = at(39); this.noseStart = at(17);
    for (let i = 0; i < n; i++) {
      const d = i < at(7) - 0.5 ? 0.6 : i < at(12) ? 1.1 : 1.5; // the larynx narrow, the pharynx opening out
      this.rest[i] = d; this.diameter[i] = d; this.target[i] = d;
    }
    // the nose: 28 sections on the same grid, widening then narrowing to the nostrils
    const m = at(28);
    this.nm = m;
    this.nR = new Float64Array(m); this.nL = new Float64Array(m);
    this.njR = new Float64Array(m + 1); this.njL = new Float64Array(m + 1);
    this.nA = new Float64Array(m); this.nRefl = new Float64Array(m + 1);
    for (let i = 0; i < m; i++) {
      const d = 2 * (i / m);
      const dia = Math.min(1.9, d < 1 ? 0.4 + 1.6 * d : 0.5 + 1.5 * (2 - d));
      this.nA[i] = dia * dia;
    }
    for (let i = 1; i < m; i++) this.nRefl[i] = (this.nA[i - 1] - this.nA[i]) / (this.nA[i - 1] + this.nA[i]);
    if (this.shape) this.setShape(this.shape, true);
  }

  /** The tongue, the lips and the velum: the diameters the tract moves toward (now, if \`jump\`). */
  setShape(s, jump) {
    this.shape = s;
    const n = this.n, t = this.target;
    for (let i = 0; i < n; i++) t[i] = this.rest[i];
    // the tongue's body: a bump along the mouth, centred at tongueIndex, its height from tongueDiameter
    const index = (s.tongueIndex * n) / 44, dia = s.tongueDiameter;
    for (let i = this.bladeStart; i < this.lipStart; i++) {
      const tt = (1.1 * Math.PI * (index - i)) / (this.tipStart - this.bladeStart);
      const fixed = 2 + (dia - 2) / 1.5;
      let curve = (1.5 - fixed + 1.7) * Math.cos(tt);
      if (i === this.bladeStart - 2 || i === this.lipStart - 1) curve *= 0.8;
      if (i === this.bladeStart || i === this.lipStart - 2) curve *= 0.94;
      t[i] = Math.max(0.05, 1.5 - curve);
    }
    for (let i = this.lipStart; i < n; i++) t[i] = Math.max(0.05, s.lips);
    this.velum = Math.max(0.01, s.velum);
    if (jump) for (let i = 0; i < n; i++) this.diameter[i] = t[i];
  }

  /** The pitch (Hz), how loud (0..1), and whether the note glides from the last one (legato) or starts afresh. */
  noteOn(hz, intensity, legato) {
    this.targetHz = hz;
    if (!legato) { this.hz = hz; this.sinceOn = 0; } // a new note starts on its pitch, its vibrato to come; legato glides
    this.on = true;
    this.targetAmp = intensity;
  }

  noteOff() { this.on = false; this.targetAmp = 0; }

  random() { this.seed = (this.seed * 1664525 + 1013904223) >>> 0; return this.seed / 4294967296; }

  /** The LF pulse's shape for a voice quality Rd (Fant's equations, as Pink Trombone solves them). */
  setupLF(rd) {
    rd = Math.max(0.5, Math.min(2.7, rd));
    const ra = -0.01 + 0.048 * rd, rk = 0.224 + 0.118 * rd;
    const rg = (rk / 4) * (0.5 + 1.2 * rk) / (0.11 * rd - ra * (0.5 + 1.2 * rk));
    const ta = ra, tp = 1 / (2 * rg), te = tp + tp * rk;
    const epsilon = 1 / ta, shift = Math.exp(-epsilon * (1 - te)), delta = 1 - shift;
    let rhs = (1 / epsilon) * (shift - 1) + (1 - te) * shift;
    rhs /= delta;
    const lower = -(te - tp) / 2 + rhs, upper = -lower;
    const omega = Math.PI / tp, s = Math.sin(omega * te);
    const y = (-Math.PI * s * upper) / (tp * 2);
    const alpha = Math.log(y) / (tp / 2 - te);
    const e0 = -1 / (s * Math.exp(alpha * te));
    this.lf = { alpha, e0, epsilon, shift, delta, te, omega };
  }

  /** The glottal flow's derivative at a point in the period (0..1). */
  pulse(t) {
    const g = this.lf;
    if (t > g.te) return (-Math.exp(-g.epsilon * (t - g.te)) + g.shift) / g.delta;
    return g.e0 * Math.exp(g.alpha * t) * Math.sin(g.omega * t);
  }

  /** One step of the tract (and the nose), with this much glottal input; returns what leaves the lips and nostrils. */
  step(input, frac) {
    const n = this.n, R = this.R, L = this.L, jR = this.jR, jL = this.jL;
    const r0 = this.refl, r1 = this.newRefl;
    // the glottis end reflects most of the wave back; the lips reflect it inverted
    jR[0] = L[0] * 0.75 + input;
    jL[n] = R[n - 1] * -0.85;
    const J = this.noseStart;
    for (let i = 1; i < n; i++) {
      if (i === J) continue;
      const r = r0[i] + (r1[i] - r0[i]) * frac;
      const w = r * (R[i - 1] - L[i]);
      jR[i] = R[i - 1] + w;
      jL[i] = L[i] + w;
    }
    // the velum: a three-way junction, the pressure there shared out by area
    {
      const aL = this.A[J - 1], aR = this.A[J], aN = this.nA[0];
      const p = (2 * (aL * R[J - 1] + aR * L[J] + aN * this.nL[0])) / (aL + aR + aN);
      jL[J] = p - R[J - 1];
      jR[J] = p - L[J];
      this.njR[0] = p - this.nL[0];
    }
    for (let i = 0; i < n; i++) { R[i] = jR[i] * 0.999; L[i] = jL[i + 1] * 0.999; }
    // the nose
    const m = this.nm, nR = this.nR, nL = this.nL, njR = this.njR, njL = this.njL, nr = this.nRefl;
    njL[m] = nR[m - 1] * -0.85;
    for (let i = 1; i < m; i++) {
      const w = nr[i] * (nR[i - 1] - nL[i]);
      njR[i] = nR[i - 1] + w;
      njL[i] = nL[i] + w;
    }
    for (let i = 0; i < m; i++) { nR[i] = njR[i] * 0.999; nL[i] = njL[i + 1] * 0.999; }
    return R[n - 1] + nR[m - 1];
  }

  /** The block's areas and reflections: the diameters moved toward the shape at the speed a tongue moves. */
  updateTract(seconds) {
    const n = this.n, d = this.diameter, t = this.target, A = this.A;
    const k = 1 - Math.exp(-seconds / 0.035);
    for (let i = 0; i < n; i++) { d[i] += (t[i] - d[i]) * k; A[i] = d[i] * d[i]; }
    this.nA[0] = this.velum * this.velum; // the velum's opening, as an area at the nose's mouth
    const r0 = this.refl, r1 = this.newRefl;
    for (let i = 1; i <= n; i++) r0[i] = r1[i];
    for (let i = 1; i < n; i++) r1[i] = A[i - 1] + A[i] < 1e-9 ? 0 : (A[i - 1] - A[i]) / (A[i - 1] + A[i]);
  }

  process(out, len, p) {
    const sr = this.sr;
    this.updateTract(len / sr);
    if (!this.lf) this.setupLF(this.rdFor());
    // aspiration noise: a band-pass around 1.2 kHz
    const w0 = (2 * Math.PI * 1200) / sr, alpha = Math.sin(w0) / (2 * 0.7), cw = Math.cos(w0);
    const a0 = 1 + alpha, nb0 = alpha / a0, nb2 = -alpha / a0, na1 = (-2 * cw) / a0, na2 = (1 - alpha) / a0;
    const z = this.bp;
    // the attack and release are the times to get there (within a few per cent, and -43 dB)
    const ampK = 1 - Math.exp(-1 / (sr * (this.targetAmp > this.amp ? this.attack / 3 : this.release / 5)));
    const hzK = 1 - Math.exp(-1 / (sr * Math.max(0.002, this.glide)));
    for (let i = 0; i < len; i++) {
      this.amp += (this.targetAmp - this.amp) * ampK;
      if (!this.on && this.amp < 1e-4) this.amp = 0;
      this.hz *= Math.pow(this.targetHz / this.hz, hzK);
      // vibrato fading in after the note starts, and a slow wander of a few cents
      this.sinceOn += 1 / sr;
      const fadeIn = Math.min(1, Math.max(0, (this.sinceOn - this.vibDelay) / 0.4));
      this.vibPhase += this.vibRate / sr;
      if (this.vibPhase > 1) this.vibPhase -= 1;
      if (--this.driftAt <= 0) { this.driftTarget = (this.random() - 0.5) * 8; this.driftAt = sr * (0.2 + 0.3 * this.random()); }
      this.drift += (this.driftTarget - this.drift) * (4 / sr);
      const cents = this.vibDepth * fadeIn * Math.sin(2 * Math.PI * this.vibPhase) + this.drift + this.bend * 100;
      const f = this.hz * Math.pow(2, cents / 1200);
      this.phase += f / sr;
      if (this.phase >= 1) { this.phase -= 1; this.setupLF(this.rdFor()); }
      // the glottis: the pulse, louder and a little tenser the louder the note, and turbulence while it is open
      const loud = this.amp;
      const voiced = loud > 1e-5 ? this.pulse(this.phase) * loud : 0;
      const white = this.random() * 2 - 1;
      const noise = nb0 * white + nb2 * z[1] - na1 * z[2] - na2 * z[3];
      z[1] = z[0]; z[0] = white; z[3] = z[2]; z[2] = noise;
      const open = this.phase < this.lf.te ? Math.sin((Math.PI * this.phase) / this.lf.te) : 0;
      const aspiration = noise * loud * this.breath * (0.25 + 0.75 * open) * 1.4;
      const g = voiced + aspiration;
      // two steps of the tract a sample
      const frac = i / len;
      let o = this.step(g, frac);
      o += this.step(g, frac + 0.5 / len);
      o *= 0.5;
      // the DC blocker, then the level and a soft limit
      const y = o - this.hpX + 0.995 * this.hpY;
      this.hpX = o; this.hpY = y;
      const v = y * 0.6 * p.level;
      out[i] = v > 3 ? 1 : v < -3 ? -1 : v * (27 + v * v) / (27 + 9 * v * v);
    }
  }

  /** Rd from the tension and how loud the note is: louder voices are a little tenser. */
  rdFor() {
    const tense = Math.max(0, Math.min(1, this.tension + 0.15 * (this.amp - 0.7)));
    return 2.7 - 2.2 * tense;
  }

  /** The tract's diameters now (and the velum's opening), for drawing. */
  view() {
    return { diameters: Float32Array.from(this.diameter), velum: this.velum, hz: this.hz, amp: this.amp, lipStart: this.lipStart, noseStart: this.noseStart };
  }
}

if (typeof registerProcessor === 'function') {
  class MoaVoice extends AudioWorkletProcessor {
    static get parameterDescriptors() {
      return [{ name: 'level', defaultValue: 0.8, minValue: 0, maxValue: 2, automationRate: 'k-rate' }];
    }
    constructor(options) {
      super();
      const cfg = (options && options.processorOptions && options.processorOptions.config) || {};
      this.core = new VoiceCore(sampleRate, cfg.length);
      if (cfg.shape) this.core.setShape(cfg.shape, true);
      this.apply(cfg);
      this.p = {};
      this.since = 0;
      this.port.onmessage = (e) => {
        const m = e.data;
        if (!m) return;
        if (m.type === 'configure') this.apply(m);
        else if (m.type === 'note') this.core.noteOn(m.hz, m.intensity, m.legato);
        else if (m.type === 'off') this.core.noteOff();
      };
    }
    apply(m) {
      const c = this.core;
      if (m.length) c.setLength(m.length);
      if (m.shape) c.setShape(m.shape, false);
      for (const k of ['tension', 'breath', 'vibRate', 'vibDepth', 'vibDelay', 'glide', 'attack', 'release', 'bend']) if (typeof m[k] === 'number') c[k] = m[k];
    }
    process(inputs, outputs, params) {
      const out = outputs[0][0];
      this.p.level = params.level[0];
      this.core.process(out, out.length, this.p);
      this.since += out.length;
      if (this.since >= sampleRate / 30) {
        this.since = 0;
        this.port.postMessage(this.core.view());
      }
      return true;
    }
  }
  registerProcessor('${VOICE_NAME}', MoaVoice);
}
`;
