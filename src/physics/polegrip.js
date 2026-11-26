// The pole's grip: a weapon that is all wood with no head (`slides`: the Shaolin staff) is not held at one place. The hands
// slide along it: drawn back to its end for the long blow (the rear hand at the butt, the whole length out ahead: the most
// reach and the fastest far end, the slowest to turn, as the man in the reference clip whips it round from the end), or
// gathered to its middle and its thirds for the quick ones (less out ahead, turned the quicker). And having no head it has no
// front: either end strikes (`ends` 2), and which one does is whichever the hands bring round the sooner to where the blow
// begins, so a run of blows flows from one end to the other as the staff turns, as the Shaolin gun is played.
//
// What it is here: the weapon's spec is the staff as the hands now hold it (poleGripSpec: its `length` ahead of the main hand, its
// `handle` behind, its balance about the hand), so the physics that reads a weapon's spec (its turn about the hand,
// turnLimit; its effective mass at the point struck, weapons.js effectiveMassAt; its reach and its striking length) sees the
// grip that the hands have. A move asks for its grip (`lead`: m of the staff out ahead of the main hand) and the hands slide to
// it no faster than POLE_GRIP.slide; between blows they come back to the guard's (the style's weaponGuard.lead, else the
// staff as listed). Turning the staff end for end changes nothing of where it is: the end that leads is only the one the
// stroke drives (poleTurnEnds), and the length ahead of the hand becomes the length behind it.

import { vec } from '../pose.js';
import { yawRotate } from '../pose.js';

export const POLE_GRIP = {
  // How fast (m/s) the hands slide along the staff to a new grip: the shaft run through a loose front hand and the rear one
  // drawn along it, about the pace of a hand changing its place on a rail (~2 m/s): the 0.65 m from the middle grip to the
  // end grip takes ~0.3 s, about the wind-up of the long blow, so the long grip costs its time.
  slide: 2.2,
  // The nearest the main hand comes to either end (m): a fist's width, the hand round the wood and not off its end.
  endClear: 0.06,
  // The quantum (m) the held grip is kept to, so the specs made for it are few and are kept (poleGripSpec).
  quantum: 0.01,
};

const poleSpecs = new WeakMap();

/** The staff as listed (before any grip): the weapon's own spec at first sight, kept. */
function poleBaseOf(weapon) {
  if (!weapon.gripBase || (weapon.spec !== weapon.gripSpec && weapon.spec !== weapon.gripBase)) {
    weapon.gripBase = weapon.spec;
    weapon.grip = { lead: weapon.spec.length, flipped: false };
  }
  return weapon.gripBase;
}

/**
 * The staff held `lead` m out ahead of the main hand, end A (the listed tip) or, turned end for end (`flipped`), end B (the
 * listed butt) leading: its `length` ahead, `handle` and `strikeFrom` behind (the whole of it strikes: no head, no haft), and
 * its `balance` (the centre of its mass from the hand, along it). Made once for each grip and kept.
 */
export function poleGripSpec(base, lead, flipped) {
  let byGrip = poleSpecs.get(base);
  if (!byGrip) poleSpecs.set(base, (byGrip = new Map()));
  const key = `${flipped ? 'b' : 'a'}${Math.round(lead / POLE_GRIP.quantum)}`;
  let spec = byGrip.get(key);
  if (!spec) {
    const whole = base.length + base.handle;
    // Its centre of mass from end A (the listed tip): the hand's place less the balance; from end B, the rest of it.
    const fromA = base.length - base.balance;
    const fromLeading = flipped ? whole - fromA : fromA;
    spec = { ...base, length: lead, handle: whole - lead, strikeFrom: -(whole - lead), balance: lead - fromLeading, gripOf: base };
    byGrip.set(key, spec);
  }
  return spec;
}

/** The grip the staff wants now (m ahead of the main hand): the stroke's (`lead`), else the guard's, else as listed. */
function poleLeadWanted(base, stroke, style) {
  const lead = stroke && stroke.t <= stroke.spec.duration ? stroke.spec.lead : null;
  const whole = base.length + base.handle;
  const wanted = lead ?? style?.weaponGuard?.lead ?? base.length;
  return Math.min(whole - POLE_GRIP.endClear, Math.max(POLE_GRIP.endClear, wanted));
}

