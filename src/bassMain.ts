import './ui/style.css';
import './ui/bass.css';
import { AudioEngine } from './audio/engine';
import type { BassGuitar } from './domain/devices/bassGuitar';
import { MidiClock } from './domain/midi/clock';
import { Patch } from './domain/patch/patch';
import { renderBassPanel } from './ui/bassPanel';
import { mountInstrumentPage } from './ui/instrumentPage';
import { mountKeyboardBed } from './ui/keyboard';

// MOA-BASS: a four-string bass, each string physically modelled, into an amp and cabinet, on its own page. Its sound is also published on the audio bus as
// "MOA-BASS", where the mixer page can take it into a channel.
const clock = new MidiClock();
const patch = Patch.bass();
const engine = new AudioEngine(patch);
const bass = patch.device<BassGuitar>('bass');

const wrap = document.createElement('div');
wrap.className = 'bass-wrap';
wrap.append(renderBassPanel(bass, engine), mountKeyboardBed(bass));

const page = mountInstrumentPage({
  id: 'bass', patch, engine, clock, self: '/bass/', panel: wrap,
  ports: [{ device: 'bass', jack: 'out', name: 'MOA-BASS' }],
  onMidi: (event) => bass.handleMidi(event),
});

// Dev-only handle for poking at the engine from the browser console.
if (import.meta.env.DEV) Object.assign(window, { __bass: { engine, patch, bass, pcm: page.pcm, midi: page.handleMidiBytes } });
