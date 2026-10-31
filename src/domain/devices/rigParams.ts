/**
 * The MOA-RIG's patch in one table, shared by the device, the worklet (which gets it injected into its source) and
 * the panel. A patch is the sound of one part: it holds two sides, A and B, of these same params plus a mod matrix
 * each, and `out.morph` blends between them (as on the Melbourne Instruments NINA, which the RIG follows). A choice
 * is sent as the index of its option, a toggle as 0 or 1.
 *
 * The voice: OSC 1 and OSC 2 (analogue-style: a saw-to-triangle shape and a pulse, blended; OSC 1 has a sub, OSC 2
 * syncs to OSC 1), OSC 3 (a wavetable), noise, a drive stage, a ladder (24 dB) and an SEM-style state-variable filter
 * (12 dB, LP-notch-HP or BP) that is off, after the ladder or beside it, two envelopes (EG 2 is the amp), two LFOs and
 * a stereo output with infinite panning: past ±1 a voice moves into anti-phase.
 */

export interface RigParam {
  id: string;
  label: string;
  kind: 'number' | 'choice' | 'toggle';
  min: number;
  max: number;
  /** For a choice: the index of its default option; for a toggle 0 or 1. */
  def: number;
  unit?: string;
  curve?: 'linear' | 'log';
  options?: readonly string[];
}

const n = (id: string, label: string, min: number, max: number, def: number, unit = '', curve: 'linear' | 'log' = 'linear'): RigParam =>
  ({ id, label, kind: 'number', min, max, def, unit, curve });
const c = (id: string, label: string, options: readonly string[], def: string): RigParam =>
  ({ id, label, kind: 'choice', min: 0, max: options.length - 1, def: options.indexOf(def), options });
const t = (id: string, label: string, def = 0): RigParam => ({ id, label, kind: 'toggle', min: 0, max: 1, def });

const OCTAVES = ['-2', '-1', '0', '+1', '+2'] as const;

/** OSC 3's wavetables, built in code by the worklet (see `rigWorklet.ts`): four in the PPG manner and two vocal ones. */
/** OSC 3's MACRO models: Plaits' engines (ported from Mutable Instruments' code), in the module's order. */
export const RIG_MACRO_MODELS = ['VA', 'WAVESHAPE', 'FM', 'GRAIN', 'ADDITIVE', 'WAVETABLE', 'CHORDS', 'SPEECH', 'SWARM', 'NOISE', 'PARTICLE', 'STRING', 'MODAL', 'BASS DRUM', 'SNARE', 'HI-HAT'] as const;
/** What each model's AUX output is (OUT/AUX blends to it): the module's second output, different for each. */
export const RIG_MACRO_AUX: Readonly<Record<(typeof RIG_MACRO_MODELS)[number], string>> = {
  VA: 'SYNC', WAVESHAPE: 'SINE', FM: 'SUB', GRAIN: 'Z OSC', ADDITIVE: 'ORGAN', WAVETABLE: 'LO-FI', CHORDS: 'ROOT',
  SPEECH: 'EXCITE', SWARM: 'SINES', NOISE: 'BANDS', PARTICLE: 'RAW', STRING: 'EXCITE', MODAL: 'EXCITE',
  'BASS DRUM': 'SYNTH', SNARE: 'SYNTH', 'HI-HAT': 'RING',
};
export const RIG_OSC3_MODES = ['WAVETABLE', 'MACRO', 'BRAIDS'] as const;
/** OSC 3's BRAIDS models: Braids' (ported from Mutable Instruments' code), in the module's order, as far as ported. */
export const RIG_BRAIDS_MODELS = ['CSAW', 'MORPH', 'SAW/SQUARE', 'FOLD', 'BUZZ', 'SQUARE SUB', 'SAW SUB', 'SQUARE SYNC', 'SAW SYNC', 'SAW x3', 'SQUARE x3', 'TRIANGLE x3', 'SINE x3', 'RING MOD', 'SAW SWARM', 'SAW COMB', 'TOY', 'FILTER LP', 'FILTER PEAK', 'FILTER BP', 'FILTER HP', 'VOSIM', 'VOWEL', 'VOWEL FOF', 'HARMONICS', 'FM', 'FEEDBACK FM', 'CHAOTIC FM', 'PLUCKED', 'BOWED', 'BLOWN', 'FLUTED', 'BELL', 'DRUM', 'KICK', 'CYMBAL', 'SNARE', 'WAVETABLES', 'WAVE MAP', 'WAVE LINE', 'WAVE PARAPHONIC', 'FILTERED NOISE', 'TWIN PEAKS', 'CLOCKED NOISE', 'GRANULAR CLOUD', 'PARTICLE NOISE', 'DIGITAL MODULATION', '???'] as const;
export const RIG_TABLES = ['PPG RESO', 'PPG SYNC', 'PPG DIGI', 'PPG PULSE', 'VOX AEIOU', 'VOX CHOIR'] as const;

