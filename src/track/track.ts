import * as THREE from 'three';
import type { RectangleDefinition, TrackDefinition } from './definition';

const WALL_HEIGHT = 2;

/** Builds a playable track from its data definition. */
export class Track {
  readonly group = new THREE.Group();
  readonly definition: TrackDefinition;

  constructor(definition: TrackDefinition) {
    this.definition = definition;
    this.buildGround();
    this.buildWalls();
    this.buildFinishLine();
  }

  private buildGround(): void {
    const { grass: grassDefinition, road: roadDefinition, islands } = this.definition;
    const grassGeometry = new THREE.PlaneGeometry(grassDefinition.width, grassDefinition.depth);
    const grassMaterial = new THREE.MeshStandardMaterial({ color: grassDefinition.color });
    const grass = new THREE.Mesh(grassGeometry, grassMaterial);
    grass.rotation.x = -Math.PI / 2;
    grass.position.set(grassDefinition.x, 0, grassDefinition.z);
    this.group.add(grass);

    const roadGeometry = new THREE.PlaneGeometry(roadDefinition.width, roadDefinition.depth);
    const roadMaterial = new THREE.MeshStandardMaterial({ color: roadDefinition.color });
    const road = new THREE.Mesh(roadGeometry, roadMaterial);
    road.rotation.x = -Math.PI / 2;
    road.position.set(roadDefinition.x, 0.01, roadDefinition.z);
    this.group.add(road);

    for (const islandDef of islands) {
      const islandGeometry = new THREE.BoxGeometry(islandDef.width, islandDef.height, islandDef.depth);
      const island = new THREE.Mesh(islandGeometry, new THREE.MeshStandardMaterial({ color: islandDef.color }));
      island.position.set(islandDef.x, islandDef.height / 2, islandDef.z);
      this.group.add(island);
    }
  }

  private buildWalls(): void {
    for (const wallDef of this.definition.walls) {
      const material = new THREE.MeshStandardMaterial({ color: wallDef.color });
      const wall = new THREE.Mesh(new THREE.BoxGeometry(wallDef.width, WALL_HEIGHT, wallDef.depth), material);
      wall.position.set(wallDef.x, WALL_HEIGHT / 2, wallDef.z);
      this.group.add(wall);
    }
  }

  private buildFinishLine(): void {
    const { axis, coordinate, min, max } = this.definition.finishLine;
    const width = max - min;
    const geometry = new THREE.PlaneGeometry(axis === 'z' ? width : 1, axis === 'x' ? width : 1);
    const material = new THREE.MeshStandardMaterial({ color: 0xffffff });
    const line = new THREE.Mesh(geometry, material);
    line.rotation.x = -Math.PI / 2;
    line.position.set(axis === 'z' ? (min + max) / 2 : coordinate, 0.02, axis === 'z' ? coordinate : (min + max) / 2);
    this.group.add(line);
  }

  /** Recolours the shared course for a selected cup track theme. */
  setTheme(grassColor: number, roadColor: number, wallColor: number): void {
    const meshes = this.group.children.filter((child): child is THREE.Mesh => child instanceof THREE.Mesh);
    const colors = [grassColor, roadColor, grassColor, wallColor, wallColor, wallColor, wallColor];
    meshes.forEach((mesh, index) => {
      if (mesh.material instanceof THREE.MeshStandardMaterial && colors[index] !== undefined) mesh.material.color.setHex(colors[index]);
    });
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
