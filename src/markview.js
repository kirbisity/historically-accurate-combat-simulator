// The marks blows leave on a body, drawn where they landed: one mechanism for every hit the simulation records.
//
// A mark is kept on the bone of the part it struck (its place, the line of the edge that made it and the way out of the
// surface there, in that bone's own frame), so it goes with the moving body; each frame the marks of a man near the camera
// are put where his bones are and handed to every material he is drawn with (the patch is laid with the wetness's:
// wetview.js, the same uniforms object, so skin, cloth, leather, mail, plate, a helmet and a shield arm all take it with
// no word from the outfit). What a mark looks like is decided per pixel from what the surface there is, as the wetness
// is: its own metalness and roughness, and whether it is bare skin.
//
// Three kinds, from what the physics decided (markOfBlow):
//   - a wound (an edge or a point that got through, by its joules past the armour): an open gash along the blade's line,
//     its length and gape from the energy of the cut, or a round hole for a point; blood round it that spreads for some
//     seconds and darkens as it dries, further into cloth than over skin; on plate a narrow dark split with blood at it;
//   - a blunt blow: on bare skin a bruise that comes up over the next seconds, red then dark; on plate a shallow dent;
//     on cloth and leather only a scuff;
//   - a score (an edge that the armour stopped): a bright scratch on metal, a dark slit in cloth, leather or lacquer,
//     a red weal on skin. No blood: nothing got through.
//
// Cost: MARKS.most marks a man at most (the least of them gives way to a new one), none drawn beyond MARKS.far or on the
// low tier; a man with no marks skips the loop on one uniform.

/* global THREE */
import { BONE, toFrame } from './rig.js';

export const MARKS = {
  // The most marks a man carries, by quality tier, and how far (m) from the camera they are still drawn.
  most: 8, tiers: { high: 8, medium: 5, low: 0 }, far: 28,
  // A wound's blood spreads to its full reach in `soakSeconds`, is dry after `drySeconds`; a bruise comes up in `bruiseSeconds`.
  soakSeconds: 9, drySeconds: [25, 110], bruiseSeconds: 14,
  // A mark is found on a surface within this (m) of where the blow met the body's capsule (what he wears stands off it).
  depth: 0.075,
};

export const MARK_KIND = { wound: 1, blunt: 2, score: 3 };
const MARK_STRIDE = 16;
const MARK_BONE = {
  head: 'head', lUpperArm: 'lUpperArm', rUpperArm: 'rUpperArm', lForearm: 'lForearm', rForearm: 'rForearm',
  lThigh: 'lThigh', rThigh: 'rThigh', lShank: 'lShin', rShank: 'rShin',
};
const MARK_SHARED = { uMarkMost: { value: MARKS.most } };

/** Half the length (m) of the wound an edge leaves with `joules` of cut: a nick is a few centimetres, a deep cut a hand's length or more. */
export function gashHalf(joules) {
  return Math.min(0.13, 0.015 + 0.0011 * joules);
}

/** A body's mark uniforms (joined to its wetness's: wetview.js wetUniforms). */
export function markUniforms() {
  return { uMarkCount: { value: 0 }, uMarkA: { value: new Float32Array(MARKS.most * 4) }, uMarkB: { value: new Float32Array(MARKS.most * 4) }, uMarkC: { value: new Float32Array(MARKS.most * 4) }, uMarkD: { value: new Float32Array(MARKS.most * 4) } };
}

const MARK_FRAGMENT_PARS = `
uniform float uMarkCount;
uniform float uMarkMost;
uniform vec4 uMarkA[ ${MARKS.most} ];
uniform vec4 uMarkB[ ${MARKS.most} ];
uniform vec4 uMarkC[ ${MARKS.most} ];
uniform vec4 uMarkD[ ${MARKS.most} ];
varying vec3 vMarkAt;
float markHash( vec3 p ) { return fract( sin( dot( p, vec3( 127.1, 311.7, 74.7 ) ) ) * 43758.5453 ); }
float markGrain( vec3 p ) {
	vec3 i = floor( p ); vec3 f = fract( p ); f = f * f * ( 3.0 - 2.0 * f );
	return mix( mix( mix( markHash( i ), markHash( i + vec3( 1.0, 0.0, 0.0 ) ), f.x ), mix( markHash( i + vec3( 0.0, 1.0, 0.0 ) ), markHash( i + vec3( 1.0, 1.0, 0.0 ) ), f.x ), f.y ),
		mix( mix( markHash( i + vec3( 0.0, 0.0, 1.0 ) ), markHash( i + vec3( 1.0, 0.0, 1.0 ) ), f.x ), mix( markHash( i + vec3( 0.0, 1.0, 1.0 ) ), markHash( i + vec3( 1.0, 1.0, 1.0 ) ), f.x ), f.y ), f.z );
}`;

