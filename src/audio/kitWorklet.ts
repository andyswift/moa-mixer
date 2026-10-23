export const DRUM_NAME = 'moa-drum';

/**
 * One piece of the MOA-KIT (a drum or a cymbal) as a bank of modes, as the source text of an audio worklet module
 * (tests evaluate the same text to get `DrumCore`). No input, mono out. The physics (each mode's frequency, losses,
 * how a strike excites it and what a microphone hears of it) is worked out in `drumPhysics.ts` and sent here; this
 * only runs it.
 *
 * - Each mode is a damped phasor z (its complex displacement, m): every sample z *= r e^(i w / sr). A strike gives
 *   each mode a velocity v, so z gains -i v / w (it starts from rest and moves).
 * - The microphone hears sum mic[k] Re(z[k]) (the weights carry the acceleration and how well the mode radiates).
 * - Tension modulation: a big vibration stretches the head and raises every frequency by sqrt(1 + stretch * strain).
 * - The stick's own click: the contact force (a half-sine of the contact time) radiates directly; its derivative is
 *   added, so a hard, short contact clicks brighter.
 * - Snare wires (`wires`): they ride on the bottom head and leave it when the head accelerates faster than they can
 *   follow; while they are off they slap back and buzz. The head's acceleration where they lie is sensed from the
 *   modes, and its excess over the wires' threshold gates band-passed noise.
 * - Cymbal cascade (`cascade`): a cymbal hit hard couples its modes (its bending stretches it, as with the head's
 *   tension), so energy flows up from the low modes to the high ones, band by band (wave turbulence): the swell after
 *   a crash, brightening as it goes. The modes are grouped in octave bands; each block, a share of each band's energy
 *   moves to the band above, rate * (E / ref)^1.5 of it a second, ref the energy of moving as far as the plate is thick
 *   at that band's frequency. So the coupling only bites once the plate moves about its own thickness, and a soft hit's
 *   energy stays low (dark) while a hard one's climbs to the top. Bands are handed on from the top down, one step a
 *   block; what moves is taken from one band and spread over the next with random phases, so energy is kept. Above the highest mode the modes are too dense to keep apart, so `band` adds noise above it
 *   that follows the top modes' level.
 * - `damp` adds damping to every mode while it is on (hi-hats closed against each other, a hand choking a crash),
 *   with `contact` noise for plates touching (the hi-hat's chick and its sizzle half-open).
 */
