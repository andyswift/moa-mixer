import './ui/style.css';
import './ui/rig.css';
import { AudioEngine } from './audio/engine';
import type { RigSynth } from './domain/devices/rigSynth';
import { MidiClock } from './domain/midi/clock';
import { Patch } from './domain/patch/patch';
import { mountInstrumentPage } from './ui/instrumentPage';
import { mountKeyboardBed } from './ui/keyboard';
import { renderRigPanel } from './ui/rigPanel';
import { renderRigSeqPanel } from './ui/rigSeqPanel';

// The MOA-RIG page: the multitimbral synth on its own patch, separate from the mixer. Its audio is also published on
// the audio bus as "MOA-RIG", where the mixer page can take it into a stereo input strip.
const clock = new MidiClock();
const patch = Patch.rig();
const rig = patch.device<RigSynth>('rig');

const wrap = document.createElement('div');
wrap.className = 'rig-wrap';
const engine = new AudioEngine(patch);
wrap.append(renderRigPanel(rig), mountKeyboardBed(rig), renderRigSeqPanel(rig, () => engine.currentTime));

// The sequencer sends ahead on the audio clock; a live-played note is placed by when it was heard.
const SCHEDULE_MS = 25;
rig.now = () => engine.currentTime;
rig.latency = () => engine.context ? engine.context.outputLatency || engine.context.baseLatency || 0 : 0;
setInterval(() => rig.seq.schedule(engine.currentTime), SCHEDULE_MS);
const page = mountInstrumentPage({
  id: 'rig', patch, engine, clock, self: '/rig/', panel: wrap,
  ports: [{ device: 'rig', jack: 'out', name: 'MOA-RIG' }],
  onMidi: (event) => rig.handleMidi(event),
});

// Dev-only handle for poking at the engine from the browser console.
if (import.meta.env.DEV) Object.assign(window, { __rig: { engine, patch, rig, pcm: page.pcm, midi: page.handleMidiBytes } });
