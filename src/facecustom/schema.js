// The face customiser's parameters: what a made face is, as plain data (no three.js, so it runs in Node, a worker or a save
// file's reader). A face is a preset (an ancestral group: which of the game's photo-face regions its maps and its head's base
// shape come from), a sex, a slider for each feature and a few for the skin's surface. Every slider runs 0..255 with 128 its
// neutral (the user's call, 2026-11-28): the whole range is used, so the ends distort well past what a real face does;
// nothing here clamps a slider to a realistic band. The solver (solver.js) turns the sliders into a shape, the skin pipeline
// (skin.js) into maps and a material.
//
// A face may wear makeup (`face.makeup`: makeup.js, a look and its changed parts; none unless chosen).
//
// A fighter carries one as `look.faceCustom` (face.js buildHead, photoface.js photoFaceFor). A fighter without one is cast
// and drawn exactly as before.

import { regionShape } from '../faceregions.js';
import { noMakeup, normalizeMakeup } from './makeup.js';

/** The saved form's version: raised when a slider's meaning changes (normalizeFace reads older ones as far as it can). */
export const FACE_SCHEMA_VERSION = 1;

/** A slider's range and its neutral (the user's call, 2026-11-28: 0..255, 128 no change). */
export const FACE_SLIDER_RANGE = { min: 0, max: 255, neutral: 128 };

const faceSliderEntry = (id, group, label, labelZh, kind = 'shape') => ({ id, group, label, labelZh, neutral: FACE_SLIDER_RANGE.neutral, kind });

/**
 * The sliders, in the order they are shown. `group`: general, browEyes, nose, cheeksMouth, jawChin, surface. `kind`:
 * 'preset' (the ethnicity slider: its value picks a preset, presetForSlider; a picker may be shown for it instead), 'macro'
 * (age, the masculine-feminine balance, the emphasis: each drives many features at once, solver.js FACE_MACROS), 'shape' (one
 * feature) or 'surface' (the skin's: kept in `face.surface`, not `face.sliders`).
 */
