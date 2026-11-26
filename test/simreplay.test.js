// The simulation's boundary (src/sim.js): a played bout recorded as its setup and its stream of orders, actions and steps is
// fought again exactly from the recording alone, in a fresh process (tools/replay.js), as a browser's recording is in the
// browser's own engine. (Across engines the transcendental maths differ, so a recording replays bit for bit only in the
// engine that made it: Chrome's V8 and node's are not the same V8.)

import test from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { newOrders } from '../src/control.js';
import { WARRIORS } from '../src/roster.js';
import { applyAction, createRecorder, createSim, newCommand, replayRecording, stepSim, worldHash } from '../src/sim.js';

const ROOT = fileURLToPath(new URL('..', import.meta.url));
const inputsOf = (key) => structuredClone(WARRIORS.find((warrior) => warrior.key === key).inputs);

/** A duel played by a script: the stick pushed this way and that, blows and a parry asked for, walk mode on and off. */
function playedDuel(steps) {
  const setup = { mode: 'sandbox', scenario: null, muster: null, entries: [{ inputs: inputsOf('plate'), corner: 'red' }, { inputs: inputsOf('tosei'), corner: 'blue' }], seed: 11, place: 'meadow', general: null };
  const world = createSim(setup);
  let orders = newOrders();
  const recorder = createRecorder(setup, { orders: () => orders, world, hashEvery: 30 });
  const act = (action) => {
    recorder.action(action);
    applyAction(world, action, orders);
    recorder.actionDone();
  };
  for (let index = 0; index < steps; index += 1) {
    // Between steps, as keys would: an attack asked for, a parry, walk mode, the orders begun afresh.
    if (index === 60) act({ kind: 'swing', fighter: 0, move: 'jab', zone: 'head' });
    if (index === 140) act({ kind: 'perform', fighter: 0, move: 'parry' });
    if (index === 200) act({ kind: 'walking', fighter: 0, on: true });
    if (index === 260) act({ kind: 'walking', fighter: 0, on: false });
    if (index === 300) orders.guard = true;
    if (index === 330) orders.guard = false;
    if (index === 400) orders = newOrders();
    const command = newCommand();
    command.mode = 'sandbox';
    command.player = 0;
    const turn = index / 90;
    command.view = { eye: [Math.cos(turn) * 4, Math.sin(turn) * 4], ahead: [-Math.cos(turn), -Math.sin(turn)], half: 0.6 };
    command.stick = { keys: index % 120 < 50 ? ['w'] : index % 120 < 70 ? ['a', 'w'] : [], axes: { ahead: [1, 0], right: [0, 1] }, running: false, throttle: 0 };
    command.walk = { keys: index % 50 < 30 ? ['w'] : [], look: [1, 0.2], running: false };
    recorder.step(command);
    stepSim(world, command, orders);
    recorder.stepDone(world);
  }
  return { world, recording: recorder.finish(world) };
}

test('a played duel replays bit for bit from its recording, in this process and in a fresh one', () => {
  const { world, recording } = playedDuel(600);
  assert.equal(recording.steps, 600);
  assert.ok(recording.stream.some((entry) => entry.a) && recording.stream.some((entry) => entry.o), 'actions and orders changes recorded');
  // (Through JSON, as a recording is kept.)
  const kept = JSON.parse(JSON.stringify(recording));
  const again = replayRecording(kept, { newOrders });
  assert.deepEqual(again.parted, []);
  assert.equal(again.hash, worldHash(world));
  const file = join(mkdtempSync(join(tmpdir(), 'hacs-replay-')), 'duel.json');
  writeFileSync(file, JSON.stringify(recording));
  const said = execFileSync(process.execPath, [join(ROOT, 'tools/replay.js'), file], { encoding: 'utf8' });
  assert.match(said, /IDENTICAL/);
});

test('a recording that is changed does not replay to the same hashes', () => {
  const { recording } = playedDuel(240);
  const changed = structuredClone(recording);
  const action = changed.stream.find((entry) => entry.a);
  action.a.move = 'cross';
  assert.notDeepEqual(replayRecording(changed, { newOrders }).parted, []);
});
