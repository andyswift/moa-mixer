import type { Band } from '../songs/band';
import type { PageId } from '../songs/control';
import type { SongPlayer } from '../songs/player';
import type { Song } from '../songs/types';
import { CLOSE_PANEL } from './embed';
import { labelColor, sleeveSvg } from './sleeveArt';
import { el } from './widgets';

const CHIP_NAMES: Record<PageId, string> = {
  mixer: 'MIXER', synth: 'MOA-1', poly: 'MOA-6', drums: 'MOA-DR', lynch: 'LYNCH', duo: 'DUO', df2: 'DF2', pipe: 'PIPE',
  reverb: 'REVERB', delay: 'DELAY', ouroboros: 'OURO', buscomp: 'COMP', granular: 'GRAIN', m2600: '2600', bass: 'BASS', mpc: 'MOA-60',
};

type View = 'crate' | 'deck';

const LOOP_KEY = 'moa.records.loop';
function readLoop(): boolean {
  try {
    return localStorage.getItem(LOOP_KEY) !== '0';
  } catch {
    return true;
  }
}
function saveLoop(on: boolean): void {
  try {
    localStorage.setItem(LOOP_KEY, on ? '1' : '0');
  } catch {
    // not remembered
  }
}

/** The record collection: a crate of sleeves, and a turntable that plays the picked one on the band. */
export function renderRecords(root: HTMLElement, songs: Song[], band: Band, player: SongPlayer, holder: HTMLElement): void {
  let selected = 0;
  let view: View = 'crate';
  let busy = false;

  root.className = 'records';
  const head = el('header', 'rec-head');
  head.innerHTML = `<div class="rec-brand"><svg width="56" height="56" viewBox="0 0 64 64" aria-hidden="true"><path d="M32 4C48 3 61 15 60 32C59 49 47 61 31 60C15 59 4 47 4 31C4 15 16 5 32 4Z" fill="#14101a" stroke="#fff4df" stroke-width="2.5" stroke-linejoin="round"/><path d="M32 14C42 13 50 21 50 31C50 42 42 50 32 50C22 50 14 42 14 32C14 22 22 14 32 14Z" fill="none" stroke="#fff4df" stroke-opacity=".28" stroke-width="2"/><circle cx="32" cy="32" r="10" fill="#ff6f59"/><circle cx="32" cy="32" r="2.6" fill="#14101a"/></svg><span class="rec-wordmark">moa <b>records</b></span></div>
    <nav class="rec-links"><span>Side A · ${songs.length} record${songs.length === 1 ? '' : 's'}</span><a href="/">moaswift.no</a></nav>`;

  const tagline = el('p', 'rec-tagline', 'Pick a record. The synths wake up in the back room, and the needle drops.');
  const status = el('div', 'rec-status');
  status.setAttribute('role', 'status');
  status.setAttribute('aria-live', 'polite');

  // ---- the crate ----
  const crate = el('section', 'rec-crate');
  crate.setAttribute('aria-label', 'Record crate');
  const sleeves = el('div', 'rec-sleeves');
  const sleeveButtons = songs.map((song, i) => {
    const b = el('button', 'rec-sleeve');
    b.type = 'button';
    b.style.setProperty('--tilt', `${[-5, 3, -2, 4, -3][i % 5]}deg`);
    b.setAttribute('aria-label', `${song.title}, ${song.bpm} BPM, ${song.key}`);
    b.innerHTML = sleeveSvg(song);
    b.addEventListener('click', () => { selected = i; paint(); });
    b.addEventListener('dblclick', () => void drop());
    sleeves.append(b);
    return b;
  });
  const blank = el('div', 'rec-sleeve rec-sleeve-blank', 'More records soon');
  sleeves.append(blank);
  const dropButton = el('button', 'rec-button rec-button-go', 'Drop the needle');
  dropButton.type = 'button';
  dropButton.addEventListener('click', () => void drop());
  const go = el('div', 'rec-go'); // sits on the crate front, with an arrow that points at the button
  const arrow = el('span', 'rec-arrow');
  arrow.setAttribute('aria-hidden', 'true');
  arrow.innerHTML = '<svg viewBox="0 0 120 70" width="120" height="70"><path d="M6 33C20 28 40 38 62 31L60 12C70 14 96 28 114 36C98 46 76 58 62 62L63 45C42 50 22 42 6 33Z" fill="#e53935" stroke="#fff4df" stroke-width="4" stroke-linejoin="round"/></svg>';
  go.append(arrow, dropButton);
  const front = el('div', 'rec-crate-front');
  front.append(el('div', 'rec-crate-label', 'MOA RECORDS · SIDE A'), go);
  crate.append(sleeves, front);

  const pick = el('div', 'rec-pick');
  const pickInfo = el('div', 'rec-pick-info');
  const pickTitle = el('div', 'rec-pick-title');
  const pickMeta = el('div', 'rec-meta');
  pickInfo.append(pickTitle, pickMeta);
  const pickChips = el('div', 'rec-chips');
  pick.append(pickInfo, pickChips);


  // ---- the turntable ----
  const deck = el('section', 'rec-deck');
  deck.setAttribute('aria-label', 'Turntable');
  deck.hidden = true;
  const deckSleeve = el('div', 'rec-deck-sleeve');
  const deckTitle = el('div', 'rec-deck-title');
  const deckMeta = el('div', 'rec-meta');
  const deckLeft = el('div', 'rec-deck-left');
  deckLeft.append(deckSleeve, deckTitle, deckMeta);

  const table = el('div', 'rec-table');
  const platter = el('div', 'rec-platter');
  const vinyl = el('div', 'rec-vinyl');
  const vinylLabel = el('div', 'rec-vinyl-label');
  vinyl.append(vinylLabel);
  const arm = el('div', 'rec-arm');
  arm.innerHTML = `<svg viewBox="0 0 300 470" aria-hidden="true"><circle cx="220" cy="70" r="46" fill="#3b3445" stroke="#14101a" stroke-width="3"/><circle cx="220" cy="70" r="18" fill="#c9c2d4"/><path d="M220 70L96 372" stroke="#e3dcee" stroke-width="12" stroke-linecap="round"/><path d="M96 372L70 410" stroke="#e3dcee" stroke-width="12" stroke-linecap="round"/><rect x="44" y="396" width="42" height="26" rx="5" transform="rotate(30 65 409)" fill="#ff6f59"/><circle cx="236" cy="30" r="10" fill="#ffc23d"/></svg>`;
  const readout = el('div', 'rec-readout');
  const readLabel = el('div', 'rec-read-label', 'NOW PLAYING');
  const readBar = el('div', 'rec-read-bar');
  readout.append(readLabel, readBar);
  const groove = el('div', 'rec-groove');
  const grooveFill = el('div', 'rec-groove-fill');
  groove.append(grooveFill);
  table.append(platter, vinyl, arm, groove);

  const controls = el('div', 'rec-controls');
  const prev = el('button', 'rec-button', '« Prev');
  const toggle = el('button', 'rec-button rec-button-go', 'Lift needle');
  const next = el('button', 'rec-button', 'Next »');
  const back = el('button', 'rec-button rec-button-quiet', '← Back to the crate');
  const loopButton = el('button', 'rec-button rec-loop');
  for (const b of [prev, toggle, next, back, loopButton]) b.type = 'button';
  // Songs loop by default, so there is time to tweak; the choice is remembered.
  let loop = readLoop();
  player.loop = loop;
  const paintLoop = () => {
    loopButton.textContent = loop ? 'Loop: on' : 'Loop: off';
    loopButton.setAttribute('aria-pressed', String(loop));
  };
  loopButton.addEventListener('click', () => {
    loop = !loop;
    player.loop = loop;
    saveLoop(loop);
    paintLoop();
  });
  paintLoop();
  controls.append(prev, toggle, next, loopButton, readout);
  prev.addEventListener('click', () => void step(-1));
  next.addEventListener('click', () => void step(1));
  toggle.addEventListener('click', () => { if (player.state === 'playing') liftNeedle(); else void drop(); });
  back.addEventListener('click', () => { liftNeedle(); closePanel(); view = 'crate'; paint(); });

  const bandBox = el('div', 'rec-band');
  const bandTitle = el('div', 'rec-band-title');
  const bandChips = el('div', 'rec-chips');
  bandBox.append(bandTitle, bandChips);

  const deckRight = el('div', 'rec-deck-right');
  deckRight.append(table, controls, bandBox);
  deck.append(deckLeft, deckRight, el('div', 'rec-back-row'));
  deck.querySelector('.rec-back-row')!.append(back);

  // ---- the rack: one instrument's own page, opened for tweaking while the record plays ----
  const rack = el('section', 'rec-rack');
  rack.setAttribute('aria-label', 'Instrument panel');
  const rackHead = el('div', 'rec-rack-head');
  const rackTitle = el('div', 'rec-rack-title');
  const rackReset = el('button', 'rec-button rec-button-quiet', 'Reset to the song');
  const rackClose = el('button', 'rec-button rec-button-quiet', 'Close');
  rackReset.type = 'button';
  rackClose.type = 'button';
  rackHead.append(rackTitle, rackReset, rackClose);
  const rackBody = el('div', 'rec-rack-body');
  rackBody.append(holder); // the band's pages live here; they are only resized and shown, never moved, so the audio never stops
  rack.append(rackHead, rackBody);
  let open: PageId | undefined;

  root.append(head, tagline, pick, crate, deck, rack, status);

  // ---- behaviour ----
  const song = () => songs[selected]!;

  function chips(host: HTMLElement, live: boolean): void {
    host.replaceChildren(...song().band.concat(['mixer']).map((p) => {
      const chip = live ? el('button', 'rec-chip rec-chip-btn') : el('span', 'rec-chip');
      const led = el('i', 'rec-led');
      if (live) {
        led.classList.toggle('on', band.states.get(p) === 'started');
        const b = chip as HTMLButtonElement;
        b.type = 'button';
        b.setAttribute('aria-label', `${CHIP_NAMES[p]}: open it to tweak while the record plays`);
        b.setAttribute('aria-pressed', String(open === p));
        b.addEventListener('click', () => openPanel(p));
      }
      chip.append(led, document.createTextNode(CHIP_NAMES[p]));
      return chip;
    }));
  }

  function openPanel(page: PageId): void {
    if (open === page) {
      closePanel();
      return;
    }
    if (open) player.resumeAutomation(open);
    open = page;
    band.focus(page);
    player.pauseAutomation(page); // a sweep on this page waits while you turn its knobs
    rack.classList.add('open');
    rackTitle.textContent = `${CHIP_NAMES[page]}: tweak it while it plays`;
    chips(bandChips, true);
    rack.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
  }

  function closePanel(): void {
    if (open) player.resumeAutomation(open);
    open = undefined;
    band.focus(undefined);
    rack.classList.remove('open');
    chips(bandChips, true);
  }

  rackClose.addEventListener('click', closePanel);
  rackReset.addEventListener('click', () => {
    player.setup(song());
    status.textContent = `${song().title} is back to its own settings.`;
  });
  document.addEventListener('keydown', (e) => { if (e.key === 'Escape' && open) closePanel(); });
  window.addEventListener('message', (e) => { if (e.origin === location.origin && e.data?.type === CLOSE_PANEL && open) closePanel(); });

  function paint(): void {
    const s = song();
    crate.hidden = view !== 'crate';
    pick.hidden = view !== 'crate';
    tagline.hidden = view !== 'crate';
    deck.hidden = view !== 'deck';
    sleeveButtons.forEach((b, i) => b.classList.toggle('picked', i === selected));
    pickTitle.textContent = s.title;
    pickMeta.textContent = `${s.bpm} BPM · ${s.key.toUpperCase()} · ${s.bars} BARS · ${s.band.length + 1} IN THE BAND`;
    chips(pickChips, false);
    deckSleeve.innerHTML = sleeveSvg(s);
    deckTitle.textContent = s.title;
    deckMeta.textContent = `${s.artist.toUpperCase()} · ${s.bpm} BPM · ${s.key.toUpperCase()}`;
    vinylLabel.style.setProperty('--label', labelColor(s));
    vinylLabel.innerHTML = `<span>${s.title.toLowerCase()}</span><small>SIDE A · ${s.bpm}</small>`;
    bandTitle.textContent = `THE BAND · ${band.startedCount} OF ${band.pages.length} IN THE ROOM · CLICK ONE TO TWEAK IT`;
    chips(bandChips, true);
    const playing = player.state === 'playing';
    table.classList.toggle('playing', playing);
    toggle.textContent = playing ? 'Lift needle' : busy ? 'Warming up…' : 'Drop the needle';
    toggle.disabled = busy;
    dropButton.disabled = busy;
    prev.disabled = busy || songs.length < 2;
    next.disabled = busy || songs.length < 2;
  }

  function liftNeedle(): void {
    player.stop();
    busy = false;
    status.textContent = 'Needle up.';
    paint();
  }

  async function drop(): Promise<void> {
    if (busy) return;
    view = 'deck';
    busy = true;
    status.textContent = 'Waking the band…';
    readBar.textContent = '--';
    grooveFill.style.width = '0%';
    paint();
    try {
      band.setEffects(song().band); // the effects this record uses are loaded, the others let go
      await band.start();
      status.textContent = 'Setting up the room…';
      player.setup(song());
      await new Promise((r) => setTimeout(r, 1200)); // the settings land before the first note
      busy = false;
      status.textContent = `Playing ${song().title}.`;
      player.play(song());
    } catch (e) {
      busy = false;
      status.textContent = `The band did not all show up. ${(e as Error).message}`;
    }
    paint();
  }

  async function step(by: number): Promise<void> {
    if (songs.length < 2) return;
    selected = (selected + by + songs.length) % songs.length;
    closePanel();
    player.stop();
    await drop();
  }

  player.onTick = (beat) => {
    const s = song();
    const loopBeats = s.bars * s.beatsPerBar;
    const within = beat < 0 ? 0 : player.loop ? beat % loopBeats : beat; // the counter and the groove start over on each pass
    const bar = Math.min(s.bars, Math.max(1, Math.floor(within / s.beatsPerBar) + 1));
    readBar.innerHTML = `${String(bar).padStart(2, '0')}<small> / ${s.bars} bars</small>`;
    grooveFill.style.width = `${Math.max(0, Math.min(100, (within / loopBeats) * 100))}%`;
  };
  player.onEnd = () => {
    status.textContent = 'End of side A.';
    paint();
  };
  band.onChange(() => {
    bandTitle.textContent = `THE BAND · ${band.startedCount} OF ${band.pages.length} IN THE ROOM · CLICK ONE TO TWEAK IT`;
    chips(bandChips, true);
  });
  window.addEventListener('pagehide', () => player.stop());
  paint();
}
