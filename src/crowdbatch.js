// The distant men of a crowd drawn as batches: every man past CROWD_BATCH.distance whose look is one already in a batch is
// drawn as one copy of that batch's far body, all copies in one draw call (two with the steel), instead of as his own
// skinned meshes (two to six draw calls a man, each with its own bones uploaded). Only the picture: his simulation, his pose
// and his bones are untouched. Each frame his bones are posed as ever (render.js updateFighterView) and their skinning
// matrices written into one shared float texture, a row a man; the batch's vertex shader reads his row (a per-copy slot) in
// place of three's own bone uniforms, so a copy stands, walks and falls exactly as the man does, in the pose he has that
// frame. Near, or once he is one of the protected men (crowdlod.js protectedMen), he is drawn in his own meshes again, from
// the same bones: the switch keeps his pose, and the body is the far body either way (CROWD_VIEW.lodDistance is well inside).
//
// What a batch shares is one man's far body (the first of that look met: its `rep`), set to each man's lengths by his own
// stretched bone inverses (crowdview.js stretchedInverses), as a crowd template is. Men of one batch differ only in what a
// distance hides: hair under a helmet, a beard, girth by a few centimetres (training and fat are in a template's key, not a
// batch's); their skin is tinted to each man's own (a per-copy colour on the bare-skin vertices). The worn head props
// (a crest, a plume) are batched likewise, by the batch's look and the prop's kind. Weapons, shields and banners were already
// batched (crowdview.js CrowdBatch). His wounds, blood and wetness show on his own meshes, near: a copy is drawn dry and
// unmarked, as a far man's few pixels are.

import { BONES, bindPoints, boneFrames } from './rig.js';
import { stretchedInverses } from './crowdview.js';

export const CROWD_BATCH = {
  // The switch, for before/after comparison in one page (boxer.crowdBatch).
  on: true,
  // Men further than this from the camera (m) are drawn in a batch: at 30 m a man is about ninety pixels tall on a 1440p
  // screen, past the far body's distance (12 m) and the shadow's (20 m) and the ink's (16 m), so what a batch leaves out
  // (his shadow, his ink, his own hair under a helmet) was not drawn there anyway (the user's call, 2026-11-26: start
  // about 30 m). Kept in the batch until `margin` inside it, so a man on the line does not switch back and forth.
  distance: 30,
  margin: 3,
  // The bone texture grows by this many rows (men) at a time.
  rowsStep: 128,
  // A copy's capacity in a batch grows by doubling from this.
  capacity: 32,
  // A batch made with its army (warmCrowdBody) is drawn empty, no copy in it, for this many frames of play: its programs are
  // linked while the army loads (the load's frames draw what is shown), not on the frame the first man goes far (4 programs,
  // a 70-100 ms frame in a battle of 500 on an M1 Pro, measured 2026-11-26).
  warmFrames: 10,
};

// Texels a man takes in the bone texture: four (a matrix's columns) for each bone.
const ROW_TEXELS = BONES.length * 4;

/**
 * The look a batch shares: a crowd template's key without what a distance hides. Height goes (each man's bones stretch the
 * batch's body to his own lengths, as a template's do); build stays in the template's steps (the far body's girth); the
 * side, the outfit and its colours stay (they are what tells the men apart at any distance). Hair and beard go for a man
 * with a helmet (the helmet is what shows), and stay for a bare-headed one. Measured 2026-11-26: the story's Sarhu (87 crowd
 * men, each his own template) is 43 batches, Pyongyang (88) 23, a custom battle of 500 eight; what keeps a story's apart is
 * its men's paint, each a little different (armythemes.js), which only a template of its own carries.
 */
export function batchKey(fighterView) {
  const fighter = fighterView.fighter;
  const { name, heightCm, age, exercise, calories, stats, style, skill, training, bodyFat, look = {}, ...rest } = fighter.body.inputs;
  const { hairColor, eyeColor, skinTone, hairStyle, facialHair, ...kept } = look;
  const helmed = Boolean(fighterView.template?.bare);
  const hair = helmed ? null : [hairStyle, facialHair, hairColor];
  return JSON.stringify([fighter.corner, Math.round(fighter.body.composition.bmi / 3), kept, hair, rest]);
}

