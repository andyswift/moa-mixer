import { spellTriad } from '../../domain/game/drills';
import { bassPosition, describePosition } from '../../domain/game/fretboard';
import { noteName } from '../../domain/game/lessons';
import { cuesOf, type CueGrade, type PartJudge } from '../../domain/game/performance';
import { level, ROLES, type Role } from '../../domain/game/progress';
import { StepSession, stepsOf, type Step } from '../../domain/game/rehearsal';
import { chordAt, songById, type GameSong } from '../../domain/game/songs';
import { adviceFor, canBook, gigOutcome, recordGig, recordRehearsal, REHEARSED_MARK, venueById, VENUES } from '../../domain/game/tour';
import type { MidiEvent } from '../../domain/midi/events';
import { playSong, setUpBand } from './bandPlayer';
import { renderChart } from './chartView';
import { button, h } from './dom';
import { renderFretboard } from './fretboardView';
import type { Game, Screen } from './game';
import { renderKeys } from './keysView';
import { playAlong } from './playAlong';

const ROLE_NAMES: Record<Role, string> = { synth: 'Synth', bass: 'Bass' };
const GRADE_TEXT: Record<CueGrade, string> = { good: 'Good', close: 'Close', off: 'Off the beat', wrong: 'Wrong note', missed: 'Missed' };
const BETWEEN_SONGS_MS = 3500;
const SLOW = 0.75;

/** A picture of what the player holds: the neck on the bass, the keyboard on the synth. */
function heldView(role: Role) {
  const view = role === 'bass' ? renderFretboard() : renderKeys();
  const held = new Set<number>();
  return {
    el: view.el,
    midi(e: MidiEvent) {
      if (e.type === 'noteOn') held.add(e.note);
      else if (e.type === 'noteOff') held.delete(e.note);
      else return;
      view.set(held);
    },
    guide(notes: readonly number[]) {
      if (role === 'bass') (view as ReturnType<typeof renderFretboard>).guide(notes.map(bassPosition).filter((p) => p !== undefined));
      else (view as ReturnType<typeof renderKeys>).guide(notes);
    },
  };
}

/** Who you play: a switch between the band's members, with their levels. */
function roleSwitch(game: Game, onChange: () => void): HTMLElement {
  return h('div.vr-tabs', { role: 'tablist', 'aria-label': 'Who you play' }, ...ROLES.map((r) => {
    const t = h(`button.vr-tab${r === game.role ? '.on' : ''}` as 'button', { type: 'button', role: 'tab', 'aria-selected': r === game.role ? 'true' : 'false' },
      h('span', null, ROLE_NAMES[r]), h('span.lv', null, `LV ${level(game.progress.xp[r])}`));
    t.addEventListener('click', () => { game.role = r; onChange(); });
    return t;
  }));
}

const stat = (k: string, v: string) => h('div.vr-stat', null, h('span.k', null, k), h('span.v', null, v));

// ---------------------------------------------------------------- Tour

