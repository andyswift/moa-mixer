import type { PartJudge } from './performance';
import type { Role } from './progress';
import { lessonSong, PARTS, type GameSong } from './songs';

/**
 * Lessons about how long notes last, and how they are struck: played along with the drums like a short song, and
 * scored on timing and on how long each note is held (and, on the bass, on its touch: dead notes soft, palm-muted
 * notes with the mod wheel up). Listen first, then play; nothing is new but the feel.
 */
export interface LengthLesson {
  readonly id: string;
  readonly role: Role;
  readonly track: 'technique';
  readonly title: string;
  readonly topic: string;
  readonly goal: string;
  readonly intro: readonly string[];
  readonly hint: string;
  readonly song: GameSong;
  /** Judge the touch: dead notes, palm muting, notes struck too softly. */
  readonly touch: boolean;
  readonly xp: number;
}

export const LENGTH_PASS_MARK = 0.7;

export const LENGTH_LESSONS: readonly LengthLesson[] = [
  {
    id: 'T2',
    role: 'synth',
    track: 'technique',
    title: 'Pads and stabs',
    topic: 'How long a chord lasts',
    goal: 'Hold it, or cut it short',
    intro: [
      'The same chord can be two different sounds. A pad is held through the whole bar and let go just before the next chord: a carpet under the band. A stab is struck and let go at once: a short, punchy hit on the beat.',
      'The first four bars are pads: one chord a bar, held until the next one. The last four are stabs: the chord on every beat, let go straight away, so the room between the hits is silent.',
      'The chart shows each chord as long as it should last, and fills in while you hold it. Notes are scored on timing and on their length.',
    ],
    hint: 'For a pad, count the bar out loud and let go on "four-and", just before the next chord. For a stab, think of touching a hot plate.',
    song: lessonSong('t2-pads-stabs', 'Pads and stabs', 96, 'synth', [
      { section: 'Pads', chord: 'C', part: PARTS.pad }, { section: 'Pads', chord: 'G', part: PARTS.pad },
      { section: 'Pads', chord: 'Am', part: PARTS.pad }, { section: 'Pads', chord: 'F', part: PARTS.pad },
      { section: 'Stabs', chord: 'C', part: PARTS.stab }, { section: 'Stabs', chord: 'G', part: PARTS.stab },
      { section: 'Stabs', chord: 'Am', part: PARTS.stab }, { section: 'Stabs', chord: 'F', part: PARTS.stab },
    ]),
    touch: false,
    xp: 120,
  },
  {
    id: 'B-T3',
    role: 'bass',
    track: 'technique',
    title: 'Long and short notes',
    topic: 'Filling the bar, or leaving space',
    goal: 'Long notes, short notes',
    intro: [
      'A bass line is as much about the gaps as the notes. A long note fills the bar and holds the band together; a short one leaves space for the kick drum to punch through.',
      'Four bars of long notes first: play the root on beat 1 and hold it until just before the next bar. Then four bars of short notes: the root on every beat, let go straight away.',
      'The chart shows each note as long as it should last, and the bar under it fills while you hold it. Listen first, then play.',
    ],
    hint: 'Long: count "one, two, three, four" and let go on "four-and". Short: let go as soon as you hear the note.',
    song: lessonSong('b-t3-long-short', 'Long and short notes', 80, 'bass', [
      { section: 'Long', chord: 'C', part: PARTS.longRoot }, { section: 'Long', chord: 'G', part: PARTS.longRoot },
      { section: 'Long', chord: 'Am', part: PARTS.longRoot }, { section: 'Long', chord: 'F', part: PARTS.longRoot },
      { section: 'Short', chord: 'C', part: PARTS.shortRoot }, { section: 'Short', chord: 'G', part: PARTS.shortRoot },
      { section: 'Short', chord: 'Am', part: PARTS.shortRoot }, { section: 'Short', chord: 'F', part: PARTS.shortRoot },
    ]),
    touch: false,
    xp: 110,
  },
  {
    id: 'B-T4',
    role: 'bass',
    track: 'technique',
    title: 'The palm',
    topic: 'Muting with the side of the hand',
    goal: 'Open, then muted',
    intro: [
      'Rest the side of your picking hand on the strings, right by the bridge, and every note comes out short and thumpy: palm muting. It tightens a bass line without changing a single note.',
      'Here the palm is the mod wheel. Four bars played open first (wheel down), the root on every beat. Then four bars with the palm (wheel up) and the same notes: listen to them go dull and short.',
      'The chart marks the palm bars, and the line above it says what comes next. Push the wheel up before the palm bars start and leave it there.',
    ],
    hint: 'Get the wheel up during the last open note, so the first palm note is already muted. Down for open, up for palm.',
    song: lessonSong('b-t4-palm', 'The palm', 80, 'bass', [
      { section: 'Open', chord: 'C', part: PARTS.quarterRoot }, { section: 'Open', chord: 'G', part: PARTS.quarterRoot },
      { section: 'Open', chord: 'Am', part: PARTS.quarterRoot }, { section: 'Open', chord: 'F', part: PARTS.quarterRoot },
      { section: 'Palm', chord: 'C', part: PARTS.quarterRoot }, { section: 'Palm', chord: 'G', part: PARTS.quarterRoot },
      { section: 'Palm', chord: 'Am', part: PARTS.quarterRoot }, { section: 'Palm', chord: 'F', part: PARTS.quarterRoot },
    ], ['Palm']),
    touch: true,
    xp: 110,
  },
  {
    id: 'B-T5',
    role: 'bass',
    track: 'technique',
    title: 'Dead notes',
    topic: 'The pitchless "chk"',
    goal: 'Dead notes',
    intro: [
      'A dead note is the string struck while the fretting hand only touches it: no pitch, just a percussive "chk" that keeps the groove moving between real notes.',
      'Here a dead note is a very soft note, as soft as your touch setup. Any key will do: a dead note has no pitch. Four bars of dead notes on their own first, on beats 2 and 4. Then four bars with the roots back on 1 and 3.',
      'Dead notes are marked DEAD on the chart, and the meter under it shows how hard each note landed: inside the shaded zone is dead. If your soft notes keep missing it, press Set my touch again.',
    ],
    hint: 'Rest a finger on the key and barely press it. Roots full, dead notes soft: think "boom, chk, boom, chk".',
    song: lessonSong('b-t5-dead', 'Dead notes', 80, 'bass', [
      { section: 'Dead notes alone', chord: 'C', part: PARTS.deadOnly }, { section: 'Dead notes alone', chord: 'G', part: PARTS.deadOnly },
      { section: 'Dead notes alone', chord: 'Am', part: PARTS.deadOnly }, { section: 'Dead notes alone', chord: 'F', part: PARTS.deadOnly },
      { section: 'With roots', chord: 'C', part: PARTS.deadBackbeat }, { section: 'With roots', chord: 'G', part: PARTS.deadBackbeat },
      { section: 'With roots', chord: 'Am', part: PARTS.deadBackbeat }, { section: 'With roots', chord: 'F', part: PARTS.deadBackbeat },
    ]),
    touch: true,
    xp: 110,
  },
];

export function lengthLessonById(id: string): LengthLesson | undefined {
  return LENGTH_LESSONS.find((l) => l.id === id);
}

/**
 * A length lesson's score: the mean of its sections' scores, so each thing it teaches counts the same however many
 * notes it has (four held pads count as much as sixteen stabs).
 */
export function lengthLessonScore(l: LengthLesson, judge: PartJudge): number {
  const parts = l.song.sections.slice(1).map((s) => judge.cues.map((c, i) => (c.t >= s.from && c.t < s.to ? i : -1)).filter((i) => i >= 0));
  const scored = parts.filter((p) => p.length);
  return scored.length ? scored.reduce((sum, p) => sum + judge.scoreFor(p), 0) / scored.length : 0;
}
