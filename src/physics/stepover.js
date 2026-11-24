// Stepping and leaping over a man on the floor (STEPOVER): what a man on his feet does about a body lying in his way, before
// his foot or his shin finds it (physics/footing.js, physics.js trodOver and kickLying: the footing and the trip, unchanged).
//
// - What lies in his way (crossingsAhead): of the men lying near him (the contact grid's, in a big fight), the parts his way
//   runs over within the ground he covers in `look` s: how far off they begin and end along it, how high they stand, and how
//   far he would have to step aside to pass them.
// - Whether he knows it is there (groundAttention, noticed): it must lie in what he sees (physics.js sightAngle: his facing,
//   his helmet's sight; a man backing, shoved or stepping sideways does not see where his feet go), with no man standing
//   between him and it (a press hides the ground), and his eyes must come down to it: every `glance` s he looks, and sees it
//   with the share of his attention the ground has (all of it walking free; less with an enemy at arm's length, less again
//   in a blow of his own, in a narrow helm, running broken). Reeling, dazed or carried in a press he looks at nothing.
// - What he does (planCrossing). At a walk or a fighter's step: a raised, lengthened step over it (stepReach: as high and as
//   long as his legs, his armour and his hurts let him step); what is too wide for one step he picks his way over with his
//   feet lifted clear. At a run: a leap (leapOver), the least of his own jump (physics/jump.js) that carries his feet over it
//   at the speed he has, begun where its flight is centred on the body, paid for by its share of a jump's work, landed on
//   his legs by the jump's landing rules (a man in plate needs more of a lower jump, and comes down harder); none with an
//   enemy within reach (in the air he neither strikes nor guards). What he cannot clear he treads on or kicks, as before.
// - Going round it is the mover's choice (ai.js roundFallen reads `crossing.round`); the man played steers himself.

import { P } from '../body.js';
import { WORLD } from './config.js';
import { capsules, capsuleEnds, floorUnder, opponentFor, sightAngle } from '../physics.js';
import { lyingLow } from './footing.js';
import { carried } from './press.js';

