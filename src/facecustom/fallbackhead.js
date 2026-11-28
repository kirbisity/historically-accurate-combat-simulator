// The face customiser's own head, made from nothing: for wherever the head model's data (headgrid-data.js) is not to hand
// (a page that carries no assets, a tool, a test). The same lay-out as the head model's (headlattice.js): a lattice of points
// on the photo atlas, a point for each [share round from the face's middle, row down from the crown], closer together over
// the face, so the solver's landmarks (solver.js FACE_LANDMARK_PLACES), the photo maps and the procedural ones (skin.js) all
// fit it as they fit the model. Its shape is a smooth head (an oval each row, its height, breadth and depth read off the
// model's rows) with a real face's structure raised on it (photohead.js faceStructure: the nose, brow, sockets, cheekbones,
// lips and chin the drawn photo head was given). A mannequin beside the model, and enough to see every slider work.
//
// Plain arrays (no three.js).

import { gridNormals, gridTangents, latticeIndices, thinnedIndices } from '../headlattice.js';
import { faceStructure, headSmooth, photoLandmarks } from '../photohead.js';

export const FALLBACK_HEAD = {
  // The rows down the atlas: sparse over the crown, every eightieth of the way from the brow to the jaw, then the jaw's
  // line (`lid`: the model's, where the neck meets the head) and the lid across it.
  crown: [0, 0.06, 0.12, 0.18, 0.24, 0.3, 0.34, 0.37],
  face: [0.385, 0.8, 0.0125],
  under: [0.82, 0.85],
  lid: 0.88,
  // The shares round, the face's middle to the back: every two-hundredth over the nose and mouth, wider to the ears.
  round: [0, 0.005, 0.01, 0.015, 0.02, 0.025, 0.03, 0.035, 0.04, 0.045, 0.05, 0.058, 0.066, 0.075, 0.085, 0.096, 0.108, 0.12, 0.135, 0.15, 0.17, 0.19, 0.215, 0.24, 0.27, 0.3, 0.34, 0.38, 0.42, 0.46, 0.5],
  // The smooth head by row: [row, the front's height, the side's, the back's, its reach forward, sideways, back] (unit
  // radii), read off the head model's men (the mix of no region) with the features left out.
  profile: [
    [0, 1.0, 1.0, 1.0, 0.02, 0.02, 0.02],
    [0.1, 0.93, 0.78, 0.86, 0.6, 0.62, 0.62],
    [0.2, 0.74, 0.5, 0.62, 0.96, 0.92, 0.94],
    [0.3, 0.48, 0.28, 0.39, 1.06, 0.92, 1.04],
    [0.385, 0.2, 0.11, 0.17, 1.07, 0.9, 1.066],
    [0.44, -0.06, -0.056, -0.076, 1.0, 0.9, 1.03],
    [0.5, -0.18, -0.13, -0.18, 1.0, 0.89, 0.99],
    [0.583, -0.38, -0.234, -0.3, 1.01, 0.87, 0.94],
    [0.7, -0.72, -0.433, -0.544, 1.03, 0.78, 0.82],
    [0.82, -1.02, -0.53, -0.677, 1.08, 0.72, 0.76],
    [0.88, -1.2, -0.64, -0.82, 1.03, 0.69, 0.74],
  ],
  // The face's structure is raised this many times its written height (photohead.js: written for the drawn head).
  relief: 1.3,
  // A woman's head against the man's the profile was read from: a lighter jaw and chin, a lower brow ridge.
  female: { jaw: 0.93, chin: 0.94, relief: 0.9 },
};

/** A profile's value at a row (between its entries, smoothly). */
function fallbackProfile(row, column) {
  const table = FALLBACK_HEAD.profile;
  for (let index = 1; index < table.length; index += 1) {
    if (row > table[index][0]) continue;
    const [low, high] = [table[index - 1], table[index]];
    const share = headSmooth(low[0], high[0], row);
    return low[column] + (high[column] - low[column]) * share;
  }
  return table[table.length - 1][column];
}

