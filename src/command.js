// Orders: in a battle, the man the player plays commands the rest of his
// side. An order is world state (`world.commands[corner]`), given by one man
// (`by`) and kept until another is given; the AI reads it (ai.js: the
// focus, then what he does, before his place in the ranks).
//   To me (`rally`): where his men stand in a formation (drilled ranks with
//     their slots, or a shape or places he drew them up in, or a march under
//     way), the formation comes to him whole and follows him as he goes: kept
//     where it stands to him if he is at it, else brought up till its nearest
//     man is a few steps from him; every man moved by one shared offset
//     (the march, below), a straggler back to his place in it. Where there is
//     no formation to keep (a loose band), they break off and gather round
//     him in loose rings, following as he goes. Either way they stand on
//     guard, facing the nearest enemy, and fight only a man who comes within
//     reach of them (never far from their place); shooters shoot from where
//     they stand.
//   Advance (`advance`), Fall back (`fallback`): the march. Every man's
//     place is his place when the order was given (his slot in the ranks,
//     his place in a shape drawn up, where he stood) moved by one offset the
//     order shares, so the formation goes as one body and keeps its shape:
//     toward the enemy's line (the way to the middle of their men, turned to
//     it slowly as they move), at a steady walk, dressing on the slowest
//     (the offset waits while the men are not up with it); or away from it,
//     much slower, a step back at a time still facing them, halted at the
//     field's edge and before a wall, a house or a ditch behind. Each man
//     fights only a man who comes within reach of him, as on a Hold. Once
//     the front of an advance is within a charge's run of the enemy
//     (COMMAND.march.chargeAt) it becomes a Charge that way.
//   Charge (`charge`): his men go at a run for the enemy in the way he
//     gave (where he looked, or at the man he was locked on), each the
//     nearest man in that way, and fight him; with nobody left in that way,
//     each halts where he got to and holds there.
//   Hold (`hold`): they stand their ground: a man in his place in the
//     ranks keeps it (the formation's advance halted), anyone else holds the
//     spot where the order found him; each fights only a man within reach.
//   As you were (`free`): the order taken back, the side's own way again
//     (its formation, its standard). Every battle begins so.
//   Line, Wedge, Square (`line`, `wedge`, `square`: ORDER_SHAPES): his men drawn up in that shape where he stands, faced the
//     way he looks (or at the man he is locked on): a line two or three deep with him in the middle of its front rank,
//     its shooters in front; a wedge with its point a step before him; a hollow square round him, every side facing out.
//     Each man goes to his place and keeps it shoulder to shoulder (the room a man keeps out of the ranks, ai.js
//     AI.elbowRoom, is not kept in them), fighting only a man who comes within reach. It stays where it was drawn up
//     till another order.
//   Hold fire, Fire at will (giveFireOrder): his bows, crossbows and guns do not loose till he gives the word, or do;
//     a side apart from its other orders. Every battle begins at will.
//   Formation (`form`), where the side has places of its own to keep
//     (`world.formPlaces[corner]`: Last Stand Squad's, placed before the
//     run): every man back to his place, at a run from afar, and held
//     there, fighting only a man who comes within reach of him.
// A man broken (panicked), crawling away, fled, on horseback or down hears
// nothing; once up he obeys whatever order stands. The giver out of the
// fight, his order lapses.
// Who hears him (`world.commandMen[corner]`, where it is set: story mode, by his rank): only those men (a squad
// leader's squad), or nobody (a private soldier commands no one, and has no orders to give). Unset, his whole side.
// Arms (COMMAND_GROUPS): a general parts his field as commanders always have, into
// his foot, his shot and his horse, and may order each apart (`world.groupCommands[corner][group]`):
// the shot told to hold while the foot comes to him and the horse charges. An order
// to all (`world.commands[corner]`) takes back every order to an arm. Which arm a man
// is in is read from him (groupOf), never listed. The horse are not walked about by
// orders (a rider's footwork is his horse's, and a wing is only held or let go:
// formation.js moveWings; so neither To me nor the march is theirs): Charge lets them go from their wing, Hold
// reins them in where they are (holding as a wing does, formation.js moveWings, till an enemy is on them), Free gives them
// back to their wing's own time to go.

import { P } from './body.js';
import { slotAt } from './formation.js';
import { reachOf, throwPunch, WORLD } from './physics.js';
import { walkingDistance } from './physics/fieldworks.js';
import { groundOpen, groundPlanOf } from './physics/groundplan.js';

