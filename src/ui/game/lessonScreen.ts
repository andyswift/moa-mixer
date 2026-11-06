import { knobIndex } from '../../domain/game/knobs';
import { LessonSession } from '../../domain/game/lessonSession';
import { bassBase } from '../../domain/game/sounds';
import { BASS_SOUND, noteName, SOUND_DESIGN, type Lesson } from '../../domain/game/lessons';
import { level, recordPass, type Role } from '../../domain/game/progress';
import { button, h } from './dom';
import type { Game, Screen } from './game';
import { BASS_RIG, formatValue, PANEL_NAMES, renderPanel, SOLO1 } from './solo1Panel';

/** Something a phrase can be played on. */
interface Keys {
  keyDown(note: number, velocity?: number): void;
  keyUp(note: number): void;
}



const RELEASE_TAIL_MS = 500;

/** Plays a phrase on the synth from timers; returns a stop function. `done` runs once, when it ends or is stopped. */
function playPhrase(synth: Keys, phrase: Lesson['demo'], done: () => void): () => void {
  const beatMs = 60000 / phrase.bpm;
  const timers: number[] = [];
  let finished = false;
  const finish = () => {
    if (finished) return;
    finished = true;
    for (const t of timers) clearTimeout(t);
    for (const n of phrase.notes) synth.keyUp(n.note);
    done();
  };
  for (const n of phrase.notes) {
    timers.push(window.setTimeout(() => synth.keyDown(n.note, 100), n.at * beatMs));
    timers.push(window.setTimeout(() => synth.keyUp(n.note), (n.at + n.beats) * beatMs));
  }
  const end = Math.max(...phrase.notes.map((n) => n.at + n.beats)) * beatMs + RELEASE_TAIL_MS;
  timers.push(window.setTimeout(finish, end));
  return finish;
}

/**
 * A Sound Design lesson: the teaching, the SOLO-1 with the lesson's controls on the player's knobs, the target to
 * hear, a check that scores each control, and once it matches, a riff to play with the new sound.
 */
