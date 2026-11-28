// The face customiser's solver: a made face's sliders (schema.js) as a change of the head's points.
//
// The rig is a set of facial bones (FACE_BONES: brow, eye, nose, cheek, mouth, jaw, chin), each a place on the face (read off
// the mesh it is given, so it sits on that head's own features) with the patch of skin that follows it (a smooth fall-off
// round it: its skin weights). A slider is a blend shape built on them (FACE_SCULPT): for each bone it drives, a move, a turn
// or a growth of that bone's patch. Sliders talk to their neighbours through a coupling matrix (FACE_COUPLING), and three
// macro sliders (age, the masculine-feminine balance, the emphasis: FACE_MACROS) drive many at once.
//
// The range is not clamped (the user's call, 2026-11-28): a slider at 0 or 255 moves its feature two or three times what any
// real face does. What keeps the mesh whole is how the shapes are added, not a limit on them. A blend shape added in one
// stroke folds the mesh as soon as a point is moved further than the patch round it is wide (the points behind overtake the
// points ahead). So the shapes are added as a flow: the whole change is cut into steps small enough that no step can fold
// (FACE_FLOW), every point is moved a step at a time, and the bones' places are carried along with the skin, so a nose pushed
// far out keeps being pushed from where its tip now is. A flow of small smooth steps is one-to-one whatever its length: the
// skin stretches as far as the slider says and never passes through itself. At small values it is the plain sum of the
// blend shapes.
//
// The same bones give the fight's expressions (FACE_EXPRESSIONS): each a small blend shape worked out once on the made face
// as a list of the points it moves, so a frame's expression is a few thousand additions (blendExpressions) and nothing else.
//
// Everything here is plain arrays in the head's unit space (x forward, y up, z to the fighter's left, the head's radius 1, the
// skull's proportions taken out: facemorph.js's space), so it runs in Node; only buildCustomHead touches three.js.
// A helmet is drawn round the game's stock head, so a head sculpted far from it will not fit one: headtuck.js draws in what
// stands out by up to its reach (3 cm), no more. Not solved here.

/* global THREE */
import { ETHNICITY_PRESETS, FACE_SHAPE_IDS, faceShapeKey, normalizeFace, sliderOffset } from './schema.js';
import { regionShape } from '../faceregions.js';
import { buildLatticeHead } from '../headlattice.js';
import { HEAD_GRID_DATA } from '../headgrid-data.js';
import { PHOTO_ATLAS } from '../photoface.js';
import { HEAD_SKULL } from '../basebody.js';
import { buildFallbackHead } from './fallbackhead.js';

/**
 * Where each landmark is on the photo atlas ([share round from the face's middle, row down from the crown]: headlattice.js),
 * read off the head model's lattices (both sexes share the atlas, so both have them here). A head's own landmarks are its
 * points nearest these (faceLandmarks), so the bones sit on the head they move.
 */
export const FACE_LANDMARK_PLACES = {
  nasion: [0, 0.42], noseTip: [0, 0.583], subnasale: [0, 0.616], alar: [0.033, 0.596],
  eye: [PHOTO_ATLAS.eyeU, PHOTO_ATLAS.eyeRow], browMid: [PHOTO_ATLAS.eyeU, 0.385], browIn: [0.03, 0.39], browOut: [0.11, 0.39],
  cheekbone: [0.14, 0.5], cheek: [0.105, 0.64],
  mouth: [0, PHOTO_ATLAS.mouthRow], mouthCorner: [0.05, PHOTO_ATLAS.mouthRow], lipUpper: [0, 0.675], lipLower: [0, 0.725],
  fold: [0, 0.77], chin: [0, 0.82], menton: [0, 0.87], jawCorner: [0.22, 0.82], jowl: [0.11, 0.8],
};

/** The head model's landmarks (the men's lattices' mix of no region), for a head given without its own: unit space. */
export const FACE_LANDMARKS = {
  nasion: [1.089, 0.02, 0], noseTip: [1.332, -0.385, 0], subnasale: [1.12, -0.5, 0], alar: [1.03, -0.36, 0.21],
  eye: [0.965, -0.07, 0.365], browMid: [1.061, 0.191, 0.462], browIn: [1.09, 0.15, 0.24], browOut: [0.85, 0.16, 0.68],
  cheekbone: [0.7, -0.16, 0.74], cheek: [0.87, -0.55, 0.58],
  mouth: [1.099, -0.72, 0], mouthCorner: [1.04, -0.768, 0.294], lipUpper: [1.15, -0.67, 0], lipLower: [1.15, -0.8, 0],
  fold: [1.128, -0.904, 0], chin: [1.166, -1.02, 0], menton: [1.1, -1.18, 0], jawCorner: [0.2, -0.6, 0.76], jowl: [0.8, -0.86, 0.52],
};

/**
 * A head's landmarks from its points: `points` flat [x, y, z, ...] in unit space, `uvs` flat, the atlas's (u 0.5 the face's
 * middle, v 1 the crown). The left side's (z >= 0); the right's are their mirror.
 */
export function faceLandmarks(points, uvs) {
  const marks = {};
  const count = uvs.length / 2;
  for (const [name, [du, row]] of Object.entries(FACE_LANDMARK_PLACES)) {
    let best = 0;
    let least = Infinity;
    for (let vertex = 0; vertex < count; vertex += 1) {
      // (u runs half the atlas's width for the head's half: weighed twice v, so a step round and a step down count alike.)
      const miss = (2 * (uvs[vertex * 2] - 0.5 - du)) ** 2 + (uvs[vertex * 2 + 1] - (1 - row)) ** 2;
      if (miss < least) [best, least] = [vertex, miss];
    }
    marks[name] = [points[best * 3], points[best * 3 + 1], du === 0 ? 0 : Math.abs(points[best * 3 + 2])];
  }
  // The nose's tip is the point of the middle line that stands furthest forward between the eyes and the mouth, wherever
  // this head's nose ends.
  for (let vertex = 0; vertex < count; vertex += 1) {
    const row = 1 - uvs[vertex * 2 + 1];
    if (Math.abs(uvs[vertex * 2] - 0.5) > 1e-4 || row < PHOTO_ATLAS.eyeRow || row > PHOTO_ATLAS.mouthRow - 0.04) continue;
    if (points[vertex * 3] > marks.noseTip[0]) marks.noseTip = [points[vertex * 3], points[vertex * 3 + 1], 0];
  }
  return marks;
}