// After the material knows its colour, roughness and metal (and before the wetness reads them): each mark near this
// pixel. A: where (world), half its length; B: its line, its kind; C: its width, its reach (blood, bruise), its strength,
// how dry; D: the way out of the surface there (none: a mark all round, a stump's).
const MARK_FRAGMENT = `
if ( uMarkCount > 0.5 ) {
	float markSkin = uWetKind.x * vWetAt.w;
	#ifdef STANDARD
		float markMetal = metalnessFactor;
		float markPorous = roughnessFactor * ( 1.0 - metalnessFactor ) * ( 1.0 - markSkin );
	#else
		float markMetal = 0.0;
		float markPorous = uWetKind.z * ( 1.0 - markSkin );
	#endif
	float markN = markGrain( vWetAt.xyz * 42.0 );
	float markFine = markGrain( vWetAt.zxy * 260.0 );
	for ( int i = 0; i < ${MARKS.most}; i ++ ) {
		if ( float( i ) >= min( uMarkCount, uMarkMost ) ) break;
		vec4 mA = uMarkA[ i ];
		vec4 mB = uMarkB[ i ];
		vec4 mC = uMarkC[ i ];
		vec3 mD = uMarkD[ i ].xyz;
		vec3 mOff = vMarkAt - mA.xyz;
		float mReach = mA.w + mC.y * 1.8 + 0.02;
		if ( dot( mOff, mOff ) > mReach * mReach + ${(MARKS.depth ** 2).toFixed(5)} ) continue;
		// On the surface: what stands out of it or lies under it (the armour over the body, the body under it) counts as on it.
		float mOut = dot( mOff, mD );
		if ( abs( mOut ) > ${MARKS.depth.toFixed(3)} ) continue;
		mOff -= mD * mOut;
		float mT = clamp( dot( mOff, mB.xyz ), - mA.w, mA.w );
		float mDist = length( mOff - mB.xyz * mT );
		// (A cut is widest in its middle.)
		float mTaper = mA.w > 0.001 ? sqrt( max( 0.0, 1.0 - ( mT / mA.w ) * ( mT / mA.w ) ) ) : 1.0;
		if ( mB.w < 1.5 ) {
			float mGape = mC.x * mTaper * mix( 1.0, 0.5, markMetal );
			float mCore = 1.0 - smoothstep( mGape * 0.55, mGape, mDist );
			float mLip = ( 1.0 - smoothstep( mGape, mGape * 2.6 + 0.001, mDist ) ) * ( 1.0 - mCore );
			// Its blood: further into what soaks it up than over skin or steel, its edge ragged with the grain.
			float mSoak = mC.y * mix( 1.0, 1.6, markPorous ) * ( 0.65 + 0.7 * markN );
			float mBlood = ( 1.0 - smoothstep( mSoak * 0.55, mSoak, mDist ) ) * mix( 0.8, 0.95, markPorous ) * ( 0.8 + 0.2 * markFine );
			vec3 mRed = mix( vec3( 0.36, 0.012, 0.02 ), vec3( 0.12, 0.016, 0.012 ), mC.w );
			diffuseColor.rgb = mix( diffuseColor.rgb, mRed * mix( 1.0, 0.75, markPorous ), mBlood );
			// The edges of the cut: skin drawn back and raw; cloth frayed pale where its threads are cut.
			diffuseColor.rgb = mix( diffuseColor.rgb, mix( vec3( 0.55, 0.12, 0.1 ), diffuseColor.rgb * 1.5 + 0.06, markPorous ), mLip * mix( 0.6, 0.35, markPorous ) * mC.z );
			diffuseColor.rgb = mix( diffuseColor.rgb, vec3( 0.13, 0.004, 0.008 ), mCore * mC.z );
			#ifdef STANDARD
				roughnessFactor = mix( roughnessFactor, mix( 0.22, 0.75, mC.w ), max( mBlood, mCore ) );
				metalnessFactor *= 1.0 - 0.85 * max( mBlood, mCore );
			#endif
		} else if ( mB.w < 2.5 ) {
			float mRound = 1.0 - smoothstep( mC.y * 0.25, mC.y * ( 0.8 + 0.4 * markN ), length( mOff ) );
			// Skin: a bruise, red at first and darker and bluer as it comes up (mC.w), mottled.
			vec3 mBruise = mix( vec3( 0.62, 0.2, 0.2 ), vec3( 0.27, 0.11, 0.24 ), mC.w );
			diffuseColor.rgb = mix( diffuseColor.rgb, diffuseColor.rgb * mBruise * 1.6, mRound * markSkin * mC.z * ( 0.65 + 0.35 * markFine ) );
			// Plate: a dent, its hollow darker and its far rim catching the light. Cloth and leather: a scuff.
			float mRim = smoothstep( mC.y * 0.45, mC.y * 0.7, length( mOff ) ) * mRound;
			diffuseColor.rgb *= 1.0 - mC.z * ( markMetal * ( 0.5 * mRound - 0.9 * mRim * step( 0.0, mOff.y ) ) + 0.18 * mRound * ( 1.0 - markMetal ) * ( 1.0 - markSkin ) );
			#ifdef STANDARD
				roughnessFactor = mix( roughnessFactor, 0.6, markMetal * mRound * mC.z * 0.6 );
			#endif
		} else {
			float mLine = ( 1.0 - smoothstep( mC.x * 0.5, mC.x, mDist ) ) * step( 0.02, mTaper ) * mC.z;
			float mEdge = ( 1.0 - smoothstep( mC.x, mC.x * 3.0, mDist ) ) * mTaper * mC.z;
			// Metal: bright steel under its skin of oxide or lacquer. Skin: a weal. Else a slit, dark, its edges frayed.
			vec3 mScore = mix( mix( diffuseColor.rgb * 0.22, vec3( 0.6, 0.14, 0.13 ), markSkin ), vec3( 0.92, 0.93, 0.95 ), markMetal );
			diffuseColor.rgb = mix( diffuseColor.rgb, diffuseColor.rgb * 1.35 + 0.04, ( mEdge - mLine ) * 0.5 * ( 1.0 - markSkin ) * ( 1.0 - markMetal ) );
			diffuseColor.rgb = mix( diffuseColor.rgb, mScore, mLine * mix( 0.9, 0.55, markSkin ) );
			#ifdef STANDARD
				roughnessFactor = mix( roughnessFactor, 0.2, mLine * markMetal );
			#endif
		}
	}
}`;

