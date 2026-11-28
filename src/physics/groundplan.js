// The ground plan of a battle fought among buildings (an arena with `terrain`, outside Level Mode's stages: Battle Mode's
// Pyongyang town, whose houses, yard walls, terraces and stairs are solids made from the town's plan as data, places/
// pyongyang-city.js pyCitySolids, never from what is drawn). What the solids already do to a man stays where it is
// (physics/terrain.js: his stance kept out of walls, each part out of them); this is what they do to the ways men and
// horses take, and to a horse's body:
//
//  - The plan: the floor cut into square cells (GROUND_PLAN.cell), each open or shut to a man on foot (his body's room
//    about its middle clear of every wall and of every face higher than a stride, terrain.js pushOut, at the floor
//    there) and to a horse (its barrel's room, at its belly's height and up), and the floor's height in each, so that
//    a step from cell to cell is one a man's foot (or a horse's) can make. Made once for a terrain and a floor: a few
//    thousand cells, each asked of the few solids the terrain's grid has there.
//  - Walk fields over it (Dijkstra's, from many cells at once): from a side's men (the walk to the nearest of them from
//    anywhere, made again when GROUND_PLAN.every old), and from one goal (a place a man is going to; the solids do not
//    move, so it is kept). A man whose straight way to where he is going is shut (a house between) reads the field down
//    from his cell toward it, and goes for the furthest point of that way he can walk to straight (the corner he must
//    go round, the gate in a yard wall), not into the wall.
//  - A horse's body against the solids (horseOnSolids): its chest, barrel and quarters as rounds along its length kept
//    out of the walls as the stance is, its speed into one taken off as the crash it is (mounted.js jolt: a horse run
//    into a house wall at a gallop goes down); and its rider's way (steerOnGround) turned off a wall he would ride into
//    and round the houses to his man, as the arena's edge turns it (mounted.js steerInside).
//
// The sim's boundary (sim.js) holds: everything here is numbers from the terrain's data.

import { P } from '../body.js';
import { WORLD } from './config.js';
import { floorAt, terrainLand, pushOut } from './terrain.js';

export const GROUND_PLAN = {
  // m: a cell's side. Half a stride: the narrowest way in the town, a yard's gate (2.2-3.3 m) or a lane (4 m), is
  // always several cells wide once a man's room is taken off both sides, and the floor is a few thousand cells.
  cell: 0.5,
  // A man on foot: his body's room about his middle (WORLD.terrain.bodyRadius, what keeps his stance off a wall), and
  // the faces he steps up or down (WORLD.terrain.stepUp: a stride's rise; a stair's tread is that or less a cell).
  man: { room: WORLD.terrain.bodyRadius },
  // A horse: `room` m about its line (half its barrel's width, ~0.6 m across at a 1.5 m horse, and a hand's breadth);
  // its belly `low` m over the ground (a horse steps over a kerb, a jar terrace's lip; a footing's face higher than that
  // stops it) to `high` (over its withers); `step` m: the most the floor may rise or fall from cell to cell under it
  // (a slope, not a stair: a horse is not ridden up a temple's steps).
  horse: { room: 0.45, low: 0.3, high: 1.8, step: 0.25 },
  // m: a floor higher than this over the land under it is an upper storey or a roof, not ground stood on (the town's
  // highest terraces, a hall's and a pavilion's, are ~1.3 m).
  stand: 1.6,
  // s: a side's field is made again when it is this old: a man at a run (~4 m/s) has gone a metre since, two cells.
  every: 0.25,
  // m: a straight way is felt every this far, at each point its cell open and the floor no more than a step from the
  // last. (Its first and last `ends` m are not asked: a man pressed to a wall stands in a shut cell, as may his man.)
  sight: 0.25,
  ends: 0.6,
  // m: the furthest a way read down a field is followed before the furthest straight-walkable point of it is taken.
  ahead: 16,
  // s: a way read is kept this long (unless the goal moves `moved` m), not read again every step.
  keep: 0.25,
  moved: 1,
  // How many goals' fields a plan keeps (a weapon on the floor, a standard: a few at once).
  goals: 24,
  // A horse's rounds along its length, as shares of its height at the withers: [ahead of its middle, radius], its chest,
  // barrel, quarters (mounted.js HORSE_SHAPE: the chest's capsule to 0.56 ahead, the barrel's back to 0.63 behind,
  // ~0.21 across) and its head at the end of its neck.
  horseBody: [[0.36, 0.2], [-0.03, 0.21], [-0.42, 0.21], [0.75, 0.08]],
  // m/s: a horse stopped faster than this by a wall is told as an event (run into it, not leaning on it at a walk:
  // physics/fieldworks.js FIELDWORKS.horse `told`, the palisade's).
  told: 1,
  // A rider's way: looked along for `look` s of his pace (and `least` m at least); shut within that, it is turned to the
  // nearest heading clear for that far, tried every `turnStep` rad out to `turnMost` either side.
  steer: { look: 1.2, least: 4, turnStep: 0.2, turnMost: 2.2 },
};

