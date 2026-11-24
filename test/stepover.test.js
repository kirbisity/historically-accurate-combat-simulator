// Stepping and leaping over a man on the floor (physics/stepover.js): a body he sees in his way is stepped over at a walk and
// leapt at a run; one he cannot see (backing onto it) trips him as before; a burdened man clears less and lands harder; a
// horse sets its hooves clear of a man lying still.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { P, PRESETS, normaliseInputs } from '../src/body.js';
import { advance, createWorld, jumpNow, knockOut, limbShares, placeFighter } from '../src/physics.js';
import { jumpLanding } from '../src/physics/jump.js';
import { crossingsAhead, groundAttention, leapOver, stepReach, STEPOVER } from '../src/physics/stepover.js';
import { placeMounted } from '../src/physics/mounted.js';

const man = (key) => normaliseInputs(structuredClone(PRESETS[key]));

/** A man of `walker` at x = -6 facing +x, and `bodies` men of `body` lying out at x = 0, 4, ... turned `turn` rad where they fell. */
function lane(seed, { walker = 'contender', body = 'contender', bodies = 1, turn = 0.4 } = {}) {
  const world = createWorld([{ inputs: man(walker), corner: 'red' }, ...Array.from({ length: bodies }, () => ({ inputs: man(body), corner: 'red' }))], { seed, arena: { halfX: 30, halfZ: 12 } });
  const walkerMan = world.fighters[0];
  world.fighters.slice(1).forEach((lying, index) => {
    placeFighter(lying, index * 4, 0);
    knockOut(world, lying, { effects: [] }, 'test');
  });
  placeFighter(walkerMan, -20, 0);
  advance(world, 3);
  for (const lying of world.fighters.slice(1)) {
    const [cos, sin] = [Math.cos(turn + seed), Math.sin(turn + seed)];
    const [px, pz] = [lying.x[P.pelvis * 3], lying.x[P.pelvis * 3 + 2]];
    for (const array of [lying.x, lying.prev]) {
      for (let index = 0; index < array.length; index += 3) {
        const [dx, dz] = [array[index] - px, array[index + 2] - pz];
        array[index] = px + dx * cos - dz * sin;
        array[index + 2] = pz + dx * sin + dz * cos;
      }
    }
  }
  advance(world, 0.5);
  placeFighter(walkerMan, -6, 0);
  walkerMan.faceFoe = false;
  return { world, walker: walkerMan };
}

/** He is driven along +x (`drive`: the footwork asked each step) until past the last body, down, or out of time. */
function cross(seed, drive, options) {
  const { world, walker } = lane(seed, options);
  walker.yaw = drive.yaw ?? 0;
  const from = world.events.length;
  const past = ((options?.bodies ?? 1) - 1) * 4 + 3;
  for (let t = 0; t < 30 && walker.root[0] < past && walker.state === 'up'; t += 1 / 60) {
    walker.move = drive.move;
    walker.running = Boolean(drive.running);
    walker.cooldown = 99;
    advance(world, 1 / 60);
  }
  return { world, walker, fell: walker.state !== 'up', events: world.events.slice(from) };
}

const SEEDS = [1, 2, 3, 4, 5, 6];

test('walking forward, he sees a man lying in his way and steps over him: no trip', () => {
  let stepped = 0;
  for (const seed of SEEDS) {
    const run = cross(seed, { move: 1 });
    assert.ok(!run.fell, `seed ${seed}: on his feet past the body`);
    assert.ok(!run.events.some((event) => event.kind === 'trod' && event.effects.includes('tripped')), `seed ${seed}: no trip`);
    stepped += run.world.crossings?.step ?? 0;
  }
  assert.ok(stepped >= SEEDS.length - 1, `a lifted step over the body in nearly every crossing (${stepped} of ${SEEDS.length})`);
});

test('running, he leaps him: off the floor before the body, down past it, on his feet', () => {
  let leaps = 0;
  for (const seed of SEEDS) {
    const run = cross(seed, { move: 1, running: true }, { bodies: 2 });
    assert.ok(!run.fell, `seed ${seed}: on his feet past both bodies`);
    for (const jump of run.events.filter((event) => event.kind === 'jump')) {
      assert.notEqual(jump.leap, undefined, 'the jump is a leap over a man');
      assert.ok(jump.height > 0.04 && jump.height < 0.4, `his hips rise ${jump.height.toFixed(2)} m, a part of his jump`);
      leaps += 1;
    }
  }
  assert.ok(leaps >= SEEDS.length, `${leaps} leaps over ${2 * SEEDS.length} bodies`);
});

test('backing onto a man he cannot see, he trips as before', () => {
  let falls = 0;
  for (const seed of SEEDS) {
    const run = cross(seed, { move: -1, yaw: Math.PI });
    assert.equal(run.world.crossings, undefined, `seed ${seed}: nothing stepped over or leapt`);
    if (run.fell) falls += 1;
  }
  assert.ok(falls >= SEEDS.length / 2, `${falls} of ${SEEDS.length} went over the body behind them`);
});

