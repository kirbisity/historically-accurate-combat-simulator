import { test } from 'node:test';
import assert from 'node:assert/strict';
import { advance, createWorld, placeFighter, throwPunch } from '../src/physics.js';
import { thinkAll } from '../src/ai.js';
import { WARRIORS } from '../src/roster.js';
import { WORLD } from '../src/physics/config.js';
import { shaftFlex, strikeShaft } from '../src/physics/wear.js';
import { createWeapon, MATERIALS } from '../src/weapons.js';

const byKey = new Map(WARRIORS.map((warrior) => [warrior.key, warrior.inputs]));

test('a wood that bends further before it breaks takes more of a blow across it: its flex from its rupture and modulus', () => {
  assert.equal(shaftFlex(MATERIALS.hardwood.shaft), 1, 'ash is the reference');
  const wax = shaftFlex(MATERIALS.waxwood.shaft);
  assert.ok(wax > 1.5, `white-wax wood bends ${wax.toFixed(2)} x as far as ash before it breaks`);
  // (A wood whose rupture is not known bends as ash does.)
  assert.equal(shaftFlex({ strength: 1, modulus: 15e9 }), 1);
  // The same blow across a staff of each wood, the same piece (the same man, the same moment): the ash one snaps first.
  const staff = (wood) => {
    const weapon = createWeapon('staff');
    weapon.spec = { ...weapon.spec, build: { ...weapon.spec.build, shaft: wood } };
    return weapon;
  };
  let ashSnaps = null;
  for (let joules = 50; joules <= 2000 && ashSnaps === null; joules += 10) if (strikeShaft(staff('hardwood'), { id: 1 }, 0, joules) === 'snapped') ashSnaps = joules;
  assert.ok(ashSnaps !== null, 'ash snaps at some blow');
  assert.equal(strikeShaft(staff('waxwood'), { id: 1 }, 0, ashSnaps), null, `the wax-wood staff takes the ${ashSnaps} J that snaps the ash one`);
});

test('a full end-grip smash of the wax-wood staff on a knight in plate, taken on his helm or met on his sword, does not snap it', () => {
  let landed = 0;
  let hardestMeeting = 0;
  let fastest = 0;
  let weakest = Infinity;
  for (const parrying of [false, true]) {
    for (const seed of [1, 2, 3]) {
      for (const gap of [1.5, 2.1]) {
        const world = createWorld([{ inputs: structuredClone(byKey.get('shaolin')), corner: 'red' }, { inputs: structuredClone(byKey.get('plate')), corner: 'blue' }], { seed });
        const [monk, knight] = world.fighters;
        placeFighter(monk, -gap / 2, 0);
        placeFighter(knight, gap / 2, 0);
        const think = (w, dt) => { if (parrying) thinkAll(w, dt, new Set([monk.id])); };
        advance(world, 0.3, think);
        monk.cooldown = 9;
        if (!parrying) knight.cooldown = 9;
        assert.ok(throwPunch(world, monk, 'staffSmash', 'head'), 'the smash is thrown');
        const from = world.events.length;
        advance(world, 1.4, think);
        for (const event of world.events.slice(from)) {
          assert.ok(!(event.kind === 'weaponBroke' && event.fighter === monk.id), `seed ${seed} at ${gap} m: ${event.effects}`);
          if (event.kind === 'landed' && event.attacker === monk.id && event.punch === 'staffSmash') {
            landed += 1;
            fastest = Math.max(fastest, event.speed);
          }
          if (event.kind === 'clash' && (event.fighter === monk.id || event.other === monk.id)) hardestMeeting = Math.max(hardestMeeting, event.energy ?? 0);
        }
        if (monk.weapon?.wear) weakest = Math.min(weakest, monk.weapon.wear.shaftAcross * WORLD.wear.across);
      }
    }
  }
  assert.ok(landed >= 6, `the smash landed ${landed} times`);
  // The most a blow can bend the staff with in its few milliseconds of contact is what the staff itself was moving with: its
  // own turning energy about the hand at its fastest (the arms' push through the hands is a shove over the contact, a few
  // joules). A rod over the hand from `handle` behind it to its end: at its fastest landing, well under what it takes across.
  const spec = createWeapon('staff').spec;
  const [ahead, behind] = [spec.length + spec.handle - 0.3, 0.3];
  const inertia = (spec.mass * (ahead ** 3 + behind ** 3)) / (3 * (ahead + behind));
  const ownEnergy = 0.5 * inertia * (fastest / ahead) ** 2;
  assert.ok(ownEnergy < weakest * 0.5, `its own motion ${ownEnergy.toFixed(0)} J against ${weakest.toFixed(0)} J across`);
  // And the hardest meeting with his blade, under it too.
  assert.ok(hardestMeeting < weakest, `met on the sword at ${hardestMeeting.toFixed(0)} J against ${weakest.toFixed(0)} J`);
});
