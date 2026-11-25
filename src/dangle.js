// Things that hang and swing: locks of hair, a hood, drawstrings. Each is a
// pendulum hung from a point on a moving body part: its tip is a particle in
// the world, pulled by gravity, by a spring back towards where it rests on
// the part (cloth and hair have some stiffness), damped, and held at its
// length from the pivot. When the head snaps round, the locks are left
// behind and catch up; when it stops, they swing past and settle.

export const DANGLE = {
  gravity: 9.81,
  substeps: 3,
  maxStep: 1 / 30,
  // A hanging thing wet through (`wet` 0..1 on the Dangle, set by wetview.js): heavier by the water in it, so it droops
  // further from where it was cut or sewn to sit (`sag` × this) and its swing dies (its damping to `damping` of critical).
  wet: { sag: 1.8, damping: 0.85 },
  // A move farther than this (m) in one frame is not a movement but a man placed anew (as clothsway.js CLOTH_SWAY.jump).
  jump: 0.5,
};

/**
 * A rigid board hung from its top edge (`hung` on a Dangle: a sode, a skirt panel of laced rows, a tasset): not a lock of hair
 * pulled back to where it was cut to sit, but a weight on a pivot. Gravity holds it plumb; the body's own acceleration, its
 * turns, blows and the limbs it rests on swing it; only what holds it resists, a little: `holds` by what it hangs from
 * (`stiffness`: the restoring pull of the cords or strap towards where it was made to sit, as a share of gravity's own on the
 * pendulum; `damping`: the friction of the lacing and the cords as a share of critical damping, on its swing relative to the
 * pivot), and the air (`drag`: a flat plate's coefficient, `air` kg/m³, on its speed through the air, by its area over its mass).
 * A board hung from its edge swings as a pendulum of `pivotShare` of its length (a uniform plate: 2/3), so a 36 cm sode swings
 * at about 1 Hz. Silk cords and a leather strap hold little; a rivet holds hard (a plate on a rivet hardly moves).
 */
export const HUNG = {
  holds: {
    // Silk cords through the shoulder strap's rings, the skirt's lacing to the dō's hem: they let it swing almost freely.
    cords: { stiffness: 0.06, damping: 0.05 },
    // A leather strap and buckle (a tasset, a flap on a strap): stiffer, it swings a little.
    strap: { stiffness: 0.4, damping: 0.12 },
    // Riveted: it moves only as far as the rivet's play.
    rivet: { stiffness: 6, damping: 0.5 },
    // Hanging by one cord, the rest cut (physics/armourwear.js): nothing holds it to its place, it swings wildly.
    one: { stiffness: 0, damping: 0.02 },
  },
  drag: 1.2,
  air: 1.2,
  pivotShare: 2 / 3,
  // Hung by two cords or laced along its top edge (`hinge` on the piece: that edge's way, in the anchor's coordinates), a board
  // swings freely out from what it hangs on and back, but along its own edge only as far as its short cords let it (a swing
  // seat's sway: a pendulum of the cords' length, `cords` m on the piece, ~5 cm), so it does not twist round the arm or the
  // thigh; `hingeDamping` of critical on that sway (the cords rubbing in their rings).
  hingeDamping: 0.3,
  // A blow that lands within `reach` m of a hung piece sets it moving by its impulse over the piece's mass, at most `most` m/s.
  // (Struck, a hung piece is driven against the part under it and moves with it, so its push is the blow's impulse over its
  // weight and that part's, `behind` kg, and at most `most` m/s: a sode struck hard swings out some 30-40°, it does not loop.)
  kick: { reach: 0.35, most: 1, behind: 4 },
};

const tmp = new THREE.Vector3();
const down = new THREE.Vector3(0, -1, 0);
const axis = new THREE.Vector3();
const closest = new THREE.Vector3();

/**
 * Move a point out to the surface of a capsule if it is inside. With
 * `outward` (a world direction: the side the point hangs on), a point that
 * has got behind the capsule as seen from that side (in its shadow, up to a
 * few radii deep) comes out in front of it, not through it: a skirt caught
 * by a thigh swinging forward lies over the thigh, not between the legs.
 */