/** The landmarks the bones use that are made of others: the bridge's middle, the nose's, the jaw's hinge and its middle. */
function derivedMarks(marks) {
  const mid = (a, b, share = 0.5) => a.map((value, axis) => value + (b[axis] - value) * share);
  return {
    ...marks,
    bridge: mid(marks.nasion, marks.noseTip, 0.45),
    noseMid: mid(marks.nasion, marks.subnasale, 0.6),
    // (The nose's root inside the face, behind its wings: what its tip turns about.)
    noseRoot: [marks.alar[0] - 0.05, marks.alar[1], 0],
    // (The jaw swings on the joint in front of the ear, level with the cheekbone; and its body, behind the chin.)
    hinge: [marks.jawCorner[0] - 0.05, marks.cheekbone[1] - 0.05, 0],
    jawMid: [marks.chin[0] - 0.3, marks.chin[1] + 0.12, 0],
  };
}

/**
 * The facial bones: `at` the landmark each sits on, `reach` how far its patch of skin runs from it (unit radii along x, y
 * and z: the fall-off's width, the weight exp(-d^2) of the distance in these units), `paired` one each side. The reaches are
 * the features' own sizes on the head model: a lip is thin up and down and broad across; the brow's patch runs along the
 * brow; depth (x) is generous, the patches being pieces of a surface.
 */
export const FACE_BONES = {
  brow: { at: 'browMid', reach: [0.3, 0.1, 0.26], paired: true },
  browIn: { at: 'browIn', reach: [0.3, 0.09, 0.12], paired: true },
  browOut: { at: 'browOut', reach: [0.3, 0.09, 0.15], paired: true },
  eye: { at: 'eye', reach: [0.22, 0.085, 0.15], paired: true },
  nasion: { at: 'nasion', reach: [0.25, 0.1, 0.1] },
  bridge: { at: 'bridge', reach: [0.22, 0.15, 0.09] },
  nose: { at: 'noseMid', reach: [0.3, 0.2, 0.17] },
  tip: { at: 'noseTip', reach: [0.14, 0.11, 0.12] },
  alar: { at: 'alar', reach: [0.12, 0.085, 0.085], paired: true },
  cheekbone: { at: 'cheekbone', reach: [0.35, 0.2, 0.26], paired: true },
  cheek: { at: 'cheek', reach: [0.3, 0.2, 0.2], paired: true },
  mouth: { at: 'mouth', reach: [0.22, 0.12, 0.3] },
  corner: { at: 'mouthCorner', reach: [0.15, 0.08, 0.1], paired: true },
  lipUpper: { at: 'lipUpper', reach: [0.14, 0.05, 0.24] },
  lipLower: { at: 'lipLower', reach: [0.14, 0.055, 0.22] },
  lips: { at: 'mouth', reach: [0.16, 0.09, 0.26] },
  jawSide: { at: 'jawCorner', reach: [0.4, 0.3, 0.28], paired: true },
  jaw: { at: 'jawMid', reach: [0.5, 0.3, 0.6] },
  jowl: { at: 'jowl', reach: [0.25, 0.14, 0.16], paired: true },
  chin: { at: 'chin', reach: [0.2, 0.13, 0.2] },
  chinTip: { at: 'menton', reach: [0.32, 0.17, 0.32] },
  fold: { at: 'fold', reach: [0.15, 0.05, 0.18] },
};

const faceMove = (bone, x, y, z) => ({ bone, kind: 'move', by: [x, y, z] });
const faceTurn = (bone, axis, angle, about = null) => ({ bone, kind: 'turn', axis, angle, about });
const faceGrow = (bone, x, y, z, about = null) => ({ bone, kind: 'grow', by: [x, y, z], about });

/**
 * The blend shapes: what each slider does at its full throw (255; 0 is the opposite), as bone changes. `move`: the patch
 * shifted (unit radii; z is outward from the face's middle on both sides). `turn`: turned (radians) about the bone or the
 * landmark `about`: axis 'x' in the face's plane (positive lifts the outer end), 'z' in profile (positive lifts the front).
 * `grow`: grown about the bone or `about` (a rate: the patch is e^rate times as large along each axis at the full throw).
 * These are a slider's slope at neutral: about the range real faces differ by (a nose tip's 13 % of the head's radius is some
 * 12 mm). The slider's ends go several times further (FACE_THROW).
 */
