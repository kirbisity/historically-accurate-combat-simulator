// The health bar's painting, moved out of ai.js so the simulation writes nothing to the page: the bar reads the man's hurt
// (ai.js hurtShare, hurtDueShare), the page draws it (port groundwork, the user's call, 2026-11-26).

import { hurtDueShare, hurtShare } from './ai.js';

/**
 * Paint a health bar (`.bar.health`: its fill `i`, and for the player's own man its ghost `b.due`) for a fighter: the fill
 * is his health now; the ghost, the stretch it is still falling through to where the blows he took will leave it, as the
 * injury to his head and trunk is felt over the seconds after (WORLD.injury.drainSeconds).
 */
export function paintHealth(bar, fighter, ghost = false) {
  const now = 1 - hurtShare(fighter);
  bar.querySelector('i').style.width = `${Math.round(now * 100)}%`;
  const due = bar.querySelector('b.due');
  if (!due) return;
  const to = ghost ? 1 - hurtDueShare(fighter) : now;
  due.hidden = now - to < 0.005;
  due.style.left = `${to * 100}%`;
  due.style.width = `${Math.max(0, now - to) * 100}%`;
}
