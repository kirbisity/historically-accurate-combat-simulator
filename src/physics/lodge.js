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
//  - bone wedges it: an edge driven into bone opens the notch as wide as the blade is thick at that depth, and the bone
//    springs back on both faces; the grip is friction on them, the pressure as the opening (the depth in bone times the
//    blade's taper) and the face as that depth again: `boneGrip` N per m2 of the depth in bone squared, at most
//    `boneMost`. So a notch a centimetre into the bone holds a blade no more than the flesh round it, and an edge buried
//    three or four centimetres in a spine, a pelvis or a skull holds as an axe in a log does (the Wisby and Towton skulls
//    show edges that went centimetres into bone; an axe in a log of green wood takes several hundred newtons to a
//    kilonewton to rock out, which is the order used; unverified). It was linear in the depth (25 kN/m): every cut that
//    reached a bone at all was held by it, and half the long-sword duels had a blade stuck in a man;
//  - a point between the ribs or through the skull is pinched by them: `pinch` N.
//  No weapon here is barbed (weapons.js has no such head): a spec's `barbed` would multiply the hold by `barbs`.
//
// Drawing it (stepLodged): the man pulls with what his arms have on the grip (each hand's motor force, as tired and hurt
// as it is, both hands on a two-handed weapon) and with his weight if he steps back from the man it is in; only the
// part of that along the way the blade went in counts (a blade is drawn back down its own cut: less as the man it is in turns or falls away from that line, at least `askew`). Past `stick` of
// the hold it slides, the faster the more he has over it, and working at it loosens it (his pull's worth of the hold every `loosen` s). Out, it opens the
// wound again (`reopen` of the bleeding the blow started).
//
// Whether it is held at all (lodgeBlade): it must have stopped. An edge still sliding along itself when its way into him
// is stopped (a curved blade's draw, a cut drawn back as it lands) goes on along its own cut, as Coulomb's friction says:
// the stop's impulse square to the edge can hold back at most `slip` times itself along it, so an edge that slides faster
// than `slip` times its speed into the cut is not stopped by its faces and runs on out of the wound with the stroke.
// Then a cut must be deep enough (`least`) or in bone, and more than his stroke's own recovery draws out at once
// (`atOnce`).
//
// While it is in (holdLodged, each substep): a joint between his hands and the point in the wound where the blade is held
// (it turns freely about that point and keeps its length), soft and damped as the flesh round the blade and the bone it
// is in give (`stiff`, `damping`), solved as a compliant constraint (XPBD, Macklin, Müller & Chentanez 2016, Motion in
// Games: the correction by both sides' inverse masses, the compliance over the substep squared), so what it does to each
// man is a force, not a displacement. That force is capped by what can bear it: pulled out along the blade past the hold
// (`hold`), the blade slides out of the wound by the rest; past what his hands can bear (lodgePull: his grip and his
// weight) they give, and held so for `gives` s they let go. Driven in, it is capped by what it takes to drive the blade
// deeper (`thrustN`). Before, the joint moved the hand and the part up to 8 mm a substep whatever force that took (up to
// ~3.8 m/s of speed each substep, on the two particles at the held part's ends alone), so nothing bounded what it did
// to either man; the violent motion seen with held blades was the blade itself being pushed out of the body it was in
// (physics.js collideStriker), but an unbounded joint is no joint a blade and a grip make. A man put down, knocked out or disarmed lets go;
// then the weapon stays in the body (the loose weapon rides the part it is in, and can be taken up once that man is
// down) and he goes on as any disarmed man does (rearm: his sidearm). A part cut off, or a man cut in two, around a
// blade lets it come free.

