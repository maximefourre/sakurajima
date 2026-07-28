/**
 * details.js — the small things you only see once you are standing on the island.
 *
 * The scene was built from the outside in: an island, a sea, a sky, weather. All
 * of that reads from two hundred units away and none of it reads from two. Now
 * that there is a dog to walk, the ground is somewhere you actually go, and an
 * unbroken green field with trees standing in it looks like a golf course.
 *
 * Three passes, in the order they matter at eye level:
 *
 *   1. Wildflowers, in drifts rather than sprinkled. Real meadows are patchy —
 *      a species takes a hollow and holds it — and an even scatter is the single
 *      most reliable way to make procedural planting look procedural.
 *   2. Stone lanterns, which are the only man-made thing on the island besides
 *      the bridge. They also give the night cycle something to do at ground
 *      level: their fire boxes come up as the sun goes down.
 *   3. Beach litter — pebbles and driftwood along the tideline, where the eye
 *      goes looking for scale and currently finds an unbroken sweep of sand.
 *
 * Everything is instanced and everything is seeded. No textures, as elsewhere.
 */

import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { streamFor, R, fbm2, clamp, smoothstep } from './noise.js';
import { WORLD, LAND_SCALE } from './config.js';

const TAU = Math.PI * 2;

/* ── art direction ───────────────────────────────────────────────
 * Four species, weighted. The white daisy is the workhorse and reads at the
 * longest range; the others are accents. Deep violet is only 8% of the mix —
 * it is there to be found, not to be seen. */
// Sizes are frankly larger than life. A real daisy is 3 cm across, which at this
// world scale is four millimetres of corolla hidden among 55 cm grass blades —
// present in the buffer, invisible on screen. Blown up to roughly the size of a
// small poppy they read as flowers from where the dog actually walks.
const FLOWERS = [
  { name: 'daisy',   weight: 0.44, petal: 0xfbf7ee, heart: 0xe8c25c, petals: 8, size: 0.155, height: [0.42, 0.66] },
  { name: 'buttercup', weight: 0.27, petal: 0xf5c93f, heart: 0xd99a1e, petals: 5, size: 0.130, height: [0.34, 0.54] },
  { name: 'clover',  weight: 0.21, petal: 0xe9b6cd, heart: 0xf0d7e2, petals: 6, size: 0.118, height: [0.28, 0.46] },
  { name: 'harebell', weight: 0.08, petal: 0x8f7fd0, heart: 0xcfc6f0, petals: 5, size: 0.140, height: [0.46, 0.72] },
];

const STONE = 0x9a9691;
const STONE_DARK = 0x716d69;
const LANTERN_LIGHT = 0xffc978;

/* ────────────────────────────────────────────────────────────────
   Flower geometry
   ──────────────────────────────────────────────────────────────── */

/**
 * One flower: a stem of two crossed quads and a corolla of flat petals around a
 * disc. Modelled rather than billboarded because these are walked past at half a
 * metre, where a camera-facing quad spins in a way nothing in a meadow does.
 *
 * `aBase` carries the local height of each vertex up the stem, 0 at the root and
 * 1 at the corolla. The wind bend in the vertex shader is proportional to its
 * square, which is what makes the stem arc instead of shear.
 */
