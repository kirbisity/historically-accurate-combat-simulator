// Blood, drawn: drops in the air, the stains they leave, and the pools a bleeding body lies in.
//
// All of it follows the blood the simulation says was lost (fighter.bloodLost, a share of maiming.js bloodMl): each
// millilitre that leaves a body leaves it at a place (the cut end of a trunk, a stump, the wound last opened), falls as
// drops while that place is off the ground and runs straight into a pool when it lies on it. A pool's area is its
// volume over what a litre covers on that ground: a film about a millimetre deep on stone or boards, where it lies wet
// and glossy; on sand, soil or grass it sinks in (a litre wets the top centimetre of a third of a square metre) and shows as a dark matt stain with a wet middle only while it is still being fed. So a trunk or a neck cut
// (litres in seconds) lays a pool a metre across and a nicked forearm a few spots.
//
// Budgets: everything is instanced or one mesh, in stores made once (BLOOD_VIEW.budgets, by quality tier); a full
// store recycles its oldest or smallest. Nothing is allocated on a frame.

/* global THREE */
import { P } from './body.js';
import { floorUnder } from './physics.js';
import { bloodMl } from './maiming.js';
import { surfaceAt } from './audio/surface.js';
import { bloodDyeClear, bloodDyeCreate, bloodDyeLand, bloodDyeUpload } from './blooddye.js';

export const BLOOD_VIEW = {
  // Drops in the air, stains on the ground, pools, and the drops a second one bleeding man may shed (the rest of his
  // flow goes to the ground under him unseen); `far`: beyond this (m) from the camera no drops are thrown at all.
  budgets: {
    high: { drops: 1400, stains: 1600, pools: 72, drips: 16, far: 45 },
    medium: { drops: 700, stains: 800, pools: 40, drips: 8, far: 30 },
    low: { drops: 220, stains: 260, pools: 18, drips: 3, far: 18 },
  },
  // m2 a litre covers: lying on a hard floor (a film ~1.1 mm deep), soaked into a porous one (the top centimetre of sand, a third of it pores).
  spread: { hard: 0.9, soak: 0.3 },
  hard: ['stone', 'wood', 'tile'],
  // A pool: spokes round it and rings out; never wider than `most` m; redrawn when it has grown by `grown`.
  spokes: 28, rings: [0, 0.45, 0.75, 0.9, 1], most: 1.7, grown: 1.03, perFrame: 6,
  // A drop landing with this much (ml) or more starts a pool of its own; less, it is a stain.
  poolFrom: 5,
  // The least a shed drop carries (ml): what is drawn is a gout, not a real drop of a twentieth of a millilitre.
  dropMl: 1.2,
  // Past this share of his blood out, a body has no more to give the ground (the rest stays in its tissue).
  most: 0.7,
  // Off the ground by this (m), a wound sheds drops; lower, it runs into the pool under it.
  dripAbove: 0.22,
  // A flow past `spurtFrom` ml/s is thrown out in beats (`beat` a second), as an opened artery throws it, at up to `spurt` m/s.
  spurtFrom: 25, beat: 2.2, spurt: 3.2,
  lift: 0.006,
  // The speed (m/s) of a blade that went through a trunk, for what it throws (its event keeps only the way it went).
  cutSpeed: 9,
};

const DROP = 7;
const bloodScratch = { normal: [0, 1, 0] };
const bloodNoise = (x, y) => {
  const s = Math.sin(x * 127.1 + y * 311.7) * 43758.5453;
  return s - Math.floor(s);
};

/** The splats a stain is drawn with: `cells` x `cells` shapes in one map (a blot with a ragged edge and its satellites; half of them drawn out with a tail). */
function bloodSplatAtlas(cells = 4, size = 64) {
  const width = cells * size;
  const data = new Uint8Array(width * width * 4);
  for (let cell = 0; cell < cells * cells; cell += 1) {
    const [cx, cy] = [cell % cells, Math.floor(cell / cells)];
    const tail = cell % 2 === 1;
    const satellites = [];
    for (let k = 0; k < 3 + (cell % 4); k += 1) {
      const angle = bloodNoise(cell, k) * Math.PI * 2;
      const reach = 0.5 + 0.4 * bloodNoise(cell + 9, k);
      satellites.push([Math.cos(angle) * reach, Math.sin(angle) * reach * (tail ? 0.5 : 1), 0.03 + 0.07 * bloodNoise(cell + 17, k)]);
    }
    for (let y = 0; y < size; y += 1) {
      for (let x = 0; x < size; x += 1) {
        const u = ((x + 0.5) / size) * 2 - 1;
        const v = ((y + 0.5) / size) * 2 - 1;
        // The blot: its edge in and out by the angle; a tail runs out along +u.
        const angle = Math.atan2(v, u);
        const lobes = 0.42 + 0.1 * Math.sin(angle * 3 + cell) + 0.07 * Math.sin(angle * 7 + cell * 2.3) + 0.04 * Math.sin(angle * 13 + cell * 5.1);
        let inside = lobes - Math.hypot(u * (tail ? 1.25 : 1), v);
        if (tail && u > 0) inside = Math.max(inside, 0.16 * (1 - u) - Math.abs(v) + 0.02);
        for (const [sx, sy, sr] of satellites) inside = Math.max(inside, sr - Math.hypot(u - sx, v - sy));
        const alpha = Math.max(0, Math.min(1, inside / 0.05));
        const at = ((cy * size + y) * width + cx * size + x) * 4;
        data[at] = data[at + 1] = data[at + 2] = Math.round(alpha * 255);
        data[at + 3] = 255;
      }
    }
  }
  const texture = new THREE.DataTexture(data, width, width, THREE.RGBAFormat);
  texture.magFilter = THREE.LinearFilter;
  texture.minFilter = THREE.LinearFilter;
  texture.needsUpdate = true;
  return texture;
}

