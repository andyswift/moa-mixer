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
 *   each other, a one-note bass, struck metal, dub stabs and noise.
 * - ACID HOUSE: a tune for the rig's own sequencer, eight parts over a chain of four-bar patterns. The acid is the
 *   bassline, rolling all the way through; the others call and respond: the stab in bars 1 and 3, the arp in 2 and 4, and in
 *   the breakdown the words answer the pad.
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
const SC = { KICK: 0, HATS: 1, PERC: 2, TOMS: 3, BASS: 4, METAL: 5, STAB: 6, NOISE: 7 };
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
/** The bass: one note, six steps long, against the four-to-the-floor. */
const scBass = (): RigTrack => track([[0, A2, { vel: 1 }], [2, A2, { vel: 0.6 }], [3, A3, { vel: 0.7, gate: 1.1 }], [5, A2, { vel: 0.8 }]], 6);
/** Struck metal, seven steps. */
const scMetal = (): RigTrack => track([[0, 76, { vel: 0.9 }], [4, 81, { vel: 0.6 }]], 7);
/** Dub stabs, thrown into the delay: twice in two bars. */
const scStab = (): RigTrack => track([[6, A3, { vel: 0.9 }], [22, G3, { vel: 0.75 }]], 32);
/** A noise riser: a note a bar, each held the bar (a gate is at most 16 steps; the envelope carries on across them),
 * the filter opening over the four bars (the SEQ mod lane). */
const scNoise = (): RigTrack => mods(track([0, 16, 32, 48].map((i): Steps[number] => [i, A3, { gate: 16, vel: 0.9 }]), 64), (i) => (i / 63) ** 2);

