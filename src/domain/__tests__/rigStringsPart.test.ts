import { describe, expect, it } from 'vitest';
import type { CircuitChange } from '../circuit/circuit';
import { sanitiseMulti } from '../devices/rigMulti';
import { packMulti, unpackMulti } from '../devices/rigShare';
import { RIG_STRING_PARAMS, RIG_STRING_PRESETS, rigStringParams, rigStringPresets, rigStringSetup, sanitiseStrings } from '../devices/rigStrings';
import { freshPart, partPlays, RIG_VOICES, RigSynth } from '../devices/rigSynth';

interface Sent { type: string; part?: number; kind?: string; setup?: { strings: unknown[] } }
function setup() {
  const rig = new RigSynth();
  const sent: Sent[] = [];
  rig.circuit.onChange((c: CircuitChange) => { if (c.type === 'message') sent.push(c.data as Sent); });
  return { rig, sent };
}

describe('MOA-RIG bass and guitar parts', () => {
  it('every factory string sound sets only its instrument’s params, within range', () => {
    for (const p of RIG_STRING_PRESETS) {
      const params = RIG_STRING_PARAMS[p.instrument];
      expect(Object.keys(p.params).sort()).toEqual(params.map((x) => x.id).sort());
      for (const x of params) {
        expect(p.params[x.id]!, `${p.name} ${x.id}`).toBeGreaterThanOrEqual(x.min);
        expect(p.params[x.id]!, `${p.name} ${x.id}`).toBeLessThanOrEqual(x.max);
      }
    }
    expect(rigStringPresets('bass').length).toBeGreaterThanOrEqual(4);
    expect(rigStringPresets('guitar').length).toBeGreaterThanOrEqual(4);
    expect(() => rigStringParams('bass', { strum: 'DOWN' })).toThrow();
    expect(() => rigStringParams('guitar', { pickups: 'NOWHERE' })).toThrow();
  });

  it('tunes each string to its tuning, with the guitar’s pickups as the standalone guitar wires them', () => {
    const drop = rigStringSetup({ instrument: 'guitar', params: rigStringParams('guitar', { tuning: 'DROP D', pickups: 'MIDDLE+NECK', coils: 'HUMBUCKER' }) });
    expect(drop.strings.map((s) => s.note)).toEqual([38, 45, 50, 55, 59, 64]);
    expect(drop.strings[0]!.coils).toHaveLength(4); // two humbuckers, two coils each
    const flats = rigStringSetup({ instrument: 'bass', params: rigStringParams('bass', { winding: 'FLAT' }) });
    const rounds = rigStringSetup({ instrument: 'bass', params: rigStringParams('bass') });
    expect(flats.strings[0]!.mu).toBeGreaterThan(rounds.strings[0]!.mu); // flatwound packs more metal
    expect(flats.strings[0]!.T).toBeGreaterThan(rounds.strings[0]!.T); // so it takes more tension to the same note
    expect(flats.strings[0]!.b2).toBeGreaterThan(rounds.strings[0]!.b2); // and loses its highs sooner
  });

  it('make a part a bass: it gives its voices back, gets the first bass sound, and its setup goes to the worklet', () => {
    const { rig, sent } = setup();
    rig.setKind(0, 'bass');
    const pt = rig.parts[0]!;
    expect(pt.voices).toBe(0);
    expect(rig.freeVoices).toBe(RIG_VOICES);
    expect(pt.name).toBe(rigStringPresets('bass')[0]!.name);
    expect(partPlays(pt)).toBe(true);
    expect(sent.find((m) => m.type === 'kind')).toMatchObject({ part: 0, kind: 'bass' });
    expect(sent.find((m) => m.type === 'strings')?.setup?.strings).toHaveLength(4);
    const state = JSON.parse(rig.circuit.node('synth').options.state!);
    expect(state.kinds[0]).toBe('bass');
    expect(state.strings[0].strings).toHaveLength(4);
    expect(state.strings[1]).toBeNull();
    // a param turned goes to the worklet; a guitar then gets the guitar's sound, not the bass's
    sent.length = 0;
    rig.setStringParam(0, 'palm', 0.4);
    expect(sent.filter((m) => m.type === 'strings')).toHaveLength(1);
    rig.setKind(0, 'guitar');
    expect(rig.parts[0]!.strings!.instrument).toBe('guitar');
    expect(sent.at(-1)?.setup?.strings).toHaveLength(6);
    rig.setKind(0, 'synth');
    expect(rig.parts[0]!.voices).toBe(0); // a synth again, its voices to be given back by hand
  });

  it('come back from a saved multi and a share link, sound and all; a damaged sound loads its defaults', () => {
    const { rig } = setup();
    rig.loadStrings(3, rigStringPresets('guitar')[2]!);
    rig.setStringParam(3, 'strumTime', 22);
    rig.loadStrings(5, rigStringPresets('bass')[2]!);
    const m = sanitiseMulti(JSON.parse(JSON.stringify(rig.toMulti())), freshPart)!;
    expect(m).toEqual(rig.toMulti());
    expect(unpackMulti(JSON.parse(JSON.stringify(packMulti(m))), freshPart)).toEqual(m);
    const other = setup();
    other.rig.loadMulti(m);
    expect(other.rig.parts[3]!.kind).toBe('guitar');
    expect(other.rig.parts[3]!.strings!.params.strumTime).toBe(22);
    expect(other.rig.parts[5]!.strings!.params).toEqual(rigStringPresets('bass')[2]!.params);
    expect(other.sent.filter((s) => s.type === 'strings').map((s) => s.part).sort()).toEqual([3, 5]);
    const bad = sanitiseStrings({ params: { tone: 'loud', palm: 7, nope: 1 } }, 'bass');
    expect(bad.params.tone).toBe(RIG_STRING_PARAMS.bass.find((p) => p.id === 'tone')!.def);
    expect(bad.params.palm).toBe(1);
    expect('nope' in bad.params).toBe(false);
  });
});
