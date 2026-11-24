// A blade stopped in a body is held by it (physics/lodge.js): how deep it is from what the section had left, what holds
// it, how it is drawn or left, and what follows for the two men. And the marks that say a man's hurt in place of the old
// tint (markview.js): what each kind of harm leaves.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { P, PRESETS } from '../src/body.js';
import { vec } from '../src/pose.js';
import { advance, capsules, createWorld, perform, limbResistance, placeFighter, point, throwPunch, trunkResistance } from '../src/physics.js';
import { thinkAll } from '../src/ai.js';
import { letGoLodged, LODGE, lodgeBlade, lodgeDepth, lodgedBlade, lodgeEta, lodgeHold, skullLeft } from '../src/physics/lodge.js';
import { MARK_FLAG, MARK_KIND, MARKS, markDamage, markOfBlow, marksOf, marksPose, markTier, markUniforms } from '../src/markview.js';
import { boneFrames } from '../src/rig.js';
import { PARTICLES } from '../src/body.js';
import { STYLES } from '../src/moves.js';

const pair = (red = { ...PRESETS.samurai }, blue = { ...PRESETS.passive }, apart = 1.6) => {
  const world = createWorld([red, blue], { seed: 2 });
  placeFighter(world.fighters[0], -apart / 2, 0);
  placeFighter(world.fighters[1], apart / 2, 0);
  advance(world, 0.3);
  return world;
};
/** The first man's blade put into the second's `key`, as a blow that stopped there (a cut of `cleaving` J or a thrust of `pierce` J). */
const lodge = (world, key, { t = 0.55, cleaving = 0, pierce = 0, left = { flesh: 80, bone: 70 } } = {}) => {
  const [striker, victim] = world.fighters;
  const capsule = capsules(victim).find((found) => found.key === key);
  const weapon = striker.weapon;
  const [a, b] = [point(victim.x, capsule.a), point(victim.x, capsule.b)];
  const at = a.map((value, axis) => value + (b[axis] - value) * t);
  const hand = point(striker.x, P[`${weapon.main}Hand`]);
  const toward = vec.normalize(vec.sub(at, hand));
  const contact = vec.sub(at, vec.scale(toward, capsule.radius));
  weapon.dir = toward;
  const event = { effects: [] };
  const held = lodgeBlade(world, striker, victim, weapon, capsule, t, contact, { left, cleaving, pierce, distance: Math.min(vec.length(vec.sub(contact, hand)), weapon.spec.length * 0.8), travel: cleaving > pierce ? vec.normalize(vec.cross([0, 1, 0], toward)) : toward, bleed: 0.0005, event });
  if (held) world.lodging = true;
  return held ? event.lodged : null;
};
const level = (man, along) => ({ along, cos: 1, lo: along, hi: along });

test('the same cut goes through a slight body and stops in a broad one, deeper the more energy it has', () => {
  const man = (inputs) => createWorld([{ ...inputs, style: 'boxing' }, { ...inputs, style: 'boxing' }], { seed: 1 }).fighters[1];
  const slight = man({ ...PRESETS.contender, heightCm: 155, frame: 'small', exercise: 0.3, calories: 1900 });
  const middling = man(PRESETS.light);
  const broad = man(PRESETS.sumo);
  const whole = (body) => { const left = trunkResistance(body, level(body, 0.3)); return left.flesh + left.bone; };
  assert.ok(whole(slight) < whole(middling) && whole(middling) < whole(broad));
  // 150 J: through the slight one, not the others.
  assert.ok(150 > whole(slight) && 150 < whole(middling) && 150 < whole(broad), `${whole(slight).toFixed(0)}, ${whole(middling).toFixed(0)}, ${whole(broad).toFixed(0)} J`);
  const depth = (body, joules) => lodgeDepth(trunkResistance(body, level(body, 0.3)), body.body.segments.trunk.skinRadius * 0.78, body.body.segments.trunk.boneRadius, joules, 0);
  // In the broad man it has more flesh to go through before the spine: 60 J is still in his muscle, and into the middling man's bone.
  assert.equal(depth(broad, 60).bone, 0);
  assert.ok(depth(middling, 60).bone > 0);
  assert.ok(depth(broad, 110).depth > depth(broad, 60).depth && depth(broad, 200).depth > depth(broad, 110).depth);
  // A limb likewise: a cut that takes a slight thigh off stops in a heavy one's bone.
  const thigh = (body) => { const left = limbResistance(body, { joint: 'hip', side: 'l' }, 'lThigh'); return left.flesh + left.bone; };
  assert.ok(thigh(slight) < 70 && thigh(broad) > 110);
});

