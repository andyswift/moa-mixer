import { ChoiceControl, NumberControl } from '../domain/devices/controls';
import { RIG_STRING_PARAMS, rigStringPresets, type RigStringInstrument, type RigStringParam } from '../domain/devices/rigStrings';
import { isStringKind, type RigSynth } from '../domain/devices/rigSynth';
import { renderChoice } from './rigPanel';
import { el, renderKnob } from './widgets';

/** The SYNTH page's sections for a bass or guitar part, each param in the section it belongs to. */
const SECTIONS: readonly (readonly [title: string, ids: readonly string[]])[] = [
  ['STRINGS', ['tuning', 'wrap', 'winding', 'scale']],
  ['PLAYING', ['pluck', 'pluckAt', 'strength', 'palm', 'strum', 'strumTime']],
  ['PICKUPS', ['pickup', 'pickups', 'coils', 'tone']],
  ['AMP', ['gain', 'bass', 'mid', 'treble']],
  ['CABINET', ['cab', 'mic', 'blend', 'level']],
];
const ACCENT: Record<RigStringInstrument, string> = { bass: '#ffb347', guitar: '#7fe0c4' };
const KNOB_LABEL: Record<string, string> = { pluckAt: 'PLUCK AT', strumTime: 'STRUM TIME', blend: 'DI / CAB' };
const mm = (v: number) => `${Math.round(v * 1000)} mm`;
const FORMAT: Record<string, (v: number) => string> = {
  pluckAt: mm, pickup: mm, strength: (v) => `${Math.round(v * 100)}%`, palm: (v) => (v <= 0 ? 'OFF' : `${Math.round(v * 100)}%`),
  blend: (v) => (v <= 0 ? 'DI' : v >= 1 ? 'CAB' : `${Math.round(v * 100)}%`),
};

/**
 * A bass or guitar part's panel, in place of the synth's sections: its sound (the factory ones of that instrument),
 * then its strings, how it is played, its pickups, its amp and its cabinet (rigStrings.ts). The drive and the chorus
 * are the FX page's pedals.
 */
export function renderRigStringsPanel(rig: RigSynth): HTMLElement & { sync(): void } {
  const panel = el('div', 'rig-grid rig-strings') as unknown as HTMLElement & { sync(): void };
  let built: { part: number; instrument: RigStringInstrument } | undefined;
  const controls = new Map<string, NumberControl | ChoiceControl>();
  let quiet = false;

  function control(p: RigStringParam, section: string): HTMLElement {
    const put = (v: number) => { if (!quiet) rig.setStringParam(rig.part, p.id, v); };
    if (p.options) {
      const c = new ChoiceControl(p.id, p.label, p.options, p.options[p.def]!, (v) => put(p.options!.indexOf(v)));
      controls.set(p.id, c);
      return renderChoice(c, section);
    }
    const c = new NumberControl(p.id, p.label, p.min, p.max, p.def, p.unit ?? '', put, p.curve);
    controls.set(p.id, c);
    return renderKnob(c, section, KNOB_LABEL[p.id] ?? p.label.toUpperCase(), 34, FORMAT[p.id]);
  }

  function build(instrument: RigStringInstrument): void {
    controls.clear();
    const params = RIG_STRING_PARAMS[instrument];
    const head = el('section', 'rig-section rig-strings-sound');
    head.append(el('h3', 'rig-title', instrument === 'bass' ? 'BASS GUITAR' : 'ELECTRIC GUITAR'));
    const sound = el('select');
    sound.setAttribute('aria-label', `${instrument} sound`);
    sound.add(new Option('— load a sound —', ''));
    for (const s of rigStringPresets(instrument)) sound.add(new Option(s.name, s.name));
    sound.addEventListener('change', () => {
      const s = rigStringPresets(instrument).find((x) => x.name === sound.value);
      if (s) rig.loadStrings(rig.part, s);
      sound.value = '';
    });
    const choose = el('label', 'rig-choice');
    choose.append(el('span', 'knob-label', 'Sound'), sound);
    head.append(choose, el('p', 'rig-seq-hint', instrument === 'bass'
      ? 'Velocity plucks harder; 40 or softer is a dead note. Bend wheel bends up, MOD wheel rests the palm.'
      : 'Chords are strummed. Velocity picks harder; 40 or softer is a dead note. Bend is the vibrato arm, MOD wheel rests the palm.'));
    const sections = SECTIONS.map(([title, ids]) => {
      const sec = el('section', 'rig-section');
      sec.append(el('h3', 'rig-title', title));
      const body = el('div', 'rig-controls');
      for (const id of ids) {
        const p = params.find((x) => x.id === id);
        if (p) body.append(control(p, `${title.toLowerCase()}`));
      }
      sec.append(body);
      return sec;
    });
    panel.style.setProperty('--rig-accent', ACCENT[instrument]);
    panel.replaceChildren(head, ...sections);
  }

  panel.sync = () => {
    const pt = rig.parts[rig.part]!;
    if (!isStringKind(pt.kind) || !pt.strings) return;
    const instrument = pt.strings.instrument;
    quiet = true; // building the knobs sets them to their defaults: not an edit
    if (!built || built.instrument !== instrument) build(instrument);
    built = { part: rig.part, instrument };
    quiet = true;
    for (const p of RIG_STRING_PARAMS[instrument]) {
      const c = controls.get(p.id), v = pt.strings.params[p.id] ?? p.def;
      if (c instanceof ChoiceControl) c.set(p.options![Math.round(v)] ?? p.options![0]!);
      else c?.set(v);
    }
    quiet = false;
  };
  return panel;
}
