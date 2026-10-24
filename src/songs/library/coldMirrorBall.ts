import { GAUGES, SCALES, midiToHz, tensionFor } from '../../domain/devices/bassPhysics';
import { seeded, withDynamics } from '../feel';
import { note } from '../generators';
import type { Automation, NoteEvent, Song } from '../types';

/**
 * An original dark-disco instrumental for two basses, a guitar and a drum kit (working title): post-punk on a dance
 * floor. Four on the floor with open hats on the off-beats, the dub bass pumping disco octaves, the free bass carrying
 * the tune high on the neck through a chorus, and the guitar ringing arpeggios across open-string chords, chorused
 * and echoed. 124 bpm, B minor, all in 4/4.
 *
 * Intro, Hook, Lift, Hook′, Fog, Lift′, Hook″, Outro, a last chord (`PLAN`).
 *
 * Intro: the kick and hats, then the octaves, then the guitar's arpeggios. Hook: Bm G D A, the free bass's tune over
 * them. Lift: G A F#m Bm, the guitar's octave melody, the free bass holding long notes. Fog: the breakdown, the kick
 * and a floor tom driving eighths with no snare, the guitar's line through the flanger and a long echo, the free bass
 * coming in slow over Bm and Em; then a build into Lift′. Hook″ with everything, the Outro thinning to the kick.
 */
type Section = 'intro' | 'H' | 'L' | 'F' | 'O' | 'end';
const PLAN: [Section, number][] = [['intro', 8], ['H', 16], ['L', 8], ['H', 16], ['F', 16], ['L', 8], ['H', 16], ['O', 8], ['end', 2]];

interface Bar {
  section: Section;
  /** The bar's place in its block, from 0. */
  i: number;
  /** Where it starts, in beats. */
  start: number;
}
const BARS: Bar[] = [];
for (const [section, count] of PLAN) for (let i = 0; i < count; i++) BARS.push({ section, i, start: BARS.length * 4 });
/** Each block's first bar: where the band changes section. */
const BLOCKS = BARS.filter((bar) => bar.i === 0);
/** A block's bars. */
const barsOf = (block: Bar): Bar[] => BARS.slice(BARS.indexOf(block), BARS.indexOf(block) + PLAN[BLOCKS.indexOf(block)]![1]);

/** A note `len` eighths long at eighth `at` of a bar (or several, for a chord or a double-stop). */
function play(out: NoteEvent[], bar: Bar, at: number, pitches: number | readonly number[], len: number, vel: number): void {
  for (const p of typeof pitches === 'number' ? [pitches] : pitches) out.push(note(bar.start + at / 2, len / 2, p, vel));
}

const KIT = { kick: 36, stick: 37, snare: 38, floor: 41, hat: 42, pedal: 44, tom: 47, openHat: 46, crash: 49, ride: 51, bell: 53 } as const;

// ---- the harmony ----

type Chord = 'Bm' | 'G' | 'D' | 'A' | 'Em' | 'F#m';
/** Each chord: the dub bass's root (low), and the guitar's open-string voicing, five notes low to high. */
const CHORDS: Record<Chord, { root: number; voicing: readonly number[] }> = {
  Bm: { root: 35, voicing: [47, 54, 59, 62, 66] }, // Bm, F# on top
  G: { root: 31, voicing: [43, 50, 55, 59, 66] }, // Gmaj7
  D: { root: 38, voicing: [50, 57, 62, 66, 69] },
  A: { root: 33, voicing: [45, 52, 57, 61, 64] },
  Em: { root: 28, voicing: [40, 47, 55, 59, 66] }, // Em9
  'F#m': { root: 30, voicing: [42, 49, 54, 57, 61] },
};
/** Each section's chords, two bars each. */
const PROGRESSION: Record<Section, Chord[]> = {
  intro: ['Bm', 'G'], H: ['Bm', 'G', 'D', 'A'], L: ['G', 'A', 'F#m', 'Bm'], F: ['Bm', 'Bm', 'Em', 'Em', 'Bm', 'Bm', 'G', 'A'], O: ['Bm', 'G'], end: ['Bm'],
};
const chordOf = (bar: Bar): Chord => {
  const p = PROGRESSION[bar.section];
  return p[Math.floor(bar.i / 2) % p.length]!;
};

