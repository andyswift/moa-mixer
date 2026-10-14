import './ui/style.css';
import './ui/lynch.css';
import './ui/df2.css';
import { AudioEngine } from './audio/engine';
import type { FilterBox } from './domain/devices/filterBox';
import type { LynchSynth } from './domain/devices/lynchSynth';
import { MidiClock } from './domain/midi/clock';
import { parseMidi } from './domain/midi/events';
import { MidiMonitor } from './domain/midi/monitor';
import { Patch } from './domain/patch/patch';
import { MidiBus } from './midi/bus';
import { WebMidi } from './midi/webMidi';
import { renderDfPanel } from './ui/dfPanel';
import { loadSavedPatches } from './ui/dfStorage';
import { renderLynchPanel } from './ui/lynchPanel';
import { renderMidiStrip } from './ui/midiStrip';

// The MOA-DF2 page: the Lynch 106 on top, feeding the filter box below (left to filter I, right to filter II).
const clock = new MidiClock();
const monitor = new MidiMonitor();
const midi = new WebMidi();
const patch = Patch.df2(clock);
const engine = new AudioEngine(patch);
const app = document.querySelector<HTMLDivElement>('#app')!;

const start = document.createElement('button');
start.className = 'start';
start.textContent = 'Start audio';
start.addEventListener('click', async () => {
  await engine.start();
  start.textContent = 'Audio running';
  start.disabled = true;
});

const lynch = patch.device<LynchSynth>('lynch');
const box = patch.device<FilterBox>('box');

// The held keys are the box's gate: envelopes set to KEYS open while any key is down (or held).
lynch.onNoteChange(() => box.setKeys(lynch.heldNotes.length > 0));

/** One entry point for every MIDI message, whether it came from a device or the dev console. */
function handleMidiBytes(data: ArrayLike<number>, time = performance.now()): void {
  const event = parseMidi(data);
  if (!event) return;
  clock.handle(event, time);
  monitor.record(event, time);
  lynch.handleMidi(event);
}
midi.onMessage = (data, timeStamp) => handleMidiBytes(data, timeStamp);
void midi.connectIfPermitted();

// MIDI from the sequencer page in another tab arrives over the bus, like a MIDI input.
const bus = new MidiBus();
bus.onMessage = (data, timeStamp) => handleMidiBytes(data, timeStamp);

const nav = document.createElement('nav');
nav.className = 'pipe-nav';
nav.innerHTML = '<a href="/lynch/">Lynch 106</a><a href="/mixer/">The mixer</a><a href="/seq/">MOA-SEQ</a><a href="/pipe/">MOA-PIPE</a><a href="/">moaswift.no</a>';

const patchbay = document.createElement('div');
patchbay.className = 'df-patchbay';
patchbay.innerHTML = '<span><i></i>Lynch L &rarr; Filter I</span><span><i></i>Lynch R &rarr; Filter II</span><span><i></i>Keys &rarr; Gate</span>';

loadSavedPatches(box);
box.loadSlot(box.currentSlot);

app.append(nav, renderMidiStrip(midi, clock, monitor, start, bus), renderLynchPanel(lynch), patchbay, renderDfPanel(box, engine));

// Dev-only handle for poking at the engine from the browser console.
if (import.meta.env.DEV) Object.assign(window, { __df2: { engine, patch, midi: handleMidiBytes } });