const PLAN_SHUT = 0;
const PLAN_MAN = 1;
const PLAN_HORSE = 2;

// The plan of each terrain over each floor (the terrain is made once and never changed: places/pyongyang.js).
const groundPlans = new WeakMap();

/** The plan for this world (null where there is none: no terrain, or a Level Mode stage with its storeys). */
export function groundPlanOf(world) {
  const arena = world.arena;
  const terrain = arena?.terrain;
  if (!terrain || world.stage) return null;
  let byFloor = groundPlans.get(terrain);
  if (!byFloor) groundPlans.set(terrain, (byFloor = new Map()));
  const key = `${arena.halfX},${arena.halfZ}`;
  let plan = byFloor.get(key);
  if (!plan) byFloor.set(key, (plan = makeGroundPlan(terrain, arena.halfX, arena.halfZ)));
  return plan;
}

/** The plan over the floor (halfX, halfZ about the origin): each cell's floor and who may stand in it. */
export function makeGroundPlan(terrain, halfX, halfZ) {
  const spec = GROUND_PLAN;
  const ground = WORLD.terrain;
  const cell = spec.cell;
  const nx = Math.max(1, Math.ceil((2 * halfX) / cell));
  const nz = Math.max(1, Math.ceil((2 * halfZ) / cell));
  const x0 = -halfX;
  const z0 = -halfZ;
  const floor = new Float32Array(nx * nz);
  const open = new Uint8Array(nx * nz);
  const at = [0, 0];
  for (let i = 0; i < nx; i += 1) {
    for (let j = 0; j < nz; j += 1) {
      const index = i * nz + j;
      const x = x0 + (i + 0.5) * cell;
      const z = z0 + (j + 0.5) * cell;
      const land = terrainLand(terrain, x, z);
      if (land === -Infinity) continue;
      const top = floorAt(terrain, x, z, land + spec.stand);
      floor[index] = top;
      let bits = PLAN_SHUT;
      at[0] = x;
      at[1] = z;
      if (!pushOut(terrain, at, spec.man.room, top + ground.sag, top + ground.sag + ground.bodyHeight, ground.stepUp)) bits |= PLAN_MAN;
      at[0] = x;
      at[1] = z;
      if (!pushOut(terrain, at, spec.horse.room, top + spec.horse.low, top + spec.horse.high, 0)) bits |= PLAN_HORSE;
      open[index] = bits;
    }
  }
  return { terrain, cell, nx, nz, x0, z0, floor, open, goalFields: new Map() };
}

/** The cell (index) a point is in, or -1 off the plan. */
function planCellIndex(plan, x, z) {
  const i = Math.floor((x - plan.x0) / plan.cell);
  const j = Math.floor((z - plan.z0) / plan.cell);
  if (i < 0 || j < 0 || i >= plan.nx || j >= plan.nz) return -1;
  return i * plan.nz + j;
}