// ---- the parts' figures ([eighth, note, length in eighths], two bars unless said) ----

/** The free bass's tune in the Hook, one phrase a chord, high on the neck. */
const HOOK: Partial<Record<Chord, [number, number, number][]>> = {
  Bm: [[0, 66, 2], [2, 64, 1], [3, 62, 1], [4, 61, 2], [6, 62, 1], [7, 59, 1], [8, 59, 3], [11, 57, 1], [12, 54, 2], [14, 57, 1], [15, 59, 1]],
  G: [[0, 62, 2], [2, 61, 1], [3, 59, 1], [4, 57, 2], [6, 59, 1], [7, 55, 1], [8, 55, 3], [11, 54, 1], [12, 50, 2], [14, 54, 1], [15, 57, 1]],
  D: [[0, 66, 2], [2, 64, 1], [3, 62, 1], [4, 62, 2], [6, 64, 1], [7, 66, 1], [8, 66, 3], [11, 64, 1], [12, 62, 2], [14, 61, 1], [15, 62, 1]],
  A: [[0, 64, 2], [2, 62, 1], [3, 61, 1], [4, 57, 2], [6, 61, 1], [7, 64, 1], [8, 61, 4], [12, 57, 1], [13, 59, 1], [14, 61, 2]],
};
/** The free bass's long notes in the Lift. */
const HELD_L: Partial<Record<Chord, [number, number, number][]>> = {
  G: [[0, 55, 7], [8, 59, 7]], A: [[0, 57, 7], [8, 61, 7]], 'F#m': [[0, 54, 7], [8, 57, 7]], Bm: [[0, 59, 15]],
};
/** The free bass coming in slow in the Fog, by the block's chord pair (from its third pair on). */
const SLOW_F: [number, number, number][][] = [
  [[0, 62, 8], [8, 59, 8]], // Em
  [[0, 62, 8], [8, 59, 8]],
  [[0, 66, 6], [6, 64, 2], [8, 62, 8]], // Bm
  [[0, 66, 6], [6, 64, 2], [8, 61, 8]],
  [[0, 59, 4], [4, 62, 4], [8, 66, 8]], // G
  [[0, 64, 8], [8, 61, 8]], // A
];
/** The guitar's octave melody in the Lift (each note doubled an octave up). */
const OCTAVES_L: Partial<Record<Chord, [number, number, number][]>> = {
  G: [[0, 71, 4], [4, 74, 2], [6, 73, 2], [8, 71, 8]],
  A: [[0, 69, 4], [4, 73, 2], [6, 71, 2], [8, 69, 8]],
  'F#m': [[0, 66, 4], [4, 69, 2], [6, 73, 2], [8, 71, 8]],
  Bm: [[0, 66, 6], [6, 62, 2], [8, 66, 8]],
};
/** The guitar's line in the Fog, one bar, through the flanger: B D C# B A B F#. */
const LINE_F: [number, number, number][] = [[0, 71, 1], [1, 74, 1], [2, 73, 1], [3, 71, 1], [4, 69, 1], [5, 71, 1], [6, 66, 2]];
/**
 * A bar of picking, in sixteenths: [sixteenth, which of the voicing's notes (0 the lowest; several for a dyad), length
 * in sixteenths, accent], and where the muted scratches go between.
 */
interface Figure {
  notes: [number, number | number[], number, number][];
  scratches: number[];
}
const FIGURES: Record<'shimmer' | 'pulse' | 'hang' | 'run', Figure> = {
  // notes let ring over each other, an eighth apart
  shimmer: { notes: [[0, 0, 4, 1], [2, 3, 4, 0.75], [4, 4, 4, 0.85], [6, 2, 2, 0.65], [8, 1, 4, 0.9], [10, 4, 4, 0.8], [12, 3, 2, 0.7], [14, 2, 2, 0.65]], scratches: [7, 13] },
  // driving sixteenths, with gaps
  pulse: { notes: [[0, 0, 2, 1], [1, 2, 1, 0.6], [2, 4, 2, 0.8], [4, 3, 2, 0.75], [5, 2, 1, 0.55], [6, 4, 2, 0.8], [8, 1, 2, 0.9], [9, 3, 1, 0.55], [10, 4, 2, 0.8], [12, 2, 2, 0.7], [14, [3, 4], 2, 0.8]], scratches: [3, 11] },
  // dyads hung in the air
  hang: { notes: [[0, [0, 3], 6, 1], [6, 4, 2, 0.65], [8, [1, 4], 6, 0.9], [14, 2, 2, 0.6]], scratches: [4, 12] },
  // into a new section: up the strings, then the top three together
  run: { notes: [[0, 0, 2, 0.9], [2, 1, 2, 0.7], [4, 2, 2, 0.75], [6, 3, 2, 0.8], [8, 4, 2, 0.85], [10, 3, 1, 0.6], [11, 4, 1, 0.7], [12, [2, 3, 4], 4, 1]], scratches: [] },
};
/** The usual order of figures through a four-bar phrase. */
const PHRASE: (keyof typeof FIGURES)[] = ['shimmer', 'pulse', 'shimmer', 'hang'];
/** Whether a bar is its block's last. */
const lastOf = (bar: Bar) => BARS[BARS.indexOf(bar) + 1]?.i === 0;

