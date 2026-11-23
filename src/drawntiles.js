// Fabric tiles drawn in code, not baked: the pictures a garment's surface wears where its detail is finer than its mesh and
// particular to the piece (detailmaps.js DETAIL_ARMOUR `drawn`; detailtex.js makes them textures the first time something
// wears one). Plain arithmetic, no Three.js and no canvas: each is { width, height, albedo, normal, orm } of RGBA bytes, row 0
// at v = 0 (the foot of the piece), in the baked tiles' own layout:
//   albedo  RGB the shade the piece's colour is multiplied by, A a mask drawn in the kit's fittings colour (metal eyelets)
//   normal  RGB the tangent-space normal (OpenGL: green up), A a second mask drawn in the kit's lace colour (laces)
//   orm     R occlusion, G roughness, B metalness
//
// corsetSatin: a whole corset unrolled, u once round from the middle of the front, v from its foot to its top. Black
// satin over steel bones (the reference: a late-Victorian corset in black satin, its busk of two steels closed with five
// loop-and-stud clasps, laced behind): the busk's two steels down the front, panels seamed between them and the back, a
// bone in a stitched channel on every seam, the satin drawn tight between the bones and wrinkled across where the waist
// pulls it, its float threads running up the piece (so the light streaks down each panel), both edges bound, and behind,
// two rows of eyelets between bones with the lace crossed over the gap.
//
// lace: machine lace as the 1890s wore it (Chantilly and guipure patterns: flowers and leaves on a hexagonal net), a
// repeating tile; the net's holes dark, the gimp cord round each figure raised.

/** A hash of two whole numbers to 0..1. */
function drawnHash(x, y) {
  let n = (Math.imul(x | 0, 374761393) + Math.imul(y | 0, 668265263)) | 0;
  n = Math.imul(n ^ (n >>> 13), 1274126177);
  return ((n ^ (n >>> 16)) >>> 0) / 4294967296;
}

/** Value noise at (x, y), smooth, 0..1, repeating every `wrapX` cells across (0: never). */
function drawnNoise(x, y, wrapX = 0) {
  const [ix, iy] = [Math.floor(x), Math.floor(y)];
  const [fx, fy] = [x - ix, y - iy];
  const [sx, sy] = [fx * fx * (3 - 2 * fx), fy * fy * (3 - 2 * fy)];
  const wrap = (value) => (wrapX ? ((value % wrapX) + wrapX) % wrapX : value);
  const [a, b, c, d] = [drawnHash(wrap(ix), iy), drawnHash(wrap(ix + 1), iy), drawnHash(wrap(ix), iy + 1), drawnHash(wrap(ix + 1), iy + 1)];
  return a + (b - a) * sx + (c - a) * sy + (a - b - c + d) * sx * sy;
}

const drawnStep = (edge0, edge1, x) => {
  const t = Math.min(1, Math.max(0, (x - edge0) / (edge1 - edge0)));
  return t * t * (3 - 2 * t);
};

/** The layers a tile is drawn in (height in metres, the rest 0..1), and the bytes made of them. */
function drawnLayers(width, height) {
  const size = width * height;
  return { width, height, relief: new Float32Array(size), shade: new Float32Array(size).fill(1), rough: new Float32Array(size).fill(0.5), metal: new Float32Array(size), occlusion: new Float32Array(size).fill(1), fittings: new Float32Array(size), lace: new Float32Array(size) };
}

/** A tile's bytes from its layers: the normals from the relief (`metresX`, `metresY`: a pixel's size), wrapped across and, if `wrapY`, up. */
function drawnBytes(layers, metresX, metresY, wrapY) {
  const { width, height, relief, shade, rough, metal, occlusion, fittings, lace } = layers;
  const albedo = new Uint8ClampedArray(width * height * 4);
  const normal = new Uint8ClampedArray(width * height * 4);
  const orm = new Uint8ClampedArray(width * height * 4);
  for (let y = 0; y < height; y += 1) {
    const [up, down] = wrapY ? [(y + 1) % height, (y + height - 1) % height] : [Math.min(height - 1, y + 1), Math.max(0, y - 1)];
    for (let x = 0; x < width; x += 1) {
      const at = y * width + x;
      const dx = (relief[y * width + ((x + 1) % width)] - relief[y * width + ((x + width - 1) % width)]) / (2 * metresX);
      const dy = (relief[up * width + x] - relief[down * width + x]) / ((up - down || 1) * metresY);
      const length = Math.hypot(dx, dy, 1);
      const grey = shade[at] * 255;
      albedo.set([grey, grey, grey, fittings[at] * 255], at * 4);
      normal.set([(-dx / length) * 127.5 + 127.5, (-dy / length) * 127.5 + 127.5, (1 / length) * 127.5 + 127.5, lace[at] * 255], at * 4);
      orm.set([occlusion[at] * 255, rough[at] * 255, metal[at] * 255, 255], at * 4);
    }
  }
  return { width, height, albedo, normal, orm };
}

