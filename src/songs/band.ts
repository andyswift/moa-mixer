import { PAGE_IDS, type PageId, type PageState, sendControl, watchStatus } from './control';

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
  private readonly listeners = new Set<() => void>();
  private stopWatching?: () => void;
  private mounted = false;

  constructor(private readonly host: HTMLElement, readonly pages: readonly PageId[] = PAGE_IDS) {
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
      f.src = pageUrl(p);
      f.title = `${p} (running in the background)`;
      f.setAttribute('aria-hidden', 'true');
      f.setAttribute('allow', 'autoplay');
      f.tabIndex = -1;
      // not display:none: browsers may not run a page's rendering and audio loops when it is
      f.style.cssText = 'position:fixed;left:0;top:0;width:1px;height:1px;opacity:0;border:0;pointer-events:none';
      this.host.append(f);
    }
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
    this.mounted = false;
    for (const p of this.pages) this.states.set(p, 'missing');
    this.emit();
  }

  private emit(): void {
    for (const l of this.listeners) l();
  }
}
