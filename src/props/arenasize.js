// The amphitheatre's size (render.js builds it, the cameras keep inside it). About half the Colosseum's own: its sand was
// 83 by 48 m inside a building 188 by 156 m and 48 m high (the usual published figures, approximate), on 80 arches.
import { WORLD } from '../physics/config.js';

export const COLOSSEUM = {
  // The sand's half-axes inside the podium wall (m).
  rx: 22,
  rz: 13,
  // The seats: how many rows, each `step` of the sand's half-axis deep and `rise` m over the one below.
  tiers: 22,
  step: 0.04,
  rise: 0.62,
};

// The subway platform as a fighting floor (props/subway.js draws it): the platform's half-axes (m), and the drop past its
// edge 0.75 m beyond the side wall's line onto the track bed 1.2 m below, as far as the far wall (physics.js floorUnder).
export const SUBWAY_ARENA = { halfX: 4.2, halfZ: 1.35, drop: { at: 1.35 + 0.75, floor: -1.2, to: 6.0, reason: 'fell onto the tracks' } };

/** The fighting floor of each sandbox place (half-sizes in x and z): render.js draws them, the bouts are fought on them (main.js, sim.js createSim). */
export const PLACE_ARENAS = {
  // `ring`: a sport's ring, with its ropes and rules (fear runs lower there: ai.js fearTarget).
  ring: { halfX: WORLD.ringHalf, halfZ: WORLD.ringHalf, ring: true },
  // (The fought ground within the podium wall's oval of 22 by 13 m, props/arenasize.js: twice what it was when the sand was 10.5 by 7.)
  colosseum: { halfX: 13, halfZ: 8 },
  subway: SUBWAY_ARENA,
  meadow: { halfX: 9, halfZ: 7 },
  stadium: { halfX: WORLD.ringHalf, halfZ: WORLD.ringHalf, ring: true },
  town: { halfX: 9, halfZ: 7 },
  port: { halfX: 10, halfZ: 6 },
  sengoku: { halfX: 11, halfZ: 7 },
  plain: { halfX: 12, halfZ: 8 },
  // Room for horsemen to charge, pass, wheel round and draw a pursuit off (WORLD.mount; a feigned flight wants a long run):
  // 90 by 60 m inside a rail, the steppe battles' floor (was 60 by 40).
  field: { halfX: 45, halfZ: 30 },
  coastFort: { halfX: 12, halfZ: 8 },
  coastVillage: { halfX: 12, halfZ: 8 },
  // The square between the shops and the canal: room for the wokou raid's formations.
  jiangnan: { halfX: 14, halfZ: 9 },
  // (`own`: one built copy whatever the arena, setPlace.)
  canaltown: { halfX: 18, halfZ: 9, own: true },
  // (The wall's stretch that chapter 3 storms: story/battles/03-pyongyang.js PYONGYANG_1593.arena.)
  pyongyang: { halfX: 135, halfZ: 9, own: true },
  // (The town's gate square, Battle Mode's Pyongyang: places/pyongyang-city.js PY_TOWN_FIGHT, its wider field.)
  pyongyangtown: { halfX: 26, halfZ: 15, own: true },
  // The square of Cajamarca between its long halls (props/cajamarca.js CAJAMARCA_PLAN).
  cajamarca: { halfX: 16, halfZ: 11 },
  // The battlefields of 1415 and 1503, their floors as their levels have them (scenarios.js AGINCOURT, CERIGNOLA).
  agincourt: { halfX: 50, halfZ: 11.5 },
  cerignola: { halfX: 32, halfZ: 11 },
  // The Last Gate's field before the castle's gate (lastgate.js LAST_GATE.arena: the same numbers).
  lastgate: { halfX: 18, halfZ: 10.5 },
  // The horse-archer battles' plains: the field's room for horsemen to ride round, shoot and wheel (a battle's floor is wider still: scenarios.js).
  mobei: { halfX: 30, halfZ: 20 },
  catalaunian: { halfX: 30, halfZ: 20 },
  carrhae: { halfX: 30, halfZ: 20 },
  sarhu: { halfX: 30, halfZ: 20 },
  // A level-mode stage: the terrain is the floor (the box is only a far limit).
  stage: { halfX: 40, halfZ: 40 },
  dunnottar: { halfX: 40, halfZ: 40 },
};
