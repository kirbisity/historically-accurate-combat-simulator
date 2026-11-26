// The simulation's boundary (port groundwork: the simulation as a clean reference for a native port, the user's call,
// 2026-11-26). Everything the fight takes from outside comes in here, as data, at a step; nothing in it reads the page, the
// camera, the keys or the clock. The page (main.js) gathers a step's command, hands it over and draws what comes out.
//
// - createSim(setup): a bout's world from its setup, plain data (who fights, the seed, the place or the battle's key and its
//   muster): what a replay needs to make the same world again.
// - stepSim(world, command, orders, hooks): one fixed step (SIM_STEP, 1/60 s): the command applied, the AI's think, the
//   player's orders carried out, then the physics' step. A command (newCommand) holds the man played, the camera's view
//   (single-player perception stays the camera's, the user's call, 2026-11-26: it enters here, recorded, never read from the
//   page), the detail share of a big battle (load shedding, from the page's measured step cost: recorded the same way), the
//   modes' holds (a story scene's figures, the sandbox's stand-still side) and the inputs the player's steering is made of
//   (the keys held as directions, the camera's floor axes, the run's throttle).
// - applyAction(world, action, orders): what the player does between steps (a defence, a side's order, a crawl, walk mode, a
//   level's item or rest, the respawn behind the death screen's fade), applied at once and recorded with the step it came
//   before, so a replay applies it at the same point.
// - The outputs are queues the page drains: world.events (blows, deaths: main.js consumeEvents), the sound log (audio/log.js),
//   level mode's UI messages (levelmode/level.js drainUi, drainRebuilds).
// - createRecorder / replayRecording: a bout's setup and its stream of orders, actions and steps, and the world made again
//   from them headless, hashed step by step (worldHash) against the recording's own (test/simreplay.test.js,
//   tools/replay.js).
//
// What stays outside, as hooks the page passes in (not replayed headless): the training yard's partner (main.js yardStep)
// and a story scene's own staging (story/storyview.js think). The stage of level mode, the Last Stand Squad's waves and the
// rest are simulation modules and run here.

import { thinkAll } from './ai.js';
import { CUSTOM_BATTLE, customLevel } from './custombattle.js';
import { breakRun, directFighter, keyStick, playerCrawl, swingAt, toggleCrawl } from './control.js';
import { chooseGroup, clearOrders, giveFireOrder, giveOrder } from './command.js';
import { stepLastGate } from './lastgate.js';
import { holdPlayer } from './levelmode/items.js';
import { interact, levelBusy, levelThink, respawnPlayer, useItem } from './levelmode/level.js';
import { updateStage } from './levelmode/stage.js';
import { musterLevel } from './muster.js';
import { P } from './body.js';
import { createWorld, perform, startJump, step } from './physics.js';
import { preferredWalk } from './physics/gait.js';
import { PLACE_ARENAS } from './props/arenasize.js';
import { battleOf } from './scenarios.js';
import { easeFor } from './story/scenes/stage.js';

/** The simulation's one step (s): every step is this long (main.js tick, the tools, a replay). */
export const SIM_STEP = 1 / 60;

/** A recording's format: the fields of createSim's setup, the command and the stream (bumped when one changes meaning). */
export const SIM_RECORDING_VERSION = 1;

// ---- The world from its setup ------------------------------------------------

/** A battle by its key (scenarios.js battleOf); the custom battle's is made of its muster's battle (custombattle.js). */
export function simBattleNamed(key, muster) {
  return key === CUSTOM_BATTLE.key ? customLevel(muster.battle) : battleOf(key);
}

/** The level a bout fights (null in the sandbox's ring): the battle, as mustered if it was (muster.js). */
export function simLevel(setup) {
  if (!setup.scenario) return null;
  const level = simBattleNamed(setup.scenario, setup.muster);
  return setup.muster ? musterLevel(level, setup.muster) : level;
}

/**
 * A bout's world from its setup: `entries` (each { inputs, corner }, as createWorld takes them), `seed`, `place`, the
 * battle's key `scenario` and its `muster` (or none), `general` (the man played's corner and index in a battle), and whether
 * the bout is played with the battle's large-battle tiers (`largeBattle`, worked out here when not given: a custom battle of
 * more than CUSTOM_BATTLE.tableFrom men). Returns the world; the level it was made from is `simLevel(setup)`.
 */
