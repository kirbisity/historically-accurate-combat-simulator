// The town kit's skyline: a part of a town drawn as what shows of it over a wall or down a street from a district
// away, made from the same plan items its full drawing is made from (build.js, hanok.js, works.js descriptions), so
// that the two always agree. At street eye height a town wall or a yard wall hides everything but the roofs, the
// halls' and the pavilions' upper storeys, the towers and the trees; from a wall's walk the nearest of those stand 40 m
// and more off. So each house is one roof mass on a wall box (its eave line and ridge, no tiles, rafters or bays),
// a hall or a pavilion its terrace, its storeys as boxes and a roof mass over each, a pagoda its stacked bodies, a
// yard wall a strip of its height, a town wall a strip of its height with its parapet's merlons, a tree a cone (a
// pine) or an egg of an oak's dead leaves (a bare tree is seen through, and left out). Some 20 to 30 triangles a house against the
// full drawing's 400 to 900. Everything is laid at the 'all' level: a skyline has no finer detail to switch.

import { tkgFrame } from './geo.js';
import { TK_HOUSE } from './build.js';
import { TK_HANOK } from './hanok.js';
import { TK_WORKS } from './works.js';

/**
 * The skyline's make (m; colours multiply the kit's sheets): `pitch` a tiled roof's rise over its run (the houses'
 * own, TK_HOUSE.pitch); `hall` a hall's or a pavilion's roof: its overhang and its pitch (steeper than a house's, as
 * the full drawing's tkPavilion roofs are), `skirt` the skirt roof's rise between two storeys; `core` how far a
 * pavilion's open storey is drawn in from its columns' line (its columns read as a dark mass behind the eaves); the
 * colours of a tiled roof, a house's wall, a pavilion's timber, thatch (TK_HANOK.thatch), stone; trees: a pine's
 * needles, an oak's dead leaves (the far woods' colours, places/pyongyang.js PY_WOODS), a
 * crown's share of the tree's height and its width over its height (an oak's thinner crown `oakShare` of that). By eye against the full drawing seen from 40 m
 * and more.
 */
export const TK_SKYLINE = {
  pitch: TK_HOUSE.pitch,
  hall: { overhang: 1.5, pitch: 0.6 },
  skirt: 0.9,
  core: 0.3,
  tile: [0.6, 0.62, 0.64], wall: TK_HOUSE.plaster, timber: [0.36, 0.2, 0.15], thatch: TK_HANOK.thatch.colour, stone: TK_WORKS.stone,
  trees: { pine: [0.2, 0.27, 0.19], oak: [0.66, 0.5, 0.28], crown: 0.62, wide: 0.32, oakShare: 0.75 },
};

const tksScale = (colour, by) => colour.map((value) => value * by);

/**
 * A roof mass in `frame` (local +z its front, its eave's middle at local y `eave`): `wide` along x by `deep` along z
 * at the eave (the overhang taken in), its ridge `rise` over the eave. `kind` 'gable' carries the ridge to the ends
 * (upright gable ends in `endMaterial`); else it is hipped. Closed underneath, so that no slope is seen from inside.
 */
export function tkSkylineRoof(builder, frame, { wide, deep, eave, rise, kind = 'hip', material = 'rooftile', colour = TK_SKYLINE.tile, endMaterial = 'plaster', endColour = TK_SKYLINE.wall }) {
  const [w, d] = [wide / 2, deep / 2];
  const ridge = kind === 'gable' ? w : Math.max(0, w - d);
  const [a, b, c, e] = [frame(-w, eave, d), frame(w, eave, d), frame(w, eave, -d), frame(-w, eave, -d)];
  const [r1, r2] = [frame(-ridge, eave + rise, 0), frame(ridge, eave + rise, 0)];
  builder.quad(material, a, b, r2, r1, { colour });
  builder.quad(material, c, e, r1, r2, { colour });
  const [endM, endC] = kind === 'gable' ? [endMaterial, endColour] : [material, colour];
  builder.tri(endM, b, c, r2, [[0, 0], [deep, 0], [d, rise]], endC);
  builder.tri(endM, e, a, r1, [[0, 0], [deep, 0], [d, rise]], endC);
  builder.quad(material, a, e, c, b, { colour: tksScale(colour, 0.45) });
}

/** A house (tkHouse's or tkThatch's spec, `kind` 'thatch' for a cottage) as its wall box and its roof mass. */
export function tkSkylineHouse(builder, house) {
  const s = TK_SKYLINE;
  const frame = tkgFrame(house.at[0], house.base ?? 0, house.at[1], house.yaw ?? 0);
  const thatch = house.kind === 'thatch';
  const eave = thatch ? house.heights?.[0] ?? 2.35 : (house.heights?.[0] ?? TK_HOUSE.storeys[0]) + ((house.storeys ?? 1) > 1 ? house.heights?.[1] ?? TK_HOUSE.storeys[1] : 0);
  const overhang = thatch ? TK_HANOK.thatch.overhang : house.roof?.overhang ?? TK_HOUSE.overhang;
  const rise = thatch ? house.depth * 0.42 : house.roof?.rise ?? (house.depth / 2 + overhang) * s.pitch;
  builder.box('plaster', frame, -house.width / 2, house.width / 2, -0.3, eave, -house.depth / 2, house.depth / 2, { colour: s.wall, skip: 'bottom top' });
  const kind = thatch || house.roof?.kind !== 'gable' ? 'hip' : 'gable';
  tkSkylineRoof(builder, frame, { wide: house.width + 2 * overhang, deep: house.depth + 2 * overhang, eave, rise, kind, material: thatch ? 'earth' : 'rooftile', colour: thatch ? s.thatch : house.roof?.tint ?? s.tile });
}

