// Wet bodies drawn: sweat on a working man's skin, water on what stood in it or under the rain, mud from soft ground.
// The state is wetness.js's (a few numbers at points down each segment of the body, the same for every body); this
// file feeds it from the world each frame (wetUpdate) and draws it, in one patch laid over every lit material a
// fighter is drawn with (wetDress), whatever the material is of: skin, cloth, leather, steel, lacquer, hair.
//
// What a wet surface looks like follows from what it is, read in the shader from the material's own numbers:
//   - a porous surface (rough and not metal: cloth, leather, hair, wood) takes the water into its pores, so it
//     scatters less light back: darker and more saturated, and once it holds all it can a film stands on it too;
//   - a smooth or metal one (skin, plate, lacquer) takes none, darkens hardly at all, and carries the water on top:
//     a film, and where it is only sweat or the first of the rain, beads, which join into runs down it when it is
//     very wet;
//   - the film is a second surface over the first: smooth water (2% mirror face on, all of it at a glance), so it
//     gives the sun back as a sharp highlight and the sky as a sheen at the rim, whatever is under it. That light is
//     added over the material's own (as a lacquer's coat is), not made by smoothing the material: wet cloth is still
//     cloth under its water.
// Sweat is made at the skin: it beads on bare skin, reaches cloth lying on it only as a darker damp patch, and never
// shows on plate. Where each point of a surface gets its numbers is worked out per vertex from where it is in the
// world against the body's segments, so a helmet, a skirt, a glove and the skin under them all take the wetness of
// the part of the body they are on with no word from the outfit.
//
// The cost: a dry man's materials skip all of it on one uniform; a wet one's vertices walk ten segments, and his
// pixels take one tap of a small tiled map of drops (two when water runs on him; none on the low tier).

/* global THREE */

import { P, SEGMENTS } from './body.js';
import { WORLD } from './physics/config.js';
import { climateOf, evaporationShare, sweatWatts } from './physics/heat.js';
import { softAt, worksOf } from './physics/fieldworks.js';
import { ceilingAt } from './physics/terrain.js';
import { stageWaters, waterContains, worksWaters } from './levelmode/water.js';
import { stormLook } from './levelmode/storm.js';
import { stageLookOf } from './levelmode/stagelooks.js';
import { tkWeatherNow } from './townkit/weather.js';
import { bloodDyeWaterAt } from './blooddye.js';
import { ENV } from './env/config.js';
import { MUD_VIEW } from './mudview.js';
import { MARKS, markShader, marksPose, markUniforms } from './markview.js';
import { WET, WET_CHANNEL, WET_COUNT, WET_POINTS, WET_SEGMENTS, createWetness, setWetness, stepWetness, wetHeights, wetSummary } from './wetness.js';

export const WET_VIEW = {
  // The tiled map of drops: `pixels` square over `tile` m of surface; `drops` beads on it, each `radius` m across
  // (sweat and rain bead at a millimetre or two on skin).
  pixels: 256,
  tile: 0.075,
  drops: 150,
  radius: [0.0008, 0.0026],
  // The film's roughness (GGX alpha) as a sheet on a smooth surface, on a wholly porous one (`cloth`) and as a bead, and how strongly a bead tilts the light.
  film: 0.16,
  cloth: 0.27,
  bead: 0.07,
  tilt: 1.1,
  // The film's highlight of the sun and its sheen of the sky, as shares of what a water surface gives back (by eye
  // against photographs of wet skin and soaked jackets in daylight: the game's sun and sky are not a camera's).
  sun: 1.5,
  sky: 0.85,
  rim: 0.45,
  // (The highlight and the sheen were 0.8 and 0.5, and a bead's rim 0.18 darker: sweat then read as dark specks on the
  // skin and a soaked jacket as only a darker one. What shows water on a body in daylight is its glint.)
  // A bead bends the light through it: the surface under its rim is this much darker (what shows a bead in flat light),
  // and wet skin a little darker all over (`skin`: the film lets more light into it).
  lens: 0.05,
  skin: 0.1,
  // Pores full: a porous surface's colour raised to 1 + `deepen` (darker and more saturated at once, as a wet
  // cloth's is) and dimmed by `dim` (white cloth greys).
  deepen: 0.85,
  dim: 0.2,
  // A damp patch (sweat through cloth): this share of a soaking's darkening at most.
  damp: 0.4,
  // Mud, wet and dried (sRGB, mudview.js's clay and the same paled).
  mud: { wet: MUD_VIEW.colour.low.map((value) => value / 255), dry: MUD_VIEW.colour.high.map((value) => (value / 255) * 1.35) },
  // Runs slide down a soaked surface at this many tiles a second.
  runPace: 0.35,
  // A man's state is stepped once in this many frames (his turn by his place in the list), his segments' places each frame.
  every: 4,
  // Drops falling off a soaked man: at most this many in the air, `rate` a second from a man wet through, seen within `near` m.
  drips: { most: 160, rate: 14, near: 22, length: 0.045, life: 1.2 },
  // Hair, cloth and what hangs, wet through: see hairswing.js, clothsway.js, dangle.js (their `wet`).
};

const WET_VIEW_ENDS = WET_SEGMENTS.map((name) => [P[SEGMENTS[name].from], P[SEGMENTS[name].to]]);
const SEGMENTS_N = WET_SEGMENTS.length;

// Shared by every wet material: the drops, the clock, the tier (0: no drops, 1: drops, 2: and runs).
const WET_SHARED = { uWetDrops: { value: null }, uWetTime: { value: 0 }, uWetTier: { value: 2 } };