function makeFlowerGeometry(spec, rng) {
  const pos = [], nrm = [], col = [], base = [], idx = [];
  const petal = new THREE.Color(spec.petal);
  const heart = new THREE.Color(spec.heart);
  const stemCol = new THREE.Color(0x5f8a42);
  const h = R.range(rng, spec.height[0], spec.height[1]);

  const push = (x, y, z, nx, ny, nz, c, b) => {
    pos.push(x, y, z); nrm.push(nx, ny, nz);
    col.push(c.r, c.g, c.b); base.push(b);
    return pos.length / 3 - 1;
  };

  // — stem: two quads at right angles, so it has a silhouette from any side —
  const sw = 0.011;
  for (let k = 0; k < 2; k++) {
    const a = k * Math.PI * 0.5;
    const dx = Math.cos(a) * sw, dz = Math.sin(a) * sw;
    const nx = -Math.sin(a), nz = Math.cos(a);
    const a0 = push(-dx, 0, -dz, nx, 0.15, nz, stemCol, 0);
    const a1 = push(dx, 0, dz, nx, 0.15, nz, stemCol, 0);
    const a2 = push(-dx * 0.55, h, -dz * 0.55, nx, 0.15, nz, stemCol, 1);
    const a3 = push(dx * 0.55, h, dz * 0.55, nx, 0.15, nz, stemCol, 1);
    idx.push(a0, a1, a2, a1, a3, a2);
  }

  // — corolla: a fan of petals about a small centre disc —
  const n = spec.petals;
  const r = spec.size;
  // Petals lift well out of the plane. A flat corolla is edge-on from the height
  // a dog's camera sits at, and edge-on it is one dark pixel.
  const tilt = 0.42;
  const centre = push(0, h, 0, 0, 1, 0, heart, 1);
  for (let i = 0; i < n; i++) {
    const a0 = (i / n) * TAU;
    const a1 = ((i + 0.5) / n) * TAU;
    const a2 = ((i + 1) / n) * TAU;
    const inner = r * 0.26;
    const b0 = push(Math.cos(a0) * inner, h + 0.004, Math.sin(a0) * inner, 0, 1, 0, heart, 1);
    const b2 = push(Math.cos(a2) * inner, h + 0.004, Math.sin(a2) * inner, 0, 1, 0, heart, 1);
    const tip = push(Math.cos(a1) * r, h + tilt * r, Math.sin(a1) * r, 0, 1, 0, petal, 1);
    // Wound so the GEOMETRIC front face points up, agreeing with the (0,1,0)
    // normal above. Listing the ring in increasing-angle order reads naturally
    // and produces the opposite: on a DoubleSide material three then flips the
    // shading normal for the back face you are actually looking at, aims it at
    // the ground, and every flower in the meadow comes out a dead brown star.
    idx.push(centre, b2, b0);
    idx.push(b0, b2, tip);
  }

  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('normal', new THREE.Float32BufferAttribute(nrm, 3));
  g.setAttribute('color', new THREE.Float32BufferAttribute(col, 3));
  g.setAttribute('aBase', new THREE.Float32BufferAttribute(base, 1));
  g.setIndex(idx);
  return g;
}

/* ────────────────────────────────────────────────────────────────
   Stone lantern
   ──────────────────────────────────────────────────────────────── */

/**
 * A kasuga-doro: pedestal, shaft, platform, fire box, roof, finial.
 *
 * Returned as ONE merged geometry rather than a group of seven meshes. Seven
 * meshes times six lanterns is forty-two draw calls for something that occupies
 * a few hundred pixels; merged and instanced it is one. The parts are painted
 * into a vertex colour attribute before merging so the pedestal can still be a
 * darker stone than the shaft.
 */
function makeLanternGeometry() {
  const parts = [];
  const tint = new THREE.Color();

  const part = (geo, hex, y, ry = 0, x = 0, z = 0) => {
    if (ry) geo.rotateY(ry);
    geo.translate(x, y, z);
    tint.setHex(hex);
    const n = geo.attributes.position.count;
    const c = new Float32Array(n * 3);
    for (let i = 0; i < n; i++) { c[i * 3] = tint.r; c[i * 3 + 1] = tint.g; c[i * 3 + 2] = tint.b; }
    geo.setAttribute('color', new THREE.Float32BufferAttribute(c, 3));
    geo.deleteAttribute('uv');   // merge refuses to combine a set with mismatched attributes
    parts.push(geo);
  };

  part(new THREE.CylinderGeometry(0.40, 0.46, 0.20, 12), STONE_DARK, 0.10);
  part(new THREE.CylinderGeometry(0.15, 0.19, 1.05, 10), STONE, 0.72);
  part(new THREE.CylinderGeometry(0.36, 0.24, 0.16, 12), STONE, 1.32);

  // The fire box is OPEN: two hexagonal slabs and six corner posts. It was a
  // solid drum first, which hid the light inside it — the glow sphere failed the
  // depth test against the near wall and the lanterns stayed dark all night with
  // every uniform reading correctly. Openings are also simply what the object is:
  // a kasuga-doro is a stone frame around a flame, not a barrel.
  part(new THREE.CylinderGeometry(0.30, 0.31, 0.055, 6), STONE, 1.42);
  part(new THREE.CylinderGeometry(0.33, 0.31, 0.070, 6), STONE, 1.80);
  for (let i = 0; i < 6; i++) {
    const a = (i / 6) * TAU + Math.PI / 6;
    part(new THREE.BoxGeometry(0.062, 0.34, 0.062), STONE, 1.61, a,
      Math.cos(a) * 0.265, Math.sin(a) * 0.265);
  }

  // A six-sided roof with a pronounced flare, and a finial.
  part(new THREE.ConeGeometry(0.56, 0.34, 6, 1), STONE, 2.01, Math.PI / 6);
  part(new THREE.SphereGeometry(0.10, 8, 6), STONE, 2.22);

  const merged = mergeGeometries(parts);
  for (const p of parts) p.dispose();
  merged.computeBoundingSphere();
  return merged;
}

