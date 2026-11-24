// A blade stopped in a body is held by it (the user's call, 2026-11-24). One rule for every edge and point and every part:
// a cut or a thrust that goes in and does not go through is in the wound as deep as its energy took it, the tissue grips
// it, and until it is drawn the two men are joined through it.
//
// How deep (lodgeDepth): from what the section had left to give (physics.js limbResistance, trunkResistance: the flesh's
// joules and the bone's). An edge parts the near half of the flesh on its way to the bone, then goes into the bone as far
// as what is left of its energy takes it; so the depth is that share of the section's own width, and the same stroke that
// passes through a thin man's waist stops in the muscle or the spine of a broad one. A point goes in by its energy over
// the force it takes to drive it (`thrustN`), at most through the part or to the length of the blade.
//
// What holds it (lodgeHold, N to draw it):
//  - flesh closes on the faces of the blade: `flesh` Pa of shear over both faces of what is in (depth x the length of
//    edge engaged, or a point's width). Forensic stab tests give tens of newtons to draw a kitchen or hunting knife out
//    of muscle or a skin simulant, against 50-100 N and more to drive it in (Knight 1975, Forensic Science 6; O'Callaghan
//    et al. 1999, Forensic Sci. Int. 104; Gilchrist et al. 2008, Forensic Sci. Int. 177: penetration forces; the
//    withdrawal figure is from memory, unverified): 5 kPa gives a 2.5 cm blade 10 cm in about 25 N, a sword's width run
//    20 cm through a trunk about 60 N, a long edge sunk a hand's breadth across a waist a few hundred.
//  - bone wedges it: `bonePerM` N for each metre the edge is into bone, at most `boneMost`. A sword or an axe bitten
//    into a skull, a long bone or the spine is what men have had to stand on the body to free (the accounts are many
//    and unmeasured: the Wisby and Towton skulls show edges that went centimetres into bone; an axe in a log of green
//    wood takes several hundred newtons to a kilonewton to rock out, which is the order used; unverified);
//  - a point between the ribs or through the skull is pinched by them: `pinch` N.
//  No weapon here is barbed (weapons.js has no such head): a spec's `barbed` would multiply the hold by `barbs`.
//
// Drawing it (stepLodged): the man pulls with what his arms have on the grip (each hand's motor force, as tired and hurt
// as it is, both hands on a two-handed weapon) and with his weight if he steps back from the man it is in; only the
// part of that along the way the blade went in counts (`align`: a blade is drawn back down its own cut). Past `stick` of
// the hold it slides, the faster the more he has over it, and working at it loosens it (`loosen` s). Out, it opens the
// wound again (`reopen` of the bleeding the blow started).
//
// While it is in (holdLodged, each substep): the hand is kept on the blade's line at the wound, by moving the hand and
// the struck part toward each other by their masses, so each man drags the other; the blade keeps the line it went in on
// (in the struck part's own frame). A hand dragged further than it can follow for `tornSeconds` lets go; a man put down,
// knocked out or disarmed lets go; then the weapon stays in the body (the loose weapon rides the part it is in, and can
// be taken up once that man is down) and he goes on as any disarmed man does (rearm: his sidearm).

import { P } from '../body.js';
import { vec } from '../pose.js';
import { BLADES } from '../weapons.js';
import { bladeFor, dropOffWeapon, dropWeapon, limbShares, point, quatFromTo, toLocal } from '../physics.js';

export const LODGE = {
  // The least depth (m) at which a cut that stopped in flesh, and a thrust, are held at all: a slash that only opens the
  // skin and the fat under it is not. A cut into bone always is.
  least: { cut: 0.045, thrust: 0.05 },
  // A blade his stroke's own recovery would have out again within this (s: about the time a cut's follow-through or a
  // thrust's recover takes) is not held at all: it comes out as it went in.
  atOnce: 0.35,
  // N to drive a point through muscle once it is through the skin (the forensic stab tests' few tens to a hundred-odd
  // newtons for a knife; a broader sword or spear point more): depth = joules / thrustN.
  thrustN: 260,
  flesh: 5000, bonePerM: 25000, boneMost: 1500, pinch: 120, barbs: 2.5,
  // Drawing: m/s it slides at with twice the hold in hand; the share of the hold below which it does not move; s of
  // working at it for the hold to fall to 1/e; the share of his weight he can put into it stepping back at `backPace` m/s.
  pullSpeed: 1.2, stick: 0.55, loosen: 2.2, weight: 0.3, backPace: 0.8,
  // The least of his pull that works along the way out, however he stands to it (he shifts his grip and his feet to it).
  askew: 0.5,
  // How far (m) the hand may be dragged off the blade's line in one substep's correction, how far off it counts as torn
  // from him, and for how long (s).
  step: 0.008, torn: 0.2, tornSeconds: 0.3,
  // The skull, to go through its whole width, against what the neck takes (BLADES.sever): an edge that would take a head
  // off bites a few centimetres into the vault and stops (the Wisby and Towton cuts), so the whole of it is several times that.
  skull: 8,
  // The wound opened again as it comes out: this share of the bleeding the blow started.
  reopen: 0.5,
  // A man working at a held blade spends this share of his stamina a second.
  effort: 0.05,
};

