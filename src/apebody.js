// A great ape's body and coat as one furred surface (the 'ape' body style, bodystyles.js), drawn from the same body numbers
// as every fighter's (body.js: its lengths, its segments' radii, its trunk's muscle) and meshed as the anatomy field is
// (bodymesh.js: rounded primitives blended with a smooth minimum, surface nets, the skin weighted to the bones). What makes
// it an ape and not a man is where the flesh is, after the photographs of western lowland silverbacks:
//
// - the shoulder girdle: a hump of trapezius rising from the back of the skull out over the shoulders (`hump`), so the head
//   sits low between them with no neck to be seen; deltoids and upper arms as thick as a man's thighs, forearms barely
//   tapering to the wrist (the knuckle-walker's arms are pillars);
// - the trunk: a deep, wide barrel of a chest (`chest`), and below it the gut of a leaf-eater (`belly`: the long colon a
//   gorilla's diet needs), wider than the chest at the waist; a broad, flat rump;
// - short thick thighs, small calves;
// - the coat over all of it (`coat`, a share of the height), lying down the limbs and the back: its surface roughed by
//   strands (`strand`: a noise drawn out along the bind pose's up, the way the hair hangs), and its colour the skin's coat,
//   lightened over a saddle (the armour's `back` region of ARMOR_KINDS.silverback, loftbody.js: the back, the rump and the
//   backs of the thighs) to the kit's armour colour: a silverback's silver, a macaque's orange rump.
//
// The head, hands and feet are drawn as every fighter's are (wardrobe.js gorillaHead, the bare fists and feet). No Three.js
// here: plain arrays, built and checked in Node.

import { P } from './body.js';
import { cone, ellipsoid, sampleField, skinWeights, surfaceNets } from './bodymesh.js';
import { outfitOf } from './outfits.js';
import { vec } from './pose.js';
import { BONE, bindPoints, boneFrames } from './rig.js';

export const APE = {
  // The grid the field is meshed on (m): coarser than a man's field (the coat hides fine anatomy), ~20k triangles for a silverback.
  cell: 0.023,
  // How far two primitives start to merge (m, a share of height): flesh under a coat flows together more than a man's.
  blend: 0.035,
  // The coat's depth over the flesh (a share of height): ~2-3 cm on a silverback's body, more on its forearms (`armCoat`).
  coat: 0.012, armCoat: 1.6,
  // The strands: how much the surface is roughed (a share of height), and their scale across and along the hair (m).
  strand: 0.003, across: 0.018, along: 0.09,
  // The coat's colour varied strand by strand (± a share), the saddle's edge (a share of the trunk's depth) blended over, and
  // how grizzled the saddle is (the share of its silver that comes and goes strand by strand).
  shade: 0.16, saddleEdge: 0.45, grizzle: 0.3,
  // The bare, dark chest of an adult male (the pectorals, little hair), a share of the coat's colour.
  chest: 0.8,
};

/** A small hashed value noise in 3D (0..1), smooth between the lattice points. */
function apeNoise(x, y, z) {
  const fx = Math.floor(x), fy = Math.floor(y), fz = Math.floor(z);
  const tx = x - fx, ty = y - fy, tz = z - fz;
  const sx = tx * tx * (3 - 2 * tx), sy = ty * ty * (3 - 2 * ty), sz = tz * tz * (3 - 2 * tz);
  const hash = (i, j, k) => {
    let h = (i * 374761393 + j * 668265263 + k * 2147483647) | 0;
    h = Math.imul(h ^ (h >>> 13), 1274126177);
    return ((h ^ (h >>> 16)) >>> 0) / 4294967295;
  };
  const lerp = (a, b, t) => a + (b - a) * t;
  const plane = (k) => lerp(lerp(hash(fx, fy, k), hash(fx + 1, fy, k), sx), lerp(hash(fx, fy + 1, k), hash(fx + 1, fy + 1, k), sx), sy);
  return lerp(plane(fz), plane(fz + 1), sz);
}

/** The strands at a point: a noise fine across the hair and long along it (the bind pose's up), two octaves. */
function strands(x, y, z) {
  const { across, along } = APE;
  return 0.65 * apeNoise(x / across, y / along, z / across) + 0.35 * apeNoise(x / (across * 0.5), y / (along * 0.5), z / (across * 0.5) + 17);
}

