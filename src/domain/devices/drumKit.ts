import type { MidiEvent } from '../midi/events';
import {
  KIT_CYMBALS, KIT_DRUMS, contactTime, cymbalMicWeights, cymbalModes, cymbalStrikeVelocities, drumMicWeights, drumModes,
  drumStrainWeights, drumTensionFor, edgeDamping, headStretch, membraneShape, plateStiffness, strikeImpulse, strikeVelocities as drumStrikeVelocities,
  HEADS, BRONZE,
  type CymbalSpec, type DrumMode, type DrumSpec, type PlateMode,
} from './drumPhysics';
import { noteOf } from './bassPhysics';
import { CUT_RATE, SAMPLED, type CymbalCut, type CymbalPad } from './cymbalSamples';
import { ChoiceControl, NumberControl } from './controls';
import { Device } from './device';

export const DRUM_PIECES = ['kick', 'snare', 'tom', 'floor'] as const;
export const CYMBAL_PIECES = ['hat', 'crash', 'ride'] as const;
export const KIT_PIECES = [...DRUM_PIECES, ...CYMBAL_PIECES] as const;
export type DrumPiece = (typeof DRUM_PIECES)[number];
export type CymbalPiece = (typeof CYMBAL_PIECES)[number];
export type KitPiece = (typeof KIT_PIECES)[number];

export const PIECE_NAMES: Record<KitPiece, string> = {
  kick: 'Kick', snare: 'Snare', tom: 'Rack tom', floor: 'Floor tom', hat: 'Hi-hat', crash: 'Crash', ride: 'Ride',
};

/** The pitch each drum is tuned to as it comes, Hz (its (0,1) mode). */
const TUNED: Record<DrumPiece, number> = { kick: 55, snare: 210, tom: 150, floor: 95 };
const MUFFLED: Record<DrumPiece, number> = { kick: 0.6, snare: 0.2, tom: 0.1, floor: 0.15 };
const MODES: Record<KitPiece, number> = { kick: 90, snare: 110, tom: 110, floor: 110, hat: 220, crash: 300, ride: 300 };
/** Where each piece is usually hit, as a fraction of its radius (the ride on its bow, the crash on its edge). */
export const STRIKE_AT: Record<KitPiece, number> = { kick: 0.15, snare: 0.3, tom: 0.4, floor: 0.4, hat: 0.6, crash: 0.85, ride: 0.6 };
/** Where they sit left to right, as the audience sees a right-handed drummer (as on the band page): the hi-hat on the right. */
const PAN: Record<KitPiece, number> = { kick: 0, snare: 0.25, tom: -0.05, floor: -0.4, hat: 0.5, crash: 0.6, ride: -0.6 };
/** How far each piece's microphone is, m: close on the drums, overheads over the cymbals. */
const MIC_DISTANCE: Record<KitPiece, number> = { kick: 0.15, snare: 0.1, tom: 0.1, floor: 0.1, hat: 0.6, crash: 0.8, ride: 0.8 };
/**
 * Each piece's microphone gain, measured from the engine: a drum's full-strength hit peaks near 0.9 (the kick a little more, about as loud as the snare in the room), a
 * cymbal's by its loudness over the first 0.3 s (a hard crash about 0.11 RMS once it has swelled, a ride 0.05) as a cymbal hardly peaks.
 */
