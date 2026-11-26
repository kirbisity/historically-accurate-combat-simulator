// Wear: weapons and shields are worn by what they meet, and break. An edge dulls on what is harder than flesh (armour, another
// edge), and a dull edge is a wider one, that cuts less of a blow and lands the rest as the flat. A metal blade bends or snaps
// under a blow across it past its strength, or once enough lesser blows have worked it to a crack. A wooden shaft snaps when
// its point is stopped harder than it can carry (the set spear's brace figure, WORLD.mount.brace.shaft) or when a blow across
// it bends it past its strength, and is hacked through by edges. A shield's board splits under enough hacking. What each
// part can take is its material's (weapons.js MATERIALS), scaled by its size and scattered from one piece to the next as a
// material's strength is (a Weibull spread); the scatter of each piece is fixed by who carries it and when it first takes a
// blow, so a bout replays exactly and draws nothing from the world's random stream.
// These are pure sums: they say what broke and why; physics.js breaks it (breakWeapon, breakShield).

import { WORLD } from './config.js';
import { MATERIALS, buildOf, freeShaft } from '../weapons.js';

/** A uniform draw in (0, 1) from a string: the same piece of wood or steel is always as strong. */
function pieceDraw(key) {
  let h = 2166136261;
  for (let i = 0; i < key.length; i += 1) h = Math.imul(h ^ key.charCodeAt(i), 16777619);
  h = Math.imul(h ^ (h >>> 15), h | 1);
  h ^= h + Math.imul(h ^ (h >>> 7), h | 61);
  return (((h ^ (h >>> 14)) >>> 0) + 0.5) / 4294967296;
}

/** One piece's strength over its material's median, from a Weibull spread of modulus `modulus`. */
function pieceScatter(key, modulus) {
  return (-Math.log(1 - pieceDraw(key)) / Math.LN2) ** (1 / modulus);
}

/**
 * A blade driven on its point is a column held at the hand (WORLD.wear.point): it buckles at Euler's π²EI/L² (its section's
 * least second moment, over its length out of the hand) and bows, bearing about that force as its point is pressed on,
 * and it snaps (or, soft, takes a set: its metal's `fails`) once the bow's bend stresses its steel past what it `yields`:
 * at a sideways bow a = σL²/(π²Ec), its ends drawn together by π²a²/4L, the work it took over that P·π²a²/4L. A broad
 * sword's flat section is stiff enough that no thrust a man makes bows it; a rapier's slender one bows on any hard stop,
 * and what it then takes before it goes is its steel's σ² over E, the work of its whole length bent. A piece's own
 * strength (`scatter`, the Weibull draw) is its steel's σ: the bow's work goes as its square; Euler's force is E's and
 * hardly varies.
 */
function bladeColumn(spec, build, metal, scatter) {
  const rule = WORLD.wear.point;
  // The section at the middle of the blade (m, across its flat and through it): its own (`build.section`), else the
  // reference sword's scaled by its radius.
  const [width, thick] = build.section ?? rule.section.map((size) => size * (spec.radius / WORLD.wear.blade.radius));
  const length = spec.length;
  const second = (width * thick ** 3) / 12;
  const buckle = (Math.PI ** 2 * metal.modulus * second) / length ** 2;
  const sigma = metal.yields * scatter;
  const sway = (sigma * length ** 2) / (Math.PI ** 2 * metal.modulus * (thick / 2));
  return { buckle, bow: buckle * ((Math.PI ** 2 * sway ** 2) / (4 * length)) };
}

/**
 * How far a shaft's wood bends before it breaks, against the reference ash's (weapons.js MATERIALS hardwood): its strain at
 * rupture (`rupture` over `modulus`) over ash's; 1 for a wood whose rupture is not known. What a blow across it takes before
 * it goes is the work its bend stores, ½σε of its wood: `strength` (σ, the brace figure's) × this (ε): a flexible wood
 * stores the blow in its spring and gives it back, a stiff one of the same strength snaps.
 */
