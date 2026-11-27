// A man drawn in full wears many small rigid pieces (a helmet's bowl, plates and cords, a gauntlet's lames, a boot's
// sole, the shells of a machine), each its own mesh, its own outline and its own copy in every shadow map: a duel's two
// samurai were about 75 rigid draws each before their outlines' and shadows' (measured in the Colosseum, M1 Pro), and
// past the simulation and the pixels a draw call is what a frame pays for. Here a man's rigid pieces that draw alike
// are joined into one skinned mesh a kind, one bone a piece and the piece's whole weight on it, so a man costs a
// handful of draws (rigidmerge is per man: what draws alike between men is not joined).
//
// Nothing that builds, moves, shows, hides, recolours, wears down or takes off a piece is told about it. Every piece
// stays where it was in the man's tree, posed and switched as before; it is only moved to a layer no camera draws
// (RIGID_MERGE.layer: three tests an object's layers against the camera's, for the shadow maps too), and once a frame,
// after three has set every matrix and before it draws (the scene's onBeforeRender), its bone is set to the piece's
// own matrix where it is seen now (it and every group over it visible), and to nothing (the piece shrunk to a point)
// where it is not. So a helmet knocked off, a hilt drawn from its sheath, a piece cut loose or a head taken off is
// shown or hidden by the very switch that did it, and whatever leaves the man's tree (a helmet lifted off and thrown,
// a severed hand) is given back its own layer and drawn where it went.
//
// What draws alike: one material, or materials that are the same in every number three reads of them and every
// uniform their shader patches add (twins: a cord laced in its own copy of the same red). Each merged mesh draws with
// a stand-in of its kind's first material: an object made from it (Object.create), so every number, map and patch is
// read from the material itself as it is now, with its own program (three keeps one per material) whose vertex stage
// reads the piece's matrix from its bone where three reads the object's: the model, model-view and normal matrices
// are the piece's own, so every patch that reads them (a cloth's tile by the object's scale, the decoration in the
// piece's own space, the wetness's tilt) draws as on the piece. The shadow maps draw it as three draws any skinned
// mesh, which puts each corner where the piece's matrix does. A piece drawn mirrored has its triangles turned (three
// turns a mirrored mesh's facing on the card). Two-sidedness, shadow sides, outlines, polygon offsets: the material's.
//
// What is not joined, and drawn as before: a see-through piece (it is sorted by its own distance), one whose
// geometry changes after it is built (a face's expression, a cloth's corners), one whose material is not one of
// three's lit or plain kinds or whose patches read the object's matrices where the piece's cannot be given, an
// instanced, morphed, multi-material or skinned mesh. A piece found changing (its geometry's numbers, its material,
// its shadow, a twin no longer the same) is put back and the man joined again without it; a man joined again too
// often is drawn unjoined from then on (`rebuildsMost`). `boxer.rigidMerge()` (main.js) says what each man is.

/* global THREE */

export const RIGID_MERGE = {
  on: true,
  // The layer the joined pieces are moved to, drawn by no camera (a scene's cameras draw layer 0).
  layer: 31,
  // The fewest pieces worth a merged mesh: one alone is drawn as it was.
  fewest: 2,
  // A man joined again more often than this is drawn unjoined from then on: something about him changes every few
  // frames that the merge does not follow (counted over his life).
  rebuildsMost: 16,
  // A piece or material found changing this many times is left out of the merge (drawn on its own).
  strikes: 2,
  // Metres added to each merged mesh's bound past its pieces' own: an outline's push and a hair's lean out of its
  // bound are millimetres; this is a margin, not a measurement.
  slack: 0.05,
  // A stand-in material checked every this many frames for numbers written onto it (it should hold none of its own).
  standInCheck: 60,
};

// The shader three draws each material kind with (three r128 WebGLPrograms shaderIDs), for reading what a
// material's patches add before it is ever drawn.
const RIGID_SHADER_IDS = {
  MeshBasicMaterial: 'basic', MeshLambertMaterial: 'lambert', MeshPhongMaterial: 'phong', MeshToonMaterial: 'toon',
  MeshStandardMaterial: 'physical', MeshPhysicalMaterial: 'physical', MeshMatcapMaterial: 'matcap',
};

// A material's own fields that are not what it draws (or are compared another way: its patches by their program key
// and what they add).
const RIGID_NOT_DRAWN = new Set(['uuid', 'id', 'name', 'version', 'userData', '_listeners', 'onBeforeCompile', 'customProgramCacheKey', 'onBuild']);

// (Stand-ins number from far past three's own materials, so their ids never meet one.)
let rigidNextId = 1 << 24;
const rigidIdentity = new THREE.Matrix4();
const rigidInverse = new THREE.Matrix4();
const rigidLocal = new THREE.Matrix4();
const rigidObjectIds = new WeakMap();
let rigidObjectNext = 1;

// ---- the vertex stage of a merged mesh -------------------------------------------------------------------------------

