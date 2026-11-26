// The town kit's skyline: a part of a town drawn as what shows of it over a wall or down a street from a district
// away, made from the same plan items its full drawing is made from (build.js, hanok.js, works.js descriptions), so
// that the two always agree. At street eye height a town wall or a yard wall hides everything but the roofs, the
// halls' and the pavilions' upper storeys, the towers and the trees; from 30 to 40 m on, a roof's tile rolls, the
// rafters, the lattice and the brackets are a pixel or less. So each roof is the full drawing's own roof (geo.js
// tkgRoofSlopes: the same hollow slope, the same eaves turning up at the corners, the same hip-and-gable) cut into a
// few strips instead of a strip every two tile rows, with its ridge, its hips and its gables; a house its walls under
// it as a box, its front the dark of its bays; a hall or a pavilion its terrace, its red columns, its beams, the dark
// of its lattice, a skirt roof round every storey but the last; a gate tower its stone block, arch and parapet as
// the full drawing lays them (they are few), its pavilion as a pavilion is; a yard wall the full drawing's own (some
// fifty triangles); a town wall a strip of its height with its parapet's merlons; a tree the full drawing's own tree
// (build.js tkTree, the same seed, so the same boughs and the same sprays of needles under their snow), its limbs
// with fewer sides (`lean`). Some 100 to 150 triangles a house against the full drawing's 9,000, its colours its
// own (the plan's tints, the kit's finishes and sheets). Everything is laid at the 'all' level: a skyline has no finer
// detail to switch.

import { tkgFrame, tkgRoofSlopes } from './geo.js';
import { TK_HOUSE, tkTree, tkYardWall } from './build.js';
import { TK_HANOK } from './hanok.js';
import { TK_WORKS, tkGatehouse } from './works.js';
import { tkRandom } from './tex.js';

/**
 * The skyline's make (m; colours multiply the kit's sheets): `strips` how many strips a slope's straight run between
 * its turned-up corners is cut into (its hollow is across it, not along: one), and `rows` down a hollow slope (2: its
 * hollow reads, against the full drawing's 5);
 * a pavilion's `column` sides (4: a column is a few pixels across from 30 m); the colours of a house's wall, its front
 * (the dark of its bays: lattice, doors and the rooms behind them, about the full drawing's mean seen from 30 m), a
 * pavilion's timber, stone; thatch (TK_HANOK.thatch). By eye against the full drawing seen from 30 m and more.
 */
export const TK_SKYLINE = {
  strips: 1,
  rows: 2,
  column: 4,
  wall: TK_HOUSE.plaster, front: 0.42, timber: [0.36, 0.2, 0.15], thatch: TK_HANOK.thatch.colour, stone: TK_WORKS.stone,
};

