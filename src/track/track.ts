import * as THREE from 'three';
import type { TrackDefinition } from './definition';
import { computePathGeometry, type Vec2 } from './path';
import { createToonMaterial, addOutline } from '../game/toon';

const ROAD_Y_OFFSET = 0.02;
const GUARDRAIL_HEIGHT = 0.8;
const GRASS_Y = -0.6; // sunk below the road so elevated sections read as raised above ground
const GRASS_MARGIN = 60;
const TREE_STRIDE = 5; // place a tree every N path samples
const TREE_OFFSET = 6; // distance beyond the road edge

/** Segment-vs-segment intersection test (2D), used for finish-line crossings on a curved track. */
function segmentsIntersect(p1: Vec2, p2: Vec2, p3: Vec2, p4: Vec2): boolean {
  const d1x = p2.x - p1.x;
  const d1z = p2.z - p1.z;
  const d2x = p4.x - p3.x;
  const d2z = p4.z - p3.z;
  const denom = d1x * d2z - d1z * d2x;
  if (denom === 0) return false;
  const t = ((p3.x - p1.x) * d2z - (p3.z - p1.z) * d2x) / denom;
  const u = ((p3.x - p1.x) * d1z - (p3.z - p1.z) * d1x) / denom;
  return t >= 0 && t <= 1 && u >= 0 && u <= 1;
}

/** Builds a playable track from a curved centerline path (see definition.ts). */
export class Track {
  readonly group = new THREE.Group();
  readonly definition: TrackDefinition;
  private readonly themedMaterials: THREE.MeshToonMaterial[] = [];
  private readonly normals: Vec2[];

  constructor(definition: TrackDefinition) {
    this.definition = definition;
    this.normals = computePathGeometry(definition.path).normals;

    this.buildGrass();
    this.buildRoad();
    this.buildGuardrails();
    this.buildFinishLine();
    this.buildEnvironment();
  }

  private computeBounds(): { minX: number; maxX: number; minZ: number; maxZ: number } {
    let minX = Infinity, maxX = -Infinity, minZ = Infinity, maxZ = -Infinity;
    for (const p of this.definition.path) {
      minX = Math.min(minX, p.x);
      maxX = Math.max(maxX, p.x);
      minZ = Math.min(minZ, p.z);
      maxZ = Math.max(maxZ, p.z);
    }
    return { minX, maxX, minZ, maxZ };
  }

  private buildGrass(): void {
    const bounds = this.computeBounds();
    const width = bounds.maxX - bounds.minX + GRASS_MARGIN * 2;
    const depth = bounds.maxZ - bounds.minZ + GRASS_MARGIN * 2;
    const centerX = (bounds.maxX + bounds.minX) / 2;
    const centerZ = (bounds.maxZ + bounds.minZ) / 2;

    const grassMaterial = createToonMaterial(this.definition.grassColor, this.createGrassTexture());
    const grass = new THREE.Mesh(new THREE.PlaneGeometry(width, depth), grassMaterial);
    grass.rotation.x = -Math.PI / 2;
    grass.position.set(centerX, GRASS_Y, centerZ);
    grass.receiveShadow = true;
    this.group.add(grass);
    this.themedMaterials.push(grassMaterial);
  }

  /** Extrudes a flat ribbon of the given half-width/height-offset along the path, as a triangle strip. */
  private buildRibbon(halfWidth: number, yOffset: number, material: THREE.Material): THREE.Mesh {
    const { path } = this.definition;
    const count = path.length;
    const positions: number[] = [];
    const uvs: number[] = [];
    const indices: number[] = [];

    for (let i = 0; i <= count; i++) {
      const p = path[i % count];
      const n = this.normals[i % count];
      positions.push(p.x + n.x * halfWidth, p.y + yOffset, p.z + n.z * halfWidth);
      positions.push(p.x - n.x * halfWidth, p.y + yOffset, p.z - n.z * halfWidth);
      uvs.push(0, i * 0.5, 1, i * 0.5);
    }
    for (let i = 0; i < count; i++) {
      const a = i * 2, b = i * 2 + 1, c = (i + 1) * 2, d = (i + 1) * 2 + 1;
      indices.push(a, c, b, b, c, d);
    }

    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
    geometry.setAttribute('uv', new THREE.Float32BufferAttribute(uvs, 2));
    geometry.setIndex(indices);
    geometry.computeVertexNormals();

    const mesh = new THREE.Mesh(geometry, material);
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    return mesh;
  }

  private buildRoad(): void {
    const texture = this.createRoadTexture();
    texture.wrapS = THREE.RepeatWrapping;
    texture.wrapT = THREE.RepeatWrapping;
    texture.repeat.set(1, this.definition.path.length * 0.5);
    const roadMaterial = createToonMaterial(this.definition.roadColor, texture);
    const road = this.buildRibbon(this.definition.roadWidth / 2, ROAD_Y_OFFSET, roadMaterial);
    this.group.add(road);
    this.themedMaterials.push(roadMaterial);
  }