const RIGID_VERTEX_PARS = /* glsl */ `
mat3 rigidNormalMatrix( mat3 m ) {
	vec3 r0 = cross( m[ 1 ], m[ 2 ] );
	vec3 r1 = cross( m[ 2 ], m[ 0 ] );
	vec3 r2 = cross( m[ 0 ], m[ 1 ] );
	return mat3( r0, r1, r2 ) / dot( m[ 0 ], r0 );
}
`;

// The piece's matrices, read from its bone, in place of the object's: the names three's chunks and every patch use,
// declared in main so that they hide the uniforms (the object's, which for a merged mesh is the man's frame).
const RIGID_VERTEX_MAIN = /* glsl */ `
	mat4 rigidPiece = getBoneMatrix( skinIndex.x );
	mat4 modelMatrix = modelMatrix * rigidPiece;
	mat4 modelViewMatrix = viewMatrix * modelMatrix;
	mat3 normalMatrix = rigidNormalMatrix( mat3( modelViewMatrix ) );
`;

const RIGID_MATRIX_NAMES = /\b(modelMatrix|modelViewMatrix|normalMatrix)\b/;
const RIGID_MATRIX_DECLARED = /uniform\s+mat[34]\s+(modelMatrix|modelViewMatrix|normalMatrix)\s*;/g;

/**
 * Turn a shader (three's, after the material's own patches) into a merged mesh's: the piece's matrices in main, three's
 * own skinning taken out (the piece is placed by them), the normal matrix handed to the fragment stage where a patch
 * reads it there. Returns false where it cannot be done (the shader is changed only when it can).
 */
export function rigidPatch(shader) {
  const vertex = shader.vertexShader;
  const fragment = shader.fragmentShader;
  const main = vertex.indexOf('void main() {');
  if (main < 0 || vertex.indexOf('void main() {', main + 1) >= 0) return false;
  // (A function outside main that reads the object's matrices would read the man's frame.)
  if (RIGID_MATRIX_NAMES.test(vertex.slice(0, main).replace(RIGID_MATRIX_DECLARED, ''))) return false;
  const fragmentReads = fragment.replace(RIGID_MATRIX_DECLARED, '');
  if (/\b(modelMatrix|modelViewMatrix)\b/.test(fragmentReads)) return false;
  const normalInFragment = /\bnormalMatrix\b/.test(fragmentReads);
  if (normalInFragment && !/uniform\s+mat3\s+normalMatrix\s*;/.test(fragment)) return false;
  const hand = normalInFragment ? '\tvRigidNormal = normalMatrix;\n' : '';
  shader.vertexShader = `${vertex.slice(0, main)}${normalInFragment ? 'varying mat3 vRigidNormal;\n' : ''}${RIGID_VERTEX_PARS}void main() {\n${RIGID_VERTEX_MAIN}${hand}${vertex.slice(main + 'void main() {'.length)}`
    .replace('#include <skinnormal_vertex>', '')
    .replace('#include <skinning_vertex>', '');
  if (normalInFragment) shader.fragmentShader = fragment.replace(/uniform\s+mat3\s+normalMatrix\s*;/, 'varying mat3 vRigidNormal;\n#define normalMatrix vRigidNormal');
  return true;
}

/**
 * The stand-in a merged mesh draws with: made from `source` (Object.create), so it reads every number, map and patch
 * of the material as it is now; its own id, uuid and listeners (three keeps its program apart, and frees it with
 * it), skinning on, its version the source's (a source recompiled is so too), and its patches the source's then
 * the merge's (rigidPatch).
 */
export function rigidStandIn(source) {
  const material = Object.create(source);
  Object.defineProperty(material, 'id', { value: rigidNextId++ });
  let bump = 0;
  Object.defineProperty(material, 'version', {
    get: () => source.version + bump,
    set: (value) => { bump = value - source.version; },
  });
  material.uuid = THREE.MathUtils.generateUUID();
  material._listeners = {};
  material.skinning = true;
  material.onBeforeCompile = (shader, renderer) => {
    source.onBeforeCompile(shader, renderer);
    rigidPatch(shader);
  };
  material.customProgramCacheKey = () => `${source.customProgramCacheKey()}|rigid`;
  return material;
}
// (What a stand-in holds of its own, as made above: its uuid, listeners, skinning and two patch hooks.)
const RIGID_STAND_IN_OWN = 5;

// ---- what a material is -----------------------------------------------------------------------------------------------

/** A value as text for a key (numbers exactly; maps and other objects by who they are). */
function rigidValueKey(value) {
  if (value === null || value === undefined || typeof value !== 'object') return typeof value === 'function' ? `f${rigidObjectId(value)}` : String(value);
  if (value.isColor) return `c${value.r},${value.g},${value.b}`;
  if (value.isVector2 || value.isVector3 || value.isVector4 || value.isQuaternion) return `v${value.toArray().join(',')}`;
  if (value.isMatrix3 || value.isMatrix4) return `m${value.elements.join(',')}`;
  if (Array.isArray(value)) return `[${value.map(rigidValueKey).join(';')}]`;
  if (value.constructor === Object) return `{${Object.keys(value).map((key) => `${key}:${rigidValueKey(value[key])}`).join(',')}}`;
  return `o${rigidObjectId(value)}`;
}
function rigidObjectId(object) {
  if (!rigidObjectIds.has(object)) rigidObjectIds.set(object, rigidObjectNext++);
  return rigidObjectIds.get(object);
}

