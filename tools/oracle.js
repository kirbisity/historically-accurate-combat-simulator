// Port groundwork (a native port later, the user's call, 2026-11-26): the behaviour oracle. A fixed corpus of reference fights,
// each fought over several seeds, read as distributions rather than hashes: who wins and how fast, the wounds, disarms,
// deflects and half-sword entries of a weapon x armour duel matrix; the staff, zweihander and long sword's reference cases from
// the tests; the battles' casualties (Sarhu 600 and Wokou 400 with the table on, as the crowd benchmark fought them; a 60-man
// Sarhu in full physics). Every metric carries its count and its spread from seed to seed, so another implementation (a port
// in another engine and language) that fights the same corpus can be judged by tools/oraclecheck.js against what this one does.
// The schema is docs/oracle.md. Not part of the game.
//
// Usage: node tools/oracle.js [--out oracle/baseline.json] [--workers 8] [--seeds 8] [--seed-base 1] [--only duel,reference,battle]
//        [--battle-seeds 3] [--quick] [--rebuild FILE] [--perturb 'module.js:TABLE.key*factor'] [--reverse]
//        (--quick: 3 seeds, the battles 2 seeds and 20 s: a smoke run, not a baseline. --rebuild: the metrics derived again from
//        the fights kept in FILE, nothing fought: after a change to how a fight is read into metrics, not to what is read.
//        --perturb: one number of a sim table scaled first, a control run to measure what the oracle can tell apart.)
// A worker is `node tools/oracle.js worker` (forked for one job, which comes by message).

import { fork } from 'node:child_process';
import { execSync } from 'node:child_process';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = fileURLToPath(import.meta.url);
const ROOT = resolve(dirname(HERE), '..');

// ---- The corpus -------------------------------------------------------------------------------------------------------------

// The weapon x armour matrix: in each cell both men are one reference body (the roster's knight, 178 cm, trained) in the same
// armour; red's weapon is the row's, blue's the reference long sword. So a row reads how a weapon fares against a sword as the
// armour on both grows, everything else held the same. The weapon's man takes red on odd seeds and blue on even ones (the
// corners start on either side of the floor).
export const MATRIX = {
  body: 'plate',
  foe: 'longsword',
  weapons: ['longsword', 'katana', 'warhammer', 'spear', 'zweihander', 'staff'],
  armours: ['commoner', 'footman', 'samurai', 'knight'],
  seconds: 60,
};

// Duels of roster warriors from the tests' reference cases (test/zweihander.test.js, test/gaps.test.js, the half-sword tests):
// the same record and blow counts as the matrix, from both corners.
export const PAIRS = [
  ['doppelsoeldner', 'plate'],
  ['doppelsoeldner', 'halberdier'],
  ['doppelsoeldner', 'footSpear'],
  ['plate', 'plate'],
  ['tosei', 'plate'],
  ['hammer', 'plate'],
  ['shaolin', 'plate'],
];
const PAIR_SECONDS = 90;

// The staff's set piece (test/staffflex.test.js): the monk's end-grip smash at a knight's head from 1.5 and 2.1 m, the knight
// standing to it or parrying (thinking), one throw a fight.
export const STAFF_SMASH = { monk: 'shaolin', knight: 'plate', gaps: [1.5, 2.1], parrying: [false, true], seconds: 1.4 };

// Battles: casualties per side at 10, 20 and 30 s. Sarhu 600 and Wokou 400 with the table on (src/tableduel.js, as
// tools/tableduel.js and the crowd benchmark fight them: the last red man played); Sarhu at 60 in full physics.
export const BATTLES = [
  { key: 'sarhu600', battle: 'sarhu', men: 600, table: true, seconds: 30 },
  { key: 'wokou400', battle: 'wokou', men: 400, table: true, seconds: 30 },
  { key: 'sarhu60', battle: 'sarhu', men: 60, table: false, seconds: 30 },
];

// ---- Reading a fight ----------------------------------------------------------------------------------------------------------

// What a landed blow did, by the words of its effects (physics.js, maiming.js): a blow counts once in each kind it shows.
export const WOUND_KINDS = {
  glance: /glance/,
  cut: /\bcut\b|cut opened|cut off|severed|the bone cut/,
  stab: /stabbed|run through|through the (?:heart|brain|chest|head|arm)|driven through/,
  gap: /into a gap in the armour/,
  fracture: /fracture|broken|shattered/,
  concussion: /knock|dazed|stunned|reels|knockdown/,
};