function guitar(): NoteEvent[] {
  const out: NoteEvent[] = [];
  const random = seeded(1989);
  /**
   * The guitar's picking for a bar, as a player does it: a figure from the phrase (now and then another), a run up
   * into each new section, a quiet note left out here and there, the accents never quite even.
   */
  const jangle = (bar: Bar, soft: number, figure?: Figure) => {
    figure ??= lastOf(bar) && bar.section !== 'O' ? FIGURES.run
      : random() < 0.3 ? FIGURES[(['shimmer', 'pulse', 'hang'] as const)[Math.floor(random() * 3)]!]
      : FIGURES[PHRASE[bar.i % 4]!];
    const voicing = CHORDS[chordOf(bar)].voicing;
    for (const [s, which, len, accent] of figure.notes) {
      if (accent < 0.7 && random() < 0.15) continue;
      const vel = Math.round(80 * accent * soft * (0.93 + 0.14 * random()));
      play(out, bar, s / 2, typeof which === 'number' ? voicing[which]! : which.map((k) => voicing[k]!), len / 2, vel);
    }
    for (const s of figure.scratches) play(out, bar, s / 2, voicing[3]!, 0.12, 34);
  };
  for (const bar of BARS) {
    const { section, i } = bar;
    if (section === 'intro') {
      if (i >= 4) jangle(bar, 0.9);
    } else if (section === 'H') {
      jangle(bar, 1);
    } else if (section === 'L') {
      if (i % 2 === 0) for (const [e, p, len] of OCTAVES_L[chordOf(bar)]!) play(out, bar, e, [p, p + 12], len, e === 0 ? 92 : 82);
    } else if (section === 'F') {
      if (i < 12) for (const [e, p, len] of LINE_F) play(out, bar, e, p, len, e === 0 ? 88 : 76);
      else jangle(bar, 0.8 + (i - 12) * 0.06, lastOf(bar) ? FIGURES.run : FIGURES.pulse);
    } else if (section === 'O') {
      jangle(bar, 1);
    } else if (i === 0) {
      play(out, bar, 0, CHORDS.Bm.voicing, 15, 88); // the last chord, strummed and left to ring
    }
  }
  return out;
}

function dubBass(): NoteEvent[] {
  const out: NoteEvent[] = [];
  const random = seeded(1990);
  for (const bar of BARS) {
    const { section, i } = bar;
    const root = CHORDS[chordOf(bar)].root;
    if (section === 'end') {
      if (i === 0) play(out, bar, 0, root, 15, 108);
    } else if (section === 'F' && i < 12) {
      // the breakdown: straight eighths on the root, no octaves, pumping under the floor tom
      for (let e = 0; e < 8; e++) play(out, bar, e, root, 0.8, e % 2 === 0 ? 100 : 86);
    } else if (!(section === 'intro' && i < 2)) {
      // disco octaves: the root on the beat, an octave up off it
      // (now and then an octave swallowed to a dead note: the hand, not a sequencer)
      for (let e = 0; e < 8; e++) {
        if (e % 2 && random() < 0.12) play(out, bar, e, root + 12, 0.12, 36);
        else play(out, bar, e, e % 2 ? root + 12 : root, 0.45, e % 2 ? 90 : 104);
      }
    }
  }
  return out;
}

