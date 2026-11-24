// The ground finisher: a man the player has put on the floor, helpless and within reach, can be killed where he lies. The player steps
// in beside him, drops to his knees, drives a dagger into the least armoured place on him that he can get at (the throat, the face or
// the sights of his helm, the armpit, the groin: the gap in his armour, where it is not under his own arm or leg lying across it, or
// his shield; planFinisher), and stands again. It is not an animation that kills: the thrust is an ordinary blade stroke (physics.js
// throwPunch, a thrust at a place) that lands as a real strike, only with his weight behind the point (`FINISHER.profile`), so the
// man dies, or does not, by the simulation: armour turns a point that is not put in a gap, and a wound bleeds.
//
// Mode-independent: it belongs to a fighter the player directs (control.js: the special button offers `finish`, and an attack
// asked for while it is offered executes it), whatever the stage, the battle or the duel. Nothing here reads `world.stage`.
// The state is `fighter.finisher`; `updateFinisher` runs it each step from `directFighter`.

import { P } from './body.js';
import { crowdNear } from './crowdgrid.js';
import { vec, yawRotate } from './pose.js';
import { MOVES, moveRange, STYLES } from './moves.js';
import { WEAPONS } from './weapons.js';
import { gapsOf, gapUnder, gapZoneAt, rigidAt } from './physics/gaps.js';
import { capsuleEnds, capsules, drawForFinisher, hostile, plantFeet, point, protectionAt, restoreAfterFinisher, shieldDisc, throwPunch, WORLD } from './physics.js';

export const FINISHER = {
  // Offered for a man on the floor this near (m, hips to hips). The attack tapped takes a man this much further off
  // (`tapReach`): the steps in are the finisher's own (`approachMost`, run from `runFrom`), as a running strike closes.
  reach: 1.6,
  tapReach: 3.2,
  // A man on his feet and awake this near (m) keeps the attack button for himself: it strikes him, not the man on the floor.
  threat: 2.4,
  // Where he kneels: this far (m) from the man's upper chest, on the side he came from.
  standOff: 0.5,
  // How far along his body, as a share of `standOff` (the cosine of the angle off abreast of the place), the kneeling place may lie: towards the head, or back towards the feet.
  headward: 0.9,
  bodyward: -0.15,
  // The steps in (s at most, then he kneels where he is), the drop to his knees, the withdrawal.
  approachMost: 1.5,
  // He runs in from further than this (m); nearer, he steps.
  runFrom: 0.7,
  approachPace: 1,
  arrived: 0.22,
  kneelSeconds: 0.28,
  withdrawSeconds: 0.3,
  // The thrust is given up if the blow is not away within this long (s) of kneeling (the hands busy or too tired).
  thrustWithin: 0.8,
  // The thrust waits for the man to settle (the place moving less than this, m/s), up to this long (s).
  settledBelow: 0.4,
  settleMost: 0.5,
  squared: 0.25,
  // He gives up when the man is further than this (m) from his hips, or has risen.
  lost: 2.6,
  // While he kneels over him the man on the floor is held down (s of his count kept at least): his weight is on him.
  holdDown: 0.5,
  // The blade: his own if it is a dagger or a knife; else his kit's sidearm if it is a short one-handed blade; else a knife from his belt.
  short: 0.65,
  belt: 'knife',
  // What the thrust gains over an ordinary stab: the share of his own body mass behind the point (`body`; a stab is 0.02), the
  // blunt harm it carries as a multiple (a dagger driven in: all point), and how often it finds the gap in plate it is aimed
  // at (`gap`). And the point is leaned on all the way in (physics.js finisherPress): bowed over him, `lean` of his weight on
  // the hilt (his trunk, head and arms over his hands, ~0.6 of him, more than half of it borne by them) and his arm's push,
  // over `depth` m (a dagger's length into the throat, the armpit or the groin, to the vessels or the brain): ~550 N over
  // 0.12 m, ~65 J more than the blow brings, and more again for a heavier man or one in armour. (It was the blow's point
  // harm doubled: a rule, and through the mail under a gap in plate it still often left him alive.)
  profile: { body: 0.15, lean: 0.35, depth: 0.12, blunt: 0.3, gap: 0.95, drive: 4 },
  // Looking for the gap (planFinisher): the point goes in along the line from where his hand is as the thrust starts to the place,
  // and he puts it where that line meets the man's head or body, not his own arm or leg lying across it, nor his shield, and where
  // what it meets there stops a point least (the gap it finds, physics/gaps.js, as the blow itself will). The hand (`hand`, m;
  // measured as the blade turns down onto the line at the end of the windup: `over` in from his hips towards the place, `right`
  // to the right of that, `rise` above the place) is reckoned from each place he could kneel on his own side of the man (not
  // across him: a man stepping over a body on the floor trips on it), as he comes, abreast of the place or round towards the
  // head; kneeling, he looks again from where he is, until the blade turns down. `clear`: the room the line keeps from a limb
  // (m, past its skin: the blade's half-breadth and the knuckles', and a lying man's legs shift a few cm as the knee goes on
  // him; at 1.5 cm a leg sliding in still took the point 1 in 10 in mail); `alike`: places whose armour
  // stops the point within this much of each other count as alike (then the one he is already putting it to, the place as he
  // comes, the order of REGIONS);
  // `walk`: what a metre further to go counts against a place, as protection.
  hand: { over: 0.38, right: 0.1, rise: 0.6 },
  clear: 0.05,
  // How far (m) the hand may be off where it is reckoned, the lines from round it taken with the line from it (lineIn).
  spread: 0.06,
  alike: 0.05,
  walk: 0.02,
  // Where he may kneel to look: as the steps bring him (`null`, kneelingPlace's), abreast of the place, or round towards the head.
  kneelAlong: [null, 0, 0.6],
  // Kneeling, with a gap to be had only from a little round him, the steps he takes there (s at most).
  shiftSeconds: 0.6,
  // An execution (a man broken open on his feet by the player's big deflect): he stands this far (m) from the man's hips, and his
  // blade's reach more, before he thrusts.
  standing: 0.45,
  // The execution asked for in the big deflect's window (startExecution) is carried out: nothing about the man asking for it
  // turns it down that his body can put aside (his own stroke, his guard, a hold he has, another man near, the distance: he
  // drops the one and steps in over the other), and what it does is settled by the blow, as any blow's is. Only what holds
  // his body (reeling, dazed, in pain, netted, down) makes it wait, and it waits for him while the man is still open.
  // - reach: a man broken open this near (m, hips to hips) is his to execute (the attack tapped's reach, `tapReach`: he steps in);
  // - lost: he gives up stepping in to a man further than this (m): further than he could have asked for it from;
  // - clearMost: the blow waits for the line from his hand to the place to come clear of the man's arms as they fall (s at
  //   most: the man broken open, his arms drop to his sides within a few tenths; met on the forearm, the point did nothing);
  // - settleMost: and for him to square to it (s at most: standing, the place is not settling as a man's on the floor is);
  // - tries: blows at most, while the man stays open: one met on his arm or turned is followed at once by the next, without
  //   another press (a man who has his enemy helpless before him does not stop at one blow that missed);
  // - askedFor: an execution asked for while his body cannot yet begin it is kept this long (s) past the man's window;
  // - reachShare: he stands for the blow at this share of its reach (moves.js moveRange): the whole of it, as a blow made at its
  //   mark in a fight. Nearer, a sword's or a spear's point went past the face and the blade met him along its length, an
  //   edge (a katana's tsuki from 0.9 m: a cut on the arm); at its reach, the point (tsuki, lunge, spear, halberd, naginata:
  //   6 of 6 bare men and 4 of 6 knights killed, measured), and a mace's level blow at the temple (6 of 6 bare men);
  // - pointFrom: a weapon whose thrust's `pierce` is at least this has a point to execute with (executionBlow): a katana's
  //   0.7, a guandao's 0.55, a war hammer's spike 0.8; a mace's and a club's none;
  // - approachMost: the steps to that place take this long at most (s), then the blow goes from where he is, its own lunge
  //   carrying him the rest (a polearm backing off from a man 1 m off took over a second at a walk, the moment gone; the
  //   ground finisher's `approachMost` is for a man walking round one lying); measured, no fewer knights killed through the
  //   sights at 0.4 s than with the whole walk (4 of 6, guandao, spear, halberd, longsword, dagger), fewer at 0.25;
  // - backMost: backing off instead, a long weapon too near the man for its blow, this long at most (s): a man in armour with a
  //   guandao 1.1 m from a knight got 1 point of 6 home in 0.4 s of steps back, 6 of 6 (4 killed) in 0.8, no more in 1.2.
  execute: { reach: 3.2, lost: 4, clearMost: 0.2, settleMost: 0.15, tries: 3, askedFor: 0.3, reachShare: 1, pointFrom: 0.5, approachMost: 0.4, backMost: 0.8 },
};

