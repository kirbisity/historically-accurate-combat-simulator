// The forward roll by body (physics/diveroll.js): each build walked or run forward on an open field, then stepping out
// (startEvade) with the stick still forward; what came of it, measured from his body in the simulation.
// Usage: node tools/diveroll.js   (a table: build, approach, outcome, dive to the hands, distance, time to his feet, slam)

import { P, PRESETS } from '../src/body.js';
import { advance, createWorld, placeFighter, point, startEvade } from '../src/physics.js';
import { diveRollOutlook } from '../src/physics/diveroll.js';

const FIELD = { halfX: 120, halfZ: 120 };
const DT = 1 / 60;

// Contrasting bodies (the references are an athletic man): presets and a few made for the comparison.
export const ROLL_BUILDS = {
  athlete: PRESETS.light,
  woman: { ...PRESETS.light, name: 'Small woman', sex: 'female', heightCm: 156, frame: 'small', age: 28, exercise: 0.6, calories: 2200 },
  old: { ...PRESETS.light, name: 'Old man', age: 80, exercise: 0.3, calories: 2300 },
  fat: PRESETS.sumo,
  starved: PRESETS.starved,
  plate: PRESETS.maximilian,
  knight: PRESETS.knight,
};

/**
 * One trial: `inputs` walked (`mode` 'walk', the guard's footwork) or run ('run', the run mode) forward for `approach` s, then the
 * step out. Returns { rolled, outcome ('up' on his feet from the roll, 'down' lost, 'step' no roll), speed at the step out (m/s),
 * dive (m, to the first hand on the floor), distance (m, pelvis, to his feet or down), roll (s, dive to feet), rise (s, to standing),
 * slam, events } and calls `frames(me, t, world)` each step.
 */
export function rollTrial(inputs, { mode = 'walk', approach = 1.6, seconds = 6, seed = 5, frames, setup } = {}) {
  const world = createWorld([{ inputs: structuredClone(inputs), corner: 'red' }, { inputs: structuredClone(PRESETS.light), corner: 'blue' }], { seed, arena: FIELD });
  const me = world.fighters[0];
  placeFighter(me, -100, 0);
  placeFighter(world.fighters[1], -100, 100);
  me.yaw = 0;
  advance(world, 0.6);
  setup?.(me, world);
  const go = () => {
    const pelvis = point(me.x, P.pelvis);
    me.goTo = [pelvis[0] + 5, 0, pelvis[2]];
    me.move = 1;
    me.running = mode === 'run';
    me.runMode = mode === 'run';
  };
  let t = 0;
  for (; t < approach; t += DT) {
    go();
    advance(world, DT);
    frames?.(me, t, world);
  }
  const speed = Math.hypot(...me.rootVelocity);
  const start = point(me.x, P.pelvis);
  const from = world.events.length;
  const tried = startEvade(world, me);
  const rolled = tried && Boolean(me.diveRoll);
  const outlook = diveRollOutlook(me, speed);
  const at = t;
  let dive = null;
  let feetAt = null;
  let stoodAt = null;
  let downAt = null;
  const hands = () => Math.min(point(me.x, P.lHand)[1], point(me.x, P.rHand)[1]) - me.radius[P.lHand] - (me.lift ?? 0) < 0.03;
  for (; t < at + seconds; t += DT) {
    me.move = 0;
    me.running = false;
    me.runMode = false;
    advance(world, DT);
    frames?.(me, t, world);
    if (rolled && dive === null && me.diveRoll && hands()) dive = point(me.x, P.pelvis)[0] - start[0];
    if (rolled && feetAt === null && me.state === 'rising' && !me.diveRoll && me.rise) feetAt = t + DT - at;
    if (downAt === null && me.state === 'down') downAt = t + DT - at;
    if (stoodAt === null && me.state === 'up' && t > at + 0.1) stoodAt = t + DT - at;
    if (stoodAt !== null && t > at + stoodAt + 0.3) break;
  }
  const events = world.events.slice(from).map((event) => `${event.kind}: ${event.effects?.join(', ') ?? ''}`);
  return {
    rolled, outcome: !rolled ? 'step' : downAt !== null ? 'down' : feetAt !== null ? 'up' : 'rolling', speed, outlook,
    dive, distance: point(me.x, P.pelvis)[0] - start[0], roll: feetAt, down: downAt, rise: stoodAt, slam: outlook.slam, events,
    trunk: me.damage.trunk ?? 0, stamina: me.stamina,
  };
}

if (import.meta.url === `file://${process.argv[1]}`) {
  for (const [name, inputs] of Object.entries(ROLL_BUILDS)) {
    for (const mode of ['walk', 'run']) {
      const run = rollTrial(inputs, { mode });
      const f = (value) => (value === null || value === undefined ? '-' : value.toFixed(2));
      console.log(`${name.padEnd(8)} ${mode.padEnd(4)} at ${f(run.speed)} m/s: ${run.outcome.padEnd(7)} dive ${f(run.dive)} m, travelled ${f(run.distance)} m, roll ${f(run.roll)} s, down ${f(run.down)} s, standing ${f(run.rise)} s, slam ${f(run.slam)} m/s, trunk ${f(run.trunk)} | ${run.events.join('; ')}`);
    }
  }
}
