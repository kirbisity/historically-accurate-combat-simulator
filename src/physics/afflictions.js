// Two afflictions besides being tired, each a number or two on the man, a few sums a step, shown on his bars and, for the man played,
// over the picture (afflictview.js). The user's call, 2026-11-24: what makes a man keep out of a cesspit, and what the cold of a place
// does to him, as the stats would have it and nothing cast on him.
//
//   nausea  0..1, from filth: its smell (`fighter.stench`, 0..1) and his standing in it (`fighter.steeped`, 0..1), both set each step by
//           what makes them (levelmode/level.js: the castle's sewage); nothing else sets them, so a battle has none. It follows what he
//           is in up within seconds and lets go of him over a minute once he is out of it. The smell alone wears on him less the longer
//           he breathes it (the nose tires of a smell: olfactory adaptation); what he stands in does not. Retching costs breath: his
//           stamina has a ceiling under full (`ceiling`), he gets it back slower (`recovery`), and past `retchFrom` he heaves now and
//           then, winded for a moment (owed back as a blow's wind is: physics.js), and heard. The first time a stench reaches him
//           (`gagFrom`) he gags: heard.
//   chill   0..1, from the cold: how cold his hands and feet have gone (`fighter.cold.hands`, °C). They follow a temperature between
//           his blood's and the air's (world.climate: physics/heat.js), with blood sent to them while his body has heat to spare (work,
//           warm air) and kept from them when it has none (standing in cold air in thin clothes: the body keeps its core and lets the
//           hands go). His kit holds them off the air by its cover (a padded coat, sleeves and skirts: heat.js kitHeat), so a brigandine
//           is warmer than a shirt; water he stands in takes them toward its own cold many times faster. Cold muscles and numb hands
//           are weak and slow (`strengthAt1`, in his muscles' drive: heat.js heatStrength); shivering is work (`shiver`, drawn from
//           his stamina, and so heat: heat.js reads every draw); hands numb past `harmFrom` take harm (cold injury, frostbite past
//           freezing) unannounced (`fighter.coldHarm`, in his health: physics.js bodyHarm). Exercise is the cure: a man fighting has
//           heat to spare.

import { WORLD } from './config.js';
import { soundVoice } from '../audio/log.js';

export const AFFLICT = {
  nausea: {
    // Per s: the share of the way it goes to what he is in, up (within ~4 s) and down (a minute).
    rise: 0.25,
    fall: 1 / 50,
    // The smell alone: after `adapt` s of breathing it, it wears on him `adaptFloor` as much (back as fast once he is out of it).
    adapt: 90,
    adaptFloor: 0.5,
    // At nausea 1: the stamina bar's ceiling `ceiling` lower, and `recovery` of his recovery lost. Stamina over the ceiling sinks to it
    // at `sink` a second.
    ceiling: 0.45,
    recovery: 0.35,
    sink: 0.05,
    // The stench (or standing in it) that makes his first gag; the nausea past which he retches; s between heaves at nausea 1 (from..to,
    // longer as it is less: over the nausea); the stamina a heave takes at 1 (owed back as wind).
    gagFrom: 0.2,
    retchFrom: 0.45,
    retchEvery: [4, 10],
    retchWind: 0.14,
    // (The view's: s the screen heaves with him.)
    heaveSeconds: 0.9,
  },
  cold: {
    // °C the blood brings to the hands; the share of it they start with (he came to the fight moving).
    blood: 34,
    startBlood: 0.6,
    // The blood's share sent to them: `perfuseFrom` with heat neither spare nor short, all of it at `perfuseWatts` W to spare, never
    // under `perfuseLeast` (the cold hand's own flushes of blood, the hunting reaction: Lewis 1930).
    perfuseFrom: 0.15,
    perfuseWatts: 350,
    perfuseLeast: 0.1,
    // s for bare hands with no blood to go most of the way (1/e) to where they are held; his dress and kit make it up to `keepTau`
    // times slower. What they are held at: `keep` of the way from the air to the blood, by how well he is wrapped: `clothes` for
    // ordinary dress (a coat, sleeves, leggings: most men in most places), all of it under full armour's padding, less in thin dress
    // (`dress`, by outfit: a boxer's trunks, a gladiator's loincloth). Ordinary clothes keep a man standing in Pyongyang's -4 °C from
    // numbness for a quarter of an hour; a man in a loincloth goes numb in minutes. Water he stands in: `wetTau` times faster, toward the
    // water (no colder than `waterFloor`), whatever he wears.
    tau: 300,
    keepTau: 2.5,
    keep: 0.5,
    clothes: 0.85,
    dress: {
      none: 0.05, sumo: 0.05, mma: 0.1, sports: 0.2, rags: 0.3, retiarius: 0.1, hoplomachus: 0.15, thraex: 0.15, murmillo: 0.15,
      secutor: 0.15, commodus: 0.2, lorarius: 0.2, maximus: 0.4, mexicaElite: 0.4,
      // (A coat of fur of his own.)
      silverback: 1.1, monkeyFur: 1.1,
    },
    wetTau: 6,
    waterFloor: 0.5,
    // Chill 0 with the hands at `from` °C, 1 at `full` (numb: grip and fine movement going; Heus et al. 1995, finger skin under ~15 °C).
    from: 20,
    full: 8,
    // His muscles' drive at chill 1 (cold muscle loses ~4% of its power a °C: Bergh & Ekblom 1979).
    strengthAt1: 0.75,
    // Stamina a second shivering takes at chill 1.
    shiver: 0.004,
    // Cold injury: past `harmFrom` chill (hands under ~11 °C) the tissue takes harm, `harmRate` of his health a second at chill 1 (and
    // more the colder: `frostFrom` °C and under, frostbite, `frostRate` more for each °C), at most `harmMost`. Non-freezing cold injury
    // takes hours of real cold and wet; here minutes, so that a man numb with cold is the worse for it.
    harmFrom: 0.75,
    harmRate: 0.0006,
    frostFrom: 0,
    frostRate: 0.0006,
    harmMost: 0.5,
  },
};

