// The face in a fight: what a man's face shows of what is happening to him, slightly, and never quite still. Purely what is drawn:
// nothing here touches the fight (the physics and the AI never read it, it writes nothing to the world or the fighter, and it never
// draws from the simulation's random stream: each face has its own seeded hash).
//
// It reads the man's real state each frame and turns it into a few expression weights (each 0..1), eased in and out:
//
//   fury    a fury charge: running at the enemy (a rush, a charge, his side ordered to charge, a raider coming on) the more with his
//           blood up (`fighter.adrenaline`), and rage (ai.js `fighter.rage`): a bared, tense, wide-eyed snarl
//   fear    his fear (ai.js `fighter.fear`, the fear map's weighing behind it for the far men), more once he breaks (`panicked`),
//           and the shock of a limb lost (maiming.js maimFear): brows up and in, wide eyes, the mouth tight or a little open
//   shout   the mouth open, brows down, timed to the voice itself: an order he gives (command.js giveOrder: his side's or one arm's),
//           the word to fire he calls (audio/firecall.js, noted by the sound engine), a cry he gives (audio/cries.js); it rises at
//           once and falls away when the voice ends
//   pain    a blow just taken (anywhere: `hitAt`) and his wounds (ai.js hurtShare), the less with adrenaline in him: a squint and
//           a grimace
//   calm    nothing happening: the face at rest
//
// and the face's own life on top, the same in any state: a slow drift in the small muscles (a low-frequency noise per man, from his
// seed), and now and then a micro-expression (a brief frown, a lip press, the jaw shifted to one side, a half smile). The blinks and
// the wandering gaze are face.js's own.
//
// All slight: each situation's weight is capped (FACE_EXPRESSION.most) well short of the full, and the stock rig's offsets are
// small. A custom head (facecustom/solver.js) takes the weights as they are (`setExpression`); a stock head (face.js buildHead) takes
// them as offsets to its rig (`stockOffsets`). Only the men near the camera are worth it (`expressionNear`): past that a brow moved
// a few hundredths of a head is under a pixel.
//
// No three.js and no DOM: main.js steps it for each near man (render.js and face.js draw it); tests drive it directly.

import { P } from './body.js';
import { orderOver } from './command.js';
import { hurtShare } from './ai.js';
import { maimFear } from './maiming.js';