/** The record of one fight from `me`'s side: result, end, and what each man did. */
function readBout(world, me, foe, boutWinner) {
  const winner = boutWinner(world);
  const mine = world.fighters[me];
  const result = winner ? (winner === mine.corner ? 'win' : 'loss') : 'draw';
  const wounds = Object.fromEntries(Object.keys(WOUND_KINDS).map((kind) => [kind, 0]));
  let landed = 0;
  let landedOn = 0;
  const count = { disarmedMe: 0, disarmedFoe: 0, deflectsBy: 0, halfSwordMe: 0, halfSwordFoe: 0, severed: 0, weaponBroke: 0 };
  let ended = null;
  for (const event of world.events) {
    if (event.kind === 'landed' && event.target && event.punch !== 'execute') {
      if (event.attacker === me && event.defender === foe) {
        landed += 1;
        const text = (event.effects ?? []).join('; ');
        for (const [kind, pattern] of Object.entries(WOUND_KINDS)) if (pattern.test(text)) wounds[kind] += 1;
      } else if (event.attacker === foe && event.defender === me) landedOn += 1;
    }
    if (event.kind === 'disarmed') count[event.fighter === me ? 'disarmedMe' : 'disarmedFoe'] += 1;
    // (A deflect event is the defender's: `fighter` turned `attacker`'s blow.)
    if (event.kind === 'deflect' && event.fighter === me) count.deflectsBy += 1;
    if (event.kind === 'halfSword') count[event.fighter === me ? 'halfSwordMe' : 'halfSwordFoe'] += 1;
    if (event.kind === 'severed' && event.fighter === foe) count.severed += 1;
    if (event.kind === 'weaponBroke' && event.fighter === me) count.weaponBroke += 1;
    if (!ended && (event.kind === 'killed' || event.kind === 'knockout' || event.kind === 'bledOut')) ended = { kind: event.kind, time: event.time };
  }
  return { result, seconds: winner ? world.time : null, end: winner ? (ended?.kind ?? 'other') : 'none', landed, landedOn, wounds, ...count };
}

// ---- The jobs (one fight each) ---------------------------------------------------------------------------------------------

// A perturbation (--perturb 'weapons.js:PUNCTURE.joules*0.7'): one number of an exported table scaled before any fight, so
// that the oracle's power to tell a changed sim from this one can be measured (a control, never a baseline).
let perturbed = null;
async function perturb(spec) {
  if (!spec || perturbed === spec) return;
  const [, file, path, factor] = spec.match(/^([\w/.-]+\.js):([\w.$]+)\*([-\d.e]+)$/) ?? [];
  if (!file) throw new Error(`--perturb ${spec}: expected module.js:TABLE.key.key*factor`);
  const keys = path.split('.');
  let holder = await import(`../src/${file}`);
  for (const key of keys.slice(0, -1)) holder = holder[key];
  const last = keys.at(-1);
  if (typeof holder?.[last] !== 'number') throw new Error(`--perturb ${spec}: not a number`);
  holder[last] *= Number(factor);
  perturbed = spec;
}

