import { test } from 'node:test';
import assert from 'node:assert/strict';
import { thinkAll } from '../src/ai.js';
import { step } from '../src/physics.js';
import { TABLE_DUEL } from '../src/tableduel.js';
import { scaledBattle } from '../tools/tableduel.js';

// ai.js thinkSlot: each man on a beat thinks in his own slot of it, so the steps share the thinking evenly however many men change
// beat together, and each keeps his beat's period.
test("a big battle's men on a beat think in their own slots: each step its share, each man at his beat's period", () => {
  const world = scaledBattle('sarhu', 240, 1);
  world.largeBattle = true;
  world.perceiver = world.fighters.filter((fighter) => fighter.corner === 'red').at(-1).id;
  const counts = [];
  const gaps = [];
  const last = new Map();
  // (A think leaves him owing nothing; a man held at the table, owing nothing still, has not thought again.)
  const owed = new Map();
  for (let index = 0; index < 600; index += 1) {
    thinkAll(world, 1 / 60);
    let thinking = 0;
    for (const fighter of world.fighters) {
      const was = owed.get(fighter.id);
      owed.set(fighter.id, fighter.aiOwed);
      if (fighter.aiOwed !== 0 || was === 0) continue;
      thinking += 1;
      // (A ghost on its 0.5 s beat: its gap is the beat's thirty steps, once it is on it.)
      if (fighter.ghost && last.has(fighter.id) && last.get(fighter.id).ghost) gaps.push(index - last.get(fighter.id).at);
      last.set(fighter.id, { at: index, ghost: Boolean(fighter.ghost) });
    }
    step(world, 1 / 60);
    if (index >= 300) counts.push(thinking);
  }
  const mean = counts.reduce((sum, count) => sum + count, 0) / counts.length;
  assert.ok(mean > 10, `men thinking a step: ${mean}`);
  // Even: no step thinks for more than twice the mean, none for under a third of it.
  assert.ok(Math.max(...counts) <= 2 * mean && Math.min(...counts) >= mean / 3, `${Math.min(...counts)}..${Math.max(...counts)} about ${mean.toFixed(1)}`);
  const steady = gaps.filter((gap) => gap === Math.round(TABLE_DUEL.ghostEvery * 60)).length;
  assert.ok(gaps.length > 50 && steady / gaps.length > 0.8, `ghost gaps at the beat: ${steady} of ${gaps.length}`);
});