export const FACE_SLIDERS = [
  faceSliderEntry('ethnicity', 'general', 'Ethnicity Preset', '族裔预设', 'preset'),
  faceSliderEntry('age', 'general', 'Apparent Age', '外貌年龄', 'macro'),
  faceSliderEntry('gender', 'general', 'Masculine-Feminine Balance', '阳刚-阴柔', 'macro'),
  faceSliderEntry('emphasis', 'general', 'Feature Emphasis', '五官强调', 'macro'),
  faceSliderEntry('browHeight', 'browEyes', 'Brow Height', '眉高'),
  faceSliderEntry('browInner', 'browEyes', 'Inner Brow', '眉头'),
  faceSliderEntry('browOuter', 'browEyes', 'Outer Brow', '眉尾'),
  faceSliderEntry('eyePosition', 'browEyes', 'Eye Position', '眼位'),
  faceSliderEntry('eyeSize', 'browEyes', 'Eye Size', '眼睛大小'),
  faceSliderEntry('eyeSlant', 'browEyes', 'Eye Slant', '眼角倾斜'),
  faceSliderEntry('eyeSpacing', 'browEyes', 'Eye Spacing', '眼距'),
  faceSliderEntry('bridgeDepth', 'nose', 'Bridge Depth', '鼻梁高低'),
  faceSliderEntry('bridgeLength', 'nose', 'Bridge Length', '鼻梁长度'),
  faceSliderEntry('nosePosition', 'nose', 'Nose Position', '鼻位'),
  faceSliderEntry('noseHeight', 'nose', 'Nose Height', '鼻长'),
  faceSliderEntry('noseProtrusion', 'nose', 'Nose Protrusion', '鼻尖前突'),
  faceSliderEntry('noseSlant', 'nose', 'Nose Slant', '鼻尖倾斜'),
  faceSliderEntry('nostrilWidth', 'nose', 'Nostril Width', '鼻翼宽度'),
  faceSliderEntry('nostrilSize', 'nose', 'Nostril Size', '鼻孔大小'),
  faceSliderEntry('nostrilSlant', 'nose', 'Nostril Slant', '鼻翼倾斜'),
  faceSliderEntry('cheekHeight', 'cheeksMouth', 'Cheekbone Height', '颧骨高度'),
  faceSliderEntry('cheekDepth', 'cheeksMouth', 'Cheekbone Depth', '颧骨突出'),
  faceSliderEntry('cheekWidth', 'cheeksMouth', 'Cheekbone Width', '颧骨宽度'),
  faceSliderEntry('mouthPosition', 'cheeksMouth', 'Mouth Position', '嘴位'),
  faceSliderEntry('mouthWidth', 'cheeksMouth', 'Mouth Width', '嘴宽'),
  faceSliderEntry('mouthProtrusion', 'cheeksMouth', 'Mouth Protrusion', '嘴部前突'),
  faceSliderEntry('mouthSlant', 'cheeksMouth', 'Mouth Slant', '嘴角倾斜'),
  faceSliderEntry('lipThickness', 'cheeksMouth', 'Lip Thickness', '唇厚'),
  faceSliderEntry('lipFullness', 'cheeksMouth', 'Lip Fullness', '唇丰满度'),
  faceSliderEntry('lipSize', 'cheeksMouth', 'Lip Size', '唇大小'),
  faceSliderEntry('jawWidth', 'jawChin', 'Jaw Width', '下颌宽度'),
  faceSliderEntry('jawProtrusion', 'jawChin', 'Jaw Protrusion', '下颌前突'),
  faceSliderEntry('jawContour', 'jawChin', 'Jaw Contour', '下颌轮廓'),
  faceSliderEntry('chinLength', 'jawChin', 'Chin Length', '下巴长度'),
  faceSliderEntry('chinHeight', 'jawChin', 'Chin Height', '下巴高度'),
  faceSliderEntry('chinWidth', 'jawChin', 'Chin Width', '下巴宽度'),
  faceSliderEntry('chinProtrusion', 'jawChin', 'Chin Protrusion', '下巴前突'),
  faceSliderEntry('chinDepth', 'jawChin', 'Chin Depth', '颏唇沟深度'),
  faceSliderEntry('normalStrength', 'surface', 'Facial Normal Map Strength', '面部法线强度', 'surface'),
  faceSliderEntry('normalBlend', 'surface', 'Facial Normal Map Blending', '面部法线混合', 'surface'),
  faceSliderEntry('skinTone', 'surface', 'Skin Tone', '肤色', 'surface'),
  faceSliderEntry('roughness', 'surface', 'Skin Roughness', '皮肤粗糙度', 'surface'),
  faceSliderEntry('luster', 'surface', 'Luster', '光泽', 'surface'),
];

/** The sliders kept in `face.sliders` (all but the surface's), and those kept in `face.surface`. */
export const FACE_SHAPE_IDS = FACE_SLIDERS.filter((entry) => entry.kind !== 'surface').map((entry) => entry.id);
export const FACE_SURFACE_IDS = FACE_SLIDERS.filter((entry) => entry.kind === 'surface').map((entry) => entry.id);

// How a region's shape tendencies (faceregions.js SHAPE_GROUPS: -1..1 about the middle of all the regions) read as slider
// offsets, a preset's baseline. Slider units per unit of the key: 30 puts the strongest published tendency (a key near 0.9)
// a little over a tenth of the range from neutral, a tendency and not a type, as faceregions.js has them.
const FACE_BASELINE_PER_KEY = {
  bridgeDepth: { noseBridge: 30, lidFold: -6 },
  nostrilWidth: { noseWidth: 30 },
  browHeight: { brow: -8 },
  eyeSize: { lidFold: -8, socket: 6 },
  eyeSlant: { lidFold: 10 },
  cheekDepth: { cheekbone: 26 },
  cheekWidth: { cheekWidth: 26 },
  lipFullness: { lips: 30 },
  lipThickness: { lips: 16 },
  jawWidth: { jaw: 26 },
  chinProtrusion: { chin: 24 },
  chinLength: { faceLength: 14 },
  noseHeight: { faceLength: 8 },
};

const faceClampSlider = (value) => Math.min(FACE_SLIDER_RANGE.max, Math.max(FACE_SLIDER_RANGE.min, Math.round(Number.isFinite(Number(value)) ? Number(value) : FACE_SLIDER_RANGE.neutral)));

