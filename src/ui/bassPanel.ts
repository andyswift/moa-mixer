import type { AudioEngine } from '../audio/engine';
import type { BassGuitar } from '../domain/devices/bassGuitar';
import { midiToHz, noteOf } from '../domain/devices/bassPhysics';
import { actionButton, renderFretboard, renderStringTable, ROSEWOOD } from './stringsPanel';
import { BLUE, GREEN, ORANGE, PINK, renderSection, YELLOW } from './synthPanel';
import { el } from './widgets';

/**
 * The MOA-BASS panel: each string's live physics, a fretboard drawn to scale with the four strings vibrating in slow
 * motion (`stringsPanel.ts`), and the controls, the amp and the cabinet.
 */
export function renderBassPanel(b: BassGuitar, engine: AudioEngine): HTMLElement {
  const panel = el('div', 'synth-panel bass-panel');
  const header = el('div', 'synth-header');
  const brand = el('div', 'synth-brand');
  brand.append(el('div', 'synth-name', 'MOA-BASS'), el('div', 'synth-subtitle', 'Four physically modelled strings'));
  header.append(brand);
  panel.append(header, renderStringTable(b), renderFretboard(b, engine, 'bass', ROSEWOOD));

  // ---- the controls: strings, hands, pickup; then the amp and the cabinet
  const strings = renderSection(b, {
    title: 'Strings', color: BLUE, grow: 6, switches: ['string.wrap', 'string.winding', 'string.scale'],
    faders: b.voices.map((v) => ({ id: `${v.name}.tension`, label: v.name })),
  });
  const standard = b.standardNotes.map((n) => noteOf(midiToHz(n)).name).join(' ');
  strings.querySelector('.synth-section-body')!.append(actionButton('Tune', `Tune every string to its standard note (${standard})`, () => b.tuneToStandard()));
  const pluck = renderSection(b, {
    title: 'Pluck', color: GREEN, grow: 3, switches: ['pluck.style'],
    faders: [{ id: 'pluck.position', label: 'At (m)' }, { id: 'pluck.strength', label: 'Strength' }],
  });
  const hands = renderSection(b, { title: 'Hands', color: ORANGE, grow: 2, faders: [{ id: 'palm', label: 'Palm' }] });
  hands.querySelector('.synth-section-body')!.append(actionButton('Mute', 'Rest a hand on all the strings', () => b.voices.forEach((_, i) => b.release(i))));
  const pickup = renderSection(b, { title: 'Pickup', color: YELLOW, grow: 2, faders: [{ id: 'pickup.position', label: 'At (m)' }, 'tone'] });
  const drive = renderSection(b, {
    title: 'Overdrive', color: GREEN, grow: 3,
    faders: [{ id: 'drive.mix', label: 'On' }, { id: 'drive.gain', label: 'Drive' }, { id: 'drive.tone', label: 'Tone' }, { id: 'drive.level', label: 'Level' }],
  });
  const amp = renderSection(b, {
    title: 'Amp', color: PINK, grow: 4,
    faders: [{ id: 'amp.gain', label: 'Gain' }, { id: 'amp.bass', label: 'Bass' }, { id: 'amp.mid', label: 'Mid' }, { id: 'amp.treble', label: 'Treble' }],
  });
  const cab = renderSection(b, {
    title: 'Cabinet & DI', color: PINK, grow: 4, switches: ['cab.type', 'cab.mic'],
    faders: [{ id: 'cab.blend', label: 'DI / Cab' }, 'level'],
  });
  const row1 = el('div', 'synth-row');
  row1.append(strings, pluck, hands, pickup);
  const row2 = el('div', 'synth-row');
  row2.append(drive, amp, cab);
  panel.append(row1, row2);
  return panel;
}
