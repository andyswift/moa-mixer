import { Device } from './device';
import { ChoiceControl, NumberControl, ToggleControl } from './controls';
import { SOFT_UNITY } from './sendFx';
import type { PresetValues, SynthPreset } from './synthPresets';

export const OURO_ROUTINGS = ['series', 'parallel', 'pingpong'] as const;
export const OURO_MOD_MODES = ['lfo', 'env'] as const;
export const OURO_WAVES = ['tri', 'ramp', 'sqr', 'rnd'] as const;
export const OURO_FILTERS = ['lp', 'hp'] as const;

const SIDES = ['a', 'b'] as const;
type Side = (typeof SIDES)[number];
const up = (s: Side) => s.toUpperCase() as 'A' | 'B';

const DELAY_SWING_S = 0.25; // full modulation moves the delay time this far
const CUTOFF_SWING_CENTS = 3600; // three octaves
const GAIN_SWING = 0.8;
const PING_PONG_BOUNCE = 0.5; // extra B -> A feedback in ping-pong, so the echoes bounce between the channels
const FREEZE_HOLD = 1; // self-feedback while frozen
const SEED_LEVEL = 0.0008; // about -62 dB of noise into each channel: lets a loop above unity start from silence

/** Every control with its default, so loading a patch always resets everything. */
export const OURO_INIT: PresetValues = {
  'ouro.input': 1, 'ouro.mix': 0.5, 'ouro.output': 1, 'ouro.routing': 'parallel', 'ouro.kill': 0, 'ouro.freeze': 0,
  'ouro.a.on': 1, 'ouro.a.gain': 1, 'ouro.a.delay': 380, 'ouro.a.grit': 0.15, 'ouro.a.cutoff': 3000,
  'ouro.a.resonance': 1.2, 'ouro.a.filter': 'lp', 'ouro.a.clip': 0.25, 'ouro.a.level': 1,
  'ouro.b.on': 1, 'ouro.b.gain': 1, 'ouro.b.delay': 530, 'ouro.b.grit': 0.15, 'ouro.b.cutoff': 2200,
  'ouro.b.resonance': 1.2, 'ouro.b.filter': 'lp', 'ouro.b.clip': 0.25, 'ouro.b.level': 1,
  'ouro.fb.aa': 0.35, 'ouro.fb.ab': 0.15, 'ouro.fb.ba': 0.15, 'ouro.fb.bb': 0.35,
  'ouro.mod.mode': 'lfo', 'ouro.mod.wave': 'tri', 'ouro.mod.rate': 0.8, 'ouro.mod.depth': 0.4, 'ouro.mod.trigger': 0,
  'ouro.mod.dlyA': 0.15, 'ouro.mod.dlyB': -0.15, 'ouro.mod.cutA': 0, 'ouro.mod.cutB': 0, 'ouro.mod.gainA': 0, 'ouro.mod.gainB': 0,
};

const p = (name: string, values: PresetValues): SynthPreset => ({ name, values });