// What blood looks like on the ground, from how far it has sunk in (`soak`: 1 sand, 0 stone) and how wet it still is
// (`wet`: 1 fresh or fed, 0 dried): the colour (linear) and the roughness. Shared by the stains and the pools.
const BLOOD_GLSL = `
vec3 bloodTone( float soak, float wet, float deep ) {
	vec3 lying = mix( vec3( 0.07, 0.008, 0.008 ), vec3( 0.2, 0.006, 0.01 ), wet );
	vec3 sunk = mix( vec3( 0.1, 0.017, 0.013 ), vec3( 0.17, 0.008, 0.012 ), wet );
	return mix( lying, sunk, soak ) * mix( 1.0, 0.4, deep );
}
float bloodRough( float soak, float wet, float deep ) {
	return mix( mix( 0.5, 0.1, wet ), mix( 1.0, mix( 0.9, 0.16, deep ), wet ), soak );
}
float bloodHash( vec2 p ) { return fract( sin( dot( p, vec2( 127.1, 311.7 ) ) ) * 43758.5453 ); }
float bloodValue( vec2 p ) {
	vec2 i = floor( p ); vec2 f = fract( p ); f = f * f * ( 3.0 - 2.0 * f );
	return mix( mix( bloodHash( i ), bloodHash( i + vec2( 1.0, 0.0 ) ), f.x ), mix( bloodHash( i + vec2( 0.0, 1.0 ) ), bloodHash( i + vec2( 1.0, 1.0 ) ), f.x ), f.y );
}`;

function bloodStainMaterial(time) {
  const material = new THREE.MeshStandardMaterial({ color: 0xffffff, alphaMap: bloodSplatAtlas(), transparent: true, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2, metalness: 0 });
  material.onBeforeCompile = (shader) => {
    shader.uniforms.uBloodTime = time;
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', '#include <common>\nattribute vec4 aStain;\nvarying vec3 vStain;\nuniform float uBloodTime;')
      .replace('#include <uv_vertex>', '#include <uv_vertex>\nvUv = ( uv + aStain.xy ) * 0.25;\nvStain = vec3( aStain.z, 1.0 - smoothstep( 6.0, 40.0, uBloodTime - aStain.w ), 0.0 );');
    shader.fragmentShader = shader.fragmentShader
      .replace('#include <common>', `#include <common>\nvarying vec3 vStain;${BLOOD_GLSL}`)
      .replace('#include <color_fragment>', '#include <color_fragment>\ndiffuseColor.rgb = bloodTone( vStain.x, vStain.y, 0.0 );')
      .replace('#include <roughnessmap_fragment>', '#include <roughnessmap_fragment>\nroughnessFactor = bloodRough( vStain.x, vStain.y, 0.0 );');
  };
  material.customProgramCacheKey = () => 'blood-stain';
  return material;
}

