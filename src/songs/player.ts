import { type ControlMessage, EFFECT_PAGES, type PageId } from './control';
import type { Automation, Song } from './types';

/** What the player needs from the outside, so tests can run it on a fake clock. */
export interface PlayerHost {
  /** Wall-clock milliseconds on a clock every tab shares (see `epochNow` in midi/bus.ts). */
  now(): number;
  /** Plays MIDI bytes on one page's song channel, due at `at` (wall-clock ms). */
  sendNote(page: PageId, data: number[], at: number): void;
  control(page: PageId, message: ControlMessage): void;
  setInterval(fn: () => void, ms: number): unknown;
  clearInterval(handle: unknown): void;
}

export interface ScheduledMessage {
  /** Milliseconds from the start of the song. */
  ms: number;
  page: PageId;
  data: number[];
}

const NOTE_OFF_SHARE = 0.96; // a note is released just before the next of the same pitch could start
const PPQN = 24; // MIDI clock pulses per quarter note
export const MIDI_START = 0xfa;
export const MIDI_CLOCK = 0xf8;
export const MIDI_STOP = 0xfc;

function rng(seed: number): () => number {
  let s = seed >>> 0;
  return () => {
    s = (s + 0x6d2b79f5) >>> 0;
    let t = s;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/**
 * Turns a song into timed MIDI messages, with the humanising applied. Same song and seed: same performance. Pages in
 * `song.clock` also get Start and the clock for the pass (exactly on the beat, never humanised).
 */
export function expandSong(song: Song, seed = 1): ScheduledMessage[] {
  const random = rng(seed);
  const wobble = () => random() + random() - 1; // bell-shaped, -1..1
  const beatMs = 60000 / song.bpm;
  const out: ScheduledMessage[] = [];
  const h = song.humanise;
  for (const [page, events] of Object.entries(song.tracks) as [PageId, NonNullable<Song['tracks'][PageId]>][]) {
    const channel = page === 'drums' ? 9 : 0;
    for (const e of events) {
      const odd16th = Math.abs((e.t * 4) % 2 - 1) < 1e-6;
      const slip = wobble() * (h.timing[page] ?? 0) + (h.layback?.[page]?.[e.note] ?? 0) + (odd16th ? (h.swing ?? 0) * (beatMs / 4) : 0);
      const start = Math.max(0, e.t * beatMs + slip);
      const velocity = Math.max(1, Math.min(127, Math.round(e.vel * (1 + (random() * 2 - 1) * h.velocity))));
      out.push({ ms: start, page, data: [0x90 | channel, e.note, velocity] });
      out.push({ ms: start + e.len * beatMs * NOTE_OFF_SHARE, page, data: [0x80 | channel, e.note, 0] });
    }
  }
  const pulses = song.bars * song.beatsPerBar * PPQN;
  for (const page of song.clock ?? []) {
    out.push({ ms: 0, page, data: [MIDI_START] }); // before the first pulse (the sort keeps equal times in order)
    for (let k = 0; k < pulses; k++) out.push({ ms: (k * beatMs) / PPQN, page, data: [MIDI_CLOCK] });
  }
  return out.sort((a, b) => a.ms - b.ms);
}

/** The value of an automation at a beat: held before its first point and after its last. */
export function automationValue(a: Automation, beat: number): number {
  const pts = a.points;
  if (beat <= pts[0]![0]) return pts[0]![1];
  const last = pts[pts.length - 1]!;
  if (beat >= last[0]) return last[1];
  for (let i = 1; i < pts.length; i++) {
    const [b1, v1] = pts[i]!;
    if (beat <= b1) {
      const [b0, v0] = pts[i - 1]!;
      const x = (beat - b0) / (b1 - b0);
      return a.curve === 'exp' && v0 > 0 && v1 > 0 ? v0 * Math.pow(v1 / v0, x) : v0 + (v1 - v0) * x;
    }
  }
  return last[1];
}

export type PlayerState = 'idle' | 'playing';

/**
 * Plays a song on the other pages: notes go out a little ahead of their time with due times (the pages hold them until
 * due), automation goes out as settings, and stopping releases every note that is sounding or about to.
 */
export class SongPlayer {
  state: PlayerState = 'idle';
  /** Called when the song reaches its end by itself. */
  onEnd?: () => void;
  /** Called on every tick while playing, with the current beat. */
  onTick?: (beat: number) => void;
  /** Repeat the song until stopped. Can be switched while playing; turning it off lets the current pass finish. */
  loop = false;
  private timer?: unknown;
  private song?: Song;
  private messages: ScheduledMessage[] = [];
  private next = 0;
  private startAt = 0;
  /** Wall-clock start of the pass being sent (startAt plus whole loops). */
  private cycleStart = 0;
  private cycle = 0;
  private seed = 1;
  private lastDue = 0;
  private readonly paused = new Set<PageId>();
  private readonly open = new Map<string, { page: PageId; data: number[] }>();
  private readonly lastSent = new Map<Automation, number>();

  constructor(
    private readonly host: PlayerHost,
    private readonly lookaheadMs = 250,
    private readonly tickMs = 30,
    private readonly leadInMs = 500,
  ) {}

  /** The current position in beats (negative during the lead-in). */
  get beat(): number {
    return this.song ? (this.host.now() - this.startAt) / (60000 / this.song.bpm) : 0;
  }

  /** Sends a song's settings to its pages: instruments listen on any MIDI channel, plus whatever the song sets. */
  setup(song: Song): void {
    const pages = new Set<PageId>([...song.band, ...(Object.keys(song.setup) as PageId[])]);
    for (const page of pages) {
      if (page === 'mixer') continue;
      const settings = { ...(song.setup[page] ?? {}) };
      const isEffect = (EFFECT_PAGES as readonly PageId[]).includes(page); // effects take no notes, so no channel to open
      if (!isEffect) for (const [device, s] of Object.entries(settings)) settings[device] = { channel: 'omni', ...s };
      this.host.control(page, { type: 'apply', settings });
    }
    this.host.control('mixer', { type: 'apply', settings: song.setup.mixer, inputs: song.inputs });
    for (const a of song.automation) this.applyAutomation(a, automationValue(a, 0));
  }

  /** Holds back a page's automation (a sweep) while someone is turning its knobs; `resumeAutomation` lets it go on. */
  pauseAutomation(page: PageId): void {
    this.paused.add(page);
  }

  resumeAutomation(page: PageId): void {
    this.paused.delete(page);
    for (const a of [...this.lastSent.keys()]) if (a.page === page) this.lastSent.delete(a); // send the current value at once
  }

  /** The length of one pass of the song in beats. */
  get loopBeats(): number {
    return this.song ? this.song.bars * this.song.beatsPerBar : 0;
  }

  play(song: Song, seed = 1): void {
    this.stop();
    this.song = song;
    this.seed = seed;
    this.cycle = 0;
    this.messages = expandSong(song, seed);
    this.next = 0;
    this.startAt = this.host.now() + this.leadInMs;
    this.cycleStart = this.startAt;
    this.lastDue = this.startAt;
    this.lastSent.clear();
    this.state = 'playing';
    this.timer = this.host.setInterval(() => this.tick(), this.tickMs);
    this.tick();
  }

  /** Stops now: cancels the timer and releases every note that is sounding or already on its way. */
  stop(): void {
    if (this.timer !== undefined) this.host.clearInterval(this.timer);
    this.timer = undefined;
    // Notes already sent are held by their pages until due, so the releases must land after the last one of them.
    const at = Math.max(this.host.now(), this.lastDue) + 10;
    for (const { page, data } of this.open.values()) this.host.sendNote(page, [0x80 | (data[0]! & 0x0f), data[1]!, 0], at);
    this.open.clear();
    for (const page of this.song?.clock ?? []) this.host.sendNote(page, [MIDI_STOP], at); // sequencers stop with the song
    this.state = 'idle';
  }

  private tick(): void {
    const song = this.song;
    if (!song || this.state !== 'playing') return;
    const now = this.host.now();
    const beatMs = 60000 / song.bpm;
    const loopMs = song.bars * song.beatsPerBar * beatMs;
    for (;;) {
      while (this.next < this.messages.length) {
        const m = this.messages[this.next]!;
        const due = this.cycleStart + m.ms;
        if (due - now > this.lookaheadMs) break;
        this.host.sendNote(m.page, m.data, due);
        this.lastDue = Math.max(this.lastDue, due);
        const key = `${m.page}:${m.data[0]! & 0x0f}:${m.data[1]}`;
        if ((m.data[0]! & 0xf0) === 0x90) this.open.set(key, { page: m.page, data: m.data });
        else this.open.delete(key);
        this.next++;
      }
      // Looping: the next pass is lined up before the end of this one, so it starts exactly on the beat with no gap.
      if (this.loop && this.cycleStart + loopMs - now <= this.lookaheadMs) {
        // anything of this pass that is still unsent (a release past the loop point) carries over into the next
        const carried = this.messages.slice(this.next).map((m) => ({ ...m, ms: m.ms - loopMs }));
        this.cycle++;
        this.cycleStart += loopMs;
        this.messages = [...carried, ...expandSong(song, this.seed + this.cycle)].sort((a, b) => a.ms - b.ms);
        this.next = 0;
        continue;
      }
      break;
    }
    const beat = (now - this.startAt) / beatMs;
    const loopBeats = song.bars * song.beatsPerBar;
    const sweepBeat = this.loop && beat >= 0 ? beat % loopBeats : beat; // a sweep starts over with each pass
    for (const a of song.automation) if (sweepBeat >= -1 && !this.paused.has(a.page)) this.applyAutomation(a, automationValue(a, sweepBeat));
    this.onTick?.(beat);
    if (!this.loop && this.next >= this.messages.length && now - this.cycleStart > loopMs + 1200) {
      this.stop();
      this.onEnd?.();
    }
  }

  private applyAutomation(a: Automation, value: number): void {
    const last = this.lastSent.get(a);
    if (last !== undefined && Math.abs(value - last) < Math.max(1e-4, Math.abs(last) * 0.004)) return; // not worth a message
    this.lastSent.set(a, value);
    this.host.control(a.page, { type: 'apply', settings: { [a.device]: { controls: { [a.control]: value } } } });
  }
}
