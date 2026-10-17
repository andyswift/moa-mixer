import './ui/style.css';
import { AudioEngine } from './audio/engine';
import type { BusCompFx } from './domain/devices/busComp';
import { MidiClock } from './domain/midi/clock';
import { Patch } from './domain/patch/patch';
import { renderBusCompPanel } from './ui/busCompPanel';
import { mountInstrumentPage } from './ui/instrumentPage';

// The bus compressor and ducker on its own page. It listens to the mixer in another tab; the key is chosen on the mixer. Its output is published as "Bus Comp".
const clock = new MidiClock();
const patch = Patch.buscomp();
const engine = new AudioEngine(patch);
const buscomp = patch.device<BusCompFx>('buscomp');

const page = mountInstrumentPage({
  id: 'buscomp', patch, engine, clock, self: '/buscomp/', panel: renderBusCompPanel(buscomp, undefined, 'buscomp', engine, []),
  ports: [{ device: 'buscomp', jack: 'out', name: 'Bus Comp' }],
  inputs: [
    { device: 'buscomp', jack: 'in', label: 'Input', defaultPort: 'Mixer: Bus B' },
    { device: 'buscomp', jack: 'key', label: 'Key', defaultPort: 'Mixer: Key', mono: true },
  ],
  onMidi: () => {},
});

// Dev-only handle for poking at the engine from the browser console.
if (import.meta.env.DEV) Object.assign(window, { __buscomp: { engine, patch, pcm: page.pcm, midi: page.handleMidiBytes } });
