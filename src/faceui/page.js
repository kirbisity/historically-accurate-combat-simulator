// The face customizer on a page of its own (facecustom.html): the same screen the game opens from its menus, the whole window,
// in the language the game keeps (src/i18n.js), the face kept where the game reads it, so a face made here is the fighter's
// next time the game is opened from the same place. The page's words in place (translatePage), and its icons (dressIcons).

import { translatePage } from '../i18n.js';
import { dressIcons } from '../uiicons.js';
import { faceCustomScreen } from './view.js';

const faceRoot = document.getElementById('face-screen');
faceRoot.hidden = false;
translatePage();
dressIcons();
// (Exposed for the page's own checks in a browser: the screen's face, setFace, and the stage's view.)
globalThis.faceCustom = faceCustomScreen(faceRoot, {});
