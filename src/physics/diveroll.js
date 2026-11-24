// A forward roll, as a body makes one: the dive onto the hands, the tuck, the roll over one shoulder and across the back, and
// the momentum carried up onto the feet. Nothing in it is a pose sequence played to a button: what the muscles chase each step
// is a body shape (a crouch, the dive's stretch, the tuck) turned about a diagonal axis by an angle and carried at a centre of
// mass, and that angle and centre come from a small rigid-body model of his own body run alongside his particles:
//
// - Whether he rolls at all: he must be going forward faster than a step can catch (the capture point of his speed, his centre's
//   height over g, past `catch` of his leg length), and pushing forward (the step out with his stick forward, the AI closing on a
//   big swing, or carried on from a jump that lands with speed). Standing, the step out stays a step.
// - The takeoff: his legs' jump (physics/jump.js jumpOf: their force over all he weighs, their fast fibres, worn joints, hurt
//   legs, what his armour lets them do), pushed out along the dive, on top of the speed he had; the flight is ballistic until
//   the hands of the dive's stretch reach the floor ahead. So a run gives a longer dive than a walk, a heavy man a short one.
// - The hands: his arms take the fall of his body, eccentrically, over the bend of their elbows (riseForces: his own arm muscle,
//   as hurt and tired as it is; the bend as far as his aged joints still fold). What they cannot take reaches the floor through
//   his shoulder (the slam): a weak or heavy man's arms give, and he lands harder. Past his bones' share (bone density, aged
//   or brittle) it hurts him; past more, the roll is lost and he goes down.
// - The roll: his tucked body is a rolling, lumpy wheel. Its radius is where its lowest part touches the floor (from his own
//   limb lengths and flesh, as tightly as his joints and armour let him fold); its moment of inertia is his particles' masses
//   about the roll's axis; its losses are rolling resistance, more for a back that will not round (old joints, a cuirass,
//   a belly in the way). The energy he came in with (and the height he falls through) is spent rolling over and rising onto
//   his feet; if it runs out before his feet come under him he ends on his back, down, and rises as from any fall.
// - The rise: once his feet are under him he stands as anyone does from a crouch (physics/rising.js `stand`), as fast as his
//   legs are for his weight, sooner the more of his roll's momentum he still carries.
// - Anything that stops the body (a blow, a man or a wall in the way) is seen as his particles leaving the model's line: the
//   roll is lost and he goes over (physics.js fall), carrying what speed his parts have.
// Tuning: WORLD.diveRoll (physics/config.js).

import { P, PARTICLES } from '../body.js';
import { addDamage, fall, limbShares, plantFeet, point } from '../physics.js';
import { clampReach, twoBoneIK, vec } from '../pose.js';
import { turnAbout } from '../joints.js';
import { jumpBodyOf, jumpOf } from './jump.js';
import { drawStamina } from './overdraft.js';
import { riseForces, riseMargins, stagePace } from './rising.js';
import { WORLD } from './config.js';

const ROLL_PARTS = PARTICLES.length;
const ROLL_G = 9.81;
const ROLL_TURN = 2 * Math.PI;
const rollClamp = (value) => Math.max(0, Math.min(1, value));
const rollEase = (u) => u * u * (3 - 2 * u);

/** His total mass with all he wears (kg), and his centre of mass's height standing (m, share of his height). */
function rollMass(fighter) {
  return fighter.body.masses.reduce((sum, mass) => sum + mass, 0);
}

/**
 * How tightly he can fold into a tuck (0 not at all, 1 a gymnast's): `fold` of a full fold, as his aged joints still bend
 * (body.joints), as his armour lets his hips and knees close (gear.foot, the share of his footwork plate leaves him: its
 * joints fold less far, as rising.js holds), and less again as the belly stops his thighs meeting his chest (fat past `fatFrom`).
 */
export function tuckFold(body) {
  const spec = WORLD.diveRoll.tuck;
  const fat = Math.max(0, (body.inputs.bodyFat ?? 0.15) - spec.fatFrom);
  return rollClamp(spec.fold * (body.joints ?? 1) * (body.gear.foot ?? 1) * (1 - spec.fat * fat));
}

// ---- The shapes his muscles chase, in his own frame (x along the roll, y up, z to his left), centred on his centre of mass.

/** Positions for the legs and arms from a pelvis-centred trunk: `limbs(out, L, H)` fills what the shape has not. */
function rollCentred(fighter, out) {
  const masses = fighter.body.masses;
  let kg = 0;
  const centre = [0, 0, 0];
  for (let index = 0; index < ROLL_PARTS; index += 1) {
    kg += masses[index];
    for (let axis = 0; axis < 3; axis += 1) centre[axis] += out[index][axis] * masses[index];
  }
  for (let axis = 0; axis < 3; axis += 1) centre[axis] /= kg;
  return out.map((position) => vec.sub(position, centre));
}

/** The trunk, shoulders and head on a pelvis at the origin, the trunk along `along`, the head along `headDir`. */
function rollTrunk(fighter, out, along, headDir) {
  const L = fighter.body.lengths;
  const H = fighter.body.heightM;
  out[P.pelvis] = [0, 0, 0];
  out[P.neck] = vec.scale(along, L.trunk);
  out[P.head] = vec.add(out[P.neck], vec.scale(vec.normalize(headDir), L.neckToHead));
  for (const [side, sign] of [['l', 1], ['r', -1]]) {
    out[P[`${side}Shoulder`]] = vec.add(vec.sub(out[P.neck], vec.scale(along, 0.025 * H)), [0, 0, (sign * L.shoulderSpan) / 2]);
    out[P[`${side}Hip`]] = [0, 0, (sign * L.hipSpan) / 2];
  }
}

