// Armour that wears out where it is struck: each blow that lands on a piece leaves its mark on the spot it met (a hand's
// breadth of it), and what a spot has taken is kept for the bout. How that damage shows, and what it costs the man, comes from
// how the armour is made (its `construction`, ARMOUR_WEAR.constructions), never from a rule for one kit:
// - laced lamellar: the lacing runs over the plates' faces, so an edge that lands there cuts the cords under it and a heavy
//   blow tears them; a row whose laces are cut at a spot gapes there (a point or an edge finds the opening, as the gap rules
//   have it, physics/gaps.js), then its plates come loose; a piece hung on those cords (a sode, a skirt panel, a row of the
//   neck guard) swings on what is left of them and falls; a piece gone leaves the place bare;
// - mail: rings split at a spot after repeated hard blows, a small hole that lets the next blows there through a little more;
// - scale: scales torn or lifted at a spot, a point from below worst (it goes in under their free edges);
// - a coat of plates: its cover cut, rivets pulled, the plates shifting, gaps opening, slower than lacing;
// - padding: cut through layer by layer, stopping less at that spot each time.
// Plate never comes apart (the user's call, 2026-11-24): it has no construction here and every blow meets it fresh.
//
// Pure: physics.js registerWeaponImpact asks what the spot a blade meets has left (armourWornAt) before the blow is weighed,
// and tells it what the blow did (wearArmour) after; render.js reads `fighter.armourWear` to loosen and drop what hangs.
// The figures are fitted to what lacing does (Bryant, The Samurai, 1989; Sinclaire, Arms and Armour of the Samurai, 2001:
// kebiki odoshi's dense silk is the ō-yoroi's weak point, cut by repeated blows and costly to re-lace; Dien, Armour in
// China, and the Wujing Zongyao's tightly bound lamellar: laced through holes, little cord on the face; Robinson, Oriental
// Armour, 1967): a single cut parts a few cords, not a row; a few hard cuts at one place part it; glancing blows do nothing.

import { P, SEGMENTS } from '../body.js';
import { vec } from '../pose.js';

const awPoint = (fighter, name) => [fighter.x[P[name] * 3], fighter.x[P[name] * 3 + 1], fighter.x[P[name] * 3 + 2]];

