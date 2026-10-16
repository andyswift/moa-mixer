import { BAND_PAGES, type PageId, type PageState, sendControl, watchStatus } from './control';

/** Where each page lives: separate pages on the site, separate files in the dev server. */
export function pageUrl(id: PageId): string {
  if (import.meta.env.DEV) return id === 'mixer' ? '/index.html' : `/${id}.html`;
  return `/${id}/`;
}

/**
 * The instruments and the mixer, loaded in hidden same-origin iframes inside the records page. Starting them from a
 * click on the records page lets each one's audio run (they share the page's user activation).
 */
export class Band {
  readonly states = new Map<PageId, PageState | 'missing'>();
  private readonly frames = new Map<PageId, HTMLIFrameElement>();
  private focusedPage?: PageId;
  private readonly listeners = new Set<() => void>();
  private stopWatching?: () => void;
  private mounted = false;

  constructor(private readonly host: HTMLElement, readonly pages: readonly PageId[] = BAND_PAGES) {
    for (const p of pages) this.states.set(p, 'missing');
  }

  /** Loads the pages (not yet started). Safe to call more than once. */
  mount(): void {
    if (this.mounted) return;
    this.mounted = true;
    this.stopWatching = watchStatus((s) => {
      if (!this.states.has(s.page)) return;
      // 'started' is never taken back by a late 'loaded'
      if (!(this.states.get(s.page) === 'started' && s.state === 'loaded')) this.states.set(s.page, s.state);
      this.emit();
    });
    for (const p of this.pages) {
      const f = document.createElement('iframe');
      f.src = `${pageUrl(p)}?embed=1`;
      f.title = `${p} (running in the background)`;
      f.setAttribute('aria-hidden', 'true');
      f.setAttribute('allow', 'autoplay');
      f.tabIndex = -1;
      // Never display:none (browsers may stop a page's rendering and audio loops). The frames fill their holder, which
      // is a 1 px invisible box until a page is opened for tweaking; only the focused frame is visible and clickable.
      f.style.cssText = 'position:absolute;left:0;top:0;width:100%;height:100%;border:0;visibility:hidden;pointer-events:none;background:#07060d';
      this.frames.set(p, f);
      this.host.append(f);
    }
  }

  /** The page open for tweaking, if any. */
  get focused(): PageId | undefined {
    return this.focusedPage;
  }

  /** Shows one page's own panel (or none). The frames are only restyled, never moved, so nothing reloads and audio keeps running. */
  focus(page: PageId | undefined): void {
    this.focusedPage = page;
    for (const [p, f] of this.frames) {
      const on = p === page;
      f.style.visibility = on ? 'visible' : 'hidden';
      f.style.pointerEvents = on ? 'auto' : 'none';
    }
    this.emit();
  }

  get allStarted(): boolean {
    return this.pages.every((p) => this.states.get(p) === 'started');
  }

  get startedCount(): number {
    return this.pages.filter((p) => this.states.get(p) === 'started').length;
  }

  /**
   * Starts every page's audio and resolves when all have said so. Call it from the click that picks a record.
   * Rejects after `timeoutMs` naming the pages that did not start.
   */
  async start(timeoutMs = 20000): Promise<void> {
    this.mount();
    const until = Date.now() + timeoutMs;
    const sent = new Set<PageId>();
    while (!this.allStarted) {
      for (const p of this.pages) {
        // an order is only heard by a page that has loaded; ask again until it has started
        if (this.states.get(p) !== 'started' && (this.states.get(p) === 'loaded' || !sent.has(p))) {
          sendControl(p, { type: 'start' });
          sent.add(p);
        }
      }
      if (Date.now() > until) throw new Error(`These did not start: ${this.pages.filter((p) => this.states.get(p) !== 'started').join(', ')}`);
      await new Promise((r) => setTimeout(r, 250));
    }
  }

  onChange(fn: () => void): () => void {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  }

  /** Removes the pages (and with them their audio). */
  unmount(): void {
    this.stopWatching?.();
    this.host.replaceChildren();
    this.frames.clear();
    this.focusedPage = undefined;
    this.mounted = false;
    for (const p of this.pages) this.states.set(p, 'missing');
    this.emit();
  }

  private emit(): void {
    for (const l of this.listeners) l();
  }
}
