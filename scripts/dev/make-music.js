#!/usr/bin/env node
// Claude Slots — the launch video's soundtrack (scripts/dev/make-music.js)
//
// Synthesizes a 60 s stereo industrial-synthwave track from code alone (no
// samples, no licensed audio, no network), driven by art/src/timeline.json
// so the accents land exactly on the reel-stop frames. Extends the WAV
// writer approach of make-fx.js to stereo.
//
//   kick        four-on-the-floor sine drop on every beat
//   bass        saw at the bar's root, side-chained to the kick, soft-clipped
//   arp         16th-note detuned square over a minor pentatonic
//   hats        quiet noise ticks on the off-eighths
//   riser       filtered noise swelling for 1.5 s before each stop
//   accent      a clank + noise burst on every reel-stop frame, with the bed ducked under it; a chord on the last LIFE stop
//
// Run: node scripts/dev/make-music.js   -> art/public/launch-track.wav
// Constants to taste are at the top.

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const TIMELINE = JSON.parse(fs.readFileSync(path.join(ROOT, 'art', 'src', 'timeline.json'), 'utf8'));
const OUT = path.join(ROOT, 'art', 'public', 'launch-track.wav');

// ---- tuning -----------------------------------------------------------------
const SAMPLE_RATE = 44100;
const BPM = TIMELINE.bpm;
const BASS_DRIVE = 2.4; // pre-clip gain of the bass
const SIDECHAIN_DEPTH = 0.75; // how far the bass ducks on each kick
const ARP_PATTERN = [0, 3, 5, 7, 10, 7, 5, 3]; // semitone offsets over the root (minor pentatonic walk)
const ROOTS = [45, 45, 41, 43]; // MIDI per bar: A1 A1 F1 G1  (i i VI VII)
const RISER_S = 1.5;
const MASTER = 0.9;
// ------------------------------------------------------------------------------

const FPS = TIMELINE.fps;
const DURATION_S = TIMELINE.durationInFrames / FPS;
const N = Math.round(DURATION_S * SAMPLE_RATE);
const BEAT_S = 60 / BPM;
const BAR_S = BEAT_S * 4;
const SIXTEENTH_S = BEAT_S / 4;

const L = new Float32Array(N);
const R = new Float32Array(N);

const midiHz = (m) => 440 * Math.pow(2, (m - 69) / 12);
const frameS = (f) => f / FPS;
const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));
const softClip = (x) => Math.tanh(x);

/** Deterministic noise (no Math.random: the track is reproducible). */
let noiseState = 0x12345678;
function noise() {
  noiseState ^= noiseState << 13;
  noiseState ^= noiseState >>> 17;
  noiseState ^= noiseState << 5;
  return ((noiseState >>> 0) / 4294967296) * 2 - 1;
}

/** Add a mono signal function over [startS, startS + lenS) with a stereo pan (-1..1). */
function add(startS, lenS, fn, pan = 0, gain = 1) {
  const i0 = Math.max(0, Math.round(startS * SAMPLE_RATE));
  const i1 = Math.min(N, Math.round((startS + lenS) * SAMPLE_RATE));
  const gl = gain * Math.sqrt((1 - pan) / 2) * Math.SQRT2;
  const gr = gain * Math.sqrt((1 + pan) / 2) * Math.SQRT2;
  for (let i = i0; i < i1; i++) {
    const t = (i - i0) / SAMPLE_RATE;
    const s = fn(t);
    L[i] += s * gl;
    R[i] += s * gr;
  }
}

/** Section energy: the title is softer, the payoff card halves, the rest is full. */
function energyAt(tS) {
  const f = tS * FPS;
  const title = TIMELINE.scenes.find((s) => s.id === 'terminal').start;
  const payoff = TIMELINE.scenes.find((s) => s.id === 'payoff').start;
  if (f < title) return 0.55 + 0.45 * clamp(f / title, 0, 1) * 0.5;
  if (f >= payoff) return 0.6;
  return 1;
}

// ---- kick -------------------------------------------------------------------
function kick(t) {
  const f = 50 + 110 * Math.exp(-t * 38);
  const env = Math.exp(-t * 14);
  return Math.sin(2 * Math.PI * f * t) * env + noise() * 0.08 * Math.exp(-t * 120);
}

