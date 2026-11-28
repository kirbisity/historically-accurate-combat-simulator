// The face customizer's studio: one renderer on the screen's canvas, a dark backdrop, three lights (a warm key, a cool low
// fill, a hard rim from behind) so the big shapes read in the key's falloff and the fine relief of the skin's normal map in
// the rim's raking edge; a small orbit of its own (drag to turn, wheel or pinch to come closer), the three snap views, and the
// Similar Faces thumbnails, drawn by the same renderer into one small target and copied out (no second WebGL context).

/* global THREE */
import { buildCustomHead } from './core.js';

export const FACE_STAGE = {
  // The backdrop: a soft pool of light behind the head in the game's warm black (boxer.css --bg), falling to near black.
  backdrop: { inner: '#2a241c', outer: '#060504', size: 512 },
  // Key: warm, above and to the camera's left, the strongest; it carries the head's big shapes.
  key: { color: 0xffe6c8, intensity: 1.7, at: [0.9, 0.7, 0.75] },
  // Fill: cool and low from the other side, a fifth of the key, so the shadow side keeps its form without going flat.
  fill: { color: 0x9fb4d8, intensity: 0.42, at: [0.6, -0.15, -0.9] },
  // Rim: hard white from behind and above, brighter than the key, grazing the silhouette where the normal map's relief shows.
  rim: { color: 0xffffff, intensity: 2.6, at: [-0.9, 0.55, -0.35] },
  // A trace of sky and ground light so no side is pure black.
  ambient: { sky: 0x3a3a44, ground: 0x15110c, intensity: 0.28 },
  // Tone mapping: the lights above are set for ACES at this exposure.
  exposure: 1.05,
  // The camera: a portrait lens, the head framed to this share of the view's height at the starting distance.
  fov: 30,
  frame: 1.55,
  zoom: { min: 0.45, max: 2.6 },
  // The orbit: radians a drag of one pixel turns, how far above or below the head it may look, and the snap's ease (per second).
  turnPerPixel: 0.008,
  pitch: { min: -0.9, max: 1.1 },
  snapRate: 9,
  // The snap views' bearings from the face (0: straight on), in radians round to the head's left; a three-quarter and a profile.
  views: { front: 0, threeQuarter: Math.PI / 4, side: Math.PI / 2 },
  // The head's forward axis, as the game's heads are built (face.js: x forward, y up, z to the left).
  forward: [1, 0, 0],
  // The Similar Faces thumbnails: their size in pixels (drawn once per variation into one target, then copied to each canvas).
  thumb: 128,
  // A three-quarter view for the thumbnails, so the profile and the front both read at that size, closer in than the main view's start.
  thumbView: { yaw: 0.5, pitch: 0.08, zoom: 0.72 },
  // Device pixel ratio's cap: past two the head gains nothing a phone's eye can see, and costs four times the pixels.
  maxPixelRatio: 2,
};

/** The backdrop as a texture: a radial pool of warm light behind the head, drawn once. */
function faceBackdrop() {
  const { inner, outer, size } = FACE_STAGE.backdrop;
  const canvas = document.createElement('canvas');
  canvas.width = canvas.height = size;
  const context = canvas.getContext('2d');
  const gradient = context.createRadialGradient(size * 0.5, size * 0.42, 0, size * 0.5, size * 0.5, size * 0.72);
  gradient.addColorStop(0, inner);
  gradient.addColorStop(1, outer);
  context.fillStyle = gradient;
  context.fillRect(0, 0, size, size);
  const texture = new THREE.CanvasTexture(canvas);
  texture.encoding = THREE.sRGBEncoding;
  return texture;
}

/** The three lights and the ambient, placed round the head's forward axis (`at`: forward, up, left as shares of a unit). */
function faceLights(scene) {
  const forward = new THREE.Vector3(...FACE_STAGE.forward);
  const left = new THREE.Vector3(0, 1, 0).cross(forward).normalize();
  const place = (light, [ahead, up, side]) => {
    light.position.copy(forward).multiplyScalar(ahead).addScaledVector(left, side).add(new THREE.Vector3(0, up, 0)).multiplyScalar(2);
    scene.add(light, light.target);
    return light;
  };
  const { key, fill, rim, ambient } = FACE_STAGE;
  return {
    key: place(new THREE.DirectionalLight(key.color, key.intensity), key.at),
    fill: place(new THREE.DirectionalLight(fill.color, fill.intensity), fill.at),
    rim: place(new THREE.DirectionalLight(rim.color, rim.intensity), rim.at),
    ambient: scene.add(new THREE.HemisphereLight(ambient.sky, ambient.ground, ambient.intensity)),
  };
}