export function lessonScreen(game: Game, lessonId: string): Screen {
  const onBass = BASS_SOUND.some((l) => l.id === lessonId);
  const list = onBass ? BASS_SOUND : SOUND_DESIGN;
  const index = list.findIndex((l) => l.id === lessonId);
  const lesson = list[index]!;
  const next = list[index + 1];
  const role: Role = onBass ? 'bass' : 'synth';
  const device = onBass ? game.bass : game.synth;
  game.instrument = onBass ? 'bass' : 'mono';
  const session = onBass
    ? new LessonSession(device, lesson, bassBase())
    : new LessonSession(device, lesson);
  const panel = renderPanel(onBass ? BASS_RIG : SOLO1, (id) => device.control(id));
  panel.setActive(lesson.controls.map((c) => c.id));

  let stop: (() => void) | undefined;
  let phase: 'build' | 'riff' | 'passed' = 'build';
  let lastScore = 0;

  // Listening
  const hearTarget = button('▶ Hear the target', () => play(true), 'primary');
  const hearYours = button('Hear yours', () => play(false));
  function play(target: boolean): void {
    stop?.();
    if (target) { panel.freeze(true); session.showTarget(); }
    hearTarget.disabled = hearYours.disabled = true;
    stop = playPhrase(device, lesson.demo, () => {
      if (target) { session.showYours(); panel.freeze(false); }
      hearTarget.disabled = hearYours.disabled = false;
      stop = undefined;
    });
  }

  // Checking
  const meterFill = h('div', { style: 'width: 0%' });
  const meterLabel = h('span.vr-label', null, 'Sound match');
  const scores = h('div.vr-scores');
  const hint = h('div.vr-card.hint', { hidden: true }, h('span.vr-kicker.hot', null, 'Hint'), h('span', { style: 'font-size: 15px; line-height: 1.5' }, lesson.hint));
  const toast = h('span.vr-toast', { role: 'status' });
  const check = button('Check my sound', () => runCheck());
  const matchCard = h('div.vr-card', null, meterLabel, h('div.vr-meter', null, meterFill), scores, check, toast);

  function runCheck(): void {
    const result = session.check();
    lastScore = result.score;
    meterFill.style.width = `${Math.round(result.score * 100)}%`;
    meterLabel.textContent = `Sound match · ${Math.round(result.score * 100)}%`;
    scores.replaceChildren(...result.scores.map((s, i) => {
      const spec = lesson.controls[i]!;
      const c = device.control(s.id);
      let text = s.direction === 'ok' ? 'match' : s.direction === 'low' ? spec.low : spec.high;
      if (session.revealed && s.direction !== 'ok') text += ` · ${formatValue(c)} → ${formatValue(c, lesson.target[s.id]!)}`;
      return h('div.vr-score', null, h('span', null, `K${i + 1} · ${PANEL_NAMES[s.id] ?? s.id}`), h(`span.s${s.direction === 'ok' ? '' : '.off'}` as 'span', null, text));
    }));
    hint.hidden = false;
    if (session.revealed) panel.setGhost(lesson.target);
    if (result.passed) startRiff();
    else toast.textContent = session.revealed ? 'Dashed caps on the panel show where the target sits.' : 'Not yet. Listen to the target again, then move the knobs that are off.';
  }

  // The riff
  const riffNotes = h('div.vr-riff');
  const riffCard = h('div.vr-card.hot', { hidden: true },
    h('span.vr-kicker.hot', null, 'It matches · now play it'),
    h('span', { style: 'font-size: 15px' }, onBass
      ? 'Play these notes in order with the sound you made (on your keyboard, an octave up: the bass sounds an octave below the keys).'
      : 'Play these keys in order with the sound you made.'),
    riffNotes);
  function renderRiff(): void {
    riffNotes.replaceChildren(...lesson.riff.map((n, i) =>
      h(`span${i < session.riffProgress ? '.done' : i === session.riffProgress ? '.next' : ''}` as 'span', null, noteName(n))));
  }
  function startRiff(): void {
    phase = 'riff';
    check.disabled = true;
    toast.textContent = '';
    riffCard.hidden = false;
    renderRiff();
  }

  // Passed
  const passedCard = h('div.vr-card.hot', { hidden: true });
  function pass(): void {
    phase = 'passed';
    const before = game.progress;
    game.progress = recordPass(before, role, lesson.id, lesson.xp, lastScore);
    game.save();
    const gained = game.progress.xp[role] - before.xp[role];
    const levelUp = level(game.progress.xp[role]) > level(before.xp[role]);
    passedCard.replaceChildren(
      h('span.vr-kicker.hot', null, 'Lesson passed'),
      h('span', { style: 'font-family: var(--vr-display); font-size: 40px; text-transform: uppercase' }, `+${gained} XP`),
      h('span.vr-mono', null, levelUp ? `Level ${level(game.progress.xp[role])}: your playing just got better.` : `Score ${Math.round(lastScore * 100)}%`),
      h('div.vr-row', null,
        button('Back to skills', () => game.go('tree')),
        next ? button(`Next: ${next.title}`, () => game.go({ lesson: next.id }), 'primary') : null),
    );
    riffCard.hidden = true;
    passedCard.hidden = false;
  }

  game.listen((e) => {
    if (e.type === 'cc') {
      const k = knobIndex(game.progress.knobs, e.controller);
      if (k >= 0) session.turnKnob(k, e.value);
    } else if (e.type === 'noteOn' && phase === 'riff') {
      session.playRiffNote(e.note);
    } else if (e.type === 'noteOff' && phase === 'riff') {
      // the next note lights when every key is up
      if (session.releaseRiffNote(e.note)) renderRiff();
      if (session.riffDone) pass();
    }
  });

  const knobLegend = h('div.vr-row', { style: 'gap: 18px' }, ...lesson.controls.map((c, i) =>
    h('span.vr-mono', null, `Knob ${i + 1} → ${PANEL_NAMES[c.id] ?? c.id}`)));

  const el = h('div.vr-screen', null,
    h('div.vr-top', null,
      h('div', { style: 'display: flex; flex-direction: column; gap: 6px' },
        h('span.vr-kicker.hot', null, `Lesson ${lesson.id} · ${lesson.title} · ${lesson.topic}`),
        h('h1.vr-title', null, lesson.goal),
      ),
      button('← Skills', () => game.go('tree')),
    ),
    h('div.vr-lesson', null,
      h('div.vr-side', null,
        h('div.vr-card.vr-intro', null, ...lesson.intro.map((p) => h('p', null, p))),
        h('div.vr-row', null, hearTarget, hearYours),
        matchCard, riffCard, passedCard, hint,
      ),
      h('div.vr-side', null, panel.el, knobLegend,
        h('p.vr-mono', null, onBass
          ? 'Only the lesson\'s controls move: the rest are locked for now. Play notes any time to hear your sound: the bass sounds an octave below your keys, and the mod wheel rests your palm on the strings.'
          : 'Only the lesson\'s controls move: the rest are locked for now. Play notes any time to hear your sound.')),
    ),
  );

  return {
    el,
    dispose() {
      stop?.();
      session.showYours();
      panel.dispose();
    },
  };
}
