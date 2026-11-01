import { newRigPattern, type RigPattern, type RigStep, type RigTrack } from '../sequencer/rigSequencer';
import { cloneKit, RIG_KITS } from './rigKit';
import { RIG_MULTI_VERSION, type RigMulti, type RigMultiPart } from './rigMulti';
import { pedalParams } from './rigPedals';
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
 * - NO MERCY · 148: hard, pounding techno. A distorted kick that never lets up, a rumble in the gaps between it, open
 *   hats hammering the offbeat, metal and toms in loops of seven and ten against the bar, a stab beaten into the dub
 *   delay, a screaming acid line from the first drop on, a noise riser and a kick roll into each drop.
 * - DUB PRESSURE · 140: old-school dubstep, half-time, heavy on the dub: a sine sub, an offbeat skank, a siren, a voice,
 *   and throw parts: chosen hits sent whole into a long, saturating dub delay whose echoes fall into the spring. Now and
 *   then SCALPEL's tape strings swell up loud and are cut dead, leaving the echoes the space.
 */
export interface RigFactoryMulti {
  name: string;
  build(): RigMulti;
}

const PARTS = 16;
const preset = (name: string) => {
  const p = RIG_PRESETS.find((x) => x.name === name);
  if (!p) throw new Error(`no factory sound ${name}`);
  return { slot: RIG_PRESETS.indexOf(p), sound: name, a: p.a, b: p.b ?? p.a };
};
/** A sound: a factory one with params changed (and routings, if given). */
function sound(base: string, params: Record<string, number>, matrix?: RigRoute[]): { slot: number; sound: string; a: RigSide; b: RigSide } {
  const p = preset(base);
  const side = (s: RigSide): RigSide => ({ params: { ...s.params, ...params }, matrix: (matrix ?? s.matrix).map((r) => ({ ...r })) });
  return { slot: p.slot, sound: p.sound, a: side(p.a), b: side(p.a) };
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
    parts[SC.STAB] = { name: 'Stab', voices: 1, channel: 7, ...sound('Techno Stab', { 'eg1.d': 0.12, 'eg2.d': 0.14, 'eg2.r': 0.12, 'out.level': 1 }) };
    parts[SC.NOISE] = { name: 'Noise', voices: 1, channel: 8, ...sound('Noise Sweep', { 'out.level': 1 }) };
    parts[SC.BUBBLY] = { name: 'Bubbly', voices: 1, channel: 9, ...sound('Bubbly Bass', { 'out.level': 1 }) };
    parts[SC.STRINGS] = { name: 'Strings', voices: 8, channel: 1, ...sound('Tape Strings', { 'out.level': 1 }) };
    parts[SC.SHAKER] = { name: 'Shaker', voices: 1, channel: 2, ...sound('Shaker', { 'out.level': 1 }) };
    parts[SC.SYNTH] = { name: 'Synth', voices: 6, channel: 3, ...sound('Table Poly', { 'eg1.d': 0.06, 'eg2.d': 0.15, 'eg2.r': 0.1, 'out.level': 1 }) };
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
      // the kick through a tube drive (a pedal on part 1)
      ...pedalParams(1, 1, 'DRIVE', { Type: 'TUBE', Drive: 0.6, Tone: 0.5, Level: 1 }),
      'p1.fader': 0.63, 'p1.lo': 2,
      'p2.fader': 1.3, 'p2.pan': 0.2, 'p2.c': 0.05, 'p2.hi': -3,
      'p3.fader': 2, 'p3.pan': -0.5, 'p3.a': 0.35, 'p3.c': 0.12, 'p3.mid': 3, 'p3.hi': -1,
      'p4.fader': 0.95, 'p4.pan': 0.45, 'p4.a': 0.3, 'p4.c': 0.15, 'p4.mid': 3,
      'p5.fader': 1.9, 'p5.mid': 1, 'p5.a': 0.12,
      'p6.fader': 2, 'p6.pan': 0.4, 'p6.a': 0.5, 'p6.c': 0.25, 'p6.lo': -10, 'p6.hi': -5,
      'p7.fader': 2, 'p7.pan': -0.25, 'p7.a': 0.75, 'p7.c': 0.2, 'p7.lo': -8, 'p7.mid': 3,
      'p8.fader': 2, 'p8.c': 0.3, 'p8.lo': -12, 'p8.hi': -6,
      // the bubbling bass a touch into the delay; the strings behind, through a chorus pedal and the hall
      'p9.fader': 1.9, 'p9.a': 0.12,
      'p11.fader': 1, 'p11.pan': 0.35, 'p11.c': 0.1,
      'p12.fader': 0.89, 'p12.lo': -3, 'p12.a': 0.3, 'p12.b': 0.66, 'p12.c': 0.3, ...pedalParams(12, 1, 'CHORUS', {}, 0.15),
      // the BBD (B) as the user set it: synced, aged dark, its repeats wobbling, in the middle (no ping-pong:
      // focused); the synth well into it, the bass a good way
      'p5.b': 0.81,
      'bbd.sync': 1, 'bbd.fdbk': 0.49, 'bbd.age': 0.59, 'bbd.mod': 0.42, 'bbd.rate': 1.54, 'bbd.ping': 0,
      // the blips a side each, into the delay so they answer each other
      'p13.fader': 0.8, 'p13.pan': -0.6, 'p13.a': 0.35, 'p13.hi': -2,
      'p14.fader': 0.8, 'p14.pan': 0.6, 'p14.a': 0.35, 'p14.hi': -2,
      'p10.fader': 0.7, 'p10.lo': -4, 'p10.c': 0.35, ...pedalParams(10, 1, 'CHORUS', {}, 0.15),
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
    parts[DR.STAB] = { name: 'Stab', voices: 2, channel: 3, ...sound('Minor Stab', { 'eg1.d': 0.15, 'eg2.d': 0.2, 'eg2.r': 0.15, 'out.level': 1 }) };
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
      'p5.fader': 0.53, 'p5.c': 0.35, 'p5.lo': -4, ...pedalParams(5, 1, 'CHORUS', { Mode: 'ENSEMBLE' }, 0.3),
      'p6.fader': 1, 'p6.b': 0.55, 'p6.c': 0.15, 'p6.pan': -0.2,
      'p8.fader': 1.23, 'p8.a': 0.9, 'p8.c': 0.4,
      'p9.fader': 1, 'p9.pan': -0.35, 'p9.c': 0.15,
      'p10.fader': 0.7, 'p10.pan': 0.35, 'p10.c': 0.1,
      // the dub delay long, bright and saturating, its repeats wobbling (as the user set it)
      'dub.sync': 1, 'dub.div': 3, 'dub.fdbk': 0.93, 'dub.tone': 4220, 'dub.wow': 0.66, 'dub.sat': 0.77,
      // send B in Beads' mode, as the user set it: 3/16, the repeats multiplied and shaped
      'bbd.mode': 1, 'bbd.sync': 1, 'bbd.div': 3, 'bbd.fdbk': 0.5, 'bbd.age': 0.55, 'bbd.ping': 1, 'bds.multiply': 0.428, 'bds.shape': 0.329,
      'rev.type': 2, 'rev.size': 0.65, 'rev.damp': 0.65, 'rev.pre': 0.02,
      'rA.lo': -6, 'rA.hi': -4,
      'cmp.key': 1, 'cmp.ratio': 2.5, 'cmp.thresh': -20, 'cmp.atk': 3, 'cmp.rel': 160, 'cmp.mix': 0.6,
    };
    // intro 16 bars, the bass in 8, groove 12, the voice 8, the pluck 8, the strings 12, the break 12, the acid 16, the
    // peak 12, the voice again 12, the strings and voice once more 8, out 16: 140 bars, about five minutes
    const chain = [0, 0, 1, 1, 2, 3, 4, 4, 4, 5, 5, 6, 6, 7, 8, 8, 9, 9, 10, 11, 11, 11, 12, 13, 13, 13, 14, 14, 14, 8, 8, 15, 15, 0, 0];
    return multi('Dark Room', 110, parts, patterns, chain, mix);
  },
};

// ================= NO MERCY · 148 =================
// Hard techno, 148 BPM, on G with A flat pressing on it. Four kits (the kick alone, so the mixer's drive can take it;
// hats; clap and rims; toms) and five synths: the rumble, the stab, the acid, the metal and the noise.
const NM = { KICK: 0, HATS: 1, PERC: 2, RUMBLE: 3, STAB: 4, ACID: 5, METAL: 6, NOISE: 7, TOMS: 8 };
const G2n = 43, AB2 = 44;

/** The kick, on every beat. `roll`: the last two bars build in eighths, then sixteenths, louder all the way (into a
 * drop); `crash` on the first beat; `ghost`: an extra kick late in bars two and four; `off`: no kick at all. */
function nmKick(o: { roll?: boolean; crash?: boolean; ghost?: boolean; off?: boolean } = {}): RigTrack {
  const steps: Steps = [];
  for (let i = 0; i < 64; i++) {
    const notes: number[] = [], vels: Record<number, number> = {};
    const beat = i % 4 === 0, eighth = i % 2 === 0;
    if (o.roll && i >= 32) {
      if (i < 48 ? eighth : true) { notes.push(BD); vels[BD] = 0.55 + 0.45 * ((i - 32) / 31); }
    } else if (!o.off && (beat || (o.ghost && (i === 30 || i === 62)))) { notes.push(BD); vels[BD] = beat ? 1 : 0.5; }
    if (o.crash && i === 0) { notes.push(CR); vels[CR] = 0.8; }
    if (notes.length) steps.push([i, notes, { vel: 1, vels }]);
  }
  return track(steps, 64);
}
/** The hats: open ones hammering the offbeat, closed sixteenths with a hand on the accents (the quiet ones come and
 * go), the ride on the eighths when it is in. */
