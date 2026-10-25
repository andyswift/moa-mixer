import { describe, expect, it } from 'vitest';
import { parseLyrics } from '../../domain/devices/voxPhonemes';
import { carryMeHome } from '../library/carryMeHome';
import { songBeats } from '../types';

describe('Carry Me Home', () => {
  const song = carryMeHome();
  const sections = song.sections!;
  const within = (name: string) => (t: number) => sections.some((s) => s.name === name && t >= s.from && t < s.to);
  const lyrics = (page: 'vox' | 'choir') => song.setup[page]!.vox!.controls!.lyrics as string;
  /** The times a part's notes start, a chord's notes once. */
  const onsets = (page: 'vox' | 'choir') => [...new Set(song.tracks[page]!.map((n) => n.t))].sort((a, b) => a - b);

  it('names its sections end to end', () => {
    expect(sections[0]!.from).toBe(0);
    for (let k = 1; k < sections.length; k++) expect(sections[k]!.from).toBe(sections[k - 1]!.to);
    expect(sections.at(-1)!.to).toBe(songBeats(song));
    expect(sections.map((s) => s.name).join(' ')).toBe('Intro Verse Chorus Verse′ Chorus′ Shout Chorus″ Amen');
  });

  it('gives every note (every chord, for the choir) exactly one syllable, so the words stay on the tune pass after pass', () => {
    expect(parseLyrics(lyrics('vox')).length).toBe(onsets('vox').length);
    expect(parseLyrics(lyrics('choir')).length).toBe(onsets('choir').length);
    // and every syllable sings a vowel (no word read as a hum or a hiss by mistake), but the hummed pads
    for (const s of parseLyrics(lyrics('vox'))) expect(s.onset.every((g) => g.dur !== Infinity), s.text).toBe(true);
  });

  it('sings the choir in three parts, and keeps every singer in range', () => {
    const chords = new Map<number, number[]>();
    for (const n of song.tracks.choir!) chords.set(n.t, [...(chords.get(n.t) ?? []), n.note]);
    for (const [t, notes] of chords) expect(notes.length, `chord at ${t}`).toBe(3);
    for (const n of song.tracks.vox!) { expect(n.note).toBeGreaterThanOrEqual(50); expect(n.note).toBeLessThanOrEqual(72); }
    for (const notes of chords.values()) { expect(Math.max(...notes)).toBeLessThanOrEqual(74); expect(Math.min(...notes)).toBeGreaterThanOrEqual(50); }
  });

  it('calls and responds in the shout: the lead and the choir never sing at once', () => {
    const shout = within('Shout');
    const lead = song.tracks.vox!.filter((n) => shout(n.t)), choir = song.tracks.choir!.filter((n) => shout(n.t));
    expect(lead.length).toBeGreaterThan(10);
    expect(choir.length).toBeGreaterThan(10);
    for (const a of lead) for (const b of choir) expect(a.t < b.t + b.len && b.t < a.t + a.len, `${a.t} / ${b.t}`).toBe(false);
  });

  it('goes up a semitone for the last chorus', () => {
    const top = (name: string) => Math.max(...song.tracks.choir!.filter((n) => within(name)(n.t)).map((n) => n.note));
    expect(top('Chorus″') - top('Chorus')).toBe(1);
  });
});

describe('Carry Me Home: the mix', () => {
  it('puts the voices on top: the organ well under them, and below them in pitch', () => {
    const song = carryMeHome();
    const mixer = song.setup.mixer!.mixer!.controls!;
    const db = (ch: string) => 20 * Math.log10(mixer[`${ch}.fader`] as number);
    expect(db('line4')).toBeLessThan(db('ch4') - 20); // the organ comes in hot from its page; this leaves the lead clear of it
    expect(db('line4')).toBeLessThan(db('ch5') - 18);
    const top = Math.max(...song.tracks.pipe!.map((n) => n.note));
    const leadMid = song.tracks.vox!.reduce((a, n) => a + n.note, 0) / song.tracks.vox!.length;
    expect(top).toBeLessThan(leadMid);
  });
});
