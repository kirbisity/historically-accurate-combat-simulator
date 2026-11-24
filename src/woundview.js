// Cut faces, and a body cut in two. One mechanism for every cut (a limb, the neck, the trunk): the face of a cut is a
// fan of rings filling the outline the blade left, drawn with a section of what is inside (skin, fat, muscle, bone, and in
// the trunk the dark cavity and the spine at the back), painted once in polar coordinates so it fits any outline.
//
// A trunk cut through (physics.js severTrunk) leaves the man's skin, clothes and armour in two parts, each following its
// own limp body (fighter.halves). Every skinned mesh of his is cut along the blade's plane in the pose it was bound in:
// the triangles the plane crosses are divided on it, so both rims are clean; what is above goes to a twin of the mesh on
// a second set of bones posed by the upper part, what is below stays on his own. Nothing here changes the simulation.

/* global THREE */
import { P } from './body.js';
import { BONE, BONES } from './rig.js';
import { dualQuaternionSkinning } from './dqskin.js';

export const WOUND_FACE = {
  // The fan: spokes round the outline, rings from the middle out (shares of the outline's radius).
  spokes: 40, rings: [0, 0.3, 0.55, 0.8, 0.93, 1],
  // The face sits this far (m) inside the rim, and its middle sinks this share of its radius: a cut body gapes, the skin
  // drawing back from the muscle.
  inset: 0.004, sink: 0.12,
  texture: [512, 256],
};

// ---- The section painted --------------------------------------------------------------

const woundHash = (x, y) => {
  const s = Math.sin(x * 127.1 + y * 311.7) * 43758.5453;
  return s - Math.floor(s);
};
/** Smooth noise that wraps in x every `wrap` cells (the angle comes round). */
function woundNoise(x, y, wrap) {
  const xi = Math.floor(x);
  const yi = Math.floor(y);
  const fx = x - xi;
  const fy = y - yi;
  const sx = fx * fx * (3 - 2 * fx);
  const sy = fy * fy * (3 - 2 * fy);
  const at = (i, j) => woundHash(((i % wrap) + wrap) % wrap, j);
  return (at(xi, yi) * (1 - sx) + at(xi + 1, yi) * sx) * (1 - sy) + (at(xi, yi + 1) * (1 - sx) + at(xi + 1, yi + 1) * sx) * sy;
}

const woundMix = (a, b, t) => [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t];
const woundSmooth = (from, to, value) => {
  const t = Math.min(1, Math.max(0, (value - from) / (to - from)));
  return t * t * (3 - 2 * t);
};

const WOUND_SECTION = {
  skin: [92, 22, 20], fat: [214, 172, 96], fatBloody: [158, 60, 38], muscle: [142, 24, 26], muscleDark: [84, 10, 14], fascia: [196, 128, 112],
  cavity: [34, 4, 7], viscera: [128, 58, 64], bone: [232, 220, 192], marrow: [118, 26, 26], cord: [226, 200, 170],
};

/**
 * A section's colour at angle `u` (0..1 round the face; the back of a trunk at 0.5) and radius `v` (0 the middle, 1 the
 * skin): `trunk` (a cavity inside the wall, the spine at the back) or a limb or neck (the bone in the middle).
 */
