import './ui/style.css';
import { AudioEngine } from './audio/engine';
import { type InputHost, MixerInputs } from './audio/mixerInputs';
import { FX_JITTER_MS, PcmBus } from './audio/pcmBus';
import type { BusCompFx } from './domain/devices/busComp';
import type { NumberControl } from './domain/devices/controls';
import type { GranularFx } from './domain/devices/granular';
import type { Mixer } from './domain/devices/mixer';
import type { OuroborosFx } from './domain/devices/ouroboros';
import type { DelayFx, ReverbFx } from './domain/devices/sendFx';
import { MidiClock } from './domain/midi/clock';
import { parseMidi } from './domain/midi/events';
import { MidiMonitor } from './domain/midi/monitor';
import { Patch } from './domain/patch/patch';
import { MidiBus } from './midi/bus';
import { WebMidi } from './midi/webMidi';
import { announceStatus, applySettings, captureSettings, listenForControl } from './songs/control';
import { applyEmbedMode } from './ui/embed';
import { renderBusCompPanel } from './ui/busCompPanel';
import { renderFxPanel } from './ui/fxPanel';
import { renderGranularPanel } from './ui/granularPanel';
import { renderPageNav } from './ui/instrumentPage';
import { renderMidiStrip } from './ui/midiStrip';
import { renderMixerPanel } from './ui/mixerPanel';
import { renderOuroPanel } from './ui/ouroborosPanel';

// The mixer page: the mixer and its effects only. The instruments (MOA-1, MOA-6, the drum machine) are pages of their
// own; their audio arrives over the audio bus into the channel strips.
applyEmbedMode();
const clock = new MidiClock();
const monitor = new MidiMonitor();
const midi = new WebMidi();
const patch = Patch.mixerRack();
const engine = new AudioEngine(patch);
const app = document.querySelector<HTMLDivElement>('#app')!;