/** A cell's middle, [x, z]. */
function planCellMiddle(plan, index) {
  const i = Math.floor(index / plan.nz);
  const j = index - i * plan.nz;
  return [plan.x0 + (i + 0.5) * plan.cell, plan.z0 + (j + 0.5) * plan.cell];
}

/** The most the floor may change from cell to cell for this kind of walker. */
const planStepOf = (kind) => (kind === PLAN_HORSE ? GROUND_PLAN.horse.step : WORLD.terrain.stepUp);

/** Whether a cell is open to this kind (PLAN_MAN or PLAN_HORSE). */
export function groundOpen(plan, x, z, kind = PLAN_MAN) {
  const index = planCellIndex(plan, x, z);
  return index >= 0 && (plan.open[index] & kind) !== 0;
}

/** The open cell of this kind nearest a point, within a metre (its own if open), or -1. */
function planOpenNear(plan, x, z, kind) {
  const here = planCellIndex(plan, x, z);
  if (here >= 0 && plan.open[here] & kind) return here;
  const reach = Math.ceil(1 / plan.cell);
  const i0 = Math.floor((x - plan.x0) / plan.cell);
  const j0 = Math.floor((z - plan.z0) / plan.cell);
  let best = -1;
  let bestD = Infinity;
  for (let di = -reach; di <= reach; di += 1) {
    for (let dj = -reach; dj <= reach; dj += 1) {
      const i = i0 + di;
      const j = j0 + dj;
      if (i < 0 || j < 0 || i >= plan.nx || j >= plan.nz) continue;
      const index = i * plan.nz + j;
      if (!(plan.open[index] & kind)) continue;
      const d = di * di + dj * dj;
      if (d < bestD) [best, bestD] = [index, d];
    }
  }
  return best;
}

// The 8 ways out of a cell (di, dj) and their lengths in cells.
const PLAN_STEPS = [[1, 0, 1], [-1, 0, 1], [0, 1, 1], [0, -1, 1], [1, 1, Math.SQRT2], [1, -1, Math.SQRT2], [-1, 1, Math.SQRT2], [-1, -1, Math.SQRT2]];

/** Whether a walker of this kind steps from cell `from` to its neighbour (di, dj): both open, the floor a step apart, a corner not cut. */
function planStepsTo(plan, from, di, dj, kind) {
  const i = Math.floor(from / plan.nz) + di;
  const j = from - Math.floor(from / plan.nz) * plan.nz + dj;
  if (i < 0 || j < 0 || i >= plan.nx || j >= plan.nz) return -1;
  const to = i * plan.nz + j;
  if (!(plan.open[to] & kind) || Math.abs(plan.floor[to] - plan.floor[from]) > planStepOf(kind)) return -1;
  if (di !== 0 && dj !== 0 && (!(plan.open[from + di * plan.nz] & kind) || !(plan.open[from + dj] & kind))) return -1;
  return to;
}

/**
 * A walk field over the plan: from the `seeds` (cell indices) outward, each cell's shortest walk (m) to the nearest of
 * them for this kind of walker (Dijkstra's over a binary heap; Infinity where none can walk). Into `dist` if given.
 */
