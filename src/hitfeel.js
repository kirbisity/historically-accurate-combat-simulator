// How a blow feels to the player, for a game whose motion is real and not
// an arcade's: nothing here is drawn bigger than the blow was. Each effect is
// small, short, and scaled by the blow's own impulse (or, for an edge or a
// point, its energy), so a jab is barely there and a full kick or a two-handed
// cut is felt. Only blows the player's man lands (in full), takes (less), or
// has blocked (a little, through the arms) are felt; a crowd's blows are not.
//
// The effects (each on or off, each with its intensity, kept in this browser;
// a URL hash `#hitfeel=kick,thump` or `#hitfeel=all` / `none` overrides them
// for a visit, to try one at a time):
//   kick      the camera jolted along the blow, a few cm, damped in a fifth of a second
//   hitStop   the fight slowed for a few hundredths of a second on a heavy blow landed
//             (the frame's pace only: the physics step is never changed)
//   puff      a soft mist of sweat and dust off the struck point
//   vignette  the screen's edges darkened for a moment on a heavy blow
//   dim       the whole screen darkened for a moment by the harm a blow he takes does him
//   haptic    a short vibration (phones that have it: navigator.vibrate)
//   thump     a low body thump under the blow's own sound, by its energy
//   fov       the view narrowed a degree or two, as the eye fixes on the blow
//
//   sparks    steel on steel throws sparks and a flash of light from where it met, by what met and how hard (combatfx.js)
//   trail     a pale streak behind a blade moved fast, from its own motion (combatfx.js)
//   screen    colour drained from the screen's edges for a moment, on the biggest moments only
//   frame     the view closed in through an execution, eased in and out
//
// Four beats are told apart, each by its own event of the physics and each with its own picture and sound (the user's
// call, 2026-11-21: crisp, rhythmic, a parry and its answer):
//   hit        a blow landed on a man (`landed`): blood or mist, the body's thump, a hit-stop by its weight
//   block      a blow stopped on a guard, a blade or a shield (`blocked`, `parry`): a few dull sparks if steel met steel, a
//              heavy knock, a short hold
//   deflect    a blow turned by a blade put up on time (`deflect`): a burst of orange-white sparks thrown the way the blade
//              was scraping, a flash that lights the men, a ring over the steel, a few frames held and then on at full pace
//   execution  the point put home in a man broken open (`execution`, `executionBlow`): the view closed in, the longest
//              hold, the colour drained, a deep boom
// Nothing here is scripted: each is asked for by the event the simulation made, and scaled by that event's own impulse
// and energy. The pace is the frame's only (how much simulated time a drawn frame covers): the physics step and its
// results for a seed are never changed.
//
// No DOM and no three.js: main.js asks it what to do each frame (tests drive it directly).