function rollArm(fighter, out, side, sign, wanted, pole) {
  const L = fighter.body.lengths;
  const shoulder = out[P[`${side}Shoulder`]];
  const hand = clampReach(shoulder, wanted, (L.upperArm + L.forearmToFist) * 0.97);
  out[P[`${side}Hand`]] = hand;
  out[P[`${side}Elbow`]] = twoBoneIK(shoulder, hand, L.upperArm, L.forearmToFist, [pole[0], pole[1], sign * pole[2]]);
}

function rollLeg(fighter, out, side, sign, foot, pole) {
  const L = fighter.body.lengths;
  out[P[`${side}Foot`]] = foot;
  out[P[`${side}Knee`]] = twoBoneIK(out[P[`${side}Hip`]], foot, L.thigh, L.shank, [pole[0], pole[1], sign * pole[2]]);
}

/** The crouch he gathers into, and comes up into: knees bent, the trunk leaning forward, the hands reaching down ahead. */
function rollCrouch(fighter) {
  const spec = WORLD.diveRoll.shape.crouch;
  const L = fighter.body.lengths;
  const out = new Array(ROLL_PARTS);
  const along = [Math.sin(spec.lean), Math.cos(spec.lean), 0];
  rollTrunk(fighter, out, along, vec.add(along, [0.25, 0, 0]));
  const reach = (L.upperArm + L.forearmToFist) * 0.92;
  const legs = (ahead) => {
    for (const [side, sign] of [['l', 1], ['r', -1]]) rollLeg(fighter, out, side, sign, [ahead, -(L.thigh + L.shank) * spec.legs, (sign * L.hipSpan) / 2 * 1.15], [1, 0.3, 0.2]);
  };
  for (const [side, sign] of [['l', 1], ['r', -1]]) rollArm(fighter, out, side, sign, vec.add(out[P[`${side}Shoulder`]], vec.scale(vec.normalize([1, -1.1, 0]), reach)), [-0.4, -0.2, 1]);
  // The feet under his centre of mass (and `footAhead` of a thigh before it), so that he balances on them and can stand off them.
  legs(0);
  const centre = vec.scale(out[P.pelvis], 0).map((_, axis) => out.reduce((sum, position, index) => sum + position[axis] * fighter.body.masses[index], 0) / fighter.body.masses.reduce((a, b) => a + b, 0));
  legs(centre[0] + spec.footAhead * L.thigh);
  return rollCentred(fighter, out);
}

/** The dive's stretch: the legs straight behind, the arms reaching out ahead of the chest (turned forward by the roll's angle, they reach down to the floor ahead). */
function rollDive(fighter) {
  const spec = WORLD.diveRoll.shape.dive;
  const L = fighter.body.lengths;
  const out = new Array(ROLL_PARTS);
  const along = [Math.sin(spec.arch), Math.cos(spec.arch), 0];
  rollTrunk(fighter, out, along, vec.add(along, [0.3, 0, 0]));
  const reach = (L.upperArm + L.forearmToFist) * 0.95;
  for (const [side, sign] of [['l', 1], ['r', -1]]) {
    rollArm(fighter, out, side, sign, vec.add(out[P[`${side}Shoulder`]], vec.scale(vec.normalize([1, spec.hands, sign * 0.05]), reach)), [-0.3, 0, 1]);
    rollLeg(fighter, out, side, sign, vec.add(out[P[`${side}Hip`]], vec.scale(vec.normalize([-spec.legsBack, -1, 0]), (L.thigh + L.shank) * 0.96)), [1, 0, 0.1]);
  }
  return rollCentred(fighter, out);
}

/**
 * The tuck, as tight as he can make it (`fold`, tuckFold): the back rounded, the chin on the chest (unless a helmet bolted
 * to his cuirass holds the head: gear.headLocked), the thighs drawn up to the chest and the heels to the seat, the hands on
 * the shins. The head turns away from the shoulder he rolls over (`side`: his left +1) so it is the shoulder, not the neck, that meets the floor.
 */
function rollTuck(fighter, fold, side) {
  const spec = WORLD.diveRoll.shape.tuck;
  const L = fighter.body.lengths;
  const out = new Array(ROLL_PARTS);
  const along = vec.normalize([spec.curl * fold, 1, 0]);
  // The head bowed forward off the trunk's line by `chin` rad (inside the neck's cone, WORLD.headCone) and turned aside.
  const chin = fighter.body.gear.headLocked ? 0 : fold;
  const bowed = spec.chin * chin;
  const forward = [along[1], -along[0], 0];
  const head = vec.add(vec.add(vec.scale(along, Math.cos(bowed)), vec.scale(forward, Math.sin(bowed))), [0, 0, -side * Math.sin(spec.headAside * chin)]);
  rollTrunk(fighter, out, along, head);
  out[P.neck] = vec.scale(out[P.neck], 1 - 0.08 * fold);
  const hip = -Math.PI / 2 + spec.hip * fold;
  const inner = Math.PI - spec.knee * fold;
  const thigh = [Math.cos(hip), Math.sin(hip), 0];
  const shank = turnAbout(thigh, [0, 0, 1], -(Math.PI - inner));
  for (const [limb, sign] of [['l', 1], ['r', -1]]) {
    const knee = vec.add(out[P[`${limb}Hip`]], vec.scale(thigh, L.thigh));
    const foot = vec.add(knee, vec.scale(shank, L.shank));
    rollLeg(fighter, out, limb, sign, [foot[0], foot[1], foot[2] * 1.1], [1, 0.5, 0.2]);
    rollArm(fighter, out, limb, sign, vec.add(vec.lerp(out[P[`${limb}Knee`]], out[P[`${limb}Foot`]], 0.4), [0, 0, sign * 0.03]), [-0.5, -0.3, 1]);
  }
  return rollCentred(fighter, out);
}

