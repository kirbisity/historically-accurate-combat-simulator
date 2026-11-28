// Makeup on a photo face, as plain data (no three.js: the tests, a save file's reader and a crowd's painter read it as the
// shader's builder does). A face's makeup is a look (one of MAKEUP_LOOKS, fitted by eye to the reference chart of twelve
// modern looks) at a strength, with any of its parts changed: `{ look, strength, parts: { lipColour: '#b0605a', ... } }`.
//
// A look is made of the parts the chart's looks are built from, each a few named numbers (MAKEUP_PARTS): the base
// (foundation: how much it evens the skin, its finish from matte to dewy, how much paler than the skin it is), concealer and
// highlight, contour, blush, eye shadow (a lid colour and a crease colour, how far up it reaches, how smoked its outer edge
// and the lower lid are, its shimmer and its metal), eyeliner and its wing, mascara, brow fill and lip colour (with its
// gloss, the Korean look's gradient and an overline). The shader draws it in atlas space by the atlas's own landmarks
// (photoface.js PHOTO_ATLAS, makeupGLSL there), never by one texture's pixels, so it fits any face's maps and any head.
//
// Colours are given as they would be chosen for a medium skin (skintones.js `medium`) and fitted to the skin they go on
// (makeupColour): a nude lip, a blush or a brown shadow follows the skin's depth (darker and richer on a deep skin, lighter on
// a fair one: what reads as "nude" or "a flush" is set against the skin), a statement colour (a black lip, a gold foil) keeps
// its own. Nobody wears makeup unless their look or their made face says so (the game is historical; the chart's looks are
// modern).

/** The saved form's version (raised when a part's meaning changes). */
export const MAKEUP_VERSION = 1;

/**
 * The parts and their numbers: each [min, max] (the range a saved number is held to), colours as '#rrggbb'. `adapt`: how far
 * a part's colour follows the skin's depth (0 keeps the colour as given, 1 follows it fully), as a pigment of that kind is
 * chosen in life: blush and nude lips by the skin, shadow browns most of the way, liner never.
 */
export const MAKEUP_PARTS = {
  base: { cover: [0, 1], finish: [-1, 1], pale: [0, 1] },
  conceal: { under: [0, 1], highlight: [0, 1] },
  contour: { amount: [0, 1] },
  blush: { colour: 'colour', amount: [0, 1], row: [0.45, 0.65], out: [0.04, 0.16], size: [0.02, 0.08], lift: [0, 1] },
  shadow: { colour: 'colour', crease: 'colour', amount: [0, 1], reach: [0, 1], smoke: [0, 1], lower: [0, 1], shimmer: [0, 1], metal: [0, 1] },
  liner: { amount: [0, 1], wing: [0, 1], lower: [0, 1] },
  lashes: { amount: [0, 1] },
  brow: { fill: [0, 1] },
  lip: { colour: 'colour', amount: [0, 1], gloss: [-1, 1], gradient: [0, 1], over: [0, 1] },
};

export const MAKEUP_COLOUR = {
  // How far each colour follows the skin's depth (see MAKEUP_PARTS). Blush and lip are picked against the skin; a shadow's
  // browns mostly; a crease colour a little less (it is the dark that gives the eye its depth on any skin).
  adapt: { blush: 1, lip: 0.85, shadow: 0.7, crease: 0.55, contour: 1 },
  // The skin the colours are given for (skintones.js medium), by its relative luminance.
  referenceSkin: '#c58c64',
  // A colour follows the skin most when it is a nude, near the skin's own depth and colourfulness (HSL lightness and
  // saturation), and not at all when it is far darker or lighter (a black lip, a white liner) or far more vivid (a coral, a
  // fuchsia: a statement colour is worn as itself on any skin, a little deeper on a deep one): the follow falls off with
  // each gap as a bump this wide.
  nudeWidth: 0.3,
  vividWidth: 0.35,
  // The ratio of the skin's depth to the reference's, held within these (a ghost-white or a near-black skin should not drag a
  // colour to white or to black).
  ratio: [0.25, 1.5],
  // How strongly a colour follows the depth ratio at a full follow (an exponent on it): a nude on a deep skin is as deep
  // against it as the reference's nude is against the reference (1); on a fair skin less (a pale face's nude is not paled to
  // a pastel: fair skin shows a colour more, so it is chosen less light than the skin's own step).
  deeper: 1,
  fairer: 0.25,
  // A pigment that reads on a deep skin is richer: saturation raised by this share for a skin as far below the reference as
  // the reference is from black (lowered for a fairer one by the same rule, half as much).
  richer: 0.2,
  // Liner and mascara: a brown-black, the same on every skin.
  liner: '#140f10',
  // Contour: the skin's own colour, deeper and a little cooler (a shadow, not a brown stripe).
  contourDepth: 0.72,
  contourCool: 0.06,
  // Highlight: the skin lighter and a little warmer (light on it, not white paint).
  highlightLift: 1.28,
  // The goth look's pale base: the skin lightened towards this pale, cool ivory by `base.pale` (on a deep skin it stays a
  // lighter version of itself: the chart's white on a fair skin, a grey-ivory cast on a deep one, kept short of chalk).
  pale: '#efe6e4',
  paleMost: 0.8,
};

