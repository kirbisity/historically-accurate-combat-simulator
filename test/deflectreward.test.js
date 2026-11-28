// The player's deflect rewards him: his weapon art charged at once (weaponarts.js ARTS.deflectCharges), and the moment slowed to a
// fifth (drama.js DRAMA.deflect) for him to make it. An AI man's deflect is neither. And every samurai wears the sakayaki.

import test from 'node:test';
import assert from 'node:assert/strict';
import { normaliseInputs, PRESETS } from '../src/body.js';
import { DRAMA, momentFor } from '../src/drama.js';
import { HITFEEL } from '../src/hitfeel.js';
import { createWorld } from '../src/physics.js';
import { ARTS, artPrimed, feelAdrenaline } from '../src/weaponarts.js';

test('a deflect of the player\'s charges his weapon art at once', () => {
  const world = createWorld([structuredClone(PRESETS.samurai), structuredClone(PRESETS.knight)], { seed: 1 });
  const [me, foe] = world.fighters;
  me.player = true;
  me.adrenaline = 0;
  me.artCharged = false;
  assert.equal(artPrimed(me), false);
  world.events.push({ time: world.time, kind: 'deflect', fighter: me.id, byPlayer: true, attacker: foe.id, effects: [] });
  feelAdrenaline(world, me, 1 / 60);
  assert.ok(artPrimed(me) && me.adrenaline >= ARTS.ready * 0.99);
});

test('the player\'s deflect is a moment in any fight, held a few frames and let go; an AI man\'s is not', () => {
  const mine = momentFor({ kind: 'deflect', byPlayer: true, fighter: 0, effects: [] });
  assert.equal(mine.kind, 'deflect');
  assert.ok(mine.always);
  // No slow-motion scene of its own (it was a fifth of the pace for over a second): its hold is the hit feel's, a tenth of a
  // second at most, and the fight is back at nearly full pace within a third of one. The big deflect and the execution after it
  // have none either (the tap and the blow it asks for close together: the user's call, 2026-11-28); the big deflect's hold is a
  // little longer than a deflect's.
  assert.equal(DRAMA.deflect.slowest, 1);
  const stop = HITFEEL.beats.deflect.stop;
  assert.ok(stop.slowest <= 0.05 && stop.seconds.heavy <= 0.12 && stop.seconds.heavy + stop.ease + stop.dilate.seconds <= 0.45);
  assert.equal(DRAMA.bigDeflect.slowest, 1);
  assert.equal(DRAMA.execution.slowest, 1);
  assert.ok(HITFEEL.beats.bigDeflect.stop.seconds.heavy > stop.seconds.heavy);
  assert.equal(momentFor({ kind: 'deflect', byPlayer: false, fighter: 1, effects: [] }), null);
});

test('every samurai wears the sakayaki; a woman in the armour (an onna-musha) and other men keep their own hair', () => {
  for (const kind of ['samurai', 'samuraiTosei', 'oyoroi']) {
    assert.equal(normaliseInputs({ ...PRESETS.contender, sex: 'male', outfit: { kind, design: 0 } }).look.hairStyle, 'sakayaki', kind);
    assert.notEqual(normaliseInputs({ ...PRESETS.contender, sex: 'female', outfit: { kind, design: 0 } }).look.hairStyle, 'sakayaki', `${kind}: a woman`);
  }
  assert.equal(normaliseInputs(PRESETS.kanabo).look.hairStyle, 'sakayaki');
  assert.notEqual(normaliseInputs(PRESETS.knight).look.hairStyle, 'sakayaki');
});