/** LFO divisions when synced to the tempo, and their length in beats. */
export const RIG_DIVISIONS = ['4 bars', '2 bars', '1 bar', '1/2', '1/4', '1/4T', '1/8', '1/8T', '1/16', '1/16T', '1/32'] as const;
export const RIG_DIVISION_BEATS = [16, 8, 4, 2, 1, 2 / 3, 1 / 2, 1 / 3, 1 / 4, 1 / 6, 1 / 8] as const;

const lfo = (k: 1 | 2): RigParam[] => [
  n(`lfo${k}.rate`, 'Rate', 0.03, 30, k === 1 ? 2 : 0.5, 'Hz', 'log'),
  n(`lfo${k}.level`, 'Level', 0, 1, 1),
  c(`lfo${k}.shape`, 'Shape', ['sine', 'triangle', 'square', 'ramp up', 'ramp down', 'random'], 'triangle'),
  t(`lfo${k}.sync`, 'Tempo sync'),
  c(`lfo${k}.div`, 'Division', RIG_DIVISIONS, '1/4'),
  /** on: each note restarts it; off: every voice runs free; global: all the part's voices share one phase. */
  c(`lfo${k}.retrig`, 'Retrigger', ['on', 'off', 'global'], 'on'),
];

export const RIG_PARAMS: readonly RigParam[] = [
  // ---- OSC 1 and 2: width morphs saw into triangle and narrows the pulse; blend crossfades shape and pulse
  c('osc1.oct', 'Octave', OCTAVES, '0'),
  n('osc1.tune', 'Tune', -7, 7, 0, 'st'),
  n('osc1.width', 'Width', 0, 1, 0),
  n('osc1.blend', 'Blend', 0, 1, 0),
  /** The pulse becomes a square an octave down. */
  t('osc1.sub', 'Sub'),
  c('osc2.oct', 'Octave', OCTAVES, '0'),
  n('osc2.tune', 'Tune', -7, 7, 0, 'st'),
  n('osc2.width', 'Width', 0, 1, 0),
  n('osc2.blend', 'Blend', 0, 1, 0),
  t('osc2.sync', 'Sync to OSC 1'),

  // ---- OSC 3: a wavetable; position scans its frames, stepped (as on a PPG) unless interpolated
  c('osc3.oct', 'Octave', OCTAVES, '0'),
  n('osc3.tune', 'Tune', -7, 7, 0, 'st'),
  c('osc3.table', 'Table', RIG_TABLES, 'PPG RESO'),
  n('osc3.pos', 'Position', 0, 1, 0),
  t('osc3.interp', 'Interpolate', 1),
  // MACRO: a Plaits engine in place of the wavetable, its three macro knobs, and OUT or AUX (or between); BRAIDS: a
  // Braids model, TIMBRE and MORPH as its TIMBRE and COLOR
  c('osc3.mode', 'Mode', RIG_OSC3_MODES, 'WAVETABLE'),
  c('osc3.model', 'Model', RIG_MACRO_MODELS, 'VA'),
  c('osc3.braids', 'Braids model', RIG_BRAIDS_MODELS, 'CSAW'),
  n('osc3.harm', 'Harmonics', 0, 1, 0.5),
  n('osc3.timbre', 'Timbre', 0, 1, 0.5),
  n('osc3.morph', 'Morph', 0, 1, 0.5),
  n('osc3.aux', 'Out/aux', 0, 1, 0),

  // ---- mixer
  n('mix.osc1', 'OSC 1 level', 0, 1, 0.8),
  n('mix.osc2', 'OSC 2 level', 0, 1, 0),
  n('mix.osc3', 'OSC 3 level', 0, 1, 0),
  n('mix.noise', 'Noise level', 0, 1, 0),
  /** xor: the two pulses ring-modulated, like the NINA's analogue XOR. */
  c('noise.type', 'Noise', ['white', 'pink', 'xor'], 'white'),

  // ---- drive and the two filters
  n('drive', 'Drive', 0, 1, 0),
  t('overdrive', 'Overdrive'),
  n('lad.cutoff', 'Ladder cutoff', 20, 20000, 2000, 'Hz', 'log'),
  n('lad.res', 'Ladder resonance', 0, 1, 0),
  /** EG 1 into the ladder's cutoff: at ±1, ±10 octaves. */
  n('lad.eg1', 'Ladder EG 1', -1, 1, 0.3),
  n('sem.cutoff', 'SEM cutoff', 20, 20000, 8000, 'Hz', 'log'),
  n('sem.res', 'SEM resonance', 0, 1, 0),
  /** 0 low-pass, 0.5 notch, 1 high-pass. */
  n('sem.mode', 'SEM mode', 0, 1, 0),
  t('sem.bp', 'SEM band-pass'),
  n('sem.eg1', 'SEM EG 1', -1, 1, 0),
  /** off: the ladder alone; series: ladder into the SEM; parallel: both, summed. */
  c('filter.route', 'Filter routing', ['off', 'series', 'parallel'], 'off'),
  /** Both cutoffs follow the keyboard: 1 is a semitone a semitone. */
  n('filter.key', 'Key track', -1, 1, 0.5),

  // ---- envelopes: EG 1 is wired to the filters, EG 2 to the amp; both are mod sources
  n('eg1.a', 'EG 1 attack', 0.001, 20, 0.005, 's', 'log'),
  n('eg1.d', 'EG 1 decay', 0.001, 20, 0.3, 's', 'log'),
  n('eg1.s', 'EG 1 sustain', 0, 1, 0),
  n('eg1.r', 'EG 1 release', 0.001, 20, 0.3, 's', 'log'),
  n('eg1.level', 'EG 1 level', 0, 1, 1),
  /** Each note starts the envelope from zero rather than from where it is. */
  t('eg1.reset', 'EG 1 reset'),
  n('eg2.a', 'EG 2 attack', 0.001, 20, 0.003, 's', 'log'),
  n('eg2.d', 'EG 2 decay', 0.001, 20, 0.3, 's', 'log'),
  n('eg2.s', 'EG 2 sustain', 0, 1, 1),
  n('eg2.r', 'EG 2 release', 0.001, 20, 0.15, 's', 'log'),
  n('eg2.level', 'EG 2 level', 0, 1, 1),
  t('eg2.reset', 'EG 2 reset'),
  /** The amp stays open: the voice sounds without a note. */
  t('eg2.drone', 'Drone'),

  ...lfo(1),
  ...lfo(2),

  // ---- output and voicing
  n('out.level', 'Level', 0, 1, 0.8),
  /** -1 left .. 1 right; past ±1 (with modulation, to ±2) the voice moves into anti-phase. */
  n('out.pan', 'Pan', -1, 1, 0),
  /** Turns the whole field of voices: added to every voice's pan after the matrix. */
  n('out.spin', 'Spin', -1, 1, 0),
  n('out.morph', 'Morph', 0, 1, 0),
  c('voice.mode', 'Voice mode', ['poly', 'mono', 'legato'], 'poly'),
  c('voice.unison', 'Unison', ['1', '2', '3', '4'], '1'),
  n('voice.detune', 'Unison detune', 0, 1, 0.3),
  n('voice.glide', 'Glide', 0, 2, 0, 's'),
  n('voice.bend', 'Bend range', 0, 24, 2, 'st'),
  /** spread: new notes fan out across the width; ping-pong: they alternate left and right. */
  c('panner.mode', 'Panner', ['off', 'spread', 'ping-pong'], 'off'),
  n('panner.width', 'Panner width', 0, 1, 0.7),
  /** How long the TIME source takes to rise from 0 to 1 after a note starts. */
  n('mod.time', 'Time ramp', 0.06, 240, 4, 's', 'log'),
];

