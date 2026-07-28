import * as THREE from 'three';
import { CONFIG } from './config';
import { Mountain } from './terrain';
import { subRng } from './rng';
import { snowMaterial } from './snowMaterial';
import { InstancedPool, decorMaterial, createPineGeometry, createRockGeometry, createLogGeometry, createBushGeometry } from './decor';

export interface Obstacle {
  x: number;
  z: number;
  radius: number;
}

interface DecorAllocation {
  pool: InstancedPool;
  index: number;
}

interface ActiveChunk {
  index: number;
  meshSlot: number;
  decor: DecorAllocation[];
  obstacles: Obstacle[];
}

const { rows, denseSpacing, sparseSpacing, denseHalfWidth, outerHalfWidth, length: CHUNK_LENGTH } = CONFIG.chunk;

/** Fixed lateral column layout, dense near the piste and sparse toward the valley walls. Identical for every chunk, so it's built once. */
function buildLateralOffsets(): number[] {
  const offsets: number[] = [];
  for (let x = -outerHalfWidth; x < -denseHalfWidth - 1e-6; x += sparseSpacing) offsets.push(x);
  for (let x = -denseHalfWidth; x <= denseHalfWidth + 1e-6; x += denseSpacing) offsets.push(x);
  for (let x = denseHalfWidth + sparseSpacing; x <= outerHalfWidth + 1e-6; x += sparseSpacing) offsets.push(x);
  return offsets;
}

const LATERAL_OFFSETS = buildLateralOffsets();
const COLS = LATERAL_OFFSETS.length;
const VERTS_PER_CHUNK = rows * COLS;

/** Shared triangulation: identical grid topology for every chunk, so the index buffer is built exactly once. */
function buildSharedIndex(): THREE.BufferAttribute {
  const indices = new Uint32Array((rows - 1) * (COLS - 1) * 6);
  let p = 0;
  for (let r = 0; r < rows - 1; r++) {
    for (let c = 0; c < COLS - 1; c++) {
      const a = r * COLS + c;
      const b = a + 1;
      const cIdx = a + COLS;
      const d = cIdx + 1;
      indices[p++] = a; indices[p++] = cIdx; indices[p++] = b;
      indices[p++] = b; indices[p++] = cIdx; indices[p++] = d;
    }
  }
  return new THREE.BufferAttribute(indices, 1);
}

const SHARED_INDEX = buildSharedIndex();
const SNOW_BASE = new THREE.Color(CONFIG.visual.snowColor);
const SNOW_SHADOW = new THREE.Color(CONFIG.visual.snowShadowTint);

const PINE_VARIANTS = 3;
const ROCK_VARIANTS = 2;
const POOL_SIZE = CONFIG.chunk.ahead + CONFIG.chunk.behind + 3;

interface DecorCandidate {
  x: number;
  z: number;
  kind: 'pine' | 'rock' | 'bush' | 'log' | 'obstacleTree' | 'obstacleRock';
}

/** Streams the mountain as pooled 100m chunks: builds terrain geometry + decor instances ahead of the player, frees them once passed. */
export class ChunkManager {
  readonly group = new THREE.Group();
  private readonly mountain: Mountain;
  private readonly meshes: THREE.Mesh[] = [];
  private readonly meshFree: number[] = [];
  private readonly active = new Map<number, ActiveChunk>();
  private initialFillDone = false;

  private readonly pinePools: InstancedPool[];
  private readonly rockPools: InstancedPool[];
  private readonly logPool: InstancedPool;
  private readonly bushPool: InstancedPool;