/** Whether a man may be drawn in a batch at all: a crowd man drawn whole, in skin, with his helmet as baked. */
function batchable(fighterView) {
  return Boolean(fighterView.baked && fighterView.template?.far && fighterView.layer === 'skin' && !fighterView.severedBones?.size
    && !fighterView.trunkSplit && !fighterView.headDetached && !fighterView.bareHead && !fighterView.fighter.halves);
}

/**
 * The batches' state on a view: the bone texture, the batches by key, the men drawn in them this frame, and whose each row
 * of the texture is (`owners`; a man keeps his row while his view lives, so a row he has not been posed into again since is
 * not written again: `free` holds the rows of views let go).
 */
function bodiesOf(view) {
  return (view.crowdBodies ??= { batches: new Map(), props: new Map(), men: [], owners: [], free: [], rows: 0, texture: null, uniforms: { uCrowdBones: { value: null }, uCrowdBonesSize: { value: new THREE.Vector2(ROW_TEXELS, 1) } }, frame: 0 });
}

/** A man's row of the bone texture: his own while his view lives. */
function rowFor(state, fighterView) {
  if (fighterView.batchRow !== undefined && state.owners[fighterView.batchRow] === fighterView) return fighterView.batchRow;
  const row = state.free.length ? state.free.pop() : state.owners.length;
  state.owners[row] = fighterView;
  fighterView.batchRow = row;
  fighterView.batchPosed = null;
  return row;
}

/** The rows of views let go (a man rebuilt, an army gone) given back. */
function freeRows(state) {
  state.owners.forEach((owner, row) => {
    if (!owner?.disposed) return;
    state.owners[row] = null;
    state.free.push(row);
  });
}

/** The start of a frame's choosing (render.js selectCrowdDraw): no man in a batch yet. */
export function beginCrowdBodies(view) {
  bodiesOf(view).men.length = 0;
}

/**
 * Whether this man is drawn in a batch this frame (`distance` from the camera, m; `safe`: one of the protected men), kept
 * on `draw.batched` for the margin. A man batched is put on this frame's list; his own meshes are the caller's to hide. His
 * head props are hidden with his head's group while he is batched (they are drawn in the props' batch).
 */
export function batchMan(view, fighterView, draw, distance, safe) {
  const on = CROWD_BATCH.on && !safe && !draw.culled && batchable(fighterView)
    && distance > (draw.batched ? CROWD_BATCH.distance - CROWD_BATCH.margin : CROWD_BATCH.distance);
  if (draw.batched !== on && fighterView.head?.group) fighterView.head.group.visible = !on;
  // (Back in a batch: his row is written afresh, whatever pose it last held.)
  if (on && !draw.batched) fighterView.batchPosed = null;
  draw.batched = on;
  if (on) bodiesOf(view).men.push(fighterView);
  return on;
}

/** A man out of the batches (another layer shown, the lod off): his head's group shown again. */
export function unbatchMan(fighterView) {
  if (!fighterView.draw?.batched) return;
  fighterView.draw.batched = false;
  if (fighterView.head?.group) fighterView.head.group.visible = true;
}

// ---- the shader -----------------------------------------------------------------------------------------------------------
//
// three's skinning chunks read a mesh's own bones (USE_SKINNING, only for a SkinnedMesh). A batch is a plain mesh of
// instanced geometry, so its material is given chunks of its own in their place: the bones of the copy's man, from his row
// of the shared texture. Every other patch a crowd's material takes (the wetness and marks, the figure shade, the linear
// look's colour decoding) is laid over this one as over any material, and finds its includes where they were.

const BATCH_PARS = `
attribute vec4 skinIndex;
attribute vec4 skinWeight;
attribute float crowdSlot;
attribute vec3 crowdTint;
#ifndef WET_SKIN_MASK
attribute float wetSkin;
#endif
uniform highp sampler2D uCrowdBones;
uniform vec2 uCrowdBonesSize;
mat4 crowdBone( const in float bone ) {
	float y = ( crowdSlot + 0.5 ) / uCrowdBonesSize.y;
	float x = bone * 4.0;
	vec4 a = texture2D( uCrowdBones, vec2( ( x + 0.5 ) / uCrowdBonesSize.x, y ) );
	vec4 b = texture2D( uCrowdBones, vec2( ( x + 1.5 ) / uCrowdBonesSize.x, y ) );
	vec4 c = texture2D( uCrowdBones, vec2( ( x + 2.5 ) / uCrowdBonesSize.x, y ) );
	vec4 d = texture2D( uCrowdBones, vec2( ( x + 3.5 ) / uCrowdBonesSize.x, y ) );
	return mat4( a, b, c, d );
}`;