/** Whether two values draw alike (as rigidValueKey would say, without the text). */
function rigidSame(a, b) {
  if (a === b) return true;
  if (!a || !b || typeof a !== 'object' || typeof b !== 'object') return false;
  if (a.isColor || a.isVector2 || a.isVector3 || a.isVector4 || a.isQuaternion || a.isMatrix3 || a.isMatrix4) return a.equals?.(b) ?? false;
  if (Array.isArray(a)) return Array.isArray(b) && a.length === b.length && a.every((value, index) => rigidSame(value, b[index]));
  if (a.constructor === Object && b.constructor === Object) return rigidValueKey(a) === rigidValueKey(b);
  return false;
}

/**
 * What a material is, for the merge: { mergeable, why (when not), key (what draws alike), props (its fields compared
 * each frame against a twin's), uniforms ([[name, uniform]] its patches add) }. Its patches are run once on three's
 * shader of its kind to see what they add and whether the merge's patch can follow them (nothing is drawn).
 */
function rigidMaterialFacts(material, renderer) {
  const id = RIGID_SHADER_IDS[material.type];
  if (!id || material.isShaderMaterial) return { mergeable: false, why: 'kind' };
  if (material.transparent || material.visible === false || material.wireframe || material.morphTargets || material.skinning) return { mergeable: false, why: 'drawn apart' };
  const lib = THREE.ShaderLib[id];
  const shader = { shaderID: id, shaderName: material.type, uniforms: THREE.UniformsUtils.clone(lib.uniforms), vertexShader: lib.vertexShader, fragmentShader: lib.fragmentShader, defines: material.defines, isWebGL2: renderer.capabilities.isWebGL2 };
  try {
    material.onBeforeCompile(shader, renderer);
  } catch {
    return { mergeable: false, why: 'patch' };
  }
  if (!rigidPatch(shader)) return { mergeable: false, why: 'matrices' };
  const uniforms = Object.keys(shader.uniforms).filter((name) => !(name in lib.uniforms)).map((name) => [name, shader.uniforms[name]]);
  const props = Object.keys(material).filter((name) => !RIGID_NOT_DRAWN.has(name) && typeof material[name] !== 'function').sort();
  const key = [material.type, material.customProgramCacheKey(), ...props.map((name) => `${name}=${rigidValueKey(material[name])}`), ...uniforms.map(([name, uniform]) => `${name}=${rigidValueKey(uniform?.value)}`)].join('|');
  return { mergeable: true, key, props, uniforms, version: material.version };
}

/**
 * Whether `member` still draws as its twin `first` does: null if so; 'version' where either was rebuilt since (a patch
 * laid on, a map loaded: to be looked at again), else the field or uniform that now differs.
 */
function rigidTwinsDiffer(first, member) {
  if (first.material.version !== first.version || member.material.version !== member.version) return 'version';
  for (const name of first.props) if (!rigidSame(first.material[name], member.material[name])) return name;
  for (let index = 0; index < first.uniforms.length; index += 1) {
    const a = first.uniforms[index][1];
    const b = member.uniforms[index]?.[1];
    if (a !== b && !rigidSame(a?.value, b?.value)) return first.uniforms[index][0];
  }
  return null;
}

// ---- which pieces ---------------------------------------------------------------------------------------------------

/** The attributes of a geometry, as what must match for two to be joined: names, sizes, types. */
function rigidAttributesKey(geometry) {
  return Object.keys(geometry.attributes).sort().map((name) => {
    const attribute = geometry.attributes[name];
    return `${name}:${attribute.itemSize}:${attribute.array.constructor.name}:${attribute.normalized}`;
  }).join(',');
}

const rigidVersions = (geometry) => Object.fromEntries(Object.entries(geometry.attributes).map(([name, attribute]) => [name, attribute.version]));
const rigidVersionOf = (geometry) => {
  let sum = geometry.index?.version ?? 0;
  for (const name in geometry.attributes) sum += geometry.attributes[name].version;
  return sum;
};

/** Why a mesh is drawn on its own, or null if it can be joined. */
function rigidPieceWhy(mesh, record) {
  if (mesh.isSkinnedMesh || mesh.isInstancedMesh || !mesh.isMesh || mesh.isLine || mesh.isPoints) return 'kind';
  if (Array.isArray(mesh.material) || !mesh.material) return 'materials';
  if (record.strikes.get(mesh) >= RIGID_MERGE.strikes || record.strikes.get(mesh.material) >= RIGID_MERGE.strikes || record.strikes.get(mesh.geometry) >= RIGID_MERGE.strikes) return 'changes';
  if (Object.prototype.hasOwnProperty.call(mesh, 'onBeforeRender') || Object.prototype.hasOwnProperty.call(mesh, 'onAfterRender')) return 'hook';
  if (mesh.customDepthMaterial || mesh.customDistanceMaterial || mesh.layers.mask !== 1) return 'drawn apart';
  const geometry = mesh.geometry;
  const position = geometry?.attributes?.position;
  if (!position || position.isInterleavedBufferAttribute || Object.values(geometry.attributes).some((attribute) => attribute.isInterleavedBufferAttribute || attribute.usage === THREE.DynamicDrawUsage)) return 'geometry';
  // (A geometry's groups are read only for a mesh of several materials: one material draws the whole of it.)
  if (geometry.morphAttributes?.position?.length || geometry.drawRange.start !== 0 || geometry.drawRange.count !== Infinity) return 'geometry';
  return null;
}

