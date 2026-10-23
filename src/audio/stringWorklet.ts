export const STRING_NAME = 'moa-string';

/**
 * One string as a bank of modes, as the source text of an audio worklet module (tests evaluate the same text to get
 * `StringCore`). No input, mono out. The physics (each mode's frequency, losses, how a pluck excites it and how the
 * pickup hears it) is worked out in `bassPhysics.ts` and sent here; this only runs it.
 *
 * - Each mode is a damped phasor z (its complex displacement, in metres): every sample z *= r e^(i w / sr). Turning
 *   the phasor rather than running a two-pole filter keeps the motion continuous when the fret or tension changes.
 * - A pluck adds each mode's starting displacement; the hand that plucks first grabs the string, taking out the
 *   modes that move where it touches (`grab`). A pluck can wait `delay` seconds (a strum reaches the strings one after
 *   another), to the start of the block it falls in; a mute drops plucks still waiting.
 * - Tension modulation: a large vibration stretches the string, which raises its tension (by E A times the strain)
 *   and every frequency with it: the slight sharpness at the start of a hard pluck that settles as it decays.
 *   Strain = sum over modes of (n pi / L)^2 |z|^2 / 8 (over a cycle); frequencies scale by sqrt(1 + (E A / T) strain).
 * - Damping beyond the string's own: a palm mute (always on while set) and the mute of a released note.
 * - The pickup hears each mode's velocity at its position (weights from the physics), then its own resonance:
 *   a resonant low-pass at `tone`.
 */
