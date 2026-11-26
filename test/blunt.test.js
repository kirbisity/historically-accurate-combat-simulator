import test from 'node:test';
import assert from 'node:assert/strict';
import { FRAMES, P, PRESETS, buildBody } from '../src/body.js';
import { caloriesForWeight } from '../src/physiology.js';
import { MOVES } from '../src/moves.js';
import { advance, armGuard, createWorld, guardOverrun, holdGuard, injuryOf, placeFighter, throwPunch } from '../src/physics.js';
import { BLUNT, bluntPart, fleshStretch, guardGives } from '../src/physics/blunt.js';

// Bodies of one height (1.75 m, a man of 27 unless said) at a weight: what feeding and training settle into (physiology.js).
const man = (kg, extra = {}) => {
  const inputs = { sex: 'male', heightCm: 175, frame: 'medium', age: 27, exercise: 0.4, style: 'boxing', ...extra };
  return { ...inputs, calories: Math.round(caloriesForWeight(inputs, kg, FRAMES[inputs.frame].lean)) };
};
const starved = man(42, { exercise: 0.15 });
const thin = man(55, { exercise: 0.2 });
const ordinary = man(75);
const strong = man(90, { exercise: 0.85 });
const fat = man(110, { exercise: 0.15 });
const old = man(70, { age: 68, exercise: 0.2 });

/** One blow thrown at a man standing `distance` off (his guard held against it if `guard`): the event and the man. */
function blow(attacker, move, zone, distance, defender, { guard = false, seed = 1 } = {}) {
  const world = createWorld([attacker, defender], { seed });
  const [striker, struck] = world.fighters;
  placeFighter(striker, -distance / 2, 0);
  placeFighter(struck, distance / 2, 0);
  const think = guard ? (current) => holdGuard(current, struck, striker) : undefined;
  advance(world, 0.8, think);
  world.events.length = 0;
  throwPunch(world, striker, move, zone);
  advance(world, MOVES[move].duration + 0.3, think);
  const hit = world.events.find((event) => event.attacker === striker.id && event.defender === struck.id && (event.kind === 'landed' || event.kind === 'blocked'));
  return { hit, struck, world };
}

test('a bone breaks by the body it is in: mineral, frame, sex, height and years', () => {
  const bone = (inputs) => buildBody(inputs).bone;
  const fracture = (inputs) => buildBody(inputs).fracture;
  // The reference man is 1; the starved break at half to two thirds of a fed man's force.
  assert.ok(Math.abs(bone(ordinary).impact - 1) < 0.1, `${bone(ordinary).impact}`);
  const hungry = bone(starved).impact / bone(ordinary).impact;
  assert.ok(hungry > 0.4 && hungry < 0.67, `starved ${hungry}`);
  // A man of 68 well under one of 27 at the same weight, his toughness (the energy to break) further than his strength.
  const young = bone(man(70, { exercise: 0.2 }));
  const aged = bone(old);
  assert.ok(aged.impact < 0.75 * young.impact && aged.impact > 0.4 * young.impact, `${aged.impact} against ${young.impact}`);
  assert.ok(aged.toughness < aged.impact && aged.impact < aged.strength);
  // Trained and heavy: denser; a large frame and a tall one: thicker; a small woman's forearm about half a man's.
  assert.ok(bone(strong).impact > 1.25 * bone(ordinary).impact);
  assert.ok(bone(man(75, { frame: 'large' })).impact > 1.1 * bone(ordinary).impact);
  const tall = bone({ ...man(75), heightCm: 195, calories: Math.round(caloriesForWeight({ ...man(75), heightCm: 195 }, 93, 1)) });
  assert.ok(tall.section > 1.2, `${tall.section}`);
  const woman = { sex: 'female', heightCm: 155, frame: 'small', age: 27, exercise: 0.3, style: 'boxing' };
  const small = fracture({ ...woman, calories: Math.round(caloriesForWeight(woman, 48, FRAMES.small.lean)) });
  assert.ok(small.Forearm < 0.6 * fracture(ordinary).Forearm && small.Forearm > 0.35 * fracture(ordinary).Forearm);
  // Every long bone, the ribs, the face and the hand move together; the order of the bones holds.
  const f = fracture(ordinary);
  assert.ok(f.Forearm < f.UpperArm && f.UpperArm < f.Shank && f.Shank < f.Thigh);
  for (const key of ['face', 'rib', 'hand', 'Forearm', 'Thigh']) assert.ok(fracture(starved)[key] < 0.67 * f[key] && fracture(strong)[key] > 1.25 * f[key], key);
  // A fixed build is its frame and its own bones, as given; a machine has no flesh and takes a blow as the reference does.
  const gorilla = buildBody(PRESETS.gorilla);
  assert.equal(gorilla.bone.impact, FRAMES[PRESETS.gorilla.frame].bone * (PRESETS.gorilla.build.bones ?? 1));
  const machine = buildBody(Object.values(PRESETS).find((preset) => preset.build?.rigid));
  for (const key of ['head', 'trunk', 'lForearm', 'lThigh']) assert.deepEqual([bluntPart(machine, key).depth, bluntPart(machine, key).toll, bluntPart(machine, key).stretch], [0, 1, 1]);
});

