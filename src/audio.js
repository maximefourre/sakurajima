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

/**
 * Une cigale : bruit en bande étroite, trille AM rapide, phrase (gain
 * piloté par update) puis panoramique. Le lit global n'est plus un souffle
 * continu — chaque voix chante par phrases séparées de silences.
 */
function makeCicadaVoice(ctx, dest, { freq, pan, trill }) {
  const src = ctx.createBufferSource();
  src.buffer = noiseBuffer(ctx);
  src.loop = true;
  const filter = ctx.createBiquadFilter();
  filter.type = 'bandpass';
  filter.frequency.value = freq;
  filter.Q.value = 4;
  // Trille : gain oscillant 0..1 (pas un léger tremolo de 2 %).
  const am = ctx.createGain();
  am.gain.value = 0.5;
  const lfo = ctx.createOscillator();
  lfo.type = 'sine';
  lfo.frequency.value = trill;
  const lfoGain = ctx.createGain();
  lfoGain.gain.value = 0.5;
  lfo.connect(lfoGain);
  lfoGain.connect(am.gain);
  lfo.start();
  const phrase = ctx.createGain();
  phrase.gain.value = 0;
  src.connect(filter);
  filter.connect(am);
  am.connect(phrase);
  let out = phrase;
  if (ctx.createStereoPanner) {
    const p = ctx.createStereoPanner();
    p.pan.value = pan;
    phrase.connect(p);
    out = p;
  }
  out.connect(dest);
  src.start();
  // Premier chant décalé : pas de mur sonore au déverrouillage.
  return { phrase, filter, lfo, freq, trill, nextAt: ctx.currentTime + 1 + Math.random() * 5 };
}

/** Programme une phrase : montée, tenue, déclin, puis un silence. */
function scheduleCicada(v, now) {
  if (now < v.nextAt) return;
  const len = 3 + Math.random() * 6;
  const rise = 0.8 + Math.random() * 1.2;
  const fall = 1.2 + Math.random() * 1.8;
  const g = v.phrase.gain;
  g.cancelScheduledValues(now);
  g.setValueAtTime(0, now);
  g.linearRampToValueAtTime(1, now + rise);
  g.setValueAtTime(1, now + len - fall);
  g.linearRampToValueAtTime(0, now + len);
  v.filter.frequency.setValueAtTime(v.freq * (0.92 + Math.random() * 0.16), now);
  v.lfo.frequency.setValueAtTime(v.trill * (0.85 + Math.random() * 0.3), now);
  v.nextAt = now + len + 4 + Math.random() * 12;
}

/** Destination des SFX : le master s'il existe, sinon le contexte (unlock). */
export function sfxOut(ctx, masterNode) {
  return masterNode || ctx.destination;
}

export function createAudio() {
  let ctx = null;
  let unlocked = false;
  let beds = null;
  let master = null;
  let cicadas = [];

  function startBeds(c) {
    if (beds) return;
    master = c.createGain();
    master.gain.value = AMBIENCE.master;
    master.connect(c.destination);
    beds = {
      surf: makeBed(c, master, { type: 'lowpass', freq: 900, q: 0.7, rate: 0.15, depth: 0.012 }),
      bamboo: makeBed(c, master, { type: 'bandpass', freq: 1800, q: 1.4 }),
      cicada: c.createGain(),
      frogs: makeBed(c, master, { type: 'lowpass', freq: 600, q: 0.8, rate: 0.35, depth: 0.02 }),
    };
    beds.cicada.gain.value = 0.0001;
    beds.cicada.connect(master);
    cicadas = [
      makeCicadaVoice(c, beds.cicada, { freq: 5200, pan: -0.6, trill: 38 }),
      makeCicadaVoice(c, beds.cicada, { freq: 6100, pan: 0.5, trill: 52 }),
      makeCicadaVoice(c, beds.cicada, { freq: 4600, pan: 0.05, trill: 27 }),
    ];
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
    g.connect(sfxOut(c, master));
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
    g.connect(sfxOut(c, master));
    o.start(t);
    o.stop(t + 0.20);
    const n = c.createBufferSource();
    const buf = c.createBuffer(1, Math.floor(c.sampleRate * 0.12), c.sampleRate);
    const data = buf.getChannelData(0);
    for (let i = 0; i < data.length; i++) data[i] = (Math.random() * 2 - 1) * (1 - i / data.length);
    n.buffer = buf;
    const ng = envGain(c, t, 0.045, 0.004, 0.10);
    n.connect(ng);
    ng.connect(sfxOut(c, master));
    n.start(t);
  }

  function handle(name) {
    if (name === 'call') chirp();
    else if (name === 'flush') flush();
    else if (name === 'bark') bark();
  }

  function update(weights) {
    if (!unlocked || !beds || !ctx) return;
    const peak = {
      surf: 0.55,
      bamboo: 0.40,
      cicada: 0.12,
      frogs: 0.32,
    };
    const now = ctx.currentTime;
    for (const v of cicadas) scheduleCicada(v, now);
    for (const k of Object.keys(beds)) {
      const w = weights?.[k] ?? 0;
      beds[k].gain.setTargetAtTime(Math.max(0.0001, peak[k] * w), now, 0.08);
    }
  }

  return {
    handle, ensure, update,
    get unlocked() { return unlocked; },
  };
}
