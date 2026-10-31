import { newRigPattern, type RigPattern, type RigStep, type RigTrack } from '../sequencer/rigSequencer';
import { cloneKit, RIG_KITS } from './rigKit';
import { RIG_MULTI_VERSION, type RigMulti, type RigMultiPart } from './rigMulti';
import type { RigRoute, RigSide } from './rigParams';
import { RIG_PRESETS } from './rigPresets';
import { freshPart } from './rigSynth';

/**
 * The MOA-RIG's factory multis: whole set-ups that load like a saved multi.
 * - INIT · 8 PARTS: eight parts ready to play, the voices shared out, each on its own MIDI channel.
 * - SCALPEL · 135: raw, hypnotic techno: a driven kick and percussion loops of different lengths turning against
 *   each other, opening on tape strings, then a wavetable riff going from stabs to a wash and back, aliased digital
 *   blips in fives and nines against it, a bass rubbing G on F#, struck metal, dub stabs and noise; then a deep section, a
 *   bubbling bass under tape strings.
 * - ACID HOUSE: a tune for the rig's own sequencer, eight parts over a chain of four-bar patterns. The acid is the
 *   bassline, rolling all the way through; the others call and respond: the stab in bars 1 and 3, the arp in 2 and 4, and in
 *   the breakdown the words answer the pad.
 * - DARK ROOM · 110: Padded Cell's dark post-punk chug crossed with dubby, slow house. No chord changes: everything sits
 *   on F, with G flat leaning in now and then. The parts play into each other's gaps: the bass chugs and leaves holes for
 *   the stab, whose echoes fall into the next; the acid (12 steps) and the pluck (5, into Beads' delay) turn against the
 *   bar; a voice drops into the stab's long echoes; the strings only swell. A five-minute song over sixteen patterns:
 *   the voice given room without the strings, the acid taking the bass's place, both only at the peak.
 */
export interface RigFactoryMulti {
  name: string;
  build(): RigMulti;
}

const PARTS = 16;
const preset = (name: string) => {
  const p = RIG_PRESETS.find((x) => x.name === name);
  if (!p) throw new Error(`no factory sound ${name}`);
  return { slot: RIG_PRESETS.indexOf(p), a: p.a, b: p.b ?? p.a };
};
/** A sound: a factory one with params changed (and routings, if given). */
function sound(base: string, params: Record<string, number>, matrix?: RigRoute[]): { slot: number; a: RigSide; b: RigSide } {
  const p = preset(base);
  const side = (s: RigSide): RigSide => ({ params: { ...s.params, ...params }, matrix: (matrix ?? s.matrix).map((r) => ({ ...r })) });
  return { slot: p.slot, a: side(p.a), b: side(p.a) };
}
function multi(name: string, tempo: number, parts: Partial<RigMultiPart>[], patterns: RigPattern[] = [], chain: number[] = [], mix: Record<string, number> = {}): RigMulti {
  const all = Array.from({ length: 16 }, newRigPattern);
  patterns.forEach((p, i) => { all[i] = p; });
  return {
    v: RIG_MULTI_VERSION, name, tempo, shuffle: 0, current: chain[0] ?? 0, chain, mix, patterns: all,
    parts: Array.from({ length: PARTS }, (_, p) => ({ ...freshPart(p), voices: 0, ...(parts[p] ?? {}) })),
  };
}

// ---- a track's steps, written as [step, notes, options]
interface Hit { gate?: number; vel?: number; mod?: number; locks?: Record<string, number>; vels?: Record<number, number> }
type Steps = [step: number, notes: number | number[], hit?: Hit][];
function track(steps: Steps, length = 16, opts: Partial<RigTrack> = {}): RigTrack {
  const t = newRigPattern().tracks[0]!;
  Object.assign(t, { length, ...opts });
  for (const [i, n, h = {}] of steps) {
    const s: RigStep = t.steps[i]!;
    s.notes = Array.isArray(n) ? n : [n];
    s.vel = h.vel ?? 0.8;
    s.gate = h.gate ?? 0.5;
    if (h.mod !== undefined) s.mod = h.mod;
    if (h.locks) s.locks = h.locks;
    if (h.vels) s.vels = h.vels;
  }
  return t;
}
/** Sets SEQ mod values on a track's steps, one per step from `values`, without needing notes there. */
function mods(t: RigTrack, values: (i: number) => number): RigTrack {
  for (let i = 0; i < t.length; i++) t.steps[i]!.mod = Math.round(values(i) * 1000) / 1000 || 0; // never -0
  return t;
}
function pattern(tracks: Partial<Record<number, RigTrack>>, length = 64): RigPattern {
  const p = newRigPattern();
  p.length = length;
  for (const [i, t] of Object.entries(tracks)) p.tracks[Number(i)] = t!;
  return p;
}

// ================= INIT · 8 PARTS =================
const init8: RigFactoryMulti = {
  name: 'INIT · 8 PARTS',
  build: () => multi('8 Parts', 120, Array.from({ length: 8 }, (_, p) => ({ name: `Part ${p + 1}`, voices: 3, channel: p + 1 }))),
};

// ================= ACID HOUSE =================
// 124 BPM, A minor. Parts: 1 acid, 2 909, 3 perc, 4 chord stab, 5 sub, 6 pad, 7 vox, 8 arp.
const A1 = 33, A2 = 45, A3 = 57, C3 = 48, D3 = 50, E3 = 52, F3 = 53, G2 = 43, G3 = 55;
const ACID = 0, DRUMS = 1, PERC = 2, STAB = 3, SUB = 4, PAD = 5, VOX = 6, ARP = 7;
// 909 pads: notes 36 up
const BD = 36, CP = 39, CH = 42, PH = 44, OH = 46, CR = 49, RD = 51;
// Dub Mix pads
const RS = 37, CB = 48, GH = 43;

/**
 * The 303 bassline: two bars that roll all the way through, on the root with octave pops, the fifth and the minor
 * third. Slides where a note is tied into the next (gate past one step), accents by velocity. Written an octave up:
 * the part plays it an octave down (OSC 1 at -1).
 */
const E2 = 40;
function acidLine(cutoff: (i: number) => number): RigTrack {
  const n = 0.55, acc = 1, slide = 1.15;
  const t = track([
    [0, A2, { vel: acc }], [1, A2, { vel: n }], [2, A3, { vel: n, gate: slide }], [3, A2, { vel: n }],
    [5, C3, { vel: acc }], [6, A2, { vel: n }],
    [8, A2, { vel: n }], [9, A2, { vel: acc }], [10, G2, { vel: n, gate: slide }], [11, A2, { vel: n }],
    [13, E2, { vel: n }], [14, G2, { vel: n, gate: slide }], [15, A2, { vel: acc }],
    [16, A2, { vel: acc }], [17, A2, { vel: n }], [19, A3, { vel: n, gate: slide }],
    [20, A2, { vel: n }], [21, C3, { vel: acc }], [22, D3, { vel: n, gate: slide }], [23, E3, { vel: n }],
    [24, A2, { vel: acc }], [26, A2, { vel: n }], [27, G2, { vel: n, gate: slide }],
    [28, A2, { vel: n }], [29, C3, { vel: acc }], [30, A2, { vel: n, gate: slide }], [31, E2, { vel: n }],
  ], 32);
  return mods(t, cutoff);
}

