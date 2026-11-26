// A place drawn a section at a time: which of its sections are built (their meshes, materials, lights and particles made and
// held), from where the player is, and the building and the letting go done a little at a time.
//
// A place of sections (a castle of rooms and courts, a walled town of districts) is a graph: each section a region of the
// ground, each portal (a gate, a door, a stair, a sewer's mouth) a link between two sections with the area where they meet
// (visibility.js sectionGraph makes it from a stage's own data). The player needs drawn the section he stands in and what he
// can see through its openings; everything else of the place is a silhouette or nothing (visibility.js), so its detail need
// not be held at all. The stream keeps built:
//   - the sections he is in (`active`): wanted at once; a jump there (a respawn, a fast travel) is built behind the loading
//     screen before the picture is shown (`ensureSteps`);
//   - those beyond a link (a gate of the room he is in) within `lead` m of him: built ahead while he walks up to the gate, so that by the time he is through it the room is there, and two
//     sections are held at once near a gate (loading ahead, seamless: the user's call, 2026-11-25);
//   - those the picture asks for (`seen`: painted in detail through an opening, visibility.js) and those `pinned` by the
//     game (the place a scene is about to cut to);
// and lets go of a section once none of that has held for `linger` seconds and no link into it is within `keep` m: two reaches
// and a wait, so that walking back and forth at a gate does not build and free the same room again and again. A build no
// longer wanted (he turned back before it was done, or it was begun from where he was a moment ago) is set aside, and given
// up after the same `linger` if nothing wants it again: finished, it would be held for nothing until the wait let it go.
// The building is the caller's: `build(id)` a generator (it yields between its pieces of work) whose return value is what
// `free(id, made)` is later handed. `pump(budgetMs)` runs the builds a slice at a time each frame, the most wanted first;
// nothing here touches the scene, so it is tested in Node.

import { nearestBoxDistance } from './visibility.js';

/** The numbers, in metres and seconds. */
export const SECTION_STREAM = {
  // A section beyond a link is built once the player is this near the link's area (a walk of some 12 s: time enough to build
  // the largest room of the castle, ~0.4 s of work, at a few milliseconds a frame, many times over).
  lead: 18,
  // A built section is held while a link into it is this near (more than `lead`, so a step back from the gate frees nothing).
  keep: 30,
  // And for this long after nothing holds it any more (a turn back into the room a moment later finds it still there).
  linger: 5,
  // Links followed from where he stands (two: a short passage and the room beyond it).
  hops: 2,
  // Milliseconds of building in a frame: a frame at 60 Hz is 16.7 ms and the game's own work takes most of it.
  budgetMs: 3,
  // And while the build first in line is wanted now (the room he stands in, one the picture shows, one whose gate is within `urgent`
  // m): more of the frame, so that it is done before he is through (on a slow or busy machine the steps take longer and fewer fit).
  urgentMs: 8,
  urgent: 6,
};

/** What a build yields to wait for the next frame to be drawn (a mesh it has put out to be sent to the graphics card): the pump goes on to other work. */
export const STREAM_FRAME = 'frame';

/**
 * The sections near him: `active` (at 0 m) and every section a link of theirs leads to whose area is within `reach` m of `position`
 * ([x, y, z]), and on through the links of those, up to `hops` links from where he stands (a short passage and the room beyond it are
 * both wanted as he comes to the passage's gate). A Map from id to the distance (m) to the nearest link that reached it. The links
 * must each be within `reach` of him, so a compact place of many rooms close together (a castle on a rock some 100 m across) is not
 * all held from any one of them.
 */
export function sectionsNear(graph, active, position, reach, hops = SECTION_STREAM.hops) {
  const [x, y, z] = position;
  const found = new Map(active.map((id) => [id, 0]));
  let frontier = [...active];
  for (let hop = 0; hop < hops && frontier.length; hop += 1) {
    const next = [];
    for (const id of frontier) {
      for (const link of graph.near[id] ?? []) {
        const other = link.a === id ? link.b : link.a;
        const distance = nearestBoxDistance(link.boxes, x, y, z);
        // (Or seen from all of the section it leads out of, the portal `always`: visibility.js sectionGraph.)
        if (distance > reach && !(link.always && link.a === id)) continue;
        if (!found.has(other)) next.push(other);
        found.set(other, Math.min(found.get(other) ?? Infinity, distance));
      }
    }
    frontier = next;
  }
  return found;
}

/**
 * The order the builds go in: what he stands in first, then what the picture and the game ask for, then the rest by how near
 * the link to it is. Lower first.
 */
const STREAM_RANK = { active: 0, seen: 1, pinned: 1, near: 2, unwanted: 3 };

/**
 * A stream over `graph` (visibility.js sectionGraph). `build(id, { now })`: a generator building section `id`, returning what was made
 * (`now`: it is built to its end with no frame drawn between its steps, behind the loading screen: it must not wait for one, STREAM_FRAME);
 * `free(id, made)`: let it go. `config`: SECTION_STREAM's fields to change. `now()`: the clock in ms (performance.now).
 * Returns { update, pump, ensureSteps, built, missing, pin, release, stats, dispose }.
 */
