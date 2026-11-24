// A blunt blow on this body: what lies between the striking face and the bone where it lands (his own fat and muscle,
// under whatever he wears), how far that draws the blow out and spreads it, and how much the part takes of it. One rule for
// every blunt contact (a fist, a foot, a weapon's head or shaft, a shield, another body, a horse, the ground): physics.js
// bluntConsequences and the peak force of each. The bone's own strength on this body is body.js boneStrength.

import { BODY, FRAMES, buildBody } from '../body.js';
import { caloriesForWeight } from '../physiology.js';
import { ARMOUR_COVER } from '../coverage.js';

// (Where the hand begins along the forearm: coverage.js.)
const HAND_FROM = ARMOUR_COVER.handFrom;

export const BLUNT = {
  // The soft tissue over the bone where a blow meets a part, as shares of the part's own layers (body.js segments: fat
  // outside, muscle under it, bone within). `fat` of the fat layer's thickness and `muscle` of the muscle's lie over the
  // bone there; `skin` m is there whatever the body.
  // - head: the scalp, 5-7 mm of skin and galea over the skull on anyone, hardly thicker on a fat man; no muscle to speak
  //   of over the vault.
  // - trunk: the chest wall's muscle is a shell round the organs, not the whole of the layer (bluntFlesh takes the
  //   trunk's muscle as a shell over its surface): the ribs at the side under `muscle` of it, and all of the fat; a belly
  //   carries the most fat of any part.
  // - forearm: a guard takes a blow on the ulna's border, which lies under the skin its whole length (the parry or
  //   nightstick fracture is a direct blow there): a quarter of the muscle.
  // - shank: the tibia's front face lies under the skin; the calf is behind it.
  // - upper arm and thigh: the humerus under most of the arm's muscle, the femur deep in the thigh's.
  cover: {
    head: { skin: 0.005, fat: 0.5, muscle: 0 },
    trunk: { skin: 0.002, fat: 1, muscle: 0.6 },
    upperArm: { skin: 0.002, fat: 1, muscle: 0.7 },
    forearm: { skin: 0.002, fat: 1, muscle: 0.25 },
    thigh: { skin: 0.002, fat: 1, muscle: 1 },
    shank: { skin: 0.002, fat: 0.6, muscle: 0.3 },
  },
  // Soft tissue under a blow is a spring in series with whatever else gives (the striking face, the bone): the contact
  // lasts √(1 + depth / `give`) times as long and its peak force falls by as much for the same momentum. `give` (m): the
  // depth of tissue that doubles the contact's compliance. Set by the one measured series: a pendulum on the hip through
  // the soft tissue over the trochanter lost ~71 N of peak force for each mm of tissue (Robinovitch, McMahon & Hayes
  // 1995, J Orthop Res 13: 956): about a quarter off through 25 mm, which is 1/√(1 + 25/30). `muscle`: a millimetre of
  // muscle against one of fat (denser and, held tense as a man in a fight holds it, stiffer: it gives less).
  give: 0.03,
  muscle: 0.6,
  // What a part's injury (WORLD.damageCapacity, WORLD.injury) is of, bone against soft tissue: a limb's mark is its bone
  // breaking (all bone); the trunk's is the ribs and what they cage, the head's the skull and what is in it (half each).
  // The bone's share is hurt by the blow over the bone's toughness on this body (body.bone.toughness), the soft share
  // as on any body.
  bony: { head: 0.5, trunk: 0.5, upperArm: 1, forearm: 1, thigh: 1, shank: 1 },
  // A long bone struck across is bent, and a load spread along it bends it less: a limb struck free in the air is a beam
  // carried by its own inertia, its greatest moment under a patch of width w on a length L is F (L - w) / 8. The loads the
  // bones break at (body.js BODY.fractureN) were set by broad blows on the thigh (`broad`, m: a shin's or a glove's
  // half-width, on the reference man's thigh: `thigh`, m), so a broad face on a shorter bone (a glove on a forearm) bends
  // it by (1 - w / L) over the thigh's share, ~0.8; a narrow face (a shaft, a mace's flange) in full, pressing in the
  // harder besides (WORLD.contactStress).
  bend: { broad: 0.065, thigh: 0.43 },
  // The most and the least a body's own flesh and bone change a blow's toll, against the reference man's.
  toll: [0.25, 4],
  // The reference man the game's capacities and fracture loads were set on: 1.75 m, medium frame, 75 kg, 27, some
  // exercise (the build of the ordinary men the blows were measured on).
  reference: { sex: 'male', heightCm: 175, frame: 'medium', age: 27, exercise: 0.4, kg: 75 },
  // The guard: an arm (or a weapon) put in a blow's way is held there by its owner's muscles, and gives ground to what is
  // behind it (physics.js guardGives). The blow's momentum sets the arm moving; the arm's muscles stop it over the gap to
  // his head or his body, doing force × gap of work, and what energy is left carries the arm into him.
  // - hold: the force (N) an arm resists being driven back with, as a multiple of the force it strikes with
  //   (body.strikeForce at the hand: a muscle resisting as it is stretched bears about half as much again as it can
  //   shorten against, Katz 1939, J Physiol 96: 45). Fitted on equals: a man's guard holds a man of his own size's
  //   straight right (~14 N·s into ~3 kg of arm, ~30 J, against ~300 N over 0.19 m, ~57 J) and gives to a blow of about
  //   half as much momentum again.
  // - unset: of that, what an arm holds that was not put up against this blow (it only happened to be in the way).
  // - least: the least gap (m) reckoned: an arm lying against his ribs or his head has that much give in the flesh.
  // - upperArm: the share of the upper arm's mass that is driven back with the forearm.
  // - shown: the share coming through from which the log calls the guard beaten.
  // - beaten: a blade's parry that his arms could not hold lets the blow on from this share of its speed (the blade and his
  //   arms carried along with it); under it the blow is spent on them.
  guard: { hold: 1.8, unset: 0.6, least: 0.04, upperArm: 0.5, shown: 0.25, beaten: 0.25 },
  // What a blow on a forearm meets, by where along it and how it faces the blow (guardMeets): the user's call, 2026-11-24
  // (a guarding forearm broke in about one limb contact in 300 between equal gloved boxers, and in nearly every
  // bare-knuckle bout: the forearm was struck as the ulna's border wherever the blow came, glove or no glove).
  // - The hand: from coverage.js ARMOUR_COVER.handFrom of the way to the fist, and a glove's padded cuff (`cuff`, m: a
  //   boxing glove's padding runs a few centimetres past the wrist; estimated from the glove's make, unverified) further
  //   back. A blow there loads the forearm through the wrist, which gives: it is not struck across, and does not break.
  //   What it meets is the glove (its padding in series with the striker's: the contact lasts as much longer again as one
  //   glove draws a bare blow out, WORLD.fists gloved over bare, 11 ms over 8 ms), or the bare back of the fist (`fist`,
  //   m of skin and tendon over the metacarpals: a few millimetres, unverified), whose bones are what can break (the
  //   hand's load, body.fracture.hand).
  // - The forearm: the ulna's border lies under the skin down its back, the flexor and extensor bellies on its faces
  //   (Gray's Anatomy: the ulna's posterior border subcutaneous its whole length; the nightstick fracture is a blow on it).
  //   The back of the forearm is the side the elbow points to (the olecranon's), so a blow square to it meets the border
  //   (`edge` of the muscle layer over the bone: a little fascia), one from across the forearm's bend meets its belly
  //   (`flat`: most of the muscle lies between it and the bone), by the square of how squarely it came onto the back.
  meets: { cuff: 0.03, fist: 0.005, edge: 0.1, flat: 0.8 },
};

