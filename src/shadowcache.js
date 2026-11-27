// The still part of the sun's shadow drawn once (the user's call, 2026-11-26).
//
// Three draws every light's shadow map afresh at every frame, every caster in it. Much of what stands in a place
// casts the same shadow from one frame to the next: a wall, a house, a fence, a rock. Here such a caster, once it
// has kept still a while, is drawn into a map of its own (the cache), and at each frame the live map is not cleared
// but copied from the cache (colour and depth, one blit), and only what moves (men, horses, weapons, cloth, and any
// scenery that moved lately) is drawn over it. Since the copy carries the cache's depth buffer as well as its packed
// depths, what moves is depth-tested against the still casters exactly as when all were drawn together: the live
// map ends up as it would have been, so the receivers sample it unchanged (no second map to look up, no double
// shadow where the two kinds meet, the same bias and softness).
//
// The cache is drawn wider than the live map by SHADOW_CACHE.margin on each side, on the same lattice of texels:
// the live box is carried with the camera a whole texel at a time (env/index.js, townkit/place.js), so while it
// stays inside the cache's, the copy is a shifted window of whole texels, and the cache is not drawn again.
// It is drawn again when that is not so: the box has wandered past the margin, the sun has turned, the map's size,
// depth or reach has changed, or the box has slid along the sun's way (the map's depth is measured along it; the
// carried boxes step along it in whole SHADOW_CACHE.alongStep, so it seldom does); and when what it holds has
// changed: a cached caster moved, was hidden, was changed or freed (a gate swung, a prop knocked over, a streamed
// section let go), or newly settled ones are waiting to join.
//
// What may be cached: a mesh of the place's own scenery (the group the place is drawn in, streamed sections and
// stage pieces with it) that casts, has no children, no skin, no morphs and no depth material of its own (one that
// could move its shadow without its matrix moving). Everything else, and every instanced crowd, is drawn live.
// A cached mesh is watched at every frame for its matrix, its visibility up the tree, its geometry and material;
// any change takes it out of the cache that frame, and it may join again after SHADOW_CACHE.settle still frames.
//
// It is all done inside three's own shadow pass (the renderer's shadow map's render is wrapped, three itself
// untouched): the cache is drawn there by three's own code with a light of its own, and the live map's clear is
// the copy. Needs WebGL 2 (the blit); without it, or with it off, the pass is three's as before.

/** The cache's tuning. */
export const SHADOW_CACHE = {
  on: true,
  // How far past the live map the cache reaches on each side, as a share of the live map's side: the live box may
  // wander that far before the cache is drawn again. An eighth: the camera walks an eighth of the box (4 m of the
  // town's 32, 1 m of the fight's finer 8) between draws, for a cache of 1.25 times the side, about 1.6 times the
  // live map's memory (10 MB beside a 1024 map, 39 MB beside a 2048 one); a quarter drew a little less often for
  // 2.25 times the memory, which the page's memory can less well afford than a redraw every second or so.
  margin: 0.125,
  // Frames a mesh must keep still before it joins the cache: a gate swinging or a cart rolling moves on frames in a
  // row, and each change of what is cached costs a draw of the whole cache.
  settle: 30,
  // How often (in shadow passes) the place's scenery is walked for casters that came or went (streamed sections).
  scanEvery: 30,
  // Fewest passes between draws of the cache made only to take in newly settled meshes (a change that must be
  // taken out is never kept waiting).
  joinEvery: 60,
  // Fewest triangles the still meshes must hold between them for a cache to be made: it costs a map a quarter again as
  // wide as the live one (some 10 MB beside a 1024 map, a light), and a blit a frame, so a few fences and a cart are
  // drawn live as before. 20000: a field's few props stay live; an arena's stands (140000) or a fort's walls are cached.
  least: 20000,
  // Passes a light's cache is kept with nothing to hold before its map is freed: two seconds or so, so a place
  // left, or a cache brought under `least`, gives its memory back soon, while one flickering in and out is not made anew each time.
  idleFree: 120,
  // How far apart (in texels) the live box and the cache's may sit off the whole-texel lattice and still be
  // copied: the boxes are put on it exactly, so this is only for the rounding of their sums.
  texelTolerance: 1e-3,
  // How far (m) the live box may sit from the cache's along the sun's way: a map holds depth measured along it, so
  // copied depths are only right where the two boxes stand level. A tenth of a millimetre: far under one step of
  // the depth buffer over a box tens of metres deep, and over the rounding of a position some hundreds of metres out.
  alongTolerance: 1e-4,
  // The step (m) a carried box takes along the sun's way (shadowCacheAlong): its stand follows the ground under the
  // camera, which rises and falls a little at every step taken; in whole half metres the stand keeps still across a
  // floor, and the box's depth (half its depth either side of the ground, 15 m or more) leaves room for half a metre.
  alongStep: 0.5,
  // How close (as a cosine's shortfall) the sun's way must be to the cache's: any turn of the sun redraws it.
  turnTolerance: 1e-7,
};