  constructor(mountain: Mountain) {
    this.mountain = mountain;

    for (let i = 0; i < POOL_SIZE; i++) {
      const geometry = new THREE.BufferGeometry();
      geometry.setAttribute('position', new THREE.BufferAttribute(new Float32Array(VERTS_PER_CHUNK * 3), 3));
      geometry.setAttribute('normal', new THREE.BufferAttribute(new Float32Array(VERTS_PER_CHUNK * 3), 3));
      geometry.setAttribute('color', new THREE.BufferAttribute(new Float32Array(VERTS_PER_CHUNK * 3), 3));
      geometry.setAttribute('lateralDistance', new THREE.BufferAttribute(new Float32Array(VERTS_PER_CHUNK), 1));
      geometry.setIndex(SHARED_INDEX);
      const mesh = new THREE.Mesh(geometry, snowMaterial);
      mesh.receiveShadow = true;
      mesh.visible = false;
      mesh.frustumCulled = false;
      this.meshes.push(mesh);
      this.meshFree.push(i);
      this.group.add(mesh);
    }

    this.pinePools = Array.from({ length: PINE_VARIANTS }, (_, i) => new InstancedPool(createPineGeometry(i), decorMaterial, 500));
    this.rockPools = Array.from({ length: ROCK_VARIANTS }, (_, i) => new InstancedPool(createRockGeometry(subRng(CONFIG.seed, 999, i)), decorMaterial, 200));
    this.logPool = new InstancedPool(createLogGeometry(), decorMaterial, 60);
    this.bushPool = new InstancedPool(createBushGeometry(), decorMaterial, 400, false);

    for (const pool of [...this.pinePools, ...this.rockPools, this.logPool, this.bushPool]) this.group.add(pool.mesh);
  }

  /** All obstacles in the currently-streamed window; small enough (a handful of chunks) to flatten every call. */
  getObstaclesNear(): Obstacle[] {
    const result: Obstacle[] = [];
    for (const chunk of this.active.values()) result.push(...chunk.obstacles);
    return result;
  }

  /** Streams chunks in/out around the player's current forward distance, and updates shadow-casting LOD by camera distance. */
  update(playerZ: number, cameraPosition: THREE.Vector3): void {
    const currentIndex = Math.max(0, Math.floor(playerZ / CHUNK_LENGTH));
    const minIndex = Math.max(0, currentIndex - CONFIG.chunk.behind);
    const maxIndex = currentIndex + CONFIG.chunk.ahead;

    for (const index of Array.from(this.active.keys())) {
      if (index < minIndex || index > maxIndex) this.unload(index);
    }

    const missing: number[] = [];
    for (let i = minIndex; i <= maxIndex; i++) if (!this.active.has(i)) missing.push(i);

    if (!this.initialFillDone) {
      for (const index of missing) this.build(index);
      this.initialFillDone = true;
    } else if (missing.length > 0) {
      this.build(missing[0]);
    }

    for (const chunk of this.active.values()) {
      const mesh = this.meshes[chunk.meshSlot];
      const chunkCenterZ = chunk.index * CHUNK_LENGTH + CHUNK_LENGTH / 2;
      const dist = Math.abs(cameraPosition.z - chunkCenterZ);
      mesh.castShadow = dist < CONFIG.chunk.lodFullDistance;
    }
  }

  private unload(index: number): void {
    const chunk = this.active.get(index);
    if (!chunk) return;
    this.meshes[chunk.meshSlot].visible = false;
    this.meshFree.push(chunk.meshSlot);
    for (const alloc of chunk.decor) alloc.pool.free(alloc.index);
    this.active.delete(index);
  }

  private build(index: number): void {
    const slot = this.meshFree.pop();
    if (slot === undefined) return;

    const chunkStartZ = index * CHUNK_LENGTH;
    const candidates = this.generateDecorCandidates(index, chunkStartZ);

    const decor: DecorAllocation[] = [];
    const obstacles: Obstacle[] = [];
    for (const candidate of candidates) this.placeDecor(candidate, decor, obstacles);

    this.buildTerrainMesh(slot, chunkStartZ, candidates);

    this.active.set(index, { index, meshSlot: slot, decor, obstacles });
  }