/** The sixteen mod sources, in the order of the panel's source keys. */
export const RIG_SOURCES = ['eg1', 'eg2', 'lfo1', 'lfo2', 'wave', 'kbd', 'vel', 'aft', 'mod', 'exp', 'pan', 'time', 'cc', 'seq', 'rand', 'set'] as const;
export type RigSource = (typeof RIG_SOURCES)[number];

/**
 * What a matrix amount (-1..1) does at each destination:
 * - pitch: ±64 semitones, so KBD at 1 tracks the keyboard exactly
 * - freq: a cutoff, ±64 semitones
 * - rate: an LFO rate, ±5 octaves
 * - time: an envelope time, ±8 octaves
 * - lin: added in the param's own units, a full amount spanning its whole range
 * Velocity on an envelope's level is a sensitivity rather than an offset (as on the NINA).
 */
export const RIG_DESTS = [
  ['osc1.tune', 'pitch'], ['osc1.width', 'lin'], ['osc1.blend', 'lin'], ['mix.osc1', 'lin'],
  ['osc2.tune', 'pitch'], ['osc2.width', 'lin'], ['osc2.blend', 'lin'], ['mix.osc2', 'lin'],
  ['osc3.tune', 'pitch'], ['osc3.pos', 'lin'], ['osc3.harm', 'lin'], ['osc3.timbre', 'lin'], ['osc3.morph', 'lin'], ['mix.osc3', 'lin'], ['mix.noise', 'lin'],
  ['lfo1.rate', 'rate'], ['lfo1.level', 'lin'], ['lfo2.rate', 'rate'], ['lfo2.level', 'lin'],
  ['lad.cutoff', 'freq'], ['lad.res', 'lin'], ['sem.cutoff', 'freq'], ['sem.res', 'lin'], ['sem.mode', 'lin'], ['drive', 'lin'],
  ['eg1.a', 'time'], ['eg1.d', 'time'], ['eg1.s', 'lin'], ['eg1.r', 'time'], ['eg1.level', 'lin'],
  ['eg2.a', 'time'], ['eg2.d', 'time'], ['eg2.s', 'lin'], ['eg2.r', 'time'], ['eg2.level', 'lin'],
  ['out.morph', 'lin'], ['out.pan', 'lin'],
] as const;
export type RigDest = (typeof RIG_DESTS)[number][0];

/** One matrix routing: `amount` of `source` added to `dest`. */
export interface RigRoute {
  source: RigSource;
  dest: RigDest;
  amount: number;
}

/** One side (A or B) of a patch: param values by id (missing ones take the default) and its routings. */
export interface RigSide {
  params: Record<string, number>;
  matrix: RigRoute[];
}

export const RIG_DEFAULTS: Readonly<Record<string, number>> = Object.fromEntries(RIG_PARAMS.map((p) => [p.id, p.def]));