export function createSim(setup, level = simLevel(setup)) {
  const arena = level?.arena ?? PLACE_ARENAS[setup.place];
  const world = createWorld(setup.entries, { seed: setup.seed, arena, rules: level?.rules, formation: level?.formation, place: setup.place, climate: level?.climate, general: setup.general ?? null });
  world.largeBattle = setup.largeBattle ?? (Boolean(level?.custom) && world.fighters.length > CUSTOM_BATTLE.tableFrom);
  return world;
}

// ---- A step's command ----------------------------------------------------------

/**
 * What a step takes from outside, all of it (fields left at these values mean none):
 * - `mode`: the game it is ('intro' thinks for nobody, 'tutorial' has the yard's partner, 'story' its scenes' holds);
 * - `player`: the id of the man played, or null (watching);
 * - `autopilot`: the AI plays the man played (a trailer's capture);
 * - `view`: what the camera takes in on the floor, { eye: [x, z], ahead: [x, z], half (rad) } (ai.js AI.perceive), or null;
 * - `detailShare`: a big battle's share of its circle of men in full (detailload.js), or undefined to leave it;
 * - `held`: the ids a story scene holds where it put them (they think nothing);
 * - `standStill`: the sandbox's still side ('red', 'blue', 'crawl:red'...), or '';
 * - `scene`: the man played is a story scene's (it poses him: the hook `scene`);
 * - `stick`: the movement keys as the player's stick: { keys: the keys held (control.js MOVE_KEYS), axes: the camera's floor
 *   axes { ahead, right }, running: Shift held, throttle: the run's throttle (control.js keyThrottle of how long it is held) };
 * - `walk`: walk mode's steering: { keys: the keys held (WALK_KEYS), look: the camera's look on the floor [x, z], running }.
 */
export function newCommand() {
  return { mode: null, player: null, autopilot: false, view: null, detailShare: undefined, held: [], standStill: '', scene: false, stick: null, walk: null };
}

// Walk mode's keys: [ahead, left] on the screen.
export const WALK_KEYS = { w: [1, 0], arrowup: [1, 0], s: [-1, 0], arrowdown: [-1, 0], a: [0, 1], arrowleft: [0, 1], d: [0, -1], arrowright: [0, -1] };

/** Steer the walking player: the held directions, taken from where the camera looks (`walk.look`); facing the way he goes. */
export function walkAbout(world, fighter, walk) {
  if (!fighter.walking) return;
  const look = walk.look;
  const length = Math.hypot(look[0], look[1]);
  // A camera straight overhead (or not yet placed) gives no heading: then his own facing does.
  const ahead = length > 1e-3 ? [look[0] / length, look[1] / length] : [Math.cos(fighter.yaw), -Math.sin(fighter.yaw)];
  // Left of the camera's view on the floor.
  const left = [ahead[1], -ahead[0]];
  let along = 0;
  let across = 0;
  for (const key of walk.keys) {
    const [forward, side] = WALK_KEYS[key] ?? [0, 0];
    along += forward;
    across += side;
  }
  const pelvis = [fighter.x[P.pelvis * 3], fighter.x[P.pelvis * 3 + 2]];
  fighter.strafe = 0;
  // Walking about a story place (main.js enterStoryRoam: nobody there is fighting), he stands and walks at ease as the
  // scenes' men do (story/scenes/stage.js easeFor): standing, the hands down and the feet side by side; walking, the
  // arms to the stride. Out of the crouch of the guard, a man standing still in built shade is not read as hanging in the air.
  const atEase = Boolean(world.roam);
  if (!along && !across) {
    // Standing: keep the way he faces.
    if (atEase) fighter.ease = easeFor(fighter, { time: world.time });
    fighter.move = 0;
    fighter.walkSpeed = null;
    fighter.goTo = [pelvis[0] + Math.cos(fighter.yaw) * 3, 0, pelvis[1] - Math.sin(fighter.yaw) * 3];
    return;
  }
  const way = [ahead[0] * along + left[0] * across, ahead[1] * along + left[1] * across];
  const size = Math.hypot(way[0], way[1]);
  // Opposite keys held together cancel out: he stands.
  if (size < 1e-6) {
    fighter.move = 0;
    return;
  }
  if (atEase) fighter.ease = easeFor(fighter, { walking: true });
  fighter.goTo = [pelvis[0] + (way[0] / size) * 3, 0, pelvis[1] + (way[1] / size) * 3];
  fighter.move = 1;
  fighter.running = walk.running && !fighter.crawling;
  fighter.runMode = fighter.running;
  // (Walking, his own easy walk: physics/gait.js preferredWalk.)
  fighter.walkSpeed = fighter.running || fighter.crawling ? null : preferredWalk(fighter);
}

