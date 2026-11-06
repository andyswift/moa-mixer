import type { PresetValues } from '../devices/synthPresets';

/** One control a lesson hands to the player's knobs, in knob order (the first is knob 1). */
export interface LessonControl {
  readonly id: string;
  /** Tolerance as a share of the control's travel (see scoring.ts); a choice ignores it. */
  readonly tolerance: number;
  /** What to tell the player when the control is below / above the target. */
  readonly low: string;
  readonly high: string;
}

/** A note of a phrase: MIDI note, start and length in beats. */
export interface PhraseNote {
  readonly note: number;
  readonly at: number;
  readonly beats: number;
}

export interface Lesson {
  readonly id: string;
  readonly title: string;
  /** What the lesson is about, in a few words (the skill tree's second line). */
  readonly topic: string;
  /** The sound the player is asked to make. */
  readonly goal: string;
  /** The teaching, a paragraph each. */
  readonly intro: readonly string[];
  /** The panel at the start of the lesson; anything not listed is INIT. */
  readonly start: PresetValues;
  /** The target: the lesson controls' values (everything else stays as `start`). */
  readonly target: PresetValues;
  readonly controls: readonly LessonControl[];
  /** Shown beside the scores. */
  readonly hint: string;
  /** Played by "Hear the target" and "Hear yours". */
  readonly demo: { readonly bpm: number; readonly notes: readonly PhraseNote[] };
  /** Once the sound matches, the player plays these keys in order with it. */
  readonly riff: readonly number[];
  readonly xp: number;
}

const eighths = (bpm: number, notes: readonly number[], length = 0.45) => ({
  bpm,
  notes: notes.map((note, i) => ({ note, at: i * 0.5, beats: length })),
});
const longNotes = (bpm: number, notes: readonly number[], beats: number) => ({
  bpm,
  notes: notes.map((note, i) => ({ note, at: i * beats, beats: beats * 0.92 })),
});

const BASS_LINE = [45, 45, 57, 45, 48, 45, 43, 45];

