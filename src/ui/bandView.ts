import { epochNow } from '../midi/bus';
import type { Band } from '../songs/band';
import type { PageId } from '../songs/control';
import { automationValue, type SongPlayer } from '../songs/player';
import { barAt, barStartAt, songBeats, type Song } from '../songs/types';
import { BandStage, type Player } from './bandStage';
import { CLOSE_PANEL } from './embed';
import { el } from './widgets';

/** The players, as they stand on stage, and what each card says about them. */
const CARDS: { page: Player; role: string; color: string; instrument: string; about: string; open: string }[] = [
  { page: 'guitar', role: 'Guitar', color: '#e8742c', instrument: 'MOA-GUITAR · bridge humbucker · overdrive', about: 'Calm, until it gets heavy: then he freaks out, digs in and pushes the strings out of tune.', open: 'Open MOA-GUITAR' },
  { page: 'kit', role: 'Drums', color: '#ffd25e', instrument: 'MOA-KIT · modelled drums, Gaute’s cymbals', about: 'Fairly chilled. Nods on the one.', open: 'Open MOA-KIT' },
  { page: 'bass', role: 'Bass 1 · dub', color: '#4a9be0', instrument: 'MOA-BASS · flatwounds · 8×10 off-axis', about: 'Chilled. Bobs about a bit, holds the bottom.', open: 'Open MOA-BASS' },
  { page: 'bass2', role: 'Bass 2 · free', color: '#d9628a', instrument: 'MOA-BASS · roundwounds · pick · overdrive', about: 'A nutter. Leads in D, and moves like it.', open: 'Open MOA-BASS 2' },
];

/** A pedal on a card: lit while the song has it on (read from the song's automation at the beat). */
interface Chip {
  page: Player;
  label: string;
  on: (song: Song, beat: number, heat: number) => boolean;
}
const CHIPS: Chip[] = [
  { page: 'guitar', label: 'Drive', on: () => true },
  { page: 'guitar', label: 'Delay', on: (s, b) => automated(s, 'mixer', 'ch3.aux2', b, 0) >= 0.2 },
  { page: 'guitar', label: 'Freaking out', on: (_s, _b, heat) => heat >= 0.8 },
  { page: 'kit', label: 'Snare wires', on: () => true },
  { page: 'kit', label: 'Cymbal tails', on: () => true },
  { page: 'bass', label: 'Flatwounds', on: () => true },
  { page: 'bass2', label: 'Drive', on: (s, b) => automated(s, 'bass2', 'drive.mix', b, 0) > 0.5 },
  { page: 'bass2', label: 'Leading', on: (s, b) => sectionAt(s, b)?.name === 'D' },
];

function automated(song: Song, page: PageId, control: string, beat: number, otherwise: number): number {
  const a = song.automation.find((x) => x.page === page && x.control === control);
  return a ? automationValue(a, beat) : otherwise;
}

const sectionAt = (song: Song, beat: number) => song.sections?.find((s) => beat >= s.from && beat < s.to);

/**
 * The band page: the band on stage playing one song through the real instruments (loaded in hidden frames, as on the
 * records page), a transport with where they are in it, a card per player, and a rack that shows any of their
 * instruments while it plays.
 */