export const OURO_PRESETS: readonly SynthPreset[] = [
  p('Tape Spiral', {
    'ouro.routing': 'series', 'ouro.a.delay': 240, 'ouro.b.delay': 360, 'ouro.fb.aa': 0.35, 'ouro.fb.bb': 0.4,
    'ouro.fb.ab': 0, 'ouro.fb.ba': 0.15, 'ouro.a.grit': 0.35, 'ouro.a.cutoff': 2200, 'ouro.b.cutoff': 1800, 'ouro.mod.rate': 0.4,
    'ouro.mod.depth': 0.6, 'ouro.mod.dlyA': 0.3, 'ouro.mod.dlyB': 0.2, 'ouro.mod.cutA': 0.1,
  }),
  p('Karaoke Drone', {
    'ouro.mix': 0.7, 'ouro.fb.aa': 0.95, 'ouro.fb.bb': 0.95, 'ouro.a.gain': 1.6, 'ouro.b.gain': 1.6,
    'ouro.a.grit': 0.5, 'ouro.b.grit': 0.5, 'ouro.a.clip': 0.6, 'ouro.b.clip': 0.6, 'ouro.a.delay': 700,
    'ouro.b.delay': 910, 'ouro.a.cutoff': 1400, 'ouro.b.cutoff': 1000, 'ouro.a.resonance': 4, 'ouro.b.resonance': 4,
  }),
  p('Ping Pong Mayhem', {
    'ouro.routing': 'pingpong', 'ouro.mix': 0.6, 'ouro.a.delay': 280, 'ouro.b.delay': 280, 'ouro.fb.ab': 0,
    'ouro.fb.ba': 0.15, 'ouro.fb.aa': 0.1, 'ouro.fb.bb': 0.1, 'ouro.a.resonance': 0.7, 'ouro.b.resonance': 0.7, 'ouro.a.grit': 0.1, 'ouro.mod.depth': 0,
  }),
  p('Dub Wash', {
    'ouro.routing': 'series', 'ouro.mix': 0.45, 'ouro.a.delay': 480, 'ouro.b.delay': 720, 'ouro.fb.aa': 0.6,
    'ouro.fb.bb': 0.5, 'ouro.fb.ab': 0.1, 'ouro.fb.ba': 0.1, 'ouro.a.cutoff': 1800, 'ouro.b.cutoff': 1200, 'ouro.a.resonance': 2.5, 'ouro.b.resonance': 2.5,
    'ouro.a.clip': 0.2, 'ouro.mod.rate': 0.25, 'ouro.mod.depth': 0.5, 'ouro.mod.cutA': 0.4, 'ouro.mod.cutB': 0.3,
  }),
  p('Self Oscillator', {
    'ouro.input': 0.2, 'ouro.mix': 1, 'ouro.fb.aa': 1.1, 'ouro.fb.bb': 1.1, 'ouro.fb.ab': 0.3, 'ouro.fb.ba': 0.3,
    'ouro.a.resonance': 18, 'ouro.b.resonance': 18, 'ouro.a.cutoff': 800, 'ouro.b.cutoff': 1200, 'ouro.a.clip': 0.5,
    'ouro.b.clip': 0.5, 'ouro.a.delay': 60, 'ouro.b.delay': 90, 'ouro.mod.rate': 0.1, 'ouro.mod.depth': 0.3,
    'ouro.mod.cutA': 0.5,
  }),
  p('Broken Echo', {
    'ouro.a.grit': 0.85, 'ouro.b.grit': 0.85, 'ouro.a.delay': 330, 'ouro.b.delay': 470, 'ouro.fb.aa': 0.55,
    'ouro.fb.bb': 0.55, 'ouro.a.clip': 0.7, 'ouro.b.clip': 0.7, 'ouro.mod.wave': 'rnd', 'ouro.mod.rate': 6,
    'ouro.mod.depth': 0.7, 'ouro.mod.dlyA': 0.4, 'ouro.mod.dlyB': -0.3, 'ouro.mod.gainA': 0.3,
  }),
  p('Filter Scream', {
    'ouro.routing': 'series', 'ouro.mix': 0.8, 'ouro.a.filter': 'hp', 'ouro.a.cutoff': 2500, 'ouro.a.resonance': 16,
    'ouro.b.cutoff': 1500, 'ouro.b.resonance': 16, 'ouro.fb.aa': 0.6, 'ouro.fb.bb': 0.6, 'ouro.fb.ab': 0.2,
    'ouro.fb.ba': 0.1, 'ouro.a.clip': 0.8, 'ouro.b.clip': 0.8, 'ouro.mod.wave': 'ramp', 'ouro.mod.rate': 2,
    'ouro.mod.depth': 0.8, 'ouro.mod.cutA': 0.8, 'ouro.mod.cutB': -0.8,
  }),
  p('Slow Rot', {
    'ouro.routing': 'series', 'ouro.mix': 0.55, 'ouro.a.delay': 900, 'ouro.b.delay': 1300, 'ouro.a.grit': 0.6,
    'ouro.b.grit': 0.6, 'ouro.fb.aa': 0.55, 'ouro.fb.bb': 0.55, 'ouro.fb.ab': 0, 'ouro.fb.ba': 0.1, 'ouro.a.cutoff': 900, 'ouro.b.cutoff': 700,
    'ouro.a.resonance': 1, 'ouro.b.resonance': 1, 'ouro.mod.rate': 0.08, 'ouro.mod.depth': 0.9,
    'ouro.mod.dlyA': 0.5, 'ouro.mod.dlyB': 0.4, 'ouro.a.level': 0.9, 'ouro.b.level': 0.9,
  }),
];

