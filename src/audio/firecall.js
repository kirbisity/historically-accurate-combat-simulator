// The word to fire: when a side that was holding its fire is let go (command.js giveFireOrder, its button or H: hold true to
// false), the man who gave the order shouts it, in his own tongue, from where he stands. It is a voice like a cry: placed at his
// head in the world (engine.js placeVoice: its distance, its direction, the air, a wall between, the room's reverb), heard as loud
// as a man bellowing an order across a line. No two calls are quite alike: each man his own pitch (his body's, and a little of his
// own, the same every time), each call a little off it and drawn out or clipped (a take of three tempos, picked at random). A woman
// commanding shouts it in a woman's register (`female`: the takes raised, their formants with them, and played a little quieter). Telling a side to hold
// is not called (the call is the shot let go), and a side toggled quickly is not heard calling over itself (`cooldown`).
//
// The order's giver is kept on the world (`world.fireBy[corner]`, beside `world.fireSerial`); the simulation never reads it, and
// nothing here writes to the world. Pure (no context): `createFireCallWatcher().tick(world, now)` returns the calls due, and Node
// tests run it.

import { P } from '../body.js';
import { factionOf } from '../outfits.js';
import { cryRate } from './sfx/voice.js';
import { voiceOfFighter } from './cries.js';

/**
 * The calls and how they are heard:
 *   voices      each language's recorded calls (sets in samples.js; samples/README.md: the owner's recordings of 2026-11-28):
 *               the call as said, drawn out 10% and clipped 11% (its tempo only, the pitch kept), one picked each time; a
 *               language listed here with no takes falls back to `fallback`
 *   factions    the language a commander of each faction (outfits.js FACTIONS, his own: factionOf) shouts in: the Ming and the
 *               other Chinese kits Chinese; the Eight Banners and the Qing's Green Standard Chinese too (Manchu was the banners'
 *               own tongue, but no Manchu call is recorded, and the Qing's field orders were given in Chinese to its Han
 *               troops); the samurai, ashigaru and the rest of the Japanese kits Japanese. Every other faction is unlisted and
 *               shouts in the fallback, until a call in its own tongue is recorded and added here
 *   outfits     his outfit's own tongue where his faction is a mix of peoples (the street's yakuza are Japanese)
 *   fallback    the language of a faction with none listed, or whose language has no take: English
 *   cooldown    s: no second call from a side till this long after its last, so Hold and Fire toggled fast is one call, not a
 *               stack of them over each other (the longest take is 1.3 s)
 *   level       dB SPL at 1 m: an order bellowed to a line of men, as loud as a scream (sfx/voice.js CRY_KINDS): it has to
 *               carry over the guns and the fight to the men it is meant for
 *   pitch       semitones off the take's own: `body` the share of his body's voice (sfx/voice.js cryRate's departure, a big man
 *               lower) the call takes, half, since a word played far off its pitch sounds sped up sooner than a wordless cry
 *               does; `personal` his own voice, ± so many, the same each time (from his id); `utterance` each call's own wobble ±;
 *               `range` the most either way in all (past ~3 a played-back voice starts to sound like a tape run fast or slow)
 *   fade        s: the take's own end is faded already; this only keeps a cut take from clicking
 *   female      a woman commanding (her body's sex, cast.js): `voices` each language's call raised to a woman's shout (the pitch
 *               6 semitones up, the formants 2.6 of them: samples/README.md), her own language's or else as `voices` falls back;
 *               `db` played this much quieter, since a man's voice raised never quite sounds like a woman's own and should not
 *               stand out among the real ones; with no raised take for her language she shouts the man's take
 */
export const FIRE_CALL = {
  voices: { zh: ['firecall-zh-1', 'firecall-zh-2', 'firecall-zh-3'], ja: ['firecall-ja-1', 'firecall-ja-2', 'firecall-ja-3'], en: ['firecall-en-1', 'firecall-en-2', 'firecall-en-3'] },
  factions: { chinese: 'zh', manchu: 'zh', japanese: 'ja' },
  outfits: { yakuza: 'ja' },
  fallback: 'en',
  cooldown: 1.5,
  level: 92,
  pitch: { body: 0.5, personal: 1.5, utterance: 0.5, range: 3 },
  fade: 0.06,
  female: { voices: { zh: ['firecall-zh-f-1'], ja: ['firecall-ja-f-1'], en: ['firecall-en-f-1'] }, db: -3 },
};

