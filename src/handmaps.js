// The hand's sheets, drawn in code: the relief (as a normal map), the colour's variation (a tint over the skin's or the
// glove's own colour) and the roughness of one hand laid out flat (handform.js HAND_SHEET: the back of the hand, the palm,
// and a digit unrolled, which every finger and the thumb share). One sheet of each kind for every hand: a skin of any tone
// is the same sheet under its own colour.
//
// Skin: the knuckles' wrinkles, the tendons fanning from the wrist to the knuckles and the veins between them, the joints'
// folds on the back of a finger and the creases under them, the nail (paler, smoother, a rim round it); on the palm the
// three long creases, the wrist's, and the paler, pinker skin of the palm itself. A glove: its seams down the sides of
// each finger and round the thumb, the three points stitched on the back, the leather's fine grain, soft folds at the joints.

/* global THREE, document */
import { HAND_KNUCKLES, HAND_SHEET, handSheetAt } from './handform.js';

export const HAND_MAPS = {
  size: [512, 256],
  // The tint's "no change", under white so a place can be paler than the tone (a palm, a nail): made up in the material's colour.
  neutral: 0.8,
  // How steep the relief is drawn (the height's slope to the normal's lean).
  relief: { skin: 1.7, glove: 1.8 },
  // The skin's roughness, the palm's and the nail's.
  rough: { skin: 0.64, palm: 0.58, nail: 0.3, glove: 0.7 },
};

const handSheets = new Map();

/** A soft line on a canvas: `points` [[x, y], ...] in sheet shares, `width` px, a ridge (`value` > 0) or a groove of this strength. */
function handStroke(context, points, width, value, [W, H]) {
  const shade = value > 0 ? 255 : 0;
  context.lineCap = 'round';
  context.lineJoin = 'round';
  // (Three strokes, each narrower: a rounded profile without the canvas's blur, which not every browser has.)
  for (const share of [1, 0.62, 0.3]) {
    context.strokeStyle = `rgba(${shade},${shade},${shade},${Math.abs(value) / 3})`;
    context.lineWidth = Math.max(0.6, width * share);
    context.beginPath();
    points.forEach(([x, y], index) => (index ? context.lineTo(x * W, (1 - y) * H) : context.moveTo(x * W, (1 - y) * H)));
    context.stroke();
  }
}

/** A soft round spot (a pad, a pore's shade): centre and radii in sheet shares. */
function handSpot(context, [x, y], [rx, ry], colour, [W, H]) {
  context.save();
  context.translate(x * W, (1 - y) * H);
  context.scale(rx * W, ry * H);
  const fill = context.createRadialGradient(0, 0, 0, 0, 0, 1);
  fill.addColorStop(0, colour);
  fill.addColorStop(1, colour.replace(/[\d.]+\)$/, '0)'));
  context.fillStyle = fill;
  context.fillRect(-1, -1, 2, 2);
  context.restore();
}

/** A curve through points, sampled (Catmull-Rom). */
function handCurve(points, steps = 24) {
  const out = [];
  const p = (k) => points[Math.min(points.length - 1, Math.max(0, k))];
  for (let step = 0; step <= steps; step += 1) {
    const at = (step / steps) * (points.length - 1);
    const index = Math.min(points.length - 2, Math.floor(at));
    const f = at - index;
    const [a, b, c, d] = [p(index - 1), p(index), p(index + 1), p(index + 2)];
    out.push([0, 1].map((axis) => 0.5 * (2 * b[axis] + (c[axis] - a[axis]) * f + (2 * a[axis] - 5 * b[axis] + 4 * c[axis] - d[axis]) * f * f + (3 * b[axis] - a[axis] - 3 * c[axis] + d[axis]) * f * f * f)));
  }
  return out;
}

/** A repeatable scatter (the same sheet every time it is drawn). */
function handRandom(seed) {
  let state = seed;
  return () => {
    state = (state * 1664525 + 1013904223) >>> 0;
    return state / 4294967296;
  };
}

