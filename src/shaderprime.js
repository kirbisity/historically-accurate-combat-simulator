// Shader programs linked side by side, not one after another. three r128 links each new program and at once asks the
// graphics driver for its uniforms (WebGLRenderer getProgram: program.getUniforms()), and the asking waits for the link to
// finish: so a scene's programs were linked one after another, each waiting on the last (ANGLE on Metal: 10 ms a program on
// a quiet M1 Pro, 150 to 300 ms with the card busy; Dunnottar's 130 to 180 programs were most of its wait), and a man's
// detailed skin swapped in during play stalled its frame for all of its five to seven new programs at once. With
// KHR_parallel_shader_compile the browser links on its own threads and says, without waiting, whether a link is done
// (COMPLETION_STATUS_KHR).
//
// A prime is a short window in which a scene is drawn as it will be (so three makes every program it will want, with the
// very lights, targets and materials it will draw them with) but nothing of it is drawn: each draw of the scene is handed
// an empty geometry, which three's renderBufferDirect passes over once it has set the program up; and a program still
// linking is neither asked a question nor bound (either waits for the link): three is told it has no uniforms yet
// (ACTIVE_UNIFORMS 0). Only the scenes named are primed: anything else drawn in the window (a cube camera's picture of the place for its mirrors, the prefiltering of a sky, a
// bake into a texture) is drawn in full as ever, so that no picture kept for later is ever taken of nothing. As each
// primed draw ends, what three noted of a program still linking (its empty uniform table, and the material's list built
// from it) is let go, so the next draw reads the program again: once its link is done that read is the true one, and
// before then (a draw outside a prime) it waits for the link, as it always did. Behind the loading screen and the page's
// boot screen the whole frame is primed and the screen kept up until the links are done (primeShaderSteps); in play only
// the meshes asked for are (`only`: a man's new skin, held unseen while his old one is drawn, render.js). Where the
// extension is missing nothing is opened, and three builds each program where it is first drawn, as before. Nothing in
// three's own code is changed (it comes from the CDN, and tools/bundle.js keeps it so): only its renderer's and context's
// methods are wrapped while a window is open.

/**
 * `waitMs`: the longest a screen is kept up for the links (a program still linking then waits, as it always did, where it
 * is first drawn): far past the slowest seen (a busy card, 180 programs at 300 ms each over ten threads: 6 s).
 */
export const SHADER_PRIME = {
  waitMs: 30000,
};

// (WebGL's own numbers: three asks gl.ACTIVE_UNIFORMS by its number, so the wrap below matches the number.)
const PRIME_ACTIVE_UNIFORMS = 0x8b86;
const PRIME_LINK_STATUS = 0x8b82;

// The geometry each primed draw is given: no position and no index, so three's renderBufferDirect returns once the program
// is set (WebGLRenderer: `if (position === undefined ...) return`), before any vertex state or draw.
let primeEmptyGeometry = null;
// The programs linked in a primed draw (a later one still answers for them while they link), and those whose link is not
// yet checked for errors (three's own check waits for the link: it is made at a close, once the link is done).
const primeLinked = new WeakSet();
const primeUnchecked = new Set();
// three's WebGLUniforms (not exported: the constructor of the first table it builds in a primed draw).
let PrimeUniforms = null;

/** Whether `renderer` can link in parallel (and so prime). */
export function canPrimeShaders(renderer) {
  const gl = renderer?.getContext?.();
  return Boolean(gl && !gl.isContextLost() && gl.getExtension('KHR_parallel_shader_compile'));
}

/**
 * Open a prime on `renderer` (a THREE.WebGLRenderer): null where the browser cannot link in parallel. While it is open,
 * what is drawn of `scenes` (`renderer.render`, a look's passes, or `renderer.compile`) has its programs made and nothing
 * drawn; `only(object)`: just those objects of them so (the rest drawn as ever). Close it in the same frame (`close()`:
 * its programs keep linking after); `seen` and `clean` say which of `only` were drawn in it, and whether all their
 * programs were done and read; `linked()` the programs it began, `primeLinksDone(renderer, programs)` whether they are done.
 */
