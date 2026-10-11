// Internal signal graph. Audio and CV are the same thing here: a cable carries "voltage".
// Not exported to the UI layer — devices wrap a Circuit and expose controls instead.

// 'meter' taps a signal for level display (option `channel`: mono | left | right).
// 'random' is a sample-and-hold source: a new random value in -1..1 `rate` times per second.
// 'trigger' is a one-shot envelope for percussion: `trigger(id, velocity)` fires it, `choke(id)` cuts it short.
// Params: peak (output at full velocity), decay (s), velSens (0..1: how much velocity scales the peak), and for
// shape 'clap' the `spread` (s) between the stuttered bursts that precede the tail.
export type NodeKind = 'oscillator' | 'filter' | 'gain' | 'pan' | 'envelope' | 'trigger' | 'constant' | 'waveshaper' | 'noise' | 'random' | 'meter';

export interface CircuitNode {
  readonly id: string;
  readonly kind: NodeKind;
  readonly params: Record<string, number>;
  readonly options: Record<string, string>;
}

/** `port` is 'in' for signal input, or the name of a param to modulate (CV). */
export interface Cable {
  readonly from: string;
  readonly to: string;
  readonly port: string;
}

export type CircuitChange =
  | { type: 'param'; nodeId: string; name: string; value: number }
  | { type: 'option'; nodeId: string; name: string; value: string }
  | { type: 'trigger'; nodeId: string; velocity: number }
  | { type: 'choke'; nodeId: string };

export class Circuit {
  readonly nodes = new Map<string, CircuitNode>();
  readonly cables: Cable[] = [];
  private listeners = new Set<(c: CircuitChange) => void>();

  add(
    id: string,
    kind: NodeKind,
    params: Record<string, number> = {},
    options: Record<string, string> = {},
  ): this {
    if (this.nodes.has(id)) throw new Error(`Duplicate node id: ${id}`);
    this.nodes.set(id, { id, kind, params: { ...params }, options: { ...options } });
    return this;
  }

  connect(from: string, to: string, port = 'in'): this {
    this.node(from);
    const target = this.node(to);
    if (port !== 'in' && !(port in target.params)) {
      throw new Error(`Node ${to} has no param ${port}`);
    }
    if (this.cables.some((c) => c.from === from && c.to === to && c.port === port)) {
      throw new Error(`Duplicate cable ${from} -> ${to}.${port}`);
    }
    this.cables.push({ from, to, port });
    return this;
  }

  setParam(nodeId: string, name: string, value: number): void {
    const node = this.node(nodeId);
    if (!(name in node.params)) throw new Error(`Node ${nodeId} has no param ${name}`);
    node.params[name] = value;
    this.emit({ type: 'param', nodeId, name, value });
  }

  setOption(nodeId: string, name: string, value: string): void {
    const node = this.node(nodeId);
    if (!(name in node.options)) throw new Error(`Node ${nodeId} has no option ${name}`);
    node.options[name] = value;
    this.emit({ type: 'option', nodeId, name, value });
  }

  /** Fires a one-shot envelope; `velocity` is 0..1. */
  trigger(nodeId: string, velocity = 1): void {
    this.expectKind(nodeId, 'trigger');
    this.emit({ type: 'trigger', nodeId, velocity: Math.min(1, Math.max(0, velocity)) });
  }

  /** Cuts a one-shot envelope short (a fast fade to silence), e.g. a closed hat choking an open hat. */
  choke(nodeId: string): void {
    this.expectKind(nodeId, 'trigger');
    this.emit({ type: 'choke', nodeId });
  }

  onChange(fn: (c: CircuitChange) => void): () => void {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  }

  node(id: string): CircuitNode {
    const n = this.nodes.get(id);
    if (!n) throw new Error(`Unknown node: ${id}`);
    return n;
  }

  private expectKind(nodeId: string, kind: NodeKind): void {
    if (this.node(nodeId).kind !== kind) throw new Error(`Node ${nodeId} is not a ${kind}`);
  }

  private emit(c: CircuitChange): void {
    for (const l of this.listeners) l(c);
  }
}
