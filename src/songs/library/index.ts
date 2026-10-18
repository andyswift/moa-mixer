import { applyBalance } from '../balance';
import type { Song } from '../types';
import { acidWorkbench } from './acidWorkbench';
import { cowbellDiplomacy } from './cowbellDiplomacy';
import { blackFjordLiturgy } from './blackFjordLiturgy';
import { fjordLight } from './fjordLight';
import { glassGarden } from './glassGarden';
import { neonHands } from './neonHands';
import { squelchTheory } from './squelchTheory';
import { steppersSermon } from './steppersSermon';
import { twoStepSunrise } from './twoStepSunrise';

/** Every song in the collection. Songs that imitate real recordings are flagged `localOnly` and left out of production builds. */
export function library(): Song[] {
  const all = [twoStepSunrise(), neonHands(), glassGarden(), fjordLight(), blackFjordLiturgy(), squelchTheory(), cowbellDiplomacy(), steppersSermon(), acidWorkbench()].map(applyBalance);
  return import.meta.env.DEV ? all : all.filter((s) => !s.localOnly);
}
