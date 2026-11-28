// A STAND-IN for src/facecustom/skin.js: a plain standard material in the face's skin tone. Deleted when the real core lands.

/* global THREE */
// The stub's skin from pale to dark as `surface.skinTone` runs 0 to 255.
const STUB_PALE = [0.93, 0.78, 0.68];
const STUB_DARK = [0.32, 0.2, 0.13];

export function skinMaterialFor(face) {
  const material = new THREE.MeshStandardMaterial({ roughness: 0.55, metalness: 0 });
  updateSkin(material, face);
  return material;
}

export function updateSkin(material, face) {
  const tone = (face.surface?.skinTone ?? 100) / 255;
  material.color.setRGB(...STUB_PALE.map((pale, channel) => pale + (STUB_DARK[channel] - pale) * tone));
  material.roughness = 0.25 + 0.6 * ((face.surface?.roughness ?? 128) / 255);
}
