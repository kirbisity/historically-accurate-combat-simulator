// Armour that wears where it is struck (physics/armourwear.js) and hung armour that swings as hung plates do (dangle.js HUNG):
// a sode or a skirt panel swings with the body and past it when it stops, far more than the old spring back to rest let it; laced
// lamellar loosens and falls after repeated hard cuts at one spot but not after one blow nor after many glancing ones; other
// lamellar takes more than twice the o-yoroi's blows; mail and scale only hole; plate never comes apart.

import test from 'node:test';
import assert from 'node:assert/strict';
import { PRESETS } from '../src/body.js';
import { createWorld, advance, armourPieceAt, protectionAt } from '../src/physics.js';
import { ARMOUR_WEAR, armourSpotAt, armourWornAt, wearArmour, wearFrom } from '../src/physics/armourwear.js';
import { repeatedBlows } from '../tools/armour-wear.js';

/** A man in a kit, standing a moment, and the other man of the world. */
function standing(kind, design = 0) {
  const world = createWorld([{ ...structuredClone(PRESETS.contender), style: 'boxing', outfit: { kind, design }, accessories: [] }, { ...PRESETS.contender }], { seed: 1 });
  advance(world, 0.5);
  return { world, man: world.fighters[0] };
}

/** The place on his left upper arm's outside (a sode, a shoulder flap), or his trunk's front: the spot armourSpotAt keys. */
function spotOn(man, key, t, normal) {
  return armourSpotAt(man, key, t, normal, armourPieceAt(man.body.gear, key, t), 0.06);
}

/** His left side's way (out of his left shoulder, level). */
function leftOf(man) {
  const x = man.x;
  const l = [x[2 * 3] - x[3 * 3], 0, x[2 * 3 + 2] - x[3 * 3 + 2]];
  const n = Math.hypot(...l);
  return l.map((value) => value / n);
}

/** The same blow (`edge` J of an edge) on one spot `count` times: the stages reached, by blow, and whether debris fell. */
function cutRepeatedly(world, man, at, edge, count) {
  const reached = [];
  for (let blow = 1; blow <= count; blow += 1) {
    const stage = wearArmour(world, man, at, edge * ARMOUR_WEAR.constructions[at.construction].exposure.cut, { point: [0, 1.4, 0], velocity: [0, 0, 0], along: [0, 0, -1] });
    if (stage) reached.push([blow, stage.name]);
  }
  return reached;
}

test("the o-yoroi's sode: one hard cut leaves it hanging; three part its cords and it swings by one; six drop it to the ground", () => {
  const { world, man } = standing('oyoroi');
  const at = spotOn(man, 'lUpperArm', 0.3, leftOf(man));
  assert.equal(at?.construction, 'kebiki');
  assert.equal(at.piece, 'shoulder:l');
  // (A hard katana cut: ~100 J of edge.)
  cutRepeatedly(world, man, at, 100, 1);
  assert.ok(!man.armourWear.pieces['shoulder:l'].loose, 'one blow does not loosen it');
  assert.equal(armourWornAt(man, at).gape, 0);
  cutRepeatedly(world, man, at, 100, 2);
  assert.ok(man.armourWear.pieces['shoulder:l'].loose, 'three hard cuts part its cords');
  cutRepeatedly(world, man, at, 100, 3);
  assert.ok(man.armourWear.pieces['shoulder:l'].gone, 'six drop it');
  assert.ok(world.debris.some((piece) => piece.kind === 'armour' && piece.piece === 'shoulder:l'), 'it falls as debris');
  // Gone: the arm there is unguarded by it.
  assert.ok(armourWornAt(man, at).gone);
});

test('an evening of glancing blows on the same sode does not part it', () => {
  const { world, man } = standing('oyoroi');
  const at = spotOn(man, 'lUpperArm', 0.3, leftOf(man));
  assert.deepEqual(cutRepeatedly(world, man, at, 20, 200), []);
  assert.ok(!man.armourWear?.pieces['shoulder:l']?.loose);
});

test('other laced lamellar is tighter: it takes more than twice the o-yoroi’s blows at one spot to loosen and to drop', () => {
  const blowsTo = (construction, stage, edge = 100) => {
    let wear = 0;
    for (let blow = 1; blow < 200; blow += 1) {
      wear += wearFrom(construction, edge * ARMOUR_WEAR.constructions[construction].exposure.cut);
      if (wear >= ARMOUR_WEAR.constructions[construction].stages.find((each) => each.name === stage).at) return blow;
    }
    return Infinity;
  };
  // (However hard the cut: a katana's, a hard one, and one harder than any arm swings, where each meets its cap.)
  for (const edge of [100, 150, 1000]) {
    for (const stage of ['loose', 'gone']) assert.ok(blowsTo('lamellar', stage, edge) > 2 * blowsTo('kebiki', stage, edge), `${edge} J ${stage}: ${blowsTo('lamellar', stage, edge)} vs ${blowsTo('kebiki', stage, edge)}`);
    // A coat of plates opens slower still than lamellar loosens.
    assert.ok(blowsTo('brigandine', 'open', edge) > blowsTo('lamellar', 'loose', edge), `${edge} J: brigandine ${blowsTo('brigandine', 'open', edge)}`);
  }
  // And the Mongol and Ming kits wear as that lamellar.
  for (const kind of ['steppeMedium', 'mingIronLamellar']) {
    const { man } = standing(kind);
    const at = spotOn(man, 'trunk', 0.5, [Math.cos(man.yaw ?? 0), 0, -Math.sin(man.yaw ?? 0)]);
    assert.equal(at?.construction, 'lamellar', kind);
  }
});

