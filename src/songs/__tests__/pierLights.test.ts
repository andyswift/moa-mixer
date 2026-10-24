import { describe, expect, it } from 'vitest';
import { pierLights } from '../library/pierLights';
import { automationValue } from '../player';
import { songBeats } from '../types';

describe('Pier Lights', () => {
  const song = pierLights();
  const sections = song.sections!;

  it('names its sections end to end, from the first beat to the last', () => {
    expect(sections[0]!.from).toBe(0);
    for (let k = 1; k < sections.length; k++) expect(sections[k]!.from).toBe(sections[k - 1]!.to);
    expect(sections.at(-1)!.to).toBe(songBeats(song));
    expect(sections.map((s) => s.name).join(' ')).toBe('Intro Verse Chorus Verse′ Chorus′ Bridge Chorus″ Outro End');
  });

  it('keeps to A major', () => {
    const key = new Set([9, 11, 1, 2, 4, 6, 8]); // A B C# D E F# G#
    for (const [page, notes] of Object.entries(song.tracks)) {
      if (page === 'kit') continue;
      for (const n of notes!) expect(key.has(n.note % 12), `${page} ${n.note} at beat ${n.t}`).toBe(true);
    }
  });

  it('plays every note on the instruments that play it (the guitar within its 22 frets, the basses within 24)', () => {
    for (const n of song.tracks.guitar!) expect(n.note).toBeGreaterThanOrEqual(40), expect(n.note).toBeLessThanOrEqual(86);
    for (const n of [...song.tracks.bass!, ...song.tracks.bass2!]) expect(n.note).toBeGreaterThanOrEqual(28), expect(n.note).toBeLessThanOrEqual(67);
  });

  const inside = (name: string) => (t: number) => sections.some((s) => s.name === name && t >= s.from && t < s.to);

  it('jangles: in the verses the guitar keeps the open B and E ringing over every chord, and the chord changes nearly every bar', () => {
    const verse = sections.find((s) => s.name === 'Verse')!;
    const bars: Set<number>[] = [];
    for (const n of song.tracks.guitar!.filter((x) => inside('Verse')(x.t) && x.vel > 40)) (bars[Math.floor((n.t - verse.from) / 4)] ??= new Set()).add(n.note);
    for (const bar of bars) expect(bar.has(59) || bar.has(64)).toBe(true);
    const changes = bars.slice(1).filter((bar, k) => [...bar].sort().join() !== [...bars[k]!].sort().join()).length;
    expect(changes).toBeGreaterThanOrEqual(bars.length - 2);
  });

  it('picks like a person: no two four-bar phrases of the guitar the same, rests in the picking, muted scratches between', () => {
    const verseBars = song.sections!.filter((s) => s.name.startsWith('Verse'));
    const rhythm = (from: number) => song.tracks.guitar!.filter((n) => n.t >= from && n.t < from + 16).map((n) => `${(n.t - from).toFixed(3)}:${n.vel > 40 ? 'n' : 'x'}`).sort().join();
    const phrases = verseBars.flatMap((s) => [0, 16, 32, 48].map((o) => rhythm(s.from + o)));
    expect(new Set(phrases).size).toBe(phrases.length);
    const verse = verseBars[0]!;
    const onsets = new Set(song.tracks.guitar!.filter((n) => n.t >= verse.from && n.t < verse.from + 4).map((n) => n.t));
    expect(onsets.size).toBeLessThan(16); // not every sixteenth
    expect(song.tracks.guitar!.some((n) => inside('Verse')(n.t) && n.vel <= 40)).toBe(true);
  });

  it('ebbs and flows together: the second verse drops back and builds, the bridge grows, the last chorus is the loudest', () => {
    const backbeat = (from: number, to: number) => {
      const hits = song.tracks.kit!.filter((n) => (n.note === 38 || n.note === 37) && n.t >= from && n.t < to && n.vel > 60);
      return hits.reduce((a, n) => a + n.vel, 0) / hits.length;
    };
    const s = (name: string) => sections.find((x) => x.name === name)!;
    expect(backbeat(s('Verse′').from, s('Verse′').from + 16)).toBeLessThan(backbeat(s('Verse').from, s('Verse').from + 16) * 0.9);
    expect(backbeat(s('Bridge').from, s('Bridge').from + 8)).toBeLessThan(backbeat(s('Bridge').to - 12, s('Bridge').to - 4));
    expect(backbeat(s('Chorus″').from, s('Chorus″').to)).toBeGreaterThan(backbeat(s('Chorus').from, s('Chorus').to));
    // and the guitar and both basses with it
    const mean = (page: 'guitar' | 'bass' | 'bass2', name: string) => {
      const ns = song.tracks[page]!.filter((n) => inside(name)(n.t) && n.vel > 40);
      return ns.reduce((a, n) => a + n.vel, 0) / ns.length;
    };
    for (const page of ['guitar', 'bass', 'bass2'] as const) expect(mean(page, 'Verse′'), page).toBeLessThan(mean(page, 'Verse'));
  });

  it('puts the tune up front: the free bass over the accompaniment in the mix, the guitar taking over in the bridge', () => {
    const mixer = song.setup.mixer!.mixer!.controls!;
    expect(mixer['ch2.fader'] as number).toBeGreaterThan(2 * (mixer['ch3.fader'] as number));
    expect(mixer['ch2.fader'] as number).toBeGreaterThan(mixer['ch1.fader'] as number);
    const fader = (ch: string) => song.automation.find((a) => a.control === `${ch}.fader`)!;
    const bridge = sections.find((x) => x.name === 'Bridge')!;
    expect(automationValue(fader('ch3'), bridge.from + 2)).toBeGreaterThan(automationValue(fader('ch3'), 40));
  });

  it('has the free bass sing the tune in the verses and choruses, never picked hard (a bass picked hard by the bridge goes sharp)', () => {
    const tune = song.tracks.bass2!.filter((n) => inside('Verse')(n.t) || inside('Chorus')(n.t));
    expect(tune.length).toBeGreaterThan(80);
    expect(Math.min(...tune.map((n) => n.note))).toBeGreaterThanOrEqual(52);
    for (const n of song.tracks.bass2!) expect(n.vel).toBeLessThanOrEqual(100);
  });
});