/** A preset's baseline sliders from its first region's shape (only those off neutral are listed). */
function faceBaselineOf(region) {
  const shape = regionShape(region);
  const sliders = {};
  for (const [id, keys] of Object.entries(FACE_BASELINE_PER_KEY)) {
    const offset = Object.entries(keys).reduce((sum, [key, per]) => sum + per * (shape[key] ?? 0), 0);
    if (Math.round(offset) !== 0) sliders[id] = faceClampSlider(FACE_SLIDER_RANGE.neutral + offset);
  }
  return sliders;
}

const FACE_NEUTRAL_SURFACE = Object.fromEntries(FACE_SURFACE_IDS.map((id) => [id, FACE_SLIDER_RANGE.neutral]));
const facePresetEntry = (label, labelZh, regions) => ({ label, labelZh, regions, sliders: faceBaselineOf(regions[0]), surface: { ...FACE_NEUTRAL_SURFACE } });

/**
 * The presets: an ancestral group each, named by where its people are from. `regions`: the photo-face regions
 * (faceregions.js REGION_PLACES) its maps are taken from, the first the face's own, the second blended into it (photoface.js
 * customPhotoCast); the head's base shape is those regions' (headlattice.js). `sliders`: the baseline the preset loads (the
 * same tendencies as slider offsets, for a head with no base shape of its own: fallbackhead.js). `surface`: the surface
 * sliders it loads. In the order of the ethnicity slider's bands, west to east and north to south.
 */
export const ETHNICITY_PRESETS = {
  northEuropean: facePresetEntry('Northern European', '北欧', ['england', 'sweden', 'netherlands']),
  centralEuropean: facePresetEntry('Central & Eastern European', '中东欧', ['germany', 'poland', 'russia']),
  mediterranean: facePresetEntry('Mediterranean', '地中海', ['italy', 'greece', 'spain']),
  westAsian: facePresetEntry('West Asian', '西亚', ['turkey', 'iran', 'lebanon']),
  southAsian: facePresetEntry('South Asian', '南亚', ['india', 'southIndia']),
  centralAsian: facePresetEntry('Central Asian', '中亚', ['uzbekistan', 'tibet', 'mongolia']),
  eastAsian: facePresetEntry('East Asian', '东亚', ['china', 'korea', 'japan']),
  southeastAsian: facePresetEntry('Southeast Asian', '东南亚', ['vietnam', 'thailand', 'philippines']),
  pacific: facePresetEntry('Pacific Islander', '太平洋岛民', ['samoa', 'philippines']),
  eastAfrican: facePresetEntry('East African', '东非', ['ethiopia', 'chadCameroon']),
  westAfrican: facePresetEntry('West & Southern African', '西非与南非', ['westAfrica', 'southAfrica', 'chadCameroon']),
  indigenousAmerican: facePresetEntry('Indigenous American', '美洲原住民', ['peru', 'mexico']),
  latinAmerican: facePresetEntry('Caribbean & Brazilian', '加勒比与巴西', ['brazil', 'puertoRico']),
};

/** The presets' ids in the ethnicity slider's order, and the one a face has when none is named. */
export const FACE_PRESET_ORDER = Object.keys(ETHNICITY_PRESETS);
export const FACE_DEFAULT_PRESET = 'mediterranean';

/** The preset a value of the ethnicity slider picks: the range cut into equal bands, one a preset. */
export function presetForSlider(value) {
  const share = faceClampSlider(value) / (FACE_SLIDER_RANGE.max + 1);
  return FACE_PRESET_ORDER[Math.min(FACE_PRESET_ORDER.length - 1, Math.floor(share * FACE_PRESET_ORDER.length))];
}

/** The ethnicity slider's value for a preset: the middle of its band. */
export function sliderForPreset(presetId) {
  const index = Math.max(0, FACE_PRESET_ORDER.indexOf(presetId));
  return Math.round(((index + 0.5) / FACE_PRESET_ORDER.length) * (FACE_SLIDER_RANGE.max + 1));
}

