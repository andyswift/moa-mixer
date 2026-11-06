import { level, type GameProgress, type Role } from './progress';

/**
 * The tour: venues from the rehearsal room to the stadium. A venue opens once the band has enough fans and the
 * player's members are good enough; a gig there pays its fee and wins fans by how well it went. Only the Cellar Bar
 * has a setlist yet; the rest show what the road ahead looks like.
 */
export interface Venue {
  readonly id: string;
  readonly name: string;
  readonly capacity: number;
  /** The songs played there, in order. */
  readonly setlist: readonly string[];
  /** To book it: fans, and the level of the member who plays. */
  readonly needs: { readonly fans: number; readonly level: number };
  /** Paid for a perfect gig; a poor one pays half. */
  readonly fee: number;
  /** Fans won by a perfect gig with the room at its loudest. */
  readonly maxFans: number;
}

export const VENUES: readonly Venue[] = [
  { id: 'cellar', name: 'The Cellar Bar', capacity: 40, setlist: ['first-light', 'night-bus', 'static-hearts'], needs: { fans: 0, level: 1 }, fee: 60, maxFans: 40 },
  { id: 'northside', name: 'Northside Club', capacity: 300, setlist: [], needs: { fans: 250, level: 2 }, fee: 240, maxFans: 160 },
  { id: 'palace', name: 'Old Palace Theatre', capacity: 1500, setlist: [], needs: { fans: 3000, level: 4 }, fee: 1200, maxFans: 900 },
  { id: 'arena', name: 'The Arena', capacity: 12000, setlist: [], needs: { fans: 25000, level: 6 }, fee: 9000, maxFans: 6000 },
  { id: 'stadium', name: 'The Stadium', capacity: 60000, setlist: [], needs: { fans: 100000, level: 8 }, fee: 40000, maxFans: 25000 },
];

/** A rehearsal run at full tempo with at least this score marks a song as learned for the gig. */
export const REHEARSED_MARK = 0.5;

export function venueById(id: string): Venue {
  const v = VENUES.find((x) => x.id === id);
  if (!v) throw new Error(`No venue ${id}`);
  return v;
}

/** Whether the band can book a venue, with the player on `role`; and if not, why. */
export function canBook(p: GameProgress, role: Role, v: Venue): { ok: boolean; why?: string } {
  if (!v.setlist.length) return { ok: false, why: 'Coming in a later version' };
  if (p.fans < v.needs.fans) return { ok: false, why: `Needs ${v.needs.fans} fans` };
  if (level(p.xp[role]) < v.needs.level) return { ok: false, why: `Needs level ${v.needs.level}` };
  const unrehearsed = v.setlist.filter((s) => (p.rehearsed[`${role}:${s}`] ?? 0) < REHEARSED_MARK);
  if (unrehearsed.length) return { ok: false, why: `Rehearse every song at full tempo first (${unrehearsed.length} to go)` };
  return { ok: true };
}

export interface GigOutcome {
  /** Mean of the songs' scores, 0..1. */
  readonly score: number;
  /** The room on average, 0..1. */
  readonly crowd: number;
  readonly stars: number;
  readonly fans: number;
  readonly cash: number;
  readonly xp: number;
}

/** What a gig earns: fans by score and crowd, cash from half to all of the fee, XP for the member who played. */
export function gigOutcome(v: Venue, songScores: readonly number[], crowd: number): GigOutcome {
  const score = songScores.length ? songScores.reduce((a, b) => a + b, 0) / songScores.length : 0;
  return {
    score,
    crowd,
    stars: Math.max(1, Math.min(5, Math.round(score * 5))),
    fans: Math.round(v.maxFans * score * (0.5 + 0.5 * crowd)),
    cash: Math.round(v.fee * (0.5 + 0.5 * score)),
    xp: Math.round(40 + 80 * score),
  };
}

export function recordGig(p: GameProgress, role: Role, v: Venue, o: GigOutcome): GameProgress {
  return {
    ...p,
    fans: p.fans + o.fans,
    cash: p.cash + o.cash,
    gigs: p.gigs + 1,
    gigBest: { ...p.gigBest, [v.id]: Math.max(o.score, p.gigBest[v.id] ?? 0) },
    xp: { ...p.xp, [role]: p.xp[role] + o.xp },
  };
}

/** A rehearsal run: the best full-tempo score per member and song is kept. */
export function recordRehearsal(p: GameProgress, role: Role, songId: string, score: number): GameProgress {
  const key = `${role}:${songId}`;
  return { ...p, rehearsed: { ...p.rehearsed, [key]: Math.max(score, p.rehearsed[key] ?? 0) } };
}

/** How a member did across a gig, for advice. */
export interface PlayStats {
  readonly cues: number;
  readonly good: number;
  readonly close: number;
  readonly off: number;
  readonly wrong: number;
  readonly missed: number;
  /** Mean offset of notes on time-ish, ms: negative rushes. */
  readonly meanOffsetMs: number;
}

export interface Advice {
  readonly text: string;
  /** A lesson to go to, if one teaches it. */
  readonly lesson?: { readonly kind: 'drill' | 'groove'; readonly id: string; readonly title: string };
  /** A song to rehearse again. */
  readonly song?: string;
}

/**
 * What to practise next, from how the gig went: wrong notes send the player to the lesson that teaches them,
 * timing to the timing lesson (or a slow rehearsal), missed notes to rehearsing the weakest song. At most three.
 */
export function adviceFor(role: Role, stats: PlayStats, weakestSong: string): Advice[] {
  const out: Advice[] = [];
  const share = (n: number) => (stats.cues ? n / stats.cues : 0);
  if (share(stats.wrong) >= 0.08) {
    out.push(role === 'bass'
      ? { text: 'Wrong notes under the chords: go over which root goes with which chord.', lesson: { kind: 'drill', id: 'B-H1', title: 'Roots and fifths' } }
      : { text: 'Wrong notes in the chords: build them again until your hand knows them.', lesson: { kind: 'drill', id: 'H1', title: 'Major and minor triads' } });
  }
  if (share(stats.off + stats.close) >= 0.2 || Math.abs(stats.meanOffsetMs) > 35) {
    const way = stats.meanOffsetMs < -20 ? 'You were rushing, ahead of the kick.' : stats.meanOffsetMs > 20 ? 'You were dragging, behind the kick.' : 'Your timing wandered.';
    out.push(role === 'bass'
      ? { text: `${way} Lock in with the drums.`, lesson: { kind: 'groove', id: 'B-T2', title: 'Lock to the kick' } }
      : { text: `${way} Run the songs slower in rehearsal, listening to the kick.`, song: weakestSong });
  }
  if (share(stats.missed) >= 0.1) out.push({ text: 'Notes went by unplayed: learn the weakest song again, section by section.', song: weakestSong });
  if (!out.length) out.push({ text: 'A tight set. Push for a better score, or start on the next lessons.', song: weakestSong });
  return out.slice(0, 3);
}