/**
 * Ouroboros: a deliberately unstable dual-channel feedback delay. It takes a stereo bus (mixed to mono),
 * and gives stereo back through a mix of dry and wet.
 *
 * Each channel, in order: gain (drive into a soft clipper) -> delay (long, dull, with a bit-crush "grit")
 * -> resonant low-pass or high-pass -> clip stage -> level. The channels run in series, in parallel, or
 * ping-pong. Four feedback paths (A>A, A>B, B>A, B>B) tap each channel after its clip stage and feed the
 * other channel's input, so the unit can ring and drone with no input. Every loop passes a delay line and
 * a soft clipper, so it saturates into a loud wash instead of blowing up. (Clip adds saturation, not loop
 * gain: the paths divide out the clip stage's drive, so a 50% path really feeds back half.)
 * A global modulator, an LFO or an envelope follower of the input (with a manual trigger), moves each
 * channel's delay time, filter cutoff and gain. In series and ping-pong, A also feeds B at full strength, which
 * counts as loop gain with any B>A feedback, and a filter resonance above about 1 lifts it further around the
 * cutoff; the patches keep the loop gain under 1 (so echoes die away) except
 * Karaoke Drone and Self Oscillator, which are meant to sustain. Kill cuts all feedback; Freeze holds each channel's own
 * loop at 100% and shuts the input, so the sound sustains by itself.
 */
export class OuroborosFx extends Device {
  readonly name: string;
  /** The eight patch slots: the factory patches, overwritten by saves. */
  readonly slots: SynthPreset[] = [...OURO_PRESETS];
  currentSlot = 0;
  currentPreset: SynthPreset = this.slots[0]!;
  private readonly fb = { aa: 0.35, ab: 0.15, ba: 0.15, bb: 0.35 };
  private readonly on: Record<Side, boolean> = { a: true, b: true };
  /** Small-signal gain of each channel's clip stage (1 + clip * 7); the feedback paths divide it out. */
  private readonly clipDrive: Record<Side, number> = { a: 1.25, b: 1.25 };
  private routing: (typeof OURO_ROUTINGS)[number] = 'parallel';
  private killed = false;
  private frozen = false;
  private modRate = 0.8;
  private readonly presetListeners = new Set<() => void>();

