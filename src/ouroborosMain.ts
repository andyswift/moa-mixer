import './ui/style.css';
import { AudioEngine } from './audio/engine';
import type { OuroborosFx } from './domain/devices/ouroboros';
import { MidiClock } from './domain/midi/clock';
import { Patch } from './domain/patch/patch';
import { renderOuroPanel } from './ui/ouroborosPanel';
import { mountInstrumentPage } from './ui/instrumentPage';

// The Ouroboros effect on its own page. It listens to a mixer bus in another tab and sends the result back. Its output is published as "Ouroboros".
const clock = new MidiClock();
const patch = Patch.ouroboros();
const engine = new AudioEngine(patch);
const ouroboros = patch.device<OuroborosFx>('ouroboros');

const page = mountInstrumentPage({
  id: 'ouroboros', patch, engine, clock, self: '/ouroboros/', panel: renderOuroPanel(ouroboros, 'ouroboros', engine),
  ports: [{ device: 'ouroboros', jack: 'out', name: 'Ouroboros' }],
  inputs: [{ device: 'ouroboros', jack: 'in', label: 'Input', defaultPort: 'Mixer: Bus C' }],
  onMidi: () => {},
});

// Dev-only handle for poking at the engine from the browser console.
if (import.meta.env.DEV) Object.assign(window, { __ouroboros: { engine, patch, pcm: page.pcm, midi: page.handleMidiBytes } });
