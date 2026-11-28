// The face customiser's skin: a made face's maps and material.
//
// The maps are the game's own photo faces (photoface.js): a preset names the regions whose average-face composites it is
// drawn from (schema.js ETHNICITY_PRESETS; photoface.js customPhotoCast makes the cast), and the head wears their albedo and
// the head model's relief map as every fighter's does. Where they are not to hand (no assets beside the page, the manifest
// not loaded), a set is made here from nothing (proceduralSkinMaps: pores, the brow's ridge, the folds from the nose to the
// mouth's corners, the forehead's and the eyes' creases, lips, brows and eyes), on the same atlas, so nothing outside is
// needed.
//
// The relief is fitted to the sculpted head, not laid over it as it was baked:
//   the tangent frames are worked out again on the sculpted points (headlattice.js gridTangents, run after the sculptor), so
//   the map's "round" and "up" follow the skin where a feature was turned or drawn out;
//   each point carries how far its skin was stretched round and down the head (solver.js gridStretch, the `faceStretch`
//   attribute), and the map's slopes are divided by it: a fold's depth stays what it was while its width follows the skin,
//   so its slope falls where the skin is drawn out and rises where it is crowded. Skin stretched over a long chin goes
//   smooth; skin crowded under a low brow creases.
// Over that, the surface sliders: the relief's strength, its blend (the region's bare relief, the region's with the
// shader's own pores and age lines, or the procedural folds), the skin's tone, its roughness and its luster (how much
// light its surface throws back).

/* global THREE */
import { ETHNICITY_PRESETS, normalizeFace, sliderOffset, surfaceValues } from './schema.js';
import { registerFaceSkin } from './solver.js';
import { PHOTO_ATLAS, photoSkinMaterial } from '../photoface.js';
import { regionTone } from '../faceregions.js';
import { SKIN_TONES } from '../skintones.js';

export const FACE_SKIN = {
  // The procedural maps' size (texels round, texels top to bottom): the photo atlas's own.
  size: [512, 256],
  // What the procedural albedo's skin is stored as (a share of white; the material's colour makes it up, as the photo
  // atlases' `neutral` is): the atlases' own, so one material colour serves both.
  neutral: 0.45,
  // The relief's heights, in texels of slope at their steepest (a normal map's x and y are slopes): pores a grain, a fold
  // a clear line.
  pores: 0.22,
  fold: 0.9,
  ridge: 0.5,
  // A stretch is not let flatten or deepen the relief past this many times (the mesh's cells are too few to tell a real
  // crease from a long triangle beyond it).
  stretchMost: 3,
  // Age lines: the photo shader's `faceWrinkles` from the age slider, none at neutral and below, full at 255; never less
  // than the fighter's own years give him.
  wrinklesFrom: 0,
};

const skinHash = (x, y, seed) => {
  const value = Math.sin(x * 127.1 + y * 311.7 + seed * 74.7) * 43758.5453;
  return value - Math.floor(value);
};
const skinBump = (dx, dy, sx, sy) => Math.exp(-((dx / sx) ** 2 + (dy / sy) ** 2));
/** How near the point (du, row) is to the stroke from a to b ([du, row] each), as a bump `width` wide (atlas rows; du counts twice). */
function skinStroke(du, row, a, b, width) {
  const [px, py, ax, ay, bx, by] = [du * 2, row, a[0] * 2, a[1], b[0] * 2, b[1]];
  const along = Math.min(1, Math.max(0, ((px - ax) * (bx - ax) + (py - ay) * (by - ay)) / ((bx - ax) ** 2 + (by - ay) ** 2)));
  const miss = Math.hypot(px - ax - (bx - ax) * along, py - ay - (by - ay) * along);
  // (Fading at its two ends, so a fold runs out and does not stop.)
  return Math.exp(-((miss / width) ** 2)) * Math.sin(Math.PI * Math.min(1, Math.max(0, along * 0.9 + 0.05))) ** 0.5;
}

/**
 * The skin's height (arbitrary units, about -1..1) and its paint at an atlas place (`du` from the face's middle, `row` down
 * from the crown): { height, dark (0..1 shadow in a crease), lip, brow, eye: 'white' | 'iris' | 'pupil' | null }.
 */
