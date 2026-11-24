// Running, as a body runs: for every fighter that runs (the player's sprint, an AI man running to his place, after a man
// or away), the speed, the start and the stop, and the stride follow his body. Tuning: WORLD.gait.
//
// - Power: what one leg can push through its foot (the hip extensors, quadriceps and calf: rising.js's leg) over his
//   weight with all he wears, times how fast that leg's muscle can shorten (body.topSpeed at the foot: Hill's top speed,
//   from leg length, fast fibres, the pennation of bulky muscle, age and the joints, and what his armour lets it swing),
//   over a reference: `power` about 1 for a fit young man, less for a heavy, old, fat or starved one.
// - Top speed (a sprint): `top` m/s at power 1, in proportion to it and to the root of his leg length over 0.87 m, times
//   what his kit lets his legs do (gear.foot); a run that is not a sprint (an AI man running) is `runShare` of it,
//   more the better his wind (aerobic). As sound as his weaker leg is, and as fresh (rising.js limbShares).
// - The start and the stop: the stance gathers speed at `accel` × g × power × his kit's acceleration share, less as he
//   nears the speed he wants (to `least` of it); it brakes at `brake` × g × the same. The heavier for his legs, the
//   more ground he needs to stop.
// - The stride (the footwork of a run: physics.js updateFeet): steps at `rate` Hz + `ratePerSpeed` per m/s (about 3 a
//   second at a jog, 4 at a sprint), each foot on the floor as long as it takes his hips to pass over `contact` of his
//   leg length; the swing is the rest of two steps, the next foot away at `overlap` = step time / swing. A man without
//   the power has a shorter flight (he spends longer on each foot). The foot lands `land` of his leg length (+
//   `landPerSpeed` per m/s) ahead of the stance, and rises `lift` (+ `liftPerSpeed` per m/s) shares of his leg length
//   at the middle of the swing, less as he tires.
// - The lean: `lean` rad forward at a run, `leanPerSpeed` more per m/s, and `accelLean` of the angle his acceleration
//   makes with gravity (forward speeding up, back braking: `accelSmooth` s), `tiredLean` more when spent (hunched).
// - The corner: a turn at a run is a sideways force v × (turn rate) that the stance foot gives through the floor, and the
//   body leans in by atan(that over g) to carry it through its centre of mass. The most he can give is the least of what
//   the floor grips (`corner.grip`) and what his leg holds (`corner.legs` × power, less as it is hurt or tired); past it
//   his heading and his path turn no faster, wider the faster he goes (cornering, turnRateMost, bankOf, cornerShare).
// - A hurt leg: the step off it is quicker and the stride shorter (`limp`): he hobbles.
//
// Walking is the same gait at a lower speed (WORLD.gait.walk): under the walk-run switch (a Froude number of `walkRun` on his
// own leg, gaitKind) the legs vault over a stiff stance leg, both feet down for a moment each step and no flight (walkStride:
// Alexander's law for the step, a stance share for the double support, both shorter and more careful for a body without the
// power); over it they bounce, with a flight (strideOf). The body over the legs is his own too (gaitPose, WORLD.gait.pose): the
// track his thighs and hips make, the hips rising over the stance leg as far as his leg reaches, swaying out over the stance
// foot as a pendulum, the swinging side's hip dropping as his hip muscles are weak for his weight, the pelvis turning with the
// legs and the shoulders against it, the arms answering the opposite thigh as his legs are heavy for his arms, the head a mass
// on his neck's spring (headToss), and the lean that carries his acceleration: forward speeding up, back sitting into a stop.

import { P } from '../body.js';
import { limbShares } from '../physics.js';
import { restArmAngle } from '../pose.js';
import { WORLD } from './config.js';

const REFERENCE_LEG = 0.87;