// Each channel starts on the port its instrument page publishes (a choice made in the strip is remembered instead).
const CHANNEL_PORTS = ['Synth', 'Poly', 'Drums: Kick', 'Drums: Snare', 'Drums: Clap', 'Drums: Closed Hat', 'Drums: Open Hat', 'Drums: Ride'];
// The four stereo inputs take the other synths, which have a stereo sound of their own.
const LINE_PORTS = ['Lynch 106', 'MOA-DUO', 'MOA-DF2', 'MOA-PIPE'];
// The mixer's sends and buses are published as ports, for effect pages to take (a port only does work while some
// page listens to it). The return strips can listen to effect pages' output instead of in-page effects.
const SEND_PORTS: [jack: string, name: string][] = [
  ...[1, 2, 3, 4, 5, 6].map((k): [string, string] => [`aux${k}`, `Mixer: Aux ${k}`]),
  ['busB', 'Mixer: Bus B'], ['busC', 'Mixer: Bus C'], ['key', 'Mixer: Key'],
];
const RETURN_JACKS = ['ret1', 'ret2', 'ret3', 'ret4', 'ret5'];
const pcm = new PcmBus();
const host: InputHost = {
  ports: () => pcm.ports,
  hasInternal: (jack) => patch.connections.some((c) => c.to.device === 'mixer' && c.to.jack === jack),
  setInternal: (jack, on) => {
    const cable = patch.connections.find((c) => c.to.device === 'mixer' && c.to.jack === jack);
    if (cable) engine.setCable(cable.from, cable.to, on);
  },
  attach: async (jack, portId) => {
    const ctx = engine.context;
    const target = engine.jackNode('mixer', 'in', jack);
    if (!ctx || !target) throw new Error('Audio is not running');
    const received = await pcm.subscribe(ctx, portId, jack.startsWith('ret') ? FX_JITTER_MS : undefined);
    if (jack.startsWith('line') || jack.startsWith('ret')) {
      received.node.connect(target); // stereo strips take the pair as it is
      return () => received.close();
    }
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
const inputs = new MixerInputs(
  host,
  [...CHANNEL_PORTS.map((_, i) => `ch${i + 1}`), ...LINE_PORTS.map((_, i) => `line${i + 1}`), ...RETURN_JACKS],
  Object.fromEntries([...CHANNEL_PORTS.map((name, i) => [`ch${i + 1}`, name]), ...LINE_PORTS.map((name, i) => [`line${i + 1}`, name])]),
);
pcm.onChange(() => inputs.reconcile());
// While an effect page feeds a return, the dry channels wait for it (the round trip is about 40 ms), so insert effects
// on the buses line up with the dry signal.
const FX_ROUND_TRIP_MS = 40;
inputs.onChange(() => {
  const live = RETURN_JACKS.some((j) => inputs.status(j) === 'live');
  (patch.device<Mixer>('mixer').control('comp.ms') as NumberControl).set(live ? FX_ROUND_TRIP_MS : 0);
});

let started = false;
const startAudio = async () => {
  if (started) return;
  started = true;
  await engine.start();
  const ctx = engine.context;
  if (ctx) {
    for (const [jack, name] of SEND_PORTS) {
      const node = engine.jackNode('mixer', 'out', jack);
      if (node) await pcm.publish(ctx, node, name);
    }
  }
  inputs.start();
  start.textContent = 'Audio running';
  start.disabled = true;
  announceStatus('mixer', 'started');
};
const start = document.createElement('button');
start.className = 'start';
start.textContent = 'Start audio';
start.addEventListener('click', () => void startAudio());

// The records page conducts this page too: it starts the audio, sets the mixer and effects, and chooses the inputs.
listenForControl('mixer', (m) => {
  if (m.type === 'start') void startAudio();
  else {
    if (m.settings) applySettings(patch, m.settings);
    for (const [jack, selection] of Object.entries(m.inputs ?? {})) if (inputs.jacks.includes(jack)) inputs.setSelection(jack, selection, false);
  }
});
announceStatus('mixer', 'loaded');

const granular = patch.device<GranularFx>('granular');

/** One entry point for every MIDI message, whether it came from a device or the dev console. */
function handleMidiBytes(data: ArrayLike<number>, time = performance.now()): void {
  const event = parseMidi(data);
  if (!event) return;
  clock.handle(event, time);
  monitor.record(event, time);
  granular.handleMidi(event);
}
midi.onMessage = (data, timeStamp) => handleMidiBytes(data, timeStamp);
void midi.connectIfPermitted();

// MIDI from the sequencer page in another tab arrives over the bus, like a MIDI input.
const bus = new MidiBus();
bus.onMessage = (data, timeStamp) => handleMidiBytes(data, timeStamp);

app.append(renderPageNav('/mixer/'), renderMidiStrip(midi, clock, monitor, start, bus));

app.append(renderFxPanel(patch.device<ReverbFx>('reverb'), patch.device<DelayFx>('delay')));

app.append(renderOuroPanel(patch.device<OuroborosFx>('ouroboros'), 'ouroboros', engine));

app.append(renderBusCompPanel(patch.device<BusCompFx>('buscomp'), patch.device<Mixer>('mixer'), 'buscomp', engine, [
  { value: 'off', label: 'Off' }, { value: '3', label: 'Kick' }, { value: '4', label: 'Snare' }, { value: '5', label: 'Clap' },
  { value: '6', label: 'CL Hat' }, { value: '7', label: 'OP Hat' }, { value: '8', label: 'Ride' }, { value: '1', label: 'Synth' },
  { value: '2', label: 'Poly' },
]));

app.append(renderGranularPanel(granular, 'granular', engine));

app.append(renderMixerPanel(patch.device<Mixer>('mixer'), 'mixer', engine, ['Synth', 'Poly', 'Kick', 'Snare', 'Clap', 'Closed Hat', 'Open Hat', 'Ride'], ['Reverb', 'Delay', 'Ouroboros', 'Bus Comp', 'Granular'], { B: 'to Bus Comp', C: 'to Ouroboros' }, inputs, ['Lynch 106', 'DUO', 'DF2', 'Pipe']));

// Dev-only handle for poking at the engine from the browser console.
if (import.meta.env.DEV) Object.assign(window, { __mixer: { engine, patch, pcm, midi: handleMidiBytes }, __capture: () => captureSettings(patch) });