/** The game's home: the road of venues, the Cellar Bar's setlist with each song's rehearsal, and the gig. */
export function tourScreen(game: Game): Screen {
  const p = game.progress;
  const role = game.role;
  const cellar = venueById('cellar');
  const book = canBook(p, role, cellar);

  const road = h('div.vr-road', null, ...VENUES.map((v) => {
    const open = canBook(p, role, v);
    const here = v.id === 'cellar';
    const best = p.gigBest[v.id];
    return h(`div.vr-venue${here ? '.here' : ''}${!v.setlist.length ? '.locked' : ''}` as 'div', null,
      h('span.vr-mono', null, here ? (best !== undefined ? `PLAYED · BEST ${Math.round(best * 100)}%` : 'FIRST GIG') : 'LOCKED'),
      h('span.name', null, v.name),
      h('span.vr-mono', null, `cap. ${v.capacity.toLocaleString('en-GB')}`),
      h('span.need', null, here ? `${v.setlist.length} songs · £${v.fee}` : `${v.needs.fans.toLocaleString('en-GB')} fans · level ${v.needs.level}`),
      !here && !open.ok && v.setlist.length === 0 ? h('span.vr-mono', null, 'later versions') : null);
  }));

  const setlist = h('div.vr-setlist', null, ...cellar.setlist.map((id, i) => {
    const s = songById(id);
    const best = p.rehearsed[`${role}:${id}`];
    const ready = (best ?? 0) >= REHEARSED_MARK;
    return h('div.vr-song', null,
      h('span.n', null, String(i + 1)),
      h('span.t', null, h('b', null, s.title), h('span', null, `${s.bpm} BPM · ${s.chords.slice(0, 4).map((c) => c.name).join(' ')}`)),
      h(`span.state${ready ? '.ready' : ''}` as 'span', null, best === undefined ? 'not rehearsed' : `${ready ? 'ready' : 'run it again'} · ${Math.round(best * 100)}%`),
      button('Rehearse', () => game.go({ rehearse: id })));
  }));

  const gig = button('Play the gig', () => game.go({ gig: 'cellar' }), 'primary');
  gig.disabled = !book.ok;

  return {
    el: h('div.vr-screen', null,
      h('div.vr-top', null,
        h('div', { style: 'display: flex; flex-direction: column; gap: 6px' },
          h('span.vr-kicker', null, `${p.band || 'Your band'} · on tour`),
          h('h1.vr-title', null, 'Road to the stadium'),
        ),
        h('div.vr-stats', null, stat('FANS', p.fans.toLocaleString('en-GB')), stat('CASH', `£${p.cash.toLocaleString('en-GB')}`), stat('GIGS', String(p.gigs))),
      ),
      road,
      h('div.vr-gigpanel', null,
        h('div', { style: 'display: flex; flex-direction: column; gap: 14px; min-width: 0; flex: 1 1 520px' },
          h('span.vr-kicker.hot', null, `Next gig · ${cellar.name}`),
          h('span.vr-label', null, 'You play'),
          roleSwitch(game, () => game.go('tour')),
          h('span.vr-label', null, `Setlist · rehearse each song at full tempo (${Math.round(REHEARSED_MARK * 100)}%+) to book the gig`),
          setlist),
        h('div', { style: 'display: flex; flex-direction: column; gap: 12px; flex: 0 1 320px' },
          gig,
          h('span.vr-mono', null, book.ok ? 'The band is ready. The engine plays the other members at their own level.' : book.why!),
          button('Skills and lessons', () => game.go('tree')))),
      h('div.vr-row', { style: 'max-width: 640px; margin-top: auto' },
        button('Redo knob setup', () => game.go('knobs')),
        button('Rename the band', () => game.go('band'))),
    ),
  };
}

// ---------------------------------------------------------------- Rehearsal

