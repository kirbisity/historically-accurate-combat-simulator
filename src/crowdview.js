// A crowd fighter drawn cheaply. Everything he wears (head, hands, boots,
// helmet, cloth) is baked into his skinned body at the bind pose, each piece
// riding one bone, so he is drawn as one body and one steel mesh (and their
// ink) instead of sixty meshes. Fighters who look alike share one baked
// body (a template): its vertices are built once, and each fighter's own
// build is met by stretching the template's bones to his lengths.

import { BONE, BONES, frameMatrix } from './rig.js';

export const CROWD_VIEW = {
  // Builds this close (cm of height, BMI points) share a template: the bones
  // stretch to each man's lengths, so the difference shows only in girth.
  heightStep: 6,
  bmiStep: 3,
  // A material this metallic is steel, drawn with the steel.
  steelMetalness: 0.3,
  // Only pieces this big (triangles), seen from one side, keep their ink: a
  // small or two-sided piece's outline shows through what lies over it.
  outlineTriangles: 600,
  // Crowd fighters further than this (m) from the camera are drawn without ink.
  inkDistance: 16,
  // Copies an instanced batch starts with room for (it doubles when full).
  batchCapacity: 64,
  // Beyond this (m) a man is drawn with his far body, a fifth of the
  // triangles: at 12 m he is a hundred pixels tall and the lost detail is
  // finer than that. Kept far until 1.5 m inside it (`lodMargin`), so a man
  // standing on the line does not flicker between the two.
  lodDistance: 12,
  lodMargin: 1.5,
  // A man down or out is seen as a shape on the ground and rarely looked at:
  // his far body is used from this near.
  fallenLodDistance: 6,
  // Men beyond this (m) from the camera cast no shadow (one mesh drawn twice
  // for a smudge on the ground); nor do men outside the shadow camera's box.
  shadowDistance: 20,
  fallenShadowDistance: 7,
  // Every man within this of the player (m) is drawn in full, with his
  // shadow, whatever the distance: the men he is fighting (see protectedMen).
  protectRadius: 3,
  // A man is drawn if a sphere this big (m) round his pelvis meets the
  // camera's view: it covers his longest weapon held out (a lance, 3.5 m) and
  // the length his shadow is thrown, so he does not blink out as he leaves
  // the screen with his spear (or his shadow) still in it.
  cullRadius: 4.5,
  // The far body is the near one with its vertices merged in cells this big
  // (m): 10 cm is a few pixels at 12 m, and leaves a man of about three
  // thousand triangles (a fifth of the near body's) whose limbs still bend
  // at the joints.
  farCell: 0.1,
  // Vertices only merge if their colours are within this step of each other
  // (0..1 per channel), so a belt, a sleeve and a face keep their own colours.
  farColorStep: 0.12,
  // 6: only vertices facing the same way (to the nearest of the six axes) merge,
  // so a cloth baked twice (front and back) or a thin blade does not fold
  // into one flat sheet; 1: any facing (half the vertices, but black patches
  // on a helmet's brim). Bare skin, a closed surface, merges at any facing.
  farFacings: 6,
  // Far, steel keeps its own mesh and its shine (a draw call a man more).
  farSteelApart: true,
  // The head's cells are this fraction of the others: a helmet or a face is
  // what tells one man from another, in a few hundred triangles.
  farHeadCell: 0.6,
  // What a crowd body's own outer layers cover (coverLayers): the shirt under a coat, the skin under both, the trouser leg in
  // a boot, the scalp under a helmet's lining. A point is covered when a ray out along its normal meets another piece of him
  // (not his bare skin) from inside within `coverReach` (m): the farthest an outer layer stands off what it hides from every
  // side (a lamellar skirt over the thigh, a padded coat over a shirt, a boot's shaft over the trouser leg are 2-8 cm; past
  // 10 cm, a flared skirt's hem, the legs inside can be seen up it). `coverFacing`: the cosine the piece met must face along
  // the ray by, so it is met from inside (its outer side faces away). `coverCell` (m): the cells the pieces are sorted into.
  coverLayers: true,
  coverReach: 0.1,
  coverFacing: 0.3,
  coverCell: 0.03,
  // A point standing out through the piece over it by up to `coverPull` (m) is under it in the outfit, and drawn in to
  // `coverGap` (m) inside it: a coarse ring's facets cut the round of the ring under it (a ten-sided ring of 15 cm stands
  // 7 mm in between its corners), a belt lofted 2 cm inside a skirt's top. One piece is over another where it covers at
  // least `coverOverMin` of the other's points, and twice as many as the other covers of its own (a few points either way
  // are where two pieces meet edge to edge, a sleeve's cuff on a gauntlet's).
  coverPull: 0.04,
  coverGap: 0.004,
  coverOverMin: 12,
  // A covered triangle is left out only if its corners and what covers them are weighted alike (the sum of their weights'
  // differences, 0..2, at most this): the skin under a shirt that takes the skin's own weights, the lining of a helmet.
  // Under a piece weighted otherwise it could come out from under it, posed, and must be there to be seen.
  coverTogether: 0.3,
};

