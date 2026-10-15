import type { Song } from '../types';
import { twoStepSunrise } from './twoStepSunrise';

/** Every song in the collection. Songs that imitate real recordings are flagged `localOnly` and left out of production builds. */
export function library(): Song[] {
  const all = [twoStepSunrise()];
  return import.meta.env.DEV ? all : all.filter((s) => !s.localOnly);
}
