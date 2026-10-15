import './ui/style.css';
import { AudioEngine } from './audio/engine';
import type { PolySynth } from './domain/devices/polySynth';
import { MidiClock } from './domain/midi/clock';
import { Patch } from './domain/patch/patch';
import { mountInstrumentPage } from './ui/instrumentPage';
import { renderPolyPanel } from './ui/polyPanel';

// The poly synth on its own page, published on the audio bus as "Poly".
const clock = new MidiClock();
const patch = Patch.poly(clock);
const engine = new AudioEngine(patch);
const poly = patch.device<PolySynth>('poly');

const page = mountInstrumentPage({
  engine, clock, self: '/poly/', panel: renderPolyPanel(poly),
  ports: [{ device: 'poly', jack: 'out', name: 'Poly' }],
  onMidi: (event) => poly.handleMidi(event),
});

// Dev-only handle for poking at the engine from the browser console.
if (import.meta.env.DEV) Object.assign(window, { __poly: { engine, patch, pcm: page.pcm, midi: page.handleMidiBytes } });