export const FACE_SCULPT = {
  browHeight: [faceMove('brow', 0.01, 0.085, 0)],
  browInner: [faceMove('browIn', 0, 0.07, 0)],
  browOuter: [faceMove('browOut', 0, 0.07, 0)],
  eyePosition: [faceMove('eye', 0, 0.06, 0)],
  eyeSize: [faceGrow('eye', 0, 0.55, 0.5)],
  eyeSlant: [faceTurn('eye', 'x', 0.32)],
  eyeSpacing: [faceMove('eye', 0, 0, 0.065)],
  bridgeDepth: [faceMove('bridge', 0.085, 0, 0), faceMove('nasion', 0.035, 0, 0)],
  bridgeLength: [faceMove('nasion', 0, 0.07, 0)],
  nosePosition: [faceMove('nose', 0, 0.07, 0)],
  noseHeight: [faceGrow('nose', 0, 0.4, 0, 'nasion')],
  noseProtrusion: [faceMove('tip', 0.13, 0, 0), faceMove('alar', 0.03, 0, 0)],
  noseSlant: [faceTurn('tip', 'z', 0.45, 'noseRoot')],
  nostrilWidth: [faceMove('alar', 0, 0, 0.065)],
  nostrilSize: [faceGrow('alar', 0.4, 0.5, 0.5)],
  nostrilSlant: [faceTurn('alar', 'x', 0.45)],
  cheekHeight: [faceMove('cheekbone', 0, 0.08, 0)],
  cheekDepth: [faceMove('cheekbone', 0.06, 0, 0.045)],
  cheekWidth: [faceMove('cheekbone', -0.01, 0, 0.085)],
  mouthPosition: [faceMove('mouth', 0, 0.065, 0)],
  mouthWidth: [faceGrow('mouth', 0, 0, 0.4)],
  mouthProtrusion: [faceMove('mouth', 0.08, 0, 0)],
  mouthSlant: [faceMove('corner', 0, 0.055, 0)],
  lipThickness: [faceMove('lipUpper', 0.005, 0.03, 0), faceMove('lipLower', 0.005, -0.035, 0)],
  lipFullness: [faceMove('lipUpper', 0.045, 0, 0), faceMove('lipLower', 0.05, 0, 0)],
  lipSize: [faceGrow('lips', 0.25, 0.45, 0.35)],
  jawWidth: [faceMove('jawSide', 0, 0, 0.11)],
  jawProtrusion: [faceMove('jaw', 0.1, 0, 0)],
  // (255 a square jaw, its corners low and out; 0 a tapered one, the corners drawn up and in.)
  jawContour: [faceMove('jawSide', 0.02, -0.09, 0.04)],
  chinLength: [faceMove('chinTip', 0, -0.08, 0)],
  chinHeight: [faceMove('chin', 0, 0.06, 0)],
  chinWidth: [faceGrow('chin', 0, 0, 0.7)],
  chinProtrusion: [faceMove('chin', 0.1, 0, 0)],
  // (The fold between the lower lip and the chin: deeper, and the chin's pad standing out under it.)
  chinDepth: [faceMove('fold', -0.04, 0, 0), faceMove('chin', 0.02, 0, 0)],
  // Age (255 old): the cheeks' fat slides down into jowls, the nose's tip droops, the brow's tail and the lids come down.
  age: [faceMove('jowl', 0, -0.06, 0.02), faceMove('cheek', -0.025, -0.03, 0), faceMove('tip', 0.01, -0.03, 0), faceMove('browOut', 0, -0.025, 0), faceGrow('eye', 0, -0.15, -0.05)],
  // The balance (0 masculine, 255 feminine): a lighter brow ridge, fuller cheeks, a narrower jaw and chin.
  gender: [faceMove('brow', -0.02, 0.02, 0), faceMove('cheek', 0.015, 0, 0.01), faceMove('jawSide', 0, 0.02, -0.05), faceGrow('chin', 0, 0, -0.3)],
  // Emphasis: the face's relief itself, every feature that stands out standing further out and the sockets deeper.
  emphasis: [faceMove('tip', 0.06, 0, 0), faceMove('bridge', 0.02, 0, 0), faceMove('brow', 0.03, 0, 0), faceMove('eye', -0.02, 0, 0), faceMove('cheekbone', 0.02, 0, 0.025),
    faceMove('lipUpper', 0.02, 0, 0), faceMove('lipLower', 0.02, 0, 0), faceMove('chin', 0.035, 0, 0), faceMove('jawSide', 0, 0, 0.03)],
};

/**
 * The macro sliders' pull on the others (a share of the macro's own offset added to each): what age and sex do to the
 * features that have a slider of their own. `emphasisGain`: the emphasis also multiplies every other slider's departure
 * from neutral, by 2^(gain x its offset): at 255 a face's features are twice as far from the neutral face, at 0 half.
 */
export const FACE_MACROS = {
  age: { lipThickness: -0.5, lipFullness: -0.3, noseHeight: 0.2, mouthSlant: -0.3, chinDepth: 0.3, cheekDepth: 0.15 },
  gender: { lipFullness: 0.35, noseProtrusion: -0.2, chinProtrusion: -0.25, jawContour: -0.4, eyeSize: 0.2, bridgeDepth: -0.2, browHeight: 0.2 },
  emphasisGain: 1,
};

/**
 * A slider's response: its offset from neutral (-1..1) plus `cube` times its cube. Near the middle a step is a step (the
 * believable faces: a third of the way out is 1.3 thirds of the written throw); at the ends the cube takes over and the
 * feature is `1 + cube` times its written throw from neutral, well past any real face (the user's call, 2026-11-28: the
 * ends really distort). 3: an eye set 26 % of the head's radius wider at 255, a nose half a radius longer.
 */
export const FACE_THROW = {
  cube: 3,
  // Age and the masculine-feminine balance move a dozen features together, each of which would be a caricature alone at
  // four times its throw: twice at their ends.
  macroCube: 1,
};
export const faceThrow = (offset, cube = FACE_THROW.cube) => offset * (1 + cube * offset * offset);

const faceCouple = (from, to, weight, reason, mutual = false) => ({ from, to, weight, reason, mutual });

/**
 * The cross-talk between neighbouring features: `weight` of slider `from`'s offset is added to slider `to`'s (`mutual`: and
 * the same the other way). Small, at most FACE_COUPLING_MOST, so a slider still does what its name says and the face moves a
 * little with it, as one piece of bone and skin does. Read from the raw sliders, never chained: A pulling B does not then
 * pull what B pulls.
 */