/** The shapes for his body, built once per body (and per side). */
function rollShapes(fighter, side) {
  const key = `${side}`;
  const cache = fighter.diveRollShapes;
  if (cache?.body === fighter.body && cache[key]) return cache[key];
  const fold = tuckFold(fighter.body);
  const shapes = { crouch: rollCrouch(fighter), dive: rollDive(fighter), tuck: rollTuck(fighter, fold, side), fold };
  // The tuck's rolling radius: how high its centre rides over the floor, on average over the turn from the shoulder to the
  // feet. (The skeleton's straight trunk would ride up onto the neck when inverted; the real back is a curve between the
  // shoulder blade and the opposite hip, so the roll rides on the mean, and what is not round is the roll's `unround` loss.)
  const bank = -side * WORLD.diveRoll.diagonal.walk;
  const spec = WORLD.diveRoll;
  const from = spec.dive.reach + spec.hands.turn;
  const to = ROLL_TURN - spec.roll.open;
  let sum = 0;
  let peak = { height: -Infinity, angle: Math.PI };
  for (let step = 0; step <= 12; step += 1) {
    const angle = from + ((to - from) * step) / 12;
    const height = rollSupport(fighter, rollTurned(shapes.tuck, bank, angle));
    sum += height;
    if (height > peak.height) peak = { height, angle };
  }
  shapes.radius = Math.max(spec.roll.leastRadius, sum / 13);
  // Its hump: where the hips come over the shoulders the centre rides highest (the tuck is longer than it is thick), and a roll
  // too slow to carry him over it rocks back off it.
  shapes.hump = Math.max(0, peak.height - shapes.radius);
  shapes.peak = peak.angle;
  shapes.crouchHeight = rollSupport(fighter, shapes.crouch);
  fighter.diveRollShapes = { ...(cache?.body === fighter.body ? cache : {}), body: fighter.body, [key]: shapes };
  return shapes;
}

// The roll turns him about the axis across him (z), as the floor sees it; for a roll over one shoulder his body is first banked
// about the way he goes (x), so the line from that shoulder to the other hip lies in the plane he rolls in.
const ROLL_FORE = [1, 0, 0];
const ROLL_ACROSS = [0, 0, 1];

/** A shape banked `bank` rad (his rolling shoulder down: -side × the diagonal) and turned forward by `angle` (the head going forward and down). */
function rollTurned(shape, bank, angle) {
  return shape.map((position) => turnAbout(turnAbout(position, ROLL_FORE, bank), ROLL_ACROSS, -angle));
}

/** How far he is banked now: none in the gather and the dive, into it over the hands, out of it as the tuck opens to the crouch. */
function rollBank(model) {
  const spec = WORLD.diveRoll;
  const full = -model.side * model.diagonal;
  if (model.phase === 'hands') return full * rollEase(rollClamp((model.angle - model.touch) / spec.hands.turn));
  if (model.phase !== 'roll') return 0;
  const open = ROLL_TURN - spec.roll.open;
  return model.angle < open ? full : full * (1 - rollEase(rollClamp((model.angle - open) / spec.roll.open)));
}

function rollBlend(a, b, u) {
  return a.map((position, index) => vec.lerp(position, b[index], u));
}

/** How high his centre of mass stands over the floor with this shape (turned) resting on it: the lowest part's surface on it. */
function rollSupport(fighter, positions) {
  let low = Infinity;
  for (let index = 0; index < ROLL_PARTS; index += 1) low = Math.min(low, positions[index][1] - fighter.radius[index]);
  return -low;
}

/** His moment of inertia (kg m²) about the roll's axis through his centre, in this shape: his own particles' masses. */
function rollInertia(fighter, positions, axis) {
  let sum = 0;
  for (let index = 0; index < ROLL_PARTS; index += 1) {
    const r = positions[index];
    const along = vec.dot(r, axis);
    sum += fighter.body.masses[index] * (vec.dot(r, r) - along * along);
  }
  return sum;
}

// ---- The model of the roll: phase, centre, speed and angle, the same for the game's step and the outlook ahead of it.

/** The shape (unturned) for the model's phase and how far through it he is. */
function rollShapeNow(model, shapes) {
  if (model.phase === 'gather') return rollBlend(model.from ?? shapes.crouch, shapes.crouch, rollEase(rollClamp(model.t / model.gather)));
  if (model.phase === 'air') return rollBlend(shapes.crouch, shapes.dive, rollEase(rollClamp(model.angle / WORLD.diveRoll.dive.reach)));
  if (model.phase === 'hands') {
    // The chin goes to the chest first (`headFirst` × as fast as the rest folds), before the head can reach the floor.
    const u = rollClamp((model.angle - model.touch) / WORLD.diveRoll.hands.turn);
    const head = rollEase(rollClamp(u * WORLD.diveRoll.hands.headFirst));
    return shapes.dive.map((position, index) => vec.lerp(position, shapes.tuck[index], index === P.head ? head : rollEase(u)));
  }
  const spec = WORLD.diveRoll.roll;
  const open = ROLL_TURN - spec.open;
  return model.angle < open ? shapes.tuck : rollBlend(shapes.tuck, shapes.crouch, rollEase(rollClamp((model.angle - open) / spec.open)));
}