/** What his body gives a run, fresh and sound: power (1 a fit young man), top speed (m/s), start and stop (m/s²). Cached per body. */
export function gaitBody(body) {
  const spec = WORLD.gait;
  const force = body.muscleForce ?? body.motorForce;
  const weight = body.masses.reduce((sum, mass) => sum + mass, 0) * WORLD.gravity;
  const legForce = (force[P.pelvis] * 0.5 + force[P.lKnee] + force[P.lFoot] * 0.5) / weight;
  const shortening = Math.min(body.topSpeed[P.lFoot], body.topSpeed[P.rFoot]);
  const power = (legForce / spec.forceRef) * (shortening / spec.speedRef);
  const legLength = body.lengths.thigh + body.lengths.shank;
  const gear = body.gear ?? { foot: 1, accel: 1 };
  return {
    power,
    // How fast his leg muscle shortens against a fit young man's (1): the footwork's share of it (footworkQuickness).
    quickness: shortening / spec.speedRef,
    legLength,
    top: spec.top * power * Math.sqrt(legLength / REFERENCE_LEG) * gear.foot,
    accel: spec.accel * WORLD.gravity * power * gear.accel,
    brake: spec.brake * WORLD.gravity * power * gear.accel,
    runShare: Math.max(spec.runShare.least, Math.min(spec.runShare.most, spec.runShare.base + spec.runShare.aerobic * body.aerobic)),
  };
}

/** His body's gait (cached on the fighter for his body). */
export function gaitOf(fighter) {
  let cache = fighter.gaitBody;
  // (Worked out again when his kit's footwork or acceleration has changed: a man wading is held by the water, levelmode/level.js wadeGear.)
  if (!cache || cache.body !== fighter.body || cache.footKey !== fighter.body.gear?.foot || cache.accelKey !== fighter.body.gear?.accel) {
    cache = { body: fighter.body, footKey: fighter.body.gear?.foot, accelKey: fighter.body.gear?.accel, ...gaitBody(fighter.body) };
    fighter.gaitBody = cache;
  }
  return cache;
}

/**
 * How quick his feet are in the fight's footwork (a share of WORLD.footSpeed, beside the legs' strength for his weight that
 * physics.js already counts): how fast his leg muscle shortens (gaitBody quickness: fast fibres, their bulk, age, armour's
 * hold on the joints) against a typical man's, at `footQuickness` of its full effect.
 */
export function footworkQuickness(fighter) {
  const share = WORLD.footQuickness;
  return 1 - share + (share * gaitOf(fighter).quickness) / WORLD.quicknessTypical;
}

/** How sound and fresh his legs are for a run (0..1): the weaker leg's share (limbShares: damage, fatigue). */
export function runLegs(fighter) {
  const shares = limbShares(fighter);
  return Math.min(shares.leg.l, shares.leg.r);
}

/** The speed (m/s) of his run at full pace: flat out (`sprint`), or a run (an AI man's): as sound and fresh as his legs are. */
export function runSpeed(fighter, sprint) {
  const gait = gaitOf(fighter);
  const legs = runLegs(fighter);
  return gait.top * (sprint ? 1 : gait.runShare) * (WORLD.gait.legFloor + (1 - WORLD.gait.legFloor) * legs);
}

/**
 * The speed (m/s) a man goes from a walk into a run (the player's slowest run: control.js runShare): where his legs'
 * swing, a pendulum, can no longer keep the walk's vaulting step under him, at a Froude number (v² / g × leg length) of
 * `walkRun` (about 0.5 for people: ~2 m/s for a man's legs), and no faster than his own run.
 */
export function jogSpeed(fighter) {
  const gait = gaitOf(fighter);
  return Math.min(Math.sqrt(WORLD.gait.walkRun * WORLD.gravity * gait.legLength), runSpeed(fighter, false));
}

/** His hip's height standing (m): the leg and the ankle under it (the walking law's length). */
export function hipHeightOf(fighter) {
  return gaitOf(fighter).legLength + fighter.body.lengths.ankle;
}

/** The speed (m/s) at which his legs go from a walk into a run: a Froude number of `walkRun` on his own leg. */
export function walkRunSpeed(fighter) {
  return Math.sqrt(WORLD.gait.walkRun * WORLD.gravity * gaitOf(fighter).legLength);
}

/**
 * Whether his legs are running (a flight each step) or walking at `speed` m/s, kept on the fighter (`gaitRun`): into a run past
 * the switch (walkRunSpeed) by `switchBand`, back to a walk under it by as much. A man setting off to run (the pace he wants,
 * `fighter.gaitWanted`, a run's) runs from his first step: he does not walk up to the switch first.
 */
export function gaitKind(fighter, pace) {
  const speed = Math.max(pace, fighter.gaitWanted ?? 0);
  const at = walkRunSpeed(fighter);
  const band = WORLD.gait.switchBand;
  if (speed > at * (1 + band)) fighter.gaitRun = true;
  else if (speed < at * (1 - band)) fighter.gaitRun = false;
  else fighter.gaitRun = Boolean(fighter.gaitRun);
  return fighter.gaitRun;
}

