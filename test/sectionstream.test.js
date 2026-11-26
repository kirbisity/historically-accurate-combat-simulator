// The section stream (levelmode/sectionstream.js): what is built from where the player is, built ahead of a gate, held a while after he
// leaves, built a few steps a frame; the ledger that frees what only a section held; and the face registry's replay (depthrange.js), which
// gives a section built again the lifts it had the first time.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createResourceLedger, createSectionStream, sectionsNear, SECTION_STREAM } from '../src/levelmode/sectionstream.js';
import { FaceRegistry } from '../src/depthrange.js';

// Three rooms in a row along x, each 20 m long, gates at x = 20 and x = 40 (a box 2 m deep), and a cellar under the middle one.
const box = (x0, x1, z0 = -5, z1 = 5) => ({ x0, x1, y0: -10, y1: 30, z0, z1 });
function rowGraph() {
  const links = [
    { a: 'a', b: 'b', boxes: [box(19, 21)] },
    { a: 'b', b: 'c', boxes: [box(39, 41)] },
    { a: 'b', b: 'cellar', boxes: [box(29, 31, 4, 6)] },
  ];
  const near = { a: [], b: [], c: [], cellar: [] };
  for (const link of links) {
    near[link.a].push(link);
    near[link.b].push(link);
  }
  return { ids: ['a', 'b', 'c', 'cellar'], bounds: { a: [box(0, 20)], b: [box(20, 40)], c: [box(40, 60)], cellar: [box(20, 40)] }, links, near, activeOnly: new Set() };
}

/** A stream whose builds take `steps` steps each (a yield between two), on a clock the test moves a tick a step. */
function streamOf(config = {}, steps = 3) {
  const log = [];
  let clock = 0;
  const stream = createSectionStream({
    graph: rowGraph(),
    *build(id) {
      for (let k = 1; k < steps; k += 1) {
        clock += 1;
        yield;
      }
      clock += 1;
      log.push(`built ${id}`);
      return { id };
    },
    free(id, made) {
      assert.equal(made.id, id);
      log.push(`freed ${id}`);
    },
    config,
    now: () => clock,
  });
  return { stream, log };
}

test('the sections near: beyond each link within reach, two links deep at most', () => {
  const graph = rowGraph();
  assert.deepEqual([...sectionsNear(graph, ['a'], [5, 0, 0], 18).keys()].sort(), ['a', 'b']);
  assert.deepEqual([...sectionsNear(graph, ['a'], [0, 0, 0], 18).keys()].sort(), ['a']);
  // At the far gate of b: c and the cellar's stair are both in reach.
  assert.deepEqual([...sectionsNear(graph, ['b'], [35, 0, 0], 8).keys()].sort(), ['b', 'c', 'cellar']);
  // From a, the rooms beyond b are wanted once their gates are in reach too (b is a passage); one link deep only, they are not.
  assert.deepEqual([...sectionsNear(graph, ['a'], [18, 0, 0], 25).keys()].sort(), ['a', 'b', 'c', 'cellar']);
  assert.deepEqual([...sectionsNear(graph, ['a'], [18, 0, 0], 25, 1).keys()].sort(), ['a', 'b']);
  assert.deepEqual([...sectionsNear(graph, ['a'], [18, 0, 0], 25)].find(([id]) => id === 'c')[1], 21);
});

test('a portal always: the section beyond wanted from anywhere in its own, however far, and only from there; one closer, from nearer', () => {
  const graph = rowGraph();
  graph.links[0].always = true;
  assert.ok(sectionsNear(graph, ['a'], [-200, 0, 0], 18, 1).has('b'));
  assert.ok(!sectionsNear(graph, ['b'], [40, 0, 0], 18, 1).has('a'));
  assert.ok(!sectionsNear(rowGraph(), ['a'], [-200, 0, 0], 18, 1).has('b'));
  // (One `closer`: the section beyond only from that much nearer.)
  graph.links[1].closer = 10;
  assert.ok(!sectionsNear(graph, ['b'], [30, 0, 0], 18, 1).has('c'));
  assert.ok(sectionsNear(graph, ['b'], [32, 0, 0], 18, 1).has('c'));
});

