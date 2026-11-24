import test from 'node:test';
import assert from 'node:assert/strict';
import { PRESETS } from '../src/body.js';
import { createWorld } from '../src/physics.js';
import { heatMark, heatStrength, stepHeat } from '../src/physics/heat.js';
import { AFFLICT, chillOf, nauseaOf, recoverUnder, staminaCeiling, stepNausea } from '../src/physics/afflictions.js';
import { readSounds } from '../src/audio/log.js';
import { stenchAt } from '../src/levelmode/water.js';
import { swayTransform } from '../src/afflictview.js';
import { createCryDirector } from '../src/audio/cries.js';

/** A man in `place` who draws `perSecond` of his stamina for `seconds` (the bar kept topped up): his chill, his cold's harm, his drive. */
function cooled(preset, place, seconds, perSecond = 0) {
  const world = createWorld([{ ...PRESETS[preset] }], { seed: 1, place });
  const fighter = world.fighters[0];
  const dt = 1 / 10;
  for (let t = 0; t < seconds; t += dt) {
    fighter.stamina = 0.8 - perSecond * dt;
    stepHeat(world, fighter, dt);
    fighter.stamina = 0.8;
    heatMark(fighter);
  }
  return { chill: chillOf(fighter), harm: fighter.coldHarm ?? 0, strength: heatStrength(fighter) };
}

/** A man breathing a stench (`smell`, `steeped`) for `seconds`, then clear of it for `after`: his nausea along the way, and what was heard. */
function sickened(smell, steeped, seconds, after = 0) {
  const world = createWorld([{ ...PRESETS.unskilled }], { seed: 3 });
  world.ear = { x: 0, y: 1.6, z: 0, radius: 100 };
  const fighter = world.fighters[0];
  const dt = 1 / 20;
  let most = 0;
  let lowest = 1;
  for (let t = 0; t < seconds + after; t += dt) {
    world.time += dt;
    fighter.stench = t < seconds ? smell : 0;
    fighter.steeped = t < seconds ? steeped : 0;
    stepNausea(world, fighter, dt);
    fighter.stamina = recoverUnder(fighter, 0.05 * dt);
    most = Math.max(most, nauseaOf(fighter));
    lowest = Math.min(lowest, staminaCeiling(fighter));
  }
  const gags = readSounds(world).events.filter((event) => event.type === 'voice' && event.kind === 'gag');
  return { world, fighter, most, lowest, gags };
}

test('cold: in Pyongyang\'s winter ordinary clothes and armour keep a man from numbness a long while; only thin dress freezes him fast', () => {
  const coat = (seconds) => cooled('mingSpear', 'pyongyang', seconds);
  assert.ok(coat(600).chill < 0.15, `coat, ten minutes still: ${coat(600).chill}`);
  assert.ok(coat(1800).chill > 0.2, `coat, half an hour still: ${coat(1800).chill}`);
  assert.ok(cooled('swordShield', 'pyongyang', 1800).chill < coat(1800).chill, 'a brigandine is warmer than a coat');
  const loincloth = cooled('retiarius', 'pyongyang', 300);
  assert.ok(loincloth.chill > 0.8 && loincloth.strength < 0.85, `loincloth ${loincloth.chill}`);
  assert.ok(cooled('mingSpear', 'abdali1619', 1800).chill < 0.1, 'Sarhu\'s spring cold is little in a coat');
  assert.equal(cooled('unskilled', null, 1800).chill, 0);
});

test('cold: work warms the hands (a man fighting has heat to spare); standing in winter water numbs anyone in minutes', () => {
  assert.equal(cooled('mingSpear', 'pyongyang', 1800, 0.03).chill, 0);
  const world = createWorld([{ ...PRESETS.swordShield }], { seed: 1, place: 'pyongyang' });
  const fighter = world.fighters[0];
  fighter.wading = { act: 1 };
  for (let t = 0; t < 300; t += 0.1) {
    stepHeat(world, fighter, 0.1);
    heatMark(fighter);
  }
  assert.ok(chillOf(fighter) > 0.8, `${chillOf(fighter)}`);
});

test('cold: harm comes only once the hands are numb, slowly, and never past its most', () => {
  assert.equal(cooled('retiarius', 'pyongyang', 60).harm, 0);
  assert.equal(cooled('mingSpear', 'pyongyang', 1800).harm, 0);
  const long = cooled('retiarius', 'pyongyang', 1500);
  assert.ok(long.harm > 0 && long.harm <= AFFLICT.cold.harmMost, `${long.harm}`);
});

test('nausea: a stench sickens him within seconds, puts a ceiling on his stamina, and he gags at the first of it', () => {
  const { most, lowest, gags, fighter } = sickened(0.8, 0, 20);
  assert.ok(most > 0.6, `${most}`);
  assert.ok(lowest < 0.75, `ceiling ${lowest}`);
  assert.ok(fighter.stamina <= staminaCeiling(fighter) + 1e-9);
  assert.ok(gags.length >= 1, 'a gag');
});

test('nausea: past halfway he retches now and then, winded and heard; out of it, it lets go over a minute', () => {
  const run = sickened(0, 1, 60, 120);
  assert.ok(run.gags.length >= 4, `${run.gags.length} gags`);
  assert.ok(nauseaOf(run.fighter) < 0.2, `${nauseaOf(run.fighter)} after two minutes clear`);
});

test('nausea: the nose tires of a smell, not of what he stands in', () => {
  const smelt = sickened(1, 0, 400);
  const steeped = sickened(0, 1, 400);
  assert.ok(nauseaOf(smelt.fighter) < 0.65, `${nauseaOf(smelt.fighter)}`);
  assert.ok(nauseaOf(steeped.fighter) > 0.95, `${nauseaOf(steeped.fighter)}`);
  assert.equal(sickened(0, 0, 30).most, 0);
});

test('the stench of the sewage: strongest at its edge, gone some metres off, none from clean water', () => {
  const sewage = { kind: 'water', shape: 'rect', at: [0, 0, 0], size: [4, 4], bed: -0.5, murk: 'sludge', viscosity: 2 };
  const clean = { ...sewage, murk: 'clear', at: [20, 0, 0] };
  assert.equal(stenchAt([sewage], 0, 1.6, 0), 1);
  assert.ok(stenchAt([sewage], 8, 1.6, 0) > 0 && stenchAt([sewage], 8, 1.6, 0) < 0.5);
  assert.equal(stenchAt([sewage], 15, 1.6, 0), 0);
  assert.equal(stenchAt([clean], 20, 1.6, 0), 0);
});

test('a gag is always heard, as a gag', () => {
  const world = createWorld([{ ...PRESETS.unskilled }], { seed: 1 });
  const fighter = world.fighters[0];
  const event = { type: 'voice', kind: 'gag', who: fighter.id, strength: 0.7, x: 0, y: 1.6, z: 0 };
  const out = createCryDirector({ random: () => 0.5 }).tick([event], world.fighters, { x: 0, y: 1.6, z: 0 }, 0);
  assert.equal(out.filter((cry) => cry.cry?.kind === 'gag').length, 1);
});

test('the view: still while clear; swaying while sick', () => {
  assert.equal(swayTransform(0, 0, 0, 3), '');
  assert.match(swayTransform(0.7, 0, 0, 3), /rotate/);
});
