// The moment a move is for (a move's `fits`, moves.js): what the AI sees of his man when it chooses among the moves that reach
// from here (ai.js), each move's weight multiplied by what its `fits` says of the moment, so a man picks the long blow at the
// end of his reach and the short one close, beats aside a point held in line before he thrusts past it, and goes low under a
// guard held high. It is what a fighter reads, not a script: a move with no `fits` is chosen as ever.
//
// `fits` (each a multiplier, applied when its moment holds):
// - near: his man inside MOVE_FIT.near of the move's reach (too close for a long blow to come round at its end);
// - far: his man beyond MOVE_FIT.far of it (at the end of its reach, where only a long one lands);
// - inLine: his man's weapon held with its point on the line between them (it must be put aside before a thrust goes in
//   along that line); open: not so (nothing there to beat);
// - guardHigh: his man's hands held high (his legs are open).

import { P } from './body.js';
import { point } from './physics.js';

export const MOVE_FIT = {
  // Shares of a move's reach (ai.js moveRange) inside which his man is near, and beyond which he is far.
  near: 0.6,
  far: 0.82,
  // His weapon is in line when it points at the striker within this cosine (~35 degrees) and its tip is on the striker's side
  // of his hand, nearer the striker than his hand by at least `ahead` m (a point held out, not a blade held back or up).
  inLineCos: 0.82,
  ahead: 0.3,
  // His guard is high with both hands above this share of the way from his hips to his neck (his chest).
  guardHigh: 0.75,
};

/** What a man sees of his man for choosing a move (moveFit): his weapon's point in line, his guard high. */
export function fitSense(fighter, opponent) {
  const hips = point(fighter.x, P.pelvis);
  const weapon = opponent.weapon?.held && !opponent.weapon.spec.ranged ? opponent.weapon : null;
  let inLine = false;
  if (weapon?.tip) {
    const hand = point(opponent.x, P[`${weapon.main}Hand`]);
    const toMe = [hips[0] - hand[0], 0, hips[2] - hand[2]];
    const flat = Math.hypot(toMe[0], toMe[2]);
    const dir = weapon.dir;
    const level = Math.hypot(dir[0], dir[2]);
    const pointing = flat > 1e-6 && level > 1e-6 ? (dir[0] * toMe[0] + dir[2] * toMe[2]) / (flat * Math.hypot(dir[0], dir[1], dir[2])) : 0;
    const tipNearer = flat - Math.hypot(hips[0] - weapon.tip[0], hips[2] - weapon.tip[2]);
    inLine = pointing > MOVE_FIT.inLineCos && tipNearer > MOVE_FIT.ahead;
  }
  const chest = opponent.x[P.pelvis * 3 + 1] + (opponent.x[P.neck * 3 + 1] - opponent.x[P.pelvis * 3 + 1]) * MOVE_FIT.guardHigh;
  const guardHigh = opponent.x[P.lHand * 3 + 1] > chest && opponent.x[P.rHand * 3 + 1] > chest;
  return { inLine, guardHigh };
}

/** The multiplier on a move's weight for the moment (`fits`): his man `distance` m off against the move's `reach`. */
export function moveFit(spec, sense, distance, reach) {
  const fits = spec.fits;
  if (!fits) return 1;
  let share = 1;
  if (fits.near !== undefined && distance < reach * MOVE_FIT.near) share *= fits.near;
  if (fits.far !== undefined && distance > reach * MOVE_FIT.far) share *= fits.far;
  if (sense.inLine && fits.inLine !== undefined) share *= fits.inLine;
  if (!sense.inLine && fits.open !== undefined) share *= fits.open;
  if (sense.guardHigh && fits.guardHigh !== undefined) share *= fits.guardHigh;
  return share;
}
