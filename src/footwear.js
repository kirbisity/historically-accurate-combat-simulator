// The foot and what is worn on it, as geometry (no materials: wardrobe.js buildFootwear dresses the parts).
//
// One builder for every kind. A foot-shaped last is lofted from cross-sections along a path that runs back from the toes
// over the instep, turns round the heel and goes up into the leg: the heel cup, the waist with its arch on the inner side,
// the ball as the widest point, the toe box. The inner and outer sides differ, so a left and a right are mirrors. A shoe is
// that last grown by its leather's thickness with its own toe, standing on a separate sole (an outline, an edge, a heel
// where it has one); laces, straps, lames, plates and ropes are pieces laid on the last's surface. Each kind is a
// parameter set (FOOTWEAR) over the one builder.
//
// Everything is modelled for a man FOOT_STATURE tall, in metres, and scaled to the wearer where it is drawn. The frame is
// the foot bone's (rig.js): x up from the sole, y along the foot to the toes, z across; here u is along, v up, w towards
// the inner side, the origin the ankle joint.

const FOOT_STATURE = 1.8;

// The bare foot's proportions (the length 0.152 of stature and the ball's breadth 0.38 of the length: Drillis & Contini
// 1966 and the anthropometric surveys after them, ANSUR II's foot length and breadth). The joint stands `ankle` over the
// ground (body.js LENGTH.ankle, the same table) and `ankleAt` of the length ahead of the heel's back.
export const FOOT = { length: 0.15, ballBreadth: 0.38, ankle: 0.039, ankleAt: 0.24 };

const FOOT_LONG = FOOT.length * FOOT_STATURE;
const FOOT_RISE = FOOT.ankle * FOOT_STATURE;
const FOOT_HEEL_U = -FOOT.ankleAt * FOOT_LONG;
const FOOT_TOE_U = FOOT_HEEL_U + FOOT_LONG;
// The ball: the widest section (before the toes' slant: the inner side's joint lies ahead of the outer's).
const FOOT_BALL_U = FOOT_HEEL_U + 0.68 * FOOT_LONG;
const FOOT_HALF_BALL = (FOOT.ballBreadth * FOOT_LONG) / 2;
// The instep's bend into the shin: an arc of this radius, from the instep's own slope (rad off level) up to the shin's.
const FOOT_CREASE = 0.02;
const FOOT_INSTEP_SLOPE = 0.5;
// The top of the foot at the ball: its height over the insole, and its slope there (rising towards the ankle).
const FOOT_BALL_TOP = [0.04, 0.14];
// How far the forefoot's sections lean (m along per m across): the line of the toes' roots, from the big toe back to the little one.
const FOOT_SLANT = 0.22;
// The heel's rounding in plan.
const FOOT_HEEL_ROUND = 0.034;
// The shank's end where no body was measured (ankleFit): the rim's height over the joint, its front and back, its half breadths.
const ANKLE_FIT = { v: 0.012, front: 0.031, back: -0.041, inner: 0.03, outer: 0.03 };
// How a foot's breadth follows its ankle's (the ankle's half breadth over that one's, to this power, within these bounds).
const ANKLE_OVER = 0.0015;
// How far the ankle runs up inside the shank past its end.
const FOOT_STUB = 0.012;
const FOOT_BREADTH = { power: 0.6, least: 0.92, most: 1.3 };

const footClamp = (x) => Math.min(1, Math.max(0, x));
const footLerp = (a, b, t) => a + (b - a) * t;
const footEase = (a, b, x) => {
  const t = footClamp((x - a) / (b - a));
  return t * t * (3 - 2 * t);
};
const footPow = (x, e) => Math.sign(x) * Math.abs(x) ** e;
/** A curve through `keys` ([x, y] rising in x), eased between them. */
function footKeyed(keys, x) {
  if (x <= keys[0][0]) return keys[0][1];
  for (let index = 1; index < keys.length; index += 1) {
    if (x <= keys[index][0]) return footLerp(keys[index - 1][1], keys[index][1], footEase(keys[index - 1][0], keys[index][0], x));
  }
  return keys[keys.length - 1][1];
}
/** A point on the Catmull-Rom curve through `points`, t from 0 to 1 over its whole run. */
function footSpline(points, t) {
  const at = footClamp(t) * (points.length - 1);
  const index = Math.min(points.length - 2, Math.floor(at));
  const f = at - index;
  const p = (k) => points[Math.min(points.length - 1, Math.max(0, k))];
  const [a, b, c, d] = [p(index - 1), p(index), p(index + 1), p(index + 2)];
  return a.map((_, axis) => 0.5 * (2 * b[axis] + (c[axis] - a[axis]) * f + (2 * a[axis] - 5 * b[axis] + 4 * c[axis] - d[axis]) * f * f + (3 * b[axis] - a[axis] - 3 * c[axis] + d[axis]) * f * f * f));
}

// Toe shapes, in plan and in profile: the outline from the ball to the tip is (1 - x^n)^(1/m) of the ball's half breadth
// (`plan`), the toe box's height falls to the tip the same way (`dome`); `offset` puts the tip towards the big toe.
const TOE_SHAPES = {
  round: { plan: [2.6, 2.0], dome: [2.6, 1.8], offset: 0.008 },
  almond: { plan: [1.9, 1.45], dome: [2.0, 1.5], offset: 0.01 },
  pointed: { plan: [1.3, 1.12], dome: [1.5, 1.2], offset: 0.008 },
  square: { plan: [5.5, 3.0], dome: [4.0, 2.2], offset: 0.004 },
  // The bare foot's end at the roots of its toes: cut off nearly square.
  roots: { plan: [7, 4], dome: [6, 3], offset: 0 },
};

// A bare foot's toes: [middle across, breadth, height, length] from the big toe out. A tabi's: the big toe and the other four in one.
const TOES_FIVE = [[0.033, 0.031, 0.025, 0.058], [0.0085, 0.0205, 0.021, 0.053], [-0.0105, 0.0195, 0.019, 0.047], [-0.0275, 0.0185, 0.018, 0.04], [-0.043, 0.018, 0.017, 0.033]];
const TOES_SPLIT = [[0.033, 0.03, 0.027, 0.059], [-0.0165, 0.064, 0.024, 0.052]];
// Where the toes root (before the slant), and where the last of a foot with toes of its own ends, a little past it.
const FOOT_TOE_ROOT = FOOT_BALL_U + 0.02;

const SOLE_LEATHER = 0x2a1d14;
const SOLE_RUBBER = 0x111113;

/**
 * The kinds. Of each:
 * - `role`: what the last is made of ('skin', 'upper': the cloth atlas's tile in the boot's colour, 'metal', 'foil');
 * - `thick`: the leather over the foot; `toe`: { shape (TOE_SHAPES), ext: m past the toes, up: the tip turned up by this much,
 *   box: the toe box's height, tip: its height at the very end }; `toes`: 'five' or 'split', toes of its own;
 * - `arch`: the hollow under the inner waist; `bones`: how far the ankle bones stand out (1: a bare foot);
 * - `sole`: { th: under the ball, heel: under the heel (the foot pitched to it), wedge: its underside flat on the ground
 *   from heel to toe, margin: how far it stands out round the last, wall and under: its colours, out: the outsole's share
 *   of the edge in `under`, spring: the toe's rise off the ground, bevel: the heel's, lugs: a cleated edge this deep,
 *   stuff: its tile, rough: a ragged edge (straw) };
 * - `heel`: a heel piece under the sole ('stacked', 'louis', 'block', 'spike'), `breast`: where its front stands;
 * - `cut`: where the upper ends: 'low' under the ankle bones (the ankle shows: `ankle` 'skin' or 'sock'), 'ankle' in a
 *   collar of its own over them (`collar`: m over the joint, `flare`), 'shaft' up into the boot's leg (loftbody.js), 'leg'
 *   up into the shank (skin);
 * - `finish`: how polished each of its materials is, by role (0 matt, 1 mirror-bright; none: matt cloth, dull leather);
 * - `paint`: the colour of each part of the upper, (s, a, across) => a palette name;
 * - `pieces`: what is laid on it: 'band' (a strap round it), 'laces', 'rope', 'studs', 'lames' (plates across it).
 * Colours are palette names ('upper': the design's own colour, 'accent', 'skin', 'gold') or hex.
 */
const WARAJI_TIES = [
  // The thong up between the toes to the instep, the side loops, the heel loop, and the ties crossed over the instep and round the ankle (the Met's 36.120.674; ukiyo-e travellers).
  { kind: 'rope', colour: 0xc9b47c, r: 0.0028, role: 'straw', paths: [
    [['toe'], [0.42, 0, 0.004], [0.62, 0, 0.004]],
    [[0.62, 0, 0.004], [0.66, 60, 0.004], [0.7, 112, 0.006]],
    [[0.62, 0, 0.004], [0.66, -60, 0.004], [0.7, -112, 0.006]],
    [[0.7, 112, 0.006], [1.2, 108, 0.005], [1.62, 150, 0.005], [1.66, 180, 0.005], [1.62, 210, 0.005], [1.2, 252, 0.005], [0.7, 248, 0.006]],
    [[1.2, 108, 0.005], [1.02, 40, 0.005], [1.0, 0, 0.005], [1.02, -40, 0.005], [1.2, -108, 0.005]],
    [[1.92, 0, 0.004], [1.92, 60, 0.004], [1.92, 120, 0.004], [1.92, 180, 0.004], [1.92, 240, 0.004], [1.92, 300, 0.004], [1.92, 360, 0.004]],
  ] },
];
const WARAJI_SOLE = { th: 0.012, margin: 0.005, wall: 0xc8b27a, under: 0xa8935e, stuff: 'straw', rough: 0.002 };
const LACE_BLACK = 0x18181b;
const footLaces = (from, to, count, colour = LACE_BLACK, extra = {}) => ({ kind: 'laces', from, to, count, colour, ...extra });