const tksScale = (colour, by) => colour.map((value) => value * by);
const tksSub = (a, b) => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
const tksCross = (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
const tksUnit = (a) => {
  const length = Math.hypot(a[0], a[1], a[2]) || 1;
  return [a[0] / length, a[1] / length, a[2] / length];
};

/**
 * A ridge or a hip's crest along `points`: its two sides as a tent `wide` across and `high` over the line (from 30 m
 * its ends and underside are never seen: a sweep's, four faces and two ends, twice the triangles).
 */
function tksCrest(builder, material, points, wide, high, colour) {
  for (let k = 0; k + 1 < points.length; k += 1) {
    const [a, b] = [points[k], points[k + 1]];
    const side = tksUnit(tksCross(tksSub(b, a), [0, 1, 0]));
    const at = (p, s, h) => [p[0] + side[0] * s * wide / 2, p[1] + h, p[2] + side[2] * s * wide / 2];
    builder.quad(material, at(a, 1, 0), at(b, 1, 0), at(b, 0, high), at(a, 0, high), { colour });
    builder.quad(material, at(b, -1, 0), at(a, -1, 0), at(a, 0, high), at(b, 0, high), { colour });
  }
}

/**
 * A tiled roof (tkgRoof's spec: kind, width, depth, eave, rise, overhang, verge, sag, lift, liftRun, breakAt, inner,
 * tint, tiles, ridge, gableMaterial, gableColour) in `frame`, cut coarse: each slope in strips broken where it turns
 * (its hips, the run of each turned-up corner, halved) and rows down its hollow (TK_SKYLINE), lit by the slope's own
 * curve; the underside of its eaves; its ridge with its ends turned up, its hips; a hip-and-gable's gables.
 */
export function tkSkylineRoof(builder, frame, spec) {
  const s = TK_SKYLINE;
  const { tint = [1, 1, 1], tiles = 'rooftile', timber = [0.3, 0.22, 0.17], ridge = {} } = spec;
  const slopes = tkgRoofSlopes(spec);
  const world = (p) => frame(p[0], p[1], p[2]);
  const turned = (normal) => tksUnit(tksSub(frame(normal[0], normal[1], normal[2]), frame(0, 0, 0)));
  const rows = spec.sag || spec.lift ? s.rows : 1;
  const liftRun = spec.liftRun ?? 2.5;
  for (const [index, slope] of slopes.entries()) {
    // (A hipped roof's end slopes, short and steep under the hips: one row, broken only at the gable's knee and the
    // turned-up corners.)
    const end = index >= 2;
    const normalAt = (u, v) => {
      const e = 0.01;
      const along = tksSub(slope.point(u + e, v), slope.point(u - e, v));
      const down = tksSub(slope.point(u, Math.min(1, v + e)), slope.point(u, Math.max(0, v - e)));
      const normal = tksUnit(tksCross(down, along));
      return normal[1] < 0 ? normal.map((value) => -value) : normal;
    };
    // Where the slope turns along its eave: its ends, where each hip (or the gable's knee) begins, the turned-up
    // corners' runs (and halfway along them), and the straight run between in `strips`.
    const half = slope.half;
    const breaks = new Set([-half, half]);
    for (let k = 1; k < s.strips; k += 1) breaks.add(-half + (2 * half * k) / s.strips);
    if (spec.lift) for (const sign of [-1, 1]) for (const share of end ? [0.5] : [1, 0.4]) breaks.add(sign * (half - liftRun * share));
    // (Where the line the slope starts from turns: a hip leaving the ridge, the gable's knee; found by stepping along
    // the eave and taking each step where the line's own slope changes. A strip across a turn would cut it off.)
    const steps = 64;
    const startAt = (k) => Math.min(1, slope.start(-half + (2 * half * k) / steps));
    for (let k = 2; k + 2 <= steps; k += 1) {
      if (Math.abs(startAt(k + 1) - 2 * startAt(k) + startAt(k - 1)) < 1e-6) continue;
      // (The turn itself: where the line through the two steps before meets the line through the two after.)
      const [before, after] = [startAt(k - 1) - startAt(k - 2), startAt(k + 2) - startAt(k + 1)];
      const at = Math.abs(before - after) < 1e-9 ? k : (startAt(k + 1) - (k + 1) * after - startAt(k - 1) + (k - 1) * before) / (before - after);
      breaks.add(-half + (2 * half * Math.max(k - 1, Math.min(k + 1, at))) / steps);
    }
    // (A hip-and-gable's front and back slopes step from the ridge down to the gable's knee at the gable: a break there,
    // each strip's head taken just inside its own ends.)
    if (slopes.gable && !end) for (const sign of [-1, 1]) breaks.add(sign * slopes.gable.half);
    const us = [...breaks].filter((u) => u >= -half && u <= half).sort((a, b) => a - b).filter((u, i, list) => i === 0 || u - list[i - 1] > 0.05);
    const tuck = Math.min(slope.run * (1 - slope.from) - 0.02, (spec.overhang ?? 0.6) + 0.35);
    const vIn = 1 - tuck / slope.run;
    const board = timber.map((value) => value * 0.8);
    for (let k = 0; k + 1 < us.length; k += 1) {
      const [ua, ub] = [us[k], us[k + 1]];
      const va0 = Math.min(1, slope.start(ua + 1e-4));
      const vb0 = Math.min(1, slope.start(ub - 1e-4));
      if (va0 >= 1 && vb0 >= 1) continue;
      const cut = end ? 1 : rows;
      for (let r = 0; r < cut; r += 1) {
        const va = [va0 + ((1 - va0) * r) / cut, va0 + ((1 - va0) * (r + 1)) / cut];
        const vb = [vb0 + ((1 - vb0) * r) / cut, vb0 + ((1 - vb0) * (r + 1)) / cut];
        const corners = [[ua, va[1]], [ub, vb[1]], [ub, vb[0]], [ua, va[0]]];
        const points = corners.map(([u, v]) => world(slope.point(u, v)));
        const normals = corners.map(([u, v]) => turned(normalAt(u, v)));
        const uvs = corners.map(([u, v]) => [u + half, (1 - v) * slope.length]);
        const order = tksCross(tksSub(points[1], points[0]), tksSub(points[3], points[0]))[1] >= 0 ? [0, 1, 2, 3] : [1, 0, 3, 2];
        builder.quad(tiles, ...order.map((index) => points[index]), { uvs: order.map((index) => uvs[index]), colour: tint, normals: order.map((index) => normals[index]) });
      }
      // The eave's edge: the tiles' thickness, dark, following the eave's turn up at the corners (tkgRoof's).
      {
        const [a, b] = [world(slope.point(ua, 1)), world(slope.point(ub, 1))];
        const edge = [[a[0], a[1] - 0.07, a[2]], [b[0], b[1] - 0.07, b[2]], b, a];
        const out = tksCross(tksSub(edge[1], edge[0]), [0, 1, 0]);
        const outward = tksSub(world(slope.point(0, 1)), world(slope.point(0, 0.5)));
        const order = out[0] * outward[0] + out[2] * outward[2] >= 0 ? [0, 1, 2, 3] : [1, 0, 3, 2];
        builder.quad(tiles, ...order.map((index) => edge[index]), { uvs: order.map((index) => [index === 0 || index === 3 ? ua : ub, index < 2 ? 0 : 0.07]), colour: tint.map((value) => value * 0.6) });
      }
      // The underside of the eave: its boards, back to the wall plate, dark (tkgRoof's soffit).
      if (va0 > vIn && vb0 > vIn) continue;
      const under = (u, v) => world(slope.point(u, v)).map((value, axis) => (axis === 1 ? value - 0.07 : value));
      const corners = [under(ua, 1), under(ub, 1), under(ub, Math.max(vIn, vb0)), under(ua, Math.max(vIn, va0))];
      const order = tksCross(tksSub(corners[1], corners[0]), tksSub(corners[3], corners[0]))[1] <= 0 ? [0, 1, 2, 3] : [1, 0, 3, 2];
      builder.quad('timber', ...order.map((index) => corners[index]), { uvs: order.map((index) => [[0, ua], [0, ub], [tuck, ub], [tuck, ua]][index]), colour: board.map((value) => value * 0.8) });
    }
  }
  // The ridge, its ends turned up (tkgRoof's: the same figures); the hips; a hip-and-gable's gables.
  const ridgeSpec = { high: 0.24, wide: 0.2, lift: 0.18, material: tiles, colour: tint.map((value) => value * 0.85), ...ridge };
  const top = spec.eave + spec.rise;
  if (slopes.ridge > 0) {
    const line = [-1, -0.75, 0.75, 1].map((t) => world([t * slopes.ridge, top - 0.02 + ridgeSpec.lift * Math.abs(t) ** 4, 0]));
    tksCrest(builder, ridgeSpec.material, line, ridgeSpec.wide, ridgeSpec.high, ridgeSpec.colour);
  }
  if (slopes.kind === 'hip' || slopes.kind === 'hipgable') {
    // (Each hip from where it leaves the ridge, or the gable's knee, to its eave corner, on the front and back slopes.)
    for (const slope of slopes.slice(0, 2)) {
      for (const sign of [-1, 1]) {
        const u1 = sign * slope.half;
        let u0 = u1;
        while (Math.abs(u0) > 0 && slope.start(u0 - sign * 0.05) > 0) u0 -= sign * 0.05;
        const line = [u0, u1].map((u) => world(slope.point(u, Math.min(1, slope.start(u)))));
        tksCrest(builder, ridgeSpec.material, line, ridgeSpec.wide * 0.85, ridgeSpec.high * 0.8, ridgeSpec.colour);
      }
    }
  }
  if (slopes.gable) {
    const { half, knee } = slopes.gable;
    const profile = [0, 0.5, 1].map((t) => slopes[0].point(0, knee * t));
    const low = profile[2][1];
    for (const sx of [-1, 1]) {
      for (const sz of [-1, 1]) {
        for (let k = 0; k < 2; k += 1) {
          const a = [sx * half, profile[k][1], sz * profile[k][2]];
          const b = [sx * half, profile[k + 1][1], sz * profile[k + 1][2]];
          const corners = [[sx * half, low, a[2]], [sx * half, low, b[2]], b, a].map(world);
          const order = sx * sz > 0 ? [1, 0, 3, 2] : [0, 1, 2, 3];
          builder.quad(spec.gableMaterial ?? 'plaster', ...order.map((index) => corners[index]), { uvs: order.map((index) => [[a[2], low], [b[2], low], [b[2], b[1]], [a[2], a[1]]][index]), colour: spec.gableColour ?? [1, 1, 1] });
        }
      }
    }
  }
}

/**
 * A house (tkHouse's or tkThatch's spec, `kind` 'thatch' for a cottage) as its walls and its roof: the roof tkHouse
 * (tkThatch) lays, with the same defaults, tints and draws of its seeded tones; the walls a box to the eave, its
 * front the dark of its bays, the gables of a gabled roof under its line.
 */
export function tkSkylineHouse(builder, house) {
  const s = TK_SKYLINE;
  const frame = tkgFrame(house.at[0], house.base ?? 0, house.at[1], house.yaw ?? 0);
  const thatch = house.kind === 'thatch';
  const storeys = thatch ? 1 : house.storeys ?? 2;
  const h0 = house.heights?.[0] ?? (thatch ? 2.35 : TK_HOUSE.storeys[0]);
  const eave = storeys > 1 ? h0 + (house.heights?.[1] ?? TK_HOUSE.storeys[1]) : h0;
  const [w, d] = [house.width, house.depth];
  // (tkHouse's tones, drawn in its order from its own seed: the timber, the paint, the tiles; tkThatch's straw.)
  const random = tkRandom((house.seed ?? 1) * 7919 + 13);
  const timber = tksScale(house.timber ?? TK_HOUSE.timber, 0.85 + 0.3 * random());
  const paint = tksScale(TK_HOUSE[house.wall ?? 'plaster'] ?? TK_HOUSE.plaster, 0.9 + 0.1 * random());
  const tile = tksScale(TK_HOUSE.tile, 0.85 + 0.25 * random());
  const t = TK_HANOK.thatch;
  const straw = tkRandom((house.seed ?? 1) * 613 + 7);
  const roof = thatch
    ? { kind: 'hip', tiles: 'earth', tint: tksScale(t.colour, 0.85 + 0.25 * straw()), sag: t.swell, overhang: t.overhang, verge: 0.3, rise: d * 0.42, ridge: { high: 0.22, wide: 0.5, lift: 0, material: 'earth' }, ...house.roof }
    : { kind: 'gable', overhang: TK_HOUSE.overhang, sag: TK_HOUSE.sag, verge: house.firewall ? 0 : 0.22, tint: tile, timber, ...house.roof };
  const wall = house.wall ?? 'plaster';
  // The walls: the back and the ends in their paint, the front the dark of its bays (lattice, doors, rooms behind).
  builder.box(wall, frame, -w / 2, w / 2, -0.3, eave, -d / 2, d / 2, { colour: paint, skip: 'bottom top front' });
  builder.upright('timber', frame, [-w / 2, d / 2], [w / 2, d / 2], -0.3, eave, { colour: tksScale(timber, s.front) });
  const rise = roof.rise ?? (d / 2 + roof.overhang) * TK_HOUSE.pitch;
  if (roof.kind === 'gable') {
    for (const side of [-1, 1]) {
      const end = frame.child((side * w) / 2, 0, 0, (side * Math.PI) / 2);
      const peak = eave + rise - 0.1;
      builder.tri(wall, end(-d / 2, eave, 0), end(d / 2, eave, 0), end(0, peak, 0), [[0, 0], [d, 0], [d / 2, rise]], paint);
    }
  }
  // (Closed under the eaves at the wall's head, as the full drawing's wall plate and boards close it: seen from under a
  // neighbour's eaves no sky shows through.)
  builder.level('timber', frame, -w / 2, w / 2, -d / 2, d / 2, eave, { colour: tksScale(timber, 0.45), under: true });
  tkSkylineRoof(builder, frame, { ...roof, width: w, depth: d, eave, rise, ridge: { lift: house.firewall ? 0 : 0.14, ...roof.ridge } });
}

/** A terrace (tkTerrace's: width, depth, high, in `frame` at its foot) as a box of its stone. */
function tksTerrace(builder, frame, width, depth, high) {
  if (high > 0.05) builder.box('ashlar', frame, -width / 2, width / 2, -0.3, high, -depth / 2, depth / 2, { colour: TK_HANOK.granite, skip: 'bottom' });
}

/**
 * A pavilion in storeys (tkPavilion's spec: storeys, bay, column, paint, tint, overhang, lift) in `frame` at its
 * floor, as tkPavilion lays it, coarse: each storey's columns where its columns stand (TK_SKYLINE.column sides), its
 * beams round the columns' heads, the dark of its lattice where it is filled, a skirt roof and the floor of the storey
 * above round every storey but the last, the last's hip-and-gable roof. Returns its top's local height.
 */
export function tkSkylinePavilion(builder, frame, { storeys, bay = 2.7, column = 0.19, paint = TK_WORKS.paint, tint = [0.74, 0.76, 0.78], overhang = 1.5, lift = 0.5 }) {
  let y = 0;
  storeys.forEach((storey, index) => {
    const { width: w, depth: d, high, fill = 'open' } = storey;
    const above = storeys[index + 1];
    const head = y + high;
    const [nx, nz] = [Math.max(1, Math.round(w / bay)), Math.max(1, Math.round(d / bay))];
    const posts = [];
    for (let i = 0; i <= nx; i += 1) posts.push([-w / 2 + (w * i) / nx, d / 2], [-w / 2 + (w * i) / nx, -d / 2]);
    for (let k = 1; k < nz; k += 1) posts.push([w / 2, -d / 2 + (d * k) / nz], [-w / 2, -d / 2 + (d * k) / nz]);
    for (const [px, pz] of posts) builder.round('timber', frame, px, pz, y, head - 0.28, column, column * 0.88, { sides: TK_SKYLINE.column, colour: paint.column, caps: '' });
    builder.box('timber', frame, -w / 2 - 0.12, w / 2 + 0.12, head - 0.62, head - 0.1, -d / 2 - 0.12, d / 2 + 0.12, { colour: paint.beam, skip: 'bottom top' });
    if (fill === 'lattice') builder.box('timber', frame, -w / 2 + 0.05, w / 2 - 0.05, y, head - 0.62, -d / 2 + 0.05, d / 2 - 0.05, { colour: tksScale(paint.column, 0.55), skip: 'bottom top' });
    if (above) {
      const rise = (w - above.width) / 2 * 0.5 + 0.35;
      tkSkylineRoof(builder, frame, { kind: 'skirt', width: w, depth: d, eave: head, rise, overhang, inner: [above.width, above.depth], sag: 0.35, lift, tint, timber: paint.rafter });
      const up = head + rise;
      builder.box('timber', frame, -above.width / 2 - 0.2, above.width / 2 + 0.2, up - 0.22, up, -above.depth / 2 - 0.2, above.depth / 2 + 0.2, { colour: paint.rafter, skip: 'bottom top' });
      y = up;
    } else {
      builder.level('timber', frame, -w / 2, w / 2, -d / 2, d / 2, head - 0.1, { colour: tksScale(paint.rafter, 0.6), under: true });
      tkSkylineRoof(builder, frame, { kind: 'hipgable', width: w, depth: d, eave: head, rise: (d / 2 + overhang) * 0.72, overhang, sag: 0.42, lift: lift * 1.3, breakAt: 0.5, tint, timber: paint.rafter, ridge: { high: 0.42, wide: 0.3, lift: 0.3 } });
      y = head;
    }
  });
  return y;
}

/** A hall (tkHall's spec: at, yaw, base, width, depth, high, terrace, apron, bay, paint, tint, overhang) as its terrace, its walls and its pavilion. */
export function tkSkylineHall(builder, hall) {
  const frame = tkgFrame(hall.at[0], hall.base ?? 0, hall.at[1], hall.yaw ?? 0);
  const [width, depth, high, terrace, apron] = [hall.width, hall.depth, hall.high ?? 3.4, hall.terrace ?? 0.9, hall.apron ?? 1.6];
  tksTerrace(builder, frame, width + 2 * apron, depth + 2 * apron, terrace);
  const body = frame.child(0, terrace, 0);
  builder.box('plaster', body, -width / 2 + 0.05, width / 2 - 0.05, 0.1, high - 0.62, -depth / 2 + 0.05, depth / 2 - 0.05, { colour: TK_HOUSE.plaster, skip: 'bottom top front' });
  tkSkylinePavilion(builder, body, { storeys: hall.storeys ?? [{ width, depth, high, fill: 'lattice' }], bay: hall.bay ?? 3.0, paint: hall.paint ?? TK_WORKS.paint, tint: hall.tint ?? [0.62, 0.64, 0.66], overhang: hall.overhang ?? 1.6, lift: 0.55 });
}

/** A pavilion on a terrace (tkTerracePavilion's spec: at, yaw, base, storeys, terrace, apron, bay, overhang). */
export function tkSkylineTerracePavilion(builder, p) {
  const frame = tkgFrame(p.at[0], p.base ?? 0, p.at[1], p.yaw ?? 0);
  const [terrace, apron] = [p.terrace ?? 1.0, p.apron ?? 1.2];
  tksTerrace(builder, frame, p.storeys[0].width + 2 * apron, p.storeys[0].depth + 2 * apron, terrace);
  tkSkylinePavilion(builder, frame.child(0, terrace, 0), { storeys: p.storeys, bay: p.bay ?? 2.7, overhang: p.overhang ?? 1.5 });
}

/** A roofed gate (tkRoofedGate's: at, yaw, base; `temple` the temple's larger one) as its posts, its lintel and its hip-and-gable roof. */
export function tkSkylineRoofedGate(builder, g) {
  const frame = tkgFrame(g.at[0], g.base ?? 0, g.at[1], g.yaw ?? 0);
  const { way, high } = g.temple ? { way: 3.4, high: 4.2 } : TK_HANOK.gate;
  const { post, roof } = TK_HANOK.gate;
  const timber = [0.36, 0.25, 0.18];
  for (const sx of [-1, 1]) for (const z of [-0.55, 0.55]) builder.round('timber', frame, sx * (way / 2 + post), z, 0, high, post, post * 0.9, { colour: timber, sides: TK_SKYLINE.column, caps: '' });
  builder.box('timber', frame, -way / 2 - post * 2, way / 2 + post * 2, high, high + 0.28, -0.75, 0.75, { colour: tksScale(timber, 0.9), skip: 'top' });
  tkSkylineRoof(builder, frame.child(0, high + 0.28, 0, Math.PI / 2), { kind: 'hipgable', width: 1.9, depth: way + 0.9, eave: 0, rise: roof.rise, overhang: roof.overhang, sag: roof.sag, lift: roof.lift, breakAt: 0.5, tint: [0.62, 0.64, 0.66], timber });
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
 * A gate tower (works.js tkGatehouse's block, as the full drawing lays it: its stone, its arch and passage, its
 * parapet; it is one of a few) in `frame` with its pavilion of `storeys` on top at `pavilion` (a frame), as a
 * pavilion is drawn here.
 */
export function tkSkylineGateTower(builder, frame, gate, pavilion, storeys, options = {}) {
  tkGatehouse(builder, frame, gate);
  tkSkylinePavilion(builder, pavilion, { storeys, ...options });
}

/**
 * A part of a town as its skyline (the makers above), into `builder`: `items` the plan's lists as the full drawing
 * takes them, any of { houses, halls, pavilions (on terraces), terraces ({ at, yaw, base, width, depth, high }), walls
 * ({ run, base, high, low, material }: the full drawing's own, build.js tkYardWall), gates (roofed gates: { at, yaw,
 * base, temple }), pagodas ({ at, y, tiers, size }), trees (build.js tkTree's: { at, y, kind, high, seed, ... } as the
 * full drawing gives them; drawn `lean`), ramparts ({ nodes, ...wall }) }.
 */
export function tkSkyline(builder, items) {
  for (const house of items.houses ?? []) tkSkylineHouse(builder, house);
  for (const hall of items.halls ?? []) tkSkylineHall(builder, hall);
  for (const p of items.pavilions ?? []) tkSkylineTerracePavilion(builder, p);
  for (const t of items.terraces ?? []) tksTerrace(builder, tkgFrame(t.at[0], t.base ?? 0, t.at[1], t.yaw ?? 0), t.width, t.depth, t.high);
  for (const w of items.walls ?? []) tkYardWall(builder, w.run[0], w.run[1], { material: w.material, high: w.high, base: w.base, thick: w.low ? 0.5 : TK_HANOK.yard.thick });
  for (const g of items.gates ?? []) tkSkylineRoofedGate(builder, g);
  for (const p of items.pagodas ?? []) tkSkylinePagoda(builder, p.at[0], p.y, p.at[1], p);
  for (const t of items.trees ?? []) tkTree(builder, t.at[0], t.y, t.at[1], { ...t, lean: true });
  for (const r of items.ramparts ?? []) tkSkylineRampart(builder, r.nodes, r);
}
