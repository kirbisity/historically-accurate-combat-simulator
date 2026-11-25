// The picture lost: the browser can take a page's WebGL context away (the graphics card reset, the GPU process killed for its
// memory, a phone reclaiming it in the background). Before, the canvas went black and stayed so, the game running on behind
// it with nothing said. Now the loss is shown in words with a reload, and a context given back is reloaded into: three
// would draw again, but the page has let go of what it sent the card (meshpack.js: a town's normals and colours, kept only
// there), so a restored context is a broken picture. The fight is not kept: a reload starts from the menu.

import { getLang } from './i18n.js';

export const CONTEXT_LOSS = {
  words: {
    en: { title: 'The picture was lost', body: 'The browser took the graphics away from the game (the graphics card was reset, or the device needed the memory).', reload: 'Reload' },
    zh: { title: '画面丢失', body: '浏览器收回了游戏的图形资源（显卡被重置，或设备需要回收内存）。', reload: '重新载入' },
  },
};

/** Watch `canvas` for a lost context: `onLost()` is told (main.js pauses), a notice with a reload is shown. Returns the notice. */
export function watchContextLoss(canvas, { onLost = () => {}, reload = () => location.reload() } = {}) {
  let notice = null;
  canvas.addEventListener('webglcontextlost', (event) => {
    // (Asked to be given back: the reload below is offered either way.)
    event.preventDefault();
    onLost();
    notice ??= showNotice(reload);
  });
  // Given back: what was sent to the card is not all on the page any more, so start afresh.
  canvas.addEventListener('webglcontextrestored', () => reload());
  return () => notice;
}

function showNotice(reload) {
  const words = CONTEXT_LOSS.words[getLang()] ?? CONTEXT_LOSS.words.en;
  const notice = document.createElement('div');
  notice.className = 'context-lost';
  notice.setAttribute('role', 'alert');
  notice.style.cssText = 'position:fixed;inset:0;z-index:10000;display:flex;flex-direction:column;align-items:center;justify-content:center;gap:12px;background:rgba(8,9,12,0.92);color:#eee;font:16px/1.4 system-ui,sans-serif;text-align:center;padding:24px';
  const title = document.createElement('strong');
  title.textContent = words.title;
  title.style.fontSize = '20px';
  const body = document.createElement('p');
  body.textContent = words.body;
  body.style.cssText = 'max-width:32em;margin:0';
  const button = document.createElement('button');
  button.type = 'button';
  button.textContent = words.reload;
  button.style.cssText = 'font:inherit;padding:8px 20px;cursor:pointer';
  button.addEventListener('click', () => reload());
  notice.append(title, body, button);
  document.body.append(notice);
  return notice;
}
