export const SAMPLER_NAME = 'moa-60';

/**
 * The MOA-60's sample voices, as the source text of an audio worklet module (tests evaluate the same text to get
 * `SamplerCore`). No input, stereo out.
 *
 * - Sounds arrive once each (`sample`: an id, a rate and one or two channels) and pads point at them (`pad`: the
 *   sound, its start and end, tune, level, pan, envelope, filter, mute group and how velocity plays it).
 * - `hit` starts a voice on a pad (`over` changes the pad's settings for that hit), `release` lets go of it; both take `when`, an audio-clock time, so a sequencer can
 *   place them to the sample. A `hit` can instead take `delay`, seconds from when it arrives (the MOA-KIT's cymbals). 32 voices; a 33rd takes the oldest.
 * - A voice reads its sound at 2^(tune / 12) times its own rate, between samples by a cubic (Hermite) curve, forward
 *   or reversed, once or looping.
 * - Its envelope: an attack, then in "one shot" the whole sound (shortened by Decay if it is set below its maximum),
 *   or in "note on" for as long as the pad is held, then Decay. Decay is the time to fall by 60 dB.
 * - Pan: a mono sound is panned with equal power, a stereo one balanced (both sides whole at the centre).
 * - A mute group cuts the other pads in it (an open hi-hat cut by the closed one) with a 5 ms fade.
 * - A resonant low-pass per voice (a state-variable filter), which velocity can open; off at 20 kHz.
 */
