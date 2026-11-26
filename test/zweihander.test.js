// The zweihander (weapons.js zweihander), its cross and hooks (physics/hilt.js), the ricasso grip (weapons.js offHandAlong),
// and the Landsknecht Doppelsöldner who carries it (outfits.js landsknecht, roster.js).

import test from 'node:test';
import assert from 'node:assert/strict';
import { P, PRESETS } from '../src/body.js';
import { MOVES, STYLES } from '../src/moves.js';
import { advance, createWorld, perform, placeFighter, throwPunch, turnLimit } from '../src/physics.js';
import { WEAPONS, offHandAlong } from '../src/weapons.js';
import { weaponInertia } from '../src/physics/effort.js';
import { guardBars, guardCatch, HILT } from '../src/physics/hilt.js';
import { gearTraits, OUTFITS } from '../src/outfits.js';
import { OUTFIT_BLURBS } from '../src/outfitsets.js';
import { WARRIORS, UNIT_NAMES } from '../src/roster.js';
import { KIT_FIRST } from '../src/loadout.js';
import { setLang, tname } from '../src/i18n.js';
import { vec } from '../src/pose.js';

const { zweihander, halberd, longsword } = WEAPONS;

test('the zweihander is the museum swords: ~1.7 m and ~3 kg, its balance by the hands, its edge most of its length', () => {
  const overall = zweihander.length + zweihander.handle;
  assert.ok(overall > 1.6 && overall < 1.8, `overall ${overall}`);
  assert.ok(zweihander.mass >= 2.3 && zweihander.mass <= 3.5, `mass ${zweihander.mass}`);
  // Its mass near the hands, the halberd's out at its head.
  assert.ok(zweihander.balance < 0.25 && zweihander.balance < halberd.balance / 3);
  // The edge from past the ricasso to the point: three quarters of what is ahead of the hand, the halberd's head a third.
  const edge = (spec) => (spec.length - spec.strikeFrom) / spec.length;
  assert.ok(edge(zweihander) > 0.75 && edge(halberd) < 0.4, `${edge(zweihander)} ${edge(halberd)}`);
  // The long sword's edge per joule: what it cuts more is only what it brings.
  assert.deepEqual(zweihander.harm.swing, longsword.harm.swing);
});

test('about the shoulder it turns as two fifths of a halberd: quicker round, and the longer deflect window', () => {
  const reach = 0.62;
  assert.ok(weaponInertia(zweihander, reach) < 0.5 * weaponInertia(halberd, reach));
  assert.ok(weaponInertia(zweihander, reach) > weaponInertia(longsword, reach));
  assert.ok(turnLimit(zweihander) > turnLimit(halberd) && turnLimit(zweihander) < turnLimit(longsword));
});

test('its cross and hooks catch a blade that passes the edge near the hands, and nothing further off', () => {
  const bars = guardBars(zweihander);
  assert.equal(bars.length, 2);
  assert.ok(Math.abs(bars[0].reach - zweihander.crossGuard.cross.half * HILT.plane) < 1e-9);
  const hand = [0, 1.2, 0];
  const dir = [1, 0, 0];
  // A blade coming down square across the line 12 cm out from the hand, 14 cm to the side: past the blade's own line, on the cross.
  const caught = guardCatch(zweihander, hand, dir, [0.03, 1.6, 0.14], [0.03, 0.8, 0.14], 0.012);
  assert.ok(caught && caught.along === zweihander.crossGuard.cross.at, JSON.stringify(caught));
  // 40 cm to the side, it passes.
  assert.equal(guardCatch(zweihander, hand, dir, [0.03, 1.6, 0.4], [0.03, 0.8, 0.4], 0.012), null);
  // A weapon without a guard catches nothing.
  assert.equal(guardCatch(halberd, hand, dir, [0.03, 1.6, 0.14], [0.03, 0.8, 0.14], 0.012), null);
});