export async function runJob(job) {
  await perturb(job.perturb);
  const { thinkAll } = await import('../src/ai.js');
  const physics = await import('../src/physics.js');
  const { advance, boutWinner, placeFighter, throwPunch, step } = physics;
  const cases = await import('./simcases.js');
  const { TABLE_DUEL } = await import('../src/tableduel.js');
  // TABLE_DUEL.enabled is module state: only a battle job turns it on (runJob called twice in one process, as a test may, must
  // not carry a battle's switch into a duel: it did once, when one worker fought many jobs).
  TABLE_DUEL.enabled = false;
  const fightOut = (world, seconds) => {
    for (let second = 0; second < seconds && !boutWinner(world); second += 1) advance(world, 1, (current, dt) => thinkAll(current, dt));
  };
  if (job.type === 'matrix') {
    const mine = { style: job.weapon, outfit: job.armour };
    const theirs = { style: MATRIX.foe, outfit: job.armour };
    const meRed = job.seed % 2 === 1;
    const world = cases.kitDuel(meRed ? mine : theirs, meRed ? theirs : mine, job.seed, MATRIX.body);
    fightOut(world, MATRIX.seconds);
    return readBout(world, meRed ? 0 : 1, meRed ? 1 : 0, boutWinner);
  }
  if (job.type === 'pair') {
    const meRed = job.seed % 2 === 1;
    const world = meRed ? cases.duel(job.a, job.b, job.seed) : cases.duel(job.b, job.a, job.seed);
    fightOut(world, PAIR_SECONDS);
    return readBout(world, meRed ? 0 : 1, meRed ? 1 : 0, boutWinner);
  }
  if (job.type === 'staff') {
    // As test/staffflex.test.js sets it: the two placed `gap` apart, settled 0.3 s, the smash thrown, 1.4 s watched.
    const world = cases.duel(STAFF_SMASH.monk, STAFF_SMASH.knight, job.seed);
    const [monk, knight] = world.fighters;
    placeFighter(monk, -job.gap / 2, 0);
    placeFighter(knight, job.gap / 2, 0);
    const think = (current, dt) => { if (job.parrying) thinkAll(current, dt, new Set([monk.id])); };
    advance(world, 0.3, think);
    monk.cooldown = 9;
    if (!job.parrying) knight.cooldown = 9;
    const thrown = Boolean(throwPunch(world, monk, 'staffSmash', 'head'));
    const from = world.events.length;
    advance(world, STAFF_SMASH.seconds, think);
    let landed = 0;
    let speed = 0;
    let clash = 0;
    let broke = 0;
    for (const event of world.events.slice(from)) {
      if (event.kind === 'landed' && event.attacker === monk.id && event.punch === 'staffSmash') {
        landed = 1;
        speed = Math.max(speed, event.speed);
      }
      if (event.kind === 'clash' && (event.fighter === monk.id || event.other === monk.id)) clash = Math.max(clash, event.energy ?? 0);
      if (event.kind === 'weaponBroke' && event.fighter === monk.id) broke = 1;
    }
    return { thrown: thrown ? 1 : 0, landed, speed: landed ? speed : null, clash, broke };
  }
  if (job.type === 'battle') {
    const spec = BATTLES.find((battle) => battle.key === job.key);
    TABLE_DUEL.enabled = spec.table;
    const world = cases.scaledBattle(spec.battle, spec.men, job.seed);
    const down = (corner) => world.fighters.filter((fighter) => fighter.corner === corner && fighter.state !== 'up').length;
    const curve = [];
    const steps = Math.round(job.seconds * 60);
    for (let index = 1; index <= steps; index += 1) {
      thinkAll(world, 1 / 60);
      step(world, 1 / 60);
      if (index % 600 === 0) curve.push([down('red'), down('blue')]);
      if (boutWinner(world)) break;
    }
    while (curve.length < Math.round(job.seconds / 10)) curve.push([down('red'), down('blue')]);
    return { curve, winner: boutWinner(world) ?? null };
  }
  throw new Error(`unknown job ${job.type}`);
}

function jobsFor({ seeds, seedBase, only, battleSeeds, battleSeconds }) {
  const jobs = [];
  const seedList = (count) => Array.from({ length: count }, (_, index) => seedBase + index);
  if (only.has('duel')) {
    for (const weapon of MATRIX.weapons) for (const armour of MATRIX.armours) for (const seed of seedList(seeds)) jobs.push({ type: 'matrix', weapon, armour, seed, cost: armour === 'knight' ? 3 : 1.5 });
    for (const [a, b] of PAIRS) for (const seed of seedList(seeds)) jobs.push({ type: 'pair', a, b, seed, cost: 3 });
  }
  if (only.has('reference')) {
    for (const parrying of STAFF_SMASH.parrying) for (const gap of STAFF_SMASH.gaps) for (const seed of seedList(Math.max(3, Math.ceil(seeds / 2)))) jobs.push({ type: 'staff', parrying, gap, seed, cost: 0.2 });
  }
  if (only.has('battle')) {
    for (const battle of BATTLES) for (const seed of seedList(battleSeeds)) jobs.push({ type: 'battle', key: battle.key, seed, seconds: battleSeconds ?? battle.seconds, cost: (battle.men / 60) * 20 });
  }
  return jobs;
}

// ---- Metrics ---------------------------------------------------------------------------------------------------------------

