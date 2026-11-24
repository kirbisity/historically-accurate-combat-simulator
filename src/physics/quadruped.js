// Going on all fours, as a body goes on all fours when that is the way its build moves best: the knuckle-walk of the great
// apes, the walk and gallop of the monkeys. Nothing here is any one animal's: whether a body takes to its hands, how high it
// carries its hips and shoulders, how fast it goes, how its hands step and how quickly it rears up off them all follow from its
// limb lengths, its muscle and its weight. Tuning: QUADRUPED below.
//
// - Whether (quadBody `fit`): on all fours the hips stand at the height of the slightly bent legs and the shoulders at the
//   height of the nearly straight arms on their knuckles; the trunk between them slopes as the two heights and its length make
//   it. Long arms on short legs (a gorilla's, a chimpanzee's: intermembral index above 100) carry the shoulders above the hips,
//   the trunk sloping up to them and the head up to see; limbs near equal (a baboon's, a macaque's) carry the trunk level. A
//   man's short arms on long legs would put his head below his hips, the trunk pitched down past the horizontal: he does not
//   go so (QUADRUPED.steepest). And the arms must bear their share of the weight (`armBears`).
// - When (quadWanted): on all fours whenever the body is up and nothing needs its hands or its height: standing off, walking,
//   running, charging. It rears up onto its legs to strike (rearing into the blow: the trunk rises in the wind-up and comes
//   down behind the arm), to grapple, to cover, to display, to hold a weapon. Rearing takes the time the legs (and the arms
//   pushing off the ground) take to lift the trunk through the rise against gravity (quadBody `rearSeconds`); dropping back
//   onto the hands, the time the trunk takes to fall that far.
// - How fast (quadBody `top`): as gait.js reckons a run's power for two legs, here for all four: the push of a leg and of an
//   arm over the weight, times how fast their muscle shortens, over a fit man's; the top speed in proportion, and to the root of
//   the limbs' mean length. The gallop takes over from the walk where the walk's vaulting step can no longer keep up (a Froude
//   number, v² over g times hip height, of `gallopFroude`: about 0.5 for every quadruped, Alexander & Jayes 1983). A charge is
//   `rushShare` of the top.
// - The hands' steps (the knuckles planted on the floor, stepping when the stance has carried on past them): each hand under its
//   shoulder, a little ahead. On the floor for `duty` of a stride (more at a walk, less galloping: the share falls `dutyPerFroude`
//   per unit of Froude number), it lands half that stance's travel ahead of where it should be and goes when it is as far
//   behind (at the least `reach` of the arm's length), lifting `lift` of the arm. The swing takes `swing` of the arm's
//   pendulum half-period, less the faster it goes. At a walk one hand at a time, each following the foot of its own side (the lateral sequence
//   walk of primates: hind foot, fore hand of that side, the other hind, the other fore); at a gallop both may be up at once.

import { BODY, P } from '../body.js';
import { STYLES } from '../moves.js';
import { armGone, limbShares, point, toLocal, toWorld } from '../physics.js';
import { POSE, vec } from '../pose.js';
import { WORLD } from './config.js';

