// The cuts and the guards as tissue and bone make them (the user's call, 2026-11-24): what it takes to part a limb and the
// trunk on a body (physics.js tissueSection, limbResistance, trunkResistance; weapons.js BLADES.tissueCut); what a blow on
// a forearm meets (physics/blunt.js guardMeets); a held blade's joint and when an edge is held at all (physics/lodge.js).
import test from 'node:test';
import assert from 'node:assert/strict';
import { FRAMES, P, PRESETS } from '../src/body.js';
import { caloriesForWeight } from '../src/physiology.js';
import { vec } from '../src/pose.js';
import { advance, boneShare, capsules, createWorld, cutIntoLimb, limbResistance, placeFighter, point, reachesArtery, trunkResistance } from '../src/physics.js';
import { BLADES } from '../src/weapons.js';
import { bluntPart, guardMeets } from '../src/physics/blunt.js';
import { LODGE, lodgeBlade, lodgeHold } from '../src/physics/lodge.js';

const man = (kg, extra = {}) => {
  const inputs = { sex: 'male', heightCm: 175, frame: 'medium', age: 27, exercise: 0.4, style: 'boxing', ...extra };
  return { ...inputs, calories: Math.round(caloriesForWeight(inputs, kg, FRAMES[inputs.frame].lean)) };
};
const fighter = (inputs) => createWorld([inputs, inputs], { seed: 1 }).fighters[1];
const parts = (body) => {
  const at = (joint, key) => { const left = limbResistance(body, { joint, side: 'l' }, key); return left.flesh + left.bone; };
  const waist = trunkResistance(body, { along: 0.3, cos: 1, lo: 0.3, hi: 0.3 });
  return { wrist: at('wrist', 'lForearm'), elbow: at('elbow', 'lForearm'), upper: at('shoulder', 'lUpperArm'), thigh: at('hip', 'lThigh'), waist: waist.flesh + waist.bone };
};

test('a limb is parted by its own flesh and bone: the wrist and forearm easiest, the thigh hard, the trunk far harder than any', () => {
  const ordinary = parts(fighter(man(75)));
  assert.ok(ordinary.wrist < ordinary.upper && ordinary.upper < ordinary.thigh && ordinary.thigh < ordinary.waist, JSON.stringify(ordinary));
  // A forearm needs a strong cut (an ordinary katana blow lands at ~65-75 J), a thigh more than all but the great blades bring.
  assert.ok(ordinary.wrist > 70 && ordinary.wrist < 150, `wrist ${ordinary.wrist.toFixed(0)} J`);
  assert.ok(ordinary.thigh > 180 && ordinary.thigh < 400, `thigh ${ordinary.thigh.toFixed(0)} J`);
  assert.ok(ordinary.waist > 1.2 * ordinary.thigh, `waist ${ordinary.waist.toFixed(0)} J`);
});

test('a big man\'s limbs take more, an old or a starved man\'s bone less', () => {
  const ordinary = parts(fighter(man(75)));
  const big = parts(fighter(man(115, { heightCm: 195, frame: 'large', exercise: 0.6 })));
  const old = parts(fighter(man(70, { age: 68, exercise: 0.2 })));
  const starved = parts(fighter(man(42, { exercise: 0.15 })));
  for (const key of ['wrist', 'thigh', 'waist']) {
    assert.ok(big[key] > ordinary[key], `${key}: big ${big[key].toFixed(0)} against ${ordinary[key].toFixed(0)}`);
    assert.ok(old[key] < ordinary[key] && starved[key] < ordinary[key], `${key}: old ${old[key].toFixed(0)}, starved ${starved[key].toFixed(0)}`);
  }
});

