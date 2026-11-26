// A world's state as JSON-ready data and back (port groundwork, the user's call, 2026-11-26): a fight snapshotted mid-way,
// restored into a fresh process, goes on bit for bit (test/simsnapshot.test.js). For saves, rollback and the host's snapshots
// of a small online fight later; and as the plain record of what a fight's state is, for the port.
//
// The world is a graph, not a tree: a man's `seenPunch` is the other man's `punch`, `fighter.arena` is `world.arena`, events
// share their point arrays with `fighter.blowAt`. So the snapshot is a table of the objects reached from the world, each once,
// and a reference is the index of its row: identity is kept. Sets and Maps (12 of them in a duel: `broken`, `cutParts`,
// `world.clashing`...) are rows of their own, in their insertion order, as JS iterates them. Numbers keep their bits:
// Infinity, -Infinity, NaN and -0 are written as tags (JSON has none of them), so are undefined and the typed arrays (Float64
// as the numbers, which JSON writes and reads back exactly).
//
// What is code, not data, is not written: functions (world.random, a terrain's lookups). A restore therefore begins from the
// same bout made afresh (sim.js createSim of the bout's setup) and pours the snapshot into it in place, object by object along
// the same paths, so every function the fresh world holds keeps pointing at the objects it closes over (world.random at
// world.rng, whose `state` the snapshot then sets). An object the fight made that the fresh world has no counterpart for is made
// new; a function found only there cannot be restored, and is named in the error.

/** The snapshot format's version (bumped when the encoding changes). */
export const SNAPSHOT_VERSION = 1;

const TYPED = { Float64Array, Float32Array, Int32Array, Uint32Array, Int16Array, Uint16Array, Int8Array, Uint8Array, Uint8ClampedArray };

/** A number JSON cannot hold as it is, as a tag; else the number. */
function numberOut(value) {
  if (Number.isNaN(value)) return { n: 'NaN' };
  if (value === Infinity) return { n: 'Inf' };
  if (value === -Infinity) return { n: '-Inf' };
  if (Object.is(value, -0)) return { n: '-0' };
  return value;
}

const NUMBER_IN = { NaN: NaN, Inf: Infinity, '-Inf': -Infinity, '-0': -0 };

/**
 * The world as data: { version, root, rows }. Each row is one object: { o: { key: value } } a plain object, { a: [...] } an
 * array, { t: 'Float64Array', v: [...] } a typed array, { s: [...] } a Set, { m: [[k, v]...] } a Map. A value is a JSON
 * primitive, { r: row } a reference, { n: tag } a number JSON has not, { u: 1 } undefined, { f: 1 } a function (left to the
 * fresh world). `paths` (optional, for errors): the first path each row was met at.
 */
export function snapshotWorld(world) {
  const rows = [];
  const rowOf = new Map();
  const encode = (value) => {
    if (value === undefined) return { u: 1 };
    if (value === null || typeof value === 'boolean' || typeof value === 'string') return value;
    if (typeof value === 'number') return numberOut(value);
    if (typeof value === 'function') return { f: 1 };
    if (typeof value === 'bigint' || typeof value === 'symbol') throw new Error(`snapshotWorld: a ${typeof value} in the world`);
    if (rowOf.has(value)) return { r: rowOf.get(value) };
    const index = rows.length;
    rowOf.set(value, index);
    rows.push(null);
    let row;
    if (ArrayBuffer.isView(value)) row = { t: value.constructor.name, v: Array.from(value, numberOut) };
    else if (Array.isArray(value)) row = { a: Array.from(value, encode) };
    else if (value instanceof Set) row = { s: [...value].map(encode) };
    else if (value instanceof Map) row = { m: [...value].map(([key, entry]) => [encode(key), encode(entry)]) };
    else {
      const prototype = Object.getPrototypeOf(value);
      if (prototype !== Object.prototype && prototype !== null) throw new Error(`snapshotWorld: an object of class ${prototype?.constructor?.name} in the world`);
      const fields = {};
      for (const key of Object.keys(value)) fields[key] = encode(value[key]);
      row = { o: fields };
    }
    rows[index] = row;
    return { r: index };
  };
  const root = encode(world).r;
  return { version: SNAPSHOT_VERSION, root, rows };
}

/**
 * The snapshot poured into `fresh` (the same bout made afresh: sim.js createSim of its setup), in place: returns `fresh`, now
 * the snapshotted world. Objects are reused where the fresh world has one of the same kind at the same place (so the code it
 * holds keeps its objects), made new where it has none.
 */
export function restoreWorld(fresh, snapshot) {
  if (snapshot.version !== SNAPSHOT_VERSION) throw new Error(`restoreWorld: snapshot version ${snapshot.version}, this build reads ${SNAPSHOT_VERSION}`);
  const { rows } = snapshot;
  const made = new Map();
  const kindOf = (row) => (row.t ? row.t : row.a ? 'array' : row.s ? 'set' : row.m ? 'map' : 'object');
  const kindOfValue = (value) => (value === null || typeof value !== 'object' ? null : ArrayBuffer.isView(value) ? value.constructor.name : Array.isArray(value) ? 'array' : value instanceof Set ? 'set' : value instanceof Map ? 'map' : 'object');
  // A value of the snapshot, given what the fresh world holds in its place (`there`) and where that is (for errors).
  const decode = (value, there, path) => {
    if (value === null || typeof value !== 'object') return value;
    if (value.u) return undefined;
    if (value.n) return NUMBER_IN[value.n];
    if (value.f) {
      if (typeof there !== 'function') throw new Error(`restoreWorld: ${path} was a function the fresh world does not have`);
      return there;
    }
    return fill(value.r, there, path);
  };
  const fill = (index, there, path) => {
    if (made.has(index)) return made.get(index);
    const row = rows[index];
    const kind = kindOf(row);
    if (row.t) {
      const values = row.v.map((entry) => (typeof entry === 'object' ? NUMBER_IN[entry.n] : entry));
      const target = kindOfValue(there) === kind && there.length === values.length ? there : new TYPED[kind](values.length);
      made.set(index, target);
      target.set(values);
      return target;
    }
    const target = kindOfValue(there) === kind ? there : kind === 'array' ? [] : kind === 'set' ? new Set() : kind === 'map' ? new Map() : {};
    made.set(index, target);
    if (kind === 'array') {
      const before = target.slice();
      target.length = row.a.length;
      row.a.forEach((entry, at) => { target[at] = decode(entry, before[at], `${path}[${at}]`); });
    } else if (kind === 'set') {
      const before = [...target];
      target.clear();
      row.s.forEach((entry, at) => target.add(decode(entry, before[at], `${path}{${at}}`)));
    } else if (kind === 'map') {
      const before = new Map(target);
      target.clear();
      for (const [key, entry] of row.m) {
        const restoredKey = decode(key, undefined, `${path}<key>`);
        target.set(restoredKey, decode(entry, before.get(restoredKey), `${path}<${String(restoredKey)}>`));
      }
    } else {
      // (Emptied and filled in the snapshot's order: code that walks an object's keys meets them as the fight left them.)
      const before = { ...target };
      for (const key of Object.keys(target)) delete target[key];
      for (const [key, entry] of Object.entries(row.o)) target[key] = decode(entry, before[key], `${path}.${key}`);
    }
    return target;
  };
  return fill(snapshot.root, fresh, 'world');
}
