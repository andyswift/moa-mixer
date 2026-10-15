import './ui/style.css';
import { AudioEngine } from './audio/engine';
import type { Synthesizer } from './domain/devices/synthesizer';
import { MidiClock } from './domain/midi/clock';
import { Patch } from './domain/patch/patch';
import { mountInstrumentPage } from './ui/instrumentPage';
import { renderSynthPanel } from './ui/synthPanel';

// The mono synth on its own page. Its audio goes to its own speakers and is also published on the audio bus as
// "Synth", where the mixer page can take it into a channel strip.
const clock = new MidiClock();
const patch = Patch.synth(clock);
const engine = new AudioEngine(patch);
const synth = patch.device<Synthesizer>('synth');

const page = mountInstrumentPage({
  id: 'synth', patch, engine, clock, self: '/synth/', panel: renderSynthPanel(synth),
  ports: [{ device: 'synth', jack: 'out', name: 'Synth' }],
  onMidi: (event) => synth.handleMidi(event),
});

// Dev-only handle for poking at the engine from the browser console.
if (import.meta.env.DEV) Object.assign(window, { __synth: { engine, patch, pcm: page.pcm, midi: page.handleMidiBytes } });