export const COMMAND = {
  // A side this big (the player among them) takes orders: as many as have a standard, so a few men round him.
  minSide: WORLD.standard.minSide,
  // To me: rings round him, the first `first` m out and each further one `gap` m beyond, a man every `spacing` m round each: loose, so each has room to swing.
  rally: { first: 1.6, gap: 1.1, spacing: 1.15 },
  // A place this near (m) is reached; from further than `turnFrom` he turns and walks to it (else he steps there facing the enemy), from `runFrom` at a run.
  arrive: 0.25,
  turnFrom: 1.5,
  runFrom: 3,
  steer: 0.4,
  // An enemy within reach of both, plus this (m), is close enough to fight where he stands.
  engage: 0.6,
  // ... while he is no further than this (m) from his place; beyond it he goes back to it first.
  leash: 1.5,
  // Charge: the enemy in the way given are those ahead of where it was given (or no more than `behind` m back), within `width` m of its line, widening by `spread` m a m out (about 30° each side).
  charge: { behind: 1, width: 3, spread: 0.58, retargetEvery: 0.5, runFrom: 2.5 },
  // Hold: a man this near (m) his place in the ranks keeps it; anyone further holds where he stands.
  ranksWithin: 2,
  // The drawn-up shapes (ORDER_SHAPES): a man's room in the file (m, shoulder to shoulder with a weapon: close order) and a rank's
  // depth behind the one before; a line is `deep` ranks (`deepFrom` men or more, one rank more); a wedge's point `ahead` m
  // before him; a square's side long enough for its men round it.
  shape: { file: 0.95, rank: 1.15, deep: 2, deepFrom: 14, ahead: 1.2 },
  // The march (Advance, Fall back, and To me where there is a formation to keep): every man's place moved by one offset.
  march: {
    // Advance (m/s): a steady walk in step, about a drilled pace of 0.75 m at 65 to the minute, the drill's own advance
    // (formation.js DRILL.pace); a line that walks faster loses its dressing, and men in armour stepping forward facing the
    // enemy (the fight's footwork, not a stride) make little more than this (a legionary about 0.87 m/s).
    advance: 0.8,
    // Fall back (m/s): a step back at a time, facing the enemy, the ground behind unseen and the files kept; well under half
    // the advance (the user's call, 2026-11-28: slower than going forward).
    fallBack: 0.35,
    // To me (m/s): the formation following him at a man's ordinary walk (so it keeps up with him walking), at a jog
    // (`run`) while it is more than `runFrom` m short of where it should stand to him.
    rallyWalk: 1.3,
    run: 2.4,
    runFrom: 6,
    // To me from afar (m): brought up till its nearest man's place is this far from him; nearer than this when the order is
    // given, it keeps where it stands to him.
    near: 2.5,
    // The dressing: the offset goes on at its full pace while the men are on the median no further than `dressed` m from
    // their places, slowing to a stop at twice that (the front waits, the rear closes up).
    dressed: 0.8,
    // How fast (rad/s) the way to the enemy is turned to as they move: the line wheels slowly, it does not swing.
    turn: 0.3,
    // An advance turns into a charge with its front this near (m) the enemy's nearest man: the run-in at the end of an
    // advance on foot, about a javelin's cast (the legion threw its pila and ran in from there); a man in kit cannot run
    // much further and arrive fit to fight, so not more (a kit's own `drill.charge`, 5 to 8 m, is the last of the run).
    chargeAt: 15,
    // Falling back: halted when any man's place `look` m further back is off the floor (within `edge` m of its side),
    // shut to a man (a house: physics/groundplan.js), or a longer walk than that (a wall or a ditch across it:
    // physics/fieldworks.js walkingDistance, more than `slack` m over).
    look: 1,
    edge: 1.2,
    slack: 0.3,
  },
};

// The shapes a side may be drawn up in, each its places ([x, z] in the frame of the way it faces: x ahead, z to the left).
export const ORDER_SHAPES = ['line', 'wedge', 'square'];

// The arms, in the order the player steps through them ([ and ]): `orders`, where given, the only ones an arm takes.
export const COMMAND_GROUPS = [
  { key: 'all' },
  { key: 'foot' },
  { key: 'shot' },
  { key: 'horse', orders: ['charge', 'hold', 'free'] },
];

// The orders in the order of their buttons: icon, word, key.
export const COMMAND_ORDERS = [
  { kind: 'rally', label: 'To me', key: '7' },
  // The march: the whole formation toward the enemy's line, or back from it (keys left of To me's).
  { kind: 'advance', label: 'Advance', key: '6' },
  { kind: 'fallback', label: 'Fall back', key: '5' },
  { kind: 'charge', label: 'Charge', key: '8' },
  { kind: 'hold', label: 'Hold', key: '9' },
  { kind: 'free', label: 'Free', key: '0' },
  // Back to the places set before the fight: only where the side has them (formPlaces).
  { kind: 'form', label: 'Formation', key: '-', places: true },
  // Drawn up in a shape where he stands (ORDER_SHAPES).
  { kind: 'line', label: 'Line', key: 'z' },
  { kind: 'wedge', label: 'Wedge', key: 'x' },
  { kind: 'square', label: 'Square', key: 'b' },
];

// The orders that march the formation (COMMAND.march): every man's place moved by one offset the order shares.
export const MARCH_ORDERS = ['advance', 'fallback'];

// Hold fire / Fire at will: its own button (one press each way), key H.
export const FIRE_ORDER_KEY = 'h';

/** The orders this side (or one arm of it, `group`) may be given: all but Formation where it has no places of its own, and the horse's own few. */
export function ordersFor(world, corner, group = 'all') {
  const allowed = COMMAND_GROUPS.find((entry) => entry.key === group)?.orders;
  return COMMAND_ORDERS.filter((entry) => (!entry.places || Boolean(world?.formPlaces?.[corner])) && (!allowed || allowed.includes(entry.kind)));
}

/** The arm a man fights in: the horse while mounted, the shot if he went out with a bow or gun (kept: a gunner with his sword out is still of the shot), else the foot. */
export function groupOf(fighter) {
  if (fighter.mount) return 'horse';
  fighter.commandArm ??= fighter.weapon?.held && (fighter.weapon.spec.shot || fighter.weapon.spec.ranged) ? 'shot' : 'foot';
  return fighter.commandArm;
}

/** The arms of his side he can order apart: 'all', then each arm with anyone in it who hears him; just 'all' where there is only one arm. */
export function groupsFor(world, by) {
  if (!world || !by) return ['all'];
  const present = new Set();
  for (const fighter of world.fighters) {
    if (fighter !== by && fighter.corner === by.corner && fighter.state !== 'out' && hearsOrders(world, fighter)) present.add(groupOf(fighter));
  }
  const arms = COMMAND_GROUPS.filter((entry) => entry.key !== 'all' && present.has(entry.key)).map((entry) => entry.key);
  return arms.length > 1 ? ['all', ...arms] : ['all'];
}

/** The arm his orders go to now ('all' unless he chose one: chooseGroup). */
export function chosenGroup(world, by) {
  const chosen = world?.orderGroups?.[by?.corner] ?? 'all';
  return groupsFor(world, by).includes(chosen) ? chosen : 'all';
}