/**
 * The template a crowd fighter shares: everything that changes how he is
 * drawn, his build rounded to the template steps.
 */
export function crowdKey(fighter) {
  const inputs = fighter.body.inputs;
  const { name, heightCm, age, exercise, calories, stats, frame, style, ...look } = inputs;
  const height = Math.round(heightCm / CROWD_VIEW.heightStep);
  const bmi = Math.round(fighter.body.composition.bmi / CROWD_VIEW.bmiStep);
  return JSON.stringify([fighter.corner, height, bmi, frame, look]);
}

/**
 * The shape a crowd template has, whatever its colours: `crowdKey` without the side, the skin, hair and eye colours and the
 * outfit's paint and theme (armythemes.js: colour only). Men of one shape and different colours share one template's vertices,
 * bones and triangles, each with only his own colours (render.js shareShape): a battle's men are each painted a little
 * differently, and a template per colour was a template per man (a 500-man battle of ten kinds of man baked 500 bodies, about
 * 0.9 MB each). Whether two men's bodies really are one shape is checked on what was built (`topologyOf`), not taken from this.
 */
export function crowdShapeKey(fighter) {
  const inputs = fighter.body.inputs;
  const { name, heightCm, age, exercise, calories, stats, frame, style, skill, ...look } = inputs;
  const shape = structuredClone(look);
  if (shape.look) for (const colour of ['skinTone', 'hairColor', 'eyeColor']) delete shape.look[colour];
  if (shape.outfit) for (const colour of ['paint', 'theme', 'colors']) delete shape.outfit[colour];
  const height = Math.round(heightCm / CROWD_VIEW.heightStep);
  const bmi = Math.round(fighter.body.composition.bmi / CROWD_VIEW.bmiStep);
  return JSON.stringify([height, bmi, frame, shape]);
}

/**
 * A number for what a template is made of: its vertex count, its triangles (each index) and which head each vertex goes with.
 * Two templates with the same are one mesh in two colourings (FNV-1a over the arrays; their lengths are in it too).
 */
export function topologyOf(template, names = ['bodyIndex', 'steelIndex', 'bodyOutlineIndex', 'steelOutlineIndex']) {
  let hash = 2166136261;
  const mix = (value) => {
    hash ^= value;
    hash = Math.imul(hash, 16777619) >>> 0;
  };
  mix(template.vertices);
  for (const name of names) {
    const indices = template[name];
    mix(indices.length);
    for (let at = 0; at < indices.length; at += 1) mix(indices[at]);
  }
  for (const variant of template.variant ?? []) mix(variant);
  for (const segment of template.vertexSegment ?? []) mix(segment ? 1 : 0);
  return hash;
}

/**
 * A far body's colours for another colouring of its template (`colors`, the near body's, vertex by vertex): each of the far
 * body's vertices the mean of the near ones it was merged from (simplifyTemplate's `clusterOf`, `members`).
 */
export function clusterColors(far, colors) {
  const out = new Float32Array(far.vertices * 3);
  for (let vertex = 0; vertex < far.clusterOf.length; vertex += 1) {
    const cluster = far.clusterOf[vertex];
    for (let axis = 0; axis < 3; axis += 1) out[cluster * 3 + axis] += colors[vertex * 3 + axis] / far.members[cluster];
  }
  return out;
}

/**
 * A crowd man's head is baked both ways: his helmet, and the hair (and beard, and long hair down the back) it hides. A man
 * shows one or the other by his own index (render.js crowdView, bareCrowdHead), so a helmet knocked off mid-fight is a new
 * index, not a new template baked (9-26 ms on the frame it fell in).
 */
export const HEAD_VARIANT = { always: 0, helmed: 1, bare: 2 };

/** The triangles of `indices` (a flat index) whose vertices are not of `variant` (`vertexVariant`: each vertex's HEAD_VARIANT). */
export function withoutVariant(indices, vertexVariant, variant) {
  return keepTriangles(indices, (vertex) => vertexVariant[vertex] !== variant);
}

/** The triangles of `indices` drawn only with `variant`. */
export function onlyVariant(indices, vertexVariant, variant) {
  return keepTriangles(indices, (vertex) => vertexVariant[vertex] === variant);
}

/** (A triangle's vertices all come from one mesh, so one has the variant of all three.) */
function keepTriangles(indices, keep) {
  const kept = new Uint32Array(indices.length);
  let length = 0;
  for (let corner = 0; corner + 2 < indices.length; corner += 3) {
    if (!keep(indices[corner])) continue;
    kept[length] = indices[corner];
    kept[length + 1] = indices[corner + 1];
    kept[length + 2] = indices[corner + 2];
    length += 3;
  }
  return kept.slice(0, length);
}

/**
 * Bake visible meshes into skinned vertices. `pieces` are {root, bone}: each
 * root already placed at the bind pose. Ink outlines, skinned meshes,
 * textured and see-through pieces are left alone (returned as `kept`).
 * Each vertex keeps its mesh's head variant (`userData.crowdVariant`, see HEAD_VARIANT): drawn only helmed, only bare, or always.
 * @returns {{ positions, normals, colors, skinIndex, variant: number[], body: number[], steel: number[], outlined: { body, steel }, baked: Mesh[] }}
 */
