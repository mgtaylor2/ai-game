import * as THREE from 'three';
import { DEFAULT_TUNING, type KartTuning } from './controller';
import { buildKart, buildBike, type VehicleModel } from './models/vehicles';
import { Driver, KART_POSE, BIKE_POSE } from './models/driver';

export const KART_RADIUS = 1.4;
export type VehicleKind = 'kart' | 'bike';

/** Radians of front-wheel yaw at full lock. */
const MAX_STEER_ANGLE = 0.5;
/** How fast the visual steering catches up to input, per second. */
const STEER_EASE = 10;
/** Radians of body roll at full lock, opposing the turn like real weight transfer. */
const MAX_BODY_ROLL = 0.09;

// Scratch objects reused every frame in syncMesh() to avoid per-kart-per-frame allocation.
const AXIS_Y = new THREE.Vector3(0, 1, 0);
const AXIS_X = new THREE.Vector3(1, 0, 0);
const scratchYawQuat = new THREE.Quaternion();
const scratchPitchQuat = new THREE.Quaternion();

export class Kart {
  readonly mesh: THREE.Group;
  readonly position = new THREE.Vector3(0, 0, 0);

  /** Wraps the vehicle + driver so body roll can be applied without fighting the world yaw/pitch. */
  private readonly chassis = new THREE.Group();
  private vehicle: VehicleModel;
  private driver: Driver;
  private vehicleKind: VehicleKind = 'kart';
  private currentBodyColor = 0xe63946;
  private currentAccentColor = 0xffb703;
  private driverPaint = { suit: 0x2d7dd2, helmet: 0xf9c74f };
  /** -1..1, eased toward the raw steering input so the wheels and driver don't snap. */
  private steerVisual = 0;

  /** Karts currently touching this one, so collision damping applies once per contact, not every frame. */
  private readonly touchingKarts = new Set<Kart>();
  heading = 0; // radians; 0 = facing +Z
  /** Nose-up/down tilt matching the track's local slope; set by updateKart, applied in syncMesh. */
  pitch = 0;
  speed = 0; // units/sec; positive = forward, negative = reverse
  tuning: KartTuning = DEFAULT_TUNING;
  /** Seconds this kart has been near-stationary; drives the stuck-recovery nudge in updateKart. */
  stuckTimer = 0;

  constructor() {
    this.mesh = new THREE.Group();
    this.mesh.add(this.chassis);
    const built = this.build();
    this.vehicle = built.vehicle;
    this.driver = built.driver;
    this.syncMesh();
  }

  /** Builds the current vehicle plus a driver posed to fit it. */
  private build(): { vehicle: VehicleModel; driver: Driver } {
    const paint = { body: this.currentBodyColor, accent: this.currentAccentColor };
    const vehicle = this.vehicleKind === 'bike' ? buildBike(paint) : buildKart(paint);

    // The driver sits at the vehicle's seat point and reaches for its grips. The reach is divided by
    // the driver's scale so it arrives in the driver's *own* local units -- passing raw vehicle-space
    // distances into a scaled rig aims the arms at the wrong place.
    const gripRelative = vehicle.wheelGrip.clone().sub(vehicle.seat).divideScalar(vehicle.driverScale);
    const driver = new Driver(this.driverPaint, gripRelative, vehicle.kind === 'bike' ? BIKE_POSE : KART_POSE);
    driver.group.position.copy(vehicle.seat);
    driver.group.scale.setScalar(vehicle.driverScale);

    this.chassis.add(vehicle.group);
    this.chassis.add(driver.group);
    return { vehicle, driver };
  }

  private rebuild(): void {
    this.chassis.remove(this.vehicle.group);
    this.chassis.remove(this.driver.group);
    const built = this.build();
    this.vehicle = built.vehicle;
    this.driver = built.driver;
  }

  /** Applies the player-selected vehicle paint. Recolours live materials -- no geometry rebuild. */
  setPaint(color: number, accent: number): void {
    this.currentBodyColor = color;
    this.currentAccentColor = accent;
    for (const material of this.vehicle.bodyMaterials) material.color.setHex(color);
    for (const material of this.vehicle.accentMaterials) material.color.setHex(accent);
  }

  /** Recolours the driver's suit and helmet for the selected character. */
  setDriverPaint(suitColor: number, helmetColor: number): void {
    this.driverPaint = { suit: suitColor, helmet: helmetColor };
    this.driver.setPaint(this.driverPaint);
  }

  /** Applies a physics profile derived from the selected character + vehicle. */
  setTuning(tuning: KartTuning): void {
    this.tuning = tuning;
  }

  isTouching(other: Kart): boolean {
    return this.touchingKarts.has(other);
  }

  setTouching(other: Kart, touching: boolean): void {
    if (touching) this.touchingKarts.add(other);
    else this.touchingKarts.delete(other);
  }

  /** Swaps the kart/bike geometry in place, preserving current paint and driver colours. */
  setVehicleType(kind: VehicleKind): void {
    if (kind === this.vehicleKind) return;
    this.vehicleKind = kind;
    this.rebuild();
  }

  /** Local-space points where exhaust/boost effects should emit, in world space. */
  getExhaustWorldPositions(target: THREE.Vector3[]): THREE.Vector3[] {
    target.length = 0;
    for (const local of this.vehicle.exhausts) {
      target.push(this.chassis.localToWorld(local.clone()));
    }
    return target;
  }

  /**
   * Spins the wheels from road speed, turns the steered wheels, rolls the chassis into the corner and
   * drives the driver's pose.
   *
   * @param steerInput -1..1 raw steering input for this frame.
   */
  animate(dt: number, steerInput: number): void {
    this.steerVisual += (steerInput - this.steerVisual) * Math.min(1, dt * STEER_EASE);

    // Wheel spin is derived from road speed so it always matches the ground, and reverses in reverse.
    const spin = (this.speed / 0.35) * dt;
    for (const wheel of this.vehicle.wheels) wheel.rotation.x += spin;

    const steerAngle = this.steerVisual * MAX_STEER_ANGLE;
    for (const steerable of this.vehicle.steerables) steerable.rotation.y = steerAngle;

    // Roll away from the turn (kart) or lean into it (bike) -- opposite signs because a kart's mass
    // transfers outward while a motorcycle counter-steers and leans in.
    const speed01 = Math.min(1, Math.abs(this.speed) / Math.max(0.001, this.tuning.maxSpeed));
    const rollDirection = this.vehicle.kind === 'bike' ? 1 : -1;
    const leanScale = this.vehicle.kind === 'bike' ? 3.2 : 1;
    this.chassis.rotation.z = this.steerVisual * MAX_BODY_ROLL * rollDirection * leanScale * speed01;

    this.driver.update(dt, this.steerVisual, speed01);
  }

  /** Yaw applied in world space, then pitch applied in the kart's own (now-yawed) local space,
   *  so the nose tilts up/down along whichever direction the kart is actually facing. */
  syncMesh(): void {
    this.mesh.position.copy(this.position);
    scratchYawQuat.setFromAxisAngle(AXIS_Y, this.heading);
    scratchPitchQuat.setFromAxisAngle(AXIS_X, this.pitch);
    this.mesh.quaternion.copy(scratchYawQuat).multiply(scratchPitchQuat);
  }

  reset(x: number, z: number, heading: number, y = 0): void {
    this.position.set(x, y, z);
    this.heading = heading;
    this.pitch = 0;
    this.speed = 0;
    this.stuckTimer = 0;
    this.steerVisual = 0;
    this.chassis.rotation.z = 0;
    this.syncMesh();
  }
}
