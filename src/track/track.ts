import * as THREE from 'three';
import type { RectangleDefinition, TrackDefinition } from './definition';

const WALL_HEIGHT = 2;

/** Builds a playable track from its data definition. */
export class Track {
  readonly group = new THREE.Group();
  readonly definition: TrackDefinition;
  private readonly themedMaterials: THREE.MeshStandardMaterial[] = [];

  constructor(definition: TrackDefinition) {
    this.definition = definition;
    this.buildGround();
    this.buildWalls();
    this.buildFinishLine();
  }

  private buildGround(): void {
    const { grass: grassDefinition, road: roadDefinition, islands } = this.definition;
    const grassGeometry = new THREE.PlaneGeometry(grassDefinition.width, grassDefinition.depth);
    const grassMaterial = new THREE.MeshStandardMaterial({ color: grassDefinition.color, map: this.createGrassTexture() });
    const grass = new THREE.Mesh(grassGeometry, grassMaterial);
    grass.rotation.x = -Math.PI / 2;
    grass.position.set(grassDefinition.x, 0, grassDefinition.z);
    grass.receiveShadow = true;
    this.group.add(grass);
    this.themedMaterials.push(grassMaterial);

    const roadGeometry = new THREE.PlaneGeometry(roadDefinition.width, roadDefinition.depth);
    const roadMaterial = new THREE.MeshStandardMaterial({ color: roadDefinition.color, map: this.createRoadTexture() });
    const road = new THREE.Mesh(roadGeometry, roadMaterial);
    road.rotation.x = -Math.PI / 2;
    road.position.set(roadDefinition.x, 0.01, roadDefinition.z);
    road.receiveShadow = true;
    this.group.add(road);
    this.themedMaterials.push(roadMaterial);

    for (const islandDef of islands) {
      const islandGeometry = new THREE.BoxGeometry(islandDef.width, islandDef.height, islandDef.depth);
      const islandMaterial = new THREE.MeshStandardMaterial({ color: islandDef.color, roughness: 0.95 });
      const island = new THREE.Mesh(islandGeometry, islandMaterial);
      island.position.set(islandDef.x, islandDef.height / 2, islandDef.z);
      island.castShadow = true;
      island.receiveShadow = true;
      this.group.add(island);
      this.themedMaterials.push(islandMaterial);
    }
  }

  private buildWalls(): void {
    for (const wallDef of this.definition.walls) {
      const material = new THREE.MeshStandardMaterial({ color: wallDef.color, roughness: 0.72 });
      const wall = new THREE.Mesh(new THREE.BoxGeometry(wallDef.width, WALL_HEIGHT, wallDef.depth), material);
      wall.position.set(wallDef.x, WALL_HEIGHT / 2, wallDef.z);
      wall.castShadow = true;
      wall.receiveShadow = true;
      this.group.add(wall);
      this.themedMaterials.push(material);
    }
  }

  private buildFinishLine(): void {
    const { axis, coordinate, min, max } = this.definition.finishLine;
    const width = max - min;
    const geometry = new THREE.PlaneGeometry(axis === 'z' ? width : 1, axis === 'x' ? width : 1);
    const material = new THREE.MeshStandardMaterial({ map: this.createFinishTexture(axis === 'z' ? width : 1, axis === 'x' ? width : 1) });
    const line = new THREE.Mesh(geometry, material);
    line.rotation.x = -Math.PI / 2;
    line.position.set(axis === 'z' ? (min + max) / 2 : coordinate, 0.02, axis === 'z' ? coordinate : (min + max) / 2);
    line.receiveShadow = true;
    this.group.add(line);
  }

  /** Recolours the shared course for a selected cup track theme. */
  setTheme(grassColor: number, roadColor: number, wallColor: number): void {
    this.themedMaterials[0]?.color.setHex(grassColor);
    this.themedMaterials[1]?.color.setHex(roadColor);
    this.themedMaterials.slice(2).forEach((material, index) => material.color.setHex(index === 0 ? grassColor : wallColor));
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
    return this.repeatTexture(canvas, 9, 7);
  }