/** The tier of the picture ('low', 'medium', 'high'): drops and runs are left out below. */
export function wetTier(tier) {
  WET_SHARED.uWetTier.value = tier === 'low' ? 0 : tier === 'medium' ? 1 : 2;
}

// ---- the drops ------------------------------------------------------------------------------------------------------

/**
 * The tiled map every wet surface reads: r, g a bead's slope across and down the tile; b how soon that bead forms
 * as the surface wets (1 at once .. near 0 last; 0: no bead here), so they come one by one and each from its middle
 * (the map's own softening lowers b at a bead's rim); a a soft patchiness two or three
 * centimetres across, by which a surface wets and dries in blots and a tide line is not ruled.
 */
function dropsTexture() {
  const { pixels, tile, drops, radius } = WET_VIEW;
  const data = new Uint8Array(pixels * pixels * 4);
  let seed = 12345;
  const random = () => {
    seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0;
    return seed / 4294967296;
  };
  // Patchiness: value noise of three octaves on a lattice that wraps.
  const lattice = (cells) => {
    const values = Float32Array.from({ length: cells * cells }, random);
    return (u, v) => {
      const x = u * cells;
      const y = v * cells;
      const i = Math.floor(x);
      const j = Math.floor(y);
      const fx = x - i;
      const fy = y - j;
      const sx = fx * fx * (3 - 2 * fx);
      const sy = fy * fy * (3 - 2 * fy);
      const at = (a, b) => values[(((b % cells) + cells) % cells) * cells + (((a % cells) + cells) % cells)];
      return at(i, j) * (1 - sx) * (1 - sy) + at(i + 1, j) * sx * (1 - sy) + at(i, j + 1) * (1 - sx) * sy + at(i + 1, j + 1) * sx * sy;
    };
  };
  const octaves = [lattice(3), lattice(7), lattice(13)];
  for (let row = 0; row < pixels; row += 1) {
    for (let column = 0; column < pixels; column += 1) {
      const u = column / pixels;
      const v = row / pixels;
      const at = (row * pixels + column) * 4;
      data[at] = data[at + 1] = 128;
      data[at + 3] = Math.round(255 * Math.min(1, Math.max(0, 0.6 * octaves[0](u, v) + 0.32 * octaves[1](u, v) + 0.08 * octaves[2](u, v))));
    }
  }
  // Beads: caps of a sphere, the small ones first to form.
  for (let drop = 0; drop < drops; drop += 1) {
    const size = radius[0] + (radius[1] - radius[0]) * random() ** 2;
    const r = (size / tile) * pixels;
    const cx = random() * pixels;
    const cy = random() * pixels;
    const forms = Math.round(255 * (1 - 0.8 * Math.min(1, 0.35 * random() + 0.65 * (size - radius[0]) / (radius[1] - radius[0]))));
    for (let dy = -Math.ceil(r); dy <= Math.ceil(r); dy += 1) {
      for (let dx = -Math.ceil(r); dx <= Math.ceil(r); dx += 1) {
        const far = Math.hypot(dx, dy) / r;
        if (far >= 1) continue;
        const column = (((Math.round(cx) + dx) % pixels) + pixels) % pixels;
        const row = (((Math.round(cy) + dy) % pixels) + pixels) % pixels;
        const at = (row * pixels + column) * 4;
        // (The cap's slope: steep at its rim, flat on top.)
        const slope = far / Math.sqrt(Math.max(0.08, 1 - far * far));
        const lean = Math.min(1, slope * 0.55) / Math.max(far, 1e-3);
        data[at] = Math.round(128 + 127 * Math.max(-1, Math.min(1, (dx / r) * lean)));
        data[at + 1] = Math.round(128 + 127 * Math.max(-1, Math.min(1, (dy / r) * lean)));
        data[at + 2] = Math.max(1, forms);
      }
    }
  }
  const texture = new THREE.DataTexture(data, pixels, pixels, THREE.RGBAFormat);
  texture.wrapS = texture.wrapT = THREE.RepeatWrapping;
  texture.magFilter = THREE.LinearFilter;
  texture.minFilter = THREE.LinearMipmapLinearFilter;
  texture.generateMipmaps = true;
  texture.needsUpdate = true;
  return texture;
}

// ---- the shader -----------------------------------------------------------------------------------------------------

const glsl = (value) => (Number.isInteger(value) ? `${value}.0` : String(value));
const vec3 = (values) => `vec3( ${values.map((value) => value.toFixed(3)).join(', ')} )`;

const WET_VERTEX_PARS = `#include <common>
uniform float uWetOn;
uniform vec4 uWetFrom[ ${SEGMENTS_N} ];
uniform vec3 uWetTo[ ${SEGMENTS_N} ];
uniform vec4 uWet[ ${WET_COUNT} ];
varying vec4 vWet;
varying vec4 vWetAt;
varying vec3 vWetNormal;
varying vec3 vWetView;
#ifdef WET_SKIN_MASK
attribute float wetSkin;
#endif`;