export const HITFEEL = {
  // The blow's strength (0..1) is its impulse (N·s) on a log scale between these: a flicked jab is ~5,
  // a full cross ~20, a kick ~40 to 110 (tools/bout.js). Below `light` it is not felt at all.
  impulse: { light: 4, heavy: 70 },
  // An edge or a point can do its harm with little impulse: its cutting energy (J) counts too, on the same kind of scale.
  energy: { light: 10, heavy: 150 },
  // The share of a blow felt each way: his own landed in full; one he takes less (it is not his to enjoy);
  // his own blocked, a little (felt through the arms that stopped it).
  // A blow stopped on his own guard (`guarded`) is felt through his arms; a blow he deflects in full (it is his doing), and
  // his own blow deflected (`turned`) rather less; the point he puts home in an execution in full.
  share: { landed: 1, taken: 0.55, blocked: 0.3, guarded: 0.45, deflected: 1, turned: 0.6, executed: 1 },
  // Each effect: whether it is on and its intensity (0..2, 1 as tuned). The defaults: the quiet ones on.
  effects: {
    kick: { on: true, intensity: 1, label: 'Camera kick', note: 'The view jolts along the blow' },
    hitStop: { on: true, intensity: 1, label: 'Hit-stop', note: 'A heavy blow holds the moment' },
    puff: { on: true, intensity: 1, label: 'Impact mist', note: 'Sweat and dust off the struck place' },
    vignette: { on: true, intensity: 1, label: 'Dark edges', note: 'The edges dim on a heavy blow' },
    dim: { on: true, intensity: 1, label: 'Dim on a hard hit', note: 'The screen darkens by the harm taken' },
    haptic: { on: true, intensity: 1, label: 'Vibration', note: 'A buzz on phones that have it' },
    thump: { on: true, intensity: 1, label: 'Body thump', note: 'A low thud under the blow' },
    fov: { on: true, intensity: 1, label: 'Focus punch', note: 'The view narrows for an instant' },
    sparks: { on: true, intensity: 1, label: 'Contact sparks', note: 'Sparks and a flash where steel meets steel' },
    trail: { on: true, intensity: 1, label: 'Blade trails', note: 'A pale streak behind a fast blade' },
    screen: { on: true, intensity: 1, label: 'Screen pulse', note: 'Colour drains from the edges on the biggest moments' },
    frame: { on: true, intensity: 1, label: 'Finisher framing', note: 'The view closes in through an execution' },
  },
  // The camera's jolt: metres at full strength (3 cm at 2.5 m is about 1% of the screen: felt, not seen as a shake),
  // how fast it rings (Hz: a body's sway, not a buzz) and dies (s, its time constant), and how long it is kept.
  kick: { metres: 0.03, hz: 9, decay: 0.06, seconds: 0.3 },
  // Hit-stop: only a blow past `from` in strength; the fight runs at `slowest` of its pace for between `seconds.light`
  // and `seconds.heavy` (real seconds), then eases back over `ease` (a hard snap back reads as a stutter).
  // After the hold a heavy blow runs on a little slow (`dilate`: at `to` of its pace at full strength, back to full over
  // `seconds`): the weight of it, not a slow-motion scene.
  hitStop: { from: 0.35, slowest: 0.08, seconds: { light: 0.03, heavy: 0.09 }, ease: 0.04, dilate: { to: 0.7, seconds: 0.18 } },
  // The other beats (a landed blow's is `hitStop` above and the effects' own numbers). Each: `floor`, the least strength
  // the beat is felt at whatever its impulse (a deflect is always an event; a touch on the guard is not); `stop`, its hold,
  // as hitStop's; `kick`, `fov` and `haptic`, its share of the camera's jolt, the narrowing and the buzz; `screen`, how far
  // the colour drains (0: not at all) and for how long (s).
  beats: {
    // A blow stopped on a guard: short and dull, the blow's weight felt and no more.
    block: { floor: 0, stop: { from: 0.3, slowest: 0.25, seconds: { light: 0.02, heavy: 0.05 }, ease: 0.03 }, kick: 0.8, fov: 0.5, haptic: 0.8, screen: 0 },
    // A deflect: held hard for four to six frames, then on at once (a deflect and its answer are a rhythm: a slow-motion
    // scene after each would break it), only a little slow for a quarter of a second after.
    deflect: { floor: 0.55, stop: { from: 0, slowest: 0.03, seconds: { light: 0.06, heavy: 0.1 }, ease: 0.05, dilate: { to: 0.6, seconds: 0.25 } }, kick: 1.3, fov: 1.2, haptic: 1, screen: 0 },
    // The big deflect (WORLD.deflect.big: the striker broken open): held longer, and the colour drains.
    bigDeflect: { floor: 1, stop: { from: 0, slowest: 0.02, seconds: { light: 0.13, heavy: 0.13 }, ease: 0.08 }, kick: 1.8, fov: 1.5, haptic: 1.5, screen: 0.7, screenSeconds: 0.7 },
    // The execution's blow home: the longest hold of all.
    execution: { floor: 1, stop: { from: 0, slowest: 0.02, seconds: { light: 0.16, heavy: 0.16 }, ease: 0.1 }, kick: 2, fov: 1, haptic: 2, screen: 1, screenSeconds: 1.1 },
  },
  // The mist: its size (m) and opacity at full strength, and its life (s).
  puff: { size: 0.26, opacity: 0.45, seconds: 0.35 },
  // The dark edges: only past `from` in strength; their most (opacity) and how long they fade (s).
  vignette: { from: 0.4, opacity: 0.5, seconds: 0.4 },
  // The screen dimmed: by the harm a blow he takes does (the event's `harm`, a share of the struck part's health: a glancing blow on a
  // helmet ~0.1, a cut into the chest ~0.4, a blow that knocks him out ~1), from `from` to `full`; its most (opacity) and how long it
  // fades (s). Slight, and at once: the eyes swim, then clear. The user's call, 2026-11-10.
  dim: { from: 0.05, full: 0.8, opacity: 0.4, seconds: 0.9 },
  // A vibration (ms) from the lightest blow felt to the heaviest: a phone's motor needs ~8 ms to be felt at all.
  haptic: { light: 8, heavy: 40 },
  // The thump's gain (0..1 of the effects bus) at full strength.
  thump: { gain: 0.7 },
  // The view narrowed (degrees) at full strength, and the time (s) it eases back.
  fov: { degrees: 2.2, seconds: 0.28 },
  // The colour drained from the edges (`screen`): a landed blow only at `from` of full strength and past it (a blow that
  // ends a fight), to `hit` at most; in over `in` s, out over the beat's `screenSeconds` (a blow's: `seconds`).
  screen: { from: 0.9, hit: 0.6, in: 0.04, seconds: 0.5 },
  // The execution's framing (`frame`): the view narrowed `degrees` from the moment he steps in (eased in over `in` s), a
  // further `punch` for `punchSeconds` as the point goes home, then eased out over `out` s; let go after `most` s if the
  // blow never comes (he was put off it).
  frame: { degrees: 5, in: 0.5, punch: 3, punchSeconds: 0.25, hold: 0.35, out: 0.9, most: 4.5 },
  // The beats' own sounds, under the physics' sounds (audio/sfx/beat.js), each a gain (0..1 of the effects bus) at full
  // strength: a block's knock, a deflect's ring, an execution's boom.
  sound: { knock: 0.6, ring: 0.4, boom: 0.85 },
  // Sparks off steel on steel (combatfx.js), by the meeting's strength (the impulse's, as a blow's): each of a pair is
  // [at the lightest, at the heaviest]. `count` sparks at `speed` [least, most] m/s (`speedMost`: the most, by strength),
  // living `life` s, `width` m across; `cone`: how tightly they are thrown the way the blade was scraping (weaponview.js
  // spawnSparks: 0.6 a loose spray, 3 a jet), `loose`: the share of them thrown all round instead; `tint`: how orange they
  // burn (0 white-yellow, 1 orange); `gravity`: the share of g on them. `flash`: the glow at the meeting (m across,
  // colour as light, s). `light`: what it throws on the men and the floor (its peak, as a muzzle flash's is 3.6; its
  // colour; the time constant it dies with, s; how far it reaches, m).
  sparks: {
    // What counts as steel (audio/log.js weaponPart and shieldCovering's words, as the clash's sound has it): an edge or a
    // point, a weapon's iron head, an iron shield. A haft or a board throws none.
    steel: ['blade', 'blunt', 'shieldmetal'],
    // The meeting's strength for its sparks: its impulse (N·s) on a log scale between these. Far less than a blow's on a
    // body: a blade's effective mass out along it is a few hundred grams, and blades meet aslant (measured in duels: two
    // katana 0.6 to 1.2, two longswords 2 to 10).
    impulse: { light: 0.5, heavy: 12 },
    // An ordinary meeting of blades, a blow stopped: few, dull, falling.
    clash: { count: [4, 24], speed: 1.5, speedMost: [3.5, 7.5], life: [0.12, 0.5], width: [0.004, 0.007], cone: 0.9, loose: 0.5, tint: 0.3, gravity: 1, flash: { size: [0.05, 0.15], colour: [1.4, 1.1, 0.7], seconds: 0.05 }, light: { peak: [0, 1.2], colour: [1, 0.7, 0.4], seconds: 0.03, range: 5 } },
    // A deflect: many, fast, bright, thrown one way, and the flash lights the men.
    deflect: { count: [55, 120], speed: 4, speedMost: [10, 16], life: [0.15, 0.6], width: [0.009, 0.017], cone: 3, loose: 0.25, tint: 0.6, gravity: 0.6, flash: { size: [0.3, 0.5], colour: [3.2, 2, 0.8], seconds: 0.09 }, light: { peak: [4, 7], colour: [1, 0.72, 0.38], seconds: 0.06, range: 6 } },
    // A big deflect is a deflect and this much more of it.
    big: 1.4,
    // An edge turned off plate (`glance`: no impulse of its own in the event): a few.
    glance: { strength: 0.3 },
    // The share of the sparks drawn in a crowd's meetings (neither man the one played nor his man), with no light thrown,
    // and by the quality tier.
    crowd: 0.35,
    tier: { high: 1, medium: 0.7, low: 0.45 },
  },
  // The execution's blow home (combatfx.js): a pale flash of light on the two men (its peak, colour, time constant and
  // reach, as a spark's light), and a glint off the steel (m across, colour, s).
  finish: { light: { peak: 7, colour: [1, 0.93, 0.82], seconds: 0.07, range: 8 }, flash: { size: 0.3, colour: [2.2, 2, 1.7], seconds: 0.07 } },
  // The blade's trail (combatfx.js): the outer part of the blade (from `inner` of the way along its striking length to its
  // tip) swept through the last `seconds` of the fight, lit only where the tip moved faster than `from` m/s and in full
  // past `full` (a guard shifting or a wind-up draws nothing; a katana's cut, its tip at 13 m/s, or a longsword's at 25, draws its arc). `colour` and `peak`:
  // pale steel, added to the picture; `steps`: the samples laid between two frames (a fast cut turns 15 degrees a frame:
  // the arc is drawn round, not as flats); `samples`: the most kept for a blade; `most`: the blades trailed at once, by
  // the quality tier (the man played's and his man's; never a crowd's).
  trail: { seconds: 0.13, from: 6, full: 14, inner: 0.45, colour: [0.92, 0.95, 1], peak: 0.32, steps: 3, samples: 40, most: { high: 4, medium: 4, low: 2 } },
  // Settings kept in this browser under this key.
  key: 'gladiator-hitfeel',
};

