import './ui/style.css';
import './ui/lynch.css';
import './ui/df2.css';
import { AudioEngine } from './audio/engine';
import type { FilterBox } from './domain/devices/filterBox';
import type { LynchSynth } from './domain/devices/lynchSynth';
import { MidiClock } from './domain/midi/clock';
import { Patch } from './domain/patch/patch';
import { renderDfPanel } from './ui/dfPanel';
import { loadSavedPatches } from './ui/dfStorage';
import { mountInstrumentPage } from './ui/instrumentPage';
import { renderLynchPanel } from './ui/lynchPanel';

// The MOA-DF2 page: the Lynch 106 on top, feeding the filter box below (left to filter I, right to filter II). The
// filter box's output is also published on the audio bus as "MOA-DF2", where the mixer takes it into a stereo input.
const clock = new MidiClock();
const patch = Patch.df2(clock);
const engine = new AudioEngine(patch);
const lynch = patch.device<LynchSynth>('lynch');
const box = patch.device<FilterBox>('box');

// The held keys are the box's gate: envelopes set to KEYS open while any key is down (or held).
lynch.onNoteChange(() => box.setKeys(lynch.heldNotes.length > 0));

const patchbay = document.createElement('div');
patchbay.className = 'df-patchbay';
patchbay.innerHTML = '<span><i></i>Lynch L &rarr; Filter I</span><span><i></i>Lynch R &rarr; Filter II</span><span><i></i>Keys &rarr; Gate</span>';

loadSavedPatches(box);
box.loadSlot(box.currentSlot);

const page = mountInstrumentPage({
  id: 'df2', patch, engine, clock, self: '/df2/', panel: [renderLynchPanel(lynch), patchbay, renderDfPanel(box, engine)],
  ports: [{ device: 'box', jack: 'out', name: 'MOA-DF2' }],
  onMidi: (event) => lynch.handleMidi(event),
});

// Dev-only handle for poking at the engine from the browser console.
if (import.meta.env.DEV) Object.assign(window, { __df2: { engine, patch, pcm: page.pcm, midi: page.handleMidiBytes } });
