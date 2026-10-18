import './ui/style.css';
import './ui/mpc.css';
import { AudioEngine } from './audio/engine';
import { FACTORY_KITS } from './audio/mpcKits';
import { FIRST_NOTE, type Mpc60, padName, PADS_PER_BANK, PAD_COUNT } from './domain/devices/mpc60';
import { MidiClock } from './domain/midi/clock';
import { Patch } from './domain/patch/patch';
import { MpcSequencer } from './domain/sequencer/mpcSequencer';
import { mountInstrumentPage } from './ui/instrumentPage';
import { renderMpcPanel } from './ui/mpcPanel';
import * as store from './ui/mpcStorage';

// MOA-60: a sampler and sequencer in the spirit of the Akai MPC60, on its own page. Its sound is also published on the
// audio bus as "MOA-60", where the mixer page can take it into a channel.
const clock = new MidiClock();
const patch = Patch.mpc(clock);
const engine = new AudioEngine(patch);
const m = patch.device<Mpc60>('mpc');
m.slots = FACTORY_KITS;
/** In the records page's band (an iframe), the page plays the song's kit and leaves the player's session alone. */
const embedded = new URLSearchParams(location.search).has('embed');

const SCHEDULE_MS = 25;
/** MIDI from the bus is handed over this early, with its due time, and placed on the audio clock. */
const MIDI_LEAD_MS = 40;
const seq = new MpcSequencer({
  play(pad, velocity, when, hold, over) {
    m.hit(pad, velocity, when, over);
    if ((over?.mode ?? m.pads[pad]!.mode) === 'noteon') m.release(pad, when + hold);
  },
  click(when, accent) {
    const ctx = engine.context;
    if (!ctx) return;
    const osc = ctx.createOscillator(), amp = ctx.createGain();
    osc.type = 'square';
    osc.frequency.value = accent ? 1760 : 1320;
    amp.gain.setValueAtTime(0.0001, when);
    amp.gain.exponentialRampToValueAtTime(0.12, when + 0.001);
    amp.gain.exponentialRampToValueAtTime(0.0001, when + 0.03);
    osc.connect(amp).connect(ctx.destination);
    osc.start(when);
    osc.stop(when + 0.04);
  },
});
setInterval(() => seq.schedule(engine.currentTime), SCHEDULE_MS);

/** The audio time a player meant when pressing now: what they heard was the output latency ago. */
const heardAt = () => {
  const ctx = engine.context;
  return ctx ? ctx.currentTime - (ctx.outputLatency || ctx.baseLatency || 0) : 0;
};

// ---- sounds: decoding files and keeping them in this browser
const decoder = new OfflineAudioContext(2, 1, 48000);
async function importFiles(files: File[]): Promise<void> {
  let at = m.selectedPad;
  for (const f of files) {
    try {
      const buffer = await decoder.decodeAudioData(await f.arrayBuffer());
      const channels = Array.from({ length: Math.min(2, buffer.numberOfChannels) }, (_, c) => buffer.getChannelData(c).slice());
      const s = m.addSound(f.name.replace(/\.[^.]+$/, ''), buffer.sampleRate, channels);
      if (!embedded) await store.saveSound({ id: s.id, name: s.name, character: s.character, rate: s.source.rate, channels: s.source.channels });
      if (at < PAD_COUNT) m.assign(at++, s.id);
    } catch (e) {
      alert(`Could not read ${f.name}: ${(e as Error).message}`);
    }
  }
  if (at < PAD_COUNT) {
    m.selected.set(padName(Math.min(at, PAD_COUNT - 1)));
    m.bank = Math.floor(m.selectedPad / PADS_PER_BANK);
  }
}

/** Factory sounds are made by their kit, not stored: 'f.' ids by the first, 'g.' ids by the second. */
const FACTORY_PREFIXES = ['f.', 'g.'];
const factorySlot = (id: string) => FACTORY_PREFIXES.findIndex((p) => id.startsWith(p));

/** Puts the sounds a kit uses into the pool: factory ones from their kits, the user's from this browser. */
async function ensureSounds(ids: string[]): Promise<void> {
  const slots = new Set(ids.filter((id) => !m.sounds.has(id)).map(factorySlot).filter((i) => i >= 0));
  for (const i of slots) await m.loadSlot(i);
  for (const id of ids) {
    if (m.sounds.has(id) || factorySlot(id) >= 0) continue;
    const s = await store.loadSound(id);
    if (s) m.addSound(s.name, s.rate, s.channels, s.character, s.id);
  }
}

const soundsOn = (pads: { sound?: string }[]) => [...new Set(pads.map((p) => p.sound).filter((s): s is string => !!s))];

