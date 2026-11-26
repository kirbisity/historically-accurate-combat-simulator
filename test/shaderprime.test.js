// Shader programs linked side by side (shaderprime.js): checked against a small stand-in for three's renderer and the
// browser's context, which does what three r128 does with a program (links it when a material first needs it, asks its
// uniforms at once, keeps the table) and links in parallel (a link is done when the test says so).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

globalThis.THREE ??= { BufferGeometry: class { constructor() { this.index = null; this.attributes = {}; } } };
const { canPrimeShaders, openShaderPrime, primeLinksDone, primeShaderSteps } = await import('../src/shaderprime.js');

const ACTIVE_UNIFORMS = 0x8b86;
const LINK_STATUS = 0x8b82;
const COMPLETION = 0x91b1;

function standIn({ parallel = true } = {}) {
  const programs = new Map();
  let next = 1;
  const gl = {
    lost: false,
    isContextLost() { return this.lost; },
    getExtension: (name) => (parallel && name === 'KHR_parallel_shader_compile' ? { COMPLETION_STATUS_KHR: COMPLETION } : null),
    createProgram: () => { const handle = { id: next++ }; programs.set(handle, { done: false, ok: true, uniforms: 5 }); return handle; },
    linkProgram(program) { programs.get(program).linked = true; },
    getProgramParameter(program, name) {
      const p = programs.get(program);
      if (name === COMPLETION) return p.done;
      // (A question of a program still linking waits for it: here, it is counted.)
      if (!p.done) gl.waited += 1;
      p.done = true;
      if (name === ACTIVE_UNIFORMS) return p.uniforms;
      if (name === LINK_STATUS) return p.ok;
      return null;
    },
    getProgramInfoLog: (program) => (programs.get(program).ok ? '' : 'broken'),
    getAttachedShaders: () => [],
    getShaderInfoLog: () => '',
    getError: () => 0,
    waited: 0,
    finish(program) { programs.get(program).done = true; },
  };
  class Uniforms { constructor(context, program) { this.count = context.getProgramParameter(program, ACTIVE_UNIFORMS); } }
  const properties = new Map();
  const cache = new Map();
  const renderer = {
    debug: { checkShaderErrors: true },
    info: { programs: [] },
    target: null,
    drawn: [],
    getContext: () => gl,
    getRenderTarget() { return this.target; },
    properties: { get: (material) => { if (!properties.has(material)) properties.set(material, {}); return properties.get(material); } },
    // three's getProgram: a program found by its key or made (linked; its log read if checking), its uniforms asked at once.
    program(material) {
      const props = this.properties.get(material);
      if (props.currentProgram && props.version === material.version) return props.currentProgram;
      let program = cache.get(material.key);
      if (!program) {
        const handle = gl.createProgram();
        gl.linkProgram(handle);
        if (this.debug.checkShaderErrors) gl.getProgramInfoLog(handle), gl.getProgramParameter(handle, LINK_STATUS);
        let table;
        program = { program: handle, name: material.key, getUniforms: () => (table ??= new Uniforms(gl, handle)) };
        cache.set(material.key, program);
        this.info.programs.push(program);
      }
      props.list = program.getUniforms().count;
      props.currentProgram = program;
      props.version = material.version;
      return program;
    },
    renderBufferDirect(camera, scene, geometry, material, object) {
      this.program(material);
      if (!geometry.attributes.position) return;
      this.drawn.push(object);
    },
    render(scene) {
      for (const object of scene.children) this.renderBufferDirect(null, scene, object.geometry, object.material, object);
    },
    compile(scene) {
      for (const object of scene.children) this.program(object.material);
    },
  };
  const material = (key) => ({ key, version: 0, set needsUpdate(on) { if (on) this.version += 1; } });
  const mesh = (key) => ({ geometry: { attributes: { position: {} } }, material: material(key), traverse(visit) { visit(this); } });
  const scene = (...children) => ({ children, traverse(visit) { children.forEach(visit); } });
  return { gl, renderer, mesh, scene, programs };
}

test('a primed scene: its programs made and linking, nothing drawn, no question asked of a link, three as it was after', () => {
  const { gl, renderer, mesh, scene } = standIn();
  const a = mesh('a');
  const b = mesh('b');
  const world = scene(a, b);
  const prime = openShaderPrime(renderer, { scenes: [world] });
  renderer.render(world);
  assert.equal(renderer.debug.checkShaderErrors, true, 'three\'s own check off only within each primed draw');
  prime.close();
  assert.equal(gl.waited, 0, 'nothing waited for a link');
  assert.deepEqual(renderer.drawn, [], 'nothing drawn');
  assert.equal(renderer.info.programs.length, 2);
  assert.equal(prime.linked().length, 2);
  assert.equal(renderer.debug.checkShaderErrors, true);
  assert.equal(renderer.render.name, 'render', 'its own methods given back');
  assert.equal(primeLinksDone(renderer, prime.linked()), false);
  for (const program of prime.linked()) gl.finish(program);
  assert.equal(primeLinksDone(renderer, prime.linked()), true);
  // The next draw reads the finished programs: true tables and lists, the programs not made again.
  renderer.render(world);
  assert.deepEqual(renderer.drawn, [a, b]);
  assert.equal(renderer.properties.get(a.material).list, 5);
  assert.equal(renderer.info.programs.length, 2);
  assert.equal(gl.waited, 0);
});

