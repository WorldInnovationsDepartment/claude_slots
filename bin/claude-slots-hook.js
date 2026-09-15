#!/usr/bin/env node
// Claude Slots — Tier 2 classic command-hook driver (docs/ARCHITECTURE.md §5).
//
// Registered in hooks/hooks.json for UserPromptSubmit, MessageDisplay,
// PostToolUse, Stop (async: true) and SessionStart, SessionEnd (blocking,
// but still generous 10s timeouts). Drives the shared lib/machine.js state
// machine from wall-clock hook events and persists it to a per-session JSON
// file so bin/claude-slots-statusline.js can render it at 1fps.
//
// State file: ${CLAUDE_PLUGIN_DATA}/sessions/<session_id>.json (fallback
// ~/.claude/plugins/data/claude-slots/sessions/<session_id>.json when the
// env var is absent — matches bin/claude-slots-setup.js's own fallback).
// Written atomically (tmp file + rename) so a concurrent statusline read
// (or a crash mid-write) never sees a half-written file.
//
// IMPORTANT, verified live (see notes_for_integrator): Claude Code sets
// CLAUDE_PLUGIN_DATA/CLAUDE_PLUGIN_ROOT for *hook* commands (this script),
// but the statusLine command is a plain settings.json shell command with no
// plugin-runtime env injected at all — bin/claude-slots-statusline.js never
// sees CLAUDE_PLUGIN_DATA. If both scripts only used
// `process.env.CLAUDE_PLUGIN_DATA || <hardcoded fallback>`, the statusline
// would silently read/write a DIFFERENT directory than this hook does and
// would never find a session (confirmed live: a real run produced
// ~/.claude/plugins/data/claude-slots-inline/sessions/<id>.json from this
// hook while the statusline kept falling back to
// ~/.claude/plugins/data/claude-slots/, which never existed). The fix:
// whenever this hook DOES see a real CLAUDE_PLUGIN_DATA, it records the
// resolved path into a tiny pointer file next to this script
// (`<pluginRoot>/.claude-slots-runtime/plugin-data-dir.txt`) —
// bin/claude-slots-statusline.js derives the same `pluginRoot` from its own
// `import.meta.url` (fair game in bin/, unlike lib/) and reads that pointer
// when the env var isn't set, so both scripts agree on one real directory
// with zero configuration and no dependency on Claude Code's internal
// plugin-data-directory naming (which differs by how the plugin was
// loaded — "-inline" for --plugin-dir, something else for a marketplace
// install).
//
// Cross-session continuity: ${CLAUDE_PLUGIN_DATA}/economy.json holds the
// last-known {credits, lastWin, stats} and seeds a brand-new session's
// economy on SessionStart; it is refreshed every time a spin resolves
// (Stop). Nothing in ART-SPEC.md §10 requires this, but nothing forbids it
// either, and it makes credits feel persistent across `/clear`/new windows
// instead of always resetting to 100.
//
// Tier 1 coexistence: per docs/ARCHITECTURE.md §4/§6, the function-hooks
// module (hooks/slots.js) marks a session it is actively driving by writing
// `$.store.set('tier1', {sessions: {[sessionId]: nowMs}})`. `$.store`
// persists to a JSON file under ~/.claude/plugins/store/ named
// `<plugin-name>_<load-kind>-<hash>.json` (observed convention — see
// bin/claude-slots-stats.js's own comment and the fh-spike capture this was
// verified against: `fh-spike_inline-faecb682432f.json`). We don't know the
// exact `<load-kind>-<hash>` suffix Claude Code will pick for THIS plugin's
// load, so we glob every `claude-slots*.json` file in that directory and
// check each one for a `tier1.sessions[<our session id>]` entry. If found,
// Tier 1 owns this session's economy/animation and we must never
// double-charge or double-pay — we still track lightweight bookkeeping
// (lastActivityAt, turnActive) so the statusline can print its minimal
// companion line, but skip pullLever/stop's economic side effects entirely.
//
// KNOWN LIMITATION — aborted/error detection: the classic Stop hook's stdin
// carries no field distinguishing a normal completion from an Esc-aborted
// or errored turn. Verified live (spike capture
// scratchpad/spike/sl-events-fullscreen.jsonl): a real Stop event's stdin is
// exactly `{session_id, transcript_path, cwd, scratchpad_dir, prompt_id,
// permission_mode, hook_event_name:"Stop", stop_hook_active,
// last_assistant_message, background_tasks, session_crons}` — no
// `reason`/`aborted`/`error` field anywhere, and `stop_hook_active` is a
// hook-loop-continuation guard, not an abort signal. Only Tier 1's
// `turn.complete.reason` (function hooks) can see a real abort/error.
// Per the task brief's own guidance ("if not distinguishable... treat as
// normal"), Tier 2 therefore ALWAYS resolves Stop as reason='answer' — we
// deliberately do not guess "aborted" from timing (a fast Stop can just as
// easily be a fast real answer, and a wrong guess is worse than none). The
// practical effect: a user running Tier 2 alone who presses Esc will see a
// normal outcome animation resolve instead of the JAM/"INTERRUPTED" one;
// enabling Tier 1 (CLAUDE_CODE_ENABLE_FUNCTION_HOOKS=1) is what's needed
// for the real interrupt/error storyboards (§8.13-§8.14).
//
// Every event handler is wrapped so nothing here can ever throw past
// main(), block the CLI, or write to stdout (UserPromptSubmit's stdout
// would otherwise reach the model as if it were part of the prompt).

