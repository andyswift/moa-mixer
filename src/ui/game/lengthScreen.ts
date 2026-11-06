import { LENGTH_PASS_MARK, lengthLessonById, lengthLessonScore } from '../../domain/game/lengthLessons';
import { cuesOf, withPalm, type CueResult, type LengthGrade } from '../../domain/game/performance';
import { level, recordPass } from '../../domain/game/progress';
import { playSong, setUpBand } from './bandPlayer';
import { renderChart } from './chartView';
import { button, h } from './dom';
import { renderFretboard } from './fretboardView';
import type { Game, Screen } from './game';
import { renderKeys } from './keysView';
import { renderTouchMeter } from './touchMeter';
import { renderTouchSetup } from './touchSetupView';
import { noteName } from '../../domain/game/lessons';
import { GAME_DEAD_MAX } from '../../domain/game/touch';
import { playAlong } from './playAlong';

const TIMING: Record<CueResult['grade'], string> = { good: 'On the beat', close: 'Close', off: 'Off the beat', wrong: 'Wrong note', missed: 'Missed' };
const WHY: Record<NonNullable<CueResult['why']>, string> = { 'not dead': 'too loud for a dead note: barely touch the key', 'no palm': 'no palm: push the mod wheel up', 'too soft': 'too soft: that played as a dead note' };
const LENGTH: Record<LengthGrade, string> = { good: 'held just right', short: 'let go too early', long: 'held too long' };

/**
 * A length lesson: the teaching, then Listen (the part played through with the drums) and Play (you play it, judged
 * on timing, on how long each note is held and, on the bass, on its touch). The chart shows each note as long as it
 * should last, and fills in under it while you hold it.
 */
