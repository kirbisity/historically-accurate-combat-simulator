// Photo faces: a head drawn from a photographed face, with a normal map for
// its relief and a roughness map, in place of the drawn anime eyes, brows and
// mouth. On unless the page is opened with #faces=off (the drawn faces).
//
// The faces are regional "average face" composites (frontal photos): each is
// projected offline (tools/photofaces/avg_build.py) into one canonical
// cylindrical atlas (PHOTO_ATLAS: the face at the middle, the eyes, lip line
// and chin at fixed places, the back of the head at both edges), the rest of
// the head synthesised as skin, its light flattened, and its colour stored
// relative to its own cheeks: the game multiplies it by the fighter's skin, so
// face and body match. One set of texture coordinates on the head (photohead.js)
// fits every face.
//
// Who gets which face: faceregions.js (by culture and kit, or the fighter's
// own `faceRegion`), two regions blended per fighter, with his skin and
// proportions jittered by a seed, so an army is not one man cloned.
//
// The atlases are in assets/faces/ (PHOTO_FACES.base), each face's maps
// fetched when a fighter first wears it; the single-file bundle carries them
// as data URLs (PHOTO_FACE_EMBED). Missing, the heads stay drawn.

/* global THREE */
import { hasOrigin, nearestRegion, regionGroup, regionShape, regionsFor, REGION_DETAIL, toneShift } from './faceregions.js';
import { luminance, shadeColor } from './skintones.js';
import { SCALP_GLSL } from './photohair.js';
import { PHOTO_HEAD } from './photohead.js';
import { NECK_JOIN } from './basebody.js';
import { ETHNICITY_PRESETS, faceToJSON, normalizeFace, surfaceValues, tonedSkin } from './facecustom/schema.js';
import { makeupPaintAt, makeupValues, makeupWorn } from './facecustom/makeup.js';

/**
 * Where the landmarks sit in the atlas: u from the face's centre (eyes, ears); rows from the crown (eye line, lip line, chin, and
 * about where a hairline is: `hairlineRow`, put on the head at `hairlineAt` of the way from the middle up to the crown, by angle).
 * `eyeHalf`: an eye's half-width (u) and half-height (v), for the blink.
 */
export const PHOTO_ATLAS = { eyeU: 0.0668, earU: 0.258, eyeRow: 0.44, mouthRow: 0.70, chinRow: 0.88, mouthShare: 0.56, chinT: 0.95, hairlineRow: 0.22, hairlineAt: 0.36, eyeHalf: [0.027, 0.013] };

export const PHOTO_FACES = {
  base: 'assets/faces/',
  // How much a fighter varies: the second region's share of his face, his skin's brightness and warmth, his face's width and
  // the height of his eyes and mouth (atlas rows).
  vary: { blend: [0.15, 0.45], bright: 0.06, warm: 0.03, width: 0.06, eyeRow: 0.008, mouthRow: 0.012, region: 0.8, shape: 0.25, measured: 0.35 },
  // The face's ambient light, scaled (setPhotoFill, env config.js faceFill). 1: the head is lit as the body is. At 1.8
  // (and the open air's 1.5), with the scatter below on the head alone, a head stood paler and warmer than the neck under
  // it: the albedos at the join are the same (lowest eighth of the head against the neck's top, a man and a woman of BMI
  // 22: within 1 % in red, 3 to 4 % in green and blue), so the difference was all light; the face 1.4 times the chest's
  // brightness in the field at 1.5, within 6 % with the fill at 1 and the scatter on both.
  fill: 1,
  // Skin lets a light through it: the sun's light reaches this far past where a surface turns from it (as a share of the
  // turn: lit to a cosine of -scatter), the whole no brighter for it (the lit side gives up what the turned side gains).
  // Approximate, set by eye against the men's brow: its underside, turned just past the sun (the sockets are 8 to 9 mm
  // deep under it), was a fifth of the cheek's light and a brown mask over the eyes; it is a third of it at 0.5. The same
  // light on the body's skin (skinScatter): skin is one tissue, and on the head alone it warmed the face turned from the sun.
  scatter: 0.5,
  normalScale: 1,
  // A made face (facecustom/): the second region's share of it (the middle of `vary.blend`: what casting deals at random,
  // fixed, so a face is the same face every time it is built), and the painted detail a dealt face draws by lot at about
  // the middle of its lot (freckles on those peoples who freckle, a few moles, a light skin's ruddiness).
  custom: { blend: 0.3, freckles: 0.3, moles: 0.006, redness: 0.4 },
};

const photoManifest = { faces: null, neutral: 0.8, thumb: [32, 16] };
/** The regions there are faces of for a sex (the character creator's origins), or null: photo faces off, or not loaded yet. */
export function photoFaceRegions(sex) {
  if (!photoFacesOn() || !photoManifest.faces) return null;
  const wanted = sex === 'female' ? 'female' : 'male';
  return Object.values(photoManifest.faces).filter((face) => face.sex === wanted).map((face) => face.region);
}

const photoTextures = new Map();
let photoWanted = null;
let photoLoading = null;

/** Whether heads are drawn from photos: on, unless the URL says #faces=off (the drawn faces); the harness may set it. */
export function photoFacesOn() {
  if (photoWanted === null) {
    const hash = typeof location === 'undefined' ? '' : location.hash.replace(/^#/, '');
    photoWanted = new URLSearchParams(hash).get('faces') !== 'off';
  }
  // (The base body's neck is shaped to the head it meets.)
  NECK_JOIN.photoHead = photoWanted;
  return photoWanted;
}

// The single-file bundle (tools/bundle.js) fills this with the maps as data URLs, by file name; the page served from the
// repository fetches them from PHOTO_FACES.base.
const PHOTO_FACE_EMBED = null;
/** Where a face file is read from: the bundle's data URL, or the folder. */
const photoFile = (file) => PHOTO_FACE_EMBED?.[file] ?? `${PHOTO_FACES.base}${file}`;

/** Turn photo faces on or off (the next heads built follow it); loads the manifest on the way on. */
export function setPhotoFaces(on) {
  photoWanted = Boolean(on);
  NECK_JOIN.photoHead = photoWanted;
  return photoWanted ? loadPhotoFaces() : Promise.resolve(0);
}

/** Load the faces' manifest (once): which faces there are, their skin and hair, a thumbnail each; resolves to how many. */
export function loadPhotoFaces() {
  photoLoading ??= fetch(photoFile('manifest.json')).then((answer) => (answer.ok ? answer.json() : null)).catch(() => null).then((data) => {
    if (!data) return 0;
    photoManifest.neutral = data.neutral;
    photoManifest.thumb = data.thumb;
    photoManifest.faces = Object.fromEntries(Object.entries(data.faces).map(([key, face]) => {
      const bytes = Uint8Array.from(atob(face.thumb), (char) => char.charCodeAt(0));
      return [key, { key, ...face, thumb: bytes }];
    }));
    return Object.keys(photoManifest.faces).length;
  });
  return photoLoading;
}

function photoTexture(file) {
  if (photoTextures.has(file)) return photoTextures.get(file).texture;
  const texture = new THREE.TextureLoader().load(photoFile(file), (loaded) => {
    const entry = photoTextures.get(file);
    if (entry) entry.bytes = Math.round(loaded.image.width * loaded.image.height * 4 * (4 / 3));
  });
  texture.wrapS = THREE.RepeatWrapping;
  texture.anisotropy = 4;
  photoTextures.set(file, { texture, bytes: 0 });
  return texture;
}

/** What the loaded maps cost on the GPU (RGBA8 with mipmaps): each face's and all together (bytes). */
export function photoFaceStats() {
  const faces = {};
  let shared = 0;
  let total = 0;
  for (const [file, { bytes }] of photoTextures) {
    const face = /^(.*)-(albedo\.jpg|normal\.png)$/.exec(file);
    if (face) faces[face[1]] = (faces[face[1]] ?? 0) + bytes;
    else shared += bytes;
    total += bytes;
  }
  const pending = [...photoTextures.values()].filter(({ bytes }) => bytes === 0).length;
  return { faces: Object.keys(faces).length, perFace: faces, shared, total, pending, available: photoManifest.faces ? Object.keys(photoManifest.faces).length : 0 };
}

/** A small photoSeeded generator (mulberry32). */
function photoSeeded(seed) {
  let state = seed >>> 0;
  return () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let mixed = Math.imul(state ^ (state >>> 15), 1 | state);
    mixed = (mixed + Math.imul(mixed ^ (mixed >>> 7), 61 | mixed)) ^ mixed;
    return ((mixed ^ (mixed >>> 14)) >>> 0) / 4294967296;
  };
}
const photoHash = (text) => [...String(text ?? '')].reduce((hash, char) => (Math.imul(hash, 31) + char.charCodeAt(0)) >>> 0, 2166136261);