// The particle that fixes each part's turn about its own length (with its two ends: the part's frame).
const LODGE_REF = {
  head: 'lShoulder', trunk: 'lShoulder', lUpperArm: 'rShoulder', rUpperArm: 'lShoulder', lForearm: 'lShoulder', rForearm: 'rShoulder',
  lThigh: 'rHip', rThigh: 'lHip', lShank: 'lHip', rShank: 'rHip',
};

/** A struck part's own frame now: `origin` at `t` along it, `y` along it, `x` and `z` square to it (by LODGE_REF). */
function partFrame(fighter, hold) {
  const a = point(fighter.x, hold.a);
  const b = point(fighter.x, hold.b);
  // (The head is one particle: its line is the neck's.)
  const span = hold.a === hold.b ? vec.sub(a, point(fighter.x, P.neck)) : vec.sub(b, a);
  const y = vec.length(span) > 1e-6 ? vec.normalize(span) : [0, 1, 0];
  const origin = hold.a === hold.b ? a : vec.add(a, vec.scale(vec.sub(b, a), hold.t));
  const toward = vec.sub(point(fighter.x, hold.ref), origin);
  let z = vec.sub(toward, vec.scale(y, vec.dot(toward, y)));
  z = vec.length(z) > 1e-6 ? vec.normalize(z) : vec.normalize(vec.cross(y, Math.abs(y[1]) < 0.9 ? [0, 1, 0] : [1, 0, 0]));
  return { origin, x: vec.cross(y, z), y, z };
}
const intoFrame = (frame, v) => [vec.dot(v, frame.x), vec.dot(v, frame.y), vec.dot(v, frame.z)];
const outOfFrame = (frame, v) => vec.add(vec.add(vec.scale(frame.x, v[0]), vec.scale(frame.y, v[1])), vec.scale(frame.z, v[2]));

/**
 * How deep (m) an edge with `cleaving` J, or a point with `pierce` J, went into a part whose section had `left` to give
 * ({ flesh, bone } J: physics.js limbResistance, trunkResistance), `radius` thick with bone `boneRadius` thick inside it;
 * `reach`: the most a point can go in (the blade's length). Returns { depth, bone: m of it in bone, thrust }.
 */
export function lodgeDepth(left, radius, boneRadius, cleaving, pierce, reach = Infinity) {
  if (pierce > cleaving) return { depth: Math.min(pierce / LODGE.thrustN, radius * 1.9, reach), bone: 0, thrust: true };
  const fleshWidth = 1 - Math.min(0.9, boneRadius / radius);
  const near = left.flesh / 2;
  if (cleaving <= near || left.bone <= 0) {
    const share = left.bone <= 0 ? Math.min(1, cleaving / Math.max(1e-6, left.flesh)) : (fleshWidth / 2) * (cleaving / Math.max(1e-6, near));
    return { depth: share * 2 * radius, bone: 0, thrust: false };
  }
  const inBone = Math.min(1, (cleaving - near) / left.bone) * (1 - fleshWidth) * 2 * radius;
  return { depth: (fleshWidth / 2) * 2 * radius + inBone, bone: inBone, thrust: false };
}

/**
 * N to draw a blade out of what it is in: `depth` m in, `bone` m of that in bone, `engaged` m of edge in the wound (a
 * point: its width), `pinched` whether a point is between ribs or through the skull, `barbed` whether its head is.
 */
export function lodgeHold({ depth, bone }, engaged, pinched = false, barbed = false) {
  const hold = LODGE.flesh * 2 * depth * engaged + Math.min(LODGE.boneMost, LODGE.bonePerM * bone) + (pinched ? LODGE.pinch : 0);
  return hold * (barbed ? LODGE.barbs : 1);
}