import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { fileURLToPath } from 'node:url';
import * as machine from '../lib/machine.js';
import { hashSeed } from '../lib/rng.js';

const PLUGIN_ROOT = path.dirname(path.dirname(fileURLToPath(import.meta.url)));

const SESSION_MAX_AGE_MS = 2 * 24 * 60 * 60 * 1000; // 2 days (task spec)
const HOOK_HARD_TIMEOUT_MS = 8000; // stay under hooks.json's 10s timeout

// --------------------------------------------------------------------------
// opt-in diagnostics — off (zero cost) unless CLAUDE_SLOTS_DIAG_LOG names a
// file to append JSON-lines event records to. Never touches stdout/stderr;
// this is what let the live-verification pass in notes_for_integrator catch
// two real bugs (the CLAUDE_PLUGIN_DATA mismatch and the tier1-marker race)
// with hard evidence instead of guesswork, so it stays as a permanent,
// harmless-when-unset debugging aid rather than being stripped back out.
// --------------------------------------------------------------------------

const DIAG_ENABLED = !!process.env.CLAUDE_SLOTS_DIAG_LOG;

function diagLog(obj) {
  if (!DIAG_ENABLED) return;
  try {
    fs.appendFileSync(process.env.CLAUDE_SLOTS_DIAG_LOG, JSON.stringify({ ts: Date.now(), ...obj }) + '\n');
  } catch {
    /* ignore */
  }
}

// --------------------------------------------------------------------------
// stdin
// --------------------------------------------------------------------------

