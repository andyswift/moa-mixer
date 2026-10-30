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
];
`;