const BATCH_BASE = `
mat4 boneMatX = crowdBone( skinIndex.x );
mat4 boneMatY = crowdBone( skinIndex.y );
mat4 boneMatZ = crowdBone( skinIndex.z );
mat4 boneMatW = crowdBone( skinIndex.w );`;

const BATCH_NORMAL = `
mat4 skinMatrix = skinWeight.x * boneMatX + skinWeight.y * boneMatY + skinWeight.z * boneMatZ + skinWeight.w * boneMatW;
objectNormal = ( skinMatrix * vec4( objectNormal, 0.0 ) ).xyz;`;

const BATCH_SKIN = `
vec4 crowdAt = vec4( transformed, 1.0 );
transformed = ( boneMatX * crowdAt * skinWeight.x + boneMatY * crowdAt * skinWeight.y + boneMatZ * crowdAt * skinWeight.z + boneMatW * crowdAt * skinWeight.w ).xyz;`;

// (His own skin's colour over the batch's, on the bare-skin vertices only: the cloth and steel are the batch's look.)
const BATCH_TINT = `#include <color_vertex>
#ifdef USE_COLOR
vColor.rgb *= mix( vec3( 1.0 ), crowdTint, wetSkin );
#endif`;

/** A batch's material given its bones from the shared texture (the base patch: every other is laid over it). */
function patchBatchMaterial(material, uniforms) {
  material.onBeforeCompile = (shader) => {
    Object.assign(shader.uniforms, uniforms);
    shader.vertexShader = shader.vertexShader
      .replace('#include <skinning_pars_vertex>', BATCH_PARS)
      .replace('#include <skinbase_vertex>', BATCH_BASE)
      .replace('#include <skinnormal_vertex>', BATCH_NORMAL)
      .replace('#include <skinning_vertex>', BATCH_SKIN)
      .replace('#include <color_vertex>', BATCH_TINT);
  };
  material.customProgramCacheKey = () => 'crowdBatch';
  material.needsUpdate = true;
}

// ---- the batches ----------------------------------------------------------------------------------------------------------

/** A geometry drawing `source`'s attributes and its index `name` (shared, never copied), with the per-copy slot and tint. */
function batchGeometry(source, name, slots, tints) {
  const geometry = new THREE.InstancedBufferGeometry();
  for (const [key, attribute] of Object.entries(source.attributes)) geometry.setAttribute(key, attribute);
  geometry.setAttribute('color', source.colorAttribute);
  geometry.setIndex((source.indexAttributes[name] ??= new THREE.BufferAttribute(source[name], 1)));
  geometry.setAttribute('crowdSlot', slots);
  geometry.setAttribute('crowdTint', tints);
  geometry.instanceCount = 0;
  geometry.userData.shared = [...Object.keys(source.attributes), 'color'];
  return geometry;
}

/** Let go of what a batch made for itself, never what it shares (the template's attributes and index: they are the men's too). */
function releaseGeometry(geometry) {
  for (const name of geometry.userData.shared ?? []) geometry.deleteAttribute(name);
  geometry.setIndex(null);
  geometry.dispose();
}

/** A body batch of `template`'s far body: its skin and its steel, each one instanced mesh. */
function makeBatch(view, template, paint) {
  const state = bodiesOf(view);
  const far = template.far;
  const capacity = CROWD_BATCH.capacity;
  const batch = { template, capacity, count: 0, meshes: [], materials: [], warm: CROWD_BATCH.warmFrames };
  batch.slots = new THREE.InstancedBufferAttribute(new Float32Array(capacity), 1).setUsage(THREE.DynamicDrawUsage);
  batch.tints = new THREE.InstancedBufferAttribute(new Float32Array(capacity * 3), 3).setUsage(THREE.DynamicDrawUsage);
  const { skin, steel } = paint.make(view, template, (material) => patchBatchMaterial(material, state.uniforms));
  const parts = [['bodyIndex', skin]];
  if (far.steelIndex?.length) parts.push(['steelIndex', steel]);
  for (const [name, material] of parts) {
    const mesh = new THREE.Mesh(batchGeometry(far, name, batch.slots, batch.tints), material);
    // (The copies are all over the field: never culled as one; each man was culled on his own, crowdlod.js chooseDraw.)
    mesh.frustumCulled = false;
    mesh.matrixAutoUpdate = false;
    mesh.castShadow = false;
    mesh.userData.crowdBatch = true;
    view.scene.add(mesh);
    batch.meshes.push(mesh);
    batch.materials.push(material);
  }
  return batch;
}