export const FACE_COUPLING = [
  faceCouple('browHeight', 'bridgeDepth', 0.1, 'the brow and the nose\'s root are one bone (the frontal): a higher brow carries the root up and out with it'),
  faceCouple('browInner', 'bridgeDepth', 0.06, 'the brows\' inner ends sit on the root of the nose'),
  faceCouple('browHeight', 'eyePosition', 0.08, 'the lid\'s skin hangs from the brow', true),
  faceCouple('eyeSpacing', 'bridgeDepth', -0.06, 'eyes set wide apart stretch the bridge between them flat'),
  faceCouple('eyeSpacing', 'nostrilWidth', 0.05, 'a broad mid-face is broad at the nose\'s wings too'),
  faceCouple('cheekHeight', 'eyePosition', 0.06, 'the cheekbone is the socket\'s floor'),
  faceCouple('cheekDepth', 'eyeSize', -0.05, 'a full cheek pushes the lower lid up'),
  faceCouple('noseProtrusion', 'bridgeDepth', 0.12, 'the tip is held out by the bridge behind it'),
  faceCouple('noseHeight', 'mouthPosition', -0.08, 'a longer nose pushes the upper lip down'),
  faceCouple('nostrilWidth', 'mouthWidth', 0.06, 'the wings and the mouth\'s corners are joined by the same fold of the cheek', true),
  faceCouple('mouthProtrusion', 'lipFullness', 0.1, 'lips over teeth set forward are pushed out and turned', true),
  faceCouple('mouthWidth', 'cheekDepth', -0.05, 'a wide mouth draws the cheeks\' skin flat'),
  faceCouple('jawWidth', 'cheekWidth', 0.12, 'the jaw\'s muscle runs up to the cheekbone\'s arch: a broad jaw carries it out', true),
  faceCouple('jawWidth', 'chinWidth', 0.15, 'the chin is the jaw\'s front: one bone', true),
  faceCouple('jawProtrusion', 'chinProtrusion', 0.15, 'the chin rides the jaw', true),
  faceCouple('jawProtrusion', 'mouthProtrusion', 0.1, 'the lower lip rides the jaw\'s teeth'),
  faceCouple('chinLength', 'jawContour', 0.08, 'a long chin draws the jaw\'s line down with it'),
];

/** The most any one coupling may weigh (test/facecustom.test.js holds the table to it): cross-talk, not a second slider. */
export const FACE_COUPLING_MOST = 0.2;

/**
 * The fight's expressions, each at its full weight: bone changes as FACE_SCULPT's, with `side` ('left' or 'right') for one
 * that is not the same on both. A third to a half of a slider's throw: an expression is the muscles' pull on the skin,
 * a few millimetres. The first six are whole expressions; the rest are single pulls to mix.
 */
export const FACE_EXPRESSIONS = {
  fury: [faceMove('browIn', 0, -0.05, -0.02), faceMove('browOut', 0, 0.015, 0), faceGrow('eye', 0, -0.2, 0), faceMove('alar', 0, 0.01, 0.02), faceMove('lipUpper', 0.005, 0.015, 0), faceMove('corner', 0, -0.025, 0), faceMove('jaw', 0.015, 0, 0)],
  fear: [faceMove('browIn', 0, 0.05, 0), faceMove('brow', 0, 0.03, 0), faceGrow('eye', 0, 0.3, 0.05), faceMove('corner', -0.01, -0.01, 0.025), faceTurn('jaw', 'z', -0.05, 'hinge')],
  shout: [faceTurn('jaw', 'z', -0.16, 'hinge'), faceMove('lipUpper', 0, 0.02, 0), faceMove('corner', -0.01, 0, 0.02), faceMove('browIn', 0, -0.025, -0.01), faceMove('alar', 0, 0, 0.015), faceMove('cheek', 0, 0.015, 0)],
  calm: [faceMove('brow', 0, 0.008, 0), faceGrow('eye', 0, -0.08, 0), faceMove('corner', 0, 0.006, 0)],
  pain: [faceMove('browIn', 0, -0.04, -0.02), faceGrow('eye', 0, -0.45, 0), faceMove('cheek', 0, 0.03, 0), faceMove('corner', -0.01, 0.01, 0.035), faceMove('lipUpper', 0, 0.02, 0), faceTurn('jaw', 'z', -0.04, 'hinge')],
  smirk: [{ ...faceMove('corner', -0.005, 0.04, 0.02), side: 'left' }, { ...faceMove('cheek', 0.005, 0.02, 0), side: 'left' }, { ...faceGrow('eye', 0, -0.1, 0), side: 'left' }],
  jawOpen: [faceTurn('jaw', 'z', -0.2, 'hinge')],
  browUp: [faceMove('brow', 0, 0.045, 0)],
  browDown: [faceMove('brow', 0, -0.035, 0), faceMove('browIn', 0, -0.02, -0.015)],
  squint: [faceGrow('eye', 0, -0.4, 0), faceMove('cheek', 0, 0.015, 0)],
  smile: [faceMove('corner', -0.01, 0.035, 0.03), faceMove('cheek', 0.01, 0.025, 0)],
  frown: [faceMove('corner', 0, -0.04, 0)],
};

export const FACE_FLOW = {
  // A step may change the distance between two neighbouring points by at most this share (the step's steepness: what a
  // point's move changes by over a unit of distance). Under 1 a step cannot fold; 0.3 leaves room for the patches that
  // overlap and for the estimate's coarseness.
  steep: 0.3,
  // The most steps (a head's points times the bones times this is a build's cost): every slider at an end at once asks for
  // more, and takes the last of its change in steps a little steeper than `steep`.
  most: 40,
  // The patches do not reach the back of the head (the nape, the scalp under a helmet, the neck's join): their weight fades
  // from full at `front[1]` (x, unit radii: just in front of the ear) to none at `front[0]` (behind it).
  front: [-0.25, 0.3],
  // A patch's weight under this is none (the points it would move by a ten-thousandth of its throw are skipped).
  cut: 9,
};

/** The slider drives a face comes to: each shape slider's own offset, the macros' pulls and the coupling added, times the emphasis. */
export function faceDrives(faceInput, baseline = null) {
  const face = normalizeFace(faceInput);
  const offset = {};
  for (const id of FACE_SHAPE_IDS) offset[id] = id === 'ethnicity' ? 0 : faceThrow(sliderOffset(face.sliders[id]), id === 'age' || id === 'gender' ? FACE_THROW.macroCube : FACE_THROW.cube) - (baseline && baseline[id] !== undefined ? faceThrow(sliderOffset(baseline[id])) : 0);
  const drives = {};
  const gain = 2 ** (FACE_MACROS.emphasisGain * sliderOffset(face.sliders.emphasis));
  for (const id of Object.keys(FACE_SCULPT)) {
    if (id === 'age' || id === 'gender' || id === 'emphasis') drives[id] = offset[id];
    else drives[id] = offset[id] + (FACE_MACROS.age[id] ?? 0) * offset.age + (FACE_MACROS.gender[id] ?? 0) * offset.gender;
  }
  for (const { from, to, weight, mutual } of FACE_COUPLING) {
    drives[to] += weight * offset[from];
    if (mutual) drives[from] += weight * offset[to];
  }
  for (const id of Object.keys(drives)) if (id !== 'age' && id !== 'gender' && id !== 'emphasis') drives[id] *= gain;
  return drives;
}

