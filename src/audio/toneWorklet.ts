export const TONE_NAME = 'moa-tone';

/**
 * MOA-UNICORN's sound, as the source text of an audio worklet module (tests evaluate the same text to get
 * `ToneCore`). No input, mono out. One processor plays one of two roles (`role` in its options):
 *
 * - 'voices': eight voices in the spirit of a small Casio keyboard. Each is two simple digital waves (square, thin
 *   pulses, saw, triangle or sine; the bright ones band-limited with polyBLEP so high notes do not whistle), the
 *   second a few semitones off (an octave or a fifth) and mixed in, then an ADSR and a vibrato that starts after a
 *   moment, as a player's would. A ninth note takes the oldest voice.
 * - 'drums': the rhythm box: kick (a sine falling in pitch), snare (noise and a tone), hi-hat (bright noise), clap,
 *   wood block and cowbell, each a short envelope.
 *
 * Messages: 'preset' (the sound), 'on' and 'off' (notes), 'drum' (a hit), 'allOff'; each event can carry `when`, an
 * audio-clock time, so a rhythm or a tune is placed to the sample.
 */
export const TONE_SOURCE = `
const TONE_PARAMS = [['level', 0.7, 0, 2]];
const TONE_VOICES = 8;
const TONE_WAVES = ['square', 'pulse25', 'pulse12', 'saw', 'triangle', 'sine'];

function toneBlep(t, dt) {
  if (t < dt) { t /= dt; return t + t - t * t - 1; }
  if (t > 1 - dt) { t = (t - 1) / dt; return t * t + t + t + 1; }
  return 0;
}

/** One sample of a wave at phase p (0..1) moving dt a sample. */
function toneWave(wave, p, dt) {
  switch (wave) {
    case 'sine': return Math.sin(2 * Math.PI * p);
    case 'triangle': return 1 - 4 * Math.abs(p - 0.5);
    case 'saw': return 2 * p - 1 - toneBlep(p, dt);
    default: {
      const w = wave === 'pulse25' ? 0.25 : wave === 'pulse12' ? 0.125 : 0.5;
      let y = p < w ? 1 : -1;
      y += toneBlep(p, dt);
      let q = p - w; if (q < 0) q += 1;
      y -= toneBlep(q, dt);
      return y - (2 * w - 1); // no DC: a thin pulse sits around zero
    }
  }
}

const TONE_DEFAULT = { w1: 'square', w2: 'square', i2: 12, mix2: 0, a: 0.005, d: 0.3, s: 0.6, r: 0.2, vib: 0, vibRate: 5.5, vibDelay: 0.3, gain: 1 };

class ToneCore {
  constructor(sampleRate, role) {
    this.sr = sampleRate;
    this.role = role || 'voices';
    this.p = Object.assign({}, TONE_DEFAULT);
    this.voices = [];
    this.drums = [];
    this.queue = [];
    this.frame = 0;
    this.age = 0;
    this.seed = 22222;
  }

  setPreset(p) { this.p = Object.assign({}, TONE_DEFAULT, p); }

  enqueue(e) {
    if (e.frame === undefined) e.frame = this.frame;
    let i = this.queue.length;
    while (i > 0 && this.queue[i - 1].frame > e.frame) i--;
    this.queue.splice(i, 0, e);
  }

  noteOn(note, velocity, frame) { this.enqueue({ type: 'on', note, velocity, frame }); }
  noteOff(note, frame) { this.enqueue({ type: 'off', note, frame }); }
  drum(kind, velocity, frame) { this.enqueue({ type: 'drum', kind, velocity, frame }); }
  allOff() { this.queue = []; for (const v of this.voices) v.stage = 'release'; }

  start(note, velocity) {
    // the same key again restarts its voice; otherwise a free one, or the oldest
    let v = this.voices.find((x) => x.note === note);
    if (!v) {
      if (this.voices.length >= TONE_VOICES) {
        let o = 0;
        for (let j = 1; j < this.voices.length; j++) if (this.voices[j].age < this.voices[o].age) o = j;
        this.voices.splice(o, 1);
      }
      v = { note, p1: 0, p2: 0, env: 0, vibPhase: 0 };
      this.voices.push(v);
    }
    Object.assign(v, { velocity: Math.max(0, Math.min(1, velocity)), stage: 'attack', t: 0, age: this.age++, hz: 440 * Math.pow(2, (note - 69) / 12) });
  }

  stop(note) { for (const v of this.voices) if (v.note === note && v.stage !== 'release') v.stage = 'release'; }

  hit(kind, velocity) {
    if (this.drums.length > 16) this.drums.shift();
    this.drums.push({ kind, velocity: Math.max(0, Math.min(1, velocity)), t: 0, phase: 0, lp: 0, prev: 0 });
  }

  noise() { this.seed = (this.seed * 196314165 + 907633515) >>> 0; return this.seed / 2147483648 - 1; }

  renderVoices(out, from, to, level) {
    const p = this.p, sr = this.sr;
    const attack = 1 / Math.max(1, p.a * sr), decay = Math.exp(-1 / Math.max(1, (p.d / 4) * sr)), release = Math.exp(-1 / Math.max(1, (p.r / 4) * sr));
    const ratio2 = Math.pow(2, p.i2 / 12);
    for (let n = this.voices.length - 1; n >= 0; n--) {
      const v = this.voices[n];
      let done = false;
      for (let j = from; j < to; j++) {
        if (v.stage === 'attack') { v.env += attack; if (v.env >= 1) { v.env = 1; v.stage = 'decay'; } }
        else if (v.stage === 'decay') v.env = p.s + (v.env - p.s) * decay;
        else { v.env *= release; if (v.env < 1e-4) { done = true; break; } }
        v.t += 1 / sr;
        // the vibrato fades in after its delay
        const vibAmt = p.vib * Math.min(1, Math.max(0, (v.t - p.vibDelay) / 0.3));
        v.vibPhase += p.vibRate / sr;
        if (v.vibPhase >= 1) v.vibPhase -= 1;
        const hz = v.hz * Math.pow(2, (vibAmt * Math.sin(2 * Math.PI * v.vibPhase)) / 1200);
        const dt1 = Math.min(0.5, hz / sr), dt2 = Math.min(0.5, (hz * ratio2) / sr);
        const y = toneWave(p.w1, v.p1, dt1) * (1 - p.mix2) + toneWave(p.w2, v.p2, dt2) * p.mix2;
        v.p1 += dt1; if (v.p1 >= 1) v.p1 -= 1;
        v.p2 += dt2; if (v.p2 >= 1) v.p2 -= 1;
        out[j] += y * v.env * (0.35 + 0.65 * v.velocity) * p.gain * level * 0.3;
      }
      if (done) this.voices.splice(n, 1);
    }
  }

  renderDrums(out, from, to, level) {
    const sr = this.sr;
    for (let n = this.drums.length - 1; n >= 0; n--) {
      const d = this.drums[n];
      let done = false;
      for (let j = from; j < to; j++) {
        const t = d.t;
        let y = 0, len = 0.3;
        if (d.kind === 'kick') {
          len = 0.35;
          const hz = 50 + 110 * Math.exp(-t / 0.04);
          d.phase += hz / sr;
          y = Math.sin(2 * Math.PI * d.phase) * Math.exp(-t / 0.12) * 1.2;
        } else if (d.kind === 'snare') {
          len = 0.25;
          d.phase += 185 / sr;
          y = (this.noise() * 0.7 * Math.exp(-t / 0.06) + Math.sin(2 * Math.PI * d.phase) * 0.5 * Math.exp(-t / 0.03));
        } else if (d.kind === 'hat') {
          len = 0.08;
          const x = this.noise();
          y = (x - d.prev) * 0.35 * Math.exp(-t / 0.018); // a difference: only the top of the noise
          d.prev = x;
        } else if (d.kind === 'clap') {
          len = 0.25;
          // three quick bursts (the hands), then the room
          const bursts = t < 0.03 ? Math.exp(-(t % 0.01) / 0.003) : Math.exp(-(t - 0.03) / 0.07);
          d.lp += 0.5 * (this.noise() - d.lp);
          y = (this.noise() - d.lp) * 0.8 * bursts;
        } else if (d.kind === 'wood') {
          len = 0.06;
          d.phase += 1750 / sr;
          y = Math.sin(2 * Math.PI * d.phase) * 0.6 * Math.exp(-t / 0.012);
        } else if (d.kind === 'bell') {
          len = 0.3;
          d.phase += 800 / sr;
          const p2 = (d.phase * 540 / 800) % 1;
          y = ((d.phase % 1 < 0.5 ? 1 : -1) + (p2 < 0.5 ? 1 : -1)) * 0.18 * Math.exp(-t / 0.07);
        }
        out[j] += y * d.velocity * level * 0.35;
        d.t += 1 / sr;
        if (d.t > len) { done = true; break; }
      }
      if (done) this.drums.splice(n, 1);
    }
  }

  render(out, from, to, level) {
    if (this.role === 'drums') this.renderDrums(out, from, to, level);
    else this.renderVoices(out, from, to, level);
  }

  /** Renders \`len\` frames into out (cleared first), starting the queued events on their frames. */
  process(out, len, level) {
    out.fill(0);
    const end = this.frame + len;
    let at = 0;
    while (this.queue.length && this.queue[0].frame < end) {
      const e = this.queue.shift();
      const j = Math.max(0, e.frame - this.frame);
      if (j > at) { this.render(out, at, j, level); at = j; }
      if (e.type === 'on') this.start(e.note, e.velocity);
      else if (e.type === 'off') this.stop(e.note);
      else this.hit(e.kind, e.velocity);
    }
    if (at < len) this.render(out, at, len, level);
    this.frame = end;
  }
}

if (typeof registerProcessor === 'function') {
  class MoaTone extends AudioWorkletProcessor {
    static get parameterDescriptors() {
      return TONE_PARAMS.map((d) => ({ name: d[0], defaultValue: d[1], minValue: d[2], maxValue: d[3], automationRate: 'k-rate' }));
    }
    constructor(options) {
      super();
      const o = (options && options.processorOptions) || {};
      this.core = new ToneCore(sampleRate, o.role);
      if (o.preset) this.core.setPreset(o.preset);
      const frameOf = (when) => (when === undefined ? undefined : Math.round(when * sampleRate));
      this.port.onmessage = (e) => {
        const m = e.data;
        if (!m) return;
        if (m.type === 'preset') this.core.setPreset(m.preset);
        else if (m.type === 'on') this.core.noteOn(m.note, m.velocity, frameOf(m.when));
        else if (m.type === 'off') this.core.noteOff(m.note, frameOf(m.when));
        else if (m.type === 'drum') this.core.drum(m.kind, m.velocity, frameOf(m.when));
        else if (m.type === 'allOff') this.core.allOff();
      };
    }
    process(inputs, outputs, params) {
      const out = outputs[0][0];
      this.core.frame = currentFrame;
      this.core.process(out, out.length, params.level[0]);
      return true;
    }
  }
  registerProcessor('${TONE_NAME}', MoaTone);
}
`;
