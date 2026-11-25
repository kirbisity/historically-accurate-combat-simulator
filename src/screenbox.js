// The page's boxes on the screen, read once a frame. Asking an element where it is (getBoundingClientRect) after
// the page has changed a style makes the browser lay the whole page out again there and then; the fight's marks,
// its ring, its tags and its toast each ask for the canvas's box between their own style changes, so a frame laid
// the page out a dozen times over for a box that had not moved (2 ms of a duel's frame on an M1 Pro). A box read
// here is kept until the next frame begins (main.js frame calls nextScreenFrame): within a frame nothing that
// moves the canvas happens, and a resize is seen the frame after it.

let screenFrame = 0;
const screenBoxes = new WeakMap();

/** A new frame: the boxes kept are read again when next asked for. */
export function nextScreenFrame() {
  screenFrame += 1;
}

/** `element`'s box on the screen (a DOMRect), read at most once a frame. */
export function screenBox(element) {
  const kept = screenBoxes.get(element);
  if (kept && kept.frame === screenFrame) return kept.box;
  const box = element.getBoundingClientRect();
  screenBoxes.set(element, { frame: screenFrame, box });
  return box;
}
