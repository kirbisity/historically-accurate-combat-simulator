// The trunk cut through (physics.js trunkSection, trunkResistance, severTrunk; BLADES.trunkCut): what a blade's section
// through the body takes by what is in it, where that puts the cut among the weapons' strokes as they land here, and what
// follows: death at once, two limp parts that fall, nothing of him struck after, everything that counts the fallen still right.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { P, PARTICLES, PRESETS } from '../src/body.js';
import { advance, capsules, createWorld, cutOff, halfPoints, inFight, placeFighter, point, SEVER_PARTS, trunkResistance, trunkSection } from '../src/physics.js';
import { battleTally } from '../src/battletally.js';
import { momentFor } from '../src/drama.js';
import { strikeAt } from '../tools/weapon-strikes.js';
import { MOVES, STYLES } from '../src/moves.js';

const duel = (red = 'contender', blue = 'contender', style = 'katana') => {
  const world = createWorld([{ ...PRESETS[red], style }, { ...PRESETS[blue], style }], { seed: 3 });
  advance(world, 0.3);
  return world;
};
/** A section `along` the trunk leaning `degrees` from square across it, for a body. */
const section = (fighter, along, degrees = 0) => {
  const cos = Math.cos((degrees * Math.PI) / 180);
  const reach = (fighter.body.segments.trunk.skinRadius * Math.tan((degrees * Math.PI) / 180)) / fighter.body.lengths.trunk;
  return { joint: along < 0.4 ? 'waist' : 'chest', side: '', along, cos, lo: along - reach, hi: along + reach, normal: [0, cos, Math.sin((degrees * Math.PI) / 180)] };
};
const joules = (fighter, where) => {
  const left = trunkResistance(fighter, where);
  return left.flesh + left.bone;
};

test('the trunk resists by what is in the section: the waist least, the ribs more, the girdles and a leaning cut most', () => {
  const man = duel().fighters[1];
  const waist = joules(man, section(man, 0.3));
  const chest = joules(man, section(man, 0.6));
  const armpits = joules(man, section(man, 0.88));
  const hips = joules(man, section(man, 0.12));
  const kesa = joules(man, section(man, 0.55, 45));
  assert.ok(waist < chest && chest < armpits && armpits < hips, `waist ${waist.toFixed(0)} < chest ${chest.toFixed(0)} < armpits ${armpits.toFixed(0)} < hips ${hips.toFixed(0)}`);
  assert.ok(kesa > chest * 1.5, `shoulder to hip ${kesa.toFixed(0)} against a level chest cut ${chest.toFixed(0)}`);
  // Where it sits among the strokes as they land in duels here (tools: the best tenth of a katana's cuts to the trunk are
  // ~185-235 J, an odachi's best ~290, the best one-handed sabre, dao or kilij cut ~125): above every one-handed cut, within
  // the best of the two-handed long blades.
  assert.ok(waist > 135 && waist < 200, `a middling man's waist ${waist.toFixed(0)} J`);
  assert.ok(chest > 180 && chest < 290, `his chest ${chest.toFixed(0)} J`);
});

test('a thin man is cut through for less than a stout one, by his own girth and bone', () => {
  const thin = duel('starved', 'starved').fighters[1];
  const stout = duel('sumo', 'sumo', 'boxing').fighters[1];
  const middling = duel().fighters[1];
  const [a, b, c] = [thin, middling, stout].map((man) => joules(man, section(man, 0.3)));
  assert.ok(a < b && b < c, `${a.toFixed(0)} < ${b.toFixed(0)} < ${c.toFixed(0)}`);
});

test('a cut short of it stays in him: the next at that height has less to go through', () => {
  const world = duel();
  const man = world.fighters[1];
  const whole = joules(man, section(man, 0.3));
  man.limbCuts = { trunkLow: { flesh: 60, bone: 0.4 } };
  const cut = joules(man, section(man, 0.3));
  assert.ok(cut < whole - 30, `${cut.toFixed(0)} after, ${whole.toFixed(0)} whole`);
  assert.equal(joules(man, section(man, 0.6)), joules(duel().fighters[1], section(man, 0.6)), 'the chest, cut nowhere, is whole');
});

test('only an edge swept across him takes a section: not a thrust, a cut down the body, or a blade shorter than he is wide', () => {
  const man = duel().fighters[1];
  const pelvis = point(man.x, P.pelvis);
  const neck = point(man.x, P.neck);
  const at = pelvis.map((value, axis) => value + (neck[axis] - value) * 0.3);
  const up = neck.map((value, axis) => value - pelvis[axis]);
  // A level sweep: the blade lying across (z), travelling along x.
  const level = trunkSection(man, at, [0, 0, 1], [8, 0, 0], 0.9);
  assert.equal(level?.joint, 'waist');
  assert.ok(level.cos > 0.95 && Math.abs(level.along - 0.3) < 0.05);
  assert.equal(trunkSection(man, at, [1, 0, 0], [8, 0, 0], 0.9), null, 'a thrust');
  assert.equal(trunkSection(man, at, [0, 0, 1], up.map((value) => -value * 10), 0.9), null, 'a cut straight down the body');
  assert.equal(trunkSection(man, at, [0, 0, 1], [8, 0, 0], 0.2), null, 'a knife');
  // From the shoulder down across: through the ribs, leaning.
  const leaning = trunkSection(man, pelvis.map((value, axis) => value + (neck[axis] - value) * 0.6), [1, 0, 0], [0, -6, 6], 0.9);
  assert.equal(leaning?.joint, 'chest');
  assert.ok(leaning.cos < 0.8 && leaning.hi > leaning.lo + 0.3);
});

