#!/usr/bin/env node
// Claude Slots — Tier 2 statusLine renderer (docs/ARCHITECTURE.md §5).
//
// Invoked by Claude Code roughly once per second (`refreshInterval: 1`,
// set by /claude-slots:setup). Must be fast (<50ms of OUR OWN work — the
// optional previous-statusline passthrough below is explicitly allowed up
// to 400ms since we don't control how slow the user's own command is; see
// that section for why the two numbers don't contradict each other) and
// must never throw: a statusline script that throws shows nothing, so
// everything is wrapped and any failure degrades to printing nothing rather
// than a stack trace.
//
// Flow: read stdin JSON synchronously (fast — proven live in
// scratchpad/spike/sl-plugin/scripts/statusline.js, ~2-3ms per call) + env
// COLUMNS/COLORTERM -> read this session's state file written by
// bin/claude-slots-hook.js -> machine.frame(state, Date.now(), ...) -> ANSI.
//
// No local animation/tick state is kept here on purpose (ART-SPEC §11's
// "design for discrete states, not motion-blur continuity"): every call
// recomputes straight from wall-clock time via the exact same
// lib/machine.js phase function Tier 1 uses, just sampled ~10x less often.
// A few sub-second sub-phases (STOPPING's per-reel lock steps, REVEAL) can
// in principle fall between two ~1s samples and never get painted — this is
// an accepted, documented trade-off of sharing one timing model across both
// tiers (see docs/ARCHITECTURE.md's "both tiers... just sample at different
// rates") rather than forking a second, slower timing table Tier 1 doesn't
// use; the OUTCOME/RESULT frames that carry the actual information (label,
// payout, credits) last 1.5-4s and are never missed in practice.

import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';
import * as machine from '../lib/machine.js';
import { renderAnsi } from '../lib/render-ansi.js';
import { span } from '../lib/frame.js';
import { COLORS } from '../lib/symbols.js';
import { displayWidth, truncate } from '../lib/width.js';

const PASSTHROUGH_TIMEOUT_MS = 400;
const PLUGIN_ROOT = path.dirname(path.dirname(fileURLToPath(import.meta.url)));

// --------------------------------------------------------------------------
// opt-in diagnostics — off (zero cost) unless CLAUDE_SLOTS_DIAG_LOG names a
// file to append JSON-lines event records to. Mirrors bin/claude-slots-hook.js's
// own diagLog; see that file's header for why this stays as a permanent,
// harmless-when-unset debugging aid. Never touches stdout — appending here
// can never corrupt the actual statusline output.
// --------------------------------------------------------------------------

const DIAG_ENABLED = !!process.env.CLAUDE_SLOTS_DIAG_LOG;

function diagLog(obj) {
  if (!DIAG_ENABLED) return;
  try {
    fs.appendFileSync(process.env.CLAUDE_SLOTS_DIAG_LOG, JSON.stringify({ ts: Date.now(), src: 'statusline', ...obj }) + '\n');
  } catch {
    /* ignore */
  }
}

// --------------------------------------------------------------------------
// fast synchronous stdin
// --------------------------------------------------------------------------

function readStdinSync() {
  try {
    return fs.readFileSync(0, 'utf8');
  } catch {
    return '';
  }
}

function safeParseJson(raw) {
  if (!raw || !raw.trim()) return null;
  try {
    return JSON.parse(raw);
  } catch {
    return null;
  }
}

// --------------------------------------------------------------------------
// paths (mirrors bin/claude-slots-hook.js and bin/claude-slots-setup.js)
// --------------------------------------------------------------------------

/**
 * The statusLine command is a plain settings.json shell command, not a
 * plugin hook — verified live that Claude Code does NOT set
 * CLAUDE_PLUGIN_DATA/CLAUDE_PLUGIN_ROOT for it. So: prefer the env var in
 * case that ever changes, else read the pointer file
 * bin/claude-slots-hook.js maintains (see that file's header) at
 * `<pluginRoot>/.claude-slots-runtime/plugin-data-dir.txt` — both scripts
 * derive the same `pluginRoot` from their own `import.meta.url`, so this
 * needs no configuration and survives however the plugin was loaded. Only
 * falls through to the bare default if the hook has genuinely never run
 * yet (e.g. the very first statusline tick before SessionStart lands).
 */
