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
  process(value, base = 0) {
    value = value * this.scale + this.offset + base;
    const sign = value > this.quantizedValue ? -1 : 1;
    const q = plConstrain((value + sign * this.hysteresis + 0.5) | 0, 0, this.numSteps - 1);
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
`;