function drums(opts: { kick?: boolean; clap?: boolean; hats?: boolean; open?: boolean; ride?: boolean; crash?: boolean }): RigTrack {
  const steps: Steps = [];
  for (let i = 0; i < 16; i++) {
    const notes: number[] = [];
    const vels: Record<number, number> = {};
    if (opts.kick && i % 4 === 0) notes.push(BD);
    if (opts.clap && (i === 4 || i === 12)) notes.push(CP);
    if (opts.open && i % 4 === 2) { notes.push(OH); vels[OH] = 0.7; }
    else if (opts.hats) { notes.push(i % 2 ? PH : CH); vels[i % 2 ? PH : CH] = i % 4 === 0 ? 0.85 : i % 2 ? 0.45 : 0.6; }
    if (opts.ride && i % 2 === 0) { notes.push(RD); vels[RD] = 0.35; }
    if (opts.crash && i === 0) notes.push(CR);
    if (notes.length) steps.push([i, notes, { vel: 0.9, vels }]);
  }
  return track(steps, 16);
}

const perc = (): RigTrack => track([[3, RS, { vel: 0.6 }], [7, RS, { vel: 0.45 }], [10, CB, { vel: 0.55 }], [11, RS, { vel: 0.6 }], [14, GH, { vel: 0.5 }]], 16);
/** The chord stab, the M1 organ's place in an acid house track: off the beat, minor (the CHORDS engine's 'm'). */
/** The stab calls, in bars 1 and 3 (the arp answers in 2 and 4). */
const stab = (): RigTrack => track([0, 32].flatMap((bar): Steps => [
  [bar + 3, A3, { vel: 0.9 }], [bar + 6, A3, { vel: 0.75 }], [bar + 10, A3, { vel: 0.9 }], [bar + 14, G3, { vel: 0.7 }],
]), 64);
/** The sub, under the breakdown only (the acid is the bass elsewhere): the pad's roots, a bar each. */
const sub = (): RigTrack => track([[0, A1], [16, A1 - 4], [32, A1 - 7], [48, A1 - 5]].map(([i, nt]): Steps[number] => [i!, nt!, { vel: 0.85, gate: 15.5 }]), 64);
/** The pad: Am9, Fmaj7, Dm9, Em7, a bar each. */
const pad = (): RigTrack => track([
  [0, [A3, 60, 64, 67, 71], { gate: 15.5, vel: 0.7 }], [16, [F3, A3, 60, 64], { gate: 15.5, vel: 0.7 }],
  [32, [D3, F3, A3, 60, 64], { gate: 15.5, vel: 0.7 }], [48, [E3, G3, 59, 62], { gate: 15.5, vel: 0.7 }],
], 64);
/** Words from the speech engine's banks: MORPH (locked on each step) picks which. */
/** Words answering the pad's chords (which change on each bar's downbeat): in bars 2 and 4, or the bars given. */
const vox = (words: number[], bars = [1, 3]): RigTrack => track(words.map((w, k): Steps[number] => [bars[k]! * 16 + 6, A3, { gate: 6, vel: 1, locks: { 'osc3.morph': w } }]), 64);
/** The arp answers the stab, in bars 2 and 4. */
const ARP_NOTES = [69, 72, 76, 79, 81, 79, 76, 72, 69, 72, 76, 84, 81, 79, 76, 72];
const arp = (): RigTrack => track([16, 48].flatMap((bar) => ARP_NOTES.map((n, i): Steps[number] => [bar + i, n, { vel: i % 4 === 0 ? 0.9 : 0.6, gate: 0.4 }])), 64);

const acidHouse: RigFactoryMulti = {
  name: 'ACID HOUSE',
  build: () => {
    const parts: Partial<RigMultiPart>[] = [];
    // 1: the 303 as the bassline: a saw (and OSC 1's sub) an octave down into the ladder, resonant but not shrieking,
    // legato with a glide, the cutoff on the sequencer's SEQ mod
    parts[ACID] = {
      name: 'Acid', voices: 1, channel: 1,
      ...sound('Acid Line', {
        'osc1.oct': 1, 'osc1.sub': 1, 'lad.cutoff': 170, 'lad.res': 0.7, 'lad.eg1': 0.42, drive: 0.6, 'eg1.d': 0.18,
        'voice.glide': 0.05, 'out.level': 1,
      }, [{ source: 'vel', dest: 'lad.cutoff', amount: 0.1 }, { source: 'seq', dest: 'lad.cutoff', amount: 0.4 }, { source: 'vel', dest: 'eg1.level', amount: 0.4 }]),
    };
    parts[DRUMS] = { name: 'Analogue 909', kind: 'kit', kit: cloneKit(RIG_KITS[0]!), channel: 10 };
    parts[PERC] = { name: 'Dub Mix', kind: 'kit', kit: cloneKit(RIG_KITS[1]!), channel: 11 };
    // 4: the stab: Plaits' CHORDS on OSC 3 (a minor chord, organ registration), a short envelope
    parts[STAB] = {
      name: 'Stab', voices: 3, channel: 4,
      ...sound('Init', {
        'osc3.mode': 1, 'osc3.model': 6, 'osc3.harm': 0.31, 'osc3.timbre': 0.45, 'osc3.morph': 0.3, 'mix.osc1': 0, 'mix.osc3': 1,
        'lad.cutoff': 5200, 'lad.res': 0.25, 'lad.eg1': 0.3, 'eg1.d': 0.18, 'eg2.d': 0.2, 'eg2.s': 0, 'eg2.r': 0.12, 'out.level': 1,
      }),
    };
    parts[SUB] = { name: 'Sub', voices: 1, channel: 5, ...sound('Sub Bass', { 'out.level': 0.7, 'eg2.d': 0.25, 'eg2.s': 0.6 }) };
    parts[PAD] = { name: 'Pad', voices: 12, channel: 6, ...sound('Glass Pad', { 'out.level': 0.45 }) };
    // 7: words: Plaits' SPEECH on OSC 3, HARMONICS in the word banks
    parts[VOX] = {
      name: 'Vox', voices: 3, channel: 7,
      ...sound('Init', {
        'osc3.mode': 1, 'osc3.model': 7, 'osc3.harm': 0.78, 'osc3.timbre': 0.5, 'osc3.morph': 0.2, 'mix.osc1': 0, 'mix.osc3': 1,
        'lad.cutoff': 9000, 'lad.eg1': 0, 'eg2.a': 0.002, 'eg2.s': 1, 'eg2.r': 0.3, 'out.level': 1,
      }),
    };
    // 8: a two-operator FM bell (Plaits' FM), sixteenths
    parts[ARP] = {
      name: 'Arp', voices: 4, channel: 8,
      ...sound('Init', {
        'osc3.mode': 1, 'osc3.model': 2, 'osc3.harm': 0.62, 'osc3.timbre': 0.35, 'osc3.morph': 0.55, 'mix.osc1': 0, 'mix.osc3': 1,
        'lad.cutoff': 7000, 'lad.eg1': 0, 'eg2.d': 0.25, 'eg2.s': 0, 'eg2.r': 0.2, 'out.level': 0.4,
      }),
    };

    // the acid's cutoff, as the SEQ mod source, per pattern: shut, opening, sweeping, low, wide open
    const sweep = (lo: number, hi: number, cycles: number) => (i: number) => lo + (hi - lo) * (0.5 - 0.5 * Math.cos((i / 32) * Math.PI * 2 * cycles));
    const patterns = [
      // 1 intro: kick, hats and the acid, shut
      pattern({ [ACID]: acidLine(sweep(0, 0.15, 1)), [DRUMS]: drums({ kick: true, hats: true }) }),
      // 2 groove: claps, open hats, perc and the sub; the acid opens
      pattern({ [ACID]: acidLine(sweep(0.1, 0.45, 1)), [DRUMS]: drums({ kick: true, clap: true, hats: true, open: true }), [PERC]: perc() }),
      // 3 main: the stab and the arp; the acid sweeps
      pattern({ [ACID]: acidLine(sweep(0.2, 0.75, 2)), [DRUMS]: drums({ kick: true, clap: true, hats: true, open: true }), [PERC]: perc(),
        [STAB]: stab(), [ARP]: arp() }),
      // 4 breakdown: no kick; the pad, the words, the acid low and the ride
      pattern({ [ACID]: acidLine(sweep(0, 0.3, 0.5)), [DRUMS]: drums({ ride: true, clap: true }), [PAD]: pad(), [SUB]: sub(), [VOX]: vox([0.1, 0.6]) }),
      // 5 drop: everything, a crash, the acid wide open
      pattern({ [ACID]: acidLine(sweep(0.55, 1, 4)), [DRUMS]: drums({ kick: true, clap: true, hats: true, open: true, crash: true }), [PERC]: perc(),
        [STAB]: stab(), [PAD]: pad(), [ARP]: arp(), [VOX]: vox([0.35]) }),
    ];

    // balanced by RMS (not peaks), against the 909: the acid rolling 6 dB under, the sub 3, the words 6, the rest 11 to 13
    const mix: Record<string, number> = {
      // the acid and the stab into the dub delay (3/16), the claps, pad and words into the hall
      'p1.a': 0.22, 'p1.c': 0.08, 'p1.fader': 0.6,
      'p2.c': 0.06, 'p2.fader': 1,
      'p3.a': 0.15, 'p3.c': 0.1, 'p3.pan': 0.25, 'p3.fader': 1.35,
      'p4.a': 0.35, 'p4.c': 0.2, 'p4.fader': 2, 'p4.lo': -8,
      'p5.fader': 0.9, 'p5.lo': 2,
      'p6.c': 0.35, 'p6.fader': 1.02, 'p6.mid': -6, 'p6.lo': -12,
      'p7.a': 0.3, 'p7.c': 0.3, 'p7.fader': 1.8,
      'p8.a': 0.35, 'p8.c': 0.2, 'p8.pan': -0.3, 'p8.fader': 1.95,
      'dub.sync': 1, 'dub.div': 3, 'dub.fdbk': 0.45, 'dub.tone': 2200, 'dub.wow': 0.2,
      'rev.type': 2, 'rev.size': 0.55, 'rev.damp': 0.45, 'rev.pre': 0.03,
      'rA.lo': -6, 'rA.fader': 0.8, 'rC.fader': 0.8,
      // the master compressor keyed by the 909 (part 2, before its fader): the pad and sub breathe with the kick
      'cmp.key': 2, 'cmp.ratio': 3, 'cmp.thresh': -20, 'cmp.atk': 2, 'cmp.rel': 180, 'cmp.hpf': 20, 'cmp.mix': 0.7,
    };
    // intro, groove, main twice, breakdown, drop twice: 28 bars
    return multi('Acid House', 124, parts, patterns, [0, 1, 2, 2, 3, 4, 4], mix);
  },
};

