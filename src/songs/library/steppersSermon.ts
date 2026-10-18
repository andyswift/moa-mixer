import { GAUGES, SCALES, midiToHz, tensionFor } from '../../domain/devices/bassPhysics';
import { at16, chordAt, DRUM, note, steps } from '../generators';
import { DRUM_PUNCH, mixerSettings } from '../mixes';
import type { Automation, NoteEvent, Song } from '../types';

/**
 * An original dub tune in the spirit of a UK sound system meeting a deep, melodic dub bassist: 74 bpm, E minor, Em
 * for two bars and D for two. A steppers rhythm (the kick on every beat, the rimshot on three, swung hats), the
 * MOA-BASS on flatwounds through an 8x10 (the bass line carries the tune), an organ bubble, a skank, a melodica and a
 * 2600 siren, mixed as dub is: drop-outs, echo throws, and the delay fed back through the desk until it howls.
 *
 * Bars 1-4: drums and the siren, the bass coming in. 5-12: the riddim. 13-16: dub (bass and drums, throws, a
 * feedback swell, the siren). 17-20: the riddim with the melodica. 21-24: dub again into the loop.
 */
const BARS = 24;
const section = (bar: number) => (bar < 4 ? 'intro' : bar < 12 ? 'riddim' : bar < 16 ? 'dub' : bar < 20 ? 'riddim2' : 'dub2');
const isDub = (bar: number) => section(bar) === 'dub' || section(bar) === 'dub2';
const CHORDS = { Em: [64, 67, 71], D: [62, 66, 69] } as const;
const chordFor = (bar: number) => chordAt([CHORDS.Em, CHORDS.D], bar, 2);
/** Swung eighths: the off-beat eighth lands two thirds of the way through the beat. */
const SWUNG = [0, 2.67, 4, 6.67, 8, 10.67, 12, 14.67];

// the bass riffs, two bars each: [step, note, length in steps, accent]
const RIFF_EM: [number, number, number, boolean][][] = [
  [[0, 28, 3, true], [4, 40, 1.5, false], [6, 35, 2, false], [8, 38, 3, true], [11, 40, 1, false], [12, 43, 2, false], [14, 42, 2, false]],
  [[0, 28, 3, true], [4, 40, 1.5, false], [6, 47, 2, false], [8, 45, 2, true], [10, 43, 2, false], [12, 40, 3, false], [15, 38, 1, false]],
];
const RIFF_D: [number, number, number, boolean][][] = [
  [[0, 38, 3, true], [4, 50, 1.5, false], [6, 45, 2, false], [8, 48, 3, true], [11, 50, 1, false], [12, 45, 2, false], [14, 42, 2, false]],
  [[0, 38, 3, true], [4, 45, 2, false], [6, 42, 2, false], [8, 40, 4, true], [12, 33, 2, false], [14, 35, 2, false]],
];
// the melodica: [bar of four, step, length, note]
const MELODICA: [number, number, number, number][] = [
  [0, 0, 6, 76], [0, 6, 2, 74], [0, 8, 8, 71],
  [1, 0, 4, 74], [1, 4, 4, 71], [1, 8, 8, 67],
  [2, 0, 6, 74], [2, 6, 2, 72], [2, 8, 8, 69],
  [3, 0, 4, 71], [3, 4, 4, 69], [3, 8, 6, 66],
];
// the siren: [bar, length in bars, note]
const SIRENS: [number, number, number][] = [[0, 2, 72], [14, 2, 76], [22, 1.75, 72]];