function pushOutOfCapsule(point, { a, b, radius }, outward = null) {
  axis.subVectors(b, a);
  const span = axis.lengthSq() || 1e-9;
  const t = Math.max(0, Math.min(1, closest.subVectors(point, a).dot(axis) / span));
  closest.copy(a).addScaledVector(axis, t);
  const offset = point.clone().sub(closest);
  if (outward) {
    const along = offset.dot(outward);
    const lateral = offset.clone().addScaledVector(outward, -along);
    const across = lateral.length();
    if (along < 0 && along > -3 * radius && across < radius) {
      point.copy(closest).add(lateral).addScaledVector(outward, Math.sqrt(radius * radius - across * across));
      return;
    }
  }
  const distance = offset.length();
  if (distance >= radius || distance < 1e-6) return;
  point.copy(closest).addScaledVector(offset, radius / distance);
}

/** Closest points between segments p1–q1 and p2–q2: their parameters along each. */
function closestOnSegments(p1, q1, p2, q2) {
  const d1 = q1.clone().sub(p1);
  const d2 = q2.clone().sub(p2);
  const r = p1.clone().sub(p2);
  const a = d1.lengthSq() || 1e-9;
  const e = d2.lengthSq() || 1e-9;
  const f = d2.dot(r);
  const c = d1.dot(r);
  const b = d1.dot(d2);
  const denominator = a * e - b * b;
  let s = denominator > 1e-12 ? Math.max(0, Math.min(1, (b * f - c * e) / denominator)) : 0;
  let t = (b * s + f) / e;
  if (t < 0) {
    t = 0;
    s = Math.max(0, Math.min(1, -c / a));
  } else if (t > 1) {
    t = 1;
    s = Math.max(0, Math.min(1, (b - c) / a));
  }
  return { s, t, onFirst: p1.clone().addScaledVector(d1, s), onSecond: p2.clone().addScaledVector(d2, t) };
}

/**
 * A link of cloth (pivot to tip) may not pass through a capsule either, only
 * hang round it: a thigh raised into a skirt carries the cloth up and out on
 * `outward`'s side instead of coming through it. The tip is swung out until
 * the link clears.
 */
function swingLinkClear(pivot, tip, { a, b, radius }, outward) {
  const { s, onFirst, onSecond } = closestOnSegments(pivot, tip, a, b);
  if (s < 0.05) return;
  const offset = onFirst.clone().sub(onSecond);
  if (offset.dot(outward) < 0) offset.addScaledVector(outward, -2 * offset.dot(outward));
  const distance = offset.length();
  if (distance >= radius) return;
  const direction = distance > 1e-6 ? offset.divideScalar(distance) : outward.clone();
  // Moving the tip by x moves the link's nearest point by s·x.
  tip.addScaledVector(direction, Math.min(radius * 2, (radius - distance) / s));
}

export class Dangle {
  /**
   * @param anchor an Object3D the pivot rides on (its matrix is kept current)
   * @param pivot the hanging point, in the anchor's own coordinates
   * @param rest the direction it hangs at rest, in the anchor's coordinates
   * @param length pivot to tip, in the anchor's own units (a scaled head scales its hair)
   * @param sag how far it droops from rest under its own weight, as a share
   *   of its length: stiff gelled hair little, a loose hood a lot
   * @param damping share of critical damping: low swings on, high settles
   */
  constructor(anchor, pivot, rest, length, { sag = 0.35, damping = 0.25, collides = null, outward = null, hung = null } = {}) {
    this.anchor = anchor;
    // A rigid board hung from its edge (HUNG): { mass (kg), area (m²), hold (a key of HUNG.holds) }, or null for hair and cloth.
    this.hung = hung ? { ...hung } : null;
    // The piece's own down, in its group (built along −y from the pivot; hung from a corner, the way to its middle from there).
    this.down = down.clone();
    // The side it hangs on, in the anchor's coordinates (cloth round a body: out from it), or null.
    this.outward = outward ? new THREE.Vector3(...outward).normalize() : null;
    // Which colliders it rests on (their `part`: 'trunk', 'shoulders', 'arm', 'leg'); null, all of them.
    // A cloak is held off the trunk and legs but not flung by an arm swinging inside it.
    this.collides = collides;
    this.length = length;
    this.sag = sag;
    this.dampingShare = damping;
    this.wet = 0;
    this.rest = new THREE.Vector3(...rest).normalize();
    this.group = new THREE.Group();
    this.group.position.set(...pivot);
    anchor.add(this.group);
    this.tip = null;
    this.velocity = new THREE.Vector3();
  }

