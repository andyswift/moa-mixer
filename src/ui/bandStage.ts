import type { PageId } from '../songs/control';

/**
 * The band on stage, drawn in SVG from the band page's design (four flat, geometric cartoons) and moved by the music:
 * every note the song player sends reaches the stage at the moment it sounds, and the players move to it, each in
 * their own way, the hotter the section the more:
 *
 * - the guitarist (grey hair, glasses, denim): calm in the gentle sections; when it gets heavy he freaks out, banging
 *   his head on every beat, hair flying, knees going, shaking. His picking arm hits each note, his fretting hand slides
 *   up the neck with the pitch.
 * - the drummer (mustard jacket): fairly chilled; a nod on the downbeat, a little sway, and his arms go to whatever he
 *   hits, which shakes (the cymbals wobble, the drums jump).
 * - the dub bassist (beanie, grey jumper): chilled, a slow sway and a gentle nod, whatever happens.
 * - the free bassist (hood up): a nutter; his hips circle, his body twists, his head thrashes, and on the big notes he
 *   jumps, most of all when he leads (the hottest sections count double for him).
 *
 * Each character is a set of groups (legs, upper body, head, arms, instrument) turned about their joints every frame.
 */

/** Whose stage spot a page is. */
export type Player = 'guitar' | 'kit' | 'bass' | 'bass2';

const W = 1240, H = 520;
const NS = 'http://www.w3.org/2000/svg';

// ---- the characters (shapes from the design; each part in a group that can move) ----

const GUITARIST = `
<g id="gt-legs">
  <path d="M84 396 Q84 386 96 386 L124 386 Q132 388 132 398 L132 404 L84 404 Z" fill="#141518"/><rect x="84" y="402" width="50" height="8" rx="3" fill="#ece8de"/><path d="M120 389 Q132 390 132 400 L120 400 Z" fill="#ece8de"/>
  <path d="M148 396 Q148 386 160 386 L188 386 Q196 388 196 398 L196 404 L148 404 Z" fill="#141518"/><rect x="148" y="402" width="50" height="8" rx="3" fill="#ece8de"/><path d="M184 389 Q196 390 196 400 L184 400 Z" fill="#ece8de"/>
  <path d="M96 262 L134 262 L128 390 L96 390 Z" fill="#202227"/><path d="M146 262 L184 262 L190 390 L156 390 Z" fill="#202227"/>
</g>
<g id="gt-upper">
  <path d="M84 148 Q140 130 196 148 L202 272 L78 272 Z" fill="#2e4262"/><path d="M126 140 L154 140 L150 250 L130 250 Z" fill="#5b2733"/>
  <path d="M126 140 L116 176 L130 168 Z" fill="#3a5276"/><path d="M154 140 L164 176 L150 168 Z" fill="#3a5276"/>
  <rect x="88" y="196" width="26" height="18" rx="2" fill="#26375a"/><rect x="166" y="196" width="26" height="18" rx="2" fill="#26375a"/>
  <line x1="80" y1="262" x2="200" y2="262" stroke="#26375a" stroke-width="6"/>
  <rect x="129" y="114" width="22" height="28" fill="#e2ad86"/>
  <g id="gt-head">
    <g id="gt-wild" opacity="0" stroke="#d6d6d3" stroke-width="5" stroke-linecap="round" fill="none"><path d="M110 72 L94 50 M118 60 L108 34 M132 52 L128 26 M148 52 L152 26 M162 60 L174 34 M170 72 L188 52"/></g>
    <ellipse cx="140" cy="88" rx="31" ry="35" fill="#ebbb95"/><ellipse cx="108" cy="92" rx="6" ry="9" fill="#e2ad86"/><ellipse cx="172" cy="92" rx="6" ry="9" fill="#e2ad86"/>
    <path d="M107 86 Q104 50 140 48 Q178 50 173 86 Q170 70 160 64 Q150 72 136 66 Q122 72 112 70 Q108 78 107 86 Z" fill="#d6d6d3"/>
    <path d="M106 80 Q102 66 112 58 L114 74 Z" fill="#c4c4c0"/><path d="M174 80 Q178 66 168 58 L166 74 Z" fill="#c4c4c0"/>
    <rect x="116" y="82" width="20" height="15" rx="3" fill="#ffffff" fill-opacity="0.18" stroke="#17181b" stroke-width="3"/><rect x="144" y="82" width="20" height="15" rx="3" fill="#ffffff" fill-opacity="0.18" stroke="#17181b" stroke-width="3"/>
    <line x1="136" y1="88" x2="144" y2="88" stroke="#17181b" stroke-width="3"/>
    <circle id="gt-eyel" cx="126" cy="90" r="2.5" fill="#2a2420"/><circle id="gt-eyer" cx="154" cy="90" r="2.5" fill="#2a2420"/>
    <g id="gt-browl"><line x1="117" y1="77" x2="134" y2="77" stroke="#b9b9b5" stroke-width="3" stroke-linecap="round"/></g>
    <g id="gt-browr"><line x1="146" y1="77" x2="163" y2="77" stroke="#b9b9b5" stroke-width="3" stroke-linecap="round"/></g>
    <path d="M140 94 L137 104 L142 104" fill="none" stroke="#c98f6c" stroke-width="2"/>
    <path id="gt-mouth" d="M130 111 Q140 115 150 111" fill="none" stroke="#9c5c48" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"/>
  </g>
  <g id="gt-guitar"><g transform="rotate(24 150 236)">
    <rect x="20" y="230" width="116" height="13" rx="2" fill="#d8b47c"/><path d="M2 226 L24 228 L24 246 L4 248 Q-2 238 2 226 Z" fill="#d8b47c"/>
    <path d="M118 212 Q140 196 162 210 Q196 200 206 228 Q212 256 190 268 Q160 284 130 266 Q106 256 112 236 Q108 222 118 212 Z" fill="#3b1d12"/>
    <path d="M126 218 Q142 208 160 218 Q188 212 196 232 Q200 254 182 262 Q158 274 134 260 Q118 250 122 236 Q118 226 126 218 Z" fill="#c25a22"/>
    <path d="M136 226 Q150 220 162 228 Q182 226 186 240 Q186 254 170 256 Q152 262 140 252 Q130 244 136 226 Z" fill="#e8a53e"/>
    <path d="M128 232 Q140 224 156 230 L162 262 Q144 266 132 254 Q124 244 128 232 Z" fill="#efe8d6"/>
    <rect x="166" y="228" width="7" height="22" rx="2" fill="#f4f1e8"/><rect x="150" y="228" width="7" height="22" rx="2" fill="#f4f1e8"/><rect x="184" y="228" width="5" height="22" rx="1" fill="#1b1b1d"/>
    <g stroke="#eceae4" stroke-width="0.8"><line x1="14" y1="233" x2="190" y2="233"/><line x1="14" y1="236" x2="190" y2="236"/><line x1="14" y1="239" x2="190" y2="239"/><line x1="14" y1="242" x2="190" y2="242"/></g>
  </g></g>
  <g id="gt-fret"><path d="M92 158 Q64 178 74 200" fill="none" stroke="#2e4262" stroke-width="22" stroke-linecap="round"/><circle cx="77" cy="205" r="10" fill="#ebbb95"/></g>
  <g id="gt-strum"><path d="M190 158 Q214 196 198 228 Q186 244 170 250" fill="none" stroke="#2e4262" stroke-width="22" stroke-linecap="round"/><circle cx="166" cy="252" r="10" fill="#ebbb95"/><line x1="160" y1="256" x2="154" y2="262" stroke="#ffd25e" stroke-width="3" stroke-linecap="round"/></g>
</g>`;