/**
 * The soft tissue (m, as fat: BLUNT.muscle) between a blow and the bone on this body's part `key` (a segment's key): the
 * skin, his fat there and the muscle that lies over the bone (BLUNT.cover). A rigid build (a machine's shell) has none.
 */
export function bluntFlesh(body, key) {
  if (body.inputs?.build?.rigid) return 0;
  const segment = body.segments[key];
  const kind = segment.kind;
  const cover = BLUNT.cover[kind] ?? BLUNT.cover.trunk;
  const fat = Math.max(0, segment.skinRadius - segment.muscleRadius);
  // A limb's muscle wraps its bone. The trunk's is a shell round its organs: its volume over the trunk's surface.
  const muscle = kind === 'trunk' || kind === 'head'
    ? segment.tissue.muscle / 1060 / (2 * Math.PI * Math.max(1e-3, segment.muscleRadius) * Math.max(1e-3, segment.length))
    : Math.max(0, segment.muscleRadius - segment.boneRadius);
  return cover.skin + cover.fat * fat + cover.muscle * BLUNT.muscle * muscle;
}

/** How much longer a blow's contact lasts through `depth` m of soft tissue than on bare bone (BLUNT.give). */
export function fleshStretch(depth) {
  return Math.sqrt(1 + Math.max(0, depth) / BLUNT.give);
}

