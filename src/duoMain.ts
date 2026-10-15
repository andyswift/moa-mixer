import './ui/style.css';
import './ui/lynch.css';
import './ui/duo.css';
import { AudioEngine } from './audio/engine';
import type { DuoSynth } from './domain/devices/duoSynth';
import { MidiClock } from './domain/midi/clock';
import { Patch } from './domain/patch/patch';
import { renderDuoPanel } from './ui/duoPanel';
import { loadSavedPatches } from './ui/duoStorage';
import { mountInstrumentPage } from './ui/instrumentPage';
import { mountKeyboardBed } from './ui/keyboard';

// The MOA-DUO page: one synth on its own patch, separate from the mixer. Its audio is also published on the audio
// bus as "MOA-DUO", where the mixer page takes it into a stereo input strip.
const clock = new MidiClock();
const patch = Patch.duo();
const engine = new AudioEngine(patch);
const duo = patch.device<DuoSynth>('duo');
loadSavedPatches(duo);
duo.loadSlot(duo.currentSlot);

const wrap = document.createElement('div');
wrap.className = 'duo-wrap';
wrap.append(renderDuoPanel(duo, engine), mountKeyboardBed(duo));

const page = mountInstrumentPage({
  engine, clock, self: '/duo/', panel: wrap,
  ports: [{ device: 'duo', jack: 'out', name: 'MOA-DUO' }],
  onMidi: (event) => duo.handleMidi(event),
});

// Dev-only handle for poking at the engine from the browser console.
if (import.meta.env.DEV) Object.assign(window, { __duo: { engine, patch, pcm: page.pcm, midi: page.handleMidiBytes } });