function nmHats(o: { open?: boolean; closed?: boolean; ride?: boolean } = {}): RigTrack {
  const { open = true, closed = true, ride = false } = o;
  const steps: Steps = [];
  for (let i = 0; i < 64; i++) {
    const notes: number[] = [], vels: Record<number, number> = {}, b = i % 4;
    if (open && b === 2) { notes.push(OH); vels[OH] = 0.85; }
    else if (closed && b !== 2) { notes.push(CH); vels[CH] = [0.8, 0.4, 0, 0.6][b]!; }
    if (ride && i % 2 === 0) { notes.push(RD); vels[RD] = b ? 0.3 : 0.45; }
    if (notes.length) steps.push([i, notes, { vel: 0.9, vels }]);
  }
  const t = track(steps, 64);
  for (let i = 1; i < 64; i += 2) { t.steps[i]!.micro = 0.03; if (t.steps[i]!.notes.length && i % 4 === 1) t.steps[i]!.prob = 0.8; }
  return t;
}
/** The clap on two and four, and rims that shift from bar to bar; `fill`: claps in sixteenths through the last beat. */
function nmPerc(o: { clap?: boolean; rims?: boolean; fill?: boolean } = {}): RigTrack {
  const { clap = true, rims = true, fill = false } = o;
  const RIMS = [[3, 6, 14], [3, 10, 13], [6, 11, 14], [3, 7, 10, 15]];
  const steps: Steps = [];
  for (let i = 0; i < 64; i++) {
    const notes: number[] = [], vels: Record<number, number> = {}, b = i % 16;
    if ((clap && (b === 4 || b === 12)) || (fill && i >= 60)) { notes.push(CP); vels[CP] = fill && i >= 60 ? 0.6 + 0.1 * (i - 60) : 0.95; }
    if (rims && RIMS[i >> 4]!.includes(b)) { notes.push(RS); vels[RS] = b % 2 ? 0.55 : 0.75; }
    if (notes.length) steps.push([i, notes, { vel: 0.9, vels }]);
  }
  return track(steps, 64);
}
/** The rumble: the three sixteenths after each kick, falling away, on G (A flat now and then at the end of a bar);
 * `open`: its ladder locked from one cutoff to another over the pattern. */
function nmRumble(o: { open?: [number, number] } = {}): RigTrack {
  const steps: Steps = [];
  for (let i = 0; i < 64; i++) {
    const b = i % 4;
    if (!b) continue;
    const press = (i === 31 || i === 63);
    steps.push([i, press ? AB2 : G2n, { vel: [0, 0.95, 0.7, 0.85][b]!, gate: 0.8 }]);
  }
  const t = track(steps, 64);
  if (o.open) {
    const [from, to] = o.open;
    t.steps.forEach((s, i) => { if (s.notes.length) s.locks = { 'lad.cutoff': Math.round(from * (to / from) ** (i / 63)) }; });
  }
  return t;
}
/** The stab, beaten off the grid into the dub delay; the fourth bar presses on A flat. */
const nmStab = (): RigTrack => track([
  ...[0, 16, 32].flatMap((bar): Steps => [[bar + 2, G2n + 12, { vel: 0.95 }], [bar + 7, G2n + 12, { vel: 0.7 }], [bar + 10, G2n + 12, { vel: 0.85 }]]),
  [50, AB2 + 12, { vel: 0.95 }], [54, AB2 + 12, { vel: 0.75 }], [58, G2n + 12, { vel: 0.9 }], [61, G2n + 12, { vel: 0.8 }],
], 64);
/** The acid: sixteenths on G, the octave, A flat and B flat, slides and accents, a bar that turns at its end; the SEQ
 * lane opens its filter along `open` (0 to 1 over the pattern). */
const NM_ACID: [number, number, number, number?][] = [
  [0, 43, 1], [1, 43, 0.5], [2, 55, 0.6, 1.1], [3, 43, 0.5], [4, 44, 0.9], [5, 43, 0.5], [6, 43, 0.55], [7, 46, 1, 1.1],
  [8, 43, 0.5], [9, 55, 0.95], [10, 43, 0.5], [11, 44, 0.6, 1.1], [12, 43, 1], [13, 58, 0.6], [14, 43, 0.5], [15, 56, 0.9, 1.1],
];
function nmAcid(open: (x: number) => number): RigTrack {
  const steps: Steps = [];
  for (let i = 0; i < 64; i++) {
    const [, n, v, g] = NM_ACID[i % 16]!;
    steps.push([i, i >= 48 && i % 16 === 12 ? n + 1 : n, { vel: v, gate: g ?? 0.55 }]);
  }
  return mods(track(steps, 64), (i) => Math.min(1, open(i / 63) + (NM_ACID[i % 16]![2] > 0.8 ? 0.08 : 0)));
}

