import './ui/style.css';
import './ui/bass.css';
import './ui/kit.css';
import { AudioEngine } from './audio/engine';
import { loadCymbalCuts } from './audio/kitSamples';
import type { DrumKit } from './domain/devices/drumKit';
import { MidiClock } from './domain/midi/clock';
import { Patch } from './domain/patch/patch';
import { renderKitPanel } from './ui/kitPanel';
import { mountInstrumentPage } from './ui/instrumentPage';

// MOA-KIT: an acoustic drum kit, every piece physically modelled, on its own page. Its sound is also published on the audio bus as "MOA-KIT" (stereo),
// where the mixer page can take it into a stereo strip. MIDI drum notes on any channel play it.
const clock = new MidiClock();
const patch = Patch.kit();
const engine = new AudioEngine(patch);
const kit = patch.device<DrumKit>('kit');
// the cymbals are cut from Gaute's breaks; until they arrive, the sampled cymbals are silent
void loadCymbalCuts().then((cuts) => kit.loadCymbals(cuts));

const page = mountInstrumentPage({
  id: 'kit', patch, engine, clock, self: '/kit/', panel: renderKitPanel(kit, engine),
  ports: [{ device: 'kit', jack: 'out', name: 'MOA-KIT' }],
  onMidi: (event) => kit.handleMidi(event),
});

// Dev-only handle for poking at the engine from the browser console.
if (import.meta.env.DEV) Object.assign(window, { __kit: { engine, patch, kit, pcm: page.pcm, midi: page.handleMidiBytes } });