// After the vertex is where it will be drawn: its wetness, from the body's segments by how near each is (each to its
// own thickness: uWetFrom.w), read along the segment between its points; the rain on it by how far its face looks up.
const WET_VERTEX = `#include <project_vertex>
#ifdef WET_SKIN_MASK
vWetAt = vec4( position, wetSkin );
#else
vWetAt = vec4( position, 1.0 );
#endif
vWetNormal = normalize( transformedNormal );
vWetView = - mvPosition.xyz;
vWet = vec4( 0.0 );
if ( uWetOn > 0.5 ) {
	vec4 wetWorld = vec4( transformed, 1.0 );
	#ifdef USE_INSTANCING
		wetWorld = instanceMatrix * wetWorld;
	#endif
	vec3 wetPoint = ( modelMatrix * wetWorld ).xyz;
	vec4 wetSum = vec4( 0.0 );
	float wetTotal = 0.0;
	for ( int s = 0; s < ${SEGMENTS_N}; s ++ ) {
		vec3 wetA = uWetFrom[ s ].xyz;
		vec3 wetAB = uWetTo[ s ] - wetA;
		vec3 wetAP = wetPoint - wetA;
		float wetT = clamp( dot( wetAP, wetAB ) / max( dot( wetAB, wetAB ), 1e-6 ), 0.0, 1.0 );
		float wetFar = max( length( wetAP - wetAB * wetT ) - uWetFrom[ s ].w, 0.0 ) + 0.012;
		float wetShare = 1.0 / ( wetFar * wetFar * wetFar * wetFar );
		float wetAlong = wetT * ${glsl(WET_POINTS - 1)};
		int wetFirst = int( min( wetAlong, ${(WET_POINTS - 1 - 0.001).toFixed(3)} ) );
		wetSum += wetShare * mix( uWet[ s * ${WET_POINTS} + wetFirst ], uWet[ s * ${WET_POINTS} + wetFirst + 1 ], wetAlong - float( wetFirst ) );
		wetTotal += wetShare;
	}
	wetSum /= wetTotal;
	float wetUp = inverseTransformDirection( vWetNormal, viewMatrix ).y;
	float wetRain = clamp( wetSum.w * ( 0.7 + 1.3 * max( wetUp, 0.0 ) ), 0.0, 1.0 );
	vWet = vec4( max( wetSum.x, wetRain ), wetSum.y, wetSum.z, wetUp );
}`;

const WET_FRAGMENT_PARS = `#include <common>
uniform float uWetOn;
uniform float uWetTier;
uniform float uWetTime;
uniform vec3 uWetKind;
uniform sampler2D uWetDrops;
#ifndef OBJECTSPACE_NORMALMAP
uniform mat3 normalMatrix;
#endif
varying vec4 vWet;
varying vec4 vWetAt;
varying vec3 vWetNormal;
varying vec3 vWetView;
float wetFilm = 0.0;
float wetBead = 0.0;
float wetCoarse = 0.0;
vec3 wetTilt = vec3( 0.0 );`;