  private generateDecorCandidates(chunkIndex: number, chunkStartZ: number): DecorCandidate[] {
    const d = CONFIG.decor;
    const candidates: DecorCandidate[] = [];
    const forestRandom = subRng(CONFIG.seed, chunkIndex, 0x1000);
    const zBands = 8;
    const xBands = 6;

    for (let zi = 0; zi < zBands; zi++) {
      const z = chunkStartZ + (zi + forestRandom() * 0.9) * (CHUNK_LENGTH / zBands);
      for (const side of [-1, 1] as const) {
        for (let xi = 0; xi < xBands; xi++) {
          const t = (xi + forestRandom()) / xBands;
          const lateral = side * THREE.MathUtils.lerp(CONFIG.terrain.corridorHalfWidth, outerHalfWidth, t);
          const density = THREE.MathUtils.lerp(d.treeNearDensity, d.treeFarDensity, t);
          const roll = forestRandom();
          const x = this.mountain.centerXAt(z) + lateral;
          if (roll < density) candidates.push({ x, z, kind: 'pine' });
          else if (roll < density + (1 - density) * d.rockOutcropChance * 0.3) candidates.push({ x, z, kind: 'rock' });
          else if (roll < density + (1 - density) * d.bushChance * 0.3) candidates.push({ x, z, kind: 'bush' });
        }
      }
    }

    if (forestRandom() < d.heroTreeChance) {
      const z = chunkStartZ + forestRandom() * CHUNK_LENGTH;
      const side = forestRandom() < 0.5 ? -1 : 1;
      const lateral = side * (CONFIG.terrain.pisteHalfWidth + 1 + forestRandom() * 2);
      candidates.push({ x: this.mountain.centerXAt(z) + lateral, z, kind: 'pine' });
    }

    if (forestRandom() < d.logChance) {
      const z = chunkStartZ + forestRandom() * CHUNK_LENGTH;
      const lateral = (forestRandom() * 2 - 1) * CONFIG.terrain.pisteHalfWidth * 0.6;
      candidates.push({ x: this.mountain.centerXAt(z) + lateral, z, kind: 'log' });
    }

    if (chunkIndex >= d.obstacleStartChunk) {
      const progress = Math.min(1, (chunkIndex - d.obstacleStartChunk) / 25);
      const count = Math.round(forestRandom() * d.obstacleMaxPerChunk * progress);
      for (let i = 0; i < count; i++) {
        const z = chunkStartZ + forestRandom() * CHUNK_LENGTH;
        const lateral = (forestRandom() * 2 - 1) * CONFIG.terrain.pisteHalfWidth * 0.8;
        const x = this.mountain.centerXAt(z) + lateral;
        candidates.push({ x, z, kind: forestRandom() < d.obstacleRockChance ? 'obstacleRock' : 'obstacleTree' });
      }
    }

    return candidates;
  }

