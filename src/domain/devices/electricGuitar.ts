import { GUITAR_GAUGES, GUITAR_SCALES, midiToHz, type Coil } from './bassPhysics';
import { StringedInstrument, type Cabinet, type PickupView } from './stringedInstrument';

export const GUITAR_FRETS = 22;
/** The strings, low to high (the high E is written e, as in tab). */
export const GUITAR_STRINGS = ['E', 'A', 'D', 'G', 'B', 'e'] as const;

/**
 * Guitar cabinets: closed boxes of 12" speakers that give up below about 80 Hz and fall away steeply above 5 kHz,
 * with the cone's presence peak between. More speakers, a bigger box: a deeper thump.
 */
export const GUITAR_CABINETS = {
  '1x12': { label: '1×12', hp: 85, hpQ: 1.0, bumpHz: 120, bumpDb: 2, coneHz: 2500, coneDb: 4, coneQ: 1.4, top: 5200 },
  '2x12': { label: '2×12', hp: 75, hpQ: 1.1, bumpHz: 105, bumpDb: 2.5, coneHz: 2200, coneDb: 4, coneQ: 1.3, top: 5000 },
  '4x12': { label: '4×12', hp: 65, hpQ: 1.2, bumpHz: 95, bumpDb: 3.5, coneHz: 2000, coneDb: 4.5, coneQ: 1.2, top: 4600 },
} as const satisfies Record<string, Cabinet>;

/** Where the three pickups sit, m from the bridge (the bridge pickup is angled; this is where it crosses the middle). */
export const PICKUP_AT = { neck: 0.16, middle: 0.1, bridge: 0.042 } as const;
type PickupName = keyof typeof PICKUP_AT;
/** The five-way switch, bridge to neck: the in-between positions add two pickups. */
export const SELECTOR = ['bridge', 'bridge+middle', 'middle', 'middle+neck', 'neck'] as const;
/** A humbucker's two coils are this far apart, m. */
const COIL_SPACING = 0.018;
/**
 * The pickup's resonance (its coil's inductance against the cable's capacitance): a single coil near 5 kHz, a
 * humbucker's two coils in series nearer 2.7 kHz; two pickups in parallel halve the inductance, so it rises.
 */
const RESONANCE = { single: 5000, humbucker: 2700 } as const;
const PARALLEL_RISE = 1.3;
/** The tone knob at 0 lowers the resonance this many octaves (the tone capacitor). */
const TONE_OCTAVES = 2.2;
/**
 * A pickup hears the string's speed, so a high string, moving fastest, would come out far louder than a low one. The
 * pole pieces are staggered and the plain strings carry less steel past the magnet, which evens it out: each string's
 * coils hear it scaled by (82 Hz / its open note)^0.7.
 */
const BALANCE = 0.7;
/** Notes that start within this long of the first are one strum, ms. */
const STRUM_WINDOW = 40;

/**
 * MOA-GUITAR: a six-string electric guitar (`StringedInstrument`): plain steel and nickel-wound strings, three pickups
 * (single coils or humbuckers) on a five-way switch with a tone knob, a vibrato arm on the bend wheel, chords strummed
 * across the strings, into a valve amp that goes from clean to crunch and a 1x12, 2x12 or 4x12 cabinet.
 */
export class ElectricGuitar extends StringedInstrument {
  /** The clock strums are timed by, ms. */
  now = (): number => performance.now();
  private strum?: { at: number; first: number };
  private wired = false;

  constructor(name = 'MOA-GUITAR') {
    super(name, {
      strings: GUITAR_STRINGS.map((n) => ({ name: n, gauge: GUITAR_GAUGES[n] })),
      frets: GUITAR_FRETS, scales: GUITAR_SCALES, scale: '25.5"', tension: [20, 150],
      pluckHeight: [0.0002, 0.003], // 0.2 mm to 3 mm
      palmAt: 0.02, pluck: { style: 'pick', position: 0.09 }, bendDown: true,
      chorusLowCut: 120, toneStack: { bass: 120, mid: 750, treble: 3000 },
      // clean at 0 (a chord's peaks stay low on the valve's curve), well into crunch at 1; the make-up keeps a chord
      // about as loud throughout (measured through the curve: within 1.5 dB from 0 to 1), so crunch only compresses
      drive: (v) => {
        const pre = 0.15 * Math.pow(70, v);
        return { pre, post: 1 / pre + 0.42 };
      },
      gain: 0.3, cabinets: GUITAR_CABINETS, cabinet: '2x12', blend: 0.85,
      level: 0.6, // a strummed chord about as loud as a bass note, its peaks (a crest of 6 when clean) below 1
    });
    const voice = () => this.voicePickups();
    this.choice('pickup.select', 'Pickups', SELECTOR, 'bridge', voice);
    this.choice('pickup.type', 'Type', ['single', 'humbucker'], 'single', voice);
    this.num('tone', 'Tone', 0, 10, 10, '', voice);
    this.choice('strum', 'Strum', ['off', 'down', 'up'], 'down', () => undefined);
    this.num('strum.time', 'Strum time', 2, 40, 10, 'ms', () => undefined);
    this.wired = true;
    this.voicePickups();
    this.ready();
  }

  private get selected(): PickupName[] {
    return this.value<string>('pickup.select').split('+') as PickupName[];
  }

  private get humbucker(): boolean {
    return this.value<string>('pickup.type') === 'humbucker';
  }

  /** The switch, the pickup type and the tone knob: which coils the strings feed and the pickups' resonance. */
  private voicePickups(): void {
    if (!this.wired) return;
    const pair = this.selected.length > 1;
    const res = RESONANCE[this.humbucker ? 'humbucker' : 'single'] * (pair ? PARALLEL_RISE : 1);
    this.setTone(res * Math.pow(2, (-TONE_OCTAVES * (10 - this.value<number>('tone'))) / 10));
    this.reconfigureAll();
  }

  protected pickup(i: number): readonly Coil[] {
    const notes = this.standardNotes;
    const balance = Math.pow(midiToHz(notes[0]!) / midiToHz(notes[i]!), BALANCE);
    const gain = (this.selected.length > 1 ? 0.6 : 1) * balance; // in parallel, each pickup loads the other
    return this.selected.flatMap((p) => this.humbucker
      ? [{ position: PICKUP_AT[p] - COIL_SPACING / 2, gain: 0.8 * gain }, { position: PICKUP_AT[p] + COIL_SPACING / 2, gain: 0.8 * gain }]
      : [{ position: PICKUP_AT[p], gain }]);
  }

  pickups(): readonly PickupView[] {
    const on = this.selected;
    return (Object.keys(PICKUP_AT) as PickupName[]).map((p) => ({ position: PICKUP_AT[p], coils: this.humbucker ? 2 : 1, on: on.includes(p) }));
  }

  /**
   * Notes that come together are strummed: each string after the strum's first waits `strum.time` per string crossed,
   * low to high on a down strum, high to low on an up strum (a string the pick has already passed sounds at once).
   */
  protected pluckDelay(i: number): number {
    const mode = this.value<string>('strum');
    if (mode === 'off') return 0;
    const now = this.now();
    if (!this.strum || now - this.strum.at > STRUM_WINDOW) {
      this.strum = { at: now, first: i };
      return 0;
    }
    const crossed = mode === 'down' ? i - this.strum.first : this.strum.first - i;
    return (Math.max(0, crossed) * this.value<number>('strum.time')) / 1000;
  }
}