const hitFeelClamp = (value, low = 0, high = 1) => Math.max(low, Math.min(high, value));

/** The share (0..1) of `value` on a log scale from `light` to `heavy`. */
const hitFeelLogShare = (value, { light, heavy }) => (value > light ? hitFeelClamp(Math.log(value / light) / Math.log(heavy / light)) : 0);

/** A blow's strength, 0..1, from its impulse or (an edge, a point) its energy, whichever is more. */
export function hitStrength(event) {
  const byImpulse = hitFeelLogShare(event.impulse ?? 0, HITFEEL.impulse);
  const edge = (event.cut ?? 0) + (event.pierce ?? 0);
  const byEnergy = hitFeelLogShare(Math.max(edge, event.energy && event.weapon ? event.energy : 0), HITFEEL.energy);
  return Math.max(byImpulse, byEnergy);
}

/** The settings: every effect's `on` and `intensity`, the kept ones (storage: localStorage or null) over the defaults. */
export function loadHitFeel(storage) {
  const settings = Object.fromEntries(Object.entries(HITFEEL.effects).map(([name, spec]) => [name, { on: spec.on, intensity: spec.intensity }]));
  try {
    const kept = JSON.parse(storage?.getItem(HITFEEL.key) ?? 'null');
    if (kept && typeof kept === 'object') {
      for (const [name, value] of Object.entries(kept)) {
        if (!settings[name] || !value || typeof value !== 'object') continue;
        if (typeof value.on === 'boolean') settings[name].on = value.on;
        if (Number.isFinite(value.intensity)) settings[name].intensity = hitFeelClamp(value.intensity, 0, 2);
      }
    }
  } catch {
    // Blocked or broken storage: the defaults.
  }
  return settings;
}