  constructor(name = 'Ouroboros') {
    super();
    this.name = name;
    const c = this.circuit;

    // Input, dry path, wet sum and output.
    c.add('in', 'gain', { gain: 1 })
      .add('mono', 'gain', { gain: 1 }, { channels: 'mono' })
      .add('inGain', 'gain', { gain: 1 })
      .add('srcGate', 'gain', { gain: 1 }) // shut by Freeze
      .add('srcA', 'gain', { gain: 1 })
      .add('srcB', 'gain', { gain: 1 })
      .add('dry', 'gain', { gain: Math.SQRT1_2 })
      .add('wet', 'gain', { gain: Math.SQRT1_2 })
      .add('sum', 'gain', { gain: 1 })
      .add('out', 'gain', { gain: 1 })
      .connect('in', 'mono')
      .connect('mono', 'inGain')
      .connect('inGain', 'srcGate')
      .connect('srcGate', 'srcA')
      .connect('srcGate', 'srcB')
      .connect('in', 'dry')
      .connect('dry', 'sum')
      .connect('wet', 'sum')
      .connect('sum', 'out')
      .add('meterL', 'meter', {}, { channel: 'left' })
      .add('meterR', 'meter', {}, { channel: 'right' })
      .connect('out', 'meterL')
      .connect('out', 'meterR');
    this.inputList.push({ name: 'in', nodeId: 'in' });
    this.outputList.push({ name: 'out', nodeId: 'out' });
    this.meterList.push({ name: 'L', nodeId: 'meterL' }, { name: 'R', nodeId: 'meterR' });

    for (const s of SIDES) this.addChannel(c, s);
    // Series link A -> B, and the extra B -> A bounce used by ping-pong.
    c.add('linkAB', 'gain', { gain: 0 })
      .add('bounceBA', 'gain', { gain: 0 })
      .connect('lvlA', 'linkAB')
      .connect('linkAB', 'inB')
      .connect('lvlB', 'bounceBA')
      .connect('bounceBA', 'inA')
      .connect('srcA', 'inA')
      .connect('srcB', 'inB');
    // Feedback matrix: each channel's clip output into each channel's input.
    for (const from of SIDES) {
      for (const to of SIDES) {
        c.add(`fb${up(from)}${up(to)}`, 'gain', { gain: 0 })
          .connect(`clip${up(from)}`, `fb${up(from)}${up(to)}`)
          .connect(`fb${up(from)}${up(to)}`, `in${up(to)}`);
      }
    }
    // The noise floor an analogue loop starts from: far too quiet to hear, enough to seed a self-oscillating loop.
    c.add('seedNoise', 'noise')
      .add('seedGain', 'gain', { gain: SEED_LEVEL })
      .connect('seedNoise', 'seedGain')
      .connect('seedGain', 'inA')
      .connect('seedGain', 'inB');
    this.addModulator(c);
    this.addControls(c);
    this.applyRouting();
    this.applyFeedback();
  }

  /** Loads a patch: every control back to its default, then the patch's values on top. */
  loadPreset(preset: SynthPreset): void {
    const values = { ...OURO_INIT, ...preset.values };
    this.currentPreset = preset;
    for (const [id, value] of Object.entries(values)) {
      const c = this.control(id);
      if (c.kind === 'number' && typeof value === 'number') c.set(value);
      else if (c.kind === 'choice' && typeof value === 'string') c.set(value);
      else if (c.kind === 'toggle' && typeof value === 'number') c.set(value > 0);
      else throw new Error(`Preset "${preset.name}": bad value for ${id}`);
    }
    for (const l of this.presetListeners) l();
  }

  /** Loads patch slot `index` (0-7). */
  loadSlot(index: number): void {
    const preset = this.slots[index];
    if (!preset) throw new Error(`No patch slot ${index}`);
    this.currentSlot = index;
    this.loadPreset(preset);
  }

  /** The current value of every control, in the form a patch stores (Kill and the trigger are not stored). */
  snapshot(): PresetValues {
    const values: PresetValues = {};
    for (const c of this.controlList) {
      if (c.id === 'ouro.kill' || c.id === 'ouro.mod.trigger') continue;
      values[c.id] = c.kind === 'toggle' ? (c.value ? 1 : 0) : c.value;
    }
    return values;
  }

  /** Stores the current sound in slot `index`, keeping the slot's name. */
  saveSlot(index: number): SynthPreset {
    const preset: SynthPreset = { name: this.slots[index]!.name, values: this.snapshot() };
    this.slots[index] = preset;
    this.currentSlot = index;
    this.currentPreset = preset;
    for (const l of this.presetListeners) l();
    return preset;
  }

  onPresetChange(fn: () => void): () => void {
    this.presetListeners.add(fn);
    return () => this.presetListeners.delete(fn);
  }

