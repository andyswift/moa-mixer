import type { Song } from '../songs/types';

const FONT = "font-family=\"Alfa Slab One, serif\"";
const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;');

/** Splits a title into at most two short lines for a sleeve. */
function titleLines(title: string): string[] {
  const words = title.toLowerCase().split(' ');
  if (words.length < 2) return words;
  const mid = Math.ceil(words.length / 2);
  return [words.slice(0, mid).join(' '), words.slice(mid).join(' ')];
}

function label(song: Song, x: number, y: number, fill: string, size = 22): string {
  return titleLines(song.title).map((line, i) => `<text x="${x}" y="${y + i * (size + 3)}" ${FONT} font-size="${size}" fill="${fill}">${esc(line)}</text>`).join('');
}

/**
 * Original sleeve art, drawn from shapes: one design per `art` kind, coloured by the song. Returns an SVG string on a
 * 250 x 250 canvas, to be scaled by CSS.
 */
export function sleeveSvg(song: Song): string {
  const [a = '#ff7a3d', b = '#ffd25e', c = '#3a1d46'] = song.sleeve.colors;
  let body: string;
  switch (song.sleeve.art) {
    case 'sunrise':
      body = `<rect width="250" height="250" fill="${a}"/><circle cx="125" cy="150" r="78" fill="${b}"/>
        <g fill="${a}"><rect y="130" width="250" height="7"/><rect y="148" width="250" height="9"/><rect y="168" width="250" height="11"/><rect y="190" width="250" height="14"/></g>
        <rect y="204" width="250" height="46" fill="${c}"/>${label(song, 16, 30, c)}`;
      break;
    case 'garden':
      body = `<rect width="250" height="250" fill="${a}"/><circle cx="95" cy="120" r="70" fill="${b}" fill-opacity=".85"/>
        <circle cx="150" cy="105" r="62" fill="${c}" fill-opacity=".8"/><circle cx="128" cy="165" r="55" fill="#ffc23d" fill-opacity=".8"/>${label(song, 16, 32, '#fff4df')}`;
      break;
    case 'hands':
      body = `<rect width="250" height="250" fill="${a}"/><g stroke="${c}" stroke-opacity=".35" stroke-width="2"><path d="M0 170H250M0 195H250M0 225H250M30 155V250M85 155V250M140 155V250M195 155V250M245 155V250"/></g>
        <path d="M30 160L98 45L166 160Z" fill="${b}"/><path d="M90 175L158 60L226 175Z" fill="${c}" fill-opacity=".85"/><path d="M98 160L124 114L150 160Z" fill="#fff4df"/>${label(song, 16, 32, '#fff4df', 20)}`;
      break;
    case 'aurora':
      body = `<rect width="250" height="250" fill="${a}"/>
        <g fill="#e9eef5"><circle cx="30" cy="40" r="1.6"/><circle cx="84" cy="22" r="1.2"/><circle cx="150" cy="34" r="1.8"/><circle cx="212" cy="26" r="1.3"/><circle cx="232" cy="78" r="1.2"/><circle cx="18" cy="96" r="1.1"/></g>
        <path d="M-10 118 C40 70 90 150 150 96 S235 84 262 112 L262 156 C214 128 166 176 108 150 S18 166 -10 154 Z" fill="${b}" fill-opacity=".5"/>
        <path d="M-10 84 C54 40 108 112 170 62 S238 54 262 80 L262 108 C216 88 170 130 110 108 S28 116 -10 112 Z" fill="#2de2e6" fill-opacity=".38"/>
        <path d="M-10 146 C46 116 96 172 156 134 S232 130 262 150 L262 176 C216 160 168 196 110 176 S24 186 -10 178 Z" fill="#ff2e93" fill-opacity=".28"/>
        <path d="M0 250 L0 196 L28 168 L54 192 L90 146 L124 196 L158 156 L198 200 L226 176 L250 194 L250 250 Z" fill="#05080f"/>
        <path d="M0 250 L0 222 L40 204 L84 226 L134 208 L190 232 L250 214 L250 250 Z" fill="#02030a"/>
        ${label(song, 16, 30, c)}`;
      break;
    case 'frost':
      body = `<rect width="250" height="250" fill="${a}"/>
        <circle cx="165" cy="84" r="50" fill="${b}"/><circle cx="150" cy="70" r="11" fill="${c}" fill-opacity=".3"/><circle cx="178" cy="98" r="15" fill="${c}" fill-opacity=".25"/><circle cx="182" cy="62" r="6" fill="${c}" fill-opacity=".3"/>
        <g fill="${c}" fill-opacity=".3"><path d="M24 0 L34 120 L14 120 Z"/><path d="M62 0 L68 96 L54 96 Z"/><path d="M104 0 L110 70 L98 70 Z"/><path d="M226 0 L231 80 L221 80 Z"/></g>
        <path d="M0 250 L0 196 L12 168 L20 190 L30 146 L40 190 L50 160 L60 196 L72 132 L84 196 L96 160 L106 198 L120 124 L134 198 L146 160 L158 200 L172 140 L186 200 L198 164 L210 202 L222 150 L234 202 L244 176 L250 198 L250 250 Z" fill="#000"/>
        ${label(song, 16, 30, '#e8eef7')}`;
      break;
    case 'flats':
    default:
      body = `<rect width="250" height="250" fill="${a}"/><rect y="132" width="250" height="118" fill="${b}"/><circle cx="170" cy="100" r="22" fill="${c}"/>
        <path d="M170 132L60 250H150Z" fill="${c}" fill-opacity=".35"/><g stroke="${c}" stroke-opacity=".25"><path d="M0 160H250M0 190H250M0 225H250"/></g>${label(song, 16, 32, c)}`;
  }
  return `<svg viewBox="0 0 250 250" role="img" aria-label="Sleeve art for ${esc(song.title)}" xmlns="http://www.w3.org/2000/svg">${body}</svg>`;
}

/** The record's centre label colour. */
export function labelColor(song: Song): string {
  return song.sleeve.colors[1] ?? '#ffc23d';
}
