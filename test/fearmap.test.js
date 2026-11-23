import { test } from 'node:test';
import assert from 'node:assert/strict';
import { P } from '../src/body.js';
import { inFight } from '../src/physics.js';
import { keepFearMap, nearestOnMap, readMap } from '../src/fearmap.js';
import { scaledBattle } from '../tools/tableduel.js';

const spec = { group: 3, groupFade: 3, sight: 16 };
const hip = (fighter) => [fighter.x[P.pelvis * 3], fighter.x[P.pelvis * 3 + 2]];
const weight = (apart) => Math.max(0, Math.min(1, 1 - (apart - spec.group) / spec.groupFade));

test("the fear map holds each side's men as a knot round a point counts them, and the nearest of them", () => {
  const world = scaledBattle('sarhu', 200, 1);
  // (Scattered, so the knots are not all one block: each man moved a few metres off his place.)
  world.fighters.forEach((fighter, index) => {
    const [dx, dz] = [((index * 7919) % 13) - 6, ((index * 104729) % 11) - 5];
    for (let part = 0; part < fighter.x.length / 3; part += 1) {
      fighter.x[part * 3] += dx;
      fighter.x[part * 3 + 2] += dz;
    }
  });
  const map = keepFearMap(world, spec, () => 1, inFight);
  assert.deepEqual([...map.corners].sort(), ['blue', 'red']);
  const off = [];
  let worst = 0;
  let nearestWrong = 0;
  for (const fighter of world.fighters) {
    const [x, z] = hip(fighter);
    const counted = world.fighters.filter((other) => other.corner === fighter.corner && !other.dormant).reduce((sum, other) => sum + weight(Math.hypot(hip(other)[0] - x, hip(other)[1] - z)), 0);
    const read = readMap(map, map.sides[fighter.corner].own, x, z);
    off.push(Math.abs(read - counted) / counted);
    worst = Math.max(worst, Math.abs(read - counted));
    const enemy = fighter.corner === 'red' ? 'blue' : 'red';
    const truly = Math.min(...world.fighters.filter((other) => other.corner === enemy && inFight(other)).map((other) => Math.hypot(hip(other)[0] - x, hip(other)[1] - z)));
    const found = nearestOnMap(world, map, enemy, x, z, () => true);
    if (truly < spec.sight && found.apart > truly + 0.5) nearestWrong += 1;
  }
  // (Read between cell middles: a few per cent off for most men, never a whole man.)
  off.sort((a, b) => a - b);
  const most = off[Math.floor(off.length * 0.9)];
  assert.ok(most < 0.08, `nine men in ten have their knot's strength within ${(most * 100).toFixed(1)}%`);
  assert.ok(worst < 1.5, `a knot off by ${worst.toFixed(2)} men at most`);
  assert.ok(nearestWrong <= world.fighters.length * 0.02, `${nearestWrong} men given a nearest enemy half a metre or more further than the nearest`);
  // Kept until FEAR_MAP `every` s old.
  assert.equal(keepFearMap(world, spec, () => 1, inFight), map);
});
