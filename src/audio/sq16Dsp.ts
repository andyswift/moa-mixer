import { SQ16_SCALES, SQ16_SCALE_NOTES, SQ16_STEPS } from '../domain/devices/sq16Params';

const SCALES = SQ16_SCALES.map((s) => SQ16_SCALE_NOTES[s]);

/**
 * The MOA-SQ16 sequencer as worklet source text, joined into the MOA-2600's worklet (`m2600Worklet.ts`) ahead of
 * its core, which runs it every sample before the oscillators. Self-contained: it reads params and input voltages and
 * leaves its outputs in fields, so it could run in a worklet of its own later. Semantics: `sq16Params.ts`.
 *
 *   clock (internal with FM and PW, or the clock input, or MIDI ticks) -> step position (direction, 16 or 8x2,
 *   bus 3 skip/reset) -> A, B (slider x 10 V), gate buses 1-3, position 1, clocked gate 1 -> quantizers A, B
 */
export const SQ16_SOURCE = `
const M26_SQ_STEPS = ${SQ16_STEPS};
const M26_SQ_SCALES = ${JSON.stringify(SCALES)};
const M26_SQ_RANGES = [1, 2, 4];

class M26Seq {
  constructor(sr, random) {
    this.sr = sr;
    this.random = random || Math.random;
    this.steps = new Float64Array(M26_SQ_STEPS);
    this.gates = new Int32Array(M26_SQ_STEPS);
    this.n = 16; this.dir = 0; this.skip = 1; this.gateMode = false; this.midi = false;
    this.inc = 0; this.fm = 0; this.pw = 0.5; this.notes = M26_SQ_SCALES[0]; this.range = 2;
    this.extPatched = false; this.ssPatched = false;
    // position: the step whose outputs are current; pending: the next advance lands on the first step
    this.pos = 0; this.pending = true; this.ping = 1;
    this.running = false;
    this.phase = 0; this.high = false;
    this.prev = { ext: false, start: false, stop: false, ss: false, step: false, reset: false };
    this.stepReq = 0; this.tickReq = 0;
    this.sinceTick = 0; this.tickLen = 0.1 * sr;
    // outputs (volts)
    this.a = 0; this.b = 0; this.bus = [0, 0, 0]; this.pos1 = 0; this.cgate1 = 0; this.clk = 0;
  }

  /** Per block: the params (ids "sq.*") and which of the clock and start/stop inputs have cords in them. */
  block(p, extPatched, ssPatched) {
    for (let i = 0; i < M26_SQ_STEPS; i++) {
      this.steps[i] = p['sq.step.' + (i + 1)];
      this.gates[i] = Math.round(p['sq.gate.' + (i + 1)]);
    }
    this.n = p['sq.mode'] > 0.5 ? 8 : 16;
    if (this.pos >= this.n) this.pos %= this.n;
    this.dir = Math.round(p['sq.dir']);
    if (this.pending) this.pos = this.dir === 1 ? this.n - 1 : 0; // shows the step it will start on
    this.skip = Math.round(p['sq.skip']); // 0 skip, 1 off, 2 reset
    this.gateMode = p['sq.trig'] > 0.5;
    this.inc = p['sq.rate'] / this.sr;
    this.fm = p['sq.fm'];
    this.pw = p['sq.pw'];
    this.notes = M26_SQ_SCALES[Math.round(p['sq.scale'])] || M26_SQ_SCALES[0];
    this.range = M26_SQ_RANGES[Math.round(p['sq.range'])] || 2;
    this.midi = p['sq.sync'] > 0.5;
    this.extPatched = extPatched;
    this.ssPatched = ssPatched;
  }

  first() {
    this.ping = 1;
    return this.dir === 1 ? this.n - 1 : 0;
  }

  next(p) {
    const n = this.n;
    switch (this.dir) {
      case 1: return (p - 1 + n) % n;
      case 2: {
        if (n < 2) return 0;
        let q = p + this.ping;
        if (q >= n) { this.ping = -1; q = n - 2; }
        else if (q < 0) { this.ping = 1; q = 1; }
        return q;
      }
      case 3: return Math.min(n - 1, Math.floor(this.random() * n));
      default: return (p + 1) % n;
    }
  }

  advance() {
    let p;
    if (this.pending) { p = this.first(); this.pending = false; }
    else p = this.next(this.pos);
    // a step on bus 3 skips on, or sends the sequence back to its first step
    if (this.gates[p] === 3 && this.skip === 0) {
      let q = p;
      for (let k = 0; k < this.n && this.gates[q] === 3; k++) q = this.next(q);
      if (this.gates[q] !== 3) p = q;
    } else if (this.gates[p] === 3 && this.skip === 2) {
      const f = this.first();
      if (p !== f) p = f;
    }
    this.pos = p;
  }

  /** Starts or stops it; starting fires the internal clock on the next sample, so the first step plays at once. */
  setRunning(on) {
    if (on && !this.running && !this.extPatched && !this.midi) this.phase = 1;
    this.running = on;
  }

  message(m) {
    if (!m) return;
    if (m.type === 'sqtick') { this.tickReq++; return; }
    if (m.type !== 'sq') return;
    switch (m.action) {
      case 'run': this.setRunning(true); break;
      case 'stop': this.setRunning(false); break;
      case 'toggle': this.setRunning(!this.running); break;
      case 'step': this.stepReq++; break;
      case 'reset': this.pos = this.first(); this.pending = true; break;
      case 'jump': {
        const i = Math.max(0, Math.floor(m.index || 0));
        this.pos = i % this.n;
        this.pending = false;
        break;
      }
    }
  }

  /** One sample: input voltages in, outputs left in this.a, b, bus, pos1, cgate1 and clk. */
  tick(fmV, pwmV, extV, startV, stopV, ssV, stepV, resetV) {
    const pr = this.prev;
    // start / stop
    const start = startV > 2.5, stop = stopV > 2.5, ss = ssV > 2.5;
    if (start && !pr.start) this.setRunning(true);
    if (stop && !pr.stop) this.setRunning(false);
    if (this.ssPatched) {
      if (this.gateMode) this.setRunning(ss);
      else if (ss && !pr.ss) this.setRunning(!this.running);
    }
    pr.start = start; pr.stop = stop; pr.ss = ss;
    // reset and step inputs
    const reset = resetV > 2.5, step = stepV > 2.5;
    if (reset && !pr.reset) { this.pos = this.first(); this.pending = true; }
    if (step && !pr.step) this.stepReq++;
    pr.reset = reset; pr.step = step;

    // the clock
    let rise = false;
    const pw = Math.min(0.98, Math.max(0.02, this.pw + pwmV / 10));
    if (this.extPatched) {
      const hi = extV > 2.5;
      rise = hi && !pr.ext;
      pr.ext = hi;
      this.high = hi;
    } else {
      this.phase += this.inc * Math.pow(2, this.fm * fmV);
      if (this.phase >= 1) { this.phase -= Math.floor(this.phase); rise = true; }
      this.high = this.phase < pw;
    }
    if (this.midi) {
      // MIDI ticks step it; the clock is high for the pulse width of the time between ticks
      rise = false;
      this.sinceTick++;
      if (this.tickReq > 0) {
        this.tickReq = 0;
        if (this.sinceTick > 8 && this.sinceTick < 4 * this.sr) this.tickLen = this.sinceTick;
        this.sinceTick = 0;
        rise = true;
      }
      this.high = this.sinceTick < pw * this.tickLen;
    }
    if (rise && this.running) this.advance();
    while (this.stepReq > 0) { this.stepReq--; this.advance(); }

    // outputs
    const p = this.pos;
    this.a = this.steps[p] * 10;
    this.b = this.n === 8 ? this.steps[p + 8] * 10 : this.a;
    const g = this.running ? this.gates[p] : 0;
    this.bus[0] = g === 1 ? 10 : 0;
    this.bus[1] = g === 2 ? 10 : 0;
    this.bus[2] = g === 3 ? 10 : 0;
    this.cgate1 = g === 1 && this.high ? 10 : 0;
    this.pos1 = this.running && p === 0 ? 10 : 0;
    this.clk = this.high ? 10 : 0;
  }

  /** A quantizer: 0-10 V in, a note of the scale over the range out (1 V per octave), plus the CV input. */
  quant(v, cv) {
    const semis = Math.min(10, Math.max(0, v)) / 10 * this.range * 12;
    const oct = Math.floor(semis / 12);
    const r = semis - oct * 12;
    let best = 0, dist = 99;
    for (const s of this.notes) { const d = Math.abs(r - s); if (d < dist - 1e-9) { dist = d; best = s; } }
    if (Math.abs(r - 12) < dist - 1e-9) best = 12;
    return (oct * 12 + best) / 12 + cv;
  }
}
`;
