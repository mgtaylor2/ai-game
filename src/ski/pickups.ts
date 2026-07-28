import * as THREE from 'three';
import { CONFIG } from './config';
import { Mountain } from './terrain';
import { subRng } from './rng';
import { InstancedPool } from './decor';

type PickupKind = 'orb' | 'boost' | 'shield';

interface ActivePickup {
  kind: PickupKind;
  pool: InstancedPool;
  index: number;
  base: THREE.Vector3;
  offset: THREE.Vector3;
  bobPhase: number;
  collected: boolean;
}

export interface PickupEvent {
  type: 'collect';
  kind: PickupKind;
  position: THREE.Vector3;
}

const CHUNK_LENGTH = CONFIG.chunk.length;
const orbGeometry = new THREE.IcosahedronGeometry(0.45, 0);
const orbMaterial = new THREE.MeshStandardMaterial({
  color: CONFIG.pickups.orbColor,
  emissive: new THREE.Color(CONFIG.pickups.orbColor),
  emissiveIntensity: 1.6,
  roughness: 0.3,
  flatShading: true,
});
const boostGeometry = new THREE.OctahedronGeometry(0.55, 0);
const boostMaterial = new THREE.MeshStandardMaterial({ color: 0xffcc33, emissive: 0xff9900, emissiveIntensity: 1.4, flatShading: true });
const shieldGeometry = new THREE.OctahedronGeometry(0.5, 0);
shieldGeometry.scale(0.7, 1.4, 0.7);
const shieldMaterial = new THREE.MeshStandardMaterial({ color: 0xffffff, emissive: 0xbfe6ff, emissiveIntensity: 1.1, flatShading: true });

/** Streams pickups (orb trains, boost, shield) as deliberate per-chunk patterns — never scattered randomly. */
export class PickupManager {
  readonly group = new THREE.Group();
  private readonly mountain: Mountain;
  private readonly orbPool = new InstancedPool(orbGeometry, orbMaterial, 500, false);
  private readonly boostPool = new InstancedPool(boostGeometry, boostMaterial, 24, false);
  private readonly shieldPool = new InstancedPool(shieldGeometry, shieldMaterial, 12, false);
  private readonly active = new Map<number, ActivePickup[]>();
  private time = 0;

  constructor(mountain: Mountain) {
    this.mountain = mountain;
    this.group.add(this.orbPool.mesh, this.boostPool.mesh, this.shieldPool.mesh);
  }

  update(dt: number, playerZ: number, riderPosition: THREE.Vector3): PickupEvent[] {
    this.time += dt;
    const currentIndex = Math.max(0, Math.floor(playerZ / CHUNK_LENGTH));
    const minIndex = Math.max(0, currentIndex - CONFIG.chunk.behind);
    const maxIndex = currentIndex + CONFIG.chunk.ahead;

    for (const index of Array.from(this.active.keys())) {
      if (index < minIndex || index > maxIndex) this.unload(index);
    }
    for (let i = minIndex; i <= maxIndex; i++) {
      if (!this.active.has(i)) this.build(i);
    }

    const events: PickupEvent[] = [];
    const p = CONFIG.pickups;
    for (const list of this.active.values()) {
      for (const pickup of list) {
        if (pickup.collected) continue;
        const world = pickup.base.clone().add(pickup.offset);
        const dist = world.distanceTo(riderPosition);

        if (dist < p.collectRadius) {
          pickup.collected = true;
          pickup.pool.free(pickup.index);
          events.push({ type: 'collect', kind: pickup.kind, position: world });
          continue;
        }
        if (dist < p.magnetRadius) {
          const pull = riderPosition.clone().sub(world).multiplyScalar(Math.min(1, dt * 8));
          pickup.offset.add(pull);
        }

        pickup.bobPhase += dt * 3;
        const bobY = Math.sin(pickup.bobPhase) * 0.18;
        const spin = this.time * 1.6 + pickup.bobPhase;
        const matrix = new THREE.Matrix4().compose(
          new THREE.Vector3(world.x, world.y + bobY, world.z),
          new THREE.Quaternion().setFromEuler(new THREE.Euler(0, spin, 0)),
          new THREE.Vector3(1, 1, 1),
        );
        pickup.pool.set(pickup.index, matrix);
      }
    }
    this.orbPool.flush();
    this.boostPool.flush();
    this.shieldPool.flush();
    return events;
  }