/** The coupling as a matrix over the shape sliders (rows the slider driven, columns the slider moved): the identity plus the table. */
export function couplingMatrix() {
  const ids = Object.keys(FACE_SCULPT).filter((id) => id !== 'age' && id !== 'gender' && id !== 'emphasis');
  const matrix = ids.map((row) => ids.map((column) => (row === column ? 1 : 0)));
  for (const { from, to, weight, mutual } of FACE_COUPLING) {
    matrix[ids.indexOf(to)][ids.indexOf(from)] += weight;
    if (mutual) matrix[ids.indexOf(from)][ids.indexOf(to)] += weight;
  }
  return { ids, matrix };
}

const AXIS_X = 0;
const AXIS_Z = 2;

/** One side's instance of a bone change at `amount` of its full throw, on the landmarks as they now are. */
function boneInstance(change, amount, marks, mirror, single) {
  const bone = FACE_BONES[change.bone];
  const centre = marks[bone.at];
  const about = change.about ? marks[change.about] : centre;
  const instance = {
    cx: centre[0], cy: centre[1], cz: centre[2],
    ix: 1 / bone.reach[0], iy: 1 / bone.reach[1], iz: 1 / bone.reach[2],
    px: about[0], py: about[1], pz: change.about ? about[2] : centre[2],
    // (`mirror`: the right side's, worked as the left's on the point's mirror image. `single`: one side's only, so not
    // also given to the other by the mirror.)
    mirror, single,
    kind: change.kind === 'move' ? 0 : change.kind === 'turn' ? 1 : 2,
    a: 0, b: 0, c: 0, axis: AXIS_X,
  };
  if (change.kind === 'turn') {
    instance.axis = change.axis === 'z' ? AXIS_Z : AXIS_X;
    // (About x, a positive turn lifts the outer end: on the left side, where z grows outward, that is a negative angle.)
    instance.a = (change.axis === 'z' ? 1 : -1) * change.angle * amount;
  } else {
    [instance.a, instance.b, instance.c] = change.by.map((value) => value * amount);
  }
  return instance;
}

/** The instances of a set of driven changes on the landmarks as they now are: [{ change list, amount }] to a flat list. */
function instancesOf(driven, marks) {
  const list = [];
  for (const { changes, amount } of driven) {
    for (const change of changes) {
      const bone = FACE_BONES[change.bone];
      if (!bone.paired) list.push(boneInstance(change, amount, marks, false, false));
      else {
        if (change.side !== 'right') list.push(boneInstance(change, amount, marks, false, Boolean(change.side)));
        if (change.side !== 'left') list.push(boneInstance(change, amount, marks, true, Boolean(change.side)));
      }
    }
  }
  return list;
}

const flowSmooth = (low, high, x) => {
  const t = Math.min(1, Math.max(0, (x - low) / (high - low)));
  return t * t * (3 - 2 * t);
};

/** Add to `out` (three numbers at `at`) what a list of instances moves the point (x, y, z) by. */
function addMoves(instances, x, y, z, out, at) {
  const front = flowSmooth(FACE_FLOW.front[0], FACE_FLOW.front[1], x);
  if (front <= 0) return;
  let mx = 0;
  let my = 0;
  let mz = 0;
  for (let index = 0; index < instances.length; index += 1) {
    const bone = instances[index];
    const sz = bone.mirror ? -z : z;
    const dx = (x - bone.cx) * bone.ix;
    const dy = (y - bone.cy) * bone.iy;
    const dz = (sz - bone.cz) * bone.iz;
    const far = dx * dx + dy * dy + dz * dz;
    if (far > FACE_FLOW.cut) continue;
    const weight = Math.exp(-far);
    let vx;
    let vy;
    let vz;
    if (bone.kind === 0) {
      vx = bone.a; vy = bone.b; vz = bone.c;
    } else if (bone.kind === 1) {
      if (bone.axis === AXIS_Z) {
        vx = -bone.a * (y - bone.py); vy = bone.a * (x - bone.px); vz = 0;
      } else {
        vx = 0; vy = -bone.a * (sz - bone.pz); vz = bone.a * (y - bone.py);
      }
    } else {
      vx = bone.a * (x - bone.px); vy = bone.b * (y - bone.py); vz = bone.c * (sz - bone.pz);
    }
    mx += weight * vx;
    my += weight * vy;
    mz += weight * (bone.mirror ? -vz : vz);
  }
  out[at] += front * mx;
  out[at + 1] += front * my;
  out[at + 2] += front * mz;
}

/** How steep an instance's move is at most (what it changes by over a unit of distance): for the count of steps. */
function steepness(bone) {
  const tight = Math.max(bone.ix, bone.iy, bone.iz);
  // (A patch's weight falls at most 0.86 of its height per reach; a turn or a growth is as steep as its rate, and as its
  // rate times the patch's own reach where the weight falls: about 2.3 of the rate together.)
  if (bone.kind === 0) return 0.86 * tight * Math.hypot(bone.a, bone.b, bone.c);
  if (bone.kind === 1) return 2.3 * Math.abs(bone.a);
  return 2.3 * Math.max(Math.abs(bone.a), Math.abs(bone.b), Math.abs(bone.c));
}

/** The steps a set of instances needs: the steepest place (the patches that overlap at some bone, added) over FACE_FLOW.steep. */
function flowStepsFor(instances) {
  let steepest = 0;
  for (const here of instances) {
    let sum = 0;
    for (const other of instances) {
      const z = here.mirror === other.mirror ? here.cz : -here.cz;
      const far = ((here.cx - other.cx) * other.ix) ** 2 + ((here.cy - other.cy) * other.iy) ** 2 + ((z - other.cz) * other.iz) ** 2;
      // (Half a reach nearer: a patch is steepest on its flank, not at its bone.)
      sum += steepness(other) * Math.exp(-(Math.max(0, Math.sqrt(far) - 0.7) ** 2));
    }
    steepest = Math.max(steepest, sum);
  }
  return Math.min(FACE_FLOW.most, Math.max(1, Math.ceil(steepest / FACE_FLOW.steep)));
}