/** His walking ability (0..1): his power (gaitBody), as sound and fresh as his weaker leg is (runLegs), no less than `leastPower`, at most 1. */
function walkAbility(fighter) {
  const legs = WORLD.gait.legFloor + (1 - WORLD.gait.legFloor) * runLegs(fighter);
  return Math.max(WORLD.gait.leastPower, Math.min(1, gaitOf(fighter).power * legs));
}

/**
 * His own easy walk (m/s): a Froude number of `walk.preferred` on his hip's height, slower by his want of power (an old or heavy
 * man's easy walk is ~1 m/s, a fit man's ~1.45) and as his kit holds his legs; never faster than his fastest walk.
 */
export function preferredWalk(fighter) {
  const spec = WORLD.gait.walk;
  const easy = Math.sqrt(spec.preferred * WORLD.gravity * hipHeightOf(fighter)) * walkAbility(fighter) ** spec.ability * Math.min(1, fighter.body.gear?.foot ?? 1);
  return Math.min(easy, jogSpeed(fighter));
}

/** How far (m) a braking man's foot lands further ahead of his hips: h × a / g (WORLD.gait.brakeReach), his deceleration's share. */
function brakeAhead(fighter) {
  const braking = Math.max(0, -(fighter.gaitAccel ?? 0));
  return WORLD.gait.brakeReach * hipHeightOf(fighter) * Math.min(1, braking / WORLD.gravity);
}

/**
 * The footwork of his walk at `speed` m/s (as strideOf's: seconds, the swing; lead; threshold; lift) with `rest`, the time both
 * feet are down after each landing before the next foot goes (the double support): the step's length by Alexander's law on his
 * hip height, shorter for a body short of power; the swing the rest of the stride after the stance's share (`duty`).
 */
export function walkStride(fighter, speed) {
  const spec = WORLD.gait.walk;
  const L = gaitOf(fighter).legLength;
  const h = hipHeightOf(fighter);
  const v = Math.max(spec.slowest, speed);
  const froude = (v * v) / (WORLD.gravity * h);
  const ability = walkAbility(fighter);
  const step = Math.min(spec.stepMost * L, spec.step * h * froude ** spec.stepExp * ability ** spec.stepPower);
  const period = step / v;
  const duty = Math.max(0.52, Math.min(0.8, spec.duty - spec.dutyPerFroude * froude + spec.careful * (1 - ability)));
  const seconds = 2 * period * (1 - duty);
  const ahead = spec.land * step + brakeAhead(fighter);
  const tired = 1 - Math.max(0, Math.min(1, fighter.stamina));
  return {
    seconds,
    overlap: 1,
    rest: (2 * duty - 1) * period,
    lead: 1 + ahead / (seconds * v),
    threshold: spec.threshold,
    lift: (spec.lift + spec.liftPerFroude * froude) * L * (1 - WORLD.gait.tiredLift * tired),
    walk: true,
  };
}

/** The most a chosen walk's speed changes this step (m/s): what his legs give (runChange), no more than `walk.accel` of g. */
export function walkChange(fighter, speed, wanted, dt) {
  return Math.min(runChange(fighter, speed, wanted, dt), WORLD.gait.walk.accel * WORLD.gravity * dt);
}

/**
 * The most the stance's speed may change this step (m/s), running: gathering speed (towards `wanted` m/s from `speed`)
 * at his start, less as he nears his top; braking at his brake.
 */
export function runChange(fighter, speed, wanted, dt) {
  const gait = gaitOf(fighter);
  const legs = WORLD.gait.legFloor + (1 - WORLD.gait.legFloor) * runLegs(fighter);
  if (wanted <= speed) return gait.brake * legs * dt;
  const top = Math.max(1e-3, gait.top * legs);
  return gait.accel * legs * Math.max(WORLD.gait.least, 1 - speed / top) * dt;
}

/**
 * The footwork of his run at `speed` m/s (physics.js updateFeet's step spec): seconds (the swing), overlap (the next
 * foot goes at this share of it), lead (the landing, in swing times of travel), threshold and lift.
 */