// The places on a man that a point is put to, in order of preference when they are alike. `key` is the part of him struck first,
// `move` the stab that goes there.
const REGIONS = [
  { region: 'throat', key: 'head', move: 'execute', zone: 'neck' },
  // The face: an open helmet's face, a closed helm's sights (a rondel's point put through the slit; the zone by the helm, `sights`).
  { region: 'face', key: 'head', move: 'execute', zone: 'sights' },
  { region: 'armpit', key: 'trunk', move: 'execute', zone: 'armpit' },
  // The middle of the breast, over the heart: where plate is plate, never chosen in it; in mail or cloth as good as the armpit
  // (it is the heart), and before the groin, which bleeds but does not kill at once (physics.js vital). Put there when asked,
  // no gap is sought (`gap` false: a finisher aimed elsewhere than the gap).
  { region: 'breast', key: 'trunk', move: 'execute', gap: false },
  { region: 'groin', key: 'trunk', move: 'execute', zone: 'groin' },
];

/**
 * Where on a man lying a region is (a world point), aimed at the middle of the part it is in (the head's centre, the trunk's axis):
 * the point meets the surface of it first, wherever it comes in from. The armpit is the trunk's upper side nearer `from`.
 */
export function regionPoint(target, region, from, shoulder = null) {
  const neck = point(target.x, P.neck);
  const pelvis = point(target.x, P.pelvis);
  if (region === 'throat') return vec.lerp(point(target.x, P.head), neck, 0.2);
  // (The face: the head's centre, the point coming in at the face if the line to it does, physics/gaps.js says which.)
  if (region === 'face') return point(target.x, P.head);
  if (region === 'groin') return vec.lerp(pelvis, neck, 0.05);
  if (region === 'breast') return vec.lerp(pelvis, neck, 0.6);
  const left = point(target.x, P.lShoulder);
  const right = point(target.x, P.rShoulder);
  // (The armpit he chose, `shoulder` 'l' or 'r'; else the one nearer `from`.)
  const near = shoulder ? (shoulder === 'l' ? left : right) : vec.length(vec.sub(left, from)) < vec.length(vec.sub(right, from)) ? left : right;
  return vec.lerp(vec.lerp(pelvis, neck, 0.72), near, 0.2);
}

/**
 * What the kit says of a place a point goes to: the share of a thrust it stops, allowing for the gap in rigid armour there
 * (physics/gaps.js: its `zone`, if the kit has it) found `gap` of the time, and what is under it (a mail voider, the doublet).
 */
function stops(target, entry) {
  const gear = target.body.gear;
  // (The face's gap is the helm's: its sights if closed, the face if open; a sealed one has none.)
  const zone = entry.zone === 'sights' ? { closed: 'visor', open: 'face' }[gear.helmFace ?? 'open'] ?? null : entry.zone;
  return stopsIn(gear, entry.key, zone);
}

/** The share of a thrust the kit stops on part `key`, put into the gap `zone` there (or null: none) `FINISHER.profile.gap` of the time. */
function stopsIn(gear, key, zone) {
  const covered = protectionAt(gear, key);
  const gaps = gapsOf(gear);
  const pierce = covered.pierce ?? 0;
  if (!rigidAt(covered, gear) || !zone || gaps.closed?.includes(zone)) return pierce;
  return pierce * (1 - FINISHER.profile.gap) + (gapUnder(gear, zone, covered).pierce ?? 0) * FINISHER.profile.gap;
}

/**
 * What the line from `from` to `to` meets first on the man (a world point each): { key, point, normal } of the part of him (or
 * 'shield'), or null if nothing. Walked in centimetres: the first place it comes within a part's skin and `FINISHER.clear`.
 */