export function shaftFlex(shaft) {
  const ash = MATERIALS.hardwood.shaft;
  return shaft?.rupture && shaft.modulus ? shaft.rupture / shaft.modulus / (ash.rupture / ash.modulus) : 1;
}

/** The wear of a weapon in `fighter`'s hands: begun the first time it takes anything. */
export function wearOf(weapon, fighter, time) {
  if (weapon.wear) return weapon.wear;
  const rule = WORLD.wear;
  const spec = weapon.spec;
  const build = buildOf(spec, rule.shaftFrom);
  const key = `${fighter?.id ?? 0}:${weapon.kind}:${Math.round((time ?? 0) * 1000)}`;
  const blade = build.blade ? MATERIALS[build.blade]?.blade : null;
  const shaft = build.shaft ? MATERIALS[build.shaft]?.shaft : null;
  // A blade's section cubed over its length; a shaft's radius cubed (and its cross-section, for what an edge must hack away).
  const bladeSize = blade ? (spec.radius / rule.blade.radius) ** 3 / (spec.length / rule.blade.length) : 0;
  const shaftSize = shaft ? build.shaftRadius / rule.shaft : 0;
  const bladeScatter = blade ? pieceScatter(`${key}:blade`, blade.scatter) : 1;
  const shaftScatter = shaft ? pieceScatter(`${key}:shaft`, shaft.scatter) : 1;
  // Along it, a column: a stockier one than the war spear's buckles only at Euler's r⁴/L², more than its section's r³ (WORLD.wear.column).
  const free = shaft ? freeShaft(spec, build) : null;
  const column = free ? Math.max(1, shaftSize * (rule.column / free) ** 2) : 1;
  const shaftBend = shaft ? WORLD.mount.brace.shaft * shaft.strength * shaftSize ** 3 * shaftScatter : Infinity;
  const bowed = blade ? bladeColumn(spec, build, blade, bladeScatter) : null;
  weapon.wear = {
    build,
    // The edge's width, × fresh.
    edge: 1,
    // Joules taken across the blade so far, and what it carries in one blow and in all.
    blade: 0,
    bladeStrength: blade ? blade.strength * bladeSize * bladeScatter : Infinity,
    bladeCapacity: blade ? blade.capacity * bladeSize * bladeScatter : Infinity,
    // Driven on its point, the blade as a column (bladeColumn): the force it bows at (N), and the work its bow takes before
    // the bend snaps it (J).
    bladeBuckle: bowed?.buckle ?? Infinity,
    bladeBow: bowed?.bow ?? Infinity,
    // What the shaft carries along its length driving a point into flesh (J), and the edge-on work hacked into it so far, of what
    // it takes to go through.
    shaftStrength: shaftBend * column,
    // What its section bears bent across it, as against along it (WORLD.wear.across of this): the column's length does not help it,
    // the wood's flex does (shaftFlex: how far it bends before it breaks).
    shaftBend,
    shaftAcross: shaftBend * shaftFlex(shaft),
    chop: 0,
    chopCapacity: shaft ? shaft.chop * shaftSize ** 2 * shaftScatter : Infinity,
  };
  return weapon.wear;
}

/** How well an edge cuts, of a fresh one's: 1 / ((1 − press) + press·w), its width w × fresh (WORLD.wear.press). */
export function keenness(weapon) {
  const width = weapon?.wear?.edge ?? 1;
  if (width <= 1) return 1;
  const press = WORLD.wear.press;
  return 1 / (1 - press + press * width);
}

/**
 * A dull edge cuts less: of the cut in `mix`, what its width cannot part lands as the flat (WORLD.skill.flatBlunt of it as a
 * blow), as an edge turned off true does. In place; returns `mix`.
 */