export function sectionColour(kind, u, v) {
  const C = WOUND_SECTION;
  const lump = woundNoise(u * 48, v * 14, 48);
  const fine = woundNoise(u * 160, v * 60 + 9, 160);
  const trunk = kind === 'trunk';
  // Where the wall ends inward: a trunk's is thin in front and at the sides, thick at the back (the muscles by the spine).
  const back = trunk ? Math.exp(-(((u - 0.5) / 0.16) ** 2)) : 0;
  const wall = trunk ? 0.66 - 0.22 * back + 0.05 * (woundNoise(u * 12, 3, 12) - 0.5) : 0.3;
  const fatFrom = trunk ? 0.865 + 0.03 * (woundNoise(u * 20, 7, 20) - 0.5) : 0.9;
  let colour;
  if (v > 0.965) colour = C.skin;
  else if (v > fatFrom) colour = woundMix(woundMix(C.fat, C.fatBloody, woundSmooth(0.35, 0.8, lump)), C.skin, woundSmooth(0.95, 0.975, v) * 0.6);
  else if (v > wall) {
    // Muscle cut across: bundles, darker between, pale septa of fascia between the sheets.
    const bundle = woundNoise(u * 90, v * 26 + 31, 90);
    const septum = Math.abs(woundNoise(u * 26, v * 5 + 17, 26) - 0.5) < 0.035 ? 1 : 0;
    colour = woundMix(woundMix(C.muscle, C.muscleDark, woundSmooth(0.3, 0.75, bundle) * 0.8 + 0.2 * fine), C.fascia, septum * 0.55);
    colour = woundMix(colour, C.fatBloody, woundSmooth(fatFrom - 0.03, fatFrom, v) * 0.5);
  } else if (trunk) {
    // The cavity: dark, wet, with what lies in it catching the light here and there.
    const coil = woundSmooth(0.52, 0.78, woundNoise(u * 22, v * 9 + 53, 22));
    colour = woundMix(C.cavity, C.viscera, coil * 0.75 * woundSmooth(0.02, 0.2, wall - v + 0.12));
    colour = woundMix(colour, C.muscleDark, woundSmooth(wall - 0.05, wall, v));
  } else colour = C.bone;
  // The bone: a limb's in its middle, a trunk's spine at the back (a body, the canal and its cord behind it).
  const du = trunk ? (u - 0.5) / 0.055 : 0;
  const dv = trunk ? (v - 0.6) / 0.115 : v / 0.3;
  const reach = Math.hypot(du, dv);
  if (reach < 1) {
    const rim = woundSmooth(0.62, 0.82, reach);
    colour = woundMix(woundMix(C.marrow, C.bone, 0.25 + 0.35 * fine), C.bone, rim);
    if (trunk && Math.hypot(du / 0.35, (v - 0.71) / 0.03) < 1) colour = C.cord;
    colour = woundMix(colour, C.muscleDark, woundSmooth(0.9, 1, reach) * 0.7);
  }
  // Blood over all of it, thicker in the hollows.
  return woundMix(colour, [110, 8, 12], 0.12 + 0.2 * woundSmooth(0.5, 0.9, woundNoise(u * 30, v * 10 + 77, 30)));
}

const woundTextures = new Map();

function woundTexture(kind) {
  if (woundTextures.has(kind)) return woundTextures.get(kind);
  const [width, height] = WOUND_FACE.texture;
  const data = new Uint8Array(width * height * 4);
  for (let y = 0; y < height; y += 1) {
    const v = (y + 0.5) / height;
    for (let x = 0; x < width; x += 1) {
      const colour = sectionColour(kind, (x + 0.5) / width, v);
      const at = (y * width + x) * 4;
      data[at] = colour[0];
      data[at + 1] = colour[1];
      data[at + 2] = colour[2];
      data[at + 3] = 255;
    }
  }
  // (Data, not a canvas: one painting shared by every cut face, never freed with one man's body.)
  const texture = new THREE.DataTexture(data, width, height, THREE.RGBAFormat);
  texture.wrapS = THREE.RepeatWrapping;
  texture.magFilter = THREE.LinearFilter;
  texture.minFilter = THREE.LinearMipmapLinearFilter;
  texture.generateMipmaps = true;
  texture.needsUpdate = true;
  woundTextures.set(kind, texture);
  return texture;
}

const woundMaterials = new Map();

/** The material a cut face is drawn in: wet flesh. One per kind and way of skinning, shared by every face. */
function woundMaterial(kind, skinning, dual) {
  const key = `${kind}:${skinning ? 1 : 0}:${dual ? 1 : 0}`;
  if (woundMaterials.has(key)) return woundMaterials.get(key);
  const material = new THREE.MeshStandardMaterial({ map: woundTexture(kind), roughness: 0.32, metalness: 0, skinning, side: THREE.DoubleSide });
  if (dual) dualQuaternionSkinning(material);
  // (Shared by every cut face: never freed with one of them.)
  material.userData.shared = true;
  woundMaterials.set(key, material);
  return material;
}

/**
 * A cut face's geometry: a fan about `centre` in the plane square to `normal` (facing it), its outline `radii[spoke]` out
 * from the centre, the first spoke along `forward` and the rest on round `normal`. `skin` (optional): for each spoke the
 * bones and weights its points are skinned by ({ index: [4], weight: [4] }), as the rim there is.
 */