/** Rehearsing a song: listen to the band play it, learn it section by section, then run it with the band. */
export function rehearseScreen(game: Game, songId: string): Screen {
  const song = songById(songId);
  const role = game.role;
  const cues = cuesOf(song.parts[role]);
  setUpBand(game, role);
  let stopRun: (() => void) | undefined;
  const timers: number[] = [];
  const later = (ms: number, fn: () => void) => { timers.push(window.setTimeout(fn, ms)); };
  const stopAll = () => { stopRun?.(); stopRun = undefined; for (const t of timers) clearTimeout(t); timers.length = 0; };

  const view = heldView(role);
  const body = h('div', { style: 'display: flex; flex-direction: column; gap: 16px' });
  const tabs = h('div.vr-tabs');
  const modes = [['listen', '1 · Listen'], ['learn', '2 · Learn it'], ['run', '3 · Run it']] as const;
  let mode: (typeof modes)[number][0] = 'listen';
  function renderTabs(): void {
    tabs.replaceChildren(...modes.map(([m, label]) => {
      const t = h(`button.vr-tab${m === mode ? '.on' : ''}` as 'button', { type: 'button', 'aria-pressed': m === mode ? 'true' : 'false' }, label);
      t.addEventListener('click', () => show(m));
      return t;
    }));
  }
  function show(m: typeof mode): void {
    stopAll();
    mode = m;
    renderTabs();
    view.guide([]);
    game.listen((e) => view.midi(e));
    if (m === 'listen') listen();
    else if (m === 'learn') learn();
    else run();
  }

  /** Plays a step's notes on the player's instrument. */
  function demo(step: Step): void {
    if (role === 'bass') { const n = step.notes[0]!; game.bass.keyDown(n, 95); later(700, () => game.bass.keyUp(n)); }
    else { for (const n of step.notes) game.poly.keyDown(n); later(1100, () => { for (const n of step.notes) game.poly.keyUp(n); }); }
  }
  const label = (step: Step) => (role === 'synth' ? chordAt(song, step.t)?.name ?? '' : noteName(step.notes[0]!));
  const detail = (step: Step) => {
    if (role === 'synth') { const c = chordAt(song, step.t)!; return spellTriad({ kind: 'chord', root: c.root, quality: c.quality }).join(' '); }
    const at = bassPosition(step.notes[0]!);
    return `${at ? describePosition(at) : ''} · on your keyboard ${noteName(step.notes[0]! + 12)}`;
  };

  function listen(): void {
    const chart = renderChart(song, role, cues);
    const status = h('span.vr-feedback', { role: 'status' }, 'The whole band, your part included. Follow your part on the chart.');
    const go = button('▶ Play the song', () => {
      stopAll();
      game.listen((e) => view.midi(e));
      const r = playSong(game, song, {});
      if (!r) return;
      stopRun = r.stop;
      let frame = 0;
      const tick = () => {
        const beat = r.beatNow();
        chart.scroll(beat);
        if (beat > r.endBeat + 1) { r.stop(); status.textContent = 'That is how it goes. Now learn your part: step 2.'; return; }
        frame = requestAnimationFrame(tick);
      };
      frame = requestAnimationFrame(tick);
      stopRun = () => { cancelAnimationFrame(frame); r.stop(); };
    }, 'primary');
    chart.scroll(0);
    body.replaceChildren(h('div.vr-row', null, go), status, chart.el, view.el);
  }

  function learn(): void {
    // each kind of section once: the verse, the chorus, the end
    const seen = new Set<string>();
    const sections = song.sections.filter((s) => {
      const kind = s.name.replace(/ \d+$/, '');
      if (kind === 'Intro' || seen.has(kind)) return false;
      seen.add(kind);
      return true;
    });
    let si = 0;
    let session = new StepSession(stepsOf(cues, sections[0]!.from, sections[0]!.to));
    const kicker = h('span.vr-kicker.hot');
    const big = h('span.vr-prompt');
    const sub = h('span.vr-spelled');
    const feedback = h('span.vr-feedback', { role: 'status' });
    const chips = h('div.vr-chips');
    const again = button('▶ Hear it', () => { if (session.step) demo(session.step); });
    const sectionChips = h('div.vr-chips');

    function renderStep(): void {
      const step = session.step;
      sectionChips.replaceChildren(...sections.map((s, i) => h(`span.vr-chip${i < si ? '.learned' : i === si ? '.now' : '.learn'}` as 'span', null, s.name.replace(/ \d+$/, ''))));
      chips.replaceChildren(...session.steps.map((s, i) => h(`span.vr-chip${i < session.index ? '.right' : i === session.index ? '.now' : '.learn'}` as 'span', null, `${label(s)}${s.count > 1 ? ` ×${s.count}` : ''}`)));
      if (!step) return;
      kicker.textContent = `${sections[si]!.name.replace(/ \d+$/, '')} · step ${session.index + 1} of ${session.steps.length} · copy it`;
      big.textContent = `${label(step)}${step.count > 1 ? ` ×${step.count}` : ''}`;
      sub.textContent = detail(step);
      view.guide(role === 'bass' ? [step.notes[0]!] : step.notes);
      later(350, () => demo(step));
    }
    game.listen((e) => {
      view.midi(e);
      if (e.type === 'noteOn') {
        const j = session.keyDown(e.note);
        if (j === 'wrong') { feedback.textContent = 'Not that one: copy what is lit.'; feedback.className = 'vr-feedback wrong'; }
        if (j === 'right') { feedback.textContent = 'Right.'; feedback.className = 'vr-feedback right'; }
        return;
      }
      // the next step comes when every key is up
      if (e.type !== 'noteOff' || !session.keyUp(e.note)) return;
      feedback.className = 'vr-feedback right';
      if (!session.done) { feedback.textContent = 'Right.'; renderStep(); return; }
      si++;
      if (si < sections.length) {
        feedback.textContent = `${sections[si - 1]!.name.replace(/ \d+$/, '')} learned. Next: ${sections[si]!.name.replace(/ \d+$/, '')}.`;
        session = new StepSession(stepsOf(cues, sections[si]!.from, sections[si]!.to));
        renderStep();
      } else {
        view.guide([]);
        kicker.textContent = 'Learned';
        big.textContent = 'You know it';
        sub.textContent = 'Now run it with the band: slow first, then at full tempo.';
        feedback.textContent = '';
        again.hidden = true;
        sectionChips.replaceChildren(...sections.map((s) => h('span.vr-chip.learned', null, s.name.replace(/ \d+$/, ''))));
        chips.replaceChildren();
        body.append(button('Run it with the band', () => show('run'), 'primary'));
      }
    });
    renderStep();
    body.replaceChildren(sectionChips, h('div.vr-card.hot.vr-prompt-card', null, kicker, big, sub, feedback, again), chips, view.el);
  }

  function run(): void {
    const out = h('div.vr-card', { hidden: true });
    const feedback = h('span.vr-feedback', { role: 'status' }, 'Play your part with the band. Slow first if it is new.');
    const slot = h('div');
    const start = (tempo: number) => {
      stopAll();
      out.hidden = true;
      const along = playAlong(game, song, role, { tempo, seed: 3 }, {
        onMidi: (e) => view.midi(e),
        onResult: (_, r) => {
          feedback.textContent = `${GRADE_TEXT[r.grade]}${r.offsetMs !== undefined && r.grade !== 'wrong' ? ` · ${Math.abs(Math.round(r.offsetMs))} ms ${r.offsetMs < 0 ? 'early' : 'late'}` : ''}`;
          feedback.className = `vr-feedback ${r.grade === 'good' || r.grade === 'close' ? 'right' : 'wrong'}`;
        },
        onEnd: (judge) => {
          stopRun = undefined;
          const score = judge.score;
          let note = `${Math.round(score * 100)}% at ${tempo === 1 ? 'full tempo' : `${Math.round(tempo * 100)}% tempo`}.`;
          if (tempo === 1) {
            game.progress = recordRehearsal(game.progress, role, song.id, score);
            game.save();
            note += score >= REHEARSED_MARK ? ' Ready for the gig.' : ` Get ${Math.round(REHEARSED_MARK * 100)}% at full tempo to be ready for the gig.`;
          } else note += ' Try it at full tempo next.';
          const c = judge.counts();
          out.replaceChildren(h('span.vr-kicker.hot', null, 'Run over'), h('span', { style: 'font-size: 18px' }, note),
            h('span.vr-mono', null, `${c.good} good · ${c.close} close · ${c.off} off · ${c.wrong} wrong · ${c.missed} missed`),
            h('div.vr-row', null, button('Back to the tour', () => game.go('tour'), tempo === 1 && score >= REHEARSED_MARK ? 'primary' : ''), button('Run it again', () => start(tempo))));
          out.hidden = false;
        },
      });
      if (!along) return;
      stopRun = along.stop;
      slot.replaceChildren(along.chart);
    };
    const preview = renderChart(song, role, cues);
    preview.scroll(0);
    slot.replaceChildren(preview.el);
    body.replaceChildren(h('div.vr-row', null, button(`Slow · ${Math.round(SLOW * 100)}%`, () => start(SLOW)), button('Full tempo', () => start(1), 'primary')),
      feedback, slot, out, view.el);
  }

  show('listen');
  const best = game.progress.rehearsed[`${role}:${song.id}`];
  return {
    el: h('div.vr-screen', null,
      h('div.vr-top', null,
        h('div', { style: 'display: flex; flex-direction: column; gap: 6px' },
          h('span.vr-kicker.hot', null, `Rehearsal room · ${ROLE_NAMES[role]} · ${song.bpm} BPM${best !== undefined ? ` · best run ${Math.round(best * 100)}%` : ''}`),
          h('h1.vr-title', null, song.title),
        ),
        button('← Tour', () => game.go('tour')),
      ),
      tabs, body,
      h('p.vr-mono', null, role === 'bass' ? 'Your keys play the bass, an octave below the keys; the mod wheel rests your palm on the strings.' : 'Your keys play the band\'s poly synth: hold each chord\'s three notes.'),
    ),
    dispose: stopAll,
  };
}

