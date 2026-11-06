import type { PresetValues } from '../devices/synthPresets';
import { noteName } from './lessons';
import type { Role } from './progress';

/**
 * Playing lessons (Technique and Theory): the game asks for something, the player plays it on their keyboard, and the
 * game judges each answer. Sound Design lessons match knobs to a target instead (lessons.ts).
 */
export type Prompt =
  /**
   * One key. `octave` given: exactly that key (C4 is middle C); otherwise that note in any octave. `teach`: the game
   * shows and plays it first, and the answer does not count towards the score.
   */
  | { readonly kind: 'note'; readonly pc: number; readonly octave?: number; readonly teach?: boolean }
  /** Notes one after another, any octave, in this order (a root then its fifth); named after `name`, a chord. */
  | { readonly kind: 'sequence'; readonly name: string; readonly notes: readonly number[]; readonly teach?: boolean; readonly shown?: readonly number[] }
  /**
   * A triad held down, any octave and any order of its three notes. `teach`: the game shows and plays it first and
   * the answer does not count towards the score; `byEar`: the game plays it and names only the root.
   */
  | { readonly kind: 'chord'; readonly root: number; readonly quality: 'major' | 'minor'; readonly teach?: boolean; readonly byEar?: boolean };

export interface PlayLesson {
  readonly id: string;
  readonly role: Role;
  readonly track: 'technique' | 'theory';
  readonly title: string;
  readonly topic: string;
  readonly goal: string;
  readonly intro: readonly string[];
  readonly hint: string;
  /**
   * The mono SOLO-1, the MOA-6 poly (chords need more than one voice) or the MOA-BASS, with this sound over the
   * instrument's own defaults. On the bass, notes are as the bass sounds: an octave below the keys played.
   */
  readonly instrument: { readonly kind: 'mono' | 'poly' | 'bass'; readonly sound: PresetValues };
  readonly prompts: readonly Prompt[];
  readonly xp: number;
}

/** A playing lesson is passed when this share of its prompts was right first time. */
export const DRILL_PASS_MARK = 0.7;

const PC: Record<string, number> = { C: 0, D: 2, E: 4, F: 5, G: 7, A: 9, B: 11 };
const LETTERS = ['C', 'D', 'E', 'F', 'G', 'A', 'B'];
const NAMES = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B'];

const note = (name: string, octave?: number, teach = false): Prompt => ({ kind: 'note', pc: PC[name]!, octave, teach });
/** A chord's root then its fifth, on the bass (pitch classes: any octave). */
const rootFifth = (name: string, root: number, teach = false): Prompt =>
  ({ kind: 'sequence', name, notes: [root % 12, (root + 7) % 12], teach, shown: [root, root + 7] });
const chord = (root: string, quality: 'major' | 'minor', mode: 'teach' | 'test' | 'ear' = 'test'): Prompt =>
  ({ kind: 'chord', root: PC[root]!, quality, teach: mode === 'teach', byEar: mode === 'ear' });