const MIC: Record<KitPiece, number> = { kick: 0.02, snare: 0.00254, tom: 0.00172, floor: 0.00096, hat: 0.04, crash: 0.019, ride: 0.036 };
const CLICK: Record<KitPiece, number> = { kick: 1, snare: 1, tom: 1, floor: 1, hat: 0.5, crash: 0.5, ride: 0.6 };
export const WEIGHTS = { thin: 0.8, medium: 1, heavy: 1.25 } as const;
/** How fast a cymbal's low modes hand energy to its high ones, s^-1 at an amplitude of its thickness (thin crashes most). */
const CASCADE: Record<CymbalPiece, number> = { hat: 150, crash: 1500, ride: 150 };
/** How much of each cymbal's losses it keeps (a crash is thin and light and rings out; estimates, by ear). */
const LOSSES: Record<CymbalPiece, number> = { hat: 1, crash: 0.65, ride: 1 };
/** The level of the noise above each cymbal's highest mode, where its modes are too dense to keep apart. */
const SHIMMER: Record<CymbalPiece, number> = { hat: 0.5, crash: 1.4, ride: 0.5 };
/** The hi-hat's plates pressed together damp it this much (s^-1) when fully closed. */
const HAT_CLOSED = 260;
/** How much of each sampled cymbal goes to the reverb that grows the tail its cut lost (the crash the most). */
const TAIL: Record<CymbalPiece, number> = { hat: 0.15, ride: 0.45, crash: 0.9 };
/** The sampled cymbals' pads, in the order their sampler node holds them. */
const PADS: Record<CymbalPiece, readonly CymbalPad[]> = {
  hat: [SAMPLED.hat.closed, SAMPLED.hat.open, SAMPLED.hat.pedal],
  ride: [SAMPLED.ride.bow, SAMPLED.ride.bell],
  crash: [SAMPLED.crash.hit],
};

/** General MIDI drum notes: the piece, where it is hit (fraction of the radius) and, for the hi-hat, its pedal. */
export const GM_KIT: Record<number, { piece: KitPiece; at?: number; hat?: 'closed' | 'open' | 'pedal' }> = {
  35: { piece: 'kick' }, 36: { piece: 'kick' },
  37: { piece: 'snare', at: 0.97 }, // side stick: by the rim
  38: { piece: 'snare' }, 40: { piece: 'snare', at: 0.1 },
  41: { piece: 'floor' }, 43: { piece: 'floor' },
  45: { piece: 'tom', at: 0.55 }, 47: { piece: 'tom' }, 48: { piece: 'tom' }, 50: { piece: 'tom', at: 0.25 },
  42: { piece: 'hat', hat: 'closed' }, 44: { piece: 'hat', hat: 'pedal' }, 46: { piece: 'hat', hat: 'open' },
  49: { piece: 'crash' }, 52: { piece: 'crash' }, 55: { piece: 'crash', at: 0.7 }, 57: { piece: 'crash' },
  51: { piece: 'ride' }, 59: { piece: 'ride' }, 53: { piece: 'ride', at: 0.12 }, // the bell
};

const isDrum = (p: KitPiece): p is DrumPiece => (DRUM_PIECES as readonly string[]).includes(p);
const sampler = (p: CymbalPiece) => `${p}.s`;
const SAMPLE_RATE = 48000;

/**
 * MOA-KIT: an acoustic drum kit, every piece physically modelled (`drumPhysics.ts`, `kitWorklet.ts`): a 22" kick, a
 * 14" snare with its wires, 12" and 16" toms, 14" hi-hats, an 18" crash and a 21" ride. Each piece is a node of its
 * own, panned where it sits, into one stereo output. Played by General MIDI drum notes (any channel), or by hitting
 * the heads on the page.
 *
 * The cymbals can instead be sampled (`cymbalSamples.ts`: hits cut from Gaute's breaks), each played by a sampler node
 * (`samplerWorklet.ts`) whose tail, cut short in the recording, a bright reverb grows back; the modelled cymbal can
 * be layered under it. The sounds arrive with `loadCymbals` (the page fetches them).
 */
export class DrumKit extends Device {
  readonly name: string;
  /** How open the hi-hat is now, 0 (pedal down) to 1. */
  hatOpen = 0;
  private building = true;
  private readonly modes = new Map<KitPiece, DrumMode[] | PlateMode[]>();
  private readonly strikes = new Map<string, number[]>();
  private readonly hitListeners = new Set<(piece: KitPiece, velocity: number, at: number) => void>();
  private readonly physicsListeners = new Set<() => void>();
  private readonly cuts = new Map<CymbalCut, Float32Array>();