export const STEPOVER = {
  // s: how far ahead he looks at the ground, as time at his pace, and m at the least. A walker fixes an obstacle about two
  // steps before it and plans the step over it in the step before (Patla & Vickers 1997, "Where and when do we look as we
  // approach and step over an obstacle in the travel path?", NeuroReport 8: gaze on the obstacle during the approach, not
  // while crossing). Two walking steps are ~1.4 m.
  look: 1, lookLeast: 1.4,
  // m: a body his hips have passed is still to be cleared by the foot left this far behind him (a leg's length, about).
  behind: 0.9,
  // m: half the breadth of the track his feet make (the stance's feet stand ~0.1-0.15 m either side of his line).
  track: 0.15,
  // m: the room left between a sole and the body before and after it. Stepping over an obstacle, the trailing toe is set
  // ~0.2 m before it and the leading heel lands ~0.25 m past it in the young (Chen, Ashton-Miller, Alexander & Schultz 1991,
  // "Stepping over obstacles: gait patterns of healthy young and old adults", J Gerontol 46); less here, the body's edge
  // being soft and the step in a fight short. Unverified as a figure for a body rather than a bar.
  toe: 0.08,
  // m: the gap between two bodies' parts along his way under which they are one obstacle (no room to set a foot down).
  heap: 0.25,
  // m: the foot passes this far over the top of it. Toe clearance over obstacles of 0-150 mm is ~0.10-0.12 m in the young
  // (Chen et al. 1991; Patla & Rietdyk 1993, "Visual control of limb trajectory over obstacles during locomotion", Gait &
  // Posture 1: clearance held near 0.1 m whatever the height).
  clear: 0.1,
  // What one step takes him over: as high as `rise` of his leg length (WORLD.bodyFooting.stepOver.height, the same figure:
  // obstacles to ~30% of leg length are stepped over without change of strategy, higher ones with the hip hiked and more
  // risk: Chou & Draganich 1997, J Biomech 30; unverified as a limit) and as long as `span` of it from the foot left behind
  // (the longest single step of the young is ~1.0-1.2 leg lengths: Medell & Alexander 2000, "A clinical measure of maximal
  // and rapid stepping in older women", J Gerontol 55, their young controls; taken at the low end, in kit). Both by his
  // worse leg (limbShares), his armour's stiffness at the hip and knee (gear.foot) and soft ground (mired).
  // `stretch`: a run's stride is lengthened at the most to this much of itself to land past a body (a runner adjusts the
  // last strides before a hurdle by a tenth or two of their length; a quarter here, unverified).
  rise: 0.45, span: 1.0, stretch: 1.25,
  // s: a walking step's swing (~0.4 s at 0.7 m of step: Perry, Gait Analysis, 1992), longer in proportion for a longer step.
  swing: 0.4, swingStep: 0.7,
  // m/s: from this pace he leaps what lies across his way rather than stepping over it (a quick walk's top; a run begins
  // at WORLD.gait.runFrom, 2.2).
  leapFrom: 1.8,
  // The leap. `tuck`: the knees come up this share of his leg length as he goes over (a bound's, more than a standing
  // jump's WORLD.jump.tuck: a hurdler's lead thigh comes level; half that here, unverified). `crouch` s: the gather, a
  // running take-off's (WORLD.jump.crouch at speed). `least` m: the lowest rise of the hips worth calling a leap. `most`:
  // the share of his full jump's take-off speed he will put into it at the most (a full standing jump mid-run is no stride).
  // `split`: the feet part fore and aft this share of his leg length in the flight (the leading leg reaches for the ground).
  leap: { tuck: 0.3, crouch: 0.08, least: 0.05, most: 0.95, split: 0.28 },
  // m: no leap with an enemy on his feet this near (hips to hips): in the air he can be hit and cannot answer. A long
  // sword's reach and a lunge (WORLD.tiers.engageRange, 3 m, is the same idea).
  threat: 3,
  // s: he looks down at the ground about this often while he moves (gaze goes to the path in glances of ~0.2-0.4 s between
  // other things: Patla & Vickers 1997; taken as one look every 0.4 s, unverified), and needs `react` s between seeing it
  // and the step that clears it (stepping over a suddenly shown obstacle succeeds nearly always with ~0.35-0.45 s to
  // respond and rarely under 0.2 s: Chen, Ashton-Miller, Alexander & Schultz 1994, "Effects of age and available response
  // time on ability to step over an obstacle", J Gerontol 49).
  glance: 0.4, react: 0.3,
  // The share of a glance that finds it (1: a man walking free). `engaged`: an enemy on his feet within `engagedWithin` m
  // (his eyes are on the man: divided attention raises obstacle contacts several-fold, Chen et al. 1996, "Stepping over
  // obstacles: dividing attention impairs performance of old more than young adults", J Gerontol 51; the figure itself is
  // unverified). `striking`: in a blow of his own. `fleeing`: broken and running (he looks where he runs, and behind him).
  // A helmet's sight narrows it in proportion (gear.sight over the bare head's, WORLD.blindsideAngle).
  attention: { engaged: 0.45, engagedWithin: 2.5, striking: 0.25, fleeing: 0.6 },
  // m: a standing man this near the line from his eyes to the body hides it (a body's half-breadth and a little).
  hides: 0.35,
  // s: how often a man works out what lies ahead (each on his own beat). m/s: slower than this he is going nowhere.
  every: 0.1, still: 0.25,
  // m: stepping aside by no more than this costs little: he goes round (ai.js roundFallen). A sidestep or two.
  round: 0.6,
};

/** His way over the ground: where he is (hips' stance), the unit direction he moves in, and his pace; null standing still. */
function wayOf(fighter) {
  const [vx, vz] = fighter.rootVelocity;
  const pace = Math.hypot(vx, vz);
  if (pace < STEPOVER.still) return null;
  return { x: fighter.root[0], z: fighter.root[1], dx: vx / pace, dz: vz / pace, pace };
}

/**
 * What lies across his way: the runs of lying men's parts (joined where no foot fits between them, STEPOVER.heap) that his
 * track (STEPOVER.track either side of his line) passes over, from STEPOVER.behind m behind him (the foot he has yet to
 * bring over) to `reach` m ahead, nearest first. `near`: the indices of the men to look at (null: all). Each run:
 * { from, to (m along his way, from his stance), height (m, the highest top in it), low (the highest top among its parts
 * other than trunks and heads), left, right (m: how far its parts reach to either side of his line), id (the first man
 * in it), moving (one of them crawls), ox, oz, dx, dz (the line it was measured on) }. Null standing still.
 */