// ================= SCALPEL · 135 =================
// Raw, hypnotic techno in the Birmingham and Detroit way: a driven kick, percussion loops of different lengths
// turning against each other (16, 12, 10, 7 and 6 steps), a one-note bass riff, struck metal, dub stabs, noise.
const SC = { KICK: 0, HATS: 1, PERC: 2, TOMS: 3, BASS: 4, METAL: 5, STAB: 6, NOISE: 7, BUBBLY: 8, STRINGS: 9, SHAKER: 10, SYNTH: 11, DIGI5: 12, DIGI9: 13 };
const LT = 41, MT = 43, HT = 45;

const scKick = (ghost: boolean): RigTrack => track([
  ...[0, 4, 8, 12].map((i): Steps[number] => [i, BD, { vel: 1 }]),
  ...(ghost ? [[14, BD, { vel: 0.55 }]] as Steps : []),
], 16);
/** Open hats off the beat; closed sixteenths that come and go (probability) with a hand on the accents. */
function scHats(closed: boolean, ride = false): RigTrack {
  const steps: Steps = [];
  for (let i = 0; i < 16; i++) {
    const notes: number[] = [], vels: Record<number, number> = {};
    if (i % 4 === 2) { notes.push(OH); vels[OH] = 0.75; }
    else if (closed) { notes.push(CH); vels[CH] = [0.9, 0.4, 0, 0.6][i % 4]!; }
    if (ride && i % 2 === 0) { notes.push(RD); vels[RD] = 0.3; }
    if (notes.length) steps.push([i, notes, { vel: 0.9, vels }]);
  }
  const t = track(steps, 16);
  for (let i = 0; i < 16; i++) if (i % 4 !== 2 && t.steps[i]!.notes.length) t.steps[i]!.prob = i % 4 === 0 ? 1 : 0.75;
  return t;
}
/** Rims and cowbell, twelve steps: they come round three times in four bars, in a new place each time. */
const scPerc = (): RigTrack => track([[0, RS, { vel: 0.8 }], [3, RS, { vel: 0.5 }], [5, CB, { vel: 0.45 }], [7, RS, { vel: 0.7 }], [10, RS, { vel: 0.5 }]], 12);
/** Toms, ten steps, a little off the grid. */
function scToms(): RigTrack {
  const t = track([[0, LT, { vel: 0.85 }], [3, MT, { vel: 0.6 }], [5, LT, { vel: 0.5 }], [7, HT, { vel: 0.55 }], [8, MT, { vel: 0.7 }]], 10);
  t.steps[3]!.micro = 0.08; t.steps[7]!.micro = -0.06; t.steps[5]!.prob = 0.7;
  return t;
}
/** The bass: six steps long, against the four-to-the-floor, G rubbing on the F# under it (as the set does). */
const scBass = (): RigTrack => track([[0, G2, { vel: 1 }], [2, G2, { vel: 0.6 }], [3, G3, { vel: 0.7, gate: 1.1 }], [5, 42, { vel: 0.8 }]], 6);
/** Struck metal, seven steps. */
const scMetal = (): RigTrack => track([[0, 76, { vel: 0.9 }], [4, 81, { vel: 0.6 }]], 7);
/** Dub stabs, thrown into the delay: twice in two bars. */
const scStab = (): RigTrack => track([[6, G3, { vel: 0.9 }], [22, 54, { vel: 0.75 }]], 32);
/** A noise riser: a note a bar, each held the bar (a gate is at most 16 steps; the envelope carries on across them),
 * the filter opening over the four bars (the SEQ mod lane). */
/** The deep section, after the 36th minute of Surgeon's live set at Machina Bristronica 2024: a bass rolling on F# in sixteenths (the
 * 1st and 4th of each beat leaning in), rubbing on G and stepping up to A and A#, two bars round. */
const F2 = 42, G2b = 43, A2b = 45, As2 = 46;
const scBubbly = (): RigTrack => track([F2, F2, F2, G2b, F2, F2, A2b, F2, F2, F2, F2, As2, F2, G2b, F2, F2,
  F2, F2, F2, G2b, F2, F2, A2b, F2, F2, F2, As2, A2b, F2, G2b, F2, F2].map((n, i): Steps[number] => [i, n, { vel: [1, 0.7, 0.5, 0.95][i % 4]!, gate: 0.6 }]), 32);
/** Tape strings over it, major sevenths a third apart: Abmaj7, F#maj7, Dmaj7, Abmaj7, two bars each (over two
 * patterns), bowed again each bar. */