function growBatch(batch) {
  batch.capacity *= 2;
  const slots = new THREE.InstancedBufferAttribute(new Float32Array(batch.capacity), 1).setUsage(THREE.DynamicDrawUsage);
  const tints = new THREE.InstancedBufferAttribute(new Float32Array(batch.capacity * 3), 3).setUsage(THREE.DynamicDrawUsage);
  slots.array.set(batch.slots.array);
  tints.array.set(batch.tints.array);
  for (const mesh of batch.meshes) {
    const old = new THREE.BufferGeometry();
    old.setAttribute('crowdSlot', batch.slots);
    old.setAttribute('crowdTint', batch.tints);
    mesh.geometry.setAttribute('crowdSlot', slots);
    mesh.geometry.setAttribute('crowdTint', tints);
    old.dispose();
  }
  batch.slots = slots;
  batch.tints = tints;
}

function disposeBatch(view, batch) {
  for (const mesh of batch.meshes) {
    view.scene.remove(mesh);
    releaseGeometry(mesh.geometry);
  }
  for (const material of batch.materials) material.dispose();
}

/**
 * A head-prop batch: every visible mesh of the first man's worn prop (`worn`), as an instanced mesh of its geometry and
 * material, each placed as it sits in the prop (`local`).
 */
function makePropBatch(view, owner, worn) {
  const parts = [];
  worn.updateMatrixWorld(true);
  const toWorn = new THREE.Matrix4().copy(worn.matrixWorld).invert();
  worn.traverseVisible((mesh) => {
    if (!mesh.isMesh || mesh.userData.outline) return;
    parts.push({ geometry: mesh.geometry, material: mesh.material, local: new THREE.Matrix4().multiplyMatrices(toWorn, mesh.matrixWorld), instanced: null });
  });
  const batch = { owner, headRadius: owner.fighter.body.lengths.headRadius, parts, capacity: 0, count: 0, warm: CROWD_BATCH.warmFrames };
  allocateProps(view, batch, CROWD_BATCH.capacity);
  return batch;
}

function allocateProps(view, batch, capacity) {
  batch.capacity = capacity;
  for (const part of batch.parts) {
    const old = part.instanced;
    part.instanced = new THREE.InstancedMesh(part.geometry, part.material, capacity);
    part.instanced.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    if (old) {
      part.instanced.instanceMatrix.array.set(old.instanceMatrix.array);
      view.scene.remove(old);
      old.dispose?.();
    }
    part.instanced.frustumCulled = false;
    part.instanced.castShadow = false;
    part.instanced.count = 0;
    part.instanced.userData.crowdBatch = true;
    view.scene.add(part.instanced);
  }
}

function disposePropBatch(view, batch) {
  for (const part of batch.parts) {
    view.scene.remove(part.instanced);
    part.instanced.dispose?.();
  }
}

/** Every batch let go (a new army, a new place: render.js clearCrowdTemplates). */
export function disposeCrowdBodies(view) {
  const state = view.crowdBodies;
  if (!state) return;
  for (const batch of state.batches.values()) disposeBatch(view, batch);
  for (const batch of state.props.values()) disposePropBatch(view, batch);
  state.texture?.dispose();
  view.crowdBodies = null;
}

/** The bone texture with room for `men` rows (the rows already written carried over). */
function ensureRows(state, men) {
  if (state.rows >= men && state.texture) return;
  state.rows = Math.max(CROWD_BATCH.rowsStep, Math.ceil(men / CROWD_BATCH.rowsStep) * CROWD_BATCH.rowsStep);
  const data = new Float32Array(ROW_TEXELS * state.rows * 4);
  if (state.texture) data.set(state.texture.image.data);
  state.texture?.dispose();
  state.texture = new THREE.DataTexture(data, ROW_TEXELS, state.rows, THREE.RGBAFormat, THREE.FloatType);
  state.texture.magFilter = THREE.NearestFilter;
  state.texture.minFilter = THREE.NearestFilter;
  state.texture.generateMipmaps = false;
  state.uniforms.uCrowdBones.value = state.texture;
  state.uniforms.uCrowdBonesSize.value.set(ROW_TEXELS, state.rows);
}