const photoCasts = new WeakMap();
let photoCastCount = 0;
/** Start a fight's casting: its fighters are seeded 0, 1, 2, ... in the order they are built, so a fight looks the same each time. */
export function resetPhotoCasting() {
  photoCastCount = 0;
}

/**
 * The face a fighter is drawn with (the same for the same inputs, every time it is asked), or null (photo faces off, the manifest
 * not loaded, a machine or an ape). `{ primary, secondary, blend, skin, hair, jitter, shape, detail }`: two faces of his sex
 * blended, his skin colour (the face's maps are relative to it), his hair's (greying with age), the jitter of his proportions,
 * his head's region shape (faceregions.js REGION_SHAPES, the composite's measured nose, jitter: photohead.js), and the detail
 * the shader paints (stubble, freckles, moles, redness, age lines).
 */
export function photoFaceFor(inputs, outfitRegion = null) {
  if (!photoFacesOn() || !photoManifest.faces) return null;
  if (!hasOrigin(inputs)) return null;
  // A made face (`look.faceCustom`, facecustom/schema.js) is cast from its preset's regions, not dealt one. (It takes its
  // turn in the fight's count all the same, so the men built after it are dealt the faces they always were.)
  if (inputs.look?.faceCustom) {
    const key = faceToJSON(inputs.look.faceCustom);
    const had = photoCustomCasts.get(inputs);
    if (had?.key === key) return had.cast;
    photoCastCount += 1;
    const cast = customPhotoCast(inputs.look.faceCustom, { sex: inputs.sex, name: inputs.name, age: inputs.age, bodyFat: inputs.bodyFat, facialHair: inputs.look?.facialHair });
    photoCustomCasts.set(inputs, { key, cast });
    return cast;
  }
  if (photoCasts.has(inputs)) return photoCasts.get(inputs);
  const sex = inputs.sex === 'female' ? 'female' : 'male';
  const available = Object.values(photoManifest.faces).filter((face) => face.sex === sex).map((face) => face.region);
  const random = photoSeeded(photoHash(inputs.name) + photoCastCount * 7919);
  photoCastCount += 1;
  const regions = regionsFor(inputs, outfitRegion).map((region) => nearestRegion(region, available));
  const first = regions[Math.floor(random() * regions.length) % regions.length];
  // The second: another of his culture's, else the nearest of the same group (faceregions.js), else the nearest of all.
  const others = regions.filter((region) => region !== first);
  const kin = available.filter((region) => region !== first && regionGroup(region) === regionGroup(first));
  const second = others.length ? others[Math.floor(random() * others.length)] : nearestRegion(first, kin.length ? kin : available.filter((region) => region !== first));
  const vary = PHOTO_FACES.vary;
  const primary = photoManifest.faces[`${sex}-${first}`];
  const secondary = photoManifest.faces[`${sex}-${second}`] ?? primary;
  const blend = vary.blend[0] + random() * (vary.blend[1] - vary.blend[0]);
  const skin = new THREE.Color(primary.skin).lerp(new THREE.Color(secondary.skin), blend);
  const hsl = skin.getHSL({});
  skin.setHSL(hsl.h + (random() - 0.5) * 2 * vary.warm * 0.1, hsl.s * (1 + (random() - 0.5) * 2 * vary.warm), hsl.l * (1 + (random() - 0.5) * 2 * vary.bright));
  // An origin chosen with a lighter or darker skin than its own (faceregions.js toneShift): the composite's skin made lighter or
  // darker by the ratio of the two shades' brightness, its hue kept, so it stays this face's skin, a shade off. (Not the ratio
  // channel by channel: the ladder's tones differ in hue too, and a yellow tone over a pink one turned a light Korean pink.)
  // (No draw from `random`: the rest of his casting is the same whatever his tone.)
  const shift = toneShift(inputs);
  if (shift) {
    const ratio = luminance(shadeColor(shift.to)) / luminance(shadeColor(shift.from));
    const scale = Math.min(ratio, 1 / Math.max(skin.r, skin.g, skin.b, 1e-6));
    skin.setRGB(skin.r * scale, skin.g * scale, skin.b * scale);
  }
  const age = inputs.age ?? 30;
  const grey = Math.min(1, Math.max(0, (age - 42) / 30)) * 0.75;
  const hair = new THREE.Color(primary.hair).lerp(new THREE.Color(secondary.hair), blend).lerp(new THREE.Color(0x9a958e), grey);
  const jitter = { width: (random() - 0.5) * 2 * vary.width, eyeRow: (random() - 0.5) * 2 * vary.eyeRow, mouthRow: (random() - 0.5) * 2 * vary.mouthRow };
  // The head's shape: the two regions' tendencies blended, the composite's own nose, his own jitter.
  const shapeA = regionShape(first);
  const shapeB = regionShape(second);
  const shape = {};
  for (const name of PHOTO_SHAPE_KEYS) {
    let value = (shapeA[name] ?? 0) * (1 - blend) + (shapeB[name] ?? 0) * blend;
    if (name === 'noseWidth') value = value * (1 - vary.measured) + (primary.measured?.noseWidth ?? 0) * vary.measured;
    shape[name] = value * vary.region + (random() - 0.5) * 2 * vary.shape;
  }
  // What the shader paints: stubble by the region and age (and full where he wears a beard), freckles on fair skin of freckled
  // regions, a few moles, ruddiness on light skin, age lines.
  const light = Math.min(1, Math.max(0, (skin.getHSL({}).l - 0.45) / 0.25));
  const group = regionGroup(first);
  const facialHair = inputs.look?.facialHair ?? 'none';
  const beardy = (REGION_DETAIL.beard[group] ?? 0.5) * (0.6 + 0.4 * Math.min(1, age / 35));
  const detail = {
    seed: random() * 100,
    stubble: sex === 'male' ? Math.min(1, (facialHair === 'none' ? 0.25 + 0.35 * random() : 0.85) * beardy * (facialHair === 'none' ? 1 : 1.4)) : 0,
    freckles: (REGION_DETAIL.freckles[first] ?? 0) * light * (random() < 0.6 ? 0.3 + 0.7 * random() : 0),
    moles: 0.002 + 0.01 * random(),
    redness: light * (0.25 + 0.4 * random()),
    wrinkles: Math.min(1, Math.max(0, (age - 35) / 35, ((inputs.bodyFat ?? 0.15) - 0.25) * 1.2)),
  };
  const cast = { id: `${primary.key}+${secondary.key}`, primary, secondary, blend, skin: `#${skin.getHexString()}`, hair: `#${hair.getHexString()}`, jitter, shape, detail, age };
  photoCasts.set(inputs, cast);
  return cast;
}
const photoCustomCasts = new WeakMap();
/**
 * The cast of a made face (facecustom/schema.js): its preset's regions' composites (the first its own, the second blended in
 * at facecustom's fixed share: the nearest there is of each, for the sex), their skin at the face's tone, the regions' own
 * head shape with nothing dealt at random (the sliders are the fighter's own departures: facecustom/solver.js), and the
 * detail a man of that people and age is painted with. The same for the same face, every time. Null as photoFaceFor's is.
 * `who`: { sex, name (seeds the freckles' and stubble's lay), age, bodyFat, facialHair }.
 */