/**
 * Turned end for end at a stroke's start (a staff, `ends` 2): the end that leads is whichever is nearer the stroke's first
 * line (its `from` dir), the one the hands bring there the sooner. The staff is where it was: its pointing reversed, and the
 * length ahead of the hand is what was behind it. (The spin is the same turning, whichever end is named.)
 */
function poleTurnEnds(fighter, weapon, stroke, base) {
  if (!stroke || weapon.gripStroke === stroke) return;
  weapon.gripStroke = stroke;
  if ((base.ends ?? 1) < 2 || !stroke.spec.from?.dir) return;
  const first = yawRotate(vec.normalize(stroke.spec.from.dir), fighter.yaw);
  if (vec.dot(first, weapon.dir) >= 0) return;
  const whole = base.length + base.handle;
  weapon.dir = vec.scale(weapon.dir, -1);
  weapon.grip = { lead: whole - weapon.grip.lead, flipped: !weapon.grip.flipped };
  // The off hand was on one side of the main one along the staff; named from the other end, it is on the other side.
  if (weapon.offSide) weapon.offSide = -weapon.offSide;
}

/**
 * Each substep, a sliding grip's weapon (`slides`): turned end for end at a stroke's start if the other end is nearer its
 * line (poleTurnEnds), the hands slid towards the grip wanted (poleLeadWanted) at POLE_GRIP.slide, and the weapon's spec set to the
 * staff as now held (poleGripSpec). Nothing for any other weapon.
 */
export function stepPoleGrip(fighter, weapon, stroke, style, h) {
  if (!weapon?.spec?.slides && !weapon?.gripBase) return;
  const base = poleBaseOf(weapon);
  poleTurnEnds(fighter, weapon, stroke, base);
  const wanted = poleLeadWanted(base, stroke, style);
  const step = POLE_GRIP.slide * h;
  const lead = weapon.grip.lead + Math.max(-step, Math.min(step, wanted - weapon.grip.lead));
  weapon.grip.lead = lead;
  weapon.spec = poleGripSpec(base, lead, weapon.grip.flipped);
  weapon.gripSpec = weapon.spec;
}

/**
 * Where along the staff the off hand holds (m from the main hand, + ahead), for a sliding grip: on the side of the main hand
 * it is on now (`reached`, where its arm has it), at least `shortest` from it and short of either end; on the other side if
 * its own has no room (a grip at the end: the other hand goes up the staff ahead of it). Kept as the weapon's `offSide`.
 */
export function slidingHandAlong(weapon, reached, shortest, clear) {
  const spec = weapon.spec;
  const ahead = spec.length - clear;
  const behind = spec.handle - clear;
  let side = Math.abs(reached) > 1e-3 ? Math.sign(reached) : weapon.offSide ?? 1;
  if (side > 0 && ahead < shortest) side = -1;
  else if (side < 0 && behind < shortest) side = 1;
  weapon.offSide = side;
  return side > 0 ? Math.min(ahead, Math.max(shortest, reached)) : -Math.min(behind, Math.max(shortest, -reached));
}

/** Which side of the main hand (+1 ahead, -1 behind) a weapon's off hand is held on: behind only on a sliding grip that has it there. */
export function offHandSide(weapon) {
  return weapon?.gripBase && weapon.offSide ? weapon.offSide : 1;
}

/** How much the mesh of a weapon drawn as listed is moved along its pointing (m) and whether it is turned end for end, for its grip. */
export function gripDrawing(weapon) {
  if (!weapon?.gripBase) return null;
  const base = weapon.gripBase;
  const flipped = weapon.grip.flipped;
  // End A sits `lead` (or, turned, the rest) from the hand; drawn as listed it sits base.length from the mesh's origin.
  const whole = base.length + base.handle;
  const toA = flipped ? whole - weapon.grip.lead : weapon.grip.lead;
  return { flipped, shift: toA - base.length };
}
