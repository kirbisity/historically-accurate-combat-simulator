// The face customizer's core as the screen sees it: the schema, the solver and the skin of src/facecustom/ (built apart),
// re-exported from one place so the screen never names their files itself.
// (While the core is not in yet, this points at the stand-in in src/facecustom-stub/; the one line to change when it lands.)

export { defaultFace, ETHNICITY_PRESETS, FACE_SLIDERS, faceFromJSON, faceToJSON, normalizeFace, randomFace, similarFaces } from '../facecustom-stub/schema.js';
export { buildCustomHead } from '../facecustom-stub/solver.js';
// (The skin's module too: the real one hands the solver its material pipeline as it loads.)
export { skinMaterialFor, updateSkin } from '../facecustom-stub/skin.js';
