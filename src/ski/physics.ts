import * as THREE from 'three';
import { CONFIG } from './config';
import { Mountain } from './terrain';
import type { SkiInputState } from './input';
import { checkTakeoff, classifyLanding, autoTrackTarget, easeAngleTowards } from './air';
import { seededRandomFor, hash2i } from './rng';

const RAD2DEG = 180 / Math.PI;
/** Reused by `getTumbleRotation`, which is called every frame during a wipeout. */
const TUMBLE_QUAT = new THREE.Quaternion();

export type SkiEvent =
  | { type: 'takeoff' }
  | { type: 'landing'; clean: boolean; switchLanding: boolean; spinDeg: number; direction: 'FS' | 'BS'; grabbed: boolean; bigAir: boolean; airTime: number }
  | { type: 'wipeout' }
  | { type: 'shieldSaved' }
  | { type: 'respawn' };

/**
 * Point-mass carve/air simulation over the analytic height field. No physics engine: gravity, grip,
 * edge angle, and drag are all hand-rolled scalar/vector math driven by CONFIG.
 */
export class SkiPhysics {
  x = 0;
  y = 0;
  z = 0;
  vx = 0;
  vz = 0;
  verticalVelocity = 0;
  yaw = 0;
  edgeAngle = 0;
  grounded = true;
  wipedOut = false;
  runEnded = false;
  airTime = 0;
  spinAccum = 0;
  grabAmount = 0;
  grabbedDuringAir = false;
  shielded = false;
  boostTimer = 0;
  boundaryWarning = 0;
  lateralSlipSpeed = 0;
  surfaceNormal = new THREE.Vector3(0, 1, 0);

  private readonly mountain: Mountain;
  private tuckHeld = false;
  private tumbleTimer = 0;
  private tumbleAxis = new THREE.Vector3(0, 1, 0);
  private stallTimer = 0;
  private collisionGraceTimer = 0;
  private events: SkiEvent[] = [];

  constructor(mountain: Mountain, startZ: number) {
    this.mountain = mountain;
    this.z = startZ;
    this.x = mountain.centerXAt(startZ);
    this.y = mountain.heightAt(this.x, this.z);
    this.vz = CONFIG.physics.floorSpeedStart;
  }

  get speed(): number {
    return Math.hypot(this.vx, this.vz);
  }

  get airborne(): boolean {
    return !this.grounded;
  }

  /**
   * True only during the brief post-respawn/post-shield window where contacts are ignored outright.
   * Deliberately does NOT include `shielded`: a shield must still *register* the hit so `crash()` can
   * consume it, so callers should always call `crash()` and let it decide rather than gating on this.
   */
  get inCollisionGrace(): boolean {
    return this.collisionGraceTimer > 0;
  }

  get tucking(): boolean {
    return this.tuckHeld;
  }

  grantShield(): void {
    this.shielded = true;
  }

  activateBoost(): void {
    this.boostTimer = CONFIG.pickups.boostDuration;
  }

  /** Manual ollie: Space pops the board off the ground at any time while grounded, independent of terrain-driven kicker takeoff. */
  manualJump(): void {
    if (!this.grounded || this.wipedOut) return;
    this.grounded = false;
    this.verticalVelocity = CONFIG.air.jumpImpulse;
    this.airTime = 0;
    this.spinAccum = 0;
    this.grabbedDuringAir = false;
    this.events.push({ type: 'takeoff' });
  }

  drainEvents(): SkiEvent[] {
    const drained = this.events;
    this.events = [];
    return drained;
  }

  respawn(): void {
    this.x = this.mountain.centerXAt(this.z);
    this.y = this.mountain.heightAt(this.x, this.z);
    this.vx = 0;
    this.vz = CONFIG.physics.floorSpeedStart;
    this.verticalVelocity = 0;
    this.edgeAngle = 0;
    this.yaw = Math.atan2(this.mountain.dirAt(this.z).x, this.mountain.dirAt(this.z).z);
    this.grounded = true;
    this.wipedOut = false;
    this.tumbleTimer = 0;
    this.stallTimer = 0;
    this.collisionGraceTimer = CONFIG.physics.respawnCollisionGrace;
    this.events.push({ type: 'respawn' });
  }

  /** Called externally on obstacle contact. Shielded hits are absorbed; otherwise the run ends after a tumble. */
  crash(): void {
    if (this.wipedOut || this.inCollisionGrace) return;
    if (this.shielded) {
      this.shielded = false;
      // Same grace as a respawn, so the obstacle that just consumed the shield can't immediately re-hit
      // on the next frame while the rider is still inside its radius.
      this.collisionGraceTimer = CONFIG.physics.respawnCollisionGrace;
      this.events.push({ type: 'shieldSaved' });
      return;
    }
    this.wipedOut = true;
    this.grounded = true;
    this.tumbleTimer = CONFIG.air.wipeoutTumbleTime;
    // Seeded off the crash location so the same wipeout replays identically.
    const rand = seededRandomFor(CONFIG.seed, hash2i(Math.round(this.x * 32), Math.round(this.z * 32)));
    this.tumbleAxis.set(rand() * 2 - 1, rand() * 2 - 1, rand() * 2 - 1).normalize();
    this.vx *= CONFIG.air.wipeoutSpinFactor;
    this.vz *= CONFIG.air.wipeoutSpinFactor;
    this.events.push({ type: 'wipeout' });
  }

