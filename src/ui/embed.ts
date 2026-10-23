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

/** Whether this page's frame is hidden by the page around it (the band's pages sit hidden until opened for tweaking). */
const frameHidden = (): boolean => {
  try {
    const frame = window.frameElement as HTMLElement | null;
    return !!frame && frame.style.visibility === 'hidden';
  } catch {
    return false; // a frame of another site: never the case here
  }
};

/**
 * Hidden, an embedded page's drawing (fretboards, the kit's heads, meters) is seen by nobody, yet it runs on the same
 * main thread that carries every instrument's audio to the mixer: a busy frame there and the mixer's buffers run dry.
 * So while its frame is hidden, its animation loops tick four times a second instead of every frame; opened, they run
 * at full speed again.
 */
function throttleWhileHidden(): void {
  const raf = window.requestAnimationFrame.bind(window);
  window.requestAnimationFrame = (cb: FrameRequestCallback): number => {
    if (!frameHidden()) return raf(cb);
    return window.setTimeout(() => cb(performance.now()), 250) as unknown as number;
  };
}

export function applyEmbedMode(): void {
  if (!isEmbedded()) return;
  document.body.classList.add('embed');
  throttleWhileHidden();
  // Keys pressed inside a frame never reach the page around it, so Escape (close the panel) is passed up.
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') window.parent.postMessage({ type: CLOSE_PANEL }, location.origin);
  });
}

/** What an embedded page tells the records page when Escape is pressed inside it. */
export const CLOSE_PANEL = 'moa-close-panel';
