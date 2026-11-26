// The amphitheatre's size (render.js builds it, the cameras keep inside it). About half the Colosseum's own: its sand was
// 83 by 48 m inside a building 188 by 156 m and 48 m high (the usual published figures, approximate), on 80 arches.
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
