// The noise picture (env/noise.js envNoiseValues) as a three.js texture for the shaders: split from env/noise.js, whose
// numbers the simulation's ground reads (env/lie.js), so that module holds no drawing (port groundwork, the user's call,
// 2026-11-26).

import { ENV_NOISE_SIZE, envNoiseValues } from './noise.js';

let envNoiseTextureMade = null;

/** The picture as a texture (made once): repeating, mip-mapped. */
export function envNoiseTexture() {
  if (envNoiseTextureMade) return envNoiseTextureMade;
  const values = envNoiseValues();
  const bytes = new Uint8Array(values.length);
  for (let index = 0; index < values.length; index += 1) bytes[index] = Math.round(Math.min(1, Math.max(0, values[index])) * 255);
  const texture = new THREE.DataTexture(bytes, ENV_NOISE_SIZE, ENV_NOISE_SIZE, THREE.RGBAFormat);
  texture.wrapS = texture.wrapT = THREE.RepeatWrapping;
  texture.magFilter = THREE.LinearFilter;
  texture.minFilter = THREE.LinearMipmapLinearFilter;
  texture.generateMipmaps = true;
  texture.needsUpdate = true;
  envNoiseTextureMade = texture;
  return texture;
}
