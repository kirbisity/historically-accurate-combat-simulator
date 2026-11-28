// The face customiser (src/facecustom/): the parameter schema, the solver on the head model and on the procedural head, the
// coupling, the extremes, the expressions and the procedural maps.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  ETHNICITY_PRESETS, FACE_SCHEMA_VERSION, FACE_SHAPE_IDS, FACE_SLIDERS, FACE_SURFACE_IDS, defaultFace, faceFromJSON, faceToJSON, getSlider, normalizeFace,
  presetForSlider, randomFace, setSlider, similarFaces, sliderForPreset, surfaceValues,
} from '../src/facecustom/schema.js';
import {
  FACE_COUPLING, FACE_COUPLING_MOST, FACE_EXPRESSIONS, FACE_SCULPT, compileFace, couplingMatrix, customHeadMesh, faceDrives, faceLandmarks, headExpressions,
  presetBaseline, solveFacePoints,
} from '../src/facecustom/solver.js';
import { REGION_PLACES } from '../src/faceregions.js';

const seeded = (seed) => () => {
  seed = (seed * 16807) % 2147483647;
  return seed / 2147483647;
};
const SHAPES = FACE_SHAPE_IDS.filter((id) => id !== 'ethnicity');
const withAll = (face, value) => ({ ...face, sliders: { ...face.sliders, ...Object.fromEntries(SHAPES.map((id) => [id, typeof value === 'function' ? value(id) : value])) } });
const flat = (head) => Float32Array.from(head.unit.flat());

/** The triangles above the jaw's lid that face against their own corners' normals: the mesh folded over itself there. */
function folded(head) {
  const { stride, lidRow } = head.grid;
  const [P, N, I] = [head.positions, head.normals, head.indices];
  let count = 0;
  for (let t = 0; t < I.length; t += 3) {
    const [a, b, c] = [I[t], I[t + 1], I[t + 2]];
    if (Math.floor(Math.max(a, b, c) / stride) > lidRow) continue;
    const e1 = [0, 1, 2].map((k) => P[b * 3 + k] - P[a * 3 + k]);
    const e2 = [0, 1, 2].map((k) => P[c * 3 + k] - P[a * 3 + k]);
    const n = [e1[1] * e2[2] - e1[2] * e2[1], e1[2] * e2[0] - e1[0] * e2[2], e1[0] * e2[1] - e1[1] * e2[0]];
    let facing = 0;
    for (const v of [a, b, c]) facing += n[0] * N[v * 3] + n[1] * N[v * 3 + 1] + n[2] * N[v * 3 + 2];
    if (facing < 0) count += 1;
  }
  return count;
}

test('the schema: every slider of the request, in its group, 0..255 about 128; presets name real regions', () => {
  assert.equal(FACE_SLIDERS.length, 43);
  assert.deepEqual([...new Set(FACE_SLIDERS.map((entry) => entry.group))], ['general', 'browEyes', 'nose', 'cheeksMouth', 'jawChin', 'surface']);
  for (const entry of FACE_SLIDERS) assert.ok(entry.id && entry.label && entry.labelZh && entry.neutral === 128, entry.id);
  assert.equal(FACE_SHAPE_IDS.length + FACE_SURFACE_IDS.length, FACE_SLIDERS.length);
  for (const [id, preset] of Object.entries(ETHNICITY_PRESETS)) {
    assert.ok(preset.label && preset.labelZh && preset.regions.length, id);
    for (const region of preset.regions) assert.ok(REGION_PLACES[region], `${id}: ${region}`);
    for (const [slider, value] of Object.entries(preset.sliders)) assert.ok(SHAPES.includes(slider) && value >= 0 && value <= 255, `${id}.${slider}`);
    assert.equal(presetForSlider(sliderForPreset(id)), id);
  }
  // (Every shape slider but the preset's has a blend shape.)
  for (const id of SHAPES) assert.ok(FACE_SCULPT[id], id);
});

