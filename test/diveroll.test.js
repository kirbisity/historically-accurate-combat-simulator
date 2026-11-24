// The forward roll (physics/diveroll.js): a step out going forward faster than a step can catch becomes a dive onto the hands,
// a roll over the shoulder and a rise, all from the body's own mass, muscle, joints and kit (tools/diveroll.js rollTrial).

import test from 'node:test';
import assert from 'node:assert/strict';
import { P, PRESETS } from '../src/body.js';
import { advance, createWorld, placeFighter, point, startEvade } from '../src/physics.js';
import { diveRollOutlook } from '../src/physics/diveroll.js';
import { ROLL_BUILDS, rollTrial } from '../tools/diveroll.js';

test('a step out going forward with momentum is a roll that comes up on his feet; standing still it stays a step', () => {
  const walk = rollTrial(ROLL_BUILDS.athlete, { mode: 'walk' });
  assert.ok(walk.rolled, `rolled from ${walk.speed.toFixed(2)} m/s`);
  assert.equal(walk.outcome, 'up', walk.events.join('; '));
  assert.ok(walk.distance > 1.5, `carried ${walk.distance.toFixed(2)} m forward`);
  const world = createWorld([structuredClone(PRESETS.light), structuredClone(PRESETS.light)], { seed: 2, arena: { halfX: 20, halfZ: 20 } });
  const [man, other] = world.fighters;
  placeFighter(man, -2, 0);
  placeFighter(other, 6, 0);
  advance(world, 0.6);
  assert.ok(startEvade(world, man));
  assert.equal(man.diveRoll ?? null, null, 'standing, the step out is a step');
  assert.equal(man.defence?.name, 'evade');
});

test('the faster he comes in, the further the dive and the roll carry him', () => {
  const walk = rollTrial(ROLL_BUILDS.athlete, { mode: 'walk' });
  const run = rollTrial(ROLL_BUILDS.athlete, { mode: 'run' });
  assert.equal(run.outcome, 'up', run.events.join('; '));
  assert.ok(run.dive > walk.dive * 1.5, `dive ${walk.dive.toFixed(2)} m from a walk, ${run.dive.toFixed(2)} m from a run`);
  assert.ok(run.distance > walk.distance + 1, `travelled ${walk.distance.toFixed(2)} m from a walk, ${run.distance.toFixed(2)} m from a run`);
  const world = createWorld([structuredClone(PRESETS.light), structuredClone(PRESETS.light)], { seed: 1 });
  advance(world, 0.3);
  const [slow, fast] = [1.5, 4].map((speed) => diveRollOutlook(world.fighters[0], speed));
  assert.ok(fast.distance > slow.distance && fast.dive > slow.dive);
});

test('a man in heavy plate, a very fat man or an old one cannot roll cleanly: it ends on the floor, or stays a step', () => {
  for (const name of ['plate', 'fat']) {
    const run = rollTrial(ROLL_BUILDS[name], { mode: 'run' });
    assert.ok(run.outcome === 'down' || run.outcome === 'step', `${name}: ${run.outcome} (${run.events.join('; ')})`);
  }
  const world = createWorld([structuredClone(ROLL_BUILDS.old), structuredClone(ROLL_BUILDS.plate)], { seed: 1 });
  advance(world, 0.3);
  for (const fighter of world.fighters) for (const speed of [1.5, 2.5]) assert.equal(diveRollOutlook(fighter, speed).clean, false, `${fighter.body.inputs.name} at ${speed} m/s`);
  // Through the same model the athlete's is clean.
  const athlete = createWorld([structuredClone(ROLL_BUILDS.athlete), structuredClone(PRESETS.light)], { seed: 1 });
  advance(athlete, 0.3);
  assert.equal(diveRollOutlook(athlete.fighters[0], 2.5).clean, true);
});

test('struck across his roll, or rolling into a man, the roll is lost and he goes down', async () => {
  const { deliverImpulse } = await import('../src/physics.js');
  let struck = false;
  const hit = rollTrial(ROLL_BUILDS.athlete, { mode: 'walk', frames: (me) => {
    if (!struck && me.diveRoll?.model.phase === 'roll') {
      struck = true;
      deliverImpulse({ fighter: me, shares: [[P.neck, 1], [P.pelvis, 0.5]], direction: [0, 0.2, 1], impulse: 90 });
    }
  } });
  assert.equal(hit.outcome, 'down', hit.events.join('; '));
  const blocked = rollTrial(ROLL_BUILDS.athlete, { mode: 'walk', frames: (me, t, world) => {
    if (!world.placed && me.diveRoll) {
      world.placed = true;
      const at = point(me.x, P.pelvis);
      placeFighter(world.fighters[1], at[0] + 1.3, at[2]);
    }
  } });
  assert.equal(blocked.outcome, 'down', blocked.events.join('; '));
});