let referenceMan = null;
/** The reference man's body (BLUNT.reference), built once. */
function bluntReference() {
  if (!referenceMan) {
    const { kg, ...inputs } = BLUNT.reference;
    referenceMan = buildBody({ ...inputs, calories: Math.round(caloriesForWeight(inputs, kg, FRAMES[inputs.frame].lean)) });
  }
  return referenceMan;
}

const bluntParts = new WeakMap();

/**
 * This body's part `key` under a blunt blow:
 * - depth (m): the soft tissue over the bone there (bluntFlesh), which widens a striking face by as much;
 * - stretch: how much longer the contact lasts for it (fleshStretch), the peak force lower by as much;
 * - pad: his flesh's cushioning there over the reference man's (under 1: better padded than he is);
 * - toll: how much of a blow's harm to the part this body takes, over the reference man's: its padding, and its bone's
 *   toughness for the bony share of the part's injury (BLUNT.bony);
 * - size: the part's mass over the reference man's (what a crushing blow's energy is spread through).
 */
export function bluntPart(body, key) {
  let parts = bluntParts.get(body);
  if (!parts) bluntParts.set(body, (parts = {}));
  if (parts[key]) return parts[key];
  const depth = bluntFlesh(body, key);
  const stretch = fleshStretch(depth);
  const rigid = Boolean(body.inputs?.build?.rigid);
  // (The reference man is his own reference; a machine has no flesh and no bone to differ by.)
  const same = rigid || body === referenceMan || !bluntReference().segments[key];
  const reference = same ? null : bluntReference();
  const pad = same ? 1 : fleshStretch(bluntFlesh(reference, key)) / stretch;
  const bony = BLUNT.bony[body.segments[key].kind] ?? 0.5;
  const tough = rigid ? 1 : Math.max(0.05, body.bone?.toughness ?? 1);
  const [least, most] = BLUNT.toll;
  const toll = Math.max(least, Math.min(most, pad * (1 - bony + bony / tough)));
  const size = same ? 1 : body.segments[key].mass / reference.segments[key].mass;
  return (parts[key] = { depth, stretch, pad, toll, size });
}

/**
 * What a blow on a forearm meets (BLUNT.meets): `at` its contact, `normal` out of the arm toward the striker; `elbow`,
 * `hand` and `shoulder` the arm's particles; `gloved` whether his hands are in gloves. Returns this body's part there as
 * bluntPart does (`depth`, `stretch`, `pad`, `toll`, `size`), with `region` 'hand' (the fist, or the glove: the forearm
 * not bent by it) or 'forearm'. On any other part, the part as bluntPart has it.
 */
