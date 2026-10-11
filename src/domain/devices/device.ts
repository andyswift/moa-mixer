import { Circuit } from '../circuit/circuit';
import type { Control } from './controls';

/** A named audio connection point on a device, backed by a node inside its circuit. */
export interface Jack {
  readonly name: string;
  readonly nodeId: string;
}

export abstract class Device {
  readonly circuit = new Circuit();
  abstract readonly name: string;
  protected readonly controlList: Control[] = [];
  protected readonly inputList: Jack[] = [];
  protected readonly outputList: Jack[] = [];

  get controls(): readonly Control[] {
    return this.controlList;
  }
  get inputs(): readonly Jack[] {
    return this.inputList;
  }
  get outputs(): readonly Jack[] {
    return this.outputList;
  }

  control(id: string): Control {
    const c = this.controlList.find((x) => x.id === id);
    if (!c) throw new Error(`${this.name} has no control ${id}`);
    return c;
  }

  jack(direction: 'in' | 'out', name: string): Jack {
    const j = (direction === 'in' ? this.inputList : this.outputList).find((x) => x.name === name);
    if (!j) throw new Error(`${this.name} has no ${direction} jack ${name}`);
    return j;
  }
}