function bloodPoolMaterial(time) {
  const material = new THREE.MeshStandardMaterial({ color: 0xffffff, transparent: true, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -3, polygonOffsetUnits: -3, metalness: 0 });
  material.onBeforeCompile = (shader) => {
    shader.uniforms.uBloodTime = time;
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', '#include <common>\nattribute vec4 aPool;\nattribute vec2 aRing;\nvarying vec4 vPool;\nvarying vec4 vPoolAt;\nuniform float uBloodTime;')
      .replace('#include <begin_vertex>', '#include <begin_vertex>\nvPool = vec4( aPool.x, 1.0 - smoothstep( 5.0, 30.0, uBloodTime - aPool.y ), aPool.z, aRing.y );\nvPoolAt = vec4( position.xz, aRing.x, aPool.w );');
    shader.fragmentShader = shader.fragmentShader
      .replace('#include <common>', `#include <common>\nvarying vec4 vPool;\nvarying vec4 vPoolAt;${BLOOD_GLSL}`)
      .replace('#include <color_fragment>', `#include <color_fragment>
	float poolR = vPool.w;
	// The edge: ragged at two sizes (the run of the liquid, the grain it soaks along).
	float poolBroad = bloodValue( vPoolAt.xy * 7.0 + vPool.z );
	float poolFine = bloodValue( vPoolAt.xy * 46.0 + vPool.z * 3.0 );
	float poolEdge = 0.86 + 0.13 * poolBroad - 0.07 * poolFine * vPool.x;
	float poolIn = 1.0 - smoothstep( poolEdge - mix( 0.015, 0.09, vPool.x ), poolEdge, poolR );
	// The middle, where it stands deepest: wet and dark. Sunk into the ground it is only so while it is fed.
	float poolCore = 1.0 - smoothstep( 0.35 + 0.25 * poolBroad, 0.72 + 0.2 * poolBroad, poolR );
	float poolWet = mix( 1.0, vPool.y * poolCore, vPool.x );
	// (On a hard floor a meniscus: the rim a little darker than the sheet.)
	float poolRim = ( 1.0 - vPool.x ) * smoothstep( poolEdge - 0.08, poolEdge - 0.02, poolR );
	diffuseColor.rgb = bloodTone( vPool.x, poolWet, max( poolCore * 0.8, poolRim * 0.5 ) );
	// The soaked edge thins out into the sand; flecks of dry grain show through it.
	diffuseColor.a = poolIn * mix( 0.97, mix( 0.86, 0.97, poolCore ) - 0.3 * step( 0.8, poolFine ) * ( 1.0 - poolCore ) * smoothstep( poolEdge - 0.3, poolEdge, poolR ), vPool.x );
	float poolGloss = poolWet;`)
      .replace('#include <roughnessmap_fragment>', '#include <roughnessmap_fragment>\nroughnessFactor = bloodRough( vPool.x, poolGloss, poolCore );');
  };
  material.customProgramCacheKey = () => 'blood-pool';
  return material;
}

/** The blood of a scene: its stores, made once (`scene`: what the meshes are put in). */
export function bloodCreate(scene) {
  const most = BLOOD_VIEW.budgets.high;
  const time = { value: 0 };
  const dropMesh = new THREE.InstancedMesh(new THREE.SphereGeometry(1, 6, 4), new THREE.MeshStandardMaterial({ color: 0x5c060b, roughness: 0.18, metalness: 0 }), most.drops);
  dropMesh.count = 0;
  dropMesh.frustumCulled = false;
  const stainGeometry = new THREE.PlaneGeometry(2, 2);
  stainGeometry.rotateX(-Math.PI / 2);
  // (Each stain's cell of the splats: the plane's own coordinates run 0..1.)
  const stainInfo = new THREE.InstancedBufferAttribute(new Float32Array(most.stains * 4), 4);
  stainGeometry.setAttribute('aStain', stainInfo);
  const stainMesh = new THREE.InstancedMesh(stainGeometry, bloodStainMaterial(time), most.stains);
  stainMesh.count = 0;
  stainMesh.frustumCulled = false;
  stainMesh.receiveShadow = true;
  stainMesh.renderOrder = 2;
  // The pools: one mesh, a fan of rings for each.
  const { spokes, rings } = BLOOD_VIEW;
  const per = (spokes + 1) * rings.length;
  const position = new THREE.BufferAttribute(new Float32Array(most.pools * per * 3), 3);
  const normal = new THREE.BufferAttribute(new Float32Array(most.pools * per * 3), 3);
  const ring = new THREE.BufferAttribute(new Float32Array(most.pools * per * 2), 2);
  const info = new THREE.BufferAttribute(new Float32Array(most.pools * per * 4), 4);
  const index = [];
  for (let slot = 0; slot < most.pools; slot += 1) {
    for (let spoke = 0; spoke <= spokes; spoke += 1) {
      for (let k = 0; k < rings.length; k += 1) {
        const vertex = slot * per + spoke * rings.length + k;
        ring.setXY(vertex, spoke / spokes, rings[k]);
        normal.setXYZ(vertex, 0, 1, 0);
        if (spoke === spokes || k === rings.length - 1) continue;
        const next = vertex + rings.length;
        // (Wound so as to face up: the spokes run from +x round towards +z.)
        if (k > 0) index.push(vertex, next, vertex + 1);
        index.push(next, next + 1, vertex + 1);
      }
    }
  }
  const poolGeometry = new THREE.BufferGeometry();
  poolGeometry.setAttribute('position', position);
  poolGeometry.setAttribute('normal', normal);
  poolGeometry.setAttribute('aRing', ring);
  poolGeometry.setAttribute('aPool', info);
  poolGeometry.setIndex(index);
  const poolMesh = new THREE.Mesh(poolGeometry, bloodPoolMaterial(time));
  poolMesh.frustumCulled = false;
  poolMesh.receiveShadow = true;
  poolMesh.renderOrder = 1;
  scene.add(dropMesh, stainMesh, poolMesh);
  const pools = [];
  for (let slot = 0; slot < most.pools; slot += 1) {
    const weights = new Float32Array(spokes);
    pools.push({ slot, active: false, x: 0, z: 0, y: 0, ml: 0, drawn: 0, radius: 0, soak: 1, fedAt: 0, seed: 0, weights, dirty: false });
  }
  return {
    time, clock: 0, budget: most, tier: 'high',
    drops: new Float32Array(most.drops * DROP), dropCount: 0, dropMesh,
    stainMesh, stainInfo, stainNext: 0,
    pools, poolMesh, poolPer: per, poolTurn: 0,
    // Per fighter (by id): the blood already laid down for him (a share), what is owed in drops, where it leaves him (a particle, and the one inward of it).
    lost: new Float32Array(64), owed: new Float32Array(64), site: new Int8Array(64).fill(-1), inward: new Int8Array(64).fill(-1),
    dye: bloodDyeCreate(),
  };
}

