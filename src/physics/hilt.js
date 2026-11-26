// A sword's guard (a weapon's `crossGuard`, weapons.js): the zweihander's cross and Parierhaken, a long sword's or an arming
// sword's cross, a rapier's quillons, cup and the bars swept round the hand, a katana's tsuba, the round guard of a dao.
// Two blades meet where their lines come nearest (physics.js clashWeapons); a blade that passes the edge near the hands
// and would go on to the fingers, the forearms or the head meets the bars that stand out across the blade there instead:
// the cross at the hand and the hooks at the end of the ricasso, a disc of steel round the blade, the bars round the hand.
// Caught on them it is met with the blade's strongest part, a few centimetres from the hands, where the effective mass behind
// the parry is the arms' (weapons.js effectiveMassAt), so it holds. Nothing here makes a parry stronger by a number: the bars only stand where the steel really is.
// Pure: physics.js asks it once per pair of blades that did not meet along their lines.

import { vec } from '../pose.js';

export const HILT = {
  // A bar of half-span `half` lies in the plane of the edges, at whatever angle about the blade the grip has turned it to the
  // line along which the other blade comes. It catches that blade where it stands out towards it: |cos| of the angle of its
  // half-span. Over every turn of the grip that is 2/π of it on average (the mean of |cos θ|), so a cross of 28 cm a side
  // catches a blade passing within ~18 cm of the hand. (The side rings of a zweihander's cross stand out square to it, ~5 cm,
  // and fill in the turn where the bar is edge on: left out, a little short of what the hilt covers.)
  plane: 2 / Math.PI,
};

/**
 * How far out from the blade's line a part of a guard catches, on average over the turns of the grip (m). Three shapes, each
 * where its steel really stands:
 * - a bar across the edges (`half` each side: a cross, quillons): 2/π of it (HILT.plane);
 * - a bar with steel square to it over the flats as well (`flat` each side: side rings, the arms of a swept hilt, a guard plate's
 *   thickness): at each turn the farther of the two, half |cos θ| or flat |sin θ|, whose mean over the turn is 2/π √(half² + flat²);
 * - a disc or cup round the blade (`round`, its `radius`: a tsuba, the dao's round guard, a rapier's cup): its radius whatever the
 *   turn of the grip.
 */
export function partReach(part) {
  if (part.round) return part.radius;
  return HILT.plane * Math.hypot(part.half ?? 0, part.flat ?? 0);
}

/** A weapon's guard parts (its `crossGuard`): each { at (m along from the main hand), reach (m out from the blade's line it catches) }. */
export function guardBars(spec) {
  const guard = spec?.crossGuard;
  if (!guard) return [];
  return Object.values(guard).map((part) => ({ at: part.at, reach: partReach(part) }));
}

/**
 * Whether the guard of a blade (its spec, the main hand's point `hand` and its unit direction `dir`) catches another blade
 * (the segment from `from` to `to`, its own `radius`): the nearest bar within its reach of that blade's line. Returns
 * { along (m from the main hand), onFirst (the bar's centre), onSecond (the point on the other blade), t (0..1 along that
 * segment), distance, reach } or null.
 */
export function guardCatch(spec, hand, dir, from, to, radius) {
  let best = null;
  const span = vec.sub(to, from);
  const lengthSq = Math.max(1e-12, vec.dot(span, span));
  for (const bar of guardBars(spec)) {
    const centre = vec.add(hand, vec.scale(dir, bar.at));
    const t = Math.min(1, Math.max(0, vec.dot(vec.sub(centre, from), span) / lengthSq));
    const onSecond = vec.add(from, vec.scale(span, t));
    const distance = vec.length(vec.sub(centre, onSecond));
    const reach = bar.reach + spec.radius + radius;
    if (distance < reach && distance > 1e-9 && (!best || distance - reach < best.distance - best.reach)) best = { along: bar.at, onFirst: centre, onSecond, t, distance, reach };
  }
  return best;
}

/**
 * Whether the guard of a blade (as guardCatch) shelters the hand holding it from another blade come onto that hand: some part
 * of it reaches that blade, so the blade meets its steel before the fingers (physics.js collideStriker leaves the meeting to
 * clashWeapons, which finds it on the guard). Where no part reaches (a tsuba against a cut at the back of the hand, a cross
 * against one along the forearm) the hand is struck: a guard shelters only where its steel is.
 */
export function guardShelters(spec, hand, dir, from, to, radius) {
  return guardCatch(spec, hand, dir, from, to, radius) !== null;
}
