/**
 * heightcache.js — make heightAt() O(1).
 *
 * The problem it solves:
 *
 * `island.heightAt(x, z)` is genuinely expensive — five octaves of gradient
 * noise, domain warping, then the pond and river carve functions layered on
 * top. That is fine for the 160 000 terrain vertices, which are evaluated once.
 *
 * It is NOT fine for prop placement. Grass uses rejection sampling: it proposes
 * a point, asks how high and how steep the ground is there, and throws most
 * proposals away. At 300 000 accepted blades with a realistic accept rate, plus
 * `slopeAt` internally costing four more height queries, that is several million
 * full evaluations — which is exactly why the load crept past two minutes.
 *
 * The fix is to evaluate the expensive function on a grid ONCE, at the same
 * resolution as the terrain mesh, and answer every later query by bilinear
 * interpolation of that grid.
 *
 * Accuracy is not a compromise here, it is an improvement: the rendered terrain
 * is a triangle mesh, so its surface is already piecewise-linear between exactly
 * these grid points. Sampling the underlying continuous function actually puts
 * props slightly OFF the drawn surface, while interpolating the grid puts them
 * on it. Props stop hovering a few millimetres above the ground on convex
 * curvature and sinking into it on concave.
 */

/**
 * @param {(x:number,z:number)=>number} heightAt  expensive exact sampler
 * @param {number} size    world extent (the field covers [-size/2, +size/2])
 * @param {number} n       grid resolution; use the terrain's segment count
 */
export function buildHeightCache(heightAt, size, n) {
  const N = n + 1;
  const half = size * 0.5;
  const step = size / n;
  const inv = 1 / step;
  const grid = new Float32Array(N * N);

  for (let j = 0; j < N; j++) {
    const z = -half + j * step;
    const row = j * N;
    for (let i = 0; i < N; i++) {
      grid[row + i] = heightAt(-half + i * step, z);
    }
  }

  /** Bilinear sample. Clamps at the edges rather than wrapping. */
  function sample(x, z) {
    let fx = (x + half) * inv;
    let fz = (z + half) * inv;
    if (fx < 0) fx = 0; else if (fx > n) fx = n;
    if (fz < 0) fz = 0; else if (fz > n) fz = n;

    const i = fx | 0, j = fz | 0;
    const i1 = i < n ? i + 1 : i;
    const j1 = j < n ? j + 1 : j;
    const tx = fx - i, tz = fz - j;

    const r0 = j * N, r1 = j1 * N;
    const h00 = grid[r0 + i], h10 = grid[r0 + i1];
    const h01 = grid[r1 + i], h11 = grid[r1 + i1];

    return (h00 * (1 - tx) + h10 * tx) * (1 - tz)
         + (h01 * (1 - tx) + h11 * tx) * tz;
  }

  /**
   * Slope as 0..1, from central differences on the cached grid.
   * 0 = flat, 1 = vertical. Four array reads instead of four full noise
   * evaluations, which is where most of the saving actually comes from.
   */
  function slope(x, z) {
    const d = step;
    const hx = sample(x + d, z) - sample(x - d, z);
    const hz = sample(x, z + d) - sample(x, z - d);
    const g = Math.hypot(hx, hz) / (2 * d);
    return g / (1 + g); // map [0, inf) -> [0, 1)
  }

  return { sample, slope, grid, N, step };
}