export const FOOTWEAR = {
  bare: { role: 'skin', toes: 'five', arch: 0.02, bones: 1, cut: 'leg' },
  // A leather sandal (a caliga, a gladiator's): the bare foot on a nailed sole, straps over the toes' roots and the instep, a counter round the heel, a strap round the ankle.
  sandal: {
    role: 'skin', toes: 'five', arch: 0.01, bones: 1, cut: 'leg',
    sole: { th: 0.008, margin: 0.003, wall: 'upperDark', under: 'upperDark', stuff: 'leather' },
    pieces: [
      { kind: 'band', colour: 'upper', at: [0.16, 0.26], arc: [-128, 128], lift: 0.002 },
      { kind: 'band', colour: 'upper', at: [0.44, 0.54], arc: [-128, 128], lift: 0.002 },
      { kind: 'band', colour: 'upper', at: [0.74, 0.84], arc: [-128, 128], lift: 0.002 },
      { kind: 'band', colour: 'upper', at: [1.25, 1.9], arc: [118, 242], lift: 0.002 },
      { kind: 'band', colour: 'upper', at: [1.93, 2.12], arc: [0, 360], lift: 0.002 },
      { kind: 'band', colour: 'upper', at: [0.2, 1.0], arc: [-9, 9], lift: 0.0035 },
    ],
  },
  // Straw sandals on a bare foot (waraji: a ronin's, a monk's; plaited fibre for the Mexica's cactli), tied as a tabi's are.
  strawSandal: { role: 'skin', toes: 'five', arch: 0.01, bones: 1, cut: 'leg', sole: WARAJI_SOLE, pieces: WARAJI_TIES },
  // A bare foot bound in strips of rag (a starving rebel's): wound round the middle of the foot and the ankle, the toes bare.
  footRags: {
    role: 'skin', toes: 'five', arch: 0.012, bones: 0.6, cut: 'leg',
    pieces: [
      { kind: 'band', colour: 'upper', at: [0.3, 0.62], arc: [0, 360], lift: 0.003, role: 'upper' },
      { kind: 'band', colour: 'upperDark', at: [0.55, 1.0], arc: [0, 360], lift: 0.0045, role: 'upper' },
      { kind: 'band', colour: 'upper', at: [1.0, 1.55], arc: [0, 360], lift: 0.0035, role: 'upper' },
      { kind: 'band', colour: 'upperDark', at: [1.5, 2.3], arc: [0, 360], lift: 0.005, role: 'upper' },
    ],
  },
  // Tabi: a cotton sock with the big toe apart, closed up the inner ankle, in straw waraji.
  tabi: { role: 'upper', thick: 0.0015, toes: 'split', arch: 0.006, bones: 0.5, cut: 'ankle', collar: 0.05, flare: 0.001, sole: WARAJI_SOLE, pieces: WARAJI_TIES },
  // Kōgake: the armoured tabi: lacquered iron plates over the toes and the foot, joined by mail, on a cloth ankle (the
  // Met's 14.100.121 suit's; Bottomley & Hopson, Arms and Armour of the Samurai, 1988), worn in waraji like any tabi.
  kogake: {
    role: 'upper', thick: 0.002, toes: 'split', toePlates: true, arch: 0.004, bones: 0.3, cut: 'ankle', collar: 0.05, flare: 0.003, sole: WARAJI_SOLE, finish: { lacquer: 0.92, trim: 0.5 },
    paint: (s) => (s < 1.02 ? 0x2b2b2e : 'upper'),
    pieces: [
      { kind: 'lames', role: 'lacquer', from: 0.02, to: 0.3, count: 1, arc: 118, lift: [0.0035, 0.0035], edge: 'gold' },
      { kind: 'lames', role: 'lacquer', from: 0.36, to: 0.98, count: 2, arc: 112, lift: [0.0035, 0.0035], gap: 0.12, edge: 'gold', ridge: true },
      ...WARAJI_TIES,
    ],
  },
  // The medieval turnshoe: an ankle shoe sewn inside out and turned, a single thin sole, no heel, the toe a little pointed, closed by a thong through the side (the London finds: Grew & de Neergaard, Shoes and Pattens, 1988).
  turnshoe: {
    role: 'upper', thick: 0.003, toe: { shape: 'almond', ext: 0.014, box: 0.03, tip: 0.012 }, arch: 0.004, bones: 0.25, cut: 'shaft', finish: { upper: 0.3 },
    sole: { th: 0.004, margin: 0.0015, wall: SOLE_LEATHER, under: SOLE_LEATHER, stuff: 'leather' },
    pieces: [footLaces(0.6, 1.0, 4, 'upperLight', { wide: 30, bar: true, bow: true }), { kind: 'rope', colour: 'upperDark', r: 0.0012, role: 'trim', paths: [[[0.56, 0, 0.0005], [0.8, 0, 0.0005], [1.0, 0, 0.0005]]] }],
  },
  // The Chinese cloth boot (靴): black cloth on a thick white sole of layered cloth, sewn through (千层底), curving up at the toe; the leg wide.
  clothBoot: {
    role: 'upper', thick: 0.004, toe: { shape: 'round', ext: 0.008, box: 0.034, tip: 0.012 }, bones: 0, cut: 'shaft',
    sole: { th: 0.02, margin: 0.002, wall: 0xe9e6dc, under: 0xcfc9b8, spring: 0.02, stuff: 'canvas' },
  },
  // The Chinese armoured boot: the same boot in leather, curved steel lames over the instep set in a leather frame, piped and riveted (战靴: the Ming court's Departure Herald scrolls' guards; the Wubei Zhi's 铁网靴 kin).
  lamellarBoot: {
    role: 'upper', thick: 0.005, toe: { shape: 'round', ext: 0.012, up: 0.012, box: 0.036, tip: 0.02 }, bones: 0, cut: 'shaft', finish: { upper: 0.12, trim: 0.2 },
    sole: { th: 0.016, margin: 0.003, wall: 0x1c1512, under: 0x1c1512, spring: 0.014, stuff: 'leather' },
    pieces: [
      { kind: 'lames', role: 'metal', from: 0.2, to: 1.0, count: 6, arc: 62, lift: [0.0015, 0.006], rivets: 'brass', inset: 12 },
      { kind: 'rope', colour: 0xa3231f, r: 0.002, role: 'trim', paths: [[[0.16, 0, 0.004], [0.2, 50, 0.004], [0.4, 74, 0.004], [0.75, 76, 0.004], [1.02, 70, 0.004]], [[0.16, 0, 0.004], [0.2, -50, 0.004], [0.4, -74, 0.004], [0.75, -76, 0.004], [1.02, -70, 0.004]]] },
      { kind: 'studs', role: 'brass', r: 0.0032, at: [[0.14, 0], [0.22, 62], [0.45, 86], [0.75, 88], [1.0, 82], [0.22, -62], [0.45, -86], [0.75, -88], [1.0, -82]] },
    ],
  },
  // The Mongol felt boot (гутал's forebear): a thick felt leg and foot, the toe turned up, a leather sole wrapping up round the foot, leather trim (the Yuan finds from Inner Mongolia; Rubruck's felt boots and overshoes, 1253-55).
  feltBoot: {
    role: 'upper', thick: 0.007, toe: { shape: 'almond', ext: 0.022, up: 0.042, box: 0.04, tip: 0.018 }, bones: 0, cut: 'shaft', finish: { upper: 0, trim: 0.3 },
    sole: { th: 0.006, margin: 0.001, wall: 'trimLeather', under: 'trimLeather', stuff: 'leather' },
    paint: (s, a, down) => (down > 0.78 && s < 1.9 ? 'trimLeather' : 'upper'),
    pieces: [{ kind: 'rope', colour: 'trimLeather', r: 0.003, role: 'trim', paths: [[[0.14, 0, 0.001], [0.3, 0, 0.001], [0.5, 0, 0.001], [0.75, 0, 0.001], [1.0, 0, 0.001]]] }],
  },
  // The Ottoman boot (çizme): soft leather, a slipper-like foot with a small turned-up tip, a thin sole and a low heel, the leg soft to the knee (yellow for a janissary's, red for his officers': Nicolle, Armies of the Ottoman Turks 1300-1774).
  ottomanBoot: {
    role: 'upper', thick: 0.003, toe: { shape: 'pointed', ext: 0.016, up: 0.014, box: 0.03, tip: 0.012 }, arch: 0.003, bones: 0.1, cut: 'shaft', finish: { upper: 0.05 },
    sole: { th: 0.004, heel: 0.012, margin: 0.001, wall: SOLE_LEATHER, under: SOLE_LEATHER, stuff: 'leather' }, heel: 'stacked',
  },
  // A Song and Jin rider's leather boot: soft, its toe turned up.
  jinBoot: {
    role: 'upper', thick: 0.004, toe: { shape: 'almond', ext: 0.014, up: 0.026, box: 0.036, tip: 0.018 }, bones: 0, cut: 'shaft', finish: { upper: 0.25 },
    sole: { th: 0.007, margin: 0.002, wall: SOLE_LEATHER, under: SOLE_LEATHER, stuff: 'leather' },
  },
  // A rider's soft leather boot (khuff) to the knee, its toe a little pointed, a low heel for the stirrup.
  ridingBoot: {
    role: 'upper', thick: 0.0035, toe: { shape: 'almond', ext: 0.012, up: 0.004, box: 0.03, tip: 0.013 }, bones: 0.1, cut: 'shaft', finish: { upper: 0.25 },
    sole: { th: 0.005, heel: 0.016, margin: 0.0015, wall: SOLE_LEATHER, under: SOLE_LEATHER, stuff: 'leather' }, heel: 'stacked',
  },
  // A plain leather ankle boot (where nothing more is known of a man's shoe): a round toe, a flat leather sole.
  compactBoot: {
    role: 'upper', thick: 0.004, toe: { shape: 'round', ext: 0.008, box: 0.034, tip: 0.016 }, bones: 0, cut: 'shaft', finish: { upper: 0.22 },
    sole: { th: 0.007, heel: 0.012, margin: 0.002, wall: 0x17120f, under: 0x17120f, stuff: 'leather' }, heel: 'stacked',
  },
  // A boxing boot: thin and close, a flat thin sole, laced up the leg.
  boxingBoot: {
    role: 'upper', thick: 0.0025, toe: { shape: 'round', ext: 0.006, box: 0.03, tip: 0.014 }, bones: 0.15, cut: 'shaft', finish: { upper: 0.35 },
    sole: { th: 0.005, margin: 0.001, wall: 0x17171c, under: 0x17171c, spring: 0.004 },
    pieces: [footLaces(0.42, 1.0, 5, 0xe8e8ea)],
  },
  // A running shoe: a thick sculpted midsole with a rocker, a mesh upper with overlays, a heel counter, laces, a sock at the ankle.
  trainer: {
    role: 'upper', thick: 0.0045, toe: { shape: 'round', ext: 0.01, box: 0.036, tip: 0.018 }, bones: 0, cut: 'low', ankle: 'sock', finish: { upper: 0, sole: 0.4, overlay: 0.55 },
    sole: { th: 0.02, heel: 0.032, wedge: true, margin: 0.004, flare: 0.004, wall: 0xf2f2f4, under: 0x26262b, out: 0.3, spring: 0.014, bevel: 0.01, waist: 0.3 },
    pieces: [
      footLaces(0.42, 0.95, 5, 0xf4f4f6, { wide: 26, bar: true }),
      // The tongue's top, the toe's bumper and the heel's counter, and the overlays swept back along each side.
      { kind: 'band', colour: 'upperDark', at: [0.9, 1.06], arc: [-22, 22], lift: 0.006, role: 'upper' },
      { kind: 'band', colour: 'upperDark', at: [0.03, 0.17], arc: [-128, 128], lift: 0.0012, role: 'overlay' },
      { kind: 'band', colour: 'upperDark', at: [1.38, 1.86], arc: [104, 256], lift: 0.0015, role: 'overlay' },
      ...[[0.46, 0.55], [0.64, 0.73]].flatMap(([from, to]) => [[34, 124], [-124, -34]].map((arc) => ({ kind: 'band', colour: 'accent', at: [from, to], arc, lift: 0.0012, role: 'overlay', sweep: 0.42 }))),
    ],
  },
  hikingBoot: {
    role: 'upper', thick: 0.005, toe: { shape: 'round', ext: 0.012, box: 0.04, tip: 0.022 }, bones: 0, cut: 'shaft', finish: { upper: 0.2 },
    sole: { th: 0.018, heel: 0.03, wedge: true, margin: 0.004, wall: 0x2a2420, under: 0x17120f, spring: 0.008, lugs: 0.006, waist: 0.4 },
    paint: (s, a, down) => (down > 0.8 || s < 0.16 ? 'upperDark' : 'upper'),
    pieces: [footLaces(0.4, 1.0, 5, 0xb5482a, { wide: 24 })],
  },
  tacticalBoot: {
    role: 'upper', thick: 0.005, toe: { shape: 'round', ext: 0.012, box: 0.04, tip: 0.022 }, bones: 0, cut: 'shaft',
    sole: { th: 0.016, heel: 0.03, wedge: true, margin: 0.004, wall: SOLE_RUBBER, under: SOLE_RUBBER, spring: 0.006, lugs: 0.006, waist: 0.5 },
    pieces: [footLaces(0.42, 1.0, 5, LACE_BLACK, { wide: 22, bar: true })],
  },
  // A proximity suit's boot: rubber, under an aluminized cover.
  proximityBoot: {
    role: 'foil', thick: 0.008, toe: { shape: 'round', ext: 0.014, box: 0.046, tip: 0.026 }, bones: 0, cut: 'shaft',
    sole: { th: 0.018, heel: 0.028, wedge: true, margin: 0.004, wall: SOLE_RUBBER, under: SOLE_RUBBER, lugs: 0.005, spring: 0.004 },
  },
  // A man's laced dress shoe: a close almond toe with a cap, a welted leather sole, a low stacked heel.
  dressShoe: {
    role: 'upper', thick: 0.003, toe: { shape: 'almond', ext: 0.016, box: 0.029, tip: 0.012 }, bones: 0, cut: 'low', ankle: 'sock', finish: { upper: 0.6, sole: 0.3 },
    sole: { th: 0.006, heel: 0.024, margin: 0.003, wall: 0x2a1d14, under: 0x2a1d14, stuff: 'leather' }, heel: 'stacked',
    pieces: [footLaces(0.62, 0.96, 4, LACE_BLACK, { wide: 20, bar: true }), { kind: 'rope', colour: 'upperDark', r: 0.001, role: 'trim', paths: [[[0.3, -120, 0.0016], [0.3, -90, 0.0016], [0.3, -60, 0.0016], [0.3, -30, 0.0016], [0.3, 0, 0.0016], [0.3, 30, 0.0016], [0.3, 60, 0.0016], [0.3, 90, 0.0016], [0.3, 120, 0.0016]]] }],
  },
  // A lady's laced boot: a pointed toe with a cap, a waisted Louis heel, close to the foot (the 1890s' walking boot); the business woman's ankle boot is the same boot plain.
  heelAnkleBoot: {
    role: 'upper', thick: 0.003, toe: { shape: 'pointed', ext: 0.02, box: 0.028, tip: 0.01 }, bones: 0, cut: 'shaft', finish: { upper: 0.85, sole: 0.5 },
    sole: { th: 0.005, margin: 0.001, wall: 0x0b0b0d, under: 0x2a1d14, stuff: 'leather' }, heel: 'louis',
    paint: (s) => (s < 0.27 ? 'upperDark' : 'upper'),
  },
  // A patent platform shoe (a Mary Jane): a round toe on a platform, a block heel, straps over the instep and round the ankle, each buckled.
  platformShoe: {
    role: 'upper', thick: 0.003, toe: { shape: 'round', ext: 0.01, box: 0.036, tip: 0.02 }, bones: 0, cut: 'low', ankle: 'skin', finish: { upper: 0.95, sole: 0.8 },
    sole: { th: 0.006, margin: 0.002, wall: 'upper', under: 0x0b0b0d }, heel: 'block',
  },
  // The gothic lug boot: black leather laced up the front, a round toe with a seam round it, on a thick cleated sole with a block heel.
  lugBoot: {
    role: 'upper', thick: 0.005, toe: { shape: 'round', ext: 0.012, box: 0.042, tip: 0.024 }, bones: 0, cut: 'shaft', bend: 0.55, finish: { upper: 0.62, sole: 0.05 },
    sole: { th: 0.03, heel: 0.045, wedge: true, margin: 0.005, wall: 0x0b0b0d, under: 0x0b0b0d, lugs: 0.012, spring: 0.004, waist: 0.75 },
    pieces: [footLaces(0.45, 1.0, 5, 0x0d0d10, { wide: 22, eyelets: 0x9a9da3 }), { kind: 'rope', colour: 'upperDark', r: 0.0014, role: 'trim', paths: [[[0.5, -52, 0.001], [0.28, -64, 0.001], [0.14, -40, 0.001], [0.1, 0, 0.001], [0.14, 40, 0.001], [0.28, 64, 0.001], [0.5, 52, 0.001]]] }],
  },
  // Sabatons: steel lames across the foot, overlapping, riveted at each side; the toe drawn out past the foot to a point
  // (`feet.point`), and a heel plate hinged to the lames at each side (the Gothic harness's: the Met's 29.150.9; Wallace A 21).
  sabaton: {
    role: 'metal', thick: 0.004, toe: { shape: 'pointed', ext: 0.06, box: 0.03, tip: 0.008, droop: 0.004 }, bones: 0, cut: 'shaft',
    sole: { th: 0.004, margin: 0, wall: SOLE_LEATHER, under: SOLE_LEATHER, stuff: 'leather' },
  },
};