/** The ape's flesh and coat as primitives in the bind pose (see the head of this file). */
export function apeAnatomy(body) {
  const points = bindPoints(body);
  const at = (name) => points[P[name]];
  const seg = body.segments;
  const L = body.lengths;
  const H = body.heightM;
  const coat = APE.coat * H;
  const lerp = vec.lerp;
  const shapes = [];
  const pelvis = at('pelvis');
  const neck = at('neck');
  const trunkAt = (u, forward = 0, left = 0, up = 0) => vec.add(lerp(pelvis, neck, u), [forward, up, left]);
  const R = seg.trunk.skinRadius + coat;
  const muscle = seg.trunk.tissue.muscle / (seg.trunk.tissue.muscle + seg.trunk.tissue.fat);
  const halfShoulders = L.shoulderSpan / 2;
  // The chest: a deep barrel, as wide as the shoulders.
  shapes.push(ellipsoid(trunkAt(0.64, R * 0.05), [R * 0.95, L.trunk * 0.34, halfShoulders + R * 0.25]));
  // The gut: wider than the chest at the waist, carried forward and down.
  shapes.push(ellipsoid(trunkAt(0.3, R * 0.22), [R * 1.0, L.trunk * 0.3, L.hipSpan * 0.5 + R * 0.55]));
  // The rump: broad and flat behind, over the hip joints.
  shapes.push(ellipsoid(trunkAt(0.04, -R * 0.12), [R * 0.82, L.trunk * 0.2, L.hipSpan * 0.5 + seg.lThigh.skinRadius + coat]));
  // The trapezius: the hump from the back of the skull out over the shoulders, the head sunk low in front of it.
  shapes.push(ellipsoid(vec.add(neck, [-R * 0.3, L.neckToHead * 0.25, 0]), [R * 0.62, L.neckToHead * 0.95 + 0.04 * H * muscle, halfShoulders * 0.95]));
  // The back's breadth under it (the lats and the long back muscles), down to the gut.
  shapes.push(ellipsoid(trunkAt(0.55, -R * 0.35), [R * 0.6, L.trunk * 0.38, halfShoulders + R * 0.15]));
  // A short neck running up into the skull.
  shapes.push(cone(vec.add(neck, [0.01 * H, -0.02 * H, 0]), lerp(neck, at('head'), 0.6), L.headRadius * 1.25 + coat, L.headRadius * 0.95));
  for (const [side, sign] of [['l', 1], ['r', -1]]) {
    const shoulder = at(`${side}Shoulder`);
    const elbow = at(`${side}Elbow`);
    const hand = at(`${side}Hand`);
    const armCoat = coat * APE.armCoat;
    const upper = seg[`${side}UpperArm`].skinRadius + armCoat;
    const fore = seg[`${side}Forearm`].skinRadius + armCoat;
    // The deltoid over the joint, and the trapezius running down onto it.
    shapes.push(ellipsoid(vec.add(shoulder, [0, -0.01 * H, sign * 0.01 * H]), [upper * 1.35, upper * 1.45, upper * 1.3]));
    shapes.push(cone(vec.add(neck, [-R * 0.15, L.neckToHead * 0.2, 0]), vec.add(shoulder, [-R * 0.05, 0.01 * H, 0]), R * 0.42, upper * 1.05));
    // The upper arm, thick to the elbow; biceps and triceps under the coat.
    shapes.push(cone(shoulder, elbow, upper * 1.08, upper * 0.88));
    shapes.push(cone(vec.add(lerp(shoulder, elbow, 0.25), [upper * 0.3, 0, 0]), vec.add(lerp(shoulder, elbow, 0.7), [upper * 0.28, 0, 0]), upper * 0.75, upper * 0.6));
    shapes.push(cone(vec.add(lerp(shoulder, elbow, 0.2), [-upper * 0.32, 0, 0]), vec.add(lerp(shoulder, elbow, 0.75), [-upper * 0.3, 0, 0]), upper * 0.8, upper * 0.62));
    // The forearm: a pillar, barely tapering, its coat long; it stops at the wrist (the fist is the hand's own).
    const wrist = lerp(elbow, hand, 0.92);
    shapes.push(cone(elbow, lerp(elbow, hand, 0.4), fore * 1.15, fore * 1.08));
    shapes.push(cone(lerp(elbow, hand, 0.4), wrist, fore * 1.08, fore * 0.82));
    const hip = at(`${side}Hip`);
    const knee = at(`${side}Knee`);
    const foot = at(`${side}Foot`);
    const thigh = seg[`${side}Thigh`].skinRadius + coat;
    const shank = seg[`${side}Shank`].skinRadius + coat;
    // Short, thick thighs out of the rump; small calves; down to the ankle (the foot is the foot's own).
    shapes.push(cone(vec.add(hip, [-0.01 * H, 0.03 * H, sign * 0.01 * H]), knee, thigh * 1.15, thigh * 0.78));
    shapes.push(ellipsoid(knee, [shank * 0.95, shank, shank * 0.95]));
    shapes.push(cone(knee, lerp(knee, foot, 0.92), shank * 0.92, shank * 0.62));
    shapes.push(cone(vec.add(lerp(knee, foot, 0.15), [-shank * 0.25, 0, 0]), vec.add(lerp(knee, foot, 0.5), [-shank * 0.18, 0, 0]), shank * 0.65, shank * 0.4));
  }
  return { shapes, points, R };
}