export function bakePieces(pieces) {
  const out = { positions: [], normals: [], colors: [], skinIndex: [], variant: [], body: [], steel: [], outlined: { body: [], steel: [] }, baked: [] };
  const vertex = new THREE.Vector3();
  const normal = new THREE.Vector3();
  const normalMatrix = new THREE.Matrix3();
  const color = new THREE.Color();
  for (const { root, bone } of pieces) {
    root.updateMatrixWorld(true);
    root.traverseVisible((mesh) => {
      if (!bakeable(mesh)) return;
      const material = mesh.material;
      out.baked.push(mesh);
      const geometry = mesh.geometry.attributes.normal ? mesh.geometry : mesh.geometry.clone();
      if (!geometry.attributes.normal) geometry.computeVertexNormals();
      const positions = geometry.attributes.position;
      const normals = geometry.attributes.normal;
      const vertexColors = material.vertexColors && geometry.attributes.color;
      normalMatrix.getNormalMatrix(mesh.matrixWorld);
      const mirrored = mesh.matrixWorld.determinant() < 0;
      const steel = (material.metalness ?? 0) > CROWD_VIEW.steelMetalness;
      const indices = geometry.index ? geometry.index.array : Array.from({ length: positions.count }, (_, index) => index);
      const inked = material.side !== THREE.DoubleSide && indices.length / 3 >= CROWD_VIEW.outlineTriangles;
      const targets = [steel ? out.steel : out.body];
      if (inked) targets.push(steel ? out.outlined.steel : out.outlined.body);
      // A cloth seen from both sides is baked twice, the back facing out.
      const sides = material.side === THREE.DoubleSide ? [1, -1] : [1];
      const variant = HEAD_VARIANT[mesh.userData.crowdVariant] ?? HEAD_VARIANT.always;
      for (const facing of sides) {
        const base = out.positions.length / 3;
        for (let index = 0; index < positions.count; index += 1) {
          vertex.fromBufferAttribute(positions, index).applyMatrix4(mesh.matrixWorld);
          normal.fromBufferAttribute(normals, index).applyMatrix3(normalMatrix).normalize().multiplyScalar(facing);
          if (vertexColors) color.fromBufferAttribute(geometry.attributes.color, index).multiply(material.color);
          else if (material.userData?.crowdColor !== undefined) color.set(material.userData.crowdColor);
          else color.copy(material.color);
          out.positions.push(vertex.x, vertex.y, vertex.z);
          out.normals.push(normal.x, normal.y, normal.z);
          out.colors.push(color.r, color.g, color.b);
          out.skinIndex.push(bone);
          out.variant.push(variant);
        }
        const flip = mirrored !== (facing < 0);
        for (let corner = 0; corner + 2 < indices.length; corner += 3) {
          const [a, b, c] = [indices[corner], indices[corner + 1], indices[corner + 2]];
          for (const target of targets) {
            if (flip) target.push(base + a, base + c, base + b);
            else target.push(base + a, base + b, base + c);
          }
        }
      }
    });
  }
  return out;
}

const TEMPLATE_INDEX_NAMES = ['bodyIndex', 'steelIndex', 'bodyOutlineIndex', 'steelOutlineIndex'];

/** Each vertex's piece: the connected run of triangles it is in (union-find over `indices`). */
function piecesOf(count, indices) {
  const parent = new Int32Array(count);
  for (let vertex = 0; vertex < count; vertex += 1) parent[vertex] = vertex;
  const root = (vertex) => {
    while (parent[vertex] !== vertex) {
      parent[vertex] = parent[parent[vertex]];
      vertex = parent[vertex];
    }
    return vertex;
  };
  for (let corner = 0; corner + 2 < indices.length; corner += 3) {
    const a = root(indices[corner]);
    for (const next of [indices[corner + 1], indices[corner + 2]]) {
      const b = root(next);
      if (a !== b) parent[b] = a;
    }
  }
  for (let vertex = 0; vertex < count; vertex += 1) parent[vertex] = root(vertex);
  return parent;
}

/** A template's pieces and triangles, sorted into cells of `cell` m, for casting rays from its points (castLayer). */
export function layerGrid(template, indices, cell) {
  const position = template.attributes.position.array;
  const skin = (vertex) => Boolean(template.vertexSegment?.[vertex]);
  const grid = { cells: new Map(), cell, piece: piecesOf(template.vertices, indices), indices, position, variant: template.variant ?? new Uint8Array(template.vertices), skin, tried: new Int32Array(indices.length / 3), rays: 0 };
  const low = [0, 0, 0];
  const high = [0, 0, 0];
  for (let corner = 0; corner + 2 < indices.length; corner += 3) {
    const a = indices[corner] * 3, b = indices[corner + 1] * 3, c = indices[corner + 2] * 3;
    for (let axis = 0; axis < 3; axis += 1) {
      low[axis] = layerCell(grid, Math.min(position[a + axis], position[b + axis], position[c + axis]));
      high[axis] = layerCell(grid, Math.max(position[a + axis], position[b + axis], position[c + axis]));
    }
    for (let x = low[0]; x <= high[0]; x += 1) {
      for (let y = low[1]; y <= high[1]; y += 1) {
        for (let z = low[2]; z <= high[2]; z += 1) {
          const key = layerCellKey(x, y, z);
          let list = grid.cells.get(key);
          if (!list) grid.cells.set(key, (list = []));
          list.push(corner);
        }
      }
    }
  }
  return grid;
}