const noMercy: RigFactoryMulti = {
  name: 'NO MERCY · 148',
  build: () => {
    const parts: Partial<RigMultiPart>[] = [];
    // the kick: short, hard and all click, its own part so the drive insert takes only it; a crash on the same kit
    const kick = cloneKit(RIG_KITS[0]!);
    kick.name = 'Pounding Kick';
    kick.pads[BD - 36]!.analog = { 'kick.tune': 52, 'kick.decay': 0.5, 'kick.click': 0.9 };
    kick.pads[CR - 36]!.analog = { 'crash.decay': 2.2, 'crash.tone': 0.6 };
    parts[NM.KICK] = { name: 'Kick', kind: 'kit', kit: kick, channel: 10 };
    const hats = cloneKit(RIG_KITS[0]!);
    Object.assign(hats.pads[CH - 36]!, { analog: { 'closedHat.decay': 0.04 } });
    Object.assign(hats.pads[OH - 36]!, { analog: { 'openHat.decay': 0.28 } });
    Object.assign(hats.pads[RD - 36]!, { analog: { 'ride.decay': 1.2 }, cutoff: 10000 });
    parts[NM.HATS] = { name: 'Hats', kind: 'kit', kit: hats, channel: 11 };
    const perc = cloneKit(RIG_KITS[0]!);
    perc.pads[CP - 36]!.analog = { 'clap.tone': 1400, 'clap.decay': 0.3, 'clap.spread': 0.6 };
    perc.pads[RS - 36]!.analog = { 'rim.tone': 1900, 'rim.decay': 0.04 };
    parts[NM.PERC] = { name: 'Clap', kind: 'kit', kit: perc, channel: 12 };
    // the toms short and bent, dark, the high one shut right down to a thud (as the user set them)
    const toms = cloneKit(RIG_KITS[0]!);
    Object.assign(toms.pads[LT - 36]!, { analog: { 'lowTom.decay': 0.15, 'lowTom.bend': 0.644 }, decay: 0.211, cutoff: 1047 });
    Object.assign(toms.pads[MT - 36]!, { analog: { 'midTom.decay': 0.217, 'midTom.bend': 0.567 }, decay: 0.12, cutoff: 1585 });
    Object.assign(toms.pads[HT - 36]!, { decay: 0.552, cutoff: 113 });
    parts[NM.TOMS] = { name: 'Toms', kind: 'kit', kit: toms, channel: 13 };
    // the rumble synth: the techno bass shorter and driven harder, under the kick's own hall tail
    parts[NM.RUMBLE] = { name: 'Rumble', voices: 1, channel: 1, ...sound('Techno Bass', { 'lad.cutoff': 110, 'eg2.d': 0.12, drive: 0.9, 'out.level': 1 }) };
    // the stab: the chord with two synced saws under it, a fifth up and pulled by LFO 2 (in eighths), LFO 1 working
    // both filters (as the user set it)
    parts[NM.STAB] = {
      name: 'Stab', voices: 2, channel: 2,
      ...sound('Techno Stab', {
        'mix.osc1': 0.208, 'osc1.tune': 5, 'mix.osc2': 0.403, 'osc2.sync': 1, 'osc2.tune': -0.336, 'eg1.s': 0.318,
        'eg1.d': 0.12, 'eg2.d': 0.14, 'eg2.r': 0.12, // the tune's own decay (the preset's is longer)
        'lfo1.retrig': 1, 'lfo2.sync': 1, 'lfo2.div': 3, 'lfo2.retrig': 1, 'out.level': 1,
      }, [
        { source: 'lfo1', dest: 'lad.cutoff', amount: 0.526 }, { source: 'lfo1', dest: 'sem.cutoff', amount: -0.406 },
        { source: 'lfo1', dest: 'sem.res', amount: 0.307 }, { source: 'lfo2', dest: 'osc2.tune', amount: 0.502 },
      ]),
    };
    // the acid opened right up and plucked short, all drive, a resonant band-pass beside the ladder, two slow LFOs
    // drifting the filters (as the user set it); the SEQ lane on the cutoff
    parts[NM.ACID] = {
      name: 'Acid', voices: 1, channel: 3,
      ...sound('Acid Line', {
        'lad.cutoff': 4750, 'lad.res': 0.556, 'lad.eg1': 0.05, drive: 1, overdrive: 1, 'eg1.d': 0.6, 'voice.glide': 0.05,
        'eg2.a': 0.001, 'eg2.d': 0.309, 'eg2.s': 0, 'filter.route': 2, 'sem.mode': 1, 'sem.cutoff': 214, 'sem.res': 0.63, 'sem.eg1': 0.172,
        'lfo1.rate': 0.183, 'lfo1.level': 0.622, 'lfo1.retrig': 1, 'lfo2.rate': 0.098, 'lfo2.level': 0.188, 'lfo2.retrig': 1, 'out.level': 0.626,
      }, [
        { source: 'vel', dest: 'lad.cutoff', amount: 0.15 }, { source: 'seq', dest: 'lad.cutoff', amount: 0.5 }, { source: 'vel', dest: 'eg1.level', amount: 0.4 },
        { source: 'lfo1', dest: 'lad.cutoff', amount: 0.302 }, { source: 'lfo1', dest: 'lfo1.rate', amount: -0.049 }, { source: 'lfo2', dest: 'sem.cutoff', amount: -0.513 },
      ]),
    };
    // the metal: Plaits' PARTICLE (its AUX mostly) over a square an octave down, driven, both filters resonant, a slow
    // swell of envelope and the band-pass's resonance thrown at random (as the user set it)
    parts[NM.METAL] = {
      name: 'Metal', voices: 1, channel: 4,
      ...sound('Metal Hit', {
        'osc1.oct': 1, 'osc1.width': 0.7, 'osc1.blend': 1, 'mix.noise': 0, 'mix.osc2': 0, 'osc2.oct': 4,
        'osc3.mode': 1, 'osc3.model': 10, 'osc3.harm': 0.65, 'osc3.timbre': 0.016, 'osc3.morph': 0.829, 'osc3.aux': 0.744, 'osc3.tune': -2.492, 'mix.osc3': 1,
        drive: 0.815, 'lad.cutoff': 1100, 'lad.res': 0.507, 'lad.eg1': 0.528, 'sem.mode': 1, 'sem.cutoff': 224, 'sem.res': 0.365, 'sem.eg1': -0.252,
        'eg1.a': 0.718, 'eg1.d': 0.156, 'eg1.s': 0, 'eg2.s': 0.649, 'eg2.r': 0.127, 'out.level': 1,
      }, [{ source: 'rand', dest: 'sem.cutoff', amount: 0.08 }, { source: 'rand', dest: 'sem.res', amount: 0.563 }]),
    };
    // the noise a little more open, LFO 2 moving it (as the user set it)
    parts[NM.NOISE] = {
      name: 'Noise', voices: 1, channel: 5,
      ...sound('Noise Sweep', { 'lad.cutoff': 528, 'out.level': 1 }, [
        { source: 'seq', dest: 'lad.cutoff', amount: 0.85 }, { source: 'mod', dest: 'lad.cutoff', amount: 0.85 }, { source: 'lfo2', dest: 'lad.cutoff', amount: 0.127 },
      ]),
    };

    const { KICK, HATS, PERC, RUMBLE, STAB, ACID, METAL, NOISE, TOMS } = NM;
    const ramp = (from: number, to: number) => (x: number) => from + (to - from) * x;
    // the metal's seven-step loop, its second hit and both lengths changing from section to section (as the user set them)
    const metal = (second = 81, first = 0.5, last = 0.5) => track([[0, 76, { vel: 0.9, gate: first }], [4, second, { vel: 0.6, gate: last }]], 7);
    // in the break, the stab's fifth hit held a little longer and the toms without their high hit (as the user set them)
    const breakStab = nmStab();
    breakStab.steps[23]!.gate = 0.75;
    const breakToms = scToms();
    breakToms.steps[7]!.notes = [];
    const patterns = [
      // 0, 1 intro: the kick and closed hats; then the open hats, the toms and the metal
      pattern({ [KICK]: dyn(nmKick(), 0.9), [HATS]: dyn(nmHats({ open: false }), 0.8) }),
      pattern({ [KICK]: dyn(nmKick(), 0.92), [HATS]: dyn(nmHats(), 0.85), [TOMS]: dyn(scToms(), 0.8), [METAL]: dyn(scMetal(), 0.8) }),
      // 2 the rumble opens up under it, the rims come in
      pattern({ [KICK]: dyn(nmKick(), 0.95), [HATS]: dyn(nmHats(), 0.9), [PERC]: dyn(nmPerc({ clap: false }), 0.9), [RUMBLE]: nmRumble({ open: [45, 75] }),
        [TOMS]: dyn(scToms(), 0.85), [METAL]: dyn(metal(69, 5.75, 1), 0.85) }),
      // 3 the groove: the clap in, everything driving
      pattern({ [KICK]: nmKick(), [HATS]: dyn(nmHats(), 0.95), [PERC]: nmPerc(), [RUMBLE]: nmRumble(), [TOMS]: dyn(scToms(), 0.9), [METAL]: dyn(metal(81, 2, 1), 0.9) }),
      // 4 the stab beaten into the delay
      pattern({ [KICK]: nmKick(), [HATS]: dyn(nmHats(), 0.95), [PERC]: nmPerc(), [RUMBLE]: nmRumble(), [STAB]: nmStab(), [TOMS]: dyn(scToms(), 0.9), [METAL]: dyn(metal(69, 5.25, 2), 0.9) }),
      // 5 the ride and the ghost kicks on top
      pattern({ [KICK]: nmKick({ ghost: true }), [HATS]: nmHats({ ride: true }), [PERC]: nmPerc(), [RUMBLE]: nmRumble(), [STAB]: nmStab(), [TOMS]: scToms(), [METAL]: metal(76, 0.5, 2.25) }),
      // 6 the break: no kick, no rumble; the noise rising, the stab and the toms, the hats closed
      pattern({ [HATS]: dyn(nmHats({ open: false }), 0.8), [PERC]: dyn(nmPerc({ clap: false }), 0.8), [STAB]: dyn(breakStab, 0.9), [TOMS]: dyn(breakToms, 0.85),
        [NOISE]: mods(scNoise(), (i) => 0.5 * (i / 63) ** 2) }),
      // 7 the build: the kick rolling in eighths, then sixteenths, the claps rolling through the last beat, the noise all the way up
      pattern({ [KICK]: nmKick({ roll: true, off: true }), [HATS]: dyn(nmHats({ open: false }), ramp(0.8, 1)), [PERC]: nmPerc({ clap: false, fill: true }),
        [STAB]: dyn(nmStab(), 0.9), [NOISE]: mods(scNoise(), (i) => 0.5 + 0.5 * (i / 63) ** 2) }),
      // 8 the drop: a crash, everything; the acid there but muted (as the user left it), to bring in by hand
      pattern({ [KICK]: nmKick({ crash: true }), [HATS]: nmHats(), [PERC]: nmPerc(), [RUMBLE]: nmRumble(), [ACID]: { ...nmAcid(ramp(0.1, 0.4)), muted: true }, [TOMS]: scToms(), [METAL]: scMetal() }),
      // 9, 10 the acid tearing open over the ride, then the stab back against it
      pattern({ [KICK]: nmKick({ ghost: true }), [HATS]: nmHats({ ride: true }), [PERC]: nmPerc(), [RUMBLE]: nmRumble(), [ACID]: nmAcid(ramp(0.4, 0.75)), [METAL]: scMetal() }),
      pattern({ [KICK]: nmKick({ ghost: true }), [HATS]: nmHats({ ride: true }), [PERC]: nmPerc(), [RUMBLE]: nmRumble(), [ACID]: nmAcid((x) => 0.7 + 0.25 * Math.sin(Math.PI * x)),
        [STAB]: nmStab(), [TOMS]: scToms(), [METAL]: scMetal() }),
      // 11 the second break: the acid alone in the delay over the noise, the kick rolling back in
      pattern({ [KICK]: nmKick({ roll: true, off: true }), [ACID]: dyn(nmAcid(ramp(0.3, 0.9)), 0.9), [PERC]: nmPerc({ clap: false, rims: false, fill: true }),
        [NOISE]: mods(scNoise(), (i) => (i / 63) ** 2) }),
      // 12 the last drop: all of it, as hard as it goes
      pattern({ [KICK]: nmKick({ crash: true, ghost: true }), [HATS]: nmHats({ ride: true }), [PERC]: nmPerc(), [RUMBLE]: nmRumble(), [ACID]: nmAcid((x) => 0.75 + 0.2 * Math.sin(2 * Math.PI * x)),
        [STAB]: nmStab(), [TOMS]: scToms(), [METAL]: scMetal() }),
      // 13 the acid closing down, the stab still beating
      pattern({ [KICK]: nmKick(), [HATS]: nmHats(), [PERC]: nmPerc(), [RUMBLE]: nmRumble(), [ACID]: dyn(nmAcid(ramp(0.6, 0.05)), ramp(1, 0.8)), [STAB]: nmStab(), [METAL]: scMetal() }),
      // 14, 15 out: the rumble closing, the clap gone; then the kick and the hats alone
      pattern({ [KICK]: nmKick(), [HATS]: dyn(nmHats(), 0.9), [PERC]: dyn(nmPerc({ clap: false }), 0.85), [RUMBLE]: nmRumble({ open: [75, 40] }), [TOMS]: dyn(scToms(), 0.85),
        [METAL]: dyn(scMetal(), 0.85) }),
      pattern({ [KICK]: dyn(nmKick(), 0.92), [HATS]: dyn(nmHats({ open: false }), 0.8) }),
    ];

    // the effects are the sound. The rumble is the kick's own tail: the kick sent hard into a big dark hall whose return
    // is filtered down to its lows and pumped by the compressor (keyed by the kick), the rumble synth thickening it.
    // The hats shimmer in the ping-pong BBD and the ensemble; the clap and toms in the hall; the stab and the metal
    // beaten into the dub delay (saturating, fluttering), whose repeats feed the hall; the acid in both delays; the
    // noise all hall and ensemble, wide.
    const mix: Record<string, number> = {
      // (the faders, filters, EQ and sends below as the user set them by ear, where they differ from the first mix)
      ...pedalParams(1, 1, 'DRIVE', { Type: 'DIODE', Drive: 0.128, Tone: 0.712, Level: 1 }),
      'p1.fader': 0.9, 'p1.lo': 2, 'p1.c': 0.35, 'p1.filter': 0.186,
      'p2.fader': 1.495, 'p2.pan': 0.15, 'p2.b': 0.25, ...pedalParams(2, 1, 'CHORUS', { Mode: 'ENSEMBLE' }, 0.175), 'p2.hi': -3.3, 'p2.filter': -0.282,
      'p3.fader': 0.497, 'p3.pan': -0.15, 'p3.c': 0.45, 'p3.a': 0.12, 'p3.mid': 2, 'p3.hi': 6, 'p3.filter': 0.242,
      'p4.fader': 1, 'p4.c': 0.45, 'p4.mid': 3, 'p4.filter': -0.766,
      'p5.fader': 1.8, 'p5.a': 0.7, ...pedalParams(5, 1, 'CHORUS', { Mode: 'ENSEMBLE' }, 0.15), 'p5.lo': -8, 'p5.mid': 3, 'p5.pan': -0.2,
      'p6.fader': 1.344, 'p6.a': 0.204, ...pedalParams(6, 1, 'CHORUS', { Mode: 'ENSEMBLE' }, 0.202), 'p6.mid': 2, 'p6.lo': -19.3, 'p6.filter': 0.224,
      'p7.fader': 1.995, 'p7.a': 0.6, 'p7.b': 1, 'p7.c': 0.3, ...pedalParams(7, 1, 'CHORUS', { Mode: 'ENSEMBLE' }, 0.5), 'p7.pan': 0.5, 'p7.lo': -30, 'p7.filter': -0.39,
      'p8.fader': 0.408, 'p8.a': 0.578, 'p8.c': 0.6, ...pedalParams(8, 1, 'CHORUS', { Mode: 'ENSEMBLE' }, 0.25), 'p8.lo': -28, 'p8.filter': 0.402,
      'p9.fader': 1.1, 'p9.pan': -0.5, 'p9.a': 0.4, 'p9.c': 0.3, 'p9.mid': 2,
      // A: the dub delay, long, saturating, fluttering, its repeats into the hall
      'dub.sync': 1, 'dub.div': 3, 'dub.fdbk': 0.7, 'dub.tone': 4390, 'dub.wow': 0.4, 'dub.sat': 0.7, 'dub.flutter': 0.4,
      'rA.fader': 1, 'rA.c': 0.3, 'rA.lo': -6, 'rA.hi': -3,
      // B: Beads' delay in eighth triplets, dense, pitched down a fourth and a bit
      'bbd.mode': 1, 'bbd.sync': 1, 'bbd.div': 1, 'bbd.fdbk': 0.5, 'bbd.age': 0.4, 'bbd.mod': 0.3, 'bbd.ping': 1,
      'bds.density': 0.739, 'bds.filter': 0.805, 'bds.pitch': -5.424,
      'rB.fader': 0.9, 'rB.lo': -8,
      // C: a smaller, darker hall with a long pre-delay; its return low-passed, its sub taken down and its low mids up: the rumble
      'rev.type': 2, 'rev.size': 0.412, 'rev.damp': 1, 'rev.pre': 0.114, 'rev.tone': 0.096,
      'rC.fader': 1.2, 'rC.filter': -0.3, 'rC.lo': -4, 'rC.mid': 3, 'rC.hi': -10,
      // (the ensemble chorus, for width, is a pedal on each part that had it)
      // the compressor keyed by the kick, ducking all of it (the rumble pumps); the master onto tape
      'cmp.key': 1, 'cmp.ratio': 5, 'cmp.thresh': -26, 'cmp.atk': 1, 'cmp.rel': 160, 'cmp.mix': 0.9,
      'tape.drive': 15, 'tape.tone': 0.4,
    };
    // intro 16 bars, the rumble in 8, groove 16, stab 16, ride 16, break 4, build 4, drop 16, the acid 32, second
    // break 4, last drop 16, closing 8, out 16: about four and a half minutes
    const chain = [0, 0, 1, 1, 2, 2, 3, 3, 3, 3, 4, 4, 4, 4, 5, 5, 5, 5, 6, 7, 8, 8, 8, 8, 9, 9, 9, 9, 10, 10, 10, 10, 11, 12, 12, 12, 12, 13, 13, 14, 14, 15, 15];
    return multi('No Mercy', 148, parts, patterns, chain, mix);
  },
};

