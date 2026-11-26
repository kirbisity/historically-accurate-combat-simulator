import test from 'node:test';
import assert from 'node:assert/strict';
import { WARRIORS } from '../src/roster.js';
import { STYLES } from '../src/moves.js';
import { OUTFITS } from '../src/outfits.js';
import { ARROW, DART, FLINTLOCK, WEAPONS } from '../src/weapons.js';

const unit = (key) => WARRIORS.find((warrior) => warrior.key === key);

test('the four new units are in the roster, each in its faction', () => {
  assert.equal(unit('lineInfantry').faction, 'napoleonic');
  assert.equal(unit('cuirassier').faction, 'napoleonic');
  assert.equal(unit('greenStandard').faction, 'manchu');
  assert.equal(unit('hunter').faction, 'primates');
  assert.ok(unit('lineInfantry').flagship, 'the line infantryman opens the Napoleonic faction');
});

test('a musket man keeps his musket when a man is on him and fights with the bayonet', () => {
  assert.equal(STYLES.flintlock.emptyStyle, 'bayonet');
  assert.equal(STYLES.bayonet.weapon, 'flintlock');
  assert.ok(Object.keys(STYLES.bayonet.attacks).some((attack) => attack.startsWith('spear')));
});

test('the hunter casts his darts, lighter blows than an arrow\'s, then takes the stone-tipped spear', () => {
  assert.equal(WEAPONS.atlatl.shot, DART);
  assert.ok(DART.energy < 1 && DART.ammo === 3);
  assert.ok(DART.speed < ARROW.speed);
  assert.equal(STYLES.atlatl.fallback, 'stoneSpear');
  assert.ok(WEAPONS.stoneSpear.brittle > 0, 'flint breaks where iron would not');
});

test('the cuirassier rides, and his cuirass turns a spent ball but not a musket fired close', () => {
  const kit = OUTFITS.cuirassier;
  assert.ok(kit.horse);
  assert.ok(kit.bulletRating >= 900 && kit.bulletRating < FLINTLOCK.energy);
  assert.equal(unit('cuirassier').inputs.style, 'heavySword');
});
