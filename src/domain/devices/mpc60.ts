import type { MidiClock } from '../midi/clock';
import type { MidiEvent } from '../midi/events';
import { ChoiceControl, NumberControl, ToggleControl } from './controls';
import { Device } from './device';
import { toMpc60 } from './mpc60Character';
import type { HitOver } from '../sequencer/mpcSequencer';
import { Transport } from './transport';

/** The MIDI channel the MOA-60 listens on by default (10 is the drum machine). */
export const MPC_MIDI_CHANNEL = '11';
export const BANKS = ['A', 'B', 'C', 'D'] as const;
export const PADS_PER_BANK = 16;
export const PAD_COUNT = BANKS.length * PADS_PER_BANK;
/** Pad A01 answers MIDI note 36, A16 note 51, B01 note 52 and so on up to D16 on 99. */
export const FIRST_NOTE = 36;
/** A one-shot decay at this (seconds) or longer plays the whole sound (the worklet's DECAY_OFF). */
export const DECAY_OFF = 8;

export type Character = 'MPC60' | 'Clean';
export type PadMode = 'oneshot' | 'noteon';
export type LevelsMode = 'off' | 'tune' | 'velocity' | 'decay' | 'filter';

/** A sound in the pool: as it was imported, and as it plays (through the MPC60 store, or as it came). */
export interface Sound {
  readonly id: string;
  name: string;
  character: Character;
  /** The sound as imported. */
  readonly source: { rate: number; channels: Float32Array[] };
  /** The sound as it plays. */
  rate: number;
  channels: Float32Array[];
}

/** How a pad plays its sound. Start and end are in seconds into the sound (end 0 is its end). */
export interface PadSettings {
  sound?: string;
  start: number;
  end: number;
  tune: number;
  level: number;
  pan: number;
  attack: number;
  decay: number;
  mode: PadMode;
  reverse: boolean;
  loop: boolean;
  /** Mute group: 0 for none; pads in the same group cut each other. */
  group: number;
  /** How much velocity sets the level, 0..1. */
  velLevel: number;
  cutoff: number;
  reso: number;
  /** How far velocity opens the filter, 0..1 (four octaves at full). */
  velFilter: number;
}

export const defaultPad = (): PadSettings => ({
  start: 0, end: 0, tune: 0, level: 0.8, pan: 0, attack: 0, decay: DECAY_OFF, mode: 'oneshot', reverse: false, loop: false,
  group: 0, velLevel: 1, cutoff: 20000, reso: 0, velFilter: 0,
});

export const padName = (i: number): string => `${BANKS[Math.floor(i / PADS_PER_BANK)]}${String((i % PADS_PER_BANK) + 1).padStart(2, '0')}`;
export const padIndex = (name: string): number => BANKS.indexOf(name[0] as (typeof BANKS)[number]) * PADS_PER_BANK + Number(name.slice(1)) - 1;
const PAD_NAMES = Array.from({ length: PAD_COUNT }, (_, i) => padName(i));

/** A kit: its pads and the sounds they use (sounds by id, kept in the pool). */
export interface Program {
  name: string;
  pads: PadSettings[];
}

/** A factory kit, made when it is chosen (its sounds are worked out, not stored). */
export interface FactoryKit {
  readonly name: string;
  load(): Promise<{ sounds: { id: string; name: string; rate: number; channels: Float32Array[]; character?: Character }[]; program: Program }>;
}

/** What a hit was: for the screen's pads, and for the sequencer to record. */
export interface Hit {
  pad: number;
  velocity: number;
  when?: number;
}

/**
 * The factory kits by name, in the order a song's preset number picks them. Their sounds are made in the browser
 * (`mpcKits.ts`), which fills in the loaders; until then (and in tests) a factory kit loads empty.
 */
export const FACTORY_KIT_NAMES = ['MOA Drums 60', 'Gaute Breaks'] as const;

let soundCount = 0;
export const newSoundId = (): string => `s${Date.now().toString(36)}${(soundCount++).toString(36)}`;

/**
 * MOA-60: a sampler in the spirit of the Akai MPC60. 64 pads in four banks of 16, each playing a sound from the pool
 * with its own start and end, tune, level, pan, envelope, filter, mute group and velocity response. Sounds are kept
 * as the MPC60 kept them (40 kHz, 12 bits, non-linear) or clean, a choice per sound that can be changed at any time
 * (the sound as imported is kept).
 *
 * The "Pad" controls edit the selected pad (Pad picks it). 16 Levels plays the selected pad's sound from all 16 pads
 * of the screen, each a step further in tune, velocity, decay or filter, as on the MPC60.
 *
 * MIDI notes on its channel play pads (A01 is note 36, D16 note 99), with velocity; a note off lets go of a Note On pad.
 */
