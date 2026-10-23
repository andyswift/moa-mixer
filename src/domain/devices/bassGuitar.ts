import { GAUGES, SCALES } from './bassPhysics';
import { StringedInstrument, type Cabinet, type PickupView } from './stringedInstrument';

export const BASS_FRETS = 24;
/** The strings, low to high, and their gauges. */
export const BASS_STRINGS = ['E', 'A', 'D', 'G'] as const;
export type StringName = (typeof BASS_STRINGS)[number];

/** Cabinets, modelled by what makes them sound as they do: the box's low resonance and roll-off, the cones' peaks and top end. */
export const CABINETS = {
  '4x10': { label: '4×10', hp: 55, hpQ: 1.1, bumpHz: 90, bumpDb: 2, coneHz: 2000, coneDb: 4, coneQ: 1.5, top: 5000 },
  '1x15': { label: '1×15', hp: 42, hpQ: 1.3, bumpHz: 70, bumpDb: 3, coneHz: 1200, coneDb: 3, coneQ: 1.2, top: 2600 },
  '8x10': { label: '8×10', hp: 38, hpQ: 1.0, bumpHz: 60, bumpDb: 3.5, coneHz: 1800, coneDb: 3.5, coneQ: 1.4, top: 4500 },
} as const satisfies Record<string, Cabinet>;
export type CabinetId = keyof typeof CABINETS;

/**
 * MOA-BASS: a four-string bass guitar (`StringedInstrument`) with one pickup that slides along the body, into a bass
 * amp and a 4x10, 1x15 or 8x10 cabinet.
 */
export class BassGuitar extends StringedInstrument {
  constructor(name = 'MOA-BASS') {
    super(name, {
      strings: BASS_STRINGS.map((n) => ({ name: n, gauge: GAUGES[n] })),
      frets: BASS_FRETS, scales: SCALES, scale: 'long', tension: [40, 400],
      pluckHeight: [0.0003, 0.006], // 0.3 mm to 6 mm
      palmAt: 0.03, pluck: { style: 'finger', position: 0.12 }, bendDown: false,
      toneStack: { bass: 100, mid: 600, treble: 2500 },
      drive: (v) => ({ pre: 0.4 + v * 4, post: 1 / (0.4 + v * 2.2) }), // make-up: more drive, about the same level
      gain: 0.3, cabinets: CABINETS, cabinet: '4x10', blend: 0.6, level: 0.8,
    });
    this.num('pickup.position', 'Pickup', 0.03, 0.3, 0.15, 'm', () => this.reconfigureAll());
    this.num('tone', 'Tone', 300, 12000, 3500, 'Hz', (v) => this.setTone(v), 'log');
    this.ready();
  }

  protected pickup(): number {
    return this.value<number>('pickup.position');
  }

  pickups(): readonly PickupView[] {
    return [{ position: this.pickup(), coils: 1, on: true }];
  }
}
