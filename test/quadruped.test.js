// Going on all fours as a body's build makes it (physics/quadruped.js), the display (physics/display.js), the bite as the
// body's own (grappling.js biteOf), and the ape's drawn body (apebody.js).
import test from 'node:test';
import assert from 'node:assert/strict';
import { PRESETS } from '../src/body.js';
import { advance, createWorld, placeFighter, throwPunch } from '../src/physics.js';
import { quadBody } from '../src/physics/quadruped.js';
import { startDisplay } from '../src/physics/display.js';
import { biteOf } from '../src/physics/grappling.js';
import { buildSkinMesh } from '../src/bodystyles.js';

const duel = (red, blue = PRESETS.heavy) => {
  const world = createWorld([structuredClone(red), structuredClone(blue)], { seed: 1 });
  world.arena.halfX = world.arena.halfZ = 30;
  placeFighter(world.fighters[0], -4, 0);
  placeFighter(world.fighters[1], 4, 0);
  return world;
};

test('long arms on short legs go on all fours, the trunk sloping up to the shoulders; a man does not', () => {
  const lean = {};
  for (const key of ['gorilla', 'chimp', 'baboon', 'macaque', 'heavy', 'light', 'joan', 'sumo']) {
    const world = duel(PRESETS[key]);
    const body = quadBody(world.fighters[0].body);
    assert.equal(body.fit, ['gorilla', 'chimp', 'baboon', 'macaque'].includes(key), key);
    lean[key] = body.lean;
  }
  // The longer the arms for the legs, the more upright the trunk on all fours: a gorilla's well up, a macaque's level.
  assert.ok(lean.gorilla < lean.chimp && lean.chimp < lean.baboon && lean.baboon < lean.macaque);
  assert.ok(lean.gorilla > 0.8 && lean.gorilla < 1.2, `a silverback's trunk ~30° above level (${lean.gorilla})`);
});

test('a silverback stands, walks and gallops on its knuckles at its body\'s pace, and rears up to strike', () => {
  const world = duel(PRESETS.gorilla);
  const [ape, man] = world.fighters;
  advance(world, 1, () => { ape.move = 0; man.move = 0; });
  assert.equal(ape.quad.up, 0, 'down on all fours standing');
  const hands = [ape.x[3 * 6 + 1], ape.x[3 * 7 + 1]];
  assert.ok(Math.max(...hands) < 0.12, `knuckles on the floor (${hands})`);
  advance(world, 1.5, () => { ape.move = 1; ape.running = true; man.move = 0; });
  const speed = Math.hypot(...ape.rootVelocity);
  assert.equal(ape.quad.gait, 'gallop');
  assert.ok(speed > 3 && speed < quadBody(ape.body).top, `a run on all fours (${speed.toFixed(1)} m/s)`);
  // The top speed is its body's: ~6-9 m/s for a silverback (filmed charges), no style multiplier in it.
  assert.ok(quadBody(ape.body).top > 5.5 && quadBody(ape.body).top < 9.5);
  placeFighter(man, ape.root[0] + 1.2, ape.root[1]);
  advance(world, 0.2, () => { ape.move = 0; ape.running = false; man.move = 0; });
  assert.ok(throwPunch(world, ape, 'clubR', 'head'));
  advance(world, quadBody(ape.body).rearSeconds + 0.05, () => { ape.move = 0; man.move = 0; });
  assert.equal(ape.quad.up, 1, 'reared up into the blow');
});

test('the chest-beat rears it up; the strut stays on all fours', () => {
  const world = duel(PRESETS.gorilla);
  const [ape, man] = world.fighters;
  advance(world, 0.5, () => { ape.move = 0; man.move = 0; });
  assert.ok(startDisplay(world, ape, 'beat', man));
  advance(world, 0.6, () => { ape.move = 0; man.move = 0; });
  assert.equal(ape.quad.up, 1);
  advance(world, 2, () => { ape.move = 0; man.move = 0; });
  assert.equal(ape.display, null, 'over in its seconds');
  assert.ok(startDisplay(world, ape, 'strut', man));
  advance(world, 0.6, () => { ape.move = 0.5; man.move = 0; });
  assert.equal(ape.quad.up, 0);
});

test('the bite is the jaws\' own: a silverback bites at ~2.5 kN, a man fighting in its style has no canines to bite with', () => {
  const world = duel(PRESETS.gorilla, { ...PRESETS.heavy, style: 'gorilla' });
  const [ape, man] = world.fighters;
  assert.equal(biteOf(ape).forceN, 2500);
  assert.equal(biteOf(man), null);
});

test('the ape body style meshes a coat with a saddle lighter than the rest, at a fighter\'s cost', () => {
  const world = duel(PRESETS.gorilla);
  const built = buildSkinMesh(world.fighters[0].body, 'ape');
  const triangles = built.indices.length / 3;
  assert.ok(triangles > 8000 && triangles < 26000, `${triangles} triangles`);
  const tints = Array.from({ length: built.tint.length / 3 }, (_, vertex) => built.tint[vertex * 3]);
  assert.ok(Math.max(...tints) > 2, 'the silver saddle well lighter than the black coat');
  assert.ok(tints.filter((value) => value < 1.3).length > tints.length * 0.5, 'most of the coat black');
});
