import test from 'node:test';
import assert from 'node:assert/strict';
import { P } from '../src/body.js';
import { createWorld, seededRandom } from '../src/physics.js';
import { slotAt } from '../src/formation.js';
import { legionSides, SCENARIOS } from '../src/scenarios.js';
import { canCommand, COMMAND, giveOrder, keepOrders, obeyOrder, orderKeepsPlace, standingOrder } from '../src/command.js';
import { orderBattle, runOrders, towardEnemy } from '../tools/orders.js';

const at = (fighter) => [fighter.x[P.pelvis * 3], fighter.x[P.pelvis * 3 + 2]];
const apart = (a, b) => Math.hypot(a[0] - b[0], a[1] - b[1]);
const mean = (values) => values.reduce((sum, value) => sum + value, 0) / Math.max(1, values.length);
const hearing = (men) => men.filter((fighter) => fighter.state === 'up' && !fighter.panicked && !fighter.crawling);

/** Rome against Han, `count` a side (the player the legion's lead), quicker than the level's thirty-five. */
function legion(count = 12, seed = 3) {
  const sides = legionSides(seededRandom(seed), count);
  const level = SCENARIOS.legion;
  const world = createWorld([...sides.red.map((inputs) => ({ inputs, corner: 'red' })), ...sides.blue.map((inputs) => ({ inputs, corner: 'blue' }))], { seed, arena: level.arena, formation: level.formation });
  const player = world.fighters.find((fighter) => fighter.corner === 'red');
  return { world, player, men: world.fighters.filter((fighter) => fighter.corner === 'red' && fighter !== player) };
}

test('orders are for a side of four or more: not a one-on-one; every battle begins free', () => {
  const duel = createWorld([{ inputs: legionSides(seededRandom(1), 1).red[0], corner: 'red' }, { inputs: legionSides(seededRandom(1), 1).blue[0], corner: 'blue' }]);
  assert.equal(canCommand(duel, duel.fighters[0]), false);
  const { world, player } = legion();
  assert.equal(canCommand(world, player), true);
  assert.equal(standingOrder(world, 'red'), 'free');
  assert.equal(COMMAND.minSide, 4);
});

/** The spread (m, rms) of each man's displacement since `from` about their mean displacement, and that mean ([x, z]). */
function displacement(men, from) {
  const moved = men.filter((fighter) => from.has(fighter)).map((fighter) => [at(fighter)[0] - from.get(fighter)[0], at(fighter)[1] - from.get(fighter)[1]]);
  const middle = [mean(moved.map((move) => move[0])), mean(moved.map((move) => move[1]))];
  const spread = Math.sqrt(mean(moved.map((move) => (move[0] - middle[0]) ** 2 + (move[1] - middle[1]) ** 2)));
  return { middle, spread };
}
// (On foot: the horse are not marched.)
const placesNow = (men) => new Map(hearing(men).filter((fighter) => !fighter.mount).map((fighter) => [fighter, at(fighter)]));

/** Run with the player walking the way `yaw` faces (not thought for), `seconds` long. */
async function walkPlayer(world, player, yaw, seconds) {
  const { advance } = await import('../src/physics.js');
  const { thinkAll } = await import('../src/ai.js');
  advance(world, seconds, (current, dt) => {
    thinkAll(current, dt, new Set([player.id]));
    player.yaw = yaw;
    player.move = 1;
    player.strafe = 0;
    player.running = false;
  });
}

test('To me with a formation: it comes to him whole and follows him as he goes, every man moved alike', async () => {
  const { world, player, men } = legion();
  giveOrder(world, player, 'rally');
  assert.equal(standingOrder(world, 'red'), 'rally');
  assert.ok(world.commands.red.offset, 'a march, not rings');
  runOrders(world, player, 2);
  const from = placesNow(men);
  const playerFrom = at(player);
  // He walks off across the field (+z); the ranks come after him.
  await walkPlayer(world, player, -Math.PI / 2, 6);
  const { middle, spread } = displacement(hearing(men), from);
  const walked = apart(at(player), playerFrom);
  assert.ok(middle[1] > walked * 0.5, `the ranks followed: ${middle[1].toFixed(2)} m (he walked ${walked.toFixed(2)})`);
  assert.ok(spread < 0.5, `the shape kept: each man's displacement within ${spread.toFixed(2)} m of the rest`);
  // The formation's own anchor went with them (taken back, they stand where they are).
  assert.ok(Math.abs(world.formations.red.anchor[1] - world.commands.red.anchor[1] - world.commands.red.offset[1]) < 1e-9);
});