export function strideOf(fighter, speed) {
  // (Under the walk-run switch, a walk: walkStride.)
  if (!gaitKind(fighter, speed)) return walkStride(fighter, speed);
  const spec = WORLD.gait;
  const gait = gaitOf(fighter);
  const L = gait.legLength;
  const v = Math.max(spec.slowest, speed);
  const period = 1 / (spec.rate + spec.ratePerSpeed * v);
  const ahead = (spec.land + spec.landPerSpeed * v) * L + brakeAhead(fighter);
  // On the floor as long as the hips take to pass over it; a man short of power longer (less flight, a stompier run). No
  // longer than his leg can reach: from the landing, ahead of his hips, to as far behind them as the leg reaches up on the
  // ball of the foot (pushOff). Past that the foot left behind could be reached only by his hips coming down and round to it.
  const contact = Math.min(period * spec.mostContact, (spec.contact * L) / v / Math.min(1, Math.max(spec.leastPower, gait.power)) ** spec.powerContact, (ahead + pushOff(fighter)) / v);
  const seconds = Math.max(period * 1.02, 2 * period - contact);
  const tired = 1 - Math.max(0, Math.min(1, fighter.stamina));
  return {
    seconds,
    overlap: period / seconds,
    lead: 1 + ahead / (seconds * v),
    threshold: spec.threshold,
    lift: Math.min(spec.liftMost, spec.lift + spec.liftPerSpeed * v) * L * (1 - spec.tiredLift * tired) * Math.min(1, Math.sqrt(Math.max(spec.leastPower, gait.power))),
  };
}

/**
 * How far behind his hips (m) a runner's foot can still be on the floor: his leg (WORLD.runMode.heel.reach of its length,
 * the knee not locked) from the hips' height in the run (the run's dip, and half its bob, below his standing hips) down to
 * the ankle up on the ball of the foot (heel.most of his height).
 */
export function pushOff(fighter) {
  const run = WORLD.runMode;
  const L = gaitOf(fighter).legLength;
  const H = fighter.body.heightM;
  const reach = run.heel.reach * L;
  const drop = L - (run.dip + run.bob / 2) * H - run.heel.most * H;
  return Math.sqrt(Math.max(0, reach * reach - drop * drop));
}

/**
 * The trunk's lean in his run (rad, forward): a little at a jog, more the faster, much more gathering speed and back
 * braking (his acceleration along his way, smoothed: `fighter.gaitAccel`), hunched when spent.
 */
export function runLean(fighter, dt) {
  const spec = WORLD.gait;
  const speed = Math.hypot(fighter.rootVelocity[0], fighter.rootVelocity[1]);
  const forward = [Math.cos(fighter.yaw), -Math.sin(fighter.yaw)];
  const along = fighter.rootVelocity[0] * forward[0] + fighter.rootVelocity[1] * forward[1];
  const was = fighter.gaitAlong ?? along;
  const accel = dt > 0 ? (along - was) / dt : 0;
  fighter.gaitAlong = along;
  fighter.gaitAccel = (fighter.gaitAccel ?? 0) + (accel - (fighter.gaitAccel ?? 0)) * (1 - Math.exp(-dt / spec.accelSmooth));
  const tired = 1 - Math.max(0, Math.min(1, fighter.stamina));
  // (Walking, the run's own forward lean is not there: only the speed's and the acceleration's. `gaitRunShare`: gaitPose.)
  const running = fighter.gaitRunShare ?? 1;
  const lean = spec.lean * running + spec.leanPerSpeed * speed + spec.accelLean * Math.atan2(fighter.gaitAccel, WORLD.gravity) + spec.tiredLean * tired * running;
  return Math.max(spec.leanMost[0], Math.min(spec.leanMost[1], lean));
}

/**
 * What he can give a turn at a run (WORLD.gait.corner): `tan`, the most sideways push over his weight, which is the tangent
 * of the lean he can hold (the floor's grip, or his leg's strength: the less, less as the leg is hurt or tired), and `accel`,
 * that push as a sideways acceleration (m/s²).
 */
export function cornering(fighter) {
  const spec = WORLD.gait.corner;
  const legs = WORLD.gait.legFloor + (1 - WORLD.gait.legFloor) * runLegs(fighter);
  const floor = spec.grip * Math.min(1, fighter.body.gear?.balance ?? 1);
  const tan = Math.max(0, Math.min(floor, spec.legs * gaitOf(fighter).power * legs));
  return { tan, accel: tan * WORLD.gravity };
}

