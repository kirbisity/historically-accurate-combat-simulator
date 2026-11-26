import test from 'node:test';
import assert from 'node:assert/strict';
import { ADAPTIVE_RESOLUTION as CONFIG, adaptiveSize, newAdaptiveState, ratioFloor, ratioSteps, readDynamicResolution, stepAdaptive, writeDynamicResolution } from '../src/adaptres.js';

const run = (state, seconds, ms, { fighters = 100, work = 8 } = {}) => {
  let level = state.level;
  for (let time = 0; time < seconds; time += ms / 1000) level = stepAdaptive(state, { ms, fighters, levels: 4, work });
  return level;
};

test('the steps are descending, never under the floor, and a low full ratio has fewer', () => {
  assert.deepEqual(ratioSteps(2, { ...CONFIG, battleRatioMost: Infinity }), [2, 1.5, 1.25, 1]);
  assert.deepEqual(ratioSteps(1.5), [1.5, 1.125, 0.938, 0.75]);
  assert.deepEqual(ratioSteps(1), [1, 0.75, 0.625, 0.5]);
  for (const full of [3, 2, 1.75, 1.25, 1]) {
    const ratios = ratioSteps(full);
    assert.ok(ratios.every((ratio) => ratio >= ratioFloor(full) && ratio <= full), `${full}: ${ratios}`);
    assert.deepEqual(ratios, [...ratios].sort((a, b) => b - a));
  }
});

test('a battle starts at no more than 1.5 and goes down to half the screen ratio', () => {
  assert.deepEqual(ratioSteps(2), [1.5, 1.125, 1], 'a 2x screen: the battle is drawn at 1.5 at best, its floor 1 (half of 2)');
  assert.deepEqual(ratioSteps(3), [1.5]);
  assert.deepEqual(ratioSteps(1.25), [1.25, 0.938, 0.781, 0.625]);
  assert.deepEqual(ratioSteps(1), [1, 0.75, 0.625, 0.5], 'a 1x screen now gives pixels too');
  for (const full of [3, 2, 1.5, 1.25, 1]) assert.ok(ratioSteps(full)[0] <= CONFIG.battleRatioMost && ratioSteps(full)[0] <= full);
});

test('the readable minimum: never fewer drawing-buffer rows than minRows', () => {
  assert.equal(ratioFloor(1, CONFIG, { rows: 1440 }), 0.5, '1440 rows: half is 720, over the minimum');
  assert.equal(ratioFloor(1, CONFIG, { rows: 900 }), 0.6, '900 rows: 540 of them at least');
  assert.deepEqual(ratioSteps(1, CONFIG, { rows: 900 }), [1, 0.75, 0.625, 0.6]);
  assert.deepEqual(ratioSteps(1, CONFIG, { rows: 400 }), [1], 'a canvas shorter than the minimum: never under its own rows');
  for (const rows of [300, 540, 720, 900, 1080, 1440, 2160]) {
    for (const full of [1, 1.5, 2]) {
      // (Never under the minimum, nor under the ladder's own top: a battle's cap of 1.5 is its best.)
      const ratios = ratioSteps(full, CONFIG, { rows });
      assert.ok(ratios.at(-1) * rows >= Math.min(CONFIG.minRows, rows * ratios[0]) - 1, `${full} x ${rows}: ${ratios}`);
    }
  }
});

test('a duel steps down only to three quarters of the screen ratio', () => {
  assert.deepEqual(ratioSteps(2, CONFIG, { duel: true }), [2, 1.5]);
  assert.deepEqual(ratioSteps(1.5, CONFIG, { duel: true }), [1.5, 1.125]);
  assert.deepEqual(ratioSteps(1, CONFIG, { duel: true }), [1, 0.75]);
  assert.deepEqual(ratioSteps(2, { ...CONFIG, duelFloorShare: undefined }, { duel: true }), [2], 'no duel floor: a duel is never adapted');
});