const parts = {
  drums(): NoteEvent[] {
    const out: NoteEvent[] = [];
    for (let bar = 0; bar < BARS; bar++) {
      const dub = isDub(bar);
      const hit = (step: number, pitch: number, vel: number) => out.push(note(at16(bar, step), steps(1), pitch, vel));
      for (const s of [0, 4, 8, 12]) hit(s, DRUM.kick, s === 0 ? 118 : 110); // steppers: the kick on every beat
      if (bar >= 1) hit(8, DRUM.rim, 104); // the rimshot on three
      if (bar >= 1 && bar % 2 === 1) hit(14, DRUM.rim, 62); // a ghost before the bar
      if (!dub && bar >= 2) {
        SWUNG.forEach((s, i) => hit(s, DRUM.closedHat, i % 2 === 0 ? 66 : 84));
        if (bar % 2 === 1) hit(14.67, DRUM.openHat, 74);
      }
      if (bar === 4 || bar === 16) hit(0, DRUM.crash, 96);
      if (bar === 11 || bar === 19) [DRUM.highTom, DRUM.highTom, DRUM.midTom, DRUM.lowTom].forEach((t, i) => hit(12 + i, t, 88 + i * 6));
    }
    return out;
  },
  bass(): NoteEvent[] {
    const out: NoteEvent[] = [];
    for (let bar = 2; bar < BARS; bar++) {
      const riff = chordAt([RIFF_EM, RIFF_D], bar, 2)[bar % 2]!;
      for (const [s, n, len, accent] of riff) out.push(note(at16(bar, s), steps(len), n, accent ? 112 : 92));
    }
    return out;
  },
  bubble(): NoteEvent[] {
    const out: NoteEvent[] = [];
    for (let bar = 4; bar < BARS; bar++) {
      if (isDub(bar)) continue;
      for (const s of [2.67, 6.67, 10.67, 14.67]) for (const n of chordFor(bar)) out.push(note(at16(bar, s), steps(0.9), n - 12, 68));
    }
    return out;
  },
  skank(): NoteEvent[] {
    // it plays through the dub too: its fader drops, but its echo send is pre-fader, for throws
    const out: NoteEvent[] = [];
    for (let bar = 4; bar < BARS; bar++) for (const s of [4, 12]) for (const n of chordFor(bar)) out.push(note(at16(bar, s), steps(1.1), n + 12, 88));
    return out;
  },
  melodica(): NoteEvent[] {
    const out: NoteEvent[] = [];
    for (const start of [8, 16]) for (const [b, s, len, n] of MELODICA) out.push(note(at16(start + b, s), steps(len * 0.95), n, 90));
    out.push(note(at16(21, 0), steps(4), 76, 90), note(at16(21, 8), steps(4), 74, 90)); // a fragment, thrown into the echo
    return out;
  },
  siren(): NoteEvent[] {
    return SIRENS.map(([bar, bars, n]) => note(at16(bar, 0), bars * 4 - 0.25, n, 100));
  },
};

/** The dub mix, played on the desk: drop-outs, echo throws, the feedback loop through the delay return, the siren's LFO. */
function dubMix(): Automation[] {
  const mixer = (control: string, points: [number, number][]): Automation => ({ page: 'mixer', device: 'mixer', control, points });
  const beat = (bar: number, step = 0) => at16(bar, step);
  /** A fader that drops out for the dub sections. */
  const dropOut = (control: string, up: number) => mixer(control, [
    [0, up], [beat(12) - 0.1, up], [beat(12), 0], [beat(16) - 0.1, 0], [beat(16), up], [beat(20) - 0.1, up], [beat(20), 0], [beat(24) - 0.1, 0], [beat(24), up],
  ]);
  /** A send flicked up for one hit, so that one hit goes into the echo. */
  const throws = (control: string, hits: [number, number][], base: number, up: number) => {
    const pts: [number, number][] = [[0, base]];
    for (const [bar, s] of hits) pts.push([beat(bar, s) - 0.05, base], [beat(bar, s), up], [beat(bar, s) + 0.6, up], [beat(bar, s) + 0.7, base]);
    return mixer(control, pts);
  };
  /** The delay return sent back into the delay: it swells into a howl, then is pulled back. */
  const feedback = mixer('ret2.aux2', [
    [0, 0], [beat(13, 8), 0], [beat(15), 0.9], [beat(15, 12), 0.9], [beat(16), 0],
    [beat(21, 8), 0], [beat(23), 0.88], [beat(23, 14), 0.88], [beat(24) - 0.1, 0],
  ]);
  // the siren's LFO speeds up as it wails
  const siren: Automation = {
    page: 'm2600', device: 'm2600', control: 'lfo.speed', curve: 'exp',
    points: [[0, 1.5], [beat(2), 6], [beat(2, 1), 1.5], [beat(14), 1.5], [beat(16), 7], [beat(16, 1), 1.5], [beat(22), 1.5], [beat(24) - 0.1, 6], [beat(24), 1.5]],
  };
  return [
    // the levels here are the strips' balanced levels (measured): organ 10 under the kick, skank 10, hats 12
    dropOut('ch2.fader', 0.3), dropOut('line1.fader', 0.8), dropOut('ch6.fader', 1.48), dropOut('ch7.fader', 1.17),
    throws('line1.aux2', [[13, 12], [15, 4], [20, 12], [22, 4], [23, 12]], 0.15, 0.85),
    throws('ch9.aux2', [[12, 8], [14, 8], [21, 8], [23, 8]], 0.1, 0.8),
    throws('line4.aux2', [[21, 0], [21, 8]], 0.25, 0.9),
    feedback,
    siren,
  ];
}