/** The marks' part of a material's shader, laid in with the wetness's (wetview.js wetMaterial: after it has declared its own). */
export function markShader(shader) {
  if (shader.fragmentShader.includes('uMarkCount') || !shader.fragmentShader.includes('uWetKind')) return;
  Object.assign(shader.uniforms, MARK_SHARED);
  shader.vertexShader = shader.vertexShader
    .replace('#include <common>', '#include <common>\nvarying vec3 vMarkAt;')
    .replace('#include <project_vertex>', '#include <project_vertex>\nvMarkAt = ( modelMatrix * vec4( transformed, 1.0 ) ).xyz;');
  shader.fragmentShader = shader.fragmentShader
    .replace('#include <common>', `#include <common>${MARK_FRAGMENT_PARS}`)
    .replace('#include <emissivemap_fragment>', `#include <emissivemap_fragment>${MARK_FRAGMENT}`);
}

/** How many marks are drawn a man, by quality tier. */
export function markTier(tier) {
  MARK_SHARED.uMarkMost.value = MARKS.tiers[tier] ?? MARKS.most;
}

// A fighter's marks outlive his drawing (a view is made again when his skin is swapped or his helmet falls).
const markStores = new WeakMap();

/** A fighter's marks: { count, data } (MARK_STRIDE numbers each: bone, place, line, way out, kind, half, width, reach, strength, born), or null. */
export function marksOf(fighter, make = false) {
  let store = markStores.get(fighter);
  if (!store && make) markStores.set(fighter, (store = { count: 0, data: new Float32Array(MARKS.most * MARK_STRIDE) }));
  return store ?? null;
}

