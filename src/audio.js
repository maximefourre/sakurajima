/**
 * audio.js — tiny Web Audio layer. No files, no new deps.
 * Birds emit 'call' / 'flush'; the shiba emits 'bark'.
 * Continuous beds (surf, bamboo, cicadas, frogs) follow ambientWeights.
 * First user gesture resumes the context (autoplay policy).
 */

import { AMBIENCE } from './config.js';

function clamp01(x) { return Math.max(0, Math.min(1, x)); }
function sstep(e0, e1, x) {
  const t = clamp01((x - e0) / (e1 - e0 || 1e-6));
  return t * t * (3 - 2 * t);
}

/**
 * Deterministic mix of the four beds. No AudioContext.
 * pondDist is metres past the waterline (≥ 0 outside the disc).
 */
export function ambientWeights({
  height = 4,
  seaLevel = 0,
  inGrove = false,
  pondDist = 1e3,
  night = 0,
  twilight = 0,
  windStrength = 0.4,
} = {}) {
  const dh = height - seaLevel;
  const shore = 1 - sstep(AMBIENCE.surfNear, AMBIENCE.surfFar, dh);
  const surf = AMBIENCE.surfFloor + (1 - AMBIENCE.surfFloor) * shore;

  const w = clamp01(windStrength / AMBIENCE.groveWind);
  const bamboo = inGrove ? 0.22 + 0.78 * w : 0;

  const day = 1 - clamp01(night);
  const inland = height >= AMBIENCE.cicadaMinH ? (1 - shore) : 0;
  const cicada = day * inland * (0.40 + 0.60 * day);

  const nearPond = 1 - sstep(AMBIENCE.frogNear, AMBIENCE.frogFar, pondDist);
  const frogs = (twilight * 0.7 + clamp01(night)) * nearPond;

  return { surf, bamboo, cicada, frogs };
}

function makeCtx() {
  const AC = globalThis.AudioContext || globalThis.webkitAudioContext;
  if (!AC) return null;
  return new AC();
}

function noiseBuffer(ctx, seconds = 2) {
  const n = Math.floor(ctx.sampleRate * seconds);
  const buf = ctx.createBuffer(1, n, ctx.sampleRate);
  const data = buf.getChannelData(0);
  for (let i = 0; i < n; i++) data[i] = Math.random() * 2 - 1;
  return buf;
}

function makeBed(ctx, dest, { type, freq, q = 1, rate = 0, depth = 0 }) {
  const src = ctx.createBufferSource();
  src.buffer = noiseBuffer(ctx);
  src.loop = true;
  const filter = ctx.createBiquadFilter();
  filter.type = type;
  filter.frequency.value = freq;
  filter.Q.value = q;
  const gain = ctx.createGain();
  gain.gain.value = 0.0001;
  src.connect(filter);
  filter.connect(gain);
  if (rate > 0 && depth > 0) {
    const lfo = ctx.createOscillator();
    const lfoGain = ctx.createGain();
    lfo.type = 'sine';
    lfo.frequency.value = rate;
    lfoGain.gain.value = depth;
    lfo.connect(lfoGain);
    lfoGain.connect(gain.gain);
    lfo.start();
  }
  gain.connect(dest);
  src.start();
  return gain;
}

export function createAudio() {
  let ctx = null;
  let unlocked = false;
  let beds = null;
  let master = null;

  function startBeds(c) {
    if (beds) return;
    master = c.createGain();
    master.gain.value = AMBIENCE.master;
    master.connect(c.destination);
    beds = {
      surf: makeBed(c, master, { type: 'lowpass', freq: 900, q: 0.7, rate: 0.15, depth: 0.012 }),
      bamboo: makeBed(c, master, { type: 'bandpass', freq: 1800, q: 1.4 }),
      cicada: makeBed(c, master, { type: 'highpass', freq: 4000, q: 0.6, rate: 16, depth: 0.018 }),
      frogs: makeBed(c, master, { type: 'lowpass', freq: 600, q: 0.8, rate: 0.35, depth: 0.02 }),
    };
  }

  function ensure() {
    if (!ctx) ctx = makeCtx();
    if (ctx && ctx.state === 'suspended') ctx.resume();
    unlocked = !!(ctx && ctx.state === 'running');
    if (unlocked) startBeds(ctx);
    return ctx;
  }

  const unlock = () => { ensure(); };
  if (typeof addEventListener === 'function') {
    addEventListener('pointerdown', unlock, { once: true });
    addEventListener('keydown', unlock, { once: true });
  }

  function envGain(c, t, peak, attack, release) {
    const g = c.createGain();
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(Math.max(0.0002, peak), t + attack);
    g.gain.exponentialRampToValueAtTime(0.0001, t + attack + release);
    return g;
  }

  function chirp() {
    const c = ensure();
    if (!c || c.state !== 'running') return;
    const t = c.currentTime;
    const o = c.createOscillator();
    const g = envGain(c, t, 0.035, 0.012, 0.10);
    o.type = 'sine';
    const f0 = 1600 + Math.random() * 1100;
    o.frequency.setValueAtTime(f0, t);
    o.frequency.exponentialRampToValueAtTime(f0 * 0.62, t + 0.09);
    o.connect(g);
    g.connect(c.destination);
    o.start(t);
    o.stop(t + 0.14);
  }

  function flush() {
    for (let i = 0; i < 4; i++) setTimeout(chirp, i * 45);
  }

  function bark() {
    const c = ensure();
    if (!c || c.state !== 'running') return;
    const t = c.currentTime;
    const o = c.createOscillator();
    const g = envGain(c, t, 0.09, 0.008, 0.16);
    o.type = 'triangle';
    o.frequency.setValueAtTime(180, t);
    o.frequency.exponentialRampToValueAtTime(110, t + 0.14);
    o.connect(g);
    g.connect(c.destination);
    o.start(t);
    o.stop(t + 0.20);
    const n = c.createBufferSource();
    const buf = c.createBuffer(1, Math.floor(c.sampleRate * 0.12), c.sampleRate);
    const data = buf.getChannelData(0);
    for (let i = 0; i < data.length; i++) data[i] = (Math.random() * 2 - 1) * (1 - i / data.length);
    n.buffer = buf;
    const ng = envGain(c, t, 0.045, 0.004, 0.10);
    n.connect(ng);
    ng.connect(c.destination);
    n.start(t);
  }

  function handle(name) {
    if (name === 'call') chirp();
    else if (name === 'flush') flush();
    else if (name === 'bark') bark();
  }

  function update(weights, { paused = false } = {}) {
    if (!unlocked || !beds || !ctx) return;
    const mute = paused ? 0 : 1;
    const peak = {
      surf: 0.55,
      bamboo: 0.40,
      cicada: 0.28,
      frogs: 0.32,
    };
    const now = ctx.currentTime;
    for (const k of Object.keys(beds)) {
      const w = (weights?.[k] ?? 0) * mute;
      beds[k].gain.setTargetAtTime(Math.max(0.0001, peak[k] * w), now, 0.08);
    }
  }

  return {
    handle, ensure, update,
    get unlocked() { return unlocked; },
  };
}
