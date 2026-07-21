import * as THREE from 'three';
import { DEFAULT_TUNING, type KartTuning } from './controller';
import { createToonMaterial, addOutline } from '../game/toon';
import { getResolvedModel, cloneModel, nearestTruckKey, type LoadedModel } from '../game/assets';

export const KART_RADIUS = 1.4;
export type VehicleKind = 'kart' | 'bike';

// Scratch objects reused every frame in syncMesh() to avoid per-kart-per-frame allocation.
const AXIS_Y = new THREE.Vector3(0, 1, 0);
const AXIS_X = new THREE.Vector3(1, 0, 0);
const scratchYawQuat = new THREE.Quaternion();
const scratchPitchQuat = new THREE.Quaternion();

interface VehicleParts {
  group: THREE.Group;
  wheels: THREE.Object3D[];
}

/** Swaps every mesh's material for a toon-shaded one using the same texture, for visual consistency with the rest of the scene. */
function applyToonShadingToModel(root: THREE.Object3D): void {
  root.traverse((child) => {
    if (!(child instanceof THREE.Mesh)) return;
    const source = child.material as THREE.MeshStandardMaterial;
    child.material = createToonMaterial(0xffffff, source?.map ?? undefined);
    child.castShadow = true;
    child.receiveShadow = true;
  });
}

