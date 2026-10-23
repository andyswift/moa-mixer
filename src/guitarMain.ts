import './ui/style.css';
import './ui/bass.css';
import './ui/guitar.css';
import { AudioEngine } from './audio/engine';
import type { ElectricGuitar } from './domain/devices/electricGuitar';
import { MidiClock } from './domain/midi/clock';
import { Patch } from './domain/patch/patch';
import { renderGuitarPanel } from './ui/guitarPanel';
import { mountInstrumentPage } from './ui/instrumentPage';
import { mountKeyboardBed } from './ui/keyboard';

// MOA-GUITAR: a six-string electric guitar, each string physically modelled, into an amp and cabinet, on its own page. Its sound is also published on the
// audio bus as "MOA-GUITAR", where the mixer page can take it into a channel. Opened as `?as=guitar2` it is a second guitarist:
// page id guitar2 (its own song notes and settings), published as "MOA-GUITAR 2".
const second = new URLSearchParams(location.search).get('as') === 'guitar2';
const clock = new MidiClock();
const patch = Patch.guitar();
const engine = new AudioEngine(patch);
const guitar = patch.device<ElectricGuitar>('guitar');

const wrap = document.createElement('div');
wrap.className = 'bass-wrap';
wrap.append(renderGuitarPanel(guitar, engine), mountKeyboardBed(guitar));

const page = mountInstrumentPage({
  id: second ? 'guitar2' : 'guitar', patch, engine, clock, self: '/guitar/', panel: wrap,
  ports: [{ device: 'guitar', jack: 'out', name: second ? 'MOA-GUITAR 2' : 'MOA-GUITAR' }],
  onMidi: (event) => guitar.handleMidi(event),
});

// Dev-only handle for poking at the engine from the browser console.
if (import.meta.env.DEV) Object.assign(window, { __guitar: { engine, patch, guitar, pcm: page.pcm, midi: page.handleMidiBytes } });
