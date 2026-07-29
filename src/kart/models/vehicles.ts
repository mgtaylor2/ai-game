import * as THREE from 'three';
import { flat, tintable, part, slab, enableShadows, PALETTE, type PaintSet } from './materials';

export interface VehicleModel {
  group: THREE.Group;
  /** Wheels, spun by road speed. Each is a pivot group so the tyre mesh can be offset inside it. */
  wheels: THREE.Object3D[];
  /** Front wheels/forks, additionally yawed by steering input. */
  steerables: THREE.Object3D[];
  /** Materials carrying the player's chosen paint, so a colour change never rebuilds geometry. */
  bodyMaterials: THREE.MeshStandardMaterial[];
  accentMaterials: THREE.MeshStandardMaterial[];
  /** Local-space point where the driver sits (hips). */
  seat: THREE.Vector3;
  /** Local-space point the driver's hands reach for. */
  wheelGrip: THREE.Vector3;
  /** Rear-facing points where exhaust/boost effects should emit. */
  exhausts: THREE.Vector3[];
  /** Driver size relative to this vehicle, so each one can be proportioned to its own bodywork. */
  driverScale: number;
  kind: 'kart' | 'bike';
}

/** Tyre + rim as one pivot group, so `rotation.x` spins the whole wheel about its axle. */
function buildWheel(radius: number, width: number, rimMaterial: THREE.Material): THREE.Group {
  const pivot = new THREE.Group();

  const tyre = new THREE.Mesh(new THREE.CylinderGeometry(radius, radius, width, 16), PALETTE.tyre());
  tyre.rotation.z = Math.PI / 2;
  pivot.add(tyre);

  // Slightly proud of the tyre on both sides so the rim colour reads from any angle.
  const rim = new THREE.Mesh(new THREE.CylinderGeometry(radius * 0.55, radius * 0.55, width * 1.06, 10), rimMaterial);
  rim.rotation.z = Math.PI / 2;
  pivot.add(rim);

  // Spokes: a couple of crossed bars are enough to make the spin legible at speed.
  const spokeGeometry = new THREE.BoxGeometry(width * 0.5, radius * 1.5, radius * 0.16);
  for (let i = 0; i < 3; i++) {
    const spoke = new THREE.Mesh(spokeGeometry, rimMaterial);
    spoke.rotation.x = (i / 3) * Math.PI;
    pivot.add(spoke);
  }

  return pivot;
}

/**
 * A proper go-kart silhouette: long flat floor pan, side pods either side of the driver, a low pointed
 * nose cone, exposed rear engine with an upswept exhaust, a bucket seat and an angled steering column.
 *
 * Built from primitives rather than a downloaded model because the previous stand-in was a delivery
 * truck, and because a baked-texture model can only ever be the handful of colours it shipped with --
 * everything tinted here is a live material the roster can recolour per racer.
 */
