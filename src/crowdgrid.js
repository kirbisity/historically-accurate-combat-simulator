// Large battles, phase 1 (KB spec 2026-11-21-large-battles): the looks round a man that a think and a physics step take
// (who is beside him, who is on the line to his man, the nearest enemy) answered from a floor grid of the men's hips,
// rather than by walking every man of the battle for every man (thousands of pairs a step at 200 men, a million at 1000).
//
// Same answers as the walk over everyone: a look gathers every man who may count (all within its reach, and some beyond,
// which the caller measures as before), in index order, so a sum or a first-found comes out bit for bit as it did. While
// a grid is live a man may have moved since it was filled (a step moves each in turn; a rider getting down steps off his
// horse), so every look reaches CROWD_GRID.slack m further. Men added after the fill (index past the count) are always
// taken in, as are men whose hips are not a number. Outside a think or a step no grid is live and the callers walk
// everyone as before.

import { P } from './body.js';

/**
 * `enabled`: the switch (false: every look walks everyone, as before; for comparing). `slack` m: how far a man may have moved
 * since the fill. `cell` m: the cells' size, about a man's arm's length and a stride (most looks are 1-3 m).
 */
export const CROWD_GRID = { enabled: true, slack: 2, cell: 2.5 };

function newCrowdGrid() {
  return { world: null, count: 0, cell: 1, minX: 0, minZ: 0, nx: 0, nz: 0, x: new Float64Array(0), z: new Float64Array(0), start: new Int32Array(1), order: new Int32Array(0), loose: [], found: [], seen: new Uint8Array(0) };
}

// One grid for a think (ai.js thinkAll), one for a step (physics.js step): a think's looks may run inside neither.
const crowdGrids = { think: newCrowdGrid(), step: newCrowdGrid() };
let liveCrowdGrid = null;

/** Fill a grid with the world's men, by counting sort (cells in a dense block over the men's span, index order within a cell). */
function fillCrowdGrid(grid, world) {
  const fighters = world.fighters;
  const count = fighters.length;
  const cell = CROWD_GRID.cell;
  if (grid.x.length < count) {
    grid.x = new Float64Array(count * 2);
    grid.z = new Float64Array(count * 2);
    grid.order = new Int32Array(count * 2);
    grid.seen = new Uint8Array(count * 2);
  }
  grid.loose.length = 0;
  let minX = Infinity;
  let minZ = Infinity;
  let maxX = -Infinity;
  let maxZ = -Infinity;
  for (let index = 0; index < count; index += 1) {
    const x = fighters[index].x[P.pelvis * 3];
    const z = fighters[index].x[P.pelvis * 3 + 2];
    grid.x[index] = x;
    grid.z[index] = z;
    if (!Number.isFinite(x) || !Number.isFinite(z)) continue;
    if (x < minX) minX = x;
    if (x > maxX) maxX = x;
    if (z < minZ) minZ = z;
    if (z > maxZ) maxZ = z;
  }
  if (minX > maxX) {
    minX = 0;
    maxX = 0;
    minZ = 0;
    maxZ = 0;
  }
  const nx = Math.floor((maxX - minX) / cell) + 1;
  const nz = Math.floor((maxZ - minZ) / cell) + 1;
  if (grid.start.length < nx * nz + 1) grid.start = new Int32Array(nx * nz * 2 + 1);
  const start = grid.start;
  start.fill(0, 0, nx * nz + 1);
  const cellOf = (index) => Math.floor((grid.x[index] - minX) / cell) * nz + Math.floor((grid.z[index] - minZ) / cell);
  for (let index = 0; index < count; index += 1) {
    if (!Number.isFinite(grid.x[index]) || !Number.isFinite(grid.z[index])) grid.loose.push(index);
    else start[cellOf(index) + 1] += 1;
  }
  for (let k = 0; k < nx * nz; k += 1) start[k + 1] += start[k];
  const next = start.slice(0, nx * nz);
  for (let index = 0; index < count; index += 1) {
    if (Number.isFinite(grid.x[index]) && Number.isFinite(grid.z[index])) grid.order[next[cellOf(index)]++] = index;
  }
  Object.assign(grid, { world, count, cell, minX, minZ, nx, nz });
}

/** Run `body` with a grid of the world's men live (`kind` 'think' or 'step'); a look inside answers from it. Nested: the inner one. */
export function withCrowdGrid(kind, world, body) {
  if (!CROWD_GRID.enabled) return body();
  const grid = crowdGrids[kind];
  const before = liveCrowdGrid;
  fillCrowdGrid(grid, world);
  liveCrowdGrid = grid;
  try {
    return body();
  } finally {
    liveCrowdGrid = before;
    grid.world = null;
  }
}

/** The live grid for this world, or null (none live, switched off, or another world's). */
function crowdGridFor(world) {
  return liveCrowdGrid && liveCrowdGrid.world === world ? liveCrowdGrid : null;
}