export function customPhotoCast(faceInput, who = {}) {
  if (!photoFacesOn() || !photoManifest.faces) return null;
  const face = normalizeFace(faceInput);
  const sex = (who.sex ?? face.sex) === 'female' ? 'female' : 'male';
  const available = Object.values(photoManifest.faces).filter((entry) => entry.sex === sex).map((entry) => entry.region);
  const regions = ETHNICITY_PRESETS[face.preset].regions.map((region) => nearestRegion(region, available));
  const first = regions[0];
  const second = regions.find((region) => region !== first) ?? first;
  const primary = photoManifest.faces[`${sex}-${first}`];
  const secondary = photoManifest.faces[`${sex}-${second}`] ?? primary;
  const blend = second === first ? 0 : PHOTO_FACES.custom.blend;
  const tone = surfaceValues(face.surface).tone;
  const mixed = new THREE.Color(primary.skin).lerp(new THREE.Color(secondary.skin), blend);
  const skin = new THREE.Color(...tonedSkin([mixed.r, mixed.g, mixed.b], tone));
  const age = who.age ?? 30;
  const grey = Math.min(1, Math.max(0, (age - 42) / 30)) * 0.75;
  const hair = new THREE.Color(primary.hair).lerp(new THREE.Color(secondary.hair), blend).lerp(new THREE.Color(0x9a958e), grey);
  const [shapeA, shapeB] = [regionShape(first), regionShape(second)];
  const shape = Object.fromEntries(PHOTO_SHAPE_KEYS.map((name) => [name, ((shapeA[name] ?? 0) * (1 - blend) + (shapeB[name] ?? 0) * blend) * PHOTO_FACES.vary.region]));
  const random = photoSeeded(photoHash(`${who.name ?? ''}|${face.preset}`));
  const light = Math.min(1, Math.max(0, (skin.getHSL({}).l - 0.45) / 0.25));
  const facialHair = who.facialHair ?? 'none';
  const beardy = (REGION_DETAIL.beard[regionGroup(first)] ?? 0.5) * (0.6 + 0.4 * Math.min(1, age / 35));
  const detail = {
    seed: random() * 100,
    stubble: sex === 'male' ? Math.min(1, (facialHair === 'none' ? 0.4 : 0.85) * beardy * (facialHair === 'none' ? 1 : 1.4)) : 0,
    freckles: (REGION_DETAIL.freckles[first] ?? 0) * light * PHOTO_FACES.custom.freckles,
    moles: PHOTO_FACES.custom.moles,
    redness: light * PHOTO_FACES.custom.redness,
    wrinkles: Math.min(1, Math.max(0, (age - 35) / 35, ((who.bodyFat ?? 0.15) - 0.25) * 1.2)),
  };
  return { id: `${primary.key}+${secondary.key}`, primary, secondary, blend, skin: `#${skin.getHexString()}`, hair: `#${hair.getHexString()}`, jitter: { width: 0, eyeRow: 0, mouthRow: 0 }, shape, detail, age, tone, custom: face };
}
const PHOTO_SHAPE_KEYS = ['noseBridge', 'noseWidth', 'brow', 'cheekbone', 'cheekWidth', 'socket', 'lidFold', 'lips', 'jaw', 'chin', 'faceLength', 'cephalic'];

/**
 * Makeup on the photo head (facecustom/makeup.js: the parts and the looks), drawn in the skin's shader at the atlas's own
 * landmarks (PHOTO_ATLAS), so it sits on any face's maps and any head's shape. Faces without makeup draw with the shader they
 * always had: the makeup is a variant of it (FACE_MAKEUP defined), compiled once when the first made-up face is drawn and
 * shared by every made-up face after. Places are in the atlas's rows (u counted twice: a row is as long as half a u, the
 * atlas being twice as wide as tall), each found by eye against the twelve looks of the reference chart on the composites.
 */
export const PHOTO_MAKEUP = {
  // Foundation: the mip level the even skin is read from (a blur of about six texels: freckles, blotches and moles gone, the
  // face's broad light kept), how much of the detail above it a full cover hides, and how much of its colour cast it greys
  // to the skin's own (a relative map's grey is the skin).
  blurBias: 2.5, hideDetail: 0.75, evenTone: 0.45,
  // The pale base's reach: round the face to the ears (half-width in u, counted twice), fading over its outer `paleFade`
  // share (a base is blended out towards the ears and into the hair, not stopped at the cheek's turn, where a 3/4 view
  // showed its edge), and from the hairline to under the chin, fading over `paleRowFade` rows at each end.
  paleHalfWidth: 0.27, paleFade: 0.45, paleRows: [0.14, 0.97], paleRowFade: 0.1,
  // Concealer: under each eye, from its inner corner to its middle, two eye-heights down; it lightens by this share and
  // takes this much of the colour out (the under-eye's darkness and its blue).
  underLift: 0.1, underEven: 0.2,
  // Highlight: on the cheekbones' tops, the bridge of the nose, the brow bone under the brow's tail, the cupid's bow, the
  // chin and the forehead's middle; lightens towards a warm light at this share and halves the roughness there at full.
  highlightShare: 0.6, highlightGloss: 0.55,
  // Contour: under the cheekbones from the ear towards the mouth's corner, down the nose's sides, along the jaw and at the
  // temples, the skin deepened to its contour colour at this share.
  contourShare: 0.7,
  // Blush: a sheer layer (a tint over the skin's own texture) at this share at full, built up as `blushDepth` coats (the
  // tint's ratio to the skin raised to it: one coat of a pink on a fair skin barely shows, the chart's flushes are several),
  // its ellipse this many times as wide as tall, widened by half again when swept up to the temple. The tint never
  // lightens the skin as a whole (its luminance held to 1): a pink on a deep skin is a rosy cast, not a chalky glow.
  blushShare: 1, blushDepth: 1.6, blushAspect: 1.6,
  // Eye shadow on the lid: the lid's ellipse in eye half-widths and half-heights (its centre raised by `lidRise` and
  // `reachRise` of them), and how much higher and wider `reach` and `smoke` carry it; it is solid to `lidCore` of its radius,
  // smoked to that less `smokeBlur`. (The chart's lids are coloured from the lashes to the crease, two to three eye-heights
  // up, and a full reach to the brow.)
  lidWidth: 1.3, lidHeight: 1.7, reachHeight: 3.2, lidRise: 0.4, reachRise: 1.3, smokeWidth: 0.5, lidCore: 0.55, smokeBlur: 0.3,
  // The crease colour's share: towards the outer corner, high on the lid, and under the eye, each scaled by the smoke.
  creaseOuter: 0.9, creaseHigh: 0.8, creaseLower: 0.9,
  // Shimmer: lightens the lid by this share and takes this share of the roughness off; metal (foil, glitter) takes this.
  shimmerLift: 0.12, shimmerGloss: 0.6, metalGloss: 0.85,
  // Glitter: the specks' grid on the atlas (cells round and down), the share of cells lit, the specks' brightness over the
  // foil colour, and how far out and down onto the cheek they scatter (eye half-widths and half-heights).
  glitterCells: [900, 450], glitterShare: 0.1, glitterLift: 1.5, glitterSpread: [2.6, 4],
  // Liner: its width at the rim (an almond's step) bare and at full, the wing's length out (eye half-widths) and rise (eye
  // half-heights) at a full wing, its root's width (eye half-heights).
  linerWidth: [0.12, 0.22], wingOut: 1.0, wingUp: 1.4, wingRoot: 0.32,
  // Mascara: the lash line's band just outside the upper rim, darkened by this much at full, broken into strands.
  lashDark: 0.65, lashStrands: 16,
  // Brow fill: the brow's stroke (as facecustom/skin.js draws the procedural one), darkened towards a soft brown-black.
  browDark: 0.75, browTone: [0.42, 0.38, 0.36],
  // Lips: the lip's ellipse about the lip line (half-width u, half-height rows); an overline widens it by these shares. The
  // texture's own lip found within it by its redness against the skin (red over green): a pixel this much redder is lip
  // (the composites' lips are 1.1 to 1.5, their cheeks 0.97 to 1.02); where a face's lips barely redden (a deep skin's
  // composite) the ellipse's core still takes this share (a lip colour covers the lip whatever its own redness).
  lipHalf: [0.055, 0.024], overWide: 0.1, overTall: 0.18, lipRedness: [1.02, 1.15], lipCore: 0.7,
  // A gradient lip: full from the middle to this share of the lip's ellipse, fading to its edge.
  gradientCore: 0.3,
  // Gloss takes up to this share of the lips' roughness off; matte adds up to this share.
  glossTake: 0.85, matteAdd: 0.6,
  // The base's finish over the face's skin: dewy takes up to this share of the roughness off, matte adds up to this share.
  dewyTake: 0.5, matteBase: 0.6,
  // On a shut lid (the blink, drawn in the shader): the lid's shadow at this share of the open lid's, and the liner along
  // its edge (a share of the lid's height in its width, bare and at full).
  lidShadow: 0.95, lidLine: [0.1, 0.25],
  // The crease colour's share on the shut lid, at a full smoke.
  lidCrease: 0.45,
};