/** The budgets by quality tier ('high', 'medium', 'low'): what is already there stays, new blood keeps to the tier. */
export function bloodTier(blood, tier) {
  if (!blood || blood.tier === tier || !BLOOD_VIEW.budgets[tier]) return;
  blood.tier = tier;
  blood.budget = BLOOD_VIEW.budgets[tier];
}

/** All of it gone (a new bout); `keepGround`: only what is in the air. */
export function bloodClear(blood, view, { keepGround = false } = {}) {
  blood.dropCount = 0;
  blood.dropMesh.count = 0;
  blood.owed.fill(0);
  if (keepGround) return;
  blood.lost.fill(0);
  blood.site.fill(-1);
  blood.inward.fill(-1);
  blood.stainNext = 0;
  blood.stainMesh.count = 0;
  for (const pool of blood.pools) {
    if (pool.active) bloodPoolHide(blood, pool);
    pool.active = false;
    pool.ml = 0;
  }
  bloodDyeClear(blood.dye);
  bloodDyeUpload(blood.dye, view.clock ?? 0);
}

/** A drop of `ml` thrown from (x, y, z) at (vx, vy, vz). False when the air holds all it may. */
export function bloodDrop(blood, x, y, z, vx, vy, vz, ml) {
  if (blood.dropCount >= blood.budget.drops) return false;
  const at = blood.dropCount * DROP;
  const drops = blood.drops;
  drops[at] = x;
  drops[at + 1] = y;
  drops[at + 2] = z;
  drops[at + 3] = vx;
  drops[at + 4] = vy;
  drops[at + 5] = vz;
  drops[at + 6] = ml;
  blood.dropCount += 1;
  return true;
}

/**
 * Blood thrown off a cut as the blade goes through: `count` drops from along the wound's line (`edge`, `half` m each way
 * from `at`), each with a share of the blade's travel (`travel`, m/s), a little of the way out of the wound (`normal`) and
 * its own scatter: a sheet of drops along the blade's path that falls in an arc. `ml` in all.
 */
export function bloodSpray(blood, at, travel, normal, edge, half, count, ml) {
  const speed = Math.hypot(travel[0], travel[1], travel[2]);
  const each = ml / Math.max(1, count);
  for (let drop = 0; drop < count; drop += 1) {
    const along = (Math.random() * 2 - 1) * half;
    // (Cast off the blade and out of the wound: from a tenth to about half of the blade's own speed.)
    const share = 0.04 + 0.5 * Math.random() ** 1.5;
    const out = 0.3 + 1.3 * Math.random();
    const scatter = 0.12 * speed * share + 0.3;
    if (!bloodDrop(
      blood, at[0] + edge[0] * along, at[1] + edge[1] * along, at[2] + edge[2] * along,
      travel[0] * share + normal[0] * out + (Math.random() - 0.5) * scatter,
      travel[1] * share + normal[1] * out + (Math.random() - 0.2) * scatter + 0.6,
      travel[2] * share + normal[2] * out + (Math.random() - 0.5) * scatter,
      // (A few gouts among many small drops.)
      each * (0.15 + 3.4 * Math.random() ** 3),
    )) return;
  }
}

/** Where a fighter's blood leaves him from now on: the particle `site` (the stump, the wound), `inward` the one it is thrown away from (-1: it only falls). */
export function bloodSite(blood, id, site, inward = -1) {
  bloodRoom(blood, id);
  blood.site[id] = site;
  blood.inward[id] = inward;
}