test('the schema round trip: a face survives text and back; rubbish in is a clean face out', () => {
  const face = randomFace(seeded(3));
  assert.deepEqual(faceFromJSON(faceToJSON(face)), face);
  assert.deepEqual(normalizeFace(face), face);
  assert.equal(face.version, FACE_SCHEMA_VERSION);
  const dirty = normalizeFace({ preset: 'nowhere', sex: 'robot', sliders: { jawWidth: 999, eyeSize: -4, noseSlant: 'x', made: 3 }, surface: { luster: 300.4 }, extra: 1 });
  assert.equal(dirty.sex, 'male');
  assert.ok(ETHNICITY_PRESETS[dirty.preset]);
  assert.equal(dirty.sliders.jawWidth, 255);
  assert.equal(dirty.sliders.eyeSize, 0);
  assert.equal(dirty.sliders.noseSlant, 128);
  assert.equal(dirty.sliders.made, undefined);
  assert.equal(dirty.surface.luster, 255);
  assert.deepEqual(faceFromJSON('not json'), defaultFace());
  // The ethnicity slider loads its preset; any other slider is set where it is kept.
  const loaded = setSlider(defaultFace('eastAsian', 'female'), 'ethnicity', sliderForPreset('westAfrican'));
  assert.deepEqual(loaded, defaultFace('westAfrican', 'female'));
  assert.equal(getSlider(setSlider(loaded, 'luster', 200), 'luster'), 200);
  assert.equal(getSlider(setSlider(loaded, 'jawWidth', 20), 'jawWidth'), 20);
  assert.deepEqual(surfaceValues(defaultFace().surface), { strength: 1, blend: 0, tone: 1, roughness: 1, luster: 1 });
});

test('neutral is the identity: every slider at 128 leaves a head as it was, and a preset\'s own face leaves its own head as it was', () => {
  const neutral = withAll(defaultFace('eastAsian'), 128);
  const base = customHeadMesh(neutral, { data: null });
  const points = flat(base);
  assert.deepEqual(solveFacePoints(points, neutral), points);
  assert.ok(compileFace(neutral).identity);
  // On the head model the base is the preset's own regions' head: the preset's baseline sliders are that head unchanged.
  for (const preset of ['eastAsian', 'northEuropean', 'westAfrican']) {
    const face = defaultFace(preset, 'female');
    assert.ok(compileFace(face, { baseline: presetBaseline(face) }).identity, preset);
    const head = customHeadMesh(face);
    assert.ok(head.sculpted.compiled.identity);
    assert.ok(head.sculpted.stretch.every((value) => value === 1));
  }
  // And one slider moved moves the head, near its feature and nowhere behind the ears.
  const face = setSlider(defaultFace('eastAsian'), 'noseProtrusion', 200);
  const [plain, made] = [customHeadMesh(defaultFace('eastAsian')), customHeadMesh(face)];
  let most = 0;
  made.unit.forEach((p, vertex) => {
    const moved = Math.hypot(...p.map((value, axis) => value - plain.unit[vertex][axis]));
    most = Math.max(most, moved);
    if (plain.unit[vertex][0] < -0.3) assert.equal(moved, 0);
  });
  assert.ok(most > 0.03 && most < 0.5, `the nose's tip moved ${most}`);
});