/**
 * Put a carried shadow box's aim (`target`, a Vector3 moved in place) on the step along the sun's way (`sun`, the
 * unit vector toward the sun as [x, y, z]): its right and up are not touched, so it stays on its texel lattice.
 */
export function shadowCacheAlong(target, sun) {
  const step = SHADOW_CACHE.alongStep;
  if (!(step > 0)) return target;
  const along = target.x * sun[0] + target.y * sun[1] + target.z * sun[2];
  const shift = Math.round(along / step) * step - along;
  return target.set(target.x + sun[0] * shift, target.y + sun[1] * shift, target.z + sun[2] * shift);
}

/** Wrap the view's renderer's shadow pass with the cache (once, at the scene's making: render.js createScene). */
export function installShadowCache(view) {
  const renderer = view.renderer;
  if (!renderer.capabilities.isWebGL2 || renderer.shadowMap.shadowCacheWrapped) return;
  const shadowMap = renderer.shadowMap;
  const threeRender = shadowMap.render;
  const state = {
    passes: 0,
    // The meshes watched (mesh -> record) and the version of the set that is cached (any change: every cache redrawn).
    records: new Map(),
    cached: [],
    triangles: 0,
    version: 0,
    lastScan: -Infinity,
    lastPlace: null,
    lights: new Map(),
    stats: { passes: 0, draws: 0, copies: 0, cached: 0, watched: 0, why: {} },
    enabled: true,
    // (Tests: one pass drawn as three draws it with the caches kept, to compare a shifted copy with the whole.)
    aside: false,
  };
  view.shadowCache = state;
  state.statsNow = () => ({ ...state.stats, cached: state.cached.length, triangles: state.triangles, watched: state.records.size, lights: [...state.lights.values()].map((entry) => ({ size: entry.light?.shadow.map ? [entry.light.shadow.map.width, entry.light.shadow.map.height] : null, built: entry.built })) });
  renderer.domElement.addEventListener?.('webglcontextlost', () => shadowCacheForget(state));
  shadowMap.shadowCacheWrapped = true;
  shadowMap.render = function shadowCacheRender(lights, scene, camera) {
    if (!SHADOW_CACHE.on || !state.enabled || state.aside || scene !== view.scene || !this.enabled || this.type === THREE.VSMShadowMap || !lights.length || (this.autoUpdate === false && this.needsUpdate === false)) {
      if (state.lights.size && (!SHADOW_CACHE.on || !state.enabled)) shadowCacheForget(state);
      // (A pass three would skip, or one drawn as three draws it for a test, is three's own.)
      if (state.aside || !this.enabled || (this.autoUpdate === false && this.needsUpdate === false)) return threeRender.call(this, lights, scene, camera);
      return shadowLiveRender(view, this, threeRender, lights, scene, camera);
    }
    state.passes += 1;
    state.stats.passes += 1;
    shadowCacheWatch(state, view);
    const cacheable = [];
    const plain = [];
    for (const light of lights) (shadowCacheReady(state, renderer, light) ? cacheable : plain).push(light);
    if (plain.length) {
      shadowLiveRender(view, this, threeRender, plain, scene, camera);
    }
    if (!cacheable.length) return;
    for (const light of cacheable) {
      const entry = state.lights.get(light);
      if (entry.built !== state.version || !shadowCacheAligned(entry, light)) shadowCacheBuild(state, renderer, threeRender, light, entry, camera);
    }
    // The live maps: each "cleared" by the copy of its cache, then what moves drawn over it; the cached meshes stand
    // aside meanwhile (their shadow is in the copy).
    const clear = renderer.clear;
    renderer.clear = function shadowCacheClear(color, depth, stencil) {
      const target = renderer.getRenderTarget();
      for (const light of cacheable) {
        if (light.shadow.map === target) {
          shadowCacheCopy(renderer, state.lights.get(light), light);
          state.stats.copies += 1;
          return;
        }
      }
      clear.call(renderer, color, depth, stencil);
    };
    for (const record of state.cached) record.mesh.castShadow = false;
    try {
      shadowLiveRender(view, this, threeRender, cacheable, scene, camera);
    } finally {
      for (const record of state.cached) record.mesh.castShadow = true;
      renderer.clear = clear;
    }
  };
}

