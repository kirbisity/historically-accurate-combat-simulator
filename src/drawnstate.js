// What the drawing keeps of a man that is not the simulation's: held beside the fighter (by the fighter, in a WeakMap), never
// on him, so drawing writes nothing into the simulation's state (port groundwork, the user's call, 2026-11-26).
// - softSwing: whether his armour's and cloth's soft swing is worked this frame (main.js drawWorld: the man played, the two of
//   a duel); unset (a preview, a design sheet) reads as undefined.

const DRAWN_STATE = new WeakMap();

/** The drawing's own record of a fighter, made on first need. */
export function drawnOf(fighter) {
  let drawn = DRAWN_STATE.get(fighter);
  if (!drawn) {
    drawn = {};
    DRAWN_STATE.set(fighter, drawn);
  }
  return drawn;
}

/** Whether the fighter has the soft swing now (undefined where nobody has said). */
export const softSwingOf = (fighter) => DRAWN_STATE.get(fighter)?.softSwing;