export const FACE_EXPRESSION = {
  // Within this far of the camera (m) a face is stepped: a head (~0.2 m) at 12 m in a 60-degree lens on 1080 rows is ~15 px, where
  // a slight brow or mouth change is still a pixel or two; beyond, it is not seen and costs for nothing.
  near: 12,
  // Running (pelvis m/s): nothing below `from` (a brisk walk is ~1.8), all of it at `full` (a hard run); a charge only counts
  // with an enemy within `within` m (running about the field far from anyone is not a charge), and a run at the enemy with no
  // charge ordered counts `unordered` of itself (a man may be running to a place in the line, not at the enemy).
  run: { from: 2.2, full: 4.5, within: 30, unordered: 0.7 },
  // Fury: the charge's share of it at no adrenaline (`base`), the rest at full adrenaline (`adrenaline`): a charge with the
  // blood up is the snarl, one without is only set and tense. `alone`: adrenaline with no charge (blood up in the press) shows
  // a little; `rage`: a man in a rage (ai.js AI.rage) shows it whatever he is doing.
  fury: { base: 0.35, adrenaline: 0.65, alone: 0.3, rage: 0.7 },
  // Fear: nothing under `from` (the ordinary unease of a fight), all of it at `full`; a broken man (`panicked`) at least `panicked`;
  // the shock of a limb lost counts `shock` of itself.
  fear: { from: 0.15, full: 0.8, panicked: 0.8, shock: 1 },
  // Pain: a blow is felt for `seconds` after it lands (a flinch and its grimace); wounds weigh `wounds` of their share; the shock
  // of a limb lost `shock`; adrenaline masks `mask` of it (the same masking the cries take: cries.js CRY_CHANCE.mask).
  pain: { seconds: 0.9, wounds: 0.6, shock: 0.8, mask: 0.6 },
  // A voice: how long a face holds the shout for a voice the engine does not time (an order given: about a short word bellowed),
  // the most a note can be late and still be shown (s: a voice noted while the man was far is not shouted when he comes near),
  // and each voice's strength (an order and a call bellowed; a cry of pain or fear less wide; a moan a parted mouth).
  voice: { orderSeconds: 0.9, callSeconds: 1, stale: 0.5, strength: { order: 1, call: 1, scream: 0.9, hurt: 0.7, fear: 0.8, dying: 0.7, moan: 0.4, gag: 0.5 } },
  // The most of each situation: all slight, never the face's full range (no cartoon). A shout is the widest, as a bellow is.
  most: { fury: 0.6, fear: 0.55, shout: 0.8, pain: 0.55 },
  // Easing (s, time constants): `rise` into a state, `fall` out of it. Fury and fear come on over a breath and leave slower; a shout
  // opens with the voice and closes as it ends; pain flinches on at once and fades.
  ease: {
    fury: { rise: 0.35, fall: 0.8 },
    fear: { rise: 0.5, fall: 1.2 },
    shout: { rise: 0.05, fall: 0.2 },
    pain: { rise: 0.06, fall: 0.5 },
    calm: { rise: 0.8, fall: 0.3 },
    idle: { rise: 0.15, fall: 0.3 },
  },
  // The slow drift: each idle channel the sum of two slow waves of the man's own (periods within `periods` s, phases his own),
  // at most `amplitude`: a face at rest is never frozen, but the drift is under a micro-expression.
  drift: { periods: [4, 13], amplitude: 0.07 },
  // Micro-expressions: one every `every` s (a range, his own draw each time), held `seconds` (a range), at `peak` (a range), damped
  // by `busy` of the face's situation (a shouting or snarling face has no room for a lip press).
  micro: { every: [3, 9], seconds: [0.45, 1.1], peak: [0.25, 0.45], busy: 0.7, kinds: ['frown', 'press', 'jawLeft', 'jawRight', 'smirk'] },
  // Fear's mouth: a share of men hold it tight, the rest let it part (each man's own, from his seed).
  fearParts: 0.5,
};

/** The channels a face is given, each 0..1. */
export const EXPRESSION_CHANNELS = ['fury', 'fear', 'shout', 'pain', 'calm', 'frown', 'press', 'smirk', 'jawLeft', 'jawRight'];
const IDLE_CHANNELS = ['frown', 'press', 'smirk', 'jawLeft', 'jawRight'];

const exprClamp = (value) => (value < 0 ? 0 : value > 1 ? 1 : value);
const exprRamp = (value, from, full) => exprClamp((value - from) / (full - from));

/** A hash of a seed and a counter to [0, 1): the face's own draws, apart from the simulation's random stream. */
export function expressionHash(seed, counter) {
  let h = Math.imul((seed | 0) ^ 0x9e3779b9, 0x85ebca6b) ^ Math.imul(counter | 0, 0xc2b2ae35);
  h ^= h >>> 16;
  h = Math.imul(h, 0x7feb352d);
  h ^= h >>> 15;
  h = Math.imul(h, 0x846ca68b);
  h ^= h >>> 16;
  return (h >>> 0) / 4294967296;
}

const exprLerp = (range, share) => range[0] + (range[1] - range[0]) * share;

/** A man's face's state, from his seed (his id will do): his drift's waves, his first micro-expression's time, how fear sets his mouth. */
export function createExpression(seed) {
  const state = { seed, draws: 0, clock: 0, weights: {}, waves: {}, micro: null, microIn: 0, voiceAt: -Infinity, voiceUntil: -Infinity, voiceStrength: 0, voiceKind: null, orderSerial: null };
  const draw = () => expressionHash(seed, state.draws++);
  for (const channel of EXPRESSION_CHANNELS) state.weights[channel] = 0;
  for (const channel of IDLE_CHANNELS) state.waves[channel] = [0, 1].map(() => ({ period: exprLerp(FACE_EXPRESSION.drift.periods, draw()), phase: draw() * Math.PI * 2 }));
  state.microIn = exprLerp(FACE_EXPRESSION.micro.every, draw());
  state.fearParts = draw() < FACE_EXPRESSION.fearParts;
  state.draw = draw;
  return state;
}

