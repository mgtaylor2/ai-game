import * as THREE from 'three';

export const KART_RADIUS = 1.4;

export class Kart {
  readonly mesh: THREE.Group;
  readonly position = new THREE.Vector3(0, 0, 0);
  private readonly riderMaterials: THREE.MeshStandardMaterial[] = [];
  heading = 0; // radians; 0 = facing +Z
  speed = 0; // units/sec; positive = forward, negative = reverse

  constructor() {
    this.mesh = this.buildMesh();
    this.syncMesh();
  }

  /** Applies the player-selected vehicle paint without rebuilding physics. */
  setPaint(color: number, accent: number): void {
    let bodyApplied = false;
    let accentApplied = false;
    this.mesh.traverse((child) => {
      if (!(child instanceof THREE.Mesh)) return;
      const material = child.material;
      if (!(material instanceof THREE.MeshStandardMaterial)) return;
      if (!bodyApplied) {
        material.color.setHex(color);
        bodyApplied = true;
      } else if (!accentApplied) {
        material.color.setHex(accent);
        accentApplied = true;
      }
    });
  }

  /** Recolours the simple rider and helmet used by the character picker. */
  setDriverPaint(suitColor: number, helmetColor: number): void {
    this.riderMaterials[0]?.color.setHex(suitColor);
    this.riderMaterials[1]?.color.setHex(helmetColor);
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

    // A deliberately stylised in-game driver: this keeps every vehicle from
    // looking empty while leaving room to swap to authored character assets.
    const suitMaterial = new THREE.MeshStandardMaterial({ color: 0x2d7dd2 });
    const helmetMaterial = new THREE.MeshStandardMaterial({ color: 0xf9c74f });
    this.riderMaterials.push(suitMaterial, helmetMaterial);
    const torso = new THREE.Mesh(new THREE.CapsuleGeometry(0.32, 0.55, 4, 10), suitMaterial);
    torso.position.set(0, 1.18, -0.25);
    group.add(torso);
    const head = new THREE.Mesh(new THREE.SphereGeometry(0.28, 14, 10), new THREE.MeshStandardMaterial({ color: 0xf2c6a0 }));
    head.position.set(0, 1.72, -0.25);
    group.add(head);
    const helmet = new THREE.Mesh(new THREE.SphereGeometry(0.32, 14, 10, 0, Math.PI * 2, 0, Math.PI / 2), helmetMaterial);
    helmet.position.set(0, 1.78, -0.25);
    group.add(helmet);
    const visor = new THREE.Mesh(new THREE.BoxGeometry(0.45, 0.12, 0.08), new THREE.MeshStandardMaterial({ color: 0x25324a }));
    visor.position.set(0, 1.74, 0.02);
    group.add(visor);

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
