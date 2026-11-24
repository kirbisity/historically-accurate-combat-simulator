// The marks harm leaves on a body, drawn where it landed: one mechanism for every hit the simulation records, and the
// only way a body shows its hurt (the parts were tinted red by their damage until 2026-11-24: the user's call to have
// real wounds say it instead).
//
// A mark is kept on the bone of the part it struck (its place, the line of the edge that made it and the way out of the
// surface there, in that bone's own frame), so it goes with the moving body; each frame the marks of a man near the camera
// are put where his bones are and handed to every material he is drawn with (the patch is laid with the wetness's:
// wetview.js, the same uniforms object, so skin, cloth, leather, mail, plate, a helmet and a shield arm all take it with
// no word from the outfit). What a mark looks like is decided per pixel from what the surface there is, as the wetness
// is: its own metalness and roughness, whether it is bare skin, and whether it is mail.
//
// The kinds, from what the physics decided:
//   - a wound (an edge or a point that got through, by its joules past the armour; a missile's hole): a graze is a thin
//     red line; an open cut a gash along the blade's line, its length and gape from the energy; a deep one gapes wide,
//     dark, with the pale of bone in it where the blow reached bone; a point's or a ball's is a round hole. Blood round
//     it spreads for some seconds and darkens as it dries, further into cloth than over skin, and runs down from a wound
//     that bleeds; on plate a narrow dark split with blood at it; on mail a hole with burst rings round it;
//   - a blunt blow: on bare skin a bruise that comes up over the next seconds, red then dark, and split skin at its
//     middle if it was hard; on plate a shallow dent; on cloth and leather only a scuff;
//   - a score (an edge that the armour stopped): a bright scratch on plate, burst and bent rings on mail, a dark slit in
//     cloth, leather or lacquer, a red weal on skin. No blood: nothing got through;
//   - spatter: drops of another man's blood thrown on him by the cut he made;
//   - a burn: skin reddened, blistered and charred, cloth and leather blackened, plate sooted.
// Harm that comes with no blow to place it (a fall, a crush, fire, a joint broken) leaves its mark on the part all the
// same (markDamage: whatever of a part's damage no mark has answered for), a broken joint a dark swelling round it.
//
// Cost: MARKS.most marks a man at most (the least of them gives way to a new one); fewer are drawn on the lower tiers
// (MARKS.tiers: the greatest of them), none beyond MARKS.far; on the low tier they are drawn plain (no grain, no runs).
// A man with no marks skips the loop on one uniform.

/* global THREE */
import { BONE, toFrame } from './rig.js';

export const MARKS = {
  // The most marks a man carries; how many of them are drawn, and to how far (m) from the camera, by quality tier.
  most: 8, tiers: { high: 8, medium: 5, low: 2 }, far: { high: 28, medium: 20, low: 12 },
  // A wound's blood spreads to its full reach in `soakSeconds`, is dry after `drySeconds`; a bruise comes up in `bruiseSeconds`.
  soakSeconds: 9, drySeconds: [25, 110], bruiseSeconds: 14,
  // A mark is found on a surface within this (m) of where the blow met the body's capsule (what he wears stands off it).
  depth: 0.075,
  // Blood runs down from a bleeding wound to this many times its reach (m at most), over `runSeconds`.
  run: 3.5, runMost: 0.16, runSeconds: 7,
  // A cut of less than `graze` J is a graze; one of `deep` J or more, or into bone, gapes.
  graze: 8, deep: 45,
  // A blunt blow of this many joules or more on skin splits it.
  splits: 45,
  // A part's damage (0..1) that no mark has answered for leaves one past this much of it.
  unmarked: 0.12,
};

