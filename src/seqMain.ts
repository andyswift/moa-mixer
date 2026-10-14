import './ui/style.css';
import './ui/seq.css';
import { Audition } from './audio/audition';
import { SequencerController } from './domain/sequencer/controller';
import { SequencerEngine } from './domain/sequencer/engine';
import { SeqScheduler } from './domain/sequencer/scheduler';
import { MidiClock } from './domain/midi/clock';
import { parseMidi } from './domain/midi/events';
import { MidiMonitor } from './domain/midi/monitor';
import { MidiBus, epochNow } from './midi/bus';
import { WebMidi } from './midi/webMidi';
import { renderMidiStrip } from './ui/midiStrip';
import { renderSeqPanel } from './ui/seqPanel';
import { bankStore, loadCurrent, saveCurrent } from './ui/seqStorage';

// The MOA-SEQ page: an algorithmic sequencer. It makes no sound of its own; it sends MIDI over the in-browser bus
// (to the instrument pages open in other tabs), to a MIDI output, and to a small audition voice.
const clock = new MidiClock();
const monitor = new MidiMonitor();
const midi = new WebMidi();
const bus = new MidiBus();
const audition = new Audition();
const app = document.querySelector<HTMLDivElement>('#app')!;

const { bank, slot } = loadCurrent();
const engine = new SequencerEngine(bank);
const controller = new SequencerController(engine, bankStore);
controller.bankSlot = slot;

const SEND_KEY = 'moa.seqBusSend';
let busSend = (() => {
  try {
    return localStorage.getItem(SEND_KEY) !== '0';
  } catch {
    return true;
  }
})();
const changeListeners = new Set<() => void>();
const changed = () => changeListeners.forEach((fn) => fn());

const scheduler = new SeqScheduler(engine, (data, at) => {
  if (busSend) bus.send(data, at);
  midi.send(data, at);
  audition.play(data, at);
  const event = parseMidi(data);
  if (event && event.type !== 'clock') window.setTimeout(() => monitor.record(event, performance.now()), Math.max(0, at - epochNow()));
}, epochNow);
scheduler.onNote = (e, at) => {
  if (e.kind === 'on') window.setTimeout(() => controller.flash(e.track), Math.max(0, at - epochNow()));
};

// A worker keeps the time, so a background tab still plays in time (page timers are throttled there).
let ticker: Worker | number | undefined;
function startTicker(): void {
  if (ticker !== undefined) return;
  try {
    const blob = new Blob(['setInterval(() => postMessage(0), 25);'], { type: 'text/javascript' });
    const worker = new Worker(URL.createObjectURL(blob));
    worker.onmessage = () => scheduler.pump();
    ticker = worker;
  } catch {
    ticker = window.setInterval(() => scheduler.pump(), 25);
  }
}

const start = document.createElement('button');
start.className = 'start';
start.textContent = 'Start audio';
start.addEventListener('click', async () => {
  await audition.wake();
  start.textContent = 'Audio running';
  start.disabled = true;
});

async function togglePlay(quiet: boolean): Promise<void> {
  if (scheduler.playing) {
    scheduler.stop(!quiet);
  } else {
    await audition.wake().catch(() => undefined); // also keeps the tab from being throttled
    start.textContent = 'Audio running';
    start.disabled = true;
    startTicker();
    scheduler.start(!quiet);
  }
  changed();
}

// Autosave, like the original: the working bank is kept as you go.
let saveTimer: number | undefined;
controller.onChange(() => {
  window.clearTimeout(saveTimer);
  saveTimer = window.setTimeout(() => saveCurrent(controller.bank, controller.bankSlot), 600);
});

midi.onChange(changed);
void midi.connectIfPermitted();

const nav = document.createElement('nav');
nav.className = 'pipe-nav';
nav.innerHTML = '<a href="/lynch/">Lynch 106</a><a href="/duo/">MOA-DUO</a><a href="/df2/">MOA-DF2</a><a href="/pipe/">MOA-PIPE</a><a href="/mixer/">The mixer</a><a href="/">moaswift.no</a>';

app.append(
  nav,
  renderMidiStrip(midi, clock, monitor, start),
  renderSeqPanel(controller, {
    playing: () => scheduler.playing,
    togglePlay: (quiet) => void togglePlay(quiet),
    tick: () => scheduler.tickAt(epochNow()),
    busOn: () => busSend,
    setBusOn: (on) => {
      busSend = on;
      try {
        localStorage.setItem(SEND_KEY, on ? '1' : '0');
      } catch {
        // not remembered
      }
      changed();
    },
    outputs: () => midi.outputs,
    selectedOutput: () => midi.selectedOutputId,
    selectOutput: (id) => midi.selectOutput(id),
    auditionOn: () => audition.enabled,
    setAudition: (on) => {
      audition.enabled = on;
      if (on) void audition.wake();
      changed();
    },
    onChange: (fn) => void changeListeners.add(fn),
  }),
);

if (import.meta.env.DEV) Object.assign(window, { __seq: { controller, scheduler, engine, bus } });