/** Into walk mode, or back into the fight (the guard up, the footwork the style's). */
export function walkMode(world, fighter, on) {
  fighter.walking = on;
  if (on) return;
  // (Back on guard: the ease a story place's walk gave him is let go.)
  if (world.roam) fighter.ease = undefined;
  fighter.goTo = null;
  fighter.move = 0;
  fighter.running = false;
  fighter.runMode = false;
  fighter.walkSpeed = null;
}

/**
 * The command applied and every man thought for, for one step of `dt`: level mode's stage and the player's own systems, who
 * is played and seen, the modes' holds, the AI, then the man played as his orders (`orders`, control.js newOrders: the
 * player's control state, carried from step to step) or walk mode say. `hooks` are the page's own modes: `yardPartner(world)`
 * and `yardStep(world, partner)` (the training yard), `scene(world)` (a story scene poses the man played), `moved()` (the
 * movement keys steered him, for the tutorial).
 */
export function thinkStep(world, command, orders, dt, hooks = {}) {
  // (A big battle's detail share first, as the page's measure of the last frame's steps left it: detailload.js.)
  if (command.detailShare !== undefined) world.detailShare = command.detailShare;
  // A level-mode stage: the sections around the player awake, the rest dormant (levelmode/stage.js); then his own
  // systems (levelmode/level.js): an action in hand, tonics at work, a death, the boss's second phase.
  if (world.stage) {
    updateStage(world);
    if (world.stage.level) levelThink(world, dt);
  }
  // The intro's legends stand in their guard: nobody to fight.
  if (command.mode === 'intro') return;
  const played = command.player === null ? null : world.fighters[command.player] ?? null;
  const players = played ? new Set([played.id]) : new Set();
  // The one you play is simulated in full however big the fight; the men you can see deciding are thought for in full
  // (ai.js AI.perceive: him and the camera's view).
  world.keepFull = new Set(players);
  world.perceiver = played ? played.id : undefined;
  world.view = played ? command.view : null;
  // The man played has the stamina overdraft (physics/overdraft.js); an AI fighter never does.
  for (const fighter of world.fighters) if (Boolean(fighter.player) !== players.has(fighter.id)) fighter.player = players.has(fighter.id);
  // Standing still: no thinking at all; he stays where he is, guard down, and takes what comes.
  // (Trailer capture: boxer.autopilot(true) lets the fight AI play the player's man, the HUD and camera as in play.)
  const still = new Set(command.autopilot ? [] : players);
  // A story scene's figures (src/story/scenes/stage.js): held where the scene puts them, posed by it.
  for (const id of command.held) still.add(id);
  // Crawling (the sandbox's look at it): that side down on its knees, still in the fight; the player's man as he chooses.
  const crawlSide = command.standStill.startsWith('crawl:') ? command.standStill.slice(6) : null;
  for (const fighter of world.fighters) {
    if (players.has(fighter.id)) continue;
    if (fighter.corner === crawlSide && !fighter.crawling) playerCrawl(world, fighter, true);
    else if (fighter.corner !== crawlSide && fighter.crawlChosen) playerCrawl(world, fighter, false);
  }
  if (command.standStill && !crawlSide) {
    for (const fighter of world.fighters) {
      if (fighter.corner !== command.standStill || players.has(fighter.id)) continue;
      still.add(fighter.id);
      world.keepFull.add(fighter.id);
      Object.assign(fighter, { move: 0, strafe: 0, running: false, goTo: null, defence: null, rush: null });
    }
  }
  // The training partner thinks nothing: he stands, and swings only when the tutorial says.
  if (command.mode === 'tutorial') {
    const partner = hooks.yardPartner?.(world) ?? null;
    if (partner) {
      still.add(partner.id);
      world.keepFull.add(partner.id);
      hooks.yardStep(world, partner);
    }
  }
  // Last Stand Squad: the foes walked at the squad, the squad kept at its places, the waves (lastgate.js).
  if (world.lastGate) stepLastGate(world, dt, { playerId: played ? played.id : null });
  thinkAll(world, dt, still);
  if (!played) return;
  // At a bandage, a change of harness, a stoop for a weapon: he stands where he is.
  if (world.stage?.level && levelBusy(world)) {
    played.runMode = false;
    played.walkSpeed = null;
    holdPlayer(played);
  }
  // A story scene: he is the scene's (src/story/scenes/stage.js poses him), not the player's.
  else if (command.scene) {
    // (The player's chosen walk is not the scene's.)
    played.walkSpeed = null;
    hooks.scene?.(world);
  }
  // Walking about (V), the keys steer him; otherwise he does as the orders say.
  else if (played.walking) {
    walkAbout(world, played, command.walk);
    // (Walking about, a jump asked for is still his: the orders are not carried out in walk mode.)
    if (orders.jump) {
      orders.jump = false;
      startJump(world, played);
    }
  }
  else {
    // The movement keys: a stick, the way the camera looks.
    // (Shift is a pedal: the run's throttle grows as it is held, control.js keyThrottle.)
    const { keys, axes, running, throttle } = command.stick;
    orders.keyStick = keyStick(keys, axes, running, throttle);
    if (orders.keyStick) hooks.moved?.();
    directFighter(world, played, orders, dt);
  }
}