const faceSexOf = (sex) => (sex === 'female' ? 'female' : 'male');
const facePresetOf = (presetId) => (ETHNICITY_PRESETS[presetId] ? presetId : FACE_DEFAULT_PRESET);

/** A preset's own face for a sex: its baseline sliders, every other at neutral, its surface. */
export function defaultFace(presetId = FACE_DEFAULT_PRESET, sex = 'male') {
  const id = facePresetOf(presetId);
  const sliders = Object.fromEntries(FACE_SHAPE_IDS.map((name) => [name, FACE_SLIDER_RANGE.neutral]));
  Object.assign(sliders, ETHNICITY_PRESETS[id].sliders, { ethnicity: sliderForPreset(id) });
  return { version: FACE_SCHEMA_VERSION, preset: id, sex: faceSexOf(sex), sliders, surface: { ...ETHNICITY_PRESETS[id].surface }, makeup: noMakeup() };
}

/**
 * A clean face from whatever was saved or handed in: every slider present, whole and within 0..255, the preset one there is
 * (a named preset wins over the ethnicity slider; with neither, the default), its makeup clean (none if it has none),
 * unknown fields dropped. A slider missing is its preset's baseline, so a face saved before a slider was added keeps its
 * look.
 */
export function normalizeFace(json) {
  const source = json && typeof json === 'object' ? json : {};
  const given = source.sliders && typeof source.sliders === 'object' ? source.sliders : {};
  const id = ETHNICITY_PRESETS[source.preset] ? source.preset : given.ethnicity !== undefined ? presetForSlider(given.ethnicity) : FACE_DEFAULT_PRESET;
  const face = defaultFace(id, source.sex);
  for (const name of FACE_SHAPE_IDS) if (name !== 'ethnicity' && given[name] !== undefined) face.sliders[name] = faceClampSlider(given[name]);
  const surface = source.surface && typeof source.surface === 'object' ? source.surface : {};
  for (const name of FACE_SURFACE_IDS) if (surface[name] !== undefined) face.surface[name] = faceClampSlider(surface[name]);
  // Its makeup (makeup.js): a face saved before makeup was added, or with none, wears none.
  face.makeup = normalizeMakeup(source.makeup);
  return face;
}

/** A slider's value on a face, wherever it is kept (`face.sliders` or `face.surface`). */
export function getSlider(face, id) {
  return FACE_SURFACE_IDS.includes(id) ? face.surface[id] : face.sliders[id];
}

/**
 * A face with one slider set (a new face; the one given is left as it was). The ethnicity slider loads its preset: the
 * baseline sliders and the surface, the sex and the makeup kept.
 */
export function setSlider(face, id, value) {
  const clean = normalizeFace(face);
  if (id === 'ethnicity') return { ...defaultFace(presetForSlider(value), clean.sex), makeup: clean.makeup };
  if (FACE_SURFACE_IDS.includes(id)) clean.surface[id] = faceClampSlider(value);
  else if (FACE_SHAPE_IDS.includes(id)) clean.sliders[id] = faceClampSlider(value);
  return clean;
}

/** A slider's departure from neutral as a share: -1 at 0, 0 at 128, +1 at 255 (a hair under: 127 steps up, 128 down). */
export const sliderOffset = (value) => (value - FACE_SLIDER_RANGE.neutral) / (FACE_SLIDER_RANGE.neutral - FACE_SLIDER_RANGE.min);

// How far a random face strays from its preset, in slider steps (the most any one slider moves): 40 keeps a rolled face a
// believable person of its group (the solver's features move about a third of their full throw); the macros move less, or
// every roll would be an old man or a caricature.
const FACE_RANDOM = { spread: 40, macro: 18, surface: 14 };

/** A draw in -1..1, likelier near 0 (two uniform draws' difference: a triangle), from `rng` (0..1). */
const faceTriangleDraw = (rng) => rng() - rng();

/**
 * A random face: a preset and a sex (`opts.preset`, `opts.sex`, else drawn), its sliders faceStrayed from the preset's baseline by
 * up to `opts.spread` steps (the macros and the surface by less). `rng`: a function giving 0..1 (Math.random's shape).
 */
