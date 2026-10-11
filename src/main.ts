import './ui/style.css';
import { AudioEngine } from './audio/engine';
import type { DrumMachine } from './domain/devices/drumMachine';
import type { OuroborosFx } from './domain/devices/ouroboros';
import type { PolySynth } from './domain/devices/polySynth';
import type { DelayFx, ReverbFx } from './domain/devices/sendFx';
import { DrumSequencer } from './domain/devices/drumSequencer';
import type { Synthesizer } from './domain/devices/synthesizer';
import { MidiClock } from './domain/midi/clock';
import { parseMidi } from './domain/midi/events';
import { MidiMonitor } from './domain/midi/monitor';
import { WebMidi } from './midi/webMidi';
import { Patch } from './domain/patch/patch';
import { renderMidiStrip } from './ui/midiStrip';
import { renderOuroPanel } from './ui/ouroborosPanel';
import { renderPolyPanel } from './ui/polyPanel';
import type { Mixer } from './domain/devices/mixer';
import { renderDrumPanel } from './ui/drumPanel';
import { renderFxPanel } from './ui/fxPanel';
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
const poly = patch.device<PolySynth>('poly');
const drums = patch.device<DrumMachine>('drums');
const sequencer = new DrumSequencer(drums, clock, () => engine.currentTime);
setInterval(() => sequencer.tick(), 25);

/** One entry point for every MIDI message, whether it came from a device or the dev console. */
function handleMidiBytes(data: ArrayLike<number>, time = performance.now()): void {
  const event = parseMidi(data);
  if (!event) return;
  clock.handle(event, time);
  monitor.record(event, time);
  synth.handleMidi(event);
  poly.handleMidi(event);
  drums.handleMidi(event);
  sequencer.handleMidi(event);
}
midi.onMessage = (data, timeStamp) => handleMidiBytes(data, timeStamp);
void midi.connectIfPermitted();

app.append(renderMidiStrip(midi, clock, monitor, start), renderSynthPanel(synth));

app.append(renderPolyPanel(poly));

app.append(renderDrumPanel(drums, sequencer, 'drums', engine));

app.append(renderFxPanel(patch.device<ReverbFx>('reverb'), patch.device<DelayFx>('delay')));

app.append(renderOuroPanel(patch.device<OuroborosFx>('ouroboros'), 'ouroboros', engine));

app.append(renderMixerPanel(patch.device<Mixer>('mixer'), 'mixer', engine, ['Synth', 'Poly', 'Kick', 'Snare', 'Clap', 'Closed Hat', 'Open Hat', 'Ride'], ['Reverb', 'Delay', 'Ouroboros'], { C: 'to Ouroboros' }));

// Dev-only handle for poking at the engine from the browser console.
if (import.meta.env.DEV) Object.assign(window, { __mixer: { engine, patch, sequencer, midi: handleMidiBytes } });