/** One step: the command (thinkStep), then the physics (physics.js step), SIM_STEP long. */
export function stepSim(world, command, orders, hooks = {}) {
  thinkStep(world, command, orders, SIM_STEP, hooks);
  step(world, SIM_STEP);
}

// ---- What the player does between steps -------------------------------------------

/**
 * The player's actions between steps, by kind: each takes the world, the action (plain data: ids, names, numbers) and the
 * player's orders, and returns what the call it makes returns (a side's order says where its charge goes, for the arrow drawn).
 */
export const SIM_ACTIONS = {
  // A defence or other move from a key (main.js command).
  perform: (world, { fighter, move }) => perform(world, world.fighters[fighter], move),
  // A blow from a key, at a zone.
  swing: (world, { fighter, move, zone }, orders) => swingAt(world, world.fighters[fighter], orders, move, zone),
  // A defence from a key stops a run (control.js breakRun: the orders only).
  breakRun: (world, action, orders) => breakRun(orders),
  // Down to crawl, or up (control.js toggleCrawl: refused while locked on).
  crawl: (world, { fighter }, orders) => toggleCrawl(world, world.fighters[fighter], orders),
  // Walk mode on or off (V).
  walking: (world, { fighter, on }) => walkMode(world, world.fighters[fighter], on),
  // Every key let go (the window lost the focus): he stops.
  stop: (world, { fighter }) => { world.fighters[fighter].move = 0; },
  // An order to the side (command.js giveOrder: `dir` the way a charge goes, `group` the arm).
  order: (world, { fighter, order, dir, group }) => giveOrder(world, world.fighters[fighter], order, { dir, group }),
  // Hold fire, or fire at will (command.js giveFireOrder).
  fire: (world, { fighter, hold }) => giveFireOrder(world, world.fighters[fighter], hold),
  // The arm the orders go to (command.js chooseGroup).
  group: (world, { fighter, step: by }) => chooseGroup(world, world.fighters[fighter], by),
  // Orders given while playing taken back (watching again).
  clearOrders: (world) => clearOrders(world),
  // Level mode: a bandage or a tonic, the thing at hand, waking at the last rest behind the death screen's fade.
  item: (world, { item }) => useItem(world, item),
  interact: (world) => interact(world),
  respawn: (world) => respawnPlayer(world),
};

/** Apply one of the player's actions (SIM_ACTIONS) to the world now; what it returns. */
export function applyAction(world, action, orders) {
  const apply = SIM_ACTIONS[action.kind];
  if (!apply) throw new Error(`sim.js applyAction: no action '${action.kind}'`);
  return apply(world, action, orders);
}

// ---- The world's hash ------------------------------------------------------------

const hashBits = new Float64Array(1);
const hashWords = new Uint32Array(hashBits.buffer);

/**
 * The world as numbers, bit for bit, hashed (FNV-1a over 32-bit words): every man's points and last points, his state and
 * health, the events' count, the step count and the generator's state. Equal hashes, the same fight to the last bit (as far as
 * a hash can say); tools/determinism.js's own hash is the same idea with its draw count.
 */
