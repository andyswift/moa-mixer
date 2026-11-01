import { RIG_MIX_PARAMS } from './rigMix';
import { DRUM_VOICES, newPad, RIG_PADS, rigDrumParams, type RigKit, type RigPad } from './rigKit';
import { RIG_DESTS, RIG_PARAMS, RIG_SOURCES, type RigRoute, type RigSide } from './rigParams';
import type { RigPreset } from './rigPresets';
import {
  newRigPattern, newStep, RIG_CLOCKS, RIG_DIRECTIONS, RIG_MAX_STEPS, RIG_PATTERNS, RIG_TRACKS, type RigPattern, type RigStep, type RigTrack,
} from '../sequencer/rigSequencer';

/**
 * A multi: the whole MOA-RIG as saved: every part (its sound and where it sits), the sequencer's patterns and chain,
 * tempo and shuffle. Whatever is read back goes through `sanitiseMulti`, so a damaged or older save loads what it can
 * and leaves the rest at its defaults instead of breaking the synth.
 */
export const RIG_MULTI_VERSION = 1;

export interface RigMultiPart {
  name: string;
  kind: 'synth' | 'kit';
  kit?: RigKit;
  slot: number;
  /** The name of the sound in that slot when saved: finds it again if the list of sounds has changed since. */
  sound?: string;
  voices: number;
  channel: number;
  lo: number;
  hi: number;
  octave: number;
  a: RigSide;
  b: RigSide;
}

export interface RigMulti {
  v: number;
  name: string;
  parts: RigMultiPart[];
  patterns: RigPattern[];
  current: number;
  chain: number[];
  tempo: number;
  shuffle: number;
  /** The mixer and effects: param id -> value (choices as option indices); missing ones are their defaults. */
  mix: Record<string, number>;
}

const MIX_PARAMS = new Map(RIG_MIX_PARAMS.map((p) => [p.id, p]));

const PARAMS = new Map(RIG_PARAMS.map((p) => [p.id, p]));
const SOURCES = new Set<string>(RIG_SOURCES);
const DESTS = new Set<string>(RIG_DESTS.map((d) => d[0]));
const CLOCKS = new Set<number>(RIG_CLOCKS.map((c) => c[1]));

const isObject = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v);
const num = (v: unknown, lo: number, hi: number, fallback: number, int = false): number => {
  if (typeof v !== 'number' || !Number.isFinite(v)) return fallback;
  const x = Math.min(hi, Math.max(lo, v));
  return int ? Math.round(x) : x;
};
const text = (v: unknown, fallback: string, max = 24): string => (typeof v === 'string' ? v.slice(0, max) : fallback);

/** Keeps known params, in range (choices and toggles as whole numbers), and routings between real sources and destinations. */
export function sanitiseSide(raw: unknown): RigSide {
  const side: RigSide = { params: {}, matrix: [] };
  if (!isObject(raw)) return side;
  if (isObject(raw.params)) {
    for (const [id, v] of Object.entries(raw.params)) {
      const p = PARAMS.get(id);
      if (p && typeof v === 'number' && Number.isFinite(v)) side.params[id] = num(v, p.min, p.max, p.def, p.kind !== 'number');
    }
  }
  if (Array.isArray(raw.matrix)) {
    for (const r of raw.matrix) {
      if (isObject(r) && SOURCES.has(r.source as string) && DESTS.has(r.dest as string)) {
        side.matrix.push({ source: r.source, dest: r.dest, amount: num(r.amount, -1, 1, 0) } as RigRoute);
      }
    }
  }
  return side;
}

function sanitisePad(raw: unknown): RigPad {
  if (!isObject(raw)) return newPad();
  const voice = (DRUM_VOICES as readonly unknown[]).includes(raw.voice) ? (raw.voice as RigPad['voice']) : 'kick';
  const pad = newPad(voice);
  pad.name = text(raw.name, pad.name, 4);
  pad.src = raw.src === 'sample' && typeof raw.sound === 'string' && raw.sound ? 'sample' : 'analog';
  pad.sound = text(raw.sound, '', 120);
  if (isObject(raw.analog)) {
    for (const p of rigDrumParams(voice)) {
      const v = raw.analog[p.id];
      if (typeof v === 'number' && Number.isFinite(v)) pad.analog[p.id] = num(v, p.min, p.max, p.def);
    }
  }
  pad.start = num(raw.start, 0, 600, 0);
  pad.end = num(raw.end, 0, 600, 0);
  pad.tune = num(raw.tune, -36, 36, 0);
  pad.decay = num(raw.decay, 0.01, 8, pad.decay);
  pad.level = num(raw.level, 0, 2, pad.level);
  pad.pan = num(raw.pan, -1, 1, 0);
  pad.cutoff = num(raw.cutoff, 20, 20000, pad.cutoff);
  pad.reso = num(raw.reso, 0, 1, 0);
  pad.group = num(raw.group, 0, 8, 0, true);
  pad.reverse = raw.reverse === true;
  return pad;
}

function sanitiseKit(raw: unknown): RigKit | undefined {
  if (!isObject(raw) || !Array.isArray(raw.pads)) return undefined;
  const pads = raw.pads;
  return { name: text(raw.name, 'Kit'), pads: Array.from({ length: RIG_PADS }, (_, i) => sanitisePad(pads[i])) };
}

