import { BusCompFx } from '../devices/busComp';
import type { Device } from '../devices/device';
import { DRUM_VOICES, DrumMachine } from '../devices/drumMachine';
import { GranularFx } from '../devices/granular';
import { OuroborosFx } from '../devices/ouroboros';
import { DuoSynth } from '../devices/duoSynth';
import { FilterBox } from '../devices/filterBox';
import { LynchSynth } from '../devices/lynchSynth';
import { PipeSynth } from '../devices/pipeSynth';
import { PolySynth } from '../devices/polySynth';
import { SpringReverb } from '../devices/springReverb';
import { DelayFx, ReverbFx } from '../devices/sendFx';
import { Mixer } from '../devices/mixer';
import type { ChoiceControl, ToggleControl } from '../devices/controls';
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
  /** More jacks that also go to the speakers (a drum machine's other voices). */
  readonly extraOutputs: { device: string; jack: string }[] = [];

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

  addOutput(device: string, jack: string): this {
    this.device(device).jack('out', jack);
    this.extraOutputs.push({ device, jack });
    return this;
  }

  /** An effect page: just the effect, its output to the speakers (and the audio bus). The input is fed from outside. */
  static reverb(): Patch {
    return new Patch().add('reverb', new ReverbFx('Reverb')).setOutput('reverb', 'out');
  }

  static delay(): Patch {
    return new Patch().add('delay', new DelayFx('Delay')).setOutput('delay', 'out');
  }

  static ouroboros(): Patch {
    return new Patch().add('ouroboros', new OuroborosFx('Ouroboros')).setOutput('ouroboros', 'out');
  }

  static buscomp(): Patch {
    return new Patch().add('buscomp', new BusCompFx('Bus Comp')).setOutput('buscomp', 'out');
  }

  static granular(): Patch {
    return new Patch().add('granular', new GranularFx('Granular')).setOutput('granular', 'out');
  }

  /** The poly synth page: just the synth, straight to the speakers. */
  static poly(clock = new MidiClock()): Patch {
    return new Patch().add('poly', new PolySynth('Poly', clock)).setOutput('poly', 'out');
  }

  /** The drum machine page: every voice to the speakers (and, on the audio bus, one port each). */
  static drums(clock = new MidiClock()): Patch {
    const patch = new Patch().add('drums', new DrumMachine('Drums', clock)).setOutput('drums', DRUM_VOICES[0]);
    for (const voice of DRUM_VOICES.slice(1)) patch.addOutput('drums', voice);
    return patch;
  }

  /** The mono synth page: just the synth, straight to the speakers. */
  static synth(clock = new MidiClock()): Patch {
    return new Patch().add('synth', new Synthesizer('Synth', clock)).setOutput('synth', 'out');
  }

  /** The Lynch 106 page: just the synth, straight to the speakers. */
  static lynch(clock = new MidiClock()): Patch {
    return new Patch().add('lynch', new LynchSynth('Lynch', clock)).setOutput('lynch', 'out');
  }

  /** The MOA-DUO page: the synth straight to the speakers. */
  static duo(): Patch {
    return new Patch().add('duo', new DuoSynth('MOA-DUO')).setOutput('duo', 'out');
  }

  /** The MOA-DF2 page: the Lynch 106 into the filter box (left to filter I, right to filter II), then the speakers. */
  static df2(clock = new MidiClock()): Patch {
    return new Patch()
      .add('lynch', new LynchSynth('Lynch', clock))
      .add('box', new FilterBox('MOA-DF2'))
      .connect({ device: 'lynch', jack: 'out' }, { device: 'box', jack: 'in' })
      .setOutput('box', 'out');
  }

  /** The MOA-PIPE page: the pipe synth into a spring reverb, which goes straight to the speakers. */
  static pipe(clock = new MidiClock()): Patch {
    return new Patch()
      .add('pipe', new PipeSynth('Pipe', clock))
      .add('spring', new SpringReverb('Spring'))
      .connect({ device: 'pipe', jack: 'out' }, { device: 'spring', jack: 'in' })
      .setOutput('spring', 'out');
  }

  /**
   * The mixer page: just the mixer, with no instruments and no effects (their audio arrives over the audio bus, and the
   * effect pages take the sends and buses from it). Buses B and C go nowhere by themselves: they only feed effects.
   */
  static mixerRack(): Patch {
    const patch = new Patch().add('mixer', new Mixer(2 + DRUM_VOICES.length, 'Mixer', 5, { 3: 'C', 4: 'B' }, 4));
    const mixer = patch.device<Mixer>('mixer');
    (mixer.control('busC.main') as ToggleControl).set(false);
    (mixer.control('busB.main') as ToggleControl).set(false);
    (mixer.control('key.source') as ChoiceControl).set('3');
    return patch.setOutput('mixer', 'main');
  }

  /** The whole rig in one patch: the instruments and the effects wired to the mixer directly. Used by tests and as the reference wiring (the site runs each as its own page). */
  static default(clock = new MidiClock()): Patch {
    // Mixer channel 1 is the mono synth, 2 the poly synth, 3-8 the drum voices (one individual output each).
    const patch = new Patch()
      .add('synth', new Synthesizer('Synth', clock))
      .add('poly', new PolySynth('Poly', clock))
      .add('drums', new DrumMachine('Drums', clock));
    Patch.addRack(patch)
      .connect({ device: 'synth', jack: 'out' }, { device: 'mixer', jack: 'ch1' })
      .connect({ device: 'poly', jack: 'out' }, { device: 'mixer', jack: 'ch2' });
    DRUM_VOICES.forEach((voice, i) =>
      patch.connect({ device: 'drums', jack: voice }, { device: 'mixer', jack: `ch${i + 3}` }));
    return Patch.wireRack(patch);
  }

  /** The mixer (channels 1-8: synth, poly, six drum voices; four stereo inputs for the other synths) and its effects, not yet wired. */
  private static addRack(patch: Patch, lineCount = 0): Patch {
    return patch
      .add('reverb', new ReverbFx('Reverb'))
      .add('delay', new DelayFx('Delay'))
      .add('ouroboros', new OuroborosFx('Ouroboros'))
      .add('buscomp', new BusCompFx('Bus Comp'))
      .add('granular', new GranularFx('Granular'))
      .add('mixer', new Mixer(2 + DRUM_VOICES.length, 'Mixer', 5, { 3: 'C', 4: 'B' }, lineCount));
  }

  /** Sends, returns, buses and the keyed compressor, plus the mixer's starting settings and its output. */
  private static wireRack(patch: Patch): Patch {
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
    // The bus compressor sits on bus B the same way (return 4), keyed by the kick (channel 3) for ducking.
    patch
      .connect({ device: 'mixer', jack: 'busB' }, { device: 'buscomp', jack: 'in' })
      .connect({ device: 'mixer', jack: 'key' }, { device: 'buscomp', jack: 'key' })
      .connect({ device: 'buscomp', jack: 'out' }, { device: 'mixer', jack: 'ret4' });
    // The granular processor takes aux 3 and comes back on return 5.
    patch
      .connect({ device: 'mixer', jack: 'aux3' }, { device: 'granular', jack: 'in' })
      .connect({ device: 'granular', jack: 'out' }, { device: 'mixer', jack: 'ret5' });
    const mixer = patch.device<Mixer>('mixer');
    (mixer.control('busC.main') as ToggleControl).set(false);
    (mixer.control('busB.main') as ToggleControl).set(false);
    (mixer.control('key.source') as ChoiceControl).set('3');
    return patch.setOutput('mixer', 'main');
  }
}
