// Port of parts of stmlib (dsp.h, units.h, polyblep.h, parameter_interpolator.h) and of Plaits' oscillators
// (plaits/dsp/oscillator/variable_shape_oscillator.h, variable_saw_oscillator.h) from Mutable Instruments' source.
// Copyright 2016-2021 Emilie Gillet (emilie.o.gillet@gmail.com). MIT licence: see ./LICENSE.

/**
 * The building blocks Plaits' engines share, as worklet source text. Names follow the original (PascalCase methods
 * become camelCase, members lose their trailing underscore); a parameter interpolator becomes a local `value`
 * stepped by `increment`, written back after the block exactly as the C++ destructor does.
 *
 * Plaits runs at 48 kHz on a clock that is really 47872.34 Hz and tunes for it (`a0`); here `plSetSampleRate` tunes
 * for the real rate, and the tests set the module's own `a0` to compare with its renders.
 */
export const PLAITS_DSP_SOURCE = `
const PL_MAX_BLOCK = 24;
const PL_MAX_FREQUENCY = 0.25;
let PL_SAMPLE_RATE = 48000;
let PL_A0 = 55 / 47872.34;
function plSetSampleRate(sr, a0) { PL_SAMPLE_RATE = sr; PL_A0 = a0 === undefined ? 55 / sr : a0; }

function plConstrain(x, lo, hi) { return x < lo ? lo : x > hi ? hi : x; }

function plSemitonesToRatio(semitones) {
  const pitch = semitones + 128;
  const i = pitch | 0, f = pitch - i;
  return PL_PITCH_RATIO_HIGH[i] * PL_PITCH_RATIO_LOW[(f * 256) | 0];
}

function plSemitonesToRatioSafe(semitones) {
  let scale = 1;
  while (semitones > 120) { semitones -= 120; scale *= 1024; }
  while (semitones < -120) { semitones += 120; scale *= 1 / 1024; }
  return scale * plSemitonesToRatio(semitones);
}

function plNoteToFrequency(note) {
  note = plConstrain(note - 9, -128, 127);
  return PL_A0 * 0.25 * plSemitonesToRatio(note);
}

function plInterpolate(table, index, size) {
  index *= size;
  const i = index | 0, f = index - i;
  const a = table[i], b = table[i + 1];
  return a + (b - a) * f;
}

function plInterpolateHermite(table, index, size) {
  index *= size;
  const i = index | 0, f = index - i;
  const xm1 = table[i - 1], x0 = table[i], x1 = table[i + 1], x2 = table[i + 2];
  const c = (x1 - xm1) * 0.5, v = x0 - x1, w = c + v, a = w + v + (x2 - x0) * 0.5, bNeg = w + a;
  return (((a * f) - bNeg) * f + c) * f + x0;
}

function plInterpolateWrap(table, index, size) {
  index -= index | 0;
  index *= size;
  const i = index | 0, f = index - i;
  const a = table[i], b = table[i + 1];
  return a + (b - a) * f;
}

function plSmoothStep(x) { return x * x * (3 - 2 * x); }
function plSoftLimit(x) { return x * (27 + x * x) / (27 + 9 * x * x); }
function plSoftClip(x) { return x < -3 ? -1 : x > 3 ? 1 : plSoftLimit(x); }

// polyBLEP and its integral (stmlib/dsp/polyblep.h)
function plThisBlepSample(t) { return 0.5 * t * t; }
function plNextBlepSample(t) { t = 1 - t; return -0.5 * t * t; }
function plNextIntegratedBlepSample(t) {
  const t1 = 0.5 * t, t2 = t1 * t1, t4 = t2 * t2;
  return 0.1875 - t1 + 1.5 * t2 - t4;
}
function plThisIntegratedBlepSample(t) { return plNextIntegratedBlepSample(1 - t); }

// stmlib/dsp/limiter.h: what Plaits puts on an engine's output when its gain is negative
class PlLimiter {
  constructor() { this.peak = 0.5; }
  process(preGain, buf, size) {
    let peak = this.peak;
    for (let i = 0; i < size; i++) {
      const s = buf[i] * preGain, a = s < 0 ? -s : s, e = a - peak;
      peak += (e > 0 ? 0.05 : 0.00002) * e;
      buf[i] = s * (peak <= 1 ? 1 : 1 / peak) * 0.8;
    }
    this.peak = peak;
  }
}

// Engine parameters, as Plaits passes them each block.
const PL_TRIGGER_LOW = 0, PL_TRIGGER_RISING_EDGE = 1, PL_TRIGGER_UNPATCHED = 2, PL_TRIGGER_HIGH = 4;

class PlVariableShapeOscillator {
  constructor() { this.init(); }

  init() {
    this.masterPhase = 0; this.slavePhase = 0; this.nextSample = 0; this.previousPw = 0.5; this.high = false;
    this.masterFrequency = 0; this.slaveFrequency = 0.01; this.pw = 0.5; this.waveshape = 0; this.phaseModulation = 0;
  }

  setMasterPhase(p) { this.masterPhase = p; }

  render(frequency, pw, waveshape, out, size) { this.renderFull(false, false, 0, frequency, pw, waveshape, 0, out, size); }

  renderSync(masterFrequency, frequency, pw, waveshape, out, size) {
    this.renderFull(true, false, masterFrequency, frequency, pw, waveshape, 0, out, size);
  }

  renderFull(enableSync, outputPhase, masterFrequency, frequency, pw, waveshape, phaseModulationAmount, out, size) {
    if (masterFrequency >= PL_MAX_FREQUENCY) masterFrequency = PL_MAX_FREQUENCY;
    if (frequency >= PL_MAX_FREQUENCY) frequency = PL_MAX_FREQUENCY;
    if (frequency >= 0.25) pw = 0.5;
    else pw = plConstrain(pw, frequency * 2, 1 - 2 * frequency);

    let mf = this.masterFrequency; const dmf = (masterFrequency - mf) / size;
    let sf = this.slaveFrequency; const dsf = (frequency - sf) / size;
    let pwv = this.pw; const dpw = (pw - pwv) / size;
    let ws = this.waveshape; const dws = (waveshape - ws) / size;
    let pm = this.phaseModulation; const dpm = (phaseModulationAmount - pm) / size;

    let nextSample = this.nextSample;
    for (let n = 0; n < size; n++) {
      let reset = false, transitionDuringReset = false, resetTime = 0;
      let thisSample = nextSample;
      nextSample = 0;
      mf += dmf; sf += dsf; pwv += dpw; ws += dws; pm += dpm;
      const masterF = mf, slaveF = sf, p = pwv;
      const squareAmount = Math.max(ws - 0.5, 0) * 2;
      const triangleAmount = Math.max(1 - ws * 2, 0);
      const slopeUp = 1 / p, slopeDown = 1 / (1 - p);

      if (enableSync) {
        this.masterPhase += masterF;
        if (this.masterPhase >= 1) {
          this.masterPhase -= 1;
          resetTime = this.masterPhase / masterF;
          let slavePhaseAtReset = this.slavePhase + (1 - resetTime) * slaveF;
          reset = true;
          if (slavePhaseAtReset >= 1) { slavePhaseAtReset -= 1; transitionDuringReset = true; }
          if (!this.high && slavePhaseAtReset >= p) transitionDuringReset = true;
          const value = this.naive(slavePhaseAtReset, p, slopeUp, slopeDown, triangleAmount, squareAmount);
          thisSample -= value * plThisBlepSample(resetTime);
          nextSample -= value * plNextBlepSample(resetTime);
        }
      } else if (outputPhase) {
        this.masterPhase += masterF;
        if (this.masterPhase >= 1) this.masterPhase -= 1;
      }

      this.slavePhase += slaveF;
      while (transitionDuringReset || !reset) {
        if (!this.high) {
          if (this.slavePhase < p) break;
          const t = (this.slavePhase - p) / (this.previousPw - p + slaveF);
          const triangleStep = (slopeUp + slopeDown) * slaveF * triangleAmount;
          thisSample += squareAmount * plThisBlepSample(t);
          nextSample += squareAmount * plNextBlepSample(t);
          thisSample -= triangleStep * plThisIntegratedBlepSample(t);
          nextSample -= triangleStep * plNextIntegratedBlepSample(t);
          this.high = true;
        }
        if (this.high) {
          if (this.slavePhase < 1) break;
          this.slavePhase -= 1;
          const t = this.slavePhase / slaveF;
          const triangleStep = (slopeUp + slopeDown) * slaveF * triangleAmount;
          thisSample -= (1 - triangleAmount) * plThisBlepSample(t);
          nextSample -= (1 - triangleAmount) * plNextBlepSample(t);
          thisSample += triangleStep * plThisIntegratedBlepSample(t);
          nextSample += triangleStep * plNextIntegratedBlepSample(t);
          this.high = false;
        }
      }
      if (enableSync && reset) { this.slavePhase = resetTime * slaveF; this.high = false; }

      nextSample += this.naive(this.slavePhase, p, slopeUp, slopeDown, triangleAmount, squareAmount);
      this.previousPw = p;

      if (outputPhase) {
        let phasor = this.masterPhase;
        if (enableSync) {
          const w = 4 * (1 - this.masterPhase) * this.masterPhase;
          thisSample *= w * (2 - w);
          const p2 = phasor * phasor;
          phasor += (p2 * p2 - phasor) * Math.abs(p - 0.5) * 2;
        }
        out[n] = phasor + pm * thisSample;
      } else {
        out[n] = 2 * thisSample - 1;
      }
    }
    this.nextSample = nextSample;
    this.masterFrequency = mf; this.slaveFrequency = sf; this.pw = pwv; this.waveshape = ws; this.phaseModulation = pm;
  }

  naive(phase, pw, slopeUp, slopeDown, triangleAmount, squareAmount) {
    let saw = phase;
    const square = phase < pw ? 0 : 1;
    const triangle = phase < pw ? phase * slopeUp : 1 - (phase - pw) * slopeDown;
    saw += (square - saw) * squareAmount;
    saw += (triangle - saw) * triangleAmount;
    return saw;
  }
}

const PL_VARIABLE_SAW_NOTCH_DEPTH = 0.2;

class PlVariableSawOscillator {
  constructor() { this.init(); }

  init() {
    this.phase = 0; this.nextSample = 0; this.previousPw = 0.5; this.high = false;
    this.frequency = 0.01; this.pw = 0.5; this.waveshape = 0;
  }

  render(frequency, pw, waveshape, out, size) {
    if (frequency >= PL_MAX_FREQUENCY) frequency = PL_MAX_FREQUENCY;
    if (frequency >= 0.25) pw = 0.5;
    else pw = plConstrain(pw, frequency * 2, 1 - 2 * frequency);

    let fv = this.frequency; const df = (frequency - fv) / size;
    let pwv = this.pw; const dpw = (pw - pwv) / size;
    let ws = this.waveshape; const dws = (waveshape - ws) / size;
    let nextSample = this.nextSample;
    const depth = PL_VARIABLE_SAW_NOTCH_DEPTH;
    for (let n = 0; n < size; n++) {
      let thisSample = nextSample;
      nextSample = 0;
      fv += df; pwv += dpw; ws += dws;
      const f = fv, p = pwv, triangleAmount = ws, notchAmount = 1 - ws;
      const slopeUp = 1 / p, slopeDown = 1 / (1 - p);
      this.phase += f;
      if (!this.high && this.phase >= p) {
        const triangleStep = (slopeUp + slopeDown) * f * triangleAmount;
        const notch = (depth + 1 - p) * notchAmount;
        const t = (this.phase - p) / (this.previousPw - p + f);
        thisSample += notch * plThisBlepSample(t);
        nextSample += notch * plNextBlepSample(t);
        thisSample -= triangleStep * plThisIntegratedBlepSample(t);
        nextSample -= triangleStep * plNextIntegratedBlepSample(t);
        this.high = true;
      } else if (this.phase >= 1) {
        this.phase -= 1;
        const triangleStep = (slopeUp + slopeDown) * f * triangleAmount;
        const notch = (depth + 1) * notchAmount;
        const t = this.phase / f;
        thisSample -= notch * plThisBlepSample(t);
        nextSample -= notch * plNextBlepSample(t);
        thisSample += triangleStep * plThisIntegratedBlepSample(t);
        nextSample += triangleStep * plNextIntegratedBlepSample(t);
        this.high = false;
      }
      const notchSaw = this.phase < p ? this.phase : 1 + depth;
      const triangle = this.phase < p ? this.phase * slopeUp : 1 - (this.phase - p) * slopeDown;
      nextSample += notchSaw * notchAmount + triangle * triangleAmount;
      this.previousPw = p;
      out[n] = (2 * thisSample - 1) / (1 + depth);
    }
    this.nextSample = nextSample;
    this.frequency = fv; this.pw = pwv; this.waveshape = ws;
  }
}

// ---- plaits/dsp/oscillator/oscillator.h: the band-limited basic shapes (the shape is a value here, not a template)
const PL_SHAPE_IMPULSE_TRAIN = 0, PL_SHAPE_SAW = 1, PL_SHAPE_TRIANGLE = 2, PL_SHAPE_SLOPE = 3, PL_SHAPE_SQUARE = 4;
const PL_SHAPE_SQUARE_BRIGHT = 5, PL_SHAPE_SQUARE_DARK = 6, PL_SHAPE_SQUARE_TRIANGLE = 7;
const PL_MIN_FREQUENCY = 0.000001;

class PlOscillator {
  constructor() { this.init(); }

  init() {
    this.phase = 0.5; this.nextSample = 0; this.lpState = 1; this.hpState = 0; this.high = true;
    this.frequency = 0.001; this.pw = 0.5;
  }

  // external FM (\`fm\`, a buffer) runs through zero, as in the original's Render(frequency, pw, fm, out, size)
  render(shape, frequency, pw, out, size, fm) {
    const ext = !!fm, tz = ext;
    if (!ext) {
      frequency = plConstrain(frequency, PL_MIN_FREQUENCY, PL_MAX_FREQUENCY);
      pw = plConstrain(pw, Math.abs(frequency) * 2, 1 - 2 * Math.abs(frequency));
    }
    let fv = this.frequency; const df = (frequency - fv) / size;
    let pv = this.pw; const dp = (pw - pv) / size;
    let nextSample = this.nextSample;
    for (let n = 0; n < size; n++) {
      let thisSample = nextSample;
      nextSample = 0;
      fv += df; pv += dp;
      let f = fv;
      if (ext) f = plConstrain(f * (1 + fm[n]), -PL_MAX_FREQUENCY, PL_MAX_FREQUENCY);
      let p = shape === PL_SHAPE_SQUARE_TRIANGLE || shape === PL_SHAPE_TRIANGLE ? 0.5 : pv;
      if (ext) p = plConstrain(p, Math.abs(f) * 2, 1 - 2 * Math.abs(f));
      this.phase += f;

      if (shape <= PL_SHAPE_SAW) {
        if (this.phase >= 1) {
          this.phase -= 1;
          const t = this.phase / f;
          thisSample -= plThisBlepSample(t); nextSample -= plNextBlepSample(t);
        } else if (tz && this.phase < 0) {
          const t = this.phase / f;
          this.phase += 1;
          thisSample += plThisBlepSample(t); nextSample += plNextBlepSample(t);
        }
        nextSample += this.phase;
        if (shape === PL_SHAPE_SAW) out[n] = 2 * thisSample - 1;
        else {
          this.lpState += 0.25 * ((this.hpState - thisSample) - this.lpState);
          out[n] = 4 * this.lpState;
          this.hpState = thisSample;
        }
      } else if (shape <= PL_SHAPE_SLOPE) {
        let up = 2, down = 2;
        if (shape === PL_SHAPE_SLOPE) { up = 1 / p; down = 1 / (1 - p); }
        if (this.high !== (this.phase < p)) {
          const t = (this.phase - p) / f;
          let d = (up + down) * f;
          if (tz && f < 0) d = -d;
          thisSample -= plThisIntegratedBlepSample(t) * d; nextSample -= plNextIntegratedBlepSample(t) * d;
          this.high = this.phase < p;
        }
        if (this.phase >= 1) {
          this.phase -= 1;
          const t = this.phase / f, d = (up + down) * f;
          thisSample += plThisIntegratedBlepSample(t) * d; nextSample += plNextIntegratedBlepSample(t) * d;
          this.high = true;
        } else if (tz && this.phase < 0) {
          const t = this.phase / f;
          this.phase += 1;
          const d = (up + down) * f;
          thisSample -= plThisIntegratedBlepSample(t) * d; nextSample -= plNextIntegratedBlepSample(t) * d;
          this.high = false;
        }
        nextSample += this.high ? this.phase * up : 1 - (this.phase - p) * down;
        out[n] = 2 * thisSample - 1;
      } else {
        if (this.high !== (this.phase >= p)) {
          const t = (this.phase - p) / f;
          const d = tz && f < 0 ? -1 : 1;
          thisSample += plThisBlepSample(t) * d; nextSample += plNextBlepSample(t) * d;
          this.high = this.phase >= p;
        }
        if (this.phase >= 1) {
          this.phase -= 1;
          const t = this.phase / f;
          thisSample -= plThisBlepSample(t); nextSample -= plNextBlepSample(t);
          this.high = false;
        } else if (tz && this.phase < 0) {
          const t = this.phase / f;
          this.phase += 1;
          thisSample += plThisBlepSample(t); nextSample += plNextBlepSample(t);
          this.high = true;
        }
        nextSample += this.phase < p ? 0 : 1;
        if (shape === PL_SHAPE_SQUARE_TRIANGLE) {
          thisSample = 128 * (thisSample - 0.5);
          this.lpState += f * 0.0625 * (thisSample - this.lpState);
          out[n] = this.lpState;
        } else if (shape === PL_SHAPE_SQUARE_DARK) {
          thisSample = 4 * (thisSample - 0.5);
          this.lpState += f * 2 * (thisSample - this.lpState);
          out[n] = this.lpState;
        } else if (shape === PL_SHAPE_SQUARE_BRIGHT) {
          thisSample = 2 * thisSample - 1;
          this.lpState += f * 2 * (thisSample - this.lpState);
          out[n] = (thisSample - this.lpState) * 0.5;
        } else {
          out[n] = 2 * thisSample - 1;
        }
      }
    }
    this.nextSample = nextSample;
    this.frequency = fv; this.pw = pv;
  }
}

// ---- plaits/dsp/oscillator/sine_oscillator.h
const PL_SINE_LUT_SIZE = 512, PL_SINE_LUT_BITS = 9;
function plSine(phase) { return plInterpolateWrap(PL_SINE, phase, PL_SINE_LUT_SIZE); }
function plSineNoWrap(phase) { return plInterpolate(PL_SINE, phase, PL_SINE_LUT_SIZE); }
// phase: a uint32; pm: phase modulation of up to an index of 32 either way
function plSinePM(phase, pm) {
  phase = (phase + (Math.imul(((pm + 32) * 67108864) >>> 0, 64) >>> 0)) >>> 0;
  const integral = phase >>> 23;
  const fractional = ((phase << 9) >>> 0) / 4294967296;
  const a = PL_SINE[integral], b = PL_SINE[integral + 1];
  return a + (b - a) * fractional;
}
function plSineRaw(phase) { return PL_SINE[phase >>> 23]; }

class PlSineOscillator {
  constructor() { this.init(); }
  init() { this.phase = 0; this.frequency = 0; this.amplitude = 0; }
  next(frequency) {
    if (frequency >= 0.5) frequency = 0.5;
    this.phase += frequency;
    if (this.phase >= 1) this.phase -= 1;
    return plSineNoWrap(this.phase);
  }
  // returns [sin, cos] scaled by amplitude
  nextQuadrature(frequency, amplitude, outPair) {
    if (frequency >= 0.5) frequency = 0.5;
    this.phase += frequency;
    if (this.phase >= 1) this.phase -= 1;
    outPair[0] = amplitude * plSineNoWrap(this.phase);
    outPair[1] = amplitude * plSineNoWrap(this.phase + 0.25);
  }
  // with an amplitude, adds into out (as the original's Render(frequency, amplitude, out, size)); without, writes
  render(frequency, out, size, amplitude) {
    const additive = amplitude !== undefined;
    if (frequency >= 0.5) frequency = 0.5;
    let fv = this.frequency; const df = (frequency - fv) / size;
    let av = this.amplitude; const da = additive ? (amplitude - av) / size : 0;
    for (let n = 0; n < size; n++) {
      fv += df;
      this.phase += fv;
      if (this.phase >= 1) this.phase -= 1;
      const s = plSineNoWrap(this.phase);
      if (additive) { av += da; out[n] += av * s; } else out[n] = s;
    }
    this.frequency = fv;
    if (additive) this.amplitude = av;
  }
}

const PL_FAST_NORMAL = 0, PL_FAST_ADDITIVE = 1, PL_FAST_QUADRATURE = 2;
class PlFastSineOscillator {
  constructor() { this.init(); }
  init() { this.x = 1; this.y = 0; this.epsilon = 0; this.amplitude = 0; }
  static fast2Sin(f) { const fp = f * Math.PI; return fp * (2 - (2 * 0.96 / 6) * fp * fp); }
  render(frequency, out, size) { this.renderInternal(PL_FAST_NORMAL, frequency, 1, out, null, size); }
  renderAdd(frequency, amplitude, out, size) { this.renderInternal(PL_FAST_ADDITIVE, frequency, amplitude, out, null, size); }
  renderQuadrature(frequency, amplitude, x, y, size) { this.renderInternal(PL_FAST_QUADRATURE, frequency, amplitude, x, y, size); }
  renderInternal(mode, frequency, amplitude, out, out2, size) {
    if (frequency >= 0.25) { frequency = 0.25; amplitude = 0; } else amplitude *= 1 - frequency * 4;
    let ev = this.epsilon; const de = (PlFastSineOscillator.fast2Sin(frequency) - ev) / size;
    let av = this.amplitude; const da = (amplitude - av) / size;
    let x = this.x, y = this.y;
    const norm = x * x + y * y;
    if (norm <= 0.5 || norm >= 2) { const scale = 1 / Math.sqrt(norm); x *= scale; y *= scale; }
    for (let n = 0; n < size; n++) {
      ev += de;
      x += ev * y;
      y -= ev * x;
      if (mode === PL_FAST_ADDITIVE) { av += da; out[n] += av * x; }
      else if (mode === PL_FAST_NORMAL) out[n] = x;
      else { av += da; out[n] = x * av; out2[n] = y * av; }
    }
    this.x = x; this.y = y; this.epsilon = ev;
    if (mode !== PL_FAST_NORMAL) this.amplitude = av;
  }
}

// ---- plaits/dsp/downsampler/4x_downsampler.h: a downsampler keeps one float of state between blocks
const PL_OVERSAMPLING = 4;

// ---- stmlib/dsp/filter.h: the tangent approximations, and the one-pole filter
const PL_FREQ_EXACT = 0, PL_FREQ_ACCURATE = 1, PL_FREQ_FAST = 2, PL_FREQ_DIRTY = 3;
const PL_PI3 = Math.PI ** 3, PL_PI5 = Math.PI ** 5, PL_PI7 = Math.PI ** 7, PL_PI9 = Math.PI ** 9, PL_PI11 = Math.PI ** 11;
function plTan(approximation, f) {
  if (approximation === PL_FREQ_EXACT) return Math.tan(Math.PI * (f < 0.497 ? f : 0.497));
  if (approximation === PL_FREQ_DIRTY) return f * (Math.PI + 3.736e-01 * PL_PI3 * f * f);
  const f2 = f * f;
  if (approximation === PL_FREQ_FAST) return f * (Math.PI + f2 * (3.260e-01 * PL_PI3 + 1.823e-01 * PL_PI5 * f2));
  return f * (Math.PI + f2 * (3.333314036e-01 * PL_PI3 + f2 * (1.333923995e-01 * PL_PI5
    + f2 * (5.33740603e-02 * PL_PI7 + f2 * (2.900525e-03 * PL_PI9 + f2 * 9.5168091e-03 * PL_PI11)))));
}
const PL_LOW_PASS = 0, PL_BAND_PASS = 1, PL_BAND_PASS_NORMALIZED = 2, PL_HIGH_PASS = 3;

class PlOnePole {
  constructor() { this.setF(PL_FREQ_DIRTY, 0.01); this.state = 0; }
  reset() { this.state = 0; }
  setF(approximation, f) { this.g = plTan(approximation, f); this.gi = 1 / (1 + this.g); }
  process(mode, x) {
    const lp = (this.g * x + this.state) * this.gi;
    this.state = this.g * (x - lp) + lp;
    return mode === PL_LOW_PASS ? lp : mode === PL_HIGH_PASS ? x - lp : 0;
  }
  processBuffer(mode, buf, size) { for (let i = 0; i < size; i++) buf[i] = this.process(mode, buf[i]); }
}

// ---- plaits/dsp/oscillator/grainlet_oscillator.h: grains of a formant, one per period of the carrier
class PlGrainletOscillator {
  constructor() { this.init(); }
  init() {
    this.carrierPhase = 0; this.formantPhase = 0; this.nextSample = 0;
    this.carrierFrequency = 0; this.formantFrequency = 0; this.carrierShape = 0; this.carrierBleed = 0;
  }
  render(carrierFrequency, formantFrequency, carrierShape, carrierBleed, out, size) {
    if (carrierFrequency >= PL_MAX_FREQUENCY * 0.5) carrierFrequency = PL_MAX_FREQUENCY * 0.5;
    if (formantFrequency >= PL_MAX_FREQUENCY) formantFrequency = PL_MAX_FREQUENCY;
    let cf = this.carrierFrequency; const dcf = (carrierFrequency - cf) / size;
    let ff = this.formantFrequency; const dff = (formantFrequency - ff) / size;
    let cs = this.carrierShape; const dcs = (carrierShape - cs) / size;
    let cb = this.carrierBleed; const dcb = (carrierBleed - cb) / size;
    let nextSample = this.nextSample;
    for (let n = 0; n < size; n++) {
      let thisSample = nextSample;
      nextSample = 0;
      cf += dcf; ff += dff;
      const f0 = cf, f1 = ff;
      this.carrierPhase += f0;
      if (this.carrierPhase >= 1) {
        this.carrierPhase -= 1;
        const resetTime = this.carrierPhase / f0;
        const before = this.grainlet(1, this.formantPhase + (1 - resetTime) * f1, cs + dcs * (1 - resetTime), cb + dcb * (1 - resetTime));
        const after = this.grainlet(0, 0, cs + dcs, cb + dcb);
        const d = after - before;
        thisSample += d * plThisBlepSample(resetTime);
        nextSample += d * plNextBlepSample(resetTime);
        this.formantPhase = resetTime * f1;
      } else {
        this.formantPhase += f1;
        if (this.formantPhase >= 1) this.formantPhase -= 1;
      }
      cs += dcs; cb += dcb;
      nextSample += this.grainlet(this.carrierPhase, this.formantPhase, cs, cb);
      out[n] = thisSample;
    }
    this.nextSample = nextSample;
    this.carrierFrequency = cf; this.formantFrequency = ff; this.carrierShape = cs; this.carrierBleed = cb;
  }
  carrier(phase, shape) {
    shape *= 3;
    const si = shape | 0;
    let t = 1 - (shape - si);
    if (si === 0) {
      phase = phase * (1 + t * t * t * 15);
      if (phase >= 1) phase = 1;
      phase += 0.75;
    } else if (si === 1) {
      const bp = 0.001 + 0.499 * t * t * t;
      phase = phase < bp ? phase * (0.5 / bp) : 0.5 + (phase - bp) * 0.5 / (1 - bp);
      phase += 0.75;
    } else {
      t = 1 - t;
      phase = 0.25 + phase * (0.5 + t * t * t * 14.5);
      if (phase >= 0.75) phase = 0.75;
    }
    return (plSine(phase) + 1) * 0.25;
  }
  grainlet(carrierPhase, formantPhase, shape, bleed) {
    return this.carrier(carrierPhase, shape) * (plSine(formantPhase) + bleed) / (1 + bleed);
  }
}

// ---- plaits/dsp/oscillator/z_oscillator.h: a formant reset, Casio CZ style, by a carrier at twice the rate
class PlZOscillator {
  constructor() { this.init(); }
  init() {
    this.carrierPhase = 0; this.discontinuityPhase = 0; this.formantPhase = 0; this.nextSample = 0;
    this.carrierFrequency = 0; this.formantFrequency = 0; this.carrierShape = 0; this.mode = 0;
  }
  render(carrierFrequency, formantFrequency, carrierShape, mode, out, size) {
    if (carrierFrequency >= PL_MAX_FREQUENCY * 0.5) carrierFrequency = PL_MAX_FREQUENCY * 0.5;
    if (formantFrequency >= PL_MAX_FREQUENCY) formantFrequency = PL_MAX_FREQUENCY;
    let cf = this.carrierFrequency; const dcf = (carrierFrequency - cf) / size;
    let ff = this.formantFrequency; const dff = (formantFrequency - ff) / size;
    let cs = this.carrierShape; const dcs = (carrierShape - cs) / size;
    let md = this.mode; const dmd = (mode - md) / size;
    let nextSample = this.nextSample;
    for (let n = 0; n < size; n++) {
      let thisSample = nextSample;
      nextSample = 0;
      cf += dcf; ff += dff;
      const f0 = cf, f1 = ff;
      this.discontinuityPhase += 2 * f0;
      this.carrierPhase += f0;
      if (this.discontinuityPhase >= 1) {
        this.discontinuityPhase -= 1;
        const resetTime = this.discontinuityPhase / (2 * f0);
        const cBefore = this.carrierPhase >= 1 ? 1 : 0.5, cAfter = this.carrierPhase >= 1 ? 0 : 0.5;
        const before = this.z(cBefore, 1, this.formantPhase + (1 - resetTime) * f1, cs + dcs * (1 - resetTime), md + dmd * (1 - resetTime));
        const after = this.z(cAfter, 0, 0, cs + dcs, md + dmd);
        const d = after - before;
        thisSample += d * plThisBlepSample(resetTime);
        nextSample += d * plNextBlepSample(resetTime);
        this.formantPhase = resetTime * f1;
        if (this.carrierPhase > 1) this.carrierPhase = this.discontinuityPhase * 0.5;
      } else {
        this.formantPhase += f1;
        if (this.formantPhase >= 1) this.formantPhase -= 1;
      }
      if (this.carrierPhase >= 1) this.carrierPhase -= 1;
      cs += dcs; md += dmd;
      nextSample += this.z(this.carrierPhase, this.discontinuityPhase, this.formantPhase, cs, md);
      out[n] = thisSample;
    }
    this.nextSample = nextSample;
    this.carrierFrequency = cf; this.formantFrequency = ff; this.carrierShape = cs; this.mode = md;
  }
  z(c, d, f, shape, mode) {
    let rampDown = 0.5 * (1 + plSine(0.5 * d + 0.25));
    let offset, phaseShift;
    if (mode < 0.333) { offset = 1; phaseShift = 0.25 + mode * 1.5; }
    else if (mode < 0.666) { phaseShift = 0.7495 - (mode - 0.33) * 0.75; offset = -plSine(phaseShift); }
    else { phaseShift = 0.7495 - (mode - 0.33) * 0.75; offset = 0.001; }
    const discontinuity = plSine(f + phaseShift);
    let contour;
    if (shape < 0.5) {
      shape *= 2;
      if (c >= 0.5) rampDown *= shape;
      contour = 1 + (plSine(c + 0.25) - 1) * shape;
    } else {
      contour = plSine(c + shape * 0.5);
    }
    return (rampDown * (offset + discontinuity) - offset) * contour;
  }
}

// ---- plaits/dsp/oscillator/harmonic_oscillator.h: a batch of harmonics by the Chebyshev recurrence
class PlHarmonicOscillator {
  constructor(numHarmonics) {
    this.n = numHarmonics;
    this.phase = 0; this.frequency = 0;
    this.amplitude = new Float64Array(numHarmonics);
    this.increment = new Float64Array(numHarmonics);
  }
  // the first batch (firstHarmonic 1) writes out; later batches add to it. \`amps\` is read from \`offset\`.
  render(firstHarmonic, frequency, amps, offset, out, size) {
    if (frequency >= 0.5) frequency = 0.5;
    const n = this.n, amp = this.amplitude, inc = this.increment;
    for (let i = 0; i < n; i++) {
      let f = frequency * (firstHarmonic + i);
      if (f >= 0.5) f = 0.5;
      inc[i] = (amps[offset + i] * (1 - f * 2) - amp[i]) / size;
    }
    let fv = this.frequency; const df = (frequency - fv) / size;
    for (let s = 0; s < size; s++) {
      fv += df;
      this.phase += fv;
      if (this.phase >= 1) this.phase -= 1;
      const twoX = 2 * plSineNoWrap(this.phase);
      let previous, current;
      if (firstHarmonic === 1) { previous = 1; current = twoX * 0.5; }
      else { previous = plSine(this.phase * (firstHarmonic - 1) + 0.25); current = plSine(this.phase * firstHarmonic); }
      let sum = 0;
      for (let i = 0; i < n; i++) {
        amp[i] += inc[i];
        sum += amp[i] * current;
        const temp = current;
        current = twoX * current - previous;
        previous = temp;
      }
      if (firstHarmonic === 1) out[s] = sum; else out[s] += sum;
    }
    this.frequency = fv;
  }
}

// ---- stmlib/dsp/hysteresis_quantizer.h (HysteresisQuantizer2)
class PlHysteresisQuantizer {
  constructor(numSteps, hysteresis, symmetric) {
    this.numSteps = numSteps; this.hysteresis = hysteresis;
    this.scale = symmetric ? numSteps - 1 : numSteps; this.offset = symmetric ? 0 : -0.5;
    this.quantizedValue = 0;
  }
  // in single precision, as on the module: a value right at a threshold falls the same side
  process(value, base = 0) {
    const f = Math.fround;
    value = f(f(f(f(value) * this.scale) + this.offset) + base);
    const sign = value > this.quantizedValue ? -1 : 1;
    const q = plConstrain(f(f(value + f(sign * f(this.hysteresis))) + 0.5) | 0, 0, this.numSteps - 1);
    this.quantizedValue = q;
    return q;
  }
}

// ---- plaits/dsp/oscillator/string_synth_oscillator.h: divide-down saws at 8', 4', 2', 1', as on a string machine
class PlStringSynthOscillator {
  constructor() {
    this.phase = 0; this.nextSample = 0; this.segment = 0;
    this.frequency = 0.001; this.saw8 = 0; this.saw4 = 0; this.saw2 = 0; this.saw1 = 0;
    this.registration = new Float64Array(7);
  }
  // adds into out
  render(frequency, unshifted, gain, out, size) {
    frequency *= 8;
    let shift = 0;
    while (frequency > 0.5) { shift += 2; frequency *= 0.5; }
    if (shift >= 8) return;
    const r = this.registration;
    for (let i = 0; i < 7; i++) r[i] = i < shift ? 0 : unshifted[i - shift];
    let fv = this.frequency; const df = (frequency - fv) / size;
    let g8 = this.saw8; const d8 = ((r[0] + 2 * r[1]) * gain - g8) / size;
    let g4 = this.saw4; const d4 = ((r[2] - r[1] + 2 * r[3]) * gain - g4) / size;
    let g2 = this.saw2; const d2 = ((r[4] - r[3] + 2 * r[5]) * gain - g2) / size;
    let g1 = this.saw1; const d1 = ((r[6] - r[5]) * gain - g1) / size;
    let phase = this.phase, nextSample = this.nextSample, segment = this.segment;
    for (let n = 0; n < size; n++) {
      let thisSample = nextSample;
      nextSample = 0;
      fv += df; g8 += d8; g4 += d4; g2 += d2; g1 += d1;
      phase += fv;
      let nextSegment = phase | 0;
      if (nextSegment !== segment) {
        let d = 0;
        if (nextSegment === 8) { phase -= 8; nextSegment -= 8; d -= g8; }
        if ((nextSegment & 3) === 0) d -= g4;
        if ((nextSegment & 1) === 0) d -= g2;
        d -= g1;
        if (d !== 0) {
          const t = (phase - nextSegment) / fv;
          thisSample += plThisBlepSample(t) * d;
          nextSample += plNextBlepSample(t) * d;
        }
      }
      segment = nextSegment;
      nextSample += (phase - 4) * g8 * 0.125;
      nextSample += (phase - (segment & 4) - 2) * g4 * 0.25;
      nextSample += (phase - (segment & 6) - 1) * g2 * 0.5;
      nextSample += (phase - (segment & 7) - 0.5) * g1;
      out[n] += 2 * thisSample;
    }
    this.nextSample = nextSample; this.phase = phase; this.segment = segment;
    this.frequency = fv; this.saw8 = g8; this.saw4 = g4; this.saw2 = g2; this.saw1 = g1;
  }
}

// ---- plaits/dsp/oscillator/wavetable_oscillator.h (approximate scale, high frequencies attenuated)
// \`waves\`: where each wave starts in \`table\` (Plaits' integrated waves); adds into out
class PlWavetableOscillator {
  constructor(tableSize, numWaves) {
    this.tableSize = tableSize; this.numWaves = numWaves;
    this.phase = 0; this.frequency = 0; this.amplitude = 0; this.waveform = 0; this.lp = 0;
    this.diffLp = 0; this.diffPrevious = 0;
  }
  render(frequency, amplitude, waveform, table, waves, out, size) {
    frequency = plConstrain(frequency, 0.0000001, PL_MAX_FREQUENCY);
    amplitude *= 1 - 2 * frequency;
    amplitude *= 1 / (frequency * 131072);
    let fv = this.frequency; const df = (frequency - fv) / size;
    let av = this.amplitude; const da = (amplitude - av) / size;
    let wv = this.waveform; const dw = (waveform * (this.numWaves - 1.0001) - wv) / size;
    let lp = this.lp, phase = this.phase;
    const N = this.tableSize;
    for (let n = 0; n < size; n++) {
      fv += df; wv += dw; av += da;
      const f0 = fv;
      const cutoff = Math.min(N * f0, 1);
      phase += f0;
      if (phase >= 1) phase -= 1;
      const wi = wv | 0, wf = wv - wi;
      const pp = phase * N, pi = pp | 0, pf = pp - pi;
      const o0 = waves[wi] + pi, o1 = waves[wi + 1] + pi;
      const x0 = table[o0] + (table[o0 + 1] - table[o0]) * pf;
      const x1 = table[o1] + (table[o1 + 1] - table[o1]) * pf;
      const sIn = x0 + (x1 - x0) * wf;
      this.diffLp += cutoff * (sIn - this.diffPrevious - this.diffLp);
      this.diffPrevious = sIn;
      lp += cutoff * (this.diffLp - lp);
      out[n] += av * lp;
    }
    this.lp = lp; this.phase = phase;
    this.frequency = fv; this.amplitude = av; this.waveform = wv;
  }
}

// ---- stmlib/utils/random.h: one generator shared by everything, as on the module (the tests seed it)
let PL_RNG = 0x21;
function plRandomSeed(seed) { PL_RNG = seed >>> 0; }
function plRandomWord() { PL_RNG = (Math.imul(PL_RNG, 1664525) + 1013904223) >>> 0; return PL_RNG; }
function plRandomSample() { return (plRandomWord() >>> 16) << 16 >> 16; }
function plRandomFloat() { return plRandomWord() / 4294967296; }

// ---- stmlib/dsp/filter.h: the state-variable filter (Svf)
class PlSvf {
  constructor() { this.setFQ(PL_FREQ_DIRTY, 0.01, 100); this.s1 = 0; this.s2 = 0; }
  reset() { this.s1 = 0; this.s2 = 0; }
  copyFrom(f) { this.g = f.g; this.r = f.r; this.h = f.h; }
  setGRH(g, r, h) { this.g = g; this.r = r; this.h = h; }
  setGR(g, r) { this.g = g; this.r = r; this.h = 1 / (1 + r * g + g * g); }
  setGQ(g, resonance) { this.g = g; this.r = 1 / resonance; this.h = 1 / (1 + this.r * g + g * g); }
  setFQ(approximation, f, resonance) {
    this.g = plTan(approximation, f); this.r = 1 / resonance;
    this.h = 1 / (1 + this.r * this.g + this.g * this.g);
  }
  // one sample; the mode picks the output
  process(mode, x) {
    const g = this.g, r = this.r;
    const hp = (x - r * this.s1 - g * this.s1 - this.s2) * this.h;
    const bp = g * hp + this.s1;
    this.s1 = g * hp + bp;
    const lp = g * bp + this.s2;
    this.s2 = g * bp + lp;
    return mode === PL_LOW_PASS ? lp : mode === PL_BAND_PASS ? bp : mode === PL_BAND_PASS_NORMALIZED ? bp * r : hp;
  }
  processBuffer(mode, input, out, size) { for (let i = 0; i < size; i++) out[i] = this.process(mode, input[i]); }
  processAdd(mode, input, out, size, gain) { for (let i = 0; i < size; i++) out[i] += gain * this.process(mode, input[i]); }
  // adds one mode's output into two buffers, with a gain each
  processAdd2(mode, input, out1, out2, size, gain1, gain2) {
    for (let i = 0; i < size; i++) { const v = this.process(mode, input[i]); out1[i] += v * gain1; out2[i] += v * gain2; }
  }
  processMultimode(input, out, size, mode) {
    const hpG = mode < 0.5 ? -mode * 2 : -2 + mode * 2, lpG = mode < 0.5 ? 1 - mode * 2 : 0, bpG = mode < 0.5 ? 0 : mode * 2 - 1;
    const g = this.g, r = this.r, h = this.h;
    let s1 = this.s1, s2 = this.s2;
    for (let i = 0; i < size; i++) {
      const hp = (input[i] - r * s1 - g * s1 - s2) * h, bp = g * hp + s1;
      s1 = g * hp + bp;
      const lp = g * bp + s2;
      s2 = g * bp + lp;
      out[i] = hpG * hp + bpG * bp + lpG * lp;
    }
    this.s1 = s1; this.s2 = s2;
  }
  processMultimodeLPtoHP(input, out, size, mode) {
    const hpG = Math.min(-mode * 2 + 1, 0), bpG = 1 - 2 * Math.abs(mode - 0.5), lpG = Math.max(1 - mode * 2, 0);
    const g = this.g, r = this.r, h = this.h;
    let s1 = this.s1, s2 = this.s2;
    for (let i = 0; i < size; i++) {
      const hp = (input[i] - r * s1 - g * s1 - s2) * h, bp = g * hp + s1;
      s1 = g * hp + bp;
      const lp = g * bp + s2;
      s2 = g * bp + lp;
      out[i] = hpG * hp + bpG * bp + lpG * lp;
    }
    this.s1 = s1; this.s2 = s2;
  }
}

// ---- stmlib/dsp/cosine_oscillator.h (the approximate one): a slow cosine for the FX engine's LFOs
class PlCosineOscillator {
  constructor(frequency) {
    let sign = 16;
    frequency -= 0.25;
    if (frequency < 0) frequency = -frequency;
    else if (frequency > 0.5) frequency -= 0.5;
    else sign = -16;
    this.iir = sign * frequency * (1 - 2 * frequency);
    this.y1 = this.iir * 0.25; this.y0 = 0.5;
  }
  value() { return this.y1 + 0.5; }
  next() { const t = this.y0; this.y0 = this.iir * this.y0 - this.y1; this.y1 = t; return t + 0.5; }
}

// ---- plaits/dsp/fx/fx_engine.h: delay memory for small reverbs and diffusers, stored at 12 bits as on the module
// \`lines\`: each delay line's length, in order (FxEngine's Reserve list); a line is { base, length }
class PlFxEngine {
  constructor(size, lines) {
    this.size = size; this.mask = size - 1;
    this.buffer = new Int16Array(size);
    let base = 0;
    this.lines = lines.map((length) => { const d = { base, length }; base += length + 1; return d; });
    this.writePtr = 0;
    this.lfo = [new PlCosineOscillator(0), new PlCosineOscillator(0)];
    this.acc = 0; this.previousRead = 0; this.lfoValue = [0, 0];
  }
  setLFOFrequency(index, frequency) { this.lfo[index] = new PlCosineOscillator(frequency * 32); }
  clear() { this.buffer.fill(0); this.writePtr = 0; }
  static compress(v) { const x = Math.trunc(v * 4096); return x < -32768 ? -32768 : x > 32767 ? 32767 : x; }
  start() {
    if (--this.writePtr < 0) this.writePtr += this.size;
    this.acc = 0; this.previousRead = 0;
    if ((this.writePtr & 31) === 0) { this.lfoValue[0] = this.lfo[0].next(); this.lfoValue[1] = this.lfo[1].next(); }
    else { this.lfoValue[0] = this.lfo[0].value(); this.lfoValue[1] = this.lfo[1].value(); }
  }
  load(v) { this.acc = v; }
  readValue(v, scale = 1) { this.acc += v * scale; }
  // reads a line at an offset (-1: its tail)
  read(d, offset, scale) {
    const at = offset === -1 ? this.writePtr + d.base + d.length - 1 : this.writePtr + d.base + offset;
    const r = this.buffer[at & this.mask] / 4096;
    this.previousRead = r;
    this.acc += r * scale;
  }
  write(d, offset, scale) {
    const at = offset === -1 ? this.writePtr + d.base + d.length - 1 : this.writePtr + d.base + offset;
    this.buffer[at & this.mask] = PlFxEngine.compress(this.acc);
    this.acc *= scale;
  }
  writeAllPass(d, offset, scale) { this.write(d, offset, scale); this.acc += this.previousRead; }
  // writes the accumulator out (returned), and scales what stays
  writeValue(scale) { const v = this.acc; this.acc *= scale; return v; }
  lp(state, coefficient) { state += coefficient * (this.acc - state); this.acc = state; return state; }
  hp(state, coefficient) { state += coefficient * (this.acc - state); this.acc -= state; return state; }
  interpolate(d, offset, lfoIndex, amplitude, scale) {
    if (lfoIndex >= 0) offset += amplitude * this.lfoValue[lfoIndex];
    const oi = offset | 0, of = offset - oi;
    const a = this.buffer[(this.writePtr + oi + d.base) & this.mask] / 4096;
    const b = this.buffer[(this.writePtr + oi + d.base + 1) & this.mask] / 4096;
    const x = a + (b - a) * of;
    this.previousRead = x;
    this.acc += x * scale;
  }
}

// ---- plaits/dsp/fx/diffuser.h: four all-passes and a modulated loop, smearing a signal in time
class PlDiffuser {
  constructor() {
    this.engine = new PlFxEngine(8192, [126, 180, 269, 444, 1653, 2010, 3411]);
    this.engine.setLFOFrequency(0, 0.3 / 48000);
    this.lpDecay = 0;
  }
  reset() { this.engine.clear(); }
  process(amount, rt, buf, size) {
    const e = this.engine, [ap1, ap2, ap3, ap4, dapa, dapb, del] = e.lines;
    const kap = 0.625, klp = 0.75;
    let lp = this.lpDecay;
    for (let i = 0; i < size; i++) {
      e.start();
      e.readValue(buf[i]);
      e.read(ap1, -1, kap); e.writeAllPass(ap1, 0, -kap);
      e.read(ap2, -1, kap); e.writeAllPass(ap2, 0, -kap);
      e.read(ap3, -1, kap); e.writeAllPass(ap3, 0, -kap);
      e.interpolate(ap4, 400, 0, 43, kap); e.writeAllPass(ap4, 0, -kap);
      e.interpolate(del, 3070, 0, 340, rt);
      lp = e.lp(lp, klp);
      e.read(dapa, -1, -kap); e.writeAllPass(dapa, 0, kap);
      e.read(dapb, -1, kap); e.writeAllPass(dapb, 0, -kap);
      e.write(del, 0, 2);
      const wet = e.writeValue(0);
      buf[i] += amount * (wet - buf[i]);
    }
    this.lpDecay = lp;
  }
}

// ---- plaits/dsp/noise/clocked_noise.h: sample-and-hold noise at a clock (band-limited steps)
class PlClockedNoise {
  constructor() { this.phase = 0; this.sample = 0; this.nextSample = 0; this.frequency = 0.001; }
  render(sync, frequency, out, size) {
    frequency = plConstrain(frequency, 0, 1);
    let fv = this.frequency; const df = (frequency - fv) / size;
    let nextSample = this.nextSample, sample = this.sample;
    if (sync) this.phase = 1;
    for (let n = 0; n < size; n++) {
      let thisSample = nextSample;
      nextSample = 0;
      fv += df;
      const f = fv;
      const raw = plRandomFloat() * 2 - 1;
      const rawAmount = plConstrain(4 * (f - 0.25), 0, 1);
      this.phase += f;
      if (this.phase >= 1) {
        this.phase -= 1;
        const t = this.phase / f, d = raw - sample;
        thisSample += d * plThisBlepSample(t);
        nextSample += d * plNextBlepSample(t);
        sample = raw;
      }
      nextSample += sample;
      out[n] = thisSample + rawAmount * (raw - thisSample);
    }
    this.nextSample = nextSample; this.sample = sample; this.frequency = fv;
  }
}

// ---- plaits/dsp/noise/particle.h: random impulses, each through a band-pass at a random pitch
class PlParticle {
  constructor() { this.preGain = 0; this.filter = new PlSvf(); }
  render(sync, density, gain, frequency, spread, q, out, aux, size) {
    let u = plRandomFloat();
    if (sync) u = density;
    let canRandomize = true;
    for (let n = 0; n < size; n++) {
      let s = 0;
      if (u <= density) {
        s = u * gain;
        if (canRandomize) {
          const v = 2 * plRandomFloat() - 1;
          const f = Math.min(plSemitonesToRatio(spread * v) * frequency, 0.25);
          this.preGain = 0.5 / Math.sqrt(q * f * Math.sqrt(density));
          this.filter.setFQ(PL_FREQ_DIRTY, f, q);
          canRandomize = false;
        }
      }
      aux[n] += s;
      out[n] += this.filter.process(PL_BAND_PASS, this.preGain * s);
      u = plRandomFloat();
    }
  }
}

// ---- plaits/dsp/noise/dust.h
function plDust(frequency) {
  const inv = 1 / frequency, u = plRandomFloat();
  return u < frequency ? u * inv : 0;
}

// ---- stmlib/dsp/filter.h (DCBlocker)
class PlDCBlocker {
  constructor(pole) { this.x = 0; this.y = 0; this.pole = pole; }
  process(v) { const oldX = this.x; this.x = v; this.y = this.y * this.pole + v - oldX; return this.y; }
}

// ---- plaits/dsp/physical_modelling/delay_line.h
class PlDelayLine {
  constructor(maxDelay) { this.max = maxDelay; this.line = new Float32Array(maxDelay); this.writePtr = 0; }
  reset() { this.line.fill(0); this.writePtr = 0; }
  write(s) { this.line[this.writePtr] = s; this.writePtr = (this.writePtr - 1 + this.max) % this.max; }
  allpass(s, delay, coefficient) {
    const read = this.line[(this.writePtr + delay) % this.max];
    const w = s + coefficient * read;
    this.write(w);
    return -w * coefficient + read;
  }
  read(delay) {
    const di = delay | 0, df = delay - di;
    const a = this.line[(this.writePtr + di) % this.max], b = this.line[(this.writePtr + di + 1) % this.max];
    return a + (b - a) * df;
  }
  readHermite(delay) {
    const di = delay | 0, f = delay - di, t = this.writePtr + di + this.max, M = this.max, L = this.line;
    const xm1 = L[(t - 1) % M], x0 = L[t % M], x1 = L[(t + 1) % M], x2 = L[(t + 2) % M];
    const c = (x1 - xm1) * 0.5, v = x0 - x1, w = c + v, a = w + v + (x2 - x0) * 0.5, bNeg = w + a;
    return (((a * f) - bNeg) * f + c) * f + x0;
  }
}

// ---- plaits/dsp/physical_modelling/string.cc: a Karplus-Strong string with a curved bridge (structure low) or
// dispersion (high), resampled so its delay fits the line at any pitch
const PL_STRING_DELAY = 1024;
class PlString {
  constructor() {
    this.string = new PlDelayLine(PL_STRING_DELAY);
    this.stretch = new PlDelayLine(PL_STRING_DELAY / 4);
    this.delay = 100;
    this.reset();
  }
  reset() {
    this.string.reset(); this.stretch.reset();
    this.iirDamping = new PlSvf();
    this.dcBlocker = new PlDCBlocker(1 - 20 / PL_SAMPLE_RATE);
    this.dispersionNoise = 0; this.curvedBridge = 0;
    this.out0 = 0; this.out1 = 0; this.srcPhase = 0;
  }
  // adds into out
  process(f0, nonLinearity, brightness, damping, input, out, size) {
    const dispersion = nonLinearity > 0;
    const amount = dispersion ? nonLinearity : -nonLinearity;
    let delay = plConstrain(1 / f0, 4, PL_STRING_DELAY - 4);
    let srcRatio = delay * f0;
    if (srcRatio >= 0.9999) { this.srcPhase = 1; srcRatio = 1; }
    let dampingCutoff = Math.min(12 + damping * damping * 60 + brightness * 24, 84);
    let dampingF = Math.min(f0 * plSemitonesToRatio(dampingCutoff), 0.499);
    if (damping >= 0.95) {
      const toInfinite = 20 * (damping - 0.95);
      brightness += toInfinite * (1 - brightness);
      dampingF += toInfinite * (0.4999 - dampingF);
      dampingCutoff += toInfinite * (128 - dampingCutoff);
    }
    this.iirDamping.setFQ(PL_FREQ_FAST, dampingF, 0.5);
    const compensation = plInterpolate(PL_SVF_SHIFT, dampingCutoff, 1);
    // the delay steps only when the resampler takes a sample, so it may end the block short of its target
    let dv = this.delay; const dd = (delay * compensation - dv) / size;
    const stretchPoint = amount * (2 - amount) * 0.225;
    const stretchCorrection = plConstrain((160 / PL_SAMPLE_RATE) * delay, 1, 2.1);
    const noiseSqrt = amount > 0.75 ? 4 * (amount - 0.75) : 0;
    const noiseAmount = noiseSqrt * noiseSqrt * 0.1;
    const noiseFilter = 0.06 + 0.94 * brightness * brightness;
    const bridgeCurving = amount * amount * 0.01;
    const apGain = -0.618 * amount / (0.15 + Math.abs(amount));
    for (let n = 0; n < size; n++) {
      this.srcPhase += srcRatio;
      if (this.srcPhase > 1) {
        this.srcPhase -= 1;
        dv += dd;
        let d = dv, s = 0;
        if (dispersion) {
          const noise = plRandomFloat() - 0.5;
          this.dispersionNoise += noiseFilter * (noise - this.dispersionNoise);
          d *= 1 + this.dispersionNoise * noiseAmount;
          const apDelay = d * stretchPoint;
          const mainDelay = d - apDelay * (0.408 - stretchPoint * 0.308) * stretchCorrection;
          if (apDelay >= 4 && mainDelay >= 4) {
            s = this.string.read(mainDelay);
            s = this.stretch.allpass(s, apDelay | 0, apGain);
          } else {
            s = this.string.readHermite(d);
          }
        } else {
          d *= 1 - this.curvedBridge * bridgeCurving;
          s = this.string.readHermite(d);
          const value = Math.abs(s) - 0.025, sign = s > 0 ? 1 : -1.5;
          this.curvedBridge = (Math.abs(value) + value) * sign;
        }
        s = plConstrain(s + input[n], -20, 20);
        s = this.dcBlocker.process(s);
        s = this.iirDamping.process(PL_LOW_PASS, s);
        this.string.write(s);
        this.out1 = this.out0;
        this.out0 = s;
      }
      out[n] += this.out1 + (this.out0 - this.out1) * this.srcPhase;
    }
    this.delay = dv;
  }
}

// ---- plaits/dsp/physical_modelling/string_voice.cc: a string, plucked by a burst of filtered noise (or bowed
// by dust when the trigger is not patched)
class PlStringVoice {
  constructor() { this.excitationFilter = new PlSvf(); this.string = new PlString(); this.remainingNoiseSamples = 0; }
  reset() { this.string.reset(); }
  render(sustain, trigger, accent, f0, structure, brightness, damping, temp, out, aux, size) {
    const density = brightness * brightness;
    brightness += 0.25 * accent * (1 - brightness);
    damping += 0.25 * accent * (1 - damping);
    if (trigger || sustain) {
      const f = 4 * f0;
      const cutoff = Math.min(f * plSemitonesToRatio((brightness * (2 - brightness) - 0.5) * 72), 0.499);
      this.remainingNoiseSamples = (1 / f0) >>> 0;
      this.excitationFilter.setFQ(PL_FREQ_DIRTY, cutoff, sustain ? 1 : 0.5);
    }
    if (sustain) {
      const dustF = 0.00005 + 0.99995 * density * density;
      for (let i = 0; i < size; i++) temp[i] = plDust(dustF) * (8 - dustF * 6) * accent;
    } else if (this.remainingNoiseSamples) {
      const noiseSamples = Math.min(this.remainingNoiseSamples, size);
      this.remainingNoiseSamples -= noiseSamples;
      for (let i = 0; i < size; i++) temp[i] = i < noiseSamples ? 2 * plRandomFloat() - 1 : 0;
    } else {
      temp.fill(0, 0, size);
    }
    this.excitationFilter.processBuffer(PL_LOW_PASS, temp, temp, size);
    for (let i = 0; i < size; i++) aux[i] += temp[i];
    const nonLinearity = structure < 0.24 ? (structure - 0.24) * 4.166 : structure > 0.26 ? (structure - 0.26) * 1.35135 : 0;
    this.string.process(f0, nonLinearity, brightness, damping, temp, out, size);
  }
}

// ---- plaits/dsp/physical_modelling/resonator.h, .cc: a bank of band-passes, tuned to a stiff bar or string
class PlResonatorSvf {
  constructor(n) {
    this.n = n;
    this.s1 = new Float64Array(n); this.s2 = new Float64Array(n);
    this.g = new Float64Array(n); this.rg = new Float64Array(n); this.h = new Float64Array(n); this.gains = new Float64Array(n);
  }
  init() { this.s1.fill(0); this.s2.fill(0); }
  // f, q, gain: one each per filter; lowPass or band-pass; add into out, or write it
  process(lowPass, add, f, q, gain, input, out, size) {
    const n = this.n, g = this.g, rg = this.rg, h = this.h, gains = this.gains, s1 = this.s1, s2 = this.s2;
    for (let i = 0; i < n; i++) {
      g[i] = plTan(PL_FREQ_FAST, f[i]);
      const r = 1 / q[i];
      h[i] = 1 / (1 + r * g[i] + g[i] * g[i]);
      rg[i] = r + g[i];
      gains[i] = gain[i];
    }
    for (let k = 0; k < size; k++) {
      const x = input[k];
      let y = 0;
      for (let i = 0; i < n; i++) {
        const hp = (x - rg[i] * s1[i] - s2[i]) * h[i];
        const bp = g[i] * hp + s1[i];
        s1[i] = g[i] * hp + bp;
        const lp = g[i] * bp + s2[i];
        s2[i] = g[i] * bp + lp;
        y += gains[i] * (lowPass ? lp : bp);
      }
      if (add) out[k] += y; else out[k] = y;
    }
  }
}

const PL_MAX_MODES = 24, PL_MODE_BATCH = 4;
function plNthHarmonicCompensation(n, stiffness) {
  let stretch = 1;
  for (let i = 0; i < n - 1; i++) { stretch += stiffness; stiffness *= stiffness < 0 ? 0.93 : 0.98; }
  return 1 / stretch;
}

class PlResonator {
  constructor() {
    this.resolution = PL_MAX_MODES;
    this.modeAmplitude = new Float64Array(PL_MAX_MODES);
    this.modeFilters = Array.from({ length: PL_MAX_MODES / PL_MODE_BATCH }, () => new PlResonatorSvf(PL_MODE_BATCH));
    this.modeQ = new Float64Array(PL_MODE_BATCH); this.modeF = new Float64Array(PL_MODE_BATCH); this.modeA = new Float64Array(PL_MODE_BATCH);
  }
  init(position, resolution) {
    this.resolution = Math.min(resolution, PL_MAX_MODES);
    const amplitudes = new PlCosineOscillator(position);
    for (let i = 0; i < resolution; i++) this.modeAmplitude[i] = amplitudes.next() * 0.25;
    for (const f of this.modeFilters) f.init();
  }
  // adds into out
  process(f0, structure, brightness, damping, input, out, size) {
    let stiffness = plInterpolate(PL_STIFFNESS, structure, 64);
    f0 *= plNthHarmonicCompensation(3, stiffness);
    let harmonic = f0, stretch = 1;
    const qSqrt = plSemitonesToRatio(damping * 79.7);
    let q = 500 * qSqrt * qSqrt;
    brightness *= 1 - structure * 0.3;
    brightness *= 1 - damping * 0.3;
    const qLoss = brightness * (2 - brightness) * 0.85 + 0.15;
    let batch = 0, filter = 0;
    for (let i = 0; i < this.resolution; i++) {
      let mf = harmonic * stretch;
      if (mf >= 0.499) mf = 0.499;
      this.modeF[batch] = mf;
      this.modeQ[batch] = 1 + mf * q;
      this.modeA[batch] = this.modeAmplitude[i] * (1 - mf * 2);
      if (++batch === PL_MODE_BATCH) {
        batch = 0;
        this.modeFilters[filter++].process(false, true, this.modeF, this.modeQ, this.modeA, input, out, size);
      }
      stretch += stiffness;
      stiffness *= stiffness < 0 ? 0.93 : 0.98;
      harmonic += f0;
      q *= qLoss;
    }
  }
}

// ---- plaits/dsp/physical_modelling/modal_voice.cc: the resonator struck by a filtered impulse (or bowed by dust)
class PlModalVoice {
  constructor() {
    this.excitationFilter = new PlResonatorSvf(1);
    this.resonator = new PlResonator();
    this.one = [1]; this.cutoff = [0]; this.q = [0];
  }
  init() { this.excitationFilter.init(); this.resonator.init(0.015, PL_MAX_MODES); }
  render(sustain, trigger, accent, f0, structure, brightness, damping, temp, out, aux, size) {
    const density = brightness * brightness;
    brightness += 0.25 * accent * (1 - brightness);
    damping += 0.25 * accent * (1 - damping);
    const range = sustain ? 36 : 60, f = sustain ? 4 * f0 : 2 * f0;
    const cutoff = Math.min(f * plSemitonesToRatio((brightness * (2 - brightness) - 0.5) * range), 0.499);
    const q = sustain ? 0.7 : 1.5;
    if (sustain) {
      const dustF = 0.00005 + 0.99995 * density * density;
      for (let i = 0; i < size; i++) temp[i] = plDust(dustF) * (4 - dustF * 3) * accent;
    } else {
      temp.fill(0, 0, size);
      if (trigger) {
        const attenuation = 1 - damping * 0.5;
        const amplitude = (0.12 + 0.08 * accent) * attenuation;
        temp[0] = amplitude * plSemitonesToRatio(cutoff * cutoff * 24) / cutoff;
      }
    }
    this.cutoff[0] = cutoff; this.q[0] = q;
    this.excitationFilter.process(true, false, this.cutoff, this.q, this.one, temp, temp, size);
    for (let i = 0; i < size; i++) aux[i] += temp[i];
    this.resonator.process(f0, structure, brightness, damping, temp, out, size);
  }
}
`;

