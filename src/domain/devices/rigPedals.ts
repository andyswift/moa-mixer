/**
 * The MOA-RIG's pedals: up to four insert effects on each part, in a chain between the part and its mixer strip.
 *
 * A slot (`p3.fx1` is part 3's first) is a TYPE, a footswitch (ON), MIX (dry/wet: 0 dry, 0.5 both at full, 1 wet) and
 * up to eight knobs, k1..k8, kept as 0..1 whatever they mean (so a slot's values are plain mixer params, saved, shared
 * and sent like the rest). A choice keeps its index over 31 (`PEDAL_CHOICE_SCALE`), not over its own length, so an
 * option added to the end of a list later leaves saved choices as they were. What each knob means, its range and its curve depend on the type; `pedalValue` and
 * `pedalKnob` turn one into the other. The chain runs slot 1 to slot 4; moving a pedal moves its slot's values.
 */

export interface PedalKnob {
  label: string;
  min: number;
  max: number;
  def: number;
  unit?: string;
  curve?: 'linear' | 'log';
  /** A choice: the value is an index into these. */
  options?: readonly string[];
}
export interface PedalType {
  name: string;
  /** What MIX starts at when the pedal is chosen. */
  mix: number;
  knobs: readonly PedalKnob[];
}

export const PEDAL_SLOTS = 4;
/** A choice's 0..1 is its index over this (a list can grow to 32 options without moving what is saved). */
export const PEDAL_CHOICE_SCALE = 31;
export const PEDAL_KNOBS = 8;
/** Tempo divisions for a pedal's time or rate ('FREE': the TIME or RATE knob), and their length in beats. */
export const PEDAL_SYNC = ['FREE', '4 BARS', '2 BARS', '1 BAR', '1/2', '1/4', '3/16', '1/4T', '1/8', '1/8T', '1/16', '1/32'] as const;
export const PEDAL_SYNC_BEATS = [0, 16, 8, 4, 2, 1, 0.75, 2 / 3, 0.5, 1 / 3, 0.25, 0.125] as const;

const k = (label: string, min: number, max: number, def: number, unit = '', curve: 'linear' | 'log' = 'linear'): PedalKnob => ({ label, min, max, def, unit, curve });
const ch = (label: string, options: readonly string[], def: string): PedalKnob => ({ label, min: 0, max: options.length - 1, def: options.indexOf(def), options });
const sync = (def: (typeof PEDAL_SYNC)[number] = 'FREE') => ch('Sync', PEDAL_SYNC, def);

export const PEDAL_TYPES: readonly PedalType[] = [
  { name: 'OFF', mix: 1, knobs: [] },
  // the mixer's old drive insert: tube (lop-sided), diode or fuzz, then a tone low-pass
  { name: 'DRIVE', mix: 1, knobs: [ch('Type', ['TUBE', 'DIODE', 'FUZZ'], 'TUBE'), k('Drive', 0, 1, 0.5), k('Tone', 0, 1, 0.6), k('Level', 0, 1.5, 0.8)] },
  { name: 'COMP', mix: 1, knobs: [
    k('Threshold', -40, 0, -18, 'dB'), k('Ratio', 1, 20, 4, ':1', 'log'), k('Attack', 0.1, 100, 5, 'ms', 'log'), k('Release', 20, 1000, 150, 'ms', 'log'),
    k('Make-up', 0, 18, 4, 'dB'),
  ] },
  // a resonant state-variable filter swept by an LFO, by the part's own level (an envelope follower: an auto-wah), or
  // by noise (low-passed at RATE x 100 Hz: a slow drunken wander to a fast grit that roughens whatever goes through)
  { name: 'FILTER', mix: 1, knobs: [
    ch('Mode', ['LP', 'BP', 'HP'], 'LP'), k('Cutoff', 40, 12000, 900, 'Hz', 'log'), k('Res', 0, 1, 0.5), ch('Source', ['LFO', 'ENV', 'NOISE'], 'LFO'),
    k('Depth', -1, 1, 0.5), k('Rate', 0.03, 20, 0.5, 'Hz', 'log'), sync(), k('Drive', 0, 1, 0),
  ] },
  { name: 'PHASER', mix: 0.5, knobs: [
    k('Rate', 0.03, 10, 0.3, 'Hz', 'log'), sync(), k('Depth', 0, 1, 0.7), k('Feedback', 0, 0.95, 0.5), ch('Stages', ['4', '8', '12'], '8'),
    k('Centre', 100, 4000, 700, 'Hz', 'log'),
  ] },
  { name: 'FLANGER', mix: 0.5, knobs: [
    k('Rate', 0.03, 10, 0.2, 'Hz', 'log'), sync(), k('Depth', 0, 1, 0.7), k('Delay', 0.3, 10, 2.5, 'ms', 'log'), k('Feedback', -0.95, 0.95, 0.6),
  ] },
  // the mixer's old send D: the Juno's two taps (I, II, both), or Rings' ensemble
  { name: 'CHORUS', mix: 0.5, knobs: [ch('Mode', ['I', 'II', 'I+II', 'ENSEMBLE'], 'I'), k('Rate', 0, 1, 0.5), k('Depth', 0, 1, 0.5), k('Width', 0, 1, 1)] },
  // the level (or, PAN up, the balance) moved by an LFO
  { name: 'TREMOLO', mix: 1, knobs: [
    k('Rate', 0.1, 20, 4, 'Hz', 'log'), sync('1/8'), k('Depth', 0, 1, 0.7), ch('Shape', ['SINE', 'TRIANGLE', 'SQUARE'], 'SINE'), k('Pan', 0, 1, 0),
  ] },
  { name: 'RING MOD', mix: 0.5, knobs: [
    k('Freq', 20, 5000, 440, 'Hz', 'log'), ch('Wave', ['SINE', 'SQUARE'], 'SINE'), k('LFO rate', 0.03, 20, 0.5, 'Hz', 'log'), k('LFO depth', 0, 1, 0),
  ] },
  { name: 'BITCRUSH', mix: 1, knobs: [k('Bits', 1, 16, 8), k('Rate', 300, 48000, 12000, 'Hz', 'log'), k('Tone', 0, 1, 1), k('Level', 0, 1.5, 1)] },
  // a delay of its own, timed to the part: a tape echo (wow, saturating, darkening) or a bucket brigade (gritty, swept)
  { name: 'DELAY', mix: 0.35, knobs: [
    ch('Mode', ['TAPE', 'BBD'], 'TAPE'), k('Time', 10, 2000, 375, 'ms', 'log'), sync('3/16'), k('Feedback', 0, 1.1, 0.45), k('Tone', 300, 8000, 2500, 'Hz', 'log'),
    ch('Ping-pong', ['OFF', 'ON'], 'OFF'), k('Mod', 0, 1, 0.25),
  ] },
  // Beads' delay (Mutable Instruments'): TIME its clock, DENSITY, MULTIPLY, SHAPE, PITCH and FILTER as on send B
  { name: 'BEADS', mix: 0.4, knobs: [
    k('Time', 20, 2000, 250, 'ms', 'log'), sync('1/8'), k('Feedback', 0, 1, 0.45), k('Density', 0, 1, 0.42), k('Multiply', 0, 1, 0), k('Shape', 0, 1, 0),
    k('Pitch', -24, 24, 0, 'st'), k('Filter', 0, 1, 0.5),
  ] },
];
export const PEDAL_NAMES = PEDAL_TYPES.map((t) => t.name);
export type PedalName = (typeof PEDAL_TYPES)[number]['name'];

