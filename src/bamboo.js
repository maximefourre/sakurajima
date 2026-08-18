/**
 * bamboo.js — instanced grove on the east bump (lot 8).
 *
 * Local density, not an island-wide scatter. Culm + simple foliage share
 * sakura's WIND_GLSL through the same vec3 adapter main.js already owns
 * (wind.js stores direction as Vector2 — handing that object over is a
 * silent no-op). Count scales with AREA_SOFT; instances run a bit large.
 * Nothing is planted on the ribbon.
 */

import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { BAMBOO, PATHS, SEED } from './config.js';
import { streamFor, R } from './noise.js';
import { WIND_GLSL } from './sakura.js';

const TAU = Math.PI * 2;
const PROTO_N = 4;

const CULM = [0x7a8c3c, 0x96a84e, 0xb0ba64];
const NODE = 0x4a3c24;
const LEAF = [0x4a7426, 0x5e8c30, 0x6e9e38];

export function inBambooGrove(x, z, pad = 0) {
  const dx = x - BAMBOO.cx, dz = z - BAMBOO.cz;
  const r = BAMBOO.radius + pad;
  return dx * dx + dz * dz < r * r;
}

function paint(geo, hex) {
  const tint = new THREE.Color(hex);
  const n = geo.attributes.position.count;
  const c = new Float32Array(n * 3);
  for (let i = 0; i < n; i++) {
    c[i * 3] = tint.r;
    c[i * 3 + 1] = tint.g;
    c[i * 3 + 2] = tint.b;
  }
  geo.setAttribute('color', new THREE.Float32BufferAttribute(c, 3));
  return geo;
}

function mergeParts(parts) {
  const flat = parts.map((g) => (g.index ? g.toNonIndexed() : g));
  const merged = mergeGeometries(flat);
  for (const g of flat) g.dispose();
  for (const g of parts) g.dispose();
  return merged;
}

/** One culm + rings + a few flattened leaf plaques. Local +Y is up. */
export function makeBambooGeometry(rng) {
  const parts = [];
  const nodes = 6 + ((rng() * 3) | 0);
  const leanX = (rng() - 0.5) * 0.11;
  const leanZ = (rng() - 0.5) * 0.11;
  let y = -0.12;
  const r0 = R.range(rng, 0.072, 0.108);
  const internodes = [];

  for (let i = 0; i < nodes; i++) {
    const t = i / Math.max(nodes - 1, 1);
    const len = R.range(rng, 0.92, 1.32) * (1.06 - 0.20 * t);
    const rBot = r0 * (1 - 0.52 * t);
    const rTop = r0 * (1 - 0.52 * (i + 1) / nodes);
    const cx = leanX * (y + len * 0.5);
    const cz = leanZ * (y + len * 0.5);

    const culm = new THREE.CylinderGeometry(rTop, rBot, len, 6, 1, false);
    culm.translate(cx, y + len * 0.5, cz);
    paint(culm, CULM[i % CULM.length]);
    parts.push(culm);

    const ring = new THREE.TorusGeometry(Math.max(0.02, rBot * 1.06), Math.max(0.008, rBot * 0.20), 4, 7);
    ring.rotateX(Math.PI * 0.5);
    ring.translate(cx, y, cz);
    paint(ring, NODE);
    parts.push(ring);

    internodes.push({ y: y + len * 0.82, r: rTop, cx, cz, t });
    y += len;
  }

  for (const n of internodes) {
    if (n.t < 0.36) continue;
    const leaves = 3 + ((rng() * 3) | 0);
    for (let k = 0; k < leaves; k++) {
      const a = (k / leaves) * TAU + rng() * 0.45;
      const slen = R.range(rng, 0.52, 0.98);
      const sw = R.range(rng, 0.09, 0.17);
      const leaf = new THREE.IcosahedronGeometry(1, 0);
      leaf.scale(sw, 0.032, slen);
      leaf.rotateY(a);
      leaf.rotateZ((rng() - 0.5) * 0.55);
      leaf.rotateX(0.32 + rng() * 0.42);
      leaf.translate(
        n.cx + Math.cos(a) * (n.r + slen * 0.32),
        n.y,
        n.cz + Math.sin(a) * (n.r + slen * 0.32),
      );
      paint(leaf, LEAF[(k + (n.t * 8) | 0) % LEAF.length]);
      parts.push(leaf);
    }
  }

  const merged = mergeParts(parts);
  merged.computeVertexNormals();

  const pos = merged.attributes.position;
  const flex = new Float32Array(pos.count);
  let yMax = 0.001;
  for (let i = 0; i < pos.count; i++) yMax = Math.max(yMax, pos.getY(i));
  for (let i = 0; i < pos.count; i++) {
    flex[i] = Math.pow(Math.max(0, Math.min(1, pos.getY(i) / yMax)), 1.45);
  }
  merged.setAttribute('aFlex', new THREE.Float32BufferAttribute(flex, 1));
  merged.computeBoundingSphere();
  return merged;
}