export function buildKart(paint: PaintSet): VehicleModel {
  const group = new THREE.Group();
  const bodyMaterial = tintable(paint.body);
  const accentMaterial = tintable(paint.accent);
  const dark = PALETTE.darkTrim();

  // Floor pan: the flat plate everything else bolts to.
  group.add(part(slab(1.28, 0.12, 2.5, 0.06), dark, [0, 0.26, 0]));

  // Central spine/fuel tank running under the driver.
  group.add(part(slab(0.62, 0.3, 1.5, 0.1), bodyMaterial, [0, 0.42, -0.05]));

  // Side pods -- the big visual mass that says "kart" rather than "car". Kept low: taller pods swallow
  // the driver from the chase camera's high angle and the whole thing reads as an empty bathtub.
  for (const side of [-1, 1]) {
    group.add(part(slab(0.44, 0.26, 1.25, 0.12), bodyMaterial, [side * 0.72, 0.4, -0.02]));
    // Pod intake flash in the accent colour, facing forward.
    group.add(part(slab(0.32, 0.14, 0.12, 0.05), accentMaterial, [side * 0.72, 0.41, 0.6]));
  }

  // Nose cone: wide and flat, pointing dead ahead. Baked into the geometry rather than composed from
  // mesh rotation + scale -- Euler rotations are applied after scale, so a "flatten then lay forward"
  // pair done on the mesh flattens along the wrong world axis and skews the cone off-centre.
  const noseGeometry = new THREE.ConeGeometry(0.6, 0.8, 4);
  noseGeometry.scale(1, 1, 0.42);
  noseGeometry.rotateX(Math.PI / 2);
  group.add(part(noseGeometry, accentMaterial, [0, 0.35, 1.25]));
  // Front bumper bar, sitting proud of the nose tip the way a real kart's does.
  group.add(part(slab(1.1, 0.12, 0.16, 0.05), dark, [0, 0.3, 1.74]));
  for (const side of [-1, 1]) {
    group.add(part(slab(0.09, 0.09, 0.34, 0.03), dark, [side * 0.5, 0.3, 1.58]));
  }

  // Bucket seat: back rest raked backwards, plus a base cushion. The back sits behind the driver's
  // hips and stops below shoulder height so the torso and helmet stay clear of it.
  group.add(part(slab(0.62, 0.46, 0.14, 0.09), bodyMaterial, [0, 0.66, -0.8], [-0.22, 0, 0]));
  group.add(part(slab(0.62, 0.1, 0.46, 0.07), bodyMaterial, [0, 0.44, -0.46]));
  // Low seat side bolsters.
  for (const side of [-1, 1]) {
    group.add(part(slab(0.09, 0.2, 0.4, 0.05), bodyMaterial, [side * 0.3, 0.53, -0.5]));
  }

  // Rear engine block with a cooling-fin look, offset to one side like a real kart.
  group.add(part(slab(0.5, 0.42, 0.52, 0.08), dark, [0.34, 0.56, -1.06]));
  group.add(part(slab(0.54, 0.06, 0.44, 0.02), flat(0x3a4048, 0.6), [0.34, 0.74, -1.06]));

  // Upswept exhaust: a stack running up and back from the engine.
  const exhaust = part(new THREE.CylinderGeometry(0.09, 0.11, 0.85, 8), PALETTE.exhaust(), [0.62, 0.72, -1.12], [0.5, 0, -0.18]);
  group.add(exhaust);

  // Rear bumper and a number-plate spoiler.
  group.add(part(slab(1.2, 0.14, 0.18, 0.05), dark, [0, 0.36, -1.35]));
  group.add(part(slab(0.72, 0.3, 0.08, 0.04), accentMaterial, [0, 0.86, -1.2], [-0.25, 0, 0]));

  // Steering column, raked up and back from the floor pan, with the wheel sitting on its top end.
  // The column direction, the wheel's position and `wheelGrip` below are all derived from the same
  // two endpoints, so the driver's hands land on the rim instead of somewhere near it.
  const columnBase = new THREE.Vector3(0, 0.32, 0.58);
  const columnTop = new THREE.Vector3(0, 0.86, 0.36);
  const columnAxis = columnTop.clone().sub(columnBase);
  const columnLength = columnAxis.length();
  const columnMid = columnBase.clone().addScaledVector(columnAxis, 0.5);
  // Pitch that takes +Y onto the column axis.
  const columnPitch = Math.atan2(-columnAxis.z, columnAxis.y);

  group.add(part(new THREE.CylinderGeometry(0.05, 0.05, columnLength, 8), dark, columnMid.toArray(), [columnPitch, 0, 0]));

  const steeringWheel = new THREE.Group();
  steeringWheel.position.copy(columnTop);
  // A torus's hole faces +Z, so it needs a further quarter turn to face along the column.
  steeringWheel.rotation.x = columnPitch - Math.PI / 2;
  steeringWheel.add(new THREE.Mesh(new THREE.TorusGeometry(0.21, 0.042, 6, 14), dark));
  steeringWheel.add(part(slab(0.32, 0.055, 0.05, 0.02), accentMaterial, [0, 0, 0.01]));
  group.add(steeringWheel);

  // Wheels: rears wider and larger, as on a real kart. Fronts sit on steer pivots.
  const wheels: THREE.Object3D[] = [];
  const steerables: THREE.Object3D[] = [];
  const rimMaterial = accentMaterial;

  for (const side of [-1, 1]) {
    const front = buildWheel(0.3, 0.22, rimMaterial);
    const steerPivot = new THREE.Group();
    steerPivot.position.set(side * 0.78, 0.3, 1.0);
    steerPivot.add(front);
    group.add(steerPivot);
    wheels.push(front);
    steerables.push(steerPivot);

    const rear = buildWheel(0.38, 0.34, rimMaterial);
    rear.position.set(side * 0.82, 0.38, -1.0);
    group.add(rear);
    wheels.push(rear);
  }

  // Axle bar between the rear wheels.
  group.add(part(new THREE.CylinderGeometry(0.06, 0.06, 1.6, 8), PALETTE.chrome(), [0, 0.38, -1.0], [0, 0, Math.PI / 2]));

  enableShadows(group);

  return {
    group,
    wheels,
    steerables,
    bodyMaterials: [bodyMaterial],
    accentMaterials: [accentMaterial],
    seat: new THREE.Vector3(0, 0.52, -0.34),
    wheelGrip: columnTop.clone(),
    exhausts: [new THREE.Vector3(0.62, 1.05, -1.3)],
    driverScale: 1.32,
    kind: 'kart',
  };
}

/**
 * A superbike: fuel tank, front fairing with a screen, telescopic forks, swingarm and a stubby
 * upswept can. Deliberately narrower and taller than the kart so the two silhouettes read apart
 * instantly on the track and in the vehicle picker.
 */