  private placeDecor(candidate: DecorCandidate, decor: DecorAllocation[], obstacles: Obstacle[]): void {
    const d = CONFIG.decor;
    const rand = subRng(CONFIG.seed, Math.round(candidate.x * 131 + candidate.z * 977), 0x2001);
    const { height, normal } = this.mountain.getHeightAndNormal(candidate.x, candidate.z);
    const matrix = new THREE.Matrix4();
    const quat = new THREE.Quaternion();
    const position = new THREE.Vector3(candidate.x, height, candidate.z);

    switch (candidate.kind) {
      case 'pine':
      case 'obstacleTree': {
        const variant = Math.floor(rand() * PINE_VARIANTS);
        const scale = d.treeScaleMin + rand() * (d.treeScaleMax - d.treeScaleMin);
        const tilt = (rand() * 2 - 1) * d.treeMaxTilt;
        quat.setFromUnitVectors(new THREE.Vector3(0, 1, 0), normal).multiply(new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 0, 1), tilt));
        quat.multiply(new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), rand() * Math.PI * 2));
        matrix.compose(position, quat, new THREE.Vector3(scale, scale, scale));
        const pool = this.pinePools[variant];
        const idx = pool.alloc();
        if (idx !== null) {
          pool.set(idx, matrix);
          decor.push({ pool, index: idx });
        }
        if (candidate.kind === 'obstacleTree') obstacles.push({ x: candidate.x, z: candidate.z, radius: 0.55 * scale });
        break;
      }
      case 'rock':
      case 'obstacleRock': {
        const variant = Math.floor(rand() * ROCK_VARIANTS);
        const scale = 0.5 + rand() * 0.9;
        quat.setFromAxisAngle(new THREE.Vector3(0, 1, 0), rand() * Math.PI * 2);
        matrix.compose(position, quat, new THREE.Vector3(scale, scale * 0.85, scale));
        const pool = this.rockPools[variant];
        const idx = pool.alloc();
        if (idx !== null) {
          pool.set(idx, matrix);
          decor.push({ pool, index: idx });
        }
        if (candidate.kind === 'obstacleRock') obstacles.push({ x: candidate.x, z: candidate.z, radius: 0.6 * scale });
        break;
      }
      case 'bush': {
        const scale = 0.6 + rand() * 0.7;
        quat.setFromAxisAngle(new THREE.Vector3(0, 1, 0), rand() * Math.PI * 2);
        matrix.compose(position, quat, new THREE.Vector3(scale, scale, scale));
        const idx = this.bushPool.alloc();
        if (idx !== null) {
          this.bushPool.set(idx, matrix);
          decor.push({ pool: this.bushPool, index: idx });
        }
        break;
      }
      case 'log': {
        quat.setFromUnitVectors(new THREE.Vector3(0, 1, 0), normal).multiply(new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), Math.PI / 2 + (rand() * 0.6 - 0.3)));
        matrix.compose(position, quat, new THREE.Vector3(1, 1, 1));
        const idx = this.logPool.alloc();
        if (idx !== null) {
          this.logPool.set(idx, matrix);
          decor.push({ pool: this.logPool, index: idx });
        }
        obstacles.push({ x: candidate.x, z: candidate.z, radius: 1.1 });
        break;
      }
    }
  }

  private buildTerrainMesh(slot: number, chunkStartZ: number, decorCandidates: DecorCandidate[]): void {
    const mesh = this.meshes[slot];
    const geometry = mesh.geometry;
    const position = geometry.attributes.position as THREE.BufferAttribute;
    const normalAttr = geometry.attributes.normal as THREE.BufferAttribute;
    const colorAttr = geometry.attributes.color as THREE.BufferAttribute;
    const lateralAttr = geometry.attributes.lateralDistance as THREE.BufferAttribute;

    const aoSources = decorCandidates.filter((c) => c.kind !== 'bush');

    for (let r = 0; r < rows; r++) {
      const z = chunkStartZ + (r / (rows - 1)) * CHUNK_LENGTH;
      const centerX = this.mountain.centerXAt(z);
      for (let c = 0; c < COLS; c++) {
        const lateral = LATERAL_OFFSETS[c];
        const x = centerX + lateral;
        const { height, normal } = this.mountain.getHeightAndNormal(x, z);
        const vi = r * COLS + c;

        position.setXYZ(vi, x, height, z);
        normalAttr.setXYZ(vi, normal.x, normal.y, normal.z);
        lateralAttr.setX(vi, lateral);

        let ao = 0;
        for (const src of aoSources) {
          const dx = x - src.x;
          const dz = z - src.z;
          const d2 = dx * dx + dz * dz;
          if (d2 < CONFIG.chunk.aoRadius * CONFIG.chunk.aoRadius) {
            ao += Math.exp(-d2 / (2 * (CONFIG.chunk.aoRadius * 0.5) ** 2));
          }
        }
        ao = Math.min(1, ao) * CONFIG.chunk.aoStrength;
        const r_ = THREE.MathUtils.lerp(SNOW_BASE.r, SNOW_SHADOW.r, ao);
        const g_ = THREE.MathUtils.lerp(SNOW_BASE.g, SNOW_SHADOW.g, ao);
        const b_ = THREE.MathUtils.lerp(SNOW_BASE.b, SNOW_SHADOW.b, ao);
        colorAttr.setXYZ(vi, r_, g_, b_);
      }
    }

    position.needsUpdate = true;
    normalAttr.needsUpdate = true;
    colorAttr.needsUpdate = true;
    lateralAttr.needsUpdate = true;
    geometry.computeBoundingSphere();
    mesh.visible = true;

    for (const pool of [...this.pinePools, ...this.rockPools, this.logPool, this.bushPool]) pool.flush();
  }
}
