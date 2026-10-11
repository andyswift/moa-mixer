import { Device } from './device';
import { NumberControl, ToggleControl } from './controls';
import type { PresetValues, SynthPreset } from './synthPresets';

/** Every control with its default, so loading a patch always resets everything. */
export const BUSCOMP_INIT: PresetValues = {
  'bc.threshold': -18, 'bc.ratio': 4, 'bc.attack': 10, 'bc.release': 200, 'bc.knee': 6, 'bc.makeup': 3, 'bc.mix': 1,
  'bc.duck.depth': 0, 'bc.duck.release': 120, 'bc.duck.keyHp': 80, 'bc.bypass': 0, 'bc.listen': 0,
};

const p = (name: string, values: PresetValues): SynthPreset => ({ name, values });

export const BUSCOMP_PRESETS: readonly SynthPreset[] = [
  p('Init', {}),
  p('Glue', { 'bc.threshold': -14, 'bc.ratio': 2, 'bc.attack': 30, 'bc.release': 400, 'bc.knee': 12, 'bc.makeup': 2 }),
  p('Kick Duck', { 'bc.threshold': -6, 'bc.ratio': 1.5, 'bc.makeup': 0, 'bc.duck.depth': 0.7, 'bc.duck.release': 140 }),
  p('Gentle Pump', { 'bc.threshold': -16, 'bc.ratio': 2, 'bc.makeup': 3, 'bc.duck.depth': 0.35, 'bc.duck.release': 220 }),
  p('Hard Pump', { 'bc.threshold': -12, 'bc.ratio': 4, 'bc.makeup': 2, 'bc.duck.depth': 0.95, 'bc.duck.release': 90, 'bc.duck.keyHp': 120 }),
  p('NY Parallel', { 'bc.threshold': -32, 'bc.ratio': 8, 'bc.attack': 3, 'bc.release': 100, 'bc.knee': 4, 'bc.makeup': 10, 'bc.mix': 0.4 }),
  p('Drum Smash', { 'bc.threshold': -28, 'bc.ratio': 20, 'bc.attack': 1, 'bc.release': 200, 'bc.knee': 0, 'bc.makeup': 8, 'bc.mix': 0.7 }),
  p('Limiter', { 'bc.threshold': -4, 'bc.ratio': 20, 'bc.attack': 1, 'bc.release': 100, 'bc.knee': 0, 'bc.makeup': 0 }),
];

/** The key follower feeds this soft clipper; a key peak at 1/KEY_SENSE counts as "fully keyed". */
const KEY_SENSE = 4;

const dbToGain = (db: number) => 10 ** (db / 20);

/**
 * The browser's compressor adds automatic make-up gain: 0.6 of what it would take to bring a full-scale input
 * back up to full scale. That is removed here so the Make-up knob means what it says (0 dB = below threshold the
 * signal passes at its own level). Returns the browser's added gain in dB, from the soft-knee curve at 0 dBFS.
 */
export function nativeMakeupDb(thresholdDb: number, ratio: number, kneeDb: number): number {
  const kneeEnd = thresholdDb + kneeDb / 2;
  const outAtFull = kneeEnd < 0 ? thresholdDb + (0 - thresholdDb) / ratio : 0; // simplified: the knee is ignored near 0 dBFS
  return -0.6 * Math.min(0, outAtFull);
}

/**
 * Bus compressor with a sidechain ducker: stereo in, stereo out.
 *   in -> duck (VCA) -> compressor -> make-up -> wet \
 *                    \---------------------> dry ---> out
 * The compressor is linked stereo, with a Mix control for parallel compression. The ducker is a gain stage
 * under the control of the key input (a mixer channel chosen with the mixer's `key.source`): key -> high-pass
 * -> peak follower (fast attack, `Duck release`) -> soft clip -> depth -> subtracted from the VCA's gain of 1,
 * so the ducker can only turn the bus down, never up. Bypass sends the input straight to the output; Key
 * listen plays the filtered key instead, for setting it up.
 */
export class BusCompFx extends Device {
  readonly name: string;
  /** The eight patch slots: the factory patches, overwritten by saves. */
  readonly slots: SynthPreset[] = [...BUSCOMP_PRESETS];
  currentSlot = 0;
  currentPreset: SynthPreset = this.slots[0]!;
  private readonly presetListeners = new Set<() => void>();
  private mix = 1;
  private makeupDb = 3;
  private threshold = -18;
  private ratio = 4;
  private knee = 6;
  private bypass = false;
  private listen = false;

