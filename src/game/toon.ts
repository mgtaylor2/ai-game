import * as THREE from 'three';

let cachedGradientMap: THREE.DataTexture | null = null;

/** A shared 4-step gradient so all toon materials band identically. */
function getGradientMap(): THREE.DataTexture {
  if (cachedGradientMap) return cachedGradientMap;
  const steps = 4;
  const data = new Uint8Array(steps);
  for (let i = 0; i < steps; i++) data[i] = Math.round((i / (steps - 1)) * 255);
  const texture = new THREE.DataTexture(data, steps, 1, THREE.RedFormat);
  texture.minFilter = THREE.NearestFilter;
  texture.magFilter = THREE.NearestFilter;
  texture.generateMipmaps = false;
  texture.needsUpdate = true;
  cachedGradientMap = texture;
  return texture;
}

export function createToonMaterial(color: number, map?: THREE.Texture): THREE.MeshToonMaterial {
  const params: THREE.MeshToonMaterialParameters = { color, gradientMap: getGradientMap() };
  if (map) params.map = map;
  return new THREE.MeshToonMaterial(params);
}

/**
 * Adds a black inverted-hull outline as a child of `mesh`, giving it a cartoon
 * silhouette. The child inherits the mesh's local transform and just renders
 * the backfaces of a slightly larger copy of the same geometry.
 */
export function addOutline(mesh: THREE.Mesh, thickness = 0.05, color = 0x142033): void {
  const outline = new THREE.Mesh(mesh.geometry, new THREE.MeshBasicMaterial({ color, side: THREE.BackSide }));
  outline.scale.setScalar(1 + thickness);
  mesh.add(outline);
}
