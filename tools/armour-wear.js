// Repeated blows at one spot on a standing, unresisting man in a kit: how many of a weapon move it takes for his armour there
// to loosen, open a hole and drop a piece (physics/armourwear.js). Calibrates ARMOUR_WEAR.
// Usage: node tools/armour-wear.js [outfit] [style] [move] [zone] [distance] [blows]

import { PRESETS } from '../src/body.js';
import { MOVES } from '../src/moves.js';
import { advance, createWorld, placeFighter, placeOnFloor, throwPunch } from '../src/physics.js';

/**
 * `blows` of one move at one man, each from the same place after he is set back on his feet as he stood: the stages his armour
 * reached and at which blow (`stages`: [{ blow, piece, spot, stage }]), the falls, and each blow's landing (part, energy).
 */
export function repeatedBlows(outfit, style, move, zone, { distance = 1.5, blows = 20, design = 0, seed = 1, defender = 'contender', defenderStyle = 'boxing', turn = 0 } = {}) {
  const stages = [];
  const landings = [];
  let wear = null;
  let last = null;
  for (let blow = 1; blow <= blows; blow += 1) {
    // (Each blow in a world of its own, the man fresh but for his armour's wear: the same blow lands where the last did.)
    const world = createWorld([{ ...PRESETS.contender, style }, { ...PRESETS[defender], style: defenderStyle, outfit: { kind: outfit, design }, accessories: [] }], { seed });
    const [attacker, target] = world.fighters;
    placeFighter(attacker, -distance / 2, 0);
    placeFighter(target, distance / 2, 0);
    // (Turned from his man by `turn` rad: his flank to the blow, the shoulder guard or a side panel of the skirt.)
    if (turn) placeOnFloor(target, distance / 2, 0, 0, target.yaw + turn);
    advance(world, 0.8);
    target.armourWear = wear;
    world.events.length = 0;
    throwPunch(world, attacker, move, zone);
    advance(world, MOVES[move].duration + 0.2);
    wear = target.armourWear;
    const hit = world.events.find((event) => event.attacker === attacker.id && (event.kind === 'landed' || event.kind === 'blocked'));
    landings.push(hit ? { target: hit.target, energy: Math.round(hit.energy), gap: hit.gapZone, cut: Math.round(hit.cut ?? 0) } : null);
    for (const event of world.events) {
      if (event.kind === 'armourWear' || event.kind === 'armourFell') stages.push({ blow, piece: event.piece, spot: event.spot, stage: event.kind === 'armourFell' ? 'fell' : event.stage });
    }
    last = { world, target };
  }
  return { stages, landings, wear, ...last };
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const [outfit = 'oyoroi', style = 'katana', move = 'kesagiri', zone = 'body', distance = '1.5', blows = '20'] = process.argv.slice(2);
  const { stages, landings } = repeatedBlows(outfit, style, move, zone, { distance: Number(distance), blows: Number(blows) });
  console.log(landings.map((hit, index) => `${index + 1}:${hit ? `${hit.target} ${hit.energy}J cut ${hit.cut}${hit.gap ? ` (${hit.gap})` : ''}` : 'miss'}`).join('  '));
  for (const stage of stages) console.log(`blow ${stage.blow}: ${stage.piece ?? stage.spot} ${stage.stage}`);
}
