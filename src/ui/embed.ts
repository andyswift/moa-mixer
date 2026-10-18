/**
 * A page that the records page shows inside itself is loaded with `?embed=1`: it hides its navigation row and MIDI
 * strip (the records page conducts it), so only the instrument's own panel is left to tweak.
 */
/**
 * Whether this page is inside the records page. There it plays the song as written: from the factory patches and
 * the default routing, never from what the player saved on this site (their own patches in the slots, their input
 * choices), which would change the song's sound on one browser and not another.
 */
export const isEmbedded = (): boolean => typeof location !== 'undefined' && new URLSearchParams(location.search).has('embed');

export function applyEmbedMode(): void {
  if (!isEmbedded()) return;
  document.body.classList.add('embed');
  // Keys pressed inside a frame never reach the page around it, so Escape (close the panel) is passed up.
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') window.parent.postMessage({ type: CLOSE_PANEL }, location.origin);
  });
}

/** What an embedded page tells the records page when Escape is pressed inside it. */
export const CLOSE_PANEL = 'moa-close-panel';
