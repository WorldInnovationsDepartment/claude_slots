// Claude Slots — Tier 2 integration test (bin/claude-slots-hook.js +
// bin/claude-slots-statusline.js), run as real child processes end-to-end.
//
// Exercises the lifecycle from the task brief: SessionStart ->
// UserPromptSubmit -> statusline samples during the spin -> Stop ->
// statusline samples after the outcome resolves, plus the Tier 1
// marker-skip path, Stop idempotency, SessionEnd cleanup, and COMPACT mode
// at COLUMNS=50. All state lives under a temp CLAUDE_PLUGIN_DATA directory
// (os.tmpdir(), cleaned up after each test) — never touches the real
// ~/.claude directory tree.
//
// Timing/phase checks don't literally sleep for seconds: since
// lib/machine.js's phase is a pure function of (state, now) keyed off the
// stored `leverAt`/`stopAt` timestamps, backdating those fields by the
// desired offset is equivalent to — and far faster than — waiting for wall
// clock to pass, while exercising the exact same code path a real 1s-later
// statusline poll would.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { displayWidth } from '../lib/width.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..');
const HOOK = path.join(ROOT, 'bin', 'claude-slots-hook.js');
const STATUSLINE = path.join(ROOT, 'bin', 'claude-slots-statusline.js');

function mkTmpDataDir() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'claude-slots-tier2-'));
}

function runHook(event, dataDir, envExtra = {}) {
  return spawnSync(process.execPath, [HOOK], {
    input: JSON.stringify(event),
    encoding: 'utf8',
    // CLAUDE_SLOTS_TEST_NO_POINTER: this suite uses its own temp
    // CLAUDE_PLUGIN_DATA dirs — never let it overwrite the real, shared
    // <repo>/.claude-slots-runtime/plugin-data-dir.txt pointer file a
    // concurrent live session may depend on right now (see hook.js's header
    // comment on why that pointer file exists at all).
    env: { ...process.env, CLAUDE_PLUGIN_DATA: dataDir, CLAUDE_SLOTS_TEST_NO_POINTER: '1', ...envExtra },
    timeout: 8000,
  });
}

function runStatusline(stdinObj, dataDir, envExtra = {}) {
  return spawnSync(process.execPath, [STATUSLINE], {
    input: JSON.stringify(stdinObj),
    encoding: 'utf8',
    env: {
      ...process.env,
      CLAUDE_PLUGIN_DATA: dataDir,
      COLUMNS: '80',
      COLORTERM: 'truecolor',
      CLAUDE_SLOTS_DEBUG_TIMING: '1',
      ...envExtra,
    },
    timeout: 8000,
  });
}