// ---- building -------------------------------------------------------------------------------------------------------

/** A man's record of his merge, made when he is built (render.js buildFighterView): joined on the next frame drawn. */
export function rigidMergeWanted(view, fighterView) {
  if (!RIGID_MERGE.on || fighterView.baked) return;
  fighterView.rigidMerge = { state: 'wanted', why: null, rebuilds: 0, strikes: new WeakMap(), solo: new WeakSet(), frames: 0, pieces: [], meshes: [], skeleton: null };
  (view.rigidMen ??= new Set()).add(fighterView);
  if (!view.scene.userData.rigidHooked) {
    view.scene.userData.rigidHooked = true;
    const before = view.scene.onBeforeRender;
    view.scene.onBeforeRender = function rigidBeforeRender(...args) {
      before.apply(this, args);
      rigidBeforeDraw(view);
    };
  }
}

/** Join a man's rigid pieces (the record's state becomes 'merged', or 'off' with the reason). */
function rigidBuild(view, fighterView) {
  const started = performance.now();
  rigidBuildNow(view, fighterView);
  const record = fighterView.rigidMerge;
  const took = performance.now() - started;
  record.buildMs = (record.buildMs ?? 0) + took;
  record.longestBuildMs = Math.max(record.longestBuildMs ?? 0, took);
}

function rigidBuildNow(view, fighterView) {
  const record = fighterView.rigidMerge;
  const root = fighterView.layers?.skin;
  if (!root || fighterView.disposed) {
    record.state = 'off';
    record.why = 'no body';
    return;
  }
  const renderer = view.renderer;
  // (Kept between merges of the man while the material is as it was: reading its patches is most of a merge's time.)
  const facts = (record.facts ??= new WeakMap());
  const factsOf = (material) => {
    let known = facts.get(material);
    if (!known || known.version !== material.version) facts.set(material, (known = { ...rigidMaterialFacts(material, renderer), version: material.version }));
    return known;
  };
  const candidates = [];
  const apart = {};
  root.traverse((mesh) => {
    if (!mesh.isMesh) return;
    const why = rigidPieceWhy(mesh, record) ?? (factsOf(mesh.material).mergeable ? null : factsOf(mesh.material).why);
    if (why) {
      apart[why] = (apart[why] ?? 0) + 1;
      return;
    }
    candidates.push(mesh);
  });
  // Twins: materials that draw alike, each kind under the first met.
  const firsts = new Map();
  const kindOf = new Map();
  for (const mesh of candidates) {
    const material = mesh.material;
    if (kindOf.has(material)) continue;
    const key = record.solo.has(material) ? `solo${rigidObjectId(material)}` : factsOf(material).key;
    if (!firsts.has(key)) firsts.set(key, material);
    kindOf.set(material, firsts.get(key));
  }
  const groups = new Map();
  for (const mesh of candidates) {
    const first = kindOf.get(mesh.material);
    const key = `${rigidObjectId(first)}|${mesh.castShadow}|${mesh.receiveShadow}|${mesh.renderOrder}|${rigidAttributesKey(mesh.geometry)}`;
    if (!groups.has(key)) groups.set(key, { first, meshes: [] });
    groups.get(key).meshes.push(mesh);
  }
  const kept = [...groups.values()].filter((group) => group.meshes.length >= RIGID_MERGE.fewest);
  apart.alone = [...groups.values()].filter((group) => group.meshes.length < RIGID_MERGE.fewest).length;
  record.apart = apart;
  if (!kept.length) {
    record.state = 'off';
    record.why = 'nothing to join';
    return;
  }
  const count = kept.reduce((sum, group) => sum + group.meshes.length, 0);
  // One skeleton for the man, a bone a piece: one small texture of matrices sent each frame for all his merged meshes.
  const skeleton = new THREE.Skeleton([], []);
  skeleton.bones = new Array(count).fill(rigidIdentity);
  skeleton.boneMatrices = new Float32Array(count * 16);
  skeleton.update = () => {};
  const pieces = [];
  const meshes = [];
  const group = fighterView.group;
  for (const { first, meshes: members } of kept) {
    const { geometry, corners } = rigidGeometry(members, pieces.length);
    const material = rigidStandIn(first);
    const merged = new THREE.SkinnedMesh(geometry, material);
    merged.bindMode = 'detached';
    merged.bind(skeleton, rigidIdentity);
    merged.castShadow = members[0].castShadow;
    merged.receiveShadow = members[0].receiveShadow;
    merged.renderOrder = members[0].renderOrder;
    merged.matrixAutoUpdate = false;
    // (Unseen until its bones are set and its programs primed: rigidBound, render.js rigidHold.)
    merged.visible = false;
    merged.userData.rigidMerge = true;
    // (Its bound is kept true each frame, rigidBeforeDraw: what may leave it out of a shadow map can trust it, env/index.js.)
    merged.userData.rigidBound = true;
    geometry.boundingSphere = new THREE.Sphere();
    group.add(merged);
    merged.matrixWorld.copy(group.matrixWorld);
    const entry = { mesh: merged, first, from: pieces.length, to: pieces.length + members.length, twins: [] };
    meshes.push(entry);
    members.forEach((mesh, at) => {
      const geometrySource = mesh.geometry;
      if (!geometrySource.boundingSphere) geometrySource.computeBoundingSphere();
      pieces.push({
        mesh, material: mesh.material, geometry: geometrySource, version: rigidVersionOf(geometrySource), mirrored: mesh.matrixWorld.determinant() < 0,
        castShadow: mesh.castShadow, receiveShadow: mesh.receiveShadow, renderOrder: mesh.renderOrder, mask: mesh.layers.mask,
        centre: geometrySource.boundingSphere.center.clone(), radius: geometrySource.boundingSphere.radius + (mesh.material.userData?.outlineWidth ?? 0), gone: false, entry,
        corner: corners[at], count: geometrySource.attributes.position.count, versions: rigidVersions(geometrySource), indexVersion: geometrySource.index?.version ?? 0,
      });
    });
    // The twins of this kind, checked each frame against its first.
    const materials = [...new Set(members.map((mesh) => mesh.material))];
    if (materials.length > 1) {
      const firstFacts = { material: first, ...factsOf(first) };
      entry.twins = materials.filter((material) => material !== first).map((material) => ({ material, ...factsOf(material) }));
      entry.firstFacts = firstFacts;
    }
  }
  Object.assign(record, { state: 'merged', why: null, pieces, meshes, skeleton, frames: 0, shown: false, held: null });
  // Drawn as merged once their programs are ready (render.js rigidHold: the pieces drawn meanwhile).
  view.rigidHold?.(fighterView);
}

