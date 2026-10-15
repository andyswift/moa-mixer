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
