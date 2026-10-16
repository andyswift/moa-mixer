import { M2600_INPUTS, M2600_OUTPUTS, M2600_PARAMS } from './m2600Params';

/**
 * Patch cords for the MOA-2600. A cord runs from a source (an output, or a MULT jack) to a destination (an input,
 * or a MULT jack). The four MULT jacks are one junction: the cord plugged into it from an output is its source, and
 * cords from its other jacks carry that signal on. Like the hardware, an input or MULT jack takes one plug, so a new
 * cord there replaces the old one; outputs take any number (as if the plugs were stacked).
 */
export interface Cord {
  from: string;
  to: string;
}

export const MULT_JACKS = ['mult.1', 'mult.2', 'mult.3', 'mult.4'] as const;
export type JackKind = 'out' | 'in' | 'mult';

const OUTS = new Set<string>(M2600_OUTPUTS);
const INS = new Set(M2600_INPUTS.map((i) => i.id));
const MULTS = new Set<string>(MULT_JACKS);

export function jackKind(id: string): JackKind | undefined {
  if (OUTS.has(id)) return 'out';
  if (INS.has(id)) return 'in';
  if (MULTS.has(id)) return 'mult';
  return undefined;
}

/** The cord two jacks make, in signal order, or undefined if they cannot be joined (two outputs, two inputs, ...). */
export function orient(a: string, b: string): Cord | undefined {
  const ka = jackKind(a), kb = jackKind(b);
  if (!ka || !kb || a === b) return undefined;
  if (ka === 'mult' && kb === 'mult') return undefined; // the four are already joined
  if (ka === 'out' && kb !== 'out') return { from: a, to: b };
  if (kb === 'out' && ka !== 'out') return { from: b, to: a };
  if (ka === 'mult' && kb === 'in') return { from: a, to: b };
  if (kb === 'mult' && ka === 'in') return { from: b, to: a };
  return undefined;
}

/** Whether jack `id` takes only one plug. */
const singlePlug = (id: string): boolean => jackKind(id) !== 'out';

/** The cords after adding `cord`: any cord already in a one-plug jack it uses is pulled out; a second source into the MULT replaces the first. */
export function addCord(cords: readonly Cord[], cord: Cord): Cord[] {
  const busy = new Set([cord.from, cord.to].filter(singlePlug));
  const intoMult = MULTS.has(cord.to);
  return [
    ...cords.filter((c) => !busy.has(c.from) && !busy.has(c.to) && !(intoMult && MULTS.has(c.to))),
    cord,
  ];
}

/** The cords left after pulling every plug out of jack `id`. */
export const removeAt = (cords: readonly Cord[], id: string): Cord[] => cords.filter((c) => c.from !== id && c.to !== id);

/** What the worklet needs: output-to-input cords, with the MULT replaced by whatever feeds it. */
export function resolve(cords: readonly Cord[]): Cord[] {
  const multSource = cords.find((c) => MULTS.has(c.to))?.from;
  const out: Cord[] = [];
  for (const c of cords) {
    if (MULTS.has(c.to)) continue;
    if (MULTS.has(c.from)) {
      if (multSource) out.push({ from: multSource, to: c.to });
    } else out.push(c);
  }
  return out;
}

/** Cords as patch text, "from>to" joined by ";", and back (unknown or invalid cords are dropped). */
export const serialize = (cords: readonly Cord[]): string => cords.map((c) => `${c.from}>${c.to}`).join(';');
export function parse(text: string): Cord[] {
  let cords: Cord[] = [];
  for (const part of text.split(';')) {
    const [a, b] = part.split('>');
    const cord = a && b ? orient(a, b) : undefined;
    if (cord) cords = addCord(cords, cord);
  }
  return cords;
}

// ---- names for people

const SECTIONS: Record<string, string> = {
  kb: 'Keyboard', lfo: 'LFO', pre: 'Preamp', envf: 'Env follower', ring: 'Ring mod', noise: 'Noise', vco1: 'VCO 1', vco2: 'VCO 2',
  vco3: 'VCO 3', vcf: 'VCF', sem: 'SEM', adsr: 'ADSR', ar: 'AR', vca: 'VCA', mix: 'Mixer', reverb: 'Reverb', vp: 'Processor',
  sh: 'S/H', esw: 'Elec switch', mult: 'Mult', out: 'Output',
};
const WORDS: Record<string, string> = {
  cv: 'CV', upper: 'upper voice', gate: 'gate', trig: 'trigger', tri: 'triangle', square: 'square', delayed: 'delayed',
  out: 'output', saw: 'saw', pulse: 'pulse', sine: 'sine', extvib: 'ext vibrato in', in: 'input', inv1: 'inverter 1',
  inv2: 'inverter 2', lag: 'lag', clk: 'clock', extclk: 'ext clock in', a: 'A', b: 'B', c: 'C', left: 'left in', right: 'right in',
  'fm.kybd': 'FM keyboard', '1': '1', '2': '2', '3': '3', '4': '4', '5': '5', '6': '6', '7': '7',
};
const PARAM_LABEL = new Map(M2600_PARAMS.map((p) => [p.id, p.label]));
const SLIDER = new Map(M2600_INPUTS.filter((i) => i.slider).map((i) => [i.id, i.slider!]));

/** A jack's name for lists and screen readers, e.g. "VCF · Audio VCO 1" or "VCO 2 · sine". */
export function jackName(id: string): string {
  const [section, ...rest] = id.split('.');
  const head = SECTIONS[section!] ?? section!;
  const slider = SLIDER.get(id);
  const tail = slider ? PARAM_LABEL.get(slider)! : WORDS[rest.join('.')] ?? rest.join(' ');
  return `${head} · ${tail}`;
}

/** Every jack a cord can start from, and every jack it can end in, for pickers. */
export const SOURCE_JACKS: readonly string[] = [...M2600_OUTPUTS, ...MULT_JACKS];
export const DEST_JACKS: readonly string[] = [...M2600_INPUTS.map((i) => i.id), ...MULT_JACKS];