// Once the material knows its own colour, roughness and metal: what the water does to the surface itself (its pores,
// the mud on it), and what stands on it (the film, the beads and runs: lit at the end, WET_FRAGMENT_LIGHT).
const wetSurface = () => `#include <emissivemap_fragment>
if ( uWetOn > 0.5 && ( vWet.x + vWet.y + vWet.z ) > 0.004 ) {
	#ifdef STANDARD
		float wetPorous = roughnessFactor * ( 1.0 - metalnessFactor );
	#else
		float wetPorous = uWetKind.z;
	#endif
	// (Skin takes no water; hair takes it as cloth does, whatever its sheen.)
	float wetSkin = uWetKind.x * vWetAt.w;
	wetPorous = max( mix( wetPorous, 0.12, wetSkin ), uWetKind.y );
	float wetSmooth = 1.0 - smoothstep( 0.3, 0.7, wetPorous );
	// The drops' map, laid on the surface where it was made (so it neither swims nor stretches as the body moves),
	// on whichever of its three planes the face lies nearest; y is down the body on two of them, for the runs.
	vec2 wetUv = vWetAt.xy;
	vec3 wetAcross = vec3( 1.0, 0.0, 0.0 );
	vec3 wetDown = vec3( 0.0, 1.0, 0.0 );
	#if __VERSION__ >= 300
		vec3 wetFace = abs( cross( dFdx( vWetAt.xyz ), dFdy( vWetAt.xyz ) ) );
		if ( wetFace.x > wetFace.y && wetFace.x > wetFace.z ) { wetUv = vWetAt.zy; wetAcross = vec3( 0.0, 0.0, 1.0 ); }
		else if ( wetFace.y > wetFace.z ) { wetUv = vWetAt.xz; wetDown = vec3( 0.0, 0.0, 1.0 ); }
	#endif
	wetUv /= ${glsl(WET_VIEW.tile)};
	vec4 wetDrops = uWetTier > 0.5 ? texture2D( uWetDrops, wetUv ) : vec4( 0.5, 0.5, 0.0, 0.5 );
	float wetBlot = wetDrops.a - 0.5;
	float wetWater = vWet.x;
	// Soaked: a porous surface shows the water it holds from less of it than a smooth one keeps on its face.
	float wetEdge = mix( 0.56, 0.32, wetPorous );
	float wetSoaked = smoothstep( wetEdge - 0.07, wetEdge + 0.07, wetWater + wetBlot * 0.3 );
	float wetDeep = wetSoaked * mix( 0.6, 1.0, wetWater );
	// Sweat: a sheen and then beads on skin; through cloth, a damp patch.
	float wetSheen = wetSkin * smoothstep( 0.04, 0.45, vWet.y );
	float wetDamp = ( 1.0 - wetSkin ) * smoothstep( 0.45, 0.9, vWet.y + wetBlot * 0.2 ) * ${glsl(WET_VIEW.damp)};
	// Mud lies over whatever it is on, wet clay where the water still is and paler dried.
	float wetMud = smoothstep( 0.38, 0.6, vWet.z + wetBlot * 0.5 );
	if ( wetMud > 0.0 ) {
		diffuseColor.rgb = mix( diffuseColor.rgb, mix( ${vec3(WET_VIEW.mud.dry)}, ${vec3(WET_VIEW.mud.wet)}, wetSoaked ) * ( 0.75 + 0.5 * wetDrops.a ), wetMud * 0.92 );
		wetPorous = mix( wetPorous, 0.85, wetMud );
		wetSmooth *= 1.0 - wetMud;
		#ifdef STANDARD
			metalnessFactor *= 1.0 - wetMud;
			roughnessFactor = mix( roughnessFactor, 0.9, wetMud );
		#endif
	}
	float wetDark = wetPorous * max( wetDeep, wetDamp );
	diffuseColor.rgb = pow( max( diffuseColor.rgb, vec3( 0.0 ) ), vec3( 1.0 + ${glsl(WET_VIEW.deepen)} * wetDark ) ) * ( 1.0 - ${glsl(WET_VIEW.dim)} * wetDark );
	// The film: at once on a smooth surface, on a porous one only when its pores are full.
	wetFilm = max( wetDeep * mix( 1.0, smoothstep( 0.45, 0.9, wetWater ), wetPorous ), wetSheen * 0.8 );
	// Beads on a smooth surface (each forms at its own wetness), and runs down it when it streams.
	float wetBeads = wetSmooth * max( wetSkin * smoothstep( 0.2, 0.95, vWet.y ), wetSoaked * 0.9 );
	vec2 wetSlope = vec2( 0.0 );
	if ( wetDrops.b > 0.004 ) {
		wetBead = smoothstep( 0.0, 0.12, wetDrops.b + wetBeads - 1.0 );
		wetSlope = ( wetDrops.rg - 0.5 ) * 2.0 * wetBead;
	}
	float wetStream = max( wetSkin * smoothstep( 0.7, 1.0, vWet.y ), wetSoaked * smoothstep( 0.72, 1.0, wetWater ) ) * ( 1.0 - 0.8 * abs( vWet.w ) );
	if ( uWetTier > 1.5 && wetStream > 0.01 ) {
		vec4 wetRun = texture2D( uWetDrops, vec2( wetUv.x * 1.7 + 0.37, wetUv.y * 0.11 + uWetTime * ${glsl(WET_VIEW.runPace)} * 0.11 ) );
		float wetRuns = smoothstep( 0.0, 0.2, wetRun.b + wetStream - 1.0 ) * mix( 0.5, 1.0, wetSmooth );
		wetSlope.x += ( wetRun.r - 0.5 ) * 2.0 * wetRuns;
		wetBead = max( wetBead, wetRuns );
	}
	wetFilm = max( wetFilm, wetBead );
	// (The film over a weave or a grain is not a sheet of glass: it follows the surface under it.)
	wetCoarse = wetPorous;
	diffuseColor.rgb *= ( 1.0 - ${glsl(WET_VIEW.lens)} * min( 1.0, length( wetSlope ) ) ) * ( 1.0 - ${glsl(WET_VIEW.skin)} * wetSkin * max( wetSheen, wetSoaked ) );
	// (The slope turned from the surface's own space to the eye's: near enough for a bead, whose light only has to move.)
	wetTilt = normalMatrix * ( wetAcross * wetSlope.x + wetDown * wetSlope.y ) * ${glsl(WET_VIEW.tilt)};
}`;

// The water's own light, over the material's: the sun (each directional light) off the film, and the sky off it by
// where the mirrored ray looks (the scene's ambient, its probe and its hemisphere light, read that way). A figure's
// material knows the sun's shadow on it (looks/kit.js shadeFigure: figureLit, declared where it makes receiveShadow
// a macro); the film takes it.
const wetLight = () => `if ( wetFilm > 0.002 ) {
	vec3 wetN = normalize( vWetNormal );
	#ifdef DOUBLE_SIDED
		wetN *= gl_FrontFacing ? 1.0 : - 1.0;
	#endif
	// (The sky is mirrored by the film as a sheet: a bead is too small to show more of it than a point, and many of them
	// tilted every way would only veil the surface in grey.)
	vec3 wetFlat = wetN;
	wetN = normalize( wetN + wetTilt );
	vec3 wetV = normalize( vWetView );
	float wetNV = clamp( dot( wetN, wetV ), 0.0, 1.0 );
	float wetAlpha = mix( mix( ${glsl(WET_VIEW.film)}, ${glsl(WET_VIEW.cloth)}, wetCoarse ), ${glsl(WET_VIEW.bead)}, wetBead );
	float wetA2 = wetAlpha * wetAlpha;
	vec3 wetGlint = vec3( 0.0 );
	float wetShade = 1.0;
	#ifdef receiveShadow
		wetShade = figureLit;
	#endif
	#if NUM_DIR_LIGHTS > 0
	for ( int i = 0; i < NUM_DIR_LIGHTS; i ++ ) {
		vec3 wetL = directionalLights[ i ].direction;
		vec3 wetH = normalize( wetL + wetV );
		float wetNL = clamp( dot( wetN, wetL ), 0.0, 1.0 );
		float wetNH = clamp( dot( wetN, wetH ), 0.0, 1.0 );
		float wetD = wetNH * wetNH * ( wetA2 - 1.0 ) + 1.0;
		float wetF = 0.02 + 0.98 * pow( 1.0 - clamp( dot( wetV, wetH ), 0.0, 1.0 ), 5.0 );
		wetGlint += directionalLights[ i ].color * ( wetNL * wetF * wetA2 / ( wetD * wetD ) / ( 4.0 * max( wetNV, 0.35 ) ) ) * ( i == 0 ? wetShade : 1.0 );
	}
	#endif
	wetFlat = normalize( wetFlat + wetTilt * 0.5 );
	vec3 wetR = reflect( - wetV, wetFlat );
	vec3 wetSky = ambientLightColor + shGetIrradianceAt( inverseTransformDirection( wetR, viewMatrix ), lightProbe );
	#if NUM_HEMI_LIGHTS > 0
	for ( int i = 0; i < NUM_HEMI_LIGHTS; i ++ ) {
		wetSky += mix( hemisphereLights[ i ].groundColor, hemisphereLights[ i ].skyColor, 0.5 + 0.5 * dot( wetR, hemisphereLights[ i ].direction ) );
	}
	#endif
	// (At a glance a film on a body is never the perfect mirror still water is: its mirror face is held to WET_VIEW.rim.)
	float wetRim = 0.02 + ${glsl(WET_VIEW.rim - 0.02)} * pow( 1.0 - clamp( dot( wetFlat, wetV ), 0.0, 1.0 ), 5.0 );
	gl_FragColor.rgb += wetFilm * ( wetGlint * ${glsl(WET_VIEW.sun)} + wetSky * wetRim * ${glsl(WET_VIEW.sky)} * mix( 0.6, 1.0, wetShade ) );
}
#include <tonemapping_fragment>`;

