// Adaptive resolution: when the frames run long because the graphics card cannot fill the pixels in time, the renderer's
// pixel ratio steps down (a battle starts at most at 1.5; on a ratio-1 screen 1 -> 0.75 -> 0.625 -> 0.5) and, once there is
// room again, back up. The canvas keeps its size on the page (the HUD and menus are the page's own, drawn at the screen's
// pixels): only the drawing buffer shrinks, and the browser stretches it over the canvas with linear filtering. A duel (a
// few men) has its own short ladder, no lower than three quarters of the screen's pixels across.
//
// Fewer pixels help only a frame that waits on the graphics card. A frame held up by the simulation and the AI (detailload.js
// sheds that load) would only be spoilt, so the card's own time for the frame is measured where the browser offers a timer
// (EXT_disjoint_timer_query_webgl2: `createGpuClock`), and without one the page's own work is weighed against the frame's
// length. With the card's time known a step up is taken when the step's dearer pixels are predicted to fit, not tried blind.
// The choices are plain functions of the frame times, so they run in Node (test/adaptres.test.js); `createAdaptiveResolution`
// applies them to a view (render.js createScene) from main.js's frame. On by default, with an off choice in the settings
// (remembered: `readDynamicResolution`).

/* global THREE */

import { rungsFor } from './levelmode/quality.js';

export const ADAPTIVE_RESOLUTION = {
  // A fight of fewer fighters than this is a duel: its own short ladder (`duelFloorShare`), started again at the full ratio when a battle shrinks to one.
  fewestFighters: 9,
  // A battle is drawn at no more than this pixel ratio. 2 against 1.5 is 1.78x the pixels, and from a battle's camera (10-25 m) the difference is
  // finer than a man's ink line; on an M1 Pro a 70-man battle at 2 paid 6.4 ms a frame more than at 1 (the duel ring, a man filling the screen, keeps 2).
  battleRatioMost: 1.5,
  // A duel that waits on the graphics card (a 1v1 at ratio 2 is fill-bound: 8.8 ms on an M1 Pro, most of it pixels) is drawn down to this share of
  // the screen's full ratio, no lower: the fighters fill the picture, and three quarters across (2 -> 1.5, 1 -> 0.75) is still a clean figure.
  duelFloorShare: 0.75,
  // Each step's share of the top ratio. Fill cost is the pixel count, so 0.75 of the ratio is 0.56 of the pixels, 0.625 is 0.39 and 0.5 is a quarter.
  // On a ratio-1 screen: 1, 0.75, 0.625, 0.5; a battle on a ratio-2 screen: 1.5, 1.125, then the floor.
  steps: [1, 0.75, 0.625, 0.5],
  // Never drawn with fewer than this share of the screen's full ratio across: half (a quarter of the pixels) is soft but still the picture, and
  // the HUD over it is untouched (the user's call, 2026-11-26). On a ratio-2 screen that is 1, the floor there before.
  floorShare: 0.5,
  // Nor with fewer drawing-buffer rows than this, whatever the share: a small window at half its rows would be a smear (the readable minimum;
  // a 2560x1440 canvas can go to 720 rows, a 1440x900 one stops at 0.6). A canvas shorter than this is never drawn under its own rows.
  minRows: 540,
  // Ratios are kept to this many steps of 1/1000: the same ladder each time, so a step back is the very size it was (no reallocation for a hair).
  ratioGrain: 1000,
  // ms between frames above which the game is losing frames (a 60 Hz screen asks 16.7; 21 is under 48 fps).
  slowMs: 21,
  // ms at or under which the screen is being kept up with (16.7 ms + a little for the clock's jitter).
  fastMs: 17.6,
  // Weight of each new frame in the smoothed time: a hitch (a garbage collection, a shader compiling) must not count as a slow second.
  smoothing: 0.08,
  // s the smoothed time must stay slow before one step down (long enough that a hitch is not it, short enough that a battle's first seconds are not a slideshow).
  slowSeconds: 0.8,
  // A frame this long (smoothed) is far behind, not a little: one step after only `severeSeconds`, so a slideshow at the stage's start is not endured for seconds.
  severeMs: 33,
  severeSeconds: 0.3,
  // s it must stay fast before one step up is tried. A screen held at 60 Hz looks the same at every step that keeps up, so this is the only way to find headroom: try, and go back if it was not there.
  fastSeconds: 6,
  // A frame is slow for want of pixels only if the page's own work (simulation, views, the draw calls) fills less than this share of it: the rest was spent waiting for the graphics card.
  // Past it the page is held up by the processor, which fewer pixels would not help (and the picture would be spoilt for nothing).
  gpuWaitShare: 0.8,
  // A step up that is followed by a step down within this many seconds failed: the wait before the next try is multiplied by `retryFactor`, up to `fastSecondsMost`.
  failSeconds: 5,
  retryFactor: 2,
  fastSecondsMost: 60,
  // Frames ignored after a change (the canvas is reallocated: that frame is slow, and a smoothed time from before means nothing now).
  settleFrames: 6,
  // ms: a frame this long was a stall (the tab was in the background), not the cost of drawing: ignored.
  stallMs: 250,
  // With the graphics card's own time for the frame (the timer query): the frame is waiting on the card, and fewer pixels would help, when the
  // card's time is at least this share of the frame's length (the card and the page work side by side, so a frame is as long as the longer of the
  // two; under this share the page is the long pole, and the step is not taken).
  gpuBusyShare: 0.7,
  // A step up is taken when the card's time, scaled by the step's pixels (ratio squared: an overestimate, since the vertex work does not grow with
  // them), is predicted under this share of the frame's length (never under a 60 Hz frame's 16.7 ms): well under `gpuBusyShare`, so the step up
  // cannot be the step down's reason (no oscillation).
  gpuUpShare: 0.6,
  budgetMs: 16.7,
  // s the prediction must say there is room before the step up (seconds rather than `fastSeconds`: nothing is tried blind).
  gpuUpSeconds: 2,
  // A step down must pay: measured `payCheckSeconds` after it, the card's time must be under this share of what it was. A frame whose card time is
  // not in the pixels (the shadows, the vertices of five hundred men, another page on the same card) loses nothing it can win back, so the step is
  // undone and no other is taken for `unpaidHoldSeconds` (doubled each time it happens again, up to `fastSecondsMost`). 0.85: the smallest step
  // has 0.64 of the pixels, so a frame that is even half fill clears it.
  paidShare: 0.85,
  payCheckSeconds: 1,
  unpaidHoldSeconds: 15,
};