export function saveHitFeel(storage, settings) {
  try {
    storage?.setItem(HITFEEL.key, JSON.stringify(settings));
  } catch {
    // A private window: the settings last this visit.
  }
}

/** A URL hash's `hitfeel=` list over the settings (for this visit): `all`, `none`, or names of the effects to have on (the rest off). */
export function hitFeelFromHash(settings, hash) {
  const match = /(?:^|[#&])hitfeel=([\w,]*)/.exec(hash ?? '');
  if (!match) return settings;
  const wanted = match[1] === 'all' ? Object.keys(settings) : match[1] === 'none' ? [] : match[1].split(',');
  for (const [name, value] of Object.entries(settings)) value.on = wanted.includes(name);
  return settings;
}

/**
 * Which beat an event is for the man played (`playerId`), and which way he met it: { beat, way }, or null for an event
 * that is not his. `landed`: his blow landed, or one he takes; `blocked`: his own stopped on a guard or a shield, or one
 * stopped on his; `parry`: the same, blade on blade; `deflect`: he deflects, or is deflected; `executionBlow`: his point home.
 */
export function beatOf(event, playerId) {
  if (playerId === null || playerId === undefined) return null;
  switch (event.kind) {
    case 'landed':
      return event.attacker === playerId ? { beat: 'hit', way: 'landed' } : event.defender === playerId ? { beat: 'hit', way: 'taken' } : null;
    case 'blocked':
      return event.attacker === playerId ? { beat: 'block', way: 'blocked' } : event.defender === playerId ? { beat: 'block', way: 'guarded' } : null;
    case 'parry':
      return event.attacker === playerId ? { beat: 'block', way: 'blocked' } : event.fighter === playerId ? { beat: 'block', way: 'guarded' } : null;
    case 'deflect': {
      const beat = event.big ? 'bigDeflect' : 'deflect';
      return event.fighter === playerId ? { beat, way: 'deflected' } : event.attacker === playerId ? { beat, way: 'turned' } : null;
    }
    case 'executionBlow':
      return event.attacker === playerId ? { beat: 'execution', way: 'executed' } : null;
    default:
      return null;
  }
}

/**
 * The feel of the blows: hear(event, playerId, now) for each event of the world (now: real seconds);
 * it returns what to do at once ({ beat, way, strength, vibrate (ms), thump (gain), sound ({ kind, gain, strength } or
 * null: the beat's own), puff ({ point, normal, size, opacity, seconds }) }, or null for an event not felt). Each frame:
 * pace(now) (a share of the fight's pace), offset(now) (the camera's jolt, [x, y, z] m), vignette(now) (0..1), fov(now)
 * (degrees narrower), screen(now) (0..1 of the colour drained), frame(now) (degrees narrower, an execution's).
 */
export function createHitFeel(settings = loadHitFeel(null)) {
  const pulses = [];
  // An execution under way: when he stepped in (real s), and when the point went home (null until it does).
  let framing = null;
  const level = (name) => (settings[name]?.on ? settings[name].intensity : 0);

  function hear(event, playerId, now) {
    if (playerId === null || playerId === undefined) return null;
    // An execution begun (finisher.js): the view starts to close in; nothing else yet.
    if (event.kind === 'execution') {
      if (event.attacker === playerId) framing = { start: now, blow: null };
      return null;
    }
    const met = beatOf(event, playerId);
    if (!met) return null;
    const { beat, way } = met;
    const spec = HITFEEL.beats[beat] ?? null;
    const strength = Math.max(spec?.floor ?? 0, hitStrength(event)) * HITFEEL.share[way];
    if (strength <= 0) return null;
    if (beat === 'execution' && framing) framing.blow = now;
    // The thrust of an execution lands as any blow does, a step before its `executionBlow`: its hold is the execution's, not
    // a blow's hold and then the execution's after it.
    const held = !(beat === 'hit' && way === 'landed' && framing && framing.blow === null);
    // The blow's way: into the struck man (the event's normal points out of him, toward the striker). A meeting with no
    // normal of its own (a parry, the point home): a jolt straight down.
    const normal = event.normal ?? [0, 1, 0];
    const into = [-normal[0], -normal[1], -normal[2]];
    // The colour drained: the beat's own, or a landed blow's at the very top of its strength.
    const top = HITFEEL.screen;
    const drained = spec ? spec.screen : way === 'landed' && strength >= top.from ? top.hit * hitFeelClamp((strength - top.from) / (1 - top.from) + 0.5) : 0;
    pulses.push({ start: now, strength, beat, way, into, held, harm: way === 'taken' ? event.harm ?? 0 : 0, screen: drained, screenSeconds: spec?.screenSeconds ?? top.seconds });
    while (pulses.length > 8) pulses.shift();
    const haptic = level('haptic') * (spec?.haptic ?? 1);
    const thump = level('thump');
    const puff = level('puff');
    // The beat's own sound: a block's knock (on his guard, heavier than the blow that made it: lower and longer), a
    // deflect's ring (his own; a blow of his turned rings too, less), the execution's boom. A landed blow's is its thump.
    const sounds = HITFEEL.sound;
    const sound = thump <= 0 ? null
      : beat === 'block' ? { kind: 'knock', gain: sounds.knock * Math.min(1, strength / HITFEEL.share[way] + 0.25) * (way === 'guarded' ? 1 : 0.6) * thump, strength: Math.min(1, strength / HITFEEL.share[way] + 0.3) }
        : beat === 'deflect' || beat === 'bigDeflect' ? { kind: 'ring', gain: sounds.ring * (way === 'deflected' ? 1 : 0.6) * thump, strength: beat === 'bigDeflect' ? 1 : hitStrength(event) }
          : beat === 'execution' ? { kind: 'boom', gain: sounds.boom * thump, strength: 1 } : null;
    return {
      strength,
      beat,
      way,
      vibrate: haptic > 0 ? Math.round(Math.min(80, (HITFEEL.haptic.light + (HITFEEL.haptic.heavy - HITFEEL.haptic.light) * strength) * haptic)) : 0,
      // The body's thump is a blow's on a body: his own landed, one he takes, his own stopped (through the arms).
      thump: thump > 0 && (beat === 'hit' || way === 'blocked') ? HITFEEL.thump.gain * strength * thump : 0,
      sound,
      // The mist is off the struck place: a blow he lands or takes, not one stopped on a guard.
      puff: puff > 0 && beat === 'hit' && event.point ? { point: event.point, normal, size: HITFEEL.puff.size * (0.4 + 0.6 * strength), opacity: Math.min(0.6, HITFEEL.puff.opacity * strength * puff), seconds: HITFEEL.puff.seconds } : null,
    };
  }

  // (The longest any effect of a pulse lasts: an execution's drained colour.)
  const longest = Math.max(HITFEEL.kick.seconds, HITFEEL.vignette.seconds, HITFEEL.dim.seconds, HITFEEL.fov.seconds, HITFEEL.screen.seconds, ...Object.values(HITFEEL.beats).map((beat) => Math.max(beat.screenSeconds ?? 0, beat.stop.seconds.heavy * 2 + beat.stop.ease + (beat.stop.dilate?.seconds ?? 0))), HITFEEL.hitStop.seconds.heavy * 2 + HITFEEL.hitStop.ease + HITFEEL.hitStop.dilate.seconds);
  function forget(now) {
    while (pulses.length && now - pulses[0].start > longest) pulses.shift();
  }

  /** The hold a pulse asks for: a landed blow's (hitStop), a beat's own; none for a blow he takes (it is not his to savour). */
  const stopOf = (pulse) => (pulse.beat === 'hit' ? (pulse.way === 'landed' ? HITFEEL.hitStop : null) : HITFEEL.beats[pulse.beat].stop);

  /** The share of the fight's pace now: 1, or less in a hit-stop and the little slowing after it. */
  function pace(now) {
    const amount = level('hitStop');
    if (amount <= 0) return 1;
    forget(now);
    let share = 1;
    for (const pulse of pulses) {
      const spec = pulse.held ? stopOf(pulse) : null;
      if (!spec || pulse.strength < spec.from) continue;
      const over = spec.from < 1 ? (pulse.strength - spec.from) / (1 - spec.from) : 1;
      const hold = (spec.seconds.light + (spec.seconds.heavy - spec.seconds.light) * over) * amount;
      const age = now - pulse.start;
      if (age < 0) continue;
      if (age < hold) {
        share = Math.min(share, spec.slowest);
        continue;
      }
      // Let go over `ease`, to the slowed pace after it (if the beat has one), which runs back up to full.
      const after = age - hold;
      const slowed = spec.dilate ? 1 - (1 - spec.dilate.to) * over * Math.min(1, amount) * (1 - hitFeelClamp(after / spec.dilate.seconds)) : 1;
      share = Math.min(share, spec.slowest + (slowed - spec.slowest) * hitFeelClamp(after / spec.ease));
    }
    return share;
  }

  /** The camera's jolt now ([x, y, z] m, into out): along each blow's way, a damped swing. */
  function offset(now, out = [0, 0, 0]) {
    out[0] = 0;
    out[1] = 0;
    out[2] = 0;
    const amount = level('kick');
    if (amount <= 0) return out;
    forget(now);
    const spec = HITFEEL.kick;
    for (const pulse of pulses) {
      const age = now - pulse.start;
      if (age < 0 || age > spec.seconds) continue;
      const swing = Math.sin(2 * Math.PI * spec.hz * age) * Math.exp(-age / spec.decay);
      const metres = spec.metres * pulse.strength * (HITFEEL.beats[pulse.beat]?.kick ?? 1) * amount * swing;
      out[0] += pulse.into[0] * metres;
      out[1] += pulse.into[1] * metres - Math.abs(metres) * 0.3;
      out[2] += pulse.into[2] * metres;
    }
    return out;
  }

  /** How dark the edges are now (0..1): a blow on a body's, not a meeting of steel's (that is lit, not darkened). */
  function vignette(now) {
    const amount = level('vignette');
    if (amount <= 0) return 0;
    forget(now);
    const spec = HITFEEL.vignette;
    let most = 0;
    for (const pulse of pulses) {
      if (pulse.strength < spec.from || (pulse.beat !== 'hit' && pulse.beat !== 'execution' && pulse.way !== 'blocked')) continue;
      const left = 1 - (now - pulse.start) / spec.seconds;
      if (left > 0) most = Math.max(most, spec.opacity * amount * ((pulse.strength - spec.from) / (1 - spec.from)) * left * left);
    }
    return hitFeelClamp(most);
  }

  /** How dim the whole screen is now (0..1): by the harm of the blows he took. */
  function dim(now) {
    const amount = level('dim');
    if (amount <= 0) return 0;
    forget(now);
    const spec = HITFEEL.dim;
    let most = 0;
    for (const pulse of pulses) {
      if (pulse.harm < spec.from) continue;
      const left = 1 - (now - pulse.start) / spec.seconds;
      if (left > 0) most = Math.max(most, spec.opacity * amount * hitFeelClamp((pulse.harm - spec.from) / (spec.full - spec.from)) * left * left);
    }
    return hitFeelClamp(most);
  }

  /** How much narrower the view is now (degrees). */
  function fov(now) {
    const amount = level('fov');
    if (amount <= 0) return 0;
    forget(now);
    const spec = HITFEEL.fov;
    let most = 0;
    for (const pulse of pulses) {
      const age = now - pulse.start;
      if (age < 0 || age > spec.seconds) continue;
      // In at once, out smoothly.
      const left = 1 - age / spec.seconds;
      most = Math.max(most, spec.degrees * pulse.strength * (HITFEEL.beats[pulse.beat]?.fov ?? 1) * amount * left * left * (3 - 2 * left));
    }
    return most;
  }

  /** How far the colour is drained from the screen's edges now (0..1): the biggest moments only. */
  function screen(now) {
    const amount = level('screen');
    if (amount <= 0) return 0;
    forget(now);
    let most = 0;
    for (const pulse of pulses) {
      if (!(pulse.screen > 0)) continue;
      const age = now - pulse.start;
      if (age < 0 || age > pulse.screenSeconds) continue;
      const left = 1 - age / pulse.screenSeconds;
      most = Math.max(most, pulse.screen * amount * Math.min(1, age / HITFEEL.screen.in) * left * left * (3 - 2 * left));
    }
    return hitFeelClamp(most);
  }

  /** How much narrower an execution holds the view now (degrees): in as he steps in, a punch as the point goes home, then out. */
  function frame(now) {
    const amount = level('frame');
    if (!framing) return 0;
    const spec = HITFEEL.frame;
    const smooth = (x) => {
      const t = hitFeelClamp(x);
      return t * t * (3 - 2 * t);
    };
    const into = smooth((now - framing.start) / spec.in);
    // Let go from when the point went home (after its hold), or from `most` s if it never did.
    const from = framing.blow !== null ? framing.blow + spec.hold : framing.start + spec.most;
    const out = 1 - smooth((now - from) / spec.out);
    if (now - from >= spec.out) {
      framing = null;
      return 0;
    }
    const punched = framing.blow !== null && now >= framing.blow ? spec.punch * (1 - hitFeelClamp((now - framing.blow) / spec.punchSeconds)) ** 2 : 0;
    return amount * (spec.degrees * into * out + punched);
  }

  function reset() {
    pulses.splice(0);
    framing = null;
  }

  return { settings, hear, pace, offset, vignette, dim, fov, screen, frame, reset, get active() { return pulses.length; } };
}