/**
 * What his body brings to a roll now: his mass, his legs' takeoff (jumpOf), what his arms can take (eccentric force × the
 * bend of the elbows, as far as aged joints fold), his bones (density), his tuck, and the roll's losses.
 */
export function diveRollBody(fighter, { legs = limbShares(fighter).leg, strength = fighter.motorScale ?? 1 } = {}) {
  const spec = WORLD.diveRoll;
  const body = fighter.body;
  const L = body.lengths;
  const kg = rollMass(fighter);
  const jump = jumpOf(fighter, { legs, strength });
  const forces = riseForces(fighter, strength);
  const joints = body.joints ?? 1;
  const fold = tuckFold(body);
  // Rolling resistance: a round back rolls, a flat or plated one bumps over its edges (each bump the energy of the drop off it).
  const loss = spec.roll.loss + spec.roll.unround * (1 - fold) + spec.roll.plate * (1 - (body.gear.foot ?? 1));
  return {
    kg,
    jump,
    legLength: L.thigh + L.shank,
    shortening: jumpBodyOf(fighter).shortening,
    // Both legs' push over all he weighs, as sound and strong as they are now (the rock up onto the feet is theirs).
    legs: 2 * jumpBodyOf(fighter).legForce * Math.max(0, (legs.l + legs.r) / 2) * Math.max(0, Math.min(1, strength)) * jumpBodyOf(fighter).joints,
    armForce: (forces.arm.l + forces.arm.r) * spec.hands.eccentric,
    armGive: spec.hands.give * (L.upperArm + L.forearmToFist) * (spec.hands.jointShare + (1 - spec.hands.jointShare) * joints),
    bone: Math.max(0.35, body.boneDensity ?? 1),
    fold,
    loss,
  };
}

/**
 * The model at the start of a roll: going `speed` m/s along `dir` ([x, z], unit), his centre `centre` (world), the shoulder
 * he rolls over `side`. The dive's angle across him (`diagonal`) grows with his speed: from a walk he goes over the back of
 * the shoulder, from a run across it (the references: a walking roll near straight, a running one over one shoulder).
 */
export function diveRollModel(fighter, { speed, dir, centre, side, from = null, lift = 0, gathered = false }) {
  const spec = WORLD.diveRoll;
  const capacity = diveRollBody(fighter);
  const fast = rollClamp((speed - spec.diagonal.from) / (spec.diagonal.run - spec.diagonal.from));
  const diagonal = spec.diagonal.walk + (spec.diagonal.most - spec.diagonal.walk) * fast;
  // The gather: the jump's own crouch, shallower and quicker at speed (WORLD.jump.crouch, as a running takeoff); from a landing, none.
  const running = Math.max(WORLD.jump.crouch.running, 1 - speed / WORLD.jump.crouch.fast);
  return {
    phase: gathered ? 'air' : 'gather', t: 0, elapsed: 0, side, diagonal, dir: [...dir], lift,
    centre: [...centre], v: [speed, 0], angle: 0, spin: 0, gather: spec.gather * WORLD.jump.crouch.seconds * running, running,
    capacity, from, flight: 0, touch: 0, energy: 0, slam: 0, travelled: 0, outcome: null, gathered,
  };
}

/**
 * The legs' push into the dive: their jump speed (jumpOf `v`) along the dive's angle; the forward part less as he already goes
 * nearer the speed his legs extend at (the foot on the floor goes back under him at his speed: it pushes only by what it is faster).
 */
function rollTakeoff(model, fighter) {
  const spec = WORLD.diveRoll.dive;
  const capacity = model.capacity;
  const v = capacity.jump.v * spec.legs;
  const top = spec.legTop * capacity.shortening;
  const forward = v * Math.cos(spec.angle) * rollClamp(1 - model.v[0] / top);
  model.v = [model.v[0] + forward, v * Math.sin(spec.angle)];
  const shapes = rollShapes(fighter, model.side);
  // The hands reach the floor when the stretch, turned forward `reach`, rests on it: the flight is the ballistic fall to that height.
  const dive = rollTurned(shapes.dive, 0, spec.reach);
  const low = rollSupport(fighter, dive);
  const above = Math.max(0, model.centre[1] - model.lift - low);
  const vy = model.v[1];
  model.flight = (vy + Math.sqrt(vy * vy + 2 * ROLL_G * above)) / ROLL_G;
  // Turned forward over the flight from the crouch (`angle` 0) to the reach: the push behind his centre pitches him.
  model.spin = spec.reach / Math.max(spec.leastFlight, model.flight);
  model.phase = 'air';
  model.t = 0;
}

/**
 * The hands on the floor: what the arms must take, the fall's vertical speed and his weight lowered through their bend to the
 * tuck's height (the share of him over the hands, `share`), against what they give over that bend. What they cannot take
 * comes onto his shoulder (`slam`, m/s). His way on is carried through the arms (`keep` of it), braked by the slam.
 */