// The corset's cut, in shares of the way round (u) and up (v) and in metres. `girth`, `tall`: the size the picture is
// drawn for (a small woman's corseted waist to her bust and hips, mean girth; hip to underbust or bust). `busk`: half the
// breadth of the two steels together. `panels`: to each side between the busk and the eyelets' bones. `channel`: half a
// bone channel's breadth. `eyelets`: the back strip's breadth each side, the gap's half breadth, the eyelets' distance from
// the middle, their pitch up the back and radius. `binding`: the bound edges' depth. `waist`: where the waist lies up the
// piece (loftbody.js LOFT.corset.at within the corset's span).
export const CORSET_SATIN = {
  girth: 0.74, tall: 0.33, busk: 0.0125, panels: 6, channel: 0.0048, back: 0.03, gap: 0.011, eyeletAt: 0.02, eyeletPitch: 0.0165, eyeletRadius: 0.0034,
  binding: 0.009, waist: 0.47, stitch: 0.0028,
};

/** The seams' places to one side, in metres from the middle of the front along the girth. */
export function corsetSeams(spec = CORSET_SATIN) {
  const half = spec.girth / 2;
  const span = (half - spec.back - spec.busk) / spec.panels;
  return Array.from({ length: spec.panels - 1 }, (_, index) => spec.busk + span * (index + 1));
}