  constructor(name = 'MOA-KIT') {
    super();
    this.name = name;
    const c = this.circuit;
    c.add('kit', 'gain', { gain: 1 });
    for (const p of KIT_PIECES) {
      c.add(p, 'drum', { level: 1 }, { config: '{}' })
        .add(`${p}.pan`, 'pan', { pan: PAN[p] })
        .connect(p, `${p}.pan`)
        .connect(`${p}.pan`, 'kit');
    }
    // the sampled cymbals, and the reverb that grows their tails (bright: the low end of a wash is mud)
    c.add('tailHp', 'filter', { frequency: 1200, Q: 0.707 }, { type: 'highpass' })
      .add('tail', 'convolver', {}, { size: 'medium' })
      .connect('tailHp', 'tail')
      .connect('tail', 'kit');
    for (const p of CYMBAL_PIECES) {
      c.add(sampler(p), 'sampler', { level: 1 })
        .add(`${p}.tail`, 'gain', { gain: TAIL[p] })
        .connect(sampler(p), 'kit')
        .connect(sampler(p), `${p}.tail`)
        .connect(`${p}.tail`, 'tailHp');
    }
    c.onReady((nodeId) => {
      const p = CYMBAL_PIECES.find((x) => sampler(x) === nodeId);
      if (p) this.sendCymbal(p);
    });
    c.add('master', 'gain', { gain: 0.8 }).connect('kit', 'master');
    this.outputList.push({ name: 'out', nodeId: 'master' });

    const num = (id: string, label: string, min: number, max: number, init: number, unit: string, apply: (v: number) => void, curve?: 'linear' | 'log') =>
      this.controlList.push(new NumberControl(id, label, min, max, init, unit, apply, curve));
    const choice = (id: string, label: string, options: readonly string[], init: string, apply: (v: string) => void) =>
      this.controlList.push(new ChoiceControl(id, label, options, init, apply));
    for (const p of DRUM_PIECES) {
      const tension = Math.round(drumTensionFor(KIT_DRUMS[p], TUNED[p]));
      num(`${p}.tension`, `${PIECE_NAMES[p]} tension`, 200, 9000, tension, 'N/m', () => this.reconfigure(p), 'log');
      num(`${p}.muffle`, `${PIECE_NAMES[p]} muffling`, 0, 1, MUFFLED[p], '', () => this.reconfigure(p));
    }
    num('snare.wires', 'Snare wires', 0, 1, 0.4, '', () => this.reconfigure('snare'));
    choice('snare.on', 'Snares', ['on', 'off'], 'on', () => this.reconfigure('snare'));
    for (const p of CYMBAL_PIECES) choice(`${p}.weight`, PIECE_NAMES[p], Object.keys(WEIGHTS), 'medium', () => this.reconfigure(p));
    num('hat.open', 'Hi-hat open', 0, 1, 0, '', (v) => this.setHat(v));
    num('strength', 'Strength', 0, 1, 0.7, '', () => undefined); // how hard the page's own hits are
    choice('cymbals.source', 'Cymbals', ['samples', 'model'], 'samples', () => this.setLevels());
    num('cymbals.layer', 'Model under', 0, 1, 0, '', () => this.setLevels());
    num('cymbals.tail', 'Tail', 0, 1.5, 1, '', (v) => { for (const p of CYMBAL_PIECES) c.setParam(`${p}.tail`, 'gain', TAIL[p] * v); });
    for (const p of KIT_PIECES) num(`${p}.level`, `${PIECE_NAMES[p]} level`, 0, 2, 1, '', () => this.setLevels());
    num('level', 'Level', 0, 1.5, 0.6, '', (v) => c.setParam('master', 'gain', v)); // kick, crash and hat together on a downbeat stay under 1
    this.building = false;
    for (const p of KIT_PIECES) this.reconfigure(p);
    this.setHat(this.hatOpen);
    this.setLevels();
  }

  /** Whether the cymbals are the sampled ones (with the model layered under at `cymbals.layer`) or the model alone. */
  get sampledCymbals(): boolean {
    return this.value<string>('cymbals.source') === 'samples';
  }

