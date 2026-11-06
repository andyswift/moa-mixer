import { POLY_PRESETS } from '../../domain/devices/polyPresets';
import { apply } from '../../domain/game/lessonSession';
import { bandmateSlipMs, humanise } from '../../domain/game/performance';
import { level, ROLES, type Role } from '../../domain/game/progress';
import { songBeats, type GameSong } from '../../domain/game/songs';
import { bassBase } from '../../domain/game/sounds';
import type { Game } from './game';

const LOOKAHEAD_S = 0.15; // drums are scheduled this far ahead on the drum engine's audio clock
const NOTE_AHEAD_MS = 400; // bandmates' notes get their timers this far ahead
const TICK_MS = 25;
const LEAD_S = 0.35; // from the click to the song's first beat
/** The session drummer: tight, whatever the player's level. */
const DRUMMER_SLIP_MS = 4;

export interface BandRun {
  /** performance.now() when a beat of the song is heard. */
  heardAt(beat: number): number;
  /** The song's beat being heard now. */
  beatNow(): number;
  readonly beatMs: number;
  readonly endBeat: number;
  stop(): void;
}

/**
 * Plays a song with the band: the drums scheduled on the drum engine's audio clock, and each part the player is not
 * playing on its engine (bass on the MOA-BASS, chords on the MOA-6) by a bandmate at that member's level, a little
 * loose at level 1. `player` is the part the player plays (left out), or undefined to hear the whole band. `tempo`
 * scales the song's BPM (0.75 for a slow rehearsal run). Beat times map onto performance.now() through the drum
 * engine's output timestamp, so a judge sees beats when they are heard.
 */
export function playSong(game: Game, song: GameSong, opts: { player?: Role; tempo?: number; seed?: number }): BandRun | undefined {
  const ctx = game.drumsEngine.context;
  if (!ctx) return undefined;
  const tempo = opts.tempo ?? 1;
  const beatMs = 60000 / (song.bpm * tempo);
  const beatS = beatMs / 1000;
  const t0 = ctx.currentTime + LEAD_S;
  const ts = ctx.getOutputTimestamp();
  const heardCtx = (t: number) => ts.performanceTime && ts.contextTime !== undefined
    ? ts.performanceTime + (t - ts.contextTime) * 1000
    : performance.now() + (t - ctx.currentTime + (ctx.outputLatency || ctx.baseLatency || 0)) * 1000;
  const zero = heardCtx(t0);
  const heardAt = (beat: number) => zero + beat * beatMs;
  const endBeat = songBeats(song);

  // the drums, a little loose by the session drummer
  const drums = humanise(song.drums.map((d) => ({ t: d.t, len: 0.1, note: 0, vel: Math.round(d.vel * 127) })), beatMs, DRUMMER_SLIP_MS, 11)
    .map((n, i) => ({ t: n.t, voice: song.drums[i]!.voice, vel: n.vel / 127 }));
  let nextDrum = 0;

  // the bandmates
  const parts = ROLES.filter((r) => r !== opts.player).map((r, k) => ({
    role: r,
    notes: humanise(song.parts[r], beatMs, bandmateSlipMs(level(game.progress.xp[r])), (opts.seed ?? 1) * 31 + k),
    next: 0,
  }));
  const timers = new Set<number>();
  const later = (ms: number, fn: () => void) => {
    const id = window.setTimeout(() => { timers.delete(id); fn(); }, Math.max(0, ms));
    timers.add(id);
  };
  const play = (r: Role, note: number, vel: number, on: boolean) => {
    if (r === 'bass') { if (on) game.bass.keyDown(note, vel); else game.bass.keyUp(note); }
    else if (on) game.poly.keyDown(note);
    else game.poly.keyUp(note);
  };

  // the bandmate bass rests its palm on the strings where the song says
  if (opts.player !== 'bass') {
    for (const [from, to] of song.palm ?? []) {
      later(heardAt(from) - performance.now() - 30, () => game.bass.setModWheel(0.8));
      later(heardAt(to) - performance.now() - 30, () => game.bass.setModWheel(0));
    }
  }

  const schedule = () => {
    const until = ctx.currentTime + LOOKAHEAD_S;
    while (nextDrum < drums.length && t0 + drums[nextDrum]!.t * beatS < until) {
      const d = drums[nextDrum++]!;
      game.drums.trigger(d.voice, d.vel, Math.max(ctx.currentTime, t0 + d.t * beatS));
    }
    const now = performance.now();
    for (const p of parts) {
      while (p.next < p.notes.length && heardAt(p.notes[p.next]!.t) < now + NOTE_AHEAD_MS) {
        const n = p.notes[p.next++]!;
        later(heardAt(n.t) - now, () => play(p.role, n.note, n.vel, true));
        later(heardAt(n.t + n.len) - now, () => play(p.role, n.note, n.vel, false));
      }
    }
  };
  schedule();
  const interval = window.setInterval(schedule, TICK_MS);

  return {
    heardAt,
    beatNow: () => (performance.now() - zero) / beatMs,
    beatMs,
    endBeat,
    stop() {
      clearInterval(interval);
      for (const id of timers) clearTimeout(id);
      timers.clear();
      for (const p of parts) for (const n of p.notes) play(p.role, n.note, 0, false);
      if (opts.player !== 'bass') game.bass.setModWheel(0);
    },
  };
}

/** The MOA-6 patch the band's chords play on: a bright synthpop poly. */
const BAND_POLY = 'Analog Poly';

/** Sets the band up for a song: the game's clean bass, the band's poly sound, and the player's keys on their member. */
export function setUpBand(game: Game, player: Role): void {
  apply(game.bass, bassBase());
  game.poly.loadPreset(POLY_PRESETS.find((p) => p.name === BAND_POLY)!);
  game.instrument = player === 'bass' ? 'bass' : 'poly';
}
