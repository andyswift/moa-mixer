import './ui/style.css';
import './ui/rig.css';
import { AudioEngine } from './audio/engine';
import type { RigSynth } from './domain/devices/rigSynth';
import { MidiClock } from './domain/midi/clock';
import { Patch } from './domain/patch/patch';
import { mountInstrumentPage } from './ui/instrumentPage';
import { mountKeyboardBed } from './ui/keyboard';
import { renderRigPanel } from './ui/rigPanel';

// The MOA-RIG page: the multitimbral synth on its own patch, separate from the mixer. Its audio is also published on
// the audio bus as "MOA-RIG", where the mixer page can take it into a stereo input strip.
const clock = new MidiClock();
const patch = Patch.rig();
const rig = patch.device<RigSynth>('rig');

const wrap = document.createElement('div');
wrap.className = 'rig-wrap';
wrap.append(renderRigPanel(rig), mountKeyboardBed(rig));

const engine = new AudioEngine(patch);
const page = mountInstrumentPage({
  id: 'rig', patch, engine, clock, self: '/rig/', panel: wrap,
  ports: [{ device: 'rig', jack: 'out', name: 'MOA-RIG' }],
  onMidi: (event) => rig.handleMidi(event),
});

// Dev-only handle for poking at the engine from the browser console.
if (import.meta.env.DEV) Object.assign(window, { __rig: { engine, patch, rig, pcm: page.pcm, midi: page.handleMidiBytes } });
