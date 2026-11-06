import { KNOB_COUNT, learnKnob } from '../../domain/game/knobs';
import { renderTouchSetup } from './touchSetupView';
import { TECHNIQUE, THEORY } from '../../domain/game/drills';
import { GROOVES } from '../../domain/game/groove';
import { LENGTH_LESSONS } from '../../domain/game/lengthLessons';
import { BASS_SOUND, SOUND_DESIGN, SOUND_DESIGN_LATER } from '../../domain/game/lessons';
import { level, levelProgress, ROLES, type Role } from '../../domain/game/progress';
import { button, h } from './dom';
import type { Game, Screen } from './game';

/** Where to go after the MIDI check: whichever setup step is missing, else the skill tree. */
export function nextAfterGate(game: Game): 'knobs' | 'touch' | 'band' | 'tour' {
  if (game.progress.knobs.length < KNOB_COUNT) return 'knobs';
  if (!game.progress.touch) return 'touch';
  if (!game.progress.band.trim()) return 'band';
  return 'tour';
}

/** "Plug in to play": audio and MIDI start from one click, then a note from the player's device proves it works. */
export function gateScreen(game: Game): Screen {
  const devices = h('div.vr-devices');
  const status = h('p.vr-mono', { role: 'status' });
  const proof = h('div.vr-card', null, h('span.vr-kicker', null, 'Step 2 · Prove it'), h('span', { style: 'font-size: 20px; font-weight: 600' }, 'Play any note on your keyboard'));
  const heard = h('span.vr-mono', { role: 'status' }, 'Waiting for a note…');
  proof.append(heard);
  // Continue is a click too, so it can start the audio when MIDI was already allowed on an earlier visit.
  const go = button('Continue', () => void game.startAudio().then(() => game.go(nextAfterGate(game))), 'primary');
  go.disabled = !game.heardNote;
  const connect = button('Connect MIDI and start audio', () => void start(), 'primary');

  async function start(): Promise<void> {
    connect.disabled = true;
    await game.startAudio();
    await game.midi.connect();
    render();
  }

  function render(): void {
    const m = game.midi;
    devices.replaceChildren();
    if (m.status === 'unsupported') status.textContent = 'This browser has no Web MIDI. Use Chrome or Edge on a computer.';
    else if (m.status === 'denied') status.textContent = 'MIDI access was blocked. Allow MIDI for this site in the browser settings, then reload.';
    else if (m.status === 'idle') status.textContent = 'The browser will ask for MIDI access.';
    else if (!m.inputs.length) status.textContent = 'No MIDI devices found. Plug one in: it shows up here by itself.';
    else status.textContent = 'Pick the keyboard you will play.';
    for (const input of m.inputs) {
      const selected = input.id === m.selectedId;
      const row = h(`button.vr-device${selected ? '.selected' : ''}` as 'button', { type: 'button', 'aria-pressed': selected ? 'true' : 'false' },
        h(`span.vr-dot${selected ? '.on' : ''}` as 'span'), h('span.name', null, input.name), h('span.vr-mono', null, selected ? 'listening' : 'use this'));
      row.addEventListener('click', () => m.select(input.id));
      devices.append(row);
    }
    connect.hidden = m.status === 'ready';
  }

  const off = game.midi.onChange(render);
  game.listen((e) => {
    if (e.type !== 'noteOn') return;
    game.heardNote = true;
    heard.textContent = `Heard it: note ${e.note}, velocity ${e.velocity}, channel ${e.channel}.`;
    proof.classList.add('hot');
    go.disabled = false;
  });
  if (game.heardNote) { heard.textContent = 'Heard it.'; proof.classList.add('hot'); }
  render();

  const el = h('div.vr-screen', null,
    h('div.vr-gate', null,
      h('div', { style: 'display: flex; flex-direction: column; gap: 24px' },
        h('span.vr-kicker.hot', null, 'Virtual Rockstar'),
        h('h1.vr-title.huge', null, 'Plug in', h('br'), 'to play'),
        h('p.vr-lede', null, 'Every note in this game comes from a real instrument. Connect a MIDI keyboard with at least four knobs. The mouse and computer keyboard only work the menus.'),
      ),
      h('div', { style: 'display: flex; flex-direction: column; gap: 18px' },
        h('span.vr-kicker', null, 'Step 1 · Your keyboard'), connect, status, devices, proof, go),
    ),
  );
  return { el, dispose: off };
}

