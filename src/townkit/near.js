// The town kit's near detail held only near the player: a place too large to hold all of its fine detail at once (the
// tiles' rolls, the rafters, the lattice, the jars, the scatter: more than half of every Pyongyang district's geometry)
// takes it apart as it is drawn (geo.js tkgNearRecorder: each piece's maker kept with the draws it took) and lays it
// again, a block at a time, only where the player comes near: the blocks within `build` m of him made, a slice of a
// few milliseconds a frame and sent to the graphics card a lot at a time; those past `keep` let go; those within
// `show` drawn. Walls, roofs and the main volumes stay as they are, built with their district. What is far off then
// costs only its plain form, which is all that shows of it there anyway.
//
// Or all of it at once (`mode` 'all', a battle's: the whole of what is held made behind the loading screen, and each
// block's detail shown by its distance from the camera's focus as tkMeshes shows it), so that a battle looks as it did.
// Nothing here touches the scene itself (the caller's `meshOf`, `group`, `attach`, `upload`, `free`), so it is tested
// in Node.

import { tkgNearReplay } from './geo.js';
import { tkNearReach } from './place.js';

/**
 * The numbers (m and ms). `show`: a block's detail is drawn while the nearest of the ground it covers is within this of
 * the eye: at 40 m a roof's tile rolls are a pixel apart and a jar a few pixels across (by eye, the near views of
 * Pyongyang's streets and its wall walk), where the place shows them up to 76 m ahead (46 m about a point 30 m
 * ahead: place.js TK_PLACE.near, tkKeep). `build`: made from this near, `show` and a run's 8 m besides (at 5 m/s a
 * block a few hundred milliseconds of work in slices is made in about 1.5 s). `keep`: let go past this (more than
 * `build`, so that a step back across a block's edge frees nothing). `budgetMs`: a frame's slice of making;
 * `urgentMs` while a block within `show` is not made yet (at 8 a walk through the heaviest blocks, the gate square's
 * and the compound's, missed a frame in four: 33 ms frames, 2026-11-26, M1 Pro); `stepMs`: a slice is cut after a
 * piece once it has run this long (each piece is a few hundred triangles: a slice stays short).
 */
export const TK_NEAR = { show: 40, build: 48, keep: 58, budgetMs: 2, urgentMs: 4, stepMs: 1 };

/** What a build yields to wait for the next frame to be drawn (a lot sent to the graphics card): the pump stops for this frame. */
export const TK_NEAR_FRAME = 'frame';

/** The nearest distance (m) from (x, z) to a box [x0, z0, x1, z1] on the ground; 0 inside. */
export const tknBoxDistance = (box, x, z) => Math.hypot(Math.max(0, box[0] - x, x - box[2]), Math.max(0, box[1] - z, z - box[3]));

/**
 * A near layer. `cell` (m): the blocks' size (the builders' tkBlocks cell; a piece laid into a wide builder goes to the
 * block its middle stands in). `meshOf(batch)`: a mesh of a batch (null for none); `group()`: an empty group;
 * `attach(group)`: put a made block in the scene; `upload(group)`: a generator sending it to the graphics card a lot
 * at a time (yields TK_NEAR_FRAME), or null; `free(group)`: take it out and let it go. `config`: TK_NEAR's fields to
 * change. Returns { add, drop, update, pump, allSteps, detail, setMode, stats }.
 */