const afflictClamp = (value) => Math.max(0, Math.min(1, value));

// ---- Nausea ---------------------------------------------------------------------------------------------------------------------

/** His nausea, 0..1. */
export const nauseaOf = (fighter) => fighter.nausea?.level ?? 0;

/** The stamina bar's ceiling for his nausea: 1 clear, lower the sicker. */
export const staminaCeiling = (fighter) => 1 - AFFLICT.nausea.ceiling * nauseaOf(fighter);

/** His recovery's share for his nausea. */
export const nauseaRecovery = (fighter) => 1 - AFFLICT.nausea.recovery * nauseaOf(fighter);

/** A stamina recovered by `gain`, not past his ceiling (and, over it already, kept where it is: the sink takes it down). */
export function recoverUnder(fighter, gain) {
  const ceiling = staminaCeiling(fighter);
  return Math.min(Math.max(ceiling, fighter.stamina), fighter.stamina + gain);
}

/** Each step: his nausea toward what he smells and stands in; the first gag; a heave now and then. Nothing for a man never near filth. */
export function stepNausea(world, fighter, dt) {
  const smell = fighter.stench ?? 0;
  const steeped = fighter.steeped ?? 0;
  if (!fighter.nausea && smell <= 0 && steeped <= 0) return;
  const spec = AFFLICT.nausea;
  const state = (fighter.nausea ??= { level: 0, smelt: 0, gagged: false, nextHeave: null, heaveAt: -Infinity });
  if (fighter.body.gear.machine || fighter.body.inputs?.wader || fighter.state === 'out') return;
  state.smelt = smell > 0.05 ? state.smelt + dt : Math.max(0, state.smelt - dt);
  const worn = spec.adaptFloor + (1 - spec.adaptFloor) * Math.exp(-state.smelt / spec.adapt);
  const exposure = Math.max(steeped, smell * worn);
  const rate = exposure > state.level ? spec.rise : spec.fall;
  state.level += (exposure - state.level) * (1 - Math.exp(-rate * dt));
  if (state.level < 1e-4 && exposure <= 0) state.level = 0;
  // The first breath of it.
  if (!state.gagged && Math.max(smell, steeped) >= spec.gagFrom) {
    state.gagged = true;
    state.heaveAt = world.time;
    soundVoice(world, fighter, 'gag', Math.max(smell, steeped));
  }
  // His stamina over his ceiling sinks to it.
  const ceiling = staminaCeiling(fighter);
  if (fighter.stamina > ceiling) fighter.stamina = Math.max(ceiling, fighter.stamina - spec.sink * dt);
  // A heave: winded, heard, and the next one drawn.
  if (state.level < spec.retchFrom) {
    state.nextHeave = null;
    return;
  }
  const random = world.random ?? Math.random;
  const interval = () => (spec.retchEvery[0] + (spec.retchEvery[1] - spec.retchEvery[0]) * random()) / state.level;
  state.nextHeave ??= world.time + interval();
  if (world.time < state.nextHeave || fighter.state !== 'up') return;
  state.nextHeave = world.time + interval();
  state.heaveAt = world.time;
  const loss = Math.min(Math.max(0, fighter.stamina), spec.retchWind * state.level);
  fighter.stamina -= loss;
  fighter.windDebt = (fighter.windDebt ?? 0) + loss;
  soundVoice(world, fighter, 'gag', state.level);
}