  /** Each node's level: the drums at their own, the cymbals split between the samples and the model. */
  private setLevels(): void {
    if (this.building) return;
    for (const p of KIT_PIECES) {
      const level = this.value<number>(`${p}.level`);
      if (isDrum(p)) { this.circuit.setParam(p, 'level', level); continue; }
      const sampled = this.sampledCymbals;
      this.circuit.setParam(p, 'level', sampled ? level * this.value<number>('cymbals.layer') : level);
      this.circuit.setParam(sampler(p), 'level', sampled ? level : 0);
    }
  }

  /**
   * The cymbal hits cut from the breaks (`cutCymbal`), at 44.1 kHz: sent to the cymbals' sampler nodes now, and again
   * to any engine built later (when its nodes say they are ready).
   */
  loadCymbals(cuts: Partial<Record<CymbalCut, Float32Array>>): void {
    for (const [id, data] of Object.entries(cuts)) this.cuts.set(id as CymbalCut, data!);
    for (const p of CYMBAL_PIECES) this.sendCymbal(p);
  }

  private sendCymbal(p: CymbalPiece): void {
    const node = sampler(p);
    for (const [id, data] of this.cuts) this.circuit.send(node, { type: 'sample', id, rate: CUT_RATE, channels: [data] });
    PADS[p].forEach((pad, i) => {
      const settings = {
        sample: pad.cut, start: 0, end: this.cuts.get(pad.cut)?.length ?? 0, tune: pad.tune, level: pad.level, pan: PAN[p],
        attack: 0.001, decay: pad.decay > 0 ? pad.decay : 8, mode: 'oneshot', group: p === 'hat' ? 1 : 0,
        velLevel: 0.8, velFilter: 0.3, cutoff: 20000,
      };
      this.circuit.send(node, { type: 'pad', pad: i, settings });
    });
  }

  /** Plays a sampled cymbal: the hi-hat closed, open or by its pedal, the ride on its bow or its bell, the crash. */
  private hitSample(p: CymbalPiece, velocity: number, at: number, delay: number, pedal = false): void {
    const pad = p === 'hat' ? (pedal ? 2 : this.hatOpen < 0.5 ? 0 : 1) : p === 'ride' && at < 0.25 ? 1 : 0;
    const m: Record<string, unknown> = { type: 'hit', pad, velocity };
    if (delay > 0) m.delay = delay;
    this.circuit.send(sampler(p), m);
  }

  // ---- the physics, read from the controls ----

  private value<T extends number | string>(id: string): T {
    return this.control(id).value as T;
  }

  drumSpec(p: DrumPiece): DrumSpec {
    return KIT_DRUMS[p];
  }

  cymbalSpec(p: CymbalPiece): CymbalSpec {
    const c = KIT_CYMBALS[p];
    return { ...c, thickness: c.thickness * WEIGHTS[this.value<string>(`${p}.weight`) as keyof typeof WEIGHTS] };
  }

  /** A piece's modes as they are now (lowest first). */
  pieceModes(p: KitPiece): readonly (DrumMode | PlateMode)[] {
    return this.modes.get(p) ?? [];
  }

  /** What a piece's numbers are now, for the panel. */
  readout(p: KitPiece) {
    const m = this.pieceModes(p);
    if (isDrum(p)) {
      const s = this.drumSpec(p), T = this.value<number>(`${p}.tension`), head = HEADS[s.head];
      const f = m[0]!.hz;
      return {
        kind: 'drum' as const, diameter: s.diameter, depth: s.depth, head: head.name, tension: T, speed: Math.sqrt(T / head.sigma), sigma: head.sigma,
        fundamental: { hz: f, ...noteOf(f) }, ratio11: (m.find((x) => x.m === 1)?.hz ?? f) / f, ring: 6.9 / m[0]!.sigma, modes: m.length,
        top: m.at(-1)!.hz,
      };
    }
    const c = this.cymbalSpec(p);
    const lowest = m.find((x) => x.hz > 150) ?? m[0]!;
    return {
      kind: 'cymbal' as const, diameter: c.diameter, thickness: c.thickness, bending: plateStiffness(c.thickness), mass: BRONZE.rho * c.thickness * Math.PI * (c.diameter / 2) ** 2,
      fundamental: { hz: lowest.hz, ...noteOf(lowest.hz) }, ring: 6.9 / lowest.sigma, modes: m.length, top: m.at(-1)!.hz,
    };
  }