export function bluntEdge(weapon, mix) {
  const keen = keenness(weapon);
  if (keen >= 1 || mix.cut <= 0) return mix;
  const lost = mix.cut * (1 - keen);
  mix.cut -= lost;
  mix.blunt += lost * WORLD.skill.flatBlunt;
  return mix;
}

/** How hard a face armour of this proof is to an edge (WORLD.wear: its proof against a cut squared; bone under nothing). */
export function armourHardness(protection) {
  return Math.max(WORLD.wear.bone, (protection?.cut ?? 0) ** 2);
}

/** How hard the part of a weapon met at `part` (audio/log.js weaponPart: haft, blade, blunt) is to an edge. */
export function partHardness(weapon, part, fighter, time) {
  const build = wearOf(weapon, fighter, time).build;
  const material = part === 'haft' ? build.shaft : build.edge ?? build.blade;
  return MATERIALS[material]?.hardness ?? 1;
}

/** An edge takes `joules` edge on against a face this hard (1: good steel): it grows wider by its metal's `dulls`. */
export function dullEdge(weapon, fighter, time, joules, hardness) {
  const wear = wearOf(weapon, fighter, time);
  const metal = MATERIALS[wear.build.edge];
  if (!metal?.dulls || joules <= 0) return;
  wear.edge = Math.min(WORLD.wear.flat, wear.edge + metal.dulls * joules * hardness);
}

/**
 * A blade takes `joules` across it: past its strength in the one blow, it bends or snaps (its metal's `fails`); else the
 * blow is added to what it has taken, and past its capacity it cracks through. Returns why it broke, or null.
 */
export function strainBlade(weapon, fighter, time, joules) {
  const wear = wearOf(weapon, fighter, time);
  if (!wear.build.blade || joules <= 0) return null;
  const fails = MATERIALS[wear.build.blade].blade.fails;
  if (joules >= wear.bladeStrength) return fails;
  wear.blade += joules;
  return wear.blade >= wear.bladeCapacity ? 'cracked' : null;
}

/**
 * A point driven home along the shaft, stopped over `stop` m (WORLD.wear.stop): the shaft carries up to its strength over
 * that distance (a set shaft gives at the brace's force, whatever stops the point) and snaps past it. Returns what it
 * carried (J: all of `joules`, or what it bore before it went) and whether it snapped.
 */
export function driveShaft(weapon, fighter, time, joules, stop) {
  const wear = wearOf(weapon, fighter, time);
  if (!wear.build.shaft) return { carried: joules, snapped: false };
  const bears = wear.shaftStrength * (stop / WORLD.wear.stop.flesh);
  return joules > bears ? { carried: bears, snapped: true } : { carried: joules, snapped: false };
}

/**
 * A point driven home along a blade, stopped over `stop` m: the blade bears its bow's force over that distance and the
 * work of the bow itself (bladeColumn), and past that it snaps (or bends) there. Returns what it carried (J), whether it
 * broke, and how (its metal's `fails`).
 */
export function driveBlade(weapon, fighter, time, joules, stop) {
  const wear = wearOf(weapon, fighter, time);
  if (!wear.build.blade || wear.build.shaft) return { carried: joules, snapped: false };
  const bears = wear.bladeBuckle * stop + wear.bladeBow;
  return joules > bears ? { carried: bears, snapped: true, reason: MATERIALS[wear.build.blade].blade.fails } : { carried: joules, snapped: false };
}

/**
 * A point driven home and stopped over `stop` m, on whatever carries it: a shaft (driveShaft) or a blade (driveBlade).
 * Past what covers him it may meet a `bone` (physics.js pointOnBone: how far it stops the point, `stop`, and the force it
 * `holds` against): what drives the point harder than that (a shaft along its length, WORLD.mount.brace.shaft over the
 * flesh's stop; a blade at the force it bows at) breaks into the bone and goes on in, as into flesh; a slenderer blade
 * bows against it and is stopped there. Returns what it carried, and what broke (`part`, `reason`) if it did.
 */
