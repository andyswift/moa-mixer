import { Device } from './device';
import { NumberControl, ToggleControl } from './controls';
import type { PresetValues, SynthPreset } from './synthPresets';

/** Seconds of audio the capture buffer holds. */
export const GRANULAR_BUFFER_SECONDS = 20;

/** Every control with its default, so loading a patch always resets everything. */
export const GRANULAR_INIT: PresetValues = {
  'gr.position': 0.3, 'gr.size': 120, 'gr.pitch': 0, 'gr.rate': 12, 'gr.spread': 0.5, 'gr.cloud': 0.2,
  'gr.detune': 0, 'gr.shape': 0.3, 'gr.reverse': 0, 'gr.feedback': 0, 'gr.mix': 1, 'gr.freeze': 0,
};

const p = (name: string, values: PresetValues): SynthPreset => ({ name, values });

export const GRANULAR_PRESETS: readonly SynthPreset[] = [
  p('Init', {}),
  p('Cloud Wash', { 'gr.position': 0.5, 'gr.size': 350, 'gr.rate': 30, 'gr.spread': 1, 'gr.cloud': 0.6, 'gr.detune': 12, 'gr.shape': 0 }),
  p('Frozen Pad', { 'gr.position': 0.15, 'gr.size': 700, 'gr.rate': 14, 'gr.spread': 0.9, 'gr.cloud': 0.25, 'gr.detune': 6, 'gr.shape': 0, 'gr.freeze': 1 }),
  p('Stutter', { 'gr.position': 0.02, 'gr.size': 90, 'gr.rate': 8, 'gr.spread': 0.2, 'gr.cloud': 0, 'gr.shape': 0.7 }),
  p('Octave Shimmer', { 'gr.position': 0.25, 'gr.size': 220, 'gr.pitch': 12, 'gr.rate': 24, 'gr.spread': 0.8, 'gr.cloud': 0.3, 'gr.detune': 8, 'gr.feedback': 0.35 }),
  p('Reverse Swell', { 'gr.position': 0.35, 'gr.size': 900, 'gr.rate': 6, 'gr.spread': 0.6, 'gr.cloud': 0.15, 'gr.shape': 0, 'gr.reverse': 1 }),
  p('Glitch Dust', { 'gr.position': 0.6, 'gr.size': 25, 'gr.rate': 70, 'gr.spread': 1, 'gr.cloud': 0.9, 'gr.detune': 40, 'gr.shape': 0.8, 'gr.reverse': 0.3 }),
  p('Tape Drone', { 'gr.position': 0.1, 'gr.size': 500, 'gr.pitch': -12, 'gr.rate': 18, 'gr.spread': 0.4, 'gr.cloud': 0.1, 'gr.detune': 4, 'gr.shape': 0, 'gr.feedback': 0.6 }),
];

/**
 * Granular processor: mono in, stereo out, for an aux send.
 *   in -> grains (records into a ring buffer, plays back a cloud of short windowed grains) -> wet \
 *      \-----------------------------------------------------------------------------------> dry --> out
 * The buffer always records the live input, so Position reaches back in time from "now" (0) to the oldest audio
 * (1). Freeze stops recording and holds the buffer still. Feedback writes the output back into the buffer, softly
 * clipped inside the engine, so it stays bounded. Mix 1 is all grains (what you want on an aux send).
 */
export class GranularFx extends Device {
  readonly name: string;
  /** The eight patch slots: the factory patches, overwritten by saves. */
  readonly slots: SynthPreset[] = [...GRANULAR_PRESETS];
  currentSlot = 0;
  currentPreset: SynthPreset = this.slots[0]!;
  private readonly presetListeners = new Set<() => void>();

  constructor(name = 'Granular') {
    super();
    this.name = name;
    const c = this.circuit;

    c.add('in', 'gain', { gain: 1 }, { channels: 'mono' })
      .add('grains', 'granular', {
        maxTime: GRANULAR_BUFFER_SECONDS, position: 0.3, size: 0.12, pitch: 0, rate: 12, spread: 0.5, cloud: 0.2,
        detune: 0, shape: 0.3, reverse: 0, feedback: 0, freeze: 0,
      })
      .add('wet', 'gain', { gain: 1 })
      .add('dry', 'gain', { gain: 0 })
      .add('out', 'gain', { gain: 1 })
      .add('inMeter', 'meter', {}, { channel: 'mono' })
      .add('meterL', 'meter', {}, { channel: 'left' })
      .add('meterR', 'meter', {}, { channel: 'right' })
      .connect('in', 'grains')
      .connect('in', 'dry')
      .connect('in', 'inMeter')
      .connect('grains', 'wet')
      .connect('wet', 'out')
      .connect('dry', 'out')
      .connect('out', 'meterL')
      .connect('out', 'meterR');

    this.inputList.push({ name: 'in', nodeId: 'in' });
    this.outputList.push({ name: 'out', nodeId: 'out' });
    this.meterList.push(
      { name: 'in', nodeId: 'inMeter' },
      { name: 'out.L', nodeId: 'meterL' },
      { name: 'out.R', nodeId: 'meterR' },
    );

    const init = GRANULAR_INIT as Record<string, number>;
    const num = (id: string, label: string, min: number, max: number, unit: string,
      apply: (v: number) => void, curve?: 'linear' | 'log') =>
      this.controlList.push(new NumberControl(id, label, min, max, init[id]!, unit, apply, curve));
    const grain = (id: string, label: string, min: number, max: number, unit: string, param: string,
      scale = 1, curve?: 'linear' | 'log') =>
      num(id, label, min, max, unit, (v) => c.setParam('grains', param, v * scale), curve);

    grain('gr.position', 'Position', 0, 1, '', 'position');
    grain('gr.size', 'Size', 5, 2000, 'ms', 'size', 1 / 1000, 'log');
    grain('gr.pitch', 'Pitch', -24, 24, 'st', 'pitch');
    grain('gr.rate', 'Rate', 0.5, 100, 'Hz', 'rate', 1, 'log');
    grain('gr.spread', 'Spread', 0, 1, '', 'spread');
    grain('gr.cloud', 'Cloud', 0, 1, '', 'cloud');
    grain('gr.detune', 'Detune', 0, 100, 'ct', 'detune');
    grain('gr.shape', 'Shape', 0, 1, '', 'shape');
    grain('gr.reverse', 'Reverse', 0, 1, '', 'reverse');
    grain('gr.feedback', 'Feedback', 0, 0.95, '', 'feedback');
    num('gr.mix', 'Mix', 0, 1, '', (v) => {
      c.setParam('wet', 'gain', v);
      c.setParam('dry', 'gain', 1 - v);
    });
    this.controlList.push(
      new ToggleControl('gr.freeze', 'Freeze', false, (on) => c.setParam('grains', 'freeze', on ? 1 : 0)),
    );
  }

  /** Loads a patch: every control back to its default, then the patch's values on top. */
  loadPreset(preset: SynthPreset): void {
    const values = { ...GRANULAR_INIT, ...preset.values };
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

  /** The current value of every control, in the form a patch stores. */
  snapshot(): PresetValues {
    const values: PresetValues = {};
    for (const c of this.controlList) {
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