/** A terrace (tkTerrace's: width, depth, high, in `frame` at its foot) as a box of its stone. */
function tksTerrace(builder, frame, width, depth, high) {
  if (high > 0.05) builder.box('ashlar', frame, -width / 2, width / 2, -0.3, high, -depth / 2, depth / 2, { colour: TK_HANOK.granite, skip: 'bottom' });
}

/** A hall (tkHall's spec: at, yaw, base, width, depth, high, terrace, apron) as its terrace, its body and its roof. */
export function tkSkylineHall(builder, hall) {
  const s = TK_SKYLINE;
  const frame = tkgFrame(hall.at[0], hall.base ?? 0, hall.at[1], hall.yaw ?? 0);
  const [terrace, apron, high] = [hall.terrace ?? 0.9, hall.apron ?? 1.6, hall.high ?? 3.4];
  tksTerrace(builder, frame, hall.width + 2 * apron, hall.depth + 2 * apron, terrace);
  const body = frame.child(0, terrace, 0);
  builder.box('timber', body, -hall.width / 2, hall.width / 2, 0, high, -hall.depth / 2, hall.depth / 2, { colour: s.timber, skip: 'bottom top' });
  const o = s.hall.overhang;
  tkSkylineRoof(builder, body, { wide: hall.width + 2 * o, deep: hall.depth + 2 * o, eave: high, rise: (hall.depth / 2 + o) * s.hall.pitch, colour: hall.tint ?? s.tile });
}

/**
 * A pavilion in storeys (tkPavilion's `storeys`) in `frame` at its floor: each storey a dark core box under the one
 * above, a skirt roof round every storey but the last, the last a roof mass. Returns its top's local height.
 */
export function tkSkylinePavilion(builder, frame, storeys, tint = TK_SKYLINE.tile) {
  const s = TK_SKYLINE;
  const o = s.hall.overhang;
  let y = 0;
  storeys.forEach((storey, index) => {
    const [w, d] = [storey.width / 2 - s.core, storey.depth / 2 - s.core];
    builder.box('timber', frame, -w, w, y, y + storey.high, -d, d, { colour: s.timber, skip: 'bottom top' });
    const last = index === storeys.length - 1;
    tkSkylineRoof(builder, frame, { wide: storey.width + 2 * o, deep: storey.depth + 2 * o, eave: y + storey.high, rise: last ? (storey.depth / 2 + o) * s.hall.pitch : s.skirt, colour: tint });
    y += storey.high;
  });
  return y;
}

/** A pavilion on a terrace (tkTerracePavilion's spec: at, yaw, base, storeys, terrace, apron). */
export function tkSkylineTerracePavilion(builder, p) {
  const frame = tkgFrame(p.at[0], p.base ?? 0, p.at[1], p.yaw ?? 0);
  const [terrace, apron] = [p.terrace ?? 1.0, p.apron ?? 1.2];
  tksTerrace(builder, frame, p.storeys[0].width + 2 * apron, p.storeys[0].depth + 2 * apron, terrace);
  tkSkylinePavilion(builder, frame.child(0, terrace, 0), p.storeys);
}

/** A yard wall's run (a, b: [x, z]) `high` m on the ground at `base`, `thick` through, as a strip. */
export function tkSkylineWall(builder, a, b, { high = TK_HANOK.yard.high, thick = TK_HANOK.yard.thick, base = 0, material = 'plaster', colour = TK_SKYLINE.wall } = {}) {
  const length = Math.hypot(b[0] - a[0], b[1] - a[1]);
  if (length < 0.05) return;
  const frame = tkgFrame(a[0], base, a[1], Math.atan2(-(b[1] - a[1]), b[0] - a[0]));
  builder.box(material, frame, 0, length, -0.3, high, -thick / 2, thick / 2, { colour, skip: 'bottom' });
}

/**
 * A town wall along `nodes` ([x, z, foot, top] each, as works.js tkRampart's: its outer side on the left walking
 * them) as a strip from its foot to its walk, `face + walk` thick, with its parapet's merlons on the outer edge.
 */
