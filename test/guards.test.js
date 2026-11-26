// Sword guards (weapons.js `crossGuard`, physics/hilt.js): bars across the edges, bars with steel over the flats, discs round
// the blade; the hand they shelter; and how readily the AI meets a blow with its blade and times the beat (parrykeen.js).

import test from 'node:test';
import assert from 'node:assert/strict';
import { PRESETS } from '../src/body.js';
import { MOVES } from '../src/moves.js';
import { advance, createWorld, perform, placeFighter, throwPunch } from '../src/physics.js';
import { WEAPONS } from '../src/weapons.js';
import { guardBars, guardCatch, guardShelters, HILT, guardPartReach } from '../src/physics/hilt.js';
import { PARRY_KEEN, parryKeen, parryWilling, timedParryAt } from '../src/parrykeen.js';

const hand = [0, 1.2, 0];
const dir = [1, 0, 0];
// A blade coming down square across the sword's line `out` m ahead of the hand, `side` m to one side of it.
const across = (out, side) => [[out, 1.6, side], [out, 0.8, side]];

test('every sword has a guard sized from the specimens: crosses of ~18-26 cm, a tsuba of ~8 cm, small guards on the short swords', () => {
  const swords = ['longsword', 'armingSword', 'espada', 'rapier', 'katana', 'wakizashi', 'odachi', 'dao', 'changdao', 'jian', 'saber', 'kilij', 'sayf', 'gladius', 'shortSword', 'spatha', 'zweihander'];
  for (const name of swords) assert.ok(WEAPONS[name].crossGuard, name);
  const span = (name) => 2 * WEAPONS[name].crossGuard.cross.half;
  for (const name of ['longsword', 'armingSword', 'espada']) assert.ok(span(name) >= 0.18 && span(name) <= 0.26, `${name} ${span(name)}`);
  assert.ok(Math.abs(2 * WEAPONS.katana.crossGuard.tsuba.radius - 0.08) < 0.006);
  assert.ok(WEAPONS.wakizashi.crossGuard.tsuba.radius < WEAPONS.katana.crossGuard.tsuba.radius && WEAPONS.katana.crossGuard.tsuba.radius < WEAPONS.odachi.crossGuard.tsuba.radius);
  // A war hammer, a spear, a club have none.
  for (const name of ['warhammer', 'spear', 'clava', 'halberd']) assert.equal(WEAPONS[name].crossGuard, undefined, name);
});

test('a bar reaches 2/π of its half-span over the turns of the grip, steel over the flats adds as √(half² + flat²), a disc its radius', () => {
  assert.ok(Math.abs(guardPartReach({ half: 0.12 }) - 0.12 * HILT.plane) < 1e-12);
  assert.ok(Math.abs(guardPartReach({ half: 0.03, flat: 0.04 }) - 0.05 * HILT.plane) < 1e-12);
  assert.equal(guardPartReach({ round: true, radius: 0.04 }), 0.04);
  // The bigger the guard, the further out it catches: a long sword's cross well beyond a jian's small guard or a tsuba.
  const reach = (name) => Math.max(...guardBars(WEAPONS[name]).map((part) => part.reach));
  assert.ok(reach('longsword') > 1.5 * reach('katana') && reach('katana') > reach('jian'), `${reach('longsword')} ${reach('katana')} ${reach('jian')}`);
});

test('a long sword\'s cross catches a blade 8 cm to the side of the hands; a tsuba does not, but catches one 3 cm off in any direction', () => {
  const { longsword, katana } = WEAPONS;
  assert.ok(guardCatch(longsword, hand, dir, ...across(0.04, 0.08), 0.012));
  assert.equal(guardCatch(katana, hand, dir, ...across(0.03, 0.08), 0.012), null);
  // The disc is round: as far out across the edges as over the flats (the two sides of the blade here).
  assert.ok(guardCatch(katana, hand, dir, ...across(0.03, 0.03), 0.012));
  assert.ok(guardCatch(katana, hand, dir, [0.03, 1.2 + 0.03, -0.4], [0.03, 1.2 + 0.03, 0.4], 0.012));
  // Past the guard's reach, or out along the blade, nothing.
  assert.equal(guardCatch(longsword, hand, dir, ...across(0.04, 0.15), 0.012), null);
  assert.equal(guardCatch(longsword, hand, dir, ...across(0.4, 0.1), 0.012), null);
});

