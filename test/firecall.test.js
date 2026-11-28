// The word to fire (audio/firecall.js): the commander's tongue by his faction, English where none is recorded, and called only as a
// side holding its fire is let go, once however fast the order is toggled.
import test from 'node:test';
import assert from 'node:assert/strict';
import { P, PRESETS } from '../src/body.js';
import { createWorld } from '../src/physics.js';
import { giveFireOrder, clearOrders } from '../src/command.js';
import { FIRE_CALL, createFireCallWatcher, fireCallCommander, fireCallDin, fireCallDinAdd, fireCallDinEase, fireCallLanguage, fireCallMasked, fireCallRank, fireCallRate, fireCallStanding, fireCallTongue } from '../src/audio/firecall.js';
import { seededRandom } from '../src/physics.js';
import { legionSides, SCENARIOS } from '../src/scenarios.js';
import { thinkAll } from '../src/ai.js';
import { advance } from '../src/physics.js';
import { SAMPLE_SETS } from '../src/audio/samples.js';

const man = (inputs) => ({ body: { inputs } });

test('a commander shouts in his faction\'s tongue: Chinese, Japanese, else English', () => {
  assert.equal(fireCallLanguage(man(PRESETS.mingMatchlock)), 'zh');
  assert.equal(fireCallLanguage(man({ outfit: { kind: 'bannerArmour' } })), 'zh');
  assert.equal(fireCallLanguage(man({ outfit: { kind: 'greenStandard' } })), 'zh');
  assert.equal(fireCallLanguage(man(PRESETS.samurai)), 'ja');
  assert.equal(fireCallLanguage(man({ outfit: { kind: 'ashigaru' } })), 'ja');
  assert.equal(fireCallLanguage(man({ outfit: { kind: 'yakuza' } })), 'ja');
  assert.equal(fireCallLanguage(man(PRESETS.lineInfantry)), 'en');
  assert.equal(fireCallLanguage(man(PRESETS.knight)), 'en');
  assert.equal(fireCallLanguage(man({ outfit: { kind: 'business' } })), 'en');
  // Every language with a call has its set of takes.
  for (const [language, takes] of Object.entries(FIRE_CALL.voices)) assert.deepEqual(SAMPLE_SETS[`firecall-${language}`], takes);
});

test('a tongue with no call recorded falls back to English', () => {
  const samurai = man(PRESETS.samurai);
  assert.equal(fireCallTongue(samurai), 'ja');
  assert.equal(fireCallLanguage(samurai, { zh: ['firecall-zh-1'], en: ['firecall-en-1'] }), 'en');
  assert.equal(fireCallLanguage(samurai, { ja: [], en: ['firecall-en-1'] }), 'en');
  assert.equal(fireCallLanguage(man({})), 'en');
});

test('the call: only from hold to fire, from the man who gave it, not again within the cooldown', () => {
  const world = createWorld([{ inputs: structuredClone(PRESETS.samurai), corner: 'red' }, { inputs: structuredClone(PRESETS.mingMatchlock), corner: 'red' }, { inputs: structuredClone(PRESETS.lineInfantry), corner: 'blue' }], { seed: 2 });
  const [samurai, , redcoat] = world.fighters;
  const watcher = createFireCallWatcher();
  let now = 0;
  const tick = () => watcher.tick(world, (now += 0.1));
  assert.deepEqual(tick(), []);
  giveFireOrder(world, samurai, true);
  assert.deepEqual(tick(), [], 'holding is not called');
  giveFireOrder(world, samurai, false);
  const [call, more] = tick();
  assert.equal(more, undefined);
  assert.equal(call.by, samurai);
  assert.equal(call.set, 'firecall-ja');
  assert.deepEqual(call.at, [samurai.x[P.head * 3], samurai.x[P.head * 3 + 1], samurai.x[P.head * 3 + 2]], 'from his head');
  // Toggled again at once: no second call over the first.
  giveFireOrder(world, samurai, true);
  tick();
  giveFireOrder(world, samurai, false);
  assert.deepEqual(tick(), []);
  // Past the cooldown: called again. The other side's own call is its own (English).
  now += FIRE_CALL.cooldown;
  giveFireOrder(world, samurai, true);
  giveFireOrder(world, redcoat, true);
  tick();
  giveFireOrder(world, samurai, false);
  giveFireOrder(world, redcoat, false);
  assert.deepEqual(tick().map((each) => each.set).sort(), ['firecall-en', 'firecall-ja']);
  // Orders all taken back (leaving play) are no order to fire.
  now += FIRE_CALL.cooldown;
  giveFireOrder(world, samurai, true);
  tick();
  clearOrders(world);
  assert.deepEqual(tick(), []);
});

