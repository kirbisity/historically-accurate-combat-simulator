// Port groundwork (a native port later, the user's call, 2026-11-26): is a fight replayed exactly from its seed? Each case is
// fought headless (thinkAll then step, 1/60 s, as main.js tick does) several ways and a hash of the world taken after every
// step: every particle's position and last position bit for bit (Float64), each man's state, the events' count and the draws
// made on the world's seeded random. Runs that should agree are compared step by step, and the first step they part at named.
//
//   A, B  two fresh processes, the same seed: exact replay on one machine.
//   C     a fresh process whose Math.random is seeded otherwise: whether anything in the fight draws on Math.random.
//   A2    the case fought a second time in A's process: whether one world's run leaves module state that changes the next.
//
// Each run also counts, by calling site, what the fight reaches for outside the world: Math.random, performance.now, Date.now
// (a clock read by the sim is a branch on the machine's speed), split into the world's making and its stepping.
// Usage: node tools/determinism.js [case,...] [--steps N] [--json FILE]
//        cases: duel 2v2 battle60 custom500 (default all); a child run is `node tools/determinism.js run <case> <steps> <mathSeed> [twice]`

import { fork } from 'node:child_process';
import { writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const HERE = fileURLToPath(import.meta.url);

// The cases: what to build and how many steps by default (a 500-man step is about 30 ms here; the lines meet after 20 s or so).
const CASES = {
  duel: { steps: 3600, make: (c) => c.duel('plate', 'tosei', 7) },
  '2v2': { steps: 2400, make: (c) => c.team(['plate', 'footSpear'], ['tosei', 'mingDao'], 7) },
  battle60: { steps: 1800, make: (c) => c.scaledBattle('sarhu', 60, 7) },
  custom500: { steps: 2400, make: (c) => c.custom(500, 7) },
};

/** A seeded stand-in for Math.random (the same generator as physics.js seededRandom), counted by calling site. */
function instrument(mathSeed) {
  const sites = { build: {}, run: {} };
  const phase = { now: 'build' };
  const siteOf = () => {
    const lines = new Error().stack.split('\n').slice(3);
    const frame = lines.find((line) => !line.includes('tools/determinism.js')) ?? '';
    return frame.trim().replace(/^at /, '').replace(/file:\/\/[^ )]*\/src\//, 'src/').replace(/file:\/\/[^ )]*\/tools\//, 'tools/');
  };
  const count = (kind) => {
    const table = sites[phase.now];
    const key = `${kind} ${siteOf()}`;
    table[key] = (table[key] ?? 0) + 1;
  };
  let state = mathSeed >>> 0;
  Math.random = () => {
    count('Math.random');
    state = (state + 0x6d2b79f5) >>> 0;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
  const realNow = performance.now.bind(performance);
  const realDate = Date.now;
  // (Only while stepping: the harness's own timing is outside it.)
  const counting = { on: false };
  performance.now = () => {
    if (counting.on) count('performance.now');
    return realNow();
  };
  Date.now = () => {
    if (counting.on) count('Date.now');
    return realDate();
  };
  return { sites, phase, counting, realNow };
}

/** FNV-1a over 32-bit words. */
function mixer(seed = 2166136261) {
  let value = seed >>> 0;
  return {
    word(number) {
      value ^= number >>> 0;
      value = Math.imul(value, 16777619) >>> 0;
    },
    get value() { return value; },
  };
}

const bits = new Float64Array(1);
const words = new Uint32Array(bits.buffer);

/** The world after a step, bit for bit where it is numbers: positions, last positions, states, events, random draws. */
export function hashWorld(world, draws = 0) {
  const hash = mixer();
  const float = (number) => {
    bits[0] = number;
    hash.word(words[0]);
    hash.word(words[1]);
  };
  for (const fighter of world.fighters) {
    for (const coordinate of fighter.x) float(coordinate);
    for (const coordinate of fighter.prev) float(coordinate);
    for (const char of String(fighter.state)) hash.word(char.charCodeAt(0));
    float(fighter.health ?? 0);
  }
  hash.word(world.events.length);
  hash.word(draws);
  return hash.value;
}

async function child(caseKey, steps, mathSeed, twice) {
  const probe = instrument(mathSeed);
  const cases = await import('./simcases.js');
  const { thinkAll } = await import('../src/ai.js');
  const { step } = await import('../src/physics.js');
  const runOnce = () => {
    probe.phase.now = 'build';
    const world = CASES[caseKey].make(cases);
    // The world's seeded random, counted (createFighter's own copies draw on the same generator's state through it).
    const random = world.random;
    let draws = 0;
    world.random = () => {
      draws += 1;
      return random();
    };
    probe.phase.now = 'run';
    const hashes = [];
    const started = probe.realNow();
    probe.counting.on = true;
    for (let index = 0; index < steps; index += 1) {
      thinkAll(world, 1 / 60);
      step(world, 1 / 60);
      hashes.push(hashWorld(world, draws).toString(16).padStart(8, '0'));
    }
    probe.counting.on = false;
    const down = world.fighters.filter((fighter) => fighter.state !== 'up').length;
    return { hashes, ms: Math.round(probe.realNow() - started), men: world.fighters.length, down, events: world.events.length, draws };
  };
  const first = runOnce();
  const second = twice ? runOnce() : null;
  process.send({ first, second, sites: probe.sites });
}

const firstApart = (a, b) => {
  const length = Math.min(a.length, b.length);
  for (let index = 0; index < length; index += 1) if (a[index] !== b[index]) return index + 1;
  return a.length === b.length ? null : length + 1;
};

const spawn = (caseKey, steps, mathSeed, twice) => new Promise((resolve, reject) => {
  const run = fork(HERE, ['run', caseKey, String(steps), String(mathSeed), twice ? 'twice' : 'once']);
  run.on('message', resolve);
  run.on('error', reject);
  run.on('exit', (code) => code && reject(new Error(`${caseKey}: child exited ${code}`)));
});

async function main() {
  const args = process.argv.slice(2);
  const stepsAt = args.indexOf('--steps');
  const jsonAt = args.indexOf('--json');
  const valueAt = new Set([stepsAt, jsonAt].filter((at) => at >= 0).map((at) => at + 1));
  const named = args.find((arg, index) => !arg.startsWith('--') && !valueAt.has(index));
  const keys = named ? named.split(',') : Object.keys(CASES);
  const report = {};
  // Each case's three processes at once; the cases one after another (a 500-man world is a few hundred MB a process).
  for (const key of keys) {
    const steps = stepsAt >= 0 ? Number(args[stepsAt + 1]) : CASES[key].steps;
    const [a, b, c] = await Promise.all([spawn(key, steps, 1, true), spawn(key, steps, 1, false), spawn(key, steps, 99, false)]);
    const sitesRun = Object.entries(a.sites.run).sort((x, y) => y[1] - x[1]);
    const sitesBuild = Object.entries(a.sites.build).sort((x, y) => y[1] - x[1]);
    report[key] = {
      steps,
      men: a.first.men,
      down: a.first.down,
      events: a.first.events,
      worldDraws: a.first.draws,
      msPerStep: +(a.first.ms / steps).toFixed(2),
      sameSeedFreshProcess: firstApart(a.first.hashes, b.first.hashes) ?? 'identical',
      otherMathRandom: firstApart(a.first.hashes, c.first.hashes) ?? 'identical',
      secondRunSameProcess: firstApart(a.first.hashes, a.second.hashes) ?? 'identical',
      finalHash: a.first.hashes.at(-1),
      outsideCallsWhileStepping: Object.fromEntries(sitesRun.slice(0, 30)),
      outsideCallsWhileBuilding: Object.fromEntries(sitesBuild.slice(0, 30)),
    };
    const r = report[key];
    console.log(`${key.padEnd(10)} ${String(r.men).padStart(4)} men ${steps} steps ${r.msPerStep} ms/step down ${r.down} | fresh-process ${r.sameSeedFreshProcess} | other Math.random ${r.otherMathRandom} | same-process rerun ${r.secondRunSameProcess} | stepping: ${sitesRun.reduce((sum, [, n]) => sum + n, 0)} outside calls, building: ${sitesBuild.reduce((sum, [, n]) => sum + n, 0)}`);
    for (const [site, n] of sitesRun.slice(0, 8)) console.log(`    run   ${String(n).padStart(7)} ${site}`);
    for (const [site, n] of sitesBuild.slice(0, 8)) console.log(`    build ${String(n).padStart(7)} ${site}`);
  }
  if (jsonAt >= 0) writeFileSync(args[jsonAt + 1], JSON.stringify(report, null, 2));
}

if (process.argv[2] === 'run') child(process.argv[3], Number(process.argv[4]), Number(process.argv[5]), process.argv[6] === 'twice');
else if (process.argv[1] === HERE) main();