export const MARK_KIND = { wound: 1, blunt: 2, score: 3, spatter: 4, burn: 5 };
// What else a mark says (its flags, summed): only on bare skin; bone shows in it; its blood runs down.
export const MARK_FLAG = { skin: 1, bone: 2, runs: 4 };
const MARK_STRIDE = 18;
const MARK_BONE = {
  head: 'head', lUpperArm: 'lUpperArm', rUpperArm: 'rUpperArm', lForearm: 'lForearm', rForearm: 'rForearm',
  lThigh: 'lThigh', rThigh: 'rThigh', lShank: 'lShin', rShank: 'rShin',
};
// The parts whose damage is kept (physics.js), in the order a man's store keeps what of each is answered for.
const MARK_PARTS = ['head', 'trunk', 'lUpperArm', 'rUpperArm', 'lForearm', 'rForearm', 'lThigh', 'rThigh', 'lShank', 'rShank'];
// A broken joint's swelling: on the bone below it.
const MARK_JOINT = { lElbow: 'lForearm', rElbow: 'rForearm', lKnee: 'lShin', rKnee: 'rShin', lHip: 'lThigh', rHip: 'rThigh', neck: 'neck' };
const MARK_SHARED = { uMarkMost: { value: MARKS.most } };
const markState = { tier: 'high', now: 0 };

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
uniform float uMarkMail;
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
// how dry or how far come up; D: the way out of the surface there (none: a mark all round, a stump's), its flags.
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
	float markMail = uMarkMail * ( 1.0 - markSkin );
	float markPlate = markMetal * ( 1.0 - markMail );
	// (The low tier draws them plain: no grain, no runs.)
	bool markPlain = uMarkMost < 2.5;
	// (The grain, worked out only for a pixel a mark reaches.)
	float markN = markPlain ? 0.5 : -1.0;
	float markFine = 0.5;
	for ( int i = 0; i < ${MARKS.most}; i ++ ) {
		if ( float( i ) >= uMarkCount ) break;
		vec4 mA = uMarkA[ i ];
		vec4 mB = uMarkB[ i ];
		vec4 mC = uMarkC[ i ];
		vec3 mD = uMarkD[ i ].xyz;
		float mFlags = uMarkD[ i ].w;
		bool mRuns = mod( floor( mFlags / 4.0 ), 2.0 ) > 0.5 && ! markPlain;
		float mBone = mod( floor( mFlags / 2.0 ), 2.0 );
		float mOnly = mod( mFlags, 2.0 ) > 0.5 ? markSkin : 1.0;
		vec3 mOff = vMarkAt - mA.xyz;
		float mReach = mA.w + mC.y * 1.8 + 0.02;
		// What runs down from it is looked for below it, however far the surface there stands off its plane.
		float mRun = 0.0;
		if ( mRuns && mOff.y < 0.0 ) {
			float mLong = min( ${MARKS.runMost.toFixed(3)}, mC.y * ${MARKS.run.toFixed(1)} );
			if ( - mOff.y < mLong && dot( mOff.xz, mOff.xz ) < 0.01 ) {
				if ( markN < 0.0 ) { markN = markGrain( vWetAt.xyz * 42.0 ); markFine = markGrain( vWetAt.zxy * 260.0 ); }
				float mWide = mC.x * 1.2 + 0.004 + 0.012 * ( 1.0 + mOff.y / mLong );
				float mAside = length( mOff.xz - mD.xz * dot( mOff, mD ) ) + ( markN - 0.5 ) * 0.012;
				mRun = ( 1.0 - smoothstep( mWide * 0.5, mWide, abs( mAside ) ) ) * ( 1.0 - smoothstep( mLong * 0.75, mLong, - mOff.y ) ) * ( 0.55 + 0.45 * markFine );
			}
		}
		if ( dot( mOff, mOff ) > mReach * mReach + ${(MARKS.depth ** 2).toFixed(5)} && mRun <= 0.0 ) continue;
		// On the surface: what stands out of it or lies under it (the armour over the body, the body under it) counts as on it.
		float mOut = dot( mOff, mD );
		if ( abs( mOut ) > ${MARKS.depth.toFixed(3)} && mRun <= 0.0 ) continue;
		mOff -= mD * mOut;
		if ( markN < 0.0 ) { markN = markGrain( vWetAt.xyz * 42.0 ); markFine = markGrain( vWetAt.zxy * 260.0 ); }
		float mT = clamp( dot( mOff, mB.xyz ), - mA.w, mA.w );
		float mDist = length( mOff - mB.xyz * mT );
		// (A cut is widest in its middle.)
		float mTaper = mA.w > 0.001 ? sqrt( max( 0.0, 1.0 - ( mT / mA.w ) * ( mT / mA.w ) ) ) : 1.0;
		if ( mB.w < 1.5 ) {
			float mGape = mC.x * mTaper * mix( 1.0, 0.5, markPlate );
			float mCore = ( 1.0 - smoothstep( mGape * 0.55, mGape, mDist ) ) * mOnly;
			float mLip = ( 1.0 - smoothstep( mGape, mGape * 2.6 + 0.001, mDist ) ) * ( 1.0 - mCore ) * mOnly;
			// Its blood: further into what soaks it up than over skin or steel, its edge ragged with the grain; and what ran down.
			float mSoak = mC.y * mix( 1.0, 1.6, markPorous ) * ( 0.65 + 0.7 * markN );
			float mBlood = max( ( 1.0 - smoothstep( mSoak * 0.55, mSoak, mDist ) ) * ( 0.8 + 0.2 * markFine ), mRun ) * mix( 0.8, 0.95, markPorous ) * mOnly;
			vec3 mRed = mix( vec3( 0.36, 0.012, 0.02 ), vec3( 0.12, 0.016, 0.012 ), mC.w );
			diffuseColor.rgb = mix( diffuseColor.rgb, mRed * mix( 1.0, 0.75, markPorous ), mBlood );
			// Mail round a hole: its rings burst and bent back, dark gaps and bright ends.
			float mBurst = markMail * ( 1.0 - smoothstep( mGape * 2.0 + 0.004, mGape * 4.0 + 0.012, mDist ) ) * mC.z;
			diffuseColor.rgb = mix( diffuseColor.rgb, mix( vec3( 0.03 ), vec3( 0.9 ), step( 0.72, markFine ) ), mBurst * step( 0.45, markFine + 0.3 * markN ) * 0.8 );
			// The edges of the cut: skin drawn back and raw; cloth frayed pale where its threads are cut.
			diffuseColor.rgb = mix( diffuseColor.rgb, mix( vec3( 0.55, 0.12, 0.1 ), diffuseColor.rgb * 1.5 + 0.06, markPorous ), mLip * mix( 0.6, 0.35, markPorous ) * mC.z );
			diffuseColor.rgb = mix( diffuseColor.rgb, vec3( 0.13, 0.004, 0.008 ), mCore * mC.z );
			// To the bone: its pale at the bottom of the gape.
			diffuseColor.rgb = mix( diffuseColor.rgb, vec3( 0.78, 0.72, 0.6 ), mBone * mC.z * ( 1.0 - smoothstep( mGape * 0.12, mGape * 0.3, mDist ) ) * 0.75 * ( 1.0 - markMetal ) );
			#ifdef STANDARD
				roughnessFactor = mix( roughnessFactor, mix( 0.22, 0.75, mC.w ), max( mBlood, mCore ) );
				metalnessFactor *= 1.0 - 0.85 * max( mBlood, mCore );
			#endif
		} else if ( mB.w < 2.5 ) {
			float mRound = 1.0 - smoothstep( mC.y * 0.25, mC.y * ( 0.8 + 0.4 * markN ), length( mOff ) );
			// Skin: a bruise, red at first and darker and bluer as it comes up (mC.w), mottled, swollen pale at its rim.
			vec3 mBruise = mix( vec3( 0.62, 0.2, 0.2 ), vec3( 0.27, 0.11, 0.24 ), mC.w );
			diffuseColor.rgb = mix( diffuseColor.rgb, diffuseColor.rgb * mBruise * 1.6, mRound * markSkin * mC.z * ( 0.65 + 0.35 * markFine ) );
			// Plate: a dent, its hollow darker and its far rim catching the light. Cloth, leather and mail: a scuff.
			float mRim = smoothstep( mC.y * 0.45, mC.y * 0.7, length( mOff ) ) * mRound;
			diffuseColor.rgb *= 1.0 - mC.z * ( markPlate * ( 0.5 * mRound - 0.9 * mRim * step( 0.0, mOff.y ) ) + 0.18 * mRound * ( 1.0 - markPlate ) * ( 1.0 - markSkin ) );
			#ifdef STANDARD
				roughnessFactor = mix( roughnessFactor, 0.6, markPlate * mRound * mC.z * 0.6 );
			#endif
		} else if ( mB.w < 3.5 ) {
			float mLine = ( 1.0 - smoothstep( mC.x * 0.5, mC.x, mDist ) ) * step( 0.02, mTaper ) * mC.z;
			float mEdge = ( 1.0 - smoothstep( mC.x, mC.x * 3.0, mDist ) ) * mTaper * mC.z;
			// Plate: bright steel under its skin of oxide or lacquer. Skin: a weal. Else a slit, dark, its edges frayed.
			vec3 mScore = mix( mix( diffuseColor.rgb * 0.22, vec3( 0.6, 0.14, 0.13 ), markSkin ), vec3( 0.92, 0.93, 0.95 ), markPlate );
			diffuseColor.rgb = mix( diffuseColor.rgb, diffuseColor.rgb * 1.35 + 0.04, ( mEdge - mLine ) * 0.5 * ( 1.0 - markSkin ) * ( 1.0 - markMetal ) );
			diffuseColor.rgb = mix( diffuseColor.rgb, mScore, mLine * mix( 0.9, 0.55, markSkin ) * ( 1.0 - markMail ) );
			// Mail: no line, a run of rings burst open along the edge's way: dark where they are gone, bright where they are bent up.
			float mRings = markMail * ( 1.0 - smoothstep( mC.x * 2.0, mC.x * 5.0 + 0.006, mDist ) ) * mTaper * mC.z;
			diffuseColor.rgb = mix( diffuseColor.rgb, mix( vec3( 0.03 ), vec3( 0.9 ), step( 0.72, markFine ) ), mRings * step( 0.5, markFine + 0.35 * markN ) * 0.85 );
			#ifdef STANDARD
				roughnessFactor = mix( roughnessFactor, 0.2, mLine * markPlate );
			#endif
		} else if ( mB.w < 4.5 ) {
			// Drops thrown on him: thick near the middle of where they struck, few at its edge; dried, darker.
			float mSpot = ( 1.0 - smoothstep( mC.y * 0.2, mC.y, length( mOff ) ) ) * mC.z;
			float mDrops = step( 1.0 - 0.55 * mSpot, 0.6 * markFine + 0.4 * markN ) * step( 0.02, mSpot );
			diffuseColor.rgb = mix( diffuseColor.rgb, mix( vec3( 0.36, 0.012, 0.02 ), vec3( 0.12, 0.016, 0.012 ), mC.w ), mDrops * 0.9 );
			#ifdef STANDARD
				roughnessFactor = mix( roughnessFactor, mix( 0.25, 0.7, mC.w ), mDrops );
				metalnessFactor *= 1.0 - 0.8 * mDrops;
			#endif
		} else {
			// A burn: skin red, then blistered pale and charred dark in patches; anything else blackened.
			float mBurn = ( 1.0 - smoothstep( mC.y * 0.35, mC.y * ( 0.8 + 0.4 * markN ), length( mOff ) ) ) * mC.z;
			vec3 mSkinBurn = mix( diffuseColor.rgb * vec3( 1.25, 0.55, 0.5 ), mix( vec3( 0.07, 0.04, 0.035 ), vec3( 0.75, 0.6, 0.5 ), step( 0.7, markFine ) * step( mC.z, 0.75 ) ), smoothstep( 0.45, 0.9, mBurn + 0.3 * ( markN - 0.5 ) ) );
			diffuseColor.rgb = mix( diffuseColor.rgb, mix( diffuseColor.rgb * 0.18 + 0.01, mSkinBurn, markSkin ), mBurn * mix( 0.85, 1.0, markSkin ) );
			#ifdef STANDARD
				roughnessFactor = mix( roughnessFactor, 0.9, mBurn );
			#endif
		}
	}
}`;

/**
 * The marks' part of a material's shader, laid in with the wetness's (wetview.js wetMaterial: after it has declared its own).
 * `mail`: whether the material is mail (its rings burst where an edge or a point met them).
 */
export function markShader(shader, { mail = false } = {}) {
  if (shader.fragmentShader.includes('uMarkCount') || !shader.fragmentShader.includes('uWetKind')) return;
  Object.assign(shader.uniforms, MARK_SHARED, { uMarkMail: { value: mail ? 1 : 0 } });
  shader.vertexShader = shader.vertexShader
    .replace('#include <common>', '#include <common>\nvarying vec3 vMarkAt;')
    .replace('#include <project_vertex>', '#include <project_vertex>\nvMarkAt = ( modelMatrix * vec4( transformed, 1.0 ) ).xyz;');
  shader.fragmentShader = shader.fragmentShader
    .replace('#include <common>', `#include <common>${MARK_FRAGMENT_PARS}`)
    .replace('#include <emissivemap_fragment>', `#include <emissivemap_fragment>${MARK_FRAGMENT}`);
}