function freeBass(): NoteEvent[] {
  // single notes, never picked hard (a bass picked hard by the bridge goes sharp)
  const out: NoteEvent[] = [];
  for (const bar of BARS) {
    const { section, i } = bar;
    if (i % 2 !== 0) continue; // every figure is two bars
    if (section === 'H' || (section === 'O' && i < 4)) {
      for (const [e, p, len] of HOOK[chordOf(bar)]!) play(out, bar, e, p, len, e === 0 || e === 8 ? 96 : 86);
    } else if (section === 'L') {
      for (const [e, p, len] of HELD_L[chordOf(bar)]!) play(out, bar, e, p, len, 88);
    } else if (section === 'F' && i >= 4) {
      for (const [e, p, len] of SLOW_F[i / 2 - 2]!) play(out, bar, e, p, len, 84);
    } else if (section === 'end' && i === 0) {
      play(out, bar, 0, 54, 15, 86); // F#, over the last chord
    }
  }
  return out;
}

function kit(): NoteEvent[] {
  const out: NoteEvent[] = [];
  const random = seeded(1991);
  // every stroke a little different, as a drummer's are
  const hit = (bar: Bar, e: number, n: number, vel: number) => play(out, bar, e, n, 0.4, Math.round(vel * (0.94 + 0.12 * random())));
  /** A fill on the last two beats, one of three, picked as the drummer feels it. */
  const fills = [
    [KIT.tom, KIT.tom, KIT.floor, KIT.floor, KIT.tom, KIT.floor, KIT.floor, KIT.kick],
    [KIT.snare, KIT.tom, KIT.snare, KIT.tom, KIT.floor, KIT.kick, KIT.floor, KIT.floor],
    [KIT.snare, KIT.snare, KIT.snare, KIT.tom, KIT.tom, KIT.floor, KIT.floor, KIT.kick],
  ];
  const fill = (bar: Bar) => fills[Math.floor(random() * fills.length)]!.forEach((n, s) => hit(bar, 4 + s / 2, n, 84 + s * 4));
  /** Four on the floor: the kick on every beat, the snare on 2 and 4, open hats on the off-beats, closed between. */
  const disco = (bar: Bar, snare: boolean) => {
    for (const e of [0, 2, 4, 6]) hit(bar, e, KIT.kick, e === 0 ? 114 : 108);
    for (let s = 0; s < 16; s++) {
      const e = s / 2;
      if (s % 4 === 2) hit(bar, e, random() < 0.15 ? KIT.hat : KIT.openHat, 76); // the hat not always let open
      else if (s % 2 && random() < 0.1) continue; // a sixteenth left out
      else if (s % 4 !== 0) hit(bar, e, KIT.hat, s % 2 ? 42 : 52);
      else hit(bar, e, KIT.hat, 60);
    }
    if (snare) {
      hit(bar, 2, KIT.snare, 104); hit(bar, 6, KIT.snare, 106);
      if (random() < 0.3) hit(bar, random() < 0.5 ? 3.5 : 7.5, KIT.snare, 30); // a ghost note
    }
  };
  for (const bar of BARS) {
    const { section, i } = bar;
    if (section === 'intro') {
      disco(bar, i >= 4);
      if (i === 7) fill(bar);
    } else if (section === 'H' || section === 'L') {
      if (i % 8 === 7) {
        for (const e of [0, 2]) hit(bar, e, KIT.kick, 110);
        hit(bar, 2, KIT.snare, 104);
        fill(bar);
      } else disco(bar, true);
      if (i === 0 || (section === 'L' && i % 2 === 0)) hit(bar, 0, KIT.crash, section === 'L' ? 104 : 110);
    } else if (section === 'F') {
      if (i < 12) {
        // the kick on the beat, softer, and a floor tom driving eighths; no snare, the hats only on the beat
        for (const e of [0, 2, 4, 6]) { hit(bar, e, KIT.kick, 100); hit(bar, e, KIT.hat, 48); }
        for (let e = 0; e < 8; e++) {
          hit(bar, e, KIT.floor, e % 2 ? 58 : 74);
          if (e % 2 && random() < 0.15) hit(bar, e + 0.5, KIT.floor, 46); // a sixteenth pick-up on the tom now and then
        }
        if (i === 0) hit(bar, 0, KIT.crash, 96);
      } else if (i < 14) disco(bar, true);
      else {
        for (const e of [0, 2, 4, 6]) hit(bar, e, KIT.kick, 108);
        for (let s = 0; s < 16; s++) hit(bar, s / 2, KIT.snare, 44 + (i - 14) * 32 + s * 2); // the build into Lift′
      }
    } else if (section === 'O') {
      if (i < 6) disco(bar, true);
      else for (const e of [0, 2, 4, 6]) hit(bar, e, KIT.kick, 108 - (i - 6) * 12); // down to the kick
    } else if (i === 0) {
      hit(bar, 0, KIT.kick, 120); hit(bar, 0, KIT.crash, 116);
    }
  }
  return out;
}