/** The merged geometry of `members` (their bones from `firstBone`): each piece's corners as built, on its bone, wound as drawn. */
function rigidGeometry(members, firstBone) {
  const names = Object.keys(members[0].geometry.attributes);
  let corners = 0;
  let indices = 0;
  for (const mesh of members) {
    const geometry = mesh.geometry;
    corners += geometry.attributes.position.count;
    indices += geometry.index ? geometry.index.count : geometry.attributes.position.count;
  }
  const geometry = new THREE.BufferGeometry();
  for (const name of names) {
    const source = members[0].geometry.attributes[name];
    const array = new source.array.constructor(corners * source.itemSize);
    let at = 0;
    for (const mesh of members) {
      const attribute = mesh.geometry.attributes[name];
      array.set(attribute.array.subarray(0, attribute.count * attribute.itemSize), at);
      at += attribute.count * attribute.itemSize;
    }
    // (Kept: a piece's numbers changed after it was joined, a vertex colour painted or a normal bent, are copied in, rigidCopyIn.)
    geometry.setAttribute(name, new THREE.BufferAttribute(array, source.itemSize, source.normalized));
  }
  const bones = firstBone + members.length;
  const skinIndex = bones <= 256 ? new Uint8Array(corners * 4) : new Uint16Array(corners * 4);
  const skinWeight = new Uint8Array(corners * 4);
  const index = corners > 65535 ? new Uint32Array(indices) : new Uint16Array(indices);
  let corner = 0;
  let at = 0;
  const starts = [];
  members.forEach((mesh, piece) => {
    starts.push(corner);
    const source = mesh.geometry;
    const count = source.attributes.position.count;
    for (let k = 0; k < count; k += 1) {
      skinIndex[(corner + k) * 4] = firstBone + piece;
      skinWeight[(corner + k) * 4] = 255;
    }
    const list = source.index ? source.index.array : null;
    const length = list ? source.index.count : count;
    // A piece drawn mirrored is drawn by three with its facing turned; here its triangles are turned instead.
    const mirrored = mesh.matrixWorld.determinant() < 0;
    for (let i = 0; i < length; i += 3) {
      const a = list ? list[i] : i;
      const b = list ? list[i + 1] : i + 1;
      const c = list ? list[i + 2] : i + 2;
      index[at] = a + corner;
      index[at + 1] = (mirrored ? c : b) + corner;
      index[at + 2] = (mirrored ? b : c) + corner;
      at += 3;
    }
    corner += count;
  });
  geometry.setAttribute('skinIndex', rigidOnce(new THREE.BufferAttribute(skinIndex, 4)));
  geometry.setAttribute('skinWeight', rigidOnce(new THREE.BufferAttribute(skinWeight, 4, true)));
  geometry.setIndex(rigidOnce(new THREE.BufferAttribute(index, 1)));
  return { geometry, corners: starts };
}

