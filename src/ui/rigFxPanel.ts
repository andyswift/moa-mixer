import { ChoiceControl, type Control, NumberControl, type ToggleControl } from '../domain/devices/controls';
import { RIG_MIX_PARTS } from '../domain/devices/rigMix';
import {
  PEDAL_NAMES, PEDAL_SLOTS, PEDAL_TYPES, type PedalKnob, type PedalName, pedalId, pedalKnob, pedalValue,
} from '../domain/devices/rigPedals';
import type { RigSynth } from '../domain/devices/rigSynth';
import { renderChoice } from './rigPanel';
import { el, renderKnob } from './widgets';

/**
 * The MOA-RIG's FX page: each part's pedalboard, up to four insert effects in a chain between the part and its mixer
 * strip (rigPedals.ts). A row of the sixteen parts (each showing its pedals) picks the part, the same one the SYNTH
 * page edits; under it the part's four slots, left to right in the order the sound goes through them. Each pedal:
 * its type, a footswitch, MIX (dry/wet) and its own knobs, and arrows to move it along the chain.
 */
const ORANGE = '#ff8466', LIME = '#d6ef6a', PINK = '#ffa3c7';
/** Each type's colour on the board. */
export const PEDAL_COLOURS: Record<string, string> = {
  DRIVE: ORANGE, COMP: '#ecece6', FILTER: '#ffd84a', PHASER: '#c9a3ff', FLANGER: '#c9a3ff', CHORUS: '#8fc3ff', TREMOLO: '#7fe0c4',
  'RING MOD': PINK, BITCRUSH: PINK, DELAY: '#8fc3ff', BEADS: '#8fc3ff',
};
export const PEDAL_SHORT: Record<string, string> = { DRIVE: 'DRV', COMP: 'CMP', FILTER: 'FLT', PHASER: 'PHS', FLANGER: 'FLG', CHORUS: 'CHO', TREMOLO: 'TRM', 'RING MOD': 'RNG', BITCRUSH: 'BIT', DELAY: 'DLY', BEADS: 'BDS' };

/** A part's chain as small tags (a bypassed pedal outlined), for the FX page's part buttons and the mixer's strips. */
export function pedalTags(rig: RigSynth, p: number): HTMLElement {
  const chain = el('span', 'rig-fx-part-chain');
  for (let s = 0; s < PEDAL_SLOTS; s++) {
    const t = rig.pedalType(p, s);
    if (t === 'OFF') continue;
    const tag = el('span', 'rig-fx-tag', PEDAL_SHORT[t] ?? t);
    tag.style.setProperty('--rig-accent', PEDAL_COLOURS[t] ?? LIME);
    tag.classList.toggle('bypassed', rig.deskValue(pedalId(p + 1, s + 1, 'on')) < 0.5);
    chain.append(tag);
  }
  return chain;
}

/** A pedal's knob as a control in what it means (Hz, ms, a choice...), kept in step with the 0..1 value the mixer holds. */
function knobControl(rig: RigSynth, id: string, knob: PedalKnob): { control: NumberControl | ChoiceControl; dispose: () => void } {
  const desk = rig.deskControl(id) as NumberControl;
  let quiet = true; // while true, the knob's moves are its own syncing, not the player's
  const put = (v: number) => { if (!quiet) desk.set(pedalKnob(knob, v)); };
  const control = knob.options
    ? new ChoiceControl(id, knob.label, knob.options, knob.options[knob.def]!, (v) => put(knob.options!.indexOf(v)))
    : new NumberControl(id, knob.label, knob.min, knob.max, knob.def, knob.unit ?? '', put, knob.curve);
  const pull = () => {
    quiet = true;
    const v = pedalValue(knob, desk.value);
    if (control instanceof ChoiceControl) control.set(knob.options![v]!);
    else control.set(v);
    quiet = false;
  };
  pull();
  return { control, dispose: desk.onChange(() => { if (!quiet) pull(); }) };
}

