// The face customizer's reckoning (src/faceui/state.js): a preset file read in, whatever it is; the sliders' whole byte; the
// face kept in a storage that may refuse; a reset to the preset's baseline; the groups in order.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { defaultFace, ETHNICITY_PRESETS, FACE_SLIDERS, faceToJSON, normalizeFace } from '../src/faceui/core.js';
import { FACE_UI, parseFaceText, readFaceStore, resetGroup, resetSlider, sliderByte, slidersByGroup, sliderValue, wearKeptFace, withSlider, writeFaceStore } from '../src/faceui/state.js';

// The sliders the sidebar draws (the ethnicity slider is the preset select), features and the skin's surface alike.
const SHOWN = FACE_SLIDERS.filter((slider) => !FACE_UI.pickedElsewhere.includes(slider.kind));
const FEATURES = SHOWN.filter((slider) => slider.kind !== 'surface');

const presetId = Object.keys(ETHNICITY_PRESETS)[0];
const memoryStorage = () => {
  const kept = new Map();
  return { getItem: (key) => kept.get(key) ?? null, setItem: (key, value) => kept.set(key, String(value)) };
};
const refusingStorage = { getItem() { throw new Error('denied'); }, setItem() { throw new Error('denied'); } };

test('bad preset files are refused with a reason, never thrown', () => {
  assert.equal(parseFaceText('').error, 'empty');
  assert.equal(parseFaceText('   ').error, 'empty');
  assert.equal(parseFaceText(undefined).error, 'empty');
  assert.equal(parseFaceText('{not json').error, 'notJson');
  for (const text of ['null', '42', '"face"', '[1,2,3]', '{}', '{"sliders": 5}', '{"sliders": [1, 2]}']) assert.equal(parseFaceText(text).error, 'notFace', text);
  assert.equal(parseFaceText(`{"sliders": {}, "pad": "${'x'.repeat(FACE_UI.maxFileBytes)}"}`).error, 'tooLarge');
});

test('a preset file read in has every slider in 0..255, whatever it held', () => {
  const [first, second] = FEATURES;
  const { face } = parseFaceText(JSON.stringify({ preset: presetId, sex: 'female', sliders: { [first.id]: 9999, [second.id]: -40 } }));
  assert.equal(face.sliders[first.id], 255);
  assert.equal(face.sliders[second.id], 0);
  for (const slider of SHOWN) assert.ok(sliderValue(face, slider.id) >= 0 && sliderValue(face, slider.id) <= 255, slider.id);
});

test('export then import gives the same face back', () => {
  let face = defaultFace(presetId, 'female');
  for (const [index, slider] of SHOWN.entries()) face = withSlider(face, slider.id, (index * 37) % 256);
  assert.deepEqual(parseFaceText(faceToJSON(face)).face, normalizeFace(face));
});

test('a slider takes the whole byte, no softer clamp, and ignores what is no number', () => {
  assert.equal(sliderByte(0), 0);
  assert.equal(sliderByte(255), 255);
  assert.equal(sliderByte('300'), 255);
  assert.equal(sliderByte(-1), 0);
  assert.equal(sliderByte(12.6), 13);
  assert.equal(sliderByte(''), null);
  assert.equal(sliderByte('abc'), null);
  const face = defaultFace(presetId, 'male');
  assert.equal(withSlider(face, FEATURES[0].id, 'abc'), face);
  // (The skin's sliders are kept in face.surface, set and read alike.)
  const surfaceSlider = SHOWN.find((slider) => slider.kind === 'surface');
  if (surfaceSlider) assert.equal(sliderValue(withSlider(face, surfaceSlider.id, 255), surfaceSlider.id), 255);
  assert.equal(withSlider(face, 'no-such-slider', 10), face);
});

test('a slider and a group reset to the preset baseline', () => {
  const base = defaultFace(presetId, 'male');
  const group = FEATURES[0].group;
  let face = base;
  for (const slider of SHOWN) face = withSlider(face, slider.id, 3);
  assert.equal(sliderValue(resetSlider(face, FEATURES[0].id), FEATURES[0].id), sliderValue(base, FEATURES[0].id));
  const reset = resetGroup(face, group);
  for (const slider of SHOWN) assert.equal(sliderValue(reset, slider.id), slider.group === group ? sliderValue(base, slider.id) : 3, slider.id);
});

test('the sliders come in their groups, in the sidebar order, none lost', () => {
  const groups = slidersByGroup();
  assert.equal(groups.reduce((sum, entry) => sum + entry.sliders.length, 0), SHOWN.length);
  const known = groups.map((entry) => entry.group).filter((group) => FACE_UI.groups.includes(group));
  assert.deepEqual(known, FACE_UI.groups.filter((group) => known.includes(group)));
});

test('the kept face survives a storage that refuses, and is worn only when it is to be', () => {
  assert.equal(readFaceStore(refusingStorage), null);
  assert.equal(writeFaceStore({ face: defaultFace(presetId, 'male'), wear: true }, refusingStorage), false);
  assert.equal(readFaceStore(null), null);
  const storage = memoryStorage();
  storage.setItem(FACE_UI.storageKey, '{broken');
  assert.equal(readFaceStore(storage), null);
  const face = withSlider(defaultFace(presetId, 'male'), FEATURES[0].id, 7);
  const fighter = { name: 'Test', look: { hairStyle: 'bald' } };
  writeFaceStore({ face, wear: false }, storage);
  assert.equal(wearKeptFace(fighter, storage), fighter);
  writeFaceStore({ face, wear: true }, storage);
  const worn = wearKeptFace(fighter, storage);
  assert.equal(worn.look.faceCustom.sliders[FEATURES[0].id], 7);
  assert.equal(worn.look.hairStyle, 'bald');
  const own = { look: { faceCustom: defaultFace(presetId, 'female') } };
  assert.equal(wearKeptFace(own, storage), own);
});
