// What a meeting of weapons throws into the scene, and the streak a fast blade leaves (hitfeel.js HITFEEL.sparks, .finish and
// .trail: every number is there). All of it is read off what the physics did:
//
//   sparks  only where steel met steel (the event's `parts`: an edge on a board or a haft throws none), as many and as fast as
//           the meeting's impulse, thrown the way the faster blade was scraping across the other (the event's `slide`, less its
//           part along the contact's normal: a grinder throws its sparks the way the wheel runs). An ordinary clash: a few, dull,
//           falling. A deflect: a burst, bright, thrown one way, with a flash that lights the men and the floor.
//   trail   a ribbon swept by the outer part of the blade through the last eighth of a second, lit only where the tip really
//           moved fast: nothing is drawn for a stroke as such, so a thrust (the blade moving along itself) sweeps no area and
//           leaves none, and any weapon swung fast leaves one.
//
// One rule for every weapon and every man. In a crowd's meetings (neither man the one played, nor his man) the sparks are a
// share and no light is thrown; trails are the man played's and his man's only. Nothing is allocated per frame: the sparks are
// weaponview.js's own pool, the light is battlefx.js's one flash light, the ribbons a fixed few built once.

/* global THREE */

import { P } from './body.js';
import { battleFxLight, battleFxSpark } from './battlefx.js';
import { HITFEEL } from './hitfeel.js';
import { spawnSparks } from './weaponview.js';

const fxClamp = (value) => Math.max(0, Math.min(1, value));
const fxMix = ([light, heavy], share) => light + (heavy - light) * share;

/** A meeting's strength for its sparks (0..1): its impulse (N·s) on a log scale, as a blow's strength is (hitfeel.js). */
export function sparkStrength(impulse) {
  const { light, heavy } = HITFEEL.sparks.impulse;
  return impulse > light ? fxClamp(Math.log(impulse / light) / Math.log(heavy / light)) : 0;
}

/** Whether both things that met are steel (the event's `parts`; an event that does not say is a blade on a blade). */
export function steelOnSteel(parts) {
  return !parts || parts.every((part) => HITFEEL.sparks.steel.includes(part));
}

/**
 * Which way a meeting's sparks are thrown: the faster blade's motion across the other (`slide`) less its part along the
 * contact's `normal`, into `out` ([x, y, z], a unit vector); returns the share of the motion that was across (0: they met
 * square and nothing says which way; `out` is then not set).
 */
export function sparkWay(slide, normal, out) {
  if (!slide || !normal) return 0;
  const speed = Math.hypot(slide[0], slide[1], slide[2]);
  if (!(speed > 1e-6)) return 0;
  const into = slide[0] * normal[0] + slide[1] * normal[1] + slide[2] * normal[2];
  const x = slide[0] - normal[0] * into;
  const y = slide[1] - normal[1] * into;
  const z = slide[2] - normal[2] * into;
  const across = Math.hypot(x, y, z);
  if (!(across > 1e-6)) return 0;
  out[0] = x / across;
  out[1] = y / across;
  out[2] = z / across;
  return across / speed;
}

/**
 * The scene's side of the combat beats in `view` (render.js's scene), by `settings` (hitfeel.js's, read as they are now).
 * contact(event, world, { playerId, opponentId, tier }) for each event of the world; trails(blades, time, tier) each frame with
 * the men whose blades are trailed and the moment drawn (the fight's seconds); burst(kind, at, ...) for the bench; reset().
 */