export function steppersSermon(): Song {
  const mix = mixerSettings({
    drums: { kick: 1.15, snare: 1.0, clap: 1.0, rest: 0.8 },
    duck: 0.1,
    reverb: { ch2: 0.15, ch9: 0.25, line1: 0.2, line4: 0.3, line5: 0.35 },
    delay: { ch9: 0.1, line1: 0.15, line4: 0.25, line5: 0.4 },
    // balanced by measured RMS (headless Chrome, a full pass): the bass a dB over the kick, as dub has it; the delay
    // return (with the desk feedback) a little under; the rimshot 3.5 under, the melodica 6 and the siren 8
    faders: { ch1: 0.77, ch2: 0.3, ch9: 0.78, line1: 0.8, line4: 0.24, line5: 0.24 },
  });
  Object.assign(mix.mixer.mixer!.controls!, {
    // the skank's echo send is pre-fader, so it can be thrown into the delay with its fader down
    'line1.auxPre12': true,
    // the delay return: thinned and honky, so every trip round the desk sounds stranger
    'ret2.lowcutOn': true, 'ret2.eqLow': -6, 'ret2.eqMid': 5, 'ret2.eqMidFreq': 1200, 'ret2.eqHigh': -4, 'ret2.fader': 0.6,
    'ch1.tape': 0.4, 'ch3.tape': 0.3,
  });
  // flatwounds are heavier than roundwounds: each string pulled to the tension that tunes it, by the physics
  const flat = (name: keyof typeof GAUGES) => Math.round(tensionFor({ ...GAUGES[name], winding: 'flat' }, SCALES.long, midiToHz(GAUGES[name].note)) * 10) / 10;
  return {
    id: 'steppers-sermon',
    title: 'Steppers Sermon',
    artist: 'MOA Swift',
    bpm: 74,
    key: 'E minor',
    bars: BARS,
    beatsPerBar: 4,
    sleeve: { art: 'frost', colors: ['#0d0d0d', '#d92b2b', '#f5c518', '#1f9d55'] },
    band: ['drums', 'bass', 'poly', 'lynch', 'pipe', 'm2600', 'reverb', 'delay', 'buscomp'],
    inputs: { ch1: 'MOA-BASS' }, // the bass on the first channel (no MOA-1 in this one)
    setup: {
      drums: { drums: { controls: { ...DRUM_PUNCH.drums!.controls, 'rim.level': 0.75, 'rim.tone': 1900, 'crash.level': 0.45 } } },
      bass: { bass: { controls: {
        'string.winding': 'flat', 'E.tension': flat('E'), 'A.tension': flat('A'), 'D.tension': flat('D'), 'G.tension': flat('G'),
        'pluck.style': 'finger', 'pluck.position': 0.17, 'pluck.strength': 0.55, 'pickup.position': 0.16, tone: 1500, palm: 0.12,
        'amp.gain': 0.35, 'amp.bass': 4, 'amp.mid': -2, 'amp.treble': -5, 'cab.type': '8x10', 'cab.mic': 'off-axis', 'cab.blend': 0.65, level: 0.9,
      } } },
      poly: { poly: { preset: 14 } }, // Pulse Organ: the bubble
      lynch: { lynch: { preset: 15 } }, // Clav: the skank
      pipe: { pipe: { preset: 10 } }, // Reed Organ: the melodica
      // the siren: a pulse swept up and down by the LFO, a slow swell in and out
      m2600: { m2600: { preset: 0, controls: {
        'vcf.in.vco1': 0.6, 'vcf.in.vco2': 0, 'vco1.pw': 0.4, 'vco1.fm.lfo': 0.2, 'lfo.speed': 1.5, 'vcf.freq': 3500, 'vcf.res': 0.2,
        'vcf.cv.adsr': 0, 'adsr.attack': 0.2, 'adsr.decay': 0.5, 'adsr.sustain': 1, 'adsr.release': 0.8, 'reverb.left': 0.3, 'reverb.right': 0.3,
      } } },
      // the dub delay: a dotted eighth (608 ms at 74 bpm), darkened, tape-wobbly, a little driven
      delay: { delay: { controls: { 'delay.time': 608, 'delay.feedback': 0.45, 'delay.tone': 2200, 'delay.wobble': 0.35, 'delay.drive': 0.4, 'delay.spread': 0.6 } } },
      reverb: { reverb: { controls: { 'reverb.size': 'large', 'reverb.lowcut': 220, 'reverb.damp': 4500, 'reverb.predelay': 30 } } },
      ...mix,
    },
    tracks: { drums: parts.drums(), bass: parts.bass(), poly: parts.bubble(), lynch: parts.skank(), pipe: parts.melodica(), m2600: parts.siren() },
    automation: dubMix(),
    humanise: { timing: { drums: 5, bass: 8, poly: 10, lynch: 7, pipe: 12, m2600: 4 }, velocity: 0.08, layback: { drums: { 37: 12 } } },
    localOnly: true, // a candidate until approved
  };
}