// ================= DUB PRESSURE · 140 =================
// Old-school dubstep, 140 BPM in half time (the snare on the third beat), on E with F leaning in. The dub is in the
// mix: the delay long and saturating, its echoes into the spring, and a part of throws, the hits a dub engineer
// would send whole into the delay (the sends are after the fader, so a throw is its own part, its send all the way up).
const DP = { DRUMS: 0, THROWS: 1, SUB: 2, STRINGS: 3, SKANK: 4, SIREN: 5, VOX: 6, PAD: 7, SHAKER: 8, NOISE: 9 };
const E1 = 28, G1 = 31, D1 = 26, F1 = 29;

/** The half-time kit: the kick on one (and a second one moving from bar to bar), the snare with the clap on three,
 * swung sixteenth hats (the off ones late, as a triplet feel; the quiet ones come and go), ghost rims, an open hat now
 * and then. `fill`: toms down through the last beat. */
function dsDrums(o: { kick?: boolean; snare?: boolean; hats?: boolean; fill?: boolean } = {}): RigTrack {
  const { kick = true, snare = true, hats = true, fill = false } = o;
  const KICKS = [[0], [0, 10], [0], [0, 6, 14]];
  const steps: Steps = [];
  for (let i = 0; i < 64; i++) {
    const notes: number[] = [], vels: Record<number, number> = {}, b = i % 16, bar = i >> 4;
    if (kick && KICKS[bar]!.includes(b) && !(fill && i >= 60)) { notes.push(BD); vels[BD] = b ? 0.75 : 1; }
    if (snare && b === 8) { notes.push(SD, CP); vels[SD] = 0.95; vels[CP] = 0.7; }
    if (snare && (b === 3 || b === 13)) { notes.push(RS); vels[RS] = 0.3; }
    if (hats && !(fill && i >= 60)) {
      if ((bar === 1 || bar === 3) && b === 14) { notes.push(OH); vels[OH] = 0.5; }
      else { notes.push(CH); vels[CH] = [0.55, 0.22, 0.4, 0.28][b % 4]!; }
    }
    if (fill && i >= 60) { const tom = [HT, MT, LT, LT][i - 60]!; notes.push(tom); vels[tom] = 0.7 + 0.08 * (i - 60); }
    if (notes.length) steps.push([i, notes, { vel: 0.9, vels }]);
  }
  const t = track(steps, 64);
  for (let i = 1; i < 64; i += 2) { t.steps[i]!.micro = 0.17; if (t.steps[i]!.notes.length && i % 16 !== 3 && i % 16 !== 13) t.steps[i]!.prob = 0.8; }
  return t;
}
/** The throws: hits sent whole into the dub. By default the snare at the end of the phrase and a rim in bar two. */
const dsThrows = (hits: [number, number, number?][] = [[27, RS, 0.7], [56, SD, 1]]): RigTrack =>
  track(hits.map(([i, n, v]): Steps[number] => [i, n, { vel: v ?? 0.9 }]), 64);
/** The sub: long notes on E, the second hit short, the end of the phrase going down to D and up to F. */
const dsSub = (from = 0): RigTrack => track(([
  [0, E1, 6], [10, E1, 3], [16, E1, 6], [26, G1, 4], [32, E1, 6], [42, E1, 3], [48, E1, 6], [56, D1, 4], [60, F1, 4],
] as const).filter(([i]) => i >= from).map(([i, n, g]): Steps[number] => [i, n, { vel: 0.9, gate: g }]), 64);
/** The sub in the break: E held a bar at a time. */
const dsSubHeld = (): RigTrack => track([0, 16, 32, 48].map((i): Steps[number] => [i, i === 48 ? F1 : E1, { vel: 0.85, gate: 15.5 }]), 64);
/** The skank: a dark chord on the offbeats (E minor; F major leaning in at the end), or (sparse) once in bars one and three. */
const EM = [52, 55, 59], FM = [53, 57, 60];
const dsSkank = (sparse = false): RigTrack => track(sparse
  ? [[6, EM, { vel: 0.9, gate: 0.4 }], [38, EM, { vel: 0.85, gate: 0.4 }]]
  : [0, 16, 32, 48].flatMap((bar): Steps => [
    [bar + 6, bar === 48 ? FM : EM, { vel: 0.9, gate: 0.4 }], [bar + 13, bar === 48 ? FM : EM, { vel: 0.65, gate: 0.3 }],
  ]), 64);
/** The strings' swells: a chord bowed for a bar (the attack is the swell), cut dead at its end so the echoes have the
 * next bar to themselves. E minor nine, or C major seven over the E (`warm`); `prob` for one that only sometimes comes. */
const EM9 = [52, 55, 59, 62, 66], CMAJ7 = [48, 52, 55, 59, 64];
const dsSwell = (at: [step: number, warm?: boolean][], prob = 1): RigTrack => {
  const t = track(at.map(([i, warm]): Steps[number] => [i, warm ? CMAJ7 : EM9, { vel: 0.9, gate: 16 }]), 64);
  for (const [i] of at) t.steps[i]!.prob = prob;
  return t;
};
/** The siren, held, wherever `at` puts it (steps, and how long). */
const dsSiren = (at: [number, number][] = [[32, 12]]): RigTrack => track(at.map(([i, g]): Steps[number] => [i, 71, { vel: 0.85, gate: g }]), 64);
/** Voice fragments, each a word (MORPH, locked) cut short, in the space after the snare. */
const dsVox = (second = false): RigTrack => track((second
  ? [[12, 52, 0.75, 0.55], [44, 52, 1.5, 0.55], [46, 50, 1, 0.8]]
  : [[10, 52, 1.5, 0.2], [42, 52, 0.75, 0.2], [44, 55, 2, 0.4]]
).map(([i, n, g, w]): Steps[number] => [i!, n!, { vel: 0.9, gate: g, locks: { 'osc3.morph': w! } }]), 64);
/** The pad: E minor, low, bowed each bar, swelling open (the SEQ lane). */
const dsPad = (shape: (x: number) => number = swell): RigTrack => mods(track([0, 16, 32, 48].map((i): Steps[number] =>
  [i, [40, 47, 55], { vel: 0.7, gate: 16 }]), 64), (i) => shape(i / 63));
/** A shaker in swung sixteenths. */
function dsShaker(): RigTrack {
  const t = track(Array.from({ length: 16 }, (_, i): Steps[number] => [i, 60, { vel: [0.55, 0.35, 0.8, 0.4][i % 4]!, gate: 0.3 }]), 16);
  for (let i = 1; i < 16; i += 2) t.steps[i]!.micro = 0.17;
  return t;
}

