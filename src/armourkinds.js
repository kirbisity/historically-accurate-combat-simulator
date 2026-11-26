// The armour kinds as a table: each kind's pieces, slot by slot, [from, to, inflate, paint] along the part. The drawing builds
// the pieces from it (loftbody.js) and the simulation reads what each piece covers and what it is made of (coverage.js): the
// armour that stops a blow is the armour drawn. Data only, no drawing: moved out of loftbody.js so the simulation imports no
// drawing module (port groundwork, the user's call, 2026-11-26).

// Armour kinds drawn from a table of pieces. Each slot holds one piece or
// a list of them, the same both sides or per side ({ l, r }); a piece is
// [from, to, inflate, paint], along the part (for a forearm, `to` at or
// below 0 counts back from the wrist). Paint is a role, or a pattern of
// roles: rows (by ring), mail (rings in a weave), rivets (dots on a base),
// a front panel, or heraldry (the design's surcoat field).
export const MAIL = { mail: true };
// The Landsknecht's slashed cloth (slashesOn), its puffs' paints: the sword arm's sleeve black slashed over yellow (`dark`), the
// other arm's yellow slashed with black (`light`), the right leg's Pluderhose in lozenges (`lozenged`), the left's in hanging
// panes over the yellow lining (`paned`), the left leg's hose striped (`hose`: the hose colours, `lace` and `charge`).
const LANDSKNECHT = {
  dark: { slashes: { count: 5, rows: 1, width: 0.32, length: 0.7, role: 'cloth2' }, base: 'cloth' },
  light: { slashes: { count: 5, rows: 1, width: 0.45, length: 0.7, role: 'cloth' }, base: 'cloth2' },
  lozenged: { lozenges: { count: 5, rows: 1.2, role: 'cloth2' }, base: 'cloth' },
  paned: { panes: { count: 8, width: 0.45, role: 'cloth' }, base: 'cloth2' },
  hose: { panes: { count: 6, width: 0.5, role: 'charge' }, base: 'lace' },
};
// Japanese laced rows (kozane in kebiki-odoshi): drawn with the kozane's maps where those are drawn (`kozane`).
const LACED = { rows: ['steel', 'lace'], kozane: true };
// Suneate and kote (the Japanese shin guard and armoured sleeve): cloth with iron splints down it (shino), tied on with cords.
export const SPLINTED_SHIN = { splints: 7, base: 'top', tie: 'lace' };
export const SPLINTED_SLEEVE = { splints: 5, base: 'top' };
const MANICA = { rows: ['steel', 'lace'] };
// The Ming elite's neck guard: two steel lames in front of the throat and the top of the chest, the lower stepped out
// over the upper, open at the back and the sides (`front`: the half width round it covers, rad; the user's first
// photograph of a general's household man); no band round the neck (the hood's flaps cover it behind).
// The Ottoman sipahi's dizçek (Askeri Müze; the Met's 16th-century thigh-and-knee defences of mail and plate): rows of
// small plates set in mail over the front of the thigh, from under the skirt's hem to the knee, and a round knee cop
// (the user's call, 2026-11-20: his thighs and knees were drawn bare).
const SIPAHI_KNEES = { thigh: [0.3, 0.98, 1.2, { rows: ['steel', 'steel2', 'mail'] }], knee: [0.82, 1.05, 1.45, 'steel'], };
const ELITE_NECK_GUARD = [[0.94, 1.0, 1.3, { base: 'steel2', front: 0.7 }], [0.9, 0.955, 1.34, { base: 'steel2', front: 0.55 }]];
// The Ming elite's arms: a great spaulder of steel lames over the shoulder,
// and lames down the upper arm (the forearm's to the wrist, in the kit).
const ELITE_ARM = [[-0.24, 1.02, 1.42, { lames: 6, base: 'steel2' }], [-0.2, 0.38, 1.62, { lames: 3, base: 'steel2' }], [0.3, 0.62, 1.58, { lames: 3, base: 'steel2' }]];
const BALTEUS = [0.04, 0.24, 1.14, { rows: ['steel', 'gold', 'steel'] }];
// The banner coats' skirt in two leg panels (loftbody.js legSplit, legPanelsOn): split before and behind (`split`, the
// half width round, rad) from below the apron's foot (`from`, t up the skirt), and the front panel from there down over
// the split before (`front`: the t of its top, its half width round, rad).
const BANNER_LEGS = { split: 0.16, from: -0.3, front: [-0.3, 0.26] };
// The Cuman's plates (ARMOR_KINDS.cumanMail): `rows` narrow lames from `from` to `to` up the trunk (0 hips, 1 neck), each
// `tall` of it (the rest of each step the dark rim between); the columns [centre angle, half width] round the trunk (0 the
// front, π the back), a strip of mail left between each; standing `out` from the skin. The straps closing the split front
// at these heights (`straps`), each `strap` tall and `across` half wide over the split.
const CUMAN_LAMES = {
  rows: 14, from: 0.04, to: 0.86, tall: 0.048, out: 1.18,
  columns: [[0.3, 0.19], [-0.3, 0.19], [1.05, 0.36], [-1.05, 0.36], [2.42, 0.52], [-2.42, 0.52]],
  straps: [0.33, 0.48, 0.63, 0.78], strap: 0.024, across: 0.17,
};
// The line infantryman's crossbelts, each ~6 cm of buff leather (`width`, rad about the trunk): from the shoulder (`shoulder`
// t, at `side` rad off the middle) to the crossing on the breast and the back (`cross` t), then down to the other hip
// (`hip` t, `hipSide` rad off). They stand off the coat as the leather over the wool (`out`): further over the chest
// (`chest`), where the fitted body's breast swells past the lean rings they are laid on.
const CROSSBELT = { shoulder: 0.98, side: 0.55, cross: 0.72, hip: 0.14, hipSide: 1.4, width: 0.28, chest: 1.62, out: 1.42 };
/** The crossbelts as straps: each belt shoulder to crossing to hip, on the front and the back. */
function crossbelts() {
  const { shoulder, side, cross, hip, hipSide, width, chest, out } = CROSSBELT;
  return [0, Math.PI].flatMap((face) => [1, -1].flatMap((hand) => [
    [shoulder, face + hand * side, cross, face, width, chest, 'leather'],
    [cross, face, hip, face - hand * hipSide, width, out, 'leather'],
  ]));
}

/** The Cuman's plates as the trunk's `plates` ([from t, to t, angle, half width, out, role, rim]), and the straps over the front. */
function cumanLames() {
  const { rows, from, to, tall, out, columns, straps, strap, across } = CUMAN_LAMES;
  const step = (to - from) / rows;
  const lames = Array.from({ length: rows }, (_, row) => from + row * step).flatMap((low) => columns.map(([angle, half]) => [low, low + tall, angle, half, out, 'steel', 'steel2']));
  return [...lames, ...straps.map((t) => [t - strap / 2, t + strap / 2, 0, across, out + 0.05, 'leather'])];
}