  private buildGuardrails(): void {
    const material = createToonMaterial(this.definition.wallColor);
    const halfWidth = this.definition.roadWidth / 2;
    for (const side of [1, -1]) {
      const { path } = this.definition;
      const count = path.length;
      const positions: number[] = [];
      const indices: number[] = [];
      for (let i = 0; i <= count; i++) {
        const p = path[i % count];
        const n = this.normals[i % count];
        const edgeX = p.x + n.x * halfWidth * side;
        const edgeZ = p.z + n.z * halfWidth * side;
        positions.push(edgeX, p.y + ROAD_Y_OFFSET, edgeZ);
        positions.push(edgeX, p.y + ROAD_Y_OFFSET + GUARDRAIL_HEIGHT, edgeZ);
      }
      for (let i = 0; i < count; i++) {
        const a = i * 2, b = i * 2 + 1, c = (i + 1) * 2, d = (i + 1) * 2 + 1;
        indices.push(a, c, b, b, c, d);
      }
      const geometry = new THREE.BufferGeometry();
      geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
      geometry.setIndex(indices);
      geometry.computeVertexNormals();
      const rail = new THREE.Mesh(geometry, material);
      rail.castShadow = true;
      addOutline(rail, 0.02);
      this.group.add(rail);
    }
    this.themedMaterials.push(material);
  }

  /**
   * Builds the finish-line marker as a quad whose 4 corners each sit at the track's real
   * (interpolated) elevation, rather than one rigid flat plane -- a flat plane clips into
   * sloped ground on one side and floats above it on the other wherever the road isn't
   * level, which is common right after a hill's foot.
   */
  private buildFinishLine(): void {
    const { a, b, direction } = this.definition.finishLine;
    const halfThickness = 1.2;
    const y = ROAD_Y_OFFSET + 0.01;
    const corners = [
      { x: a.x - direction.x * halfThickness, z: a.z - direction.z * halfThickness }, // a, behind
      { x: a.x + direction.x * halfThickness, z: a.z + direction.z * halfThickness }, // a, ahead
      { x: b.x - direction.x * halfThickness, z: b.z - direction.z * halfThickness }, // b, behind
      { x: b.x + direction.x * halfThickness, z: b.z + direction.z * halfThickness }, // b, ahead
    ];
    const positions: number[] = [];
    for (const corner of corners) positions.push(corner.x, this.getHeightAt(corner.x, corner.z) + y, corner.z);
    const uvs = [0, 0, 0, 1, 1, 0, 1, 1];
    const indices = [0, 2, 1, 1, 2, 3];

    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
    geometry.setAttribute('uv', new THREE.Float32BufferAttribute(uvs, 2));
    geometry.setIndex(indices);
    geometry.computeVertexNormals();

    const material = createToonMaterial(0xffffff, this.createFinishTexture());
    const line = new THREE.Mesh(geometry, material);
    line.receiveShadow = true;
    this.group.add(line);
  }

  /** Scatters stylised pine trees just outside both edges of the track. */
  private buildEnvironment(): void {
    const { path } = this.definition;
    const halfWidth = this.definition.roadWidth / 2;
    for (let i = 0; i < path.length; i += TREE_STRIDE) {
      const p = path[i];
      const n = this.normals[i];
      for (const side of [1, -1]) {
        const dist = halfWidth + TREE_OFFSET + Math.random() * 6;
        const x = p.x + n.x * dist * side;
        const z = p.z + n.z * dist * side;
        this.group.add(this.buildTree(x, z, p.y));
      }
    }
  }

  private buildTree(x: number, z: number, groundY: number): THREE.Group {
    const tree = new THREE.Group();
    const trunkHeight = 1.6 + Math.random() * 0.6;
    const trunk = new THREE.Mesh(new THREE.CylinderGeometry(0.18, 0.24, trunkHeight, 6), createToonMaterial(0x8a5a3b));
    trunk.position.y = trunkHeight / 2;
    trunk.castShadow = true;
    addOutline(trunk, 0.06);
    tree.add(trunk);

    for (let tier = 0; tier < 3; tier++) {
      const radius = 1.5 - tier * 0.35;
      const height = 1.4 - tier * 0.25;
      const cone = new THREE.Mesh(new THREE.ConeGeometry(radius, height, 8), createToonMaterial(0x2f8f4e));
      cone.position.y = trunkHeight + tier * 0.75;
      cone.castShadow = true;
      addOutline(cone, 0.06);
      tree.add(cone);
    }

    tree.position.set(x, groundY, z);
    tree.rotation.y = Math.random() * Math.PI * 2;
    tree.scale.setScalar(0.85 + Math.random() * 0.5);
    return tree;
  }

  /** Recolours the shared course for a selected cup track theme. */
  setTheme(grassColor: number, roadColor: number, wallColor: number): void {
    this.themedMaterials[0]?.color.setHex(grassColor);
    this.themedMaterials[1]?.color.setHex(roadColor);
    this.themedMaterials[2]?.color.setHex(wallColor);
  }