/** Choose the arm his orders go to: `step` +1 or -1 through those he has, or a key of COMMAND_GROUPS. */
export function chooseGroup(world, by, step) {
  const groups = groupsFor(world, by);
  const now = groups.indexOf(chosenGroup(world, by));
  const next = typeof step === 'number' ? groups[(now + step + groups.length) % groups.length] : (groups.includes(step) ? step : 'all');
  world.orderGroups ??= {};
  world.orderGroups[by.corner] = next;
  return next;
}

const commandAt = (fighter) => [fighter.x[P.pelvis * 3], fighter.x[P.pelvis * 3 + 2]];
const commandApart = (a, b) => Math.hypot(a[0] - b[0], a[1] - b[1]);

/** Whether this man can command his side: in a fight his side has enough men for it, and not out of it himself. */
export function canCommand(world, fighter) {
  if (!world || !fighter || fighter.state === 'out') return false;
  // (A squad with places of its own takes orders however small: two men are enough to be told back to them.)
  const least = world.formPlaces?.[fighter.corner] ? 2 : COMMAND.minSide;
  const heard = world.commandMen?.[fighter.corner];
  if (heard) return heard.some((id) => id !== fighter.id && world.fighters[id]?.state !== 'out');
  return world.fighters.filter((other) => other.corner === fighter.corner).length >= least;
}

/** Whether this man hears his side's orders: everyone, unless the side's orders reach only some (`world.commandMen`). */
const hearsOrders = (world, fighter) => !world.commandMen?.[fighter.corner] || world.commandMen[fighter.corner].includes(fighter.id);

/** The order his side (or one arm of it) is under ('rally', 'charge', 'hold', 'form'), or 'free': an arm's own order over the side's. */
export function standingOrder(world, corner, group = 'all') {
  const own = group === 'all' ? null : world?.groupCommands?.[corner]?.[group];
  return (own ?? world?.commands?.[corner])?.kind ?? 'free';
}

/** The order standing over this arm (its own, else the side's), or null: what a new call is told by. */
export function orderOver(world, corner, group = 'all') {
  return (group === 'all' ? null : world?.groupCommands?.[corner]?.[group]) ?? world?.commands?.[corner] ?? null;
}

/**
 * Give his side an order: `kind` one of COMMAND_ORDERS, `by` the man giving
 * it, `dir` ([x, z], for a charge) the way to go, `group` the arm it goes to
 * (COMMAND_GROUPS: 'all', the default, his whole side). 'free' takes the order back.
 */
export function giveOrder(world, by, kind, { dir = null, group = 'all' } = {}) {
  world.commands ??= {};
  world.groupCommands ??= {};
  if (kind === 'form' && !world.formPlaces?.[by.corner]) return null;
  if (!ordersFor(world, by.corner, group).some((entry) => entry.kind === kind)) return null;
  const arms = (world.groupCommands[by.corner] ??= {});
  if (group === 'horse') orderHorse(world, by.corner, kind);
  if (kind === 'free') {
    if (group === 'all') {
      delete world.commands[by.corner];
      for (const arm of Object.keys(arms)) delete arms[arm];
    } else delete arms[group];
    return null;
  }
  const at = commandAt(by);
  const length = dir ? Math.hypot(dir[0], dir[1]) : 0;
  const way = length > 1e-6 ? [dir[0] / length, dir[1] / length] : [Math.cos(by.yaw), -Math.sin(by.yaw)];
  world.orderCount = (world.orderCount ?? 0) + 1;
  const command = { kind, by: by.id, at, dir: way, since: world.time, serial: world.orderCount, group };
  // Hold to all or to the foot: the formation's anchor (the foot's ranks) stays where it is now.
  const formation = world.formations?.[by.corner];
  if (kind === 'hold' && formation && (group === 'all' || group === 'foot')) command.anchor = [...formation.anchor];
  // The march (and To me with a formation to keep): each man's place in the shape the side stands in now, and one offset.
  if (MARCH_ORDERS.includes(kind) || (kind === 'rally' && keepsFormation(world, by, group))) startMarch(world, by, command);
  else if (kind === 'rally') command.places = rallyPlaces(world, by, group);
  // Formation: each man's own place, fixed in the world ([x, z] by his id).
  if (kind === 'form') command.places = structuredClone(world.formPlaces[by.corner]);
  // A shape: each man's place in it, fixed in the world where it was drawn up.
  if (ORDER_SHAPES.includes(kind)) command.places = shapePlaces(world, by, kind, way, group);
  if (group === 'all') {
    world.commands[by.corner] = command;
    for (const arm of Object.keys(arms)) delete arms[arm];
  } else arms[group] = command;
  return command;
}

/**
 * An order to the horse, on the riders themselves (their `wing`, formation.js):
 * Charge lets every held rider go; Hold reins in every rider up where he is,
 * held as a wing is (marked `byOrder`); Free hands those back to their wing's
 * own time to go if the side still has one waiting (`world.wings`), else lets them go.
 */
function orderHorse(world, corner, kind) {
  // A side with no wing waiting is given one held only by the order (`ordered`: it goes at no time of its own), so an enemy upon a reined-in man still lets him go (moveWings).
  if (kind === 'hold') world.wings ??= { release: 0, by: Infinity, review: 0, ordered: true };
  for (const fighter of world.fighters) {
    if (fighter.corner !== corner || !fighter.mount || fighter.state !== 'up' || !hearsOrders(world, fighter)) continue;
    if (kind === 'charge' && fighter.wing) fighter.wing.held = false;
    else if (kind === 'hold') fighter.wing = { side: fighter.wing?.side ?? (Math.sign(fighter.mount.at[1]) || 1), held: true, byOrder: true };
    else if (kind === 'free' && fighter.wing?.byOrder) {
      fighter.wing.byOrder = false;
      fighter.wing.held = Boolean(world.wings) && !world.wings.ordered;
    }
  }
}