// ---- Voices --------------------------------------------------------------------

// The voices the sound engine has given each man, by the fighter (draw-side only: nothing in the simulation keeps or reads it).
const heardVoices = new WeakMap();

/**
 * A voice given by `fighter` at world time `at` for `seconds` (the sound engine's: a fire call, a cry): his face shouts it.
 * `kind` one of FACE_EXPRESSION.voice.strength's keys.
 */
export function noteVoice(fighter, kind, at, seconds) {
  if (!fighter) return;
  heardVoices.set(fighter, { kind, at, seconds });
}

/** The order he gave just now (his side's or one arm's): { serial, since }, or null. */
function orderGiven(world, fighter) {
  const corner = fighter.corner;
  let found = null;
  const own = world.commands?.[corner];
  if (own && own.by === fighter.id) found = own;
  const arms = world.groupCommands?.[corner];
  if (arms) for (const key in arms) if (arms[key]?.by === fighter.id && (!found || arms[key].serial > found.serial)) found = arms[key];
  return found;
}

/** A new voice of his, noted or an order given: the shout's window begins. */
function hearVoice(state, fighter, world) {
  const time = world.time ?? 0;
  const spec = FACE_EXPRESSION.voice;
  const order = orderGiven(world, fighter);
  if (order && order.serial !== state.orderSerial) {
    state.orderSerial = order.serial;
    if (time - order.since < spec.stale) startVoice(state, 'order', order.since, spec.orderSeconds);
  }
  const heard = heardVoices.get(fighter);
  if (heard && heard.at !== state.voiceAt && time - heard.at < spec.stale && heard.at <= time + 1e-6) startVoice(state, heard.kind, heard.at, heard.seconds ?? spec.callSeconds);
}

function startVoice(state, kind, at, seconds) {
  state.voiceAt = at;
  state.voiceUntil = at + seconds;
  state.voiceKind = kind;
  state.voiceStrength = FACE_EXPRESSION.voice.strength[kind] ?? 1;
}

// ---- What he is doing ----------------------------------------------------------

/** How much he is charging (0..1): a rush or an AI charge outright, else running with an enemy near (more under a charge order). */
export function chargeShare(world, fighter) {
  if (fighter.state !== 'up' || fighter.panicked || fighter.crawling) return 0;
  if (fighter.rush || (fighter.aiCharge && (world.time ?? 0) < fighter.aiCharge.until)) return 1;
  const spec = FACE_EXPRESSION.run;
  if (!((fighter.nearestFoe ?? Infinity) < spec.within) || !fighter.v) return 0;
  const vx = fighter.v[P.pelvis * 3];
  const vz = fighter.v[P.pelvis * 3 + 2];
  const running = exprRamp(Math.hypot(vx, vz), spec.from, spec.full);
  // (His arm read as command.js groupOf reads it, without setting it: this is the view.)
  const arm = fighter.mount ? 'horse' : fighter.commandArm ?? 'foot';
  const ordered = orderOver(world, fighter.corner, arm)?.kind === 'charge' || (fighter.body?.inputs?.charging ?? 1) > 1;
  return ordered ? running : running * spec.unordered;
}