  /** Works a piece's modes out again and sends them (kept on its node too, for an engine built later). */
  private reconfigure(p: KitPiece): void {
    if (this.building) return;
    this.strikes.clear();
    let message: Record<string, unknown>;
    if (isDrum(p)) {
      const s = this.drumSpec(p), T = this.value<number>(`${p}.tension`);
      const modes = drumModes(s, T, MODES[p]);
      this.modes.set(p, modes);
      const muffle = edgeDamping(modes, this.value<number>(`${p}.muffle`));
      message = {
        hz: modes.map((x) => x.hz), sigma: modes.map((x, k) => x.sigma + muffle[k]!),
        mic: drumMicWeights(s, modes, MIC_DISTANCE[p]).map((w) => w * MIC[p] * 1e-3), strainK: drumStrainWeights(s, modes), stretch: headStretch(s, T),
      };
      if (p === 'snare' && this.value<string>('snare.on') === 'on') {
        // the wires lie across the bottom head; it follows the batter's low modes through the air between them, about a third as far
        const wires = this.value<number>('snare.wires');
        message.wires = {
          weights: modes.map((x) => (x.m <= 1 ? 0.33 * (2 * Math.PI * x.hz) ** 2 * membraneShape(x, 0.45) : 0)),
          threshold: 60 + 900 * wires, gain: 0.25, hz: 5200,
        };
      }
    } else {
      const c = this.cymbalSpec(p);
      const modes = cymbalModes(c, MODES[p]);
      this.modes.set(p, modes);
      // octave bands from 500 Hz up; each band's reference: moving as far as the plate is thick, at its lower edge
      const bandHz = [0, 500, 1000, 2000, 4000, 8000];
      const edges = [...bandHz.map((f) => { const k = modes.findIndex((x) => x.hz >= f); return k < 0 ? modes.length : k; }), modes.length];
      const refs = bandHz.map((f) => (2 * Math.PI * Math.max(250, f) * c.thickness) ** 2);
      message = {
        hz: modes.map((x) => x.hz), sigma: modes.map((x) => x.sigma * LOSSES[p as CymbalPiece]), mic: cymbalMicWeights(c, modes, MIC_DISTANCE[p]).map((w) => w * MIC[p] * 1e-3),
        dampK: modes.map((x) => 1 + x.hz / 2000),
        cascade: { edges, refs, rate: CASCADE[p] },
        band: { hz: modes.at(-1)!.hz, gain: SHIMMER[p as CymbalPiece] },
      };
      if (p === 'hat') message.damp = this.hatDamp();
    }
    const m = { type: 'configure', ...message };
    this.circuit.setOption(p, 'config', JSON.stringify(m));
    this.circuit.send(p, m);
    for (const l of this.physicsListeners) l();
  }

  onPhysicsChange(fn: () => void): () => void {
    this.physicsListeners.add(fn);
    return () => this.physicsListeners.delete(fn);
  }

  // ---- playing ----

  /** The modes' velocities for a strike (cached: the Bessel shapes are the costly part). */
  private strikeVelocities(p: KitPiece, at: number, velocity: number): number[] {
    const key = `${p}/${at.toFixed(2)}/${velocity.toFixed(2)}`;
    let v = this.strikes.get(key);
    if (!v) {
      const strike = { r: at, velocity, contact: contactTime(isDrum(p) ? KIT_DRUMS[p].striker : 'metal', velocity) };
      v = isDrum(p) ? drumStrikeVelocities(this.drumSpec(p), this.modes.get(p) as DrumMode[], strike)
        : cymbalStrikeVelocities(this.cymbalSpec(p as CymbalPiece), this.modes.get(p) as PlateMode[], strike);
      if (this.strikes.size > 600) this.strikes.clear();
      this.strikes.set(key, v);
    }
    return v;
  }

