import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { P } from '../src/body.js';
import { thinkAll } from '../src/ai.js';
import { advance, seededRandom } from '../src/physics.js';
import { scenarioWorld } from '../src/scenarios.js';
import { CROWD_GRID, crowdAnyAlong, crowdFirst, crowdNear, crowdNearest, withCrowdGrid } from '../src/crowdgrid.js';

// Men as the grid reads them: only the hips (x, z) matter. One without a place (NaN) and men added after the fill must still be found.
function scatter(count, random, spread) {
  const fighters = Array.from({ length: count }, (_, id) => {
    const x = new Float64Array(P.pelvis * 3 + 3);
    x[P.pelvis * 3] = (random() - 0.5) * spread;
    x[P.pelvis * 3 + 2] = (random() - 0.5) * spread;
    return { id, x, tag: random() };
  });
  fighters[7].x[P.pelvis * 3] = NaN;
  return { fighters };
}
const hips = (man) => [man.x[P.pelvis * 3], man.x[P.pelvis * 3 + 2]];
const apart = (man, x, z) => Math.hypot(hips(man)[0] - x, hips(man)[1] - z);
function toSegment(man, [ax, az, bx, bz]) {
  const [px, pz] = hips(man);
  const dx = bx - ax;
  const dz = bz - az;
  const t = Math.max(0, Math.min(1, ((px - ax) * dx + (pz - az) * dz) / (dx * dx + dz * dz || 1)));
  return Math.hypot(px - ax - t * dx, pz - az - t * dz);
}

test('no grid outside withCrowdGrid: the callers walk everyone', () => {
  const world = scatter(20, seededRandom(1), 30);
  assert.equal(crowdNear(world, [[0, 0, 3]]), null);
  assert.equal(crowdNearest(world, 0, 0, () => 1), undefined);
});

test('a look takes in every man within its radius and near its segments, once each, in index order', () => {
  const random = seededRandom(4);
  const world = scatter(300, random, 80);
  withCrowdGrid('think', world, () => {
    world.fighters.push({ id: 300, x: Float64Array.from({ length: P.pelvis * 3 + 3 }, () => 500) });
    for (let probe = 0; probe < 60; probe += 1) {
      const point = [(random() - 0.5) * 80, (random() - 0.5) * 80, 0.5 + random() * 12];
      const segment = [(random() - 0.5) * 80, (random() - 0.5) * 80, (random() - 0.5) * 80, (random() - 0.5) * 80, random() * 2];
      const found = crowdNear(world, [point], [segment]);
      const ids = found.map((man) => man.id);
      assert.deepEqual(ids, [...new Set(ids)].sort((a, b) => a - b));
      for (const man of world.fighters) {
        if (apart(man, point[0], point[1]) <= point[2] || toSegment(man, segment) <= segment[4]) assert.ok(found.includes(man), `man ${man.id}`);
      }
      assert.ok(found.includes(world.fighters[7]) && found.includes(world.fighters[300]), 'the placeless man and the one added after the fill');
    }
  });
});

test('the nearest and the first nearest that passes are those a walk over everyone finds', () => {
  const random = seededRandom(9);
  const world = scatter(250, random, 60);
  // Equal distances: two men on the same spot, the lower index must win.
  world.fighters[20].x.set(world.fighters[40].x);
  withCrowdGrid('step', world, () => {
    for (let probe = 0; probe < 80; probe += 1) {
      const [x, z] = [(random() - 0.5) * 70, (random() - 0.5) * 70];
      const counts = (man) => man.tag > 0.3;
      const measure = (man) => (counts(man) ? apart(man, x, z) : Infinity);
      let walked = null;
      for (const man of world.fighters) if (measure(man) < (walked ? measure(walked) : Infinity)) walked = man;
      assert.equal(crowdNearest(world, x, z, measure), walked);
      const within = 5 + random() * 40;
      const accept = (man) => man.tag > 0.8;
      let first = null;
      let nearest = within;
      for (const man of world.fighters) {
        if (!counts(man) || apart(man, x, z) >= nearest || !accept(man)) continue;
        first = man;
        nearest = apart(man, x, z);
      }
      assert.equal(crowdFirst(world, x, z, within, counts, accept), first);
    }
  });
});

test('a man near a line is found walking it outward, as a walk over everyone finds him', () => {
  const random = seededRandom(12);
  const world = scatter(200, random, 50);
  withCrowdGrid('think', world, () => {
    for (let probe = 0; probe < 80; probe += 1) {
      const segment = [(random() - 0.5) * 50, (random() - 0.5) * 50, (random() - 0.5) * 50, (random() - 0.5) * 50];
      const width = random() * 1.5;
      const test = (man) => man.tag > 0.9 && toSegment(man, segment) < width;
      assert.equal(crowdAnyAlong(world, ...segment, width, test), world.fighters.some(test));
    }
  });
});

// The whole of it: a battle fought with the grid and without comes out the same, bit for bit (every man's particles, state, blood, man).
function fought(key, seconds, enabled) {
  const before = CROWD_GRID.enabled;
  CROWD_GRID.enabled = enabled;
  try {
    const world = scenarioWorld(key, 2);
    advance(world, seconds, (current, dt) => thinkAll(current, dt));
    const hash = createHash('sha1');
    for (const fighter of world.fighters) {
      hash.update(Buffer.from(fighter.x.buffer, fighter.x.byteOffset, fighter.x.byteLength));
      hash.update(`${fighter.state}|${fighter.focus}|${fighter.blood}|`);
    }
    return { hash: hash.digest('hex'), events: world.events.length, down: world.fighters.filter((fighter) => fighter.state !== 'up').length };
  } finally {
    CROWD_GRID.enabled = before;
  }
}

test('battles fought with the crowd grid are the battles fought without it', () => {
  // Sarhu: guns, bows, the banners' horse on the wing; Wokou: Qi's squads in their drill against a rush.
  for (const [key, seconds] of [['sarhu', 14], ['wokou', 14]]) {
    const without = fought(key, seconds, false);
    const withGrid = fought(key, seconds, true);
    assert.ok(without.down > 0, `${key}: men fell, so the fight was on`);
    assert.deepEqual(withGrid, without, key);
  }
});
