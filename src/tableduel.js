// Large battles, phase 3's first cut (KB spec 2026-11-21-large-battles): an exchange nobody perceives, far from the man played
// and from the camera, decided by the table rather than blow by blow. Two men at grips there stand to each other as poses
// (physics.js chooseDetail: 'proxy'), think nothing step by step, and each step one of them may go down: at a rate that ends
// the exchange in about TABLE_DUEL.meanSeconds, the winner drawn by the men's fighting strengths (src/ratings.js: Bradley-Terry,
// fitted to some 25,000 bouts fought in the physics; his odds against a man of strength r are s / (s + r)). The loser is given
// what drops a man in the physics itself, a great vessel opened (physics.js openVessel): he bleeds and collapses as any man.
// The same man all through (his blood, wounds, man, place): the moment either comes into the player's sight or near him or the
// camera, the pair is let go and the physics takes them up from the pose, as it does any man leaving the ranks' poses.
// Off unless TABLE_DUEL.enabled. Not drawing: the poses are drawn as every pose is.

import { P } from './body.js';
import { RATINGS } from './ratings.js';
import { outfitOf } from './outfits.js';

/**
 * `far` m: how far from the man played and from the camera's eye an exchange must be, besides unperceived (out of the camera's
 * frame or past AI.perceive's `sharp`, 25 m, and not on him): past arm's length and a few strides, out of Hall's public distance. `reach` m: hips apart within which two men at each other are at grips. `meanSeconds`: how long
 * such an exchange lasts on average (fitted, tools/tableduel.js: Sarhu at 200 men, two seeds, 40 s, men down at 10 s intervals
 * (red, blue) 1.5/1, 14.5/6, 39.5/8, 55/10 with the table against 2/1, 14.5/4, 40/8, 55/8.5 in the physics alone; 6 s fell too fast).
 * `collapse` s: how soon the loser goes down. `recheck` s: how often a pair looks whether it is still unperceived and far.
 * `ghostEvery` s: how often a ghost (a man on foot with no missile, eligible, not yet at grips: ai.js) thinks.
 * `strength`: for a man the ratings do not hold, nor any of his kit or style (Maximus is 100).
 */
export const TABLE_DUEL = { enabled: false, far: 12, reach: 2.6, meanSeconds: 16, collapse: 2.5, recheck: 0.5, strength: 100, ghostEvery: 0.5 };

// Strengths by `style|kind` (a rated character's own), and the mean by kit and by style, for men of the armies not on the roster.
let strengths = null;
function strengthTables() {
  if (strengths) return strengths;
  const byType = new Map();
  const byKind = new Map();
  const byStyle = new Map();
  const add = (map, key, score) => {
    const entry = map.get(key) ?? { sum: 0, count: 0 };
    entry.sum += score;
    entry.count += 1;
    map.set(key, entry);
  };
  for (const character of Object.values(RATINGS.characters ?? {})) {
    if (!character.type || !(character.score > 0)) continue;
    const [style, kind] = character.type.split('|');
    add(byType, character.type, character.score);
    add(byKind, kind, character.score);
    add(byStyle, style, character.score);
  }
  const mean = (map) => new Map([...map].map(([key, { sum, count }]) => [key, sum / count]));
  strengths = { byType: mean(byType), byKind: mean(byKind), byStyle: mean(byStyle) };
  return strengths;
}

/** A man's fighting strength (Maximus 100): his own kit and style's, else his kit's mean, else his style's, else TABLE_DUEL.strength. */
export function fightingStrength(fighter) {
  if (fighter.tableStrength !== undefined) return fighter.tableStrength;
  const { byType, byKind, byStyle } = strengthTables();
  const kind = outfitOf(fighter.body.inputs).kind;
  const style = fighter.style;
  fighter.tableStrength = byType.get(`${style}|${kind}`) ?? byKind.get(kind) ?? byStyle.get(style) ?? TABLE_DUEL.strength;
  return fighter.tableStrength;
}

const hips = (fighter) => [fighter.x[P.pelvis * 3], fighter.x[P.pelvis * 3 + 2]];
const apartFrom = (fighter, [x, z]) => Math.hypot(fighter.x[P.pelvis * 3] - x, fighter.x[P.pelvis * 3 + 2] - z);

/** Whether a man may fight by the table now: on his feet, on foot, free, unperceived, and far from the man played and the camera. */
export function tableEligible(world, fighter) {
  if (fighter.player || fighter.state !== 'up' || !fighter.unperceived || fighter.mount || fighter.climbing || fighter.caught || fighter.holding !== undefined) return false;
  if (fighter.clinch || fighter.pin || fighter.finisher || fighter.netted || fighter.crawling || fighter.fled || fighter.dormant || fighter.hidden || fighter.driven) return false;
  const man = world.perceiver === undefined || world.perceiver === null ? null : world.fighters[world.perceiver];
  if (!man) return false;
  if (apartFrom(fighter, hips(man)) < TABLE_DUEL.far) return false;
  if (world.view?.eye && apartFrom(fighter, world.view.eye) < TABLE_DUEL.far) return false;
  return true;
}

/** Let a man go from the table: he thinks and fights in the physics again from where he stands. */
export function leaveTable(fighter) {
  fighter.tableDuel = undefined;
}

/**
 * After a man's think: if he and his man are both eligible and at grips, the pair goes to the table. Before it, for a man at the
 * table: whether he stays (rechecked every TABLE_DUEL.recheck s), and if so, held to his man; `true` if his think is to be skipped.
 */
export function keepTable(world, fighter, dt, { strike }) {
  const duel = fighter.tableDuel;
  if (!duel) return false;
  const foe = world.fighters[duel.foe];
  if (!foe || foe.state !== 'up' || fighter.state !== 'up') {
    leaveTable(fighter);
    return false;
  }
  if (world.time >= duel.checkAt) {
    if (!tableEligible(world, fighter) || !tableEligible(world, foe)) {
      leaveTable(fighter);
      return false;
    }
    duel.checkAt = world.time + TABLE_DUEL.recheck;
  }
  // Held to him: standing, facing him, no blow under way (the pose stands in for the exchange).
  fighter.move = 0;
  fighter.running = false;
  fighter.goTo = undefined;
  fighter.focus = foe.id;
  fighter.faceFoe = true;
  // Each step the exchange may end: one of the two goes down.
  if (world.random() < dt / TABLE_DUEL.meanSeconds) {
    const mine = fightingStrength(fighter);
    const theirs = fightingStrength(foe);
    const [winner, loser] = world.random() < mine / (mine + theirs) ? [fighter, foe] : [foe, fighter];
    strike(loser, TABLE_DUEL.collapse, winner);
    leaveTable(fighter);
    if (foe.tableDuel?.foe === fighter.id) leaveTable(foe);
  }
  return true;
}

/** After a man's think: to the table, if he and the man he is on are both eligible and at grips. */
export function joinTable(world, fighter) {
  if (fighter.tableDuel || fighter.focus === undefined) return;
  const foe = world.fighters[fighter.focus];
  if (!foe || apartFrom(fighter, hips(foe)) > TABLE_DUEL.reach || !tableEligible(world, fighter) || !tableEligible(world, foe)) return;
  fighter.tableDuel = { foe: foe.id, since: world.time, checkAt: world.time + TABLE_DUEL.recheck };
}
