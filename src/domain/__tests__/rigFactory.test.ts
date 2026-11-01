import { describe, expect, it } from 'vitest';
import { RIG_FACTORY_MULTIS } from '../devices/rigFactory';
import { RIG_MACRO_MODELS } from '../devices/rigParams';
import { PEDAL_NAMES } from '../devices/rigPedals';
import { RIG_PRESETS } from '../devices/rigPresets';
import { sanitiseMulti } from '../devices/rigMulti';
import { freshPart, RIG_VOICES, RigSynth } from '../devices/rigSynth';

describe('MOA-RIG factory multis', () => {
  for (const f of RIG_FACTORY_MULTIS) {
    it(`${f.name}: comes through the multi checker unchanged, within the voice pool, and loads`, () => {
      const m = f.build();
      expect(sanitiseMulti(JSON.parse(JSON.stringify(m)), freshPart)).toEqual(m);
      expect(m.parts.reduce((s, p) => s + p.voices, 0)).toBeLessThanOrEqual(RIG_VOICES);
      const rig = new RigSynth();
      rig.loadMulti(m);
      // the synth writes out every mixer value; the factory multi only those it changes
      const { mix, ...rest } = rig.toMulti();
      const { mix: wanted, ...wantedRest } = m;
      expect(rest).toEqual(wantedRest);
      for (const [id, v] of Object.entries(wanted)) expect(mix[id], id).toBe(v);
    });
  }

  it('INIT · 8 PARTS: eight parts with three voices each, on channels 1 to 8', () => {
    const m = RIG_FACTORY_MULTIS.find((f) => f.name.startsWith('INIT'))!.build();
    expect(m.parts.slice(0, 8).map((p) => [p.voices, p.channel])).toEqual(Array.from({ length: 8 }, (_, i) => [3, i + 1]));
    expect(m.parts.slice(8).every((p) => p.voices === 0)).toBe(true);
  });

  it('ACID HOUSE: eight parts that all play somewhere in the chain, the acid in every pattern, on the models it says', () => {
    const m = RIG_FACTORY_MULTIS.find((f) => f.name === 'ACID HOUSE')!.build();
    expect(m.tempo).toBe(124);
    expect(m.chain).toEqual([0, 1, 2, 2, 3, 4, 4]);
    const plays = (part: number) => m.chain.some((i) => m.patterns[i]!.tracks[part]!.steps.some((s) => s.notes.length));
    for (let p = 0; p < 8; p++) expect(plays(p), `part ${p + 1}`).toBe(true);
    for (const i of new Set(m.chain)) expect(m.patterns[i]!.tracks[0]!.steps.filter((s) => s.notes.length).length).toBeGreaterThan(20);
    expect(m.parts.slice(0, 8).map((p) => p.kind === 'kit' ? 'kit' : p.voices > 0 ? 'synth' : 'none')).not.toContain('none');
    const model = (p: number) => RIG_MACRO_MODELS[m.parts[p]!.a.params['osc3.model']!];
    expect([model(3), model(6), model(7)]).toEqual(['CHORDS', 'SPEECH', 'FM']);
    // the acid slides: some steps tie into the next
    expect(m.patterns[0]!.tracks[0]!.steps.some((s) => s.notes.length && s.gate > 1)).toBe(true);
  });

  it('ACID HOUSE: the acid rolls through every bar; the stab calls in bars 1 and 3 and the arp answers in 2 and 4', () => {
    const m = RIG_FACTORY_MULTIS.find((f) => f.name === 'ACID HOUSE')!.build();
    const bars = (pat: number, part: number) => {
      const t = m.patterns[pat]!.tracks[part]!;
      return [0, 1, 2, 3].filter((b) => t.steps[(b * 16) % t.length]!.notes.length || t.steps.slice((b * 16) % t.length, (b * 16) % t.length + 16).some((s) => s.notes.length));
    };
    for (const pat of new Set(m.chain)) {
      expect(bars(pat, 0), `pattern ${pat + 1}: the acid`).toEqual([0, 1, 2, 3]);
      if (m.patterns[pat]!.tracks[3]!.steps.some((s) => s.notes.length)) expect(bars(pat, 3)).toEqual([0, 2]);
      if (m.patterns[pat]!.tracks[7]!.steps.some((s) => s.notes.length)) expect(bars(pat, 7)).toEqual([1, 3]);
    }
  });

  it('ACID HOUSE: the acid is the bassline: an octave down, never above A2 (its octave pops), and the sub only where it is not the bass', () => {
    const m = RIG_FACTORY_MULTIS.find((f) => f.name === 'ACID HOUSE')!.build();
    expect(m.parts[0]!.a.params['osc1.oct']).toBe(1);
    for (const pat of new Set(m.chain)) {
      const top = Math.max(...m.patterns[pat]!.tracks[0]!.steps.flatMap((s) => s.notes));
      expect(top - 12, `pattern ${pat + 1}`).toBeLessThanOrEqual(45); // sounding pitch: A2, 110 Hz
    }
    const subIn = [...new Set(m.chain)].filter((pat) => m.patterns[pat]!.tracks[4]!.steps.some((s) => s.notes.length));
    expect(subIn).toEqual([3]); // the breakdown
  });

  it('SCALPEL: loops of different lengths turning against each other, a driven kick keying the compressor, all parts playing', () => {
    const m = RIG_FACTORY_MULTIS.find((f) => f.name.startsWith('SCALPEL'))!.build();
    expect(m.tempo).toBe(135);
    const main = m.patterns[4]!;
    expect(new Set([0, 1, 2, 3, 4, 5].map((p) => main.tracks[p]!.length))).toEqual(new Set([16, 12, 10, 6, 7]));
    const plays = (part: number) => m.chain.some((i) => m.patterns[i]!.tracks[part]!.steps.some((s) => s.notes.length));
    for (let p = 0; p < 8; p++) expect(plays(p), `part ${p + 1}`).toBe(true);
    expect([m.mix['p1.fx1.type'], m.mix['p1.fx1.on'], m.mix['cmp.key']]).toEqual([PEDAL_NAMES.indexOf('DRIVE'), 1, 1]);
    // the synth parts are the RIG's techno sounds
    expect([4, 5, 6, 7].map((p) => RIG_PRESETS[m.parts[p]!.slot]!.name)).toEqual(['Techno Bass', 'Metal Hit', 'Techno Stab', 'Noise Sweep']);
    // and the dub delay is deep in it: the stabs and metal sent hard, feeding back long
    expect(Math.min(m.mix['p6.a']!, m.mix['p7.a']!)).toBeGreaterThanOrEqual(0.5);
    expect(m.mix['dub.fdbk']).toBeGreaterThanOrEqual(0.7);
  });

  it('TENSION · 116: built on the strings: every string part plays, its notes in its instrument’s reach, dead notes in the bass and chops', () => {
    const m = RIG_FACTORY_MULTIS.find((f) => f.name.startsWith('TENSION'))!.build();
    const strung = m.parts.flatMap((p, i) => (p.kind === 'bass' || p.kind === 'guitar' ? [i] : []));
    expect(strung.length).toBeGreaterThanOrEqual(6);
    expect(new Set(strung.map((i) => m.parts[i]!.kind))).toEqual(new Set(['bass', 'guitar']));
    const used = new Set(m.chain);
    for (const i of strung) {
      const p = m.parts[i]!;
      const notes = [...used].flatMap((pat) => m.patterns[pat]!.tracks[i]!.steps.flatMap((s) => s.notes));
      expect(notes.length, p.name).toBeGreaterThan(0);
      const [lo, hi] = p.kind === 'bass' ? [26, 26 + 24 + 17] : [38, 64 + 22];
      for (const n of notes) { expect(n, p.name).toBeGreaterThanOrEqual(lo); expect(n, p.name).toBeLessThanOrEqual(hi); }
    }
    const dead = (i: number) => m.patterns[5]!.tracks[i]!.steps.some((s) => s.notes.length && s.vel <= 40 / 127);
    expect(dead(2)).toBe(true);
    expect(dead(3)).toBe(true);
    expect(m.parts.reduce((s, p) => s + p.voices, 0)).toBeLessThanOrEqual(8); // the synths only where needed
  });
});
