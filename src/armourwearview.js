// What the wear of a man's armour (physics/armourwear.js `fighter.armourWear`) does to it as drawn: a hung piece whose cords are
// cut hangs by the one left and swings wild (dangle.js hangByOne), a piece cut loose falls and is drawn where its debris lies
// (weaponview.js updateDebris, handed the piece itself: ARMOUR_LOOSE), the rows of a helmet's neck guard askew and falling; and a
// blow that lands near a hung piece knocks it swinging (dangle.js HUNG.kick). Drawing only.

import { HUNG } from './dangle.js';

// A fallen piece's own meshes, by its debris's id, for weaponview.js updateDebris to draw (once, then it holds them).
export const ARMOUR_LOOSE = new Map();
// (The debris already handed its meshes: a man drawn anew drops his fallen pieces' meshes rather than handing them again.)
const ARMOUR_HANDED = new Set();

// (How far a loosened row of the neck guard hangs askew: rad.)
const ROW_ASKEW = 0.3;

const awvAt = new THREE.Vector3();
const awvTo = new THREE.Vector3();
const awvPose = new THREE.Matrix4();

/** Each frame, before his hung pieces move: the blows near them, and what his armour's wear has loosened or cut off. */
export function updateArmourWear(fighterView, fighter) {
  awvKickHung(fighterView, fighter);
  const wear = fighter.armourWear;
  if (!wear || fighterView.armourWearSeen === wear.version) return;
  fighterView.armourWearSeen = wear.version;
  for (const dangle of fighterView.dangles) {
    const piece = dangle.armourPiece ? wear.pieces[dangle.armourPiece] : null;
    if (!piece) continue;
    if (piece.loose && dangle.corner) dangle.hangByOne(dangle.corner);
    if (piece.gone && !dangle.fallen) awvDropDangle(fighterView, dangle, piece.debris);
  }
  awvNeckGuardWear(fighterView, wear);
}

/** A blow landed near a hung piece since the last frame: it is pushed by the blow's impulse over its weight, along the blow. */
function awvKickHung(fighterView, fighter) {
  const blow = fighter.blowAt;
  if (!blow || fighterView.blowSeen === blow.time) return;
  fighterView.blowSeen = blow.time;
  awvAt.set(...blow.point);
  awvTo.set(...blow.travel);
  if (awvTo.lengthSq() < 1e-9) return;
  awvTo.normalize();
  for (const dangle of fighterView.dangles) {
    if (!dangle.hung || dangle.fallen || !dangle.tip) continue;
    const { pivot } = dangle.placeInWorld();
    const middle = pivot.lerp(dangle.tip, 0.5);
    if (middle.distanceTo(awvAt) > HUNG.kick.reach) continue;
    dangle.kick(awvTo.clone().multiplyScalar(Math.min(HUNG.kick.most, blow.impulse / (dangle.hung.mass + HUNG.kick.behind))));
  }
}

/** A hung piece cut loose: its meshes taken off the body, kept where they are, and handed to its debris to be drawn from there on. */
function awvDropDangle(fighterView, dangle, debris) {
  dangle.fallen = true;
  fighterView.dangles = fighterView.dangles.filter((each) => each !== dangle);
  awvHandOver(dangle.group, debris);
}

/**
 * Meshes that fall (a group of them, as they are drawn now) to the debris `debris`: kept at their place in the world, under a
 * holder weaponview.js moves as the debris moves.
 */
function awvHandOver(object, debris) {
  if (debris === undefined || debris === null || ARMOUR_HANDED.has(debris)) {
    object.parent?.remove(object);
    return;
  }
  ARMOUR_HANDED.add(debris);
  object.updateWorldMatrix(true, true);
  const holder = new THREE.Group();
  const inner = new THREE.Group();
  holder.add(inner);
  awvPose.copy(object.matrixWorld);
  object.parent?.remove(object);
  awvPose.decompose(object.position, object.quaternion, object.scale);
  object.matrixAutoUpdate = true;
  inner.add(object);
  ARMOUR_LOOSE.set(debris, holder);
}

/**
 * The neck guard's rows (the kabuto's shikoro tiers, `userData.shikoroTier`): one loosened hangs askew on what is left of its
 * lacing; one cut loose falls, and every row below it with it (they hang from it).
 */
function awvNeckGuardWear(fighterView, wear) {
  const helmet = fighterView.helmetWorn;
  if (!helmet) return;
  const tiers = new Map();
  helmet.traverse((object) => {
    const tier = object.userData.shikoroTier;
    if (tier === undefined) return;
    if (!tiers.has(tier)) tiers.set(tier, []);
    tiers.get(tier).push(object);
  });
  for (const [tier, meshes] of tiers) {
    const piece = wear.pieces[`neck:${tier}`];
    if (!piece?.loose || piece.gone) continue;
    for (const mesh of meshes) {
      if (mesh.userData.askew) continue;
      mesh.userData.askew = true;
      mesh.rotation.z += ROW_ASKEW * (tier % 2 ? 1 : -1);
    }
  }
  if (wear.fallenRow === undefined || fighterView.rowsFallen === wear.fallenRow) return;
  fighterView.rowsFallen = wear.fallenRow;
  // (Gathered in the helmet's own frame, as they hung in it.)
  const fallen = new THREE.Group();
  for (const [tier, meshes] of tiers) {
    if (tier < wear.fallenRow) continue;
    for (const mesh of meshes) {
      // (It no longer swings with the rest: its tier mark taken off.)
      delete mesh.userData.aventailTier;
      mesh.parent?.remove(mesh);
      fallen.add(mesh);
    }
  }
  if (!fallen.children.length) return;
  helmet.add(fallen);
  awvHandOver(fallen, wear.pieces[`neck:${wear.fallenRow}`]?.debris);
}
