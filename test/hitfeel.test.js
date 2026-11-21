import test from 'node:test';
import assert from 'node:assert/strict';
import { HITFEEL, createHitFeel, hitFeelFromHash, hitStrength, loadHitFeel, saveHitFeel } from '../src/hitfeel.js';
import { thumpParams } from '../src/audio/sfx/thump.js';
import { PRESETS } from '../src/body.js';
import { thinkAll } from '../src/ai.js';
import { advance, createWorld } from '../src/physics.js';

const blow = (impulse, extra = {}) => ({ kind: 'landed', attacker: 0, defender: 1, impulse, point: [0, 1.6, 0], normal: [0, 0, 1], ...extra });
const allOn = () => {
  const settings = loadHitFeel(null);
  for (const value of Object.values(settings)) value.on = true;
  return settings;
};
const length = ([x, y, z]) => Math.hypot(x, y, z);
/** The most of `read(now)` over the first `seconds` after a blow at 0. */
const peak = (read, seconds = 0.4) => {
  let most = 0;
  for (let now = 0; now <= seconds; now += 0.002) most = Math.max(most, read(now));
  return most;
};

test('hit feel: a blow\'s strength rises with its impulse, from nothing below a flick to full at a heavy kick', () => {
  assert.equal(hitStrength(blow(HITFEEL.impulse.light * 0.9)), 0);
  const jab = hitStrength(blow(8));
  const cross = hitStrength(blow(20));
  const kick = hitStrength(blow(60));
  assert.ok(jab > 0 && jab < cross && cross < kick && kick <= 1, `${jab} ${cross} ${kick}`);
  assert.equal(hitStrength(blow(500)), 1);
  // An edge's cut counts though its impulse is small.
  assert.ok(hitStrength(blow(3, { weapon: 'sword', cut: 80, energy: 90 })) > 0.5);
});

test('hit feel: only the player\'s blows are felt: his own landed most, one he takes less, his own blocked least', () => {
  const feel = createHitFeel(allOn());
  assert.equal(feel.hear(blow(30, { attacker: 2, defender: 3 }), 0, 0), null, 'others\' blows');
  assert.equal(feel.hear(blow(30), null, 0), null, 'nobody played');
  assert.equal(feel.hear({ kind: 'fell', fighter: 0 }, 0, 0), null);
  const landed = feel.hear(blow(30), 0, 0);
  const taken = feel.hear(blow(30, { attacker: 1, defender: 0 }), 0, 0);
  const blocked = feel.hear(blow(30, { kind: 'blocked' }), 0, 0);
  assert.ok(landed.strength > taken.strength && taken.strength > blocked.strength);
  assert.equal(landed.way, 'landed');
  assert.equal(taken.way, 'taken');
  assert.ok(landed.puff && taken.puff && !blocked.puff, 'the mist is off a struck place, not a guard');
});

test('hit feel: each effect grows with the blow\'s impulse', () => {
  const light = createHitFeel(allOn());
  const heavy = createHitFeel(allOn());
  const a = light.hear(blow(10), 0, 0);
  const b = heavy.hear(blow(60), 0, 0);
  assert.ok(b.vibrate > a.vibrate && a.vibrate >= HITFEEL.haptic.light * 0.5, `${a.vibrate} ${b.vibrate}`);
  assert.ok(b.thump > a.thump && a.thump > 0);
  assert.ok(b.puff.size > a.puff.size && b.puff.opacity > a.puff.opacity);
  const kickOf = (feel) => peak((now) => length(feel.offset(now)));
  assert.ok(kickOf(heavy) > kickOf(light) * 1.5 && kickOf(heavy) < 0.06, `${kickOf(light)} ${kickOf(heavy)}`);
  assert.ok(peak((now) => heavy.fov(now)) > peak((now) => light.fov(now)));
  assert.ok(peak((now) => heavy.vignette(now)) > peak((now) => light.vignette(now)));
  // The camera's jolt is along the blow (into the struck man: against the normal), and dies away.
  const early = heavy.offset(0.02);
  assert.ok(early[2] < 0, `${early}`);
  assert.deepEqual(heavy.offset(1), [0, 0, 0]);
});