export function firstMet(target, from, to) {
  const length = vec.length(vec.sub(to, from));
  const parts = capsules(target).map((capsule) => ({ key: capsule.key, ends: capsuleEnds(target, capsule), radius: capsule.radius + FINISHER.clear }));
  // His shield, if he still has it on his arm: where the line crosses its disc, if it does.
  let shieldAt = Infinity;
  if (target.shield) {
    const disc = shieldDisc(target);
    const way = vec.sub(to, from);
    const across = vec.dot(way, disc.normal);
    if (Math.abs(across) > 1e-9) {
      const t = vec.dot(vec.sub(disc.centre, from), disc.normal) / across;
      if (t >= 0 && t <= 1 && vec.length(vec.sub(vec.add(from, vec.scale(way, t)), disc.centre)) <= disc.radius) shieldAt = t;
    }
  }
  const steps = Math.max(1, Math.ceil(length / 0.01));
  for (let step = 0; step <= steps; step += 1) {
    const t = step / steps;
    if (t >= shieldAt) return { key: 'shield', point: vec.lerp(from, to, shieldAt), normal: null };
    const at = vec.lerp(from, to, t);
    for (const part of parts) {
      const [a, b] = part.ends;
      const ab = vec.sub(b, a);
      const span = vec.dot(ab, ab);
      const along = span < 1e-12 ? 0 : Math.max(0, Math.min(1, vec.dot(vec.sub(at, a), ab) / span));
      const off = vec.sub(at, vec.lerp(a, b, along));
      if (vec.length(off) <= part.radius) return { key: part.key, point: at, normal: vec.normalize(off) };
    }
  }
  return null;
}

/** Where his hand is as the thrust starts (FINISHER.hand), kneeling at `place` to put the point to `aim`. */
function handFrom(place, aim) {
  const toward = [aim[0] - place[0], aim[2] - place[2]];
  const apart = Math.hypot(toward[0], toward[1]) || 1;
  const over = Math.min(FINISHER.hand.over, apart);
  const [x, z] = [toward[0] / apart, toward[1] / apart];
  // (His right of the way he faces, x forward and z to his left: [z, -x].)
  return [place[0] + x * over + z * FINISHER.hand.right, aim[1] + FINISHER.hand.rise, place[2] + z * over - x * FINISHER.hand.right];
}

/**
 * How a point put to `aim` from the hand at `hand` goes in: null if the line meets his arm, his leg or his shield first (or nothing);
 * else what stops it there (`stops`: the share of a thrust, the gap it meets taken `FINISHER.profile.gap` of the time), the gap
 * and the part. The hand is not where it is reckoned to the centimetre (FINISHER.hand; `spread`): the lines from round it are
 * taken too, and the place is as good as the clear ones are on the whole (the one from the hand itself must be clear; a gap found
 * only on the line from where the hand is reckoned is found the less).
 */
function lineIn(target, hand, aim, gaps = true) {
  const centre = lineFrom(target, hand, aim, gaps);
  if (!centre) return null;
  const spread = FINISHER.spread;
  const others = [[spread, 0, 0], [-spread, 0, 0], [0, 0, spread], [0, 0, -spread]].map((offset) => lineFrom(target, vec.add(hand, offset), aim, gaps));
  const clear = [centre, ...others.filter(Boolean)];
  return { ...centre, stops: clear.reduce((sum, line) => sum + line.stops, 0) / clear.length };
}

/** One line's way in (lineIn). */
function lineFrom(target, hand, aim, gaps) {
  // (Run on through the place a little: a point aimed at the middle of the part meets its skin before.)
  const met = firstMet(target, hand, vec.add(aim, vec.scale(vec.normalize(vec.sub(aim, hand)), 0.1)));
  if (!met || (met.key !== 'head' && met.key !== 'trunk')) return null;
  const gear = target.body.gear;
  const covered = protectionAt(gear, met.key);
  const rigid = rigidAt(covered, gear);
  const zone = rigid && gaps ? gapZoneAt(target, met.key, met.point, met.normal) : null;
  return { stops: stopsIn(gear, met.key, zone), zone, key: met.key };
}

/**
 * Looking for the gap: of the places a point is put to (REGIONS) from each place he might kneel on his side of the man
 * (FINISHER.kneelAlong; `sides` to look from others, `kneeling` a world point he already kneels at), the one whose line from his
 * hand meets the man's head or body (not his own limb lying across it, nor his shield) where his armour stops it least; alike, the
 * place as he comes first, then REGIONS' order. { entry, shoulder, side, along, stops, zone, key }, or null if every line is blocked.
 */
export function planFinisher(fighter, target, { places = FINISHER.kneelAlong, sides = null, kneeling = null, current = null } = {}) {
  const hips = point(fighter.x, P.pelvis);
  const frame = bodyFrame(target);
  const chest = vec.lerp(point(target.x, P.pelvis), point(target.x, P.neck), 0.6);
  const near = (hips[0] - chest[0]) * frame.across[0] + (hips[2] - chest[2]) * frame.across[1] >= 0 ? 1 : -1;
  // (The place he is already putting it to, `current` { entry, shoulder }, looked at first: alike, he keeps to it.)
  const order = current ? [current.entry, ...REGIONS.filter((entry) => entry !== current.entry)] : REGIONS;
  let best = null;
  for (const side of sides ?? [near]) {
    for (const along of places) {
      for (const entry of order) {
        // (The armpit on the side he kneels; kneeling, the other places are the same from either side.)
        if (kneeling && side !== (sides ?? [near])[0] && entry.region !== 'armpit') continue;
        const flank = [chest[0] + frame.across[0] * side, chest[1], chest[2] + frame.across[1] * side];
        const shoulder = entry.region === 'armpit' ? nearerShoulder(target, flank) : null;
        if (current && entry === current.entry && current.shoulder && shoulder !== current.shoulder) continue;
        const aim = regionPoint(target, entry.region, flank, shoulder);
        // (Kneeling already, `kneeling`: from where he is.)
        const place = kneeling ?? kneelingPlace(fighter, target, aim, { side, along });
        const line = lineIn(target, handFrom(place, aim), aim, entry.gap !== false);
        if (!line) continue;
        const walk = Math.hypot(place[0] - hips[0], place[2] - hips[2]);
        const score = line.stops + FINISHER.walk * walk;
        if (!best || score < best.score - FINISHER.alike) best = { entry, shoulder, side, along, stops: line.stops, zone: line.zone, key: line.key, score };
      }
    }
  }
  return best;
}

/** Which of his shoulders, 'l' or 'r', is nearer a world point. */
function nearerShoulder(target, from) {
  const apart = (side) => vec.length(vec.sub(point(target.x, P[`${side}Shoulder`]), from));
  return apart('l') <= apart('r') ? 'l' : 'r';
}

