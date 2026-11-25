// The way into play, done in steps across frames (main.js loadInto): a builder written as a generator (it yields between its
// pieces of work) is driven a slice at a time, each frame given about `LOAD.budgetMs` of it, so the loading screen over it
// keeps moving and the page answers. The work is the same and in the same order as when it is driven to its end at once
// (loftbody.js runSteps): only when each piece is done changes, never what is built. Nothing here touches the page.

/**
 * `budgetMs`: the work done in a frame before handing it back. A frame at 60 Hz is about 16.7 ms; the screen is a still
 * picture with a bar, so a frame of 40 ms (25 frames a second) still reads as moving, and the work gets most of the time.
 * `paintFrames`: the frames waited after the screen is put up before the work starts: the first frame lays the screen out,
 * the second is the one it is on (requestAnimationFrame runs before a frame is painted, so one is not enough).
 * `stages`: what is loaded, in order, with the share of the bar each takes; the shares are the measured split of a large
 * battle's wait on an M1 (the custom 500 and Pyongyang: the world about a tenth, the place a fifth, the men about two fifths,
 * the shaders a fifth), so the bar moves at about an even pace. A stage that has nothing to do is passed over at once.
 */
export const LOAD = {
  budgetMs: 40,
  paintFrames: 2,
  stages: [
    { key: 'world', share: 0.1 },
    { key: 'place', share: 0.22 },
    { key: 'men', share: 0.4 },
    { key: 'shaders', share: 0.22 },
    { key: 'frame', share: 0.06 },
  ],
  // A stage's work in steps of unknown number (the place, the world) moves its part of the bar this share of what is
  // left of it at each step: steadily, slowing, never past its end until the stage is done.
  creep: 0.3,
  // The shaders are prepared by drawing the scene a few materials at a time behind the screen (main.js warmShaderSteps):
  // a draw of them quicker than `fastMs` doubles the next batch, one slower than `slowMs` halves it, so a frame holds
  // about one budget of compiling whether the programs are new (tens to hundreds of ms each on an M1) or already cached.
  warm: { fastMs: 12, slowMs: 60 },
};

/** The bar's place for `stage` (a key of LOAD.stages) with `share` (0..1) of it done: 0..1 of the whole. */
export function loadFraction(stage, share = 0) {
  let before = 0;
  for (const entry of LOAD.stages) {
    if (entry.key === stage) return Math.min(1, before + entry.share * Math.max(0, Math.min(1, share)));
    before += entry.share;
  }
  return before;
}

/**
 * Follows the stages a load goes through: `enter(stage)`, then `step()` (a step of unknown number: the bar creeps) or
 * `count(done, total)` (a known one: the men raised, the shaders prepared). `now()`: { stage, share, fraction, done, total }.
 */
export function createLoadProgress() {
  const now = { stage: LOAD.stages[0].key, share: 0, fraction: 0, done: 0, total: 0 };
  const settle = () => {
    // (The bar never goes back: a stage entered out of order keeps the bar where it was.)
    now.fraction = Math.max(now.fraction, loadFraction(now.stage, now.share));
    return now;
  };
  return {
    enter(stage) {
      Object.assign(now, { stage, share: 0, done: 0, total: 0 });
      return settle();
    },
    step() {
      now.share += (1 - now.share) * LOAD.creep;
      return settle();
    },
    // (`share`: the stage's part done where the count is one pass of several: the shaders' passes over a castle.)
    count(done, total, share = total > 0 ? done / total : 1) {
      Object.assign(now, { done, total, share });
      return settle();
    },
    now: () => ({ ...now }),
  };
}

/**
 * Drive `steps` (a generator) to its end over frames: each frame, `next()` again and again until `budgetMs` has gone,
 * then wait for `nextFrame()`. Each value yielded is handed to `onStep`: a stage's key (LOAD.stages) as the builder goes on
 * to it, or nothing (a step within the stage). A step is never cut: one that takes longer than the budget takes its frame. Resolves to the generator's
 * return value; rejects with what it throws. `now`: the clock (ms).
 */
export async function runStepsOver(steps, { budgetMs = LOAD.budgetMs, nextFrame, onStep = () => {}, now = () => performance.now() } = {}) {
  for (;;) {
    const started = now();
    do {
      const next = steps.next();
      if (next.done) return next.value;
      onStep(next.value);
    } while (now() - started < budgetMs);
    await nextFrame();
  }
}

/** The work a load is given, as steps: a generator as it is, anything else (a plain function's call) one step. */
export function* stepsOf(work) {
  const made = work();
  if (made && typeof made.next === 'function' && typeof made[Symbol.iterator] === 'function') return yield* made;
  return made;
}
