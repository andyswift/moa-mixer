/**
 * The static artwork of the MOA-DUO front panel (outlines, light strips, titles and labels), drawn in the
 * coordinates of the reference photo: viewBox "25 18 1965 1167". The controls are placed over it in `duoPanel.ts`.
 * Static markup only: no user data goes into it.
 */
export const DUO_VIEWBOX = { x: 25, y: 18, w: 1965, h: 1167 } as const;

export const DUO_DECOR = `<svg class="duo-decor" viewBox="25 18 1965 1167" aria-hidden="true" focusable="false">
    <!-- outlines -->
    <g fill="none" stroke="#e6e6e2" stroke-width="5" stroke-linejoin="round">
      <rect x="85" y="58" width="547" height="234" rx="30"/>
      <rect x="658" y="58" width="582" height="238" rx="36" stroke-width="9"/>
      <rect x="1264" y="58" width="316" height="238" rx="28"/>
      <rect x="85" y="324" width="547" height="772" rx="30"/>
      <path d="M690 324 H1210 Q1240 324 1240 354 V740 Q1240 770 1270 770 H1346 Q1378 770 1378 800 V1066 Q1378 1096 1348 1096 H688 Q658 1096 658 1066 V356 Q658 324 690 324 Z"/>
      <path d="M1292 324 H1552 Q1580 324 1580 352 V1068 Q1580 1096 1552 1096 H1406 Q1378 1096 1378 1068 V798 Q1378 770 1346 770 H1292 Q1264 770 1264 742 V352 Q1264 324 1292 324 Z"/>
    </g>
    <!-- routing strips -->
    <rect x="272" y="128" width="80" height="162" rx="8" fill="#cfcfcf"/>
    <rect x="362" y="128" width="80" height="162" rx="8" fill="#cfcfcf"/>
    <g fill="none" stroke="#e6e6e2" stroke-width="3"><path d="M215 148 H245 L272 148 M215 185 H255 L272 185 M215 222 H245 L272 222 M215 260 H245 L272 260"/><path d="M442 148 H470 M442 185 H470 M442 222 H470 M442 260 H470"/></g>
    <g fill="#141414" font-size="25" text-anchor="middle" letter-spacing="1"><text x="312" y="154">NOR</text><text x="312" y="191">SPLIT</text><text x="312" y="228">HALF</text><text x="312" y="267">VCA</text><text x="402" y="154">LPF</text><text x="402" y="191">HPF</text><text x="402" y="228">EVEN</text><text x="402" y="267">ODD</text></g>
    <g fill="#f2f2ee" font-size="36" text-anchor="middle" letter-spacing="2"><text x="358" y="100">ROUTING</text><text x="175" y="114" font-size="28">VCO</text><text x="541" y="114" font-size="28">VCF</text></g>
    <!-- reverb fans -->
    <polygon points="690,100 826,150 826,214 690,262" fill="#cfcfcf"/>
    <polygon points="1208,100 1034,150 1034,214 1208,262" fill="#cfcfcf"/>
    <g fill="#f2f2ee" font-size="30" text-anchor="middle" letter-spacing="2"><text x="948" y="102" font-size="36" fill="#cfcfcf">REVERB</text><text x="750" y="276">TIME</text><text x="948" y="276">DECAY</text><text x="1146" y="276">MIX</text></g>
    <!-- settings -->
    <line x1="1272" y1="207" x2="1572" y2="207" stroke="#e6e6e2" stroke-width="4"/>
    <g fill="#f2f2ee" font-size="22" text-anchor="middle" letter-spacing="1"><text x="1422" y="102" font-size="36" letter-spacing="2">SETTINGS</text><text x="1310" y="143">OFF</text><text x="1418" y="143">MONO</text><text x="1527" y="143">OMNI</text><text x="1310" y="276">LEG</text><text x="1418" y="276">DUO</text><text x="1527" y="276">CHAN</text></g>
    <!-- osc box -->
    <polygon points="238,330 276,330 250,362" fill="#e6e6e2"/><polygon points="440,330 478,330 464,362" fill="#e6e6e2"/>
    <g fill="#cfcfcf" font-size="34" letter-spacing="3"><text x="114" y="366">OSC 1</text><text x="466" y="366">OSC 2</text></g>
    <g fill="#f2f2ee" font-size="22" text-anchor="middle" letter-spacing="1"><text x="355" y="584" font-size="28">TUNE</text><text x="355" y="702" font-size="22">SYNC</text><text x="298" y="656" text-anchor="end">OFF</text><text x="408" y="656" text-anchor="start">ON</text>
      <text x="170" y="446">32 16 8</text><text x="526" y="446">16 8 4</text>
      <text x="131" y="745">PW</text><text x="226" y="745">GLD</text><text x="485" y="745">DTN</text><text x="579" y="745">GLD</text>
      <text x="131" y="1071">LVL</text><text x="579" y="1071">LVL</text></g>
    <g stroke="#e6e6e2" stroke-width="3"><line x1="454" y1="596" x2="476" y2="596"/><line x1="496" y1="596" x2="518" y2="596"/></g>
    <!-- vibrato -->
    <path d="M272 1076 V796 Q272 772 296 772 H350 Q356 772 356 790 V1076 Z M356 1076" fill="#e9e9e9"/>
    <rect x="272" y="772" width="168" height="304" rx="14" fill="#e9e9e9"/>
    <g fill="#141414" font-size="24" text-anchor="middle" letter-spacing="1"><text x="355" y="800">VIBRATO</text><text x="307" y="1071">RATE</text><text x="403" y="1071">LVL</text></g>
    <!-- wave icons -->
    <g fill="none" stroke="#f2f2ee" stroke-width="4" stroke-linejoin="round"><path d="M203 878 L222 862 V878"/><path d="M200 983 V965 H208 V983 H216 V965 H224"/><path d="M483 878 L502 862 V878"/><path d="M486 982 L500 966 L514 982"/></g>
    <!-- dual filter -->
    <polygon points="700,334 740,334 722,362" fill="#e6e6e2"/><polygon points="852,334 888,334 870,362" fill="#e6e6e2"/>
    <g fill="#cfcfcf" font-size="38" letter-spacing="4" text-anchor="end"><text x="1202" y="366">DUAL FILTER</text></g>
    <g fill="#f2f2ee" font-size="26" text-anchor="middle" letter-spacing="1"><text x="793" y="584" font-size="28">CUTOFF</text><text x="1060" y="689">POST</text><text x="1157" y="689">RES</text></g>
    <g stroke="#e6e6e2" stroke-width="3"><line x1="1030" y1="545" x2="1050" y2="545"/><line x1="1072" y1="545" x2="1092" y2="545"/></g>
    <!-- mod root strip -->
    <path d="M666 640 Q666 604 702 604 H944 V748 H702 Q666 748 666 712 Z" fill="#dadada"/>
    <g fill="#141414" font-size="25" text-anchor="end" letter-spacing="1"><text x="912" y="621">SINGLE</text><text x="896" y="662">DUAL</text><text x="896" y="701">SPLIT</text><text x="896" y="740">ODD</text></g>
    <text x="946" y="690" fill="#141414" font-size="20" font-weight="700" letter-spacing="2" transform="rotate(90 946 690)" text-anchor="middle" dy="-4">MOD ROOT</text>
    <!-- mods -->
    <g fill="#f2f2ee" font-size="30" letter-spacing="2" text-anchor="middle"><text x="786" y="793">MOD 1</text><text x="1108" y="793">MOD 2</text></g>
    <g fill="#f2f2ee" font-size="22" text-anchor="middle" letter-spacing="1"><text x="778" y="1071">RISE</text><text x="873" y="1071">FALL</text><text x="968" y="1071">LVL</text><text x="1065" y="1071">RISE</text><text x="1160" y="1071">FALL</text><text x="1255" y="1071">LVL</text><text x="698" y="884">HOLD</text><text x="698" y="1071">LFO</text><text x="1339" y="885">HOLD</text><text x="1339" y="1071">LFO</text></g>
    <line x1="1018" y1="812" x2="1018" y2="1040" stroke="#e6e6e2" stroke-width="5"/>
    <!-- vca -->
    <path d="M1264 640 H1580 V1068 Q1580 1096 1552 1096 H1406 Q1378 1096 1378 1068 V798 Q1378 770 1346 770 H1292 Q1264 770 1264 742 Z" fill="#e9e9e9"/>
    <path d="M1264 640 Q1264 700 1300 710 H1316" fill="none"/>
    <polygon points="1292,336 1346,336 1330,376" fill="#e6e6e2"/><polygon points="1510,336 1552,336 1538,376" fill="#e6e6e2"/>
    <g fill="#f2f2ee" font-size="36" text-anchor="middle" letter-spacing="3"><text x="1426" y="366">VCA</text></g>
    <g fill="#f2f2ee" font-size="28" text-anchor="middle" letter-spacing="2"><text x="1426" y="630">LEVEL</text></g>
    <g fill="#141414" font-size="22" text-anchor="middle" letter-spacing="1"><text x="1368" y="692" text-anchor="start">HOLD</text><text x="1464" y="692" text-anchor="start">LFO</text><text x="1441" y="1071">RISE</text><text x="1537" y="1071">FALL</text></g>
    <!-- right panel: noise and patches (the hardware's jacks are left out) -->
    <rect x="1600" y="325" width="336" height="765" rx="30" fill="#e0e0e0"/>
    <g fill="#141414" font-size="26" text-anchor="middle" letter-spacing="2"><text x="1768" y="424">NOISE</text><text x="1768" y="590" font-size="30">PATCH</text><text x="1768" y="1066" font-size="22">MIDI</text></g>
    
    <!-- wordmark -->
    <g transform="translate(1612 120) scale(1.12)" fill="none" stroke="#f4f4f0" stroke-width="7" stroke-linecap="round" stroke-linejoin="round">
      <g transform="translate(6 8)"><path d="M4 44 V6 L19 28 L34 6 V44"/></g>
      <g transform="translate(52 8)"><ellipse cx="19" cy="25" rx="16" ry="21"/></g>
      <g transform="translate(96 8)"><path d="M4 44 L19 5 L34 44 M10 31 H28"/></g>
      <g transform="translate(138 8)"><path d="M6 27 H22"/></g>
      <g transform="translate(160 8)"><path d="M4 6 V44 H15 C31 44 36 34 36 25 C36 14 30 6 15 6 Z"/></g>
      <g transform="translate(206 8)"><path d="M4 6 V30 C4 52 36 52 36 30 V6"/></g>
      <g transform="translate(250 8)"><ellipse cx="19" cy="25" rx="16" ry="21"/></g>
    </g>
    <rect x="1604" y="214" width="336" height="9" rx="4" fill="#f0883e"/>
    <text x="1604" y="262" fill="#f2f2ee" font-size="24" letter-spacing="4">PARAPHONIC SYNTHESIZER</text>
    <!-- screws -->
    <g fill="#2a2a2c" stroke="#555" stroke-width="2"><circle cx="108" cy="46" r="13"/><circle cx="1928" cy="46" r="13"/><circle cx="108" cy="1148" r="13"/><circle cx="1928" cy="1148" r="13"/><circle cx="214" cy="1038" r="20"/><circle cx="497" cy="1038" r="20"/></g>
  </svg>`;
