// The word to fire: when a side that was holding its fire is let go (command.js giveFireOrder, its button or H: hold true to
// false), the man who gave the order shouts it, in his own tongue, from where he stands. It is a voice like a cry: placed at his
// head in the world (engine.js placeVoice: its distance, its direction, the air, a wall between, the room's reverb), heard as loud
// as a man bellowing an order across a line. No two calls are quite alike: each man his own pitch (his body's, and a little of his
// own, the same every time), each call a little off it and drawn out or clipped (a take of three tempos, picked at random). A
// woman commanding shouts it in a woman's register (`female`: the takes raised, their formants with them, and played a little
// quieter). Telling a side to hold is not called (the call is the shot let go), and a side toggled quickly is not heard calling
// over itself (`cooldown`).
//
// The sides the AI plays give no order (nothing in the simulation tells their shot to hold or to fire), but their shot does hold:
// a drilled line holds its fire till the enemy is within the gun's effective range (formation.js DRILL.holdFire) or its squad's
// word (DRILL.volley), and any side's archers and gunners stand idle while there is nobody to shoot at. So the call is read from
// what happens: a side's shot opening fire, its first shot or its first after a lull (`ai.lull`), is the moment its commander gave
// the word, and he is heard giving it: the formation's leader, who drills the line, else the side's general (ai.js generalOf).
//
// Heard over the battle (`priority`): a word of command is what a soldier listens for, so the call takes a voice from the fight's
// ordinary sounds by its level at the ear with a bonus (more for his own side's commander, most for the man played or his own
// general), but it is still heard as physics has it: far off it is quiet, behind a wall dulled, and under a din far louder than it
// (masked) it is lost.
//
// The order's giver is kept on the world (`world.fireBy[corner]`, beside `world.fireSerial`); the simulation never reads it, and
// nothing here writes to the world. Pure (no context): `createFireCallWatcher().tick(world, now)` returns the calls due, and Node
// tests run it.

import { P } from '../body.js';
import { factionOf } from '../outfits.js';
import { cryRate } from './sfx/voice.js';
import { voiceOfFighter } from './cries.js';
import { generalOf, stillFighting } from '../ai.js';

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
  ai: { lull: 12, cooldown: 12, afterOrder: 8 },
  priority: { call: 10, ownSide: 10, ownCommander: 20, masked: 20, listening: 10, impulse: 0.1, window: 0.1 },
};

/**
 * A side the AI plays (FIRE_CALL.ai; the call read from its shot opening fire, the watcher's tick):
 *   lull        s without a shot from the side after which its next shot is an opening of fire, and called: a drilled line's
 *               volleys by ranks come every few seconds (formation.js volleyDue: three ranks of matchlocks one each 5 s) and
 *               archers loose every few, so firing kept up is never a new word, while a line that held till the enemy came
 *               within range, or fell silent with nobody in reach, opens again on one
 *   cooldown    s: no second opening called from a side within this, so a line whose fire stutters does not chatter
 *   afterOrder  s after a fire order given on the side (the man played's, Hold fire to Fire at will): its shot opening is that
 *               order's, already called, not another
 *
 * A call's priority for a voice (FIRE_CALL.priority: dB added to its level at the ear for the ranking only, never to its loudness):
 *   call          any call: speech of command stands out of noise to a man listening for it (the ear picks a voice out of a
 *                 din some 10 dB louder than it), so it wins a voice from the fight's ordinary sounds about as loud
 *   ownSide       a commander of the side of the man played: the word his own men are waiting on
 *   ownCommander  the man played himself, or his side's general: always heard near
 *   masked        dB: a call this far under the din at the ear just before it (fireCallDin) is drowned and not played at all:
 *                 a shouted word is lost some 10-20 dB under the noise round it
 *   listening     dB more of din his own side's men catch their commander's word through: they know the voice and the word
 *                 they wait for (a listener expecting a known word follows it some 5-10 dB deeper into noise)
 *   impulse       s each sound heard counts toward the din, however short or long its take: the ear sums a sound's energy over
 *                 about a tenth of a second, so a musket's 150 dB crack is a din for that long, not for the second its peak
 *                 would hold if read as a level (the gun's crack does not drown a shout begun a moment after it)
 *   window        s: the din's energy eased away with this time constant (its level falling ~43 dB a second), its mean power
 *                 over it: a loud sound masks what comes after it for a few tenths of a second, no longer, so a crack drowns a
 *                 call begun with it but not one begun half a second after; many sounds a second keep the din up
 */

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

