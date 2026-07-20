import * as THREE from 'three';

const WALL_HEIGHT = 2;
const WALL_THICKNESS = 1;

/** A rectangular-ring track: drivable corridor between an outer boundary and an inner island. */
export class Track {
  readonly group = new THREE.Group();
  readonly outerHalfX = 40;
  readonly outerHalfZ = 25;
  readonly innerHalfX = 20;
  readonly innerHalfZ = 10;
  // The finish line only spans the right straight (x in [20, 40]). A full-width line
  // at z=17 would sit above the island and be crossed twice per lap (once on each
  // straight), double-counting laps.
  readonly finishLineZ = 17;
  readonly finishLineMinX = this.innerHalfX;
  readonly finishLineMaxX = this.outerHalfX;

  constructor() {
    this.buildGround();
    this.buildWalls();
    this.buildFinishLine();
  }

  private buildGround(): void {
    const grassGeometry = new THREE.PlaneGeometry(this.outerHalfX * 2 + 20, this.outerHalfZ * 2 + 20);
    const grassMaterial = new THREE.MeshStandardMaterial({ color: 0x3a7d44 });
    const grass = new THREE.Mesh(grassGeometry, grassMaterial);
    grass.rotation.x = -Math.PI / 2;
    this.group.add(grass);

    const roadGeometry = new THREE.PlaneGeometry(this.outerHalfX * 2, this.outerHalfZ * 2);
    const roadMaterial = new THREE.MeshStandardMaterial({ color: 0x4a4a4a });
    const road = new THREE.Mesh(roadGeometry, roadMaterial);
    road.rotation.x = -Math.PI / 2;
    road.position.y = 0.01;
    this.group.add(road);

    const islandGeometry = new THREE.BoxGeometry(this.innerHalfX * 2, 1, this.innerHalfZ * 2);
    const islandMaterial = new THREE.MeshStandardMaterial({ color: 0x2f6b39 });
    const island = new THREE.Mesh(islandGeometry, islandMaterial);
    island.position.y = 0.5;
    this.group.add(island);
  }

  private buildWalls(): void {
    const material = new THREE.MeshStandardMaterial({ color: 0xcc3333 });

    const addWall = (width: number, depth: number, x: number, z: number): void => {
      const wall = new THREE.Mesh(new THREE.BoxGeometry(width, WALL_HEIGHT, depth), material);
      wall.position.set(x, WALL_HEIGHT / 2, z);
      this.group.add(wall);
    };

    addWall(this.outerHalfX * 2 + WALL_THICKNESS * 2, WALL_THICKNESS, 0, -this.outerHalfZ);
    addWall(this.outerHalfX * 2 + WALL_THICKNESS * 2, WALL_THICKNESS, 0, this.outerHalfZ);
    addWall(WALL_THICKNESS, this.outerHalfZ * 2, -this.outerHalfX, 0);
    addWall(WALL_THICKNESS, this.outerHalfZ * 2, this.outerHalfX, 0);
  }

  private buildFinishLine(): void {
    const width = this.finishLineMaxX - this.finishLineMinX;
    const geometry = new THREE.PlaneGeometry(width, 1);
    const material = new THREE.MeshStandardMaterial({ color: 0xffffff });
    const line = new THREE.Mesh(geometry, material);
    line.rotation.x = -Math.PI / 2;
    line.position.set((this.finishLineMinX + this.finishLineMaxX) / 2, 0.02, this.finishLineZ);
    this.group.add(line);
  }

  /**
   * Clamps a candidate position to stay within the outer boundary and outside the inner
   * island, in place. Returns whether the position was adjusted (i.e. a wall was hit).
   */
  resolveCollision(position: THREE.Vector3, radius: number): boolean {
    let collided = false;

    const minX = -this.outerHalfX + radius;
    const maxX = this.outerHalfX - radius;
    const minZ = -this.outerHalfZ + radius;
    const maxZ = this.outerHalfZ - radius;

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

    const islandMinX = -this.innerHalfX - radius;
    const islandMaxX = this.innerHalfX + radius;
    const islandMinZ = -this.innerHalfZ - radius;
    const islandMaxZ = this.innerHalfZ + radius;

    if (
      position.x > islandMinX &&
      position.x < islandMaxX &&
      position.z > islandMinZ &&
      position.z < islandMaxZ
    ) {
      const distToLeft = position.x - islandMinX;
      const distToRight = islandMaxX - position.x;
      const distToTop = position.z - islandMinZ;
      const distToBottom = islandMaxZ - position.z;
      const minDist = Math.min(distToLeft, distToRight, distToTop, distToBottom);

      if (minDist === distToLeft) position.x = islandMinX;
      else if (minDist === distToRight) position.x = islandMaxX;
      else if (minDist === distToTop) position.z = islandMinZ;
      else position.z = islandMaxZ;

      collided = true;
    }

    return collided;
  }

  /** Returns true if a point's z crosses the finish line plane between two frames. */
  crossesFinishLine(x: number, prevZ: number, newZ: number): boolean {
    if (x < this.finishLineMinX || x > this.finishLineMaxX) return false;
    return (prevZ - this.finishLineZ) * (newZ - this.finishLineZ) < 0;
  }
}