/** A man lying's frame on the floor: along him (hips to neck) and across him, unit 2-vectors (x, z). */
function bodyFrame(target) {
  const spine = vec.sub(point(target.x, P.neck), point(target.x, P.pelvis));
  const flat = Math.hypot(spine[0], spine[2]);
  const along = flat > 0.15 ? [spine[0] / flat, spine[2] / flat] : [Math.cos(target.yaw), -Math.sin(target.yaw)];
  return { along, across: [-along[1], along[0]] };
}

/** The least protected place on him to put a point: { region, key, move }. Alike, the throat first. */
export function leastProtected(target) {
  let best = null;
  let bestStops = Infinity;
  for (const entry of REGIONS) {
    const score = stops(target, entry);
    if (score < bestStops - 0.05) {
      best = entry;
      bestStops = score;
    }
  }
  return best;
}

/** The blade the finisher is done with: 'held' if he holds a dagger or knife; else a short sidearm of his kit, else the knife at his belt. */
export function finisherBlade(fighter) {
  const held = fighter.weapon?.held ? fighter.weapon : null;
  if (held && held.spec.hands === 'one' && held.spec.length <= 0.4 && held.spec.harm.thrust) return 'held';
  const side = fighter.body.gear.sidearm;
  const spec = side ? WEAPONS[side] : null;
  if (spec && spec.hands === 'one' && spec.length <= FINISHER.short && spec.harm.thrust && !spec.ranged) return side;
  return FINISHER.belt;
}

/** Whether the fighter is in a state to kneel and strike: on his feet, steady, hands free. */
export function canFinish(fighter) {
  // (A beast, an `unarmed` kit, has no knife to draw: it holds a man down and bites him instead, ai.js holdDown, grappling.js biteOf.)
  return fighter.state === 'up' && !fighter.body.gear.unarmed && !fighter.crawling && !fighter.netted && !fighter.mount && !fighter.finisher && !fighter.clinch && !fighter.pin
    && !fighter.pickup && !fighter.pain && !fighter.reloading && !(fighter.stagger > 0) && !(fighter.dazed > 0) && !fighter.weapon?.spec.mounted;
}

/** Whether a man is helpless on the floor: down or on his knees and crawling, not yet out, not getting up. */
export function helplessOnFloor(man) {
  if (man.state === 'out' || man.dormant || man.fled || man.mount || man.netted) return false;
  // (On his knees by his own choice, the player's crawl, he is not helpless: he can strike and stand.)
  // (Nor on his knees fighting on from the ground, a leg gone and his nerve held: physics.js groundFight.)
  return man.state === 'down' || Boolean(man.crawling && !man.crawlChosen && !man.groundFight && man.state === 'up');
}

/**
 * Whether a man stands broken open by a big deflect (physics.js throwDownOpen: `brokenOpen`, `executableUntil`): on his feet, no
 * guard, his face to the man before him, his to be executed by the man played.
 */
export function executable(world, man) {
  return man.state === 'up' && man.brokenOpen > 0 && (man.executableUntil ?? -Infinity) > world.time && !man.mount;
}

/**
 * The man broken open by his big deflect that the man played may execute now, or null: on his feet in his window, an enemy (or
 * the man he is locked on), within FINISHER.execute `reach`. Nothing of the man asking is weighed here (startExecution).
 */
export function executionOffered(world, fighter, { locked = null } = {}) {
  if (!fighter?.player || fighter.state !== 'up') return null;
  let best = null;
  let bestApart = Infinity;
  for (const man of crowdNear(world, [[fighter.x[P.pelvis * 3], fighter.x[P.pelvis * 3 + 2], FINISHER.execute.reach]]) ?? world.fighters) {
    if (man === fighter || !executable(world, man) || !(hostile(man, fighter) || man.id === locked) || !within(fighter, man, FINISHER.execute.reach)) continue;
    const apart = Math.hypot(man.x[P.pelvis * 3] - fighter.x[P.pelvis * 3], man.x[P.pelvis * 3 + 2] - fighter.x[P.pelvis * 3 + 2]) - (man.id === locked ? 0.5 : 0);
    if (apart < bestApart) {
      best = man;
      bestApart = apart;
    }
  }
  return best;
}

/** Whether his body lets him begin an execution now (FINISHER.execute): on his feet and his own; not reeling, dazed or in pain. */
export function readyToExecute(fighter) {
  return fighter.state === 'up' && !fighter.mount && !fighter.netted && !fighter.finisher && !fighter.pain && !(fighter.stagger > 0) && !(fighter.dazed > 0);
}

// The places an execution's blow is put to on a man standing before him (REGIONS' face and throat, each with the gap there):
// a point's, the face (a helm's sights, the one way into any harness) before the throat; a swing's, the throat.
const EXECUTION_POINTS = ['face', 'throat'].map((region) => REGIONS.find((entry) => entry.region === region));
const EXECUTION_EDGES = REGIONS.filter((entry) => entry.region === 'throat');
// Blows whose harm through differs by less than this share count as alike (executionBlow): the earlier is taken.
const EXECUTION_ALIKE = 0.1;

/** How much of a swing's stroke runs level (0..1): one less the share of the hand's way from its start to its end that is up or down. */
function swingAcross(spec) {
  if (!spec.from?.hand || !spec.to?.hand) return 1;
  const way = vec.sub(spec.to.hand, spec.from.hand);
  return 1 - Math.abs(way[1]) / (vec.length(way) || 1);
}

/** A blow's harm taken at `share` (a swing at the throat, by how level it runs: swingAcross). */
function scaleHarm(harm, share) {
  return harm ? Object.fromEntries(Object.entries(harm).map(([kind, value]) => [kind, value * share])) : harm;
}

/**
 * Of what his kit stops at the place (`entry`), the share of a blow of `mode` ('thrust' or 'swing') with weapon harm `harm`
 * ({ pierce, cut, blunt }) that comes through: each kind by what stops it, the gap there taken `FINISHER.profile.gap` of the
 * time where it is one his blow can go into (a point any; an edge only one an edge goes into, physics/gaps.js `edge`); blunt
 * harm goes through no gap, the armour spreads it as it spreads any blow.
 */
function executionThrough(gear, entry, mode, harm) {
  const covered = protectionAt(gear, entry.key);
  const gaps = gapsOf(gear);
  const zone = entry.zone === 'sights' ? { closed: 'visor', open: 'face' }[gear.helmFace ?? 'open'] ?? null : entry.zone;
  const into = rigidAt(covered, gear) && zone && !gaps.closed?.includes(zone) && (mode === 'thrust' || gaps.zones?.[zone]?.edge);
  const under = into ? gapUnder(gear, zone, covered) : null;
  const share = FINISHER.profile.gap;
  let through = 0;
  for (const kind of ['pierce', 'cut', 'blunt']) {
    const stop = under && kind !== 'blunt' ? (covered[kind] ?? 0) * (1 - share) + (under[kind] ?? 0) * share : covered[kind] ?? 0;
    through += (harm?.[kind] ?? 0) * (1 - stop);
  }
  return through;
}

