import type { AudioEngine } from '../audio/engine';
import { MixerInputs } from '../audio/mixerInputs';
import { MonitorControl } from '../audio/monitorControl';
import { EMBEDDED_FX_JITTER_MS, FX_JITTER_MS, PcmBus } from '../audio/pcmBus';
import type { MidiClock } from '../domain/midi/clock';
import { type MidiEvent, parseMidi } from '../domain/midi/events';
import { MidiMonitor } from '../domain/midi/monitor';
import type { Patch } from '../domain/patch/patch';
import { MidiBus } from '../midi/bus';
import { announceStatus, applySettings, captureSettings, listenForControl, type PageId, songChannelName } from '../songs/control';
import { WebMidi } from '../midi/webMidi';
import { renderAudioBusBlock } from './audioBusBlock';
import { renderAudioInputSelect } from './audioInputSelect';
import { applyEmbedMode, isEmbedded } from './embed';
import { renderMidiStrip } from './midiStrip';
import { el } from './widgets';

/** An audio input of an effect page: a device's input jack fed from a published port, chosen in the page's strip. */
export interface PageInput {
  device: string;
  /** The device's input jack, which is also this input's name. */
  jack: string;
  label: string;
  /** The port it listens to until another is chosen (e.g. 'Mixer: Aux 1'). */
  defaultPort: string;
  /** Fold the stereo pair to one channel (for mono effects). */
  mono?: boolean;
}

export interface PagePort {
  device: string;
  jack: string;
  /** The name other tabs see in their input choosers. */
  name: string;
}

const PAGES: [href: string, label: string][] = [
  ['/mixer/', 'The mixer'], ['/synth/', 'MOA-1'], ['/poly/', 'MOA-6'], ['/drums/', 'MOA-DR'], ['/lynch/', 'Lynch 106'],
  ['/duo/', 'MOA-DUO'], ['/2600/', 'MOA-2600'], ['/bass/', 'MOA-BASS'], ['/guitar/', 'MOA-GUITAR'], ['/kit/', 'MOA-KIT'], ['/mpc/', 'MOA-60'], ['/unicorn/', 'MOA-UNICORN'], ['/df2/', 'MOA-DF2'], ['/pipe/', 'MOA-PIPE'], ['/seq/', 'MOA-SEQ'], ['/reverb/', 'Reverb'], ['/delay/', 'Delay'], ['/ouroboros/', 'Ouroboros'], ['/buscomp/', 'Bus Comp'],
  ['/granular/', 'Granular'], ['/records/', 'Records'], ['/', 'moaswift.no'],
];

/** The row of links to the other pages, leaving out the page it is on. */
export function renderPageNav(self: string): HTMLElement {
  const nav = document.createElement('nav');
  nav.className = 'pipe-nav';
  nav.innerHTML = PAGES.filter(([href]) => href !== self).map(([href, label]) => `<a href="${href}">${label}</a>`).join('');
  return nav;
}

/**
 * The shared shell of an instrument page that plays on its own and also sends its audio to the mixer page: the audio
 * and MIDI strip (MIDI device, MIDI bus, clock), the audio-bus block, and one published port per entry in `ports`.
 * `onMidi` receives every MIDI event, from a device or from the bus.
 */