function skinRelief(du, row, seed) {
  const a = PHOTO_ATLAS;
  const side = Math.abs(du);
  const face = skinBump(du, row - 0.58, 0.2, 0.36);
  let height = 0;
  let dark = 0;
  // The brow's ridge over each eye, and the hollow of the socket under it.
  height += FACE_SKIN.ridge * skinBump(side - a.eyeU, row - (a.eyeRow - 0.05), 0.05, 0.022);
  height -= 0.4 * FACE_SKIN.ridge * skinBump(side - a.eyeU, row - a.eyeRow, 0.035, 0.02);
  // The folds from the nose's wings down past the mouth's corners; the fold under the lower lip; the lids' creases.
  const nasolabial = skinStroke(side, row, [0.034, 0.595], [0.062, a.mouthRow + 0.035], 0.0075);
  const chinFold = skinStroke(du, row, [-0.03, 0.772], [0.03, 0.772], 0.007);
  const lidCrease = skinStroke(side, row, [a.eyeU - 0.026, a.eyeRow - 0.02], [a.eyeU + 0.03, a.eyeRow - 0.017], 0.004);
  const underEye = skinStroke(side, row, [a.eyeU - 0.024, a.eyeRow + 0.026], [a.eyeU + 0.03, a.eyeRow + 0.03], 0.005);
  // Three creases across the forehead and the crow's feet at the eyes' outer corners.
  let creases = 0;
  for (const at of [0.27, 0.3, 0.33]) creases += skinStroke(du, row + 0.004 * Math.sin(du * 90 + at * 40), [-0.1, at], [0.1, at], 0.0035);
  for (const fan of [-0.6, 0, 0.6]) creases += 0.7 * skinStroke(side, row, [a.eyeU + 0.034, a.eyeRow + 0.004 * fan], [a.eyeU + 0.062, a.eyeRow + 0.022 * fan], 0.003);
  const folds = nasolabial + 0.8 * chinFold + 0.6 * lidCrease + 0.5 * underEye + 0.6 * creases;
  height -= FACE_SKIN.fold * folds;
  dark += 0.35 * Math.min(1, folds);
  // The lips: a pad each, the line between them, fine lines down them.
  const lipArea = skinBump(du, row - a.mouthRow, 0.05, 0.03);
  const upper = skinBump(du, row - (a.mouthRow - 0.014), 0.042, 0.011);
  const lower = skinBump(du, row - (a.mouthRow + 0.017), 0.038, 0.013);
  const lip = Math.min(1, upper + lower) * (1 - skinBump(side - 0.055, row - a.mouthRow, 0.012, 0.03));
  height += 0.35 * lip - 0.7 * skinStroke(du, row, [-0.05, a.mouthRow], [0.05, a.mouthRow], 0.0035) * lipArea;
  height += 0.08 * lip * Math.sin(du * 2600);
  dark += 0.5 * skinStroke(du, row, [-0.048, a.mouthRow], [0.048, a.mouthRow], 0.003);
  // The nostrils' shadow.
  dark += 0.6 * skinBump(side - 0.016, row - 0.607, 0.009, 0.006);
  // Pores: a grain over the face's skin, coarser on the nose and cheeks.
  height += FACE_SKIN.pores * (skinHash(Math.floor(du * 900), Math.floor(row * 450), seed) - 0.5) * face;
  // The brows (hair) and the eyes (white, iris, pupil), for the albedo.
  const brow = skinStroke(side, row, [a.eyeU - 0.034, a.eyeRow - 0.047], [a.eyeU + 0.04, a.eyeRow - 0.05], 0.0075);
  const [ex, ey] = [(side - a.eyeU) / a.eyeHalf[0], (row - a.eyeRow) / a.eyeHalf[1]];
  const almond = ex * ex + ey * ey * (1 + 0.8 * ex * ex);
  let eye = null;
  if (almond < 1) {
    const round = Math.hypot((side - a.eyeU) / 0.5, row - a.eyeRow);
    eye = round < 0.0055 ? 'pupil' : round < 0.0125 ? 'iris' : 'white';
  }
  return { height, dark: Math.min(1, dark), lip, brow, eye, lash: Math.exp(-(((almond - 1) / 0.25) ** 2)) * (ey < 0 ? 1 : 0.4) };
}

/**
 * The procedural maps, as bytes (no three.js: a tool or a test may make them): { width, height, normal, albedo }, RGBA
 * rows from the bottom (v 0) up, on the photo atlas (u 0.5 the face's middle, v 1 the crown). The normal map is in the
 * head's tangent frame (red round the head, green up it), the albedo relative to the skin (FACE_SKIN.neutral is the skin's
 * own colour; the material's colour makes it up). `seed`: the pores'.
 */
