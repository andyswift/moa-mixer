import { describe, expect, it } from 'vitest';
import { RigSequencer } from '../../domain/sequencer/rigSequencer';
import { RigMetronome } from '../rigMetronome';

const silent = { on() {}, off() {}, locks() {}, mod() {}, flush() {} };
/** Runs the page's scheduling (every 25 ms) for a while; the clicks heard. */
function clicks(seconds: number, opts: { on?: () => boolean; tempoAt?: [number, number] } = {}) {
  const seq = new RigSequencer(silent);
  seq.tempo = 120;
  const heard: [number, boolean][] = [];
  const m = new RigMetronome(seq, opts.on ?? (() => true), (when, accent) => heard.push([+when.toFixed(4), accent]));
  seq.play(0);
  for (let t = 0; t <= seconds + 1e-9; t += 0.025) {
    if (opts.tempoAt && Math.abs(t - opts.tempoAt[0]) < 0.0125) seq.tempo = opts.tempoAt[1];
    seq.schedule(t);
    m.schedule(t);
  }
  return heard;
}

describe('MOA-RIG metronome', () => {
  it('clicks each beat once while playing, the bar\'s first higher', () => {
    // 120 BPM: a beat every half second, from the sequencer's start (50 ms in)
    expect(clicks(2.1)).toEqual([[0.05, true], [0.55, false], [1.05, false], [1.55, false], [2.05, true]]);
  });

  it('is quiet when off, and follows a change of tempo on the beat', () => {
    expect(clicks(2.1, { on: () => false })).toEqual([]);
    const heard = clicks(2.1, { tempoAt: [0.3, 60] }).map(([t]) => t);
    // the first beat at 120, then a second apart at 60
    expect(heard[0]).toBe(0.05);
    expect(heard.slice(1).every((t, i) => i === 0 || Math.abs(t - heard[i]! - 1) < 0.01)).toBe(true);
  });
});
