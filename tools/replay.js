// A bout recorded in the browser (boxer.record(true), then boxer.recording() saved as JSON), fought again headless from its
// setup and its stream of orders, actions and steps (src/sim.js replayRecording), its world hashed against the recording's
// own every second and at the end. The same hashes: the browser's fight was the simulation's alone, driven by the commands
// recorded (port groundwork, the user's call, 2026-11-26). Not part of the game.
// Usage: node tools/replay.js recording.json [--quiet]

import { readFileSync } from 'node:fs';
import { newOrders } from '../src/control.js';
import { replayRecording } from '../src/sim.js';

const [file, ...flags] = process.argv.slice(2);
if (!file) {
  console.error('usage: node tools/replay.js recording.json');
  process.exit(2);
}
const recording = JSON.parse(readFileSync(file, 'utf8'));
const started = performance.now();
const { world, steps, hash, parted } = replayRecording(recording, { newOrders });
const actions = recording.stream.filter((entry) => entry.a).length;
const orders = recording.stream.filter((entry) => entry.o).length;
const checks = recording.stream.filter((entry) => entry.h).length + 1;
console.log(`${file}: ${world.fighters.length} men, ${steps} steps (recorded ${recording.steps}), ${orders} orders changes, ${actions} actions, ${checks} hashes checked, ${Math.round(performance.now() - started)} ms`);
console.log(`final hash: replayed ${hash}, recorded ${recording.hash}`);
if (!flags.includes('--quiet')) for (const part of parted.slice(0, 10)) console.log(`  parted at step ${part.step}: recorded ${part.recorded}, replayed ${part.replayed}`);
console.log(parted.length ? `DIFFERENT (${parted.length} of ${checks} hashes)` : 'IDENTICAL');
process.exit(parted.length ? 1 : 0);
