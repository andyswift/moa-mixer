import './ui/style.css';
import './ui/vox.css';
import { AudioEngine } from './audio/engine';
import type { VoxSinger } from './domain/devices/voxSinger';
import { MidiClock } from './domain/midi/clock';
import { Patch } from './domain/patch/patch';
import { mountInstrumentPage } from './ui/instrumentPage';
import { mountKeyboardBed } from './ui/keyboard';
import { renderVoxPanel } from './ui/voxPanel';

// MOA-VOX: a physically modelled singing voice on its own page. Its sound is also published on the audio bus as
// "MOA-VOX", where the mixer page can take it into a channel. Opened as `?as=choir` it is a backing section, three
// singers: page id choir (its own song notes and settings), published as "MOA-VOX CHOIR".
const choir = new URLSearchParams(location.search).get('as') === 'choir';
const clock = new MidiClock();
const patch = choir ? Patch.choir() : Patch.vox();
const engine = new AudioEngine(patch);
const vox = patch.device<VoxSinger>('vox');

const wrap = document.createElement('div');
wrap.className = 'vox-wrap';
wrap.append(renderVoxPanel(vox, engine), mountKeyboardBed(vox));

const page = mountInstrumentPage({
  id: choir ? 'choir' : 'vox', patch, engine, clock, self: '/vox/', panel: wrap,
  ports: [{ device: 'vox', jack: 'out', name: choir ? 'MOA-VOX CHOIR' : 'MOA-VOX' }],
  onMidi: (event) => vox.handleMidi(event),
});

// Dev-only handle for poking at the engine from the browser console.
if (import.meta.env.DEV) Object.assign(window, { __vox: { engine, patch, vox, pcm: page.pcm, midi: page.handleMidiBytes } });