export const ARMOUR_WEAR = {
  // A spot: a hand's breadth (m) along a part and round it, about what one blade's cut at the same place falls within.
  spot: 0.12,
  // Each construction: `threshold` (J of work at the spot) a blow must bring before it harms the construction at all (a glancing
  // blow, a light one: nothing); `strength` (J past that) that takes a spot from whole to its first full failure (wear 1);
  // `cap`: the most one blow can do (of wear 1), however hard (one cut parts the cords under the edge, not the whole row);
  // `exposure`: of each kind of work, the share that reaches what fails (an edge on the cords over the plates' faces, a
  // point between them, the jar of a blunt blow tearing them); `below`: a point driven upward under free edges does this
  // many times as much (scales); `stages`: by wear, what the spot has come to: its name, `keep` (the share of its proof left
  // against an edge and a point; a blunt blow is spread as the square root of it), `gape` (the share of blows there that meet
  // the opening and what is under it, as a gap), `loose` (a piece hung there swings on what is left), `gone` (it falls off; the
  // place bare); `max`: wear beyond which it does not go (mail holed is holed).
  constructions: {
    // The ō-yoroi's kebiki odoshi: silk braid laced densely over the whole face of every row, its hanging pieces (sode,
    // kusazuri, the shikoro's rows) hung on that lacing: a hard cut (100-150 J of edge) parts a few cords, two leave the row
    // gaping, three part it and five or six drop it; a glancing cut (~30 J) does nothing however often. A point goes between
    // the cords more than through them (little of a thrust reaches them); only a very heavy blunt blow (a kanabō's ~150 J)
    // tears them, slowly (about 27 to loosen).
    kebiki: {
      threshold: 30, strength: 200, cap: 0.4, exposure: { cut: 1, pierce: 0.35, blunt: 0.25 }, below: 1, max: 2,
      stages: [{ at: 0.5, name: 'gaping', keep: 0.8, gape: 0.25 }, { at: 1, name: 'loose', keep: 0.55, gape: 0.5, loose: true }, { at: 2, name: 'gone', keep: 0, gone: true }],
    },
    // Other laced lamellar (the Mongol, Ming, Han and steppe lamellar, the Tibetan style): laced as the ō-yoroi is but tighter
    // and through the plates, little of the cord on the face, so it takes more than twice the blows at one spot (the user's
    // call, 2026-11-24): a hard cut of 150 J needs 7 at one spot to part a row and 13 to drop a hung piece (the ō-yoroi's 3
    // and 5), a 100 J cut 13 and 26 (its 3 and 6); however hard the cut, no fewer than 8 and 15 (`cap`: the ō-yoroi's
    // fewest are 3 and 5); a point or a blunt blow does not reach its cords.
    lamellar: {
      threshold: 40, strength: 450, cap: 0.14, exposure: { cut: 0.75, pierce: 0.3, blunt: 0.1 }, below: 1, max: 2,
      stages: [{ at: 0.5, name: 'gaping', keep: 0.85, gape: 0.2 }, { at: 1, name: 'loose', keep: 0.6, gape: 0.4, loose: true }, { at: 2, name: 'gone', keep: 0, gone: true }],
    },
    // A coat of plates (brigandine, the Ming and banner coats, the Bayara coat): the cloth cut, rivets pulled, the plates shifted
    // and gaps opened, slower than lacing (the user's call, 2026-11-24): however hard the cuts, no fewer than 12 at one spot
    // open it (the lamellar's fewest to loosen, 8); nothing falls off (the plates are riveted to the cover).
    brigandine: {
      threshold: 50, strength: 800, cap: 0.09, exposure: { cut: 0.7, pierce: 0.4, blunt: 0.15 }, below: 1, max: 1,
      stages: [{ at: 0.5, name: 'shifted', keep: 0.85, gape: 0.12 }, { at: 1, name: 'open', keep: 0.65, gape: 0.3 }],
    },
    // Riveted mail: only slight damage, rings split at the struck spot after repeated hard blows, a small hole (the user's
    // call, 2026-11-24). Riveted rings take a hard blow's edge without parting (no fewer than 7 at one spot, however hard; ~10
    // hard 150 J cuts, ~50 of 100 J); split, the hole lets a little more through.
    mail: {
      threshold: 70, strength: 500, cap: 0.15, exposure: { cut: 0.8, pierce: 1, blunt: 0.25 }, below: 1, max: 1,
      stages: [{ at: 1, name: 'holed', keep: 0.8 }],
    },
    // Butted mail (the Japanese kusari, much Indian and later mail): its rings only closed, not riveted, spring open sooner.
    buttedMail: {
      threshold: 40, strength: 280, cap: 0.2, exposure: { cut: 0.8, pierce: 1, blunt: 0.25 }, below: 1, max: 1,
      stages: [{ at: 1, name: 'holed', keep: 0.75 }],
    },
    // Scale: slight, as mail (the user's call, 2026-11-24): scales torn off or lifted at a spot; a point from below, under their
    // free edges, worst.
    scale: {
      threshold: 55, strength: 420, cap: 0.2, exposure: { cut: 0.6, pierce: 0.8, blunt: 0.2 }, below: 2.5, max: 1,
      stages: [{ at: 1, name: 'lifted', keep: 0.78 }],
    },
    // Padding (a gambeson, a quilted jack, the Mexica cotton ichcahuipilli, an escaupil): cut through layer by layer, stopping
    // less each time at that spot (the user's call, 2026-11-24): its proof goes down with the wear (`layers`: at wear 1 this
    // much of it is left), not by stages.
    padded: {
      threshold: 15, strength: 300, cap: 0.3, exposure: { cut: 1, pierce: 0.7, blunt: 0.05 }, below: 1, max: 1, layers: 0.35,
      stages: [{ at: 1, name: 'cut through', keep: 0.35 }],
    },
  },
  // What a piece is made of (coverage.js materials) to its construction, unless the kit says otherwise (`kits`). Steel (plate),
  // splints, boned cloth: none. Cloth: only in a kit of padding (`kits`).
  byStuff: { kozane: 'kebiki', lamellae: 'lamellar', scales: 'scale', mail: 'mail', studded: 'brigandine' },
  // A kit's own say, by the stuff at a place (or `all` for a kit drawn without a coverage table): Japanese mail is butted; the
  // Han lamellar is drawn point-down but laced; the Iron Pagoda, the cataphract and the iron-man coat fail as scale does (the
  // user's call, 2026-11-24); the kits of padding.
  kits: {
    oyoroi: { mail: 'buttedMail' }, doMaru: { mail: 'buttedMail' }, doMaruSode: { mail: 'buttedMail' }, toseiDo: { mail: 'buttedMail' },
    nanbanDo: { mail: 'buttedMail' }, okegawa: { mail: 'buttedMail' },
    // (The samurai's laced armour drawn without a table: kebiki over all of it.)
    lamellar: { all: 'kebiki' },
    hanLamellar: { scales: 'lamellar' },
    ironPagoda: { lamellae: 'scale' }, cataphract: { lamellae: 'scale' }, ironManScale: { kozane: 'scale' },
    escaupil: { cloth: 'padded' }, ichcahuipilli: { cloth: 'padded' }, jaguarSuit: { cloth: 'padded' }, featherSuit: { cloth: 'padded' },
    kazaghand: { cloth: 'padded' },
  },
  // What hangs (and so can fall) by the slot it is drawn in: the shoulder guards and flaps (a board or sleeve on the upper arm),
  // the skirt's panels (front, back and each side), the neck guard's rows. Only a construction with a `gone` stage drops them.
  hanging: { upperArm: 'shoulder', skirt: 'skirt' },
  // The neck guard of a helmet, by the helmet's kind or its aventail: its construction, and where on the head it is (`rise`: a
  // blow on the head whose surface faces less up than this, the sine, and further round from the face than `round` degrees,
  // meets it); `rows`: how many rows it hangs in, top to bottom over `span` of the rise below that.
  helmets: {
    kabuto: { construction: 'kebiki', rise: 0.15, round: 55, rows: 5, span: 1.1 },
    aventail: { lamellar: { construction: 'lamellar', rise: 0.1, round: 60, rows: 4, span: 1.1 }, mail: { construction: 'mail', rise: 0.1, round: 60, rows: 1, span: 1.1 } },
  },
  // A piece that falls: thrown off at the part's speed and this (m/s) along the blow.
  throw: 0.8,
};

