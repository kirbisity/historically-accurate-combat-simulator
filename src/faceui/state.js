// The face customizer's own reckoning, apart from its page: the face kept in this browser, a preset file read in (whatever
// is pasted or uploaded), the sliders in their groups, and a slider set or reset. Plain data in, plain data out, so node's
// tests read it as the screen does (src/faceui/view.js draws it).

import { defaultFace, FACE_SLIDERS, faceFromJSON, faceToJSON, normalizeFace } from './core.js';

export const FACE_UI = {
  // Where the last face is kept (the game's settings all live under `gladiator.`), with whether the player's fighter wears it.
  storageKey: 'gladiator.faceCustom',
  // A slider's span: the whole byte, no softer clamp inside it, so every face the schema can hold can be made by hand.
  min: 0,
  max: 255,
  // The groups in the order the sidebar shows them (schema.js FACE_SLIDERS.group); a group not listed goes after these.
  groups: ['general', 'browEyes', 'nose', 'cheeksMouth', 'jawChin', 'surface'],
  // A preset file larger than this is not a face (a face is a few kilobytes): refused before it is parsed.
  maxFileBytes: 64 * 1024,
  // The Similar Faces grid: how many variations (a 3 by 3 grid) and how far each slider may stray from the face, in slider steps.
  similarCount: 9,
  similarSpread: 36,
  // Slider kinds not drawn as sliders: 'preset' (the ethnicity slider, schema.js) is the Ethnicity Preset select, which loads
  // the preset's whole baseline rather than nudging one value.
  pickedElsewhere: ['preset'],
};

/** A slider's value as the byte it is kept as: an integer in 0..255, or null when what was typed is no number. */
export function sliderByte(value) {
  if (value === '' || value === null || value === undefined) return null;
  const number = Number(value);
  if (!Number.isFinite(number)) return null;
  return Math.max(FACE_UI.min, Math.min(FACE_UI.max, Math.round(number)));
}

/** Where a slider's value is kept on a face: `sliders` for a feature, `surface` for the skin's (schema.js kind 'surface'). */
const faceHolder = (face, id) => (face.sliders && id in face.sliders ? 'sliders' : face.surface && id in face.surface ? 'surface' : null);

/** A slider's value on a face, wherever it is kept (undefined for an id the face has not). */
export function sliderValue(face, id) {
  const holder = faceHolder(face, id);
  return holder ? face[holder][id] : undefined;
}

/** The face with one slider set (the value made a byte; a value that is no number leaves the face as it was). */
export function withSlider(face, id, value) {
  const held = sliderByte(value);
  const holder = faceHolder(face, id);
  if (held === null || !holder) return face;
  return { ...face, [holder]: { ...face[holder], [id]: held } };
}

/** What a slider goes back to: its value in the face's own preset (its baseline for that sex), else the slider's neutral. */
export function baselineOf(face, id) {
  return sliderValue(defaultFace(face.preset, face.sex), id) ?? FACE_SLIDERS.find((slider) => slider.id === id)?.neutral ?? 128;
}

export const resetSlider = (face, id) => withSlider(face, id, baselineOf(face, id));

/** Every slider of a group back to the preset's baseline. */
export function resetGroup(face, group) {
  let next = face;
  for (const slider of FACE_SLIDERS) if (slider.group === group && !FACE_UI.pickedElsewhere.includes(slider.kind)) next = withSlider(next, slider.id, baselineOf(face, slider.id));
  return next;
}

/** A new preset or sex: the preset's baseline for that sex, the surface its own (a preset is a starting face, not a filter). */
export const facePreset = (presetId, sex) => normalizeFace(defaultFace(presetId, sex));

/**
 * The sliders the sidebar shows by group, in FACE_UI.groups' order (then any other group in the order it first appears); a
 * slider picked elsewhere (the ethnicity slider: the preset select) left out.
 */
export function slidersByGroup(all = FACE_SLIDERS) {
  const sliders = all.filter((slider) => !FACE_UI.pickedElsewhere.includes(slider.kind));
  const order = [...FACE_UI.groups, ...sliders.map((slider) => slider.group).filter((group) => !FACE_UI.groups.includes(group))];
  return [...new Set(order)].map((group) => ({ group, sliders: sliders.filter((slider) => slider.group === group) })).filter((entry) => entry.sliders.length);
}

/**
 * A preset file's text read as a face: `{ face }`, or `{ error }` (one of 'empty', 'tooLarge', 'notJson', 'notFace') when it
 * is not one. A face is an object with a sliders object; whatever it holds besides is the schema's to settle (normalizeFace
 * clamps every slider into 0..255 and fills what is missing from the preset).
 */
export function parseFaceText(text) {
  if (typeof text !== 'string' || !text.trim()) return { error: 'empty' };
  if (text.length > FACE_UI.maxFileBytes) return { error: 'tooLarge' };
  let raw;
  try {
    raw = JSON.parse(text);
  } catch {
    return { error: 'notJson' };
  }
  if (!raw || typeof raw !== 'object' || Array.isArray(raw) || !raw.sliders || typeof raw.sliders !== 'object' || Array.isArray(raw.sliders)) return { error: 'notFace' };
  try {
    return { face: normalizeFace(faceFromJSON(text)) };
  } catch {
    return { error: 'notFace' };
  }
}

export const faceText = (face) => faceToJSON(face);

/** The kept face and whether the player's fighter wears it: `{ face, wear }`, or null (nothing kept, or storage refused). */
export function readFaceStore(storage = globalThis.localStorage) {
  try {
    const text = storage?.getItem(FACE_UI.storageKey);
    if (!text) return null;
    const kept = JSON.parse(text);
    if (!kept || typeof kept !== 'object' || !kept.face) return null;
    return { face: normalizeFace(kept.face), wear: Boolean(kept.wear) };
  } catch {
    return null;
  }
}

/** Keep the face (and whether it is worn); a storage that is missing or refuses keeps it for this visit only. */
export function writeFaceStore(record, storage = globalThis.localStorage) {
  try {
    storage?.setItem(FACE_UI.storageKey, JSON.stringify({ face: normalizeFace(record.face), wear: Boolean(record.wear) }));
    return true;
  } catch {
    return false;
  }
}

/** A fighter's inputs with the kept face on him (`look.faceCustom`) when it is to be worn and he has none of his own. */
export function wearKeptFace(inputs, storage = globalThis.localStorage) {
  const kept = readFaceStore(storage);
  if (!kept?.wear || inputs?.look?.faceCustom) return inputs;
  return { ...inputs, look: { ...inputs.look, faceCustom: kept.face } };
}