/**
 * The places of a shape (ORDER_SHAPES) for every man of his side who hears him (in `group`), [x, z] in the world: the shape's
 * places laid out in the frame of the way it faces (`way`, from where he stands), then each taken by the nearest man still
 * without one, the front places first (so no man walks through the ranks to the back of them). A line's front rank to its
 * shooters first.
 */
function shapePlaces(world, by, kind, way, group = 'all') {
  const spec = COMMAND.shape;
  const men = world.fighters.filter((fighter) => fighter.corner === by.corner && fighter !== by && fighter.state !== 'out' && !fighter.mount && hearsOrders(world, fighter) && (group === 'all' || groupOf(fighter) === group));
  const count = men.length;
  const local = [];
  if (kind === 'line') {
    // Ranks of equal length, he in the middle of the front one (a gap left for him).
    const deep = spec.deep + (count >= spec.deepFrom ? 1 : 0);
    const across = Math.ceil((count + 1) / deep);
    for (let rank = 0; local.length < count; rank += 1) {
      for (let file = 0; file < across && local.length < count; file += 1) {
        const z = (file - (across - 1) / 2) * spec.file;
        if (rank === 0 && Math.abs(z) < spec.file / 2) continue;
        local.push([-rank * spec.rank, z]);
      }
      if (rank === 0 && across === 1) local.push([0, spec.file]);
    }
  } else if (kind === 'wedge') {
    // Its point a step before him, each rank one man wider (he in the second rank's middle gap).
    for (let rank = 0; local.length < count; rank += 1) {
      for (let file = 0; file <= rank && local.length < count; file += 1) {
        const z = (file - rank / 2) * spec.file;
        const x = spec.ahead - rank * spec.rank;
        if (Math.abs(x) < 0.3 && Math.abs(z) < 0.3) continue;
        local.push([x, z]);
      }
    }
  } else {
    // A hollow square round him: its sides long enough to hold every man at a file's room, its corners filled.
    const perSide = Math.max(2, Math.ceil(count / 4) + 1);
    const half = ((perSide - 1) * spec.file) / 2;
    const ring = [];
    for (let k = 0; k < perSide - 1; k += 1) {
      const t = -half + k * spec.file;
      ring.push([half, t], [t + spec.file, half], [-half, -t], [-t - spec.file, -half]);
    }
    // The front side first, then the flanks, the rear last.
    ring.sort((a, b) => b[0] - a[0]);
    local.push(...ring.slice(0, count));
  }
  const at = commandAt(by);
  const left = [-way[1], way[0]];
  const places = local.map(([x, z]) => [at[0] + way[0] * x + left[0] * z, at[1] + way[1] * x + left[1] * z]);
  // The front places first; a line's shooters to its front rank.
  const order = places.map((place, index) => ({ place, ahead: local[index][0] })).sort((a, b) => b.ahead - a.ahead);
  const shot = (fighter) => (kind === 'line' && groupOf(fighter) === 'shot' ? 0 : 1);
  const waiting = [...men].sort((a, b) => shot(a) - shot(b));
  const result = {};
  for (const { place } of order) {
    // The nearest man of the first kind still waiting (the shot, for a line's front).
    const kindNow = shot(waiting[0]);
    let best = -1;
    let bestApart = Infinity;
    waiting.forEach((fighter, index) => {
      if (shot(fighter) !== kindNow) return;
      const apart = commandApart(commandAt(fighter), place);
      if (apart < bestApart) {
        best = index;
        bestApart = apart;
      }
    });
    if (best < 0) break;
    result[waiting[best].id] = place;
    waiting.splice(best, 1);
  }
  return result;
}

/**
 * Hold fire (`hold` true) or Fire at will, to every man of his side who hears him: a man told to hold looses nothing (no
 * arrow, no bolt, no ball: physics.js throwPunch) till told he may; the man played looses as he likes. Kept on the side
 * (`world.holdFire[corner]`) for the button and for men who come into the fight after it; its serial (`world.fireSerial`)
 * and its giver (`world.fireBy`) for the call heard as the shot is let go (audio/firecall.js).
 */
export function giveFireOrder(world, by, hold) {
  world.holdFire ??= {};
  world.holdFire[by.corner] = Boolean(hold);
  for (const fighter of world.fighters) if (fighter.corner === by.corner && fighter !== by && hearsOrders(world, fighter)) fighter.holdFire = Boolean(hold);
  world.orderCount = (world.orderCount ?? 0) + 1;
  world.fireSerial ??= {};
  world.fireSerial[by.corner] = world.orderCount;
  // Who gave it (his id): the word is heard from where he stands (audio/firecall.js); nothing in the simulation reads it.
  world.fireBy ??= {};
  world.fireBy[by.corner] = by.id;
  return world.holdFire[by.corner];
}

/** Whether his side's shot is told to hold its fire. */
export function holdingFire(world, corner) {
  return Boolean(world?.holdFire?.[corner]);
}

/** Whether any man of his side who hears him is of the shot (went out with a bow, a crossbow or a gun, groupOf: a sidearm drawn since he still is): the fire order's button shows only then. */
export function hasShot(world, by) {
  return Boolean(world && by) && world.fighters.some((fighter) => fighter.corner === by.corner && fighter !== by && fighter.state !== 'out' && hearsOrders(world, fighter) && groupOf(fighter) === 'shot');
}

/** Every order taken back (leaving play: the side goes its own way). */
export function clearOrders(world) {
  if (!world) return;
  world.commands = {};
  world.groupCommands = {};
  world.orderGroups = {};
  world.holdFire = {};
  for (const fighter of world.fighters) fighter.holdFire = false;
}