  private addChannel(c: Device['circuit'], s: Side): void {
    const X = up(s);
    c.add(`in${X}`, 'gain', { gain: 1 })
      .add(`on${X}`, 'gain', { gain: 1 })
      .add(`g${X}`, 'gain', { gain: SOFT_UNITY }) // gain stage: small signals scaled by the knob, ceiling at 1
      .add(`sg${X}`, 'waveshaper', {}, { curve: 'soft' })
      .add(`dly${X}`, 'delay', { delayTime: 0.38, maxTime: 2 })
      .add(`tone${X}`, 'filter', { frequency: 4800, Q: 0.707, detune: 0 }, { type: 'lowpass' }) // the dull "karaoke chip"
      .add(`crush${X}`, 'waveshaper', { bits: 16 }, { curve: 'crush' })
      .add(`filt${X}`, 'filter', { frequency: 3000, Q: 1.2, detune: 0 }, { type: 'lowpass' })
      .add(`cdrive${X}`, 'gain', { gain: SOFT_UNITY })
      .add(`clip${X}`, 'waveshaper', {}, { curve: 'soft' })
      .add(`lvl${X}`, 'gain', { gain: 1 })
      .add(`send${X}`, 'gain', { gain: 1 }) // series: A is heard only through B
      .add(`pan${X}`, 'pan', { pan: s === 'a' ? -1 : 1 })
      .connect(`in${X}`, `on${X}`)
      .connect(`on${X}`, `g${X}`)
      .connect(`g${X}`, `sg${X}`)
      .connect(`sg${X}`, `dly${X}`)
      .connect(`dly${X}`, `tone${X}`)
      .connect(`tone${X}`, `crush${X}`)
      .connect(`crush${X}`, `filt${X}`)
      .connect(`filt${X}`, `cdrive${X}`)
      .connect(`cdrive${X}`, `clip${X}`)
      .connect(`clip${X}`, `lvl${X}`)
      .connect(`lvl${X}`, `send${X}`)
      .connect(`send${X}`, `pan${X}`)
      .connect(`pan${X}`, 'wet');
  }

  /** LFO or envelope follower -> depth -> a bipolar amount to each channel's delay time, cutoff and gain. */
  private addModulator(c: Device['circuit']): void {
    c.add('lfoOsc', 'oscillator', { frequency: 0.8, detune: 0 }, { waveform: 'triangle' })
      .add('lfoRnd', 'random', { rate: 0.8 })
      .add('lfoOscOut', 'gain', { gain: 1 })
      .add('lfoRndOut', 'gain', { gain: 0 })
      .add('lfoGate', 'gain', { gain: 1 })
      .add('follow', 'waveshaper', {}, { curve: 'abs' })
      .add('followLp', 'filter', { frequency: 0.8, Q: 0.707, detune: 0 }, { type: 'lowpass' })
      .add('followGain', 'gain', { gain: 4 })
      .add('modTrig', 'trigger', { peak: 1, decay: 0.6, velSens: 0 })
      .add('envGate', 'gain', { gain: 0 })
      .add('mod', 'gain', { gain: 1 })
      .add('modOut', 'gain', { gain: 0.4 })
      .connect('lfoOsc', 'lfoOscOut')
      .connect('lfoRnd', 'lfoRndOut')
      .connect('lfoOscOut', 'lfoGate')
      .connect('lfoRndOut', 'lfoGate')
      .connect('inGain', 'follow')
      .connect('follow', 'followLp')
      .connect('followLp', 'followGain')
      .connect('followGain', 'envGate')
      .connect('modTrig', 'envGate')
      .connect('lfoGate', 'mod')
      .connect('envGate', 'mod')
      .connect('mod', 'modOut');
    for (const s of SIDES) {
      const X = up(s);
      c.add(`mDly${X}`, 'gain', { gain: 0 })
        .add(`mCut${X}`, 'gain', { gain: 0 })
        .add(`mGain${X}`, 'gain', { gain: 0 })
        .connect('modOut', `mDly${X}`)
        .connect(`mDly${X}`, `dly${X}`, 'delayTime')
        .connect('modOut', `mCut${X}`)
        .connect(`mCut${X}`, `filt${X}`, 'detune')
        .connect('modOut', `mGain${X}`)
        .connect(`mGain${X}`, `g${X}`, 'gain');
    }
  }