export function guardMeets(body, key, at, normal, { elbow, hand, shoulder }, gloved = false, gloveStretch = 1) {
  const part = bluntPart(body, key);
  if (body.segments[key]?.kind !== 'forearm' || body.inputs?.build?.rigid) return { ...part, region: 'part' };
  const spec = BLUNT.meets;
  const span = [hand[0] - elbow[0], hand[1] - elbow[1], hand[2] - elbow[2]];
  const length = Math.hypot(...span) || 1e-6;
  const axis = span.map((value) => value / length);
  const along = ((at[0] - elbow[0]) * axis[0] + (at[1] - elbow[1]) * axis[1] + (at[2] - elbow[2]) * axis[2]) / length;
  const handFrom = HAND_FROM - (gloved ? spec.cuff / Math.max(0.05, body.segments[key].length) : 0);
  const same = (depth) => {
    const stretch = fleshStretch(depth);
    return { ...part, depth, stretch, pad: (part.pad * part.stretch) / stretch, toll: part.toll * (part.stretch / stretch) };
  };
  if (along >= handFrom) {
    const fist = same(spec.fist);
    if (!gloved) return { ...fist, region: 'hand' };
    return { ...fist, stretch: fist.stretch * gloveStretch, pad: fist.pad / gloveStretch, toll: fist.toll / gloveStretch, region: 'hand' };
  }
  // The back of the forearm: the way the elbow points, square to the forearm (the upper arm's line run on past the elbow).
  const upper = [elbow[0] - shoulder[0], elbow[1] - shoulder[1], elbow[2] - shoulder[2]];
  const lean = upper[0] * axis[0] + upper[1] * axis[1] + upper[2] * axis[2];
  const back = [upper[0] - lean * axis[0], upper[1] - lean * axis[1], upper[2] - lean * axis[2]];
  const backLength = Math.hypot(...back);
  // (A straight arm has no back to say: half way between.)
  const square = backLength > 1e-3 ? Math.abs((back[0] * normal[0] + back[1] * normal[1] + back[2] * normal[2]) / backLength) : Math.SQRT1_2;
  const share = spec.edge + (spec.flat - spec.edge) * (1 - square * square);
  const segment = body.segments[key];
  const cover = BLUNT.cover.forearm;
  const depth = cover.skin + cover.fat * Math.max(0, segment.skinRadius - segment.muscleRadius) + share * BLUNT.muscle * Math.max(0, segment.muscleRadius - segment.boneRadius);
  return { ...same(depth), region: 'forearm', edge: square };
}

/** A striking face of radius `face` (m; none: a broad one) as the bone under `depth` m of flesh meets it: spread wider by the flesh. */
export function faceThrough(face, depth) {
  return face > 0 ? face + depth : face;
}

/**
 * A guard driven in (BLUNT.guard): a blow of `impulse` (N·s) on a guard of `mass` (kg: the arm, or the weapon and the arms)
 * held with `force` (N) at `gap` (m) from what it covers. The share of the blow's momentum that comes through to him
 * (0: the guard held), what the guard could have held (`holds`, N·s) and the energy the holding took (`taken`, J).
 */
export function guardGives(impulse, mass, force, gap) {
  const brought = (impulse * impulse) / (2 * Math.max(1e-6, mass));
  const work = Math.max(0, force) * Math.max(BLUNT.guard.least, gap);
  const through = brought > work ? Math.sqrt(1 - work / brought) : 0;
  return { through, holds: Math.sqrt(2 * mass * work), taken: Math.min(brought, work) };
}

/**
 * Of a blow's force on a limb of this body, the share that bends its long bone (BLUNT.bend): 1 for a narrow striking face
 * (`face`, m, its radius; none: a broad one), less for a face that is broad against the bone's length, spread wider still
 * by the flesh over it (`depth`, m).
 */
export function bendShare(body, key, face, depth) {
  const spec = BLUNT.bend;
  const span = (width, length) => Math.max(0, 1 - width / Math.max(1e-3, length));
  return Math.min(1, span(2 * ((face > 0 ? face : spec.broad) + depth), body.segments[key].length) / span(2 * spec.broad, spec.thigh));
}