/** A move at a Doppelsöldner who answers it with a block of his weapon (`style`), over seeds: the blows parried by the weapon, and those that reached his arms or him. */
function blocks(style, attacks, seeds) {
  let stopped = 0;
  let reached = 0;
  for (const [attackStyle, move, zone] of attacks) {
    for (let seed = 1; seed <= seeds; seed += 1) {
      const world = createWorld([{ ...PRESETS.contender, style: attackStyle }, { ...PRESETS.doppelsoeldner, style }], { seed });
      const [attacker, defender] = world.fighters;
      placeFighter(attacker, -0.85 - (seed % 3) * 0.1, 0);
      placeFighter(defender, 1.0, 0);
      advance(world, 0.8);
      world.events.length = 0;
      throwPunch(world, attacker, move, zone);
      perform(world, defender, 'weaponBlock', { from: 0 });
      advance(world, MOVES[move].duration + 0.2);
      if (world.events.some((event) => event.kind === 'parry' || event.kind === 'deflect')) stopped += 1;
      else if (world.events.some((event) => (event.kind === 'blocked' || event.kind === 'landed') && event.attacker === 0)) reached += 1;
    }
  }
  return { stopped, reached };
}

test('a block with the zweihander meets the blow with the blade and the hilt; with the halberd it is taken on the arms', () => {
  const attacks = [['longsword', 'oberhau', 'head'], ['katana', 'kesagiri', 'body']];
  const sword = blocks('zweihander', attacks, 3);
  const polearm = blocks('halberd', attacks, 3);
  assert.ok(sword.stopped >= 5 && sword.reached === 0, JSON.stringify(sword));
  assert.ok(polearm.reached > polearm.stopped && sword.stopped > 2 * polearm.stopped, `${JSON.stringify(sword)} ${JSON.stringify(polearm)}`);
});

test('the close thrust holds the off hand up on the ricasso, ahead of the main hand; the other moves keep it on the grip', () => {
  assert.ok(offHandAlong(zweihander, MOVES.ricassoStich) > 0 && offHandAlong(zweihander, MOVES.ricassoStich) <= zweihander.ricasso);
  assert.ok(offHandAlong(zweihander, MOVES.zweiOberhau) < 0);
  // A weapon with no ricasso keeps its grip whatever the move.
  assert.equal(offHandAlong(longsword, MOVES.ricassoStich), offHandAlong(longsword));
  const world = createWorld([{ ...PRESETS.doppelsoeldner }, { ...PRESETS.contender, style: 'passive' }], { seed: 3 });
  const [man, other] = world.fighters;
  placeFighter(man, -0.4, 0);
  placeFighter(other, 0.6, 0);
  advance(world, 0.6);
  assert.equal(throwPunch(world, man, 'ricassoStich', 'body'), true);
  // (In the wind-up, before the point meets him.)
  advance(world, 0.12);
  const weapon = man.weapon;
  const main = [man.x[P.rHand * 3], man.x[P.rHand * 3 + 1], man.x[P.rHand * 3 + 2]];
  const offHand = [man.x[P.lHand * 3], man.x[P.lHand * 3 + 1], man.x[P.lHand * 3 + 2]];
  assert.ok(vec.dot(vec.sub(offHand, main), weapon.dir) > 0.1, 'the left hand ahead along the blade');
});

test('the Doppelsöldner: the zweihander, a breastplate over slashed cloth, a trained man, named in both languages', () => {
  const warrior = WARRIORS.find((entry) => entry.key === 'doppelsoeldner');
  assert.ok(warrior);
  assert.equal(warrior.inputs.style, 'zweihander');
  assert.equal(STYLES.zweihander.weapon, 'zweihander');
  assert.equal(warrior.inputs.outfit.kind, 'landsknecht');
  // The halberdier's build: the weapons are the difference.
  const halberdier = WARRIORS.find((entry) => entry.key === 'halberdier');
  assert.equal(warrior.inputs.heightCm, halberdier.inputs.heightCm);
  const gear = gearTraits(warrior.inputs);
  assert.ok(gear.protection.regions.torso.deflects && gear.protection.regions.torso.cut === 1);
  for (const part of ['UpperArm', 'Forearm', 'Thigh', 'Shank']) assert.ok(gear.protection.regions[part].cut < 0.25, part);
  assert.ok(OUTFITS.landsknecht.skill >= 0.6);
  assert.ok(KIT_FIRST.landsknecht.includes('zweihander'));
  assert.ok(OUTFIT_BLURBS.landsknecht.en && OUTFIT_BLURBS.landsknecht.zh);
  setLang('zh');
  const names = [UNIT_NAMES.doppelsoeldner, zweihander.label, OUTFITS.landsknecht.label].map(tname);
  setLang('en');
  for (const name of names) assert.match(name, /[㐀-鿿]/);
});