/**
 * The places round him, for every other man of his side, as offsets from
 * him ([x, z], fixed in the world, so they do not swing as he turns): the
 * nearest men in the nearest ring, each ring's men in the order they stand
 * round him, so nobody crosses another to get to his place.
 */
function rallyPlaces(world, by, group = 'all') {
  const spec = COMMAND.rally;
  const centre = commandAt(by);
  const men = world.fighters.filter((fighter) => fighter.corner === by.corner && fighter !== by && hearsOrders(world, fighter) && (group === 'all' || groupOf(fighter) === group))
    .map((fighter) => ({ fighter, at: commandAt(fighter) }))
    .sort((a, b) => commandApart(a.at, centre) - commandApart(b.at, centre));
  const places = {};
  let ring = 0;
  while (men.length) {
    const radius = spec.first + ring * spec.gap;
    const room = Math.max(4, Math.floor((2 * Math.PI * radius) / spec.spacing));
    const these = men.splice(0, room);
    const angleOf = (entry) => Math.atan2(entry.at[1] - centre[1], entry.at[0] - centre[0]);
    these.sort((a, b) => angleOf(a) - angleOf(b));
    // Spread evenly round the ring, starting from the first man's own bearing.
    const start = angleOf(these[0]);
    these.forEach((entry, index) => {
      const angle = start + (index / these.length) * 2 * Math.PI;
      places[entry.fighter.id] = [Math.cos(angle) * radius, Math.sin(angle) * radius];
    });
    ring += 1;
  }
  return places;
}

/** The men of his side an order to `group` goes to (who hear him, on foot, not out of the fight), but him. */
function menOf(world, by, group) {
  return world.fighters.filter((fighter) => fighter.corner === by.corner && fighter !== by && fighter.state !== 'out' && !fighter.mount && hearsOrders(world, fighter) && (group === 'all' || groupOf(fighter) === group));
}

/** Whether an order's place for him stands in a shape: drawn up in one (a shape, Formation's places) or on the march. */
const shapedPlace = (command, fighter) => (command.kind === 'form' || ORDER_SHAPES.includes(command.kind)) && Boolean(command.places?.[fighter.id]);

/**
 * Whether there is a formation for To me to keep: any of the men it goes to has his slot in his side's ranks, or a place
 * in a shape he was drawn up in, or is on the march. A loose band has none: they gather round him in rings (rallyPlaces).
 */
function keepsFormation(world, by, group) {
  return menOf(world, by, group).some((fighter) => {
    if (fighter.slot && world.formations?.[fighter.formation]) return true;
    const standing = commandOf(world, fighter);
    return Boolean(standing) && standing.by !== fighter.id && (Boolean(standing.offset) || shapedPlace(standing, fighter));
  });
}

/** Where a man stands in the shape his side is in now ([x, z]): his place on a march or in a shape, his slot in the ranks, or where he is. */
function placeInShape(world, fighter) {
  const standing = commandOf(world, fighter);
  if (standing && standing.by !== fighter.id) {
    if (standing.offset) {
      const place = marchPlace(world, standing, fighter);
      if (place) return place;
    }
    if (shapedPlace(standing, fighter)) return [...standing.places[fighter.id]];
  }
  const formation = fighter.slot ? world.formations?.[fighter.formation] : null;
  return formation ? slotAt(formation, fighter.slot) : commandAt(fighter);
}

/**
 * Start a march (Advance, Fall back, or To me keeping the formation) on its command: every man's place in the shape the
 * side stands in (`base`, by his id), the offset they share (`offset`, none yet), the way to the enemy (`heading`); the
 * formation's anchor where the order goes to its ranks (all, or the foot), moved with the offset (keepOrders). To me
 * (`ref`): the offset is to be his own movement since, so the formation keeps where it stands to him; if he is not at it,
 * with it first brought up along the way to him till its nearest man's place is COMMAND.march.near m from him.
 */
function startMarch(world, by, command) {
  const base = {};
  for (const fighter of menOf(world, by, command.group)) base[fighter.id] = placeInShape(world, fighter);
  command.base = base;
  command.offset = [0, 0];
  const places = Object.values(base);
  const centre = meanOf(places) ?? commandAt(by);
  command.heading = wayToEnemy(world, by.corner, centre) ?? [...command.dir];
  const formation = world.formations?.[by.corner];
  if (formation && (command.group === 'all' || command.group === 'foot')) command.anchor = [...formation.anchor];
  if (command.kind !== 'rally') return;
  const him = commandAt(by);
  let nearest = null;
  for (const place of places) if (!nearest || commandApart(place, him) < commandApart(nearest, him)) nearest = place;
  const apart = nearest ? commandApart(nearest, him) : 0;
  const short = apart > COMMAND.march.near ? 1 - COMMAND.march.near / apart : 0;
  // (The offset is to come to `him now - ref`: nothing, standing at it; the way to him less `near`, from afar.)
  command.ref = nearest ? [him[0] - (him[0] - nearest[0]) * short, him[1] - (him[1] - nearest[1]) * short] : him;
}

/** The mean of some points ([x, z]), or null for none. */
function meanOf(points) {
  if (!points.length) return null;
  let x = 0;
  let z = 0;
  for (const point of points) {
    x += point[0] / points.length;
    z += point[1] / points.length;
  }
  return [x, z];
}

/** The enemy a march goes toward: their men on their feet and fighting, on foot (their horse is not the line), else any. */
function enemyLine(world, corner) {
  const foes = world.fighters.filter((other) => other.corner !== corner && other.corner !== 'grey' && other.state === 'up' && !other.crawling && !other.fled);
  const foot = foes.filter((other) => !other.mount);
  return foot.length ? foot : foes;
}

/** The way ([x, z], a unit) from a point to the middle of the enemy's line, or null with no enemy. */
function wayToEnemy(world, corner, from) {
  const middle = meanOf(enemyLine(world, corner).map(commandAt));
  if (!middle) return null;
  const length = commandApart(middle, from);
  return length > 1e-6 ? [(middle[0] - from[0]) / length, (middle[1] - from[1]) / length] : null;
}

