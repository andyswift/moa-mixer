/**
 * The unicorn, drawn in SVG: a white pony mid-jump with a rainbow horn, mane and tail, facing right. Its parts carry
 * classes the page animates: `.uni-eye-open` / `.uni-eye-shut` (awake or asleep), `.uni-horn` (glows with Magic) and
 * `.uni-horn-tip` (where sparkles fly from).
 */
const RAINBOW = ['#ff5f8f', '#ff9a3d', '#ffd23d', '#5fd17a', '#4ab8ff', '#9a7bff'];

export function unicornSvg(): string {
  const mane = [
    [302, 44, 16], [292, 58, 17], [282, 74, 17], [272, 90, 17], [262, 106, 16], [252, 121, 15],
  ].map(([x, y, r], i) => `<circle cx="${x}" cy="${y}" r="${r}" fill="${RAINBOW[i % 6]}"/>`).join('');
  const tail = RAINBOW.map((c, i) => `<path d="M112 ${128 + i * 5} C ${78 - i * 3} ${108 + i * 4}, ${52 - i * 2} ${132 + i * 6}, ${70 - i * 2} ${168 + i * 5}" stroke="${c}" stroke-width="9" fill="none" stroke-linecap="round"/>`).join('');
  const hornStripes = [0.18, 0.36, 0.54, 0.72].map((t) => {
    // white spiral lines across the horn
    const x = 328 + (372 - 328) * t, y = 46 + (2 - 46) * t, w = 10 * (1 - t) + 2;
    return `<line x1="${x - w}" y1="${y - w * 0.3}" x2="${x + w * 0.6}" y2="${y + w * 0.9}" stroke="#fff" stroke-width="2.5" stroke-linecap="round" opacity="0.85"/>`;
  }).join('');
  return `<svg class="uni-svg" viewBox="0 0 420 300" role="img" aria-label="En enhjørning som hopper over tangentene">
  <defs>
    <linearGradient id="uniHorn" x1="0" y1="1" x2="1" y2="0">
      ${RAINBOW.map((c, i) => `<stop offset="${(i / 5).toFixed(2)}" stop-color="${c}"/>`).join('')}
    </linearGradient>
    <radialGradient id="uniBody" cx="0.45" cy="0.35" r="0.75">
      <stop offset="0" stop-color="#ffffff"/><stop offset="1" stop-color="#efe8fb"/>
    </radialGradient>
  </defs>
  <g class="uni-tail">${tail}</g>
  <!-- back legs, stretched out behind -->
  <path d="M140 182 C 120 205, 98 222, 78 236" stroke="#f3eefc" stroke-width="22" fill="none" stroke-linecap="round"/>
  <path d="M168 190 C 150 214, 132 232, 116 248" stroke="#ffffff" stroke-width="22" fill="none" stroke-linecap="round"/>
  <circle cx="76" cy="238" r="12" fill="#c9b8ff"/><circle cx="114" cy="250" r="12" fill="#ffc2dc"/>
  <!-- the body -->
  <ellipse cx="200" cy="150" rx="98" ry="56" fill="url(#uniBody)" stroke="#e3d9f5" stroke-width="3"/>
  <!-- front legs, tucked up for the jump -->
  <path d="M250 186 C 270 206, 292 206, 304 190" stroke="#f3eefc" stroke-width="22" fill="none" stroke-linecap="round"/>
  <path d="M228 194 C 244 220, 270 226, 286 214" stroke="#ffffff" stroke-width="22" fill="none" stroke-linecap="round"/>
  <circle cx="306" cy="188" r="12" fill="#ffc2dc"/><circle cx="288" cy="214" r="12" fill="#c9b8ff"/>
  <!-- neck and head -->
  <path d="M246 116 C 262 86, 286 60, 312 52 L 336 96 C 314 112, 292 132, 280 150 Z" fill="url(#uniBody)" stroke="#e3d9f5" stroke-width="3" stroke-linejoin="round"/>
  <g class="uni-mane">${mane}</g>
  <ellipse cx="330" cy="76" rx="40" ry="30" fill="url(#uniBody)" stroke="#e3d9f5" stroke-width="3" transform="rotate(-18 330 76)"/>
  <ellipse cx="360" cy="94" rx="25" ry="19" fill="#ffe4ef" stroke="#f5c9dc" stroke-width="2"/>
  <ellipse cx="368" cy="92" rx="3.5" ry="2.5" fill="#d98aa9"/>
  <path d="M348 106 Q 358 113 368 106" stroke="#d98aa9" stroke-width="2.5" fill="none" stroke-linecap="round"/>
  <!-- the ear -->
  <path d="M306 52 L 300 18 L 324 44 Z" fill="#ffffff" stroke="#e3d9f5" stroke-width="3" stroke-linejoin="round"/>
  <path d="M308 46 L 304 26 L 318 42 Z" fill="#ffc2dc"/>
  <!-- the horn -->
  <g class="uni-horn">
    <path d="M318 48 L 372 2 L 340 58 Z" fill="url(#uniHorn)" stroke="#fff" stroke-width="2" stroke-linejoin="round"/>
    ${hornStripes}
  </g>
  <circle class="uni-horn-tip" cx="372" cy="2" r="1" fill="none"/>
  <!-- the eye: awake or asleep -->
  <g class="uni-eye-open">
    <ellipse cx="334" cy="70" rx="7" ry="9" fill="#3a2a4a"/>
    <circle cx="336.5" cy="66" r="2.6" fill="#fff"/>
    <path d="M326 62 L 321 57 M 330 60 L 327 54 M 335 60 L 334 53" stroke="#3a2a4a" stroke-width="2" stroke-linecap="round"/>
  </g>
  <g class="uni-eye-shut">
    <path d="M326 70 Q 334 77 342 70" stroke="#3a2a4a" stroke-width="3" fill="none" stroke-linecap="round"/>
    <path d="M327 72 L 323 77 M 332 75 L 331 80 M 338 74 L 340 79" stroke="#3a2a4a" stroke-width="2" stroke-linecap="round"/>
  </g>
  <circle cx="350" cy="86" r="8" fill="#ff8fb4" opacity="0.45"/>
</svg>`;
}

/** The colour of a note for the keys and sparkles: C red to B violet, as children's bells and tubes are coloured. */
export const NOTE_COLORS = ['#ff5f8f', '#ff5f8f', '#ff9a3d', '#ff9a3d', '#ffd23d', '#5fd17a', '#5fd17a', '#4ab8ff', '#4ab8ff', '#7d8bff', '#7d8bff', '#b77bff'];
