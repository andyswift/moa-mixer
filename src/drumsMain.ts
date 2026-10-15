import './ui/style.css';
import { AudioEngine } from './audio/engine';
import { DRUM_VOICES, type DrumMachine } from './domain/devices/drumMachine';
import { DrumSequencer } from './domain/devices/drumSequencer';
import { MidiClock } from './domain/midi/clock';
import { Patch } from './domain/patch/patch';
import { renderDrumPanel } from './ui/drumPanel';
import { mountInstrumentPage } from './ui/instrumentPage';

// The drum machine and its step sequencer on their own page. Each of the six voices is published on the audio bus
// as its own port ("Drums: Kick", ...), so the mixer can give every voice its own channel.
const VOICE_NAMES: Record<(typeof DRUM_VOICES)[number], string> = {
  kick: 'Kick', snare: 'Snare', clap: 'Clap', closedHat: 'Closed Hat', openHat: 'Open Hat', ride: 'Ride',
};

const clock = new MidiClock();
const patch = Patch.drums(clock);
const engine = new AudioEngine(patch);
const drums = patch.device<DrumMachine>('drums');
const sequencer = new DrumSequencer(drums, clock, () => engine.currentTime);
setInterval(() => sequencer.tick(), 25);

const page = mountInstrumentPage({
  id: 'drums', patch, engine, clock, self: '/drums/', panel: renderDrumPanel(drums, sequencer, 'drums', engine),
  ports: DRUM_VOICES.map((voice) => ({ device: 'drums', jack: voice, name: `Drums: ${VOICE_NAMES[voice]}` })),
  onMidi: (event) => {
    drums.handleMidi(event);
    sequencer.handleMidi(event);
  },
});

// Dev-only handle for poking at the engine from the browser console.
if (import.meta.env.DEV) Object.assign(window, { __drums: { engine, patch, sequencer, pcm: page.pcm, midi: page.handleMidiBytes } });