// (A merged mesh's numbers are needed only until the card has them: the pieces keep their own for a merge made again.)
function rigidOnce(attribute) {
  return attribute.onUpload(rigidLetGo);
}
function rigidLetGo() {
  this.array = new this.array.constructor(0);
}

// ---- each frame -----------------------------------------------------------------------------------------------------

/**
 * Before every draw of the scene (three has set every matrix): the men waiting are joined, and once a frame each
 * merged man's bones are set from his pieces as they are now, his merged meshes' bounds made true, and what has
 * changed under the merge found (joined again without it).
 */
function rigidBeforeDraw(view) {
  if (!view.rigidMen?.size) return;
  for (const fighterView of view.rigidMen) {
    const record = fighterView.rigidMerge;
    if (fighterView.disposed || !record) {
      view.rigidMen.delete(fighterView);
      continue;
    }
    // (One man joined a frame: the first merge of a man reads all his materials' patches, a few milliseconds.)
    if (record.state === 'wanted') {
      rigidBuild(view, fighterView);
      break;
    }
  }
  // (A view never drawn through render.js render has no frame count: its men are posed at every draw.)
  const frame = view.rigidFrame;
  if (frame !== undefined && view.rigidSynced === frame) return;
  view.rigidSynced = frame;
  for (const fighterView of view.rigidMen) {
    const record = fighterView.rigidMerge;
    if (record.state !== 'merged' || !fighterView.group.visible) continue;
    const changed = rigidPose(fighterView, record);
    if (changed.length) rigidAgain(view, fighterView, changed);
  }
}

/** One man's bones from his pieces; what has changed under his merge ([{ what, why, solo }], none: []). */
function rigidPose(fighterView, record) {
  const changed = [];
  const group = fighterView.group;
  const bones = record.skeleton.boneMatrices;
  const world = group.matrixWorld;
  const moved = !world.equals(rigidIdentity);
  if (moved) rigidInverse.copy(world).invert();
  const spheres = record.spheres ??= new Float32Array(record.pieces.length * 4);
  for (let bone = 0; bone < record.pieces.length; bone += 1) {
    const piece = record.pieces[bone];
    const at = bone * 16;
    if (piece.gone) {
      spheres[bone * 4 + 3] = -1;
      continue;
    }
    const mesh = piece.mesh;
    let shown = true;
    let up = mesh;
    while (up && up !== group) {
      if (!up.visible) shown = false;
      up = up.parent;
    }
    if (!up) {
      // Gone from him (a helmet lifted off and thrown, a hand cut off): drawn where it went, by itself.
      piece.gone = true;
      mesh.layers.mask = piece.mask;
      bones.fill(0, at, at + 16);
      spheres[bone * 4 + 3] = -1;
      continue;
    }
    if (mesh.material !== piece.material) changed.push({ what: mesh, why: 'material' });
    // (A mesh handed another geometry, as a hand is for each grip, is one that changes: left out at once.)
    else if (mesh.geometry !== piece.geometry) changed.push({ what: mesh, why: 'geometry swapped', atOnce: true });
    else if (rigidVersionOf(mesh.geometry) !== piece.version && !rigidCopyIn(piece)) changed.push({ what: mesh.geometry, why: 'geometry reshaped' });
    else if (mesh.castShadow !== piece.castShadow || mesh.receiveShadow !== piece.receiveShadow || mesh.renderOrder !== piece.renderOrder) changed.push({ what: mesh, why: 'shadow' });
    const e = mesh.matrixWorld.elements;
    if (!shown) {
      // Not seen now: shrunk to a point where it is (its triangles draw nothing).
      bones.fill(0, at, at + 15);
      bones[at + 12] = e[12];
      bones[at + 13] = e[13];
      bones[at + 14] = e[14];
      bones[at + 15] = 1;
      spheres[bone * 4 + 3] = -1;
      continue;
    }
    const det = e[0] * (e[5] * e[10] - e[6] * e[9]) - e[4] * (e[1] * e[10] - e[2] * e[9]) + e[8] * (e[1] * e[6] - e[2] * e[5]);
    if ((det < 0) !== piece.mirrored) changed.push({ what: mesh, why: 'mirrored' });
    if (moved) {
      const local = rigidLocal.multiplyMatrices(rigidInverse, mesh.matrixWorld).elements;
      for (let k = 0; k < 16; k += 1) bones[at + k] = local[k];
    } else {
      for (let k = 0; k < 16; k += 1) bones[at + k] = e[k];
    }
    // Its bound, in the man's frame.
    const c = piece.centre;
    const scale = Math.sqrt(Math.max(e[0] * e[0] + e[1] * e[1] + e[2] * e[2], e[4] * e[4] + e[5] * e[5] + e[6] * e[6], e[8] * e[8] + e[9] * e[9] + e[10] * e[10]));
    const b = moved ? bones : e;
    const o = moved ? at : 0;
    spheres[bone * 4] = b[o] * c.x + b[o + 4] * c.y + b[o + 8] * c.z + b[o + 12];
    spheres[bone * 4 + 1] = b[o + 1] * c.x + b[o + 5] * c.y + b[o + 9] * c.z + b[o + 13];
    spheres[bone * 4 + 2] = b[o + 2] * c.x + b[o + 6] * c.y + b[o + 10] * c.z + b[o + 14];
    spheres[bone * 4 + 3] = piece.radius * scale;
  }
  // Twins still alike, and the stand-ins still holding nothing of their own.
  record.frames += 1;
  for (const entry of record.meshes) {
    if (entry.first.transparent) changed.push({ what: entry.first, why: 'see-through', atOnce: true });
    for (const twin of entry.twins) {
      const differ = rigidTwinsDiffer(entry.firstFacts, twin);
      // (Rebuilt, they are looked at again; a twin rebuilt again and again, or no longer alike, is joined only with its own pieces.)
      if (differ === 'version') changed.push({ what: twin.material, why: 'twin rebuilt', soloAfter: true });
      else if (differ) changed.push({ what: twin.material, why: `twin ${differ}`, solo: true });
    }
    if (record.frames % RIGID_MERGE.standInCheck === 0 && Object.keys(entry.mesh.material).length !== RIGID_STAND_IN_OWN) changed.push({ what: entry.first, why: 'stand-in' });
    rigidBound(entry, spheres, record.held !== 'new');
  }
  const texture = record.skeleton.boneTexture;
  if (texture) texture.needsUpdate = true;
  return changed;
}

