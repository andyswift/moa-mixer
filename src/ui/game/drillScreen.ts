import { answerLabel, DrillSession, guideTriad, keysLabel, part, promptLabel, shortLabel, spellTriad, TECHNIQUE, THEORY, voiceTriad, type Prompt } from '../../domain/game/drills';
import { level, recordPass } from '../../domain/game/progress';
import { button, h } from './dom';
import type { Game, Screen } from './game';

const KEYS_FROM = 36; // C2
const KEYS_TO = 84; // C6
const BLACK = new Set([1, 3, 6, 8, 10]);
const CHORD_MS = 2000;
const SHOW_DELAY_MS = 450;

type Chord = Extract<Prompt, { kind: 'chord' }>;

/** A keyboard picture: held keys light up, guide keys (a chord to copy) are marked; the Cs carry their names. */
function renderKeys(): { el: HTMLElement; set(held: ReadonlySet<number>): void; guide(keys: readonly number[]): void } {
  const keys = new Map<number, HTMLElement>();
  const whites = h('div.vr-keys-white');
  const blacks = h('div.vr-keys-black');
  let whiteCount = 0;
  for (let n = KEYS_FROM; n <= KEYS_TO; n++) if (!BLACK.has(n % 12)) whiteCount++;
  let w = 0;
  for (let n = KEYS_FROM; n <= KEYS_TO; n++) {
    if (BLACK.has(n % 12)) {
      const k = h('div.vr-key.black', { style: `left: calc(${(w / whiteCount) * 100}% - 0.9%)` });
      keys.set(n, k);
      blacks.append(k);
    } else {
      const k = h('div.vr-key.white', null, n % 12 === 0 ? `C${n / 12 - 1}` : '');
      keys.set(n, k);
      whites.append(k);
      w++;
    }
  }
  return {
    el: h('div.vr-keys', { 'aria-hidden': 'true' }, whites, blacks),
    set(held) { for (const [n, k] of keys) k.classList.toggle('down', held.has(n)); },
    guide(g) { for (const [n, k] of keys) k.classList.toggle('guide', g.includes(n)); },
  };
}

const PART_TITLE = { learn: 'Part 1 of 3 · Learn it: copy the lit keys', test: 'Part 2 of 3 · From memory', ear: 'Part 3 of 3 · By ear: major or minor? Play it back' };

/**
 * A playing lesson (Technique or Theory): the teaching on the left; on the right the prompt, big, with the player's
 * answers judged as they play, the run of prompts, and a keyboard picture of what is held. The chord lesson first
 * shows and plays each chord (Part 1, not scored), with a chord chart that fills in as the player learns them, then
 * asks for them from memory and by ear.
 */
