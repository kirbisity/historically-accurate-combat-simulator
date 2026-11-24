import { test } from 'node:test';
import assert from 'node:assert/strict';
import { P, PRESETS } from '../src/body.js';
import { thinkAll } from '../src/ai.js';
import { advance, boutWinner, createWorld } from '../src/physics.js';
import { shoulderBehindLimit, shoulderRangeOf, trunkAxes } from '../src/joints.js';
import { vec } from '../src/pose.js';

const at = (fighter, index) => [fighter.x[index * 3], fighter.x[index * 3 + 1], fighter.x[index * 3 + 2]];

/** Each arm of a fighter on his feet: how far (rad) its upper arm points behind the trunk past his shoulder's range, and how far behind the coronal plane at all. */
function arms(fighter) {
  const axes = trunkAxes(at(fighter, P.pelvis), at(fighter, P.neck), at(fighter, P.lShoulder), at(fighter, P.rShoulder));
  if (!axes) return [];
  const range = shoulderRangeOf(fighter.body);
  return ['l', 'r'].map((side) => {
    const upper = vec.normalize(vec.sub(at(fighter, P[`${side}Elbow`]), at(fighter, P[`${side}Shoulder`])));
    const behind = Math.asin(-vec.dot(upper, axes.forward));
    const elevation = Math.asin(vec.dot(upper, axes.up));
    return { side, behind, past: behind - shoulderBehindLimit(range, elevation) };
  });
}

/** Mirror polearm duels: the worst excess past the shoulder's range (rad) on his feet, and the share of a two-handed polearm's arm-samples with the elbow over 10 degrees behind the trunk. */
function duel(style, seeds, seconds) {
  let worst = 0;
  let samples = 0;
  let elbowBack = 0;
  for (const seed of seeds) {
    const world = createWorld([{ ...PRESETS.veteran, style }, { ...PRESETS.veteran, style }], { seed });
    for (let t = 0; t < seconds && !boutWinner(world); t += 1 / 30) {
      advance(world, 1 / 30, (current, dt) => thinkAll(current, dt));
      for (const fighter of world.fighters) {
        if (fighter.state !== 'up') continue;
        const held = fighter.weapon?.held && fighter.weapon.twoHanded;
        for (const arm of arms(fighter)) {
          worst = Math.max(worst, arm.past);
          if (!held) continue;
          samples += 1;
          if (arm.behind > (10 * Math.PI) / 180) elbowBack += 1;
        }
      }
    }
  }
  return { worst, elbowBack: elbowBack / Math.max(1, samples), samples };
}

test('a shoulder range: extension behind the trunk hanging, less out at the side, little overhead', () => {
  const range = shoulderRangeOf(PRESETS.veteran);
  const deg = (rad) => (rad * 180) / Math.PI;
  assert.ok(deg(shoulderBehindLimit(range, -Math.PI / 2)) >= 50 && deg(shoulderBehindLimit(range, -Math.PI / 2)) <= 60);
  assert.ok(deg(shoulderBehindLimit(range, 0)) >= 30 && deg(shoulderBehindLimit(range, 0)) <= 45);
  assert.ok(shoulderBehindLimit(range, Math.PI / 2) < shoulderBehindLimit(range, 0));
  // A build may bring its own shoulders.
  const own = shoulderRangeOf({ inputs: { build: { shoulder: { hanging: 0.5 } } } });
  assert.equal(own.hanging, 0.5);
  assert.equal(own.level, range.level);
});

for (const style of ['spear', 'pike', 'naginata', 'staff']) {
  test(`${style} duels: no arm goes round behind the back past the shoulder's range, and the polearm is held with the arms forward`, () => {
    // (Three seeds: a short bout of two leaves too few moments with both hands on the haft to count.)
    const { worst, elbowBack, samples } = duel(style, [500, 501, 502], 12);
    assert.ok(samples > 300, `${samples} two-handed arm-samples`);
    // A substep's correction is capped (WORLD.limitStep): a hair over at most.
    assert.ok(worst < (2 * Math.PI) / 180, `worst ${((worst * 180) / Math.PI).toFixed(1)} degrees past the range`);
    // Before the grip was set forward a third or more of the time the rear elbow was over 10 degrees behind the trunk.
    assert.ok(elbowBack < 0.2, `rear elbow over 10 degrees behind the trunk ${(elbowBack * 100).toFixed(1)}% of the time`);
  });
}
