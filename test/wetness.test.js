// How wet a body is (wetness.js): stood water wets what went under and no higher, and dries back down from its edge;
// rain wets slowly and not under a roof; sweat comes of the heat to be lost, where the glands are, and not on a man
// at rest; mud is taken from soft ground and stays; hair and cloth are told how wet they are.

import test from 'node:test';
import assert from 'node:assert/strict';
import { P, PARTICLES } from '../src/body.js';
import { WET, WET_CHANNEL, WET_COUNT, WET_POINTS, WET_SEGMENTS, createWetness, evaporationMost, setWetness, stepWetness, wetHeights } from '../src/wetness.js';

/** A man standing: his particles at plausible heights (m). */
function standing() {
  const heights = { head: 1.62, neck: 1.45, lShoulder: 1.42, rShoulder: 1.42, lElbow: 1.15, rElbow: 1.15, lHand: 0.9, rHand: 0.9, pelvis: 0.95, lHip: 0.92, rHip: 0.92, lKnee: 0.5, rKnee: 0.5, lFoot: 0.07, rFoot: 0.07 };
  const x = new Float32Array(PARTICLES.length * 3);
  for (const name of PARTICLES) x[P[name] * 3 + 1] = heights[name];
  const state = createWetness();
  wetHeights(x, state.heights);
  return state;
}

const at = (state, segment, point, channel) => state.values[(WET_SEGMENTS.indexOf(segment) * WET_POINTS + point) * 4 + WET_CHANNEL[channel]];

test('a fresh body is dry, and a man at rest in mild air stays so', () => {
  const state = standing();
  assert.equal(state.any, false);
  stepWetness(state, { sweat: 0 }, 60);
  assert.equal(state.any, false);
  assert.equal(state.hair, 0);
});

test('stood water wets what is under its surface at once and nothing above it', () => {
  const state = standing();
  stepWetness(state, { water: 0.5 }, 0.1);
  assert.equal(at(state, 'lShank', 3, 'water'), 1, 'the foot');
  assert.ok(at(state, 'lShank', 1, 'water') > 0.9, 'the shin');
  assert.ok(Math.abs(at(state, 'lShank', 0, 'water') - 0.5) < 0.01, 'the knee, at the surface: half');
  assert.equal(at(state, 'lThigh', 2, 'water'), 0, 'the thigh over it');
  assert.equal(at(state, 'trunk', 3, 'water'), 0);
  assert.equal(state.hair, 0);
  assert.ok(state.any && state.cloth > 0 && state.cloth < 0.3);
});

test('out of the water it dries, the edge first, faster in wind and sun, and not in the rain', () => {
  const dried = (air) => {
    const state = standing();
    stepWetness(state, { water: 0.5 }, 0.1);
    stepWetness(state, air, 120);
    return state;
  };
  const still = dried({});
  assert.ok(at(still, 'lShank', 0, 'water') < 0.5 && at(still, 'lShank', 3, 'water') > at(still, 'lShank', 0, 'water'), 'the tide line has gone down the leg');
  assert.ok(at(dried({ wind: 6, sun: 1 }), 'lShank', 3, 'water') < at(still, 'lShank', 3, 'water'));
  assert.equal(at(dried({ rain: 1 }), 'lShank', 3, 'water'), 1);
  const long = dried({});
  stepWetness(long, {}, WET.dry);
  assert.equal(long.any, false, 'dry in the end');
});

test('rain wets a man slowly, all of him, and his hair and clothes with it; none falls under a roof', () => {
  const state = standing();
  stepWetness(state, { rain: 1 }, WET.soak / 3);
  assert.ok(Math.abs(at(state, 'head', 3, 'rain') - 1 / 3) < 0.01);
  assert.ok(state.hair > 0.3 && state.hair < 0.4 && state.cloth > 0.3);
  stepWetness(state, { rain: 1 }, WET.soak);
  assert.equal(at(state, 'lShank', 2, 'rain'), 1);
  assert.equal(state.soaked, 1);
  const sheltered = standing();
  stepWetness(sheltered, { rain: 0 }, 300);
  assert.equal(sheltered.any, false);
});

test('sweat follows the heat to be lost with a lag, the brow and chest before the shins, and dries when the work stops', () => {
  const state = standing();
  stepWetness(state, { sweat: 450 }, 1);
  assert.ok(at(state, 'head', 3, 'sweat') < 0.01, 'not at once');
  for (let second = 0; second < 30; second += 1) stepWetness(state, { sweat: 450 }, 1);
  const brow = at(state, 'head', 3, 'sweat');
  assert.ok(brow > 0.3, `the brow glistens after half a minute of hard work (${brow})`);
  assert.ok(brow > at(state, 'trunk', 2, 'sweat') && at(state, 'trunk', 2, 'sweat') > at(state, 'lShank', 3, 'sweat'));
  assert.ok(state.cloth === 0, 'sweat soaks no clothes');
  assert.ok(state.hair > 0 && state.hair <= WET.sweatHair);
  for (let second = 0; second < 1200; second += 1) stepWetness(state, { sweat: 0 }, 1);
  assert.ok(at(state, 'head', 3, 'sweat') < 0.02, 'dry again');
});

test('sweat lies longer in damp air and under armour, and less in a wind', () => {
  const worked = (air) => {
    const state = standing();
    for (let second = 0; second < 120; second += 1) stepWetness(state, { sweat: 60, ...air }, 1);
    return at(state, 'trunk', 3, 'sweat');
  };
  assert.ok(worked({ evaporation: 0.4 }) > worked({}));
  assert.ok(worked({ cover: 1 }) > worked({}));
  assert.ok(worked({ wind: 6 }) < worked({}));
  assert.ok(evaporationMost(1, 0, 1) < evaporationMost(1, 0, 0));
});

test('mud is taken to its surface, thrown higher by a moving leg, and stays when the water in it has dried', () => {
  const state = standing();
  stepWetness(state, { mud: 0.12 }, 0.1);
  assert.equal(at(state, 'lShank', 3, 'mud'), 1);
  assert.equal(at(state, 'lShank', 0, 'mud'), 0);
  const moving = standing();
  stepWetness(moving, { mud: 0.12, speed: 3 }, 0.1);
  assert.ok(at(moving, 'lShank', 2, 'mud') > at(state, 'lShank', 2, 'mud'));
  stepWetness(state, {}, 2 * WET.dry);
  assert.equal(at(state, 'lShank', 3, 'mud'), 1);
  assert.equal(at(state, 'lShank', 3, 'water'), 0);
  assert.ok(state.any);
});

test('a state can be set for a review: all over, or as stood water to a level', () => {
  const state = standing();
  setWetness(state, { water: 1, sweat: 1 });
  assert.equal(state.cloth, 1);
  assert.equal(state.hair, 1);
  assert.equal(at(state, 'head', 3, 'sweat'), 1);
  setWetness(state, { water: 1, level: 1 });
  assert.equal(at(state, 'lThigh', 3, 'water'), 1);
  assert.equal(at(state, 'head', 0, 'water'), 0);
  assert.equal(state.values.length, WET_COUNT * 4);
});
