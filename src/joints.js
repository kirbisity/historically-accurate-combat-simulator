// How far a limb can turn about its own length. An elbow bends one way and a
// knee the other; which way that is in the world depends on how far the
// shoulder or hip has turned the upper bone, and that has a range. A forearm
// or shin pointing where the turn cannot take it is twisted, however the
// hinge itself bends. Shared by the pose (targets within range), the physics
// (limits holding a body to it) and the tools that count what is out of it.
// Ranges: WORLD.limbTwist.

import { WORLD } from './physics/config.js';
import { vec } from './pose.js';

// The arm hangs this far out from the trunk in the rig's bind pose
// (rig.js bindPoints), the leg straight down: turns are measured from there.
const LIMB_BIND = { arm: (25 * Math.PI) / 180, leg: 0 };

/**
 * The trunk's axes from its particles: up the spine, to the left along the
 * shoulders (or `across`, the hips), forward = up × left. Null if degenerate.
 */
export function trunkAxes(pelvis, neck, leftPoint, rightPoint) {
  // (Worked in numbers, not small arrays: the physics asks this several times a man a substep. The arithmetic is vec's, in its
  // order, so the axes come out bit for bit as they did.)
  const dx = neck[0] - pelvis[0];
  const dy = neck[1] - pelvis[1];
  const dz = neck[2] - pelvis[2];
  const length = Math.sqrt(dx * dx + dy * dy + dz * dz) || 1;
  const ux = dx / length;
  const uy = dy / length;
  const uz = dz / length;
  const ax = leftPoint[0] - rightPoint[0];
  const ay = leftPoint[1] - rightPoint[1];
  const az = leftPoint[2] - rightPoint[2];
  const along = ax * ux + ay * uy + az * uz;
  const fx = ax - ux * along;
  const fy = ay - uy * along;
  const fz = az - uz * along;
  const size = Math.sqrt(fx * fx + fy * fy + fz * fz);
  if (size < 1e-6) return null;
  const inverse = 1 / size;
  const lx = fx * inverse;
  const ly = fy * inverse;
  const lz = fz * inverse;
  return { up: [ux, uy, uz], left: [lx, ly, lz], forward: [uy * lz - uz * ly, uz * lx - ux * lz, ux * ly - uy * lx] };
}

/** Rotate v about unit `axis` by `angle`. */
export function turnAbout(v, axis, angle) {
  const cos = Math.cos(angle);
  const sin = Math.sin(angle);
  return turnedBy(v[0], v[1], v[2], axis[0], axis[1], axis[2], cos, sin);
}

/** turnAbout in numbers (Rodrigues' rotation, vec's arithmetic in its order): (vx, vy, vz) about unit (ax, ay, az), by the angle of `cos` and `sin`. */
function turnedBy(vx, vy, vz, ax, ay, az, cos, sin) {
  const keep = (ax * vx + ay * vy + az * vz) * (1 - cos);
  return [vx * cos + (ay * vz - az * vy) * sin + ax * keep, vy * cos + (az * vx - ax * vz) * sin + ay * keep, vz * cos + (ax * vy - ay * vx) * sin + az * keep];
}

/**
 * A limb's turn about its upper bone. `kind` 'arm' (the forearm flexes
 * forward of the hanging upper arm) or 'leg' (the shin flexes back of the
 * hanging thigh). Returns { twist (rad, + inward), elevation (rad), bend
 * (rad, 0 straight) }, or null where the limb is too straight to say.
 * (Worked in numbers, not small arrays: the physics asks it of every limb of
 * every man each substep, and the arrays were most of what a battle threw to
 * the garbage collector. The arithmetic is vec's, in its order: the same
 * answer bit for bit.)
 */