function rollHandsDown(model, fighter, shapes) {
  const spec = WORLD.diveRoll.hands;
  const capacity = model.capacity;
  const kg = capacity.kg * spec.share;
  const falling = Math.max(0, -model.v[1]);
  const tuck = shapes.radius;
  const drop = Math.max(0, model.centre[1] - model.lift - tuck);
  // (They stop the fall, and lower `take` of his drop onto the shoulder; the rest of the drop he rolls into: the curve of the
  // tucked back turns a fall forward into turning, as a ball dropped on its edge rolls off.)
  const asked = 0.5 * kg * falling * falling + spec.take * kg * ROLL_G * drop;
  model.boost = (1 - spec.take) * capacity.kg * ROLL_G * drop;
  const given = capacity.armForce * capacity.armGive;
  const over = Math.max(0, asked - given);
  model.armRatio = asked / Math.max(1, given);
  model.slam = Math.sqrt((2 * over) / kg);
  model.v = [Math.max(0, model.v[0] * spec.keep * (1 - WORLD.diveRoll.slam.brake * Math.min(1, model.slam / Math.max(1, falling + 1)))), 0];
  model.touch = model.angle;
  model.contact = model.centre[1] - model.lift;
  model.reach = vec.length(shapes.dive[P.lHand]);
  model.phase = 'hands';
  model.t = 0;
}

/** How high the centre rides on the floor: lowered by the arms from the hands' reach to the tuck's radius, then the radius, then up into the crouch. */
function rollRide(model, shapes) {
  if (model.phase === 'hands') return model.contact + (shapes.radius - model.contact) * rollEase(rollClamp((model.angle - model.touch) / WORLD.diveRoll.hands.turn));
  const open = ROLL_TURN - WORLD.diveRoll.roll.open;
  if (model.angle < open) {
    const off = (model.angle - shapes.peak) / WORLD.diveRoll.roll.humpWidth;
    return shapes.radius + (Math.abs(off) < 0.5 ? shapes.hump * Math.cos(Math.PI * off) ** 2 : 0);
  }
  return shapes.radius + (shapes.crouchHeight - shapes.radius) * rollEase(rollClamp((model.angle - open) / WORLD.diveRoll.roll.open));
}

/** The energy of the rolling body (J): its way on and its turning about the contact, and its height. */
function rollEnergy(model, inertiaNow, radius) {
  const kg = model.capacity.kg;
  const v = model.v[0];
  return 0.5 * kg * v * v * (1 + inertiaNow / (kg * radius * radius)) + kg * ROLL_G * (model.centre[1] - model.lift);
}

/**
 * One step of the model. Returns the outcome once there is one: 'rise' (his feet under him: `carry` the speed he has left),
 * 'slammed' (the arms gave and the shoulder took more than he can), 'stalled' (on his back, out of momentum).
 */
export function stepDiveRollModel(model, fighter, dt) {
  const spec = WORLD.diveRoll;
  const shapes = rollShapes(fighter, model.side);
  model.t += dt;
  model.elapsed += dt;
  const along = (distance) => {
    model.centre[0] += model.dir[0] * distance;
    model.centre[2] += model.dir[1] * distance;
    model.travelled += distance;
  };
  if (model.phase === 'gather') {
    along(model.v[0] * dt);
    // Down into the crouch and up out of it as the legs drive: the centre dips (`running` of the way to the crouch's height on its
    // feet, a running takeoff's shallow dip) and is back at its height, the legs straight, as the feet leave the floor.
    model.stand ??= model.centre[1];
    const dip = Math.max(0, model.stand - model.lift - rollSupport(fighter, shapes.crouch)) * model.running;
    model.centre[1] = model.stand - dip * Math.sin(Math.PI * rollClamp(model.t / model.gather));
    if (model.t >= model.gather) {
      model.centre[1] = model.stand;
      rollTakeoff(model, fighter);
    }
    return null;
  }
  if (model.phase === 'air') {
    along(model.v[0] * dt);
    model.v[1] -= ROLL_G * dt;
    model.centre[1] += model.v[1] * dt;
    model.angle += model.spin * dt;
    const shape = rollTurned(rollShapeNow(model, shapes), rollBank(model), model.angle);
    if (model.centre[1] - model.lift <= rollSupport(fighter, shape) && model.v[1] <= 0) {
      model.centre[1] = model.lift + rollSupport(fighter, shape);
      model.dive = model.travelled;
      rollHandsDown(model, fighter, shapes);
      if (model.slam > spec.slam.fallFrom * model.capacity.bone) return (model.outcome = 'slammed');
    }
    return null;
  }
  const shape = rollTurned(rollShapeNow(model, shapes), rollBank(model), model.angle);
  const height = rollRide(model, shapes);
  if (model.phase === 'hands') {
    // Over the hands: the body pivots on them at its way on over the reach, lowered by the arms onto the shoulder.
    along(model.v[0] * dt);
    model.angle += (model.v[0] / Math.max(0.3, model.reach)) * dt + spec.hands.least * dt;
    model.centre[1] = model.lift + height;
    if (model.angle - model.touch >= spec.hands.turn) {
      model.phase = 'roll';
      model.t = 0;
      const radius = Math.max(spec.roll.leastRadius, height);
      model.energy = rollEnergy(model, rollInertia(fighter, shape, ROLL_ACROSS), radius) + (model.boost ?? 0);
    }
    return null;
  }
  // Rolling: the energy he has, less the rolling resistance's work, paid out between his way on, his turning and his height.
  const radius = Math.max(spec.roll.leastRadius, height);
  const kg = model.capacity.kg;
  // (Rolling resistance, and the knocks of shoulder, back and hips meeting the floor in turn: each loses `knock` of the speed
  // its turning brings it down with, so the faster the spin the more is lost, v² / radius.)
  model.energy -= (model.capacity.loss * ROLL_G + spec.roll.knock * (model.v[0] * model.v[0]) / radius) * kg * model.v[0] * dt;
  // Coming round onto his feet, the heels drawn in and the trunk thrown forward over them: his legs' surplus over his weight
  // pays for the rise into the crouch, at up to `rock` m/s (a strong man rocks up, a weak or heavy one sinks back).
  if (model.angle >= ROLL_TURN - spec.roll.open) model.energy += Math.max(0, model.capacity.legs - 1) * kg * ROLL_G * spec.roll.rock * dt;
  const turning = 1 + rollInertia(fighter, shape, ROLL_ACROSS) / (kg * radius * radius);
  const kinetic = model.energy - kg * ROLL_G * height;
  model.v[0] = kinetic > 0 ? Math.sqrt((2 * kinetic) / (kg * turning)) : 0;
  model.centre[1] = model.lift + height;
  along(model.v[0] * dt);
  model.angle += (model.v[0] / radius) * dt;
  const feet = ROLL_TURN - spec.roll.feet;
  if (model.angle >= ROLL_TURN) {
    model.angle = ROLL_TURN;
    return (model.outcome = 'rise');
  }
  if (model.v[0] <= spec.roll.stall) {
    model.v[0] = 0;
    return (model.outcome = model.angle >= feet ? 'rise' : 'stalled');
  }
  return null;
}

