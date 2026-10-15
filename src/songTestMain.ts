import { Band } from './songs/band';
import { browserHost } from './songs/host';
import { library } from './songs/library';
import { SongPlayer } from './songs/player';

// Dev-only test page for the song engine: pick a song, start the band in hidden iframes, play it. The records page does
// the same with a record collection on top.
const app = document.querySelector<HTMLDivElement>('#app')!;
app.innerHTML = '<h1 style="font-size:18px">MOA song test</h1><div id="songs"></div><pre id="out">idle</pre><div id="band" style="position:fixed;left:0;top:0;width:1px;height:1px;overflow:hidden;opacity:0"></div>';
const out = app.querySelector<HTMLPreElement>('#out')!;
const band = new Band(app.querySelector<HTMLElement>('#band')!);
const player = new SongPlayer(browserHost());
const songs = library();
let current = songs[0]!;

player.onTick = (beat) => {
  const bar = Math.floor(beat / current.beatsPerBar) + 1;
  out.textContent = `${current.title}: bar ${Math.max(bar, 0)} of ${current.bars}; band ${band.startedCount}/${band.pages.length} started`;
};
player.onEnd = () => { out.textContent = `${current.title}: finished`; };

for (const song of songs) {
  const b = document.createElement('button');
  b.textContent = `Play: ${song.title}`;
  b.style.cssText = 'font-size:20px;padding:12px;margin:4px';
  b.addEventListener('click', async () => {
    current = song;
    out.textContent = 'starting the band...';
    try {
      await band.start();
      player.setup(song);
      await new Promise((r) => setTimeout(r, 1200)); // let the settings land before the first note
      player.play(song);
    } catch (e) {
      out.textContent = String(e);
    }
  });
  app.querySelector('#songs')!.append(b);
}
const stop = document.createElement('button');
stop.textContent = 'Stop';
stop.style.cssText = 'font-size:20px;padding:12px;margin:4px';
stop.addEventListener('click', () => { player.stop(); out.textContent = 'stopped'; });
app.querySelector('#songs')!.append(stop);
Object.assign(window, { __songtest: { band, player, songs } });