const DRUMMER = `
<g id="dr-crash"><line x1="46" y1="160" x2="46" y2="410" stroke="#8d9097" stroke-width="3"/><g id="dr-crash-plate"><ellipse cx="46" cy="158" rx="42" ry="7" fill="#d4a53a"/><ellipse cx="46" cy="156" rx="6" ry="3" fill="#a88228"/></g></g>
<g id="dr-ride"><line x1="300" y1="178" x2="300" y2="410" stroke="#8d9097" stroke-width="3"/><g id="dr-ride-plate"><ellipse cx="300" cy="176" rx="38" ry="7" fill="#c9992f"/><ellipse cx="300" cy="174" rx="6" ry="3" fill="#a88228"/></g></g>
<g id="dr-upper">
  <path d="M124 178 Q170 160 216 178 L224 306 L116 306 Z" fill="#d9a12b"/><path d="M152 166 L170 196 L188 166 Q170 160 152 166 Z" fill="#b9851c"/>
  <line x1="170" y1="196" x2="170" y2="306" stroke="#a57716" stroke-width="3"/><rect x="180" y="214" width="16" height="9" rx="2" fill="#1c1d21"/>
  <rect x="159" y="138" width="22" height="26" fill="#cf9470"/>
  <g id="dr-head">
    <ellipse cx="170" cy="114" rx="29" ry="33" fill="#d99f79"/><ellipse cx="140" cy="118" rx="5" ry="8" fill="#cf9470"/><ellipse cx="200" cy="118" rx="5" ry="8" fill="#cf9470"/>
    <path d="M141 106 Q142 78 170 76 Q198 78 199 106 Q194 90 170 90 Q148 90 141 106 Z" fill="#2b231f"/>
    <path d="M146 124 Q148 146 170 148 Q192 146 194 124 Q192 138 170 140 Q148 138 146 124 Z" fill="#7a5a48" fill-opacity="0.55"/>
    <g id="dr-browl"><line x1="152" y1="104" x2="164" y2="102" stroke="#2b231f" stroke-width="3" stroke-linecap="round"/></g><g id="dr-browr"><line x1="176" y1="102" x2="188" y2="104" stroke="#2b231f" stroke-width="3" stroke-linecap="round"/></g>
    <circle cx="158" cy="112" r="2.5" fill="#2a2420"/><circle cx="182" cy="112" r="2.5" fill="#2a2420"/>
    <path d="M170 116 L167 126 L172 126" fill="none" stroke="#b97b58" stroke-width="2"/><path id="dr-mouth" d="M162 134 Q170 137 178 134" fill="none" stroke="#8a4a3a" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"/>
  </g>
</g>
<g id="dr-hat"><line x1="58" y1="252" x2="58" y2="410" stroke="#8d9097" stroke-width="3"/><g id="dr-hat-plate"><ellipse cx="58" cy="248" rx="32" ry="5" fill="#d4a53a"/><ellipse cx="58" cy="255" rx="32" ry="5" fill="#b98f2e"/></g></g>
<g id="dr-tom"><rect x="146" y="252" width="48" height="30" fill="#8a2f2a"/><ellipse cx="170" cy="282" rx="24" ry="6" fill="#6d2420"/><ellipse cx="170" cy="252" rx="24" ry="6" fill="#ece8de"/></g>
<g id="dr-floor"><line x1="236" y1="350" x2="230" y2="410" stroke="#8d9097" stroke-width="3"/><line x1="284" y1="350" x2="290" y2="410" stroke="#8d9097" stroke-width="3"/><rect x="226" y="296" width="64" height="58" fill="#8a2f2a"/><ellipse cx="258" cy="354" rx="32" ry="7" fill="#6d2420"/><ellipse cx="258" cy="296" rx="32" ry="7" fill="#ece8de"/></g>
<g id="dr-snare"><line x1="96" y1="310" x2="84" y2="410" stroke="#8d9097" stroke-width="3"/><line x1="124" y1="310" x2="136" y2="410" stroke="#8d9097" stroke-width="3"/><rect x="78" y="288" width="64" height="22" fill="#c9ccd1"/><ellipse cx="110" cy="310" rx="32" ry="6" fill="#a9adb3"/><ellipse cx="110" cy="288" rx="32" ry="6" fill="#f4f1e8"/></g>
<g id="dr-kick"><circle cx="170" cy="350" r="64" fill="#8a2f2a"/><circle cx="170" cy="350" r="56" fill="#efe9db"/><circle cx="170" cy="350" r="24" fill="#1c1d21"/><text x="170" y="357" text-anchor="middle" transform="translate(340 0) scale(-1 1)" font-family="'Barlow Condensed', sans-serif" font-weight="700" font-size="20" fill="#ffd25e" letter-spacing="1">MOA</text></g>
<g id="dr-larm"><path d="M130 192 Q100 228 110 262" fill="none" stroke="#d9a12b" stroke-width="22" stroke-linecap="round"/><circle cx="112" cy="266" r="10" fill="#d99f79"/><line x1="112" y1="266" x2="88" y2="290" stroke="#e8d6b0" stroke-width="4" stroke-linecap="round"/></g>
<g id="dr-rarm"><path d="M210 192 Q244 220 232 254" fill="none" stroke="#d9a12b" stroke-width="22" stroke-linecap="round"/><circle cx="230" cy="258" r="10" fill="#d99f79"/><line x1="230" y1="258" x2="270" y2="226" stroke="#e8d6b0" stroke-width="4" stroke-linecap="round"/></g>`;