test('hit feel: hit-stop holds the pace only for a heavy blow landed, briefly, and lets it go again', () => {
  const feel = createHitFeel(allOn());
  feel.hear(blow(6), 0, 0);
  assert.equal(feel.pace(0.01), 1, 'a light blow does not stop the fight');
  feel.hear(blow(30, { attacker: 1, defender: 0 }), 0, 0);
  assert.equal(feel.pace(0.01), 1, 'a blow taken does not');
  feel.hear(blow(70), 0, 1);
  assert.ok(feel.pace(1.01) <= HITFEEL.hitStop.slowest + 1e-9);
  // Let go, it runs a little slow for a moment (its `dilate`), never slower than that, and then at full pace.
  const letGo = 1 + HITFEEL.hitStop.seconds.heavy + HITFEEL.hitStop.ease + 0.001;
  assert.ok(feel.pace(letGo) >= HITFEEL.hitStop.dilate.to - 1e-9 && feel.pace(letGo) < 1, `${feel.pace(letGo)}`);
  assert.ok(feel.pace(letGo + HITFEEL.hitStop.dilate.seconds + 0.01) === 1);
  // A middling blow holds it for less than a heavy one.
  const middling = createHitFeel(allOn());
  middling.hear(blow(25), 0, 0);
  const held = (one) => {
    let at = 0;
    // (The hold itself: the little slowing after it is not a stop.)
    while (one.pace(at) < 0.5 && at < 1) at += 0.001;
    return at;
  };
  const heavy = createHitFeel(allOn());
  heavy.hear(blow(70), 0, 0);
  assert.ok(held(middling) > 0 && held(middling) < held(heavy), `${held(middling)} ${held(heavy)}`);
  assert.ok(held(heavy) < 0.15, 'a few hundredths of a second, not a freeze');
});

test('hit feel: an effect turned off does nothing; its intensity scales it', () => {
  const settings = allOn();
  for (const value of Object.values(settings)) value.on = false;
  const off = createHitFeel(settings);
  const result = off.hear(blow(60), 0, 0);
  assert.equal(result.vibrate, 0);
  assert.equal(result.thump, 0);
  assert.equal(result.puff, null);
  assert.equal(peak((now) => length(off.offset(now))), 0);
  assert.equal(peak((now) => 1 - off.pace(now)), 0);
  assert.equal(peak((now) => off.vignette(now)), 0);
  assert.equal(peak((now) => off.fov(now)), 0);
  const half = allOn();
  half.kick.intensity = 0.5;
  const full = createHitFeel(allOn());
  const halved = createHitFeel(half);
  full.hear(blow(40), 0, 0);
  halved.hear(blow(40), 0, 0);
  const ratio = peak((now) => length(halved.offset(now))) / peak((now) => length(full.offset(now)));
  assert.ok(Math.abs(ratio - 0.5) < 0.02, `${ratio}`);
});

test('hit feel: every effect is on by default; settings keep in storage; the address picks some for a visit', () => {
  const defaults = loadHitFeel(null);
  assert.ok(defaults.kick.on && defaults.hitStop.on && defaults.thump.on);
  assert.ok(Object.values(defaults).every((effect) => effect.on), 'every effect on while they are tried');
  const kept = new Map();
  const storage = { getItem: (key) => kept.get(key) ?? null, setItem: (key, value) => kept.set(key, value) };
  defaults.kick.on = false;
  defaults.thump.intensity = 1.4;
  saveHitFeel(storage, defaults);
  const again = loadHitFeel(storage);
  assert.equal(again.kick.on, false);
  assert.equal(again.thump.intensity, 1.4);
  assert.deepEqual(loadHitFeel({ getItem: () => '{broken' }), loadHitFeel(null));
  const picked = hitFeelFromHash(loadHitFeel(null), '#hitfeel=vignette,fov');
  assert.deepEqual(Object.entries(picked).filter(([, value]) => value.on).map(([name]) => name), ['vignette', 'fov']);
  assert.ok(Object.values(hitFeelFromHash(loadHitFeel(null), '#x=1&hitfeel=all')).every((value) => value.on));
  assert.ok(Object.values(hitFeelFromHash(loadHitFeel(null), '#hitfeel=none')).every((value) => !value.on));
  assert.deepEqual(hitFeelFromHash(loadHitFeel(null), '#other'), loadHitFeel(null));
});

test('hit feel: the thump is lower and longer for a heavier blow', () => {
  const light = thumpParams(0.1);
  const heavy = thumpParams(1);
  assert.ok(heavy.frequency < light.frequency && heavy.to < light.to && heavy.decay > light.decay);
});

test('hit feel: hearing the blows leaves the physics untouched', () => {
  const run = (feel) => {
    const world = createWorld([{ ...PRESETS.heavy, style: 'boxing' }, { ...PRESETS.light, style: 'boxing' }], { seed: 21 });
    let cursor = 0;
    for (let second = 0; second < 6; second += 1) {
      advance(world, 1, (current, dt) => thinkAll(current, dt));
      for (; cursor < world.events.length; cursor += 1) feel?.hear(world.events[cursor], 0, second);
    }
    return world;
  };
  const plain = run(null);
  const felt = run(createHitFeel(allOn()));
  assert.deepEqual(Array.from(felt.fighters[0].x), Array.from(plain.fighters[0].x));
  assert.deepEqual(Array.from(felt.fighters[1].x), Array.from(plain.fighters[1].x));
  assert.equal(felt.events.length, plain.events.length);
});