test('a rapier\'s bars round the hand shelter it from a cut at it; a katana\'s tsuba from one only close before it', () => {
  const { rapier, katana } = WEAPONS;
  // A cut across the back of the sword hand, 2 cm behind the hand's middle and 5 cm out.
  const atHand = [[-0.02, 1.25, -0.4], [-0.02, 1.25, 0.4]];
  assert.ok(guardShelters(rapier, hand, dir, ...atHand, 0.012));
  assert.equal(guardShelters(katana, hand, dir, ...atHand, 0.012), false);
});

test('in a controlled block, a long sword with its cross stops more of the blows than without it', () => {
  const attacks = [['longsword', 'oberhau', 'head'], ['longsword', 'zwerchhau', 'head'], ['longsword', 'unterhau', 'body'], ['katana', 'kesagiri', 'body']];
  const stopped = (guarded) => {
    const guard = WEAPONS.longsword.crossGuard;
    if (!guarded) WEAPONS.longsword.crossGuard = undefined;
    let count = 0;
    let caught = 0;
    try {
      for (const [style, move, zone] of attacks) {
        for (let seed = 1; seed <= 6; seed += 1) {
          const world = createWorld([{ ...PRESETS.contender, style }, { ...PRESETS.contender, style: 'longsword' }], { seed });
          const [a, d] = world.fighters;
          placeFighter(a, -0.85 - (seed % 3) * 0.1, 0);
          placeFighter(d, 1.0, 0);
          advance(world, 0.8);
          world.events.length = 0;
          throwPunch(world, a, move, zone);
          perform(world, d, 'weaponBlock', { from: 0 });
          advance(world, MOVES[move].duration + 0.2);
          if (world.events.some((e) => e.kind === 'parry' || e.kind === 'deflect')) count += 1;
          if (world.events.some((e) => e.kind === 'clash' && e.hilt && e.hiltOf === 1)) caught += 1;
        }
      }
    } finally {
      WEAPONS.longsword.crossGuard = guard;
    }
    return { count, caught };
  };
  const withCross = stopped(true);
  const without = stopped(false);
  assert.ok(withCross.caught > 0 && without.caught === 0, JSON.stringify({ withCross, without }));
  assert.ok(withCross.count >= without.count, JSON.stringify({ withCross, without }));
});

test('a blade that parries well is met with more readily: the swords over the zweihander, the halberd and the war hammer as they were', () => {
  const man = (style) => createWorld([{ ...PRESETS.contender, style }, { ...PRESETS.contender, style: 'boxing' }], { seed: 1 }).fighters[0];
  const keen = Object.fromEntries(['longsword', 'rapier', 'katana', 'joan', 'zweihander', 'halberd', 'knife', 'boxing'].map((style) => [style, parryKeen(man(style))]));
  for (const sword of ['longsword', 'rapier', 'katana', 'joan']) assert.ok(keen[sword] > keen.zweihander && keen.zweihander > keen.halberd, JSON.stringify(keen));
  // The guard counts: a rapier's swept hilt over a katana's tsuba, the same quickness and more of the line covered.
  assert.ok(keen.rapier > keen.katana);
  assert.ok(keen.knife < keen.katana && keen.boxing === 0, JSON.stringify(keen));
  const willing = (style) => parryWilling(man(style));
  assert.ok(willing('longsword') > 1.15 && willing('longsword') <= PARRY_KEEN.willing.most);
  assert.equal(willing('halberd'), 1);
  assert.equal(willing('boxing'), 1);
});

test('a trained man times the beat of some parries, an untrained one never; not with his guard already up', () => {
  const world = createWorld([{ ...PRESETS.contender, style: 'longsword' }, { ...PRESETS.contender, style: 'longsword' }], { seed: 3 });
  const [me, him] = world.fighters;
  placeFighter(me, 0, 0);
  placeFighter(him, 1.2, 0);
  throwPunch(world, him, 'oberhau', 'head');
  const punch = him.punch;
  let random = 0;
  const draws = () => ((random = (random * 9301 + 49297) % 233280) / 233280);
  const tries = (skill) => {
    me.body.skill = skill;
    let timed = 0;
    for (let n = 0; n < 200; n += 1) {
      const at = timedParryAt(world, me, punch, draws);
      if (at !== null) {
        timed += 1;
        assert.ok(at > world.time && at < world.time + punch.spec.extendUntil, `${at}`);
      }
    }
    return timed;
  };
  assert.equal(tries(0.2), 0);
  const trained = tries(0.65);
  const master = tries(1);
  assert.ok(trained > 20 && master > trained, `${trained} ${master}`);
  me.guardUp = true;
  assert.equal(tries(1), 0);
});
