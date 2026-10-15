import './ui/style.css';
import './ui/lynch.css';
import { AudioEngine } from './audio/engine';
import type { LynchSynth } from './domain/devices/lynchSynth';
import { MidiClock } from './domain/midi/clock';
import { Patch } from './domain/patch/patch';
import { mountInstrumentPage } from './ui/instrumentPage';
import { renderLynchPanel } from './ui/lynchPanel';

// The Lynch 106 page: one synth on its own patch, separate from the mixer. Its audio is also published on the audio
// bus as "Lynch 106", where the mixer page takes it into a stereo input strip.
const clock = new MidiClock();
const patch = Patch.lynch(clock);
const engine = new AudioEngine(patch);
const lynch = patch.device<LynchSynth>('lynch');

const page = mountInstrumentPage({
  id: 'lynch', patch, engine, clock, self: '/lynch/', panel: renderLynchPanel(lynch),
  ports: [{ device: 'lynch', jack: 'out', name: 'Lynch 106' }],
  onMidi: (event) => lynch.handleMidi(event),
});

// Dev-only handle for poking at the engine from the browser console.
if (import.meta.env.DEV) Object.assign(window, { __lynch: { engine, patch, pcm: page.pcm, midi: page.handleMidiBytes } });