/** The makeup's fragment code (the FACE_MAKEUP variant's), on the atlas: runs on `texelColor` after the skin's own detail. */
function makeupGLSL() {
  const a = PHOTO_ATLAS;
  const m = PHOTO_MAKEUP;
  const f = (value) => Number(value).toFixed(4);
  const v2 = (x, y) => `vec2(${f(x)}, ${f(y)})`;
  const eye = v2(a.eyeU * 2, a.eyeRow);
  const half = v2(a.eyeHalf[0] * 2, a.eyeHalf[1]);
  return `
{
  vec2 mkP = vec2(abs(vUv.x - 0.5) * 2.0, 1.0 - vUv.y);
  vec2 mkE = ${eye};
  vec2 mkH = ${half};
  vec2 mkQ = (mkP - mkE) / mkH;
  float mkAlmond = mkQ.x * mkQ.x + mkQ.y * mkQ.y * (1.0 + 0.8 * mkQ.x * mkQ.x);
  float mkBare = smoothstep(0.8, 1.0, mkAlmond);
  vec3 mkBase = texelColor.rgb;
  float mkRedness = texelColor.r / max(texelColor.g, 1e-3);
  // Foundation: the skin's detail smoothed to its blur, its colour cast greyed to the skin's own, off the beard's stubble.
  vec3 mkEven = mapTexelToLinear(mix(texture2D(map, vUv, ${f(m.blurBias)}), texture2D(faceMap2, vUv, ${f(m.blurBias)}), faceBlend)).rgb;
  float mkCover = faceMkBase.x * faceArea.a * (1.0 - faceArea.r * faceStubble) * mkBare;
  mkBase = mkEven + (mkBase - mkEven) * (1.0 - ${f(m.hideDetail)} * mkCover);
  mkBase = mix(mkBase, vec3(mkLum(mkBase)), ${f(m.evenTone)} * mkCover);
  // The lips' place (the pale base is kept off them; the lip colour goes on them last).
  float mkOver = faceMkLip.w;
  float mkLipD = mkEllipse(mkP, ${v2(0, a.mouthRow + 0.004)}, ${v2(m.lipHalf[0] * 2, m.lipHalf[1])} * vec2(1.0 + ${f(m.overWide)} * mkOver, 1.0 + ${f(m.overTall)} * mkOver));
  float mkLips = mkFall(0.7, 1.0, mkLipD) * mix(${f(m.lipCore)} + 0.4 * mkOver, 1.0, smoothstep(${f(m.lipRedness[0])}, ${f(m.lipRedness[1])}, mkRedness));
  // A pale base over the face's front.
  float mkFront = mkFall(${f(m.paleHalfWidth * 2 * (1 - m.paleFade))}, ${f(m.paleHalfWidth * 2)}, mkP.x) * smoothstep(${f(m.paleRows[0])}, ${f(m.paleRows[0] + m.paleRowFade)}, mkP.y) * mkFall(${f(m.paleRows[1] - m.paleRowFade)}, ${f(m.paleRows[1])}, mkP.y);
  mkBase = mix(mkBase, mkBase * faceMkPaleC / MK_NEUTRAL, faceMkBase.z * mkFront * mkBare * (1.0 - mkLips));
  // Concealer under the eyes.
  float mkUnder = mkBlob(mkP, mkE + mkH * vec2(-0.1, 2.3), mkH * vec2(1.2, 1.3)) * mkBare * faceMkBase.w;
  mkBase = mix(mkBase, mix(mkBase, vec3(mkLum(mkBase)), ${f(m.underEven)}) * ${f(1 + m.underLift)}, mkUnder);
  // Highlight and contour.
  float mkHigh = mkBlob(mkP, ${v2(0.22, 0.52)}, ${v2(0.05, 0.012)});
  mkHigh = max(mkHigh, mkBlob(mkP, ${v2(0, 0.53)}, ${v2(0.012, 0.055)}));
  mkHigh = max(mkHigh, mkBlob(mkP, mkE + ${v2(0.04, -0.03)}, ${v2(0.035, 0.006)}));
  mkHigh = max(mkHigh, mkBlob(mkP, ${v2(0, a.mouthRow - 0.026)}, ${v2(0.018, 0.004)}));
  mkHigh = max(mkHigh, mkBlob(mkP, ${v2(0, a.chinRow - 0.045)}, ${v2(0.03, 0.012)}));
  mkHigh = max(mkHigh, 0.7 * mkBlob(mkP, ${v2(0, 0.33)}, ${v2(0.05, 0.04)}));
  mkHigh *= faceMkFace.x * mkBare;
  mkBase = mix(mkBase, mkBase * faceMkHighC / MK_NEUTRAL, ${f(m.highlightShare)} * mkHigh);
  faceMkRough *= 1.0 - ${f(m.highlightGloss)} * mkHigh;
  vec2 mkS = mkSegment(mkP, ${v2(0.3, 0.52)}, ${v2(0.17, 0.6)});
  float mkShade = exp(-pow(mkS.x / 0.022, 2.0)) * (1.0 - 0.5 * mkS.y);
  mkS = mkSegment(mkP, ${v2(0.022, 0.47)}, ${v2(0.03, 0.585)});
  mkShade = max(mkShade, 0.7 * exp(-pow(mkS.x / 0.006, 2.0)));
  mkS = mkSegment(mkP, ${v2(0.3, 0.7)}, ${v2(0.14, 0.86)});
  mkShade = max(mkShade, 0.8 * exp(-pow(mkS.x / 0.025, 2.0)));
  mkShade = max(mkShade, 0.6 * mkBlob(mkP, ${v2(0.3, 0.3)}, ${v2(0.07, 0.05)}));
  mkBase = mix(mkBase, mkBase * faceMkContourC / MK_NEUTRAL, ${f(m.contourShare)} * mkShade * faceMkFace.y * mkBare);
  // Blush: an ellipse at its place, swept up towards the temple by its lift, laid sheer over the skin.
  float mkTilt = 0.5 * faceMkBlushLift;
  vec2 mkD = mkP - vec2(faceMkBlush.z * 2.0, faceMkBlush.y);
  mkD = vec2(dot(mkD, vec2(cos(mkTilt), -sin(mkTilt))), dot(mkD, vec2(sin(mkTilt), cos(mkTilt))));
  vec2 mkR = vec2(faceMkBlush.w * ${f(m.blushAspect)} * (1.0 + 0.5 * faceMkBlushLift), faceMkBlush.w);
  float mkBlush = exp(-dot(mkD / mkR, mkD / mkR)) * faceMkBlush.x * mkBare;
  vec3 mkTint = pow(faceMkBlushC / MK_NEUTRAL, vec3(${f(m.blushDepth)}));
  mkTint /= max(1.0, mkLum(mkTint));
  mkBase *= mix(vec3(1.0), mkTint, ${f(m.blushShare)} * mkBlush);
  // Eye shadow: the lid's ellipse, raised and widened by its reach and smoke; the lower lid's under the eye; the crease
  // colour on the outer corner, high up and (smoked) under the eye.
  float mkSmoke = faceMkShadow.z;
  float mkReach = faceMkShadow.y;
  float mkLid = mkFall(${f(m.lidCore)} - ${f(m.smokeBlur)} * mkSmoke, 1.0, mkEllipse(mkP, mkE + mkH * vec2(0.15 * mkSmoke, -${f(m.lidRise)} - ${f(m.reachRise)} * mkReach), mkH * vec2(${f(m.lidWidth)} + ${f(m.smokeWidth)} * mkSmoke, ${f(m.lidHeight)} + ${f(m.reachHeight)} * mkReach)));
  float mkLow = mkFall(0.45, 1.0, mkEllipse(mkP, mkE + mkH * vec2(0.15, 0.45), mkH * vec2(1.2 + 0.2 * mkSmoke, 1.0 + 0.8 * faceMkShadow.w))) * faceMkShadow.w * smoothstep(-0.4, 0.2, mkQ.y);
  float mkShadowA = max(mkLid, mkLow) * mkBare * faceMkShadow.x;
  float mkCrease = clamp(mkSmoke * (${f(m.creaseOuter)} * smoothstep(-0.5, 1.1, mkQ.x) + ${f(m.creaseHigh)} * mkFall(-2.2, -0.9, mkQ.y) + ${f(m.creaseLower)} * mkLow / max(max(mkLid, mkLow), 1e-3)), 0.0, 1.0);
  vec3 mkShadowC = mix(faceMkShadowC, faceMkCreaseC, mkCrease);
  mkBase = mkLay(mkBase, mkShadowC, mkShadowA);
  mkBase *= 1.0 + ${f(m.shimmerLift)} * faceMkShine.x * mkShadowA * (1.0 - mkCrease);
  faceMkRough *= (1.0 - ${f(m.shimmerGloss)} * faceMkShine.x * mkShadowA) * (1.0 - ${f(m.metalGloss)} * faceMkShine.y * mkShadowA);
  // Glitter: specks over the foil and scattered out and down onto the cheek.
  vec2 mkCell = vUv * ${v2(m.glitterCells[0], m.glitterCells[1])};
  float mkSpeckHash = faceHash(floor(mkCell) + 7.1);
  float mkSpeck = step(${f(1 - m.glitterShare)}, mkSpeckHash) * mkFall(0.15, 0.45, length(fract(mkCell) - 0.5));
  float mkScatter = mkFall(0.6, 1.0, mkEllipse(mkP, mkE + mkH * vec2(1.2, 3.5), mkH * ${v2(m.glitterSpread[0], m.glitterSpread[1])}));
  float mkGlitter = faceMkShine.y * mkSpeck * max(mkShadowA, 0.6 * mkScatter) * mkBare;
  mkBase = mix(mkBase, mix(faceMkShadowC, faceMkCreaseC, step(${f(1 - m.glitterShare / 2)}, mkSpeckHash)) * ${f(m.glitterLift)}, mkGlitter);
  faceMkRough *= 1.0 - 0.9 * mkGlitter;
  // Liner along the upper rim, thicker to the outer corner; its wing; the lower rim's.
  float mkRimW = ${f(m.linerWidth[0])} + ${f(m.linerWidth[1])} * faceMkLiner.x * (0.6 + 0.4 * clamp(mkQ.x, 0.0, 1.0));
  float mkLine = exp(-pow((mkAlmond - 1.0) / mkRimW, 2.0)) * mkFall(-0.1, 0.35, mkQ.y) * faceMkLiner.x;
  mkLine = max(mkLine, exp(-pow((mkAlmond - 1.0) / 0.14, 2.0)) * smoothstep(-0.05, 0.4, mkQ.y) * faceMkLiner.z);
  vec2 mkWing = mkSegment(mkP, mkE + mkH * vec2(0.92, -0.05), mkE + mkH * vec2(0.92 + ${f(m.wingOut)} * faceMkLiner.y, -0.05 - ${f(m.wingUp)} * faceMkLiner.y));
  mkLine = max(mkLine, exp(-pow(mkWing.x / (mkH.y * ${f(m.wingRoot)} * (1.0 - 0.8 * mkWing.y) + 1e-4), 2.0)) * step(0.01, faceMkLiner.y) * faceMkLiner.x * step(0.9, mkQ.x));
  mkBase = mix(mkBase, faceMkLinerC, clamp(mkLine, 0.0, 1.0) * (1.0 - 0.7 * (1.0 - mkBare)));
  // Mascara: the lash line darkened in strands just outside the upper rim.
  float mkLash = exp(-pow((mkAlmond - 1.2) / 0.35, 2.0)) * mkFall(-0.3, 0.1, mkQ.y) * (0.55 + 0.45 * step(0.45, faceHash(vec2(floor(mkQ.x * ${f(m.lashStrands)}), 3.0))));
  mkBase *= 1.0 - ${f(m.lashDark)} * faceMkFace.w * mkLash * mkBare;
  // Brow fill.
  vec2 mkBrow = mkSegment(mkP, ${v2((a.eyeU - 0.034) * 2, a.eyeRow - 0.047)}, ${v2((a.eyeU + 0.04) * 2, a.eyeRow - 0.05)});
  float mkBrowA = exp(-pow(mkBrow.x / 0.0085, 2.0)) * sqrt(sin(3.14159 * clamp(mkBrow.y * 0.9 + 0.05, 0.0, 1.0)));
  mkBase = mix(mkBase, mkBase * vec3(${m.browTone.map(f).join(', ')}), ${f(m.browDark)} * faceMkFace.z * mkBrowA);
  // Lips: the colour (stronger at the middle for a gradient lip), its gloss or matte on the roughness.
  float mkLipA = faceMkLip.x * mkLips * mix(1.0, mkFall(${f(m.gradientCore)}, 1.0, mkLipD), faceMkLip.z);
  mkBase = mkLay(mkBase, faceMkLipC, mkLipA);
  faceMkRough *= mix(1.0, faceMkLip.y > 0.0 ? 1.0 - ${f(m.glossTake)} * faceMkLip.y : 1.0 - ${f(m.matteAdd)} * faceMkLip.y, mkLips);
  // The base's finish on the face's skin.
  faceMkRough *= mix(1.0, faceMkBase.y > 0.0 ? 1.0 - ${f(m.dewyTake)} * faceMkBase.y : 1.0 - ${f(m.matteBase)} * faceMkBase.y, faceArea.a * mkBare);
  texelColor.rgb = mkBase;
}`;
}