function bloodRoom(blood, id) {
  if (id < blood.lost.length) return;
  const size = Math.max(id + 1, blood.lost.length * 2);
  for (const [key, fill] of [['lost', 0], ['owed', 0], ['site', -1], ['inward', -1]]) {
    const grown = new blood[key].constructor(size).fill(fill);
    grown.set(blood[key]);
    blood[key] = grown;
  }
}

const bloodHard = (world, x, y, z) => BLOOD_VIEW.hard.includes(surfaceAt(world, x, y, z));

/** The ground's normal at (x, z) into bloodScratch.normal: up on a flat floor, the land's lie where it has one. */
function bloodGroundNormal(world, x, y, z) {
  const normal = bloodScratch.normal;
  normal[0] = 0;
  normal[1] = 1;
  normal[2] = 0;
  const arena = world?.arena;
  if (!arena?.works && !arena?.terrain) return normal;
  const d = 0.08;
  const sx = floorUnder(arena, z, x + d, y) - floorUnder(arena, z, x - d, y);
  const sz = floorUnder(arena, z + d, x, y) - floorUnder(arena, z - d, x, y);
  // (A step's edge is no slope.)
  if (Math.abs(sx) > d * 1.6 || Math.abs(sz) > d * 1.6) return normal;
  const length = Math.hypot(sx, 2 * d, sz);
  normal[0] = -sx / length;
  normal[1] = (2 * d) / length;
  normal[2] = -sz / length;
  return normal;
}

function bloodPoolHide(blood, pool) {
  const position = blood.poolMesh.geometry.attributes.position;
  position.array.fill(0, pool.slot * blood.poolPer * 3, (pool.slot + 1) * blood.poolPer * 3);
  position.needsUpdate = true;
}

/** A pool's fan laid on the ground again at the size its volume gives it. */
function bloodPoolDraw(blood, pool, world) {
  const { spokes, rings, lift } = BLOOD_VIEW;
  const geometry = blood.poolMesh.geometry;
  const position = geometry.attributes.position.array;
  const info = geometry.attributes.aPool.array;
  const arena = world?.arena;
  const spread = pool.soak ? BLOOD_VIEW.spread.soak : BLOOD_VIEW.spread.hard;
  pool.radius = Math.min(BLOOD_VIEW.most, Math.sqrt(((pool.ml / 1000) * spread) / Math.PI));
  pool.drawn = pool.ml;
  pool.dirty = false;
  // Downhill it runs further (the land's lie under its middle).
  const normal = bloodGroundNormal(world, pool.x, pool.y, pool.z);
  const [slopeX, slopeZ] = [normal[0], normal[2]];
  const base = pool.slot * blood.poolPer;
  for (let spoke = 0; spoke <= spokes; spoke += 1) {
    const angle = (spoke / spokes) * Math.PI * 2;
    const [cos, sin] = [Math.cos(angle), Math.sin(angle)];
    const reach = pool.radius * pool.weights[spoke % spokes] * (1 + 2.5 * (cos * slopeX + sin * slopeZ));
    for (let k = 0; k < rings.length; k += 1) {
      const vertex = base + spoke * rings.length + k;
      const x = pool.x + cos * reach * rings[k];
      const z = pool.z + sin * reach * rings[k];
      position[vertex * 3] = x;
      position[vertex * 3 + 1] = (arena ? floorUnder(arena, z, x, pool.y) : 0) + lift + pool.slot * 0.00004;
      position[vertex * 3 + 2] = z;
      info[vertex * 4] = pool.soak;
      info[vertex * 4 + 1] = pool.fedAt;
      info[vertex * 4 + 2] = pool.seed;
    }
  }
  geometry.attributes.position.needsUpdate = true;
  geometry.attributes.aPool.needsUpdate = true;
}

