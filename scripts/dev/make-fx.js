#!/usr/bin/env node
// Generates the three tiny sound effects Claude Slots optionally plays via
// $.audio.play (docs/ARCHITECTURE.md §4, option `sound: on`): a lever
// click, a coin ding, and a jackpot chord. Pure Node (no deps): synthesizes
// 16-bit PCM sine/noise and writes a standard WAV container by hand.
//
// Run: node scripts/dev/make-fx.js  (writes into fx/, alongside this repo)

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const FX_DIR = path.join(__dirname, '..', '..', 'fx');

const SAMPLE_RATE = 44100;

/**
 * @param {Float32Array} samples mono, range [-1, 1]
 * @returns {Buffer} a complete 16-bit PCM mono WAV file
 */
function encodeWav(samples, sampleRate = SAMPLE_RATE) {
  const numChannels = 1;
  const bitsPerSample = 16;
  const blockAlign = (numChannels * bitsPerSample) / 8;
  const byteRate = sampleRate * blockAlign;
  const dataSize = samples.length * 2;

  const buf = Buffer.alloc(44 + dataSize);
  let o = 0;
  buf.write('RIFF', o); o += 4;
  buf.writeUInt32LE(36 + dataSize, o); o += 4;
  buf.write('WAVE', o); o += 4;
  buf.write('fmt ', o); o += 4;
  buf.writeUInt32LE(16, o); o += 4; // fmt chunk size
  buf.writeUInt16LE(1, o); o += 2; // PCM
  buf.writeUInt16LE(numChannels, o); o += 2;
  buf.writeUInt32LE(sampleRate, o); o += 4;
  buf.writeUInt32LE(byteRate, o); o += 4;
  buf.writeUInt16LE(blockAlign, o); o += 2;
  buf.writeUInt16LE(bitsPerSample, o); o += 2;
  buf.write('data', o); o += 4;
  buf.writeUInt32LE(dataSize, o); o += 4;

  for (let i = 0; i < samples.length; i++) {
    const s = Math.max(-1, Math.min(1, samples[i]));
    buf.writeInt16LE(Math.round(s * 32767), o);
    o += 2;
  }
  return buf;
}

function seconds(n) {
  return Math.round(n * SAMPLE_RATE);
}

/** Linear envelope helper: 0 -> 1 over `attackN` samples, then 1 -> 0 over the rest. */
function envelope(i, n, attackN) {
  if (i < attackN) return i / attackN;
  const rel = n - attackN;
  return rel <= 0 ? 1 : Math.max(0, 1 - (i - attackN) / rel);
}

function sine(freq, t) {
  return Math.sin(2 * Math.PI * freq * t);
}

/** A short, dry mechanical click: filtered noise burst + a couple of short
 * clunky tone pulses, ~60ms, for the lever pull. */
function makeLeverClick() {
  const durationS = 0.06;
  const n = seconds(durationS);
  const out = new Float32Array(n);
  let lp = 0; // one-pole lowpass state, to soften the noise into a "clack" rather than static
  for (let i = 0; i < n; i++) {
    const t = i / SAMPLE_RATE;
    const noise = Math.random() * 2 - 1;
    lp += (noise - lp) * 0.35;
    const clunk = sine(180, t) * Math.exp(-t * 90) + sine(90, t) * Math.exp(-t * 60) * 0.6;
    const env = envelope(i, n, Math.round(n * 0.02));
    out[i] = (lp * 0.5 + clunk * 0.6) * env * 0.8;
  }
  return out;
}

/** A bright, short bell-like "ding" for a coin/credit win, ~120ms. */
function makeCoinDing() {
  const durationS = 0.12;
  const n = seconds(durationS);
  const out = new Float32Array(n);
  const partials = [
    { freq: 1568, gain: 0.55 }, // G6
    { freq: 2093, gain: 0.35 }, // C7
    { freq: 3136, gain: 0.15 }, // G7
  ];
  for (let i = 0; i < n; i++) {
    const t = i / SAMPLE_RATE;
    let s = 0;
    for (const p of partials) s += sine(p.freq, t) * p.gain * Math.exp(-t * 18);
    const env = envelope(i, n, Math.round(n * 0.03));
    out[i] = s * env * 0.7;
  }
  return out;
}

/** A short major-chord swell for the jackpot, ~500ms: root + third + fifth +
 * octave, each with a slightly staggered attack for a "cascading" feel. */
function makeJackpotChord() {
  const durationS = 0.5;
  const n = seconds(durationS);
  const out = new Float32Array(n);
  // C major, voiced up high enough to read clearly through a terminal bell/
  // speaker: C5 E5 G5 C6, staggered onsets.
  const notes = [
    { freq: 523.25, start: 0.0 },
    { freq: 659.25, start: 0.04 },
    { freq: 783.99, start: 0.08 },
    { freq: 1046.5, start: 0.12 },
  ];
  for (let i = 0; i < n; i++) {
    const t = i / SAMPLE_RATE;
    let s = 0;
    for (const note of notes) {
      if (t < note.start) continue;
      const nt = t - note.start;
      s += sine(note.freq, nt) * Math.exp(-nt * 3.2) * 0.35;
    }
    // A little shimmer: fast, quiet high partial that fades in then out.
    s += sine(2093, t) * 0.08 * Math.sin(Math.PI * (t / durationS));
    const env = envelope(i, n, Math.round(n * 0.05));
    out[i] = s * env;
  }
  return out;
}

function writeFx(name, samples) {
  fs.mkdirSync(FX_DIR, { recursive: true });
  const outPath = path.join(FX_DIR, name);
  fs.writeFileSync(outPath, encodeWav(samples));
  const stat = fs.statSync(outPath);
  console.log(`wrote ${outPath} (${stat.size} bytes, ${(samples.length / SAMPLE_RATE).toFixed(3)}s)`);
}

function main() {
  writeFx('lever-click.wav', makeLeverClick());
  writeFx('coin-ding.wav', makeCoinDing());
  writeFx('jackpot-chord.wav', makeJackpotChord());
}

main();