/** His place on the march ([x, z]): his slot where the order moves his formation's anchor, else his place in its shape moved by its offset. */
function marchPlace(world, command, fighter) {
  const formation = command.anchor && fighter.slot ? world.formations?.[fighter.formation] : null;
  if (formation && formation.members.includes(fighter.id)) return slotAt(formation, fighter.slot);
  const base = command.base[fighter.id] ?? (fighter.order?.serial === command.serial ? fighter.order.joined : null);
  return base ? [base[0] + command.offset[0], base[1] + command.offset[1]] : null;
}

/**
 * Once a step, a march's offset moved on: the men on it (those it goes to who can hear it now), how far on the median each is
 * from his place (the dressing: COMMAND.march.dressed), then by the order: Advance and Fall back along the way to the enemy
 * (turned toward it at `turn` rad/s), the advance a charge once its front is within `chargeAt` m of their line, the fall
 * back halted where any man's way back is shut; To me toward where it should stand to him.
 */
function marchOn(world, corner, command, dt) {
  const spec = COMMAND.march;
  const places = [];
  const lags = [];
  for (const fighter of world.fighters) {
    if (fighter.corner !== corner || commandOf(world, fighter) !== command || !orderFor(world, fighter)) continue;
    const place = marchPlace(world, command, fighter);
    if (!place) continue;
    places.push(place);
    lags.push(commandApart(place, commandAt(fighter)));
  }
  if (!places.length || dt <= 0) return;
  lags.sort((a, b) => a - b);
  const lag = lags[Math.floor(lags.length / 2)];
  const dressing = Math.max(0, Math.min(1, (2 * spec.dressed - lag) / spec.dressed));
  if (command.kind === 'rally') {
    const him = commandAt(world.fighters[command.by]);
    const short = [him[0] - command.ref[0] - command.offset[0], him[1] - command.ref[1] - command.offset[1]];
    const distance = Math.hypot(short[0], short[1]);
    if (distance < 1e-6) return;
    const step = Math.min(distance, (distance > spec.runFrom ? spec.run : spec.rallyWalk) * dressing * dt);
    command.offset = [command.offset[0] + (short[0] / distance) * step, command.offset[1] + (short[1] / distance) * step];
    return;
  }
  const centre = meanOf(places);
  const want = wayToEnemy(world, corner, centre);
  if (!want) return;
  command.heading = turnedToward(command.heading, want, spec.turn * dt);
  const heading = command.heading;
  if (command.kind === 'advance') {
    const front = frontOf(world, corner, command, places, centre);
    if (front.gap <= spec.chargeAt) {
      becomeCharge(world, corner, command, centre, front);
      return;
    }
    const step = spec.advance * dressing * dt;
    command.offset = [command.offset[0] + heading[0] * step, command.offset[1] + heading[1] * step];
    return;
  }
  const step = spec.fallBack * dressing * dt;
  if (step <= 0 || places.some((place) => shutBehind(world, place, heading))) return;
  command.offset = [command.offset[0] - heading[0] * step, command.offset[1] - heading[1] * step];
}

/** A unit way turned toward another by at most `most` rad. */
function turnedToward(way, want, most) {
  const angle = Math.atan2(way[0] * want[1] - way[1] * want[0], way[0] * want[0] + way[1] * want[1]);
  const turn = Math.max(-most, Math.min(most, angle));
  const cos = Math.cos(turn);
  const sin = Math.sin(turn);
  return [way[0] * cos - way[1] * sin, way[0] * sin + way[1] * cos];
}

/**
 * The march's front against the enemy, along its heading from the middle of its places: how far ahead its foremost place
 * stands (`ahead`), how wide it is either side (`half`), and the gap from its front to the nearest of the enemy's line
 * ahead of it and no further aside than its width and a charge's run (`gap`, m; Infinity with none).
 */
function frontOf(world, corner, command, places, centre) {
  const heading = command.heading;
  const left = [-heading[1], heading[0]];
  let ahead = -Infinity;
  let half = 0;
  for (const place of places) {
    const offset = [place[0] - centre[0], place[1] - centre[1]];
    ahead = Math.max(ahead, offset[0] * heading[0] + offset[1] * heading[1]);
    half = Math.max(half, Math.abs(offset[0] * left[0] + offset[1] * left[1]));
  }
  let gap = Infinity;
  for (const foe of enemyLine(world, corner)) {
    const offset = [foe.x[P.pelvis * 3] - centre[0], foe.x[P.pelvis * 3 + 2] - centre[1]];
    const along = offset[0] * heading[0] + offset[1] * heading[1];
    if (along < 0 || Math.abs(offset[0] * left[0] + offset[1] * left[1]) > half + COMMAND.march.chargeAt) continue;
    gap = Math.min(gap, along - ahead);
  }
  return { ahead, half, gap };
}

/**
 * The advance become a charge (COMMAND.charge) the way it was going: a new order of the same giver to the same arm. Its
 * point (`at`, where the way in is measured from: inTheWay) set back behind the line's middle far enough that the charge's
 * widening way takes in the enemy before the whole of its front, not only before its middle.
 */
function becomeCharge(world, corner, command, centre, front) {
  const spec = COMMAND.charge;
  const back = Math.max(0, (front.half - spec.width) / spec.spread - Math.max(0, front.gap) - front.ahead);
  world.orderCount = (world.orderCount ?? 0) + 1;
  const charge = {
    kind: 'charge',
    by: command.by,
    at: [centre[0] - command.heading[0] * back, centre[1] - command.heading[1] * back],
    dir: [...command.heading],
    since: world.time,
    serial: world.orderCount,
    group: command.group,
    fromAdvance: command.serial,
  };
  if (command.group === 'all') world.commands[corner] = charge;
  else world.groupCommands[corner][command.group] = charge;
}

