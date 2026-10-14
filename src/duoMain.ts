import './ui/style.css';
import './ui/lynch.css';
import './ui/duo.css';
import { AudioEngine } from './audio/engine';
import type { DuoSynth } from './domain/devices/duoSynth';
import { MidiClock } from './domain/midi/clock';
import { parseMidi } from './domain/midi/events';
import { MidiMonitor } from './domain/midi/monitor';
import { Patch } from './domain/patch/patch';
import { MidiBus } from './midi/bus';
import { WebMidi } from './midi/webMidi';
import { renderDuoPanel } from './ui/duoPanel';
import { loadSavedPatches } from './ui/duoStorage';
import { mountKeyboardBed } from './ui/keyboard';
import { renderMidiStrip } from './ui/midiStrip';

// The MOA-DUO page: one synth on its own patch, separate from the mixer.
const clock = new MidiClock();
const monitor = new MidiMonitor();
const midi = new WebMidi();
const patch = Patch.duo();
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

const duo = patch.device<DuoSynth>('duo');
loadSavedPatches(duo);
duo.loadSlot(duo.currentSlot);

/** One entry point for every MIDI message, whether it came from a device or the dev console (or, later, a sequencer). */
function handleMidiBytes(data: ArrayLike<number>, time = performance.now()): void {
  const event = parseMidi(data);
  if (!event) return;
  clock.handle(event, time);
  monitor.record(event, time);
  duo.handleMidi(event);
}
midi.onMessage = (data, timeStamp) => handleMidiBytes(data, timeStamp);
void midi.connectIfPermitted();

// MIDI from the sequencer page in another tab arrives over the bus, like a MIDI input.
const bus = new MidiBus();
bus.onMessage = (data, timeStamp) => handleMidiBytes(data, timeStamp);

const nav = document.createElement('nav');
nav.className = 'pipe-nav';
nav.innerHTML = '<a href="/lynch/">Lynch 106</a><a href="/df2/">MOA-DF2</a><a href="/seq/">MOA-SEQ</a><a href="/mixer/">The mixer</a><a href="/pipe/">MOA-PIPE</a><a href="/">moaswift.no</a>';

const wrap = document.createElement('div');
wrap.className = 'duo-wrap';
wrap.append(renderDuoPanel(duo, engine), mountKeyboardBed(duo));

app.append(nav, renderMidiStrip(midi, clock, monitor, start, bus), wrap);

// Dev-only handle for poking at the engine from the browser console.
if (import.meta.env.DEV) Object.assign(window, { __duo: { engine, patch, midi: handleMidiBytes } });