/**
 * What a roll would come to from here, run on the model alone (the AI weighs it; tools and tests read it): the dive's length (m,
 * to the hands), the whole distance, the time to his feet, the arms' ratio (what the fall asks of them over what they give),
 * the slam on the shoulder (m/s), the outcome, and whether it is clean (on his feet, nothing hurt).
 */
export function diveRollOutlook(fighter, speed, { side = 1 } = {}) {
  const centre = [0, rollCentreHeight(fighter), 0];
  const model = diveRollModel(fighter, { speed, dir: [1, 0], centre, side });
  let outcome = null;
  for (let step = 0; step < 600 && !outcome; step += 1) outcome = stepDiveRollModel(model, fighter, 1 / 120);
  const spec = WORLD.diveRoll;
  const hurt = model.slam > spec.slam.harmFrom * model.capacity.bone;
  return {
    outcome: outcome ?? 'stalled', dive: model.dive ?? model.travelled, distance: model.travelled, seconds: model.elapsed, slam: model.slam,
    armRatio: model.armRatio ?? 0, carry: model.v[0], fold: model.capacity.fold, takeoff: model.capacity.jump.v,
    clean: outcome === 'rise' && !hurt && model.capacity.jump.can,
  };
}

/** His centre of mass's height over his floor now (m). */
function rollCentreHeight(fighter) {
  return rollCentreOf(fighter)[1] - (fighter.lift ?? 0);
}

function rollCentreOf(fighter) {
  const masses = fighter.body.masses;
  const centre = [0, 0, 0];
  let kg = 0;
  for (let index = 0; index < ROLL_PARTS; index += 1) {
    kg += masses[index];
    for (let axis = 0; axis < 3; axis += 1) centre[axis] += fighter.x[index * 3 + axis] * masses[index];
  }
  return vec.scale(centre, 1 / kg);
}

function rollCentreVelocity(fighter) {
  const masses = fighter.body.masses;
  const velocity = [0, 0, 0];
  let kg = 0;
  for (let index = 0; index < ROLL_PARTS; index += 1) {
    kg += masses[index];
    for (let axis = 0; axis < 3; axis += 1) velocity[axis] += fighter.v[index * 3 + axis] * masses[index];
  }
  return vec.scale(velocity, 1 / kg);
}

// ---- In the game.

/** His speed along the way he faces (m/s) and the unit way he is going ([x, z]). */
function rollForward(fighter) {
  const heading = [Math.cos(fighter.yaw), -Math.sin(fighter.yaw)];
  const [vx, vz] = fighter.rootVelocity;
  const speed = Math.hypot(vx, vz);
  const ahead = vx * heading[0] + vz * heading[1];
  return { ahead, speed, dir: speed > 0.2 ? [vx / speed, vz / speed] : heading };
}

/**
 * Would his step out be a roll: going forward (his way within `cone` of where he faces, and pushing on: `move` forward) faster
 * than a step can catch? A step catches him while his capture point (his speed × √(centre height / g)) is within `catch` of
 * his leg length; under a blow coming at him as he closes, `under` of that (he goes down under it, not out of its arc).
 * Not a body that cannot dive (legs too weak to leave the floor, a broken one, a machine or a beast's frame).
 */
export function wantsDiveRoll(world, fighter, striker = null) {
  const spec = WORLD.diveRoll;
  if (fighter.state !== 'up' || fighter.mount || fighter.jump || fighter.crawling || fighter.netted || fighter.diveRoll) return false;
  if (fighter.body.gear.machine || fighter.body.quadruped) return false;
  if ((fighter.move ?? 0) < spec.pushing && !fighter.rush) return false;
  const { ahead, speed } = rollForward(fighter);
  if (speed < 1e-3 || ahead < speed * Math.cos(spec.cone)) return false;
  const legLength = fighter.body.lengths.thigh + fighter.body.lengths.shank;
  const capture = ahead * Math.sqrt(Math.max(0.2, rollCentreHeight(fighter)) / ROLL_G);
  const reach = spec.catch * legLength * (striker?.punch && !striker.punch.landed ? spec.under : 1);
  if (capture < reach) return false;
  const model = jumpOf(fighter, { legs: limbShares(fighter).leg, strength: fighter.motorScale ?? 1 });
  // (Anyone but the man played stops at empty: he cannot pay for it.)
  if (!fighter.player && fighter.stamina < spec.costJumps * model.cost) return false;
  return model.can;
}