/** Whether the way back from a place (away from the enemy, `heading` toward them) is shut a step on: the floor's edge, a house, a wall or a ditch. */
function shutBehind(world, place, heading) {
  const spec = COMMAND.march;
  const to = [place[0] - heading[0] * spec.look, place[1] - heading[1] * spec.look];
  const arena = world.arena;
  if (arena && (Math.abs(to[0]) > arena.halfX - spec.edge || Math.abs(to[1]) > arena.halfZ - spec.edge)) return true;
  const plan = groundPlanOf(world);
  if (plan && !groundOpen(plan, to[0], to[1])) return true;
  return Boolean(arena?.works) && walkingDistance(world, place, to) > spec.look + spec.slack;
}

/** The order this man is to obey now, or null: none, or he is in no state to hear it. His own record of it is fresh for a new order. */
function orderFor(world, fighter) {
  const command = commandOf(world, fighter);
  if (!command || command.by === fighter.id || !hearsOrders(world, fighter)) return null;
  if (!inStateToHear(fighter)) return null;
  if (fighter.order?.serial !== command.serial) {
    const formation = fighter.slot ? world.formations?.[fighter.formation] : null;
    const slot = formation ? slotAt(formation, fighter.slot) : null;
    fighter.order = {
      serial: command.serial,
      // Where the order found him: his ground for a Hold.
      spot: commandAt(fighter),
      ranks: command.kind === 'hold' && Boolean(slot) && commandApart(slot, commandAt(fighter)) < COMMAND.ranksWithin,
      target: null,
      retargetAt: -Infinity,
      halted: false,
      // On the march, a man who was in no state to hear when it was given: his place where he stands now, less the march so far.
      joined: command.offset && !command.base[fighter.id] ? [commandAt(fighter)[0] - command.offset[0], commandAt(fighter)[1] - command.offset[1]] : null,
    };
  }
  return command;
}

/** The order over this man's arm (its own, else his side's), whether or not he hears it. */
const commandOf = (world, fighter) => world.groupCommands?.[fighter.corner]?.[groupOf(fighter)] ?? world.commands?.[fighter.corner];

/** Up and his own master: not broken, crawling away, fled, or on horseback. */
const inStateToHear = (fighter) => fighter.state === 'up' && !fighter.panicked && !fighter.crawling && !fighter.fled && !fighter.mount;

/**
 * Once a step, after the formations have moved: an order whose giver is
 * out of the fight lapses; a held formation's anchor stays put; and a man
 * in the ranks out of them on an order is in the fight, not a pose behind it.
 */
export function keepOrders(world, dt = 0) {
  for (const arms of Object.values(world.groupCommands ?? {})) {
    for (const [group, command] of Object.entries(arms)) {
      const giver = world.fighters[command.by];
      if (!giver || giver.state === 'out') delete arms[group];
    }
  }
  for (const [corner, command] of Object.entries(world.commands ?? {})) {
    const giver = world.fighters[command.by];
    if (!giver || giver.state === 'out') delete world.commands[corner];
  }
  // The march: each standing one's offset moved on (an advance may become a charge).
  for (const [corner, command] of Object.entries(world.commands ?? {})) if (command.offset) marchOn(world, corner, command, dt);
  for (const [corner, arms] of Object.entries(world.groupCommands ?? {})) {
    for (const command of Object.values(arms)) if (command.offset) marchOn(world, corner, command, dt);
  }
  for (const corner of ['red', 'blue']) {
    const formation = world.formations?.[corner];
    if (!formation) continue;
    const command = world.groupCommands?.[corner]?.foot ?? world.commands?.[corner];
    // (On the march, the anchor moved by the march's offset: the ranks go with it, and stand there when it is taken back.)
    if (command?.anchor) formation.anchor = command.offset ? [command.anchor[0] + command.offset[0], command.anchor[1] + command.offset[1]] : [...command.anchor];
    for (const id of formation.members) {
      const fighter = world.fighters[id];
      if (!orderFor(world, fighter) || fighter.order.ranks) continue;
      fighter.inFront = true;
      fighter.shieldPose = null;
    }
  }
}

/** Whether a man is close enough to fight where he stands: within both men's reach, and a little. */
function withinReach(fighter, other) {
  return other.state === 'up' && commandApart(commandAt(fighter), commandAt(other)) < reachOf(fighter) + reachOf(other) + COMMAND.engage;
}

/** Whether an enemy stands in the way a charge was given. */
function inTheWay(command, other) {
  const spec = COMMAND.charge;
  const offset = [other.x[P.pelvis * 3] - command.at[0], other.x[P.pelvis * 3 + 2] - command.at[1]];
  const along = offset[0] * command.dir[0] + offset[1] * command.dir[1];
  const across = Math.abs(offset[0] * -command.dir[1] + offset[1] * command.dir[0]);
  return along > -spec.behind && across < spec.width + Math.max(0, along) * spec.spread;
}

/**
 * The man to fight under the order (ai.js, after his own choice, `chosen`):
 * on a charge, the man already on him if one is, else the nearest enemy in
 * the way given (fewest of his side on him first); otherwise his own choice.
 */
