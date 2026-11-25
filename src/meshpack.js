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
    // (Sent again once let go, after its geometry was disposed and drawn once more: the card has nothing to draw then. A
    // geometry that a cache of shapes shares across builds must not be packed for the card.)
    if (this.packedAway) console.error('HACS: a vertex attribute let go on the page was sent to the card again (meshpack.js)');
    this.array = new this.array.constructor(0);
    this.packedAway = true;
  });
  return attribute;
}

/**
 * A geometry built for the card alone, packed and let go on the page once sent: its normals and colours in bytes (above), and
 * every attribute but those in `keep` freed on upload. The positions and the index are kept by default: the camera's room
 * (occluders.js) and anything that casts a ray read them. For a geometry no one else holds (no cache of shapes shares it,
 * and nothing merges, clones or reads it later): the Colosseum's stands (props/arena.js arenaBuilder), the open air's land,
 * grass, trees and stones (env/index.js), made for one place and built again with it. Returns the geometry.
 */
export function packForCard(geometry, { keep = ['position'] } = {}) {
  if (!MESH_PACK.on || geometry.userData.packedForCard) return geometry;
  geometry.userData.packedForCard = true;
  const normal = geometry.attributes.normal;
  if (normal && !normal.isInterleavedBufferAttribute && normal.array instanceof Float32Array && normal.itemSize === 3) geometry.setAttribute('normal', packedNormals(normal.array));
  const color = geometry.attributes.color;
  if (color && !color.isInterleavedBufferAttribute && color.array instanceof Float32Array && color.itemSize === 3) geometry.setAttribute('color', packedColours(color.array));
  for (const [name, attribute] of Object.entries(geometry.attributes)) if (!keep.includes(name) && !attribute.isInterleavedBufferAttribute) freeOnUpload(attribute);
  return geometry;
}

/** Whether a geometry has packed or uploaded-and-freed attributes (it must not be merged, cloned or read). */
export function packedGeometry(geometry) {
  for (const attribute of Object.values(geometry.attributes)) {
    if (attribute.normalized || attribute.packedAway || attribute.onUploadCallback?.name === 'release') return true;
  }
  return false;
}