  constructor(name = 'Bus Comp') {
    super();
    this.name = name;
    const c = this.circuit;

    c.add('in', 'gain', { gain: 1 })
      .add('duck', 'gain', { gain: 1 })
      .add('gate', 'gain', { gain: 1 }) // closes for bypass and key listen
      .add('comp', 'compressor', { threshold: -18, knee: 6, ratio: 4, attack: 0.01, release: 0.2 })
      .add('wet', 'gain', { gain: dbToGain(3) })
      .add('dry', 'gain', { gain: 0 })
      .add('bypassPath', 'gain', { gain: 0 })
      .add('listenPath', 'gain', { gain: 0 })
      .add('out', 'gain', { gain: 1 })
      .add('inMeter', 'meter', {}, { channel: 'mono' })
      .add('meterL', 'meter', {}, { channel: 'left' })
      .add('meterR', 'meter', {}, { channel: 'right' })
      .connect('in', 'inMeter')
      .connect('in', 'duck')
      .connect('duck', 'gate')
      .connect('gate', 'comp')
      .connect('gate', 'dry')
      .connect('comp', 'wet')
      .connect('wet', 'out')
      .connect('dry', 'out')
      .connect('in', 'bypassPath')
      .connect('bypassPath', 'out')
      .connect('listenPath', 'out')
      .connect('out', 'meterL')
      .connect('out', 'meterR');

    // Sidechain: key -> high-pass -> follower -> sense -> soft clip -> depth -> the duck stage's gain.
    c.add('key', 'gain', { gain: 1 }, { channels: 'mono' })
      .add('keyHp', 'filter', { frequency: 80, Q: 0.707, detune: 0 }, { type: 'highpass' })
      .add('follow', 'follower', { attack: 0.003, release: 0.12 })
      .add('sense', 'gain', { gain: KEY_SENSE })
      .add('keyShape', 'waveshaper', {}, { curve: 'soft' })
      .add('duckMeter', 'meter', {}, { channel: 'mono' })
      .add('depth', 'gain', { gain: 0 })
      .connect('key', 'keyHp')
      .connect('keyHp', 'follow')
      .connect('follow', 'sense')
      .connect('sense', 'keyShape')
      .connect('keyShape', 'duckMeter')
      .connect('keyShape', 'depth')
      .connect('depth', 'duck', 'gain')
      .connect('keyHp', 'listenPath');

    this.inputList.push({ name: 'in', nodeId: 'in' }, { name: 'key', nodeId: 'key' });
    this.outputList.push({ name: 'out', nodeId: 'out' });
    this.meterList.push(
      { name: 'in', nodeId: 'inMeter' },
      { name: 'out.L', nodeId: 'meterL' },
      { name: 'out.R', nodeId: 'meterR' },
      { name: 'duck', nodeId: 'duckMeter' },
    );

    const init = BUSCOMP_INIT as Record<string, number>;
    const num = (id: string, label: string, min: number, max: number, unit: string,
      apply: (v: number) => void, curve?: 'linear' | 'log') =>
      this.controlList.push(new NumberControl(id, label, min, max, init[id]!, unit, apply, curve));

    num('bc.threshold', 'Threshold', -60, 0, 'dB', (v) => {
      this.threshold = v;
      c.setParam('comp', 'threshold', v);
      this.applyMix();
    });
    num('bc.ratio', 'Ratio', 1, 20, ':1', (v) => {
      this.ratio = v;
      c.setParam('comp', 'ratio', v);
      this.applyMix();
    });
    num('bc.attack', 'Attack', 0.3, 100, 'ms', (v) => c.setParam('comp', 'attack', v / 1000), 'log');
    num('bc.release', 'Release', 30, 1000, 'ms', (v) => c.setParam('comp', 'release', v / 1000), 'log');
    num('bc.knee', 'Knee', 0, 30, 'dB', (v) => {
      this.knee = v;
      c.setParam('comp', 'knee', v);
      this.applyMix();
    });
    num('bc.makeup', 'Make-up', 0, 24, 'dB', (v) => {
      this.makeupDb = v;
      this.applyMix();
    });
    num('bc.mix', 'Mix', 0, 1, '', (v) => {
      this.mix = v;
      this.applyMix();
    });
    num('bc.duck.depth', 'Duck depth', 0, 1, '', (v) => c.setParam('depth', 'gain', -v));
    num('bc.duck.release', 'Duck release', 20, 800, 'ms', (v) => c.setParam('follow', 'release', v / 1000), 'log');
    num('bc.duck.keyHp', 'Key HP', 20, 300, 'Hz', (v) => c.setParam('keyHp', 'frequency', v), 'log');
    this.controlList.push(
      new ToggleControl('bc.bypass', 'Bypass', false, (on) => {
        this.bypass = on;
        this.applyPaths();
      }),
      new ToggleControl('bc.listen', 'Key listen', false, (on) => {
        this.listen = on;
        this.applyPaths();
      }),
    );
  }

  /** Mix is a parallel blend: the dry bus plus the compressed copy (with make-up gain). */
  private applyMix(): void {
    this.circuit.setParam('dry', 'gain', 1 - this.mix);
    this.circuit.setParam('wet', 'gain', this.mix * dbToGain(this.makeupDb - nativeMakeupDb(this.threshold, this.ratio, this.knee)));
  }

  /** Bypass and key listen each close the processed path; listen wins over bypass. */
  private applyPaths(): void {
    const c = this.circuit;
    c.setParam('gate', 'gain', this.bypass || this.listen ? 0 : 1);
    c.setParam('bypassPath', 'gain', this.bypass && !this.listen ? 1 : 0);
    c.setParam('listenPath', 'gain', this.listen ? 1 : 0);
  }

  /** Loads a patch: every control back to its default, then the patch's values on top. */
  loadPreset(preset: SynthPreset): void {
    const values = { ...BUSCOMP_INIT, ...preset.values };
    this.currentPreset = preset;
    for (const [id, value] of Object.entries(values)) {
      const c = this.control(id);
      if (c.kind === 'number' && typeof value === 'number') c.set(value);
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

  /** The current value of every control, in the form a patch stores (Bypass and Key listen are not stored). */
  snapshot(): PresetValues {
    const values: PresetValues = {};
    for (const c of this.controlList) {
      if (c.id === 'bc.bypass' || c.id === 'bc.listen') continue;
      values[c.id] = c.kind === 'toggle' ? (c.value ? 1 : 0) : (c.value as number);
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
}
