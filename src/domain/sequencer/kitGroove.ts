import type { DrumKit, KitPiece } from '../devices/drumKit';

/** One hit in a bar: where (in 16ths), what, how hard, and where on the piece (fraction of its radius). */
interface Step {
  at: number;
  piece: KitPiece;
  velocity: number;
  r?: number;
}

const beat = (bar: number): Step[] => {
  const steps: Step[] = [];
  for (let e = 0; e < 8; e++) steps.push({ at: e * 2, piece: 'hat', velocity: e % 2 === 0 ? 0.62 : 0.42 }); // eighths, the downbeats leaned on
  steps.push({ at: 0, piece: 'kick', velocity: 0.9 }, { at: 8, piece: 'kick', velocity: 0.85 }, { at: 10, piece: 'kick', velocity: 0.7 });
  steps.push({ at: 4, piece: 'snare', velocity: 0.88 }, { at: 12, piece: 'snare', velocity: 0.92 });
  if (bar % 4 === 0) steps.push({ at: 0, piece: 'crash', velocity: 0.9 });
  if (bar % 4 === 3) {
    // a fill over the last two beats: snare, rack tom, floor tom, in sixteenths, instead of the hats and the backbeat
    const fill: [KitPiece, number][] = [['snare', 0.7], ['snare', 0.6], ['tom', 0.8], ['tom', 0.7], ['floor', 0.85], ['floor', 0.75], ['floor', 0.85], ['kick', 0.9]];
    return [...steps.filter((s) => s.at < 8), ...fill.map(([piece, velocity], i) => ({ at: 8 + i, piece, velocity }))];
  }
  return steps;
};

/**
 * A plain rock beat to hear the kit by: eighths on the closed hi-hat, the kick on 1, 3 and the and of 3, the snare on 2
 * and 4, a crash every fourth bar and a fill on the toms before it; a little loose, as a drummer plays. Hits are sent
 * ahead with their delay, so the kit's worklets place them on the audio clock rather than when the timer fires.
 */
export class KitGroove {
  bpm = 112;
  private timer: ReturnType<typeof setInterval> | undefined;
  private bar = 0;
  private barStart = 0;
  private sent = new Set<string>();
  private seed = 7;

  constructor(private readonly kit: DrumKit, private readonly now: () => number = () => performance.now()) {}

  get playing(): boolean {
    return this.timer !== undefined;
  }

  start(): void {
    if (this.timer) return;
    this.kit.setHat(0);
    this.bar = 0;
    this.barStart = this.now() + 100;
    this.sent.clear();
    this.tick();
    this.timer = setInterval(() => this.tick(), 50);
  }

  stop(): void {
    clearInterval(this.timer);
    this.timer = undefined;
  }

  private loose(): number {
    this.seed = (this.seed * 1664525 + 1013904223) >>> 0;
    return this.seed / 4294967296 - 0.5;
  }

  /** Sends every hit due in the next 300 ms. */
  tick(): void {
    const now = this.now(), sixteenth = 60000 / this.bpm / 4, ahead = now + 300;
    while (this.barStart < ahead) {
      for (const s of beat(this.bar)) {
        const key = `${this.bar}/${s.at}/${s.piece}`;
        const due = this.barStart + s.at * sixteenth + this.loose() * 8; // up to 4 ms either side
        if (due > ahead || this.sent.has(key)) continue;
        this.sent.add(key);
        this.kit.hit(s.piece, Math.min(1, s.velocity + this.loose() * 0.08), s.r, Math.max(0, (due - now) / 1000));
      }
      if (this.barStart + 16 * sixteenth >= ahead) break;
      this.barStart += 16 * sixteenth;
      this.bar++;
      this.sent.clear();
    }
  }
}
