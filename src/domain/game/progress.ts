/** The band members the player can practise as. */
export type Role = 'synth' | 'bass';
export const ROLES: readonly Role[] = ['synth', 'bass'];

/** What the game remembers between sessions. */
export interface GameProgress {
  band: string;
  /** The CC numbers of the player's knobs, knob 1 first. */
  knobs: number[];
  /** Best score per lesson id, 0..1, for lessons passed (ids are unique across roles). */
  passed: Record<string, number>;
  /** XP per role: each band member levels up on their own. */
  xp: Record<Role, number>;
  fans: number;
  cash: number;
  gigs: number;
  /** Best full-tempo rehearsal score per member and song, keyed `role:songId`. */
  rehearsed: Record<string, number>;
  /** Best gig score per venue. */
  gigBest: Record<string, number>;
  /** The player's dead-note threshold from touch setup; undefined until it is done. */
  touch?: { threshold: number; sensitive: boolean };
}

export const NEW_GAME: GameProgress = { band: '', knobs: [], passed: {}, xp: { synth: 0, bass: 0 }, fans: 0, cash: 0, gigs: 0, rehearsed: {}, gigBest: {} };

const KEY = 'virtualRockstar.progress';
const XP_PER_LEVEL = 150;

/** A member's level, from 1. */
export function level(xp: number): number {
  return 1 + Math.floor(xp / XP_PER_LEVEL);
}

/** How far into the current level, 0..1. */
export function levelProgress(xp: number): number {
  return (xp % XP_PER_LEVEL) / XP_PER_LEVEL;
}

/**
 * Records a passed lesson for a role: its best score, and its XP the first time only (a replay to beat the score
 * earns the difference between the scores' bonuses, so practising pays a little but not forever).
 */
export function recordPass(p: GameProgress, role: Role, lessonId: string, xp: number, score: number): GameProgress {
  const before = p.passed[lessonId];
  const bonus = (s: number) => Math.round(s * 50);
  const gained = before === undefined ? xp + bonus(score) : Math.max(0, bonus(score) - bonus(before));
  return {
    ...p,
    passed: { ...p.passed, [lessonId]: Math.max(score, before ?? 0) },
    xp: { ...p.xp, [role]: p.xp[role] + gained },
  };
}

export function loadProgress(storage: Pick<Storage, 'getItem'> | undefined = safeStorage()): GameProgress {
  try {
    const raw = storage?.getItem(KEY);
    if (!raw) return structuredCopy(NEW_GAME);
    const p = JSON.parse(raw) as Partial<Omit<GameProgress, 'xp'>> & { xp?: unknown };
    const num = (v: unknown) => (typeof v === 'number' && Number.isFinite(v) ? v : 0);
    const scores = (v: unknown): Record<string, number> => (v && typeof v === 'object' ? Object.fromEntries(Object.entries(v).filter(([, x]) => typeof x === 'number')) : {});
    // The first version kept one number: the synth player's XP.
    const xp = typeof p.xp === 'number' ? { synth: p.xp } : p.xp && typeof p.xp === 'object' ? (p.xp as Partial<Record<Role, unknown>>) : {};
    return {
      band: typeof p.band === 'string' ? p.band : '',
      knobs: Array.isArray(p.knobs) ? p.knobs.filter((n) => Number.isInteger(n) && n >= 0 && n < 128) : [],
      passed: p.passed && typeof p.passed === 'object' ? p.passed : {},
      xp: Object.fromEntries(ROLES.map((r) => [r, typeof xp[r] === 'number' ? xp[r] : 0])) as Record<Role, number>,
      fans: num(p.fans),
      cash: num(p.cash),
      gigs: num(p.gigs),
      rehearsed: scores(p.rehearsed),
      gigBest: scores(p.gigBest),
      ...(p.touch && typeof p.touch.threshold === 'number' ? { touch: { threshold: p.touch.threshold, sensitive: p.touch.sensitive !== false } } : {}),
    };
  } catch {
    return structuredCopy(NEW_GAME);
  }
}

export function saveProgress(p: GameProgress, storage: Pick<Storage, 'setItem'> | undefined = safeStorage()): void {
  try {
    storage?.setItem(KEY, JSON.stringify(p));
  } catch {
    // storage unavailable: progress lasts this session only
  }
}

function structuredCopy(p: GameProgress): GameProgress {
  return { ...p, knobs: [...p.knobs], passed: { ...p.passed }, xp: { ...p.xp }, rehearsed: { ...p.rehearsed }, gigBest: { ...p.gigBest } };
}

function safeStorage(): Storage | undefined {
  try {
    return typeof localStorage === 'undefined' ? undefined : localStorage;
  } catch {
    return undefined;
  }
}
