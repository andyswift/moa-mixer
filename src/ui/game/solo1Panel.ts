import type { Control } from '../../domain/devices/controls';
import type { PresetValues } from '../../domain/devices/synthPresets';
import { position } from '../../domain/game/scoring';
import { h } from './dom';

/** An instrument's face for a lesson: its name and the controls it shows, in sections, as sliders. */
export interface PanelSpec {
  readonly brand: string;
  readonly kind: string;
  /** The face's look: the SOLO-1's grey or the bass rig's black. */
  readonly theme: 'solo1' | 'rig';
  readonly sections: readonly { name: string; items: readonly (readonly [string, string])[] }[];
}

export const SOLO1: PanelSpec = {
  brand: 'SOLO-1',
  kind: 'MONOPHONIC SYNTHESIZER',
  theme: 'solo1',
  sections: [
    { name: 'VCO', items: [['osc.range', 'RANGE'], ['osc.mod', 'MOD']] },
    { name: 'LFO', items: [['lfo.rate', 'RATE'], ['lfo.wave', 'WAVE']] },
    { name: 'SOURCE MIXER', items: [['mix.saw', 'SAW'], ['mix.pulse', 'PULSE'], ['mix.sub', 'SUB'], ['mix.noise', 'NOISE']] },
    { name: 'VCF', items: [['filter.cutoff', 'FREQ'], ['filter.resonance', 'RES'], ['filterEnv.amount', 'ENV']] },
    { name: 'ENV', items: [['filterEnv.attack', 'A'], ['filterEnv.decay', 'D'], ['filterEnv.sustain', 'S'], ['filterEnv.release', 'R']] },
  ],
};

export const BASS_RIG: PanelSpec = {
  brand: 'BASS RIG',
  kind: 'FOUR-STRING BASS · AMP · 4×10',
  theme: 'rig',
  sections: [
    { name: 'HANDS', items: [['pluck.position', 'PLUCK'], ['pluck.strength', 'FORCE'], ['palm', 'PALM']] },
    { name: 'BASS', items: [['pickup.position', 'PICKUP'], ['tone', 'TONE']] },
    { name: 'AMP', items: [['amp.gain', 'GAIN'], ['amp.bass', 'BASS'], ['amp.mid', 'MID'], ['amp.treble', 'TREBLE']] },
    { name: 'CABINET', items: [['cab.blend', 'DI/CAB'], ['level', 'LEVEL']] },
  ],
};

/** A control's name as the player sees it on the panel and in the scores. */
export const PANEL_NAMES: Readonly<Record<string, string>> = {
  'osc.range': 'Range', 'osc.mod': 'Mod (vibrato)', 'lfo.rate': 'LFO rate', 'lfo.wave': 'LFO wave',
  'mix.saw': 'Saw', 'mix.pulse': 'Pulse', 'mix.sub': 'Sub', 'mix.noise': 'Noise',
  'filter.cutoff': 'Cutoff', 'filter.resonance': 'Resonance', 'filterEnv.amount': 'Env amount',
  'filterEnv.attack': 'Attack', 'filterEnv.decay': 'Decay', 'filterEnv.sustain': 'Sustain', 'filterEnv.release': 'Release',
  'pluck.position': 'Pluck position', 'pluck.strength': 'Pluck force', palm: 'Palm mute', 'pickup.position': 'Pickup position',
  tone: 'Tone', 'amp.gain': 'Amp gain', 'amp.bass': 'Amp bass', 'amp.mid': 'Amp mid', 'amp.treble': 'Amp treble',
  'cab.blend': 'DI / cabinet', level: 'Level',
};

const TRACK_PX = 160;
const CAP_PX = 12;

