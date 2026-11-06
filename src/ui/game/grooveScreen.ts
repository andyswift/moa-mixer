import { BEATS_PER_BAR, GOOD_MS, GROOVE_PASS_MARK, GROOVES, grooveHits, grooveLengthBeats, GrooveSession, OK_MS, type Grade } from '../../domain/game/groove';
import { noteName } from '../../domain/game/lessons';
import { apply } from '../../domain/game/lessonSession';
import { level, recordPass } from '../../domain/game/progress';
import { bassBase } from '../../domain/game/sounds';
import { button, h } from './dom';
import type { Game, Screen } from './game';

const LOOKAHEAD_S = 0.15; // drums are scheduled this far ahead on the audio clock
const TICK_MS = 25;
const LEAD_S = 0.3; // from the click to the first beat
const SCATTER_MS = 160; // the timing picture spans this either side of the beat

const GRADE_TEXT: Record<Grade, string> = { good: 'Good', close: 'Close', off: 'Off the beat', 'wrong note': 'Wrong note', extra: 'Extra note' };

/**
 * A timing lesson: the drums play a groove and the player plays the bass on the beats shown. Listen plays it through
 * with the bass (not scored); Play counts in and judges each note by how near its beat it lands. The drums are
 * scheduled ahead on the drum engine's audio clock, and notes are judged against when each beat is heard (the
 * engine's output timestamp maps the audio clock onto the MIDI messages' clock).
 */
