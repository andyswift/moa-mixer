// User-facing controls. These are the only way the UI touches a device.

export class NumberControl {
  readonly kind = 'number' as const;
  private current: number;

  constructor(
    readonly id: string,
    readonly label: string,
    readonly min: number,
    readonly max: number,
    readonly initial: number,
    readonly unit: string,
    private readonly apply: (v: number) => void,
    readonly curve: 'linear' | 'log' = 'linear',
  ) {
    this.current = clamp(this.initial, min, max);
    this.apply(this.current);
  }

  get value(): number {
    return this.current;
  }

  set(v: number): void {
    this.current = clamp(v, this.min, this.max);
    this.apply(this.current);
  }
}

export class ChoiceControl {
  readonly kind = 'choice' as const;
  private current: string;

  constructor(
    readonly id: string,
    readonly label: string,
    readonly options: readonly string[],
    initial: string,
    private readonly apply: (v: string) => void,
  ) {
    if (!options.includes(initial)) throw new Error(`Invalid initial choice ${initial}`);
    this.current = initial;
    this.apply(this.current);
  }

  get value(): string {
    return this.current;
  }

  set(v: string): void {
    if (!this.options.includes(v)) throw new Error(`Invalid choice ${v} for ${this.id}`);
    this.current = v;
    this.apply(v);
  }
}

export class ToggleControl {
  readonly kind = 'toggle' as const;
  private current: boolean;

  constructor(
    readonly id: string,
    readonly label: string,
    initial: boolean,
    private readonly apply: (v: boolean) => void,
  ) {
    this.current = initial;
    this.apply(initial);
  }

  get value(): boolean {
    return this.current;
  }

  set(v: boolean): void {
    this.current = v;
    this.apply(v);
  }
}

export type Control = NumberControl | ChoiceControl | ToggleControl;

function clamp(v: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, v));
}