/** A control's value in the units a player reads. */
export function formatValue(control: Control, value: number | string = control.value as number | string): string {
  if (typeof value === 'string') return value;
  if (control.kind !== 'number') return String(value);
  switch (control.unit) {
    case 'Hz': return value >= 1000 ? `${(value / 1000).toFixed(1)} kHz` : value >= 20 ? `${Math.round(value)} Hz` : `${value.toFixed(1)} Hz`;
    case 's': return value < 1 ? `${Math.round(value * 1000)} ms` : `${value.toFixed(1)} s`;
    case 'oct': return `${value.toFixed(1)} oct`;
    case 'ct': return `${Math.round(value)} ct`;
    case 'm': return `${Math.round(value * 100)} cm`;
    case 'dB': return `${value > 0 ? '+' : ''}${value.toFixed(1)} dB`;
    case '': return control.max === 1 ? `${Math.round(value * 100)}%` : value.toFixed(1);
    default: return `${Math.round(value)}${control.unit}`;
  }
}

export interface InstrumentPanel {
  readonly el: HTMLElement;
  /** Which controls the knobs turn (knob 1 first); the rest are shown locked. */
  setActive(ids: readonly string[]): void;
  /** Where the target sits, shown as dashed caps; undefined hides them. */
  setGhost(target: PresetValues | undefined): void;
  /** While frozen the sliders hold still (so "Hear the target" does not give the target away). */
  freeze(on: boolean): void;
  dispose(): void;
}

export function renderPanel(spec: PanelSpec, control: (id: string) => Control): InstrumentPanel {
  const sliders = new Map<string, { root: HTMLElement; cap: HTMLElement; ghost: HTMLElement; val: HTMLElement; tag: HTMLElement }>();
  const offs: (() => void)[] = [];
  let frozen = false;

  const sections = spec.sections.map((s) =>
    h('div.solo1-section', null,
      h('span.sname', null, s.name),
      h('div.sliders', null, ...s.items.map(([id, label]) => {
        const tag = h('span.knobtag.blank', null, 'K0');
        const cap = h('div.cap');
        const ghost = h('div.ghost', { hidden: true });
        const val = h('span.val');
        const root = h('div.solo1-slider.locked', { role: 'img', 'aria-label': PANEL_NAMES[id] ?? label },
          tag, h('div.track', null, ghost, cap), h('span.lbl', null, label), val);
        sliders.set(id, { root, cap, ghost, val, tag });
        offs.push(control(id).onChange(() => update(id)));
        return root;
      })),
    ),
  );

  const place = (el: HTMLElement, t: number) => { el.style.top = `${Math.round((1 - t) * (TRACK_PX - CAP_PX))}px`; };
  function update(id: string): void {
    if (frozen) return;
    const s = sliders.get(id)!;
    const c = control(id);
    place(s.cap, position(c));
    s.val.textContent = formatValue(c);
    s.root.setAttribute('aria-label', `${PANEL_NAMES[id]}: ${formatValue(c)}`);
  }
  for (const id of sliders.keys()) update(id);

  const el = h(`div.solo1${spec.theme === 'rig' ? '.rig' : ''}` as 'div', null,
    h('div.solo1-head', null, h('span.brand', null, spec.brand), h('span.kind', null, spec.kind)),
    h('div.solo1-sections', null, ...sections),
  );

  return {
    el,
    setActive(ids) {
      for (const [id, s] of sliders) {
        const k = ids.indexOf(id);
        s.root.classList.toggle('active', k >= 0);
        s.root.classList.toggle('locked', k < 0);
        s.tag.classList.toggle('blank', k < 0);
        s.tag.textContent = `K${k + 1}`;
      }
    },
    setGhost(target) {
      for (const [id, s] of sliders) {
        const v = target?.[id];
        s.ghost.hidden = v === undefined;
        if (v !== undefined) place(s.ghost, position(control(id), v));
      }
    },
    freeze(on) {
      frozen = on;
      if (!on) for (const id of sliders.keys()) update(id);
    },
    dispose() {
      for (const off of offs) off();
    },
  };
}
