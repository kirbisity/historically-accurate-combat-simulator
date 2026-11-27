// A man's rigid pieces joined into skinned meshes (src/rigidmerge.js): the vertex stage reads the piece's matrices from its
// bone where three reads the object's, so every chunk and patch that reads them draws as on the piece; a shader whose
// patches read the object's matrices where the piece's cannot be given is refused; the stand-in material reads its source
// as it is now (its numbers, its maps, its rebuilds) and keeps its own program and listeners. Over a stand-in for three.js:
// only what the module reads at load and the stand-in material are real. (The pictures, merged against not, are compared
// in the browser: the branch's evidence.)
import { test } from 'node:test';
import assert from 'node:assert/strict';

class Material {
  constructor() {
    this.version = 0;
    this.userData = {};
    this._listeners = undefined;
  }
  set needsUpdate(value) {
    if (value) this.version += 1;
  }
  onBeforeCompile() {}
  customProgramCacheKey() {
    return this.onBeforeCompile.toString();
  }
  addEventListener(type, listener) {
    if (this._listeners === undefined) this._listeners = {};
    (this._listeners[type] ??= []).push(listener);
  }
  dispatchEvent(event) {
    for (const listener of this._listeners?.[event.type] ?? []) listener({ ...event, target: this });
  }
  dispose() {
    this.dispatchEvent({ type: 'dispose' });
  }
}
class Matrix4 {}
let uuid = 0;
globalThis.THREE = { MeshBasicMaterial: Material, Matrix4, MathUtils: { generateUUID: () => `u${(uuid += 1)}` } };
const { rigidPatch, rigidStandIn } = await import('../src/rigidmerge.js');

const VERTEX = `uniform mat4 modelMatrix;
uniform mat4 modelViewMatrix;
uniform mat3 normalMatrix;
#include <skinning_pars_vertex>
void main() {
	#include <skinbase_vertex>
	#include <beginnormal_vertex>
	#include <skinnormal_vertex>
	#include <defaultnormal_vertex>
	#include <begin_vertex>
	#include <skinning_vertex>
	#include <project_vertex>
	#include <worldpos_vertex>
}`;
const FRAGMENT = 'void main() {\n\tgl_FragColor = vec4( 1.0 );\n}';

test('the piece\'s matrices are declared first in main, from its bone; three\'s own skinning is taken out', () => {
  const shader = { vertexShader: VERTEX, fragmentShader: FRAGMENT };
  assert.equal(rigidPatch(shader), true);
  const main = shader.vertexShader.slice(shader.vertexShader.indexOf('void main() {'));
  assert.equal(shader.vertexShader.split('void main() {').length, 2, 'one main');
  const first = main.split('\n').slice(1, 6).join('\n');
  assert.match(first, /mat4 rigidPiece = getBoneMatrix\( skinIndex\.x \);/);
  assert.match(first, /mat4 modelMatrix = modelMatrix \* rigidPiece;/);
  assert.match(first, /mat4 modelViewMatrix = viewMatrix \* modelMatrix;/);
  assert.match(first, /mat3 normalMatrix = rigidNormalMatrix\( mat3\( modelViewMatrix \) \);/);
  assert.ok(!shader.vertexShader.includes('#include <skinning_vertex>') && !shader.vertexShader.includes('#include <skinnormal_vertex>'));
  // The rest of three's chunks are left to read them.
  for (const chunk of ['beginnormal_vertex', 'defaultnormal_vertex', 'begin_vertex', 'project_vertex', 'worldpos_vertex']) assert.ok(shader.vertexShader.includes(`#include <${chunk}>`), chunk);
  assert.equal(shader.fragmentShader, FRAGMENT, 'a fragment stage that reads none of them is left alone');
});

test('a fragment stage that reads the normal matrix is handed the piece\'s', () => {
  const fragment = 'uniform mat3 normalMatrix;\nvoid main() {\n\tvec3 tilt = normalMatrix * vec3( 1.0 );\n}';
  const shader = { vertexShader: VERTEX, fragmentShader: fragment };
  assert.equal(rigidPatch(shader), true);
  assert.ok(shader.fragmentShader.includes('varying mat3 vRigidNormal;') && shader.fragmentShader.includes('#define normalMatrix vRigidNormal'));
  assert.ok(!/uniform\s+mat3\s+normalMatrix/.test(shader.fragmentShader));
  assert.ok(shader.vertexShader.includes('varying mat3 vRigidNormal;') && shader.vertexShader.includes('vRigidNormal = normalMatrix;'));
});

test('a shader that reads the object\'s matrices where the piece\'s cannot be given is refused, and left as it was', () => {
  const outside = { vertexShader: VERTEX.replace('void main() {', 'vec3 lift() { return ( modelMatrix * vec4( 0.0 ) ).xyz; }\nvoid main() {'), fragmentShader: FRAGMENT };
  const before = outside.vertexShader;
  assert.equal(rigidPatch(outside), false);
  assert.equal(outside.vertexShader, before);
  assert.equal(rigidPatch({ vertexShader: VERTEX, fragmentShader: 'void main() {\n\tvec4 p = modelViewMatrix * vec4( 1.0 );\n}' }), false);
  assert.equal(rigidPatch({ vertexShader: VERTEX.replace('void main() {', 'void main2() {'), fragmentShader: FRAGMENT }), false);
});

test('the stand-in reads its material as it is now, follows its rebuilds, and keeps its own program and listeners', () => {
  const source = new Material();
  source.color = { r: 1, g: 0, b: 0 };
  source.roughness = 0.5;
  source.addEventListener('dispose', () => assert.fail('the source is not disposed with its stand-in'));
  const standIn = rigidStandIn(source);
  assert.notEqual(standIn.id, source.id);
  assert.notEqual(standIn.uuid, source.uuid);
  assert.equal(standIn.skinning, true);
  assert.equal(standIn.color, source.color, 'the very colour object: a colour set on the material shows');
  source.roughness = 0.8;
  assert.equal(standIn.roughness, 0.8);
  const version = standIn.version;
  source.needsUpdate = true;
  assert.equal(standIn.version, version + 1, 'a source rebuilt is a stand-in rebuilt');
  standIn.needsUpdate = true;
  assert.equal(standIn.version, version + 2);
  assert.equal(source.version, 1, 'the stand-in rebuilt alone leaves the source as it was');
  source.customProgramCacheKey = () => 'detail|wet';
  assert.equal(standIn.customProgramCacheKey(), 'detail|wet|rigid');
  const seen = [];
  source.onBeforeCompile = (shader) => seen.push(shader.vertexShader.includes('rigidPiece') ? 'after' : 'before');
  const shader = { vertexShader: VERTEX, fragmentShader: FRAGMENT };
  standIn.onBeforeCompile(shader);
  assert.deepEqual(seen, ['before'], 'the material\'s own patches first');
  assert.ok(shader.vertexShader.includes('rigidPiece'), 'then the merge\'s');
  let disposed = 0;
  standIn.addEventListener('dispose', () => (disposed += 1));
  standIn.dispose();
  assert.equal(disposed, 1);
});
