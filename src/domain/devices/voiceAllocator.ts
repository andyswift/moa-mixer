export const VOICE_MODES = ['poly', 'mono', 'unison'] as const;
export type VoiceMode = (typeof VOICE_MODES)[number];

export type VoiceAction =
  | { kind: 'on'; voice: number; note: number; retrigger: boolean; glide: boolean }
  | { kind: 'off'; voice: number };

interface Voice {
  note?: number;
  gate: boolean;
  /** When the voice last changed state (bigger = more recent). Oldest-released voices are reused first. */
  since: number;
}

/**
 * Decides which voice plays which note; the synth applies the returned actions.
 * - poly: each note takes a free voice (the one released longest ago), else steals the oldest sounding one.
 * - mono: voice 0 only, last-note priority; a note played over a held one glides and does not retrigger.
 * - unison: every voice plays the same note, with the same last-note and legato rules as mono.
 */
export class VoiceAllocator {
  mode: VoiceMode = 'poly';
  private readonly voices: Voice[];
  private held: number[] = []; // mono/unison note stack, most recent last
  private clock = 0;

  constructor(readonly count: number) {
    this.voices = Array.from({ length: count }, () => ({ gate: false, since: 0 }));
  }

  /** Is this voice's key held right now (not merely in its release tail)? */
  isActive(voice: number): boolean {
    return this.voices[voice]!.gate;
  }

  get activeCount(): number {
    return this.voices.filter((v) => v.gate).length;
  }

  noteOn(note: number): VoiceAction[] {
    return this.mode === 'poly' ? this.polyOn(note) : this.stackOn(note);
  }

  noteOff(note: number): VoiceAction[] {
    return this.mode === 'poly' ? this.polyOff(note) : this.stackOff(note);
  }

  releaseAll(): VoiceAction[] {
    this.held = [];
    const actions: VoiceAction[] = [];
    this.voices.forEach((v, i) => {
      if (!v.gate) return;
      v.gate = false;
      v.since = ++this.clock;
      actions.push({ kind: 'off', voice: i });
    });
    return actions;
  }

  /** Voices a note played in this mode sounds on. */
  private get active(): number[] {
    if (this.mode === 'mono') return [0];
    return this.voices.map((_, i) => i);
  }

  private polyOn(note: number): VoiceAction[] {
    let index = this.voices.findIndex((v) => v.gate && v.note === note);
    if (index < 0) {
      const free = this.voices.map((v, i) => ({ v, i })).filter((x) => !x.v.gate);
      const pool = free.length ? free : this.voices.map((v, i) => ({ v, i }));
      index = pool.reduce((best, x) => (x.v.since < best.v.since ? x : best)).i;
    }
    const voice = this.voices[index]!;
    voice.note = note;
    voice.gate = true;
    voice.since = ++this.clock;
    return [{ kind: 'on', voice: index, note, retrigger: true, glide: true }];
  }

  private polyOff(note: number): VoiceAction[] {
    const actions: VoiceAction[] = [];
    this.voices.forEach((v, i) => {
      if (v.gate && v.note === note) {
        v.gate = false;
        v.since = ++this.clock;
        actions.push({ kind: 'off', voice: i });
      }
    });
    return actions;
  }

  private stackOn(note: number): VoiceAction[] {
    const overlapping = this.voices[this.active[0]!]!.gate;
    this.held = this.held.filter((n) => n !== note);
    this.held.push(note);
    return this.play(note, !overlapping, overlapping);
  }

  private stackOff(note: number): VoiceAction[] {
    this.held = this.held.filter((n) => n !== note);
    const previous = this.held[this.held.length - 1];
    if (previous !== undefined) return this.play(previous, false, true);
    const actions: VoiceAction[] = [];
    for (const i of this.active) {
      const v = this.voices[i]!;
      if (!v.gate) continue;
      v.gate = false;
      v.since = ++this.clock;
      actions.push({ kind: 'off', voice: i });
    }
    return actions;
  }

  private play(note: number, retrigger: boolean, glide: boolean): VoiceAction[] {
    return this.active.map((i) => {
      const v = this.voices[i]!;
      // A voice whose key is up (release tail) always retriggers, even in a legato run.
      const again = retrigger || !v.gate;
      v.note = note;
      v.gate = true;
      v.since = ++this.clock;
      return { kind: 'on', voice: i, note, retrigger: again, glide: glide && !again };
    });
  }
}