/** The fastest his heading may turn (rad/s) at `speed` m/s: the sideways acceleration he can give, over his speed (never slower than 1 m/s: a start is not a corner). */
export function turnRateMost(fighter, speed) {
  return cornering(fighter).accel / Math.max(1, speed);
}

/**
 * The lean (rad, positive to his left, the pose's `bank`) that carries a turn: the floor must push him in by v × turn
 * (`turn` rad/s, positive turning to his right) so the push through his centre of mass leans him by atan(v × turn / g), toward the
 * inside of the curve, no further than he can hold; walking, less what his track carries (`track`, m: the stance foot's offset).
 */
export function bankOf(fighter, speed, turn, track = 0) {
  // (Walking, the stance foot is already `track` m out from his line: the push it gives is through his centre of mass for as much of
  // the turn as that offset carries over his hip height, and only the rest leans him. A slow walk round a bend hardly leans.)
  const height = hipHeightOf(fighter);
  const wanted = Math.max(0, (speed * Math.abs(turn)) / WORLD.gravity - track / height);
  return -Math.sign(turn) * Math.atan(Math.min(wanted, cornering(fighter).tan));
}

/**
 * The pace (m/s) at which a runner who has `angle` rad still to turn can take it in `corner.room` m of his way: the arc of a turn is its
 * radius (v² over the sideways acceleration he can give) × the angle, so v = √(accel × room / angle). A small angle is no limit at all
 * (his pace as it is); a right angle at a sprint's grip is ~4 m/s, a U-turn ~3.
 */
export function cornerPace(fighter, angle, room = WORLD.gait.corner.room) {
  if (angle < 1e-3) return Infinity;
  return Math.sqrt((cornering(fighter).accel * room) / angle);
}

/** The share (0..1) of the grip a sideways acceleration `lateral` (m/s²) has used: the forward push has the rest, as the root of what is left of a circle (gathering speed in a hard turn). */
export function cornerShare(fighter, lateral) {
  const used = Math.min(1, Math.abs(lateral) / Math.max(1e-6, cornering(fighter).accel));
  return Math.sqrt(1 - used * used);
}

/**
 * A hurt leg in the run: the swing of the other (the time on the hurt one) is cut short and the step is shorter, by how
 * much weaker it is than the sound leg. A share of the step's seconds and of its length.
 */
export function limpOf(fighter, swinging) {
  const shares = limbShares(fighter);
  const stance = swinging === 'l' ? shares.leg.r : shares.leg.l;
  const other = swinging === 'l' ? shares.leg.l : shares.leg.r;
  const short = Math.max(0, Math.min(1, other - stance));
  return { seconds: 1 - WORLD.gait.limp.seconds * short, length: 1 - WORLD.gait.limp.length * short };
}

/**
 * Where each foot is fore and aft of his hips (m, along his heading), whether it is down, and the thigh's angle from hanging
 * (rad, forward positive).
 */
function legsNow(fighter) {
  const x = fighter.x;
  const forward = [Math.cos(fighter.yaw), -Math.sin(fighter.yaw)];
  const along = (index, from) => (x[index * 3] - x[from * 3]) * forward[0] + (x[index * 3 + 2] - x[from * 3 + 2]) * forward[1];
  const out = {};
  for (const side of ['l', 'r']) {
    const hip = P[`${side}Hip`];
    const knee = P[`${side}Knee`];
    const foot = P[`${side}Foot`];
    out[side] = {
      ahead: along(foot, P.pelvis),
      down: Boolean(fighter.feet?.[side]) && !fighter.feet[side].step && !fighter.feet[side].lifted,
      thigh: Math.atan2(along(knee, hip), Math.max(1e-3, x[hip * 3 + 1] - x[knee * 3 + 1])),
    };
  }
  return out;
}

/** Half his track (m): each foot off his line by his hips' span or his thighs' girth, whichever is more, narrower running. */
export function halfTrack(fighter, runShare) {
  const spec = WORLD.gait.pose.track;
  const body = fighter.body;
  const thigh = body.segments?.lThigh?.skinRadius ?? 0.07;
  return Math.max(spec.hip * body.lengths.hipSpan / 2, spec.thigh * thigh) * (1 - spec.run * runShare);
}