/** Knob setup: turn each of four knobs in turn; the lessons give their controls to knobs 1-4. */
export function knobsScreen(game: Game): Screen {
  let knobs: number[] = [];
  const tiles = h('div.vr-knobs');
  const done = button('Continue', () => {
    game.progress = { ...game.progress, knobs };
    game.save();
    game.go(nextAfterGate(game));
  }, 'primary');
  const turns = new Map<number, number>();

  function render(): void {
    tiles.replaceChildren(...Array.from({ length: KNOB_COUNT }, (_, i) => {
      const cc = knobs[i];
      const state = cc !== undefined ? 'done' : i === knobs.length ? 'next' : '';
      const dial = h('div.dial');
      dial.style.setProperty('--turn', `${-135 + ((turns.get(cc ?? -1) ?? 0) / 127) * 270}deg`);
      return h(`div.vr-knob${state ? '.' + state : ''}` as 'div', null,
        h('span.num', null, `Knob ${i + 1}`), dial,
        h('span.vr-mono', null, cc !== undefined ? `CC ${cc}` : i === knobs.length ? 'turn it now' : 'waiting'));
    }));
    done.disabled = knobs.length < KNOB_COUNT;
  }
  game.listen((e) => {
    if (e.type !== 'cc') return;
    knobs = learnKnob(knobs, e.controller);
    turns.set(e.controller, e.value);
    render();
  });
  render();

  return {
    el: h('div.vr-screen', null,
      h('div.vr-top', null,
        h('div', { style: 'display: flex; flex-direction: column; gap: 8px' },
          h('span.vr-kicker.hot', null, 'Setup · your knobs'),
          h('h1.vr-title', null, 'Turn knob 1, then 2, 3, 4'),
          h('p.vr-lede', null, 'Pick four knobs on your keyboard, left to right. Every lesson gives the controls it teaches to these knobs, in this order. The mod wheel and pedals don\'t count.'),
        ),
      ),
      tiles,
      h('div.vr-row', { style: 'max-width: 640px' }, button('Start over', () => { knobs = []; render(); }), done),
    ),
  };
}

/** Touch setup as a step of the game's setup (and from the tour): the touch widget, then on to the next step. */
export function touchScreen(game: Game): Screen {
  const done = button('Continue', () => game.go(nextAfterGate(game)), 'primary');
  done.hidden = true;
  const setup = renderTouchSetup(game, { onDone: () => { done.hidden = false; } });
  game.listen((e, _, raw) => { if (e.type === 'noteOn') setup.note(raw ?? e.velocity); });
  return {
    el: h('div.vr-screen', null,
      h('span.vr-kicker.hot', null, 'Setup · your touch'),
      setup.el,
      h('div', { style: 'max-width: 640px' }, done)),
  };
}

/** Name the band. */
export function bandScreen(game: Game): Screen {
  const input = h('input.vr-input', { id: 'band-name', type: 'text', maxlength: 40, autocomplete: 'off', placeholder: 'Band name', value: game.progress.band });
  const go = button('Form the band', () => {
    game.progress = { ...game.progress, band: input.value.trim() };
    game.save();
    game.go('tour');
  }, 'primary');
  const sync = () => { go.disabled = !input.value.trim(); };
  input.addEventListener('input', sync);
  input.addEventListener('keydown', (e) => { if (e.key === 'Enter' && input.value.trim()) go.click(); });
  sync();
  queueMicrotask(() => input.focus());
  return {
    el: h('div.vr-screen', null,
      h('span.vr-kicker.hot', null, 'Form the band'),
      h('label.vr-title', { for: 'band-name' }, 'What are you called?'),
      input,
      h('p.vr-lede', null, 'You play every member yourself, one at a time: the synth player on a SOLO-1, and the bass player, with the bass played from your keyboard. Drums, guitar and the FX & Mix engineer join in later versions.'),
      h('div', { style: 'max-width: 640px' }, go),
    ),
  };
}

/** Lessons shown in the tree but not built yet, per role and track. */
const LATER: Record<Role, Record<'technique' | 'theory' | 'sound', readonly (readonly [string, string, string])[]>> = {
  synth: {
    technique: [['T3', 'Five-finger patterns', 'coming next'], ['T4', 'Left-hand bass lines', 'coming next'], ['T5', 'Arpeggiator and latch', 'coming next']],
    theory: [['H2', 'Inversions', 'coming next'], ['H3', 'The four-chord song', 'coming next'], ['H4', 'Seventh chords', 'coming next']],
    sound: SOUND_DESIGN_LATER.map((l) => [l.id, l.title, l.topic] as const),
  },
  bass: {
    technique: [['B-T6', 'Eighth-note grooves', 'coming next'], ['B-T7', 'Slides and ghost notes', 'coming next']],
    theory: [['B-H2', 'Walking to the next chord', 'coming next'], ['B-H3', 'The octave', 'coming next']],
    sound: [['B-S2', 'Overdrive', 'Grit that keeps the low end'], ['B-S3', 'Compression', 'Every note the same size']],
  },
};

const ROLE_NAMES: Record<Role, string> = { synth: 'Synth', bass: 'Bass' };