/** How far into a heave the screen is (0 none .. 1 at its start), for the view. */
export function heaveOf(fighter, time) {
  const at = fighter.nausea?.heaveAt ?? -Infinity;
  return afflictClamp(1 - (time - at) / AFFLICT.nausea.heaveSeconds);
}

// ---- Cold -----------------------------------------------------------------------------------------------------------------------

/** His chill, 0 (hands warm) .. 1 (numb). */
export function chillOf(fighter) {
  const hands = fighter.cold?.hands;
  if (hands === null || hands === undefined) return 0;
  const spec = AFFLICT.cold;
  return afflictClamp((spec.from - hands) / (spec.from - spec.full));
}

/** His muscles' drive for the cold: 1 warm, `strengthAt1` numb. */
export const coldStrength = (fighter) => 1 - (1 - AFFLICT.cold.strengthAt1) * chillOf(fighter);

/**
 * Each step (from physics/heat.js stepHeat, with what it reckoned: `kit` his kit's heat, `made` the heat his body makes, `dry` what the air
 * takes off his skin, W): his hands toward where the blood and the air and his kit put them; his shivering; frostbite.
 */
export function stepCold(world, fighter, kit, made, dry, dt) {
  const spec = AFFLICT.cold;
  const air = world.climate?.air ?? WORLD.heat.reference.air;
  const cold = (fighter.cold ??= { hands: null, harm: 0 });
  const blood = Math.max(spec.perfuseLeast, afflictClamp(spec.perfuseFrom + (made - dry) / spec.perfuseWatts));
  const clothes = spec.clothes * (spec.dress[fighter.body.inputs?.outfit?.kind ?? 'none'] ?? 1);
  const wrapped = Math.min(1.1, clothes + Math.max(0, 1 - clothes) * afflictClamp(kit.cover));
  const held = air + (spec.blood - air) * spec.keep * wrapped;
  if (cold.hands === null) cold.hands = Math.min(spec.blood - 2, spec.startBlood * spec.blood + (1 - spec.startBlood) * held);
  let target = blood * spec.blood + (1 - blood) * held;
  let tau = spec.tau * (1 + (spec.keepTau - 1) * Math.min(1, wrapped));
  if (fighter.wading) {
    target = blood * spec.blood + (1 - blood) * Math.max(spec.waterFloor, air);
    tau /= spec.wetTau;
  }
  cold.hands += (target - cold.hands) * (1 - Math.exp(-dt / tau));
  const chill = chillOf(fighter);
  if (chill > 0 && fighter.stamina > 0) fighter.stamina = Math.max(0, fighter.stamina - (spec.shiver * chill * dt) / Math.max(0.2, fighter.body.aerobic));
  if (chill > spec.harmFrom) {
    const rate = spec.harmRate * ((chill - spec.harmFrom) / (1 - spec.harmFrom)) + spec.frostRate * Math.max(0, spec.frostFrom - cold.hands);
    cold.harm = Math.min(spec.harmMost, cold.harm + rate * dt);
    fighter.coldHarm = cold.harm;
  }
}
