import { BASS_DESIGN } from './bassGuitar';
import {
  FINGER, PICK, axialStiffness, bendingStiffness, linearDensity, midiToHz, tensionFor, WINDINGS, type Coil, type StringSpec,
} from './bassPhysics';
import {
  BALANCE, COIL_SPACING, GUITAR_DESIGN, PARALLEL_RISE, PICKUP_AT, RESONANCE, SELECTOR, STRUM_WINDOW, TONE_OCTAVES,
} from './electricGuitar';
import type { StringedDesign } from './stringedInstrument';

/**
 * The MOA-RIG's string parts: a part can be a bass guitar (the MOA-BASS's four strings) or an electric guitar (the
 * MOA-GUITAR's six) instead of a synth or a kit. The strings are the same physical model (`bassPhysics.ts`, run by
 * `StringCore`), each part with its own amp and cabinet; drive and chorus are the FX page's pedals.
 *
 * A part keeps its settings as params (`RIG_STRING_PARAMS`: a choice as its option's index). `rigStringSetup` turns
 * them into what the worklet runs (`rigStrings.ts` in audio): each string's physical constants and tuned tension, the
 * pickups' coils, the pluck, the strum, the amp and the cabinet. The worklet then frets, plucks, strums, damps and
 * bends the strings as notes come, with the physics of `voiceConfig` and `pluckAmplitudes`.
 *
 * Playing: a note goes to the string a player would use (the least hand movement, a busy string avoided), an octave
 * up or down if it is out of reach. Velocity is how hard the string is plucked; a very soft one (40 of 127 or less)
 * is a dead note. A note off damps the string. The bend wheel bends (the guitar's vibrato arm goes down too), the MOD
 * wheel rests the palm on the strings. Guitar chords are strummed across the strings.
 */
export type RigStringInstrument = 'bass' | 'guitar';
export const RIG_STRING_INSTRUMENTS: readonly RigStringInstrument[] = ['bass', 'guitar'];

export interface RigStringParam {
  id: string;
  label: string;
  min: number;
  max: number;
  def: number;
  unit?: string;
  curve?: 'linear' | 'log';
  options?: readonly string[];
}

const DESIGNS: Record<RigStringInstrument, StringedDesign> = { bass: BASS_DESIGN, guitar: GUITAR_DESIGN };

/** Each instrument's tunings: the open strings' notes, low to high. */
export const RIG_TUNINGS: Record<RigStringInstrument, readonly (readonly [string, readonly number[]])[]> = {
  bass: [['STANDARD', [28, 33, 38, 43]], ['DROP D', [26, 33, 38, 43]], ['D STANDARD', [26, 31, 36, 41]], ['HALF DOWN', [27, 32, 37, 42]]],
  guitar: [
    ['STANDARD', [40, 45, 50, 55, 59, 64]], ['DROP D', [38, 45, 50, 55, 59, 64]], ['HALF DOWN', [39, 44, 49, 54, 58, 63]],
    ['DADGAD', [38, 45, 50, 55, 57, 62]], ['OPEN G', [38, 43, 50, 55, 59, 62]],
  ],
};

const WRAPS = ['nickel', 'stainless', 'steel'] as const;
const WINDING_IDS = ['round', 'half', 'flat'] as const;
const upper = (xs: readonly string[]) => xs.map((x) => x.toUpperCase());
const n = (id: string, label: string, min: number, max: number, def: number, unit = '', curve: 'linear' | 'log' = 'linear'): RigStringParam =>
  ({ id, label, min, max, def, unit, curve });
const ch = (id: string, label: string, options: readonly string[], def: number): RigStringParam => ({ id, label, min: 0, max: options.length - 1, def, options });

function params(instrument: RigStringInstrument): RigStringParam[] {
  const d = DESIGNS[instrument];
  const scales = Object.keys(d.scales), cabs = Object.keys(d.cabinets);
  const common = (pickups: RigStringParam[], playing: RigStringParam[]) => [
    ch('tuning', 'Tuning', RIG_TUNINGS[instrument].map((t) => t[0]), 0),
    ch('wrap', 'Wrap', upper(WRAPS), 0),
    ch('winding', 'Winding', upper(WINDING_IDS), 0),
    ch('scale', 'Scale', upper(scales), scales.indexOf(d.scale)),
    ch('pluck', 'Pluck with', ['FINGER', 'PICK'], d.pluck.style === 'pick' ? 1 : 0),
    n('pluckAt', 'Pluck at', 0.02, 0.4, d.pluck.position, 'm'),
    n('strength', 'Strength', 0, 1, 0.5),
    n('palm', 'Palm mute', 0, 1, 0),
    ...playing,
    ...pickups,
    n('gain', 'Gain', 0, 1, d.gain),
    n('bass', 'Bass', -12, 12, 0, 'dB'),
    n('mid', 'Mid', -12, 12, 0, 'dB'),
    n('treble', 'Treble', -12, 12, 0, 'dB'),
    ch('cab', 'Cabinet', cabs.map((c) => d.cabinets[c]!.label), cabs.indexOf(d.cabinet)),
    ch('mic', 'Mic', ['ON-AXIS', 'OFF-AXIS'], 0),
    n('blend', 'DI / Cab', 0, 1, d.blend),
    n('level', 'Level', 0, 1.5, d.level),
  ];
  return instrument === 'bass'
    ? common([n('pickup', 'Pickup', 0.03, 0.3, 0.15, 'm'), n('tone', 'Tone', 300, 12000, 3500, 'Hz', 'log')], [])
    : common(
      [ch('pickups', 'Pickups', upper(SELECTOR), 0), ch('coils', 'Type', ['SINGLE', 'HUMBUCKER'], 0), n('tone', 'Tone', 0, 10, 10)],
      [ch('strum', 'Strum', ['OFF', 'DOWN', 'UP'], 1), n('strumTime', 'Strum time', 2, 40, 10, 'ms', 'log')],
    );
}