const scalpel: RigFactoryMulti = {
  name: 'SCALPEL · 135',
  build: () => {
    const parts: Partial<RigMultiPart>[] = [];
    const kick = cloneKit(RIG_KITS[0]!);
    kick.pads[0]!.analog = { 'kick.tune': 42, 'kick.decay': 0.55, 'kick.click': 0.55 };
    kick.name = 'Driven Kick';
    parts[SC.KICK] = { name: 'Kick', kind: 'kit', kit: kick, channel: 10 };
    parts[SC.HATS] = { name: 'Hats', kind: 'kit', kit: cloneKit(RIG_KITS[0]!), channel: 11 };
    parts[SC.PERC] = { name: 'Perc', kind: 'kit', kit: cloneKit(RIG_KITS[1]!), channel: 12 };
    parts[SC.TOMS] = { name: 'Toms', kind: 'kit', kit: cloneKit(RIG_KITS[0]!), channel: 13 };
    // 5: a saw and a square an octave down, mono, into the ladder; driven; a slow LFO on the cutoff
    parts[SC.BASS] = {
      name: 'Bass', voices: 1, channel: 5,
      ...sound('Init', {
        'voice.mode': 1, 'mix.osc1': 0.8, 'mix.osc2': 0.45, 'osc2.oct': 1, 'osc2.blend': 1, 'osc1.oct': 1,
        'lad.cutoff': 200, 'lad.res': 0.55, 'lad.eg1': 0.45, 'eg1.d': 0.12, drive: 0.65, overdrive: 1,
        'eg2.a': 0.002, 'eg2.d': 0.22, 'eg2.s': 0.35, 'eg2.r': 0.08, 'lfo1.rate': 0.11, 'out.level': 1,
      }, [{ source: 'lfo1', dest: 'lad.cutoff', amount: 0.12 }, { source: 'vel', dest: 'lad.cutoff', amount: 0.1 }]),
    };
    // 6: struck metal: Plaits' MODAL, a bell's structure, bright, ringing; a little different every hit
    parts[SC.METAL] = {
      name: 'Metal', voices: 4, channel: 6,
      ...sound('Init', {
        'osc3.mode': 1, 'osc3.model': 12, 'osc3.harm': 0.72, 'osc3.timbre': 0.62, 'osc3.morph': 0.55, 'mix.osc1': 0, 'mix.osc3': 1,
        'lad.cutoff': 12000, 'lad.eg1': 0, 'eg2.a': 0.001, 'eg2.s': 1, 'eg2.r': 0.6, 'out.level': 1,
      }, [{ source: 'rand', dest: 'osc3.harm', amount: 0.12 }]),
    };
    // 7: dub stabs: Plaits' CHORDS (m7), dark, short
    parts[SC.STAB] = {
      name: 'Stab', voices: 3, channel: 7,
      ...sound('Init', {
        'osc3.mode': 1, 'osc3.model': 6, 'osc3.harm': 0.41, 'osc3.timbre': 0.4, 'osc3.morph': 0.25, 'mix.osc1': 0, 'mix.osc3': 1,
        'lad.cutoff': 2800, 'lad.res': 0.35, 'lad.eg1': 0.35, 'eg1.d': 0.15, 'eg2.d': 0.16, 'eg2.s': 0, 'eg2.r': 0.1, 'out.level': 1,
      }),
    };
    // 8: noise: Plaits' NOISE, low-pass to band; the ladder opened by the SEQ mod lane
    parts[SC.NOISE] = {
      name: 'Noise', voices: 2, channel: 8,
      ...sound('Init', {
        'osc3.mode': 1, 'osc3.model': 9, 'osc3.harm': 0.3, 'osc3.timbre': 0.95, 'osc3.morph': 0.55, 'mix.osc1': 0, 'mix.osc3': 1,
        'lad.cutoff': 150, 'lad.res': 0.45, 'lad.eg1': 0, 'eg2.a': 0.5, 'eg2.s': 1, 'eg2.r': 0.8, 'out.level': 1,
      }, [{ source: 'seq', dest: 'lad.cutoff', amount: 0.85 }]),
    };

    const patterns = [
      // 1 intro: the kick, the hats, the twelve-step perc
      pattern({ [SC.KICK]: scKick(false), [SC.HATS]: scHats(false), [SC.PERC]: scPerc() }),
      // 2 build: closed hats come in, the toms, the bass
      pattern({ [SC.KICK]: scKick(false), [SC.HATS]: scHats(true), [SC.PERC]: scPerc(), [SC.TOMS]: scToms(), [SC.BASS]: scBass() }),
      // 3 main: the metal and the stabs
      pattern({ [SC.KICK]: scKick(false), [SC.HATS]: scHats(true), [SC.PERC]: scPerc(), [SC.TOMS]: scToms(), [SC.BASS]: scBass(),
        [SC.METAL]: scMetal(), [SC.STAB]: scStab() }),
      // 4 break: no kick; the toms, the stabs into the delay, the noise rising
      pattern({ [SC.HATS]: scHats(false), [SC.TOMS]: scToms(), [SC.STAB]: scStab(), [SC.METAL]: scMetal(), [SC.NOISE]: scNoise() }),
      // 5 peak: everything, a ghost kick and the ride
      pattern({ [SC.KICK]: scKick(true), [SC.HATS]: scHats(true, true), [SC.PERC]: scPerc(), [SC.TOMS]: scToms(), [SC.BASS]: scBass(),
        [SC.METAL]: scMetal(), [SC.STAB]: scStab() }),
    ];

    const mix: Record<string, number> = {
      // the kick driven (the insert), and keying the compressor; the rest balanced by RMS against it: the bass 8 dB
      // under, the toms 12, the hats, perc, stab and noise 14 to 17, the metal 16
      'drv.part': 1, 'drv.type': 0, 'drv.drive': 0.45, 'drv.tone': 0.55, 'drv.blend': 1, 'drv.level': 1,
      'p1.fader': 0.63, 'p1.lo': 2,
      'p2.fader': 2, 'p2.pan': 0.15, 'p2.c': 0.05,
      'p3.fader': 1.62, 'p3.pan': -0.35, 'p3.a': 0.18, 'p3.c': 0.12,
      'p4.fader': 0.62, 'p4.pan': 0.3, 'p4.c': 0.15,
      'p5.fader': 1.6, 'p5.mid': -2,
      'p6.fader': 2, 'p6.pan': -0.2, 'p6.a': 0.35, 'p6.c': 0.25, 'p6.lo': -10,
      'p7.fader': 2, 'p7.a': 0.6, 'p7.c': 0.2, 'p7.lo': -8,
      'p8.fader': 2, 'p8.c': 0.3, 'p8.lo': -12,
      'dub.sync': 1, 'dub.div': 3, 'dub.fdbk': 0.68, 'dub.tone': 1600, 'dub.wow': 0.3, 'dub.sat': 0.5,
      'rev.type': 2, 'rev.size': 0.7, 'rev.damp': 0.55, 'rev.pre': 0.02,
      'rA.lo': -8, 'rA.filter': 0.15, 'rA.fader': 0.85, 'rC.fader': 0.8, 'rC.lo': -6,
      'cmp.key': 1, 'cmp.ratio': 2.5, 'cmp.thresh': -22, 'cmp.atk': 2, 'cmp.rel': 140, 'cmp.mix': 0.65,
    };
    return multi('Scalpel', 135, parts, patterns, [0, 1, 2, 2, 3, 4, 4], mix);
  },
};

export const RIG_FACTORY_MULTIS: readonly RigFactoryMulti[] = [init8, acidHouse, scalpel];