/** The construction of the armour at a place: the stuff there (coverage.js material) as the kit makes it, or null (plate, cloth, none). */
export function armourConstructionOf(gear, stuff) {
  const own = ARMOUR_WEAR.kits[gear?.cover?.armor];
  const name = own?.[stuff] ?? own?.all ?? ARMOUR_WEAR.byStuff[stuff] ?? null;
  return name && ARMOUR_WEAR.constructions[name] ? name : null;
}

/** The neck guard of the helmet he wears (ARMOUR_WEAR.helmets), or null. */
function awNeckGuardOf(gear) {
  const head = gear?.cover?.head;
  if (!head) return null;
  if (ARMOUR_WEAR.helmets[head]) return ARMOUR_WEAR.helmets[head];
  return ARMOUR_WEAR.helmets.aventail[gear.cover.aventail] ?? null;
}

/** Which way a surface faces round a part, as one of `count` equal sectors from his front (0) round to his left. */
function awSectorOf(normal, axis, forward, count) {
  const flat = vec.sub(normal, vec.scale(axis, vec.dot(normal, axis)));
  let ahead = vec.sub(forward, vec.scale(axis, vec.dot(forward, axis)));
  if (vec.length(ahead) < 1e-6 || vec.length(flat) < 1e-6) return 0;
  ahead = vec.normalize(ahead);
  const left = vec.cross(axis, ahead);
  const angle = Math.atan2(vec.dot(flat, left), vec.dot(flat, ahead));
  return ((Math.round((angle / (Math.PI * 2)) * count) % count) + count) % count;
}