export function drillScreen(game: Game, lessonId: string): Screen {
  const lesson = [...TECHNIQUE, ...THEORY].find((l) => l.id === lessonId)!;
  const session = new DrillSession(lesson);
  const timers: number[] = [];
  const hasParts = lesson.prompts.some((p) => part(p) === 'learn');

  // The instrument
  game.instrument = lesson.instrument.kind;
  if (lesson.instrument.kind === 'mono') game.synth.loadPreset({ name: lesson.title, values: lesson.instrument.sound });
  else game.poly.loadPreset({ name: lesson.title, values: lesson.instrument.sound });

  function playChord(p: Chord): void {
    const notes = voiceTriad(p);
    for (const n of notes) game.poly.keyDown(n);
    timers.push(window.setTimeout(() => { for (const n of notes) game.poly.keyUp(n); }, CHORD_MS));
  }

  // The prompt
  const kicker = h('span.vr-kicker.hot');
  const big = h('span.vr-prompt');
  const spelled = h('span.vr-spelled');
  const feedback = h('span.vr-feedback', { role: 'status' });
  const again = button('▶ Hear it again', () => { const p = session.prompt; if (p?.kind === 'chord') playChord(p); });
  const promptCard = h('div.vr-card.hot.vr-prompt-card', null, kicker, big, spelled, feedback, again);
  const chips = h('div.vr-chips');
  const keys = renderKeys();
  const hint = h('div.vr-card.hint', { hidden: true }, h('span.vr-kicker.hot', null, 'Hint'), h('span', { style: 'font-size: 15px; line-height: 1.5' }, lesson.hint));
  const result = h('div.vr-card.hot', { hidden: true });

  // The chord chart: the chords Part 1 teaches, filled in as they are learned, shown while learning.
  const taught = lesson.prompts.map((p, i) => ({ p, i })).filter(({ p }) => part(p) === 'learn') as { p: Chord; i: number }[];
  const chartRows = h('div.vr-chart-rows');
  const chart = h('div.vr-card', { hidden: !hasParts }, h('span.vr-kicker', null, 'Chord chart'), chartRows,
    h('span.vr-mono', null, 'Major: root +4 +3. Minor: root +3 +4.'));
  function renderChart(): void {
    chartRows.replaceChildren(...taught.map(({ p, i }) => {
      const state = i < session.index ? 'learned' : i === session.index ? 'now' : '';
      return h(`div.vr-chart-row${state ? '.' + state : ''}` as 'div', null,
        h('span.name', null, `${promptLabel({ ...p, teach: false })}`),
        h('span.notes', null, spellTriad(p).join(' ')),
        h('span.q', null, p.quality === 'major' ? 'bright' : 'dark'));
    }));
    chart.hidden = !hasParts || (session.prompt !== undefined && part(session.prompt) !== 'learn');
  }

  function renderPrompt(): void {
    const p = session.prompt;
    if (!p) return;
    keys.guide([]);
    spelled.textContent = '';
    if (p.kind === 'note') {
      kicker.textContent = p.octave === undefined ? 'Play any' : 'Play exactly';
      big.textContent = promptLabel(p);
      again.hidden = true;
      return;
    }
    const which = part(p);
    kicker.textContent = PART_TITLE[which];
    big.textContent = promptLabel(p);
    again.hidden = which === 'test';
    if (which === 'learn') {
      spelled.textContent = `${spellTriad(p).join('  ')}   ·   root  +${p.quality === 'major' ? 4 : 3}  +${p.quality === 'major' ? 3 : 4}`;
      keys.guide(guideTriad(p));
    }
    if (which !== 'test') timers.push(window.setTimeout(() => playChord(p), SHOW_DELAY_MS));
  }
  function renderChips(): void {
    chips.replaceChildren(...lesson.prompts.map((p, i) => {
      const first = session.firstTry(i);
      const learn = part(p) === 'learn';
      const state = i === session.index ? 'now' : i >= session.index ? (learn ? 'learn' : '') : learn ? 'learned' : first ? 'right' : 'missed';
      return h(`span.vr-chip${state ? '.' + state : ''}` as 'span', { title: i < session.index ? answerLabel(p) : undefined },
        i < session.index || learn ? shortLabel(p) : String(i + 1));
    }));
    renderChart();
  }

  function finish(): void {
    promptCard.hidden = true;
    keys.guide([]);
    const score = session.score;
    const counted = hasParts ? ' of the chords from memory and by ear' : '';
    if (session.passed) {
      const before = game.progress;
      game.progress = recordPass(before, lesson.id, lesson.xp, score);
      game.save();
      const gained = game.progress.xp - before.xp;
      result.replaceChildren(
        h('span.vr-kicker.hot', null, 'Lesson passed'),
        h('span', { style: 'font-family: var(--vr-display); font-size: 40px; text-transform: uppercase' }, `+${gained} XP`),
        h('span.vr-mono', null, `${Math.round(score * 100)}% right first time${counted}${level(game.progress.xp) > level(before.xp) ? ` · Level ${level(game.progress.xp)}` : ''}`),
        h('div.vr-row', null, button('Back to skills', () => game.go('tree'), 'primary'), button('Play it again', () => game.go({ drill: lesson.id }))),
      );
    } else {
      result.replaceChildren(
        h('span.vr-kicker.hot', null, 'Not yet'),
        h('span', { style: 'font-size: 18px' }, `${Math.round(score * 100)}% right first time${counted}. You need 70%.`),
        h('div.vr-row', null, button('Try again', () => game.go({ drill: lesson.id }), 'primary'), button('Back to skills', () => game.go('tree'))),
      );
    }
    result.hidden = false;
  }

  const held = new Set<number>();
  game.listen((e) => {
    if (e.type === 'noteOn') {
      held.add(e.note);
      keys.set(held);
      const asked = session.prompt;
      const j = session.keyDown(e.note);
      if (j === 'right' && asked) {
        const next = session.prompt;
        const newPart = hasParts && next && part(next) !== part(asked);
        feedback.textContent = newPart && part(next) === 'test' ? 'You have learned them all. Now play them from memory: the keys are not lit any more.'
          : newPart ? 'Now by ear: the game plays a chord and names its root. Is it major or minor?'
            : `Right: ${answerLabel(asked)}`;
        feedback.className = 'vr-feedback right';
        renderChips();
        if (session.done) finish();
        else renderPrompt();
      } else if (j === 'wrong' && asked) {
        feedback.textContent = part(asked) === 'learn'
          ? `You played ${keysLabel(session.lastPlayed)}. Copy the lit keys: ${spellTriad(asked as Chord).join(' ')}.`
          : `You played ${keysLabel(session.lastPlayed)}. Try again.`;
        feedback.className = 'vr-feedback wrong';
        if (part(asked) !== 'learn') hint.hidden = false;
        renderChips();
      }
    } else if (e.type === 'noteOff') {
      held.delete(e.note);
      keys.set(held);
      session.keyUp(e.note);
    }
  });

  renderPrompt();
  renderChips();

  const el = h('div.vr-screen', null,
    h('div.vr-top', null,
      h('div', { style: 'display: flex; flex-direction: column; gap: 6px' },
        h('span.vr-kicker.hot', null, `Lesson ${lesson.id} · ${lesson.title} · ${lesson.track === 'technique' ? 'Technique' : 'Theory'}`),
        h('h1.vr-title', null, lesson.goal),
      ),
      button('← Skills', () => game.go('tree')),
    ),
    h('div.vr-lesson', null,
      h('div.vr-side', null, h('div.vr-card.vr-intro', null, ...lesson.intro.map((p) => h('p', null, p))), chart, hint),
      h('div.vr-side', null, promptCard, result, chips, keys.el,
        h('p.vr-mono', null, lesson.instrument.kind === 'poly' ? 'Your keys play the MOA-6 strings in this lesson, so chords sound.' : 'Your keys play the SOLO-1.')),
    ),
  );
  return { el, dispose() { for (const t of timers) clearTimeout(t); } };
}