/** The blade of his that is held in a body, or null. */
export function lodgedBlade(fighter) {
  if (!fighter.lodged) return null;
  return fighter.lodged.blade === 'off' ? fighter.offWeapon : fighter.weapon;
}

/**
 * A blade that went into `defender` and did not go through: held there if it is deep enough (LODGE.least) or in bone.
 * `capsule`, `t`: the part and where along it; `contact`: where it met him; `hit`: { left (the section before this
 * blow), cleaving, pierce, square, distance (hand to the contact along the blade), travel (the blade's way against him),
 * bleed (the bleeding it started), event }. Returns whether it is held.
 */
export function lodgeBlade(world, attacker, defender, weapon, capsule, t, contact, hit) {
  if (attacker.lodged || !weapon.held || weapon.spec.rope || weapon.spec.mounted || attacker.mount) return false;
  const key = capsule.key;
  const radius = capsule.radius;
  const boneRadius = key === 'head' ? radius * 0.85 : defender.body.segments[key].boneRadius;
  const reach = Math.max(0.05, weapon.spec.length - hit.distance + 0.05);
  const went = lodgeDepth(hit.left, radius, boneRadius, hit.cleaving, hit.pierce, hit.pierce > hit.cleaving ? weapon.spec.length : reach + radius * 2);
  // (A point in a limb is in its bone only if it came square onto it; in the chest it is between ribs, in the head through the skull.)
  const chest = key === 'trunk' && t > 0.45;
  const pinched = went.thrust && (key === 'head' || chest);
  if (went.thrust ? went.depth < LODGE.least.thrust : went.bone <= 0 && went.depth < LODGE.least.cut) return false;
  const engaged = went.thrust ? weapon.spec.pointWidth ?? Math.max(0.025, weapon.spec.radius * 2) : Math.min(weapon.spec.length, 2 * Math.sqrt(Math.max(0, went.depth * (2 * radius - went.depth))));
  const hold = lodgeHold(went, engaged, pinched, Boolean(weapon.spec.barbed));
  const held = { a: capsule.a, b: capsule.b, t, ref: P[LODGE_REF[key]] };
  const frame = partFrame(defender, held);
  const way = vec.length(hit.travel) > 1e-6 ? vec.normalize(hit.travel) : weapon.dir;
  // (Drawn in the stroke's recovery: what he pulls with over what holds it, LODGE.atOnce.)
  const over = lodgePull(attacker, weapon, vec.scale(went.thrust ? weapon.dir : way, -1)) / Math.max(1, hold) - LODGE.stick;
  if (over > 0 && went.depth / (LODGE.pullSpeed * Math.min(2, over)) < LODGE.atOnce) return false;
  attacker.lodged = {
    in: defender.id, blade: weapon === attacker.offWeapon ? 'off' : 'main', ...held, key,
    at: intoFrame(frame, vec.sub(contact, frame.origin)), dir: intoFrame(frame, weapon.dir),
    // (Out the way it went in: a point back along the blade, an edge back against its travel.)
    exit: intoFrame(frame, vec.scale(went.thrust ? weapon.dir : way, -1)),
    grip: hit.distance, depth: went.depth, bone: went.bone, thrust: went.thrust, hold, held: hold, out: 0, since: world.time, off: 0, bleed: hit.bleed ?? 0,
    world: { dir: [...weapon.dir] },
  };
  hit.event.lodged = { depth: went.depth, bone: went.bone > 0 || pinched, hold };
  hit.event.effects.push(went.bone > 0 ? 'the blade held in the bone' : pinched ? 'the point held between the bones' : 'the blade held in the wound');
  world.events.push({ time: world.time, kind: 'lodged', fighter: attacker.id, defender: defender.id, weapon: weapon.kind, target: key, point: contact, depth: went.depth, hold, effects: [`his ${weapon.spec.label.toLowerCase()} is held in the wound`] });
  return true;
}