/** How strongly his arms must answer his legs (WORLD.gait.pose.arms): the root of the legs' turning inertia over the arms', against a typical man's. */
function armInertia(body) {
  const spec = WORLD.gait.pose.arms;
  const leg = (body.limbKg?.lLeg ?? 1) * (body.lengths.thigh + body.lengths.shank) ** 2;
  const arm = (body.limbKg?.lArm ?? 0.35) * (body.lengths.upperArm + body.lengths.forearmToFist) ** 2;
  return Math.max(spec.inertiaRange[0], Math.min(spec.inertiaRange[1], Math.sqrt(leg / arm / spec.inertiaRef)));
}

/**
 * A free arm in the walk or the run (WORLD.gait.pose.arms, WORLD.runMode.arms): `flex`, the upper arm's swing from hanging (rad,
 * forward positive), as the opposite thigh's angle times the walk's or the run's share and his legs' weight for his arms; the
 * elbow bent as a walker's (straighter, more the faster) or a runner's; `abduct`, out from his side as far as his girth makes
 * it hang. `runShare` 0 a walk, 1 a run.
 */
export function gaitArm(fighter, side, runShare) {
  const spec = WORLD.gait.pose.arms;
  const run = WORLD.runMode.arms;
  const legs = legsNow(fighter);
  const opposite = legs[side === 'l' ? 'r' : 'l'].thigh;
  const speed = Math.hypot(fighter.rootVelocity[0], fighter.rootVelocity[1]);
  const froude = Math.min(WORLD.gait.walkRun, (speed * speed) / (WORLD.gravity * hipHeightOf(fighter)));
  const share = spec.walk + (spec.run - spec.walk) * runShare;
  const swing = Math.max(-run.most, Math.min(run.most, share * armInertia(fighter.body) * opposite));
  const forward = Math.max(-1, Math.min(1, swing / Math.max(0.2, run.most)));
  const walkElbow = spec.walkElbow + spec.walkElbowFroude * froude + spec.walkElbowSwing * Math.max(0, forward);
  const runElbow = run.elbow + run.elbowSwing * forward;
  return {
    flex: run.centre * runShare + swing,
    elbow: walkElbow + (runElbow - walkElbow) * runShare,
    abduct: Math.max(run.abduct, restArmAngle(fighter.body)),
    forward,
  };
}

/**
 * The head on his neck (WORLD.gait.pose.head): a mass on a damped spring, carried by his trunk. His hips' acceleration (local:
 * forward, up, to his left; smoothed over `smooth` s) shakes it: it lags as he speeds up, nods on as he brakes, drops at each
 * footfall and rebounds, steadied by his neck in a nod or two (a stronger neck for its head, a stiffer spring). The offset (m, local).
 */
export function headToss(fighter, dt) {
  const spec = WORLD.gait.pose.head;
  const body = fighter.body;
  const x = fighter.x;
  const at = [x[P.pelvis * 3], x[P.pelvis * 3 + 1], x[P.pelvis * 3 + 2]];
  const state = (fighter.gaitHead ??= { was: at, velocity: [0, 0, 0], accel: [0, 0, 0], offset: [0, 0, 0], rate: [0, 0, 0] });
  if (dt <= 0) return state.offset;
  const velocity = [(at[0] - state.was[0]) / dt, (at[1] - state.was[1]) / dt, (at[2] - state.was[2]) / dt];
  const raw = [(velocity[0] - state.velocity[0]) / dt, (velocity[1] - state.velocity[1]) / dt, (velocity[2] - state.velocity[2]) / dt];
  state.was = at;
  state.velocity = velocity;
  const ease = 1 - Math.exp(-dt / spec.smooth);
  for (let axis = 0; axis < 3; axis += 1) state.accel[axis] += (raw[axis] - state.accel[axis]) * ease;
  // (Into his own frame: forward, up, to his left.)
  const cos = Math.cos(fighter.yaw);
  const sin = Math.sin(fighter.yaw);
  const local = [state.accel[0] * cos - state.accel[2] * sin, state.accel[1], state.accel[0] * sin + state.accel[2] * cos];
  const force = (body.muscleForce ?? body.motorForce)[P.neck];
  const omega = 2 * Math.PI * spec.hz * Math.sqrt(Math.max(0.1, force / Math.max(1, body.headMass ?? 5) / spec.neckRef));
  const most = spec.most * body.heightM;
  // (Integrated in small steps: the spring is stiff for a step of the world's.)
  const steps = Math.max(1, Math.ceil((dt * omega) / 0.3));
  const h = dt / steps;
  for (let k = 0; k < steps; k += 1) {
    for (let axis = 0; axis < 3; axis += 1) {
      const accel = -local[axis] - omega * omega * state.offset[axis] - 2 * spec.damping * omega * state.rate[axis];
      state.rate[axis] += accel * h;
      state.offset[axis] = Math.max(-most, Math.min(most, state.offset[axis] + state.rate[axis] * h));
    }
  }
  return state.offset;
}

