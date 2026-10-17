export const PCM_SEND = 'moa-pcm-send';
export const PCM_RECV = 'moa-pcm-recv';

/** Frames per message from the sender: about 10 ms at 48 kHz. */
export const PCM_CHUNK = 512;

/**
 * The PCM bus processors, as the source text of an audio worklet module (a string, like the other worklets, so the app
 * needs no extra build step; tests evaluate the same text to get `PcmRing`).
 *
 * PcmSend collects the input into chunks and posts them to the main thread, which relays them to other tabs.
 * PcmRing is the receiving side's jitter buffer: chunks come in on one clock (the sender's) and are played out on
 * another (this tab's), so it keeps a target fill, waits to prime before playing, plays silence and re-primes on an
 * underrun, drops audio if it grows far past the target, and nudges the playback speed by up to 1% to hold the fill
 * steady while the two clocks drift.
 */
export const PCM_SOURCE = `
class PcmRing {
  constructor(capacity, target) {
    this.cap = capacity;
    this.target = target;
    this.l = new Float32Array(capacity);
    this.r = new Float32Array(capacity);
    this.w = 0; // frames ever written
    this.pos = 0; // fractional read position, in the same frames
    this.primed = false;
    this.underruns = 0;
    this.drops = 0;
  }
  get fill() { return this.w - this.pos; }
  push(l, r) {
    for (let i = 0; i < l.length; i++) {
      const at = (this.w + i) % this.cap;
      this.l[at] = l[i];
      this.r[at] = r[i];
    }
    this.w += l.length;
    if (this.fill > this.cap * 0.9) {
      this.pos = this.w - this.target;
      this.drops++;
    }
  }
  /** Fills outL/outR; ratio is sender rate / our rate. */
  pull(outL, outR, ratio) {
    const n = outL.length;
    if (!this.primed) {
      if (this.fill >= this.target) this.primed = true;
      else { outL.fill(0); outR.fill(0); return; }
    }
    const trim = Math.max(-0.01, Math.min(0.01, ((this.fill - this.target) / this.target) * 0.02));
    const rate = ratio * (1 + trim);
    for (let i = 0; i < n; i++) {
      if (this.fill < 2) {
        this.primed = false;
        this.underruns++;
        for (let j = i; j < n; j++) { outL[j] = 0; outR[j] = 0; }
        return;
      }
      const i0 = Math.floor(this.pos);
      const f = this.pos - i0;
      const a = i0 % this.cap;
      const b = (i0 + 1) % this.cap;
      outL[i] = this.l[a] + (this.l[b] - this.l[a]) * f;
      outR[i] = this.r[a] + (this.r[b] - this.r[a]) * f;
      this.pos += rate;
    }
  }
}

class PcmSend extends AudioWorkletProcessor {
  constructor() {
    super();
    this.n = ${PCM_CHUNK};
    this.active = false; // the main thread switches this on while some tab listens to the port
    this.port.onmessage = (e) => { this.active = !!e.data.active; this.at = 0; };
    this.l = new Float32Array(this.n);
    this.r = new Float32Array(this.n);
    this.at = 0;
  }
  process(inputs) {
    if (!this.active) return true; // nobody is listening: do no work
    const input = inputs[0];
    if (input && input[0]) {
      const left = input[0];
      const right = input[1] || input[0];
      for (let i = 0; i < left.length; i++) {
        this.l[this.at] = left[i];
        this.r[this.at] = right[i];
        if (++this.at === this.n) {
          this.port.postMessage({ l: this.l, r: this.r }, [this.l.buffer, this.r.buffer]);
          this.l = new Float32Array(this.n);
          this.r = new Float32Array(this.n);
          this.at = 0;
        }
      }
    }
    return true;
  }
}

class PcmRecv extends AudioWorkletProcessor {
  constructor(options) {
    super();
    const { targetMs, capacityMs } = options.processorOptions;
    this.ring = new PcmRing(Math.ceil(sampleRate * capacityMs / 1000), Math.ceil(sampleRate * targetMs / 1000));
    this.ratio = 1;
    this.blocks = 0;
    this.port.onmessage = (e) => {
      this.ratio = e.data.rate / sampleRate;
      this.ring.push(e.data.l, e.data.r);
    };
  }
  process(inputs, outputs) {
    const out = outputs[0];
    this.ring.pull(out[0], out[1] || out[0], this.ratio);
    if (++this.blocks % 64 === 0) {
      this.port.postMessage({ fill: this.ring.fill / sampleRate * 1000, underruns: this.ring.underruns, drops: this.ring.drops });
    }
    return true;
  }
}

registerProcessor('${PCM_SEND}', PcmSend);
registerProcessor('${PCM_RECV}', PcmRecv);
`;