export function renderRigFxPanel(rig: RigSynth): HTMLElement {
  const panel = el('div', 'rig-panel rig-fx');
  const bar = el('div', 'rig-setup rig-fx-bar');
  const partButtons = Array.from({ length: RIG_MIX_PARTS }, (_, p) => {
    const b = el('button', 'rig-fx-part');
    b.type = 'button';
    b.addEventListener('click', () => rig.selectPart(p));
    return b;
  });
  const parts = el('div', 'rig-fx-parts');
  parts.append(...partButtons);
  bar.append(el('span', 'knob-label', 'Pedals'), parts);

  const flow = el('div', 'rig-fx-flow');
  const board = el('div', 'rig-fx-board');
  let disposers: (() => void)[] = [];

  const typeOf = (p: number, s: number) => rig.pedalType(p, s);

  function syncParts(): void {
    partButtons.forEach((b, p) => {
      const pt = rig.parts[p]!;
      b.classList.toggle('on', p === rig.part);
      b.style.setProperty('--rig-accent', pt.kind === 'kit' ? PINK : LIME);
      b.replaceChildren(el('span', 'rig-fx-part-name', `P${p + 1} ${pt.voices > 0 || pt.kind === 'kit' ? (pt.name || 'PART').toUpperCase() : ''}`));
      b.append(pedalTags(rig, p));
      b.setAttribute('aria-label', `Part ${p + 1} pedals`);
      b.setAttribute('aria-pressed', String(p === rig.part));
    });
  }

  function pedal(p: number, s: number): HTMLElement {
    const type = typeOf(p, s), spec = PEDAL_TYPES[PEDAL_NAMES.indexOf(type)]!, section = `Part ${p + 1} pedal ${s + 1}`;
    const card = el('section', 'rig-section rig-pedal');
    card.style.setProperty('--rig-accent', type === 'OFF' ? '#45474c' : PEDAL_COLOURS[type] ?? LIME);
    card.classList.toggle('empty', type === 'OFF');

    const head = el('div', 'rig-pedal-head');
    const select = el('select', 'rig-pedal-type');
    select.setAttribute('aria-label', `${section} type`);
    for (const name of PEDAL_NAMES) select.add(new Option(name === 'OFF' ? '— EMPTY —' : name, name));
    select.value = type;
    select.addEventListener('change', () => rig.setPedal(p, s, select.value as PedalName));
    head.append(el('h3', 'rig-title', `${s + 1}`), select);
    card.append(head);
    if (type === 'OFF') {
      card.append(el('p', 'rig-seq-hint', 'Choose a pedal for this slot.'));
    } else {
      const knobs = el('div', 'rig-controls rig-pedal-knobs');
      spec.knobs.forEach((knob, i) => {
        const { control, dispose } = knobControl(rig, pedalId(p + 1, s + 1, `k${i + 1}`), knob);
        disposers.push(dispose);
        knobs.append(control instanceof ChoiceControl ? renderChoice(control, section) : renderKnob(control, section, knob.label.toUpperCase(), 30));
      });
      // the foot of the pedal: the footswitch and MIX
      const foot = el('div', 'rig-pedal-foot');
      const onCtl = rig.deskControl(pedalId(p + 1, s + 1, 'on')) as ToggleControl;
      const sw = el('button', 'rig-pedal-switch');
      sw.type = 'button';
      sw.setAttribute('aria-label', `${section} on`);
      const syncSw = () => { sw.classList.toggle('on', onCtl.value); sw.setAttribute('aria-pressed', String(onCtl.value)); card.classList.toggle('bypassed', !onCtl.value); };
      sw.addEventListener('click', () => onCtl.set(!onCtl.value));
      disposers.push(onCtl.onChange(syncSw));
      syncSw();
      const mix = rig.deskControl(pedalId(p + 1, s + 1, 'mix')) as NumberControl;
      const mixText = (v: number) => (v <= 0 ? 'DRY' : v >= 1 ? 'WET' : v === 0.5 ? 'BOTH' : `${Math.round(v * 100)}%`);
      foot.append(renderKnob(mix, section, 'MIX', 30, mixText), sw);
      card.append(knobs, foot);
    }
    const move = el('div', 'rig-pedal-move');
    const arrow = (text: string, to: number, label: string) => {
      const b = el('button', 'rig-small', text);
      b.type = 'button';
      b.disabled = to < 0 || to >= PEDAL_SLOTS;
      b.setAttribute('aria-label', `${section} ${label}`);
      b.addEventListener('click', () => rig.movePedal(p, s, to));
      return b;
    };
    move.append(arrow('◀', s - 1, 'earlier in the chain'), arrow('▶', s + 1, 'later in the chain'));
    card.append(move);
    return card;
  }

  function build(): void {
    for (const d of disposers) d();
    disposers = [];
    const p = rig.part;
    board.replaceChildren(...Array.from({ length: PEDAL_SLOTS }, (_, s) => pedal(p, s)));
    flow.replaceChildren(el('span', 'rig-fx-flow-end', `PART ${p + 1}`), el('span', 'rig-fx-flow-arrow', '→ 1 → 2 → 3 → 4 →'),
      el('span', 'rig-fx-flow-end', 'MIXER STRIP'),
      el('span', 'rig-seq-hint', 'MIX: dry at full up to half way, wet at full from half way. ◀ ▶ move a pedal along the chain.'));
    syncParts();
  }

  // rebuild when the part changes, or any slot's type (a pedal chosen, moved, a multi loaded); retag on a footswitch
  let queued = false;
  const later = (fn: () => void) => () => { if (queued) return; queued = true; queueMicrotask(() => { queued = false; fn(); }); };
  const rebuild = later(build);
  for (let p = 0; p < RIG_MIX_PARTS; p++) {
    for (let s = 0; s < PEDAL_SLOTS; s++) {
      (rig.deskControl(pedalId(p + 1, s + 1, 'type')) as Control).onChange(() => { if (p === rig.part) rebuild(); else syncParts(); });
      (rig.deskControl(pedalId(p + 1, s + 1, 'on')) as Control).onChange(() => syncParts());
    }
  }
  rig.onPartChange(rebuild);
  build();

  panel.append(bar, flow, board);
  return panel;
}