/** His trunk's up, left and forward from his own landmarks (as physics/gaps.js gapTrunkFrame). */
function awTrunk(fighter) {
  const pelvis = awPoint(fighter, 'pelvis');
  const up = vec.normalize(vec.sub(awPoint(fighter, 'neck'), pelvis));
  const across = vec.add(vec.sub(awPoint(fighter, 'lShoulder'), awPoint(fighter, 'rShoulder')), vec.sub(awPoint(fighter, 'lHip'), awPoint(fighter, 'rHip')));
  const left = vec.normalize(vec.sub(across, vec.scale(up, vec.dot(across, up))));
  return { up, left, forward: vec.cross(up, left) };
}

/**
 * Where on his armour a blow lands: the spot (a key), the hanging piece it is part of (or null), and its construction; null
 * where nothing there wears (plate, cloth, bare). `key` the struck part (physics.js capsules), `along` how far along it (0..1),
 * `normal` the struck surface's outward way, `piece` what is drawn outermost there ({ slot, material }, physics.js
 * armourPieceAt), `radius` the part's (m).
 */
export function armourSpotAt(fighter, key, along, normal, piece, radius) {
  const gear = fighter.body.gear;
  const trunk = awTrunk(fighter);
  if (key === 'head') {
    const guard = fighter.helmetOff ? null : awNeckGuardOf(gear);
    if (!guard) return null;
    const up = vec.normalize(vec.sub(awPoint(fighter, 'head'), awPoint(fighter, 'neck')));
    const rise = vec.dot(normal, up);
    const sector = awSectorOf(normal, up, trunk.forward, 12);
    const round = Math.min(sector, 12 - sector) * 30;
    if (rise >= guard.rise || round < guard.round) return null;
    const row = Math.max(0, Math.min(guard.rows - 1, Math.floor(((guard.rise - rise) / guard.span) * guard.rows)));
    return { spot: `head|${row}|${sector}`, piece: `neck:${row}`, row, construction: guard.construction };
  }
  const part = key.replace(/^[lr](?=[A-Z])/, '');
  const side = /^[lr](?=[A-Z])/.test(key) ? key[0] : null;
  const name = part === 'trunk' ? 'trunk' : part[0].toLowerCase() + part.slice(1);
  // (A kit drawn without a coverage table: its slot by the part, its stuff its own.)
  const slot = piece?.slot ?? (name === 'thigh' ? 'skirt' : name);
  const construction = armourConstructionOf(gear, piece?.material ?? 'unknown');
  if (!construction) return null;
  const segment = SEGMENTS[key];
  const axis = key === 'trunk' || !segment ? trunk.up : vec.normalize(vec.sub(awPoint(fighter, segment.to), awPoint(fighter, segment.from)));
  const length = key === 'trunk' || !segment ? vec.length(vec.sub(awPoint(fighter, 'neck'), awPoint(fighter, 'pelvis'))) : vec.length(vec.sub(awPoint(fighter, segment.to), awPoint(fighter, segment.from)));
  const rows = Math.max(1, Math.round(length / ARMOUR_WEAR.spot));
  const round = Math.max(4, Math.round((Math.PI * 2 * radius) / ARMOUR_WEAR.spot));
  const sector = awSectorOf(normal, axis, trunk.forward, round);
  const row = Math.max(0, Math.min(rows - 1, Math.floor((along ?? 0.5) * rows)));
  const spot = `${key}|${slot}|${row}|${sector}`;
  const hangs = ARMOUR_WEAR.hanging[slot];
  if (!hangs) return { spot, piece: null, construction };
  if (hangs === 'shoulder') return { spot, piece: `shoulder:${side ?? 'l'}`, construction };
  // A skirt's panel: the front, the back, or his left or right side, by the way the struck surface faces.
  const ahead = vec.dot(normal, trunk.forward);
  const panel = ahead > Math.SQRT1_2 ? 'front' : ahead < -Math.SQRT1_2 ? 'back' : vec.dot(normal, trunk.left) >= 0 ? 'l' : 'r';
  return { spot, piece: `skirt:${panel}`, construction };
}

