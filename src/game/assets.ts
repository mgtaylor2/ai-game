import * as THREE from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';

export interface LoadedModel {
  scene: THREE.Group;
  animations: THREE.AnimationClip[];
}

/**
 * CC0-licensed models from Kenney's official starter kits (see public/models/CREDITS.md).
 * Trucks stand in for "kart" bodies; only four pre-coloured variants exist (the meshes
 * use a single baked colormap texture, not tintable per-instance), so vehicle paint
 * picks the nearest of these rather than any arbitrary hex colour.
 */
const MODEL_PATHS = {
  motorcycle: '/models/racing/vehicle-motorcycle.glb',
  truckRed: '/models/racing/vehicle-truck-red.glb',
  truckGreen: '/models/racing/vehicle-truck-green.glb',
  truckPurple: '/models/racing/vehicle-truck-purple.glb',
  truckYellow: '/models/racing/vehicle-truck-yellow.glb',
  character: '/models/platformer/character.glb',
} as const;

export type ModelKey = keyof typeof MODEL_PATHS;

const TRUCK_SWATCHES: Array<{ key: ModelKey; color: number }> = [
  { key: 'truckRed', color: 0xd7263d },
  { key: 'truckGreen', color: 0x4caf50 },
  { key: 'truckPurple', color: 0x8e44ad },
  { key: 'truckYellow', color: 0xf4d35e },
];

/** Picks whichever pre-coloured truck model is visually closest to `color`. */
export function nearestTruckKey(color: number): ModelKey {
  const target = new THREE.Color(color);
  let best = TRUCK_SWATCHES[0];
  let bestDist = Infinity;
  for (const swatch of TRUCK_SWATCHES) {
    const c = new THREE.Color(swatch.color);
    const dist = (c.r - target.r) ** 2 + (c.g - target.g) ** 2 + (c.b - target.b) ** 2;
    if (dist < bestDist) {
      bestDist = dist;
      best = swatch;
    }
  }
  return best.key;
}

const loader = new GLTFLoader();
const cache = new Map<ModelKey, Promise<LoadedModel | null>>();
/** Synchronously readable once preloadAllModels() resolves: null means load failed. */
const resolved = new Map<ModelKey, LoadedModel | null>();

function loadOne(key: ModelKey): Promise<LoadedModel | null> {
  return new Promise((resolve) => {
    loader.load(
      MODEL_PATHS[key],
      (gltf) => {
        const model = { scene: gltf.scene, animations: gltf.animations };
        resolved.set(key, model);
        resolve(model);
      },
      undefined,
      (error) => {
        console.warn(`Failed to load model "${key}", falling back to procedural mesh.`, error);
        resolved.set(key, null);
        resolve(null);
      },
    );
  });
}

/** Loads (and caches) a model; resolves null on failure so callers can fall back gracefully. */
export function loadModel(key: ModelKey): Promise<LoadedModel | null> {
  if (!cache.has(key)) cache.set(key, loadOne(key));
  return cache.get(key) as Promise<LoadedModel | null>;
}

/** Warms the cache for every known model; never rejects, even if every load fails. */
export async function preloadAllModels(): Promise<void> {
  await Promise.all((Object.keys(MODEL_PATHS) as ModelKey[]).map(loadModel));
}

/** Synchronous lookup for use after preloadAllModels() has resolved; null if that model failed to load. */
export function getResolvedModel(key: ModelKey): LoadedModel | null {
  return resolved.get(key) ?? null;
}

/** Deep-clones a loaded model's scene graph so each kart can own an independent instance. */
export function cloneModel(model: LoadedModel): THREE.Group {
  return model.scene.clone(true);
}