/** How heavy each block is: never all out (the guitarist stays calm); the free bass leads in the Hooks. */
const HEAT: number[] = [0.1, 0.35, 0.5, 0.45, 0.2, 0.6, 0.6, 0.3, 0.2];
/**
 * How loud the band plays at a beat (1 as written), all of them together: a level per block (Intro, Hook, Lift, Hook′,
 * Fog, Lift′, Hook″, Outro, End), the Fog down low until its build, the last Hook biggest, the Outro fading; and every
 * four-bar phrase easing off after its first bar and swelling through its last, and into each new section.
 */
function level(beat: number): number {
  const k = Math.min(BARS.length - 1, Math.floor(beat / 4));
  const bar = BARS[k]!;
  const { i } = bar;
  const through = (beat - bar.start) / 4;
  const block = BLOCKS.filter((b) => b.start <= bar.start).length - 1;
  const base = [
    0.82 + (0.1 * i) / 7, 0.9, 1, 0.94, i < 12 ? 0.7 : 0.7 + (0.35 * (i - 12 + through)) / 4, 1.04, 1.08, 0.95 - (0.4 * (i + through)) / 8, 0.95,
  ][block]!;
  const p = i % 4;
  return base * ([1, 0.94, 0.96, 0.98][p]! + (p === 3 || lastOf(bar) ? 0.08 * through : 0));
}
const NAMES: string[] = ['Intro', 'Hook', 'Lift', 'Hook′', 'Fog', 'Lift′', 'Hook″', 'Outro', 'End'];

function automation(): Automation[] {
  /** A control set to a value for each section, stepping at every change of section. */
  const per = (page: Automation['page'], device: string, control: string, value: Partial<Record<Section, number>> & { rest: number }): Automation => {
    const points: [number, number][] = [];
    let last: number | undefined;
    for (const block of BLOCKS) {
      const v = value[block.section] ?? value.rest;
      if (last !== undefined && v !== last) points.push([block.start - 0.05, last]);
      if (v !== last) points.push([block.start, v]);
      last = v;
    }
    return { page, device, control, points };
  };
  return [
    // the guitar: chorused throughout; the Fog's line through the flanger, swept slowly, into a longer echo
    per('guitar', 'guitar', 'chorus.flange', { F: 1, rest: 0 }),
    per('guitar', 'guitar', 'chorus.rate', { F: 0.25, rest: 0.9 }),
    per('mixer', 'mixer', 'ch3.aux2', { L: 0.3, F: 0.45, rest: 0.2 }),
    // the free bass: up to lead in the Hooks, into the echo for the slow notes in the Fog
    per('mixer', 'mixer', 'ch2.fader', { H: 0.46, rest: 0.4 }),
    per('mixer', 'mixer', 'ch2.aux2', { F: 0.35, rest: 0.15 }),
  ];
}

