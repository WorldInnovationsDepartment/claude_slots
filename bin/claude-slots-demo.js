#!/usr/bin/env node
// Claude Slots — standalone demo renderer (Node ESM, `/claude-slots:demo`).
//
// Plays the whole lifecycle (idle -> lever -> spin-up -> spinning -> stopping
// -> reveal -> outcome -> result) in the terminal using the same lib/ engine
// the live plugin uses, at a fixed frame rate, via render-ansi.js. Never
// touches real credits/stats — every run is its own throwaway machine state.
//
// Usage:
//   node bin/claude-slots-demo.js [outcome] [size]                 (positional, matches commands/demo.md)
//   node bin/claude-slots-demo.js --outcome=jackpot --size=grand --fps=10 --seed=42
//   node bin/claude-slots-demo.js --outcome=jackpot --frames=6     (dump N sampled plain-text frames and exit; for QA)
//
//   outcome: jackpot | medallion | triple | double | nearmiss | near-miss | lose | aborted | error
//   size:    auto (default) | compact | standard | grand
//   --help / -h prints this usage and exits.

import * as machine from '../lib/machine.js';
import { renderAnsi } from '../lib/render-ansi.js';
import { frameToPlainText } from '../lib/frame.js';

const OUTCOME_ALIASES = {
  jackpot: 'JACKPOT', medallion: 'MEDALLION', triple: 'TRIPLE', double: 'DOUBLE',
  nearmiss: 'NEAR_MISS', 'near-miss': 'NEAR_MISS', lose: 'LOSE', aborted: 'ABORTED', error: 'ERROR',
};
const SIZE_NAMES = new Set(['auto', 'compact', 'standard', 'grand']);

function printHelp() {
  process.stdout.write(`claude-slots-demo.js [outcome] [size]

  outcome   one of: ${Object.keys(OUTCOME_ALIASES).join(', ')} (default: a random spin)
  size      one of: compact, standard, grand (default: auto, from terminal width)

Flags (equivalent to the positional form above):
  --outcome=<name>   force an outcome class (or 'aborted'/'error' to force that stop reason)
  --size=<name>      force chassis size
  --fps=<n>          playback frame rate (default 10, ignored with --frames)
  --seed=<n|string>  seed the RNG explicitly (search starts here when also forcing --outcome)
  --frames=<n>       dump N sampled frames as plain text (no ANSI, no animation) and exit — for QA
  --help, -h         show this help

Renders a short standalone slot-machine animation using the same engine the
live plugin uses. Never touches real credits or stats.
`);
}

function parseArgs(argv) {
  const args = { outcome: null, size: 'auto', fps: 10, seed: null, frames: null, help: false };
  for (const raw of argv) {
    if (raw === '--help' || raw === '-h') args.help = true;
    else if (raw.startsWith('--outcome=')) args.outcome = raw.slice('--outcome='.length);
    else if (raw.startsWith('--size=')) args.size = raw.slice('--size='.length);
    else if (raw.startsWith('--fps=')) args.fps = Number(raw.slice('--fps='.length)) || 10;
    else if (raw.startsWith('--seed=')) args.seed = raw.slice('--seed='.length);
    else if (raw.startsWith('--frames=')) args.frames = Number(raw.slice('--frames='.length)) || 0;
    else if (Object.prototype.hasOwnProperty.call(OUTCOME_ALIASES, raw)) args.outcome = raw;
    else if (SIZE_NAMES.has(raw)) args.size = raw;
    else process.stderr.write(`claude-slots-demo: ignoring unrecognized argument ${JSON.stringify(raw)}\n`);
  }
  return args;
}

function coerceSeed(seed) {
  if (seed == null) return null;
  const n = Number(seed);
  return Number.isFinite(n) && String(n) === String(seed).trim() ? n : seed;
}

/** Find a seed (starting at `from`) whose rollOutcome() lands in outcome class `cls`. */
function findSeedForClass(cls, from) {
  const start = typeof from === 'number' ? from : 0;
  for (let i = 0; i < 50000; i++) {
    const seed = start + i;
    const st = machine.pullLever(machine.createState({}), 0, seed);
    if (st.outcome.outcomeClass === cls) return seed;
  }
  return start; // fall back to whatever that seed rolls, rather than failing the demo
}

const LEVER_MS = machine.TIMINGS.leverMs;
const SPINUP_MS = machine.TIMINGS.spinupMs;
const SPIN_WORK_MS = 2600; // how long this demo pretends the model is "working"