/**
 * The studio on `canvas`, with `face` on its head; `insets()` the pixels at the canvas's right and bottom that the sidebar
 * covers, so the head is centred in what is left (the camera's view shifted, not the canvas shrunk). Returns { setFace(face), snap(view), thumbnails(faces, canvases), resize(),
 * view (the orbit, for tests: { yaw, pitch, zoom }), dispose() }.
 */
export function faceStage(canvas, face, { insets = () => ({ right: 0, bottom: 0 }) } = {}) {
  const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: false, preserveDrawingBuffer: true });
  renderer.outputEncoding = THREE.sRGBEncoding;
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = FACE_STAGE.exposure;
  renderer.setPixelRatio(Math.min(globalThis.devicePixelRatio || 1, FACE_STAGE.maxPixelRatio));
  const scene = new THREE.Scene();
  scene.background = faceBackdrop();
  faceLights(scene);
  const camera = new THREE.PerspectiveCamera(FACE_STAGE.fov, 1, 0.01, 20);
  let head = buildCustomHead(face, { detail: 'full' });
  scene.add(head.group);
  // The orbit's centre and distance, from the head's own size (any head the core builds is framed alike).
  const bounds = new THREE.Box3().setFromObject(head.group);
  const centre = bounds.getCenter(new THREE.Vector3());
  const extent = bounds.getSize(new THREE.Vector3());
  const radius = Math.max(extent.x, extent.y, extent.z, 0.1) / 2;
  const distance = (radius * FACE_STAGE.frame) / Math.tan(THREE.MathUtils.degToRad(FACE_STAGE.fov / 2));
  const view = { yaw: FACE_STAGE.views.threeQuarter, pitch: 0.05, zoom: 1, aim: null };
  const forward = new THREE.Vector3(...FACE_STAGE.forward);
  const left = new THREE.Vector3(0, 1, 0).cross(forward).normalize();

  function placeCamera(target, { yaw, pitch, zoom }) {
    const flat = Math.cos(pitch) * distance * zoom;
    target.position.copy(centre).addScaledVector(forward, Math.cos(yaw) * flat).addScaledVector(left, Math.sin(yaw) * flat);
    target.position.y += Math.sin(pitch) * distance * zoom;
    target.lookAt(centre);
  }

  // ---- The orbit: one finger or the mouse turns, two fingers pinch, the wheel zooms -------------------------------------
  const pointers = new Map();
  let pinchFrom = null;
  const clampView = () => {
    view.pitch = Math.max(FACE_STAGE.pitch.min, Math.min(FACE_STAGE.pitch.max, view.pitch));
    view.zoom = Math.max(FACE_STAGE.zoom.min, Math.min(FACE_STAGE.zoom.max, view.zoom));
  };
  const spread = () => {
    const [a, b] = [...pointers.values()];
    return Math.hypot(a.x - b.x, a.y - b.y);
  };
  const onDown = (event) => {
    canvas.setPointerCapture?.(event.pointerId);
    pointers.set(event.pointerId, { x: event.clientX, y: event.clientY });
    view.aim = null;
    pinchFrom = pointers.size === 2 ? { spread: spread(), zoom: view.zoom } : null;
  };
  const onMove = (event) => {
    const was = pointers.get(event.pointerId);
    if (!was) return;
    const now = { x: event.clientX, y: event.clientY };
    pointers.set(event.pointerId, now);
    if (pointers.size === 2 && pinchFrom) {
      view.zoom = pinchFrom.zoom * (pinchFrom.spread / Math.max(spread(), 1));
    } else if (pointers.size === 1) {
      view.yaw -= (now.x - was.x) * FACE_STAGE.turnPerPixel;
      view.pitch += (now.y - was.y) * FACE_STAGE.turnPerPixel;
    }
    clampView();
    draw();
  };
  const onUp = (event) => {
    pointers.delete(event.pointerId);
    pinchFrom = null;
  };
  const onWheel = (event) => {
    event.preventDefault();
    view.zoom *= Math.exp(event.deltaY * (event.ctrlKey ? 0.015 : 0.0015));
    clampView();
    draw();
  };
  canvas.addEventListener('pointerdown', onDown);
  canvas.addEventListener('pointermove', onMove);
  canvas.addEventListener('pointerup', onUp);
  canvas.addEventListener('pointercancel', onUp);
  canvas.addEventListener('wheel', onWheel, { passive: false });

  // ---- Drawing: on demand (a change, a drag), and every frame only while a snap is easing in ------------------------------
  let frame = 0;
  let last = 0;
  function draw() {
    if (!frame) frame = requestAnimationFrame(tick);
  }
  function tick(time) {
    frame = 0;
    const dt = last ? Math.min((time - last) / 1000, 0.1) : 1 / 60;
    last = time;
    if (view.aim) {
      const ease = 1 - Math.exp(-FACE_STAGE.snapRate * dt);
      let turn = view.aim.yaw - view.yaw;
      turn = Math.atan2(Math.sin(turn), Math.cos(turn));
      view.yaw += turn * ease;
      view.pitch += (view.aim.pitch - view.pitch) * ease;
      view.zoom += (view.aim.zoom - view.zoom) * ease;
      if (Math.abs(turn) + Math.abs(view.aim.pitch - view.pitch) + Math.abs(view.aim.zoom - view.zoom) < 1e-3) {
        Object.assign(view, view.aim, { aim: null });
        last = 0;
      } else draw();
    } else last = 0;
    placeCamera(camera, view);
    renderer.render(scene, camera);
  }

  function resize() {
    const width = Math.max(canvas.clientWidth, 1);
    const height = Math.max(canvas.clientHeight, 1);
    renderer.setSize(width, height, false);
    const { right = 0, bottom = 0 } = insets() ?? {};
    const side = Math.max(0, Math.min(right, width * 0.6));
    const below = Math.max(0, Math.min(bottom, height * 0.7));
    camera.aspect = (width + side) / (height + below);
    // (A frame wider and taller than the canvas, the canvas its top right: the frame's centre, where the head is, lands in the
    // middle of the part not covered. The lens widened with it, so the head fills the part left as it would the whole canvas.)
    camera.fov = THREE.MathUtils.radToDeg(2 * Math.atan(Math.tan(THREE.MathUtils.degToRad(FACE_STAGE.fov / 2)) * (height + below) / Math.max(height - below, 1)));
    if (side || below) camera.setViewOffset(width + side, height + below, side, below, width, height);
    else camera.clearViewOffset();
    camera.updateProjectionMatrix();
    draw();
  }
  const observer = globalThis.ResizeObserver ? new ResizeObserver(resize) : null;
  observer?.observe(canvas);
  resize();

  // ---- The thumbnails: a second head, never in the main scene, posed and drawn per face into one small target -------------
  let thumbs = null;
  function thumbnails(faces, canvases) {
    const size = FACE_STAGE.thumb;
    if (!thumbs) {
      const thumbScene = new THREE.Scene();
      thumbScene.background = scene.background;
      faceLights(thumbScene);
      const thumbHead = buildCustomHead(faces[0], { detail: 'thumb' });
      thumbScene.add(thumbHead.group);
      const target = new THREE.WebGLRenderTarget(size, size, { encoding: THREE.sRGBEncoding });
      const thumbCamera = new THREE.PerspectiveCamera(FACE_STAGE.fov, 1, 0.01, 20);
      placeCamera(thumbCamera, FACE_STAGE.thumbView);
      thumbs = { scene: thumbScene, head: thumbHead, target, camera: thumbCamera, pixels: new Uint8Array(size * size * 4), image: new ImageData(size, size) };
    }
    faces.forEach((each, index) => {
      const canvasOut = canvases[index];
      if (!canvasOut) return;
      thumbs.head.setFace(each);
      renderer.setRenderTarget(thumbs.target);
      renderer.render(thumbs.scene, thumbs.camera);
      renderer.readRenderTargetPixels(thumbs.target, 0, 0, size, size, thumbs.pixels);
      // (The target's rows run bottom up; a canvas's top down.)
      const row = size * 4;
      for (let y = 0; y < size; y += 1) thumbs.image.data.set(thumbs.pixels.subarray((size - 1 - y) * row, (size - y) * row), y * row);
      canvasOut.width = canvasOut.height = size;
      canvasOut.getContext('2d').putImageData(thumbs.image, 0, 0);
    });
    renderer.setRenderTarget(null);
    draw();
  }

  return {
    view,
    setFace(next) {
      head.setFace(next);
      draw();
    },
    setExpression(weights) {
      head.setExpression?.(weights);
      draw();
    },
    /** Ease round to a named view (FACE_STAGE.views), level, at the starting distance. */
    snap(name) {
      if (!(name in FACE_STAGE.views)) return;
      view.aim = { yaw: FACE_STAGE.views[name], pitch: 0.05, zoom: 1 };
      draw();
    },
    thumbnails,
    resize,
    dispose() {
      cancelAnimationFrame(frame);
      observer?.disconnect();
      canvas.removeEventListener('pointerdown', onDown);
      canvas.removeEventListener('pointermove', onMove);
      canvas.removeEventListener('pointerup', onUp);
      canvas.removeEventListener('pointercancel', onUp);
      canvas.removeEventListener('wheel', onWheel);
      head.dispose();
      head = null;
      if (thumbs) {
        thumbs.head.dispose();
        thumbs.target.dispose();
      }
      scene.background.dispose();
      renderer.dispose();
      renderer.forceContextLoss?.();
    },
  };
}
