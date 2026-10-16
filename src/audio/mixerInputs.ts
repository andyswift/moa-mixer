export const INTERNAL = '@internal';
export const NONE = '@none';

/** `INTERNAL`, `NONE`, or the name of a published port (names, not ids: ids change every time a tab loads). */
export type Selection = string;

export type InputStatus = 'idle' | 'internal' | 'none' | 'connecting' | 'live' | 'missing';

/** What the mixer inputs need from the page: the live ports, the in-page cables, and a way to play a port into a jack. */
export interface InputHost {
  ports(): { id: string; name: string }[];
  /** Whether this input jack has an in-page instrument cabled to it at all. */
  hasInternal(jack: string): boolean;
  /** Connects or cuts the in-page cable that normally feeds this input jack. */
  setInternal(jack: string, on: boolean): void;
  /** Plays a port into the jack. Resolves with a function that disconnects it. */
  attach(jack: string, portId: string): Promise<() => void>;
}

const DEFAULT_STORAGE_KEY = 'moa.mixerInputs';

interface Slot {
  selection: Selection;
  internal: boolean;
  portId?: string;
  detach?: () => void;
  pending?: string;
  status: InputStatus;
}

/**
 * Which source feeds each mixer input: the instrument built into this page, nothing, or another tab's audio port.
 * Choices are remembered by port name. Ports come and go as instrument tabs open and close; `reconcile` follows them.
 */
export class MixerInputs {
  private readonly slots = new Map<string, Slot>();
  private readonly listeners = new Set<() => void>();
  private ready = false;

  constructor(
    private readonly host: InputHost,
    readonly jacks: string[],
    defaults: Record<string, Selection> = {},
    private readonly storage: Pick<Storage, 'getItem' | 'setItem'> | undefined = safeStorage(),
    /** Where the choices are remembered; every page that chooses inputs uses its own. */
    private readonly storageKey = DEFAULT_STORAGE_KEY,
  ) {
    const saved = load(storage, storageKey);
    for (const jack of jacks) {
      this.slots.set(jack, { selection: saved[jack] ?? defaults[jack] ?? (host.hasInternal(jack) ? INTERNAL : NONE), internal: true, status: 'idle' });
    }
  }

  selection(jack: string): Selection {
    return this.slot(jack).selection;
  }

  status(jack: string): InputStatus {
    return this.slot(jack).status;
  }

  /** Whether the choice 'built-in' exists for this input. */
  hasInternal(jack: string): boolean {
    return this.host.hasInternal(jack);
  }

  /** Port names available right now, in the order the ports were announced. */
  portNames(): string[] {
    return [...new Set(this.host.ports().map((p) => p.name))];
  }

  /** Chooses a source for an input. `remember` keeps the choice for next time (a song's routing does not). */
  setSelection(jack: string, selection: Selection, remember = true): void {
    this.slot(jack).selection = selection;
    if (remember) {
      try {
        this.storage?.setItem(this.storageKey, JSON.stringify(Object.fromEntries([...this.slots].map(([j, s]) => [j, s.selection]))));
      } catch {
        // not remembered
      }
    }
    this.reconcile();
  }

  /** Audio is running: from now on selections are connected. */
  start(): void {
    this.ready = true;
    this.reconcile();
  }

  /** Brings every input in line with its selection and the ports that exist now. */
  reconcile(): void {
    for (const [jack, slot] of this.slots) this.reconcileOne(jack, slot);
    for (const l of this.listeners) l();
  }

  onChange(fn: () => void): () => void {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  }

  private reconcileOne(jack: string, slot: Slot): void {
    const wantInternal = slot.selection === INTERNAL;
    if (!this.ready) {
      slot.status = 'idle';
      return;
    }
    const port = wantInternal || slot.selection === NONE ? undefined : this.host.ports().find((p) => p.name === slot.selection);
    if (!port) this.release(slot); // disconnect a port before the in-page cable comes back
    if (slot.internal !== wantInternal) {
      this.host.setInternal(jack, wantInternal);
      slot.internal = wantInternal;
    }
    if (!port) {
      slot.status = wantInternal ? 'internal' : slot.selection === NONE ? 'none' : 'missing';
      return;
    }
    if (slot.portId === port.id || slot.pending === port.id) return;
    this.release(slot);
    slot.pending = port.id;
    slot.status = 'connecting';
    void this.host.attach(jack, port.id).then((detach) => {
      if (slot.pending !== port.id) {
        detach(); // the selection changed while this was connecting
        return;
      }
      slot.pending = undefined;
      slot.portId = port.id;
      slot.detach = detach;
      slot.status = 'live';
      for (const l of this.listeners) l();
    }, () => {
      if (slot.pending === port.id) slot.pending = undefined;
      slot.status = 'missing';
      for (const l of this.listeners) l();
    });
  }

  private release(slot: Slot): void {
    slot.detach?.();
    slot.detach = undefined;
    slot.portId = undefined;
    slot.pending = undefined;
  }

  private slot(jack: string): Slot {
    const s = this.slots.get(jack);
    if (!s) throw new Error(`Unknown input: ${jack}`);
    return s;
  }
}

function safeStorage(): Storage | undefined {
  try {
    return typeof localStorage === 'undefined' ? undefined : localStorage;
  } catch {
    return undefined;
  }
}

function load(storage: Pick<Storage, 'getItem'> | undefined, key: string): Record<string, Selection> {
  try {
    const parsed: unknown = JSON.parse(storage?.getItem(key) ?? '{}');
    return parsed && typeof parsed === 'object' ? (parsed as Record<string, Selection>) : {};
  } catch {
    return {};
  }
}
