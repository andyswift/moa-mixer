/**
 * The MOA-RIG's mixer and effects, as params: a strip per part (p1..p16) and per return (rA..rD, the effects coming
 * back), the four send effects, the drive insert, the master compressor and the master. The worklet keeps them in a
 * table built from this list (`rigMixWorklet.ts`); the device makes a control of each.
 *
 * A strip: three-band EQ (dB; -30 is a kill), FILTER (one knob: left a low-pass closing, right a high-pass opening,
 * centre off), PAN, sends A to D (after the fader; a return can send to itself), MUTE, SOLO, THROW A (send A full
 * while held), and the fader (gain: 1 is 0 dB, 2 is +6 dB).
 */
export interface RigMixParam {
  id: string;
  label: string;
  kind: 'number' | 'choice' | 'toggle';
  min: number;
  max: number;
  def: number;
  unit?: string;
  curve?: 'linear' | 'log';
  options?: readonly string[];
}

export const RIG_MIX_PARTS = 16;
export const RIG_RETURNS = ['A', 'B', 'C', 'D'] as const;
/** Strip ids: the parts, then the returns. */
export const RIG_STRIPS: readonly string[] = [
  ...Array.from({ length: RIG_MIX_PARTS }, (_, i) => `p${i + 1}`), ...RIG_RETURNS.map((r) => `r${r}`),
];
/** What each return carries. */
export const RIG_RETURN_NAMES = ['DUB DELAY', 'BBD', 'REVERB', 'CHORUS'] as const;

/** Delay divisions when synced to the tempo, in beats. */
export const RIG_DELAY_DIVS = ['1/16', '1/8T', '1/8', '3/16', '1/4T', '1/4', '3/8', '1/2', '3/4', '1'] as const;
export const RIG_DELAY_DIV_BEATS = [0.25, 1 / 3, 0.5, 0.75, 2 / 3, 1, 1.5, 2, 3, 4] as const;
export const RIG_REVERB_TYPES = ['SPRING', 'PLATE', 'HALL'] as const;
export const RIG_CHORUS_MODES = ['I', 'II', 'I+II'] as const;
export const RIG_DRIVE_TYPES = ['TUBE', 'DIODE', 'FUZZ'] as const;
const PART_CHOICES = ['off', ...Array.from({ length: RIG_MIX_PARTS }, (_, i) => String(i + 1))];
const KEY_CHOICES = ['self', ...Array.from({ length: RIG_MIX_PARTS }, (_, i) => String(i + 1))];

const n = (id: string, label: string, min: number, max: number, def: number, unit = '', curve: 'linear' | 'log' = 'linear'): RigMixParam =>
  ({ id, label, kind: 'number', min, max, def, unit, curve });
const c = (id: string, label: string, options: readonly string[], def: string): RigMixParam =>
  ({ id, label, kind: 'choice', min: 0, max: options.length - 1, def: options.indexOf(def), options });
const t = (id: string, label: string, def = 0): RigMixParam => ({ id, label, kind: 'toggle', min: 0, max: 1, def });

function strip(s: string): RigMixParam[] {
  return [
    n(`${s}.hi`, 'High', -30, 6, 0, 'dB'), n(`${s}.mid`, 'Mid', -30, 6, 0, 'dB'), n(`${s}.lo`, 'Low', -30, 6, 0, 'dB'),
    n(`${s}.filter`, 'Filter', -1, 1, 0), n(`${s}.pan`, 'Pan', -1, 1, 0),
    n(`${s}.a`, 'Send A', 0, 1, 0), n(`${s}.b`, 'Send B', 0, 1, 0), n(`${s}.c`, 'Send C', 0, 1, 0), n(`${s}.d`, 'Send D', 0, 1, 0),
    t(`${s}.mute`, 'Mute'), t(`${s}.solo`, 'Solo'), t(`${s}.throw`, 'Throw A'),
    n(`${s}.fader`, 'Fader', 0, 2, 1),
  ];
}