export function createCombatFx(view, settings) {
  const level = (name) => (settings[name]?.on ? settings[name].intensity : 0);
  const way = [0, 0, 0];
  const speeds = [0, 0];
  const lifted = [0, 0, 0];

  /**
   * Sparks, their flash and its light at `at`: `kind` 'clash' or 'deflect' (HITFEEL.sparks), of `strength` (0..1), thrown
   * `along` (a unit vector, or null: all round) as tightly as `across` (0..1) of the motion was that way; `share`: of the
   * full count (a crowd's, a tier's); `lit`: whether its light is thrown on the scene.
   */
  function burst(kind, at, { strength = 0.5, along = null, across = 1, share = 1, lit = true, more = 1 } = {}) {
    const amount = level('sparks');
    if (amount <= 0) return 0;
    const spec = HITFEEL.sparks[kind];
    const count = Math.round(fxMix(spec.count, strength) * share * more * Math.min(1.5, amount));
    if (count < 1) return 0;
    speeds[0] = spec.speed;
    speeds[1] = fxMix(spec.speedMost, strength) * Math.sqrt(more);
    const options = { flash: false, along: null, speed: speeds, life: spec.life, width: spec.width, cone: spec.cone, tint: spec.tint, gravity: spec.gravity };
    // Those thrown the way the blade scraped, and the rest all round (all of them, when the blades met square).
    const thrown = along && across > 0.2 ? Math.round(count * (1 - spec.loose)) : 0;
    if (thrown > 0) {
      options.along = along;
      options.cone = spec.cone * across;
      spawnSparks(view, at, thrown, options);
      options.along = null;
    }
    if (count > thrown) spawnSparks(view, at, count - thrown, options);
    battleFxSpark(view, at, fxMix(spec.flash.size, strength) * Math.sqrt(more), spec.flash.colour, spec.flash.seconds);
    const peak = fxMix(spec.light.peak, strength) * more * Math.min(1.5, amount);
    // (The light a hand's breadth above the meeting: on the blades themselves it would light only their far sides.)
    if (lit && peak > 0.05) {
      lifted[0] = at[0];
      lifted[1] = at[1] + 0.15;
      lifted[2] = at[2];
      battleFxLight(view, lifted, spec.light.colour, peak, spec.light.seconds, spec.light.range);
    }
    return count;
  }

  /** A world event's sparks and light. `near`: a meeting of the man played or his man, or a duel's: in full, and lit. */
  function contact(event, world, { playerId = null, opponentId = null, tier = 'high' } = {}) {
    const kind = event.kind;
    if (kind !== 'clash' && kind !== 'deflect' && kind !== 'glance' && kind !== 'executionBlow') return;
    const mine = (id) => id !== undefined && id !== null && (id === playerId || id === opponentId);
    const near = world.fighters.length <= 2 || mine(event.fighter) || mine(event.other) || mine(event.attacker);
    const share = (near ? 1 : HITFEEL.sparks.crowd) * (HITFEEL.sparks.tier[tier] ?? 1);
    if (kind === 'executionBlow') {
      // The point home: a pale flash on the two men (the blood is the blow's own, weaponview.js).
      if (!near || level('sparks') <= 0) return;
      const man = world.fighters[event.fighter];
      if (!man) return;
      const spec = HITFEEL.finish;
      lifted[0] = man.x[P.head * 3];
      lifted[1] = man.x[P.head * 3 + 1];
      lifted[2] = man.x[P.head * 3 + 2];
      battleFxSpark(view, lifted, spec.flash.size, spec.flash.colour, spec.flash.seconds);
      lifted[1] += 0.2;
      battleFxLight(view, lifted, spec.light.colour, spec.light.peak, spec.light.seconds, spec.light.range);
      return;
    }
    // (A deflect's clash has no sparks of its own: the deflect's are its.)
    if (kind === 'clash' && event.deflect) return;
    if (!event.point || !steelOnSteel(event.parts)) return;
    if (kind === 'glance') {
      burst('clash', event.point, { strength: HITFEEL.sparks.glance.strength, share, lit: false });
      return;
    }
    const across = sparkWay(event.slide, event.normal, way);
    const strength = sparkStrength(event.impulse ?? 0);
    if (kind === 'deflect') burst('deflect', event.point, { strength, along: across > 0 ? way : null, across, share, lit: near, more: event.big ? HITFEEL.sparks.big : 1 });
    else burst('clash', event.point, { strength, along: across > 0 ? way : null, across, share, lit: near });
  }

  // ---- The blades' trails ------------------------------------------------------------------------------------------

  const ribbons = [];
  const trailSpec = HITFEEL.trail;
  const most = trailSpec.samples;

  function ribbon() {
    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute('position', new THREE.BufferAttribute(new Float32Array(most * 2 * 3), 3).setUsage(THREE.DynamicDrawUsage));
    geometry.setAttribute('color', new THREE.BufferAttribute(new Float32Array(most * 2 * 3), 3).setUsage(THREE.DynamicDrawUsage));
    const index = [];
    for (let at = 0; at < most - 1; at += 1) {
      const a = at * 2;
      index.push(a, a + 1, a + 2, a + 1, a + 3, a + 2);
    }
    geometry.setIndex(index);
    // Added light, both faces, no depth written: a streak in the air, behind what stands before it. (Its colours are light
    // as the scene's is: an open-air place's bloom takes it as it takes the sparks.)
    const material = new THREE.MeshBasicMaterial({ vertexColors: true, transparent: true, blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide, fog: false });
    const mesh = new THREE.Mesh(geometry, material);
    mesh.frustumCulled = false;
    mesh.renderOrder = 6;
    mesh.userData.seeThrough = false;
    mesh.visible = false;
    view.scene.add(mesh);
    // Each sample: where the hand was, how the blade lay, when (the fight's seconds), and how fast the tip was going.
    return { mesh, weapon: null, used: false, count: 0, hand: new Float32Array(most * 3), dir: new Float32Array(most * 3), time: new Float32Array(most), speed: new Float32Array(most), tip: [0, 0, 0] };
  }

  function clear(trail) {
    trail.weapon = null;
    trail.count = 0;
    trail.mesh.visible = false;
  }

  /** Drop the `gone` oldest samples. */
  function drop(trail, gone) {
    if (gone <= 0) return;
    trail.hand.copyWithin(0, gone * 3, trail.count * 3);
    trail.dir.copyWithin(0, gone * 3, trail.count * 3);
    trail.time.copyWithin(0, gone, trail.count);
    trail.speed.copyWithin(0, gone, trail.count);
    trail.count -= gone;
  }

  function put(trail, hx, hy, hz, dx, dy, dz, time, speed) {
    if (trail.count >= most) drop(trail, 1);
    const at = trail.count;
    trail.hand[at * 3] = hx;
    trail.hand[at * 3 + 1] = hy;
    trail.hand[at * 3 + 2] = hz;
    const length = Math.hypot(dx, dy, dz) || 1;
    trail.dir[at * 3] = dx / length;
    trail.dir[at * 3 + 1] = dy / length;
    trail.dir[at * 3 + 2] = dz / length;
    trail.time[at] = time;
    trail.speed[at] = speed;
    trail.count += 1;
  }

  function sample(trail, fighter, weapon, time) {
    const hand = P[`${weapon.main}Hand`] * 3;
    const hx = fighter.x[hand];
    const hy = fighter.x[hand + 1];
    const hz = fighter.x[hand + 2];
    const [dx, dy, dz] = weapon.dir;
    const reach = weapon.spec.length;
    const tx = hx + dx * reach;
    const ty = hy + dy * reach;
    const tz = hz + dz * reach;
    const last = trail.count - 1;
    if (last >= 0) {
      const dt = time - trail.time[last];
      // (The fight held, a hit-stop or a pause: the streak stands as it is. A clock gone back: a new bout.)
      if (dt < 0) trail.count = 0;
      else if (!(dt > 1e-5)) return;
      const moved = Math.hypot(tx - trail.tip[0], ty - trail.tip[1], tz - trail.tip[2]);
      const speed = moved / dt;
      // A blade that jumped (a new bout, a man placed): no streak across the jump.
      if (moved > 3 || dt > 0.25) trail.count = 0;
      else if (trail.count > 0) {
        // The frames between laid in (the hand and the blade's line each taken straight across, the line made a unit again):
        // only for a blade fast enough to show.
        const steps = speed > trailSpec.from * 0.5 ? trailSpec.steps : 1;
        const lx = trail.hand[last * 3];
        const ly = trail.hand[last * 3 + 1];
        const lz = trail.hand[last * 3 + 2];
        const ex = trail.dir[last * 3];
        const ey = trail.dir[last * 3 + 1];
        const ez = trail.dir[last * 3 + 2];
        const then = trail.time[last];
        for (let step = 1; step <= steps; step += 1) {
          const u = step / steps;
          put(trail, lx + (hx - lx) * u, ly + (hy - ly) * u, lz + (hz - lz) * u, ex + (dx - ex) * u, ey + (dy - ey) * u, ez + (dz - ez) * u, then + dt * u, speed);
        }
      }
    }
    if (trail.count === 0) put(trail, hx, hy, hz, dx, dy, dz, time, 0);
    trail.tip[0] = tx;
    trail.tip[1] = ty;
    trail.tip[2] = tz;
  }

  function fill(trail, weapon, time, amount) {
    let gone = 0;
    while (gone < trail.count - 1 && time - trail.time[gone] > trailSpec.seconds) gone += 1;
    drop(trail, gone);
    const positions = trail.mesh.geometry.attributes.position.array;
    const colors = trail.mesh.geometry.attributes.color.array;
    const spec = weapon.spec;
    const near = spec.strikeFrom + (spec.length - spec.strikeFrom) * trailSpec.inner;
    const far = spec.length;
    const [r, g, b] = trailSpec.colour;
    let brightest = 0;
    for (let index = 0; index < trail.count; index += 1) {
      const at = index * 3;
      const fresh = fxClamp(1 - (time - trail.time[index]) / trailSpec.seconds);
      const fast = fxClamp((trail.speed[index] - trailSpec.from) / (trailSpec.full - trailSpec.from));
      const lit = trailSpec.peak * amount * fresh ** 1.5 * fast * fast * (3 - 2 * fast);
      if (lit > brightest) brightest = lit;
      const out = index * 6;
      // The inner edge dark, the tip's edge lit: the streak fades inward along the blade.
      positions[out] = trail.hand[at] + trail.dir[at] * near;
      positions[out + 1] = trail.hand[at + 1] + trail.dir[at + 1] * near;
      positions[out + 2] = trail.hand[at + 2] + trail.dir[at + 2] * near;
      positions[out + 3] = trail.hand[at] + trail.dir[at] * far;
      positions[out + 4] = trail.hand[at + 1] + trail.dir[at + 1] * far;
      positions[out + 5] = trail.hand[at + 2] + trail.dir[at + 2] * far;
      colors[out] = 0;
      colors[out + 1] = 0;
      colors[out + 2] = 0;
      colors[out + 3] = r * lit;
      colors[out + 4] = g * lit;
      colors[out + 5] = b * lit;
    }
    const shown = trail.count >= 2 && brightest > 0.004;
    trail.mesh.visible = shown;
    if (!shown) return;
    trail.mesh.geometry.attributes.position.needsUpdate = true;
    trail.mesh.geometry.attributes.color.needsUpdate = true;
    trail.mesh.geometry.setDrawRange(0, (trail.count - 1) * 6);
  }

  /**
   * The trails this frame: of each of `men`'s blades held (his weapon, and his off hand's), as many as the tier allows, at
   * `time` (the moment drawn, the fight's seconds: a hit-stop holds the streak with the blade).
   */
  function trails(men, time, tier = 'high') {
    const amount = level('trail');
    const allowed = amount > 0 ? trailSpec.most[tier] ?? trailSpec.most.high : 0;
    for (const trail of ribbons) trail.used = false;
    let taken = 0;
    for (const fighter of men) {
      if (!fighter) continue;
      for (const weapon of [fighter.weapon, fighter.offWeapon]) {
        if (taken >= allowed) break;
        if (!weapon?.held || !weapon.dir || weapon.spec.ranged || fighter.dormant) continue;
        let trail = ribbons.find((entry) => entry.weapon === weapon);
        if (!trail) {
          trail = ribbons.find((entry) => !entry.weapon) ?? (ribbons.length < allowed ? ribbons[ribbons.push(ribbon()) - 1] : null);
          if (!trail) continue;
          trail.weapon = weapon;
          trail.count = 0;
        }
        trail.used = true;
        taken += 1;
        sample(trail, fighter, weapon, time);
        fill(trail, weapon, time, Math.min(2, amount));
      }
    }
    for (const trail of ribbons) if (!trail.used && trail.weapon) clear(trail);
  }

  function reset() {
    for (const trail of ribbons) clear(trail);
  }

  return { contact, burst, trails, reset, get ribbons() { return ribbons; } };
}