export function lengthScreen(game: Game, lessonId: string): Screen {
  const lesson = lengthLessonById(lessonId)!;
  const role = lesson.role;
  const song = lesson.song;
  setUpBand(game, role);
  let stop: (() => void) | undefined;
  const view = role === 'bass' ? renderFretboard() : renderKeys();
  const held = new Set<number>();
  const showHeld = (e: { type: string; note?: number }) => {
    if (e.type === 'noteOn') held.add(e.note!);
    else if (e.type === 'noteOff') held.delete(e.note!);
    else return;
    view.set(held);
  };
  const lessonListener = () => game.listen((e) => { showHeld(e); if (e.type === 'noteOn') meter.show(e.velocity); });
  lessonListener();

  const feedback = h('span.vr-feedback', { role: 'status' }, 'Listen first, then play.');
  // what comes next, big: a dead note or the palm needs a different hand before the note arrives
  const nextWhat = h('span.what', null, '');
  const nextHow = h('span.vr-mono', null, '');
  const nextUp = h('div.vr-next', { hidden: !lesson.touch }, h('span.vr-label', null, 'Next'), nextWhat, nextHow);
  // the meter works on the game's scale: the player's touch setup already moved their soft notes under GAME_DEAD_MAX
  const meter = renderTouchMeter(GAME_DEAD_MAX, false);
  meter.el.hidden = !lesson.touch;
  const slot = h('div');
  const result = h('div.vr-card.hot', { hidden: true });
  const hint = h('div.vr-card.hint', { hidden: true }, h('span.vr-kicker.hot', null, 'Hint'), h('span', { style: 'font-size: 15px; line-height: 1.5' }, lesson.hint));
  const preview = renderChart(song, role, withPalm(cuesOf(song.parts[role]), role === 'bass' ? song.palm ?? [] : []));
  preview.scroll(0);
  slot.replaceChildren(preview.el);
  const halt = () => { stop?.(); stop = undefined; };

  // Setting the touch again without leaving the lesson: the same four soft, four normal notes, on the keyboard's own
  // velocities; the new threshold is saved at once, so the next note played in the lesson already uses it.
  const touchCard = h('div.vr-card.hot', { hidden: true });
  const retouch = button('Set my touch again', () => {
    halt();
    result.hidden = true;
    const setup = renderTouchSetup(game, { compact: true });
    touchCard.replaceChildren(setup.el, button('Back to the lesson', () => { touchCard.hidden = true; retouch.hidden = false; lessonListener(); }, 'primary'));
    touchCard.hidden = false;
    retouch.hidden = true;
    game.listen((e, _, raw) => { showHeld(e); if (e.type === 'noteOn') setup.note(raw ?? e.velocity); });
  });
  retouch.hidden = !lesson.touch;

  const listen = button('▶ Listen', () => {
    halt();
    result.hidden = true;
    setUpBand(game, role);
    const chart = renderChart(song, role, withPalm(cuesOf(song.parts[role]), role === 'bass' ? song.palm ?? [] : []));
    slot.replaceChildren(chart.el);
    const r = playSong(game, song, {});
    if (!r) return;
    feedback.textContent = 'Listen to how long each note lasts.';
    let frame = 0;
    const tick = () => {
      const beat = r.beatNow();
      chart.scroll(beat);
      if (beat > r.endBeat + 1) { r.stop(); feedback.textContent = 'Now you: press Play.'; return; }
      frame = requestAnimationFrame(tick);
    };
    frame = requestAnimationFrame(tick);
    stop = () => { cancelAnimationFrame(frame); r.stop(); };
  });

  const play = button('Play', () => {
    halt();
    result.hidden = true;
    feedback.textContent = 'One bar of hi-hat to count you in…';
    let lastTiming = '';
    const along = playAlong(game, song, role, { lengths: 'scored', touch: lesson.touch, seed: 5 }, {
      onMidi: (e) => { showHeld(e); if (e.type === 'noteOn') meter.show(e.velocity); },
      onFrame: (_, judge) => {
        if (!lesson.touch) return;
        const i = judge.current(performance.now());
        const c = i === undefined ? undefined : judge.cues[i];
        nextWhat.textContent = !c ? '' : c.dead ? 'DEAD' : noteName(c.notes[0]!);
        nextWhat.className = `what${c?.dead ? ' dead' : ''}`;
        nextHow.textContent = !c ? '' : c.dead ? 'barely touch any key' : c.palm ? 'palm: mod wheel up' : 'a full note';
      },
      onResult: (_, r) => {
        lastTiming = r.why ? WHY[r.why] : TIMING[r.grade];
        feedback.textContent = lastTiming;
        feedback.className = `vr-feedback ${r.grade === 'good' || r.grade === 'close' ? 'right' : 'wrong'}`;
      },
      onLength: (_, g) => {
        feedback.textContent = `${lastTiming} · ${LENGTH[g]}`;
        feedback.className = `vr-feedback ${g === 'good' ? 'right' : 'wrong'}`;
      },
      onEnd: (judge) => {
        stop = undefined;
        const score = lengthLessonScore(lesson, judge);
        const sections = song.sections.slice(1).map((s) => {
          const idx = judge.cues.map((c, i) => (c.t >= s.from && c.t < s.to ? i : -1)).filter((i) => i >= 0);
          return h('div.vr-score', null, h('span', null, s.name), h(`span.s${judge.scoreFor(idx) >= LENGTH_PASS_MARK ? '' : '.off'}` as 'span', null, `${Math.round(judge.scoreFor(idx) * 100)}%`));
        });
        const passed = score >= LENGTH_PASS_MARK;
        let line = `${Math.round(score * 100)}% · each part counts the same`;
        if (passed) {
          const before = game.progress;
          game.progress = recordPass(before, role, lesson.id, lesson.xp, score);
          game.save();
          const gained = game.progress.xp[role] - before.xp[role];
          line += ` · +${gained} XP${level(game.progress.xp[role]) > level(before.xp[role]) ? ` · level ${level(game.progress.xp[role])}` : ''}`;
        } else hint.hidden = false;
        result.replaceChildren(
          h('span.vr-kicker.hot', null, passed ? 'Lesson passed' : `Not yet · you need ${Math.round(LENGTH_PASS_MARK * 100)}%`),
          h('span', { style: 'font-size: 18px' }, line),
          h('div.vr-scores', null, ...sections),
          h('div.vr-row', null, button(passed ? 'Back to skills' : 'Try again', () => game.go(passed ? 'tree' : { length: lesson.id }), 'primary'), button(passed ? 'Play it again' : 'Back to skills', () => game.go(passed ? { length: lesson.id } : 'tree'))));
        result.hidden = false;
      },
    });
    if (!along) return;
    stop = along.stop;
    slot.replaceChildren(along.chart);
  }, 'primary');

  return {
    el: h('div.vr-screen', null,
      h('div.vr-top', null,
        h('div', { style: 'display: flex; flex-direction: column; gap: 6px' },
          h('span.vr-kicker.hot', null, `Lesson ${lesson.id} · ${lesson.title} · ${role === 'bass' ? 'Bass' : 'Synth'} Technique · ${song.bpm} BPM`),
          h('h1.vr-title', null, lesson.goal),
        ),
        button('← Skills', () => game.go('tree')),
      ),
      h('div.vr-lesson', null,
        h('div.vr-side', null, h('div.vr-card.vr-intro', null, ...lesson.intro.map((p) => h('p', null, p))), hint),
        h('div.vr-side', null,
          h('div.vr-row', null, listen, play, retouch), touchCard, nextUp, feedback, slot, meter.el,
          h('span.vr-mono', null, 'Each block is as long as the note should last. The bar under it fills while you hold it; past the end means too long.'),
          result, view.el,
          h('p.vr-mono', null, role === 'bass' ? 'Your keys play the bass, an octave below the keys. The mod wheel is your palm on the strings.' : 'Your keys play the band\'s poly synth.')),
      ),
    ),
    dispose: halt,
  };
}