export const TECHNIQUE: readonly PlayLesson[] = [
  {
    id: 'T1',
    role: 'synth',
    track: 'technique',
    title: 'Note names and octaves',
    topic: 'Find any note, fast',
    goal: 'Find the notes',
    intro: [
      'The white keys are named A to G, then the names start again. The black keys come in groups of two and three: C is the white key just left of each group of two, F the one just left of each group of three.',
      'From C, the white keys go C D E F G A B, then the next C. That distance, eight white keys from C to C, is an octave: the same note, twice as high.',
      'Middle C is C4, near the middle of most keyboards. The C below it is C3, the one above C5.',
    ],
    hint: 'Find the group of two black keys first: C is right below it, D sits between the two, E just above.',
    instrument: {
      kind: 'mono',
      sound: { 'mix.saw': 0.6, 'mix.pulse': 0.4, 'mix.sub': 0, 'mix.noise': 0, 'filter.cutoff': 2600, 'filterEnv.amount': 1, 'ampEnv.sustain': 0.8, 'ampEnv.release': 0.15 },
    },
    prompts: [note('C'), note('E'), note('G'), note('D'), note('A'), note('F'), note('B'), note('C', 4), note('C', 3), note('A', 4)],
    xp: 100,
  },
  {
    id: 'B-T1',
    role: 'bass',
    track: 'technique',
    title: 'The neck',
    topic: 'Open strings and the first frets',
    goal: 'Find the notes on the neck',
    intro: [
      'A bass has four strings, tuned E A D G from the lowest. Each fret raises a string by a half step, and the fifth fret of a string is the same note as the next string open: that is how a bass is tuned.',
      'Here you play the bass from your keyboard. It sounds an octave below the keys you press, the way bass parts are written, so the E key below middle C plays the open E string, E1. Hold the mod wheel up to rest your palm on the strings.',
      'Part 1 shows each note on the neck and plays it: copy it, nothing is scored. Part 2 asks for the same notes from memory.',
    ],
    hint: 'The open strings are E A D G, low to high. The third fret is three half steps up: G on the E string, C on the A string.',
    instrument: { kind: 'bass', sound: {} },
    prompts: [
      note('E', 1, true), note('A', 1, true), note('D', 2, true), note('G', 2, true), note('G', 1, true), note('C', 2, true),
      note('G', 1), note('D', 2), note('E', 1), note('C', 2), note('A', 1), note('G', 2),
    ],
    xp: 100,
  },
];

export const THEORY: readonly PlayLesson[] = [
  {
    id: 'H1',
    role: 'synth',
    track: 'theory',
    title: 'Major and minor triads',
    topic: 'Learn six, then play them',
    goal: 'Learn six chords',
    intro: [
      'A chord is notes played together. A triad, the most common chord, is three: the root (the note the chord is named after), the third and the fifth.',
      'Count in half steps: from one key to the very next, black or white. A major triad is the root, up 4, up 3 more. It sounds bright and settled.',
      'A minor triad is the root, up 3, up 4 more. It sounds darker, sadder. Only the middle note is different: one half step lower than in major.',
      'Part 1 shows you each chord and plays it: copy it on your keys. Nothing is scored. Part 2 asks for the same chords from memory, Part 3 by ear: those count.',
    ],
    hint: 'Shape your hand: in all of these the root, third and fifth sit on every other white key, except C minor, whose middle note is the black key E♭.',
    instrument: {
      kind: 'poly',
      // the MOA-6's Slow Strings, with an attack quick enough to hear a chord the game plays for a moment
      sound: {
        'filter.cutoff': 3200, 'filter.env': 0.6, 'filter.key': 70, 'osc.vibrato': 10, 'lfo.rate': 5.5,
        'env1.attack': 0.2, 'env1.decay': 1, 'env1.sustain': 0.7, 'env1.release': 0.9,
        'env2.attack': 0.18, 'env2.decay': 1, 'env2.sustain': 0.9, 'env2.release': 1, 'fx.chorus': 0.8, 'fx.mix': 0.12,
      },
    },
    prompts: [
      chord('C', 'major', 'teach'), chord('C', 'minor', 'teach'), chord('A', 'minor', 'teach'),
      chord('F', 'major', 'teach'), chord('G', 'major', 'teach'), chord('D', 'minor', 'teach'),
      chord('A', 'minor'), chord('F', 'major'), chord('C', 'major'), chord('D', 'minor'), chord('G', 'major'), chord('C', 'minor'),
      chord('C', 'major', 'ear'), chord('C', 'minor', 'ear'), chord('A', 'minor', 'ear'), chord('G', 'major', 'ear'),
    ],
    xp: 120,
  },
  {
    id: 'B-H1',
    role: 'bass',
    track: 'theory',
    title: 'Roots and fifths',
    topic: 'What a bass plays under a chord',
    goal: 'Root, then fifth',
    intro: [
      'Under a chord the bass usually plays its root: the note the chord is named after. The next most useful note is the fifth, seven half steps up. Root and fifth say which chord it is, and they fit major and minor chords alike.',
      'On the neck the fifth has one shape everywhere: one string up, two frets higher. Learn the shape once and it works for every chord.',
      'Part 1 shows the root and fifth for each chord and plays them: copy them, root first. Part 2 asks from memory.',
    ],
    hint: 'From the root, the fifth is seven half steps up: count on your keyboard, or on the neck go one string up and two frets along.',
    instrument: { kind: 'bass', sound: {} },
    prompts: [
      rootFifth('C', 36, true), rootFifth('F', 29, true), rootFifth('G', 31, true), rootFifth('Am', 33, true),
      rootFifth('Am', 33), rootFifth('C', 36), rootFifth('G', 31), rootFifth('F', 29), rootFifth('C', 36), rootFifth('G', 31),
    ],
    xp: 120,
  },
];