  getTumbleRotation(): THREE.Quaternion | null {
    if (!this.wipedOut) return null;
    const elapsed = CONFIG.air.wipeoutTumbleTime - this.tumbleTimer;
    return TUMBLE_QUAT.setFromAxisAngle(this.tumbleAxis, elapsed * 6);
  }

  update(dt: number, input: SkiInputState, mountain: Mountain): void {
    if (this.boostTimer > 0) this.boostTimer = Math.max(0, this.boostTimer - dt);
    if (this.collisionGraceTimer > 0) this.collisionGraceTimer = Math.max(0, this.collisionGraceTimer - dt);

    if (this.wipedOut) {
      this.updateWipeout(dt);
      return;
    }

    this.tuckHeld = input.tuck;
    this.grabAmount += ((input.grab ? 1 : 0) - this.grabAmount) * Math.min(1, dt * 10);
    if (input.grab && this.airborne) this.grabbedDuringAir = true;

    if (this.grounded) this.updateGrounded(dt, input, mountain);
    else this.updateAirborne(dt, input, mountain);
  }

  private updateGrounded(dt: number, input: SkiInputState, mountain: Mountain): void {
    const p = CONFIG.physics;
    const target = input.steer * p.maxEdgeAngle;
    this.edgeAngle += (target - this.edgeAngle) * Math.min(1, dt * p.edgeEase);

    mountain.heightAndNormalInto(this.x, this.z, this.surfaceNormal);
    const normal = this.surfaceNormal;

    // normal = normalize(-dH/dx, 1, -dH/dz), so dH/dx = -normal.x/normal.y (and likewise for z).
    // Gravity accelerates *downhill*, i.e. opposite the height gradient: accel = -g * grad(H).
    const dHdx = -(normal.x / Math.max(0.0001, normal.y));
    const dHdz = -(normal.z / Math.max(0.0001, normal.y));
    const gravityAccelX = -p.gravity * dHdx;
    const gravityAccelZ = -p.gravity * dHdz;

    const boardForward = { x: Math.sin(this.yaw), z: Math.cos(this.yaw) };
    const boardLateral = { x: boardForward.z, z: -boardForward.x };

    let vForward = this.vx * boardForward.x + this.vz * boardForward.z;
    let vLateral = this.vx * boardLateral.x + this.vz * boardLateral.z;

    const edgeFactor = Math.abs(this.edgeAngle) / p.maxEdgeAngle;
    const grip = p.gripDrifty + (p.gripCarving - p.gripDrifty) * edgeFactor;
    vLateral *= Math.exp(-grip * dt);
    this.lateralSlipSpeed = Math.abs(vLateral);

    const progress = Math.min(1, this.z / p.speedRampDistance);
    const rampMultiplier = 1 + p.speedRampImprovement * progress;
    const dragEase = 1 - p.speedRampImprovement * 0.5 * progress;

    const forwardGravityAccel = gravityAccelX * boardForward.x + gravityAccelZ * boardForward.z;
    vForward += forwardGravityAccel * dt;
    if (this.boostTimer > 0) vForward += CONFIG.pickups.boostAccel * dt;

    const tuckFactor = this.tuckHeld ? p.tuckDragFactor : 1;
    const dragDecel = (p.friction + p.drag * vForward * vForward) * tuckFactor * dragEase;
    vForward -= Math.sign(vForward) * dragDecel * dt;
    vForward -= p.carveSpeedScrub * edgeFactor * vForward * dt;

    const floorProgress = Math.min(1, this.z / p.floorRampDistance);
    const floor = p.floorSpeedStart + (p.floorSpeedEnd - p.floorSpeedStart) * floorProgress;
    if (vForward < floor) vForward = floor;
    const cap = p.maxSpeed * rampMultiplier;
    if (vForward > cap) vForward = cap;

    const authority = Math.min(1, this.speed / p.yawSpeedFull);
    const yawRateCap = p.lateralAccelCapBase / Math.max(1, vForward);
    let yawRate = Math.sin(this.edgeAngle) * p.yawEdgeGain * authority;
    yawRate = Math.sign(yawRate) * Math.min(Math.abs(yawRate), yawRateCap);
    this.yaw += yawRate * dt;

    const lateralDist = mountain.lateralDistanceAt(this.x, this.z);
    const absLateral = Math.abs(lateralDist);
    const assist = smoothstep(p.corridorAssistInner, p.corridorAssistOuter, absLateral);
    if (assist > 0) {
      const dir = mountain.dirAt(this.z);
      const trackYaw = Math.atan2(dir.x, dir.z);
      this.yaw = easeAngleTowards(this.yaw, trackYaw, assist * 2, dt);
    }

    this.boundaryWarning = smoothstep(p.boundaryDistance, p.boundaryDistance + 8, absLateral);
    if (absLateral > p.boundaryDistance) {
      const excess = absLateral - p.boundaryDistance;
      const pushAccel = p.boundaryPushStrength * excess * excess * 0.02 * -Math.sign(lateralDist);
      vLateral += pushAccel * dt;
    }

    this.vx = vForward * boardForward.x + vLateral * boardLateral.x;
    this.vz = vForward * boardForward.z + vLateral * boardLateral.z;

    const nextX = this.x + this.vx * dt;
    const nextZ = this.z + this.vz * dt;
    const currentHeight = mountain.heightAt(this.x, this.z);
    const nextHeight = mountain.heightAt(nextX, nextZ);
    const surfaceVerticalVelocity = (nextHeight - currentHeight) / dt;

    const { takeoff, verticalVelocity } = checkTakeoff(this.verticalVelocity, surfaceVerticalVelocity, dt);
    this.verticalVelocity = surfaceVerticalVelocity;
    this.x = nextX;
    this.z = nextZ;

    if (takeoff) {
      this.grounded = false;
      this.verticalVelocity = verticalVelocity;
      this.y = currentHeight;
      this.airTime = 0;
      this.spinAccum = 0;
      this.grabbedDuringAir = false;
      this.events.push({ type: 'takeoff' });
    } else {
      this.y = nextHeight;
    }

    if (this.speed < p.stallSpeed) {
      this.stallTimer += dt;
      if (this.stallTimer >= p.stallTime) {
        this.respawn();
      }
    } else {
      this.stallTimer = 0;
    }
  }