export const STRING_SOURCE = `
const STRING_PARAMS = [['level', 0.5, 0, 2], ['tone', 3500, 300, 12000]];

class StringCore {
  constructor(sampleRate) {
    this.sr = sampleRate;
    this.n = 0;
    this.omega = new Float64Array(0); this.sigma = new Float64Array(0); this.pick = new Float64Array(0);
    this.strainK = new Float64Array(0); this.palm = new Float64Array(0); this.mute = new Float64Array(0);
    this.re = new Float64Array(0); this.im = new Float64Array(0);
    this.stretch = 0;
    this.muted = false;
    this.pitchScale = 1;
    this.lp = [0, 0, 0, 0]; // pickup resonance biquad state
  }

  /** The string's modes: frequencies (Hz), decay rates (1/s), pickup weights, strain weights (n pi / L)^2 / 4. */
  configure(m) {
    const n = m.hz.length;
    const grow = (a) => { const b = new Float64Array(n); b.set(a.subarray(0, Math.min(n, a.length))); return b; };
    this.re = grow(this.re); this.im = grow(this.im); // modes keep their motion through a change of fret or tension
    this.omega = Float64Array.from(m.hz, (f) => 2 * Math.PI * f);
    this.sigma = Float64Array.from(m.sigma);
    this.pick = Float64Array.from(m.pickup);
    this.strainK = Float64Array.from(m.strainK);
    this.stretch = m.stretch;
    this.palm = m.palm ? Float64Array.from(m.palm) : new Float64Array(n);
    this.mute = m.mute ? Float64Array.from(m.mute) : new Float64Array(n);
    this.n = n;
  }

  /** A pluck: the hand grabs (each mode keeps grab[k] of itself), then lets go with these displacements (m). */
  pluck(amps, grab) {
    for (let k = 0; k < this.n; k++) {
      const g = grab ? grab[k] : 1;
      this.re[k] = this.re[k] * g + (amps[k] || 0);
      this.im[k] *= g;
    }
  }

  setMuted(on) { this.muted = !!on; }

  process(out, len, p) {
    const n = this.n, re = this.re, im = this.im, sr = this.sr;
    // tension modulation from the present motion
    let strain = 0;
    for (let k = 0; k < n; k++) strain += this.strainK[k] * (re[k] * re[k] + im[k] * im[k]);
    const s = Math.sqrt(1 + Math.min(0.5, this.stretch * strain));
    this.pitchScale = s;
    if (!this.cr || this.cr.length !== n) { this.cr = new Float64Array(n); this.ci = new Float64Array(n); this.vw = new Float64Array(n); }
    const cr = this.cr, ci = this.ci, vw = this.vw;
    for (let k = 0; k < n; k++) {
      const loss = this.sigma[k] + this.palm[k] + (this.muted ? this.mute[k] : 0);
      const r = Math.exp(-loss / sr);
      const w = this.omega[k] * s;
      cr[k] = r * Math.cos(w / sr);
      ci[k] = r * Math.sin(w / sr);
      vw[k] = -w * this.pick[k]; // velocity of Re(z) is -w Im(z)
    }
    // the pickup's resonance: an RBJ low-pass at the tone frequency, Q 1.4
    const w0 = 2 * Math.PI * Math.min(p.tone, 0.45 * sr) / sr, alpha = Math.sin(w0) / (2 * 1.4), cw = Math.cos(w0);
    const a0 = 1 + alpha, b0 = (1 - cw) / 2 / a0, b1 = (1 - cw) / a0, a1 = -2 * cw / a0, a2 = (1 - alpha) / a0;
    const z = this.lp;
    for (let i = 0; i < len; i++) {
      let v = 0;
      for (let k = 0; k < n; k++) {
        const x = re[k], y = im[k];
        re[k] = x * cr[k] - y * ci[k];
        im[k] = x * ci[k] + y * cr[k];
        v += vw[k] * im[k];
      }
      const y = b0 * v + b1 * z[0] + b0 * z[1] - a1 * z[2] - a2 * z[3];
      z[1] = z[0]; z[0] = v; z[3] = z[2]; z[2] = y;
      const o = y * 1.2 * p.level;
      out[i] = o > 3 ? 1 : o < -3 ? -1 : o * (27 + o * o) / (27 + 9 * o * o);
    }
    for (let k = 0; k < n; k++) if (Math.abs(re[k]) < 1e-12 && Math.abs(im[k]) < 1e-12) { re[k] = 0; im[k] = 0; }
  }

  /** The modes' present amplitudes (m), for drawing the string. */
  amplitudes(count) {
    const a = new Float32Array(Math.min(count, this.n));
    for (let k = 0; k < a.length; k++) a[k] = Math.hypot(this.re[k], this.im[k]);
    return a;
  }
}

if (typeof registerProcessor === 'function') {
  class MoaString extends AudioWorkletProcessor {
    static get parameterDescriptors() {
      return STRING_PARAMS.map((d) => ({ name: d[0], defaultValue: d[1], minValue: d[2], maxValue: d[3], automationRate: 'k-rate' }));
    }
    constructor(options) {
      super();
      this.core = new StringCore(sampleRate);
      const cfg = options && options.processorOptions && options.processorOptions.config;
      if (cfg && cfg.hz) this.core.configure(cfg); // the string as it was set up before audio started
      this.p = {};
      this.since = 0;
      this.waiting = [];
      this.port.onmessage = (e) => {
        const m = e.data;
        if (!m) return;
        if (m.type === 'configure') this.core.configure(m);
        else if (m.type === 'pluck' && m.delay > 0) this.waiting.push({ due: currentFrame + Math.round(m.delay * sampleRate), m });
        else if (m.type === 'pluck') this.core.pluck(m.amps, m.grab);
        else if (m.type === 'mute') {
          this.core.setMuted(m.on);
          if (m.on) this.waiting = [];
        }
      };
    }
    process(inputs, outputs, params) {
      const out = outputs[0][0];
      if (this.waiting.length) {
        const end = currentFrame + out.length;
        for (const w of this.waiting) if (w.due < end) { this.core.setMuted(false); this.core.pluck(w.m.amps, w.m.grab); }
        this.waiting = this.waiting.filter((w) => w.due >= end);
      }
      this.p.level = params.level[0];
      this.p.tone = params.tone[0];
      this.core.process(out, out.length, this.p);
      this.since += out.length;
      if (this.since >= sampleRate / 30) {
        this.since = 0;
        this.port.postMessage({ amps: this.core.amplitudes(48), pitchScale: this.core.pitchScale });
      }
      return true;
    }
  }
  registerProcessor('${STRING_NAME}', MoaString);
}
`;