const DUB = `
<g id="db-legs">
  <path d="M84 394 Q84 384 96 384 L124 384 Q134 386 134 396 L134 404 L84 404 Z" fill="#e6e3dc"/><rect x="84" y="402" width="52" height="8" rx="3" fill="#bfbcb4"/>
  <path d="M148 394 Q148 384 160 384 L188 384 Q198 386 198 396 L198 404 L148 404 Z" fill="#e6e3dc"/><rect x="148" y="402" width="52" height="8" rx="3" fill="#bfbcb4"/>
  <path d="M98 262 L136 262 L130 388 L96 388 Z" fill="#1b1c20"/><path d="M146 262 L184 262 L192 388 L156 388 Z" fill="#1b1c20"/>
</g>
<g id="db-upper">
  <path d="M84 146 Q140 128 196 146 L198 270 L82 270 Z" fill="#8e939b"/><path d="M120 136 Q140 150 160 136 Q140 130 120 136 Z" fill="#767b83"/><rect x="82" y="256" width="116" height="14" fill="#7b8088"/>
  <rect x="129" y="112" width="22" height="28" fill="#d8a782"/>
  <g id="db-head">
    <ellipse cx="140" cy="88" rx="30" ry="34" fill="#e2b38e"/><ellipse cx="110" cy="94" rx="5" ry="8" fill="#d8a782"/><ellipse cx="170" cy="94" rx="5" ry="8" fill="#d8a782"/>
    <path d="M112 92 Q112 130 140 132 Q168 130 168 92 Q164 112 152 112 Q140 106 128 112 Q116 112 112 92 Z" fill="#6f625a"/><path d="M128 112 Q140 106 152 112 Q148 118 140 118 Q132 118 128 112 Z" fill="#5a4e47"/>
    <path d="M106 82 Q104 44 140 42 Q176 44 174 82 Z" fill="#2d3038"/><rect x="104" y="72" width="72" height="14" rx="4" fill="#3a3e47"/>
    <g stroke="#2d3038" stroke-width="2"><line x1="116" y1="74" x2="116" y2="84"/><line x1="128" y1="74" x2="128" y2="84"/><line x1="140" y1="74" x2="140" y2="84"/><line x1="152" y1="74" x2="152" y2="84"/><line x1="164" y1="74" x2="164" y2="84"/></g>
    <circle cx="128" cy="96" r="2.5" fill="#2a2420"/><circle cx="152" cy="96" r="2.5" fill="#2a2420"/>
    <g id="db-lids" fill="#e2b38e"><rect x="123" y="92" width="10" height="4"/><rect x="147" y="92" width="10" height="4"/></g>
    <line x1="122" y1="90" x2="134" y2="90" stroke="#4a3f39" stroke-width="2.5" stroke-linecap="round"/><line x1="146" y1="90" x2="158" y2="90" stroke="#4a3f39" stroke-width="2.5" stroke-linecap="round"/>
    <path id="db-mouth" d="M132 121 Q140 125 148 121" fill="none" stroke="#3d332e" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"/>
  </g>
  <g id="db-bass"><g transform="rotate(20 150 250)">
    <rect x="-6" y="244" width="150" height="14" rx="2" fill="#4a3020"/><path d="M-30 240 L-4 242 L-4 260 L-28 262 Q-34 251 -30 240 Z" fill="#1c1d21"/>
    <path d="M124 222 Q150 204 172 222 Q206 210 218 240 Q222 272 196 284 Q160 300 128 280 Q104 266 112 246 Q110 230 124 222 Z" fill="#141518"/>
    <path d="M134 230 Q150 222 166 232 L170 274 Q148 282 134 270 Q124 258 128 244 Q128 236 134 230 Z" fill="#efebe2"/>
    <rect x="160" y="236" width="9" height="26" rx="2" fill="#26282c"/><rect x="196" y="240" width="8" height="22" rx="1" fill="#9a9da3"/>
    <g stroke="#d9d6ce" stroke-width="1.2"><line x1="-14" y1="247" x2="200" y2="247"/><line x1="-14" y1="250" x2="200" y2="250"/><line x1="-14" y1="253" x2="200" y2="253"/><line x1="-14" y1="256" x2="200" y2="256"/></g>
  </g></g>
  <g id="db-fret"><path d="M92 156 Q48 168 46 202" fill="none" stroke="#8e939b" stroke-width="22" stroke-linecap="round"/><circle cx="47" cy="210" r="10" fill="#e2b38e"/></g>
  <g id="db-pluck"><path d="M190 156 Q212 196 196 228 Q184 246 164 246" fill="none" stroke="#8e939b" stroke-width="22" stroke-linecap="round"/><circle cx="160" cy="248" r="10" fill="#e2b38e"/></g>
</g>`;