const panel = renderMpcPanel(m, seq, engine, {
  importFiles,
  async kitNames() {
    return { factory: FACTORY_KITS.map((k) => k.name), saved: embedded ? [] : await store.kitNames().catch(() => []) };
  },
  async loadKit(name, factory) {
    if (factory) return m.loadSlot(FACTORY_KITS.findIndex((k) => k.name === name));
    const p = await store.loadKit(name);
    if (!p) return;
    await ensureSounds(soundsOn(p.pads));
    m.loadProgram(p);
  },
  async saveKit(name) {
    m.programName = name;
    await store.saveKit(m.program());
    // the user's sounds on it are in the store already; nothing else to keep
  },
  async exportKit() {
    const program = m.program();
    const sounds = soundsOn(program.pads).map((id) => m.sounds.get(id)).filter((s) => s !== undefined)
      .map((s) => ({ id: s.id, name: s.name, character: s.character, rate: s.source.rate, channels: s.source.channels }));
    const url = URL.createObjectURL(store.exportKit(program, sounds));
    const a = document.createElement('a');
    a.href = url;
    a.download = `${program.name.replace(/[^\w -]+/g, '')}.moa60.json`;
    a.click();
    setTimeout(() => URL.revokeObjectURL(url), 10000);
  },
  async importKit(file) {
    const { program, sounds } = await store.importKit(file);
    for (const s of sounds) {
      if (!m.sounds.has(s.id)) m.addSound(s.name, s.rate, s.channels, s.character, s.id);
      if (!embedded && factorySlot(s.id) < 0) await store.saveSound(s);
    }
    m.loadProgram(program);
  },
  padDown(n, velocity, noteRepeat) {
    const h = m.padFor(n, velocity);
    if (m.levels.value === 'off') m.selected.set(padName(h.pad));
    if (noteRepeat && seq.isPlaying) seq.press(h.pad, h.velocity, heardAt(), true, h.over);
    else {
      m.hit(h.pad, h.velocity, undefined, h.over);
      seq.press(h.pad, h.velocity, heardAt(), false, h.over);
    }
  },
  padUp(n) {
    const pad = m.padFor(n).pad;
    m.release(pad);
    seq.release(pad, heardAt());
  },
  play(fromStart, record) {
    if (!engine.context) { alert('Start the audio first (the button at the top).'); return; }
    if (seq.sync === 'midi') return; // the clock starts it
    if (seq.isPlaying && !fromStart) return;
    seq.play(engine.currentTime, record);
  },
  stop() {
    seq.stop();
  },
  soundRemoved(id) {
    if (!embedded) void store.deleteSound(id);
  },
});

/** The audio-clock time of a performance.now() time (MIDI from the bus comes early, stamped with when it is due). */
const audioTime = (time: number) => engine.currentTime + Math.max(0, time - performance.now()) / 1000;

const page = mountInstrumentPage({
  id: 'mpc', patch, engine, clock, self: '/mpc/', panel,
  ports: [{ device: 'mpc', jack: 'out', name: 'MOA-60' }],
  midiLeadMs: MIDI_LEAD_MS,
  onMidi: (event, time) => {
    const when = audioTime(time);
    if (event.type === 'start') seq.clockStart(when);
    else if (event.type === 'stop') seq.clockStop();
    else if (event.type === 'clock') seq.clockPulse(when, clock.bpm);
    m.handleMidi(event, time > performance.now() + 1 ? when : undefined);
    // notes from a keyboard or another page record too
    if ((event.type !== 'noteOn' && event.type !== 'noteOff') || !m.transport.acceptsChannel(event.channel)) return;
    const pad = event.note - FIRST_NOTE;
    if (pad < 0 || pad >= PAD_COUNT) return;
    if (event.type === 'noteOn' && event.velocity > 0) seq.press(pad, event.velocity / 127, when - (engine.context?.outputLatency ?? 0));
    else seq.release(pad, when);
  },
});

// ---- the session: restored on the next visit, saved a second after each change
async function restore(): Promise<void> {
  const s = embedded ? undefined : await store.loadSession().catch(() => undefined);
  if (!s) {
    if (!embedded) await m.loadSlot(0);
    return;
  }
  await ensureSounds(s.sounds);
  m.loadProgram(s.program);
  const q = s.sequencer;
  q.sequences.forEach((x, i) => { if (seq.sequences[i]) seq.sequences[i] = x; });
  Object.assign(seq, { current: q.current, tempo: q.tempo, swing: q.swing, timing: q.timing, metronome: q.metronome, countIn: q.countIn });
  seq.select(q.current);
}
let saving: ReturnType<typeof setTimeout> | undefined;
const saveSoon = () => {
  if (embedded) return;
  clearTimeout(saving);
  saving = setTimeout(() => {
    const program = m.program();
    void store.saveSession({
      program, sounds: soundsOn(program.pads),
      sequencer: { sequences: seq.sequences, current: seq.current, tempo: seq.tempo, swing: seq.swing, timing: seq.timing, metronome: seq.metronome, countIn: seq.countIn },
    }).catch(() => {});
  }, 1000);
};
void restore().then(() => {
  m.onChange(saveSoon);
  seq.onChange(saveSoon);
});

// Dev-only handle for poking at the engine from the browser console.
if (import.meta.env.DEV) Object.assign(window, { __mpc: { engine, patch, m, seq, pcm: page.pcm, midi: page.handleMidiBytes } });
