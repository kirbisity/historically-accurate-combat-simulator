// Large battles (KB spec 2026-11-21-large-battles): Sarhu's armies scaled to N men, headless, the AI (thinkAll) and the physics
// (step) timed apart, and the heap the world takes. Not part of the game.
// Usage: node --expose-gc tools/crowdbench.js <N> [seconds=20] [--no-ai] [--perceiver]   (--perceiver: the first man is the one played)

const [nArg, secArg = '20', ...flags] = process.argv.slice(2);
const N = Number(nArg);
const imp = (p) => import(new URL(`../src/${p}`, import.meta.url).href);
const { normaliseInputs } = await imp('body.js');
const { thinkAll } = await imp('ai.js');
const { createWorld, seededRandom } = await imp('physics.js');
const physics = await imp('physics.js');
const { battleOf } = await imp('scenarios.js');

const mem = () => { global.gc?.(); return process.memoryUsage().heapUsed / 1e6; };
const before = mem();

const level = battleOf('sarhu');
const random = seededRandom(1);
const sides = level.cast(random);
const per = Math.ceil(N / 2);
const grow = (list) => Array.from({ length: per }, (_, i) => list[i % list.length]);
const entries = [...grow(sides.red).map((inputs) => ({ inputs, corner: 'red' })), ...grow(sides.blue).map((inputs) => ({ inputs, corner: 'blue' }))]
  .map(({ inputs, corner }) => ({ inputs: normaliseInputs(structuredClone(inputs)), corner }));
// Wider floor for more men: the line keeps its depth, gets longer.
const scale = Math.max(1, Math.sqrt(N / 60));
const arena = { ...level.arena, halfX: level.arena.halfX * scale, halfZ: level.arena.halfZ * scale };
const perRow = (f) => Math.round((f.perRow ?? 8) * scale);
const formation = Object.fromEntries(['red', 'blue'].map((c) => [c, { ...level.formation[c], perRow: perRow(level.formation[c] ?? {}) }]));
const t0 = performance.now();
const world = createWorld(entries, { seed: 1, arena, formation, rules: level.rules, place: null });
const buildMs = performance.now() - t0;
const after = mem();
if (flags.includes('--perceiver')) world.perceiver = world.fighters[0];

const noAi = flags.includes('--no-ai');
let thinkMs = 0, stepMs = 0, steps = 0;
const dt = 1 / 60;
const seconds = Number(secArg);
const samples = [];
const run0 = performance.now();
while (steps * dt < seconds) {
  const a = performance.now();
  if (!noAi) thinkAll(world, dt);
  const b = performance.now();
  physics.step ? physics.step(world, dt) : physics.advance(world, dt);
  const c = performance.now();
  thinkMs += b - a; stepMs += c - b; steps += 1;
  if (steps % 60 === 0) samples.push({ t: steps * dt, up: world.fighters.filter((f) => f.state === 'up').length });
}
const wall = performance.now() - run0;
const peak = process.memoryUsage().heapUsed / 1e6;
console.log(JSON.stringify({
  N: world.fighters.length, seconds, noAi, perceiver: !!world.perceiver,
  buildMs: Math.round(buildMs),
  thinkMsPerStep: +(thinkMs / steps).toFixed(2), stepMsPerStep: +(stepMs / steps).toFixed(2),
  totalMsPerStep: +(wall / steps).toFixed(2), realtimeFactor: +((seconds * 1000) / wall).toFixed(2),
  heapWorldMB: +(after - before).toFixed(1), perManKB: +(((after - before) * 1000) / world.fighters.length).toFixed(0), heapPeakMB: +peak.toFixed(0),
  upAtEnd: samples.at(-1)?.up,
}));