/** `ml` of blood come to the ground at (x, z): into the pool it reaches, else a new one (the smallest gives way when none is free). */
export function bloodFeed(blood, world, x, y, z, ml) {
  let found = null;
  let nearest = Infinity;
  let smallest = null;
  const pools = blood.pools;
  const count = blood.budget.pools;
  for (let slot = 0; slot < count; slot += 1) {
    const pool = pools[slot];
    if (!pool.active) {
      smallest = pool;
      continue;
    }
    const gap = Math.hypot(pool.x - x, pool.z - z) - pool.radius;
    if (gap < 0.1 && gap < nearest && Math.abs(pool.y - y) < 0.6) {
      nearest = gap;
      found = pool;
    }
    if (!smallest || (smallest.active && pool.ml < smallest.ml)) smallest = pool;
  }
  if (!found) {
    found = smallest;
    // (A pool gives way only to more blood than it holds.)
    if (found.active && found.ml > ml * 4) return;
    found.active = true;
    found.x = x;
    found.z = z;
    found.y = world?.arena ? floorUnder(world.arena, z, x, y) : 0;
    found.ml = 0;
    found.drawn = 0;
    found.seed = Math.random() * 40;
    found.soak = bloodHard(world, x, y, z) ? 0 : 1;
    // Its outline: no circle, a few broad lobes and a finer wobble, the same for its life.
    const [a, b, c] = [Math.random() * 6.28, Math.random() * 6.28, Math.random() * 6.28];
    for (let spoke = 0; spoke < found.weights.length; spoke += 1) {
      const angle = (spoke / found.weights.length) * Math.PI * 2;
      found.weights[spoke] = 1 + 0.2 * Math.sin(angle * 2 + a) + 0.13 * Math.sin(angle * 3 + b) + 0.08 * Math.sin(angle * 5 + c) + 0.05 * (Math.random() - 0.5);
    }
  } else if (found.ml > 0) {
    // Fed off its middle, it grows that way.
    const share = (0.5 * ml) / (found.ml + ml);
    found.x += (x - found.x) * share;
    found.z += (z - found.z) * share;
  }
  found.ml += ml;
  found.fedAt = blood.clock;
  found.dirty = true;
}

/** A stain where a drop of `ml` came down at (x, y, z) going (vx, vy, vz): a blot, drawn out along its way the flatter it came in. */
function bloodStain(blood, world, x, y, z, vx, vy, vz, ml, soak) {
  const slot = blood.stainNext % blood.budget.stains;
  blood.stainNext += 1;
  const spread = soak ? BLOOD_VIEW.spread.soak : BLOOD_VIEW.spread.hard;
  // (A drop bursts as it lands: its blot is about five times the area the same blood would lie in.)
  const size = Math.min(0.16, Math.max(0.01, Math.sqrt(((ml / 1000) * spread * 5) / Math.PI)));
  const flat = Math.hypot(vx, vz);
  const draw = 1 + Math.min(2.2, flat / Math.max(1.5, Math.abs(vy)));
  const heading = flat > 0.05 ? Math.atan2(vz, vx) : Math.random() * Math.PI * 2;
  const normal = bloodGroundNormal(world, x, y, z);
  // The blot's frame: its length along the drop's way, on the ground's own plane.
  let ax = Math.cos(heading);
  let az = Math.sin(heading);
  let ay = -(normal[0] * ax + normal[2] * az) / normal[1];
  const length = Math.hypot(ax, ay, az);
  ax /= length;
  ay /= length;
  az /= length;
  const bx = ay * normal[2] - az * normal[1];
  const by = az * normal[0] - ax * normal[2];
  const bz = ax * normal[1] - ay * normal[0];
  const matrix = blood.stainMesh.instanceMatrix.array;
  const at = slot * 16;
  const [long, wide] = [size * draw, size];
  matrix[at] = ax * long; matrix[at + 1] = ay * long; matrix[at + 2] = az * long; matrix[at + 3] = 0;
  matrix[at + 4] = normal[0]; matrix[at + 5] = normal[1]; matrix[at + 6] = normal[2]; matrix[at + 7] = 0;
  matrix[at + 8] = bx * wide; matrix[at + 9] = by * wide; matrix[at + 10] = bz * wide; matrix[at + 11] = 0;
  matrix[at + 12] = x + ax * size * (draw - 1); matrix[at + 13] = y + BLOOD_VIEW.lift * 0.6 + (slot % 9) * 0.00015; matrix[at + 14] = z + az * size * (draw - 1); matrix[at + 15] = 1;
  const info = blood.stainInfo.array;
  const cell = Math.floor(Math.random() * 8) * 2 + (draw > 1.5 ? 1 : 0);
  info[slot * 4] = cell % 4;
  info[slot * 4 + 1] = Math.floor(cell / 4);
  info[slot * 4 + 2] = soak;
  info[slot * 4 + 3] = blood.clock;
  blood.stainMesh.count = Math.min(blood.budget.stains, Math.max(blood.stainMesh.count, slot + 1));
  blood.stainsDirty = true;
}

/** A drop come down: into water (it spreads there, blooddye.js), into the pool it lands in, a pool of its own if it is a gout, else a stain. */
function bloodLand(blood, view, world, x, y, z, vx, vy, vz, ml) {
  if (bloodDyeLand(view, blood.dye, x, z, ml, blood.clock)) return;
  const pools = blood.pools;
  for (let slot = 0; slot < blood.budget.pools; slot += 1) {
    const pool = pools[slot];
    if (pool.active && Math.hypot(pool.x - x, pool.z - z) < pool.radius * 0.9 && Math.abs(pool.y - y) < 0.6) {
      pool.ml += ml;
      pool.fedAt = blood.clock;
      pool.dirty = true;
      return;
    }
  }
  if (ml >= BLOOD_VIEW.poolFrom) bloodFeed(blood, world, x, y, z, ml);
  else bloodStain(blood, world, x, y, z, vx, vy, vz, ml, bloodHard(world, x, y, z) ? 0 : 1);
}

