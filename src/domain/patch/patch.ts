import type { Device } from '../devices/device';
import { DRUM_VOICES, DrumMachine } from '../devices/drumMachine';
import { OuroborosFx } from '../devices/ouroboros';
import { PolySynth } from '../devices/polySynth';
import { DelayFx, ReverbFx } from '../devices/sendFx';
import { Mixer } from '../devices/mixer';
import type { ToggleControl } from '../devices/controls';
import { Synthesizer } from '../devices/synthesizer';
import { MidiClock } from '../midi/clock';

export interface Connection {
  readonly from: { device: string; jack: string };
  readonly to: { device: string; jack: string };
}

/** The user-facing aggregate: devices plus how they're routed. */
export class Patch {
  readonly devices = new Map<string, Device>();
  readonly connections: Connection[] = [];
  output?: { device: string; jack: string };

  add(id: string, device: Device): this {
    if (this.devices.has(id)) throw new Error(`Duplicate device id: ${id}`);
    this.devices.set(id, device);
    return this;
  }

  device<T extends Device = Device>(id: string): T {
    const d = this.devices.get(id);
    if (!d) throw new Error(`Unknown device: ${id}`);
    return d as T;
  }

  connect(from: Connection['from'], to: Connection['to']): this {
    this.device(from.device).jack('out', from.jack);
    this.device(to.device).jack('in', to.jack);
    if (this.connections.some((c) => c.to.device === to.device && c.to.jack === to.jack
        && c.from.device === from.device && c.from.jack === from.jack)) {
      throw new Error('Duplicate connection');
    }
    this.connections.push({ from, to });
    return this;
  }

  setOutput(device: string, jack: string): this {
    this.device(device).jack('out', jack);
    this.output = { device, jack };
    return this;
  }

  static default(clock = new MidiClock()): Patch {
    // Mixer channel 1 is the mono synth, 2 the poly synth, 3-8 the drum voices (one individual output each).
    const patch = new Patch()
      .add('synth', new Synthesizer('Synth', clock))
      .add('poly', new PolySynth('Poly', clock))
      .add('drums', new DrumMachine('Drums', clock))
      .add('reverb', new ReverbFx('Reverb'))
      .add('delay', new DelayFx('Delay'))
      .add('ouroboros', new OuroborosFx('Ouroboros'))
      .add('mixer', new Mixer(2 + DRUM_VOICES.length, 'Mixer', 3, { 3: 'C' }))
      .connect({ device: 'synth', jack: 'out' }, { device: 'mixer', jack: 'ch1' })
      .connect({ device: 'poly', jack: 'out' }, { device: 'mixer', jack: 'ch2' });
    DRUM_VOICES.forEach((voice, i) =>
      patch.connect({ device: 'drums', jack: voice }, { device: 'mixer', jack: `ch${i + 3}` }));
    // Send effects: aux 1 feeds the reverb and aux 2 the delay; each comes back on its own stereo return strip.
    patch
      .connect({ device: 'mixer', jack: 'aux1' }, { device: 'reverb', jack: 'in' })
      .connect({ device: 'mixer', jack: 'aux2' }, { device: 'delay', jack: 'in' })
      .connect({ device: 'reverb', jack: 'out' }, { device: 'mixer', jack: 'ret1' })
      .connect({ device: 'delay', jack: 'out' }, { device: 'mixer', jack: 'ret2' });
    // Ouroboros sits on bus C: the bus feeds it, it comes back on return 3, and bus C no longer goes to main
    // directly (Ouroboros's dry/wet mix puts the dry sound back).
    patch
      .connect({ device: 'mixer', jack: 'busC' }, { device: 'ouroboros', jack: 'in' })
      .connect({ device: 'ouroboros', jack: 'out' }, { device: 'mixer', jack: 'ret3' });
    (patch.device<Mixer>('mixer').control('busC.main') as ToggleControl).set(false);
    return patch.setOutput('mixer', 'main');
  }
}