function stripAnsi(s) {
  // eslint-disable-next-line no-control-regex
  return s.replace(/\x1b\[[0-9;]*m/g, '');
}

function internalTimingMs(res) {
  const m = /claude-slots-statusline: ([\d.]+)ms/.exec(res.stderr || '');
  return m ? Number(m[1]) : null;
}

function sessionFilePath(dataDir, sessionId) {
  return path.join(dataDir, 'sessions', `${sessionId}.json`);
}

function readSession(dataDir, sessionId) {
  return JSON.parse(fs.readFileSync(sessionFilePath(dataDir, sessionId), 'utf8'));
}

function writeSession(dataDir, sessionId, session) {
  fs.writeFileSync(sessionFilePath(dataDir, sessionId), JSON.stringify(session), 'utf8');
}

/** Backdate leverAt so `Date.now() - leverAt === elapsedMs` (still spinning: stopAt stays null). */
function setLeverElapsed(dataDir, sessionId, elapsedMs) {
  const session = readSession(dataDir, sessionId);
  session.machine.leverAt = Date.now() - elapsedMs;
  session.machine.stopAt = null;
  session.machine.stopReason = null;
  writeSession(dataDir, sessionId, session);
}

/** Backdate stopAt so `Date.now() - stopAt === elapsedMs` (spin already resolved). */
function setStopElapsed(dataDir, sessionId, elapsedMs) {
  const session = readSession(dataDir, sessionId);
  session.machine.stopAt = Date.now() - elapsedMs;
  writeSession(dataDir, sessionId, session);
}

/** Every line of a single statusline call must be an equal-display-width rectangle (assertRect's invariant, verified post-ANSI-round-trip). */
function assertRectangularOutput(stdout, label) {
  const plain = stripAnsi(stdout).replace(/\n$/, '');
  assert.ok(plain.length > 0, `${label}: expected non-empty output`);
  const lines = plain.split('\n');
  const widths = lines.map((l) => displayWidth(l));
  const w0 = widths[0];
  for (let i = 0; i < widths.length; i++) {
    assert.equal(widths[i], w0, `${label}: line ${i} width ${widths[i]} !== line 0 width ${w0}\n${plain}`);
  }
  return plain;
}

test('tier2 full lifecycle: SessionStart -> UserPromptSubmit -> statusline samples -> Stop -> statusline samples', () => {
  const dataDir = mkTmpDataDir();
  const sessionId = `test-${Math.random().toString(36).slice(2)}`;
  try {
    // --- SessionStart ---
    let res = runHook({ hook_event_name: 'SessionStart', session_id: sessionId, source: 'startup' }, dataDir);
    assert.equal(res.status, 0, `SessionStart nonzero: ${res.stderr}`);
    assert.equal(res.stdout, '', 'SessionStart must never print to stdout');
    assert.ok(fs.existsSync(sessionFilePath(dataDir, sessionId)));

    let session = readSession(dataDir, sessionId);
    assert.equal(session.machine.economy.credits, 100);
    assert.equal(session.tier1, false);
    assert.equal(session.machine.outcome, null);

    // --- UserPromptSubmit (pullLever) ---
    res = runHook(
      { hook_event_name: 'UserPromptSubmit', session_id: sessionId, prompt: 'Count from 1 to 40, one number per line, then say done.' },
      dataDir
    );
    assert.equal(res.status, 0, `UserPromptSubmit nonzero: ${res.stderr}`);
    assert.equal(res.stdout, '', 'UserPromptSubmit must never print to stdout (it would reach the model)');

    session = readSession(dataDir, sessionId);
    assert.equal(session.machine.economy.credits, 99, 'spin cost charged at lever pull, not on reveal');
    assert.ok(session.machine.leverAt != null, 'leverAt set');
    assert.ok(session.machine.outcome != null, 'outcome pre-rolled at lever pull');
    assert.equal(session.turnActive, true);
    assert.equal(session.turnCount, 1);

    // --- statusline @ t+0.5s (LEVER or SPINUP) ---
    setLeverElapsed(dataDir, sessionId, 500);
    let sl = runStatusline({ session_id: sessionId }, dataDir);
    assert.equal(sl.status, 0, `statusline nonzero: ${sl.stderr}`);
    assertRectangularOutput(sl.stdout, 't+0.5s');
    let ms = internalTimingMs(sl);
    assert.ok(ms != null, 'internal timing line should be present in stderr');
    assert.ok(ms < 50, `statusline internal work should be <50ms, was ${ms}ms`);

    // --- statusline @ t+1.5s (SPINNING) ---
    setLeverElapsed(dataDir, sessionId, 1500);
    sl = runStatusline({ session_id: sessionId }, dataDir);
    assert.equal(sl.status, 0);
    let plain = assertRectangularOutput(sl.stdout, 't+1.5s');
    assert.match(plain, /SPINNING/i, `expected SPINNING content at t+1.5s, got:\n${plain}`);
    ms = internalTimingMs(sl);
    assert.ok(ms < 50, `statusline internal work should be <50ms, was ${ms}ms`);

    // --- MessageDisplay: touches activity + rough token estimate ---
    res = runHook(
      { hook_event_name: 'MessageDisplay', session_id: sessionId, delta: 'hello world, this is a chunk of assistant output text' },
      dataDir
    );
    assert.equal(res.status, 0);
    session = readSession(dataDir, sessionId);
    assert.ok(session.tokensThisTurn > 0, 'MessageDisplay delta should accumulate a rough token estimate');

    // --- PostToolUse: also touches activity + tokens ---
    res = runHook(
      {
        hook_event_name: 'PostToolUse',
        session_id: sessionId,
        tool_name: 'Bash',
        tool_input: { command: 'ls -la' },
        tool_response: { stdout: 'total 0\n.\n..', stderr: '', interrupted: false },
      },
      dataDir
    );
    assert.equal(res.status, 0);
    const tokensAfterToolUse = readSession(dataDir, sessionId).tokensThisTurn;
    assert.ok(tokensAfterToolUse > 0);

    // --- statusline @ t+3s (still SPINNING — outcome not resolved yet) ---
    setLeverElapsed(dataDir, sessionId, 3000);
    sl = runStatusline({ session_id: sessionId }, dataDir);
    assert.equal(sl.status, 0);
    assertRectangularOutput(sl.stdout, 't+3s');

    // Reset leverAt to "now" before Stop, matching a real ~3s-long turn.
    setLeverElapsed(dataDir, sessionId, 0);

    // --- Stop ---
    res = runHook(
      { hook_event_name: 'Stop', session_id: sessionId, stop_hook_active: false, last_assistant_message: '...\n39\n40\n\ndone' },
      dataDir
    );
    assert.equal(res.status, 0, `Stop nonzero: ${res.stderr}`);
    assert.equal(res.stdout, '');

    session = readSession(dataDir, sessionId);
    assert.ok(session.machine.stopAt != null, 'stop() resolved the spin');
    assert.equal(session.machine.stopReason, 'answer', 'Tier 2 always resolves Stop as answer (documented limitation)');
    assert.equal(session.turnActive, false);
    const creditsAfterStop = session.machine.economy.credits;

    // economy.json persisted on Stop, matching the session's economy
    const economyPath = path.join(dataDir, 'economy.json');
    assert.ok(fs.existsSync(economyPath), 'economy.json should be written on Stop');
    const economy = JSON.parse(fs.readFileSync(economyPath, 'utf8'));
    assert.equal(economy.credits, creditsAfterStop);

    // --- Stop idempotency: a duplicate Stop must never double-charge/pay ---
    res = runHook({ hook_event_name: 'Stop', session_id: sessionId, stop_hook_active: false }, dataDir);
    assert.equal(res.status, 0);
    const sessionAfterSecondStop = readSession(dataDir, sessionId);
    assert.equal(sessionAfterSecondStop.machine.economy.credits, creditsAfterStop, 'duplicate Stop must not change credits again');

    // --- statusline @ +0.5s post-stop (STOPPING/REVEAL/OUTCOME) ---
    setStopElapsed(dataDir, sessionId, 500);
    sl = runStatusline({ session_id: sessionId }, dataDir);
    assert.equal(sl.status, 0);
    assertRectangularOutput(sl.stdout, 'stop+0.5s');

    // --- statusline @ +2s post-stop ---
    setStopElapsed(dataDir, sessionId, 2000);
    sl = runStatusline({ session_id: sessionId }, dataDir);
    assert.equal(sl.status, 0);
    assertRectangularOutput(sl.stdout, 'stop+2s');

    // --- statusline @ +5s post-stop (settled RESULT / idle-like) ---
    setStopElapsed(dataDir, sessionId, 5000);
    sl = runStatusline({ session_id: sessionId }, dataDir);
    assert.equal(sl.status, 0);
    plain = assertRectangularOutput(sl.stdout, 'stop+5s');
    assert.match(plain, /✻|CREDITS/i, `expected settled machine content, got:\n${plain}`);

    // --- SessionEnd removes the session file ---
    res = runHook({ hook_event_name: 'SessionEnd', session_id: sessionId, reason: 'prompt_input_exit' }, dataDir);
    assert.equal(res.status, 0);
    assert.ok(!fs.existsSync(sessionFilePath(dataDir, sessionId)), 'SessionEnd should delete the session file');

    // statusline with no session file left -> a safe idle frame, not a crash
    sl = runStatusline({ session_id: sessionId }, dataDir);
    assert.equal(sl.status, 0);
    assertRectangularOutput(sl.stdout, 'post-SessionEnd idle');
  } finally {
    fs.rmSync(dataDir, { recursive: true, force: true });
  }
});

test('tier2 COMPACT mode at COLUMNS=50', () => {
  const dataDir = mkTmpDataDir();
  const sessionId = `test-compact-${Math.random().toString(36).slice(2)}`;
  try {
    runHook({ hook_event_name: 'SessionStart', session_id: sessionId, source: 'startup' }, dataDir);
    const sl = runStatusline({ session_id: sessionId }, dataDir, { COLUMNS: '50' });
    assert.equal(sl.status, 0, `statusline nonzero at COLUMNS=50: ${sl.stderr}`);
    const plain = assertRectangularOutput(sl.stdout, 'COLUMNS=50');
    // COMPACT (§7.2) is a fixed 40-col budget, no border, one/two lines.
    const lines = plain.split('\n');
    for (const line of lines) assert.ok(displayWidth(line) <= 40, `compact line exceeds 40 cols: ${JSON.stringify(line)}`);
    assert.match(plain, /✻/);
  } finally {
    fs.rmSync(dataDir, { recursive: true, force: true });
  }
});

test('tier2 skips economy accounting for a session Tier 1 has marked active', () => {
  const dataDir = mkTmpDataDir();
  const tier1StoreDir = fs.mkdtempSync(path.join(os.tmpdir(), 'claude-slots-tier1store-'));
  const sessionId = `test-tier1-${Math.random().toString(36).slice(2)}`;
  try {
    // Simulate hooks/slots.js's `$.store.set('tier1', {sessions:{[id]:now}})`
    // persisting to ~/.claude/plugins/store/claude-slots_<...>.json — routed
    // through the test-only env seam so this never touches the real
    // ~/.claude directory.
    fs.writeFileSync(path.join(tier1StoreDir, 'claude-slots_inline-testhash.json'), JSON.stringify({ tier1: { sessions: { [sessionId]: Date.now() } } }));

    const envExtra = { CLAUDE_SLOTS_TEST_TIER1_STORE_DIR: tier1StoreDir };

    let res = runHook({ hook_event_name: 'SessionStart', session_id: sessionId, source: 'startup' }, dataDir, envExtra);
    assert.equal(res.status, 0);
    let session = readSession(dataDir, sessionId);
    assert.equal(session.tier1, true, 'SessionStart should detect the Tier 1 marker');

    res = runHook({ hook_event_name: 'UserPromptSubmit', session_id: sessionId, prompt: 'hi' }, dataDir, envExtra);
    assert.equal(res.status, 0);
    session = readSession(dataDir, sessionId);
    assert.equal(session.machine.economy.credits, 100, 'Tier 2 must not charge a spin cost when Tier 1 owns this session');
    assert.equal(session.machine.outcome, null, 'Tier 2 must not roll an outcome when Tier 1 owns this session');

    res = runHook({ hook_event_name: 'Stop', session_id: sessionId, stop_hook_active: false }, dataDir, envExtra);
    assert.equal(res.status, 0);
    session = readSession(dataDir, sessionId);
    assert.equal(session.machine.economy.credits, 100, 'Tier 2 must not pay out when Tier 1 owns this session');

    // The statusline should print the minimal companion line, not the full machine.
    const sl = runStatusline({ session_id: sessionId }, dataDir);
    assert.equal(sl.status, 0);
    const plain = stripAnsi(sl.stdout).trim();
    assert.match(plain, /✻.*credits 100/i);
  } finally {
    fs.rmSync(dataDir, { recursive: true, force: true });
    fs.rmSync(tier1StoreDir, { recursive: true, force: true });
  }
});

test('tier2 statusline degrades to an idle frame with no session file at all (never crashes)', () => {
  const dataDir = mkTmpDataDir();
  try {
    const sl = runStatusline({ session_id: 'never-seen-session' }, dataDir);
    assert.equal(sl.status, 0);
    const plain = assertRectangularOutput(sl.stdout, 'no session file');
    assert.match(plain, /✻|CREDITS/i);
  } finally {
    fs.rmSync(dataDir, { recursive: true, force: true });
  }
});

test('tier2 statusline: resolveTruecolor falls back to the 256-color fallback when COLORTERM is unset', () => {
  const dataDir = mkTmpDataDir();
  try {
    const env = { ...process.env, CLAUDE_PLUGIN_DATA: dataDir, COLUMNS: '80' };
    delete env.COLORTERM;
    const res = spawnSync(process.execPath, [STATUSLINE], {
      input: JSON.stringify({ session_id: 'no-such-session' }),
      encoding: 'utf8',
      env,
      timeout: 8000,
    });
    assert.equal(res.status, 0, `statusline nonzero: ${res.stderr}`);
    assert.doesNotMatch(res.stdout, /38;2;/, 'expected the 256-color fallback (no truecolor 38;2; codes) when COLORTERM is unset');
    assert.match(res.stdout, /38;5;\d+m/, 'expected at least one 256-color (38;5;N) code');
  } finally {
    fs.rmSync(dataDir, { recursive: true, force: true });
  }
});

test('tier2 statusline: resolveTruecolor still emits truecolor when COLORTERM says so', () => {
  const dataDir = mkTmpDataDir();
  try {
    const res = spawnSync(process.execPath, [STATUSLINE], {
      input: JSON.stringify({ session_id: 'no-such-session' }),
      encoding: 'utf8',
      env: { ...process.env, CLAUDE_PLUGIN_DATA: dataDir, COLUMNS: '80', COLORTERM: 'truecolor' },
      timeout: 8000,
    });
    assert.equal(res.status, 0);
    assert.match(res.stdout, /38;2;\d+;\d+;\d+m/);
  } finally {
    fs.rmSync(dataDir, { recursive: true, force: true });
  }
});

test('tier2 statusline: the Tier-1-companion line clamps to COLUMNS on a narrow terminal', () => {
  const dataDir = mkTmpDataDir();
  const sessionId = `test-tier1-narrow-${Math.random().toString(36).slice(2)}`;
  try {
    fs.mkdirSync(path.dirname(sessionFilePath(dataDir, sessionId)), { recursive: true });
    writeSession(dataDir, sessionId, {
      tier1: true,
      machine: { economy: { credits: 100, lastWin: 50, stats: { recent: [{ outcomeClass: 'ABORTED' }] } } },
    });
    const sl = runStatusline({ session_id: sessionId }, dataDir, { COLUMNS: '40' });
    assert.equal(sl.status, 0, `statusline nonzero: ${sl.stderr}`);
    const plain = assertRectangularOutput(sl.stdout, 'tier1-narrow');
    for (const line of plain.split('\n')) {
      assert.ok(displayWidth(line) <= 40, `tier1 companion line exceeds 40 cols: ${JSON.stringify(line)}`);
    }
  } finally {
    fs.rmSync(dataDir, { recursive: true, force: true });
  }
});

test('tier2 hook: malformed/empty stdin never crashes and never writes stdout', () => {
  const dataDir = mkTmpDataDir();
  try {
    const res = spawnSync(process.execPath, [HOOK], {
      input: 'not json{{{',
      encoding: 'utf8',
      env: { ...process.env, CLAUDE_PLUGIN_DATA: dataDir, CLAUDE_SLOTS_TEST_NO_POINTER: '1' },
      timeout: 8000,
    });
    assert.equal(res.status, 0);
    assert.equal(res.stdout, '');
  } finally {
    fs.rmSync(dataDir, { recursive: true, force: true });
  }
});