export function crossingsAhead(world, fighter, near, reach) {
  const way = wayOf(fighter);
  if (!way) return null;
  const fighters = world.fighters;
  const count = near ? near.length : fighters.length;
  const spans = [];
  const within = reach + WORLD.bodyReach;
  const back = STEPOVER.behind;
  for (let k = 0; k < count; k += 1) {
    const lying = fighters[near ? near[k] : k];
    if (!lying || lying === fighter || (lying.state === 'up' && !lying.crawling) || lying.mount) continue;
    const hx = lying.x[P.pelvis * 3] - way.x;
    const hz = lying.x[P.pelvis * 3 + 2] - way.z;
    const along = hx * way.dx + hz * way.dz;
    if (along < -WORLD.bodyReach - back || along > within || Math.abs(hz * way.dx - hx * way.dz) > WORLD.bodyReach + STEPOVER.track) continue;
    if (!lyingLow(lying)) continue;
    for (const capsule of capsules(lying)) {
      const [a, b] = capsuleEnds(lying, capsule);
      const radius = capsule.radius * (capsule.key === 'head' ? lying.body.gear.headBulk ?? 1 : 1);
      const core = capsule.key === 'trunk' || capsule.key === 'head';
      // (Three places along the part: its ends and its middle. A trunk is ~0.5 m of a ~0.14 m radius, a shin ~0.4 m of 0.05.)
      for (let n = 0; n < 3; n += 1) {
        const t = n / 2;
        const px = a[0] + (b[0] - a[0]) * t - way.x;
        const py = a[1] + (b[1] - a[1]) * t;
        const pz = a[2] + (b[2] - a[2]) * t - way.z;
        const s = px * way.dx + pz * way.dz;
        // (Across his way: + to his left, as the stance's strafe is.)
        const off = px * way.dz - pz * way.dx;
        const outside = Math.max(0, Math.abs(off) - STEPOVER.track);
        if (outside >= radius) continue;
        const top = py + radius - floorUnder(lying.arena, pz + way.z, px + way.x, py);
        if (top < WORLD.bodyFooting.least) continue;
        const half = Math.sqrt(radius * radius - outside * outside);
        if (s + half < -back || s - half > reach) continue;
        spans.push({ from: s - half, to: s + half, top, core, left: off + radius, right: radius - off, id: lying.id, moving: Boolean(lying.crawling && lying.state === 'up') });
      }
    }
  }
  if (!spans.length) return [];
  spans.sort((one, two) => one.from - two.from);
  const runs = [];
  let run = null;
  for (const span of spans) {
    if (!run || span.from > run.to + STEPOVER.heap) {
      run = { from: span.from, to: span.to, height: span.top, low: span.core ? 0 : span.top, left: span.left, right: span.right, id: span.id, moving: span.moving, ox: way.x, oz: way.z, dx: way.dx, dz: way.dz };
      runs.push(run);
      continue;
    }
    run.to = Math.max(run.to, span.to);
    run.height = Math.max(run.height, span.top);
    if (!span.core) run.low = Math.max(run.low, span.top);
    run.left = Math.max(run.left, span.left);
    run.right = Math.max(run.right, span.right);
    run.moving ||= span.moving;
  }
  return runs;
}

/**
 * The share of a glance at the ground that finds what lies `crossing` m ahead on his way (0: he cannot see it at all; 1: a man
 * walking free who looks where he goes). `opponent` his man (or null), `near` the men about him (indices, or null for all).
 */