/** His armour's wear (made the first time it is asked for). */
export function armourWearOf(fighter) {
  fighter.armourWear ??= { spots: {}, pieces: {}, version: 0 };
  return fighter.armourWear;
}

/** The stage a construction is at with `wear` (the last of its stages reached), or null short of its first. */
export function armourStageAt(construction, wear) {
  const spec = ARMOUR_WEAR.constructions[construction];
  let reached = null;
  for (const stage of spec?.stages ?? []) if (wear >= stage.at) reached = stage;
  return reached;
}

/**
 * What a place on him has left, before a blow there is weighed: `keep` (the share of its proof against an edge and a point;
 * a blunt blow spread by its square root), `gape` (the share of blows that meet an opening there), `gone` (the piece is not
 * there: the place is bare, or what is under). Whole: keep 1, no gape. `at` the place (armourSpotAt), null for none.
 */
export function armourWornAt(fighter, at) {
  const whole = { keep: 1, gape: 0, gone: false };
  if (!at || !fighter.armourWear) return whole;
  const wear = fighter.armourWear;
  const piece = at.piece ? wear.pieces[at.piece] : null;
  if (piece?.gone) return { keep: 0, gape: 0, gone: true };
  // (A row of the neck guard hangs from the rows above it: any of them gone, it is gone with them.)
  if (at.row !== undefined && at.piece?.startsWith('neck:')) {
    for (let row = 0; row < at.row; row += 1) if (wear.pieces[`neck:${row}`]?.gone) return { keep: 0, gape: 0, gone: true };
  }
  const spot = wear.spots[at.spot];
  if (!spot) return whole;
  const spec = ARMOUR_WEAR.constructions[at.construction];
  if (spec.layers !== undefined) return { keep: 1 - (1 - spec.layers) * Math.min(1, spot.wear), gape: 0, gone: false };
  const stage = armourStageAt(at.construction, spot.wear);
  if (!stage) return whole;
  return { keep: stage.keep, gape: stage.gape ?? 0, gone: Boolean(stage.gone) };
}

/**
 * The work a blow does on the armour at a spot (J), before the threshold: its edge's on what is over the plates, its point's,
 * its blunt jar's, each by the construction's exposure; a point driven up under free edges by `below` (`travel` the blade's
 * way, `up` his).
 */
export function wearWork(construction, { edge = 0, point = 0, blunt = 0, travel = null, up = null }) {
  const spec = ARMOUR_WEAR.constructions[construction];
  if (!spec) return 0;
  const rising = travel && up && point > 0 && vec.length(travel) > 1e-6 ? vec.dot(vec.normalize(travel), up) > 0.35 : false;
  return edge * spec.exposure.cut + point * spec.exposure.pierce * (rising ? spec.below : 1) + blunt * spec.exposure.blunt;
}

/** The wear (of 1) a blow's work adds to a spot of a construction: none below its threshold, at most its cap. */
export function wearFrom(construction, work) {
  const spec = ARMOUR_WEAR.constructions[construction];
  if (!spec || work <= spec.threshold) return 0;
  return Math.min(spec.cap, (work - spec.threshold) / spec.strength);
}