const faceScaled = (driven, share) => driven.map(({ changes, amount }) => ({ changes, amount: amount * share }));
const marksFlat = (marks, names) => names.flatMap((name) => marks[name]);
const marksFrom = (flat, names) => Object.fromEntries(names.map((name, index) => [name, [flat[index * 3], flat[index * 3 + 1], flat[index * 3 + 2]]]));

/**
 * A face made ready for a head: `{ steps, frames, marks, identity, apply(points, out), point(p) }`. `landmarks`: the
 * head's own (faceLandmarks), else the head model's. `baseline`: the sliders the head's shape already stands for (a head
 * whose base is the preset's own, headlattice.js: the sliders then count from the preset's baseline, and the preset's face
 * is the head unchanged); none, they count from 128. `marks`: the landmarks as the face leaves them, for the expressions.
 */
export function compileFace(face, { landmarks = FACE_LANDMARKS, baseline = null } = {}) {
  const drives = faceDrives(face, baseline);
  const driven = Object.entries(drives).filter(([, amount]) => Math.abs(amount) > 1e-6).map(([id, amount]) => ({ changes: FACE_SCULPT[id], amount }));
  const names = Object.keys(landmarks);
  let marks = derivedMarks(landmarks);
  if (!driven.length) return { steps: 0, frames: [], marks, identity: true, apply: (points, out) => copyPoints(points, out), point: (p) => p.slice() };
  const steps = flowStepsFor(instancesOf(driven, marks));
  const perStep = faceScaled(driven, 1 / steps);
  const frames = [];
  let flat = marksFlat(landmarks, names);
  for (let step = 0; step < steps; step += 1) {
    const frame = instancesOf(perStep, marks);
    frames.push(frame);
    // The landmarks ride the skin: the next step's bones are where this one left them.
    const next = flat.slice();
    for (let index = 0; index < names.length; index += 1) addMoves(frame, flat[index * 3], flat[index * 3 + 1], flat[index * 3 + 2], next, index * 3);
    // (A landmark of the middle line stays on it: the two sides' pulls on it cancel, to rounding.)
    names.forEach((name, index) => { if (landmarks[name][2] === 0) next[index * 3 + 2] = 0; });
    flat = next;
    marks = derivedMarks(marksFrom(flat, names));
  }
  const apply = (points, out) => {
    const result = copyPoints(points, out);
    const moved = new Float64Array(3);
    for (let at = 0; at < result.length; at += 3) {
      for (let step = 0; step < steps; step += 1) {
        moved[0] = 0; moved[1] = 0; moved[2] = 0;
        addMoves(frames[step], result[at], result[at + 1], result[at + 2], moved, 0);
        result[at] += moved[0];
        result[at + 1] += moved[1];
        result[at + 2] += moved[2];
      }
    }
    return result;
  };
  const point = (p) => {
    const moved = [p[0], p[1], p[2]];
    // (A point behind the patches' reach is never moved: the scalp's hair asks for thousands of these.)
    if (p[0] <= FACE_FLOW.front[0] - 0.1) return moved;
    const by = [0, 0, 0];
    for (let step = 0; step < steps; step += 1) {
      by[0] = 0; by[1] = 0; by[2] = 0;
      addMoves(frames[step], moved[0], moved[1], moved[2], by, 0);
      moved[0] += by[0];
      moved[1] += by[1];
      moved[2] += by[2];
    }
    return moved;
  };
  return { steps, frames, marks, identity: false, apply, point };
}

function copyPoints(points, out) {
  const result = out ?? new Float32Array(points.length);
  if (result !== points) for (let index = 0; index < points.length; index += 1) result[index] = points[index];
  return result;
}

/**
 * The head's points as a face makes them: `basePositions` flat [x, y, z, ...] in unit space, written to `out` (made if not
 * given; may be `basePositions` itself). Pure: the same points and face give the same result. `opts`: compileFace's
 * (`landmarks`, `baseline`). Every slider at 128 (and no baseline) returns the points as they were.
 */
export function solveFacePoints(basePositions, face, out = null, opts = {}) {
  return compileFace(face, opts).apply(basePositions, out);
}

/**
 * The expressions worked out on a made head: for each of FACE_EXPRESSIONS, the points it moves and by how much at its
 * full weight ({ index: Uint32Array, delta: Float32Array (three a point) }), on `points` (flat, unit space, the sculpted
 * head's) with the sculpted landmarks `marks` (compileFace's). One stroke each, no flow: an expression is small.
 */
export function compileExpressions(points, marks) {
  const compiled = {};
  const by = new Float64Array(3);
  for (const [name, changes] of Object.entries(FACE_EXPRESSIONS)) {
    const instances = instancesOf([{ changes, amount: 1 }], marks);
    const index = [];
    const delta = [];
    for (let at = 0; at < points.length; at += 3) {
      by[0] = 0; by[1] = 0; by[2] = 0;
      addMoves(instances, points[at], points[at + 1], points[at + 2], by, 0);
      if (Math.abs(by[0]) + Math.abs(by[1]) + Math.abs(by[2]) < FACE_EXPRESSION.least) continue;
      index.push(at / 3);
      delta.push(by[0], by[1], by[2]);
    }
    compiled[name] = { index: Uint32Array.from(index), delta: Float32Array.from(delta) };
  }
  return compiled;
}

export const FACE_EXPRESSION = {
  // A point an expression moves by less than this (unit radii: a twentieth of a millimetre on a head) is left out of it.
  least: 5e-4,
  // A weight that has changed by less than this since the head was last written is not written again.
  still: 0.004,
};

/**
 * Write a mix of expressions into `out` (three numbers a point, the offsets from the made face; cleared first): `compiled`
 * compileExpressions's, `weights` { name: 0..1 }, `scale` the three axes' size (the skull's proportions times the head's
 * radius, to the mesh's own units). Returns whether anything is moved.
 */