test('a duel waiting on the graphics card adapts on its own ladder; a battle that shrinks to one starts it again from the top', () => {
  const state = newAdaptiveState();
  const duel = { fighters: CONFIG.fewestFighters - 1 };
  assert.equal(run(state, 30, 40, { ...duel, work: 36 }), 0, 'slow, but the processor is the reason');
  const steps = (fighters) => ratioSteps(2, CONFIG, { duel: fighters < CONFIG.fewestFighters }).length;
  let level = 0;
  for (let time = 0; time < 30; time += 0.04) level = stepAdaptive(state, { ms: 40, fighters: 2, levels: steps(2), work: 8 });
  assert.equal(level, 1, 'fill-bound duel: one step, to 1.5');
  assert.equal(run(state, 30, 40), 3, 'slow in a battle: down to the last step');
  assert.equal(stepAdaptive(state, { ms: 40, fighters: 8, levels: steps(8), work: 8 }), 0, 'eight men left: the duel ladder, from its top');
  assert.equal(state.level, 0);
});

test('slow frames step down one at a time, with time between, and stop at the last step', () => {
  const state = newAdaptiveState();
  const levels = [];
  for (let frame = 0; frame < 60 * 12; frame += 1) {
    levels.push(stepAdaptive(state, { ms: 30, fighters: 100, levels: 4, work: 8 }));
  }
  assert.equal(levels[0], 0);
  assert.equal(levels.at(-1), 3, 'the last step, not past it');
  assert.ok(levels.indexOf(1) > 20, 'most of a second of slowness first, not the first slow frame');
  assert.ok(levels.indexOf(2) - levels.indexOf(1) > 20, 'one step at a time');
  assert.ok(!levels.includes(4));
});

test('a hitch is not slowness', () => {
  const state = newAdaptiveState();
  for (let frame = 0; frame < 600; frame += 1) {
    const ms = frame % 60 === 30 ? 120 : 16.7;
    stepAdaptive(state, { ms, fighters: 100, levels: 4, work: 8 });
  }
  assert.equal(state.level, 0, 'one 120 ms frame a second, the rest on time');
});

test('a stall (the tab in the background) is ignored altogether', () => {
  const state = newAdaptiveState();
  for (let frame = 0; frame < 200; frame += 1) stepAdaptive(state, { ms: 3000, fighters: 100, levels: 4, work: 8 });
  assert.equal(state.level, 0);
});

test('slow because the processor is busy is not a reason to spoil the picture', () => {
  const state = newAdaptiveState();
  assert.equal(run(state, 20, 33, { work: 30 }), 0, 'the page worked for 30 of the 33 ms');
  assert.equal(run(state, 20, 33, { work: 12 }), 3, 'it waited for the graphics card for 21 of them');
});

test('the frames coming easily again step back up, only after a long wait', () => {
  const state = newAdaptiveState();
  run(state, 10, 40);
  assert.equal(state.level, 3);
  assert.equal(run(state, CONFIG.fastSeconds - 1, 16.6, { work: 6 }), 3, 'not yet');
  assert.equal(run(state, 4, 16.6, { work: 6 }), 2, 'one step up');
  assert.equal(run(state, CONFIG.fastSeconds + 2, 16.6, { work: 6 }), 1, 'and the next');
});

test('a step up that failed makes the next try wait longer', () => {
  const state = newAdaptiveState();
  run(state, 10, 40);
  run(state, CONFIG.fastSeconds + 1, 16.6, { work: 6 });
  assert.equal(state.level, 2, 'tried one step up');
  run(state, 4, 40);
  assert.equal(state.level, 3, 'too slow again: back down');
  assert.equal(state.fastNeeded, CONFIG.fastSeconds * CONFIG.retryFactor, 'wait twice as long next time');
  for (let again = 0; again < 8; again += 1) {
    run(state, state.fastNeeded + 1, 16.6, { work: 6 });
    run(state, 4, 40);
  }
  assert.equal(state.fastNeeded, CONFIG.fastSecondsMost, 'never more than the most');
});