function handCanvas([W, H], fill) {
  const canvas = document.createElement('canvas');
  canvas.width = W;
  canvas.height = H;
  const context = canvas.getContext('2d');
  context.fillStyle = fill;
  context.fillRect(0, 0, W, H);
  return [canvas, context];
}

/** A height canvas (grey, 128 level) as a normal map's canvas. */
function handNormalCanvas(height, strength) {
  const { width: W, height: H } = height;
  const source = height.getContext('2d').getImageData(0, 0, W, H).data;
  const [canvas, context] = handCanvas([W, H], '#8080ff');
  const image = context.getImageData(0, 0, W, H);
  const at = (x, y) => source[(Math.min(H - 1, Math.max(0, y)) * W + Math.min(W - 1, Math.max(0, x))) * 4] / 255;
  for (let y = 0; y < H; y += 1) {
    for (let x = 0; x < W; x += 1) {
      const dx = (at(x + 1, y) - at(x - 1, y)) * strength;
      // (The canvas's rows run down, the sheet's up.)
      const dy = (at(x, y - 1) - at(x, y + 1)) * strength;
      const length = Math.hypot(dx, dy, 1);
      const index = (y * W + x) * 4;
      image.data[index] = Math.round((-dx / length) * 127.5 + 127.5);
      image.data[index + 1] = Math.round((-dy / length) * 127.5 + 127.5);
      image.data[index + 2] = Math.round((1 / length) * 127.5 + 127.5);
      image.data[index + 3] = 255;
    }
  }
  context.putImageData(image, 0, 0);
  return canvas;
}

/** A digit's place on the sheet: `across` 0 to 1 round it (0.5 the middle of its back), `along` 0 at the root to 1 at the tip. */
const handDigitAt = (across, along) => [HAND_SHEET.digit[0] + (HAND_SHEET.digit[1] - HAND_SHEET.digit[0]) * across, along];