  private addControls(c: Device['circuit']): void {
    const init = OURO_INIT as Record<string, number | string>;
    const n = (id: string) => init[id] as number;
    const num = (id: string, label: string, min: number, max: number, unit: string,
      apply: (v: number) => void, curve?: 'linear' | 'log') =>
      this.controlList.push(new NumberControl(id, label, min, max, n(id), unit, apply, curve));
    const choice = (id: string, label: string, options: readonly string[], apply: (v: string) => void) =>
      this.controlList.push(new ChoiceControl(id, label, options, init[id] as string, apply));

    // Master
    num('ouro.input', 'Input', 0, 2, '', (v) => c.setParam('inGain', 'gain', v));
    num('ouro.mix', 'Mix', 0, 1, '', (v) => {
      // Equal-power dry/wet: the dry sound is the clean bus, so Mix at 0 passes it untouched.
      c.setParam('dry', 'gain', Math.cos((v * Math.PI) / 2));
      c.setParam('wet', 'gain', Math.sin((v * Math.PI) / 2));
    });
    num('ouro.output', 'Output', 0, 1.5, '', (v) => c.setParam('out', 'gain', v));
    choice('ouro.routing', 'Routing', OURO_ROUTINGS, (v) => {
      this.routing = v as (typeof OURO_ROUTINGS)[number];
      this.applyRouting();
      this.applyFeedback();
    });
    this.controlList.push(
      new ToggleControl('ouro.kill', 'Kill', false, (on) => {
        this.killed = on;
        this.applyFeedback();
      }),
      new ToggleControl('ouro.freeze', 'Freeze', false, (on) => {
        this.frozen = on;
        this.applyFeedback();
      }),
    );

    // Channels
    for (const s of SIDES) {
      const X = up(s);
      const id = (k: string) => `ouro.${s}.${k}`;
      this.controlList.push(
        new ToggleControl(id('on'), 'On', true, (on) => {
          this.on[s] = on;
          c.setParam(`on${X}`, 'gain', on ? 1 : 0);
          this.applyFeedback();
        }),
      );
      num(id('gain'), 'Gain', 0.05, 8, '×', (v) => c.setParam(`g${X}`, 'gain', v * SOFT_UNITY), 'log');
      num(id('delay'), 'Delay', 10, 1800, 'ms', (v) => c.setParam(`dly${X}`, 'delayTime', v / 1000), 'log');
      // Grit: 16 bits (clean) down to 3 bits.
      num(id('grit'), 'Grit', 0, 1, '', (v) => c.setParam(`crush${X}`, 'bits', 16 - v * 13));
      num(id('cutoff'), 'Cutoff', 20, 18000, 'Hz', (v) => c.setParam(`filt${X}`, 'frequency', v), 'log');
      num(id('resonance'), 'Resonance', 0.1, 30, '', (v) => c.setParam(`filt${X}`, 'Q', v));
      choice(id('filter'), 'Filter', OURO_FILTERS, (v) => c.setOption(`filt${X}`, 'type', v === 'hp' ? 'highpass' : 'lowpass'));
      num(id('clip'), 'Clip', 0, 1, '', (v) => {
        const drive = 1 + v * 7;
        c.setParam(`cdrive${X}`, 'gain', SOFT_UNITY * drive);
        // Clip adds saturation, not loop gain: the feedback knobs keep meaning "fraction fed back" for small signals.
        this.clipDrive[s] = drive;
        this.applyFeedback();
      });
      num(id('level'), 'Level', 0, 1.5, '', (v) => c.setParam(`lvl${X}`, 'gain', v));
    }

    // Feedback matrix
    for (const [path, label] of [['aa', 'A>A'], ['ab', 'A>B'], ['ba', 'B>A'], ['bb', 'B>B']] as const) {
      num(`ouro.fb.${path}`, label, 0, 1.2, '', (v) => {
        this.fb[path] = v;
        this.applyFeedback();
      });
    }

    // Modulator
    choice('ouro.mod.mode', 'Mode', OURO_MOD_MODES, (v) => {
      c.setParam('lfoGate', 'gain', v === 'lfo' ? 1 : 0);
      c.setParam('envGate', 'gain', v === 'env' ? 1 : 0);
    });
    choice('ouro.mod.wave', 'Wave', OURO_WAVES, (v) => {
      c.setOption('lfoOsc', 'waveform', v === 'sqr' ? 'square' : v === 'ramp' ? 'sawtooth' : 'triangle');
      c.setParam('lfoOscOut', 'gain', v === 'rnd' ? 0 : 1);
      c.setParam('lfoRndOut', 'gain', v === 'rnd' ? 1 : 0);
    });
    // Rate is the LFO speed, or the follower's speed (and the trigger's decay) in envelope mode.
    num('ouro.mod.rate', 'Rate', 0.05, 30, 'Hz', (v) => {
      this.modRate = v;
      c.setParam('lfoOsc', 'frequency', v);
      c.setParam('lfoRnd', 'rate', v);
      c.setParam('followLp', 'frequency', v);
      c.setParam('modTrig', 'decay', Math.min(4, 1.5 / v));
    }, 'log');
    num('ouro.mod.depth', 'Depth', 0, 1, '', (v) => c.setParam('modOut', 'gain', v));
    this.controlList.push(
      new ToggleControl('ouro.mod.trigger', 'Trigger', false, (on) => {
        if (on) c.trigger('modTrig', 1);
      }),
    );
    for (const s of SIDES) {
      const X = up(s);
      const dest = (key: string, label: string, node: string, swing: number) =>
        num(`ouro.mod.${key}${X}`, label, -1, 1, '', (v) => c.setParam(`${node}${X}`, 'gain', v * swing));
      dest('dly', `Delay ${X}`, 'mDly', DELAY_SWING_S);
      dest('cut', `Cutoff ${X}`, 'mCut', CUTOFF_SWING_CENTS);
      dest('gain', `Gain ${X}`, 'mGain', GAIN_SWING);
    }
  }