const FREE = `
<g id="fb-legs">
  <path d="M86 394 Q86 384 98 384 L124 384 Q134 386 134 396 L134 404 L86 404 Z" fill="#111214" stroke="#44474e" stroke-width="1.5"/><rect x="86" y="402" width="50" height="7" rx="3" fill="#d9d6ce"/>
  <path d="M146 394 Q146 384 158 384 L184 384 Q194 386 194 396 L194 404 L146 404 Z" fill="#111214" stroke="#44474e" stroke-width="1.5"/><rect x="146" y="402" width="50" height="7" rx="3" fill="#d9d6ce"/>
  <path d="M100 262 L136 262 L130 388 L98 388 Z" fill="#17181b" stroke="#3a3c42" stroke-width="1.5"/><path d="M144 262 L180 262 L186 388 L152 388 Z" fill="#17181b" stroke="#3a3c42" stroke-width="1.5"/>
</g>
<g id="fb-upper">
  <path d="M86 148 Q140 132 194 148 L198 272 L82 272 Z" fill="#202126" stroke="#44474e" stroke-width="2"/>
  <line x1="140" y1="150" x2="140" y2="272" stroke="#8d9097" stroke-width="2.5"/>
  <g id="fb-strings" stroke="#ece8de" stroke-width="2.5" stroke-linecap="round"><line x1="128" y1="148" x2="126" y2="190"/><line x1="152" y1="148" x2="154" y2="190"/></g>
  <g id="fb-head">
    <path d="M98 114 Q94 44 140 42 Q186 44 182 114 Q178 140 140 146 Q102 140 98 114 Z" fill="#202126" stroke="#44474e" stroke-width="2"/>
    <ellipse cx="140" cy="100" rx="25" ry="31" fill="#d4a07e"/><path d="M114 86 Q118 62 140 60 Q162 62 166 86 Q156 74 140 74 Q124 74 114 86 Z" fill="#202126"/>
    <path d="M118 108 Q120 128 140 130 Q160 128 162 108 Q158 122 140 124 Q122 122 118 108 Z" fill="#6e5545" fill-opacity="0.5"/>
    <g id="fb-browl"><line x1="126" y1="92" x2="136" y2="91" stroke="#2b231f" stroke-width="2.5" stroke-linecap="round"/></g><g id="fb-browr"><line x1="144" y1="91" x2="154" y2="92" stroke="#2b231f" stroke-width="2.5" stroke-linecap="round"/></g>
    <circle id="fb-eyel" cx="131" cy="99" r="2.5" fill="#2a2420"/><circle id="fb-eyer" cx="149" cy="99" r="2.5" fill="#2a2420"/>
    <path d="M140 102 L137 112 L142 112" fill="none" stroke="#b57d5c" stroke-width="2"/>
    <path id="fb-teeth" d="" fill="none" stroke="#f1eee6" stroke-width="2.5" stroke-linecap="round"/>
    <path id="fb-mouth" d="M133 120 L147 119" fill="none" stroke="#8a4a3a" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"/>
  </g>
  <g id="fb-bass"><g transform="rotate(14 150 236)">
    <rect x="-2" y="230" width="134" height="12" rx="2" fill="#d8b47c"/><path d="M-26 226 L0 228 L0 244 L-24 246 Q-30 236 -26 226 Z" fill="#d8b47c"/>
    <path d="M118 210 Q142 192 166 210 Q202 198 214 228 Q218 260 192 272 Q158 288 126 268 Q102 256 110 234 Q106 220 118 210 Z" fill="#ece4cf" stroke="#b9b1a0" stroke-width="1.5"/>
    <path d="M126 220 Q142 212 160 222 L168 262 Q146 270 132 258 Q120 246 124 234 Q122 226 126 220 Z" fill="#6b3a22"/><path d="M132 226 Q142 222 152 228 L156 254 Q144 258 136 250 Q130 242 132 226 Z" fill="#8a4d2c"/>
    <rect x="160" y="226" width="7" height="22" rx="2" fill="#26282c"/><rect x="178" y="226" width="7" height="22" rx="2" fill="#26282c"/><rect x="196" y="228" width="7" height="20" rx="1" fill="#9a9da3"/>
    <g stroke="#f4f1e8" stroke-width="1.2"><line x1="-10" y1="233" x2="200" y2="233"/><line x1="-10" y1="236" x2="200" y2="236"/><line x1="-10" y1="239" x2="200" y2="239"/><line x1="-10" y1="242" x2="200" y2="242"/></g>
  </g></g>
  <g id="fb-fret"><path d="M92 158 Q86 200 104 220" fill="none" stroke="#202126" stroke-width="22" stroke-linecap="round"/><circle cx="110" cy="226" r="10" fill="#d4a07e"/></g>
  <g id="fb-pluck"><path d="M190 158 Q220 196 208 230 Q200 244 192 246" fill="none" stroke="#202126" stroke-width="22" stroke-linecap="round"/><circle cx="189" cy="248" r="10" fill="#d4a07e"/><line x1="184" y1="252" x2="178" y2="258" stroke="#4a9be0" stroke-width="3" stroke-linecap="round"/></g>
</g>`;