  private unload(index: number): void {
    const list = this.active.get(index);
    if (!list) return;
    for (const pickup of list) if (!pickup.collected) pickup.pool.free(pickup.index);
    this.active.delete(index);
  }

  private spawn(kind: PickupKind, position: THREE.Vector3, list: ActivePickup[]): void {
    const pool = kind === 'orb' ? this.orbPool : kind === 'boost' ? this.boostPool : this.shieldPool;
    const index = pool.alloc();
    if (index === null) return;
    list.push({ kind, pool, index, base: position.clone(), offset: new THREE.Vector3(), bobPhase: Math.random() * Math.PI * 2, collected: false });
  }

  private build(chunkIndex: number): void {
    const list: ActivePickup[] = [];
    const chunkStartZ = chunkIndex * CHUNK_LENGTH;
    const patternRandom = subRng(CONFIG.seed, chunkIndex, 0x3001);
    const kickers = this.mountain.getChunkKickers(chunkIndex);

    if (kickers.length > 0 && patternRandom() < 0.5) {
      this.buildKickerLine(chunkIndex, kickers[0].z, kickers[0].x, list);
    } else if (patternRandom() < 0.5) {
      this.buildArc(chunkStartZ, list);
    } else {
      this.buildZigzag(chunkStartZ, list);
    }

    const bonusRandom = subRng(CONFIG.seed, chunkIndex, 0x3002);
    if (bonusRandom() < CONFIG.pickups.boostChance) {
      const z = chunkStartZ + CHUNK_LENGTH * 0.25;
      const x = this.mountain.centerXAt(z) + (bonusRandom() * 2 - 1) * 4;
      this.spawn('boost', new THREE.Vector3(x, this.mountain.heightAt(x, z) + 1.1, z), list);
    }
    if (bonusRandom() < CONFIG.pickups.shieldChance) {
      const z = chunkStartZ + CHUNK_LENGTH * 0.75;
      const x = this.mountain.centerXAt(z) + (bonusRandom() * 2 - 1) * 4;
      this.spawn('shield', new THREE.Vector3(x, this.mountain.heightAt(x, z) + 1.1, z), list);
    }

    this.active.set(chunkIndex, list);
  }

  private buildKickerLine(_chunkIndex: number, kickerZ: number, kickerX: number, list: ActivePickup[]): void {
    const count = CONFIG.pickups.orbCount.line;
    const span = 26;
    for (let i = 0; i < count; i++) {
      const t = i / (count - 1) - 0.5;
      const z = kickerZ + t * span;
      const arcHeight = (1 - (t * 2) ** 2) * 3.2;
      const y = this.mountain.heightAt(kickerX, z) + 1.4 + Math.max(0, arcHeight);
      this.spawn('orb', new THREE.Vector3(kickerX, y, z), list);
    }
  }

  private buildArc(chunkStartZ: number, list: ActivePickup[]): void {
    const count = CONFIG.pickups.orbCount.arc;
    for (let i = 0; i < count; i++) {
      const t = i / (count - 1);
      const z = chunkStartZ + t * CHUNK_LENGTH * 0.85 + CHUNK_LENGTH * 0.08;
      const lateral = Math.sin(t * Math.PI) * 9;
      const x = this.mountain.centerXAt(z) + lateral;
      const y = this.mountain.heightAt(x, z) + 1.2;
      this.spawn('orb', new THREE.Vector3(x, y, z), list);
    }
  }

  private buildZigzag(chunkStartZ: number, list: ActivePickup[]): void {
    const count = CONFIG.pickups.orbCount.zigzag;
    for (let i = 0; i < count; i++) {
      const t = (i + 0.5) / count;
      const z = chunkStartZ + t * CHUNK_LENGTH;
      const lateral = i % 2 === 0 ? CONFIG.pickups.zigzagOffset : -CONFIG.pickups.zigzagOffset;
      const x = this.mountain.centerXAt(z) + lateral;
      const y = this.mountain.heightAt(x, z) + 1.2;
      this.spawn('orb', new THREE.Vector3(x, y, z), list);
    }
  }
}