test('a draw outside a prime waits for its link and reads it true; other scenes and cube pictures are never primed', () => {
  const { gl, renderer, mesh, scene } = standIn();
  const a = mesh('a');
  const world = scene(a);
  const other = scene(mesh('sky'));
  const prime = openShaderPrime(renderer, { scenes: [world] });
  renderer.render(world);
  renderer.render(other);
  assert.equal(renderer.drawn.length, 1, 'the other scene drawn in full');
  renderer.target = { isWebGLCubeRenderTarget: true };
  renderer.render(world);
  renderer.target = null;
  prime.close();
  assert.deepEqual(renderer.drawn.slice(1), [a], 'a cube camera\'s picture of the primed scene drawn in full');
  assert.equal(renderer.properties.get(a.material).list, 5, 'with the true uniforms (it waited for the link)');
  assert.ok(gl.waited >= 1);
});

test('only: just those objects primed; seen and clean say whether their programs were done', () => {
  const { gl, renderer, mesh, scene } = standIn();
  const old = mesh('old');
  const fresh = mesh('fresh');
  const world = scene(old, fresh);
  renderer.render(scene(old));
  renderer.drawn.length = 0;
  gl.waited = 0;
  let prime = openShaderPrime(renderer, { scenes: [world], only: (object) => object === fresh });
  renderer.render(world);
  prime.close();
  assert.deepEqual(renderer.drawn, [old]);
  assert.equal(prime.seen(fresh), true);
  assert.equal(prime.clean(fresh), false, 'its program still linking');
  assert.equal(gl.waited, 0);
  for (const program of prime.linked()) gl.finish(program);
  prime = openShaderPrime(renderer, { scenes: [world], only: (object) => object === fresh });
  renderer.render(world);
  prime.close();
  assert.equal(prime.clean(fresh), true, 'done and read');
  assert.equal(renderer.properties.get(fresh.material).list, 5);
  assert.equal(gl.waited, 0);
});

test('a compile of a primed scene is primed too', () => {
  const { gl, renderer, mesh, scene } = standIn();
  const world = scene(mesh('a'), mesh('b'));
  const prime = openShaderPrime(renderer, { scenes: [world] });
  renderer.compile(world);
  prime.close();
  assert.equal(prime.linked().length, 2);
  assert.equal(gl.waited, 0);
});

test('behind a screen: waits a frame at a time for the links, then reports a link that failed as three would', () => {
  const { gl, renderer, mesh, scene, programs } = standIn();
  const world = scene(mesh('a'), mesh('bad'));
  const steps = primeShaderSteps(renderer, [world], () => renderer.render(world));
  assert.equal(steps.next().done, false, 'a frame waited');
  const handles = [...programs.keys()];
  programs.get(handles[1]).ok = false;
  for (const handle of handles) gl.finish(handle);
  const errors = [];
  const error = console.error;
  console.error = (...args) => errors.push(args.join(' '));
  try {
    const end = steps.next();
    assert.equal(end.done, true);
    assert.equal(end.value, 2);
  } finally {
    console.error = error;
  }
  assert.equal(errors.length, 1);
  assert.match(errors[0], /shader error.*broken.*bad/);
});

test('no parallel linking (or a lost context): nothing opened, three left alone', () => {
  const { renderer } = standIn({ parallel: false });
  assert.equal(canPrimeShaders(renderer), false);
  assert.equal(openShaderPrime(renderer, { scenes: [] }), null);
  assert.equal(primeShaderSteps(renderer, [], () => {}).next().value, null);
  const lost = standIn();
  lost.gl.lost = true;
  assert.equal(openShaderPrime(lost.renderer, { scenes: [] }), null);
});

test('wired in: the loading screen\'s warm, the boot screen, the fight marks\' compile, a new skin; the bundle loads it before render.js', () => {
  const source = (path) => readFileSync(new URL(`../${path}`, import.meta.url), 'utf8');
  const main = source('src/main.js');
  assert.match(main, /yield\* primeShaderSteps\(scene\.renderer, \[scene\.scene\]/);
  assert.match(main, /if \(bootScreen && state\.world && bootLinking\(\)\) return;/);
  assert.match(main.slice(main.indexOf('function warmMarks')), /openShaderPrime\(scene\.renderer[\s\S]{0,200}fightMarks\.warm\(\)/);
  const render = source('src/render.js');
  assert.match(render, /if \(view\.skinHolds\?\.size\) drawHoldingSkins\(view\);/);
  assert.match(render.slice(render.indexOf('function swapSkin')), /holdSkin\(view, fighterView, old,/);
  const bundle = source('tools/bundle.js');
  assert.ok(bundle.indexOf("'shaderprime'") > 0 && bundle.indexOf("'shaderprime'") < bundle.indexOf("'render'"));
});