test('what holds a blade: little in flesh, much in bone, more the deeper; a point between bones is pinched', () => {
  const flesh = lodgeHold({ depth: 0.06, bone: 0 }, 0.15);
  const bone = lodgeHold({ depth: 0.06, bone: 0.02 }, 0.15);
  assert.ok(flesh > 50 && flesh < 150, `${flesh.toFixed(0)} N in flesh`);
  assert.ok(bone > flesh + 400, `${bone.toFixed(0)} N with 2 cm of it in bone`);
  assert.ok(lodgeHold({ depth: 0.12, bone: 0.05 }, 0.15) > bone);
  assert.ok(lodgeHold({ depth: 0.5, bone: 0.5 }, 0.3) < LODGE.boneMost + 2000);
  const point0 = lodgeHold({ depth: 0.2, bone: 0 }, 0.03);
  assert.equal(lodgeHold({ depth: 0.2, bone: 0 }, 0.03, true) - point0, LODGE.pinch);
  // The skull is several times harder to go through than the neck: an edge bites into it and stops.
  const skull = skullLeft(0.47);
  const bite = lodgeDepth(skull, 0.09, 0.09 * 0.85, 150, 0);
  assert.ok(bite.bone > 0.02 && bite.bone < 0.09, `${(bite.bone * 100).toFixed(1)} cm into the skull at 150 J`);
});

test('a light slash is not held, nor a cut his stroke would have out again at once; a cut into the spine is', () => {
  assert.equal(lodge(pair(), 'trunk', { cleaving: 12 }), null, 'a slash that opens the skin');
  assert.equal(lodge(pair(), 'trunk', { cleaving: 45, left: { flesh: 200, bone: 100 } }), null, 'deep in flesh, short of the bone: out with the stroke');
  const world = pair();
  const held = lodge(world, 'trunk', { cleaving: 100 });
  assert.ok(held && held.bone && held.hold > 800, JSON.stringify(held));
  assert.ok(world.events.some((event) => event.kind === 'lodged' && event.fighter === 0 && event.defender === 1));
});

test('held, the two are joined: his blade strikes and guards nothing, he hauls it loose in time, and the wound opens again', () => {
  const world = pair();
  const [striker, victim] = world.fighters;
  victim.stun = 30;
  lodge(world, 'trunk', { cleaving: 100 });
  assert.equal(lodgedBlade(striker), striker.weapon);
  const move = Object.keys(STYLES[striker.style].attacks)[0];
  assert.equal(throwPunch(world, striker, move, 'body'), false, 'no stroke with a held blade');
  assert.equal(perform(world, striker, 'parry'), false, 'nor a parry');
  const held0 = striker.lodged.hold;
  const eta = lodgeEta(world, striker);
  assert.ok(eta > 0.5 && eta < 8, `about ${eta.toFixed(1)} s to get it out`);
  const bleed0 = victim.bleed ?? 0;
  advance(world, 0.6);
  assert.ok(striker.lodged && striker.lodged.hold < held0, 'worked at, it loosens');
  // His hand stays at the wound, on the blade's line, as the two move.
  assert.ok(striker.lodged.off < 0.12, `hand ${striker.lodged.off.toFixed(2)} m off the blade`);
  let seconds = 0.6;
  while (striker.lodged && seconds < 10) { advance(world, 0.1); seconds += 0.1; }
  const freed = world.events.find((event) => event.kind === 'freed' && event.fighter === 0);
  // (He may be dragged over with the man it is in and lose it: then it is left in him.)
  if (freed) {
    assert.ok(freed.seconds > 0.5, `out after ${freed.seconds.toFixed(1)} s`);
    assert.ok((victim.bleed ?? 0) > bleed0, 'the wound bleeds again as it comes out');
    assert.ok(striker.weapon.held);
  } else assert.ok(world.debris.some((piece) => piece.stuck?.in === 1));
});

test('two hands haul it out sooner than one, a strong man sooner than a starved one', () => {
  const eta = (red) => { const world = pair(red); lodge(world, 'trunk', { cleaving: 100 }); return lodgeEta(world, world.fighters[0]); };
  const two = eta({ ...PRESETS.light, style: 'katana' });
  const one = eta({ ...PRESETS.light, style: 'saber' });
  const weak = eta({ ...PRESETS.starved, style: 'katana' });
  assert.ok(two < one, `${two.toFixed(1)} s with two hands, ${one.toFixed(1)} s with one`);
  assert.ok(two < weak, `${weak.toFixed(1)} s for a starved man`);
});