test('To me from afar: the formation is brought up to him, its nearest man a few steps off', async () => {
  const { world, player, men } = legion();
  // He walks away behind his ranks first (red faces +x), then calls them.
  await walkPlayer(world, player, Math.PI, 12);
  const before = Math.min(...hearing(men).map((fighter) => apart(at(fighter), at(player))));
  giveOrder(world, player, 'rally');
  runOrders(world, player, 10);
  const nearest = Math.min(...hearing(men).map((fighter) => apart(at(fighter), at(player))));
  assert.ok(before > 5 && nearest < COMMAND.march.near + 1.5, `nearest man ${before.toFixed(1)} → ${nearest.toFixed(1)} m`);
});

test('Advance: the formation walks toward the enemy as one body, then charges home', () => {
  // (The level's own legion, its lines some 40 m apart: room for a long walk before the charge.)
  const { world, player, men } = orderBattle('legion', 1);
  const command = giveOrder(world, player, 'advance');
  assert.equal(standingOrder(world, 'red'), 'advance');
  runOrders(world, player, 3);
  const from = placesNow(men);
  const offset = [...command.offset];
  runOrders(world, player, 5);
  assert.equal(standingOrder(world, 'red'), 'advance');
  const { middle, spread } = displacement(hearing(men), from);
  const way = towardEnemy(world, player);
  const along = middle[0] * way[0] + middle[1] * way[1];
  // At the march's walk, or (dressing on the slowest) as fast as men in armour step facing the enemy.
  assert.ok(along / 5 > 0.6 && along / 5 <= COMMAND.march.advance + 0.05, `at a steady walk: ${(along / 5).toFixed(2)} m/s`);
  assert.ok(apart(middle, [command.offset[0] - offset[0], command.offset[1] - offset[1]]) < 0.6, `with the offset: ${middle.map((v) => v.toFixed(2))} against ${(command.offset[0] - offset[0]).toFixed(2)}`);
  assert.ok(spread < 0.4, `the shape kept: ${spread.toFixed(2)} m`);
  // Near the enemy (Sekigahara's lines start some 25 m apart) the advance becomes a charge that way.
  const near = orderBattle('sekigahara', 1);
  const given = giveOrder(near.world, near.player, 'advance');
  let charged = null;
  for (let t = 0; t < 12 && !charged; t += 0.5) {
    runOrders(near.world, near.player, 0.5);
    if (standingOrder(near.world, 'red') === 'charge') charged = near.world.commands.red;
  }
  assert.ok(charged, 'it became a charge');
  assert.equal(charged.fromAdvance, given.serial);
  const foes = near.world.fighters.filter((fighter) => fighter.corner === 'blue' && fighter.state === 'up' && !fighter.mount);
  const gap = Math.min(...hearing(near.men).filter((fighter) => !fighter.mount).map((fighter) => Math.min(...foes.map((foe) => apart(at(foe), at(fighter))))));
  assert.ok(gap < COMMAND.march.chargeAt + 3, `charged from ${gap.toFixed(1)} m`);
  assert.ok(charged.dir[0] * towardEnemy(near.world, near.player)[0] > 0.8, 'at the enemy');
});

test('Fall back: the formation steps back from the enemy as one body, far slower than it advances, facing them', () => {
  const { world, player, men } = legion();
  const command = giveOrder(world, player, 'fallback');
  runOrders(world, player, 2);
  const from = placesNow(men);
  runOrders(world, player, 5);
  const { middle, spread } = displacement(hearing(men), from);
  const way = command.heading;
  const back = -(middle[0] * way[0] + middle[1] * way[1]) / 5;
  assert.ok(back > 0.2 && back < COMMAND.march.advance / 2, `back at ${back.toFixed(2)} m/s (the advance ${COMMAND.march.advance})`);
  assert.ok(spread < 0.4, `the shape kept: ${spread.toFixed(2)} m`);
  // Still facing them: each man's facing within a right angle of the way to the enemy.
  const facing = hearing(men).filter((fighter) => Math.cos(fighter.yaw) * way[0] - Math.sin(fighter.yaw) * way[1] > 0);
  assert.ok(facing.length >= hearing(men).length - 2, `${facing.length} of ${hearing(men).length} facing the enemy`);
});

test('Fall back stops at the field\'s edge, the shape kept', () => {
  // The raiders of the wokou level stand near the end of their floor.
  const { world, player, men } = orderBattle('wokou', 2);
  const command = giveOrder(world, player, 'fallback');
  runOrders(world, player, 8);
  const offset = [...command.offset];
  runOrders(world, player, 3);
  assert.ok(apart(offset, command.offset) < 1e-9, 'halted');
  const edge = world.arena.halfX - COMMAND.march.edge;
  for (const fighter of hearing(men)) assert.ok(Math.abs(command.base[fighter.id][0] + command.offset[0]) <= edge + COMMAND.march.look);
});