/**
 * The shut lid's colour with makeup on it: the pale base and the lid's shadow (its crease colour mixed in as far as it is
 * smoked, as the open lid shows towards its outer corner), and the liner and lashes along its moving edge, which is the lid's
 * lower line while it comes down and the eye's lower rim once it is shut (d: the point in the lid's frame, y up).
 */
function makeupLidGLSL() {
  const m = PHOTO_MAKEUP;
  const f = (value) => Number(value).toFixed(4);
  return `
#ifdef FACE_MAKEUP
  lidPaint = mix(lidPaint, lidPaint * faceMkPaleC / MK_NEUTRAL, faceMkBase.z);
  lidPaint = mkLay(lidPaint, mix(faceMkShadowC, faceMkCreaseC, ${f(m.lidCrease)} * faceMkShadow.z), ${f(m.lidShadow)} * faceMkShadow.x);
  float lidToEdge = min(d.y - (1.0 - 2.0 * faceLid), d.y < 0.0 ? 1.0 - length(d) : 9.0);
  float lidLine = exp(-pow(lidToEdge / (${f(m.lidLine[0])} + ${f(m.lidLine[1])} * faceMkLiner.x), 2.0)) * max(faceMkLiner.x, 0.8 * faceMkFace.w);
  lidPaint = mix(lidPaint, faceMkLinerC, clamp(lidLine, 0.0, 1.0));
#endif`;
}

