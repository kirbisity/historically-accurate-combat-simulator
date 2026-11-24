// The walk as one gait with the run (physics/gait.js walkStride, preferredWalk, gaitKind; control.js walkPace): the step and the cadence
// against people's, a body's build in them (a weak or old body walks shorter and more carefully), the walk-run switch on his own leg,
// and the stick's speed continuous from a slow walk through the switch to his sprint.

import test from 'node:test';
import assert from 'node:assert/strict';
import { createWorld } from '../src/physics.js';
import { CONTROL, runShare, walkPace } from '../src/control.js';
import { gaitKind, jogSpeed, preferredWalk, runSpeed, walkRunSpeed, walkStride } from '../src/physics/gait.js';

const BUILDS = {
  athletic: { sex: 'male', heightCm: 182, frame: 'medium', age: 24, exercise: 0.9, bodyFat: 0.1, style: 'boxing' },
  obese: { sex: 'male', heightCm: 176, frame: 'large', age: 42, exercise: 0.1, bodyFat: 0.38, style: 'boxing' },
  woman: { sex: 'female', heightCm: 160, frame: 'small', age: 26, exercise: 0.45, bodyFat: 0.24, style: 'boxing' },
  old: { sex: 'male', heightCm: 172, frame: 'medium', age: 80, exercise: 0.15, bodyFat: 0.24, style: 'boxing' },
};

function man(key) {
  const world = createWorld([{ inputs: structuredClone(BUILDS[key]), corner: 'red' }, { inputs: structuredClone(BUILDS.athletic), corner: 'blue' }], { seed: 1 });
  return world.fighters[0];
}

/** Steps a second and the step's length (m) of his walk at `speed`: one step is a swing and a double support. */
function cadence(fighter, speed) {
  const stride = walkStride(fighter, speed);
  const period = stride.seconds + stride.rest;
  return { rate: 1 / period, step: speed * period, rest: stride.rest, period };
}

test('a fit man walks as people do: ~1.45 m/s at his ease, ~1.8-2.1 steps a second, a step of ~0.7-0.8 m', () => {
  const me = man('athletic');
  const easy = preferredWalk(me);
  assert.ok(easy > 1.3 && easy < 1.6, `his easy walk ${easy.toFixed(2)} m/s`);
  const { rate, step } = cadence(me, 1.4);
  assert.ok(rate > 1.7 && rate < 2.15, `${rate.toFixed(2)} steps a second at 1.4 m/s`);
  assert.ok(step > 0.65 && step < 0.85, `a step of ${step.toFixed(2)} m`);
  assert.ok(cadence(me, 1.4).rest > 0, 'both feet down a moment each step (a walk has no flight)');
});

test('the walk follows the body: an old or heavy man walks slower at his ease, with shorter steps and both feet down longer', () => {
  const fit = man('athletic');
  for (const key of ['old', 'obese']) {
    const other = man(key);
    assert.ok(preferredWalk(other) < preferredWalk(fit) - 0.2, `${key}: his easy walk ${preferredWalk(other).toFixed(2)} against ${preferredWalk(fit).toFixed(2)} m/s`);
    const a = cadence(fit, 1);
    const b = cadence(other, 1);
    assert.ok(b.step < a.step, `${key}: a shorter step at 1 m/s (${b.step.toFixed(2)} against ${a.step.toFixed(2)} m)`);
    assert.ok(b.rest / b.period > a.rest / a.period, `${key}: longer on both feet`);
  }
});

test('the walk turns into a run at a Froude number of a half on his own leg, and back a little under it', () => {
  for (const key of Object.keys(BUILDS)) {
    const me = man(key);
    const at = walkRunSpeed(me);
    assert.ok(at > 1.7 && at < 2.3, `${key}: the switch at ${at.toFixed(2)} m/s`);
    assert.equal(gaitKind(me, at * 0.8), false);
    assert.equal(gaitKind(me, at * 1.2), true);
    assert.equal(gaitKind(me, at), true, 'held in the run at the switch itself');
    assert.equal(gaitKind(me, at * 0.8), false);
  }
  assert.ok(walkRunSpeed(man('woman')) < walkRunSpeed(man('athletic')), 'shorter legs, a slower switch');
});

test('the stick\'s speed is continuous: a slow walk, his easy walk at the keys\' throw, his fastest walk where the jog takes over, to his sprint', () => {
  for (const key of Object.keys(BUILDS)) {
    const me = man(key);
    const stick = CONTROL.stick;
    let last = 0;
    for (let amount = stick.deadZone; amount < stick.runFrom; amount += 0.02) {
      const pace = walkPace(me, amount);
      assert.ok(pace >= last - 1e-9, `${key}: no slower further out`);
      last = pace;
    }
    assert.ok(Math.abs(walkPace(me, stick.fullFrom) - Math.max(0.35, preferredWalk(me))) < 1e-6, `${key}: the keys walk at his ease`);
    const fastestWalk = walkPace(me, stick.runFrom);
    const slowestRun = runShare(me, 0) * runSpeed(me, true);
    assert.ok(Math.abs(fastestWalk - slowestRun) < 0.05, `${key}: the walk meets the jog (${fastestWalk.toFixed(2)} and ${slowestRun.toFixed(2)} m/s)`);
    assert.ok(Math.abs(fastestWalk - Math.max(0.35, jogSpeed(me))) < 0.05);
  }
});
