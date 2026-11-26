// A fight's state as data (src/simsnapshot.js): snapshotted mid-fight, restored into a fresh process (tools/snapshot.js), the
// fight goes on bit for bit; the snapshot keeps shared objects shared, Sets and Maps in order, and numbers JSON has not.

import test from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { restoreWorld, snapshotWorld } from '../src/simsnapshot.js';
import { duel } from '../tools/simcases.js';

const TOOL = fileURLToPath(new URL('../tools/snapshot.js', import.meta.url));

test('a duel and a 2v2 snapshotted mid-fight go on bit for bit after a restore in a fresh process', () => {
  for (const [key, before, after] of [['duel', '600', '600'], ['2v2', '450', '450']]) {
    const said = execFileSync(process.execPath, [TOOL, key, before, after], { encoding: 'utf8' });
    assert.match(said, /IDENTICAL/, said);
  }
});

test('a snapshot keeps shared objects shared, Sets as Sets and numbers JSON has not', () => {
  const world = duel('plate', 'tosei', 3);
  const [red, blue] = world.fighters;
  red.seenPunch = blue.punch = { at: [0, 1, 2], kind: 'jab' };
  red.broken.add('lKnee');
  world.oddNumbers = [Infinity, -Infinity, NaN, -0, undefined];
  const kept = JSON.parse(JSON.stringify(snapshotWorld(world)));
  const back = restoreWorld(duel('plate', 'tosei', 3), kept);
  assert.equal(back.fighters[0].seenPunch, back.fighters[1].punch, 'one object, as it was');
  assert.equal(back.fighters[0].arena, back.arena);
  assert.ok(back.fighters[0].broken instanceof Set && back.fighters[0].broken.has('lKnee'));
  assert.ok(back.fighters[0].x instanceof Float64Array);
  assert.deepEqual(back.oddNumbers.slice(0, 3), [Infinity, -Infinity, NaN]);
  assert.ok(Object.is(back.oddNumbers[3], -0) && back.oddNumbers.length === 5 && back.oddNumbers[4] === undefined);
  // The generator goes on where it was: world.random still reads world.rng.
  assert.equal(back.random(), world.random());
});
