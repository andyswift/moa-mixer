import type { NumberControl, ToggleControl } from '../domain/devices/controls';
import { UNICORN_PRESETS, type UnicornSynth } from '../domain/devices/unicornSynth';
import { RHYTHMS, SONGS } from '../domain/sequencer/unicornRhythm';
import { NOTE_COLORS, unicornSvg } from './unicornArt';
import { el } from './widgets';

// Norwegian note names: B is H
const NOTE_NAMES = ['C', 'C♯', 'D', 'D♯', 'E', 'F', 'F♯', 'G', 'G♯', 'A', 'A♯', 'H'];
const BLACK = new Set([1, 3, 6, 8, 10]);
/** Computer keys, laid out like a piano from C4: the a row is white, the row above black. */
const COMPUTER_KEYS = ['a', 'w', 's', 'e', 'd', 'f', 't', 'g', 'y', 'h', 'u', 'j', 'k', 'o', 'l', 'p', ';'];
const FIRST = 60; // C4
const RHYTHM_ICONS: Record<string, string> = { rock: '🥁', pop: '🎉', waltz: '💃', march: '🥾', disco: '🪩' };
const SONG_ICONS: Record<string, string> = { twinkle: '⭐', lamb: '🐑', joy: '🎵', farm: '🐄', bells: '🛷' };
// the page speaks Norwegian
const RHYTHM_LABELS: Record<string, string> = { rock: 'Rock', pop: 'Pop', waltz: 'Vals', march: 'Marsj', disco: 'Disko' };
const SONG_LABELS: Record<string, string> = {
  twinkle: 'Blinke, blinke, lille stjerne', lamb: 'Mary hadde et lite lam', joy: 'Ode til gleden', farm: 'Old MacDonald hadde en gård', bells: 'Bjelleklang',
};

export interface UnicornHooks {
  /** The on/off switch. Resolves once the sound is on (or off). */
  power(on: boolean): Promise<void>;
  /** A key pressed or let go on the screen or the computer keyboard (the page adds One Key Play). */
  keyDown(note: number): void;
  keyUp(note: number): void;
  /** Plays the chosen song to the listener, or stops it. */
  listen(): void;
  /** Asks the browser for MIDI (a keyboard plugged in). */
  connectMidi(): void;
}

export interface UnicornView {
  element: HTMLElement;
  /** Makes the unicorn hop (on a note) and sends a sparkle the colour of `note` from its horn. */
  hop(note?: number): void;
  /** A small bounce on the beat of the rhythm. */
  bounce(): void;
  /** Lights the key the next press of a song will play (or none). */
  guide(note: number | undefined): void;
  /** A song played to its end: a burst of stars. */
  hooray(): void;
  setListening(on: boolean): void;
  keyLit(note: number, on: boolean): void;
  /** What the MIDI link says: undefined offers to connect, a text says what is connected (or why not). */
  setMidi(text: string | undefined): void;
}

/**
 * MOA-UNICORN's page: a sky with a rainbow, the unicorn jumping over a long rainbow keyboard, a toy on/off switch
 * (it starts the audio), and big buttons: sounds, Magic and Sparkle (the filter), sustain, vibrato and octave, the
 * rhythms with a tortoise-to-hare tempo, and songs to play with One Key Play or listen to.
 */