test('the next room is built while he walks up to its gate, within the budget a frame', () => {
  const { stream, log } = streamOf({ lead: 18, budgetMs: 1, urgentMs: 1 }, 3);
  stream.update(0.016, { position: [0, 0, 0], active: ['a'] });
  assert.deepEqual(stream.stats().building, ['a']);
  // One step a frame (each step is a tick of the clock, the budget one tick).
  for (let k = 0; k < 3; k += 1) stream.pump();
  assert.ok(stream.built('a'));
  assert.ok(!stream.built('b'));
  // 15 m from the gate: b is started, and done before he is there.
  stream.update(0.016, { position: [5, 0, 0], active: ['a'] });
  assert.deepEqual(stream.stats().building, ['b']);
  for (let k = 0; k < 3; k += 1) stream.pump();
  assert.ok(stream.built('b'));
  assert.deepEqual(log, ['built a', 'built b']);
});

test('a gate he is nearly at gets more of the frame', () => {
  const { stream } = streamOf({ lead: 18, budgetMs: 1, urgentMs: 3, urgent: 6 }, 10);
  stream.update(0.016, { position: [6, 0, 0], active: ['a'] });
  stream.pump();
  // (a, where he stands, is urgent: three ticks.)
  assert.equal(stream.stats().steps, 3);
});

test('what he stands in is built before what is ahead of him', () => {
  const { stream } = streamOf({ lead: 18, budgetMs: 1, urgentMs: 1 }, 3);
  stream.update(0.016, { position: [19, 0, 0], active: ['a'] });
  stream.update(0.016, { position: [21, 0, 0], active: ['b'] });
  stream.pump();
  stream.pump();
  stream.pump();
  assert.ok(stream.built('b'));
  assert.ok(!stream.built('a'));
});

test('a room left is held while he is near its gate and for a while after; walking back and forth at the gate builds nothing again', () => {
  const { stream, log } = streamOf({ lead: 18, keep: 30, linger: 5, budgetMs: 100 }, 1);
  stream.update(0.016, { position: [18, 0, 0], active: ['a'] });
  stream.pump();
  assert.ok(stream.built('a') && stream.built('b'));
  for (let k = 0; k < 600; k += 1) {
    const x = 18 + 4 * Math.sin(k / 30);
    stream.update(1 / 60, { position: [x, 0, 0], active: [x < 20 ? 'a' : 'b'] });
    stream.pump();
  }
  assert.equal(log.filter((line) => line.startsWith('freed')).length, 0);
  assert.equal(log.filter((line) => line === 'built a').length, 1);
  // Away down b and past c's gate: a's link is past `keep`, and after `linger` s it goes; nothing else does while it is near.
  for (let k = 0; k < 60 * 4; k += 1) stream.update(1 / 60, { position: [55, 0, 0], active: ['c'] });
  assert.ok(stream.built('a'));
  for (let k = 0; k < 60 * 2; k += 1) stream.update(1 / 60, { position: [55, 0, 0], active: ['c'] });
  assert.ok(!stream.built('a'));
  assert.ok(stream.built('b'));
});

test('a build no longer wanted is set aside, taken up again if wanted again, and given up after the linger', () => {
  const { stream } = streamOf({ lead: 10, keep: 30, linger: 1, budgetMs: 1, urgentMs: 1, hops: 1 }, 10);
  stream.update(0.016, { position: [18, 0, 0], active: ['a'] });
  for (let k = 0; k < 12; k += 1) stream.pump();
  assert.ok(stream.built('a') && stream.stats().building.includes('b'));
  // He turns back: b is no longer wanted, and nothing more of it is built.
  stream.update(0.016, { position: [2, 0, 0], active: ['a'] });
  const before = stream.stats().steps;
  for (let k = 0; k < 20; k += 1) stream.pump();
  assert.equal(stream.stats().steps, before);
  // Back at the gate within the linger: it goes on where it was.
  stream.update(0.5, { position: [18, 0, 0], active: ['a'] });
  for (let k = 0; k < 20; k += 1) stream.pump();
  assert.ok(stream.built('b'));
  // Begun and left for longer than the linger: given up, never finished.
  stream.update(0.016, { position: [38, 0, 0], active: ['b'] });
  stream.pump();
  assert.ok(stream.stats().building.includes('c'));
  for (let k = 0; k < 90; k += 1) stream.update(1 / 60, { position: [21, 0, 0], active: ['b'] });
  assert.ok(!stream.stats().building.includes('c') && !stream.built('c'));
  assert.equal(stream.stats().abandoned, 1);
});

