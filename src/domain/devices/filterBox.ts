import { ChoiceControl, NumberControl, ToggleControl } from './controls';
import { Device } from './device';
import { FILTER_BOX_INIT, FILTER_BOX_PRESETS } from './filterBoxPresets';
import type { PresetValues, SynthPreset } from './synthPresets';

/** FILTER TYPE positions: the GEN R-8 circuit (four modes) then the 2045 circuit (one pure, three hybrids). */
export const FILTER_TYPES = ['GEN LP', 'GEN BP', 'GEN HP', 'GEN NOTCH', '2045 LP', 'BP+', 'NOTCH+', 'BANDSTOP+'] as const;

/** The worklet's params, each starting at 0 until its control sets it (the controls set every one at build). */
const PARAMS = [
  'Type', 'Cut', 'Res', 'Depth', 'Src', 'Inv', 'Noise', 'Vca', 'Thr', 'Gate',
].flatMap((n) => [`f1${n}`, `f2${n}`]).concat(
  ['e1', 'e2'].flatMap((e) => ['Atk', 'Dec', 'Sus', 'Rel', 'Loop', 'Exp', 'Trig'].map((n) => e + n)),
  ['envLink', 'cutLink', 'shRate', 'shSlew', 'shSrc', 'dlTime', 'dlRep', 'dlLevel', 'dlMod', 'dlSrc', 'mixA', 'mixB', 'mono', 'vol'],
);

/**
 * MOA-DF2: a dual dynamic multi-filter, inspired by a small hardware box of the same idea. Stereo in (left to
 * filter I, right to filter II), two filters each with a GEN R-8 or a 2045 circuit, two envelopes, a
 * sample-and-hold, a crunchy delay and a stereo/mono mixer, all in one worklet node (see `dfWorklet.ts`).
 * The envelope gates come from the keys (`setKeys`), the audio level (the threshold) or the OPEN buttons.
 */
export class FilterBox extends Device {
  readonly name: string;
  /** Sixteen patch slots: the factory patches, overwritten by saves. */
  readonly slots: SynthPreset[] = [...FILTER_BOX_PRESETS];
  currentSlot = 0;
  currentPreset: SynthPreset = this.slots[0]!;
  private readonly presetListeners = new Set<() => void>();

