// A STAND-IN for src/facecustom/solver.js: a sphere that bulges where each slider pushes it, so the customizer's screen can be
// tried before the real head is in. Faces +x (the game's head-local forward). Deleted when the real core lands.

/* global THREE */
import { FACE_SLIDERS } from './schema.js';
import { skinMaterialFor, updateSkin } from './skin.js';

// Each stub slider's bump: where on the unit sphere it pushes (x forward, y up, z left; mirrored in z) and how wide it reaches.
const STUB_BUMPS = {
  headWidth: { at: [0, 0.1, 1], reach: 1.2 }, headHeight: { at: [0, 1, 0], reach: 1.1 },
  browRidge: { at: [0.92, 0.35, 0.3], reach: 0.25 }, eyeDepth: { at: [0.9, 0.18, 0.38], reach: 0.18 },
  noseLength: { at: [0.97, -0.12, 0], reach: 0.22 }, noseBridge: { at: [0.98, 0.12, 0], reach: 0.14 },
  cheekbones: { at: [0.72, -0.05, 0.68], reach: 0.3 }, lipFullness: { at: [0.94, -0.42, 0.1], reach: 0.18 },
  jawWidth: { at: [0.35, -0.6, 0.72], reach: 0.35 }, chinLength: { at: [0.75, -0.82, 0], reach: 0.25 },
};
// How far a slider at either end pushes the surface out or in, as a share of the radius.
const STUB_BUMP_DEPTH = 0.18;
const STUB_RADIUS = 0.11;

export function buildCustomHead(face, opts = {}) {
  const radius = opts.radius ?? STUB_RADIUS;
  const geometry = new THREE.SphereGeometry(radius, 96, 72);
  const rest = geometry.attributes.position.array.slice();
  const material = skinMaterialFor(face);
  const mesh = new THREE.Mesh(geometry, material);
  const group = new THREE.Group();
  group.add(mesh);
  const bumps = FACE_SLIDERS.filter((slider) => STUB_BUMPS[slider.id]).map((slider) => ({ id: slider.id, ...STUB_BUMPS[slider.id], dir: new THREE.Vector3(...STUB_BUMPS[slider.id].at).normalize() }));
  const point = new THREE.Vector3();
  function setFace(next) {
    const positions = geometry.attributes.position.array;
    for (let index = 0; index < positions.length; index += 3) {
      point.set(rest[index], rest[index + 1], rest[index + 2]).divideScalar(radius);
      let push = 0;
      for (const bump of bumps) {
        const amount = ((next.sliders[bump.id] ?? 128) - 128) / 128;
        const mirrored = point.z * bump.dir.z < 0 ? Math.hypot(point.x - bump.dir.x, point.y - bump.dir.y, point.z + bump.dir.z) : point.distanceTo(bump.dir);
        push += amount * STUB_BUMP_DEPTH * Math.exp(-((mirrored / bump.reach) ** 2));
      }
      positions[index] = rest[index] * (1 + push);
      positions[index + 1] = rest[index + 1] * (1 + push);
      positions[index + 2] = rest[index + 2] * (1 + push);
    }
    geometry.attributes.position.needsUpdate = true;
    geometry.computeVertexNormals();
    updateSkin(material, next);
  }
  setFace(face);
  return {
    group, setFace, setExpression() {},
    dispose() {
      geometry.dispose();
      material.dispose();
    },
  };
}