export const QUADRUPED = {
  // How bent the legs and the arms stand on all fours (shares of their straight length): the legs a little flexed at hip and
  // knee as an ape's are, the arms nearly straight, pillars under the shoulders (the photographs of knuckle-walking silverbacks).
  legFlex: 0.94, armFlex: 0.95,
  // The steepest the trunk may pitch on all fours (rad from upright): a little past level (a monkey's back, level or a touch
  // down to the shoulders); a man would be well past it, head down below his hips.
  steepest: 1.68,
  // The least an arm must push (one arm's force over the body's weight) to carry its share of the weight walking on it.
  armBears: 0.35,
  // The knuckles' height off the floor (shares of the hand's length: the fist on the middle phalanges).
  knuckle: 0.5,
  // Where each hand stands, in shares of the arm's length: ahead of the shoulder, out from the middle past the shoulder's width.
  handAhead: 0.12, handOut: 0.05,
  // The head carried forward and low between the shoulders on all fours (shares of height).
  headForward: 0.03, headDown: 0.03,
  // The hands' steps (shares of the arm's length, and of its pendulum half-period π√(l/g)).
  reach: 0.12, duty: 0.62, dutyPerFroude: 0.1, leastDuty: 0.35, lift: 0.1, swing: 0.36, swingPerFroude: 0.3, fastestSwing: 0.12,
  // At a walk a hand waits for the foot of its own side unless it has been left this many times its reach behind.
  laggard: 1.8,
  // The walk-to-gallop Froude number (Alexander & Jayes 1983: ~0.5 for mammals of every size).
  gallopFroude: 0.5,
  // A charge's speed, a share of the body's top on all fours.
  rushShare: 0.85,
  // The rise rearing up (m, as the shoulders' climb from all fours to upright) is worked out from the body; this is the floor
  // under the push that lifts it (shares of g), so a weak body still rears, slowly.
  leastLift: 0.6,
};

// (A body's numbers for going on all fours, once per body.)
const QUAD_BODIES = new WeakMap();

/** One limb's push (its muscles at hip or shoulder, knee or elbow, foot or hand, as gait.js weighs a leg) over the body's weight. */
function limbPush(force, root, middle, end, weight) {
  return (force[root] * 0.5 + force[middle] + force[end] * 0.5) / weight;
}

/**
 * What a body's build makes of going on all fours: whether it does (`fit`), its hips' and shoulders' heights and the trunk's
 * pitch there (`hipHeight`, `shoulderHeight`, `lean`), where its hands stand (`hand`: forward, up, out, m), its power and top
 * speed, its start, the speed it gallops from, and how long it takes to rear up off its hands and to drop back onto them.
 */
export function quadBody(body) {
  const known = QUAD_BODIES.get(body);
  if (known && known.gearFoot === body.gear?.foot && known.accelKey === body.gear?.accel) return known;
  const spec = QUADRUPED;
  const L = body.lengths;
  const H = body.heightM;
  const arm = L.upperArm + L.forearmToFist;
  const leg = L.thigh + L.shank;
  const hipHeight = L.ankle + leg * spec.legFlex;
  const shoulderHeight = arm * spec.armFlex + (L.wristToFist ?? 0.08 * arm) * spec.knuckle;
  // (desiredPose hangs the shoulders 0.025 H below the neck.)
  const rise = Math.max(-1, Math.min(1, (shoulderHeight - hipHeight + 0.025 * H) / L.trunk));
  const lean = Math.acos(rise);
  const force = body.muscleForce ?? body.motorForce;
  const weight = body.masses.reduce((sum, mass) => sum + mass, 0) * WORLD.gravity;
  const legPush = limbPush(force, P.pelvis, P.lKnee, P.lFoot, weight);
  const armPush = limbPush(force, P.lShoulder, P.lElbow, P.lHand, weight);
  const fit = lean <= spec.steepest && armPush >= spec.armBears;
  // How fast the limbs' muscle shortens, each against a fit man's for a limb of its kind (the arm's reference the leg's by
  // BODY.topSpeedPerMetre's ratio: an arm is quicker per metre than a leg).
  const gait = WORLD.gait;
  const feet = Math.min(body.topSpeed[P.lFoot], body.topSpeed[P.rFoot]) / gait.speedRef;
  const hands = Math.min(body.topSpeed[P.lHand], body.topSpeed[P.rHand]) / (gait.speedRef * BODY.topSpeedPerMetre.arm / BODY.topSpeedPerMetre.leg);
  const power = ((legPush + armPush) / 2 / gait.forceRef) * ((feet + hands) / 2);
  const limb = (arm + leg + 2 * L.ankle) / 2;
  const gear = body.gear ?? { foot: 1, accel: 1 };
  // Rearing: the shoulders climb from their height on all fours to their height standing in a crouch; the legs push (two of
  // them) and the arms shove off the floor (one arm's worth, through the first of it), less the weight.
  const standing = L.ankle + leg * spec.legFlex + L.trunk * 0.95;
  const climb = Math.max(0.05, standing - shoulderHeight);
  const lift = Math.max(spec.leastLift, 2 * legPush + armPush - 1) * WORLD.gravity;
  const out = {
    gearFoot: body.gear?.foot, accelKey: body.gear?.accel,
    fit, arm, leg, hipHeight, shoulderHeight, lean, power, legPush, armPush,
    hand: [L.trunk * Math.sin(lean) + arm * spec.handAhead, (L.wristToFist ?? 0.08 * arm) * spec.knuckle, L.shoulderSpan / 2 + body.segments.lUpperArm.skinRadius + arm * spec.handOut],
    feetOut: L.hipSpan / 2 + body.segments.lThigh.skinRadius * 0.6,
    top: gait.top * power * Math.sqrt(limb / 0.87) * gear.foot,
    accel: gait.accel * WORLD.gravity * power * gear.accel,
    gallopFrom: Math.sqrt(spec.gallopFroude * WORLD.gravity * hipHeight),
    rearSeconds: Math.sqrt((2 * climb) / lift),
    dropSeconds: Math.sqrt((2 * climb) / WORLD.gravity),
  };
  QUAD_BODIES.set(body, out);
  return out;
}