/**
 * Rejection-sample the east-bump disk. May return fewer than `count`;
 * never more. Every point is east of the junction and off the ribbon.
 */
export function computeBambooSpawns({
  heightAt, isOnPath, isInPond, slopeAt, count, seed = SEED,
} = {}) {
  const out = [];
  if (typeof heightAt !== 'function' || !(count > 0)) return out;

  const rng = streamFor(seed, 'bamboo.spawn');
  const [jx] = PATHS.routes[0].points[0];
  const maxTries = count * 140;
  const sep2 = BAMBOO.minSep * BAMBOO.minSep;
  const r = BAMBOO.radius;

  for (let tries = 0; tries < maxTries && out.length < count; tries++) {
    const ang = R.range(rng, 0, TAU);
    const rad = r * Math.sqrt(rng());
    const x = BAMBOO.cx + Math.cos(ang) * rad;
    const z = BAMBOO.cz + Math.sin(ang) * rad;
    if (x <= jx) continue;
    if (typeof isOnPath === 'function' && isOnPath(x, z, BAMBOO.pathClear)) continue;
    if (typeof isInPond === 'function' && isInPond(x, z)) continue;
    const h = heightAt(x, z);
    if (!(h >= BAMBOO.hMin && h <= BAMBOO.hMax)) continue;
    if (typeof slopeAt === 'function' && slopeAt(x, z) > BAMBOO.slopeMax) continue;
    let clash = false;
    for (let i = 0; i < out.length; i++) {
      const dx = x - out[i].x, dz = z - out[i].z;
      if (dx * dx + dz * dz < sep2) { clash = true; break; }
    }
    if (clash) continue;
    out.push({
      x, z, h,
      yaw: R.range(rng, 0, TAU),
      scale: R.range(rng, BAMBOO.scale[0], BAMBOO.scale[1]),
      proto: (rng() * PROTO_N) | 0,
    });
  }
  return out;
}

function bindWind(u) {
  const d = {
    uTime: { value: 0 },
    uWindDir: { value: new THREE.Vector3(1, 0, 0.38) },
    uWindStrength: { value: 1 },
    uWindFreq: { value: 0.85 },
    uGustScale: { value: 0.045 },
    uBarkSway: { value: 0.46 },
    uBlossomSway: { value: 0.62 },
  };
  if (!u) return d;
  for (const k in d) if (u[k] === undefined) u[k] = d[k];
  return u;
}