/**
 * A band member's skill tree: Technique, Theory and Sound, with a switch between members. Technique and Theory
 * lessons are open from the start; Sound lessons open in order; the rest are shown, locked.
 */
export function treeScreen(game: Game): Screen {
  const p = game.progress;
  const role = game.role;
  const xp = p.xp[role];
  const locked = (k: string, title: string, sub: string) =>
    h('div.vr-node', null, h('span.k', null, k), h('span.t', null, h('b', null, title), h('span', null, sub)));
  const openNode = (l: { id: string; title: string; topic: string }, open: () => void) => {
    const best = p.passed[l.id];
    const node = h(`button.vr-node.${best !== undefined ? 'done' : 'ready'}` as 'button', { type: 'button' },
      h('span.k', null, l.id),
      h('span.t', null, h('b', null, l.title), h('span', null, l.topic)),
      h('span.score', null, best !== undefined ? `${Math.round(best * 100)}%` : 'start'));
    node.addEventListener('click', open);
    return node;
  };

  const soundLessons = role === 'synth' ? SOUND_DESIGN : BASS_SOUND;
  const sound = soundLessons.map((lesson, i) => {
    const open = i === 0 || p.passed[soundLessons[i - 1]!.id] !== undefined;
    if (!open) return locked(lesson.id, lesson.title, lesson.topic);
    return openNode(lesson, () => game.go({ lesson: lesson.id }));
  });
  const drills = (track: 'technique' | 'theory') => [...TECHNIQUE, ...THEORY]
    .filter((l) => l.role === role && l.track === track)
    .map((l) => openNode(l, () => game.go({ drill: l.id })));
  const grooves = GROOVES.filter((l) => l.role === role).map((l) => openNode(l, () => game.go({ groove: l.id })));
  const lengths = LENGTH_LESSONS.filter((l) => l.role === role).map((l) => openNode(l, () => game.go({ length: l.id })));
  const later = (track: 'technique' | 'theory' | 'sound') => LATER[role][track].map(([k, t, sub]) => locked(k, t, sub));
  const track = (name: string, sub: string, nodes: HTMLElement[]) =>
    h('div', null, h('div.vr-track-head', null, h('span.name', null, name), h('span.vr-mono', null, sub)), h('div.vr-nodes', null, ...nodes));
  const bar = h('div.vr-xpbar', null, h('div', { style: `width: ${Math.round(levelProgress(xp) * 100)}%` }));
  const all = [...soundLessons, ...TECHNIQUE, ...THEORY, ...GROOVES, ...LENGTH_LESSONS].filter((l) => !('role' in l) || l.role === role);
  const done = all.filter((l) => p.passed[l.id] !== undefined).length;

  const tabs = h('div.vr-tabs', { role: 'tablist', 'aria-label': 'Band member' }, ...ROLES.map((r) => {
    const t = h(`button.vr-tab${r === role ? '.on' : ''}` as 'button', { type: 'button', role: 'tab', 'aria-selected': r === role ? 'true' : 'false' },
      h('span', null, ROLE_NAMES[r]), h('span.lv', null, `LV ${level(p.xp[r])}`));
    t.addEventListener('click', () => { game.role = r; game.go('tree'); });
    return t;
  }));

  return {
    el: h('div.vr-screen', null,
      h('div.vr-top', null,
        h('div', { style: 'display: flex; flex-direction: column; gap: 6px' },
          h('span.vr-kicker', null, `${p.band || 'Your band'} · ${ROLE_NAMES[role].toLowerCase()} player`),
          h('h1.vr-title', null, 'Skills'),
          button('← Tour', () => game.go('tour')),
        ),
        h('div.vr-stats', null,
          h('div.vr-stat', null, h('span.k', null, 'LEVEL'), h('span.v', null, String(level(xp))), bar),
          h('div.vr-stat', null, h('span.k', null, 'XP'), h('span.v', null, String(xp))),
          h('div.vr-stat', null, h('span.k', null, 'LESSONS'), h('span.v', null, `${done} / ${all.length}`)),
        ),
      ),
      tabs,
      h('div.vr-tracks', null,
        track('Technique', role === 'synth' ? 'Your hands on the keys' : 'Your hands on the strings', [...drills('technique'), ...grooves, ...lengths, ...later('technique')]),
        track('Theory', 'What to play and why', [...drills('theory'), ...later('theory')]),
        track(role === 'synth' ? 'Sound design' : 'Tone', role === 'synth' ? 'Building patches from nothing' : 'Hands, pickup and amp · on your knobs', [...sound, ...later('sound')]),
      ),
      h('div.vr-row', { style: 'max-width: 960px; margin-top: auto' },
        button('Redo knob setup', () => game.go('knobs')),
        button('Redo touch setup', () => game.go('touch')),
        button('Rename the band', () => game.go('band'))),
    ),
  };
}