/** Each instrument's params, in the order the panel shows them. */
export const RIG_STRING_PARAMS: Record<RigStringInstrument, readonly RigStringParam[]> = { bass: params('bass'), guitar: params('guitar') };

/** A string part's sound: its instrument and its params (choices as indices); missing params are their defaults. */
export interface RigStrings {
  instrument: RigStringInstrument;
  params: Record<string, number>;
}

/** Every param of an instrument at its default, overridden by `params` (by id; a choice by its option's name too). */
export function rigStringParams(instrument: RigStringInstrument, params: Record<string, number | string> = {}): Record<string, number> {
  const out: Record<string, number> = {};
  for (const p of RIG_STRING_PARAMS[instrument]) {
    const given = params[p.id];
    let v = typeof given === 'string' ? p.options?.indexOf(given.toUpperCase()) ?? -1 : given;
    if (typeof given === 'string' && (v === undefined || v < 0)) throw new Error(`${instrument} ${p.id}: no ${given}`);
    v = typeof v === 'number' && Number.isFinite(v) ? Math.min(p.max, Math.max(p.min, v)) : p.def;
    out[p.id] = p.options ? Math.round(v) : v;
  }
  for (const id of Object.keys(params)) if (!RIG_STRING_PARAMS[instrument].some((p) => p.id === id)) throw new Error(`${instrument} has no ${id}`);
  return out;
}

/** A string part's sound with only the params it keeps (a damaged or older save loses what it cannot read). */
export function sanitiseStrings(raw: unknown, instrument: RigStringInstrument): RigStrings {
  const src = typeof raw === 'object' && raw !== null && typeof (raw as { params?: unknown }).params === 'object' ? (raw as { params: Record<string, unknown> }).params : {};
  const params: Record<string, number> = {};
  for (const p of RIG_STRING_PARAMS[instrument]) {
    const v = src?.[p.id];
    params[p.id] = typeof v === 'number' && Number.isFinite(v) ? (p.options ? Math.round(Math.min(p.max, Math.max(p.min, v))) : Math.min(p.max, Math.max(p.min, v))) : p.def;
  }
  return { instrument, params };
}

export interface RigStringPreset {
  name: string;
  instrument: RigStringInstrument;
  params: Record<string, number>;
}

const preset = (name: string, instrument: RigStringInstrument, params: Record<string, number | string> = {}): RigStringPreset =>
  ({ name, instrument, params: rigStringParams(instrument, params) });

/** The factory sounds of the string parts, the first of each the one a part starts with. */
export const RIG_STRING_PRESETS: readonly RigStringPreset[] = [
  preset('Fingered Bass', 'bass'),
  preset('Picked Bass', 'bass', { pluck: 'PICK', pluckAt: 0.08, pickup: 0.08, tone: 5200, mid: 3, treble: 2, gain: 0.45 }),
  preset('Dub Flats', 'bass', { winding: 'FLAT', pluckAt: 0.3, pickup: 0.24, tone: 1100, bass: 4, treble: -6, cab: '1×15', blend: 0.5, level: 0.62 }),
  preset('Muted Bass', 'bass', { pluck: 'PICK', palm: 0.55, pluckAt: 0.06, pickup: 0.1, tone: 2600, mid: 2, level: 1.3 }),
  preset('Clean Guitar', 'guitar', { pickups: 'MIDDLE+NECK', gain: 0.15, treble: 1 }),
  preset('Funk Chops', 'guitar', { pickups: 'BRIDGE+MIDDLE', strumTime: 4, palm: 0.15, pluckAt: 0.05, gain: 0.2, mid: -3, treble: 3 }),
  preset('Crunch', 'guitar', { coils: 'HUMBUCKER', gain: 0.8, cab: '4×12', bass: 2, mid: 3, strumTime: 8 }),
  preset('Dub Skank', 'guitar', { pickups: 'NECK', tone: 6, strum: 'UP', strumTime: 3, palm: 0.35, gain: 0.2, treble: -2, cab: '1×12' }),
];
export const rigStringPresets = (instrument: RigStringInstrument) => RIG_STRING_PRESETS.filter((p) => p.instrument === instrument);