export function woundFaceGeometry({ centre, normal, forward, radii, skin = null, dome = 0 }) {
  const spec = WOUND_FACE;
  const spokes = radii.length;
  // (`dome`: a stump's end, not set into a rim of its own: it swells out by that share of its radius, and a last ring
  // folds back round the limb's end.)
  const rings = dome ? [...spec.rings, 1.08] : spec.rings;
  const n = new THREE.Vector3(...normal).normalize();
  const x = new THREE.Vector3(...forward).addScaledVector(n, -new THREE.Vector3(...forward).dot(n)).normalize();
  const y = new THREE.Vector3().crossVectors(n, x);
  const count = (spokes + 1) * rings.length;
  const positions = new Float32Array(count * 3);
  const normals = new Float32Array(count * 3);
  const uvs = new Float32Array(count * 2);
  const skinIndex = skin ? new Uint16Array(count * 4) : null;
  const skinWeight = skin ? new Float32Array(count * 4) : null;
  const mean = radii.reduce((sum, radius) => sum + radius, 0) / spokes;
  const at = new THREE.Vector3();
  for (let spoke = 0; spoke <= spokes; spoke += 1) {
    const angle = (spoke / spokes) * Math.PI * 2;
    const radius = radii[spoke % spokes];
    for (let ring = 0; ring < rings.length; ring += 1) {
      const vertex = spoke * rings.length + ring;
      const reach = rings[ring] * radius;
      const sunk = rings[ring] > 1 ? 0.45 * mean : dome ? -dome * mean * (1 - rings[ring] ** 2) : spec.inset + spec.sink * mean * (1 - rings[ring] ** 2);
      at.set(centre[0], centre[1], centre[2]).addScaledVector(x, Math.cos(angle) * reach).addScaledVector(y, Math.sin(angle) * reach).addScaledVector(n, -sunk);
      positions.set([at.x, at.y, at.z], vertex * 3);
      normals.set([n.x, n.y, n.z], vertex * 3);
      // (The painted section's back is at u = 0.5: the first spoke, forward, is u = 0.)
      uvs.set([spoke / spokes, Math.min(1, rings[ring])], vertex * 2);
      if (skin) {
        const bound = skin[spoke % spokes];
        skinIndex.set(bound.index, vertex * 4);
        skinWeight.set(bound.weight, vertex * 4);
      }
    }
  }
  const index = [];
  for (let spoke = 0; spoke < spokes; spoke += 1) {
    for (let ring = 0; ring < rings.length - 1; ring += 1) {
      const a = spoke * rings.length + ring;
      const b = (spoke + 1) * rings.length + ring;
      if (ring > 0) index.push(a, b, a + 1);
      index.push(b, b + 1, a + 1);
    }
  }
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));
  geometry.setAttribute('normal', new THREE.BufferAttribute(normals, 3));
  geometry.setAttribute('uv', new THREE.BufferAttribute(uvs, 2));
  if (skin) {
    geometry.setAttribute('skinIndex', new THREE.Uint16BufferAttribute(skinIndex, 4));
    geometry.setAttribute('skinWeight', new THREE.Float32BufferAttribute(skinWeight, 4));
  }
  geometry.setIndex(index);
  return geometry;
}

/** A round cut face (a limb's, the neck's): `radius` about `centre`, facing `normal`. Unskinned: it rides what it is put on. */
export function roundWoundFace(centre, normal, radius, kind = 'limb') {
  const forward = Math.abs(normal[1]) < 0.9 ? [0, 1, 0] : [1, 0, 0];
  const geometry = woundFaceGeometry({ centre, normal, forward, radii: new Array(24).fill(radius), dome: 0.28 });
  geometry.computeVertexNormals();
  return new THREE.Mesh(geometry, woundMaterial(kind, false, false));
}

// ---- A body cut in two ------------------------------------------------------------------

// The bones whose skin is told by the plane (the trunk's), and each limb bone's root on the trunk (its skin goes with it).
const WOUND_PLANE_BONES = new Set(['pelvis', 'spine', 'chest', 'neck', 'lClavicle', 'rClavicle'].map((name) => BONE[name]));
const WOUND_BONE_ROOT = {
  head: 'neck', lUpperArm: 'lShoulder', lForearm: 'lShoulder', rUpperArm: 'rShoulder', rForearm: 'rShoulder',
  lThigh: 'lHip', lShin: 'lHip', lFoot: 'lHip', rThigh: 'rHip', rShin: 'rHip', rFoot: 'rHip',
};

/** The cut's plane in the pose the skin was bound in (`bindFrames`): a point on it and its normal, and the trunk's forward there. */
function woundBindPlane(cut, bindFrames) {
  const pelvis = bindFrames[BONE.pelvis];
  const neck = bindFrames[BONE.chest].end;
  const span = [neck[0] - pelvis.origin[0], neck[1] - pelvis.origin[1], neck[2] - pelvis.origin[2]];
  const length = Math.hypot(...span);
  const up = span.map((value) => value / length);
  const origin = pelvis.origin.map((value, axis) => value + span[axis] * cut.along);
  const [f, u, l] = cut.normal;
  const normal = [0, 1, 2].map((axis) => pelvis.x[axis] * f + up[axis] * u + pelvis.z[axis] * l);
  return { origin, normal, forward: pelvis.x };
}