/**
 * The live draw of `lights`' maps (what moves, every frame), less what a light's map would hold to no purpose: the
 * view's `shadowSkip(light)` (env/index.js envFinerSkip) names the casters whose shadow in that light's map no
 * receiver ever reads this frame (the wide map under the finer one round the fight, where only the finer is looked
 * up). Those stand aside (castShadow off) while that light alone is drawn; the other lights are drawn together as
 * before. Only the live draw: a cache is drawn once and kept while the finer map moves, so it holds everything.
 */
function shadowLiveRender(view, shadowMap, threeRender, lights, scene, camera) {
  const skips = view.shadowSkip && scene === view.scene && shadowMap.type !== THREE.VSMShadowMap ? lights.map((light) => view.shadowSkip(light, scene)) : null;
  if (!skips?.some((skip) => skip?.length)) {
    shadowMap.needsUpdate = true;
    return threeRender.call(shadowMap, lights, scene, camera);
  }
  const rest = lights.filter((light, at) => !skips[at]?.length);
  if (rest.length) {
    shadowMap.needsUpdate = true;
    threeRender.call(shadowMap, rest, scene, camera);
  }
  lights.forEach((light, at) => {
    const skip = skips[at];
    if (!skip?.length) return;
    for (const mesh of skip) mesh.castShadow = false;
    try {
      shadowMap.needsUpdate = true;
      threeRender.call(shadowMap, [light], scene, camera);
    } finally {
      for (const mesh of skip) mesh.castShadow = true;
    }
  });
  if (view.shadowCache) view.shadowCache.stats.skipped = (view.shadowCache.stats.skipped ?? 0) + skips.reduce((sum, skip) => sum + (skip?.length ?? 0), 0);
}

/** Every cache dropped (the context lost, or the cache turned off): drawn again from nothing when next wanted. */
function shadowCacheForget(state) {
  for (const entry of state.lights.values()) entry.light?.shadow.map?.dispose();
  state.lights.clear();
  for (const record of state.records.values()) record.cached = false;
  state.cached = [];
  state.triangles = 0;
  state.version += 1;
}

/** The triangles a mesh puts into a shadow map (each copy of an instanced one). */
function shadowCacheTriangles(mesh) {
  const geometry = mesh.geometry;
  const count = geometry.index ? geometry.index.count : geometry.attributes.position?.count ?? 0;
  return Math.floor(Math.min(count, geometry.drawRange.count) / 3) * (mesh.isInstancedMesh ? mesh.count : 1);
}

/** Whether what is cached is worth a cache (SHADOW_CACHE.least). */
const shadowCacheWorth = (state) => state.cached.length > 0 && state.triangles >= SHADOW_CACHE.least;

