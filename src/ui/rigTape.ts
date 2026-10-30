import type { AudioEngine } from '../audio/engine';
import { TAPE_NAME } from '../audio/tapeWorklet';
import { encodeWav } from '../audio/wav';
import { el } from './widgets';

/**
 * Record to tape: the rig's master output, as you hear it (after the mixer, the effects and the compressor), into a
 * 24-bit stereo WAV that downloads when the take stops. The samples come from the audio thread in chunks (the tape
 * worklet), so a busy page loses none of them.
 */
export class RigTape {
  private node?: AudioWorkletNode;
  private chunks: { L: Float32Array; R: Float32Array }[] = [];
  private startedAt = 0;
  private stoppedSeconds = 0;
  private finishing?: () => void;
  private readonly listeners = new Set<() => void>();
  status = 'READY';

  constructor(
    private readonly engine: AudioEngine,
    private readonly source: () => AudioNode | undefined,
    /** The take's name, without the extension. */
    private readonly fileName: () => string,
  ) {}

  get recording(): boolean {
    return !!this.node;
  }

  /** Seconds on tape: of the take being recorded, or of the last one. */
  get seconds(): number {
    const ctx = this.engine.context;
    return this.node && ctx ? ctx.currentTime - this.startedAt : this.stoppedSeconds;
  }

  start(): void {
    const ctx = this.engine.context, src = this.source();
    if (this.node) return;
    if (!ctx || !src || ctx.state !== 'running') { this.say('START AUDIO FIRST'); return; }
    const node = new AudioWorkletNode(ctx, TAPE_NAME, { numberOfInputs: 1, numberOfOutputs: 0, channelCount: 2, channelCountMode: 'explicit' });
    this.chunks = [];
    node.port.onmessage = (e: MessageEvent<{ type: 'chunk'; L: Float32Array; R: Float32Array } | { type: 'done' }>) => {
      if (e.data.type === 'chunk') this.chunks.push({ L: e.data.L, R: e.data.R });
      else this.finishing?.();
    };
    src.connect(node);
    node.port.postMessage({ type: 'start' });
    this.node = node;
    this.startedAt = ctx.currentTime;
    this.say('REC');
  }

  /** Stops the take and downloads it. */
  async stop(): Promise<void> {
    const node = this.node, ctx = this.engine.context;
    if (!node || !ctx) return;
    this.stoppedSeconds = ctx.currentTime - this.startedAt;
    const done = new Promise<void>((resolve) => { this.finishing = resolve; });
    node.port.postMessage({ type: 'stop' });
    await done;
    this.source()?.disconnect(node);
    this.node = undefined;
    const frames = this.chunks.reduce((n, c) => n + c.L.length, 0);
    const L = new Float32Array(frames), R = new Float32Array(frames);
    let at = 0;
    for (const c of this.chunks) { L.set(c.L, at); R.set(c.R, at); at += c.L.length; }
    this.chunks = [];
    const name = `${this.fileName()}.wav`;
    const url = URL.createObjectURL(new Blob([encodeWav([L, R], ctx.sampleRate)], { type: 'audio/wav' }));
    const a = el('a');
    a.href = url;
    a.download = name;
    document.body.append(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 60_000);
    this.say(`SAVED ${name}`);
  }

  toggle(): void {
    if (this.recording) void this.stop(); else this.start();
  }

  onChange(fn: () => void): () => void {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  }

  private say(status: string): void {
    this.status = status;
    for (const l of this.listeners) l();
  }
}

const clock = (s: number) => {
  const m = Math.floor(s / 60), r = s - m * 60;
  return `${String(m).padStart(2, '0')}:${r.toFixed(1).padStart(4, '0')}`;
};

const SVG = 'http://www.w3.org/2000/svg';
const svg = <K extends keyof SVGElementTagNameMap>(tag: K, attrs: Record<string, string | number>): SVGElementTagNameMap[K] => {
  const e = document.createElementNS(SVG, tag);
  for (const [k, v] of Object.entries(attrs)) e.setAttribute(k, String(v));
  return e;
};

/** A reel: its tape pack (a radius that changes as the take goes on) and the flange with three windows, turning. */
function reel(cx: number, cy: number) {
  const g = svg('g', {});
  const pack = svg('circle', { cx, cy, r: 26, class: 'rig-tape-pack' });
  const spin = svg('g', { class: 'rig-tape-spin', style: `transform-origin: ${cx}px ${cy}px` });
  spin.append(svg('circle', { cx, cy, r: 33, class: 'rig-tape-flange' }));
  for (let k = 0; k < 3; k++) {
    const a = (k * 120 * Math.PI) / 180;
    spin.append(svg('circle', { cx: cx + Math.cos(a) * 18, cy: cy + Math.sin(a) * 18, r: 8.5, class: 'rig-tape-window' }));
  }
  spin.append(svg('circle', { cx, cy, r: 6, class: 'rig-tape-hub' }));
  for (let k = 0; k < 3; k++) {
    const a = ((k * 120 + 60) * Math.PI) / 180;
    spin.append(svg('line', { x1: cx, y1: cy, x2: cx + Math.cos(a) * 6, y2: cy + Math.sin(a) * 6, class: 'rig-tape-key' }));
  }
  g.append(pack, spin);
  return { g, pack, spin };
}