/**
 * Into the roll, along the way he is going. It costs `costJumps` of his own jump (his legs throw his body and gear), as the
 * step out does. `gathered`: already off the floor with his speed (a jump's landing rolled out): no crouch, straight to the hands.
 */
export function startDiveRoll(world, fighter, { gathered = false, aside = 0, reason = 'dives into a roll' } = {}) {
  const spec = WORLD.diveRoll;
  const motion = rollForward(fighter);
  // (`aside`: the legs push off the line he was going, rad to his left: his way on goes the new way only by its share along it.)
  const dir = [motion.dir[0] * Math.cos(aside) - motion.dir[1] * Math.sin(aside), motion.dir[0] * Math.sin(aside) + motion.dir[1] * Math.cos(aside)];
  const ahead = motion.ahead * Math.cos(aside);
  const centre = rollCentreOf(fighter);
  const side = fighter.weapon?.held && fighter.weapon.main === 'l' ? -1 : 1;
  const heading = [dir[0], 0, dir[1]];
  const yaw = Math.atan2(-heading[2], heading[0]);
  // The shape he starts from: his body as it stands now, in the roll's frame.
  const from = PARTICLES.map((_, index) => rollToFrame(vec.sub(point(fighter.x, index), centre), yaw));
  const model = diveRollModel(fighter, { speed: Math.max(0, ahead), dir, centre, side, from, lift: fighter.lift ?? 0, gathered });
  if (gathered) {
    const velocity = rollCentreVelocity(fighter);
    model.v = [Math.max(0, velocity[0] * dir[0] + velocity[2] * dir[1]), velocity[1]];
    model.flight = 0;
    model.spin = spec.dive.reach / spec.dive.leastFlight;
  }
  drawStamina(fighter, spec.costJumps * model.capacity.jump.cost);
  fighter.yaw = yaw;
  fighter.state = 'rising';
  fighter.diveRoll = { model, startedAt: world.time, yaw, targets: null, velocities: null, impulse: [0, 0, 0] };
  fighter.rise = null;
  fighter.punch = null;
  fighter.defence = null;
  fighter.guardHeld = false;
  fighter.rush = null;
  fighter.move = 0;
  fighter.strafe = 0;
  world.events.push({ time: world.time, kind: 'diveRoll', fighter: fighter.id, speed: model.v[0], effects: [reason] });
  return true;
}

/** A vector from the world into the roll's frame (x along the way, z to his left), and back. */
function rollToFrame(v, yaw) {
  const cos = Math.cos(yaw);
  const sin = Math.sin(yaw);
  return [v[0] * cos - v[2] * sin, v[1], v[0] * sin + v[2] * cos];
}

function rollFromFrame(v, yaw) {
  const cos = Math.cos(yaw);
  const sin = Math.sin(yaw);
  return [v[0] * cos + v[2] * sin, v[1], -v[0] * sin + v[2] * cos];
}

/** Where his muscles drive each part this substep, from the model's shape, angle and centre (all parts at once, on the first). */
export function diveRollTarget(fighter, index) {
  const roll = fighter.diveRoll;
  if (index === 0 || !roll.targets) {
    const model = roll.model;
    const shapes = rollShapes(fighter, model.side);
    const shape = rollShapeNow(model, shapes);
    const now = rollTurned(shape, rollBank(model), model.angle);
    const rate = model.phase === 'air' ? model.spin : model.phase === 'gather' ? 0 : model.phase === 'hands' ? model.v[0] / Math.max(0.3, model.reach ?? 0.8) : model.v[0] / Math.max(WORLD.diveRoll.roll.leastRadius, rollRide(model, shapes));
    const ahead = rollTurned(shape, rollBank(model), model.angle + 0.01);
    const along = [model.dir[0] * model.v[0], model.phase === 'air' ? model.v[1] : 0, model.dir[1] * model.v[0]];
    roll.targets = now.map((position) => vec.add(model.centre, rollFromFrame(position, roll.yaw)));
    roll.velocities = now.map((position, part) => vec.add(along, rollFromFrame(vec.scale(vec.sub(ahead[part], position), rate / 0.01), roll.yaw)));
    // Nothing is driven into the floor: a part the shape would put under it rests on it (the back flattening as it rolls over
    // it), and comes down onto it no faster than it is already coming (a rolling contact meets the floor, it does not strike it).
    for (let part = 0; part < ROLL_PARTS; part += 1) {
      const floor = model.lift + fighter.radius[part];
      if (roll.targets[part][1] < floor) {
        roll.targets[part][1] = floor;
        roll.velocities[part][1] = Math.max(0, roll.velocities[part][1]);
      }
    }
  }
  return { target: roll.targets[index], velocity: roll.velocities[index] };
}

/**
 * Each step of a roll (physics.js updateTimers, while he is in it): the model on, his root carried with it, and what ends it.
 * Returns null while he rolls; 'rise' once he is getting up from the crouch (fighter.rise set for rising.js's stand); 'fell'
 * when it was lost (he is down, as from any fall).
 */