/** The rank a call takes for a voice (dB): its level at the ear and its bonuses (FIRE_CALL.priority). */
export function fireCallRank(atEar, { ownSide = false, ownCommander = false } = {}) {
  const spec = FIRE_CALL.priority;
  return atEar + spec.call + (ownSide ? spec.ownSide : 0) + (ownCommander ? spec.ownCommander : 0);
}

/**
 * A call's standing to the man played (`player`, or none: a battle watched): of his own side, his own commander (himself or his
 * general), and his own voice (he gave it).
 */
export function fireCallStanding(world, call, player) {
  if (!player) return { ownSide: false, ownCommander: false, ownVoice: false };
  const ownSide = call.corner === player.corner;
  const ownVoice = call.by === player;
  return { ownSide, ownCommander: ownSide && (ownVoice || call.by === generalOf(world, player.corner)), ownVoice };
}

/**
 * The din at the ear (dB) from its energy (`energy`: each sound heard adds 10^(level/10) x `impulse` s, the sum eased away over
 * `window` s: engine.js), the mean power of the last moments; -Infinity in silence.
 */
export const fireCallDin = (energy) => (energy > 0 ? 10 * Math.log10(energy / FIRE_CALL.priority.window) : -Infinity);

/** A sound heard (`atEar`, dB) added to the din's energy. */
export const fireCallDinAdd = (energy, atEar) => energy + 10 ** (atEar / 10) * FIRE_CALL.priority.impulse;

/** The din's energy eased away over `dt` s. */
export const fireCallDinEase = (energy, dt) => energy * Math.exp(-dt / FIRE_CALL.priority.window);

/**
 * Whether a call at `atEar` (dB at the ear) is drowned by the din (`din`, dB at the ear): his own side's men listen through more of
 * it (`standing.ownSide`), and a man's own word is never drowned to him (`standing.ownVoice`: he hears himself through his own head,
 * and knows what he said).
 */
export function fireCallMasked(atEar, din, standing = {}) {
  if (standing.ownVoice) return false;
  return atEar < din - FIRE_CALL.priority.masked - (standing.ownSide ? FIRE_CALL.priority.listening : 0);
}

/** Who gives the word to a side the AI plays: the formation's leader while he fights, else the side's general; never the man played. */
export function fireCallCommander(world, corner) {
  const leaderId = world.formations?.[corner]?.leader;
  const leader = leaderId === undefined || leaderId === null ? null : world.fighters[leaderId];
  if (leader && leader.corner === corner && !leader.player && leader.x && stillFighting(leader)) return leader;
  const general = generalOf(world, corner);
  return general && !general.player && general.x ? general : null;
}

/** Where the call is heard from: his head. */
export const fireCallAt = (fighter) => [fighter.x[P.head * 3], fighter.x[P.head * 3 + 1], fighter.x[P.head * 3 + 2]];

/**
 * A watcher of the sides' fire orders. `tick(world, now)` → the calls due ({ corner, by: the fighter, why: 'order' or 'opening',
 * language, set, fallbacks: the sets to try in turn while it has not decoded, at, rate, db: off the call's level }):
 *   - an order: a side whose fire order is new since the last tick (its `fireSerial` moved on) and was holding and is now let go,
 *     its giver still in the world, and not within `cooldown` s of its last call. Orders all taken back (command.js clearOrders:
 *     leaving play) give no new serial, so they are not a call;
 *   - an opening: a side's shot (a gun's `shot`, a bow's or crossbow's `loosed`: world.events; never the man played's own) fired
 *     after `ai.lull` s with none, not within `ai.cooldown` of the side's last opening called nor `ai.afterOrder` of its last
 *     order, called by its commander (fireCallCommander) where it has one.
 * A new world is only looked at: nothing it held, and no shot fired before the watcher saw it, is called.
 */
