// The hand's geometry (src/handform.js): where a posture puts the hand against the hand point, which the simulation strikes and holds with.
import test from 'node:test';
import assert from 'node:assert/strict';
import { HAND, HAND_WEAR, handBlend, handParts, handPose } from '../src/handform.js';

const HEEL = 0.0637;
const FACE = 0.042;
const bounds = (positions) => {
  const low = [Infinity, Infinity, Infinity];
  const high = [-Infinity, -Infinity, -Infinity];
  for (let index = 0; index < positions.length; index += 1) {
    low[index % 3] = Math.min(low[index % 3], positions[index]);
    high[index % 3] = Math.max(high[index % 3], positions[index]);
  }
  return { low, high };
};

test('a fist\'s knuckles stand where a bare fist strikes from, whatever the build', () => {
  for (const girth of [0.85, 1, 1.3]) {
    const { parts } = handParts(handPose({ hold: 'fist' }, { heel: HEEL, face: FACE, girth }), { girth });
    const { high } = bounds(parts.skin.positions);
    assert.ok(Math.abs(high[1] - FACE) < 0.0015, `the fist's face at ${high[1].toFixed(4)} for girth ${girth}`);
  }
});

test('a hand closed on a handle has it on the hand point, inside the fingers', () => {
  for (const radius of [0.008, 0.015, 0.022]) {
    const pose = handPose({ hold: 'grip', radius }, { heel: HEEL, face: FACE });
    const { parts } = handParts(pose);
    const positions = parts.skin.positions;
    // No point of the hand deep inside the handle (a line along x through the origin), and flesh on both sides of it.
    let inside = 0;
    let before = 0;
    let behind = 0;
    for (let index = 0; index < positions.length; index += 3) {
      const r = Math.hypot(positions[index + 1], positions[index + 2]);
      if (Math.abs(positions[index]) < 0.03 && r < radius * 0.6) inside += 1;
      if (Math.abs(positions[index]) < 0.03 && positions[index + 1] > radius) before += 1;
      if (Math.abs(positions[index]) < 0.03 && positions[index + 1] < -radius) behind += 1;
    }
    assert.equal(inside, 0, `nothing through a handle of ${radius} m`);
    assert.ok(before > 10 && behind > 10, 'the fingers before it and the palm behind');
    // The fingers close further on a thinner handle.
    assert.ok(pose.fingers[1][2] > 0.8, 'the middle joints bent round it');
  }
  const thin = handPose({ hold: 'grip', radius: 0.008 }, { heel: HEEL, face: FACE });
  const thick = handPose({ hold: 'grip', radius: 0.024 }, { heel: HEEL, face: FACE });
  const curl = (pose) => pose.fingers[1][1] + pose.fingers[1][2] + pose.fingers[1][3];
  assert.ok(curl(thin) > curl(thick), 'closed further on the thinner');
});

test('the hand is as long and as broad as a hand, and a left is a right mirrored', () => {
  const open = handPose({ hold: 'open' }, { heel: HEEL, face: FACE });
  const right = handParts(open, { side: 'r' }).parts.skin;
  const left = handParts(open, { side: 'l' }).parts.skin;
  const { low, high } = bounds(right.positions);
  const length = high[1] + HEEL;
  assert.ok(Math.abs(length - HAND.length * 1.8) < 0.015, `the open hand ${length.toFixed(3)} m from the wrist to the fingertips`);
  for (let index = 0; index < right.positions.length; index += 3) {
    assert.ok(Math.abs(right.positions[index] - left.positions[index]) < 1e-6 && Math.abs(right.positions[index + 2] + left.positions[index + 2]) < 1e-6);
  }
  assert.ok(low[0] < 0 && high[0] > 0);
});

test('postures blend, a crowd\'s hand is far cheaper, and every covering builds in every posture', () => {
  const fist = handPose({ hold: 'fist' }, { heel: HEEL, face: FACE });
  const rest = handPose({ hold: 'rest' }, { heel: HEEL, face: FACE });
  const half = handBlend(fist, rest, 0.5);
  assert.ok(half.fingers[0][1] < fist.fingers[0][1] && half.fingers[0][1] > rest.fingers[0][1]);
  const full = handParts(fist);
  const low = handParts(fist, { detail: 'low' });
  assert.ok(low.triangles * 3 < full.triangles, `${low.triangles} against ${full.triangles}`);
  for (const cover of Object.keys(HAND_WEAR)) {
    for (const hold of ['fist', 'grip', 'slant', 'rest', 'limp', 'open', 'hook']) {
      for (const detail of ['full', 'low']) {
        const { parts } = handParts(handPose({ hold, radius: 0.016, slant: 0.4 }, { heel: HEEL, face: FACE }), { cover, detail, side: 'l' });
        for (const part of Object.values(parts)) {
          assert.ok(part.positions.every(Number.isFinite), `${cover} ${hold} ${detail}`);
          assert.ok(part.indices.every((index) => index < part.positions.length / 3));
        }
      }
    }
  }
});
