// Poke-through detector, evaluated in the game page (window.__clip).
// capture(viewIndex): every drawn surface of the man as the card draws it (each vertex's world position read back from
// the vertex stage itself: skinning, dual quaternions, cloth sway, rigid pieces all as drawn), one frame.
// analyse(frames): for each drawn vertex, the other surfaces within R: inside (behind their outward face) or outside.
// A vertex's natural side of a surface is what its 3 cm neighbourhood has in the reference frame (frame 0, standing);
// a poke is a vertex on the wrong side by more than TOL in some frame (rest: frame 0; motion: the others).
window.__clip = (() => {
  const BONES = ['pelvis', 'spine', 'chest', 'neck', 'head', 'lClavicle', 'lUpperArm', 'lForearm', 'rClavicle', 'rUpperArm', 'rForearm', 'lThigh', 'lShin', 'lFoot', 'rThigh', 'rShin', 'rFoot'];
  const LAYER = 30;
  const R = 0.025;
  const TOL = 0.001;
  // Summed RGB difference under which two surfaces look the same (linear 0..1 per channel).
  const SAME_COLOUR = 0.12;
  const CELL = 0.03;
  const W = 1024;
  const standIns = new Map();
  let target = null;
  const camera = new THREE.OrthographicCamera(-200, 200, 200, -200, -200, 200);
  camera.position.set(0, 0, 0);
  camera.updateMatrixWorld(true);
  camera.layers.set(LAYER);
  const statics = new WeakMap();
  const comp4 = (attr, i, k) => [attr.getX, attr.getY, attr.getZ, attr.getW][k].call(attr, i);

  function standIn(source) {
    if (standIns.has(source)) return standIns.get(source);
    const material = Object.create(source);
    material.uuid = THREE.MathUtils.generateUUID();
    material._listeners = {};
    Object.defineProperty(material, 'id', { value: 900000 + standIns.size });
    material.transparent = false;
    material.blending = THREE.NoBlending;
    material.depthTest = false;
    material.depthWrite = false;
    material.colorWrite = true;
    material.alphaTest = 0;
    material.visible = true;
    material.side = THREE.DoubleSide;
    material.onBeforeCompile = (shader, renderer) => {
      source.onBeforeCompile?.call(source, shader, renderer);
      shader.uniforms.uClipSize = { value: new THREE.Vector2(W, 1) };
      material.userData = { ...source.userData, clipShader: shader };
      const vs = shader.vertexShader;
      const end = vs.lastIndexOf('}');
      shader.vertexShader = 'uniform vec2 uClipSize;\nvarying vec3 vClipWorld;\n' + vs.slice(0, end) +
        '\n  vClipWorld = mvPosition.xyz;\n  float clipW = uClipSize.x, clipH = uClipSize.y;\n  float clipI = float( gl_VertexID );\n  float clipRow = floor( clipI / clipW );\n  float clipCol = clipI - clipRow * clipW;\n  gl_Position = vec4( ( clipCol + 0.5 ) / clipW * 2.0 - 1.0, ( clipRow + 0.5 ) / clipH * 2.0 - 1.0, 0.0, 1.0 );\n  gl_PointSize = 1.0;\n}\n';
      shader.fragmentShader = 'varying vec3 vClipWorld;\nvoid main() { gl_FragColor = vec4( vClipWorld, 1.0 ); }\n';
    };
    const key = source.customProgramCacheKey?.() ?? '';
    material.customProgramCacheKey = () => `${key}|clipdump`;
    material.needsUpdate = true;
    standIns.set(source, material);
    return material;
  }

  const drawnChain = (object) => {
    for (let node = object; node; node = node.parent) if (!node.visible) return false;
    return true;
  };

  // The meshes drawn for a man: his tree's visible meshes on the camera's layer or joined into a merged mesh (layer 31),
  // not the merged meshes themselves, not outlines.
  function drawnMeshes(view) {
    const list = [];
    // (What he wears: his body's skinned meshes, his head and what is on it, and his attachments (hands, shoes, collar,
    // hips and what hangs from them); not what he holds or carries at the hip, his weapons and their hilts.)
    const worn = new Set([view.head?.group, ...(view.attachments ?? []).map((entry) => entry.object)].filter(Boolean));
    const wornOf = (object) => {
      if (object.isSkinnedMesh && object.parent === view.layers?.skin) return true;
      for (let node = object; node && node !== view.group; node = node.parent) if (worn.has(node)) return true;
      return false;
    };
    view.group.traverse((object) => {
      if (object.isMesh && !wornOf(object)) return;
      if (!object.isMesh || object.isInstancedMesh) return;
      if (object.userData.outline || object.userData.rigidMerge) return;
      if (!(object.layers.mask & 1) && object.layers.mask !== 1 << 31) return;
      if (!drawnChain(object) || object.material?.visible === false || Array.isArray(object.material)) return;
      if (!object.geometry.attributes.position) return;
      list.push(object);
    });
    return list;
  }

  function boneIndexOf(view, object) {
    for (let node = object; node; node = node.parent) {
      const at = view.bones?.indexOf?.(node) ?? -1;
      if (at >= 0) return at;
    }
    return -1;
  }

  // Dump each mesh's vertices as drawn, grouped by the position attribute (sub-meshes of one body share it).
  function capture(viewIndex = 0) {
    const scene = boxer.scene;
    const renderer = scene.renderer;
    const view = boxer.state.views[viewIndex];
    const meshes = drawnMeshes(view);
    const groups = new Map();
    for (const mesh of meshes) {
      const attr = mesh.geometry.attributes.position;
      if (!groups.has(attr)) groups.set(attr, []);
      groups.get(attr).push(mesh);
    }
    const saved = { autoUpdate: renderer.shadowMap.autoUpdate, background: scene.scene.background, target: renderer.getRenderTarget(), autoClear: renderer.autoClear };
    renderer.shadowMap.autoUpdate = false;
    scene.scene.background = null;
    const clear = new THREE.Color();
    renderer.getClearColor(clear);
    const clearAlpha = renderer.getClearAlpha();
    const sources = [];
    for (const [attr, list] of groups) {
      const count = attr.count;
      const rows = Math.ceil(count / W);
      if (!target || target.height < rows) {
        target?.dispose();
        target = new THREE.WebGLRenderTarget(W, Math.max(rows, 16), { type: THREE.FloatType, format: THREE.RGBAFormat, minFilter: THREE.NearestFilter, magFilter: THREE.NearestFilter, depthBuffer: false, stencilBuffer: false });
      }
      renderer.setRenderTarget(target);
      renderer.setClearColor(0x000000, 0);
      renderer.clear(true, false, false);
      const pos = new Float32Array(count * 3);
      const written = new Uint8Array(count);
      const pixels = new Float32Array(W * rows * 4);
      const pass = () => {
        for (const mesh of list) {
          const keep = { mask: mesh.layers.mask, material: mesh.material, isMesh: mesh.isMesh, isPoints: mesh.isPoints, frustum: mesh.frustumCulled };
          const material = standIn(mesh.material);
          mesh.material = material;
          mesh.layers.set(LAYER);
          mesh.isMesh = false;
          mesh.isPoints = true;
          mesh.frustumCulled = false;
          material.userData?.clipShader?.uniforms.uClipSize.value.set(W, target.height);
          try {
            renderer.render(scene.scene, camera);
          } finally {
            mesh.material = keep.material;
            mesh.layers.mask = keep.mask;
            mesh.isMesh = keep.isMesh;
            mesh.isPoints = keep.isPoints;
            mesh.frustumCulled = keep.frustum;
          }
        }
      };
      renderer.autoClear = false;
      // (The first draw of a stand-in compiles it, and its size uniform is only there from then on: drawn twice.)
      pass();
      renderer.clear(true, false, false);
      pass();
      renderer.readRenderTargetPixels(target, 0, 0, W, rows, pixels);
      for (let i = 0; i < count; i += 1) {
        if (pixels[i * 4 + 3] < 0.5) continue;
        written[i] = 1;
        pos[i * 3] = pixels[i * 4];
        pos[i * 3 + 1] = pixels[i * 4 + 1];
        pos[i * 3 + 2] = pixels[i * 4 + 2];
      }
      sources.push({ attr, meshes: list, pos, written });
    }
    renderer.setRenderTarget(saved.target);
    renderer.setClearColor(clear, clearAlpha);
    renderer.autoClear = saved.autoClear;
    renderer.shadowMap.autoUpdate = saved.autoUpdate;
    scene.scene.background = saved.background;
    return { view, sources: sources.map((source) => ({ ...source, info: staticInfo(view, source) })) };
  }

  // What does not change between frames: the drawn triangles, their surfaces (welded connected pieces), outward winding,
  // each vertex's bone, the surface's label.
  function staticInfo(view, source) {
    const { attr, meshes } = source;
    const cached = statics.get(attr);
    if (cached && cached.meshes.length === meshes.length && cached.meshes.every((mesh, i) => mesh === meshes[i])) return cached;
    const tris = [];
    const triMesh = [];
    meshes.forEach((mesh, m) => {
      const index = mesh.geometry.index;
      const { start, count } = mesh.geometry.drawRange;
      if (index) {
        const end = Math.min(index.count, count === Infinity ? index.count : start + count);
        for (let i = start; i + 2 < end; i += 3) {
          tris.push(index.getX(i), index.getX(i + 1), index.getX(i + 2));
          triMesh.push(m);
        }
      } else {
        for (let i = 0; i + 2 < attr.count; i += 3) {
          tris.push(i, i + 1, i + 2);
          triMesh.push(m);
        }
      }
    });
    const n = attr.count;
    // Weld by position (0.1 mm) for the surfaces.
    const weldKey = new Map();
    const weld = new Int32Array(n);
    for (let i = 0; i < n; i += 1) {
      const key = `${Math.round(attr.getX(i) * 1e4)}|${Math.round(attr.getY(i) * 1e4)}|${Math.round(attr.getZ(i) * 1e4)}`;
      if (!weldKey.has(key)) weldKey.set(key, i);
      weld[i] = weldKey.get(key);
    }
    const parent = new Int32Array(n).map((_, i) => i);
    const find = (i) => {
      while (parent[i] !== i) {
        parent[i] = parent[parent[i]];
        i = parent[i];
      }
      return i;
    };
    const unite = (a, b) => {
      const [x, y] = [find(a), find(b)];
      if (x !== y) parent[x] = y;
    };
    for (let t = 0; t < tris.length; t += 3) {
      unite(weld[tris[t]], weld[tris[t + 1]]);
      unite(weld[tris[t]], weld[tris[t + 2]]);
    }
    const comp = new Int32Array(n).fill(-1);
    const compIds = new Map();
    const drawn = new Uint8Array(n);
    for (const v of tris) drawn[v] = 1;
    for (let i = 0; i < n; i += 1) if (drawn[i]) {
      const root = find(weld[i]);
      if (!compIds.has(root)) compIds.set(root, compIds.size);
      comp[i] = compIds.get(root);
    }
    // Outward winding: the triangle's face against its corners' normals, in the geometry's own space.
    const normal = meshes[0].geometry.attributes.normal;
    const sign = new Int8Array(tris.length / 3);
    for (let t = 0; t < tris.length; t += 3) {
      const [a, b, c] = [tris[t], tris[t + 1], tris[t + 2]];
      const e1 = [attr.getX(b) - attr.getX(a), attr.getY(b) - attr.getY(a), attr.getZ(b) - attr.getZ(a)];
      const e2 = [attr.getX(c) - attr.getX(a), attr.getY(c) - attr.getY(a), attr.getZ(c) - attr.getZ(a)];
      const cr = [e1[1] * e2[2] - e1[2] * e2[1], e1[2] * e2[0] - e1[0] * e2[2], e1[0] * e2[1] - e1[1] * e2[0]];
      let dot = 0;
      if (normal) for (const v of [a, b, c]) dot += cr[0] * normal.getX(v) + cr[1] * normal.getY(v) + cr[2] * normal.getZ(v);
      else dot = 1;
      const mesh = meshes[triMesh[t / 3]];
      const mirrored = !mesh.isSkinnedMesh && mesh.matrixWorld.determinant() < 0;
      sign[t / 3] = (dot >= 0 ? 1 : -1) * (mirrored ? -1 : 1);
    }
    // Each vertex's bone.
    const bone = new Int8Array(n).fill(-1);
    const mesh0 = meshes[0];
    if (mesh0.isSkinnedMesh) {
      const si = mesh0.geometry.attributes.skinIndex;
      const sw = mesh0.geometry.attributes.skinWeight;
      for (let i = 0; i < n; i += 1) {
        let best = 0;
        for (let k = 0; k < 4; k += 1) if (comp4(sw, i, k) > comp4(sw, i, best)) best = k;
        const boneObject = mesh0.skeleton.bones[comp4(si, i, best)];
        bone[i] = view.bones?.indexOf?.(boneObject) ?? -1;
        if (bone[i] < 0) bone[i] = comp4(si, i, best);
      }
    } else bone.fill(boneIndexOf(view, mesh0));
    const headSkin = meshes.some((mesh) => mesh.parent === view.head?.group && !mesh.userData.photoHair && !mesh.userData.photoBeard);
    let handOf = false;
    for (let node = meshes[0]; node; node = node.parent) if (node.userData?.hand) handOf = true;
    const isSkin = meshes.some((mesh) => mesh === view.skinMesh);
    const skinTris = new Uint8Array(tris.length / 3);
    meshes.forEach((mesh, m) => {
      if (mesh !== view.skinMesh) return;
      triMesh.forEach((owner, t) => {
        if (owner === m) skinTris[t] = 1;
      });
    });
    // A surface is skin when most of its triangles are drawn by the skin mesh.
    const compSkin = new Map();
    for (let t = 0; t < triMesh.length; t += 1) {
      const c = comp[tris[t * 3]];
      const s = compSkin.get(c) ?? [0, 0];
      s[skinTris[t]] += 1;
      compSkin.set(c, s);
    }
    const hair = meshes.some((mesh) => mesh.userData.photoHair || mesh.userData.photoBeard);
    const label = hair ? 'hair' : handOf ? 'hand' : mesh0.isSkinnedMesh ? 'body' : (mesh0.name || mesh0.parent?.name || mesh0.material.type.replace('Mesh', '').replace('Material', ''));
    // Each vertex's colour as drawn (vertex colour times the material's), to tell what would show through.
    const col = new Float32Array(n * 3);
    const vc = mesh0.geometry.attributes.color;
    const triOwner = new Int32Array(n).fill(0);
    triMesh.forEach((m, t) => { for (let k = 0; k < 3; k += 1) triOwner[tris[t * 3 + k]] = m; });
    for (let i = 0; i < n; i += 1) {
      const mc = meshes[triOwner[i]].material.color ?? { r: 1, g: 1, b: 1 };
      const [r, g, b] = vc ? [vc.getX(i), vc.getY(i), vc.getZ(i)] : [1, 1, 1];
      col[i * 3] = r * mc.r; col[i * 3 + 1] = g * mc.g; col[i * 3 + 2] = b * mc.b;
    }
    const info = { col, meshes, tris: Uint32Array.from(tris), comp, sign, bone, drawn, label, skin: new Map([...compSkin].map(([c, [no, yes]]) => [c, headSkin || yes > no])), hair, isSkin };
    statics.set(attr, info);
    return info;
  }

  // Closest point on triangle (Ericson), returning [x, y, z, region] (region 0: interior).
  function closest(p, a, b, c) {
    const ab = [b[0] - a[0], b[1] - a[1], b[2] - a[2]];
    const ac = [c[0] - a[0], c[1] - a[1], c[2] - a[2]];
    const ap = [p[0] - a[0], p[1] - a[1], p[2] - a[2]];
    const dot = (u, v) => u[0] * v[0] + u[1] * v[1] + u[2] * v[2];
    const d1 = dot(ab, ap), d2 = dot(ac, ap);
    if (d1 <= 0 && d2 <= 0) return [a[0], a[1], a[2], 1];
    const bp = [p[0] - b[0], p[1] - b[1], p[2] - b[2]];
    const d3 = dot(ab, bp), d4 = dot(ac, bp);
    if (d3 >= 0 && d4 <= d3) return [b[0], b[1], b[2], 1];
    const vc = d1 * d4 - d3 * d2;
    if (vc <= 0 && d1 >= 0 && d3 <= 0) { const v = d1 / (d1 - d3); return [a[0] + v * ab[0], a[1] + v * ab[1], a[2] + v * ab[2], 2]; }
    const cp = [p[0] - c[0], p[1] - c[1], p[2] - c[2]];
    const d5 = dot(ab, cp), d6 = dot(ac, cp);
    if (d6 >= 0 && d5 <= d6) return [c[0], c[1], c[2], 1];
    const vb = d5 * d2 - d1 * d6;
    if (vb <= 0 && d2 >= 0 && d6 <= 0) { const w = d2 / (d2 - d6); return [a[0] + w * ac[0], a[1] + w * ac[1], a[2] + w * ac[2], 2]; }
    const va = d3 * d6 - d5 * d4;
    if (va <= 0 && d4 - d3 >= 0 && d5 - d6 >= 0) { const w = (d4 - d3) / ((d4 - d3) + (d5 - d6)); return [b[0] + w * (c[0] - b[0]), b[1] + w * (c[1] - b[1]), b[2] + w * (c[2] - b[2]), 2]; }
    const denom = 1 / (va + vb + vc);
    const v = vb * denom, w = vc * denom;
    return [a[0] + ab[0] * v + ac[0] * w, a[1] + ab[1] * v + ac[1] * w, a[2] + ab[2] * v + ac[2] * w, 0];
  }

  const GRID = 0.025;
  const gridKey = (x, y, z) => ((x + 500) * 1000 + (y + 500)) * 1000 + (z + 500);
  const surfaceOf = (s, comp) => s * 4096 + comp;

  // One frame's states: for each drawn vertex, each other surface within R it lies over (mostly along its face's normal):
  // signed depth (+ outside the face, - inside). Flat arrays: vertex (global id), surface, depth.
  function states(frame) {
    const offsets = [];
    let total = 0;
    for (const source of frame.sources) {
      offsets.push(total);
      total += source.info.drawn.length;
    }
    frame.offsets = offsets;
    frame.total = total;
    let triCount = 0;
    for (const source of frame.sources) triCount += source.info.tris.length / 3;
    const P = new Float64Array(triCount * 9);
    const N = new Float64Array(triCount * 3);
    const S = new Int32Array(triCount);
    const TB = new Int8Array(triCount);
    const TC = new Float32Array(triCount * 3);
    const BB = new Float64Array(triCount * 6);
    const ok = new Uint8Array(triCount);
    const cells = new Map();
    let g = 0;
    frame.sources.forEach((source, s) => {
      const { tris, comp, sign } = source.info;
      const { pos, written } = source;
      for (let t = 0; t < tris.length; t += 3, g += 1) {
        const a = tris[t], b = tris[t + 1], c = tris[t + 2];
        if (!written[a] || !written[b] || !written[c]) continue;
        for (let k = 0; k < 3; k += 1) {
          P[g * 9 + k] = pos[a * 3 + k];
          P[g * 9 + 3 + k] = pos[b * 3 + k];
          P[g * 9 + 6 + k] = pos[c * 3 + k];
        }
        const e1x = P[g * 9 + 3] - P[g * 9], e1y = P[g * 9 + 4] - P[g * 9 + 1], e1z = P[g * 9 + 5] - P[g * 9 + 2];
        const e2x = P[g * 9 + 6] - P[g * 9], e2y = P[g * 9 + 7] - P[g * 9 + 1], e2z = P[g * 9 + 8] - P[g * 9 + 2];
        const nx = e1y * e2z - e1z * e2y, ny = e1z * e2x - e1x * e2z, nz = e1x * e2y - e1y * e2x;
        const len = Math.hypot(nx, ny, nz);
        if (len < 1e-10) continue;
        const sg = sign[t / 3] / len;
        N[g * 3] = nx * sg; N[g * 3 + 1] = ny * sg; N[g * 3 + 2] = nz * sg;
        S[g] = surfaceOf(s, comp[a]);
        TB[g] = source.info.bone[a];
        for (let k = 0; k < 3; k += 1) TC[g * 3 + k] = (source.info.col[a * 3 + k] + source.info.col[b * 3 + k] + source.info.col[c * 3 + k]) / 3;
        let lo = [Infinity, Infinity, Infinity], hi = [-Infinity, -Infinity, -Infinity];
        for (let corner = 0; corner < 3; corner += 1) for (let k = 0; k < 3; k += 1) {
          lo[k] = Math.min(lo[k], P[g * 9 + corner * 3 + k]);
          hi[k] = Math.max(hi[k], P[g * 9 + corner * 3 + k]);
        }
        if (hi[0] - lo[0] > 0.4 || hi[1] - lo[1] > 0.4 || hi[2] - lo[2] > 0.4) continue;
        ok[g] = 1;
        for (let k = 0; k < 3; k += 1) { BB[g * 6 + k] = lo[k] - R; BB[g * 6 + 3 + k] = hi[k] + R; }
        for (let x = Math.floor(lo[0] / GRID); x <= Math.floor(hi[0] / GRID); x += 1)
          for (let y = Math.floor(lo[1] / GRID); y <= Math.floor(hi[1] / GRID); y += 1)
            for (let z = Math.floor(lo[2] / GRID); z <= Math.floor(hi[2] / GRID); z += 1) {
              const k = gridKey(x, y, z);
              let list = cells.get(k);
              if (!list) {
                cells.set(k, (list = []));
                list.first = S[g];
                list.mixed = false;
              } else if (list.first !== S[g]) list.mixed = true;
              list.push(g);
            }
      }
    });
    const stamp = new Int32Array(triCount).fill(-1);
    const outV = [], outS = [], outD = [];
    const bestS = [], bestDist = [], bestAlong = [], bestRegion = [], bestBone = [];
    const outB = [], outT = [];
    const bestN = [];
    const q = [0, 0, 0, 0];
    frame.sources.forEach((source, s) => {
      const { drawn, comp } = source.info;
      const { pos, written } = source;
      for (let v = 0; v < drawn.length; v += 1) {
        if (!drawn[v] || !written[v]) continue;
        const px = pos[v * 3], py = pos[v * 3 + 1], pz = pos[v * 3 + 2];
        const own = surfaceOf(s, comp[v]);
        const id = offsets[s] + v;
        bestS.length = 0; bestDist.length = 0; bestAlong.length = 0; bestRegion.length = 0;
        const cx = Math.floor(px / GRID), cy = Math.floor(py / GRID), cz = Math.floor(pz / GRID);
        // (Nothing but its own surface near: nothing to test.)
        let alone = true;
        for (let dx = -1; dx <= 1 && alone; dx += 1) for (let dy = -1; dy <= 1 && alone; dy += 1) for (let dz = -1; dz <= 1 && alone; dz += 1) {
          const list = cells.get(gridKey(cx + dx, cy + dy, cz + dz));
          if (list && (list.mixed || list.first !== own)) alone = false;
        }
        if (alone) continue;
        for (let dx = -1; dx <= 1; dx += 1) for (let dy = -1; dy <= 1; dy += 1) for (let dz = -1; dz <= 1; dz += 1) {
          const list = cells.get(gridKey(cx + dx, cy + dy, cz + dz));
          if (!list) continue;
          for (const t of list) {
            if (stamp[t] === id) continue;
            stamp[t] = id;
            const surface = S[t];
            if (surface === own) continue;
            if (px < BB[t * 6] || py < BB[t * 6 + 1] || pz < BB[t * 6 + 2] || px > BB[t * 6 + 3] || py > BB[t * 6 + 4] || pz > BB[t * 6 + 5]) continue;
            closestInto(px, py, pz, P, t * 9, q);
            const ddx = px - q[0], ddy = py - q[1], ddz = pz - q[2];
            const dist = Math.hypot(ddx, ddy, ddz);
            if (dist > R) continue;
            let slot = bestS.indexOf(surface);
            if (slot >= 0 && bestDist[slot] <= dist) continue;
            if (slot < 0) {
              slot = bestS.length;
              bestS.push(surface);
            }
            bestDist[slot] = dist;
            bestAlong[slot] = ddx * N[t * 3] + ddy * N[t * 3 + 1] + ddz * N[t * 3 + 2];
            bestRegion[slot] = q[3];
            bestBone[slot] = TB[t];
            bestN[slot] = t;
          }
        }
        for (let i = 0; i < bestS.length; i += 1) {
          const dist = bestDist[i], along = bestAlong[i];
          // (Only what would show: an inner surface of the same colour as the outer one through it is the same cloth.)
          const t = bestN[i];
          const dc = Math.abs(source.info.col[v * 3] - TC[t * 3]) + Math.abs(source.info.col[v * 3 + 1] - TC[t * 3 + 1]) + Math.abs(source.info.col[v * 3 + 2] - TC[t * 3 + 2]);
          if (dc < SAME_COLOUR) continue;
          // Valid only where the point lies over the face (mostly along its normal), not past its edge.
          if (dist > 5e-4 && Math.abs(along) < 0.7 * dist) continue;
          if (bestRegion[i] !== 0 && dist > 2e-3) continue;
          outV.push(id); outS.push(bestS[i]); outD.push(along); outB.push(bestBone[i]); outT.push(N[bestN[i] * 3], N[bestN[i] * 3 + 1], N[bestN[i] * 3 + 2]);
        }
      }
    });
    return { v: Int32Array.from(outV), s: Int32Array.from(outS), d: Float32Array.from(outD), b: Int8Array.from(outB), n: Float32Array.from(outT) };
  }

  function closestInto(px, py, pz, P, o, out) {
    const ax = P[o], ay = P[o + 1], az = P[o + 2];
    const abx = P[o + 3] - ax, aby = P[o + 4] - ay, abz = P[o + 5] - az;
    const acx = P[o + 6] - ax, acy = P[o + 7] - ay, acz = P[o + 8] - az;
    const apx = px - ax, apy = py - ay, apz = pz - az;
    const d1 = abx * apx + aby * apy + abz * apz, d2 = acx * apx + acy * apy + acz * apz;
    const set = (x, y, z, r) => { out[0] = x; out[1] = y; out[2] = z; out[3] = r; };
    if (d1 <= 0 && d2 <= 0) return set(ax, ay, az, 1);
    const bpx = px - P[o + 3], bpy = py - P[o + 4], bpz = pz - P[o + 5];
    const d3 = abx * bpx + aby * bpy + abz * bpz, d4 = acx * bpx + acy * bpy + acz * bpz;
    if (d3 >= 0 && d4 <= d3) return set(P[o + 3], P[o + 4], P[o + 5], 1);
    const vc = d1 * d4 - d3 * d2;
    if (vc <= 0 && d1 >= 0 && d3 <= 0) { const v = d1 / (d1 - d3); return set(ax + v * abx, ay + v * aby, az + v * abz, 2); }
    const cpx = px - P[o + 6], cpy = py - P[o + 7], cpz = pz - P[o + 8];
    const d5 = abx * cpx + aby * cpy + abz * cpz, d6 = acx * cpx + acy * cpy + acz * cpz;
    if (d6 >= 0 && d5 <= d6) return set(P[o + 6], P[o + 7], P[o + 8], 1);
    const vb = d5 * d2 - d1 * d6;
    if (vb <= 0 && d2 >= 0 && d6 <= 0) { const w = d2 / (d2 - d6); return set(ax + w * acx, ay + w * acy, az + w * acz, 2); }
    const va = d3 * d6 - d5 * d4;
    if (va <= 0 && d4 - d3 >= 0 && d5 - d6 >= 0) { const w = (d4 - d3) / ((d4 - d3) + (d5 - d6)); return set(P[o + 3] + w * (P[o + 6] - P[o + 3]), P[o + 4] + w * (P[o + 7] - P[o + 4]), P[o + 5] + w * (P[o + 8] - P[o + 5]), 2); }
    const denom = 1 / (va + vb + vc);
    const v = vb * denom, w = vc * denom;
    return set(ax + abx * v + acx * w, ay + aby * v + acy * w, az + abz * v + acz * w, 0);
  }

  const PARENT = { spine: 'pelvis', chest: 'spine', neck: 'chest', head: 'neck', lClavicle: 'chest', rClavicle: 'chest', lUpperArm: 'lClavicle', rUpperArm: 'rClavicle', lForearm: 'lUpperArm', rForearm: 'rUpperArm', lThigh: 'pelvis', rThigh: 'pelvis', lShin: 'lThigh', rShin: 'rThigh', lFoot: 'lShin', rFoot: 'rShin' };
  const adjacent = (a, b) => {
    if (a < 0 || b < 0) return true;
    const [x, y] = [BONES[a], BONES[b]];
    return x === y || PARENT[x] === y || PARENT[y] === x || PARENT[x] === PARENT[y] && /Clavicle/.test(x + y);
  };

  // Pieces not under a bone of his (rigid pieces carried by their own groups): each point takes the bone of the nearest
  // skinned point in the reference frame.
  function resolveBones(ref) {
    const body = ref.sources.filter((source) => source.meshes[0].isSkinnedMesh && !source.info.hair);
    const grid = new Map();
    const G = 0.05;
    for (const source of body) for (let v = 0; v < source.info.drawn.length; v += 1) {
      if (!source.written[v] || source.info.bone[v] < 0) continue;
      const k = gridKey(Math.floor(source.pos[v * 3] / G), Math.floor(source.pos[v * 3 + 1] / G), Math.floor(source.pos[v * 3 + 2] / G));
      (grid.get(k) ?? grid.set(k, []).get(k)).push(source.pos[v * 3], source.pos[v * 3 + 1], source.pos[v * 3 + 2], source.info.bone[v]);
    }
    for (const source of ref.sources) {
      if (source.info.resolved) continue;
      source.info.resolved = true;
      for (let v = 0; v < source.info.bone.length; v += 1) {
        if (source.info.bone[v] >= 0 || !source.written[v]) continue;
        const [px, py, pz] = [source.pos[v * 3], source.pos[v * 3 + 1], source.pos[v * 3 + 2]];
        let best = Infinity, bone = -1;
        for (let reach = 1; reach <= 4 && bone < 0; reach += 1) {
          const [cx, cy, cz] = [Math.floor(px / G), Math.floor(py / G), Math.floor(pz / G)];
          for (let dx = -reach; dx <= reach; dx += 1) for (let dy = -reach; dy <= reach; dy += 1) for (let dz = -reach; dz <= reach; dz += 1) {
            const list = grid.get(gridKey(cx + dx, cy + dy, cz + dz));
            if (!list) continue;
            for (let i = 0; i < list.length; i += 4) {
              const d = (list[i] - px) ** 2 + (list[i + 1] - py) ** 2 + (list[i + 2] - pz) ** 2;
              if (d < best) [best, bone] = [d, list[i + 3]];
            }
          }
        }
        source.info.bone[v] = bone;
      }
    }
  }

  // Analyse captured frames (frame 0 the reference, standing). Which of two surfaces is the inner one where they meet, per
  // bone: skin and hair are under anything else they lie within (where the two are on the same or neighbouring bones and the
  // skin is not mostly outside it: a belly hanging over a waistband); otherwise the one whose points near the other are
  // mostly (70%) inside it while the other's are not. A poke: a point of the inner one out through the outer by over TOL,
  // or a point inside a surface in the reference frame that is out of it later (unless the surface is the inner one there).
  function analyse(frames, { keepPoints = false } = {}) {
    resolveBones(frames[0]);
    // (Every frame's sources in the reference's order, by their vertex buffers: a piece shown or hidden since shifts them.)
    for (const frame of frames.slice(1)) {
      if (frame.aligned) continue;
      const byAttr = new Map(frame.sources.map((source) => [source.attr, source]));
      frame.sources = frames[0].sources.map((source) => byAttr.get(source.attr) ?? { ...source, written: new Uint8Array(source.written.length) });
      frame.aligned = true;
    }
    const all = frames.map((frame) => (frame.st ??= states(frame)));
    const ref = frames[0];
    const srcOf = new Int32Array(ref.total);
    ref.sources.forEach((source, s) => srcOf.fill(s, ref.offsets[s], ref.offsets[s] + source.info.drawn.length));
    const kindOfSurface = (surface) => {
      const s = Math.floor(surface / 4096), comp = surface % 4096;
      const info = ref.sources[s].info;
      return info.hair ? 'hair' : info.skin.get(comp) ? 'skin' : 'other';
    };
    const surfaceOfVertex = (v) => {
      const s = srcOf[v];
      return surfaceOf(s, ref.sources[s].info.comp[v - ref.offsets[s]]);
    };
    const boneOfVertex = (v) => {
      const s = srcOf[v];
      return ref.sources[s].info.bone[v - ref.offsets[s]];
    };
    // Reference tallies per (A, B, A's bone): [in, out].
    const tallies = new Map();
    const pairKey = (a, b, bone) => (a * 65536 + b) * 32 + (bone + 1);
    const st0 = all[0];
    const refIn = new Map();
    for (let i = 0; i < st0.v.length; i += 1) {
      const A = surfaceOfVertex(st0.v[i]);
      const k = pairKey(A, st0.s[i], boneOfVertex(st0.v[i]));
      let t = tallies.get(k);
      if (!t) tallies.set(k, (t = [0, 0]));
      t[st0.d[i] > 0 ? 1 : 0] += 1;
      if (st0.d[i] < 0) refIn.set(st0.v[i] * 65536 + st0.s[i], st0.d[i]);
    }
    const share = (a, b, bone) => {
      const t = tallies.get(pairKey(a, b, bone));
      return t ? { n: t[0] + t[1], in: t[0] / (t[0] + t[1]) } : { n: 0, in: 0 };
    };
    const innerCache = new Map();
    const innerTo = (A, B, bone) => {
      const k = pairKey(A, B, bone);
      if (innerCache.has(k)) return innerCache.get(k);
      const [ka, kb] = [kindOfSurface(A), kindOfSurface(B)];
      let inner;
      if (kb === 'skin' || (kb === 'hair' && ka !== 'skin')) inner = false;
      else if (ka === 'skin' || ka === 'hair') {
        const own = share(A, B, bone);
        inner = own.n === 0 || own.in >= 0.35;
      } else {
        const own = share(A, B, bone);
        let back = { n: 0, in: 0 };
        for (const near of [bone, ...BONES.map((_, i) => i).filter((i) => i !== bone && adjacent(i, bone))]) {
          const other = share(B, A, near);
          if (other.n > back.n) back = other;
        }
        inner = own.n >= 8 && own.in >= 0.7 && (back.n < 4 || back.in <= 0.3);
      }
      innerCache.set(k, inner);
      return inner;
    };
    const outerTo = (A, B, bone) => {
      // B inner to A on any of the bones near.
      for (let near = -1; near < BONES.length; near += 1) if ((near === bone || adjacent(near, bone)) && innerTo(B, A, near)) return true;
      return false;
    };
    const label = (surface) => {
      const s = Math.floor(surface / 4096), comp = surface % 4096;
      const info = ref.sources[s].info;
      return info.hair ? 'hair' : info.skin.get(comp) ? 'skin' : `${info.label}#${s}.${comp}`;
    };
    return all.map((st, f) => {
      const frame = frames[f];
      const poked = new Float32Array(ref.total);
      const pokeN = new Float32Array(ref.total * 3);
      const pokeLabel = new Map();
      const pairs = new Map();
      for (let i = 0; i < st.v.length; i += 1) {
        const v = st.v[i], B = st.s[i], along = st.d[i];
        if (along <= TOL) continue;
        const A = surfaceOfVertex(v);
        const bone = boneOfVertex(v);
        const ka = kindOfSurface(A);
        if ((ka === 'skin' || ka === 'hair') && !adjacent(bone, st.b[i])) continue;
        const wasIn = refIn.has(v * 65536 + B);
        const kb = kindOfSurface(B);
        const counted = innerTo(A, B, bone) || (wasIn && kb === 'other' && (ka !== 'other' || !outerTo(A, B, bone)));
        if (!counted) continue;
        if (along > poked[v]) { for (let k = 0; k < 3; k += 1) pokeN[v * 3 + k] = st.n[i * 3 + k]; if (keepPoints) pokeLabel.set(v, `${label(A)} > ${label(B)}`); }
        poked[v] = Math.max(poked[v], along);
        const k = `${label(A)} > ${label(B)} @${BONES[bone] ?? '?'}`;
        pairs.set(k, (pairs.get(k) ?? 0) + 1);
      }
      let pokeArea = 0, deep = 0;
      const byBone = {};
      const points = [];
      frame.sources.forEach((source, s) => {
        const { tris, bone } = source.info;
        const pos = source.pos;
        const o = ref.offsets[s];
        for (let t = 0; t < tris.length; t += 3) {
          const a = tris[t], b = tris[t + 1], c = tris[t + 2];
          const np = (poked[o + a] > 0) + (poked[o + b] > 0) + (poked[o + c] > 0);
          if (!np) continue;
          const e1 = [pos[b * 3] - pos[a * 3], pos[b * 3 + 1] - pos[a * 3 + 1], pos[b * 3 + 2] - pos[a * 3 + 2]];
          const e2 = [pos[c * 3] - pos[a * 3], pos[c * 3 + 1] - pos[a * 3 + 1], pos[c * 3 + 2] - pos[a * 3 + 2]];
          const area = 0.5 * Math.hypot(e1[1] * e2[2] - e1[2] * e2[1], e1[2] * e2[0] - e1[0] * e2[2], e1[0] * e2[1] - e1[1] * e2[0]) * 1e4;
          if (area > 200) continue;
          pokeArea += (area * np) / 3;
          const name = BONES[bone[a]] ?? '?';
          byBone[name] = (byBone[name] ?? 0) + (area * np) / 3;
          if (Math.max(poked[o + a], poked[o + b], poked[o + c]) > 0.003) deep += (area * np) / 3;
        }
        if (keepPoints) for (let v = 0; v < source.info.drawn.length; v += 1) if (poked[o + v] > 0) points.push([+source.pos[v * 3].toFixed(4), +source.pos[v * 3 + 1].toFixed(4), +source.pos[v * 3 + 2].toFixed(4), +poked[o + v].toFixed(4), source.info.bone[v], [0, 1, 2].map((k) => +pokeN[(o + v) * 3 + k].toFixed(3)), pokeLabel.get(o + v)]);
      });
      const top = [...pairs].sort((x, y) => y[1] - x[1]).slice(0, 8);
      return { frame: f, poke: +pokeArea.toFixed(2), deep: +deep.toFixed(2), byBone: Object.fromEntries(Object.entries(byBone).map(([k, v]) => [k, +v.toFixed(2)]).sort((x, y) => y[1] - x[1])), top, ...(keepPoints ? { points } : {}) };
    });
  }


  // A picture of man `viewIndex` from `yaw` (rad round him, 0 his front), `points` marked red (poked) at their place.
  function picture(points = [], { viewIndex = 0, yaw = 0, width = 480, height = 720, distance = 2.3, height0 = 1.05, fov = 40, focus = null, from = null, marker = 0.0045 } = {}) {
    const scene = boxer.scene;
    const renderer = scene.renderer;
    const fighter = boxer.state.world.fighters[viewIndex];
    const pelvis = fighter.x?.[0] ? null : null;
    const view = boxer.state.views[viewIndex];
    const meanOf = (f) => {
      const c = new THREE.Vector3();
      const n = f.x.length / 3;
      for (let i = 0; i < n; i += 1) c.add(new THREE.Vector3(f.x[i * 3], f.x[i * 3 + 1], f.x[i * 3 + 2]));
      return c.multiplyScalar(1 / n);
    };
    const centre = focus ? new THREE.Vector3(...focus) : meanOf(fighter);
    const otherFighter = boxer.state.world.fighters.find((_, i) => i !== viewIndex);
    const facing = otherFighter ? meanOf(otherFighter).sub(meanOf(fighter)) : new THREE.Vector3(1, 0, 0);
    facing.y = 0;
    facing.normalize();
    const side = new THREE.Vector3(-facing.z, 0, facing.x);
    const dir = from ? new THREE.Vector3(...from).normalize() : facing.clone().multiplyScalar(Math.cos(yaw)).add(side.multiplyScalar(Math.sin(yaw)));
    const cam = new THREE.PerspectiveCamera(fov, width / height, 0.05, 100);
    cam.position.copy(centre).addScaledVector(dir, distance);
    if (!focus) cam.position.y = height0 + 0.25;
    cam.lookAt(focus ? centre : new THREE.Vector3(centre.x, height0, centre.z));
    cam.updateMatrixWorld(true);
    let markers = null;
    if (points.length) {
      markers = new THREE.InstancedMesh(new THREE.SphereGeometry(marker, 6, 4), new THREE.MeshBasicMaterial({ color: 0x00ff40, depthTest: true }), points.length);
      const m = new THREE.Matrix4();
      points.forEach((p, i) => markers.setMatrixAt(i, m.makeTranslation(p[0], p[1], p[2])));
      markers.frustumCulled = false;
      scene.scene.add(markers);
    }
    const hidden = boxer.state.views.filter((v, i) => i !== viewIndex && v.group.visible);
    hidden.forEach((v) => (v.group.visible = false));
    const target = new THREE.WebGLRenderTarget(width, height, { samples: 4 });
    const saved = renderer.getRenderTarget();
    renderer.setRenderTarget(target);
    renderer.render(scene.scene, cam);
    const pixels = new Uint8Array(width * height * 4);
    renderer.readRenderTargetPixels(target, 0, 0, width, height, pixels);
    renderer.setRenderTarget(saved);
    target.dispose();
    hidden.forEach((v) => (v.group.visible = true));
    if (markers) {
      scene.scene.remove(markers);
      markers.geometry.dispose();
      markers.material.dispose();
    }
    const canvas = document.createElement('canvas');
    canvas.width = width;
    canvas.height = height;
    const ctx = canvas.getContext('2d');
    const image = ctx.createImageData(width, height);
    for (let y = 0; y < height; y += 1) image.data.set(pixels.subarray((height - 1 - y) * width * 4, (height - y) * width * 4), y * width * 4);
    ctx.putImageData(image, 0, 0);
    return canvas.toDataURL('image/png');
  }

  return { picture, capture, analyse, states, drawnMeshes, standIns };
})();
return 'ok';