export function spreadGround(plan, seeds, kind, dist = new Float64Array(plan.nx * plan.nz)) {
  dist.fill(Infinity);
  // (The heap in two typed arrays, grown as it must be: a cell may be in it more than once, its stale entries passed over.)
  let keys = plan.heapKeys ??= new Float64Array(plan.nx * plan.nz);
  let cells = plan.heapCells ??= new Int32Array(plan.nx * plan.nz);
  let size = 0;
  const push = (index, walk) => {
    if (size === keys.length) {
      const grownKeys = new Float64Array(keys.length * 2);
      const grownCells = new Int32Array(keys.length * 2);
      grownKeys.set(keys);
      grownCells.set(cells);
      keys = plan.heapKeys = grownKeys;
      cells = plan.heapCells = grownCells;
    }
    let k = size;
    size += 1;
    while (k > 0) {
      const up = (k - 1) >> 1;
      if (keys[up] <= walk) break;
      keys[k] = keys[up];
      cells[k] = cells[up];
      k = up;
    }
    keys[k] = walk;
    cells[k] = index;
  };
  for (const seed of seeds) {
    if (seed < 0 || dist[seed] === 0) continue;
    dist[seed] = 0;
    push(seed, 0);
  }
  while (size > 0) {
    const walk = keys[0];
    const from = cells[0];
    size -= 1;
    if (size > 0) {
      const lastKey = keys[size];
      const lastCell = cells[size];
      let k = 0;
      for (;;) {
        const a = 2 * k + 1;
        if (a >= size) break;
        const b = a + 1;
        const low = b < size && keys[b] < keys[a] ? b : a;
        if (keys[low] >= lastKey) break;
        keys[k] = keys[low];
        cells[k] = cells[low];
        k = low;
      }
      keys[k] = lastKey;
      cells[k] = lastCell;
    }
    if (walk > dist[from]) continue;
    for (let s = 0; s < PLAN_STEPS.length; s += 1) {
      const step = PLAN_STEPS[s];
      const to = planStepsTo(plan, from, step[0], step[1], kind);
      if (to < 0) continue;
      const next = walk + step[2] * plan.cell;
      if (next < dist[to]) {
        dist[to] = next;
        push(to, next);
      }
    }
  }
  return dist;
}

/** Whether a walker of this kind can go straight from `a` to `b` ([x, z]): every point felt on the way open, the floor a step from the last. */
export function clearOnGround(plan, a, b, kind = PLAN_MAN) {
  const spec = GROUND_PLAN;
  const length = Math.hypot(b[0] - a[0], b[1] - a[1]);
  if (length <= 2 * spec.ends) return true;
  const count = Math.ceil(length / spec.sight);
  let last = null;
  for (let k = 0; k <= count; k += 1) {
    const along = (k / count) * length;
    if (along < spec.ends || along > length - spec.ends) continue;
    const index = planCellIndex(plan, a[0] + ((b[0] - a[0]) * along) / length, a[1] + ((b[1] - a[1]) * along) / length);
    if (index < 0 || !(plan.open[index] & kind)) return false;
    if (last !== null && Math.abs(plan.floor[index] - plan.floor[last]) > planStepOf(kind)) return false;
    last = index;
  }
  return true;
}

/** The field of `corner`'s men for this kind of walker, made again when GROUND_PLAN.every old. */
function planSideField(world, plan, corner, kind) {
  world.groundFields ??= {};
  const key = `${corner}:${kind}`;
  let field = world.groundFields[key];
  if (!field || field.plan !== plan) field = world.groundFields[key] = { plan, dist: new Float64Array(plan.nx * plan.nz), at: -Infinity };
  if (!(world.time - field.at < GROUND_PLAN.every && world.time >= field.at)) {
    const seeds = [];
    for (const fighter of world.fighters) {
      if (fighter.corner !== corner || fighter.state !== 'up') continue;
      const [x, z] = fighter.mount ? fighter.mount.at : [fighter.x[P.pelvis * 3], fighter.x[P.pelvis * 3 + 2]];
      seeds.push(planOpenNear(plan, x, z, kind));
    }
    spreadGround(plan, seeds, kind, field.dist);
    field.at = world.time;
  }
  return field.dist;
}

/** The field from one goal cell (the solids never move: kept, the plan holding the last GROUND_PLAN.goals of them). */
function planGoalField(plan, goal, kind) {
  const key = goal * 4 + kind;
  const fields = plan.goalFields;
  let dist = fields.get(key);
  if (dist) {
    fields.delete(key);
    fields.set(key, dist);
    return dist;
  }
  dist = spreadGround(plan, [goal], kind);
  fields.set(key, dist);
  if (fields.size > GROUND_PLAN.goals) fields.delete(fields.keys().next().value);
  return dist;
}