const markScratch = { frame: null };

/**
 * A mark put on a man: `bone` (rig.js BONE) whose frame it is kept in (`frame`: that bone's now), at `point`, its line
 * `line` (null: none, a round one) and the way out of the surface `out` (null: all round), all in the world; `kind`
 * (MARK_KIND), `half` its length, `width`, `reach` (blood or bruise), `strength`, at `time`. Full, the least gives way.
 */
export function markAdd(fighter, bone, frame, point, line, out, { kind, half = 0, width = 0.004, reach = 0.03, strength = 1 }, time) {
  const store = marksOf(fighter, true);
  const data = store.data;
  let slot = store.count;
  if (slot >= MARKS.most) {
    // (The least: the smallest, a wound counted for more than a scratch.)
    let least = Infinity;
    for (let index = 0; index < MARKS.most; index += 1) {
      const at = index * MARK_STRIDE;
      const rank = (data[at + 11] + data[at + 13]) * (data[at + 10] === MARK_KIND.wound ? 2.5 : 1);
      if (rank < least) {
        least = rank;
        slot = index;
      }
    }
    if ((half + reach) * (kind === MARK_KIND.wound ? 2.5 : 1) < least) return;
  } else store.count += 1;
  const at = slot * MARK_STRIDE;
  const local = toFrame(frame, point);
  data[at] = bone;
  data.set(local, at + 1);
  const turned = (vector) => [0, 1, 2].map((axis) => vector[0] * [frame.x, frame.y, frame.z][axis][0] + vector[1] * [frame.x, frame.y, frame.z][axis][1] + vector[2] * [frame.x, frame.y, frame.z][axis][2]);
  let along = [0, 0, 0];
  if (line) {
    // (The line lies in the surface: what of it points out of it is left out.)
    const into = out ? line[0] * out[0] + line[1] * out[1] + line[2] * out[2] : 0;
    const flat = out ? [line[0] - out[0] * into, line[1] - out[1] * into, line[2] - out[2] * into] : line;
    const length = Math.hypot(flat[0], flat[1], flat[2]);
    if (length > 1e-4) along = turned(flat.map((value) => value / length));
    else half = 0;
  }
  data.set(along, at + 4);
  data.set(out ? turned(out) : [0, 0, 0], at + 7);
  data[at + 10] = kind;
  data[at + 11] = half;
  data[at + 12] = width;
  data[at + 13] = reach;
  data[at + 14] = strength;
  data[at + 15] = time;
}

/** The bone of the part a blow landed on (`target`: the capsule's key), the trunk's by how high up it (`point`). */
function markBone(target, frames, point) {
  if (target !== 'trunk') return BONE[MARK_BONE[target]] ?? BONE.chest;
  let best = BONE.pelvis;
  for (const name of ['spine', 'chest']) {
    const frame = frames[BONE[name]];
    if ((point[0] - frame.origin[0]) * frame.y[0] + (point[1] - frame.origin[1]) * frame.y[1] + (point[2] - frame.origin[2]) * frame.y[2] > 0) best = BONE[name];
  }
  return best;
}

/**
 * The mark a landed blow leaves (a 'landed' event of physics.js), from what it did: an edge's or a point's joules through
 * the armour (`cut`, `pierce`) a wound; else an edge the armour stopped a score; else its blunt share a bruise or a dent.
 * `frames`: the struck man's bones as drawn now. Returns whether it left one.
 */