export function buildBike(paint: PaintSet): VehicleModel {
  const group = new THREE.Group();
  const bodyMaterial = tintable(paint.body);
  const accentMaterial = tintable(paint.accent);
  const dark = PALETTE.darkTrim();

  // Engine block low and central, the visual anchor between the wheels.
  group.add(part(slab(0.42, 0.44, 0.7, 0.1), dark, [0, 0.5, -0.05]));

  // Fuel tank: wide at the front, tapering into the seat.
  group.add(part(slab(0.38, 0.32, 0.8, 0.16), bodyMaterial, [0, 0.86, 0.28]));
  // Seat and tail unit, kicked up at the back.
  group.add(part(slab(0.34, 0.16, 0.62, 0.08), dark, [0, 0.9, -0.38]));
  group.add(part(slab(0.34, 0.26, 0.44, 0.12), bodyMaterial, [0, 1.0, -0.78], [0.3, 0, 0]));
  group.add(part(slab(0.3, 0.1, 0.16, 0.04), accentMaterial, [0, 1.12, -0.98]));

  // Front fairing wrapping the headstock, with an accent flash and a tinted screen.
  group.add(part(slab(0.5, 0.5, 0.42, 0.18), bodyMaterial, [0, 0.94, 0.82]));
  group.add(part(slab(0.36, 0.18, 0.12, 0.05), accentMaterial, [0, 0.78, 1.0]));
  group.add(part(slab(0.3, 0.22, 0.08, 0.05), PALETTE.glass(), [0, 1.16, 0.84], [-0.5, 0, 0]));
  // Headlight.
  group.add(part(new THREE.SphereGeometry(0.11, 10, 8), flat(0xfff3cf, 0.3), [0, 0.94, 1.03]));

  // Belly pan under the engine.
  group.add(part(slab(0.4, 0.16, 0.7, 0.08), accentMaterial, [0, 0.34, 0.05]));

  const wheels: THREE.Object3D[] = [];
  const steerables: THREE.Object3D[] = [];

  // Front end: forks and bars ride on a steer pivot so the whole assembly turns together.
  const steerPivot = new THREE.Group();
  const steerPivotHeight = 0.9;
  steerPivot.position.set(0, steerPivotHeight, 0.86);

  // The front wheel's centre must sit exactly its own radius above the ground, or the bike ends up
  // nose-down with the front tyre buried in the track. Everything else on the fork is derived from
  // that position rather than eyeballed alongside it.
  const frontRadius = 0.42;
  const frontWheelLocal = new THREE.Vector3(0, frontRadius - steerPivotHeight, 0.3);
  const forkLength = frontWheelLocal.length();
  const forkPitch = Math.atan2(-frontWheelLocal.z, -frontWheelLocal.y);
  for (const side of [-1, 1]) {
    steerPivot.add(
      part(
        new THREE.CylinderGeometry(0.055, 0.055, forkLength, 8),
        PALETTE.chrome(),
        [side * 0.17, frontWheelLocal.y / 2, frontWheelLocal.z / 2],
        [forkPitch, 0, 0],
      ),
    );
  }
  // Handlebars.
  steerPivot.add(part(new THREE.CylinderGeometry(0.035, 0.035, 0.66, 8), dark, [0, 0.16, -0.06], [0, 0, Math.PI / 2]));
  for (const side of [-1, 1]) {
    steerPivot.add(part(new THREE.CylinderGeometry(0.05, 0.05, 0.14, 8), PALETTE.tyre(), [side * 0.28, 0.16, -0.06], [0, 0, Math.PI / 2]));
  }

  const front = buildWheel(frontRadius, 0.16, accentMaterial);
  front.position.copy(frontWheelLocal);
  steerPivot.add(front);
  group.add(steerPivot);
  wheels.push(front);
  steerables.push(steerPivot);

  // Swingarm and rear wheel.
  for (const side of [-1, 1]) {
    group.add(part(slab(0.08, 0.13, 0.8, 0.03), dark, [side * 0.18, 0.42, -0.62], [0.1, 0, 0]));
  }
  const rear = buildWheel(0.44, 0.22, accentMaterial);
  rear.position.set(0, 0.44, -1.0);
  group.add(rear);
  wheels.push(rear);

  // Upswept exhaust can on the right.
  group.add(part(new THREE.CylinderGeometry(0.1, 0.12, 0.7, 10), PALETTE.exhaust(), [0.26, 0.62, -0.85], [0.42, 0, -0.1]));

  enableShadows(group);

  return {
    group,
    wheels,
    steerables,
    bodyMaterials: [bodyMaterial],
    accentMaterials: [accentMaterial],
    // Sat further forward and higher than the kart, leaning onto the tank.
    seat: new THREE.Vector3(0, 0.98, -0.3),
    wheelGrip: new THREE.Vector3(0, 1.06, 0.8),
    exhausts: [new THREE.Vector3(0.26, 0.85, -1.15)],
    driverScale: 1.08,
    kind: 'bike',
  };
}