export function randomFace(rng = Math.random, opts = {}) {
  const id = ETHNICITY_PRESETS[opts.preset] ? opts.preset : FACE_PRESET_ORDER[Math.min(FACE_PRESET_ORDER.length - 1, Math.floor(rng() * FACE_PRESET_ORDER.length))];
  const sex = opts.sex ? faceSexOf(opts.sex) : rng() < 0.5 ? 'female' : 'male';
  const spread = opts.spread ?? FACE_RANDOM.spread;
  return faceStrayed(defaultFace(id, sex), { shape: spread, macro: Math.min(spread, opts.macro ?? FACE_RANDOM.macro), surface: Math.min(spread, opts.surface ?? FACE_RANDOM.surface) }, rng);
}

/** A face with every slider moved by up to its kind's reach (steps), from `rng`. */
function faceStrayed(face, reach, rng) {
  const out = normalizeFace(face);
  for (const entry of FACE_SLIDERS) {
    if (entry.kind === 'preset') continue;
    const most = reach[entry.kind] ?? 0;
    const moved = faceClampSlider(getSlider(out, entry.id) + faceTriangleDraw(rng) * most);
    if (entry.kind === 'surface') out.surface[entry.id] = moved;
    else out.sliders[entry.id] = moved;
  }
  return out;
}

/**
 * `n` faces near `face` (a grid of variations to pick from): the same preset and sex, no slider further than `spread` steps
 * from the given face's.
 */
export function similarFaces(face, n = 9, spread = 12, rng = Math.random) {
  const reach = { shape: spread, macro: spread, surface: spread };
  return Array.from({ length: n }, () => faceStrayed(face, reach, rng));
}

/** A face as text, and back (a clean face whatever the text held; the default face for text that is not JSON). */
export const faceToJSON = (face) => JSON.stringify(normalizeFace(face));
export function faceFromJSON(text) {
  try {
    return normalizeFace(JSON.parse(text));
  } catch {
    return defaultFace();
  }
}

/** A key for a face's shape (its preset, sex and shape sliders): two faces alike in it have the same head. */
export const faceShapeKey = (face) => `${face.preset}|${face.sex}|${FACE_SHAPE_IDS.map((id) => face.sliders[id]).join(',')}`;

// The skin's surface sliders as the numbers the shader takes. Each is its stock value at 128 and runs well past a real skin's
// at the ends (the user's call, 2026-11-28: the range is not clamped to the realistic).
export const FACE_SURFACE = {
  // The relief's strength: the square of the slider's share of neutral, none at 0, the map's own at 128, four times at 255.
  normalPower: 2,
  // The skin's brightness: halved or doubled for each `toneStops`-th of the range from neutral (255 is 1.5 stops darker, 0
  // 1.5 lighter, short of white: the lightest channel is held at 1).
  toneStops: 1.5,
  // Roughness: a share of the map's own, none (wet) at 0, twice at 255 (the shader holds it at 1).
  // Luster: the skin's specular reflectance over its stock 4 %, squared as the relief is: none at 0, sixteen percent at 255.
  lusterPower: 2,
};

/** The surface sliders as shader numbers: { strength, blend (-1..1), tone (brightness factor), roughness, luster }. */
export function surfaceValues(surface) {
  const share = (id) => (surface?.[id] ?? FACE_SLIDER_RANGE.neutral) / FACE_SLIDER_RANGE.neutral;
  return {
    strength: share('normalStrength') ** FACE_SURFACE.normalPower,
    blend: sliderOffset(surface?.normalBlend ?? FACE_SLIDER_RANGE.neutral),
    tone: 2 ** (-FACE_SURFACE.toneStops * sliderOffset(surface?.skinTone ?? FACE_SLIDER_RANGE.neutral)),
    roughness: share('roughness'),
    luster: share('luster') ** FACE_SURFACE.lusterPower,
  };
}

/** A skin colour ([r, g, b], 0..1) made lighter or darker by a tone factor, its hue kept, no channel past 1. */
export function tonedSkin(rgb, tone) {
  const scale = Math.min(tone, 1 / Math.max(rgb[0], rgb[1], rgb[2], 1e-6));
  return rgb.map((value) => value * scale);
}