/** Whether a material is one the patch is for: lit by the renderer's own shaders. */
const wetLit = (material) => material.isMeshStandardMaterial || material.isMeshLambertMaterial || material.isMeshPhongMaterial || material.isMeshToonMaterial;

/**
 * Lay the wetness over a lit material (once): `wet` the body's uniforms (wetUniforms), `kind` what the surface is
 * where its numbers cannot say ({ skin, hair }), `mask` whether its geometry says which of its points are skin (the
 * `wetSkin` attribute: a body's mesh carries its painted cloth too). The material's other patches are kept and run
 * first, and their includes are left where they were for those laid on afterwards.
 */
function wetMaterial(material, wet, { skin = false, hair = false, mask = false } = {}) {
  // (The hook is the mark, as looks/kit.js shadeFigure's is: a clone keeps userData and not the hook.)
  for (let hook = material.onBeforeCompile; hook; hook = hook.previous) if (hook.wets) return;
  if (!wetLit(material)) return;
  WET_SHARED.uWetDrops.value ??= dropsTexture();
  const previous = material.onBeforeCompile;
  const baseKey = material.customProgramCacheKey();
  // (x: skin; y: at least this porous, hair; z: how rough a material with no roughness of its own was asked to be, toon.js surface.)
  const kind = { value: new THREE.Vector3(skin ? 1 : 0, hair ? 0.9 : 0, material.userData.wetRough ?? 0.8) };
  const patched = (shader, renderer) => {
    previous.call(material, shader, renderer);
    if (shader.fragmentShader.includes('uWetOn') || !shader.fragmentShader.includes('#include <emissivemap_fragment>') || !shader.vertexShader.includes('#include <project_vertex>')) return;
    Object.assign(shader.uniforms, WET_SHARED, wet, { uWetKind: kind });
    const define = mask ? '#define WET_SKIN_MASK\n' : '';
    shader.vertexShader = define + shader.vertexShader.replace('#include <common>', WET_VERTEX_PARS).replace('#include <project_vertex>', WET_VERTEX);
    shader.fragmentShader = shader.fragmentShader
      .replace('#include <common>', WET_FRAGMENT_PARS)
      .replace('#include <emissivemap_fragment>', wetSurface())
      .replace('#include <tonemapping_fragment>', wetLight());
    // The marks of blows (markview.js): laid in with the wetness, on the same uniforms.
    markShader(shader);
  };
  patched.previous = previous;
  patched.wets = true;
  material.onBeforeCompile = patched;
  material.customProgramCacheKey = () => `${baseKey}|wet${mask ? 'm' : ''}`;
  material.needsUpdate = true;
}

/** A body's uniforms: whether anything on it is wet, its segments (from, with its thickness; to) and its points' numbers. */
function wetUniforms(values = new Float32Array(WET_COUNT * 4)) {
  return { uWetOn: { value: 0 }, uWetFrom: { value: new Float32Array(SEGMENTS_N * 4) }, uWetTo: { value: new Float32Array(SEGMENTS_N * 3) }, uWet: { value: values }, ...markUniforms() };
}

// (What is drawn dry for good: the warmers' zero-area triangles, whose programs a fighter's materials then share.)
const WET_NEVER = wetUniforms();

/**
 * A warmer's material (render.js shaderWarmers: a program built before the fight for a material that appears in it)
 * patched as a fighter's will be, so the program it builds is the one the fighter's asks for. `mask`: a body's skin.
 */
export function wetWarm(material, mask = false) {
  wetMaterial(material, WET_NEVER, { skin: mask, mask });
  return material;
}

// ---- a fighter's state and his dress --------------------------------------------------------------------------------

// A fighter's wetness outlives his drawing (a view is made again when his skin is swapped or his helmet falls).
const wet_states = new WeakMap();

