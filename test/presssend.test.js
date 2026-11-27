// The pressed-ground record sent to the card by what changed (src/env/press.js envPressSend): the rows a body wrote, as
// runs of whole rows, and the columns wiped as the record is carried, as one-texel strips; the whole record by three's own
// upload when it was wiped, when the card has not had it yet, or where a strip cannot be sent alone (WebGL1). Over a
// stand-in for three.js and a recording WebGL context.
import test from 'node:test';
import assert from 'node:assert/strict';

class Vector4 {
  constructor(x, y, z, w) {
    Object.assign(this, { x, y, z, w });
  }
  set(x, y, z, w) {
    Object.assign(this, { x, y, z, w });
    return this;
  }
}
class DataTexture {
  constructor(data, width, height) {
    Object.assign(this, { image: { data, width, height }, version: 0, unpackAlignment: 4 });
  }
  set needsUpdate(value) {
    if (value) this.version += 1;
  }
}
globalThis.THREE = { DataTexture, Vector4, RGBAFormat: 1023, LinearFilter: 1006, RepeatWrapping: 1000 };
const { ENV_PRESS, envPressForget, envPressRecord, envPressSet, envPressStep } = await import('../src/env/press.js');
const { P } = await import('../src/body.js');

/** A renderer whose card has the record as it was last uploaded whole, recording what is sent after. */
function recordingRenderer({ webgl2 = true } = {}) {
  const calls = [];
  const press = envPressRecord();
  const handle = {};
  const store = { __webglTexture: handle, __version: press.texture.version };
  const gl = {
    TEXTURE_2D: 3553, RGBA: 6408, UNSIGNED_BYTE: 5121, UNPACK_ROW_LENGTH: 3314, UNPACK_SKIP_PIXELS: 3316, UNPACK_FLIP_Y_WEBGL: 37440, UNPACK_PREMULTIPLY_ALPHA_WEBGL: 37441, UNPACK_ALIGNMENT: 3317,
    isContextLost: () => false,
    pixelStorei: (name, value) => calls.push(['store', name, value]),
    texSubImage2D: (target, level, x, y, width, height, format, type, data) => calls.push(['sub', x, y, width, height, data.length]),
  };
  return {
    calls, store,
    renderer: { properties: { get: () => store }, getContext: () => gl, state: { bindTexture: (target, texture) => calls.push(['bind', texture === handle]) }, capabilities: { isWebGL2: webgl2 } },
    // The card brought up to date by three's own whole upload.
    uploaded() {
      store.__version = press.texture.version;
    },
  };
}

function standing(x, z) {
  const fighter = { id: 1, x: new Float64Array(45), v: new Float64Array(45), radius: new Array(15).fill(0.06), yaw: 0 };
  const at = { head: [0, 1.65, 0], neck: [0, 1.45, 0], lShoulder: [0, 1.4, 0.2], rShoulder: [0, 1.4, -0.2], lElbow: [0.1, 1.15, 0.25], rElbow: [0.1, 1.15, -0.25], lHand: [0.3, 1.2, 0.15], rHand: [0.3, 1.2, -0.15], pelvis: [0, 0.95, 0], lHip: [0, 0.9, 0.1], rHip: [0, 0.9, -0.1], lKnee: [0.05, 0.5, 0.11], rKnee: [0.05, 0.5, -0.11], lFoot: [0, 0.045, 0.12], rFoot: [0, 0.045, -0.12] };
  for (const [name, [px, py, pz]] of Object.entries(at)) fighter.x.set([x + px, py, z + pz], P[name] * 3);
  fighter.radius[P.lFoot] = fighter.radius[P.rFoot] = 0.045;
  return fighter;
}

test('a fight begun is sent whole; then only the rows written are, as runs of whole rows', () => {
  envPressSet(true);
  envPressForget();
  const { renderer, calls, uploaded } = recordingRenderer();
  const man = standing(3, 2);
  const world = { time: 1, fighters: [man] };
  const press = envPressRecord();
  const was = press.texture.version;
  envPressStep({ world, lead: man, renderer });
  assert.ok(press.texture.version > was, 'the first frame: three sends it whole');
  assert.equal(calls.filter((call) => call[0] === 'sub').length, 0);
  uploaded();
  // Another man comes up beside him (the record not carried): his soles write new texels; only those rows go.
  const other = standing(4, 2.6);
  other.id = 2;
  world.fighters.push(other);
  world.time = 1.02;
  const version = press.texture.version;
  envPressStep({ world, lead: man, renderer });
  assert.equal(press.texture.version, version, 'not sent whole');
  const sent = calls.filter((call) => call[0] === 'sub');
  assert.ok(sent.length >= 1 && sent.every(([, x, , width, height, length]) => x === 0 && width === ENV_PRESS.size && length === width * height * 4), 'whole rows, each run its own stretch of the bytes');
  const rows = sent.reduce((sum, call) => sum + call[4], 0);
  assert.ok(rows > 0 && rows < 40, `a few rows (${rows}), not ${ENV_PRESS.size}`);
  assert.ok(calls.some((call) => call[0] === 'bind' && call[1]), 'into the record\'s own texture');
});

test('the columns wiped as the record is carried go as one-texel strips (WebGL2), the whole record on WebGL1', () => {
  for (const webgl2 of [true, false]) {
    envPressSet(true);
    envPressForget();
    const { renderer, calls, uploaded } = recordingRenderer({ webgl2 });
    const man = standing(3, 2);
    const world = { time: 1, fighters: [man] };
    const press = envPressRecord();
    envPressStep({ world, lead: man, renderer });
    uploaded();
    // His hips carried three texels along x: three columns come round to the ground ahead.
    for (let at = 0; at < 15; at += 1) man.x[at * 3] += ENV_PRESS.texel * 3;
    world.time = 1.02;
    const version = press.texture.version;
    envPressStep({ world, lead: man, renderer });
    const strips = calls.filter((call) => call[0] === 'sub' && call[3] === 1);
    if (webgl2) {
      assert.equal(press.texture.version, version);
      assert.equal(strips.length, 3);
      assert.ok(strips.every(([, , y, , height]) => y === 0 && height === ENV_PRESS.size));
      const rowLength = calls.filter((call) => call[0] === 'store' && call[1] === 3314).map((call) => call[2]);
      assert.deepEqual([rowLength[0], rowLength.at(-1)], [ENV_PRESS.size, 0], 'the unpack row length put back after');
    } else {
      assert.equal(strips.length, 0);
      assert.ok(press.texture.version > version, 'sent whole');
    }
  }
});