test('fat and muscle cushion where they lie: a belly a great deal, a skull, a shin and the forearm hardly at all', () => {
  const depth = (inputs, key) => bluntPart(buildBody(inputs), key).depth;
  // The fat man's belly carries twice the ordinary man's cover and three times the starved man's.
  assert.ok(depth(fat, 'trunk') > 1.8 * depth(ordinary, 'trunk') && depth(fat, 'trunk') > 3 * depth(starved, 'trunk'));
  assert.ok(depth(fat, 'trunk') > 0.045 && depth(fat, 'trunk') < 0.09);
  // Over the skull, the shin and the forearm's edge: within a few millimetres on any of them.
  for (const key of ['head', 'lShank', 'lForearm']) {
    assert.ok(depth(fat, key) - depth(starved, key) < 0.012, `${key}: ${depth(fat, key)} against ${depth(starved, key)}`);
    assert.ok(depth(fat, key) < 0.016);
  }
  // The thigh's femur lies deep in muscle on a fed man, near the skin on a starved one.
  assert.ok(depth(strong, 'lThigh') > 2 * depth(starved, 'lThigh'));
  // A quarter off the peak force through 25 mm (Robinovitch et al. 1995); the contact longer by the same.
  assert.ok(Math.abs(1 / fleshStretch(0.025) - 0.74) < 0.03);
  // The toll of a blow on a part: under 1 on the padded and the strong-boned, over it on the thin, the old and the starved.
  const toll = (inputs, key) => bluntPart(buildBody(inputs), key).toll;
  assert.ok(Math.abs(toll(ordinary, 'trunk') - 1) < 0.06);
  assert.ok(toll(fat, 'trunk') < 0.9 && toll(strong, 'lForearm') < 0.8);
  assert.ok(toll(starved, 'lForearm') > 1.7 && toll(old, 'lForearm') > 1.5 && toll(thin, 'trunk') > 1.15);
  const [least, most] = BLUNT.toll;
  for (const inputs of [starved, thin, ordinary, strong, fat, old]) for (const key of ['head', 'trunk', 'lForearm', 'lThigh']) assert.ok(toll(inputs, key) >= least && toll(inputs, key) <= most);
});

test('the same staff blow on the arm: it breaks a starved man\'s and an old man\'s, bruises an ordinary man\'s, and a strong man\'s less', () => {
  // Struck by a weak man (the starved build with the staff): ~50 J and ~1.6 kN on the arm. The monk's own two-handed blow,
  // the staff held at its middle grip (physics/polegrip.js), comes in at ~17 m/s, ~150 J and ~3 kN, and breaks any bare
  // forearm, as a full staff blow does (the nightstick fracture of the ulna comes from a lighter baton): the gradient by body
  // is shown under it.
  const staff = { ...starved, style: 'staff' };
  const taken = (defender) => {
    const rows = [];
    for (const distance of [1.6, 1.9, 2.2]) {
      const { hit, struck } = blow(staff, 'naginataSweep', 'body', distance, defender);
      if (hit && /Forearm|UpperArm/.test(hit.target)) rows.push({ injury: injuryOf(struck, hit.target), broke: struck.broken.size > 0, force: hit.force });
    }
    assert.ok(rows.length >= 2, 'the sweep met an arm');
    return { injury: rows.reduce((sum, row) => sum + row.injury, 0) / rows.length, broke: rows.filter((row) => row.broke).length / rows.length, force: rows[0].force };
  };
  const [hungry, plain, hard, aged] = [starved, ordinary, strong, old].map(taken);
  assert.ok(hungry.broke >= 0.5 && aged.broke >= 0.5, `starved ${hungry.broke}, old ${aged.broke}`);
  assert.equal(plain.broke, 0);
  assert.equal(hard.broke, 0);
  assert.ok(hungry.injury > 2.5 * plain.injury && plain.injury > 1.4 * hard.injury, `${hungry.injury} ${plain.injury} ${hard.injury}`);
});