test('a blow on a forearm meets what is there: the glove at its end, the ulna\'s edge on its back, the muscle on its face', () => {
  const body = fighter(man(75)).body;
  const elbow = [0, 1.2, 0];
  const hand = [0, 1.5, 0];
  const shoulder = [0, 1.45, -0.05];
  const arm = { elbow, hand, shoulder };
  // (The back of this forearm faces -z: the way the elbow points.)
  const glove = guardMeets(body, 'lForearm', [0, 1.49, -0.04], [0, 0, -1], arm, true, 1.375);
  const fist = guardMeets(body, 'lForearm', [0, 1.49, -0.04], [0, 0, -1], arm, false, 1.375);
  const edge = guardMeets(body, 'lForearm', [0, 1.33, -0.04], [0, 0, -1], arm);
  const flat = guardMeets(body, 'lForearm', [0.04, 1.33, 0], [1, 0, 0], arm);
  assert.equal(glove.region, 'hand');
  assert.equal(edge.region, 'forearm');
  assert.ok(glove.stretch > fist.stretch, 'the glove draws a blow out more than a bare fist');
  assert.ok(flat.depth > 2 * edge.depth && flat.stretch > edge.stretch, `flat ${(flat.depth * 1000).toFixed(0)} mm, edge ${(edge.depth * 1000).toFixed(0)} mm`);
  // Off the forearm, the part as it is.
  assert.equal(guardMeets(body, 'lThigh', [0, 0.6, 0], [1, 0, 0], arm).stretch, bluntPart(body, 'lThigh').stretch);
});

test('bone grips a blade by the square of its depth in it, to the bevel; the skull only by its vault', () => {
  const inBone = (bone, wall = Infinity) => lodgeHold({ depth: 0.06, bone }, 0.1, false, false, wall) - lodgeHold({ depth: 0.06, bone: 0 }, 0.1);
  assert.ok(inBone(LODGE.bevel) > 6 * inBone(0.01), `${inBone(0.01).toFixed(0)} N at 1 cm, ${inBone(LODGE.bevel).toFixed(0)} N at the bevel`);
  // Past the bevel the faces are all but parallel: deeper, it grips by the face alone.
  assert.ok(inBone(2 * LODGE.bevel) < 2.1 * inBone(LODGE.bevel));
  assert.ok(inBone(0.05, LODGE.skullWall) < inBone(0.05) / 3, `skull ${inBone(0.05, LODGE.skullWall).toFixed(0)} N against a spine's ${inBone(0.05).toFixed(0)}`);
});

const pair = () => {
  const world = createWorld([{ ...PRESETS.samurai }, { ...PRESETS.passive }], { seed: 2 });
  placeFighter(world.fighters[0], -0.8, 0);
  placeFighter(world.fighters[1], 0.8, 0);
  advance(world, 0.3);
  return world;
};
const into = (world, { travel = null, cleaving = 150 } = {}) => {
  const [striker, victim] = world.fighters;
  const capsule = capsules(victim).find((found) => found.key === 'trunk');
  const weapon = striker.weapon;
  const [a, b] = [point(victim.x, capsule.a), point(victim.x, capsule.b)];
  const at = a.map((value, axis) => value + (b[axis] - value) * 0.55);
  const hand = point(striker.x, P[`${weapon.main}Hand`]);
  const toward = vec.normalize(vec.sub(at, hand));
  weapon.dir = toward;
  const event = { effects: [] };
  const held = lodgeBlade(world, striker, victim, weapon, capsule, 0.55, vec.sub(at, vec.scale(toward, capsule.radius)), { left: { flesh: 80, bone: 70 }, cleaving, pierce: 0, distance: weapon.spec.length * 0.7, travel: travel ?? vec.normalize(vec.cross([0, 1, 0], toward)), event });
  return held;
};

test('an edge still sliding along itself as it stops is not held; one stopped dead in bone is', () => {
  const world = pair();
  const toward = world.fighters[0].weapon.dir;
  assert.ok(into(world));
  const sliding = pair();
  const dir = vec.normalize(vec.sub(point(sliding.fighters[1].x, P.neck), point(sliding.fighters[0].x, P.rHand)));
  const across = vec.normalize(vec.cross([0, 1, 0], dir));
  // (Half again as fast along the edge as into the cut: past LODGE.slip.)
  assert.equal(into(sliding, { travel: vec.normalize(vec.add(across, vec.scale(dir, 1.5))) }), false);
  assert.ok(toward);
});

