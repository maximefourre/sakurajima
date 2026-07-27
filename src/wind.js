/**
 * wind.js — the shared wind field. Everything that moves reads from this.
 *
 * Design note, because this is the difference between "3D scene" and "place":
 *
 * The obvious implementation is `sin(time) * direction`. It is also the reason
 * most rendered vegetation looks like it is in a wind tunnel — a permanent,
 * even, directionless shudder. Real wind on an exposed island is intermittent.
 * It goes properly slack for ten, twenty seconds; then you see a dark line move
 * across the grass as a squall arrives; it hits, everything leans; it passes.
 *
 * So the model here is a GUST TRAIN:
 *
 *   strength(t) = pow( max(0, fbm(t) - lullFloor) / (1 - lullFloor), sharpness )
 *
 * Subtracting the floor before the power curve is the whole trick — it clamps
 * the majority of the timeline to dead calm and leaves only the noise peaks as
 * gusts. Raising the remainder to a power makes those peaks hit hard and decay,
 * instead of swelling politely.
 *
 * Direction is a random walk (noise-driven heading), not a slow rotation, plus
 * occasional sharp veers, so consecutive gusts genuinely arrive from different
 * quarters rather than marching around the compass in order.
 *
 * Spatially, the gust envelope is sampled at a point that TRANSLATES along the
 * wind heading over time, so the gust front physically travels across the
 * island. That travelling wavefront is the thing you actually see.
 *
 * The GLSL below reimplements the identical model so the GPU-side vegetation and
 * the CPU-side birds/petal-spawning agree on when it is windy.
 */

import * as THREE from 'three';
import { WIND } from './config.js';
import { NOISE_GLSL, noise2, clamp, smoothstep } from './noise.js';

/* ────────────────────────────────────────────────────────────────
   CPU side
   ──────────────────────────────────────────────────────────────── */

/** 1D fbm built from the shared 2D gradient noise, sampled along a line. */
function fbm1(t, oct = 4) {
  let s = 0, a = 0.5, f = 1, n = 0;
  for (let i = 0; i < oct; i++) {
    s += a * noise2(t * f, i * 31.7);
    n += a;
    a *= 0.5;
    f *= 2.03;
  }
  return s / n; // ~[-1, 1]
}

export function createWind() {
  // Hoisted scratch — never allocate inside update().
  const _v = new THREE.Vector3();

  const uniforms = {
    uTime:          { value: 0 },
    uWindDir:       { value: new THREE.Vector2(Math.cos(WIND.baseDir), Math.sin(WIND.baseDir)) },
    uWindStrength:  { value: 0 },     // current global gust envelope, 0..gustPeak
    uWindMaster:    { value: WIND.strength }, // UI slider
    uGustScale:     { value: WIND.gustScale },
    uGustSpeed:     { value: WIND.gustSpeed },
    uFrontSharp:    { value: WIND.frontSharpness },
    uTurbulence:    { value: WIND.turbulence },
    uTurbScale:     { value: WIND.turbScale },
    uTurbRate:      { value: WIND.turbRate },
    uLullFloor:     { value: WIND.lullFloor },
    uGustSharp:     { value: WIND.gustSharpness },
    uCalmDrift:     { value: WIND.calmDrift },
  };

  const state = {
    heading: WIND.baseDir,
    strength: 0,
    /** 0..1 — how "gusty" it is right now. Birds, petals and audio can read this. */
    gust: 0,
    /** Set true on the frame a new squall crosses the threshold. */
    gustOnset: false,
  };

  let _wasGusting = false;
  let _veerOffset = 0;
  let _veerTarget = 0;

  /** Global gust envelope at time t: mostly calm, punctuated. */
  function envelope(t) {
    const n = fbm1(t * WIND.gustRate, 4) * 0.5 + 0.5;       // -> 0..1
    const above = Math.max(0, n - WIND.lullFloor) / (1 - WIND.lullFloor);
    return Math.pow(above, WIND.gustSharpness) * WIND.gustPeak + WIND.calmDrift;
  }

  /** Heading at time t: random walk, with occasional abrupt veers. */
  function heading(t) {
    return WIND.baseDir + fbm1(t * WIND.dirNoiseRate + 101.3, 3) * WIND.dirRange + _veerOffset;
  }

  function update(t, dt) {
    const env = envelope(t);
    state.strength = env;
    state.gust = clamp(env / WIND.gustPeak, 0, 1);

    // Detect the leading edge of a squall so other systems can react to it.
    const gusting = state.gust > 0.32;
    state.gustOnset = gusting && !_wasGusting;

    // On a new gust, sometimes veer sharply — successive squalls should not all
    // come from the same quarter.
    if (state.gustOnset) {
      const roll = Math.abs(fbm1(t * 7.13 + 55.5, 2));
      if (roll < WIND.veerChance) {
        _veerTarget += (fbm1(t * 3.7 + 88.1, 2) > 0 ? 1 : -1) * WIND.veerAmount;
      }
    }
    _wasGusting = gusting;

    // Ease toward the veer target so the shift is fast but not instantaneous.
    _veerOffset += (_veerTarget - _veerOffset) * Math.min(1, dt * 1.4);

    state.heading = heading(t);

    uniforms.uTime.value = t;
    uniforms.uWindStrength.value = env;
    uniforms.uWindDir.value.set(Math.cos(state.heading), Math.sin(state.heading));
  }

  /**
   * Wind vector at a world position — the CPU twin of `windForce()` in GLSL.
   * Used by birds, cloud drift, and petal spawning.
   */
  function windAt(x, z, t, out = _v) {
    const dx = Math.cos(state.heading);
    const dz = Math.sin(state.heading);

    // Sample the spatial gust field at a point translating along the heading,
    // so the front sweeps across the island.
    const travel = t * WIND.gustSpeed;
    const sx = (x - dx * travel) * WIND.gustScale;
    const sz = (z - dz * travel) * WIND.gustScale;
    let front = noise2(sx, sz) * 0.5 + 0.5;
    front = Math.pow(front, WIND.frontSharpness);

    const mag = state.strength * front * WIND.strength;

    // High-frequency chop — small, fast, mostly lateral.
    const tu = noise2(x * WIND.turbScale + t * WIND.turbRate, z * WIND.turbScale) * WIND.turbulence * 0.25;

    return out.set(
      dx * mag + -dz * tu,
      tu * 0.4,
      dz * mag + dx * tu
    );
  }

  function setMaster(v) {
    WIND.strength = v;
    uniforms.uWindMaster.value = v;
  }

  return { uniforms, state, update, windAt, setMaster, WIND_GLSL };
}