test('the coupling is cross-talk: small, the same both ways where it is mutual, never chained, and the head stays mirror-symmetric', () => {
  for (const entry of FACE_COUPLING) {
    assert.ok(FACE_SCULPT[entry.from] && FACE_SCULPT[entry.to] && entry.from !== entry.to, `${entry.from} -> ${entry.to}`);
    assert.ok(Math.abs(entry.weight) > 0 && Math.abs(entry.weight) <= FACE_COUPLING_MOST, `${entry.from} -> ${entry.to}: ${entry.weight}`);
    assert.ok(entry.reason.length > 10);
  }
  const { ids, matrix } = couplingMatrix();
  const at = (to, from) => matrix[ids.indexOf(to)][ids.indexOf(from)];
  ids.forEach((id) => assert.equal(at(id, id), 1));
  for (const entry of FACE_COUPLING.filter((each) => each.mutual)) assert.equal(at(entry.to, entry.from), at(entry.from, entry.to));
  // The request's own two: the brow's height shifts the bridge's depth; the jaw's width pulls the cheekbones and the chin.
  assert.ok(at('bridgeDepth', 'browHeight') > 0 && at('cheekWidth', 'jawWidth') > 0 && at('chinWidth', 'jawWidth') > 0);
  // One slider's drive is its own offset on itself and the table's share on its neighbours, nothing further on.
  const drives = faceDrives(setSlider(withAll(defaultFace(), 128), 'jawWidth', 160));
  const own = drives.jawWidth;
  assert.ok(own > 0);
  assert.ok(Math.abs(drives.cheekWidth / own - 0.12) < 1e-9 && Math.abs(drives.chinWidth / own - 0.15) < 1e-9);
  assert.equal(drives.eyeSize, 0);
  // Left and right alike.
  const head = customHeadMesh(randomFace(seeded(11), { preset: 'mediterranean', sex: 'male', spread: 90 }));
  const { stride, rowCount } = head.grid;
  for (let row = 0; row < rowCount; row += 1) {
    for (let column = 0; column < stride; column += 1) {
      const [p, q] = [head.unit[row * stride + column], head.unit[row * stride + stride - 1 - column]];
      assert.ok(Math.abs(p[0] - q[0]) < 1e-5 && Math.abs(p[1] - q[1]) < 1e-5 && Math.abs(p[2] + q[2]) < 1e-5, `row ${row} column ${column}`);
    }
  }
});

test('the extremes distort and stay whole: every slider at 0, at 255, and at one end or the other, on both heads', () => {
  let seed = seeded(5);
  const cases = { low: 0, high: 255, mixed: () => (seed() < 0.5 ? 0 : 255), mixedAgain: () => (seed() < 0.5 ? 0 : 255) };
  for (const data of [undefined, null]) {
    const base = customHeadMesh(defaultFace('mediterranean'), { data });
    for (const [name, value] of Object.entries(cases)) {
      const head = customHeadMesh(withAll(defaultFace('mediterranean'), value), { data });
      const label = `${data === null ? 'procedural' : 'model'} ${name}`;
      for (const array of [head.positions, head.normals, head.tangents, head.sculpted.stretch]) assert.ok(Array.prototype.every.call(array, Number.isFinite), `${label}: a number that is none`);
      let most = 0;
      head.unit.forEach((p, vertex) => { most = Math.max(most, Math.hypot(...p.map((v, axis) => v - base.unit[vertex][axis]))); });
      // (Really distorted: some point is a fifth of the head's radius from where it was; and not blown up.)
      assert.ok(most > 0.2 && most < 2.5, `${label}: the furthest point moved ${most}`);
      // (A few of the mesh's triangles round the tightest curls may turn over; not a patch of them.)
      const turned = folded(head) - folded(base);
      assert.ok(turned <= head.indices.length / 3 * 0.03, `${label}: ${turned} triangles folded`);
    }
  }
  // One slider at an end, the rest neutral: next to none.
  for (const id of SHAPES) {
    for (const value of [0, 255]) {
      const head = customHeadMesh(setSlider(defaultFace('mediterranean'), id, value));
      assert.ok(folded(head) <= 12, `${id} at ${value}: ${folded(head)} triangles folded`);
    }
  }
});

