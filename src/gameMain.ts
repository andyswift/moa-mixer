import './ui/game/game.css';
import { AudioEngine } from './audio/engine';
import type { PolySynth } from './domain/devices/polySynth';
import type { Synthesizer } from './domain/devices/synthesizer';
import { loadProgress, saveProgress } from './domain/game/progress';
import { MidiClock } from './domain/midi/clock';
import { parseMidi, type MidiEvent } from './domain/midi/events';
import { Patch } from './domain/patch/patch';
import { WebMidi } from './midi/webMidi';
import type { Game, Screen, ScreenName } from './ui/game/game';
import { drillScreen } from './ui/game/drillScreen';
import { lessonScreen } from './ui/game/lessonScreen';
import { bandScreen, gateScreen, knobsScreen, treeScreen } from './ui/game/screens';

// Virtual Rockstar, first pass: the synth player. The SOLO-1 is the MOA-1's engine with a new face. It takes notes,
// pitch bend and the mod wheel from the player's MIDI keyboard; every other knob goes to the game, which hands a
// lesson's controls to the player's four knobs. The computer keyboard plays nothing.
const patch = Patch.synth(new MidiClock());
const engine = new AudioEngine(patch);
const synth = patch.device<Synthesizer>('synth');
synth.transport.channel.set('omni'); // whatever channel the player's keyboard sends on
synth.ccMap.clear(); // knobs reach the synth only through a lesson

// The MOA-6 on an engine of its own, for lessons that need chords (a patch has one output).
const polyPatch = Patch.poly(new MidiClock());
const polyEngine = new AudioEngine(polyPatch);
const poly = polyPatch.device<PolySynth>('poly');
poly.transport.channel.set('omni');

const midi = new WebMidi();
const app = document.querySelector<HTMLDivElement>('#app')!;
let current: Screen | undefined;
let listener: ((e: MidiEvent) => void) | undefined;

const game: Game = {
  synth,
  poly,
  instrument: 'mono',
  startAudio: async () => { await Promise.all([engine.start(), polyEngine.start()]); },
  engine,
  midi,
  progress: loadProgress(),
  heardNote: false,
  save: () => saveProgress(game.progress),
  listen: (fn) => { listener = fn; },
  go(screen: ScreenName) {
    current?.dispose?.();
    listener = undefined;
    for (let n = 0; n < 128; n++) { synth.keyUp(n); poly.keyUp(n); } // nothing hangs over from the last screen
    game.instrument = 'mono';
    current =
      screen === 'gate' ? gateScreen(game)
        : screen === 'knobs' ? knobsScreen(game)
          : screen === 'band' ? bandScreen(game)
            : screen === 'tree' ? treeScreen(game)
              : 'drill' in screen ? drillScreen(game, screen.drill)
                : lessonScreen(game, screen.lesson);
    app.replaceChildren(current.el);
    window.scrollTo(0, 0);
  },
};

midi.onMessage = (data) => {
  const e = parseMidi(data);
  if (!e) return;
  const target = game.instrument === 'poly' ? poly : synth;
  if (e.type === 'noteOn') { if (target === synth) synth.keyDown(e.note, e.velocity); else poly.keyDown(e.note); }
  else if (e.type === 'noteOff') target.keyUp(e.note);
  else if (e.type === 'pitchBend') target.setPitchBend(e.value);
  else if (e.type === 'cc' && e.controller === 1) target.setModWheel(e.value / 127);
  listener?.(e);
};
void midi.connectIfPermitted();

game.go('gate');

if (import.meta.env.DEV) {
  // Dev handle: play the game without hardware, e.g. __game.midi([0x90, 60, 100]) or __game.midi([0xb0, 74, 64]).
  Object.assign(window, { __game: { game, midi: (bytes: number[]) => midi.onMessage?.(new Uint8Array(bytes), performance.now()) } });
}