const layerCell = (grid, value) => Math.floor(value / grid.cell) + 512;
const layerCellKey = (x, y, z) => (x * 1024 + y) * 1024 + z;

/**
 * The first thing of another piece than `vertex`'s, drawn whenever it is (a helmet covers the scalp only while it is worn:
 * HEAD_VARIANT), that a ray from the vertex along `direction` meets within `reach`, if it is a layer met as `side` asks:
 * from inside (1: the triangle faces along the ray by `facing`, as a layer over the point does) or from outside (-1: it
 * faces back at it). Bare skin is never a layer (a limb's root inside the trunk's shoulder is a joint), nor is anything
 * met the other way first: a ray from the hip through the sleeve of the arm hanging beside it meets the sleeve's far side
 * from inside, and the near side, met first, says it is no layer over the hip. { triangle (its first corner), piece, u, v, t } or null.
 */
export function castLayer(grid, vertex, direction, reach, side, facing) {
  const { position, indices, piece, variant, tried } = grid;
  const ox = position[vertex * 3], oy = position[vertex * 3 + 1], oz = position[vertex * 3 + 2];
  const [dx, dy, dz] = direction;
  // (Each triangle tried once a ray: marked with the ray's number.)
  const ray = (grid.rays += 1);
  let best = null;
  // Cell by cell out along the ray (half a cell a step); the nearest hit kept.
  for (let along = 0; along <= reach + grid.cell && !best; along += grid.cell / 2) {
    const list = grid.cells.get(layerCellKey(layerCell(grid, ox + dx * along), layerCell(grid, oy + dy * along), layerCell(grid, oz + dz * along)));
    if (!list) continue;
    for (let at = 0; at < list.length; at += 1) {
      const corner = list[at];
      if (tried[corner / 3] === ray) continue;
      tried[corner / 3] = ray;
      const a = indices[corner];
      if (piece[a] === piece[vertex]) continue;
      if (variant[a] !== HEAD_VARIANT.always && variant[a] !== variant[vertex]) continue;
      const b = indices[corner + 1], c = indices[corner + 2];
      const hit = rayTriangle(position, ox, oy, oz, dx, dy, dz, a, b, c);
      if (hit && hit.t <= reach && (!best || hit.t < best.t)) best = { triangle: corner, piece: piece[a], u: hit.u, v: hit.v, t: hit.t, along: hit.along, skin: grid.skin(a) && grid.skin(b) && grid.skin(c) };
    }
  }
  return best && !best.skin && side * best.along >= facing ? best : null;
}

/** Where a ray meets triangle a, b, c: { t, u, v, along (the cosine of its normal with the ray) }, or null. */
function rayTriangle(position, ox, oy, oz, dx, dy, dz, a, b, c) {
  const e1x = position[b * 3] - position[a * 3], e1y = position[b * 3 + 1] - position[a * 3 + 1], e1z = position[b * 3 + 2] - position[a * 3 + 2];
  const e2x = position[c * 3] - position[a * 3], e2y = position[c * 3 + 1] - position[a * 3 + 1], e2z = position[c * 3 + 2] - position[a * 3 + 2];
  const nx = e1y * e2z - e1z * e2y, ny = e1z * e2x - e1x * e2z, nz = e1x * e2y - e1y * e2x;
  const area = Math.hypot(nx, ny, nz);
  if (area < 1e-12) return null;
  const px = dy * e2z - dz * e2y, py = dz * e2x - dx * e2z, pz = dx * e2y - dy * e2x;
  const det = e1x * px + e1y * py + e1z * pz;
  if (Math.abs(det) < 1e-12) return null;
  const inverse = 1 / det;
  const tx = ox - position[a * 3], ty = oy - position[a * 3 + 1], tz = oz - position[a * 3 + 2];
  const u = (tx * px + ty * py + tz * pz) * inverse;
  if (u < 0 || u > 1) return null;
  const qx = ty * e1z - tz * e1y, qy = tz * e1x - tx * e1z, qz = tx * e1y - ty * e1x;
  const v = (dx * qx + dy * qy + dz * qz) * inverse;
  if (v < 0 || u + v > 1) return null;
  const t = (e2x * qx + e2y * qy + e2z * qz) * inverse;
  // (Not the vertex's own place: a cloth baked twice, its two sides one on the other.)
  return t > 0.002 ? { t, u, v, along: (nx * dx + ny * dy + nz * dz) / area } : null;
}