test('what he sees of the ground: nothing behind him, less with an enemy at arm\'s length or in a narrow helm', () => {
  const { world, walker } = lane(1);
  walker.rootVelocity = [1.2, 0];
  const [crossing] = crossingsAhead(world, walker, null, 6).filter((run) => run.to > 0);
  assert.ok(crossing && crossing.from > 4 && crossing.from < 6.5 && crossing.height > 0.1 && crossing.height < 0.45, `the body lies ${crossing?.from.toFixed(2)} m on, ${crossing?.height.toFixed(2)} m high`);
  assert.equal(groundAttention(world, walker, crossing, null, null), 1, 'walking free, he sees it');
  walker.yaw = Math.PI;
  assert.equal(groundAttention(world, walker, crossing, null, null), 0, 'backing, it is behind him');
  walker.yaw = 0;
  const enemy = { state: 'up', x: Float64Array.from(walker.x) };
  enemy.x[P.pelvis * 3] += 1.5;
  assert.equal(groundAttention(world, walker, crossing, enemy, null), STEPOVER.attention.engaged, 'his eyes on a man at arm\'s length');
  walker.stagger = 0.5;
  assert.equal(groundAttention(world, walker, crossing, null, null), 0, 'reeling, he looks at nothing');
  walker.stagger = 0;
  const helmed = lane(1, { walker: 'knight' });
  helmed.walker.rootVelocity = [1.2, 0];
  helmed.walker.body.gear = { ...helmed.walker.body.gear, sight: Math.PI / 4 };
  const seen = groundAttention(helmed.world, helmed.walker, crossingsAhead(helmed.world, helmed.walker, null, 6).find((run) => run.to > 0), null, null);
  assert.ok(seen > 0.6 && seen < 0.9, `a visor's sight: ${seen.toFixed(2)} of a glance`);
});

test('a burdened man clears less: a shorter, lower step, more of a lower jump, a harder landing', () => {
  const body = { from: 1, to: 1.45, height: 0.3 };
  const of = (key) => {
    const { world, walker } = lane(1, { walker: key });
    const legs = limbShares(walker).leg;
    const model = jumpNow(world, walker);
    const leap = leapOver(walker, model, body, 3);
    return { walker, reach: stepReach(walker, legs), model, leap, landing: leap ? jumpLanding(walker, Math.sqrt(2 * 9.81 * leap.rise), { legs }) : null };
  };
  const light = of('contender');
  const plate = of('knight');
  const sumo = of('sumo');
  assert.ok(light.leap && plate.leap, 'both leap a man lying across their way at a run');
  assert.ok(plate.leap.up > light.leap.up + 0.1, `the man in plate puts ${plate.leap.up.toFixed(2)} of his jump into it, the light man ${light.leap.up.toFixed(2)}`);
  assert.ok(plate.landing.ratio > 1.2 * light.landing.ratio, `and lands harder (${plate.landing.ratio.toFixed(2)} against ${light.landing.ratio.toFixed(2)})`);
  assert.ok(plate.leap.cost > light.leap.cost, 'for more breath');
  assert.ok(plate.reach.rise < light.reach.rise * 0.95 || plate.reach.span < light.reach.span, `his step over is no higher or longer (${plate.reach.rise.toFixed(2)} m against ${light.reach.rise.toFixed(2)})`);
  // A body in armour lying on its side (0.42 m), at a jog: the heaviest cannot get over it.
  const high = { from: 1, to: 1.6, height: 0.42 };
  assert.ok(leapOver(light.walker, light.model, high, 2.2), 'the light man leaps a high body at a jog');
  assert.equal(leapOver(sumo.walker, sumo.model, high, 2.2), null, 'the sumo cannot');
  // A hurt leg: a lower step.
  assert.ok(stepReach(light.walker, { l: 0.5, r: 1 }).rise < 0.6 * light.reach.rise, 'a hurt leg steps lower');
});

test('a horse walking over men lying still sets its hooves clear of them', () => {
  const lying = Array.from({ length: 5 }, (_, index) => [index * 2.5, index % 2 ? 0.2 : -0.15]);
  const world = createWorld([{ inputs: { ...structuredClone(PRESETS.knight), mounted: true }, corner: 'red' }, ...lying.map(() => ({ inputs: man('street'), corner: 'blue' }))], { seed: 7, arena: { halfX: 40, halfZ: 20 } });
  lying.forEach(([x, z], index) => {
    placeFighter(world.fighters[index + 1], x, z);
    knockOut(world, world.fighters[index + 1], { effects: [] }, 'test');
  });
  advance(world, 3);
  const [horse] = world.horses;
  placeMounted(world.fighters[0], -8, 0, 0);
  let jolted = 0;
  for (let t = 0; t < 14 && horse.at[0] < 14; t += 1 / 60) {
    horse.goal = { heading: 0, speed: 3 };
    horse.goalAt = world.time + 1;
    world.fighters[0].cooldown = 99;
    advance(world, 1 / 60);
    jolted = Math.max(jolted, horse.shock);
  }
  assert.ok(horse.at[0] > 10, 'it walked the length of them');
  // (A hoof on a body jolts the horse, physics/mounted.js trodOn: before this rule, 0.5-2.5 m/s of it over these five.)
  assert.equal(jolted, 0, 'no hoof came down on any of them');
});