function addCrowdCells(grid, fromX, toX, fromZ, toZ, keep) {
  const found = grid.found;
  const fx = Math.max(0, fromX);
  const tx = Math.min(grid.nx - 1, toX);
  const fz = Math.max(0, fromZ);
  const tz = Math.min(grid.nz - 1, toZ);
  for (let cx = fx; cx <= tx; cx += 1) {
    for (let cz = fz; cz <= tz; cz += 1) {
      if (keep && !keep(cx, cz)) continue;
      const k = cx * grid.nz + cz;
      for (let at = grid.start[k]; at < grid.start[k + 1]; at += 1) {
        const index = grid.order[at];
        if (!grid.seen[index]) {
          grid.seen[index] = 1;
          found.push(index);
        }
      }
    }
  }
}

function finishCrowdLook(grid, world) {
  const found = grid.found;
  for (const index of grid.loose) if (!grid.seen[index]) found.push(index);
  for (let index = grid.count; index < world.fighters.length; index += 1) found.push(index);
  for (let k = 0; k < found.length; k += 1) if (found[k] < grid.count) grid.seen[found[k]] = 0;
  return found.sort((a, b) => a - b).map((index) => world.fighters[index]);
}

/**
 * The men who may matter to a look: every man within `radius` m of each (x, z) in `points` ([x, z, radius] each), and every man
 * within `width` m of each segment in `segments` ([ax, az, bx, bz, width] each), in index order, each once; or null with no grid
 * live (the caller then walks world.fighters as before).
 */
export function crowdNear(world, points = [], segments = []) {
  const grid = crowdGridFor(world);
  if (!grid) return null;
  grid.found.length = 0;
  const { cell, minX, minZ } = grid;
  const slack = CROWD_GRID.slack;
  for (const [x, z, radius] of points) {
    const reach = radius + slack;
    addCrowdCells(grid, Math.floor((x - reach - minX) / cell), Math.floor((x + reach - minX) / cell), Math.floor((z - reach - minZ) / cell), Math.floor((z + reach - minZ) / cell));
  }
  for (const [ax, az, bx, bz, width] of segments) {
    const reach = width + slack;
    const dx = bx - ax;
    const dz = bz - az;
    const length2 = dx * dx + dz * dz;
    // A cell is kept if its middle is within reach plus half its diagonal of the segment.
    const margin = reach + cell * Math.SQRT1_2;
    const keep = (cx, cz) => {
      const mx = minX + (cx + 0.5) * cell - ax;
      const mz = minZ + (cz + 0.5) * cell - az;
      const t = length2 > 0 ? Math.max(0, Math.min(1, (mx * dx + mz * dz) / length2)) : 0;
      return Math.hypot(mx - t * dx, mz - t * dz) <= margin;
    };
    addCrowdCells(grid, Math.floor((Math.min(ax, bx) - reach - minX) / cell), Math.floor((Math.max(ax, bx) + reach - minX) / cell), Math.floor((Math.min(az, bz) - reach - minZ) / cell), Math.floor((Math.max(az, bz) + reach - minZ) / cell), keep);
  }
  return finishCrowdLook(grid, world);
}

/**
 * Whether any man within `width` m of the segment from (ax, az) to (bx, bz) passes `test(man)` (which measures him itself): the cells
 * walked from the segment's start outward, so a man in the way near the start (the comrade before a shooter) ends it at once.
 * `undefined` with no grid live.
 */
export function crowdAnyAlong(world, ax, az, bx, bz, width, test) {
  const grid = crowdGridFor(world);
  if (!grid) return undefined;
  const { cell, minX, minZ, nx, nz } = grid;
  for (const index of grid.loose) if (test(world.fighters[index])) return true;
  for (let index = grid.count; index < world.fighters.length; index += 1) if (test(world.fighters[index])) return true;
  const reach = width + CROWD_GRID.slack;
  // (A point within reach of the segment is within reach + a quarter cell of a sample, the samples half a cell apart.)
  const around = Math.ceil((reach + cell * 0.25) / cell);
  const length = Math.hypot(bx - ax, bz - az);
  const samples = Math.max(1, Math.ceil(length / (cell * 0.5)));
  const visited = new Set();
  for (let s = 0; s <= samples; s += 1) {
    const t = s / samples;
    const gx = Math.floor((ax + (bx - ax) * t - minX) / cell);
    const gz = Math.floor((az + (bz - az) * t - minZ) / cell);
    for (let dx = -around; dx <= around; dx += 1) {
      for (let dz = -around; dz <= around; dz += 1) {
        const cx = gx + dx;
        const cz = gz + dz;
        if (cx < 0 || cz < 0 || cx >= nx || cz >= nz) continue;
        const k = cx * nz + cz;
        if (visited.has(k)) continue;
        visited.add(k);
        for (let at = grid.start[k]; at < grid.start[k + 1]; at += 1) if (test(world.fighters[grid.order[at]])) return true;
      }
    }
  }
  return false;
}