/** A vertex's weights as bone -> weight. */
function weightsOf(skinIndex, skinWeight, vertex) {
  const weights = new Map();
  for (let slot = 0; slot < 4; slot += 1) {
    const weight = skinWeight[vertex * 4 + slot];
    if (weight > 0) weights.set(skinIndex[vertex * 4 + slot], (weights.get(skinIndex[vertex * 4 + slot]) ?? 0) + weight);
  }
  return weights;
}

/** How differently a vertex and the point of its cover are moved by the bones: the sum of their weights' differences (0..2). */
function weightGap(grid, skinIndex, skinWeight, vertex, cover) {
  const own = weightsOf(skinIndex, skinWeight, vertex);
  const corners = [0, 1, 2].map((k) => grid.indices[cover.triangle + k]);
  const shares = [1 - cover.u - cover.v, cover.u, cover.v];
  const over = new Map();
  corners.forEach((corner, at) => {
    for (const [bone, weight] of weightsOf(skinIndex, skinWeight, corner)) over.set(bone, (over.get(bone) ?? 0) + weight * shares[at]);
  });
  let gap = 0;
  for (const bone of new Set([...own.keys(), ...over.keys()])) gap += Math.abs((own.get(bone) ?? 0) - (over.get(bone) ?? 0));
  return gap;
}

/**
 * A crowd body's layers kept one inside another (CROWD_VIEW.coverLayers). A full man's skin under his armour is left out
 * (loftbody.js hideCovered); a crowd man's was all drawn, the skin under his shirt, the shirt under his coat, the trouser
 * leg in his boot, each a coarse ring of a few sides crossing the coarse ring over it between their corners: what lies under
 * showed through the outer layer in flecks and patches, standing as at a run, and more as the far body's merging moved the
 * points. Here, at the bind pose, with what was baked on him (helmet, hands, boots, what hangs at his collar and hips):
 *   - a point standing out a little through the piece over its own (CROWD_VIEW.coverPull) is drawn in under it
 *     (`coverGap`): the outer layer is the outfit as fitted, and is never moved;
 *   - a triangle covered at every corner by pieces the bones move as they move it (CROWD_VIEW.coverTogether) is left out,
 *     but for the ring of it at the layer's edge, and then the points no triangle uses: it stays under them
 *     in every pose, so nothing is lost to sight, and there is less of him to draw (a tenth of his triangles, measured
 *     2026-11-27 on a custom battle of 300).
 * What lies under a piece weighted otherwise (a coat's skirt hung from the hips over a thigh, a boot on the foot over the
 * shin) is kept: posed, it can come out from under it, and left out it would leave a hole there.
 * In place, before the far body and the two heads are made from it; returns `kept` (the old vertex of each new one), for
 * another colouring of the same shape to be cut to (keptOf).
 */
