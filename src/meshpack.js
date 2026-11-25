// Vertex attributes packed small, for big meshes nothing reads back once built (a town kit place's merged walls, roofs and
// ground: places/pyongyang.js was 7.7 million vertices, 340 MB of 32-bit floats, and as much again kept by the page).
//   - A normal in three signed bytes (normalized: the card reads -127..127 as -1..1): about half a degree at worst, under
//     what a lit face shows. A colour in three unsigned bytes, as a hex colour is: only where every value lies in 0..1
//     (a tint that brightens, over 1, keeps its floats).
//   - What the card has been sent is let go on the page (`freeOnUpload`): the GPU's copy is the one drawn. Nothing may read
//     such an attribute again on the page, nor clone or merge its geometry (scenerylod.js leaves packed meshes alone), and a
//     lost WebGL context cannot send it again: the page offers a reload then (main.js, context loss).
// Measured 2026-11-25 (Pyongyang, the story town, 1280 x 800): see MESH_PACK.measured.

/* global THREE */

export const MESH_PACK = {
  // The switch (and the before/after in one page: set before a place is built).
  on: true,
  measured: 'Pyongyang town geometry 340 MB on the card and 340 MB on the page before; after packing about 200 MB on the card and the positions alone (about 93 MB) on the page.',
};

/** Normals (a Float32Array of unit vectors, three a vertex) as signed bytes. */
export function packedNormals(normals) {
  if (!MESH_PACK.on) return new THREE.BufferAttribute(normals, 3);
  const packed = new Int8Array(normals.length);
  for (let at = 0; at < normals.length; at += 1) packed[at] = Math.round(Math.max(-1, Math.min(1, normals[at])) * 127);
  return new THREE.BufferAttribute(packed, 3, true);
}

/** Colours (0..1, three a vertex) as unsigned bytes; kept as floats if any value is outside 0..1. */
export function packedColours(colours) {
  if (!MESH_PACK.on) return new THREE.BufferAttribute(colours, 3);
  for (let at = 0; at < colours.length; at += 1) if (!(colours[at] >= 0 && colours[at] <= 1)) return new THREE.BufferAttribute(colours, 3);
  const packed = new Uint8Array(colours.length);
  for (let at = 0; at < colours.length; at += 1) packed[at] = Math.round(colours[at] * 255);
  return new THREE.BufferAttribute(packed, 3, true);
}

/** An attribute whose page copy is let go once it is on the card (three r128 calls `onUploadCallback` after sending it). */
export function freeOnUpload(attribute) {
  if (!MESH_PACK.on) return attribute;
  attribute.onUpload(function release() {
    this.array = new this.array.constructor(0);
    this.packedAway = true;
  });
  return attribute;
}

/** Whether a geometry has packed or uploaded-and-freed attributes (it must not be merged, cloned or read). */
export function packedGeometry(geometry) {
  for (const attribute of Object.values(geometry.attributes)) {
    if (attribute.normalized || attribute.packedAway || attribute.onUploadCallback?.name === 'release') return true;
  }
  return false;
}