/**
 * The drawings face the audience as left-handers would (headstocks to the audience's left); every player is mirrored
 * about the middle of their drawing so they play right-handed: necks to the audience's right, the drummer's hi-hat and
 * snare on the audience's right too.
 */
const mirror = (middle: number) => `translate(${2 * middle} 0) scale(-1 1)`;

/** Where each character stands on the stage (its 280 or 340 by 420 drawing's top left). */
const SPOTS: Record<Player, [number, number]> = { guitar: [36, 82], kit: [336, 46], bass: [645, 82], bass2: [935, 82] };

// ---- the drummer's kit: which piece a note hits, and which arm goes to it at what angle (degrees from its pose) ----

type Piece = 'kick' | 'snare' | 'tom' | 'floor' | 'hat' | 'crash' | 'ride';
const GM_PIECE: Record<number, Piece> = {
  35: 'kick', 36: 'kick', 37: 'snare', 38: 'snare', 40: 'snare', 41: 'floor', 43: 'floor', 45: 'tom', 47: 'tom', 48: 'tom', 50: 'tom',
  42: 'hat', 44: 'hat', 46: 'hat', 49: 'crash', 52: 'crash', 55: 'crash', 57: 'crash', 51: 'ride', 53: 'ride', 59: 'ride',
};
const ARM: Partial<Record<Piece, { arm: 'l' | 'r'; angle: number }>> = {
  snare: { arm: 'l', angle: 0 }, hat: { arm: 'l', angle: 36 }, crash: { arm: 'l', angle: 80 },
  tom: { arm: 'r', angle: 46 }, floor: { arm: 'r', angle: -8 }, ride: { arm: 'r', angle: -60 },
};
/** Each piece's centre, for a drum's jump or a cymbal's wobble. */
const PIECE_AT: Record<Piece, [number, number]> = {
  kick: [170, 350], snare: [110, 298], tom: [170, 266], floor: [258, 325], hat: [58, 252], crash: [46, 158], ride: [300, 176],
};

interface Pending {
  at: number;
  page: PageId;
  note: number;
  velocity: number;
}

export interface StageMood {
  /** Where the song is, in beats (fractional), and whether it is playing. */
  beat: number;
  playing: boolean;
  /** How heavy the section is now, 0..1. */
  heat: number;
  /** Whether the free bass is leading (it counts double for him). */
  lead: boolean;
  /** Where the bar holding `beat` started, in beats. */
  barStart: number;
}

/**
 * A mouth: centre, width, smile (-1 a frown, 1 a grin: the corners rise) and how open (0 closed, a line; 1 a shout).
 * Closed it is a curved line; open, a shape whose lower lip drops, filled dark.
 */
function mouth(cx: number, cy: number, w: number, smile: number, open: number): { d: string; fill: string } {
  const lift = smile * 4, x1 = cx - w / 2, x2 = cx + w / 2, y = cy - lift;
  const top = `M${x1.toFixed(1)} ${y.toFixed(1)} Q${cx} ${(cy + lift - 1).toFixed(1)} ${x2.toFixed(1)} ${y.toFixed(1)}`;
  if (open < 0.06) return { d: top, fill: 'none' };
  return { d: `${top} Q${cx} ${(cy + lift + 2 + open * 14).toFixed(1)} ${x1.toFixed(1)} ${y.toFixed(1)} Z`, fill: '#4a1c18' };
}

