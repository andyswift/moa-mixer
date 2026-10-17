import type { ChoiceControl } from '../domain/devices/controls';
import type { M2600Synth } from '../domain/devices/m2600Synth';
import { SQ16_STEPS } from '../domain/devices/sq16Params';
import { type Board, type Lamps, type Readout, W, choice, choiceSwitch, controlCard, formatValue, led, num, rocker } from './m2600Panel';
import { el } from './widgets';

/**
 * The MOA-SQ16 band under the 2600: black and gold like the ARP sequencer it is modelled on, drawn on the same
 * board as the synth so cords run straight from its jacks into the 2600's. Left: sixteen step sliders, each with a
 * gate-bus chip above and a step lamp below (click a lamp to jump there). Middle: step and reset, the bus 3 switch,
 * the run button and the clock. Right: the two quantizers, the raw outputs and a MULT.
 */

/** A small button that picks one option of a choice. */
function chip(c: ChoiceControl, option: string, label: string, aria: string, say: Readout): HTMLElement {
  const b = el('button', 'sq-chip', label);
  b.type = 'button';
  b.setAttribute('aria-label', aria);
  const sync = () => {
    b.classList.toggle('on', c.value === option);
    b.setAttribute('aria-pressed', String(c.value === option));
  };
  b.addEventListener('click', () => {
    c.set(option);
    say.show(`SQ16 · ${c.label}: ${label}`);
  });
  c.onChange(sync);
  sync();
  return b;
}

/** A step's gate-bus chip: click to go off, 1, 2, 3 and round again. */
function gateChip(c: ChoiceControl, step: number, say: Readout): HTMLElement {
  const b = el('button', 'sq-gate');
  b.type = 'button';
  const sync = () => {
    b.textContent = c.value === 'off' ? '·' : c.value;
    b.dataset.bus = c.value;
    b.setAttribute('aria-label', `Step ${step} gate: ${c.value === 'off' ? 'off' : `bus ${c.value}`}`);
  };
  b.addEventListener('click', () => {
    c.set(c.options[(c.options.indexOf(c.value) + 1) % c.options.length]!);
    say.show(`SQ16 · Step ${step} gate: ${c.value === 'off' ? 'OFF' : `BUS ${c.value}`}`);
  });
  c.onChange(sync);
  sync();
  return b;
}

function pushButton(label: string, aria: string, click: () => void, cls = ''): HTMLElement {
  const b = el('button', `sq-push ${cls}`.trim(), label);
  b.type = 'button';
  b.setAttribute('aria-label', aria);
  b.addEventListener('click', click);
  return b;
}

/** The clock readout: its frequency as BPM (one step a sixteenth), or the MIDI division. */
function clockDisplay(d: M2600Synth): HTMLElement {
  const box = el('div', 'm26-readout sq-display');
  const rate = num(d, 'sq.rate'), sync = choice(d, 'sq.sync'), div = choice(d, 'sq.div');
  const paint = () => {
    box.textContent = sync.value === 'midi'
      ? `MIDI CLOCK · ${div.value} STEPS`
      : `${formatValue(rate)} · ${Math.round(rate.value * 15)} BPM`;
  };
  for (const c of [rate, sync, div]) c.onChange(paint);
  paint();
  return box;
}