/**
 * The tape machine: two reels that turn while it records (the tape winding from one to the other), the head, a
 * counter, a VU needle on the master's level, REC and STOP.
 */
export function renderTapeDeck(tape: RigTape, level: () => number | undefined): HTMLElement {
  const deck = el('section', 'rig-section rig-tape');
  deck.style.setProperty('--rig-accent', '#ff4a32');
  const title = el('h3', 'rig-title', 'TAPE · 24-BIT WAV');
  const pic = svg('svg', { viewBox: '0 0 240 112', class: 'rig-tape-pic', role: 'img', 'aria-label': 'Tape machine' });
  const left = reel(56, 42), right = reel(184, 42);
  // the tape: from the supply reel round the guides, across the head, to the take-up reel
  pic.append(
    svg('path', { d: 'M 30 60 L 52 96 L 188 96 L 210 60', class: 'rig-tape-path' }),
    svg('circle', { cx: 52, cy: 96, r: 5, class: 'rig-tape-guide' }),
    svg('circle', { cx: 188, cy: 96, r: 5, class: 'rig-tape-guide' }),
    svg('rect', { x: 108, y: 92, width: 24, height: 12, rx: 2, class: 'rig-tape-head' }),
    left.g, right.g,
  );
  // the VU: a needle on an arc, between the reels
  const vu = svg('g', {});
  vu.append(svg('path', { d: 'M 102 30 A 22 22 0 0 1 138 30', class: 'rig-tape-arc' }));
  vu.append(svg('path', { d: 'M 130 22 A 22 22 0 0 1 138 30', class: 'rig-tape-arc-red' }));
  const needle = svg('line', { x1: 120, y1: 50, x2: 120, y2: 26, class: 'rig-tape-needle', style: 'transform-origin: 120px 50px' });
  vu.append(needle, svg('text', { x: 120, y: 60, class: 'rig-tape-vu', 'text-anchor': 'middle' }));
  (vu.lastChild as SVGTextElement).textContent = 'VU';
  pic.append(vu);

  const counter = el('output', 'rig-tape-counter', '00:00.0');
  const rec = el('button', 'rig-key rig-wide rig-tape-rec', '● REC');
  rec.type = 'button';
  rec.setAttribute('aria-label', 'Record to tape');
  rec.addEventListener('click', () => tape.start());
  const stop = el('button', 'rig-key rig-wide rig-tape-stop', '■ STOP');
  stop.type = 'button';
  stop.setAttribute('aria-label', 'Stop the tape and save the take');
  stop.addEventListener('click', () => void tape.stop());
  const status = el('div', 'rig-tape-status');
  const row = el('div', 'rig-tape-row');
  row.append(counter, rec, stop);
  deck.append(title, pic, row, status);

  const sync = () => {
    deck.classList.toggle('recording', tape.recording);
    rec.classList.toggle('on', tape.recording);
    status.textContent = tape.status;
  };
  tape.onChange(sync);
  sync();

  let angle = -40;
  const frame = () => {
    if (!deck.closest('[hidden]')) {
      const s = tape.seconds;
      counter.textContent = clock(s);
      // the tape winds over: the take-up reel fills, the supply reel empties (over ten minutes)
      const wound = Math.min(1, s / 600);
      left.pack.setAttribute('r', String(30 - 12 * wound));
      right.pack.setAttribute('r', String(18 + 12 * wound));
      // the needle: -20 dB RMS (and below) to the left, +3 to the right, with a VU's sluggishness
      const l = level();
      const db = l && l > 0 ? 20 * Math.log10(l) + 18 : -30; // -18 dBFS RMS reads 0 VU
      const target = Math.max(-45, Math.min(45, -45 + ((Math.max(-20, Math.min(3, db)) + 20) / 23) * 90));
      angle += (target - angle) * 0.15;
      needle.style.transform = `rotate(${angle}deg)`;
    }
    requestAnimationFrame(frame);
  };
  requestAnimationFrame(frame);
  return deck;
}

/** The header's TAPE button: the same tape, from any page. */
export function renderTapeButton(tape: RigTape): HTMLElement {
  const b = el('button', 'rig-key rig-wide rig-tape-button', '● TAPE');
  b.type = 'button';
  b.setAttribute('aria-label', 'Record to tape (again to stop and save)');
  b.addEventListener('click', () => tape.toggle());
  const sync = () => { b.classList.toggle('on', tape.recording); if (!tape.recording) b.textContent = '● TAPE'; };
  tape.onChange(sync);
  sync();
  const frame = () => {
    if (tape.recording) b.textContent = `● ${clock(tape.seconds)}`;
    requestAnimationFrame(frame);
  };
  requestAnimationFrame(frame);
  return b;
}
