#!/usr/bin/env node
// Claude Slots — standalone demo player (Node ESM, `/slots:demo`).
//
// Plays a whole spin (spin-up -> spinning -> stopping -> outcome -> result)
// in the terminal using the same lib/ engine and sprite sheet the live mod
// uses, at 10 fps through lib/render-ansi.js. Never touches real credits or
// stats: every run is its own throwaway machine state.
//
// Usage:
//   node bin/demo.js [outcome|phase]                (positional, matches commands/demo.md)
//   node bin/demo.js --outcome=life --fps=10 --seed=42 --work=2600
//   node bin/demo.js --phase=spinning --seconds=3   (loop one phase and exit)
//   node bin/demo.js --outcome=client --frames=6    (dump N sampled plain-text frames; for QA)
//
//   outcome: life | client | feature | lose | aborted | error
//   phase:   spinning | win-life | win-client | win-feature | lose | abort | error  (an overlay name loops that overlay)

import * as machine from '../lib/machine.js';
import { renderAnsi } from '../lib/render-ansi.js';
import { frameToPlainText } from '../lib/frame.js';
import { spriteFrame, OVERLAY_FRAME_COUNTS } from '../lib/sprite-frame.js';

const OUTCOME_ALIASES = { life: 'LIFE', client: 'CLIENT', feature: 'FEATURE', lose: 'LOSE', aborted: 'ABORTED', abort: 'ABORTED', error: 'ERROR' };
const PHASES = new Set(['spinning', ...Object.keys(OVERLAY_FRAME_COUNTS)]);

function printHelp() {
  process.stdout.write(`demo.js [outcome|phase]

  outcome   one of: ${Object.keys(OUTCOME_ALIASES).join(', ')} (default: a random spin)
  phase     one of: ${[...PHASES].join(', ')} (loops that phase instead of a full spin)

Flags:
  --outcome=<name>   force an outcome class (or aborted/error to force that stop reason)
  --phase=<name>     loop one phase (reels spinning, or one overlay sequence)
  --fps=<n>          playback frame rate (default 10)
  --seed=<n|string>  seed the RNG explicitly (search starts here when also forcing --outcome)
  --work=<ms>        how long the demo pretends the model is working (default 2600)
  --seconds=<n>      how long a --phase loop plays (default 3)
  --frames=<n>       dump N sampled frames as plain text (no ANSI, no animation) and exit
  --help, -h         show this help

Renders the same engine and sprite sheet the live plugin uses. Never touches real credits or stats.
`);
}

function parseArgs(argv) {
  const args = { outcome: null, phase: null, fps: 10, seed: null, work: 2600, seconds: 3, frames: null, help: false };
  for (const raw of argv) {
    if (raw === '--help' || raw === '-h') args.help = true;
    else if (raw.startsWith('--outcome=')) args.outcome = raw.slice(10);
    else if (raw.startsWith('--phase=')) args.phase = raw.slice(8);
    else if (raw.startsWith('--fps=')) args.fps = Number(raw.slice(6)) || 10;
    else if (raw.startsWith('--seed=')) args.seed = raw.slice(7);
    else if (raw.startsWith('--work=')) args.work = Number(raw.slice(7)) || 2600;
    else if (raw.startsWith('--seconds=')) args.seconds = Number(raw.slice(10)) || 3;
    else if (raw.startsWith('--frames=')) args.frames = Number(raw.slice(9)) || 0;
    else if (Object.prototype.hasOwnProperty.call(OUTCOME_ALIASES, raw)) args.outcome = raw;
    else if (PHASES.has(raw)) args.phase = raw;
    else process.stderr.write(`demo: ignoring unrecognized argument ${JSON.stringify(raw)}\n`);
  }
  return args;
}

function coerceSeed(seed) {
  if (seed == null) return null;
  const n = Number(seed);
  return Number.isFinite(n) && String(n) === String(seed).trim() ? n : seed;
}

/** Find a seed (starting at `from`) whose roll lands in outcome class `cls`. */
function findSeedForClass(cls, from) {
  const start = typeof from === 'number' ? from : 0;
  for (let i = 0; i < 100000; i++) {
    const st = machine.pullLever(machine.createState({}), 0, start + i);
    if (st.outcome.outcomeClass === cls) return start + i;
  }
  return start;
}