/**
 * The blow an execution is made with, from what he holds (no script per weapon). A weapon with a point worth the name (its
 * thrust's `pierce` at least FINISHER.execute `pointFrom`: a dagger's, a sword's, a spear's, a halberd's or a war hammer's spike)
 * puts it in, at the face (a helm's sights) or the throat, whichever his armour stops least there (executionThrough): a point in the
 * face or the throat goes to the brain or the great vessels, where an edge laid on a head opens it, which bleeds but does not
 * end him at once (physics.js: a deep cut). One with none (a mace, a club, a macuahuitl, the fists) is swung level at the
 * throat and the side of the head: of its strokes, the one most across (swingAcross) with the most harm through; the helm
 * takes a mace as it takes any blow. A short blade's own thrust is its thrust from the shoulder, `executeStanding`. With no
 * blow to make (a bow in hand), his sidearm or a knife from his belt is drawn for it (finisherBlade). { move, entry, mode, draw }.
 */
export function executionBlow(fighter, target) {
  const held = fighter.weapon?.held && !fighter.weapon.spec.ranged ? fighter.weapon.spec : null;
  const gear = target.body.gear;
  const names = Object.keys(STYLES[fighter.style]?.attacks ?? {});
  const moves = (held && finisherBlade(fighter) === 'held' ? ['executeStanding', ...names] : names).filter((move) => {
    const spec = MOVES[move];
    return spec?.kind === 'strike' && spec.zones?.includes('head') && (held ? spec.path === 'blade' : spec.path !== 'blade' && spec.path !== 'aim');
  });
  const pointed = Boolean(held) && (held.harm?.thrust?.pierce ?? 0) >= FINISHER.execute.pointFrom && moves.some((move) => MOVES[move].mode === 'thrust');
  let best = null;
  for (const move of moves) {
    const spec = MOVES[move];
    const mode = spec.mode === 'thrust' ? 'thrust' : 'swing';
    if (pointed !== (mode === 'thrust')) continue;
    // (The fists: a blunt blow, the heavier the more of the body is behind it.)
    const harm = held ? held.harm?.[mode] : { blunt: 1 + (spec.mass?.body ?? 0) * 10 };
    // (A point: the face first, then the throat, alike within EXECUTION_ALIKE; a swing goes at the throat, by how level it runs.)
    for (const entry of mode === 'thrust' ? EXECUTION_POINTS : EXECUTION_EDGES) {
      const through = executionThrough(gear, entry, mode, mode === 'swing' ? scaleHarm(harm, swingAcross(spec)) : harm);
      if (!best || through > best.through * (1 + EXECUTION_ALIKE)) best = { move, entry, mode, through, draw: null };
    }
  }
  if (best) return best;
  // (Nothing to strike with in his hands: the finisher's blade, his sidearm or the knife at his belt, its thrust from the shoulder.)
  const draw = finisherBlade(fighter);
  const harm = WEAPONS[draw === 'held' ? fighter.weapon.kind : draw]?.harm?.thrust;
  const entry = EXECUTION_POINTS.reduce((most, place) => (executionThrough(gear, place, 'thrust', harm) > executionThrough(gear, most, 'thrust', harm) * (1 + EXECUTION_ALIKE) ? place : most));
  return { move: 'executeStanding', entry, mode: 'thrust', through: executionThrough(gear, entry, 'thrust', harm), draw: draw === 'held' ? null : draw };
}

/**
 * Begin an execution of a man broken open (executable): asked for in his window, it is carried out (FINISHER.execute). Whatever
 * of his own he is doing that his body can let go (his stroke, his guard, a rush, a hold) he lets go; he steps in from where he
 * is; the blow is his weapon's (executionBlow). False only while his body cannot begin it (readyToExecute), or the man is no
 * longer open: then it waits (control.js keeps the order).
 */
export function startExecution(world, fighter, target, { asked = false } = {}) {
  // (Asked for in his window and kept, `asked`: still his to begin a moment after it, FINISHER.execute `askedFor`.)
  const open = target && (executable(world, target) || (asked && target.state === 'up' && !target.mount && world.time <= (target.executableUntil ?? -Infinity) + FINISHER.execute.askedFor));
  if (!fighter?.player || !open || target === fighter || !readyToExecute(fighter)) return false;
  const blow = executionBlow(fighter, target);
  let keep = null;
  if (blow.draw) {
    keep = drawForFinisher(world, fighter, blow.draw);
    if (!keep) return false;
  }
  fighter.punch = null;
  fighter.rush = null;
  fighter.defence = null;
  fighter.clinch = null;
  fighter.pickup = null;
  fighter.lowStrike = null;
  fighter.orderPickup = null;
  fighter.guardHeld = false;
  fighter.finisher = { asked: true, execution: true, standing: true, target: target.id, entry: { ...blow.entry, move: blow.move }, mode: blow.mode, keep, phase: 'approach', t: 0, started: world.time, kneeling: 0, thrustAt: null, tries: 0, shoulder: null, plan: null, place: {} };
  logFinisher(world, fighter, 'finisher', target, [`goes in with the ${fighter.weapon?.spec.label.toLowerCase() ?? 'fists'} to finish him`]);
  world.events.push({ time: world.time, kind: 'execution', fighter: target.id, attacker: fighter.id, mode: blow.mode, region: blow.entry.region, effects: ['to be executed'] });
  return true;
}

/** Whether a man on the floor is within reach of this one: the hips apart on the floor, and on the same level. */
function within(fighter, man, range) {
  const dx = man.x[P.pelvis * 3] - fighter.x[P.pelvis * 3];
  const dz = man.x[P.pelvis * 3 + 2] - fighter.x[P.pelvis * 3 + 2];
  return Math.hypot(dx, dz) <= range && Math.abs(man.x[P.pelvis * 3 + 1] - fighter.x[P.pelvis * 3 + 1]) < 1.3;
}

/**
 * An enemy on his feet and awake, near enough that the attack is for him, not for a man on the floor. `watched`: only one who has
 * him for his man (`focus`): in a melee there is always an enemy within a few steps, and the men who went among the fallen did so
 * while the enemies about them had others to fight (an AI man's own judgement: ai.js); the player's button stays off near any.
 */