// ---------------------------------------------------------------- Gig

/** The gig: the set, song by song, with the crowd, then the review. */
export function gigScreen(game: Game, venueId: string): Screen {
  const venue = venueById(venueId);
  const role = game.role;
  const songs: GameSong[] = venue.setlist.map(songById);
  const scores: number[] = [];
  const judges: PartJudge[] = [];
  let crowd = 0.4;
  let stopRun: (() => void) | undefined;
  const timers: number[] = [];
  const view = heldView(role);

  const songLine = h('span.vr-mono');
  const title = h('span.vr-gig-title', null, venue.name);
  const meter = h('div.vr-crowd', null, ...Array.from({ length: 40 }, () => h('span')));
  const crowdText = h('span.vr-mono', null, 'the room is waiting');
  const streak = h('span.vr-streak', null, '');
  const feedback = h('span.vr-feedback', { role: 'status' });
  const slot = h('div.vr-gig-stage');
  const result = h('div', { hidden: true });

  const showCrowd = (c: number) => {
    [...meter.children].forEach((s, i) => s.classList.toggle('on', i < Math.round(c * 40)));
    crowdText.textContent = c > 0.8 ? 'singing along' : c > 0.6 ? 'dancing' : c > 0.4 ? 'nodding along' : c > 0.25 ? 'chatting at the bar' : 'drifting to the door';
  };
  showCrowd(crowd);

  function playSongAt(i: number): void {
    const song = songs[i]!;
    songLine.textContent = `SONG ${i + 1} OF ${songs.length} · ${song.title.toUpperCase()} · ${song.bpm} BPM`;
    feedback.textContent = 'The drums count you in…';
    feedback.className = 'vr-feedback';
    const along = playAlong(game, song, role, { crowdStart: crowd, seed: 100 + i }, {
      onMidi: (e) => view.midi(e),
      onResult: (_, r, judge) => {
        feedback.textContent = GRADE_TEXT[r.grade];
        feedback.className = `vr-feedback ${r.grade === 'good' || r.grade === 'close' ? 'right' : 'wrong'}`;
        streak.textContent = judge.streak >= 4 ? `×${judge.streak}` : '';
        showCrowd(judge.crowd);
      },
      onEnd: (judge) => {
        stopRun = undefined;
        crowd = judge.crowd;
        scores.push(judge.score);
        judges.push(judge);
        if (i + 1 < songs.length) {
          feedback.textContent = `“Thank you! This one's called ${songs[i + 1]!.title}.”`;
          feedback.className = 'vr-feedback right';
          timers.push(window.setTimeout(() => playSongAt(i + 1), BETWEEN_SONGS_MS));
        } else review();
      },
    });
    if (!along) return;
    stopRun = along.stop;
    slot.replaceChildren(along.chart);
  }

  function review(): void {
    const avgCrowd = judges.reduce((s, j) => s + j.crowdAverage, 0) / judges.length;
    const outcome = gigOutcome(venue, scores, avgCrowd);
    const before = game.progress;
    game.progress = recordGig(before, role, venue, outcome);
    game.save();
    const all = judges.map((j) => j.counts());
    const sum = (k: CueGrade) => all.reduce((s, c) => s + c[k], 0);
    const cuesTotal = judges.reduce((s, j) => s + j.cues.length, 0);
    const offs = judges.map((j) => j.meanOffsetMs());
    const weakest = songs[scores.indexOf(Math.min(...scores))]!.id;
    const advice = adviceFor(role, { cues: cuesTotal, good: sum('good'), close: sum('close'), off: sum('off'), wrong: sum('wrong'), missed: sum('missed'), meanOffsetMs: offs.reduce((a, b) => a + b, 0) / offs.length }, weakest);
    const levelUp = level(game.progress.xp[role]) > level(before.xp[role]);
    const quote = outcome.stars >= 4 ? '“Tight, bright and loud. Book them again.”' : outcome.stars === 3 ? '“A promising set with a few wobbles.”' : '“Nervous, but there is something there.”';

    result.replaceChildren(h('div.vr-review', null,
      h('div.vr-zine', null,
        h('div.vr-zine-head', null, h('span', null, 'Cellar Notes'), h('span.vr-mono', null, 'LIVE REVIEW')),
        h('span.vr-zine-stars', { 'aria-label': `${outcome.stars} out of 5` }, `${outcome.stars}/5`),
        h('span.vr-zine-band', null, `${game.progress.band || 'Your band'} · ${venue.name}`),
        h('span.vr-zine-quote', null, quote),
        h('div.vr-zine-songs', null, ...songs.map((s, i) => h('div', null, h('span', null, s.title), h('span', null, `${Math.round(scores[i]! * 100)}%`))))),
      h('div', { style: 'display: flex; flex-direction: column; gap: 16px; flex: 1 1 360px; min-width: 0' },
        h('div.vr-stats', null, stat('FANS', `+${outcome.fans}`), stat('CASH', `+£${outcome.cash}`), stat('XP', `+${outcome.xp}`)),
        h('span.vr-mono', null, `${sum('good')} good · ${sum('close')} close · ${sum('off')} off · ${sum('wrong')} wrong · ${sum('missed')} missed${levelUp ? ` · ${ROLE_NAMES[role]} level ${level(game.progress.xp[role])}` : ''}`),
        h('span.vr-label', null, 'Practise next'),
        ...advice.map((a) => {
          const go = a.lesson ? button(`${a.lesson.id} · ${a.lesson.title}`, () => game.go(a.lesson!.kind === 'groove' ? { groove: a.lesson!.id } : { drill: a.lesson!.id }))
            : a.song ? button(`Rehearse ${songById(a.song).title}`, () => game.go({ rehearse: a.song! })) : null;
          return h('div.vr-card', null, h('span', { style: 'font-size: 15px; line-height: 1.5' }, a.text), go);
        }),
        button('Back to the tour', () => game.go('tour'), 'primary'))));
    result.hidden = false;
    stage.hidden = true;
  }

  const walkOn = button('Walk on stage', () => { walkOn.hidden = true; playSongAt(0); }, 'primary');
  const stage = h('div', { style: 'display: flex; flex-direction: column; gap: 16px' },
    h('div.vr-gig-top', null,
      h('span.vr-live', null, 'LIVE'),
      h('div', { style: 'display: flex; flex-direction: column' }, title, songLine),
      h('div', { style: 'flex: 1 1 280px; display: flex; flex-direction: column; gap: 6px' }, h('div', { style: 'display: flex; justify-content: space-between' }, h('span.vr-mono', null, 'CROWD'), crowdText), meter),
      streak),
    walkOn, feedback, slot, view.el,
    h('p.vr-mono', null, `You play ${ROLE_NAMES[role].toLowerCase()}; the engine plays the rest of the band at their own level.`));
  setUpBand(game, role);
  songLine.textContent = `${songs.length} SONGS · ${songs.map((s) => s.title).join(' · ').toUpperCase()}`;

  return {
    el: h('div.vr-screen', null, stage, result),
    dispose() {
      stopRun?.();
      for (const t of timers) clearTimeout(t);
    },
  };
}