export const SAMPLER_SOURCE = `
const SAMPLER_PARAMS = [['level', 0.8, 0, 2]];
const SAMPLER_VOICES = 32;
const SAMPLER_DECAY_OFF = 8; // a one-shot decay at this or longer plays the whole sound
const SAMPLER_CHOKE_SECONDS = 0.005;
const SAMPLER_LN1000 = Math.log(1000); // -60 dB

class SamplerCore {
  constructor(sampleRate) {
    this.sr = sampleRate;
    this.samples = new Map();
    this.pads = [];
    this.voices = [];
    this.queue = []; // { frame, type, pad, velocity } in time order
    this.frame = 0;
    this.age = 0;
  }

  addSample(id, rate, channels) { this.samples.set(id, { rate, channels, length: channels[0] ? channels[0].length : 0 }); }

  dropSample(id) {
    this.samples.delete(id);
    this.voices = this.voices.filter((v) => v.sample !== id);
  }

  setPad(i, p) { this.pads[i] = p; }

  /** Starts pad i at \`frame\` (an absolute frame; now if missing or past); \`over\` changes its settings for this hit. */
  hit(i, velocity, frame, over) { this.enqueue({ frame: frame === undefined ? this.frame : frame, type: 'hit', pad: i, velocity, over }); }
  release(i, frame) { this.enqueue({ frame: frame === undefined ? this.frame : frame, type: 'release', pad: i }); }
  stopAll() { this.queue = []; for (const v of this.voices) this.choke(v); }

  enqueue(e) {
    let i = this.queue.length;
    while (i > 0 && this.queue[i - 1].frame > e.frame) i--;
    this.queue.splice(i, 0, e);
  }

  choke(v) {
    v.stage = 'choke';
    v.decay = Math.exp(-1 / (SAMPLER_CHOKE_SECONDS / 6.9 * this.sr));
  }

  start(i, velocity, over) {
    const p = over && this.pads[i] ? Object.assign({}, this.pads[i], over) : this.pads[i];
    if (!p || !p.sample) return;
    const s = this.samples.get(p.sample);
    if (!s || !s.length) return;
    if (p.group) for (const v of this.voices) if (v.group === p.group && v.pad !== i && v.stage !== 'choke') this.choke(v);
    const start = Math.max(0, Math.min(s.length - 1, Math.floor(p.start || 0)));
    const end = Math.max(start + 1, Math.min(s.length, Math.floor(p.end || s.length)));
    const step = Math.pow(2, (p.tune || 0) / 12) * s.rate / this.sr;
    const vel = Math.max(0, Math.min(1, velocity));
    const velLevel = p.velLevel === undefined ? 1 : p.velLevel;
    const amp = (p.level === undefined ? 1 : p.level) * (1 - velLevel + velLevel * Math.pow(vel, 1.5));
    const pan = Math.max(-1, Math.min(1, p.pan || 0));
    const cutoff = (p.cutoff || 20000) * Math.pow(2, (p.velFilter || 0) * (vel - 1) * 4);
    const v = {
      pad: i, sample: p.sample, group: p.group || 0, s, start, end, loop: !!p.loop,
      pos: p.reverse ? end - 1 : start, step: p.reverse ? -step : step,
      amp,
      // a mono sound is panned with equal power; a stereo one is balanced (its centre keeps both sides whole)
      gl: s.channels.length > 1 ? Math.min(1, 1 - pan) : Math.cos((pan + 1) * Math.PI / 4),
      gr: s.channels.length > 1 ? Math.min(1, 1 + pan) : Math.sin((pan + 1) * Math.PI / 4),
      env: 0, stage: 'attack',
      attackInc: p.attack > 0 ? 1 / (p.attack * this.sr) : 1,
      noteOn: p.mode === 'noteon',
      decay: Math.exp(-SAMPLER_LN1000 / (Math.max(0.005, p.decay || SAMPLER_DECAY_OFF) * this.sr)),
      holds: p.mode === 'noteon' || !(p.decay < SAMPLER_DECAY_OFF),
      filtered: cutoff < 19000,
      g: Math.tan(Math.PI * Math.min(cutoff, this.sr * 0.45) / this.sr), k: 2 - 1.9 * Math.max(0, Math.min(1, p.reso || 0)),
      f: [0, 0, 0, 0], age: this.age++,
    };
    if (this.voices.length >= SAMPLER_VOICES) {
      let oldest = 0;
      for (let j = 1; j < this.voices.length; j++) if (this.voices[j].age < this.voices[oldest].age) oldest = j;
      this.voices.splice(oldest, 1);
    }
    this.voices.push(v);
  }

  stop(i) {
    for (const v of this.voices) if (v.pad === i && v.noteOn && (v.stage === 'attack' || v.stage === 'hold')) {
      v.stage = 'decay';
      v.holds = false;
    }
  }

  /** One sample of channel c at position x, by a cubic through the four samples around it. */
  read(data, x, v) {
    const i = Math.floor(x), t = x - i;
    const at = (n) => (n < v.start || n >= v.end ? 0 : data[n]);
    const y0 = at(i - 1), y1 = at(i), y2 = at(i + 1), y3 = at(i + 2);
    const c1 = 0.5 * (y2 - y0), c2 = y0 - 2.5 * y1 + 2 * y2 - 0.5 * y3, c3 = 0.5 * (y3 - y0) + 1.5 * (y1 - y2);
    return ((c3 * t + c2) * t + c1) * t + y1;
  }

  render(L, R, from, to, level) {
    for (let n = this.voices.length - 1; n >= 0; n--) {
      const v = this.voices[n];
      const ch = v.s.channels, left = ch[0], right = ch[1] || ch[0];
      let done = false;
      for (let j = from; j < to; j++) {
        if (v.stage === 'attack') {
          v.env += v.attackInc;
          if (v.env >= 1) { v.env = 1; v.stage = v.holds ? 'hold' : 'decay'; }
        } else if (v.stage === 'decay' || v.stage === 'choke') {
          v.env *= v.decay;
          if (v.env < 1e-4) { done = true; break; }
        }
        let a = this.read(left, v.pos, v), b = right === left ? a : this.read(right, v.pos, v);
        if (v.filtered) {
          // two state-variable low-passes (trapezoidal), one per channel
          const g = v.g, k = v.k, h = 1 / (1 + g * (g + k)), f = v.f;
          let v1 = (f[0] + g * (a - f[1])) * h, v2 = f[1] + g * v1;
          f[0] = 2 * v1 - f[0]; f[1] = 2 * v2 - f[1]; a = v2;
          v1 = (f[2] + g * (b - f[3])) * h; v2 = f[3] + g * v1;
          f[2] = 2 * v1 - f[2]; f[3] = 2 * v2 - f[3]; b = v2;
        }
        const e = v.env * v.amp * level;
        L[j] += a * e * v.gl;
        R[j] += b * e * v.gr;
        v.pos += v.step;
        if (v.step > 0 ? v.pos >= v.end : v.pos < v.start) {
          if (v.loop) v.pos += v.step > 0 ? v.start - v.end : v.end - v.start;
          else { done = true; break; }
        }
      }
      if (done) this.voices.splice(n, 1);
    }
  }

  /** Renders \`len\` frames into L and R (cleared first), starting the queued hits and releases on their frames. */
  process(L, R, len, level) {
    L.fill(0); R.fill(0);
    const end = this.frame + len;
    let at = 0;
    while (this.queue.length && this.queue[0].frame < end) {
      const e = this.queue.shift();
      const j = Math.max(0, e.frame - this.frame);
      if (j > at) { this.render(L, R, at, j, level); at = j; }
      if (e.type === 'hit') this.start(e.pad, e.velocity, e.over);
      else this.stop(e.pad);
    }
    if (at < len) this.render(L, R, at, len, level);
    this.frame = end;
  }

  /** What is playing: [pad, position 0..1 through its sound, envelope] per voice. */
  view() {
    return this.voices.map((v) => [v.pad, (v.pos - v.start) / Math.max(1, v.end - v.start), v.env]);
  }
}

if (typeof registerProcessor === 'function') {
  class Moa60 extends AudioWorkletProcessor {
    static get parameterDescriptors() {
      return SAMPLER_PARAMS.map((d) => ({ name: d[0], defaultValue: d[1], minValue: d[2], maxValue: d[3], automationRate: 'k-rate' }));
    }
    constructor() {
      super();
      this.core = new SamplerCore(sampleRate);
      this.core.frame = currentFrame;
      this.since = 0;
      const frameOf = (when) => (when === undefined ? undefined : Math.round(when * sampleRate));
      this.port.onmessage = (e) => {
        const m = e.data;
        if (!m) return;
        if (m.type === 'sample') this.core.addSample(m.id, m.rate, m.channels);
        else if (m.type === 'drop') this.core.dropSample(m.id);
        else if (m.type === 'pad') this.core.setPad(m.pad, m.settings);
        else if (m.type === 'hit') this.core.hit(m.pad, m.velocity, m.when === undefined && m.delay > 0 ? currentFrame + Math.round(m.delay * sampleRate) : frameOf(m.when), m.over);
        else if (m.type === 'release') this.core.release(m.pad, frameOf(m.when));
        else if (m.type === 'stopAll') this.core.stopAll();
      };
      this.port.postMessage({ type: 'ready' }); // the device sends its sounds and pads when it hears this
    }
    process(inputs, outputs, params) {
      const out = outputs[0];
      this.core.frame = currentFrame;
      this.core.process(out[0], out[1], out[0].length, params.level[0]);
      this.since += out[0].length;
      if (this.since >= sampleRate / 30) {
        this.since = 0;
        this.port.postMessage({ type: 'view', voices: this.core.view() });
      }
      return true;
    }
  }
  registerProcessor('${SAMPLER_NAME}', Moa60);
}
`;