/** How many marks are drawn a man and how far off, by quality tier. */
export function markTier(tier) {
  if (!MARKS.tiers[tier] && MARKS.tiers[tier] !== 0) return;
  markState.tier = tier;
  MARK_SHARED.uMarkMost.value = MARKS.tiers[tier];
}

/** How far (m) from the camera a man's marks are drawn on this tier. */
export function markFar() {
  return MARKS.far[markState.tier] ?? MARKS.far.high;
}

// A fighter's marks outlive his drawing (a view is made again when his skin is swapped or his helmet falls).
const markStores = new WeakMap();

/**
 * A fighter's marks: { count, data, seen, broken } (data: MARK_STRIDE numbers each: bone, place, line, way out, kind, half,
 * width, reach, strength, born, flags, rank; seen: what of each part's damage a mark has answered for; broken: the joints
 * whose swelling is marked), or null.
 */
export function marksOf(fighter, make = false) {
  let store = markStores.get(fighter);
  if (!store && make) markStores.set(fighter, (store = { count: 0, data: new Float32Array(MARKS.most * MARK_STRIDE), seen: new Float32Array(MARK_PARTS.length), broken: new Set(), order: new Uint8Array(MARKS.most) }));
  return store ?? null;
}

const markRank = (kind, half, reach, flags) => (half + reach) * (kind === MARK_KIND.wound ? (flags & MARK_FLAG.runs ? 3.5 : 2.5) : kind === MARK_KIND.spatter ? 0.4 : 1);

