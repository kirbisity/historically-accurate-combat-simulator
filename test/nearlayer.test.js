// The near detail held only near the player (townkit/near.js, geo.js tkgNearRecorder): a district's fine detail taken
// apart as it is drawn is laid again exactly as the drawing laid it, the drawing around it unchanged; the layer makes
// the blocks near the eye in slices, lets go of those far off, shows only those within reach, and makes everything at
// once for a battle.

import { test } from 'node:test';
import assert from 'node:assert/strict';

// (The kit's modules name THREE only inside the functions that make meshes and textures: the lie's two textures are
// stood in for here.)
globalThis.THREE ??= {};
THREE.DataTexture ??= class {};
const { tkgBuilder, tkgNearRecorder, tkgNearReplay } = await import('../src/townkit/geo.js');
const { tkRandom, TK_TAPE } = await import('../src/townkit/tex.js');
const { TK_NEAR, tkNearLayer, tknBoxDistance } = await import('../src/townkit/near.js');
const { pyDrawDistrict } = await import('../src/places/pyongyang.js');

test('near recorder: a piece taken keeps its draws, the drawing after it goes on the same, and it is laid again the same', () => {
  const draw = (builder) => {
    const random = tkRandom(7);
    for (let k = 0; k < 4; k += 1) {
      const x = random() * 10;
      builder.at('near', () => builder.box('timber', (a, b, c) => [a + x, b, c], 0, random(), 0, 1, 0, random()));
      builder.box('ashlar', (a, b, c) => [a, b + random(), c], 0, 1, 0, 1, 0, 1);
    }
  };
  const plain = tkgBuilder();
  draw(plain);
  const record = tkgNearRecorder();
  const taken = tkgBuilder({ record, key: '0,0' });
  draw(taken);
  const of = (builder, material, level) => builder.batches().find((b) => b.material === material && b.level === level)?.position ?? new Float32Array(0);
  assert.deepEqual([...of(taken, 'ashlar', 'all')], [...of(plain, 'ashlar', 'all')], 'what follows each piece is laid as it was');
  assert.equal(of(taken, 'timber', 'near').length, 0, 'the pieces are not kept by the builder');
  assert.equal(record.entries.length, 4);
  assert.ok(record.entries.every((entry) => entry.key === '0,0' && entry.tape.length === 2 && entry.box[0] <= entry.box[2]));
  const again = tkgNearReplay(record.entries).get('timber').position;
  assert.deepEqual([...again], [...of(plain, 'timber', 'near')], 'laid again, the pieces are what the drawing laid');
  assert.equal(TK_TAPE.from, null);
  assert.equal(TK_TAPE.into, null);
});

test('near recorder: Pyongyang\'s governor\'s quarter, taken apart, is laid again block by block exactly as drawn', () => {
  const plain = pyDrawDistrict('G');
  const record = tkgNearRecorder();
  const taken = pyDrawDistrict('G', { record, lay: plain.lay });
  const want = new Map();
  const takenBlocks = new Map(taken.blocks.keyed().map(([key, builder]) => [key.join(','), builder]));
  let triangles = 0;
  for (const [cell, builder] of plain.blocks.keyed()) {
    const key = cell.join(',');
    for (const batch of builder.batches()) {
      if (batch.level === 'near') {
        want.set(`${key}|${batch.material}`, batch.position);
        triangles += batch.position.length / 9;
        continue;
      }
      const other = takenBlocks.get(key)?.batches().find((b) => b.material === batch.material && b.level === batch.level);
      assert.ok(other && other.position.length === batch.position.length && other.position.every((v, i) => v === batch.position[i]), `${key} ${batch.material}: the plain drawing is unchanged`);
    }
  }
  for (const builder of takenBlocks.values()) for (const batch of builder.batches()) assert.ok(batch.level !== 'near' || !batch.position.length, 'no near detail is kept in the blocks');
  assert.ok(triangles > 100000, `the quarter's near detail is large (${triangles} triangles)`);
  const byKey = new Map();
  for (const entry of record.entries) byKey.set(entry.key, [...(byKey.get(entry.key) ?? []), entry]);
  let laid = 0;
  for (const [key, entries] of byKey) {
    for (const [material, batch] of tkgNearReplay(entries)) {
      const was = want.get(`${key}|${material}`);
      laid += batch.position.length / 9;
      assert.ok(was && was.length === batch.position.length && was.every((v, i) => v === batch.position[i]), `${key} ${material}: laid again as drawn`);
    }
  }
  assert.equal(laid, triangles);
});