/**
 * One geometry cut in two by the plane. Returns { lower, upper, rim }: two geometries with every attribute the first had
 * (either may be null: nothing of it on that side), and the rim's points ({ at, bare, lower, upper }: where, whether bare
 * skin, and the bones each side's copy is skinned by). A corner's side: by the plane where its strongest bone is the
 * trunk's, else its limb's root's (`boneUpper`); a triangle with a limb's corner goes whole with the limb.
 */
function woundSplitGeometry(geometry, plane, boneUpper) {
  const attributes = geometry.attributes;
  const position = attributes.position;
  const skinIndex = attributes.skinIndex;
  const index = geometry.index.array;
  const names = Object.keys(attributes);
  const count = position.count;
  // Each corner's signed distance from the plane, or its fixed side (a limb's).
  const distance = new Float32Array(count);
  const fixed = new Int8Array(count);
  const [ox, oy, oz] = plane.origin;
  const [nx, ny, nz] = plane.normal;
  for (let vertex = 0; vertex < count; vertex += 1) {
    const bone = skinIndex.getX(vertex);
    distance[vertex] = (position.getX(vertex) - ox) * nx + (position.getY(vertex) - oy) * ny + (position.getZ(vertex) - oz) * nz;
    fixed[vertex] = WOUND_PLANE_BONES.has(bone) ? 0 : boneUpper[bone] ? 1 : -1;
  }
  const sides = [{ map: new Map(), from: [], index: [] }, { map: new Map(), from: [], index: [] }];
  // A side's copy of a corner: an old one, or a new one on the plane between two (`a` on this side, `t` of the way to `b`).
  const old = (side, vertex) => {
    let found = side.map.get(vertex);
    if (found === undefined) {
      found = side.from.length;
      side.map.set(vertex, found);
      side.from.push([vertex, vertex, 0]);
    }
    return found;
  };
  const rim = [];
  const onPlane = (side, a, b) => {
    const key = `${a}:${b}`;
    let found = side.map.get(key);
    if (found === undefined) {
      found = side.from.length;
      side.map.set(key, found);
      side.from.push([a, b, distance[a] / (distance[a] - distance[b])]);
    }
    return found;
  };
  const sideOf = (vertex) => (fixed[vertex] !== 0 ? fixed[vertex] : distance[vertex] > 0 ? 1 : -1);
  for (let corner = 0; corner < index.length; corner += 3) {
    const tri = [index[corner], index[corner + 1], index[corner + 2]];
    const limb = tri.find((vertex) => fixed[vertex] !== 0);
    const of = tri.map(sideOf);
    if (limb !== undefined || (of[0] === of[1] && of[1] === of[2])) {
      const whole = sides[(limb !== undefined ? fixed[limb] : of[0]) > 0 ? 1 : 0];
      whole.index.push(old(whole, tri[0]), old(whole, tri[1]), old(whole, tri[2]));
      continue;
    }
    // One corner alone on its side: its tip to that side, the rest (a quad) to the other.
    const alone = of[0] !== of[1] && of[0] !== of[2] ? 0 : of[1] !== of[0] && of[1] !== of[2] ? 1 : 2;
    const [a, b, c] = [tri[alone], tri[(alone + 1) % 3], tri[(alone + 2) % 3]];
    const tip = sides[of[alone] > 0 ? 1 : 0];
    const rest = sides[of[alone] > 0 ? 0 : 1];
    tip.index.push(old(tip, a), onPlane(tip, a, b), onPlane(tip, a, c));
    const [pb, pc] = [onPlane(rest, b, a), onPlane(rest, c, a)];
    rest.index.push(pb, old(rest, b), old(rest, c), pb, old(rest, c), pc);
    for (const [near, far] of [[a, b], [a, c]]) {
      const t = distance[near] / (distance[near] - distance[far]);
      const at = [0, 1, 2].map((axis) => position.array[near * 3 + axis] + (position.array[far * 3 + axis] - position.array[near * 3 + axis]) * t);
      const [low, high] = of[alone] > 0 ? [far, near] : [near, far];
      rim.push({ at, bare: attributes.wetSkin ? attributes.wetSkin.array[near] > 0.5 : false, lower: low, upper: high });
    }
  }
  const build = (side) => {
    if (!side.index.length) return null;
    const made = new THREE.BufferGeometry();
    for (const name of names) {
      const source = attributes[name];
      const size = source.itemSize;
      const array = new source.array.constructor(side.from.length * size);
      // (A corner on the plane is between its two for everything but its bones, which are its own side's corner's.)
      const blended = name !== 'skinIndex' && name !== 'skinWeight';
      for (let vertex = 0; vertex < side.from.length; vertex += 1) {
        const [a, b, t] = side.from[vertex];
        for (let k = 0; k < size; k += 1) {
          const first = source.array[a * size + k];
          array[vertex * size + k] = blended && t > 0 ? first + (source.array[b * size + k] - first) * t : first;
        }
      }
      made.setAttribute(name, new THREE.BufferAttribute(array, size, source.normalized));
    }
    made.setIndex(side.from.length > 65535 ? new THREE.Uint32BufferAttribute(side.index, 1) : new THREE.Uint16BufferAttribute(side.index, 1));
    return made;
  };
  // (The rim's bones, read from the first geometry while it is still there.)
  const bound = (vertex) => ({ index: [0, 1, 2, 3].map((k) => skinIndex.array[vertex * 4 + k]), weight: [0, 1, 2, 3].map((k) => attributes.skinWeight.array[vertex * 4 + k]) });
  for (const point of rim) {
    point.lower = bound(point.lower);
    point.upper = bound(point.upper);
  }
  return { lower: build(sides[0]), upper: build(sides[1]), rim };
}

