/**
 * Braids' macro oscillator, as worklet source text: a port to JavaScript of Mutable Instruments' braids/
 * macro_oscillator.cc, analog_oscillator.cc and digital_oscillator.cc (MIT, Emilie Gillet; see src/audio/braids/LICENSE),
 * sample for sample: all 48 of its models, the easter egg last.
 * The module computes in 16-bit fixed point at 96 kHz with 32-bit phases, and the port keeps its arithmetic: an
 * unsigned 32-bit value is kept as a number in 0 .. 2^32 - 1 (`>>> 0` after a sum, `>>>` for its shifts,
 * `Math.imul` where a product wraps), a 16-bit store wraps as in C (`brS16`), and the C's arithmetic shifts on signed
 * values stay `>>`. Pitch is in 128ths of a semitone (MIDI note << 7), TIMBRE and COLOR are 0 .. 32767.
 * The interpolations' signed products (a difference times a 16- or 24-bit fraction) can pass 32 bits; in C that is
 * undefined, and the original compiled for the reference computes them in full, so the port does too
 * (`Math.floor(x / 65536)`) and matches it sample for sample.
 */
export const BRAIDS_OSCILLATORS_SOURCE = `
// ---- stmlib's fixed-point helpers
function brS16(x) { return (x << 16) >> 16; }
function brU16(x) { return x & 0xffff; }
function brClip(x) { return x < -32767 ? -32767 : x > 32767 ? 32767 : x; }
function brMix(a, b, balance) { balance &= 0xffff; return (a * (65535 - balance) + b * balance) >> 16; }
function brInterpolate824(table, phase) {
  const i = phase >>> 24, a = table[i], b = table[i + 1];
  return a + Math.floor((b - a) * ((phase >>> 8) & 0xffff) / 65536);
}
// the unsigned table version: the difference and product wrap as uint32
function brInterpolate824U(table, phase) {
  const i = phase >>> 24, a = table[i], b = table[i + 1];
  return (a + (Math.imul((b - a) >>> 0, (phase >>> 8) & 0xffff) >>> 16)) & 0xffff;
}
function brInterpolate88(table, index) {
  index &= 0xffff;
  const i = index >> 8, a = table[i], b = table[i + 1];
  return a + ((b - a) * (index & 0xff) >> 8);
}
function brCrossfade(tableA, tableB, phase, balance) {
  const a = brInterpolate824(tableA, phase), b = brInterpolate824(tableB, phase);
  return a + Math.floor((b - a) * (balance & 0xffff) / 65536);
}
// stmlib's Random: one generator, shared as on the module
let brRngState = 0x21;
function brRandomWord() { brRngState = (Math.imul(brRngState, 1664525) + 1013904223) >>> 0; return brRngState; }
function brRandomSample() { return brS16(brRandomWord() >>> 16); }
function brRandomSeed(seed) { brRngState = seed >>> 0; }

// ---- the analogue oscillator
const BR_OSC_SAW = 0, BR_OSC_VARIABLE_SAW = 1, BR_OSC_CSAW = 2, BR_OSC_SQUARE = 3, BR_OSC_TRIANGLE = 4, BR_OSC_SINE = 5,
  BR_OSC_TRIANGLE_FOLD = 6, BR_OSC_SINE_FOLD = 7, BR_OSC_BUZZ = 8;
const BR_HIGHEST_NOTE = 128 * 128, BR_PITCH_TABLE_START = 128 * 128, BR_OCTAVE = 12 * 128, BR_NUM_ZONES = 15;
const BR_COMBS = [BR_WAV_BANDLIMITED_COMB_0, BR_WAV_BANDLIMITED_COMB_1, BR_WAV_BANDLIMITED_COMB_2, BR_WAV_BANDLIMITED_COMB_3,
  BR_WAV_BANDLIMITED_COMB_4, BR_WAV_BANDLIMITED_COMB_5, BR_WAV_BANDLIMITED_COMB_6, BR_WAV_BANDLIMITED_COMB_7,
  BR_WAV_BANDLIMITED_COMB_8, BR_WAV_BANDLIMITED_COMB_9, BR_WAV_BANDLIMITED_COMB_10, BR_WAV_BANDLIMITED_COMB_11,
  BR_WAV_BANDLIMITED_COMB_12, BR_WAV_BANDLIMITED_COMB_13, BR_WAV_BANDLIMITED_COMB_14];
function brThisBlep(t) { if (t > 65535) t = 65535; return (t * t) >>> 18; }
function brNextBlep(t) { if (t > 65535) t = 65535; t = 65535 - t; return -((t * t) >>> 18); }

class BrAnalogOscillator {
  constructor() {
    // the module's oscillators are globals, zeroed before Init; previous_phase_increment_ is never set by Init
    this.phase = 0; this.phaseIncrement = 0; this.previousPhaseIncrement = 0; this.high = false;
    this.parameter = 0; this.previousParameter = 0; this.auxParameter = 0; this.discontinuityDepth = 0;
    this.pitch = 0; this.nextSample = 0; this.shape = 0; this.previousShape = 0;
  }
  init() {
    this.phase = 0; this.phaseIncrement = 1; this.high = false;
    this.parameter = this.previousParameter = 0; this.auxParameter = 0;
    this.discontinuityDepth = -16383; this.pitch = 60 << 7; this.nextSample = 0;
  }
  computePhaseIncrement(midiPitch) {
    if (midiPitch >= BR_HIGHEST_NOTE) midiPitch = BR_HIGHEST_NOTE - 1;
    let ref = midiPitch - BR_PITCH_TABLE_START, shifts = 0;
    while (ref < 0) { ref += BR_OCTAVE; shifts++; }
    const a = BR_LUT_OSCILLATOR_INCREMENTS[ref >> 4], b = BR_LUT_OSCILLATOR_INCREMENTS[(ref >> 4) + 1];
    const inc = (a + (((b - a) | 0) * (ref & 0xf) >> 4)) >>> 0;
    return shifts >= 32 ? 0 : inc >>> shifts;
  }
  // sync: per sample, 0 or 1 + the reset's fractional time (128ths); syncOut likewise, or null
  render(sync, buffer, syncOut, size) {
    if (this.shape !== this.previousShape) { this.init(); this.previousShape = this.shape; }
    this.phaseIncrement = this.computePhaseIncrement(this.pitch);
    if (this.pitch > BR_HIGHEST_NOTE) this.pitch = BR_HIGHEST_NOTE; else if (this.pitch < 0) this.pitch = 0;
    switch (this.shape) {
      case BR_OSC_SAW: this.renderSaw(sync, buffer, syncOut, size); break;
      case BR_OSC_VARIABLE_SAW: this.renderVariableSaw(sync, buffer, syncOut, size); break;
      case BR_OSC_CSAW: this.renderCSaw(sync, buffer, syncOut, size); break;
      case BR_OSC_SQUARE: this.renderSquare(sync, buffer, syncOut, size); break;
      case BR_OSC_TRIANGLE: this.renderTriangle(sync, buffer, size); break;
      case BR_OSC_SINE: this.renderSine(sync, buffer, size); break;
      case BR_OSC_TRIANGLE_FOLD: this.renderTriangleFold(sync, buffer, size); break;
      case BR_OSC_SINE_FOLD: this.renderSineFold(sync, buffer, size); break;
      default: this.renderBuzz(sync, buffer, size);
    }
  }
  // BEGIN_INTERPOLATE_PHASE_INCREMENT: the step from the last block's increment to this one's, as uint32 arithmetic
  incrementStep(size) {
    const prev = this.previousPhaseIncrement, cur = this.phaseIncrement;
    return prev < cur ? Math.floor((cur - prev) / size) >>> 0 : (~Math.floor((prev - cur) / size)) >>> 0;
  }
  writeSyncOut(syncOut, k, inc) {
    if (syncOut) syncOut[k] = this.phase < inc ? Math.floor(this.phase / (inc >>> 7)) + 1 : 0;
  }

  renderCSaw(sync, buffer, syncOut, size) {
    let inc = this.previousPhaseIncrement;
    const step = this.incrementStep(size);
    let next = this.nextSample;
    for (let k = 0; k < size; k++) {
      let syncReset = false, selfReset = false, transitionDuringReset = false, resetTime = 0;
      inc = (inc + step) >>> 0;
      let pw = (this.parameter * 49152) >>> 0;
      const minPw = Math.imul(8, inc) >>> 0;
      if (pw < minPw) pw = minPw;
      let thisSample = next;
      next = 0;
      if (sync[k]) {
        resetTime = (sync[k] - 1) << 9;
        const phaseAtReset = (this.phase + Math.imul(65535 - resetTime, inc >>> 16)) >>> 0;
        syncReset = true;
        transitionDuringReset = false;
        if (phaseAtReset < this.phase || (!this.high && phaseAtReset >= pw)) transitionDuringReset = true;
        if (this.phase >= pw) {
          this.discontinuityDepth = brS16(-2048 + (this.auxParameter >> 2));
          const before = phaseAtReset >>> 18, after = this.discontinuityDepth;
          const discontinuity = after - before;
          thisSample += discontinuity * brThisBlep(resetTime) >> 15;
          next += discontinuity * brNextBlep(resetTime) >> 15;
        }
      }
      this.phase = (this.phase + inc) >>> 0;
      if (this.phase < inc) selfReset = true;
      this.writeSyncOut(syncOut, k, inc);
      while (transitionDuringReset || !syncReset) {
        if (!this.high) {
          if (this.phase < pw) break;
          const t = Math.floor(((this.phase - pw) >>> 0) / (inc >>> 16));
          const discontinuity = brS16((this.phase >>> 18) - this.discontinuityDepth);
          thisSample += discontinuity * brThisBlep(t) >> 15;
          next += discontinuity * brNextBlep(t) >> 15;
          this.high = true;
        }
        if (this.high) {
          if (!selfReset) break;
          selfReset = false;
          this.discontinuityDepth = brS16(-2048 + (this.auxParameter >> 2));
          const t = Math.floor(this.phase / (inc >>> 16));
          const discontinuity = brS16(this.discontinuityDepth - 16383);
          thisSample += discontinuity * brThisBlep(t) >> 15;
          next += discontinuity * brNextBlep(t) >> 15;
          this.high = false;
        }
      }
      if (syncReset) { this.phase = Math.imul(resetTime, inc >>> 16) >>> 0; this.high = false; }
      next += this.phase < pw ? this.discontinuityDepth : this.phase >>> 18;
      buffer[k] = brS16((thisSample - 8192) << 1);
    }
    this.nextSample = next;
    this.previousPhaseIncrement = inc;
  }

  renderSquare(sync, buffer, syncOut, size) {
    let inc = this.previousPhaseIncrement;
    const step = this.incrementStep(size);
    if (this.parameter > 32000) this.parameter = 32000;
    let next = this.nextSample;
    for (let k = 0; k < size; k++) {
      let syncReset = false, selfReset = false, transitionDuringReset = false, resetTime = 0;
      inc = (inc + step) >>> 0;
      const pw = ((32768 - this.parameter) * 65536) >>> 0;
      let thisSample = next;
      next = 0;
      if (sync[k]) {
        resetTime = (sync[k] - 1) << 9;
        const phaseAtReset = (this.phase + Math.imul(65535 - resetTime, inc >>> 16)) >>> 0;
        syncReset = true;
        if (phaseAtReset < this.phase || (!this.high && phaseAtReset >= pw)) transitionDuringReset = true;
        if (phaseAtReset >= pw) { thisSample -= brThisBlep(resetTime); next -= brNextBlep(resetTime); }
      }
      this.phase = (this.phase + inc) >>> 0;
      if (this.phase < inc) selfReset = true;
      this.writeSyncOut(syncOut, k, inc);
      while (transitionDuringReset || !syncReset) {
        if (!this.high) {
          if (this.phase < pw) break;
          const t = Math.floor(((this.phase - pw) >>> 0) / (inc >>> 16));
          thisSample += brThisBlep(t);
          next += brNextBlep(t);
          this.high = true;
        }
        if (this.high) {
          if (!selfReset) break;
          selfReset = false;
          const t = Math.floor(this.phase / (inc >>> 16));
          thisSample -= brThisBlep(t);
          next -= brNextBlep(t);
          this.high = false;
        }
      }
      if (syncReset) { this.phase = Math.imul(resetTime, inc >>> 16) >>> 0; this.high = false; }
      next += this.phase < pw ? 0 : 32767;
      buffer[k] = brS16((thisSample - 16384) << 1);
    }
    this.nextSample = next;
    this.previousPhaseIncrement = inc;
  }

  renderSaw(sync, buffer, syncOut, size) {
    let inc = this.previousPhaseIncrement;
    const step = this.incrementStep(size);
    let next = this.nextSample;
    for (let k = 0; k < size; k++) {
      let syncReset = false, selfReset = false, transitionDuringReset = false, resetTime = 0;
      inc = (inc + step) >>> 0;
      let thisSample = next;
      next = 0;
      if (sync[k]) {
        resetTime = (sync[k] - 1) << 9;
        const phaseAtReset = (this.phase + Math.imul(65535 - resetTime, inc >>> 16)) >>> 0;
        syncReset = true;
        if (phaseAtReset < this.phase) transitionDuringReset = true;
        const discontinuity = phaseAtReset >>> 17;
        thisSample -= discontinuity * brThisBlep(resetTime) >> 15;
        next -= discontinuity * brNextBlep(resetTime) >> 15;
      }
      this.phase = (this.phase + inc) >>> 0;
      if (this.phase < inc) selfReset = true;
      this.writeSyncOut(syncOut, k, inc);
      if ((transitionDuringReset || !syncReset) && selfReset) {
        const t = Math.floor(this.phase / (inc >>> 16));
        thisSample -= brThisBlep(t);
        next -= brNextBlep(t);
      }
      if (syncReset) { this.phase = Math.imul(resetTime, inc >>> 16) >>> 0; this.high = false; }
      next += this.phase >>> 17;
      buffer[k] = brS16((thisSample - 16384) << 1);
    }
    this.nextSample = next;
    this.previousPhaseIncrement = inc;
  }

  renderVariableSaw(sync, buffer, syncOut, size) {
    let inc = this.previousPhaseIncrement;
    const step = this.incrementStep(size);
    let next = this.nextSample;
    if (this.parameter < 1024) this.parameter = 1024;
    for (let k = 0; k < size; k++) {
      let syncReset = false, selfReset = false, transitionDuringReset = false, resetTime = 0;
      inc = (inc + step) >>> 0;
      const pw = (this.parameter * 65536) >>> 0;
      let thisSample = next;
      next = 0;
      if (sync[k]) {
        resetTime = (sync[k] - 1) << 9;
        const phaseAtReset = (this.phase + Math.imul(65535 - resetTime, inc >>> 16)) >>> 0;
        syncReset = true;
        if (phaseAtReset < this.phase || (!this.high && phaseAtReset >= pw)) transitionDuringReset = true;
        const before = (phaseAtReset >>> 18) + (((phaseAtReset - pw) >>> 0) >>> 18);
        const after = (((0 - pw) >>> 0) >>> 18);
        const discontinuity = after - before;
        thisSample += discontinuity * brThisBlep(resetTime) >> 15;
        next += discontinuity * brNextBlep(resetTime) >> 15;
      }
      this.phase = (this.phase + inc) >>> 0;
      if (this.phase < inc) selfReset = true;
      this.writeSyncOut(syncOut, k, inc);
      while (transitionDuringReset || !syncReset) {
        if (!this.high) {
          if (this.phase < pw) break;
          const t = Math.floor(((this.phase - pw) >>> 0) / (inc >>> 16));
          thisSample -= brThisBlep(t) >> 1;
          next -= brNextBlep(t) >> 1;
          this.high = true;
        }
        if (this.high) {
          if (!selfReset) break;
          selfReset = false;
          const t = Math.floor(this.phase / (inc >>> 16));
          thisSample -= brThisBlep(t) >> 1;
          next -= brNextBlep(t) >> 1;
          this.high = false;
        }
      }
      if (syncReset) { this.phase = Math.imul(resetTime, inc >>> 16) >>> 0; this.high = false; }
      next += this.phase >>> 18;
      next += ((this.phase - pw) >>> 0) >>> 18;
      buffer[k] = brS16((thisSample - 16384) << 1);
    }
    this.nextSample = next;
    this.previousPhaseIncrement = inc;
  }

  renderTriangle(sync, buffer, size) {
    let inc = this.previousPhaseIncrement;
    const step = this.incrementStep(size);
    let phase = this.phase;
    for (let k = 0; k < size; k++) {
      inc = (inc + step) >>> 0;
      if (sync[k]) phase = 0;
      phase = (phase + (inc >>> 1)) >>> 0;
      let p16 = phase >>> 16;
      let triangle = brS16((p16 << 1) ^ (p16 & 0x8000 ? 0xffff : 0));
      triangle = brS16(triangle + 32768);
      buffer[k] = triangle >> 1;
      phase = (phase + (inc >>> 1)) >>> 0;
      p16 = phase >>> 16;
      triangle = brS16((p16 << 1) ^ (p16 & 0x8000 ? 0xffff : 0));
      triangle = brS16(triangle + 32768);
      buffer[k] = brS16(buffer[k] + (triangle >> 1));
    }
    this.phase = phase;
    this.previousPhaseIncrement = inc;
  }

  renderSine(sync, buffer, size) {
    let phase = this.phase;
    let inc = this.previousPhaseIncrement;
    const step = this.incrementStep(size);
    for (let k = 0; k < size; k++) {
      inc = (inc + step) >>> 0;
      phase = (phase + inc) >>> 0;
      if (sync[k]) phase = 0;
      buffer[k] = brInterpolate824(BR_WAV_SINE, phase);
    }
    this.previousPhaseIncrement = inc;
    this.phase = phase;
  }

  renderTriangleFold(sync, buffer, size) {
    let phase = this.phase;
    let inc = this.previousPhaseIncrement;
    const step = this.incrementStep(size);
    const pStart = this.previousParameter, pDelta = this.parameter - this.previousParameter, pInc = (32767 / size) | 0;
    let pX = 0;
    for (let k = 0; k < size; k++) {
      pX += pInc;
      const parameter = pStart + (pDelta * pX >> 15);
      inc = (inc + step) >>> 0;
      const gain = brS16(2048 + (parameter * 30720 >> 15));
      if (sync[k]) phase = 0;
      // 2x oversampled wavefolder
      phase = (phase + (inc >>> 1)) >>> 0;
      let p16 = phase >>> 16;
      let triangle = brS16((p16 << 1) ^ (p16 & 0x8000 ? 0xffff : 0));
      triangle = brS16(triangle + 32768);
      triangle = brS16(triangle * gain >> 15);
      triangle = brS16(brInterpolate88(BR_WS_TRI_FOLD, triangle + 32768));
      buffer[k] = triangle >> 1;
      phase = (phase + (inc >>> 1)) >>> 0;
      p16 = phase >>> 16;
      triangle = brS16((p16 << 1) ^ (p16 & 0x8000 ? 0xffff : 0));
      triangle = brS16(triangle + 32768);
      triangle = brS16(triangle * gain >> 15);
      triangle = brS16(brInterpolate88(BR_WS_TRI_FOLD, triangle + 32768));
      buffer[k] = brS16(buffer[k] + (triangle >> 1));
    }
    this.previousParameter = this.parameter;
    this.previousPhaseIncrement = inc;
    this.phase = phase;
  }

  renderSineFold(sync, buffer, size) {
    let phase = this.phase;
    let inc = this.previousPhaseIncrement;
    const step = this.incrementStep(size);
    const pStart = this.previousParameter, pDelta = this.parameter - this.previousParameter, pInc = (32767 / size) | 0;
    let pX = 0;
    for (let k = 0; k < size; k++) {
      pX += pInc;
      const parameter = pStart + (pDelta * pX >> 15);
      inc = (inc + step) >>> 0;
      const gain = brS16(2048 + (parameter * 30720 >> 15));
      if (sync[k]) phase = 0;
      phase = (phase + (inc >>> 1)) >>> 0;
      let sine = brS16(brInterpolate824(BR_WAV_SINE, phase));
      sine = brS16(sine * gain >> 15);
      sine = brS16(brInterpolate88(BR_WS_SINE_FOLD, sine + 32768));
      buffer[k] = sine >> 1;
      phase = (phase + (inc >>> 1)) >>> 0;
      sine = brS16(brInterpolate824(BR_WAV_SINE, phase));
      sine = brS16(sine * gain >> 15);
      sine = brS16(brInterpolate88(BR_WS_SINE_FOLD, sine + 32768));
      buffer[k] = brS16(buffer[k] + (sine >> 1));
    }
    this.previousParameter = this.parameter;
    this.previousPhaseIncrement = inc;
    this.phase = phase;
  }

  renderBuzz(sync, buffer, size) {
    const shiftedPitch = this.pitch + ((32767 - this.parameter) >> 1);
    const crossfade = (shiftedPitch << 6) & 0xffff;
    let index = shiftedPitch >> 10;
    if (index >= BR_NUM_ZONES) index = BR_NUM_ZONES - 1;
    const wave1 = BR_COMBS[index];
    index += 1;
    if (index >= BR_NUM_ZONES) index = BR_NUM_ZONES - 1;
    const wave2 = BR_COMBS[index];
    for (let k = 0; k < size; k++) {
      this.phase = (this.phase + this.phaseIncrement) >>> 0;
      if (sync[k]) this.phase = 0;
      buffer[k] = brCrossfade(wave1, wave2, this.phase, crossfade);
    }
  }
}

// ---- Braids' excitation (a delayed, decaying pulse) and state-variable filter, for the drums
class BrExcitation {
  constructor() { this.delay = 0; this.decay = 0; this.counter = 0; this.state = 0; this.level = 0; }
  init() { this.delay = 0; this.decay = 4093; this.counter = 0; this.state = 0; }
  setDelay(delay) { this.delay = delay & 0xffff; }
  setDecay(decay) { this.decay = decay & 0xffff; }
  trigger(level) { this.level = level | 0; this.counter = this.delay + 1; }
  done() { return this.counter === 0; }
  process() {
    this.state = (Math.imul(this.state, this.decay) >>> 0) >>> 12; // int32 times uint32: an unsigned product
    if (this.counter > 0) {
      this.counter--;
      if (this.counter === 0) this.state += this.level < 0 ? -this.level : this.level;
    }
    return this.level < 0 ? -this.state : this.state;
  }
}
const BR_SVF_LP = 0, BR_SVF_BP = 1, BR_SVF_HP = 2;
class BrSvf {
  constructor() { this.dirty = false; this.frequency = 0; this.resonance = 0; this.punch = 0; this.f = 0; this.damp = 0; this.lp = 0; this.bp = 0; this.mode = 0; }
  init() { this.lp = 0; this.bp = 0; this.frequency = 33 << 7; this.resonance = 16384; this.dirty = true; this.punch = 0; this.mode = BR_SVF_BP; }
  setFrequency(frequency) { frequency = brS16(frequency); this.dirty = this.dirty || this.frequency !== frequency; this.frequency = frequency; }
  setResonance(resonance) { this.resonance = brS16(resonance); this.dirty = true; }
  setPunch(punch) { punch &= 0xffff; this.punch = (punch * punch) >>> 24; }
  process(input) {
    if (this.dirty) {
      this.f = brInterpolate824U(BR_LUT_SVF_CUTOFF, (this.frequency * 131072) >>> 0);
      this.damp = brInterpolate824U(BR_LUT_SVF_DAMP, (this.resonance * 131072) >>> 0);
      this.dirty = false;
    }
    let f = this.f, damp = this.damp;
    if (this.punch) {
      const punchSignal = this.lp > 4096 ? this.lp : 2048;
      f += ((punchSignal >> 4) * this.punch) >> 9;
      damp += (punchSignal - 2048) >> 3;
    }
    const notch = input - (this.bp * damp >> 15);
    this.lp = brClip(this.lp + (f * this.bp >> 15));
    const hp = notch - this.lp;
    this.bp = brClip(this.bp + (f * hp >> 15));
    return this.mode === BR_SVF_BP ? this.bp : this.mode === BR_SVF_HP ? hp : this.lp;
  }
}
function brInterpolate1022(table, phase) {
  const i = phase >>> 22, a = table[i], b = table[i + 1];
  return a + Math.floor((b - a) * ((phase >>> 6) & 0xffff) / 65536);
}

// stmlib's interpolation of an 8-bit table (the wavetables), from an offset into it: a wave is 129 bytes of BR_WT_WAVES
function brInterpolate824U8(table, offset, phase) {
  const i = offset + (phase >>> 24), a = table[i], b = table[i + 1];
  return (a << 8) + Math.floor((b - a) * (phase & 0xffffff) / 65536) - 32768;
}
function brCrossfadeU8(table, offsetA, offsetB, phase, balance) {
  const a = brInterpolate824U8(table, offsetA, phase), b = brInterpolate824U8(table, offsetB, phase);
  return a + Math.floor((b - a) * (balance & 0xffff) / 65536);
}

// ---- the digital oscillator: the models past the analogue ones (DigitalOscillatorShape; the macro's index - 13)
const BR_D_TRIPLE_RING_MOD = 0, BR_D_SAW_SWARM = 1, BR_D_COMB_FILTER = 2, BR_D_TOY = 3, BR_D_DIGITAL_FILTER_LP = 4,
  BR_D_VOSIM = 8, BR_D_VOWEL = 9, BR_D_VOWEL_FOF = 10, BR_D_HARMONICS = 11, BR_D_FM = 12, BR_D_FEEDBACK_FM = 13,
  BR_D_CHAOTIC_FEEDBACK_FM = 14, BR_D_PLUCKED = 15, BR_D_BOWED = 16, BR_D_BLOWN = 17, BR_D_FLUTED = 18, BR_D_STRUCK_BELL = 19,
  BR_D_STRUCK_DRUM = 20, BR_D_KICK = 21, BR_D_CYMBAL = 22, BR_D_SNARE = 23;
// the physical models' delay lengths, and the bell's and the drum's partials (pitch, amplitude, decays long and short)
const BR_WG_BRIDGE = 1024, BR_WG_NECK = 4096, BR_WG_BORE = 2048, BR_WG_JET = 1024, BR_WG_FBORE = 4096, BR_NUM_PLUCK_VOICES = 3;
const BR_BELL_PARTIALS = [-1284, -1283, -184, -183, 385, 1175, 1536, 2233, 2434, 2934, 3110];
const BR_BELL_AMPLITUDES = [8192, 5488, 8192, 14745, 21872, 13680, 11960, 10895, 10895, 6144, 10895];
const BR_BELL_DECAY_LONG = [65533, 65533, 65533, 65532, 65531, 65531, 65530, 65529, 65527, 65523, 65519];
const BR_BELL_DECAY_SHORT = [65308, 65283, 65186, 65123, 64839, 64889, 64632, 64409, 64038, 63302, 62575];
const BR_DRUM_PARTIALS = [0, 0, 1041, 1747, 1846, 3072];
const BR_DRUM_AMPLITUDES = [16986, 2654, 3981, 5308, 3981, 2985];
const BR_DRUM_DECAY_LONG = [65533, 65531, 65531, 65531, 65531, 65516];
const BR_DRUM_DECAY_SHORT = [65083, 64715, 64715, 64715, 64715, 62312];
const BR_NUM_BELL_PARTIALS = 11, BR_NUM_DRUM_PARTIALS = 6;
const BR_D_WAVETABLES = 24, BR_D_WAVE_MAP = 25, BR_D_WAVE_LINE = 26, BR_D_WAVE_PARAPHONIC = 27, BR_D_FILTERED_NOISE = 28,
  BR_D_TWIN_PEAKS_NOISE = 29, BR_D_CLOCKED_NOISE = 30, BR_D_GRANULAR_CLOUD = 31, BR_D_PARTICLE_NOISE = 32,
  BR_D_DIGITAL_MODULATION = 33, BR_D_QUESTION_MARK = 34;
// the wavetables: how many steps, and the waves (of BR_WT_WAVES) at each, for the twenty of WTBL
const BR_WAVETABLES = [
  [16, [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 15]],
  [16, [16, 17, 18, 19, 20, 21, 22, 23, 24, 25, 26, 27, 28, 29, 30, 31, 31]],
  [16, [32, 33, 34, 35, 36, 37, 38, 39, 40, 41, 42, 43, 44, 45, 46, 47, 47]],
  [16, [48, 49, 50, 51, 52, 53, 54, 55, 56, 57, 58, 59, 60, 61, 62, 63, 63]],
  [16, [64, 65, 66, 67, 68, 68, 69, 70, 71, 72, 73, 73, 74, 75, 75, 76, 76]],
  [16, [77, 78, 79, 80, 81, 82, 83, 84, 85, 86, 87, 88, 89, 90, 91, 92, 92]],
  [16, [93, 94, 95, 96, 97, 98, 99, 100, 101, 102, 103, 104, 105, 106, 107, 108, 108]],
  [16, [109, 110, 111, 112, 113, 114, 115, 116, 117, 118, 119, 120, 121, 122, 123, 124, 124]],
  [16, [125, 126, 127, 128, 129, 130, 131, 132, 132, 132, 132, 132, 132, 132, 132, 132, 132]],
  [16, [133, 134, 135, 136, 137, 138, 139, 140, 141, 142, 143, 144, 144, 144, 145, 145, 145]],
  [16, [146, 147, 148, 149, 150, 151, 151, 151, 152, 152, 152, 152, 153, 153, 153, 153, 153]],
  [8, [154, 154, 154, 154, 154, 154, 155, 156, 156]],
  [16, [176, 157, 158, 159, 160, 161, 162, 163, 164, 165, 166, 167, 168, 169, 170, 171, 171]],
  [16, [172, 173, 174, 175, 176, 177, 178, 179, 180, 181, 182, 183, 184, 185, 186, 187, 187]],
  [16, [176, 188, 189, 190, 191, 192, 193, 194, 195, 196, 197, 198, 199, 200, 201, 202, 202]],
  [16, [203, 205, 204, 205, 212, 206, 207, 208, 208, 209, 210, 210, 211, 211, 212, 212, 212]],
  [8, [213, 213, 213, 214, 215, 216, 217, 218, 219]],
  [16, [220, 221, 222, 223, 224, 225, 226, 227, 228, 229, 230, 231, 232, 233, 234, 235, 235]],
  [16, [236, 237, 238, 239, 240, 241, 242, 243, 244, 245, 246, 247, 248, 249, 250, 251, 251]],
  [4, [252, 253, 254, 255, 254]],
];
const BR_WAVE_LINE = [
  187, 179, 154, 155, 135, 134, 137, 19, 24, 3, 8, 66, 79, 25, 180, 174, 64,
  127, 198, 15, 10, 7, 11, 0, 191, 192, 115, 238, 237, 236, 241, 47, 70, 76,
  235, 26, 133, 208, 34, 175, 183, 146, 147, 148, 150, 151, 152, 153, 117,
  138, 32, 33, 35, 125, 199, 201, 30, 31, 193, 27, 29, 21, 18, 182,
];
const BR_MINI_WAVE_LINE = [
  157, 161, 171, 188, 189, 191, 192, 193, 196, 198, 201, 234, 232,
  229, 226, 224, 1, 2, 3, 4, 5, 8, 12, 32, 36, 42, 47, 252, 254, 141, 139,
  135, 174,
];
// WAVE PARAPHONIC's chords: three detunings each (128ths of a semitone)
const BR_CHORDS = [
  [2, 4, 6], [16, 32, 48], [2 * 128, 7 * 128, 12 * 128], [3 * 128, 7 * 128, 10 * 128], [3 * 128, 7 * 128, 12 * 128],
  [3 * 128, 7 * 128, 14 * 128], [3 * 128, 7 * 128, 17 * 128], [7 * 128, 12 * 128, 19 * 128], [7 * 128, 3 + 12 * 128, 5 + 19 * 128],
  [4 * 128, 7 * 128, 17 * 128], [4 * 128, 7 * 128, 14 * 128], [4 * 128, 7 * 128, 12 * 128], [4 * 128, 7 * 128, 11 * 128],
  [5 * 128, 7 * 128, 12 * 128], [4, 7 * 128, 12 * 128], [4, 4 + 12 * 128, 12 * 128], [4, 4 + 12 * 128, 12 * 128],
];
const BR_CONSTELLATION_Q = [23100, -23100, -23100, 23100], BR_CONSTELLATION_I = [23100, 23100, -23100, -23100];
const BR_PARTICLE_DECAY = 64763, BR_RESONANCE_SQUARED = 32506, BR_RESONANCE_FACTOR = 32636; // 32768 x 0.996 squared, and x 0.996
const BR_D_HIGHEST_NOTE = 140 * 128;
const BR_FIR4 = [10530, 14751, 16384, 14751], BR_FIR4_DC = 28208;
const BR_COMB_LENGTH = 8192;
const BR_PHASE_RESET = [0, 0x80000000, 0x40000000, 0x80000000];
const BR_NUM_FORMANTS = 5, BR_NUM_HARMONICS = 12;
// vowels and consonants: three formants' frequency, then their amplitude
const BR_VOWELS = [
  [27, 40, 89, 15, 13, 1], [18, 51, 62, 13, 12, 6], [15, 69, 93, 14, 12, 7], [10, 84, 110, 13, 10, 8], [23, 44, 87, 15, 12, 1],
  [13, 29, 80, 13, 8, 0], [6, 46, 81, 12, 3, 0], [9, 51, 95, 15, 3, 0], [6, 73, 99, 7, 3, 14],
];
const BR_CONSONANTS = [
  [6, 54, 121, 9, 9, 0], [18, 50, 51, 12, 10, 5], [11, 24, 70, 13, 8, 0], [15, 69, 74, 14, 12, 7], [16, 37, 111, 14, 8, 1],
  [18, 51, 62, 14, 12, 6], [6, 26, 81, 5, 5, 5], [6, 73, 99, 7, 10, 14],
];
// the formants of five voices (bass to soprano) singing a, e, i, o, u: frequency (pitch) and amplitude, [voice][vowel][formant]
const BR_FORMANT_F = [
  [[9519, 10738, 12448, 12636, 12892], [8620, 11720, 12591, 12932, 13158], [7579, 11891, 12768, 13122, 13323], [8620, 10013, 12591, 12768, 13010], [8324, 9519, 12591, 12831, 13048]],
  [[9696, 10821, 12810, 13010, 13263], [8620, 11827, 12768, 13228, 13477], [7908, 12038, 12932, 13263, 13452], [8620, 10156, 12768, 12932, 13085], [8324, 9519, 12852, 13010, 13296]],
  [[9730, 10902, 12892, 13085, 13330], [8832, 11953, 12852, 13085, 13296], [7749, 12014, 13010, 13330, 13483], [8781, 10211, 12852, 13085, 13296], [8448, 9627, 12892, 13085, 13363]],
  [[10156, 10960, 12932, 13427, 14195], [8620, 11692, 12852, 13296, 14195], [8324, 11827, 12852, 13550, 14195], [8881, 10156, 12956, 13427, 14195], [8160, 9860, 12708, 13427, 14195]],
  [[10156, 10960, 13010, 13667, 14195], [8324, 12187, 12932, 13489, 14195], [7749, 12337, 13048, 13667, 14195], [8881, 10156, 12956, 13609, 14195], [8160, 9860, 12852, 13609, 14195]],
];
const BR_FORMANT_A = [
  [[16384, 7318, 5813, 5813, 1638], [16384, 4115, 5813, 4115, 2062], [16384, 518, 2596, 1301, 652], [16384, 4617, 1460, 1638, 163], [16384, 1638, 411, 652, 259]],
  [[16384, 8211, 7318, 6522, 1301], [16384, 3269, 4115, 3269, 1638], [16384, 2913, 2062, 1638, 518], [16384, 5181, 4115, 4115, 821], [16384, 1638, 2314, 3269, 821]],
  [[16384, 8211, 1159, 1033, 206], [16384, 3269, 2062, 1638, 1638], [16384, 1033, 1033, 259, 259], [16384, 5181, 821, 1301, 326], [16384, 1638, 1159, 518, 326]],
  [[16384, 10337, 1638, 259, 16], [16384, 1033, 518, 291, 16], [16384, 1638, 518, 259, 16], [16384, 5813, 2596, 652, 29], [16384, 4115, 518, 163, 10]],
  [[16384, 8211, 411, 1638, 51], [16384, 1638, 2913, 163, 25], [16384, 4115, 821, 821, 103], [16384, 4617, 1301, 1301, 51], [16384, 2596, 291, 163, 16]],
];
function brFormantParameter(table, x, y, formant) {
  const xi = (x >> 13) & 0xffff, xm = (x << 3) & 0xffff, yi = (y >> 13) & 0xffff, ym = (y << 3) & 0xffff;
  let a = table[xi][yi][formant], c = table[xi][yi + 1][formant];
  const b = table[xi + 1][yi][formant], d = table[xi + 1][yi + 1][formant];
  a = brS16(a + ((b - a) * xm >> 16));
  c = brS16(c + ((d - c) * xm >> 16));
  return brS16(a + ((c - a) * ym >> 16));
}
// the module's union of every model's state, as one record per model; Init zeroes it all
function brDigitalState() {
  return {
    modulatorPhase: 0,
    res: { modulatorPhaseIncrement: 0, modulatorPhase: 0, squareModulatorPhase: 0, integrator: 0, polarity: false },
    vow: { formantIncrement: [0, 0, 0], formantPhase: [0, 0, 0], formantAmplitude: [0, 0, 0], consonantFrames: 0, noise: 0 },
    saw: { phase: [0, 0, 0, 0, 0, 0], lp: 0, bp: 0 },
    ffm: { modulatorPhase: 0, previousSample: 0 },
    fof: { nextSawSample: 0, previousSample: 0, svfLp: [0, 0, 0, 0, 0], svfBp: [0, 0, 0, 0, 0] },
    toy: { heldSample: 0, decimationCounter: 0 },
    add: {
      partialPhase: new Array(11).fill(0), partialPhaseIncrement: new Array(11).fill(0), partialAmplitude: new Array(11).fill(0),
      targetPartialAmplitude: new Array(11).fill(0), previousSample: 0, currentPartial: 0, lpNoise: [0, 0, 0],
    },
    hrm: { amplitude: new Array(BR_NUM_HARMONICS).fill(0) },
    plk: [0, 1, 2, 3].map(() => ({ size: 0, writePtr: 0, shift: 0, mask: 0, initializationPtr: 0, phase: 0, phaseIncrement: 0, maxPhaseIncrement: 0, previousSample: 0 })),
    phy: { delayPtr: 0, excitationPtr: 0, lpState: 0, filterState: [0, 0], previousSample: 0 },
    svf: { lp: 0, bp: 0 },
    hat: { phase: [0, 0, 0, 0, 0, 0], rngState: 0 },
    pno: { amplitude: 0, filterState: [[0, 0], [0, 0], [0, 0]], filterScale: [0, 0, 0], filterCoefficient: [0, 0, 0] },
    clk: { cyclePhase: 0, cyclePhaseIncrement: 0, rngState: 0, seed: 0, sample: 0 },
    grain: [0, 1, 2, 3].map(() => ({ phase: 0, phaseIncrement: 0, envelopePhase: 0, envelopePhaseIncrement: 0 })),
    dmd: { symbolPhase: 0, symbolCount: 0, filterState: 0, dataByte: 0 },
  };
}

class BrDigitalOscillator {
  constructor() {
    // zeroed as the module's global is, before Init
    this.phase = 0; this.phaseIncrement = 0; this.delay = 0;
    this.parameter = [0, 0]; this.previousParameter = [0, 0]; this.smoothedParameter = 0; this.pitch = 0;
    this.activeVoice = 0; this.initFlag = false; this.strikeFlag = false; this.shape = 0; this.previousShape = 0;
    this.state = brDigitalState();
    this.pulse = [new BrExcitation(), new BrExcitation(), new BrExcitation(), new BrExcitation()];
    this.svf = [new BrSvf(), new BrSvf(), new BrSvf()];
    // the delay lines: one piece of memory that the models see in their own ways (a union), not cleared by Init
    const dl = new ArrayBuffer(BR_COMB_LENGTH * 2);
    this.comb = new Int16Array(dl, 0, BR_COMB_LENGTH);
    this.ks = new Int16Array(dl, 0, 1025 * 4);
    this.bore = new Int16Array(dl, 0, BR_WG_BORE);
    this.bowedBridge = new Int8Array(dl, 0, BR_WG_BRIDGE);
    this.bowedNeck = new Int8Array(dl, BR_WG_BRIDGE, BR_WG_NECK);
    this.flutedJet = new Int8Array(dl, 0, BR_WG_JET);
    this.flutedBore = new Int8Array(dl, BR_WG_JET, BR_WG_FBORE);
  }
  init() {
    this.state = brDigitalState();
    for (const p of this.pulse) p.init();
    for (const f of this.svf) f.init();
    this.phase = 0; this.strikeFlag = true; this.initFlag = true;
  }
  setPitch(pitch) {
    pitch = brS16(pitch);
    this.pitch = this.pitch > (90 << 7) && pitch > (90 << 7) ? brS16((this.pitch + pitch) >> 1) : pitch;
  }
  setParameters(p0, p1) { this.parameter[0] = brS16(p0); this.parameter[1] = brS16(p1); }
  strike() { this.strikeFlag = true; }
  computePhaseIncrement(midiPitch) {
    midiPitch = brS16(midiPitch);
    if (midiPitch >= BR_PITCH_TABLE_START) midiPitch = BR_PITCH_TABLE_START - 1;
    let ref = midiPitch - BR_PITCH_TABLE_START, shifts = 0;
    while (ref < 0) { ref += BR_OCTAVE; shifts++; }
    const a = BR_LUT_OSCILLATOR_INCREMENTS[ref >> 4], b = BR_LUT_OSCILLATOR_INCREMENTS[(ref >> 4) + 1];
    const inc = (a + (((b - a) | 0) * (ref & 0xf) >> 4)) >>> 0;
    return shifts >= 32 ? 0 : inc >>> shifts;
  }
  computeDelay(midiPitch) {
    midiPitch = brS16(midiPitch);
    if (midiPitch >= BR_D_HIGHEST_NOTE - BR_OCTAVE) midiPitch = BR_D_HIGHEST_NOTE - BR_OCTAVE;
    let ref = midiPitch - BR_PITCH_TABLE_START, shifts = 0;
    while (ref < 0) { ref += BR_OCTAVE; shifts++; }
    const a = BR_LUT_OSCILLATOR_DELAYS[ref >> 4], b = BR_LUT_OSCILLATOR_DELAYS[(ref >> 4) + 1];
    const delay = (a + (((b - a) | 0) * (ref & 0xf) >> 4)) >>> 0;
    return delay >>> (12 - shifts);
  }
  render(sync, buffer, size) {
    // FM's COLOR is quantised to musical ratios
    if (this.shape >= BR_D_FM && this.shape <= BR_D_CHAOTIC_FEEDBACK_FM) {
      const integral = (this.parameter[1] >> 8) & 0xffff, fractional = this.parameter[1] & 255;
      const a = brS16(BR_LUT_FM_FREQUENCY_QUANTIZER[integral]), b = brS16(BR_LUT_FM_FREQUENCY_QUANTIZER[integral + 1]);
      this.parameter[1] = brS16(a + ((b - a) * fractional >> 8));
    }
    if (this.shape !== this.previousShape) { this.init(); this.previousShape = this.shape; this.initFlag = true; }
    this.phaseIncrement = this.computePhaseIncrement(this.pitch);
    this.delay = this.computeDelay(this.pitch);
    if (this.pitch > BR_D_HIGHEST_NOTE) this.pitch = BR_D_HIGHEST_NOTE; else if (this.pitch < 0) this.pitch = 0;
    switch (this.shape) {
      case BR_D_TRIPLE_RING_MOD: this.renderTripleRingMod(sync, buffer, size); break;
      case BR_D_SAW_SWARM: this.renderSawSwarm(sync, buffer, size); break;
      case BR_D_COMB_FILTER: this.renderComb(sync, buffer, size); break;
      case BR_D_TOY: this.renderToy(sync, buffer, size); break;
      case 4: case 5: case 6: case 7: this.renderDigitalFilter(sync, buffer, size); break;
      case BR_D_VOSIM: this.renderVosim(sync, buffer, size); break;
      case BR_D_VOWEL: this.renderVowel(sync, buffer, size); break;
      case BR_D_VOWEL_FOF: this.renderVowelFof(sync, buffer, size); break;
      case BR_D_HARMONICS: this.renderHarmonics(sync, buffer, size); break;
      case BR_D_FM: this.renderFm(sync, buffer, size); break;
      case BR_D_FEEDBACK_FM: this.renderFeedbackFm(sync, buffer, size); break;
      case BR_D_CHAOTIC_FEEDBACK_FM: this.renderChaoticFeedbackFm(sync, buffer, size); break;
      case BR_D_PLUCKED: this.renderPlucked(sync, buffer, size); break;
      case BR_D_BOWED: this.renderBowed(sync, buffer, size); break;
      case BR_D_BLOWN: this.renderBlown(sync, buffer, size); break;
      case BR_D_FLUTED: this.renderFluted(sync, buffer, size); break;
      case BR_D_STRUCK_BELL: this.renderStruckBell(sync, buffer, size); break;
      case BR_D_STRUCK_DRUM: this.renderStruckDrum(sync, buffer, size); break;
      case BR_D_KICK: this.renderKick(sync, buffer, size); break;
      case BR_D_CYMBAL: this.renderCymbal(sync, buffer, size); break;
      case BR_D_SNARE: this.renderSnare(sync, buffer, size); break;
      case BR_D_WAVETABLES: this.renderWavetables(sync, buffer, size); break;
      case BR_D_WAVE_MAP: this.renderWaveMap(sync, buffer, size); break;
      case BR_D_WAVE_LINE: this.renderWaveLine(sync, buffer, size); break;
      case BR_D_WAVE_PARAPHONIC: this.renderWaveParaphonic(sync, buffer, size); break;
      case BR_D_FILTERED_NOISE: this.renderFilteredNoise(sync, buffer, size); break;
      case BR_D_TWIN_PEAKS_NOISE: this.renderTwinPeaksNoise(sync, buffer, size); break;
      case BR_D_CLOCKED_NOISE: this.renderClockedNoise(sync, buffer, size); break;
      case BR_D_GRANULAR_CLOUD: this.renderGranularCloud(sync, buffer, size); break;
      case BR_D_PARTICLE_NOISE: this.renderParticleNoise(sync, buffer, size); break;
      case BR_D_DIGITAL_MODULATION: this.renderDigitalModulation(sync, buffer, size); break;
      case BR_D_QUESTION_MARK: this.renderQuestionMark(sync, buffer, size); break;
      default: buffer.fill(0, 0, size);
    }
  }

  renderTripleRingMod(sync, buffer, size) {
    const st = this.state.vow;
    let phase = (this.phase + (1 << 30)) >>> 0;
    const increment = this.phaseIncrement;
    let m1 = st.formantPhase[0], m2 = st.formantPhase[1];
    const i1 = this.computePhaseIncrement(this.pitch + ((this.parameter[0] - 16384) >> 2));
    const i2 = this.computePhaseIncrement(this.pitch + ((this.parameter[1] - 16384) >> 2));
    for (let k = 0; k < size; k++) {
      phase = (phase + increment) >>> 0;
      if (sync[k]) { phase = 0; m1 = 0; m2 = 0; }
      m1 = (m1 + i1) >>> 0;
      m2 = (m2 + i2) >>> 0;
      let result = brInterpolate824(BR_WAV_SINE, phase);
      result = brS16(result * brInterpolate824(BR_WAV_SINE, m1) >> 16);
      result = brS16(result * brInterpolate824(BR_WAV_SINE, m2) >> 16);
      buffer[k] = brInterpolate88(BR_WS_MODERATE_OVERDRIVE, result + 32768);
    }
    this.phase = (phase - (1 << 30)) >>> 0;
    st.formantPhase[0] = m1; st.formantPhase[1] = m2;
  }

  renderSawSwarm(sync, buffer, size) {
    const st = this.state.saw;
    let detune = this.parameter[0] + 1024;
    detune = (detune * detune) >> 9;
    const increments = [0, 0, 0, 0, 0, 0, 0];
    for (let i = 0; i < 7; i++) {
      const sawDetune = detune * (i - 3), integral = sawDetune >> 16, fractional = sawDetune & 0xffff;
      const a = this.computePhaseIncrement(this.pitch + integral) | 0, b = this.computePhaseIncrement(this.pitch + integral + 1) | 0;
      increments[i] = (a + (((b - a) * fractional) >> 16)) >>> 0;
    }
    if (this.strikeFlag) {
      for (let i = 0; i < 6; i++) st.phase[i] = brRandomWord();
      this.strikeFlag = false;
    }
    let hpCutoff = this.pitch;
    if (this.parameter[1] < 10922) hpCutoff += ((this.parameter[1] - 10922) * 24) >> 5;
    else hpCutoff += ((this.parameter[1] - 10922) * 12) >> 5;
    if (hpCutoff < 0) hpCutoff = 0; else if (hpCutoff > 32767) hpCutoff = 32767;
    const f = brInterpolate824U(BR_LUT_SVF_CUTOFF, (hpCutoff * 131072) >>> 0);
    const damp = BR_LUT_SVF_DAMP[0];
    let bp = st.bp, lp = st.lp;
    const ph = st.phase;
    for (let k = 0; k < size; k++) {
      if (sync[k]) for (let i = 0; i < 6; i++) ph[i] = 0;
      this.phase = (this.phase + increments[0]) >>> 0;
      for (let i = 0; i < 6; i++) ph[i] = (ph[i] + increments[i + 1]) >>> 0;
      let sample = -28672 + (this.phase >>> 19);
      for (let i = 0; i < 6; i++) sample += ph[i] >>> 19;
      sample = brInterpolate88(BR_WS_MODERATE_OVERDRIVE, sample + 32768);
      const notch = sample - (bp * damp >> 15);
      lp += f * bp >> 15;
      lp = brClip(lp);
      const hp = notch - lp;
      bp += f * hp >> 15;
      buffer[k] = brClip(hp);
    }
    st.lp = lp; st.bp = bp;
  }

  renderComb(sync, buffer, size) {
    const st = this.state.ffm;
    // the delay time filtered, against clicks
    const pitch = this.pitch + ((this.parameter[0] - 16384) >> 1);
    const filteredPitch = brS16((15 * st.previousSample + pitch) >> 4);
    st.previousSample = filteredPitch;
    const dl = this.comb;
    let delay = this.computeDelay(filteredPitch);
    if (delay > BR_COMB_LENGTH * 65536) delay = BR_COMB_LENGTH * 65536;
    const delayIntegral = delay >>> 16, delayFractional = delay & 0xffff;
    // the resonance warped, for a finer adjustment at the extremes
    let resonance = brS16((this.parameter[1] << 1) - 32768);
    resonance = brInterpolate88(BR_WS_MODERATE_OVERDRIVE, resonance + 32768);
    let ptr = this.phase % BR_COMB_LENGTH;
    for (let k = 0; k < size; k++) {
      const input = buffer[k];
      const offset = ptr + 2 * BR_COMB_LENGTH - delayIntegral;
      const a = dl[offset % BR_COMB_LENGTH], b = dl[(offset - 1) % BR_COMB_LENGTH];
      const delayed = a + (((b - a) * (delayFractional >> 1)) >> 15);
      const feedback = brClip((delayed * resonance >> 15) + (input >> 1));
      dl[ptr] = feedback;
      buffer[k] = brClip((input + (delayed << 1)) >> 1);
      ptr = (ptr + 1) % BR_COMB_LENGTH;
    }
    this.phase = ptr;
  }

  renderToy(sync, buffer, size) {
    const st = this.state.toy;
    this.phaseIncrement = this.phaseIncrement >>> 2; // 4 times oversampling
    const inc = this.phaseIncrement;
    let phase = this.phase;
    let counter = st.decimationCounter;
    const count = (512 - (this.parameter[0] >> 6)) & 0xffff;
    let held = st.heldSample;
    for (let k = 0; k < size; k++) {
      let filtered = 0;
      if (sync[k]) phase = 0;
      for (let tap = 0; tap < 4; tap++) {
        phase = (phase + inc) >>> 0;
        if (counter >= count) {
          const x = (this.parameter[1] >> 8) & 0xff;
          held = ((((phase >>> 24) ^ (x << 1)) & ~x) + (x >> 1)) & 0xff;
          counter = 0;
        }
        filtered += BR_FIR4[tap] * held;
        counter = (counter + 1) & 0xffff;
      }
      buffer[k] = brS16((filtered >> 8) - BR_FIR4_DC);
    }
    st.heldSample = held; st.decimationCounter = counter;
    this.phase = phase;
  }

  renderDigitalFilter(sync, buffer, size) {
    const st = this.state.res;
    let shiftedPitch = brS16(this.pitch + ((this.parameter[0] - 2048) >> 1));
    if (shiftedPitch > 16383) shiftedPitch = 16383;
    let mPhase = st.modulatorPhase, sqPhase = st.squareModulatorPhase, integrator = st.integrator;
    const filterType = this.shape - BR_D_DIGITAL_FILTER_LP;
    let mInc = st.modulatorPhaseIncrement;
    const target = this.computePhaseIncrement(shiftedPitch);
    const mIncStep = mInc < target ? Math.floor((target - mInc) / size) >>> 0 : (~Math.floor((mInc - target) / size)) >>> 0;
    const p1 = this.parameter[1];
    const balance = ((p1 < 16384 ? p1 : ~p1) << 2) & 0xffff;
    for (let k = 0; k < size; k++) {
      this.phase = (this.phase + this.phaseIncrement) >>> 0;
      mInc = (mInc + mIncStep) >>> 0;
      mPhase = (mPhase + mInc) >>> 0;
      const integratorGain = (mInc >>> 14) & 0xffff;
      if (sync[k]) { st.polarity = true; this.phase = 0; mPhase = 0; sqPhase = 0; integrator = 0; }
      sqPhase = (sqPhase + mInc) >>> 0;
      if (this.phase < this.phaseIncrement) mPhase = BR_PHASE_RESET[filterType];
      if (((this.phase << 1) >>> 0) < ((this.phaseIncrement << 1) >>> 0)) {
        st.polarity = !st.polarity;
        sqPhase = BR_PHASE_RESET[(filterType & 1) + 2];
      }
      const carrier = brInterpolate824(BR_WAV_SINE, mPhase);
      const squareCarrier = brInterpolate824(BR_WAV_SINE, sqPhase);
      const saw = ~(this.phase >>> 16) & 0xffff;
      const doubleSaw = ~(this.phase >>> 15) & 0xffff;
      const triangle = ((this.phase >>> 15) ^ (this.phase & 0x80000000 ? 0xffff : 0)) & 0xffff;
      const window = p1 < 16384 ? saw : triangle;
      let pulse = (squareCarrier * doubleSaw) >> 16;
      if (st.polarity) pulse = -pulse;
      integrator += (pulse * integratorGain) >> 16;
      integrator = brClip(integrator);
      let sawTri, square;
      if (filterType & 2) {
        sawTri = brS16((carrier * window) >> 16);
        square = brS16(pulse);
      } else {
        sawTri = brS16(((window * (carrier + 32768)) >> 16) - 32768);
        square = brS16(integrator);
        if (filterType === 1) square = brS16((pulse + integrator) >> 1);
      }
      buffer[k] = brMix(sawTri, square, balance);
    }
    st.modulatorPhase = mPhase; st.squareModulatorPhase = sqPhase; st.integrator = integrator; st.modulatorPhaseIncrement = mInc;
  }

  renderVosim(sync, buffer, size) {
    const st = this.state.vow;
    for (let i = 0; i < 2; i++) st.formantIncrement[i] = this.computePhaseIncrement(this.parameter[i] >> 1);
    for (let k = 0; k < size; k++) {
      this.phase = (this.phase + this.phaseIncrement) >>> 0;
      if (sync[k]) this.phase = 0;
      let sample = 16384 + 8192;
      st.formantPhase[0] = (st.formantPhase[0] + st.formantIncrement[0]) >>> 0;
      sample += brInterpolate824(BR_WAV_SINE, st.formantPhase[0]) >> 1;
      st.formantPhase[1] = (st.formantPhase[1] + st.formantIncrement[1]) >>> 0;
      sample += brInterpolate824(BR_WAV_SINE, st.formantPhase[1]) >> 2;
      sample = sample * (brInterpolate824U(BR_LUT_BELL, this.phase) >> 1) >> 15;
      if (this.phase < this.phaseIncrement) { st.formantPhase[0] = 0; st.formantPhase[1] = 0; sample = 0; }
      sample -= 16384 + 8192;
      buffer[k] = brS16(sample);
    }
  }

  renderVowel(sync, buffer, size) {
    const st = this.state.vow;
    const vowelIndex = this.parameter[0] >> 12, balance = this.parameter[0] & 0x0fff;
    const formantShift = (200 + (this.parameter[1] >> 6)) & 0xffff;
    if (this.strikeFlag) {
      this.strikeFlag = false;
      st.consonantFrames = 160;
      const index = (brRandomSample() + 1) & 7;
      const c = BR_CONSONANTS[index];
      for (let i = 0; i < 3; i++) {
        st.formantIncrement[i] = (c[i] * 0x1000 * formantShift) >>> 0;
        st.formantAmplitude[i] = c[3 + i];
      }
      st.noise = index >= 6 ? 4095 : 0;
    }
    if (st.consonantFrames) {
      st.consonantFrames--;
    } else {
      const a = BR_VOWELS[vowelIndex], b = BR_VOWELS[vowelIndex + 1];
      for (let i = 0; i < 3; i++) {
        st.formantIncrement[i] = ((a[i] * (0x1000 - balance) + b[i] * balance) * formantShift) >>> 0;
        st.formantAmplitude[i] = (a[3 + i] * (0x1000 - balance) + b[3 + i] * balance) >> 12;
      }
      st.noise = 0;
    }
    const noise = st.noise;
    for (let k = 0; k < size; k++) {
      this.phase = (this.phase + this.phaseIncrement) >>> 0;
      let sample = 0;
      st.formantPhase[0] = (st.formantPhase[0] + st.formantIncrement[0]) >>> 0;
      sample = brS16(sample + BR_WAV_FORMANT_SINE[((st.formantPhase[0] >>> 24) & 0xf0) | st.formantAmplitude[0]]);
      st.formantPhase[1] = (st.formantPhase[1] + st.formantIncrement[1]) >>> 0;
      sample = brS16(sample + BR_WAV_FORMANT_SINE[((st.formantPhase[1] >>> 24) & 0xf0) | st.formantAmplitude[1]]);
      st.formantPhase[2] = (st.formantPhase[2] + st.formantIncrement[2]) >>> 0;
      sample = brS16(sample + BR_WAV_FORMANT_SQUARE[((st.formantPhase[2] >>> 24) & 0xf0) | st.formantAmplitude[2]]);
      sample = brS16(sample * (255 - (this.phase >>> 24)));
      const phaseNoise = brRandomSample() * noise;
      if (((this.phase + phaseNoise) >>> 0) < this.phaseIncrement) {
        st.formantPhase[0] = 0; st.formantPhase[1] = 0; st.formantPhase[2] = 0;
        sample = 0;
      }
      buffer[k] = brInterpolate88(BR_WS_MODERATE_OVERDRIVE, sample + 32768);
    }
  }

  renderVowelFof(sync, buffer, size) {
    // the original's FOFs, as a bank of five state-variable filters (as on the module, since a later firmware)
    const st = this.state.fof;
    const amplitudes = [0, 0, 0, 0, 0], lp = [0, 0, 0, 0, 0], bp = [0, 0, 0, 0, 0], f = [0, 0, 0, 0, 0];
    for (let i = 0; i < BR_NUM_FORMANTS; i++) {
      const frequency = brFormantParameter(BR_FORMANT_F, this.parameter[1], this.parameter[0], i) + (12 << 7);
      f[i] = brS16(brInterpolate824U(BR_LUT_SVF_CUTOFF, (frequency * 131072) >>> 0));
      amplitudes[i] = brFormantParameter(BR_FORMANT_A, this.parameter[1], this.parameter[0], i);
      lp[i] = this.initFlag ? 0 : st.svfLp[i];
      bp[i] = this.initFlag ? 0 : st.svfBp[i];
    }
    if (this.initFlag) this.initFlag = false;
    let phase = this.phase, previous = st.previousSample, nextSaw = st.nextSawSample;
    const increment = (this.phaseIncrement << 1) >>> 0;
    for (let k = 0; k < size; k += 2) {
      let thisSaw = nextSaw;
      nextSaw = 0;
      phase = (phase + increment) >>> 0;
      if (phase < increment) {
        let t = Math.floor(phase / (increment >>> 16));
        if (t > 65535) t = 65535;
        thisSaw -= (t * t) >>> 18;
        t = 65535 - t;
        nextSaw -= -((t * t) >>> 18);
      }
      nextSaw += phase >>> 17;
      const input = thisSaw;
      let out = 0;
      for (let i = 0; i < 5; i++) {
        const notch = input - (bp[i] >> 6);
        lp[i] = brClip(lp[i] + (f[i] * bp[i] >> 15));
        const hp = notch - lp[i];
        bp[i] = brClip(bp[i] + (f[i] * hp >> 15));
        out += bp[i] * amplitudes[0] >> 17; // amplitudes[0] for every formant, as in the original
      }
      out = brClip(out);
      buffer[k] = (out + previous) >> 1;
      buffer[k + 1] = out;
      previous = out;
    }
    this.phase = phase;
    st.nextSawSample = nextSaw; st.previousSample = previous;
    for (let i = 0; i < BR_NUM_FORMANTS; i++) { st.svfLp[i] = lp[i]; st.svfBp[i] = bp[i]; }
  }

  renderHarmonics(sync, buffer, size) {
    let phase = this.phase, previous = this.state.add.previousSample;
    const inc = (this.phaseIncrement << 1) >>> 0;
    const target = new Array(BR_NUM_HARMONICS), amplitude = new Array(BR_NUM_HARMONICS);
    const p0 = this.parameter[0], p1 = this.parameter[1];
    const peak = (BR_NUM_HARMONICS * p0) >> 7;
    const secondPeak = (peak >> 1) + BR_NUM_HARMONICS * 128;
    const secondPeakAmount = (p1 * p1) >> 15;
    const sqrtsqrtWidth = p1 < 16384 ? p1 >> 6 : 511 - (p1 >> 6);
    const sqrtWidth = (sqrtsqrtWidth * sqrtsqrtWidth) >> 10;
    const width = sqrtWidth * sqrtWidth + 4;
    let total = 0;
    for (let i = 0; i < BR_NUM_HARMONICS; i++) {
      const x = i << 8;
      let d = x - peak;
      let g = Math.trunc((32768 * 128) / (128 + Math.trunc((d * d) / width)));
      d = x - secondPeak;
      g += Math.trunc((secondPeakAmount * 128) / (128 + Math.trunc((d * d) / width)));
      total += g;
      target[i] = g;
    }
    const attenuation = Math.trunc(2147483647 / total);
    for (let i = 0; i < BR_NUM_HARMONICS; i++) {
      target[i] = (inc >>> 16) * (i + 1) > 0x4000 ? 0 : (target[i] * attenuation) >> 16;
      amplitude[i] = this.state.hrm.amplitude[i];
    }
    let s = 0;
    for (let k = 0; k < size; k += 2) {
      phase = (phase + inc) >>> 0;
      // \`*sync++ || *sync++\`: the second is read only when the first is not set
      if (sync[s++]) phase = 0; else if (sync[s++]) phase = 0;
      let out = 0;
      for (let i = 0; i < BR_NUM_HARMONICS; i++) {
        out += brInterpolate824(BR_WAV_SINE, Math.imul(phase, i + 1) >>> 0) * amplitude[i] >> 15;
        amplitude[i] += (target[i] - amplitude[i]) >> 8;
      }
      out = brClip(out);
      buffer[k] = (out + previous) >> 1;
      buffer[k + 1] = out;
      previous = out;
    }
    this.state.add.previousSample = brS16(previous);
    this.phase = phase;
    for (let i = 0; i < BR_NUM_HARMONICS; i++) this.state.hrm.amplitude[i] = amplitude[i];
  }

  renderStruckBell(sync, buffer, size) {
    const st = this.state.add;
    // not every partial's frequency is refreshed each block (to save time on the module): three at a time
    let first = st.currentPartial, last = Math.min(st.currentPartial + 3, BR_NUM_BELL_PARTIALS);
    st.currentPartial = (first + 3) % BR_NUM_BELL_PARTIALS;
    if (this.strikeFlag) {
      for (let i = 0; i < BR_NUM_BELL_PARTIALS; i++) { st.partialAmplitude[i] = BR_BELL_AMPLITUDES[i]; st.partialPhase[i] = 1 << 30; }
      this.strikeFlag = false;
      first = 0; last = BR_NUM_BELL_PARTIALS;
    }
    for (let i = first; i < last; i++) {
      let partialPitch = brS16(this.pitch + BR_BELL_PARTIALS[i]);
      partialPitch = brS16(i & 1 ? partialPitch + (this.parameter[1] >> 7) : partialPitch - (this.parameter[1] >> 7));
      st.partialPhaseIncrement[i] = (this.computePhaseIncrement(partialPitch) << 1) >>> 0;
    }
    // a bell that drones on, losing nothing, at the parameter's top
    if (this.parameter[0] < 32000) {
      for (let i = 0; i < BR_NUM_BELL_PARTIALS; i++) {
        const long = BR_BELL_DECAY_LONG[i], short = BR_BELL_DECAY_SHORT[i];
        let balance = brS16((32767 - this.parameter[0]) >> 8);
        balance = brS16(balance * balance >> 7);
        const decay = long - ((long - short) * balance >> 7);
        st.partialAmplitude[i] = st.partialAmplitude[i] * decay >> 16;
      }
    }
    let previous = st.previousSample;
    for (let k = 0; k < size; k += 2) {
      let out = 0;
      for (let i = 0; i < BR_NUM_BELL_PARTIALS; i++) {
        st.partialPhase[i] = (st.partialPhase[i] + st.partialPhaseIncrement[i]) >>> 0;
        out += brInterpolate824(BR_WAV_SINE, st.partialPhase[i]) * st.partialAmplitude[i] >> 17;
      }
      out = brClip(out);
      buffer[k] = (out + previous) >> 1;
      buffer[k + 1] = out;
      previous = out;
    }
    st.previousSample = brS16(previous);
  }

  renderStruckDrum(sync, buffer, size) {
    const a = this.state.add;
    if (this.strikeFlag) {
      const resetPhase = a.partialAmplitude[0] < 1024;
      for (let i = 0; i < BR_NUM_DRUM_PARTIALS; i++) {
        a.targetPartialAmplitude[i] = BR_DRUM_AMPLITUDES[i];
        if (resetPhase) a.partialPhase[i] = 1 << 30;
      }
      this.strikeFlag = false;
    } else if (this.parameter[0] < 32000) {
      for (let i = 0; i < BR_NUM_DRUM_PARTIALS; i++) {
        const long = BR_DRUM_DECAY_LONG[i], short = BR_DRUM_DECAY_SHORT[i];
        let balance = brS16((32767 - this.parameter[0]) >> 8);
        balance = brS16(balance * balance >> 7);
        const decay = long - ((long - short) * balance >> 7);
        a.targetPartialAmplitude[i] = a.partialAmplitude[i] * decay >> 16;
      }
    }
    for (let i = 0; i < BR_NUM_DRUM_PARTIALS; i++) {
      a.partialPhaseIncrement[i] = (this.computePhaseIncrement(brS16(this.pitch + BR_DRUM_PARTIALS[i])) << 1) >>> 0;
    }
    let previous = a.previousSample;
    let cutoff = (this.pitch - 12 * 128) + (this.parameter[1] >> 2);
    if (cutoff < 0) cutoff = 0; else if (cutoff > 32767) cutoff = 32767;
    const f = brInterpolate824U(BR_LUT_SVF_CUTOFF, (cutoff * 65536) >>> 0);
    let lp0 = a.lpNoise[0], lp1 = a.lpNoise[1], lp2 = a.lpNoise[2];
    const harmonicsGain = this.parameter[1] < 12888 ? this.parameter[1] + 4096 : 16384;
    let noiseModeGain = this.parameter[1] < 16384 ? 0 : this.parameter[1] - 16384;
    noiseModeGain = noiseModeGain * 12888 >> 14;
    const fadeIncrement = Math.trunc(65536 / size);
    let fade = 0;
    const partials = [0, 0, 0, 0, 0, 0];
    for (let k = 0; k < size; k += 2) {
      fade += fadeIncrement;
      let harmonics = 0;
      let noise = brRandomSample();
      if (noise > 16384) noise = 16384;
      if (noise < -16384) noise = -16384;
      lp0 += (noise - lp0) * f >> 15;
      lp1 += (lp0 - lp1) * f >> 15;
      lp2 += (lp1 - lp2) * f >> 15;
      for (let i = 0; i < BR_NUM_DRUM_PARTIALS; i++) {
        a.partialPhase[i] = (a.partialPhase[i] + a.partialPhaseIncrement[i]) >>> 0;
        let partial = brInterpolate824(BR_WAV_SINE, a.partialPhase[i]);
        const amplitude = a.partialAmplitude[i] + (((a.targetPartialAmplitude[i] - a.partialAmplitude[i]) * fade) >> 15);
        partial = partial * amplitude >> 16;
        harmonics += partial;
        partials[i] = partial;
      }
      let sample = partials[0];
      const noiseMode1 = partials[1] * lp2 >> 8, noiseMode2 = partials[3] * lp2 >> 9;
      sample += noiseMode1 * (12288 - noiseModeGain) >> 14;
      sample += noiseMode2 * noiseModeGain >> 14;
      sample += harmonics * harmonicsGain >> 14;
      sample = brClip(sample);
      buffer[k] = (sample + previous) >> 1;
      buffer[k + 1] = sample;
      previous = sample;
    }
    a.previousSample = brS16(previous);
    a.lpNoise[0] = lp0; a.lpNoise[1] = lp1; a.lpNoise[2] = lp2;
    for (let i = 0; i < BR_NUM_BELL_PARTIALS; i++) a.partialAmplitude[i] = a.targetPartialAmplitude[i];
  }

  renderPlucked(sync, buffer, size) {
    const plk = this.state.plk;
    this.phaseIncrement = (this.phaseIncrement << 1) >>> 0;
    if (this.strikeFlag) {
      this.activeVoice = (this.activeVoice + 1) & 0xff;
      if (this.activeVoice >= BR_NUM_PLUCK_VOICES) this.activeVoice = 0;
      // the oversampling that suits the note
      const p = plk[this.activeVoice];
      let increment = this.phaseIncrement | 0;
      p.shift = 0;
      while (increment > (2 << 22)) { increment >>= 1; p.shift++; }
      p.size = 1024 >> p.shift;
      p.mask = p.size - 1;
      p.writePtr = 0;
      p.maxPhaseIncrement = (this.phaseIncrement << 1) >>> 0;
      p.phaseIncrement = this.phaseIncrement;
      const width = (3 * this.parameter[1]) >> 1;
      p.initializationPtr = Math.floor(p.size * (8192 + width) / 65536);
      this.strikeFlag = false;
    }
    // the latest note follows the pitch, but not too far above where it was plucked
    const current = plk[this.activeVoice];
    current.phaseIncrement = Math.min(this.phaseIncrement, current.maxPhaseIncrement);
    // loss and stretching
    const updateProbability = this.parameter[0] < 16384 ? 65535 : 131072 - (this.parameter[0] >> 3) * 31;
    let loss = brS16(4096 - (this.phaseIncrement >>> 14));
    if (loss < 256) loss = 256;
    loss = this.parameter[0] < 16384 ? brS16(loss * (16384 - this.parameter[0]) >> 14) : 0;
    let previous = plk[0].previousSample;
    for (let k = 0; k < size; k += 2) {
      let sample = 0;
      for (let i = 0; i < BR_NUM_PLUCK_VOICES; i++) {
        const p = plk[i];
        const dl = this.ks.subarray(i * 1025, i * 1025 + 1025);
        if (p.initializationPtr) {
          // filling the line with noise: the pluck
          p.initializationPtr--;
          const excitation = (dl[p.initializationPtr] + 3 * brRandomSample()) >> 2;
          dl[p.initializationPtr] = excitation;
          sample += excitation;
        } else {
          p.phase = (p.phase + p.phaseIncrement) >>> 0;
          const readPtr = ((p.phase >>> (22 + p.shift)) + 2) & p.mask;
          let writePtr = p.writePtr;
          while (writePtr !== readPtr) {
            const next = (writePtr + 1) & p.mask;
            const a = dl[writePtr], b = dl[next];
            const probability = brRandomWord();
            if ((probability & 0xffff) <= updateProbability) {
              let sum = a + b;
              sum = sum < 0 ? -(-sum >> 1) : sum >> 1;
              if (loss) sum = sum * (32768 - loss) >> 15;
              dl[writePtr] = sum;
            }
            if (writePtr === 0) dl[p.size] = dl[0];
            writePtr = next;
          }
          p.writePtr = writePtr;
          sample += brInterpolate1022(dl, p.phase >>> p.shift);
        }
      }
      sample = brClip(sample);
      buffer[k] = (previous + sample) >> 1;
      buffer[k + 1] = sample;
      previous = sample;
    }
    plk[0].previousSample = brS16(previous);
  }

  renderBowed(sync, buffer, size) {
    const dlB = this.bowedBridge, dlN = this.bowedNeck;
    if (this.strikeFlag) {
      dlB.fill(0); dlN.fill(0);
      this.state = brDigitalState();
      this.strikeFlag = false;
    }
    const st = this.state.phy;
    const parameter0 = brS16(172 - (this.parameter[0] >> 8)), parameter1 = brS16(6 + (this.parameter[1] >> 9));
    let delayPtr = st.delayPtr, excitationPtr = st.excitationPtr, lpState = st.lpState;
    let y0 = st.filterState[0], y1 = st.filterState[1];
    // the delay times; an octave up when the note is too low for the lines
    let delay = ((this.delay >>> 1) - (2 << 16)) >>> 0;
    let bridgeDelay = Math.imul(delay >>> 8, parameter1) >>> 0;
    while (((delay - bridgeDelay) >>> 0) > ((BR_WG_NECK - 1) << 16) || bridgeDelay > ((BR_WG_BRIDGE - 1) << 16)) {
      delay >>>= 1; bridgeDelay >>>= 1;
    }
    const bridgeIntegral = bridgeDelay >>> 16, bridgeFractional = bridgeDelay & 0xffff;
    const neckDelay = (delay - bridgeDelay) >>> 0;
    const neckIntegral = neckDelay >>> 16, neckFractional = neckDelay & 0xffff;
    let previous = st.previousSample;
    // at half the rate (so the body filter's coefficients round less)
    for (let k = 0; k < size; k += 2) {
      this.phase = (this.phase + this.phaseIncrement) >>> 0;
      const bridgePtr = (delayPtr + 2 * BR_WG_BRIDGE - bridgeIntegral) & 0xffff;
      const neckPtr = (delayPtr + 2 * BR_WG_NECK - neckIntegral) & 0xffff;
      const bridgeValue = brMix(dlB[bridgePtr % BR_WG_BRIDGE], dlB[(bridgePtr - 1) % BR_WG_BRIDGE], bridgeFractional) << 8;
      const nutValue = brMix(dlN[neckPtr % BR_WG_NECK], dlN[(neckPtr - 1) % BR_WG_NECK], neckFractional) << 8;
      lpState = (bridgeValue * 14008 + lpState * 18022) >> 15;
      const bridgeReflection = -lpState, nutReflection = -nutValue;
      const stringVelocity = bridgeReflection + nutReflection;
      let bowVelocity = BR_LUT_BOWING_ENVELOPE[excitationPtr >> 1];
      bowVelocity += BR_LUT_BOWING_ENVELOPE[(excitationPtr + 1) >> 1];
      bowVelocity >>= 1;
      const velocityDelta = bowVelocity - stringVelocity;
      let friction = velocityDelta * parameter0 >> 5;
      if (friction < 0) friction = -friction;
      if (friction >= (1 << 17)) friction = (1 << 17) - 1;
      friction = BR_LUT_BOWING_FRICTION[friction >> 9];
      const newVelocity = friction * velocityDelta >> 15;
      dlN[delayPtr % BR_WG_NECK] = (bridgeReflection + newVelocity) >> 8;
      dlB[delayPtr % BR_WG_BRIDGE] = (nutReflection + newVelocity) >> 8;
      delayPtr = (delayPtr + 1) & 0xffff;
      let temp = bridgeValue * 6553 >> 15;
      temp += y0 * 6948 >> 12;
      temp += y1 * -2959 >> 12;
      const out = brClip(temp - y1);
      y1 = y0; y0 = temp;
      buffer[k] = (out + previous) >> 1;
      buffer[k + 1] = out;
      previous = out;
      excitationPtr = (excitationPtr + 1) & 0xffff;
    }
    if ((excitationPtr >> 1) >= BR_LUT_BOWING_ENVELOPE.length - 32) excitationPtr = (BR_LUT_BOWING_ENVELOPE.length - 32) << 1;
    st.delayPtr = delayPtr % BR_WG_NECK; st.excitationPtr = excitationPtr; st.lpState = lpState;
    st.filterState[0] = y0; st.filterState[1] = y1; st.previousSample = brS16(previous);
  }

  renderBlown(sync, buffer, size) {
    const st = this.state.phy;
    let delayPtr = st.delayPtr, lpState = st.lpState;
    const dl = this.bore;
    if (this.strikeFlag) { dl.fill(0); this.strikeFlag = false; }
    let delay = ((this.delay >>> 1) - (1 << 16)) >>> 0;
    while (delay > ((BR_WG_BORE - 1) << 16)) delay >>>= 1;
    const boreIntegral = delay >>> 16, boreFractional = delay & 0xffff;
    const parameter = (28000 - (this.parameter[0] >> 1)) & 0xffff;
    let filterState = brS16(st.filterState[0]);
    let normalizedPitch = brS16((this.pitch - 8192 + (this.parameter[1] >> 1)) >> 7);
    if (normalizedPitch < 0) normalizedPitch = 0; else if (normalizedPitch > 127) normalizedPitch = 127;
    const coefficient = BR_LUT_FLUTE_BODY_FILTER[normalizedPitch];
    for (let k = 0; k < size; k++) {
      this.phase = (this.phase + this.phaseIncrement) >>> 0;
      let breath = brRandomSample() * parameter >> 15;
      breath = breath * 26214 >> 15;
      breath += 26214;
      const borePtr = (delayPtr + 2 * BR_WG_BORE - boreIntegral) & 0xffff;
      const dlValue = brMix(dl[borePtr % BR_WG_BORE], dl[(borePtr - 1) % BR_WG_BORE], boreFractional);
      let pressureDelta = (dlValue >> 1) + lpState;
      lpState = dlValue >> 1;
      pressureDelta = -3891 * pressureDelta >> 12;
      pressureDelta -= breath;
      const reed = brClip((pressureDelta * -1229 >> 12) + 22938);
      const out = brClip((pressureDelta * reed >> 15) + breath);
      dl[delayPtr % BR_WG_BORE] = out;
      delayPtr = (delayPtr + 1) & 0xffff;
      filterState = brS16((coefficient * out + (4096 - coefficient) * filterState) >> 12);
      buffer[k] = filterState;
    }
    st.filterState[0] = filterState; st.delayPtr = delayPtr % BR_WG_BORE; st.lpState = lpState;
  }

  renderFluted(sync, buffer, size) {
    const st = this.state.phy;
    let delayPtr = st.delayPtr, excitationPtr = st.excitationPtr, lpState = st.lpState;
    let x0 = st.filterState[0], y0 = st.filterState[1];
    const dlB = this.flutedBore, dlJ = this.flutedJet;
    if (this.strikeFlag) { excitationPtr = 0; dlB.fill(0); dlJ.fill(0); lpState = 0; this.strikeFlag = false; }
    let boreDelay = ((this.delay << 1) - (2 << 16)) >>> 0;
    let jetDelay = Math.imul(boreDelay >>> 8, 48 + (this.parameter[1] >> 10)) >>> 0;
    boreDelay = (boreDelay - jetDelay) >>> 0;
    while (boreDelay > ((BR_WG_FBORE - 1) << 16) || jetDelay > ((BR_WG_JET - 1) << 16)) { boreDelay >>>= 1; jetDelay >>>= 1; }
    const boreIntegral = boreDelay >>> 16, boreFractional = boreDelay & 0xffff;
    const jetIntegral = jetDelay >>> 16, jetFractional = jetDelay & 0xffff;
    const breathIntensity = (2100 - (this.parameter[0] >> 4)) & 0xffff;
    // (the original reads past the 128-entry table above MIDI 127; the port keeps to its last entry)
    const coefficient = BR_LUT_FLUTE_BODY_FILTER[Math.min(this.pitch >> 7, BR_LUT_FLUTE_BODY_FILTER.length - 1)];
    for (let k = 0; k < size; k++) {
      this.phase = (this.phase + this.phaseIncrement) >>> 0;
      const borePtr = (delayPtr + 2 * BR_WG_FBORE - boreIntegral) & 0xffff;
      const jetPtr = (delayPtr + 2 * BR_WG_JET - jetIntegral) & 0xffff;
      const boreValue = brMix(dlB[borePtr % BR_WG_FBORE], dlB[(borePtr - 1) % BR_WG_FBORE], boreFractional) << 9;
      const jetValue = brMix(dlJ[jetPtr % BR_WG_JET], dlJ[(jetPtr - 1) % BR_WG_JET], jetFractional) << 9;
      let breath = BR_LUT_BLOWING_ENVELOPE[excitationPtr] << 1;
      let randomPressure = brRandomSample() * breathIntensity >> 12;
      randomPressure = randomPressure * breath >> 15;
      breath += randomPressure;
      lpState = (-coefficient * boreValue + (4096 - coefficient) * lpState) >> 12;
      let reflection = lpState;
      y0 = 4055 * y0 >> 12; // the DC blocker's pole, 0.99
      y0 += reflection - x0;
      x0 = reflection;
      reflection = y0;
      let pressureDelta = breath - (reflection >> 1);
      dlJ[delayPtr % BR_WG_JET] = pressureDelta >> 9;
      let jetIndex = jetValue;
      if (jetIndex < 0) jetIndex = 0;
      if (jetIndex > 65535) jetIndex = 65535;
      pressureDelta = brS16(BR_LUT_BLOWING_JET[jetIndex >> 8]) + (reflection >> 1);
      dlB[delayPtr % BR_WG_FBORE] = pressureDelta >> 9;
      delayPtr = (delayPtr + 1) & 0xffff;
      buffer[k] = brClip(boreValue >> 1);
      if ((size - 1 - k) & 3) excitationPtr = (excitationPtr + 1) & 0xffff; // the count left, as after \`size--\`
    }
    if (excitationPtr >= BR_LUT_BLOWING_ENVELOPE.length - 32) excitationPtr = BR_LUT_BLOWING_ENVELOPE.length - 32;
    st.delayPtr = delayPtr; st.excitationPtr = excitationPtr; st.lpState = lpState;
    st.filterState[0] = x0; st.filterState[1] = y0;
  }

  renderKick(sync, buffer, size) {
    const [p0, p1, p2] = this.pulse, svf = this.svf[0];
    if (this.initFlag) {
      p0.init(); p0.setDelay(0); p0.setDecay(3340);
      p1.init(); p1.setDelay(48); p1.setDecay(3072); // 1 ms at 48 kHz, as written in the original
      p2.init(); p2.setDelay(192); p2.setDecay(4093);
      svf.init(); svf.setPunch(32768); svf.mode = BR_SVF_BP;
      this.initFlag = false;
    }
    if (this.strikeFlag) {
      this.strikeFlag = false;
      p0.trigger(275251); // 12 * 32768 * 0.7
      p1.trigger(-13763); // -19662 * 0.7
      p2.trigger(18000);
      svf.setPunch(24000);
    }
    const decay = this.parameter[0] >>> 0;
    let scaled = (65535 - (decay << 1)) >>> 0;
    const squared = Math.floor(scaled * scaled / 65536) >>> 0;
    scaled = Math.floor(squared * scaled / 262144) >>> 0;
    svf.setResonance(32768 - 128 - scaled);
    let coefficient = this.parameter[1] >>> 0;
    coefficient = (coefficient * coefficient) >>> 15;
    coefficient = (coefficient * coefficient) >>> 15;
    const lpCoefficient = 128 + (coefficient >> 1) * 3;
    let lpState = this.state.svf.lp;
    for (let k = 0; k < size; k += 2) {
      let excitation = 0;
      excitation += p0.process();
      excitation += !p1.done() ? 16384 : 0;
      excitation += p1.process();
      p2.process();
      svf.setFrequency(this.pitch + (p2.done() ? 0 : 17 << 7));
      for (let j = 0; j < 2; j++) {
        const resonatorOutput = (excitation >> 4) + svf.process(excitation);
        lpState = brClip(lpState + ((resonatorOutput - lpState) * lpCoefficient >> 15));
        buffer[k + j] = lpState;
      }
    }
    this.state.svf.lp = lpState;
  }

  renderSnare(sync, buffer, size) {
    const [p0, p1, p2, p3] = this.pulse, [s0, s1, s2] = this.svf;
    if (this.initFlag) {
      p0.init(); p0.setDelay(0); p0.setDecay(1536);
      p1.init(); p1.setDelay(48); p1.setDecay(3072);
      p2.init(); p2.setDelay(48); p2.setDecay(1200);
      p3.init(); p3.setDelay(0);
      s0.init(); s1.init();
      s2.init(); s2.setResonance(2000); s2.mode = BR_SVF_BP;
      this.initFlag = false;
    }
    if (this.strikeFlag) {
      let decay = 49152 - this.pitch;
      decay += this.parameter[1] < 16384 ? 0 : this.parameter[1] - 16384;
      if (decay > 65535) decay = 65535;
      s0.setResonance(29000 + (decay >> 5));
      s1.setResonance(26500 + (decay >> 5));
      p3.setDecay(4092 + (decay >> 14));
      p0.trigger(15 * 32768);
      p1.trigger(-1 * 32768);
      p2.trigger(13107);
      let snappy = this.parameter[1];
      if (snappy >= 14336) snappy = 14336;
      p3.trigger(512 + (snappy << 1));
      this.strikeFlag = false;
    }
    s0.setFrequency(this.pitch + (12 << 7));
    s1.setFrequency(this.pitch + (24 << 7));
    s2.setFrequency(this.pitch + (60 << 7));
    const g1 = 22000 - (this.parameter[0] >> 1), g2 = 22000 + (this.parameter[0] >> 1);
    for (let k = 0; k < size; k += 2) {
      let e1 = 0;
      e1 += p0.process();
      e1 += p1.process();
      e1 += !p1.done() ? 2621 : 0;
      let e2 = 0;
      e2 += p2.process();
      e2 += !p2.done() ? 13107 : 0;
      const noise = brRandomSample() * p3.process() >> 15;
      let sd = 0;
      sd += (s0.process(e1) + (e1 >> 4)) * g1 >> 15;
      sd += (s1.process(e2) + (e2 >> 4)) * g2 >> 15;
      sd += s2.process(noise);
      sd = brClip(sd);
      buffer[k] = sd; buffer[k + 1] = sd;
    }
  }

  renderCymbal(sync, buffer, size) {
    const [s0, s1] = this.svf;
    if (this.initFlag) {
      s0.init(); s0.mode = BR_SVF_BP; s0.setResonance(12000);
      s1.init(); s1.mode = BR_SVF_HP; s1.setResonance(2000);
      this.initFlag = false;
    }
    const hat = this.state.hat;
    const increments = [0, 0, 0, 0, 0, 0, 0];
    const note = (40 << 7) + (this.pitch >> 1);
    increments[0] = this.computePhaseIncrement(note);
    const root = increments[0] >>> 10;
    increments[1] = (Math.imul(root, 24273) >>> 0) >>> 4;
    increments[2] = (Math.imul(root, 12561) >>> 0) >>> 4;
    increments[3] = (Math.imul(root, 18417) >>> 0) >>> 4;
    increments[4] = (Math.imul(root, 22452) >>> 0) >>> 4;
    increments[5] = (Math.imul(root, 31858) >>> 0) >>> 4;
    increments[6] = Math.imul(increments[0], 24) >>> 0;
    const xfade = this.parameter[1];
    s0.setFrequency(this.parameter[0] >> 1);
    s1.setFrequency(this.parameter[0] >> 1);
    for (let k = 0; k < size; k++) {
      this.phase = (this.phase + increments[6]) >>> 0;
      if (this.phase < increments[6]) hat.rngState = (Math.imul(hat.rngState, 1664525) + 1013904223) >>> 0;
      let hatNoise = 0;
      for (let i = 0; i < 6; i++) {
        hat.phase[i] = (hat.phase[i] + increments[i]) >>> 0;
        hatNoise += hat.phase[i] >>> 31;
      }
      hatNoise -= 3;
      hatNoise *= 5461;
      hatNoise = brClip(s0.process(hatNoise));
      let noise = (hat.rngState >>> 16) - 32768;
      noise = brClip(s1.process(noise >> 1));
      buffer[k] = brS16(hatNoise + ((noise - hatNoise) * xfade >> 15));
    }
  }

  renderWavetables(sync, buffer, size) {
    // hysteresis on COLOR, so one bit of error does not jump between tables
    if (this.parameter[1] > this.previousParameter[1] + 64 || this.parameter[1] < this.previousParameter[1] - 64) this.previousParameter[1] = this.parameter[1];
    const index = (((this.previousParameter[1] >>> 0) * 20) >>> 0) >>> 15;
    const [steps, waves] = BR_WAVETABLES[index];
    const wavePointer = ((this.parameter[0] << 1) * steps) >>> 0;
    const w0 = waves[(wavePointer >>> 16)] * 129, w1 = waves[(wavePointer >>> 16) + 1] * 129;
    const inc = this.phaseIncrement >>> 1;
    for (let k = 0; k < size; k++) {
      // 2x, naively oversampled
      this.phase = (this.phase + inc) >>> 0;
      if (sync[k]) this.phase = 0;
      let sample = brS16(brCrossfadeU8(BR_WT_WAVES, w0, w1, this.phase >>> 1, wavePointer) >> 1);
      this.phase = (this.phase + inc) >>> 0;
      sample = brS16(sample + (brCrossfadeU8(BR_WT_WAVES, w0, w1, this.phase >>> 1, wavePointer) >> 1));
      buffer[k] = sample;
    }
  }

  renderWaveMap(sync, buffer, size) {
    // a 16 x 16 grid, so 15 squares to interpolate across
    const p0 = ((this.parameter[0] * 15) >> 4) & 0xffff, p1 = ((this.parameter[1] * 15) >> 4) & 0xffff;
    const x0 = (p0 << 5) & 0xffff, x1 = (p1 << 5) & 0xffff;
    const c0 = p0 >> 11, c1 = p1 >> 11;
    const w = [[0, 0], [0, 0]];
    for (let i = 0; i < 2; i++) for (let j = 0; j < 2; j++) w[i][j] = BR_WT_MAP[((c0 + i) * 16 + (c1 + j)) & 0xffff] * 129;
    const inc = this.phaseIncrement >>> 1;
    for (let k = 0; k < size; k++) {
      this.phase = (this.phase + inc) >>> 0;
      if (sync[k]) this.phase = 0;
      let sample = brS16(brS16(brMix(brCrossfadeU8(BR_WT_WAVES, w[0][0], w[0][1], this.phase >>> 1, x1), brCrossfadeU8(BR_WT_WAVES, w[1][0], w[1][1], this.phase >>> 1, x1), x0)) >> 1);
      this.phase = (this.phase + inc) >>> 0;
      sample = brS16(sample + (brS16(brMix(brCrossfadeU8(BR_WT_WAVES, w[0][0], w[0][1], this.phase >>> 1, x1), brCrossfadeU8(BR_WT_WAVES, w[1][0], w[1][1], this.phase >>> 1, x1), x0)) >> 1));
      buffer[k] = sample;
    }
  }

  renderWaveLine(sync, buffer, size) {
    this.smoothedParameter = (3 * this.smoothedParameter + (this.parameter[0] << 1)) >> 2;
    const scan = this.smoothedParameter & 0xffff;
    // (the original reads one past the 64 waves at the very top; the port keeps to the last)
    const line = (i) => BR_WAVE_LINE[Math.min(i, BR_WAVE_LINE.length - 1)] * 129;
    const w0 = line(this.previousParameter[0] >> 9), w1 = line(scan >> 10), w2 = line((scan >> 10) + 1);
    const smoothXfade = (scan << 6) & 0xffff;
    let roughXfade = 0;
    const roughStep = Math.floor(32768 / size) & 0xffff;
    const balance = (this.parameter[1] << 3) & 0xffff;
    let phase = this.phase;
    const inc = this.phaseIncrement >>> 1;
    const T = BR_WT_WAVES, p1 = this.parameter[1];
    for (let k = 0; k < size; k++) {
      if (sync[k]) phase = 0;
      let sample = 0;
      for (let half = 0; half < 2; half++) {
        const ph = phase >>> 1, coarse = (ph & 0xfe000000) >>> 0, coarser = (ph & 0xf8000000) >>> 0;
        let rough, smooth;
        if (p1 < 8192) {
          rough = brCrossfadeU8(T, w0, w1, coarse, roughXfade);
          smooth = brCrossfadeU8(T, w0, w1, ph, roughXfade);
          sample += brS16(brMix(brS16(rough), brS16(smooth), balance));
          roughXfade = (roughXfade + roughStep) & 0xffff;
        } else if (p1 < 16384) {
          rough = brCrossfadeU8(T, w0, w1, ph, roughXfade);
          smooth = brCrossfadeU8(T, w1, w2, ph, smoothXfade);
          sample += brS16(brMix(brS16(rough), brS16(smooth), balance));
          roughXfade = (roughXfade + roughStep) & 0xffff;
        } else if (p1 < 24576) {
          smooth = brCrossfadeU8(T, w1, w2, ph, smoothXfade);
          rough = brCrossfadeU8(T, w1, w2, coarse, smoothXfade);
          sample += brS16(brMix(brS16(smooth), brS16(rough), balance));
        } else {
          smooth = brCrossfadeU8(T, w1, w2, coarse, smoothXfade);
          rough = brCrossfadeU8(T, w1, w2, coarser, smoothXfade);
          sample += brS16(brMix(brS16(smooth), brS16(rough), balance));
        }
        phase = (phase + inc) >>> 0;
      }
      buffer[k] = brS16(sample >> 1);
    }
    this.phase = phase;
    this.previousParameter[0] = brS16(this.smoothedParameter >> 1);
  }

  renderWaveParaphonic(sync, buffer, size) {
    const ph = this.state.saw.phase;
    if (this.strikeFlag) {
      for (let i = 0; i < 4; i++) ph[i] = brRandomWord();
      this.strikeFlag = false;
    }
    const inc0 = this.phaseIncrement;
    let p0 = ph[0], p1 = ph[1], p2 = ph[2], p3 = ph[3];
    const chordIntegral = (this.parameter[1] >> 11) & 0xffff;
    let chordFractional = (this.parameter[1] << 5) & 0xffff;
    if (chordFractional < 30720) chordFractional = 0;
    else if (chordFractional >= 34816) chordFractional = 65535;
    else chordFractional = ((chordFractional - 30720) * 16) & 0xffff;
    const incs = [0, 0, 0];
    for (let i = 0; i < 3; i++) {
      const d1 = BR_CHORDS[chordIntegral][i], d2 = BR_CHORDS[chordIntegral + 1][i];
      const detune = (d1 + ((d2 - d1) * chordFractional >> 16)) & 0xffff;
      incs[i] = this.computePhaseIncrement(this.pitch + detune);
    }
    const w1 = BR_MINI_WAVE_LINE[this.parameter[0] >> 10] * 129, w2 = BR_MINI_WAVE_LINE[(this.parameter[0] >> 10) + 1] * 129;
    const xfade = (this.parameter[0] << 6) & 0xffff, T = BR_WT_WAVES;
    for (let k = 0; k < size; k++) {
      p0 = (p0 + inc0) >>> 0; p1 = (p1 + incs[0]) >>> 0; p2 = (p2 + incs[1]) >>> 0; p3 = (p3 + incs[2]) >>> 0;
      const sample = brCrossfadeU8(T, w1, w2, p0 >>> 1, xfade) + brCrossfadeU8(T, w1, w2, p1 >>> 1, xfade)
        + brCrossfadeU8(T, w1, w2, p2 >>> 1, xfade) + brCrossfadeU8(T, w1, w2, p3 >>> 1, xfade);
      buffer[k] = brS16(sample >> 2);
    }
    ph[0] = p0; ph[1] = p1; ph[2] = p2; ph[3] = p3;
  }

  renderFilteredNoise(sync, buffer, size) {
    const f = brInterpolate824U(BR_LUT_SVF_CUTOFF, (this.pitch * 131072) >>> 0);
    const damp = brInterpolate824U(BR_LUT_SVF_DAMP, (this.parameter[0] * 131072) >>> 0);
    const scale = brInterpolate824U(BR_LUT_SVF_SCALE, (this.parameter[0] * 131072) >>> 0);
    let bp = this.state.svf.bp, lp = this.state.svf.lp;
    let bpGain, lpGain, hpGain;
    // LP to BP to HP
    if (this.parameter[1] < 16384) { bpGain = this.parameter[1]; lpGain = 16384 - bpGain; hpGain = 0; }
    else { bpGain = 32767 - this.parameter[1]; hpGain = this.parameter[1] - 16384; lpGain = 0; }
    const gainCorrection = f > scale ? Math.trunc((scale * 32767) / f) : 32767;
    for (let k = 0; k < size; k++) {
      const input = brRandomSample() >> 1;
      const notch = input - (bp * damp >> 15);
      lp = brClip(lp + (f * bp >> 15));
      const hp = notch - lp;
      bp += f * hp >> 15;
      let result = ((lpGain * lp) >> 14) + ((bpGain * bp) >> 14) + ((hpGain * hp) >> 14);
      result = brClip(result);
      result = result * gainCorrection >> 15;
      buffer[k] = brInterpolate88(BR_WS_MODERATE_OVERDRIVE, result + 32768);
    }
    this.state.svf.lp = lp; this.state.svf.bp = bp;
  }

  renderTwinPeaksNoise(sync, buffer, size) {
    const fs = this.state.pno.filterState;
    let y11 = fs[0][0], y12 = fs[0][1], y21 = fs[1][0], y22 = fs[1][1];
    const q = (65240 + (this.parameter[0] >> 7)) >>> 0;
    const qSquared = (q * q) >>> 17;
    let p1 = this.pitch;
    p1 = p1 < 0 ? 0 : p1 > 16383 ? 16383 : p1;
    let c1 = brInterpolate824U(BR_LUT_RESONATOR_COEFFICIENT, (p1 * 131072) >>> 0);
    const s1 = brInterpolate824U(BR_LUT_RESONATOR_SCALE, (p1 * 131072) >>> 0);
    let p2 = brS16(this.pitch + ((this.parameter[1] - 16384) >> 1));
    p2 = p2 < 0 ? 0 : p2 > 16383 ? 16383 : p2;
    let c2 = brInterpolate824U(BR_LUT_RESONATOR_COEFFICIENT, (p2 * 131072) >>> 0);
    const s2 = brInterpolate824U(BR_LUT_RESONATOR_SCALE, (p2 * 131072) >>> 0);
    c1 = (c1 * q) >>> 16;
    c2 = (c2 * q) >>> 16;
    const makeupGain = 8191 - (this.parameter[0] >> 2);
    for (let k = 0; k < size; k += 2) {
      const n = brRandomSample() >> 1;
      let y10 = n > 0 ? n * s1 >> 16 : -((-n) * s1 >> 16);
      let y20 = n > 0 ? n * s2 >> 16 : -((-n) * s2 >> 16);
      y10 += y11 * c1 >> 15;
      y10 -= y12 * qSquared >> 15;
      y10 = brClip(y10);
      y12 = y11; y11 = y10;
      y20 += y21 * c2 >> 15;
      y20 -= y22 * qSquared >> 15;
      y20 = brClip(y20);
      y22 = y21; y21 = y20;
      y10 += y20;
      y10 += y10 * makeupGain >> 13;
      y10 = brClip(y10);
      const sample = brInterpolate88(BR_WS_MODERATE_OVERDRIVE, y10 + 32768);
      buffer[k] = sample; buffer[k + 1] = sample;
    }
    fs[0][0] = y11; fs[0][1] = y12; fs[1][0] = y21; fs[1][1] = y22;
  }

  renderClockedNoise(sync, buffer, size) {
    const st = this.state.clk, pp = this.previousParameter;
    if (this.parameter[1] > pp[1] + 64 || this.parameter[1] < pp[1] - 64) pp[1] = this.parameter[1];
    if (this.parameter[0] > pp[0] + 16 || this.parameter[0] < pp[0] - 16) pp[0] = this.parameter[0];
    if (this.strikeFlag) { st.seed = brRandomWord() | 0; this.strikeFlag = false; }
    // COARSE's range moved up, toward clock rates near the sample rate
    let phase = this.phase, inc = this.phaseIncrement;
    for (let i = 0; i < 3; i++) if (inc < 0x80000000) inc = (inc << 1) >>> 0;
    // the random generator's period, and the quantisation's steps
    st.cyclePhaseIncrement = (this.computePhaseIncrement(pp[0] - 16384) << 1) >>> 0;
    let steps = 1 + (pp[1] >> 10);
    if (steps === 1) steps = 2;
    const divider = Math.floor(65536 / steps);
    for (let k = 0; k < size; k++) {
      phase = (phase + inc) >>> 0;
      if (sync[k]) phase = 0;
      if (phase < inc) {
        st.rngState = (Math.imul(st.rngState, 1664525) + 1013904223) >>> 0;
        st.cyclePhase = (st.cyclePhase + st.cyclePhaseIncrement) >>> 0;
        if (st.cyclePhase < st.cyclePhaseIncrement) {
          st.rngState = st.seed >>> 0;
          st.cyclePhase = st.cyclePhaseIncrement; // a whole number of clocks a period
        }
        let sample = st.rngState & 0xffff;
        sample = (sample - (sample % divider)) & 0xffff;
        sample = (sample + (divider >> 1)) & 0xffff;
        st.sample = brS16(sample);
        phase = inc; // the clock an exact divisor of the sample rate
      }
      buffer[k] = st.sample;
    }
    this.phase = phase;
  }

  renderGranularCloud(sync, buffer, size) {
    const grains = this.state.grain;
    for (let i = 0; i < 4; i++) {
      const g = grains[i];
      // a grain at the end of its envelope starts again, or not
      if (g.envelopePhase > (1 << 24) || g.envelopePhaseIncrement === 0) {
        g.envelopePhaseIncrement = 0;
        if ((brRandomWord() & 0xffff) < 0x4000) {
          g.envelopePhaseIncrement = (BR_LUT_GRANULAR_ENVELOPE_RATE[this.parameter[0] >> 7] << 3) >>> 0;
          g.envelopePhase = 0;
          g.phaseIncrement = this.phaseIncrement;
          const pitchMod = brRandomSample() * this.parameter[1] >> 16;
          const phi = this.phaseIncrement >>> 8;
          g.phaseIncrement = (g.phaseIncrement + phi * (pitchMod < 0 ? pitchMod >> 8 : pitchMod >> 7)) >>> 0;
        }
      }
    }
    for (let k = 0; k < size; k++) {
      let sample = 0;
      for (let i = 0; i < 4; i++) {
        const g = grains[i];
        g.phase = (g.phase + g.phaseIncrement) >>> 0;
        g.envelopePhase = (g.envelopePhase + g.envelopePhaseIncrement) >>> 0;
        sample += brInterpolate824(BR_WAV_SINE, g.phase) * BR_LUT_GRANULAR_ENVELOPE[g.envelopePhase >>> 16] >> 17;
      }
      buffer[k] = sample < -32768 ? -32768 : sample > 32767 ? 32767 : sample;
    }
  }

  renderParticleNoise(sync, buffer, size) {
    const st = this.state.pno, fs = st.filterState;
    let amplitude = st.amplitude;
    const density = (1024 + this.parameter[0]) >>> 0;
    let y11 = fs[0][0], y12 = fs[0][1], s1 = st.filterScale[0], c1 = st.filterCoefficient[0];
    let y21 = fs[1][0], y22 = fs[1][1], s2 = st.filterScale[1], c2 = st.filterCoefficient[1];
    let y31 = fs[2][0], y32 = fs[2][1], s3 = st.filterScale[2], c3 = st.filterCoefficient[2];
    const p = this.parameter[1];
    const clamp = (x) => (x < 0 ? 0 : x > 16383 ? 16383 : x);
    for (let k = 0; k < size; k += 2) {
      const noise = brRandomWord();
      if ((noise & 0x7fffff) < density) {
        amplitude = 65535;
        const noiseA = brS16((noise & 0x0fff) - 0x800), noiseB = brS16(((noise >>> 15) & 0x1fff) - 0x1000);
        const p1 = clamp(brS16(this.pitch + (3 * noiseA * p >> 17) + 0x600));
        c1 = brInterpolate824U(BR_LUT_RESONATOR_COEFFICIENT, (p1 * 131072) >>> 0);
        s1 = brInterpolate824U(BR_LUT_RESONATOR_SCALE, (p1 * 131072) >>> 0);
        const p2 = clamp(brS16(this.pitch + (noiseA * p >> 15) + 0x980));
        c2 = brInterpolate824U(BR_LUT_RESONATOR_COEFFICIENT, (p2 * 131072) >>> 0);
        s2 = brInterpolate824U(BR_LUT_RESONATOR_SCALE, (p2 * 131072) >>> 0);
        const p3 = clamp(brS16(this.pitch + (noiseB * p >> 16) + 0x790));
        c3 = brInterpolate824U(BR_LUT_RESONATOR_COEFFICIENT, (p3 * 131072) >>> 0);
        s3 = brInterpolate824U(BR_LUT_RESONATOR_SCALE, (p3 * 131072) >>> 0);
        c1 = c1 * BR_RESONANCE_FACTOR >> 15;
        c2 = c2 * BR_RESONANCE_FACTOR >> 15;
        c3 = c3 * BR_RESONANCE_FACTOR >> 15;
      }
      const sample = (brS16(noise) * amplitude) >> 16;
      amplitude = ((amplitude * BR_PARTICLE_DECAY) >>> 16) & 0xffff;
      let y10, y20, y30;
      if (sample > 0) { y10 = sample * s1 >> 16; y20 = sample * s2 >> 16; y30 = sample * s3 >> 16; }
      else { y10 = -((-sample) * s1 >> 16); y20 = -((-sample) * s2 >> 16); y30 = -((-sample) * s3 >> 16); }
      y10 = brClip(y10 + (y11 * c1 >> 15) - (y12 * BR_RESONANCE_SQUARED >> 15));
      y12 = y11; y11 = y10;
      y20 = brClip(y20 + (y21 * c2 >> 15) - (y22 * BR_RESONANCE_SQUARED >> 15));
      y22 = y21; y21 = y20;
      y30 = brClip(y30 + (y31 * c3 >> 15) - (y32 * BR_RESONANCE_SQUARED >> 15));
      y32 = y31; y31 = y30;
      y10 = brClip(y10 + y20 + y30);
      buffer[k] = y10; buffer[k + 1] = y10;
    }
    st.amplitude = amplitude;
    fs[0][0] = y11; fs[0][1] = y12; st.filterScale[0] = s1; st.filterCoefficient[0] = c1;
    fs[1][0] = y21; fs[1][1] = y22; st.filterScale[1] = s2; st.filterCoefficient[1] = c2;
    fs[2][0] = y31; fs[2][1] = y32; st.filterScale[2] = s3; st.filterCoefficient[2] = c3;
  }

  renderDigitalModulation(sync, buffer, size) {
    const st = this.state.dmd;
    let phase = this.phase;
    const inc = this.phaseIncrement;
    let symbolPhase = st.symbolPhase;
    const symbolInc = this.computePhaseIncrement(this.pitch - 1536 + ((this.parameter[0] - 32767) >> 3));
    let dataByte = st.dataByte;
    if (this.strikeFlag) { st.symbolCount = 0; this.strikeFlag = false; }
    for (let k = 0; k < size; k++) {
      phase = (phase + inc) >>> 0;
      symbolPhase = (symbolPhase + symbolInc) >>> 0;
      if (symbolPhase < symbolInc) {
        st.symbolCount = (st.symbolCount + 1) & 0xffff;
        if (!(st.symbolCount & 3)) {
          if (st.symbolCount >= 64 + 4 * 256) st.symbolCount = 0;
          // a preamble, a sync word, then COLOR as data
          if (st.symbolCount < 32) dataByte = 0x00;
          else if (st.symbolCount < 48) dataByte = 0x99;
          else if (st.symbolCount < 64) dataByte = 0xcc;
          else {
            st.filterState = (st.filterState * 3 + this.parameter[1]) >> 2;
            dataByte = (st.filterState >> 7) & 0xff;
          }
        } else {
          dataByte >>= 2;
        }
      }
      const i = brInterpolate824(BR_WAV_SINE, phase), q = brInterpolate824(BR_WAV_SINE, (phase + (1 << 30)) >>> 0);
      buffer[k] = brS16((BR_CONSTELLATION_Q[dataByte & 3] * q >> 15) + (BR_CONSTELLATION_I[dataByte & 3] * i >> 15));
    }
    this.phase = phase;
    st.symbolPhase = symbolPhase; st.dataByte = dataByte;
  }

  // the module's easter egg: a message in Morse, through noise
  renderQuestionMark(sync, buffer, size) {
    const st = this.state.clk;
    if (this.strikeFlag) {
      st.rngState = 0; st.cyclePhase = 0; st.sample = 10; st.cyclePhaseIncrement = 0xffffffff; st.seed = 32767;
      this.strikeFlag = false;
    }
    let phase = this.phase;
    const inc = this.phaseIncrement;
    const ditDuration = (3600 + ((32767 - this.parameter[0]) >> 2)) >>> 0;
    const noiseThreshold = 1024 + (this.parameter[1] >> 3);
    for (let k = 0; k < size; k++) {
      phase = (phase + inc) >>> 0;
      let sample = st.rngState ? (brInterpolate824(BR_WAV_SINE, phase) * 3) >> 2 : 0;
      st.cyclePhase = (st.cyclePhase + 1) >>> 0;
      if (st.cyclePhase > ditDuration) {
        st.sample = brS16(st.sample - 1);
        if (st.sample === 0) {
          st.cyclePhaseIncrement = (st.cyclePhaseIncrement + 1) >>> 0;
          st.rngState = st.rngState ? 0 : 1;
          const address = st.cyclePhaseIncrement >>> 2, shift = (st.cyclePhaseIncrement & 0x3) << 1;
          st.sample = brS16((2 << ((BR_WT_CODE[address] >> shift) & 3)) - 1);
          if (st.sample === 15) { st.sample = 100; st.rngState = 0; st.cyclePhaseIncrement = 0xffffffff; }
          phase = 1 << 30;
        }
        st.cyclePhase = 0;
      }
      st.seed = (st.seed + (brRandomSample() >> 2)) | 0;
      let intensity = st.seed >> 8;
      if (intensity < 0) intensity = -intensity;
      if (intensity < noiseThreshold) intensity = noiseThreshold;
      if (intensity > 16000) intensity = 16000;
      let noise = brRandomSample() * intensity >> 15;
      noise = noise * BR_WAV_SINE[(phase >>> 22) & 0xff] >> 15;
      sample = brClip(sample + noise);
      const distorted = sample * sample >> 14;
      sample = brClip(sample + (distorted * this.parameter[1] >> 15));
      buffer[k] = sample;
    }
    this.phase = phase;
  }

  renderFm(sync, buffer, size) {
    let mPhase = this.state.modulatorPhase;
    const mInc = this.computePhaseIncrement((12 << 7) + this.pitch + ((this.parameter[1] - 16384) >> 1)) >>> 1;
    const start = this.previousParameter[0], delta = this.parameter[0] - start, step = (32767 / size) | 0;
    let x = 0;
    for (let k = 0; k < size; k++) {
      x += step;
      const p0 = start + (delta * x >> 15);
      this.phase = (this.phase + this.phaseIncrement) >>> 0;
      if (sync[k]) { this.phase = 0; mPhase = 0; }
      mPhase = (mPhase + mInc) >>> 0;
      const pm = ((brInterpolate824(BR_WAV_SINE, mPhase) * p0) << 2) >>> 0;
      buffer[k] = brInterpolate824(BR_WAV_SINE, (this.phase + pm) >>> 0);
    }
    this.previousParameter[0] = this.parameter[0];
    this.state.modulatorPhase = mPhase;
  }

  renderFeedbackFm(sync, buffer, size) {
    const st = this.state.ffm;
    let previous = st.previousSample, mPhase = st.modulatorPhase;
    let attenuation = this.pitch - (72 << 7) + ((this.parameter[1] - 16384) >> 1);
    attenuation = 32767 - attenuation * 4;
    if (attenuation < 0) attenuation = 0;
    if (attenuation > 32767) attenuation = 32767;
    const mInc = this.computePhaseIncrement((12 << 7) + this.pitch + ((this.parameter[1] - 16384) >> 1)) >>> 1;
    const start = this.previousParameter[0], delta = this.parameter[0] - start, step = (32767 / size) | 0;
    let x = 0;
    for (let k = 0; k < size; k++) {
      x += step;
      const p0 = start + (delta * x >> 15);
      this.phase = (this.phase + this.phaseIncrement) >>> 0;
      if (sync[k]) { this.phase = 0; mPhase = 0; }
      mPhase = (mPhase + mInc) >>> 0;
      const p = (p0 * attenuation) >> 15;
      let pm = previous << 14;
      pm = (brInterpolate824(BR_WAV_SINE, (mPhase + pm) >>> 0) * p) << 1;
      previous = brInterpolate824(BR_WAV_SINE, (this.phase + pm) >>> 0);
      buffer[k] = previous;
    }
    this.previousParameter[0] = this.parameter[0];
    st.previousSample = previous; st.modulatorPhase = mPhase;
  }

  renderChaoticFeedbackFm(sync, buffer, size) {
    const st = this.state.ffm;
    const mInc = this.computePhaseIncrement((12 << 7) + this.pitch + ((this.parameter[1] - 16384) >> 1)) >>> 1;
    let previous = st.previousSample, mPhase = st.modulatorPhase;
    const start = this.previousParameter[0], delta = this.parameter[0] - start, step = (32767 / size) | 0;
    let x = 0;
    for (let k = 0; k < size; k++) {
      x += step;
      const p0 = start + (delta * x >> 15);
      this.phase = (this.phase + this.phaseIncrement) >>> 0;
      if (sync[k]) { this.phase = 0; mPhase = 0; }
      const pm = (brInterpolate824(BR_WAV_SINE, mPhase) * p0) << 1;
      previous = brInterpolate824(BR_WAV_SINE, (this.phase + pm) >>> 0);
      buffer[k] = previous;
      mPhase = (mPhase + Math.imul(mInc >>> 8, 129 + (previous >> 9))) >>> 0;
    }
    this.previousParameter[0] = this.parameter[0];
    st.previousSample = previous; st.modulatorPhase = mPhase;
  }
}

// ---- the macro oscillator: the module's models, in its order (MacroOscillatorShape)
const BR_SEMI = 128;
const BR_INTERVALS = Int16Array.from([
  -24 * BR_SEMI, -24 * BR_SEMI, -24 * BR_SEMI + 4,
  -23 * BR_SEMI, -22 * BR_SEMI, -21 * BR_SEMI, -20 * BR_SEMI, -19 * BR_SEMI, -18 * BR_SEMI,
  -17 * BR_SEMI - 4, -17 * BR_SEMI,
  -16 * BR_SEMI, -15 * BR_SEMI, -14 * BR_SEMI, -13 * BR_SEMI,
  -12 * BR_SEMI - 4, -12 * BR_SEMI,
  -11 * BR_SEMI, -10 * BR_SEMI, -9 * BR_SEMI, -8 * BR_SEMI,
  -7 * BR_SEMI - 4, -7 * BR_SEMI,
  -6 * BR_SEMI, -5 * BR_SEMI, -4 * BR_SEMI, -3 * BR_SEMI, -2 * BR_SEMI, -1 * BR_SEMI,
  -24, -8, -4, 0, 4, 8, 24,
  1 * BR_SEMI, 2 * BR_SEMI, 3 * BR_SEMI, 4 * BR_SEMI, 5 * BR_SEMI, 6 * BR_SEMI,
  7 * BR_SEMI, 7 * BR_SEMI + 4,
  8 * BR_SEMI, 9 * BR_SEMI, 10 * BR_SEMI, 11 * BR_SEMI,
  12 * BR_SEMI, 12 * BR_SEMI + 4,
  13 * BR_SEMI, 14 * BR_SEMI, 15 * BR_SEMI, 16 * BR_SEMI,
  17 * BR_SEMI, 17 * BR_SEMI + 4,
  18 * BR_SEMI, 19 * BR_SEMI, 20 * BR_SEMI, 21 * BR_SEMI, 22 * BR_SEMI, 23 * BR_SEMI,
  24 * BR_SEMI - 4, 24 * BR_SEMI, 24 * BR_SEMI,
]);
const BR_SHAPE_CSAW = 0, BR_SHAPE_MORPH = 1, BR_SHAPE_SAW_SQUARE = 2, BR_SHAPE_SINE_TRIANGLE = 3, BR_SHAPE_BUZZ = 4,
  BR_SHAPE_SQUARE_SUB = 5, BR_SHAPE_SAW_SUB = 6, BR_SHAPE_SQUARE_SYNC = 7, BR_SHAPE_SAW_SYNC = 8,
  BR_SHAPE_TRIPLE_SAW = 9, BR_SHAPE_TRIPLE_SQUARE = 10, BR_SHAPE_TRIPLE_TRIANGLE = 11, BR_SHAPE_TRIPLE_SINE = 12,
  BR_SHAPE_TRIPLE_RING_MOD = 13, BR_SHAPE_SAW_COMB = 15;
/** The module's models: all of them, the easter egg last. */
const BR_MODELS = 48;
const BR_BLOCK = 24;

class BrMacroOscillator {
  constructor() {
    this.analog = [new BrAnalogOscillator(), new BrAnalogOscillator(), new BrAnalogOscillator()];
    this.digital = new BrDigitalOscillator();
    this.parameter = [0, 0];
    this.previousParameter = [0, 0];
    this.pitch = 0;
    this.shape = 0;
    this.lpState = 0;
    this.syncBuffer = new Uint8Array(BR_BLOCK);
    this.tempBuffer = new Int16Array(BR_BLOCK);
  }
  init() {
    for (const a of this.analog) a.init();
    this.digital.init();
    this.lpState = 0;
    this.previousParameter[0] = 0; this.previousParameter[1] = 0;
  }
  setShape(shape) { if (shape !== this.shape) this.strike(); this.shape = shape; }
  setPitch(pitch) { this.pitch = brS16(pitch); }
  setParameters(p0, p1) { this.parameter[0] = brS16(p0); this.parameter[1] = brS16(p1); }
  strike() { this.digital.strike(); }

  render(sync, buffer, size) {
    switch (this.shape) {
      case BR_SHAPE_CSAW: this.renderCSaw(sync, buffer, size); break;
      case BR_SHAPE_MORPH: this.renderMorph(sync, buffer, size); break;
      case BR_SHAPE_SAW_SQUARE: this.renderSawSquare(sync, buffer, size); break;
      case BR_SHAPE_SINE_TRIANGLE: this.renderSineTriangle(sync, buffer, size); break;
      case BR_SHAPE_BUZZ: this.renderBuzz(sync, buffer, size); break;
      case BR_SHAPE_SQUARE_SUB: case BR_SHAPE_SAW_SUB: this.renderSub(sync, buffer, size); break;
      case BR_SHAPE_SQUARE_SYNC: case BR_SHAPE_SAW_SYNC: this.renderDualSync(sync, buffer, size); break;
      case BR_SHAPE_TRIPLE_SAW: case BR_SHAPE_TRIPLE_SQUARE: case BR_SHAPE_TRIPLE_TRIANGLE: case BR_SHAPE_TRIPLE_SINE:
        this.renderTriple(sync, buffer, size); break;
      case BR_SHAPE_SAW_COMB: this.renderSawComb(sync, buffer, size); break;
      default:
        if (this.shape < BR_MODELS) this.renderDigital(sync, buffer, size); else buffer.fill(0, 0, size);
    }
  }

  renderDigital(sync, buffer, size) {
    const d = this.digital;
    d.setParameters(this.parameter[0], this.parameter[1]);
    d.setPitch(this.pitch);
    d.shape = this.shape - BR_SHAPE_TRIPLE_RING_MOD;
    d.render(sync, buffer, size);
  }

  renderSawComb(sync, buffer, size) {
    const a = this.analog[0];
    a.parameter = 0; a.pitch = this.pitch; a.shape = BR_OSC_SAW;
    a.render(sync, buffer, null, size);
    const d = this.digital;
    d.setParameters(this.parameter[0], this.parameter[1]);
    d.setPitch(this.pitch);
    d.shape = BR_D_COMB_FILTER;
    d.render(sync, buffer, size);
  }

  renderCSaw(sync, buffer, size) {
    const a = this.analog[0];
    a.pitch = this.pitch; a.shape = BR_OSC_CSAW; a.parameter = this.parameter[0]; a.auxParameter = this.parameter[1];
    a.render(sync, buffer, null, size);
    const shift = brS16(-(this.parameter[1] - 32767) >> 4);
    for (let k = 0; k < size; k++) buffer[k] = brS16(((buffer[k] + shift) * 13) >> 3);
  }

  renderMorph(sync, buffer, size) {
    const [a0, a1] = this.analog, p0 = this.parameter[0], p1 = this.parameter[1];
    a0.pitch = this.pitch; a1.pitch = this.pitch;
    let balance;
    if (p0 <= 10922) {
      a0.parameter = 0; a1.parameter = 0; a0.shape = BR_OSC_TRIANGLE; a1.shape = BR_OSC_SAW;
      balance = brU16(p0 * 6);
    } else if (p0 <= 21845) {
      a0.parameter = 0; a1.parameter = 0; a0.shape = BR_OSC_SQUARE; a1.shape = BR_OSC_SAW;
      balance = brU16(65535 - (p0 - 10923) * 6);
    } else {
      a0.parameter = brS16((p0 - 21846) * 3); a1.parameter = 0; a0.shape = BR_OSC_SQUARE; a1.shape = BR_OSC_SINE;
      balance = 0;
    }
    const shape2 = this.tempBuffer;
    a0.render(sync, buffer, null, size);
    a1.render(sync, shape2, null, size);
    let lpCutoff = this.pitch - (p1 >> 1) + 128 * 128;
    if (lpCutoff < 0) lpCutoff = 0; else if (lpCutoff > 32767) lpCutoff = 32767;
    const f = brInterpolate824U(BR_LUT_SVF_CUTOFF, (lpCutoff * 131072) >>> 0);
    let lpState = this.lpState;
    let fuzzAmount = p1 << 1;
    if (this.pitch > (80 << 7)) {
      fuzzAmount -= (this.pitch - (80 << 7)) << 4;
      if (fuzzAmount < 0) fuzzAmount = 0;
    }
    for (let k = 0; k < size; k++) {
      const sample = brS16(brMix(buffer[k], shape2[k], balance));
      lpState += (sample - lpState) * f >> 15;
      lpState = brClip(lpState);
      const fuzzed = brS16(brInterpolate88(BR_WS_VIOLENT_OVERDRIVE, lpState + 32768));
      buffer[k] = brS16(brMix(sample, fuzzed, fuzzAmount));
    }
    this.lpState = lpState;
  }

  renderSawSquare(sync, buffer, size) {
    const [a0, a1] = this.analog;
    a0.parameter = this.parameter[0]; a1.parameter = this.parameter[0];
    a0.pitch = this.pitch; a1.pitch = this.pitch;
    a0.shape = BR_OSC_VARIABLE_SAW; a1.shape = BR_OSC_SQUARE;
    const square = this.tempBuffer;
    a0.render(sync, buffer, null, size);
    a1.render(sync, square, null, size);
    const start = this.previousParameter[1], delta = this.parameter[1] - start, step = (32767 / size) | 0;
    let x = 0;
    for (let k = 0; k < size; k++) {
      x += step;
      const p1 = start + (delta * x >> 15);
      const balance = brU16(p1 << 1);
      const attenuatedSquare = brS16((square[k] * 148) >> 8);
      buffer[k] = brS16(brMix(buffer[k], attenuatedSquare, balance));
    }
    this.previousParameter[1] = this.parameter[1];
  }

  renderTriple(sync, buffer, size) {
    const base = this.shape === BR_SHAPE_TRIPLE_SAW ? BR_OSC_SAW : this.shape === BR_SHAPE_TRIPLE_TRIANGLE ? BR_OSC_TRIANGLE
      : this.shape === BR_SHAPE_TRIPLE_SQUARE ? BR_OSC_SQUARE : BR_OSC_SINE;
    const a = this.analog;
    a[0].parameter = 0; a[1].parameter = 0; a[2].parameter = 0;
    a[0].pitch = this.pitch;
    for (let i = 0; i < 2; i++) {
      const p = this.parameter[i];
      const d1 = BR_INTERVALS[p >> 9], d2 = BR_INTERVALS[((p >> 8) + 1) >> 1];
      const xfade = brU16(p << 8);
      const detune = brS16(d1 + ((d2 - d1) * xfade >> 16));
      a[i + 1].pitch = brS16(this.pitch + detune);
    }
    a[0].shape = base; a[1].shape = base; a[2].shape = base;
    buffer.fill(0, 0, size);
    const temp = this.tempBuffer;
    for (let i = 0; i < 3; i++) {
      a[i].render(sync, temp, null, size);
      for (let k = 0; k < size; k++) buffer[k] = brS16(buffer[k] + (temp[k] * 21 >> 6));
    }
  }

  renderSub(sync, buffer, size) {
    const [a0, a1] = this.analog;
    a0.parameter = this.parameter[0];
    a0.shape = this.shape === BR_SHAPE_SQUARE_SUB ? BR_OSC_SQUARE : BR_OSC_VARIABLE_SAW;
    a0.pitch = this.pitch;
    a1.parameter = 0; a1.shape = BR_OSC_SQUARE;
    const octave = this.parameter[1] < 16384 ? (24 << 7) : (12 << 7);
    a1.pitch = brS16(this.pitch - octave);
    a0.render(sync, buffer, null, size);
    a1.render(sync, this.tempBuffer, null, size);
    const start = this.previousParameter[1], delta = this.parameter[1] - start, step = (32767 / size) | 0;
    let x = 0;
    for (let k = 0; k < size; k++) {
      x += step;
      const p1 = start + (delta * x >> 15);
      const subGain = brU16((p1 < 16384 ? 16383 - p1 : p1 - 16384) << 1);
      buffer[k] = brS16(brMix(buffer[k], this.tempBuffer[k], subGain));
    }
    this.previousParameter[1] = this.parameter[1];
  }

  renderDualSync(sync, buffer, size) {
    const [a0, a1] = this.analog;
    const base = this.shape === BR_SHAPE_SQUARE_SYNC ? BR_OSC_SQUARE : BR_OSC_SAW;
    a0.parameter = 0; a0.shape = base; a0.pitch = this.pitch;
    a1.parameter = 0; a1.shape = base; a1.pitch = brS16(this.pitch + (this.parameter[0] >> 2));
    a0.render(sync, buffer, this.syncBuffer, size);
    a1.render(this.syncBuffer, this.tempBuffer, null, size);
    const start = this.previousParameter[1], delta = this.parameter[1] - start, step = (32767 / size) | 0;
    let x = 0;
    for (let k = 0; k < size; k++) {
      x += step;
      const p1 = start + (delta * x >> 15);
      const balance = brU16(p1 << 1);
      buffer[k] = brS16((brS16(brMix(buffer[k], this.tempBuffer[k], balance)) >> 2) * 3);
    }
    this.previousParameter[1] = this.parameter[1];
  }

  renderSineTriangle(sync, buffer, size) {
    let attSine = 32767 - 6 * (this.pitch - (92 << 7));
    let attTri = 32767 - 7 * (this.pitch - (80 << 7));
    if (attTri < 0) attTri = 0;
    if (attSine < 0) attSine = 0;
    if (attTri > 32767) attTri = 32767;
    if (attSine > 32767) attSine = 32767;
    const timbre = this.parameter[0];
    const [a0, a1] = this.analog;
    a0.parameter = brS16(timbre * attSine >> 15);
    a1.parameter = brS16(timbre * attTri >> 15);
    a0.pitch = this.pitch; a1.pitch = this.pitch;
    a0.shape = BR_OSC_SINE_FOLD; a1.shape = BR_OSC_TRIANGLE_FOLD;
    a0.render(sync, buffer, null, size);
    a1.render(sync, this.tempBuffer, null, size);
    const start = this.previousParameter[1], delta = this.parameter[1] - start, step = (32767 / size) | 0;
    let x = 0;
    for (let k = 0; k < size; k++) {
      x += step;
      const p1 = start + (delta * x >> 15);
      buffer[k] = brS16(brMix(buffer[k], this.tempBuffer[k], brU16(p1 << 1)));
    }
    this.previousParameter[1] = this.parameter[1];
  }

  renderBuzz(sync, buffer, size) {
    const [a0, a1] = this.analog;
    a0.parameter = this.parameter[0]; a0.shape = BR_OSC_BUZZ; a0.pitch = this.pitch;
    a1.parameter = this.parameter[0]; a1.shape = BR_OSC_BUZZ; a1.pitch = brS16(this.pitch + (this.parameter[1] >> 8));
    a0.render(sync, buffer, null, size);
    a1.render(sync, this.tempBuffer, null, size);
    for (let k = 0; k < size; k++) buffer[k] = brS16((buffer[k] >> 1) + (this.tempBuffer[k] >> 1));
  }
}
`;
