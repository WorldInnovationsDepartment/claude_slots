// Regression coverage for bin/claude-slots-setup.js's corrupt-JSON
// robustness fix: a hand-edited or partially-written settings.json/
// config.json must produce a clean, non-zero-exit error message — never an
// uncaught SyntaxError/stack trace — in --dry-run (the default), --apply,
// and --restore.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..');
const SETUP = path.join(ROOT, 'bin', 'claude-slots-setup.js');

function mkTmpDir() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'claude-slots-setup-'));
}

function runSetup(args, env = {}) {
  return spawnSync(process.execPath, [SETUP, ...args], {
    encoding: 'utf8',
    env: { ...process.env, ...env },
    timeout: 8000,
  });
}

test('claude-slots-setup --dry-run: a valid settings.json still produces a clean diff (baseline, no regression)', () => {
  const dir = mkTmpDir();
  try {
    const settingsPath = path.join(dir, 'settings.json');
    fs.writeFileSync(settingsPath, JSON.stringify({ foo: 'bar' }), 'utf8');
    const res = runSetup(['--dry-run', '--settings-path', settingsPath]);
    assert.equal(res.status, 0);
    assert.doesNotMatch(res.stderr, /SyntaxError/);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('claude-slots-setup --dry-run: corrupt settings.json exits cleanly (no uncaught SyntaxError)', () => {
  const dir = mkTmpDir();
  try {
    const settingsPath = path.join(dir, 'settings.json');
    fs.writeFileSync(settingsPath, '{ this is not valid json', 'utf8');
    const res = runSetup(['--dry-run', '--settings-path', settingsPath]);
    assert.notEqual(res.status, 0, 'a corrupt settings file must not exit 0');
    assert.doesNotMatch(res.stderr, /SyntaxError/, `expected a clean error, got a raw stack trace:\n${res.stderr}`);
    assert.doesNotMatch(res.stderr, /at Object\.parse/, 'must not leak a JSON.parse stack frame');
    assert.match(res.stderr, /invalid JSON/i);
    // and, critically, the corrupt file must be left untouched
    assert.equal(fs.readFileSync(settingsPath, 'utf8'), '{ this is not valid json');
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('claude-slots-setup --apply: corrupt settings.json exits cleanly and never writes over the corrupt file', () => {
  const dir = mkTmpDir();
  try {
    const settingsPath = path.join(dir, 'settings.json');
    const original = '{ this is not valid json';
    fs.writeFileSync(settingsPath, original, 'utf8');
    const res = runSetup(['--apply', '--settings-path', settingsPath], { CLAUDE_PLUGIN_DATA: path.join(dir, 'plugin-data') });
    assert.notEqual(res.status, 0);
    assert.doesNotMatch(res.stderr, /SyntaxError/);
    assert.equal(fs.readFileSync(settingsPath, 'utf8'), original, 'a refused --apply must not touch the corrupt file');
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('claude-slots-setup --restore: corrupt config.json exits cleanly (no uncaught SyntaxError)', () => {
  const dir = mkTmpDir();
  try {
    const settingsPath = path.join(dir, 'settings.json');
    fs.writeFileSync(settingsPath, JSON.stringify({ statusLine: { type: 'command', command: 'node x.js' } }), 'utf8');
    const pluginDataDir = path.join(dir, 'plugin-data');
    fs.mkdirSync(pluginDataDir, { recursive: true });
    fs.writeFileSync(path.join(pluginDataDir, 'config.json'), 'not json{{{', 'utf8');
    const res = runSetup(['--restore', '--settings-path', settingsPath], { CLAUDE_PLUGIN_DATA: pluginDataDir });
    assert.notEqual(res.status, 0);
    assert.doesNotMatch(res.stderr, /SyntaxError/, `expected a clean error, got a raw stack trace:\n${res.stderr}`);
    assert.match(res.stderr, /invalid JSON/i);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('claude-slots-setup --apply then --restore: full round trip still works on well-formed files (no regression)', () => {
  const dir = mkTmpDir();
  try {
    const settingsPath = path.join(dir, 'settings.json');
    fs.writeFileSync(settingsPath, JSON.stringify({ someOtherKey: 1 }), 'utf8');
    const pluginDataDir = path.join(dir, 'plugin-data');
    let res = runSetup(['--apply', '--settings-path', settingsPath], { CLAUDE_PLUGIN_DATA: pluginDataDir });
    assert.equal(res.status, 0, res.stderr);
    let settings = JSON.parse(fs.readFileSync(settingsPath, 'utf8'));
    assert.equal(settings.someOtherKey, 1);
    assert.equal(settings.statusLine.type, 'command');

    res = runSetup(['--restore', '--settings-path', settingsPath], { CLAUDE_PLUGIN_DATA: pluginDataDir });
    assert.equal(res.status, 0, res.stderr);
    settings = JSON.parse(fs.readFileSync(settingsPath, 'utf8'));
    assert.equal(settings.someOtherKey, 1);
    assert.equal(settings.statusLine, undefined);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});