export function renderUnicornPanel(u: UnicornSynth, hooks: UnicornHooks): UnicornView {
  const root = el('div', 'uni-page');
  let on = false;

  // ---- the top: the switch and the name
  const top = el('div', 'uni-top');
  const power = el('button', 'uni-power');
  power.type = 'button';
  power.setAttribute('role', 'switch');
  power.setAttribute('aria-checked', 'false');
  power.setAttribute('aria-label', 'Av og på');
  power.innerHTML = '<span class="uni-power-off">AV</span><span class="uni-power-knob">★</span><span class="uni-power-on">PÅ</span>';
  const title = el('h1', 'uni-title');
  title.innerHTML = [...'Enhjørningklang'].map((c, i) => (c === ' ' ? ' ' : `<span style="color:${NOTE_COLORS[(i * 2) % 12]}">${c}</span>`)).join('');
  const hint = el('div', 'uni-hint', 'Vekk meg!');
  top.append(power, title, hint);

  // ---- the scene: rainbow, clouds, the unicorn
  const scene = el('div', 'uni-scene');
  scene.innerHTML = `<div class="uni-rainbow"></div><div class="uni-cloud c1"></div><div class="uni-cloud c2"></div><div class="uni-cloud c3"></div><div class="uni-zzz">z z Z</div>`;
  const jumper = el('div', 'uni-jumper');
  jumper.innerHTML = unicornSvg();
  scene.append(jumper);
  const sparkles = el('div', 'uni-sparkles');
  scene.append(sparkles);
  // while it sleeps: a big button over the scene (children who cannot read yet just press the glowing button)
  const wake = el('button', 'uni-wake');
  wake.type = 'button';
  wake.setAttribute('aria-label', 'Vekk enhjørningen');
  wake.innerHTML = '<span class="uni-wake-face">😴</span><span class="uni-wake-text">Vekk meg!</span><span class="uni-wake-hand">👆</span>';
  wake.addEventListener('click', () => void turnOn());
  scene.append(wake);

  // ---- the keyboard
  const keyboard = el('div', 'uni-keys');
  keyboard.setAttribute('aria-label', 'Tangenter');
  const keyEls = new Map<number, HTMLElement>();
  const layout = () => {
    const keys = window.innerWidth < 640 ? 13 : 25; // one octave on a phone, two on anything bigger
    keyboard.replaceChildren();
    keyEls.clear();
    const whites = [...Array(keys).keys()].filter((i) => !BLACK.has((FIRST + i) % 12)).length;
    let w = 0;
    for (let i = 0; i < keys; i++) {
      const note = FIRST + i, pc = note % 12, black = BLACK.has(pc);
      const k = el('div', black ? 'uni-key black' : 'uni-key white');
      k.dataset.note = String(note);
      if (black) k.style.left = `calc(${(w / whites) * 100}% - ${(0.32 / whites) * 100}%)`;
      else {
        k.style.left = `${(w / whites) * 100}%`;
        k.style.background = NOTE_COLORS[pc]!;
        k.append(el('span', 'uni-key-name', NOTE_NAMES[pc]));
        w++;
      }
      k.style.width = `${((black ? 0.64 : 1) / whites) * 100}%`;
      keyboard.append(k);
      keyEls.set(note, k);
    }
  };
  layout();
  let wide = window.innerWidth >= 640;
  window.addEventListener('resize', () => { if ((window.innerWidth >= 640) !== wide) { wide = !wide; layout(); } });

  // pointers: each finger plays the key under it and slides from key to key (multi-touch)
  const fingers = new Map<number, number>();
  const noteAt = (x: number, y: number) => {
    const k = document.elementFromPoint(x, y)?.closest<HTMLElement>('.uni-key');
    return k ? Number(k.dataset.note) : undefined;
  };
  const press = (id: number, note: number | undefined) => {
    const was = fingers.get(id);
    if (was === note) return;
    if (was !== undefined) { fingers.delete(id); hooks.keyUp(was); }
    if (note !== undefined) {
      fingers.set(id, note);
      if (!on) void turnOn().then(() => { if (fingers.get(id) === note) hooks.keyDown(note); }); // a key wakes it, then plays
      else hooks.keyDown(note);
    }
  };
  keyboard.addEventListener('pointerdown', (e) => { e.preventDefault(); try { keyboard.setPointerCapture(e.pointerId); } catch { /* a pointer that cannot be captured still plays */ } press(e.pointerId, noteAt(e.clientX, e.clientY)); });
  keyboard.addEventListener('pointermove', (e) => { if (fingers.has(e.pointerId)) press(e.pointerId, noteAt(e.clientX, e.clientY)); });
  const lift = (e: PointerEvent) => press(e.pointerId, undefined);
  keyboard.addEventListener('pointerup', lift);
  keyboard.addEventListener('pointercancel', lift);
  const down = new Set<string>();
  window.addEventListener('keydown', (e) => {
    if (e.metaKey || e.ctrlKey || e.altKey || e.repeat) return;
    const i = COMPUTER_KEYS.indexOf(e.key.toLowerCase());
    if (i < 0 || down.has(e.key.toLowerCase())) return;
    down.add(e.key.toLowerCase());
    if (!on) void turnOn().then(() => hooks.keyDown(FIRST + i));
    else hooks.keyDown(FIRST + i);
  });
  window.addEventListener('keyup', (e) => {
    const k = e.key.toLowerCase(), i = COMPUTER_KEYS.indexOf(k);
    if (i >= 0 && down.delete(k)) hooks.keyUp(FIRST + i);
  });

  // iPhones zoom on a quick second tap whatever the page asks: the second tap's default is cancelled and the tap is
  // given to what was tapped as a click instead, so a child tapping fast just presses the button again
  let lastTap = 0;
  root.addEventListener('touchend', (e) => {
    const now = e.timeStamp;
    if (now - lastTap < 350 && !(e.target as Element).closest('.uni-keys')) {
      e.preventDefault();
      (e.target as Element).closest<HTMLElement>('button, input, a')?.click();
    }
    lastTap = now;
  }, { passive: false });
  root.addEventListener('dblclick', (e) => e.preventDefault());
  document.addEventListener('gesturestart', (e) => e.preventDefault()); // Safari's pinch

  const stage = el('div', 'uni-stage');
  stage.append(scene, keyboard);

  // ---- the buttons
  const controls = el('div', 'uni-controls');
  const group = (label: string, ...children: HTMLElement[]) => {
    const g = el('div', 'uni-group');
    g.append(el('div', 'uni-group-label', label), ...children);
    return g;
  };
  const choiceButtons = <T extends string>(options: { value: T; icon: string; label: string }[], current: () => string, pick: (v: T) => void) => {
    const row = el('div', 'uni-buttons');
    const buttons = options.map((o) => {
      const b = el('button', 'uni-btn');
      b.type = 'button';
      b.innerHTML = `<span class="uni-btn-icon">${o.icon}</span><span class="uni-btn-label">${o.label}</span>`;
      b.setAttribute('aria-label', o.label);
      b.addEventListener('click', () => pick(o.value));
      row.append(b);
      return { b, o };
    });
    const paint = () => buttons.forEach(({ b, o }) => b.setAttribute('aria-pressed', String(current() === o.value)));
    paint();
    return { row, paint };
  };
  const sounds = choiceButtons(UNICORN_PRESETS.map((p) => ({ value: p.name, icon: p.icon, label: p.label })), () => u.preset.value, (v) => u.preset.set(v));
  const slider = (c: NumberControl, icon: string, label: string, log = false) => {
    const wrap = el('label', 'uni-slider');
    const input = el('input');
    input.type = 'range'; input.min = '0'; input.max = '1000';
    const to = (v: number) => (log ? Math.log(v / c.min) / Math.log(c.max / c.min) : (v - c.min) / (c.max - c.min)) * 1000;
    const from = (s: number) => (log ? c.min * (c.max / c.min) ** (s / 1000) : c.min + (s / 1000) * (c.max - c.min));
    input.value = String(to(c.value));
    input.addEventListener('input', () => c.set(from(Number(input.value))));
    c.onChange(() => { input.value = String(to(c.value)); });
    input.setAttribute('aria-label', label);
    wrap.append(el('span', 'uni-slider-icon', icon), input, el('span', 'uni-slider-label', label));
    return wrap;
  };
  const toggle = (c: ToggleControl, icon: string, label: string) => {
    const b = el('button', 'uni-btn uni-toggle');
    b.type = 'button';
    b.innerHTML = `<span class="uni-btn-icon">${icon}</span><span class="uni-btn-label">${label}</span>`;
    const paint = () => b.setAttribute('aria-pressed', String(c.value));
    b.addEventListener('click', () => c.set(!c.value));
    c.onChange(paint);
    paint();
    return b;
  };
  const octave = choiceButtons([{ value: '-1', icon: '⬇️', label: 'Lav' }, { value: '0', icon: '🎯', label: 'Midt' }, { value: '+1', icon: '⬆️', label: 'Høy' }], () => u.octave.value, (v) => u.octave.set(v));
  const rhythms = choiceButtons([{ value: 'off', icon: '🔇', label: 'Ingen trommer' }, ...Object.entries(RHYTHMS).map(([value, r]) => ({ value, icon: RHYTHM_ICONS[value] ?? '🥁', label: RHYTHM_LABELS[value] ?? r.name }))], () => u.rhythm.value, (v) => u.rhythm.set(v));
  const songs = choiceButtons([{ value: 'off', icon: '🎹', label: 'Spill fritt' }, ...Object.entries(SONGS).map(([value, s]) => ({ value, icon: SONG_ICONS[value] ?? '🎵', label: SONG_LABELS[value] ?? s.name }))], () => u.song.value, (v) => u.song.set(v));
  const listen = el('button', 'uni-btn uni-listen');
  listen.type = 'button';
  listen.innerHTML = '<span class="uni-btn-icon">👂</span><span class="uni-btn-label">Hør</span>';
  listen.addEventListener('click', () => void turnOn().then(() => hooks.listen()));
  const songHint = el('div', 'uni-small', 'Velg en sang og trykk på hvilken som helst tangent, igjen og igjen: enhjørningen kan melodien!');

  // the note buttons share a row: long notes, wobbly, and the octave
  const notes = el('div', 'uni-buttons uni-notes');
  notes.append(toggle(u.sustain, '🎈', 'Lange toner'), toggle(u.vibrato, '〰️', 'Bølgete'), ...octave.row.children);
  sounds.row.classList.add('uni-sounds');
  songs.row.classList.add('uni-songs');
  controls.append(
    group('Lyder', sounds.row),
    group('Magi', slider(u.magic, '✨', 'Magi', true), slider(u.sparkle, '🌟', 'Glitter'), slider(u.volume, '🔊', 'Volum'), notes),
    group('Trommer', rhythms.row, slider(u.tempo, '🐢', 'Fort 🐇'), slider(u.beatLevel, '🥁', 'Trommevolum')),
    group('Sanger', songs.row, listen, songHint),
  );
  u.onChange(() => { sounds.paint(); octave.paint(); rhythms.paint(); songs.paint(); paintGlow(); });

  // for grown-ups: a MIDI keyboard, the audio bus, the way home
  const footer = el('div', 'uni-footer');
  const midiButton = el('button', 'uni-midi', '🎹 Koble til et MIDI-keyboard');
  midiButton.type = 'button';
  midiButton.addEventListener('click', () => hooks.connectMidi());
  const midiState = el('span', 'uni-midi-state');
  const note = el('div');
  note.innerHTML = 'For voksne: lyden ligger på lydbussen som «MOA-UNICORN», til mikseren. <a href="/">moaswift.no</a>';
  footer.append(midiButton, midiState, note);
  top.append(footer); // a small note for grown-ups, out of the way at the top
  root.append(top, stage, controls);

  // ---- the switch
  const paintPower = () => {
    power.setAttribute('aria-checked', String(on));
    root.classList.toggle('on', on);
  };
  let powering: Promise<void> = Promise.resolve();
  const setPower = (v: boolean) => {
    on = v;
    paintPower();
    powering = hooks.power(on);
    return powering;
  };
  /** Wakes it if it sleeps (a key, a button or the big wake-up button); resolves once it can play. */
  const turnOn = () => (on ? powering : setPower(true));
  power.addEventListener('click', () => void setPower(!on));
  // any of the big buttons wakes it too, so nobody is ever stuck with a silent toy
  controls.addEventListener('click', () => void turnOn(), true);
  paintPower();

  // ---- the horn glows with Magic
  const paintGlow = () => {
    const t = Math.log(u.magic.value / 150) / Math.log(12000 / 150);
    root.style.setProperty('--glow', t.toFixed(2));
    root.style.setProperty('--sparkle', u.sparkle.value.toFixed(2));
  };
  paintGlow();

  // ---- movement
  const restart = (cls: string) => {
    jumper.classList.remove(cls);
    void jumper.offsetWidth;
    jumper.classList.add(cls);
  };
  const sparkle = (note: number, big = false) => {
    const s = el('span', big ? 'uni-spark big' : 'uni-spark', '★');
    s.style.color = NOTE_COLORS[note % 12]!;
    s.style.setProperty('--dx', `${(Math.random() - 0.3) * 120}px`);
    s.style.setProperty('--dy', `${-60 - Math.random() * 90}px`);
    const tip = jumper.querySelector('.uni-horn-tip')!.getBoundingClientRect(), box = scene.getBoundingClientRect();
    s.style.left = `${tip.left - box.left}px`;
    s.style.top = `${tip.top - box.top}px`;
    sparkles.append(s);
    setTimeout(() => s.remove(), 1200);
  };
  let guided: HTMLElement | undefined;
  return {
    element: root,
    hop(note) {
      restart('hop');
      if (note !== undefined) sparkle(note);
    },
    bounce() {
      if (!jumper.classList.contains('hop')) restart('bounce');
    },
    guide(note) {
      guided?.classList.remove('next');
      guided = note === undefined ? undefined : keyEls.get(note) ?? keyEls.get(FIRST + (note % 12));
      guided?.classList.add('next');
    },
    hooray() {
      restart('hooray');
      for (let i = 0; i < 24; i++) setTimeout(() => sparkle(i, true), i * 40);
    },
    setListening(v) {
      listen.setAttribute('aria-pressed', String(v));
    },
    keyLit(note, lit) {
      keyEls.get(note)?.classList.toggle('down', lit);
    },
    setMidi(text) {
      midiButton.hidden = text !== undefined;
      midiState.textContent = text ?? '';
    },
  };
}
