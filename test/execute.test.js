// The execution after a big deflect (finisher.js startExecution, control.js askExecution): one attack asked for in the man's
// window, by any way the player asks (a tap, a key, a press held, the special button), is carried out at once, with whatever
// weapon is in his hands, and nothing about the player turns it down that his body can put aside (his own stroke under way,
// another enemy near, the man thrown a few steps off). Whether it kills is the blow's: a point finds the gaps of plate, a
// mace on a helm does what a mace on a helm does.

import test from 'node:test';
import assert from 'node:assert/strict';
import { PRESETS } from '../src/body.js';
import { thinkAll } from '../src/ai.js';
import { advance, createWorld, placeFighter, reachOf, throwPunch, WORLD } from '../src/physics.js';
import { breakOpen } from '../src/physics/deflect.js';
import { attackLayout, directFighter, newOrders, swingAt } from '../src/control.js';
import { executionBlow } from '../src/finisher.js';
import { readSounds } from '../src/audio/log.js';

// The weapon classes, by a style of each; the foes, by armour.
const CLASSES = { dagger: 'dagger', sword: 'longsword', polearm: 'halberd', blunt: 'mace', unarmed: 'boxing' };
const FOES = { none: { preset: 'contender', style: 'katana' }, plate: { preset: 'knight' }, mail: { preset: 'templar' }, lamellar: { preset: 'samurai' } };

/** The player (`style`) and a foe, the foe broken open by a big deflect as physics.js throwDownOpen leaves him; `extra` men too. */
function opened(style, foeKey, { seed = 1, apart = 1.1, crowd = false } = {}) {
  const foe = FOES[foeKey];
  const entries = [{ inputs: { ...structuredClone(PRESETS.contender), style }, corner: 'red' }, { inputs: { ...structuredClone(PRESETS[foe.preset]), ...(foe.style ? { style: foe.style } : {}) }, corner: 'blue' }];
  if (crowd) entries.push({ inputs: structuredClone(PRESETS.street), corner: 'blue' });
  const world = createWorld(entries, { seed });
  world.armed = true;
  const [me, him] = world.fighters;
  me.player = true;
  placeFighter(me, -apart / 2, 0);
  placeFighter(him, apart / 2, 0);
  if (crowd) placeFighter(world.fighters[2], -apart / 2 + 0.4, 1.8);
  const orders = newOrders();
  // (Nobody but the man broken open thinks for himself, and he thinks nothing while he is open: ai.js.)
  const idle = new Set(world.fighters.filter((man) => man !== him).map((man) => man.id));
  const still = new Set(world.fighters.map((man) => man.id));
  const step = (seconds) => advance(world, seconds, (w, dt) => {
    thinkAll(w, dt, idle);
    directFighter(w, me, orders, dt);
  }, 1 / 120);
  advance(world, 0.4, (w, dt) => thinkAll(w, dt, still), 1 / 120);
  const event = { effects: [] };
  breakOpen(world, him, event);
  him.executableUntil = world.time + WORLD.deflect.big.open;
  return { world, me, him, orders, step };
}

/** One attack asked for, as `how` asks it: the attack pad's tap ('tap'), a key ('key'), a press held ('hold'), the special button ('button'). */
function press(world, me, him, orders, how = 'tap') {
  const move = attackLayout(me.style)[0]?.move;
  if (how === 'tap') orders.requests.push({ move, zone: 'head', strength: 'quick', at: world.time });
  else if (how === 'key') swingAt(world, me, orders, move, 'head');
  else if (how === 'hold') (orders.holds ??= []).push([him.root[0], 1, him.root[1]]);
  else orders.actions = ['finish'];
}