function buildRun(args) {
  const forcedClass = args.outcome && OUTCOME_ALIASES[args.outcome];
  const stopReason = forcedClass === 'ABORTED' ? 'aborted' : forcedClass === 'ERROR' ? 'error' : 'answer';
  const wantsClassSearch = forcedClass && forcedClass !== 'ABORTED' && forcedClass !== 'ERROR';
  const requestedSeed = coerceSeed(args.seed);
  const seed = wantsClassSearch ? findSeedForClass(forcedClass, typeof requestedSeed === 'number' ? requestedSeed : 0) : requestedSeed ?? Date.now();

  const state = machine.pullLever(machine.createState({ startCredits: 100 }), 0, seed);
  const stopAt = machine.TIMINGS.spinupMs + Math.max(0, args.work);
  const overlayId = stopReason === 'aborted' ? 'abort' : stopReason === 'error' ? 'error' : { LIFE: 'win-life', CLIENT: 'win-client', FEATURE: 'win-feature', LOSE: 'lose' }[state.outcome.outcomeClass];
  const overlayMs = OVERLAY_FRAME_COUNTS[overlayId] * machine.TIMINGS.overlayFrameMs;
  const tailMs = stopReason === 'answer' ? 2 * machine.TIMINGS.stoppingStaggerMs + machine.TIMINGS.stopMs + overlayMs : overlayMs;
  const endAt = stopAt + tailMs + 600; // a short hold so the final frame reads

  // stop() is applied lazily once sampled time reaches stopAt, exactly like a live turn.
  let stopped = false;
  const applyStopIfDue = (now) => {
    if (!stopped && now >= stopAt) {
      machine.stop(state, stopAt, stopReason);
      stopped = true;
    }
  };
  return { state, endAt, stopAt, applyStopIfDue };
}

/** A frame for a looped phase at `now` (ms). */
function phaseFrame(phase, now) {
  const variant = machine.variantAt(now);
  if (phase === 'spinning') {
    const st = machine.pullLever(machine.createState({ startCredits: 97 }), 0, 1);
    return machine.frame(st, now);
  }
  const frame = Math.floor(now / machine.TIMINGS.overlayFrameMs) % OVERLAY_FRAME_COUNTS[phase];
  return spriteFrame({ variant, offsets: [16, 16, 16], balance: 97, overlay: { id: phase, frame } });
}

function dumpFrames(args) {
  const n = Math.max(1, args.frames);
  const out = [];
  if (args.phase) {
    for (let i = 0; i < n; i++) {
      const now = i * 100;
      out.push(`--- frame ${i + 1}/${n}  t=${now}ms  phase=${args.phase} ---\n${frameToPlainText(phaseFrame(args.phase, now))}`);
    }
  } else {
    const { state, endAt, applyStopIfDue } = buildRun(args);
    for (let i = 0; i < n; i++) {
      const now = n === 1 ? 0 : Math.round((i / (n - 1)) * endAt);
      applyStopIfDue(now);
      out.push(`--- frame ${i + 1}/${n}  t=${now}ms  phase=${machine.phaseAt(state, now).phase}  offsets=${machine.reelOffsets(state, now).join(',')} ---\n${frameToPlainText(machine.frame(state, now))}`);
    }
    applyStopIfDue(endAt);
    out.push(`--- result line ---\n${machine.resultText(state)}`);
  }
  process.stdout.write(out.join('\n\n') + '\n');
}

function playAnimation(args) {
  const intervalMs = Math.max(50, Math.round(1000 / (args.fps || 10)));
  const truecolor = !/^(0|false)$/i.test(process.env.DEMO_TRUECOLOR || '') && (/truecolor|24bit/i.test(process.env.COLORTERM || '') || !process.env.COLORTERM);

  let prevLineCount = 0;
  const draw = (text) => {
    if (prevLineCount > 0) process.stdout.write(`\x1b[${prevLineCount}F\x1b[0J`);
    process.stdout.write(text + '\n');
    prevLineCount = text.split('\n').length;
  };
  let cleaned = false;
  const cleanup = () => {
    if (cleaned) return;
    cleaned = true;
    process.stdout.write('\x1b[?25h');
  };
  process.on('exit', cleanup);
  process.on('SIGINT', () => {
    cleanup();
    process.exit(130);
  });
  process.stdout.write('\x1b[?25l');
  const t0 = Date.now();

  if (args.phase) {
    const endAt = args.seconds * 1000;
    const timer = setInterval(() => {
      const now = Date.now() - t0;
      draw(renderAnsi(phaseFrame(args.phase, now), { truecolor }));
      if (now >= endAt) {
        clearInterval(timer);
        cleanup();
      }
    }, intervalMs);
    return;
  }

  const { state, endAt, applyStopIfDue } = buildRun(args);
  const timer = setInterval(() => {
    const now = Date.now() - t0;
    applyStopIfDue(now);
    draw(renderAnsi(machine.frame(state, now), { truecolor }));
    if (now >= endAt) {
      clearInterval(timer);
      applyStopIfDue(endAt);
      draw(renderAnsi(machine.frame(state, endAt), { truecolor }));
      process.stdout.write(renderAnsi(machine.resultLine(state), { truecolor }) + '\n');
      cleanup();
    }
  }, intervalMs);
}

function main() {
  const args = parseArgs(process.argv.slice(2));
  if (args.help) return printHelp();
  if (args.phase && !PHASES.has(args.phase)) {
    process.stderr.write(`demo: unknown phase ${JSON.stringify(args.phase)}; one of ${[...PHASES].join(', ')}\n`);
    process.exit(2);
  }
  if (args.frames && args.frames > 0) return dumpFrames(args);
  playAnimation(args);
}

main();