export function renderBandPage(root: HTMLElement, song: Song, band: Band, player: SongPlayer, holder: HTMLElement, stage: BandStage): void {
  root.className = 'band';
  const wrap = el('div', 'band-wrap');

  const header = el('header', 'band-head');
  header.append(el('h1', 'band-name', song.artist), el('p', 'band-tagline', 'Two basses, a guitar and a drum kit · all modelled · live in your browser'));

  // ---- the transport
  const transport = el('section', 'band-transport');
  transport.setAttribute('aria-label', 'Transport');
  const play = el('button', 'band-play');
  play.type = 'button';
  play.setAttribute('aria-label', 'Play');
  const icon = (playing: boolean) => playing
    ? '<svg width="24" height="24" viewBox="0 0 24 24" aria-hidden="true"><rect x="6" y="5" width="4" height="14" fill="#16171a"/><rect x="14" y="5" width="4" height="14" fill="#16171a"/></svg>'
    : '<svg width="26" height="26" viewBox="0 0 24 24" aria-hidden="true"><path d="M7 4 L20 12 L7 20 Z" fill="#16171a"/></svg>';
  play.innerHTML = icon(false);
  const title = el('div', 'band-title');
  const minutes = (songBeats(song) * 60) / song.bpm;
  title.append(el('div', 'band-song', song.title), el('div', 'band-meta', `original · math rock · ${Math.floor(minutes / 60)}:${String(Math.round(minutes % 60)).padStart(2, '0')}`));
  const readout = (label: string) => {
    const box = el('div', 'band-readout');
    const value = el('span', 'band-readout-value', '–');
    box.append(el('span', 'band-readout-label', label), value);
    return { box, value };
  };
  const meter = readout('Meter'), tempo = readout('Tempo'), barRead = readout('Bar');
  tempo.value.textContent = String(song.bpm);
  const readouts = el('div', 'band-readouts');
  readouts.append(meter.box, tempo.box, barRead.box);
  const timeline = el('div', 'band-timeline');
  const sections = (song.sections ?? []).map((s) => {
    const cell = el('div', 'band-section');
    cell.style.flexGrow = String(s.to - s.from);
    cell.append(el('span', 'band-section-name', s.name), el('span', 'band-section-meter', s.meter));
    timeline.append(cell);
    return cell;
  });
  const playhead = el('div', 'band-playhead');
  timeline.append(playhead);
  const caption = el('div', 'band-caption', 'Press play: the band wakes up in the back room (a few seconds), then plays.');
  caption.setAttribute('role', 'status');
  const timeBox = el('div', 'band-time');
  timeBox.append(timeline, caption);
  transport.append(play, title, readouts, timeBox);

  // ---- the stage
  const stageBox = el('section', 'band-stage');
  stageBox.setAttribute('aria-label', 'The stage');
  stageBox.append(stage.element);

  // ---- the players
  const cards = el('section', 'band-cards');
  cards.setAttribute('aria-label', 'The players');
  const meters = new Map<Player, HTMLElement>();
  const chipEls: { chip: Chip; el: HTMLElement }[] = [];
  const openButtons = new Map<Player, HTMLButtonElement>();
  for (const c of CARDS) {
    const card = el('article', 'band-card');
    const head = el('div', 'band-card-head');
    const bar = el('span', 'band-card-bar');
    bar.style.background = c.color;
    head.append(bar, el('h2', 'band-card-role', c.role));
    const chips = el('div', 'band-chips');
    for (const chip of CHIPS.filter((x) => x.page === c.page)) {
      const e = el('span', 'band-chip');
      e.append(el('i', 'band-led'), document.createTextNode(chip.label));
      chips.append(e);
      chipEls.push({ chip, el: e });
    }
    const level = el('div', 'band-level');
    const fill = el('div', 'band-level-fill');
    level.append(fill);
    level.setAttribute('aria-hidden', 'true');
    meters.set(c.page, fill);
    const open = el('button', 'band-open', c.open);
    open.type = 'button';
    open.addEventListener('click', () => toggleRack(c.page));
    openButtons.set(c.page, open);
    card.append(head, el('p', 'band-card-text', c.instrument), el('p', 'band-card-about', c.about), chips, level, open);
    cards.append(card);
  }

  // ---- the rack: an instrument's own page, shown while it plays
  const rack = el('section', 'band-rack');
  rack.setAttribute('aria-label', 'Instrument');
  const rackHead = el('div', 'band-rack-head');
  const rackTitle = el('span', 'band-rack-title');
  const rackClose = el('button', 'band-open', 'Close');
  rackClose.type = 'button';
  rackHead.append(rackTitle, rackClose);
  rack.append(rackHead, holder);
  let open: PageId | undefined;
  function toggleRack(page: PageId): void {
    if (open === page) return closeRack();
    if (open) player.resumeAutomation(open);
    open = page;
    band.focus(page);
    player.pauseAutomation(page); // its automation waits while you turn its knobs
    rack.classList.add('open');
    rackTitle.textContent = `${CARDS.find((c) => c.page === page)?.open.replace('Open ', '') ?? page}: tweak it while it plays`;
    for (const [p, b] of openButtons) b.setAttribute('aria-pressed', String(p === page));
    rack.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
  }
  function closeRack(): void {
    if (open) player.resumeAutomation(open);
    open = undefined;
    band.focus(undefined);
    rack.classList.remove('open');
    for (const b of openButtons.values()) b.setAttribute('aria-pressed', 'false');
  }
  rackClose.addEventListener('click', closeRack);
  document.addEventListener('keydown', (e) => { if (e.key === 'Escape' && open) closeRack(); });
  window.addEventListener('message', (e) => { if (e.origin === location.origin && e.data?.type === CLOSE_PANEL && open) closeRack(); });

  const note = el('p', 'band-note', 'Needs desktop Chrome or similar: the mixer, two basses, a guitar, the kit and their effects run in one tab.');
  wrap.append(header, transport, stageBox, cards, rack, note);
  root.append(wrap);

  // ---- playing
  let tick: { beat: number; at: number } | undefined;
  let busy = false;
  const beatMs = 60000 / song.bpm;
  player.loop = true;
  player.onTick = (beat) => { tick = { beat, at: epochNow() }; };
  player.onEnd = () => stop();

  async function start(): Promise<void> {
    busy = true;
    play.disabled = true;
    caption.textContent = 'Waking the band up…';
    try {
      band.setEffects(song.band);
      await band.start();
      player.setup(song);
      // a moment to settle before the first note: the pages have just woken (their engines compiling, the kit decoding
      // its cymbals, the mixer's links filling their buffers), and notes sent into that stutter
      caption.textContent = 'Tuning up…';
      await new Promise((r) => setTimeout(r, 3000));
      player.play(song);
      play.innerHTML = icon(true);
      play.setAttribute('aria-label', 'Stop');
    } catch (e) {
      caption.textContent = `The band did not wake up: ${(e as Error).message}`;
    } finally {
      busy = false;
      play.disabled = false;
    }
  }
  function stop(): void {
    player.stop();
    stage.clear();
    tick = undefined;
    play.innerHTML = icon(false);
    play.setAttribute('aria-label', 'Play');
    caption.textContent = 'Stopped.';
  }
  play.addEventListener('click', () => {
    if (busy) return;
    if (player.state === 'playing') stop();
    else void start();
  });
  window.addEventListener('pagehide', () => player.stop());

  // ---- every frame: the stage, the transport, the cards
  const loopBeats = songBeats(song);
  let shownSection = -1;
  const frame = () => {
    const now = epochNow();
    const playing = player.state === 'playing' && tick !== undefined;
    const raw = playing ? tick!.beat + (now - tick!.at) / beatMs : now / 1000; // idle: a slow pulse to breathe to
    const beat = playing ? (raw < 0 ? raw : raw % loopBeats) : raw;
    const s = playing && beat >= 0 ? sectionAt(song, beat) : undefined;
    const heat = s?.heat ?? 0;
    stage.update(now, { beat, playing, heat, lead: s?.name === 'D', barStart: playing && beat >= 0 ? barStartAt(song, beat) : Math.floor(beat) });
    if (playing && beat >= 0) {
      const k = (song.sections ?? []).indexOf(s!);
      if (k !== shownSection) {
        shownSection = k;
        sections.forEach((cell, i) => cell.classList.toggle('now', i === k));
        meter.value.textContent = s?.meter ?? '–';
        caption.textContent = s ? `${s.name}: ${CAPTIONS[s.name] ?? ''}` : '';
      }
      barRead.value.textContent = String(barAt(song, beat));
      playhead.style.left = `${(beat / loopBeats) * 100}%`;
      for (const { chip, el: e } of chipEls) e.classList.toggle('on', chip.on(song, beat, heat));
    } else if (shownSection !== -1 || !playing) {
      shownSection = -1;
      sections.forEach((cell) => cell.classList.remove('now'));
      playhead.style.left = '0%';
      for (const { el: e } of chipEls) e.classList.remove('on');
    }
    for (const [who, fill] of meters) fill.style.width = `${Math.round(stage.activity[who] * 100)}%`;
    requestAnimationFrame(frame);
  };
  requestAnimationFrame(frame);
}

/** What happens in each section, for the caption under the timeline. */
const CAPTIONS: Record<string, string> = {
  Intro: 'the guitar’s figure alone, then the hats and the dub bass',
  A: '7/8, grouped 2+2+3: the riff over a ringing E, the free bass answering a beat late',
  B: '5/4, grouped 3+3+2+2: fourths into the delay, the free bass climbing, the backbeat moved',
  'A′': 'the first riff back, its echo pushed, the free bass doubling the guitar',
  C: '4/4: crunch, an angular line, the basses in unison, the kit coming apart. The guitarist freaks out',
  D: 'straight rock: power chords, pumping roots, the free bass leading through his drive',
  'B′': 'the 5/4 riff doubled by both basses',
  End: 'the last chord, left to ring',
};