/**
 * The nearest man to (x, z) on the floor, nearer than `within` m, that `accept(man)` passes, among those `counts(man)` lets in:
 * the one a walk over everyone in index order finds keeping the nearest so far that passes (the first of equals by index).
 * Men are put to `accept` (a costly test: a line of fire) nearest first, so it is asked of a few, not all. `undefined` with no grid live.
 */
export function crowdFirst(world, x, z, within, counts, accept) {
  const grid = crowdGridFor(world);
  if (!grid) return undefined;
  const { cell, minX, minZ, nx, nz } = grid;
  const slack = CROWD_GRID.slack;
  const pending = [];
  const add = (index) => {
    const man = world.fighters[index];
    if (!counts(man)) return;
    const apart = Math.hypot(man.x[P.pelvis * 3] - x, man.x[P.pelvis * 3 + 2] - z);
    if (apart < within) pending.push({ apart, index, man });
  };
  for (const index of grid.loose) add(index);
  for (let index = grid.count; index < world.fighters.length; index += 1) add(index);
  const cx = Math.floor((x - minX) / cell);
  const cz = Math.floor((z - minZ) / cell);
  const visit = (gx, gz) => {
    if (gx < 0 || gz < 0 || gx >= nx || gz >= nz) return;
    const k = gx * nz + gz;
    for (let at = grid.start[k]; at < grid.start[k + 1]; at += 1) add(grid.order[at]);
  };
  const order = (a, b) => a.apart - b.apart || a.index - b.index;
  const rings = Math.max(nx, nz) + Math.max(Math.abs(cx), Math.abs(cz)) + 1;
  for (let ring = 0; ring <= rings + 1; ring += 1) {
    if (ring === 0) visit(cx, cz);
    else if (ring <= rings) {
      for (let d = -ring; d <= ring; d += 1) {
        visit(cx + d, cz - ring);
        visit(cx + d, cz + ring);
      }
      for (let d = -ring + 1; d <= ring - 1; d += 1) {
        visit(cx - ring, cz + d);
        visit(cx + ring, cz + d);
      }
    }
    // Settled: those nearer than any man not yet looked at can be (all, once every ring is done).
    const bound = ring > rings ? Infinity : Math.min(x - (minX + (cx - ring) * cell), minX + (cx + ring + 1) * cell - x, z - (minZ + (cz - ring) * cell), minZ + (cz + ring + 1) * cell - z) - slack;
    pending.sort(order);
    while (pending.length && pending[0].apart < bound) {
      const { man } = pending.shift();
      if (accept(man)) return man;
    }
    if (bound >= within) return null;
  }
  return null;
}

/**
 * The nearest man to (x, z) by `measure(man)` (his distance, ≥ his distance on the floor from (x, z); Infinity if he does not count),
 * the first of equals by index, as a walk over everyone in index order finds him; `undefined` with no grid live.
 */
export function crowdNearest(world, x, z, measure) {
  const grid = crowdGridFor(world);
  if (!grid) return undefined;
  const { cell, minX, minZ, nx, nz } = grid;
  const slack = CROWD_GRID.slack;
  let best = null;
  let bestIndex = Infinity;
  let bestDistance = Infinity;
  const consider = (index) => {
    const distance = measure(world.fighters[index]);
    if (distance < bestDistance || (distance === bestDistance && distance !== Infinity && index < bestIndex)) {
      best = world.fighters[index];
      bestIndex = index;
      bestDistance = distance;
    }
  };
  for (const index of grid.loose) consider(index);
  for (let index = grid.count; index < world.fighters.length; index += 1) consider(index);
  const cx = Math.floor((x - minX) / cell);
  const cz = Math.floor((z - minZ) / cell);
  const visit = (gx, gz) => {
    if (gx < 0 || gz < 0 || gx >= nx || gz >= nz) return;
    const k = gx * nz + gz;
    for (let at = grid.start[k]; at < grid.start[k + 1]; at += 1) consider(grid.order[at]);
  };
  const rings = Math.max(nx, nz) + Math.max(Math.abs(cx), Math.abs(cz)) + 1;
  for (let ring = 0; ring <= rings; ring += 1) {
    if (ring === 0) visit(cx, cz);
    else {
      for (let d = -ring; d <= ring; d += 1) {
        visit(cx + d, cz - ring);
        visit(cx + d, cz + ring);
      }
      for (let d = -ring + 1; d <= ring - 1; d += 1) {
        visit(cx - ring, cz + d);
        visit(cx + ring, cz + d);
      }
    }
    // Every man not yet looked at was, at the fill, outside the square of cells visited: at least this far off on the floor.
    const bound = Math.min(x - (minX + (cx - ring) * cell), minX + (cx + ring + 1) * cell - x, z - (minZ + (cz - ring) * cell), minZ + (cz + ring + 1) * cell - z);
    if (bound - slack > bestDistance) break;
  }
  return best;
}