import { P } from '../body.js';
import { vec } from '../pose.js';
import { BLADES, edgeSlide } from '../weapons.js';
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
  flesh: 5000, boneGrip: 1.1e6, boneMost: 1500, pinch: 120, barbs: 2.5,
  // Coulomb friction of steel on wet flesh and bone: steel on skin and tissue runs about 0.2-0.5 wet (Derler & Gerhardt
  // 2012, Tribology Letters 45: 1, a review of skin friction), cortical bone on steel about 0.3-0.4 (orthopaedic fixation
  // tests; both from memory of the reviews, unverified): an edge sliding faster than this share of its speed into the
  // cut is not stopped by its faces.
  slip: 0.35,
  // Drawing: m/s it slides at with twice the hold in hand; the share of the hold below which it does not move; s of
  // working at it for the hold to fall by what he pulls with; the share of his weight he can put into it stepping back at `backPace` m/s.
  pullSpeed: 1.2, stick: 0.55, loosen: 1.3, weight: 0.3, backPace: 0.8,
  // The least of his pull that works along the way out, however he stands to it (he shifts his grip and his feet to it).
  askew: 0.8,
  // The joint (holdLodged): its stiffness (N/m: a blade a few centimetres in muscle or bone moves a few millimetres under
  // a hundred newtons, the tissue's own give round it; the grip's give is the arm's, in the body already) and its damping
  // ratio (1: critically damped, it settles without ringing). How far off the blade's line (m) his hand counts as torn
  // from him, and for how long (s); and how long his hands bear more than they can (`gives`, s) before they let go.
  stiff: 20000, damping: 1, torn: 0.2, tornSeconds: 0.3, gives: 0.15,
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
// The particles the joint moves on the man the blade is in, as one: what the held part is fixed to so firmly that a pull on
// it moves them together (the trunk's six; the head with the neck; a limb's segment with the joint it hangs from). Moving
// only the held part's two ends put the whole pull on a particle of a few kilograms (the neck's is 3.6) and flung it.
const LODGE_CARRIES = {
  head: ['head', 'neck'], trunk: ['pelvis', 'lHip', 'rHip', 'neck', 'lShoulder', 'rShoulder'],
  lUpperArm: ['lShoulder', 'lElbow'], rUpperArm: ['rShoulder', 'rElbow'], lForearm: ['lElbow', 'lHand', 'lShoulder'], rForearm: ['rElbow', 'rHand', 'rShoulder'],
  lThigh: ['lHip', 'lKnee', 'pelvis'], rThigh: ['rHip', 'rKnee', 'pelvis'], lShank: ['lKnee', 'lFoot', 'lHip'], rShank: ['rKnee', 'rFoot', 'rHip'],
};
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
 * point: its width), `pinched` whether a point is between ribs or through the skull, `barbed` whether its head is.
 */
export function lodgeHold({ depth, bone }, engaged, pinched = false, barbed = false) {
  const hold = LODGE.flesh * 2 * depth * engaged + Math.min(LODGE.boneMost, LODGE.boneGrip * bone * bone) + (pinched ? LODGE.pinch : 0);
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
  const hold = lodgeHold(went, engaged, pinched, Boolean(weapon.spec.barbed));
  const held = { a: capsule.a, b: capsule.b, t, ref: P[LODGE_REF[key]] };
  const frame = lodgeFrame(defender, held);
  const way = vec.length(hit.travel) > 1e-6 ? vec.normalize(hit.travel) : weapon.dir;
  // (Drawn in the stroke's recovery: what he pulls with over what holds it, LODGE.atOnce.)
  const over = lodgePull(attacker, weapon, vec.scale(went.thrust ? weapon.dir : way, -1)) / Math.max(1, hold) - LODGE.stick;
  if (over > 0 && went.depth / (LODGE.pullSpeed * Math.min(2, over)) < LODGE.atOnce) return false;
  attacker.lodged = {
    in: defender.id, blade: weapon === attacker.offWeapon ? 'off' : 'main', ...held, key,
    at: lodgeInto(frame, vec.sub(contact, frame.origin)), dir: lodgeInto(frame, weapon.dir),
    // (Out the way it went in: a point back along the blade, an edge back against its travel.)
    exit: lodgeInto(frame, vec.scale(went.thrust ? weapon.dir : way, -1)),
    grip: hit.distance, depth: went.depth, bone: went.bone, thrust: went.thrust, hold, held: hold, out: 0, since: world.time, off: 0, bleed: hit.bleed ?? 0,
    world: { dir: [...weapon.dir], exit: vec.scale(went.thrust ? weapon.dir : way, -1) },
  };
  hit.event.lodged = { depth: went.depth, bone: went.bone > 0 || pinched, hold };
  hit.event.effects.push(went.bone > 0 ? 'the blade held in the bone' : pinched ? 'the point held between the bones' : 'the blade held in the wound');
  world.events.push({ time: world.time, kind: 'lodged', fighter: attacker.id, defender: defender.id, weapon: weapon.kind, target: key, point: contact, depth: went.depth, hold, effects: [`his ${weapon.spec.label.toLowerCase()} is held in the wound`] });
  return true;
}