/**
 * A mark put on a man: `bone` (rig.js BONE) whose frame it is kept in (`frame`: that bone's now), at `point`, its line
 * `line` (null: none, a round one) and the way out of the surface `out` (null: all round), all in the world; `kind`
 * (MARK_KIND), `half` its length, `width`, `reach` (blood, bruise, burn), `strength`, `flags` (MARK_FLAG), at `time`
 * (default: now). Full, the least gives way (a wound counts for more than a scratch, a bleeding one for most).
 */
export function markAdd(fighter, bone, frame, point, line, out, { kind, half = 0, width = 0.004, reach = 0.03, strength = 1, flags = 0 }, time = markState.now) {
  const store = marksOf(fighter, true);
  const data = store.data;
  let slot = store.count;
  if (slot >= MARKS.most) {
    let least = Infinity;
    for (let index = 0; index < MARKS.most; index += 1) {
      const rank = data[index * MARK_STRIDE + 17];
      if (rank < least) {
        least = rank;
        slot = index;
      }
    }
    if (markRank(kind, half, reach, flags) < least) return;
  } else store.count += 1;
  const at = slot * MARK_STRIDE;
  const local = toFrame(frame, point);
  data[at] = bone;
  data.set(local, at + 1);
  const axes = [frame.x, frame.y, frame.z];
  const turned = (vector) => axes.map((axis) => vector[0] * axis[0] + vector[1] * axis[1] + vector[2] * axis[2]);
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
  data[at + 16] = flags;
  data[at + 17] = markRank(kind, half, reach, flags);
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

/** What of a part's damage is now answered for by a mark put on it (markDamage leaves none for it again). */
function markSeen(fighter, target) {
  const part = MARK_PARTS.indexOf(target);
  if (part >= 0) marksOf(fighter, true).seen[part] = Math.max(marksOf(fighter).seen[part], fighter.damage?.[target] ?? 0);
}

/**
 * The mark a landed blow or a missile leaves (a 'landed', 'arrow', 'shot' or 'fragment' event of the physics), from what
 * it did: an edge's or a point's joules through the armour (`cut`, `pierce`) a wound, by its depth a graze, a cut or a
 * gape to the bone; else an edge the armour stopped a score; else its blunt share a bruise or a dent, the skin split if
 * it was hard. `frames`: the struck man's bones as drawn now. Returns whether it left one.
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
  markSeen(fighter, event.target);
  if (cut > 1 || pierce > 1) {
    // A cut: along the blade. A stab: a hole the width of the point.
    const slash = cut >= pierce && Boolean(event.edge);
    const graze = slash && cut < MARKS.graze;
    const toBone = Boolean(event.lodged?.bone) || event.effects?.includes('the bone cut into') || event.effects?.includes('deep cut') && cut > MARKS.deep * 1.6;
    const deep = slash && (cut >= MARKS.deep || toBone);
    const flags = (event.bleeds ? MARK_FLAG.runs : 0) + (toBone && slash ? MARK_FLAG.bone : 0);
    markAdd(fighter, bone, frame, event.point, slash ? event.edge : null, out, {
      kind: MARK_KIND.wound, half: slash ? gashHalf(cut) : 0, flags,
      width: graze ? 0.0013 : slash ? Math.min(deep ? 0.013 : 0.007, 0.0025 + 0.00007 * cut) : Math.min(0.009, 0.004 + 0.00008 * pierce),
      reach: graze ? 0.004 : (event.bleeds ? 0.018 : 0.007) + Math.min(0.045, 0.0004 * (cut + pierce)), strength: graze ? 0.5 : 1,
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
  // Hard enough, the skin over the bone splits: a short ragged cut at its middle, on bare skin only.
  if (blunt >= MARKS.splits && out) {
    const across = Math.abs(out[1]) < 0.9 ? [out[2], 0, -out[0]] : [1, 0, 0];
    markAdd(fighter, bone, frame, event.point, across, out, { kind: MARK_KIND.wound, half: Math.min(0.03, 0.008 + 0.00015 * blunt), width: 0.0022, reach: 0.012, strength: 1, flags: MARK_FLAG.skin + (blunt > MARKS.splits * 1.5 ? MARK_FLAG.runs : 0) }, time);
  }
  return true;
}

/**
 * Blood thrown on the man who made a cut (`event`: the landed blow that bled; `frames`: the striker's bones): drops on the
 * part of him nearest the wound, if he is within `within` m of it.
 */
export function markSpatter(striker, frames, event, time, within = 1.3) {
  if (!frames || !event.point) return false;
  let best = -1;
  let nearest = within;
  for (const name of ['chest', 'head', 'lForearm', 'rForearm', 'lThigh', 'rThigh']) {
    const origin = frames[BONE[name]].origin;
    const apart = Math.hypot(origin[0] - event.point[0], origin[1] - event.point[1], origin[2] - event.point[2]);
    if (apart < nearest) {
      nearest = apart;
      best = BONE[name];
    }
  }
  if (best < 0) return false;
  const frame = frames[best];
  const middle = [0, 1, 2].map((axis) => (frame.origin[axis] + (frame.end?.[axis] ?? frame.origin[axis])) / 2);
  const toward = [event.point[0] - middle[0], event.point[1] - middle[1], event.point[2] - middle[2]];
  const length = Math.hypot(...toward) || 1;
  const out = toward.map((value) => value / length);
  markAdd(striker, best, frame, middle.map((value, axis) => value + out[axis] * 0.08), null, out, { kind: MARK_KIND.spatter, reach: 0.07 + 0.05 * Math.random(), strength: Math.min(1, 0.45 + (event.cut ?? 0) / 150) }, time);
  return true;
}

/**
 * The harm no blow placed (a fall, a crush, fire, a joint broken): for each part, what of its damage no mark has yet
 * answered for leaves one round its middle (a bruise; a burn if he is burning), and each broken joint a dark swelling.
 * Called when his damage changes (render.js: where the parts were tinted). `frames`: his bones as drawn now.
 */
export function markDamage(fighter, frames) {
  if (!frames || !fighter.damage) return;
  const store = marksOf(fighter, true);
  for (let part = 0; part < MARK_PARTS.length; part += 1) {
    const key = MARK_PARTS[part];
    const damage = Math.min(1, fighter.damage[key] ?? 0);
    const fresh = damage - store.seen[part];
    if (fresh < MARKS.unmarked) continue;
    store.seen[part] = damage;
    const bone = key === 'trunk' ? BONE.spine : BONE[MARK_BONE[key]];
    const frame = frames[bone];
    if (!frame) continue;
    const middle = key === 'head' ? frame.origin : [0, 1, 2].map((axis) => (frame.origin[axis] + (frame.end?.[axis] ?? frame.origin[axis])) / 2);
    markAdd(fighter, bone, frame, middle, null, null, { kind: fighter.burning ? MARK_KIND.burn : MARK_KIND.blunt, reach: (key === 'trunk' ? 0.16 : 0.09) * (0.6 + 0.4 * fresh), strength: Math.min(1, 0.35 + fresh) });
  }
  for (const joint of fighter.broken ?? []) {
    if (store.broken.has(joint) || !MARK_JOINT[joint]) continue;
    store.broken.add(joint);
    const bone = BONE[MARK_JOINT[joint]];
    // (Come up already dark: a break swells and discolours at once.)
    if (frames[bone]) markAdd(fighter, bone, frames[bone], frames[bone].origin, null, null, { kind: MARK_KIND.blunt, reach: 0.085, strength: 1 }, markState.now - MARKS.bruiseSeconds * 0.6);
  }
}

/**
 * A man's marks put where his bones are now (`frames`), into his uniforms: called each frame for every man drawn.
 * `near`: whether he is near enough the camera for them to be drawn at all. The greatest of them first, as many as the tier draws.
 */
export function marksPose(fighter, frames, uniforms, time, near) {
  markState.now = time;
  const store = markStores.get(fighter);
  const most = MARK_SHARED.uMarkMost.value;
  if (!store || !store.count || !near || !frames || most < 1) {
    uniforms.uMarkCount.value = 0;
    return;
  }
  const { data, order } = store;
  // Which of them: all, or the `most` greatest (a few picks among eight at most).
  let drawn = Math.min(store.count, most);
  if (store.count <= most) for (let index = 0; index < store.count; index += 1) order[index] = index;
  else {
    let taken = 0;
    for (let pick = 0; pick < drawn; pick += 1) {
      let best = -1;
      for (let index = 0; index < store.count; index += 1) {
        if (taken & (1 << index)) continue;
        if (best < 0 || data[index * MARK_STRIDE + 17] > data[best * MARK_STRIDE + 17]) best = index;
      }
      taken |= 1 << best;
      order[pick] = best;
    }
  }
  const [A, B, C, D] = [uniforms.uMarkA.value, uniforms.uMarkB.value, uniforms.uMarkC.value, uniforms.uMarkD.value];
  for (let index = 0; index < drawn; index += 1) {
    const at = order[index] * MARK_STRIDE;
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
    D[to + 3] = data[at + 16];
    const dry = Math.min(1, Math.max(0, (age - MARKS.drySeconds[0]) / (MARKS.drySeconds[1] - MARKS.drySeconds[0])));
    if (kind === MARK_KIND.wound) {
      // Its blood spreads fast at first, then slower; it dries from wet red to a dark crust.
      C[to + 1] = data[at + 12] + data[at + 13] * (1 - Math.exp(-(3 * age) / MARKS.soakSeconds));
      C[to + 2] = data[at + 14];
      C[to + 3] = dry;
    } else {
      C[to + 1] = data[at + 13];
      // (A bruise is faint when it is struck and comes up after.)
      const up = Math.min(1, age / MARKS.bruiseSeconds);
      C[to + 2] = data[at + 14] * (kind === MARK_KIND.blunt ? 0.45 + 0.55 * up : 1);
      C[to + 3] = kind === MARK_KIND.spatter ? dry : up;
    }
  }
  uniforms.uMarkCount.value = drawn;
}