/**
 * The outline a rim leaves on the plane, spoke by spoke about its middle: the bare skin's (its outermost point on the
 * spoke) where any crossed the plane there, else the innermost thing worn; a spoke nothing crossed takes its neighbours',
 * and one that stands far in or out of both its neighbours (a stray fold of cloth) is brought to them.
 */
function woundRimOutline(rim, plane) {
  const spokes = WOUND_FACE.spokes;
  const n = new THREE.Vector3(...plane.normal).normalize();
  const x = new THREE.Vector3(...plane.forward).addScaledVector(n, -new THREE.Vector3(...plane.forward).dot(n)).normalize();
  const y = new THREE.Vector3().crossVectors(n, x);
  const bare = rim.filter((point) => point.bare);
  const used = bare.length >= 8 ? bare : rim;
  // (The middle of what it spans, not of its points: a mesh is finer in places.)
  const low = [Infinity, Infinity, Infinity];
  const high = [-Infinity, -Infinity, -Infinity];
  for (const point of used) for (let axis = 0; axis < 3; axis += 1) {
    low[axis] = Math.min(low[axis], point.at[axis]);
    high[axis] = Math.max(high[axis], point.at[axis]);
  }
  const centre = low.map((value, axis) => (value + high[axis]) / 2);
  const radii = new Array(spokes).fill(0);
  const skin = new Array(spokes).fill(null);
  const offset = new THREE.Vector3();
  for (const point of rim) {
    offset.set(point.at[0] - centre[0], point.at[1] - centre[1], point.at[2] - centre[2]);
    const reach = Math.hypot(offset.dot(x), offset.dot(y));
    const spoke = ((Math.round((Math.atan2(offset.dot(y), offset.dot(x)) / (Math.PI * 2)) * spokes) % spokes) + spokes) % spokes;
    const held = skin[spoke];
    const better = !held || (point.bare && !held.bare) || (point.bare === held.bare && (point.bare ? reach > radii[spoke] : reach < radii[spoke]));
    if (!better) continue;
    radii[spoke] = reach;
    skin[spoke] = point;
  }
  for (let spoke = 0; spoke < spokes; spoke += 1) {
    if (skin[spoke]) continue;
    for (let step = 1; step < spokes; step += 1) {
      const found = skin[(spoke + step) % spokes] ? (spoke + step) % spokes : skin[(spoke - step + spokes) % spokes] ? (spoke - step + spokes) % spokes : -1;
      if (found < 0) continue;
      radii[spoke] = radii[found];
      skin[spoke] = skin[found];
      break;
    }
  }
  const smoothed = radii.map((radius, spoke) => {
    const [before, after] = [radii[(spoke - 1 + spokes) % spokes], radii[(spoke + 1) % spokes]];
    return Math.min(Math.max(radius, Math.min(before, after) * 0.9), Math.max(before, after) * 1.1);
  });
  return { centre, radii: smoothed, skin };
}