/** N he can pull on a held blade with now, along `exit` (the way out, world; `from`: the way out as it was when the blade went in): his hands on the grip and his weight if he steps back. */
export function lodgePull(fighter, weapon, exit, from = null) {
  const shares = limbShares(fighter);
  let force = fighter.body.motorForce[P[`${weapon.main}Hand`]] * shares.arm[weapon.main];
  if (weapon.spec.hands !== 'one') force += fighter.body.motorForce[P[`${weapon.off}Hand`]] * shares.arm[weapon.off];
  const back = fighter.rootVelocity ? fighter.rootVelocity[0] * exit[0] + fighter.rootVelocity[1] * exit[2] : 0;
  force += LODGE.weight * fighter.body.massKg * 9.81 * Math.min(1, Math.max(0, back / LODGE.backPace));
  // (Drawn down its own cut: he pulls the way his stroke went in, `from`; as far as the man it is in has turned or fallen
  // since, the way out is no longer that way, and less of his pull works along it.)
  const align = from ? Math.max(LODGE.askew, vec.dot(from, exit)) : 1;
  return force * align * Math.max(0, fighter.motorScale ?? 1);
}

/** About how long (s) he will be getting his blade out, as he is now: Infinity if he cannot move it yet. */
export function lodgeEta(world, fighter) {
  const held = fighter.lodged;
  const weapon = lodgedBlade(fighter);
  const victim = world.fighters[held?.in];
  if (!held || !weapon?.held || !victim) return 0;
  const frame = lodgeFrame(victim, held);
  const pull = lodgePull(fighter, weapon, lodgeOutOf(frame, held.exit), held.world.exit);
  if (pull <= 1) return Infinity;
  const over = pull / Math.max(1, held.hold) - LODGE.stick;
  // (Not moving yet: until he has worked it loose enough, then about as long again to draw it.)
  if (over <= 0.1) return ((held.hold - pull / (LODGE.stick + 0.1)) * LODGE.loosen) / pull + (held.depth - held.out) / (LODGE.pullSpeed * 0.3);
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
  const victim = world.fighters[held.in];
  // (As it lies in him now: the line it has come to, in the struck part's frame.)
  const dir = victim ? lodgeInto(lodgeFrame(victim, held), held.world.dir) : held.dir;
  debris.stuck = { in: held.in, a: held.a, b: held.b, t: held.t, ref: held.ref, at: held.at, dir, exit: held.exit, sunk: held.depth - held.out, back: held.grip - (spec.length - spec.handle) / 2 };
  debris.v = [0, 0, 0];
  debris.spin = [0, 0, 0];
  fighter.lodged = null;
}

/**
 * Where a held blade is held (world): the point of it that is deepest in the wound (`pivot`: `depth` in along the way it
 * went, less what he has drawn), about which it can turn; the hand is `grip` from it. And the way out, now.
 */
