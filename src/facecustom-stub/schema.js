// A STAND-IN for src/facecustom/schema.js (the face customizer's core, built apart), with the same exports and the same
// shapes, so the customizer's screen (src/faceui/) can be built and tried before the core is in. A few sliders only. Used
// through src/faceui/core.js alone, and deleted when the real core lands.

export const FACE_STUB_VERSION = 1;
// Every slider's resting value: the middle of the byte, the face as its preset has it.
const STUB_NEUTRAL = 128;
const stubSlider = (id, group, label, labelZh) => ({ id, group, label, labelZh, neutral: STUB_NEUTRAL });

export const FACE_SLIDERS = [
  stubSlider('headWidth', 'general', 'Head width', '头宽'),
  stubSlider('headHeight', 'general', 'Head height', '头高'),
  stubSlider('browRidge', 'browEyes', 'Brow ridge', '眉弓'),
  stubSlider('eyeDepth', 'browEyes', 'Eye depth', '眼窝深浅'),
  stubSlider('noseLength', 'nose', 'Nose length', '鼻长'),
  stubSlider('noseBridge', 'nose', 'Nose bridge', '鼻梁'),
  stubSlider('cheekbones', 'cheeksMouth', 'Cheekbones', '颧骨'),
  stubSlider('lipFullness', 'cheeksMouth', 'Lip fullness', '嘴唇厚薄'),
  stubSlider('jawWidth', 'jawChin', 'Jaw width', '下颌宽'),
  stubSlider('chinLength', 'jawChin', 'Chin length', '下巴长'),
  stubSlider('pores', 'surface', 'Pores', '毛孔'),
  stubSlider('wrinkles', 'surface', 'Wrinkles', '皱纹'),
];

const stubSurface = (skinTone) => ({ normalStrength: 0.6, normalBlend: 0.5, skinTone, roughness: 0.55, luster: 0.25 });
export const ETHNICITY_PRESETS = {
  eastAsian: { label: 'East Asian', labelZh: '东亚', regions: ['eastAsia'], sliders: { browRidge: 100, noseBridge: 96, cheekbones: 150 }, surface: stubSurface(0.4) },
  european: { label: 'European', labelZh: '欧洲', regions: ['europe'], sliders: { browRidge: 160, noseBridge: 170, noseLength: 150 }, surface: stubSurface(0.2) },
  african: { label: 'African', labelZh: '非洲', regions: ['africa'], sliders: { lipFullness: 175, noseBridge: 110, jawWidth: 150 }, surface: stubSurface(0.85) },
};
const STUB_DEFAULT_PRESET = 'eastAsian';
const STUB_SEXES = ['male', 'female'];
const stubByte = (value, fallback) => (Number.isFinite(Number(value)) ? Math.max(0, Math.min(255, Math.round(Number(value)))) : fallback);
const stubUnit = (value, fallback) => (Number.isFinite(Number(value)) ? Math.max(0, Math.min(1, Number(value))) : fallback);

export function defaultFace(presetId = STUB_DEFAULT_PRESET, sex = 'male') {
  const preset = ETHNICITY_PRESETS[presetId] ?? ETHNICITY_PRESETS[STUB_DEFAULT_PRESET];
  const id = ETHNICITY_PRESETS[presetId] ? presetId : STUB_DEFAULT_PRESET;
  return {
    version: FACE_STUB_VERSION, preset: id, sex: STUB_SEXES.includes(sex) ? sex : 'male',
    sliders: Object.fromEntries(FACE_SLIDERS.map((slider) => [slider.id, preset.sliders[slider.id] ?? slider.neutral])),
    surface: { ...preset.surface },
  };
}

export function normalizeFace(json) {
  const raw = json && typeof json === 'object' && !Array.isArray(json) ? json : {};
  const base = defaultFace(raw.preset, raw.sex);
  const sliders = raw.sliders && typeof raw.sliders === 'object' ? raw.sliders : {};
  const surface = raw.surface && typeof raw.surface === 'object' ? raw.surface : {};
  return {
    ...base,
    sliders: Object.fromEntries(FACE_SLIDERS.map((slider) => [slider.id, stubByte(sliders[slider.id], base.sliders[slider.id])])),
    surface: Object.fromEntries(Object.entries(base.surface).map(([key, value]) => [key, stubUnit(surface[key], value)])),
  };
}

export function randomFace(rng = Math.random, opts = {}) {
  const presets = Object.keys(ETHNICITY_PRESETS);
  const preset = opts.preset ?? presets[Math.floor(rng() * presets.length)];
  const face = defaultFace(preset, opts.sex ?? (rng() < 0.5 ? 'male' : 'female'));
  for (const slider of FACE_SLIDERS) face.sliders[slider.id] = Math.round(rng() * 255);
  return face;
}

export function similarFaces(face, n = 9, spread = 40, rng = Math.random) {
  const base = normalizeFace(face);
  return Array.from({ length: n }, () => normalizeFace({
    ...base, sliders: Object.fromEntries(Object.entries(base.sliders).map(([id, value]) => [id, value + (rng() * 2 - 1) * spread])),
  }));
}

export const faceToJSON = (face) => JSON.stringify(normalizeFace(face), null, 2);
export const faceFromJSON = (text) => normalizeFace(typeof text === 'string' ? JSON.parse(text) : text);
