import { applyBalance } from '../balance';
import type { Song } from '../types';
import { acidWorkbench } from './acidWorkbench';
import { blackFjordLiturgy } from './blackFjordLiturgy';
import { coldMirrorBall } from './coldMirrorBall';
import { glassGarden } from './glassGarden';
import { oddHours } from './oddHours';
import { overheadRain } from './overheadRain';
import { pierLights } from './pierLights';
import { steppersSermon } from './steppersSermon';
import { sunEngine } from './sunEngine';

/** Every song in the collection. Songs that imitate real recordings are flagged `localOnly` and left out of production builds. */
export function library(): Song[] {
  const all = [glassGarden(), blackFjordLiturgy(), steppersSermon(), overheadRain(), acidWorkbench(), oddHours(), sunEngine(), coldMirrorBall(), pierLights()].map(applyBalance);
  return import.meta.env.DEV ? all : all.filter((s) => !s.localOnly);
}