const ABMAJ7 = [56, 60, 63, 67], FSMAJ7 = [54, 58, 61, 65], DMAJ7 = [50, 54, 57, 61];
const scStrings = (first: number[], second: number[]): RigTrack =>
  track([[0, first], [16, first], [32, second], [48, second]].map(([i, ch]): Steps[number] => [i as number, ch as number[], { vel: 0.8, gate: 16 }]), 64);
/** A shaker in sixteenths, leaning on the "and", the in-between ones a little late (a hand, not a grid). */
function scShaker(): RigTrack {
  const t = track(Array.from({ length: 16 }, (_, i): Steps[number] => [i, 60, { vel: [0.45, 0.7, 1, 0.7][i % 4]!, gate: 0.3 }]), 16);
  for (let i = 1; i < 16; i += 2) t.steps[i]!.micro = 0.06;
  return t;
}
/** The synth riff under the opening, after the set around its 7th minute: a sixteenth line round C and the B under
 * it, two bars, leaning on the third and fourth sixteenth of each beat. Four bars long, so the SEQ lane (`shape`, over
 * the four bars) can play the envelopes: 0 short stabs, 1 the lush wash. In the break, the first bar only. */
const SYNTH_RIFF = [60, 59, 55, 56, 59, 60, 59, 52, 52, 59, 62, 59, 63, 54, 52, 60, 59, 60, 58, 59, 59, 63, 60, 60, 60, 60, 60, 60, 60, 58, 59, 60];
/** `opens`: now and again the ladder lets more through, locked open over a few steps ([from, to, cutoff Hz]). */
const scSynth = (shape: (x: number) => number, bars = 2, opens: [number, number, number][] = []): RigTrack => {
  const riff = SYNTH_RIFF.slice(0, bars * 16);
  const t = mods(track(Array.from({ length: 64 }, (_, i): Steps[number] =>
    [i, riff[i % riff.length]!, { vel: [0.6, 0.6, 0.9, 0.95][i % 4]!, gate: 0.9 }]), 64), (i) => shape(i / 63));
  for (const [from, to, hz] of opens) for (let i = from; i <= to; i++) t.steps[i]!.locks = { 'lad.cutoff': hz };
  return t;
};
/** Aliased digital blips against it, in loops of 5 and of 9 steps (round the 16 in new places every bar): high, on
 * the riff's notes, one part a side, answering each other. */
const scDigi5 = (): RigTrack => track([[0, 72, { vel: 0.9, gate: 0.4 }], [2, 71, { vel: 0.6, gate: 0.4 }], [3, 79, { vel: 0.75, gate: 0.4 }]], 5);
const scDigi9 = (): RigTrack =>
  track([[0, 75, { vel: 0.85, gate: 0.4 }], [3, 72, { vel: 0.6, gate: 0.4 }], [5, 67, { vel: 0.7, gate: 0.4 }], [7, 74, { vel: 0.55, gate: 0.4 }]], 9);
const scNoise = (): RigTrack => mods(track([0, 16, 32, 48].map((i): Steps[number] => [i, A3, { gate: 16, vel: 0.9 }]), 64), (i) => (i / 63) ** 2);

