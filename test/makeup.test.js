// Makeup on photo faces (src/facecustom/makeup.js): the face JSON's round trip with and without it, the looks table, the
// colours fitted to the skin, and the customizer's makeup state.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { defaultFace, faceFromJSON, faceToJSON, normalizeFace, randomFace, setSlider } from '../src/facecustom/schema.js';
import {
  MAKEUP_LOOK_ORDER, MAKEUP_LOOKS, MAKEUP_PARTS, makeupColour, makeupPaintAt, makeupPart, makeupValues, makeupWorn, mkLuminance, mkRgb, normalizeMakeup, resolveMakeup,
  withMakeupPart,
} from '../src/facecustom/makeup.js';
import { FACE_UI, keepMakeup, makeupControlValue, resetMakeup, withMakeup, withMakeupControl } from '../src/faceui/state.js';

const CHART = ['natural', 'softGlam', 'fullGlam', 'dewy', 'matte', 'korean', 'cleanGirl', 'oldMoney', 'bridal', 'smokeyEye', 'editorial', 'goth'];

test('a face saved before makeup loads with none; a face with makeup survives text and back', () => {
  const old = { ...defaultFace('eastAsian', 'female') };
  delete old.makeup;
  const loaded = faceFromJSON(JSON.stringify(old));
  assert.equal(loaded.makeup.look, 'none');
  assert.equal(makeupWorn(loaded.makeup), false);
  const made = withMakeup(withMakeup(loaded, 'look', 'korean'), 'lip.colour', '#C03040');
  const back = faceFromJSON(faceToJSON(made));
  assert.deepEqual(back, normalizeFace(made));
  assert.equal(back.makeup.look, 'korean');
  assert.equal(back.makeup.parts['lip.colour'], '#c03040');
  // (Rubbish in the makeup is dropped, not thrown: an unknown look is none, an unknown part is gone, a number is held to its range.)
  const odd = normalizeFace({ ...made, makeup: { look: 'clown', strength: 7, parts: { 'lip.amount': 9, 'nose.paint': 1, 'lip.colour': 'red' } } });
  assert.deepEqual(odd.makeup, { version: 1, look: 'none', strength: 1, parts: { 'lip.amount': 1 } });
  // (The ethnicity slider loads a preset's face and keeps the makeup; a random face wears none.)
  assert.equal(setSlider(made, 'ethnicity', 10).makeup.look, 'korean');
  assert.equal(randomFace(() => 0.3).makeup.look, 'none');
});

