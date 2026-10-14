import './ui/style.css';
import './ui/lynch.css';
import { AudioEngine } from './audio/engine';
import type { LynchSynth } from './domain/devices/lynchSynth';
import { MidiClock } from './domain/midi/clock';
import { parseMidi } from './domain/midi/events';
import { MidiMonitor } from './domain/midi/monitor';
import { Patch } from './domain/patch/patch';
import { WebMidi } from './midi/webMidi';
import { renderLynchPanel } from './ui/lynchPanel';
import { renderMidiStrip } from './ui/midiStrip';

// The Lynch 106 page: one synth on its own patch, separate from the mixer.
const clock = new MidiClock();
const monitor = new MidiMonitor();
const midi = new WebMidi();
const patch = Patch.lynch(clock);
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

const nav = document.createElement('nav');
nav.className = 'pipe-nav';
nav.innerHTML = '<a href="/mixer/">The mixer</a><a href="/pipe/">MOA-PIPE</a><a href="/">moaswift.no</a>';

app.append(nav, renderMidiStrip(midi, clock, monitor, start), renderLynchPanel(lynch));

// Dev-only handle for poking at the engine from the browser console.
if (import.meta.env.DEV) Object.assign(window, { __lynch: { engine, patch, midi: handleMidiBytes } });
