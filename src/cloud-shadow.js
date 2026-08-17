/**
 * cloud-shadow.js — projected cumulus shade on the land.
 *
 * No extra shadow map (the sun already fills 4096²). A slow fbm in XZ,
 * drifted by the shared wind, multiplies albedo. Same uniform object is
 * shared by terrain, rocks and grass so the patches line up.
 */
import * as THREE from 'three';

export const CLOUD_SHADOW_GLSL = /* glsl */ `
uniform vec2 uCldOff;
uniform float uCldAmt;
float cldH21(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453123); }
float cldVn(vec2 p) {
  vec2 i = floor(p), f = fract(p);
  f = f * f * (3.0 - 2.0 * f);
  return mix(mix(cldH21(i), cldH21(i + vec2(1.0, 0.0)), f.x),
             mix(cldH21(i + vec2(0.0, 1.0)), cldH21(i + vec2(1.0, 1.0)), f.x), f.y);
}
float cloudShadowAt(vec2 xz) {
  vec2 p = xz * 0.00165 + uCldOff;
  float n = cldVn(p) * 0.58 + cldVn(p * 2.15 + 4.2) * 0.42;
  float cover = smoothstep(0.40, 0.70, n);
  return mix(1.0, 0.58, uCldAmt * cover);
}
`;

export function createCloudShadow() {
  const uniforms = {
    uCldOff: { value: new THREE.Vector2() },
    uCldAmt: { value: 0 },
  };

  function update(t, phase, wind) {
    const dir = wind?.uniforms?.uWindDir?.value;
    const sx = dir ? dir.x : 0.82;
    const sz = dir ? dir.y : 0.57;
    uniforms.uCldOff.value.set(sx * t * 0.0032, sz * t * 0.0032);
    const sunY = phase?.sunDirection?.y ?? 0;
    const day = phase?.day ?? 0;
    const up = THREE.MathUtils.smoothstep(sunY, 0.03, 0.20);
    uniforms.uCldAmt.value = day * up * 0.78;
  }

  return { uniforms, update };
}