export function groundAttention(world, fighter, crossing, opponent, near) {
  if (fighter.state !== 'up' || fighter.stagger > 0 || fighter.dazed > 0 || fighter.brokenOpen > 0 || carried(fighter)) return 0;
  // In what he sees: off his facing by no more than his sight (his helmet's; backing, the ground he treads is behind him).
  const facing = [Math.cos(fighter.yaw), -Math.sin(fighter.yaw)];
  const sight = sightAngle(fighter);
  if (facing[0] * crossing.dx + facing[1] * crossing.dz < Math.cos(sight)) return 0;
  // No man on his feet between him and it.
  const fighters = world.fighters;
  const count = near ? near.length : fighters.length;
  for (let k = 0; k < count; k += 1) {
    const other = fighters[near ? near[k] : k];
    if (!other || other === fighter || other.state !== 'up' || other.crawling || other.mount) continue;
    const hx = other.x[P.pelvis * 3] - crossing.ox;
    const hz = other.x[P.pelvis * 3 + 2] - crossing.oz;
    const along = hx * crossing.dx + hz * crossing.dz;
    if (along > 0.2 && along < crossing.from && Math.abs(hx * crossing.dz - hz * crossing.dx) < STEPOVER.hides) return 0;
  }
  const spec = STEPOVER.attention;
  let share = Math.min(1, sight / WORLD.blindsideAngle);
  if (fighter.punch) share *= spec.striking;
  if (fighter.panicked) share *= spec.fleeing;
  if (opponent && opponent.state === 'up' && Math.hypot(opponent.x[P.pelvis * 3] - fighter.x[P.pelvis * 3], opponent.x[P.pelvis * 3 + 2] - fighter.x[P.pelvis * 3 + 2]) < spec.engagedWithin) share *= spec.engaged;
  return share;
}

/**
 * What one step takes him over now: { rise, span } (m), from his leg length, his worse leg's share (`legs`: physics.js
 * limbShares().leg), his armour's stiffness and the ground's hold on his feet.
 */
export function stepReach(fighter, legs = { l: 1, r: 1 }) {
  const legLength = fighter.body.lengths.thigh + fighter.body.lengths.shank;
  const share = Math.max(0, Math.min(legs.l, legs.r)) * Math.min(1, fighter.body.gear.foot ?? 1) * (fighter.mired?.footing ?? 1);
  return { rise: STEPOVER.rise * legLength * share, span: STEPOVER.span * legLength * share };
}

/**
 * The leap that takes his feet over `crossing` at `pace` m/s, from the jump he has now (`model`: physics.js jumpNow): the
 * hips rise `rise` m, enough that his feet (tucked STEPOVER.leap.tuck of his leg length) are STEPOVER.clear over its top
 * for as long as he is above it; `up` is the share of his jump's take-off speed that asks, `flight` its seconds in the
 * air, `runUp` the metres before the body's middle at which he must begin to gather, `cost` its stamina (its share of the
 * jump's work: the take-off's energy goes by the square of its speed). Null if his jump cannot do it.
 */
export function leapOver(fighter, model, crossing, pace) {
  const spec = STEPOVER.leap;
  if (!(model.height > 0) || pace <= 0) return null;
  const legLength = fighter.body.lengths.thigh + fighter.body.lengths.shank;
  const g = WORLD.gravity;
  const over = (crossing.to - crossing.from + 2 * STEPOVER.toe) / pace;
  const rise = Math.max(spec.least, crossing.height + STEPOVER.clear - spec.tuck * legLength) + (g * over * over) / 8;
  const up = Math.sqrt(rise / model.height);
  if (up > spec.most) return null;
  const flight = (2 * up * model.v) / g;
  return { rise, up, flight, runUp: pace * (flight / 2 + spec.crouch), cost: model.cost * up * up };
}

/** Whether the glance that falls now finds it: a draw on the world's dice against the ground's share of his attention. */
function glanceFinds(world, share) {
  return share >= 1 || (share > 0 && world.random() < share);
}

/**
 * Kept each step for a man on his feet (physics.js updateFeet): what lies in his way and what he means to do about it, in
 * `fighter.crossing` ({ ...a run of crossingsAhead, seen (he knows of it), seenAt, how: 'step' | 'pick' | 'leap' | 'onto',
 * failed (why he could not leap it), reach (stepReach), round: { side (+1 left), need (m) } }), or null with nothing there;
 * and what his hips have passed but a foot has yet to come over, in `fighter.crossed` (the same, picked over if he saw it).
 * `tools`: physics.js's { near (indices or null), legsOf (limbShares().leg), jumpNow, startLeap } (handed in: this module
 * decides, physics.js does the jumping).
 */