/** Whether a body's build takes it onto all fours (quadBody `fit`). */
export function goesOnFours(body) {
  return quadBody(body).fit;
}

/** Whether, now, nothing keeps him off his hands (see the head of this file). */
export function quadWanted(fighter) {
  if (!goesOnFours(fighter.body)) return false;
  if (fighter.state !== 'up' || fighter.mount || fighter.climbing || fighter.crawling || fighter.pin || fighter.kneel || fighter.jump || fighter.air) return false;
  if (fighter.netted || fighter.pickup || fighter.throwing || fighter.finisher || fighter.caught || fighter.tending || fighter.pain) return false;
  if (fighter.weapon?.held || fighter.offWeapon?.held || fighter.shield) return false;
  if (armGone(fighter, 'l') || armGone(fighter, 'r')) return false;
  if (fighter.punch || fighter.clinch || fighter.defence || fighter.display?.upright || fighter.handsDown) return false;
  return true;
}

/** How far onto all fours he is (1 on them, 0 reared up). */
export function onFours(fighter) {
  return fighter.quad ? 1 - fighter.quad.up : 0;
}

/** On all fours enough that his hands are part of his base (balance) and his pace is the four-legged one. */
export function quadBearing(fighter) {
  return onFours(fighter) > 0.5;
}

/** His top speed on all fours now (m/s): his body's, as sound and fresh as his weakest limb is. */
function quadTop(fighter) {
  const body = quadBody(fighter.body);
  const shares = limbShares(fighter);
  const sound = Math.min(shares.leg.l, shares.leg.r, shares.arm.l, shares.arm.r);
  return body.top * (WORLD.gait.legFloor + (1 - WORLD.gait.legFloor) * sound);
}

/** A run's pace on all fours (m/s), or null when he is not on them: flat out (`sprint`), else a run's share of it, by his wind. */
export function quadRunSpeed(fighter, sprint) {
  if (!quadBearing(fighter)) return null;
  const share = WORLD.gait.runShare;
  const run = Math.max(share.least, Math.min(share.most, share.base + share.aerobic * fighter.body.aerobic));
  return quadTop(fighter) * (sprint ? 1 : run);
}

/** A charge on all fours: its speed (m/s) and how fast it is gathered (m/s²), or null when he is not on them. */
export function quadRush(fighter) {
  if (!quadBearing(fighter)) return null;
  return { speed: quadTop(fighter) * QUADRUPED.rushShare, accel: quadBody(fighter.body).accel };
}