/**
 * A piece's geometry changed in its numbers since it was joined (a vertex colour painted, a normal bent): what changed is
 * copied into the merged geometry and sent again, that stretch only. False where its shape changed (its corners, its
 * triangles or its attributes: joined again).
 */
function rigidCopyIn(piece) {
  const source = piece.geometry;
  const merged = piece.entry.mesh.geometry;
  if ((source.index?.version ?? 0) !== piece.indexVersion || source.attributes.position.count !== piece.count) return false;
  for (const name in source.attributes) {
    const attribute = source.attributes[name];
    if (attribute.version === piece.versions[name]) continue;
    const into = merged.attributes[name];
    if (!into || into.itemSize !== attribute.itemSize || piece.versions[name] === undefined) return false;
    const size = attribute.itemSize;
    into.array.set(attribute.array.subarray(0, piece.count * size), piece.corner * size);
    const range = into.updateRange;
    const from = piece.corner * size;
    const to = from + piece.count * size;
    // (A stretch not sent yet, the mesh not drawn since, is widened to take this one too: three sends one stretch and marks it sent with -1.)
    if (range.count >= 0) {
      const end = Math.max(range.offset + range.count, to);
      range.offset = Math.min(range.offset, from);
      range.count = end - range.offset;
    } else {
      range.offset = from;
      range.count = to - from;
    }
    into.needsUpdate = true;
    piece.versions[name] = attribute.version;
  }
  piece.version = rigidVersionOf(source);
  return true;
}

/** A merged mesh's bound from its pieces' (what of it is seen), and whether it is drawn at all (`drawn`: not the frame it is made in). */
function rigidBound(entry, spheres, drawn) {
  let x = 0;
  let y = 0;
  let z = 0;
  let seen = 0;
  for (let bone = entry.from; bone < entry.to; bone += 1) {
    if (!(spheres[bone * 4 + 3] >= 0)) continue;
    x += spheres[bone * 4];
    y += spheres[bone * 4 + 1];
    z += spheres[bone * 4 + 2];
    seen += 1;
  }
  entry.mesh.visible = drawn && seen > 0;
  if (!seen) return;
  x /= seen;
  y /= seen;
  z /= seen;
  let reach = 0;
  for (let bone = entry.from; bone < entry.to; bone += 1) {
    const radius = spheres[bone * 4 + 3];
    if (!(radius >= 0)) continue;
    const dx = spheres[bone * 4] - x;
    const dy = spheres[bone * 4 + 1] - y;
    const dz = spheres[bone * 4 + 2] - z;
    reach = Math.max(reach, Math.sqrt(dx * dx + dy * dy + dz * dz) + radius);
  }
  entry.mesh.geometry.boundingSphere.center.set(x, y, z);
  entry.mesh.geometry.boundingSphere.radius = reach + RIGID_MERGE.slack;
}

/** What changed under a man's merge: each noted against (left out once it has changed too often), and he is joined again. */
function rigidAgain(view, fighterView, changed) {
  const record = fighterView.rigidMerge;
  for (const change of changed) {
    if (change.soloAfter) {
      const times = (record.rebuiltTwins ??= new WeakMap()).get(change.what) ?? 0;
      record.rebuiltTwins.set(change.what, times + 1);
      if (times + 1 >= RIGID_MERGE.strikes) record.solo.add(change.what);
    } else record.strikes.set(change.what, change.atOnce ? RIGID_MERGE.strikes : (record.strikes.get(change.what) ?? 0) + 1);
    if (change.solo) record.solo.add(change.what);
    (record.changes ??= {})[change.why] = (record.changes[change.why] ?? 0) + 1;
  }
  rigidTakeApart(view, fighterView);
  record.rebuilds += 1;
  if (record.rebuilds > RIGID_MERGE.rebuildsMost) {
    record.state = 'off';
    record.why = `changing (${changed[0].why})`;
    return;
  }
  rigidBuild(view, fighterView);
}