  /** The pivot and the resting tip in the world, from the anchor as it is now. */
  placeInWorld() {
    this.anchor.updateWorldMatrix(true, false);
    const pivot = this.group.position.clone().applyMatrix4(this.anchor.matrixWorld);
    const rotation = new THREE.Matrix3().setFromMatrix4(this.anchor.matrixWorld);
    const restWorld = this.rest.clone().applyMatrix3(rotation).normalize();
    const length = this.length * this.anchor.matrixWorld.getMaxScaleOnAxis();
    return { pivot, length, restTip: pivot.clone().addScaledVector(restWorld, length) };
  }

  /**
   * @param colliders capsules the tip may not enter: { a, b, radius }, world
   *   Vector3s — the head and the trunk, so hair lies on the back and the
   *   shoulders instead of hanging through them
   */
  update(dt, colliders = []) {
    const placed = this.placeInWorld();
    const { pivot } = placed;
    // (A hung board swings as a pendulum of its pivot share of its length: its middle of swing, not its hem.)
    const length = this.hung ? placed.length * HUNG.pivotShare : placed.length;
    const restTip = this.hung ? pivot.clone().lerp(placed.restTip, HUNG.pivotShare) : placed.restTip;
    if (!this.tip) this.tip = restTip.clone();
    if (!this.pivotWas) this.pivotWas = pivot.clone();
    // (A man put somewhere anew, not moved there: a hung board starts at rest where it hangs, not flung by the jump.)
    if (this.hung && pivot.distanceTo(this.pivotWas) > DANGLE.jump) {
      this.tip.copy(restTip);
      this.velocity.set(0, 0, 0);
      this.pivotWas.copy(pivot);
    }
    // Spring and damper from the sag: gravity alone would bend it sag × length. A hung board's from what holds it (HUNG).
    const hold = this.hung ? HUNG.holds[this.hung.hold] ?? HUNG.holds.cords : null;
    const pendulum = DANGLE.gravity / length;
    const stiffness = hold ? pendulum * hold.stiffness : DANGLE.gravity / (this.sag * (1 + (DANGLE.wet.sag - 1) * this.wet) * length);
    const dampingShare = hold ? hold.damping : this.dampingShare;
    const damping = 2 * Math.sqrt(hold ? pendulum : stiffness) * (dampingShare + (DANGLE.wet.damping - dampingShare) * this.wet);
    // (The pivot's own speed: a hung board's lacing damps its swing about the pivot, not its being carried along.)
    const pivotVelocity = hold && dt > 0 ? pivot.clone().sub(this.pivotWas).divideScalar(Math.min(dt, DANGLE.maxStep)) : null;
    this.pivotWas.copy(pivot);
    const dragPerMass = hold ? (0.5 * HUNG.air * HUNG.drag * this.hung.area) / this.hung.mass : 0;
    // (The edge it hangs along, in the world: HUNG `hinge`; none once it hangs by one cord.)
    const hinge = hold && this.hung.hinge && this.hung.hold !== 'one' ? new THREE.Vector3(...this.hung.hinge).applyMatrix3(new THREE.Matrix3().setFromMatrix4(this.anchor.matrixWorld)).normalize() : null;
    const hingeStiffness = hinge ? DANGLE.gravity / (this.hung.cords ?? 0.05) : 0;
    const hingeDamping = hinge ? 2 * Math.sqrt(hingeStiffness) * HUNG.hingeDamping : 0;
    const outward = this.outward ? this.outward.clone().applyMatrix3(new THREE.Matrix3().setFromMatrix4(this.anchor.matrixWorld)).normalize() : null;
    const steps = DANGLE.substeps;
    const h = Math.min(dt, DANGLE.maxStep) / steps;
    for (let step = 0; step < steps && h > 0; step += 1) {
      tmp.subVectors(restTip, this.tip).multiplyScalar(stiffness);
      tmp.y -= DANGLE.gravity;
      if (pivotVelocity) {
        tmp.addScaledVector(this.velocity, -damping).addScaledVector(pivotVelocity, damping);
        // The air on the plate: against its speed through it, as the square of that speed.
        tmp.addScaledVector(this.velocity, -dragPerMass * this.velocity.length());
        if (hinge) {
          const along = this.tip.clone().sub(restTip).dot(hinge);
          const sway = this.velocity.clone().sub(pivotVelocity).dot(hinge);
          tmp.addScaledVector(hinge, -hingeStiffness * along - hingeDamping * sway);
        }
      } else tmp.addScaledVector(this.velocity, -damping);
      this.velocity.addScaledVector(tmp, h);
      const before = this.tip.clone();
      this.tip.addScaledVector(this.velocity, h);
      // Held at its length from the pivot; its speed is what it actually moved.
      tmp.subVectors(this.tip, pivot);
      const distance = tmp.length() || 1e-6;
      this.tip.copy(pivot).addScaledVector(tmp, length / distance);
      const free = this.tip.clone();
      for (const capsule of colliders) {
        if (this.collides && !this.collides.includes(capsule.part)) continue;
        pushOutOfCapsule(this.tip, capsule, outward);
        if (outward) swingLinkClear(pivot, this.tip, capsule, outward);
      }
      tmp.subVectors(this.tip, pivot);
      this.tip.copy(pivot).addScaledVector(tmp, length / (tmp.length() || 1e-6));
      if (h > 0 && hold) {
        // A hung board meets the limb it rests on as a weight does, not as a spring: what pushed it out of the limb is where it
        // is, not a speed it was given (else every step of resting on the arm flung it); its speed into the limb is lost.
        this.velocity.subVectors(free, before).divideScalar(h);
        const push = this.tip.clone().sub(free);
        if (push.lengthSq() > 1e-12) {
          push.normalize();
          const into = this.velocity.dot(push);
          if (into < 0) this.velocity.addScaledVector(push, -into);
        }
      } else if (h > 0) this.velocity.subVectors(this.tip, before).divideScalar(h);
    }
    this.aim(pivot);
  }

