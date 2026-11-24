// A blade stopped in a body is held by it, and its wielder loses it (the user's calls, 2026-11-24: "when a weapon gets
// stuck, always make the wielder lose the weapon; otherwise motion bugs will happen"). One rule for every edge and point
// and every part: a cut or a thrust that goes in and does not go through is in the wound as deep as its energy took it,
// and if the tissue holds it there his hands come off it at once: the weapon stays in the wound, rides the part it is in,
// goes down with the man, and can be taken up from him once he is down; the wielder goes on as any disarmed man does
// (rearm: his sidearm, or his hands). Nothing joins the two men through a held blade: there is no hauling it out.
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
//  - bone wedges it: an edge driven into bone opens the notch as wide as the blade is thick at that depth, and the bone
//    springs back on both faces; the grip is friction on them, the pressure as the opening (the depth in bone times the
//    blade's taper) and the face as that depth again: `boneGrip` N per m2 of the depth in bone squared, at most
//    `boneMost`. So a notch a centimetre into the bone holds a blade no more than the flesh round it, and an edge buried
//    three or four centimetres in a spine, a pelvis or a thick femur holds as an axe in a log does (the Wisby and Towton
//    skulls show edges that went centimetres into bone; an axe in a log of green wood takes several hundred newtons to a
//    kilonewton to rock out, which is the order used; unverified). The skull is a shell, not a solid bone: past its vault
//    (`skullWall`) the edge is in the brain, and only the vault's own thickness grips its faces. The opening grows only as
//    far as the blade's bevel runs (`bevel`): past it the faces are all but parallel. The trunk's cancellous bones grip
//    by the share they part by (BLADES.trunkCut cortical);
//  - a point between the ribs or through the skull is pinched by them: `pinch` N.
//  No weapon here is barbed (weapons.js has no such head): a spec's `barbed` would multiply the hold by `barbs`.
//
// Whether it is held at all (lodgeBlade): it must have stopped. An edge still sliding along itself when its way into him
// is stopped (a curved blade's draw, a cut drawn back as it lands) goes on along its own cut, as Coulomb's friction says:
// the stop's impulse square to the edge can hold back at most `slip` times itself along it, so an edge that slides faster
// than `slip` times its speed into the cut runs on out of the wound with the stroke. Then a cut must be deep enough
// (`least`) or in bone, and more than his stroke's own recovery draws out at once (`atOnce`: what his arms pull with on
// the grip, recoveryPull, over the hold, past `stick` of it sliding at `pullSpeed`). Held past that, it is lost.

import { P } from '../body.js';
import { vec } from '../pose.js';
import { BLADES, edgeSlide } from '../weapons.js';
import { dropOffWeapon, dropWeapon, limbShares, point, quatFromTo } from '../physics.js';

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
  flesh: 5000, boneGrip: 1.1e6, boneMost: 1500, pinch: 120, barbs: 2.5,
  // The skull vault's thickness (m): 5-7 mm over most of it in adults, the two tables and the diploe between (Lynnerup
  // 2005, Forensic Sci Int 147: 1, CT of the vault, men ~6.5 mm; from memory of the abstract, unverified).
  skullWall: 0.0065,
  // (Not counted: the vault meets a cut along its whole chord, 10-17 cm, against a solid bone's few centimetres across; but
  // what presses on the blade there is a plate a few millimetres thick flexing aside, and cracking from the kerf as a cut
  // skull does, not bone squeezed in bulk, so the longer face does not grip as a long bone's would. Counted along the
  // chord, a sabre or a katana was held in most heads it cut into, in four bouts in ten.)
  // How far back from the edge a blade's bevel runs to its full thickness (m): a sword's ~2-3 cm (a katana's ha and
  // shinogi-ji together; a sabre's or a dao's edge bevel likewise; from the blades' sections, unverified).
  bevel: 0.025,
  // Coulomb friction of steel on wet flesh and bone: steel on skin and tissue runs about 0.2-0.5 wet (Derler & Gerhardt
  // 2012, Tribology Letters 45: 1, a review of skin friction), cortical bone on steel about 0.3-0.4 (orthopaedic fixation
  // tests; both from memory of the reviews, unverified): an edge sliding faster than this share of its speed into the
  // cut is not stopped by its faces.
  slip: 0.35,
  // His stroke's recovery on a held blade (recoveryPull, LODGE.atOnce): m/s it slides at with twice the hold in hand, and
  // the share of the hold below which it does not move.
  pullSpeed: 1.2, stick: 0.55,
  // The skull, to go through its whole width, against what the neck takes (BLADES.sever): an edge that would take a head
  // off bites a few centimetres into the vault and stops (the Wisby and Towton cuts), so the whole of it is several times that.
  skull: 8,
};