test('faces near a face stay near it; a random face is a clean face of its preset', () => {
  const face = randomFace(seeded(9), { preset: 'southAsian', sex: 'female' });
  assert.equal(face.preset, 'southAsian');
  assert.deepEqual(normalizeFace(face), face);
  const near = similarFaces(face, 9, 12, seeded(21));
  assert.equal(near.length, 9);
  for (const other of near) {
    assert.equal(other.preset, face.preset);
    assert.equal(other.sex, face.sex);
    for (const entry of FACE_SLIDERS) assert.ok(Math.abs(getSlider(other, entry.id) - getSlider(face, entry.id)) <= 12, entry.id);
    assert.deepEqual(normalizeFace(other), other);
  }
  assert.ok(near.some((other) => faceToJSON(other) !== faceToJSON(face)));
  // And their heads are near its head.
  const head = customHeadMesh(face, { lod: 'coarse' });
  const other = customHeadMesh(near[0], { lod: 'coarse' });
  let most = 0;
  head.unit.forEach((p, vertex) => { most = Math.max(most, Math.hypot(...p.map((v, axis) => v - other.unit[vertex][axis]))); });
  assert.ok(most < 0.08, `a near face's furthest point is ${most} away`);
});

test('expressions: each moves a few points of the face by a little, unknown keys and flags are passed over, and rest is rest', () => {
  const head = customHeadMesh(setSlider(defaultFace('westAsian'), 'jawWidth', 170));
  const expressions = headExpressions(head, [1, 1, 1]);
  for (const name of ['fury', 'fear', 'shout', 'calm', 'pain', 'smirk', 'frown', 'press', 'jawLeft', 'jawRight']) {
    assert.ok(FACE_EXPRESSIONS[name], name);
    const shape = expressions.compiled[name];
    assert.ok(shape.index.length > 20 && shape.index.length < head.unit.length, `${name}: ${shape.index.length} points`);
    const most = shape.delta.reduce((high, value) => Math.max(high, Math.abs(value)), 0);
    assert.ok(most > 0.004 && most < 0.5, `${name}: ${most}`);
  }
  assert.equal(expressions.set({ nothing: 1, fearParts: true }), false);
  assert.equal(expressions.set({ fury: 0.6, bogus: 2, fearParts: false }), true);
  assert.ok(expressions.offsets.some((value) => value !== 0));
  assert.equal(expressions.set({ fury: 0.601 }), false);
  // Fear parts the mouth or presses it, as the driver says.
  expressions.set({ fear: 0.6, fearParts: true });
  const parted = Float32Array.from(expressions.offsets);
  expressions.set({ fear: 0.6, fearParts: false });
  assert.ok(parted.some((value, index) => Math.abs(value - expressions.offsets[index]) > 1e-4));
  assert.equal(expressions.set({}), true);
  assert.ok(expressions.offsets.every((value) => value === 0));
  // The landmarks are on the head they were read from.
  const marks = faceLandmarks(flat(head), head.uvs);
  assert.ok(marks.noseTip[0] > marks.nasion[0] && marks.eye[2] > 0.2 && marks.chin[1] < marks.mouth[1]);
});

test('the procedural maps are made from nothing: a normal map that is flat on the scalp and creased on the face, and an albedo', async () => {
  const { proceduralSkinMaps } = await import('../src/facecustom/skin.js').catch((error) => ({ error }));
  if (!proceduralSkinMaps) return; // (skin.js is the browser's: three.js. Its maps are checked where it loads.)
  const maps = proceduralSkinMaps({ width: 256, height: 128 });
  assert.equal(maps.normal.length, 256 * 128 * 4);
  const slope = (x, y) => Math.abs(maps.normal[(y * 256 + x) * 4] - 128) + Math.abs(maps.normal[(y * 256 + x) * 4 + 1] - 128);
  assert.ok(slope(10, 64) <= 1);
  let most = 0;
  for (let y = 20; y < 90; y += 1) for (let x = 100; x < 156; x += 1) most = Math.max(most, slope(x, y));
  assert.ok(most > 20);
  assert.ok(maps.albedo.some((value) => value < 60) && maps.albedo.some((value) => value > 150));
});
