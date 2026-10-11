export type MidiStatus = 'unsupported' | 'idle' | 'ready' | 'denied';

export interface MidiInputInfo {
  id: string;
  name: string;
}

const STORAGE_KEY = 'moa.midiInput';

/** Browser adapter: Web MIDI access, input discovery and selection. Parsing lives in the domain layer. */
export class WebMidi {
  status: MidiStatus = typeof navigator !== 'undefined' && 'requestMIDIAccess' in navigator ? 'idle' : 'unsupported';
  inputs: MidiInputInfo[] = [];
  selectedId?: string;
  /** Raw message bytes with the browser's timestamp (same time base as performance.now()). */
  onMessage?: (data: Uint8Array, timeStamp: number) => void;
  private access?: MIDIAccess;
  private listeners = new Set<() => void>();

  /** Asks for access. The browser shows a permission prompt the first time. */
  async connect(): Promise<void> {
    if (this.status === 'unsupported') return;
    try {
      this.access = await navigator.requestMIDIAccess({ sysex: false });
    } catch {
      this.status = 'denied';
      this.emit();
      return;
    }
    this.status = 'ready';
    this.access.onstatechange = () => this.refresh();
    this.refresh();
  }

  /** If the user already granted permission earlier, reconnect without a click. */
  async connectIfPermitted(): Promise<void> {
    if (this.status !== 'idle') return;
    try {
      const permission = await navigator.permissions.query({ name: 'midi' as PermissionName });
      if (permission.state === 'granted') await this.connect();
    } catch {
      // Permissions API not available for MIDI: wait for the user to click Connect.
    }
  }

  select(id: string | undefined): void {
    if (this.access) for (const input of this.access.inputs.values()) input.onmidimessage = null;
    this.selectedId = id;
    if (id) {
      const input = this.access?.inputs.get(id);
      if (input) {
        input.onmidimessage = (e) => {
          if (e.data) this.onMessage?.(e.data, e.timeStamp);
        };
      }
      try {
        localStorage.setItem(STORAGE_KEY, id);
      } catch {
        // storage unavailable: the choice just isn't remembered
      }
    }
    this.emit();
  }

  onChange(fn: () => void): () => void {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  }

  private refresh(): void {
    this.inputs = [...(this.access?.inputs.values() ?? [])].map((i) => ({ id: i.id, name: i.name ?? i.id }));
    const stillThere = this.selectedId && this.inputs.some((i) => i.id === this.selectedId);
    if (!stillThere) this.select(this.pickDefault());
    else this.emit();
  }

  /** Prefer the remembered device, then a Torso, then the only device if there is just one. */
  private pickDefault(): string | undefined {
    let remembered: string | null = null;
    try {
      remembered = localStorage.getItem(STORAGE_KEY);
    } catch {
      // ignore
    }
    return (
      this.inputs.find((i) => i.id === remembered)?.id ??
      this.inputs.find((i) => /torso|t-?1/i.test(i.name))?.id ??
      (this.inputs.length === 1 ? this.inputs[0]?.id : undefined)
    );
  }

  private emit(): void {
    for (const l of this.listeners) l();
  }
}