export class Mpc60 extends Device {
  readonly name: string;
  readonly transport: Transport;
  readonly sounds = new Map<string, Sound>();
  readonly pads: PadSettings[] = Array.from({ length: PAD_COUNT }, defaultPad);
  programName = 'New kit';
  /** Factory kits, loaded by `loadSlot` (what a song's preset number picks). */
  slots: readonly FactoryKit[] = FACTORY_KIT_NAMES.map((name) => ({ name, load: async () => ({ sounds: [], program: { name, pads: [] } }) }));
  /** The bank on the screen's pads. */
  bank = 0;
  private readonly hitListeners = new Set<(hit: Hit) => void>();
  private readonly changeListeners = new Set<() => void>();
  private loading?: Promise<void>;
  // the circuit is built before the controls below, whose first values are sent to it
  private readonly built = this.circuit
    .add('voices', 'sampler', { level: 0.8 })
    .add('out', 'gain', { gain: 1 })
    .add('meter', 'meter', {}, { channel: 'mono' })
    .connect('voices', 'out')
    .connect('out', 'meter');

  readonly level = this.num('mpc.level', 'Level', 0, 1.5, 0.8, '', (v) => this.circuit.setParam('voices', 'level', v));
  readonly character = this.choice('mpc.character', 'New sounds', ['MPC60', 'Clean'], 'MPC60', () => {});
  readonly selected = this.choice('pad.select', 'Pad', PAD_NAMES, 'A01', () => this.showPad());
  readonly levels = this.choice('levels.mode', '16 Levels', ['off', 'tune', 'velocity', 'decay', 'filter'], 'off', () => this.notifyChange());
  private readonly padControls = {
    tune: this.num('pad.tune', 'Tune', -36, 36, 0, 'st', (v) => this.editPad({ tune: v })),
    level: this.num('pad.level', 'Level', 0, 1.5, 0.8, '', (v) => this.editPad({ level: v })),
    pan: this.num('pad.pan', 'Pan', -1, 1, 0, '', (v) => this.editPad({ pan: v })),
    attack: this.num('pad.attack', 'Attack', 0, 2, 0, 's', (v) => this.editPad({ attack: v })),
    decay: this.num('pad.decay', 'Decay', 0.01, DECAY_OFF, DECAY_OFF, 's', (v) => this.editPad({ decay: v }), 'log'),
    mode: this.choice('pad.mode', 'Mode', ['oneshot', 'noteon'], 'oneshot', (v) => this.editPad({ mode: v as PadMode })),
    reverse: this.toggle('pad.reverse', 'Reverse', false, (v) => this.editPad({ reverse: v })),
    loop: this.toggle('pad.loop', 'Loop', false, (v) => this.editPad({ loop: v })),
    group: this.choice('pad.group', 'Mute group', ['off', '1', '2', '3', '4', '5', '6', '7', '8'], 'off', (v) => this.editPad({ group: v === 'off' ? 0 : Number(v) })),
    velLevel: this.num('pad.velocity', 'Velocity', 0, 1, 1, '', (v) => this.editPad({ velLevel: v })),
    cutoff: this.num('pad.cutoff', 'Filter', 40, 20000, 20000, 'Hz', (v) => this.editPad({ cutoff: v }), 'log'),
    reso: this.num('pad.reso', 'Resonance', 0, 1, 0, '', (v) => this.editPad({ reso: v })),
    velFilter: this.num('pad.velFilter', 'Vel > filter', 0, 1, 0, '', (v) => this.editPad({ velFilter: v })),
  };
  /** While the pad controls are following a newly selected pad, their changes are not edits. */
  private showing = false;

  constructor(clock: MidiClock, name = 'MOA-60') {
    super();
    this.name = name;
    this.transport = new Transport(clock);
    this.transport.channel.set(MPC_MIDI_CHANNEL);
    this.controlList.push(this.transport.channel);
    this.outputList.push({ name: 'out', nodeId: 'out' });
    this.meterList.push({ name: 'out', nodeId: 'meter' });
    // a worklet built later (when audio starts) asks for everything
    this.circuit.onReady((nodeId) => { if (nodeId === 'voices') this.sendAll(); });
  }

  get selectedPad(): number {
    return padIndex(this.selected.value);
  }