// The shoulder guard of a Chinese coat of plates (披膊): a flap of the coat's own studded cloth, bound in its binding, hung from
// the shoulder over the sleeve to above the elbow and bowed round the arm (boardOn).
const SHOULDER_FLAP = { studded: 12, base: 'cloth', edge: 'cloth2', board: { wide: 0.25, bow: 0.06, hem: 0.35 } };
export const ARMOR_KINDS = {
  // Tosei gusoku: a solid cuirass of riveted horizontal steel lames, laced
  // skirt and sleeves, the war mask on the kabuto.
  toseiDo: {
    trunk: [-0.1, 1.02, 1.19, { rows: ['steel', 'steel', 'steel2'], rivets: 4 }], skirt: [0.5, 0.45, 1.24, { ...LACED, gaps: [0, Math.PI / 2, -Math.PI / 2], gapWidth: 0.07 }], collar: 'steel',
    upperArm: [-0.2, 0.62, 1.5, { ...LACED, board: { wide: 0.24 } }], forearm: [-0.04, -0.04, 1.3, SPLINTED_SLEEVE], thigh: [0.25, 0.85, 1.3, LACED], shin: [0.04, 0.86, 1.3, SPLINTED_SHIN],
  },
  // The nanban dō gusoku: a European peascod breastplate (one rigid ridged shell, rigidBreastplate) over the Japanese harness,
  // its laced kusazuri, the kusari-kote's mail over the upper arm and splinted forearms, haidate and suneate as the tōsei's.
  nanbanDo: {
    trunk: [[-0.1, 0.97, 1.12, MAIL], [-0.04, 0.96, 1.22, 'steel']], skirt: [0.5, 0.45, 1.24, { ...LACED, gaps: [0, Math.PI / 2, -Math.PI / 2], gapWidth: 0.07 }], collar: 'mail',
    rigidBreastplate: [0.32, 0.96],
    upperArm: [-0.3, 1.04, 1.14, MAIL], forearm: [-0.04, -0.04, 1.3, SPLINTED_SLEEVE], thigh: [0.25, 0.85, 1.3, LACED], shin: [0.04, 0.86, 1.3, SPLINTED_SHIN],
  },
  // Ashigaru: a plain lacquered okegawa-do with the lord's mon, a short skirt,
  // cloth sleeves and simple shin guards.
  okegawa: {
    trunk: [-0.05, 0.96, 1.17, { mon: [0.68, 0.07, 'gold'], base: 'armor' }], skirt: [0.3, 0.4, 1.2, { rows: ['armor', 'lace'], kozane: true }],
    forearm: [-0.04, -0.04, 1.22, 'top'], shin: [0.1, 0.8, 1.3, { ...SPLINTED_SHIN, splints: 5 }],
  },
  // A sea raider's dō-maru: laced lames round the trunk and a laced skirt,
  // nothing on the arms or legs (often a captured or cast-off piece).
  doMaru: {
    trunk: [-0.05, 0.96, 1.16, { rows: ['armor', 'armor', 'lace'], kozane: true }], skirt: [0.4, 0.42, 1.22, { rows: ['armor', 'lace'], kozane: true }],
  },
  // The same with the great shoulder plates (sode) over bare arms.
  doMaruSode: {
    trunk: [-0.05, 0.96, 1.16, { rows: ['armor', 'armor', 'lace'], kozane: true }], skirt: [0.4, 0.42, 1.22, { rows: ['armor', 'lace'], kozane: true }],
    upperArm: [-0.2, 0.62, 1.5, { rows: ['armor', 'lace'], kozane: true, board: { wide: 0.26 } }],
  },
  // A knight in mail: hauberk to the knees, mail sleeves and chausses, and a
  // surcoat in his colours over it.
  mail: {
    trunk: [[-0.12, 1.02, 1.1, MAIL], [-0.1, 0.94, 1.22, { heraldry: true }]], skirt: [[0.62, 0.35, 1.13, MAIL], [0.72, 0.45, 1.32, { heraldry: true }]], collar: 'mail',
    upperArm: [-0.3, 1.04, 1.14, MAIL], forearm: [-0.06, 0, 1.14, MAIL], thigh: [-0.05, 1.04, 1.1, MAIL], shin: [-0.12, 0.95, 1.1, MAIL],
  },
  // A brother-knight of the Temple: the mail hauberk to the knee with mail
  // sleeves, chausses and a coif at the neck; the Order's long surcoat over it
  // to the shins (its cross on the chest); a sword belt; plain steel greaves
  // and knee cops over the chausses.
  templar: {
    // The surcoat is worn clothing, front and back alike, carried by the body
    // (only the mantle over it swings): to the knee, flared for the stride.
    trunk: [[-0.12, 1.02, 1.1, MAIL], [-0.1, 0.94, 1.22, { heraldry: true }]], skirt: [[0.62, 0.35, 1.13, MAIL], [0.95, 0.5, 1.3, { heraldry: true }]], collar: 'mail',
    belt: [0.0, 0.08, 1.25, 'leather'],
    upperArm: [-0.3, 1.04, 1.14, MAIL], forearm: [-0.06, 0, 1.14, MAIL], thigh: [-0.05, 1.04, 1.1, MAIL], knee: [0.84, 1.04, 1.32, 'steel'],
    shin: [[-0.12, 0.95, 1.1, MAIL], [0.05, 0.85, 1.22, 'steel']],
  },
  // Saladin's kazaghand over his hauberk: the hauberk (zardiyya) to the knee
  // and wrist, its mail showing below the coat's hem and sleeves; the
  // kazaghand (mail between padded layers, faced with silk) to above the
  // knee, its front edge and hem in the second colour, buttoned in gold, its
  // sleeves to the elbow, tiraz bands of gold round the upper arms; a silk
  // sash, its ends hanging at the left hip, under the emir's belt of gilt
  // plaques (mintaqa).
  kazaghand: {
    trunk: [[-0.12, 1.02, 1.1, MAIL], [-0.1, 0.97, 1.24, 'cloth']], skirt: [[0.82, 0.42, 1.16, MAIL], [0.66, 0.5, 1.3, { edge: 'cloth2', base: 'cloth' }]],
    // No collar: the helmet's aventail covers the neck, open at the face so the beard shows.
    belt: [[-0.04, 0.12, 1.31, 'cloth2'], [0.0, 0.08, 1.36, { plaques: 12, base: 'leather' }]],
    straps: [[-0.1, 0, 0.97, 0, 0.13, 1.27, 'cloth2']],
    studs: [[0.3, 0, 0.035, 1.3, 'gold'], [0.45, 0, 0.035, 1.3, 'gold'], [0.6, 0, 0.035, 1.3, 'gold'], [0.75, 0, 0.035, 1.3, 'gold']],
    tassels: [[0.62, 0.62, 0.11, 1.52, 'cloth2'], [0.8, 0.5, 0.09, 1.52, 'cloth2']],
    upperArm: [[-0.3, 1.04, 1.14, MAIL], [-0.3, 1.02, 1.26, 'cloth'], [0.16, 0.32, 1.3, 'gold']], forearm: [[-0.06, 0, 1.14, MAIL], [-0.08, 0.1, 1.28, 'cloth2']],
  },
  // A foot soldier: a riveted brigandine over a quilted coat, a short skirt
  // of lames, spaulders, vambraces and knee cops; the legs otherwise bare of steel.
  brigandine: {
    trunk: [-0.06, 0.95, 1.21, { rivets: 3, base: 'cloth' }], skirt: [0.28, 0.35, 1.22, { rows: ['steel', 'steel2'] }],
    upperArm: [-0.2, 0.36, 1.62, 'steel'], forearm: [0.18, -0.08, 1.3, 'steel'], knee: [0.82, 1.05, 1.45, 'steel'],
  },
  // Ming garrison: a padded cotton coat to the knee over trousers, quilted in rows.
  mingQuilt: {
    trunk: [-0.05, 0.95, 1.12, { rows: ['cloth', 'cloth', 'cloth2'] }], skirt: [0.8, 0.5, 1.24, { rows: ['cloth', 'cloth', 'cloth2'] }],
    upperArm: [-0.1, 1.0, 1.12, 'cloth'],
  },
  // Ming garrison as he was (weisuo levy, the 16th century): no armour, a sleeveless vest of coarse hemp to the hip, closed with
  // knotted cloth buttons down the front, a cloth sash round the waist, its ends hanging at the side.
  mingVest: {
    trunk: [-0.1, 0.95, 1.09, 'cloth'], skirt: [0.28, 0.3, 1.17, 'cloth'],
    belt: [-0.03, 0.12, 1.22, 'cloth2'],
    studs: [[0.36, 0, 0.03, 1.1, 'leather'], [0.5, 0, 0.03, 1.1, 'leather'], [0.64, 0, 0.03, 1.1, 'leather'], [0.78, 0, 0.03, 1.1, 'leather'], [0.9, 0, 0.03, 1.1, 'leather']],
    tassels: [[0.55, 0.45, 0.08, 1.26, 'cloth2'], [0.7, 0.38, 0.07, 1.26, 'cloth2']],
  },
  // Ming brigandine (bumianjia, cloth-faced armour): iron plates riveted
  // inside a long coat of cloth, the brass rivet heads in rows over it; its
  // edges and the front opening bound in a dark cloth; a buckled belt; the
  // skirt to below the knee, split before, behind and at the sides for
  // walking and riding; studded shoulder guards over the upper arms; steel
  // bracers.
  mingBrigandine: {
    trunk: [[-0.06, 0.96, 1.2, { studded: 22, base: 'cloth', edge: 'cloth2', opening: 0.012 }], [0.14, 0.24, 1.3, { buckle: 'gold', base: 'leather' }]],
    skirt: [0.95, 0.55, 1.32, { studded: 24, base: 'cloth', edge: 'cloth2', gaps: [0, Math.PI, Math.PI / 2, -Math.PI / 2], gapWidth: 0.05 }],
    // Sleeveless: the rank and file's coat is a vest (the surviving bumianjia vests, the user's two photographs); the
    // arms only in the quilted sleeves of the coat under it. (The elite's coat keeps its arm guards; the lamellar its own.)
    // Its shoulders reach out over the point of the shoulder, the sleeve of the coat under it coming out from beneath them.
    upperArm: [-0.3, 0.14, 1.3, { studded: 10, base: 'cloth', edge: 'cloth2' }],
  },
  // Qi Jiguang's elite infantry (the user's photograph): the regular's long studded coat, trunk and split skirt as his,
  // with sleeves of the same studded cloth to the wrist (as the banner coat's), and over the front (left) forearm's
  // sleeve a plain solid steel tube from below the elbow to above the wrist (outfits.js MING_ARM_GUARD, its `lForearm`).
  mingEliteInfantry: {
    trunk: [[-0.06, 0.96, 1.2, { studded: 22, base: 'cloth', edge: 'cloth2', opening: 0.012 }], [0.14, 0.24, 1.3, { buckle: 'gold', base: 'leather' }]],
    skirt: [0.95, 0.55, 1.32, { studded: 24, base: 'cloth', edge: 'cloth2', gaps: [0, Math.PI, Math.PI / 2, -Math.PI / 2], gapWidth: 0.05 }],
    // The sleeve from the armhole down past the elbow to meet the forearm's (no shirt between). (No shoulder guard over it:
    // the user's call, 2026-11-15, the square flap struck out on a screenshot of Qi's men.)
    upperArm: [-0.3, 1.04, 1.22, { studded: 10, base: 'cloth' }],
    forearm: {
      l: [[-0.04, -0.03, 1.22, { studded: 10, base: 'cloth', edge: 'cloth2' }], [0.12, -0.07, 1.36, 'steel']],
      r: [-0.04, -0.03, 1.22, { studded: 10, base: 'cloth', edge: 'cloth2' }],
    },
  },
  // The Eight Banners' armour (mianjia, cloth armour, the Jurchen's of the 1610s-30s; the Qing's after): the Ming
  // brigandine's own make, iron plates riveted inside a long coat, the rivet heads in rows over it, and drawn as
  // that coat is (its cloth the banner's colour, its binding `cloth2` the banner's border: red, or white on the red
  // banner; on a plain banner the cloth's own colour), down the front too (`placket`, its half width round, rad);
  // hanging from the waist over the skirt the apron panel (`apron`: from, to along it, half its width round), bound
  // in the same; the skirt long, in two leg panels, one over each leg, split before and behind and each bound at its
  // edges, and over the split before the front panel (前裆) hanging from under the apron to the hem (`legs`:
  // BANNER_LEGS; legPanelsOn; the user's photograph of a Qing armour, the strip down between the two halves); the
  // studded shoulder guards; the sleeves of the same studded cloth to the wrist.
  // (In a crowd the splits are painted, in the binding, as the other split skirts' are: `gaps`.)
  bannerCoat: {
    // Cut straight, loose over the waist as the Ming brigandine is not (the banners' coats in the user's photographs).
    straight: true,
    // (No belt shows: the apron hangs over it.) The front opening bound (`placket`); the collar of the same cloth, up under the helmet's hood.
    trunk: [-0.06, 0.96, 1.2, { studded: 22, base: 'cloth', edge: 'cloth2', placket: 0.05 }], collar: 'cloth',
    skirt: [0.95, 0.55, 1.32, { studded: 24, base: 'cloth', edge: 'cloth2', apron: [-0.32, 0.17, 0.42], legs: BANNER_LEGS, gaps: [0, Math.PI], gapWidth: 0.17 }],
    upperArm: [[-0.3, 1.04, 1.22, { studded: 10, base: 'cloth' }], [-0.05, 0.66, 1.3, { ...SHOULDER_FLAP }]], forearm: [-0.04, -0.03, 1.22, { studded: 10, base: 'cloth', edge: 'cloth2' }],
  },
  // The Bayara (the banners' guard, mounted): the same coat in brocade, its rivets close and gilt, the round steel
  // mirror over the heart in a gilt frame, the apron; the skirt with four steel bands across it (`bands`); gilt
  // plates over the shoulders and steel arm guards (lames) to the wrist.
  bayaraCoat: {
    straight: true,
    trunk: [-0.06, 0.97, 1.22, { studded: 28, base: 'cloth', edge: 'cloth2', placket: 0.04, mirror: [0.62, 0.15, 'steel'] }], collar: 'cloth',
    skirt: [0.95, 0.6, 1.34, { studded: 30, base: 'cloth', edge: 'cloth2', apron: [-0.32, 0.17, 0.42], bands: 4, legs: BANNER_LEGS, gaps: [0, Math.PI], gapWidth: 0.17 }],
    upperArm: [[-0.3, 0.5, 1.6, { rows: ['gold', 'gold'] }], [0.45, 1.02, 1.36, { lames: 6, base: 'steel2' }]], forearm: [-0.04, -0.03, 1.34, { lames: 6, base: 'steel2' }],
    mirrors: [[0.62, 0, 0.3, 1.36, 'steel']],
  },
  // A conquistador: the breastplate over his mail shirt, short tassets, and the shirt's mail showing below them to
  // mid-thigh, its sleeves to the wrist and its collar (the long-sleeved mail shirt of 16th-century Spain, worn under the
  // breastplate: the user's call, 2026-11-20, were sleeves to the elbow and no mail below the tassets).
  conquistador: {
    trunk: [[-0.06, 0.97, 1.12, MAIL], [0.1, 0.96, 1.22, 'steel']], skirt: [[0.5, 0.42, 1.15, MAIL], [0.3, 0.4, 1.24, { rows: ['steel', 'steel2'] }]], collar: 'mail',
    rigidBreastplate: [0.32, 0.96],
    upperArm: [-0.3, 1.04, 1.14, MAIL], forearm: [-0.06, 0, 1.14, MAIL],
  },
  // A corset: boned cloth from the hips to under the bust, laced tight (the
  // body under it is drawn in, `cinch`; see LOFT.corset).
  corset: {
    cinch: true,
    trunk: [-0.02, 0.62, 1.1, { boning: true, busk: 5 }],
  },
  // An overbust corset, worn alone: from the hips to just over the bust
  // (below the shoulders' width, so arms at the sides hang clear of it), the
  // shoulders bare; brocade, a steel busk with its clasps down the front,
  // laced up the back, a lace edge along the top.
  overbust: {
    cinch: true,
    trunk: [[-0.04, 0.86, 1.13, { boning: true, busk: 5, brocade: true }], [0.835, 0.875, 1.14, { base: 'lace', frill: true }]],
  },
  // The same with sheer lace sleeves, shoulder to wrist (a lolita's mourning dress).
  overbustSleeved: {
    cinch: true,
    trunk: [[-0.04, 0.86, 1.13, { boning: true, busk: 5, brocade: true }], [0.835, 0.875, 1.14, { base: 'lace', frill: true }]],
    upperArm: [-0.12, 1.02, 1.08, { lacework: true }], forearm: [-0.04, -0.02, 1.08, { lacework: true }],
  },
  // Escaupil and ichcahuipilli: quilted cotton, thick, stitched in rows.
  escaupil: {
    trunk: [-0.06, 0.96, 1.18, { rows: ['cloth', 'cloth', 'cloth2'] }], skirt: [0.42, 0.45, 1.22, { rows: ['cloth', 'cloth', 'cloth2'] }],
    upperArm: [-0.15, 0.55, 1.15, { rows: ['cloth', 'cloth2'] }],
  },
  ichcahuipilli: {
    trunk: [0.0, 0.94, 1.16, { rows: ['cloth', 'cloth', 'cloth2'] }], skirt: [0.22, 0.35, 1.18, { rows: ['cloth', 'cloth', 'cloth2'] }],
  },
  // The Inca uncu: the Andean man's tunic, one length of cloth woven to
  // shape, folded over the shoulders and sewn up the sides, sleeveless, to
  // the knee; its hem bound in a second colour. Plain (a commoner's, of
  // undyed or brown camelid wool and cotton); with a band of tocapu (squares
  // each woven with its own device) round the waist (a lord's); the black
  // and white checkerboard with a red stepped yoke at the neck (the dress
  // the Inca gave his soldiers and guards, `uncuChecks`); and the tocapu all
  // over (the Sapa Inca's own, `uncuRoyal`: none but he wore it).
  uncu: {
    trunk: [-0.1, 0.95, 1.08, 'cloth'], skirt: [0.88, 0.32, 1.16, { edge: 'cloth2', base: 'cloth' }], upperArm: [-0.2, 0.24, 1.08, 'cloth'],
  },
  uncuTocapu: {
    trunk: [-0.1, 0.95, 1.08, { tocapu: [-0.12, 0.16], base: 'cloth' }], skirt: [0.88, 0.32, 1.16, { edge: 'cloth2', base: 'cloth' }],
    upperArm: [-0.2, 0.24, 1.08, 'cloth'],
  },
  uncuChecks: {
    trunk: [-0.1, 0.95, 1.08, { checks: true, yoke: [0.8, 'lace'] }], skirt: [0.88, 0.32, 1.16, { checks: true }],
    upperArm: [-0.2, 0.24, 1.08, { checks: true }],
  },
  uncuRoyal: {
    trunk: [-0.1, 0.95, 1.08, { tocapu: true }], skirt: [0.88, 0.32, 1.16, { tocapu: true }],
    upperArm: [-0.2, 0.24, 1.08, { tocapu: true }],
  },
  // The jaguar knight's suit: the spotted skin over everything, to the wrists and ankles.
  jaguarSuit: {
    trunk: [-0.06, 0.98, 1.16, { spots: true }], skirt: [0.3, 0.4, 1.2, { spots: true }],
    upperArm: [-0.2, 1.02, 1.14, { spots: true }], forearm: [-0.04, -0.02, 1.12, { spots: true }],
    thigh: [0.0, 1.04, 1.1, { spots: true }], shin: [-0.1, 0.95, 1.1, { spots: true }],
  },
  // The eagle knight's suit: rows of feathers.
  featherSuit: {
    trunk: [-0.06, 0.98, 1.18, { rows: ['cloth', 'cloth', 'cloth2'] }], skirt: [0.32, 0.5, 1.24, { rows: ['cloth', 'cloth2'] }],
    upperArm: [-0.2, 1.02, 1.16, { rows: ['cloth', 'cloth2'] }], forearm: [-0.04, -0.02, 1.12, 'cloth'],
    thigh: [0.0, 1.04, 1.12, { rows: ['cloth', 'cloth2'] }],
  },
  // The same men in lamellar: small iron plates laced in rows (`lace`).
  mingLamellar: {
    trunk: [[-0.06, 0.96, 1.2, { lamellae: 30, gaps: [0], gapWidth: 0.025 }], [0.14, 0.24, 1.36, { buckle: 'gold', base: 'leather' }]],
    skirt: [0.92, 0.55, 1.32, { lamellae: 30, gaps: [0, Math.PI / 2, -Math.PI / 2], gapWidth: 0.06 }],
    upperArm: [-0.26, 0.6, 1.52, { lamellae: 16 }], forearm: [-0.04, -0.03, 1.26, 'steel'],
  },
  // The same coat in iron scales: small plates hung from the row above, their
  // pointed ends down, each row lying over the next.
  mingScaleCoat: {
    trunk: [[-0.06, 0.96, 1.2, { lamellae: 30, pointDown: true, gaps: [0], gapWidth: 0.025 }], [0.14, 0.24, 1.36, { buckle: 'gold', base: 'leather' }]],
    skirt: [0.92, 0.55, 1.32, { lamellae: 30, pointDown: true, gaps: [0, Math.PI / 2, -Math.PI / 2], gapWidth: 0.06 }],
    upperArm: [-0.26, 0.6, 1.52, { lamellae: 16, pointDown: true }], forearm: [-0.04, -0.03, 1.26, 'steel'],
  },
  // The elite in scale armour: overlapping iron scales from the collar to
  // below the knee, hung point down, the steel mirror over the heart; the
  // arms and the neck guard as the brigandine elite's.
  mingScale: {
    trunk: [[-0.06, 0.97, 1.22, { lamellae: 30, pointDown: true, gaps: [0], gapWidth: 0.02 }], [0.14, 0.24, 1.38, { buckle: 'gold', base: 'leather' }], ...ELITE_NECK_GUARD],
    skirt: [0.95, 0.6, 1.34, { lamellae: 30, pointDown: true, edge: 'gold', gaps: [0, Math.PI, Math.PI / 2, -Math.PI / 2], gapWidth: 0.05 }], 
    upperArm: ELITE_ARM, forearm: [-0.04, -0.03, 1.34, { lames: 6, base: 'steel2' }], 
    mirrors: [[0.62, 0, 0.3, 1.42, 'steel']],
  },
  // The elite in lamellar (Qi Jiguang's and his guards', Qi Jiguang's level):
  // small iron plates laced in rows from the collar to below the knee, the
  // lacing showing (`lace`), the steel mirror over the heart; the arms and
  // the neck guard as the brigandine elite's. The same protection, drawn so.
  mingEliteLamellar: {
    trunk: [[-0.06, 0.97, 1.22, { lamellae: 30, gaps: [0], gapWidth: 0.02 }], [0.14, 0.24, 1.38, { buckle: 'gold', base: 'leather' }], ...ELITE_NECK_GUARD],
    skirt: [0.95, 0.6, 1.34, { lamellae: 30, edge: 'gold', gaps: [0, Math.PI, Math.PI / 2, -Math.PI / 2], gapWidth: 0.05 }],
    upperArm: ELITE_ARM, forearm: [-0.04, -0.03, 1.34, { lames: 6, base: 'steel2' }], 
    mirrors: [[0.62, 0, 0.3, 1.42, 'steel']],
  },
  // Koxinga's iron men (鐵人, 1650s-60s): a Sino-Japanese harness of their own. The coat of broad iron scales (the
  // ironScale tile: tongue-shaped plates hung in rows, each foot over the row below) from the collar to mid-thigh, belted,
  // the Ming elite's neck guard over it, and the Ming elite's steel arm guards (lamed over the shoulder and upper arm, the
  // forearm in its lames: the user's call, 2026-11-20, were the Japanese kote and shoulder guards); Japanese pieces on the
  // legs, from the Hirado armourers who served the Zheng house: the haidate's laced plates over the thighs under the coat's
  // skirt, the splinted suneate on the shins. No mirror: the scales are the coat.
  ironManScale: {
    trunk: [[-0.06, 0.97, 1.24, { lamellae: 32, pointDown: true, gaps: [0], gapWidth: 0.02 }], [0.14, 0.24, 1.4, { buckle: 'gold', base: 'leather' }], ...ELITE_NECK_GUARD],
    skirt: [0.95, 0.42, 1.36, { lamellae: 32, pointDown: true, gaps: [0, Math.PI, Math.PI / 2, -Math.PI / 2], gapWidth: 0.05 }],
    upperArm: ELITE_ARM, forearm: [-0.04, -0.03, 1.34, { lames: 6, base: 'steel2' }], thigh: [0.25, 0.85, 1.3, LACED], shin: [0.04, 0.86, 1.3, SPLINTED_SHIN],
  },
  // Ming elite: the long brigandine coat to below the knee, its plates
  // riveted close (gilt heads, more and smaller than a soldier's), bound in a
  // dark edge, split for riding; a round steel mirror (huxinjing) over the
  // heart, a buckled belt; a great spaulder of steel lames over each
  // shoulder and lames down the arm to the wrist (ELITE_ARM); the steel
  // neck guard in front of the throat (ELITE_NECK_GUARD).
  mingElite: {
    trunk: [[-0.06, 0.97, 1.22, { studded: 28, base: 'cloth', edge: 'cloth2', opening: 0.012, mirror: [0.62, 0.15, 'steel'] }], [0.14, 0.24, 1.32, { buckle: 'gold', base: 'leather' }], ...ELITE_NECK_GUARD],
    skirt: [0.95, 0.6, 1.34, { studded: 30, base: 'cloth', edge: 'cloth2', gaps: [0, Math.PI, Math.PI / 2, -Math.PI / 2], gapWidth: 0.05 }], 
    upperArm: ELITE_ARM, forearm: [-0.04, -0.03, 1.34, { lames: 6, base: 'steel2' }], 
    mirrors: [[0.62, 0, 0.3, 1.36, 'steel']],
  },
  // Ō-yoroi: its box, skirt panels and shoulder boards are rigid pieces of
  // their own (oyoroi.js); on the body only what is worn on the limbs: the
  // bow arm's brocade sleeve and mailed kote, and the black-lacquered suneate.
  oyoroi: {
    upperArm: { l: [-0.15, 1.02, 1.16, 'cloth2'] },
    forearm: { l: [[-0.06, -0.02, 1.2, MAIL], [-0.04, 0.3, 1.26, 'gold']] },
    shin: [[0.02, 0.86, 1.3, 'steel'], [0.02, 0.1, 1.33, 'gold']],
  },
  // The Iron Pagoda (as reconstructed): lamellar of small dotted iron plates
  // laced in rows, a cuirass to the waist under crossed leather straps, a
  // buckled belt and a braided cord sash with cords hanging; a long skirt of
  // the same to below the knee, split front and sides over a red robe;
  // layered lamellar over the shoulders, the red sleeve at the elbow, lamellar
  // guards to the wrist. Drawn plate by plate (lamellae) but in a crowd.
  ironPagoda: {
    trunk: [[-0.08, 1.0, 1.24, { lamellae: 34 }], [0.2, 0.26, 1.37, { buckle: 'gold', base: 'leather' }], [0.13, 0.18, 1.39, { braid: 'leather', base: 'cloth2' }]],
    skirt: [[1.32, 0.55, 1.28, 'cloth'], [0.98, 0.6, 1.36, { lamellae: 30, gaps: [0, Math.PI / 2, -Math.PI / 2], gapWidth: 0.07, edge: 'gold' }]],
    collar: 'steel',
    upperArm: [[-0.32, 0.5, 1.62, { lamellae: 22 }], [0.45, 0.82, 1.44, { lamellae: 18, shade: 1 }]], forearm: [0.12, -0.02, 1.36, { lamellae: 16 }],
    straps: [[0.98, 0.55, 0.32, -0.75, 0.12, 1.37, 'leather'], [0.98, -0.55, 0.32, 0.75, 0.12, 1.37, 'leather'], [0.98, Math.PI - 0.55, 0.32, Math.PI + 0.75, 0.12, 1.37, 'leather'], [0.98, Math.PI + 0.55, 0.32, Math.PI - 0.75, 0.12, 1.37, 'leather']],
    tassels: [[0.55, 0.75, 0.05, 1.5, 'cloth2'], [0.68, 0.62, 0.05, 1.5, 'cloth2']],
  },
  // Steppe lamellar: iron plates laced in rows to the knees, iron bracers;
  // the leather kind the same cut in hardened hide; the kheshig's gilt-bossed scale.
  steppeLamellar: {
    trunk: [-0.06, 0.98, 1.2, { scales: true }], skirt: [1.0, 0.6, 1.3, { scales: true }], upperArm: [-0.26, 0.55, 1.44, { scales: true }], forearm: [-0.04, -0.03, 1.28, { rows: ['steel', 'steel2'] }],
  },
  steppeLeather: {
    trunk: [-0.06, 0.96, 1.16, { rows: ['cloth', 'cloth', 'cloth2'] }], skirt: [0.9, 0.5, 1.24, { rows: ['cloth', 'cloth2'] }], upperArm: [-0.2, 0.45, 1.32, { rows: ['cloth', 'cloth2'] }],
  },
  kheshig: {
    trunk: [[-0.08, 1.0, 1.22, { lamellae: 30, pointDown: true }], [0.14, 0.24, 1.36, { buckle: 'gold', base: 'leather' }]],
    skirt: [1.05, 0.7, 1.34, { lamellae: 30, pointDown: true, edge: 'gold', gaps: [0, Math.PI], gapWidth: 0.06 }], collar: 'steel',
    upperArm: [[-0.32, 0.45, 1.6, { lamellae: 18, pointDown: true, edge: 'gold' }], [0.45, 1.02, 1.36, { rows: ['steel', 'steel2'] }]], forearm: [-0.04, -0.03, 1.3, { rows: ['steel', 'steel2'] }],
    // The gilt boss over the heart.
    studs: [[0.64, 0, 0.16, 1.32, 'gold']],
  },
  // The lorica hamata of the Republic's legionary: mail to the hips over the
  // tunic (lofted out past the tunic's loose cloth, whose skirt shows below
  // it), the shoulders doubled with a mail cape (humeralia), short sleeves; a belt.
  hamata: {
    trunk: [[-0.12, 0.98, 1.16, MAIL], [0.72, 1.02, 1.24, MAIL]], skirt: [0.28, 0.4, 1.2, MAIL], upperArm: [-0.32, 0.32, 1.22, MAIL],
    belt: [0.02, 0.14, 1.22, { rows: ['lace', 'gold', 'lace'] }],
  },
  // No armour: a leather belt with a bronze buckle over the tunic (a Visigoth
  // warrior's dress, 451). The kit's `cloth` is his shield's paint (weaponview.js).
  girdle: {
    trunk: [0.14, 0.22, 1.2, { buckle: 'gold', base: 'leather' }],
  },
  // The Parthian cataphract (Carrhae, 53 BC; the Dura-Europos graffito and the
  // Khalchayan and Tang-i Sarvak reliefs): a coat of iron scales hung point down
  // from the collar to the knee, split before and behind for the saddle, over a
  // tunic (`cloth`) that shows at the hem, a buckled belt; and the limbs in
  // laminated defences, iron hoops lapping one over the next (as a manica is
  // made) from the shoulder to the wrist and from the hip down to the ankle —
  // the man as closed in iron as his horse. The scales' lacing is `lace`.
  cataphract: {
    trunk: [[-0.08, 1.0, 1.22, { lamellae: 30, pointDown: true, gaps: [0], gapWidth: 0.02 }], [0.14, 0.24, 1.36, { buckle: 'gold', base: 'leather' }]],
    skirt: [[1.12, 0.6, 1.16, 'cloth'], [1.02, 0.68, 1.32, { lamellae: 30, pointDown: true, gaps: [0, Math.PI], gapWidth: 0.06 }]], collar: 'steel',
    upperArm: [[-0.3, 0.38, 1.6, { lamellae: 18, pointDown: true }], [0.3, 1.02, 1.36, { lames: 6, base: 'steel2' }]],
    forearm: [-0.04, -0.03, 1.32, { lames: 7, base: 'steel2' }],
    thigh: [0.55, 1.02, 1.3, { lames: 6, base: 'steel2' }], shin: [-0.06, 0.92, 1.3, { lames: 8, base: 'steel2' }],
  },
  // The Mongol kit as worn by the steppe peoples into the 1600s: the deel to
  // mid-calf over a second robe of another colour showing at the hem, a
  // leather belt with a gilt buckle; the lamellar a vest over it, its skirt
  // split before and behind for the saddle, the deel's sleeves out of the
  // short lamellar shoulders, lamellar bracers; a fox or wolf stole over the
  // shoulders (`fur`). Nothing of it like a Chinese soldier's coat.
  mongolDeel: {
    trunk: [[-0.06, 0.99, 1.1, { panel: [0.1, 0.96, 0.985, 'cloth2'], base: 'cloth' }], [0.18, 0.3, 1.2, { buckle: 'gold', base: 'leather' }]],
    skirt: [[1.32, 0.6, 1.16, 'cloth2'], [1.18, 0.55, 1.2, 'cloth']],
  },
  // Leather lamellar: broad plates of hardened, lacquered hide, fewer and
  // larger than iron ones, laced in rows.
  mongolLamellar: {
    trunk: [[-0.06, 0.99, 1.1, 'cloth'], [-0.02, 0.92, 1.24, { lamellae: 20, gaps: [0], gapWidth: 0.06 }], [0.8, 1.02, 1.42, 'fur'], [0.16, 0.3, 1.34, { buckle: 'gold', base: 'leather' }]],
    skirt: [[1.36, 0.62, 1.16, 'cloth2'], [1.22, 0.56, 1.2, 'cloth'], [0.86, 0.6, 1.32, { lamellae: 18, gaps: [0, Math.PI], gapWidth: 0.1 }]],
    upperArm: [-0.3, 0.4, 1.55, { lamellae: 10 }], forearm: [0.12, -0.02, 1.34, { lamellae: 9 }],
  },
  // The iron-clad horseman (the Ming's, cut as the steppe's): the same in small iron plates, the skirt to the knee.
  mongolIron: {
    trunk: [[-0.06, 0.99, 1.1, 'cloth'], [-0.04, 0.96, 1.24, { lamellae: 32, gaps: [0], gapWidth: 0.04 }], [0.84, 1.02, 1.4, 'fur'], [0.16, 0.3, 1.34, { buckle: 'gold', base: 'leather' }]],
    skirt: [[1.36, 0.62, 1.16, 'cloth2'], [1.24, 0.56, 1.2, 'cloth'], [1.04, 0.62, 1.32, { lamellae: 30, gaps: [0, Math.PI], gapWidth: 0.07 }]], collar: 'steel',
    upperArm: [-0.3, 0.55, 1.55, { lamellae: 18 }], forearm: [0.12, -0.02, 1.34, { lamellae: 14 }],
  },
  // The deel: the steppe robe, crossed over to the right, to below the knee, sashed.
  deel: {
    trunk: [-0.06, 0.99, 1.1, { panel: [0.1, 0.96, 0.985, 'cloth2'], base: 'cloth' }], skirt: [1.05, 0.45, 1.22, 'cloth'], belt: [-0.04, 0.06, 1.16, 'cloth2'],
  },
  // The Janissary's dolama: a long coat buttoned down the front, its skirts to the shin, a sash.
  dolama: {
    trunk: [-0.06, 0.99, 1.1, { panel: [-0.1, 0.96, 0.985, 'cloth2'], base: 'cloth' }], skirt: [1.2, 0.5, 1.22, 'cloth'], belt: [-0.05, 0.07, 1.18, 'lace'],
  },
  // Mail-and-plate (krug): rows of plates set in a mail shirt, mail to the thighs, iron vambraces.
  krug: {
    trunk: [[-0.1, 1.0, 1.12, MAIL], [0.15, 0.85, 1.2, { rows: ['steel', 'steel', 'mail'] }]], skirt: [0.6, 0.45, 1.18, MAIL], collar: 'mail',
    upperArm: [-0.3, 0.55, 1.15, MAIL], forearm: [-0.04, -0.03, 1.3, 'steel'], ...SIPAHI_KNEES,
  },
  // The krug of great plates (Ottoman, 16th century): a mail shirt to the knee, and over it the round domed plate on the
  // belly with its boss, a plate across the breast, one at each side and two down the back, each a rigid piece with the
  // shirt's heavy rings showing between (`plates`, `discs`: their borders gilt); plate shoulder pieces, iron vambraces.
  krugDisc: {
    trunk: [-0.1, 1.0, 1.12, MAIL], skirt: [0.95, 0.5, 1.16, MAIL], collar: 'mail',
    plates: [[0.6, 0.9, 0, 0.62, 1.18, 'steel', 'gold'], [0.18, 0.62, 1.57, 0.36, 1.18, 'steel', 'gold'], [0.18, 0.62, -1.57, 0.36, 1.18, 'steel', 'gold'], [0.5, 0.9, Math.PI, 0.7, 1.18, 'steel', 'gold'], [0.12, 0.46, Math.PI, 0.7, 1.18, 'steel', 'gold']],
    discs: [[0.35, 0, 0.105, 1.24, 'steel', 'gold', 0.022], [0.35, 0, 0.03, 1.24, 'steel', 'steel2', 0.038]],
    upperArm: [[-0.3, 0.55, 1.15, MAIL], [-0.24, 0.14, 1.48, 'steel']], forearm: [-0.04, -0.03, 1.3, 'steel'], ...SIPAHI_KNEES,
  },
  // The bekhter: rows of narrow plates down the chest and back, set in the shirt's mail and gilt along their edges, the
  // front open down the middle and buckled shut with leather straps (`plates`, their straps and buckles); laminated plates
  // over the shoulders, a mail skirt, iron vambraces, and a round boss on the belt.
  bekhter: {
    trunk: [-0.1, 1.0, 1.12, MAIL], skirt: [0.75, 0.45, 1.16, MAIL], collar: 'mail',
    plates: [0.3, 0.38, 0.46, 0.54, 0.62, 0.7, 0.78, 0.86].flatMap((t) => [[t - 0.07, t, 0.5, 0.42, 1.18, 'steel', 'gold'], [t - 0.07, t, -0.5, 0.42, 1.18, 'steel', 'gold'], [t - 0.07, t, Math.PI, 0.95, 1.18, 'steel', 'gold'], [t - 0.045, t - 0.025, 0, 0.2, 1.24, 'leather']]),
    studs: [0.3, 0.38, 0.46, 0.54, 0.62, 0.7, 0.78, 0.86].map((t) => [t - 0.035, 0, 0.045, 1.27, 'gold']),
    belt: [-0.02, 0.1, 1.22, 'leather'],
    discs: [[0.05, 0, 0.045, 1.25, 'steel', 'gold', 0.015]],
    upperArm: [[-0.3, 0.55, 1.15, MAIL], [-0.26, 0.34, 1.48, { lames: 4, base: 'steel' }]], forearm: [-0.04, -0.03, 1.3, 'steel'], ...SIPAHI_KNEES,
  },
  // The Cuman's mail and plates (12th-13th c.; OUTFITS.cumanHeavy): a mail shirt to mid-thigh, its sleeves to the elbow,
  // and laced over it rows of narrow plain steel plates (CUMAN_LAMES) from the collarbone to the hips, in columns: one each
  // side of the split front, one under each arm, two down the back, the dark mail showing in the strips between; the front
  // buckled shut with leather straps (`plates` and their brass buckles, `studs`); a coloured sash wound at the waist under a
  // red leather belt (the kit's `lace`), the bow case's strap across the chest; lames down the outside of the upper arm, hinged steel vambraces.
  cumanMail: {
    trunk: [[-0.1, 1.0, 1.12, MAIL], [0.1, 0.22, 1.27, 'cloth2'], [0.13, 0.19, 1.3, { buckle: 'gold', base: 'lace' }]], skirt: [0.62, 0.6, 1.24, MAIL], collar: 'mail',
    plates: cumanLames(),
    studs: CUMAN_LAMES.straps.map((t) => [t, 0.07, 0.05, 1.3, 'gold']),
    straps: [[0.96, -0.75, 0.2, 1.3, 0.06, 1.29, 'leather']],
    upperArm: [[-0.3, 1.0, 1.14, MAIL], [-0.2, 0.72, 1.42, { lames: 7, base: 'steel' }]], forearm: [-0.04, -0.03, 1.3, 'steel'],
  },
  // An alp's mail hauberk with round mirror plates laced over the breast and back (the char-aina's forerunners).
  mailMirror: {
    trunk: [-0.12, 1.0, 1.12, MAIL], skirt: [0.75, 0.4, 1.16, MAIL], collar: 'mail', upperArm: [-0.3, 1.0, 1.14, MAIL],
    discs: [[0.62, 0, 0.075, 1.16, 'steel', 'gold', 0.015], [0.62, Math.PI, 0.08, 1.16, 'steel', 'gold', 0.012], [0.62, 0, 0.02, 1.16, 'steel', 'steel2', 0.028]],
  },
  // A mail hauberk to the knees, long-sleeved.
  hauberk: {
    trunk: [-0.12, 1.0, 1.12, MAIL], skirt: [0.75, 0.4, 1.16, MAIL], collar: 'mail', upperArm: [-0.3, 1.0, 1.14, MAIL],
  },
  // A patrol officer's vest carrier over the shirt, a badge on the chest, the duty belt.
  patrolVest: {
    trunk: [0.32, 0.8, 1.08, { mon: [0.7, 0.07, 'gold'], base: 'cloth' }], belt: [-0.06, 0.04, 1.16, 'cloth'],
  },
  // A plate carrier: front and back plates over the torso, a band of magazine
  // pouches across the belly, a padded belt.
  plateCarrier: {
    trunk: [[0.3, 0.84, 1.14, { rows: ['cloth', 'cloth', 'cloth2'] }], [0.3, 0.5, 1.2, { panel: [0.3, 0.5, -0.2, 'cloth2'], base: 'cloth' }]], belt: [-0.06, 0.06, 1.18, 'cloth2'],
  },
  // A foot soldier's mail shirt: to the hips, sleeves to the elbow.
  haubergeon: {
    trunk: [-0.12, 1.0, 1.12, MAIL], skirt: [0.3, 0.3, 1.14, MAIL], collar: 'mail', upperArm: [-0.3, 0.5, 1.15, MAIL],
  },
  // A Landsknecht (outfits.js landsknecht): the polished breastplate down to a short fauld and tassets over the belly, and
  // the slashed clothes as pieces of their own over the shirt and hose: the sleeves puffed in two bands on the upper arm and
  // two on the forearm, black slashed over yellow on the sword arm, yellow slashed over black on the other; the Pluderhosen
  // puffed out to just below the knee, the right leg in lozenges of black and yellow, the left in long hanging panes of the
  // ground colour with the yellow lining puffed out between them; the left leg's hose striped red and blue (`lace`, `charge`).
  // The puffs are each a ring of cloth stood well off the limb (`inflate` 1.4-1.6, the gigot's puff ~1.85), narrowing where
  // a band ties them in.
  landsknecht: {
    trunk: [0.1, 0.96, 1.22, 'steel'], rigidBreastplate: [0.32, 0.96],
    skirt: [0.3, 0.36, 1.24, { rows: ['steel', 'steel2'] }],
    upperArm: {
      r: [[-0.3, 0.44, 1.7, LANDSKNECHT.dark], [0.44, 0.53, 1.16, 'cloth'], [0.53, 1.04, 1.56, LANDSKNECHT.dark]],
      l: [[-0.3, 0.44, 1.7, LANDSKNECHT.light], [0.44, 0.53, 1.16, 'cloth2'], [0.53, 1.04, 1.56, LANDSKNECHT.light]],
    },
    forearm: {
      r: [[-0.04, 0.46, 1.5, LANDSKNECHT.dark], [0.46, 0.54, 1.12, 'cloth'], [0.54, -0.06, 1.36, LANDSKNECHT.dark]],
      l: [[-0.04, 0.46, 1.5, LANDSKNECHT.light], [0.46, 0.54, 1.12, 'cloth2'], [0.54, -0.06, 1.36, LANDSKNECHT.light]],
    },
    thigh: {
      r: [[-0.12, 0.56, 1.78, LANDSKNECHT.lozenged], [0.56, 0.64, 1.28, 'cloth'], [0.64, 1.1, 1.64, LANDSKNECHT.lozenged], [1.08, 1.16, 1.14, 'cloth2']],
      l: [[-0.12, 0.56, 1.78, LANDSKNECHT.paned], [0.56, 0.64, 1.28, 'cloth'], [0.64, 1.1, 1.64, LANDSKNECHT.paned], [1.08, 1.16, 1.14, 'cloth2']],
    },
    shin: { l: [0.04, 0.94, 1.03, LANDSKNECHT.hose] },
  },
  // A foot soldier's breastplate and backplate, a short fauld, knee cops: nothing on the arms.
  breastplate: {
    trunk: [-0.04, 0.96, 1.19, 'steel'], skirt: [0.22, 0.3, 1.2, { rows: ['steel', 'steel2'] }], knee: [0.82, 1.05, 1.45, 'steel'],
    rigidBreastplate: [0.32, 0.96],
  },
  // The line infantryman's coatee (the Napoleonic wars to the 1840s): wool to the waist in front, short tails behind (here
  // the skirt all round to the top of the thigh), the regiment's facings down the front, at the collar and the cuffs; over it two
  // broad belts of pipeclayed buff leather, one from each shoulder to the other hip (the cartridge box's and the bayonet's),
  // crossed on the breast and the back, a brass plate where they cross.
  crossbelts: {
    trunk: [-0.06, 0.99, 1.1, { panel: [-0.06, 0.96, 0.985, 'cloth2'], base: 'cloth' }], skirt: [0.42, 0.45, 1.16, 'cloth'], collar: 'cloth2',
    forearm: [0.72, 0, 1.12, 'cloth2'],
    straps: crossbelts(),
    studs: [[CROSSBELT.cross, 0, 0.07, CROSSBELT.chest + 0.04, 'gold']],
  },
  // The cuirassier's cuirass (the French an XI, 1802-1806): a rounded breast and a back of ~2-3 mm iron to the waist, joined
  // at the shoulders by brass-scaled straps and at the sides by a belt; no fauld, the thighs in breeches and the great boots.
  cuirass: {
    trunk: [[-0.02, 0.96, 1.2, 'steel'], [0.0, 0.05, 1.26, 'leather']],
    rigidBreastplate: [0.3, 0.96],
    studs: [[0.92, 0, 0.03, 1.24, 'gold'], [0.92, Math.PI, 0.03, 1.24, 'gold'], [0.5, Math.PI / 2, 0.03, 1.26, 'gold'], [0.5, -Math.PI / 2, 0.03, 1.26, 'gold']],
  },
  // The Qing soldier's jacket of the 1830s-40s (号衣/号褂): a sleeveless coat to the thigh over the long-sleeved robe, bound
  // in a second colour at its edges, a white disc on the breast (and the back) with his corps' character (兵, 勇).
  qingHaoyi: {
    trunk: [-0.08, 0.97, 1.12, { mon: [0.66, 0.09, 'lace'], base: 'cloth' }], skirt: [0.42, 0.42, 1.18, { edge: 'cloth2', base: 'cloth' }],
    belt: [-0.03, 0.08, 1.2, 'cloth2'],
  },
  // The Upper Palaeolithic hunter's clothes (the Sungir burials, ~34,000 years ago, their beads laid out on the bodies;
  // the bone needles of the Gravettian): a tailored tunic of hide to the thigh with short sleeves, its edges in fur, a belt
  // of hide; leggings and moccasins of hide.
  hides: {
    trunk: [-0.1, 0.95, 1.12, 'cloth'], skirt: [0.4, 0.45, 1.2, { edge: 'cloth2', base: 'cloth' }], collar: 'cloth2',
    belt: [-0.03, 0.06, 1.2, 'leather'],
    upperArm: [-0.25, 0.55, 1.12, { edge: 'cloth2', base: 'cloth' }],
  },
  // Murmillo: belt, the manica on the sword arm, a short greave on the lead leg over a quilted wrap.
  murmillo: {
    belt: BALTEUS, upperArm: { r: [-0.25, 1.02, 1.32, MANICA] }, forearm: { r: [-0.06, -0.02, 1.32, MANICA] },
    thigh: { l: [0.62, 1.0, 1.18, 'pad'] }, shin: { l: [-0.05, 0.55, 1.32, 'steel'] },
  },
  // Secutor: like the murmillo, the greave higher.
  secutor: {
    belt: BALTEUS, upperArm: { r: [-0.25, 1.02, 1.32, MANICA] }, forearm: { r: [-0.06, -0.02, 1.32, MANICA] },
    thigh: { l: [0.55, 1.0, 1.18, 'pad'] }, shin: { l: [-0.12, 0.9, 1.32, 'steel'] },
  },
  // Retiarius: no helmet, no greaves; the galerus standing up from the left shoulder, a manica on that arm.
  retiarius: {
    belt: BALTEUS, upperArm: { l: [[-0.32, 0.28, 2.0, 'steel'], [0.2, 1.02, 1.3, MANICA]] }, forearm: { l: [-0.06, -0.02, 1.3, MANICA] },
  },
  // Maximus: the leather under his harness (the detail is arenaview's
  // buildHarness): the cuirass's layers, the left shoulder guard, the bracers.
  maximus: {
    trunk: [-0.06, 0.96, 1.13, { rows: ['armor', 'armor', 'lace'] }],
    upperArm: { l: [[-0.32, 0.22, 1.7, { rows: ['armor', 'lace'] }], [0.15, 0.45, 1.42, { rows: ['armor', 'lace'] }]] },
    forearm: [0.42, -0.02, 1.24, { rows: ['armor', 'lace'] }],
  },
  // Guan Yu: the green robe crossed over the breast and down to the shins,
  // its dark green edge, a gilt belt; the gilt scale shows where it is
  // proud of the robe, over the shoulders and down the arms.
  guanYu: {
    trunk: [-0.08, 1.0, 1.24, { panel: [0.1, 0.96, 0.985, 'cloth2'], base: 'cloth' }], skirt: [1.2, 0.55, 1.3, { rows: ['cloth', 'cloth', 'cloth', 'cloth2'] }], belt: [-0.04, 0.07, 1.28, 'gold'], collar: 'cloth',
    upperArm: [[-0.32, 0.45, 1.62, { scales: true }], [0.45, 1.02, 1.36, { rows: ['steel', 'steel2'] }]], forearm: [-0.04, -0.03, 1.3, { rows: ['steel', 'steel2'] }],
  },
  // A Han soldier: a vest of small iron lamellae to the waist, with short
  // lamellar flaps over the shoulders, over a red robe to the knee.
  hanLamellar: {
    trunk: [-0.06, 0.95, 1.18, { scales: true }], skirt: [0.95, 0.5, 1.2, { rows: ['cloth', 'cloth', 'cloth', 'cloth2'] }], belt: [-0.04, 0.05, 1.22, 'lace'],
    upperArm: [-0.3, 0.2, 1.42, { scales: true }],
  },
  // The wuxia robe: crossed over the breast, to the shins, a sash.
  wuxiaRobe: {
    trunk: [-0.06, 0.99, 1.12, { panel: [0.1, 0.96, 0.985, 'cloth2'], base: 'cloth' }], skirt: [1.15, 0.55, 1.22, 'cloth'], belt: [-0.05, 0.08, 1.18, 'cloth2'],
  },
  // The lorica segmentata: iron hoops round the trunk from the armpits to
  // the waist, each lapping the one below, girth plates and the collar of
  // plates over the shoulders; lames over the upper arm; a studded belt.
  segmentata: {
    trunk: [-0.02, 0.97, 1.22, { rows: ['steel', 'steel', 'steel2'] }], collar: 'steel',
    upperArm: [-0.32, 0.4, 1.6, { rows: ['steel', 'steel', 'steel2'] }], belt: [0.02, 0.18, 1.26, { rows: ['lace', 'gold', 'lace'] }],
  },
  // A centurion's mail to the thigh, doubled over the shoulders, a belt; greaves.
  centurion: {
    trunk: [-0.12, 0.98, 1.14, MAIL], skirt: [0.32, 0.4, 1.18, MAIL], upperArm: [-0.32, 0.3, 1.2, MAIL],
    belt: [0.02, 0.16, 1.2, { rows: ['lace', 'gold', 'lace'] }], shin: [-0.12, 0.88, 1.3, 'steel'],
  },
  // A huque: a sleeveless cloth tunic over the armour, to the upper thigh,
  // open at the sides below the waist (here: the skirt split by its flare).
  huque: {
    trunk: [-0.1, 0.94, 1.26, { panel: [0.0, 0.94, 0.995, 'cloth2'], base: 'cloth' }], skirt: [0.34, 0.6, 1.34, 'cloth'],
  },
  // Commodus: nothing lofted; the lion's skin is drawn whole (arenaview's buildLionPelt).
  commodus: {},
  // Scissor: a shirt of bronze scales to the hips, the manica, the left
  // forearm in a steel tube (its crescent blade is the scissores, carried as
  // a shield), greaves on both shins.
  scissor: {
    trunk: [-0.16, 0.98, 1.16, { scales: true }], belt: BALTEUS, collar: 'steel',
    upperArm: { r: [-0.25, 1.02, 1.32, MANICA], l: [-0.2, 0.5, 1.4, { scales: true }] }, forearm: { r: [-0.06, -0.02, 1.32, MANICA], l: [-0.1, 0.06, 1.55, 'steel'] },
    shin: [-0.1, 0.88, 1.32, 'steel'],
  },
  // A silverback's fur is his skin's colour; the silver saddle over the
  // back and down the hips (`back`: from, to up the piece, its role), the
  // rest of the coat black (`cloth`).
  silverback: {
    trunk: [-0.12, 1.02, 1.03, { back: [-0.12, 0.8, 'armor'], base: 'cloth' }],
    thigh: [0, 0.5, 1.03, { back: [0, 1, 'armor'], base: 'cloth' }],
  },
  // Thraex: quilted wraps up both thighs, high greaves over them, the manica.
  thraex: {
    belt: BALTEUS, upperArm: { r: [-0.25, 1.02, 1.32, MANICA] }, forearm: { r: [-0.06, -0.02, 1.32, MANICA] },
    thigh: [[0.05, 0.75, 1.2, { rows: ['pad', 'kit'] }], [0.68, 1.05, 1.34, 'steel']], shin: [-0.14, 0.9, 1.32, { rows: ['steel', 'steel', 'gold'] }],
  },
};