export function blendExpressions(compiled, weights, out, scale = [1, 1, 1]) {
  out.fill(0);
  let any = false;
  for (const [name, weight] of Object.entries(weights ?? {})) {
    const shape = compiled[name];
    if (!shape || !(Math.abs(weight) > 1e-4)) continue;
    any = true;
    const { index, delta } = shape;
    for (let k = 0; k < index.length; k += 1) {
      const at = index[k] * 3;
      out[at] += weight * delta[k * 3] * scale[0];
      out[at + 1] += weight * delta[k * 3 + 1] * scale[1];
      out[at + 2] += weight * delta[k * 3 + 2] * scale[2];
    }
  }
  return any;
}

/**
 * How much each point's skin is stretched round the head and down it by the sculpt: flat [round, down] a point, 1 no
 * change (the distance between its neighbours in the lattice after, over before). The skin's folds are drawn by it
 * (skin.js): stretched skin's creases flatten, crowded skin's deepen. `before`, `after`: flat points, `rowCount` rows of
 * `stride`.
 */
export function gridStretch(before, after, rowCount, stride) {
  const stretch = new Float32Array(rowCount * stride * 2);
  const span = (points, a, b) => Math.hypot(points[a * 3] - points[b * 3], points[a * 3 + 1] - points[b * 3 + 1], points[a * 3 + 2] - points[b * 3 + 2]);
  const ratio = (a, b) => {
    const was = span(before, a, b);
    return was < 1e-6 ? 1 : Math.min(FACE_STRETCH.most, Math.max(1 / FACE_STRETCH.most, span(after, a, b) / was));
  };
  for (let row = 0; row < rowCount; row += 1) {
    for (let column = 0; column < stride; column += 1) {
      const vertex = row * stride + column;
      stretch[vertex * 2] = ratio(row * stride + Math.max(0, column - 1), row * stride + Math.min(stride - 1, column + 1));
      stretch[vertex * 2 + 1] = ratio(Math.max(0, row - 1) * stride + column, Math.min(rowCount - 1, row + 1) * stride + column);
    }
  }
  return stretch;
}

// The most a stretch is taken to be (and the least, its inverse): past four times, the skin's folds are flat or the
// mesh's cells too few to tell.
export const FACE_STRETCH = { most: 4 };

/**
 * A face as a sculptor for the head model (headlattice.js buildLatticeHead's `sculpt`, fallbackhead.js's): given the head's
 * points before it ({ points: [[x, y, z]], uvs: flat, rowCount, stride }, unit space), returns { points, point(p), stretch,
 * marks, compiled }. `baseline`: compileFace's.
 */
export function faceSculptor(face, { baseline = null } = {}) {
  return ({ points, uvs, rowCount, stride }) => {
    const before = new Float32Array(points.length * 3);
    points.forEach((p, vertex) => before.set(p, vertex * 3));
    const compiled = compileFace(face, { landmarks: faceLandmarks(before, uvs), baseline });
    const after = compiled.apply(before, new Float32Array(before.length));
    return {
      points: points.map((_, vertex) => [after[vertex * 3], after[vertex * 3 + 1], after[vertex * 3 + 2]]),
      point: compiled.point,
      stretch: gridStretch(before, after, rowCount, stride),
      marks: compiled.marks,
      compiled,
    };
  };
}

/**
 * A made head's expressions, ready to be mixed each frame: `head` the head model's mesh (buildLatticeHead's or
 * buildFallbackHead's, built with a sculptor), `scale` the mesh's units per unit radius (three axes). Returns
 * { offsets: Float32Array (three a point), set(weights): whether the offsets changed }. The lid under the jaw
 * (headlattice.js) follows its rim, so an open jaw does not tear it.
 */
export function headExpressions(head, scale) {
  const unit = new Float32Array(head.unit.length * 3);
  head.unit.forEach((p, vertex) => unit.set(p, vertex * 3));
  const compiled = compileExpressions(unit, head.sculpted.marks);
  const { rowCount, stride, lidRow, rows } = head.grid;
  if (lidRow < rowCount - 1) {
    for (const shape of Object.values(compiled)) {
      const rim = new Map();
      shape.index.forEach((vertex, k) => { if (Math.floor(vertex / stride) === lidRow) rim.set(vertex % stride, k); });
      const kept = [];
      shape.index.forEach((vertex, k) => { if (Math.floor(vertex / stride) <= lidRow) kept.push([vertex, shape.delta[k * 3], shape.delta[k * 3 + 1], shape.delta[k * 3 + 2]]); });
      for (let row = lidRow + 1; row < rowCount; row += 1) {
        const share = 1 - (rows[row] - rows[lidRow]) / (rows[rowCount - 1] - rows[lidRow]);
        for (const [column, k] of rim) kept.push([row * stride + column, shape.delta[k * 3] * share, shape.delta[k * 3 + 1], shape.delta[k * 3 + 2] * share]);
      }
      shape.index = Uint32Array.from(kept.map((entry) => entry[0]));
      shape.delta = Float32Array.from(kept.flatMap((entry) => entry.slice(1)));
    }
  }
  const offsets = new Float32Array(unit.length);
  let last = {};
  let moved = false;
  const set = (weights = {}) => {
    const names = new Set([...Object.keys(weights), ...Object.keys(last)]);
    let changed = false;
    for (const name of names) if (compiled[name] && Math.abs((weights[name] ?? 0) - (last[name] ?? 0)) > FACE_EXPRESSION.still) changed = true;
    if (!changed) return false;
    last = Object.fromEntries(Object.entries(weights).filter(([name]) => compiled[name]).map(([name, weight]) => [name, Math.min(1, Math.max(0, weight))]));
    const any = blendExpressions(compiled, last, offsets, scale);
    const wrote = any || moved;
    moved = any;
    return wrote;
  };
  return { offsets, set, compiled };
}

/** The sliders a head built on the preset's own regions already stands for: the preset's baseline (compileFace `baseline`). */
export const presetBaseline = (face) => ETHNICITY_PRESETS[face.preset]?.sliders ?? null;