/**
 * The procedural head: what buildLatticeHead gives ({ positions, normals, tangents, uvs, colors, indices, farIndices, ink,
 * unit, grid, sculpted }), the head's local space. `sculpt`: a made face's sculptor (solver.js faceSculptor), run on the
 * points in unit space before the lid is closed, as the head model runs it.
 */
export function buildFallbackHead({ radius = 1, skull = [1, 1, 1], female = false, sculpt = null, atlas }) {
  const spec = FALLBACK_HEAD;
  const rows = [...spec.crown];
  for (let row = spec.face[0]; row < spec.face[1] - 1e-9; row += spec.face[2]) rows.push(Math.round(row * 1e4) / 1e4);
  rows.push(...spec.under, spec.lid, 1);
  const dus = [...spec.round.slice(1).reverse().map((du) => -du), ...spec.round];
  const stride = dus.length;
  const marks = photoLandmarks(atlas);
  const lidRow = rows.indexOf(spec.lid);
  const points = [];
  const uvs = [];
  for (const row of rows) {
    const at = Math.min(row, spec.lid);
    for (const du of dus) {
      const angle = 2 * Math.PI * du;
      const [cos, sin] = [Math.cos(angle), Math.sin(angle)];
      // The row's height falls from the front's to the side's to the back's round the head; its outline is an oval, the
      // front's reach ahead of the ears and the back's behind.
      const toSide = sin * sin;
      const y = (cos > 0 ? fallbackProfile(at, 1) : fallbackProfile(at, 3)) * (1 - toSide) + fallbackProfile(at, 2) * toSide;
      let x = cos * (cos > 0 ? fallbackProfile(at, 4) : fallbackProfile(at, 6));
      let z = sin * fallbackProfile(at, 5);
      let high = y;
      if (female) {
        const low = headSmooth(marks.eyeRow, marks.chinRow, at);
        z *= 1 + (spec.female.jaw - 1) * low;
        high *= 1 + (spec.female.chin - 1) * low * Math.max(0, cos);
      }
      // The face's structure, out along the point's own ray from the head's centre (as the head model raises it).
      if (Math.abs(du) < 0.2) {
        const height = faceStructure(du, at, marks, {}).height * spec.relief * (female ? spec.female.relief : 1) * headSmooth(-0.2, 0.3, x);
        const reach = Math.hypot(x, high, z) || 1;
        x *= 1 + height / reach;
        z *= 1 + height / reach;
        high *= 1 + height / reach;
      }
      points.push([x, high, z]);
      uvs.push(0.5 + du, 1 - row);
    }
  }
  const sculpted = sculpt ? sculpt({ points, uvs, rowCount: rows.length, stride }) : { points, point: (p) => p.slice(), stretch: new Float32Array(points.length * 2).fill(1), marks: null, compiled: null };
  const unit = sculpted.points;
  const local = unit.map((p) => [p[0] * skull[0] * radius, p[1] * skull[1] * radius, p[2] * skull[2] * radius]);
  // The lid under the jaw's line: each column's points past the line on its point of the line, drawn in to the middle.
  const ring = Array.from({ length: stride }, (_, column) => local[lidRow * stride + column]);
  const middle = [0, 2].map((axis) => ring.reduce((sum, p) => sum + p[axis], 0) / stride);
  for (let row = lidRow + 1; row < rows.length; row += 1) {
    const share = (rows[row] - rows[lidRow]) / (rows[rows.length - 1] - rows[lidRow]);
    for (let column = 0; column < stride; column += 1) {
      const p = ring[column];
      local[row * stride + column] = [p[0] + (middle[0] - p[0]) * share, p[1], p[2] + (middle[1] - p[2]) * share];
    }
  }
  const normals = gridNormals(local, rows.length, stride);
  return {
    positions: local.flat(),
    normals,
    tangents: gridTangents(local, normals, rows.length, stride),
    uvs,
    colors: new Array(local.length * 3).fill(1),
    indices: latticeIndices(rows.length, stride),
    farIndices: thinnedIndices(rows.length, stride, 2),
    ink: new Array(local.length).fill(1),
    unit,
    grid: { rowCount: rows.length, stride, lidRow, rows },
    sculpted,
    fallback: true,
  };
}