export function grooveScreen(game: Game, lessonId: string): Screen {
  const lesson = GROOVES.find((l) => l.id === lessonId)!;
  const hits = grooveHits(lesson);
  const beatMs = 60000 / lesson.bpm;
  const countBeats = lesson.countInBars * BEATS_PER_BAR;
  game.instrument = 'bass';
  apply(game.bass, bassBase());

  let session: GrooveSession | undefined;
  let mode: 'idle' | 'listen' | 'play' | 'done' = 'idle';
  let interval = 0;
  let frame = 0;
  const timers: number[] = [];
  /** performance.now() of the count-in's first beat, as heard. */
  let zeroMs = 0;

  function stop(): void {
    clearInterval(interval);
    cancelAnimationFrame(frame);
    for (const t of timers) clearTimeout(t);
    timers.length = 0;
    for (const hit of hits) game.bass.keyUp(hit.note);
  }

  function start(withBass: boolean): void {
    const ctx = game.drumsEngine.context;
    if (!ctx) return;
    stop();
    const beatS = beatMs / 1000;
    const t0 = ctx.currentTime + LEAD_S;
    const ts = ctx.getOutputTimestamp();
    const heardAt = (t: number) => ts.performanceTime && ts.contextTime !== undefined
      ? ts.performanceTime + (t - ts.contextTime) * 1000
      : performance.now() + (t - ctx.currentTime + (ctx.outputLatency || ctx.baseLatency || 0)) * 1000;
    zeroMs = heardAt(t0);
    mode = withBass ? 'listen' : 'play';
    listenBtn.disabled = playBtn.disabled = true; // a run plays to the end
    session = withBass ? undefined : new GrooveSession(lesson, heardAt(t0 + countBeats * beatS));
    // Dev handle: the run in progress, so a test can play notes on its beats.
    if (import.meta.env.DEV) Object.assign(window, { __groove: session });
    feedback.textContent = withBass ? 'Listen: this is how it should go.' : 'One bar to count you in…';
    feedback.className = 'vr-feedback';
    renderStrip();
    scatter.replaceChildren(centre);

    // The drums: one bar of hi-hat to count in, then kick on every beat, snare on 2 and 4, hi-hat on the eighths.
    const total = grooveLengthBeats(lesson) * 2;
    let next = 0;
    const schedule = () => {
      const until = ctx.currentTime + LOOKAHEAD_S;
      while (next < total && t0 + (next * beatS) / 2 < until) {
        const when = t0 + (next * beatS) / 2;
        const beat = Math.floor(next / 2);
        if (beat < countBeats) {
          if (next % 2 === 0) game.drums.trigger('closedHat', beat % BEATS_PER_BAR === 0 ? 1 : 0.7, when);
        } else {
          game.drums.trigger('closedHat', next % 2 === 0 ? 0.5 : 0.3, when);
          if (next % 2 === 0) {
            game.drums.trigger('kick', 1, when);
            if (beat % 2 === 1) game.drums.trigger('snare', 0.8, when);
          }
        }
        next++;
      }
    };
    schedule();
    interval = window.setInterval(schedule, TICK_MS);

    if (withBass) {
      for (const hit of hits) {
        const at = zeroMs + (countBeats + hit.beat) * beatMs - performance.now();
        timers.push(window.setTimeout(() => game.bass.keyDown(hit.note, 90), at));
        timers.push(window.setTimeout(() => game.bass.keyUp(hit.note), at + beatMs * 0.8));
      }
    }
    frame = requestAnimationFrame(tick);
  }

  // The display
  const kicker = h('span.vr-kicker.hot', null, 'Ready');
  const lamps = Array.from({ length: BEATS_PER_BAR }, (_, i) => h('span.vr-lamp', null, String(i + 1)));
  const big = h('span.vr-prompt', null, noteName(hits[0]!.note));
  const keyHint = h('span.vr-spelled');
  const feedback = h('span.vr-feedback', { role: 'status' }, 'Press Listen to hear it, then Play.');
  const listenBtn = button('▶ Listen', () => start(true));
  const playBtn = button('Play', () => start(false), 'primary');
  const card = h('div.vr-card.hot.vr-prompt-card', null, kicker, h('div.vr-lamps', null, ...lamps), big, keyHint, feedback, h('div.vr-row', null, listenBtn, playBtn));
  const strip = h('div.vr-hits');
  const centre = h('div.vr-scatter-centre');
  const scatter = h('div.vr-scatter', { 'aria-hidden': 'true' }, centre);
  const result = h('div.vr-card.hot', { hidden: true });
  const hint = h('div.vr-card.hint', { hidden: true }, h('span.vr-kicker.hot', null, 'Hint'), h('span', { style: 'font-size: 15px; line-height: 1.5' }, lesson.hint));

  function showNote(i: number | undefined): void {
    const hit = hits[i ?? 0]!;
    big.textContent = noteName(hit.note);
    const bar = lesson.bars[hit.bar]!;
    keyHint.textContent = `beats ${bar.beats.map((b) => b + 1).join(' ')}   ·   on your keyboard ${noteName(hit.note + 12)}`;
  }
  showNote(0);

  function renderStrip(now = performance.now()): void {
    strip.replaceChildren(...hits.map((_, i) => {
      const r = session?.results[i];
      const missed = session && !r && now > session.due(i) + OK_MS * 2.3;
      const cls = r ? (r.grade === 'good' ? '.good' : r.grade === 'close' ? '.close' : '.bad') : missed ? '.bad' : '';
      return h(`span.vr-hit${cls}` as 'span', { title: r ? GRADE_TEXT[r.grade] : missed ? 'Missed' : undefined });
    }));
  }

  function tick(): void {
    const now = performance.now();
    const beat = Math.floor((now - zeroMs) / beatMs);
    const total = grooveLengthBeats(lesson);
    if (beat >= 0 && beat < total) {
      const inBar = beat % BEATS_PER_BAR;
      const played = beat - countBeats;
      const bar = played >= 0 ? lesson.bars[Math.floor(played / BEATS_PER_BAR)] : undefined;
      kicker.textContent = played < 0 ? `Count-in · ${inBar + 1}` : `Bar ${Math.floor(played / BEATS_PER_BAR) + 1} of ${lesson.bars.length}`;
      lamps.forEach((l, i) => {
        l.classList.toggle('now', i === inBar);
        l.classList.toggle('play', !!bar?.beats.includes(i));
      });
    }
    if (session) {
      showNote(session.current(now));
      renderStrip(now);
      if (session.finished(now)) { finish(); return; }
    } else if (mode === 'listen') {
      const playedBeat = beat - countBeats;
      const i = hits.findIndex((hh) => hh.beat >= playedBeat);
      showNote(i < 0 ? hits.length - 1 : i);
      if (beat >= total) {
        stop();
        mode = 'idle';
        listenBtn.disabled = playBtn.disabled = false;
        kicker.textContent = 'Ready';
        feedback.textContent = 'Now you: press Play. Play on the beats shown, with the kick.';
        lamps.forEach((l) => l.classList.remove('now'));
        return;
      }
    }
    frame = requestAnimationFrame(tick);
  }

  function finish(): void {
    stop();
    mode = 'done';
    renderStrip(Infinity);
    lamps.forEach((l) => l.classList.remove('now'));
    const s = session!;
    const role = lesson.role;
    const good = s.results.filter((r) => r?.grade === 'good').length;
    const close = s.results.filter((r) => r?.grade === 'close').length;
    const summary = `${good} good, ${close} close, ${hits.length - good - close} missed or off · ${Math.round(s.score * 100)}%`;
    if (s.passed) {
      const before = game.progress;
      game.progress = recordPass(before, role, lesson.id, lesson.xp, s.score);
      game.save();
      const gained = game.progress.xp[role] - before.xp[role];
      result.replaceChildren(
        h('span.vr-kicker.hot', null, 'Locked in'),
        h('span', { style: 'font-family: var(--vr-display); font-size: 40px; text-transform: uppercase' }, `+${gained} XP`),
        h('span.vr-mono', null, `${summary}${level(game.progress.xp[role]) > level(before.xp[role]) ? ` · Level ${level(game.progress.xp[role])}` : ''}`),
        h('div.vr-row', null, button('Back to skills', () => game.go('tree'), 'primary'), button('Play it again', () => game.go({ groove: lesson.id }))),
      );
    } else {
      hint.hidden = false;
      result.replaceChildren(
        h('span.vr-kicker.hot', null, 'Not locked in yet'),
        h('span', { style: 'font-size: 18px' }, `${summary}. You need ${Math.round(GROOVE_PASS_MARK * 100)}%.`),
        h('div.vr-row', null, button('Try again', () => game.go({ groove: lesson.id }), 'primary'), button('Back to skills', () => game.go('tree'))),
      );
    }
    card.hidden = true;
    result.hidden = false;
  }

  game.listen((e, time) => {
    if (e.type !== 'noteOn' || mode !== 'play' || !session) return;
    const r = session.play(e.note, time);
    const off = r.offsetMs === undefined ? '' : ` · ${Math.abs(Math.round(r.offsetMs))} ms ${r.offsetMs < 0 ? 'early' : 'late'}`;
    feedback.textContent = `${GRADE_TEXT[r.grade]}${off}`;
    feedback.className = `vr-feedback ${r.grade === 'good' || r.grade === 'close' ? 'right' : 'wrong'}`;
    if (r.offsetMs !== undefined) {
      const x = 50 + (Math.max(-SCATTER_MS, Math.min(SCATTER_MS, r.offsetMs)) / SCATTER_MS) * 50;
      const dot = h(`span.vr-scatter-dot${r.grade === 'good' ? '.good' : ''}` as 'span');
      dot.style.left = `${x}%`;
      dot.style.top = `${10 + (scatter.childElementCount % 8) * 9}px`;
      scatter.append(dot);
    }
  });

  return {
    el: h('div.vr-screen', null,
      h('div.vr-top', null,
        h('div', { style: 'display: flex; flex-direction: column; gap: 6px' },
          h('span.vr-kicker.hot', null, `Lesson ${lesson.id} · ${lesson.title} · Bass Technique · ${lesson.bpm} BPM`),
          h('h1.vr-title', null, lesson.goal),
        ),
        button('← Skills', () => game.go('tree')),
      ),
      h('div.vr-lesson', null,
        h('div.vr-side', null, h('div.vr-card.vr-intro', null, ...lesson.intro.map((p) => h('p', null, p))), hint),
        h('div.vr-side', null, card, result,
          h('span.vr-label', null, `Your notes · ${hits.length}`), strip,
          h('span.vr-label', null, `Timing · early ← beat → late · good within ${GOOD_MS} ms`), scatter,
          h('p.vr-mono', null, 'Your keys play the MOA-BASS, an octave below the keys. The mod wheel rests your palm on the strings.')),
      ),
    ),
    dispose() {
      stop();
      if (import.meta.env.DEV) Object.assign(window, { __groove: undefined });
    },
  };
}