/** The gait his speed puts him in on all fours: 'stand', 'walk' or 'gallop'. */
function quadGaitAt(body, speed) {
  if (speed < 0.15) return 'stand';
  return speed < body.gallopFrom ? 'walk' : 'gallop';
}

/** A hand's place on the floor in his own frame, where it stands under the shoulder (m). */
function handHome(body, side) {
  const [ahead, up, out] = body.hand;
  return [ahead, up, side === 'l' ? out : -out];
}

/** The swing of a hand's step at `speed` (s): a share of the arm's pendulum half-period, shorter the faster he goes. */
function swingSeconds(body, speed) {
  const spec = QUADRUPED;
  const froude = (speed * speed) / (WORLD.gravity * body.hipHeight);
  return Math.max(spec.fastestSwing, (spec.swing * Math.PI * Math.sqrt(body.arm / WORLD.gravity)) / (1 + spec.swingPerFroude * froude));
}

/** Whether a hand is his own to walk on now: not striking, not holding a man, not covering. */
function handFree(fighter, side) {
  const punch = fighter.punch;
  if (punch && punch.spec.limb === `${side}Hand`) return false;
  return !fighter.clinch && !fighter.pin;
}

/**
 * The hands' steps (see the head of this file): each hand's knuckles planted on the floor (world), stepping when the stance has
 * carried on past them. Returns each hand's place now (world), or null where the hand is not on the floor.
 */
function stepHands(fighter, body, dt) {
  const spec = QUADRUPED;
  const quad = fighter.quad;
  const speed = Math.hypot(fighter.rootVelocity[0], fighter.rootVelocity[1]);
  const gait = quadGaitAt(body, speed);
  quad.gait = gait;
  const swing = swingSeconds(body, speed);
  // (The stance's travel, half of it each side of where the hand should be: Froude number v² / g h.)
  const froude = (speed * speed) / (WORLD.gravity * body.hipHeight);
  const duty = Math.max(spec.leastDuty, spec.duty - spec.dutyPerFroude * froude);
  const half = (speed * swing * duty) / (1 - duty) / 2;
  const reach = Math.max(spec.reach * body.arm, half);
  const places = {};
  for (const side of ['l', 'r']) {
    const hand = quad.hands[side];
    const home = toWorld(fighter, handHome(body, side));
    if (!handFree(fighter, side)) {
      // Taken up: put down again wherever it comes down.
      hand.planted = null;
      hand.step = null;
      places[side] = null;
      continue;
    }
    if (!hand.planted) hand.planted = [fighter.x[P[`${side}Hand`] * 3], home[1], fighter.x[P[`${side}Hand`] * 3 + 2]];
    if (!hand.step) {
      const drift = Math.hypot(home[0] - hand.planted[0], home[2] - hand.planted[2]);
      const other = quad.hands[side === 'l' ? 'r' : 'l'];
      const foot = fighter.feet?.[side];
      // At a walk: one hand at a time, after the foot of its own side has gone (or left far behind); at a gallop, as it falls behind.
      const allowed = gait === 'gallop' || (!other.step && (Boolean(foot?.step) || drift > reach * spec.laggard));
      if (drift > reach && allowed) {
        const ahead = swing + half / Math.max(speed, 1e-3);
        hand.step = { from: [...hand.planted], to: [home[0] + fighter.rootVelocity[0] * ahead, home[1], home[2] + fighter.rootVelocity[1] * ahead], t: 0, seconds: swing };
      }
    }
    if (hand.step) {
      const step = hand.step;
      step.t = Math.min(1, step.t + dt / step.seconds);
      // (Aimed again while it is in the air, at where the stance will be when it lands.)
      const ahead = (1 - step.t) * step.seconds + half / Math.max(speed, 1e-3);
      step.to = [home[0] + fighter.rootVelocity[0] * ahead, home[1], home[2] + fighter.rootVelocity[1] * ahead];
      const at = vec.lerp(step.from, step.to, step.t);
      at[1] = home[1] + Math.sin(Math.PI * step.t) * spec.lift * body.arm;
      places[side] = at;
      if (step.t >= 1) {
        hand.planted = [step.to[0], home[1], step.to[2]];
        hand.step = null;
      }
    } else {
      hand.planted[1] = home[1];
      places[side] = hand.planted;
    }
  }
  return places;
}

