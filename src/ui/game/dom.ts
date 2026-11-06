/** A small element builder for the game's screens: tag.class.class, attributes, and children (strings become text). */
export function h<K extends keyof HTMLElementTagNameMap>(
  spec: K | `${K}.${string}`,
  attrs: Record<string, string | number | boolean | undefined> | null = null,
  ...children: (Node | string | null | undefined | false)[]
): HTMLElementTagNameMap[K] {
  const [tag, ...classes] = spec.split('.') as [K, ...string[]];
  const el = document.createElement(tag);
  if (classes.length) el.className = classes.join(' ');
  for (const [k, v] of Object.entries(attrs ?? {})) {
    if (v === undefined || v === false) continue;
    if (k === 'text') el.textContent = String(v);
    else el.setAttribute(k, v === true ? '' : String(v));
  }
  for (const c of children) if (c !== null && c !== undefined && c !== false) el.append(c);
  return el;
}

export function button(label: string, onClick: () => void, cls = ''): HTMLButtonElement {
  const b = h(`button.vr-btn${cls ? '.' + cls.split(' ').join('.') : ''}` as 'button', { type: 'button' }, label);
  b.addEventListener('click', onClick);
  return b;
}
