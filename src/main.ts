import './ui/style.css';
import { AudioEngine } from './audio/engine';
import type { DrumMachine } from './domain/devices/drumMachine';
import type { Synthesizer } from './domain/devices/synthesizer';
import { MidiClock } from './domain/midi/clock';
import { parseMidi } from './domain/midi/events';
import { MidiMonitor } from './domain/midi/monitor';
import { WebMidi } from './midi/webMidi';
import { Patch } from './domain/patch/patch';
import { renderMidiStrip } from './ui/midiStrip';
import { mountKeyboard } from './ui/keyboard';
import type { Mixer } from './domain/devices/mixer';
import { renderDrumPanel } from './ui/drumPanel';
import { renderMixerPanel } from './ui/mixerPanel';
import { renderSynthPanel } from './ui/synthPanel';

const clock = new MidiClock();
const monitor = new MidiMonitor();
const midi = new WebMidi();
const patch = Patch.default(clock);
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

const synth = patch.device<Synthesizer>('synth');
const drums = patch.device<DrumMachine>('drums');

/** One entry point for every MIDI message, whether it came from a device or the dev console. */
function handleMidiBytes(data: ArrayLike<number>, time = performance.now()): void {
  const event = parseMidi(data);
  if (!event) return;
  clock.handle(event, time);
  monitor.record(event, time);
  synth.handleMidi(event);
  drums.handleMidi(event);
}
midi.onMessage = (data, timeStamp) => handleMidiBytes(data, timeStamp);
void midi.connectIfPermitted();

app.append(renderMidiStrip(midi, clock, monitor), renderSynthPanel(synth, start));

const hint = document.createElement('p');
hint.className = 'hint';
hint.textContent = 'Play with the keys a w s e d f t g y h u j k, or click the keyboard. Drums: click a pad (Shift soft, Alt hard) or press 1-6. Double-click a fader to reset it.';
app.append(hint, mountKeyboard(synth));

app.append(renderDrumPanel(drums, 'drums', engine));

app.append(renderMixerPanel(patch.device<Mixer>('mixer'), 'mixer', engine, ['Synth', 'Kick', 'Snare', 'Clap', 'Closed Hat', 'Open Hat', 'Ride']));

// Dev-only handle for poking at the engine from the browser console.
if (import.meta.env.DEV) Object.assign(window, { __mixer: { engine, patch, midi: handleMidiBytes } });
