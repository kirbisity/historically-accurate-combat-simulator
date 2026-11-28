// The face customizer's screen: the head in its studio (stage.js) filling the screen, and over it a dark, see-through sidebar
// (on a phone a bottom sheet that folds down to its header): the ancestry preset and the sex, Randomize and the Similar Faces
// grid, the sliders in their groups (each a range and a number, 0 to 255, kept in step), each slider and each group reset to
// the preset's baseline, and the preset file out and in (a download and an upload, a copy and a paste). Reached from the home
// screen and from the character creator's Look step (menu.js), and on a page of its own (facecustom.html).

import { ETHNICITY_PRESETS, FACE_SLIDERS, normalizeFace, randomFace, similarFaces } from './core.js';
import { faceStage, FACE_STAGE } from './stage.js';
import { FACE_UI, faceText, facePreset, parseFaceText, readFaceStore, resetGroup, resetSlider, slidersByGroup, sliderValue, withSlider, writeFaceStore } from './state.js';
import { onLangChange, pick, t } from '../i18n.js';
import { uiIcon, withIcon } from '../uiicons.js';

export const FACE_VIEW = {
  // How long after the last slider move the face is kept and the Similar Faces grid drawn again (ms): a drag keeps neither busy.
  settleMs: 220,
  // How long a status word ("Copied", "Loaded", an error) stays under the file buttons (ms).
  noteMs: 2400,
  // The file a download is saved as.
  fileName: 'hacs-face.json',
  // The sections open when the screen first opens: the variations and the head's overall shape (the rest folded, so the sidebar starts short).
  openGroups: ['similar', 'general'],
  // Where the sidebar becomes a bottom sheet (boxer.css, the face customizer's phone rule: the same width).
  phoneQuery: '(max-width: 720px)',
};

const faceEl = (tag, props = {}, ...children) => {
  const { icon, dataset, ...rest } = props;
  const node = Object.assign(document.createElement(tag), rest);
  if (dataset) Object.assign(node.dataset, dataset);
  node.append(...children.filter((child) => child !== null && child !== undefined && child !== false));
  return icon ? withIcon(node, icon) : node;
};

/** A small seeded random (mulberry32), so one set of variations stays the same set while the face under it moves. */
function faceUiRng(seed) {
  let state = seed >>> 0;
  return () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let mixed = Math.imul(state ^ (state >>> 15), 1 | state);
    mixed = (mixed + Math.imul(mixed ^ (mixed >>> 7), 61 | mixed)) ^ mixed;
    return ((mixed ^ (mixed >>> 14)) >>> 0) / 4294967296;
  };
}

/**
 * Open the customizer in `root`. Options:
 *   face       the face to start from (else the one kept in this browser, else the first preset's)
 *   sex        the sex to start a new face as, when there is no face to start from
 *   onBack()   leave the screen (after it has been taken down)
 *   onUse(face) where the face is wanted (the creator's fighter): its button "Use this face"; without it the screen keeps the
 *              face in this browser and offers "Your fighter wears it" (the player's fighter in every quick fight)
 *   storage    where the face is kept (localStorage by default)
 * Returns { face(), setFace(face), close() } (and the stage, for tests).
 */