const scalpel: RigFactoryMulti = {
  name: 'SCALPEL · 135',
  build: () => {
    const parts: Partial<RigMultiPart>[] = [];
    const kick = cloneKit(RIG_KITS[0]!);
    kick.pads[0]!.analog = { 'kick.tune': 48, 'kick.decay': 0.55, 'kick.click': 0.55 };
    kick.name = 'Driven Kick';
    parts[SC.KICK] = { name: 'Kick', kind: 'kit', kit: kick, channel: 10 };
    // the ride let ring as the 909's does (its pad's filter taking off the air), the cowbell the 808's own
    const hats = cloneKit(RIG_KITS[0]!), perc = cloneKit(RIG_KITS[1]!);
    Object.assign(hats.pads[RD - 36]!, { analog: { 'ride.decay': 1.3 }, cutoff: 9000 });
    perc.pads[CB - 36]!.analog = {};
    parts[SC.HATS] = { name: 'Hats', kind: 'kit', kit: hats, channel: 11 };
    parts[SC.PERC] = { name: 'Perc', kind: 'kit', kit: perc, channel: 12 };
    parts[SC.TOMS] = { name: 'Toms', kind: 'kit', kit: cloneKit(RIG_KITS[0]!), channel: 13 };
    // 5-8: the RIG's techno sounds (short, dry, driven), the delay doing the rest
    parts[SC.BASS] = { name: 'Bass', voices: 1, channel: 5, ...sound('Techno Bass', { 'out.level': 1 }) };
    parts[SC.METAL] = { name: 'Metal', voices: 1, channel: 6, ...sound('Metal Hit', { 'out.level': 1 }) };
    parts[SC.STAB] = { name: 'Stab', voices: 1, channel: 7, ...sound('Techno Stab', { 'out.level': 1 }) };
    parts[SC.NOISE] = { name: 'Noise', voices: 1, channel: 8, ...sound('Noise Sweep', { 'out.level': 1 }) };
    parts[SC.BUBBLY] = { name: 'Bubbly', voices: 1, channel: 9, ...sound('Bubbly Bass', { 'out.level': 1 }) };
    parts[SC.STRINGS] = { name: 'Strings', voices: 8, channel: 1, ...sound('Tape Strings', { 'out.level': 1 }) };
    parts[SC.SHAKER] = { name: 'Shaker', voices: 1, channel: 2, ...sound('Shaker', { 'out.level': 1 }) };
    parts[SC.SYNTH] = { name: 'Synth', voices: 6, channel: 3, ...sound('Table Poly', { 'out.level': 1 }) };
    parts[SC.DIGI5] = { name: 'Digi 5', voices: 2, channel: 4, ...sound('Digi Blip', { 'out.level': 1 }) };
    // the other: PPG SYNC instead of DIGI, an octave lower, a touch longer
    parts[SC.DIGI9] = { name: 'Digi 9', voices: 2, channel: 14, ...sound('Digi Blip', { 'osc3.table': 1, 'osc3.oct': 2, 'eg2.d': 0.14, 'out.level': 1 }) };

    const patterns = [
      // 1 intro: the kick, the hats, the twelve-step perc, and the strings from the first bar (their first four)
      pattern({ [SC.STRINGS]: scStrings(ABMAJ7, FSMAJ7), [SC.KICK]: scKick(false), [SC.HATS]: scHats(false), [SC.PERC]: scPerc() }),
      // 2 build: closed hats come in, the toms, the bass, and the synth riff, stabbing
      pattern({ [SC.SYNTH]: scSynth((x) => 0.1 * x, 2, [[60, 63, 450]]), [SC.KICK]: scKick(false), [SC.HATS]: scHats(true), [SC.PERC]: scPerc(), [SC.TOMS]: scToms(), [SC.BASS]: scBass() }),
      // 3 main: the metal and the stabs; the synth opening out and closing again, the five-step blips against it
      pattern({ [SC.SYNTH]: scSynth((x) => Math.sin(Math.PI * x), 2, [[28, 31, 600], [48, 63, 900]]), [SC.DIGI5]: scDigi5(), [SC.SHAKER]: scShaker(), [SC.KICK]: scKick(false), [SC.HATS]: scHats(true), [SC.PERC]: scPerc(), [SC.TOMS]: scToms(), [SC.BASS]: scBass(),
        [SC.METAL]: scMetal(), [SC.STAB]: scStab() }),
      // 4 break: no kick, but never hollow: the bass and the perc carry on under the toms, the stabs into the delay, the noise rising
      pattern({ [SC.SYNTH]: scSynth(() => 1, 1), [SC.DIGI9]: scDigi9(), [SC.HATS]: scHats(false), [SC.PERC]: scPerc(), [SC.TOMS]: scToms(), [SC.BASS]: scBass(), [SC.STAB]: scStab(),
        [SC.METAL]: scMetal(), [SC.NOISE]: scNoise() }),
      // 5 peak: everything, a ghost kick and the ride
      pattern({ [SC.SYNTH]: scSynth((x) => 0.5 + 0.5 * Math.cos(4 * Math.PI * x), 2, [[12, 15, 700], [44, 47, 600], [56, 63, 900]]), [SC.DIGI5]: scDigi5(), [SC.DIGI9]: scDigi9(), [SC.SHAKER]: scShaker(), [SC.KICK]: scKick(true), [SC.HATS]: scHats(true, true), [SC.PERC]: scPerc(), [SC.TOMS]: scToms(), [SC.BASS]: scBass(),
        [SC.METAL]: scMetal(), [SC.STAB]: scStab() }),
      // 6, 7 deep: the kick, the hats and perc, the bubbling bass under the strings (eight bars over the two)
      pattern({ [SC.SHAKER]: scShaker(), [SC.KICK]: scKick(false), [SC.HATS]: scHats(true), [SC.PERC]: scPerc(), [SC.BUBBLY]: scBubbly(),
        [SC.STRINGS]: scStrings(ABMAJ7, FSMAJ7) }),
      pattern({ [SC.SHAKER]: scShaker(), [SC.KICK]: scKick(false), [SC.HATS]: scHats(true, true), [SC.PERC]: scPerc(), [SC.BUBBLY]: scBubbly(),
        [SC.STRINGS]: scStrings(DMAJ7, ABMAJ7) }),
      // 8 intro, the strings' second four bars
      pattern({ [SC.STRINGS]: scStrings(DMAJ7, ABMAJ7), [SC.KICK]: scKick(false), [SC.HATS]: scHats(false), [SC.PERC]: scPerc() }),
    ];

    const mix: Record<string, number> = {
      // the kick driven (the insert), and keying the compressor; the rest balanced against it. Matched to a Surgeon
      // live set (measured): dark on top (the hats, metal, noise and returns cut over 4 kHz), the weight in the mids
      // (the perc, toms and bass pushed at 1 kHz), the percussion spread wide. And the dub delay everywhere, as he
      // plays it: the stabs and metal deep in it, the perc and toms and a touch of the bass; long, dark, saturating repeats
      'drv.part': 1, 'drv.type': 0, 'drv.drive': 0.6, 'drv.tone': 0.5, 'drv.blend': 1, 'drv.level': 1,
      'p1.fader': 0.63, 'p1.lo': 2,
      'p2.fader': 1.3, 'p2.pan': 0.2, 'p2.c': 0.05, 'p2.hi': -3,
      'p3.fader': 2, 'p3.pan': -0.5, 'p3.a': 0.35, 'p3.c': 0.12, 'p3.mid': 3, 'p3.hi': -1,
      'p4.fader': 0.95, 'p4.pan': 0.45, 'p4.a': 0.3, 'p4.c': 0.15, 'p4.mid': 3,
      'p5.fader': 1.9, 'p5.mid': 1, 'p5.a': 0.12,
      'p6.fader': 2, 'p6.pan': 0.4, 'p6.a': 0.5, 'p6.c': 0.25, 'p6.lo': -10, 'p6.hi': -5,
      'p7.fader': 2, 'p7.pan': -0.25, 'p7.a': 0.75, 'p7.c': 0.2, 'p7.lo': -8, 'p7.mid': 3,
      'p8.fader': 2, 'p8.c': 0.3, 'p8.lo': -12, 'p8.hi': -6,
      // the bubbling bass a touch into the delay; the strings behind, through the chorus and the hall
      'p9.fader': 1.9, 'p9.a': 0.12,
      'p11.fader': 1, 'p11.pan': 0.35, 'p11.c': 0.1,
      'p12.fader': 0.89, 'p12.lo': -3, 'p12.a': 0.3, 'p12.b': 0.66, 'p12.c': 0.3, 'p12.d': 0.3,
      // the BBD (B) as the user set it: synced, aged dark, its repeats wobbling, in the middle (no ping-pong:
      // focused); the synth well into it, the bass a good way
      'p5.b': 0.81,
      'bbd.sync': 1, 'bbd.fdbk': 0.49, 'bbd.age': 0.59, 'bbd.mod': 0.42, 'bbd.rate': 1.54, 'bbd.ping': 0,
      // the blips a side each, into the delay so they answer each other
      'p13.fader': 0.8, 'p13.pan': -0.6, 'p13.a': 0.35, 'p13.hi': -2,
      'p14.fader': 0.8, 'p14.pan': 0.6, 'p14.a': 0.35, 'p14.hi': -2,
      'p10.fader': 0.7, 'p10.lo': -4, 'p10.c': 0.35, 'p10.d': 0.3,
      'dub.sync': 1, 'dub.div': 3, 'dub.fdbk': 0.75, 'dub.tone': 1300, 'dub.wow': 0.35, 'dub.sat': 0.6,
      'rev.type': 2, 'rev.size': 0.7, 'rev.damp': 0.75, 'rev.pre': 0.02,
      'rA.lo': -8, 'rA.hi': -4, 'rA.filter': 0.15, 'rA.fader': 1, 'rC.fader': 0.8, 'rC.lo': -6, 'rC.hi': -5,
      'cmp.key': 1, 'cmp.ratio': 3, 'cmp.thresh': -22, 'cmp.atk': 2, 'cmp.rel': 140, 'cmp.mix': 0.8,
      // the master onto tape, hard: dense as the set is (its peaks some 8 dB over its level, the kick and bass one
      // block rather than spikes), and a little darker
      'tape.drive': 12, 'tape.tone': 0.5,
    };
    return multi('Scalpel', 135, parts, patterns, [0, 7, 1, 2, 2, 3, 4, 4, 5, 6, 5, 6], mix);
  },
};

// ================= DARK ROOM · 110 =================
// 110 BPM, on F (minor), never leaving it: G flat (the flat second) leans in at the ends of phrases. The movement is in
// how the parts lock together, not in chords.
const DR = { KIT: 0, BASS: 1, ACID: 2, STAB: 3, STRINGS: 4, PLUCK: 5, WORDS: 7, CONGA: 8, SHAKER: 9 };
const FN = 41, GB = 42, SD = 38; // FN and G flat 2
/** Where the stab speaks (the bass leaves these sixteenths open): the "a" of beat one and of beat three. */
const STAB_AT = [3, 11];

/** A section's loudness: every note's velocity scaled (a number, or a curve over the pattern for a swell), so the parts
 * rise and fall together. */
function dyn(t: RigTrack, k: number | ((x: number) => number)): RigTrack {
  const at = typeof k === 'number' ? () => k : k;
  t.steps.forEach((s, i) => {
    if (!s.notes.length) return;
    const g = at(i / 63), v = (x: number) => Math.min(1, Math.round(x * g * 100) / 100);
    s.vel = v(s.vel);
    if (s.vels) for (const n of Object.keys(s.vels).map(Number)) s.vels[n] = v(s.vels[n]!);
  });
  return t;
}

/** The kit: kick on the floor, snare and clap on two and four, closed hats with the open ones off the beat (both dark),
 * ghost kicks, the cowbell and the ride. The sixteenths in between come a little late (a hand), and the ghosts come and
 * go (probability), so a pattern played again is not played the same. `gap` leaves the last beat open (no kick, no
 * hats) before the next section. */