test('no stroke of a one-handed blade, a short one, a blunt weapon or a point goes through an unarmoured trunk; none of any goes through plate', () => {
  const trunkCut = (style, outfit = null) => {
    const found = [];
    for (const move of Object.keys(STYLES[style].attacks).filter((name) => MOVES[name].path === 'blade')) {
      for (const zone of MOVES[move].zones) for (const distance of [1.2, 1.5, 1.8, 2.1]) {
        const { events } = strikeAt(style, move, zone, distance, { outfit });
        if (events.some((event) => event.kind === 'severed' && SEVER_PARTS[event.joint].trunk)) found.push(`${move} ${zone} ${distance}`);
      }
    }
    return found;
  };
  for (const style of ['saber', 'dao', 'kilij', 'wakizashi', 'gladius', 'knife', 'warhammer', 'spear']) assert.deepEqual(trunkCut(style), [], style);
  for (const style of ['katana', 'odachi', 'zhanmadao', 'guandao']) assert.deepEqual(trunkCut(style, 'knight'), [], `${style} on plate`);
});

test('cut through at the waist he is dead at once, in two limp parts that fall and lie apart from the living', () => {
  const world = duel();
  const [foe, man] = world.fighters;
  const event = cutOff(world, man, { joint: 'waist', travel: [0, 0, -8] }, foe);
  assert.equal(event.kind, 'severed');
  assert.ok(event.trunk && event.effects[0] === 'cut in two at the waist');
  assert.equal(man.state, 'out');
  assert.ok(man.diedAt !== undefined && !inFight(man));
  assert.ok(world.events.some((found) => found.kind === 'killed' && found.fighter === man.id));
  assert.equal(capsules(man).length, 0, 'nothing of him is struck or stood against');
  assert.equal(man.halves.length, 2);
  const upper = PARTICLES.filter((_, index) => man.trunkCut.upper[index]);
  assert.deepEqual(upper.sort(), ['head', 'lElbow', 'lHand', 'lShoulder', 'neck', 'rElbow', 'rHand', 'rShoulder'].sort());
  assert.equal(cutOff(world, man, { joint: 'chest' }, foe), null, 'once');
  // The tally: one man killed, once.
  assert.equal(battleTally(world)[man.corner].killed, 1);
  // The camera's moment has a part of him to look at.
  assert.equal(momentFor(event).particle, P.pelvis);
  advance(world, 4);
  assert.ok(![...man.x].some(Number.isNaN));
  for (const name of PARTICLES) assert.ok(man.x[P[name] * 3 + 1] < 0.45, `${name} is down (${man.x[P[name] * 3 + 1].toFixed(2)} m)`);
  // Each part keeps its own shape: the upper's shoulders their span, the lower's hips theirs; nothing holds the two together.
  const span = (a, b) => Math.hypot(...point(man.x, P[a]).map((value, axis) => value - point(man.x, P[b])[axis]));
  assert.ok(Math.abs(span('lShoulder', 'rShoulder') - man.body.lengths.shoulderSpan) < 0.05);
  assert.ok(Math.abs(span('lHip', 'rHip') - man.body.lengths.hipSpan) < 0.05);
  // Drawn, each part is a whole skeleton again: its trunk's line told on from the cut end to its full length.
  for (const half of man.halves) {
    const points = halfPoints(half);
    assert.ok(Math.abs(Math.hypot(...points[P.neck].map((value, axis) => value - points[P.pelvis][axis])) - man.body.lengths.trunk) < 0.04);
  }
  // He bleeds out past collapse in seconds, lying there.
  assert.ok(man.bloodLost > 0.15, `lost ${man.bloodLost.toFixed(2)} of his blood in 4 s`);
  // And the two parts lie still after a while (asleep: not stepped for ever).
  advance(world, 4);
  assert.ok(man.halves.every((half) => half.stillFor > 0.2));
});

test('from the shoulder to the hip, one arm and the head go with the upper part and the other arm stays with the legs', () => {
  const world = duel();
  const [foe, man] = world.fighters;
  cutOff(world, man, { joint: 'chest', along: 0.7, normal: [0, 0.643, 0.766] }, foe);
  const upper = PARTICLES.filter((_, index) => man.trunkCut.upper[index]);
  assert.ok(upper.includes('head') && upper.includes('neck'));
  assert.equal(upper.filter((name) => name.endsWith('Shoulder')).length, 1);
  assert.equal(upper.filter((name) => name.endsWith('Hand')).length, 1);
  assert.ok(!upper.some((name) => /Hip|Knee|Foot|pelvis/.test(name)));
  advance(world, 3);
  assert.ok(![...man.x].some(Number.isNaN));
});

test('a rider cut through comes out of the saddle; his horse goes on without him', () => {
  const FIELD = { halfX: 40, halfZ: 30 };
  const rider = { ...PRESETS.samurai, mounted: true };
  const world = createWorld([{ inputs: rider, corner: 'red' }, { inputs: { ...PRESETS.contender, style: 'katana' }, corner: 'blue' }], { seed: 4, arena: FIELD });
  const [man, foe] = world.fighters;
  if (!man.mount) return;
  advance(world, 0.5);
  cutOff(world, man, { joint: 'waist' }, foe);
  assert.equal(man.mount, null);
  advance(world, 3);
  assert.ok(![...man.x].some(Number.isNaN));
  assert.equal(man.state, 'out');
});