/**
 * The point to make for, going from `from` toward `to` ([x, z]) as this kind of walker over a field that falls toward it:
 * the way read down the field from his cell (each step to the neighbour nearest by the field) up to GROUND_PLAN.ahead m,
 * and the furthest point of it he can walk to straight. Null if the field gives no way (he is shut in, or it is unreached).
 */
function planWayDown(plan, dist, from, kind) {
  let here = planOpenNear(plan, from[0], from[1], kind);
  if (here < 0 || dist[here] === Infinity) return null;
  const path = [here];
  const most = Math.ceil(GROUND_PLAN.ahead / plan.cell);
  for (let k = 0; k < most && dist[here] > 0; k += 1) {
    let next = -1;
    let best = dist[here];
    for (const [di, dj] of PLAN_STEPS) {
      const to = planStepsTo(plan, here, di, dj, kind);
      if (to >= 0 && dist[to] < best) [next, best] = [to, dist[to]];
    }
    if (next < 0) break;
    path.push(next);
    here = next;
  }
  for (let k = path.length - 1; k > 0; k -= 1) {
    const at = planCellMiddle(plan, path[k]);
    if (clearOnGround(plan, from, at, kind)) return at;
  }
  return path.length > 1 ? planCellMiddle(plan, path[1]) : null;
}

/**
 * Where a man on foot should make for, going for `goal` ([x, y, z]): null if he can walk to it straight (or there is no
 * plan here); else the point ([x, y, z]) on the way round what stands between, read down the field of the enemy side
 * (`foe`: going for an enemy, the walk to the nearest of them) or of the goal itself. Kept on the man GROUND_PLAN.keep s.
 */
export function wayOnFoot(world, fighter, goal, foe = null) {
  const plan = groundPlanOf(world);
  if (!plan) return null;
  const spec = GROUND_PLAN;
  const kept = fighter.groundWay;
  if (kept && world.time < kept.until && world.time >= kept.since && Math.hypot(kept.goal[0] - goal[0], kept.goal[1] - goal[2]) < spec.moved) return kept.at;
  const from = [fighter.root[0], fighter.root[1]];
  const to = [goal[0], goal[2]];
  let at = null;
  if (!clearOnGround(plan, from, to, PLAN_MAN)) {
    const dist = foe ? planSideField(world, plan, foe.corner, PLAN_MAN) : planGoalField(plan, planOpenNear(plan, to[0], to[1], PLAN_MAN), PLAN_MAN);
    const way = dist ? planWayDown(plan, dist, from, PLAN_MAN) : null;
    if (way) at = [way[0], goal[1], way[1]];
  }
  fighter.groundWay = { goal: to, at, since: world.time, until: world.time + spec.keep };
  return at;
}

/**
 * A rider's heading turned for the town's solids: round what stands between him and his man (`target`, [x, z], of the side
 * `foeCorner`: the walk on a horse to the nearest of that side), then off any wall he would ride into within his look ahead (to the
 * nearest heading clear for as far, the side his man is on first). `heading` as it was where nothing is in the way.
 */