function buildRun(args) {
  const forcedClass = args.outcome && OUTCOME_ALIASES[args.outcome];
  const stopReason = forcedClass === 'ABORTED' ? 'aborted' : forcedClass === 'ERROR' ? 'error' : 'answer';
  const wantsClassSearch = forcedClass && forcedClass !== 'ABORTED' && forcedClass !== 'ERROR';
  const requestedSeed = coerceSeed(args.seed);
  const seed = wantsClassSearch ? findSeedForClass(forcedClass, typeof requestedSeed === 'number' ? requestedSeed : 0) : requestedSeed ?? Date.now();

  const now0 = 0;
  let state = machine.createState({ startCredits: 100 });
  state = machine.pullLever(state, now0, seed);
  const stopAt = LEVER_MS + SPINUP_MS + SPIN_WORK_MS;

  // `rollOutcome()` already ran inside pullLever(), so the outcome class/tier
  // (and therefore every downstream duration) is known without calling
  // machine.stop() yet.
  const outcomeTotal = state.outcome
    ? typeof machine.TIMINGS.outcomeMs === 'function'
      ? machine.TIMINGS.outcomeMs(state.outcome.outcomeClass, state.outcome.tier)
      : 2000
    : 2000;
  const jamTotal = Math.max(machine.TIMINGS.jamMs, machine.TIMINGS.malfunctionMs);
  const tailMs = stopReason === 'answer' ? 2 * machine.TIMINGS.stoppingStaggerMs + machine.TIMINGS.revealMs + outcomeTotal : jamTotal;
  const endAt = stopAt + tailMs + 900; // + a short RESULT hold so the final frame reads clearly

  // IMPORTANT: machine.stop() must not be called until simulated/real `now`
  // has actually reached `stopAt`. phaseAt() prioritizes a recorded stop over
  // an in-progress LEVER/SPINUP/SPINNING window *whenever state.stopAt is
  // non-null*, with no guard for a `now` that is still earlier than that
  // stopAt (nor does it need one — real Tier 1/2 callers only ever call
  // stop() once real wall-clock time has reached it, so `now` is monotonic
  // and never rewinds past it). Calling stop() eagerly here — as an earlier
  // version of this demo did — would make every sampled frame from t=0
  // onward see a *future* stopAt against an *earlier* queried `now`, jump
  // straight into STOPPING with a permanently-negative `t`, and never show
  // LEVER, SPINUP, or SPINNING at all. Instead, defer the call and apply it
  // lazily the first time sampling reaches stopAt, exactly like a live turn.
  let stopped = false;
  const applyStopIfDue = (now) => {
    if (!stopped && now >= stopAt) {
      machine.stop(state, stopAt, stopReason);
      stopped = true;
    }
  };

  return { state, now0, endAt, stopAt, applyStopIfDue };
}

function resolveSize(size, columns) {
  if (size !== 'auto') return size;
  return columns >= 90 ? 'grand' : columns >= 62 ? 'standard' : 'compact';
}

function dumpFrames(args) {
  const { state, endAt, applyStopIfDue } = buildRun(args);
  const columns = Number(process.env.COLUMNS) || process.stdout.columns || 80;
  const size = resolveSize(args.size, columns);
  const n = Math.max(1, args.frames);
  const out = [];
  for (let i = 0; i < n; i++) {
    const now = n === 1 ? 0 : Math.round((i / (n - 1)) * endAt);
    applyStopIfDue(now);
    const fr = machine.frame(state, now, { size, columns, info: { elapsedMs: now, tokens: Math.round(now * 1.3), mode: 'thinking' } });
    const p = machine.phaseAt(state, now);
    out.push(`--- frame ${i + 1}/${n}  t=${now}ms  phase=${p.phase} ---\n${frameToPlainText(fr)}`);
  }
  applyStopIfDue(endAt); // make sure stop() has landed before computing the final result line
  out.push(`--- result line ---\n${frameToPlainText(machine.resultLine(state, { columns }))}`);
  process.stdout.write(out.join('\n\n') + '\n');
}

function playAnimation(args) {
  const { state, endAt, applyStopIfDue } = buildRun(args);
  const columns = Number(process.env.COLUMNS) || process.stdout.columns || 80;
  const size = resolveSize(args.size, columns);
  const intervalMs = Math.max(50, Math.round(1000 / (args.fps || 10)));
  const truecolor = /truecolor|24bit/i.test(process.env.COLORTERM || '');

  const hideCursor = () => process.stdout.write('\x1b[?25l');
  const showCursor = () => process.stdout.write('\x1b[?25h');
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
    showCursor();
  };
  process.on('exit', cleanup);
  process.on('SIGINT', () => {
    cleanup();
    process.exit(130);
  });

  hideCursor();
  const t0 = Date.now();
  const timer = setInterval(() => {
    const now = Date.now() - t0;
    applyStopIfDue(now);
    const fr = machine.frame(state, now, { size, columns, info: { elapsedMs: now, tokens: Math.round(now * 1.3), mode: 'thinking' } });
    draw(renderAnsi(fr, { truecolor }));
    if (now >= endAt) {
      clearInterval(timer);
      applyStopIfDue(endAt);
      draw(renderAnsi(machine.frame(state, endAt, { size, columns, info: { elapsedMs: endAt } }), { truecolor }));
      process.stdout.write('\n' + renderAnsi(machine.resultLine(state, { columns }), { truecolor }) + '\n');
      cleanup();
    }
  }, intervalMs);
}

function main() {
  const args = parseArgs(process.argv.slice(2));
  if (args.help) {
    printHelp();
    return;
  }
  if (args.frames && args.frames > 0) {
    dumpFrames(args);
    return;
  }
  playAnimation(args);
}

main();
