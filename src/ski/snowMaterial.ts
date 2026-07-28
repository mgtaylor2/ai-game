import * as THREE from 'three';
import { CONFIG } from './config';

/**
 * The one shared terrain material, vertex-colored with the analytic surface normal already smooth.
 * `snowShader.ts` extends this via `onBeforeCompile` to add grooves/corduroy/glitter/wrap-fill.
 */
export const snowMaterial = new THREE.MeshStandardMaterial({
  vertexColors: true,
  roughness: CONFIG.snow.roughness,
  metalness: 0,
});