export function markOfBlow(fighter, frames, event, time) {
  if (!frames || !event.point || !event.target) return false;
  const bone = markBone(event.target, frames, event.point);
  const frame = frames[bone];
  if (!frame) return false;
  // (The contact's normal points out of him, towards what struck.)
  const out = event.normal ?? null;
  const cut = event.cut ?? 0;
  const pierce = event.pierce ?? 0;
  if (cut > 1 || pierce > 1) {
    // A cut: along the blade. A stab: a hole the width of the point, a little drawn out.
    const slash = cut >= pierce;
    markAdd(fighter, bone, frame, event.point, slash ? event.edge ?? null : null, out, {
      kind: MARK_KIND.wound, half: slash && event.edge ? gashHalf(cut) : 0, width: slash ? Math.min(0.009, 0.0025 + 0.00006 * cut) : Math.min(0.009, 0.004 + 0.00008 * pierce),
      reach: (event.bleeds ? 0.018 : 0.007) + Math.min(0.045, 0.0004 * (cut + pierce)), strength: 1,
    }, time);
    return true;
  }
  const energy = event.energy ?? 0;
  if (event.weapon && !event.haft && (event.edgeShare ?? 0) > 0.3 && energy > 3 && event.edge) {
    markAdd(fighter, bone, frame, event.point, event.edge, out, { kind: MARK_KIND.score, half: Math.min(0.09, 0.02 + 0.0006 * energy), width: 0.0022, reach: 0, strength: Math.min(1, 0.4 + energy / 80) }, time);
    return true;
  }
  const blunt = energy > 0 ? energy * (event.harm ?? 1) : (event.impulse ?? 0) * (event.speed ?? 0) * 0.5;
  if (blunt < 6) return false;
  markAdd(fighter, bone, frame, event.point, null, out, { kind: MARK_KIND.blunt, half: 0, width: 0, reach: Math.min(0.07, 0.02 + 0.0006 * blunt), strength: Math.min(1, 0.3 + blunt / 90) }, time);
  return true;
}

/**
 * A man's marks put where his bones are now (`frames`), into his uniforms: called each frame for every man drawn.
 * `near`: whether he is near enough the camera for them to be drawn at all.
 */
export function marksPose(fighter, frames, uniforms, time, near) {
  const store = markStores.get(fighter);
  if (!store || !store.count || !near || !frames) {
    uniforms.uMarkCount.value = 0;
    return;
  }
  const { data } = store;
  const [A, B, C, D] = [uniforms.uMarkA.value, uniforms.uMarkB.value, uniforms.uMarkC.value, uniforms.uMarkD.value];
  for (let index = 0; index < store.count; index += 1) {
    const at = index * MARK_STRIDE;
    const frame = frames[data[at]];
    const { x, y, z, origin } = frame;
    const to = index * 4;
    for (let axis = 0; axis < 3; axis += 1) {
      A[to + axis] = origin[axis] + x[axis] * data[at + 1] + y[axis] * data[at + 2] + z[axis] * data[at + 3];
      B[to + axis] = x[axis] * data[at + 4] + y[axis] * data[at + 5] + z[axis] * data[at + 6];
      D[to + axis] = x[axis] * data[at + 7] + y[axis] * data[at + 8] + z[axis] * data[at + 9];
    }
    const age = Math.max(0, time - data[at + 15]);
    const kind = data[at + 10];
    A[to + 3] = data[at + 11];
    B[to + 3] = kind;
    C[to] = data[at + 12];
    if (kind === MARK_KIND.wound) {
      // Its blood spreads fast at first, then slower; it dries from wet red to a dark crust.
      C[to + 1] = data[at + 12] + data[at + 13] * (1 - Math.exp(-(3 * age) / MARKS.soakSeconds));
      C[to + 2] = data[at + 14];
      C[to + 3] = Math.min(1, Math.max(0, (age - MARKS.drySeconds[0]) / (MARKS.drySeconds[1] - MARKS.drySeconds[0])));
    } else {
      C[to + 1] = data[at + 13];
      // (A bruise is faint when it is struck and comes up after.)
      const up = Math.min(1, age / MARKS.bruiseSeconds);
      C[to + 2] = data[at + 14] * (kind === MARK_KIND.blunt ? 0.45 + 0.55 * up : 1);
      C[to + 3] = up;
    }
  }
  uniforms.uMarkCount.value = store.count;
}