test('the march by arms: Advance to the shot leaves the foot free; the horse are not walked; Free takes it back', () => {
  const { world, player } = orderBattle('catalaunian', 1);
  assert.equal(giveOrder(world, player, 'advance', { group: 'horse' }), null);
  giveOrder(world, player, 'advance', { group: 'shot' });
  assert.equal(standingOrder(world, 'red', 'shot'), 'advance');
  assert.equal(standingOrder(world, 'red', 'foot'), 'free');
  // An order to the shot does not move the foot's ranks.
  assert.equal(world.groupCommands.red.shot.anchor, undefined);
  giveOrder(world, player, 'free');
  assert.equal(standingOrder(world, 'red', 'shot'), 'free');
});

test('To me in a loose crowd (no drill): the raiders gather round their man', () => {
  const { world, player, men } = orderBattle('wokou', 2);
  giveOrder(world, player, 'rally');
  runOrders(world, player, 6);
  const after = hearing(men).map((fighter) => apart(at(fighter), at(player)));
  assert.ok(mean(after) < 4, `mean ${mean(after).toFixed(2)} m`);
});

test('Charge: his men go the way he gave, far further than they would have', () => {
  const ordered = legion();
  const free = legion();
  const way = towardEnemy(ordered.world, ordered.player);
  const starts = new Map([...ordered.men, ...free.men].map((fighter) => [fighter, at(fighter)]));
  const along = (men) => mean(men.map((fighter) => (at(fighter)[0] - starts.get(fighter)[0]) * way[0] + (at(fighter)[1] - starts.get(fighter)[1]) * way[1]));
  giveOrder(ordered.world, ordered.player, 'charge', { dir: way });
  runOrders(ordered.world, ordered.player, 6);
  runOrders(free.world, free.player, 6);
  assert.ok(along(ordered.men) > along(free.men) + 4, `charged ${along(ordered.men).toFixed(1)} m, free ${along(free.men).toFixed(1)} m`);
  // Each goes for a man in that way.
  for (const fighter of hearing(ordered.men)) {
    if (fighter.order?.target === null || fighter.order?.target === undefined) continue;
    const target = ordered.world.fighters[fighter.order.target];
    const offset = [at(target)[0] - ordered.world.commands.red.at[0], at(target)[1] - ordered.world.commands.red.at[1]];
    assert.ok(offset[0] * way[0] + offset[1] * way[1] > -COMMAND.charge.behind, 'his man is ahead, the way given');
  }
});

test('Charge with nobody in the way: each halts where he got to and holds there', () => {
  const { world, player, men } = legion();
  // Away from the enemy altogether.
  const way = towardEnemy(world, player);
  giveOrder(world, player, 'charge', { dir: [-way[0], -way[1]] });
  runOrders(world, player, 1);
  const halted = hearing(men).filter((fighter) => fighter.order?.halted);
  assert.ok(halted.length >= men.length - 1, `${halted.length} of ${men.length} halted`);
  const starts = new Map(halted.map((fighter) => [fighter, at(fighter)]));
  runOrders(world, player, 3);
  const moved = mean(halted.map((fighter) => apart(at(fighter), starts.get(fighter))));
  assert.ok(moved < 0.6, `held: ${moved.toFixed(2)} m`);
});

test('Hold: the formation stops where it is and his men stand in their ranks; loose men stand on their ground', () => {
  const ranks = legion();
  giveOrder(ranks.world, ranks.player, 'hold');
  const anchor = [...ranks.world.formations.red.anchor];
  runOrders(ranks.world, ranks.player, 6);
  assert.ok(apart(anchor, ranks.world.formations.red.anchor) < 1e-9, 'the anchor held');
  for (const fighter of hearing(ranks.men)) {
    assert.equal(fighter.order.ranks, true);
    // In his place (closed up in the testudo as the ranks are).
    assert.ok(apart(at(fighter), slotAt(ranks.world.formations.red, fighter.slot)) < 1, `in his place: ${apart(at(fighter), slotAt(ranks.world.formations.red, fighter.slot)).toFixed(2)} m`);
  }
  const loose = orderBattle('wokou', 2);
  giveOrder(loose.world, loose.player, 'hold');
  const starts = new Map(loose.men.map((fighter) => [fighter, at(fighter)]));
  runOrders(loose.world, loose.player, 4);
  const moved = mean(hearing(loose.men).map((fighter) => apart(at(fighter), starts.get(fighter))));
  assert.ok(moved < 0.5, `held their ground: ${moved.toFixed(2)} m`);
});