function corsetSatinTile(width = 2048, height = 512) {
  const spec = CORSET_SATIN;
  const layers = drawnLayers(width, height);
  const { relief, shade, rough, metal, occlusion, fittings, lace } = layers;
  const [mx, my] = [spec.girth / width, spec.tall / height];
  const half = spec.girth / 2;
  const seams = corsetSeams(spec);
  const backFrom = half - spec.back;
  // Where a panel's satin lies between two bones: its edges (m from the front's middle), for each column.
  const edges = [spec.busk, ...seams, backFrom];
  for (let y = 0; y < height; y += 1) {
    const v = (y + 0.5) / height;
    const up = v * spec.tall;
    const fromEdge = Math.min(up, spec.tall - up);
    const bound = fromEdge < spec.binding;
    // The waist's pull: wrinkles across the satin, deepest at the waist and gone a hand's breadth above and below.
    const pull = Math.exp(-(((v - spec.waist) / 0.16) ** 2));
    for (let x = 0; x < width; x += 1) {
      const at = y * width + x;
      const u = (x + 0.5) / width;
      const round = u * spec.girth;
      const side = Math.min(round, spec.girth - round);
      let high = 0;
      let grain = 1;
      // Satin: the float threads run up the piece; their sheen is uneven in fine streaks, and the face is a little rougher across them.
      const streak = drawnNoise(x * 0.9, y * 0.035, width) - 0.5;
      let roughness = 0.34 + 0.1 * streak + 0.05 * (drawnNoise(x * 0.11, y * 0.11, Math.round(width * 0.11)) - 0.5);
      let tone = 1 + 0.07 * streak;
      let shadow = 1;
      if (side < spec.busk) {
        // The busk: two steels in their casings, meeting down the middle.
        const across = side / spec.busk;
        high = 0.0011 * drawnStep(0, 0.12, across) * (1 - 0.35 * drawnStep(0.86, 1, across));
        shadow = 0.55 + 0.45 * drawnStep(0, 0.1, across);
        grain = 0.3;
      } else if (side < backFrom) {
        const panel = edges.findIndex((edge, index) => side >= edge && side < edges[index + 1]);
        const [from, to] = [edges[panel], edges[panel + 1]];
        const across = (side - from) / (to - from);
        // Drawn tight between its bones, a little full in the middle.
        high = 0.0014 * 4 * across * (1 - across);
        // A bone in its channel on each seam, a row of stitching either side of it.
        const toSeam = Math.min(panel > 0 ? side - from : Infinity, panel < spec.panels - 1 ? to - side : Infinity);
        if (toSeam < spec.channel) {
          high += 0.0009 * Math.cos((toSeam / spec.channel) * Math.PI * 0.5) ** 0.6;
          grain = 0.35;
        }
        const toStitch = Math.min(Math.abs(toSeam - spec.channel - 0.0008), Math.abs(side - spec.busk - 0.0016));
        if (toStitch < 0.0007) {
          // (Stitches: a thread every 2.8 mm, sunk in the cloth between.)
          const thread = (up / spec.stitch) % 1 < 0.72;
          high -= thread ? 0.00012 : 0.00035;
          roughness = thread ? 0.62 : roughness;
          tone *= thread ? 1.05 : 0.9;
          shadow = 0.85;
        }
        if (toSeam < 0.0005) shadow = 0.8;
      } else if (side < half - spec.gap) {
        // The back strip: the eyelets between two bones.
        const across = (side - backFrom) / (spec.back - spec.gap);
        high = 0.001 * drawnStep(0, 0.12, across) * drawnStep(0, 0.1, 1 - across);
        grain = 0.3;
      } else {
        // The gap behind: the lining under the lace, sunk and in shadow.
        high = -0.002;
        tone = 0.5;
        roughness = 0.9;
        shadow = 0.55;
        grain = 0;
      }
      // The wrinkles: long across, short up the piece, running out toward the bones.
      const wrinkle = drawnNoise(x * 0.012 + 31.7, y * 0.21, Math.round(width * 0.012)) - 0.5 + 0.6 * (drawnNoise(x * 0.03 + 3.1, y * 0.37 + 9.4, Math.round(width * 0.03)) - 0.5);
      high += 0.0011 * pull * grain * wrinkle;
      tone *= 1 + 0.12 * pull * grain * wrinkle;
      if (bound) {
        // The binding: a ribbed tape folded over the edge, stitched down along its inner side.
        const into = fromEdge / spec.binding;
        high += 0.0007 * drawnStep(0, 0.25, 1 - into) + 0.00008 * Math.sin((round + up) / 0.0011);
        roughness = 0.6;
        tone *= 0.94;
        if (Math.abs(into - 0.8) < 0.07) {
          const thread = (round / spec.stitch) % 1 < 0.72;
          high -= thread ? 0.0001 : 0.0003;
          shadow = 0.85;
        }
      }
      relief[at] = high;
      shade[at] = Math.min(1, Math.max(0, 0.86 * tone));
      rough[at] = Math.min(1, Math.max(0.05, roughness));
      occlusion[at] = shadow;
    }
  }
  // Behind: the eyelets, and the lace crossed from each to the next one up on the other side.
  const rows = Math.floor((spec.tall - 2 * spec.binding - 0.006) / spec.eyeletPitch);
  const first = (spec.tall - rows * spec.eyeletPitch) / 2;
  const stamp = (cx, cy, reach, draw) => {
    for (let y = Math.max(0, Math.floor((cy - reach) / my)); y <= Math.min(height - 1, Math.ceil((cy + reach) / my)); y += 1) {
      for (let x = Math.floor((cx - reach) / mx); x <= Math.ceil((cx + reach) / mx); x += 1) {
        draw((((x % width) + width) % width) + y * width, (x + 0.5) * mx - cx, (y + 0.5) * my - cy);
      }
    }
  };
  for (let row = 0; row <= rows; row += 1) {
    const cy = first + row * spec.eyeletPitch;
    for (const way of [-1, 1]) {
      const cx = half + way * spec.eyeletAt;
      stamp(cx, cy, spec.eyeletRadius + 0.001, (at, dx, dy) => {
        const off = Math.hypot(dx, dy);
        if (off > spec.eyeletRadius) return;
        const hole = off < spec.eyeletRadius * 0.45;
        relief[at] += hole ? -0.0008 : 0.0006 * Math.sin((off / spec.eyeletRadius) * Math.PI);
        fittings[at] = hole ? 0 : 1;
        metal[at] = hole ? 0 : 1;
        rough[at] = hole ? 0.9 : 0.28;
        shade[at] = hole ? 0.25 : 0.95;
        occlusion[at] = hole ? 0.4 : 1;
      });
      if (row === rows) continue;
      // The lace: a flat braid 4 mm wide from this eyelet to the next row's opposite.
      const [ax, ay, bx, by] = [cx, cy, half - way * spec.eyeletAt, cy + spec.eyeletPitch];
      const length = Math.hypot(bx - ax, by - ay);
      for (let step = 0; step <= 60; step += 1) {
        const share = step / 60;
        stamp(ax + (bx - ax) * share, ay + (by - ay) * share, 0.0022, (at, dx, dy) => {
          const off = Math.abs((dx * (by - ay) - dy * (bx - ax)) / length);
          if (off > 0.002 || lace[at] === 1) return;
          lace[at] = 1;
          // (One way over the other where they cross.)
          relief[at] = (way < 0 ? 0.0016 : 0.0008) * Math.cos((off / 0.002) * Math.PI * 0.5) ** 0.5;
          shade[at] = 0.9 + 0.1 * Math.sin(((dx + dy) / 0.0007) * Math.PI);
          rough[at] = 0.7;
          metal[at] = 0;
          fittings[at] = 0;
          occlusion[at] = 1;
        });
      }
    }
  }
  return drawnBytes(layers, mx, my, false);
}