interface DrKit { kick?: boolean; snare?: boolean; hats?: 'none' | 'closed' | 'all'; ride?: boolean; cowbell?: boolean; gap?: boolean }
function drKit(o: DrKit = {}): RigTrack {
  const { kick = true, snare = true, hats = 'all', ride = false, cowbell = true, gap = false } = o;
  const steps: Steps = [];
  for (let i = 0; i < 64; i++) {
    const notes: number[] = [], vels: Record<number, number> = {}, b = i % 16, open = gap && i >= 60;
    if (kick && !open && (b % 4 === 0 || i === 46 || i === 62)) { notes.push(BD); vels[BD] = b % 4 ? 0.45 : 1; }
    if (snare && (b === 4 || b === 12)) { notes.push(SD, CP); vels[SD] = 0.8; vels[CP] = 0.65; }
    if (hats !== 'none' && !open) {
      if (b % 4 !== 2) { notes.push(CH); vels[CH] = [0.7, 0.3, 0, 0.45][b % 4]!; }
      else if (hats === 'closed') { notes.push(CH); vels[CH] = 0.55; }
      else if (i !== 58) { notes.push(OH); vels[OH] = 0.55; }
    }
    if (ride && b % 2 === 0) { notes.push(RD); vels[RD] = b % 4 ? 0.22 : 0.35; }
    if (cowbell && (i === 23 || i === 55)) { notes.push(CB); vels[CB] = 0.4; }
    if (notes.length) steps.push([i, notes, { vel: 0.9, vels }]);
  }
  const t = track(steps, 64);
  for (let i = 1; i < 64; i += 2) { t.steps[i]!.micro = 0.05; if (t.steps[i]!.notes.length) t.steps[i]!.prob = i % 16 === 7 ? 0.75 : 0.85; }
  return t;
}
/** The bass: F in sixteenths, the eighths leaning in, an octave pop late in beats two and four; silent where the stab
 * speaks. Bars two and four end on G flat, rubbing; bar three drops a note so it breathes. `open`: its ladder locked
 * from one cutoff to another over the pattern (opening or closing); `eighths`: only the eighths, thinned. */
function drBass(o: { open?: [number, number]; eighths?: boolean } = {}): RigTrack {
  const t = track(Array.from({ length: 64 }, (_, i): Steps[number] | undefined => {
    const b = i % 16, bar = i >> 4;
    if (STAB_AT.includes(b) || (bar === 2 && b === 9) || (o.eighths && i % 2)) return undefined;
    const root = (bar === 1 || bar === 3) && b >= 12 ? GB : FN;
    return [i, b === 6 || b === 14 ? root + 12 : root, { vel: [1, 0.5, 0.72, 0.5][b % 4]! - (bar === 2 ? 0.05 : 0), gate: 0.7 }];
  }).filter((x): x is Steps[number] => !!x), 64);
  if (o.open) {
    const [from, to] = o.open;
    t.steps.forEach((s, i) => { if (s.notes.length) s.locks = { 'lad.cutoff': Math.round(from * (to / from) ** (i / 63)) }; });
  }
  return t;
}
/** The acid: a twelve-step loop against the sixteen (it comes round in a new place each bar), an octave over the bass,
 * on F, A flat, the octave and G flat, sliding. Written out over the pattern so its filter (the SEQ lane) can open
 * across it: `open` adds to the loop's own shape. */
const ACID_LOOP: [step: number, note: number, vel: number, gate?: number][] = [
  [0, 53, 1], [2, 53, 0.55], [3, 56, 0.55, 1.15], [4, 53, 0.6], [6, 65, 1], [8, 54, 0.6, 1.15], [9, 53, 0.55], [10, 51, 0.9],
];
const ACID_SHAPE = [0.15, 0.1, 0.2, 0.25, 0.1, 0.15, 0.35, 0.2, 0.15, 0.1, 0.25, 0.15];
function drAcid(open: (x: number) => number): RigTrack {
  const steps: Steps = [];
  for (let i = 0; i < 64; i++) {
    const h = ACID_LOOP.find(([k]) => k === i % 12);
    if (h) steps.push([i, h[1], { vel: h[2], gate: h[3] ?? 0.5 }]);
  }
  return mods(track(steps, 64), (i) => Math.min(1, ACID_SHAPE[i % 12]! + open(i / 63)));
}
/** The stab in the bass's holes, minor sevenths on F; in bar four the second leans on G flat. Bar two leaves its second
 * out, so the echoes have the space; the quieter seconds come and go. `throw`: one stab only, at the end, into the dub. */
function drStab(o: { throw?: boolean } = {}): RigTrack {
  if (o.throw) return track([[51, FN + 12, { vel: 0.9 }]], 64);
  const t = track([
    [3, FN + 12, { vel: 0.9 }], [11, FN + 12, { vel: 0.6 }], [19, FN + 12, { vel: 0.85 }],
    [35, FN + 12, { vel: 0.9 }], [43, FN + 12, { vel: 0.55 }], [51, FN + 12, { vel: 0.85 }], [59, GB + 12, { vel: 0.7 }],
  ], 64);
  t.steps[11]!.prob = 0.7; t.steps[43]!.prob = 0.7;
  return t;
}
/** The strings: one dark chord held under it all (F, A flat, C; the top going to D flat in the second half), the SEQ
 * lane opening its filter along `shape` (0 to 1 over the pattern). */
const drStrings = (shape: (x: number) => number): RigTrack => mods(track([
  [0, [53, 56, 60], { vel: 0.7, gate: 16 }], [16, [53, 56, 60], { vel: 0.7, gate: 16 }],
  [32, [53, 56, 61], { vel: 0.7, gate: 16 }], [48, [53, 56, 61], { vel: 0.7, gate: 16 }],
], 64), (i) => shape(i / 63));
const swell = (x: number) => Math.sin(Math.PI * x) ** 2;
/** The pluck: two notes in a five-step loop, high, into Beads' delay: it falls round the bar differently each time,
 * its echoes against the stab's. */
const drPluck = (): RigTrack => track([[0, 72, { vel: 0.85, gate: 0.4 }], [3, 68, { vel: 0.5, gate: 0.4 }]], 5);
/** The voice, twice, long, in the stab's echoes, each phrase with its own throat (TIMBRE, locked). The first as the
 * user set it: C in bar one, G flat in bar three; the second later in the bar, C then F, lower. */
const drWords = (second = false): RigTrack => track(second
  ? [[30, 48, { gate: 4, vel: 0.85, locks: { 'osc3.timbre': 0.4 } }], [54, 41, { gate: 8, vel: 0.85, locks: { 'osc3.timbre': 0.7 } }]]
  : [[14, 48, { gate: 5, vel: 0.85, locks: { 'osc3.timbre': 0.2 } }], [46, 42, { gate: 7, vel: 0.85, locks: { 'osc3.timbre': 0.65 } }]], 64);
/** Congas, two bars round, in the gaps the kick and stab leave: the low one late in beat two, the high one answering;
 * the quiet ones come and go. */