/** A man's bone inverses for a batch's template, as a crowd template's are for his own (made once a template). */
function inversesFor(fighterView, template) {
  const held = fighterView.batchInverses;
  if (held?.template === template) return held.array;
  const body = fighterView.fighter.body;
  const inverses = stretchedInverses(template.frames, boneFrames(bindPoints(body), body), body.lengths.headRadius / template.headRadius);
  const array = new Float32Array(BONES.length * 16);
  inverses.forEach((inverse, bone) => inverse.toArray(array, bone * 16));
  fighterView.batchInverses = { template, array };
  fighterView.batchPosed = null;
  return array;
}

/** His skin's colour over the batch's (each channel's ratio, in the space the material's colours are drawn in). */
function tintFor(fighterView, batch, linear) {
  const held = fighterView.batchTint;
  if (held?.template === batch.template && held.linear === linear) return held.rgb;
  const own = new THREE.Color(fighterView.skinColor ?? 0xffffff);
  const theirs = new THREE.Color(batch.skinColor ?? 0xffffff);
  if (linear) {
    own.convertSRGBToLinear();
    theirs.convertSRGBToLinear();
  }
  const ratio = (a, b) => (b > 1e-3 ? Math.min(4, a / b) : 1);
  const rgb = [ratio(own.r, theirs.r), ratio(own.g, theirs.g), ratio(own.b, theirs.b)];
  fighterView.batchTint = { template: batch.template, linear, rgb };
  return rgb;
}

const batchSkinning = new THREE.Matrix4();

/**
 * `a` times the matrix at `b[at..at+16]`, written at `out[to..to+16]` (column-major, as three keeps them): a man's bone by
 * its inverse, written straight into his row. (Through three's Matrix4 it was 9 ms a frame for 445 men, by the profile.)
 */
function multiplyInto(out, to, a, b, at) {
  for (let column = 0; column < 4; column += 1) {
    const b0 = b[at + column * 4];
    const b1 = b[at + column * 4 + 1];
    const b2 = b[at + column * 4 + 2];
    const b3 = b[at + column * 4 + 3];
    for (let row = 0; row < 4; row += 1) out[to + column * 4 + row] = a[row] * b0 + a[4 + row] * b1 + a[8 + row] * b2 + a[12 + row] * b3;
  }
}
const batchPlaced = new THREE.Matrix4();
const batchSized = new THREE.Matrix4();

/**
 * The frame's batches filled (main.js, once the men are posed and their props placed: after endCrowdBatches): each man on
 * this frame's list still shown has his skinning matrices written into his row and a copy added to his look's batch, and
 * his worn props to theirs. `paint`: render.js's maker of a batch's materials, as a crowd man's are made.
 */
