import { test } from 'node:test';
import assert from 'node:assert/strict';
import { installShadowCache, shadowCacheAlong, SHADOW_CACHE } from '../src/shadowcache.js';

// A vector with only what shadowCacheAlong touches.
const vector = (x, y, z) => ({ x, y, z, set(a, b, c) { this.x = a; this.y = b; this.z = c; return this; } });
const dot = (v, d) => v.x * d[0] + v.y * d[1] + v.z * d[2];

test('a carried box steps along the sun in whole steps, its right and up kept', () => {
  const sun = [0.36, 0.8, 0.48];
  const length = Math.hypot(...sun);
  const way = sun.map((value) => value / length);
  const right = [way[2] / Math.hypot(way[0], way[2]), 0, -way[0] / Math.hypot(way[0], way[2])];
  for (const [x, y, z] of [[3.21, 0.4, -7.7], [120.5, 2.13, 88.01], [-0.02, -0.3, 0.01]]) {
    const target = vector(x, y, z);
    const before = { x, y, z };
    shadowCacheAlong(target, way);
    const along = dot(target, way) / SHADOW_CACHE.alongStep;
    assert.ok(Math.abs(along - Math.round(along)) < 1e-9, 'on a whole step along the sun');
    assert.ok(Math.abs(dot(target, right) - dot(before, right)) < 1e-9, 'not moved across the sun');
    assert.ok(Math.hypot(target.x - x, target.y - y, target.z - z) <= SHADOW_CACHE.alongStep / 2 + 1e-9, 'moved half a step at most');
  }
});

test('the boxes standing on the same step stand level: the stand does not follow every rise of the ground', () => {
  const way = [0, 1, 0];
  const a = shadowCacheAlong(vector(1, 0.31, 2), way);
  const b = shadowCacheAlong(vector(4, 0.42, -3), way);
  assert.equal(a.y, b.y);
});

test('without WebGL 2 (no blit) the shadow pass is left as three has it', () => {
  const render = () => {};
  const view = { renderer: { capabilities: { isWebGL2: false }, shadowMap: { render } } };
  installShadowCache(view);
  assert.equal(view.renderer.shadowMap.render, render);
  assert.equal(view.shadowCache, undefined);
});