test('let go, or put down, the weapon stays in the body: he is disarmed and draws his sidearm, and it goes down with the man it is in', () => {
  const world = pair();
  const [striker, victim] = world.fighters;
  lodge(world, 'lThigh', { t: 0.4, cleaving: 62, left: { flesh: 30, bone: 50 } });
  assert.ok(striker.lodged);
  const kind = striker.weapon.kind;
  letGoLodged(world, striker);
  assert.equal(striker.lodged, null);
  const left = world.debris.find((piece) => piece.stuck);
  assert.ok(left && left.weapon === kind && left.stuck.in === victim.id);
  assert.ok(world.events.some((event) => event.kind === 'disarmed' && /left in the wound/.test(event.effects[0])));
  advance(world, 1.5, (w, dt) => thinkAll(w, dt));
  assert.notEqual(striker.weapon?.kind, kind, 'his sidearm, or his hands');
  // It rides the thigh it is in, wherever he goes; no one takes it up while he stands.
  const knee = point(victim.x, P.lKnee);
  assert.ok(Math.hypot(...left.x.map((value, axis) => value - knee[axis])) < 1.2);
  assert.equal(left.resting, false);
  victim.state = 'out';
  advance(world, 2);
  assert.ok(left.x[1] < 0.9, 'down with him');
  assert.equal(left.resting, true, 'and may be taken up');
  // Knocked out with his blade held: it stays where it is.
  const other = pair();
  lodge(other, 'trunk', { cleaving: 100 });
  other.fighters[0].state = 'out';
  advance(other, 0.2);
  assert.equal(other.fighters[0].lodged, null);
  assert.ok(other.debris.some((piece) => piece.stuck?.in === 1));
});

test('lodging is the exception in real duels, and never a light blow', () => {
  let lodged = 0;
  let bouts = 0;
  for (let seed = 500; seed < 512; seed += 1) {
    const world = createWorld([{ ...PRESETS.contender, style: 'katana' }, { ...PRESETS.contender, style: 'katana' }], { seed });
    advance(world, 40, (w, dt) => thinkAll(w, dt));
    bouts += 1;
    for (const event of world.events) {
      if (event.kind !== 'lodged') continue;
      lodged += 1;
      assert.ok(event.depth >= 0.03, `held ${(event.depth * 100).toFixed(1)} cm in`);
    }
    assert.ok(![...world.fighters[0].x, ...world.fighters[1].x].some(Number.isNaN));
  }
  assert.ok(lodged <= bouts * 1.5, `${lodged} in ${bouts} bouts`);
});

// ---- The marks -------------------------------------------------------------------------------------------------

const framesOf = (fighter) => boneFrames(PARTICLES.map((_, index) => point(fighter.x, index)), fighter.body);
const blow = (fighter, target, more) => {
  const frames = framesOf(fighter);
  const at = point(fighter.x, P.neck);
  return markOfBlow(fighter, frames, { kind: 'landed', target, point: [at[0] + 0.15, at[1] - 0.2, at[2]], normal: [1, 0, 0], edge: [0, 0.7, 0.7], ...more }, 1);
};
const marks = (fighter) => { const store = marksOf(fighter); return Array.from({ length: store.count }, (_, index) => ({ kind: store.data[index * 18 + 10], half: store.data[index * 18 + 11], width: store.data[index * 18 + 12], reach: store.data[index * 18 + 13], strength: store.data[index * 18 + 14], flags: store.data[index * 18 + 16] })); };