const PHOTO_SHADER_HEAD = `
uniform sampler2D faceMap2;
uniform sampler2D faceDetail;
uniform sampler2D faceWrinkleMap;
uniform sampler2D facePores;
uniform float faceBlend;
uniform float faceLid;
uniform float faceSeed;
uniform float faceStubble;
uniform float faceFreckles;
uniform float faceMoles;
uniform float faceRedness;
uniform float faceWrinkles;
uniform float faceFill;
uniform vec3 faceHairTint;
uniform float faceHairline;
uniform float faceTemple;
uniform float faceSideburn;
uniform float faceHairNape;
uniform float faceHairDensity;
uniform float faceCrown;
uniform float faceHairSeed;
uniform float faceBeard;
uniform float faceMustache;
float faceHash(vec2 p) { return fract(sin(dot(p, vec2(12.9898, 78.233))) * 43758.5453); }
${SCALP_GLSL}
#ifdef FACE_MAKEUP
uniform vec3 faceMkBlushC;
uniform vec3 faceMkShadowC;
uniform vec3 faceMkCreaseC;
uniform vec3 faceMkLipC;
uniform vec3 faceMkLinerC;
uniform vec3 faceMkContourC;
uniform vec3 faceMkHighC;
uniform vec3 faceMkPaleC;
uniform vec4 faceMkBase;
uniform vec4 faceMkFace;
uniform vec4 faceMkBlush;
uniform float faceMkBlushLift;
uniform vec4 faceMkShadow;
uniform vec2 faceMkShine;
uniform vec3 faceMkLiner;
uniform vec4 faceMkLip;
float mkLum(vec3 c) { return dot(c, vec3(0.2126, 0.7152, 0.0722)); }
float mkEllipse(vec2 p, vec2 c, vec2 r) { return length((p - c) / r); }
float mkBlob(vec2 p, vec2 c, vec2 r) { vec2 d = (p - c) / r; return exp(-dot(d, d)); }
vec2 mkSegment(vec2 p, vec2 a, vec2 b) { vec2 ab = b - a; float t = clamp(dot(p - a, ab) / dot(ab, ab), 0.0, 1.0); return vec2(length(p - a - ab * t), t); }
float mkFall(float near, float far, float x) { return 1.0 - smoothstep(near, far, x); }
vec3 mkLay(vec3 base, vec3 pigment, float a) {
  float shade = clamp(sqrt(mkLum(base) / MK_NEUTRAL), 0.55, 1.3);
  return mix(base, pigment * shade, clamp(a, 0.0, 1.0));
}
#endif`;

/**
 * The head's material for a face: lit (standard), the two faces' albedos blended in the shader with the fighter's detail painted
 * over them (shared masks: detail.png, wrinkles.png, pores.png; avg_shared.py), the first face's normal map with age lines and
 * pores, the shared roughness map, the body's marks and the face's shadow per vertex (photohead.js), a blink (the eyelids drawn
 * down over the eyes: `userData.lid`, 0 open to 1 shut), a fill on the face's ambient light (PHOTO_FACES.fill) and the sun's
 * light let a way through the skin (PHOTO_FACES.scatter). Its colour is the fighter's skin (over the atlas' neutral). In a crowd
 * (`painted`) its colours are per vertex instead (paintFromFace).
 */
