import { BRAIDS_OSCILLATORS_SOURCE } from './braidsOscillators';
import { BRAIDS_TABLES_SOURCE } from './braidsTables';

/** Braids' macro oscillator and its tables, as one piece of worklet source text (port of Mutable Instruments' code, MIT). */
export const BRAIDS_SOURCE = [BRAIDS_TABLES_SOURCE, BRAIDS_OSCILLATORS_SOURCE].join('\n');
