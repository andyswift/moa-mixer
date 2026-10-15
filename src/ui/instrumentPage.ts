import type { AudioEngine } from '../audio/engine';
import { MonitorControl } from '../audio/monitorControl';
import { PcmBus } from '../audio/pcmBus';
import type { MidiClock } from '../domain/midi/clock';
import { type MidiEvent, parseMidi } from '../domain/midi/events';
import { MidiMonitor } from '../domain/midi/monitor';
import { MidiBus } from '../midi/bus';
import { WebMidi } from '../midi/webMidi';
import { renderAudioBusBlock } from './audioBusBlock';
import { renderMidiStrip } from './midiStrip';

export interface PagePort {
  device: string;
  jack: string;
  /** The name other tabs see in their input choosers. */
  name: string;
}

const PAGES: [href: string, label: string][] = [
  ['/mixer/', 'The mixer'], ['/synth/', 'MOA-1'], ['/poly/', 'MOA-6'], ['/drums/', 'MOA-DR'], ['/lynch/', 'Lynch 106'],
  ['/duo/', 'MOA-DUO'], ['/df2/', 'MOA-DF2'], ['/pipe/', 'MOA-PIPE'], ['/seq/', 'MOA-SEQ'], ['/', 'moaswift.no'],
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
  onMidi: (event: MidiEvent) => void;
  /** What goes under the strip: the panel, or several elements in order. */
  panel: HTMLElement | HTMLElement[];
  /** This page's own link, left out of the navigation row. */
  self: string;
}): { handleMidiBytes: (data: ArrayLike<number>, time?: number) => void; pcm: PcmBus } {
  const { engine, clock } = opts;
  const monitor = new MidiMonitor();
  const midi = new WebMidi();
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
    const ctx = engine.context;
    if (ctx) {
      for (const port of opts.ports) {
        const node = engine.jackNode(port.device, 'out', port.jack);
        if (node) await pcm.publish(ctx, node, port.name);
      }
    }
    start.textContent = 'Audio running';
    start.disabled = true;
  });

  /** One entry point for every MIDI message, whether it came from a device or the dev console. */
  function handleMidiBytes(data: ArrayLike<number>, time = performance.now()): void {
    const event = parseMidi(data);
    if (!event) return;
    clock.handle(event, time);
    monitor.record(event, time);
    opts.onMidi(event);
  }
  midi.onMessage = (data, timeStamp) => handleMidiBytes(data, timeStamp);
  void midi.connectIfPermitted();

  // MIDI from the sequencer page in another tab arrives over the bus, like a MIDI input.
  const bus = new MidiBus();
  bus.onMessage = (data, timeStamp) => handleMidiBytes(data, timeStamp);

  const strip = renderMidiStrip(midi, clock, monitor, start, bus);
  strip.append(renderAudioBusBlock(pcm, speakers));
  app.append(renderPageNav(opts.self), strip, ...(Array.isArray(opts.panel) ? opts.panel : [opts.panel]));
  return { handleMidiBytes, pcm };
}