const CULM_VERTEX = /* glsl */`
	vec3 transformed = vec3( position );
	mat4 bamInst = mat4( 1.0 );
	#ifdef USE_INSTANCING
		bamInst = instanceMatrix;
	#endif
	mat4 bamM = modelMatrix * bamInst;
	vec3  bamAxX  = bamM[ 0 ].xyz;
	vec3  bamAxY  = bamM[ 1 ].xyz;
	vec3  bamAxZ  = bamM[ 2 ].xyz;
	float bamScl  = max( length( bamAxX ), 1e-5 );
	vec3  bamBx   = bamAxX / bamScl;
	vec3  bamBy   = bamAxY / max( length( bamAxY ), 1e-5 );
	vec3  bamBz   = bamAxZ / max( length( bamAxZ ), 1e-5 );
	vec3  bamOrg  = bamM[ 3 ].xyz;
	vec3  bamWpos = bamOrg + ( bamBx * transformed.x + bamBy * transformed.y + bamBz * transformed.z ) * bamScl;
	float bamWave = sakuraWindWave( bamWpos );
	float bamGust = sakuraWindGust( bamWpos );
	float bamAmp  = uWindStrength * uBarkSway * aFlex * bamGust;
	vec2  bamAx2  = sakuraWindAxis();
	vec3  bamLat  = vec3( bamAx2.x, 0.0, bamAx2.y );
	vec3  bamSide = vec3( - bamAx2.y, 0.0, bamAx2.x );
	vec3 bamDisp = bamLat * ( bamWave * bamAmp )
	             + bamSide * ( sin( uTime * uWindFreq * 1.71 + bamOrg.x * 0.63 + bamWpos.y * 0.88 ) * bamAmp * 0.36 )
	             - vec3( 0.0, 1.0, 0.0 ) * ( abs( bamWave ) * bamAmp * 0.10 );
	transformed += vec3( dot( bamDisp, bamBx ), dot( bamDisp, bamBy ), dot( bamDisp, bamBz ) ) / bamScl;
`;

function makeBambooMaterial(wind) {
  const mat = new THREE.MeshStandardMaterial({
    color: 0xffffff,
    vertexColors: true,
    roughness: 0.86,
    metalness: 0.0,
  });
  mat.onBeforeCompile = (shader) => {
    for (const k in wind) shader.uniforms[k] = wind[k];
    shader.vertexShader = 'attribute float aFlex;\n' + WIND_GLSL + '\n' + shader.vertexShader;
    shader.vertexShader = shader.vertexShader.replace('#include <begin_vertex>', CULM_VERTEX);
  };
  mat.customProgramCacheKey = () => 'bamboo-culm-v1';
  return mat;
}

export function createBamboo({
  seed = SEED, quality, heightAt, isOnPath, isInPond, slopeAt, windUniforms,
} = {}) {
  const count = quality?.bamboo ?? 0;
  const spots = computeBambooSpawns({
    heightAt, isOnPath, isInPond, slopeAt, count, seed,
  });
  const wind = bindWind(windUniforms);
  const rng = streamFor(seed, 'bamboo.proto');

  const group = new THREE.Group();
  group.name = 'bambooGrove';

  const geos = [];
  for (let p = 0; p < PROTO_N; p++) geos.push(makeBambooGeometry(() => rng()));

  const buckets = Array.from({ length: PROTO_N }, () => []);
  for (const s of spots) buckets[s.proto % PROTO_N].push(s);

  const mat = makeBambooMaterial(wind);
  const dummy = new THREE.Object3D();
  const meshes = [];

  for (let p = 0; p < PROTO_N; p++) {
    const list = buckets[p];
    if (!list.length) continue;
    const mesh = new THREE.InstancedMesh(geos[p], mat, list.length);
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    for (let i = 0; i < list.length; i++) {
      const s = list[i];
      dummy.position.set(s.x, s.h, s.z);
      dummy.rotation.set(0, s.yaw, 0);
      dummy.scale.setScalar(s.scale);
      dummy.updateMatrix();
      mesh.setMatrixAt(i, dummy.matrix);
    }
    mesh.instanceMatrix.needsUpdate = true;
    mesh.computeBoundingSphere();
    group.add(mesh);
    meshes.push(mesh);
  }

  return {
    group,
    count: spots.length,
    spots,
    update(time) {
      wind.uTime.value = time;
    },
    dispose() {
      for (const m of meshes) {
        group.remove(m);
        m.dispose();
      }
      for (const g of geos) g.dispose();
      mat.dispose();
    },
  };
}
