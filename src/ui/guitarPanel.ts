import type { AudioEngine } from '../audio/engine';
import { midiToHz, noteOf } from '../domain/devices/bassPhysics';
import type { ElectricGuitar } from '../domain/devices/electricGuitar';
import { actionButton, renderFretboard, renderStringTable, type NeckLook } from './stringsPanel';
import { BLUE, GREEN, ORANGE, PINK, renderSection, YELLOW } from './synthPanel';
import { el } from './widgets';

/** A maple fretboard: pale wood, black dots. */
const MAPLE: NeckLook = { wood: ['#c99c5e', '#dcb57a'], dots: '#2a211a', numbers: '#7f7a70' };

/**
 * The MOA-GUITAR panel: each string's live physics, the fretboard with the six strings vibrating in slow motion and
 * the three pickups (`stringsPanel.ts`), then the strings, the picking hand, the pickups, the amp and the cabinet.
 */
export function renderGuitarPanel(g: ElectricGuitar, engine: AudioEngine): HTMLElement {
  const panel = el('div', 'synth-panel bass-panel guitar-panel');
  const header = el('div', 'synth-header');
  const brand = el('div', 'synth-brand');
  brand.append(el('div', 'synth-name', 'MOA-GUITAR'), el('div', 'synth-subtitle', 'Six physically modelled strings'));
  header.append(brand);
  panel.append(header, renderStringTable(g), renderFretboard(g, engine, 'guitar', MAPLE));

  // the pegs are labelled with their notes, as the two E strings would read alike in capitals
  const standard = g.standardNotes.map((n) => noteOf(midiToHz(n)).name);
  const strings = renderSection(g, {
    title: 'Strings', color: BLUE, grow: 7, switches: ['string.wrap', 'string.winding', 'string.scale'],
    faders: g.voices.map((v, i) => ({ id: `${v.name}.tension`, label: standard[i]! })),
  });
  strings.querySelector('.synth-section-body')!.append(actionButton('Tune', `Tune every string to its standard note (${standard.join(' ')})`, () => g.tuneToStandard()));
  const pick = renderSection(g, {
    title: 'Picking', color: GREEN, grow: 4, switches: ['pluck.style', 'strum'],
    faders: [{ id: 'pluck.position', label: 'At (m)' }, { id: 'pluck.strength', label: 'Strength' }, { id: 'strum.time', label: 'Time' }],
  });
  const hands = renderSection(g, { title: 'Hands', color: ORANGE, grow: 2, faders: [{ id: 'palm', label: 'Palm' }] });
  hands.querySelector('.synth-section-body')!.append(actionButton('Mute', 'Rest a hand on all the strings', () => g.voices.forEach((_, i) => g.release(i))));
  const pickups = renderSection(g, { title: 'Pickups', color: YELLOW, grow: 3, switches: ['pickup.select', 'pickup.type'], faders: ['tone'] });
  const drive = renderSection(g, {
    title: 'Overdrive', color: GREEN, grow: 3,
    faders: [{ id: 'drive.mix', label: 'On' }, { id: 'drive.gain', label: 'Drive' }, { id: 'drive.tone', label: 'Tone' }, { id: 'drive.level', label: 'Level' }],
  });
  const chorus = renderSection(g, {
    title: 'Chorus', color: BLUE, grow: 4,
    faders: [{ id: 'chorus.mix', label: 'Mix' }, { id: 'chorus.rate', label: 'Rate' }, { id: 'chorus.depth', label: 'Depth' }, { id: 'chorus.flange', label: 'Flange' }],
  });
  const amp = renderSection(g, {
    title: 'Amp', color: PINK, grow: 4,
    faders: [{ id: 'amp.gain', label: 'Gain' }, { id: 'amp.bass', label: 'Bass' }, { id: 'amp.mid', label: 'Mid' }, { id: 'amp.treble', label: 'Treble' }],
  });
  const cab = renderSection(g, {
    title: 'Cabinet & DI', color: PINK, grow: 4, switches: ['cab.type', 'cab.mic'],
    faders: [{ id: 'cab.blend', label: 'DI / Cab' }, 'level'],
  });
  const row1 = el('div', 'synth-row');
  row1.append(strings, pick, hands);
  const row2 = el('div', 'synth-row');
  row2.append(pickups, drive, chorus, amp, cab);
  panel.append(row1, row2);
  return panel;
}