test('every kind of harm leaves its mark: a graze, a cut, a gape to the bone, a hole, a score, a bruise with split skin', () => {
  const man = () => pair().fighters[1];
  let m = man();
  blow(m, 'trunk', { weapon: 'katana', cut: 5, energy: 10, edgeShare: 1 });
  blow(m, 'trunk', { weapon: 'katana', cut: 28, energy: 40, edgeShare: 1 });
  blow(m, 'trunk', { weapon: 'katana', cut: 95, energy: 110, edgeShare: 1, bleeds: true, effects: ['deep cut', 'the bone cut into'] });
  const [graze, cut, gape] = marks(m);
  assert.ok(graze.kind === MARK_KIND.wound && cut.kind === MARK_KIND.wound && gape.kind === MARK_KIND.wound);
  assert.ok(graze.width < cut.width && cut.width < gape.width && graze.half < cut.half && cut.half < gape.half);
  assert.ok(graze.reach < cut.reach && cut.reach < gape.reach);
  assert.ok(gape.flags & MARK_FLAG.bone && gape.flags & MARK_FLAG.runs && !(cut.flags & MARK_FLAG.bone));
  m = man();
  blow(m, 'trunk', { weapon: 'spear', pierce: 40, energy: 50, edgeShare: 1, bleeds: true });
  assert.equal(marks(m)[0].half, 0, 'a hole, not a line');
  blow(m, 'trunk', { weapon: 'katana', cut: 0, energy: 70, edgeShare: 1 });
  assert.equal(marks(m)[1].kind, MARK_KIND.score);
  blow(m, 'head', { weapon: 'mace', energy: 20, harm: 1, edgeShare: 0 });
  assert.deepEqual(marks(m).slice(2).map((mark) => mark.kind), [MARK_KIND.blunt]);
  blow(m, 'head', { weapon: 'mace', energy: 90, harm: 1, edgeShare: 0 });
  const hard = marks(m).slice(3);
  assert.deepEqual(hard.map((mark) => mark.kind), [MARK_KIND.blunt, MARK_KIND.wound], 'a hard one splits the skin');
  assert.ok(hard[1].flags & MARK_FLAG.skin, 'on bare skin only');
  // An arrow or a ball: a hole.
  const frames = framesOf(m);
  assert.ok(markOfBlow(m, frames, { kind: 'arrow', target: 'trunk', point: point(m.x, P.neck), normal: [1, 0, 0], cut: 0, pierce: 25, bleeds: true }, 2));
});

test('harm no blow placed is marked too: a part hurt with no mark for it, a burn, a broken joint', () => {
  const man = pair().fighters[1];
  const frames = framesOf(man);
  markDamage(man, frames);
  assert.equal(marksOf(man).count, 0, 'unhurt: none');
  man.damage.lThigh = 0.4;
  markDamage(man, frames);
  assert.deepEqual(marks(man).map((mark) => mark.kind), [MARK_KIND.blunt]);
  markDamage(man, frames);
  assert.equal(marksOf(man).count, 1, 'once');
  // A blow that left its own mark answers for the damage it did.
  man.damage.rForearm = 0.5;
  blow(man, 'rForearm', { weapon: 'katana', cut: 30, energy: 40, edgeShare: 1 });
  markDamage(man, frames);
  assert.equal(marksOf(man).count, 2);
  man.burning = { heat: 1 };
  man.damage.trunk = 0.5;
  markDamage(man, frames);
  assert.equal(marks(man).at(-1).kind, MARK_KIND.burn);
  man.broken.add('lKnee');
  markDamage(man, frames);
  assert.equal(marksOf(man).count, 4);
  assert.equal(marks(man).at(-1).strength, 1, 'a dark swelling at the break');
});

test('a man keeps the marks that matter and each tier draws the greatest of them', () => {
  const man = pair().fighters[1];
  for (let index = 0; index < 12; index += 1) blow(man, 'trunk', { weapon: 'katana', cut: 0, energy: 20 + index, edgeShare: 1 });
  assert.equal(marksOf(man).count, MARKS.most);
  blow(man, 'trunk', { weapon: 'katana', cut: 90, energy: 100, edgeShare: 1, bleeds: true });
  assert.ok(marks(man).some((mark) => mark.kind === MARK_KIND.wound), 'a wound takes a scratch\'s place');
  const uniforms = markUniforms();
  const frames = framesOf(man);
  markTier('high');
  marksPose(man, frames, uniforms, 5, true);
  assert.equal(uniforms.uMarkCount.value, 8);
  markTier('low');
  marksPose(man, frames, uniforms, 5, true);
  assert.equal(uniforms.uMarkCount.value, MARKS.tiers.low);
  assert.ok(MARKS.tiers.low >= 1, 'the low tier still shows a man\'s hurt');
  assert.equal(uniforms.uMarkB.value[3], MARK_KIND.wound, 'the wound first');
  marksPose(man, frames, uniforms, 5, false);
  assert.equal(uniforms.uMarkCount.value, 0, 'none far from the camera');
  markTier('high');
});