test('the dead band between fast and slow holds the step', () => {
  const state = newAdaptiveState();
  run(state, 10, 40);
  assert.equal(run(state, 60, 19, { work: 6 }), 3, '19 ms is neither slow nor easy');
});

test('a stage is a big scene however few its men: it adapts, a duel does not', () => {
  assert.equal(adaptiveSize(3, false), 3, 'a duel counts its men');
  assert.equal(adaptiveSize(3, true), CONFIG.fewestFighters, 'a stage with three men is as big as the smallest battle');
  assert.equal(adaptiveSize(41, true), 41);
  const state = newAdaptiveState();
  assert.equal(run(state, 30, 40, { fighters: adaptiveSize(2, true) }), 3, 'slow in a small stage: down to the last step');
});

test('a frame far behind steps down within half a second, one step at a time', () => {
  const state = newAdaptiveState();
  const levels = [];
  for (let frame = 0; frame < 120; frame += 1) levels.push(stepAdaptive(state, { ms: 50, fighters: 100, levels: 5, work: 8 }));
  const first = levels.indexOf(1);
  assert.ok(first > 4 && first * 0.05 <= 0.5, `a step down after ${first} frames of 50 ms`);
  assert.ok(levels.indexOf(2) > first, 'one step at a time');
});

test('a rung ladder: pixels first, then the tier; a 1x screen has the tiers alone at a floor of 1, and pixels too at the floor of half', async () => {
  const { rungsFor, QUALITY_RUNGS } = await import('../src/levelmode/quality.js');
  assert.deepEqual(rungsFor(2).map((r) => `${r.ratio}${r.tier[0]}`), ['2h', '1.5h', '1.5m', '1.25m', '1l']);
  assert.deepEqual(rungsFor(1).map((r) => `${r.ratio}${r.tier[0]}`), ['1h', '1m', '1l']);
  assert.equal(rungsFor(2, 1, QUALITY_RUNGS).length, 5);
  assert.deepEqual(rungsFor(1, ratioFloor(1)).map((r) => `${r.ratio}${r.tier[0]}`), ['1h', '0.75h', '0.75m', '0.625m', '0.5l']);
  for (const full of [3, 2, 1.5, 1]) {
    const rungs = rungsFor(full);
    assert.ok(rungs.every((r) => r.ratio >= 1 && r.ratio <= full), `${full}`);
    assert.deepEqual(rungs.map((r) => r.ratio), rungs.map((r) => r.ratio).sort((a, b) => b - a));
  }
});

// The graphics card's own clock (the timer query): its time decides whether the frame waits on the pixels, and predicts a step up.
const fill = (full) => (level) => full * [1, 0.75, 0.625, 0.5][level] ** 2;
// Frames of the card's time `gpu` (a number, or by the level: a load that is in the pixels, which pays when stepped down) and the page's `work`;
// each frame as long as the longer of the two (they run side by side), never under a 60 Hz frame.
const runTimed = (state, seconds, gpu, { fighters = 100, work = 8, levels = 4, upCost = 1.78 } = {}) => {
  for (let time = 0; time < seconds; ) {
    const card = typeof gpu === 'function' ? gpu(state.level) : gpu;
    const ms = Math.max(16.7, card, work);
    stepAdaptive(state, { ms, fighters, levels, work, gpu: card, upCost: state.level > 0 ? upCost : null });
    time += ms / 1000;
  }
  return state.level;
};

test('with the card timed: slow and the card busy steps down; slow and the card idle does not', () => {
  assert.equal(runTimed(newAdaptiveState(), 20, fill(60), { work: 30 }), 3, 'the card took 60 of the frame: pixels, whatever the page did');
  assert.equal(runTimed(newAdaptiveState(), 20, 8, { work: 33 }), 0, 'the card took 8 of 33 ms: the simulation is the long pole, the picture is kept');
});