export function limbTwist(axes, kind, side, root, middle, end) {
  if (!axes) return null;
  const upx = middle[0] - root[0];
  const upy = middle[1] - root[1];
  const upz = middle[2] - root[2];
  const lox = end[0] - middle[0];
  const loy = end[1] - middle[1];
  const loz = end[2] - middle[2];
  const upperLength = Math.sqrt(upx * upx + upy * upy + upz * upz);
  const lowerLength = Math.sqrt(lox * lox + loy * loy + loz * loz);
  if (upperLength < 1e-6 || lowerLength < 1e-6) return null;
  const upperInverse = 1 / upperLength;
  const lowerInverse = 1 / lowerLength;
  const ux = upx * upperInverse;
  const uy = upy * upperInverse;
  const uz = upz * upperInverse;
  const fx = lox * lowerInverse;
  const fy = loy * lowerInverse;
  const fz = loz * lowerInverse;
  const bend = Math.acos(Math.max(-1, Math.min(1, ux * fx + uy * fy + uz * fz)));
  if (bend < WORLD.limbTwist.from) return null;
  const left = axes.left;
  const up = axes.up;
  const forward = axes.forward;
  // Outward: his left for the left limb, else its opposite.
  const ox = side === 'l' ? left[0] : left[0] * -1;
  const oy = side === 'l' ? left[1] : left[1] * -1;
  const oz = side === 'l' ? left[2] : left[2] * -1;
  const angle = LIMB_BIND[kind];
  const down = -Math.cos(angle);
  const out = Math.sin(angle);
  const bx = up[0] * down + ox * out;
  const by = up[1] * down + oy * out;
  const bz = up[2] * down + oz * out;
  // Swung up near the opposite of hanging, the swing from hanging has no
  // one way round, and the turn no meaning.
  if (ux * bx + uy * by + uz * bz < -WORLD.limbTwist.reversed) return null;
  const kx = kind === 'arm' ? forward[0] : forward[0] * -1;
  const ky = kind === 'arm' ? forward[1] : forward[1] * -1;
  const kz = kind === 'arm' ? forward[2] : forward[2] * -1;
  // Inward is positive whichever side: the sign a turn of the bent part
  // towards the midline makes about the hanging bone.
  const nx = ox * -1;
  const ny = oy * -1;
  const nz = oz * -1;
  const sign = Math.sign((ky * nz - kz * ny) * bx + (kz * nx - kx * nz) * by + (kx * ny - ky * nx) * bz) || 1;
  // The flexing way carried by the smallest rotation taking hanging onto the upper bone (half-turned the other way: reversed).
  const sx = by * uz - bz * uy;
  const sy = bz * ux - bx * uz;
  const sz = bx * uy - by * ux;
  const swing = Math.sqrt(sx * sx + sy * sy + sz * sz);
  const across = bx * ux + by * uy + bz * uz;
  let ex;
  let ey;
  let ez;
  if (swing < 1e-6) {
    ex = across > 0 ? kx : kx * -1;
    ey = across > 0 ? ky : ky * -1;
    ez = across > 0 ? kz : kz * -1;
  } else {
    const inverse = 1 / swing;
    const turn = Math.atan2(swing, across);
    const neutral = turnedBy(kx, ky, kz, sx * inverse, sy * inverse, sz * inverse, Math.cos(turn), Math.sin(turn));
    ex = neutral[0];
    ey = neutral[1];
    ez = neutral[2];
  }
  const fu = fx * ux + fy * uy + fz * uz;
  const tx = fx - ux * fu;
  const ty = fy - uy * fu;
  const tz = fz - uz * fu;
  const twist = sign * Math.atan2((ey * tz - ez * ty) * ux + (ez * tx - ex * tz) * uy + (ex * ty - ey * tx) * uz, ex * tx + ey * ty + ez * tz);
  return { twist, elevation: Math.asin(Math.max(-1, Math.min(1, ux * up[0] + uy * up[1] + uz * up[2]))), bend };
}

/** The turn's limits at this elevation: { inward, outward } (rad). */
export function twistRange(kind, elevation) {
  const spec = WORLD.limbTwist[kind];
  const share = Math.max(0, Math.min(1, (elevation - spec.lowAt) / (spec.highAt - spec.lowAt)));
  return {
    inward: spec.low.inward + (spec.high.inward - spec.low.inward) * share,
    outward: spec.low.outward + (spec.high.outward - spec.low.outward) * share,
  };
}

/** How far (rad) a turn is past its range, `margin` inside it: + inward, − outward, 0 within. */
export function twistExcess(kind, turn, margin = 0) {
  if (!turn) return 0;
  const range = twistRange(kind, turn.elevation);
  if (turn.twist > range.inward - margin) return turn.twist - (range.inward - margin);
  if (turn.twist < -(range.outward - margin)) return turn.twist + (range.outward - margin);
  return 0;
}

/** Angle (rad) between a held weapon and the forearm holding it: past WORLD.limbTwist.wristBack it points back into the arm. */
export function wristAngle(elbow, hand, bladeDir) {
  const forearm = vec.normalize(vec.sub(hand, elbow));
  return Math.acos(Math.max(-1, Math.min(1, vec.dot(forearm, vec.normalize(bladeDir)))));
}

/**
 * A body's shoulder range (WORLD.joint.shoulder), as its build has it: an
 * animal's own (`inputs.build.shoulder`) over a man's.
 */
