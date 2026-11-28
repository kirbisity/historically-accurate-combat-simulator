import test from 'node:test';
import assert from 'node:assert/strict';
import { P, PRESETS } from '../src/body.js';
import { createWorld } from '../src/physics.js';
import { giveOrder } from '../src/command.js';
import { createExpression, EXPRESSION_CHANNELS, FACE_EXPRESSION, noteVoice, stepExpression, stockOffsets } from '../src/faceexpr.js';

const DT = 1 / 60;

function duel() {
  const world = createWorld([{ inputs: structuredClone(PRESETS.light), corner: 'red' }, { inputs: structuredClone(PRESETS.light), corner: 'blue' }], { seed: 4 });
  return { world, man: world.fighters[0] };
}

/** Run his face for `seconds` with `before` setting his state each step; returns the weights and the most of each channel seen. */
function run(state, man, world, seconds, before = () => {}) {
  const most = Object.fromEntries(EXPRESSION_CHANNELS.map((channel) => [channel, 0]));
  let weights = null;
  for (let step = 0; step < Math.round(seconds / DT); step += 1) {
    world.time += DT;
    before(world.time);
    weights = stepExpression(state, man, world, DT);
    for (const channel of EXPRESSION_CHANNELS) {
      assert.ok(weights[channel] >= 0 && weights[channel] <= 1, `${channel} ${weights[channel]} in 0..1`);
      most[channel] = Math.max(most[channel], weights[channel]);
    }
  }
  return { weights: { ...weights }, most };
}

/** Running at the enemy: pelvis speed toward him, an enemy near. */
function running(man, speed) {
  man.v[P.pelvis * 3] = speed;
  man.v[P.pelvis * 3 + 2] = 0;
  man.nearestFoe = 8;
}

test('a charge with his blood up is fury, more than one without', () => {
  const hot = duel();
  hot.man.adrenaline = 1;
  const furious = run(createExpression(1), hot.man, hot.world, 3, () => running(hot.man, 5)).weights;
  const cold = duel();
  cold.man.adrenaline = 0;
  const set = run(createExpression(1), cold.man, cold.world, 3, () => running(cold.man, 5)).weights;
  assert.ok(furious.fury > 0.4, `fury ${furious.fury}`);
  assert.ok(furious.fury > set.fury * 1.5, `with adrenaline ${furious.fury} vs without ${set.fury}`);
  assert.ok(furious.fury <= FACE_EXPRESSION.most.fury + 1e-9, 'capped: slight');
  assert.ok(furious.calm < 0.5, `calm ${furious.calm}`);
});

test('fear shows as fear, and takes the fury away', () => {
  const { world, man } = duel();
  man.adrenaline = 1;
  const weights = run(createExpression(2), man, world, 4, () => {
    running(man, 5);
    man.fear = 0.9;
  }).weights;
  assert.ok(weights.fear > 0.4, `fear ${weights.fear}`);
  assert.ok(weights.fury < 0.05, `fury ${weights.fury}`);
});

test('a call spikes the shout for as long as it sounds, then it falls away', () => {
  const { world, man } = duel();
  const state = createExpression(3);
  run(state, man, world, 1);
  noteVoice(man, 'call', world.time, 1);
  const during = run(state, man, world, 0.5).weights;
  assert.ok(during.shout > 0.6, `shout during ${during.shout}`);
  const after = run(state, man, world, 1.5).weights;
  assert.ok(after.shout < 0.05, `shout after ${after.shout}`);
});

test('an order he gives is shouted', () => {
  const { world, man } = duel();
  const state = createExpression(3);
  run(state, man, world, 0.5);
  giveOrder(world, man, 'charge');
  const { most } = run(state, man, world, 0.6);
  assert.ok(most.shout > 0.6, `shout ${most.shout}`);
});

test('a calm face drifts, a little', () => {
  const { world, man } = duel();
  const state = createExpression(5);
  const seen = Object.fromEntries(['frown', 'press', 'smirk'].map((channel) => [channel, []]));
  // (The micro-expressions held off: the drift alone.)
  state.microIn = Infinity;
  run(state, man, world, 20, () => {
    for (const channel in seen) seen[channel].push(state.weights[channel]);
  });
  for (const [channel, values] of Object.entries(seen)) {
    const late = values.slice(values.length / 4);
    const span = Math.max(...late) - Math.min(...late);
    assert.ok(span > 0.005, `${channel} moves (${span})`);
    assert.ok(Math.max(...late) <= FACE_EXPRESSION.drift.amplitude + 1e-9, `${channel} small`);
  }
  assert.ok(state.weights.calm > 0.9, `calm ${state.weights.calm}`);
});

test('micro-expressions come now and then, slight', () => {
  const { world, man } = duel();
  const { most } = run(createExpression(6), man, world, 40);
  const peak = Math.max(most.frown, most.press, most.smirk, most.jawLeft, most.jawRight);
  assert.ok(peak > 0.15, `a micro-expression seen (${peak})`);
  assert.ok(peak < 0.6, `slight (${peak})`);
});

test('the same seed gives the same face; another seed another', () => {
  const trace = (seed) => {
    const { world, man } = duel();
    return JSON.stringify(run(createExpression(seed), man, world, 15).weights);
  };
  assert.equal(trace(7), trace(7));
  assert.notEqual(trace(7), trace(8));
});

test('the stock rig offsets stay small', () => {
  const full = Object.fromEntries(EXPRESSION_CHANNELS.map((channel) => [channel, FACE_EXPRESSION.most[channel] ?? 0.45]));
  for (const parts of [true, false]) {
    for (const channel of EXPRESSION_CHANNELS) {
      const offsets = stockOffsets({ [channel]: full[channel], fearParts: parts });
      assert.ok(Math.abs(offsets.brow) <= 1 && Math.abs(offsets.lid) <= 0.25 && offsets.mouth <= 0.75 && Math.abs(offsets.width) <= 0.2 && Math.abs(offsets.tilt) <= 0.1, `${channel}: ${JSON.stringify(offsets)}`);
    }
  }
  assert.deepEqual(stockOffsets(null), { lid: 0, mouth: 0, brow: 0, flush: 0, width: 0, shift: 0, tilt: 0 });
});