  /** A blow's push on it: `velocity` (world, m/s) added to its swing. */
  kick(velocity) {
    if (this.tip) this.velocity.add(velocity);
  }

  /**
   * It hangs by one cord, the others cut (physics/armourwear.js): nothing holds it to its place (HUNG.holds.one), and it hangs
   * from that cord at `corner` (in its group's own coordinates: across its top edge from the middle), so it turns about it and
   * its middle falls below the cord.
   */
  hangByOne(corner) {
    if (!this.hung || this.hung.hold === 'one') return;
    this.hung.hold = 'one';
    const shift = new THREE.Vector3(...corner);
    for (const child of this.group.children) child.position.sub(shift);
    this.group.position.add(shift.clone().applyQuaternion(this.group.quaternion));
    // Its middle, from the cord: back across the top and half its length down.
    this.down.set(-corner[0], -corner[1], -corner[2]).add(new THREE.Vector3(0, -this.length / 2, 0)).normalize();
    // (Let go a little: a cord parting gives it a start.)
    this.velocity.y -= 0.5;
  }

  /**
   * Point the hanging piece (built along −y from its pivot) at the tip. Called
   * again after something else has moved the tip (cloth held to its neighbours),
   * with the tip first put back at its length from the pivot.
   */
  aim(pivot = this.placeInWorld().pivot, length = null) {
    if (length !== null) {
      tmp.subVectors(this.tip, pivot);
      this.tip.copy(pivot).addScaledVector(tmp, length / (tmp.length() || 1e-6));
    }
    const world = tmp.subVectors(this.tip, pivot).normalize();
    const inverse = new THREE.Matrix4().copy(this.anchor.matrixWorld).invert();
    const local = world.applyMatrix3(new THREE.Matrix3().setFromMatrix4(inverse)).normalize();
    this.group.quaternion.setFromUnitVectors(this.down, local);
    this.group.updateMatrix();
  }
}
