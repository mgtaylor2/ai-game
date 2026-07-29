import * as THREE from 'three';

/**
 * Flat-shaded standard materials, in the same spirit as Alpine Rush's decor: chunky low-poly forms
 * whose facets you can read, lit by the scene rather than by a baked texture.
 *
 * This replaces the old toon-material-plus-inverted-hull-outline approach for vehicles and drivers.
 * Inverted hulls cost a second draw of every mesh and, on the concave shapes a real kart needs
 * (seat bucket, wheel wells, fork legs), the offset shell pokes through in places it shouldn't.
 */

export interface PaintSet {
  /** Main bodywork colour. */
  body: number;
  /** Secondary trim: nose, spoiler, rims, fairing flashes. */
  accent: number;
}

const materialCache = new Map<string, THREE.MeshStandardMaterial>();

/** Shared, cached material. Never mutate the result — call `tintable()` when a per-instance colour is needed. */
export function flat(color: number, roughness = 0.55, metalness = 0): THREE.MeshStandardMaterial {
  const key = `${color}|${roughness}|${metalness}`;
  let material = materialCache.get(key);
  if (!material) {
    material = new THREE.MeshStandardMaterial({ color, roughness, metalness, flatShading: true });
    materialCache.set(key, material);
  }
  return material;
}

/** A fresh material instance the caller owns and may recolour freely (one per vehicle, not per mesh). */
export function tintable(color: number, roughness = 0.5, metalness = 0.05): THREE.MeshStandardMaterial {
  return new THREE.MeshStandardMaterial({ color, roughness, metalness, flatShading: true });
}

/** Shared fixed materials used across vehicles and drivers. */
export const PALETTE = {
  tyre: () => flat(0x1b1d22, 0.9),
  darkTrim: () => flat(0x24282f, 0.7),
  chrome: () => flat(0xc9d2dc, 0.25, 0.85),
  glass: () => flat(0x2b3d55, 0.15, 0.4),
  skin: () => flat(0xf0c39a, 0.85),
  exhaust: () => flat(0x8d949c, 0.35, 0.7),
};

/**
 * Marks a subtree as a shadow caster/receiver. Called once at build time -- doing it per frame or
 * per material swap is wasted work since the flags never change after construction.
 */
export function enableShadows(root: THREE.Object3D, receive = true): void {
  root.traverse((child) => {
    if (child instanceof THREE.Mesh) {
      child.castShadow = true;
      child.receiveShadow = receive;
    }
  });
}

/** Convenience: mesh + transform in one call, since these models are almost entirely placed primitives. */
export function part(
  geometry: THREE.BufferGeometry,
  material: THREE.Material,
  position: [number, number, number],
  rotation?: [number, number, number],
  scale?: [number, number, number],
): THREE.Mesh {
  const mesh = new THREE.Mesh(geometry, material);
  mesh.position.set(position[0], position[1], position[2]);
  if (rotation) mesh.rotation.set(rotation[0], rotation[1], rotation[2]);
  if (scale) mesh.scale.set(scale[0], scale[1], scale[2]);
  return mesh;
}

/**
 * A rounded slab: the workhorse shape for bodywork panels. A plain box reads as programmer-art, but a
 * lightly bevelled box catches the flat-shaded light differently on each face and looks deliberate.
 */
export function slab(width: number, height: number, depth: number, bevel = 0.12): THREE.BufferGeometry {
  const geometry = new THREE.BoxGeometry(width, height, depth, 1, 1, 1);
  const position = geometry.attributes.position as THREE.BufferAttribute;
  const halfW = width / 2;
  const halfH = height / 2;
  const halfD = depth / 2;
  const inset = Math.min(bevel, Math.min(halfW, halfH, halfD) * 0.6);
  // Pull every corner vertex toward the centre a little, turning hard 90-degree corners into a
  // chamfer without paying for real bevel geometry.
  for (let i = 0; i < position.count; i++) {
    const x = position.getX(i);
    const y = position.getY(i);
    const z = position.getZ(i);
    position.setXYZ(
      i,
      x - Math.sign(x) * inset * (Math.abs(y) / halfH) * 0.5,
      y - Math.sign(y) * inset,
      z - Math.sign(z) * inset * (Math.abs(y) / halfH) * 0.5,
    );
  }
  position.needsUpdate = true;
  geometry.computeVertexNormals();
  return geometry;
}
