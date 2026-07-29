import * as THREE from 'three';
import { flat, tintable, part, slab, enableShadows, PALETTE } from './materials';

export interface DriverPaint {
  suit: number;
  helmet: number;
}

const HELMET_TILT_INTO_TURN = 0.18;
const ARM_STEER_SWING = 0.34;
const TORSO_LEAN_INTO_TURN = 0.1;

/**
 * Joint angles for one seating position, in radians.
 *
 * Named and supplied per vehicle rather than switched on a boolean: a kart driver and a superbike
 * rider differ in every joint, not on one axis, and hiding that behind `upright ? a : b` made the two
 * poses impossible to tune independently -- the bike rider ended up with its legs dangling off the
 * side while the kart looked fine.
 */
export interface DriverPose {
  /** Positive pitches the chest forward (bike); negative reclines it (kart). */
  torsoPitch: number;
  /** Negative swings the thigh up and forward from the hip. */
  hipPitch: number;
  /** Positive bends the shin back down from the knee. */
  kneeBend: number;
  /** How far the knees splay outward, around a tank or a steering column. */
  legSplay: number;
  /** Extra elbow bend on top of the shoulder aim. */
  elbowBend: number;
}

/** Reclined, legs stretched forward to the pedals, arms up to a near-vertical wheel. */
export const KART_POSE: DriverPose = {
  torsoPitch: -0.2,
  hipPitch: -1.5,
  kneeBend: 1.15,
  legSplay: 0.12,
  elbowBend: 0.75,
};

/** Hunched over the tank, knees tucked up and gripping it, feet back on the pegs. */
export const BIKE_POSE: DriverPose = {
  torsoPitch: 0.46,
  hipPitch: -0.78,
  kneeBend: 2.05,
  // Wider than the kart's: the knees have to end up outside the fuel tank, or the whole lower half of
  // the rider disappears inside the bodywork and they read as a torso stuck on the seat.
  legSplay: 0.46,
  elbowBend: 0.5,
};

/**
 * A driver actually posed for sitting in a vehicle.
 *
 * The model this replaces was a platformer character whose legs were single rigid pieces pivoting at
 * the hip -- with no knee it could only stand or swing straight, so the old code angled the whole leg
 * forward and left a comment admitting it read as "standing on the roof". Here each leg is a real
 * two-segment chain (thigh forward and level, shin down to the pedals) and each arm is a two-segment
 * chain reaching to the wheel, which is what makes the seated pose look intentional.
 */
export class Driver {
  readonly group = new THREE.Group();

  private readonly suitMaterial: THREE.MeshStandardMaterial;
  private readonly helmetMaterial: THREE.MeshStandardMaterial;
  private readonly torso = new THREE.Group();
  private readonly head = new THREE.Group();
  private readonly shoulders: THREE.Group[] = [];
  private steerAmount = 0;
  private bobPhase = 0;