/** What the worklet runs for one string: its physical constants, its open tension and note, and its pickup coils. */
export interface RigStringSetupString {
  /** Mass per metre (kg/m), bending stiffness E I, axial stiffness E A of the core, the winding's high-frequency loss. */
  mu: number;
  EI: number;
  EA: number;
  b2: number;
  /** The tension tuning it open to `note`, N. */
  T: number;
  note: number;
  coils: Coil[];
}

/** What the worklet runs for a string part (all in SI units and plain gains). */
export interface RigStringSetup {
  strings: RigStringSetupString[];
  scale: number;
  frets: number;
  palmAt: number;
  palm: number;
  pluck: { position: number; width: number; release: number; low: number; high: number; strength: number };
  bendDown: boolean;
  /** The pickups' resonance, Hz. */
  tone: number;
  /** 0 off, 1 down, 2 up; the time per string crossed and the window a strum's notes come in, s. */
  strum: { mode: number; time: number; window: number };
  amp: {
    pre: number; post: number;
    stack: { bass: number; mid: number; treble: number };
    bass: number; mid: number; treble: number;
    cab: { hp: number; hpQ: number; bumpHz: number; bumpDb: number; coneHz: number; coneDb: number; coneQ: number; top: number };
    mic: number;
    di: number; wet: number; level: number;
  };
}

/** A string part's params as what the worklet runs. */
export function rigStringSetup(s: RigStrings): RigStringSetup {
  const d = DESIGNS[s.instrument];
  const v = (id: string) => s.params[id] ?? RIG_STRING_PARAMS[s.instrument].find((p) => p.id === id)!.def;
  const scale = d.scales[Object.keys(d.scales)[v('scale')] ?? d.scale]!;
  const tuning = (RIG_TUNINGS[s.instrument][v('tuning')] ?? RIG_TUNINGS[s.instrument][0]!)[1];
  const wrap = WRAPS[v('wrap')] ?? 'nickel', winding = WINDING_IDS[v('winding')] ?? 'round';
  const standard = d.strings.map((x) => x.gauge.note);
  let coils: (i: number) => Coil[], tone: number;
  if (s.instrument === 'bass') {
    coils = () => [{ position: v('pickup'), gain: 1 }];
    tone = v('tone');
  } else {
    const selected = (SELECTOR[v('pickups')] ?? 'bridge').split('+') as (keyof typeof PICKUP_AT)[];
    const humbucker = v('coils') === 1, pair = selected.length > 1;
    tone = RESONANCE[humbucker ? 'humbucker' : 'single'] * (pair ? PARALLEL_RISE : 1) * Math.pow(2, (-TONE_OCTAVES * (10 - v('tone'))) / 10);
    coils = (i) => {
      const gain = (pair ? 0.6 : 1) * Math.pow(midiToHz(standard[0]!) / midiToHz(standard[i]!), BALANCE);
      return selected.flatMap((p) => humbucker
        ? [{ position: PICKUP_AT[p] - COIL_SPACING / 2, gain: 0.8 * gain }, { position: PICKUP_AT[p] + COIL_SPACING / 2, gain: 0.8 * gain }]
        : [{ position: PICKUP_AT[p], gain }]);
    };
  }
  const strings = d.strings.map((x, i): RigStringSetupString => {
    const g = x.gauge;
    const spec: StringSpec = g.winding === 'plain'
      ? { outer: g.outer, core: g.core, wrap: g.wrap, winding: 'plain' }
      : { outer: g.outer, core: g.core, wrap, winding, packing: g.packing };
    const note = tuning[i] ?? g.note;
    return {
      mu: linearDensity(spec), EI: bendingStiffness(spec), EA: axialStiffness(spec), b2: WINDINGS[spec.winding].b2,
      T: tensionFor(spec, scale, midiToHz(note)), note, coils: coils(i),
    };
  });
  const style = v('pluck') === 1 ? PICK : FINGER;
  const cab = d.cabinets[Object.keys(d.cabinets)[v('cab')] ?? d.cabinet]!;
  const { pre, post } = d.drive(v('gain'));
  const blend = v('blend');
  return {
    strings, scale, frets: d.frets, palmAt: d.palmAt, palm: v('palm'),
    pluck: { position: v('pluckAt'), width: style.width, release: style.release, low: d.pluckHeight[0], high: d.pluckHeight[1], strength: v('strength') },
    bendDown: d.bendDown, tone,
    strum: s.instrument === 'guitar' ? { mode: v('strum'), time: v('strumTime') / 1000, window: STRUM_WINDOW / 1000 } : { mode: 0, time: 0, window: 0 },
    amp: {
      pre, post, stack: { ...d.toneStack }, bass: v('bass'), mid: v('mid'), treble: v('treble'),
      cab: { hp: cab.hp, hpQ: cab.hpQ, bumpHz: cab.bumpHz, bumpDb: cab.bumpDb, coneHz: cab.coneHz, coneDb: cab.coneDb, coneQ: cab.coneQ, top: cab.top },
      mic: v('mic') === 1 ? -8 : 0,
      di: Math.cos((blend * Math.PI) / 2), wet: Math.sin((blend * Math.PI) / 2), level: v('level'),
    },
  };
}