test('a held blade leaves its wielder\'s hands at once: the man it is in is not flung', () => {
  const world = pair();
  const [striker, victim] = world.fighters;
  victim.stun = 30;
  assert.ok(into(world));
  assert.ok(world.debris.some((piece) => piece.stuck?.in === victim.id));
  let fastest = 0;
  for (let step = 0; step < 60; step += 1) {
    advance(world, 1 / 60);
    for (const index of [P.pelvis, P.neck, P.head, P.lHand, P.rHand]) fastest = Math.max(fastest, Math.hypot(victim.v[index * 3], victim.v[index * 3 + 1], victim.v[index * 3 + 2]));
  }
  assert.ok(fastest < 6, `the man it is in moved at up to ${fastest.toFixed(1)} m/s`);
  assert.ok(striker);
});

// ---- Squareness: one measure for the bone, the limb's weakening and the artery ----------------------------------

const thighOf = (world) => {
  const victim = world.fighters[1];
  const capsule = capsules(victim).find((found) => found.key === 'lThigh');
  const [a, b] = [point(victim.x, capsule.a), point(victim.x, capsule.b)];
  const t = 0.5;
  const centre = a.map((value, axis) => value + (b[axis] - value) * t);
  const axis = vec.normalize(vec.sub(b, a));
  // (The thigh's inner side: toward the other hip.)
  const toward = vec.sub(point(victim.x, P.rHip), centre);
  const inward = vec.normalize(vec.sub(toward, vec.scale(axis, vec.dot(toward, axis))));
  const left = limbResistance(victim, { joint: 'hip', side: 'l' }, 'lThigh');
  return { victim, capsule, closest: { t }, centre, inward, left };
};

test('a square cut reaches the bone and can break it; a graze with the same energy does not', () => {
  const world = pair();
  const { victim, left } = thighOf(world);
  const near = left.flesh / 2;
  // Square: all of it toward the bone; a graze: BLADES.bone grazeShare of it.
  assert.equal(boneShare(near * 1.2, 1, near), 1);
  assert.ok(boneShare(near * 1.2, 0, near) < 0.5);
  const heavy = left.flesh / 2 + left.boneWhole * (BLADES.limbCut.splits + 0.1);
  const graze = { effects: [] };
  assert.equal(cutIntoLimb(world, victim, { key: 'lThigh' }, 0.5, heavy, 0, graze), false, 'a graze notches the side of the bone');
  const other = pair();
  const square = { effects: [] };
  assert.equal(cutIntoLimb(other, other.fighters[1], { key: 'lThigh' }, 0.5, heavy, 1, square), true, 'square, it breaks');
});

test('a deep square cut into the inner thigh opens the femoral artery; from the outer side it stops in the bone first; a thrust straight in reaches it, one skidding along does not', () => {
  const world = pair();
  const { victim, capsule, closest, centre, inward, left } = thighOf(world);
  const radius = capsule.radius;
  const inner = vec.add(centre, vec.scale(inward, radius));
  const outer = vec.sub(centre, vec.scale(inward, radius));
  const deep = left.flesh * 0.6;
  assert.ok(reachesArtery(victim, capsule, closest, inner, inward, vec.scale(inward, -1), left, deep, 0), 'inner side, deep');
  assert.ok(!reachesArtery(victim, capsule, closest, inner, inward, vec.scale(inward, -1), left, left.flesh * 0.05, 0), 'a nick');
  assert.ok(!reachesArtery(victim, capsule, closest, outer, vec.scale(inward, -1), inward, left, deep, 0), 'outer side: the bone is between');
  // A thrust along its own line into the inner thigh, and one along the surface.
  assert.ok(reachesArtery(victim, capsule, closest, inner, inward, vec.scale(inward, -1), left, 0, 80), 'thrust straight in');
  const along = vec.normalize(vec.sub(point(victim.x, capsule.b), point(victim.x, capsule.a)));
  assert.ok(!reachesArtery(victim, capsule, closest, inner, inward, along, left, 0, 80), 'a point skidding along the surface');
});