export function orderedFocus(world, fighter, chosen) {
  const command = orderFor(world, fighter);
  if (!command || command.kind !== 'charge' || !chosen) return chosen;
  const record = fighter.order;
  if (withinReach(fighter, chosen)) return chosen;
  const kept = record.target === null ? null : world.fighters[record.target];
  const fresh = kept && kept.state === 'up' && !kept.crawling;
  if (!fresh || world.time >= record.retargetAt) {
    record.retargetAt = world.time + COMMAND.charge.retargetEvery;
    const crowds = new Map();
    for (const mate of world.fighters) if (mate !== fighter && mate.corner === fighter.corner && mate.order?.serial === record.serial && mate.order.target !== null) crowds.set(mate.order.target, (crowds.get(mate.order.target) ?? 0) + 1);
    const me = commandAt(fighter);
    let best = null;
    let bestScore = Infinity;
    for (const other of world.fighters) {
      if (other.corner === fighter.corner || other.state !== 'up' || other.crawling || !inTheWay(command, other)) continue;
      const score = commandApart(me, commandAt(other)) + 0.7 * (crowds.get(other.id) ?? 0);
      if (score < bestScore) {
        best = other;
        bestScore = score;
      }
    }
    record.target = best?.id ?? null;
  }
  const target = record.target === null ? null : world.fighters[record.target];
  // Nobody left in the way: he halts where he got to and holds there.
  if (!target) {
    if (!record.halted) record.spot = commandAt(fighter);
    record.halted = true;
    return chosen;
  }
  record.halted = false;
  fighter.focus = target.id;
  return target;
}

/**
 * What the order has him do this tick (ai.js, before his place in the
 * ranks): 'obeyed' (it has set his footwork: nothing more to decide),
 * 'fight' (fight the man before him in the ordinary way, out of the ranks)
 * or null (no order he hears, or one that leaves him to his ranks).
 */
export function obeyOrder(world, fighter, opponent, style, dt) {
  const command = orderFor(world, fighter);
  if (!command || !opponent) return null;
  const record = fighter.order;
  if (fighter.clinch || fighter.pin || fighter.pickup) return 'fight';
  if (command.kind === 'hold' && record.ranks) return null;
  if (command.kind === 'charge' && !record.halted) {
    // A loaded shooter shoots his way in (the ordinary gunfight); anyone else runs at his man, then fights him.
    const weapon = fighter.weapon;
    if (style.ranged && weapon?.held && weapon.spec.ranged && !weapon.spent) return 'fight';
    const apart = commandApart(commandAt(fighter), commandAt(opponent));
    if (opponent.state !== 'up' || apart < reachOf(fighter) + reachOf(opponent) + COMMAND.charge.runFrom) return 'fight';
    fighter.goTo = null;
    fighter.move = 1;
    fighter.running = true;
    fighter.strafe = 0;
    return 'obeyed';
  }
  // A place to keep: round him (To me), or his own ground (Hold, or a charge run out of men).
  const place = placeFor(world, command, fighter);
  if (!place) return null;
  const away = commandApart(place, commandAt(fighter));
  if (withinReach(fighter, opponent) && away < COMMAND.leash) return 'fight';
  goToPlace(fighter, place, opponent);
  if (away < COMMAND.turnFrom) shootFromPlace(world, fighter, opponent, style);
  return 'obeyed';
}

/** Whether the order, not his place in the ranks or his standard, decides where he stands (ai.js keepPlace). */
export function orderKeepsPlace(world, fighter) {
  const command = orderFor(world, fighter);
  return Boolean(command) && !(command.kind === 'hold' && fighter.order.ranks);
}

/** His place under the order ([x, z]): on the march, his place in its shape moved on; his ring's place round the giver, his place in the formation, or his own ground. */
function placeFor(world, command, fighter) {
  if (command.offset) return marchPlace(world, command, fighter);
  if (command.kind === 'form' || ORDER_SHAPES.includes(command.kind)) return command.places[fighter.id] ?? null;
  if (command.kind === 'rally') {
    const offset = command.places[fighter.id];
    if (!offset) return null;
    const centre = commandAt(world.fighters[command.by]);
    return [centre[0] + offset[0], centre[1] + offset[1]];
  }
  return fighter.order.spot;
}

/**
 * Footwork to a place: from far, turned to it and walking (running from
 * further); near, stepping there still facing his man; there, standing.
 */
function goToPlace(fighter, place, opponent) {
  const me = commandAt(fighter);
  const offset = [place[0] - me[0], place[1] - me[1]];
  const distance = Math.hypot(offset[0], offset[1]);
  fighter.running = false;
  if (distance < COMMAND.arrive) {
    fighter.goTo = null;
    fighter.move = 0;
    fighter.strafe = 0;
    return;
  }
  if (distance > COMMAND.turnFrom || !opponent) {
    fighter.goTo = [place[0], 0, place[1]];
    fighter.move = 1;
    fighter.strafe = 0;
    fighter.running = distance > COMMAND.runFrom;
    return;
  }
  fighter.goTo = null;
  const him = commandAt(opponent);
  const line = [him[0] - me[0], him[1] - me[1]];
  const length = Math.hypot(line[0], line[1]) || 1;
  const forward = [line[0] / length, line[1] / length];
  const left = [-forward[1], forward[0]];
  const clamp = (value) => Math.max(-1, Math.min(1, value));
  fighter.move = clamp((offset[0] * forward[0] + offset[1] * forward[1]) / COMMAND.steer);
  fighter.strafe = clamp((offset[0] * left[0] + offset[1] * left[1]) / COMMAND.steer);
}

/** A shooter at his place shoots from it (or spans again), as a man in the ranks does; nobody near him yet. */
function shootFromPlace(world, fighter, opponent, style) {
  const weapon = fighter.weapon;
  const gun = style.ranged && weapon?.held && weapon.spec.ranged && !weapon.spent ? style.ranged : null;
  if (!gun || opponent.state !== 'up') return;
  if (weapon.spec.shot && !weapon.loaded) {
    fighter.reloading = true;
    return;
  }
  fighter.reloading = false;
  if (fighter.punch || fighter.cooldown > 0) return;
  fighter.aimAt = opponent.id;
  const zone = world.random() < gun.headShare ? 'head' : 'body';
  if (throwPunch(world, fighter, gun.move ?? 'shoot', zone)) {
    fighter.punch.quick = true;
    fighter.cooldown = gun.between[0] + world.random() * gun.between[1];
  }
}
