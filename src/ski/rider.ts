import * as THREE from 'three';
import { CONFIG } from './config';

const UP = new THREE.Vector3(0, 1, 0);

/** Nested-group rig: root (surface tilt + travel yaw) -> board-tilt group (edge roll) -> character group (crouch/counter-rotate/flail/tuck). */
export class Rider {
  readonly root = new THREE.Group();
  private readonly boardTilt = new THREE.Group();
  private readonly character = new THREE.Group();
  private readonly leftArm: THREE.Mesh;
  private readonly rightArm: THREE.Mesh;
  private readonly torsoPivot = new THREE.Group();
  private flailTime = 0;

  constructor() {
    const jacket = new THREE.MeshStandardMaterial({ color: CONFIG.visual.jacketColor, roughness: 0.75, flatShading: true });
    const boardMat = new THREE.MeshStandardMaterial({ color: CONFIG.visual.jacketColor, roughness: 0.4, flatShading: true });
    const helmetMat = new THREE.MeshStandardMaterial({ color: CONFIG.visual.helmetColor, roughness: 0.5, flatShading: true });
    const goggleMat = new THREE.MeshStandardMaterial({ color: CONFIG.visual.goggleColor, roughness: 0.2, metalness: 0.2, flatShading: true });
    const skinMat = new THREE.MeshStandardMaterial({ color: 0xf0c8a0, roughness: 0.8, flatShading: true });

    // Board: a flattened capsule gives cheap rounded nose/tail for free.
    const board = new THREE.Mesh(new THREE.CapsuleGeometry(0.24, 1.5, 3, 8), boardMat);
    board.rotation.x = Math.PI / 2;
    board.scale.set(1, 1, 0.55);
    board.position.y = 0.12;
    board.castShadow = true;
    this.boardTilt.add(board);

    // Legs: two bent (thigh + shin) capsule segments each, fixed athletic stance.
    const legGeoThigh = new THREE.CapsuleGeometry(0.11, 0.34, 2, 6);
    const legGeoShin = new THREE.CapsuleGeometry(0.1, 0.32, 2, 6);
    for (const side of [-1, 1]) {
      const thigh = new THREE.Mesh(legGeoThigh, jacket);
      thigh.position.set(side * 0.16, 0.62, 0.03 * side);
      thigh.rotation.z = side * 0.18;
      thigh.rotation.x = -0.35;
      thigh.castShadow = true;
      const shin = new THREE.Mesh(legGeoShin, jacket);
      shin.position.set(0, -0.32, 0.16);
      shin.rotation.x = 0.55;
      shin.castShadow = true;
      thigh.add(shin);
      this.character.add(thigh);
    }

    // Torso: sphere-ish, angled so the chest faces downhill (side stance).
    const torso = new THREE.Mesh(new THREE.SphereGeometry(0.3, 8, 6).scale(0.85, 1.15, 0.75), jacket);
    torso.position.y = 0.98;
    torso.castShadow = true;
    this.torsoPivot.position.y = 0;
    this.torsoPivot.add(torso);
    this.character.add(this.torsoPivot);

    // Arms: capsules pivoting from the shoulders so they can flail in the air.
    const armGeo = new THREE.CapsuleGeometry(0.08, 0.42, 2, 6);
    this.leftArm = new THREE.Mesh(armGeo, jacket);
    this.leftArm.position.set(-0.38, 1.05, 0.05);
    this.leftArm.rotation.z = 0.5;
    this.leftArm.castShadow = true;
    this.rightArm = new THREE.Mesh(armGeo, jacket);
    this.rightArm.position.set(0.38, 1.05, -0.05);
    this.rightArm.rotation.z = -0.5;
    this.rightArm.castShadow = true;
    this.character.add(this.leftArm, this.rightArm);

    // Helmet + goggle band.
    const helmet = new THREE.Mesh(new THREE.SphereGeometry(0.19, 10, 8), helmetMat);
    helmet.position.y = 1.42;
    helmet.castShadow = true;
    const goggles = new THREE.Mesh(new THREE.BoxGeometry(0.32, 0.09, 0.12), goggleMat);
    goggles.position.set(0, 1.4, 0.14);
    const face = new THREE.Mesh(new THREE.SphereGeometry(0.13, 8, 6), skinMat);
    face.position.set(0, 1.36, 0.1);
    this.character.add(helmet, goggles, face);

    this.boardTilt.add(this.character);
    this.root.add(this.boardTilt);
  }

  /**
   * @param position world-space board-center position (on the snow surface).
   * @param normal surface normal blended toward world-up while airborne (caller eases this).
   * @param yaw board heading around world Y, radians.
   * @param edgeAngle carve lean, radians (roll around the board's forward axis).
   * @param crouch 0 (upright) .. 1 (fully tucked).
   * @param airborne whether the rider is currently off the snow (drives arm flail).
   * @param grabAmount 0..1, pulls the torso into a grab pose.
   * @param dt seconds since last frame, used to animate the flail cycle.
   */
  update(
    position: THREE.Vector3,
    normal: THREE.Vector3,
    yaw: number,
    edgeAngle: number,
    crouch: number,
    airborne: boolean,
    grabAmount: number,
    dt: number,
  ): void {
    this.root.position.copy(position);
    const yawQuat = new THREE.Quaternion().setFromAxisAngle(UP, yaw);
    const tiltQuat = new THREE.Quaternion().setFromUnitVectors(UP, normal);
    this.root.quaternion.copy(tiltQuat).multiply(yawQuat);

    this.boardTilt.rotation.z = edgeAngle;

    const counterRotate = -edgeAngle * 0.4;
    this.character.rotation.z = counterRotate;
    this.character.rotation.x = crouch * 0.5;
    this.character.position.y = -crouch * 0.22;

    this.torsoPivot.rotation.x = -grabAmount * 0.6;

    if (airborne) {
      this.flailTime += dt;
      const flail = Math.sin(this.flailTime * 11);
      this.leftArm.rotation.x = flail * 0.9;
      this.rightArm.rotation.x = -flail * 0.9;
      this.leftArm.rotation.z = 0.5 + grabAmount * 0.8;
      this.rightArm.rotation.z = -0.5 - grabAmount * 0.8;
    } else {
      this.flailTime = 0;
      this.leftArm.rotation.x += (0 - this.leftArm.rotation.x) * 0.2;
      this.rightArm.rotation.x += (0 - this.rightArm.rotation.x) * 0.2;
      this.leftArm.rotation.z = 0.5;
      this.rightArm.rotation.z = -0.5;
    }
  }
}