test('mail and scale only hole, butted mail sooner than riveted; padding is cut through layer by layer', () => {
  const blowsToHole = (construction) => {
    let wear = 0;
    for (let blow = 1; blow < 200; blow += 1) {
      wear += wearFrom(construction, 120 * ARMOUR_WEAR.constructions[construction].exposure.cut);
      if (wear >= 1) return blow;
    }
    return Infinity;
  };
  assert.ok(blowsToHole('buttedMail') < blowsToHole('mail'));
  for (const construction of ['mail', 'buttedMail', 'scale', 'brigandine']) {
    assert.ok(!ARMOUR_WEAR.constructions[construction].stages.some((stage) => stage.gone), `${construction} never falls off`);
    assert.ok(blowsToHole(construction) >= 3, `${construction}: no hole from one or two blows`);
  }
  const { world, man } = standing('conquistadorQuilted');
  const at = spotOn(man, 'trunk', 0.5, [1, 0, 0]);
  assert.equal(at?.construction, 'padded');
  const keeps = [];
  for (let blow = 0; blow < 4; blow += 1) {
    keeps.push(armourWornAt(man, at).keep);
    wearArmour(world, man, at, 100, {});
  }
  for (let k = 1; k < keeps.length; k += 1) assert.ok(keeps[k] < keeps[k - 1], `padding stops less each time: ${keeps}`);
});

test('plate never comes apart: no spot on a knight wears, and his breastplate stops the thirtieth blow as the first', () => {
  const { man } = standing('knight');
  for (const key of ['trunk', 'lUpperArm', 'lForearm', 'lThigh', 'lShank']) assert.equal(spotOn(man, key, 0.4, [1, 0, 0]), null, key);
  const { landings, wear } = repeatedBlows('knight', 'katana', 'kesagiri', 'body', { distance: 1.5, blows: 8 });
  assert.equal(wear, null);
  const cuts = landings.filter(Boolean).map((hit) => hit.cut);
  assert.ok(cuts.every((cut) => cut === cuts[0]), `the same every time: ${cuts}`);
  assert.ok(protectionAt(man.body.gear, 'trunk', 0.5).cut > 0.9);
});

test('in a fight: the same hard cut on the o-yoroi at one place gapes, loosens and opens it, and later cuts there go deeper', () => {
  const { stages, landings } = repeatedBlows('oyoroi', 'katana', 'kesagiri', 'body', { distance: 1.5, blows: 8, defenderStyle: 'katana' });
  const names = stages.map((each) => each.stage);
  assert.ok(names.includes('gaping') && names.includes('loose') && names.includes('gone'), names.join(','));
  const first = stages.find((each) => each.stage === 'loose').blow;
  assert.ok(first >= 2, 'not from one blow');
  assert.ok(landings.at(-1).cut > landings[0].cut, `deeper once opened: ${landings[0].cut} -> ${landings.at(-1).cut}`);
});

test("the kabuto's shikoro: rows come apart after a few hard cuts on the same place, and the rows below fall with the one cut", () => {
  const { stages, wear } = repeatedBlows('oyoroi', 'katana', 'yokogiri', 'head', { distance: 1.3, blows: 8, defenderStyle: 'katana' });
  const fell = stages.find((each) => each.stage === 'fell');
  assert.ok(fell && fell.blow >= 3, JSON.stringify(stages));
  // (The neck guard's second row cut through at the back: it falls, and the rows below it with it.)
  const { world, man } = standing('oyoroi');
  const back = [-Math.cos(man.yaw ?? 0) * 0.9, -0.42, Math.sin(man.yaw ?? 0) * 0.9];
  const at = armourSpotAt(man, 'head', 0, back, null, 0.1);
  assert.equal(at?.construction, 'kebiki');
  for (let blow = 0; blow < 6; blow += 1) wearArmour(world, man, at, 100, { point: [0, 1.6, 0] });
  assert.ok(man.armourWear.pieces[at.piece].gone);
  for (let row = at.row + 1; row < ARMOUR_WEAR.helmets.kabuto.rows; row += 1) assert.ok(armourWornAt(man, { ...at, piece: `neck:${row}`, row, spot: `head|${row}|0` }).gone, `row ${row}`);
  assert.ok(!armourWornAt(man, { ...at, piece: 'neck:0', row: 0, spot: 'head|0|0' }).gone, 'the row above stays');
  void wear;
});

// ---- Hung pieces swing ------------------------------------------------------------------------------------------------

/**
 * A stand-in for the few three.js classes a Dangle uses, for an anchor that only moves (no turn): enough to swing a piece
 * hung from a moving point.
 */