const MAKEUP_NONE_PARTS = {
  base: { cover: 0, finish: 0, pale: 0 },
  conceal: { under: 0, highlight: 0 },
  contour: { amount: 0 },
  blush: { colour: '#d47a72', amount: 0, row: 0.555, out: 0.098, size: 0.04, lift: 0.25 },
  shadow: { colour: '#b88c7c', crease: '#5a3a30', amount: 0, reach: 0.4, smoke: 0.3, lower: 0, shimmer: 0, metal: 0 },
  liner: { amount: 0, wing: 0, lower: 0 },
  lashes: { amount: 0 },
  brow: { fill: 0 },
  lip: { colour: '#b8706a', amount: 0, gloss: 0, gradient: 0, over: 0 },
};

/** A look: its labels and its parts over the bare face's (only what it changes is listed). */
const mkLook = (label, labelZh, parts) => {
  const out = {};
  for (const [part, values] of Object.entries(MAKEUP_NONE_PARTS)) out[part] = { ...values, ...(parts[part] ?? {}) };
  return { label, labelZh, parts: out };
};

/**
 * The looks, in the chart's order (fitted by eye to its crops: reference-images/portraits/makeup-styles/), and "none". Each
 * part's numbers say what the chart's face shows: how even and how shiny the skin, where the blush sits, how far the shadow
 * reaches and how smoked it is, how heavy the liner and its wing, and the lip's colour and finish.
 */