export function drawSq16(b: Board, d: M2600Synth, say: Readout, lamps: Lamps, y0: number): void {
  const y = (v: number) => y0 + v;
  const mode = choice(d, 'sq.mode');

  // ---- the case: walnut cheeks and a black panel with gold ink
  b.draw(`<rect x="4" y="${y(6)}" width="22" height="288" rx="5" class="sq-wood"/><rect x="${W - 26}" y="${y(6)}" width="22" height="288" rx="5" class="sq-wood"/>`);
  b.draw(`<rect x="26" y="${y(10)}" width="${W - 52}" height="280" rx="4" class="sq-face"/>`);
  b.draw('<g class="sq-ink">');
  b.draw(`<rect x="36" y="${y(18)}" width="${W - 72}" height="264" rx="6" fill="none" stroke-width="1.4"/>`);
  b.text(52, y(48), 'MOA-SQ16', 26, 'start', 'class="m26-logo"');
  b.text(176, y(47), 'SEQUENCER', 13, 'start', 'letter-spacing="3"');
  for (const x of [790, 920, 1150]) b.line(x, y(26), x, y(274), 1.3);

  // ---- clock source, division and the readout across the top
  b.text(300, y(32), 'CLOCK', 7, 'middle');
  const sync = choice(d, 'sq.sync');
  b.place(chip(sync, 'int', 'INT', 'Clock source: internal', say), 286, y(45), 30, 15);
  b.place(chip(sync, 'midi', 'MIDI', 'Clock source: MIDI clock', say), 318, y(45), 32, 15);
  b.text(420, y(32), 'MIDI DIVISION', 7, 'middle');
  const div = choice(d, 'sq.div');
  div.options.forEach((o, i) => b.place(chip(div, o, o, `MIDI division ${o}`, say), 364 + i * 28, y(45), 26, 15));
  b.place(clockDisplay(d), 620, y(45), 200, 18);

  // ---- steps: gate chip, number, slider, lamp
  const gateLabelY = y(64);
  b.text(60, gateLabelY + 3, 'GATE', 6.5, 'start');
  for (let i = 0; i < SQ16_STEPS; i++) {
    const x = i < 8 ? 92 + i * 42 : 448 + (i - 8) * 42;
    b.place(gateChip(choice(d, `sq.gate.${i + 1}`), i + 1, say), x, y(72), 24, 16);
    b.text(x, y(98), String(i + 1), 9, 'middle', 'font-weight="700"');
    b.vslider(num(d, `sq.step.${i + 1}`), 'SQ16', x, y(106), y(214), say);
    const lamp = el('button', 'sq-lamp');
    lamp.type = 'button';
    lamp.setAttribute('aria-label', `Jump to step ${i + 1}`);
    lamp.addEventListener('click', () => {
      d.jumpTo(mode.value === '8x2' ? i % 8 : i);
      say.show(`SQ16 · jumped to step ${i + 1}`);
    });
    lamp.append(led());
    b.place(lamp, x, y(232), 14);
    lamps.add(lamp.firstElementChild as HTMLElement, (v) => {
      const s = v.sq?.step;
      return s !== undefined && (s === i || (mode.value === '8x2' && s + 8 === i));
    });
  }
  b.path(`M80 ${y(246)} H405 M400 ${y(242)} L406 ${y(246)} L400 ${y(250)}`);
  b.text(416, y(249), 'A', 9, 'middle', 'font-weight="700"');
  b.path(`M436 ${y(246)} H761 M756 ${y(242)} L762 ${y(246)} L756 ${y(250)}`);
  b.text(772, y(249), 'B', 9, 'middle', 'font-weight="700"');
  b.text(110, y(264), 'STEPS', 7, 'middle');
  b.place(chip(mode, '16', '16 × 1', '16 steps', say), 150, y(266), 40, 15);
  b.place(chip(mode, '8x2', '8 × 2', '8 steps on A and B together', say), 194, y(266), 40, 15);
  b.text(300, y(264), 'DIRECTION', 7, 'middle');
  const dir = choice(d, 'sq.dir');
  ([['fwd', 'FWD', 'forward'], ['rev', 'REV', 'reverse'], ['pingpong', 'P-P', 'ping-pong'], ['random', 'RND', 'random']] as const)
    .forEach(([o, label, aria], i) => b.place(chip(dir, o, label, `Direction: ${aria}`, say), 350 + i * 36, y(266), 33, 15));
  b.text(560, y(264), 'START/STOP IN', 7, 'middle');
  const trig = choice(d, 'sq.trig');
  b.place(chip(trig, 'trig', 'TRIG', 'Start/stop input toggles on each trigger', say), 620, y(266), 34, 15);
  b.place(chip(trig, 'gate', 'GATE', 'Start/stop input runs while high', say), 656, y(266), 34, 15);

  // ---- gate bus outputs, position 1 and clocked gate 1, along the top of the middle and clock sections
  ([['sq.bus1', 'BUS 1', 812], ['sq.bus2', 'BUS 2', 846], ['sq.bus3', 'BUS 3', 880]] as const)
    .forEach(([id, label, x]) => b.outJack(id, x, y(56), label));
  b.outJack('sq.pos1', 950, y(56), 'POS 1');
  b.outJack('sq.cgate1', 990, y(56), 'CLK GATE 1');

  // ---- step, bus 3 switch, reset
  b.text(820, y(90), 'STEP', 7.5, 'middle');
  b.place(pushButton('', 'Step the sequencer once', () => { d.sequencer('step'); say.show('SQ16 · step'); }), 820, y(112), 30, 26);
  b.jack('sq.stepin', 820, y(146), 'Input: step');
  b.text(880, y(96), 'BUS 3', 7, 'middle');
  b.text(880, y(110), 'SKIP', 6.5, 'middle');
  b.place(rocker(choiceSwitch(choice(d, 'sq.skip'), 'Bus 3 steps: skip, off or reset'), say), 880, y(132), 14, 30);
  b.text(894, y(135), 'OFF', 6.5, 'start');
  b.text(880, y(158), 'RESET', 6.5, 'middle');
  b.text(820, y(178), 'RESET', 7.5, 'middle');
  b.place(pushButton('', 'Reset: the next clock plays step 1', () => { d.sequencer('reset'); say.show('SQ16 · reset'); }), 820, y(200), 30, 26);
  b.jack('sq.resetin', 820, y(234), 'Input: reset');

  // ---- clock: start/stop, run button, frequency, FM, pulse width, clock out
  b.text(950, y(96), 'START', 7, 'middle');
  b.jack('sq.start', 950, y(114), 'Input: start');
  const run = pushButton('RUN', 'Run or stop the sequencer', () => d.sequencer('toggle'), 'sq-run');
  const runLamp = led('sq-run-led');
  run.prepend(runLamp);
  b.place(run, 985, y(160), 52, 40);
  lamps.add(runLamp, (v) => v.sq?.running === true);
  b.text(950, y(208), 'STOP', 7, 'middle');
  b.jack('sq.stop', 950, y(226), 'Input: stop');
  b.text(992, y(208), 'START/STOP', 7, 'middle');
  b.jack('sq.startstop', 992, y(226), 'Input: start/stop');
  ([['sq.rate', 'CLOCK\nFREQ', 1040], ['sq.fm', 'FM', 1080], ['sq.pw', 'PULSE\nWIDTH', 1120]] as const).forEach(([id, label, x]) => {
    b.lines(x, y(90), label, 7);
    b.vslider(num(d, id), 'SQ16 clock', x, y(108), y(204), say);
  });
  b.jack('sq.extclk', 1040, y(226), 'Input: external clock');
  b.text(1040, y(248), 'CLK IN', 6.5, 'middle');
  b.jack('sq.fmin', 1080, y(226), 'Input: clock FM');
  b.text(1080, y(248), 'CLOCK FM', 6.5, 'middle');
  b.jack('sq.pwm', 1120, y(226), 'Input: pulse width modulation');
  b.text(1120, y(248), 'PWM', 6.5, 'middle');
  const clkLed = b.place(led(), 1060, y(56), 8);
  lamps.add(clkLed, (v) => v.sq?.clk === true);
  b.outJack('sq.clk', 1100, y(56), 'CLOCK OUT');

  // ---- quantizers, raw outputs and the MULT
  b.outJack('sq.qa', 1180, y(56), 'QUANT A');
  b.jack('sq.cvin', 1250, y(56), 'Input: CV, added to both quantizers (patch KYBD CV here to transpose)');
  b.text(1250, y(41), 'CV IN', 7.5, 'middle');
  b.outJack('sq.qb', 1320, y(56), 'QUANT B');
  b.path(`M1250 ${y(67)} V${y(78)} M1180 ${y(78)} H1320 M1180 ${y(78)} V${y(67)} M1320 ${y(78)} V${y(67)}`);
  b.box(1158, y(88), 44, 22, 'QUANT\nA', 7);
  b.box(1298, y(88), 44, 22, 'QUANT\nB', 7);
  b.text(1180, y(128), 'INPUT A', 6.5, 'middle');
  b.jack('sq.ina', 1180, y(144), 'Input: quantizer A (normalled to output A)');
  b.text(1320, y(128), 'INPUT B', 6.5, 'middle');
  b.jack('sq.inb', 1320, y(144), 'Input: quantizer B (normalled to output B)');
  b.outJack('sq.a', 1180, y(188), 'SEQ OUT A');
  b.outJack('sq.b', 1320, y(188), 'SEQ OUT B');
  b.path(`M1180 ${y(110)} V${y(133)} M1320 ${y(110)} V${y(133)} M1180 ${y(155)} V${y(170)} M1320 ${y(155)} V${y(170)}`);
  b.text(1250, y(96), 'SCALE', 7, 'middle');
  const scale = choice(d, 'sq.scale');
  ([['chrom', 'CHR'], ['major', 'MAJ'], ['minor', 'MIN'], ['pent', 'PEN'], ['dorian', 'DOR'], ['blues', 'BLU']] as const)
    .forEach(([o, label], i) => b.place(chip(scale, o, label, `Quantizer scale: ${o}`, say), 1232 + (i % 2) * 36, y(110 + Math.floor(i / 2) * 18), 33, 15));
  b.text(1250, y(170), 'RANGE (OCT)', 6.5, 'middle');
  const range = choice(d, 'sq.range');
  range.options.forEach((o, i) => b.place(chip(range, o, o, `Quantizer range: ${o} octaves`, say), 1222 + i * 28, y(184), 26, 15));
  b.text(1250, y(216), 'MULT', 7.5, 'middle');
  [1190, 1230, 1270, 1310].forEach((x, i) => {
    b.jack(`sq.mult.${i + 1}`, x, y(236), 'Mult');
    if (i) b.line(x - 29, y(236), x - 11, y(236));
  });
  b.draw('</g>');
}