/** A small seeded jitter, so a freak-out shakes the same way every time. */
function shaker(seed: number): (t: number) => number {
  return (t) => Math.sin(t * 23.1 + seed) * 0.6 + Math.sin(t * 37.7 + seed * 2.3) * 0.4;
}

export class BandStage {
  readonly element: SVGSVGElement;
  private readonly parts = new Map<string, SVGGElement>();
  private pending: Pending[] = [];
  // envelopes (0..1, decaying) and targets, per thing that moves
  private strum = 0;
  private fretPitch = { guitar: 64, bass: 40, bass2: 57 };
  private fretAngle = { guitar: 0, bass: 0, bass2: 0 };
  private pluck = { bass: 0, bass2: 0 };
  private jump = 0;
  private hits = new Map<Piece, number>();
  private arms = { l: { angle: 0, target: 0, env: 0 }, r: { angle: 0, target: 0, env: 0 } };
  private heat = { guitar: 0, bass2: 0 };
  /** How busy each player is right now, 0..1 (for a level meter): every note lifts it, and it falls away. */
  readonly activity: Record<Player, number> = { guitar: 0, kit: 0, bass: 0, bass2: 0 };
  private last = 0;
  private readonly shake = { guitar: shaker(1.3), bass2: shaker(4.1) };

  constructor() {
    const svg = document.createElementNS(NS, 'svg');
    svg.setAttribute('viewBox', `0 0 ${W} ${H}`);
    svg.setAttribute('role', 'img');
    svg.setAttribute('aria-label', 'The band on stage, left to right: the guitarist, the drummer, the dub bassist and the free bassist, moving to the music');
    svg.classList.add('band-stage-svg');
    const at = (who: Player) => `translate(${SPOTS[who][0]} ${SPOTS[who][1]})`;
    svg.innerHTML = `
      <rect width="${W}" height="${H}" fill="#1d1e22"/>
      <rect y="${H - 120}" width="${W}" height="120" fill="#2a2723"/><rect y="${H - 120}" width="${W}" height="2" fill="#3b362f"/>
      <ellipse cx="176" cy="${H - 34}" rx="130" ry="30" fill="#ffd25e" fill-opacity="0.08"/><ellipse cx="506" cy="${H - 44}" rx="150" ry="34" fill="#ffd25e" fill-opacity="0.08"/>
      <ellipse cx="785" cy="${H - 34}" rx="120" ry="30" fill="#ffd25e" fill-opacity="0.08"/><ellipse cx="1075" cy="${H - 34}" rx="120" ry="30" fill="#ffd25e" fill-opacity="0.08"/>
      <rect x="356" y="${H - 74}" width="300" height="34" fill="#34302a"/><rect x="356" y="${H - 74}" width="300" height="2" fill="#4a443b"/>
      <g id="spot-guitar" transform="${at('guitar')}"><g transform="${mirror(140)}"><g id="gt-all">${GUITARIST}</g></g></g>
      <g id="spot-kit" transform="${at('kit')}"><g transform="${mirror(170)}"><g id="dr-all">${DRUMMER}</g></g></g>
      <g id="spot-bass" transform="${at('bass')}"><g transform="${mirror(140)}"><g id="db-all">${DUB}</g></g></g>
      <g id="spot-bass2" transform="${at('bass2')}"><g transform="${mirror(140)}"><g id="fb-all">${FREE}</g></g></g>`;
    for (const g of Array.from(svg.querySelectorAll<SVGGElement>('g[id]'))) this.parts.set(g.id, g);
    this.element = svg;
  }

  /** A note the song player sent, due at `at` (wall-clock ms, as `epochNow`). Note-offs are ignored. */
  note(page: PageId, data: readonly number[], at: number): void {
    if (((data[0] ?? 0) & 0xf0) !== 0x90 || !data[2]) return;
    this.pending.push({ at, page, note: data[1]!, velocity: data[2]! / 127 });
  }

  /** Lets go of every note still to come (the song stopped). */
  clear(): void {
    this.pending = [];
  }

  private set(id: string, transform: string): void {
    this.parts.get(id)?.setAttribute('transform', transform);
  }

  /** Sets a mouth (a path, not a group) to a shape. */
  private face(id: string, m: { d: string; fill: string }): void {
    const el = this.element.querySelector<SVGPathElement>(`#${id}`);
    if (!el) return;
    el.setAttribute('d', m.d);
    el.setAttribute('fill', m.fill);
  }

  /** Eyes grown wide, each about its own centre (so they stay where they are and look straight ahead). */
  private eyes(prefix: string, size: number): void {
    for (const side of ['l', 'r']) this.element.querySelector(`#${prefix}-eye${side}`)?.setAttribute('r', (2.5 * size).toFixed(2));
  }

  /** Brows: each turned about its middle (positive: the inner ends down, a frown) and raised by `up` px. */
  private brows(prefix: string, frown: number, up: number, at: [[number, number], [number, number]]): void {
    this.set(`${prefix}-browl`, `translate(0 ${(-up).toFixed(2)}) rotate(${frown.toFixed(2)} ${at[0][0]} ${at[0][1]})`);
    this.set(`${prefix}-browr`, `translate(0 ${(-up).toFixed(2)}) rotate(${(-frown).toFixed(2)} ${at[1][0]} ${at[1][1]})`);
  }