export function tkNearLayer({ cell, meshOf, group, attach, upload = null, free, config = {}, now = () => performance.now() }) {
  const numbers = { ...TK_NEAR, ...config };
  // part -> Map(key -> { id, part, key, entries, box }); id -> { made, cell }; id -> { steps, cell, distance, waiting }.
  const parts = new Map();
  const built = new Map();
  const jobs = new Map();
  const counts = { builds: 0, frees: 0, abandoned: 0, steps: 0, longestStepMs: 0, buildMs: 0, lastPumpMs: 0 };
  let mode = 'stream';
  let eye = null;

  const cellOf = (entry) => {
    if (entry.key !== 'wide') return entry.key;
    const [x0, z0, x1, z1] = entry.box;
    return `${Math.floor((x0 + x1) / 2 / cell)},${Math.floor((z0 + z1) / 2 / cell)}`;
  };

  const release = (id) => {
    const entry = built.get(id);
    if (!entry) return;
    built.delete(id);
    free(entry.made);
    counts.frees += 1;
  };

  const abandon = (id) => {
    const job = jobs.get(id);
    if (!job) return;
    job.steps.return();
    jobs.delete(id);
    counts.abandoned += 1;
  };

  /** A block's detail made: its pieces laid again a slice at a time, meshed a material at a time, sent to the graphics card (unless `at once`). */
  const make = function* (block, atOnce) {
    const batches = new Map();
    let at = 0;
    while (at < block.entries.length) {
      const begun = now();
      do tkgNearReplay([block.entries[at++]], batches);
      while (at < block.entries.length && now() - begun < numbers.stepMs);
      if (at < block.entries.length) yield 'pieces';
    }
    const made = group();
    let done = false;
    try {
      for (const batch of batches.values()) {
        const mesh = meshOf(batch);
        if (mesh) made.add(mesh);
        yield 'mesh';
      }
      made.visible = false;
      attach(made);
      if (!atOnce && upload) yield* upload(made);
      done = true;
    } finally {
      // (Given up half way: what was made is let go.)
      if (!done) free(made);
    }
    return made;
  };

  const start = (block, distance, atOnce = false) => {
    if (built.has(block.id)) return;
    const job = jobs.get(block.id);
    if (job) job.distance = distance;
    else jobs.set(block.id, { steps: make(block, atOnce), block, distance, waiting: false });
  };

  const finish = (id, made) => {
    const job = jobs.get(id);
    jobs.delete(id);
    built.set(id, { made, block: job.block });
    counts.builds += 1;
  };

  /** One piece of work of a build; true when it is done. */
  const step = (id, job) => {
    const begun = now();
    const next = job.steps.next();
    const took = now() - begun;
    job.waiting = next.value === TK_NEAR_FRAME;
    counts.steps += 1;
    counts.buildMs += took;
    counts.longestStepMs = Math.max(counts.longestStepMs, took);
    if (next.done) finish(id, next.value);
    return next.done;
  };

  const blocks = function* () {
    for (const each of parts.values()) yield* each.values();
  };

  return {
    numbers,
    /** Take part `part`'s pieces (a tkgNearRecorder's), by block; a part taken before is let go first. */
    add(part, recorder) {
      this.drop(part);
      const each = new Map();
      for (const entry of recorder.entries) {
        const key = cellOf(entry);
        let block = each.get(key);
        if (!block) each.set(key, (block = { id: `${part}|${key}`, part, key, entries: [], box: [Infinity, Infinity, -Infinity, -Infinity] }));
        block.entries.push(entry);
        block.box = [Math.min(block.box[0], entry.box[0]), Math.min(block.box[1], entry.box[1]), Math.max(block.box[2], entry.box[2]), Math.max(block.box[3], entry.box[3])];
      }
      parts.set(part, each);
    },
    /** Let part `part` go: its pieces, its blocks made and being made. */
    drop(part) {
      const each = parts.get(part);
      if (!each) return;
      for (const block of each.values()) {
        abandon(block.id);
        release(block.id);
      }
      parts.delete(part);
    },
    /** 'stream' (by the player's distance) or 'all' (everything held made: allSteps). */
    setMode(next) {
      mode = next;
      for (const { made } of built.values()) for (const mesh of made.children) mesh.visible = true;
    },
    get mode() {
      return mode;
    },
    /** From where the eye is ([x, z], the place's own frame): start the blocks wanted, give up those being made and let go those made past `keep`. */
    update(at) {
      eye = at;
      if (mode !== 'stream') return;
      for (const block of blocks()) {
        const distance = tknBoxDistance(block.box, at[0], at[1]);
        if (distance < numbers.build) start(block, distance);
        else if (distance > numbers.keep) {
          abandon(block.id);
          release(block.id);
        } else if (jobs.has(block.id)) jobs.get(block.id).distance = distance;
      }
    },
    /**
     * Make for up to `budgetMs` ms, the nearest first (`urgentMs` while one within `show` is not made), less `spent` (ms
     * of the frame already given to other building). Returns the ms spent.
     */
    pump(budgetMs = null, spent = 0) {
      for (const job of jobs.values()) job.waiting = false;
      const next = () => {
        let best = null;
        for (const [id, job] of jobs) if (!job.waiting && (!best || job.distance < best[1].distance)) best = [id, job];
        return best;
      };
      const first = next();
      const budget = (budgetMs ?? (first && first[1].distance < numbers.show ? numbers.urgentMs : numbers.budgetMs)) - spent;
      const begun = now();
      while (jobs.size && now() - begun < budget) {
        const best = next();
        if (!best) break;
        step(best[0], best[1]);
      }
      counts.lastPumpMs = now() - begun;
      return counts.lastPumpMs;
    },
    /**
     * The blocks within `build` of `at` ([x, z]) made now (a generator for the loading screen's runner): where the
     * player will first stand, so that the first picture has its detail and its materials' programs are built behind
     * the screen, not in the first frames of play.
     */
    *ensureSteps(at) {
      for (const block of [...blocks()]) {
        if (built.has(block.id) || tknBoxDistance(block.box, at[0], at[1]) >= numbers.build) continue;
        abandon(block.id);
        start(block, 0, true);
        const job = jobs.get(block.id);
        while (!step(block.id, job)) yield;
      }
    },
    /** Every block of every part made now (a generator for the loading screen's runner): a battle's whole near detail. */
    *allSteps() {
      for (const block of [...blocks()]) {
        if (built.has(block.id)) continue;
        abandon(block.id);
        start(block, 0, true);
        const job = jobs.get(block.id);
        while (!step(block.id, job)) yield;
      }
    },
    /**
     * Which made blocks are drawn: streamed, those whose ground is within `show` of the eye (the last `update`'s); all
     * made at once, each mesh within the place's near reach (`near` m) of `focus` (a THREE.Vector3 in the place's
     * frame), as tkMeshes shows a block's fine detail. `fine` false (the low tier): none.
     */
    detail(focus, near, fine = true) {
      for (const { made, block } of built.values()) {
        if (!fine) {
          made.visible = false;
          continue;
        }
        if (mode === 'stream') {
          made.visible = !!eye && tknBoxDistance(block.box, eye[0], eye[1]) < numbers.show;
          continue;
        }
        made.visible = true;
        for (const mesh of made.children) {
          const sphere = mesh.geometry.boundingSphere;
          mesh.visible = sphere.center.distanceTo(focus) - sphere.radius < tkNearReach(mesh.userData?.tkMaterial, near);
        }
      }
    },
    /** What it holds and has done. */
    stats: () => ({ parts: [...parts.keys()], blocks: [...blocks()].length, built: built.size, building: jobs.size, ...counts }),
    /** Each block made: { id, box, made } (tests, tools). */
    made: () => [...built.entries()].map(([id, { made, block }]) => ({ id, box: block.box, made })),
  };
}
