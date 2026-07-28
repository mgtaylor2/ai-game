import * as THREE from 'three';
import { CONFIG } from './config';
import { Mountain } from './terrain';
import { noise3Octave } from './rng';

export interface ChaseCameraTarget {
  position: THREE.Vector3;
  z: number;
  yaw: number;
  edgeAngle: number;
  speed01: number;
  boosting: boolean;
}

const WORLD_UP = new THREE.Vector3(0, 1, 0);

/** Spring-damper chase camera: soft-follows the rider, leashed so it can never drift far, with speed-reactive FOV and carve roll. */
export class ChaseCamera {
  readonly camera: THREE.PerspectiveCamera;
  private readonly velocity = new THREE.Vector3();
  private readonly desired = new THREE.Vector3();
  private readonly lookTarget = new THREE.Vector3();
  private shakeAmount = 0;
  private shakeTime = 0;
  private menuAngle = 0;

  constructor(aspect: number) {
    this.camera = new THREE.PerspectiveCamera(CONFIG.camera.fovMin, aspect, 0.1, 3000);
  }

  snapTo(target: ChaseCameraTarget): void {
    this.computeDesired(target);
    this.camera.position.copy(this.desired);
    this.velocity.set(0, 0, 0);
  }

  triggerShake(amount: number): void {
    this.shakeAmount = Math.min(1.5, this.shakeAmount + amount);
  }

  private computeDesired(target: ChaseCameraTarget): void {
    const forward = new THREE.Vector3(Math.sin(target.yaw), 0, Math.cos(target.yaw));
    this.desired.copy(target.position).addScaledVector(forward, -CONFIG.camera.followDistance);
    this.desired.y += CONFIG.camera.heightOffset;
  }

  update(dt: number, target: ChaseCameraTarget, mountain: Mountain): void {
    this.computeDesired(target);

    const c = CONFIG.camera;
    const stiffness = c.stiffness;
    const dampingCoeff = 2 * c.damping * Math.sqrt(stiffness);
    const toDesired = this.desired.clone().sub(this.camera.position);
    const accel = toDesired.multiplyScalar(stiffness).addScaledVector(this.velocity, -dampingCoeff);
    this.velocity.addScaledVector(accel, dt);
    this.camera.position.addScaledVector(this.velocity, dt);

    const offset = this.camera.position.clone().sub(this.desired);
    if (offset.length() > c.leash) {
      offset.setLength(c.leash);
      this.camera.position.copy(this.desired).add(offset);
    }

    const groundHeight = mountain.heightAt(this.camera.position.x, this.camera.position.z);
    const minY = groundHeight + c.minHeightAboveTerrain;
    if (this.camera.position.y < minY) this.camera.position.y = minY;

    this.shakeTime += dt;
    this.shakeAmount *= Math.exp(-dt * 4);
    if (this.shakeAmount > 0.001) {
      const s = this.shakeAmount;
      this.camera.position.x += noise3Octave(this.shakeTime * 37, 0) * s * 0.35;
      this.camera.position.y += noise3Octave(this.shakeTime * 41, 11) * s * 0.25;
      this.camera.position.z += noise3Octave(this.shakeTime * 29, 23) * s * 0.35;
    }

    const forward = new THREE.Vector3(Math.sin(target.yaw), 0, Math.cos(target.yaw));
    const riderAhead = target.position.clone().addScaledVector(forward, c.lookAheadRider);
    const splineZ = target.z + c.lookAheadSpline;
    const splinePoint = new THREE.Vector3(mountain.centerXAt(splineZ), mountain.centerYAt(splineZ) + 1, splineZ);
    this.lookTarget.copy(riderAhead).lerp(splinePoint, c.lookAheadSplineBlend);

    const rollRad = THREE.MathUtils.degToRad(c.maxRollDeg) * THREE.MathUtils.clamp(target.edgeAngle / CONFIG.physics.maxEdgeAngle, -1, 1);
    const up = WORLD_UP.clone().applyAxisAngle(forward, -rollRad);
    this.camera.up.copy(up);
    this.camera.lookAt(this.lookTarget);

    const fovBase = THREE.MathUtils.lerp(c.fovMin, c.fovMax, target.speed01);
    const fov = fovBase + (target.boosting ? CONFIG.pickups.boostFovKick : 0);
    if (Math.abs(this.camera.fov - fov) > 0.01) {
      this.camera.fov = fov;
      this.camera.updateProjectionMatrix();
    }
  }

  /** Slow orbit around the rider, used before a run starts. */
  updateMenuOrbit(dt: number, riderPosition: THREE.Vector3): void {
    this.menuAngle += dt * 0.15;
    const radius = 6.5;
    this.camera.position.set(
      riderPosition.x + Math.sin(this.menuAngle) * radius,
      riderPosition.y + 2.4,
      riderPosition.z + Math.cos(this.menuAngle) * radius,
    );
    this.camera.up.copy(WORLD_UP);
    this.camera.lookAt(riderPosition.x, riderPosition.y + 1, riderPosition.z);
  }

  setAspect(aspect: number): void {
    this.camera.aspect = aspect;
    this.camera.updateProjectionMatrix();
  }
}
