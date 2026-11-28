// The ground plan of a battle among buildings (physics/groundplan.js): cells shut where a house or a wall stands, a way
// round a house read down a walk field, a horse kept out of a wall and turned off it, and Battle Mode's Pyongyang town
// (fought on its broad street) walked by its men and ridden by its horse with nobody through a wall.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { P } from '../src/body.js';
import { createTerrain, slabOf, wallOf, pushOut } from '../src/physics/terrain.js';
import { clearOnGround, GROUND_PLAN, groundOpen, groundPlanOf, horseOnSolids, makeGroundPlan, spreadGround, steerOnGround, wayOnFoot } from '../src/physics/groundplan.js';

// A floor 30 by 20 m with a house (8 by 6 m, walls to 4 m) in its middle and a yard wall north of it with a 2.4 m gate.
const TOWN = () => createTerrain([
  slabOf([0, 0], [30, 20], 0, { bottom: -2 }),
  wallOf([0, 0], [8, 6], -1, 4),
  wallOf([-8.2, -6], [12.4, 0.5], -1, 2.6),
  wallOf([8.2, -6], [12.4, 0.5], -1, 2.6),
]);

/** A world on that floor: its arena, the time, and whoever is asked. */
const worldOn = (terrain, fighters = []) => ({ arena: { halfX: 15, halfZ: 10, terrain }, fighters, horses: [], events: [], time: 0 });

/** A man of `corner` standing at (x, z): what the plan reads of him. */
function manAt(id, corner, x, z) {
  const man = { id, corner, state: 'up', root: [x, z], x: new Float64Array(P.pelvis * 3 + 3) };
  man.x[P.pelvis * 3] = x;
  man.x[P.pelvis * 3 + 2] = z;
  return man;
}

test('the plan shuts the cells where a house or a wall stands, for a man and more widely for a horse; the gate stays open', () => {
  const plan = makeGroundPlan(TOWN(), 15, 10);
  assert.ok(!groundOpen(plan, 0, 0, 1) && !groundOpen(plan, 0, 0, 2), 'the house is shut');
  assert.ok(groundOpen(plan, 0, 5, 1) && groundOpen(plan, 0, 5, 2), 'the street south of it is open');
  // (The house's wall at z = 3: a man's room off it is shut to him, a horse's wider room more so.)
  assert.ok(!groundOpen(plan, 0, 3.2, 1), 'against the wall');
  // (A horse's wider room shuts more of the floor than a man's: every cell open to a horse is open to a man.)
  let man = 0;
  let horse = 0;
  plan.open.forEach((bits) => { man += bits & 1; horse += (bits >> 1) & 1; if (bits === 2) assert.fail('a cell open to a horse but not a man'); });
  assert.ok(horse < man, `open to a man ${man} cells, to a horse ${horse}`);
  assert.ok(groundOpen(plan, 0, -6, 1), 'the yard wall\'s gate is open to a man');
  assert.ok(!groundOpen(plan, -6, -6, 1), 'the yard wall is shut');
});

test('a straight way through a house is shut; the walk round it is longer than the line and goes by the gate', () => {
  const plan = makeGroundPlan(TOWN(), 15, 10);
  assert.ok(!clearOnGround(plan, [-8, 0], [8, 0]));
  assert.ok(clearOnGround(plan, [-8, 5], [8, 5]));
  const index = (x, z) => Math.floor((x + 15) / plan.cell) * plan.nz + Math.floor((z + 10) / plan.cell);
  const dist = spreadGround(plan, [index(8, 0)], 1);
  const walk = dist[index(-8, 0)];
  assert.ok(walk > 16.5 && walk < 22, `round the house: ${walk.toFixed(2)} m against 16 straight`);
  // North of the yard wall, the way in is the gate: further than the line through the wall.
  const north = dist[index(-6, -8)];
  assert.ok(north > Math.hypot(14, 8) + 1, `from beyond the yard wall: ${north.toFixed(2)} m`);
});