export function worldHash(world) {
  let value = 2166136261;
  const word = (number) => {
    value ^= number >>> 0;
    value = Math.imul(value, 16777619) >>> 0;
  };
  const float = (number) => {
    hashBits[0] = number;
    word(hashWords[0]);
    word(hashWords[1]);
  };
  for (const fighter of world.fighters) {
    for (const coordinate of fighter.x) float(coordinate);
    for (const coordinate of fighter.prev) float(coordinate);
    for (const char of String(fighter.state)) word(char.charCodeAt(0));
    float(fighter.health ?? 0);
  }
  word(world.events.length);
  word(world.steps ?? 0);
  word(world.rng?.state ?? 0);
  return value.toString(16).padStart(8, '0');
}

// ---- Recording and replay ---------------------------------------------------------

/** A command's fields that differ from the last one's (JSON-equal fields left out): what a recording keeps per step. */
function commandChange(last, next) {
  const change = {};
  for (const key of Object.keys(next)) if (JSON.stringify(next[key]) !== JSON.stringify(last?.[key])) change[key] = next[key] === undefined ? null : next[key];
  return change;
}

/**
 * A recording of a bout from its making: `setup` (createSim's), then a stream of what reached the world, in order:
 * `{ o: orders }` the player's orders when they changed outside the world's own steps (a key, a tap; a whole copy),
 * `{ a: action }` an action (applyAction), `{ s: change }` a step with the command's changed fields, and every
 * `hashEvery` steps (and as the world is made, given `world`, and on `finish`) `{ h: worldHash }`. `orders()` reads the page's
 * orders object as it is now.
 */
export function createRecorder(setup, { orders, world = null, hashEvery = 60 } = {}) {
  // (The world as made, first: a replay that parts here was made otherwise.)
  const stream = world ? [{ h: worldHash(world) }] : [];
  let expected = null;
  let lastCommand = newCommand();
  let steps = 0;
  const noteOrders = () => {
    const now = JSON.stringify(orders());
    if (now !== expected) stream.push({ o: JSON.parse(now) });
  };
  const settle = () => {
    expected = JSON.stringify(orders());
  };
  return {
    action(action) {
      noteOrders();
      stream.push({ a: structuredClone(action) });
    },
    actionDone: settle,
    step(command) {
      noteOrders();
      stream.push({ s: commandChange(lastCommand, command) });
      lastCommand = structuredClone(command);
    },
    stepDone(world) {
      settle();
      steps += 1;
      if (steps % hashEvery === 0) stream.push({ h: worldHash(world) });
    },
    get steps() { return steps; },
    finish(world) {
      return { version: SIM_RECORDING_VERSION, setup: structuredClone(setup), steps, hash: worldHash(world), stream };
    },
  };
}

/** The orders object made to read as `from` (its own keys gone or replaced): what the page's orders were then. */
function restoreOrders(orders, from) {
  for (const key of Object.keys(orders)) if (!(key in from)) delete orders[key];
  Object.assign(orders, structuredClone(from));
}

/**
 * A recording fought again headless: the world made from its setup, the stream applied in order. Returns the world and the
 * hashes compared ({ step, recorded, replayed } for each that parts), so a replay that agrees has `parted` empty.
 * `newOrders` makes the player's starting orders (control.js newOrders).
 */
export function replayRecording(recording, { newOrders, onStep = null } = {}) {
  if (recording.version !== SIM_RECORDING_VERSION) throw new Error(`replayRecording: recording version ${recording.version}, this build reads ${SIM_RECORDING_VERSION}`);
  if (['tutorial', 'story'].includes(recording.setup.mode)) throw new Error(`replayRecording: a ${recording.setup.mode} bout needs its page's hooks`);
  const world = createSim(recording.setup);
  const orders = newOrders();
  const parted = [];
  let command = newCommand();
  let steps = 0;
  for (const entry of recording.stream) {
    if (entry.o) restoreOrders(orders, entry.o);
    else if (entry.a) applyAction(world, entry.a, orders);
    else if (entry.s) {
      command = { ...command, ...structuredClone(entry.s) };
      if (command.detailShare === null) command.detailShare = undefined;
      stepSim(world, command, orders);
      steps += 1;
      onStep?.(world, steps);
    } else if (entry.h) {
      const replayed = worldHash(world);
      if (replayed !== entry.h) parted.push({ step: steps, recorded: entry.h, replayed });
    }
  }
  const hash = worldHash(world);
  if (hash !== recording.hash) parted.push({ step: steps, recorded: recording.hash, replayed: hash });
  return { world, steps, hash, parted };
}