/**
 * The size of a scene as adaptation counts it: the fighters in it, except that a stage (Level Mode) is always a big one, however small its
 * garrison (the castle, the sea and the rain fill the pixels, not the men).
 */
export function adaptiveSize(fighters, stage = false, config = ADAPTIVE_RESOLUTION) {
  return stage ? Math.max(config.fewestFighters, fighters) : fighters;
}

/** A ratio kept to the config's grain (so the same step is always the very same size). */
const grained = (ratio, config) => Math.round(ratio * config.ratioGrain) / config.ratioGrain;

/**
 * The lowest ratio a `full`-ratio screen is drawn at: `floorShare` of it (a duel's `duelFloorShare`), and never fewer drawing-buffer rows than
 * `minRows` for a canvas `rows` CSS pixels high (unknown: the share alone). Never over the full ratio.
 */
export function ratioFloor(full, config = ADAPTIVE_RESOLUTION, { duel = false, rows = null } = {}) {
  const share = duel ? config.duelFloorShare ?? 1 : config.floorShare;
  const readable = rows ? config.minRows / rows : 0;
  return Math.min(full, grained(Math.max(full * share, readable), config));
}

/**
 * The pixel ratios the steps give from a `full` ratio: descending, none under the floor (ratioFloor), each once. A battle's start at most at
 * `battleRatioMost`; a duel's (`duel`) from the full ratio. `rows`: the canvas's CSS height, for the readable minimum.
 */
export function ratioSteps(full, config = ADAPTIVE_RESOLUTION, { duel = false, rows = null } = {}) {
  const top = duel ? full : Math.min(full, config.battleRatioMost ?? full);
  const floor = Math.min(top, ratioFloor(full, config, { duel, rows }));
  // (The steps are shares of the top: a capped battle has its whole ladder under the cap.)
  const ratios = config.steps.map((share) => Math.min(top, Math.max(floor, grained(top * share, config))));
  return [...new Set(ratios)].sort((a, b) => b - a);
}

/** Whether a fight of `fighters` (adaptiveSize) is a duel, with its own ladder. */
export const isDuel = (fighters, config = ADAPTIVE_RESOLUTION) => fighters < config.fewestFighters;