export const RIG_MIX_PARAMS: readonly RigMixParam[] = [
  ...RIG_STRIPS.flatMap(strip),
  // A: dub delay, a tape echo: the time glides (pitching the repeats), wow, a darkening, saturating loop
  n('dub.time', 'Time', 0.02, 2, 0.375, 's', 'log'), t('dub.sync', 'Sync', 1), c('dub.div', 'Division', RIG_DELAY_DIVS, '3/16'),
  n('dub.fdbk', 'Feedback', 0, 1.2, 0.5), n('dub.tone', 'Tone', 300, 8000, 2500, 'Hz', 'log'),
  n('dub.wow', 'Wow', 0, 1, 0.25), n('dub.sat', 'Saturation', 0, 1, 0.3), t('dub.throw', 'Throw'),
  // B: a bucket-brigade delay, modulated, ageing to dark and gritty, mono or ping-pong
  n('bbd.time', 'Time', 0.02, 0.6, 0.32, 's', 'log'), t('bbd.sync', 'Sync'), c('bbd.div', 'Division', RIG_DELAY_DIVS, '1/8'),
  n('bbd.fdbk', 'Feedback', 0, 1.1, 0.4), n('bbd.mod', 'Mod', 0, 1, 0.25), n('bbd.rate', 'Rate', 0.05, 5, 0.6, 'Hz', 'log'),
  n('bbd.age', 'Age', 0, 1, 0.3), t('bbd.ping', 'Ping-pong', 1),
  // C: reverb
  n('rev.size', 'Size', 0, 1, 0.5), n('rev.damp', 'Damp', 0, 1, 0.4), n('rev.pre', 'Pre-delay', 0, 0.2, 0.02, 's'),
  n('rev.tone', 'Tone', 0, 1, 0.5), n('rev.shimmer', 'Shimmer', 0, 1, 0), c('rev.type', 'Type', RIG_REVERB_TYPES, 'PLATE'),
  t('rev.freeze', 'Freeze'),
  // D: a stereo chorus after the Juno's
  n('cho.rate', 'Rate', 0, 1, 0.5), n('cho.depth', 'Depth', 0, 1, 0.5), n('cho.width', 'Width', 0, 1, 1),
  c('cho.mode', 'Mode', RIG_CHORUS_MODES, 'I'),
  // the drive: an insert on one part, before its strip
  c('drv.part', 'Part', PART_CHOICES, 'off'), n('drv.drive', 'Drive', 0, 1, 0.5), n('drv.tone', 'Tone', 0, 1, 0.6),
  n('drv.blend', 'Blend', 0, 1, 1), n('drv.level', 'Level', 0, 1.5, 0.7), c('drv.type', 'Type', RIG_DRIVE_TYPES, 'TUBE'),
  // the master compressor, keyed by the mix itself or by a part (before its fader), through a high-pass
  n('cmp.thresh', 'Threshold', -40, 0, -10, 'dB'), n('cmp.ratio', 'Ratio', 1, 20, 1, ':1', 'log'),
  n('cmp.atk', 'Attack', 0.1, 100, 10, 'ms', 'log'), n('cmp.rel', 'Release', 20, 1000, 150, 'ms', 'log'),
  n('cmp.makeup', 'Make-up', 0, 18, 0, 'dB'), n('cmp.mix', 'Mix', 0, 1, 1), c('cmp.key', 'Key', KEY_CHOICES, 'self'),
  n('cmp.hpf', 'Key HPF', 20, 500, 20, 'Hz', 'log'),
  // the master: its fader, and a soft limit in the send buses so a return fed back into itself stays bounded
  n('master.fader', 'Master', 0, 2, 1), t('master.limit', 'Feedback limit', 1),
];

export const RIG_MIX_DEFAULTS: Readonly<Record<string, number>> = Object.fromEntries(RIG_MIX_PARAMS.map((p) => [p.id, p.def]));