/**
 * Cut a man's drawn body in two along his trunk cut (`cut`: fighter.trunkCut). Every skinned mesh under `root` keeps what
 * is below the plane and gains a twin (its child, so it is shown, hidden and baked with it) with what is above, on
 * `upperBones`; the two cut faces are closed with the trunk's section. Returns { upperBones, twins, faces } or null when
 * there is nothing to cut. `bones`: his own (the lower part's from now on); `bindFrames`: the pose the skin was bound in.
 */
export function splitBody(root, bones, bindFrames, cut, { skinMesh = null } = {}) {
  const plane = woundBindPlane(cut, bindFrames);
  const boneUpper = BONES.map((name) => (WOUND_BONE_ROOT[name] ? Boolean(cut.upper[P[WOUND_BONE_ROOT[name]]]) : false));
  boneUpper[BONE.head] = true;
  const upperBones = bones.map(() => {
    const bone = new THREE.Bone();
    bone.matrixAutoUpdate = false;
    return bone;
  });
  const meshes = [];
  root.traverse((object) => {
    if (object.isSkinnedMesh && object.geometry?.index && object.geometry.attributes.skinIndex) meshes.push(object);
  });
  if (!meshes.length) return null;
  const done = new Map();
  const skeletons = new Map();
  const twins = [];
  let rim = [];
  for (const mesh of meshes) {
    let parts = done.get(mesh.geometry);
    if (!parts) {
      parts = woundSplitGeometry(mesh.geometry, plane, boneUpper);
      done.set(mesh.geometry, parts);
      // (The outline of the cut is told by the bodies themselves, not by their ink; one body's is enough.)
      if (!mesh.userData.outline && (mesh === skinMesh || !rim.length || parts.rim.some((point) => point.bare))) rim = rim.concat(parts.rim);
    }
    let skeleton = skeletons.get(mesh.skeleton);
    if (!skeleton) skeletons.set(mesh.skeleton, (skeleton = new THREE.Skeleton(upperBones, mesh.skeleton.boneInverses)));
    const empty = new THREE.BufferGeometry();
    mesh.geometry = parts.lower ?? empty;
    if (!parts.upper) continue;
    const twin = new THREE.SkinnedMesh(parts.upper, mesh.material);
    twin.bind(skeleton, mesh.bindMatrix);
    twin.frustumCulled = false;
    twin.castShadow = mesh.castShadow;
    twin.receiveShadow = mesh.receiveShadow;
    twin.userData.outline = mesh.userData.outline;
    twin.userData.trunkTwin = true;
    twin.matrixAutoUpdate = false;
    mesh.add(twin);
    twins.push(twin);
  }
  for (const geometry of done.keys()) if (!geometry.userData.sharedAttributes) geometry.dispose();
  const faces = [];
  // (The upper face looks the other way: its spokes run round the other way.)
  const mirrored = (list) => list.map((_, spoke) => list[(list.length - spoke) % list.length]);
  // Which part each bone is drawn with: a limb's with its root, the pelvis below, the chest and neck above, the spine by where the cut is.
  const boneSide = boneUpper.slice();
  for (const name of ['chest', 'neck']) boneSide[BONE[name]] = true;
  boneSide[BONE.spine] = cut.along < 0.5;
  for (const side of ['l', 'r']) boneSide[BONE[`${side}Clavicle`]] = Boolean(cut.upper[P[`${side}Shoulder`]]);
  if (rim.length >= 3) {
    const outline = woundRimOutline(rim, plane);
    const body = skinMesh ?? meshes[0];
    const dual = Boolean(body.material?.onBeforeCompile?.dualQuaternion);
    const material = woundMaterial('trunk', true, dual);
    for (const upper of [false, true]) {
      const geometry = woundFaceGeometry({
        centre: outline.centre, normal: upper ? plane.normal.map((value) => -value) : plane.normal, forward: plane.forward, radii: upper ? mirrored(outline.radii) : outline.radii,
        skin: (upper ? mirrored(outline.skin) : outline.skin).map((point) => (upper ? point.upper : point.lower)),
      });
      const face = new THREE.SkinnedMesh(geometry, material);
      face.bind(upper ? skeletons.get(body.skeleton) : body.skeleton, body.bindMatrix);
      face.frustumCulled = false;
      face.matrixAutoUpdate = false;
      face.userData.woundFace = true;
      root.add(face);
      faces.push(face);
    }
  }
  return { upperBones, twins, faces, boneSide, lowerFrames: null, upperFrames: null };
}
