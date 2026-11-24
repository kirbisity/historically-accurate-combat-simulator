// A display before a fight: what a silverback does at a rival before he charges him (the strutting walk side-on, the reared-up
// chest-beat), and what any body whose style has a `display` may do standing off from a man. It costs a little wind and
// tells the other what is coming; nothing in it is a blow. The pose is a general one, worked from the body's own lengths: the
// hands brought in turn onto the chest from as far as the arm draws them back; the strut is the body's own gait on all fours
// (physics/quadruped.js) carried across in front of the man, broadside on to him.
//
// A style's `display`: { rate (per second, standing off), from (m: no nearer than this past his reach), every (s: the least
// between two), charge (s: how long after it the style's long charge, `chargeFrom`, may come: ai.js), beat: { weight, seconds, hz }, strut: { weight, seconds, pace (a share of his footwork), turn (rad off his man) } }.

import { P } from '../body.js';
import { STYLES } from '../moves.js';
import { point, toLocal } from '../physics.js';
import { vec, yawRotate } from '../pose.js';

export const DISPLAY = {
  // The beating hand drawn back off the chest (a share of the arm's length) and how far in front of the breastbone it strikes it.
  drawBack: 0.3, onChest: 0.04,
  // Where on the trunk the hands land (a share of the way from the hips to the neck), and how far apart (a share of the shoulders').
  chestAt: 0.72, apart: 0.35,
  // The head thrown back a little and the chest out, rearing to beat it (rad of lean taken off, shares of height).
  chestOut: 0.12, headUp: 0.02,
};

/** Begin a display of `kind` ('beat' or 'strut') at his man; false if he cannot now. */
export function startDisplay(world, fighter, kind, opponent) {
  const spec = STYLES[fighter.style]?.display?.[kind];
  if (!spec || fighter.display || fighter.punch || fighter.rush || fighter.clinch || fighter.state !== 'up') return false;
  const side = world.random() < 0.5 ? 1 : -1;
  fighter.display = { kind, t: 0, seconds: spec.seconds, side, at: opponent.id, upright: kind === 'beat' };
  world.events.push({ time: world.time, kind: 'display', fighter: fighter.id, effects: [kind] });
  return true;
}

/** A display under way: its clock; ended when it is done or anything else takes him. */
export function stepDisplay(fighter, dt) {
  const display = fighter.display;
  if (!display) return;
  display.t += dt;
  if (display.t >= display.seconds || fighter.state !== 'up' || fighter.punch || fighter.clinch || fighter.defence || fighter.rush) fighter.display = null;
}

/**
 * The display's movement for the AI (fighter.move, faceAt): a chest-beat stands where he is; a strut walks across in front of
 * his man, turned `turn` off him, at `pace` of his footwork, turning back the other way halfway.
 */
export function displayMoves(world, fighter, opponent) {
  const display = fighter.display;
  const spec = STYLES[fighter.style].display[display.kind];
  fighter.strafe = 0;
  fighter.running = false;
  if (display.kind === 'beat') {
    fighter.move = 0;
    return;
  }
  const back = display.t > display.seconds / 2 ? -1 : 1;
  const from = point(fighter.x, P.pelvis);
  const to = point(opponent.x, P.pelvis);
  const toward = Math.atan2(-(to[2] - from[2]), to[0] - from[0]);
  const heading = toward + display.side * back * spec.turn;
  const way = yawRotate([3, 0, 0], heading);
  fighter.faceAt = { at: [from[0] + way[0], from[1], from[2] + way[2]], until: world.time + 0.2 };
  fighter.move = spec.pace;
}

/** The chest-beat's pose (physics.js updateIntent): reared up, chest out, the hands brought onto the chest in turn. */
export function displayPose(fighter, intent) {
  const display = fighter.display;
  if (!display || display.kind !== 'beat') return;
  const spec = STYLES[fighter.style].display.beat;
  const H = fighter.body.heightM;
  const L = fighter.body.lengths;
  const arm = L.upperArm + L.forearmToFist;
  intent.lean -= DISPLAY.chestOut;
  intent.twist = 0;
  intent.guardTight = false;
  intent.headOffset = vec.add(intent.headOffset ?? [0, 0, 0], [0, DISPLAY.headUp * H, 0]);
  // The chest's front at the height the hands land, in his frame (from where the trunk stands now).
  const pelvis = toLocal(fighter, point(fighter.x, P.pelvis));
  const neck = toLocal(fighter, point(fighter.x, P.neck));
  const chest = vec.lerp(pelvis, neck, DISPLAY.chestAt);
  const front = fighter.body.segments.trunk.skinRadius + DISPLAY.onChest;
  const phase = display.t * spec.hz * Math.PI * 2;
  for (const [side, sign, offset] of [['l', 1, 0], ['r', -1, Math.PI]]) {
    // Each hand in turn: drawn back and out, then driven in onto the chest (a struck beat, not a sway).
    const out = Math.max(0, Math.sin(phase + offset));
    intent[`${side}Hand`] = [chest[0] + front + out * DISPLAY.drawBack * arm * 0.5, chest[1] + out * 0.05 * H, sign * (L.shoulderSpan * DISPLAY.apart + out * DISPLAY.drawBack * arm * 0.5)];
  }
}
