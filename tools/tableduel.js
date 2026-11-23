// Large battles (KB spec 2026-11-21-large-battles): the table's exchanges (src/tableduel.js) against the physics. One battle
// scaled to N men, fought over seeds with the table off and on, red's last man played (the exchanges far from him go to the
// table): each side's men down at intervals, who won, what a step cost, how many exchanges the table decided. The table is right
// when the casualties come out as the physics' do; TABLE_DUEL.meanSeconds is the one number fitted to it. Not part of the game.
// Usage: node tools/tableduel.js [battle=sarhu] [N=200] [seconds=60] [seeds=3] [meanSeconds] [modes=off,on] [sharpness] [first seed=1]
// (Time a step with one mode a run: the first run in a process pays for the code being compiled.)

import { normaliseInputs } from '../src/body.js';
import { thinkAll } from '../src/ai.js';
import { boutWinner, createWorld, seededRandom, step } from '../src/physics.js';
import { battleOf } from '../src/scenarios.js';
import { TABLE_DUEL } from '../src/tableduel.js';

const [key = 'sarhu', nArg = '200', secArg = '60', seedArg = '3', meanArg, modeArg = 'off,on', sharpArg, firstArg = '1'] = process.argv.slice(2);
if (sharpArg && sharpArg !== '-') TABLE_DUEL.sharpness = Number(sharpArg);
const N = Number(nArg);
if (meanArg && meanArg !== '-') TABLE_DUEL.meanSeconds = Number(meanArg);

/** The battle's own cast, each side grown to half of N (its men repeated in order), on a floor and in lines grown to match. */
export function scaledBattle(battleKey, men, seed) {
  const level = battleOf(battleKey);
  const sides = level.cast(seededRandom(seed));
  const per = Math.ceil(men / 2);
  const grow = (list) => Array.from({ length: per }, (_, index) => list[index % list.length]);
  const entries = [...grow(sides.red).map((inputs) => ({ inputs, corner: 'red' })), ...grow(sides.blue).map((inputs) => ({ inputs, corner: 'blue' }))]
    .map(({ inputs, corner }) => ({ inputs: normaliseInputs(structuredClone(inputs)), corner }));
  const scale = Math.max(1, Math.sqrt(men / 60));
  const formation = Object.fromEntries(['red', 'blue'].map((corner) => [corner, { ...level.formation[corner], perRow: Math.round((level.formation[corner]?.perRow ?? 8) * scale) }]));
  return createWorld(entries, { seed, arena: { ...level.arena, halfX: level.arena.halfX * scale, halfZ: level.arena.halfZ * scale }, formation, rules: level.rules, place: level.scene, climate: level.climate });
}

function fight(seed, table) {
  TABLE_DUEL.enabled = table;
  const world = scaledBattle(key, N, seed);
  // The man played: the last of red's men, at the back (so he lives, and the fight goes on being perceived from him).
  world.perceiver = world.fighters.filter((fighter) => fighter.corner === 'red').at(-1).id;
  const down = (corner) => world.fighters.filter((fighter) => fighter.corner === corner && fighter.state !== 'up').length;
  const curve = [];
  let decided = 0;
  let ms = 0;
  const steps = Math.round(Number(secArg) * 60);
  for (let index = 1; index <= steps; index += 1) {
    const before = world.fighters.filter((fighter) => fighter.tableDuel).length;
    const started = performance.now();
    thinkAll(world, 1 / 60);
    step(world, 1 / 60);
    ms += performance.now() - started;
    decided += Math.max(0, before - world.fighters.filter((fighter) => fighter.tableDuel).length);
    if (index % 600 === 0) curve.push([down('red'), down('blue')]);
    if (boutWinner(world)) break;
  }
  return { curve, winner: boutWinner(world) ?? null, msPerStep: +(ms / steps).toFixed(1), atTable: world.fighters.filter((fighter) => fighter.tableDuel).length, decided, tableDowned: world.tableDowned ?? {} };
}

if (process.argv[1]?.endsWith('tableduel.js')) {
  const seeds = Number(seedArg);
  for (const table of modeArg.split(',').map((mode) => mode === 'on')) {
    const runs = [];
    for (let seed = Number(firstArg); seed < Number(firstArg) + seeds; seed += 1) {
      const run = fight(seed, table);
      runs.push(run);
      console.log(JSON.stringify({ table, seed, ...run }));
    }
    const mean = runs[0].curve.map((_, at) => [0, 1].map((side) => +(runs.reduce((sum, run) => sum + (run.curve[at]?.[side] ?? run.curve.at(-1)[side]), 0) / runs.length).toFixed(1)));
    console.log(`${table ? 'table' : 'physics'}: men down (red, blue) every 10 s ${JSON.stringify(mean)}; ms a step ${(runs.reduce((sum, run) => sum + run.msPerStep, 0) / runs.length).toFixed(1)}`);
  }
}