test('Free: the order taken back, the side goes its own way again (back to the ranks)', () => {
  const { world, player, men } = legion();
  // Drawn up in a wedge, out of their ranks.
  giveOrder(world, player, 'wedge', { dir: towardEnemy(world, player) });
  runOrders(world, player, 5);
  const formation = world.formations.red;
  const fromSlots = () => mean(hearing(men).map((fighter) => apart(at(fighter), slotAt(formation, fighter.slot))));
  const rallied = fromSlots();
  giveOrder(world, player, 'free');
  assert.equal(standingOrder(world, 'red'), 'free');
  assert.ok(men.every((fighter) => !orderKeepsPlace(world, fighter)));
  runOrders(world, player, 5);
  assert.ok(fromSlots() < rallied * 0.5, `back toward their places: ${rallied.toFixed(2)} → ${fromSlots().toFixed(2)} m`);
});

test('a broken, crawling or fled man hears no order; the order lapses with its giver out', () => {
  const { world, player, men } = legion();
  giveOrder(world, player, 'rally');
  const [broken, crawling, fled, steady] = men;
  broken.panicked = true;
  crawling.crawling = true;
  fled.fled = true;
  const foe = world.fighters.find((fighter) => fighter.corner === 'blue');
  const style = { attacks: {} };
  for (const fighter of [broken, crawling, fled]) {
    assert.equal(obeyOrder(world, fighter, foe, style, 1 / 60), null);
    assert.equal(orderKeepsPlace(world, fighter), false);
  }
  assert.equal(obeyOrder(world, steady, foe, style, 1 / 60), 'obeyed');
  player.state = 'out';
  keepOrders(world);
  assert.equal(standingOrder(world, 'red'), 'free');
});

// Arms (command.js COMMAND_GROUPS): the foot, the shot and the horse ordered apart.
test('arms: an order to the shot leaves the foot free; an order to all takes back every arm\'s', async () => {
  const { groupsFor, groupOf } = await import('../src/command.js');
  const { world, player } = orderBattle('catalaunian', 1);
  assert.deepEqual(groupsFor(world, player), ['all', 'foot', 'shot', 'horse']);
  giveOrder(world, player, 'hold', { group: 'shot' });
  assert.equal(standingOrder(world, 'red', 'shot'), 'hold');
  assert.equal(standingOrder(world, 'red', 'foot'), 'free');
  const shooter = world.fighters.find((fighter) => fighter.corner === 'red' && fighter !== player && groupOf(fighter) === 'shot');
  const footman = world.fighters.find((fighter) => fighter.corner === 'red' && fighter !== player && groupOf(fighter) === 'foot');
  // (A shooter held in his rank keeps it: orderKeepsPlace is false for him too. What tells is whether the order reached him.)
  orderKeepsPlace(world, shooter);
  orderKeepsPlace(world, footman);
  assert.equal(shooter.order?.serial, world.groupCommands.red.shot.serial);
  assert.equal(footman.order, undefined);
  // The horse take only what a rider can be told.
  assert.equal(giveOrder(world, player, 'rally', { group: 'horse' }), null);
  giveOrder(world, player, 'charge');
  assert.equal(standingOrder(world, 'red', 'shot'), 'charge');
  assert.deepEqual(world.groupCommands.red, {});
});

test('arms: the horse held by his order stay on their wing past the time it would have gone; Charge lets them go', () => {
  const { world, player } = orderBattle('catalaunian', 1);
  giveOrder(world, player, 'hold', { group: 'horse' });
  world.wings.by = 0;
  runOrders(world, player, 1);
  const riders = world.fighters.filter((fighter) => fighter.corner === 'red' && fighter.mount && fighter.state === 'up');
  assert.ok(riders.length && riders.every((fighter) => fighter.wing?.held), 'all held');
  giveOrder(world, player, 'charge', { group: 'horse' });
  assert.ok(riders.every((fighter) => !fighter.wing.held), 'all let go');
});