/** The wetness of a fighter (wetness.js), made dry the first time it is asked for. */
export function wetnessOf(fighter) {
  let state = wet_states.get(fighter);
  if (!state) wet_states.set(fighter, (state = Object.assign(createWetness(), { held: null, sweated: null, wait: 0, mudAt: -Infinity })));
  return state;
}

/**
 * Lay the wetness over everything a fighter's view draws him with, and over what is added to it later (called again
 * when his skin is swapped in; a material patched already is passed over). Skin is told by its material's
 * `userData.wetKind` ('skin'; a photographed face is skin) or, on a body's mesh, point by point (the `wetSkin`
 * attribute); hair by 'hair' or its mesh's marks.
 */
export function wetDress(fighterView) {
  const state = wetnessOf(fighterView.fighter);
  const wet = (fighterView.wet ??= { uniforms: wetUniforms(state.values), state, radii: null, hairDangles: [] });
  fighterView.group.traverse((object) => {
    if (!object.isMesh || !object.material) return;
    const mask = Boolean(object.geometry.attributes?.wetSkin);
    const hairMesh = Boolean(object.userData.photoHair || object.userData.photoBeard || object.userData.photoHairRim);
    for (const material of Array.isArray(object.material) ? object.material : [object.material]) {
      const kind = material.userData.wetKind;
      wetMaterial(material, wet.uniforms, { skin: mask || kind === 'skin' || Boolean(material.userData.photoFace), hair: hairMesh || kind === 'hair', mask });
    }
  });
  // Which of what hangs from him is hair (a curtain down the back): it takes the head's wetness, the rest his clothes'.
  wet.hairDangles = (fighterView.dangles ?? []).map((dangle) => {
    let hair = false;
    dangle.group?.traverse((object) => {
      if (object.isMesh && [].concat(object.material).some((material) => material?.userData.wetKind === 'hair')) hair = true;
    });
    return hair;
  });
  return fighterView;
}

// ---- the world: where the water, the mud and the rain are ---------------------------------------------------------------

// A world's bodies of water (a stage's, and a battle's standing on its soft ground), found once.
const worldWaters = new WeakMap();

function wet_watersOf(world) {
  let found = worldWaters.get(world);
  if (!found) {
    const works = world.arena ? worksOf(world.arena) : null;
    found = { works, waters: [...(world.stage?.def ? stageWaters(world.stage.def) : []), ...worksWaters(works)] };
    worldWaters.set(world, found);
  }
  return found;
}

/** The rain coming down on the place now, 0..1 of a full fall, before any roof: the open air's, a town's, a stage's storm. */
function rainNow(view, world) {
  if (view.env?.on) {
    const fall = view.env.weather?.fall;
    return fall?.kind === 'rain' ? (view.env.falling ?? 0) * (fall.share ?? 1) : 0;
  }
  if (world.stage) {
    const rain = stageLookOf(stormLook())?.rain;
    return rain?.opacity > 0 ? rain.share ?? 1 : 0;
  }
  if (view.weather?.town) return tkWeatherNow().rain ?? 0;
  return 0;
}

/** The share of the rain that reaches a man at (x, y, z): none under a ceiling, less under the crowns of an open-air place. */
function rainReaching(view, world, x, y, z) {
  const terrain = world.arena?.terrain;
  if (terrain?.ceilings && ceilingAt(terrain, x, z, y) < Infinity) return 0;
  // (The open air's near map says how much of the sky each point of the ground sees: env/terrain.js envCover, its r.)
  const cover = view.env?.on ? view.env.group?.userData?.envMap?.envCover?.image : null;
  if (!cover?.data) return 1;
  const half = ENV.terrain.mapHalf;
  if (Math.abs(x) >= half || Math.abs(z) >= half) return 1;
  const column = Math.min(cover.width - 1, Math.floor((x / (2 * half) + 0.5) * cover.width));
  const row = Math.min(cover.height - 1, Math.floor((z / (2 * half) + 0.5) * cover.height));
  return cover.data[(row * cover.width + column) * 4] / 255;
}

/** Whether the place on show draws any water of its own (asked once a place: most draw none). */
function placeHasFilms(view) {
  const place = view.places?.[view.place];
  if (view.wetFilms?.place !== place) view.wetFilms = { place, has: Boolean(place?.children?.some((child) => child.userData?.bloodDyeWater?.length)) };
  return view.wetFilms.has || Boolean(view.works?.group?.userData?.bloodDyeWater?.length);
}

const AIR = { water: -Infinity, mud: -Infinity, speed: 0, rain: 0, sweat: 0, evaporation: 1, wind: 0, sun: 0, cover: 0 };

