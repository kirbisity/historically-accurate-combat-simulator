import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createLoadProgress, LOAD, loadFraction, runStepsOver, stepsOf } from '../src/loadsteps.js';
import { runSteps } from '../src/loftbody.js';

// A clock the test moves by hand: each step of work "takes" `cost` ms.
function fakeClock() {
  let time = 0;
  return { now: () => time, spend: (ms) => { time += ms; } };
}

function* counted(log, clock, n, cost) {
  for (let index = 0; index < n; index += 1) {
    clock.spend(cost);
    log.push(index);
    yield index === 0 ? 'men' : undefined;
  }
  return 'built';
}

test('steps are spread over frames by the budget, in order, to the same result as driven at once', async () => {
  const clock = fakeClock();
  const log = [];
  let frames = 0;
  const seen = [];
  const result = await runStepsOver(counted(log, clock, 10, 15), { budgetMs: 40, now: clock.now, nextFrame: async () => { frames += 1; }, onStep: (value) => seen.push(value) });
  assert.equal(result, 'built');
  assert.deepEqual(log, [0, 1, 2, 3, 4, 5, 6, 7, 8, 9]);
  // 15 ms a step and 40 ms a frame: three steps a frame (the third crosses the budget), ten steps in four frames.
  assert.equal(frames, 3);
  assert.deepEqual(seen, ['men', ...Array(9).fill(undefined)], 'what each step says is handed on, nothing for a step within the stage');
  const again = [];
  assert.equal(runSteps(counted(again, fakeClock(), 10, 15)), 'built');
  assert.deepEqual(again, log, 'the same work as driven to its end at once');
});

test('a step longer than the budget takes its frame and is never cut', async () => {
  const clock = fakeClock();
  const log = [];
  let frames = 0;
  await runStepsOver(counted(log, clock, 3, 500), { budgetMs: 40, now: clock.now, nextFrame: async () => { frames += 1; } });
  assert.deepEqual(log, [0, 1, 2]);
  assert.equal(frames, 3, 'one long step a frame, then the end found after the last');
});

test('an error in a step rejects the run', async () => {
  function* broken() {
    yield 'world';
    throw new Error('no ground');
  }
  await assert.rejects(runStepsOver(broken(), { nextFrame: async () => {} }), /no ground/);
});

test('a plain function is one step; a generator function is its own steps', () => {
  let called = 0;
  const plain = stepsOf(() => { called += 1; return 7; });
  assert.equal(called, 0, 'nothing is done until the steps are driven');
  assert.equal(runSteps(plain), 7);
  assert.equal(called, 1);
  assert.equal(runSteps(stepsOf(function* () { yield 'place'; return 9; })), 9);
});

test('the bar follows the stages and never goes back', () => {
  const total = LOAD.stages.reduce((sum, stage) => sum + stage.share, 0);
  assert.ok(Math.abs(total - 1) < 1e-9, 'the shares make the whole bar');
  assert.equal(loadFraction('world', 0), 0);
  assert.ok(Math.abs(loadFraction('frame', 1) - 1) < 1e-9);
  const progress = createLoadProgress();
  progress.enter('place');
  const steps = [progress.step().fraction, progress.step().fraction, progress.step().fraction];
  assert.ok(steps[0] < steps[1] && steps[1] < steps[2], 'a stage of unknown steps creeps on');
  assert.ok(steps[2] < loadFraction('men', 0), 'and never past its own end');
  const men = progress.enter('men');
  assert.equal(men.fraction, loadFraction('men', 0));
  assert.equal(progress.count(120, 500).fraction, loadFraction('men', 120 / 500));
  assert.equal(progress.now().done, 120);
  assert.equal(progress.enter('world').fraction, loadFraction('men', 120 / 500), 'a stage out of order keeps the bar where it was');
  progress.enter('shaders');
  assert.equal(progress.count(10, 100, 0.55).fraction, loadFraction('shaders', 0.55), 'a count that is one pass of several moves the bar by its own share');
});
