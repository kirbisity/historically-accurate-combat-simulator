import { test } from 'node:test';
import assert from 'node:assert/strict';
import { advance, createWorld } from '../src/physics.js';
import { AI, halfGuardFor, halfSwordPays, harmThrough, thinkAll } from '../src/ai.js';
import { MOVES } from '../src/moves.js';
import { WARRIORS } from '../src/roster.js';
import { markGap } from '../src/physics/gaps.js';

const byKey = new Map(WARRIORS.map((warrior) => [warrior.key, warrior.inputs]));
const pair = (other, seed = 1) => {
  const world = createWorld([{ inputs: structuredClone(byKey.get('plate')), corner: 'red' }, { inputs: structuredClone(byKey.get(other)), corner: 'blue' }], { seed });
  advance(world, 0.2);
  return world;
};

test('the low half-sword guard: its thrust rises to the throat, the armpit, the groin and the inside of the thigh, gaps of a knight\'s kit', () => {
  const [, knight] = pair('plate').fighters;
  assert.deepEqual(MOVES.halfSwordLow.zones, ['throat', 'armpit', 'groin', 'thigh']);
  assert.equal(markGap(knight.body.gear, 'groin'), 'groin');
  assert.equal(markGap(knight.body.gear, 'thigh'), 'groin', 'high on the inside of the thigh, where the cuisse leaves it');
  assert.ok(!MOVES.halfSwordLow.zones.includes('sights'), 'no sights from below');
});

test('the guard is the one whose gap is open: high against a closed helm with its sights clear, low when the high lines are covered', () => {
  const [a, plate] = pair('plate').fighters;
  assert.equal(halfGuardFor(a, plate, a.weapon.spec.halfSword), 'high');
  // (The samurai's guard, up before his face at this moment, lies across the lines to his sights and throat from above.)
  const [b, tosei] = pair('tosei').fighters;
  assert.equal(halfGuardFor(b, tosei, b.weapon.spec.halfSword), 'low');
  // (Kept unless the other is the clearly better, AI.halfSword.guard keep.)
  assert.equal(halfGuardFor(b, tosei, b.weapon.spec.halfSword, 'low'), 'low');
});

test('the murder-stroke weighs as a blunt blow through the helm: more than a point at a closed helm\'s throat, nothing gained on a bare man', () => {
  const [a, knight] = pair('plate').fighters;
  const mord = harmThrough(a, knight, MOVES.mordschlag, 'head');
  const throat = harmThrough(a, knight, MOVES.halfSword, 'throat');
  assert.ok(mord > throat, `the hilt ${mord.toFixed(2)} against the point at the throat ${throat.toFixed(2)}`);
  assert.ok(halfSwordPays(a, knight));
  const [c, saint] = pair('swordSaint').fighters;
  assert.ok(!halfSwordPays(c, saint), 'his face and body bare: the long sword fights on with the edge and the long point');
});

test('a clash of two strokes is a bind only for the man who met it nearer his hands, the strong of his blade on the other\'s weak', () => {
  const world = pair('plate');
  const [a, b] = world.fighters;
  // (Each man's blade met `along` m out from his hands: a near his hilt, b near his point.)
  world.events.push({ time: world.time, kind: 'clash', fighter: a.id, other: b.id, struck: true, along: [0.3, 0.75], effects: ['blades meet'] });
  thinkAll(world, 0.02);
  assert.equal(a.aiBind?.clash, true, 'the man with the strong of it has a bind to weigh');
  assert.equal(a.aiBind.man, b.id);
  assert.ok(!b.aiBind, 'the man on the weak of it has none');
  // Met alike, neither has the strong of it.
  const even = pair('plate', 2);
  even.events.push({ time: even.time, kind: 'clash', fighter: 0, other: 1, struck: true, along: [0.5, 0.5 * AI.halfSword.clash.strong * 0.9], effects: ['blades meet'] });
  thinkAll(even, 0.02);
  assert.ok(!even.fighters[0].aiBind && !even.fighters[1].aiBind);
});
