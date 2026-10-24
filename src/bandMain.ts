import './ui/band.css';
import { epochNow } from './midi/bus';
import { Band } from './songs/band';
import { browserHost } from './songs/host';
import { SongPlayer } from './songs/player';
import { bandSet } from './ui/bandSet';
import { BandStage } from './ui/bandStage';
import { renderBandPage } from './ui/bandView';

// The band page: the band on stage playing their set (Odd Hours, Sun Engine) on the modelled instruments. The
// instruments, the mixer and the effects run in hidden iframes, as on the records page (src/songs); every note sent to
// them also reaches the stage, so the players move to what they play.
const root = document.querySelector<HTMLDivElement>('#app')!;
const supported = typeof BroadcastChannel !== 'undefined' && typeof AudioWorkletNode !== 'undefined' && !/Mobi|Android|iPhone|iPad/.test(navigator.userAgent);

const stage = new BandStage();
const holder = document.createElement('div');
holder.className = 'band-frames';
const band = new Band(holder, ['mixer']); // the song's instruments and effects join when it is played
const host = browserHost();
const player = new SongPlayer({ ...host, sendNote: (page, data, at) => { host.sendNote(page, data, at); stage.note(page, data, at); } });
renderBandPage(root, bandSet(), band, player, holder, stage);
if (supported) band.mount();
else {
  const sorry = document.createElement('p');
  sorry.className = 'band-sorry';
  sorry.textContent = 'The band plays on a dozen audio engines at once, so it needs desktop Chrome or a similar browser. You can still watch them stand about.';
  root.prepend(sorry);
}
if (import.meta.env.DEV) Object.assign(window, { __band: { band, player, stage, epochNow } });
