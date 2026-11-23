// Large battles (KB spec 2026-11-21-large-battles, the far tiers): the strength of each side over the field, made a few times a
// second, from which a man the player does not perceive reads the weighing of standingFear (ai.js AI.standing) instead of
// counting the men round him and round the nearest of theirs one by one. Three things for each side, on a grid of `cell` m:
// its men's strength as a knot round each cell's middle would count it (each man by how fully he counts at that distance:
// AI.standing group and groupFade); the same of its men in the fight (the enemies a knot is made of); and its nearest man in the
// fight to each cell. Read between cell middles (bilinear), as the field was when it was made (at most `every` s ago: a man not
// perceived already weighs the field only every AI.perceive.appraiseEvery s). Only on open ground with two sides (no works to
// walk round, no third side): elsewhere standingFear counts the men as before. Off unless the table is on (tableduel.js tableOn).

import { P } from './body.js';

export const FEAR_MAP = { cell: 2, every: 0.25 };

/**
 * The field's map, made afresh when `every` s old or the men changed in number; null where it does not serve (works, more than two
 * sides). `strengthOf(fighter)`, `inFight(fighter)`: ai.js's strengthNow and physics.js inFight. `spec`: AI.standing.
 */
export function keepFearMap(world, spec, strengthOf, inFight) {
  const kept = world.fearMap;
  if (kept !== undefined && world.time >= kept.at && world.time - kept.at < FEAR_MAP.every - 1e-9 && kept.count === world.fighters.length) return kept.map;
  world.fearMap = { at: world.time, count: world.fighters.length, map: makeFearMap(world, spec, strengthOf, inFight) };
  return world.fearMap.map;
}

function makeFearMap(world, spec, strengthOf, inFight) {
  if (world.arena.works) return null;
  const corners = [...new Set(world.fighters.map((fighter) => fighter.corner))].filter((corner) => corner !== 'grey');
  if (corners.length !== 2) return null;
  const cell = FEAR_MAP.cell;
  const reach = spec.group + spec.groupFade;
  let [minX, minZ, maxX, maxZ] = [Infinity, Infinity, -Infinity, -Infinity];
  for (const fighter of world.fighters) {
    const x = fighter.x[P.pelvis * 3];
    const z = fighter.x[P.pelvis * 3 + 2];
    if (x < minX) minX = x;
    if (x > maxX) maxX = x;
    if (z < minZ) minZ = z;
    if (z > maxZ) maxZ = z;
  }
  // (Room past the outermost men for a knot's reach and for the sight a nearest man is looked for within.)
  const pad = Math.max(reach, spec.sight) + 2 * cell;
  const originX = minX - pad;
  const originZ = minZ - pad;
  const nx = Math.ceil((maxX - minX + 2 * pad) / cell) + 1;
  const nz = Math.ceil((maxZ - minZ + 2 * pad) / cell) + 1;
  const sides = {};
  for (const corner of corners) sides[corner] = { own: new Float32Array(nx * nz), knot: new Float32Array(nx * nz), nearest: new Int32Array(nx * nz).fill(-1) };
  const weight = (apart) => Math.max(0, Math.min(1, 1 - (apart - spec.group) / spec.groupFade));
  const lay = (into, x, z, strength) => {
    const span = reach + cell;
    const fromI = Math.max(0, Math.floor((x - span - originX) / cell));
    const toI = Math.min(nx - 1, Math.ceil((x + span - originX) / cell));
    const fromK = Math.max(0, Math.floor((z - span - originZ) / cell));
    const toK = Math.min(nz - 1, Math.ceil((z + span - originZ) / cell));
    for (let k = fromK; k <= toK; k += 1) {
      for (let i = fromI; i <= toI; i += 1) {
        const share = weight(Math.hypot(originX + i * cell - x, originZ + k * cell - z));
        if (share > 0) into[k * nx + i] += share * strength;
      }
    }
  };
  const fighters = world.fighters;
  const hipX = (index) => fighters[index].x[P.pelvis * 3];
  const hipZ = (index) => fighters[index].x[P.pelvis * 3 + 2];
  for (let index = 0; index < fighters.length; index += 1) {
    const fighter = fighters[index];
    const side = sides[fighter.corner];
    if (!side || fighter.dormant) continue;
    const [x, z] = [hipX(index), hipZ(index)];
    const strength = strengthOf(fighter);
    lay(side.own, x, z, strength);
    if (fighter.hidden || !inFight(fighter)) continue;
    lay(side.knot, x, z, strength);
    // Each cell's nearest man in the fight: first the men in it, then passed on to the cells round (two sweeps, as a distance map is made).
    const at = Math.round((z - originZ) / cell) * nx + Math.round((x - originX) / cell);
    const held = side.nearest[at];
    const centreX = originX + (at % nx) * cell;
    const centreZ = originZ + Math.floor(at / nx) * cell;
    if (held < 0 || Math.hypot(x - centreX, z - centreZ) < Math.hypot(hipX(held) - centreX, hipZ(held) - centreZ)) side.nearest[at] = index;
  }
  const sweep = (nearest, from, to, by, steps) => {
    for (let k = from[1]; k !== to[1]; k += by) {
      for (let i = from[0]; i !== to[0]; i += by) {
        const here = k * nx + i;
        const centreX = originX + i * cell;
        const centreZ = originZ + k * cell;
        let best = nearest[here];
        let bestApart = best < 0 ? Infinity : Math.hypot(hipX(best) - centreX, hipZ(best) - centreZ);
        for (const [di, dk] of steps) {
          const [ti, tk] = [i + di, k + dk];
          if (ti < 0 || tk < 0 || ti >= nx || tk >= nz) continue;
          const other = nearest[tk * nx + ti];
          if (other < 0 || other === best) continue;
          const apart = Math.hypot(hipX(other) - centreX, hipZ(other) - centreZ);
          if (apart < bestApart) [best, bestApart] = [other, apart];
        }
        nearest[here] = best;
      }
    }
  };
  for (const corner of corners) {
    sweep(sides[corner].nearest, [0, 0], [nx, nz], 1, [[-1, 0], [-1, -1], [0, -1], [1, -1]]);
    sweep(sides[corner].nearest, [nx - 1, nz - 1], [-1, -1], -1, [[1, 0], [1, 1], [0, 1], [-1, 1]]);
  }
  return { corners, sides, originX, originZ, nx, nz, cell };
}