// ---- bass (per beat, side-chained) -------------------------------------------
function bassBeat(root, t, beatLen) {
  const hz = midiHz(root);
  const saw = 2 * ((t * hz) % 1) - 1;
  const sub = Math.sin(2 * Math.PI * hz * 0.5 * t) * 0.5;
  const duck = 1 - SIDECHAIN_DEPTH * Math.exp(-t * 9); // recovers after the kick
  const tail = t > beatLen - 0.02 ? (beatLen - t) / 0.02 : 1;
  return softClip((saw * 0.6 + sub) * BASS_DRIVE) * duck * clamp(tail, 0, 1) * 0.42;
}

// ---- arp (16ths, detuned square) ----------------------------------------------
function square(hz, t) {
  return ((t * hz) % 1) < 0.5 ? 1 : -1;
}
function arpNote(midi, t, len) {
  const hz = midiHz(midi);
  const s = square(hz * 0.9965, t) * 0.5 + square(hz * 1.0035, t) * 0.5;
  const env = Math.exp(-t * 11) * clamp((len - t) / 0.01, 0, 1);
  return s * env * 0.14;
}

// ---- hats ---------------------------------------------------------------------
function hat(t) {
  let hp = 0;
  const n = noise();
  hp = n - hp * 0.3;
  return hp * Math.exp(-t * 90) * 0.12;
}

// ---- riser --------------------------------------------------------------------
function riser(t) {
  const u = clamp(t / RISER_S, 0, 1);
  let lp = 0;
  const n = noise();
  lp += (n - lp) * (0.05 + 0.9 * u * u);
  return lp * (0.05 + 0.55 * u * u * u);
}

// ---- accent hits --------------------------------------------------------------
function clank(t) {
  const partials = [1240, 1860, 2790];
  let s = 0;
  partials.forEach((p, i) => (s += Math.sin(2 * Math.PI * p * t) * Math.exp(-t * (26 + i * 10)) * (0.5 - i * 0.12)));
  return s * 0.7 + noise() * 0.5 * Math.exp(-t * 60);
}
function chordStab(t) {
  const notes = [57, 60, 64, 69, 72, 76]; // A minor, two octaves
  let s = 0;
  for (const n of notes) s += (square(midiHz(n), t) * 0.5 + Math.sin(2 * Math.PI * midiHz(n) * t) * 0.5) * Math.exp(-t * 2.2);
  return (s / notes.length) * 0.9;
}

// ---- arrangement --------------------------------------------------------------
// every turn that stops on screen: the four pull scenes plus the terminal scene's own turn
const STOP_SETS = [TIMELINE.terminal, ...TIMELINE.pulls];
const STOP_TIMES = STOP_SETS.flatMap((p) => p.reelStops.map(frameS));
const nearStop = (tS) => STOP_TIMES.some((s) => Math.abs(s - tS) < 0.09);
const totalBeats = Math.ceil(DURATION_S / BEAT_S);
for (let b = 0; b < totalBeats; b++) {
  const tS = b * BEAT_S;
  const e = energyAt(tS);
  const bar = Math.floor(b / 4);
  const root = ROOTS[bar % ROOTS.length];
  if (!nearStop(tS)) add(tS, 0.35, kick, 0, 0.9 * e); // the reel-stop hit replaces a kick that lands on it
  add(tS, BEAT_S, (t) => bassBeat(root, t, BEAT_S), 0, e);
  if (e >= 1) {
    add(tS + BEAT_S / 2, 0.08, hat, 0.35, 1);
    for (let s = 0; s < 4; s++) {
      const idx = (b * 4 + s) % ARP_PATTERN.length;
      const midi = root + 24 + ARP_PATTERN[idx] + (bar % 8 >= 4 ? 12 : 0);
      add(tS + s * SIXTEENTH_S, SIXTEENTH_S, (t) => arpNote(midi, t, SIXTEENTH_S), s % 2 ? -0.5 : 0.5, 1);
    }
  } else if (b % 2 === 0) {
    // title + payoff: a sparse pad note instead of the arp
    const midi = root + 24;
    add(tS, BEAT_S * 2, (t) => (Math.sin(2 * Math.PI * midiHz(midi) * t) + Math.sin(2 * Math.PI * midiHz(midi + 7) * t) * 0.6) * Math.exp(-t * 1.5) * 0.12, 0, 1);
  }
}