/** A man's merge undone: every piece on its own layer again, the merged meshes freed. */
function rigidTakeApart(view, fighterView) {
  const record = fighterView.rigidMerge;
  if (!record || record.state !== 'merged') return;
  view.rigidUnhold?.(fighterView);
  for (const piece of record.pieces) if (!piece.gone) piece.mesh.layers.mask = piece.mask;
  for (const { mesh } of record.meshes) {
    mesh.parent?.remove(mesh);
    mesh.geometry.dispose();
    mesh.material.dispose();
  }
  record.skeleton?.boneTexture?.dispose();
  Object.assign(record, { state: 'apart', pieces: [], meshes: [], skeleton: null, spheres: null, shown: false });
}

/** The merged meshes of a man now drawn in place of his pieces (their programs are ready: render.js). */
export function rigidShow(fighterView) {
  const record = fighterView.rigidMerge;
  if (!record || record.state !== 'merged' || record.shown) return;
  record.shown = true;
  record.held = null;
  for (const piece of record.pieces) if (!piece.gone) piece.mesh.layers.set(RIGID_MERGE.layer);
}

/** The merged meshes a man is drawn with (for priming their programs: render.js). */
export const rigidMeshesOf = (fighterView) => (fighterView.rigidMerge?.state === 'merged' ? fighterView.rigidMerge.meshes.map((entry) => entry.mesh) : []);

/** A man let go (render.js disposeFighterView): his merge undone and forgotten. */
export function rigidForget(view, fighterView) {
  rigidTakeApart(view, fighterView);
  if (fighterView.rigidMerge) fighterView.rigidMerge.state = 'off';
  view.rigidMen?.delete(fighterView);
}

/** Each man's merge in numbers: { state, why, pieces, meshes, rebuilds, apart (why pieces were left out), changes }. */
export function rigidReport(fighterViews) {
  return fighterViews.filter((fighterView) => fighterView.rigidMerge).map((fighterView) => {
    const record = fighterView.rigidMerge;
    const bytes = record.meshes.reduce((sum, { mesh }) => sum + Object.values(mesh.geometry.attributes).reduce((total, attribute) => total + attribute.array.byteLength, 0), 0);
    return {
      id: fighterView.fighter.id, state: record.state, shown: record.shown ?? false, why: record.why, pieces: record.pieces.length, gone: record.pieces.filter((piece) => piece.gone).length, meshes: record.meshes.length,
      rebuilds: record.rebuilds, apart: record.apart ?? {}, changes: record.changes ?? {}, buildMs: +(record.buildMs ?? 0).toFixed(2), longestBuildMs: +(record.longestBuildMs ?? 0).toFixed(2), keptKB: Math.round(bytes / 1024),
    };
  });
}

/**
 * Merging on or off for the men drawn now (`on`), and for those built from now on: off, every merge is undone and
 * each piece drawn as itself again; on, each man drawn in full is joined from the next frame drawn.
 */
export function rigidMergeSwitch(view, fighterViews, on) {
  RIGID_MERGE.on = Boolean(on);
  for (const fighterView of fighterViews) {
    if (!on) {
      rigidForget(view, fighterView);
      fighterView.rigidMerge = null;
    } else if (!fighterView.rigidMerge && !fighterView.baked && !fighterView.disposed) rigidMergeWanted(view, fighterView);
  }
  return RIGID_MERGE.on;
}

/** Why each mesh of a man is drawn as it is (a tool's look at the merge): [{ mesh, why, key }]. */
export function rigidExplain(view, fighterView) {
  const record = fighterView.rigidMerge ?? { strikes: new WeakMap() };
  const rows = [];
  fighterView.layers.skin.traverse((mesh) => {
    if (!mesh.isMesh) return;
    const facts = mesh.material && !Array.isArray(mesh.material) ? rigidMaterialFacts(mesh.material, view.renderer) : null;
    rows.push({ mesh, why: rigidPieceWhy(mesh, record) ?? (facts?.mergeable ? null : facts?.why), key: facts?.key ?? null, joined: isRigidJoined(mesh) });
  });
  return rows;
}

/** Called once a frame by the view's own draw (render.js render), so that the bones are set once a frame however many times the scene is drawn. */
export function rigidNextFrame(view) {
  view.rigidFrame = (view.rigidFrame ?? 0) + 1;
}

/** Whether `mesh` is a merged mesh (what sweeps over a man's materials pass by: its stand-in reads the pieces' own). */
export const isRigidMerged = (mesh) => mesh?.userData?.rigidMerge === true;
/** Whether `mesh` is a piece drawn in a merged mesh now (not drawn itself). */
export const isRigidJoined = (mesh) => mesh?.layers?.mask === 1 << RIGID_MERGE.layer;
