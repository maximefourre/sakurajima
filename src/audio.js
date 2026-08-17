/**
 * audio.js — tiny Web Audio layer. No files, no new deps.
 * Birds already emit 'call' / 'flush'; the shiba emits 'bark'.
 * First user gesture resumes the context (autoplay policy).
 */

function makeCtx() {
  const AC = globalThis.AudioContext || globalThis.webkitAudioContext;
  if (!AC) return null;
  return new AC();
}

export function createAudio() {
  let ctx = null;
  let unlocked = false;

  function ensure() {
    if (!ctx) ctx = makeCtx();
    if (ctx && ctx.state === 'suspended') ctx.resume();
    unlocked = !!(ctx && ctx.state === 'running');
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

  return { handle, ensure, get unlocked() { return unlocked; } };
}