test('hit feel: the four beats are told apart by the physics\' own events, each with its own hold and sound', () => {
  const steel = { point: [0, 1.3, 0], normal: [1, 0, 0], impulse: 12, energy: 40, weapon: 'katana' };
  const feel = createHitFeel(allOn());
  // A blow stopped on his guard: a knock, a short hold or none, no mist.
  const guarded = feel.hear({ kind: 'parry', fighter: 0, attacker: 1, ...steel }, 0, 0);
  assert.equal(guarded.beat, 'block');
  assert.equal(guarded.way, 'guarded');
  assert.equal(guarded.sound.kind, 'knock');
  assert.ok(!guarded.puff && guarded.thump === 0);
  const blockHeld = feel.pace(0.01);
  // A deflect: a ring, held hard however light the blow, then on at nearly full pace within a third of a second.
  const deflect = createHitFeel(allOn());
  const turned = deflect.hear({ kind: 'deflect', fighter: 0, attacker: 1, ...steel }, 0, 0);
  assert.equal(turned.beat, 'deflect');
  assert.equal(turned.sound.kind, 'ring');
  assert.ok(turned.strength >= HITFEEL.beats.deflect.floor);
  assert.ok(deflect.pace(0.02) <= HITFEEL.beats.deflect.stop.slowest + 1e-9 && deflect.pace(0.02) < blockHeld, 'a deflect holds harder than a block');
  assert.ok(deflect.pace(0.2) > 0.6 && deflect.pace(0.5) === 1, `${deflect.pace(0.2)} ${deflect.pace(0.5)}`);
  assert.equal(deflect.screen(0.1), 0, 'an ordinary deflect drains no colour');
  // His own blow deflected is felt less; another man's deflect not at all.
  assert.ok(createHitFeel(allOn()).hear({ kind: 'deflect', fighter: 1, attacker: 0, ...steel }, 0, 0).strength < turned.strength);
  assert.equal(createHitFeel(allOn()).hear({ kind: 'deflect', fighter: 2, attacker: 3, ...steel }, 0, 0), null);
  // The big deflect and the execution: the longest holds, and the colour drains.
  const big = createHitFeel(allOn());
  assert.equal(big.hear({ kind: 'deflect', big: true, fighter: 0, attacker: 1, ...steel }, 0, 0).beat, 'bigDeflect');
  assert.ok(big.pace(HITFEEL.beats.deflect.stop.seconds.heavy + 0.01) <= HITFEEL.beats.bigDeflect.stop.slowest + 1e-9, 'held longer than a deflect');
  const drained = big.screen(0.1);
  assert.ok(drained > 0.3 && big.screen(2) === 0);
  const kill = createHitFeel(allOn());
  assert.equal(kill.hear({ kind: 'execution', fighter: 1, attacker: 0 }, 0, 0), null);
  assert.ok(kill.frame(0.25) > 0 && kill.frame(0.25) < kill.frame(1), 'the view closes in, eased');
  // (Its thrust lands as a blow a step before: no hold of its own.)
  kill.hear(blow(70), 0, 1.99);
  assert.equal(kill.pace(1.995), 1);
  const home = kill.hear({ kind: 'executionBlow', fighter: 1, attacker: 0 }, 0, 2);
  assert.equal(home.beat, 'execution');
  assert.equal(home.sound.kind, 'boom');
  assert.ok(kill.frame(2.01) > kill.frame(1.9), 'a punch in as the point goes home');
  assert.ok(kill.pace(2.05) <= HITFEEL.beats.execution.stop.slowest + 1e-9);
  assert.ok(kill.screen(2.1) > drained);
  assert.equal(kill.frame(2 + HITFEEL.frame.hold + HITFEEL.frame.out + 0.01), 0, 'and lets go');
  // An execution he is put off lets the view go by itself.
  const lost = createHitFeel(allOn());
  lost.hear({ kind: 'execution', fighter: 1, attacker: 0 }, 0, 0);
  assert.equal(lost.frame(HITFEEL.frame.most + HITFEEL.frame.out + 0.01), 0);
  // Each of the new effects off does nothing.
  const off = allOn();
  off.screen.on = false;
  off.frame.on = false;
  const quiet = createHitFeel(off);
  quiet.hear({ kind: 'execution', fighter: 1, attacker: 0 }, 0, 0);
  quiet.hear({ kind: 'executionBlow', fighter: 1, attacker: 0 }, 0, 1);
  assert.equal(quiet.screen(1.1), 0);
  assert.equal(quiet.frame(1.1), 0);
});

test('combat beats: each beat\'s own sound is its own shape, heavier is lower and longer', async () => {
  const { beatParams } = await import('../src/audio/sfx/beat.js');
  const ring = beatParams('ring', 0.3);
  const heavyRing = beatParams('ring', 1);
  assert.ok(ring.modes.length === 3 && ring.modes[0].f > 1500, 'a ring is high partials');
  assert.ok(heavyRing.modes[0].f < ring.modes[0].f && heavyRing.modes[0].decay > ring.modes[0].decay);
  const knock = beatParams('knock', 0.5);
  assert.ok(knock.frequency < 200 && knock.decay < 0.2, 'a knock is low and short');
  const boom = beatParams('boom', 1);
  assert.ok(boom.frequency < knock.frequency && boom.decay > 0.5, 'a boom is lower and far longer');
});