const dubPressure: RigFactoryMulti = {
  name: 'DUB PRESSURE · 140',
  build: () => {
    const parts: Partial<RigMultiPart>[] = [];
    // the kit: a short, deep kick, a big snare with the clap, dry rims, short hats, low toms
    const kit = cloneKit(RIG_KITS[0]!);
    kit.name = 'Dub Kit';
    kit.pads[BD - 36]!.analog = { 'kick.tune': 50, 'kick.decay': 0.4, 'kick.click': 0.35 };
    kit.pads[SD - 36]!.analog = { 'snare.tune': 180, 'snare.decay': 0.3, 'snare.snap': 0.8 };
    kit.pads[CP - 36]!.analog = { 'clap.tone': 1100, 'clap.decay': 0.25 };
    kit.pads[RS - 36]!.analog = { 'rim.tone': 1200 };
    Object.assign(kit.pads[CH - 36]!, { analog: { 'closedHat.decay': 0.04 }, cutoff: 9000 });
    Object.assign(kit.pads[OH - 36]!, { analog: { 'openHat.decay': 0.3 }, cutoff: 8000 });
    parts[DP.DRUMS] = { name: 'Drums', kind: 'kit', kit, channel: 10 };
    parts[DP.THROWS] = { name: 'Throws', kind: 'kit', kit: cloneKit(kit), channel: 11 };
    // the sub: a triangle and a pulse an octave up, driven into a ladder shut down to 71 Hz, a touch of envelope and
    // noise; LFO 1 (half notes, free-running) bending its pitch and fading the triangle; a long release (as the user
    // set it). Mono, a little glide
    parts[DP.SUB] = {
      name: 'Sub', voices: 1, channel: 1,
      ...sound('Init', {
        'voice.mode': 1, 'voice.glide': 0.04, 'osc1.width': 1, 'mix.osc1': 1, 'osc2.oct': 3, 'osc2.blend': 1, 'osc2.width': 0.718, 'mix.osc2': 0.866,
        'mix.noise': 0.023, drive: 1, 'lad.cutoff': 71, 'lad.eg1': 0.146, 'filter.key': 0,
        'eg2.a': 0.005, 'eg2.d': 1, 'eg2.s': 1, 'eg2.r': 1.65, 'lfo1.sync': 1, 'lfo1.div': 3, 'lfo1.level': 0.863, 'lfo1.retrig': 1, 'out.level': 1,
      }, [{ source: 'lfo1', dest: 'osc1.tune', amount: 0.077 }, { source: 'lfo1', dest: 'mix.osc1', amount: -0.256 }]),
    };
    // the strings: SCALPEL's tape strings, swelling in over a second and a half (brightening as they rise) and cut
    // dead: the dub delay and the spring carry what was cut off
    parts[DP.STRINGS] = {
      name: 'Strings', voices: 10, channel: 9,
      ...sound('Tape Strings', { 'lad.cutoff': 1800, 'eg2.a': 1.5, 'eg2.d': 1, 'eg2.s': 1, 'eg2.r': 0.03, 'out.level': 1 }, [
        { source: 'lfo1', dest: 'osc1.tune', amount: 0.002 }, { source: 'lfo1', dest: 'osc2.tune', amount: 0.002 },
        { source: 'lfo2', dest: 'osc1.tune', amount: 0.003 }, { source: 'lfo2', dest: 'osc2.tune', amount: 0.003 },
        { source: 'eg2', dest: 'lad.cutoff', amount: 0.3 },
      ]),
    };
    parts[DP.SKANK] = { name: 'Skank', voices: 3, channel: 3, ...sound('Dub Chord', { 'eg1.d': 0.2, 'eg2.d': 0.25, 'eg2.r': 0.2, 'out.level': 1 }) };
    // the siren: a narrow pulse, a falling sweep (LFO 1, ramp down) on its pitch, and the pitch rising as it is held (EG 1)
    parts[DP.SIREN] = {
      name: 'Siren', voices: 1, channel: 4,
      ...sound('Init', {
        'voice.mode': 1, 'osc1.blend': 1, 'osc1.width': 0.2, 'mix.osc1': 0.8, 'lad.cutoff': 3000, 'lad.eg1': 0,
        'eg1.a': 1.5, 'eg1.d': 1, 'eg1.s': 1, 'eg2.a': 0.01, 'eg2.s': 1, 'eg2.r': 0.4, 'lfo1.rate': 5, 'lfo1.shape': 4, 'lfo1.retrig': 0, 'out.level': 0.8,
      }, [{ source: 'lfo1', dest: 'osc1.tune', amount: 0.06 }, { source: 'eg1', dest: 'osc1.tune', amount: 0.12 }]),
    };
    parts[DP.VOX] = { name: 'Vox', voices: 3, channel: 5, ...sound('Dub Words', { 'out.level': 1 }) };
    parts[DP.PAD] = {
      name: 'Pad', voices: 6, channel: 6,
      ...sound('String Machine', { 'lad.cutoff': 700, 'out.level': 1 }, [
        { source: 'lfo1', dest: 'osc1.tune', amount: 0.0015 }, { source: 'lfo1', dest: 'osc2.tune', amount: 0.0015 }, { source: 'seq', dest: 'lad.cutoff', amount: 0.35 },
      ]),
    };
    parts[DP.SHAKER] = { name: 'Shaker', voices: 1, channel: 7, ...sound('Shaker', { 'out.level': 1 }) };
    parts[DP.NOISE] = { name: 'Noise', voices: 1, channel: 8, ...sound('Noise Sweep', { 'out.level': 1 }) };

    const { DRUMS, THROWS, SUB, STRINGS, SKANK, SIREN, VOX, PAD, SHAKER, NOISE } = DP;
    const ramp = (from: number, to: number) => (x: number) => from + (to - from) * x;
    const patterns = [
      // 0 intro: the pad swelling, the siren, a voice, a rim thrown into the dub
      pattern({ [PAD]: dsPad(), [SIREN]: dsSiren([[40, 14]]), [VOX]: dsVox(), [THROWS]: dsThrows([[27, RS, 0.7], [59, RS, 0.6]]) }),
      // 1 intro: the shaker, the sub coming in halfway, the snare thrown at the end
      pattern({ [PAD]: dsPad(), [SHAKER]: dyn(dsShaker(), 0.8), [SUB]: dsSub(32), [VOX]: dsVox(true), [THROWS]: dsThrows(), [STRINGS]: dsSwell([[32]]) }),
      // 2 the riddim: the drums, the sub, the skank once a bar or two, the throws
      pattern({ [DRUMS]: dyn(dsDrums(), 0.95), [SUB]: dsSub(), [SKANK]: dsSkank(true), [SHAKER]: dyn(dsShaker(), 0.8), [THROWS]: dsThrows() }),
      // 3 the skank on every offbeat, the voice in the gaps
      pattern({ [DRUMS]: dsDrums(), [SUB]: dsSub(), [SKANK]: dsSkank(), [VOX]: dsVox(), [SHAKER]: dyn(dsShaker(), 0.85), [THROWS]: dsThrows([[27, RS, 0.7], [44, MT, 0.8], [56, SD, 1]]) }),
      // 4, 5 stripped back: the drums, the sub and the throws; then the siren, the skank thinning
      pattern({ [DRUMS]: dsDrums(), [SUB]: dsSub(), [SHAKER]: dyn(dsShaker(), 0.85), [THROWS]: dsThrows() }),
      pattern({ [DRUMS]: dsDrums(), [SUB]: dsSub(), [SKANK]: dsSkank(true), [SIREN]: dsSiren([[16, 10]]), [THROWS]: dsThrows([[24, SD, 0.9], [56, SD, 1]]) }),
      // 6 the break: no kick, no hats; the snare thrown every bar, the sub held, the pad, the voice
      pattern({ [THROWS]: dsThrows([[8, SD, 0.9], [24, SD, 0.85], [40, SD, 0.9], [56, SD, 1], [59, RS, 0.6]]), [SUB]: dsSubHeld(), [PAD]: dsPad(),
        [VOX]: dsVox(true), [SHAKER]: dyn(dsShaker(), 0.7), [STRINGS]: dsSwell([[0], [32, true]]) }),
      // 7 the build: the noise rising, the drums back with toms down the end, the sub held under it
      pattern({ [DRUMS]: dyn(dsDrums({ kick: false, fill: true }), ramp(0.75, 1)), [NOISE]: mods(scNoise(), (i) => (i / 63) ** 2), [SUB]: dsSubHeld() }),
      // 8 the drop: the sub, the drums, the siren, the throws
      pattern({ [DRUMS]: dsDrums(), [SUB]: dsSub(), [SIREN]: dsSiren([[0, 8]]), [SHAKER]: dsShaker(), [THROWS]: dsThrows() }),
      // 9 the drop again: the skank, the voice
      pattern({ [DRUMS]: dsDrums(), [SUB]: dsSub(), [SKANK]: dsSkank(), [VOX]: dsVox(true), [SHAKER]: dsShaker(), [STRINGS]: dsSwell([[32, true]], 0.4),
        [THROWS]: dsThrows([[27, RS, 0.7], [44, MT, 0.8], [56, SD, 1]]) }),
      // 10 the dub-out: the kick and snare alone under the skank and voice, everything thrown
      pattern({ [DRUMS]: dyn(dsDrums({ hats: false }), 0.9), [SUB]: dsSub(), [SKANK]: dsSkank(), [VOX]: dsVox(), [STRINGS]: dsSwell([[32]]),
        [THROWS]: dsThrows([[8, SD, 0.8], [27, RS, 0.7], [40, SD, 0.85], [44, MT, 0.8], [56, SD, 1], [60, LT, 0.8]]) }),
      // 11 out: the pad, the sub, a rim and the siren into the delay
      pattern({ [PAD]: dsPad((x) => 0.6 * (1 - x)), [SUB]: dsSubHeld(), [STRINGS]: dsSwell([[0, true]]), [SIREN]: dsSiren([[8, 12]]), [THROWS]: dsThrows([[27, RS, 0.6], [59, RS, 0.5]]) }),
    ];

    const mix: Record<string, number> = {
      // the kit nearly dry (a touch of spring), the throws all the way into the dub; the sub dry, mono, in the middle
      'p1.fader': 1, 'p1.a': 0.06, 'p1.c': 0.12,
      'p2.fader': 0.8, 'p2.a': 1, 'p2.c': 0.35, 'p2.hi': -2,
      'p3.fader': 2,
      // the skank deep in the dub, ping-ponging in B, into the spring
      // the strings loud, well into the dub and the spring (the echoes are where the cut swell goes)
      'p4.fader': 1.4, 'p4.a': 0.6, 'p4.c': 0.35, 'p4.lo': -8,
      'p5.fader': 1.3, 'p5.a': 0.7, 'p5.b': 0.3, 'p5.c': 0.3, 'p5.lo': -10, 'p5.pan': 0.2,
      'p6.fader': 0.9, 'p6.a': 0.8, 'p6.c': 0.3, 'p6.pan': -0.3, 'p6.lo': -12,
      'p7.fader': 1.3, 'p7.a': 0.85, 'p7.c': 0.35, 'p7.lo': -8,
      'p8.fader': 0.6, 'p8.c': 0.4, 'p8.lo': -10, ...pedalParams(8, 1, 'CHORUS', { Mode: 'ENSEMBLE' }, 0.2),
      'p9.fader': 0.7, 'p9.pan': 0.35, 'p9.b': 0.25,
      'p10.fader': 0.8, 'p10.c': 0.5, 'p10.lo': -12,
      // A: the dub delay, dotted eighth, long and saturating, wow and flutter; its echoes into the spring
      'dub.sync': 1, 'dub.div': 3, 'dub.fdbk': 0.78, 'dub.tone': 1700, 'dub.wow': 0.45, 'dub.sat': 0.65, 'dub.flutter': 0.35,
      'rA.fader': 1.35, 'rA.c': 0.35, 'rA.lo': -8,
      // B: the BBD in eighths, ping-pong
      'bbd.sync': 1, 'bbd.div': 2, 'bbd.fdbk': 0.4, 'bbd.age': 0.5, 'bbd.ping': 1, 'rB.lo': -8,
      // C: the spring
      'rev.type': 0, 'rev.size': 0.65, 'rev.damp': 0.5, 'rev.tone': 0.45, 'rC.lo': -6,
      'cmp.key': 1, 'cmp.ratio': 2.5, 'cmp.thresh': -18, 'cmp.atk': 3, 'cmp.rel': 180, 'cmp.mix': 0.6,
      'tape.drive': 6, 'tape.tone': 0.35, 'tape.wow': 0.08,
    };
    // intro 16 bars, the riddim 24, stripped back 24, the break 8, the build 4, the drop 32, the dub-out 8, out 8: about four minutes
    const chain = [0, 0, 1, 1, 2, 2, 2, 2, 3, 3, 3, 3, 4, 4, 4, 4, 5, 5, 6, 6, 7, 8, 8, 8, 8, 9, 9, 9, 9, 10, 10, 11, 11];
    return multi('Dub Pressure', 140, parts, patterns, chain, mix);
  },
};

