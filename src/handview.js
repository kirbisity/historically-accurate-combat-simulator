// What each hand is doing, from what the simulation holds of it, and the posture drawn for it (wardrobe.js buildHand,
// handform.js). One rule for every hand: a hand that something held passes through is closed on it at that thing's own
// thickness, turned about the forearm so the thing lies across its palm the way it really points; an empty hand that
// strikes is a fist; an empty hand that does not hangs half open; a hand with no life or no working arm behind it is limp.
//
// What is held is found, not listed: the weapon's line through the hand that carries it and through any other hand the
// simulation has set on it (a polearm's forward hand, a long sword's pommel hand), the bowstring through the hand drawing
// it, a shield's grip, the reins of a mount in the bridle hand. A handle's thickness is measured off the weapon as it is
// drawn (a slice through its mesh where the hand is), so a dagger's grip, a spear's shaft and a pollaxe's haft each fill
// the hand that holds them.

/* global THREE */
import { BONE } from './rig.js';
import { P } from './body.js';

export const HAND_VIEW = {
  // A handle's half thickness where the weapon's drawing does not say (m), and the most a hand closes round.
  handle: 0.015,
  handleMost: 0.034,
  // A cord in the hand: a bowstring with the arrow's nock, a rein's strap (m, half thickness).
  cord: 0.004,
  // A shield's grip, and a limb or a neck held in a clinch (the hand closes as far as it goes round).
  shieldGrip: 0.014,
  held: 0.034,
  // A hand counts as on the weapon within this of its line (m).
  onLine: 0.06,
  // How the handle lies in the hand by its lean from square across the palm (rad): square, aslant, in line with the forearm.
  slants: [0, 0.4, 0.8],
  // A weapon pointing back past this along the forearm (the cosine of its angle to it) is held point down, the thumb to the pommel.
  reversed: -0.45,
  // A posture changes over this many frames.
  blendFrames: 3,
};

const handleRadii = new Map();

/**
 * A weapon's half thickness `along` it from the hand (m), measured off its drawing: the mesh sliced there, the surface
 * nearest round its line taken (a guard's bow or a string stands well clear of the grip and is passed over). Kept per
 * kind and place.
 */
function handleRadius(kind, along, drawing, spec) {
  const key = `${kind}|${Math.round(along * 25)}`;
  if (handleRadii.has(key)) return handleRadii.get(key);
  const fallback = spec?.build?.shaftRadius ?? HAND_VIEW.handle;
  let meshes = 0;
  drawing?.traverse((object) => {
    if (object.isMesh && object.geometry?.attributes?.position) meshes += 1;
  });
  // (A crowd's weapon is its batch's: nothing of its own to measure, and nothing kept, so a drawing made later is measured.)
  if (!meshes) return Math.min(HAND_VIEW.handleMost, fallback);
  drawing.updateMatrixWorld(true);
  const inverse = new THREE.Matrix4().copy(drawing.matrixWorld).invert();
  const local = new THREE.Matrix4();
  const corners = [new THREE.Vector3(), new THREE.Vector3(), new THREE.Vector3()];
  const sectors = Array.from({ length: 12 }, () => Infinity);
  drawing.traverse((object) => {
    if (!object.isMesh || object.userData.outline || !object.geometry?.attributes?.position) return;
    local.multiplyMatrices(inverse, object.matrixWorld);
    const positions = object.geometry.attributes.position;
    const index = object.geometry.index;
    const count = index ? index.count : positions.count;
    for (let corner = 0; corner < count; corner += 3) {
      for (let k = 0; k < 3; k += 1) corners[k].fromBufferAttribute(positions, index ? index.getX(corner + k) : corner + k).applyMatrix4(local);
      for (let k = 0; k < 3; k += 1) {
        const a = corners[k];
        const b = corners[(k + 1) % 3];
        if ((a.y - along) * (b.y - along) > 0 || a.y === b.y) continue;
        const t = (along - a.y) / (b.y - a.y);
        const x = a.x + (b.x - a.x) * t;
        const z = a.z + (b.z - a.z) * t;
        const r = Math.hypot(x, z);
        if (r < 0.004) continue;
        const sector = ((Math.round((Math.atan2(z, x) / (2 * Math.PI)) * 12) % 12) + 12) % 12;
        // (The outermost of what lies close in each direction: a wrapped grip over its tang.)
        if (r <= HAND_VIEW.handleMost * 1.3 && (sectors[sector] === Infinity || r > sectors[sector])) sectors[sector] = r;
      }
    }
  });
  const known = sectors.filter((r) => r !== Infinity).sort((a, b) => a - b);
  const radius = known.length >= 4 ? Math.min(HAND_VIEW.handleMost, known[Math.floor(known.length / 2)]) : Math.min(HAND_VIEW.handleMost, fallback);
  handleRadii.set(key, radius);
  return radius;
}