export function createSectionStream({ graph, build, free, config = {}, now = () => performance.now() }) {
  const numbers = { ...SECTION_STREAM, ...config };
  // id -> { made } once built; id -> { steps, rank, started } while building; id -> seconds unwanted, for those built.
  const built = new Map();
  const jobs = new Map();
  const idle = new Map();
  const pins = new Set();
  const wanted = new Map();
  const counts = { builds: 0, frees: 0, abandoned: 0, steps: 0, longestStepMs: 0, longestStep: null, buildMs: 0, lastPumpMs: 0 };

  const start = (id, rank, now = false) => {
    if (built.has(id)) return;
    const job = jobs.get(id);
    if (job) job.rank = Math.min(job.rank, rank);
    else jobs.set(id, { steps: build(id, { now }), rank, ms: 0, now });
  };

  const finish = (id, made, counted = true) => {
    jobs.delete(id);
    built.set(id, { made });
    idle.set(id, 0);
    if (counted) counts.builds += 1;
  };

  /** Let a built section go now (nothing asks whether it is wanted). */
  const release = (id) => {
    const entry = built.get(id);
    if (!entry) return false;
    built.delete(id);
    idle.delete(id);
    free(id, entry.made);
    counts.frees += 1;
    return true;
  };

  /**
   * What is wanted, from where he is: `position` [x, y, z], `active` the ids he stands in, `seen` the ids the picture would
   * paint in detail (built or not). Starts the builds wanted, counts the wait of those not, frees those past it. `dt` s.
   */
  const update = (dt, { position, active, seen = [] }) => {
    wanted.clear();
    for (const id of active) wanted.set(id, STREAM_RANK.active);
    for (const id of seen) if (!wanted.has(id)) wanted.set(id, STREAM_RANK.seen);
    for (const id of pins) if (!wanted.has(id)) wanted.set(id, STREAM_RANK.pinned);
    for (const [id, distance] of sectionsNear(graph, active, position, numbers.lead, numbers.hops)) if (!wanted.has(id)) wanted.set(id, distance <= numbers.urgent ? STREAM_RANK.seen : STREAM_RANK.near);
    for (const [id, rank] of wanted) start(id, rank);
    for (const [id, job] of [...jobs]) {
      // (One built at once behind the loading screen, ensureSteps, is its runner's to finish.)
      if (job.now) continue;
      job.rank = wanted.get(id) ?? STREAM_RANK.unwanted;
      job.unwanted = job.rank === STREAM_RANK.unwanted ? (job.unwanted ?? 0) + dt : 0;
      if (job.unwanted >= numbers.linger) {
        job.steps.return?.();
        jobs.delete(id);
        counts.abandoned += 1;
      }
    }
    const held = sectionsNear(graph, active, position, numbers.keep, numbers.hops);
    for (const id of [...built.keys()]) {
      if (wanted.has(id) || held.has(id)) {
        idle.set(id, 0);
        continue;
      }
      const waited = (idle.get(id) ?? 0) + dt;
      idle.set(id, waited);
      if (waited >= numbers.linger) release(id);
    }
  };

  /** The build to work on now: the most wanted, and of those the one begun first (a build is finished before the next of its rank starts); none set aside. */
  const nextJob = () => {
    let best = null;
    for (const [id, job] of jobs) if (job.waiting || job.rank >= STREAM_RANK.unwanted) continue;
    else if (!best || job.rank < best[1].rank || (job.rank === best[1].rank && job.ms > best[1].ms)) best = [id, job];
    return best;
  };

  /** One piece of work of a build; true when that build is done. */
  const step = (id, job) => {
    const begun = now();
    const next = job.steps.next();
    const took = now() - begun;
    job.waiting = next.value === STREAM_FRAME;
    job.ms += took;
    job.count = (job.count ?? 0) + 1;
    // (Named by what the build said it had done before it (a yield's value: 'houses', a decor piece's kind), so a tool can tell which piece is long.)
    if (took > counts.longestStepMs) counts.longestStep = `${id}#${job.count}${job.said ? ` after ${job.said}` : ''}`;
    if (typeof next.value === 'string' && next.value !== STREAM_FRAME) job.said = next.value;
    counts.steps += 1;
    counts.buildMs += took;
    counts.longestStepMs = Math.max(counts.longestStepMs, took);
    if (next.done) finish(id, next.value);
    return next.done;
  };

  /**
   * Build for up to `budgetMs` ms (a step is never cut: one longer than the budget takes its frame); `urgentMs` while the build first in
   * line is wanted now. Returns the ms spent.
   */
  const pump = (budgetMs = null) => {
    for (const job of jobs.values()) job.waiting = false;
    const first = nextJob();
    const budget = budgetMs ?? (first && first[1].rank <= STREAM_RANK.seen ? numbers.urgentMs : numbers.budgetMs);
    const begun = now();
    while (jobs.size && now() - begun < budget) {
      const best = nextJob();
      if (!best) break;
      step(best[0], best[1]);
    }
    counts.lastPumpMs = now() - begun;
    return counts.lastPumpMs;
  };

  /** Build each of `ids` to its end now, as steps (a generator for the loading screen's runner, loadsteps.js). */
  const ensureSteps = function* ensureSteps(ids) {
    for (const id of ids) {
      if (built.has(id)) continue;
      // (One begun in play may be waiting on a frame that will not come under the screen: it is begun again, at once.)
      const begun = jobs.get(id);
      if (begun && !begun.now) {
        begun.steps.return();
        jobs.delete(id);
      }
      start(id, STREAM_RANK.active, true);
      const job = jobs.get(id);
      while (!step(id, job)) yield;
    }
  };

  /** Count section `id` as built with `made` (built some other way: the whole place made at once, as its shadow is baked from all of it). */
  const adopt = (id, made) => {
    if (!built.has(id)) finish(id, made, false);
  };

  return {
    update,
    pump,
    adopt,
    ensureSteps,
    release,
    /** Whether section `id` is built. */
    built: (id) => built.has(id),
    /** What was made for section `id` (null if it is not built). */
    made: (id) => built.get(id)?.made ?? null,
    /** Those of `ids` not built. */
    missing: (ids) => ids.filter((id) => !built.has(id)),
    /** Keep `id` built whatever else (the place a scene is about to show); `on` false lets it go back to the rules. */
    pin: (id, on = true) => {
      if (on) pins.add(id);
      else pins.delete(id);
    },
    /** What the stream holds and has done: { built, building, wanted, builds, frees, steps, longestStepMs, buildMs }. */
    stats: () => ({ built: [...built.keys()], building: [...jobs.keys()], wanted: [...wanted.keys()], ...counts }),
    numbers,
    /** Let everything go. */
    dispose: () => {
      for (const job of jobs.values()) job.steps.return?.();
      jobs.clear();
      for (const id of [...built.keys()]) release(id);
    },
  };
}