/* ────────────────────────────────────────────────────────────────
   Factory
   ──────────────────────────────────────────────────────────────── */

/**
 * @param {object}   opts
 * @param {number}   [opts.seed]
 * @param {object}   opts.quality   one of config.QUALITY
 * @param {Function} opts.heightAt
 * @param {Function} [opts.slopeAt]
 * @param {Function} [opts.normalAt]
 * @param {Function} [opts.inWater]  (x, z) => bool — ponds and river
 * @param {object}   [opts.wind]     from createWind(); shared BY REFERENCE
 */
export function createDetails({
  seed = 1337,
  quality = null,
  heightAt,
  slopeAt = null,
  normalAt = null,
  inWater = null,
  wind = null,
} = {}) {
  if (typeof heightAt !== 'function') {
    throw new Error('[details] createDetails requires heightAt(x, z) -> y');
  }

  const group = new THREE.Group();
  group.name = 'details';
  const disposables = [];
  const label = quality?.label ?? 'high';
  const budget = label === 'ultra' ? 1.0 : label === 'high' ? 0.62 : 0.3;

  const wet = (x, z) => (inWater ? inWater(x, z) : false);

  /* ── 1. wildflowers ──────────────────────────────────────────── */

  const flowerMeshes = [];
  {
    const rng = streamFor(seed, 'details.flowers');
    const total = Math.round(9000 * budget);

    // Species are laid out as separate drifts, each with its own low-frequency
    // mask offset, so they clump apart from each other instead of every patch
    // being a uniform mixture of all four.
    const _m = new THREE.Matrix4();
    const _q = new THREE.Quaternion();
    const _p = new THREE.Vector3();
    const _s = new THREE.Vector3();
    const _n = new THREE.Vector3();

    for (let f = 0; f < FLOWERS.length; f++) {
      const spec = FLOWERS[f];
      const want = Math.max(1, Math.round(total * spec.weight));
      const geo = makeFlowerGeometry(spec, rng);
      disposables.push(geo);

      const mat = makeFoliageMaterial(wind);
      disposables.push(mat);

      const mesh = new THREE.InstancedMesh(geo, mat, want);
      mesh.name = `flowers-${spec.name}`;
      mesh.castShadow = false;      // 9k shadow casters for 8cm of geometry is not a trade
      mesh.receiveShadow = true;
      mesh.instanceMatrix.setUsage(THREE.StaticDrawUsage);

      const driftX = f * 137.7, driftZ = f * 91.3;
      let placed = 0, attempts = 0;
      const maxAttempts = want * 40;

      while (placed < want && attempts < maxAttempts) {
        attempts++;
        const x = R.range(rng, -104 * LAND_SCALE, 104 * LAND_SCALE);
        const z = R.range(rng, -112 * LAND_SCALE, 96 * LAND_SCALE);

        // Drift mask first — it rejects most candidates for the price of one
        // noise lookup, which is what keeps the attempt loop affordable.
        //
        // noise.js's fbm2 is GRADIENT noise: it is centred on zero and runs
        // roughly -0.7..0.7, not 0..1. Thresholding it as if it were unit-range
        // passes only the top few percent, which here meant asking for four
        // thousand daisies and planting fourteen.
        const drift = fbm2((x + driftX) * 0.026, (z + driftZ) * 0.026, 3) * 0.5 + 0.5;
        const p = smoothstep(0.42, 0.62, drift);
        if (p <= 0.02 || rng() > p) continue;

        const h = heightAt(x, z);
        if (h < WORLD.beachTop + 0.5 || h > WORLD.grassTop - 1.5) continue;
        if (slopeAt && slopeAt(x, z) > 0.34) continue;
        if (wet(x, z)) continue;

        if (normalAt) normalAt(x, z, _n); else _n.set(0, 1, 0);
        _n.lerp(UP, 0.45).normalize();
        _q.setFromUnitVectors(UP, _n);
        _q.multiply(_spinQ.setFromAxisAngle(UP, rng() * TAU));
        const sc = R.range(rng, 0.78, 1.35);
        _m.compose(_p.set(x, h - 0.02, z), _q, _s.set(sc, sc, sc));
        mesh.setMatrixAt(placed++, _m);
      }

      mesh.count = placed;
      mesh.instanceMatrix.needsUpdate = true;
      mesh.computeBoundingSphere();
      group.add(mesh);
      flowerMeshes.push(mesh);
    }
  }

  /* ── 2. stone lanterns ───────────────────────────────────────── */

  let glowMesh = null;
  let lanternCount = 0;
  {
    const rng = streamFor(seed, 'details.lanterns');
    // Hand-placed rather than scattered. Lanterns mark a route — one standing on
    // its own in the middle of a field reads as set dressing nobody put there.
    const spots = [
      [-14, 26], [4, 40], [22, 54], [40, 66],   // the approach to the bridge
      [-52, 6], [-38, -14],                     // up towards the ridge
    ].map(([x, z]) => [x * LAND_SCALE, z * LAND_SCALE]);
    const usable = spots.filter(([x, z]) => heightAt(x, z) >= WORLD.beachTop && !wet(x, z));
    lanternCount = usable.length;

    if (lanternCount > 0) {
      const geo = makeLanternGeometry();
      const mat = new THREE.MeshStandardMaterial({
        vertexColors: true, roughness: 0.94, metalness: 0,
      });
      disposables.push(geo, mat);

      const stones = new THREE.InstancedMesh(geo, mat, lanternCount);
      stones.name = 'lanterns';
      stones.castShadow = true;
      stones.receiveShadow = true;

      // Additive blending plus a per-instance colour is how six lanterns get six
      // independent brightnesses out of one draw call: InstancedMesh has no
      // per-instance alpha, but an additive black instance contributes nothing.
      // Sized to sit inside the fire box's frame (slabs at 1.42 and 1.80) and
      // show between the corner posts, not through them.
      const glowGeo = new THREE.SphereGeometry(0.185, 10, 8);
      // `vertexColors: true` and a white colour attribute are BOTH required, and
      // neither is optional: three's color_fragment chunk is guarded on USE_COLOR
      // alone, so an instanceColor on a material without vertexColors is uploaded,
      // multiplied into vColor in the vertex stage, and then never read — the
      // fragment does not even declare the varying. And with vertexColors on but
      // no `color` attribute, the missing attribute reads as black.
      {
        const n = glowGeo.attributes.position.count;
        glowGeo.setAttribute('color', new THREE.Float32BufferAttribute(new Float32Array(n * 3).fill(1), 3));
      }
      const glowMat = new THREE.MeshBasicMaterial({
        vertexColors: true,
        transparent: true,
        depthWrite: false,
        blending: THREE.AdditiveBlending,
      });
      disposables.push(glowGeo, glowMat);
      glowMesh = new THREE.InstancedMesh(glowGeo, glowMat, lanternCount);
      glowMesh.name = 'lantern-glows';
      glowMesh.renderOrder = 3;
      glowMesh.frustumCulled = false;

      const _m = new THREE.Matrix4();
      const _q = new THREE.Quaternion();
      const _e = new THREE.Euler();
      const _p = new THREE.Vector3();
      const _s = new THREE.Vector3(1, 1, 1);

      for (let i = 0; i < lanternCount; i++) {
        const [x, z] = usable[i];
        const h = heightAt(x, z);
        // A stone lantern that has stood in a meadow for a century is not plumb.
        _e.set(R.range(rng, -0.045, 0.045), rng() * TAU, R.range(rng, -0.045, 0.045));
        _q.setFromEuler(_e);
        _m.compose(_p.set(x, h - 0.05, z), _q, _s);
        stones.setMatrixAt(i, _m);
        _m.compose(_p.set(x, h - 0.05 + 1.61, z), _q, _s);
        glowMesh.setMatrixAt(i, _m);
        glowMesh.setColorAt(i, _glowCol.setRGB(0, 0, 0));
      }
      stones.instanceMatrix.needsUpdate = true;
      glowMesh.instanceMatrix.needsUpdate = true;
      glowMesh.instanceColor.needsUpdate = true;
      stones.computeBoundingSphere();
      group.add(stones, glowMesh);
    }
  }

  /* ── 3. tideline ─────────────────────────────────────────────── */

  {
    const rng = streamFor(seed, 'details.shore');
    const pebbleGeo = new THREE.IcosahedronGeometry(0.16, 0);
    const pebbleMat = new THREE.MeshStandardMaterial({
      color: 0xa8a096, roughness: 0.92, metalness: 0, vertexColors: true,
    });
    // Vertex-tint each pebble face so a hundred copies of one icosahedron do not
    // all catch the light identically.
    {
      const n = pebbleGeo.attributes.position.count;
      const c = new Float32Array(n * 3);
      for (let i = 0; i < n; i++) {
        const t = 0.78 + rng() * 0.42;
        c[i * 3] = t; c[i * 3 + 1] = t * 0.98; c[i * 3 + 2] = t * 0.93;
      }
      pebbleGeo.setAttribute('color', new THREE.Float32BufferAttribute(c, 3));
    }
    disposables.push(pebbleGeo, pebbleMat);

    const want = Math.round(420 * budget);
    const mesh = new THREE.InstancedMesh(pebbleGeo, pebbleMat, want);
    mesh.name = 'shore-pebbles';
    mesh.castShadow = true;
    mesh.receiveShadow = true;

    const _m = new THREE.Matrix4();
    const _q = new THREE.Quaternion();
    const _e = new THREE.Euler();
    const _p = new THREE.Vector3();
    const _s = new THREE.Vector3();

    let placed = 0, attempts = 0;
    while (placed < want && attempts < want * 60) {
      attempts++;
      const x = R.range(rng, -112 * LAND_SCALE, 112 * LAND_SCALE);
      const z = R.range(rng, -120 * LAND_SCALE, 104 * LAND_SCALE);
      const h = heightAt(x, z);
      // The tideline proper: damp sand just above the water, and a little below
      // it where the pebbles show through the shallows.
      if (h < -0.55 || h > WORLD.beachTop * 0.85) continue;
      if (wet(x, z)) continue;
      _e.set(rng() * TAU, rng() * TAU, rng() * TAU);
      _q.setFromEuler(_e);
      const sc = R.skew(rng, 0.35, 1.5, 1.8);
      _m.compose(_p.set(x, h - 0.04 * sc, z), _q, _s.set(sc, sc * 0.62, sc * 1.15));
      mesh.setMatrixAt(placed++, _m);
    }
    mesh.count = placed;
    mesh.instanceMatrix.needsUpdate = true;
    mesh.computeBoundingSphere();
    group.add(mesh);
  }

  /* ── update ──────────────────────────────────────────────────── */

  /**
   * The flowers ride the shared wind uniforms, so they need nothing per frame.
   * Only the lanterns do: their fire boxes come up at dusk and go out at dawn.
   */
  function update(t, phase) {
    if (!phase || !glowMesh) return;
    // Lit through the night and through both twilights.
    const lit = clamp(phase.night + phase.twilight * 0.75, 0, 1);
    glowMesh.visible = lit > 0.01;
    if (!glowMesh.visible) return;

    glowMesh.material.opacity = 1;
    for (let i = 0; i < lanternCount; i++) {
      // Stagger the flicker per lantern, or six lamps read as one lamp seen six
      // times. The phase offset is the index, so it costs nothing to keep.
      const f = 0.80 + 0.20 * Math.sin(t * 2.9 + i * 2.1 + Math.cos(t * 1.3 + i) * 1.6);
      // Deliberately over 1. The composer's render target is half-float, and the
      // bloom pass thresholds at 0.85 luminance — a glow clamped to 1 sits under
      // that and reads as a flat lit slab seen through the frame rather than as
      // a light. Overdriving it is what buys the halo.
      const v = clamp(lit, 0, 1) * f * 2.6;
      glowMesh.setColorAt(i, _glowCol.setHex(LANTERN_LIGHT).multiplyScalar(v));
    }
    glowMesh.instanceColor.needsUpdate = true;
  }

  function dispose() {
    for (const d of disposables) d.dispose?.();
    for (const m of flowerMeshes) m.dispose?.();
    glowMesh?.dispose?.();
  }

  return { group, update, dispose };
}