export const KIT_SOURCE = `
const DRUM_PARAMS = [['level', 1, 0, 4]];

class DrumCore {
  constructor(sampleRate) {
    this.sr = sampleRate;
    this.n = 0;
    this.re = new Float64Array(0); this.im = new Float64Array(0);
    this.omega = new Float64Array(0); this.sigma = new Float64Array(0); this.mic = new Float64Array(0);
    this.strainK = new Float64Array(0); this.wireW = new Float64Array(0); this.dampK = new Float64Array(0);
    this.stretch = 0; this.pitchScale = 1;
    this.wires = null; this.cascade = null; this.band = null;
    this.damping = 0; this.contactLevel = 0;
    this.click = []; this.clickAt = 0; this.lastClick = 0;
    this.burst = 0; this.burstDecay = 0;
    this.rattle = 0; this.bandEnv = 0;
    this.seed = 22222;
    this.bp = [0, 0, 0, 0, 0, 0, 0, 0]; // two biquads: the wires' band, or the cymbal's top band
    this.quiet = true;
  }

  rand() {
    this.seed = (this.seed * 1664525 + 1013904223) >>> 0;
    return this.seed / 2147483648 - 1;
  }

  configure(m) {
    const n = m.hz.length;
    const grow = (a) => { const b = new Float64Array(n); b.set(a.subarray(0, Math.min(n, a.length))); return b; };
    this.re = grow(this.re); this.im = grow(this.im);
    this.omega = Float64Array.from(m.hz, (f) => 2 * Math.PI * f);
    this.sigma = Float64Array.from(m.sigma);
    this.mic = Float64Array.from(m.mic);
    this.strainK = m.strainK ? Float64Array.from(m.strainK) : new Float64Array(n);
    this.dampK = m.dampK ? Float64Array.from(m.dampK) : new Float64Array(n).fill(1);
    this.stretch = m.stretch || 0;
    this.wires = m.wires || null;
    this.wireW = m.wires ? Float64Array.from(m.wires.weights) : new Float64Array(n);
    this.cascade = m.cascade || null;
    this.band = m.band || null;
    this.n = n;
    if (m.damp) this.setDamp(m.damp.sigma, m.damp.contact);
    this.setFilter();
  }

  /** The band-pass for the wires (or the high-pass for a cymbal's top): RBJ coefficients. */
  setFilter() {
    const f = this.wires ? this.wires.hz : this.band ? this.band.hz : 1000;
    const w0 = 2 * Math.PI * Math.min(f, 0.45 * this.sr) / this.sr, cw = Math.cos(w0), sw = Math.sin(w0);
    const q = this.wires ? 0.9 : 0.7071, alpha = sw / (2 * q), a0 = 1 + alpha;
    if (this.wires) this.co = [alpha / a0, 0, -alpha / a0, -2 * cw / a0, (1 - alpha) / a0];
    else this.co = [(1 + cw) / 2 / a0, -(1 + cw) / a0, (1 + cw) / 2 / a0, -2 * cw / a0, (1 - alpha) / a0];
  }

  /** A strike: each mode's velocity (m/s), the click's amplitude and contact time (s), and a burst of contact noise. */
  hit(v, click, tau, burst, burstDecay) {
    for (let k = 0; k < this.n; k++) {
      const dv = v[k] || 0;
      if (dv) this.im[k] -= dv / this.omega[k];
    }
    const len = Math.max(2, Math.round(tau * this.sr));
    this.click = new Float64Array(len + 1);
    for (let i = 0; i < len; i++) this.click[i] = click * Math.sin(Math.PI * i / len);
    this.clickAt = 0;
    if (burst) { this.burst = Math.max(this.burst, burst); this.burstDecay = Math.exp(-1 / Math.max(1e-4, burstDecay) / this.sr); }
    this.quiet = false;
  }

  /** Extra damping on every mode (s^-1), and the noise of plates touching while it is on. */
  setDamp(sigma, contact) { this.damping = sigma; this.contactLevel = contact || 0; }

  process(out, len, p) {
    const n = this.n, re = this.re, im = this.im, sr = this.sr;
    if (this.quiet && this.clickAt >= this.click.length && this.burst < 1e-6) { out.fill(0); return; }
    let strain = 0, energy = 0;
    for (let k = 0; k < n; k++) {
      const a2 = re[k] * re[k] + im[k] * im[k];
      strain += this.strainK[k] * a2;
      energy += a2 * this.mic[k] * this.mic[k];
    }
    const s = Math.sqrt(1 + Math.min(0.5, this.stretch * strain));
    this.pitchScale = s;
    // the cymbal's cascade: energy handed up band by band, from the top down so it climbs one band a block
    if (this.cascade) {
      const c = this.cascade, edges = c.edges;
      for (let b = edges.length - 3; b >= 0; b--) {
        const from = edges[b], to = edges[b + 1], end = Math.min(n, edges[b + 2]);
        if (to >= end) continue;
        let e = 0;
        for (let k = from; k < to; k++) { const w = this.omega[k]; e += (re[k] * re[k] + im[k] * im[k]) * w * w; }
        const share = Math.min(0.5, c.rate * Math.pow(e / c.refs[b], 1.5) * len / sr);
        if (share < 1e-9) continue;
        const keep = Math.sqrt(1 - share);
        for (let k = from; k < to; k++) { re[k] *= keep; im[k] *= keep; }
        const each = (share * e) / (end - to);
        for (let k = to; k < end; k++) {
          const amp = Math.sqrt(each) / this.omega[k], phase = Math.PI * this.rand();
          re[k] += amp * Math.cos(phase); im[k] += amp * Math.sin(phase);
        }
      }
    }
    if (!this.cr || this.cr.length !== n) { this.cr = new Float64Array(n); this.ci = new Float64Array(n); }
    const cr = this.cr, ci = this.ci, mic = this.mic, ww = this.wireW;
    for (let k = 0; k < n; k++) {
      const r = Math.exp(-(this.sigma[k] + this.damping * this.dampK[k]) / sr), w = this.omega[k] * s / sr;
      cr[k] = r * Math.cos(w); ci[k] = r * Math.sin(w);
    }
    const co = this.co, z = this.bp, wires = this.wires, band = this.band;
    // the top band follows the level of the highest modes
    let top = 0;
    if (band) { for (let k = Math.floor(n * 0.75); k < n; k++) top += (re[k] * re[k] + im[k] * im[k]) * mic[k] * mic[k]; top = Math.sqrt(top) * band.gain; }
    const att = Math.exp(-1 / (0.0007 * sr)), rel = Math.exp(-1 / (0.02 * sr));
    for (let i = 0; i < len; i++) {
      let y = 0, acc = 0;
      for (let k = 0; k < n; k++) {
        const x = re[k], q = im[k];
        re[k] = x * cr[k] - q * ci[k];
        im[k] = x * ci[k] + q * cr[k];
        y += mic[k] * re[k];
        if (wires) acc += ww[k] * re[k];
      }
      // the stick's click: the derivative of the contact force
      if (this.clickAt < this.click.length) {
        const c = this.click[this.clickAt++];
        y += (c - this.lastClick) * sr * 0.001;
        this.lastClick = c;
      } else this.lastClick = 0;
      let noise = 0;
      if (wires) {
        const over = Math.max(0, Math.abs(acc) - wires.threshold) / wires.threshold;
        this.rattle = over > this.rattle ? att * this.rattle + (1 - att) * over : rel * this.rattle;
        noise += this.rattle * wires.gain;
      }
      if (band) { this.bandEnv = 0.999 * this.bandEnv + 0.001 * top; noise += this.bandEnv; }
      if (this.contactLevel) noise += this.contactLevel * Math.min(1, Math.sqrt(energy) * 0.02);
      let filtered = 0;
      if (noise > 1e-7) {
        const x = this.rand() * noise;
        const b = co[0] * x + co[1] * z[0] + co[2] * z[1] - co[3] * z[2] - co[4] * z[3];
        z[1] = z[0]; z[0] = x; z[3] = z[2]; z[2] = b;
        filtered = b;
      }
      if (this.burst > 1e-6) { filtered += this.rand() * this.burst; this.burst *= this.burstDecay; }
      const o = (y + filtered) * p.level;
      out[i] = o > 3 ? 1 : o < -3 ? -1 : o * (27 + o * o) / (27 + 9 * o * o);
    }
    let alive = false;
    for (let k = 0; k < n; k++) {
      if (Math.abs(re[k]) < 1e-11 && Math.abs(im[k]) < 1e-11) { re[k] = 0; im[k] = 0; } else alive = true;
    }
    this.quiet = !alive && this.rattle < 1e-6 && this.bandEnv < 1e-7;
  }

  /** The modes' present amplitudes (m), for drawing the head. */
  amplitudes(count) {
    const a = new Float32Array(Math.min(count, this.n));
    for (let k = 0; k < a.length; k++) a[k] = Math.hypot(this.re[k], this.im[k]);
    return a;
  }
}

if (typeof registerProcessor === 'function') {
  class MoaDrum extends AudioWorkletProcessor {
    static get parameterDescriptors() {
      return DRUM_PARAMS.map((d) => ({ name: d[0], defaultValue: d[1], minValue: d[2], maxValue: d[3], automationRate: 'k-rate' }));
    }
    constructor(options) {
      super();
      this.core = new DrumCore(sampleRate);
      const cfg = options && options.processorOptions && options.processorOptions.config;
      if (cfg && cfg.hz) this.core.configure(cfg);
      this.p = {};
      this.since = 0;
      this.waiting = [];
      this.port.onmessage = (e) => {
        const m = e.data;
        if (!m) return;
        if (m.type === 'configure') this.core.configure(m);
        else if (m.type === 'hit' && m.delay > 0) this.waiting.push({ due: currentFrame + Math.round(m.delay * sampleRate), m });
        else if (m.type === 'hit') this.core.hit(m.v, m.click, m.tau, m.burst, m.burstDecay);
        else if (m.type === 'damp') this.core.setDamp(m.sigma, m.contact);
      };
    }
    process(inputs, outputs, params) {
      const out = outputs[0][0];
      if (this.waiting.length) {
        const end = currentFrame + out.length;
        for (const w of this.waiting) if (w.due < end) this.core.hit(w.m.v, w.m.click, w.m.tau, w.m.burst, w.m.burstDecay);
        this.waiting = this.waiting.filter((w) => w.due >= end);
      }
      this.p.level = params.level[0];
      this.core.process(out, out.length, this.p);
      this.since += out.length;
      if (this.since >= sampleRate / 30) {
        this.since = 0;
        this.port.postMessage({ amps: this.core.amplitudes(48), pitchScale: this.core.pitchScale });
      }
      return true;
    }
  }
  registerProcessor('${DRUM_NAME}', MoaDrum);
}
`;