/** A saved sound (a preset), or undefined when it has no name. */
export function sanitiseSound(raw: unknown): RigPreset | undefined {
  if (!isObject(raw) || typeof raw.name !== 'string' || !raw.name.trim()) return undefined;
  const a = sanitiseSide(raw.a);
  return { name: text(raw.name, 'Sound'), a, b: raw.b === undefined ? sanitiseSide(raw.a) : sanitiseSide(raw.b) };
}

function sanitiseStep(raw: unknown): RigStep {
  const s = newStep();
  if (!isObject(raw)) return s;
  if (Array.isArray(raw.notes)) s.notes = raw.notes.filter((n): n is number => Number.isInteger(n) && (n as number) >= 0 && (n as number) <= 127).slice(0, 16);
  s.vel = num(raw.vel, 0, 1, s.vel);
  s.gate = num(raw.gate, 0.1, 16, s.gate);
  s.prob = num(raw.prob, 0, 1, s.prob);
  s.micro = num(raw.micro, -0.5, 0.5, s.micro);
  s.mod = num(raw.mod, 0, 1, s.mod);
  if (isObject(raw.locks)) s.locks = sanitiseSide({ params: raw.locks }).params;
  if (isObject(raw.vels)) {
    const vels: Record<number, number> = {};
    for (const [n, v] of Object.entries(raw.vels)) if (s.notes.includes(Number(n))) vels[Number(n)] = num(v, 0, 1, s.vel);
    if (Object.keys(vels).length) s.vels = vels;
  }
  if (isObject(raw.gates)) {
    const gates: Record<number, number> = {};
    for (const [n, g] of Object.entries(raw.gates)) if (s.notes.includes(Number(n))) gates[Number(n)] = num(g, 0.1, 16, s.gate);
    if (Object.keys(gates).length) s.gates = gates;
  }
  return s;
}

function sanitiseTrack(raw: unknown): RigTrack {
  const steps = isObject(raw) && Array.isArray(raw.steps) ? raw.steps : [];
  const t: RigTrack = {
    steps: Array.from({ length: RIG_MAX_STEPS }, (_, i) => sanitiseStep(steps[i])),
    length: 16, clock: 24, direction: 'fwd', prob: 1, muted: false, solo: false,
  };
  if (!isObject(raw)) return t;
  t.length = num(raw.length, 1, RIG_MAX_STEPS, 16, true);
  if (CLOCKS.has(raw.clock as number)) t.clock = raw.clock as number;
  if ((RIG_DIRECTIONS as readonly unknown[]).includes(raw.direction)) t.direction = raw.direction as RigTrack['direction'];
  t.prob = num(raw.prob, 0, 1, 1);
  t.muted = raw.muted === true;
  t.solo = raw.solo === true;
  return t;
}

function sanitisePattern(raw: unknown): RigPattern {
  const p = newRigPattern();
  if (!isObject(raw)) return p;
  p.length = num(raw.length, 0, 256, p.length, true);
  const tracks = Array.isArray(raw.tracks) ? raw.tracks : [];
  p.tracks = Array.from({ length: RIG_TRACKS }, (_, i) => sanitiseTrack(tracks[i]));
  return p;
}

/** `defaults` gives each part what it has when the save does not say (a fresh part). */
export function sanitiseMulti(raw: unknown, defaults: (part: number) => RigMultiPart): RigMulti | undefined {
  if (!isObject(raw) || !Array.isArray(raw.parts)) return undefined;
  const parts = raw.parts;
  const multi: RigMulti = {
    v: RIG_MULTI_VERSION,
    name: text(raw.name, 'Multi'),
    parts: Array.from({ length: RIG_TRACKS }, (_, p) => {
      const d = defaults(p);
      const r = parts[p];
      if (!isObject(r)) return d;
      const kit = sanitiseKit(r.kit);
      return {
        name: text(r.name, d.name), kind: r.kind === 'kit' && kit ? 'kit' : 'synth', ...(kit ? { kit } : {}), slot: num(r.slot, 0, 9999, d.slot, true),
        ...(typeof r.sound === 'string' && r.sound ? { sound: text(r.sound, '') } : {}), voices: num(r.voices, 0, 64, d.voices, true),
        channel: num(r.channel, 0, 16, d.channel, true), lo: num(r.lo, 0, 127, d.lo, true), hi: num(r.hi, 0, 127, d.hi, true),
        octave: num(r.octave, -2, 2, d.octave, true), a: sanitiseSide(r.a), b: sanitiseSide(r.b ?? r.a),
      };
    }),
    patterns: Array.from({ length: RIG_PATTERNS }, (_, i) => sanitisePattern(Array.isArray(raw.patterns) ? raw.patterns[i] : undefined)),
    current: num(raw.current, 0, RIG_PATTERNS - 1, 0, true),
    chain: Array.isArray(raw.chain) ? raw.chain.filter((i): i is number => Number.isInteger(i) && (i as number) >= 0 && (i as number) < RIG_PATTERNS) : [],
    tempo: num(raw.tempo, 40, 240, 120),
    shuffle: num(raw.shuffle, 0, 0.5, 0),
    mix: {},
  };
  if (isObject(raw.mix)) {
    for (const [id, v] of Object.entries(raw.mix)) {
      const p = MIX_PARAMS.get(id);
      if (p && !id.endsWith('throw') && typeof v === 'number' && Number.isFinite(v)) multi.mix[id] = num(v, p.min, p.max, p.def, p.kind !== 'number');
    }
  }
  return multi;
}