/** The parameter set a foot of `kind` is built from (`feet`: the design's: a sabaton's `point`, `lames`, `rivets`; `heels`; `laced`). */
function footwearSpec(kind, feet, heels, stuff) {
  const key = kind === 'sandal' && stuff === 'straw' ? 'strawSandal' : kind;
  const spec = FOOTWEAR[key] ?? FOOTWEAR.compactBoot;
  const out = { ...spec, toe: spec.toe ? { ...spec.toe } : null, sole: spec.sole ? { ...spec.sole } : null, pieces: [...(spec.pieces ?? [])] };
  if (kind === 'sabaton') {
    // (`feet.point`: m past the foot at this stature; the lames between the toe cap and the instep; the heel plate.)
    out.toe.ext = feet.point ?? 0.06;
    const count = feet.lames ?? 3;
    out.pieces.push(
      { kind: 'lames', role: 'metal', from: 0.3 / (1 + out.toe.ext * 3), to: 1.02, count, arc: 126, lift: [0.001, 0.0042], rivets: feet.rivets ? 'brass' : null, inset: 14 },
      { kind: 'lames', role: 'metal', from: 1.2, to: 1.98, count: 1, arc: [104, 256], lift: [0.0035, 0.0035], rivets: feet.rivets ? 'brass' : 'metal', inset: 10, wall: true },
    );
  }
  if (heels) {
    // A heeled shoe's own toe (`point`: the old measure, the toe's length as a share of the foot's; 0.28 a round one), its platform and its heel.
    out.toe.ext = Math.max(out.toe.ext ?? 0, (heels.point - 0.28) * 0.16);
    if (heels.round) out.toe.shape = 'round';
    out.sole.th = Math.max(out.sole.th ?? 0.005, (heels.platform ?? 0) + 0.005);
    if (!out.sole.wedge) out.heel = heels.block ? 'block' : out.heel ?? 'spike';
    out.pitch = Math.min(HEEL_BEND.most, heels.pitch * (spec.bend ?? HEEL_BEND.share));
    for (let strap = 0; strap < (heels.straps ?? 0) && kind === 'platformShoe'; strap += 1) {
      const at = [0.86, 1.5, 1.98][strap] ?? 0.86;
      out.pieces.push({ kind: 'band', colour: 'upper', at: [at - 0.05, at + 0.05], arc: at > 1.9 ? [0, 360] : [-110, 110], lift: at > 1 ? 0.005 : 0.002, role: 'upper', buckle: true });
    }
  }
  if (feet.laced && kind === 'heelAnkleBoot') out.pieces.push(footLaces(0.46, 1.0, 6, 0x26262b, { wide: 14, eyelets: 0x3a3a40 }), { kind: 'rope', colour: 0x26262b, r: 0.0011, role: 'trim', paths: [[[0.27, -110, 0.0008], [0.25, -55, 0.0008], [0.24, 0, 0.0008], [0.25, 55, 0.0008], [0.27, 110, 0.0008]]] });
  return out;
}