  /** Series feeds A into B (and you hear only B); parallel runs both on the input; ping-pong bounces between them. */
  private applyRouting(): void {
    const c = this.circuit;
    const series = this.routing === 'series';
    const parallel = this.routing === 'parallel';
    c.setParam('srcB', 'gain', parallel ? 1 : 0);
    c.setParam('sendA', 'gain', series ? 0 : 1);
    c.setParam('panA', 'pan', -1);
    c.setParam('panB', 'pan', series ? 0 : 1);
  }

  /** The four feedback paths, with Kill (all off), Freeze (each channel holds itself, the input shuts) and channel On. */
  private applyFeedback(): void {
    const c = this.circuit;
    for (const from of SIDES) {
      for (const to of SIDES) {
        const key = `${from}${to}` as keyof typeof this.fb;
        let amount = this.fb[key] / this.clipDrive[from];
        if (this.frozen && from === to) amount = FREEZE_HOLD / this.clipDrive[from];
        if (this.killed || !this.on[from] || !this.on[to]) amount = 0;
        c.setParam(`fb${up(from)}${up(to)}`, 'gain', amount);
      }
    }
    // The series link and the ping-pong bounce also tap a channel after its clip stage, so they divide out its drive too.
    const linked = this.routing !== 'parallel';
    c.setParam('linkAB', 'gain', linked ? 1 / this.clipDrive.a : 0);
    const bounce = this.routing === 'pingpong' && !this.killed && this.on.a && this.on.b;
    c.setParam('bounceBA', 'gain', bounce ? PING_PONG_BOUNCE / this.clipDrive.b : 0);
    c.setParam('srcGate', 'gain', this.frozen ? 0 : 1);
  }
}