function engaged(world, fighter, watched = false) {
  const near = crowdNear(world, [[fighter.x[P.pelvis * 3], fighter.x[P.pelvis * 3 + 2], FINISHER.threat]]) ?? world.fighters;
  return near.some((other) => other !== fighter && hostile(other, fighter) && other.state === 'up' && !other.crawling && !other.dormant && !other.fled && !(other.brokenOpen > 0)
    && !(other.driven && !(world.stage?.aware?.minds?.[other.id]?.state === 'aggro'))
    && (!watched || other.focus === fighter.id) && within(fighter, other, FINISHER.threat));
}

/**
 * The man the finisher is offered for, or null: an enemy on the floor within reach (the one he is locked on first, else the
 * nearest), in a fight with weapons, while he can kneel and no enemy on his feet is on him. `anyone`: a man of any side (a team-mate, a civilian) is
 * also a target, if no enemy is (the player's own choice: an explicit call, not the button).
 */
export function finishTarget(world, fighter, { anyone = false, locked = null, range = FINISHER.reach, watched = false } = {}) {
  // Only where it is a fight with weapons (world.armed): in a bout of fists a man down is stood up or counted out, not stabbed.
  if (world.armed === false || !canFinish(fighter) || engaged(world, fighter, watched)) return null;
  const pick = (allowed) => {
    let best = null;
    let bestApart = Infinity;
    for (const man of crowdNear(world, [[fighter.x[P.pelvis * 3], fighter.x[P.pelvis * 3 + 2], range]]) ?? world.fighters) {
      // (Standing broken open by his big deflect, a man is the player's to execute: executable.)
      if (man === fighter || !(helplessOnFloor(man) || (fighter.player && executable(world, man))) || !allowed(man) || !within(fighter, man, range)) continue;
      const apart = Math.hypot(man.x[P.pelvis * 3] - fighter.x[P.pelvis * 3], man.x[P.pelvis * 3 + 2] - fighter.x[P.pelvis * 3 + 2]) - (man.id === locked ? 0.5 : 0);
      if (apart < bestApart) {
        best = man;
        bestApart = apart;
      }
    }
    return best;
  };
  return pick((man) => hostile(man, fighter) || man.id === locked) ?? (anyone ? pick(() => true) : null);
}

/**
 * Where he kneels: `standOff` m from the place he strikes, on the side he is on, kept off the man's body: abreast of the place, or
 * past it towards the man's head, never down along his body (the knees would be on him).
 */
function kneelingPlace(fighter, target, aim, plan = {}) {
  const { along, across } = bodyFrame(target);
  const hips = point(fighter.x, P.pelvis);
  const toward = [hips[0] - aim[0], hips[2] - aim[2]];
  const length = Math.hypot(toward[0], toward[1]) || 1;
  // (The plan's side of him and how far round towards his head, if it says: planFinisher.)
  const headward = Math.max(FINISHER.bodyward, Math.min(FINISHER.headward, plan.along ?? (toward[0] * along[0] + toward[1] * along[1]) / length));
  const side = plan.side ?? (toward[0] * across[0] + toward[1] * across[1] >= 0 ? 1 : -1);
  const sideward = Math.sqrt(1 - headward * headward) * side;
  return [aim[0] + (along[0] * headward + across[0] * sideward) * FINISHER.standOff, aim[1], aim[2] + (along[1] * headward + across[1] * sideward) * FINISHER.standOff];
}

/** Where he stands to execute a man on his feet (an execution): before him, at his blade's thrusting reach, on the side he is on. */
function standingPlace(fighter, target, move = null) {
  const hips = point(fighter.x, P.pelvis);
  const at = point(target.x, P.pelvis);
  const toward = [hips[0] - at[0], hips[2] - at[2]];
  const length = Math.hypot(toward[0], toward[1]) || 1;
  // (A stroke of his weapon's own: where it meets the man as it is made at its mark, its reach as the pad's and the AI's blows
  // reckon it (moves.js moveRange, to the near side of his head), FINISHER.execute `reachShare`; the short blade's thrust from the
  // shoulder, `executeStanding`, close in, as it was made for.)
  const spec = MOVES[move];
  const held = fighter.weapon?.held ? fighter.weapon.spec : null;
  const reach = !spec || move === 'executeStanding' ? FINISHER.standing + (held ? held.length * 0.55 : 0.3)
    : (moveRange(spec, fighter.body, held) + fighter.body.lengths.headRadius) * FINISHER.execute.reachShare;
  return [at[0] + (toward[0] / length) * reach, at[1], at[2] + (toward[1] / length) * reach];
}

/**
 * How long (s) the steps to an execution's place may take (FINISHER.execute): `approachMost` stepping in; `backMost` backing
 * off, a long weapon too close to the man for its blow (backing, a man steps, he does not run).
 */
function executeSteps(fighter, target, place) {
  const at = point(target.x, P.pelvis);
  const hips = point(fighter.x, P.pelvis);
  const backing = Math.hypot(place[0] - at[0], place[2] - at[2]) > Math.hypot(hips[0] - at[0], hips[2] - at[2]);
  return backing ? FINISHER.execute.backMost : FINISHER.execute.approachMost;
}

/** Say what happened to the finisher in the log: 'finisher' on starting, 'finisherAborted' on giving up. */
function logFinisher(world, fighter, kind, target, effects) {
  world.events.push({ time: world.time, kind, attacker: fighter.id, defender: target.id, effects });
}

/**
 * Begin the finisher on `target`: the dagger drawn, the steps in. `region` (a REGIONS name) overrides the place chosen. False if he
 * cannot (not on his feet, hands busy, the man not on the floor or too far, no blade to hold).
 */
export function startFinisher(world, fighter, target, { region = null, force = false, range = FINISHER.reach } = {}) {
  // A man broken open by the man played's big deflect (WORLD.deflect.big, physics.js throwDownOpen): his execution, standing before
  // him, with his own weapon's blow (startExecution, executionBlow), the camera closing on it (drama.js DRAMA.execution).
  if (fighter.player && target && executable(world, target)) return startExecution(world, fighter, target);
  if (world.armed === false || !canFinish(fighter) || !target || target === fighter || !helplessOnFloor(target) || !within(fighter, target, range * (force ? 2 : 1))) return false;
  // The gap he looks for (planFinisher); a place asked for is put to as asked, from where he is; with every line blocked, the least protected place.
  const plan = region ? null : planFinisher(fighter, target);
  const entry = (region && REGIONS.find((item) => item.region === region)) || plan?.entry || leastProtected(target);
  const kind = finisherBlade(fighter);
  let keep = null;
  if (kind !== 'held') {
    keep = drawForFinisher(world, fighter, kind);
    if (!keep) return false;
  }
  fighter.punch = null;
  fighter.rush = null;
  fighter.defence = null;
  fighter.finisher = { asked: Boolean(region), execution: false, standing: false, target: target.id, entry, keep, phase: 'approach', t: 0, started: world.time, kneeling: 0, thrustAt: null, shoulder: plan?.shoulder ?? null, plan, place: plan ? { along: plan.along } : {} };
  logFinisher(world, fighter, 'finisher', target, [`draws the ${fighter.weapon.spec.label.toLowerCase()} to finish him`]);
  return true;
}