  private play(p: Pending): void {
    if (p.page in this.activity) {
      const who = p.page as Player;
      this.activity[who] = Math.min(1, this.activity[who] * 0.6 + 0.25 + 0.5 * p.velocity);
    }
    if (p.page === 'guitar') {
      this.strum = Math.max(this.strum, 0.5 + 0.5 * p.velocity);
      this.fretPitch.guitar = p.note;
    } else if (p.page === 'bass' || p.page === 'bass2') {
      this.pluck[p.page] = Math.max(this.pluck[p.page], 0.4 + 0.6 * p.velocity);
      this.fretPitch[p.page] = p.note;
      if (p.page === 'bass2' && p.velocity > 0.8) this.jump = Math.max(this.jump, p.velocity);
    } else if (p.page === 'kit') {
      const piece = GM_PIECE[p.note];
      if (!piece) return;
      this.hits.set(piece, Math.max(this.hits.get(piece) ?? 0, 0.4 + 0.6 * p.velocity));
      const arm = ARM[piece];
      if (arm && p.note !== 44) { // the hat's pedal is a foot
        const a = this.arms[arm.arm];
        a.target = arm.angle;
        a.env = 1;
      }
    }
  }

  /** Moves everyone for the time `now` (wall-clock ms) and where the song is. */
  update(now: number, mood: StageMood): void {
    const dt = this.last ? Math.min(0.1, Math.max(0, (now - this.last) / 1000)) : 0.016;
    this.last = now;
    // the notes due by now
    if (this.pending.length) {
      const due = this.pending.filter((p) => p.at <= now);
      if (due.length) {
        this.pending = this.pending.filter((p) => p.at > now);
        for (const p of due) this.play(p);
      }
    }
    const fall = (x: number, seconds: number) => x * Math.exp(-dt / seconds);
    this.strum = fall(this.strum, 0.09);
    this.pluck.bass = fall(this.pluck.bass, 0.12);
    this.pluck.bass2 = fall(this.pluck.bass2, 0.1);
    this.jump = fall(this.jump, 0.16);
    for (const who of Object.keys(this.activity) as Player[]) this.activity[who] = fall(this.activity[who], 0.25);
    for (const [k, v] of this.hits) this.hits.set(k, fall(v, k === 'crash' || k === 'ride' ? 0.5 : 0.12));
    for (const a of Object.values(this.arms)) { a.env = fall(a.env, 0.12); a.angle += (a.target - a.angle) * Math.min(1, dt * 30); }
    // moods follow the section, slowly (a freak-out builds and dies away)
    const ease = (x: number, to: number) => x + (to - x) * Math.min(1, dt * (to > x ? 1.6 : 0.6));
    this.heat.guitar = ease(this.heat.guitar, mood.playing ? mood.heat : 0);
    this.heat.bass2 = ease(this.heat.bass2, mood.playing ? Math.min(1.2, mood.heat + (mood.lead ? 0.5 : 0)) : 0);

    const beat = mood.beat;
    const t = now / 1000;
    const phase = beat - Math.floor(beat);
    const onBeat = Math.exp(-phase * 6); // a pulse on every beat
    const onBar = Math.exp(-Math.max(0, beat - mood.barStart) * 3); // and on the downbeat
    const r = (deg: number, x: number, y: number) => `rotate(${deg.toFixed(2)} ${x} ${y})`;

    // the guitarist: calm, then freaking out
    {
      const h = this.heat.guitar, wild = Math.max(0, h - 0.55) / 0.45;
      const shake = this.shake.guitar(t) * 4 * wild;
      const bounce = (0.012 + 0.05 * h) * onBeat;
      this.set('gt-legs', `translate(0 ${(410 * bounce).toFixed(2)}) scale(1 ${(1 - bounce).toFixed(4)})`);
      this.set('gt-upper', `translate(${(shake * 0.6).toFixed(2)} ${(150 * bounce).toFixed(2)}) ${r(-2 - 5 * h + shake, 140, 262)}`);
      this.set('gt-head', r((5 * (1 - h) + 34 * h) * onBeat - 3 * h + shake * 1.5, 140, 122));
      this.parts.get('gt-wild')?.setAttribute('opacity', wild.toFixed(2));
      this.set('gt-strum', r(-(5 + 10 * h) * this.strum, 190, 158));
      const fret = Math.max(-14, Math.min(10, -((this.fretPitch.guitar - 62) / 24) * 14));
      this.fretAngle.guitar += (fret - this.fretAngle.guitar) * Math.min(1, dt * 12);
      this.set('gt-fret', r(this.fretAngle.guitar, 92, 158));
      this.set('gt-guitar', r(-1.5 * h * onBeat, 150, 236));
      // his face: an easy smile; heavy, the brows knit, the eyes go wide and he shouts on the beat
      this.face('gt-mouth', mouth(140, 111, 20 - 4 * wild, 0.7 - 1.1 * wild, wild * (0.35 + 0.65 * onBeat)));
      this.brows('gt', 14 * wild, 2 * (1 - wild) * onBeat, [[125, 77], [155, 77]]);
      this.eyes('gt', 1 + 0.4 * wild);
    }
    // the drummer: fairly chilled, the arms busy
    {
      this.set('dr-upper', r(1.5 * Math.sin((Math.PI * beat) / 2), 170, 306));
      this.set('dr-head', r(4 * onBar + 3 * onBeat, 170, 140));
      // a content smile; busy (heavy, or the sticks flying), he concentrates: brows down, lips in an o
      const busy = Math.min(1, 0.6 * mood.heat + 0.5 * Math.max(this.arms.l.env, this.arms.r.env) * mood.heat);
      this.face('dr-mouth', mouth(170, 134, 16 - 8 * busy, 0.6 - 0.7 * busy, 0.35 * busy));
      this.brows('dr', 8 * busy, 2 * onBar * (1 - busy), [[158, 103], [182, 103]]);
      const sway = r(1.5 * Math.sin((Math.PI * beat) / 2), 170, 306);
      for (const side of ['l', 'r'] as const) {
        const a = this.arms[side];
        const lift = (side === 'l' ? 1 : -1) * 12 * (1 - a.env); // between strokes the stick comes up
        this.set(`dr-${side}arm`, `${sway} ${r(a.angle + lift, side === 'l' ? 130 : 210, 192)}`);
      }
      for (const piece of Object.keys(PIECE_AT) as Piece[]) {
        const v = this.hits.get(piece) ?? 0;
        const [x, y] = PIECE_AT[piece];
        if (piece === 'crash' || piece === 'ride' || piece === 'hat') this.set(`dr-${piece}-plate`, r(v * 7 * Math.sin(t * 26), x, y));
        else this.set(`dr-${piece}`, `translate(${x} ${y}) scale(${(1 + 0.04 * v).toFixed(3)}) translate(${-x} ${-y})`);
      }
    }
    // the dub bassist: chilled, whatever happens
    {
      const sway = 2.5 * Math.sin((Math.PI * beat) / 2);
      const bounce = 0.008 * onBeat;
      this.set('db-legs', `translate(0 ${(410 * bounce).toFixed(2)}) scale(1 ${(1 - bounce).toFixed(4)})`);
      this.set('db-upper', `translate(0 ${(150 * bounce).toFixed(2)}) ${r(sway, 140, 262)}`);
      this.set('db-head', r(5 * onBeat - sway * 0.5, 140, 120));
      // chilled: sleepy lids that close a little more on the beat, and a relaxed smile in the beard
      this.set('db-lids', `translate(0 ${(1 + 1.5 * onBeat).toFixed(2)})`);
      this.face('db-mouth', mouth(140, 121, 16, 0.6 + 0.2 * Math.sin((Math.PI * beat) / 4), 0));
      this.set('db-pluck', r(-6 * this.pluck.bass, 190, 156));
      // he plays low on the neck, by the headstock: a small slide up it as the notes rise
      const fret = Math.max(-7, Math.min(3, -((this.fretPitch.bass - 33) / 24) * 10));
      this.fretAngle.bass += (fret - this.fretAngle.bass) * Math.min(1, dt * 10);
      this.set('db-fret', r(this.fretAngle.bass, 92, 156));
    }
    // the free bassist: a nutter
    {
      const h = this.heat.bass2, wild = Math.max(0, h - 0.4);
      const shake = this.shake.bass2(t) * 5 * wild;
      const hipX = 12 * h * Math.sin(Math.PI * beat), hipY = -5 * h * Math.abs(Math.cos(Math.PI * beat));
      const jump = -26 * this.jump * Math.min(1, h);
      this.set('fb-all', `translate(${hipX.toFixed(2)} ${(hipY + jump).toFixed(2)})`);
      this.set('fb-legs', r(-hipX * 0.25, 140, 404));
      this.set('fb-upper', r(4 + 14 * h * Math.sin(Math.PI * beat + 0.8) + shake, 140, 262));
      this.set('fb-head', r(30 * h * Math.sin(2 * Math.PI * beat) + 4 * (1 - h) * onBeat + shake * 2, 140, 140));
      this.set('fb-strings', `translate(${(6 * h * Math.sin(2 * Math.PI * beat + 1)).toFixed(2)} 0)`);
      this.set('fb-pluck', r(-(6 + 8 * h) * this.pluck.bass2, 190, 158));
      const fret = Math.max(-12, Math.min(14, -((this.fretPitch.bass2 - 52) / 20) * 14));
      this.fretAngle.bass2 += (fret - this.fretAngle.bass2) * Math.min(1, dt * 14);
      this.set('fb-fret', r(this.fretAngle.bass2, 92, 158));
      this.set('fb-bass', r(-3 * h * Math.sin(Math.PI * beat), 150, 236));
      // manic: wide eyes, brows up, a grin with teeth that becomes a shout when he jumps
      const grin = Math.min(1, h), shout = Math.min(1, this.jump * 1.5);
      const m = mouth(140, 119.5, 14 + 6 * grin, 0.3 + 0.9 * grin - 0.6 * shout, 0.15 * grin + 0.85 * shout);
      this.face('fb-mouth', m);
      const teeth = grin > 0.35 && shout < 0.6 ? mouth(140, 120.5, 12 + 5 * grin, 0.3 + 0.9 * grin, 0).d : '';
      this.face('fb-teeth', { d: teeth, fill: 'none' });
      this.brows('fb', -10 * grin, 3 * grin + 3 * shout, [[131, 91], [149, 91]]);
      this.eyes('fb', 1 + 0.4 * grin);
    }
  }
}
