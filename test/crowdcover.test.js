// A crowd body's layers kept one inside another (crowdview.js coverLayers): on two tubes, one inside the other, what the outer
// covers is left out where the two move alike, kept where they do not, a point standing out through the outer drawn in
// under it, and bare skin never taken for a layer.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { coverLayers, keptOf } from '../src/crowdview.js';

/** An open tube round the y axis: `radius` m, `sides` round, `rings` up from 0 to 1 m; outward-facing triangles. */
function tube(radius, sides, rings, start) {
  const positions = [];
  const normals = [];
  const indices = [];
  for (let ring = 0; ring < rings; ring += 1) {
    for (let side = 0; side < sides; side += 1) {
      const angle = (side / sides) * Math.PI * 2;
      positions.push(radius * Math.cos(angle), ring / (rings - 1), radius * Math.sin(angle));
      normals.push(Math.cos(angle), 0, Math.sin(angle));
    }
  }
  for (let ring = 0; ring + 1 < rings; ring += 1) {
    for (let side = 0; side < sides; side += 1) {
      const a = start + ring * sides + side;
      const b = start + (ring + 1) * sides + side;
      const c = start + ring * sides + ((side + 1) % sides);
      const d = start + (ring + 1) * sides + ((side + 1) % sides);
      indices.push(a, b, c, b, d, c);
    }
  }
  return { positions, normals, indices };
}

/** A template of two tubes (inner 10 cm, outer 13 cm), each on its own bone, the inner's points marked bare skin if asked. */
function twoLayers({ innerBone = 0, outerBone = 0, outerSkin = false } = {}) {
  const sides = 12;
  const rings = 8;
  const inner = tube(0.1, sides, rings, 0);
  const outer = tube(0.13, sides, rings, sides * rings);
  const count = 2 * sides * rings;
  const skinIndex = new Uint16Array(count * 4);
  const skinWeight = new Float32Array(count * 4);
  for (let vertex = 0; vertex < count; vertex += 1) {
    skinIndex[vertex * 4] = vertex < sides * rings ? innerBone : outerBone;
    skinWeight[vertex * 4] = 1;
  }
  const attribute = (array, itemSize) => ({ array, itemSize, count: array.length / itemSize });
  return {
    template: {
      attributes: {
        position: attribute(Float32Array.from([...inner.positions, ...outer.positions]), 3),
        normal: attribute(Float32Array.from([...inner.normals, ...outer.normals]), 3),
        skinIndex: attribute(skinIndex, 4),
        skinWeight: attribute(skinWeight, 4),
      },
      colors: new Float32Array(count * 3).map((_, at) => at / (count * 3)),
      bodyIndex: Uint32Array.from([...inner.indices, ...outer.indices]),
      steelIndex: new Uint32Array(0),
      bodyOutlineIndex: Uint32Array.from(outer.indices),
      steelOutlineIndex: new Uint32Array(0),
      vertexSegment: Array.from({ length: count }, (_, vertex) => (vertex < sides * rings || !outerSkin ? null : 'trunk')),
      variant: new Uint8Array(count),
      vertices: count,
    },
    innerTriangles: inner.indices.length / 3,
    outerTriangles: outer.indices.length / 3,
    innerVertices: sides * rings,
  };
}

const radiusOf = (template, vertex) => Math.hypot(template.attributes.position.array[vertex * 3], template.attributes.position.array[vertex * 3 + 2]);

test('what the outer layer covers, moved alike, is left out; the outer layer is kept whole', () => {
  const { template, innerTriangles, outerTriangles } = twoLayers();
  const kept = coverLayers(template);
  const triangles = template.bodyIndex.length / 3;
  assert.ok(triangles >= outerTriangles && triangles < outerTriangles + innerTriangles * 0.2, `${triangles} triangles of ${innerTriangles} + ${outerTriangles}`);
  assert.equal(template.bodyOutlineIndex.length / 3, outerTriangles);
  assert.equal(template.vertices, kept.length);
  assert.equal(template.attributes.position.array.length, kept.length * 3);
  assert.equal(template.colors.length, kept.length * 3);
  for (const name of ['bodyIndex', 'bodyOutlineIndex']) for (const vertex of template[name]) assert.ok(vertex < template.vertices);
  // (Another colouring cut the same way.)
  const colours = new Float32Array(twoLayers().template.colors);
  assert.deepEqual(Array.from(keptOf(colours, kept, 3)), Array.from(template.colors));
});

test('under a layer the bones move otherwise, held as weighted, what is covered is kept (posed, it could come out from under it)', () => {
  const { template, innerTriangles, outerTriangles } = twoLayers({ innerBone: 1, outerBone: 0 });
  coverLayers(template, { follow: false });
  assert.equal(template.bodyIndex.length / 3, innerTriangles + outerTriangles);
});

test('a layer weighted apart from what is under it follows it (its weights become those under it), and what it covers is left out', () => {
  const { template, innerTriangles, outerTriangles, innerVertices } = twoLayers({ innerBone: 1, outerBone: 0 });
  coverLayers(template);
  assert.ok(template.bodyIndex.length / 3 < outerTriangles + innerTriangles * 0.4, `${template.bodyIndex.length / 3} triangles`);
  // (Every outer point now on the inner's bone; the inner's own kept.)
  const onInner = Array.from({ length: template.vertices }, (_, vertex) => template.attributes.skinIndex.array[vertex * 4] === 1 && template.attributes.skinWeight.array[vertex * 4] > 0.99);
  assert.ok(onInner.filter(Boolean).length >= outerTriangles / 2, `${onInner.filter(Boolean).length} points on the inner's bone`);
  assert.ok(innerVertices > 0);
});

test('a point standing out through the layer over it is drawn in under it', () => {
  const { template } = twoLayers({ innerBone: 1, outerBone: 0 });
  // An inner point half way up pushed out to 14 cm, through the outer layer's 13.
  const vertex = 4 * 12 + 3;
  const position = template.attributes.position.array;
  const out = 0.14 / 0.1;
  position[vertex * 3] *= out;
  position[vertex * 3 + 2] *= out;
  assert.ok(radiusOf(template, vertex) > 0.13);
  coverLayers(template, { follow: false });
  assert.ok(radiusOf(template, vertex) < 0.13, `${radiusOf(template, vertex).toFixed(3)} m`);
});

test('bare skin is never a layer', () => {
  const { template, innerTriangles, outerTriangles } = twoLayers({ outerSkin: true });
  coverLayers(template);
  assert.equal(template.bodyIndex.length / 3, innerTriangles + outerTriangles);
});