/** One place blood leaves a body at: `ml` of it this frame, from (x, y, z) moving at (vx, vy, vz), thrown along (dx, dy, dz) if it spurts. */
function bloodShed(blood, view, world, id, ml, perSecond, x, y, z, vx, vy, vz, dx, dy, dz, near) {
  const ground = world.arena ? floorUnder(world.arena, z, x, y) : 0;
  if (!near || y - ground < BLOOD_VIEW.dripAbove) {
    bloodFeed(blood, world, x, y, z, ml);
    return;
  }
  blood.owed[id] += ml;
  const each = Math.max(BLOOD_VIEW.dropMl, perSecond / blood.budget.drips);
  const spurting = perSecond > BLOOD_VIEW.spurtFrom;
  const beat = spurting ? Math.max(0, Math.sin(blood.clock * BLOOD_VIEW.beat * Math.PI * 2 + id)) : 0;
  const throwSpeed = BLOOD_VIEW.spurt * beat * Math.min(1, perSecond / 200 + 0.4);
  let guard = 0;
  while (blood.owed[id] >= each && guard < 12) {
    guard += 1;
    blood.owed[id] -= each;
    const push = throwSpeed * (0.5 + 0.7 * Math.random());
    const spray = 0.25 + 0.25 * push;
    if (!bloodDrop(blood, x, y, z, vx * 0.6 + dx * push + (Math.random() - 0.5) * spray, vy * 0.6 + dy * push + (Math.random() - 0.3) * spray, vz * 0.6 + dz * push + (Math.random() - 0.5) * spray, each)) {
      // (The air full: it goes to the ground under him.)
      bloodFeed(blood, world, x, y, z, each);
    }
  }
}

/**
 * Each body's blood, as the simulation lost it since the last frame, laid down where it leaves him: a man cut through the
 * trunk from both cut ends; one with a part cut off or a wound opened, from there (bloodSite); else from his middle.
 */
function bloodBodies(blood, view, world, dt) {
  const camera = view.camera.position;
  const far = blood.budget.far ** 2;
  const fighters = world.fighters;
  bloodRoom(blood, fighters.length);
  for (let id = 0; id < fighters.length; id += 1) {
    const fighter = fighters[id];
    const lost = Math.min(BLOOD_VIEW.most, fighter.bloodLost ?? 0);
    const gone = lost - blood.lost[id];
    // (A new bout's man with the last one's number: nothing lost yet.)
    if (gone < 0) blood.lost[id] = lost;
    if (gone <= 0 || fighter.dormant) continue;
    blood.lost[id] = lost;
    const ml = gone * bloodMl(fighter);
    const perSecond = ml / dt;
    const x = fighter.x;
    const v = fighter.v;
    const hips = P.pelvis * 3;
    const near = (x[hips] - camera.x) ** 2 + (x[hips + 2] - camera.z) ** 2 < far;
    if (fighter.halves) {
      // Both cut ends: most from the upper, where the heart is.
      for (let part = 0; part < 2; part += 1) {
        const half = fighter.halves[part];
        const end = half.rebuild.stub * 3;
        const from = half.rebuild.anchor * 3;
        let [dx, dy, dz] = [half.x[end] - half.x[from], half.x[end + 1] - half.x[from + 1], half.x[end + 2] - half.x[from + 2]];
        const length = Math.hypot(dx, dy, dz) || 1;
        dx /= length; dy /= length; dz /= length;
        const share = part ? 0.6 : 0.4;
        bloodShed(blood, view, world, id, ml * share, perSecond * share, half.x[end], half.x[end + 1], half.x[end + 2], half.v[from], half.v[from + 1], half.v[from + 2], dx, dy, dz, near);
      }
      continue;
    }
    const site = (blood.site[id] >= 0 ? blood.site[id] : P.pelvis) * 3;
    const inward = blood.inward[id] * 3;
    let [dx, dy, dz] = [0, 0, 0];
    if (inward >= 0) {
      [dx, dy, dz] = [x[site] - x[inward], x[site + 1] - x[inward + 1], x[site + 2] - x[inward + 2]];
      const length = Math.hypot(dx, dy, dz) || 1;
      dx /= length; dy /= length; dz /= length;
    }
    // (A wound in the middle of him: at half his trunk's height, not at his hips.)
    const lift = blood.site[id] < 0 ? 0.5 * (x[P.neck * 3 + 1] - x[hips + 1]) : 0;
    bloodShed(blood, view, world, id, ml, perSecond, x[site], x[site + 1] + lift, x[site + 2], v[site], v[site + 1], v[site + 2], dx, dy, dz, near);
  }
}

