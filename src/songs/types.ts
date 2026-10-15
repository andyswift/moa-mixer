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

export interface Sleeve {
  /** Original art, drawn in SVG by the records page; this picks which and its colours. */
  art: 'sunrise' | 'garden' | 'hands' | 'flats' | 'aurora';
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
  sleeve: Sleeve;
  /** Which instruments the song uses, in the order the band chips show them. */
  band: PageId[];
  /** Settings sent to each page before the song starts. */
  setup: Partial<Record<PageId, PageSettings>>;
  /** Mixer input routing for this song (jack to port name), if it differs from the defaults. */
  inputs?: Record<string, string>;
  tracks: Partial<Record<PageId, NoteEvent[]>>;
  automation: Automation[];
  humanise: Humanise;
  /** Only in dev builds: songs that imitate real recordings are never published. */
  localOnly?: boolean;
}