export function tkSkylineRampart(builder, nodes, { face = 0.3, walk = 3.5, parapet = 1.1, thick = 0.6, colour = TK_SKYLINE.stone } = {}) {
  const [long, crenel] = TK_WORKS.merlon;
  for (let k = 0; k + 1 < nodes.length; k += 1) {
    const [ax, az, footA, topA] = nodes[k];
    const [bx, bz, footB, topB] = nodes[k + 1];
    const length = Math.hypot(bx - ax, bz - az);
    const frame = tkgFrame(ax, 0, az, Math.atan2(-(bz - az), bx - ax));
    const [foot, top] = [Math.min(footA, footB), (topA + topB) / 2];
    builder.box('rubble', frame, 0, length, foot - 0.3, top, -face - walk, 0, { colour, skip: 'bottom' });
    const pieces = Math.max(1, Math.round(length / (long + crenel)));
    for (let n = 0; n < pieces; n += 1) builder.box('rubble', frame, (n * length) / pieces + crenel / 2, ((n + 1) * length) / pieces - crenel / 2, top, top + parapet, -face - thick, -face, { colour, skip: 'bottom' });
  }
}

/** A stone pagoda (tkStonePagoda's: at world x, y, z, `tiers`, `size`) as its stacked bodies. */
export function tkSkylinePagoda(builder, x, y, z, { tiers = 5, size = 1.5 } = {}) {
  const frame = tkgFrame(x, y, z, 0);
  let [at, w] = [0, size * 1.6];
  builder.box('ashlar', frame, -w / 2, w / 2, -0.2, 0.9, -w / 2, w / 2, { colour: TK_HANOK.granite, skip: 'bottom' });
  at = 0.9;
  w = size;
  for (let k = 0; k < tiers; k += 1) {
    const high = w * 0.62;
    builder.box('ashlar', frame, -w / 2, w / 2, at, at + high, -w / 2, w / 2, { colour: TK_HANOK.granite, skip: 'bottom' });
    builder.box('ashlar', frame, -w * 0.72, w * 0.72, at + high, at + high + 0.14, -w * 0.72, w * 0.72, { colour: TK_HANOK.granite, skip: 'bottom' });
    at += high + 0.14;
    w *= TK_HANOK.pagoda.shrink;
  }
}

/**
 * A tree (tkTree's: at world x, y, z, `kind` 'pine' | 'bare' | 'oak', `high`) as a cone of needles (a pine) or an egg
 * of an oak's dead leaves. A bare tree is left out: its twigs are seen through, and as a solid egg it read as a roof.
 */
export function tkSkylineTree(builder, x, y, z, { kind = 'bare', high = 8 } = {}) {
  const t = TK_SKYLINE.trees;
  const frame = tkgFrame(0, 0, 0, 0);
  const crown = high * t.crown;
  const radius = high * t.wide;
  if (kind === 'pine') {
    builder.round('rock', frame, x, z, y + high - crown, y + high, radius, 0.02, { sides: 6, caps: '', colour: t.pine });
    return;
  }
  if (kind !== 'oak') return;
  const r = radius * t.oakShare;
  builder.round('rock', frame, x, z, y + high - crown, y + high - crown * 0.5, r * 0.55, r, { sides: 6, caps: '', colour: tksScale(t.oak, 0.86) });
  builder.round('rock', frame, x, z, y + high - crown * 0.5, y + high, r, r * 0.25, { sides: 6, caps: 'top', colour: t.oak });
}

/**
 * A part of a town as its skyline (the makers above), into `builder`: `items` the plan's lists as the full drawing
 * takes them, any of { houses, halls, pavilions (on terraces), terraces ({ at, yaw, base, width, depth, high }), walls
 * ({ run, base, high, low }), gates (roofed gates: { at, yaw, base }), pagodas ({ at, y, tiers, size }), trees ({ at, y,
 * kind, high }), ramparts ({ nodes, ...wall }) }.
 */
export function tkSkyline(builder, items) {
  for (const house of items.houses ?? []) tkSkylineHouse(builder, house);
  for (const hall of items.halls ?? []) tkSkylineHall(builder, hall);
  for (const p of items.pavilions ?? []) tkSkylineTerracePavilion(builder, p);
  for (const t of items.terraces ?? []) tksTerrace(builder, tkgFrame(t.at[0], t.base ?? 0, t.at[1], t.yaw ?? 0), t.width, t.depth, t.high);
  for (const w of items.walls ?? []) tkSkylineWall(builder, w.run[0], w.run[1], { base: w.base, high: w.high, thick: w.low ? 0.5 : TK_HANOK.yard.thick, material: w.material ?? 'plaster', colour: w.low ? TK_SKYLINE.stone : TK_SKYLINE.wall });
  for (const g of items.gates ?? []) {
    const frame = tkgFrame(g.at[0], g.base ?? 0, g.at[1], (g.yaw ?? 0) + Math.PI / 2);
    const { way, high, roof } = TK_HANOK.gate;
    tkSkylineRoof(builder, frame, { wide: way + 0.9 + 2 * roof.overhang, deep: 1.9 + 2 * roof.overhang * 0.6, eave: high + 0.28, rise: roof.rise });
  }
  for (const p of items.pagodas ?? []) tkSkylinePagoda(builder, p.at[0], p.y, p.at[1], p);
  for (const t of items.trees ?? []) tkSkylineTree(builder, t.at[0], t.y, t.at[1], t);
  for (const r of items.ramparts ?? []) tkSkylineRampart(builder, r.nodes, r);
}