test('a guard gives to what its owner cannot hold: by degree with his strength', () => {
  // The rule itself: nothing through under what the arm holds, more and more past it, never all.
  const held = guardGives(10, 3, 360, 0.16);
  assert.equal(held.through, 0);
  assert.ok(held.holds > 10);
  const shares = [20, 30, 60].map((impulse) => guardGives(impulse, 3, 360, 0.16).through);
  assert.ok(shares[0] > 0 && shares[0] < shares[1] && shares[1] < shares[2] && shares[2] < 1, `${shares}`);
  // A stronger arm holds more of the same blow; a closer guard less.
  assert.ok(guardGives(25, 3, 700, 0.16).through < guardGives(25, 3, 360, 0.16).through);
  assert.ok(guardGives(25, 3, 360, 0.05).through > guardGives(25, 3, 360, 0.16).through);
  // On bodies: the same 20 N·s on a forearm put up before the face.
  const through = (inputs) => {
    const world = createWorld([PRESETS.heavy, inputs], { seed: 1 });
    const defender = world.fighters[1];
    advance(world, 0.3, (current) => holdGuard(current, defender, world.fighters[0]));
    const head = [defender.x[P.head * 3], defender.x[P.head * 3 + 1], defender.x[P.head * 3 + 2]];
    return armGuard(defender, 'lForearm', 20, [head[0] - 0.26, head[1], head[2]], 'head');
  };
  const [weak, plain, hard] = [thin, ordinary, strong].map(through);
  assert.ok(weak.through > plain.through && plain.through >= hard.through, `${weak.through} ${plain.through} ${hard.through}`);
  assert.ok(weak.through > 0.5 && hard.through === 0);
  assert.equal(weak.behind, 'head');
  assert.ok(weak.holds < plain.holds && plain.holds < hard.holds);
});

test('a heavyweight\'s right hand comes through a light man\'s guard and not through his equal\'s; the fighter weighs it', () => {
  const rows = (defender) => {
    const list = [];
    for (const distance of [0.7, 0.8, 0.9, 1.0]) for (const seed of [1, 2]) {
      const { hit } = blow(PRESETS.heavy, 'cross', 'head', distance, defender, { guard: true, seed });
      if (hit?.kind === 'blocked' && /Forearm/.test(hit.target)) list.push(hit);
    }
    return list;
  };
  const light = rows(ordinary);
  const equal = rows({ ...PRESETS.heavy });
  assert.ok(light.length >= 2 && equal.length >= 2, `${light.length} ${equal.length}`);
  const most = (list) => Math.max(...list.map((hit) => hit.through));
  assert.ok(most(light) > 0.25, `through the lighter man's guard ${most(light)}`);
  assert.equal(most(equal), 0);
  assert.ok(light.some((hit) => hit.effects.includes('guard beaten in') && hit.headDeltaV > 0.3));
  // Less than the blow unguarded would have given his head: the guard takes its share.
  const beaten = light.find((hit) => hit.through > 0.25);
  assert.ok(beaten.headDeltaV < beaten.impulse / buildBody(ordinary).headEffectiveMass);
  // What he expects of it, before it lands (physics.js guardOverrun).
  const expects = (defender) => {
    const world = createWorld([PRESETS.heavy, defender], { seed: 1 });
    advance(world, 0.3);
    throwPunch(world, world.fighters[0], 'cross', 'head');
    return guardOverrun(world.fighters[0], world.fighters[1]);
  };
  assert.ok(expects(thin) > 0.4 && expects(starved) > expects(thin));
  assert.equal(expects({ ...PRESETS.heavy }), 0);
  assert.equal(expects(strong), 0);
});

test('the parry fracture: a bat swung into a forearm put up breaks it, bare; in a plate vambrace it does not', () => {
  const broken = (defender) => {
    let arms = 0;
    let breaks = 0;
    for (const distance of [1.2, 1.4, 1.6]) {
      const { hit, struck } = blow(PRESETS.bat, 'batSide', 'body', distance, defender);
      if (!hit || !/Forearm/.test(hit.target)) continue;
      arms += 1;
      if (hit.effects.includes('guarding arm broken') && struck.broken.size > 0) breaks += 1;
    }
    return { arms, breaks };
  };
  const plain = broken(ordinary);
  assert.ok(plain.arms >= 2 && plain.breaks >= 2, JSON.stringify(plain));
  const plated = broken({ ...ordinary, outfit: { kind: 'knight', design: 0 } });
  assert.ok(plated.arms >= 1 && plated.breaks === 0, JSON.stringify(plated));
});

test('a body blow hurts a thin man far more than a fat one', () => {
  // A trained man of 75 kg's push kick into the middle of each, from the same places.
  const kicker = { ...PRESETS.light, style: 'kickboxing' };
  const taken = (defender) => {
    const rows = [];
    for (const distance of [0.9, 1.0, 1.1]) {
      const { hit, struck } = blow(kicker, 'teep', 'body', distance, defender);
      assert.ok(hit?.target === 'trunk' && hit.kind === 'landed', `the kick met the trunk at ${distance}`);
      rows.push(injuryOf(struck, 'trunk'));
    }
    return rows.reduce((sum, value) => sum + value, 0) / rows.length;
  };
  const [slight, plain, heavy] = [thin, ordinary, fat].map(taken);
  assert.ok(slight > 1.25 * plain && plain > 1.1 * heavy && slight > 1.5 * heavy, `${slight} ${plain} ${heavy}`);
});
