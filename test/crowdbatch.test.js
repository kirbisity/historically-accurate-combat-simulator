// The far men's batches (crowdbatch.js): who is drawn in one and when, and which men share one. The drawing itself is
// checked in the browser (before/after frames); here only the choices, with an inert stand-in for three.
import test from 'node:test';
import assert from 'node:assert/strict';

globalThis.THREE ??= new Proxy({}, { get: () => class { set() { return this; } } });
const { CROWD_BATCH, batchKey, batchMan, beginCrowdBodies, unbatchMan } = await import('../src/crowdbatch.js');

/** A crowd man's view as the batches read it: baked, in skin, whole, his head's group shown. */
const manView = (inputs = {}, { helmed = true, corner = 'red', bmi = 23 } = {}) => ({
  baked: true, layer: 'skin', template: { far: {}, bare: helmed ? {} : null }, head: { group: { visible: true } }, draw: { culled: false },
  fighter: { corner, body: { composition: { bmi }, inputs: { name: 'A', heightCm: 175, training: 0.7, bodyFat: 0.1, outfit: { kind: 'ashigaru' }, look: { hairStyle: 'bald', facialHair: 'none', skinTone: 2 }, ...inputs } } },
});

test('a man is batched past the distance and stays batched until the margin inside it', () => {
  const view = {};
  const man = manView();
  beginCrowdBodies(view);
  assert.equal(batchMan(view, man, man.draw, CROWD_BATCH.distance - 0.1, false), false);
  assert.equal(batchMan(view, man, man.draw, CROWD_BATCH.distance + 0.1, false), true);
  assert.equal(man.head.group.visible, false, 'his worn props are drawn in their batch, not on him');
  assert.equal(batchMan(view, man, man.draw, CROWD_BATCH.distance - CROWD_BATCH.margin + 0.1, false), true);
  assert.equal(batchMan(view, man, man.draw, CROWD_BATCH.distance - CROWD_BATCH.margin - 0.1, false), false);
  assert.equal(man.head.group.visible, true);
  assert.equal(view.crowdBodies.men.length, 2, 'the two frames he was batched in put him on the list');
});

test('a protected, culled, cut or bare-headed man is never batched', () => {
  const far = CROWD_BATCH.distance * 3;
  const cases = [
    [manView(), true, {}],
    [manView(), false, { culled: true }],
    [Object.assign(manView(), { severedBones: new Set([3]) }), false, {}],
    [Object.assign(manView(), { bareHead: true }), false, {}],
    [Object.assign(manView(), { layer: 'muscle' }), false, {}],
  ];
  for (const [man, safe, draw] of cases) {
    Object.assign(man.draw, draw);
    assert.equal(batchMan({}, man, man.draw, far, safe), false);
  }
});

test('once out of the batches (the lod off, another layer) his head is shown again', () => {
  const man = manView();
  batchMan({}, man, man.draw, CROWD_BATCH.distance * 2, false);
  unbatchMan(man);
  assert.equal(man.draw.batched, false);
  assert.equal(man.head.group.visible, true);
});

test('men of one outfit and build share a batch whatever their height, training, fat or hair under a helmet', () => {
  const a = manView({ heightCm: 168, training: 0.71, bodyFat: 0.08, look: { hairStyle: 'dreads', facialHair: 'beard', skinTone: 1 } });
  const b = manView({ heightCm: 181, training: 0.86, bodyFat: 0.14, look: { hairStyle: 'bald', facialHair: 'none', skinTone: 4 } });
  assert.equal(batchKey(a), batchKey(b));
});

test('the side, the outfit, the build and a bare head’s hair keep men apart', () => {
  const base = batchKey(manView());
  assert.notEqual(batchKey(manView({}, { corner: 'blue' })), base);
  assert.notEqual(batchKey(manView({ outfit: { kind: 'mingElite' } })), base);
  assert.notEqual(batchKey(manView({}, { bmi: 32 })), base);
  const bare = (hairStyle) => batchKey(manView({ look: { hairStyle, facialHair: 'none' } }, { helmed: false }));
  assert.notEqual(bare('dreads'), bare('bald'));
});
