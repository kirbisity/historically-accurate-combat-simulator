// How wet a body is, part by part: the water on it from what it stood in and from the rain, the sweat on its skin, the
// mud it took from soft ground. One model for every body, whatever it wears: the state is a number or four at a row of
// points down each of the body's segments (body.js SEGMENTS: the head, the trunk, the arms, the legs), and nothing here
// knows what covers them. What a wet surface looks like is the drawing's business (wetview.js), which reads these
// numbers and the surface's own material; nothing here is read by the physics.
//
//   water  what stood water left: a part held under a surface is wet at once, to the surface and no higher, and dries
//          from there (so its edge, the tide line, creeps back down the limb as it dries);
//   rain   what has fallen on it: it rises slowly with the rain coming down on a man in the open, and the drawing lays
//          it on the faces that look up first (shoulders, the crown, the tops of the arms) and on the rest as it nears 1;
//   sweat  the film on the skin. A working body must lose its surplus heat by evaporating sweat; the skin stays dry
//          while the air can take all of it, glistens as the sweat made nears what the air can take (the physiologists'
//          skin wettedness, Gagge: the sweat required over the most that can evaporate), and beads and runs past that.
//          It is made unevenly (the brow, the chest and back and the armpits most, the hands and shins least: Smith &
//          Havenith 2011's maps of regional sweat rate);
//   mud    what soft ground left on the parts that went into it; it stays, and pales as the water in it dries.
//
// All four are 0..1. A step costs a pass over the points (forty), allocates nothing, and may be taken a few times a
// second: nothing here moves faster than that.

import { P, SEGMENTS } from './body.js';
import { WORLD } from './physics/config.js';

/** The segments the points lie along, each from one particle to another (trunk and head upward, the limbs outward). */
export const WET_SEGMENTS = ['head', 'trunk', 'lUpperArm', 'rUpperArm', 'lForearm', 'rForearm', 'lThigh', 'rThigh', 'lShank', 'rShank'];
/** Points along each segment, its two ends among them. */
export const WET_POINTS = 4;
export const WET_COUNT = WET_SEGMENTS.length * WET_POINTS;
/** The four numbers kept at each point, in this order (one vec4 a point for the shader). */
export const WET_CHANNEL = { water: 0, sweat: 1, mud: 2, rain: 3 };

const SEGMENT_ENDS = WET_SEGMENTS.map((name) => [P[SEGMENTS[name].from], P[SEGMENTS[name].to]]);

export const WET = {
  // Sweat made at each point of a segment, as a multiple of the body's mean (from the segment's first particle to its
  // last: the head from the neck to the brow, the trunk from the hips to the neck, an arm from the armpit down).
  sweatShare: {
    head: [1.5, 1.7, 2, 2], trunk: [0.9, 1.2, 1.5, 1.5],
    lUpperArm: [1.4, 1, 0.8, 0.8], rUpperArm: [1.4, 1, 0.8, 0.8], lForearm: [0.8, 0.7, 0.6, 0.5], rForearm: [0.8, 0.7, 0.6, 0.5],
    lThigh: [0.9, 0.7, 0.6, 0.6], rThigh: [0.9, 0.7, 0.6, 0.6], lShank: [0.6, 0.5, 0.4, 0.3], rShank: [0.6, 0.5, 0.4, 0.3],
  },
  // The sweat's clock. A bout here is over in a minute or two, and in that time a real body has made a few grams of
  // sweat to the square metre: nothing to see. The game's fights are a round's work pressed into tens of seconds (its
  // stamina empties as fast), so the glands answer and make sweat `pace` times faster than the body's own: a man who
  // has fought hard for a minute looks as one who has fought a few rounds. What the air takes off is left at its own
  // rate (he does not dry in seconds once he stops). 1 is the body's own time.
  pace: 4,
  // The sweat glands answer the heat to be lost with a lag (s): sweating starts within a minute or so of hard work and
  // takes minutes to stop after it.
  sweatLag: 45,
  // The most that evaporates from wholly wet bare skin in the reference air (WORLD.heat.reference), W per m² (a man
  // moving a little in still air: an evaporative coefficient of ~35 W/m²/kPa over a ~4.5 kPa gap), and how much each
  // m/s of wind adds to it (forced convection, roughly linear at these speeds).
  evaporation: 150,
  windShare: 0.25,
  // The film: 1 is `filmJoules` of sweat lying on each m² (as its heat of evaporation: ~30 g/m², a skin beaded all
  // over, more than which runs off); the skin is wet all over (and evaporates at its most) from `filmWet`.
  filmJoules: 73000,
  filmWet: 0.4,
  // Rain: seconds of rain at its full fall to wet a man through (heavy rain soaks a shirt in a minute or two).
  soak: 90,
  // Drying: seconds for a soaked point to dry in the reference air with no wind, quicker by `windShare` per m/s and by
  // `sunShare` in the sun; nothing dries while rain falls on it.
  dry: 600,
  sunShare: 0.4,
  // Stood water: a point is wet through when it is under the surface by `band` m and half wet at the surface itself,
  // so the line drawn between two points (wetview.js: at half) lies at the water's height wherever it falls between
  // them. `low`: how far below its particle a foot reaches (m, for a 1.75 m man): the sole.
  band: 0.14,
  low: 0.07,
  // Mud: taken as water is, to the mud's surface and as far above it as a moving foot throws it (`splash` m per m/s,
  // at most `splashMost`); rain washes it off in `wash` s of full fall.
  splash: 0.06,
  splashMost: 0.25,
  wash: 400,
  // Hair hangs heavy and cloth clings by how wet they are; sweat alone wets hair this far at its most.
  sweatHair: 0.35,
};

