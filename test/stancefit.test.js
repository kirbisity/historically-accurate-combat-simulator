// A style's stance as each body holds it (stancefit.js): the style says what the stance is, the body how much of it he can hold.
import test from 'node:test';
import assert from 'node:assert/strict';
import { buildBody, P, PRESETS } from '../src/body.js';
import { desiredPose } from '../src/pose.js';
import { MOVES, STYLES, strikeTargets } from '../src/moves.js';
import { armHold, fitStance, kickCeiling, stanceAbility } from '../src/stancefit.js';
import { FRAMES } from '../src/body.js';
import { caloriesForBodyFat } from '../src/physiology.js';

const man = (inputs, bodyFat) => buildBody({ ...PRESETS.taekwondo, ...inputs, calories: Math.round(caloriesForBodyFat({ ...PRESETS.taekwondo, ...inputs }, bodyFat, FRAMES[inputs.frame ?? 'small'].lean)) });
const young = buildBody(PRESETS.taekwondo);
const old = man({ age: 80, heightCm: 170, frame: 'medium', exercise: 0.35 }, 0.24);
const heavy = man({ age: 38, heightCm: 176, frame: 'large', exercise: 0.35 }, 0.33);

test('the old and the heavy hold less of a deep stance, a high kick and an arm held out than a fit young fighter', () => {
  assert.equal(stanceAbility(young).legs, 1);
  assert.ok(stanceAbility(old).legs < stanceAbility(heavy).legs && stanceAbility(heavy).legs < 1);
  const share = (body) => kickCeiling(body) / body.heightM;
  assert.ok(share(young) > 0.95, `young kicks to ${share(young).toFixed(2)} of his height`);
  assert.ok(share(old) < 0.7, `the old man's kick no higher than his belt: ${share(old).toFixed(2)}`);
  assert.ok(armHold(old, 0.9) < armHold(heavy, 0.9) && armHold(heavy, 0.9) < armHold(young, 0.9));
  const lunge = { ...STYLES.wuxia.stance, ...STYLES.wuxia.stance.lunge };
  assert.deepEqual(fitStance(lunge, young), lunge);
  assert.ok(fitStance(lunge, old).crouch < lunge.crouch && fitStance(lunge, old).weight < lunge.weight);
  assert.ok(fitStance(lunge, old, 0).crouch < fitStance(lunge, old, 1).crouch, 'tired, shallower');
});

test('a stance\'s weight moves the hips over one foot, and its own guard places the fists', () => {
  const stance = { ...STYLES.boxing.stance };
  const hips = (weight) => desiredPose(young, { stance: { ...stance, weight } })[P.pelvis][0];
  assert.ok(hips(0.4) > hips(0) + 0.03 && hips(-0.4) < hips(0) - 0.03);
  const guard = desiredPose(young, { stance: STYLES.taekwondo.stance });
  const plain = desiredPose(young, { stance: { ...STYLES.taekwondo.stance, guard: undefined } });
  assert.ok(guard[P.lHand][0] - guard[P.lShoulder][0] > plain[P.lHand][0] - plain[P.lShoulder][0], 'the lead fist further out');
});

test('a chambered kick folds the knee up first; a kick goes no higher than his hips let it', () => {
  const head = [0.7, 1.7, 0];
  const open = strikeTargets(MOVES.roundhouse, 0.05, head, young, 0.2);
  const chambered = strikeTargets(MOVES.roundhouse, 0.05, head, young, 0.2, { chamber: 1, kneeCeiling: kickCeiling(young, young.lengths.thigh) });
  assert.equal(open.rKnee, undefined);
  assert.ok(chambered.rKnee && chambered.rFoot[1] < chambered.rKnee[1], 'the foot folded under the raised knee');
  const out = strikeTargets(MOVES.roundhouse, 0.3, head, old, 0.2, { ceiling: kickCeiling(old) });
  assert.ok(out.rFoot[1] <= kickCeiling(old) + 1e-9);
});
