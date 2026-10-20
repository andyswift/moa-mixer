import './ui/style.css';
import './ui/unicorn.css';
import { AudioEngine } from './audio/engine';
import type { UnicornSynth } from './domain/devices/unicornSynth';
import { MidiClock } from './domain/midi/clock';
import { Patch } from './domain/patch/patch';
import { type DrumKind, OneKeyPlay, RhythmBox, RHYTHMS, SONGS } from './domain/sequencer/unicornRhythm';
import { mountInstrumentPage } from './ui/instrumentPage';
import { renderUnicornPanel } from './ui/unicornPanel';

// MOA-UNICORN: a keyboard for children, on its own page. The on/off switch starts the audio; its sound is also on the
// audio bus as "MOA-UNICORN", where the mixer page can take it into a channel.
const clock = new MidiClock();
const patch = Patch.unicorn(clock);
const engine = new AudioEngine(patch);
const u = patch.device<UnicornSynth>('uni');

const SCHEDULE_MS = 25;
/** Something to do at an audio-clock time (a hop on the beat), done from the page's timer. */
const at = (when: number, fn: () => void) => setTimeout(fn, Math.max(0, (when - engine.currentTime) * 1000));

const box = new RhythmBox({
  hit: (kind: DrumKind, velocity, when) => u.drum(kind, velocity, when),
  beat: (when) => at(when, () => view.bounce()),
});
setInterval(() => box.schedule(engine.currentTime), SCHEDULE_MS);
let powered = false;
const applyRhythm = () => box.set(powered && u.rhythm.value !== 'off' ? RHYTHMS[u.rhythm.value] : undefined, engine.currentTime);

// One Key Play: with a song chosen, every key plays the song's next note
let song: OneKeyPlay | undefined;
const chooseSong = () => {
  song = u.song.value === 'off' ? undefined : new OneKeyPlay(SONGS[u.song.value]!);
  view.guide(song?.next);
};

// listening to the song: its notes placed ahead on the audio clock, the unicorn hopping on each
let listening: ReturnType<typeof setTimeout>[] = [];
const stopListening = () => {
  if (!listening.length) return;
  for (const t of listening) clearTimeout(t);
  listening = [];
  u.allOff();
  view.setListening(false);
};

let lastTempo = u.tempo.value, lastRhythm = u.rhythm.value, lastSong = u.song.value;
u.onChange(() => {
  if (u.tempo.value !== lastTempo) { lastTempo = u.tempo.value; box.setTempo(lastTempo, engine.currentTime); }
  if (u.rhythm.value !== lastRhythm) { lastRhythm = u.rhythm.value; applyRhythm(); }
  if (u.song.value !== lastSong) { lastSong = u.song.value; stopListening(); chooseSong(); }
});

const view = renderUnicornPanel(u, {
  async power(on) {
    powered = on;
    if (!on) { stopListening(); u.allOff(); }
    await page.power(on);
    applyRhythm();
  },
  keyDown(key) {
    view.keyLit(key, true);
    if (song) {
      const { note, done } = song.press();
      u.keyDown(key, 0.85, undefined, note);
      view.guide(song.next);
      if (done) view.hooray();
    } else u.keyDown(key, 0.85);
  },
  keyUp(key) {
    view.keyLit(key, false);
    u.keyUp(key);
  },
  connectMidi() {
    void page.midi.connect();
  },
  listen() {
    if (listening.length) { stopListening(); return; }
    const tune = new OneKeyPlay(SONGS[u.song.value === 'off' ? 'twinkle' : u.song.value]!);
    const start = engine.currentTime + 0.15;
    const notes = tune.timed(u.tempo.value);
    for (const n of notes) {
      u.playNote(n.note, start + n.at, n.length);
      listening.push(at(start + n.at, () => view.hop(n.note)));
    }
    const end = start + notes.at(-1)!.at + notes.at(-1)!.length;
    listening.push(at(end, () => { listening = []; view.setListening(false); view.hooray(); }));
    view.setListening(true);
  },
});
u.onNote((note, on) => { if (on) view.hop(note); });

const page = mountInstrumentPage({
  id: 'unicorn', patch, engine, clock, self: '/unicorn/', panel: view.element, bare: true,
  ports: [{ device: 'uni', jack: 'out', name: 'MOA-UNICORN' }],
  onMidi: (event) => u.handleMidi(event),
});

// MIDI: the first keyboard found plays it (a child's setup has one), and the note for grown-ups says which
const midi = page.midi;
const paintMidi = () => {
  if (midi.status === 'ready' && !midi.selectedId && midi.inputs.length) midi.select(midi.inputs[0]!.id);
  const name = midi.inputs.find((i) => i.id === midi.selectedId)?.name;
  view.setMidi(
    midi.status === 'unsupported' ? 'Ingen MIDI i denne nettleseren (Safari og iPhone har det ikke)'
      : midi.status === 'denied' ? 'MIDI ble ikke tillatt (nettstedsinnstillingene i adressefeltet kan tillate det)'
      : midi.status === 'ready' ? (name ? `🎹 ${name} er koblet til` : '🎹 Fant ikke noe MIDI-keyboard: koble til ett')
      : undefined,
  );
};
midi.onChange(paintMidi);
paintMidi();

// Dev-only handle for poking at the engine from the browser console.
if (import.meta.env.DEV) Object.assign(window, { __unicorn: { engine, patch, u, box, midi: page.handleMidiBytes } });
