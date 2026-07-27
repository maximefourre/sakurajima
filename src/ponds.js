/**
 * STUB — ponds.
 * The real module is still being designed; this keeps main.js booting so the
 * rest of the scene can be validated end to end. Replaced wholesale on arrival.
 */
import * as THREE from 'three';

export function createPonds() {
  return {
    group: new THREE.Group(),
    PONDS: [],
    carvePonds: (x, z, h) => h,   // identity: no basins carved yet
    isInPond: () => false,
    attach() {},
    update() {},
  };
}