/** The weights his situation asks for now, before easing (each 0..1, capped by FACE_EXPRESSION.most). */
export function situationTargets(state, fighter, world) {
  const time = world.time ?? 0;
  const most = FACE_EXPRESSION.most;
  const adrenaline = exprClamp(fighter.adrenaline ?? 0);
  if (fighter.state === 'out') return { fury: 0, fear: 0, shout: 0, pain: 0 };
  const shock = maimFear(fighter, time);
  // Fear.
  const fearSpec = FACE_EXPRESSION.fear;
  let fear = exprRamp(fighter.fear ?? 0, fearSpec.from, fearSpec.full);
  if (fighter.panicked) fear = Math.max(fear, fearSpec.panicked);
  fear = exprClamp(Math.max(fear, fearSpec.shock * shock));
  // Fury: the charge and the blood up, rage; fear takes it away.
  const furySpec = FACE_EXPRESSION.fury;
  const charge = chargeShare(world, fighter);
  const raging = fighter.rage && time < fighter.rage.until ? 1 : 0;
  const fury = exprClamp(Math.max(charge * (furySpec.base + furySpec.adrenaline * adrenaline), furySpec.alone * adrenaline, furySpec.rage * raging) * (1 - fear));
  // Pain: the last blow, the wounds, the shock; masked by adrenaline.
  const painSpec = FACE_EXPRESSION.pain;
  let lastHit = -Infinity;
  if (fighter.hitAt) for (let index = 0; index < fighter.hitAt.length; index += 1) if (fighter.hitAt[index] > lastHit) lastHit = fighter.hitAt[index];
  const since = time - lastHit;
  const blow = since >= 0 && since < painSpec.seconds ? 1 - since / painSpec.seconds : 0;
  const pain = exprClamp(Math.max(blow, painSpec.wounds * hurtShare(fighter), painSpec.shock * shock) * (1 - painSpec.mask * adrenaline));
  // A voice: open while it sounds.
  hearVoice(state, fighter, world);
  const shout = time >= state.voiceAt && time < state.voiceUntil ? state.voiceStrength : 0;
  return { fury: fury * most.fury, fear: fear * most.fear, shout: shout * most.shout, pain: pain * most.pain };
}

// ---- The face's own life -----------------------------------------------------------

/** The slow drift of an idle channel at `clock` s: 0..amplitude. */
function driftOf(state, channel) {
  const waves = state.waves[channel];
  let sum = 0;
  for (const wave of waves) sum += Math.sin((state.clock / wave.period) * Math.PI * 2 + wave.phase);
  return FACE_EXPRESSION.drift.amplitude * (0.5 + 0.25 * sum);
}

/** The micro-expression under way: its channel and weight now (a rise and fall over its time), or null; the next one drawn when due. */
function microNow(state, dt) {
  const spec = FACE_EXPRESSION.micro;
  if (!state.micro) {
    state.microIn -= dt;
    if (state.microIn > 0) return null;
    const kind = spec.kinds[Math.min(spec.kinds.length - 1, Math.floor(state.draw() * spec.kinds.length))];
    state.micro = { kind, age: 0, seconds: exprLerp(spec.seconds, state.draw()), peak: exprLerp(spec.peak, state.draw()) };
    state.microIn = exprLerp(spec.every, state.draw());
  }
  const micro = state.micro;
  micro.age += dt;
  if (micro.age >= micro.seconds) {
    state.micro = null;
    return null;
  }
  return { kind: micro.kind, weight: micro.peak * Math.sin((Math.PI * micro.age) / micro.seconds) ** 2 };
}

const easeToward = (current, target, dt, { rise, fall }) => current + (target - current) * (1 - Math.exp(-dt / (target > current ? rise : fall)));

/**
 * One step of a man's face: his situation's weights and the face's own life, eased; returns the weights (each 0..1: the
 * channels of EXPRESSION_CHANNELS, and `fearParts`, whether his fear parts his mouth). The same weights object each step.
 */