  private updateAirborne(dt: number, input: SkiInputState, mountain: Mountain): void {
    const a = CONFIG.air;
    this.airTime += dt;

    if (input.steer !== 0) {
      const deltaYaw = a.airTurnRate * input.steer * dt;
      this.yaw += deltaYaw;
      const cos = Math.cos(deltaYaw);
      const sin = Math.sin(deltaYaw);
      const vx = this.vx * cos + this.vz * sin;
      const vz = -this.vx * sin + this.vz * cos;
      this.vx = vx;
      this.vz = vz;
    }

    if (input.spin !== 0) {
      const authority = Math.min(1, this.airTime / a.spinRampTime);
      const delta = a.spinRate * authority * input.spin * dt;
      this.yaw += delta;
      this.spinAccum += delta;
    } else {
      const flightHeading = Math.atan2(this.vx, this.vz);
      const target = autoTrackTarget(this.yaw, flightHeading);
      this.yaw = easeAngleTowards(this.yaw, target, 3, dt);
    }

    this.verticalVelocity -= CONFIG.physics.gravity * dt;
    this.x += this.vx * dt;
    this.z += this.vz * dt;
    this.y += this.verticalVelocity * dt;

    const ground = mountain.heightAt(this.x, this.z);
    if (this.y <= ground) {
      this.land(ground, mountain);
    }
  }

  private land(ground: number, mountain: Mountain): void {
    this.y = ground;
    this.grounded = true;
    mountain.heightAndNormalInto(this.x, this.z, this.surfaceNormal);

    const travelHeading = Math.atan2(this.vx, this.vz);
    const { clean, switchLanding } = classifyLanding(this.yaw, travelHeading);
    const spinDeg = Math.abs(this.spinAccum) * RAD2DEG;
    const bigAir = this.airTime >= CONFIG.air.bigAirTime && spinDeg < 10;

    if (clean) {
      this.yaw = switchLanding ? travelHeading + Math.PI : travelHeading;
      this.events.push({
        type: 'landing',
        clean: true,
        switchLanding,
        spinDeg,
        direction: this.spinAccum >= 0 ? 'FS' : 'BS',
        grabbed: this.grabbedDuringAir,
        bigAir,
        airTime: this.airTime,
      });
      this.verticalVelocity = 0;
    } else {
      this.events.push({
        type: 'landing',
        clean: false,
        switchLanding: false,
        spinDeg,
        direction: this.spinAccum >= 0 ? 'FS' : 'BS',
        grabbed: this.grabbedDuringAir,
        bigAir: false,
        airTime: this.airTime,
      });
      this.crash();
    }
  }

  private updateWipeout(dt: number): void {
    this.x += this.vx * dt;
    this.z += this.vz * dt;
    this.y = this.mountain.heightAt(this.x, this.z);
    const decel = CONFIG.physics.friction * 2;
    this.vx -= Math.sign(this.vx) * decel * dt;
    this.vz = Math.max(0, this.vz - decel * dt);

    this.tumbleTimer -= dt;
    if (this.tumbleTimer <= 0) {
      this.runEnded = true;
    }
  }
}

function smoothstep(edge0: number, edge1: number, x: number): number {
  const t = Math.min(1, Math.max(0, (x - edge0) / (edge1 - edge0)));
  return t * t * (3 - 2 * t);
}
