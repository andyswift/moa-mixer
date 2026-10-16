import './ui/style.css';
import { AudioEngine } from './audio/engine';
import type { GranularFx } from './domain/devices/granular';
import { MidiClock } from './domain/midi/clock';
import { Patch } from './domain/patch/patch';
import { renderGranularPanel } from './ui/granularPanel';
import { mountInstrumentPage } from './ui/instrumentPage';

// The granular effect on its own page. It listens to the mixer in another tab and sends clouds back. Its output is published as "Granular".
const clock = new MidiClock();
const patch = Patch.granular();
const engine = new AudioEngine(patch);
const granular = patch.device<GranularFx>('granular');

const page = mountInstrumentPage({
  id: 'granular', patch, engine, clock, self: '/granular/', panel: renderGranularPanel(granular, 'granular', engine),
  ports: [{ device: 'granular', jack: 'out', name: 'Granular' }],
  inputs: [{ device: 'granular', jack: 'in', label: 'Input', defaultPort: 'Mixer: Aux 3', mono: true }],
  onMidi: (event) => granular.handleMidi(event),
});

// Dev-only handle for poking at the engine from the browser console.
if (import.meta.env.DEV) Object.assign(window, { __granular: { engine, patch, pcm: page.pcm, midi: page.handleMidiBytes } });