export function createFireCallWatcher({ voices = FIRE_CALL.voices, random = Math.random } = {}) {
  let seenWorld = null;
  let serials = {};
  let holding = {};
  let quietUntil = {};
  let cursor = 0;
  let lastShot = {};
  let openedAt = {};
  let orderedAt = {};

  function look(world) {
    serials = { ...(world.fireSerial ?? {}) };
    holding = Object.fromEntries(Object.entries(world.holdFire ?? {}).map(([corner, hold]) => [corner, Boolean(hold)]));
  }

  function callOf(corner, by, why) {
    const language = fireCallLanguage(by, voices);
    const female = voiceOfFighter(by).sex === 'female';
    const set = fireCallSet(language, female);
    const fallbacks = [...new Set([fireCallSet(language), fireCallSet(FIRE_CALL.fallback, female), fireCallSet(FIRE_CALL.fallback)])].filter((each) => each !== set);
    return { corner, by, why, language, set, fallbacks, at: fireCallAt(by), rate: fireCallRate(by, random()), db: set.endsWith('-f') ? FIRE_CALL.female.db : 0 };
  }

  /** The sides whose shot opened fire among the events since the last tick. */
  function openings(world) {
    const events = world.events ?? [];
    if (cursor > events.length) cursor = events.length;
    const opened = new Set();
    for (let index = cursor; index < events.length; index += 1) {
      const event = events[index];
      if (event.kind !== 'shot' && event.kind !== 'loosed') continue;
      const shooter = world.fighters[event.attacker];
      if (!shooter || shooter.player) continue;
      const time = event.time ?? world.time ?? 0;
      if (lastShot[shooter.corner] === undefined || time - lastShot[shooter.corner] >= FIRE_CALL.ai.lull) opened.add(shooter.corner);
      lastShot[shooter.corner] = time;
    }
    cursor = events.length;
    return opened;
  }

  function forget(world) {
    seenWorld = world;
    quietUntil = {};
    lastShot = {};
    openedAt = {};
    orderedAt = {};
    cursor = world?.events?.length ?? 0;
    serials = {};
    holding = {};
    if (world) look(world);
  }

  function tick(world, now) {
    if (!world) return [];
    if (world !== seenWorld) {
      forget(world);
      return [];
    }
    const calls = [];
    for (const [corner, serial] of Object.entries(world.fireSerial ?? {})) {
      const held = holding[corner] ?? false;
      const hold = Boolean(world.holdFire?.[corner]);
      const fresh = serial !== serials[corner];
      if (fresh) orderedAt[corner] = now;
      if (!fresh || !held || hold || now < (quietUntil[corner] ?? -Infinity)) continue;
      const id = world.fireBy?.[corner];
      const by = world.fighters?.[id]?.id === id ? world.fighters[id] : world.fighters?.find((fighter) => fighter.id === id);
      if (!by?.x || by.state === 'out') continue;
      quietUntil[corner] = now + FIRE_CALL.cooldown;
      calls.push(callOf(corner, by, 'order'));
    }
    look(world);
    for (const corner of openings(world)) {
      if (now < (openedAt[corner] ?? -Infinity) + FIRE_CALL.ai.cooldown || now < (orderedAt[corner] ?? -Infinity) + FIRE_CALL.ai.afterOrder) continue;
      if (now < (quietUntil[corner] ?? -Infinity)) continue;
      const by = fireCallCommander(world, corner);
      if (!by) continue;
      openedAt[corner] = now;
      quietUntil[corner] = now + FIRE_CALL.cooldown;
      calls.push(callOf(corner, by, 'opening'));
    }
    return calls;
  }

  return { tick, reset: () => forget(null) };
}