export function newAdaptiveState() {
  return { level: 0, smoothed: null, work: null, gpu: null, paying: null, payFor: 0, holdDown: 0, unpaid: 0, slowFor: 0, severeFor: 0, fastFor: 0, sinceStep: Infinity, lastStep: 0, fastNeeded: null, settle: 0, duel: null };
}

/**
 * One frame. `state` is changed in place; returns the level wanted now (0 = full). `ms` is the time since the last frame, `work` the page's own
 * time in the last one (ms, null if unknown), `gpu` the graphics card's time for a recent frame (ms, null if not measured), `upCost` how many
 * times the pixels the step up has (null: not a step of pixels alone, so not predicted), `levels` how many ratios there are
 * (`ratioSteps(...).length`), `fighters` how many men are fighting.
 */
export function stepAdaptive(state, { ms, fighters, levels, work = null, gpu = null, upCost = null }, config = ADAPTIVE_RESOLUTION) {
  state.fastNeeded ??= config.fastSeconds;
  // A battle become a duel (or the other way): another ladder, walked from its top.
  const duel = isDuel(fighters, config);
  if (state.duel !== duel) Object.assign(state, newAdaptiveState(), { fastNeeded: config.fastSeconds, duel });
  state.level = Math.min(state.level, levels - 1);
  if (ms > config.stallMs) return state.level;
  const dt = ms / 1000;
  state.sinceStep += dt;
  if (state.settle > 0) {
    state.settle -= 1;
    return state.level;
  }
  const ease = (old, now) => (now === null ? null : old === null ? now : old + (now - old) * config.smoothing);
  state.smoothed = ease(state.smoothed, ms);
  state.work = ease(state.work, work);
  state.gpu = gpu === null ? state.gpu : ease(state.gpu, gpu);
  const timed = state.gpu !== null;
  state.holdDown = Math.max(0, state.holdDown - dt);
  // A step down being checked (no other is taken until it is): undone, and further ones held off, if it did not make the card's work shorter.
  if (state.paying !== null && timed) {
    state.payFor += dt;
    if (state.payFor >= config.payCheckSeconds) {
      const before = state.paying;
      state.paying = null;
      if (state.gpu > config.paidShare * before && state.level > 0) {
        state.holdDown = Math.min(config.fastSecondsMost, config.unpaidHoldSeconds * config.retryFactor ** state.unpaid);
        state.unpaid += 1;
        moved(state, -1, config);
        state.lastStep = 0;
        return state.level;
      }
    }
  }
  // Waiting on the card: by its own clock where there is one, else by the page's work leaving most of the frame idle.
  const waiting = timed ? state.gpu >= config.gpuBusyShare * state.smoothed : state.work === null || state.work < config.gpuWaitShare * state.smoothed;
  // Room for the step up: the card's time at the step's pixels predicted to fit; without the clock, frames kept up with for a long while.
  // (A step that also changes a stage's tier is not a matter of pixels alone: that one is tried as without the clock.)
  const predicted = timed && upCost !== null;
  const room = predicted ? state.gpu * upCost <= config.gpuUpShare * Math.max(config.budgetMs, state.smoothed) : state.smoothed <= config.fastMs;
  if (state.smoothed > config.slowMs && waiting) {
    state.slowFor += dt;
    state.severeFor = state.smoothed > config.severeMs ? state.severeFor + dt : 0;
    state.fastFor = 0;
  } else if (room) {
    state.fastFor += dt;
    state.slowFor = 0;
    state.severeFor = 0;
  } else {
    state.slowFor = 0;
    state.severeFor = 0;
    state.fastFor = 0;
  }
  // (A predicted step up waits the clock's shorter time, lengthened by the same failures as a blind one.)
  const needed = predicted ? config.gpuUpSeconds * (state.fastNeeded / config.fastSeconds) : state.fastNeeded;
  if ((state.slowFor >= config.slowSeconds || state.severeFor >= config.severeSeconds) && state.level < levels - 1 && state.holdDown <= 0 && state.paying === null) {
    // Down again soon after going up: the headroom was not there, so wait longer before the next try.
    if (state.lastStep < 0 && state.sinceStep < config.failSeconds) state.fastNeeded = Math.min(config.fastSecondsMost, state.fastNeeded * config.retryFactor);
    const before = state.gpu;
    moved(state, 1, config);
    state.paying = before;
  } else if (state.fastFor >= needed && state.level > 0) {
    moved(state, -1, config);
  }
  return state.level;
}

