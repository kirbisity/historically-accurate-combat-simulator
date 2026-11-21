// How a deflect looks to the man who made it (physics/deflect.js): a gold shine down from the top of the screen with the word
// (its CSS is fightui.css .deflect-cue). Its sparks and the flash on the men are combatfx.js's, as every meeting of steel's
// (hitfeel.js HITFEEL.sparks.deflect).

/** The screen's cue that the man played has deflected: its CSS animation on `element`, played once again. */
export function deflectCue(element) {
  if (!element) return;
  element.classList.remove('play');
  // (Read so the animation starts again on a deflect that follows another.)
  void element.offsetWidth;
  element.classList.add('play');
}
