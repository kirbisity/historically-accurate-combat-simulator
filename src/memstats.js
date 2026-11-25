// What the scene holds in memory, counted (boxer.memory): every vertex attribute, index and texture reachable from the
// scene and the fighters' views, each buffer counted once however many meshes share it. A man's own bytes are those only
// he draws from; the rest is shared (a crowd template, a place). Used to find what is large, what is copied per man that
// could be shared, and what a fight leaves behind when it ends (the counts must come back between bouts).

/** Bytes of one texture as held on the GPU (and, for a canvas or typed array, on the CPU too): four a texel, a third more for mipmaps. */
export function textureBytes(texture) {
  const image = texture.image;
  if (!image) return 0;
  const images = Array.isArray(image) ? image : [image];
  let bytes = 0;
  for (const one of images) {
    const width = one?.width ?? one?.videoWidth ?? 0;
    const height = one?.height ?? one?.videoHeight ?? 0;
    const depth = one?.depth ?? 1;
    const perTexel = one?.data?.BYTES_PER_ELEMENT ? one.data.length / Math.max(1, width * height * depth) * one.data.BYTES_PER_ELEMENT : 4;
    bytes += width * height * depth * perTexel;
  }
  return Math.round(bytes * (texture.generateMipmaps !== false && texture.minFilter !== 1006 && texture.minFilter !== 1003 ? 4 / 3 : 1));
}

/** The textures a material uses: its maps and any texture among its uniforms (a shader patch's). */
export function materialTextures(material) {
  const found = new Set();
  for (const value of Object.values(material)) if (value?.isTexture) found.add(value);
  for (const uniform of Object.values(material.uniforms ?? {})) {
    const value = uniform?.value;
    if (value?.isTexture) found.add(value);
    if (Array.isArray(value)) for (const item of value) if (item?.isTexture) found.add(item);
  }
  for (const uniform of Object.values(material.userData?.shader?.uniforms ?? {})) if (uniform?.value?.isTexture) found.add(uniform.value);
  return found;
}

/** The typed arrays of a geometry: each attribute's (an interleaved one's buffer) and its index. */
export function geometryArrays(geometry) {
  const arrays = [];
  for (const [name, attribute] of Object.entries(geometry.attributes)) arrays.push([name, attribute.isInterleavedBufferAttribute ? attribute.data : attribute]);
  for (const [name, list] of Object.entries(geometry.morphAttributes ?? {})) for (const attribute of list) arrays.push([`morph:${name}`, attribute]);
  if (geometry.index) arrays.push(['index', geometry.index]);
  return arrays.filter(([, attribute]) => cardBytes(attribute));
}

/** An attribute's bytes on the card (its count times its item, whether or not the page still holds them: meshpack.js). */
function cardBytes(attribute) {
  const per = attribute.array?.BYTES_PER_ELEMENT ?? 4;
  return attribute.isInterleavedBuffer ? attribute.count * attribute.stride * per : attribute.count * attribute.itemSize * per;
}

/**
 * The scene's memory: `geometry` and `texture` bytes, the biggest of each (`top`), and per man (`views`: each fighter view's
 * own bytes and the bytes he shares, by whether he is drawn baked, as one of a crowd, or in full).
 */