export function photoSkinMaterial(cast, { painted = false, hair: hairColour = null, makeup = null } = {}) {
  const colour = new THREE.Color(cast.skin).multiplyScalar(1 / photoManifest.neutral);
  if (painted) {
    const material = new THREE.MeshLambertMaterial({ color: 0xffffff, vertexColors: true });
    material.userData.photoFace = cast.id;
    return material;
  }
  const material = new THREE.MeshStandardMaterial({
    color: colour,
    map: photoTexture(`${cast.primary.key}-albedo.jpg`),
    // (On the head model its own relief, baked over its lattice: tools/blender/head/grid.py. Each face's own map is the drawn head's.)
    normalMap: photoTexture(PHOTO_HEAD.model.on ? `relief-${cast.primary.sex}.png` : `${cast.primary.key}-normal.png`),
    roughnessMap: photoTexture('rough.png'),
    roughness: 1,
    metalness: 0,
    vertexColors: true,
  });
  material.normalScale.set(PHOTO_FACES.normalScale, PHOTO_FACES.normalScale);
  // (The head model's map is baked in its lattice's own tangents, which its meshes carry: headlattice.js gridTangents.)
  material.vertexTangents = PHOTO_HEAD.model.on;
  const pores = photoTexture('pores.png');
  pores.wrapT = THREE.RepeatWrapping;
  const skin = new THREE.Color(cast.skin);
  // (The painted scalp's colour: the fighter's own hair colour when the head gives one, else the photo's.)
  const hair = new THREE.Color(hairColour ?? cast.hair);
  const tint = new THREE.Vector3(...['r', 'g', 'b'].map((c) => Math.min(1, Math.max(0.12, hair[c] / Math.max(0.05, skin[c])))));
  const d = cast.detail;
  const uniforms = {
    faceMap2: { value: photoTexture(`${cast.secondary.key}-albedo.jpg`) }, faceBlend: { value: cast.blend }, faceLid: { value: 0 },
    faceDetail: { value: photoTexture('detail.png') }, faceWrinkleMap: { value: photoTexture('wrinkles.png') }, facePores: { value: pores },
    faceSeed: { value: d.seed }, faceStubble: { value: d.stubble }, faceFreckles: { value: d.freckles }, faceMoles: { value: d.moles },
    faceRedness: { value: d.redness }, faceWrinkles: { value: d.wrinkles }, faceFill: { value: PHOTO_FACES.fill }, faceHairTint: { value: tint },
    // The painted scalp and beard (photohair.js photoScalp; face.js sets them once the style is known): bald until then.
    faceHairline: { value: 0.2 }, faceTemple: { value: 0 }, faceSideburn: { value: 0.5 }, faceHairNape: { value: 0.64 }, faceHairDensity: { value: 0 },
    faceCrown: { value: 0 }, faceHairSeed: { value: 0 }, faceBeard: { value: 0 }, faceMustache: { value: 0 },
  };
  // The makeup's (setPhotoMakeup sets them, and defines FACE_MAKEUP while a look is worn).
  Object.assign(uniforms, makeupUniforms());
  const [eyeHalfU, eyeHalfV] = PHOTO_ATLAS.eyeHalf;
  const lidTone = (photoManifest.neutral * 0.92).toFixed(3);
  const normals = THREE.ShaderChunk.normal_fragment_maps.replace('vec3 mapN = texture2D( normalMap, vUv ).xyz * 2.0 - 1.0;', `vec3 mapN = texture2D( normalMap, vUv ).xyz * 2.0 - 1.0;
	vec4 faceMask = texture2D( faceDetail, vUv );
	mapN.xy += ( texture2D( faceWrinkleMap, vUv ).xy * 2.0 - 1.0 ) * faceWrinkles * 0.2;
	mapN.xy += ( texture2D( facePores, vUv * vec2( 40.0, 20.0 ) ).xy * 2.0 - 1.0 ) * 0.5 * faceMask.a;
	float scalpN = faceScalp( vUv );
	mapN.x += ( faceNoise( vec2( vUv.x * 900.0, ( 1.0 - vUv.y ) * 45.0 + faceHairSeed ) ) - 0.5 ) * 1.2 * scalpN;`);
  const lights = scatteredLights();
  material.onBeforeCompile = (shader) => {
    Object.assign(shader.uniforms, uniforms);
    shader.fragmentShader = shader.fragmentShader
      .replace('#include <map_pars_fragment>', `#include <map_pars_fragment>${PHOTO_SHADER_HEAD}`)
      .replace('#include <map_fragment>', `vec4 texelColor = mix(texture2D(map, vUv), texture2D(faceMap2, vUv), faceBlend);
#ifdef FACE_MAKEUP
float faceMkRough = 1.0;
#endif
texelColor = mapTexelToLinear(texelColor);
vec4 faceArea = texture2D(faceDetail, vUv);
// Skin grain; ruddy nose and cheeks; stubble (dots of the hair's colour over a shadow of it); freckles; moles; age lines.
texelColor.rgb *= 1.0 + (texture2D(facePores, vUv * vec2(40.0, 20.0)).b - 0.5) * 0.12 * faceArea.a;
texelColor.rgb = mix(texelColor.rgb, texelColor.rgb * vec3(1.05, 0.88, 0.88), faceArea.g * faceRedness);
float hairDot = step(0.5, faceHash(floor(vUv * vec2(1100.0, 550.0)) + faceSeed));
texelColor.rgb *= mix(vec3(1.0), faceHairTint, faceArea.r * faceStubble * (0.3 + 0.55 * hairDot));
vec2 freckleCell = vUv * vec2(560.0, 280.0);
float freckle = step(faceHash(floor(freckleCell) + faceSeed * 1.7), 0.2) * smoothstep(0.42, 0.18, length(fract(freckleCell) - 0.5));
texelColor.rgb *= 1.0 - vec3(0.12, 0.17, 0.2) * freckle * faceFreckles * faceArea.a;
vec2 moleCell = vUv * vec2(110.0, 55.0);
float mole = step(faceHash(floor(moleCell) + faceSeed * 3.3), faceMoles) * smoothstep(0.2, 0.1, length(fract(moleCell) - 0.5));
texelColor.rgb *= 1.0 - vec3(0.45, 0.5, 0.5) * mole * faceArea.a;
texelColor.rgb *= 1.0 - faceArea.b * faceWrinkles * 0.1;
#ifdef FACE_MAKEUP
${makeupGLSL()}
#endif
// The scalp's hair, painted to an irregular hairline (photohair.js), and a beard's or moustache's density under its cards.
float strandTone = faceNoise(vec2(vUv.x * 900.0, (1.0 - vUv.y) * 45.0 + faceHairSeed));
vec3 hairTone = faceHairTint * ${photoManifest.neutral.toFixed(3)} * (0.65 + 0.7 * strandTone);
texelColor.rgb = mix(texelColor.rgb, hairTone, faceScalp(vUv));
float beardCover = faceArea.r * clamp(faceBeard + faceMustache * step(1.0 - vUv.y, ${(PHOTO_ATLAS.mouthRow - 0.006).toFixed(3)}), 0.0, 1.0);
texelColor.rgb = mix(texelColor.rgb, hairTone, beardCover * (0.5 + 0.45 * step(0.45, faceHash(floor(vUv * vec2(1100.0, 550.0)) + faceSeed))));
// The eyelids: down over each eye from its top, as far as faceLid, in the skin's own neutral.
for (int side = -1; side <= 1; side += 2) {
  vec2 eye = vec2(0.5 + float(side) * ${PHOTO_ATLAS.eyeU.toFixed(4)}, ${(1 - PHOTO_ATLAS.eyeRow).toFixed(4)});
  vec2 d = (vUv - eye) / vec2(${(eyeHalfU * 1.25).toFixed(4)}, ${(eyeHalfV * 1.6).toFixed(4)});
  float shut = step(dot(d, d), 1.0) * step(1.0 - 2.0 * faceLid, d.y);
  vec3 lidPaint = vec3(${lidTone});${makeupLidGLSL()}
  texelColor.rgb = mix(texelColor.rgb, lidPaint, shut * step(0.02, faceLid));
}
diffuseColor *= texelColor;`)
      .replace('#include <roughnessmap_fragment>', `#include <roughnessmap_fragment>
#ifdef FACE_MAKEUP
roughnessFactor = clamp(roughnessFactor * faceMkRough, 0.05, 1.0);
#endif`)
      .replace('#include <normal_fragment_maps>', normals)
      .replace('#include <lights_physical_pars_fragment>', lights)
      .replace('#include <lights_fragment_begin>', `#include <lights_fragment_begin>
#if defined( RE_IndirectDiffuse )
	irradiance *= faceFill;
#endif`);
  };
  // (The scalp's hairs are filtered by their size on screen: fwidth, core in WebGL 2, an extension in WebGL 1.)
  material.extensions = { derivatives: true };
  // (The made-up variant keyed apart: FACE_MAKEUP in its defines.)
  material.customProgramCacheKey = () => (material.defines?.FACE_MAKEUP !== undefined ? 'photoface4|makeup1' : 'photoface4');
  material.userData.photoFace = cast.id;
  material.userData.lid = uniforms.faceLid;
  material.userData.fill = uniforms.faceFill;
  material.userData.scalp = uniforms;
  material.userData.faceTextures = [uniforms.faceMap2.value, uniforms.faceDetail.value, uniforms.faceWrinkleMap.value, pores];
  material.userData.makeup = uniforms;
  if (makeup) setPhotoMakeup(material, makeup);
  return material;
}