/** What passes through a fighter's hand (`side`), if anything: { dir: its line (world), radius, cord: a cord, held any way round }. */
function heldIn(fighter, side, fighterView) {
  const hand = P[`${side}Hand`] * 3;
  const at = (index) => [fighter.x[index], fighter.x[index + 1], fighter.x[index + 2]];
  for (const [weapon, slot] of [[fighter.weapon, fighterView?.arms], [fighter.offWeapon, fighterView?.arms?.second]]) {
    if (!weapon?.held || weapon.spec?.mounted) continue;
    const main = P[`${weapon.main}Hand`] * 3;
    const dir = weapon.dir;
    if (weapon.main === side) return { dir, radius: handleRadius(weapon.kind, 0, slot?.weapon, weapon.spec) };
    // A bow's string in the hand that draws it.
    if (weapon.spec.bow) {
      if (weapon.off === side && (weapon.draw ?? 0) > 0.05) return { dir, radius: HAND_VIEW.cord, cord: true };
      continue;
    }
    if (!weapon.twoHanded) continue;
    // Another hand on its line, where the simulation has set it.
    const from = at(main);
    const to = at(hand);
    const along = (to[0] - from[0]) * dir[0] + (to[1] - from[1]) * dir[1] + (to[2] - from[2]) * dir[2];
    const off = Math.hypot(to[0] - from[0] - dir[0] * along, to[1] - from[1] - dir[1] * along, to[2] - from[2] - dir[2] * along);
    if (off < HAND_VIEW.onLine && Math.abs(along) > 0.04) return { dir, radius: handleRadius(weapon.kind, along, slot?.weapon, weapon.spec) };
  }
  // A shield's grip (carried on the left arm: physics.js shieldDisc).
  if (fighter.shield && side === 'l') return { dir: null, radius: HAND_VIEW.shieldGrip };
  // The reins, both in the bridle hand (horseview.js updateReins).
  if (fighter.mount && side === 'l') return { dir: null, radius: HAND_VIEW.cord, cord: true };
  return null;
}

/**
 * The posture of a fighter's hand now: { hold, radius, slant } (handform.js handPose) and `turn`, how far the hand is
 * turned about the forearm (rad; null: as it was). `frame`: the forearm's frame as drawn. `fighterView`: his drawing, for
 * the weapon's own thickness (none: a crowd's template, by the weapon's figures).
 */
export function handHold(fighter, side, frame = null, fighterView = null) {
  // No life in it: out or dead, or the arm broken.
  if (fighter.state === 'out' || fighter.fainted || fighter.broken?.has(`${side}Elbow`) || fighter.broken?.has(`${side}Shoulder`)) return { hold: 'limp', turn: 0 };
  const held = heldIn(fighter, side, fighterView);
  if (held) {
    if (!held.dir || !frame || held.cord) return { hold: 'grip', radius: held.radius, slant: 0, turn: held.dir ? null : 0 };
    // The thing's line in the forearm's frame: its lean along the forearm is the handle's slant across the palm, its way
    // round the forearm the hand's turn. (Pointing back along the forearm, it is held the other way up.)
    const dot = (axis) => held.dir[0] * axis[0] + held.dir[1] * axis[1] + held.dir[2] * axis[2];
    let line = [dot(frame.x), dot(frame.y), dot(frame.z)];
    if (line[1] < HAND_VIEW.reversed) line = line.map((value) => -value);
    const lean = Math.asin(Math.min(1, Math.max(-1, line[1])));
    let slant = HAND_VIEW.slants[0];
    for (const step of HAND_VIEW.slants) if (Math.abs(lean - step) < Math.abs(lean - slant)) slant = step;
    const mirror = side === 'l' ? -1 : 1;
    // (As handform.js lays what is held: across the palm, leaning to the fingertips by `slant`, the wrist bent back by HAND_LEAN.)
    const across = Math.hypot(line[0], line[2]);
    const turn = across > 0.2 ? Math.atan2(-Math.sin(slant) * HAND_LEAN * mirror, Math.cos(slant)) - Math.atan2(line[2], line[0]) : null;
    return { hold: slant > 0.2 ? 'slant' : 'grip', radius: held.radius, slant, turn };
  }
  // A hand closed on a man (a clinch's holding hands).
  if (fighter.clinch?.hands?.includes(side)) return { hold: 'grip', radius: HAND_VIEW.held, slant: 0, turn: 0 };
  // Empty. A fist where it strikes: a man with no weapon who can fight, or the hand a blow is being thrown with.
  const striking = fighter.punch?.spec?.limb === `${side}Hand`;
  const armed = Boolean(fighter.weapon?.held || fighter.offWeapon?.held);
  const fighting = fighter.state === 'up' || fighter.state === 'rising';
  if (striking || (fighting && !armed && !fighter.handsDown)) return { hold: 'fist', turn: 0 };
  return { hold: 'rest', turn: 0 };
}
// The sine of the wrist's bend back in a grip, near enough for the hand's turn (handform.js handPose `lean`, ~0.4 rad).
const HAND_LEAN = 0.4;

/** Each hand of a fighter's drawing shown in what it is doing now (the hands among `fighterView.attachments`). */
export function updateHands(fighterView, frames) {
  const fighter = fighterView.fighter;
  for (const { object } of fighterView.attachments) {
    const hand = object.userData.hand;
    if (!hand) continue;
    const now = handHold(fighter, hand.side, frames[BONE[`${hand.side}Forearm`]], fighterView);
    const state = (hand.state ??= { spec: null, key: '', from: null, step: HAND_VIEW.blendFrames });
    const key = `${now.hold}|${Math.round((now.radius ?? 0) * 500)}|${now.slant ?? 0}`;
    if (key !== state.key) {
      state.from = state.spec;
      state.spec = { hold: now.hold, radius: now.radius, slant: now.slant };
      state.key = key;
      state.step = state.from ? 0 : HAND_VIEW.blendFrames;
    }
    if (state.step < HAND_VIEW.blendFrames) state.step += 1;
    hand.pose(state.spec, state.step < HAND_VIEW.blendFrames ? state.from : null, state.step / HAND_VIEW.blendFrames);
    if (now.turn !== null && now.turn !== undefined) hand.turn(now.turn);
  }
}