  /** Hits a piece at `at` (fraction of its radius) with `velocity` 0..1, after `delay` seconds. */
  hit(p: KitPiece, velocity: number, at = STRIKE_AT[p], delay = 0): void {
    const vel = Math.min(1, Math.max(0.02, velocity));
    const r = Math.min(0.97, Math.max(0, at));
    if (!isDrum(p) && this.sampledCymbals) {
      this.hitSample(p, vel, r, delay);
      for (const l of this.hitListeners) l(p, vel, r);
      if (this.value<number>('cymbals.layer') === 0) return;
    }
    const v = this.strikeVelocities(p, r, Math.round(vel * 50) / 50);
    const striker = isDrum(p) ? KIT_DRUMS[p].striker : 'metal';
    const tau = contactTime(striker, vel);
    const headMass = isDrum(p) ? HEADS[KIT_DRUMS[p].head].sigma * Math.PI * (KIT_DRUMS[p].diameter / 2) ** 2 : 1;
    const click = strikeImpulse(striker === 'beater' ? 'beater' : 'stick', headMass, vel) * CLICK[p];
    const m: Record<string, unknown> = { type: 'hit', v, click, tau };
    if (p === 'hat' && this.hatOpen < 0.3) { m.burst = 0.05 * vel; m.burstDecay = 0.012; } // the plates rattle against each other
    if (delay > 0) m.delay = delay;
    this.circuit.send(p, m);
    for (const l of this.hitListeners) l(p, vel, r);
  }

  /** Sets how open the hi-hat is: closed plates damp each other, and half-open they sizzle. */
  setHat(open: number): void {
    this.hatOpen = Math.min(1, Math.max(0, open));
    const damp = this.hatDamp();
    const cfg = JSON.parse(this.circuit.node('hat').options.config!) as Record<string, unknown>;
    if (cfg.hz) this.circuit.setOption('hat', 'config', JSON.stringify({ ...cfg, damp })); // for an engine built later
    this.circuit.send('hat', { type: 'damp', ...damp });
  }

  /** The plates touch until the pedal is half up: pressed hard they damp each other, barely touching they sizzle. */
  private hatDamp(): { sigma: number; contact: number } {
    const pressed = Math.max(0, 1 - this.hatOpen / 0.5);
    const touching = this.hatOpen > 0.05 && this.hatOpen < 0.5;
    return { sigma: HAT_CLOSED * pressed * pressed, contact: touching ? 4 * this.hatOpen * pressed : 0 };
  }

  /** The pedal brought down: the plates clap shut (the chick) and stop ringing. */
  hatPedal(velocity: number): void {
    this.setHat(0);
    if (this.sampledCymbals) this.hitSample('hat', velocity, 0, 0, true);
    this.circuit.send('hat', { type: 'hit', v: [], click: 0, tau: 0.001, burst: 0.08 * velocity, burstDecay: 0.02 });
    for (const l of this.hitListeners) l('hat', velocity, 0);
  }

  onHit(fn: (piece: KitPiece, velocity: number, at: number) => void): () => void {
    this.hitListeners.add(fn);
    return () => this.hitListeners.delete(fn);
  }

  /** MIDI (any channel): General MIDI drum notes; 42, 44 and 46 work the hi-hat's pedal as well as hitting it. */
  handleMidi(event: MidiEvent): void {
    if (event.type !== 'noteOn') return;
    const target = GM_KIT[event.note];
    if (!target) return;
    const vel = event.velocity / 127;
    if (target.hat === 'pedal') return this.hatPedal(vel);
    if (target.hat === 'closed') this.setHat(0);
    if (target.hat === 'open') this.setHat(1);
    this.hit(target.piece, vel, target.at);
  }
}

