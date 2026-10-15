import './ui/records.css';
import { Band } from './songs/band';
import { browserHost } from './songs/host';
import { library } from './songs/library';
import { SongPlayer } from './songs/player';
import { renderRecords } from './ui/recordsView';

// MOA Records: a record collection that plays songs on the instruments. The band (the mixer and seven instruments)
// runs in hidden iframes of this page and is conducted over broadcast channels; see src/songs.
const root = document.querySelector<HTMLDivElement>('#app')!;
const supported = typeof BroadcastChannel !== 'undefined' && typeof AudioWorkletNode !== 'undefined' && !/Mobi|Android|iPhone|iPad/.test(navigator.userAgent);

if (!supported) {
  root.className = 'records';
  root.innerHTML = '<div class="rec-sorry"><h1>moa records</h1><p>This record shop runs eight synthesizers in your browser at once, so it needs desktop Chrome or a similar browser. Try it on a computer.</p><p><a href="/">Back to moaswift.no</a></p></div>';
} else {
  const holder = document.createElement('div');
  holder.className = 'rec-frames';
  const band = new Band(holder);
  const player = new SongPlayer(browserHost());
  renderRecords(root, library(), band, player, holder); // puts the holder in the page, where the band's pages live
  band.mount(); // load the pages now, so they are ready when a record is picked
  if (import.meta.env.DEV) Object.assign(window, { __records: { band, player } });
}