export function coldMirrorBall(): Song {
  // the dub bass on flatwounds, each string pulled to the tension that tunes it (as in Odd Hours)
  const flat = (name: keyof typeof GAUGES) => Math.round(tensionFor({ ...GAUGES[name], winding: 'flat' }, SCALES.long, midiToHz(GAUGES[name].note)) * 10) / 10;
  return {
    id: 'cold-mirror-ball',
    title: 'Cold Mirror Ball',
    artist: 'The MOA Band',
    bpm: 124,
    key: 'B minor',
    bars: BARS.length,
    beatsPerBar: 4,
    sleeve: { art: 'frost', colors: ['#0c0b11', '#ff3ea5', '#3ee0ff', '#8a5cff'] },
    band: ['guitar', 'kit', 'bass', 'bass2', 'reverb', 'delay'],
    inputs: { ch1: 'MOA-BASS', ch2: 'MOA-BASS 2', ch3: 'MOA-GUITAR', line1: 'MOA-KIT' },
    setup: {
      guitar: { guitar: { controls: {
        // the middle and neck single coils, clean, bright and chorused: jangle
        'pickup.select': 'middle+neck', 'pickup.type': 'single', tone: 10, 'pluck.style': 'pick', 'pluck.position': 0.1, 'pluck.strength': 0.45,
        strum: 'down', 'strum.time': 12, 'drive.mix': 0,
        'chorus.mix': 0.7, 'chorus.rate': 0.9, 'chorus.depth': 0.6, 'chorus.flange': 0,
        'amp.gain': 0.2, 'amp.bass': -2, 'amp.mid': 0, 'amp.treble': 4, 'cab.type': '2x12', 'cab.blend': 0.8, level: 0.6,
      } } },
      bass: { bass: { controls: {
        'string.winding': 'flat', 'E.tension': flat('E'), 'A.tension': flat('A'), 'D.tension': flat('D'), 'G.tension': flat('G'),
        'pluck.style': 'pick', 'pluck.position': 0.12, 'pluck.strength': 0.5, 'pickup.position': 0.16, tone: 1800, palm: 0.2,
        'amp.gain': 0.3, 'amp.bass': 3, 'amp.mid': 0, 'amp.treble': -3, 'cab.type': '8x10', 'cab.mic': 'off-axis', 'cab.blend': 0.6, level: 0.9,
      } } },
      // the free bass: roundwounds, a pick high on the neck, a deep chorus (only above its low cut, so the bottom stays still)
      bass2: { bass: { controls: {
        'drive.mix': 0, 'chorus.mix': 0.65, 'chorus.rate': 0.7, 'chorus.depth': 0.7, 'chorus.flange': 0,
        'pluck.style': 'pick', 'pluck.position': 0.09, 'pluck.strength': 0.5, 'pickup.position': 0.09, tone: 5000,
        'amp.gain': 0.3, 'amp.mid': 4, 'amp.treble': 3, 'cab.type': '4x10', 'cab.blend': 0.5, level: 0.8,
      } } },
      kit: { kit: { controls: { 'snare.wires': 0.5 } } },
      // a dotted eighth at 124 bpm (363 ms), clean and wide
      delay: { delay: { controls: { 'delay.time': 363, 'delay.feedback': 0.38, 'delay.tone': 3600, 'delay.wobble': 0.1, 'delay.drive': 0.05, 'delay.spread': 0.9 } } },
      reverb: { reverb: { controls: { 'reverb.size': 'large', 'reverb.lowcut': 300, 'reverb.damp': 6500, 'reverb.predelay': 30 } } },
      mixer: { mixer: { controls: {
        // as Odd Hours' places; the accompaniment a little down (the guitar 1 dB, the dub bass 1) so the tune sits in front
        'ch1.fader': 0.62, 'ch1.pan': 0.15, 'ch1.aux1': 0.05,
        'ch2.fader': 0.4, 'ch2.pan': 0.5, 'ch2.aux1': 0.2, 'ch2.aux2': 0.15,
        'ch3.fader': 0.21, 'ch3.pan': -0.5, 'ch3.aux1': 0.22, 'ch3.aux2': 0.2,
        'line1.fader': 1.5, 'line1.aux1': 0.1,
        'ret1.fader': 0.85, 'ret2.fader': 0.7,
      } } },
    },
    tracks: {
      guitar: withDynamics(guitar(), level),
      kit: withDynamics(kit(), level),
      bass: withDynamics(dubBass(), level),
      // the tune swells with the band, half as much (a singer rides over it)
      bass2: withDynamics(freeBass(), (beat) => 0.5 + 0.5 * level(beat), 100),
    },
    automation: automation(),
    sections: BLOCKS.map((block, k) => ({ name: NAMES[k]!, from: block.start, to: block.start + barsOf(block).length * 4, meter: '4/4', heat: HEAT[k]! })),
    // a little swing on the sixteenths right through, as a disco drummer and the arpeggios sit
    swung: [{ from: 0, to: BARS.length * 4, amount: 54, grid: 16 }],
    humanise: { timing: { kit: 3, bass: 5, bass2: 7, guitar: 5 }, velocity: 0.06, layback: { kit: { 38: 4 } } },
  };
}