function moved(state, direction, config) {
  state.level += direction;
  state.lastStep = direction;
  state.sinceStep = 0;
  state.slowFor = 0;
  state.severeFor = 0;
  state.fastFor = 0;
  state.smoothed = null;
  state.work = null;
  state.gpu = null;
  state.paying = null;
  state.payFor = 0;
  state.settle = config.settleFrames;
}

/**
 * The graphics card's own clock (EXT_disjoint_timer_query_webgl2) for what is drawn between `begin()` and `end()`, read a few frames later
 * without waiting (`read()`: the newest time come in since the last read, in ms, or null if none). Null where the browser has no such timer (WebGL 1, Safari, a phone). A result
 * the card marks disjoint (its clock reset, a power change) is dropped. Only one such query can be open at a time: `begin` inside another
 * (looksbench.js's) is skipped.
 */
export function createGpuClock(gl, { inFlight = 4 } = {}) {
  const ext = typeof WebGL2RenderingContext !== 'undefined' && gl instanceof WebGL2RenderingContext ? gl.getExtension('EXT_disjoint_timer_query_webgl2') : null;
  if (!ext) return null;
  const pending = [];
  const free = [];
  let open = null;
  return {
    begin() {
      if (open || pending.length >= inFlight || gl.isContextLost() || gl.getQuery(ext.TIME_ELAPSED_EXT, gl.CURRENT_QUERY)) return;
      open = free.pop() ?? gl.createQuery();
      gl.beginQuery(ext.TIME_ELAPSED_EXT, open);
    },
    end() {
      if (!open) return;
      gl.endQuery(ext.TIME_ELAPSED_EXT);
      pending.push(open);
      open = null;
    },
    read() {
      if (gl.isContextLost()) return null;
      const disjoint = gl.getParameter(ext.GPU_DISJOINT_EXT);
      let latest = null;
      while (pending.length && gl.getQueryParameter(pending[0], gl.QUERY_RESULT_AVAILABLE)) {
        const query = pending.shift();
        if (!disjoint) latest = gl.getQueryParameter(query, gl.QUERY_RESULT) / 1e6;
        free.push(query);
      }
      return latest;
    },
  };
}

export const DYNAMIC_RESOLUTION_KEY = 'gladiator.dynamicResolution';

/** Whether adaptive resolution is on, as remembered in `storage` (on unless turned off). Never throws: a private window has no storage. */
export function readDynamicResolution(storage) {
  try {
    return storage?.getItem(DYNAMIC_RESOLUTION_KEY) !== 'off';
  } catch {
    return true;
  }
}

/** Remember on or off. */
export function writeDynamicResolution(storage, on) {
  try {
    storage?.setItem(DYNAMIC_RESOLUTION_KEY, on ? 'on' : 'off');
  } catch {
    // Nothing kept: the next visit starts on.
  }
}

/**
 * The controller for a view: `frame(view, ms, fighters, { tiered })` once a frame sets the renderer's pixel ratio (and, in a stage, tells `onTier` which quality tier
 * the rung it is on has: quality.js); `set(false)` puts it back to full and keeps it there. A ratio someone else set (a look's own) is taken as the new full one.
 * `pin(rung)` holds one rung (0: the best, `Infinity`: the last) whatever the frame times say; `pin(null)` lets go. `gpuBegin(renderer)` and `gpuEnd()` round
 * the frame's drawing put the card's own time for it into the choice.
 */
