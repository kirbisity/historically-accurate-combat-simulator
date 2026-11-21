// The combat beats' own sounds (hitfeel.js: a block's knock, a deflect's ring, an execution's boom), each laid under the sound the
// physics made of the same meeting, so that the four beats are told apart by ear as well as by eye. Like the thump, not in the world
// (no distance, no room): the man played's own exchange, straight into the effects bus.

import { sfxBurst, sfxModes, sfxTone } from '../synth.js';

/**
 * A beat's sound by its strength (0..1), without a context.
 * - knock: a blow stopped dead on a guard: a low thud (lower and longer the heavier) with a short wooden knock over it, no ring.
 * - ring: steel turned off steel: three high partials of a struck bar (not a chord: a bar's overtones), lower for a heavier meeting,
 *   ringing a third to a half of a second, with a click at its start.
 * - boom: the point gone home: a sub-bass drop over most of a second, felt in the chest.
 */
export function beatParams(kind, strength) {
  const s = Math.max(0, Math.min(1, strength));
  if (kind === 'knock') return { kind, frequency: 120 - 35 * s, to: 60 - 15 * s, decay: 0.07 + 0.09 * s, knock: 520 - 160 * s, knockDecay: 0.03 + 0.02 * s };
  if (kind === 'ring') {
    const base = 2600 - 700 * s;
    const decay = 0.3 + 0.25 * s;
    return { kind, modes: [{ f: base, decay, amp: 1 }, { f: base * 1.593, decay: decay * 0.7, amp: 0.6 }, { f: base * 2.136, decay: decay * 0.45, amp: 0.35 }], click: 5200, clickDecay: 0.012 };
  }
  return { kind: 'boom', frequency: 62, to: 26, decay: 0.55 + 0.25 * s, body: 0.6, bodyDecay: 0.22 };
}

/** Play a beat's sound at `gain` into `out`. Returns the end time. */
export function playBeat(voice, out, params, when, gain) {
  if (params.kind === 'knock') {
    sfxTone(voice, out, { when, peak: gain, attack: 0.002, decay: params.decay, frequency: params.frequency, to: params.to });
    sfxBurst(voice, out, { when, peak: gain * 0.7, attack: 0.001, decay: params.knockDecay, type: 'bandpass', frequency: params.knock, q: 1.4, color: 'brown' });
    return when + params.decay + 0.05;
  }
  if (params.kind === 'ring') {
    sfxModes(voice, out, when, params.modes, gain);
    sfxBurst(voice, out, { when, peak: gain * 0.5, attack: 0.0005, decay: params.clickDecay, type: 'highpass', frequency: params.click, q: 0.7 });
    return when + params.modes[0].decay + 0.05;
  }
  sfxTone(voice, out, { when, peak: gain, attack: 0.006, decay: params.decay, frequency: params.frequency, to: params.to });
  sfxBurst(voice, out, { when, peak: gain * params.body, attack: 0.002, decay: params.bodyDecay, type: 'lowpass', frequency: 180, q: 0.7, color: 'brown' });
  return when + params.decay + 0.05;
}
