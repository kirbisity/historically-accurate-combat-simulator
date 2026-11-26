// How ready a man the AI plays is to meet a blow with his blade (ai.js think, its answer to a blow), and when a trained man
// times the meeting so that it is a deflect (physics/deflect.js). Both from the weapon in his hand and his training, never from
// who he is: a blade that comes onto the line quickly, covers a length of it and has a guard to stop what slides down it is
// one a man trusts to put in the way of a blow; a war hammer or a halberd is not, and he gets his body out of the way instead.

import { WEAPONS } from './weapons.js';
import { guardReading } from './physics.js';
import { deflectWindow } from './physics/deflect.js';
import { weaponInertia } from './physics/effort.js';
import { guardBars } from './physics/hilt.js';

export const PARRY_KEEN = {
  // His blade's parrying, `keen` (1 for the `ref` blade with no guard): how quickly it comes onto the line, √ of the reference's
  // moment of inertia about the shoulder over its own (the time to swing a mass through an angle at the same torque, as the
  // deflect window: physics/deflect.js), no more than `quickMost` (a knife's or a baton's speed is the wrist's, not the
  // weapon's: past a sword's quickness it parries no better); times how much of the line it covers, its length over `cover`
  // (a sword's length or more covers the line from his head to his hip; a knife's covers a fifth of it); times what its guard
  // adds, up to `guardShare` for a guard that catches `guardFull` m out or more (a long sword's or a rapier's cross; a tsuba
  // half that).
  keen: { ref: 'katana', quickMost: 1.25, cover: 0.8, guardFull: 0.08, guardShare: 0.15 },
  // How much more often he answers with his blade for it (`willing`): 1 + `gain` × what his blade's keen is past `floor` (a
  // zweihander's, ~0.6: it, a halberd and a war hammer are answered with as they were), no more than `most`. A sword's keen
  // ~1-1.2 makes it ~1.25-1.35 times as often: of the blows at a trained swordsman (skill 0.65) his guard meets ~40% where it
  // met ~30% (WORLD.guardRead chance), the rest still stepped from or taken. Fencing masters taught the sword as its own shield
  // ("the sword is the best defence", the parry before the void); the polearm men got off the line.
  willing: { floor: 0.6, gain: 0.6, most: 1.4 },
  // A trained man times his parry (`timed`): his blade goes up to the blow as it always did (it has the way to the line to
  // travel, ~0.15 s, longer than his deflect window), and of the blows he meets so, `chance` × his reading of the blow
  // (physics.js guardReading, 0..1) ^ `power` he sets his wrist and beats onto it at the last moment: `aim` of his deflect
  // window (deflectWindow, the AI's own) before he reckons the blow will reach his blade, `meet` of the way to its full
  // extension (the AI's parries meet blows at ~0.8 of `extendUntil`). The deflect window is reckoned from that beat. He
  // misjudges by up to `error` s either way (a novice's to a master's, by his reading): too early or too late it is a plain
  // parry, within the window a deflect. So a skilled man deflects now and then, an untrained one never (no reading, no timing).
  timed: { chance: 0.8, power: 1, aim: 0.6, meet: 0.8, error: [0.12, 0.03] },
};

/** His blade's parrying (PARRY_KEEN.keen): 1 for the reference blade with no guard; 0 with nothing in hand. */
export function parryKeen(fighter) {
  const weapon = fighter.weapon?.held ? fighter.weapon.spec : null;
  if (!weapon || weapon.ranged || weapon.longGun) return 0;
  const spec = PARRY_KEEN.keen;
  const reach = fighter.body.reach;
  const quick = Math.min(spec.quickMost, Math.sqrt(weaponInertia(WEAPONS[spec.ref], reach) / Math.max(1e-6, weaponInertia(weapon, reach))));
  const cover = Math.min(1, weapon.length / spec.cover);
  const guard = Math.max(0, ...guardBars(weapon).map((part) => part.reach));
  return quick * cover * (1 + spec.guardShare * Math.min(1, guard / spec.guardFull));
}

/** How many times as often he answers a blow with his blade for its parrying (PARRY_KEEN.willing): 1 for a weapon that parries no better than a zweihander. */
export function parryWilling(fighter) {
  const spec = PARRY_KEEN.willing;
  return Math.min(spec.most, 1 + spec.gain * Math.max(0, parryKeen(fighter) - spec.floor));
}

/**
 * Whether he times the beat of his parry on the blow coming (PARRY_KEEN.timed), and if so when (world time); null for a plain
 * parry. Only a guard newly raised with a blade (not one he already holds up, nor a shield's).
 */
export function timedParryAt(world, fighter, punch, random) {
  const spec = PARRY_KEEN.timed;
  const read = guardReading(fighter);
  if (!read || fighter.guardUp || !fighter.weapon?.held || fighter.shield) return null;
  if (random() >= spec.chance * read ** spec.power) return null;
  const meetsIn = spec.meet * punch.spec.extendUntil - (punch.age ?? punch.t);
  const error = (spec.error[0] + (spec.error[1] - spec.error[0]) * read) * (2 * random() - 1);
  const wait = meetsIn - spec.aim * deflectWindow(fighter) + error;
  return wait > 0 ? world.time + wait : null;
}