/** The head's spring at rest again (out of the gait, so that a walk begun later starts from a still head). */
export function stillHead(fighter) {
  fighter.gaitHead = undefined;
}

/**
 * The body over the legs in the walk and the run (WORLD.gait.pose), all from his build and what his legs are doing now:
 * `runShare` (0 a walk, 1 a run, eased over `blend` s), `width` (the stance's, from his track), `dip` (share of height: the walk's
 * vault over the stance leg, the run's bob, the stop's sit), `sway` (m to his left: out over the stance foot), `hipRoll` (rad, left
 * hip up: the swinging side's hip drops), `hipYaw` (rad: the pelvis turned with the legs), `twist` (the shoulders against it) and
 * `head` (the head's toss, m, local).
 */
export function gaitPose(fighter, dt) {
  const spec = WORLD.gait.pose;
  const body = fighter.body;
  const H = body.heightM;
  const L = gaitOf(fighter).legLength;
  const speed = Math.hypot(fighter.rootVelocity[0], fighter.rootVelocity[1]);
  const running = gaitKind(fighter, speed) ? 1 : 0;
  const was = fighter.gaitRunShare ?? running;
  const runShare = was + (running - was) * (1 - Math.exp(-dt / WORLD.gait.blend));
  fighter.gaitRunShare = runShare;
  const legs = legsNow(fighter);
  const track = halfTrack(fighter, runShare);
  // The walk's vault: the hips as high as a straight leg to the foot planted ahead of them lets them be.
  const reach = spec.reach * L;
  let vault = 0;
  for (const side of ['l', 'r']) {
    const leg = legs[side];
    if (!leg.down || leg.ahead <= 0) continue;
    const flat = Math.min(reach * 0.95, Math.hypot(leg.ahead, track));
    vault = Math.max(vault, reach - Math.sqrt(reach * reach - flat * flat) - (reach - Math.sqrt(reach * reach - track * track)));
  }
  // The run's bob: up as the feet part (the flight), down as they pass.
  const spread = Math.min(1, Math.abs(legs.l.ahead - legs.r.ahead) / (0.5 * H));
  const braking = Math.min(1, Math.max(0, -(fighter.gaitAccel ?? 0)) / WORLD.gravity);
  const dip = (1 - runShare) * (spec.vault * vault) / H + runShare * (WORLD.runMode.dip + WORLD.runMode.bob * (1 - spread)) + WORLD.gait.brakeDip * braking;
  // On one foot, out over it: the side it is on (+1 his left), settling as an inverted pendulum.
  const support = legs.l.down && !legs.r.down ? 1 : legs.r.down && !legs.l.down ? -1 : 0;
  const swayTime = Math.sqrt(hipHeightOf(fighter) / WORLD.gravity) * spec.swayTime;
  const swayWanted = support * track * spec.sway * (1 - spec.runSway * runShare);
  const hipForce = (body.muscleForce ?? body.motorForce)[P.lHip] / (body.massKg * WORLD.gravity);
  const listWanted = -support * Math.min(spec.listMost, spec.list * spec.listRef / Math.max(0.5, hipForce)) * (1 - runShare * 0.5);
  const ease = 1 - Math.exp(-dt / Math.max(1e-3, swayTime));
  fighter.gaitSway = (fighter.gaitSway ?? 0) + (swayWanted - (fighter.gaitSway ?? 0)) * ease;
  fighter.gaitList = (fighter.gaitList ?? 0) + (listWanted - (fighter.gaitList ?? 0)) * ease;
  // The pelvis turns with the legs, the forward leg's hip forward; the shoulders the other way.
  const apart = (legs.l.ahead - legs.r.ahead) / L;
  const hipYaw = Math.max(-spec.pelvisMost, Math.min(spec.pelvisMost, spec.pelvis * apart));
  return {
    runShare,
    width: track / (0.0675 * H),
    dip,
    sway: fighter.gaitSway,
    hipRoll: fighter.gaitList,
    hipYaw,
    twist: -spec.thorax * hipYaw,
    head: headToss(fighter, dt),
  };
}