/** The execution after one press: when it began (s after the press, or null), whether a blow of it reached his head or body, and his state. */
function oneExecution(world, me, him, orders, step, how = 'tap', seconds = 3) {
  const from = world.events.length;
  const t0 = world.time;
  press(world, me, him, orders, how);
  let began = null;
  let thrown = false;
  for (let t = 0; t < seconds; t += 1 / 60) {
    step(1 / 60);
    if (began === null && me.finisher?.execution) began = world.time - t0;
    if (me.finisher?.execution && me.finisher.thrustAt !== null) thrown = true;
  }
  const events = world.events.slice(from);
  const blows = events.filter((event) => event.attacker === me.id && event.defender === him.id && ['landed', 'blocked', 'bladeBlock', 'glance'].includes(event.kind));
  const home = blows.some((event) => event.kind === 'landed' && (event.target === 'head' || event.target === 'trunk'));
  const gap = blows.some((event) => event.effects?.some((effect) => /gap/.test(effect)));
  return { began, carried: events.some((event) => event.kind === 'execution' && event.attacker === me.id), thrown, struck: blows.length > 0, home, gap, killed: him.state === 'out', felled: him.state !== 'up', aborted: events.find((event) => event.kind === 'finisherAborted')?.effects };
}

test('after a big deflect one press executes, at once, with every weapon class against every armour', () => {
  const outcome = {};
  for (const [kind, style] of Object.entries(CLASSES)) {
    for (const foe of Object.keys(FOES)) {
      for (const seed of [1, 2, 3, 4]) {
        const { world, me, him, orders, step } = opened(style, foe, { seed });
        const run = oneExecution(world, me, him, orders, step);
        assert.ok(run.carried && run.began !== null && run.began <= 0.05, `${kind} v ${foe} (seed ${seed}): begun ${run.began} s after the one press`);
        // (Delivered: what it meets, and whether the man he executes cuts him as he comes on, is the fight's.)
        assert.ok(run.thrown, `${kind} v ${foe} (seed ${seed}): the blow delivered (${run.aborted ?? ''})`);
        (outcome[`${kind} ${foe}`] ??= []).push(run);
      }
    }
  }
  // Whether it gets through is the blow's: a dagger's point and a sword's find the gaps of plate (its sights), a mace's head
  // has no point to put there.
  const through = (key) => outcome[key].filter((run) => run.gap || run.killed).length;
  assert.ok(through('dagger plate') >= 1, `dagger v plate: through ${through('dagger plate')} of 4`);
  assert.ok(through('sword plate') >= 1, `sword v plate: through ${through('sword plate')} of 4`);
  assert.equal(outcome['blunt plate'].filter((run) => run.gap || run.killed).length, 0, 'a mace finds no gap in plate');
  assert.ok(outcome['blunt none'].every((run) => run.felled), 'a mace\'s level blow fells a bare man');
});

test('the execution is the weapon\'s own blow: a point at the face or a helm\'s sights, an edge with no point level at the throat, a mace at the head, the fists', () => {
  const blow = (style, foe) => {
    const { me, him } = opened(style, foe);
    return executionBlow(me, him);
  };
  for (const [style, foe] of [['dagger', 'plate'], ['longsword', 'plate'], ['katana', 'none'], ['spear', 'lamellar'], ['halberd', 'plate']]) {
    const point = blow(style, foe);
    assert.ok(point.mode === 'thrust' && point.entry.region === 'face' && !point.draw, `${style} v ${foe}: ${point.move} at the ${point.entry.region}`);
  }
  const edge = blow('macuahuitl', 'none');
  assert.ok(edge.mode === 'swing' && edge.entry.region === 'throat', `macuahuitl v a bare man: ${edge.move} at the ${edge.entry.region}`);
  const mace = blow('mace', 'plate');
  assert.ok(mace.mode === 'swing' && mace.move === 'maceSide' && !mace.draw, `mace v plate: ${mace.move} (the level blow)`);
  const fists = blow('boxing', 'none');
  assert.ok(!fists.draw && fists.move, `fists: ${fists.move}`);
});