// ---- what a section holds ------------------------------------------------------------------------------------------------

/** The texture slots of a material that are its own pictures (an environment map is the place's, shared by everything: never counted). */
const LEDGER_SLOTS = ['map', 'normalMap', 'roughnessMap', 'metalnessMap', 'emissiveMap', 'alphaMap', 'aoMap', 'bumpMap', 'displacementMap', 'lightMap', 'specularMap', 'gradientMap'];

/** The geometries, materials and textures under `root` (an Object3D, walked with `traverse`). */
export function resourcesUnder(root) {
  const found = new Set();
  root.traverse((object) => {
    if (object.geometry) found.add(object.geometry);
    for (const material of [].concat(object.material ?? [])) {
      found.add(material);
      for (const slot of LEDGER_SLOTS) if (material[slot]?.isTexture) found.add(material[slot]);
      // (A shader material's own pictures; a render target's is never a section's to free.)
      for (const uniform of Object.values(material.uniforms ?? {})) if (uniform?.value?.isTexture && !uniform.value.isRenderTargetTexture && uniform.value.image?.data !== undefined) found.add(uniform.value);
    }
  });
  return found;
}

/**
 * Who holds each geometry, material and texture of a place drawn in sections, so that letting a section go frees what only it
 * held and nothing another section, or the place itself, still draws with: the castle kit's stone materials and their maps are
 * shared by every room, a flame's card by every torch. `hold(holder, root, { forever })` counts what is under `root` as held by
 * `holder` (`forever`: never freed while the ledger lives: the place's own land, silhouettes and kit); `drop(holder)` lets go of
 * its share and disposes each thing no one holds any more. `keep(material)`: true for a material not to be disposed when the last
 * holder lets go (the one material that holds a shader program alive, levelmode/kit.js: a program let go costs 140-260 ms to
 * build again on an M1, a hitch, where the material itself is a few hundred bytes); its pictures are still freed.
 * Returns { hold, drop, holders, counts }.
 */
export function createResourceLedger({ keep = () => false } = {}) {
  const users = new Map();
  const held = new Map();
  const forever = new Set();
  const counts = { geometries: 0, materials: 0, textures: 0, kept: 0 };
  const hold = (holder, root, { forever: always = false } = {}) => {
    const list = held.get(holder) ?? new Set();
    held.set(holder, list);
    for (const resource of resourcesUnder(root)) {
      if (always) forever.add(resource);
      list.add(resource);
      if (!users.has(resource)) users.set(resource, new Set());
      users.get(resource).add(holder);
    }
  };
  const drop = (holder) => {
    const list = held.get(holder);
    if (!list) return { geometries: 0, materials: 0, textures: 0 };
    held.delete(holder);
    const freed = { geometries: 0, materials: 0, textures: 0 };
    for (const resource of list) {
      const who = users.get(resource);
      who?.delete(holder);
      if (who?.size || forever.has(resource)) continue;
      users.delete(resource);
      if (resource.isMaterial) {
        if (keep(resource)) {
          counts.kept += 1;
          continue;
        }
        freed.materials += 1;
      } else if (resource.isTexture) freed.textures += 1;
      else freed.geometries += 1;
      resource.dispose();
    }
    counts.geometries += freed.geometries;
    counts.materials += freed.materials;
    counts.textures += freed.textures;
    return freed;
  };
  return { hold, drop, holders: () => [...held.keys()], counts };
}