/** A frame of it: the bodies' blood laid down, the drops flown and landed, the pools redrawn that grew. */
export function bloodUpdate(blood, view, world, dt) {
  blood.clock += dt;
  blood.time.value = blood.clock;
  if (dt > 0 && world?.fighters) bloodBodies(blood, view, world, dt);
  const drops = blood.drops;
  const arena = world?.arena;
  const matrix = blood.dropMesh.instanceMatrix.array;
  let count = blood.dropCount;
  for (let drop = 0; drop < count; drop += 1) {
    const at = drop * DROP;
    drops[at + 4] -= 9.81 * dt;
    // (The air takes a little of a drop's speed.)
    const drag = 1 - 0.35 * dt;
    drops[at + 3] *= drag;
    drops[at + 5] *= drag;
    drops[at] += drops[at + 3] * dt;
    drops[at + 1] += drops[at + 4] * dt;
    drops[at + 2] += drops[at + 5] * dt;
    const ground = arena ? floorUnder(arena, drops[at + 2], drops[at], drops[at + 1]) : 0;
    if (drops[at + 1] <= ground + 0.004) {
      bloodLand(blood, view, world, drops[at], ground, drops[at + 2], drops[at + 3], drops[at + 4], drops[at + 5], drops[at + 6]);
      // (The last drop takes its place.)
      count -= 1;
      drops.copyWithin(at, count * DROP, (count + 1) * DROP);
      drop -= 1;
      continue;
    }
    // Drawn as a bead drawn out along its way.
    const speed = Math.hypot(drops[at + 3], drops[at + 4], drops[at + 5]) || 1;
    const size = Math.min(0.02, 0.0065 * Math.cbrt(drops[at + 6]) + 0.003);
    const long = size * (1 + Math.min(3.5, speed * 0.3));
    const [yx, yy, yz] = [drops[at + 3] / speed, drops[at + 4] / speed, drops[at + 5] / speed];
    // (Any two directions square to its way.)
    let [xx, xy, xz] = Math.abs(yy) < 0.9 ? [yz, 0, -yx] : [0, -yz, yy];
    const across = Math.hypot(xx, xy, xz) || 1;
    xx /= across; xy /= across; xz /= across;
    const m = drop * 16;
    matrix[m] = xx * size; matrix[m + 1] = xy * size; matrix[m + 2] = xz * size; matrix[m + 3] = 0;
    matrix[m + 4] = yx * long; matrix[m + 5] = yy * long; matrix[m + 6] = yz * long; matrix[m + 7] = 0;
    matrix[m + 8] = (xy * yz - xz * yy) * size; matrix[m + 9] = (xz * yx - xx * yz) * size; matrix[m + 10] = (xx * yy - xy * yx) * size; matrix[m + 11] = 0;
    matrix[m + 12] = drops[at]; matrix[m + 13] = drops[at + 1]; matrix[m + 14] = drops[at + 2]; matrix[m + 15] = 1;
  }
  blood.dropCount = count;
  blood.dropMesh.count = count;
  blood.dropMesh.instanceMatrix.needsUpdate = true;
  if (blood.stainsDirty) {
    blood.stainsDirty = false;
    blood.stainMesh.instanceMatrix.needsUpdate = true;
    blood.stainInfo.needsUpdate = true;
  }
  // The pools that grew: a few a frame, in turn.
  let drawn = 0;
  const pools = blood.pools;
  for (let step = 0; step < pools.length && drawn < BLOOD_VIEW.perFrame; step += 1) {
    const pool = pools[(blood.poolTurn + step) % pools.length];
    if (!pool.active || !pool.dirty) continue;
    if (pool.drawn > 0 && pool.ml < pool.drawn * BLOOD_VIEW.grown && blood.clock - pool.fedAt < 1) continue;
    bloodPoolDraw(blood, pool, world);
    drawn += 1;
  }
  blood.poolTurn = (blood.poolTurn + 1) % pools.length;
  bloodDyeUpload(blood.dye, blood.clock, view.place);
}

/** What lies on the ground and flies, in numbers (tests, shots, the report's budgets). */
export function bloodInfo(blood) {
  const pools = blood.pools.filter((pool) => pool.active);
  return { tier: blood.tier, drops: blood.dropCount, stains: blood.stainMesh.count, pools: pools.length, ml: Math.round(pools.reduce((sum, pool) => sum + pool.ml, 0)), widest: Math.max(0, ...pools.map((pool) => pool.radius * 2)) };
}