test('with the card timed: a step up when the step\'s pixels are predicted to fit, and none that would come straight back down', () => {
  const state = newAdaptiveState();
  runTimed(state, 20, fill(80));
  assert.equal(state.level, 3);
  assert.equal(runTimed(state, 10, 9), 3, '9 ms x 1.78 = 16 ms is over 0.6 of the frame: no room');
  assert.equal(runTimed(state, CONFIG.gpuUpSeconds - 0.5, 5), 3, 'room, but not for long enough yet');
  assert.equal(runTimed(state, 1, 5), 2, '5 ms x 1.78 = 9 ms fits: one step up, without a blind try');
});

test('with the card timed and the page the long pole, a step up is taken while the frames stay slow', () => {
  const state = newAdaptiveState();
  runTimed(state, 20, fill(80));
  assert.equal(state.level, 3);
  assert.equal(runTimed(state, 30, 4, { work: 30 }), 0, 'the simulation holds the frame at 30 ms: the card has room for the full picture');
});

test('no oscillation: a load held steady settles on one rung', () => {
  // The card's time is its fill (8 ms of pixels at the full ratio, times the share of them) plus 6 ms that the pixels do not change.
  const ratios = [1, 0.75, 0.625, 0.5];
  const state = newAdaptiveState();
  const seen = [];
  for (let frame = 0; frame < 60 * 120; frame += 1) {
    const gpu = 6 + 20 * ratios[state.level] ** 2;
    const ms = Math.max(16.7, gpu);
    const level = stepAdaptive(state, { ms, fighters: 100, levels: 4, work: 8, gpu, upCost: state.level > 0 ? (ratios[state.level - 1] / ratios[state.level]) ** 2 : null });
    seen.push(level);
  }
  const tail = seen.slice(-60 * 60);
  assert.ok(tail.every((level) => level === tail[0]), `the last minute on one rung: ${[...new Set(tail)]}`);
  assert.ok(tail[0] >= 1, 'and a step down from the full one (26 ms at 1)');
});

test('the setting is on unless turned off, and remembered', () => {
  const store = new Map();
  const storage = { getItem: (key) => store.get(key) ?? null, setItem: (key, value) => store.set(key, value) };
  assert.equal(readDynamicResolution(storage), true);
  writeDynamicResolution(storage, false);
  assert.equal(readDynamicResolution(storage), false);
  writeDynamicResolution(storage, true);
  assert.equal(readDynamicResolution(storage), true);
  assert.equal(readDynamicResolution(null), true);
  assert.equal(readDynamicResolution({ getItem: () => { throw new Error('private window'); } }), true);
});

test('with the card timed: a step down that does not shorten the card\'s work is undone, and the next held off', () => {
  // The card's 30 ms are the shadows and the vertices: the same at every ratio.
  const state = newAdaptiveState();
  const seen = [];
  for (let frame = 0; frame < 60 * 60; frame += 1) seen.push(stepAdaptive(state, { ms: 33, fighters: 100, levels: 4, work: 8, gpu: 30, upCost: state.level > 0 ? 1.78 : null }));
  assert.ok(seen.includes(1), 'it tried');
  // (3600 frames of 33 ms: two minutes. Tries after 0.8 s, then 15, 30 and 60 s held off.)
  const tries = seen.filter((level, i) => i > 0 && level > seen[i - 1]).length;
  assert.ok(tries <= 4, `a few tries in two minutes, each held off longer: ${tries}`);
  assert.ok(seen.filter((level) => level === 0).length > 0.8 * seen.length, 'the full picture most of the time');
  assert.ok(!seen.includes(2), 'never a second step down on a step that did not pay');
});

test('with the card timed: a step down that pays is kept', () => {
  const ratios = [1, 0.75, 0.625, 0.5];
  const state = newAdaptiveState();
  for (let frame = 0; frame < 60 * 30; frame += 1) {
    const gpu = 2 + 28 * ratios[state.level] ** 2;
    stepAdaptive(state, { ms: Math.max(16.7, gpu), fighters: 100, levels: 4, work: 8, gpu, upCost: state.level > 0 ? (ratios[state.level - 1] / ratios[state.level]) ** 2 : null });
  }
  assert.ok(state.level >= 1, `kept down: level ${state.level}`);
  assert.equal(state.unpaid, 0);
});