/** The makeup's uniforms, bare (nothing drawn until setPhotoMakeup). */
function makeupUniforms() {
  const vector = (size) => ({ value: size === 2 ? new THREE.Vector2() : size === 3 ? new THREE.Vector3() : new THREE.Vector4() });
  return {
    faceMkBlushC: vector(3), faceMkShadowC: vector(3), faceMkCreaseC: vector(3), faceMkLipC: vector(3), faceMkLinerC: vector(3),
    faceMkContourC: vector(3), faceMkHighC: vector(3), faceMkPaleC: vector(3),
    faceMkBase: vector(4), faceMkFace: vector(4), faceMkBlush: vector(4), faceMkBlushLift: { value: 0 }, faceMkShadow: vector(4),
    faceMkShine: vector(2), faceMkLiner: vector(3), faceMkLip: vector(4),
  };
}

/**
 * Put a makeup (facecustom/makeup.js: a look and its changes, or null for none) on a photo head's material: its colours
 * fitted to the skin the material draws now (its colour times the atlas's neutral), its numbers into the shader. A look worn
 * turns the material's shader to the made-up variant (FACE_MAKEUP: compiled once, shared); none turns it back, so a bare face
 * costs nothing it did not before. A crowd's painted material has none of this (paintFromFace paints its makeup). Returns the
 * material.
 */
export function setPhotoMakeup(material, makeup) {
  const uniforms = material?.userData?.makeup;
  if (!uniforms) return material;
  const worn = makeupWorn(makeup);
  const had = material.defines?.FACE_MAKEUP !== undefined;
  if (worn !== had) {
    material.defines = { ...(material.defines ?? {}) };
    if (worn) Object.assign(material.defines, { FACE_MAKEUP: '', MK_NEUTRAL: photoManifest.neutral.toFixed(4) });
    else {
      delete material.defines.FACE_MAKEUP;
      delete material.defines.MK_NEUTRAL;
    }
    material.needsUpdate = true;
  }
  material.userData.makeupWorn = worn ? makeup : null;
  if (!worn) return material;
  const skin = `#${material.color.clone().multiplyScalar(photoManifest.neutral).getHexString()}`;
  const { colours: c, numbers: n } = makeupValues(makeup, skin, photoManifest.neutral);
  const set = (name, values) => uniforms[name].value.fromArray(values);
  set('faceMkBlushC', c.blush);
  set('faceMkShadowC', c.shadow);
  set('faceMkCreaseC', c.crease);
  set('faceMkLipC', c.lip);
  set('faceMkLinerC', c.liner);
  set('faceMkContourC', c.contour);
  set('faceMkHighC', c.highlight);
  set('faceMkPaleC', c.paleBase);
  set('faceMkBase', [n.cover, n.finish, n.pale, n.under]);
  set('faceMkFace', [n.highlight, n.contour, n.brow, n.lashes]);
  set('faceMkBlush', [n.blush, n.blushRow, n.blushOut, n.blushSize]);
  uniforms.faceMkBlushLift.value = n.blushLift;
  set('faceMkShadow', [n.shadow, n.reach, n.smoke, n.lower]);
  set('faceMkShine', [n.shimmer, n.metal]);
  set('faceMkLiner', [n.liner, n.wing, n.linerLower]);
  set('faceMkLip', [n.lip, n.gloss, n.gradient, n.over]);
  return material;
}

/** The physical material's direct light with the sun let a way through the skin (PHOTO_FACES.scatter): its shader chunk. */
function scatteredLights() {
  const scatter = PHOTO_FACES.scatter.toFixed(3);
  return THREE.ShaderChunk.lights_physical_pars_fragment.replace('irradiance * BRDF_Diffuse_Lambert( material.diffuseColor )',
    `( PI * directLight.color * saturate( ( dot( geometry.normal, directLight.direction ) + ${scatter} ) / ( ( 1.0 + ${scatter} ) * ( 1.0 + ${scatter} ) ) ) ) * BRDF_Diffuse_Lambert( material.diffuseColor )`);
}

/**
 * The body's skin lit as the photo head is (PHOTO_FACES.scatter), so the two match across the neck: a standard material
 * patched (once; its other patches kept, run first). Returns the material.
 */
export function skinScatter(material) {
  if (!material?.isMeshStandardMaterial || material.onBeforeCompile?.skinScatter) return material;
  const previous = material.onBeforeCompile;
  const baseKey = material.customProgramCacheKey?.() ?? '';
  const patched = (shader, renderer) => {
    previous?.call(material, shader, renderer);
    shader.fragmentShader = shader.fragmentShader.replace('#include <lights_physical_pars_fragment>', scatteredLights());
  };
  patched.skinScatter = true;
  patched.previous = previous;
  material.onBeforeCompile = patched;
  // (three caches programs by onBeforeCompile's source text: keyed apart from the unpatched.)
  material.customProgramCacheKey = () => `${baseKey}|skinScatter${PHOTO_FACES.scatter}`;
  material.needsUpdate = true;
  return material;
}

/**
 * Paint a geometry's vertices from a face's thumbnails (the two blended) at their texture coordinates, times the skin and times
 * what the vertex colours already hold (the body's marks and the face's shadow): a crowd's heads. `makeup`: a look to paint
 * on it in broad strokes (none by default).
 */
export function paintFromFace(geometry, cast, makeup = null) {
  const uv = geometry.attributes.uv;
  const [width, height] = photoManifest.thumb;
  const skin = new THREE.Color(cast.skin);
  const scale = 1 / (255 * photoManifest.neutral);
  const before = geometry.attributes.color;
  const sample = (u, v) => {
    const x = Math.min(width - 1, Math.max(0, Math.floor((((u % 1) + 1) % 1) * width)));
    const y = Math.min(height - 1, Math.max(0, Math.floor((1 - v) * height)));
    return (y * width + x) * 3;
  };
  const colours = new Float32Array(uv.count * 3);
  // (Its makeup's broad strokes, the blush, lip, shadow and a pale base, on each vertex: facecustom/makeup.js makeupPaintAt.)
  const paint = makeupWorn(makeup) ? makeupValues(makeup, cast.skin, photoManifest.neutral) : null;
  for (let index = 0; index < uv.count; index += 1) {
    const a = sample(uv.getX(index), uv.getY(index));
    for (let channel = 0; channel < 3; channel += 1) {
      const value = cast.primary.thumb[a + channel] * (1 - cast.blend) + cast.secondary.thumb[a + channel] * cast.blend;
      const mark = before ? before.array[index * 3 + channel] : 1;
      colours[index * 3 + channel] = Math.min(1, value * scale * [skin.r, skin.g, skin.b][channel] * mark);
    }
    if (paint) colours.set(makeupPaintAt(Array.from(colours.subarray(index * 3, index * 3 + 3)), uv.getX(index), uv.getY(index), paint, cast.skin, PHOTO_ATLAS, photoManifest.neutral), index * 3);
  }
  geometry.setAttribute('color', new THREE.BufferAttribute(colours, 3));
}

/** Let go of the maps no head in `root` (the scene) wears any more: a fight's faces are freed when the next one is built. */
export function releaseUnusedPhotoFaces(root) {
  const used = new Set();
  root.traverse((object) => {
    const material = object.material;
    if (!material?.userData?.photoFace) return;
    for (const texture of [material.map, material.normalMap, material.roughnessMap, ...(material.userData.faceTextures ?? [])]) if (texture) used.add(texture);
  });
  for (const [file, entry] of photoTextures) {
    if (used.has(entry.texture)) continue;
    entry.texture.dispose();
    photoTextures.delete(file);
  }
}

/** Set the faces' fill (PHOTO_FACES.fill) for the next heads and for those under `root` now. */
export function setPhotoFill(value, root = null) {
  PHOTO_FACES.fill = value;
  root?.traverse((object) => {
    if (object.material?.userData?.fill) object.material.userData.fill.value = value;
  });
  return value;
}