/**
 * The 'ape' body style's mesh: the anatomy's field roughed by the strands, meshed, weighted to the bones, and coloured by a
 * tint over the skin's colour (paintBody: every vertex is skin, so the coat takes blows, blood and wounds as skin does).
 */
export function buildApeBody(body) {
  const { shapes, points, R } = apeAnatomy(body);
  const H = body.heightM;
  const sampled = sampleField(shapes, APE.cell, APE.blend * H / 1.8);
  // The strands rough the surface: each sample moved in or out by the noise where it lies.
  const { field, size, low, cell } = sampled;
  const rough = APE.strand * H;
  for (let k = 0; k < size[2]; k += 1) {
    for (let j = 0; j < size[1]; j += 1) {
      for (let i = 0; i < size[0]; i += 1) {
        const index = i + size[0] * (j + size[1] * k);
        field[index] += (strands(low[0] + i * cell, low[1] + j * cell, low[2] + k * cell) - 0.5) * 2 * rough;
      }
    }
  }
  const surface = surfaceNets(sampled);
  const frames = boneFrames(points, body);
  const count = surface.positions.length / 3;
  const weights = skinWeights(surface.positions, frames);
  return {
    ...surface,
    ...weights,
    bindFrames: frames,
    bindPoints: points,
    regions: new Array(count).fill('skin'),
    tint: coatTint(body, surface.positions, points, R, weights.skinIndex),
  };
}

const ARM_BONES_OF_APE = new Set([BONE.lUpperArm, BONE.lForearm, BONE.rUpperArm, BONE.rForearm, BONE.lClavicle, BONE.rClavicle]);

/** The coat's colour as a multiple of the skin's, vertex by vertex: strand by strand, the saddle, the bare chest. */
function coatTint(body, positions, points, R, bones) {
  const look = body.inputs.look ?? {};
  const armor = outfitOf(body.inputs).look.armor ?? {};
  const rgb = (hex) => {
    const value = parseInt(String(hex ?? '#000000').replace('#', ''), 16);
    return [(value >> 16) & 255, (value >> 8) & 255, value & 255].map((channel) => Math.max(8, channel) / 255);
  };
  const skin = rgb(look.skinColor ?? armor.cloth);
  const saddle = rgb(armor.color ?? look.skinColor);
  const pelvis = points[P.pelvis];
  const neck = points[P.neck];
  const trunk = neck[1] - pelvis[1];
  const knee = points[P.lKnee][1];
  const tint = new Float32Array(positions.length);
  for (let vertex = 0; vertex < positions.length / 3; vertex += 1) {
    const [x, y, z] = [positions[vertex * 3], positions[vertex * 3 + 1], positions[vertex * 3 + 2]];
    const u = (y - pelvis[1]) / trunk;
    // (Which part a point is on by the bone that carries it most: the arms are black to the hands.)
    const bone = bones[vertex * 4];
    const onArm = ARM_BONES_OF_APE.has(bone);
    // The saddle (ARMOR_KINDS.silverback's `back`): behind the trunk from the rump to below the shoulder blades, and down the
    // backs and outsides of the thighs to the knees; its edge blended over `saddleEdge` of the trunk's depth.
    const behind = Math.max(0, Math.min(1, (-x - R * 0.1) / (R * APE.saddleEdge) + 0.5));
    const onBack = !onArm && u > -0.15 && u < 0.78 ? behind * Math.min(1, (0.78 - u) / 0.12) : 0;
    // (The thighs grey all round but for a strip down their fronts, fading out above the knee.)
    const thighBack = (bone === BONE.lThigh || bone === BONE.rThigh || bone === BONE.pelvis) && y < pelvis[1] && y > knee ? Math.max(0, Math.min(1, 0.8 - x / (R * APE.saddleEdge))) * Math.min(1, (y - knee) / (0.35 * (pelvis[1] - knee))) : 0;
    // Grizzled: silver hairs among black ones, more or fewer strand by strand.
    const silver = Math.max(onBack, thighBack) * (1 - APE.grizzle + APE.grizzle * 2 * strands(x * 2.3 + 5, y * 0.8, z * 2.3));
    // The bare chest: in front, over the pectorals.
    const bare = !onArm && x > R * 0.55 && u > 0.5 && u < 0.85 && Math.abs(z) < body.lengths.shoulderSpan * 0.42 ? APE.chest : 1;
    const shade = 1 + (strands(x * 1.7, y * 1.3, z * 1.7) - 0.5) * 2 * APE.shade;
    for (let axis = 0; axis < 3; axis += 1) tint[vertex * 3 + axis] = ((1 - silver) + silver * (saddle[axis] / skin[axis])) * shade * bare;
  }
  return tint;
}
