// The afflictions as the man played feels them (physics/afflictions.js is the rule): laid over the picture, each its own look so neither
// reads as being tired (overdraftview.js: a dark vignette that beats like a heart).
//
//   sick   a sour yellow-green seeping in from the edges and over the picture, and the picture itself swaying slowly, as a sick man's
//          head swims (a roll and a drift of the canvas, two slow sines); a heave clenches it (a squeeze and a darker flush) for a moment.
//   frost  rime creeping in from the edges (a frost texture masked to a ring that closes in), the picture going cold and grey-blue;
//          numb past halfway, a fine shiver of the picture.
//
// Plain DOM, styled by boxer.css from custom properties (`--sick`, `--heave`, `--chill`): a frame changes a property or two, nothing while
// clear. The canvas's own transform is the only other thing touched, and only while he is sick or shivering.

import { chillOf, heaveOf, nauseaOf, staminaCeiling } from './physics/afflictions.js';

export const AFFLICT_VIEW = {
  // The sway: its roll (deg) and drift (share of the picture) at nausea 1, and its two periods (s).
  roll: 1.1,
  drift: 0.012,
  periods: [5.3, 3.7],
  // How much the picture grows while it sways (its edges kept off the screen), at nausea 1.
  zoom: 0.03,
  // The shiver past `shiverFrom` chill: px at chill 1, Hz.
  shiverFrom: 0.5,
  shiver: 1.6,
  shiverHz: 23,
};

/** The canvas's transform for this sickness, heave and chill at `time` s (none while all are clear). */
export function swayTransform(sick, heave, chill, time) {
  const spec = AFFLICT_VIEW;
  const shake = chill > spec.shiverFrom ? ((chill - spec.shiverFrom) / (1 - spec.shiverFrom)) * spec.shiver : 0;
  if (sick < 0.01 && heave <= 0 && shake <= 0) return '';
  const [a, b] = spec.periods;
  const roll = spec.roll * sick * Math.sin((time * 2 * Math.PI) / a);
  const dx = spec.drift * sick * Math.sin((time * 2 * Math.PI) / b + 1.3) * 100;
  const dy = spec.drift * sick * 0.6 * Math.sin((time * 2 * Math.PI) / a + 0.4) * 100;
  const scale = 1 + spec.zoom * sick - 0.025 * heave;
  const squash = 1 - 0.03 * heave;
  const sx = shake ? shake * Math.sin(time * 2 * Math.PI * spec.shiverHz) : 0;
  const sy = shake ? shake * 0.7 * Math.sin(time * 2 * Math.PI * spec.shiverHz * 1.37) : 0;
  return `translate(calc(${dx.toFixed(3)}% + ${sx.toFixed(2)}px), calc(${dy.toFixed(3)}% + ${sy.toFixed(2)}px)) rotate(${roll.toFixed(3)}deg) scale(${scale.toFixed(4)}, ${(scale * squash).toFixed(4)})`;
}

/**
 * Drive the two overlays and the canvas's sway: `update(fighter, time)`, the man played (or null) and the world's time (s). Returns
 * { update }.
 */
export function installAfflictions(sickElement, frostElement, canvas) {
  // (Asked for less motion: the tints only, the picture kept still.)
  const still = typeof matchMedia === 'function' && matchMedia('(prefers-reduced-motion: reduce)').matches;
  const shown = { '--sick': -1, '--heave': -1, '--chill': -1, transform: null };
  // A property set only when it has moved; the element hidden while all of its are clear.
  const paint = (element, values) => {
    let any = false;
    for (const [name, raw] of Object.entries(values)) {
      const value = raw < 0.01 ? 0 : raw;
      any ||= value > 0;
      if (Math.abs(value - shown[name]) < 0.004 && (value > 0 || shown[name] === 0)) continue;
      shown[name] = value;
      element.style.setProperty(name, value.toFixed(3));
    }
    const display = any ? '' : 'none';
    if (element.style.display !== display) element.style.display = display;
  };
  return {
    update(fighter, time) {
      const live = fighter && fighter.state !== 'out';
      const sick = live ? nauseaOf(fighter) : 0;
      const heave = live ? heaveOf(fighter, time) : 0;
      const chill = live ? chillOf(fighter) : 0;
      paint(sickElement, { '--sick': sick, '--heave': heave });
      paint(frostElement, { '--chill': chill });
      const transform = still ? '' : swayTransform(sick, heave, chill, time);
      if (transform !== shown.transform) {
        shown.transform = transform;
        canvas.style.transform = transform;
      }
    },
  };
}

/**
 * Paint a card's affliction bars (`.bar.nausea`, `.bar.chill`, each holding an `<i>`, shown only while he has some) and the ceiling his
 * nausea puts on his stamina bar (`--cap`: the share of the bar shut off, drawn hatched over its end: boxer.css).
 */
export function paintAfflictions(card, fighter) {
  const sick = nauseaOf(fighter);
  const chill = chillOf(fighter);
  const bar = (name, value) => {
    const element = card.querySelector(`.bar.${name}`);
    if (!element) return;
    const on = value >= 0.01;
    if (element.hidden === on) element.hidden = !on;
    if (on) element.querySelector('i').style.width = `${Math.round(value * 100)}%`;
  };
  bar('nausea', sick);
  bar('chill', chill);
  const stamina = card.querySelector('.bar.stamina');
  if (stamina) stamina.style.setProperty('--cap', `${Math.round((1 - staminaCeiling(fighter)) * 100)}%`);
}