// A heeled foot bends at the ball: the hind foot pitched `share` of the design's `pitch` (which was the whole shoe's, tipped
// about its toe; a kind's own `bend` where its sole takes up more of the height), at most `most` (a foot bends no further).
// What height is still wanting is the boot's ankle, standing lower in the frame than the joint with its leg drawn longer to
// reach it (see `rise`).
const HEEL_BEND = { share: 1.5, most: 0.6 };

function footRgb(hex) {
  return [((hex >> 16) & 255) / 255, ((hex >> 8) & 255) / 255, (hex & 255) / 255];
}

/**
 * The last of a spec: `ring(s)` the cross-section at s along its path (0 the toe's tip, 1 the instep's bend, 2 the ankle,
 * 3 the top of what goes up inside the leg) and `at(s, a, lift)` the point on it at angle a round the section (degrees:
 * 0 the top, 90 the inner side, 180 the sole or the back), `lift` off the surface; both before the foot is placed (warp).
 */
function footLast(spec, fit, thick, legTop, closes = true) {
  const toe = TOE_SHAPES[spec.toes ? 'roots' : spec.toe?.shape ?? 'round'];
  const ext = spec.toes ? 0 : spec.toe?.ext ?? 0.008;
  const tipU = spec.toes ? FOOT_TOE_ROOT + 0.012 : FOOT_TOE_U - 0.006 + ext;
  const box = spec.toes ? 0.027 : spec.toe?.box ?? 0.034;
  const tipH = spec.toes ? 0.02 : spec.toe?.tip ?? 0.014;
  const creaseU = fit.front + FOOT_CREASE * (1 - Math.sin(FOOT_INSTEP_SLOPE));
  const instep = FOOT_RISE + fit.v - FOOT_CREASE * Math.cos(FOOT_INSTEP_SLOPE);
  // The foot's outline in plan (half breadths, inner and outer) and its height over the insole, along it.
  const waist = spec.toes ? 1 : 1.04;
  const inner = (u) => (u < FOOT_HEEL_U + FOOT_HEEL_ROUND ? 0.0335 * Math.sqrt(Math.max(0, 1 - ((FOOT_HEEL_U + FOOT_HEEL_ROUND - u) / FOOT_HEEL_ROUND) ** 2)) : footKeyed([[FOOT_HEEL_U + FOOT_HEEL_ROUND, 0.0335], [0.02, 0.033 * waist], [0.075, 0.041], [FOOT_BALL_U, FOOT_HALF_BALL * 0.975]], u));
  const outer = (u) => (u < FOOT_HEEL_U + FOOT_HEEL_ROUND ? 0.0335 * Math.sqrt(Math.max(0, 1 - ((FOOT_HEEL_U + FOOT_HEEL_ROUND - u) / FOOT_HEEL_ROUND) ** 2)) : footKeyed([[FOOT_HEEL_U + FOOT_HEEL_ROUND, 0.0335], [0.02, 0.039], [0.075, 0.049], [FOOT_BALL_U, FOOT_HALF_BALL * 1.025]], u));
  const taper = (x, [n, m]) => Math.max(0, 1 - footClamp(x) ** n) ** (1 / m);
  const toeX = (u) => (u - FOOT_BALL_U) / (tipU - FOOT_BALL_U);
  const plan = (u) => {
    const x = toeX(u);
    if (x <= 0) return [inner(u) + thick, outer(u) + thick, 0];
    // (The outer side turns in sooner than the inner: the little toe lies well back of the big one.)
    return [(inner(FOOT_BALL_U) + thick) * taper(x, toe.plan), (outer(FOOT_BALL_U) + thick) * taper(x * 1.04, [Math.max(1.1, toe.plan[0] - 0.35), toe.plan[1]]), toe.offset * footEase(0, 1, x)];
  };
  // The top line: one curve from the shin's front down over the instep to the toes, steepest at the ankle and easing all
  // the way (no ledge: its slope runs on from the bend's into the ball's).
  const dorsal = (u) => {
    const x = toeX(u);
    if (x <= 0) {
      const run = FOOT_BALL_U - creaseU;
      const t = footClamp((FOOT_BALL_U - u) / run);
      const [h0, m0] = FOOT_BALL_TOP;
      const m1 = Math.tan(FOOT_INSTEP_SLOPE);
      return (2 * t ** 3 - 3 * t * t + 1) * h0 + (t ** 3 - 2 * t * t + t) * run * m0 + (-2 * t ** 3 + 3 * t * t) * instep + (t ** 3 - t * t) * run * m1 + thick;
    }
    const high = footLerp(FOOT_BALL_TOP[0], box, footClamp(x / 0.5));
    return tipH + (high - tipH) * taper(x, toe.dome) + thick;
  };
  // The heel's outline from the side, from under the instep back along the sole, round the heel and up the tendon to the shank's end.
  const heelLine = [[creaseU, -FOOT_RISE], [FOOT_HEEL_U + 0.05, -FOOT_RISE], ...(thick ? [[FOOT_HEEL_U + 0.01, -FOOT_RISE + 0.0005], [FOOT_HEEL_U + 0.001, -FOOT_RISE + 0.008]] : [[FOOT_HEEL_U + 0.02, -FOOT_RISE + 0.0005], [FOOT_HEEL_U + 0.003, -FOOT_RISE + 0.01]]), [FOOT_HEEL_U, -FOOT_RISE + 0.024], [FOOT_HEEL_U + 0.012, -FOOT_RISE + 0.048], [fit.back, fit.v]];
  const ring = (s) => {
    if (s <= 1) {
      const u = footLerp(tipU, creaseU, s);
      const [inn, out, mid] = plan(u);
      const x = footClamp(toeX(u));
      // (The ridge of the instep lies towards the inner side; the section flat underneath, round on top.)
      return { top: [u, -FOOT_RISE + dorsal(u)], bottom: [u, -FOOT_RISE], inn, out, mid, ridge: 0.011 * footEase(FOOT_BALL_U + 0.03, 0.06, u), eTop: footLerp(0.95, 0.8, x), eBottom: 0.5, eSide: 0.8, belly: 0.62, tail: 0, u };
    }
    if (s <= 2) {
      const t = s - 1;
      const angle = footLerp(FOOT_INSTEP_SLOPE, Math.PI / 2, t);
      const top = [fit.front + FOOT_CREASE - (FOOT_CREASE - thick) * Math.sin(angle), fit.v - (FOOT_CREASE - thick) * Math.cos(angle)];
      const raw = footSpline(heelLine, t);
      const away = Math.hypot(raw[0] - top[0], raw[1] - top[1]) || 1;
      const bottom = [raw[0] + ((raw[0] - top[0]) / away) * thick * footEase(0, 0.3, t), raw[1] + ((raw[1] - top[1]) / away) * thick * footEase(0, 0.3, t)];
      const mid = footLerp(top[0], bottom[0], 0.6);
      const heelIn = footKeyed([[0, plan(creaseU)[0] - thick], [0.35, 0.0335], [0.7, 0.0295], [1, fit.inner]], t) + thick;
      const heelOut = footKeyed([[0, plan(creaseU)[1] - thick], [0.35, 0.0345], [0.7, 0.0295], [1, fit.outer]], t) + thick;
      return { top, bottom, inn: heelIn, out: heelOut, mid: 0, ridge: 0.011 * (1 - footEase(0, 0.5, t)) * footEase(FOOT_BALL_U + 0.03, 0.06, creaseU), eTop: 0.95, eBottom: footLerp(0.5, 0.9, footEase(0.2, 0.8, t)), eSide: footLerp(0.8, 1, t), belly: footLerp(0.62, 1, footEase(0.2, 1, t)), tail: 0.5 * footEase(0.35, 0.75, t) * (1 - 0.8 * footEase(0.8, 1, t)), u: mid };
    }
    // Up inside the leg: level sections, drawn in a little as they go.
    const t = s - 2;
    // (Its end drawn in to a low dome within the shank, FOOT_STUB high: a shin leaning over the foot in a stride must not
    // show the end of the ankle standing out of it. A collar of its own stays open.)
    const v = fit.v + t * legTop;
    const draw = closes ? 1 - 0.5 * footEase(legTop - FOOT_STUB, legTop, t * legTop) : 1;
    const middle = (fit.front + fit.back) / 2;
    return { top: [middle + (fit.front + thick - middle) * draw, v], bottom: [middle + (fit.back - thick - middle) * draw, v], inn: (fit.inner + thick) * draw, out: (fit.outer + thick) * draw, mid: 0, ridge: 0, eTop: 0.95, eBottom: 0.9, eSide: 1, belly: 1, tail: 0.1, u: 0 };
  };
  const bones = spec.bones ?? 0;
  const arch = spec.arch ?? 0;
  const at = (s, a, lift = 0, section = ring(s)) => {
    const angle = (a * Math.PI) / 180;
    const c = Math.cos(angle);
    const sn = Math.sin(angle);
    const down = (0.5 - 0.5 * footPow(c, c > 0 ? section.eTop : section.eBottom)) ** section.belly;
    const half = (sn > 0 ? section.inn : section.out) * (1 - section.tail * footEase(0.55, 1, down));
    let u = footLerp(section.top[0], section.bottom[0], down);
    let v = footLerp(section.top[1], section.bottom[1], down);
    let w = section.mid + section.ridge * (1 - footEase(0, 0.6, down)) + half * footPow(sn, section.eSide);
    if (lift) {
      // Off the surface: away from the section's middle, in its plane.
      const centre = [footLerp(section.top[0], section.bottom[0], 0.5), footLerp(section.top[1], section.bottom[1], 0.5), section.mid];
      const away = [u - centre[0], v - centre[1], (w - centre[2]) * 1.4];
      const far = Math.hypot(...away) || 1;
      u += (away[0] / far) * lift;
      v += (away[1] / far) * lift;
      w += (away[2] / far) * lift;
    }
    // The arch: the inner waist lifted off the ground between the heel's pad and the ball's.
    if (arch) v += arch * Math.sin(Math.PI * footClamp((u - (FOOT_HEEL_U + 0.045)) / (FOOT_BALL_U - 0.012 - (FOOT_HEEL_U + 0.045)))) ** 1.5 * footEase(-0.016, 0.026, w) * (1 - footEase(-FOOT_RISE, -FOOT_RISE + 0.034, v));
    // The ankle bones: the inner higher and further forward than the outer, both fading into the shank's end.
    if (bones) {
      const bump = (bu, bv, r) => Math.exp(-(((u - bu) / r) ** 2) - ((v - bv) / (r * 1.25)) ** 2);
      if (w > 0.012) w += bones * 0.011 * bump(-0.006, 0.002, 0.016) * footEase(fit.v + 0.006, fit.v - 0.01, v);
      else if (w < -0.012) w -= bones * 0.012 * bump(-0.02, -0.01, 0.015) * footEase(fit.v + 0.006, fit.v - 0.01, v);
    }
    return [u + FOOT_SLANT * w * footEase(0, 0.1, u), v, w, down];
  };
  return { ring, at, tipU, creaseU, plan, toeX };
}