export function updateDiveRoll(world, fighter, dt) {
  const spec = WORLD.diveRoll;
  const roll = fighter.diveRoll;
  const model = roll.model;
  roll.targets = null;
  // His body off the model's line (a blow, a man, a wall: the parts did not go where the roll did) and the roll is lost.
  const centre = rollCentreOf(fighter);
  const gap = Math.hypot(centre[0] - model.centre[0], centre[2] - model.centre[2]);
  if (model.phase !== 'gather' && gap > spec.breakGap * fighter.body.heightM) return rollLost(world, fighter, 'stopped in his roll');
  // A blow or a body met (the impulses delivered to him: physics.js deliverImpulse) changes his way on, as a whole body of his
  // mass: along it, his roll's speed; across it past `knockBreak` m/s, or brought to a stop, and the roll is lost.
  const kg = model.capacity.kg;
  const knock = vec.scale(roll.impulse, 1 / kg);
  roll.impulse = [0, 0, 0];
  const along = knock[0] * model.dir[0] + knock[2] * model.dir[1];
  const across = Math.hypot(knock[0] - along * model.dir[0], knock[2] - along * model.dir[1]);
  if (across > spec.knockBreak) return rollLost(world, fighter, 'knocked out of his roll');
  if (along < 0 && model.v[0] + along <= spec.roll.stall && model.phase !== 'gather') return rollLost(world, fighter, 'stopped in his roll');
  if (along !== 0 && model.phase !== 'gather') {
    const before = model.v[0];
    model.v[0] = Math.max(0, before + along);
    if (model.phase === 'roll') model.energy += 0.5 * kg * (model.v[0] * model.v[0] - before * before);
  }
  // Come round onto his feet: he settles into the crouch (what way on he has left carrying him, braked by his feet) until his hips
  // are up in it (`settled` of the crouch's height) or `settleMost` s have gone, then stands from it.
  if (model.outcome === 'rise') {
    model.settle = (model.settle ?? 0) + dt;
    const step = Math.min(model.v[0], spec.rise.brake * dt);
    model.carried = Math.max(model.carried ?? 0, model.v[0]);
    model.v[0] -= step;
    model.centre[0] += model.dir[0] * model.v[0] * dt;
    model.centre[2] += model.dir[1] * model.v[0] * dt;
    fighter.root = [model.centre[0], model.centre[2]];
    const hips = fighter.x[P.pelvis * 3 + 1] - model.lift;
    const crouched = model.centre[1] - model.lift + rollShapes(fighter, model.side).crouch[P.pelvis][1];
    if (hips < spec.rise.settled * crouched && model.settle < spec.rise.settleMost) return null;
    rollComeUp(world, fighter, model);
    return 'rise';
  }
  const outcome = stepDiveRollModel(model, fighter, dt);
  fighter.root = [model.centre[0], model.centre[2]];
  if (outcome === 'slammed') {
    rollHurtShoulder(world, fighter, model);
    return rollLost(world, fighter, 'his arms give: lands on his shoulder');
  }
  if (outcome === 'stalled') return rollLost(world, fighter, 'runs out of roll: on his back');
  if (outcome === 'rise' && model.slam > spec.slam.harmFrom * model.capacity.bone) rollHurtShoulder(world, fighter, model);
  if (model.elapsed > spec.most) return rollLost(world, fighter, 'tangled in his roll');
  return null;
}

/** The shoulder took what the arms did not: the trunk bruised by the slam past what his bones take (`harmFrom` × density). */
function rollHurtShoulder(world, fighter, model) {
  const spec = WORLD.diveRoll.slam;
  const past = model.slam - spec.harmFrom * model.capacity.bone;
  if (past <= 0 || model.hurt) return;
  model.hurt = true;
  addDamage(fighter, 'trunk', spec.harm * past, false);
}

function rollLost(world, fighter, reason) {
  fighter.diveRoll = null;
  fall(world, fighter, reason);
  return 'fell';
}

/**
 * Up from the roll: in the crouch, his feet under him, facing the way he rolled; rising.js's stand from there, as long as his
 * legs take for his weight (riseMargins, stagePace), and the shorter the more of his way on he still has (`carry` of the stand per
 * m/s left, at most `carryMost`).
 */
function rollComeUp(world, fighter, model) {
  const spec = WORLD.diveRoll.rise;
  fighter.diveRoll = null;
  fighter.yaw = Math.atan2(-model.dir[1], model.dir[0]);
  // He stands up over his feet.
  const feet = vec.lerp(point(fighter.x, P.lFoot), point(fighter.x, P.rFoot), 0.5);
  fighter.root = [feet[0], feet[2]];
  plantFeet(fighter);
  const lead = model.side > 0 ? 'l' : 'r';
  const margins = riseMargins(fighter, 1, lead);
  const seconds = (WORLD.rise.seconds.stand * stagePace(margins.stand) * (margins.braced ? WORLD.rise.braceSlow : 1)) / (fighter.body.gear.foot ?? 1);
  const from = PARTICLES.map((_, index) => point(fighter.x, index));
  const carry = Math.min(spec.carryMost, spec.carry * (model.carried ?? model.v[0]));
  fighter.rise = { stage: 'stand', t: carry * seconds, elapsed: 0, seconds, from, to: null, roll: null, lead, braced: margins.braced, tries: 0, margin: margins.stand, pushed: true, fromRoll: true };
  world.events.push({ time: world.time, kind: 'diveRollUp', fighter: fighter.id, travelled: model.travelled, seconds: model.elapsed, slam: model.slam, effects: ['rolls up onto his feet'] });
}
