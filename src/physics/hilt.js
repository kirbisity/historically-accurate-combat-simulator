// A sword's cross-guard and parrying hooks (a weapon's `crossGuard`, weapons.js: the zweihander's cross and Parierhaken).
// Two blades meet where their lines come nearest (physics.js clashWeapons); a blade that passes the edge near the hands
// and would go on to the fingers, the forearms or the head meets the bars that stand out across the blade there instead:
// the cross at the hand and the hooks at the end of the ricasso. Caught on them it is met with the blade's strongest part,
// a few centimetres from the hands, where the effective mass behind the parry is the arms' (weapons.js effectiveMassAt),
// so it holds. Nothing here makes a parry stronger by a number: the bars only stand where the steel really is.
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

/** A weapon's guard bars (its `crossGuard`): each { at (m along from the main hand), reach (m out from the blade's line it catches) }. */
export function guardBars(spec) {
  const guard = spec?.crossGuard;
  if (!guard) return [];
  return Object.values(guard).map((bar) => ({ at: bar.at, reach: bar.half * HILT.plane }));
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