/** Whether a mesh may be cached at all: one that casts, with nothing under it that could move on its own. */
function shadowCacheEligible(mesh) {
  return mesh.isMesh && mesh.castShadow && !mesh.isSkinnedMesh && !mesh.customDepthMaterial && !mesh.children.length && !(mesh.morphTargetInfluences?.length);
}

/** A mesh as it stands for its shadow: false where it is not drawn at all (hidden up the tree, or out of the scene). */
function shadowCacheShown(mesh, scene) {
  let at = mesh;
  for (; at.parent; at = at.parent) if (!at.visible) return false;
  return at === scene && at.visible;
}

/** Note what a record's mesh's shadow depends on; true if any of it differs from what was noted. */
function shadowCacheNote(record, scene) {
  const mesh = record.mesh;
  const geometry = mesh.geometry;
  const material = mesh.material;
  const shown = shadowCacheShown(mesh, scene) && shadowCacheEligible(mesh);
  const position = geometry?.attributes?.position;
  const parts = record.parts;
  const now = [shown, geometry, position, position?.version, geometry?.index?.version, geometry?.drawRange.start, geometry?.drawRange.count, material, Array.isArray(material) ? material.map((each) => each.visible).join() : material?.visible, material?.side, material?.shadowSide, mesh.isInstancedMesh ? mesh.count : 0, mesh.instanceMatrix?.version, mesh.frustumCulled];
  let changed = !parts;
  if (parts) for (let index = 0; index < now.length; index += 1) if (parts[index] !== now[index]) changed = true;
  record.parts = now;
  const elements = mesh.matrixWorld.elements;
  for (let index = 0; index < 16; index += 1) {
    if (record.matrix[index] !== elements[index]) {
      changed = true;
      record.matrix[index] = elements[index];
    }
  }
  record.shown = shown;
  return changed;
}

/** Once a pass: the place's scenery walked now and then for casters come and gone, every watched mesh checked. */
function shadowCacheWatch(state, view) {
  const place = view.places?.[view.place] ?? null;
  const scene = view.scene;
  let changedSet = false;
  if (place !== state.lastPlace || state.passes - state.lastScan >= SHADOW_CACHE.scanEvery) {
    state.lastScan = state.passes;
    state.lastPlace = place;
    const found = new Set();
    place?.traverse((object) => {
      if (!shadowCacheEligible(object)) return;
      found.add(object);
      if (!state.records.has(object)) state.records.set(object, { mesh: object, matrix: new Float64Array(16), parts: null, still: 0, cached: false, shown: false });
    });
    for (const [mesh, record] of state.records) {
      if (found.has(mesh)) continue;
      state.records.delete(mesh);
      if (record.cached) {
        changedSet = true;
        state.stats.why.gone = (state.stats.why.gone ?? 0) + 1;
      }
    }
  }
  const settled = [];
  for (const record of state.records.values()) {
    if (shadowCacheNote(record, scene)) {
      record.still = 0;
      if (record.cached) {
        record.cached = false;
        changedSet = true;
        state.stats.why.moved = (state.stats.why.moved ?? 0) + 1;
      }
    } else record.still += 1;
    if (!record.cached && record.shown && record.still >= SHADOW_CACHE.settle) settled.push(record);
  }
  // Newly settled meshes join at the next draw of the cache, or at most every `joinEvery` passes.
  const joinDue = settled.length && (changedSet || state.passes - (state.lastJoin ?? -Infinity) >= SHADOW_CACHE.joinEvery);
  if (joinDue) {
    for (const record of settled) record.cached = true;
    state.lastJoin = state.passes;
    state.stats.why.joined = (state.stats.why.joined ?? 0) + settled.length;
  }
  if (changedSet || joinDue) {
    state.cached = [...state.records.values()].filter((record) => record.cached);
    state.triangles = state.cached.reduce((sum, record) => sum + shadowCacheTriangles(record.mesh), 0);
    state.version += 1;
  }
  // (A light's cache with too little in it: freed after a while, so a place without still casters costs nothing.)
  if (!shadowCacheWorth(state)) {
    for (const [light, entry] of state.lights) {
      if (state.passes - entry.used > SHADOW_CACHE.idleFree) {
        entry.light.shadow.map?.dispose();
        state.lights.delete(light);
      }
    }
  }
}