export function proceduralSkinMaps({ width = FACE_SKIN.size[0], height = FACE_SKIN.size[1], seed = 1 } = {}) {
  const heights = new Float32Array(width * height);
  const albedo = new Uint8Array(width * height * 4);
  const neutral = FACE_SKIN.neutral * 255;
  for (let y = 0; y < height; y += 1) {
    const row = 1 - (y + 0.5) / height;
    for (let x = 0; x < width; x += 1) {
      const du = (x + 0.5) / width - 0.5;
      const skin = skinRelief(du, row, seed);
      heights[y * width + x] = skin.height;
      // The skin, darker in its creases; lips redder; the brows and lashes dark; the eye's white, iris and pupil.
      let rgb = [1 - 0.5 * skin.dark, 1 - 0.6 * skin.dark, 1 - 0.6 * skin.dark];
      rgb = rgb.map((value, channel) => value * (1 + skin.lip * [0.02, -0.3, -0.26][channel]));
      rgb = rgb.map((value) => value * (1 - 0.72 * Math.min(1, skin.brow)));
      if (skin.eye) rgb = skin.eye === 'white' ? [1.75, 1.85, 1.9] : skin.eye === 'iris' ? [0.42, 0.3, 0.22] : [0.08, 0.07, 0.07];
      rgb = rgb.map((value) => value * (1 - 0.6 * Math.min(1, skin.lash) * (skin.eye ? 0.5 : 1)));
      for (let channel = 0; channel < 3; channel += 1) albedo[(y * width + x) * 4 + channel] = Math.min(255, Math.round(rgb[channel] * neutral));
      albedo[(y * width + x) * 4 + 3] = 255;
    }
  }
  // The normal map: the height's slopes round (u) and up (v), a texel's step each.
  const normal = new Uint8Array(width * height * 4);
  const at = (x, y) => heights[Math.min(height - 1, Math.max(0, y)) * width + ((x + width) % width)];
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const dx = (at(x + 1, y) - at(x - 1, y)) * 0.5;
      const dy = (at(x, y + 1) - at(x, y - 1)) * 0.5;
      const length = Math.hypot(dx, dy, 1);
      const offset = (y * width + x) * 4;
      normal[offset] = Math.round((0.5 - (0.5 * dx) / length) * 255);
      normal[offset + 1] = Math.round((0.5 - (0.5 * dy) / length) * 255);
      normal[offset + 2] = Math.round((0.5 + 0.5 / length) * 255);
      normal[offset + 3] = 255;
    }
  }
  return { width, height, normal, albedo };
}

const faceSkinTextures = new Map();
/** The procedural maps as textures (made once a seed, shared by every head that wears them): { normal, albedo }. */
export function proceduralSkinTextures(seed = 1) {
  if (faceSkinTextures.has(seed)) return faceSkinTextures.get(seed);
  const maps = proceduralSkinMaps({ seed });
  const texture = (data) => {
    const made = new THREE.DataTexture(data, maps.width, maps.height, THREE.RGBAFormat, THREE.UnsignedByteType);
    made.wrapS = THREE.RepeatWrapping;
    made.magFilter = THREE.LinearFilter;
    made.minFilter = THREE.LinearMipmapLinearFilter;
    made.generateMipmaps = true;
    made.anisotropy = 4;
    made.needsUpdate = true;
    return made;
  };
  const textures = { normal: texture(maps.normal), albedo: texture(maps.albedo) };
  faceSkinTextures.set(seed, textures);
  return textures;
}

/** A head's material from the procedural maps alone: the preset's region's skin tone (skintones.js) over them. */
function proceduralSkinMaterial(face) {
  const textures = proceduralSkinTextures();
  const tone = new THREE.Color(SKIN_TONES[regionTone(ETHNICITY_PRESETS[face.preset].regions[0])] ?? SKIN_TONES.medium);
  const material = new THREE.MeshStandardMaterial({ color: tone.multiplyScalar(1 / FACE_SKIN.neutral), map: textures.albedo, normalMap: textures.normal, roughness: 0.62, metalness: 0, vertexColors: true });
  // (The maps are in the lattice's own tangents, which the head's mesh carries: headlattice.js gridTangents.)
  material.vertexTangents = true;
  material.userData.faceProcedural = true;
  return material;
}

/**
 * Fit a head's material to a made face (once): the relief blended with the procedural folds and scaled by the strength and
 * by the skin's stretch (the mesh's `faceStretch`; a mesh without it, an ear, is unstretched), the luster on its specular
 * reflectance. The material's other patches are kept and run first. Its numbers are `userData.faceSkin`, set by updateSkin.
 */
