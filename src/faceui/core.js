// The face customizer's core as the screen sees it: the schema, the solver and the skin of src/facecustom/ (built apart),
// re-exported from one place so the screen never names their files itself.

export { defaultFace, ETHNICITY_PRESETS, FACE_SLIDERS, faceFromJSON, faceToJSON, normalizeFace, randomFace, similarFaces } from '../facecustom/schema.js';
export { buildCustomHead } from '../facecustom/solver.js';
export { MAKEUP_LOOKS, MAKEUP_LOOK_ORDER, makeupPart, normalizeMakeup, withMakeupPart } from '../facecustom/makeup.js';
// (The skin's module too: the real one hands the solver its material pipeline as it loads.)
export { skinMaterialFor, updateSkin } from '../facecustom/skin.js';