/** N he can pull on a held blade with now, along `exit` (the way out, world): his hands on the grip and his weight if he steps back. */
export function lodgePull(fighter, weapon, exit) {
  const shares = limbShares(fighter);
  let force = fighter.body.motorForce[P[`${weapon.main}Hand`]] * shares.arm[weapon.main];
  if (weapon.twoHanded) force += fighter.body.motorForce[P[`${weapon.off}Hand`]] * shares.arm[weapon.off];
  const back = fighter.rootVelocity ? fighter.rootVelocity[0] * exit[0] + fighter.rootVelocity[1] * exit[2] : 0;
  force += LODGE.weight * fighter.body.massKg * 9.81 * Math.min(1, Math.max(0, back / LODGE.backPace));
  // (Drawn down its own cut: what of his pull, from the wound toward his shoulder, lies along the way out.)
  const hand = point(fighter.x, P[`${weapon.main}Hand`]);
  const toward = vec.sub(point(fighter.x, P[`${weapon.main}Shoulder`]), hand);
  const align = vec.length(toward) > 1e-6 ? Math.max(LODGE.askew, vec.dot(vec.normalize(toward), exit)) : LODGE.askew;
  return force * align * Math.max(0, fighter.motorScale ?? 1);
}

/** About how long (s) he will be getting his blade out, as he is now: Infinity if he cannot move it yet. */
export function lodgeEta(world, fighter) {
  const held = fighter.lodged;
  const weapon = lodgedBlade(fighter);
  const victim = world.fighters[held?.in];
  if (!held || !weapon?.held || !victim) return 0;
  const frame = partFrame(victim, held);
  const over = lodgePull(fighter, weapon, outOfFrame(frame, held.exit)) / Math.max(1, held.hold) - LODGE.stick;
  if (over <= 0) return LODGE.loosen;
  return (held.depth - held.out) / (LODGE.pullSpeed * Math.min(2, over));
}

/** He lets go of a held blade (or it is torn from him): it stays in the body, and he is a disarmed man. `how`: the log's word. */
export function letGoLodged(world, fighter, how = 'leaves his blade in the wound') {
  const held = fighter.lodged;
  const weapon = lodgedBlade(fighter);
  if (!held) return;
  if (weapon?.held) {
    // (dropWeapon finds fighter.lodged and leaves the loose weapon in the body: stickLodged.)
    if (weapon === fighter.offWeapon) dropOffWeapon(world, fighter, 'lodged');
    else dropWeapon(world, fighter, 'lodged');
  }
  fighter.lodged = null;
  world.events.push({ time: world.time, kind: 'abandoned', fighter: fighter.id, defender: held.in, effects: [how] });
}

/** A weapon dropped while it is held in a body (physics.js dropWeapon): the loose weapon stays in the wound, riding the part. */
export function stickLodged(world, fighter, weapon, debris) {
  const held = fighter.lodged;
  if (!held || !debris || lodgedBlade(fighter) !== weapon) return;
  const spec = weapon.spec;
  // (The loose weapon's point is its middle: so far back along the blade from the wound.)
  debris.stuck = { in: held.in, a: held.a, b: held.b, t: held.t, ref: held.ref, at: held.at, dir: held.dir, exit: held.exit, sunk: held.depth - held.out, back: held.grip - (spec.length - spec.handle) / 2 };
  debris.v = [0, 0, 0];
  debris.spin = [0, 0, 0];
  fighter.lodged = null;
}

/** Where the hand on a held blade must be now (world), the blade's line and the way out: sunk `depth` in, less what he has drawn. */
function lodgeWant(victim, held) {
  const frame = partFrame(victim, held);
  const dir = outOfFrame(frame, held.dir);
  const exit = outOfFrame(frame, held.exit);
  const wound = vec.add(frame.origin, outOfFrame(frame, held.at));
  return { dir, exit, wound, hand: vec.add(vec.sub(wound, vec.scale(dir, held.grip)), vec.scale(exit, held.out - held.depth)) };
}

/** A man whose blade is held in a body keeps his hand on it (his pose's `intent`, in his own frame), not back at his guard. */
export function lodgePose(world, fighter, intent) {
  const weapon = lodgedBlade(fighter);
  const victim = world.fighters[fighter.lodged.in];
  if (!weapon?.held || !victim) return;
  intent[`${weapon.main}Hand`] = toLocal(fighter, lodgeWant(victim, fighter.lodged).hand);
}

/** Loose weapons left in bodies (stickLodged) go where the part they are in goes; one in a man who is down may be taken up. */
export function carryStuck(world) {
  for (const piece of world.debris) {
    const stuck = piece.stuck;
    if (!stuck || piece.taken) continue;
    const victim = world.fighters[stuck.in];
    const frame = partFrame(victim, stuck);
    const dir = outOfFrame(frame, stuck.dir);
    const wound = vec.add(frame.origin, outOfFrame(frame, stuck.at));
    piece.x = vec.sub(vec.sub(wound, vec.scale(dir, stuck.back)), vec.scale(outOfFrame(frame, stuck.exit), stuck.sunk));
    piece.q = quatFromTo([0, 1, 0], dir);
    piece.v = [0, 0, 0];
    piece.resting = victim.state !== 'up' && victim.state !== 'rising';
  }
}