export function shoulderRangeOf(body) {
  const own = body?.inputs?.build?.shoulder;
  return own ? { ...WORLD.joint.shoulder, ...own } : WORLD.joint.shoulder;
}

/**
 * How far (rad) the upper arm may point behind the trunk's coronal plane at
 * this elevation (rad above the shoulders' level): `range.hanging` with the
 * arm down (extension), `range.level` with it out at the side (horizontal
 * abduction behind the back), `range.overhead` raised; straight lines between.
 */
export function shoulderBehindLimit(range, elevation) {
  const share = Math.max(-1, Math.min(1, elevation / (Math.PI / 2)));
  return share <= 0 ? range.level + (range.hanging - range.level) * -share : range.level + (range.overhead - range.level) * share;
}

/** How far (rad) an upper arm from `shoulder` to `elbow` points behind the trunk past `range`: 0 within it. */
export function shoulderExcess(axes, range, shoulder, elbow) {
  if (!axes || !range) return 0;
  const upper = vec.sub(elbow, shoulder);
  const length = vec.length(upper);
  if (length < 1e-6) return 0;
  const behind = Math.asin(Math.max(-1, Math.min(1, -vec.dot(upper, axes.forward) / length)));
  const elevation = Math.asin(Math.max(-1, Math.min(1, vec.dot(upper, axes.up) / length)));
  return Math.max(0, behind - shoulderBehindLimit(range, elevation));
}

/**
 * How far a limb's pose is out of range: the turn's excess past its range
 * (`margin` inside it; none counted if `twist` is false), how far a held
 * blade points back past the wrist's reach, and how far an upper arm points
 * behind the trunk past `shoulder` (a range, shoulderBehindLimit). 0 within range.
 */
function poseExcess(axes, kind, side, root, middle, end, { bladeDir = null, margin = 0, shoulder = null, twist = true } = {}) {
  let excess = 0;
  if (twist) excess += Math.abs(twistExcess(kind, limbTwist(axes, kind, side, root, middle, end), margin));
  if (bladeDir) excess += Math.max(0, wristAngle(middle, end, bladeDir) - (WORLD.limbTwist.wristBack - margin));
  if (shoulder && kind === 'arm') excess += shoulderExcess(axes, shoulder, root, middle);
  return excess;
}

/**
 * Swivel a middle joint (elbow, knee) about the root–end line, keeping both
 * ends, to the nearest place where the limb is within range (`margin` inside
 * it): the limb's ends stay where the move wants them and the joint between
 * finds a way to get there untwisted. Returns the middle joint's position.
 * Where nowhere is in range, the least-twisted place. `shoulder` (a range,
 * shoulderBehindLimit) also keeps an elbow from pointing too far behind the
 * trunk; `twist` false leaves the turn out of it.
 */
export function swivelIntoRange(axes, kind, side, root, middle, end, { bladeDir = null, margin = 0, samples = 24, shoulder = null, twist = true } = {}) {
  const limits = { bladeDir, margin, shoulder, twist };
  if (!axes || poseExcess(axes, kind, side, root, middle, end, limits) === 0) return middle;
  const line = vec.sub(end, root);
  const length = vec.length(line);
  if (length < 1e-6) return middle;
  const axis = vec.scale(line, 1 / length);
  const centre = vec.add(root, vec.scale(axis, vec.dot(vec.sub(middle, root), axis)));
  const offset = vec.sub(middle, centre);
  if (vec.length(offset) < 1e-6) return middle;
  const at = (angle) => vec.add(centre, turnAbout(offset, axis, angle));
  const excessAt = (angle) => poseExcess(axes, kind, side, root, at(angle), end, limits);
  // The nearest angle either way that is in range: sampled, then the edge
  // found by halving, so the joint moves no further round than it must.
  let best = null;
  let leastExcess = Infinity;
  let leastAngle = 0;
  for (let step = 1; step <= samples / 2 && best === null; step += 1) {
    for (const direction of [1, -1]) {
      const angle = (direction * step * 2 * Math.PI) / samples;
      const excess = excessAt(angle);
      if (excess === 0) {
        best = angle;
        break;
      }
      if (excess < leastExcess) {
        leastExcess = excess;
        leastAngle = angle;
      }
    }
  }
  if (best === null) return at(leastAngle);
  let outside = best - Math.sign(best) * ((2 * Math.PI) / samples);
  let inside = best;
  for (let halving = 0; halving < 6; halving += 1) {
    const mid = (outside + inside) / 2;
    if (excessAt(mid) === 0) inside = mid;
    else outside = mid;
  }
  return at(inside);
}
