// Port groundwork (a native port later, the user's call, 2026-11-26): the fights the determinism check (tools/determinism.js)
// and the behaviour oracle (tools/oracle.js) set up, headless, as the game sets them up. Each returns a fresh world; nothing is
// stepped here. Not part of the game.
//
// - duel(red, blue, seed): two roster warriors (roster.js WARRIORS keys), as the ratings and tools/gaps.js fight them.
// - kitDuel({ style, outfit }, { style, outfit }, seed, body): one reference body (a roster warrior's inputs) in each corner
//   with the style (weapon) and outfit (armour) given: the weapon x armour matrix, everything else held the same.
// - team(keys red, keys blue, seed): a small team fight of roster warriors.
// - scaledBattle(key, men, seed): a battle's own cast, each side grown to half of `men` (tools/tableduel.js's, copied here so
//   importing it does not read this process's arguments: that tool reads process.argv when imported).
// - custom(men, seed): a custom battle on the open field of `men` in all, as main.js fights one: the setup screen's first
//   factions and units, drawn up as the level, `world.largeBattle` set past CUSTOM_BATTLE.tableFrom (the table on), the lead
//   played (`world.perceiver`).

import { normaliseInputs } from '../src/body.js';
import { createWorld, seededRandom } from '../src/physics.js';
import { battleOf } from '../src/scenarios.js';
import { WARRIORS } from '../src/roster.js';
import { CUSTOM_BATTLE, customLevel, customSetup, customUnitsOf, settleBattle } from '../src/custombattle.js';
import { drawUp, leadOf, musterLevel } from '../src/muster.js';

export const WARRIOR = new Map(WARRIORS.map((warrior) => [warrior.key, warrior.inputs]));

function inputsOf(key) {
  const inputs = WARRIOR.get(key);
  if (!inputs) throw new Error(`no roster warrior '${key}'`);
  return structuredClone(inputs);
}

export function duel(red, blue, seed) {
  return createWorld([{ inputs: inputsOf(red), corner: 'red' }, { inputs: inputsOf(blue), corner: 'blue' }], { seed });
}

/** A reference body with a kit: the style's weapon and the outfit's armour, its colours and look left as the outfit's own. */
export function kitted(body, { style, outfit }) {
  const inputs = inputsOf(body);
  inputs.style = style;
  inputs.outfit = { kind: outfit };
  return inputs;
}

export function kitDuel(red, blue, seed, body = 'plate') {
  return createWorld([{ inputs: kitted(body, red), corner: 'red' }, { inputs: kitted(body, blue), corner: 'blue' }], { seed });
}

export function team(red, blue, seed) {
  return createWorld([...red.map((key) => ({ inputs: inputsOf(key), corner: 'red' })), ...blue.map((key) => ({ inputs: inputsOf(key), corner: 'blue' }))], { seed });
}

/** The battle's own cast, each side grown to half of `men` (its men repeated in order), on a floor and in lines grown to match. */
export function scaledBattle(key, men, seed) {
  const level = battleOf(key);
  const sides = level.cast(seededRandom(seed));
  const per = Math.ceil(men / 2);
  const grow = (list) => Array.from({ length: per }, (_, index) => list[index % list.length]);
  const entries = [...grow(sides.red).map((inputs) => ({ inputs, corner: 'red' })), ...grow(sides.blue).map((inputs) => ({ inputs, corner: 'blue' }))]
    .map(({ inputs, corner }) => ({ inputs: normaliseInputs(structuredClone(inputs)), corner }));
  const scale = Math.max(1, Math.sqrt(men / 60));
  const formation = Object.fromEntries(['red', 'blue'].map((corner) => [corner, { ...level.formation[corner], perRow: Math.round((level.formation[corner]?.perRow ?? 8) * scale) }]));
  const world = createWorld(entries, { seed, arena: { ...level.arena, halfX: level.arena.halfX * scale, halfZ: level.arena.halfZ * scale }, formation, rules: level.rules, place: level.scene, climate: level.climate });
  // The man played: the last of red's men, at the back (tools/tableduel.js: so the fight goes on being perceived from him).
  world.perceiver = world.fighters.filter((fighter) => fighter.corner === 'red').at(-1).id;
  return world;
}

/** A custom battle of `men` in all on the open field, each side the first factions' first kinds on foot in equal shares. */
export function custom(men, seed) {
  const { map, factions, kinds } = CUSTOM_BATTLE.first;
  const per = Math.floor(men / 2);
  const empty = customLevel({ map, factions, sides: { red: { men: [] }, blue: { men: [] } } });
  const sides = {};
  for (const corner of ['red', 'blue']) {
    const units = customUnitsOf(factions[corner]).filter((unit) => !unit.mounted).slice(0, kinds);
    const picked = Array.from({ length: per }, (_, index) => units[index % units.length]);
    const places = drawUp(empty, corner, picked.map((unit) => unit.make()), 'level');
    sides[corner] = { men: picked.map((unit, index) => ({ unit: unit.id, at: places[index] })), formation: 'level' };
  }
  const battle = settleBattle({ map, factions, sides, lead: { corner: 'red', index: 0 } });
  const level = musterLevel(customLevel(battle), customSetup(battle));
  const cast = level.cast();
  const entries = [...cast.red.map((inputs) => ({ inputs, corner: 'red' })), ...cast.blue.map((inputs) => ({ inputs, corner: 'blue' }))];
  const world = createWorld(entries, { seed, arena: level.arena, rules: level.rules, formation: level.formation, place: level.scene, climate: level.climate, general: { corner: 'red', index: 0 } });
  world.largeBattle = world.fighters.length > CUSTOM_BATTLE.tableFrom;
  world.perceiver = leadOf(world.fighters, 'red', 0).id;
  return world;
}