export function memoryStats(root, views = [], { top = 8 } = {}) {
  // Each array, the meshes (by owner) that use it.
  const arrays = new Map();
  const textures = new Map();
  const owners = new Map();
  for (const view of views) view?.group?.traverse((object) => owners.set(object, view));
  let holder = 'scene';
  const note = (object, owner) => {
    if (object.geometry) {
      for (const [name, array] of geometryArrays(object.geometry)) {
        const entry = arrays.get(array) ?? { bytes: cardBytes(array), pageBytes: array.array?.byteLength ?? 0, name, label: whereIs(object), users: new Set() };
        entry.users.add(owner ?? 'scene');
        entry.holder ??= owner ? (owner.baked ? 'crowd men' : 'full men') : holder;
        arrays.set(array, entry);
      }
    }
    for (const material of [].concat(object.material ?? [])) {
      for (const texture of materialTextures(material)) {
        const entry = textures.get(texture) ?? { bytes: textureBytes(texture), label: `${texture.name || material.name || material.type} ${texture.image?.width}x${texture.image?.height} at ${whereIs(object)}`, users: new Set() };
        entry.users.add(owner ?? 'scene');
        entry.holder ??= owner ? (owner.baked ? 'crowd men' : 'full men') : holder;
        textures.set(texture, entry);
      }
    }
  };
  for (const child of root.children) {
    holder = child.name || Object.keys(child.userData ?? {})[0] || child.type;
    child.traverse((object) => note(object, owners.get(object)));
  }
  // A view's meshes out of the scene (a far body hidden, layers not built) still hold memory.
  for (const view of views) view?.group?.traverse((object) => { if (!object.parent || !isIn(root, object)) note(object, view); });
  const sum = (map) => [...map.values()].reduce((total, entry) => total + entry.bytes, 0);
  const biggest = (map) => [...map.values()].sort((a, b) => b.bytes - a.bytes).slice(0, top).map((entry) => ({ label: entry.label, name: entry.name, mb: +(entry.bytes / 1e6).toFixed(2), users: entry.users.size }));
  // The bytes by what holds them (the scene's top-level groups, the men by tier) and, for geometry, by attribute.
  const grouped = (map, key) => {
    const groups = {};
    for (const entry of map.values()) groups[key(entry)] = (groups[key(entry)] ?? 0) + entry.bytes / 1e6;
    return Object.fromEntries(Object.entries(groups).sort((a, b) => b[1] - a[1]).slice(0, 16).map(([name, mb]) => [name, +mb.toFixed(1)]));
  };
  const perView = views.map((view) => {
    let own = 0;
    let shared = 0;
    for (const entry of arrays.values()) {
      if (!entry.users.has(view)) continue;
      if (entry.users.size === 1) own += entry.bytes;
      else shared += entry.bytes / entry.users.size;
    }
    return { id: view.fighter?.id, tier: view.baked ? 'crowd' : 'full', own, shared };
  });
  const tiers = {};
  for (const view of perView) {
    const tier = (tiers[view.tier] ??= { men: 0, ownMb: 0, sharedMb: 0 });
    tier.men += 1;
    tier.ownMb += view.own / 1e6;
    tier.sharedMb += view.shared / 1e6;
  }
  for (const tier of Object.values(tiers)) {
    tier.ownPerManMb = +(tier.ownMb / tier.men).toFixed(3);
    tier.ownMb = +tier.ownMb.toFixed(1);
    tier.sharedMb = +tier.sharedMb.toFixed(1);
  }
  return {
    geometryMb: +(sum(arrays) / 1e6).toFixed(1),
    // (The same geometry's bytes still held on the page: less than the card's where meshpack.js let them go.)
    geometryPageMb: +([...arrays.values()].reduce((total, entry) => total + entry.pageBytes, 0) / 1e6).toFixed(1),
    textureMb: +(sum(textures) / 1e6).toFixed(1),
    arrays: arrays.size,
    textures: textures.size,
    geometryBy: grouped(arrays, (entry) => entry.holder),
    geometryByAttribute: grouped(arrays, (entry) => entry.name),
    textureBy: grouped(textures, (entry) => entry.holder),
    topGeometry: biggest(arrays),
    topTextures: biggest(textures),
    tiers,
    // One man of each tier: what is his own, by attribute.
    sample: Object.fromEntries(['crowd', 'full'].map((tier) => {
      const view = views.find((each) => (each.baked ? 'crowd' : 'full') === tier);
      if (!view) return [tier, null];
      const own = {};
      for (const entry of arrays.values()) if (entry.users.size === 1 && entry.users.has(view)) own[entry.name] = +(((own[entry.name] ?? 0) + entry.bytes / 1e6)).toFixed(3);
      return [tier, own];
    })),
  };
}

function isIn(root, object) {
  for (let at = object; at; at = at.parent) if (at === root) return true;
  return false;
}

/** A mesh named by itself and its nearest named holders (for the lists of the biggest). */
function whereIs(object) {
  const names = [];
  for (let at = object; at && names.length < 3; at = at.parent) if (at.name) names.push(at.name);
  for (let at = object; at && names.length < 3; at = at.parent) for (const key of Object.keys(at.userData ?? {})) if (names.length < 3 && typeof at.userData[key] !== 'object') names.push(`#${key}`);
  return `${object.type}${names.length ? ` ${names.join('<')}` : ''}`;
}