// (Flat lookups: the share of sweat at each point and how far below its particle the point reaches.)
const SWEAT_SHARE = Float32Array.from(WET_SEGMENTS.flatMap((name) => WET.sweatShare[name]));
const LOW = Float32Array.from(WET_SEGMENTS.flatMap((name) => (name.endsWith('Shank') ? [0, 0, 0, WET.low] : [0, 0, 0, 0])));
const HEAD_TOP = WET_SEGMENTS.indexOf('head') * WET_POINTS + WET_POINTS - 1;

/** A dry body: `values` is the four numbers at each point (WET_CHANNEL), `heights` where each point is (m, wetHeights). */
export function createWetness() {
  return { values: new Float32Array(WET_COUNT * 4), heights: new Float32Array(WET_COUNT), drive: 0, any: false, hair: 0, cloth: 0, skin: 0, soaked: 0 };
}

/** Where each point is now: its height (m) from the particles `x` (physics: three numbers a particle), a foot's to its sole. */
export function wetHeights(x, out, scale = 1) {
  for (let segment = 0; segment < SEGMENT_ENDS.length; segment += 1) {
    const from = x[SEGMENT_ENDS[segment][0] * 3 + 1];
    const to = x[SEGMENT_ENDS[segment][1] * 3 + 1];
    for (let k = 0; k < WET_POINTS; k += 1) {
      const index = segment * WET_POINTS + k;
      out[index] = from + ((to - from) * k) / (WET_POINTS - 1) - LOW[index] * scale;
    }
  }
  return out;
}

/** How wet a point at `height` is left by a surface at `level`: 0.5 at the surface, 1 a band under it, 0 a band over. */
const under = (level, height) => Math.max(0, Math.min(1, 0.5 + (level - height) / WET.band));

/**
 * The most that evaporates from wet skin (W/m²) in air that takes `evaporation` of what the reference air does
 * (physics/heat.js evaporationShare), in `wind` m/s, under kit that covers `cover` of the skin (0..1).
 */
export function evaporationMost(evaporation = 1, wind = 0, cover = 0) {
  return WET.evaporation * evaporation * (1 + WET.windShare * wind) * (1 - WORLD.heat.evapBlocked * cover);
}

/**
 * `dt` seconds on a body. `air`, all optional:
 *   water, mud   the height (m) of the water's and the mud's surface where he is (-Infinity: none); `speed`, his own
 *                over the ground (m/s: mud is thrown up a moving leg);
 *   rain         what falls on him now, 0..1 of a full fall (nothing under a roof);
 *   sweat        the heat his body must lose by sweating now, W per m² of skin;
 *   evaporation  the air's share of the reference air's evaporation; wind (m/s); sun (0..1); cover (0..1 of his skin
 *                under kit that keeps sweat from evaporating).
 * `state.heights` must be current (wetHeights). Returns the state, its summary (wetSummary) made again.
 */