/** Parts to draw, each { positions, indices, colors } (flat arrays; normals are the caller's to compute from them). */
function footPart() {
  return { positions: [], colors: [], indices: [] };
}

/**
 * A foot of `kind`, in the foot bone's frame for a man FOOT_STATURE tall (scale it by his height / FOOT_STATURE), as parts
 * by role: { skin, upper, sole, metal, brass, lacquer, straw, trim } each { positions, colors, indices } (Float32Array,
 * Float32Array, Uint16Array), with smooth normals to be computed from the indices (shared points are smooth, others creased).
 * - `feet`: the design's (`point`, `lames`, `rivets`, `laced`, `socks`); `heels`: its heels ({ pitch, point, platform, block, round, straps });
 * - `side`: 'l' or 'r'; `ground`: how far the ground lies below the joint (m at FOOT_STATURE: body.lengths.ankle scaled);
 * - `fit`: the shank's end to meet (ankleFit), `detail`: 'full' or 'low' (a crowd's: fewer sections, no laces or studs);
 * - `palette`: { upper, accent, skin, gold, sock } as hex; `stuff`: the upper's cloth (a straw sandal's sole is its `stuff`).
 */
export function footwearParts(kind, { feet = {}, heels = null, side = 'l', ground = FOOT_RISE, fit: shank = ANKLE_FIT, detail = 'full', palette = {}, stuff = null } = {}) {
  // The foot stands under the leg as it was built (a body's shank may end a little off the joint), and a broad ankle carries
  // a broad foot: the last is made about its own middle, `breadth` wide, and set `offset` from the joint.
  const half = (shank.inner + shank.outer) / 2;
  const breadth = Math.min(FOOT_BREADTH.most, Math.max(FOOT_BREADTH.least, (half / ANKLE_FIT.inner) ** FOOT_BREADTH.power));
  const offset = [Math.max(-0.03, Math.min(0.03, (shank.front + shank.back) / 2 - (ANKLE_FIT.front + ANKLE_FIT.back) / 2)), Math.max(-0.03, Math.min(0.03, (shank.inner - shank.outer) / 2))];
  // (A hair outside the shank's end all round, so its rim lies buried in the ankle and not over it.)
  const fit = { v: shank.v, front: shank.front - offset[0] + ANKLE_OVER, back: shank.back - offset[0] - ANKLE_OVER, inner: (half + ANKLE_OVER) / breadth, outer: (half + ANKLE_OVER) / breadth };
  const spec = footwearSpec(kind, feet, heels, stuff);
  const low = detail === 'low';
  const around = low ? 8 : 14;
  const thick = spec.thick ?? 0;
  const sole = spec.sole;
  const th = sole?.th ?? 0;
  const mirror = side === 'l' ? 1 : -1;
  const parts = {};
  const part = (role) => (parts[role] ??= footPart());
  const upperHex = palette.upper ?? 0x3a2a20;
  const shade = (hex, by) => {
    const [r, g, b] = footRgb(hex);
    return by < 1 ? [r * by, g * by, b * by] : [footLerp(r, 1, by - 1), footLerp(g, 1, by - 1), footLerp(b, 1, by - 1)];
  };
  const named = { upper: footRgb(upperHex), upperDark: shade(upperHex, 0.62), upperLight: shade(upperHex, 1.25), accent: footRgb(palette.accent ?? upperHex), skin: footRgb(palette.skin ?? 0xd9a07a), gold: footRgb(palette.gold ?? 0xd6a743), sock: footRgb(palette.sock ?? 0xe9e9ec), trimLeather: shade(palette.trim ?? 0x5a3a22, 1), white: [1, 1, 1] };
  const colour = (value) => (typeof value === 'number' ? footRgb(value) : named[value] ?? named.upper);

  // How the foot stands: flat, or its hind part pitched up about the ball on a heel. The last is made flat with its
  // insole FOOT_RISE under the joint; `warp` bends it, turns up its toe and sets it down with its sole on the ground.
  const pitch = spec.pitch ?? (sole?.heel && sole.heel > th ? Math.asin(Math.min(0.6, (sole.heel - th) / (FOOT_BALL_U - FOOT_HEEL_U))) : 0);
  const ballAt = [FOOT_BALL_U, -FOOT_RISE];
  const turn = (u, v, angle) => {
    const du = u - ballAt[0];
    const dv = v - ballAt[1];
    return [ballAt[0] + du * Math.cos(angle) + dv * Math.sin(angle), ballAt[1] - du * Math.sin(angle) + dv * Math.cos(angle)];
  };
  const joint = turn(0, 0, pitch);
  // `rise`: how far the drawn foot's ankle stands over the joint (on a thick sole; under it on a high heel, see HEEL_BEND).
  const rise = joint[1] + FOOT_RISE + th - ground;
  const spring = sole?.spring ?? 0;
  const toeUp = spec.toe?.up ?? 0;
  const droop = spec.toe?.droop ?? 0;
  let tipU = FOOT_TOE_U;
  const warp = ([u, v, w]) => {
    let pu = u;
    let pv = v;
    if (pitch) {
      const hind = 1 - footEase(FOOT_BALL_U - 0.04, FOOT_BALL_U + 0.015, u);
      const [tu, tv] = turn(u, v, pitch * hind);
      const leg = footEase(fit.v - 0.004, fit.v + 0.02, v);
      pu = footLerp(tu, u + joint[0], leg) - joint[0];
      pv = footLerp(tv, v + joint[1], leg);
    }
    const x = footClamp((u - FOOT_BALL_U) / (tipU - FOOT_BALL_U));
    // The toe's spring off the ground, and a toe turned up (the last third of it) or drawn down to a point.
    pv += spring * x * x + toeUp * footEase(0.45, 1, x) ** 1.6 - droop * x;
    return [pv + FOOT_RISE + th - ground, pu + offset[0], (w * breadth + offset[1]) * mirror];
  };

  const legTop = Math.max(FOOT_STUB, FOOT_STUB - rise);
  const last = footLast(spec, fit, thick, legTop, (spec.cut ?? 'shaft') !== 'ankle');
  tipU = last.tipU;
  const flip = mirror < 0;
  const push = (target, point, rgb) => {
    target.positions.push(point[0], point[1], point[2]);
    target.colors.push(rgb[0], rgb[1], rgb[2]);
    return target.positions.length / 3 - 1;
  };
  const tri = (target, a, b, c) => (flip ? target.indices.push(a, c, b) : target.indices.push(a, b, c));
  const quad = (target, a, b, c, d) => {
    tri(target, a, b, c);
    tri(target, a, c, d);
  };
  /** A sheet through rows of points ([x, y, z, rgb]), `closed` round each row. */
  const sheet = (target, rows, closed, inside = false) => {
    const index = rows.map((row) => row.map((point) => push(target, point, point[3])));
    for (let r = 0; r + 1 < rows.length; r += 1) {
      const n = rows[r].length;
      for (let c = 0; c < (closed ? n : n - 1); c += 1) {
        const d = (c + 1) % n;
        if (inside) quad(target, index[r][c], index[r + 1][c], index[r + 1][d], index[r][d]);
        else quad(target, index[r][c], index[r][d], index[r + 1][d], index[r + 1][c]);
      }
    }
    return index;
  };

  // The last itself: the upper, or the bare foot.
  const lastRole = spec.role;
  const paint = spec.paint ?? (() => 'upper');
  const skinned = lastRole === 'skin';
  const lastColour = (s, a, down) => (skinned ? named.skin : lastRole === 'upper' ? colour(paint(s, a, down)) : named.white);
  const foreAt = low ? [0.07, 0.24, 0.5, 0.78, 1] : spec.toes ? [0.1, 0.3, 0.52, 0.76, 1] : [0.035, 0.1, 0.2, 0.32, 0.46, 0.62, 0.8, 1];
  const fanCount = low ? 3 : 5;
  // Where the upper ends, by the angle round it (see `cut`).
  const cut = spec.cut ?? 'shaft';
  const collar = spec.collar ?? 0.04;
  const topAt = (a) => (cut === 'low' ? 1.5 + 0.36 * Math.max(0, -Math.cos((a * Math.PI) / 180)) ** 1.5 : 2);
  const angleOf = (j) => (j * 360) / around;
  const row = (s, lift = 0, tint = null) => {
    const section = last.ring(s);
    return Array.from({ length: around }, (_, j) => {
      const a = angleOf(j);
      const p = last.at(s, a, lift, section);
      return [...warp(p), tint ?? lastColour(s, a, p[3])];
    });
  };
  const variedRow = (t, lift = 0, tint = null) => Array.from({ length: around }, (_, j) => {
    const a = angleOf(j);
    const s = 1 + (topAt(a) - 1) * t;
    const p = last.at(s, a, lift);
    return [...warp(p), tint ?? lastColour(s, a, p[3])];
  });
  const rows = foreAt.map((s) => row(s));
  for (let k = 1; k <= fanCount; k += 1) rows.push(variedRow(k / fanCount));
  if (cut === 'low') {
    // The opening's edge turned in: the leather's thickness.
    rows.push(variedRow(1, -thick * 0.9, colour('upperDark')), variedRow(0.9, -thick * 0.9, colour('upperDark')));
  } else if (cut === 'ankle') {
    // A collar of its own over the ankle bones, standing open a little, its edge turned in.
    const flare = spec.flare ?? 0.004;
    const up = (v, lift, tint) => row(2 + (v - fit.v) / legTop, lift, tint);
    rows.push(up(fit.v + collar * 0.5, flare * 0.5), up(fit.v + collar, flare), up(fit.v + collar, flare - Math.max(0.0025, thick)), up(fit.v + collar * 0.6, -thick));
  } else {
    // Up into the leg: to the shank's end where the ankle stands under the joint, then on inside it.
    if (rise < -0.004) rows.push(row(2 + (-rise) / legTop));
    rows.push(row(3));
  }
  const lastPart = part(lastRole === 'foil' ? 'foil' : lastRole);
  const lastIndex = sheet(lastPart, rows, true);
  // The toe's end: closed to its tip.
  {
    const tip = last.at(0, 0);
    const tipPoint = warp([tip[0], footLerp(last.ring(0).bottom[1], tip[1], 0.45), tip[2]]);
    const centre = push(lastPart, tipPoint, lastColour(0, 0, 0.5));
    for (let j = 0; j < around; j += 1) tri(lastPart, centre, lastIndex[0][(j + 1) % around], lastIndex[0][j]);
  }
  if (cut === 'low') {
    // The ankle showing in a low shoe's opening: skin, or a sock.
    const tint = spec.ankle === 'sock' || feet.socks ? named.sock : named.skin;
    const inner = footLast({ ...spec, toes: null, bones: spec.ankle === 'sock' ? 0.5 : 1, arch: 0 }, fit, spec.ankle === 'sock' ? 0.0012 : 0, legTop);
    const ankleRow = (s) => {
      const section = inner.ring(s);
      return Array.from({ length: around }, (_, j) => [...warp(inner.at(s, angleOf(j), 0, section)), tint]);
    };
    const stub = [ankleRow(1.3), ankleRow(1.55), ankleRow(1.8), ankleRow(2), ...(rise < -0.004 ? [ankleRow(2 + (-rise) / legTop)] : []), ankleRow(3)];
    sheet(part(tint === named.skin ? 'skin' : 'upper'), stub, true);
  }

  // Toes of its own: each a short lobe from its root to a rounded tip, lying on the ground.
  if (spec.toes) {
    const lobes = spec.toes === 'five' ? TOES_FIVE : TOES_SPLIT;
    const lobeRole = spec.toePlates ? 'lacquer' : lastRole;
    const sides = low ? 5 : spec.toes === 'five' ? 7 : 10;
    lobes.forEach(([mid, wide, high, long], toeIndex) => {
      if (low && spec.toes === 'five' && toeIndex > 1) {
        if (toeIndex > 2) return;
        // (A crowd's foot: the three small toes as one.)
        [mid, wide, high, long] = [-0.0245, 0.05, 0.017, 0.043];
      }
      const target = part(lobeRole);
      const tint = skinned ? named.skin : lobeRole === 'lacquer' ? named.white : colour(paint(0, 0, 0));
      const grown = thick + (spec.toePlates ? 0.002 : 0);
      const lobeRow = (t, breadth, height, raise) => Array.from({ length: sides }, (_, j) => {
        const angle = (j * 2 * Math.PI) / sides;
        const c = Math.cos(angle);
        const sn = Math.sin(angle);
        const w = mid * (1 + 0.06 * t) + (wide / 2 + grown) * breadth * footPow(sn, 0.85);
        const v = -FOOT_RISE + raise + (high + grown) * height * (0.5 + 0.5 * footPow(c, c > 0 ? 0.9 : 0.55));
        const u = FOOT_TOE_ROOT - 0.006 + long * t;
        return [...warp([u + FOOT_SLANT * w, v, w]), tint];
      });
      const lobeRows = [lobeRow(0, 1, 1.12, 0), lobeRow(0.4, 0.96, 1, 0.0005), lobeRow(0.74, 1.04, 0.92, 0), lobeRow(0.93, 0.86, 0.74, 0.0015)];
      const index = sheet(target, lobeRows, true, true);
      const end = push(target, warp([FOOT_TOE_ROOT - 0.006 + long + FOOT_SLANT * mid * 1.06, -FOOT_RISE + (high + grown) * 0.42, mid * 1.06]), tint);
      const lastRow = index[index.length - 1];
      for (let j = 0; j < sides; j += 1) tri(target, end, lastRow[(j + 1) % sides], lastRow[j]);
    });
  }

  // The sole: the last's outline in plan stood out by its margin, with an edge and an underside; flat under the foot, or a
  // wedge whose underside lies on the ground from heel to toe. A cleated one's edge is cut into lugs.
  const floorOf = (point) => [-ground, point[1], point[2]];
  if (sole) {
    const target = part(sole.stuff === 'straw' ? 'straw' : 'sole');
    const wall = colour(sole.wall);
    const under = colour(sole.under ?? sole.wall);
    const margin = sole.margin ?? 0.002;
    const stations = low ? 6 : 11;
    const us = Array.from({ length: stations }, (_, k) => {
      const t = k / (stations - 1);
      // (Closer together round the heel and the toe, where the outline turns.)
      return footLerp(FOOT_HEEL_U - thick + 0.006, last.tipU - 0.002, 0.5 - 0.5 * Math.cos(Math.PI * t) * (0.86 + 0.14 * Math.abs(Math.cos(Math.PI * t))));
    });
    const waist = sole.waist ?? 1;
    const edge = us.map((u, k) => {
      const [inn, out, mid] = last.plan(u);
      const flare = (sole.flare ?? 0) * (1 - footEase(FOOT_HEEL_U, FOOT_HEEL_U + 0.09, u));
      const rough = sole.rough ? sole.rough * Math.sin(k * 2.4) : 0;
      // (A sole cut straighter than the foot through the waist: `waist` of the foot's own narrowing kept.)
      const fill = (1 - waist) * Math.sin(Math.PI * footClamp((u - FOOT_HEEL_U - 0.03) / (FOOT_BALL_U - FOOT_HEEL_U - 0.03))) * 0.007;
      const end = k === 0 || k === stations - 1 ? 0.35 : 1;
      return { u, inn: (inn + margin + flare + rough + fill) * end, out: (out + margin + flare - rough + fill * 0.4) * end, mid };
    });
    // Round the outline: up the inner side from the heel to the toe, back down the outer.
    const loop = [...edge.map(({ u, inn, mid }) => [u + FOOT_SLANT * (mid + inn) * footEase(0, 0.1, u), mid + inn]), ...edge.slice().reverse().map(({ u, out, mid }) => [u - FOOT_SLANT * (out - mid) * footEase(0, 0.1, u), mid - out])];
    const bevel = sole.bevel ?? 0;
    const topOf = ([u, w]) => warp([u, -FOOT_RISE, w]);
    const bottomOf = ([u, w]) => {
      if (!sole.wedge) return warp([u, -FOOT_RISE - th, w]);
      const flat = floorOf(warp([u, -FOOT_RISE - th, w]));
      const x = footClamp((u - FOOT_BALL_U) / (tipU - FOOT_BALL_U));
      return [flat[0] + spring * x * x + bevel * footClamp((FOOT_HEEL_U + 0.035 - u) / 0.035) ** 2, flat[1], flat[2]];
    };
    const lugs = low ? 0 : sole.lugs ?? 0;
    const topRow = loop.map((p) => [...topOf(p), wall]);
    const bottomRow = loop.map((p) => {
      const b = bottomOf(p);
      return [b[0] + lugs, b[1], b[2], sole.out ? under : wall];
    });
    if (sole.out) {
      const midRow = loop.map((p, k) => {
        const t = topRow[k];
        const b = bottomRow[k];
        return [footLerp(b[0], t[0], sole.out), footLerp(b[1], t[1], sole.out), footLerp(b[2], t[2], sole.out)];
      });
      sheet(target, [topRow, midRow.map((p) => [...p, wall])], true);
      sheet(target, [midRow.map((p) => [...p, under]), bottomRow], true);
    } else sheet(target, [topRow, bottomRow], true);
    // The underside, and the welt on top where the sole stands out round the last.
    const count = edge.length;
    const face = (rowOf, tint, up) => {
      const index = loop.map((p) => push(target, rowOf(p), tint));
      for (let k = 0; k + 1 < count; k += 1) {
        const [a, b, c, d] = [index[k], index[k + 1], index[2 * count - 2 - k], index[2 * count - 1 - k]];
        if (up) quad(target, a, d, c, b);
        else quad(target, a, b, c, d);
      }
    };
    face((p) => {
      const b = bottomOf(p);
      return [b[0] + lugs, b[1], b[2]];
    }, under, false);
    if (margin > 0.0015 || spec.role === 'skin') face(topOf, wall, true);
    if (lugs) {
      // The cleats: blocks along each edge of the underside, a gap between each and the next.
      const inset = 0.022;
      for (let k = 0; k + 1 < loop.length; k += 1) {
        if (k === count - 1) continue;
        const [a, b] = [loop[k], loop[k + 1]];
        const span = Math.hypot(b[0] - a[0], b[1] - a[1]);
        const blocks = Math.max(1, Math.round(span / 0.021));
        for (let n = 0; n < blocks; n += 1) {
          const at = (f) => [footLerp(a[0], b[0], (n + f) / blocks), footLerp(a[1], b[1], (n + f) / blocks)];
          const [p, q] = [at(0.14), at(0.86)];
          const inward = (point) => {
            const [inn, out, mid] = last.plan(point[0]);
            const centre = mid + (inn - out) / 2;
            const reach = Math.min(inset, Math.abs(point[1] - centre) * 0.8);
            return [point[0], point[1] + Math.sign(centre - point[1]) * reach];
          };
          const corners = [p, q, inward(q), inward(p)];
          const high = corners.map((c) => {
            const bottom = bottomOf(c);
            return push(target, [bottom[0] + lugs, bottom[1], bottom[2]], under);
          });
          const lowIndex = corners.map((c) => push(target, bottomOf(c), under));
          for (let e = 0; e < 4; e += 1) quad(target, high[e], high[(e + 1) % 4], lowIndex[(e + 1) % 4], lowIndex[e]);
          const base = corners.map((c) => push(target, bottomOf(c), under));
          quad(target, base[0], base[1], base[2], base[3]);
        }
      }
    }
    // The heel: from under the hind foot down to the ground (a stacked leather one straight, a Louis heel waisted and
    // curved under the arch, a block, a spike).
    const heelDrop = -ground;
    if (spec.heel && !sole.wedge) {
      const breast = FOOT_HEEL_U + (spec.heel === 'block' ? 0.07 : spec.heel === 'spike' ? 0.04 : 0.062);
      const seat = [];
      const steps = low ? 3 : 5;
      for (let k = 0; k <= steps; k += 1) {
        const u = footLerp(breast, FOOT_HEEL_U - thick + 0.002, Math.sin((k / steps) * Math.PI / 2));
        const [inn] = last.plan(Math.max(u, FOOT_HEEL_U - thick + 0.004));
        seat.push([u, (inn + margin) * (k === steps ? 0.45 : 1)]);
      }
      const ringPlan = [...seat, ...seat.slice().reverse().map(([u, w]) => [u, -w * 1.02])];
      const topRing = ringPlan.map(([u, w]) => warp([u, -FOOT_RISE - th, w]));
      const middle = topRing.reduce((sum, p) => [sum[0] + p[0] / topRing.length, sum[1] + p[1] / topRing.length, sum[2] + p[2] / topRing.length], [0, 0, 0]);
      const height = middle[0] - heelDrop;
      if (height > 0.004) {
        // Each ring down the heel: its size about the heel's middle, and how far it has moved forward (a Louis heel sweeps under the foot).
        const shape = { stacked: [[0, 1, 0], [1, 0.95, 0]], block: [[0, 1, 0], [1, 0.9, 0]], louis: [[0, 1, 0], [0.3, 0.74, 0.004], [0.65, 0.58, 0.009], [1, 0.62, 0.012]], spike: [[0, 0.8, 0], [0.25, 0.4, 0.002], [1, 0.16, 0.004]] }[spec.heel];
        const tint = colour(spec.heel === 'stacked' ? sole.wall : sole.heelColour ?? 'upper');
        const backMost = Math.min(...topRing.map((p) => p[1]));
        const heelRows = shape.map(([t, size, forward]) => topRing.map((p) => {
          // (Straight down from the seat's own outline, drawn in about its back.)
          const anchorY = footLerp(backMost, middle[1], 0.5);
          return [footLerp(p[0], heelDrop, t), anchorY + (p[1] - anchorY) * size + forward * (height / 0.06), middle[2] + (p[2] - middle[2]) * size, tint];
        }));
        const index = sheet(part('sole'), heelRows, true);
        const foot = index[index.length - 1];
        const bottomMid = push(part('sole'), [heelDrop, heelRows.at(-1).reduce((sum, p) => sum + p[1], 0) / topRing.length, middle[2]], colour(sole.under ?? sole.wall));
        for (let j = 0; j < foot.length; j += 1) tri(part('sole'), bottomMid, foot[j], foot[(j + 1) % foot.length]);
      }
    }
  }

  // What is laid on the last.
  const surface = (s, a, lift) => warp(last.at(s, a, lift));
  const normalAt = (s, a, lift) => {
    const p = surface(s, a, lift);
    const q = surface(s, a, lift + 0.004);
    const n = [q[0] - p[0], q[1] - p[1], q[2] - p[2]];
    const size = Math.hypot(...n) || 1;
    return n.map((value) => value / size);
  };
  const cross = (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
  const unit = (a) => {
    const size = Math.hypot(...a) || 1;
    return a.map((value) => value / size);
  };
  /** A flat ribbon `wide` through surface places ([s, a, lift]), lying on the last. */
  const ribbon = (target, places, wide, tint) => {
    const points = places.map(([s, a, lift]) => surface(s, a, lift));
    const rowsOf = points.map((p, k) => {
      const along = unit(points[Math.min(points.length - 1, k + 1)].map((value, axis) => value - points[Math.max(0, k - 1)][axis]));
      const across = unit(cross(normalAt(...places[k]), along));
      return [[p[0] + across[0] * wide / 2, p[1] + across[1] * wide / 2, p[2] + across[2] * wide / 2, tint], [p[0] - across[0] * wide / 2, p[1] - across[1] * wide / 2, p[2] - across[2] * wide / 2, tint]];
    });
    sheet(target, rowsOf, false, mirror < 0);
  };
  /** A cord `r` thick through points, three-sided. */
  const cord = (target, points, r, tint) => {
    const rowsOf = points.map((p, k) => {
      const along = unit(points[Math.min(points.length - 1, k + 1)].map((value, axis) => value - points[Math.max(0, k - 1)][axis]));
      const a = unit(cross(along, Math.abs(along[0]) < 0.9 ? [1, 0, 0] : [0, 1, 0]));
      const b = cross(along, a);
      return [0, 1, 2].map((j) => {
        const angle = (j * 2 * Math.PI) / 3;
        return [p[0] + (a[0] * Math.cos(angle) + b[0] * Math.sin(angle)) * r, p[1] + (a[1] * Math.cos(angle) + b[1] * Math.sin(angle)) * r, p[2] + (a[2] * Math.cos(angle) + b[2] * Math.sin(angle)) * r, tint];
      });
    });
    sheet(target, rowsOf, true, mirror < 0);
  };
  /** A stud: a low four-sided boss at a surface place. */
  const stud = (target, s, a, r, tint, lift = 0) => {
    const p = surface(s, a, lift);
    const n = normalAt(s, a, lift);
    const x = unit(cross(n, Math.abs(n[1]) < 0.9 ? [0, 1, 0] : [1, 0, 0]));
    const y = cross(n, x);
    const top = push(target, [p[0] + n[0] * r * 0.9, p[1] + n[1] * r * 0.9, p[2] + n[2] * r * 0.9], tint);
    const ringIndex = [0, 1, 2, 3].map((j) => {
      const angle = (j * Math.PI) / 2;
      return push(target, [p[0] + (x[0] * Math.cos(angle) + y[0] * Math.sin(angle)) * r, p[1] + (x[1] * Math.cos(angle) + y[1] * Math.sin(angle)) * r, p[2] + (x[2] * Math.cos(angle) + y[2] * Math.sin(angle)) * r], tint);
    });
    for (let j = 0; j < 4; j += 1) (mirror > 0 ? tri(target, top, ringIndex[j], ringIndex[(j + 1) % 4]) : tri(target, top, ringIndex[(j + 1) % 4], ringIndex[j]));
  };
  for (const piece of spec.pieces) {
    if (piece.kind === 'band') {
      // A strap or a wrap round the last: from one section to another, over an arc of it.
      const target = part(piece.role ?? 'trim');
      const tint = colour(piece.colour);
      const [from, to] = piece.arc;
      const whole = to - from >= 360;
      const steps = Math.max(2, Math.round(((to - from) / 360) * around));
      // (A crowd's coarser last stands a little off its true surface: what lies on it is lifted clear.)
      const clear = low ? 0.004 : 0;
      // (`sweep`: the strap leaning back towards the ankle as it runs down to the sole.)
      const bandRow = (s, lift) => Array.from({ length: whole ? steps : steps + 1 }, (_, j) => [...surface(s + (piece.sweep ?? 0) * (j / steps) * (from < 0 ? -1 : 1) + (from < 0 ? piece.sweep ?? 0 : 0), from + ((to - from) * j) / steps, lift), tint]);
      const [s0, s1] = piece.at;
      const wide = s1 - s0 > 0.3 && !low;
      sheet(target, [bandRow(s0, 0), bandRow(s0, piece.lift + clear), ...(wide ? [bandRow((s0 + s1) / 2, piece.lift + clear)] : []), bandRow(s1, piece.lift + clear), bandRow(s1, 0)], whole);
      if (piece.buckle && !low) stud(part('metal'), (s0 + s1) / 2, s0 > 1.9 ? -90 : -70, 0.007, named.white, piece.lift);
    } else if (piece.kind === 'laces' && !low) {
      // Lacing up the front: crossed over, or straight bars, between two rows of eyelets `wide` degrees apart.
      const target = part('trim');
      const tint = colour(piece.colour);
      const wide = piece.wide ?? 20;
      const lift = thick * 0.2 + 0.0015;
      for (let k = 0; k < piece.count; k += 1) {
        const s0 = footLerp(piece.from, piece.to, k / piece.count);
        const s1 = footLerp(piece.from, piece.to, (k + 1) / piece.count);
        if (piece.bar) ribbon(target, [[s0, -wide, lift], [s0, 0, lift + 0.001], [s0, wide, lift]], 0.0035, tint);
        else {
          ribbon(target, [[s0, -wide, lift], [(s0 + s1) / 2, 0, lift + 0.0012], [s1, wide, lift]], 0.003, tint);
          ribbon(target, [[s0, wide, lift], [(s0 + s1) / 2, 0, lift + 0.002], [s1, -wide, lift]], 0.003, tint);
        }
        if (piece.eyelets !== undefined) for (const a of [-wide, wide]) stud(part('metal'), s0, a, 0.0028, named.white, lift * 0.5);
      }
      if (piece.bow) {
        // The thong's ends tied and hanging.
        const s = piece.to;
        ribbon(target, [[s, 0, lift + 0.002], [s - 0.07, 26, lift + 0.004], [s + 0.02, 44, lift + 0.002]], 0.003, tint);
        ribbon(target, [[s, 0, lift + 0.002], [s - 0.07, -26, lift + 0.004], [s + 0.02, -44, lift + 0.002]], 0.003, tint);
      }
    } else if (piece.kind === 'rope' && !(low && piece.role === 'trim')) {
      const target = part(piece.role ?? 'trim');
      const tint = colour(piece.colour);
      for (const path of piece.paths) {
        const points = path.map((place) => {
          // ('toe': down between the big toe and the next, at the sole.)
          if (place[0] === 'toe') return warp([FOOT_TOE_ROOT + 0.012 + FOOT_SLANT * 0.0185, -FOOT_RISE + 0.004, 0.0185]);
          return surface(place[0], place[1], place[2] + (piece.r ?? 0.002));
        });
        cord(target, points, piece.r ?? 0.002, tint);
      }
    } else if (piece.kind === 'studs' && !low) {
      for (const [s, a] of piece.at) stud(part(piece.role ?? 'brass'), s, a, piece.r ?? 0.003, named.white, 0.004);
    } else if (piece.kind === 'lames') {
      // Plates across the foot from one section to another: each a strip over an arc of the last, its edge towards the toe
      // standing off the surface over the next one's, which lies under it; riveted near each end.
      const target = part(piece.role ?? 'metal');
      const arc = Array.isArray(piece.arc) ? piece.arc : [-piece.arc, piece.arc];
      const steps = Math.max(3, Math.round(((arc[1] - arc[0]) / 360) * around * 1.15));
      const [lowLift, highLift] = piece.lift.map((lift) => lift + (low ? 0.004 : 0));
      const gap = piece.gap ?? 0;
      const span = (piece.to - piece.from) / piece.count;
      for (let k = 0; k < piece.count; k += 1) {
        const toeward = piece.from + span * k + (gap * span) / 2;
        const ankleward = piece.from + span * (k + 1) - (gap * span) / 2 + (gap ? 0 : span * 0.12);
        const lameRow = (s, lift) => Array.from({ length: steps + 1 }, (_, j) => {
          const a = footLerp(arc[0], arc[1], j / steps);
          // (A ridge down the middle of a kōgake's plate.)
          const ridged = piece.ridge ? 0.0015 * Math.max(0, 1 - Math.abs(a) / 30) : 0;
          return [...surface(s, a, lift + ridged), named.white];
        });
        // (A long plate follows the last through sections of its own between its edges.)
        const between = low ? 0 : Math.ceil((ankleward - toeward) / 0.22) - 1;
        const rowsOf = [lameRow(toeward, 0), lameRow(toeward, highLift), ...Array.from({ length: between }, (_, n) => lameRow(footLerp(toeward, ankleward, (n + 1) / (between + 1)), footLerp(highLift, lowLift, (n + 1) / (between + 1)))), lameRow(ankleward, lowLift), ...(piece.wall || gap ? [lameRow(ankleward, 0)] : [])];
        sheet(target, rowsOf, false);
        if (piece.edge && !low) {
          const tint = colour(piece.edge);
          for (const s of [toeward, ankleward]) cord(part('trim'), Array.from({ length: steps + 1 }, (_, j) => surface(s, footLerp(arc[0], arc[1], j / steps), (s === toeward ? highLift : lowLift) + 0.0012)), 0.0011, tint);
        }
        if (piece.rivets && !low) {
          const inset = piece.inset ?? 12;
          const s = footLerp(toeward, ankleward, piece.count === 1 ? 0.5 : 0.3);
          const lift = footLerp(highLift, lowLift, 0.3);
          for (const a of [arc[0] + inset, arc[1] - inset]) stud(part(piece.rivets), s, a, 0.003, named.white, lift);
        }
      }
    }
  }

  const done = {};
  let triangles = 0;
  for (const [role, { positions, colors, indices }] of Object.entries(parts)) {
    if (!indices.length) continue;
    done[role] = { positions: new Float32Array(positions), colors: new Float32Array(colors), indices: new Uint16Array(indices) };
    triangles += indices.length / 3;
  }
  return { parts: done, triangles, spec, rise };
}

/**
 * The shank's end, for a foot to meet: from the body's mesh as built (`positions`, and `regions` naming what each point is),
 * the ring of it just over the ankle joint, in the foot's frame (`frame`: { origin, x, y, z }, the bind pose's) and metres:
 * { v: its height over the joint, front, back: how far it reaches before and behind the joint, inner, outer: its half
 * breadths }. `which`: 'skin' the innermost surface there (the skin, or the cloth where the skin under it is left out),
 * 'boot' the boot's leg (loftbody.js lofts it on the shin), 'outer' the outermost. `side`: 'l' or 'r'. Null where the mesh
 * has nothing there (a machine's empty skin).
 */
export function ankleFit(positions, regions, frame, side, which = 'skin', scale = 1) {
  const slab = [0.004 * scale, 0.05 * scale];
  const reach = 0.11 * scale;
  const found = [];
  let lowest = Infinity;
  for (let vertex = 0; vertex < positions.length / 3; vertex += 1) {
    if (which === 'boot' && regions?.[vertex] !== 'boot') continue;
    const d = [positions[vertex * 3] - frame.origin[0], positions[vertex * 3 + 1] - frame.origin[1], positions[vertex * 3 + 2] - frame.origin[2]];
    const v = d[0] * frame.x[0] + d[1] * frame.x[1] + d[2] * frame.x[2];
    if (v < slab[0] || v > slab[1]) continue;
    const u = d[0] * frame.y[0] + d[1] * frame.y[1] + d[2] * frame.y[2];
    const w = d[0] * frame.z[0] + d[1] * frame.z[1] + d[2] * frame.z[2];
    if (Math.hypot(u, w) > reach) continue;
    found.push([v, u, w]);
    lowest = Math.min(lowest, v);
  }
  if (found.length < 6) return null;
  // The lowest band of it, in eight directions round the joint: the nearest (or the furthest) point of each.
  const band = found.filter(([v]) => v < lowest + 0.02 * scale);
  const middle = band.reduce((sum, [, u, w]) => [sum[0] + u / band.length, sum[1] + w / band.length], [0, 0]);
  const sectors = Array.from({ length: 8 }, () => null);
  const inwards = which === 'skin';
  for (const [, u, w] of band) {
    const angle = Math.atan2(w - middle[1], u - middle[0]);
    const sector = ((Math.round((angle / (2 * Math.PI)) * 8) % 8) + 8) % 8;
    const r = Math.hypot(u - middle[0], w - middle[1]);
    if (sectors[sector] === null || (inwards ? r < sectors[sector] : r > sectors[sector])) sectors[sector] = r;
  }
  const known = sectors.filter((r) => r !== null);
  if (known.length < 4) return null;
  const mean = known.reduce((sum, r) => sum + r, 0) / known.length;
  const r = (sector) => sectors[sector] ?? mean;
  const mirror = side === 'l' ? 1 : -1;
  const sideways = [(r(2) * 2 + r(1) + r(3)) / 4, (r(6) * 2 + r(5) + r(7)) / 4];
  return {
    v: Math.min(0.03, Math.max(0.006, lowest / scale + 0.002)),
    front: (middle[0] + (r(0) * 2 + r(1) + r(7)) / 4) / scale,
    back: (middle[0] - (r(4) * 2 + r(3) + r(5)) / 4) / scale,
    inner: (mirror > 0 ? sideways[0] + middle[1] : sideways[1] - middle[1]) / scale,
    outer: (mirror > 0 ? sideways[1] - middle[1] : sideways[0] + middle[1]) / scale,
  };
}

/**
 * The fit a foot of `kind` wants, from what the body offers (`measure(which)`: ankleFit of it): a boot that runs up into a
 * lofted leg meets that leg (else, under a greave, whatever is outermost there); every other foot the innermost surface,
 * the skin or the hose a sock or a shoe's collar goes under.
 */
export function footFit(kind, measure) {
  const cut = (FOOTWEAR[kind] ?? FOOTWEAR.compactBoot).cut ?? 'shaft';
  return cut === 'shaft' ? measure('boot') ?? measure('outer') : measure('skin');
}