/** A near layer over fake meshes: pieces in blocks of 24 m along x, each laying one triangle; the clock steps 1 ms a call. */
function fakeLayer(config = {}) {
  const record = tkgNearRecorder();
  for (let k = 0; k < 10; k += 1) {
    const builder = tkgBuilder({ record, key: `${k},0` });
    for (let n = 0; n < 3; n += 1) builder.at('near', () => builder.tri('timber', [k * 24 + 2 + n, 0, 2], [k * 24 + 20, 0, 2], [k * 24 + 2, 0, 20], [[0, 0], [1, 0], [0, 1]]));
  }
  let clock = 0;
  const attached = new Set();
  const freed = [];
  const layer = tkNearLayer({
    cell: 24,
    config: { stepMs: 0.5, ...config },
    meshOf: (batch) => ({ triangles: batch.position.length / 9, geometry: { boundingSphere: { center: { distanceTo: () => 0 }, radius: 10 } }, visible: true }),
    group: () => ({ children: [], add(mesh) { this.children.push(mesh); }, userData: {}, visible: true }),
    attach: (made) => attached.add(made),
    upload: function* () {
      yield 'frame';
    },
    free: (made) => {
      attached.delete(made);
      freed.push(made);
    },
    now: () => (clock += 1),
  });
  layer.add('W', record);
  return { layer, attached, freed };
}

test('near layer: makes the blocks near the eye, nearest first, shows those within reach, lets go of those far off', () => {
  const { layer, attached, freed } = fakeLayer();
  assert.equal(layer.stats().blocks, 10);
  layer.update([2, 10]);
  for (let frame = 0; frame < 60; frame += 1) layer.pump(20);
  const built = layer.made().map((each) => each.id).sort();
  // (Blocks whose ground is within `build` of x 2: those starting before x 50.)
  const within = Array.from({ length: 10 }, (_, k) => k).filter((k) => tknBoxDistance([k * 24 + 2, 2, k * 24 + 20, 20], 2, 10) < TK_NEAR.build).map((k) => `W|${k},0`);
  assert.deepEqual(built, within.sort());
  layer.detail(null, 46);
  for (const { made, box } of layer.made()) assert.equal(made.visible, tknBoxDistance(box, 2, 10) < TK_NEAR.show);
  // Walked on east: the first blocks let go past `keep`, the next made.
  layer.update([150, 10]);
  for (let frame = 0; frame < 60; frame += 1) layer.pump(20);
  assert.ok(freed.length >= 1 && !layer.made().some((each) => each.id === 'W|0,0'), 'the far block is let go');
  assert.ok(layer.made().some((each) => each.id === 'W|7,0'), 'the near one is made');
  assert.equal(attached.size, layer.made().length);
  // A part let go takes its blocks with it.
  layer.drop('W');
  assert.equal(layer.made().length, 0);
  assert.equal(attached.size, 0);
});

test('near layer: a slice of making is short, and a build given up half way leaves nothing behind', () => {
  const { layer, attached } = fakeLayer();
  layer.update([2, 10]);
  layer.pump(1);
  assert.ok(layer.stats().building > 0);
  // Gone far off before it is done: given up, and what it had made let go.
  layer.update([1000, 10]);
  assert.equal(layer.stats().building, 0);
  assert.equal(attached.size, 0);
});

test('near layer: everything made at once for a battle, each mesh then shown by the focus as the kit shows fine detail', () => {
  const { layer } = fakeLayer();
  layer.setMode('all');
  const steps = layer.allSteps();
  for (let next = steps.next(); !next.done; next = steps.next());
  assert.equal(layer.made().length, 10);
  layer.update([2, 10]);
  layer.detail({}, 46);
  assert.ok(layer.made().every(({ made }) => made.visible && made.children.every((mesh) => mesh.visible)));
  layer.detail({}, 46, false);
  assert.ok(layer.made().every(({ made }) => !made.visible), 'none on the low tier');
});

test('near layer: the blocks where the player will first stand made at once, behind the loading screen', () => {
  const { layer } = fakeLayer();
  const steps = layer.ensureSteps([2, 10]);
  for (let next = steps.next(); !next.done; next = steps.next());
  const want = Array.from({ length: 10 }, (_, k) => k).filter((k) => tknBoxDistance([k * 24 + 2, 2, k * 24 + 20, 20], 2, 10) < TK_NEAR.build).map((k) => `W|${k},0`);
  assert.deepEqual(layer.made().map((each) => each.id).sort(), want.sort());
});