/** The sequencer's cards for the stacked layout: transport buttons, settings, and the steps with their gates. */
export function sq16Cards(d: M2600Synth): HTMLElement[] {
  const transport = el('section', 'm26-card');
  transport.append(el('h2', 'm26-card-title', 'MOA-SQ16 SEQUENCER'));
  const row = el('div', 'm26-patch-row');
  row.append(
    pushButton('RUN / STOP', 'Run or stop the sequencer', () => d.sequencer('toggle'), 'sq-mobile-btn'),
    pushButton('STEP', 'Step once', () => d.sequencer('step'), 'sq-mobile-btn'),
    pushButton('RESET', 'Reset to step 1', () => d.sequencer('reset'), 'sq-mobile-btn'),
  );
  transport.append(row, el('p', 'm26-cord-note', 'Patch its outputs into the 2600 in the Patch cords card, e.g. SQ16 · clocked gate 1 → ADSR · GATE IN.'));
  const settings = controlCard(d, 'SQ16 CLOCK & MODES', ['sq.sync', 'sq.div', 'sq.rate', 'sq.fm', 'sq.pw', 'sq.mode', 'sq.dir', 'sq.skip', 'sq.trig', 'sq.scale', 'sq.range']);
  const steps = controlCard(d, 'SQ16 STEPS', Array.from({ length: SQ16_STEPS }, (_, i) => [`sq.step.${i + 1}`, `sq.gate.${i + 1}`]).flat());
  return [transport, settings, steps];
}
