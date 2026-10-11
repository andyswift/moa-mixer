import type { Synthesizer } from '../domain/devices/synthesizer';
import { el } from './widgets';
import { renderWheel } from './wheel';

// 49 keys, C2 to C6 (MIDI 36-84). The computer keys play the octave from middle C.
const FIRST_NOTE = 36;
const KEY_COUNT = 49;
const LETTERS = ['a', 'w', 's', 'e', 'd', 'f', 't', 'g', 'y', 'h', 'u', 'j', 'k'];
const LETTER_START = 60 - FIRST_NOTE; // key index of middle C
const NAMES = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B'];
const IS_WHITE = [true, false, true, false, true, true, false, true, false, true, false, true];
const WHITE_COUNT = IS_WHITE.reduce((n, w, i) => n + (w ? 1 : 0), 0) * 4 + 1; // 29
const BLACK_WIDTH = (100 / WHITE_COUNT) * 0.6;
const MAX_OCTAVE = 2;

const noteName = (note: number) => `${NAMES[note % 12]}${Math.floor(note / 12) - 1}`;
const semitones = (bend: number) => {
  const st = Math.round(bend * 2 * 100) / 100;
  return `${st > 0 ? '+' : ''}${st.toFixed(2)} st`;
};

/**
 * The keyboard bed along the bottom of the synth panel: pitch and mod wheels with octave buttons on the
 * left, a 49-key keyboard filling the rest. Keys light for notes from anywhere, MIDI included.
 */
export function mountKeyboardBed(synth: Synthesizer): HTMLElement {
  const bed = el('div', 'keybed');

  // --- Wheels and octave ---
  const cheek = el('div', 'keybed-cheek');
  const wheels = el('div', 'keybed-wheels');
  wheels.append(
    renderWheel({
      label: 'Bend', ariaLabel: 'Pitch bend', bipolar: true, scale: ['+2', '0', '-2'], springBack: true, keyStep: 0.125,
      get: () => synth.pitchBend, set: (v) => synth.setPitchBend(v),
      subscribe: (fn) => synth.onPerformanceChange(fn), format: semitones,
    }),
    renderWheel({
      label: 'Mod', ariaLabel: 'Modulation, LFO vibrato depth', bipolar: false, scale: ['100', '0'], springBack: false, keyStep: 0.1,
      get: () => synth.modWheel, set: (v) => synth.setModWheel(v),
      subscribe: (fn) => synth.onPerformanceChange(fn), format: (v) => `${Math.round(v * 100)} %`,
    }),
  );

  let octave = 0;
  const octaveRow = el('div', 'keybed-octave');
  const down = el('button', 'btn btn-small', '<');
  down.type = 'button';
  down.setAttribute('aria-label', 'Octave down');
  const up = el('button', 'btn btn-small', '>');
  up.type = 'button';
  up.setAttribute('aria-label', 'Octave up');
  const octaveText = el('span', 'keybed-octave-text', 'Oct 0');
  octaveRow.append(down, octaveText, up);
  cheek.append(wheels, octaveRow);

  // --- Keys ---
  const keys = el('div', 'keybed-keys');
  const whiteRow = el('div', 'keybed-whites');
  keys.append(whiteRow);
  const keyEls: HTMLButtonElement[] = [];
  const sounding = new Map<number, number>(); // key index -> MIDI note it started (octave may change meanwhile)
  let whitesSeen = 0;

  const press = (index: number) => {
    if (sounding.has(index)) return;
    const note = FIRST_NOTE + index + octave * 12;
    sounding.set(index, note);
    synth.keyDown(note);
  };
  const release = (index: number) => {
    const note = sounding.get(index);
    if (note === undefined) return;
    sounding.delete(index);
    synth.keyUp(note);
  };

  for (let i = 0; i < KEY_COUNT; i++) {
    const white = IS_WHITE[i % 12]!;
    const key = el('button', white ? 'key-white' : 'key-black');
    key.type = 'button';
    key.setAttribute('aria-label', `Key ${noteName(FIRST_NOTE + i)}`);
    const letter = LETTERS[i - LETTER_START];
    if (letter) key.textContent = letter;
    if (white) {
      whiteRow.append(key);
      whitesSeen++;
    } else {
      key.style.left = `${Math.round(((whitesSeen / WHITE_COUNT) * 100 - BLACK_WIDTH / 2) * 1000) / 1000}%`;
      key.style.width = `${BLACK_WIDTH}%`;
      keys.append(key);
    }
    key.addEventListener('pointerdown', (e) => {
      e.preventDefault();
      press(i);
    });
    for (const type of ['pointerup', 'pointerleave', 'pointercancel']) key.addEventListener(type, () => release(i));
    key.addEventListener('keydown', (e) => {
      if ((e.key === ' ' || e.key === 'Enter') && !e.repeat) {
        e.preventDefault();
        press(i);
      }
    });
    key.addEventListener('keyup', () => release(i));
    keyEls.push(key);
  }

  // Light the keys for whatever the synth is holding (this keyboard, the computer keys or MIDI).
  // A key we pressed lights itself (whatever the octave shift); other notes, e.g. from MIDI, light the key at their written pitch.
  const paint = () => {
    const held = new Set(synth.heldNotes);
    const ours = new Set(sounding.values());
    keyEls.forEach((key, i) => {
      const lit = sounding.has(i) || (held.has(FIRST_NOTE + i) && !ours.has(FIRST_NOTE + i));
      key.classList.toggle('on', lit);
      key.setAttribute('aria-pressed', String(lit));
    });
  };
  synth.onNoteChange(paint);

  const paintOctave = () => {
    octaveText.textContent = `Oct ${octave > 0 ? '+' : ''}${octave}`;
    down.disabled = octave <= -MAX_OCTAVE;
    up.disabled = octave >= MAX_OCTAVE;
    paint();
  };
  down.addEventListener('click', () => {
    octave = Math.max(-MAX_OCTAVE, octave - 1);
    paintOctave();
  });
  up.addEventListener('click', () => {
    octave = Math.min(MAX_OCTAVE, octave + 1);
    paintOctave();
  });
  paintOctave();

  // Computer keyboard: the home row plays the octave from middle C.
  window.addEventListener('keydown', (e) => {
    if (e.repeat || e.metaKey || e.ctrlKey || e.altKey || e.target instanceof HTMLSelectElement) return;
    const i = LETTERS.indexOf(e.key.toLowerCase());
    if (i >= 0) press(LETTER_START + i);
  });
  window.addEventListener('keyup', (e) => {
    const i = LETTERS.indexOf(e.key.toLowerCase());
    if (i >= 0) release(LETTER_START + i);
  });

  bed.append(cheek, keys);
  return bed;
}