export function stepWetness(state, air, dt) {
  const { values, heights } = state;
  const water = air.water ?? -Infinity;
  const mud = air.mud ?? -Infinity;
  const rain = Math.max(0, Math.min(1, air.rain ?? 0));
  const evaporation = air.evaporation ?? 1;
  const wind = air.wind ?? 0;
  // The glands follow the heat to be lost.
  state.drive += ((air.sweat ?? 0) - state.drive) * (1 - Math.exp((-dt * WET.pace) / WET.sweatLag));
  const most = evaporationMost(evaporation, wind, air.cover ?? 0);
  const drying = (dt / WET.dry) * evaporation * (1 + WET.windShare * wind) * (1 + WET.sunShare * (air.sun ?? 0)) * (1 - rain);
  const thrown = mud > -Infinity ? Math.min(WET.splashMost, WET.splash * (air.speed ?? 0)) : 0;
  for (let index = 0, at = 0; index < WET_COUNT; index += 1, at += 4) {
    const height = heights[index];
    // Water: dries, and is wet again to the surface he stands in.
    let wet = Math.max(0, values[at] - drying);
    if (water > -Infinity) wet = Math.max(wet, under(water, height));
    // Mud, wet as it comes: to its own surface and as far up as he throws it.
    let muddy = Math.max(0, values[at + 2] - (rain * dt) / WET.wash);
    if (mud > -Infinity) {
      const taken = under(mud + thrown, height);
      if (taken > muddy) muddy = taken;
      wet = Math.max(wet, under(mud, height));
    }
    values[at] = wet;
    values[at + 2] = muddy;
    // Rain: falls on every part alike (the drawing lays it on the faces that look up).
    values[at + 3] = Math.max(0, Math.min(1, values[at + 3] + (rain * dt) / WET.soak - drying));
    // Sweat: what the glands make here less what the air takes off the wetted share of the skin.
    const film = values[at + 1];
    const made = state.drive * SWEAT_SHARE[index];
    values[at + 1] = Math.max(0, Math.min(1, film + ((made * WET.pace - most * Math.min(1, film / WET.filmWet)) * dt) / WET.filmJoules));
  }
  return wetSummary(state);
}

/**
 * Put a body in a state, for a review or a test: `water`, `sweat`, `mud`, `rain` 0..1 everywhere (those not given are
 * left); with `level` (m) the water is instead laid as stood water to that height (state.heights current).
 */
export function setWetness(state, { water, sweat, mud, rain, level } = {}) {
  const { values, heights } = state;
  for (let index = 0, at = 0; index < WET_COUNT; index += 1, at += 4) {
    if (level !== undefined) values[at] = under(level, heights[index]) * (water ?? 1);
    else if (water !== undefined) values[at] = water;
    if (sweat !== undefined) values[at + 1] = sweat * Math.min(1, SWEAT_SHARE[index] / 1.5 + 0.25);
    if (mud !== undefined) values[at + 2] = mud;
    if (rain !== undefined) values[at + 3] = rain;
  }
  if (sweat !== undefined) state.drive = 0;
  return wetSummary(state);
}

/**
 * What the rest of the drawing asks of a body's wetness: `any` (something to draw), `hair` (how wet the head's is: it
 * hangs heavy and sticks), `cloth` (how soaked what he wears is, over his trunk and limbs: it clings), `skin` (the
 * sweat on him, the mean), `soaked` (the wettest point: water runs off it).
 */
export function wetSummary(state) {
  const { values } = state;
  let cloth = 0;
  let skin = 0;
  let most = 0;
  let any = 0;
  for (let at = 0; at < WET_COUNT * 4; at += 4) {
    const wet = Math.max(values[at], values[at + 3]);
    if (at >= WET_POINTS * 4) cloth += wet;
    skin += values[at + 1];
    if (wet > most) most = wet;
    any = Math.max(any, wet, values[at + 1], values[at + 2]);
  }
  const top = HEAD_TOP * 4;
  state.hair = Math.max(values[top], values[top + 3], WET.sweatHair * values[top + 1]);
  state.cloth = cloth / (WET_COUNT - WET_POINTS);
  state.skin = skin / WET_COUNT;
  state.soaked = most;
  state.any = any > 0.004;
  return state;
}