// The particle that fixes each part's turn about its own length (with its two ends: the part's frame).
const LODGE_REF = {
  head: 'lShoulder', trunk: 'lShoulder', lUpperArm: 'rShoulder', rUpperArm: 'lShoulder', lForearm: 'lShoulder', rForearm: 'rShoulder',
  lThigh: 'rHip', rThigh: 'lHip', lShank: 'lHip', rShank: 'rHip',
};

/** A struck part's own frame now: `origin` at `t` along it, `y` along it, `x` and `z` square to it (by LODGE_REF). */
function lodgeFrame(fighter, hold) {
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
const lodgeInto = (frame, v) => [vec.dot(v, frame.x), vec.dot(v, frame.y), vec.dot(v, frame.z)];
const lodgeOutOf = (frame, v) => vec.add(vec.add(vec.scale(frame.x, v[0]), vec.scale(frame.y, v[1])), vec.scale(frame.z, v[2]));

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
 * point: its width), `pinched` whether a point is between ribs or through the skull, `barbed` whether its head is; `wall`
 * (m) the most of the bone that grips it (the skull's vault: LODGE.skullWall; a solid bone all of it); `firm`, the bone's
 * grip against a long bone's (the trunk's cancellous bones: BLADES.trunkCut cortical, as they part).
 */
export function lodgeHold({ depth, bone }, engaged, pinched = false, barbed = false, wall = Infinity, firm = 1) {
  const hold = LODGE.flesh * 2 * depth * engaged + Math.min(LODGE.boneMost, LODGE.boneGrip * firm * Math.min(bone, LODGE.bevel) * Math.min(bone, wall)) + (pinched ? LODGE.pinch : 0);
  return hold * (barbed ? LODGE.barbs : 1);
}

/**
 * A blade that went into `defender` and did not go through: held there if it is deep enough (LODGE.least) or in bone,
 * and then lost: he lets go of it and it stays in the wound. `capsule`, `t`: the part and where along it; `contact`: where
 * it met him; `hit`: { left (the section before this blow), cleaving, pierce, distance (hand to the contact along the
 * blade), travel (the blade's way against him), event }. Returns whether it is held.
 */
