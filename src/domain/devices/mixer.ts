import { Device } from './device';
import { NumberControl, ToggleControl } from './controls';

/** Mixer with N channel strips feeding one stereo bus. (More buses/aux come in later iterations.) */
export class Mixer extends Device {
  readonly name: string;

  constructor(readonly channelCount = 1, name = 'Mixer') {
    super();
    this.name = name;
    const c = this.circuit;
    c.add('main', 'gain', { gain: 1 });
    this.outputList.push({ name: 'main', nodeId: 'main' });

    for (let i = 1; i <= channelCount; i++) {
      const fader = `ch${i}.fader`;
      const mute = `ch${i}.mute`;
      c.add(fader, 'gain', { gain: 0.8 })
        .add(mute, 'gain', { gain: 1 })
        .connect(fader, mute)
        .connect(mute, 'main');
      this.inputList.push({ name: `ch${i}`, nodeId: fader });
      this.controlList.push(
        new NumberControl(fader, `Ch ${i}`, 0, 1.5, 0.8, '', (v) => c.setParam(fader, 'gain', v)),
        new ToggleControl(mute, `Mute ${i}`, false, (on) => c.setParam(mute, 'gain', on ? 0 : 1)),
      );
    }

    this.controlList.push(
      new NumberControl('main.fader', 'Main', 0, 1.5, 1, '', (v) => c.setParam('main', 'gain', v)),
    );
  }
}
