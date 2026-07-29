/**
 * seasonal-foliage.js — shared autumn dominant palette + maple silhouette.
 *
 * Used by sakura crown bake, airborne petals and the ground carpet so the
 * three systems agree on family names, colours and leaf shape without
 * forking generators.
 */

export const AUTUMN_DOMINANT_SEQUENCE = Object.freeze([
  'red', 'orange', 'red', 'yellow', 'orange', 'green', 'red', 'orange', 'yellow', 'green',
]);

/** sRGB hex triplets per family: shadow / mid / sun. */
export const AUTUMN_PALETTES = Object.freeze({
  red:    Object.freeze({ shadow: '#6f1f28', mid: '#a82c2f', sun: '#d85a3b' }),
  orange: Object.freeze({ shadow: '#8a351d', mid: '#c85a22', sun: '#ee8a32' }),
  yellow: Object.freeze({ shadow: '#80651f', mid: '#b99326', sun: '#e5c04b' }),
  green:  Object.freeze({ shadow: '#40552c', mid: '#66783a', sun: '#93a653' }),
});

const DOMINANT_SET = new Set(Object.keys(AUTUMN_PALETTES));

export function isAutumnDominant(value) {
  return typeof value === 'string' && DOMINANT_SET.has(value);
}

/**
 * Deterministic dominant for the n-th placed tree (or the n-th unbound leaf).
 * Sequence is rotated by seed % 10 so different seeds start on a different
 * family without consuming any scene RNG draw.
 */
export function dominantForIndex(index, seed = 0) {
  const seq = AUTUMN_DOMINANT_SEQUENCE;
  const i = Number.isFinite(index) ? Math.trunc(index) : 0;
  const s = Number.isFinite(seed) ? Math.trunc(seed) : 0;
  // Safe positive modulo even for negative seeds/indices.
  const shift = ((s % 10) + 10) % 10;
  const idx = ((i % seq.length) + seq.length) % seq.length;
  return seq[(idx + shift) % seq.length];
}

/**
 * Shared maple leaf silhouette + veins for crown / air / carpet shaders.
 * Local p is in [-1,1]² with +Y toward the tip, petiole toward -Y.
 */
export const MAPLE_SHAPE_GLSL = /* glsl */ `
float mapleLobe(vec2 p, float ang, float len, float wid) {
  float c = cos(ang), s = sin(ang);
  vec2 q = vec2(c * p.x + s * p.y, -s * p.x + c * p.y);
  q.y -= len * 0.42;
  q.x /= max(1e-4, wid);
  q.y /= max(1e-4, len * 0.58);
  // pointed ellipse: taper to a tip, blunt near the base
  float d = length(vec2(q.x, q.y * 1.05)) + 0.18 * abs(q.x) * max(0.0, -q.y);
  return 1.0 - smoothstep(0.78, 1.02, d);
}

float mapleAlpha(vec2 p, float variant) {
  // slight per-instance yaw so neighbouring leaves do not stack
  float yaw = (fract(variant * 7.13) - 0.5) * 0.22;
  float c = cos(yaw), s = sin(yaw);
  vec2 q = vec2(c * p.x + s * p.y, -s * p.x + c * p.y);

  // petiole hangs below the body
  float petiole = 0.0;
  {
    vec2 t = q - vec2(0.0, -0.72);
    float hw = 0.08 * mix(1.0, 0.55, smoothstep(-0.25, 0.05, t.y));
    float d = max(abs(t.x) - hw, abs(t.y) - 0.25);
    petiole = 1.0 - smoothstep(0.0, 0.04, d);
  }

  // central body under the five lobes
  float body;
  {
    vec2 t = q - vec2(0.0, -0.08);
    t.x *= 1.55;
    t.y *= 1.25;
    body = 1.0 - smoothstep(0.42, 0.62, length(t));
  }

  float a0 = mapleLobe(q, radians(90.0),  1.00, 0.23);
  float a1 = mapleLobe(q, radians(38.0),  0.78, 0.22);
  float a2 = mapleLobe(q, radians(-38.0), 0.78, 0.22);
  float a3 = mapleLobe(q, radians(70.0),  0.56, 0.18);
  float a4 = mapleLobe(q, radians(-70.0), 0.56, 0.18);
  float lobes = max(a0, max(a1, max(a2, max(a3, a4))));

  float alpha = max(petiole, max(body, lobes));

  // edge serration — nibble the silhouette, keep interior solid
  float ang = atan(q.y, q.x);
  float r = length(q);
  float ser = sin(18.0 * ang + variant) * 0.035;
  alpha *= 1.0 - smoothstep(0.78 + ser, 1.05 + ser, r) * (1.0 - body * 0.5);

  return clamp(alpha, 0.0, 1.0);
}

float mapleVeins(vec2 p, float variant) {
  float yaw = (fract(variant * 7.13) - 0.5) * 0.22;
  float c = cos(yaw), s = sin(yaw);
  vec2 q = vec2(c * p.x + s * p.y, -s * p.x + c * p.y);

  float v = 0.0;
  // five veins along the lobe axes, plus a short midrib into the petiole
  float angs[5];
  angs[0] = radians(90.0);
  angs[1] = radians(38.0);
  angs[2] = radians(-38.0);
  angs[3] = radians(70.0);
  angs[4] = radians(-70.0);
  for (int i = 0; i < 5; i++) {
    float ca = cos(angs[i]), sa = sin(angs[i]);
    vec2 t = vec2(ca * q.x + sa * q.y, -sa * q.x + ca * q.y);
    // vein runs along +Y of the rotated frame from the centre outward
    float along = smoothstep(-0.05, 0.10, t.y) * (1.0 - smoothstep(0.55, 0.95, t.y));
    float vein = (1.0 - smoothstep(0.0, 0.028, abs(t.x))) * along;
    v = max(v, vein);
  }
  // midrib down into the petiole
  {
    float along = smoothstep(0.15, -0.05, q.y) * smoothstep(-0.95, -0.55, q.y);
    float mid = (1.0 - smoothstep(0.0, 0.022, abs(q.x))) * along;
    v = max(v, mid);
  }
  return clamp(v, 0.0, 1.0);
}
`;
