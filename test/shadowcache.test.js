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

test("a caster the view says no one reads in a light's map is left out of that light's draw alone, and casts again after", () => {
  globalThis.THREE ??= { VSMShadowMap: 3 };
  const calls = [];
  const kept = { castShadow: true };
  const other = { castShadow: true };
  const scene = {};
  const shadowMap = { enabled: true, autoUpdate: true, needsUpdate: false, type: 1, render(lights) { calls.push({ lights: lights.map((light) => light.name), kept: kept.castShadow, other: other.castShadow, asked: this.needsUpdate }); this.needsUpdate = false; } };
  const view = { scene, renderer: { capabilities: { isWebGL2: true }, shadowMap, domElement: {} } };
  installShadowCache(view);
  const wide = { name: 'wide' };
  const finer = { name: 'finer' };
  const was = SHADOW_CACHE.on;
  SHADOW_CACHE.on = false;
  try {
    shadowMap.render([wide, finer], scene, {});
    assert.deepEqual(calls, [{ lights: ['wide', 'finer'], kept: true, other: true, asked: true }], 'with nothing to leave out, one draw as three does it');
    calls.length = 0;
    view.shadowSkip = (light) => (light === wide ? [kept] : null);
    shadowMap.render([wide, finer], scene, {});
    assert.deepEqual(calls, [{ lights: ['finer'], kept: true, other: true, asked: true }, { lights: ['wide'], kept: false, other: true, asked: true }]);
    assert.equal(kept.castShadow, true, 'it casts again once the pass is drawn');
    calls.length = 0;
    shadowMap.autoUpdate = false;
    shadowMap.render([wide, finer], scene, {});
    assert.deepEqual(calls, [{ lights: ['wide', 'finer'], kept: true, other: true, asked: false }], 'a pass three would skip is handed to it as it is');
  } finally {
    SHADOW_CACHE.on = was;
  }
});