/** The notes of a chord prompt's triad (pitch classes, root first). */
export function triad(p: Extract<Prompt, { kind: 'chord' }>): number[] {
  const third = p.quality === 'major' ? 4 : 3;
  return [p.root, (p.root + third) % 12, (p.root + 7) % 12];
}

/**
 * A chord prompt's notes spelled as musicians write them: every other letter from the root, with a sharp or flat
 * where needed (C minor is C E♭ G, not C D# G). Roots are natural notes in these lessons.
 */
export function spellTriad(p: Extract<Prompt, { kind: 'chord' }>): string[] {
  const rootLetter = LETTERS.findIndex((l) => PC[l] === p.root);
  if (rootLetter < 0) return triad(p).map((n) => NAMES[n]!);
  return triad(p).map((pc, i) => {
    const letter = LETTERS[(rootLetter + 2 * i) % 7]!;
    const diff = (pc - PC[letter]! + 12) % 12;
    return letter + (diff === 1 ? '♯' : diff === 11 ? '♭' : '');
  });
}

/** Where the game shows a chord to copy, around middle C. */
export function guideTriad(p: Extract<Prompt, { kind: 'chord' }>): number[] {
  return voiceTriad(p).map((n) => n + 12);
}

/** The triad played in a comfortable place for the game to play it (root around C3-B3). */
export function voiceTriad(p: Extract<Prompt, { kind: 'chord' }>): number[] {
  const root = 48 + p.root;
  return [root, root + (p.quality === 'major' ? 4 : 3), root + 7];
}

/** What the prompt asks for, as the player reads it. An ear prompt hides the quality. */
export function promptLabel(p: Prompt): string {
  if (p.kind === 'note') return p.octave === undefined ? NAMES[p.pc]! : `${NAMES[p.pc]}${p.octave}`;
  if (p.kind === 'sequence') return `${p.name} · root, fifth`;
  return p.byEar ? `${NAMES[p.root]} ?` : `${NAMES[p.root]} ${p.quality}`;
}

/** A short name for a prompt's answer, as chord charts write it: C, C4, Am. */
export function shortLabel(p: Prompt): string {
  if (p.kind === 'note') return promptLabel(p);
  if (p.kind === 'sequence') return p.name;
  return `${NAMES[p.root]}${p.quality === 'minor' ? 'm' : ''}`;
}

/** The answer in full, for after a prompt is done. */
export function answerLabel(p: Prompt): string {
  if (p.kind === 'note') return promptLabel(p);
  if (p.kind === 'sequence') return `${p.name}: ${p.notes.map((n) => NAMES[n]).join(' then ')}`;
  return `${NAMES[p.root]} ${p.quality} · ${spellTriad(p).join(' ')}`;
}

export type Judgement = 'right' | 'wrong' | undefined;

/** Which part of a lesson a prompt belongs to, for the chord lesson's Learn / Build from memory / By ear. */
export function part(p: Prompt): 'learn' | 'test' | 'ear' {
  return p.teach ? 'learn' : p.kind === 'chord' && p.byEar ? 'ear' : 'test';
}

