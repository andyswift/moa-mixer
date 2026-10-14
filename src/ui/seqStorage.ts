import type { BankStore } from '../domain/sequencer/controller';
import { type Bank, demoBank, sanitiseTrack } from '../domain/sequencer/track';

const SLOT_KEY = (n: number) => `moa-seq.bank.${n}`;
const CURRENT_KEY = 'moa-seq.current';

function parse(raw: string | null): Bank | undefined {
  if (!raw) return undefined;
  try {
    const b = JSON.parse(raw) as Bank;
    if (!b || typeof b.tempo !== 'number' || !Array.isArray(b.patterns) || b.patterns.length !== 16) return undefined;
    for (const p of b.patterns) p.tracks = p.tracks.map(sanitiseTrack);
    return b;
  } catch {
    return undefined;
  }
}

/** Banks in the browser's local storage: sixteen saved slots plus an autosave of the working bank, like the T-1. */
export const bankStore: BankStore = {
  load: (slot) => {
    try {
      return parse(localStorage.getItem(SLOT_KEY(slot)));
    } catch {
      return undefined;
    }
  },
  save: (slot, bank) => {
    try {
      localStorage.setItem(SLOT_KEY(slot), JSON.stringify(bank));
    } catch {
      // not saved (private window or blocked storage)
    }
  },
  saved: () => {
    try {
      return Array.from({ length: 16 }, (_, i) => localStorage.getItem(SLOT_KEY(i)) !== null);
    } catch {
      return new Array<boolean>(16).fill(false);
    }
  },
};

/** The bank the page was last using (and its slot), or the demo bank on the first visit. */
export function loadCurrent(): { bank: Bank; slot: number } {
  try {
    const raw = localStorage.getItem(CURRENT_KEY);
    if (raw) {
      const { slot, bank } = JSON.parse(raw) as { slot: number; bank: Bank };
      const b = parse(JSON.stringify(bank));
      if (b) return { bank: b, slot: Math.min(15, Math.max(0, slot | 0)) };
    }
  } catch {
    // fall through to the demo
  }
  return { bank: demoBank(), slot: 0 };
}

export function saveCurrent(bank: Bank, slot: number): void {
  try {
    localStorage.setItem(CURRENT_KEY, JSON.stringify({ slot, bank }));
  } catch {
    // not remembered
  }
}
