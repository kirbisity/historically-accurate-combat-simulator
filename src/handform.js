// The hand and what is worn on it, as geometry (no materials: wardrobe.js buildHand dresses the parts).
//
// One builder for every hand and every posture. A palm is lofted from cross-sections from the wrist to the knuckles (broad at
// the knuckles, narrowing to the wrist, the thenar and hypothenar pads on its inner face); four fingers of three segments and
// a thumb of two on its own saddle base are tubes swept along their joints, each joint a fan of sections about the crease on
// the finger's inner side, so the knuckle stands out on the back as it bends. A posture is a set of joint angles (handPose):
// a fist, a hand closed on a handle of a given thickness, a hook on a string, a hand hanging half open are the same hand
// with its fingers closed until they meet what they hold, the palm or each other. What is worn (HAND_COVERS_DRAWN) is laid
// on the same joints, so a gauntlet's lames and a glove's fingers bend with the hand.
//
// Everything is modelled for a man HAND_STATURE tall, in metres, and scaled to the wearer where it is drawn. Inside, a hand
// is in its own frame [u, v, w]: u from the wrist out to the fingertips, v out of the back of the hand, w to the thumb's
// side, the origin the wrist joint. It is given out in the forearm's frame at the hand point (rig.js: x the forearm's
// front, y along it, z across), the thumb to the front as a hanging arm holds it; a left hand is the right one mirrored.

const HAND_STATURE = 1.8;

// The hand's proportions: its length 0.109 of stature and its breadth at the knuckles 0.44 of that (ANSUR II's hand length
// and breadth, men and women within a hundredth of each other as shares of stature).
export const HAND = { length: 0.109, breadth: 0.44 };

const HAND_LONG = HAND.length * HAND_STATURE;

// The fingers, index to little, in hand lengths: `root` the knuckle joint [u, v, w], `bones` the three segments' lengths,
// `half` the half breadth at the middle joint. The joint-to-joint lengths are Buchholz, Armstrong and Goldstein's (1992)
// shares of hand length, as remembered and unverified against the paper; they give the middle finger 0.44 of the hand
// past the web and segments near 5:3:2. The knuckles lie on an arc, the middle one furthest out and highest.
const HAND_FINGERS = [
  { root: [0.455, 0.016, 0.142], bones: [0.245, 0.143, 0.097], half: 0.05, splay: 0.07 },
  { root: [0.446, 0.022, 0.038], bones: [0.266, 0.17, 0.108], half: 0.051, splay: 0.015 },
  { root: [0.418, 0.017, -0.066], bones: [0.244, 0.165, 0.107], half: 0.047, splay: -0.045 },
  { root: [0.38, 0.006, -0.164], bones: [0.204, 0.117, 0.093], half: 0.042, splay: -0.11 },
];
// The thumb: its saddle joint at the heel of the hand on the thumb's side, a metacarpal and two segments.
const HAND_THUMB = { root: [0.105, -0.045, 0.118], bones: [0.251, 0.196, 0.158], half: 0.058 };
// A finger's section against its half breadth: out of the back, into the pad, and how deep under the middle the crease it bends about lies.
const HAND_SECTION = { back: 0.84, pad: 0.92, crease: 0.12 };
// How far each joint bends (rad): the knuckle, the middle and the end joints of a finger; the thumb's two.
const HAND_LIMITS = { finger: [1.5, 1.98, 1.3], thumb: [1.0, 1.35] };
// A hand closed on a handle: the wrist joint this far inside the forearm's end (m), which sets the handle under the knuckles.
const HAND_GRIP_WRIST = 0.004;
// The palm (hand lengths): at the knuckles its back over the joints' line and its face under it, half its thickness at the
// wrist, the wrist's half breadth, and how far the webs run past the knuckle line.
const HAND_PALM = { backKnuckle: 0.05, faceKnuckle: 0.07, thickWrist: 0.092, wristHalf: 0.148, web: 0.055 };