export function planCrossing(world, fighter, dt, tools) {
  const spec = STEPOVER;
  // (In a jump's flight and its landing he still looks where he is going: the next body is seen from the air.)
  if (fighter.state !== 'up' || fighter.crawling || fighter.climbing) {
    fighter.crossing = null;
    fighter.crossed = null;
    return;
  }
  // (Each on his own beat; the leap's take-off is watched every step once he means to make one.)
  fighter.crossingOwed = (fighter.crossingOwed ?? (fighter.id % 6) * dt) + dt;
  if (fighter.crossingOwed >= spec.every) {
    fighter.crossingOwed = 0;
    const way = wayOf(fighter);
    const reach = way ? Math.max(spec.lookLeast, way.pace * spec.look) : 0;
    const runs = way && (tools.near === null || tools.near.length) ? crossingsAhead(world, fighter, tools.near, reach) : null;
    const held = fighter.crossing;
    const passed = fighter.crossed;
    const ahead = runs?.find((run) => run.to >= 0) ?? null;
    const behind = runs?.findLast((run) => run.to < 0) ?? null;
    // The same thing as before (the same man first in it): what he knew of it he still knows.
    for (const found of [ahead, behind]) {
      if (!found) continue;
      const same = held?.id === found.id ? held : passed?.id === found.id ? passed : null;
      found.seen = same ? same.seen : false;
      found.seenAt = same?.seenAt;
      found.glanceAt = same ? same.glanceAt : -Infinity;
      found.told = same?.told;
      found.failed = same?.failed;
      found.reach = same?.reach;
    }
    if (behind) behind.how = behind.seen ? 'pick' : undefined;
    fighter.crossed = behind;
    fighter.crossing = ahead;
    if (!ahead) return;
    if (!ahead.seen && world.time - ahead.glanceAt >= spec.glance) {
      ahead.glanceAt = world.time;
      if (glanceFinds(world, groundAttention(world, fighter, ahead, opponentFor(world, fighter), tools.near))) {
        ahead.seen = true;
        ahead.seenAt = world.time;
      }
    }
    // Seen, it stays known only while it is still before him (turned from it, backing onto it, he has lost it).
    if (ahead.seen && Math.cos(fighter.yaw) * ahead.dx - Math.sin(fighter.yaw) * ahead.dz < 0) ahead.seen = false;
    ahead.how = undefined;
    if (ahead.seen) {
      const reachNow = stepReach(fighter, tools.legsOf(fighter));
      const width = ahead.to - ahead.from + 2 * spec.toe;
      ahead.round = { side: ahead.left <= ahead.right ? 1 : -1, need: Math.min(ahead.left, ahead.right) + spec.track };
      ahead.reach = reachNow;
      if (ahead.moving) ahead.how = 'onto';
      else if (way.pace >= spec.leapFrom && ahead.height > ahead.low && ahead.from > 0 && !ahead.failed) ahead.how = 'leap';
      else if (ahead.height > reachNow.rise) ahead.how = 'onto';
      else ahead.how = width <= reachNow.span ? 'step' : 'pick';
    }
  }
  const crossing = fighter.crossing;
  if (crossing?.seen && crossing.how === 'leap') tryLeap(world, fighter, crossing, tools);
}

/** How far along the line his crossing was measured on he has come since (m). */
export function alongCrossing(fighter, crossing, x = fighter.root[0], z = fighter.root[1]) {
  return (x - crossing.ox) * crossing.dx + (z - crossing.oz) * crossing.dz;
}

/** A leap meant: begun when he is its run-up short of the body's middle, if his jump, his breath and the men about him allow. */
function tryLeap(world, fighter, crossing, tools) {
  const pace = Math.hypot(fighter.rootVelocity[0], fighter.rootVelocity[1]);
  const model = tools.jumpNow(world, fighter);
  // (Not leapt: he takes it in his stride as he can, its lifted steps or his shins.)
  const fail = (why) => {
    crossing.how = crossing.height > crossing.reach.rise ? 'onto' : 'pick';
    crossing.failed = why;
  };
  if (pace < STEPOVER.still) return;
  // (Blocked for a moment, as just down from the last leap, he may yet be ready in time.)
  if (model.blocked && model.blocked !== 'recovering' && model.blocked !== 'spent' && model.blocked !== 'air') return fail(model.blocked);
  const leap = leapOver(fighter, model, crossing, pace);
  if (!leap) return fail('too high or too wide for his jump');
  const gone = alongCrossing(fighter, crossing);
  const middle = (crossing.from + crossing.to) / 2 - gone;
  if (middle > leap.runUp) return;
  // Too near when he saw it, or not ready when he came to it: past where the flight would be centred by more than half the room it has to spare.
  const spare = (leap.flight * pace - (crossing.to - crossing.from)) / 2;
  if (leap.runUp - middle > Math.max(0.1, spare * 0.5)) return fail('too near to gather');
  if (world.time - crossing.seenAt < STEPOVER.react) return fail('seen too late');
  if (model.blocked) return fail(model.blocked);
  if (!fighter.player && fighter.stamina < leap.cost) return fail('spent');
  // An enemy on his feet within reach: he keeps his feet on the ground and his guard.
  const opponent = opponentFor(world, fighter);
  if (opponent && opponent.state === 'up' && Math.hypot(opponent.x[P.pelvis * 3] - fighter.x[P.pelvis * 3], opponent.x[P.pelvis * 3 + 2] - fighter.x[P.pelvis * 3 + 2]) < STEPOVER.threat) return fail('an enemy in reach');
  if (tools.startLeap(world, fighter, leap, crossing)) fighter.crossing = null;
  else fail('could not jump');
}

