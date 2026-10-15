import { epochNow, MidiBus } from '../midi/bus';
import { type ControlMessage, type PageId, sendControl, songChannelName } from './control';
import type { PlayerHost } from './player';

/** The real thing for `SongPlayer`: notes over a MIDI bus per page, orders over the control channels. */
export function browserHost(): PlayerHost {
  const buses = new Map<PageId, MidiBus>();
  const bus = (page: PageId) => {
    let b = buses.get(page);
    if (!b) {
      b = new MidiBus(songChannelName(page));
      buses.set(page, b);
    }
    return b;
  };
  return {
    now: epochNow,
    sendNote: (page, data, at) => bus(page).send(data, at),
    control: (page: PageId, message: ControlMessage) => sendControl(page, message),
    setInterval: (fn, ms) => window.setInterval(fn, ms),
    clearInterval: (h) => window.clearInterval(h as number),
  };
}