/**
 * A blow has met the armour at `at` (armourSpotAt) with `work` (wearWork): its spot wears (at most to the construction's max),
 * and a hanging piece takes the worst of its spots: each new stage a world event ('armourWear'), a piece that falls thrown off
 * as debris (`place`: { point, velocity, along }, the blow's place, the part's speed and the blade's way). Returns the new
 * stage reached (or null).
 */
export function wearArmour(world, fighter, at, work, place) {
  if (!at) return null;
  const spec = ARMOUR_WEAR.constructions[at.construction];
  const added = wearFrom(at.construction, work);
  if (!spec || !(added > 0)) return null;
  const wear = armourWearOf(fighter);
  const spot = (wear.spots[at.spot] ??= { wear: 0, blows: 0, construction: at.construction, piece: at.piece });
  if (spot.wear >= spec.max) return null;
  const before = armourStageAt(at.construction, spot.wear);
  spot.wear = Math.min(spec.max, spot.wear + added);
  spot.blows += 1;
  wear.version += 1;
  const after = armourStageAt(at.construction, spot.wear);
  let piece = null;
  if (at.piece) {
    piece = (wear.pieces[at.piece] ??= { wear: 0, blows: 0, construction: at.construction, stage: null });
    piece.blows += 1;
    piece.wear = Math.max(piece.wear, spot.wear);
    const stage = armourStageAt(at.construction, piece.wear);
    piece.stage = stage?.name ?? null;
    piece.loose = Boolean(stage?.loose || stage?.gone);
    if (stage?.gone && !piece.gone) {
      piece.gone = true;
      dropArmourPiece(world, fighter, at, piece, place);
      // (The rows of a neck guard below a row that falls hang from it: they go with it.)
      if (at.row !== undefined) {
        for (const [name, other] of Object.entries(wear.pieces)) if (name.startsWith('neck:') && Number(name.slice(5)) > at.row) other.gone = other.loose = true;
        wear.fallenRow = Math.min(wear.fallenRow ?? Infinity, at.row);
      }
    }
  }
  if (after && after !== before) {
    world.events.push({
      time: world.time, kind: 'armourWear', fighter: fighter.id, spot: at.spot, piece: at.piece ?? undefined, construction: at.construction, stage: after.name, blows: spot.blows,
      point: place?.point, effects: [`${at.piece ? at.piece.replace(':', ' ') : 'armour'} ${after.name}`],
    });
  }
  return after !== before ? after : null;
}

/** A hung piece whose cords are cut through falls (the debris system, physics.js moveDebris): a board of its size, thrown off. */
function dropArmourPiece(world, fighter, at, piece, place) {
  const [kind] = at.piece.split(':');
  // (Its size, m: a sode ~30 × 36 cm, a skirt panel ~35 × 36, a row of the neck guard ~40 × 6.)
  const [width, length] = kind === 'shoulder' ? [0.3, 0.36] : kind === 'skirt' ? [0.35, 0.36] : [0.4, 0.06];
  const v = vec.add(place?.velocity ?? [0, 0, 0], vec.scale(place?.along ? vec.normalize(place.along) : [0, 0, 0], ARMOUR_WEAR.throw));
  piece.debris = world.debris.length;
  world.debris.push({
    id: world.debris.length, kind: 'armour', piece: at.piece, construction: at.construction, owner: fighter.id, x: [...(place?.point ?? awPoint(fighter, 'pelvis'))], v,
    q: [0, 0, 0, 1], spin: [(world.random() - 0.5) * 6, (world.random() - 0.5) * 4, (world.random() - 0.5) * 6], radius: 0.015, axis: [0, 1, 0], half: length / 2, width, plate: true, resting: false,
  });
  world.events.push({ time: world.time, kind: 'armourFell', fighter: fighter.id, piece: at.piece, construction: at.construction, debris: piece.debris, point: place?.point, effects: [`${at.piece.replace(':', ' ')} falls`] });
}
