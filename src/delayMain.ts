import './ui/style.css';
import { AudioEngine } from './audio/engine';
import type { DelayFx } from './domain/devices/sendFx';
import { MidiClock } from './domain/midi/clock';
import { Patch } from './domain/patch/patch';
import { renderDelayPanel } from './ui/fxPanel';
import { mountInstrumentPage } from './ui/instrumentPage';

// A delay on its own page. It listens to the mixer in another tab and sends the echoes back. Its output is published as "Delay".
const clock = new MidiClock();
const patch = Patch.delay();
const engine = new AudioEngine(patch);
const delay = patch.device<DelayFx>('delay');

const page = mountInstrumentPage({
  id: 'delay', patch, engine, clock, self: '/delay/', panel: renderDelayPanel(delay),
  ports: [{ device: 'delay', jack: 'out', name: 'Delay' }],
  inputs: [{ device: 'delay', jack: 'in', label: 'Input', defaultPort: 'Mixer: Aux 2', mono: true }],
  onMidi: () => {},
});

// Dev-only handle for poking at the engine from the browser console.
if (import.meta.env.DEV) Object.assign(window, { __delay: { engine, patch, pcm: page.pcm, midi: page.handleMidiBytes } });