test('the general played stands in the middle of his arm, however many his side', () => {
  for (const count of [5, 20, 60]) {
    const sides = legionSides(seededRandom(2), count);
    const level = SCENARIOS.legion;
    const entries = [...sides.red.map((inputs) => ({ inputs, corner: 'red' })), ...sides.blue.map((inputs) => ({ inputs, corner: 'blue' }))];
    const world = createWorld(entries, { seed: 2, arena: level.arena, formation: level.formation, general: { corner: 'red', index: 0 } });
    const red = world.fighters.filter((fighter) => fighter.corner === 'red');
    const me = red[0];
    const arm = red.filter((fighter) => Boolean(fighter.mount) === Boolean(me.mount));
    const middle = [mean(arm.map((fighter) => at(fighter)[0])), mean(arm.map((fighter) => at(fighter)[1]))];
    const nearest = Math.min(...arm.map((fighter) => apart(at(fighter), middle)));
    assert.ok(apart(at(me), middle) <= nearest + 1e-6, `${count} a side: ${apart(at(me), middle).toFixed(2)} m from the middle (nearest man ${nearest.toFixed(2)})`);
  }
});

test('Line, Wedge, Square: his men drawn up in the shape where he stands, each in his place, shoulder to shoulder', async () => {
  const { COMMAND: spec, ORDER_SHAPES } = await import('../src/command.js');
  for (const shape of ORDER_SHAPES) {
    const { world, player, men } = orderBattle('wokou', 2);
    const command = giveOrder(world, player, shape, { dir: towardEnemy(world, player) });
    assert.equal(standingOrder(world, 'red'), shape);
    runOrders(world, player, 8);
    const placed = hearing(men).filter((fighter) => command.places[fighter.id]);
    assert.ok(placed.length >= men.length - 3, `${shape}: ${placed.length} placed of ${men.length}`);
    const off = placed.map((fighter) => apart(at(fighter), command.places[fighter.id]));
    assert.ok(mean(off) < 0.5, `${shape}: ${mean(off).toFixed(2)} m off their places`);
    // Close order: the room a man keeps out of the ranks is not kept (each a file's room from the next, not ~2 m).
    const nearest = placed.map((fighter) => Math.min(...placed.filter((other) => other !== fighter).map((other) => apart(at(fighter), at(other)))));
    assert.ok(mean(nearest) < spec.shape.file * 1.25, `${shape}: nearest comrade ${mean(nearest).toFixed(2)} m`);
    assert.ok(placed.every((fighter) => orderKeepsPlace(world, fighter)));
  }
});

test('the shapes: a line with him in its front rank, a wedge with its point before him, a square round him', async () => {
  const { world, player } = orderBattle('wokou', 2);
  const toward = towardEnemy(world, player);
  const way = [toward[0] / Math.hypot(...toward), toward[1] / Math.hypot(...toward)];
  const ahead = (place) => (place[0] - at(player)[0]) * way[0] + (place[1] - at(player)[1]) * way[1];
  const placesOf = (shape) => Object.values(giveOrder(world, player, shape, { dir: way }).places);
  const line = placesOf('line');
  assert.ok(line.every((place) => ahead(place) < 0.05) && line.filter((place) => Math.abs(ahead(place)) < 0.05).length >= line.length / 4);
  const wedge = placesOf('wedge');
  assert.ok(Math.max(...wedge.map(ahead)) > 1);
  const square = placesOf('square');
  const middle = [mean(square.map((place) => place[0])), mean(square.map((place) => place[1]))];
  assert.ok(apart(middle, at(player)) < 1, `the square round him (${apart(middle, at(player)).toFixed(2)} m off)`);
});

test('Hold fire: his bows loose nothing till Fire at will', async () => {
  const { giveFireOrder, holdingFire } = await import('../src/command.js');
  const { PRESETS } = await import('../src/body.js');
  const { advance } = await import('../src/physics.js');
  const { thinkAll } = await import('../src/ai.js');
  const shots = (hold) => {
    const red = [structuredClone(PRESETS.samurai), ...Array.from({ length: 5 }, () => structuredClone(PRESETS.archerYumi))];
    const blue = Array.from({ length: 5 }, () => structuredClone(PRESETS.samurai));
    const world = createWorld([...red.map((inputs) => ({ inputs, corner: 'red' })), ...blue.map((inputs) => ({ inputs, corner: 'blue' }))], { seed: 4, arena: { halfX: 40, halfZ: 40 } });
    const player = world.fighters[0];
    player.player = true;
    world.fighters.forEach((fighter, index) => {
      fighter.root[0] = fighter.corner === 'red' ? -14 : 14;
      fighter.root[1] = (index % 6) * 1.5 - 4;
    });
    giveFireOrder(world, player, hold);
    assert.equal(holdingFire(world, 'red'), hold);
    advance(world, 8, (current, dt) => thinkAll(current, dt, new Set([player.id])));
    return world.fighters.filter((fighter) => fighter.corner === 'red' && fighter !== player).reduce((sum, fighter) => sum + fighter.stats.thrown, 0);
  };
  assert.equal(shots(true), 0);
  assert.ok(shots(false) > 5);
});