export function coverLayers(template, { reach = CROWD_VIEW.coverReach, facing = CROWD_VIEW.coverFacing, cell = CROWD_VIEW.coverCell, pull = CROWD_VIEW.coverPull, gap = CROWD_VIEW.coverGap, together = CROWD_VIEW.coverTogether, overMin = CROWD_VIEW.coverOverMin } = {}) {
  const drawn = new Uint32Array(template.bodyIndex.length + template.steelIndex.length);
  drawn.set(template.bodyIndex);
  drawn.set(template.steelIndex, template.bodyIndex.length);
  const grid = layerGrid(template, drawn, cell);
  const position = template.attributes.position.array;
  const normal = template.attributes.normal.array;
  const count = template.vertices;
  const used = new Uint8Array(count);
  for (let corner = 0; corner + 2 < drawn.length; corner += 3) {
    for (let k = 0; k < 3; k += 1) {
      used[drawn[corner + k]] = 1;
    }
  }
  const out = (vertex) => [normal[vertex * 3], normal[vertex * 3 + 1], normal[vertex * 3 + 2]];
  const covers = new Array(count).fill(null);
  for (let vertex = 0; vertex < count; vertex += 1) if (used[vertex]) covers[vertex] = castLayer(grid, vertex, out(vertex), reach, 1, facing);
  // Which piece lies over which: piece P is over piece A where it covers many of A's points and A few of P's (as a full
  // man's layers are ranked: loftbody.js keepLayersInside). A point of A standing out through P is drawn in under it.
  const coveredBy = new Map();
  covers.forEach((cover, vertex) => {
    if (!cover) return;
    const key = `${grid.piece[vertex]}|${cover.piece}`;
    coveredBy.set(key, (coveredBy.get(key) ?? 0) + 1);
  });
  const over = (piece, layer) => {
    const under = coveredBy.get(`${piece}|${layer}`) ?? 0;
    return under >= overMin && under > 2 * (coveredBy.get(`${layer}|${piece}`) ?? 0);
  };
  // (Only the points of a piece something lies over are tried: the outermost pieces, the head, the hands, are never under.)
  const underSome = new Set();
  for (const key of coveredBy.keys()) {
    const [piece, layer] = key.split('|').map(Number);
    if (over(piece, layer)) underSome.add(piece);
  }
  let pulled = 0;
  for (let vertex = 0; vertex < count; vertex += 1) {
    if (!used[vertex] || covers[vertex] || !underSome.has(grid.piece[vertex])) continue;
    const [nx, ny, nz] = out(vertex);
    const hit = castLayer(grid, vertex, [-nx, -ny, -nz], pull, -1, facing);
    if (!hit || !over(grid.piece[vertex], hit.piece)) continue;
    for (let axis = 0; axis < 3; axis += 1) position[vertex * 3 + axis] -= [nx, ny, nz][axis] * (hit.t + gap);
    covers[vertex] = hit;
    pulled += 1;
  }
  const skinIndex = template.attributes.skinIndex.array;
  const skinWeight = template.attributes.skinWeight.array;
  const covered = covers.map((cover, vertex) => Boolean(cover) && weightGap(grid, skinIndex, skinWeight, vertex, cover) <= together);
  // (Not the ring of covered points next to what is not: at the edge of a layer, a collar's, a cuff's, a coat's opening, the
  // eye looks in under it at a slant, and the layer beneath must be there to be seen, or the man is seen through.)
  const edge = new Uint8Array(count);
  for (let corner = 0; corner + 2 < drawn.length; corner += 3) {
    const [a, b, c] = [drawn[corner], drawn[corner + 1], drawn[corner + 2]];
    if (!(covered[a] && covered[b] && covered[c])) edge[a] = edge[b] = edge[c] = 1;
  }
  const hidden = covered.map((flag, vertex) => flag && !edge[vertex]);
  for (const name of TEMPLATE_INDEX_NAMES) {
    const indices = template[name];
    const kept = [];
    for (let corner = 0; corner + 2 < indices.length; corner += 3) {
      if (hidden[indices[corner]] && hidden[indices[corner + 1]] && hidden[indices[corner + 2]]) continue;
      kept.push(indices[corner], indices[corner + 1], indices[corner + 2]);
    }
    template[name] = Uint32Array.from(kept);
  }
  // (What was done, for the tools: points covered, left out and drawn in.)
  template.coverStats = { covered: covered.filter(Boolean).length, hidden: hidden.filter(Boolean).length, pulled };
  return compactTemplate(template);
}

/** A per-vertex array (`width` numbers a vertex) cut to the vertices `kept`. */
export function keptOf(array, kept, width = 1) {
  if (!array) return array;
  const out = Array.isArray(array) ? new Array(kept.length * width) : new array.constructor(kept.length * width);
  for (let to = 0; to < kept.length; to += 1) for (let axis = 0; axis < width; axis += 1) out[to * width + axis] = array[kept[to] * width + axis];
  return out;
}

/** A template without the vertices no triangle uses (its attributes, colours, marks and indices renumbered); returns `kept`. */
function compactTemplate(template) {
  const used = new Int32Array(template.vertices).fill(-1);
  for (const name of TEMPLATE_INDEX_NAMES) for (const vertex of template[name]) used[vertex] = 0;
  const kept = [];
  used.forEach((flag, vertex) => {
    if (flag === 0) {
      used[vertex] = kept.length;
      kept.push(vertex);
    }
  });
  const keptIds = Uint32Array.from(kept);
  // (The template's own attributes, just baked and not yet sent to the card: cut in place.)
  for (const attribute of Object.values(template.attributes)) {
    attribute.array = keptOf(attribute.array, keptIds, attribute.itemSize);
    attribute.count = kept.length;
  }
  template.colors = keptOf(template.colors, keptIds, 3);
  template.vertexSegment = keptOf(template.vertexSegment, keptIds);
  template.variant = keptOf(template.variant, keptIds);
  for (const name of TEMPLATE_INDEX_NAMES) template[name] = template[name].map((vertex) => used[vertex]);
  template.vertices = kept.length;
  return keptIds;
}

/**
 * A coarser copy of a template by vertex clustering: vertices in the same
 * cell (`cell` m) with the same strongest bone, colour and facing become one
 * (position, normal, colour and skin weights averaged), and triangles that
 * fall in on themselves or repeat are dropped. Its bones are the template's,
 * so the same skeleton poses both. Plain arrays out (see farTemplate in render.js).
 */