function lodgeWant(victim, held) {
  const frame = lodgeFrame(victim, held);
  const exit = lodgeOutOf(frame, held.exit);
  const wound = vec.add(frame.origin, lodgeOutOf(frame, held.at));
  return { exit, wound, pivot: vec.add(wound, vec.scale(exit, held.out - held.depth)), frame };
}

/** A man whose blade is held in a body keeps his hand on it (his pose's `intent`, in his own frame), not back at his guard. */
export function lodgePose(world, fighter, intent) {
  const weapon = lodgedBlade(fighter);
  const victim = world.fighters[fighter.lodged.in];
  if (!weapon?.held || !victim) return;
  const { pivot } = lodgeWant(victim, fighter.lodged);
  // (On the blade's line from where it is held to his hand, the grip's length from it.)
  const reach = vec.sub(point(fighter.x, P[`${weapon.main}Hand`]), pivot);
  const back = vec.length(reach) > 1e-6 ? vec.normalize(reach) : vec.scale(fighter.lodged.world.dir, -1);
  const hand = vec.add(pivot, vec.scale(back, fighter.lodged.grip));
  intent[`${weapon.main}Hand`] = toLocal(fighter, hand);
  // (Both hands stay on a two-handed weapon's grip: he hauls on it with both.)
  if (weapon.spec.hands !== 'one') {
    intent[`${weapon.off}Hand`] = toLocal(fighter, vec.add(hand, vec.scale(back, weapon.spec.spacing ?? 0.2)));
    intent.twoHanded = true;
  }
}

/** Loose weapons left in bodies (stickLodged) go where the part they are in goes; one in a man who is down may be taken up. */
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

/**
 * Each substep, for every man whose blade is held in a body: the joint between his hands and the point it is held at
 * (LODGE `stiff`, `damping`), a compliant, damped distance constraint solved once a substep (XPBD), its force capped by
 * what bears it: pulled, the hold (past it the blade slides out by the rest) or his hands (past it they give: `gives`);
 * pushed, what drives the blade deeper (`thrustN`). The blade keeps the line from the held point to his hand.
 */