/**
 * Kneeling, the place he puts the point to looked for again from where he is (planFinisher: either armpit, no further steps). With
 * `shift`, if a place a little round him on his side (FINISHER.kneelAlong) has a line to a gap that stops the point less by more
 * than `alike`, that plan is taken instead, and true returned: he steps there.
 */
function settleAim(fighter, target, state, shift = false) {
  const plan = planFinisher(fighter, target, { places: [null], sides: [1, -1], kneeling: point(fighter.x, P.pelvis), current: state });
  const round = shift ? planFinisher(fighter, target) : null;
  if (round && (!plan || round.stops < plan.stops - FINISHER.alike)) {
    Object.assign(state, { entry: round.entry, shoulder: round.shoulder, plan: round, place: { along: round.along } });
    return true;
  }
  if (!plan) return false;
  state.entry = plan.entry;
  state.shoulder = plan.shoulder;
  state.plan = plan;
  return false;
}

/**
 * What an execution's blow carries (physics.js `punch.finisher`), by its kind: a point is put and leaned on as the finisher's
 * (FINISHER.profile), into the gap at the place (`zone`: the sights, the throat); an edge is drawn across the place, into the gap
 * there as well, with all its blunt (it is no dagger driven in) and nothing leaned on; a blow with neither, a mace's or a fist's,
 * is a blow, and the helm takes it as it takes any (null).
 */
function executionProfile(fighter, state) {
  const harm = fighter.weapon?.held ? fighter.weapon.spec.harm?.[state.mode] : null;
  if (!harm || (harm.cut ?? 0) + (harm.pierce ?? 0) <= 0) return null;
  if (state.mode === 'thrust') return { ...FINISHER.profile, zone: state.entry.zone };
  return { gap: FINISHER.profile.gap, zone: state.entry.zone, blunt: 1, lean: 0, depth: 0 };
}

/** Whether the line from his weapon hand to `place` (a world point on the man) meets the man's head or body first, not his arm. */
function lineClear(fighter, target, place) {
  const hand = point(fighter.x, P[`${fighter.weapon?.main ?? 'r'}Hand`]);
  const met = firstMet(target, hand, vec.add(place, vec.scale(vec.normalize(vec.sub(place, hand)), 0.1)));
  return !met || met.key === 'head' || met.key === 'trunk';
}

/** Whether a blow of his has landed home on the man's head or body since `time` (not on an arm or a leg in the way). */
function homeSince(world, fighter, target, time) {
  for (let index = world.events.length - 1; index >= 0; index -= 1) {
    const event = world.events[index];
    if (event.time < time) break;
    if (event.kind === 'landed' && event.attacker === fighter.id && event.defender === target.id && (event.target === 'head' || event.target === 'trunk')) return true;
  }
  return false;
}

/** Whether a blow has landed on him since `time`. */
function struckSince(world, fighter, time) {
  for (let index = world.events.length - 1; index >= 0; index -= 1) {
    const event = world.events[index];
    if (event.time < time) break;
    if (event.kind === 'landed' && event.defender === fighter.id) return true;
  }
  return false;
}

/** Let go of the finisher: the blade put by taken up again, the kneel over, the feet under him. */
function endFinisher(world, fighter, outcome, target) {
  const state = fighter.finisher;
  fighter.finisher = null;
  fighter.goTo = null;
  fighter.running = false;
  fighter.move = 0;
  if (state.keep) restoreAfterFinisher(fighter, state.keep);
  if (fighter.state === 'up') plantFeet(fighter);
  if (outcome !== 'done') logFinisher(world, fighter, 'finisherAborted', target, [outcome]);
}

/** Why the finisher must stop before the blow is away, or null. */
function brokenOff(world, fighter, state, target) {
  if (fighter.state !== 'up' || fighter.netted || fighter.mount) return 'brought down';
  if (fighter.stagger > 0 || fighter.dazed > 0 || fighter.pain || struckSince(world, fighter, state.started)) return 'struck while he knelt';
  if (state.phase === 'approach' || state.phase === 'kneel' || (state.phase === 'thrust' && !state.thrustAt)) {
    // (An execution: its first blow goes, asked for in his window, whatever he does by the time it comes (FINISHER.execute); a
    // blow after it only while he is still broken open: recovered, he is a man to fight again.)
    if (state.standing ? target.state === 'out' || (state.tries > 0 && !(target.state === 'up' && target.brokenOpen > 0)) : !helplessOnFloor(target)) return target.state === 'out' ? 'the man is dead' : state.standing ? 'he has recovered' : 'the man is up';
    if (!within(fighter, target, state.standing ? FINISHER.execute.lost : FINISHER.lost)) return 'the man is gone';
  }
  return null;
}

/**
 * Each step while he finishes a man: the steps in, the drop to his knees, the thrust (a real stroke, with his weight behind it),
 * the withdrawal. True while it holds him (control.js then leaves his feet and hands to it); false once it is over or given up
 * (struck, brought down, the man dead or up, the thrust not away in time), and then he is the player's again.
 */