const handClamp = (x, low = 0, high = 1) => Math.min(high, Math.max(low, x));
const handLerp = (a, b, t) => a + (b - a) * t;
const handEase = (a, b, x) => {
  const t = handClamp((x - a) / (b - a));
  return t * t * (3 - 2 * t);
};
const handBump = (x) => Math.exp(-x * x);
const handAdd = (a, b, s = 1) => [a[0] + b[0] * s, a[1] + b[1] * s, a[2] + b[2] * s];
const handSub = (a, b) => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
const handDot = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const handCross = (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
const handUnit = (a) => {
  const length = Math.hypot(a[0], a[1], a[2]) || 1;
  return [a[0] / length, a[1] / length, a[2] / length];
};
/** `v` turned about the unit `axis` by `angle`. */
function handTurn(v, axis, angle) {
  const c = Math.cos(angle);
  const s = Math.sin(angle);
  const cross = handCross(axis, v);
  const along = handDot(axis, v) * (1 - c);
  return [v[0] * c + cross[0] * s + axis[0] * along, v[1] * c + cross[1] * s + axis[1] * along, v[2] * c + cross[2] * s + axis[2] * along];
}

/** The hand's sizes for a build: `girth` thickens the fingers and the palm (a heavy frame's hand), the lengths as they are. */
function handSizes(girth = 1) {
  const L = HAND_LONG;
  return {
    L,
    girth,
    fingers: HAND_FINGERS.map((finger) => ({ root: finger.root.map((x) => x * L), bones: finger.bones.map((x) => x * L), half: finger.half * L * girth, splay: finger.splay })),
    thumb: { root: HAND_THUMB.root.map((x) => x * L), bones: HAND_THUMB.bones.map((x) => x * L), half: HAND_THUMB.half * L * girth },
    palmHalf: HAND_PALM.faceKnuckle * L * girth,
  };
}

/**
 * A digit's joints for its angles: each segment's { from, to, fwd, up, side, hinge, turn }, `from` the middle of its near
 * end, `hinge` the crease it turned about and `turn` by how much, `inFwd`/`inUp` the frame it turned from. A joint turns
 * about the crease on the inner side (HAND_SECTION.crease under the middle), so the inner side shortens and the back
 * lengthens round the knuckle as a finger's does.
 */
function handChain(root, frame, bones, bends, half) {
  let at = root;
  let { fwd, up } = frame;
  const side = handCross(fwd, up);
  const depth = HAND_SECTION.crease * HAND_SECTION.pad * half;
  const segments = [];
  for (let joint = 0; joint < bones.length; joint += 1) {
    const turn = bends[joint] ?? 0;
    const hinge = handAdd(at, up, -depth);
    const inFwd = fwd;
    const inUp = up;
    fwd = handTurn(fwd, side, -turn);
    up = handTurn(up, side, -turn);
    const from = handAdd(hinge, up, depth);
    const to = handAdd(from, fwd, bones[joint]);
    segments.push({ from, to, fwd, up, side, hinge, turn, inFwd, inUp, length: bones[joint] });
    at = to;
  }
  return segments;
}

/** A finger's frame at its knuckle: along the hand, fanned by its own splay and the posture's spread. */
function handFingerFrame(finger, spread) {
  const angle = finger.splay + spread;
  return { fwd: [Math.cos(angle), 0, Math.sin(angle)], up: [0, 1, 0] };
}

/**
 * The thumb's frame at its saddle joint: `out` (rad) away from the index finger in the palm's plane, `fore` out of the
 * palm's face, `roll` its nail turned from facing sideways (0: the pad facing the fingers, opposed) round to facing as the
 * fingers' nails do (π/2).
 */
function handThumbFrame(out, fore, roll) {
  const fwd = handUnit([Math.cos(out) * Math.cos(fore), -Math.sin(fore), Math.sin(out) * Math.cos(fore)]);
  const wanted = [0, Math.sin(roll), Math.cos(roll)];
  const up = handUnit(handSub(wanted, fwd.map((x) => x * handDot(wanted, fwd))));
  return { fwd, up };
}

/** How near a segment a→b comes to the line through `point` along the unit `dir`. */
function handLineGap(a, b, point, dir) {
  const flat = (v) => handSub(v, dir.map((x) => x * handDot(v, dir)));
  const start = flat(handSub(a, point));
  const run = flat(handSub(b, a));
  const length = handDot(run, run);
  const t = length > 1e-12 ? handClamp(-handDot(start, run) / length) : 0;
  return Math.hypot(...handAdd(start, run, t));
}

/** How near a point comes to the segment a→b. */
function handSegmentGap(p, a, b) {
  const run = handSub(b, a);
  const length = handDot(run, run);
  const t = length > 1e-12 ? handClamp(handDot(handSub(p, a), run) / length) : 0;
  return Math.hypot(...handSub(p, handAdd(a, run, t)));
}

// The postures. Of each:
// - `fingers`: how the four fingers close: 'wrap' (each joint in turn bent until its segment meets what is held, the palm,
//   or its limit: a fist with nothing held), or [knuckle, middle, end] angles as shares of the limits (for index and little:
//   [index's, little's], the two between graded);
// - `spread`: the fingers fanned apart (rad, index to little spread this much each side of the middle);
// - `thumb`: [out, fore, roll] (handThumbFrame) and `thumbBend`: 'wrap' (closed on what is held and over the fingers), or
//   its two joints' shares;
// - `hold`: where what is held lies: 'palm' (across the palm under the knuckles, a handle), or none;
// - `cup`: the palm hollowed, the little finger's side drawn in; `drop`: the wrist let fall (rad, a limp hand's).
const HAND_POSTURES = {
  // A fist: the fingers shut on the palm, the thumb closed across the first two.
  fist: { fingers: 'wrap', spread: -0.02, thumb: [0.4, 0.72, 0.05], thumbBend: 'wrap', cup: 0.6 },
  // Closed on a handle: the same, round its thickness.
  grip: { fingers: 'wrap', spread: -0.02, thumb: [0.42, 0.78, 0.05], thumbBend: 'wrap', hold: 'palm', cup: 0.7 },
  // The handle lying aslant from the heel of the hand to the first finger's middle joint, the thumb laid along its back
  // towards the blade: a sabre's or a spear's held in line with the forearm.
  slant: { fingers: 'wrap', spread: 0.02, thumb: [0.12, 0.72, 0.3], thumbBend: [0.25, 0.2], hold: 'palm', cup: 0.6 },
  // The fingers hooked at their middle joints, the knuckles nearly straight (a string drawn on three fingers, a ledge hung from).
  hook: { fingers: [[0.1, 0.5], [0.72, 0.85], [0.55, 0.6]], spread: -0.03, thumb: [0.3, 0.5, 0.5], thumbBend: [0.3, 0.4], cup: 0.3 },
  // A hand at rest: hanging half open, each finger a little more bent than the one before it.
  rest: { fingers: [[0.22, 0.34], [0.3, 0.48], [0.22, 0.4]], spread: 0.03, thumb: [0.38, 0.5, 0.6], thumbBend: [0.2, 0.25], cup: 0.35 },
  // A hand with no life in it: opener than at rest, the wrist fallen.
  limp: { fingers: [[0.14, 0.26], [0.24, 0.4], [0.16, 0.3]], spread: 0.05, thumb: [0.45, 0.38, 0.75], thumbBend: [0.12, 0.2], cup: 0.2, drop: 0.3 },
  // An open hand: fingers straight and a little apart (a push, a hand reaching to take hold).
  open: { fingers: [[0.06, 0.1], [0.06, 0.1], [0.04, 0.06]], spread: 0.11, thumb: [0.55, 0.25, 0.9], thumbBend: [0.05, 0.08], cup: 0.1 },
};

/**
 * A posture's joint angles, for a hand's sizes: { fingers: 4 × [spread, knuckle, middle, end], thumb: [out, fore, roll,
 * joint, end], cup, drop, lean, at }, all numbers, so two blend (handBlend). `spec`: { hold: a HAND_POSTURES name,
 * radius: what is held, its half thickness (m, at HAND_STATURE), slant: the handle's lean from square across the palm
 * (rad, its thumb end towards the fingertips) }. `heel`: the wrist behind the hand point; `face`: the knuckles' face ahead
 * of it, where a fist strikes from (m, at HAND_STATURE). `lean`: the wrist bent back (rad) and `at`: where the wrist joint
 * sits in the forearm's frame, so that what is held lies on the hand point, or a fist's face stands at `face`.
 */
export function handPose(spec, { heel = 0.0637, face = 0.042, girth = 1 } = {}) {
  const posture = HAND_POSTURES[spec.hold] ?? HAND_POSTURES.rest;
  const sizes = handSizes(girth);
  const radius = posture.hold ? Math.max(0.002, spec.radius ?? 0.015) : 0;
  const slant = posture.hold === 'palm' ? spec.slant ?? 0 : 0;
  // What is held: a line through `held` along `heldDir`, across the palm under the knuckles, clear of the palm by its own
  // thickness. It lies on the hand point, `heel` from the forearm's end: the wrist joint HAND_GRIP_WRIST inside that end.
  let held = null;
  const heldDir = [Math.sin(slant), 0, Math.cos(slant)];
  if (posture.hold === 'palm') {
    const deep = sizes.palmHalf + radius;
    const reach = heel + HAND_GRIP_WRIST;
    held = [Math.sqrt(Math.max(0.03 ** 2, reach * reach - deep * deep)), -deep, 0];
  }
  const palmFace = -(sizes.palmHalf * 1.05);
  const fingers = sizes.fingers.map((finger, index) => {
    const graded = index / 3;
    const spread = posture.spread * (1.5 - index);
    const pad = HAND_SECTION.pad * finger.half;
    const frame = handFingerFrame(finger, spread);
    if (posture.fingers !== 'wrap') {
      return [spread, ...posture.fingers.map(([first, last], joint) => handLerp(first, last, graded) * HAND_LIMITS.finger[joint])];
    }
    // Each joint in turn, bent until its segment meets what is held or the palm.
    const bends = [0, 0, 0];
    for (let joint = 0; joint < 3; joint += 1) {
      const limit = HAND_LIMITS.finger[joint];
      for (let bend = 0; bend <= limit; bend += 0.03) {
        bends[joint] = bend;
        const segment = handChain(finger.root, frame, finger.bones, bends, finger.half)[joint];
        if (held && handLineGap(segment.from, segment.to, held, heldDir) < radius + pad) break;
        // (A segment turned back over the palm comes down on it.)
        if (joint > 0 && segment.to[0] < finger.root[0] - 0.2 * finger.bones[0] && segment.to[1] + pad * 0.9 > palmFace) break;
      }
    }
    return [spread, ...bends];
  });
  // The thumb, closed on what is held and on the fingers already closed.
  const [out, fore, roll] = posture.thumb;
  let thumbBends;
  if (posture.thumbBend === 'wrap') {
    const chains = fingers.slice(0, 3).map((angles, index) => {
      const finger = sizes.fingers[index];
      return { segments: handChain(finger.root, handFingerFrame(finger, angles[0]), finger.bones, angles.slice(1), finger.half), half: finger.half };
    });
    const pad = HAND_SECTION.pad * sizes.thumb.half;
    const frame = handThumbFrame(out, fore, roll);
    thumbBends = [0, 0, 0];
    for (let joint = 1; joint < 3; joint += 1) {
      const limit = HAND_LIMITS.thumb[joint - 1];
      for (let bend = 0; bend <= limit; bend += 0.03) {
        thumbBends[joint] = bend;
        const segment = handChain(sizes.thumb.root, frame, sizes.thumb.bones, thumbBends, sizes.thumb.half)[joint];
        if (held && handLineGap(handAdd(segment.from, segment.fwd, segment.length * 0.5), segment.to, held, heldDir) < 0.85 * (radius + pad)) break;
        let met = false;
        // (Its far half only, and pressed in a little: the thumb's root lies against the first finger's end whatever it does.)
        for (const share of [0.6, 1]) {
          const point = handAdd(segment.from, segment.fwd, segment.length * share);
          for (const chain of chains) for (const other of chain.segments) if (handSegmentGap(point, other.from, other.to) < 0.82 * (HAND_SECTION.back * chain.half + pad)) met = true;
        }
        if (met) break;
      }
    }
    thumbBends = thumbBends.slice(1);
  } else thumbBends = posture.thumbBend.map((share, joint) => share * HAND_LIMITS.thumb[joint]);
  const pose = { fingers, thumb: [out, fore, roll, ...thumbBends], cup: posture.cup ?? 0, drop: posture.drop ?? 0, lean: 0, at: [0, -heel, 0] };
  if (held) {
    // What is held lies on the hand point: the wrist bent back until it does, and set that far behind it.
    pose.lean = Math.atan2(-held[1], held[0]);
    pose.at = [0, -Math.hypot(held[0], held[1]), 0];
  } else {
    // An empty hand: its wrist where a fist's knuckles stand `face` ahead of the hand point.
    const fist = spec.hold === 'fist' ? pose : handPose({ hold: 'fist' }, { heel, face, girth });
    pose.at = spec.hold === 'fist' ? [0, face - handReach(pose, sizes), 0] : fist.at.slice();
  }
  return pose;
}

/** How far out from the wrist a posture's fingers reach (the knuckles' face of a fist). */
function handReach(pose, sizes) {
  let reach = 0;
  sizes.fingers.forEach((finger, index) => {
    for (const ring of handDigitRings(finger, handFingerFrame(finger, pose.fingers[index][0]), pose.fingers[index].slice(1), { around: 6, fans: 2 })) for (const point of ring.points ?? []) reach = Math.max(reach, point[0]);
  });
  return reach;
}

/** Two postures' angles blended (`t` 0 to 1). */
export function handBlend(a, b, t) {
  const mix = (x, y) => (Array.isArray(x) ? x.map((value, index) => mix(value, y[index])) : handLerp(x, y, t));
  return { fingers: mix(a.fingers, b.fingers), thumb: mix(a.thumb, b.thumb), cup: mix(a.cup, b.cup), drop: mix(a.drop, b.drop), lean: mix(a.lean, b.lean), at: mix(a.at, b.at) };
}

/**
 * A digit's sections from its root to its tip: rings of points round it ({ points, along: 0 at the root to 1 at the tip,
 * for the maps }), each point's turn round the ring from the middle of the inner side. A joint is a fan of rings about its
 * crease: on the back the skin runs round the knuckle, which stands out as it bends; on the inner side the rings meet in
 * the crease. `thumb`: a metacarpal first, thick with the ball of the thumb. `grow`: a covering's thickness over the skin.
 */
function handDigitRings(digit, frame, bends, { around = 10, fans = 3, thumb = false, grow = 0, bury = 0.3 } = {}) {
  const half = digit.half;
  const segments = handChain(digit.root, frame, digit.bones, thumb ? [0, ...bends] : bends, half);
  const rings = [];
  const count = segments.length;
  // The section's breadth and depth along the digit, as shares of its half breadth (thicker at the root, finer to the tip).
  const taper = (station) => handLerp(thumb ? 1.12 : 1.1, thumb ? 0.86 : 0.8, handClamp(station / count));
  const ring = (centre, up, side, station, { swell = 0, pinch = 0, squash = 1, shrink = 1, lift = 0 } = {}) => {
    const wide = half * taper(station) * shrink + grow;
    const back = HAND_SECTION.back * half * taper(station) * shrink * (1 + swell) + grow;
    const pad = HAND_SECTION.pad * half * taper(station) * shrink * (1 - pinch) + grow;
    const points = [];
    for (let k = 0; k <= around; k += 1) {
      const angle = -Math.PI + (k / around) * 2 * Math.PI;
      const c = Math.cos(angle);
      const s = Math.sin(angle);
      // (Squarer than an ellipse: a finger's sides are nearly flat.)
      const round = (x) => Math.sign(x) * Math.abs(x) ** 0.82;
      const high = c > 0 ? back * round(c) * squash : pad * round(c);
      points.push(handAdd(handAdd(centre, up, high + lift), side, wide * round(s)));
    }
    rings.push({ points, along: handClamp(station / count), centre, up, side });
  };
  segments.forEach((segment, index) => {
    const { side } = segment;
    if (index === 0) {
      // The root, sunk into the palm behind the knuckle.
      if (!thumb) ring(handAdd(segment.from, segment.inFwd, -bury * segment.length), segment.inUp, side, -0.25, { shrink: 0.96 });
      else ring(handAdd(segment.from, segment.fwd, -0.12 * segment.length), segment.up, side, -0.1, { shrink: 1.5 });
    }
    if (!(thumb && index === 0)) {
      // The joint: a fan about its crease, the knuckle swelling on the back as it bends.
      const bent = Math.sin(Math.min(Math.PI / 2, Math.abs(segment.turn) / 1.2));
      const knuckle = (index === 0 || (thumb && index === 1) ? 0.2 : 0.13) * bent + (index === 0 ? 0.04 : 0.07);
      const depth = HAND_SECTION.crease * HAND_SECTION.pad * half;
      for (let k = 0; k <= fans; k += 1) {
        const share = k / fans;
        const up = handTurn(segment.inUp, side, -segment.turn * share);
        const middle = Math.sin(share * Math.PI);
        ring(handAdd(segment.hinge, up, depth), up, side, index + 0.02 * (share - 0.5), { swell: knuckle * (0.55 + 0.45 * middle), pinch: (0.1 + 0.5 * bent) * middle });
      }
    }
    const last = index === count - 1;
    if (!last) ring(handAdd(segment.from, segment.fwd, segment.length * 0.5), segment.up, side, index + 0.5, thumb && index === 0 ? { pinch: -0.35, shrink: 1.3 } : { pinch: -0.06 - 0.1 * Math.sin(Math.min(Math.PI / 2, segments[index + 1].turn)), swell: -0.06 });
    else {
      // The end segment: the pad, the nail's flat, the rounded tip.
      const tip = half * taper(count) * 0.95;
      ring(handAdd(segment.from, segment.fwd, segment.length * 0.42), segment.up, side, index + 0.42, { pinch: -0.1, swell: -0.08 });
      ring(handAdd(segment.from, segment.fwd, segment.length - tip * 0.95), segment.up, side, index + 0.74, { pinch: -0.04, squash: 0.82 });
      ring(handAdd(segment.from, segment.fwd, segment.length - tip * 0.4), segment.up, side, index + 0.9, { shrink: 0.8, squash: 0.72, lift: -0.06 * half });
      ring(handAdd(segment.from, segment.fwd, segment.length - tip * 0.08), segment.up, side, index + 0.98, { shrink: 0.42, squash: 0.7, lift: -0.1 * half });
      rings.push({ apex: handAdd(handAdd(segment.from, segment.fwd, segment.length + grow), segment.up, -0.12 * half), along: 1 });
    }
  });
  rings.segments = segments;
  return rings;
}

// Where each surface lies on the hand's sheet (handmaps.js draws it): [x0, x1] of its width; the back of the hand, the palm,
// and a digit unrolled (its back down the middle of the strip, the seam on its inner side).
export const HAND_SHEET = { back: [0, 0.375], palm: [0.375, 0.75], digit: [0.75, 1] };

/** A mesh being gathered: points with their sheet coordinates, and triangles. */
function handMesh() {
  return { positions: [], uvs: [], indices: [] };
}
function handPoint(mesh, point, uv) {
  mesh.positions.push(point[0], point[1], point[2]);
  mesh.uvs.push(uv[0], uv[1]);
  return mesh.positions.length / 3 - 1;
}
/** Rows of points (each a list of indices, the same count) joined into a skin. */
function handSkin(mesh, rows) {
  for (let row = 0; row + 1 < rows.length; row += 1) {
    const a = rows[row];
    const b = rows[row + 1];
    if (b.length === 1) {
      for (let k = 0; k + 1 < a.length; k += 1) mesh.indices.push(a[k], a[k + 1], b[0]);
      continue;
    }
    for (let k = 0; k + 1 < a.length; k += 1) mesh.indices.push(a[k], a[k + 1], b[k + 1], a[k], b[k + 1], b[k]);
  }
}

/** A digit's rings as a skin on the sheet's digit strip (`from`, `to`: the stretch of the strip's length it takes). */
function handDigitSkin(mesh, rings, [from, to] = [0, 1]) {
  const [x0, x1] = HAND_SHEET.digit;
  const rows = rings.map((ring) => {
    const y = handLerp(from, to, ring.along);
    if (ring.apex) return [handPoint(mesh, ring.apex, [(x0 + x1) / 2, y])];
    return ring.points.map((point, k) => handPoint(mesh, point, [handLerp(x0, x1, k / (ring.points.length - 1)), y]));
  });
  handSkin(mesh, rows);
}

/** The knuckle line's distance from the wrist at `w` across the hand: through the four knuckles, level beyond them. */
function handKnuckleLine(sizes, w) {
  const roots = sizes.fingers.map((finger) => finger.root);
  if (w >= roots[0][2]) return roots[0][0] - 0.25 * (w - roots[0][2]);
  for (let index = 0; index < 3; index += 1) {
    if (w >= roots[index + 1][2]) return handLerp(roots[index + 1][0], roots[index][0], (w - roots[index + 1][2]) / (roots[index][2] - roots[index + 1][2]));
  }
  return roots[3][0] - 0.35 * (roots[3][2] - w);
}

// The palm's sections from the wrist (0) to the knuckle line (1) and the webs past it.
const HAND_PALM_STATIONS = { full: [0.0, 0.1, 0.22, 0.36, 0.5, 0.64, 0.78, 0.9, 1.0, 1.07, 1.13], low: [0.0, 0.3, 0.65, 1.0, 1.12] };

/** The palm's middle and half breadth across, at a station from the wrist (0) to the knuckle line (1). */
function handPalmSpan(inside, L) {
  const thumbEdge = handLerp(HAND_PALM.wristHalf, HAND_FINGERS[0].root[2] + HAND_FINGERS[0].half * 1.12, handEase(0, 1, inside) * 0.55 + inside * 0.45) * L;
  const littleEdge = -handLerp(HAND_PALM.wristHalf, -HAND_FINGERS[3].root[2] + HAND_FINGERS[3].half * 1.2, handEase(0, 0.9, inside) * 0.6 + inside * 0.4) * L;
  return [(thumbEdge + littleEdge) / 2, (thumbEdge - littleEdge) / 2];
}
const handPalmPower = (inside) => 2 / handLerp(2.2, 2.9, handEase(0, 0.6, inside));
// How the palm's sections lie on the sheet: across (a share of the half turn from one edge to the other) and along.
const handSheetAcross = (share) => 0.04 + 0.92 * share;
const handSheetAlong = (s) => handLerp(0.02, 0.98, (s + 0.2) / 1.33);

/**
 * Where a place on the back of the hand or the palm lies on the sheet, for what is drawn there (handmaps.js): `surface`
 * 'back' or 'palm', `s` from the wrist (0) to the knuckle line (1), `w` across in hand lengths (to the thumb's side).
 * Returns [x, y], each 0 to 1 of the sheet.
 */
export function handSheetAt(surface, s, w) {
  const inside = handClamp(s);
  const [middle, breadth] = handPalmSpan(inside, 1);
  const across = handClamp((w - middle) / breadth, -1, 1);
  const turn = Math.asin(Math.sign(across) * Math.abs(across) ** (1 / handPalmPower(inside)));
  const share = surface === 'back' ? (turn + Math.PI / 2) / Math.PI : (Math.PI / 2 - turn) / Math.PI;
  const [x0, x1] = HAND_SHEET[surface];
  return [handLerp(x0, x1, handSheetAcross(share)), handSheetAlong(s)];
}
/** The knuckles' places across the hand (hand lengths, index to little), for the sheet. */
export const HAND_KNUCKLES = HAND_FINGERS.map((finger) => finger.root[2]);

/**
 * The palm's surface at station `s` and turn `angle` round it (0 the middle of the back, ±π the middle of the palm's
 * face, positive to the thumb's side), in the hand's frame; `grow`: a covering's thickness.
 */
function handPalmPoint(sizes, pose, s, angle, grow = 0) {
  const L = sizes.L;
  const inside = handClamp(s);
  const c = Math.cos(angle);
  const sn = Math.sin(angle);
  // Squarer towards the knuckles (a flat slab), rounder at the wrist.
  const power = handPalmPower(inside);
  const across = Math.sign(sn) * Math.abs(sn) ** power;
  const high = Math.sign(c) * Math.abs(c) ** power;
  const [middle, halfBreadth] = handPalmSpan(inside, L);
  const breadth = halfBreadth * (1 + (sizes.girth - 1) * 0.5) + grow;
  const w = middle + breadth * across;
  const line = handKnuckleLine(sizes, w);
  // The mean bend of the knuckles: the webs past the knuckle line turn with the fingers' roots.
  const bend = pose.fingers.reduce((sum, finger) => sum + finger[1], 0) / 4;
  let u = inside * line;
  let drop = 0;
  if (s > 1) {
    const past = ((s - 1) / 0.13) * HAND_PALM.web * L;
    u += past * Math.cos(bend * 0.8);
    drop = past * Math.sin(bend * 0.8);
  }
  const thick = handLerp(HAND_PALM.thickWrist, high >= 0 ? HAND_PALM.backKnuckle : HAND_PALM.faceKnuckle, handEase(0, 0.75, inside)) * L * sizes.girth * (s > 1 ? handLerp(1, 0.62, handClamp((s - 1) / 0.13)) : 1);
  // The transverse arch: the back highest over the middle finger's bone, falling to the little finger's side.
  const arch = 0.012 * L * inside * (1 - ((w - 0.03 * L) / (0.2 * L)) ** 2);
  let v;
  if (high >= 0) v = arch + (thick + grow) * high;
  else {
    const share = u / L;
    const side = w / L;
    // The ball of the thumb, the heel on the little finger's side, the pads under the knuckles, the hollow between.
    const thenar = 0.05 * handBump((share - 0.2) / 0.15) * handBump((side - 0.1) / 0.085);
    const heel = 0.03 * handBump((share - 0.16) / 0.16) * handBump((side + 0.105) / 0.07);
    const pads = 0.018 * handBump((inside - 0.93) / 0.12);
    const hollow = 0.022 * handBump((share - 0.27) / 0.11) * handBump((side + 0.005) / 0.07);
    v = arch * 0.4 + (thick + grow + (thenar + heel + pads - hollow) * L * sizes.girth) * high;
  }
  // The palm hollowed: its edges, the little finger's the more, drawn towards its face.
  v -= pose.cup * 0.05 * L * inside * (across < 0 ? across * across * 1.2 : across * across * 0.5) + drop;
  return [u, v, w];
}

/**
 * The parts of a hand in a posture, in the forearm's frame at the hand point, for a man HAND_STATURE tall: { parts: { role:
 * { positions, normals, uvs, indices } }, triangles }. `pose`: handPose's (or a blend). `side`: 'l' or 'r'. `fit`: the
 * forearm's end the wrist runs into: { a, b: its half breadth along the forearm's x and z, heel: how far behind the hand
 * point (m, at HAND_STATURE) }. `detail`: 'full', or 'low' (a crowd's: fewer sections, the same shape). `girth`: a heavy
 * build's thicker hand. `cover`: what is worn (HAND_WEAR's name) and `wear`: its design's own figures.
 */
export function handParts(pose, { side = 'r', fit = null, detail = 'full', girth = 1, cover = 'bare', wear = {} } = {}) {
  const low = detail === 'low';
  const sizes = handSizes(girth);
  const spec = HAND_WEAR[cover] ?? HAND_WEAR.bare;
  const grow = spec.thick ?? 0;
  const meshes = {};
  const mesh = (role) => (meshes[role] ??= handMesh());
  const skin = mesh(spec.role);
  const around = low ? 5 : 10;
  const fans = low ? 1 : 3;
  // The fingers and the thumb.
  const digits = [];
  // (A mitten's four fingers are one: they bend as the middle one does.)
  const fingerAngles = spec.mitten ? pose.fingers.map((angles) => [angles[0], ...pose.fingers[1].slice(1)]) : pose.fingers;
  sizes.fingers.forEach((finger, index) => {
    const rings = handDigitRings(finger, handFingerFrame(finger, fingerAngles[index][0]), fingerAngles[index].slice(1), { around, fans, grow });
    digits.push(rings);
    handDigitSkin(skin, rings);
  });
  const [out, fore, roll, ...thumbBends] = pose.thumb;
  const thumbRings = handDigitRings(sizes.thumb, handThumbFrame(out, fore, roll), thumbBends, { around, fans, thumb: true, grow });
  digits.push(thumbRings);
  handDigitSkin(skin, thumbRings);
  // The palm, back and face as two skins meeting along its edges (each has its own place on the sheet).
  const stations = HAND_PALM_STATIONS[low ? 'low' : 'full'];
  const half = low ? 4 : 8;
  const palmRows = { back: [], palm: [] };
  const palmStart = skin.positions.length / 3;
  for (const [name, [x0, x1], from] of [['back', HAND_SHEET.back, -Math.PI / 2], ['palm', HAND_SHEET.palm, Math.PI / 2]]) {
    // (Two sections first for the wrist: fitted to the forearm's end below.)
    for (const s of [-0.2, -0.1, ...stations]) {
      const row = [];
      for (let k = 0; k <= half; k += 1) {
        const angle = from + (k / half) * Math.PI;
        const point = handPalmPoint(sizes, pose, Math.max(0, s), angle, grow);
        row.push(handPoint(skin, point, [handLerp(x0, x1, handSheetAcross(k / half)), handSheetAlong(s)]));
      }
      palmRows[name].push(row);
    }
    // (Closed over the webs' end.)
    const end = palmRows[name][palmRows[name].length - 1];
    const middle = handPalmPoint(sizes, pose, stations[stations.length - 1] + 0.02, name === 'back' ? 0 : Math.PI, grow);
    palmRows[name].push([handPoint(skin, [middle[0], (skin.positions[end[0] * 3 + 1] + skin.positions[end[half] * 3 + 1]) / 2, middle[2]], [(x0 + x1) / 2, 0.99])]);
    handSkin(skin, palmRows[name]);
  }
  const palmEnd = skin.positions.length / 3;
  // The web between the thumb and the first finger: two skins from the palm's edge to the thumb's inner side, its free edge drawn in.
  {
    const thumbSegments = thumbRings.segments;
    const along = low ? [0, 0.5, 1] : [0, 0.25, 0.5, 0.75, 1];
    const rows = { back: [], palm: [] };
    for (const share of along) {
      const edge = handPalmPoint(sizes, pose, handLerp(0.3, 0.9, share), Math.PI / 2, grow);
      // (Along the thumb from the middle of its first bone to a little past its knuckle.)
      const reach = handLerp(0.35, 1.22, share);
      const segment = thumbSegments[reach <= 1 ? 0 : 1];
      const onThumb = reach <= 1 ? handAdd(segment.from, segment.fwd, segment.length * reach) : handAdd(segment.from, segment.fwd, segment.length * (reach - 1) * 1.6);
      const span = handSub(edge, onThumb);
      const across = handUnit(span);
      const normal = handUnit(handCross(across, segment.fwd));
      // (The skin's back to the back of the hand.)
      const out = normal[1] >= 0 ? normal : normal.map((x) => -x);
      const thick = sizes.thumb.half * 0.8 + grow;
      const sag = 0.3 * Math.sin(share * Math.PI * 0.5) ** 2;
      for (const [name, sign, [x0, x1]] of [['back', 1, HAND_SHEET.back], ['palm', -1, HAND_SHEET.palm]]) {
        const row = [0.1, 0.5, 0.9].map((part, column) => {
          const lean = column === 1 ? 0.8 : 1;
          const base = handAdd(onThumb, span, part);
          // (The free edge hangs back towards the wrist between its two ends.)
          const hung = handAdd(base, segment.fwd, -sag * Math.sin(part * Math.PI) * Math.hypot(...span));
          return handPoint(skin, handAdd(hung, out, sign * thick * lean), [handLerp(x0, x1, name === 'back' ? 0.9 : 0.1), handSheetAlong(handLerp(0.3, 0.7, share))]);
        });
        rows[name].push(row);
      }
    }
    // (Each skin wound to face out of the hand: the back's to the back.)
    const facing = (name, sign) => {
      const start = skin.indices.length;
      handSkin(skin, rows[name]);
      const corner = (k) => [0, 1, 2].map((axis) => skin.positions[skin.indices[start + k] * 3 + axis]);
      const normal = handCross(handSub(corner(1), corner(0)), handSub(corner(2), corner(0)));
      if (normal[1] * sign < 0) for (let index = start; index < skin.indices.length; index += 3) [skin.indices[index + 1], skin.indices[index + 2]] = [skin.indices[index + 2], skin.indices[index + 1]];
    };
    facing('back', 1);
    facing('palm', -1);
    // (Closed along the free edge.)
    const edge = skin.indices.length;
    handSkin(skin, [rows.back[along.length - 1], rows.palm[along.length - 1]]);
    const corner = (k) => [0, 1, 2].map((axis) => skin.positions[skin.indices[edge + k] * 3 + axis]);
    if (handCross(handSub(corner(1), corner(0)), handSub(corner(2), corner(0)))[0] < 0) for (let index = edge; index < skin.indices.length; index += 3) [skin.indices[index + 1], skin.indices[index + 2]] = [skin.indices[index + 2], skin.indices[index + 1]];
  }
  // What is worn over it: plates, a cuff.
  const context = { sizes, pose, digits, mesh, low, wear, grow, fingerAngles };
  for (const piece of spec.pieces ?? []) HAND_PIECES[piece.kind](context, piece);

  // Into the forearm's frame: the wrist bent back by the posture's `lean` (less a limp wrist's `drop`), the wrist joint at
  // `at`; the thumb's side to the forearm's front, the back of a right hand to -z.
  const lean = pose.lean - pose.drop;
  const c = Math.cos(lean);
  const s = Math.sin(lean);
  const mirror = side === 'l' ? -1 : 1;
  const place = ([u, v, w]) => [w + pose.at[0], u * c - v * s + pose.at[1], -(v * c + u * s) * mirror + pose.at[2] * mirror];
  const ring = fit ?? { a: 0.03, b: 0.024, heel: -pose.at[1] };
  const parts = {};
  let triangles = 0;
  for (const [role, made] of Object.entries(meshes)) {
    const positions = new Float32Array(made.positions.length);
    for (let index = 0; index < positions.length; index += 3) positions.set(place([made.positions[index], made.positions[index + 1], made.positions[index + 2]]), index);
    if (made === skin) {
      // The wrist: the palm's first sections drawn onto the forearm's end (an oval of its size, its first ring inside
      // the forearm), so the hand runs out of the arm with no step however the wrist is bent.
      const rowLength = half + 1;
      const pull = [1, 1, 0.8, 0.4, 0.14];
      const size = 1 + grow / Math.max(0.01, Math.min(ring.a, ring.b));
      for (const [start, first] of [[palmStart, -Math.PI / 2], [palmStart + (palmEnd - palmStart) / 2, Math.PI / 2]]) {
        for (let row = 0; row < pull.length; row += 1) {
          for (let k = 0; k <= half; k += 1) {
            const angle = first + (k / half) * Math.PI;
            const at = (start + row * rowLength + k) * 3;
            const sink = row === 0 ? 0.03 : row === 1 ? 0.008 : 0;
            const shrink = row === 0 ? 0.8 : 0.97;
            const wanted = [ring.a * size * shrink * Math.sin(angle), -ring.heel - sink, -ring.b * size * shrink * Math.cos(angle) * mirror];
            const share = pull[row];
            // (Only across the arm, past the first rings: the palm keeps its own length.)
            positions[at] = handLerp(positions[at], wanted[0], share);
            if (row < 2) positions[at + 1] = wanted[1];
            positions[at + 2] = handLerp(positions[at + 2], wanted[2], share);
          }
        }
      }
    }
    const indices = Uint16Array.from(made.indices);
    // (Gathered wound for the hand's own frame, which the forearm's mirrors for a right hand.)
    if (mirror > 0) for (let index = 0; index < indices.length; index += 3) [indices[index + 1], indices[index + 2]] = [indices[index + 2], indices[index + 1]];
    parts[role] = { positions, uvs: Float32Array.from(made.uvs), indices, normals: handNormals(positions, indices) };
    triangles += indices.length / 3;
  }
  return { parts, triangles, spec };
}

/** Smooth normals, points at the same place sharing one (the sheet's seams and the palm's edges are not creases). */
function handNormals(positions, indices) {
  const count = positions.length / 3;
  const owner = new Uint32Array(count);
  const seen = new Map();
  for (let index = 0; index < count; index += 1) {
    const key = `${Math.round(positions[index * 3] * 2e4)},${Math.round(positions[index * 3 + 1] * 2e4)},${Math.round(positions[index * 3 + 2] * 2e4)}`;
    if (!seen.has(key)) seen.set(key, index);
    owner[index] = seen.get(key);
  }
  const sums = new Float32Array(positions.length);
  for (let index = 0; index < indices.length; index += 3) {
    const [a, b, c] = [indices[index] * 3, indices[index + 1] * 3, indices[index + 2] * 3];
    const ab = [positions[b] - positions[a], positions[b + 1] - positions[a + 1], positions[b + 2] - positions[a + 2]];
    const ac = [positions[c] - positions[a], positions[c + 1] - positions[a + 1], positions[c + 2] - positions[a + 2]];
    const normal = handCross(ab, ac);
    for (const corner of [indices[index], indices[index + 1], indices[index + 2]]) {
      const at = owner[corner] * 3;
      sums[at] += normal[0];
      sums[at + 1] += normal[1];
      sums[at + 2] += normal[2];
    }
  }
  const normals = new Float32Array(positions.length);
  for (let index = 0; index < count; index += 1) {
    const at = owner[index] * 3;
    const length = Math.hypot(sums[at], sums[at + 1], sums[at + 2]) || 1;
    normals[index * 3] = sums[at] / length;
    normals[index * 3 + 1] = sums[at + 1] / length;
    normals[index * 3 + 2] = sums[at + 2] / length;
  }
  return normals;
}

// What is laid on the hand (filled in below the kinds).
const HAND_PIECES = {};

/**
 * What a hand wears. Of each: `role`: what the hand itself is drawn in ('skin', 'glove': leather or cloth, 'mail'),
 * `thick`: its thickness over the skin (m), `mitten`: the four fingers in one, `pieces`: what is laid on it.
 */
export const HAND_WEAR = {
  bare: { role: 'skin' },
};

/**
 * The forearm's end, for a hand to run out of: from the body's mesh as built (`positions`), the ring of it nearest the
 * wrist (`heel` m behind the hand point `at`, in the forearm's bind `frame`), as { a, b: its half breadth along the frame's
 * x and z, heel } in metres at HAND_STATURE (`scale`: the body's own size over that). `outer`: the outermost surface there
 * (a sleeve's, for a cuff to go over), else the innermost (the skin). Null where the mesh has nothing there.
 */
export function wristFit(positions, frame, at, heel, scale = 1, outer = false) {
  const slab = [-heel - 0.035 * scale, -heel + 0.012 * scale];
  const sectors = Array.from({ length: 8 }, () => null);
  let found = 0;
  for (let vertex = 0; vertex < positions.length / 3; vertex += 1) {
    const d = [positions[vertex * 3] - at[0], positions[vertex * 3 + 1] - at[1], positions[vertex * 3 + 2] - at[2]];
    const along = handDot(d, frame.y);
    if (along < slab[0] || along > slab[1]) continue;
    const x = handDot(d, frame.x);
    const z = handDot(d, frame.z);
    const r = Math.hypot(x, z);
    if (r > 0.09 * scale) continue;
    found += 1;
    const sector = ((Math.round((Math.atan2(z, x) / (2 * Math.PI)) * 8) % 8) + 8) % 8;
    if (sectors[sector] === null || (outer ? r > sectors[sector] : r < sectors[sector])) sectors[sector] = r;
  }
  const known = sectors.filter((r) => r !== null);
  if (found < 6 || known.length < 4) return null;
  const mean = known.reduce((sum, r) => sum + r, 0) / known.length;
  const r = (sector) => sectors[sector] ?? mean;
  return { a: (r(0) + r(4)) / 2 / scale, b: (r(2) + r(6)) / 2 / scale, heel: heel / scale };
}
