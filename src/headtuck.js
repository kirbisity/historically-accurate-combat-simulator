// The head under what is worn on it: a helmet, a hat, a hood, a mask. Each is drawn to its own shape round the game's head
// (helmforms.js, wardrobe.js), and a head of another breadth or brow, or the scalp's hair, stood out through it: the forehead
// through a hat's band, the scalp through a kettle's brim, a cheek through a cheek plate, hair through a fur cap. The
// head-side twin of the body's skin left out under armour (loftbody.js coveredRegions): every point of the head and its hair
// that lies outside a worn piece's surface, found by looking in along its own normal and meeting that surface within
// HEAD_TUCK.reach, is drawn in to HEAD_TUCK.margin inside it. It is worked out from the shapes as they are, whatever head
// mesh is drawn (the photo lattice, a drawn head, a lower-resolution one), and given back when the piece comes off.

/* global THREE */

export const HEAD_TUCK = {
  // How far (m) a point may stand out through a worn piece and still be under it: a piece seen from the point within this,
  // looking in along the point's normal, covers it. More than any head's departure from the shape a helmet was drawn round
  // (a broad skull's 1-2 cm, a heavy brow's 1 cm), less than a face's depth below an open helmet's rim, so the face in the
  // opening is never drawn in to the rim.
  reach: 0.03,
  // How far (m) inside the piece's surface a covered point is laid: a lining's thickness, enough that it never shows through
  // the piece's faces, flat between their corners.
  margin: 0.003,
  // The cells (m) the pieces' triangles are sorted into to be looked up.
  cell: 0.03,
};

/** The triangles of the visible meshes under `roots`, in `frame`'s space (flat [ax, ay, az, bx, ...], 9 a triangle). */
function headTuckTriangles(roots, frame) {
  const toFrame = new THREE.Matrix4().copy(frame.matrixWorld).invert();
  const out = [];
  const p = new THREE.Vector3();
  for (const root of roots) {
    root.traverse((mesh) => {
      if (!mesh.isMesh || mesh.userData.outline || !mesh.visible || !mesh.geometry?.attributes.position) return;
      for (let node = mesh.parent; node && node !== root; node = node.parent) if (!node.visible) return;
      const matrix = new THREE.Matrix4().multiplyMatrices(toFrame, mesh.matrixWorld);
      const position = mesh.geometry.attributes.position;
      const index = mesh.geometry.index;
      const count = index ? index.count : position.count;
      for (let corner = 0; corner + 2 < count; corner += 3) {
        for (let k = 0; k < 3; k += 1) {
          p.fromBufferAttribute(position, index ? index.getX(corner + k) : corner + k).applyMatrix4(matrix);
          out.push(p.x, p.y, p.z);
        }
      }
    });
  }
  return out;
}

/** Where a ray from `o` along `d` meets the triangle at `t` (index into `tris`), or Infinity (Möller-Trumbore, both faces). */
function headTuckRay(o, d, tris, t) {
  const ax = tris[t], ay = tris[t + 1], az = tris[t + 2];
  const e1x = tris[t + 3] - ax, e1y = tris[t + 4] - ay, e1z = tris[t + 5] - az;
  const e2x = tris[t + 6] - ax, e2y = tris[t + 7] - ay, e2z = tris[t + 8] - az;
  const px = d[1] * e2z - d[2] * e2y, py = d[2] * e2x - d[0] * e2z, pz = d[0] * e2y - d[1] * e2x;
  const det = e1x * px + e1y * py + e1z * pz;
  if (Math.abs(det) < 1e-12) return Infinity;
  const inv = 1 / det;
  const sx = o[0] - ax, sy = o[1] - ay, sz = o[2] - az;
  const u = (sx * px + sy * py + sz * pz) * inv;
  if (u < 0 || u > 1) return Infinity;
  const qx = sy * e1z - sz * e1y, qy = sz * e1x - sx * e1z, qz = sx * e1y - sy * e1x;
  const v = (d[0] * qx + d[1] * qy + d[2] * qz) * inv;
  if (v < 0 || u + v > 1) return Infinity;
  const hit = (e2x * qx + e2y * qy + e2z * qz) * inv;
  return hit >= 0 ? hit : Infinity;
}

/**
 * Draw the head's points (and its hair's) out through what is worn on it in under it (HEAD_TUCK). `head` is the head's view
 * (face.js: `group`, `shell` its soft skull), `covers` the worn pieces' groups (children of the head's group). Returns the
 * undoing, or null when nothing stood out.
 */
