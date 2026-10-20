/**
 * MOA-UNICORN's rhythm box and its One Key Play songs.
 *
 * The rhythms are a small keyboard's: a bar of sixteenth-note steps (twelve for the waltz, in 3/4), each step a
 * list of drum hits. The box plays them round and round on the audio clock, `LOOKAHEAD` ahead, each hit at its exact
 * time, and tells the page each beat so the unicorn can bounce along.
 *
 * One Key Play: a song is a list of notes; every key press plays the next one, whichever key it is, so anyone can
 * play the tune at once. The songs are traditional and out of copyright.
 */
export const LOOKAHEAD = 0.12;

export type DrumKind = 'kick' | 'snare' | 'hat' | 'clap' | 'wood' | 'bell';
type Step = [DrumKind, number][];

export interface Rhythm {
  name: string;
  /** Steps in a bar (16 for 4/4, 12 for 3/4). */
  steps: number;
  pattern: Step[];
}

/** A bar from a few lines of steps: 'x' a loud hit, 'o' a soft one, '.' nothing. */
function bar(lines: Partial<Record<DrumKind, string>>, steps = 16): Step[] {
  const out: Step[] = Array.from({ length: steps }, () => []);
  for (const [kind, line] of Object.entries(lines) as [DrumKind, string][]) {
    [...line.replace(/ /g, '')].forEach((c, i) => { if (c !== '.' && i < steps) out[i]!.push([kind, c === 'x' ? 1 : 0.55]); });
  }
  return out;
}

export const RHYTHMS: Record<string, Rhythm> = {
  rock: { name: 'Rock', steps: 16, pattern: bar({ kick: 'x... .... x.x. ....', snare: '.... x... .... x...', hat: 'x.o. x.o. x.o. x.o.' }) },
  pop: { name: 'Pop', steps: 16, pattern: bar({ kick: 'x... ..x. x... ....', clap: '.... x... .... x...', hat: '.ox. .ox. .ox. .ox.' }) },
  waltz: { name: 'Waltz', steps: 12, pattern: bar({ kick: 'x... .... ....', hat: '.... x... x...', wood: '.... o... o...' }, 12) },
  march: { name: 'March', steps: 16, pattern: bar({ kick: 'x... .... x... ....', snare: '.... x.o. .... x.oo', wood: 'o... o... o... o...' }) },
  disco: { name: 'Disco', steps: 16, pattern: bar({ kick: 'x... x... x... x...', clap: '.... x... .... x...', hat: '..x. ..x. ..x. ..x.', bell: '.... .... .... ..o.' }) },
};
export const RHYTHM_NAMES = Object.keys(RHYTHMS);

export interface RhythmOutput {
  hit(kind: DrumKind, velocity: number, when: number): void;
  /** Each beat (every four steps) as it is played, for the page to bounce on. */
  beat?(when: number, first: boolean): void;
}

export class RhythmBox {
  rhythm?: Rhythm;
  tempo = 110;
  private t0 = 0;
  private scheduled = 0;

  constructor(private readonly out: RhythmOutput) {}

  get playing(): boolean {
    return this.rhythm !== undefined;
  }
  private get stepSeconds(): number {
    return 60 / this.tempo / 4;
  }

  /** Starts a rhythm at `now` (or changes to it on the next step, keeping the beat), or stops with undefined. */
  set(rhythm: Rhythm | undefined, now: number): void {
    if (rhythm && this.rhythm) {
      this.rhythm = rhythm;
      return;
    }
    this.rhythm = rhythm;
    this.t0 = now + 0.05;
    this.scheduled = 0;
  }

  setTempo(bpm: number, now: number): void {
    const step = (now - this.t0) / this.stepSeconds;
    this.tempo = Math.min(200, Math.max(50, bpm));
    this.t0 = now - step * this.stepSeconds;
  }

  schedule(now: number): void {
    const r = this.rhythm;
    if (!r) return;
    const until = Math.ceil((now + LOOKAHEAD - this.t0) / this.stepSeconds);
    for (let s = this.scheduled; s < until; s++) {
      const when = this.t0 + s * this.stepSeconds;
      const i = s % r.steps;
      for (const [kind, velocity] of r.pattern[i]!) this.out.hit(kind, velocity, when);
      if (i % 4 === 0) this.out.beat?.(when, i === 0);
    }
    this.scheduled = Math.max(this.scheduled, until);
  }
}

// ---- One Key Play

export interface Song {
  name: string;
  /** [MIDI note, beats]. */
  notes: [number, number][];
}