export class Kart {
  readonly mesh: THREE.Group;
  readonly position = new THREE.Vector3(0, 0, 0);
  private readonly riderGroup: THREE.Group;
  private readonly riderMaterials: THREE.MeshToonMaterial[] = [];
  private riderMixer: THREE.AnimationMixer | null = null;
  private riderLegLeft: THREE.Object3D | undefined;
  private riderLegRight: THREE.Object3D | undefined;
  private riderArmLeft: THREE.Object3D | undefined;
  private riderArmRight: THREE.Object3D | undefined;
  private vehicleGroup: THREE.Group;
  private vehicleKind: VehicleKind = 'kart';
  private currentBodyColor = 0xe63946;
  private currentAccentColor = 0xffb703;
  private wheels: THREE.Object3D[] = [];
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
    this.riderGroup = this.buildRider();
    const parts = this.buildVehicle();
    this.vehicleGroup = parts.group;
    this.wheels = parts.wheels;
    this.mesh.add(this.vehicleGroup);
    this.mesh.add(this.riderGroup);
    this.syncMesh();
  }

  /** Applies the player-selected vehicle paint. Real vehicle models only exist in a few
   *  fixed colours, so this rebuilds the vehicle picking the closest match. */
  setPaint(color: number, accent: number): void {
    this.currentBodyColor = color;
    this.currentAccentColor = accent;
    this.rebuildVehicle();
  }

  /** Recolours the simple rider and helmet used by the character picker (procedural rider only). */
  setDriverPaint(suitColor: number, helmetColor: number): void {
    this.riderMaterials[0]?.color.setHex(suitColor);
    this.riderMaterials[1]?.color.setHex(helmetColor);
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

  /** Swaps the kart/bike geometry in place, preserving current paint and the rider. */
  setVehicleType(kind: VehicleKind): void {
    if (kind === this.vehicleKind) return;
    this.vehicleKind = kind;
    this.rebuildVehicle();
  }

  private rebuildVehicle(): void {
    this.mesh.remove(this.vehicleGroup);
    const parts = this.buildVehicle();
    this.vehicleGroup = parts.group;
    this.wheels = parts.wheels;
    this.mesh.add(this.vehicleGroup);
    this.mesh.add(this.riderGroup); // re-add so it stays the last (topmost-drawn) child
  }

  private buildVehicle(): VehicleParts {
    if (this.vehicleKind === 'bike') {
      const model = getResolvedModel('motorcycle');
      return model ? this.buildVehicleFromModel(model, ['wheel-front', 'wheel-back']) : this.buildProceduralBike();
    }
    const model = getResolvedModel(nearestTruckKey(this.currentBodyColor));
    return model
      ? this.buildVehicleFromModel(model, ['wheel-front-left', 'wheel-front-right', 'wheel-back-left', 'wheel-back-right'])
      : this.buildProceduralKart();
  }

  /** Wraps a cloned CC0 Kenney vehicle model (see public/models/CREDITS.md) for use as this kart's body. */
  private buildVehicleFromModel(model: LoadedModel, wheelNames: string[]): VehicleParts {
    const group = cloneModel(model);
    applyToonShadingToModel(group);
    const wheels = wheelNames
      .map((name) => group.getObjectByName(name))
      .filter((node): node is THREE.Object3D => node !== undefined);
    return { group, wheels };
  }

  /** Four-wheel go-kart: wide capsule body, corner wheels, cone nose (fallback if the real model failed to load). */
  private buildProceduralKart(): VehicleParts {
    const group = new THREE.Group();
    const wheels: THREE.Mesh[] = [];

    const body = new THREE.Mesh(new THREE.CapsuleGeometry(0.78, 1.4, 6, 16), createToonMaterial(this.currentBodyColor));
    body.rotation.z = Math.PI / 2;
    body.position.y = 0.62;
    body.castShadow = true;
    addOutline(body);
    group.add(body);

    const nose = new THREE.Mesh(new THREE.ConeGeometry(0.5, 1, 4), createToonMaterial(this.currentAccentColor));
    nose.rotation.x = Math.PI / 2;
    nose.rotation.y = Math.PI / 4;
    nose.position.set(0, 0.6, 1.6);
    nose.castShadow = true;
    addOutline(nose);
    group.add(nose);

    const wheelGeometry = new THREE.CylinderGeometry(0.35, 0.35, 0.4, 12);
    const wheelMaterial = createToonMaterial(0x111111);
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
      wheel.castShadow = true;
      wheel.receiveShadow = true;
      wheels.push(wheel);
      group.add(wheel);
    }

    return { group, wheels };
  }

  /** Two-wheel motorcycle: slim inline body, front fairing, handlebar, inline wheels (fallback). */
  private buildProceduralBike(): VehicleParts {
    const group = new THREE.Group();
    const wheels: THREE.Mesh[] = [];

    const body = new THREE.Mesh(new THREE.CapsuleGeometry(0.38, 1.5, 6, 14), createToonMaterial(this.currentBodyColor));
    body.rotation.x = Math.PI / 2;
    body.position.y = 0.58;
    body.castShadow = true;
    addOutline(body);
    group.add(body);

    const fairing = new THREE.Mesh(new THREE.ConeGeometry(0.34, 0.7, 8), createToonMaterial(this.currentAccentColor));
    fairing.rotation.x = -Math.PI / 2;
    fairing.position.set(0, 0.62, 1.15);
    fairing.castShadow = true;
    addOutline(fairing);
    group.add(fairing);

    const handlebar = new THREE.Mesh(new THREE.BoxGeometry(0.9, 0.08, 0.08), createToonMaterial(0x1a1a1a));
    handlebar.position.set(0, 0.95, 0.65);
    group.add(handlebar);

    const wheelGeometry = new THREE.CylinderGeometry(0.4, 0.4, 0.28, 14);
    const wheelMaterial = createToonMaterial(0x111111);
    const wheelPositions: Array<[number, number]> = [
      [0, 1.15],
      [0, -1.05],
    ];
    for (const [x, z] of wheelPositions) {
      const wheel = new THREE.Mesh(wheelGeometry, wheelMaterial);
      wheel.rotation.z = Math.PI / 2;
      wheel.position.set(x, 0.4, z);
      wheel.castShadow = true;
      wheel.receiveShadow = true;
      wheels.push(wheel);
      group.add(wheel);
    }

    return { group, wheels };
  }

  /** Uses the real CC0 character model (with its idle animation) if it loaded; otherwise a stylised primitive rider. */
  private buildRider(): THREE.Group {
    const model = getResolvedModel('character');
    if (model) {
      const group = cloneModel(model);
      applyToonShadingToModel(group);
      group.position.y = 0.4; // seat height, roughly on top of the vehicle body
      group.scale.setScalar(1.3); // the source model is quite small relative to the vehicles

      // The model has no knee joint (each leg is one rigid piece pivoting at the
      // hip), so it can only stand or swing straight -- there's no way to get a
      // bent-knee seated pose out of it. Angling the whole leg forward at least
      // reads as "riding" instead of "standing on the roof". Idle's clip still
      // drives these nodes every frame, so the angle is re-applied after each
      // mixer update rather than set once.
      this.riderLegLeft = group.getObjectByName('leg-left');
      this.riderLegRight = group.getObjectByName('leg-right');
      this.riderArmLeft = group.getObjectByName('arm-left');
      this.riderArmRight = group.getObjectByName('arm-right');

      const idleClip = model.animations.find((clip) => clip.name === 'idle');
      if (idleClip) {
        this.riderMixer = new THREE.AnimationMixer(group);
        this.riderMixer.clipAction(idleClip).play();
      }
      this.applySeatedPose();
      return group;
    }
    return this.buildProceduralRider();
  }

  /** Locks the legs/arms into a forward-angled "riding" pose, overriding whatever the idle clip just set. */
  private applySeatedPose(): void {
    const LEG_ANGLE = -1.3;
    const ARM_ANGLE = -0.5;
    if (this.riderLegLeft) this.riderLegLeft.rotation.x = LEG_ANGLE;
    if (this.riderLegRight) this.riderLegRight.rotation.x = LEG_ANGLE;
    if (this.riderArmLeft) this.riderArmLeft.rotation.x = ARM_ANGLE;
    if (this.riderArmRight) this.riderArmRight.rotation.x = ARM_ANGLE;
  }

  // A deliberately stylised in-game driver: this keeps every vehicle from
  // looking empty even if the real character model fails to load.
  private buildProceduralRider(): THREE.Group {
    const group = new THREE.Group();

    const suitMaterial = createToonMaterial(0x2d7dd2);
    const helmetMaterial = createToonMaterial(0xf9c74f);
    this.riderMaterials.push(suitMaterial, helmetMaterial);
    const torso = new THREE.Mesh(new THREE.CapsuleGeometry(0.32, 0.55, 4, 10), suitMaterial);
    torso.position.set(0, 1.18, -0.25);
    addOutline(torso);
    group.add(torso);
    const head = new THREE.Mesh(new THREE.SphereGeometry(0.28, 14, 10), createToonMaterial(0xf2c6a0));
    head.position.set(0, 1.72, -0.25);
    addOutline(head);
    group.add(head);
    const helmet = new THREE.Mesh(new THREE.SphereGeometry(0.32, 14, 10, 0, Math.PI * 2, 0, Math.PI / 2), helmetMaterial);
    helmet.position.set(0, 1.78, -0.25);
    addOutline(helmet);
    group.add(helmet);
    const visor = new THREE.Mesh(new THREE.BoxGeometry(0.45, 0.12, 0.08), createToonMaterial(0x25324a));
    visor.position.set(0, 1.74, 0.02);
    group.add(visor);

    return group;
  }

  /** Spins the wheels from physical speed and advances the rider's idle animation, if any. */
  animateWheels(dt: number): void {
    const rotation = (this.speed / 0.35) * dt;
    for (const wheel of this.wheels) wheel.rotation.x += rotation;
    this.riderMixer?.update(dt);
    this.applySeatedPose();
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
    this.syncMesh();
  }
}