/** Read all of stdin as a string, resolving with '' if nothing arrives. */
function readStdin() {
  return new Promise((resolve) => {
    let data = '';
    try {
      if (process.stdin.isTTY) {
        resolve('');
        return;
      }
      process.stdin.setEncoding('utf8');
      process.stdin.on('data', (chunk) => {
        data += chunk;
      });
      process.stdin.on('end', () => resolve(data));
      process.stdin.on('error', () => resolve(data));
    } catch {
      resolve(data);
    }
  });
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
// paths
// --------------------------------------------------------------------------

function pluginDataDirPointerPath() {
  return path.join(PLUGIN_ROOT, '.claude-slots-runtime', 'plugin-data-dir.txt');
}

/** See the file header's "IMPORTANT" note: records the real CLAUDE_PLUGIN_DATA this hook was actually given, so the statusline (which never receives it) can find the same directory. Best-effort, cheap, only writes when the value actually changed.
 * Test-only seam: tests/tier2.test.js sets CLAUDE_SLOTS_TEST_NO_POINTER=1 so
 * running the suite (which uses its own temp CLAUDE_PLUGIN_DATA dirs) never
 * clobbers this real, machine-wide pointer file for a concurrent live
 * session that's actually using this plugin install right now. */
function recordPluginDataDirPointer(dir) {
  if (process.env.CLAUDE_SLOTS_TEST_NO_POINTER === '1') return;
  try {
    const p = pluginDataDirPointerPath();
    const existing = fs.existsSync(p) ? fs.readFileSync(p, 'utf8').trim() : null;
    if (existing === dir) return;
    fs.mkdirSync(path.dirname(p), { recursive: true });
    fs.writeFileSync(p, dir, 'utf8');
  } catch {
    // best-effort only — the statusline still has its own hardcoded fallback
  }
}

function pluginDataDir() {
  const fromEnv = process.env.CLAUDE_PLUGIN_DATA;
  if (fromEnv) {
    recordPluginDataDirPointer(fromEnv);
    return fromEnv;
  }
  return path.join(os.homedir(), '.claude', 'plugins', 'data', 'claude-slots');
}
function sessionsDir() {
  return path.join(pluginDataDir(), 'sessions');
}
function sessionFilePath(sessionId) {
  return path.join(sessionsDir(), `${sessionId}.json`);
}
function economyFilePath() {
  return path.join(pluginDataDir(), 'economy.json');
}
function tier1StoreDir() {
  // Test-only seam: lets tests/tier2.test.js point this at a temp directory
  // instead of the real ~/.claude/plugins/store, so verifying the Tier 1
  // marker-skip path never has to write under the user's real ~/.claude.
  // Unset in every normal (production) invocation, so real usage always
  // resolves to the real store directory below.
  return process.env.CLAUDE_SLOTS_TEST_TIER1_STORE_DIR || path.join(os.homedir(), '.claude', 'plugins', 'store');
}

// --------------------------------------------------------------------------
// safe JSON file IO
// --------------------------------------------------------------------------

function readJsonSafe(p) {
  try {
    const raw = fs.readFileSync(p, 'utf8');
    if (!raw.trim()) return null;
    return JSON.parse(raw);
  } catch {
    return null;
  }
}

/** tmp-file + rename so a reader never observes a partial write. */
function writeJsonAtomic(p, value) {
  try {
    fs.mkdirSync(path.dirname(p), { recursive: true });
    const tmp = `${p}.tmp-${process.pid}-${Date.now()}-${Math.random().toString(36).slice(2)}`;
    fs.writeFileSync(tmp, JSON.stringify(value), 'utf8');
    fs.renameSync(tmp, p);
  } catch {
    // Persistence is best-effort — a failed write must never crash the hook.
  }
}

// --------------------------------------------------------------------------
// Tier 1 marker discovery
// --------------------------------------------------------------------------

/** True if hooks/slots.js's `$.store` marks `sessionId` as Tier-1-active. */
function isTier1Active(sessionId) {
  try {
    const dir = tier1StoreDir();
    const files = fs.readdirSync(dir).filter((f) => f.startsWith('claude-slots') && f.endsWith('.json'));
    for (const f of files) {
      const data = readJsonSafe(path.join(dir, f));
      const ts = data && data.tier1 && data.tier1.sessions && data.tier1.sessions[sessionId];
      if (ts) return true;
    }
  } catch {
    // No store dir yet (Tier 1 never ran) — not active.
  }
  return false;
}

// --------------------------------------------------------------------------
// session record
// --------------------------------------------------------------------------

function loadEconomySeed() {
  const data = readJsonSafe(economyFilePath());
  if (data && typeof data === 'object' && Number.isFinite(data.credits)) return data;
  return null;
}

function newSessionRecord(sessionId, now) {
  const st = machine.createState({});
  const seed = loadEconomySeed();
  if (seed) {
    st.economy.credits = Math.max(0, Number(seed.credits) || 0);
    st.economy.lastWin = Number.isFinite(seed.lastWin) ? seed.lastWin : 0;
    if (seed.stats && typeof seed.stats === 'object') st.economy.stats = seed.stats;
  }
  return {
    version: 1,
    sessionId,
    createdAt: now,
    lastActivityAt: now,
    tier1: false,
    turnActive: false,
    turnCount: 0,
    lastPromptAt: null,
    tokensThisTurn: 0,
    machine: st,
    // Flattened mirrors of `machine.economy`, kept in sync on every persist,
    // purely so bin/claude-slots-stats.js's existing top-level
    // `data.credits` / `data.stats` reads work without modification.
    credits: st.economy.credits,
    lastWin: st.economy.lastWin,
    stats: st.economy.stats,
  };
}

function loadSession(sessionId, now, { createIfMissing = true } = {}) {
  const data = readJsonSafe(sessionFilePath(sessionId));
  if (data && data.machine) return data;
  return createIfMissing ? newSessionRecord(sessionId, now) : null;
}

function persistSession(session) {
  session.credits = session.machine.economy.credits;
  session.lastWin = session.machine.economy.lastWin;
  session.stats = session.machine.economy.stats;
  writeJsonAtomic(sessionFilePath(session.sessionId), session);
}

function persistEconomy(session) {
  writeJsonAtomic(economyFilePath(), {
    credits: session.machine.economy.credits,
    lastWin: session.machine.economy.lastWin,
    stats: session.machine.economy.stats,
    updatedAt: Date.now(),
  });
}

function pruneOldSessions() {
  try {
    const dir = sessionsDir();
    const now = Date.now();
    for (const f of fs.readdirSync(dir)) {
      if (!f.endsWith('.json')) continue;
      const full = path.join(dir, f);
      try {
        const st = fs.statSync(full);
        if (now - st.mtimeMs > SESSION_MAX_AGE_MS) fs.rmSync(full, { force: true });
      } catch {
        // one bad file must not stop the prune loop
      }
    }
  } catch {
    // sessions dir doesn't exist yet — nothing to prune
  }
}

// --------------------------------------------------------------------------
// rough token estimate (chars / 4 — good enough for the info strip's "tok")
// --------------------------------------------------------------------------

function roughTokens(str) {
  if (!str) return 0;
  return Math.max(0, Math.round(str.length / 4));
}

function sleep(ms) {
  // Deliberately NOT unref()'d: this delay is load-bearing (it's the whole
  // point of TIER1_MARKER_GRACE_MS below) and must keep the process alive
  // until it fires. HOOK_HARD_TIMEOUT_MS's own safety-net timer IS unref'd,
  // since that one should only fire as a last resort and never by itself
  // hold the process open past normal completion.
  return new Promise((resolve) => setTimeout(resolve, ms));
}

// Verified live (see notes_for_integrator): Tier 1's marker write
// ($.store.set('tier1', {sessions})) happens from INSIDE its own
// prompt.submit handler, which fires for the exact same user keystroke that
// triggers this classic UserPromptSubmit hook, in a separate OS process —
// there is no ordering guarantee between the two. A live run caught this
// race directly: this hook's UserPromptSubmit-time check saw tier1:false
// (marker not written yet) and rolled its own economy, while Tier 1's own
// AbovePrompt was — per the account's GrowthBook-gated function-hooks
// default — visually active the whole time, producing two live chassis
// with two different credit tallies. TIER1_MARKER_GRACE_MS gives Tier 1's
// same-keystroke handler a moment to land on disk before we commit to
// "tier1 is not active"; it costs nothing (this hook is async and never
// blocks the UI) and is small enough nobody perceives the delay.
const TIER1_MARKER_GRACE_MS = 250;

// --------------------------------------------------------------------------
// event handlers
// --------------------------------------------------------------------------

function handleSessionStart(event, now) {
  pruneOldSessions();
  const session = newSessionRecord(event.session_id, now);
  session.tier1 = isTier1Active(event.session_id);
  persistSession(session);
}

async function handleUserPromptSubmit(event, now) {
  const session = loadSession(event.session_id, now);
  session.lastActivityAt = now;
  session.lastPromptAt = now;
  session.turnActive = true;

  // First look: usually already conclusive (SessionStart or an earlier turn
  // may have already marked this session). If not yet, give Tier 1's
  // same-keystroke handler a moment to win the race (see
  // TIER1_MARKER_GRACE_MS's comment) before deciding.
  session.tier1 = session.tier1 || isTier1Active(event.session_id);
  if (!session.tier1) {
    await sleep(TIER1_MARKER_GRACE_MS);
    session.tier1 = isTier1Active(event.session_id);
  }
  if (DIAG_ENABLED) {
    diagLog({ evt: 'UserPromptSubmit-detail', sessionId: event.session_id, tier1: session.tier1, storeDir: tier1StoreDir(), files: (() => { try { return fs.readdirSync(tier1StoreDir()); } catch (e) { return String(e); } })() });
  }

  if (session.tier1) {
    // Tier 1 owns the roll/economy for this session — don't double-charge.
    persistSession(session);
    return;
  }

  session.turnCount = (session.turnCount || 0) + 1;
  session.tokensThisTurn = 0;
  const seed = hashSeed(`${event.session_id}:${session.turnCount}`);
  machine.pullLever(session.machine, now, seed);
  persistSession(session);
}

function handleActivity(event, now) {
  const session = loadSession(event.session_id, now, { createIfMissing: false });
  if (!session) return; // no SessionStart/UserPromptSubmit seen yet for this id — nothing to update
  session.lastActivityAt = now;
  session.tier1 = session.tier1 || isTier1Active(event.session_id); // sticky: closes the same race UserPromptSubmit's grace period targets

  if (!session.tier1) {
    let approx = '';
    if (typeof event.delta === 'string') approx += event.delta; // MessageDisplay
    if (event.tool_input) {
      try {
        approx += JSON.stringify(event.tool_input);
      } catch {
        /* ignore */
      }
    }
    if (event.tool_response) {
      try {
        approx += JSON.stringify(event.tool_response);
      } catch {
        /* ignore */
      }
    }
    if (approx) session.tokensThisTurn = (session.tokensThisTurn || 0) + roughTokens(approx);
  }
  persistSession(session);
}

function handleStop(event, now) {
  const session = loadSession(event.session_id, now, { createIfMissing: false });
  if (!session) {
    diagLog({ evt: 'Stop-no-session', sessionId: event.session_id });
    return;
  }
  session.lastActivityAt = now;
  // Re-check fresh (sticky-OR), not just whatever UserPromptSubmit saw: by
  // Stop time a whole model turn has elapsed, so if UserPromptSubmit's
  // grace period still lost the race against Tier 1's marker write, this is
  // the last and most important chance to catch it — paying out our own
  // economy on top of Tier 1's real one would be a visibly wrong double
  // payout, whereas the 1-credit spin cost already charged at lever-pull is
  // a harmless, one-time discrepancy by comparison.
  session.tier1 = session.tier1 || isTier1Active(event.session_id);
  diagLog({ evt: 'Stop-detail', sessionId: event.session_id, tier1: session.tier1, outcome: session.machine.outcome && session.machine.outcome.outcomeClass, turnActive: session.turnActive });

  if (session.tier1) {
    // Tier 1's turn.complete already applied the real payout/animation.
    session.turnActive = false;
    persistSession(session);
    return;
  }

  const st = session.machine;
  const canResolve = session.turnActive && st.outcome != null && st.stopAt == null;
  if (!canResolve) {
    // Nothing pending: either no matching UserPromptSubmit was ever seen
    // (e.g. the hook restarted mid-turn), or this spin was already
    // resolved (a duplicate Stop must never double-charge/pay).
    session.turnActive = false;
    persistSession(session);
    return;
  }

  // See file header: Tier 2 cannot distinguish an aborted/errored turn from
  // a normal one, so it always resolves as 'answer'.
  machine.stop(st, now, 'answer');
  session.turnActive = false;
  persistSession(session);
  persistEconomy(session);
}

function handleSessionEnd(event) {
  try {
    fs.rmSync(sessionFilePath(event.session_id), { force: true });
  } catch {
    // already gone, or dir missing — fine
  }
}

async function handle(event) {
  if (!event || typeof event !== 'object') return;
  const sessionId = event.session_id;
  if (!sessionId || typeof sessionId !== 'string') return;
  const now = Date.now();
  diagLog({ evt: event.hook_event_name, sessionId, pid: process.pid });

  switch (event.hook_event_name) {
    case 'SessionStart':
      handleSessionStart(event, now);
      break;
    case 'UserPromptSubmit':
      await handleUserPromptSubmit(event, now);
      break;
    case 'MessageDisplay':
    case 'PostToolUse':
      handleActivity(event, now);
      break;
    case 'Stop':
      handleStop(event, now);
      break;
    case 'SessionEnd':
      handleSessionEnd(event);
      break;
    default:
      break; // unknown/future event — ignore, never throw
  }
}

// --------------------------------------------------------------------------
// main — always exits 0, never writes to stdout, never hangs past the hook
// timeout, never lets an exception escape.
// --------------------------------------------------------------------------

async function main() {
  const raw = await readStdin();
  const event = safeParseJson(raw);
  try {
    await handle(event);
  } catch {
    // A hook that throws is skipped by the engine, but we never want that:
    // swallow and exit 0 regardless, per the task's own quality bar.
  }
}

const hardExit = setTimeout(() => process.exit(0), HOOK_HARD_TIMEOUT_MS);
hardExit.unref();

main()
  .catch(() => {})
  .finally(() => process.exit(0));