function drawSkinSheet(size) {
  const grey = Math.round(HAND_MAPS.neutral * 255);
  const [height, h] = handCanvas(size, '#808080');
  const [tint, t] = handCanvas(size, `rgb(${grey},${grey},${grey})`);
  const [rough, r] = handCanvas(size, `rgb(0,${Math.round(HAND_MAPS.rough.skin * 255)},0)`);
  const random = handRandom(11);
  const [W, H] = size;
  const [palm0, palm1] = HAND_SHEET.palm;
  // The palm: paler and pinker than the back, and a little smoother.
  t.fillStyle = 'rgb(236,214,206)';
  t.fillRect(palm0 * W, 0, (palm1 - palm0) * W, H);
  r.fillStyle = `rgb(0,${Math.round(HAND_MAPS.rough.palm * 255)},0)`;
  r.fillRect(palm0 * W, 0, (palm1 - palm0) * W, H);
  // (The inner side of a digit is the palm's skin: the strip's two edges.)
  const [d0, d1] = HAND_SHEET.digit;
  for (const [from, to] of [[0, 0.24], [0.76, 1]]) {
    const fade = t.createLinearGradient((d0 + (d1 - d0) * from) * W, 0, (d0 + (d1 - d0) * to) * W, 0);
    fade.addColorStop(from === 0 ? 0 : 1, 'rgba(236,214,206,1)');
    fade.addColorStop(from === 0 ? 1 : 0, 'rgba(236,214,206,0)');
    t.fillStyle = fade;
    t.fillRect((d0 + (d1 - d0) * from) * W, 0, (d1 - d0) * (to - from) * W, H);
  }
  // Fine grain everywhere: the skin's own.
  for (let count = 0; count < 5200; count += 1) {
    const x = random() * W;
    const y = random() * H;
    const shade = random() > 0.5 ? 255 : 0;
    h.fillStyle = `rgba(${shade},${shade},${shade},0.05)`;
    h.fillRect(x, y, 1 + random() * 2, 1 + random() * 1.5);
  }
  // The back of the hand: the tendons from the wrist to each knuckle, the veins between and across them.
  HAND_KNUCKLES.forEach((w, index) => {
    const from = handSheetAt('back', 0.12, w * 0.3 - 0.01);
    const middle = handSheetAt('back', 0.55, w * 0.74);
    const to = handSheetAt('back', 0.93, w);
    handStroke(h, handCurve([from, middle, to]), 12, 0.2, size);
    // The knuckle: a few wrinkles across it, the skin a little redder and darker there.
    const [kx, ky] = handSheetAt('back', 1.0, w);
    handSpot(t, [kx, ky], [0.03, 0.05], 'rgba(176,128,122,0.4)', size);
    for (const [dy, spread, depth] of [[-0.03, 0.02, -0.5], [-0.012, 0.024, -0.7], [0.008, 0.024, -0.7], [0.026, 0.02, -0.5]]) {
      const bow = index < 2 ? 0.004 : -0.002;
      handStroke(h, handCurve([[kx - spread, ky + dy - bow], [kx, ky + dy + bow * 1.5], [kx + spread, ky + dy - bow]], 8), 2.2, depth, size);
    }
  });
  for (const run of [[[0.18, -0.13], [0.36, -0.1], [0.58, -0.03], [0.78, -0.012]], [[0.5, -0.09], [0.66, -0.115], [0.84, -0.115]], [[0.2, 0.05], [0.4, 0.085], [0.62, 0.09], [0.8, 0.095]], [[0.4, 0.085], [0.5, 0.02], [0.58, -0.03]]]) {
    const path = handCurve(run.map(([s, w]) => handSheetAt('back', s, w)));
    handStroke(h, path, 8, 0.12, size);
    t.globalCompositeOperation = 'multiply';
    t.strokeStyle = 'rgba(214,222,232,0.22)';
    t.lineWidth = 5;
    t.beginPath();
    path.forEach(([x, y], index) => (index ? t.lineTo(x * W, (1 - y) * H) : t.moveTo(x * W, (1 - y) * H)));
    t.stroke();
    t.globalCompositeOperation = 'source-over';
  }
  // The wrist's folds, back and front.
  for (const surface of ['back', 'palm']) {
    for (const [s, depth] of [[0.0, -0.5], [0.045, -0.35]]) handStroke(h, handCurve([-0.13, -0.05, 0.05, 0.13].map((w, index) => handSheetAt(surface, s + (index % 2) * 0.008, w))), 2.4, surface === 'palm' ? depth * 1.3 : depth * 0.6, size);
  }
  // The palm's creases: the one round the ball of the thumb, the two across under the fingers.
  const creases = [
    [[0.02, -0.01], [0.2, 0.015], [0.42, 0.06], [0.62, 0.13], [0.74, 0.19]],
    [[0.7, 0.19], [0.66, 0.1], [0.6, 0.0], [0.52, -0.1], [0.46, -0.16]],
    [[0.74, -0.2], [0.78, -0.1], [0.82, 0.0], [0.89, 0.07], [0.97, 0.1]],
  ];
  for (const crease of creases) {
    const path = handCurve(crease.map(([s, w]) => handSheetAt('palm', s, w)));
    handStroke(h, path, 3.4, -0.95, size);
    handStroke(t, path, 2.4, -0.16, size);
  }
  // (Lesser lines: down the middle of the palm and under each finger.)
  handStroke(h, handCurve([[0.12, -0.02], [0.4, -0.015], [0.7, 0.02]].map(([s, w]) => handSheetAt('palm', s, w))), 2, -0.35, size);
  for (const w of HAND_KNUCKLES) handStroke(h, handCurve([[1.04, w - 0.035], [1.06, w], [1.04, w + 0.035]].map(([s, x]) => handSheetAt('palm', s, x)), 6), 2.4, -0.7, size);
  // The pads: a little redder.
  for (const [s, w, size2] of [[0.22, 0.1, 0.05], [0.18, -0.11, 0.04], [0.93, 0.1, 0.03], [0.93, 0.0, 0.03], [0.92, -0.1, 0.03], [0.9, -0.17, 0.025]]) handSpot(t, handSheetAt('palm', s, w), [size2, size2 * 1.6], 'rgba(214,160,150,0.5)', size);

  // A digit, unrolled. Its back: the folds over the middle joint (an oval of wrinkles), the lines over the end joint, the nail.
  const joint = (along, lines, halfWide, tall) => {
    handSpot(t, handDigitAt(0.5, along), [0.03, tall * 1.3], 'rgba(170,124,118,0.4)', size);
    for (let line = 0; line < lines; line += 1) {
      const offset = (line / (lines - 1) - 0.5) * 2;
      const y = along + offset * tall;
      const wide = halfWide * Math.sqrt(Math.max(0.15, 1 - offset * offset * 0.75));
      const bow = offset * tall * 0.5;
      handStroke(h, handCurve([handDigitAt(0.5 - wide, y - bow), handDigitAt(0.5, y + bow * 0.4), handDigitAt(0.5 + wide, y - bow)], 8), 2, -0.75, size);
    }
  };
  joint(0.02, 3, 0.2, 0.02);
  joint(1 / 3, 5, 0.19, 0.032);
  joint(2 / 3, 3, 0.16, 0.014);
  // The nail: a smooth plate set in a fold of skin, paler and pinker, its free edge whiter, and glossier than the skin.
  const nail = { from: 0.775, to: 0.965, half: 0.135 };
  const nailPath = (context) => {
    const [x0, y0] = handDigitAt(0.5 - nail.half, nail.from);
    const [x1, y1] = handDigitAt(0.5 + nail.half, nail.to);
    const [px, py, pw, ph] = [x0 * W, (1 - y1) * H, (x1 - x0) * W, (y1 - y0) * H];
    const round = pw * 0.42;
    context.beginPath();
    context.moveTo(px, py + ph * 0.25);
    context.quadraticCurveTo(px, py, px + pw / 2, py);
    context.quadraticCurveTo(px + pw, py, px + pw, py + ph * 0.25);
    context.lineTo(px + pw, py + ph - round);
    context.quadraticCurveTo(px + pw, py + ph, px + pw / 2, py + ph);
    context.quadraticCurveTo(px, py + ph, px, py + ph - round);
    context.closePath();
  };
  nailPath(h);
  h.fillStyle = 'rgba(255,255,255,0.22)';
  h.fill();
  h.lineWidth = 2.2;
  h.strokeStyle = 'rgba(0,0,0,0.5)';
  h.stroke();
  nailPath(t);
  t.fillStyle = 'rgb(232,196,190)';
  t.fill();
  t.save();
  nailPath(t);
  t.clip();
  // (The free edge, and the pale moon at its root.)
  const [nx, ny] = handDigitAt(0.5, nail.to);
  t.fillStyle = 'rgba(244,238,228,0.9)';
  t.fillRect((nx - 0.05) * W, (1 - ny) * H, 0.1 * W, 0.02 * H);
  handSpot(t, handDigitAt(0.5, nail.from + 0.005), [0.022, 0.022], 'rgba(246,232,226,0.8)', size);
  t.restore();
  nailPath(r);
  r.fillStyle = `rgb(0,${Math.round(HAND_MAPS.rough.nail * 255)},0)`;
  r.fill();
  // Its inner side: the creases under the joints (the middle one double), the pads between.
  for (const [along, depth] of [[0.045, -0.9], [0.32, -0.9], [0.345, -0.6], [0.668, -0.85]]) {
    for (const [from, to] of [[0, 0.2], [0.8, 1]]) handStroke(h, [handDigitAt(from, along), handDigitAt(to, along)], 2.4, depth, size);
    for (const [from, to] of [[0, 0.16], [0.84, 1]]) handStroke(t, [handDigitAt(from, along), handDigitAt(to, along)], 2, -0.14, size);
  }
  return { height, tint, rough };
}