/** The value of `grid` at (x, z), between the middles of the four cells round it. */
export function readMap(map, grid, x, z) {
  const fi = Math.max(0, Math.min(map.nx - 1.001, (x - map.originX) / map.cell));
  const fk = Math.max(0, Math.min(map.nz - 1.001, (z - map.originZ) / map.cell));
  const i = Math.floor(fi);
  const k = Math.floor(fk);
  const [u, w] = [fi - i, fk - k];
  const at = k * map.nx + i;
  return (grid[at] * (1 - u) + grid[at + 1] * u) * (1 - w) + (grid[at + map.nx] * (1 - u) + grid[at + map.nx + 1] * u) * w;
}

/**
 * The nearest man of `corner` in the fight to (x, z), as the map has the cells round it, and how far he is now; `accept(other)` the
 * test he must still pass (he may have gone down since). { who, apart } or null.
 */
export function nearestOnMap(world, map, corner, x, z, accept) {
  const side = map.sides[corner];
  if (!side) return null;
  const ci = Math.round((x - map.originX) / map.cell);
  const ck = Math.round((z - map.originZ) / map.cell);
  let who = -1;
  let best = Infinity;
  for (let dk = -1; dk <= 1; dk += 1) {
    for (let di = -1; di <= 1; di += 1) {
      const [i, k] = [ci + di, ck + dk];
      if (i < 0 || k < 0 || i >= map.nx || k >= map.nz) continue;
      const index = side.nearest[k * map.nx + i];
      if (index < 0 || index === who) continue;
      const other = world.fighters[index];
      const apart = Math.hypot(other.x[P.pelvis * 3] - x, other.x[P.pelvis * 3 + 2] - z);
      if ((apart < best || (apart === best && index < who)) && accept(other)) [who, best] = [index, apart];
    }
  }
  return who < 0 ? null : { who, apart: best };
}
