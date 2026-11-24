// How this body stands the stance its style asks for. A style says what its stance is (moves.js STYLES: `stance`, `offGuard`,
// `kick`); the body says how much of it this man can hold: a deep bow stance is the thighs holding the body's weight low on
// bent knees, an extended sword arm or a raised sword-finger is the shoulder holding the arm's (and the blade's) weight out at
// the end of a long lever, a high chambered kick is the hip's range of motion and the leg's strength to lift itself. Each is
// read continuously from the body (body.js: muscleForce against massKg, kit included; aging.js `joints`, the years' stiffness;
// `training`), never from a flag or a name, and the fatigue of the moment takes from it again.

import { P } from './body.js';

export const STANCE_FIT = {
  // The legs: the knee extensors' force over the body's weight (kit included), as a fit young fighter of either sex has it
  // (body.js muscleForce at P.lKnee / (massKg g): 0.29 for the taekwondo and wuxia presets, 0.27 for a tall light man, 0.20 for
  // a heavy untrained one, 0.19 for a man of eighty). `full` of that holds a style's stance at its full depth; under it the
  // depth beyond `free` (a share of height every guard has: the knees just unlocked) comes in proportion. Holding a deep
  // stance is a quarter squat held: quadriceps load climbs steeply with knee flexion (Escamilla 2001, Med Sci Sports Exerc 33:
  // 127), and the old and heavy rise out of it first.
  legs: { reference: 0.29, full: 0.75, free: 0.04 },
  // The joints (aging.js AGEING joints, 1 young): a deep bow stance or cat stance needs the hip and knee to fold. Their share
  // goes in at this power: an eighty-year-old's 0.64 leaves him about half the depth.
  jointPower: 1.5,
  // An arm held out: the hand's force over the weight it holds out (the arm's own and the weapon's, g): 5.5 to 6 for a fit
  // man with a jian, 3.1 for a heavy untrained one, 2.6 at eighty. Under `full` the hand comes back towards `rest` (drawn in
  // and down by the hip) in proportion: the shoulder flexors tire first at long lever arms (Chaffin 1973, the endurance of
  // the arm held forward falls steeply with the moment it holds).
  arms: { full: 4.5 },
  // A guard's fists sink this share of his height for arms that cannot hold up their own weight at all (fitStance; in
  // proportion for arms between: an eighty-year-old's about 4 cm, a fit man's not at all).
  guardDrop: 0.1,
  // Fatigue: spent (stamina 0), he keeps this share of what he could hold fresh.
  spent: 0.65,
  // A kick's height: the hip's range (lift, rad, of the leg from hanging, for the most supple trained fighter: a head kick
  // needs about 70-80 degrees with the trunk leant back) times its suppleness: the joints squared (stiff hips lose range
  // fastest: Roach & Miles 1991, Phys Ther 71: 656, hip flexion and abduction falling with age), how much of it training has
  // kept (`trained`: none to all), and the legs' strength to lift the leg against its own weight (a share of `legs.full`).
  kick: { lift: 1.66, trained: [0.15, 0.85], legsFull: 0.8, least: 0.15 },
};

const STANCE_FITS = new WeakMap();

const heldShare = (value) => Math.max(0, Math.min(1, value));

/** What this body can hold, fresh: { legs (deep-stance share), arms (an arm held out, per kg it holds, see armHold), kick (a kick's lift, rad) }. */
export function stanceAbility(body) {
  let fit = STANCE_FITS.get(body);
  if (fit) return fit;
  const g = 9.81;
  const legs = (body.muscleForce?.[P.lKnee] ?? 0) / (body.massKg * g) / STANCE_FIT.legs.reference;
  const joints = body.joints ?? 1;
  const training = body.inputs?.training ?? 0.5;
  const supple = joints ** 2 * (STANCE_FIT.kick.trained[0] + STANCE_FIT.kick.trained[1] * training) * heldShare(legs / STANCE_FIT.kick.legsFull);
  fit = {
    legs: heldShare(legs / STANCE_FIT.legs.full) * joints ** STANCE_FIT.jointPower,
    armForce: body.muscleForce?.[P.rHand] ?? 0,
    armKg: (body.segments?.rUpperArm?.mass ?? 2) + (body.segments?.rForearm?.mass ?? 1.5),
    kick: Math.max(STANCE_FIT.kick.least, STANCE_FIT.kick.lift * Math.min(1, supple)),
  };
  STANCE_FITS.set(body, fit);
  return fit;
}

/** Fatigue's share of what he can hold (stamina 0 to 1). */
export function freshShare(stamina = 1) {
  return STANCE_FIT.spent + (1 - STANCE_FIT.spent) * heldShare(stamina);
}

/** How much of an arm held out he can keep up (0 to 1), holding `heldKg` in the hand (a weapon), at this stamina. */
export function armHold(body, heldKg = 0, stamina = 1) {
  const fit = stanceAbility(body);
  const ratio = fit.armForce / (9.81 * (fit.armKg + heldKg));
  return heldShare(ratio / STANCE_FIT.arms.full) * freshShare(stamina);
}

/**
 * A style's stance as this body holds it: the crouch beyond the free knee-bend, and the weight's lean onto one foot (a bow
 * stance's onto the front, a cat stance's onto the rear: both are held on one bent leg), scaled by what his legs and joints
 * hold at this stamina. The rest of the stance (its blade, its guard) is the style's.
 */
export function fitStance(stance, body, stamina = 1) {
  if (!stance) return stance;
  const hold = stanceAbility(body).legs * freshShare(stamina);
  // (The fists held up at the face are the arms held up too: what his shoulders cannot keep there sinks, `guardDrop` of his
  // height for none at all.)
  const arms = armHold(body, 0, stamina);
  if (hold >= 1 && arms >= 1) return stance;
  const free = STANCE_FIT.legs.free;
  const out = { ...stance };
  if (stance.crouch > free) out.crouch = free + (stance.crouch - free) * Math.min(1, hold);
  if (stance.weight) out.weight = stance.weight * Math.min(1, hold);
  out.guardHeight = (stance.guardHeight ?? 0) - STANCE_FIT.guardDrop * (1 - arms);
  return out;
}

/** The highest a kick's foot (or a chambered knee, with the thigh's length) goes, local height (m) over his floor. */
export function kickCeiling(body, length = body.lengths.thigh + body.lengths.shank) {
  const hip = body.lengths.ankle + body.lengths.shank + body.lengths.thigh;
  return hip + length * Math.sin(Math.min(Math.PI / 2, stanceAbility(body).kick));
}