export function lodgeBlade(world, attacker, defender, weapon, capsule, t, contact, hit) {
  if (!weapon.held || weapon.spec.rope || weapon.spec.mounted || attacker.mount) return false;
  // (An edge still sliding along itself runs on out of its cut: LODGE.slip.)
  if (hit.cleaving >= hit.pierce && vec.length(hit.travel) > 1e-6) {
    const { slide, press } = edgeSlide(weapon.spec, hit.travel, weapon.dir, hit.distance);
    if (slide > LODGE.slip * Math.max(1e-6, press)) return false;
  }
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
  // (The trunk's bones grip as they part, cancellous cores in thin shells pressing back far less than a long bone's wall:
  // BLADES.trunkCut cortical.)
  const hold = lodgeHold(went, engaged, pinched, Boolean(weapon.spec.barbed), key === 'head' ? LODGE.skullWall : Infinity, key === 'trunk' ? BLADES.trunkCut.cortical : 1);
  const held = { a: capsule.a, b: capsule.b, t, ref: P[LODGE_REF[key]] };
  const frame = lodgeFrame(defender, held);
  const way = vec.length(hit.travel) > 1e-6 ? vec.normalize(hit.travel) : weapon.dir;
  // (Drawn in the stroke's recovery: what he pulls with over what holds it, LODGE.atOnce.)
  const over = recoveryPull(attacker, weapon) / Math.max(1, hold) - LODGE.stick;
  if (over > 0 && went.depth / (LODGE.pullSpeed * Math.min(2, over)) < LODGE.atOnce) return false;
  hit.event.lodged = { depth: went.depth, bone: went.bone > 0 || pinched, hold };
  hit.event.effects.push(went.bone > 0 ? 'the blade held in the bone' : pinched ? 'the point held between the bones' : 'the blade held in the wound');
  world.events.push({ time: world.time, kind: 'lodged', fighter: attacker.id, defender: defender.id, weapon: weapon.kind, target: key, point: contact, depth: went.depth, hold, effects: [`his ${weapon.spec.label.toLowerCase()} is held in the wound`] });
  // Lost: his hands come off it, and it stays in the wound as it went in (out the way it went in: a point back along the
  // blade, an edge back against its travel), riding the part (carryStuck).
  const exit = vec.scale(went.thrust ? weapon.dir : way, -1);
  const stuck = {
    in: defender.id, a: held.a, b: held.b, t, ref: held.ref,
    at: lodgeInto(frame, vec.sub(contact, frame.origin)), dir: lodgeInto(frame, weapon.dir), exit: lodgeInto(frame, exit),
    sunk: went.depth, back: hit.distance - (weapon.spec.length - weapon.spec.handle) / 2,
  };
  const off = weapon === attacker.offWeapon;
  const debris = off ? dropOffWeapon(world, attacker, 'lodged') : dropWeapon(world, attacker, 'lodged');
  const piece = debris ?? world.debris.at(-1);
  if (piece && piece.weapon === weapon.kind) {
    piece.stuck = stuck;
    piece.v = [0, 0, 0];
    piece.spin = [0, 0, 0];
  }
  world.lodging = true;
  world.events.push({ time: world.time, kind: 'abandoned', fighter: attacker.id, defender: defender.id, effects: ['his blade is held in the wound: he loses it'] });
  carryStuck(world);
  return true;
}

/** N his stroke's recovery draws a held blade back with (LODGE.atOnce): his hands on the grip, as tired and hurt as they are. */
function recoveryPull(fighter, weapon) {
  const shares = limbShares(fighter);
  let force = fighter.body.motorForce[P[`${weapon.main}Hand`]] * shares.arm[weapon.main];
  if (weapon.spec.hands !== 'one') force += fighter.body.motorForce[P[`${weapon.off}Hand`]] * shares.arm[weapon.off];
  return force * Math.max(0, fighter.motorScale ?? 1);
}

/** Loose weapons left in bodies (lodgeBlade) go where the part they are in goes; one in a man who is down may be taken up. */
export function carryStuck(world) {
  for (const piece of world.debris) {
    const stuck = piece.stuck;
    if (!stuck || piece.taken) continue;
    const victim = world.fighters[stuck.in];
    const frame = lodgeFrame(victim, stuck);
    const dir = lodgeOutOf(frame, stuck.dir);
    const wound = vec.add(frame.origin, lodgeOutOf(frame, stuck.at));
    piece.x = vec.sub(vec.sub(wound, vec.scale(dir, stuck.back)), vec.scale(lodgeOutOf(frame, stuck.exit), stuck.sunk));
    piece.q = quatFromTo([0, 1, 0], dir);
    piece.v = [0, 0, 0];
    piece.resting = victim.state !== 'up' && victim.state !== 'rising';
  }
}

/** The section a blow to the head is measured against: the scalp, and the skull (LODGE.skull times what the neck takes to go through). */
export function skullLeft(toughness) {
  const whole = BLADES.sever.neck[0] * toughness * LODGE.skull;
  return { flesh: whole * 0.05, bone: whole * 0.95 };
}