export function createAdaptiveResolution(config = ADAPTIVE_RESOLUTION) {
  const state = newAdaptiveState();
  let enabled = true;
  let full = null;
  let applied = null;
  let work = null;
  let pinned = null;
  let tier = 'high';
  let tiered = false;
  let onTier = null;
  let duel = false;
  let rows = null;
  let clock = null;
  let clockFor = null;
  // The card's time as measured, smoothed, whatever the controller is doing (for `info`: also off or pinned), and the ratio it was measured at.
  let measured = null;
  let measuredAt = null;
  const size = new THREE.Vector2();

  function apply(view, ratio) {
    const renderer = view.renderer;
    if (renderer.getPixelRatio() === ratio) return;
    // (setPixelRatio sizes the drawing buffer from the CSS size it was given, and leaves the canvas's style alone.)
    renderer.setPixelRatio(ratio);
    // Our own ratio, not a new full one (the full one itself is nobody's change).
    applied = ratio === full ? null : ratio;
    // A look that draws to its own targets (a composer) sizes them by the ratio.
    renderer.getSize(size);
    view.look?.resize?.(view, size.x, size.y);
  }

  /** The rungs: pixel ratios with a tier each in a stage; ratios alone elsewhere. */
  const ladder = () => (tiered ? rungsFor(full, ratioFloor(full, config, { rows })) : ratioSteps(full, config, { duel, rows }).map((ratio) => ({ ratio, tier: 'high' })));

  function setTier(next) {
    if (next === tier) return;
    tier = next;
    onTier?.(tier);
  }

  const api = {
    config,
    state,
    get enabled() {
      return enabled;
    },
    get tier() {
      return tier;
    },
    /** Called with the tier's name whenever the rung changes it. */
    set onTier(callback) {
      onTier = callback;
    },
    /** On or off (off: full ratio now, and left alone). */
    set(on, view) {
      enabled = !!on;
      if (!enabled && view && full !== null) {
        apply(view, full);
        Object.assign(state, newAdaptiveState());
      }
      return enabled;
    },
    /** Hold one rung (a number; `Infinity` is the last one), or null to let the frame times decide. The best rung (0) is the full picture. */
    pin(rung, view = null) {
      pinned = rung;
      Object.assign(state, newAdaptiveState());
      if (view && full !== null) {
        const rungs = ladder();
        const at = rung === null ? 0 : Math.min(rung, rungs.length - 1);
        apply(view, rungs[at].ratio);
        setTier(rungs[at].tier);
      }
      return pinned;
    },
    /** What it is doing now: { enabled, level, ratio, full, tier, pinned, smoothedMs, gpuMs (the card's, at this ratio), timed, rungs }. */
    info(view) {
      const round = (ms) => (ms === null ? null : Math.round(ms * 10) / 10);
      return { enabled, level: state.level, ratio: view.renderer.getPixelRatio(), full, tier, pinned, smoothedMs: round(state.smoothed), gpuMs: round(measured), timed: Boolean(clock), rungs: full === null ? [] : ladder().map((rung) => rung.ratio) };
    },
    /** The page's own work in the frame just done (ms), for the next `frame` to tell waiting for the graphics card from being held up by the processor. */
    worked(ms) {
      work = ms;
    },
    /** Open the card's clock round this frame's drawing (nothing where the browser has none). */
    gpuBegin(renderer) {
      const gl = renderer.getContext();
      if (clockFor !== gl) {
        clockFor = gl;
        clock = createGpuClock(gl);
      }
      clock?.begin();
    },
    gpuEnd() {
      clock?.end();
    },
    frame(view, ms, fighters, options = {}) {
      const current = view.renderer.getPixelRatio();
      rows = view.renderer.getSize(size).y || null;
      const gpu = clock?.read() ?? null;
      if (measuredAt !== current) measured = null;
      measuredAt = current;
      if (gpu !== null) measured = measured === null ? gpu : measured + (gpu - measured) * config.smoothing;
      // A stage has tiers; the first frame of one starts at the best.
      if (Boolean(options.tiered) !== tiered) {
        tiered = Boolean(options.tiered);
        Object.assign(state, newAdaptiveState());
        if (!tiered) setTier('high');
      }
      // Anything but our own change is a new full ratio (a look, the page's zoom).
      if (full === null || (applied !== null ? current !== applied : current !== full)) {
        full = current;
        applied = null;
        Object.assign(state, newAdaptiveState());
      }
      duel = isDuel(fighters, config);
      const rungs = ladder();
      if (pinned !== null) {
        const at = Math.min(pinned, rungs.length - 1);
        if (rungs[at].ratio !== current) apply(view, rungs[at].ratio);
        if (tiered) setTier(rungs[at].tier);
        return;
      }
      if (!enabled) {
        // Off: the full ratio (a battle's cap is part of adapting, and goes with it).
        if (current !== full) apply(view, full);
        return;
      }
      const at = Math.min(state.level, rungs.length - 1);
      const up = at > 0 && rungs[at - 1].tier === rungs[at].tier ? (rungs[at - 1].ratio / rungs[at].ratio) ** 2 : null;
      const level = stepAdaptive(state, { ms, fighters, levels: rungs.length, work, gpu, upCost: up }, config);
      const rung = rungs[level];
      if (rung.ratio !== current) apply(view, rung.ratio);
      if (tiered) setTier(rung.tier);
    },
  };
  return api;
}
