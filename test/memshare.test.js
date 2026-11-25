// Memory (2026-11-25): crowd templates shared between colourings of one shape (crowdview.js crowdShapeKey, topologyOf,
// clusterColors; render.js shareShape) and big static meshes packed (meshpack.js).

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildBody, normaliseInputs, PRESETS } from '../src/body.js';
import { clusterColors, crowdKey, crowdShapeKey, topologyOf } from '../src/crowdview.js';

class FakeAttribute {
  constructor(array, itemSize, normalized = false) {
    Object.assign(this, { array, itemSize, normalized, count: array.length / itemSize });
  }
  onUpload(callback) {
    this.onUploadCallback = callback;
  }
}
globalThis.THREE ??= { BufferAttribute: FakeAttribute };
const { freeOnUpload, packedColours, packedNormals, packedGeometry } = await import('../src/meshpack.js');

const fighter = (change, corner = 'red') => {
  const inputs = normaliseInputs({ ...structuredClone(PRESETS.heavy), outfit: { kind: 'mingBrigandine', design: 1 } });
  change(inputs);
  return { body: buildBody(inputs), corner };
};

test('a man painted otherwise is the same shape, a man with other hair is not', () => {
  const plain = fighter(() => {});
  const painted = fighter((inputs) => {
    inputs.look.skinTone = 'deep';
    inputs.look.hairColor = '#c9a25e';
    inputs.look.eyeColor = 'grey';
    inputs.outfit = { ...inputs.outfit, paint: { 'armor.cloth': '#a42929' }, theme: 'mingRed' };
  }, 'blue');
  const shorn = fighter((inputs) => {
    inputs.look.hairStyle = inputs.look.hairStyle === 'bald' ? 'long' : 'bald';
  });
  assert.notEqual(crowdKey(plain), crowdKey(painted), 'his colours are his own template');
  assert.equal(crowdShapeKey(plain), crowdShapeKey(painted), 'but the same shape');
  assert.notEqual(crowdShapeKey(plain), crowdShapeKey(shorn));
});

test('the topology tells a recoloured mesh from a different one', () => {
  const template = { vertices: 4, bodyIndex: Uint32Array.of(0, 1, 2, 2, 1, 3), steelIndex: new Uint32Array(0), bodyOutlineIndex: Uint32Array.of(0, 1, 2), steelOutlineIndex: new Uint32Array(0), variant: Uint8Array.of(0, 0, 0, 0), vertexSegment: ['trunk', null, null, 'trunk'] };
  const same = { ...template, colors: new Float32Array(12).fill(0.5) };
  assert.equal(topologyOf(template), topologyOf(same));
  assert.notEqual(topologyOf(template), topologyOf({ ...template, bodyIndex: Uint32Array.of(0, 1, 2, 2, 3, 1) }));
  assert.notEqual(topologyOf(template), topologyOf({ ...template, vertices: 5 }));
  assert.notEqual(topologyOf(template), topologyOf({ ...template, variant: Uint8Array.of(0, 1, 0, 0) }));
});

test('a far body\'s colours for another colouring: the mean of the near vertices merged into each', () => {
  const far = { vertices: 2, clusterOf: Uint32Array.of(0, 0, 1, 1), members: Uint32Array.of(2, 2) };
  const colors = Float32Array.of(1, 0, 0, 0, 0, 1, 0.2, 0.2, 0.2, 0.4, 0.4, 0.4);
  const out = clusterColors(far, colors);
  assert.deepEqual([...out].map((value) => +value.toFixed(3)), [0.5, 0, 0.5, 0.3, 0.3, 0.3]);
});

test('normals and colours packed in bytes, within a step of what they were', () => {
  const normals = Float32Array.of(0, 1, 0, 0.6, 0, -0.8, -1, 0, 0);
  const packed = packedNormals(normals);
  assert.ok(packed.array instanceof Int8Array && packed.normalized);
  normals.forEach((value, at) => assert.ok(Math.abs(packed.array[at] / 127 - value) <= 0.5 / 127 + 1e-6));
  const colours = packedColours(Float32Array.of(0, 0.5, 1));
  assert.ok(colours.array instanceof Uint8Array && colours.normalized);
  assert.deepEqual([...colours.array], [0, 128, 255]);
  // (A tint over 1 keeps its floats: bytes would clip it.)
  assert.ok(packedColours(Float32Array.of(0.2, 1.3, 0.5)).array instanceof Float32Array);
});

test('an attribute freed on upload lets its page copy go, and its geometry is known as packed', () => {
  const attribute = freeOnUpload(new FakeAttribute(new Float32Array(30), 3));
  assert.equal(packedGeometry({ attributes: { uv: attribute } }), true);
  attribute.onUploadCallback();
  assert.equal(attribute.array.length, 0);
  assert.equal(attribute.count, 10, 'its count is kept for the draw');
  assert.equal(packedGeometry({ attributes: { position: new FakeAttribute(new Float32Array(3), 3) } }), false);
});