  /** The pad settings with the sound's frames worked out, as the worklet wants them. */
  private padMessage(i: number) {
    const p = this.pads[i]!;
    const s = p.sound ? this.sounds.get(p.sound) : undefined;
    const rate = s?.rate ?? 1;
    return {
      type: 'pad', pad: i,
      settings: { ...p, sample: s ? p.sound : undefined, start: p.start * rate, end: p.end > p.start ? p.end * rate : 0 },
    };
  }

  private sendPad(i: number): void {
    this.circuit.send('voices', this.padMessage(i));
  }

  private sendSound(s: Sound): void {
    this.circuit.send('voices', { type: 'sample', id: s.id, rate: s.rate, channels: s.channels });
  }

  private sendAll(): void {
    for (const s of this.sounds.values()) this.sendSound(s);
    for (let i = 0; i < PAD_COUNT; i++) this.sendPad(i);
  }

  /** Adds a sound to the pool (worked into the MPC60 store unless `character` says Clean); returns it. */
  addSound(name: string, rate: number, channels: Float32Array[], character: Character = this.character.value as Character, id = newSoundId()): Sound {
    const source = { rate, channels };
    const played = character === 'MPC60' ? toMpc60(channels, rate) : source;
    const s: Sound = { id, name, character, source, rate: played.rate, channels: played.channels };
    this.sounds.set(id, s);
    this.sendSound(s);
    for (let i = 0; i < PAD_COUNT; i++) if (this.pads[i]!.sound === id) this.sendPad(i);
    this.notifyChange();
    return s;
  }

  /** Changes a sound between the MPC60 store and clean; its pads keep their start and end (they are in seconds). */
  setCharacter(id: string, character: Character): void {
    const s = this.sounds.get(id);
    if (!s || s.character === character) return;
    const played = character === 'MPC60' ? toMpc60(s.source.channels, s.source.rate) : s.source;
    Object.assign(s, { character, rate: played.rate, channels: played.channels });
    this.sendSound(s);
    for (let i = 0; i < PAD_COUNT; i++) if (this.pads[i]!.sound === id) this.sendPad(i);
    this.notifyChange();
  }

  removeSound(id: string): void {
    if (!this.sounds.delete(id)) return;
    this.circuit.send('voices', { type: 'drop', id });
    for (let i = 0; i < PAD_COUNT; i++) if (this.pads[i]!.sound === id) this.setPad(i, { sound: undefined });
    this.notifyChange();
  }

  /** The length of a sound in seconds. */
  duration(id: string): number {
    const s = this.sounds.get(id);
    return s ? s.source.channels[0]!.length / s.source.rate : 0;
  }

  /** Changes pad i's settings (any of them); the pad controls follow if it is the selected pad. */
  setPad(i: number, settings: Partial<PadSettings>): void {
    Object.assign(this.pads[i]!, settings);
    this.sendPad(i);
    if (i === this.selectedPad) this.showPad();
    this.notifyChange();
  }

  /** Puts a sound on pad i from `start` to `end` seconds (the whole sound by default), keeping the pad's other settings. */
  assign(i: number, sound: string, start = 0, end = 0): void {
    this.setPad(i, { sound, start, end });
  }

  private editPad(settings: Partial<PadSettings>): void {
    if (this.showing) return;
    Object.assign(this.pads[this.selectedPad]!, settings);
    this.sendPad(this.selectedPad);
    this.notifyChange();
  }

  /** Sets the pad controls to the selected pad's settings. */
  private showPad(): void {
    if (!(this.padControls as typeof this.padControls | undefined)) return; // (not while the controls are being made)
    const p = this.pads[this.selectedPad]!;
    this.showing = true;
    const c = this.padControls;
    c.tune.set(p.tune); c.level.set(p.level); c.pan.set(p.pan); c.attack.set(p.attack); c.decay.set(p.decay);
    c.mode.set(p.mode); c.reverse.set(p.reverse); c.loop.set(p.loop); c.group.set(p.group ? String(p.group) : 'off');
    c.velLevel.set(p.velLevel); c.cutoff.set(p.cutoff); c.reso.set(p.reso); c.velFilter.set(p.velFilter);
    this.showing = false;
    this.notifyChange();
  }

  /**
   * Plays pad i (velocity 0..1; `when` an audio-clock time, default now). `over` changes its tune, decay, mode or
   * filter for this hit only (what 16 Levels does).
   */
  hit(i: number, velocity = 1, when?: number, over?: HitOver): void {
    if (i < 0 || i >= PAD_COUNT || velocity <= 0) return;
    this.circuit.send('voices', { type: 'hit', pad: i, velocity, when, over });
    for (const l of this.hitListeners) l({ pad: i, velocity, when });
  }

