import { test } from 'node:test';
import assert from 'node:assert/strict';
import { DETAIL_LOAD, keepDetailLoad, newDetailLoad } from '../src/detailload.js';
import { fullCircle, TABLE_DUEL } from '../src/tableduel.js';

const frames = (load, ms, seconds, frame = 1 / 60) => {
  for (let at = 0; at < seconds; at += frame) keepDetailLoad(load, ms, frame);
  return load.share;
};

test('the circle of men in full shrinks while the steps are slow, to the floor and no further', () => {
  const load = newDetailLoad();
  assert.equal(frames(load, DETAIL_LOAD.slowMs * 3, 0.2), 1, 'a moment slow is not yet slow');
  assert.ok(frames(load, DETAIL_LOAD.slowMs * 3, 1.5) < 1);
  assert.equal(frames(load, DETAIL_LOAD.slowMs * 3, 30), DETAIL_LOAD.floor);
});

test('it grows back only once the steps have come easily for a while', () => {
  const load = newDetailLoad();
  frames(load, DETAIL_LOAD.slowMs * 3, 30);
  // (Between easy and slow it stays as it is.)
  assert.equal(frames(load, (DETAIL_LOAD.slowMs + DETAIL_LOAD.easyMs) / 2, 30), DETAIL_LOAD.floor);
  assert.equal(frames(load, DETAIL_LOAD.easyMs / 2, 2), DETAIL_LOAD.floor);
  assert.equal(frames(load, DETAIL_LOAD.easyMs / 2, 120), 1);
});

test('a stall (the tab in the background) is not counted', () => {
  const load = newDetailLoad();
  assert.equal(frames(load, DETAIL_LOAD.stallMs * 2, 10), 1);
  assert.equal(load.smoothed, null);
});

test("the world's share shrinks the far circle, and the men kept besides by its square", () => {
  assert.deepEqual(fullCircle({}), { far: TABLE_DUEL.far, inFull: TABLE_DUEL.inFull });
  assert.deepEqual(fullCircle({ detailShare: 0.5 }), { far: TABLE_DUEL.far / 2, inFull: Math.round(TABLE_DUEL.inFull / 4) });
});