function pluginDataDir() {
  if (process.env.CLAUDE_PLUGIN_DATA) return process.env.CLAUDE_PLUGIN_DATA;
  try {
    const pointerPath = path.join(PLUGIN_ROOT, '.claude-slots-runtime', 'plugin-data-dir.txt');
    const fromPointer = fs.readFileSync(pointerPath, 'utf8').trim();
    if (fromPointer) return fromPointer;
  } catch {
    // hook.js hasn't recorded one yet — fall through to the default below
  }
  return path.join(os.homedir(), '.claude', 'plugins', 'data', 'claude-slots');
}
function sessionFilePath(sessionId) {
  return path.join(pluginDataDir(), 'sessions', `${sessionId}.json`);
}
function economyFilePath() {
  return path.join(pluginDataDir(), 'economy.json');
}
function configFilePath() {
  return path.join(pluginDataDir(), 'config.json');
}

function readJsonSafe(p) {
  try {
    const raw = fs.readFileSync(p, 'utf8');
    if (!raw.trim()) return null;
    return JSON.parse(raw);
  } catch {
    return null;
  }
}

// --------------------------------------------------------------------------
// previous user statusLine passthrough (saved by bin/claude-slots-setup.js)
// --------------------------------------------------------------------------

/**
 * bin/claude-slots-setup.js saves the user's pre-existing statusLine config
 * under the `statusLine` key of config.json (the task brief's own prose
 * calls it `previousStatusLine` — we accept either key defensively in case
 * that ever changes). Only a `{type:'command', command:string}` shape is
 * runnable; anything else (null, or some future non-command type) is
 * skipped silently.
 */
function previousStatuslineCommand(config) {
  const prev = (config && (config.previousStatusLine || config.statusLine)) || null;
  if (prev && prev.type === 'command' && typeof prev.command === 'string' && prev.command.trim()) {
    return prev.command;
  }
  return null;
}

function runPreviousStatusline(command, stdinRaw) {
  try {
    const result = spawnSync('sh', ['-c', command], {
      input: stdinRaw || '',
      encoding: 'utf8',
      timeout: PASSTHROUGH_TIMEOUT_MS,
      env: process.env,
    });
    if (result.error || result.status !== 0) return null;
    const out = (result.stdout || '').replace(/\s+$/u, '');
    return out.length ? out : null;
  } catch {
    return null;
  }
}

// --------------------------------------------------------------------------
// tier-1-active companion line
// --------------------------------------------------------------------------

const RESULT_LABELS = {
  JACKPOT: 'JACKPOT',
  MEDALLION: 'SIGNATURE',
  TRIPLE: 'TRIPLE',
  DOUBLE: 'DOUBLE',
  NEAR_MISS: 'so close',
  LOSE: 'no win',
  ABORTED: 'interrupted',
  ERROR: 'error',
};

function lastResultLabel(economy) {
  const recent = economy && economy.stats && economy.stats.recent;
  const last = recent && recent[0];
  if (!last) return '--';
  const label = RESULT_LABELS[last.outcomeClass] || last.outcomeClass;
  return economy.lastWin > 0 ? `${label} +${economy.lastWin}` : label;
}

/** The real animated machine is in Tier 1's Spinner/TurnDuration — this is
 * just a minimal companion line so the statusline isn't blank. Unlike
 * idleEconomyFrame/the full-machine path (which both route through
 * machine.frame()'s size/columns machinery), this builds its own Frame by
 * hand, so it must clamp to `columns` itself — defensively truncating the
 * variable `rest` field the same way pushInfoStrip() in lib/art.js does,
 * never throwing, so a narrow terminal never overflows. */
function tier1CompanionFrame(economy, columns) {
  const title = '✻';
  const fullRest = ` · credits ${Math.max(0, Math.trunc(economy.credits))} · last: ${lastResultLabel(economy)}`;
  const maxWidth = Number.isFinite(columns) && columns > 0 ? columns : title.length + fullRest.length;
  const shownTitle = displayWidth(title) > maxWidth ? truncate(title, maxWidth) : title;
  const restBudget = Math.max(0, maxWidth - displayWidth(shownTitle));
  const rest = displayWidth(fullRest) > restBudget ? truncate(fullRest, restBudget) : fullRest;
  return {
    width: displayWidth(shownTitle) + displayWidth(rest),
    lines: [[span(shownTitle, { color: COLORS.wordmark.hex, bold: true }), span(rest, { color: COLORS.infoText.hex })]],
  };
}

// --------------------------------------------------------------------------
// main
// --------------------------------------------------------------------------