/* ────────────────────────────────────────────────────────────────
   GPU side — identical model, for vertex shaders
   ──────────────────────────────────────────────────────────────── */

/**
 * Prepend this to any vertex shader that needs to move with the wind, after
 * NOISE_GLSL. Provides:
 *
 *   float windGust(vec3 worldPos)          -> 0..~gustPeak, the local gust magnitude
 *   vec3  windForce(vec3 worldPos, float t)-> full displacement vector
 *
 * Requires these uniforms to be present on the material (share the object from
 * createWind().uniforms by reference so one update drives every material):
 *   uTime uWindDir uWindStrength uWindMaster uGustScale uGustSpeed
 *   uFrontSharp uTurbulence uTurbScale uTurbRate
 */
export const WIND_GLSL = /* glsl */ `
  uniform float uTime;
  uniform vec2  uWindDir;
  uniform float uWindStrength;
  uniform float uWindMaster;
  uniform float uGustScale;
  uniform float uGustSpeed;
  uniform float uFrontSharp;
  uniform float uTurbulence;
  uniform float uTurbScale;
  uniform float uTurbRate;

  // Local gust magnitude, including the travelling wavefront.
  float windGust(vec3 worldPos) {
    vec2 dir = uWindDir;
    float travel = uTime * uGustSpeed;
    vec2 s = (worldPos.xz - dir * travel) * uGustScale;

    float front = sk_noise3(vec3(s, 0.0)) * 0.5 + 0.5;
    front = pow(max(front, 0.0), uFrontSharp);

    return uWindStrength * front * uWindMaster;
  }

  // Full wind displacement at a world position.
  vec3 windForce(vec3 worldPos, float t) {
    vec2 dir = uWindDir;
    float mag = windGust(worldPos);

    // High-frequency chop: small, fast, mostly lateral to the main flow.
    float turb = sk_noise3(vec3(worldPos.xz * uTurbScale, t * uTurbRate)) * uTurbulence * 0.25;
    vec2 perp = vec2(-dir.y, dir.x);

    return vec3(
      dir.x * mag + perp.x * turb,
      turb * 0.4,
      dir.y * mag + perp.y * turb
    );
  }

  // Single-argument overload. Some subsystems were written against the shorter
  // contract windForce(worldPos); GLSL supports overloading, so both callers
  // work against one implementation rather than forking the wind model.
  vec3 windForce(vec3 worldPos) {
    return windForce(worldPos, uTime);
  }
`;
