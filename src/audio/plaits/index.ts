import { PLAITS_DSP_SOURCE } from './plaitsDsp';
import { PLAITS_ENGINES_SOURCE } from './plaitsEngines';
import { PLAITS_TABLES_SOURCE } from './plaitsTables';

/** Plaits' engines and what they need, as one piece of worklet source text (port of Mutable Instruments' code, MIT). */
export const PLAITS_SOURCE = [PLAITS_TABLES_SOURCE, PLAITS_DSP_SOURCE, PLAITS_ENGINES_SOURCE].join('\n');