test('a man going for an enemy behind a house makes for its corner, a point he can walk to straight, not into its wall', () => {
  const terrain = TOWN();
  const me = manAt(0, 'red', -8, 0);
  const foe = manAt(1, 'blue', 8, 0.5);
  const world = worldOn(terrain, [me, foe]);
  const way = wayOnFoot(world, me, [8, 1, 0.5], foe);
  assert.ok(way, 'a way round');
  const plan = groundPlanOf(world);
  assert.ok(clearOnGround(plan, me.root, [way[0], way[2]]), 'walked to straight');
  assert.ok(Math.abs(way[2]) > 3, `beside the house: [${way[0].toFixed(2)}, ${way[2].toFixed(2)}]`);
  // With nothing between, no way is given: he goes straight at his man.
  const open = manAt(2, 'red', -8, 6);
  const foe2 = manAt(3, 'blue', 8, 6);
  assert.equal(wayOnFoot(worldOn(terrain, [open, foe2]), open, [8, 1, 6], foe2), null);
});

test('a horse in a wall is put out of it, its pace into it taken off; a rider heading at a wall is turned off it', () => {
  const terrain = TOWN();
  const world = worldOn(terrain);
  // Facing the house's south wall (yaw pi/2: toward -z), its chest a few cm into it, at a canter.
  const horse = { id: 0, corner: 'red', rider: null, withers: 1.5, at: [0, 3.0 + 0.36 * 1.5 + 0.25], yaw: Math.PI / 2, speed: 6, velocity: [0, 0, -6], state: 'up', shove: [0, 0], yawRate: 0 };
  const jolts = [];
  const touched = horseOnSolids(world, horse, { jolt: (w, h, delta) => { jolts.push(delta); h.speed += delta[0] * Math.cos(h.yaw) - delta[2] * Math.sin(h.yaw); } });
  assert.ok(touched);
  const chest = [horse.at[0], horse.at[1] - 0.36 * 1.5];
  assert.ok(!pushOut(terrain, [...chest], 0.2 * 1.5 - 0.01, 0.3, 1.8, 0), 'the chest is out of the wall');
  assert.ok(jolts.length && jolts[0][2] > 5, 'its pace into the wall is taken off as a knock');
  // At a gallop straight at the wall 3 m off, the rider's way is turned to one clear for his look ahead.
  const rider = { ...horse, at: [0, 7.5], speed: 10, velocity: [0, 0, -10] };
  const heading = steerOnGround(world, rider, Math.PI / 2, [0, -9], 'blue');
  assert.notEqual(heading, Math.PI / 2);
  const plan = groundPlanOf(world);
  const look = Math.max(GROUND_PLAN.steer.least, 10 * GROUND_PLAN.steer.look);
  assert.ok(clearOnGround(plan, rider.at, [rider.at[0] + Math.cos(heading) * Math.min(look, 6), rider.at[1] - Math.sin(heading) * Math.min(look, 6)], 2), 'the new way is clear');
});

test('Battle Mode\'s Pyongyang is fought on the broad street: open between its yard walls, its ends walkable to each other, and nobody in a wall', async () => {
  const { scenarioWorld } = await import('../src/scenarios.js');
  const { thinkAll } = await import('../src/ai.js');
  const { advance } = await import('../src/physics.js');
  const { WORLD } = await import('../src/physics/config.js');
  const world = scenarioWorld('pyongyang', 3);
  const plan = groundPlanOf(world);
  assert.ok(plan, 'a plan for the town fight');
  assert.ok(groundOpen(plan, 0, 0, 1) && groundOpen(plan, 0, 0, 2), 'the crossing is open');
  assert.ok(clearOnGround(plan, [-24, 0], [24, 0], 2), 'the broad street runs clear end to end');
  const terrain = world.arena.terrain;
  const spec = WORLD.terrain;
  const deep = (x, z, lift, radius = 0.02) => {
    const at = [x, z];
    return pushOut(terrain, at, radius, lift + spec.sag, lift + spec.sag + 1.4, spec.stepUp) ? Math.hypot(at[0] - x, at[1] - z) - radius : 0;
  };
  let worst = 0;
  advance(world, 20, (current, dt) => {
    thinkAll(current, dt);
    for (const man of current.fighters) if (!man.mount && man.state === 'up') worst = Math.max(worst, deep(man.root[0], man.root[1], man.lift ?? 0));
    for (const horse of current.horses) {
      if (horse.state !== 'up') continue;
      const f = [Math.cos(horse.yaw), -Math.sin(horse.yaw)];
      for (const s of [0.36, -0.03, -0.42]) worst = Math.max(worst, deep(horse.at[0] + f[0] * s * horse.withers, horse.at[1] + f[1] * s * horse.withers, 0));
    }
  });
  assert.ok(worst < 0.1, `deepest into a wall in 20 s: ${worst.toFixed(3)} m`);
});
