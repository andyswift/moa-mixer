// Port of Plaits' synthesis engines (plaits/dsp/engine/*) from Mutable Instruments' source.
// Copyright 2016-2021 Emilie Gillet (emilie.o.gillet@gmail.com). MIT licence: see ./LICENSE.

/**
 * Plaits' engines, as worklet source text. Each is a class with `reset()` and
 * `render(p, out, aux, size)`, where `p` holds trigger, note, timbre, morph, harmonics and accent as in
 * `EngineParameters`, and `out` and `aux` are the module's two outputs. `render` returns whether the sound already
 * has its own envelope (the percussive engines).
 */
export const PLAITS_ENGINES_SOURCE = `
// ---- 1: virtual analog (virtual_analog_engine.cc, VA_VARIANT 2, as the module ships)
// OUT: a variable square (TIMBRE: width, then hard sync) and a variable saw (MORPH: saw, notched, triangle),
// detuned by HARMONICS. AUX: the "monster sync" pair, both shaped by MORPH and synced by TIMBRE.
const PL_VA_INTERVALS = [0, 7.01, 12.01, 19.01, 24.01];
function plSquash(x) { return x * x * (3 - 2 * x); }

class PlVirtualAnalogEngine {
  constructor() {
    this.primary = new PlVariableShapeOscillator();
    this.auxiliary = new PlVariableShapeOscillator();
    this.auxiliary.setMasterPhase(0.25);
    this.sync = new PlVariableShapeOscillator();
    this.variableSaw = new PlVariableSawOscillator();
    this.auxiliaryAmount = 0;
    this.xmodAmount = 0;
    this.temp = new Float32Array(PL_MAX_BLOCK);
  }

  reset() {}

  computeDetuning(detune) {
    detune = plConstrain(2.05 * detune - 1.025, -1, 1);
    const sign = detune < 0 ? -1 : 1;
    detune = detune * sign * 3.9999;
    const i = detune | 0, f = detune - i;
    const a = PL_VA_INTERVALS[i], b = PL_VA_INTERVALS[i + 1];
    return (a + (b - a) * plSquash(plSquash(f))) * sign;
  }

  render(p, out, aux, size) {
    const syncAmount = p.timbre * p.timbre;
    const auxiliaryDetune = this.computeDetuning(p.harmonics);
    const primaryF = plNoteToFrequency(p.note);
    const auxiliaryF = plNoteToFrequency(p.note + auxiliaryDetune);
    const primarySyncF = plNoteToFrequency(p.note + syncAmount * 48);
    const auxiliarySyncF = plNoteToFrequency(p.note + auxiliaryDetune + syncAmount * 48);

    const shape = plConstrain(p.morph * 1.5, 0, 1);
    const pw = plConstrain(0.5 + (p.morph - 0.66) * 1.46, 0.5, 0.995);

    // the monster sync, to AUX
    this.primary.renderSync(primaryF, primarySyncF, pw, shape, out, size);
    this.auxiliary.renderSync(auxiliaryF, auxiliarySyncF, pw, shape, aux, size);
    for (let i = 0; i < size; i++) aux[i] = (aux[i] - out[i]) * 0.5;

    // the double varishape, to OUT
    const squarePw = plConstrain(1.3 * p.timbre - 0.15, 0.005, 0.5);
    const squareSyncRatio = p.timbre < 0.5 ? 0 : (p.timbre - 0.5) * (p.timbre - 0.5) * 4 * 48;
    const squareGain = Math.min(p.timbre * 8, 1);
    let sawPw = p.morph < 0.5 ? p.morph + 0.5 : 1 - (p.morph - 0.5) * 2;
    sawPw = plConstrain(sawPw * 1.1, 0.005, 1);
    const sawShape = plConstrain(10 - 21 * p.morph, 0, 1);
    const sawGain = plConstrain(8 * (1 - p.morph), 0.02, 1);
    const squareSyncF = plNoteToFrequency(p.note + squareSyncRatio);

    this.sync.renderSync(primaryF, squareSyncF, squarePw, 1, this.temp, size);
    this.variableSaw.render(auxiliaryF, sawPw, sawShape, out, size);

    const norm = 1 / Math.max(squareGain, sawGain);
    let sq = this.auxiliaryAmount; const dsq = (squareGain * 0.3 * norm - sq) / size;
    let sw = this.xmodAmount; const dsw = (sawGain * 0.5 * norm - sw) / size;
    for (let i = 0; i < size; i++) {
      sw += dsw; sq += dsq;
      out[i] = out[i] * sw + sq * this.temp[i];
    }
    this.auxiliaryAmount = sq;
    this.xmodAmount = sw;
    return false;
  }
}

// ---- 2: waveshaping (waveshaping_engine.cc)
// A slope (MORPH: its symmetry) through a waveshaper (HARMONICS: which curve) into a wavefolder (TIMBRE: how far).
// AUX: a sine folded by the second folder.
const PL_WS_TABLES = [PL_WS_INVERSE_TAN, PL_WS_INVERSE_SIN, PL_WS_LINEAR, PL_WS_BUMP, PL_WS_DOUBLE_BUMP, PL_WS_DOUBLE_BUMP];
function plTame(f0, harmonics, order) {
  f0 *= harmonics;
  const maxF = 0.5 / order;
  const maxAmount = plConstrain(1 - (f0 - maxF) / (0.5 - maxF), 0, 1);
  return maxAmount * maxAmount * maxAmount;
}
// Hermite-interpolates \`table\` from \`offset\` on (the original passes lut_fold + 1)
function plInterpolateHermiteAt(table, offset, index, size) {
  index *= size;
  const i = (index | 0) + offset, f = index - (index | 0);
  const xm1 = table[i - 1], x0 = table[i], x1 = table[i + 1], x2 = table[i + 2];
  const c = (x1 - xm1) * 0.5, v = x0 - x1, w = c + v, a = w + v + (x2 - x0) * 0.5, bNeg = w + a;
  return (((a * f) - bNeg) * f + c) * f + x0;
}

class PlWaveshapingEngine {
  constructor() {
    this.slope = new PlOscillator();
    this.triangle = new PlOscillator();
    this.previousShape = 0; this.previousWavefolderGain = 0; this.previousOvertoneGain = 0;
  }

  reset() {}

  render(p, out, aux, size) {
    const f0 = plNoteToFrequency(p.note);
    const pw = p.morph * 0.45 + 0.5;
    this.slope.render(PL_SHAPE_SLOPE, f0, pw, out, size);
    this.triangle.render(PL_SHAPE_SLOPE, f0, 0.5, aux, size);

    const slope = 3 + Math.abs(p.morph - 0.5) * 5;
    const shapeAmount = Math.abs(p.harmonics - 0.5) * 2;
    const shapeAttenuation = plTame(f0, slope, 16);
    const wavefolderGain = p.timbre;
    const wavefolderAttenuation = plTame(f0, slope * (3 + shapeAmount * shapeAttenuation * 5), 12);

    let sh = this.previousShape; const dsh = (0.5 + (p.harmonics - 0.5) * shapeAttenuation - sh) / size;
    let wf = this.previousWavefolderGain; const dwf = (0.03 + 0.46 * wavefolderGain * wavefolderAttenuation - wf) / size;
    const overtone = p.timbre * (2 - p.timbre);
    let og = this.previousOvertoneGain; const dog = (overtone * (2 - overtone) - og) / size;

    for (let i = 0; i < size; i++) {
      sh += dsh; wf += dwf; og += dog;
      const shape = sh * 3.9999;
      const si = shape | 0, sf = shape - si;
      const t1 = PL_WS_TABLES[si], t2 = PL_WS_TABLES[si + 1];
      const wsIndex = 127 * out[i] + 128;
      let wi = Math.floor(wsIndex);
      const wfrac = wsIndex - wi;
      wi = (wsIndex | 0) & 255;
      const x0 = t1[wi] / 32768, x1 = t1[wi + 1] / 32768, x = x0 + (x1 - x0) * wfrac;
      const y0 = t2[wi] / 32768, y1 = t2[wi + 1] / 32768, y = y0 + (y1 - y0) * wfrac;
      const mix = x + (y - x) * sf;
      const index = mix * wf + 0.5;
      const fold = plInterpolateHermiteAt(PL_FOLD, 1, index, 512);
      const fold2 = -plInterpolateHermiteAt(PL_FOLD_2, 1, index, 512);
      const sine = plSine(aux[i] * 0.25 + 0.5);
      out[i] = fold;
      aux[i] = sine + (fold2 - sine) * og;
    }
    this.previousShape = sh; this.previousWavefolderGain = wf; this.previousOvertoneGain = og;
    return false;
  }
}

// ---- 3: two-operator FM (fm_engine.cc), 4x oversampled
// HARMONICS: the ratio (quantized to musical ones), TIMBRE: the index, MORPH: feedback (into the modulator to the
// right, into its phase to the left). AUX: a sub-oscillator an octave down, phase-modulated by the carrier.
class PlFMEngine {
  constructor() {
    this.carrierPhase = 0; this.modulatorPhase = 0; this.subPhase = 0;
    this.previousCarrierFrequency = PL_A0; this.previousModulatorFrequency = PL_A0;
    this.previousAmount = 0; this.previousFeedback = 0; this.previousSample = 0;
    this.carrierFir = 0; this.subFir = 0;
  }

  reset() {}

  render(p, out, aux, size) {
    const note = p.note - 24;
    const ratio = plInterpolate(PL_FM_FREQUENCY_QUANTIZER, p.harmonics, 128);
    const modulatorNote = note + ratio;
    const targetModulatorFrequency = plConstrain(plNoteToFrequency(modulatorNote), 0, 0.5);
    let hfTaming = plConstrain(1 - (modulatorNote - 72) * 0.025, 0, 1);
    hfTaming *= hfTaming;

    let cf = this.previousCarrierFrequency; const dcf = (plNoteToFrequency(note) - cf) / size;
    let mf = this.previousModulatorFrequency; const dmf = (targetModulatorFrequency - mf) / size;
    let am = this.previousAmount; const dam = (2 * p.timbre * p.timbre * hfTaming - am) / size;
    let fb = this.previousFeedback; const dfb = (2 * p.morph - 1 - fb) / size;
    const fir = PL_4X_DOWNSAMPLER_FIR;
    let cHead = this.carrierFir, cTail = 0, sHead = this.subFir, sTail = 0;
    let prev = this.previousSample;
    let cp = this.carrierPhase, mp = this.modulatorPhase, sp = this.subPhase;

    for (let n = 0; n < size; n++) {
      am += dam; fb += dfb; cf += dcf; mf += dmf;
      const amount = am, feedback = fb;
      const phaseFeedback = feedback < 0 ? 0.5 * feedback * feedback : 0;
      const carrierIncrement = (4294967296 * cf) >>> 0;
      for (let j = 0; j < PL_OVERSAMPLING; j++) {
        mp = (mp + ((4294967296 * mf * (1 + prev * phaseFeedback)) >>> 0)) >>> 0;
        cp = (cp + carrierIncrement) >>> 0;
        sp = (sp + (carrierIncrement >>> 1)) >>> 0;
        const modulatorFb = feedback > 0 ? 0.25 * feedback * feedback : 0;
        const modulator = plSinePM(mp, modulatorFb * prev);
        const carrier = plSinePM(cp, amount * modulator);
        const sub = plSinePM(sp, amount * carrier * 0.25);
        prev += 0.05 * (carrier - prev);
        cHead += carrier * fir[3 - j]; cTail += carrier * fir[j];
        sHead += sub * fir[3 - j]; sTail += sub * fir[j];
      }
      out[n] = cHead; cHead = cTail; cTail = 0;
      aux[n] = sHead; sHead = sTail; sTail = 0;
    }
    this.carrierFir = cHead; this.subFir = sHead;
    this.previousSample = prev;
    this.carrierPhase = cp; this.modulatorPhase = mp; this.subPhase = sp;
    this.previousCarrierFrequency = cf; this.previousModulatorFrequency = mf;
    this.previousAmount = am; this.previousFeedback = fb;
    return false;
  }
}

// ---- 4: granular formant oscillator (grain_engine.cc)
// OUT: two grainlet oscillators, formants at TIMBRE and TIMBRE times HARMONICS' ratio, carrier shape on MORPH.
// AUX: the Z oscillator, a filter sweep (TIMBRE) of a carrier shape (MORPH) reset in different ways (HARMONICS).
class PlGrainEngine {
  constructor() {
    this.grainlet = [new PlGrainletOscillator(), new PlGrainletOscillator()];
    this.zOscillator = new PlZOscillator();
    this.dcBlocker = [new PlOnePole(), new PlOnePole()];
  }

  reset() {}

  render(p, out, aux, size) {
    const f0 = plNoteToFrequency(p.note);
    const f1 = plNoteToFrequency(24 + 84 * p.timbre);
    const ratio = plSemitonesToRatio(-24 + 48 * p.harmonics);
    const bleed = p.harmonics < 0.5 ? 1 - 2 * p.harmonics : 0;
    const bleedFixed = bleed * (2 - bleed);
    const carrierShape = 0.33 + (p.morph - 0.33) * Math.max(1 - f0 * 24, 0);
    this.grainlet[0].render(f0, f1, carrierShape, bleedFixed, out, size);
    this.grainlet[1].render(f0, f1 * ratio, carrierShape, bleedFixed, aux, size);
    this.dcBlocker[0].setF(PL_FREQ_DIRTY, 0.3 * f0);
    for (let i = 0; i < size; i++) out[i] = this.dcBlocker[0].process(PL_HIGH_PASS, out[i] + aux[i]);
    const cutoff = plNoteToFrequency(p.note + 96 * p.timbre);
    this.zOscillator.render(f0, cutoff, p.morph, p.harmonics, aux, size);
    this.dcBlocker[1].setF(PL_FREQ_DIRTY, 0.3 * f0);
    this.dcBlocker[1].processBuffer(PL_HIGH_PASS, aux, size);
    return false;
  }
}

// ---- 5: additive (additive_engine.cc)
// OUT: 24 harmonics, a bump of them centred on TIMBRE, as wide as MORPH, with peaks HARMONICS adds.
// AUX: the same bump on the eight harmonics of a drawbar organ.
const PL_INTEGER_HARMONICS = Array.from({ length: 24 }, (_, i) => i);
const PL_ORGAN_HARMONICS = [0, 1, 2, 3, 5, 7, 9, 11];

class PlAdditiveEngine {
  constructor() {
    this.amplitudes = new Float64Array(36);
    this.harmonicOscillator = [new PlHarmonicOscillator(12), new PlHarmonicOscillator(12), new PlHarmonicOscillator(12)];
  }

  reset() { this.amplitudes.fill(0); }

  updateAmplitudes(centroid, slope, bumps, offset, harmonicIndices) {
    const amplitudes = this.amplitudes, num = harmonicIndices.length;
    const n = num - 1;
    const margin = (1 / slope - 1) / (1 + bumps);
    const center = centroid * (n + margin) - 0.5 * margin;
    let sum = 0.001;
    for (let i = 0; i < num; i++) {
      const order = Math.abs(i - center) * slope;
      let gain = 1 - order;
      gain += Math.abs(gain);
      gain *= gain;
      gain *= 1 + plSine(0.25 + order * bumps);
      gain *= gain;
      gain *= gain;
      const j = offset + harmonicIndices[i];
      amplitudes[j] += 0.001 * (gain - amplitudes[j]);
      sum += amplitudes[j];
    }
    sum = 1 / sum;
    for (let i = 0; i < num; i++) amplitudes[offset + harmonicIndices[i]] *= sum;
  }

  render(p, out, aux, size) {
    const f0 = plNoteToFrequency(p.note);
    const centroid = p.timbre, rawBumps = p.harmonics;
    const rawSlope = (1 - 0.6 * rawBumps) * p.morph;
    const slope = 0.01 + 1.99 * rawSlope * rawSlope * rawSlope;
    const bumps = 16 * rawBumps * rawBumps;
    this.updateAmplitudes(centroid, slope, bumps, 0, PL_INTEGER_HARMONICS);
    this.harmonicOscillator[0].render(1, f0, this.amplitudes, 0, out, size);
    this.harmonicOscillator[1].render(13, f0, this.amplitudes, 12, out, size);
    this.updateAmplitudes(centroid, slope, bumps, 24, PL_ORGAN_HARMONICS);
    this.harmonicOscillator[2].render(1, f0, this.amplitudes, 24, aux, size);
    return false;
  }
}

// ---- 6: wavetable (wavetable_engine.cc)
// Four banks of 8 x 8 waves: TIMBRE moves along a row, MORPH down a column, HARMONICS between banks (past the
// fourth it runs back, the waves snapping to the grid). AUX: the same at 5 bits.
const PL_WT_TABLE = 128, PL_WT_STRIDE = PL_WT_TABLE + 4, PL_WT_WAVES = 192, PL_WT_PER_BANK = 64;
// where each wave starts in PL_INTEGRATED_WAVES; the fourth bank (the module's user bank) is its default, a mix
const PL_WT_MAP = Int32Array.from({ length: 4 * PL_WT_PER_BANK }, (_, i) => (i >= 3 * PL_WT_PER_BANK ? (i * 101) % PL_WT_WAVES : i) * PL_WT_STRIDE);
function plWtClamp(x, amount) { return plConstrain((x - 0.5) * amount, -0.5, 0.5) + 0.5; }
// a position, its fraction pulled toward the nearest wave as HARMONICS goes into the last banks
function plWtSnap(v, quantization) { const i = v | 0; let f = v - i; f += quantization * (plWtClamp(f, 16) - f); return i + f; }

class PlWavetableEngine {
  constructor() {
    this.phase = 0;
    this.xLp = 0; this.yLp = 0; this.zLp = 0;
    this.xPreLp = 0; this.yPreLp = 0; this.zPreLp = 0;
    this.previousX = 0; this.previousY = 0; this.previousZ = 0; this.previousF0 = PL_A0;
    this.diffLp = 0; this.diffPrevious = 0;
  }

  reset() {}

  readWave(x, y, z, pi, pf) {
    const t = PL_INTEGRATED_WAVES, o = PL_WT_MAP[x + y * 8 + z * PL_WT_PER_BANK] + pi;
    const xm1 = t[o], x0 = t[o + 1], x1 = t[o + 2], x2 = t[o + 3];
    const c = (x1 - xm1) * 0.5, v = x0 - x1, w = c + v, a = w + v + (x2 - x0) * 0.5, bNeg = w + a;
    return (((a * pf) - bNeg) * pf + c) * pf + x0;
  }

  render(p, out, aux, size) {
    const f0 = plNoteToFrequency(p.note);
    this.xPreLp += 0.2 * (p.timbre * 6.9999 - this.xPreLp);
    this.yPreLp += 0.2 * (p.morph * 6.9999 - this.yPreLp);
    this.zPreLp += 0.05 * (p.harmonics * 6.9999 - this.zPreLp);
    const quantization = Math.min(Math.max(this.zPreLp - 3, 0), 1);
    const lpCoefficient = Math.min(Math.max(2 * f0 * (4 - 3 * quantization), 0.01), 0.1);
    let xv = this.previousX; const dx = (plWtSnap(this.xPreLp, quantization) - xv) / size;
    let yv = this.previousY; const dy = (plWtSnap(this.yPreLp, quantization) - yv) / size;
    let zv = this.previousZ; const dz = (plWtSnap(this.zPreLp, quantization) - zv) / size;
    let fv = this.previousF0; const df = (f0 - fv) / size;

    for (let n = 0; n < size; n++) {
      fv += df; xv += dx; yv += dy; zv += dz;
      const f = fv;
      const gain = (1 / (f * 131072)) * (0.95 - f);
      const cutoff = Math.min(PL_WT_TABLE * f, 1);
      this.xLp += lpCoefficient * (xv - this.xLp);
      this.yLp += lpCoefficient * (yv - this.yLp);
      this.zLp += lpCoefficient * (zv - this.zLp);
      const xi = this.xLp | 0, xf = this.xLp - xi;
      const yi = this.yLp | 0, yf = this.yLp - yi;
      const zi = this.zLp | 0, zf = this.zLp - zi;
      this.phase += f;
      if (this.phase >= 1) this.phase -= 1;
      const ph = this.phase * PL_WT_TABLE, pi = ph | 0, pf = ph - pi;
      let z0 = zi, z1 = zi + 1;
      if (z0 >= 4) z0 = 7 - z0;
      if (z1 >= 4) z1 = 7 - z1;
      const x0 = xi, x1 = xi + 1, y0 = yi, y1 = yi + 1;
      const xy0z0 = this.readWave(x0, y0, z0, pi, pf) + (this.readWave(x1, y0, z0, pi, pf) - this.readWave(x0, y0, z0, pi, pf)) * xf;
      const xy1z0 = this.readWave(x0, y1, z0, pi, pf) + (this.readWave(x1, y1, z0, pi, pf) - this.readWave(x0, y1, z0, pi, pf)) * xf;
      const xyz0 = xy0z0 + (xy1z0 - xy0z0) * yf;
      const xy0z1 = this.readWave(x0, y0, z1, pi, pf) + (this.readWave(x1, y0, z1, pi, pf) - this.readWave(x0, y0, z1, pi, pf)) * xf;
      const xy1z1 = this.readWave(x0, y1, z1, pi, pf) + (this.readWave(x1, y1, z1, pi, pf) - this.readWave(x0, y1, z1, pi, pf)) * xf;
      const xyz1 = xy0z1 + (xy1z1 - xy0z1) * yf;
      let mix = xyz0 + (xyz1 - xyz0) * zf;
      // the waves are stored integrated: differentiate (gently low-passed) to play them
      this.diffLp += cutoff * (mix - this.diffPrevious - this.diffLp);
      this.diffPrevious = mix;
      mix = this.diffLp * gain;
      out[n] = mix;
      aux[n] = Math.trunc(mix * 32) / 32;
    }
    this.previousX = xv; this.previousY = yv; this.previousZ = zv; this.previousF0 = fv;
    return false;
  }
}

// ---- 7: chords (chord_engine.cc, plaits/dsp/chords/chord_bank.cc)
// HARMONICS: which chord (11), TIMBRE: its inversion and voicing, MORPH: from a string machine's divide-down saws
// (organ-like registrations) to wavetables. AUX: the root alone, an octave down (the voice the inversion drops).
const PL_CHORD_NOTES = 4, PL_CHORD_VOICES = 5, PL_CHORD_HARMONICS = 3;
const PL_CHORDS = [
  [0, 0.01, 11.99, 12], [0, 7, 7.01, 12], [0, 5, 7, 12], [0, 3, 7, 12], [0, 3, 7, 10], [0, 3, 10, 14],
  [0, 3, 10, 17], [0, 2, 9, 16], [0, 4, 11, 14], [0, 4, 7, 11], [0, 4, 7, 12],
];

class PlChordBank {
  constructor() {
    this.ratios = new Float64Array(PL_CHORDS.length * PL_CHORD_NOTES);
    this.noteCount = new Int32Array(PL_CHORDS.length);
    this.sortedRatios = new Float64Array(PL_CHORD_NOTES);
    this.quantizer = new PlHysteresisQuantizer(PL_CHORDS.length, 0.075, false);
  }
  reset() {
    PL_CHORDS.forEach((chord, i) => {
      let count = 0;
      chord.forEach((st, j) => {
        this.ratios[i * PL_CHORD_NOTES + j] = plSemitonesToRatio(st);
        if (st !== 0.01 && st !== 7.01 && st !== 11.99 && st !== 12) count++;
      });
      this.noteCount[i] = count;
    });
  }
  setChord(parameter) { this.quantizer.process(parameter * 1.02); }
  chordIndex() { return this.quantizer.quantizedValue; }
  // fills ratios and amplitudes for the five voices; returns which voices go to AUX
  computeChordInversion(inversion, ratios, amplitudes) {
    const base = this.chordIndex() * PL_CHORD_NOTES;
    inversion = inversion * (PL_CHORD_NOTES * PL_CHORD_VOICES);
    const ii = inversion | 0, fi = inversion - ii;
    const numRotations = (ii / PL_CHORD_NOTES) | 0, rotatedNote = ii % PL_CHORD_NOTES;
    const kBaseGain = 0.25;
    let mask = 0;
    for (let i = 0; i < PL_CHORD_NOTES; i++) {
      const transposition = 0.25 * (1 << (((PL_CHORD_NOTES - 1 + ii - i) / PL_CHORD_NOTES) | 0));
      const target = (i - numRotations + PL_CHORD_VOICES) % PL_CHORD_VOICES;
      const previous = (target - 1 + PL_CHORD_VOICES) % PL_CHORD_VOICES;
      if (i === rotatedNote) {
        ratios[target] = this.ratios[base + i] * transposition;
        ratios[previous] = ratios[target] * 2;
        amplitudes[previous] = kBaseGain * fi;
        amplitudes[target] = kBaseGain * (1 - fi);
      } else if (i < rotatedNote) {
        ratios[previous] = this.ratios[base + i] * transposition;
        amplitudes[previous] = kBaseGain;
      } else {
        ratios[target] = this.ratios[base + i] * transposition;
        amplitudes[target] = kBaseGain;
      }
      if (i === 0) {
        if (i >= rotatedNote) mask |= 1 << target;
        if (i <= rotatedNote) mask |= 1 << previous;
      }
    }
    return mask;
  }
}

const PL_FADE_POINT = [0.55, 0.47, 0.49, 0.51, 0.53];
const PL_REGISTRATIONS = [
  [0, 1, 0, 0, 0, 0], [1, 0, 0, 0, 0, 0], [0.5, 0, 0.5, 0, 0, 0], [0.33, 0, 0.33, 0, 0.33, 0],
  [0.33, 0, 0, 0.33, 0, 0.33], [0.5, 0, 0, 0, 0, 0.5], [0, 0.5, 0, 0, 0, 0.5], [0, 0.1, 0.1, 0, 0.2, 0.6],
];
const PL_CHORD_WAVES = Int32Array.from([
  [2, 6, 1], [2, 6, 6], [2, 6, 4], [0, 6, 0], [0, 6, 1], [0, 6, 2], [0, 6, 7], [2, 4, 7], [2, 4, 6], [2, 4, 5],
  [2, 4, 4], [2, 4, 3], [2, 4, 2], [2, 4, 1], [2, 4, 0],
], ([bank, row, column]) => (bank * 64 + row * 8 + column) * 132);

class PlChordEngine {
  constructor() {
    this.divideDownVoice = Array.from({ length: PL_CHORD_VOICES }, () => new PlStringSynthOscillator());
    this.wavetableVoice = Array.from({ length: PL_CHORD_VOICES }, () => new PlWavetableOscillator(128, 15));
    this.chords = new PlChordBank();
    this.morphLp = 0; this.timbreLp = 0;
    this.harmonics = new Float64Array(PL_CHORD_HARMONICS * 2 + 2);
    this.ratios = new Float64Array(PL_CHORD_VOICES);
    this.noteAmplitudes = new Float64Array(PL_CHORD_VOICES);
  }

  reset() { this.chords.reset(); }

  render(p, out, aux, size) {
    this.morphLp += 0.1 * (p.morph - this.morphLp);
    this.timbreLp += 0.1 * (p.timbre - this.timbreLp);
    this.chords.setChord(p.harmonics);
    const harmonics = this.harmonics;
    let registration = Math.max(1 - this.morphLp * 2.15, 0) * (PL_REGISTRATIONS.length - 1.001);
    const ri = registration | 0, rf = registration - ri;
    for (let i = 0; i < PL_CHORD_HARMONICS * 2; i++) {
      const a = PL_REGISTRATIONS[ri][i], b = PL_REGISTRATIONS[ri + 1][i];
      harmonics[i] = a + (b - a) * rf;
    }
    harmonics[PL_CHORD_HARMONICS * 2] = 0;
    const auxMask = this.chords.computeChordInversion(this.timbreLp, this.ratios, this.noteAmplitudes);
    out.fill(0, 0, size);
    aux.fill(0, 0, size);
    const f0 = plNoteToFrequency(p.note) * 0.998;
    const waveform = Math.max((this.morphLp - 0.535) * 2.15, 0);
    for (let note = 0; note < PL_CHORD_VOICES; note++) {
      const wavetableAmount = plConstrain(50 * (this.morphLp - PL_FADE_POINT[note]), 0, 1);
      let divideDownAmount = 1 - wavetableAmount;
      const destination = (1 << note) & auxMask ? aux : out;
      const noteF0 = f0 * this.ratios[note];
      divideDownAmount *= plConstrain(4 - noteF0 * 32, 0, 1);
      if (wavetableAmount) {
        this.wavetableVoice[note].render(noteF0 * 1.004, this.noteAmplitudes[note] * wavetableAmount, waveform,
          PL_INTEGRATED_WAVES, PL_CHORD_WAVES, destination, size);
      }
      if (divideDownAmount) {
        this.divideDownVoice[note].render(noteF0, harmonics, this.noteAmplitudes[note] * divideDownAmount, destination, size);
      }
    }
    for (let i = 0; i < size; i++) { out[i] += aux[i]; aux[i] *= 3; }
    return false;
  }
}

// ---- 8: speech (speech_engine.cc and plaits/dsp/speech/*)
// HARMONICS: a formant synth fading into SAM, then an LPC synth (Speak & Spell style) fading into SAM, then four
// banks of LPC words. MORPH: the vowel, or which word; TIMBRE: the formants' shift (and so the speed of words).
// AUX: the excitation, before the formants.

// naive_speech_synth.cc: five formants per phoneme and register, [frequency, amplitude] as notes and /256
const PL_NAIVE_PHONEMES = [
  [[[74, 255], [83, 114], [97, 90], [98, 90], [100, 25]], [[75, 255], [84, 128], [100, 114], [101, 101], [103, 20]], [[76, 255], [85, 128], [100, 18], [102, 16], [104, 3]], [[79, 255], [85, 161], [101, 25], [104, 4], [110, 0]], [[79, 255], [85, 128], [101, 6], [106, 25], [110, 0]]],
  [[[67, 255], [91, 64], [98, 90], [101, 64], [102, 32]], [[67, 255], [92, 51], [99, 64], [103, 51], [105, 25]], [[69, 255], [93, 51], [100, 32], [102, 25], [103, 25]], [[67, 255], [91, 16], [100, 8], [103, 4], [110, 0]], [[65, 255], [95, 25], [101, 45], [105, 2], [110, 0]]],
  [[[59, 255], [92, 8], [99, 40], [102, 20], [104, 10]], [[61, 255], [94, 45], [101, 32], [103, 25], [105, 8]], [[60, 255], [93, 16], [101, 16], [104, 4], [105, 4]], [[65, 255], [92, 25], [100, 8], [105, 4], [110, 0]], [[60, 255], [96, 64], [101, 12], [106, 12], [110, 1]]],
  [[[67, 255], [78, 72], [98, 22], [99, 25], [101, 2]], [[67, 255], [79, 80], [99, 64], [101, 64], [102, 12]], [[68, 255], [79, 80], [100, 12], [102, 20], [103, 5]], [[69, 255], [79, 90], [101, 40], [104, 10], [110, 0]], [[69, 255], [79, 72], [101, 20], [106, 20], [110, 0]]],
  [[[65, 255], [74, 25], [98, 6], [100, 10], [101, 4]], [[65, 255], [74, 25], [100, 36], [101, 51], [103, 12]], [[66, 255], [75, 25], [100, 18], [102, 8], [104, 5]], [[63, 255], [77, 64], [99, 8], [104, 2], [110, 0]], [[63, 255], [77, 40], [100, 4], [106, 2], [110, 0]]],
];

class PlNaiveSpeechSynth {
  constructor() {
    this.pulse = new PlOscillator();
    this.clickDuration = 0;
    this.filter = Array.from({ length: 5 }, () => new PlSvf());
    this.pulseColoration = new PlSvf();
    this.pulseColoration.setFQ(PL_FREQ_DIRTY, 800 / PL_SAMPLE_RATE, 0.5);
  }
  render(click, frequency, phoneme, register, temp, excitation, output, size) {
    if (click) this.clickDuration = (PL_SAMPLE_RATE * 0.05) | 0;
    this.clickDuration -= Math.min(this.clickDuration, size);
    if (this.clickDuration) frequency *= 0.5;
    this.pulse.render(PL_SHAPE_IMPULSE_TRAIN, frequency, 0.5, excitation, size);
    this.pulseColoration.processBuffer(PL_BAND_PASS, excitation, excitation, size);
    for (let i = 0; i < size; i++) excitation[i] *= 4;
    const pv = phoneme * (5 - 1.001), rv = register * (5 - 1.001);
    const pi = pv | 0, pf = pv - pi, ri = rv | 0, rf = rv - ri;
    output.fill(0, 0, size);
    for (let i = 0; i < 5; i++) {
      const p0r0 = PL_NAIVE_PHONEMES[pi][ri][i], p0r1 = PL_NAIVE_PHONEMES[pi][ri + 1][i];
      const p1r0 = PL_NAIVE_PHONEMES[pi + 1][ri][i], p1r1 = PL_NAIVE_PHONEMES[pi + 1][ri + 1][i];
      const f0 = p0r0[0] + (p0r1[0] - p0r0[0]) * rf, f1 = p1r0[0] + (p1r1[0] - p1r0[0]) * rf;
      let f = f0 + (f1 - f0) * pf;
      const a0v = p0r0[1] + (p0r1[1] - p0r0[1]) * rf, a1v = p1r0[1] + (p1r1[1] - p1r0[1]) * rf;
      const a = (a0v + (a1v - a0v) * pf) / 256;
      if (f >= 160) f = 160;
      f = PL_A0 * plSemitonesToRatio(f - 33);
      if (this.clickDuration && i === 0) f *= 0.5;
      this.filter[i].setFQ(PL_FREQ_DIRTY, f, 20);
      this.filter[i].processAdd(PL_BAND_PASS, excitation, output, size, a);
    }
  }
}

// sam_speech_synth.cc: three sine formants reset every pitch period, as SAM on the C64
const PL_SAM_PHONEMES = [
  [[60, 15], [90, 13], [200, 1]], [[40, 13], [114, 12], [139, 6]], [[33, 14], [155, 12], [209, 7]], [[22, 13], [189, 10], [247, 8]],
  [[51, 15], [99, 12], [195, 1]], [[29, 13], [65, 8], [180, 0]], [[13, 12], [103, 3], [182, 0]], [[20, 15], [114, 3], [213, 0]],
  [[13, 7], [164, 3], [222, 14]], [[13, 9], [121, 9], [254, 0]], [[40, 12], [112, 10], [114, 5]], [[24, 13], [54, 8], [157, 0]],
  [[33, 14], [155, 12], [166, 7]], [[36, 14], [83, 8], [249, 1]], [[40, 14], [114, 12], [139, 6]], [[13, 5], [58, 5], [182, 5]],
  [[13, 7], [164, 10], [222, 14]], [[13, 7], [164, 10], [222, 14]],
];
const PL_SAM_AMPLITUDE = [0.03125, 0.03756299, 0.04515131, 0.05427259, 0.06523652, 0.07841532, 0.09425646, 0.11329776,
  0.1361857, 0.16369736, 0.19676682, 0.23651683, 0.28429697, 0.34172946, 0.41076422, 0.49374509];
const PL_SAM_VOWELS = 9, PL_SAM_CONSONANTS = 8;

class PlSAMSpeechSynth {
  constructor() {
    this.phase = 0; this.frequency = 0; this.pulseNextSample = 0; this.pulseLp = 0;
    this.formantPhase = new Uint32Array(3); this.consonantSamples = 0; this.consonantIndex = 0;
    this.formantFrequency = new Uint32Array(3); this.formantAmplitude = new Float64Array(3);
  }
  interpolate(phoneme, formantShift) {
    const pi = phoneme | 0, pf = phoneme - pi;
    const p1 = PL_SAM_PHONEMES[pi], p2 = PL_SAM_PHONEMES[pi + 1];
    formantShift = 1 + formantShift * 2.5;
    for (let i = 0; i < 3; i++) {
      let f = p1[i][0] + (p2[i][0] - p1[i][0]) * pf;
      f *= 8 * formantShift * 4294967296 / PL_SAMPLE_RATE;
      this.formantFrequency[i] = f >>> 0;
      const a1 = PL_SAM_AMPLITUDE[p1[i][1]], a2 = PL_SAM_AMPLITUDE[p2[i][1]];
      this.formantAmplitude[i] = a1 + (a2 - a1) * pf;
    }
  }
  render(consonant, frequency, vowel, formantShift, excitation, output, size) {
    if (frequency >= 0.0625) frequency = 0.0625;
    if (consonant) {
      this.consonantSamples = (PL_SAMPLE_RATE * 0.05) | 0;
      const r = ((vowel + 3 * frequency + 7 * formantShift) * 8) | 0;
      this.consonantIndex = r % PL_SAM_CONSONANTS;
    }
    this.consonantSamples -= Math.min(this.consonantSamples, size);
    const phoneme = this.consonantSamples ? this.consonantIndex + PL_SAM_VOWELS : vowel * (PL_SAM_VOWELS - 1.0001);
    this.interpolate(phoneme, formantShift);
    const ff = this.formantFrequency, fa = this.formantAmplitude, fp = this.formantPhase;
    let fv = this.frequency; const df = (frequency - fv) / size;
    let pulseNextSample = this.pulseNextSample;
    for (let n = 0; n < size; n++) {
      let pulseThisSample = pulseNextSample;
      pulseNextSample = 0;
      fv += df;
      const f = fv;
      this.phase += f;
      if (this.phase >= 1) {
        this.phase -= 1;
        const t = this.phase / f;
        fp[0] = t * ff[0]; fp[1] = t * ff[1]; fp[2] = t * ff[2];
        pulseThisSample -= plThisBlepSample(t);
        pulseNextSample -= plNextBlepSample(t);
      } else {
        fp[0] += ff[0]; fp[1] += ff[1]; fp[2] += ff[2];
      }
      pulseNextSample += this.phase;
      const d = pulseThisSample - 0.5 - this.pulseLp;
      this.pulseLp += Math.min(16 * f, 1) * d;
      excitation[n] = d;
      let s = plSineRaw(fp[0]) * fa[0] + plSineRaw(fp[1]) * fa[1] + plSineRaw(fp[2]) * fa[2];
      output[n] = s * (1 - this.phase);
    }
    this.pulseNextSample = pulseNextSample;
    this.frequency = fv;
  }
}

// lpc_speech_synth.cc: a ten-pole lattice filter, excited by a glottal pulse or noise, at 8 kHz
const PL_LPC_ORDER = 10, PL_LPC_DEFAULT_F0 = 100;
// a frame: [energy, period, k0 .. k9] (k0, k1 in 1/32768, the others in 1/128), as in PL_LPC_PHONEMES
class PlLPCSpeechSynth {
  constructor() {
    this.phase = 0; this.frequency = 0.0125; this.noiseEnergy = 0; this.pulseEnergy = 0;
    this.nextSample = 0; this.pulseIndex = 0;
    this.k = new Float64Array(PL_LPC_ORDER); this.s = new Float64Array(PL_LPC_ORDER + 1); this.e = new Float64Array(11);
  }
  // renders one sample into excitation[0] and output[0] (the controller calls it once per 8 kHz tick)
  // the pitch phase is kept in single precision, as on the module: where it wraps picks a step of the glottal pulse
  // (32 a tick), and a drift of a few steps is audible through the lattice
  render(prosodyAmount, pitchShift, out) {
    const fr = Math.fround;
    const baseF0 = fr(PL_LPC_DEFAULT_F0 / 8000);
    const f = plConstrain(fr(fr(baseF0 + fr(fr(this.frequency - baseF0) * prosodyAmount)) * pitchShift), 0, 0.5);
    const pulse = PL_LPC_EXCITATION_PULSE, N = PL_LPC_EXCITATION_PULSE.length;
    let nextSample = this.nextSample;
    this.phase = fr(this.phase + f);
    let thisSample = nextSample;
    nextSample = 0;
    if (this.phase >= 1) {
      this.phase = fr(this.phase - 1);
      const resetTime = fr(this.phase / f);
      const resetSample = (32 * resetTime) | 0;
      let d = 0;
      if (this.pulseIndex < N) {
        this.pulseIndex -= resetSample;
        d = pulse[this.pulseIndex] / 128 * this.pulseEnergy;
      }
      thisSample += -d * plThisBlepSample(resetTime);
      nextSample += -d * plNextBlepSample(resetTime);
      this.pulseIndex = resetSample;
    }
    const e = this.e, k = this.k, s = this.s;
    e[10] = plRandomSample() > 0 ? this.noiseEnergy : -this.noiseEnergy;
    if (this.pulseIndex < N) {
      nextSample += pulse[this.pulseIndex] / 128 * this.pulseEnergy;
      this.pulseIndex += 32;
    }
    e[10] = (e[10] + thisSample) * 1.5;
    for (let i = 9; i >= 0; i--) e[i] = e[i + 1] - k[i] * s[i];
    e[0] = plConstrain(e[0], -2, 2);
    for (let i = 9; i >= 1; i--) s[i] = s[i - 1] + k[i - 1] * e[i - 1];
    s[0] = e[0];
    out[0] = e[10];
    out[1] = e[0];
    this.nextSample = nextSample;
  }
  // frames: a flat Int32Array of 12 values each; frame: where, between two of them
  playFrame(frames, frame, interpolate) {
    const fi = frame | 0;
    const blend = interpolate ? frame - fi : 0;
    // at a blend of 0 the second frame does not count: the original reads past the last phoneme there (unused)
    const a = fi * 12, b = blend === 0 ? a : (fi + 1) * 12;
    const freq1 = frames[a + 1] === 0 ? this.frequency : 1 / frames[a + 1];
    const freq2 = frames[b + 1] === 0 ? this.frequency : 1 / frames[b + 1];
    this.frequency = freq1 + (freq2 - freq1) * blend;
    const e1 = frames[a] / 256, e2 = frames[b] / 256;
    const n1 = frames[a + 1] === 0 ? e1 : 0, n2 = frames[b + 1] === 0 ? e2 : 0;
    this.noiseEnergy = n1 + (n2 - n1) * blend;
    const p1 = frames[a + 1] !== 0 ? e1 : 0, p2 = frames[b + 1] !== 0 ? e2 : 0;
    this.pulseEnergy = p1 + (p2 - p1) * blend;
    for (let i = 0; i < PL_LPC_ORDER; i++) {
      const scale = i < 2 ? 32768 : 128;
      const x = frames[a + 2 + i] / scale, y = frames[b + 2 + i] / scale;
      this.k[i] = x + (y - x) * blend;
    }
  }
}

// lpc_speech_synth_controller.cc: words, from the banks' bit streams into frames
const PL_LPC_ENERGY = [0x00, 0x02, 0x03, 0x04, 0x05, 0x07, 0x0a, 0x0f, 0x14, 0x20, 0x29, 0x39, 0x51, 0x72, 0xa1, 0xff];
const PL_LPC_PERIOD = [0, 16, 17, 18, 19, 20, 21, 22, 23, 24, 25, 26, 27, 28, 29, 30, 31, 32, 33, 34, 35, 36, 37, 38, 39, 40,
  41, 42, 43, 45, 47, 49, 51, 53, 54, 57, 59, 61, 63, 66, 69, 71, 73, 77, 79, 81, 85, 87, 92, 95, 99, 102, 106, 110, 115,
  119, 123, 128, 133, 138, 143, 149, 154, 160];
const PL_LPC_K = [
  [-32064, -31872, -31808, -31680, -31552, -31424, -31232, -30848, -30592, -30336, -30016, -29696, -29376, -28928, -28480,
    -27968, -26368, -24256, -21632, -18368, -14528, -10048, -5184, 0, 5184, 10048, 14528, 18368, 21632, 24256, 26368, 27968],
  [-20992, -19328, -17536, -15552, -13440, -11200, -8768, -6272, -3712, -1088, 1536, 4160, 6720, 9216, 11584, 13824, 15936,
    17856, 19648, 21248, 22656, 24000, 25152, 26176, 27072, 27840, 28544, 29120, 29632, 30080, 30464, 32384],
  [-110, -97, -83, -70, -56, -43, -29, -16, -2, 11, 25, 38, 52, 65, 79, 92],
  [-82, -68, -54, -40, -26, -12, 1, 15, 29, 43, 57, 71, 85, 99, 113, 126],
  [-82, -70, -59, -47, -35, -24, -12, -1, 11, 23, 34, 46, 57, 69, 81, 92],
  [-64, -53, -42, -31, -20, -9, 3, 14, 25, 36, 47, 58, 69, 80, 91, 102],
  [-77, -65, -53, -41, -29, -17, -5, 7, 19, 31, 43, 55, 67, 79, 90, 102],
  [-64, -40, -16, 7, 31, 55, 79, 102],
  [-64, -44, -24, -4, 16, 37, 57, 77],
  [-51, -33, -15, 4, 22, 32, 59, 77],
];
const PL_LPC_K_BITS = [5, 5, 4, 4, 4, 4, 4, 3, 3, 3];
const PL_WORD_BANKS = [PL_WORD_BANK_0, PL_WORD_BANK_1, PL_WORD_BANK_2, PL_WORD_BANK_3, PL_WORD_BANK_4];
const PL_LPC_MAX_WORDS = 32, PL_LPC_MAX_FRAMES = 1024, PL_LPC_VOWELS = 5, PL_LPC_CONSONANTS = 10, PL_LPC_FPS = 40;

class PlBitStream {
  constructor(data, at) { this.data = data; this.p = at; this.available = 0; this.bits = 0; }
  static reverse(b) {
    b = ((b >> 4) | (b << 4)) & 0xff;
    b = (((b & 0xcc) >> 2) | ((b & 0x33) << 2)) & 0xff;
    return (((b & 0xaa) >> 1) | ((b & 0x55) << 1)) & 0xff;
  }
  getBits(n) {
    let shift = n;
    if (n > this.available) {
      this.bits = (this.bits << this.available) & 0xffff;
      shift -= this.available;
      this.bits |= PlBitStream.reverse(this.data[this.p++]);
      this.available += 8;
    }
    this.bits = (this.bits << shift) & 0xffff;
    const result = (this.bits >> 8) & 0xff;
    this.bits &= 0xff;
    this.available -= n;
    return result;
  }
  flush() { while (this.available) this.getBits(1); }
}

class PlLPCWordBank {
  constructor() {
    this.frames = new Int32Array(PL_LPC_MAX_FRAMES * 12);
    this.wordBoundaries = new Int32Array(PL_LPC_MAX_WORDS);
    this.reset();
  }
  reset() { this.loadedBank = -1; this.numFrames = 0; this.numWords = 0; this.wordBoundaries.fill(0); }
  loadNextWord(data, at) {
    const bs = new PlBitStream(data, at);
    const frame = [0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0];
    for (;;) {
      const energy = bs.getBits(4);
      if (energy === 0) frame[0] = 0;
      else if (energy === 0xf) { bs.flush(); break; }
      else {
        frame[0] = PL_LPC_ENERGY[energy];
        const repeat = bs.getBits(1);
        frame[1] = PL_LPC_PERIOD[bs.getBits(6)];
        if (!repeat) {
          const last = frame[1] ? 10 : 4;
          for (let i = 0; i < last; i++) frame[2 + i] = PL_LPC_K[i][bs.getBits(PL_LPC_K_BITS[i])];
        }
      }
      this.frames.set(frame, this.numFrames++ * 12);
    }
    return bs.p - at;
  }
  load(bank) {
    if (bank === this.loadedBank || bank >= PL_WORD_BANKS.length) return false;
    this.numFrames = 0; this.numWords = 0;
    const data = PL_WORD_BANKS[bank];
    let at = 0;
    while (at < data.length) {
      this.wordBoundaries[this.numWords] = this.numFrames;
      at += this.loadNextWord(data, at);
      this.numWords++;
    }
    this.wordBoundaries[this.numWords] = this.numFrames;
    this.loadedBank = bank;
    return true;
  }
  // [first frame, last frame] of the word at address 0..1
  wordBoundariesAt(address, out) {
    if (this.numWords === 0) { out[0] = out[1] = -1; return; }
    let word = (address * this.numWords) | 0;
    if (word >= this.numWords) word = this.numWords - 1;
    out[0] = this.wordBoundaries[word];
    out[1] = this.wordBoundaries[word + 1] - 1;
  }
}

class PlLPCSpeechSynthController {
  constructor(wordBank) {
    this.wordBank = wordBank;
    this.clockPhase = 0; this.playbackFrame = -1; this.lastPlaybackFrame = -1; this.remainingFrameSamples = 0;
    this.sample = [0, 0]; this.nextSample = [0, 0]; this.gain = 0;
    this.synth = new PlLPCSpeechSynth();
    this.newSample = [0, 0]; this.bounds = [0, 0];
  }
  render(freeRunning, trigger, bank, frequency, prosodyAmount, speed, address, formantShift, gain, excitation, output, size) {
    const fr = Math.fround;
    const rateRatio = fr(plSemitonesToRatio(fr(fr(formantShift - 0.5) * 36)));
    // the synth runs at 8 kHz (the module's 48 kHz / 6), whatever the rate here; in single precision, as above
    const rate = fr(rateRatio * fr(8000 / PL_SAMPLE_RATE));
    const pitchShift = fr(frequency / fr(fr(rateRatio * PL_LPC_DEFAULT_F0) / fr(55 / PL_A0)));
    const timeStretch = plSemitonesToRatio(-speed * 24
      + (formantShift < 0.4 ? (formantShift - 0.4) * -45 : formantShift > 0.6 ? (formantShift - 0.6) * -45 : 0));
    if (bank !== -1 && this.wordBank.load(bank)) { this.playbackFrame = -1; this.lastPlaybackFrame = -1; }
    // a word still playing when HARMONICS drops back to the vowels would go on past the 15 phoneme frames (in the
    // original, reading whatever memory follows them): here it goes back to scanning the vowels
    if (bank === -1 && this.playbackFrame >= PL_LPC_VOWELS + PL_LPC_CONSONANTS) { this.playbackFrame = -1; this.lastPlaybackFrame = -1; }
    const numFrames = bank === -1 ? PL_LPC_VOWELS : this.wordBank.numFrames;
    const frames = bank === -1 ? PL_LPC_PHONEMES : this.wordBank.frames;
    if (trigger) {
      if (bank === -1) {
        const r = ((address + 3 * formantShift + 7 * frequency) * 8) | 0;
        this.playbackFrame = (r % PL_LPC_CONSONANTS) + PL_LPC_VOWELS;
        this.lastPlaybackFrame = this.playbackFrame + 1;
      } else {
        this.wordBank.wordBoundariesAt(address, this.bounds);
        this.playbackFrame = this.bounds[0]; this.lastPlaybackFrame = this.bounds[1];
      }
      this.remainingFrameSamples = 0;
    }
    if (this.playbackFrame === -1 && this.remainingFrameSamples === 0) {
      this.synth.playFrame(frames, address * (numFrames - 1.0001), true);
    } else {
      if (this.remainingFrameSamples === 0) {
        this.synth.playFrame(frames, this.playbackFrame, false);
        this.remainingFrameSamples = Math.max(0, (PL_SAMPLE_RATE / PL_LPC_FPS * timeStretch) >>> 0);
        this.playbackFrame++;
        if (this.playbackFrame >= this.lastPlaybackFrame) {
          this.playbackFrame = bank === -1 || freeRunning ? -1 : this.lastPlaybackFrame;
        }
      }
      this.remainingFrameSamples -= Math.min(size, this.remainingFrameSamples);
    }
    let gv = this.gain; const dg = (gain - gv) / size;
    const smp = this.sample, nxt = this.nextSample, ns = this.newSample;
    for (let n = 0; n < size; n++) {
      const t0 = nxt[0], t1 = nxt[1];
      let this0 = t0, this1 = t1;
      nxt[0] = 0; nxt[1] = 0;
      this.clockPhase = fr(this.clockPhase + rate);
      if (this.clockPhase >= 1) {
        this.clockPhase = fr(this.clockPhase - 1);
        const resetTime = this.clockPhase / rate;
        this.synth.render(prosodyAmount, pitchShift, ns);
        const d0 = ns[0] - smp[0], d1 = ns[1] - smp[1];
        this0 += d0 * plThisBlepSample(resetTime); nxt[0] += d0 * plNextBlepSample(resetTime);
        this1 += d1 * plThisBlepSample(resetTime); nxt[1] += d1 * plNextBlepSample(resetTime);
        smp[0] = ns[0]; smp[1] = ns[1];
      }
      nxt[0] += smp[0]; nxt[1] += smp[1];
      gv += dg;
      excitation[n] = this0 * gv;
      output[n] = this1 * gv;
    }
    this.gain = gv;
  }
}

class PlSpeechEngine {
  constructor() {
    this.sam = new PlSAMSpeechSynth();
    this.naive = new PlNaiveSpeechSynth();
    this.wordBank = new PlLPCWordBank();
    this.lpc = new PlLPCSpeechSynthController(this.wordBank);
    this.wordBankQuantizer = new PlHysteresisQuantizer(PL_WORD_BANKS.length + 1, 0.1, false);
    this.temp = [new Float32Array(PL_MAX_BLOCK), new Float32Array(PL_MAX_BLOCK)];
    this.prosodyAmount = 0; this.speed = 0;
  }

  reset() { this.wordBank.reset(); }

  render(p, out, aux, size) {
    const f0 = plNoteToFrequency(p.note);
    const group = p.harmonics * 6;
    // as in the original, the formant and SAM synths click on a bare rising edge, which the module never sends
    const click = p.trigger === PL_TRIGGER_RISING_EDGE;
    if (group <= 2) {
      let blend = group;
      if (group <= 1) {
        this.naive.render(click, f0, p.morph, p.timbre, this.temp[0], aux, out, size);
      } else {
        this.lpc.render(p.trigger & PL_TRIGGER_UNPATCHED, p.trigger & PL_TRIGGER_RISING_EDGE, -1, f0, 0, 0, p.morph, p.timbre, 1, aux, out, size);
        blend = 2 - blend;
      }
      this.sam.render(click, f0, p.morph, p.timbre, this.temp[0], this.temp[1], size);
      blend *= blend * (3 - 2 * blend);
      blend *= blend * (3 - 2 * blend);
      const t0 = this.temp[0], t1 = this.temp[1];
      for (let i = 0; i < size; i++) { aux[i] += (t0[i] - aux[i]) * blend; out[i] += (t1[i] - out[i]) * blend; }
      return false;
    }
    const f = Math.fround;
    const wordBank = this.wordBankQuantizer.process(f(f(f(f(p.harmonics) * 6) - 2) * f(0.275))) - 1;
    const replayProsody = wordBank >= 0 && !(p.trigger & PL_TRIGGER_UNPATCHED);
    this.lpc.render(p.trigger & PL_TRIGGER_UNPATCHED, p.trigger & PL_TRIGGER_RISING_EDGE, wordBank, f0,
      this.prosodyAmount, this.speed, p.morph, p.timbre, replayProsody ? p.accent : 1, aux, out, size);
    return replayProsody;
  }
}

// ---- 9: swarm (swarm_engine.h, .cc)
// Eight sawtooths (OUT) and sines (AUX), each moved in pitch by a grain envelope: TIMBRE how often, MORPH how long
// the grains last (from glides to drones), HARMONICS how far they spread. On a trigger, a burst.
class PlGrainEnvelope {
  constructor() { this.from = 0; this.interval = 1; this.phase = 1; this.fm = 0; this.amplitude = 0.5; this.previousSizeRatio = 0; this.filterCoefficient = 0; }
  step(rate, burstMode, startBurst) {
    let randomize = false;
    if (startBurst) { this.phase = 0.5; this.fm = 16; randomize = true; }
    else {
      this.phase += rate * this.fm;
      if (this.phase >= 1) { this.phase -= this.phase | 0; randomize = true; }
    }
    if (randomize) {
      this.from += this.interval;
      this.interval = plRandomFloat() - this.from;
      if (burstMode) this.fm *= 0.8 + 0.2 * plRandomFloat();
      else this.fm = 0.5 + 1.5 * plRandomFloat();
    }
  }
  frequency(sizeRatio) { return sizeRatio < 1 ? 2 * (this.from + this.interval * this.phase) - 1 : this.from; }
  amplitudeAt(sizeRatio) {
    let target = 1;
    if (sizeRatio >= 1) {
      const phase = plConstrain((this.phase - 0.5) * sizeRatio, -1, 1);
      target = 0.5 * (plSine(0.5 * phase + 1.25) + 1);
    }
    if ((sizeRatio >= 1) !== (this.previousSizeRatio >= 1)) this.filterCoefficient = 0.5;
    this.filterCoefficient *= 0.95;
    this.previousSizeRatio = sizeRatio;
    this.amplitude += (0.5 - this.filterCoefficient) * (target - this.amplitude);
    return this.amplitude;
  }
}

class PlAdditiveSawOscillator {
  constructor() { this.phase = 0; this.nextSample = 0; this.frequency = 0.01; this.gain = 0; }
  // adds into out
  render(frequency, level, out, size) {
    if (frequency >= PL_MAX_FREQUENCY) frequency = PL_MAX_FREQUENCY;
    let fv = this.frequency; const df = (frequency - fv) / size;
    let gv = this.gain; const dg = (level - gv) / size;
    let nextSample = this.nextSample, phase = this.phase;
    for (let n = 0; n < size; n++) {
      let thisSample = nextSample;
      nextSample = 0;
      fv += df;
      phase += fv;
      if (phase >= 1) {
        phase -= 1;
        const t = phase / fv;
        thisSample -= plThisBlepSample(t);
        nextSample -= plNextBlepSample(t);
      }
      nextSample += phase;
      gv += dg;
      out[n] += (2 * thisSample - 1) * gv;
    }
    this.phase = phase; this.nextSample = nextSample; this.frequency = fv; this.gain = gv;
  }
}

const PL_SWARM_VOICES = 8;
class PlSwarmVoice {
  constructor(rank) {
    this.rank = rank;
    this.envelope = new PlGrainEnvelope();
    this.saw = new PlAdditiveSawOscillator();
    this.sine = new PlFastSineOscillator();
  }
  render(f0, density, burstMode, startBurst, spread, sizeRatio, saw, sine, size) {
    this.envelope.step(density, burstMode, startBurst);
    const amplitude = this.envelope.amplitudeAt(sizeRatio) * (1 / PL_SWARM_VOICES);
    const expo = this.envelope.frequency(sizeRatio);
    f0 *= plSemitonesToRatio(48 * expo * spread * this.rank);
    f0 *= 1 + this.rank * (this.rank + 0.01) * spread * 0.25;
    this.saw.render(f0, amplitude, saw, size);
    this.sine.renderAdd(f0, amplitude, sine, size);
  }
}

class PlSwarmEngine {
  constructor() { this.voices = []; }
  reset() {
    const n = (PL_SWARM_VOICES - 1) >> 1;
    this.voices = Array.from({ length: PL_SWARM_VOICES }, (_, i) => new PlSwarmVoice((i - n) / n));
  }
  render(p, out, aux, size) {
    const f0 = plNoteToFrequency(p.note);
    const density = plNoteToFrequency(p.timbre * 120) * 0.025 * size;
    const spread = p.harmonics * p.harmonics * p.harmonics;
    let sizeRatio = 0.25 * plSemitonesToRatio((1 - p.morph) * 84);
    const burstMode = !(p.trigger & PL_TRIGGER_UNPATCHED);
    const startBurst = !!(p.trigger & PL_TRIGGER_RISING_EDGE);
    out.fill(0, 0, size);
    aux.fill(0, 0, size);
    for (const v of this.voices) {
      v.render(f0, density, burstMode, startBurst, spread, sizeRatio, out, aux, size);
      sizeRatio *= 0.97;
    }
    return false;
  }
}

// ---- 10: filtered noise (noise_engine.cc)
// Clocked noise (TIMBRE: the clock), through a low-pass to high-pass filter (HARMONICS: its mode, MORPH: its Q) to
// OUT; AUX: through two band-passes, the second's frequency set by HARMONICS against the first.
class PlNoiseEngine {
  constructor() {
    this.clockedNoise = [new PlClockedNoise(), new PlClockedNoise()];
    this.lpHpFilter = new PlSvf();
    this.bpFilter = [new PlSvf(), new PlSvf()];
    this.previousF0 = 0; this.previousF1 = 0; this.previousQ = 0; this.previousMode = 0;
    this.temp = new Float32Array(PL_MAX_BLOCK);
    this.one = new Float32Array(1); this.oneOut = new Float32Array(1);
  }
  reset() {}
  render(p, out, aux, size) {
    const f0 = plNoteToFrequency(p.note);
    const f1 = plNoteToFrequency(p.note + p.harmonics * 48 - 24);
    const clockLowestNote = p.trigger & PL_TRIGGER_UNPATCHED ? 0 : -24;
    const clockF = plNoteToFrequency(p.timbre * (128 - clockLowestNote) + clockLowestNote);
    const q = 0.5 * plSemitonesToRatio(p.morph * 120);
    const sync = !!(p.trigger & PL_TRIGGER_RISING_EDGE);
    this.clockedNoise[0].render(sync, clockF, aux, size);
    this.clockedNoise[1].render(sync, clockF * f1 / f0, this.temp, size);
    let a = this.previousF0; const da = (f0 - a) / size;
    let b = this.previousF1; const db = (f1 - b) / size;
    let qv = this.previousQ; const dq = (q - qv) / size;
    let mv = this.previousMode; const dm = (p.harmonics - mv) / size;
    for (let n = 0; n < size; n++) {
      a += da; b += db; qv += dq; mv += dm;
      const gain = 1 / Math.sqrt((0.5 + qv) * 40 * a);
      this.lpHpFilter.setFQ(PL_FREQ_ACCURATE, a, qv);
      this.bpFilter[0].setFQ(PL_FREQ_ACCURATE, a, qv);
      this.bpFilter[1].setFQ(PL_FREQ_ACCURATE, b, qv);
      const in1 = aux[n] * gain, in2 = this.temp[n] * gain;
      this.one[0] = in1;
      this.lpHpFilter.processMultimodeLPtoHP(this.one, this.oneOut, 1, mv);
      out[n] = this.oneOut[0];
      aux[n] = this.bpFilter[0].process(PL_BAND_PASS, in1) + this.bpFilter[1].process(PL_BAND_PASS, in2);
    }
    this.previousF0 = a; this.previousF1 = b; this.previousQ = qv; this.previousMode = mv;
    return false;
  }
}

// ---- 11: particles (particle_engine.cc)
// Six streams of random impulses (TIMBRE: how many) through band-passes at random pitches (HARMONICS: how far they
// spread); MORPH: to the left, a diffuser smears them; to the right, the filters ring. AUX: the bare impulses.
const PL_PARTICLES = 6;
class PlParticleEngine {
  constructor() {
    this.particles = Array.from({ length: PL_PARTICLES }, () => new PlParticle());
    this.diffuser = new PlDiffuser();
    this.postFilter = new PlSvf();
  }
  reset() { this.diffuser.reset(); }
  render(p, out, aux, size) {
    const f0 = plNoteToFrequency(p.note);
    const densitySqrt = plNoteToFrequency(60 + p.timbre * p.timbre * 72);
    const density = densitySqrt * densitySqrt * (1 / PL_PARTICLES);
    const gain = 1 / density;
    const qSqrt = plSemitonesToRatio(p.morph >= 0.5 ? (p.morph - 0.5) * 120 : 0);
    const q = 0.5 + qSqrt * qSqrt;
    const spread = 48 * p.harmonics * p.harmonics;
    const rawSqrt = 2 * Math.abs(p.morph - 0.5);
    const diffusion = p.morph < 0.5 ? rawSqrt * rawSqrt : 0;
    const sync = !!(p.trigger & PL_TRIGGER_RISING_EDGE);
    out.fill(0, 0, size);
    aux.fill(0, 0, size);
    for (const particle of this.particles) particle.render(sync, density, gain, f0, spread, q, out, aux, size);
    this.postFilter.setFQ(PL_FREQ_DIRTY, Math.min(f0, 0.49), 0.5);
    this.postFilter.processBuffer(PL_LOW_PASS, out, out, size);
    this.diffuser.process(0.8 * diffusion * diffusion, 0.5 * diffusion + 0.25, out, size);
    return false;
  }
}

// ---- 12: string (string_engine.cc)
// Three strings in turn, each trigger plucking the next (the last keeps ringing). HARMONICS: the structure (a curved
// bridge, then dispersion), TIMBRE: brightness, MORPH: damping. AUX: the excitation.
const PL_NUM_STRINGS = 3;
class PlStringEngine {
  constructor() {
    this.voices = Array.from({ length: PL_NUM_STRINGS }, () => new PlStringVoice());
    this.f0 = new Float64Array(PL_NUM_STRINGS).fill(0.01);
    this.activeString = PL_NUM_STRINGS - 1;
    this.f0Delay = new PlDelayLine(16);
    this.temp = new Float32Array(PL_MAX_BLOCK);
  }
  reset() { this.f0Delay.reset(); for (const v of this.voices) v.reset(); }
  render(p, out, aux, size) {
    if (p.trigger & PL_TRIGGER_RISING_EDGE) {
      this.f0[this.activeString] = this.f0Delay.read(14);
      this.activeString = (this.activeString + 1) % PL_NUM_STRINGS;
    }
    const f0 = plNoteToFrequency(p.note);
    this.f0[this.activeString] = f0;
    this.f0Delay.write(f0);
    out.fill(0, 0, size);
    aux.fill(0, 0, size);
    for (let i = 0; i < PL_NUM_STRINGS; i++) {
      this.voices[i].render(!!(p.trigger & PL_TRIGGER_UNPATCHED) && i === this.activeString,
        !!(p.trigger & PL_TRIGGER_RISING_EDGE) && i === this.activeString,
        p.accent, this.f0[i], p.harmonics, p.timbre * p.timbre, p.morph, this.temp, out, aux, size);
    }
    return true;
  }
}

// ---- 13: modal resonator (modal_engine.cc)
// A bank of 24 resonant modes struck by an impulse. HARMONICS: the structure (from a stiff bar's inharmonic modes
// through a string's to a bell's), TIMBRE: brightness, MORPH: damping. AUX: the excitation.
class PlModalEngine {
  constructor() { this.voice = new PlModalVoice(); this.harmonicsLp = 0; this.temp = new Float32Array(PL_MAX_BLOCK); this.reset(); }
  reset() { this.voice.init(); }
  render(p, out, aux, size) {
    out.fill(0, 0, size);
    aux.fill(0, 0, size);
    this.harmonicsLp += 0.01 * (p.harmonics - this.harmonicsLp);
    this.voice.render(!!(p.trigger & PL_TRIGGER_UNPATCHED), !!(p.trigger & PL_TRIGGER_RISING_EDGE), p.accent,
      plNoteToFrequency(p.note), this.harmonicsLp, p.timbre, p.morph, this.temp, out, aux, size);
    return true;
  }
}

// ---- the drums (plaits/dsp/drums/*, plaits/dsp/fx/overdrive.h). The engines use the trigger: unpatched (here,
// never), each sustains instead of striking.
function plDiode(x) { if (x >= 0) return x; x *= 2; return 0.7 * x / (1 + Math.abs(x)); }

class PlOverdrive {
  constructor() { this.preGain = 0; this.postGain = 0; }
  process(drive, buf, size) {
    const d2 = drive * drive, a = drive * 0.5, b = d2 * d2 * drive * 24;
    const preGain = a + (b - a) * d2;
    const squashed = drive * (2 - drive);
    const postGain = 1 / plSoftClip(0.33 + squashed * (preGain - 0.33));
    let pg = this.preGain; const dpg = (preGain - pg) / size;
    let og = this.postGain; const dog = (postGain - og) / size;
    for (let i = 0; i < size; i++) { pg += dpg; og += dog; buf[i] = plSoftClip(pg * buf[i]) * og; }
    this.preGain = pg; this.postGain = og;
  }
}

// analog_bass_drum.h: a pulse ringing a resonant filter, its pitch pushed by the attack and by its own output
class PlAnalogBassDrum {
  constructor() {
    this.pulseRemaining = 0; this.fmPulseRemaining = 0; this.pulse = 0; this.pulseHeight = 0; this.pulseLp = 0;
    this.fmPulseLp = 0; this.retrigPulse = 0; this.lpOut = 0; this.toneLp = 0; this.sustainGain = 0;
    this.resonator = new PlSvf(); this.oscillator = new PlSineOscillator(); this.pair = [0, 0];
  }
  render(sustain, trigger, accent, f0, tone, decay, attackFmAmount, selfFmAmount, out, size) {
    const SR = PL_SAMPLE_RATE;
    const triggerPulse = (Math.fround(1e-3) * SR) | 0, fmPulse = (Math.fround(6e-3) * SR) | 0;
    const pulseDecay = 0.2e-3 * SR, pulseFilter = 0.1e-3 * SR, retrigDuration = 0.05 * SR;
    const scale = 0.001 / f0;
    const q = 1500 * plSemitonesToRatio(decay * 80);
    const toneF = Math.min(4 * f0 * plSemitonesToRatio(tone * 108), 1);
    const leak = 0.08 * (tone + 0.25);
    if (trigger) { this.pulseRemaining = triggerPulse; this.fmPulseRemaining = fmPulse; this.pulseHeight = 3 + 7 * accent; this.lpOut = 0; }
    let sg = this.sustainGain; const dsg = (accent * decay - sg) / size;
    for (let n = 0; n < size; n++) {
      let pulse = 0;
      if (this.pulseRemaining) {
        --this.pulseRemaining;
        pulse = this.pulseRemaining ? this.pulseHeight : this.pulseHeight - 1;
        this.pulse = pulse;
      } else {
        this.pulse *= 1 - 1 / pulseDecay;
        pulse = this.pulse;
      }
      if (sustain) pulse = 0;
      this.pulseLp += (1 / pulseFilter) * (pulse - this.pulseLp);
      pulse = plDiode((pulse - this.pulseLp) + pulse * 0.044);
      let fmP = 0;
      if (this.fmPulseRemaining) {
        --this.fmPulseRemaining;
        fmP = 1;
        this.retrigPulse = this.fmPulseRemaining ? 0 : -0.8;
      } else {
        this.retrigPulse *= 1 - 1 / retrigDuration;
      }
      if (sustain) fmP = 0;
      this.fmPulseLp += (1 / pulseFilter) * (fmP - this.fmPulseLp);
      const punch = 0.7 + plDiode(10 * this.lpOut - 1);
      const f = plConstrain(f0 * (1 + this.fmPulseLp * 1.7 * attackFmAmount + punch * 0.08 * selfFmAmount), 0, 0.4);
      let resonatorOut;
      if (sustain) {
        sg += dsg;
        this.oscillator.nextQuadrature(f, sg, this.pair);
        resonatorOut = this.pair[0]; this.lpOut = this.pair[1];
      } else {
        const r = this.resonator;
        r.setFQ(PL_FREQ_DIRTY, f, 1 + q * f);
        const x = (pulse - this.retrigPulse * 0.2) * scale;
        const hp = (x - r.r * r.s1 - r.g * r.s1 - r.s2) * r.h, bp = r.g * hp + r.s1;
        r.s1 = r.g * hp + bp;
        const lp = r.g * bp + r.s2;
        r.s2 = r.g * bp + lp;
        resonatorOut = bp; this.lpOut = lp;
      }
      this.toneLp += toneF * (pulse * leak + resonatorOut - this.toneLp);
      out[n] = this.toneLp;
    }
    this.sustainGain = sg;
  }
}

// synthetic_bass_drum.h: a distorted sine with a pitch envelope, a click and a little noise
class PlSyntheticBassDrumClick {
  constructor() { this.lp = 0; this.hp = 0; this.filter = new PlSvf(); this.filter.setFQ(PL_FREQ_FAST, 5000 / PL_SAMPLE_RATE, 2); }
  process(x) {
    const e = x - this.lp;
    this.lp += (e > 0 ? 0.5 : 0.1) * e;
    this.hp += 0.04 * (this.lp - this.hp);
    return this.filter.process(PL_LOW_PASS, this.lp - this.hp);
  }
}
class PlSyntheticBassDrumAttackNoise {
  constructor() { this.lp = 0; this.hp = 0; }
  render() { const s = plRandomFloat(); this.lp += 0.05 * (s - this.lp); this.hp += 0.005 * (this.lp - this.hp); return this.lp - this.hp; }
}
class PlSyntheticBassDrum {
  constructor() {
    this.phase = 0; this.phaseNoise = 0; this.f0 = 0; this.fm = 0; this.fmLp = 0; this.bodyEnvLp = 0; this.bodyEnv = 0;
    this.transientEnv = 0; this.transientEnvLp = 0; // left unset by the original's Init: zero, as on a fresh start
    this.bodyEnvPulseWidth = 0; this.fmPulseWidth = 0; this.toneLp = 0; this.sustainGain = 0;
    this.click = new PlSyntheticBassDrumClick(); this.noise = new PlSyntheticBassDrumAttackNoise();
  }
  distortedSine(phase, phaseNoise, dirtiness) {
    phase += phaseNoise * dirtiness;
    phase -= phase | 0;
    const triangle = (phase < 0.5 ? phase : 1 - phase) * 4 - 1;
    const sine = 2 * triangle / (1 + Math.abs(triangle));
    return sine + (1 - dirtiness) * (plSine(phase + 0.75) - sine);
  }
  transistorVCA(s, gain) { s = (s - 0.6) * gain; return 3 * s / (2 + Math.abs(s)) + gain * 0.3; }
  render(sustain, trigger, accent, f0, tone, decay, dirtiness, fmEnvelopeAmount, fmEnvelopeDecay, out, size) {
    const SR = PL_SAMPLE_RATE;
    decay *= decay;
    fmEnvelopeDecay *= fmEnvelopeDecay;
    // the pitch steps only on the samples the oscillator moves, as in the original
    let fv = this.f0; const df = (f0 - fv) / size;
    dirtiness *= Math.max(1 - 8 * f0, 0);
    const fmDecay = 1 - 1 / (0.008 * (1 + fmEnvelopeDecay * 4) * SR);
    const bodyEnvDecay = 1 - 1 / (0.02 * SR) * plSemitonesToRatio(-decay * 60);
    const transientEnvDecay = 1 - 1 / (0.005 * SR);
    const toneF = Math.min(4 * f0 * plSemitonesToRatio(tone * 108), 1);
    const transientLevel = tone;
    if (trigger) {
      this.fm = 1;
      this.bodyEnv = this.transientEnv = 0.3 + 0.7 * accent;
      this.bodyEnvPulseWidth = (SR * 0.001) | 0;
      this.fmPulseWidth = (SR * 0.0013) | 0;
    }
    let sg = this.sustainGain; const dsg = (accent * decay - sg) / size;
    for (let n = 0; n < size; n++) {
      this.phaseNoise += 0.002 * (plRandomFloat() - 0.5 - this.phaseNoise);
      let mix = 0;
      if (sustain) {
        fv += df;
        this.phase += fv;
        if (this.phase >= 1) this.phase -= 1;
        sg += dsg;
        mix -= this.transistorVCA(this.distortedSine(this.phase, this.phaseNoise, dirtiness), sg);
      } else {
        if (this.fmPulseWidth) { --this.fmPulseWidth; this.phase = 0.25; }
        else {
          this.fm *= fmDecay;
          const fm = 1 + fmEnvelopeAmount * 3.5 * this.fmLp;
          fv += df;
          this.phase += Math.min(fv * fm, 0.5);
          if (this.phase >= 1) this.phase -= 1;
        }
        if (this.bodyEnvPulseWidth) --this.bodyEnvPulseWidth;
        else { this.bodyEnv *= bodyEnvDecay; this.transientEnv *= transientEnvDecay; }
        this.bodyEnvLp += 0.1 * (this.bodyEnv - this.bodyEnvLp);
        this.transientEnvLp += 0.1 * (this.transientEnv - this.transientEnvLp);
        this.fmLp += 0.1 * (this.fm - this.fmLp);
        const body = this.distortedSine(this.phase, this.phaseNoise, dirtiness);
        const transient = this.click.process(this.bodyEnvPulseWidth ? 0 : 1) + this.noise.render();
        mix -= this.transistorVCA(body, this.bodyEnvLp);
        mix -= transient * this.transientEnvLp * transientLevel;
      }
      this.toneLp += toneF * (mix - this.toneLp);
      out[n] = this.toneLp;
    }
    this.f0 = fv; this.sustainGain = sg;
  }
}

// ---- 14: bass drum (bass_drum_engine.cc). OUT: the analog model (HARMONICS: attack FM, self FM, then drive);
// AUX: the synthetic one. TIMBRE: tone, MORPH: decay.
class PlBassDrumEngine {
  constructor() { this.analog = new PlAnalogBassDrum(); this.synthetic = new PlSyntheticBassDrum(); this.overdrive = new PlOverdrive(); }
  reset() {}
  render(p, out, aux, size) {
    const f0 = plNoteToFrequency(p.note);
    const attackFm = Math.min(p.harmonics * 4, 1);
    const selfFm = Math.max(Math.min(p.harmonics * 4 - 1, 1), 0);
    const drive = Math.max(p.harmonics * 2 - 1, 0) * Math.max(1 - 16 * f0, 0);
    const sustain = !!(p.trigger & PL_TRIGGER_UNPATCHED), trigger = !!(p.trigger & PL_TRIGGER_RISING_EDGE);
    this.analog.render(sustain, trigger, p.accent, f0, p.timbre, p.morph, attackFm, selfFm, out, size);
    this.overdrive.process(0.5 + 0.5 * drive, out, size);
    this.synthetic.render(sustain, trigger, p.accent, f0, p.timbre, p.morph,
      sustain ? p.harmonics : 0.4 - 0.25 * p.morph * p.morph,
      Math.min(p.harmonics * 2, 1), Math.max(p.harmonics * 2 - 1, 0), aux, size);
    return true;
  }
}

// analog_snare_drum.h: five resonant modes of a shell and band-passed noise for the snares
const PL_SNARE_MODES = [1, 2, 3.18, 4.16, 5.62];
class PlAnalogSnareDrum {
  constructor() {
    this.pulseRemaining = 0; this.pulse = 0; this.pulseHeight = 0; this.pulseLp = 0; this.noiseEnvelope = 0; this.sustainGain = 0;
    this.resonator = PL_SNARE_MODES.map(() => new PlSvf());
    this.oscillator = PL_SNARE_MODES.map(() => new PlSineOscillator());
    this.noiseFilter = new PlSvf();
    this.f = new Float64Array(5); this.gain = new Float64Array(5);
  }
  render(sustain, trigger, accent, f0, tone, decay, snappy, out, size) {
    const SR = PL_SAMPLE_RATE;
    const decayXt = decay * (1 + decay * (decay - 1));
    const triggerPulse = (Math.fround(1e-3) * SR) | 0, pulseDecay = 0.1e-3 * SR;
    const q = 2000 * plSemitonesToRatio(decayXt * 84);
    const noiseEnvelopeDecay = 1 - 0.0017 * plSemitonesToRatio(-decay * (50 + snappy * 10));
    const leak = snappy * (2 - snappy) * 0.1;
    snappy = plConstrain(snappy * 1.1 - 0.05, 0, 1);
    if (trigger) { this.pulseRemaining = triggerPulse; this.pulseHeight = 3 + 7 * accent; this.noiseEnvelope = 2; }
    const f = this.f, gain = this.gain;
    for (let i = 0; i < 5; i++) {
      f[i] = Math.min(f0 * PL_SNARE_MODES[i], 0.499);
      this.resonator[i].setFQ(PL_FREQ_FAST, f[i], 1 + f[i] * (i === 0 ? q : q * 0.25));
    }
    if (tone < 0.666667) {
      tone *= 1.5;
      gain[0] = 1.5 + (1 - tone) * (1 - tone) * 4.5;
      gain[1] = 2 * tone + 0.15;
      gain[2] = gain[3] = gain[4] = 0;
    } else {
      tone = (tone - 0.666667) * 3;
      gain[0] = 1.5 - tone * 0.5;
      gain[1] = 2.15 - tone * 0.7;
      for (let i = 2; i < 5; i++) { gain[i] = tone; tone *= tone; }
    }
    const fNoise = plConstrain(f0 * 16, 0, 0.499);
    this.noiseFilter.setFQ(PL_FREQ_FAST, fNoise, 1 + fNoise * 1.5);
    let sg = this.sustainGain; const dsg = (accent * decay - sg) / size;
    for (let n = 0; n < size; n++) {
      let pulse = 0;
      if (this.pulseRemaining) {
        --this.pulseRemaining;
        pulse = this.pulseRemaining ? this.pulseHeight : this.pulseHeight - 1;
        this.pulse = pulse;
      } else {
        this.pulse *= 1 - 1 / pulseDecay;
        pulse = this.pulse;
      }
      sg += dsg;
      this.pulseLp += 0.75 * (pulse - this.pulseLp);
      let shell = 0;
      for (let i = 0; i < 5; i++) {
        const excitation = i === 0 ? (pulse - this.pulseLp) + 0.006 * pulse : 0.026 * pulse;
        shell += gain[i] * (sustain
          ? this.oscillator[i].next(f[i]) * sg * 0.25
          : this.resonator[i].process(PL_BAND_PASS, excitation) + excitation * leak);
      }
      shell = plSoftClip(shell);
      let noise = 2 * plRandomFloat() - 1;
      if (noise < 0) noise = 0;
      this.noiseEnvelope *= noiseEnvelopeDecay;
      noise *= (sustain ? sg : this.noiseEnvelope) * snappy * 2;
      noise = this.noiseFilter.process(PL_BAND_PASS, noise);
      out[n] = noise + shell * (1 - snappy);
    }
    this.sustainGain = sg;
  }
}

// synthetic_snare_drum.h: two distorted sines for the drum, filtered noise for the snares
class PlSyntheticSnareDrum {
  constructor() {
    this.phase = [0, 0]; this.drumAmplitude = 0; this.snareAmplitude = 0; this.fm = 0; this.holdCounter = 0; this.sustainGain = 0;
    this.drumLp = new PlOnePole(); this.snareHp = new PlOnePole(); this.snareLp = new PlSvf();
  }
  distortedSine(phase) { const t = (phase < 0.5 ? phase : 1 - phase) * 4 - 1.3; return 2 * t / (1 + Math.abs(t)); }
  render(sustain, trigger, accent, f0, fmAmount, decay, snappy, out, size) {
    const SR = PL_SAMPLE_RATE;
    const decayXt = decay * (1 + decay * (decay - 1));
    fmAmount *= fmAmount;
    const drumDecay = 1 - 1 / (0.015 * SR) * plSemitonesToRatio(-decayXt * 72 - fmAmount * 12 + snappy * 7);
    const snareDecay = 1 - 1 / (0.01 * SR) * plSemitonesToRatio(-decay * 60 - snappy * 7);
    const fmDecay = 1 - 1 / (0.007 * SR);
    snappy = plConstrain(snappy * 1.1 - 0.05, 0, 1);
    const drumLevel = Math.sqrt(1 - snappy), snareLevel = Math.sqrt(snappy);
    this.snareHp.setF(PL_FREQ_FAST, Math.min(10 * f0, 0.5));
    this.snareLp.setFQ(PL_FREQ_FAST, Math.min(35 * f0, 0.5), 0.5 + 2 * snappy);
    this.drumLp.setF(PL_FREQ_FAST, 3 * f0);
    if (trigger) {
      this.snareAmplitude = this.drumAmplitude = 0.3 + 0.7 * accent;
      this.fm = 1;
      this.phase[0] = this.phase[1] = 0;
      this.holdCounter = ((0.04 + decay * 0.03) * SR) | 0;
    }
    let sg = this.sustainGain; const dsg = (accent * decay - sg) / size;
    for (let n = 0; n < size; n++) {
      const remaining = size - 1 - n; // the original tests its countdown
      if (sustain) {
        sg += dsg;
        this.snareAmplitude = sg; this.drumAmplitude = sg; this.fm = 0;
      } else {
        this.drumAmplitude *= this.drumAmplitude > 0.03 || !(remaining & 1) ? drumDecay : 1;
        if (this.holdCounter) --this.holdCounter; else this.snareAmplitude *= snareDecay;
        this.fm *= fmDecay;
      }
      let resetNoiseAmount = plConstrain((0.125 - f0) * 8, 0, 1);
      resetNoiseAmount *= resetNoiseAmount;
      resetNoiseAmount *= fmAmount;
      let resetNoise = (this.phase[0] > 0.5 ? -1 : 1) + (this.phase[1] > 0.5 ? -1 : 1);
      resetNoise *= resetNoiseAmount * 0.025;
      const f = f0 * (1 + fmAmount * (4 * this.fm));
      this.phase[0] += f;
      this.phase[1] += f * 1.47;
      if (resetNoiseAmount > 0.1) {
        if (this.phase[0] >= 1 + resetNoise) this.phase[0] = 1 - this.phase[0];
        if (this.phase[1] >= 1 + resetNoise) this.phase[1] = 1 - this.phase[1];
      } else {
        if (this.phase[0] >= 1) this.phase[0] -= 1;
        if (this.phase[1] >= 1) this.phase[1] -= 1;
      }
      let drum = -0.1 + this.distortedSine(this.phase[0]) * 0.6 + this.distortedSine(this.phase[1]) * 0.25;
      drum *= this.drumAmplitude * drumLevel;
      drum = this.drumLp.process(PL_LOW_PASS, drum);
      let snare = this.snareLp.process(PL_LOW_PASS, plRandomFloat());
      snare = this.snareHp.process(PL_HIGH_PASS, snare);
      snare = (snare + 0.1) * (this.snareAmplitude + this.fm) * snareLevel;
      out[n] = snare + drum;
    }
    this.sustainGain = sg;
  }
}

// ---- 15: snare drum (snare_drum_engine.cc). OUT: the analog model, AUX: the synthetic one. HARMONICS: the snares'
// share, TIMBRE: the shell's tone (or FM), MORPH: decay.
class PlSnareDrumEngine {
  constructor() { this.analog = new PlAnalogSnareDrum(); this.synthetic = new PlSyntheticSnareDrum(); }
  reset() {}
  render(p, out, aux, size) {
    const f0 = plNoteToFrequency(p.note);
    const sustain = !!(p.trigger & PL_TRIGGER_UNPATCHED), trigger = !!(p.trigger & PL_TRIGGER_RISING_EDGE);
    this.analog.render(sustain, trigger, p.accent, f0, p.timbre, p.morph, p.harmonics, out, size);
    this.synthetic.render(sustain, trigger, p.accent, f0, p.timbre, p.morph, p.harmonics, aux, size);
    return true;
  }
}

// hi_hat.h: metallic noise (six square waves, or ring-modulated pairs) through a band-pass, mixed with clocked
// noise, through a VCA and a high-pass
const PL_HH_RATIOS = [1, 1.304, 1.466, 1.787, 1.932, 2.536];
class PlSquareNoise {
  constructor() { this.phase = new Uint32Array(6); this.increment = new Uint32Array(6); }
  render(f0, temp1, temp2, out, size) {
    const ph = this.phase, inc = this.increment;
    for (let i = 0; i < 6; i++) { let f = f0 * PL_HH_RATIOS[i]; if (f >= 0.499) f = 0.499; inc[i] = (f * 4294967296) >>> 0; }
    for (let n = 0; n < size; n++) {
      let noise = 0;
      for (let i = 0; i < 6; i++) { ph[i] += inc[i]; noise += ph[i] >>> 31; }
      out[n] = 0.33 * noise - 1;
    }
  }
}
class PlRingModNoise {
  constructor() { this.oscillator = Array.from({ length: 6 }, () => new PlOscillator()); }
  render(f0, temp1, temp2, out, size) {
    const SR = PL_SAMPLE_RATE, ratio = f0 / (0.01 + f0);
    const f = [[200 / SR * ratio, 7530 / SR * ratio], [510 / SR * ratio, 8075 / SR * ratio], [730 / SR * ratio, 10500 / SR * ratio]];
    out.fill(0, 0, size);
    for (let i = 0; i < 3; i++) {
      this.oscillator[2 * i].render(PL_SHAPE_SQUARE, f[i][0], 0.5, temp1, size);
      this.oscillator[2 * i + 1].render(PL_SHAPE_SAW, f[i][1], 0.5, temp2, size);
      for (let n = 0; n < size; n++) out[n] += temp1[n] * temp2[n];
    }
  }
}
function plSwingVCA(s, gain) { s *= s > 0 ? 4 : 0.1; s = s / (1 + Math.abs(s)); return (s + 0.1) * gain; }
function plLinearVCA(s, gain) { return s * gain; }

class PlHiHat {
  constructor(noise, vca, resonance, twoStageEnvelope) {
    this.metallicNoise = noise; this.vca = vca; this.resonance = resonance; this.twoStage = twoStageEnvelope;
    this.envelope = 0; this.noiseClock = 0; this.noiseSample = 0; this.sustainGain = 0;
    this.coloration = new PlSvf(); this.hpf = new PlSvf();
  }
  render(sustain, trigger, accent, f0, tone, decay, noisiness, temp1, temp2, out, size) {
    const SR = PL_SAMPLE_RATE;
    const envelopeDecay = 1 - 0.003 * plSemitonesToRatio(-decay * 84);
    const cutDecay = 1 - 0.0025 * plSemitonesToRatio(-decay * 36);
    if (trigger) this.envelope = (1.5 + 0.5 * (1 - decay)) * (0.3 + 0.7 * accent);
    this.metallicNoise.render(2 * f0, temp1, temp2, out, size);
    const cutoff = plConstrain(150 / SR * plSemitonesToRatio(tone * 72), 0, 16000 / SR);
    this.coloration.setFQ(PL_FREQ_ACCURATE, cutoff, this.resonance ? 3 + 3 * tone : 1);
    this.coloration.processBuffer(PL_BAND_PASS, out, out, size);
    noisiness *= noisiness;
    const noiseF = plConstrain(f0 * (16 + 16 * (1 - noisiness)), 0, 0.5);
    for (let i = 0; i < size; i++) {
      this.noiseClock += noiseF;
      if (this.noiseClock >= 1) { this.noiseClock -= 1; this.noiseSample = plRandomFloat() - 0.5; }
      out[i] += noisiness * (this.noiseSample - out[i]);
    }
    let sg = this.sustainGain; const dsg = (accent * decay - sg) / size;
    for (let i = 0; i < size; i++) {
      this.envelope *= this.envelope > 0.5 || !this.twoStage ? envelopeDecay : cutDecay;
      let gain = this.envelope;
      if (sustain) { sg += dsg; gain = sg; }
      out[i] = this.vca(out[i], gain);
    }
    this.sustainGain = sg;
    this.hpf.setFQ(PL_FREQ_ACCURATE, cutoff, 0.5);
    this.hpf.processBuffer(PL_HIGH_PASS, out, out, size);
  }
}

// ---- 16: hi-hat (hi_hat_engine.cc). OUT: six square waves through a resonant band-pass and a swing VCA; AUX:
// ring-modulated pairs, a two-stage envelope. HARMONICS: how much noise, TIMBRE: tone, MORPH: decay.
class PlHiHatEngine {
  constructor() {
    this.hiHat1 = new PlHiHat(new PlSquareNoise(), plSwingVCA, true, false);
    this.hiHat2 = new PlHiHat(new PlRingModNoise(), plLinearVCA, false, true);
    this.temp1 = new Float32Array(PL_MAX_BLOCK); this.temp2 = new Float32Array(PL_MAX_BLOCK);
  }
  reset() {}
  render(p, out, aux, size) {
    const f0 = plNoteToFrequency(p.note);
    const sustain = !!(p.trigger & PL_TRIGGER_UNPATCHED), trigger = !!(p.trigger & PL_TRIGGER_RISING_EDGE);
    this.hiHat1.render(sustain, trigger, p.accent, f0, p.timbre, p.morph, p.harmonics, this.temp1, this.temp2, out, size);
    this.hiHat2.render(sustain, trigger, p.accent, f0, p.timbre, p.morph, p.harmonics, this.temp1, this.temp2, aux, size);
    return true;
  }
}

// The engines in the module's order, with its output gains for OUT and AUX (negative: through a limiter). The same
// order as RIG_MACRO_MODELS (rigParams.ts): a patch keeps the index, so new engines go on the end.
const PL_ENGINES = [
  [PlVirtualAnalogEngine, 0.8, 0.8],
  [PlWaveshapingEngine, 0.7, 0.6],
  [PlFMEngine, 0.6, 0.6],
  [PlGrainEngine, 0.7, 0.6],
  [PlAdditiveEngine, 0.8, 0.8],
  [PlWavetableEngine, 0.6, 0.6],
  [PlChordEngine, 0.8, 0.8],
  [PlSpeechEngine, -0.7, 0.8],
  [PlSwarmEngine, -3.0, 1.0],
  [PlNoiseEngine, -1.0, -1.0],
  [PlParticleEngine, -2.0, 1.0],
  [PlStringEngine, -1.0, 0.8],
  [PlModalEngine, -1.0, 0.8],
  [PlBassDrumEngine, 0.8, 0.8],
  [PlSnareDrumEngine, 0.8, 0.8],
  [PlHiHatEngine, 0.8, 0.8],
];
`;