export function openShaderPrime(renderer, { scenes, only = null }) {
  if (!canPrimeShaders(renderer)) return null;
  const gl = renderer.getContext();
  const ext = gl.getExtension('KHR_parallel_shader_compile');
  primeEmptyGeometry ??= new THREE.BufferGeometry();
  const own = { linkProgram: gl.linkProgram, getProgramParameter: gl.getProgramParameter, useProgram: gl.useProgram, render: renderer.render, compile: renderer.compile, renderBufferDirect: renderer.renderBufferDirect, check: renderer.debug.checkShaderErrors };
  const done = (program) => own.getProgramParameter.call(gl, program, ext.COMPLETION_STATUS_KHR) === true;
  const primed = new Set(scenes);
  const linked = new Set();
  const unread = new Set();
  // Materials drawn in the window with a program three was put off for: sent through three's getProgram again before
  // their next draw (here, when drawn outside a prime; else at the close).
  const owed = new Set();
  const seen = new Set();
  const waiting = new Set();
  // The scenes being drawn now (a render inside a render: a look's pass), and whether a draw is being primed.
  const drawing = [];
  let priming = false;
  const primable = () => primed.has(drawing[drawing.length - 1]) && !renderer.getRenderTarget()?.isWebGLCubeRenderTarget;
  gl.linkProgram = function linkProgram(program) {
    if (priming) {
      linked.add(program);
      primeLinked.add(program);
      if (own.check) primeUnchecked.add(program);
    }
    return own.linkProgram.call(gl, program);
  };
  gl.getProgramParameter = function getProgramParameter(program, name) {
    if (priming && name === PRIME_ACTIVE_UNIFORMS && primeLinked.has(program) && !done(program)) {
      unread.add(program);
      return 0;
    }
    return own.getProgramParameter.call(gl, program, name);
  };
  // Nor is a program still linking bound (binding it waits for the link, as ANGLE has to know it linked): three's own
  // note of the program bound is then put right after the draw (`renderer.state.useProgram(null)`), so its next draw binds.
  let unbound = false;
  gl.useProgram = function useProgram(program) {
    if (priming && program && primeLinked.has(program) && !done(program)) {
      unbound = true;
      return undefined;
    }
    return own.useProgram.call(gl, program);
  };
  // A primed piece of work: three's own error check off (it reads the link's log, which waits), and after it, the
  // material's program, if put off, given a fresh table to build when next asked, the material owed a new list.
  const primedFor = (materials, work) => {
    priming = true;
    renderer.debug.checkShaderErrors = false;
    try {
      return work();
    } finally {
      priming = false;
      renderer.debug.checkShaderErrors = own.check;
      if (unbound) renderer.state.useProgram(null);
      unbound = false;
      for (const material of materials) if (primeLetGo(renderer, gl, unread, material)) owed.add(material);
    }
  };
  renderer.render = function render(scene, camera) {
    drawing.push(scene);
    try {
      return own.render.call(renderer, scene, camera);
    } finally {
      drawing.pop();
    }
  };
  renderer.compile = function compile(scene, camera) {
    if (!primed.has(scene) || only) return own.compile.call(renderer, scene, camera);
    const materials = new Set();
    scene.traverse((object) => {
      for (const material of [].concat(object.material ?? [])) materials.add(material);
    });
    return primedFor(materials, () => own.compile.call(renderer, scene, camera));
  };
  renderer.renderBufferDirect = function renderBufferDirect(camera, scene, geometry, material, object, group) {
    // (The shadows of a primed scene are drawn with its own render: their depth programs primed with the rest.)
    if (!primable() || (only && !only(object))) {
      if (owed.delete(material)) primeOwe(renderer, material);
      return own.renderBufferDirect.call(renderer, camera, scene, geometry, material, object, group);
    }
    seen.add(object);
    return primedFor([material], () => {
      const drawn = own.renderBufferDirect.call(renderer, camera, scene, primeEmptyGeometry, material, object, group);
      if (unread.has(renderer.properties.get(material).currentProgram?.program)) waiting.add(object);
      return drawn;
    });
  };
  let open = true;
  return {
    /** With `only`: whether `object` was drawn in the window, and with every program it was drawn with done and read. */
    seen: (object) => seen.has(object),
    clean: (object) => seen.has(object) && !waiting.has(object),
    /** The programs begun in the window (GL programs). */
    linked: () => [...linked],
    /** Close the window: three's own methods given back, every material owed a new list of uniforms sent for one. */
    close() {
      if (!open) return;
      open = false;
      Object.assign(gl, { linkProgram: own.linkProgram, getProgramParameter: own.getProgramParameter, useProgram: own.useProgram });
      Object.assign(renderer, { render: own.render, compile: own.compile, renderBufferDirect: own.renderBufferDirect });
      renderer.debug.checkShaderErrors = own.check;
      for (const material of owed) primeOwe(renderer, material);
      owed.clear();
      if (!gl.isContextLost()) primeCheckDone(renderer, gl, done);
    },
  };
}