  /**
   * @param paint suit and helmet colours for this character.
   * @param gripRelative where the hands should reach, measured from the driver's own origin (hips).
   * @param pose the seating position for this vehicle (see KART_POSE / BIKE_POSE).
   */
  constructor(paint: DriverPaint, gripRelative: THREE.Vector3, pose: DriverPose) {
    this.suitMaterial = tintable(paint.suit, 0.7);
    this.helmetMaterial = tintable(paint.helmet, 0.35);

    const glove = PALETTE.darkTrim();
    const boot = PALETTE.darkTrim();

    // ---- Torso ----
    this.torso.rotation.x = pose.torsoPitch;
    this.torso.add(part(slab(0.46, 0.56, 0.32, 0.14), this.suitMaterial, [0, 0.28, 0]));
    // Chest zip / racing stripe.
    this.torso.add(part(slab(0.1, 0.44, 0.06, 0.02), flat(0xf2f4f8, 0.6), [0, 0.3, 0.16]));
    // Shoulders.
    for (const side of [-1, 1]) {
      this.torso.add(part(new THREE.SphereGeometry(0.13, 8, 6), this.suitMaterial, [side * 0.24, 0.5, 0]));
    }

    // ---- Head + helmet ----
    this.head.position.set(0, 0.66, 0.02);
    const helmetShell = new THREE.Mesh(new THREE.SphereGeometry(0.21, 12, 10), this.helmetMaterial);
    helmetShell.scale.set(1, 1.05, 1.08);
    this.head.add(helmetShell);
    // Visor: a dark band wrapped around the front of the shell.
    const visor = new THREE.Mesh(new THREE.SphereGeometry(0.212, 12, 8, Math.PI * 0.62, Math.PI * 0.76, Math.PI * 0.34, Math.PI * 0.3), PALETTE.glass());
    visor.scale.set(1, 1.05, 1.08);
    this.head.add(visor);
    // Centre stripe over the crown, in the suit colour so character identity reads from behind.
    this.head.add(part(slab(0.07, 0.06, 0.42, 0.02), this.suitMaterial, [0, 0.15, -0.02]));
    // Chin bar.
    this.head.add(part(slab(0.26, 0.1, 0.12, 0.04), this.helmetMaterial, [0, -0.13, 0.14]));
    this.torso.add(this.head);

    // ---- Arms: shoulder -> elbow -> hand on the wheel ----
    // The upper-arm pitch is aimed at the actual grip point rather than hard-coded, so a vehicle with
    // a higher or further-forward wheel automatically gets a sensible reach. The elbow bend below is
    // then a fixed follow-through -- at this scale that's indistinguishable from a real two-bone solve.
    const SHOULDER_HEIGHT = 0.5;
    // Angle of the shoulder-to-grip vector measured from straight down, which is the arm's rest
    // direction. Purely directional, so it stays correct whatever the rig is scaled to.
    const shoulderPitch = -Math.atan2(gripRelative.z, SHOULDER_HEIGHT - gripRelative.y);

    for (const side of [-1, 1]) {
      const shoulder = new THREE.Group();
      shoulder.position.set(side * 0.24, SHOULDER_HEIGHT, 0);
      shoulder.rotation.x = shoulderPitch;
      shoulder.rotation.z = side * 0.28;

      const upperArm = part(new THREE.CapsuleGeometry(0.075, 0.24, 3, 8), this.suitMaterial, [0, -0.16, 0]);
      shoulder.add(upperArm);

      const elbow = new THREE.Group();
      elbow.position.set(0, -0.3, 0);
      // Bend forward at the elbow so the forearm runs out to the grips.
      elbow.rotation.x = pose.elbowBend;
      const forearm = part(new THREE.CapsuleGeometry(0.065, 0.22, 3, 8), this.suitMaterial, [0, -0.15, 0]);
      elbow.add(forearm);
      elbow.add(part(new THREE.SphereGeometry(0.08, 8, 6), glove, [0, -0.29, 0]));
      shoulder.add(elbow);

      this.torso.add(shoulder);
      this.shoulders.push(shoulder);
    }

    // ---- Legs: hip -> knee -> foot, thigh forward and shin down ----
    for (const side of [-1, 1]) {
      const hip = new THREE.Group();
      hip.position.set(side * 0.15, 0.02, 0.04);
      // Thigh runs forward, very slightly raised -- this is the joint the old model simply didn't have.
      hip.rotation.x = pose.hipPitch;
      hip.rotation.z = side * pose.legSplay;
      hip.add(part(new THREE.CapsuleGeometry(0.1, 0.3, 3, 8), this.suitMaterial, [0, -0.2, 0]));

      const knee = new THREE.Group();
      knee.position.set(0, -0.38, 0);
      // Shin drops back down toward the pedals.
      knee.rotation.x = pose.kneeBend;
      knee.add(part(new THREE.CapsuleGeometry(0.085, 0.28, 3, 8), this.suitMaterial, [0, -0.18, 0]));
      knee.add(part(slab(0.16, 0.1, 0.26, 0.04), boot, [0, -0.34, 0.06]));
      hip.add(knee);

      this.group.add(hip);
    }

    this.group.add(this.torso);
    enableShadows(this.group, false);
  }

  setPaint(paint: DriverPaint): void {
    this.suitMaterial.color.setHex(paint.suit);
    this.helmetMaterial.color.setHex(paint.helmet);
  }

  /**
   * @param steer -1..1 steering input; the driver counter-leans and works the wheel.
   * @param speed01 0..1 of top speed, driving a subtle vibration so the model isn't statue-still.
   */
  update(dt: number, steer: number, speed01: number): void {
    this.steerAmount += (steer - this.steerAmount) * Math.min(1, dt * 9);

    // Arms mirror the wheel: inside arm pulls back, outside arm pushes forward.
    for (let i = 0; i < this.shoulders.length; i++) {
      const side = i === 0 ? -1 : 1;
      this.shoulders[i].rotation.y = this.steerAmount * ARM_STEER_SWING * side;
    }

    // Lean and look into the corner.
    this.torso.rotation.z = -this.steerAmount * TORSO_LEAN_INTO_TURN;
    this.head.rotation.y = this.steerAmount * HELMET_TILT_INTO_TURN;
    this.head.rotation.z = -this.steerAmount * HELMET_TILT_INTO_TURN * 0.5;

    // Engine vibration, scaled by speed and kept tiny so it never reads as jitter.
    this.bobPhase += dt * (14 + speed01 * 26);
    this.group.position.y = Math.sin(this.bobPhase) * 0.006 * (0.3 + speed01);
  }
}