  release(i: number, when?: number): void {
    this.circuit.send('voices', { type: 'release', pad: i, when });
  }

  stopAll(): void {
    this.circuit.send('voices', { type: 'stopAll' });
  }

  /**
   * What screen pad `n` (0..15) of the bank showing plays: that pad, or with 16 Levels on, the selected pad with the
   * step for `n` (tune -8..+7 semitones, velocity, decay or filter rising across the pads).
   */
  padFor(n: number, velocity = 1): { pad: number; velocity: number; over?: HitOver } {
    const mode = this.levels.value as LevelsMode;
    if (mode === 'off') return { pad: this.bank * PADS_PER_BANK + n, velocity };
    const i = this.selectedPad, p = this.pads[i]!, t = n / (PADS_PER_BANK - 1);
    if (mode === 'tune') return { pad: i, velocity, over: { tune: p.tune + n - 8 } };
    if (mode === 'velocity') return { pad: i, velocity: (n + 1) / PADS_PER_BANK };
    if (mode === 'decay') return { pad: i, velocity, over: { decay: 0.03 * (DECAY_OFF / 0.03) ** t, mode: 'oneshot' } };
    return { pad: i, velocity, over: { cutoff: 100 * 200 ** t } };
  }

  /** Plays screen pad `n` (see `padFor`); returns what it played. */
  press(n: number, velocity = 1, when?: number): { pad: number; velocity: number; over?: HitOver } {
    const h = this.padFor(n, velocity);
    this.hit(h.pad, h.velocity, when, h.over);
    return h;
  }

  /** Lets go of screen pad `n` (for Note On pads). */
  unpress(n: number, when?: number): void {
    this.release(this.levels.value === 'off' ? this.bank * PADS_PER_BANK + n : this.selectedPad, when);
  }

  /** MIDI notes on its channel play pads; `when` (an audio-clock time) places them ahead of time. */
  handleMidi(event: MidiEvent, when?: number): void {
    if ((event.type !== 'noteOn' && event.type !== 'noteOff') || !this.transport.acceptsChannel(event.channel)) return;
    const i = event.note - FIRST_NOTE;
    if (i < 0 || i >= PAD_COUNT) return;
    if (event.type === 'noteOn' && event.velocity > 0) this.hit(i, event.velocity / 127, when);
    else this.release(i, when);
  }

  /** The kit as it stands, to save. */
  program(): Program {
    return { name: this.programName, pads: this.pads.map((p) => ({ ...p })) };
  }

  /** Loads a kit's pads (its sounds must be in the pool already). */
  loadProgram(p: Program): void {
    this.programName = p.name;
    for (let i = 0; i < PAD_COUNT; i++) {
      Object.assign(this.pads[i]!, defaultPad(), { sound: undefined }, p.pads[i] ?? {});
      this.sendPad(i);
    }
    this.showPad();
  }

  /** Loads factory kit i: makes its sounds, then its pads. Resolves when it is ready to play. */
  loadSlot(i: number): Promise<void> {
    const kit = this.slots[i];
    if (!kit) return Promise.resolve();
    this.loading = kit.load().then(({ sounds, program }) => {
      for (const s of sounds) this.addSound(s.name, s.rate, s.channels, s.character ?? 'MPC60', s.id);
      this.loadProgram(program);
    });
    return this.loading;
  }

  /** Resolves once the last kit asked for has loaded. */
  ready(): Promise<void> {
    return this.loading ?? Promise.resolve();
  }

  onHit(fn: (hit: Hit) => void): () => void {
    this.hitListeners.add(fn);
    return () => this.hitListeners.delete(fn);
  }

  /** Called when sounds, pads or the selection change. */
  onChange(fn: () => void): () => void {
    this.changeListeners.add(fn);
    return () => this.changeListeners.delete(fn);
  }

  private notifyChange(): void {
    for (const l of this.changeListeners) l();
  }

  private num(...args: ConstructorParameters<typeof NumberControl>): NumberControl {
    const c = new NumberControl(...args);
    this.controlList.push(c);
    return c;
  }

  private choice(...args: ConstructorParameters<typeof ChoiceControl>): ChoiceControl {
    const c = new ChoiceControl(...args);
    this.controlList.push(c);
    return c;
  }

  private toggle(...args: ConstructorParameters<typeof ToggleControl>): ToggleControl {
    const c = new ToggleControl(...args);
    this.controlList.push(c);
    return c;
  }
}