function adaptSkinMaterial(material) {
  if (!material.isMeshStandardMaterial || material.userData.faceSkin) return material;
  const uniforms = {
    faceProcNormal: { value: proceduralSkinTextures().normal },
    faceNormalStrength: { value: 1 },
    faceNormalBlend: { value: 0 },
    faceLuster: { value: 1 },
  };
  const previous = material.onBeforeCompile;
  const baseKey = material.customProgramCacheKey?.() ?? '';
  const most = FACE_SKIN.stretchMost.toFixed(2);
  material.onBeforeCompile = (shader, renderer) => {
    previous?.call(material, shader, renderer);
    Object.assign(shader.uniforms, uniforms);
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', '#include <common>\nattribute vec2 faceStretch;\nvarying vec2 vFaceStretch;')
      .replace('#include <begin_vertex>', '#include <begin_vertex>\nvFaceStretch = faceStretch;');
    shader.fragmentShader = shader.fragmentShader
      .replace('#include <common>', '#include <common>\nvarying vec2 vFaceStretch;\nuniform sampler2D faceProcNormal;\nuniform float faceNormalStrength;\nuniform float faceNormalBlend;\nuniform float faceLuster;')
      // (Below neutral the blend runs back to the region's bare relief, without the pores and age lines the shader adds to
      // it; above, on to the procedural folds. Then the strength, and the stretch: a slope is a height over a width, and the
      // width is the skin's.)
      .replace('mapN.xy *= normalScale;', `vec2 faceBare = texture2D( normalMap, vUv ).xy * 2.0 - 1.0;
	vec2 faceProc = texture2D( faceProcNormal, vUv ).xy * 2.0 - 1.0;
	mapN.xy = mix( mapN.xy, faceBare, clamp( -faceNormalBlend, 0.0, 1.0 ) );
	mapN.xy = mix( mapN.xy, faceProc, clamp( faceNormalBlend, 0.0, 1.0 ) );
	vec2 faceStretched = mix( vec2( 1.0 ), clamp( vFaceStretch, 1.0 / ${most}, ${most} ), step( 0.01, vFaceStretch.x ) );
	mapN.xy *= faceNormalStrength / faceStretched;
	mapN.xy *= normalScale;`)
      .replace('#include <lights_physical_fragment>', '#include <lights_physical_fragment>\nmaterial.specularColor *= faceLuster;');
  };
  // (three caches programs by the patch's source text: keyed apart from the unfitted material's.)
  material.customProgramCacheKey = () => `${baseKey}|faceSkin1`;
  material.userData.faceSkin = { uniforms, colour: material.color.clone(), tone: 1, roughness: material.roughness };
  material.needsUpdate = true;
  return material;
}

/**
 * The head's material for a made face. `opts.cast`: the photo cast its maps are taken from (photoface.js customPhotoCast: the
 * preset's regions' composites, its skin already at the face's tone); none, the procedural maps. `painted`: a crowd's head,
 * coloured per vertex, which has no relief to fit. `hair`: the scalp's colour (photoSkinMaterial's).
 */
export function skinMaterialFor(faceInput, { cast = null, painted = false, hair = null } = {}) {
  const face = normalizeFace(faceInput);
  const material = cast ? photoSkinMaterial(cast, { painted, hair }) : proceduralSkinMaterial(face);
  if (painted && cast) return material;
  adaptSkinMaterial(material);
  // (A cast's skin is at the tone it was cast with: the tone slider counts from there.)
  material.userData.faceSkin.tone = cast?.tone ?? 1;
  return updateSkin(material, face);
}

/** Set a fitted material's surface from a face (its surface sliders and its age): cheap, no shader is made again. */
export function updateSkin(material, faceInput) {
  const fitted = material?.userData?.faceSkin;
  if (!fitted) return material;
  const face = normalizeFace(faceInput);
  const values = surfaceValues(face.surface);
  fitted.uniforms.faceNormalStrength.value = values.strength;
  fitted.uniforms.faceNormalBlend.value = values.blend;
  fitted.uniforms.faceLuster.value = values.luster;
  material.roughness = fitted.roughness * values.roughness;
  // (Lighter or darker by the tone's change since the material was made, the hue kept, no channel past what white skin is.)
  const scale = values.tone / fitted.tone;
  const top = Math.max(fitted.colour.r, fitted.colour.g, fitted.colour.b, 1e-6);
  material.color.copy(fitted.colour).multiplyScalar(Math.min(scale, Math.max(1, 1 / (FACE_SKIN.neutral * top))));
  const wrinkles = material.userData.scalp?.faceWrinkles;
  if (wrinkles) wrinkles.value = Math.max(fitted.wrinkles ?? (fitted.wrinkles = wrinkles.value), faceAgeLines(face));
  return material;
}

/** The age slider as age lines (the photo shader's `faceWrinkles`, 0..1): none at neutral and younger, full at 255. */
export const faceAgeLines = (face) => Math.min(1, Math.max(FACE_SKIN.wrinklesFrom, sliderOffset(face.sliders.age)));

registerFaceSkin({ materialFor: skinMaterialFor, update: updateSkin });