export function tuckHead(head, covers) {
  const spec = HEAD_TUCK;
  const roots = covers.filter(Boolean);
  if (!roots.length) return null;
  head.group.updateWorldMatrix(true, true);
  const tris = headTuckTriangles(roots, head.group);
  if (!tris.length) return null;
  const cells = new Map();
  const key = (x, y, z) => `${x}|${y}|${z}`;
  for (let t = 0; t < tris.length; t += 9) {
    const lo = [0, 1, 2].map((k) => Math.floor(Math.min(tris[t + k], tris[t + 3 + k], tris[t + 6 + k]) / spec.cell));
    const hi = [0, 1, 2].map((k) => Math.floor(Math.max(tris[t + k], tris[t + 3 + k], tris[t + 6 + k]) / spec.cell));
    if (hi[0] - lo[0] > 8 || hi[1] - lo[1] > 8 || hi[2] - lo[2] > 8) continue;
    for (let x = lo[0]; x <= hi[0]; x += 1) for (let y = lo[1]; y <= hi[1]; y += 1) for (let z = lo[2]; z <= hi[2]; z += 1) {
      const k = key(x, y, z);
      (cells.get(k) ?? cells.set(k, []).get(k)).push(t);
    }
  }
  const inCovers = (object) => {
    for (let node = object; node && node !== head.group; node = node.parent) if (roots.includes(node)) return true;
    return false;
  };
  const undo = [];
  const toFrame = new THREE.Matrix4().copy(head.group.matrixWorld).invert();
  const shellMesh = head.shell?.mesh ?? null;
  head.group.traverse((mesh) => {
    if (!mesh.isMesh || !mesh.visible || mesh.userData.outline || inCovers(mesh) || !mesh.geometry?.attributes.normal) return;
    const geometry = mesh.geometry;
    const position = geometry.attributes.position;
    const normal = geometry.attributes.normal;
    const matrix = new THREE.Matrix4().multiplyMatrices(toFrame, mesh.matrixWorld);
    const back = new THREE.Matrix4().copy(matrix).invert();
    const turn = new THREE.Matrix3().getNormalMatrix(matrix);
    const soft = mesh === shellMesh ? head.shell : null;
    const source = soft ? soft.rest : position.array;
    const moved = new Map();
    const p = new THREE.Vector3();
    const n = new THREE.Vector3();
    const seen = new Set();
    for (let vertex = 0; vertex < position.count; vertex += 1) {
      p.set(source[vertex * 3], source[vertex * 3 + 1], source[vertex * 3 + 2]).applyMatrix4(matrix);
      n.fromBufferAttribute(normal, vertex).applyMatrix3(turn);
      if (n.lengthSq() < 1e-12) continue;
      n.normalize();
      const o = [p.x, p.y, p.z];
      const d = [-n.x, -n.y, -n.z];
      let nearest = Infinity;
      seen.clear();
      const [cx, cy, cz] = o.map((value) => Math.floor(value / spec.cell));
      for (let dx = -1; dx <= 1; dx += 1) for (let dy = -1; dy <= 1; dy += 1) for (let dz = -1; dz <= 1; dz += 1) {
        for (const t of cells.get(key(cx + dx, cy + dy, cz + dz)) ?? []) {
          if (seen.has(t)) continue;
          seen.add(t);
          nearest = Math.min(nearest, headTuckRay(o, d, tris, t));
        }
      }
      if (nearest > spec.reach) continue;
      p.addScaledVector(n, -(nearest + spec.margin)).applyMatrix4(back);
      moved.set(vertex, [p.x, p.y, p.z]);
    }
    if (!moved.size) return;
    // (A geometry shared with other heads, a hair cut's, is copied first: only this head's is drawn in.)
    let target = geometry;
    if (!soft && geometry.userData.headTuckOwn !== true) {
      target = geometry.clone();
      target.userData.headTuckOwn = true;
      const was = geometry;
      const users = [mesh, ...mesh.children.filter((child) => child.isMesh && child.geometry === was)];
      for (const user of users) user.geometry = target;
      undo.push(() => {
        for (const user of users) user.geometry = was;
        target.dispose();
      });
      return void applyHeadTuck(target.attributes.position.array, moved, target);
    }
    const array = soft ? soft.rest : position.array;
    const kept = new Map([...moved.keys()].map((vertex) => [vertex, [array[vertex * 3], array[vertex * 3 + 1], array[vertex * 3 + 2]]]));
    applyHeadTuck(array, moved, soft ? null : geometry);
    if (soft) {
      position.array.set(soft.rest);
      position.needsUpdate = true;
    }
    undo.push(() => {
      applyHeadTuck(array, kept, soft ? null : geometry);
      if (soft) {
        position.array.set(soft.rest);
        position.needsUpdate = true;
      }
    });
  });
  if (!undo.length) return null;
  return () => undo.splice(0).reverse().forEach((step) => step());
}

/** Write points (vertex -> [x, y, z]) into a position array; the geometry told, if given. */
function applyHeadTuck(array, points, geometry) {
  for (const [vertex, [x, y, z]] of points) {
    array[vertex * 3] = x;
    array[vertex * 3 + 1] = y;
    array[vertex * 3 + 2] = z;
  }
  if (geometry) geometry.attributes.position.needsUpdate = true;
}