export function holdLodged(world, h) {
  for (const fighter of world.fighters) {
    const held = fighter.lodged;
    if (!held) continue;
    const weapon = lodgedBlade(fighter);
    const victim = world.fighters[held.in];
    if (!weapon?.held || !victim || victim.halves) continue;
    const { pivot, exit } = lodgeWant(victim, held);
    const hand = P[`${weapon.main}Hand`];
    // (Both hands on a two-handed weapon's grip: the joint holds them together.)
    const hands = weapon.spec.hands !== 'one' ? [hand, P[`${weapon.off}Hand`]] : [hand];
    const reach = vec.sub(pivot, point(fighter.x, hand));
    const length = vec.length(reach);
    if (length < 1e-6) continue;
    const dir = vec.scale(reach, 1 / length);
    held.off = Math.abs(length - held.grip);
    held.world.dir = dir;
    weapon.dir = dir;
    weapon.spin = [0, 0, 0];
    // C > 0: his hands further from the held point than the grip is long (the blade pulled on); < 0, pushed in.
    const stretch = length - held.grip;
    const carried = (LODGE_CARRIES[held.key] ?? [held.a, held.b]).map((name) => (typeof name === 'number' ? name : P[name]));
    let carriedMass = 0;
    for (const index of carried) carriedMass += victim.invMass[index] > 0 ? 1 / victim.invMass[index] : 0;
    const theirs = carriedMass > 0 ? 1 / carriedMass : 0;
    let handsMass = 0;
    for (const index of hands) handsMass += fighter.invMass[index] > 0 ? 1 / fighter.invMass[index] : 0;
    const mine = handsMass > 0 ? 1 / handsMass : 0;
    const total = mine + theirs;
    if (total <= 0) continue;
    // Compliance over the substep squared, and the damping as XPBD's gamma (alpha beta / h), beta critical for the two
    // masses the joint couples (2 sqrt(k m)) times LODGE.damping.
    const compliance = 1 / (LODGE.stiff * h * h);
    const beta = 2 * LODGE.damping * Math.sqrt(LODGE.stiff / total);
    const gamma = (beta / LODGE.stiff) / h;
    const moved = stretch - (held.stretch ?? stretch);
    let lambda = -(stretch + gamma * moved) / ((1 + gamma) * total + compliance);
    // The force it takes (N), against what bears it.
    const force = -lambda / (h * h);
    const pulled = force > 0;
    const grip = pulled ? lodgePull(fighter, weapon, exit, held.world.exit) : Infinity;
    const bears = pulled ? Math.min(held.hold, grip) : LODGE.thrustN;
    if (Math.abs(force) > bears) {
      lambda = -Math.sign(force) * bears * h * h;
      // Pulled past the hold, the blade slides out by what the joint could not take up; past his hands, they give.
      if (pulled && held.hold <= grip) {
        const rest = stretch + lambda * total;
        held.out = Math.min(held.depth, held.out + Math.max(0, rest) * Math.max(LODGE.askew, vec.dot(exit, vec.scale(dir, -1))));
      }
    }
    held.strain = pulled && force > grip && grip < held.hold ? (held.strain ?? 0) + h : 0;
    held.stretch = stretch + lambda * total;
    // (What the joint bore this substep, N, + pulling: for the log and the tests.)
    held.force = -lambda / (h * h);
    for (let axis = 0; axis < 3; axis += 1) {
      for (const index of hands) fighter.x[index * 3 + axis] -= dir[axis] * lambda * mine;
      for (const index of carried) victim.x[index * 3 + axis] += dir[axis] * lambda * theirs;
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
    // (The part it is in cut off, or the man cut in two round it: nothing holds it.)
    const parted = victim.halves || victim.severedCapsules?.has(held.key);
    if (parted) held.out = held.depth;
    // (The stroke that put it there is over.)
    if (fighter.punch && bladeFor(fighter, fighter.punch.spec) === weapon) fighter.punch = null;
    held.torn = held.off > LODGE.torn ? (held.torn ?? 0) + dt : 0;
    if (held.torn > LODGE.tornSeconds || (held.strain ?? 0) > LODGE.gives) {
      letGoLodged(world, fighter, 'his blade is torn from his hands, held in the wound');
      continue;
    }
    const frame = lodgeFrame(victim, held);
    const pull = parted ? 0 : lodgePull(fighter, weapon, lodgeOutOf(frame, held.exit), held.world.exit);
    const over = pull / Math.max(1, held.hold) - LODGE.stick;
    // (Worked at, it loosens by what he puts into it: his pull's worth of the hold every LODGE.loosen s.)
    held.hold = Math.max(0, held.hold - (pull * dt) / LODGE.loosen);
    if (over > 0) held.out += LODGE.pullSpeed * Math.min(2, over) * dt;
    fighter.stamina = Math.max(0, fighter.stamina - LODGE.effort * dt);
    if (held.out < held.depth) continue;
    fighter.lodged = null;
    // Out: the wound opens again behind it.
    if (held.bleed > 0 && !victim.body.gear.machine) victim.bleed = (victim.bleed ?? 0) + held.bleed * LODGE.reopen;
    const at = vec.add(frame.origin, lodgeOutOf(frame, held.at));
    world.events.push({ time: world.time, kind: 'freed', fighter: fighter.id, defender: victim.id, weapon: weapon.kind, point: at, depth: held.depth, seconds: world.time - held.since, effects: [`pulls his ${weapon.spec.label.toLowerCase()} free`] });
  }
  if (world.debris.length) carryStuck(world);
}

/** The section a blow to the head is measured against: the scalp, and the skull (LODGE.skull times what the neck takes to go through). */
export function skullLeft(toughness) {
  const whole = BLADES.sever.neck[0] * toughness * LODGE.skull;
  return { flesh: whole * 0.05, bone: whole * 0.95 };
}