test('one press executes whatever else is going on: a key, a press held, the special button; his own stroke under way; another enemy near; the man three metres off', () => {
  for (const how of ['key', 'hold', 'button']) {
    const { world, me, him, orders, step } = opened('katana', 'plate');
    const run = oneExecution(world, me, him, orders, step, how);
    assert.ok(run.began !== null && run.began <= 0.05, `${how}: begun ${run.began}`);
  }
  {
    const { world, me, him, orders, step } = opened('katana', 'plate');
    assert.ok(throwPunch(world, me, attackLayout(me.style)[0].move, 'head'), 'his own stroke under way');
    step(0.05);
    const run = oneExecution(world, me, him, orders, step);
    assert.ok(run.began !== null && run.began <= 0.05 && run.thrown, `with his stroke under way: begun ${run.began}`);
  }
  {
    const { world, me, him, orders, step } = opened('longsword', 'mail', { crowd: true });
    const run = oneExecution(world, me, him, orders, step);
    assert.ok(run.began !== null && run.began <= 0.05 && run.thrown, `another enemy 2 m off: begun ${run.began} (${run.aborted ?? ''})`);
  }
  {
    const { world, me, him, orders, step } = opened('dagger', 'none', { apart: 3 });
    const run = oneExecution(world, me, him, orders, step);
    assert.ok(run.began !== null && run.began <= 0.05 && run.thrown, `three metres off: begun ${run.began}, struck ${run.struck} (${run.aborted ?? ''})`);
  }
});

test('a press asked while his body cannot yet act on it (reeling) is kept and carried out as soon as it can', () => {
  const { world, me, him, orders, step } = opened('katana', 'none');
  me.stagger = 0.2;
  const run = oneExecution(world, me, him, orders, step);
  assert.ok(run.began !== null && run.began >= 0.15 && run.began <= 0.35, `begun when the reel passed: ${run.began}`);
  assert.ok(run.thrown);
});

test('through a real big deflect: the guard up at the last moment, the striker broken open, one tap and the execution is under way within a frame or two', () => {
  const world = createWorld([
    { inputs: { ...structuredClone(PRESETS.contender), style: 'katana' }, corner: 'red' },
    { inputs: { ...structuredClone(PRESETS.contender), style: 'katana' }, corner: 'blue' },
  ], { seed: 1 });
  world.armed = true;
  const [striker, me] = world.fighters;
  const distance = reachOf(striker) * 0.85;
  placeFighter(striker, -distance / 2, 0);
  placeFighter(me, distance / 2, 0);
  const orders = newOrders();
  const still = new Set([0, 1]);
  const step = (current, dt) => {
    thinkAll(current, dt, still);
    directFighter(current, me, orders, dt);
  };
  advance(world, 0.6, step, 1 / 120);
  throwPunch(world, striker, 'kesagiri', 'body');
  let deflect = null;
  for (let t = 0; t < 0.8 && !deflect; t += 1 / 120) {
    // (The guard up 0.06 s before the cut lands, 0.26 s after it is thrown: deflect.test.js's big deflect.)
    orders.guard = t >= 0.2;
    advance(world, 1 / 120, step, 1 / 120);
    deflect = world.events.find((event) => event.kind === 'deflect') ?? null;
  }
  assert.ok(deflect?.big && striker.brokenOpen > 0, 'a big deflect');
  // Still holding the guard as he taps, as a man does in the moment.
  const run = oneExecution(world, me, striker, orders, (seconds) => advance(world, seconds, step, 1 / 120));
  assert.ok(run.began !== null && run.began <= 0.05 && run.thrown, `begun ${run.began} s after the tap, the blow thrown`);
});

test('the press that asks for the execution is heard at once: the parry\'s ring, once however often he presses', () => {
  const { world, me, him, orders, step } = opened('katana', 'none');
  world.ear = { x: 0, z: 0, radius: 100 };
  const rings = () => readSounds(world).events.filter((sound) => sound.type === 'clash' && sound.deflect && sound.byPlayer && !sound.big).length;
  press(world, me, him, orders);
  step(1 / 120);
  assert.equal(rings(), 1);
  press(world, me, him, orders);
  step(1 / 120);
  assert.equal(rings(), 1);
});
