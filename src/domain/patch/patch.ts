import type { Device } from '../devices/device';
import { DRUM_VOICES, DrumMachine } from '../devices/drumMachine';
import { Mixer } from '../devices/mixer';
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
    // Mixer channel 1 is the synth; channels 2-7 are the drum voices, one individual output each.
    const patch = new Patch()
      .add('synth', new Synthesizer('Synth', clock))
      .add('drums', new DrumMachine('Drums', clock))
      .add('mixer', new Mixer(1 + DRUM_VOICES.length))
      .connect({ device: 'synth', jack: 'out' }, { device: 'mixer', jack: 'ch1' });
    DRUM_VOICES.forEach((voice, i) =>
      patch.connect({ device: 'drums', jack: voice }, { device: 'mixer', jack: `ch${i + 2}` }));
    return patch.setOutput('mixer', 'main');
  }
}