export function steerOnGround(world, horse, heading, target = null, foeCorner = null) {
  const plan = groundPlanOf(world);
  if (!plan) return heading;
  const spec = GROUND_PLAN.steer;
  const at = horse.at;
  let way = heading;
  if (target && foeCorner && !clearOnGround(plan, at, target, PLAN_HORSE)) {
    const point = planWayDown(plan, planSideField(world, plan, foeCorner, PLAN_HORSE), at, PLAN_HORSE);
    if (point) way = Math.atan2(-(point[1] - at[1]), point[0] - at[0]);
  }
  const look = Math.max(spec.least, Math.abs(horse.speed) * spec.look);
  const clearFor = (yaw) => {
    const f = [Math.cos(yaw), -Math.sin(yaw)];
    const count = Math.ceil(look / GROUND_PLAN.sight);
    let last = planCellIndex(plan, at[0], at[1]);
    for (let k = 1; k <= count; k += 1) {
      const d = (k / count) * look;
      const index = planCellIndex(plan, at[0] + f[0] * d, at[1] + f[1] * d);
      if (index < 0) return d;
      if (!(plan.open[index] & PLAN_HORSE) || (last >= 0 && Math.abs(plan.floor[index] - plan.floor[last]) > GROUND_PLAN.horse.step)) return d;
      last = index;
    }
    return Infinity;
  };
  if (clearFor(way) === Infinity) return way;
  // (Which way round first: toward the man, else the way it is already turning.)
  const toward = target ? Math.sin(Math.atan2(-(target[1] - at[1]), target[0] - at[0]) - way) : horse.yawRate ?? 0;
  const first = toward >= 0 ? 1 : -1;
  let best = way;
  let bestFree = -1;
  for (let turn = spec.turnStep; turn <= spec.turnMost + 1e-9; turn += spec.turnStep) {
    for (const side of [first, -first]) {
      const free = clearFor(way + side * turn);
      if (free === Infinity) return way + side * turn;
      if (free > bestFree) [best, bestFree] = [way + side * turn, free];
    }
  }
  return best;
}

/**
 * A horse's body against the solids, after it moved this substep: each of its rounds (GROUND_PLAN.horseBody) pushed out of
 * what it is in, as the stance is (terrain.js pushOut, from its belly up), the whole horse moved by each push in turn (two
 * passes, for a horse in a corner), and its speed into the wall taken off as a crash (`hurt.jolt`, mounted.js jolt: along
 * its line its pace, across it a shove; a hard enough stop brings it down). Returns whether it touched.
 */
export function horseOnSolids(world, horse, hurt) {
  const terrain = world.arena.terrain;
  if (!terrain || world.stage || horse.state === 'down') return false;
  const spec = GROUND_PLAN;
  const W = horse.withers;
  const f = [Math.cos(horse.yaw), -Math.sin(horse.yaw)];
  const land = terrainLand(terrain, horse.at[0], horse.at[1]);
  const floor = land === -Infinity ? 0 : floorAt(terrain, horse.at[0], horse.at[1], land + spec.stand);
  const feet = floor + (horse.lift ?? 0);
  let moved = false;
  const push = [0, 0];
  const point = [0, 0];
  for (let pass = 0; pass < 2; pass += 1) {
    let any = false;
    for (const [ahead, radius] of spec.horseBody) {
      point[0] = horse.at[0] + f[0] * ahead * W;
      point[1] = horse.at[1] + f[1] * ahead * W;
      const startX = point[0];
      const startZ = point[1];
      if (!pushOut(terrain, point, radius * W, feet + spec.horse.low, feet + spec.horse.high, 0)) continue;
      push[0] = point[0] - startX;
      push[1] = point[1] - startZ;
      horse.at[0] += push[0];
      horse.at[1] += push[1];
      const size = Math.hypot(push[0], push[1]) || 1;
      const n = [push[0] / size, push[1] / size];
      const velocity = horse.velocity ?? [f[0] * horse.speed, 0, f[1] * horse.speed];
      const into = -(velocity[0] * n[0] + velocity[2] * n[1]);
      if (into > 0) {
        hurt.jolt(world, horse, [n[0] * into, 0, n[1] * into], 'brought down against the wall');
        if (horse.velocity) {
          horse.velocity[0] += n[0] * into;
          horse.velocity[2] += n[1] * into;
        }
        if (into > spec.told) world.events.push({ time: world.time, kind: 'horseStopped', horse: horse.id, rider: horse.rider ?? undefined, speed: into, effects: ['runs into the wall'] });
      }
      any = true;
      moved = true;
    }
    if (!any) break;
  }
  return moved;
}
