import './ui/style.css';
import { AudioEngine } from './audio/engine';
import { MonitorControl } from './audio/monitorControl';
import { PcmBus } from './audio/pcmBus';
import type { Synthesizer } from './domain/devices/synthesizer';
import { MidiClock } from './domain/midi/clock';
import { parseMidi } from './domain/midi/events';
import { MidiMonitor } from './domain/midi/monitor';
import { Patch } from './domain/patch/patch';
import { MidiBus } from './midi/bus';
import { WebMidi } from './midi/webMidi';
import { renderAudioBusBlock } from './ui/audioBusBlock';
import { renderMidiStrip } from './ui/midiStrip';
import { renderSynthPanel } from './ui/synthPanel';

// The mono synth on its own page. Its audio goes to its own speakers and is also published on the audio bus as
// "Synth", where the mixer page can take it into a channel strip.
const clock = new MidiClock();
const monitor = new MidiMonitor();
const midi = new WebMidi();
const patch = Patch.synth(clock);
const engine = new AudioEngine(patch);
const pcm = new PcmBus();
const speakers = new MonitorControl(() => pcm.audience, (on) => engine.setMonitor(on));
pcm.onAudience(() => speakers.update());
const app = document.querySelector<HTMLDivElement>('#app')!;

const start = document.createElement('button');
start.className = 'start';
start.textContent = 'Start audio';
start.addEventListener('click', async () => {
  await engine.start();
  speakers.update();
  const out = engine.jackNode('synth', 'out', 'out');
  if (engine.context && out) await pcm.publish(engine.context, out, 'Synth');
  start.textContent = 'Audio running';
  start.disabled = true;
});

const synth = patch.device<Synthesizer>('synth');

/** One entry point for every MIDI message, whether it came from a device or the dev console. */
function handleMidiBytes(data: ArrayLike<number>, time = performance.now()): void {
  const event = parseMidi(data);
  if (!event) return;
  clock.handle(event, time);
  monitor.record(event, time);
  synth.handleMidi(event);
}
midi.onMessage = (data, timeStamp) => handleMidiBytes(data, timeStamp);
void midi.connectIfPermitted();

// MIDI from the sequencer page in another tab arrives over the bus, like a MIDI input.
const bus = new MidiBus();
bus.onMessage = (data, timeStamp) => handleMidiBytes(data, timeStamp);

const nav = document.createElement('nav');
nav.className = 'pipe-nav';
nav.innerHTML = '<a href="/mixer/">The mixer</a><a href="/seq/">MOA-SEQ</a><a href="/lynch/">Lynch 106</a><a href="/">moaswift.no</a>';

const strip = renderMidiStrip(midi, clock, monitor, start, bus);
strip.append(renderAudioBusBlock(pcm, speakers));
app.append(nav, strip, renderSynthPanel(synth));

// Dev-only handle for poking at the engine from the browser console.
if (import.meta.env.DEV) Object.assign(window, { __synth: { engine, patch, pcm, midi: handleMidiBytes } });