// The lace's tile (m), and its net's mesh (m) and figures: a flower to a tile and a half-drop of leaves.
export const LACE_TILE = { metres: 0.06, mesh: 0.0034, thread: 0.26 };

function laceTile(width = 256, height = 256) {
  const spec = LACE_TILE;
  const layers = drawnLayers(width, height);
  const { relief, shade, rough, occlusion } = layers;
  const metres = spec.metres / width;
  // The figures: a five-petalled flower in the tile's middle, a smaller one at its corners, sprays of leaves between.
  const figure = (px, py) => {
    let best = 1;
    for (const [cx, cy, size, petals] of [[0.5, 0.5, 0.2, 5], [0, 0, 0.13, 6], [1, 0, 0.13, 6], [0, 1, 0.13, 6], [1, 1, 0.13, 6]]) {
      const [dx, dy] = [px - cx, py - cy];
      const off = Math.hypot(dx, dy);
      const petal = size * (0.55 + 0.45 * Math.abs(Math.cos((Math.atan2(dy, dx) * petals) / 2)));
      best = Math.min(best, (off - petal) / size);
    }
    for (const [cx, cy, turn] of [[0.5, 0.02, 0.5], [0.5, 0.98, 0.5], [0.02, 0.5, 2.07], [0.98, 0.5, 2.07], [0.25, 0.27, 1.2], [0.75, 0.73, 1.2], [0.75, 0.27, -0.4], [0.25, 0.73, -0.4]]) {
      const [dx, dy] = [px - cx, py - cy];
      const [along, across] = [dx * Math.cos(turn) + dy * Math.sin(turn), -dx * Math.sin(turn) + dy * Math.cos(turn)];
      const leaf = Math.abs(across) / 0.035 + (Math.abs(along) / 0.1) ** 2;
      best = Math.min(best, leaf - 1);
    }
    return best;
  };
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const at = y * width + x;
      const [px, py] = [(x + 0.5) / width, (y + 0.5) / height];
      const inside = figure(px, py);
      // The net: hexagonal meshes, a thread round each.
      const [gx, gy] = [(px * spec.metres) / spec.mesh, (py * spec.metres) / (spec.mesh * 0.866)];
      const rowAt = Math.round(gy);
      const cell = Math.hypot(gx - (rowAt % 2 ? 0.5 : 0) - Math.round(gx - (rowAt % 2 ? 0.5 : 0)), (gy - rowAt) * 0.866);
      const thread = drawnStep(0.5 - spec.thread, 0.5, cell);
      // A figure is close cloth, its edge a raised cord; the ground is the net.
      const cord = Math.exp(-((inside / 0.09) ** 2));
      const cloth = inside < 0 ? 1 : 0;
      const body = Math.max(cloth * (0.8 + 0.2 * drawnNoise(x * 0.5, y * 0.5, width / 2)), thread);
      relief[at] = 0.00035 * body + 0.0006 * cord;
      shade[at] = Math.min(1, 0.42 + 0.5 * body + 0.2 * cord);
      rough[at] = 0.82 - 0.12 * cord;
      occlusion[at] = 0.6 + 0.4 * Math.max(body, cord);
    }
  }
  return drawnBytes(layers, metres, metres, true);
}

/** The tiles drawn in code, by name: each a function that draws it ({ width, height, albedo, normal, orm }: RGBA bytes). */
export const DRAWN_TILES = { corsetSatin: corsetSatinTile, lace: laceTile };