/**
 * Whether this light's map is drawn by way of a cache this pass (an entry made for it if so): there must be still
 * meshes to hold, the light's shadow drawn this pass by three's own rule, and its camera one the copy can follow (an
 * orthographic one, the sun's, unzoomed).
 */
function shadowCacheReady(state, renderer, light) {
  const shadow = light.shadow;
  if (!shadowCacheWorth(state) || !light.isDirectionalLight || !shadow || (shadow.autoUpdate === false && shadow.needsUpdate === false)) return false;
  if (!shadow.camera.isOrthographicCamera || shadow.camera.zoom !== 1 || shadow.getViewportCount() !== 1) return false;
  let entry = state.lights.get(light);
  if (!entry) {
    // The cache's own light, never in the scene: three draws its map as it draws any light's.
    const own = new THREE.DirectionalLight(0xffffff, 0);
    own.name = `${light.name || 'sun'}.cache`;
    entry = { light: own, built: -1, margin: 0, used: state.passes, centre: new THREE.Vector3(), basis: new THREE.Matrix4(), box: [] };
    state.lights.set(light, entry);
  }
  // (The live map is made by three at its light's first pass; until then there is nothing to copy into.)
  if (!shadow.map) return false;
  const size = shadow.mapSize.x;
  const margin = Math.round(size * SHADOW_CACHE.margin);
  const max = renderer.capabilities.maxTextureSize;
  if (size + 2 * margin > max || shadow.mapSize.y + 2 * margin > max) return false;
  entry.used = state.passes;
  // The live camera put where three will put it this pass (it does the same again; it needs only the matrices).
  shadow.updateMatrices(light);
  return true;
}

/** Whether the live box sits on the cache's lattice, inside its margin, level with it and facing the same way; notes the window to copy. */
function shadowCacheAligned(entry, light) {
  const shadow = light.shadow;
  const camera = shadow.camera;
  const box = [camera.left, camera.right, camera.top, camera.bottom, camera.near, camera.far, shadow.mapSize.x, shadow.mapSize.y];
  for (let index = 0; index < box.length; index += 1) if (entry.box[index] !== box[index]) return shadowCacheWhy(entry, 'box');
  const own = entry.basis.elements;
  const live = camera.matrixWorld.elements;
  // (The sun's way: the camera's own back axis, its third column.)
  const facing = own[8] * live[8] + own[9] * live[9] + own[10] * live[10];
  const level = own[0] * live[0] + own[1] * live[1] + own[2] * live[2];
  if (1 - facing > SHADOW_CACHE.turnTolerance || 1 - level > SHADOW_CACHE.turnTolerance) return shadowCacheWhy(entry, 'turned');
  const dx = live[12] - entry.centre.x;
  const dy = live[13] - entry.centre.y;
  const dz = live[14] - entry.centre.z;
  const texelX = (camera.right - camera.left) / shadow.mapSize.x;
  const texelY = (camera.top - camera.bottom) / shadow.mapSize.y;
  const across = (dx * own[0] + dy * own[1] + dz * own[2]) / texelX;
  const up = (dx * own[4] + dy * own[5] + dz * own[6]) / texelY;
  const along = dx * own[8] + dy * own[9] + dz * own[10];
  if (Math.abs(along) > SHADOW_CACHE.alongTolerance) return shadowCacheWhy(entry, 'along');
  const stepsAcross = Math.round(across);
  const stepsUp = Math.round(up);
  if (Math.abs(across - stepsAcross) > SHADOW_CACHE.texelTolerance || Math.abs(up - stepsUp) > SHADOW_CACHE.texelTolerance) return shadowCacheWhy(entry, 'lattice');
  if (Math.abs(stepsAcross) > entry.margin || Math.abs(stepsUp) > entry.margin) return shadowCacheWhy(entry, 'wandered');
  entry.from = [entry.margin + stepsAcross, entry.margin + stepsUp];
  return true;
}