  private createRoadTexture(): THREE.CanvasTexture {
    const canvas = document.createElement('canvas');
    canvas.width = canvas.height = 128;
    const context = canvas.getContext('2d');
    if (!context) throw new Error('Canvas 2D context is unavailable');
    context.fillStyle = '#ffffff';
    context.fillRect(0, 0, 128, 128);
    context.fillStyle = 'rgba(35, 35, 45, 0.16)';
    for (let y = 0; y < 128; y += 16) context.fillRect(0, y, 128, 2);
    context.fillStyle = 'rgba(255, 255, 255, 0.14)';
    for (let x = 8; x < 128; x += 32) context.fillRect(x, 62, 16, 4);
    return this.repeatTexture(canvas, 6, 4);
  }

  private createFinishTexture(width: number, depth: number): THREE.CanvasTexture {
    const canvas = document.createElement('canvas');
    canvas.width = canvas.height = 128;
    const context = canvas.getContext('2d');
    if (!context) throw new Error('Canvas 2D context is unavailable');
    const cell = 16;
    for (let y = 0; y < 128; y += cell) for (let x = 0; x < 128; x += cell) {
      context.fillStyle = (x / cell + y / cell) % 2 === 0 ? '#f8fafc' : '#1b263b';
      context.fillRect(x, y, cell, cell);
    }
    return this.repeatTexture(canvas, Math.max(1, width / 4), Math.max(1, depth / 2));
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
   * Clamps a candidate position to stay within the outer boundary and outside the inner
   * island, in place. Returns whether the position was adjusted (i.e. a wall was hit).
   */
  resolveCollision(position: THREE.Vector3, radius: number): boolean {
    let collided = false;

    const { boundary, solidRects } = this.definition.collision;
    const minX = boundary.x - boundary.width / 2 + radius;
    const maxX = boundary.x + boundary.width / 2 - radius;
    const minZ = boundary.z - boundary.depth / 2 + radius;
    const maxZ = boundary.z + boundary.depth / 2 - radius;

    if (position.x < minX) {
      position.x = minX;
      collided = true;
    } else if (position.x > maxX) {
      position.x = maxX;
      collided = true;
    }

    if (position.z < minZ) {
      position.z = minZ;
      collided = true;
    } else if (position.z > maxZ) {
      position.z = maxZ;
      collided = true;
    }

    for (const solidRect of solidRects) collided = this.resolveSolidRect(position, radius, solidRect) || collided;

    return collided;
  }

  private resolveSolidRect(position: THREE.Vector3, radius: number, rect: RectangleDefinition): boolean {
    const minX = rect.x - rect.width / 2 - radius;
    const maxX = rect.x + rect.width / 2 + radius;
    const minZ = rect.z - rect.depth / 2 - radius;
    const maxZ = rect.z + rect.depth / 2 + radius;
    if (position.x <= minX || position.x >= maxX || position.z <= minZ || position.z >= maxZ) return false;

    const distances = [position.x - minX, maxX - position.x, position.z - minZ, maxZ - position.z];
    const minDistance = Math.min(...distances);
    if (minDistance === distances[0]) position.x = minX;
    else if (minDistance === distances[1]) position.x = maxX;
    else if (minDistance === distances[2]) position.z = minZ;
    else position.z = maxZ;
    return true;
  }

  /** Returns true when movement crosses the defined finish-line segment. */
  crossesFinishLine(previous: THREE.Vector3, current: THREE.Vector3): boolean {
    const { axis, coordinate, min, max } = this.definition.finishLine;
    const previousAlong = axis === 'z' ? previous.z : previous.x;
    const currentAlong = axis === 'z' ? current.z : current.x;
    const across = axis === 'z' ? current.x : current.z;
    return across >= min && across <= max && (previousAlong - coordinate) * (currentAlong - coordinate) < 0;
  }
}