export function drivePoint(weapon, fighter, time, joules, stop, bone = null) {
  const wear = wearOf(weapon, fighter, time);
  const drives = wear.build.shaft ? wear.shaftStrength / WORLD.wear.stop.flesh : wear.bladeBuckle;
  const onBone = Boolean(bone) && bone.holds > drives;
  // A blade's slender point going on into flesh is held back only by the flesh's own resistance (a few tens to a hundred
  // or two newtons through skin and muscle: stab tests, physics/lodge.js), under the force it bows at: it is not stopped
  // in the flesh's quarter metre as a shaft driven with a man's weight behind it is, but as far as its blade goes in.
  if (!wear.build.shaft && !onBone && stop >= WORLD.wear.stop.flesh) stop = Math.max(stop, weapon.spec.length);
  if (onBone) stop = Math.min(stop, bone.stop);
  if (wear.build.shaft) {
    const drive = driveShaft(weapon, fighter, time, joules, stop);
    return drive.snapped ? { ...drive, part: 'shaft', reason: 'snapped' } : drive;
  }
  const drive = driveBlade(weapon, fighter, time, joules, stop);
  return drive.snapped ? { ...drive, part: 'blade' } : drive;
}

/** How far a point's drive is stopped in on what it met (WORLD.wear.stop): flesh it goes into, or plate it cannot. */
export function stopIn(protection) {
  const stop = WORLD.wear.stop;
  return protection?.deflects || (protection?.pierce ?? 0) >= stop.proof ? stop.plate : stop.flesh;
}

/**
 * A blow across a shaft (`joules` of it; `edge` J of it an edge's, hacking in): past its strength across
 * (WORLD.wear.across of what its section carries along, `shaftBend`: no column's gain; × its wood's flex, `shaftAcross`) it snaps; the edges' work, summed, hacks it through. Returns why, or null.
 */
export function strikeShaft(weapon, fighter, time, joules, edge = 0) {
  const wear = wearOf(weapon, fighter, time);
  if (!wear.build.shaft || joules <= 0) return null;
  if (joules >= (wear.shaftAcross ?? wear.shaftBend) * WORLD.wear.across) return 'snapped';
  wear.chop += edge;
  return wear.chop >= wear.chopCapacity ? 'hacked through' : null;
}

/** A shield's wear: its board's hacking so far, and what it takes to split it (Infinity: a metal shield, dented only). */
export function shieldWearOf(shield, fighter, time) {
  if (shield.wear) return shield.wear;
  const material = MATERIALS[shield.spec.material];
  const board = material?.board;
  const key = `${fighter?.id ?? 0}:${shield.kind}:${Math.round((time ?? 0) * 1000)}:board`;
  shield.wear = { hacked: 0, blows: 0, capacity: board ? board.perKg * shield.spec.mass * pieceScatter(key, board.scatter) : Infinity };
  return shield.wear;
}

/**
 * A blow of `joules` on a shield, by the harm it carries (`mix`: cut, blunt, pierce shares; WORLD.wear.split of each hacks
 * the board). Returns true when the board splits apart.
 */
export function hackShield(shield, fighter, time, joules, mix) {
  const wear = shieldWearOf(shield, fighter, time);
  if (wear.capacity === Infinity || joules <= 0) return false;
  const split = WORLD.wear.split;
  const total = (mix.cut ?? 0) + (mix.blunt ?? 0) + (mix.pierce ?? 0);
  const share = total > 0 ? ((mix.cut ?? 0) * split.cut + (mix.blunt ?? 0) * split.blunt + (mix.pierce ?? 0) * split.pierce) / total : split.blunt;
  wear.hacked += joules * share;
  wear.blows += 1;
  return wear.hacked >= wear.capacity;
}

/** How hard a shield's face is to an edge. */
export function shieldHardness(shield) {
  return MATERIALS[shield?.spec.material]?.hardness ?? 1;
}
