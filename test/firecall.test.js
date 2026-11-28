// The word to fire (audio/firecall.js): the commander's tongue by his faction, English where none is recorded, and called only as a
// side holding its fire is let go, once however fast the order is toggled.
import test from 'node:test';
import assert from 'node:assert/strict';
import { P, PRESETS } from '../src/body.js';
import { createWorld } from '../src/physics.js';
import { giveFireOrder, clearOrders } from '../src/command.js';
import { FIRE_CALL, createFireCallWatcher, fireCallLanguage, fireCallRate, fireCallTongue } from '../src/audio/firecall.js';
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