/** Whether every one of `programs` (GL programs) still in use is done linking (or the context is lost). */
export function primeLinksDone(renderer, programs) {
  const gl = renderer.getContext();
  if (gl.isContextLost()) return true;
  const ext = gl.getExtension('KHR_parallel_shader_compile');
  const living = new Set(renderer.info.programs.map((program) => program.program));
  return programs.every((program) => !living.has(program) || gl.getProgramParameter(program, ext.COMPLETION_STATUS_KHR) === true);
}

/**
 * Behind a screen (the loading screen's steps): open a prime on `scenes`, `work()` (draw or compile them), close it, then
 * wait a frame at a time (yield) until its links are done, `onWait(done, all)` told each frame. Where there is no prime,
 * nothing (the caller's own warm builds the programs as before). Returns how many programs it began, or null.
 */
export function* primeShaderSteps(renderer, scenes, work, { onWait = () => {} } = {}) {
  const prime = openShaderPrime(renderer, { scenes });
  if (!prime) return null;
  try {
    work();
  } finally {
    // (Closed even when the work throws: three is never left with its methods wrapped.)
    prime.close();
  }
  const programs = prime.linked();
  const gl = renderer.getContext();
  const ext = gl.getExtension('KHR_parallel_shader_compile');
  const done = (program) => gl.getProgramParameter(program, ext.COMPLETION_STATUS_KHR) === true;
  const started = performance.now();
  while (!primeLinksDone(renderer, programs) && performance.now() - started < SHADER_PRIME.waitMs) {
    onWait(programs.filter(done).length, programs.length);
    yield;
  }
  // (Their links checked now they are done, as three would have the moment each was made.)
  if (!gl.isContextLost()) primeCheckDone(renderer, gl, done);
  return programs.length;
}

// After a primed draw of `material`: if three was put off for its program (still linking), the program's table is let go
// (a new getter builds it afresh when next asked: three builds it once and keeps it) and true is returned (the material's
// list, made from the empty table, is owed). The material keeps its program: three finds the same one by its key.
function primeLetGo(renderer, gl, unread, material) {
  const program = renderer.properties.get(material).currentProgram;
  if (!program || !unread.has(program.program)) return false;
  // (Asked while still priming: the table three just built is the one kept, so its constructor is read with no question asked.)
  PrimeUniforms ??= program.getUniforms().constructor;
  let table;
  program.getUniforms = function getUniforms() {
    table ??= new PrimeUniforms(gl, program.program);
    return table;
  };
  return true;
}

// A material whose list of uniforms was made from an empty table: its program forgotten and its version moved on, so its
// next draw sends it through three's getProgram again, which finds the same program by its key and makes the list again.
function primeOwe(renderer, material) {
  renderer.properties.get(material).currentProgram = null;
  material.needsUpdate = true;
}

// three's own report of a program that failed to link (WebGLProgram, `checkShaderErrors`), made for each link done since.
function primeCheckDone(renderer, gl, done) {
  if (!primeUnchecked.size) return;
  const names = new Map(renderer.info.programs.map((program) => [program.program, program.name]));
  for (const program of primeUnchecked) {
    // (A program let go before its link was checked is dropped; one still linking waits for a later close.)
    if (!names.has(program)) {
      primeUnchecked.delete(program);
      continue;
    }
    if (!done(program)) continue;
    primeUnchecked.delete(program);
    const log = gl.getProgramInfoLog(program)?.trim() ?? '';
    if (gl.getProgramParameter(program, PRIME_LINK_STATUS) === false) {
      const shaders = (gl.getAttachedShaders(program) ?? []).map((shader) => gl.getShaderInfoLog(shader)?.trim());
      console.error('THREE.WebGLProgram: shader error: ', gl.getError(), 'gl.getProgramInfoLog', log, ...shaders, `(${names.get(program)}, linked in a prime: shaderprime.js)`);
    } else if (log !== '') {
      console.warn('THREE.WebGLProgram: gl.getProgramInfoLog()', log);
    }
  }
}