/** Fill AIR for a man: the water and mud he stands in, the rain on him, the heat he must sweat off, the air about him. */
function airFor(view, world, fighter, state, dt, rain) {
  const x = fighter.x;
  const px = x[P.pelvis * 3];
  const pz = x[P.pelvis * 3 + 2];
  let low = Infinity;
  for (let index = 1; index < x.length; index += 3) if (x[index] < low) low = x[index];
  const { works, waters } = wet_watersOf(world);
  AIR.water = -Infinity;
  for (const water of waters) {
    if (low > water.at[1] || !waterContains(water, px, pz)) continue;
    if (water.at[1] > AIR.water) AIR.water = water.at[1];
  }
  // The sea round a stage (physics/terrain.js `sea`).
  const sea = world.arena?.terrain?.sea;
  if (sea > -Infinity && sea > AIR.water && low < sea) AIR.water = sea;
  // Water a place only draws (a puddle, a wet floor: blooddye.js knows them all): a film on the ground he touches.
  if (AIR.water === -Infinity && !world.stage && placeHasFilms(view)) {
    const film = bloodDyeWaterAt(view, px, pz);
    if (film.wet > 0.3) AIR.water = low - WET.low + 0.03 * film.wet;
  }
  // Soft ground of mud: its surface is the field's own level.
  const soft = softAt(works, px, pz);
  AIR.mud = soft?.area.surface === 'mud' && !soft.area.bare ? MUD_VIEW.lift * soft.share * 0.5 : -Infinity;
  AIR.speed = Math.hypot(fighter.rootVelocity?.[0] ?? 0, fighter.rootVelocity?.[1] ?? 0);
  AIR.rain = rain > 0 ? rain * rainReaching(view, world, px, x[P.head * 3 + 1], pz) : 0;
  // His sweat: the heat he could not lose dry since the last look (physics/heat.js keeps the sum), or what his core's
  // heat calls for over what it does at rest, whichever is more; per m² of his skin.
  const heat = fighter.heat;
  const kit = heat?.kit;
  const area = kit?.area ?? 1.9;
  const sum = heat?.toSweat ?? 0;
  const surplus = state.sweated === null || sum < state.sweated || dt <= 0 ? 0 : (sum - state.sweated) / dt;
  state.sweated = sum;
  const core = heat ? sweatWatts(heat.core) - sweatWatts(WORLD.heat.core) : 0;
  AIR.sweat = fighter.state === 'out' ? 0 : Math.max(surplus, core, 0) / area;
  AIR.cover = kit?.cover ?? 0;
  AIR.evaporation = evaporationShare(world.climate ?? climateOf(null));
  AIR.wind = view.clothWindNow?.speed ?? 0;
  AIR.sun = view.env?.on ? Math.min(1, view.env.weather?.sun ?? 0) : 0;
  return AIR;
}

// ---- each frame ---------------------------------------------------------------------------------------------------------

let wetFrame = 0;

/**
 * Each frame, after the fighters' views are placed: every `WET_VIEW.every`th frame a man's wetness is stepped from
 * where he is and what he is doing, and every frame a wet man's segments are told to his materials, his hair and
 * cloth told how wet they are, and drops fall off him. `dt`: the fight's seconds this frame (0 paused).
 */
export function wetUpdate(view, world, fighterViews, dt) {
  if (!world) return;
  wetFrame += 1;
  if (dt > 0) WET_SHARED.uWetTime.value = (WET_SHARED.uWetTime.value + dt) % 1000;
  const rain = rainNow(view, world);
  for (let index = 0; index < fighterViews.length; index += 1) {
    const fighterView = fighterViews[index];
    const wet = fighterView.wet;
    if (!wet) continue;
    const fighter = fighterView.fighter;
    const state = wet.state;
    state.wait += dt;
    if ((wetFrame + index) % WET_VIEW.every === 0 && (state.wait > 0 || state.held?.fresh)) {
      const scale = (fighter.body.heightM ?? 1.75) / 1.75;
      wetHeights(fighter.x, state.heights, scale);
      stepWetness(state, airFor(view, world, fighter, state, state.wait, rain), state.wait);
      state.wait = 0;
      if (state.held) {
        setWetness(state, state.held);
        state.held.fresh = false;
      }
    }
    // The marks blows left on him (markview.js), where his bones are now; none drawn far from the camera.
    marksPose(fighter, fighterView.frames, wet.uniforms, world.time, fighterView.group.visible && (fighter.x[24] - view.camera.position.x) ** 2 + (fighter.x[26] - view.camera.position.z) ** 2 < MARKS.far ** 2);
    wet.uniforms.uWetOn.value = state.any ? 1 : 0;
    const swing = fighterView.bones?.swing;
    if (swing) swing.wet.value = state.cloth;
    if (!state.any) continue;
    // His segments, where they are now.
    const radii = (wet.radii ??= segmentRadii(fighter.body));
    const from = wet.uniforms.uWetFrom.value;
    const to = wet.uniforms.uWetTo.value;
    const x = fighter.x;
    for (let segment = 0; segment < SEGMENTS_N; segment += 1) {
      const a = WET_VIEW_ENDS[segment][0] * 3;
      const b = WET_VIEW_ENDS[segment][1] * 3;
      from[segment * 4] = x[a];
      from[segment * 4 + 1] = x[a + 1];
      from[segment * 4 + 2] = x[a + 2];
      from[segment * 4 + 3] = radii[segment];
      to[segment * 3] = x[b];
      to[segment * 3 + 1] = x[b + 1];
      to[segment * 3 + 2] = x[b + 2];
    }
    if (fighterView.baked) continue;
    const hairSwing = fighterView.head?.hairSwing;
    if (hairSwing) hairSwing.wet = state.hair;
    const dangles = fighterView.dangles;
    for (let k = 0; k < dangles.length; k += 1) dangles[k].wet = wet.hairDangles[k] ? state.hair : state.cloth;
    if (dt > 0 && state.soaked > 0.7 && fighterView.group.visible) drip(view, fighter, state, dt);
  }
  dripsUpdate(view, dt);
}

/** Each segment's thickness (m) for a body: its skin's radius, the head's its own. */
function segmentRadii(body) {
  return Float32Array.from(WET_SEGMENTS, (name) => (name === 'head' ? body.lengths.headRadius * 0.8 : body.segments[name]?.skinRadius ?? 0.06));
}

