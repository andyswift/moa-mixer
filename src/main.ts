import './ui/style.css';
import { AudioEngine } from './audio/engine';
import type { BusCompFx } from './domain/devices/busComp';
import type { DrumMachine } from './domain/devices/drumMachine';
import type { GranularFx } from './domain/devices/granular';
import type { OuroborosFx } from './domain/devices/ouroboros';
import type { PolySynth } from './domain/devices/polySynth';
import type { DelayFx, ReverbFx } from './domain/devices/sendFx';
import { DrumSequencer } from './domain/devices/drumSequencer';
import type { Synthesizer } from './domain/devices/synthesizer';
import { MidiClock } from './domain/midi/clock';
import { parseMidi } from './domain/midi/events';
import { MidiMonitor } from './domain/midi/monitor';
import { MixerInputs, type InputHost } from './audio/mixerInputs';
import { PcmBus } from './audio/pcmBus';
import { MidiBus } from './midi/bus';
import { WebMidi } from './midi/webMidi';
import { Patch } from './domain/patch/patch';
import { renderMidiStrip } from './ui/midiStrip';
import { renderBusCompPanel } from './ui/busCompPanel';
import { renderOuroPanel } from './ui/ouroborosPanel';
import { renderPolyPanel } from './ui/polyPanel';
import type { Mixer } from './domain/devices/mixer';
import { renderDrumPanel } from './ui/drumPanel';
import { renderFxPanel } from './ui/fxPanel';
import { renderGranularPanel } from './ui/granularPanel';
import { renderMixerPanel } from './ui/mixerPanel';
import { renderSynthPanel } from './ui/synthPanel';

const clock = new MidiClock();
const monitor = new MidiMonitor();
const midi = new WebMidi();
const patch = Patch.default(clock);
const engine = new AudioEngine(patch);
const app = document.querySelector<HTMLDivElement>('#app')!;

// Audio from instrument pages in other tabs arrives over the audio bus into the channel strips.
const pcm = new PcmBus();
const host: InputHost = {
  ports: () => pcm.ports,
  setInternal: (jack, on) => {
    const cable = patch.connections.find((c) => c.to.device === 'mixer' && c.to.jack === jack);
    if (cable) engine.setCable(cable.from, cable.to, on);
  },
  attach: async (jack, portId) => {
    const ctx = engine.context;
    const target = engine.jackNode('mixer', 'in', jack);
    if (!ctx || !target) throw new Error('Audio is not running');
    const received = await pcm.subscribe(ctx, portId);
    // Channel strips are mono (the pan stage treats a stereo input differently), so fold the pair down.
    const mono = ctx.createGain();
    mono.channelCount = 1;
    mono.channelCountMode = 'explicit';
    received.node.connect(mono).connect(target);
    return () => {
      mono.disconnect();
      received.close();
    };
  },
};
const inputs = new MixerInputs(host, Array.from({ length: 8 }, (_, i) => `ch${i + 1}`));
pcm.onChange(() => inputs.reconcile());

const start = document.createElement('button');
start.className = 'start';
start.textContent = 'Start audio';
start.addEventListener('click', async () => {
  await engine.start();
  inputs.start();
  start.textContent = 'Audio running';
  start.disabled = true;
});

const synth = patch.device<Synthesizer>('synth');
const poly = patch.device<PolySynth>('poly');
const drums = patch.device<DrumMachine>('drums');
const granular = patch.device<GranularFx>('granular');
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
  granular.handleMidi(event);
  drums.handleMidi(event);
  sequencer.handleMidi(event);
}
midi.onMessage = (data, timeStamp) => handleMidiBytes(data, timeStamp);
void midi.connectIfPermitted();

// MIDI from the sequencer page in another tab arrives over the bus, like a MIDI input.
const bus = new MidiBus();
bus.onMessage = (data, timeStamp) => handleMidiBytes(data, timeStamp);

app.append(renderMidiStrip(midi, clock, monitor, start, bus), renderSynthPanel(synth));

app.append(renderPolyPanel(poly));

app.append(renderDrumPanel(drums, sequencer, 'drums', engine));

app.append(renderFxPanel(patch.device<ReverbFx>('reverb'), patch.device<DelayFx>('delay')));

app.append(renderOuroPanel(patch.device<OuroborosFx>('ouroboros'), 'ouroboros', engine));

app.append(renderBusCompPanel(patch.device<BusCompFx>('buscomp'), patch.device<Mixer>('mixer'), 'buscomp', engine, [
  { value: 'off', label: 'Off' }, { value: '3', label: 'Kick' }, { value: '4', label: 'Snare' }, { value: '5', label: 'Clap' },
  { value: '6', label: 'CL Hat' }, { value: '7', label: 'OP Hat' }, { value: '8', label: 'Ride' }, { value: '1', label: 'Synth' },
  { value: '2', label: 'Poly' },
]));

app.append(renderGranularPanel(granular, 'granular', engine));

app.append(renderMixerPanel(patch.device<Mixer>('mixer'), 'mixer', engine, ['Synth', 'Poly', 'Kick', 'Snare', 'Clap', 'Closed Hat', 'Open Hat', 'Ride'], ['Reverb', 'Delay', 'Ouroboros', 'Bus Comp', 'Granular'], { B: 'to Bus Comp', C: 'to Ouroboros' }, inputs));

// Dev-only handle for poking at the engine from the browser console.
if (import.meta.env.DEV) Object.assign(window, { __mixer: { engine, patch, sequencer, midi: handleMidiBytes } });