/** The synth player's Sound Design track, in order: each lesson opens when the one before it is passed. */
export const SOUND_DESIGN: readonly Lesson[] = [
  {
    id: 'S1',
    title: 'The oscillator',
    topic: 'Waveforms, sub and range',
    goal: 'A hollow square bass',
    intro: [
      'Every sound on the SOLO-1 starts at the oscillator. The saw wave is bright and buzzy: it has every harmonic. The pulse wave at 50% is a square: hollow, woody, only the odd harmonics.',
      'The sub oscillator plays a square an octave below the note, for weight. Range moves the whole oscillator up or down in octaves.',
      'The target swaps the buzz for the hollow square, with a strong sub, an octave down. Listen for the change in colour, not in loudness.',
    ],
    start: {
      'osc.range': "8'", 'mix.saw': 0.8, 'mix.pulse': 0, 'mix.sub': 0.3, 'mix.noise': 0,
      'filter.cutoff': 6000, 'filterEnv.amount': 0, 'ampEnv.decay': 0.3, 'ampEnv.sustain': 0.8, 'ampEnv.release': 0.08,
    },
    target: { 'osc.range': "16'", 'mix.saw': 0, 'mix.pulse': 0.8, 'mix.sub': 0.65 },
    controls: [
      { id: 'osc.range', tolerance: 0, low: 'an octave too low', high: 'an octave too high' },
      { id: 'mix.saw', tolerance: 0.12, low: 'more saw', high: 'less saw: too buzzy' },
      { id: 'mix.pulse', tolerance: 0.12, low: 'more pulse: not hollow yet', high: 'less pulse' },
      { id: 'mix.sub', tolerance: 0.12, low: 'more sub: too thin', high: 'less sub: too heavy' },
    ],
    hint: 'Take the saw all the way out first, then bring the pulse up. The range switch steps an octave at a time.',
    demo: eighths(104, BASS_LINE),
    riff: [45, 57, 55, 48],
    xp: 100,
  },
  {
    id: 'S2',
    title: 'Low-pass filter',
    topic: 'Cutoff and resonance',
    goal: 'A dark pad with a ring',
    intro: [
      'The filter takes away. A low-pass filter lets the low frequencies through and cuts the highs above its cutoff. Turn the cutoff down and the sound gets darker and softer.',
      'Resonance boosts the frequencies right at the cutoff. A little gives the sound a nasal ring; a lot makes it whistle.',
      'The target is a dark pad with a clear ring at the cutoff. Close the filter until the buzz is gone, then add resonance until you hear it sing.',
    ],
    start: {
      'osc.range': "8'", 'mix.saw': 0.8, 'mix.pulse': 0, 'mix.sub': 0.3, 'mix.noise': 0,
      'filter.cutoff': 10000, 'filter.resonance': 1, 'filterEnv.amount': 0,
      'ampEnv.attack': 0.15, 'ampEnv.decay': 0.5, 'ampEnv.sustain': 0.9, 'ampEnv.release': 0.6,
    },
    target: { 'filter.cutoff': 900, 'filter.resonance': 9 },
    controls: [
      { id: 'filter.cutoff', tolerance: 0.06, low: 'too dark', high: 'too bright' },
      { id: 'filter.resonance', tolerance: 0.1, low: 'not enough ring', high: 'too much ring' },
    ],
    hint: 'Sweep the cutoff slowly while you hold a note: the right spot is where the buzz has just gone.',
    demo: longNotes(84, [57, 60, 64, 60], 2),
    riff: [57, 60, 64],
    xp: 100,
  },
  {
    id: 'S3',
    title: 'Envelopes',
    topic: 'ADSR on the filter',
    goal: 'A plucky bass',
    intro: [
      'An envelope is a shape in time that starts every time you press a key: Attack (how fast it rises), Decay (how fast it falls), Sustain (where it rests while you hold the key) and Release (how it fades after you let go).',
      'Here the envelope moves the filter. Env amount is how far it opens the filter; Decay is how fast it closes again; Sustain is how open it stays while the key is held.',
      'A pluck opens wide and snaps shut: lots of env amount, a short decay, no sustain. The note bites, then gets out of the kick drum\'s way.',
    ],
    start: {
      'osc.range': "16'", 'mix.saw': 0.8, 'mix.pulse': 0, 'mix.sub': 0.6, 'mix.noise': 0,
      'filter.cutoff': 250, 'filter.resonance': 3,
      'filterEnv.amount': 1, 'filterEnv.attack': 0.002, 'filterEnv.decay': 1.2, 'filterEnv.sustain': 0.45, 'filterEnv.release': 0.1,
      'ampEnv.decay': 0.4, 'ampEnv.sustain': 0.6, 'ampEnv.release': 0.08,
    },
    target: { 'filterEnv.amount': 3.5, 'filterEnv.decay': 0.2, 'filterEnv.sustain': 0 },
    controls: [
      { id: 'filterEnv.amount', tolerance: 0.08, low: 'not enough bite', high: 'too much bite' },
      { id: 'filterEnv.decay', tolerance: 0.07, low: 'too short', high: 'too long' },
      { id: 'filterEnv.sustain', tolerance: 0.1, low: 'too closed', high: 'too much sustain' },
    ],
    hint: 'Pull Sustain right down first, so you can hear Decay on its own. Then shorten Decay until each note snaps.',
    demo: eighths(112, BASS_LINE, 0.4),
    riff: [45, 45, 57, 43],
    xp: 120,
  },
  {
    id: 'S4',
    title: 'LFO',
    topic: 'Vibrato: rate and depth',
    goal: 'A singing vibrato lead',
    intro: [
      'An LFO is a low-frequency oscillator: too slow to hear as a note, it wobbles something else instead. Sent to the pitch, it makes vibrato.',
      'Rate is how fast it wobbles; Mod is how far the pitch moves. A singer\'s vibrato is around five or six wobbles a second, and only a fraction of a semitone deep.',
      'The target is a lead that sings, not one that wails. Find the speed first, then add just enough depth.',
    ],
    start: {
      'osc.range': "8'", 'mix.saw': 0.8, 'mix.pulse': 0.3, 'mix.sub': 0, 'mix.noise': 0,
      'filter.cutoff': 3500, 'filter.resonance': 2, 'filterEnv.amount': 1, 'filterEnv.decay': 0.4, 'filterEnv.sustain': 0.5,
      'ampEnv.attack': 0.02, 'ampEnv.sustain': 0.9, 'ampEnv.release': 0.3,
      'lfo.wave': 'tri', 'lfo.rate': 0.4, 'osc.mod': 0,
    },
    target: { 'lfo.rate': 5.5, 'osc.mod': 40 },
    controls: [
      { id: 'lfo.rate', tolerance: 0.07, low: 'too slow', high: 'too fast' },
      { id: 'osc.mod', tolerance: 0.025, low: 'too shallow', high: 'too deep: it wails' },
    ],
    hint: 'Turn Mod up high for a moment so you can hear the rate clearly, set the rate, then bring Mod back down.',
    demo: longNotes(84, [64, 62, 60, 62], 2),
    riff: [64, 62, 60, 62],
    xp: 120,
  },
];

/** The skill tree's other Sound Design steps, shown locked in this first pass. */
export const SOUND_DESIGN_LATER: readonly { id: string; title: string; topic: string }[] = [
  { id: 'S5', title: 'Pulse width and PWM', topic: 'Moving the pulse' },
  { id: 'S6', title: 'The patch cable', topic: 'Normalled vs patched' },
  { id: 'S7', title: 'High-pass + low-pass', topic: 'Two filters' },
  { id: 'S8', title: 'Ring mod, sync, S&H', topic: 'Anything from scratch' },
];

/** The lesson's whole panel at the target: its start with the target's values on top. */
export function targetValues(lesson: Lesson): PresetValues {
  return { ...lesson.start, ...lesson.target };
}

const NAMES = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B'];

/** A MIDI note's name with its octave, middle C (60) being C4. */
export function noteName(note: number): string {
  return `${NAMES[note % 12]}${Math.floor(note / 12) - 1}`;
}