/** The fighter's state on all fours, made when first wanted. */
function quadState(fighter) {
  fighter.quad ??= { up: 1, gait: 'stand', hands: { l: { planted: null, step: null }, r: { planted: null, step: null } } };
  return fighter.quad;
}

/**
 * His pose on all fours (physics.js updateIntent, last): his rearing eased up or down as his body does it, and the intent
 * blended by how far onto his hands he is: the legs a little bent and side by side under the hips, the trunk pitched to the
 * shoulders over the hands, the head forward between them, the free hands on the floor where their steps have put them.
 */
export function quadPose(world, fighter, intent, dt) {
  if (!goesOnFours(fighter.body)) return;
  const body = quadBody(fighter.body);
  const quad = quadState(fighter);
  const wanted = quadWanted(fighter);
  // Up as fast as his legs lift him; down onto his hands as fast as he falls that far.
  quad.up = wanted ? Math.max(0, quad.up - dt / body.dropSeconds) : Math.min(1, quad.up + dt / body.rearSeconds);
  if (fighter.state !== 'up') quad.up = 1;
  const share = 1 - quad.up;
  if (share <= 0) {
    quad.hands.l.planted = quad.hands.r.planted = null;
    quad.hands.l.step = quad.hands.r.step = null;
    return;
  }
  const H = fighter.body.heightM;
  const L = fighter.body.lengths;
  const full = L.ankle + L.thigh + L.shank;
  const middle = (POSE.leadFoot[1] - POSE.rearFoot[1]) / 2;
  // (desiredPose: a foot's distance from the middle is `middle` × H × width when the feet are evened out.)
  const fours = { blade: 0, crouch: (full - body.hipHeight) / H, width: body.feetOut / (middle * H), lean: 0, guardHeight: 0, stagger: 0, even: 1 };
  intent.stance = blendStanceOn(intent.stance, fours, share);
  intent.lean = intent.lean * (1 - share) + body.lean * share;
  intent.dip *= 1 - share;
  intent.twist *= 1 - share;
  intent.shift *= 1 - share;
  if (intent.runArms) intent.runArms *= 1 - share;
  intent.headOffset = vec.add(intent.headOffset ?? [0, 0, 0], [QUADRUPED.headForward * H * share, -QUADRUPED.headDown * H * share, 0]);
  intent.guardTight = false;
  const places = stepHands(fighter, body, dt);
  for (const side of ['l', 'r']) {
    if (!places[side]) continue;
    const local = toLocal(fighter, places[side]);
    const key = `${side}Hand`;
    intent[key] = intent[key] ? vec.lerp(intent[key], local, share) : share > 0.5 ? local : undefined;
  }
}

/** A stance blended toward another by `share` (the keys of either; a missing one is desiredPose's default). */
function blendStanceOn(from, to, share) {
  const out = { ...from };
  const defaults = { stagger: 1, even: 0 };
  for (const key of Object.keys(to)) out[key] = (from[key] ?? defaults[key] ?? 0) * (1 - share) + to[key] * share;
  return out;
}

/** Where his hands are on the floor as a base (world), when he is bearing on them: the middle of the two. */
export function handsBase(fighter) {
  return vec.scale(vec.add(point(fighter.x, P.lHand), point(fighter.x, P.rHand)), 0.5);
}

/** Whether a style's fighter is one whose charge is drawn by its style's `charge` (a body that does not go on all fours). */
export function styledCharge(fighter) {
  return Boolean(STYLES[fighter.style]?.charge) && !quadBearing(fighter);
}