test('no two calls alike: each man his own pitch, the same each time, each call a little off it, all within the range', () => {
  const world = createWorld(Array.from({ length: 6 }, () => ({ inputs: structuredClone(PRESETS.samurai), corner: 'red' })), { seed: 3 });
  const semitones = (rate) => 12 * Math.log2(rate);
  const own = world.fighters.map((fighter) => fireCallRate(fighter, 0.5));
  assert.ok(new Set(own.map((rate) => rate.toFixed(3))).size === own.length, 'six men, six voices');
  assert.equal(fireCallRate(world.fighters[2], 0.5), own[2], 'his own pitch the same every time');
  const low = fireCallRate(world.fighters[2], 0);
  const high = fireCallRate(world.fighters[2], 1);
  assert.ok(Math.abs(semitones(high) - semitones(low) - 2 * FIRE_CALL.pitch.utterance) < 1e-9, 'each call wobbles about his pitch');
  for (const rate of [...own, low, high]) assert.ok(Math.abs(semitones(rate)) <= FIRE_CALL.pitch.range + 1e-9);
  for (const takes of Object.values(FIRE_CALL.voices)) assert.equal(takes.length, 3);
});

test('a woman commanding: her language\'s raised take, a little quieter; the man\'s take where she has none', () => {
  const world = createWorld([{ inputs: { ...structuredClone(PRESETS.samurai), sex: 'female' }, corner: 'red' }, { inputs: structuredClone(PRESETS.lineInfantry), corner: 'blue' }], { seed: 5 });
  const [woman, man] = world.fighters;
  const watcher = createFireCallWatcher();
  watcher.tick(world, 0);
  giveFireOrder(world, woman, true);
  giveFireOrder(world, man, true);
  watcher.tick(world, 0.1);
  giveFireOrder(world, woman, false);
  giveFireOrder(world, man, false);
  const calls = Object.fromEntries(watcher.tick(world, 0.2).map((call) => [call.corner, call]));
  assert.equal(calls.red.set, 'firecall-ja-f');
  assert.equal(calls.red.db, FIRE_CALL.female.db);
  assert.ok(FIRE_CALL.female.db < 0);
  assert.equal(calls.red.fallbacks[0], 'firecall-ja');
  assert.equal(calls.blue.set, 'firecall-en');
  assert.equal(calls.blue.db, 0);
  for (const [language, takes] of Object.entries(FIRE_CALL.female.voices)) assert.deepEqual(SAMPLE_SETS[`firecall-${language}-f`], takes);
});

test('the call\'s priority: its level at the ear and a bonus, more for his own side, most for his own commander; drowned under a far louder din', () => {
  const spec = FIRE_CALL.priority;
  assert.equal(fireCallRank(70), 70 + spec.call);
  assert.equal(fireCallRank(70, { ownSide: true }), 70 + spec.call + spec.ownSide);
  assert.equal(fireCallRank(70, { ownSide: true, ownCommander: true }), 70 + spec.call + spec.ownSide + spec.ownCommander);
  // A rank, not an override: a far enemy's call still loses to a sound far louder at the ear.
  assert.ok(fireCallRank(60) < 60 + spec.call + 1 && fireCallRank(60) < 100);
  // Masking by the din: a near call over a melee is heard; a far one under it lost, unless his own men are listening for it.
  assert.equal(fireCallMasked(92, 105), false);
  assert.equal(fireCallMasked(65, 105), true);
  assert.equal(fireCallMasked(65, 80), false);
  assert.equal(fireCallMasked(80, 105, { ownSide: false }), true);
  assert.equal(fireCallMasked(80, 105, { ownSide: true }), false);
  // His own word is never drowned to him.
  assert.equal(fireCallMasked(92, 140, { ownSide: true, ownVoice: true }), false);
  // A musket's crack (150 dB at 1 m, 124 at 20 m) counts a tenth of a second: a second later it no longer drowns a call from 15 m.
  let energy = fireCallDinAdd(0, 124);
  assert.ok(fireCallDin(energy) <= 124 + 1e-9);
  assert.equal(fireCallMasked(69, fireCallDin(energy)), true);
  energy = fireCallDinEase(energy, 1);
  assert.equal(fireCallMasked(69, fireCallDin(energy)), false);
  assert.equal(fireCallDin(0), -Infinity);
  const world = createWorld([{ inputs: structuredClone(PRESETS.samurai), corner: 'red' }, { inputs: structuredClone(PRESETS.mingMatchlock), corner: 'red' }, { inputs: structuredClone(PRESETS.lineInfantry), corner: 'blue' }], { seed: 2 });
  const [me, mate, foe] = world.fighters;
  assert.deepEqual(fireCallStanding(world, { corner: 'red', by: me }, me), { ownSide: true, ownCommander: true, ownVoice: true });
  assert.deepEqual(fireCallStanding(world, { corner: 'red', by: mate }, me), { ownSide: true, ownCommander: false, ownVoice: false });
  assert.deepEqual(fireCallStanding(world, { corner: 'blue', by: foe }, me), { ownSide: false, ownCommander: false, ownVoice: false });
  assert.deepEqual(fireCallStanding(world, { corner: 'blue', by: foe }, null), { ownSide: false, ownCommander: false, ownVoice: false });
});