/** The language a fighter shouts in (by his own faction, or his outfit where that says more), before any fallback for a missing take. */
export function fireCallTongue(fighter) {
  const inputs = fighter?.body?.inputs ?? fighter?.inputs ?? {};
  const outfit = inputs.outfit?.kind;
  if (outfit && FIRE_CALL.outfits[outfit]) return FIRE_CALL.outfits[outfit];
  return FIRE_CALL.factions[factionOf(inputs)] ?? FIRE_CALL.fallback;
}

/** The language his call is played in: his tongue where it has a take in `voices`, else the fallback. */
export function fireCallLanguage(fighter, voices = FIRE_CALL.voices) {
  const tongue = fireCallTongue(fighter);
  return voices[tongue]?.length ? tongue : FIRE_CALL.fallback;
}

/** The sample set of a language's call (samples.js SAMPLE_SETS), a woman's where `female` and there is one. */
export const fireCallSet = (language, female = false) => (female && FIRE_CALL.female.voices[language]?.length ? `firecall-${language}-f` : `firecall-${language}`);

/** A man's own place in the range of voices (0..1), the same every time: from his id, apart from cryRate's own (sfx/voice.js cryPersonal). */
export function fireCallPersonal(id) {
  const x = Math.sin(((id ?? 0) + 1) * 78.233 + 0.7) * 43758.5453;
  return x - Math.floor(x);
}

/** The playback rate of his call: his body's pitch (a share of it), his own, this call's wobble (`random` 0..1), within the range. */
export function fireCallRate(fighter, random = Math.random()) {
  const spec = FIRE_CALL.pitch;
  const voice = voiceOfFighter(fighter);
  const body = 12 * Math.log2(cryRate(voice)) * spec.body;
  const own = spec.personal * (fireCallPersonal(voice.id) * 2 - 1);
  const wobble = spec.utterance * (random * 2 - 1);
  const semitones = Math.max(-spec.range, Math.min(spec.range, body + own + wobble));
  return 2 ** (semitones / 12);
}

/** Where the call is heard from: his head. */
export const fireCallAt = (fighter) => [fighter.x[P.head * 3], fighter.x[P.head * 3 + 1], fighter.x[P.head * 3 + 2]];

/**
 * A watcher of the sides' fire orders. `tick(world, now)` → the calls due ({ corner, by: the fighter, language, set, fallbacks: the sets to
 * try in turn while it has not decoded, at, rate, db: off the call's level }): a side whose
 * fire order is new since the last tick (its `fireSerial` moved on) and was holding and is now let go, its giver still in the world,
 * and not within `cooldown` s of its last call. A new world is only looked at (nothing it held before the watcher saw it is called);
 * orders all taken back (command.js clearOrders: leaving play) give no new serial, so they are not a call either.
 */
export function createFireCallWatcher({ voices = FIRE_CALL.voices, random = Math.random } = {}) {
  let seenWorld = null;
  let serials = {};
  let holding = {};
  let quietUntil = {};

  function look(world) {
    serials = { ...(world.fireSerial ?? {}) };
    holding = Object.fromEntries(Object.entries(world.holdFire ?? {}).map(([corner, hold]) => [corner, Boolean(hold)]));
  }

  function tick(world, now) {
    if (!world) return [];
    if (world !== seenWorld) {
      seenWorld = world;
      quietUntil = {};
      look(world);
      return [];
    }
    const calls = [];
    for (const [corner, serial] of Object.entries(world.fireSerial ?? {})) {
      const held = holding[corner] ?? false;
      const hold = Boolean(world.holdFire?.[corner]);
      const fresh = serial !== serials[corner];
      if (!fresh || !held || hold || now < (quietUntil[corner] ?? -Infinity)) continue;
      const id = world.fireBy?.[corner];
      const by = world.fighters?.[id]?.id === id ? world.fighters[id] : world.fighters?.find((fighter) => fighter.id === id);
      if (!by?.x || by.state === 'out') continue;
      quietUntil[corner] = now + FIRE_CALL.cooldown;
      const language = fireCallLanguage(by, voices);
      const female = voiceOfFighter(by).sex === 'female';
      const set = fireCallSet(language, female);
      const fallbacks = [...new Set([fireCallSet(language), fireCallSet(FIRE_CALL.fallback, female), fireCallSet(FIRE_CALL.fallback)])].filter((each) => each !== set);
      calls.push({ corner, by, language, set, fallbacks, at: fireCallAt(by), rate: fireCallRate(by, random()), db: set.endsWith('-f') ? FIRE_CALL.female.db : 0 });
    }
    look(world);
    return calls;
  }

  return {
    tick,
    reset() {
      seenWorld = null;
      serials = {};
      holding = {};
      quietUntil = {};
    },
  };
}