const C = 60, D = 62, E = 64, F = 65, G = 67, A = 69, B = 71;
export const SONGS: Record<string, Song> = {
  // Norwegian, traditional; in D major as it is usually sung (F sharp and C sharp)
  mikkel: {
    name: 'Mikkel Rev',
    notes: [[66, 1], [69, 1], [62, 2], [66, 1], [69, 1], [62, 2], [67, 1], [71, 1], [74, 1], [71, 1], [71, 2], [69, 2],
      [66, 1], [69, 1], [62, 2], [66, 1], [69, 1], [62, 2], [64, 1], [66, 1], [67, 1], [61, 1], [64, 2], [62, 2]],
  },
  twinkle: {
    name: 'Twinkle Twinkle',
    notes: [[C, 1], [C, 1], [G, 1], [G, 1], [A, 1], [A, 1], [G, 2], [F, 1], [F, 1], [E, 1], [E, 1], [D, 1], [D, 1], [C, 2],
      [G, 1], [G, 1], [F, 1], [F, 1], [E, 1], [E, 1], [D, 2], [G, 1], [G, 1], [F, 1], [F, 1], [E, 1], [E, 1], [D, 2],
      [C, 1], [C, 1], [G, 1], [G, 1], [A, 1], [A, 1], [G, 2], [F, 1], [F, 1], [E, 1], [E, 1], [D, 1], [D, 1], [C, 2]],
  },
  lamb: {
    name: 'Mary Had a Little Lamb',
    notes: [[E, 1], [D, 1], [C, 1], [D, 1], [E, 1], [E, 1], [E, 2], [D, 1], [D, 1], [D, 2], [E, 1], [G, 1], [G, 2],
      [E, 1], [D, 1], [C, 1], [D, 1], [E, 1], [E, 1], [E, 1], [E, 1], [D, 1], [D, 1], [E, 1], [D, 1], [C, 4]],
  },
  joy: {
    name: 'Ode to Joy',
    notes: [[E, 1], [E, 1], [F, 1], [G, 1], [G, 1], [F, 1], [E, 1], [D, 1], [C, 1], [C, 1], [D, 1], [E, 1], [E, 1.5], [D, 0.5], [D, 2],
      [E, 1], [E, 1], [F, 1], [G, 1], [G, 1], [F, 1], [E, 1], [D, 1], [C, 1], [C, 1], [D, 1], [E, 1], [D, 1.5], [C, 0.5], [C, 2]],
  },
  farm: {
    name: 'Old MacDonald',
    notes: [[G, 1], [G, 1], [G, 1], [D, 1], [E, 1], [E, 1], [D, 2], [B, 1], [B, 1], [A, 1], [A, 1], [G, 3],
      [D, 1], [G, 1], [G, 1], [G, 1], [D, 1], [E, 1], [E, 1], [D, 2], [B, 1], [B, 1], [A, 1], [A, 1], [G, 3]],
  },
  bells: {
    name: 'Jingle Bells',
    notes: [[E, 1], [E, 1], [E, 2], [E, 1], [E, 1], [E, 2], [E, 1], [G, 1], [C, 1.5], [D, 0.5], [E, 4],
      [F, 1], [F, 1], [F, 1.5], [F, 0.5], [F, 1], [E, 1], [E, 1], [E, 0.5], [E, 0.5], [E, 1], [D, 1], [D, 1], [E, 1], [D, 2], [G, 2],
      [E, 1], [E, 1], [E, 2], [E, 1], [E, 1], [E, 2], [E, 1], [G, 1], [C, 1.5], [D, 0.5], [E, 4],
      [F, 1], [F, 1], [F, 1.5], [F, 0.5], [F, 1], [E, 1], [E, 1], [E, 0.5], [E, 0.5], [G, 1], [G, 1], [F, 1], [D, 1], [C, 4]],
  },
};
export const SONG_NAMES = Object.keys(SONGS);

/** Steps through a song one key press at a time; round again at the end. */
export class OneKeyPlay {
  private i = 0;
  constructor(readonly song: Song) {}

  /** The note the next press plays. */
  get next(): number {
    return this.song.notes[this.i]![0];
  }
  /** How far through the song (0..1). */
  get progress(): number {
    return this.i / this.song.notes.length;
  }

  /** A key was pressed: the song's next note, and whether that was the last one (the song is done). */
  press(): { note: number; done: boolean } {
    const note = this.song.notes[this.i]![0];
    this.i = (this.i + 1) % this.song.notes.length;
    return { note, done: this.i === 0 };
  }

  /** The whole song as notes in time (seconds from its start) at `bpm`, for listening to it. */
  timed(bpm: number): { note: number; at: number; length: number }[] {
    let beat = 0;
    return this.song.notes.map(([note, beats]) => {
      const n = { note, at: (beat * 60) / bpm, length: (beats * 0.9 * 60) / bpm };
      beat += beats;
      return n;
    });
  }
}