test('an AI side\'s shot opening fire is called by its commander, once, not again while the fire is kept up; never the man played\'s own shot', () => {
  const world = createWorld([{ inputs: structuredClone(PRESETS.samurai), corner: 'red' }, ...Array.from({ length: 3 }, () => ({ inputs: structuredClone(PRESETS.mingMatchlock), corner: 'red' })), { inputs: structuredClone(PRESETS.lineInfantry), corner: 'blue' }], { seed: 4 });
  const [leader, gunner, , , foe] = world.fighters;
  world.formations = { red: { leader: leader.id } };
  assert.equal(fireCallCommander(world, 'red'), leader);
  assert.equal(fireCallCommander(world, 'blue'), null, 'no formation and no general: nobody to call');
  const watcher = createFireCallWatcher();
  const shoot = (fighter, kind = 'shot') => world.events.push({ time: world.time, kind, attacker: fighter.id });
  const tick = (seconds = 0.1) => {
    world.time += seconds;
    return watcher.tick(world, world.time);
  };
  shoot(gunner);
  tick();
  assert.deepEqual(tick(), [], 'a shot before the watcher first saw the world is not called');
  world.time += FIRE_CALL.ai.lull;
  shoot(gunner);
  const [call, more] = tick();
  assert.equal(more, undefined);
  assert.equal(call.why, 'opening');
  assert.equal(call.by, leader);
  assert.equal(call.set, 'firecall-ja');
  // Fire kept up (a shot every few seconds): no call.
  for (let second = 0; second < 30; second += 3) {
    world.time += 3;
    shoot(gunner, second % 2 ? 'loosed' : 'shot');
    assert.deepEqual(tick(), []);
  }
  // After a lull, the fire opened again: called again.
  world.time += FIRE_CALL.ai.lull;
  shoot(gunner);
  assert.equal(tick()[0]?.why, 'opening');
  // The man played's own shot opens nothing; nor does his side's shot just after his own fire order (that order was called).
  world.time += FIRE_CALL.ai.lull + FIRE_CALL.ai.cooldown;
  gunner.player = true;
  shoot(gunner);
  assert.deepEqual(tick(), []);
  gunner.player = false;
  giveFireOrder(world, foe, true);
  tick();
  giveFireOrder(world, foe, false);
  assert.equal(tick()[0]?.why, 'order');
  world.formations.blue = { leader: foe.id };
  shoot(foe);
  assert.deepEqual(tick(), [], 'the opening after an order is that order\'s');
});

test('in a battle (Rome against Han), each side\'s shot opening fire is called by its commander in its tongue, and the fire kept up is not', () => {
  const sides = legionSides(seededRandom(3), 12);
  const level = SCENARIOS.legion;
  const world = createWorld([...sides.red.map((inputs) => ({ inputs, corner: 'red' })), ...sides.blue.map((inputs) => ({ inputs, corner: 'blue' }))], { seed: 3, arena: level.arena, formation: level.formation });
  const watcher = createFireCallWatcher({ random: () => 0.5 });
  const calls = [];
  watcher.tick(world, world.time);
  for (let step = 0; step < 150; step += 1) {
    advance(world, 0.1, (current, dt) => thinkAll(current, dt, new Set()));
    calls.push(...watcher.tick(world, world.time));
  }
  const shots = world.events.filter((event) => event.kind === 'shot' || event.kind === 'loosed');
  assert.ok(shots.length > 3, `${shots.length} shots`);
  const opened = new Set(shots.map((event) => world.fighters[event.attacker].corner));
  for (const corner of opened) {
    const own = calls.filter((call) => call.corner === corner);
    assert.ok(own.length >= 1 && own.length <= 2, `${corner}: ${own.length} calls`);
    assert.ok(own.every((call) => call.why === 'opening' && call.by.corner === corner));
  }
  for (const call of calls) assert.equal(call.language, call.corner === 'blue' ? 'zh' : 'en');
});