/** A rate metric (each sample 0 or 1). */
const rate = (samples, describes) => {
  const n = samples.length;
  const value = n ? samples.reduce((sum, x) => sum + x, 0) / n : null;
  return { kind: 'rate', value: round(value), n, describes };
};

/** A mean metric with its sample spread (sd, from seed to seed). Samples that are null (not applicable) are left out. */
const mean = (raw, describes, unit) => {
  const samples = raw.filter((x) => x !== null && x !== undefined && Number.isFinite(x));
  const n = samples.length;
  if (!n) return { kind: 'mean', value: null, n: 0, sd: null, unit, describes };
  const value = samples.reduce((sum, x) => sum + x, 0) / n;
  const sd = n > 1 ? Math.sqrt(samples.reduce((sum, x) => sum + (x - value) ** 2, 0) / (n - 1)) : null;
  return { kind: 'mean', value: round(value), n, sd: round(sd), unit, describes };
};

const round = (x) => (x === null || x === undefined ? x : +x.toPrecision(6));

function boutMetrics(prefix, bouts, who) {
  const metrics = {};
  const put = (name, metric) => { metrics[`${prefix}/${name}`] = metric; };
  put('win', rate(bouts.map((b) => (b.result === 'win' ? 1 : 0)), `${who} wins`));
  put('draw', rate(bouts.map((b) => (b.result === 'draw' ? 1 : 0)), 'neither man is out at the time limit'));
  put('secondsToDecide', mean(bouts.map((b) => b.seconds), 'world time when the bout is decided (decided bouts only)', 's'));
  for (const end of ['killed', 'knockout', 'bledOut']) put(`end/${end}`, rate(bouts.map((b) => (b.end === end ? 1 : 0)), `the first man out goes by a '${end}' event`));
  put('landed', mean(bouts.map((b) => b.landed), `blows ${who} lands on the foe (not a finisher's)`, 'per bout'));
  put('landedOn', mean(bouts.map((b) => b.landedOn), `blows the foe lands on ${who}`, 'per bout'));
  for (const kind of Object.keys(WOUND_KINDS)) put(`wounds/${kind}`, mean(bouts.map((b) => b.wounds[kind]), `${who}'s landed blows whose effects read as '${kind}' (WOUND_KINDS)`, 'per bout'));
  put('disarmedSelf', mean(bouts.map((b) => b.disarmedMe), `${who} loses his weapon`, 'per bout'));
  put('disarmedFoe', mean(bouts.map((b) => b.disarmedFoe), 'the foe loses his weapon', 'per bout'));
  put('deflects', mean(bouts.map((b) => b.deflectsBy), `blows ${who} deflects`, 'per bout'));
  put('halfSwordSelf', mean(bouts.map((b) => b.halfSwordMe), `${who} goes to the half-sword`, 'per bout'));
  put('halfSwordFoe', mean(bouts.map((b) => b.halfSwordFoe), 'the foe goes to the half-sword', 'per bout'));
  put('severed', mean(bouts.map((b) => b.severed), 'limbs of the foe cut off', 'per bout'));
  put('weaponBroke', mean(bouts.map((b) => b.weaponBroke), `${who}'s weapon breaks`, 'per bout'));
  return metrics;
}

