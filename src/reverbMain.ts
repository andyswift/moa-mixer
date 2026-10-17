import './ui/style.css';
import { AudioEngine } from './audio/engine';
import type { ReverbFx } from './domain/devices/sendFx';
import { MidiClock } from './domain/midi/clock';
import { Patch } from './domain/patch/patch';
import { renderReverbPanel } from './ui/fxPanel';
import { mountInstrumentPage } from './ui/instrumentPage';

// The reverb on its own page. It listens to a port (the mixer's aux 1 by default) and publishes the wet sound as
// "Reverb", which the mixer takes into its first return strip.
const clock = new MidiClock();
const patch = Patch.reverb();
const engine = new AudioEngine(patch);
const reverb = patch.device<ReverbFx>('reverb');

const page = mountInstrumentPage({
  id: 'reverb', patch, engine, clock, self: '/reverb/', panel: renderReverbPanel(reverb),
  ports: [{ device: 'reverb', jack: 'out', name: 'Reverb' }],
  inputs: [{ device: 'reverb', jack: 'in', label: 'Input', defaultPort: 'Mixer: Aux 1', mono: true }],
  onMidi: () => {},
});

// Dev-only handle for poking at the engine from the browser console.
if (import.meta.env.DEV) Object.assign(window, { __reverb: { engine, patch, pcm: page.pcm, midi: page.handleMidiBytes } });