/**
 * One go at a playing lesson. Feed it the player's keys; it says when an answer is right or wrong and moves on.
 * A note prompt is judged on each key. A chord prompt is judged once three or more keys are down, once per attempt
 * (letting every key go starts a new attempt). A right answer moves on only when every key is up, so the next prompt
 * never shows while the last one is still held. Each prompt counts as
 * right only if the first attempt was right; the player still has to get it right to move on. Teaching prompts
 * have to be played too, but are left out of the score.
 */
export class DrillSession {
  private held = new Set<number>();
  private at = 0;
  private missed = new Set<number>();
  private judgedThisAttempt = false;
  private step = 0;
  /** The current prompt was answered right; the next one waits until every key is up. */
  private rightAndHeld = false;
  /** The key or chord last played, for feedback. */
  lastPlayed: number[] = [];

  constructor(readonly lesson: PlayLesson) {}

  get index(): number {
    return this.at;
  }

  /** How many notes of the current sequence prompt have been played right so far. */
  get sequenceStep(): number {
    return this.step;
  }

  get prompt(): Prompt | undefined {
    return this.lesson.prompts[this.at];
  }

  /** The current prompt is answered right and still held: it moves on when the keys come up. */
  get answered(): boolean {
    return this.rightAndHeld;
  }

  get done(): boolean {
    return this.at >= this.lesson.prompts.length;
  }

  /** Was prompt i right first time? (undefined while it has not been answered.) */
  firstTry(i: number): boolean | undefined {
    if (this.missed.has(i)) return false;
    return i < this.at || (i === this.at && this.rightAndHeld) ? true : undefined;
  }

  /** Share of the scored prompts right first time, 0..1. */
  get score(): number {
    const scored = this.lesson.prompts.map((_, i) => i).filter((i) => part(this.lesson.prompts[i]!) !== 'learn');
    const n = scored.length;
    return n ? (n - scored.filter((i) => this.missed.has(i)).length) / n : 1;
  }

  get passed(): boolean {
    return this.done && this.score >= DRILL_PASS_MARK;
  }

  /** A key goes down: judged against the current prompt (keys pressed while a right answer is still held are ignored). */
  keyDown(key: number): Judgement {
    this.held.add(key);
    const p = this.prompt;
    if (!p || this.rightAndHeld) return undefined;
    if (p.kind === 'note') {
      this.lastPlayed = [key];
      const right = key % 12 === p.pc && (p.octave === undefined || Math.floor(key / 12) - 1 === p.octave);
      return this.judge(right);
    }
    if (p.kind === 'sequence') {
      this.lastPlayed = this.step === 0 ? [key] : [...this.lastPlayed, key];
      if (key % 12 !== p.notes[this.step]) {
        this.step = 0;
        return this.judge(false);
      }
      if (++this.step < p.notes.length) return undefined;
      this.step = 0;
      return this.judge(true);
    }
    if (this.judgedThisAttempt || this.held.size < 3) return undefined;
    this.lastPlayed = [...this.held].sort((a, b) => a - b);
    const played = new Set([...this.held].map((n) => n % 12));
    const wanted = triad(p);
    const right = played.size === 3 && wanted.every((n) => played.has(n));
    this.judgedThisAttempt = true;
    return this.judge(right);
  }

  /** A key comes up. Returns true when that moved on to the next prompt: the last key of a right answer let go. */
  keyUp(key: number): boolean {
    this.held.delete(key);
    if (this.held.size > 0) return false;
    this.judgedThisAttempt = false;
    if (!this.rightAndHeld) return false;
    this.rightAndHeld = false;
    this.at++;
    return true;
  }

  private judge(right: boolean): Judgement {
    if (right) this.rightAndHeld = true;
    else this.missed.add(this.at);
    return right ? 'right' : 'wrong';
  }
}

/** Names of keys for feedback ("C4 E4 G4"). */
export function keysLabel(keys: readonly number[]): string {
  return keys.map(noteName).join(' ');
}