function metricsFrom(results) {
  const metrics = {};
  const of = (predicate) => results.filter(({ job }) => predicate(job)).map(({ out }) => out);
  for (const weapon of MATRIX.weapons) for (const armour of MATRIX.armours) {
    const bouts = of((job) => job.type === 'matrix' && job.weapon === weapon && job.armour === armour);
    if (bouts.length) Object.assign(metrics, boutMetrics(`duel/${weapon}/${armour}`, bouts, `the ${weapon}'s man`));
  }
  // The matrix pooled by row and by column: a cell's eight bouts tell a rate only to about a fifth either way, a row's or a
  // column's three or four times as many bouts to half that (where a port that drifts a little shows first).
  for (const weapon of MATRIX.weapons) {
    const bouts = of((job) => job.type === 'matrix' && job.weapon === weapon);
    if (bouts.length) Object.assign(metrics, boutMetrics(`duel/${weapon}/any`, bouts, `the ${weapon}'s man`));
  }
  for (const armour of MATRIX.armours) {
    const bouts = of((job) => job.type === 'matrix' && job.armour === armour);
    if (bouts.length) Object.assign(metrics, boutMetrics(`duel/any/${armour}`, bouts, 'the row weapon\'s man'));
  }
  for (const [a, b] of PAIRS) {
    const bouts = of((job) => job.type === 'pair' && job.a === a && job.b === b);
    if (bouts.length) Object.assign(metrics, boutMetrics(`pair/${a}/${b}`, bouts, a));
  }
  for (const parrying of STAFF_SMASH.parrying) for (const gap of STAFF_SMASH.gaps) {
    const runs = of((job) => job.type === 'staff' && job.parrying === parrying && job.gap === gap);
    if (!runs.length) continue;
    const prefix = `staff/smash/${parrying ? 'parrying' : 'standing'}/${gap}m`;
    metrics[`${prefix}/thrown`] = rate(runs.map((r) => r.thrown), 'the smash is thrown (throwPunch takes it)');
    metrics[`${prefix}/landed`] = rate(runs.map((r) => r.landed), 'the smash lands');
    metrics[`${prefix}/speed`] = mean(runs.map((r) => r.speed), 'speed of the landed smash at the point of contact', 'm/s');
    metrics[`${prefix}/clashJoules`] = mean(runs.map((r) => r.clash), 'hardest clash of the staff with the sword', 'J');
    metrics[`${prefix}/broke`] = rate(runs.map((r) => r.broke), 'the staff breaks');
  }
  for (const battle of BATTLES) {
    const runs = of((job) => job.type === 'battle' && job.key === battle.key);
    if (!runs.length) continue;
    runs[0].curve.forEach((_, at) => {
      ['red', 'blue'].forEach((corner, side) => {
        metrics[`battle/${battle.key}/down/${corner}/${(at + 1) * 10}s`] = mean(runs.map((r) => r.curve[at][side]), `${corner}'s men not up (down, out, crawling, dead) at ${(at + 1) * 10} s`, 'men');
      });
    });
  }
  return metrics;
}

// ---- Tolerances ------------------------------------------------------------------------------------------------------------

// A metric's tolerance against a candidate of the same count: Z standard errors of the difference of two independent estimates,
// each with the spread seen here from seed to seed. A rate's spread is the binomial's at the rate smoothed by one success and one
// failure (so a rate of 0 or 1 over 8 bouts still has room); a mean's is its sample sd, never under FLOOR of the value nor
// under FLOOR_ABS (the battles have three seeds: their sd alone is a rough guess). tools/oraclecheck.js uses the candidate's own
// count and spread where it gives them.
export const TOLERANCE = { z: 3, floor: 0.1, floorAbs: { rate: 0.05, mean: 0.25 } };

export function spreadOf(metric) {
  if (metric.kind === 'rate') {
    const p = ((metric.value ?? 0) * metric.n + 1) / (metric.n + 2);
    return Math.sqrt(p * (1 - p));
  }
  const sd = metric.sd ?? 0;
  return Math.max(sd, TOLERANCE.floor * Math.abs(metric.value ?? 0), TOLERANCE.floorAbs.mean);
}

export function toleranceOf(base, candidate = base, z = TOLERANCE.z) {
  if (!base.n || !candidate.n) return null;
  const error = Math.sqrt(spreadOf(base) ** 2 / base.n + spreadOf(candidate) ** 2 / candidate.n);
  return Math.max(z * error, TOLERANCE.floorAbs[base.kind] ?? 0);
}

// ---- Running ---------------------------------------------------------------------------------------------------------------

function option(args, name, fallback) {
  const at = args.indexOf(name);
  return at >= 0 ? args[at + 1] : fallback;
}