export const MAKEUP_LOOKS = {
  none: mkLook('None', '无妆', {}),
  // Bare skin with its freckles showing, a groomed brow, a tinted balm.
  natural: mkLook('Natural', '素颜妆', {
    base: { cover: 0.15 }, conceal: { under: 0.15 }, brow: { fill: 0.15 }, lashes: { amount: 0.2 },
    lip: { colour: '#c28076', amount: 0.25, gloss: 0.25 },
  }),
  // Warm brown smoked at the outer corner and under the lower lashes, a champagne lid, bronzed cheeks, a satin nude-brown lip.
  softGlam: mkLook('Soft glam', '柔和妆', {
    base: { cover: 0.55, finish: 0.1 }, conceal: { under: 0.4, highlight: 0.3 }, contour: { amount: 0.45 },
    blush: { colour: '#c0705a', amount: 0.35, row: 0.56, out: 0.1 },
    shadow: { colour: '#caa08e', crease: '#5a3022', amount: 0.8, reach: 0.5, smoke: 0.8, lower: 0.45, shimmer: 0.5 },
    liner: { amount: 0.5, wing: 0.2, lower: 0.3 }, lashes: { amount: 0.7 }, brow: { fill: 0.5 },
    lip: { colour: '#a86a5a', amount: 0.75, gloss: -0.1, over: 0.1 },
  }),
  // A rose-gold lid under a deep plum-brown crease, a long winged liner, heavy lashes, sculpted cheeks, a matte mauve-brown lip.
  fullGlam: mkLook('Full glam', '全妆', {
    base: { cover: 0.85, finish: -0.3 }, conceal: { under: 0.6, highlight: 0.5 }, contour: { amount: 0.8 },
    blush: { colour: '#b86a5a', amount: 0.3 },
    shadow: { colour: '#d9a892', crease: '#3a1c1a', amount: 0.9, reach: 0.65, smoke: 0.8, lower: 0.55, shimmer: 0.7, metal: 0.15 },
    liner: { amount: 0.95, wing: 0.9, lower: 0.45 }, lashes: { amount: 1 }, brow: { fill: 0.85 },
    lip: { colour: '#8a5a58', amount: 0.95, gloss: -0.6, over: 0.35 },
  }),
  // Glass skin: a wet sheen on the cheekbones, nose and brow, a sheer flush, a hint of shimmer on the lid, a glossy pink lip.
  dewy: mkLook('Dewy', '水光妆', {
    base: { cover: 0.35, finish: 1 }, conceal: { under: 0.3, highlight: 0.7 }, contour: { amount: 0.1 },
    blush: { colour: '#d88a80', amount: 0.25 },
    shadow: { colour: '#cfa694', amount: 0.25, reach: 0.3, smoke: 0, shimmer: 0.6 },
    lashes: { amount: 0.4 }, brow: { fill: 0.25 },
    lip: { colour: '#c88078', amount: 0.45, gloss: 1 },
  }),
  // Flat, powdered skin, a soft brown smoke, strong brows, a matte berry-mauve lip.
  matte: mkLook('Matte', '哑光妆', {
    base: { cover: 0.8, finish: -1 }, conceal: { under: 0.4 }, contour: { amount: 0.6 },
    blush: { colour: '#a85e50', amount: 0.25 },
    shadow: { colour: '#7a4c38', crease: '#3e2418', amount: 0.75, reach: 0.55, smoke: 0.6, lower: 0.4 },
    liner: { amount: 0.4, wing: 0.15 }, lashes: { amount: 0.7 }, brow: { fill: 0.9 },
    lip: { colour: '#7e4048', amount: 0.95, gloss: -1 },
  }),
  // Bright, luminous skin, a round pink flush high under the eyes, a peach-pink lower lid, a fine liner, a gradient coral lip.
  korean: mkLook('Korean', '韩系妆', {
    base: { cover: 0.7, finish: 0.5, pale: 0.15 }, conceal: { under: 0.35, highlight: 0.4 }, contour: { amount: 0.05 },
    blush: { colour: '#ef8a96', amount: 0.85, row: 0.54, out: 0.078, size: 0.05, lift: 0 },
    shadow: { colour: '#e2a294', crease: '#c27c72', amount: 0.4, reach: 0.25, smoke: 0.1, lower: 0.45, shimmer: 0.3 },
    liner: { amount: 0.4, wing: 0.35 }, lashes: { amount: 0.5 }, brow: { fill: 0.3 },
    lip: { colour: '#e04a4a', amount: 0.95, gloss: 0.3, gradient: 0.9 },
  }),
  // Glowing skin, brushed-up full brows, a rosy flush swept up to the temple, bare lids, a glossy pink-nude lip.
  cleanGirl: mkLook('Clean girl', '清透妆', {
    base: { cover: 0.4, finish: 0.7 }, conceal: { under: 0.3, highlight: 0.55 }, contour: { amount: 0.25 },
    blush: { colour: '#d4706a', amount: 0.45, row: 0.545, out: 0.11, lift: 0.5 },
    shadow: { colour: '#b88a78', amount: 0.15, shimmer: 0.2 },
    lashes: { amount: 0.5 }, brow: { fill: 1 },
    lip: { colour: '#c27a72', amount: 0.5, gloss: 0.85 },
  }),
  // Quiet polish: a taupe lid, a fine liner, soft contour, a peach-nude satin lip.
  oldMoney: mkLook('Old money', '老钱风', {
    base: { cover: 0.6 }, conceal: { under: 0.4, highlight: 0.25 }, contour: { amount: 0.35 },
    blush: { colour: '#c07a6a', amount: 0.25 },
    shadow: { colour: '#9a7a6a', crease: '#54382e', amount: 0.65, reach: 0.4, smoke: 0.5, lower: 0.15 },
    liner: { amount: 0.45, wing: 0.25 }, lashes: { amount: 0.6 }, brow: { fill: 0.6 },
    lip: { colour: '#b87868', amount: 0.7 },
  }),
  // A rose-gold shimmer lid under a mauve crease, lashes, a strong pink blush and highlight, a rose-pink lip.
  bridal: mkLook('Bridal', '新娘妆', {
    base: { cover: 0.75, finish: 0.3 }, conceal: { under: 0.5, highlight: 0.6 }, contour: { amount: 0.45 },
    blush: { colour: '#d8707a', amount: 0.6 },
    shadow: { colour: '#cc9484', crease: '#6a3a40', amount: 0.7, reach: 0.5, smoke: 0.55, lower: 0.35, shimmer: 0.75, metal: 0.1 },
    liner: { amount: 0.6, wing: 0.4, lower: 0.3 }, lashes: { amount: 0.9 }, brow: { fill: 0.7 },
    lip: { colour: '#c0606a', amount: 0.85, gloss: 0.2 },
  }),
  // Charcoal smoked all round the eye, over the lid and under the lower lashes, lined in black, a nude lip.
  smokeyEye: mkLook('Smokey eye', '烟熏妆', {
    base: { cover: 0.6 }, conceal: { under: 0.3, highlight: 0.2 }, contour: { amount: 0.5 },
    blush: { colour: '#a86a58', amount: 0.15 },
    shadow: { colour: '#2c2828', crease: '#121012', amount: 0.95, reach: 0.7, smoke: 1, lower: 0.9, shimmer: 0.25 },
    liner: { amount: 0.8, wing: 0.2, lower: 0.9 }, lashes: { amount: 0.9 }, brow: { fill: 0.75 },
    lip: { colour: '#a87060', amount: 0.6 },
  }),
  // Gold and silver foil over the lid and out under the eye, glitter on the cheek, a wet highlight, a glossy nude lip.
  editorial: mkLook('Editorial', '创意妆', {
    base: { cover: 0.5, finish: 0.9 }, conceal: { under: 0.3, highlight: 0.8 }, contour: { amount: 0.3 },
    blush: { colour: '#c08070', amount: 0.1 },
    shadow: { colour: '#d8b060', crease: '#cfd0d6', amount: 1, reach: 0.6, smoke: 0.6, lower: 0.5, shimmer: 1, metal: 1 },
    liner: { amount: 0.2 }, lashes: { amount: 0.6 }, brow: { fill: 0.5 },
    lip: { colour: '#c08672', amount: 0.5, gloss: 1 },
  }),
  // A pale base, charcoal smoke all round the eye lined in black, dark brows, a black lip.
  goth: mkLook('Goth', '哥特妆', {
    base: { cover: 0.9, finish: -0.5, pale: 1 }, contour: { amount: 0.35 },
    shadow: { colour: '#2a2428', crease: '#0e0c10', amount: 0.95, reach: 0.7, smoke: 0.95, lower: 0.95 },
    liner: { amount: 0.9, wing: 0.35, lower: 0.9 }, lashes: { amount: 0.9 }, brow: { fill: 0.9 },
    lip: { colour: '#140e12', amount: 1, gloss: 0.2 },
  }),
};