function shadowCacheWhy(entry, why) {
  entry.why = why;
  return false;
}

/**
 * Draw a light's cache: the cached meshes alone, by three's own pass, from a light of the cache's own standing
 * where the live one stands, its box the live box and the margin on every side, on the same texels.
 */
function shadowCacheBuild(state, renderer, threeRender, light, entry, camera) {
  const shadow = light.shadow;
  const live = shadow.camera;
  const own = entry.light;
  const margin = Math.round(shadow.mapSize.x * SHADOW_CACHE.margin);
  const texelX = (live.right - live.left) / shadow.mapSize.x;
  const texelY = (live.top - live.bottom) / shadow.mapSize.y;
  const width = shadow.mapSize.x + 2 * margin;
  const height = shadow.mapSize.y + 2 * margin;
  if (own.shadow.mapSize.x !== width || own.shadow.mapSize.y !== height) {
    own.shadow.mapSize.set(width, height);
    own.shadow.map?.dispose();
    own.shadow.map = null;
  }
  Object.assign(own.shadow.camera, { left: live.left - margin * texelX, right: live.right + margin * texelX, top: live.top + margin * texelY, bottom: live.bottom - margin * texelY, near: live.near, far: live.far });
  own.shadow.camera.updateProjectionMatrix();
  // The cache's light where the live camera stands, aimed the live light's way (so it is turned exactly as the live camera is).
  // (A camera looks down its own -z: the aim is a metre that way.)
  const at = live.matrixWorld.elements;
  own.position.set(at[12], at[13], at[14]);
  own.target.position.set(at[12] - at[8], at[13] - at[9], at[14] - at[10]);
  own.updateMatrixWorld(true);
  own.target.updateMatrixWorld(true);
  own.shadow.updateMatrices(own);
  entry.centre.setFromMatrixPosition(own.shadow.camera.matrixWorld);
  entry.basis.copy(own.shadow.camera.matrixWorld);
  entry.box = [live.left, live.right, live.top, live.bottom, live.near, live.far, shadow.mapSize.x, shadow.mapSize.y];
  entry.margin = margin;
  entry.from = [margin, margin];
  // Only the cached meshes are walked: they hang under a stand-in for the scene (their own parents untouched).
  const stand = (state.stand ??= { visible: true, layers: new THREE.Layers(), children: [], isMesh: false });
  stand.layers.mask = camera.layers.mask;
  stand.children = state.cached.filter((record) => record.shown).map((record) => record.mesh);
  const calls = renderer.info.render.calls;
  renderer.shadowMap.needsUpdate = true;
  threeRender.call(renderer.shadowMap, [own], stand, camera);
  stand.children = [];
  state.stats.draws += 1;
  state.stats.why[entry.why ?? 'first'] = (state.stats.why[entry.why ?? 'first'] ?? 0) + 1;
  state.stats.lastBuildCalls = renderer.info.render.calls - calls;
  entry.built = state.version;
  entry.why = 'held';
  // (Where the live box now stands relative to the cache: at its middle.)
  shadowCacheAligned(entry, light);
}

/** The live map "cleared" to its cache: the window under the live box copied, colour and depth, texel for texel. */
function shadowCacheCopy(renderer, entry, light) {
  const gl = renderer.getContext();
  const state = renderer.state;
  const from = renderer.properties.get(entry.light.shadow.map).__webglFramebuffer;
  const to = renderer.properties.get(light.shadow.map).__webglFramebuffer;
  const width = light.shadow.map.width;
  const height = light.shadow.map.height;
  const [x, y] = entry.from;
  state.bindFramebuffer(gl.READ_FRAMEBUFFER, from);
  state.bindFramebuffer(gl.DRAW_FRAMEBUFFER, to);
  gl.blitFramebuffer(x, y, x + width, y + height, 0, 0, width, height, gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT, gl.NEAREST);
  // (Read back to the live map too, as three last bound it: its own note of what is bound stays true.)
  state.bindFramebuffer(gl.READ_FRAMEBUFFER, to);
}