test('what the picture asks for is built, and a pin holds a room whatever else', () => {
  const { stream } = streamOf({ lead: 5, keep: 8, linger: 1, budgetMs: 100 }, 1);
  stream.update(0.016, { position: [2, 0, 0], active: ['a'], seen: ['c'] });
  stream.pump();
  assert.ok(stream.built('c'));
  stream.pin('cellar');
  stream.update(0.016, { position: [2, 0, 0], active: ['a'] });
  stream.pump();
  assert.ok(stream.built('cellar'));
  for (let k = 0; k < 200; k += 1) stream.update(1 / 60, { position: [2, 0, 0], active: ['a'] });
  assert.ok(stream.built('cellar'));
  assert.ok(!stream.built('c'));
});

test('a jump: the room he is put in is built at once as steps, for the loading screen', () => {
  const { stream } = streamOf({}, 4);
  assert.deepEqual(stream.missing(['c']), ['c']);
  let steps = 0;
  for (const _ of stream.ensureSteps(['c'])) steps += 1;
  assert.equal(steps, 3);
  assert.deepEqual(stream.missing(['c']), []);
});

test('the defaults: the lead is a walk of some seconds, the hold larger than the lead', () => {
  assert.ok(SECTION_STREAM.lead >= 15 && SECTION_STREAM.lead <= 20);
  assert.ok(SECTION_STREAM.keep > SECTION_STREAM.lead);
  assert.ok(SECTION_STREAM.budgetMs <= 4);
  assert.ok(SECTION_STREAM.urgentMs < 16.7);
});

test('the ledger frees what only one holder held, never what another or the place holds, and keeps a material asked to be kept', () => {
  const disposed = [];
  const thing = (name, extra = {}) => ({ name, dispose: () => disposed.push(name), ...extra });
  const stone = thing('stone map', { isTexture: true });
  const kit = thing('kit stone', { isMaterial: true, map: stone });
  const glass = thing('glass map', { isTexture: true });
  const program = thing('flame', { isMaterial: true, map: glass });
  const own = thing('own', { isMaterial: true });
  const meshes = (...list) => ({ traverse: (visit) => list.forEach(visit) });
  const shared = thing('card');
  const ledger = createResourceLedger({ keep: (material) => material === program });
  ledger.hold('place', meshes({ material: kit }), { forever: true });
  ledger.hold('hall', meshes({ geometry: thing('hall walls'), material: kit }, { geometry: shared, material: program }, { geometry: thing('hall props'), material: own }));
  ledger.hold('yard', meshes({ geometry: shared, material: kit }));
  ledger.drop('hall');
  assert.deepEqual(disposed.sort(), ['glass map', 'hall props', 'hall walls', 'own']);
  ledger.drop('yard');
  assert.deepEqual(disposed.sort(), ['card', 'glass map', 'hall props', 'hall walls', 'own']);
  assert.equal(ledger.counts.kept, 1);
});

test('a face registry replayed gives a piece built again the lift it had, and places nothing', () => {
  const registry = new FaceRegistry();
  registry.add(1, 1, 2.0, [0, 4, 0, 4]);
  const second = registry.next;
  registry.add(1, 1, 2.0003, [1, 5, 1, 5]);
  registry.add(1, 1, 2.0006, [2, 6, 2, 6]);
  // As it stood before the second face: only the first is seen.
  const replay = registry.replay(second);
  assert.deepEqual(replay.near(1, 1, 2.0, [1, 5, 1, 5]), [2.0]);
  replay.add(1, 1, 2.0003, [1, 5, 1, 5]);
  assert.deepEqual(replay.near(1, 1, 2.0, [2, 6, 2, 6]).sort(), [2.0, 2.0003]);
  assert.equal(registry.next, 3);
  // The registry itself sees all three.
  assert.equal(registry.near(1, 1, 2.0, [2, 3, 2, 3]).length, 3);
});