class V3 {
  constructor(x = 0, y = 0, z = 0) { this.x = x; this.y = y; this.z = z; }
  set(x, y, z) { this.x = x; this.y = y; this.z = z; return this; }
  clone() { return new V3(this.x, this.y, this.z); }
  copy(v) { return this.set(v.x, v.y, v.z); }
  add(v) { return this.set(this.x + v.x, this.y + v.y, this.z + v.z); }
  sub(v) { return this.set(this.x - v.x, this.y - v.y, this.z - v.z); }
  subVectors(a, b) { return this.set(a.x - b.x, a.y - b.y, a.z - b.z); }
  addScaledVector(v, s) { return this.set(this.x + v.x * s, this.y + v.y * s, this.z + v.z * s); }
  multiplyScalar(s) { return this.set(this.x * s, this.y * s, this.z * s); }
  divideScalar(s) { return this.multiplyScalar(1 / s); }
  length() { return Math.hypot(this.x, this.y, this.z); }
  lengthSq() { return this.x * this.x + this.y * this.y + this.z * this.z; }
  normalize() { return this.divideScalar(this.length() || 1); }
  dot(v) { return this.x * v.x + this.y * v.y + this.z * v.z; }
  distanceTo(v) { return Math.hypot(this.x - v.x, this.y - v.y, this.z - v.z); }
  lerp(v, t) { return this.set(this.x + (v.x - this.x) * t, this.y + (v.y - this.y) * t, this.z + (v.z - this.z) * t); }
  applyMatrix3() { return this; }
  applyMatrix4(m) { return this.add(m.at); }
  applyQuaternion() { return this; }
}
class M4 {
  constructor() { this.at = new V3(); }
  copy(m) { this.at = m.at.clone(); return this; }
  invert() { this.at.multiplyScalar(-1); return this; }
  getMaxScaleOnAxis() { return 1; }
}
const STAND_IN = {
  Vector3: V3,
  Matrix3: class { setFromMatrix4() { return this; } },
  Matrix4: M4,
  Quaternion: class { setFromUnitVectors(from, to) { this.to = to.clone(); return this; } },
  Group: class {
    constructor() { this.position = new V3(); this.quaternion = new STAND_IN.Quaternion(); this.children = []; }
    add(child) { this.children.push(child); }
    updateMatrix() {}
  },
};

/** A Dangle hung from an anchor carried along x as `pace(t)` says (m/s): the most its piece swings off plumb (deg) after `from` s. */
async function swingOf(options, pace, seconds = 4, from = 0) {
  const kept = globalThis.THREE;
  globalThis.THREE = STAND_IN;
  try {
    const { Dangle } = await import('../src/dangle.js');
    const anchor = { matrixWorld: new M4(), updateWorldMatrix() {}, add() {} };
    const dangle = new Dangle(anchor, [0, 1.4, 0], [0, -1, 0], 0.36, options);
    const dt = 1 / 60;
    let most = 0;
    for (let t = 0; t < seconds; t += dt) {
      anchor.matrixWorld.at.x += pace(t) * dt;
      dangle.update(dt);
      const { pivot } = dangle.placeInWorld();
      const hang = dangle.tip.clone().sub(pivot).normalize();
      if (t >= from) most = Math.max(most, (Math.acos(Math.max(-1, Math.min(1, -hang.y))) * 180) / Math.PI);
    }
    return most;
  } finally {
    globalThis.THREE = kept;
  }
}

test('a hung sode swings with the body: set off at a run it trails, stopped it swings on past, far more than the spring it had', async () => {
  // Off from standing to a run (5 m/s in 0.4 s), running 1.6 s, then pulled up in 0.4 s.
  const run = (t) => (t < 0.4 ? 12.5 * t : t < 2 ? 5 : t < 2.4 ? 5 - 12.5 * (t - 2) : 0);
  const hung = await swingOf({ hung: { mass: 1.3, area: 0.108, hold: 'cords' } }, run);
  const old = await swingOf({ sag: 0.14, damping: 0.5 }, run);
  assert.ok(hung > 1.6 * old, `hung ${hung.toFixed(1)}° vs the old spring's ${old.toFixed(1)}°`);
  assert.ok(hung > 20 && hung < 80, `${hung.toFixed(1)}°`);
  // Stopped, it swings on for a while after (the cords and the air damp it little): still swinging a second after the stop.
  const after = await swingOf({ hung: { mass: 1.3, area: 0.108, hold: 'cords' } }, run, 4, 3.4);
  assert.ok(after > 3, `${after.toFixed(1)}° a second after the stop`);
  // A plate on a rivet hardly moves; on a strap, between.
  const rivet = await swingOf({ hung: { mass: 1.3, area: 0.108, hold: 'rivet' } }, run);
  const strap = await swingOf({ hung: { mass: 1.3, area: 0.108, hold: 'strap' } }, run);
  assert.ok(rivet < strap && strap < hung, `rivet ${rivet.toFixed(1)}°, strap ${strap.toFixed(1)}°, cords ${hung.toFixed(1)}°`);
});