/* ── shared scratch, hoisted out of the placement and frame loops ── */
const UP = new THREE.Vector3(0, 1, 0);
const _spinQ = new THREE.Quaternion();
const _glowCol = new THREE.Color();

/**
 * A MeshStandardMaterial that bends with the shared wind.
 *
 * onBeforeCompile rather than a hand-written shader, for the same reason
 * grass.js does it: shadows, fog, the hemisphere bounce and the day/night light
 * rig all keep working, and there is no second lighting model to keep in step
 * with the first. The bend is an arc about the root — proportional to the SQUARE
 * of the height up the stem — not a shear, so the base stays planted.
 */
function makeFoliageMaterial(wind) {
  const mat = new THREE.MeshStandardMaterial({
    vertexColors: true,
    roughness: 0.78,
    metalness: 0,
    side: THREE.DoubleSide,
  });

  mat.onBeforeCompile = (shader) => {
    if (wind && wind.uniforms) {
      // BY REFERENCE. One wind.update() drives the meadow, the canopies, the
      // petals and these; cloning the slots here would leave the flowers
      // waving on a clock of their own.
      for (const k in wind.uniforms) shader.uniforms[k] = wind.uniforms[k];
    }

    const windBlock = wind && wind.WIND_GLSL ? wind.WIND_GLSL : `
      vec3 windForce(vec3 p) { return vec3(0.0); }
      vec3 windForce(vec3 p, float t) { return vec3(0.0); }
    `;

    // After <common>, not at the top of the file: three's prefix and defines have
    // to be in scope before the wind block declares its uniforms, and grass.js
    // already injects at exactly this anchor.
    shader.vertexShader = shader.vertexShader.replace(
      '#include <common>',
      `#include <common>\nattribute float aBase;\n${windBlock}`
    ).replace(
      '#include <begin_vertex>',
      /* glsl */ `
        #include <begin_vertex>
        {
          // Instance origin in world space — the wind field has to be sampled
          // per PLANT, not per vertex, or the flower shears as the field varies
          // across its own eight centimetres.
          vec3 root = (modelMatrix * instanceMatrix * vec4(0.0, 0.0, 0.0, 1.0)).xyz;
          vec3 w = windForce(root);
          float bend = aBase * aBase;
          // Back into instance-local space: the instance matrix carries a
          // rotation, so a world-space push applied directly would lean every
          // flower on a slope the wrong way.
          vec3 wLocal = (transpose(mat3(modelMatrix * instanceMatrix)) * w);
          transformed.xz += wLocal.xz * bend * 0.42;
          transformed.y -= length(wLocal.xz) * bend * 0.10;
        }
      `
    );
  };

  // Materials that share a program key would otherwise reuse a cached program
  // compiled without the patch above.
  mat.customProgramCacheKey = () => 'sk-foliage-wind';
  return mat;
}

export default createDetails;
