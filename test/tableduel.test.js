import { test } from 'node:test';
import assert from 'node:assert/strict';
import { P } from '../src/body.js';
import { thinkAll } from '../src/ai.js';
import { step } from '../src/physics.js';
import { RATINGS } from '../src/ratings.js';
import { fightingStrength, keepTable, TABLE_DUEL, tableEligible } from '../src/tableduel.js';
import { scaledBattle } from '../tools/tableduel.js';

const at = (fighter) => [fighter.x[P.pelvis * 3], fighter.x[P.pelvis * 3 + 2]];

test("a man's strength at the table is his rated character's, or his kit's or style's mean", () => {
  const world = scaledBattle('sarhu', 60, 1);
  for (const fighter of world.fighters) {
    const strength = fightingStrength(fighter);
    assert.ok(strength > 0 && Number.isFinite(strength), `${fighter.id}: ${strength}`);
  }
  const rated = Object.values(RATINGS.characters).map((character) => character.score);
  const [low, high] = [Math.min(...rated), Math.max(...rated)];
  assert.ok(world.fighters.every((fighter) => fightingStrength(fighter) >= low && fightingStrength(fighter) <= high), 'within the ratings');
});

test('only an unperceived man on foot, far from the man played and the camera, goes to the table', () => {
  const world = scaledBattle('sarhu', 60, 1);
  // (A man on foot: the Bayara at the end of the banners ride, and a rider stays in the physics.)
  const man = world.fighters.findLast((fighter) => !fighter.mount);
  world.perceiver = 0;
  man.unperceived = true;
  const played = world.fighters[0];
  const far = Math.hypot(at(man)[0] - at(played)[0], at(man)[1] - at(played)[1]) >= TABLE_DUEL.far;
  assert.equal(tableEligible(world, man), far);
  man.unperceived = false;
  assert.equal(tableEligible(world, man), false, 'perceived');
  man.unperceived = true;
  world.view = { eye: at(man), ahead: [1, 0], half: 0.5 };
  assert.equal(tableEligible(world, man), false, 'beside the camera');
  delete world.view;
  world.perceiver = undefined;
  assert.equal(tableEligible(world, man), false, 'nobody played: everyone in the physics');
});

test('a pair at the table is let go once either comes into sight', () => {
  const world = scaledBattle('sarhu', 60, 1);
  const [a, b] = [world.fighters[0], world.fighters.at(-1)];
  world.perceiver = world.fighters[1].id;
  for (const man of [a, b]) man.unperceived = true;
  a.tableDuel = { foe: b.id, since: 0, checkAt: 0 };
  const strike = () => assert.fail('nobody struck');
  b.unperceived = false;
  assert.equal(keepTable(world, a, 1 / 60, { strike }), false);
  assert.equal(a.tableDuel, undefined);
});

test('with the table off, a battle has nobody at it; on, far exchanges are decided there and men fall', () => {
  const before = TABLE_DUEL.enabled;
  try {
    for (const enabled of [false, true]) {
      TABLE_DUEL.enabled = enabled;
      const world = scaledBattle('sarhu', 200, 1);
      world.perceiver = world.fighters.filter((fighter) => fighter.corner === 'red').at(-1).id;
      let seen = 0;
      for (let index = 0; index < 60 * 24; index += 1) {
        thinkAll(world, 1 / 60);
        step(world, 1 / 60);
        seen = Math.max(seen, world.fighters.filter((fighter) => fighter.tableDuel).length);
      }
      if (enabled) assert.ok(seen > 0, 'some exchanges went to the table');
      else assert.equal(seen, 0);
      assert.ok(world.fighters.some((fighter) => fighter.state !== 'up'), 'men fell');
    }
  } finally {
    TABLE_DUEL.enabled = before;
  }
});
