import * as THREE from 'three';
import { CONFIG } from './config';
import { Mountain } from './terrain';
import { subRng } from './rng';
import { InstancedPool } from './decor';

interface Gate {
  z: number;
  x: number;
  passed: boolean;
}

export interface GateEvent {
  type: 'pass' | 'miss';
}

const CHUNK_LENGTH = CONFIG.chunk.length;
const poleGeometry = new THREE.CylinderGeometry(0.09, 0.09, 2.2, 6);
poleGeometry.translate(0, 1.1, 0);
const redMaterial = new THREE.MeshStandardMaterial({ color: 0xd6392b, flatShading: true });
const blueMaterial = new THREE.MeshStandardMaterial({ color: 0x2b6fd6, flatShading: true });

/** Streams slalom gate trains on kicker-free chunks: pass near the center to score and keep the combo alive, miss it and the combo resets. */
export class GateManager {
  readonly group = new THREE.Group();
  private readonly mountain: Mountain;
  private readonly redPool = new InstancedPool(poleGeometry, redMaterial, 60, false);
  private readonly bluePool = new InstancedPool(poleGeometry, blueMaterial, 60, false);
  private readonly active = new Map<number, Gate[]>();
  private readonly poleAllocations = new Map<number, Array<{ pool: InstancedPool; index: number }>>();
  private prevZ = 0;
  private prevX = 0;

  constructor(mountain: Mountain) {
    this.mountain = mountain;
    this.group.add(this.redPool.mesh, this.bluePool.mesh);
  }

  /**
   * Rewinds crossing detection to the given start point and drops every streamed chunk so gates rebuild
   * un-passed. Without the rebuild, a replay's first few hundred metres of gates stay flagged `passed`.
   */
  reset(x: number, z: number): void {
    this.prevX = x;
    this.prevZ = z;
    for (const index of Array.from(this.active.keys())) this.unload(index);
  }

  update(riderX: number, riderZ: number): GateEvent[] {
    const currentIndex = Math.max(0, Math.floor(riderZ / CHUNK_LENGTH));
    const minIndex = Math.max(0, currentIndex - CONFIG.chunk.behind);
    const maxIndex = currentIndex + CONFIG.chunk.ahead;

    for (const index of Array.from(this.active.keys())) {
      if (index < minIndex || index > maxIndex) this.unload(index);
    }
    for (let i = minIndex; i <= maxIndex; i++) {
      if (!this.active.has(i)) this.build(i);
    }

    const events: GateEvent[] = [];
    for (const list of this.active.values()) {
      for (const gate of list) {
        if (gate.passed) continue;
        if (this.prevZ < gate.z && riderZ >= gate.z) {
          gate.passed = true;
          const t = (gate.z - this.prevZ) / Math.max(0.0001, riderZ - this.prevZ);
          const xAtGate = THREE.MathUtils.lerp(this.prevX, riderX, t);
          const lateralDist = Math.abs(xAtGate - gate.x);
          if (lateralDist < CONFIG.gates.passRadius) events.push({ type: 'pass' });
          else if (lateralDist < CONFIG.gates.missRadius) events.push({ type: 'miss' });
        }
      }
    }
    this.prevX = riderX;
    this.prevZ = riderZ;
    return events;
  }

  private unload(index: number): void {
    this.active.delete(index);
    const allocations = this.poleAllocations.get(index);
    if (allocations) for (const a of allocations) a.pool.free(a.index);
    this.poleAllocations.delete(index);
    this.redPool.flush();
    this.bluePool.flush();
  }

  private build(chunkIndex: number): void {
    const rand = subRng(CONFIG.seed, chunkIndex, 0x4001);
    const list: Gate[] = [];
    const allocations: Array<{ pool: InstancedPool; index: number }> = [];
    const kickers = this.mountain.getChunkKickers(chunkIndex);

    if (kickers.length === 0 && rand() < CONFIG.gates.chance) {
      const chunkStartZ = chunkIndex * CHUNK_LENGTH;
      const startZ = chunkStartZ + CHUNK_LENGTH * 0.15;
      for (let i = 0; i < CONFIG.gates.count; i++) {
        const z = startZ + i * CONFIG.gates.spacing;
        const side = i % 2 === 0 ? -1 : 1;
        const centerX = this.mountain.centerXAt(z) + side * CONFIG.gates.lateralOffset;
        list.push({ z, x: centerX, passed: false });
        this.placePoles(z, centerX, allocations);
      }
    }

    this.active.set(chunkIndex, list);
    this.poleAllocations.set(chunkIndex, allocations);
    this.redPool.flush();
    this.bluePool.flush();
  }

  private placePoles(z: number, centerX: number, allocations: Array<{ pool: InstancedPool; index: number }>): void {
    const dir = this.mountain.dirAt(z);
    const yaw = Math.atan2(dir.x, dir.z);
    const half = CONFIG.gates.poleGap / 2;
    for (const side of [-1, 1] as const) {
      const x = centerX + side * half;
      const y = this.mountain.heightAt(x, z);
      const pool = side < 0 ? this.redPool : this.bluePool;
      const index = pool.alloc();
      if (index === null) continue;
      const matrix = new THREE.Matrix4().compose(
        new THREE.Vector3(x, y, z),
        new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), yaw),
        new THREE.Vector3(1, 1, 1),
      );
      pool.set(index, matrix);
      allocations.push({ pool, index });
    }
  }
}