export function stepExpression(state, fighter, world, dt) {
  if (!(dt > 0)) return state.weights;
  state.clock += dt;
  const targets = situationTargets(state, fighter, world);
  // (How taken up his face is: each situation as a share of its own most, so a full snarl leaves no calm though it is slight.)
  const most = FACE_EXPRESSION.most;
  const busy = Math.max(targets.fury / most.fury, targets.fear / most.fear, targets.shout / most.shout, targets.pain / most.pain);
  targets.calm = fighter.state === 'out' ? 0 : 1 - busy;
  const alive = fighter.state !== 'out';
  const micro = alive ? microNow(state, dt) : null;
  const room = 1 - FACE_EXPRESSION.micro.busy * busy;
  for (const channel of IDLE_CHANNELS) targets[channel] = alive ? driftOf(state, channel) + (micro?.kind === channel ? micro.weight * room : 0) : 0;
  const ease = FACE_EXPRESSION.ease;
  for (const channel of EXPRESSION_CHANNELS) state.weights[channel] = exprClamp(easeToward(state.weights[channel], targets[channel], dt, ease[channel] ?? ease.idle));
  state.weights.fearParts = state.fearParts;
  return state.weights;
}

/** Whether a man's face is near enough the camera (at `eye`, {x, y, z}) to be worth stepping. */
export function expressionNear(fighter, eye) {
  if (!eye || !fighter.x) return false;
  const at = P.head * 3;
  const dx = fighter.x[at] - eye.x;
  const dy = fighter.x[at + 1] - eye.y;
  const dz = fighter.x[at + 2] - eye.z;
  return dx * dx + dy * dy + dz * dz < FACE_EXPRESSION.near * FACE_EXPRESSION.near;
}

// ---- The stock head's rig --------------------------------------------------------

/**
 * How far each weight moves the stock head's rig (face.js buildHead `update`), at weight 1. The rig's own units: `lid` 0 open to 1
 * shut (below 0 wider than at rest, the lash raised), `mouth` 0 shut to 1 wide (it shows open from face.js's 0.25), `brow` 1 down and
 * knit (below 0 raised with the inner ends up), `flush` the cheeks' colour 0..1; `width` the mouth's breadth (a share more or less),
 * `shift` its sideways slide (head radii), `tilt` its corners' slant (rad, one corner up). Each small: the weights are already
 * capped short of their full, and these keep even the full a hint, not a mask.
 */
export const STOCK_RIG = {
  // A snarl: brows down, eyes wide, the mouth bared a little and stretched, colour up.
  fury: { brow: 1.5, lid: -0.4, mouth: 0.7, width: 0.2, flush: 0.35 },
  // Fear: brows raised with the inner ends up, eyes wide; the mouth parted (`parted`) or pressed narrow (`width`).
  fear: { brow: -1.6, lid: -0.45, parted: 0.6, width: -0.2 },
  // A shout: the mouth open, the brows down, colour up with the effort.
  shout: { brow: 1.2, lid: 0.05, mouth: 0.9, width: 0.1, flush: 0.2 },
  // Pain: a squint and a grimace (the brows knit, the mouth drawn wide and a little open).
  pain: { brow: 1.1, lid: 0.45, mouth: 0.3, width: 0.18 },
  // At rest the lids sit a little lower than wide open.
  calm: { lid: 0.06 },
  // The face's own life.
  frown: { brow: 1.2 },
  press: { width: -0.35 },
  smirk: { tilt: 0.14, shift: 0.02, width: 0.05 },
  jawLeft: { shift: -0.035 },
  jawRight: { shift: 0.035 },
};

/** The stock rig's offsets for these weights: { lid, mouth, brow, flush, width, shift, tilt } (STOCK_RIG). Zeros for none. */
export function stockOffsets(weights, out = {}) {
  out.lid = 0;
  out.mouth = 0;
  out.brow = 0;
  out.flush = 0;
  out.width = 0;
  out.shift = 0;
  out.tilt = 0;
  if (!weights) return out;
  for (const channel in STOCK_RIG) {
    const weight = weights[channel] ?? 0;
    if (!weight) continue;
    const rig = STOCK_RIG[channel];
    for (const key in rig) {
      if (key === 'parted') {
        if (weights.fearParts) out.mouth += rig.parted * weight;
        continue;
      }
      // (A parting fear does not also press the mouth narrow.)
      if (channel === 'fear' && key === 'width' && weights.fearParts) continue;
      out[key] += rig[key] * weight;
    }
  }
  return out;
}
