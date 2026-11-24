// The cuts and the guards as tissue and bone make them (the user's call, 2026-11-24): what it takes to part a limb and the
// trunk on a body (physics.js tissueSection, limbResistance, trunkResistance; weapons.js BLADES.tissueCut); what a blow on
// a forearm meets (physics/blunt.js guardMeets); a held blade's joint and when an edge is held at all (physics/lodge.js).
import test from 'node:test';
import assert from 'node:assert/strict';
import { FRAMES, P, PRESETS } from '../src/body.js';
import { caloriesForWeight } from '../src/physiology.js';
import { vec } from '../src/pose.js';
import { advance, capsules, createWorld, limbResistance, placeFighter, point, trunkResistance } from '../src/physics.js';
import { bluntPart, guardMeets } from '../src/physics/blunt.js';
import { LODGE, lodgeBlade, lodgeHold } from '../src/physics/lodge.js';
import { thinkAll } from '../src/ai.js';

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
  assert.ok(ordinary.waist > 1.5 * ordinary.thigh, `waist ${ordinary.waist.toFixed(0)} J`);
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

test('bone grips a blade by the square of its depth in it, the skull only by its vault', () => {
  const shallow = lodgeHold({ depth: 0.04, bone: 0.01 }, 0.1) - lodgeHold({ depth: 0.04, bone: 0 }, 0.1);
  const deep = lodgeHold({ depth: 0.06, bone: 0.03 }, 0.1) - lodgeHold({ depth: 0.06, bone: 0 }, 0.1);
  assert.ok(deep > 8 * shallow, `${shallow.toFixed(0)} N at 1 cm, ${deep.toFixed(0)} N at 3 cm`);
  const skull = lodgeHold({ depth: 0.06, bone: 0.03 }, 0.1, false, false, LODGE.skullWall) - lodgeHold({ depth: 0.06, bone: 0 }, 0.1);
  assert.ok(skull < deep / 3, `skull ${skull.toFixed(0)} N against a spine's ${deep.toFixed(0)}`);
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
  const held = lodgeBlade(world, striker, victim, weapon, capsule, 0.55, vec.sub(at, vec.scale(toward, capsule.radius)), { left: { flesh: 80, bone: 70 }, cleaving, pierce: 0, distance: weapon.spec.length * 0.7, travel: travel ?? vec.normalize(vec.cross([0, 1, 0], toward)), bleed: 0.0005, event });
  if (held) world.lodging = true;
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

test('a held blade joins the two men by a force no more than holds it: the man it is in is not flung', () => {
  const world = pair();
  const [striker, victim] = world.fighters;
  victim.stun = 30;
  assert.ok(into(world));
  let fastest = 0;
  let most = 0;
  for (let step = 0; step < 90 && striker.lodged; step += 1) {
    advance(world, 1 / 60, (w, dt) => thinkAll(w, dt));
    if (striker.lodged) most = Math.max(most, Math.abs(striker.lodged.force ?? 0) / Math.max(1, Math.min(striker.lodged.held, 3000)));
    for (const index of [P.pelvis, P.neck, P.head, P.lHand, P.rHand]) fastest = Math.max(fastest, Math.hypot(victim.v[index * 3], victim.v[index * 3 + 1], victim.v[index * 3 + 2]));
  }
  assert.ok(fastest < 6, `the man it is in moved at up to ${fastest.toFixed(1)} m/s`);
  assert.ok(most <= 1.01, `the joint bore ${most.toFixed(2)} of the hold at most`);
});