function resolveTruecolor() {
  // Matches bin/claude-slots-demo.js's own resolution exactly: an absent
  // COLORTERM (common on real terminals/multiplexers/SSH sessions — this
  // script's own LIVE TEST RECIPE always sets it explicitly, which is why a
  // `!ct -> true` default previously slipped through unnoticed) degrades to
  // the 256-color fallback, per docs/ARCHITECTURE.md §2's documented
  // contract, instead of assuming truecolor support that may not be there.
  return /truecolor|24bit/i.test(process.env.COLORTERM || '');
}

function resolveColumns() {
  const n = Number.parseInt(process.env.COLUMNS, 10);
  return Number.isFinite(n) && n > 0 ? n : 80;
}

function idleEconomyFrame(columns, truecolor) {
  const seed = readJsonSafe(economyFilePath());
  const st = machine.createState({});
  if (seed && Number.isFinite(seed.credits)) {
    st.economy.credits = Math.max(0, seed.credits);
    st.economy.lastWin = Number.isFinite(seed.lastWin) ? seed.lastWin : 0;
    if (seed.stats) st.economy.stats = seed.stats;
  }
  const fr = machine.frame(st, Date.now(), { size: 'auto', columns, info: {} });
  return renderAnsi(fr, { truecolor });
}

function main() {
  const stdinRaw = readStdinSync();
  const stdin = safeParseJson(stdinRaw);
  const sessionId = stdin && stdin.session_id;
  const columns = resolveColumns();
  const truecolor = resolveTruecolor();
  const now = Date.now();
  if (DIAG_ENABLED) {
    diagLog({ sessionId, columns, truecolor, stdinKeys: stdin ? Object.keys(stdin) : null, pluginDataDir: pluginDataDir(), envHasPluginData: 'CLAUDE_PLUGIN_DATA' in process.env, envHasPluginRoot: 'CLAUDE_PLUGIN_ROOT' in process.env });
  }

  const outputLines = [];

  const config = readJsonSafe(configFilePath());
  const prevCmd = previousStatuslineCommand(config);
  if (prevCmd) {
    const prevOut = runPreviousStatusline(prevCmd, stdinRaw);
    if (prevOut) outputLines.push(prevOut);
  }

  const session = sessionId ? readJsonSafe(sessionFilePath(sessionId)) : null;

  if (!session || !session.machine) {
    diagLog({ sessionId, branch: 'no-session' });
    outputLines.push(idleEconomyFrame(columns, truecolor));
    process.stdout.write(outputLines.join('\n') + '\n');
    return;
  }

  diagLog({ sessionId, branch: session.tier1 ? 'tier1-companion' : 'full-machine', tier1: session.tier1, phase_leverAt: session.machine.leverAt, phase_stopAt: session.machine.stopAt });

  if (session.tier1) {
    if (config && config.suppressStatuslineWhenTier1 === true) {
      // "or nothing if config says so" — an explicit opt-out for users who
      // find the companion line redundant with Tier 1's real animation.
      process.stdout.write(outputLines.join('\n') + (outputLines.length ? '\n' : ''));
      return;
    }
    outputLines.push(renderAnsi(tier1CompanionFrame(session.machine.economy, columns), { truecolor }));
    process.stdout.write(outputLines.join('\n') + '\n');
    return;
  }

  const st = session.machine;
  const elapsedMs = st.leverAt != null ? Math.max(0, now - st.leverAt) : 0;
  const tokens = session.tokensThisTurn || 0;
  const fr = machine.frame(st, now, { size: 'auto', columns, info: { elapsedMs, tokens } });
  outputLines.push(renderAnsi(fr, { truecolor }));
  process.stdout.write(outputLines.join('\n') + '\n');
}

// Opt-in self-timing for tests/benchmarks (tests/tier2.test.js sets this env
// var): writes one line to stderr, never stdout, so it can never corrupt
// the actual statusline output. Zero cost in normal operation (the env var
// is unset, so this whole block is skipped).
const __debugTiming = process.env.CLAUDE_SLOTS_DEBUG_TIMING === '1';
const __t0 = __debugTiming ? process.hrtime.bigint() : null;

try {
  main();
} catch {
  // A statusline that throws shows nothing — print nothing rather than a
  // stack trace so the prompt line never breaks.
}

if (__debugTiming) {
  try {
    const ms = Number(process.hrtime.bigint() - __t0) / 1e6;
    process.stderr.write(`claude-slots-statusline: ${ms.toFixed(3)}ms\n`);
  } catch {
    /* ignore */
  }
}