const drConga = (): RigTrack => {
  const t = track([[7, 50, { vel: 0.85 }], [10, 57, { vel: 0.6 }], [13, 57, { vel: 0.45 }], [15, 50, { vel: 0.6 }],
    [23, 50, { vel: 0.8 }], [25, 57, { vel: 0.55 }], [29, 57, { vel: 0.65 }], [30, 50, { vel: 0.5 }]], 32);
  t.steps[13]!.micro = 0.07; t.steps[25]!.micro = 0.06; t.steps[30]!.micro = -0.04;
  t.steps[13]!.prob = 0.7; t.steps[30]!.prob = 0.6;
  return t;
};
/** A shaker in sixteenths, the "and" leaning in, the in-between ones late. */
function drShaker(): RigTrack {
  const t = track(Array.from({ length: 16 }, (_, i): Steps[number] => [i, 60, { vel: [0.4, 0.6, 0.95, 0.6][i % 4]!, gate: 0.3 }]), 16);
  for (let i = 1; i < 16; i += 2) t.steps[i]!.micro = 0.06;
  return t;
}

const darkRoom: RigFactoryMulti = {
  name: 'DARK ROOM · 110',
  build: () => {
    const parts: Partial<RigMultiPart>[] = [];
    // the kit: an older, drier machine than the 909: a rounder, longer kick with little click, a crisp snare, a dark
    // clap, short hats with their tops taken off, the 808's cowbell
    const kit = cloneKit(RIG_KITS[0]!);
    kit.name = 'Dark Room Kit';
    kit.pads[BD - 36]!.analog = { 'kick.tune': 50, 'kick.decay': 0.5, 'kick.click': 0.2 };
    kit.pads[SD - 36]!.analog = { 'snare.tune': 200, 'snare.decay': 0.16, 'snare.snap': 0.75 };
    kit.pads[CP - 36]!.analog = { 'clap.tone': 950, 'clap.decay': 0.2 };
    Object.assign(kit.pads[CH - 36]!, { analog: { 'closedHat.decay': 0.05 }, cutoff: 7000 });
    Object.assign(kit.pads[OH - 36]!, { analog: { 'openHat.decay': 0.35 }, cutoff: 6000 });
    kit.pads[CB - 36]!.analog = {};
    parts[DR.KIT] = { name: 'Kit', kind: 'kit', kit, channel: 10 };
    // the bass opened up, and a resonant band-pass beside the ladder, wobbled by LFO 1 (as the user set it)
    parts[DR.BASS] = {
      name: 'Bass', voices: 1, channel: 1,
      ...sound('Post-Punk Bass', {
        'lad.cutoff': 970, 'filter.route': 2, 'sem.bp': 1, 'sem.mode': 1, 'sem.cutoff': 2190, 'sem.res': 0.397, 'out.level': 1,
      }, [
        { source: 'vel', dest: 'lad.cutoff', amount: 0.15 }, { source: 'vel', dest: 'eg2.level', amount: 0.5 },
        { source: 'lfo1', dest: 'sem.cutoff', amount: 0.327 },
      ]),
    };
    // the acid held back: darker and rounder than ACID HOUSE's, the SEQ lane on its cutoff; as the user set it, a slow
    // free-running LFO drifting the ladder, and a high-pass after it
    parts[DR.ACID] = {
      name: 'Acid', voices: 1, channel: 2,
      ...sound('Acid Line', {
        'osc1.oct': 1, 'lad.cutoff': 420, 'lad.res': 0.65, 'lad.eg1': 0.38, drive: 0.5, 'eg1.d': 0.2, 'voice.glide': 0.06, 'out.level': 1,
        'filter.route': 1, 'sem.mode': 0.814, 'sem.cutoff': 88, 'lfo1.rate': 0.54, 'lfo1.retrig': 1,
      }, [
        { source: 'vel', dest: 'lad.cutoff', amount: 0.1 }, { source: 'seq', dest: 'lad.cutoff', amount: 0.4 },
        { source: 'lfo1', dest: 'lad.cutoff', amount: 0.216 },
      ]),
    };
    parts[DR.STAB] = { name: 'Stab', voices: 2, channel: 3, ...sound('Minor Stab', { 'out.level': 1 }) };
    // the strings low and closed, opened by the SEQ lane; the high-pass under them pulsing in eighth triplets (LFO 2,
    // as the user set it)
    parts[DR.STRINGS] = {
      name: 'Strings', voices: 9, channel: 4,
      ...sound('String Machine', { 'lad.cutoff': 600, 'sem.cutoff': 374, 'lfo2.sync': 1, 'lfo2.div': 7, 'lfo2.level': 0.73, 'out.level': 1 }, [
        { source: 'lfo1', dest: 'osc1.tune', amount: 0.0015 }, { source: 'lfo1', dest: 'osc2.tune', amount: 0.0015 },
        { source: 'seq', dest: 'lad.cutoff', amount: 0.35 },
        { source: 'lfo2', dest: 'sem.cutoff', amount: 0.254 }, { source: 'lfo2', dest: 'sem.res', amount: 0.282 },
      ]),
    };
    parts[DR.PLUCK] = { name: 'Pluck', voices: 3, channel: 5, ...sound('Cosmic Pluck', { 'out.level': 1 }) };
    parts[DR.WORDS] = { name: 'Vox', voices: 3, channel: 7, ...sound('Dub Words', { 'out.level': 1 }) };
    parts[DR.CONGA] = { name: 'Conga', voices: 2, channel: 8, ...sound('Hand Conga', { 'out.level': 1 }) };
    parts[DR.SHAKER] = { name: 'Shaker', voices: 1, channel: 9, ...sound('Shaker', { 'out.level': 1 }) };

    // the song: sixteen patterns of four bars, chained (see the chain below). Each part's loudness is scaled with the
    // section's (dyn), so the band rises and falls together. The voice gets its space with the strings out, and the bass
    // carries the groove without the acid; the acid takes the bass's place, and only at the peak are both in.
    const { KIT, BASS, ACID, STAB, STRINGS, PLUCK, WORDS, CONGA, SHAKER } = DR;
    const at = (k: number, from: number, to: number) => (x: number) => k * (from + (to - from) * x);
    const patterns = [
      // 0 intro: the kick and the shaker, one stab thrown into the delay
      pattern({ [KIT]: dyn(drKit({ snare: false, hats: 'none', cowbell: false }), 0.85), [SHAKER]: dyn(drShaker(), 0.8), [STAB]: drStab({ throw: true }) }),
      // 1 intro: closed hats and the congas
      pattern({ [KIT]: dyn(drKit({ snare: false, hats: 'closed', cowbell: false }), 0.88), [SHAKER]: dyn(drShaker(), 0.85), [CONGA]: dyn(drConga(), 0.85),
        [STAB]: drStab({ throw: true }) }),
      // 2, 3 the bass comes in shut and opens over eight bars; the open hats, then the snare, a gap before the groove
      pattern({ [KIT]: dyn(drKit({ snare: false }), 0.9), [BASS]: dyn(drBass({ open: [220, 480] }), 0.9), [SHAKER]: dyn(drShaker(), 0.85), [CONGA]: dyn(drConga(), 0.85) }),
      pattern({ [KIT]: dyn(drKit({ gap: true }), 0.92), [BASS]: dyn(drBass({ open: [480, 970] }), 0.92), [SHAKER]: dyn(drShaker(), 0.85), [CONGA]: dyn(drConga(), 0.88),
        [STAB]: drStab({ throw: true }) }),
      // 4 groove: the kit, the bass and the stab in its holes
      pattern({ [KIT]: dyn(drKit(), 0.95), [BASS]: dyn(drBass(), 0.95), [STAB]: dyn(drStab(), 0.95), [SHAKER]: dyn(drShaker(), 0.9), [CONGA]: dyn(drConga(), 0.9) }),
      // 5 the voice, with room: no strings, no acid, no shaker
      pattern({ [KIT]: dyn(drKit(), 0.9), [BASS]: dyn(drBass(), 0.9), [STAB]: dyn(drStab(), 0.9), [WORDS]: drWords(), [CONGA]: dyn(drConga(), 0.85) }),
      // 6 the pluck comes in, the voice rests
      pattern({ [KIT]: dyn(drKit(), 0.95), [BASS]: dyn(drBass(), 0.95), [STAB]: dyn(drStab(), 0.9), [PLUCK]: dyn(drPluck(), 0.9), [SHAKER]: dyn(drShaker(), 0.9),
        [CONGA]: dyn(drConga(), 0.9) }),
      // 7 the strings rise in under it
      pattern({ [KIT]: dyn(drKit(), 0.97), [BASS]: dyn(drBass(), 0.97), [STAB]: dyn(drStab(), 0.95), [PLUCK]: dyn(drPluck(), 0.9), [STRINGS]: drStrings((x) => 0.7 * x),
        [SHAKER]: dyn(drShaker(), 0.9), [CONGA]: dyn(drConga(), 0.9) }),
      // 8 the strings and the voice together, the strings swelling; a gap before the break
      pattern({ [KIT]: dyn(drKit({ gap: true }), 1), [BASS]: dyn(drBass(), 1), [STAB]: dyn(drStab(), 0.95), [STRINGS]: drStrings(swell), [WORDS]: drWords(true),
        [SHAKER]: dyn(drShaker(), 0.9), [CONGA]: dyn(drConga(), 0.9) }),
      // 9 the break: no kick, no bass; the strings, the voice, the stab's echoes, the hand drums
      pattern({ [KIT]: dyn(drKit({ kick: false, snare: false, hats: 'closed', cowbell: false }), 0.7), [STAB]: dyn(drStab(), 0.85), [STRINGS]: drStrings(swell),
        [WORDS]: drWords(), [SHAKER]: dyn(drShaker(), 0.75), [CONGA]: dyn(drConga(), 0.8) }),
      // 10 the way back: the bass creeping in thinned and shut, opening; the pluck, the hats, all rising
      pattern({ [KIT]: dyn(drKit({ kick: false, cowbell: false }), at(1, 0.7, 0.95)), [BASS]: dyn(drBass({ open: [250, 700], eighths: true }), at(1, 0.75, 0.95)),
        [PLUCK]: dyn(drPluck(), 0.85), [STRINGS]: drStrings((x) => 0.6 * (1 - x)), [SHAKER]: dyn(drShaker(), at(1, 0.75, 0.95)), [CONGA]: dyn(drConga(), 0.85) }),
      // 11, 12 the acid in the bass's place, opening; the pluck joins it, a gap before the peak
      pattern({ [KIT]: dyn(drKit(), 0.95), [ACID]: dyn(drAcid((x) => 0.15 * x), 0.95), [STAB]: dyn(drStab(), 0.9), [SHAKER]: dyn(drShaker(), 0.9), [CONGA]: dyn(drConga(), 0.9) }),
      pattern({ [KIT]: dyn(drKit({ gap: true }), 1), [ACID]: dyn(drAcid((x) => 0.15 + 0.3 * x), 1), [STAB]: dyn(drStab(), 0.95), [PLUCK]: dyn(drPluck(), 0.9),
        [SHAKER]: dyn(drShaker(), 0.95), [CONGA]: dyn(drConga(), 0.9) }),
      // 13 the peak: the bass and the acid both, the ride, the strings swelling, the stab, the pluck
      pattern({ [KIT]: dyn(drKit({ ride: true }), 1), [BASS]: dyn(drBass(), 1), [ACID]: dyn(drAcid((x) => 0.4 + 0.25 * Math.sin(Math.PI * x)), 0.95),
        [STAB]: dyn(drStab(), 1), [STRINGS]: drStrings(swell), [PLUCK]: dyn(drPluck(), 0.9), [SHAKER]: dyn(drShaker(), 0.95), [CONGA]: dyn(drConga(), 0.95) }),
      // 14 the voice again, with room: the bass, the stab, the kit with only its closed hats
      pattern({ [KIT]: dyn(drKit({ hats: 'closed' }), 0.9), [BASS]: dyn(drBass(), 0.9), [STAB]: dyn(drStab(), 0.9), [WORDS]: drWords(true), [CONGA]: dyn(drConga(), 0.85) }),
      // 15 out: the bass closing, the kit losing its snare, the last stab thrown
      pattern({ [KIT]: dyn(drKit({ snare: false, hats: 'closed', cowbell: false }), 0.88), [BASS]: dyn(drBass({ open: [970, 260] }), 0.88),
        [SHAKER]: dyn(drShaker(), 0.85), [CONGA]: dyn(drConga(), 0.85), [STAB]: drStab({ throw: true }) }),
    ];
    // a first balance and the dub: the stab deep in the dub delay (its 3/16 echoes land in the bass's next hole), the
    // pluck in Beads' delay, the voice almost all in the dub and the hall; the strings through ENSEMBLE and the hall, low
    const mix: Record<string, number> = {
      'p1.fader': 0.7,
      'p2.fader': 1, 'p2.a': 0.08,
      'p3.fader': 0.67, 'p3.a': 0.2, 'p3.pan': 0.15,
      'p4.fader': 2, 'p4.a': 0.7, 'p4.c': 0.2, 'p4.lo': -6,
      'p5.fader': 0.53, 'p5.c': 0.35, 'p5.d': 0.6, 'p5.lo': -4,
      'p6.fader': 1, 'p6.b': 0.55, 'p6.c': 0.15, 'p6.pan': -0.2,
      'p8.fader': 1.23, 'p8.a': 0.9, 'p8.c': 0.4,
      'p9.fader': 1, 'p9.pan': -0.35, 'p9.c': 0.15,
      'p10.fader': 0.7, 'p10.pan': 0.35, 'p10.c': 0.1,
      // the dub delay long, bright and saturating, its repeats wobbling (as the user set it)
      'dub.sync': 1, 'dub.div': 3, 'dub.fdbk': 0.93, 'dub.tone': 4220, 'dub.wow': 0.66, 'dub.sat': 0.77,
      // send B in Beads' mode, as the user set it: 3/16, the repeats multiplied and shaped
      'bbd.mode': 1, 'bbd.sync': 1, 'bbd.div': 3, 'bbd.fdbk': 0.5, 'bbd.age': 0.55, 'bbd.ping': 1, 'bds.multiply': 0.428, 'bds.shape': 0.329,
      'rev.type': 2, 'rev.size': 0.65, 'rev.damp': 0.65, 'rev.pre': 0.02,
      'cho.mode': 3,
      'rA.lo': -6, 'rA.hi': -4,
      'cmp.key': 1, 'cmp.ratio': 2.5, 'cmp.thresh': -20, 'cmp.atk': 3, 'cmp.rel': 160, 'cmp.mix': 0.6,
    };
    // intro 16 bars, the bass in 8, groove 12, the voice 8, the pluck 8, the strings 12, the break 12, the acid 16, the
    // peak 12, the voice again 12, the strings and voice once more 8, out 16: 140 bars, about five minutes
    const chain = [0, 0, 1, 1, 2, 3, 4, 4, 4, 5, 5, 6, 6, 7, 8, 8, 9, 9, 10, 11, 11, 11, 12, 13, 13, 13, 14, 14, 14, 8, 8, 15, 15, 0, 0];
    return multi('Dark Room', 110, parts, patterns, chain, mix);
  },
};

export const RIG_FACTORY_MULTIS: readonly RigFactoryMulti[] = [init8, acidHouse, scalpel, darkRoom];