export function faceCustomScreen(root, { face: startFace = null, sex = null, onBack = null, onUse = null, storage = globalThis.localStorage } = {}) {
  const kept = readFaceStore(storage);
  let face = startFace ? parseFaceObject(startFace) : kept?.face ?? facePreset(Object.keys(ETHNICITY_PRESETS)[0], sex ?? 'male');
  let wear = kept?.wear ?? false;
  let seed = 1;
  let settleTimer = 0;
  const openGroups = new Set(FACE_VIEW.openGroups);
  let sheetOpen = true;

  root.replaceChildren();
  root.className = 'screen face-custom';
  const canvas = faceEl('canvas', { className: 'face-canvas', ariaLabel: t('face.title') });
  const views = faceEl('div', { className: 'seg face-views', role: 'group' });
  const backButton = onBack ? faceEl('button', { className: 'back face-back', type: 'button', onclick: close }) : null;
  const stageBox = faceEl('div', { className: 'face-stage' }, canvas, views, backButton);
  const panel = faceEl('aside', { className: 'face-panel' });
  root.append(stageBox, panel);
  const stage = faceStage(canvas, face, { insets: coveredBySidebar });
  const thumbCanvases = Array.from({ length: FACE_UI.similarCount }, () => faceEl('canvas', { className: 'face-thumb-canvas' }));
  let variants = [];

  // Every control that shows a slider's value, by slider id, so a change from anywhere sets them all without a redraw.
  const sliderControls = new Map();
  let note = null;
  let noteTimer = 0;
  let codeBox = null;

  /** What of the canvas the sidebar covers: its right on a desk, its bottom on a phone (where it is a sheet). Told to the CSS too. */
  function coveredBySidebar() {
    if (!panel.isConnected) return { right: 0, bottom: 0 };
    const box = panel.getBoundingClientRect();
    const view = canvas.getBoundingClientRect();
    const sheet = globalThis.matchMedia?.(FACE_VIEW.phoneQuery).matches;
    const right = sheet ? 0 : Math.max(0, view.right - box.left);
    const bottom = sheet ? Math.max(0, view.bottom - box.top) : 0;
    root.style.setProperty('--face-side', `${right}px`);
    root.style.setProperty('--face-sheet', `${bottom}px`);
    return { right, bottom };
  }

  function draw() {
    views.ariaLabel = t('face.views');
    views.replaceChildren(...Object.keys(FACE_STAGE.views).map((name) => faceEl('button', { type: 'button', textContent: t(`face.view.${name}`), dataset: { view: name }, onclick: () => stage.snap(name) })));
    if (backButton) backButton.textContent = t('common.back');
    sliderControls.clear();
    panel.replaceChildren(head(), presetRow(), toolRow(), similarSection(), ...slidersByGroup(FACE_SLIDERS).map(groupSection), fileSection(), useRow());
    panel.classList.toggle('folded', !sheetOpen);
    stage.resize();
    paintThumbs();
  }

  function head() {
    return faceEl('header', { className: 'face-head' },
      faceEl('h1', { textContent: t('face.title') }),
      // (On a phone the sidebar is a bottom sheet: this folds it to its header and opens it again.)
      faceEl('button', { type: 'button', className: 'face-sheet-toggle', ariaExpanded: String(sheetOpen), ariaLabel: t('face.sheet'), onclick: () => { sheetOpen = !sheetOpen; draw(); } }, uiIcon('down')));
  }

  function presetRow() {
    const select = faceEl('select', { className: 'face-preset', ariaLabel: t('face.preset'), onchange: () => adopt(facePreset(select.value, face.sex)) },
      ...Object.entries(ETHNICITY_PRESETS).map(([id, preset]) => new Option(pick({ en: preset.label, zh: preset.labelZh }), id)));
    select.value = face.preset;
    const sexes = faceEl('div', { className: 'seg face-sex', role: 'radiogroup', ariaLabel: t('face.sex') }, ...['male', 'female'].map((each) => faceEl('button', {
      type: 'button', role: 'radio', className: face.sex === each ? 'on' : '', ariaChecked: String(face.sex === each), textContent: t(`face.${each}`), dataset: { sex: each },
      onclick: () => { if (face.sex !== each) adopt(facePreset(face.preset, each)); },
    })));
    return faceEl('section', { className: 'face-row face-preset-row' }, faceEl('label', {}, faceEl('span', { textContent: t('face.preset') }), select), sexes);
  }

  function toolRow() {
    return faceEl('section', { className: 'face-row face-tools' },
      faceEl('button', { type: 'button', className: 'face-random', icon: 'die', textContent: t('face.randomize'), onclick: () => adopt(randomFace(Math.random, { preset: face.preset, sex: face.sex })) }),
      faceEl('button', { type: 'button', className: 'face-reset-all', icon: 'reload', textContent: t('face.reset'), onclick: () => adopt(facePreset(face.preset, face.sex)) }));
  }

  function similarSection() {
    const grid = faceEl('div', { className: 'face-similar-grid' }, ...thumbCanvases.map((thumb, index) => faceEl('button', {
      type: 'button', className: 'face-thumb', ariaLabel: t('face.similarPick', { n: index + 1 }), onclick: () => { if (variants[index]) adopt(variants[index]); },
    }, thumb)));
    return groupFrame('similar', t('face.similar'), [grid], faceEl('button', { type: 'button', className: 'face-similar-more', icon: 'reload', textContent: t('face.similarMore'), onclick: () => { seed += 1; paintThumbs(); } }));
  }

  /** A folding section: its title, a button on its title row, and its body. Folded or open is remembered while the screen is up. */
  function groupFrame(key, title, body, action = null) {
    const details = faceEl('details', { className: `face-group face-group-${key}`, open: openGroups.has(key) },
      faceEl('summary', {}, faceEl('span', { textContent: title }), action),
      faceEl('div', { className: 'face-group-body' }, ...body));
    details.dataset.group = key;
    details.addEventListener('toggle', () => {
      if (details.open) openGroups.add(key);
      else openGroups.delete(key);
      if (key === 'similar' && details.open) paintThumbs();
    });
    // (A button on the title row works without folding the section.)
    action?.addEventListener('click', (click) => click.preventDefault());
    return details;
  }

  function groupSection({ group, sliders }) {
    const resetButton = faceEl('button', { type: 'button', className: 'face-reset-group', textContent: t('face.resetGroup'), onclick: () => adopt(resetGroup(face, group)) });
    return groupFrame(group, t(`face.group.${group}`), sliders.map(sliderRow), resetButton);
  }

  function sliderRow(slider) {
    const name = pick({ en: slider.label, zh: slider.labelZh });
    const range = faceEl('input', { type: 'range', min: FACE_UI.min, max: FACE_UI.max, step: 1, value: sliderValue(face, slider.id), ariaLabel: name });
    const number = faceEl('input', { type: 'number', min: FACE_UI.min, max: FACE_UI.max, step: 1, value: sliderValue(face, slider.id), inputMode: 'numeric', ariaLabel: t('face.value', { name }) });
    range.addEventListener('input', () => setSlider(slider.id, range.value));
    // (A number half typed is let be; it is made a byte, and shown as one, when the field is left.)
    number.addEventListener('input', () => setSlider(slider.id, number.value, number));
    number.addEventListener('change', () => { number.value = sliderValue(face, slider.id); });
    sliderControls.set(slider.id, [range, number]);
    const reset = faceEl('button', { type: 'button', className: 'face-reset-slider', ariaLabel: t('face.resetSlider', { name }), title: t('face.resetSlider', { name }), onclick: () => adopt(resetSlider(face, slider.id)) }, uiIcon('reload'));
    const row = faceEl('div', { className: 'face-slider' }, faceEl('span', { className: 'face-slider-name', textContent: name }), range, number, reset);
    row.dataset.slider = slider.id;
    return row;
  }

  function fileSection() {
    codeBox = faceEl('textarea', { className: 'face-code', rows: 3, spellcheck: false, placeholder: t('face.codeHolder'), ariaLabel: t('face.codeHolder') });
    note = faceEl('p', { className: 'face-note', role: 'status' });
    const upload = faceEl('input', { type: 'file', accept: '.json,application/json', hidden: true, onchange: async () => {
      const file = upload.files?.[0];
      upload.value = '';
      if (!file) return;
      if (file.size > FACE_UI.maxFileBytes) return say(t('face.error.tooLarge'));
      loadText(await file.text());
    } });
    return groupFrame('file', t('face.file'), [
      faceEl('div', { className: 'face-file-buttons' },
        faceEl('button', { type: 'button', className: 'face-download', textContent: t('face.download'), onclick: download }),
        faceEl('button', { type: 'button', className: 'face-upload', textContent: t('face.upload'), onclick: () => upload.click() }),
        faceEl('button', { type: 'button', className: 'face-copy', textContent: t('face.copy'), onclick: copy }),
        faceEl('button', { type: 'button', className: 'face-paste', textContent: t('face.paste'), onclick: paste }),
        upload),
      codeBox,
      faceEl('div', { className: 'face-file-load' }, note, faceEl('button', { type: 'button', className: 'face-load', textContent: t('face.load'), onclick: () => loadText(codeBox.value) })),
    ]);
  }

  function useRow() {
    if (onUse) return faceEl('footer', { className: 'face-use' }, faceEl('button', { type: 'button', className: 'primary face-use-button', textContent: t('face.useHere'), onclick: () => { keepNow(); const chosen = face; takeDown(); onUse(chosen); } }));
    const check = faceEl('input', { type: 'checkbox', className: 'face-wear', checked: wear, onchange: () => { wear = check.checked; keepNow(); } });
    return faceEl('footer', { className: 'face-use' }, faceEl('label', { className: 'face-wear-row' }, check, faceEl('span', { textContent: t('face.wear') })));
  }

  // ---- What the controls do --------------------------------------------------------------------------------------------

  function setSlider(id, value, typing = null) {
    const next = withSlider(face, id, value);
    if (next === face) return;
    face = next;
    for (const control of sliderControls.get(id) ?? []) if (control !== typing) control.value = sliderValue(face, id);
    stage.setFace(face);
    settle();
  }

  /** A whole new face (a preset, a random one, a variation, a file, a reset): every control set from it. */
  function adopt(next) {
    face = parseFaceObject(next);
    stage.setFace(face);
    const presetSelect = panel.querySelector('.face-preset');
    const presetChanged = presetSelect && presetSelect.value !== face.preset;
    if (presetChanged || panel.querySelector('.face-sex .on')?.dataset.sex !== face.sex) draw();
    else for (const [id, controls] of sliderControls) for (const control of controls) control.value = sliderValue(face, id);
    settle();
  }

  /** Keep the face and draw the grid again once the sliders have stopped moving. */
  function settle() {
    clearTimeout(settleTimer);
    settleTimer = setTimeout(() => {
      keepNow();
      paintThumbs();
    }, FACE_VIEW.settleMs);
  }

  function keepNow() {
    writeFaceStore({ face, wear }, storage);
  }

  /** The nine variations of the face as it is now, drawn by the stage's one renderer (only while the grid is open). */
  function paintThumbs() {
    if (!openGroups.has('similar')) return;
    variants = similarFaces(face, FACE_UI.similarCount, FACE_UI.similarSpread, faceUiRng(seed)).map(parseFaceObject);
    stage.thumbnails(variants, thumbCanvases);
  }

  function say(words) {
    if (!note) return;
    note.textContent = words;
    clearTimeout(noteTimer);
    noteTimer = setTimeout(() => { if (note) note.textContent = ''; }, FACE_VIEW.noteMs);
  }

  function loadText(text) {
    const read = parseFaceText(text);
    if (read.error) return say(t(`face.error.${read.error}`));
    adopt(read.face);
    say(t('face.loaded'));
  }

  function download() {
    const url = URL.createObjectURL(new Blob([faceText(face)], { type: 'application/json' }));
    const link = faceEl('a', { href: url, download: FACE_VIEW.fileName });
    document.body.append(link);
    link.click();
    link.remove();
    setTimeout(() => URL.revokeObjectURL(url), 0);
  }

  async function copy() {
    const text = faceText(face);
    codeBox.value = text;
    try {
      await navigator.clipboard.writeText(text);
      say(t('face.copied'));
    } catch {
      // (No clipboard here: the text is in the box, selected, for the system's own copy.)
      codeBox.select();
    }
  }

  async function paste() {
    try {
      const text = await navigator.clipboard.readText();
      codeBox.value = text;
      loadText(text);
    } catch {
      // (The clipboard would not be read: the box takes a paste by hand, then Load.)
      codeBox.focus();
    }
  }

  // (The sheet's height follows what is open in it: the head re-centred above it as it grows or folds.)
  const panelWatch = globalThis.ResizeObserver ? new ResizeObserver(() => stage.resize()) : null;
  panelWatch?.observe(panel);

  const offLang = onLangChange(() => {
    if (root.isConnected && panel.isConnected) draw();
    else offLang();
  });

  /** Take the screen down: the stage's renderer and its context given back, the face kept. */
  function takeDown() {
    clearTimeout(settleTimer);
    clearTimeout(noteTimer);
    offLang();
    panelWatch?.disconnect();
    stage.dispose();
    root.replaceChildren();
  }

  function close() {
    keepNow();
    takeDown();
    onBack?.();
  }

  draw();
  return {
    stage,
    face: () => face,
    setFace: adopt,
    close,
  };
}

/** A face as the screen holds it: through the schema (any slider out of range brought into it, anything missing filled). */
const parseFaceObject = (face) => normalizeFace(face);