// ================= MYCELIUM · 96 =================
// Psy-dub on D, Phrygian: a drone and parts that interlock round it rather than a progression (E flat leaning in now
// and then). The psychedelic parts take turns: a squelch wandering on its own (random LFOs, slewed), a kalimba in fives
// against the fours, the sync lead's sweeps, the vowel calls, the chord pad's random voicings. The dub is in the mix:
// a long dotted-eighth tape echo, Beads on B for the grains, a hall, and throws.
const MY = { DRUMS: 0, THROWS: 1, BASS: 2, DRONE: 3, KEYS: 4, SQUELCH: 5, CONGA: 6, KALIMBA: 7, VOX: 8, SWEEP: 9, PAD: 10, CHORDS: 11, ZAP: 12,
  SHAKER: 13, NOISE: 14, DUST: 15 };
const D2 = 38, D3n = 50, D4 = 62;

/** Like `sound`, but keeping the preset's B side (for a sound whose MOD wheel morphs A into B). */
function soundAB(base: string, params: Record<string, number>): { slot: number; sound: string; a: RigSide; b: RigSide } {
  const p = preset(base);
  const side = (s: RigSide): RigSide => ({ params: { ...s.params, ...params }, matrix: s.matrix.map((r) => ({ ...r })) });
  return { slot: p.slot, sound: p.sound, a: side(p.a), b: side(p.b) };
}

/** The kit: the snare on two and four, the kick moving from bar to bar, swung sixteenth hats (the quiet ones come and
 * go), ghost rims, the open hat closing each second bar. `fill`: the low toms (tuned like hand drums) down the last beat. */
function myDrums(o: { kick?: boolean; snare?: boolean; hats?: boolean; fill?: boolean } = {}): RigTrack {
  const { kick = true, snare = true, hats = true, fill = false } = o;
  const KICKS = [[0, 10], [0, 7, 10], [0, 10], [0, 6, 10, 15]];
  const steps: Steps = [];
  for (let i = 0; i < 64; i++) {
    const notes: number[] = [], vels: Record<number, number> = {}, b = i % 16, bar = i >> 4, end = fill && i >= 60;
    if (kick && KICKS[bar]!.includes(b) && !end) { notes.push(BD); vels[BD] = b === 0 ? 1 : b === 15 ? 0.6 : 0.8; }
    if (snare && (b === 4 || b === 12)) { notes.push(SD); vels[SD] = b === 12 ? 0.95 : 0.85; }
    if (snare && (b === 7 || b === 14) && bar % 2 === 1) { notes.push(RS); vels[RS] = 0.28; }
    if (hats && !end) {
      if ((bar === 1 || bar === 3) && b === 14) { notes.push(OH); vels[OH] = 0.45; }
      else if (b % 2 === 0 || bar > 0) { notes.push(CH); vels[CH] = [0.5, 0.18, 0.36, 0.24][b % 4]!; }
    }
    if (end) { const tom = [MT, LT, LT, LT][i - 60]!; notes.push(tom); vels[tom] = 0.6 + 0.1 * (i - 60); }
    if (notes.length) steps.push([i, notes, { vel: 0.9, vels }]);
  }
  const t = track(steps, 64);
  for (let i = 1; i < 64; i += 2) { t.steps[i]!.micro = 0.15; if (t.steps[i]!.notes.includes(CH)) t.steps[i]!.prob = 0.75; }
  return t;
}
/** The throws: hits sent whole into the dub. By default a rim in bar two and the snare ending the phrase. */
const myThrows = (hits: [number, number, number?][] = [[30, RS, 0.6], [60, SD, 0.9]]): RigTrack =>
  track(hits.map(([i, n, v]): Steps[number] => [i, n, { vel: v ?? 0.85 }]), 64);
/** The bass: round and rolling on D, legato so the slides glide; the second bar leans up to G and down through E flat,
 * the fourth walks down to A and back up through C and E flat. Velocity is the push (it shapes the tone too). */
const MY_BASS: [step: number, offset: number, gate: number, vel: number][] = [
  [0, 0, 3, 0.95], [3, 0, 1, 0.6], [6, 3, 2, 0.8], [8, 0, 2, 0.85], [11, -2, 1, 0.6], [12, 0, 3, 0.8],
  [16, 0, 3, 0.95], [19, 0, 1, 0.6], [22, 5, 2, 0.8], [24, 3, 2.2, 0.75], [26, 1, 2.2, 0.7], [28, 0, 4, 0.85],
  [32, 0, 3, 0.95], [35, 0, 1, 0.6], [38, 3, 2, 0.8], [40, 0, 2, 0.85], [43, -2, 1, 0.6], [44, 0, 3, 0.8],
  [48, 0, 3, 0.95], [51, 0, 1, 0.6], [54, -5, 2.2, 0.8], [56, -4, 2.2, 0.75], [58, -2, 2.2, 0.75], [60, 0, 2, 0.85], [62, 1, 1.5, 0.65],
];
const myBass = (from = 0): RigTrack => track(MY_BASS.filter(([i]) => i >= from).map(([i, o, g, v]): Steps[number] => [i, D2 + o, { vel: v, gate: g }]), 64);
/** The bass held in the break: D a bar at a time, the last bar on E flat. */
const myBassHeld = (): RigTrack => track([0, 16, 32, 48].map((i): Steps[number] => [i, i === 48 ? D2 + 1 : D2, { vel: 0.8, gate: 15.5 }]), 64);
/** The drone: D, A and D above the bass, bowed again each bar. */
const myDrone = (): RigTrack => track([0, 16, 32, 48].map((i): Steps[number] => [i, [D3n, 57, D4], { vel: 0.7, gate: 16 }]), 64);
/** The keys' skank: D minor (with the seventh) short on the offbeat eighths, the last of four bars leaning to E flat;
 * `sparse`: only the second and fourth beats' offbeats. */
const DM7 = [D3n, 53, 57, 60], EBM = [51, 55, 58, 62];
const myKeys = (sparse = false): RigTrack => track([0, 16, 32, 48].flatMap((bar): Steps =>
  (sparse ? [6, 14] : [2, 6, 10, 14]).map((b): Steps[number] => [bar + b, bar === 48 && b >= 10 ? EBM : DM7, { vel: b === 6 || b === 14 ? 0.85 : 0.6, gate: 0.35 }])), 64);
/** The squelch: twelve steps against the sixteen, so it turns over the bar every three; D with its octave, E flat and F
 * leaning in, a C under. The accents push the filter (velocity), random LFOs slewed move the rest. */
const MY_SQUELCH: [step: number, note: number, vel: number, gate?: number][] = [
  [0, D3n, 0.95], [1, D3n, 0.5], [2, D4, 0.7], [4, 51, 0.8, 0.9], [5, D3n, 0.5], [6, D3n, 0.6], [7, D4, 0.85],
  [8, 53, 0.7], [9, D3n, 0.5], [10, 48, 0.75, 1.2], [11, D3n, 0.55],
];
const mySquelch = (thin = false): RigTrack => track(MY_SQUELCH.filter(([i]) => !thin || [0, 2, 4, 7, 10].includes(i))
  .map(([i, n, v, g]): Steps[number] => [i, n, { vel: v, gate: g ?? 0.55 }]), 12);
/** The hand drums: a tabla-like figure, the high one answering the low. */
const myConga = (): RigTrack => {
  const t = track([[0, 57, { vel: 0.8 }], [3, 50, { vel: 0.45 }], [6, 57, { vel: 0.6 }], [7, 62, { vel: 0.35 }], [10, 50, { vel: 0.7 }],
    [13, 57, { vel: 0.45 }], [14, 45, { vel: 0.65 }]], 16);
  for (let i = 1; i < 16; i += 2) t.steps[i]!.micro = 0.15;
  return t;
};
/** The kalimba: five steps against the fours, D, A and C up high, the D once in a while E flat. */
const myKalimba = (): RigTrack => {
  const t = track([[0, 74, { vel: 0.8 }], [2, 69, { vel: 0.5 }], [3, 72, { vel: 0.6 }]], 5);
  t.steps[0]!.prob = 0.9;
  t.steps[3]!.prob = 0.7;
  return t;
};
/** The vowel calls: a long note pulled from dark (A) towards open (B) by a locked morph, in the second and fourth bars. */
const myVox = (second = false): RigTrack => track((second
  ? [[20, 57, 10, 0.35], [52, 55, 12, 0.7]]
  : [[22, D3n, 8, 0.2], [50, 57, 12, 0.55]]
).map(([i, n, g, w]): Steps[number] => [i!, n!, { vel: 0.85, gate: g, locks: { 'out.morph': w! } }]), 64);
/** The sync lead held for two bars (a note a bar), its sweep brought in (LFO 2 locked up): the zeeow every bar. */
const mySweep = (at = 0, note = D3n): RigTrack => track([at, at + 16].map((i): Steps[number] => [i, note, { vel: 0.8, gate: 16, locks: { 'lfo2.level': 0.85 } }]), 64);
/** The shimmer pad: D, A and C, open, bowed again each bar. */
const myPad = (): RigTrack => track([0, 16, 32, 48].map((i): Steps[number] => [i, [D3n, 57, 60], { vel: 0.75, gate: 16 }]), 64);
/** The chord pad: one key a bar, its random voicings brought in more and more (LFO 1 locked up). */
const myChords = (): RigTrack => track([0, 16, 32, 48].map((i): Steps[number] => [i, D4, { vel: 0.8, gate: 16, locks: { 'lfo1.level': 0.6 + i / 120 } }]), 64);
/** Zaps: a laser falling from high, where `at` puts them. */
const myZap = (at: [number, number][] = [[46, 86]]): RigTrack => track(at.map(([i, n]): Steps[number] => [i, n, { vel: 0.85, gate: 0.4 }]), 64);
/** The dust: the hiss held under everything, a bar at a time. */
const myDust = (): RigTrack => track([0, 16, 32, 48].map((i): Steps[number] => [i, 60, { vel: 0.8, gate: 16 }]), 64);
/** A shaker in swung sixteenths. */
function myShaker(): RigTrack {
  const t = track(Array.from({ length: 16 }, (_, i): Steps[number] => [i, 60, { vel: [0.5, 0.3, 0.75, 0.35][i % 4]!, gate: 0.3 }]), 16);
  for (let i = 1; i < 16; i += 2) t.steps[i]!.micro = 0.15;
  return t;
}