/** The head-shape tendencies of a preset's regions (faceregions.js), the first's with `blend` of the second's: the head model's base. */
export function presetRegionShape(presetId, blend = FACE_HEAD.blend) {
  const regions = ETHNICITY_PRESETS[presetId]?.regions ?? [];
  const [first, second] = [regionShape(regions[0]), regionShape(regions[1] ?? regions[0])];
  const shape = {};
  for (const key of new Set([...Object.keys(first), ...Object.keys(second)])) shape[key] = (first[key] ?? 0) * (1 - blend) + (second[key] ?? 0) * blend;
  return shape;
}

export const FACE_HEAD = {
  // The second region's share of a preset's face (its maps and its head's base): the middle of what the game's own casting
  // gives a fighter (photoface.js PHOTO_FACES.vary.blend, 0.15 to 0.45).
  blend: 0.3,
  // A head made on its own (buildCustomHead, the customiser's preview) is a head's radius of 1 unless told.
  radius: 1,
};

// The skin pipeline (skin.js) puts itself here when it loads: it needs three.js and the photo faces, which this file must
// run without (Node: the tests, a tool).
const faceSkinPipeline = { materialFor: null, update: null };
export function registerFaceSkin(pipeline) {
  Object.assign(faceSkinPipeline, pipeline);
}

/**
 * The head model's mesh for a made face, as plain arrays (buildLatticeHead's result; the procedural head where the head
 * model's data is not to hand: fallbackhead.js). `opts`: { sex, lod ('near', 'far' or 'coarse': the last a crowd's quarter
 * of the points), radius, data (the lattices: HEAD_GRID_DATA unless given; null for the procedural head), morph (the body's:
 * facemorph.js), jitter, region (the base's shape, else the preset's own) }.
 */
export function customHeadMesh(faceInput, opts = {}) {
  const face = normalizeFace(faceInput);
  const female = (opts.sex ?? face.sex) === 'female';
  const data = opts.data === undefined ? HEAD_GRID_DATA : opts.data;
  const radius = opts.radius ?? FACE_HEAD.radius;
  if (!data) return buildFallbackHead({ radius, skull: HEAD_SKULL, female, sculpt: faceSculptor(face), atlas: PHOTO_ATLAS });
  return buildLatticeHead({
    data, radius, skull: HEAD_SKULL, shape: { morph: opts.morph ?? null }, atlas: PHOTO_ATLAS, region: opts.region ?? presetRegionShape(face.preset),
    jitter: opts.jitter ?? {}, coarse: opts.lod === 'coarse', female, sculpt: faceSculptor(face, { baseline: presetBaseline(face) }),
  });
}

/**
 * A made face's head on its own (the customiser's preview, a portrait): `{ group, mesh, setFace(face), setExpression(weights),
 * dispose(), stats }`. `opts`: customHeadMesh's, and `cast` (the photo cast its maps come from: photoface.js customPhotoCast;
 * none, the procedural maps), `material` (one to use as it is). The mesh is the head alone, in the head's local space (x
 * forward, y up), no hair, ears or neck. `setFace` re-solves the same mesh in place; `setExpression` ({ fury, fear, shout,
 * calm, pain, smirk, ... } each 0..1: FACE_EXPRESSIONS) costs a few thousand additions and one buffer upload, and nothing
 * when the weights have not changed.
 */
export function buildCustomHead(faceInput, opts = {}) {
  let face = normalizeFace(faceInput);
  let head = customHeadMesh(face, opts);
  const radius = opts.radius ?? FACE_HEAD.radius;
  const scale = HEAD_SKULL.map((value) => value * radius);
  const geometry = new THREE.BufferGeometry();
  const attribute = (name, array, size) => geometry.setAttribute(name, new THREE.BufferAttribute(array instanceof Float32Array ? array : Float32Array.from(array), size));
  attribute('position', head.positions, 3);
  attribute('normal', head.normals, 3);
  attribute('uv', head.uvs, 2);
  attribute('tangent', head.tangents, 4);
  attribute('color', head.colors, 3);
  attribute('faceStretch', head.sculpted.stretch, 2);
  const far = opts.lod === 'far' && head.farIndices;
  geometry.setIndex(far ? head.farIndices : head.indices);
  const material = opts.material ?? faceSkinPipeline.materialFor?.(face, { cast: opts.cast ?? null, sex: opts.sex ?? face.sex }) ?? new THREE.MeshStandardMaterial({ color: 0xc58c64, roughness: 0.7, vertexColors: true });
  const mesh = new THREE.Mesh(geometry, material);
  mesh.castShadow = true;
  const group = new THREE.Group();
  group.add(mesh);
  let rest = Float32Array.from(head.positions);
  let expressions = null;
  let shapeKey = faceShapeKey(face);
  let weightsNow = {};
  const write = (name, array) => {
    geometry.attributes[name].array.set(array);
    geometry.attributes[name].needsUpdate = true;
  };
  function setExpression(weights) {
    weightsNow = weights ?? {};
    expressions ??= headExpressions(head, scale);
    if (!expressions.set(weightsNow)) return;
    const position = geometry.attributes.position.array;
    const offsets = expressions.offsets;
    for (let index = 0; index < position.length; index += 1) position[index] = rest[index] + offsets[index];
    geometry.attributes.position.needsUpdate = true;
  }
  function setFace(next) {
    face = normalizeFace(next);
    faceSkinPipeline.update?.(material, face);
    if (faceShapeKey(face) === shapeKey) return;
    shapeKey = faceShapeKey(face);
    head = customHeadMesh(face, opts);
    rest = Float32Array.from(head.positions);
    write('position', rest);
    write('normal', head.normals);
    write('tangent', head.tangents);
    write('color', Float32Array.from(head.colors));
    write('faceStretch', head.sculpted.stretch);
    geometry.computeBoundingSphere();
    // (The expression in force is worked out again on the new face.)
    const had = expressions !== null;
    expressions = null;
    if (had) setExpression(weightsNow);
  }
  function dispose() {
    geometry.dispose();
    if (!opts.material) material.dispose();
  }
  const stats = { points: head.positions.length / 3, triangles: geometry.index.count / 3 };
  return { group, mesh, setFace, setExpression, dispose, stats, get face() { return face; }, get head() { return head; } };
}

