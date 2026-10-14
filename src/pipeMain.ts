import './ui/style.css';
import './ui/pipe.css';
import { AudioEngine } from './audio/engine';
import type { PipeSynth } from './domain/devices/pipeSynth';
import type { SpringReverb } from './domain/devices/springReverb';
import { MidiClock } from './domain/midi/clock';
import { parseMidi } from './domain/midi/events';
import { MidiMonitor } from './domain/midi/monitor';
import { Patch } from './domain/patch/patch';
import { MidiBus } from './midi/bus';
import { WebMidi } from './midi/webMidi';
import { renderMidiStrip } from './ui/midiStrip';
import { renderPipePanel } from './ui/pipePanel';

// The MOA-PIPE page: the pipe synth into a spring reverb, on its own patch, separate from the mixer.
const clock = new MidiClock();
const monitor = new MidiMonitor();
const midi = new WebMidi();
const patch = Patch.pipe(clock);
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

const pipe = patch.device<PipeSynth>('pipe');
const spring = patch.device<SpringReverb>('spring');

/** One entry point for every MIDI message, whether it came from a device or the dev console. */
function handleMidiBytes(data: ArrayLike<number>, time = performance.now()): void {
  const event = parseMidi(data);
  if (!event) return;
  clock.handle(event, time);
  monitor.record(event, time);
  pipe.handleMidi(event);
}
midi.onMessage = (data, timeStamp) => handleMidiBytes(data, timeStamp);
void midi.connectIfPermitted();

// MIDI from the sequencer page in another tab arrives over the bus, like a MIDI input.
const bus = new MidiBus();
bus.onMessage = (data, timeStamp) => handleMidiBytes(data, timeStamp);

const nav = document.createElement('nav');
nav.className = 'pipe-nav';
nav.innerHTML = '<a href="/mixer/">The mixer</a><a href="/seq/">MOA-SEQ</a><a href="/">moaswift.no</a>';

app.append(nav, renderMidiStrip(midi, clock, monitor, start, bus), renderPipePanel(pipe, spring, engine));

// Dev-only handle for poking at the engine from the browser console.
if (import.meta.env.DEV) Object.assign(window, { __pipe: { engine, patch, midi: handleMidiBytes } });