export function updateFinisher(world, fighter, dt) {
  const state = fighter.finisher;
  if (!state) return false;
  const target = world.fighters[state.target];
  state.t += dt;
  const broken = brokenOff(world, fighter, state, target);
  if (broken) {
    endFinisher(world, fighter, broken, target);
    return false;
  }
  const hips = point(fighter.x, P.pelvis);
  const aim = regionPoint(target, state.entry.region, hips, state.shoulder);
  // How fast the place moves (a man still settling on the floor is not struck at yet).
  const drift = state.lastAim ? Math.hypot(aim[0] - state.lastAim[0], aim[1] - state.lastAim[1], aim[2] - state.lastAim[2]) / dt : 0;
  state.lastAim = aim;
  if (state.phase === 'approach') {
    const place = state.standing ? standingPlace(fighter, target, state.entry.move) : kneelingPlace(fighter, target, aim, state.place);
    const apart = Math.hypot(place[0] - hips[0], place[2] - hips[2]);
    if (apart <= FINISHER.arrived || state.t > (state.standing ? executeSteps(fighter, target, place) : FINISHER.approachMost)) {
      // (Standing before him: no kneeling, the point straight in.)
      state.phase = state.standing ? 'thrust' : 'kneel';
      state.t = 0;
      // Where he kneels, he looks again (the man has moved, or he did not get all the way): the place from here whose line is clear;
      // if a gap is to be had only from a little further round him, he shifts there first (once).
      if (!state.asked && !state.standing && settleAim(fighter, target, state, !state.shifted)) {
        state.shifted = true;
        state.phase = 'approach';
        state.t = FINISHER.approachMost - FINISHER.shiftSeconds;
        return true;
      }
    } else {
      stepTowards(world, fighter, place, aim);
      return true;
    }
  }
  fighter.goTo = null;
  fighter.running = false;
  fighter.move = 0;
  fighter.strafe = 0;
  fighter.faceAt = { at: aim, until: world.time + 0.25 };
  // (Kneeling, his weight settles where he is; standing, the blow's own step carries him into it, a lunge's as in any fight.)
  if (!state.standing) {
    fighter.rootVelocity[0] *= 0.5;
    fighter.rootVelocity[1] *= 0.5;
  }
  if (state.phase === 'kneel') {
    state.kneeling = Math.min(1, state.kneeling + dt / FINISHER.kneelSeconds);
    pinWeightOn(target);
    if (state.kneeling < 1) return true;
    state.phase = 'thrust';
    state.t = 0;
  }
  if (state.phase === 'thrust') {
    if (!state.standing) pinWeightOn(target);
    // Until the blade turns down onto its line (the windup), he still looks: a leg that has slid across the place is not stabbed.
    if (!state.asked && (!state.thrustAt || (fighter.punch === state.punch && fighter.punch.t < fighter.punch.spec.windup))) settleAim(fighter, target, state);
    const place = regionPoint(target, state.entry.region, hips, state.shoulder);
    if (fighter.punch && fighter.punch === state.punch) fighter.punch.at = place;
    // (Standing, the place moves as the man sways and is not waited for to settle: the blow follows it, `at`. It waits only for
    // him to square to it and for the line to it to come clear of the man's falling arms, each a moment at most: FINISHER.execute.)
    const ready = state.standing
      ? (turned(fighter, place) < FINISHER.squared || state.t > FINISHER.execute.settleMost) && (lineClear(fighter, target, place) || state.t > FINISHER.execute.clearMost)
      : (drift < FINISHER.settledBelow && turned(fighter, place) < FINISHER.squared) || state.t > FINISHER.settleMost;
    if (!fighter.punch && !state.thrustAt && ready) {
      if (throwPunch(world, fighter, state.entry.move, state.entry.key === 'head' ? 'head' : 'body', { at: place })) {
        fighter.punch.finisher = state.standing ? executionProfile(fighter, state) : state.entry.gap === false ? { ...FINISHER.profile, gap: 0 } : FINISHER.profile;
        state.thrustAt = world.time;
        state.punch = fighter.punch;
      } else if (state.t > FINISHER.thrustWithin && !(state.standing && target.brokenOpen > 0)) {
        // (An execution's blow his body cannot make yet, a stroke carried on past its mark, waits while the man is open.)
        endFinisher(world, fighter, 'the blow would not go', target);
        return false;
      }
    } else if (state.thrustAt && fighter.punch !== state.punch) {
      // An execution's blow met his arm, or was turned: the next at once, while he is still open (FINISHER.execute `tries`).
      if (state.standing && !state.struck && state.tries + 1 < FINISHER.execute.tries && target.state === 'up' && target.brokenOpen > 0) {
        Object.assign(state, { tries: state.tries + 1, thrustAt: null, punch: null, phase: 'approach', t: 0 });
        return true;
      }
      state.phase = 'withdraw';
      state.t = 0;
    }
    // An execution's blow home in his head or body (not met on his arm): the camera's jolt (drama.js DRAMA.executionBlow).
    if (state.execution && !state.struck && state.thrustAt && homeSince(world, fighter, target, state.thrustAt)) {
      state.struck = true;
      world.events.push({ time: world.time, kind: 'executionBlow', fighter: target.id, attacker: fighter.id, effects: [`executed at the ${state.entry.region}`] });
    }
    return true;
  }
  // The withdrawal: up off his knees, the blade away.
  state.kneeling = Math.max(0, state.kneeling - dt / FINISHER.withdrawSeconds);
  if (state.kneeling > 0) return true;
  endFinisher(world, fighter, 'done', target);
  return false;
}

/**
 * One step of going to `place` (a world point) facing `aim`: forwards and sideways as it lies, run from further than `runFrom`
 * (the finisher's steps in; lowstrike.js's too).
 */
export function stepTowards(world, fighter, place, aim) {
  const hips = point(fighter.x, P.pelvis);
  const apart = Math.max(1e-6, Math.hypot(place[0] - hips[0], place[2] - hips[2]));
  const pace = Math.min(FINISHER.approachPace, 0.35 + apart);
  const way = [(place[0] - hips[0]) / apart, (place[2] - hips[2]) / apart];
  const ahead = yawRotate([1, 0, 0], fighter.yaw);
  const left = yawRotate([0, 0, 1], fighter.yaw);
  fighter.goTo = place;
  fighter.faceAt = { at: aim, until: world.time + 0.25 };
  fighter.move = pace * (way[0] * ahead[0] + way[1] * ahead[2]);
  // (Backing off, facing his man, he steps: a man does not run backwards.)
  fighter.running = apart > FINISHER.runFrom && fighter.move > 0;
  fighter.strafe = Math.max(-1, Math.min(1, (pace * (way[0] * left[0] + way[1] * left[2])) / WORLD.sidestepShare));
}

/** How far (rad) he is turned from facing a place. */
function turned(fighter, at) {
  const hips = point(fighter.x, P.pelvis);
  const wanted = Math.atan2(-(at[2] - hips[2]), at[0] - hips[0]);
  return Math.abs(Math.atan2(Math.sin(wanted - fighter.yaw), Math.cos(wanted - fighter.yaw)));
}

/** His weight on the man on the floor: he does not get up while the dagger is going in. */
function pinWeightOn(target) {
  if (target.state === 'down') target.downTimer = Math.max(target.downTimer, FINISHER.holdDown);
}
