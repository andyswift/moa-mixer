import { describe, expect, it } from 'vitest';
import { DrumKit, type KitPiece } from '../../domain/devices/drumKit';
import { KIT_SOURCE } from '../kitWorklet';

interface Core {
  pitchScale: number;
  configure(m: unknown): void;
  hit(v: number[], click: number, tau: number, burst?: number, burstDecay?: number): void;
  setDamp(sigma: number, contact: number): void;
  process(out: Float32Array, n: number, p: { level: number }): void;
}
const { DrumCore } = new Function(`${KIT_SOURCE}; return { DrumCore };`)() as { DrumCore: new (sr: number) => Core };
const SR = 48000;

/** A kit with its cymbals modelled (they default to Gaute's samples). */
const modelled = () => {
  const kit = new DrumKit();
  (kit.control('cymbals.source') as { set(v: string): void }).set('model');
  return kit;
};

/** Plays one piece of a kit through the engine's core: what `play` does to the kit reaches the core as messages. */
function render(kit: DrumKit, piece: KitPiece, play: () => void, seconds: number, watch?: (core: Core, at: number) => void) {
  const core = new DrumCore(SR);
  core.configure(JSON.parse(kit.circuit.node(piece).options.config!));
  const off = kit.circuit.onChange((c) => {
    if (c.type !== 'message' || c.nodeId !== piece) return;
    const m = c.data as { type: string; v: number[]; click: number; tau: number; burst?: number; burstDecay?: number; sigma: number; contact: number };
    if (m.type === 'hit') core.hit(m.v, m.click, m.tau, m.burst, m.burstDecay);
    if (m.type === 'damp') core.setDamp(m.sigma, m.contact);
  });
  play();
  off();
  const n = Math.round(seconds * SR), out = new Float32Array(n);
  for (let at = 0; at < n; at += 128) {
    core.process(out.subarray(at, Math.min(n, at + 128)), Math.min(128, n - at), { level: 1 });
    watch?.(core, at);
  }
  return out;
}

const rms = (x: Float32Array, from = 0, to = x.length) => { let s = 0; for (let i = from; i < to; i++) s += x[i]! ** 2; return Math.sqrt(s / (to - from)); };
/** Energy above `hz` (a one-pole high-pass, run twice), per 50 ms window. */
function highBand(x: Float32Array, hz: number): number[] {
  const a = Math.exp((-2 * Math.PI * hz) / SR);
  let y = x;
  for (let pass = 0; pass < 2; pass++) {
    const z = new Float32Array(y.length);
    let px = 0, py = 0;
    for (let i = 0; i < y.length; i++) { py = a * (py + y[i]! - px); px = y[i]!; z[i] = py; }
    y = z;
  }
  const w: number[] = [];
  for (let i = 0; i + 2400 <= y.length; i += 2400) w.push(rms(y, i, i + 2400));
  return w;
}
function powerAt(x: Float32Array, hz: number, from: number, len: number): number {
  let re = 0, im = 0;
  for (let i = 0; i < len; i++) {
    const w = 0.5 - 0.5 * Math.cos((2 * Math.PI * i) / (len - 1)), a = (2 * Math.PI * hz * (from + i)) / SR;
    re += x[from + i]! * w * Math.cos(a); im -= x[from + i]! * w * Math.sin(a);
  }
  return re * re + im * im;
}

describe('the MOA-KIT engine', () => {
  it('a tom hit in the centre rings at its fundamental', () => {
    const kit = new DrumKit();
    const out = render(kit, 'tom', () => kit.hit('tom', 0.5, 0), 0.6);
    const f = kit.readout('tom').fundamental.hz;
    const at = (hz: number) => powerAt(out, hz, 4800, 9600);
    expect(at(f)).toBeGreaterThan(at(f * 1.12) * 10);
    expect(at(f)).toBeGreaterThan(at(f / 1.12) * 10);
  });

  it('a hard hit stretches the head: it starts sharp (a semitone or so, 20 ms in) and settles; a soft one stays in tune', () => {
    const kit = new DrumKit();
    const scale: number[] = [];
    render(kit, 'floor', () => kit.hit('floor', 1), 1, (core) => scale.push(core.pitchScale));
    const at20ms = 8; // blocks of 128 samples
    expect(scale[at20ms]!).toBeGreaterThan(1.03);
    expect(scale[at20ms]!).toBeLessThan(1.15);
    expect(scale.at(-1)!).toBeLessThan(1.001);
    const soft: number[] = [];
    render(kit, 'floor', () => kit.hit('floor', 0.2), 0.1, (core) => soft.push(core.pitchScale));
    expect(soft[at20ms]!).toBeLessThan(1.01);
  });

  it('the snare wires buzz: much more top end with the snares on', () => {
    const on = new DrumKit(), off = new DrumKit();
    (off.control('snare.on') as { set(v: string): void }).set('off');
    const top = (k: DrumKit) => Math.max(...highBand(render(k, 'snare', () => k.hit('snare', 0.8), 0.5), 3000));
    expect(top(on)).toBeGreaterThan(top(off) * 3);
  });

  it('a closed hi-hat is a short tick, an open one rings', () => {
    const kit = modelled();
    const closed = render(kit, 'hat', () => { kit.setHat(0); kit.hit('hat', 0.7); }, 0.6);
    const open = render(kit, 'hat', () => { kit.setHat(1); kit.hit('hat', 0.7); }, 0.6);
    expect(rms(open, 9600, 28800)).toBeGreaterThan(rms(closed, 9600, 28800) * 20);
  });

  it('a hard crash swells: its top end peaks after the hit, and once it has, it is brighter than after a soft hit', () => {
    const kit = modelled();
    const brightness = (out: Float32Array) => highBand(out, 4000)[6]! / rms(out, 0.3 * SR, 0.35 * SR); // 300 ms in
    const hardOut = render(kit, 'crash', () => kit.hit('crash', 1), 1.5);
    const hard = highBand(hardOut, 4000);
    expect(hard.indexOf(Math.max(...hard))).toBeGreaterThanOrEqual(1); // 50 ms or later
    const softOut = render(kit, 'crash', () => kit.hit('crash', 0.2), 1.5);
    expect(brightness(hardOut)).toBeGreaterThan(brightness(softOut) * 1.2);
  });

  it('the cascade keeps energy: a crash dies away and never blows up', () => {
    const kit = modelled();
    const out = render(kit, 'crash', () => kit.hit('crash', 1), 6);
    const second = (s: number) => rms(out, s * SR, (s + 1) * SR);
    for (let s = 1; s < 5; s++) expect(second(s + 1)).toBeLessThan(second(s));
    expect(second(5)).toBeLessThan(second(0) / 30);
    for (const x of out) expect(Math.abs(x)).toBeLessThanOrEqual(1);
  });
});