export function simplifyTemplate(template, { cell = CROWD_VIEW.farCell, colorStep = CROWD_VIEW.farColorStep, facings = CROWD_VIEW.farFacings } = {}) {
  const position = template.attributes.position.array;
  const normal = template.attributes.normal.array;
  const skinIndex = template.attributes.skinIndex.array;
  const skinWeight = template.attributes.skinWeight.array;
  const colors = template.colors;
  const variant = template.variant ?? null;
  const count = position.length / 3;
  const clusterOf = new Uint32Array(count);
  const keys = new Map();
  // Per cluster: its first vertex (whose bones it keeps) and the number it merged.
  const first = [];
  const members = [];
  const colorLevels = Math.ceil(1 / colorStep);
  for (let vertex = 0; vertex < count; vertex += 1) {
    const [nx, ny, nz] = [normal[vertex * 3], normal[vertex * 3 + 1], normal[vertex * 3 + 2]];
    const [ax, ay, az] = [Math.abs(nx), Math.abs(ny), Math.abs(nz)];
    const facing = facings < 6 || template.vertexSegment[vertex] ? 0 : ax >= ay && ax >= az ? (nx > 0 ? 0 : 1) : ay >= az ? (ny > 0 ? 2 : 3) : nz > 0 ? 4 : 5;
    // One number for the cell, strongest bone, colour class and facing.
    let key = 0;
    // A head has smaller cells: a helmet or a face is read from afar, and is a few hundred triangles in a small space.
    const size = skinIndex[vertex * 4] === BONE.head ? cell * CROWD_VIEW.farHeadCell : cell;
    for (let axis = 0; axis < 3; axis += 1) key = key * 256 + Math.min(255, Math.max(0, Math.floor(position[vertex * 3 + axis] / size) + 128));
    key = key * 32 + skinIndex[vertex * 4];
    for (let axis = 0; axis < 3; axis += 1) key = key * colorLevels + Math.min(colorLevels - 1, Math.floor(colors[vertex * 3 + axis] / colorStep));
    key = key * 8 + facing;
    // A helmet's vertex and the hair under it never merge: each must go with its own head.
    key = key * 3 + (variant ? variant[vertex] : 0);
    let cluster = keys.get(key);
    if (cluster === undefined) {
      cluster = first.length;
      keys.set(key, cluster);
      first.push(vertex);
      members.push(0);
    }
    clusterOf[vertex] = cluster;
    members[cluster] += 1;
  }
  const total = first.length;
  const out = {
    position: new Float32Array(total * 3),
    normal: new Float32Array(total * 3),
    skinIndex: new Uint16Array(total * 4),
    skinWeight: new Float32Array(total * 4),
    colors: new Float32Array(total * 3),
    vertexSegment: new Array(total).fill(null),
  };
  for (let cluster = 0; cluster < total; cluster += 1) {
    for (let slot = 0; slot < 4; slot += 1) out.skinIndex[cluster * 4 + slot] = skinIndex[first[cluster] * 4 + slot];
  }
  for (let vertex = 0; vertex < count; vertex += 1) {
    const cluster = clusterOf[vertex];
    for (let axis = 0; axis < 3; axis += 1) {
      out.position[cluster * 3 + axis] += position[vertex * 3 + axis] / members[cluster];
      out.normal[cluster * 3 + axis] += normal[vertex * 3 + axis];
      out.colors[cluster * 3 + axis] += colors[vertex * 3 + axis] / members[cluster];
    }
    // His weights go to the bones the cluster keeps (those of its first vertex).
    for (let slot = 0; slot < 4; slot += 1) {
      const weight = skinWeight[vertex * 4 + slot];
      if (weight <= 0) continue;
      for (let kept = 0; kept < 4; kept += 1) {
        if (out.skinIndex[cluster * 4 + kept] === skinIndex[vertex * 4 + slot]) {
          out.skinWeight[cluster * 4 + kept] += weight;
          break;
        }
      }
    }
    out.vertexSegment[cluster] ??= template.vertexSegment[vertex];
  }
  for (let cluster = 0; cluster < total; cluster += 1) {
    const length = Math.hypot(out.normal[cluster * 3], out.normal[cluster * 3 + 1], out.normal[cluster * 3 + 2]) || 1;
    let sum = 0;
    for (let slot = 0; slot < 4; slot += 1) sum += out.skinWeight[cluster * 4 + slot];
    for (let axis = 0; axis < 3; axis += 1) out.normal[cluster * 3 + axis] /= length;
    for (let slot = 0; slot < 4; slot += 1) out.skinWeight[cluster * 4 + slot] = sum > 0 ? out.skinWeight[cluster * 4 + slot] / sum : slot === 0 ? 1 : 0;
  }
  const remap = (indices) => {
    const seen = new Set();
    const kept = [];
    const base = total + 1;
    for (let corner = 0; corner + 2 < indices.length; corner += 3) {
      const [a, b, c] = [clusterOf[indices[corner]], clusterOf[indices[corner + 1]], clusterOf[indices[corner + 2]]];
      if (a === b || b === c || a === c) continue;
      // The same triangle, whichever corner it starts from.
      const [x, y, z] = a < b && a < c ? [a, b, c] : b < c ? [b, c, a] : [c, a, b];
      const id = (x * base + y) * base + z;
      if (seen.has(id)) continue;
      seen.add(id);
      kept.push(a, b, c);
    }
    return Uint32Array.from(kept);
  };
  return {
    position: out.position,
    normal: out.normal,
    skinIndex: out.skinIndex,
    skinWeight: out.skinWeight,
    colors: out.colors,
    bodyIndex: remap(template.bodyIndex),
    steelIndex: remap(template.steelIndex),
    bodyOutlineIndex: remap(template.bodyOutlineIndex),
    steelOutlineIndex: remap(template.steelOutlineIndex),
    vertexSegment: out.vertexSegment,
    variant: variant ? Uint8Array.from(first, (vertex) => variant[vertex]) : null,
    vertices: total,
    // Which far vertex each near one went into, and how many went into each: another colouring's far colours (clusterColors).
    clusterOf,
    members: Uint32Array.from(members),
  };
}