  private createGrassTexture(): THREE.CanvasTexture {
    const canvas = document.createElement('canvas');
    canvas.width = canvas.height = 128;
    const context = canvas.getContext('2d');
    if (!context) throw new Error('Canvas 2D context is unavailable');
    context.fillStyle = '#ffffff';
    context.fillRect(0, 0, 128, 128);
    context.globalAlpha = 0.12;
    context.fillStyle = '#477b45';
    for (let x = 0; x < 128; x += 16) context.fillRect(x, 0, 8, 128);
    return this.repeatTexture(canvas, 14, 14);
  }

  private createRoadTexture(): THREE.CanvasTexture {
    const canvas = document.createElement('canvas');
    canvas.width = canvas.height = 128;
    const context = canvas.getContext('2d');
    if (!context) throw new Error('Canvas 2D context is unavailable');
    context.fillStyle = '#ffffff';
    context.fillRect(0, 0, 128, 128);
    context.fillStyle = 'rgba(35, 35, 45, 0.16)';
    context.fillRect(60, 0, 8, 128);
    context.fillStyle = 'rgba(255, 255, 255, 0.14)';
    for (let y = 8; y < 128; y += 32) context.fillRect(58, y, 12, 16);
    return this.repeatTexture(canvas, 1, 1);
  }

  private createFinishTexture(): THREE.CanvasTexture {
    const canvas = document.createElement('canvas');
    canvas.width = canvas.height = 128;
    const context = canvas.getContext('2d');
    if (!context) throw new Error('Canvas 2D context is unavailable');
    const cell = 16;
    for (let y = 0; y < 128; y += cell) for (let x = 0; x < 128; x += cell) {
      context.fillStyle = (x / cell + y / cell) % 2 === 0 ? '#f8fafc' : '#1b263b';
      context.fillRect(x, y, cell, cell);
    }
    return this.repeatTexture(canvas, 6, 1);
  }

  private repeatTexture(canvas: HTMLCanvasElement, repeatX: number, repeatY: number): THREE.CanvasTexture {
    const texture = new THREE.CanvasTexture(canvas);
    texture.colorSpace = THREE.SRGBColorSpace;
    texture.wrapS = THREE.RepeatWrapping;
    texture.wrapT = THREE.RepeatWrapping;
    texture.repeat.set(repeatX, repeatY);
    return texture;
  }

  /**
   * Finds the closest point to (x, z) on the whole path polyline (not just the closest
   * sample) by projecting onto every segment and clamping to it. Returns enough to
   * interpolate elevation and the lateral (normal-direction) offset smoothly, so height
   * and collision don't snap in steps between the 72 discrete samples.
   */
  private locateOnPath(x: number, z: number): { pointX: number; pointZ: number; y: number; normalX: number; normalZ: number } {
    const { path } = this.definition;
    const count = path.length;
    let bestDistSq = Infinity;
    let bestIndex = 0;
    let bestT = 0;
    for (let i = 0; i < count; i++) {
      const a = path[i];
      const b = path[(i + 1) % count];
      const abx = b.x - a.x;
      const abz = b.z - a.z;
      const lengthSq = abx * abx + abz * abz || 1;
      const t = Math.max(0, Math.min(1, ((x - a.x) * abx + (z - a.z) * abz) / lengthSq));
      const px = a.x + abx * t;
      const pz = a.z + abz * t;
      const distSq = (px - x) ** 2 + (pz - z) ** 2;
      if (distSq < bestDistSq) {
        bestDistSq = distSq;
        bestIndex = i;
        bestT = t;
      }
    }
    const a = path[bestIndex];
    const b = path[(bestIndex + 1) % count];
    const na = this.normals[bestIndex];
    const nb = this.normals[(bestIndex + 1) % count];
    return {
      pointX: a.x + (b.x - a.x) * bestT,
      pointZ: a.z + (b.z - a.z) * bestT,
      y: a.y + (b.y - a.y) * bestT,
      normalX: na.x + (nb.x - na.x) * bestT,
      normalZ: na.z + (nb.z - na.z) * bestT,
    };
  }

  /** Interpolated elevation of the track centerline nearest (x, z); used so karts follow hills smoothly. */
  getHeightAt(x: number, z: number): number {
    return this.locateOnPath(x, z).y;
  }

  /**
   * Clamps a candidate position to stay within the road's width around the nearest point
   * on the centerline. Returns whether the position was adjusted (i.e. an edge was hit).
   */
  resolveCollision(position: THREE.Vector3, radius: number): boolean {
    const { pointX, pointZ, normalX, normalZ } = this.locateOnPath(position.x, position.z);
    const lateral = (position.x - pointX) * normalX + (position.z - pointZ) * normalZ;
    const limit = this.definition.roadWidth / 2 - radius;
    if (Math.abs(lateral) <= limit) return false;

    const sign = Math.sign(lateral) || 1;
    const excess = Math.abs(lateral) - limit;
    position.x -= normalX * sign * excess;
    position.z -= normalZ * sign * excess;
    return true;
  }

  /** Returns true when movement crosses the finish-line gate. */
  crossesFinishLine(previous: THREE.Vector3, current: THREE.Vector3): boolean {
    const { a, b } = this.definition.finishLine;
    return segmentsIntersect({ x: previous.x, z: previous.z }, { x: current.x, z: current.z }, a, b);
  }
}
