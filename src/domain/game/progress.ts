/** What the game remembers between sessions. */
export interface GameProgress {
  band: string;
  /** The CC numbers of the player's knobs, knob 1 first. */
  knobs: number[];
  /** Best score per lesson id, 0..1, for lessons passed. */
  passed: Record<string, number>;
  xp: number;
}

export const NEW_GAME: GameProgress = { band: '', knobs: [], passed: {}, xp: 0 };

const KEY = 'virtualRockstar.progress';
const XP_PER_LEVEL = 150;

/** The synth player's level, from 1. */
export function level(xp: number): number {
  return 1 + Math.floor(xp / XP_PER_LEVEL);
}

/** How far into the current level, 0..1. */
export function levelProgress(xp: number): number {
  return (xp % XP_PER_LEVEL) / XP_PER_LEVEL;
}

/**
 * Records a passed lesson: its best score, and its XP the first time only (a replay to beat the score earns the
 * difference between the scores' bonuses, so practising pays a little but not forever).
 */
export function recordPass(p: GameProgress, lessonId: string, xp: number, score: number): GameProgress {
  const before = p.passed[lessonId];
  const bonus = (s: number) => Math.round(s * 50);
  const gained = before === undefined ? xp + bonus(score) : Math.max(0, bonus(score) - bonus(before));
  return { ...p, passed: { ...p.passed, [lessonId]: Math.max(score, before ?? 0) }, xp: p.xp + gained };
}

export function loadProgress(storage: Pick<Storage, 'getItem'> | undefined = safeStorage()): GameProgress {
  try {
    const raw = storage?.getItem(KEY);
    if (!raw) return { ...NEW_GAME };
    const p = JSON.parse(raw) as Partial<GameProgress>;
    return {
      band: typeof p.band === 'string' ? p.band : '',
      knobs: Array.isArray(p.knobs) ? p.knobs.filter((n) => Number.isInteger(n) && n >= 0 && n < 128) : [],
      passed: p.passed && typeof p.passed === 'object' ? p.passed : {},
      xp: typeof p.xp === 'number' ? p.xp : 0,
    };
  } catch {
    return { ...NEW_GAME };
  }
}

export function saveProgress(p: GameProgress, storage: Pick<Storage, 'setItem'> | undefined = safeStorage()): void {
  try {
    storage?.setItem(KEY, JSON.stringify(p));
  } catch {
    // storage unavailable: progress lasts this session only
  }
}

function safeStorage(): Storage | undefined {
  try {
    return typeof localStorage === 'undefined' ? undefined : localStorage;
  } catch {
    return undefined;
  }
}
