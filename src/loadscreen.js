// The loading screen (main.js loadInto): over the page from the moment a fight, a battle, a level or a chapter is chosen
// until its first frame is drawn. What is loading (its name, the line the game has for it: a battle's place and date,
// its blurb), and a bar moved by the real stages of the work (loadsteps.js LOAD.stages: the men raised, the shaders
// prepared...). The bar's glint and the seal's turn are CSS animations of transform and opacity, which the browser runs
// off the page's thread: they go on moving through a long step of building, when no script can.

import { t } from './i18n.js';

/** The words for a stage of the load now (loadsteps.js createLoadProgress's `now()`), in the language in force. */
export function loadStageText({ stage, done, total }) {
  return total > 0 ? t(`load.${stage}Count`, { done, total }) : t(`load.${stage}`);
}

/** The screen in `root` (the page's body), hidden until `show`. */
export function createLoadScreen(root) {
  const make = (tag, className, text = '') => Object.assign(document.createElement(tag), { className, textContent: text });
  const screen = make('div', 'loading');
  screen.id = 'loading';
  screen.hidden = true;
  screen.setAttribute('role', 'status');
  screen.setAttribute('aria-live', 'polite');
  const kicker = make('em', 'loading-kicker');
  const title = make('h1', 'loading-title');
  const line = make('p', 'loading-line');
  const fill = make('i', 'loading-fill');
  const bar = make('div', 'loading-bar');
  bar.append(fill, make('b', 'loading-glint'));
  const stage = make('span', 'loading-stage');
  const seal = make('div', 'loading-seal');
  seal.setAttribute('aria-hidden', 'true');
  const plate = make('div', 'loading-plate');
  plate.append(seal, kicker, title, line, bar, stage);
  screen.append(plate);
  root.append(screen);
  let shown = null;
  return {
    /** Up at once: `title` what is loading, `kicker` the line over it, `line` a sentence of it (each optional). */
    show({ title: name = '', kicker: over = '', line: about = '' } = {}) {
      shown = { name, over, about };
      title.textContent = name || t('load.loading');
      kicker.textContent = over;
      kicker.hidden = !over;
      line.textContent = about;
      line.hidden = !about;
      fill.style.transform = 'scaleX(0)';
      stage.textContent = t('load.world');
      screen.hidden = false;
      document.body.classList.add('loading-on');
    },
    /** The words changed, the bar where it is (a load that turned out to be another's: a rematch's own way in). */
    retitle({ title: name = '', kicker: over = '', line: about = '' } = {}) {
      if (!shown) return;
      title.textContent = name || t('load.loading');
      kicker.textContent = over;
      kicker.hidden = !over;
      line.textContent = about;
      line.hidden = !about;
    },
    /** The bar and its words at `now` (createLoadProgress's: { stage, fraction, done, total }). */
    progress(now) {
      if (!shown) return;
      fill.style.transform = `scaleX(${now.fraction.toFixed(4)})`;
      stage.textContent = loadStageText(now);
    },
    hide() {
      shown = null;
      screen.hidden = true;
      document.body.classList.remove('loading-on');
    },
    get open() {
      return Boolean(shown);
    },
    element: screen,
  };
}