function drawGloveSheet(size) {
  const grey = Math.round(HAND_MAPS.neutral * 255);
  const [height, h] = handCanvas(size, '#808080');
  const [tint, t] = handCanvas(size, `rgb(${grey},${grey},${grey})`);
  const [rough, r] = handCanvas(size, `rgb(0,${Math.round(HAND_MAPS.rough.glove * 255)},0)`);
  const random = handRandom(23);
  const [W, H] = size;
  // The leather's grain.
  for (let count = 0; count < 9000; count += 1) {
    const shade = random() > 0.5 ? 255 : 0;
    h.fillStyle = `rgba(${shade},${shade},${shade},0.07)`;
    h.fillRect(random() * W, random() * H, 1 + random() * 1.5, 1 + random() * 1.5);
  }
  const seam = (path) => {
    handStroke(h, path, 3, -0.8, size);
    handStroke(t, path, 2, -0.3, size);
    // (Its stitches: a raised dotted line beside it.)
    for (let index = 0; index + 1 < path.length; index += 1) {
      for (const share of [0.25, 0.75]) {
        const x = path[index][0] + (path[index + 1][0] - path[index][0]) * share;
        const y = path[index][1] + (path[index + 1][1] - path[index][1]) * share;
        handSpot(h, [x + 2.2 / W, y], [1.6 / W, 1.6 / H], 'rgba(255,255,255,0.5)', size);
      }
    }
  };
  // The three points stitched down the back from the knuckles, and the seam round the edge of the hand.
  for (const w of [HAND_KNUCKLES[0] * 0.5 + HAND_KNUCKLES[1] * 0.5, HAND_KNUCKLES[1] * 0.5 + HAND_KNUCKLES[2] * 0.5, HAND_KNUCKLES[2] * 0.5 + HAND_KNUCKLES[3] * 0.5]) {
    seam(handCurve([[0.94, w], [0.7, w * 0.86], [0.45, w * 0.72]].map(([s, x]) => handSheetAt('back', s, x)), 14));
  }
  for (const surface of ['back', 'palm']) {
    // The wrist's gathering, and soft folds across the knuckles.
    seam(handCurve([-0.14, -0.05, 0.05, 0.14].map((w) => handSheetAt(surface, 0.03, w)), 12));
    for (const s of [0.96, 1.01]) handStroke(h, handCurve([-0.17, -0.06, 0.04, 0.15].map((w) => handSheetAt(surface, s, w)), 12), 4, -0.3, size);
  }
  // The thumb's piece set into the palm.
  seam(handCurve([[0.08, 0.0], [0.3, 0.02], [0.5, 0.09], [0.62, 0.19]].map(([s, w]) => handSheetAt('palm', s, w)), 16));
  // A digit: the fourchettes' seams down both sides, folds at the joints front and back.
  for (const across of [0.25, 0.75]) seam(handCurve([handDigitAt(across, 0.02), handDigitAt(across, 0.5), handDigitAt(across, 0.93)], 14));
  for (const along of [1 / 3, 2 / 3]) {
    for (const offset of [-0.018, 0, 0.018]) handStroke(h, [handDigitAt(0.3, along + offset), handDigitAt(0.7, along + offset)], 3, -0.3, size);
    for (const [from, to] of [[0, 0.2], [0.8, 1]]) handStroke(h, [handDigitAt(from, along), handDigitAt(to, along)], 3, -0.5, size);
  }
  void r;
  return { height, tint, rough };
}

/**
 * A sheet's textures: { map, normalMap, roughnessMap, bytes }, made once and shared. `kind`: 'skin' or 'glove'. (The tint is a
 * share of the material's own colour, as the body's skin maps are: read as it stands, not as a painted colour.)
 */
export function handSheet(kind = 'skin') {
  let sheet = handSheets.get(kind);
  if (sheet) return sheet;
  const drawn = kind === 'glove' ? drawGloveSheet(HAND_MAPS.size) : drawSkinSheet(HAND_MAPS.size);
  const texture = (canvas) => {
    const made = new THREE.CanvasTexture(canvas);
    made.anisotropy = 4;
    return made;
  };
  const [W, H] = HAND_MAPS.size;
  sheet = { map: texture(drawn.tint), normalMap: texture(handNormalCanvas(drawn.height, HAND_MAPS.relief[kind] ?? 2)), roughnessMap: texture(drawn.rough), bytes: Math.round(3 * W * H * 4 * (4 / 3)) };
  handSheets.set(kind, sheet);
  return sheet;
}
