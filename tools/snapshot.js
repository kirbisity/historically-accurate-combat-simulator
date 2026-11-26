// A fight snapshotted mid-way (src/simsnapshot.js) and restored into a fresh process goes on bit for bit (port groundwork, the
// user's call, 2026-11-26). Each case is fought headless as tools/determinism.js fights it (thinkAll then step, 1/60 s).
// Not part of the game.
//
//   node tools/snapshot.js <case> <before> <after> [--json FILE]
//     fights `before` steps, snapshots, fights `after` more; then a fresh process restores the snapshot into the case made
//     afresh and fights the same `after` steps: the two final hashes (src/sim.js worldHash) must agree.
//   cases: duel, 2v2, battle60, custom100 (tools/simcases.js).
//   (`node tools/snapshot.js restore <case> <file> <after>`: the fresh process's part.)

import { execFileSync } from 'node:child_process';
import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { thinkAll } from '../src/ai.js';
import { step } from '../src/physics.js';
import { worldHash } from '../src/sim.js';
import { restoreWorld, snapshotWorld } from '../src/simsnapshot.js';
import * as simcases from './simcases.js';

const HERE = fileURLToPath(import.meta.url);

const CASES = {
  duel: () => simcases.duel('plate', 'tosei', 7),
  '2v2': () => simcases.team(['plate', 'footSpear'], ['tosei', 'mingDao'], 7),
  battle60: () => simcases.scaledBattle('sarhu', 60, 7),
  custom100: () => simcases.custom(100, 7),
};

/** What a snapshot holds: its rows by kind, how many are referenced from more than one place, the functions left to the fresh world (by key), the numbers JSON cannot hold. */
function snapshotInventory({ rows }) {
  const kinds = {};
  const refs = new Map();
  const functions = new Map();
  let nonFinite = 0;
  const value = (entry, key) => {
    if (entry === null || typeof entry !== 'object') return;
    if (entry.r !== undefined) refs.set(entry.r, (refs.get(entry.r) ?? 0) + 1);
    if (entry.f) functions.set(key, (functions.get(key) ?? 0) + 1);
    if (entry.n && entry.n !== '-0') nonFinite += 1;
  };
  for (const row of rows) {
    const kind = row.t ?? (row.a ? 'array' : row.s ? 'Set' : row.m ? 'Map' : 'object');
    kinds[kind] = (kinds[kind] ?? 0) + 1;
    if (row.a) row.a.forEach((entry) => value(entry, '[]'));
    if (row.s) row.s.forEach((entry) => value(entry, '{}'));
    if (row.m) row.m.forEach(([k, entry]) => { value(k, '<key>'); value(entry, '<>'); });
    if (row.o) for (const [key, entry] of Object.entries(row.o)) value(entry, key);
    if (row.t) nonFinite += row.v.filter((entry) => typeof entry === 'object' && entry.n !== '-0').length;
  }
  return { rows: kinds, shared: [...refs.values()].filter((count) => count > 1).length, functions: [...functions].map(([key, count]) => `${key} x${count}`), nonFinite };
}

function fight(world, steps) {
  for (let index = 0; index < steps; index += 1) {
    thinkAll(world, 1 / 60);
    step(world, 1 / 60);
  }
}

const [mode, ...rest] = process.argv.slice(2);
if (mode === 'restore') {
  const [key, file, after] = rest;
  const world = restoreWorld(CASES[key](), JSON.parse(readFileSync(file, 'utf8')));
  const restored = worldHash(world);
  fight(world, Number(after));
  console.log(JSON.stringify({ restored, final: worldHash(world) }));
} else if (process.argv[1] === HERE) {
  const [key = 'duel', before = '600', after = '600'] = [mode, ...rest];
  const world = CASES[key]();
  fight(world, Number(before));
  const data = snapshotWorld(world);
  const snapshot = JSON.stringify(data);
  const inventory = snapshotInventory(data);
  const at = worldHash(world);
  fight(world, Number(after));
  const final = worldHash(world);
  const file = join(mkdtempSync(join(tmpdir(), 'hacs-snapshot-')), `${key}.json`);
  writeFileSync(file, snapshot);
  const fresh = JSON.parse(execFileSync(process.execPath, [HERE, 'restore', key, file, after], { encoding: 'utf8', maxBuffer: 1 << 26 }));
  const result = { case: key, men: world.fighters.length, before: Number(before), after: Number(after), snapshotKB: Math.round(snapshot.length / 1024), at, restored: fresh.restored, final, freshFinal: fresh.final, same: at === fresh.restored && final === fresh.final };
  result.inventory = inventory;
  console.log(`${key}: ${result.men} men, snapshot at step ${before} (${result.snapshotKB} KB) ${at} restored ${fresh.restored}; ${after} steps on: ${final} against ${fresh.final}: ${result.same ? 'IDENTICAL' : 'DIFFERENT'}`);
  console.log(`  rows ${JSON.stringify(inventory.rows)}; shared (referenced more than once) ${inventory.shared}; functions ${inventory.functions.join(', ')}; non-finite numbers ${inventory.nonFinite}`);
  const jsonAt = process.argv.indexOf('--json');
  if (jsonAt >= 0) writeFileSync(process.argv[jsonAt + 1], JSON.stringify(result, null, 2));
  process.exit(result.same ? 0 : 1);
}
