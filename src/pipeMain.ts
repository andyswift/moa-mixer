import './ui/style.css';
import './ui/pipe.css';
import { AudioEngine } from './audio/engine';
import type { PipeSynth } from './domain/devices/pipeSynth';
import type { SpringReverb } from './domain/devices/springReverb';
import { MidiClock } from './domain/midi/clock';
import { Patch } from './domain/patch/patch';
import { mountInstrumentPage } from './ui/instrumentPage';
import { renderPipePanel } from './ui/pipePanel';

// The MOA-PIPE page: the pipe synth into a spring reverb, on its own patch, separate from the mixer. The spring's
// output is also published on the audio bus as "MOA-PIPE", where the mixer page takes it into a stereo input strip.
const clock = new MidiClock();
const patch = Patch.pipe(clock);
const engine = new AudioEngine(patch);
const pipe = patch.device<PipeSynth>('pipe');
const spring = patch.device<SpringReverb>('spring');

const page = mountInstrumentPage({
  engine, clock, self: '/pipe/', panel: renderPipePanel(pipe, spring, engine),
  ports: [{ device: 'spring', jack: 'out', name: 'MOA-PIPE' }],
  onMidi: (event) => pipe.handleMidi(event),
});

// Dev-only handle for poking at the engine from the browser console.
if (import.meta.env.DEV) Object.assign(window, { __pipe: { engine, patch, pcm: page.pcm, midi: page.handleMidiBytes } });
