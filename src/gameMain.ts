import './ui/game/game.css';
import { AudioEngine } from './audio/engine';
import type { BassGuitar } from './domain/devices/bassGuitar';
import type { DrumMachine } from './domain/devices/drumMachine';
import type { PolySynth } from './domain/devices/polySynth';
import type { Synthesizer } from './domain/devices/synthesizer';
import { loadProgress, saveProgress } from './domain/game/progress';
import { MidiClock } from './domain/midi/clock';
import { parseMidi, type MidiEvent } from './domain/midi/events';
import { Patch } from './domain/patch/patch';
import { WebMidi } from './midi/webMidi';
import { drillScreen } from './ui/game/drillScreen';
import type { Game, Screen, ScreenName } from './ui/game/game';
import { grooveScreen } from './ui/game/grooveScreen';
import { lessonScreen } from './ui/game/lessonScreen';
import { bandScreen, gateScreen, knobsScreen, treeScreen } from './ui/game/screens';

// Virtual Rockstar. Each instrument is one of the site's own engines with a new face: the SOLO-1 is the MOA-1, chords
// play on the MOA-6, the bass is the MOA-BASS and grooves come from the drum machine. A patch has one output, so each
// has an engine of its own. The player's keyboard plays whichever instrument the screen chose: notes, pitch bend and
// the mod wheel (vibrato on the synths, the palm on the bass's strings). Every other knob goes to the game, which hands
// a lesson's controls to the player's four knobs. The computer keyboard plays nothing.
const patch = Patch.synth(new MidiClock());
const engine = new AudioEngine(patch);
const synth = patch.device<Synthesizer>('synth');
synth.transport.channel.set('omni'); // whatever channel the player's keyboard sends on
synth.ccMap.clear(); // knobs reach the synth only through a lesson

const polyPatch = Patch.poly(new MidiClock());
const polyEngine = new AudioEngine(polyPatch);
const poly = polyPatch.device<PolySynth>('poly');
poly.transport.channel.set('omni');

const bassPatch = Patch.bass();
const bassEngine = new AudioEngine(bassPatch);
const bass = bassPatch.device<BassGuitar>('bass');
/** The bass sounds an octave below the keys, as bass parts are written: the E below middle C is the open E string. */
const BASS_TRANSPOSE = -12;

const drumsPatch = Patch.drums();
const drumsEngine = new AudioEngine(drumsPatch);
const drums = drumsPatch.device<DrumMachine>('drums');

const midi = new WebMidi();
const app = document.querySelector<HTMLDivElement>('#app')!;
let current: Screen | undefined;
let listener: ((e: MidiEvent, time: number) => void) | undefined;

const game: Game = {
  synth,
  poly,
  bass,
  drums,
  drumsEngine,
  instrument: 'mono',
  role: 'synth',
  startAudio: async () => { await Promise.all([engine, polyEngine, bassEngine, drumsEngine].map((e) => e.start())); },
  engine,
  midi,
  progress: loadProgress(),
  heardNote: false,
  save: () => saveProgress(game.progress),
  listen: (fn) => { listener = fn; },
  go(screen: ScreenName) {
    current?.dispose?.();
    listener = undefined;
    for (let n = 0; n < 128; n++) { synth.keyUp(n); poly.keyUp(n); bass.keyUp(n); } // nothing hangs over from the last screen
    game.instrument = 'mono';
    current =
      screen === 'gate' ? gateScreen(game)
        : screen === 'knobs' ? knobsScreen(game)
          : screen === 'band' ? bandScreen(game)
            : screen === 'tree' ? treeScreen(game)
              : 'drill' in screen ? drillScreen(game, screen.drill)
                : 'groove' in screen ? grooveScreen(game, screen.groove)
                  : lessonScreen(game, screen.lesson);
    app.replaceChildren(current.el);
    window.scrollTo(0, 0);
  },
};

midi.onMessage = (data, time) => {
  let e = parseMidi(data);
  if (!e) return;
  const target = game.instrument === 'poly' ? poly : game.instrument === 'bass' ? bass : synth;
  if ((e.type === 'noteOn' || e.type === 'noteOff') && target === bass) e = { ...e, note: e.note + BASS_TRANSPOSE };
  if (e.type === 'noteOn') { if (target === poly) poly.keyDown(e.note); else target.keyDown(e.note, e.velocity); }
  else if (e.type === 'noteOff') target.keyUp(e.note);
  else if (e.type === 'pitchBend') target.setPitchBend(e.value);
  else if (e.type === 'cc' && e.controller === 1) target.setModWheel(e.value / 127);
  listener?.(e, time);
};
void midi.connectIfPermitted();

game.go('gate');

if (import.meta.env.DEV) {
  // Dev handle: play the game without hardware, e.g. __game.midi([0x90, 60, 100]) or __game.midi([0xb0, 74, 64]).
  Object.assign(window, { __game: { game, engines: { synth: engine, poly: polyEngine, bass: bassEngine, drums: drumsEngine }, midi: (bytes: number[]) => midi.onMessage?.(new Uint8Array(bytes), performance.now()) } });
}