const mycelium: RigFactoryMulti = {
  name: 'MYCELIUM · 96',
  build: () => {
    const parts: Partial<RigMultiPart>[] = [];
    // the kit: a soft, deep kick, a fat snare, dry rims, short hats, the low toms tuned up like hand drums
    const kit = cloneKit(RIG_KITS[0]!);
    kit.name = 'Psy Dub Kit';
    kit.pads[BD - 36]!.analog = { 'kick.tune': 46, 'kick.decay': 0.55, 'kick.click': 0.12 };
    kit.pads[SD - 36]!.analog = { 'snare.tune': 190, 'snare.decay': 0.35, 'snare.snap': 0.55 };
    kit.pads[RS - 36]!.analog = { 'rim.tone': 1300 };
    Object.assign(kit.pads[CH - 36]!, { analog: { 'closedHat.decay': 0.035 }, cutoff: 9500 });
    Object.assign(kit.pads[OH - 36]!, { analog: { 'openHat.decay': 0.35 }, cutoff: 8500 });
    parts[MY.DRUMS] = { name: 'Drums', kind: 'kit', kit, channel: 10 };
    parts[MY.THROWS] = { name: 'Throws', kind: 'kit', kit: cloneKit(kit), channel: 11 };
    // the bass: the post-punk bass with its saw up an octave (as the user chose), the pulse still an octave down under it
    parts[MY.BASS] = { name: 'Bass', voices: 1, channel: 1, ...sound('Post-Punk Bass', { 'osc1.oct': 2, 'out.level': 1 }) };
    parts[MY.DRONE] = { name: 'Drone', voices: 3, channel: 2, ...sound('Swarm Pad', { 'lad.cutoff': 2200, 'out.level': 1 }) };
    parts[MY.KEYS] = { name: 'Keys', voices: 8, channel: 3, ...sound('House Keys', { 'eg2.d': 0.5, 'eg2.s': 0.2, 'eg2.r': 0.15 }) };
    // the squelch: the acid line with two random LFOs on it, slewed so they wander rather than step: one on the cutoff
    // (slow), one on the resonance; velocity opens it
    parts[MY.SQUELCH] = {
      name: 'Squelch', voices: 1, channel: 4,
      ...sound('Acid Line', {
        'lad.cutoff': 380, 'lad.res': 0.78, 'out.level': 0.9,
        'lfo1.shape': 5, 'lfo1.rate': 0.7, 'lfo1.slew': 0.8, 'lfo1.retrig': 1, 'lfo2.shape': 5, 'lfo2.rate': 0.31, 'lfo2.slew': 0.9, 'lfo2.retrig': 1,
      }, [
        { source: 'vel', dest: 'lad.cutoff', amount: 0.2 }, { source: 'lfo1', dest: 'lad.cutoff', amount: 0.3 },
        { source: 'lfo2', dest: 'lad.res', amount: 0.12 }, { source: 'lfo2', dest: 'drive', amount: 0.15 },
      ]),
    };
    parts[MY.CONGA] = { name: 'Hand Drums', voices: 3, channel: 5, ...sound('Hand Conga', { 'out.level': 1 }) };
    // the kalimba as the user voiced it: softer struck, more ring, the AUX off
    parts[MY.KALIMBA] = {
      name: 'Kalimba', voices: 4, channel: 6,
      ...sound('Kalimba', { 'osc3.harm': 0.321, 'osc3.timbre': 0.074, 'osc3.morph': 0.571, 'osc3.aux': 0, 'out.level': 1 }),
    };
    parts[MY.VOX] = { name: 'Vowels', voices: 2, channel: 7, ...soundAB('Vox Table', { 'out.level': 1 }) };
    parts[MY.SWEEP] = { name: 'Sync Sweep', voices: 1, channel: 8, ...sound('Sync Lead', { 'out.level': 0.7 }) };
    parts[MY.PAD] = { name: 'Shimmer', voices: 6, channel: 9, ...sound('Shimmer Pad', { 'lad.cutoff': 3500 }) };
    parts[MY.CHORDS] = { name: 'Chords', voices: 1, channel: 12, ...sound('Chord Pad', {}) };
    // the zap: a triangle falling three octaves in a blink, a hair of noise; the delay does the rest
    parts[MY.ZAP] = {
      name: 'Zap', voices: 2, channel: 13,
      ...sound('Init', {
        'osc1.width': 1, 'mix.osc1': 1, 'mix.noise': 0.04, 'lad.cutoff': 6000, 'lad.eg1': 0,
        'eg1.a': 0.001, 'eg1.d': 0.12, 'eg1.s': 0, 'eg1.reset': 1, 'eg2.a': 0.001, 'eg2.d': 0.25, 'eg2.s': 0, 'eg2.r': 0.1, 'out.level': 1,
      }, [{ source: 'eg1', dest: 'osc1.tune', amount: 0.55 }]),
    };
    parts[MY.SHAKER] = { name: 'Shaker', voices: 1, channel: 14, ...sound('Shaker', { 'out.level': 1 }) };
    parts[MY.NOISE] = { name: 'Noise', voices: 1, channel: 15, ...sound('Noise Sweep', { 'out.level': 1 }) };
    // the dust: pink noise, its lows taken off, held under the whole tune; its pedals make it crackle
    parts[MY.DUST] = {
      name: 'Dust', voices: 1, channel: 16,
      ...sound('Init', {
        'mix.osc1': 0, 'mix.noise': 1, 'noise.type': 1, 'lad.cutoff': 9000, 'lad.eg1': 0, 'filter.route': 1, 'sem.mode': 1, 'sem.cutoff': 900,
        'eg2.a': 0.4, 'eg2.s': 1, 'eg2.r': 0.6, 'out.level': 1,
      }),
    };

    const { DRUMS, THROWS, BASS, DRONE, KEYS, SQUELCH, CONGA, KALIMBA, VOX, SWEEP, PAD, CHORDS, ZAP, SHAKER, NOISE, DUST } = MY;
    const ramp = (from: number, to: number) => (x: number) => from + (to - from) * x;
    const patterns = [
      // 0 intro: the drone, the vowels, the kalimba turning, a rim into the dub
      pattern({ [DUST]: myDust(), [DRONE]: myDrone(), [VOX]: myVox(), [KALIMBA]: dyn(myKalimba(), 0.8), [THROWS]: myThrows([[30, RS, 0.6], [62, RS, 0.5]]) }),
      // 1 intro: the hand drums and shaker, the bass coming in halfway, the snare thrown at the end
      pattern({ [DUST]: myDust(), [DRONE]: myDrone(), [CONGA]: dyn(myConga(), 0.85), [SHAKER]: dyn(myShaker(), 0.75), [BASS]: myBass(32), [KALIMBA]: dyn(myKalimba(), 0.8),
        [THROWS]: myThrows() }),
      // 2 the groove: the drums, the bass, the keys on two offbeats, the hand drums
      pattern({ [DUST]: myDust(), [DRUMS]: dyn(myDrums(), 0.95), [BASS]: myBass(), [KEYS]: myKeys(true), [CONGA]: dyn(myConga(), 0.8), [SHAKER]: dyn(myShaker(), 0.75),
        [THROWS]: myThrows() }),
      // 3 the squelch comes in, thin; the keys on every offbeat
      pattern({ [DUST]: myDust(), [DRUMS]: myDrums(), [BASS]: myBass(), [KEYS]: myKeys(), [SQUELCH]: dyn(mySquelch(true), 0.85), [SHAKER]: dyn(myShaker(), 0.8),
        [THROWS]: myThrows([[30, RS, 0.6], [44, MT, 0.7], [60, SD, 0.9]]) }),
      // 4 the squelch whole, alone with the drums and bass; a zap
      pattern({ [DUST]: myDust(), [DRUMS]: myDrums(), [BASS]: myBass(), [SQUELCH]: mySquelch(), [CONGA]: dyn(myConga(), 0.7), [ZAP]: myZap(), [THROWS]: myThrows() }),
      // 5 the sync sweep over the groove, the vowels answering, the kalimba back
      pattern({ [DUST]: myDust(), [DRUMS]: myDrums(), [BASS]: myBass(), [KEYS]: myKeys(true), [SWEEP]: mySweep(), [VOX]: myVox(true), [KALIMBA]: dyn(myKalimba(), 0.75),
        [SHAKER]: dyn(myShaker(), 0.8), [THROWS]: myThrows([[30, RS, 0.6], [60, SD, 0.9], [62, RS, 0.5]]) }),
      // 6 the break: no kick, no hats; the shimmer pad, the bass held, the hand drums, the snare thrown each second bar
      pattern({ [DUST]: myDust(), [PAD]: myPad(), [BASS]: myBassHeld(), [CONGA]: dyn(myConga(), 0.75), [VOX]: myVox(), [KALIMBA]: dyn(myKalimba(), 0.7),
        [THROWS]: myThrows([[28, SD, 0.8], [60, SD, 0.9], [62, RS, 0.5]]) }),
      // 7 the build: the chord pad's voicings spinning, the noise rising, the drums back with the toms, the bass held
      pattern({ [DUST]: myDust(), [CHORDS]: myChords(), [NOISE]: mods(scNoise(), (i) => (i / 63) ** 2), [DRUMS]: dyn(myDrums({ kick: false, fill: true }), ramp(0.6, 1)),
        [BASS]: myBassHeld(), [SHAKER]: dyn(myShaker(), ramp(0.5, 0.9)) }),
      // 8 the drop: everything rolling, the squelch and keys interlocking
      pattern({ [DUST]: myDust(), [DRUMS]: myDrums(), [BASS]: myBass(), [KEYS]: myKeys(), [SQUELCH]: mySquelch(), [CONGA]: dyn(myConga(), 0.7), [SHAKER]: myShaker(),
        [ZAP]: myZap([[14, 86], [46, 91]]), [THROWS]: myThrows() }),
      // 9 the drop again: the squelch out, the sync sweep and the drone in
      pattern({ [DUST]: myDust(), [DRUMS]: myDrums(), [BASS]: myBass(), [KEYS]: myKeys(true), [SWEEP]: mySweep(32, 57), [DRONE]: myDrone(), [KALIMBA]: dyn(myKalimba(), 0.75),
        [SHAKER]: myShaker(), [THROWS]: myThrows([[30, RS, 0.6], [44, MT, 0.7], [60, SD, 0.9]]) }),
      // 10 the dub-out: the kick and snare alone under the keys and the vowels, everything thrown
      pattern({ [DUST]: myDust(), [DRUMS]: dyn(myDrums({ hats: false }), 0.9), [BASS]: myBass(), [KEYS]: myKeys(true), [VOX]: myVox(true), [DRONE]: myDrone(),
        [THROWS]: myThrows([[12, SD, 0.8], [30, RS, 0.6], [44, SD, 0.85], [46, MT, 0.7], [60, SD, 0.9], [62, LT, 0.7]]) }),
      // 11 out: the drone, the kalimba, a vowel, a rim into the delay
      pattern({ [DUST]: myDust(), [DRONE]: myDrone(), [KALIMBA]: dyn(myKalimba(), 0.7), [VOX]: myVox(), [THROWS]: myThrows([[30, RS, 0.5], [62, RS, 0.4]]) }),
    ];

    const mix: Record<string, number> = {
      // the kit nearly dry, the throws all the way into the dub; the bass dry and in the middle
      'p1.fader': 1, 'p1.a': 0.05, 'p1.c': 0.1,
      'p2.fader': 0.8, 'p2.a': 1, 'p2.c': 0.35, 'p2.hi': -2,
      'p3.fader': 1.2,
      // the drone wide in the hall and the grains; the keys in the dub, an ensemble pedal on them
      'p4.fader': 0.62, 'p4.b': 0.4, 'p4.c': 0.5, 'p4.lo': -12,
      'p5.fader': 1.4, 'p5.a': 0.5, 'p5.c': 0.25, 'p5.lo': -10, 'p5.pan': -0.15,
      // the squelch into the grains and a little dub, panned off; the hand drums a touch of hall
      'p6.fader': 0.8, 'p6.a': 0.3, 'p6.b': 0.45, 'p6.c': 0.2, 'p6.lo': -8, 'p6.pan': 0.25,
      'p7.fader': 1.6, 'p7.c': 0.25, 'p7.pan': -0.3, 'p7.lo': -6,
      // the kalimba in the grains and the hall; the vowels deep in the dub
      'p8.fader': 0.6, 'p8.b': 0.6, 'p8.c': 0.4, 'p8.pan': 0.35, 'p8.lo': -10,
      'p9.fader': 1.6, 'p9.a': 0.6, 'p9.c': 0.45, 'p9.lo': -8,
      'p10.fader': 0.62, 'p10.a': 0.55, 'p10.c': 0.4, 'p10.lo': -8, 'p10.pan': -0.2,
      'p11.fader': 0.55, 'p11.b': 0.4, 'p11.c': 0.55, 'p11.lo': -8,
      'p12.fader': 0.9, 'p12.b': 0.5, 'p12.c': 0.45, 'p12.lo': -8,
      'p13.fader': 1.5, 'p13.a': 0.9, 'p13.c': 0.3, 'p13.lo': -12,
      'p14.fader': 1, 'p14.pan': 0.4, 'p14.c': 0.2,
      'p15.fader': 0.8, 'p15.c': 0.5, 'p15.lo': -12,
      'p16.fader': 0.32, 'p16.c': 0.15, 'p16.lo': -12, 'p16.pan': 0,
      // ---- the pedals: noise on the filters (the dirt that keeps it from sounding clean), the rest for movement
      // the kit squashed in parallel, warmed, a little crushed
      ...pedalParams(1, 1, 'COMP', { Threshold: -24, Ratio: 6, Attack: 10, Release: 120, 'Make-up': 6 }, 0.45),
      ...pedalParams(1, 2, 'DRIVE', { Type: 'TUBE', Drive: 0.2, Tone: 0.55, Level: 0.28 }),
      ...pedalParams(1, 3, 'BITCRUSH', { Bits: 12, Rate: 22000, Tone: 0.8, Level: 1 }, 0.25),
      // the bass warmed, its filter wandering on slow noise
      ...pedalParams(3, 1, 'DRIVE', { Type: 'TUBE', Drive: 0.25, Tone: 0.4, Level: 0.36 }),
      ...pedalParams(3, 2, 'FILTER', { Mode: 'LP', Cutoff: 900, Res: 0.2, Source: 'NOISE', Depth: 0.15, Rate: 0.08 }),
      // the drone drifting on very slow noise, then phased over four bars
      ...pedalParams(4, 1, 'FILTER', { Mode: 'LP', Cutoff: 1800, Res: 0.35, Source: 'NOISE', Depth: 0.35, Rate: 0.03 }),
      ...pedalParams(4, 2, 'PHASER', { Sync: '4 BARS', Depth: 0.8, Feedback: 0.6, Stages: '8', Centre: 600 }, 0.5),
      // the keys dusty (fast noise on the filter, a grit), then the ensemble
      ...pedalParams(5, 1, 'FILTER', { Mode: 'LP', Cutoff: 3000, Res: 0.25, Source: 'NOISE', Depth: 0.3, Rate: 4 }),
      ...pedalParams(5, 2, 'CHORUS', { Mode: 'ENSEMBLE' }, 0.2),
      // the squelch driven, gurgling through a band-pass on noise, into its own ping-pong echo in dotted eighths
      ...pedalParams(6, 1, 'DRIVE', { Type: 'DIODE', Drive: 0.3, Tone: 0.5, Level: 0.37 }),
      ...pedalParams(6, 2, 'FILTER', { Mode: 'BP', Cutoff: 1200, Res: 0.55, Source: 'NOISE', Depth: 0.5, Rate: 0.5 }, 0.6),
      ...pedalParams(6, 3, 'DELAY', { Mode: 'BBD', Sync: '3/16', Feedback: 0.5, 'Ping-pong': 'ON', Tone: 3000 }, 0.3),
      // the hand drums echoing in eighth triplets, left and right
      ...pedalParams(7, 1, 'DELAY', { Mode: 'BBD', Sync: '1/8T', Feedback: 0.35, 'Ping-pong': 'ON', Tone: 2500 }, 0.25),
      // the kalimba through a band-pass that noise moves
      ...pedalParams(8, 1, 'FILTER', { Mode: 'BP', Cutoff: 2000, Res: 0.4, Source: 'NOISE', Depth: 0.25, Rate: 1 }, 0.5),
      // the vowels a little ring-modulated, drifting
      ...pedalParams(9, 1, 'RING MOD', { Freq: 220, Wave: 'SINE', 'LFO rate': 0.1, 'LFO depth': 0.3 }, 0.2),
      // the sync sweep through a jet flanger over two bars
      ...pedalParams(10, 1, 'FLANGER', { Sync: '2 BARS', Depth: 0.8, Delay: 1.5, Feedback: 0.7 }, 0.5),
      // the shimmer phased; the chord pad spinning round the room in sixteenths
      ...pedalParams(11, 1, 'PHASER', { Sync: '2 BARS', Depth: 0.7, Feedback: 0.5 }, 0.5),
      ...pedalParams(12, 1, 'TREMOLO', { Sync: '1/16', Depth: 0.6, Shape: 'SINE', Pan: 1 }),
      // the dust: a band of hiss pushed about by fast noise, then crushed: a crackle
      ...pedalParams(16, 1, 'FILTER', { Mode: 'BP', Cutoff: 3000, Res: 0.2, Source: 'NOISE', Depth: 0.8, Rate: 20 }),
      ...pedalParams(16, 2, 'BITCRUSH', { Bits: 4, Rate: 1500, Tone: 0.5, Level: 1 }, 0.4),
      // A: the dub delay, dotted eighth, long and saturating, wow and flutter; its echoes into the hall
      'dub.sync': 1, 'dub.div': 3, 'dub.fdbk': 0.72, 'dub.tone': 2000, 'dub.wow': 0.4, 'dub.sat': 0.55, 'dub.flutter': 0.3,
      'rA.fader': 1.2, 'rA.c': 0.4, 'rA.lo': -8,
      // B: Beads, eighths, grains a fifth and an octave up, wandering
      'bbd.mode': 1, 'bbd.sync': 1, 'bbd.div': 2, 'bbd.fdbk': 0.45, 'bds.density': 0.55, 'bds.multiply': 0.3, 'bds.shape': 0.45, 'bds.pitch': 12,
      'bds.filter': 0.55, 'rB.fader': 0.9, 'rB.c': 0.5, 'rB.lo': -10,
      // C: a big dark hall
      'rev.type': 2, 'rev.size': 0.8, 'rev.damp': 0.55, 'rev.tone': 0.4, 'rev.pre': 0.03, 'rC.lo': -6,
      'cmp.key': 1, 'cmp.ratio': 2.5, 'cmp.thresh': -18, 'cmp.atk': 3, 'cmp.rel': 200, 'cmp.mix': 0.6,
      'tape.drive': 8, 'tape.tone': 0.35, 'tape.wow': 0.15,
    };
    // intro 16 bars, the groove 16, the squelch 16, its turn alone 8, the sweep 16, the break 16, the build 4, the drop 32,
    // the dub-out 8, out 8: about five and a half minutes
    const chain = [0, 0, 1, 1, 2, 2, 2, 2, 3, 3, 3, 3, 4, 4, 5, 5, 5, 5, 6, 6, 6, 6, 7, 8, 8, 8, 8, 9, 9, 9, 9, 10, 10, 11, 11];
    return multi('Mycelium', 96, parts, patterns, chain, mix);
  },
};

export const RIG_FACTORY_MULTIS: readonly RigFactoryMulti[] = [init8, acidHouse, scalpel, darkRoom, noMercy, dubPressure, mycelium];
