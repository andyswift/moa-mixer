import type { PageId, PageSettings } from './control';

/** One note of a song. Times are in beats from the start of the song. */
export interface NoteEvent {
  t: number;
  len: number;
  note: number;
  vel: number;
}

/** A control moved over time (a filter sweep): piecewise-linear between [beat, value] points; exponential suits Hz. */
export interface Automation {
  page: PageId;
  device: string;
  control: string;
  points: [beat: number, value: number][];
  curve?: 'linear' | 'exp';
}

/** How alive the playing is. Everything is random but repeatable: the seed picks the same performance every time. */
export interface Humanise {
  /** Timing slip in ms (a bell-shaped spread either side), per page. */
  timing: Partial<Record<PageId, number>>;
  /** Velocity spread as a fraction (0.12: up to 12 % either way). */
  velocity: number;
  /** Delay of odd 16th notes as a fraction of a 16th (0.08 is a little swing). */
  swing?: number;
  /** A fixed lag in ms for particular notes of a page: a snare or clap sitting a touch behind the beat. */
  layback?: Partial<Record<PageId, Record<number, number>>>;
}

export interface SongSection {
  /** A short name: A, B, A′. */
  name: string;
  /** From and to, in beats. */
  from: number;
  to: number;
  /** Its meter, as written: 7/8. */
  meter: string;
  /** How heavy it is, 0 (gentle) to 1 (all out): the players' moods follow it. */
  heat: number;
}

export interface Swing {
  from: number;
  to: number;
  /** Linn's swing percentage: the first note of each pair takes this share of the pair (50 to 75). */
  amount: number;
  grid: 16 | 8;
}

export interface Sleeve {
  /** Original art, drawn in SVG by the records page; this picks which and its colours. */
  art: 'sunrise' | 'garden' | 'hands' | 'flats' | 'aurora' | 'frost';
  colors: string[];
}

export interface Song {
  id: string;
  title: string;
  artist: string;
  bpm: number;
  key: string;
  bars: number;
  beatsPerBar: number;
  /**
   * For a song whose meter changes: the length of every bar in beats (a 7/8 bar is 3.5, a 5/4 bar 5), `bars` of them.
   * Without it, every bar is `beatsPerBar` long.
   */
  barBeats?: number[];
  sleeve: Sleeve;
  /** Which instruments the song uses, in the order the band chips show them. */
  band: PageId[];
  /** Settings sent to each page before the song starts. */
  setup: Partial<Record<PageId, PageSettings>>;
  /** Mixer input routing for this song (jack to port name), if it differs from the defaults. */
  inputs?: Record<string, string>;
  tracks: Partial<Record<PageId, NoteEvent[]>>;
  /**
   * Pages that follow the song's MIDI clock: each pass sends them Start, then 24 clock pulses a beat, and stopping
   * sends Stop. A sequencer set to MIDI sync (the MOA-2600's SQ16) then steps in time with the song.
   */
  clock?: PageId[];
  automation: Automation[];
  humanise: Humanise;
  /**
   * Passages the whole band plays swung, together (Roger Linn's swing): from and to (beats), how much (50 is straight,
   * 66 a triplet shuffle) and which notes swing, the 16ths or the eighths. In a passage, every page's off-beat notes on
   * that grid, counted from the start of their bar (so odd meters swing too), land late by the same amount.
   */
  swung?: Swing[];
  /** The song's sections in order, for a page that shows where the band is (the band page's timeline and moods). */
  sections?: SongSection[];
  /** Only in dev builds: songs that imitate real recordings are never published. */
  localOnly?: boolean;
}

/** One pass of a song, in beats. */
export const songBeats = (song: Song): number => song.barBeats ? song.barBeats.reduce((a, b) => a + b, 0) : song.bars * song.beatsPerBar;

/** The bar (1-based) a beat of the song falls in. */
export function barAt(song: Song, beat: number): number {
  if (!song.barBeats) return Math.floor(beat / song.beatsPerBar) + 1;
  let start = 0;
  for (let i = 0; i < song.barBeats.length; i++) {
    start += song.barBeats[i]!;
    if (beat < start) return i + 1;
  }
  return song.barBeats.length;
}

/** Where the bar holding a beat starts, in beats. */
export function barStartAt(song: Song, beat: number): number {
  if (!song.barBeats) return Math.floor(beat / song.beatsPerBar) * song.beatsPerBar;
  let start = 0;
  for (const len of song.barBeats) {
    if (beat < start + len) return start;
    start += len;
  }
  return start;
}

/** How late a note at `beat` lands in the song's swung passages, in beats (0 when straight or on the beat). */
export function swingDelay(song: Song, beat: number): number {
  const s = song.swung?.find((x) => beat >= x.from && beat < x.to);
  if (!s) return 0;
  const unit = s.grid === 16 ? 0.25 : 0.5;
  const k = (beat - barStartAt(song, beat)) / unit;
  const odd = Math.abs(k - Math.round(k)) < 1e-6 && Math.round(k) % 2 === 1;
  return odd ? (2 * s.amount / 100 - 1) * unit : 0;
}