/** A knob's 0..1 as what it means (a choice as its index). */
export function pedalValue(knob: PedalKnob, x: number): number {
  const u = Math.min(1, Math.max(0, x));
  if (knob.options) return Math.min(knob.options.length - 1, Math.round(u * PEDAL_CHOICE_SCALE));
  return knob.curve === 'log' ? knob.min * (knob.max / knob.min) ** u : knob.min + (knob.max - knob.min) * u;
}
/** What a knob means as its 0..1. */
export function pedalKnob(knob: PedalKnob, v: number): number {
  if (knob.options) return Math.min(1, Math.max(0, Math.round(v) / PEDAL_CHOICE_SCALE));
  const u = knob.curve === 'log' ? Math.log(v / knob.min) / Math.log(knob.max / knob.min) : (v - knob.min) / (knob.max - knob.min);
  return Math.min(1, Math.max(0, u));
}

/** The param ids of part `part`'s (1-based) slot `slot` (1-based). */
export const pedalId = (part: number, slot: number, what: string) => `p${part}.fx${slot}.${what}`;

/**
 * A pedal's values as mixer params: its type, on, MIX (the type's own unless given) and every knob at its default
 * unless `knobs` (by label, in what they mean: a choice by name) says otherwise. Unused knobs are 0.
 */
export function pedalParams(part: number, slot: number, type: PedalName, knobs: Record<string, number | string> = {}, mix?: number): Record<string, number> {
  const t = PEDAL_TYPES.find((x) => x.name === type);
  if (!t) throw new Error(`no pedal ${type}`);
  const out: Record<string, number> = {
    [pedalId(part, slot, 'type')]: PEDAL_TYPES.indexOf(t), [pedalId(part, slot, 'on')]: 1, [pedalId(part, slot, 'mix')]: mix ?? t.mix,
  };
  for (let i = 0; i < PEDAL_KNOBS; i++) {
    const knob = t.knobs[i];
    let x = 0;
    if (knob) {
      const given = knobs[knob.label];
      const v = typeof given === 'string' ? knob.options?.indexOf(given) ?? -1 : given;
      if (typeof given === 'string' && (v === undefined || v < 0)) throw new Error(`${type} ${knob.label}: no ${given}`);
      x = pedalKnob(knob, v ?? knob.def);
    }
    out[pedalId(part, slot, `k${i + 1}`)] = Math.round(x * 1e6) / 1e6;
  }
  for (const label of Object.keys(knobs)) if (!t.knobs.some((x) => x.label === label)) throw new Error(`${type} has no ${label}`);
  return out;
}

/** The ids of one slot's values (type, on, mix, the knobs), in order. */
export const pedalSlotIds = (part: number, slot: number): string[] =>
  ['type', 'on', 'mix', ...Array.from({ length: PEDAL_KNOBS }, (_, i) => `k${i + 1}`)].map((w) => pedalId(part, slot, w));
