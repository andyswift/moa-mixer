export type MonitorMode = 'auto' | 'on' | 'off';

const STORAGE_KEY = 'moa.monitor';

/**
 * Whether an instrument page plays its own audio to its own speakers. 'auto' (the default) plays it only while no
 * other tab is listening to the page's audio ports, so with a mixer connected you do not hear everything twice.
 */
export class MonitorControl {
  mode: MonitorMode = 'auto';
  private readonly listeners = new Set<() => void>();

  constructor(
    private readonly audience: () => number,
    private readonly apply: (on: boolean) => void,
    private readonly storage: Pick<Storage, 'getItem' | 'setItem'> | undefined = safeStorage(),
  ) {
    const saved = storage?.getItem(STORAGE_KEY);
    if (saved === 'on' || saved === 'off' || saved === 'auto') this.mode = saved;
  }

  /** Whether the speakers should be on right now. */
  get on(): boolean {
    return this.mode === 'on' || (this.mode === 'auto' && this.audience() === 0);
  }

  setMode(mode: MonitorMode): void {
    this.mode = mode;
    try {
      this.storage?.setItem(STORAGE_KEY, mode);
    } catch {
      // not remembered
    }
    this.update();
  }

  /** Re-applies the state; call when the audience changes. */
  update(): void {
    this.apply(this.on);
    for (const l of this.listeners) l();
  }

  onChange(fn: () => void): () => void {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  }
}

function safeStorage(): Storage | undefined {
  try {
    return typeof localStorage === 'undefined' ? undefined : localStorage;
  } catch {
    return undefined;
  }
}
