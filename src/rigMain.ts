import './ui/style.css';
import './ui/rig.css';
import { AudioEngine } from './audio/engine';
import { playClick, RigMetronome } from './audio/rigMetronome';
import type { RigSynth } from './domain/devices/rigSynth';
import { MidiClock } from './domain/midi/clock';
import { Patch } from './domain/patch/patch';
import { mountInstrumentPage } from './ui/instrumentPage';
import { mountKeyboardBed } from './ui/keyboard';
import { renderRigMultiBar, renderRigPanel } from './ui/rigPanel';
import { renderRigDetail, renderRigShell, renderRigTrackStrip } from './ui/rigShell';
import { renderTapeButton, renderTapeDeck, RigTape } from './ui/rigTape';
import { renderRigFxPanel } from './ui/rigFxPanel';
import { renderRigMixPanel } from './ui/rigMixPanel';
import { renderRigSeqPanel } from './ui/rigSeqPanel';
import * as store from './ui/rigStorage';
import { loadBreakKit, RIG_BREAK_KITS, RIG_SAMPLES, rigKitSound } from './audio/rigKitSounds';

// The MOA-RIG page: the multitimbral synth on its own patch, separate from the mixer. Its audio is also published on
// the audio bus as "MOA-RIG", where the mixer page can take it into a stereo input strip.
const clock = new MidiClock();
const patch = Patch.rig();
const rig = patch.device<RigSynth>('rig');

// Kit pads: analogue ones rendered from the MOA-DR, samples from the MOA-60's factory kits.
rig.kitSounds = rigKitSound;
const kits = { breakKits: RIG_BREAK_KITS.map((k) => k.name), loadBreakKit, samples: RIG_SAMPLES };

// ---- storage: the saved sounds, the working multi as it was left, and the multi slots
rig.setSavedSounds(store.loadSounds());
rig.midiToEdited = store.loadMidiToEdited();
rig.onPartChange(() => store.saveMidiToEdited(rig.midiToEdited));
rig.metronome = store.loadMetronome();
rig.onPartChange(() => store.saveMetronome(rig.metronome));
const restored = store.loadCurrent();
if (restored) rig.loadMulti(restored.multi);
const multis = {
  slot: restored?.slot ?? -1,
  names: store.slotNames,
  load: store.loadSlot,
  save: store.saveSlot,
};

const engine = new AudioEngine(patch);

// The pages, after the design: SYNTH (the edited part, its track, the detail column), SEQUENCER, MIXER, FX (the pedals).
let scope: AnalyserNode | undefined;
const analyser = () => {
  const ctx = engine.context, out = engine.jackNode('rig', 'out', 'out');
  if (!scope && ctx && out) {
    scope = ctx.createAnalyser();
    scope.fftSize = 2048;
    out.connect(scope);
  }
  return scope;
};
const synthPage = document.createElement('div');
synthPage.className = 'rig-page rig-page-synth';
const synthMain = document.createElement('div');
synthMain.className = 'rig-page-main';
synthMain.append(renderRigPanel(rig, kits), renderRigTrackStrip(rig, () => engine.currentTime));
// record to tape: the master, as heard, into a WAV
const stamp = () => { // local date and time, as 2026-10-30 23.32
  const d = new Date(), two = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${two(d.getMonth() + 1)}-${two(d.getDate())} ${two(d.getHours())}.${two(d.getMinutes())}`;
};
const tape = new RigTape(engine, () => engine.jackNode('rig', 'out', 'out'), () => `MOA-RIG ${rig.multiName} ${stamp()}`);
const tapeLevel = () => { const m = engine.readRigMeters('rig', 'synth'); return m ? (m.masterRms[0]! + m.masterRms[1]!) / 2 : undefined; };
synthPage.append(synthMain, renderRigDetail(rig, analyser, [renderTapeDeck(tape, tapeLevel)]));
const seqPage = renderRigSeqPanel(rig, () => engine.currentTime);
seqPage.classList.add('rig-page');
const mixPage = renderRigMixPanel(rig, () => engine.readRigMeters('rig', 'synth'));
mixPage.classList.add('rig-page');
const fxPage = renderRigFxPanel(rig);
fxPage.classList.add('rig-page');
const setup = document.createElement('div');
setup.className = 'rig-setup-frame';
const shell = renderRigShell(rig, {
  synth: synthPage, seq: seqPage, mix: mixPage, fx: fxPage,
  multi: renderRigMultiBar(rig, multis), setup, keys: mountKeyboardBed(rig), extra: [renderTapeButton(tape)],
  start: () => page.power(true),
  stop: () => page.power(false),
  running: () => engine.context?.state === 'running',
});

// The sequencer sends ahead on the audio clock; a live-played note is placed by when it was heard.
const SCHEDULE_MS = 25;
rig.now = () => engine.currentTime;
rig.latency = () => engine.context ? engine.context.outputLatency || engine.context.baseLatency || 0 : 0;
// the metronome clicks on the same clock, straight to the speakers (so not onto the tape)
const metronome = new RigMetronome(rig.seq, () => rig.metronome, (when, accent) => { if (engine.context) playClick(engine.context, when, accent); });
setInterval(() => { rig.seq.schedule(engine.currentTime); metronome.schedule(engine.currentTime); }, SCHEDULE_MS);
const page = mountInstrumentPage({
  id: 'rig', patch, engine, clock, self: '/rig/', panel: shell, chrome: setup,
  ports: [{ device: 'rig', jack: 'out', name: 'MOA-RIG' }],
  onMidi: (event) => rig.handleMidi(event),
});

// Dev-only handle for poking at the engine from the browser console.
if (import.meta.env.DEV) Object.assign(window, { __rig: { engine, patch, rig, tape, pcm: page.pcm, midi: page.handleMidiBytes } });

// Every change is kept: the working multi a moment after it settles, the saved sounds when they change. Sound and
// part edits come through the synth's onEdit, pattern edits through the sequencer's onChange.
const AUTOSAVE_MS = 400;
let pending: ReturnType<typeof setTimeout> | undefined;
let soundsSaved = JSON.stringify(rig.savedSounds);
const changed = () => {
  clearTimeout(pending);
  pending = setTimeout(() => {
    store.saveCurrent(rig.toMulti(), multis.slot);
    const sounds = JSON.stringify(rig.savedSounds);
    if (sounds !== soundsSaved) { store.saveSounds(rig.savedSounds); soundsSaved = sounds; }
    // in dev, mirrored to the server too (see vite.rig.config.ts)
    if (import.meta.env.DEV) {
      void fetch('/__rig-state', { method: 'POST', body: JSON.stringify({ multi: rig.toMulti(), sounds: rig.savedSounds }) }).catch(() => {});
    }
  }, AUTOSAVE_MS);
};
rig.onEdit(changed);
rig.seq.onChange(changed);
window.addEventListener('pagehide', () => { if (pending) { clearTimeout(pending); store.saveCurrent(rig.toMulti(), multis.slot); } });