  constructor(name = 'MOA-DF2') {
    super();
    this.name = name;
    const c = this.circuit;
    c.add('box', 'df', Object.fromEntries(PARAMS.map((n) => [n, 0])))
      .add('meterL', 'meter', {}, { channel: 'left' })
      .add('meterR', 'meter', {}, { channel: 'right' })
      .connect('box', 'meterL')
      .connect('box', 'meterR');
    this.inputList.push({ name: 'in', nodeId: 'box' });
    this.outputList.push({ name: 'out', nodeId: 'box' });
    this.meterList.push({ name: 'out.L', nodeId: 'meterL' }, { name: 'out.R', nodeId: 'meterR' });

    const init = FILTER_BOX_INIT;
    const set = (param: string) => (v: number) => c.setParam('box', param, v);
    const num = (id: string, label: string, min: number, max: number, unit: string, param: string, curve?: 'linear' | 'log') =>
      this.controlList.push(new NumberControl(id, label, min, max, init[id] as number, unit, set(param), curve));
    const choice = (id: string, label: string, options: readonly string[], param: string) =>
      this.controlList.push(new ChoiceControl(id, label, options, init[id] as string, (v) => set(param)(options.indexOf(v))));
    const toggle = (id: string, label: string, param: string) =>
      this.controlList.push(new ToggleControl(id, label, (init[id] as number) > 0, (v) => set(param)(v ? 1 : 0)));

    for (const n of ['1', '2']) {
      const f = `f${n}`;
      choice(`${f}.type`, 'Filter type', FILTER_TYPES, `${f}Type`);
      num(`${f}.cutoff`, 'Cutoff', 20, 20000, 'Hz', `${f}Cut`, 'log');
      num(`${f}.res`, 'Resonance', 0, 1, '', `${f}Res`);
      num(`${f}.depth`, 'Depth', -1, 1, '', `${f}Depth`);
      choice(`${f}.source`, 'Source', ['env', 's&h'], `${f}Src`);
      toggle(`${f}.inv`, 'Invert env', `${f}Inv`);
      num(`${f}.noise`, 'Noise', 0, 1, '', `${f}Noise`);
      toggle(`${f}.vca`, 'VCA', `${f}Vca`);
      num(`${f}.threshold`, 'Threshold', 0, 1, '', `${f}Thr`);
      toggle(`${f}.gate`, 'Gate on', `${f}Gate`);
    }
    for (const n of ['1', '2']) {
      const e = `env${n}`;
      const k = `e${n}`;
      num(`${e}.attack`, 'Attack', 0.001, 10, 's', `${k}Atk`, 'log');
      num(`${e}.decay`, 'Decay', 0.005, 10, 's', `${k}Dec`, 'log');
      num(`${e}.sustain`, 'Sustain', 0, 1, '', `${k}Sus`);
      num(`${e}.release`, 'Release', 0.005, 20, 's', `${k}Rel`, 'log');
      choice(`${e}.mode`, 'Mode', ['adsr', 'loop'], `${k}Loop`);
      choice(`${e}.curve`, 'Curve', ['lin', 'exp'], `${k}Exp`);
      choice(`${e}.trig`, 'Gate from', ['keys', 'thresh'], `${k}Trig`);
    }
    toggle('link.env', 'Env I link', 'envLink');
    toggle('link.cutoff', 'Cutoff link', 'cutLink');
    num('sh.rate', 'Rate', 0.05, 40, 'Hz', 'shRate', 'log');
    num('sh.slew', 'Slew', 0, 1, '', 'shSlew');
    choice('sh.source', 'Source', ['noise', 'env'], 'shSrc');
    num('delay.time', 'Time', 0.02, 0.6, 's', 'dlTime', 'log');
    num('delay.repeats', 'Repeats', 0, 1, '', 'dlRep');
    num('delay.level', 'Level', 0, 1, '', 'dlLevel');
    num('delay.mod', 'Mod depth', -1, 1, '', 'dlMod');
    choice('delay.source', 'Mod source', ['s&h', 'env2'], 'dlSrc');
    num('mix.a', 'Filter I', 0, 1.5, '', 'mixA');
    num('mix.b', 'Filter II', 0, 1.5, '', 'mixB');
    choice('mix.mode', 'Output', ['stereo', 'mono'], 'mono');
    num('mix.volume', 'Volume', 0, 1.5, '', 'vol');
  }

  /** The held keys gate the envelopes whose gate source is KEYS. */
  setKeys(on: boolean): void {
    this.circuit.gate('box', 'keys', on);
  }

  /** The OPEN button of filter `which` (1 or 2): holds its envelope's gate open. */
  setOpen(which: 1 | 2, on: boolean): void {
    this.circuit.gate('box', which === 1 ? 'open1' : 'open2', on);
  }

  // ---- Patches ----

  loadSlot(index: number): void {
    const preset = this.slots[index];
    if (!preset) throw new Error(`No patch slot ${index}`);
    this.currentSlot = index;
    this.currentPreset = preset;
    this.applyValues({ ...FILTER_BOX_INIT, ...preset.values });
    this.notifyPreset();
  }

  private applyValues(values: PresetValues): void {
    for (const [id, value] of Object.entries(values)) {
      const c = this.control(id);
      if (c.kind === 'number' && typeof value === 'number') c.set(value);
      else if (c.kind === 'toggle' && typeof value === 'number') c.set(value > 0);
      else if (c.kind === 'choice' && typeof value === 'string') c.set(value);
      else throw new Error(`Patch: bad value for ${id}`);
    }
  }

  /** The current value of every control, in the form a patch stores. */
  snapshot(): PresetValues {
    const values: PresetValues = {};
    for (const c of this.controlList) values[c.id] = c.kind === 'toggle' ? (c.value ? 1 : 0) : c.value;
    return values;
  }

  /** Stores the panel's sound in a slot, keeping the slot's name. */
  saveSlot(index: number): SynthPreset {
    const preset: SynthPreset = { name: this.slots[index]!.name, values: this.snapshot() };
    this.slots[index] = preset;
    this.currentSlot = index;
    this.currentPreset = preset;
    this.notifyPreset();
    return preset;
  }

  onPresetChange(fn: () => void): () => void {
    this.presetListeners.add(fn);
    return () => this.presetListeners.delete(fn);
  }

  private notifyPreset(): void {
    for (const l of this.presetListeners) l();
  }
}