// ---- drops falling off a soaked man -------------------------------------------------------------------------------------

function dripsOf(view) {
  if (view.wetDrips) return view.wetDrips;
  const { most } = WET_VIEW.drips;
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.BufferAttribute(new Float32Array(most * 6), 3));
  geometry.setDrawRange(0, 0);
  const lines = new THREE.LineSegments(geometry, new THREE.LineBasicMaterial({ color: 0xdfe6ea, transparent: true, opacity: 0.55, depthWrite: false }));
  lines.frustumCulled = false;
  lines.userData.shared = true;
  view.scene.add(lines);
  // Each drop: where it is, how fast it falls, the height it ends at, what is left of its life.
  view.wetDrips = { lines, at: new Float32Array(most * 3), fall: new Float32Array(most), floor: new Float32Array(most), left: new Float32Array(most), next: 0, live: 0 };
  return view.wetDrips;
}

/** Drops from a man wet through: off the points that hold most water, more the wetter he is, only near the camera. */
function drip(view, fighter, state, dt) {
  const spec = WET_VIEW.drips;
  const x = fighter.x;
  const eye = view.camera.position;
  if (Math.hypot(x[P.pelvis * 3] - eye.x, x[P.pelvis * 3 + 2] - eye.z) > spec.near) return;
  let count = spec.rate * (state.soaked - 0.7) / 0.3 * dt;
  count = Math.floor(count) + (Math.random() < count % 1 ? 1 : 0);
  if (!count) return;
  const drips = dripsOf(view);
  let low = Infinity;
  for (let index = 1; index < x.length; index += 3) if (x[index] < low) low = x[index];
  for (let made = 0; made < count; made += 1) {
    const point = Math.floor(Math.random() * WET_COUNT);
    const at = point * 4;
    if (Math.max(state.values[at + WET_CHANNEL.water], state.values[at + WET_CHANNEL.rain]) < 0.7) continue;
    const [a, b] = WET_VIEW_ENDS[Math.floor(point / WET_POINTS)];
    const t = (point % WET_POINTS) / (WET_POINTS - 1);
    const slot = drips.next;
    drips.next = (drips.next + 1) % spec.most;
    for (let axis = 0; axis < 3; axis += 1) drips.at[slot * 3 + axis] = x[a * 3 + axis] + (x[b * 3 + axis] - x[a * 3 + axis]) * t + (axis === 1 ? -0.04 : (Math.random() - 0.5) * 0.12);
    drips.fall[slot] = 0;
    drips.floor[slot] = low - WET.low;
    drips.left[slot] = spec.life;
  }
}

function dripsUpdate(view, dt) {
  const drips = view.wetDrips;
  if (!drips || (!drips.live && !drips.left.some((left) => left > 0))) return;
  const spec = WET_VIEW.drips;
  const position = drips.lines.geometry.attributes.position;
  const array = position.array;
  let live = 0;
  for (let slot = 0; slot < spec.most; slot += 1) {
    if (drips.left[slot] <= 0) continue;
    drips.fall[slot] += WORLD.gravity * dt;
    drips.at[slot * 3 + 1] -= drips.fall[slot] * dt;
    drips.left[slot] -= dt;
    if (drips.at[slot * 3 + 1] < drips.floor[slot]) drips.left[slot] = 0;
    if (drips.left[slot] <= 0) continue;
    // (A streak as long as it falls in a frame's exposure, a little at least.)
    const streak = spec.length + drips.fall[slot] * 0.012;
    array.set([drips.at[slot * 3], drips.at[slot * 3 + 1], drips.at[slot * 3 + 2], drips.at[slot * 3], drips.at[slot * 3 + 1] + streak, drips.at[slot * 3 + 2]], live * 6);
    live += 1;
  }
  drips.live = live;
  drips.lines.geometry.setDrawRange(0, live * 2);
  drips.lines.visible = live > 0;
  position.needsUpdate = true;
}

// ---- for a review -------------------------------------------------------------------------------------------------------

/**
 * Hold the fighters of `fighterViews` in a state (boxer.wet, boxer.sweat, boxer.mud): `values` as wetness.js
 * setWetness takes ({ water, sweat, mud, rain, level }), merged over what is held already; null lets them go, to dry
 * and sweat as the world has it from where they were left. Returns each man's summary.
 */
export function wetHold(fighterViews, values) {
  return fighterViews.map((fighterView) => {
    const state = wetnessOf(fighterView.fighter);
    if (values === null) state.held = null;
    else {
      state.held = { ...(state.held ?? {}), ...values, fresh: true };
      wetHeights(fighterView.fighter.x, state.heights, (fighterView.fighter.body.heightM ?? 1.75) / 1.75);
      setWetness(state, state.held);
    }
    wetSummary(state);
    return wetInfo(state);
  });
}

/** A man's wetness in a few numbers (for the console and the tests). */
export function wetInfo(state) {
  const round = (value) => Math.round(value * 1000) / 1000;
  const most = (channel) => {
    let value = 0;
    for (let at = channel; at < WET_COUNT * 4; at += 4) value = Math.max(value, state.values[at]);
    return round(value);
  };
  return { any: state.any, hair: round(state.hair), cloth: round(state.cloth), sweat: round(state.skin), brow: round(state.values[(WET_POINTS - 1) * 4 + WET_CHANNEL.sweat]), water: most(WET_CHANNEL.water), rain: most(WET_CHANNEL.rain), mud: most(WET_CHANNEL.mud), drive: round(state.drive) };
}