// duck the whole bed for a moment at every reel stop so the accent owns the mix
const STOP_DUCK = 0.8;
for (const pull of STOP_SETS) {
  for (const f of pull.reelStops) {
    const PRE_S = 0.04; // the bed drops just before the hit: a short breath, then the clank
    const i0 = Math.round((frameS(f) - PRE_S) * SAMPLE_RATE);
    for (let i = Math.max(0, i0); i < Math.min(N, i0 + SAMPLE_RATE * 0.3); i++) {
      const t = (i - i0) / SAMPLE_RATE;
      const g = t < PRE_S ? 1 - STOP_DUCK * Math.min(1, t / 0.005) : 1 - STOP_DUCK * Math.exp(-(t - PRE_S) * 18);
      L[i] *= g;
      R[i] *= g;
    }
  }
}

// risers before every stop, accents on every reel-stop frame
for (const pull of STOP_SETS) {
  add(frameS(pull.stopFrame) - RISER_S, RISER_S, riser, 0, 1);
  pull.reelStops.forEach((f, i) => {
    const last = pull.id === 'life' && i === 2;
    add(frameS(f), 0.5, clank, i === 0 ? -0.4 : i === 1 ? 0 : 0.4, last ? 3.0 : 2.3);
    if (last) add(frameS(f), 2.5, chordStab, 0, 1.3);
  });
}
// the terminal scene's lever pull gets a clank too, so the machine "starts" audibly
add(frameS(TIMELINE.terminal.leverFrame), 0.3, clank, 0, 0.6);

// ---- master: fade edges, normalise, write ---------------------------------------
const fadeN = Math.round(0.02 * SAMPLE_RATE);
let peak = 0;
for (let i = 0; i < N; i++) {
  const f = Math.min(1, i / fadeN, (N - 1 - i) / (SAMPLE_RATE * 1.5));
  L[i] *= f;
  R[i] *= f;
  peak = Math.max(peak, Math.abs(L[i]), Math.abs(R[i]));
}
const norm = peak > 0 ? MASTER / peak : 1;

function encodeWavStereo(l, r, sampleRate) {
  const numChannels = 2;
  const bitsPerSample = 16;
  const blockAlign = (numChannels * bitsPerSample) / 8;
  const dataSize = l.length * blockAlign;
  const buf = Buffer.alloc(44 + dataSize);
  let o = 0;
  buf.write('RIFF', o); o += 4;
  buf.writeUInt32LE(36 + dataSize, o); o += 4;
  buf.write('WAVE', o); o += 4;
  buf.write('fmt ', o); o += 4;
  buf.writeUInt32LE(16, o); o += 4;
  buf.writeUInt16LE(1, o); o += 2;
  buf.writeUInt16LE(numChannels, o); o += 2;
  buf.writeUInt32LE(sampleRate, o); o += 4;
  buf.writeUInt32LE(sampleRate * blockAlign, o); o += 4;
  buf.writeUInt16LE(blockAlign, o); o += 2;
  buf.writeUInt16LE(bitsPerSample, o); o += 2;
  buf.write('data', o); o += 4;
  buf.writeUInt32LE(dataSize, o); o += 4;
  for (let i = 0; i < l.length; i++) {
    buf.writeInt16LE(Math.round(clamp(l[i] * norm, -1, 1) * 32767), o); o += 2;
    buf.writeInt16LE(Math.round(clamp(r[i] * norm, -1, 1) * 32767), o); o += 2;
  }
  return buf;
}

fs.mkdirSync(path.dirname(OUT), { recursive: true });
fs.writeFileSync(OUT, encodeWavStereo(L, R, SAMPLE_RATE));
console.log(`wrote ${path.relative(ROOT, OUT)}: ${DURATION_S.toFixed(2)} s stereo @ ${SAMPLE_RATE} Hz, ${BPM} BPM, accents at frames ${STOP_SETS.flatMap((p) => p.reelStops).join(' ')}`);
