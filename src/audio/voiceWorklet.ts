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
 * - Consonants: a second articulator over the vowel, a constriction at a place along the tract that closes, narrows
 *   or lets go fast (the tongue's tip and the lips are quicker than its body), with the velum and the folds' voicing
 *   set for it. Air through a narrow gap is turbulent, so noise is made there (a fricative's hiss; the burst of a
 *   closure let go); an h is turbulence at the glottis with the folds apart. A syllable's consonants before its vowel
 *   play as the note starts; after it, as the note is let go (gliding first to a diphthong's second vowel), the voice
 *   singing on until they are done. A shut mouth lets nothing out of the lips; an m hums out of the nose.
 */
export const VOICE_SOURCE = `
/** The speed of sound in warm, moist air, m/s. */
const VOICE_C = 350;
/** How far the ring narrows (or widens) the tube above the folds across its range, as a fraction of its width. */
const RING_NARROW = 0.8;
/** How loud the turbulence at a constriction is (a fricative, a burst), against the tone. */
const FRIC_LEVEL = 0.5, BURST_LEVEL = 0.6;
/** The aspiration noise's level: the default breath (0.25) about 22 dB under the tone (a clear voice), full breath about 10. */
const NOISE_LEVEL = 0.42;

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
    // expression: how a note starts (0 breathy, 1 a hard glottal attack), the scoop up into it (cents), the cycle-to-
    // cycle roughness (jitter and shimmer), and the expression pedal (a multiplier on how loud)
    this.onset = 0.5; this.scoop = 40; this.roughness = 0.3; this.expression = 1;
    this.air = 0; this.onsetBreath = 0; this.onsetTense = 0; this.attackScale = 1; this.scoopOff = 0; this.exhale = 0;
    this.jitter = 0; this.shimmer = 1; this.vibRateMul = 1; this.vibDepthMul = 1;
    this.phase = 0; // through the glottal period, 0..1
    this.lf = null;
    // the consonant articulator: where the constriction is (in sections; -1 none), its width now and where it is going,
    // the lips' (9: no say), the velum, the folds voicing (a gate), turbulence at the constriction and at the glottis
    this.cIndex = -1; this.cDiam = 9; this.cTarget = 9; this.cLips = 9; this.velumNow = 0.01; this.velumTarget = 0.01;
    this.vg = 1; this.voicedTarget = 1; this.fric = 0; this.fricTarget = 0; this.asp = 0; this.aspTarget = 0; this.burst = 0;
    // a syllable's gestures: the one under way, those to come, and what the note's end will do
    this.gesture = null; this.gLeft = 0; this.queue = []; this.ending = false; this.vowel2 = null; this.coda = [];
    this.fHp = 0; this.fHpX = 0;
    this.setLength(lengthCm || 16.5);
    this.shape = { tongueIndex: 14, tongueDiameter: 2.8, lips: 1.5, velum: 0.01 };
    this.setShape(this.shape, true);
    this.updateTract(1); this.updateTract(1); // the areas and reflections, before the first block
    // aspiration noise (its filters' state, and the turbulence's slow flutter), and the output's DC blocker
    this.nHp = 0; this.nHpX = 0; this.nLp = 0; this.flutter = 0;
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
    this.diameter = new Float64Array(n); this.target = new Float64Array(n); this.rest = new Float64Array(n); this.vdiam = new Float64Array(n);
    this.A = new Float64Array(n);
    this.refl = new Float64Array(n + 1); this.newRefl = new Float64Array(n + 1);
    const at = (k) => Math.round((k * n) / 44); // landmarks on Pink Trombone's 44-section grid, scaled
    this.bladeStart = at(10); this.tipStart = at(32); this.lipStart = at(39); this.noseStart = at(17);
    this.larynxEnd = at(7);
    for (let i = 0; i < n; i++) {
      const d = i < at(7) - 0.5 ? 0.6 : i < at(12) ? 1.1 : 1.5; // the larynx narrow, the pharynx opening out
      this.rest[i] = d; this.diameter[i] = d; this.target[i] = d; this.vdiam[i] = d;
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
    // the ring (the singer's formant): the tube just above the folds (about 2.5 cm, a sixth of the throat's area as it
    // rests) narrowed, so its own resonance near 3 kHz gathers the third to fifth formants into one bright peak;
    // widened, the ring goes. 0.5 is the tract at rest
    const ring = (s.ring === undefined ? 0.5 : s.ring) - 0.5;
    for (let i = 0; i < this.larynxEnd; i++) t[i] *= 1 - RING_NARROW * ring;
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
    if (!this.gesture) this.velumTarget = this.velum;
    if (jump) { for (let i = 0; i < n; i++) { this.vdiam[i] = t[i]; this.diameter[i] = t[i]; } this.velumNow = this.velumTarget; }
  }

  /** The pitch (Hz), how loud (0..1), and whether the note glides from the last one (legato) or starts afresh. */
  noteOn(hz, intensity, legato, syllable) {
    this.targetHz = hz;
    if (!legato && syllable) {
      // a syllable: the tongue to its vowel (there already, from silence) and its first consonants under way
      const fromSilence = this.amp < 0.02;
      this.setShape(syllable.vowel, fromSilence);
      this.vowel2 = syllable.vowel2 || null; this.coda = syllable.coda || []; this.ending = false;
      this.queue = syllable.onset.slice();
      if (this.queue.length) {
        this.nextGesture();
        if (fromSilence) this.cDiam = this.cTarget; // the mouth is shaped before the sound starts
      } else this.clearGesture();
    }
    if (!legato) {
      // a new note: on its pitch but scooped up into it, its vibrato to come; breathy onsets lead with air and let the
      // tone in slowly, hard ones snap the folds shut (tense for a moment) and start at once
      this.hz = hz; this.sinceOn = 0;
      this.scoopOff = -this.scoop;
      this.onsetBreath = 1.0 * (1 - this.onset);
      this.onsetTense = 0.4 * this.onset;
      this.attackScale = 0.3 + 2.2 * (1 - this.onset);
      if (syllable && syllable.onset.length) this.attackScale = Math.min(this.attackScale, 0.4); // the consonant starts it
    }
    this.on = true;
    this.targetAmp = intensity;
  }

  /** The note let go: the tone dies away, with a little breath out after it. */
  noteOff() {
    if (this.on && !this.ending && (this.vowel2 || this.coda.length)) {
      // sing on to the end of the syllable: a diphthong's second vowel, then its last consonants
      this.ending = true;
      this.queue = [];
      if (this.vowel2) { this.setShape(this.vowel2, false); this.queue.push({ index: -1, diameter: 9, velum: -1, voiced: true, noise: 0, aspirate: 0, dur: 0.12 }); }
      this.queue.push(...this.coda);
      this.vowel2 = null; this.coda = [];
      this.nextGesture();
      return;
    }
    this.finishOff();
  }

  /** The tone dies away, with a little breath out after it. */
  finishOff() {
    if (this.on) this.exhale = 0.15 * this.amp;
    this.on = false; this.targetAmp = 0; this.ending = false;
  }

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
  step(input, frac, turbulence) {
    const n = this.n, R = this.R, L = this.L, jR = this.jR, jL = this.jL;
    const r0 = this.refl, r1 = this.newRefl;
    // turbulence made just past the constriction, going both ways
    if (turbulence && this.cIndex >= 0) {
      const k = Math.min(n - 1, Math.max(1, Math.round(this.cIndex) + 1));
      R[k] += turbulence / 2; L[k] += turbulence / 2;
    }
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
    // the nose's soft, lined walls and sinuses soak up far more than the mouth's
    for (let i = 0; i < m; i++) { nR[i] = njR[i] * 0.985; nL[i] = njL[i + 1] * 0.985; }
    // what leaves the lips and the nostrils is the airflow, the pressure wave times the opening's area (none from a
    // shut mouth, little from the small nostrils), against an open mouth's
    return (R[n - 1] * this.A[n - 1] + nR[m - 1] * this.nA[m - 1]) / 2.25;
  }

  /** The block's areas and reflections: the diameters moved toward the shape at the speed a tongue moves. */
  updateTract(seconds) {
    const n = this.n, d = this.diameter, t = this.target, v = this.vdiam, A = this.A;
    // the tongue's body moves toward the vowel at its own pace; a constriction (the tip, the lips) is quicker
    const k = 1 - Math.exp(-seconds / 0.035), kc = 1 - Math.exp(-seconds / 0.007), kv = 1 - Math.exp(-seconds / 0.015);
    for (let i = 0; i < n; i++) v[i] += (t[i] - v[i]) * k;
    this.cDiam += (this.cTarget - this.cDiam) * kc;
    this.velumNow += (this.velumTarget - this.velumNow) * kv;
    for (let i = 0; i < n; i++) d[i] = v[i];
    if (this.cIndex >= 0 && this.cDiam < 8) {
      const c = this.cIndex, cd = Math.max(0, this.cDiam);
      if (c >= this.lipStart) for (let i = this.lipStart; i < n; i++) d[i] = Math.min(d[i], cd);
      else {
        // a constriction's shape along the tract, as Pink Trombone's: wide at the back of the mouth, narrow at the front
        const g = (k44) => (k44 * n) / 44;
        const width = c < g(25) ? g(10) : c >= this.tipStart ? g(5) : g(10) - (g(5) * (c - g(25))) / (this.tipStart - g(25));
        for (let i = 0; i < n; i++) {
          const rel = Math.abs(i - c) - 0.5;
          const shrink = rel <= 0 ? 0 : rel > width ? 1 : 0.5 * (1 - Math.cos((Math.PI * rel) / width));
          if (d[i] > cd) d[i] = cd + (d[i] - cd) * shrink;
        }
      }
    }
    if (this.cLips < 8) for (let i = this.lipStart; i < n; i++) d[i] = Math.min(d[i], this.cLips);
    for (let i = 0; i < n; i++) A[i] = d[i] * d[i];
    this.nA[0] = this.velumNow * this.velumNow; // the velum's opening, as an area at the nose's mouth
    this.nRefl[1] = (this.nA[0] - this.nA[1]) / (this.nA[0] + this.nA[1]); // and so how much of the wave it lets into the nose
    const r0 = this.refl, r1 = this.newRefl;
    for (let i = 1; i <= n; i++) r0[i] = r1[i];
    for (let i = 1; i < n; i++) r1[i] = A[i - 1] + A[i] < 1e-9 ? 0 : (A[i - 1] - A[i]) / (A[i - 1] + A[i]);
  }

  /** Starts a gesture of a syllable's consonants (or holds one: a hum, a hiss). A closure let go bursts. */
  applyGesture(g) {
    const wasShut = this.cTarget <= 0.02;
    this.gesture = g; this.gLeft = g.dur;
    if (g.index >= 0) { this.cIndex = (g.index * this.n) / 44; this.cTarget = g.diameter; } else this.cTarget = 9;
    this.cLips = typeof g.lips === 'number' ? g.lips : 9;
    this.velumTarget = g.velum >= 0 ? g.velum : this.velum;
    this.voicedTarget = g.voiced ? 1 : 0; this.fricTarget = g.noise || 0; this.aspTarget = g.aspirate || 0;
    if (wasShut && this.cTarget > 0.02) this.burst = 1;
  }

  /** Back to the vowel: the constriction let go (a closure bursts), the velum as the vowel has it, the folds voicing. */
  clearGesture() {
    if (this.cTarget <= 0.02) this.burst = 1;
    this.gesture = null; this.cTarget = 9; this.cLips = 9; this.velumTarget = this.velum;
    this.voicedTarget = 1; this.fricTarget = 0; this.aspTarget = 0;
  }

  /** The next gesture, or the vowel; at the note's end, once the last consonant is done, the voice stops. */
  nextGesture() {
    const g = this.queue.shift();
    if (g) return this.applyGesture(g);
    if (this.ending) { this.ending = false; this.gesture = null; this.finishOff(); return; } // the mouth stays as it ends
    this.clearGesture();
  }

  process(out, len, p) {
    const sr = this.sr;
    this.updateTract(len / sr);
    if (!this.lf) this.setupLF(this.rdFor());
    // aspiration noise: turbulence at the glottis is broadband, so white noise with only its extremes taken off (a
    // one-pole high-pass at 250 Hz, a low-pass at 4 kHz); the tract shapes it into the vowel, as it does the tone
    const hpA = Math.exp((-2 * Math.PI * 250) / sr), lpA = Math.exp((-2 * Math.PI * 4000) / sr), flA = Math.exp((-2 * Math.PI * 30) / sr);
    // the attack and release are the times to get there (within a few per cent, and -43 dB)
    const target = this.targetAmp * this.expression;
    const rising = target > this.amp;
    const ampK = 1 - Math.exp(-1 / (sr * (rising ? (this.attack * this.attackScale) / 3 : this.release / 5)));
    const airK = 1 - Math.exp(-1 / (sr * (rising ? 0.01 : this.release / 5))); // the air comes at once
    const hzK = 1 - Math.exp(-1 / (sr * Math.max(0.002, this.glide)));
    const gateK = 1 - Math.exp(-1 / (sr * 0.005)), burstD = Math.exp(-1 / (sr * 0.008));
    const fHpA = Math.exp((-2 * Math.PI * 1000) / sr);
    const fast = Math.exp(-1 / (sr * 0.04)), medium = Math.exp(-1 / (sr * 0.08)), slow = Math.exp(-1 / (sr * 0.1));
    for (let i = 0; i < len; i++) {
      this.amp += (target - this.amp) * ampK;
      this.air += (target - this.air) * airK;
      if (!this.on && this.amp < 1e-4) { this.amp = 0; if (this.air < 1e-4) this.air = 0; }
      this.onsetBreath *= medium; this.onsetTense *= fast; this.scoopOff *= medium; this.exhale *= slow;
      // the syllable's gestures run on; the folds' voicing and the turbulence follow them quickly
      if (this.gesture && this.gLeft !== Infinity && (this.gLeft -= 1 / sr) <= 0) this.nextGesture();
      this.vg += (this.voicedTarget - this.vg) * gateK;
      this.fric += (this.fricTarget - this.fric) * gateK;
      this.asp += (this.aspTarget - this.asp) * gateK;
      this.burst *= burstD;
      this.hz *= Math.pow(this.targetHz / this.hz, hzK);
      // vibrato fading in after the note starts and deepening as it is held, its rate and depth never quite even;
      // and a slow wander of a few cents
      this.sinceOn += 1 / sr;
      const held = this.sinceOn - this.vibDelay;
      const fadeIn = Math.min(1, Math.max(0, held / 0.4)) * (0.75 + 0.25 * Math.min(1, Math.max(0, held / 1.5)));
      this.vibPhase += (this.vibRate * this.vibRateMul) / sr;
      if (this.vibPhase > 1) {
        this.vibPhase -= 1;
        this.vibRateMul = 1 + (this.random() - 0.5) * 0.16;
        this.vibDepthMul = 1 + (this.random() - 0.5) * 0.3;
      }
      if (--this.driftAt <= 0) { this.driftTarget = (this.random() - 0.5) * 8; this.driftAt = sr * (0.2 + 0.3 * this.random()); }
      this.drift += (this.driftTarget - this.drift) * (4 / sr);
      const vib = this.vibDepth * this.vibDepthMul * fadeIn * Math.sin(2 * Math.PI * this.vibPhase);
      const cents = vib + this.drift + this.scoopOff + this.bend * 100;
      const f = this.hz * Math.pow(2, cents / 1200) * (1 + this.jitter);
      this.phase += f / sr;
      if (this.phase >= 1) {
        // a new period: its shape for the voice's tension now, and the roughness, its length and height a little off
        this.phase -= 1;
        this.setupLF(this.rdFor());
        this.jitter = (this.random() - 0.5) * 0.012 * this.roughness;
        this.shimmer = 1 + (this.random() - 0.5) * 0.16 * this.roughness;
      }
      // the glottis: the pulse, louder and a little tenser the louder the note, and turbulence while it is open (more
      // at a breathy onset, and a breath out after the note)
      const loud = this.amp;
      const voiced = loud > 1e-5 ? this.pulse(this.phase) * loud * this.shimmer * this.vg : 0;
      const white = this.random() * 2 - 1;
      this.nHp = hpA * (this.nHp + white - this.nHpX); this.nHpX = white;
      this.nLp = this.nHp + lpA * (this.nLp - this.nHp);
      // turbulence is never steady: its level flutters (a random wobble below 30 Hz)
      this.flutter = flA * this.flutter + (1 - flA) * (this.random() * 2 - 1);
      const noise = this.nLp * (1 + 0.5 * Math.max(-1, Math.min(1, this.flutter * 8)));
      const open = this.phase < this.lf.te ? Math.sin((Math.PI * this.phase) / this.lf.te) : 0;
      // the turbulence pulses with the airflow: strong while the glottis is open, little while it is shut
      const shut = 1 - this.vg; // folds held apart (an h, a p t k), the air flows steadily, not in pulses
      const aspiration = noise * (this.air * (this.breath + this.onsetBreath) * (0.1 + 0.9 * (open * this.vg + shut)) + this.air * this.asp * 1.5 + this.exhale) * NOISE_LEVEL;
      const g = voiced + aspiration;
      // turbulence at the constriction: air through a narrow gap (none through a shut one), and a closure's burst
      let turbulence = 0;
      if (this.cIndex >= 0 && this.air > 1e-4) {
        const white2 = this.random() * 2 - 1;
        this.fHp = fHpA * (this.fHp + white2 - this.fHpX); this.fHpX = white2;
        const gap = this.cDiam < 0.005 ? 0 : Math.max(0, Math.min(1, (0.5 - this.cDiam) / 0.5));
        turbulence = this.fHp * this.air * (gap * (0.2 + this.fric) * FRIC_LEVEL + this.burst * BURST_LEVEL);
      }
      // two steps of the tract a sample
      const frac = i / len;
      let o = this.step(g, frac, turbulence);
      o += this.step(g, frac + 0.5 / len, turbulence);
      o *= 0.5;
      // the DC blocker, then the level and a soft limit
      const y = o - this.hpX + 0.995 * this.hpY;
      this.hpX = o; this.hpY = y;
      const v = y * 1.8 * p.level;
      out[i] = v > 3 ? 1 : v < -3 ? -1 : v * (27 + v * v) / (27 + 9 * v * v);
    }
  }

  /** Rd from the tension and how loud the note is: louder voices are a little tenser. */
  rdFor() {
    const tense = Math.max(0, Math.min(1, this.tension + 0.15 * (this.amp - 0.7) + this.onsetTense));
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
        else if (m.type === 'note') this.core.noteOn(m.hz, m.intensity, m.legato, m.syllable);
        else if (m.type === 'off') this.core.noteOff();
      };
    }
    apply(m) {
      const c = this.core;
      if (m.length) c.setLength(m.length);
      if (m.shape) c.setShape(m.shape, false);
      for (const k of ['tension', 'breath', 'vibRate', 'vibDepth', 'vibDelay', 'glide', 'attack', 'release', 'bend', 'onset', 'scoop', 'roughness', 'expression']) if (typeof m[k] === 'number') c[k] = m[k];
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
