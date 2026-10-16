import './ui/style.css';
import './ui/m2600.css';
import { AudioEngine } from './audio/engine';
import { M2600Synth } from './domain/devices/m2600Synth';
import { MidiClock } from './domain/midi/clock';
import { Patch } from './domain/patch/patch';
import { mountInstrumentPage } from './ui/instrumentPage';
import { mountKeyboardBed } from './ui/keyboard';
import { renderM2600Panel } from './ui/m2600Panel';
import { loadSavedPatches } from './ui/m2600Storage';

// The MOA-2600 page: one synth on its own patch, separate from the mixer. Its audio is also published on the audio
// bus as "MOA-2600", where the mixer page can take it into a stereo input strip.
const clock = new MidiClock();
const synth = new M2600Synth('MOA-2600');
const patch = new Patch().add('m2600', synth).setOutput('m2600', 'out');
const engine = new AudioEngine(patch);
loadSavedPatches(synth);
synth.loadSlot(synth.currentSlot);

const wrap = document.createElement('div');
wrap.className = 'm26-wrap';
wrap.append(renderM2600Panel(synth, engine), mountKeyboardBed(synth));

const page = mountInstrumentPage({
  id: 'm2600', patch, engine, clock, self: '/2600/', panel: wrap,
  ports: [{ device: 'm2600', jack: 'out', name: 'MOA-2600' }],
  onMidi: (event) => synth.handleMidi(event),
});

// Dev-only handle for poking at the engine from the browser console.
if (import.meta.env.DEV) Object.assign(window, { __m2600: { engine, patch, synth, pcm: page.pcm, midi: page.handleMidiBytes } });
