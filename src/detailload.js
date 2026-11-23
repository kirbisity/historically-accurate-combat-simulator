// Large battles (KB spec 2026-11-21-large-battles): when the simulation cannot keep up, the circle of men kept in full round the
// man played and the camera shrinks (tableduel.js keptInFull, tableEligible: `far` and `inFull` by the world's `detailShare`), and
// when steps come easily again it grows back. Only where the table is on (tableduel.js tableOn); a world nobody sets a share on (the
// tools, the tests, every battle with the table off) is as before. The choices are plain functions of the step times, so they run in
// Node (test/detailload.test.js); main.js's tick measures the steps and applies them, as adaptres.js does the pixels.
//
// Measured (Sarhu at 500 men, the think and step run alone, 30 s): 53.0 ms a step at a share of 1, 38.7 at 0.7, 36.9 at 0.5, the
// men down (red, blue) 89/11, 92/8 and 85/8; at 0.5 over two seeds and 60 s, 131/12 and 158/15 against 143/18 and 147/14 at 1.

export const DETAIL_LOAD = {
  // ms a step (thinking and physics, STEP s of the world) may cost before the circle shrinks: a 60 Hz frame is 16.7 ms, and the
  // drawing needs its share of it.
  slowMs: 12,
  // ms at or under which there is room to grow it back.
  easyMs: 7,
  // Weight of each frame's step time in the smoothed one: a hitch (a garbage collection) is not a slow second.
  smoothing: 0.1,
  // s the smoothed time must stay slow before one step down, easy before one step up (slower up: a grown circle that cannot be kept
  // is shrunk again within slowSeconds, and men passing in and out of full would show).
  slowSeconds: 0.5,
  easySeconds: 4,
  // Each step's change of the share, and the least share: 0.6 is full within 7.2 m of the man played and the camera, and the 22
  // nearest besides. (0.7 saved nearly all 0.5 did: under 0.6 the poses come nearer him for little.)
  by: 0.1,
  floor: 0.6,
  // ms: a frame's step this long was a stall (the tab in the background), not the cost of the men: ignored.
  stallMs: 500,
};

export function newDetailLoad() {
  return { share: 1, smoothed: null, slowFor: 0, easyFor: 0 };
}

/**
 * One frame's measure: `msPerStep` the cost of each step it took, over `seconds` of real time. The share after it (`load.share`,
 * changed in place).
 */
export function keepDetailLoad(load, msPerStep, seconds, config = DETAIL_LOAD) {
  if (!(msPerStep >= 0) || msPerStep > config.stallMs) return load.share;
  load.smoothed = load.smoothed === null ? msPerStep : load.smoothed + (msPerStep - load.smoothed) * config.smoothing;
  load.slowFor = load.smoothed > config.slowMs ? load.slowFor + seconds : 0;
  load.easyFor = load.smoothed <= config.easyMs ? load.easyFor + seconds : 0;
  const round = (share) => Math.round(share * 1000) / 1000;
  if (load.slowFor >= config.slowSeconds && load.share > config.floor) {
    load.share = round(Math.max(config.floor, load.share - config.by));
    load.slowFor = 0;
  } else if (load.easyFor >= config.easySeconds && load.share < 1) {
    load.share = round(Math.min(1, load.share + config.by));
    load.easyFor = 0;
  }
  return load.share;
}
