import * as THREE from 'three';

export const KART_RADIUS = 1.4;

export class Kart {
  readonly mesh: THREE.Group;
  readonly position = new THREE.Vector3(0, 0, 0);
  heading = 0; // radians; 0 = facing +Z
  speed = 0; // units/sec; positive = forward, negative = reverse

  constructor() {
    this.mesh = this.buildMesh();
    this.syncMesh();
  }

  private buildMesh(): THREE.Group {
    const group = new THREE.Group();

    const body = new THREE.Mesh(
      new THREE.BoxGeometry(1.6, 0.6, 2.6),
      new THREE.MeshStandardMaterial({ color: 0xe63946 }),
    );
    body.position.y = 0.6;
    group.add(body);

    const nose = new THREE.Mesh(
      new THREE.ConeGeometry(0.5, 1, 4),
      new THREE.MeshStandardMaterial({ color: 0xffb703 }),
    );
    nose.rotation.x = Math.PI / 2;
    nose.rotation.y = Math.PI / 4;
    nose.position.set(0, 0.6, 1.6);
    group.add(nose);

    const wheelGeometry = new THREE.CylinderGeometry(0.35, 0.35, 0.4, 12);
    const wheelMaterial = new THREE.MeshStandardMaterial({ color: 0x111111 });
    const wheelOffsets: Array<[number, number]> = [
      [-0.9, 1],
      [0.9, 1],
      [-0.9, -1],
      [0.9, -1],
    ];
    for (const [x, z] of wheelOffsets) {
      const wheel = new THREE.Mesh(wheelGeometry, wheelMaterial);
      wheel.rotation.z = Math.PI / 2;
      wheel.position.set(x, 0.35, z);
      group.add(wheel);
    }

    return group;
  }

  syncMesh(): void {
    this.mesh.position.copy(this.position);
    this.mesh.rotation.y = this.heading;
  }

  reset(x: number, z: number, heading: number): void {
    this.position.set(x, 0, z);
    this.heading = heading;
    this.speed = 0;
    this.syncMesh();
  }
}