async function main() {
  const args = process.argv.slice(2);
  const quick = args.includes('--quick');
  const seeds = Number(option(args, '--seeds', quick ? 3 : 8));
  const seedBase = Number(option(args, '--seed-base', 1));
  const workers = Number(option(args, '--workers', 8));
  const out = resolve(ROOT, option(args, '--out', quick ? 'oracle/quick.json' : 'oracle/baseline.json'));
  const only = new Set(option(args, '--only', 'duel,reference,battle').split(','));
  const battleSeeds = Number(option(args, '--battle-seeds', quick ? 2 : 3));
  const battleSeconds = quick ? 20 : undefined;
  const rebuild = option(args, '--rebuild', null);
  const kept = rebuild ? JSON.parse(readFileSync(resolve(rebuild), 'utf8')) : null;
  const perturbation = option(args, '--perturb', null);
  const jobs = kept ? kept.fights.map(({ job }) => job) : jobsFor({ seeds, seedBase, only, battleSeeds, battleSeconds }).sort((a, b) => b.cost - a.cost).map((job) => (perturbation ? { ...job, perturb: perturbation } : job));
  // (--reverse: the jobs in the other order, so each worker fights other jobs before each: a fight must not depend on that.)
  if (args.includes('--reverse')) jobs.reverse();
  const started = Date.now();
  const results = kept ? kept.fights.map(({ job, out: record }) => ({ job, out: record })) : [];
  let next = kept ? jobs.length : 0;
  // Each fight in a fresh process: a fight must not depend on what its process fought before, and the sim keeps state between
  // worlds in modules (TABLE_DUEL.enabled; physics/polegrip.js poleGripSpec keeps the first exact grip of each centimetre's
  // key, so a staff's grip depends on who held a staff first). A process costs about 0.2 s to load.
  const fightOne = (index) => new Promise((done, fail) => {
    const worker = fork(HERE, ['worker']);
    worker.on('message', ({ out: result, error }) => {
      if (error) return fail(new Error(`${JSON.stringify(jobs[index])}: ${error}`));
      results.push({ job: jobs[index], out: result });
      if (results.length % 25 === 0) process.stderr.write(`${results.length}/${jobs.length} jobs, ${((Date.now() - started) / 1000).toFixed(0)} s\n`);
    });
    worker.on('exit', (code) => (code ? fail(new Error(`${JSON.stringify(jobs[index])}: worker exited ${code}`)) : done()));
    worker.on('error', fail);
    worker.send({ job: jobs[index] });
  });
  if (!kept) {
    await Promise.all(Array.from({ length: Math.min(workers, jobs.length) }, async () => {
      while (next < jobs.length) {
        const index = next;
        next += 1;
        await fightOne(index);
      }
    }));
  }
  const metrics = metricsFrom(results);
  for (const metric of Object.values(metrics)) metric.tolerance = round(toleranceOf(metric));
  let commit = null;
  let srcTree = null;
  try {
    commit = execSync('git rev-parse --short HEAD', { cwd: ROOT }).toString().trim();
    // (The sim's own tree: two commits that differ only outside src/ fight alike.)
    srcTree = execSync('git rev-parse --short HEAD:src', { cwd: ROOT }).toString().trim();
  } catch { /* not a checkout */ }
  const baseline = {
    schema: 'hacs-oracle/1',
    producer: kept ? { ...kept.producer, rebuilt: new Date().toISOString(), rebuiltAt: commit } : { engine: 'hacs-js', commit, srcTree, ...(perturbation ? { perturbed: perturbation } : {}), node: process.version, date: new Date().toISOString(), seeds, seedBase, battleSeeds, quick, jobs: jobs.length, wallSeconds: Math.round((Date.now() - started) / 1000) },
    tolerance: TOLERANCE,
    corpus: { matrix: MATRIX, pairs: PAIRS, pairSeconds: PAIR_SECONDS, staffSmash: STAFF_SMASH, battles: BATTLES, woundKinds: Object.fromEntries(Object.entries(WOUND_KINDS).map(([kind, pattern]) => [kind, pattern.source])) },
    metrics,
    // Every fight's own record (the job and what was read off it): the distributions behind the metrics, to compare in other
    // ways than means, or to derive new metrics from without fighting again (--rebuild).
    fights: results.map(({ job: { cost, ...job }, out: record }) => ({ job, out: record })),
  };
  mkdirSync(dirname(out), { recursive: true });
  writeFileSync(out, `${JSON.stringify(baseline, null, 1)}\n`);
  console.log(`${Object.keys(metrics).length} metrics from ${jobs.length} fights${kept ? ' (rebuilt)' : ` in ${baseline.producer.wallSeconds} s`} -> ${out}`);
}

if (process.argv[2] === 'worker') {
  // One job, then gone (see fightOne).
  process.once('message', async ({ job }) => {
    try {
      process.send({ out: await runJob(job) }, () => process.exit(0));
    } catch (error) {
      process.send({ error: String(error?.stack ?? error) }, () => process.exit(0));
    }
  });
} else if (process.argv[1] === HERE) main();