/**
 * Each substep, for every man whose blade is held in a body: his hand kept on the blade's line at the wound (the hand and
 * the struck part moved toward each other by their masses: each drags the other), the blade on the line it went in by.
 */
export function holdLodged(world, h) {
  for (const fighter of world.fighters) {
    const held = fighter.lodged;
    if (!held) continue;
    const weapon = lodgedBlade(fighter);
    const victim = world.fighters[held.in];
    if (!weapon?.held || !victim) continue;
    const { dir, hand: want } = lodgeWant(victim, held);
    const hand = P[`${weapon.main}Hand`];
    let move = vec.sub(want, point(fighter.x, hand));
    const off = vec.length(move);
    held.off = off;
    held.world.dir = dir;
    weapon.dir = dir;
    weapon.spin = [0, 0, 0];
    if (off < 1e-6) continue;
    if (off > LODGE.step) move = vec.scale(move, LODGE.step / off);
    // (The struck part's two ends by where along it the wound is; a part of a man cut in two or lying still is moved too.)
    const ends = held.a === held.b ? [[held.a, 1]] : [[held.a, 1 - held.t], [held.b, held.t]];
    let theirs = 0;
    for (const [index, share] of ends) theirs += share * share * victim.invMass[index];
    const mine = fighter.invMass[hand];
    const total = mine + theirs;
    for (let axis = 0; axis < 3; axis += 1) {
      fighter.x[hand * 3 + axis] += (move[axis] * mine) / total;
      for (const [index, share] of ends) victim.x[index * 3 + axis] -= (move[axis] * share * victim.invMass[index]) / total;
    }
    victim.stillFor = 0;
  }
}

/**
 * Each step: every man with a blade held in a body works at it (lodgePull against the hold), and it comes out, or he
 * lets go: put down or out, his hand dragged off it for LODGE.tornSeconds, or the weapon gone from his hand.
 */
export function stepLodged(world, dt) {
  for (const fighter of world.fighters) {
    const held = fighter.lodged;
    if (!held) continue;
    const weapon = lodgedBlade(fighter);
    const victim = world.fighters[held.in];
    if (!weapon?.held || !victim) {
      fighter.lodged = null;
      continue;
    }
    if (fighter.state !== 'up') {
      letGoLodged(world, fighter, 'his blade stays in the wound');
      continue;
    }
    // (The stroke that put it there is over.)
    if (fighter.punch && bladeFor(fighter, fighter.punch.spec) === weapon) fighter.punch = null;
    held.torn = held.off > LODGE.torn ? (held.torn ?? 0) + dt : 0;
    if (held.torn > LODGE.tornSeconds) {
      letGoLodged(world, fighter, 'his blade is torn from his hands, held in the wound');
      continue;
    }
    const frame = partFrame(victim, held);
    const pull = lodgePull(fighter, weapon, outOfFrame(frame, held.exit));
    const over = pull / Math.max(1, held.hold) - LODGE.stick;
    if (pull > 0.3 * held.hold) held.hold *= Math.exp(-dt / LODGE.loosen);
    if (over > 0) held.out += LODGE.pullSpeed * Math.min(2, over) * dt;
    fighter.stamina = Math.max(0, fighter.stamina - LODGE.effort * dt);
    if (held.out < held.depth) continue;
    fighter.lodged = null;
    // Out: the wound opens again behind it.
    if (held.bleed > 0 && !victim.body.gear.machine) victim.bleed = (victim.bleed ?? 0) + held.bleed * LODGE.reopen;
    const at = vec.add(frame.origin, outOfFrame(frame, held.at));
    world.events.push({ time: world.time, kind: 'freed', fighter: fighter.id, defender: victim.id, weapon: weapon.kind, point: at, depth: held.depth, seconds: world.time - held.since, effects: [`pulls his ${weapon.spec.label.toLowerCase()} free`] });
  }
  if (world.debris.length) carryStuck(world);
}

/** The section a blow to the head is measured against: the scalp, and the skull (LODGE.skull times what the neck takes to go through). */
export function skullLeft(toughness) {
  const whole = BLADES.sever.neck[0] * toughness * LODGE.skull;
  return { flesh: whole * 0.05, bone: whole * 0.95 };
}