/** What an armour piece's paint (loftbody.js ARMOR_KINDS) says it is made of (see ARMOUR_TILES), or null. */
export function pieceMaterial(paint) {
  if (!paint) return null;
  if (typeof paint === 'string') return ['steel', 'steel2', 'gold'].includes(paint) ? 'steel' : ['mail', 'armor', 'pad'].includes(paint) ? paint : null;
  if (typeof paint !== 'object') return null;
  if (paint.mail) return 'mail';
  if (paint.lamellae) return paint.pointDown ? 'scales' : 'lamellae';
  if (paint.scales) return 'scales';
  if (paint.kozane) return 'kozane';
  if (paint.studded || (paint.rivets && paint.base === 'cloth')) return 'studded';
  if (paint.lames) return 'steel';
  // Cloth over bones (a corset: whalebone or steel in stitched channels).
  if (paint.boning) return 'boned';
  const roles = [...(paint.rows ?? []), ...(paint.base ? [paint.base] : []), ...(paint.mon ? [paint.mon[2]] : [])];
  if (!roles.length) return null;
  // (Plates set in mail, rows of each, are steel: the mail and plate tile has both.)
  if (roles.every((role) => ['steel', 'steel2', 'gold', 'mail'].includes(role)) && roles.some((role) => role !== 'mail')) return 'steel';
  if (roles.every((role) => role === 'armor' || role === 'gold')) return 'armor';
  return null;
}