/** A plain, solid, untextured mesh: one that can be baked. */
export function bakeable(mesh) {
  if (!mesh.isMesh || mesh.isSkinnedMesh || mesh.userData.outline || Array.isArray(mesh.material)) return false;
  if (mesh.material.transparent || mesh.material.wireframe) return false;
  // A helmet or mask wearing a baked sheet bakes in its own colour (`crowdColor`): its shape is what tells a man in a crowd.
  return !mesh.material.map || mesh.material.userData?.crowdColor !== undefined;
}

/** The world matrix of a frame placed at `origin` (default its own), as a Matrix4. */
export function frameAt(frame, origin = frame.origin) {
  return new THREE.Matrix4().fromArray(frameMatrix({ ...frame, origin }));
}

/**
 * Bone inverses that fit a template's body to another build: each bone of
 * the template stretched along its length to his, the head scaled whole.
 */
export function stretchedInverses(templateFrames, ownFrames, headScale) {
  const length = (frame) => (frame.end ? Math.hypot(...frame.end.map((value, axis) => value - frame.origin[axis])) : 0);
  return BONES.map((_, bone) => {
    const inverse = new THREE.Matrix4().fromArray(frameMatrix(templateFrames[bone])).invert();
    const from = length(templateFrames[bone]);
    const along = from > 1e-6 ? length(ownFrames[bone]) / from : 1;
    const scale = bone === BONE.head ? new THREE.Matrix4().makeScale(headScale, headScale, headScale) : new THREE.Matrix4().makeScale(1, along, 1);
    return scale.multiply(inverse);
  });
}

/**
 * Many copies of one rigid piece (a weapon, a shield, a banner) carried by
 * a crowd, drawn as one instanced mesh per material. Each frame: `begin`,
 * an `add` for each copy shown, `end`.
 */
export class CrowdBatch {
  constructor(scene, source, capacity = CROWD_VIEW.batchCapacity) {
    this.scene = scene;
    this.capacity = capacity;
    this.count = 0;
    // A source with parts that move on their own (a bow's string) keeps those per fighter.
    this.live = Boolean(source.userData.bow);
    this.parts = [];
    source.updateMatrixWorld(true);
    const toSource = new THREE.Matrix4().copy(source.matrixWorld).invert();
    const meshes = [];
    source.traverseVisible((mesh) => {
      if (mesh.isMesh && !mesh.userData.outline) meshes.push(mesh);
    });
    for (const mesh of meshes) {
      const geometry = mesh.geometry.clone().applyMatrix4(new THREE.Matrix4().multiplyMatrices(toSource, mesh.matrixWorld));
      this.parts.push({ geometry, material: mesh.material, castShadow: mesh.castShadow, instanced: null });
    }
    this.allocate();
  }

  allocate() {
    for (const part of this.parts) {
      const old = part.instanced;
      part.instanced = new THREE.InstancedMesh(part.geometry, part.material, this.capacity);
      // Grown in the middle of a frame: the copies already placed carry over (else they draw at the origin for a frame).
      if (old) {
        part.instanced.instanceMatrix.array.set(old.instanceMatrix.array);
        this.scene.remove(old);
        old.dispose?.();
      }
      part.instanced.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
      part.instanced.castShadow = part.castShadow;
      // The copies are all over the field: never culled as one.
      part.instanced.frustumCulled = false;
      part.instanced.count = 0;
      this.scene.add(part.instanced);
    }
  }

  begin() {
    this.count = 0;
  }

  add(matrix) {
    if (this.count === this.capacity) {
      this.capacity *= 2;
      this.allocate();
    }
    for (const part of this.parts) part.instanced.setMatrixAt(this.count, matrix);
    this.count += 1;
  }

  end() {
    for (const part of this.parts) {
      part.instanced.count = this.count;
      part.instanced.instanceMatrix.needsUpdate = true;
    }
  }

  dispose() {
    for (const part of this.parts) {
      this.scene.remove(part.instanced);
      part.instanced.dispose?.();
      part.geometry.dispose();
    }
  }
}

/** Start and finish a frame of every crowd batch in a view. */
export function beginCrowdBatches(view) {
  for (const batch of view.crowdBatches?.values() ?? []) batch.begin();
}

export function endCrowdBatches(view) {
  for (const batch of view.crowdBatches?.values() ?? []) batch.end();
}

/** The view's batch for `key`, made from `build()` the first time. */
export function crowdBatch(view, key, build) {
  view.crowdBatches ??= new Map();
  if (!view.crowdBatches.has(key)) view.crowdBatches.set(key, new CrowdBatch(view.scene, build()));
  return view.crowdBatches.get(key);
}