export function mountInstrumentPage(opts: {
  engine: AudioEngine;
  clock: MidiClock;
  ports: PagePort[];
  onMidi: (event: MidiEvent, time: number) => void;
  /** What goes under the strip: the panel, or several elements in order. */
  panel: HTMLElement | HTMLElement[];
  /** This page's own link, left out of the navigation row. */
  self: string;
  /** Which page this is, for the records page that conducts it: it can start the audio, change settings and send notes. */
  id: PageId;
  patch: Patch;
  /** Audio inputs, for an effect page. Instruments have none. */
  inputs?: PageInput[];
  /**
   * For a page that schedules on its audio clock: bus messages arrive this many ms early, and `onMidi` gets the
   * performance.now() time each is due (otherwise they arrive when due, with the time they arrived).
   */
  midiLeadMs?: number;
  /**
   * A page with no navigation row and no audio and MIDI strip (a toy for children): only the panel. It turns the
   * audio on and off itself with the `power` it gets back. MIDI devices and the buses still play it.
   */
  bare?: boolean;
}): { handleMidiBytes: (data: ArrayLike<number>, time?: number) => void; pcm: PcmBus; power: (on: boolean) => Promise<void>; midi: WebMidi } {
  const { engine, clock } = opts;
  applyEmbedMode();
  const monitor = new MidiMonitor();
  const midi = new WebMidi();
  const pcm = new PcmBus();
  const speakers = new MonitorControl(() => pcm.audience, (on) => engine.setMonitor(on));
  pcm.onAudience(() => speakers.update());
  const app = document.querySelector<HTMLDivElement>('#app')!;

  // An effect page listens to a port, per input, and plays it into the effect (the choice is remembered per page).
  const inputs = opts.inputs?.length
    ? new MixerInputs(
        {
          ports: () => pcm.ports,
          hasInternal: () => false,
          setInternal: () => {},
          attach: async (jack, portId) => {
            const ctx = engine.context;
            const spec = opts.inputs!.find((i) => i.jack === jack)!;
            const target = engine.jackNode(spec.device, 'in', spec.jack);
            if (!ctx || !target) throw new Error('Audio is not running');
            const received = await pcm.subscribe(ctx, portId, isEmbedded() ? EMBEDDED_FX_JITTER_MS : FX_JITTER_MS);
            if (spec.mono) {
              const mono = ctx.createGain();
              mono.channelCount = 1;
              mono.channelCountMode = 'explicit';
              received.node.connect(mono).connect(target);
              return () => { mono.disconnect(); received.close(); };
            }
            received.node.connect(target);
            return () => received.close();
          },
        },
        opts.inputs.map((i) => i.jack),
        Object.fromEntries(opts.inputs.map((i) => [i.jack, i.defaultPort])),
        undefined,
        `moa.inputs.${opts.id}`,
      )
    : undefined;
  pcm.onChange(() => inputs?.reconcile());

  let started = false;
  const startAudio = async () => {
    if (started) return;
    started = true;
    await engine.start();
    speakers.update();
    const ctx = engine.context;
    if (ctx) {
      for (const port of opts.ports) {
        const node = engine.jackNode(port.device, 'out', port.jack);
        if (node) await pcm.publish(ctx, node, port.name);
      }
    }
    inputs?.start();
    start.textContent = 'Audio running';
    start.disabled = true;
    announceStatus(opts.id, 'started');
  };
  const start = document.createElement('button');
  start.className = 'start';
  start.textContent = 'Start audio';
  start.addEventListener('click', () => void startAudio());

  /** One entry point for every MIDI message, whether it came from a device or the dev console. */
  function handleMidiBytes(data: ArrayLike<number>, time = performance.now()): void {
    const event = parseMidi(data);
    if (!event) return;
    clock.handle(event, time);
    monitor.record(event, time);
    opts.onMidi(event, time);
  }
  midi.onMessage = (data, timeStamp) => handleMidiBytes(data, timeStamp);
  void midi.connectIfPermitted();

  // MIDI from the sequencer page in another tab arrives over the bus, like a MIDI input.
  const bus = new MidiBus(undefined, undefined, undefined, undefined, opts.midiLeadMs);
  bus.onMessage = (data, timeStamp) => handleMidiBytes(data, timeStamp);

  // The records page conducts this page: it starts the audio, changes settings and plays notes on a channel of its own,
  // so the song's notes reach only this instrument whatever its MIDI channel is set to.
  // Only a page inside the records page (loaded with ?embed=1) takes its orders: the same page open in a tab of its own
  // must not pick up the song's notes and settings as well.
  if (new URLSearchParams(location.search).has('embed')) {
    const songBus = new MidiBus(songChannelName(opts.id), undefined, undefined, undefined, opts.midiLeadMs);
    songBus.enabled = true;
    songBus.onMessage = (data, timeStamp) => handleMidiBytes(data, timeStamp);
    listenForControl(opts.id, (m) => {
      if (m.type === 'start') void startAudio();
      else if (m.settings) applySettings(opts.patch, m.settings);
    });
    announceStatus(opts.id, 'loaded');
  }
  if (import.meta.env.DEV) Object.assign(window, { __capture: () => captureSettings(opts.patch) });

  const strip = renderMidiStrip(midi, clock, monitor, start, bus);
  if (inputs && opts.inputs) {
    const block = el('div', 'midi-block');
    block.append(el('div', 'fader-label', opts.inputs.length > 1 ? 'Inputs' : 'Input'));
    for (const i of opts.inputs) block.append(renderAudioInputSelect(inputs, i.jack, i.label, 'None'));
    strip.append(block);
  }
  strip.append(renderAudioBusBlock(pcm, speakers));
  const panels = Array.isArray(opts.panel) ? opts.panel : [opts.panel];
  if (opts.bare) app.append(...panels);
  else app.append(renderPageNav(opts.self), strip, ...panels);
  /** The page's own on/off: the first time it starts the audio; after that it pauses and resumes it. */
  const power = async (on: boolean) => {
    if (!on) await engine.stop();
    else if (!started) await startAudio();
    else await engine.start();
  };
  return { handleMidiBytes, pcm, power, midi };
}