/**
 * A step about to be taken (physics.js updateFeet), from `from` to `to` ([x, y, z], world), by a man who knows what lies in
 * his way (or what a foot of his has yet to come over): the landing moved off the body (past it if this step reaches, `span`
 * m from the foot's place: STEPOVER.span of his leg, or a run's stride and a quarter; else short of it, to cross with the
 * next; where neither can be, it lands on him), and the foot lifted over what the swing passes. Returns { to, lift (m: how
 * high the foot must pass), from, until (the shares of the swing between which it is over the body), seconds (a walking
 * step's swing over that length) }, or null if nothing changes.
 */
export function clearStep(fighter, from, to, stride = 0) {
  return clearOne(fighter.crossing, from, to, stride) ?? clearOne(fighter.crossed, from, to, stride);
}

function clearOne(crossing, from, to, stride) {
  if (!crossing?.seen || (crossing.how !== 'step' && crossing.how !== 'pick')) return null;
  const spec = STEPOVER;
  const a = (from[0] - crossing.ox) * crossing.dx + (from[2] - crossing.oz) * crossing.dz;
  const b = (to[0] - crossing.ox) * crossing.dx + (to[2] - crossing.oz) * crossing.dz;
  const near = crossing.from - spec.toe;
  const far = crossing.to + spec.toe;
  // (A step that neither lands in it nor swings over it is as it was.)
  if (Math.max(a, b) < near || Math.min(a, b) > far) return null;
  let land = b;
  if (b > near && b < far) {
    const forward = b >= a;
    const beyond = forward ? far : near;
    const short = forward ? near : far;
    const span = Math.max(crossing.reach.span, stride * spec.stretch);
    if (Math.abs(beyond - a) <= span) land = beyond;
    else if (forward ? short > a + spec.toe : short < a - spec.toe) land = short;
  }
  const moved = land - b;
  const length = Math.abs(land - a);
  const lo = Math.min(a, land);
  // The shares of the swing between which the foot is over it (the foot's way taken as even along the step).
  const over = length > 1e-6 ? [Math.max(0, (Math.max(near, lo) - lo) / length), Math.min(1, (Math.min(far, lo + length) - lo) / length)] : [0, 1];
  const [start, end] = land >= a ? over : [1 - over[1], 1 - over[0]];
  return { to: [to[0] + crossing.dx * moved, to[1], to[2] + crossing.dz * moved], lift: Math.min(crossing.reach.rise, crossing.height) + spec.clear, from: start, until: end, seconds: spec.swing * Math.max(0.5, length / spec.swingStep) };
}

/** How high (m) a step lifted over a body (`clear`: clearStep's lift, from, until) has the foot at share `t` of its swing: up to it by the time it is over him, held across, down after. */
export function clearHeight(clear, t) {
  // (A tenth of the swing's room either side: the foot's way along the step is not even, it starts and ends slow.)
  const from = Math.max(1e-3, clear.from - 0.1);
  const until = Math.min(1 - 1e-3, clear.until + 0.1);
  if (t < from) return clear.lift * Math.sin((Math.PI / 2) * (t / from));
  if (t > until) return clear.lift * Math.sin((Math.PI / 2) * ((1 - t) / (1 - until)));
  return clear.lift;
}