/** The looks' ids in the picker's order (none first, then the chart's). */
export const MAKEUP_LOOK_ORDER = Object.keys(MAKEUP_LOOKS);

/**
 * The parts the customizer shows and saves as overrides, by a flat id: part.number (e.g. 'lip.colour', 'blush.amount'). The
 * main ones (the request's: lip colour, shadow colour, blush, liner, base finish) are what the screen offers; any part's
 * number may be saved.
 */
export const MAKEUP_SCREEN_PARTS = ['lip.colour', 'shadow.colour', 'blush.colour', 'blush.amount', 'liner.amount', 'liner.wing', 'base.finish'];

const mkClamp = (value, [min, max]) => Math.min(max, Math.max(min, value));
const mkHex = (value) => (typeof value === 'string' && /^#?[0-9a-f]{6}$/i.test(value.trim()) ? `#${value.trim().replace('#', '').toLowerCase()}` : null);
const mkRound = (value) => Math.round(value * 1000) / 1000;

/** A part's number or colour, held to its range (null for one that is no such thing). */
function mkPartValue(id, value) {
  const [part, number] = String(id).split('.');
  const range = MAKEUP_PARTS[part]?.[number];
  if (!range) return null;
  if (range === 'colour') return mkHex(value);
  const numeric = Number(value);
  return Number.isFinite(numeric) ? mkRound(mkClamp(numeric, range)) : null;
}

/**
 * The drawn heads' older makeup (face.js: `{ eyes: 'smoky', liner: 'winged', lowerLash: 'heavy', lips: colour }`, the
 * gothic gowns' outfits) as this form: smoky eyes the smokey look, its liner and lip kept, so an outfit made up for the drawn
 * head is made up on a photo head too.
 */
function mkFromDrawn(drawn) {
  const parts = {};
  if (drawn.liner === 'winged') parts['liner.wing'] = 0.6;
  if (drawn.lowerLash === 'heavy') parts['liner.lower'] = 0.9;
  const lips = typeof drawn.lips === 'number' ? `#${drawn.lips.toString(16).padStart(6, '0')}` : mkHex(drawn.lips);
  if (lips) Object.assign(parts, { 'lip.colour': lips, 'lip.amount': 1 });
  return { version: MAKEUP_VERSION, look: drawn.eyes === 'smoky' ? 'smokeyEye' : 'natural', strength: 1, parts };
}

/** No makeup. */
export const noMakeup = () => ({ version: MAKEUP_VERSION, look: 'none', strength: 1, parts: {} });

/**
 * A clean makeup from whatever was saved or handed in: a known look (else none), a strength in 0..1 (1 when not given), the
 * changed parts that are real parts, each held to its range. A look id alone ('korean') is that look; the drawn heads' older
 * form is read as mkFromDrawn says; anything else is none.
 */
export function normalizeMakeup(input) {
  if (typeof input === 'string') return MAKEUP_LOOKS[input] ? { ...noMakeup(), look: input } : noMakeup();
  if (!input || typeof input !== 'object' || Array.isArray(input)) return noMakeup();
  if (!('look' in input) && ('eyes' in input || 'lips' in input || 'liner' in input)) return mkFromDrawn(input);
  const look = MAKEUP_LOOKS[input.look] ? input.look : 'none';
  const strength = Number.isFinite(Number(input.strength)) && input.strength !== null ? mkRound(mkClamp(Number(input.strength), [0, 1])) : 1;
  const parts = {};
  const given = input.parts && typeof input.parts === 'object' ? input.parts : {};
  for (const [id, value] of Object.entries(given)) {
    const held = mkPartValue(id, value);
    if (held !== null) parts[id] = held;
  }
  return { version: MAKEUP_VERSION, look, strength, parts };
}

/** Whether a makeup draws anything (a look other than none at some strength, or a part changed on none). */
export function makeupWorn(input) {
  const makeup = normalizeMakeup(input);
  return makeup.strength > 0 && (makeup.look !== 'none' || Object.keys(makeup.parts).length > 0);
}

/** A makeup with one part changed (a new object), or its look or strength (`id` 'look' or 'strength'). */
export function withMakeupPart(input, id, value) {
  const makeup = normalizeMakeup(input);
  if (id === 'look') return normalizeMakeup({ ...makeup, look: value, parts: {} });
  if (id === 'strength') return normalizeMakeup({ ...makeup, strength: value });
  const held = mkPartValue(id, value);
  if (held === null) return makeup;
  return { ...makeup, parts: { ...makeup.parts, [id]: held } };
}

/** A part's value in a makeup: its change if changed, else its look's. */
export function makeupPart(input, id) {
  const makeup = normalizeMakeup(input);
  if (id in makeup.parts) return makeup.parts[id];
  const [part, number] = id.split('.');
  return MAKEUP_LOOKS[makeup.look].parts[part]?.[number];
}

/**
 * The parts to draw: the look's, the changes over them, every amount scaled by the strength (colours, places and sizes kept;
 * a finish's sheen or matte scaled too, as a thinner layer of a product shows less of it). `{ part: { number } }`.
 */
export function resolveMakeup(input) {
  const makeup = normalizeMakeup(input);
  const parts = JSON.parse(JSON.stringify(MAKEUP_LOOKS[makeup.look].parts));
  for (const [id, value] of Object.entries(makeup.parts)) {
    const [part, number] = id.split('.');
    parts[part][number] = value;
  }
  const kept = new Set(['colour', 'crease', 'row', 'out', 'size', 'lift', 'reach', 'smoke', 'wing', 'gradient']);
  for (const [part, numbers] of Object.entries(parts)) {
    for (const number of Object.keys(numbers)) if (!kept.has(number)) parts[part][number] = mkRound(numbers[number] * makeup.strength);
  }
  return parts;
}

// ---- Colour against the skin ----------------------------------------------------------------------------------------------

/** '#rrggbb' as [r, g, b] in 0..1, and back. */
export const mkRgb = (hex) => {
  const clean = mkHex(hex) ?? '#000000';
  return [1, 3, 5].map((at) => parseInt(clean.slice(at, at + 2), 16) / 255);
};
export const mkHexOf = (rgb) => `#${rgb.map((value) => Math.round(Math.min(1, Math.max(0, value)) * 255).toString(16).padStart(2, '0')).join('')}`;
/** Relative luminance of [r, g, b] (the hex's own values, as the game's colours are used). */
export const mkLuminance = ([r, g, b]) => 0.2126 * r + 0.7152 * g + 0.0722 * b;

function mkToHsl([r, g, b]) {
  const top = Math.max(r, g, b);
  const low = Math.min(r, g, b);
  const l = (top + low) / 2;
  if (top === low) return [0, 0, l];
  const d = top - low;
  const s = l > 0.5 ? d / (2 - top - low) : d / (top + low);
  const h = top === r ? (g - b) / d + (g < b ? 6 : 0) : top === g ? (b - r) / d + 2 : (r - g) / d + 4;
  return [h / 6, s, l];
}
function mkFromHsl([h, s, l]) {
  if (s === 0) return [l, l, l];
  const q = l < 0.5 ? l * (1 + s) : l + s - l * s;
  const p = 2 * l - q;
  const channel = (t) => {
    const k = ((t % 1) + 1) % 1;
    if (k < 1 / 6) return p + (q - p) * 6 * k;
    if (k < 1 / 2) return q;
    if (k < 2 / 3) return p + (q - p) * (2 / 3 - k) * 6;
    return p;
  };
  return [channel(h + 1 / 3), channel(h), channel(h - 1 / 3)];
}

/**
 * A makeup colour fitted to a skin: `hex` as chosen for the reference skin, `adapt` how far its kind follows the skin
 * (MAKEUP_COLOUR.adapt), `skin` the skin it goes on ('#rrggbb'). It is made deeper or lighter as a whole (its channels in proportion) by the
 * skin's luminance against the reference's, as far as `adapt` and its nearness to a nude allow; its saturation is raised on a
 * deeper skin (MAKEUP_COLOUR.richer). [r, g, b] in 0..1.
 */
export function makeupColour(hex, adapt, skin) {
  const C = MAKEUP_COLOUR;
  const rgb = mkRgb(hex);
  const [, referenceS, referenceL] = mkToHsl(mkRgb(C.referenceSkin));
  const [, ownS, ownL] = mkToHsl(rgb);
  const ratio = mkClamp(mkLuminance(mkRgb(skin)) / mkLuminance(mkRgb(C.referenceSkin)), C.ratio);
  const follow = adapt * Math.exp(-(((ownL - referenceL) / C.nudeWidth) ** 2)) * Math.exp(-((Math.max(0, ownS - referenceS) / C.vividWidth) ** 2));
  // (Scaled as a whole, its channels in proportion: a pink made deeper is a berry, not a vivid red, as HSL's lightness would.)
  const scale = ratio ** (follow * (ratio < 1 ? C.deeper : C.fairer));
  const [h, s, l] = mkToHsl(rgb.map((value) => value * scale));
  const deeper = 1 - ratio;
  const saturation = mkClamp(s * (1 + C.richer * follow * (deeper > 0 ? deeper : deeper * 0.5)), [0, 1]);
  return mkFromHsl([h, saturation, mkClamp(l, [0, 1])]).map((value) => mkClamp(value, [0, 1]));
}

/**
 * Everything the shader takes, worked out from a makeup and the skin it goes on: the colours in the atlas's terms (a
 * colour over the skin, scaled so the atlas's `neutral` grey is the skin: what the photo maps hold, photoface.js), the
 * numbers flat. `{ colours: { name: [r, g, b] }, numbers: { name: n }, worn }`. Plain numbers: the shader's builder copies
 * them into its uniforms; a test reads them here.
 */
export function makeupValues(input, skin, neutral = 0.45) {
  const parts = resolveMakeup(input);
  const C = MAKEUP_COLOUR;
  const skinRgb = mkRgb(skin).map((value) => Math.max(value, 0.02));
  const relative = (rgb) => rgb.map((value, channel) => (value * neutral) / skinRgb[channel]);
  const fit = (hex, kind) => relative(makeupColour(hex, C.adapt[kind] ?? 0, skin));
  const deep = mkRgb(skin).map((value, channel) => value * C.contourDepth * (1 + (channel === 2 ? C.contourCool : channel === 0 ? -C.contourCool : 0)));
  const paleFull = mkRgb(C.pale).map((value, channel) => skinRgb[channel] + (value - skinRgb[channel]) * C.paleMost);
  const pale = relative(paleFull);
  return {
    worn: makeupWorn(input),
    colours: {
      blush: fit(parts.blush.colour, 'blush'),
      // (A metal keeps its colour on every skin: gold is gold.)
      shadow: relative(makeupColour(parts.shadow.colour, C.adapt.shadow * (1 - parts.shadow.metal), skin)),
      crease: relative(makeupColour(parts.shadow.crease, C.adapt.crease * (1 - parts.shadow.metal), skin)),
      lip: fit(parts.lip.colour, 'lip'),
      liner: relative(mkRgb(C.liner)),
      contour: relative(deep),
      highlight: [neutral * C.highlightLift * 1.02, neutral * C.highlightLift, neutral * C.highlightLift * 0.97],
      paleBase: pale,
    },
    numbers: {
      cover: parts.base.cover, finish: parts.base.finish, pale: parts.base.pale,
      under: parts.conceal.under, highlight: parts.conceal.highlight, contour: parts.contour.amount,
      blush: parts.blush.amount, blushRow: parts.blush.row, blushOut: parts.blush.out, blushSize: parts.blush.size, blushLift: parts.blush.lift,
      shadow: parts.shadow.amount, reach: parts.shadow.reach, smoke: parts.shadow.smoke, lower: parts.shadow.lower, shimmer: parts.shadow.shimmer, metal: parts.shadow.metal,
      liner: parts.liner.amount, wing: parts.liner.wing, linerLower: parts.liner.lower, lashes: parts.lashes.amount, brow: parts.brow.fill,
      lip: parts.lip.amount, gloss: parts.lip.gloss, gradient: parts.lip.gradient, over: parts.lip.over,
    },
  };
}

/**
 * A crowd's head (painted per vertex, photoface.js paintFromFace): the makeup's broad strokes on one vertex's colour at its
 * atlas place, the blush, the lip, the shadow round the eye and a pale base, no liner, sheen or glitter (a crowd's head is a
 * few dozen pixels). `rgb` the vertex's colour ([r, g, b], the skin's terms: the final colour), `values` makeupValues', `skin`
 * the skin, `atlas` photoface.js PHOTO_ATLAS. Returns the new colour.
 */
export function makeupPaintAt(rgb, u, v, values, skin, atlas, neutral = 0.45) {
  if (!values.worn) return rgb;
  const n = values.numbers;
  const skinRgb = mkRgb(skin);
  const absolute = (relative) => relative.map((value, channel) => (value * skinRgb[channel]) / neutral);
  const side = Math.abs(u - 0.5) * 2;
  const row = 1 - v;
  const bump = (dx, dy, rx, ry) => Math.exp(-((dx / rx) ** 2 + (dy / ry) ** 2));
  const mix = (a, b, t) => a.map((value, channel) => value + (b[channel] - value) * Math.min(1, Math.max(0, t)));
  let out = mix(rgb, absolute(values.colours.paleBase), n.pale * bump(side, row - 0.55, 0.36, 0.3));
  out = mix(out, absolute(values.colours.blush), 0.6 * n.blush * bump(side - n.blushOut * 2, row - n.blushRow, n.blushSize * 3, n.blushSize * 1.6));
  out = mix(out, absolute(values.colours.crease), 0.8 * n.shadow * bump(side - atlas.eyeU * 2, row - atlas.eyeRow, atlas.eyeHalf[0] * 3, atlas.eyeHalf[1] * (2 + 2 * n.reach)));
  out = mix(out, absolute(values.colours.lip), n.lip * bump(side, row - atlas.mouthRow, 0.1, 0.022));
  return out;
}