export function fillCrowdBodies(view, paint) {
  const state = view.crowdBodies;
  if (!state) return;
  state.frame += 1;
  for (const batch of [...state.batches.values(), ...state.props.values()]) {
    batch.count = 0;
    batch.warm = Math.max(0, batch.warm - 1);
  }
  if (state.frame % 60 === 0) freeRows(state);
  const men = state.men.filter((fighterView) => fighterView.group.visible && fighterView.layers.skin.visible && !fighterView.disposed);
  let written = false;
  for (const fighterView of men) {
    const slot = rowFor(state, fighterView);
    const key = (fighterView.batchKey ??= batchKey(fighterView));
    let batch = state.batches.get(key);
    // (A batch whose template no man is drawn from any more is made again from this man's: its arrays may be let go.)
    if (batch && !(batch.template.users > 0)) {
      disposeBatch(view, batch);
      batch = null;
    }
    if (!batch) {
      batch = makeBatch(view, fighterView.template, paint);
      batch.skinColor = fighterView.skinColor;
      state.batches.set(key, batch);
    }
    const inverses = inversesFor(fighterView, batch.template);
    // His row written only when he has been posed since (a proxy is posed every other frame, a man lying still not at all).
    if (fighterView.batchPosed !== fighterView.frames) {
      ensureRows(state, state.owners.length);
      const data = state.texture.image.data;
      const row = slot * ROW_TEXELS * 4;
      for (let bone = 0; bone < BONES.length; bone += 1) multiplyInto(data, row + bone * 16, fighterView.bones[bone].matrixWorld.elements, inverses, bone * 16);
      fighterView.batchPosed = fighterView.frames;
      written = true;
    }
    if (batch.count === batch.capacity) growBatch(batch);
    batch.slots.array[batch.count] = slot;
    batch.tints.array.set(tintFor(fighterView, batch, Boolean(batch.materials[0].userData.linearised)), batch.count * 3);
    batch.count += 1;
    for (const prop of fighterView.headProps ?? []) addProp(view, state, key, fighterView, prop);
  }
  if (written) state.texture.needsUpdate = true;
  for (const [key, batch] of state.batches) {
    for (const mesh of batch.meshes) {
      mesh.visible = batch.count > 0 || batch.warm > 0;
      mesh.geometry.instanceCount = batch.count;
    }
    batch.slots.needsUpdate = batch.count > 0;
    batch.tints.needsUpdate = batch.count > 0;
    // The figure shade of the open air, laid on a batch's materials as on the men's (looks/kit.js), now and then.
    if (batch.count && state.frame % 30 === 1) paint.shade(view, batch.materials);
    if (!batch.count && batch.template.users <= 0) {
      disposeBatch(view, batch);
      state.batches.delete(key);
    }
  }
  for (const [key, batch] of state.props) {
    // (A prop batch whose first man is gone holds his prop's geometry: let go once no copy is drawn from it.)
    if (!batch.count && batch.owner.disposed) {
      disposePropBatch(view, batch);
      state.props.delete(key);
      continue;
    }
    for (const part of batch.parts) {
      part.instanced.count = batch.count;
      part.instanced.visible = batch.count > 0 || batch.warm > 0;
      if (batch.count) part.instanced.instanceMatrix.needsUpdate = true;
    }
  }
}

/**
 * The batches a man will be drawn in once far, made with his view (render.js crowdView), so that their programs are linked
 * while his army loads (CROWD_BATCH.warmFrames). Nothing is drawn of him in them until he is far.
 */
export function warmCrowdBody(view, fighterView, paint) {
  if (!CROWD_BATCH.on || !batchable(fighterView)) return;
  const state = bodiesOf(view);
  const key = (fighterView.batchKey ??= batchKey(fighterView));
  const batch = state.batches.get(key);
  if (!batch || !(batch.template.users > 0)) {
    if (batch) disposeBatch(view, batch);
    const made = makeBatch(view, fighterView.template, paint);
    made.skinColor = fighterView.skinColor;
    state.batches.set(key, made);
  }
  for (const prop of fighterView.headProps ?? []) {
    const propKey = `${key}|${prop.kind}`;
    if (!state.props.has(propKey) && prop.worn.parent) state.props.set(propKey, makePropBatch(view, fighterView, prop.worn));
  }
}

/** A man's worn prop into its batch (by his look and its kind), placed on his head, sized to it. */
function addProp(view, state, key, fighterView, prop) {
  if (!prop.worn.visible || !prop.worn.parent) return;
  const propKey = `${key}|${prop.kind}`;
  let batch = state.props.get(propKey);
  if (batch && batch.owner.disposed) {
    disposePropBatch(view, batch);
    batch = null;
  }
  if (!batch) {
    batch = makePropBatch(view, fighterView, prop.worn);
    state.props.set(propKey, batch);
  }
  if (batch.count === batch.capacity) allocateProps(view, batch, batch.capacity * 2);
  if (prop.worn.matrixAutoUpdate) prop.worn.updateMatrix();
  const scale = fighterView.fighter.body.lengths.headRadius / batch.headRadius;
  batchPlaced.multiplyMatrices(fighterView.head.group.matrix, prop.worn.matrix).multiply(batchSized.makeScale(scale, scale, scale));
  for (const part of batch.parts) part.instanced.setMatrixAt(batch.count, batchSkinning.multiplyMatrices(batchPlaced, part.local));
  batch.count += 1;
}