test('the looks: none and the chart\'s twelve, every part present and in range, each look its own', () => {
  assert.deepEqual(MAKEUP_LOOK_ORDER, ['none', ...CHART]);
  for (const [id, look] of Object.entries(MAKEUP_LOOKS)) {
    assert.ok(look.label && look.labelZh, id);
    for (const [part, numbers] of Object.entries(MAKEUP_PARTS)) {
      for (const [number, range] of Object.entries(numbers)) {
        const value = look.parts[part][number];
        if (range === 'colour') assert.match(value, /^#[0-9a-f]{6}$/, `${id}.${part}.${number}`);
        else assert.ok(value >= range[0] && value <= range[1], `${id}.${part}.${number} = ${value}`);
      }
    }
  }
  assert.equal(makeupWorn('none'), false);
  for (const id of CHART) assert.ok(makeupWorn(id), id);
  const keys = CHART.map((id) => JSON.stringify(MAKEUP_LOOKS[id].parts));
  assert.equal(new Set(keys).size, CHART.length);
  // What sets the chart's looks apart: the goth look's pale base and black lip, the Korean lip's gradient, the editorial
  // foil, the smokey eye's smoked lower lid, the dewy and matte finishes, the natural look's freckles left showing.
  const part = (id, path) => makeupPart({ look: id }, path);
  assert.ok(part('goth', 'base.pale') === 1 && mkLuminance(mkRgb(part('goth', 'lip.colour'))) < 0.08);
  assert.ok(part('korean', 'lip.gradient') > 0.5 && CHART.filter((id) => part(id, 'lip.gradient') > 0).length === 1);
  assert.ok(part('editorial', 'shadow.metal') === 1 && CHART.every((id) => id === 'editorial' || part(id, 'shadow.metal') < 0.5));
  assert.ok(part('smokeyEye', 'shadow.lower') > 0.8 && part('smokeyEye', 'shadow.smoke') === 1);
  assert.ok(part('dewy', 'base.finish') === 1 && part('matte', 'base.finish') === -1);
  assert.ok(part('natural', 'base.cover') < 0.3);
  assert.ok(part('fullGlam', 'liner.wing') > part('softGlam', 'liner.wing'));
});

test('a look\'s strength scales its amounts, not its colours or places; a changed part wins over the look', () => {
  const half = resolveMakeup({ look: 'bridal', strength: 0.5 });
  const full = resolveMakeup({ look: 'bridal' });
  assert.equal(half.lip.amount, full.lip.amount / 2);
  assert.equal(half.lip.colour, full.lip.colour);
  assert.equal(half.blush.row, full.blush.row);
  const changed = withMakeupPart({ look: 'bridal' }, 'liner.wing', 0.9);
  assert.equal(resolveMakeup(changed).liner.wing, 0.9);
  assert.equal(makeupWorn({ look: 'bridal', strength: 0 }), false);
  // The drawn heads' older makeup (the gothic gowns) is read as its nearest look.
  const drawn = normalizeMakeup({ eyes: 'smoky', liner: 'winged', lowerLash: 'heavy', lips: '#0b090b' });
  assert.equal(drawn.look, 'smokeyEye');
  assert.equal(drawn.parts['lip.colour'], '#0b090b');
});

test('colours fit the skin: a nude follows its depth, a black lip and a gold foil keep theirs, a pink deepens to a berry', () => {
  const skins = ['#f2d6c6', '#c58c64', '#4a2a1c'];
  const nude = skins.map((skin) => mkLuminance(makeupColour('#a86a5a', 0.85, skin)));
  assert.ok(nude[0] > nude[1] && nude[1] > nude[2], `nude by skin: ${nude}`);
  // On the reference skin a colour is as given.
  assert.deepEqual(makeupColour('#a86a5a', 0.85, '#c58c64').map((v) => Math.round(v * 255)), mkRgb('#a86a5a').map((v) => Math.round(v * 255)));
  // A nude stays near the skin's own depth on every skin (within a factor of two of its luminance), not a fixed light pink.
  for (const skin of skins) {
    const ratio = mkLuminance(makeupColour('#a86a5a', 0.85, skin)) / mkLuminance(mkRgb(skin));
    assert.ok(ratio > 0.45 && ratio < 1.1, `${skin}: ${ratio}`);
  }
  for (const skin of skins) assert.ok(mkLuminance(makeupColour('#140e12', 0.85, skin)) < 0.08, skin);
  for (const skin of skins) assert.deepEqual(makeupColour('#d8b060', 0, skin).map((v) => Math.round(v * 255)), [216, 176, 96]);
  // A pastel pink blush on a deep skin: darker, its hue kept, still a pink-red (red the strongest channel), not chalk.
  const [r, g, b] = makeupColour('#ef8a96', 1, '#4a2a1c');
  assert.ok(r > g && r > b && mkLuminance([r, g, b]) < mkLuminance(mkRgb('#ef8a96')) * 0.7);
  // The shader's colours are over the skin: the skin itself would be the atlas's neutral grey; a black liner far under it.
  const values = makeupValues({ look: 'goth' }, '#c58c64', 0.45);
  assert.ok(values.worn && values.colours.liner.every((v) => v < 0.1));
  assert.ok(values.colours.paleBase.every((v) => v > 0.45), 'the goth base is paler than the skin');
  assert.equal(makeupValues('none', '#c58c64').worn, false);
});

test('the customizer\'s makeup: its controls read and set the parts, a reset keeps the look, a new face keeps the makeup', () => {
  let face = withMakeup(defaultFace('westAfrican', 'male'), 'look', 'smokeyEye');
  const finish = FACE_UI.makeup.find((control) => control.id === 'base.finish');
  const lip = FACE_UI.makeup.find((control) => control.id === 'lip.colour');
  assert.equal(makeupControlValue(face, finish), Math.round(MAKEUP_LOOKS.smokeyEye.parts.base.finish * 100));
  face = withMakeupControl(face, finish, -60);
  face = withMakeupControl(face, lip, '#802030');
  assert.equal(face.makeup.parts['base.finish'], -0.6);
  assert.equal(makeupControlValue(face, lip), '#802030');
  assert.deepEqual(resetMakeup(face).makeup.parts, {});
  assert.equal(resetMakeup(face).makeup.look, 'smokeyEye');
  assert.equal(keepMakeup(defaultFace('northEuropean', 'female'), face).makeup.parts['lip.colour'], '#802030');
  // (Every control names a real part.)
  for (const control of FACE_UI.makeup) assert.notEqual(makeupPart('none', control.id), undefined, control.id);
});

test('a crowd\'s painted head takes the broad strokes: the lip at the lip line, nothing far from the features, nothing bare', () => {
  const atlas = { eyeU: 0.0668, eyeRow: 0.44, mouthRow: 0.7, eyeHalf: [0.027, 0.013] };
  const skin = '#c58c64';
  const rgb = mkRgb(skin);
  const values = makeupValues({ look: 'goth' }, skin);
  const lip = makeupPaintAt(rgb, 0.5, 1 - atlas.mouthRow, values, skin, atlas);
  assert.ok(mkLuminance(lip) < mkLuminance(rgb) * 0.5, 'a black lip darkens the lip line');
  const back = makeupPaintAt(rgb, 0.02, 0.5, values, skin, atlas);
  assert.deepEqual(back.map((v) => Math.round(v * 255)), rgb.map((v) => Math.round(v * 255)), 'the back of the head is left alone');
  assert.deepEqual(makeupPaintAt(rgb, 0.5, 0.3, makeupValues('none', skin), skin, atlas), rgb);
});
