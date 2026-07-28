import { CONFIG } from './config';
import { mulberry32 } from './rng';

interface ControlPoint {
  x: number;
  y: number;
  wavelength: number;
  wavelengthTarget: number;
  amplitude: number;
  amplitudeTarget: number;
  phase: number;
  gradeDeg: number;
  gradeTarget: number;
  gradeHoldRemaining: number;
}

const DEG2RAD = Math.PI / 180;

/** Lazily-extended Catmull-Rom centerline: control points every `controlSpacing` meters, generated forward-only and cached forever so the mountain is deterministic and never regenerated behind the player. */
export class TrackSpline {
  private readonly points: ControlPoint[] = [];
  private readonly random: () => number;
  private readonly spacing = CONFIG.spline.controlSpacing;

  constructor(seed: number) {
    this.random = mulberry32(seed ^ 0x5eed5eed);
    this.points.push({
      x: 0,
      y: 0,
      wavelength: 185,
      wavelengthTarget: 185,
      amplitude: 30,
      amplitudeTarget: 30,
      phase: 0,
      gradeDeg: 15,
      gradeTarget: 15,
      gradeHoldRemaining: 8,
    });
  }

  private pickGradeTarget(): number {
    const r = this.random();
    const s = CONFIG.spline;
    if (r < s.gradeFlatChance) return s.gradeFlatDeg;
    if (r < s.gradeFlatChance + s.gradeSteepChance) return s.gradeSteepDeg;
    return s.gradeMainMinDeg + this.random() * (s.gradeMainMaxDeg - s.gradeMainMinDeg);
  }

  private extendTo(index: number): void {
    const s = CONFIG.spline;
    while (this.points.length <= index) {
      const prev = this.points[this.points.length - 1];

      let wavelengthTarget = prev.wavelengthTarget;
      let amplitudeTarget = prev.amplitudeTarget;
      if (this.random() < s.lateralRerollChance) {
        wavelengthTarget = s.lateralWavelengthMin + this.random() * (s.lateralWavelengthMax - s.lateralWavelengthMin);
      }
      if (this.random() < s.lateralRerollChance) {
        amplitudeTarget = s.lateralAmplitudeMin + this.random() * (s.lateralAmplitudeMax - s.lateralAmplitudeMin);
      }
      const wavelength = prev.wavelength + (wavelengthTarget - prev.wavelength) * 0.15;
      const amplitude = prev.amplitude + (amplitudeTarget - prev.amplitude) * 0.15;
      const phase = prev.phase + (2 * Math.PI * this.spacing) / wavelength;
      const x = amplitude * Math.sin(phase);

      let gradeTarget = prev.gradeTarget;
      let holdRemaining = prev.gradeHoldRemaining - 1;
      if (holdRemaining <= 0) {
        gradeTarget = this.pickGradeTarget();
        holdRemaining = s.gradeHoldMin + Math.floor(this.random() * (s.gradeHoldMax - s.gradeHoldMin + 1));
      }
      const gradeDeg = prev.gradeDeg + (gradeTarget - prev.gradeDeg) * 0.2;
      const y = prev.y - this.spacing * Math.tan(gradeDeg * DEG2RAD);

      this.points.push({
        x,
        y,
        wavelength,
        wavelengthTarget,
        amplitude,
        amplitudeTarget,
        phase,
        gradeDeg,
        gradeTarget,
        gradeHoldRemaining: holdRemaining,
      });
    }
  }

  private controlPoint(index: number): ControlPoint {
    const clamped = Math.max(0, index);
    this.extendTo(clamped);
    return this.points[clamped];
  }

  /** Catmull-Rom interpolation of a scalar field sampled at consecutive control points. */
  private sample(z: number, field: 'x' | 'y'): number {
    const i = Math.floor(z / this.spacing);
    const t = z / this.spacing - i;
    const p0 = this.controlPoint(i - 1)[field];
    const p1 = this.controlPoint(i)[field];
    const p2 = this.controlPoint(i + 1)[field];
    const p3 = this.controlPoint(i + 2)[field];
    const t2 = t * t;
    const t3 = t2 * t;
    return (
      0.5 *
      (2 * p1 +
        (-p0 + p2) * t +
        (2 * p0 - 5 * p1 + 4 * p2 - p3) * t2 +
        (-p0 + 3 * p1 - 3 * p2 + p3) * t3)
    );
  }

  /** Centerline lateral offset at forward distance z. */
  xAt(z: number): number {
    return this.sample(Math.max(0, z), 'x');
  }

  /** Centerline elevation at forward distance z (decreases downhill). */
  yAt(z: number): number {
    return this.sample(Math.max(0, z), 'y');
  }

  /** Unit tangent of the centerline in the horizontal (x, z) plane. */
  dirAt(z: number): { x: number; z: number } {
    const h = 0.5;
    const clamped = Math.max(h, z);
    const dx = this.xAt(clamped + h) - this.xAt(clamped - h);
    const len = Math.hypot(dx, 2 * h);
    return { x: dx / len, z: (2 * h) / len };
  }

  /** Signed curvature (rad per meter) via central difference of heading. Positive = curving toward +x. */
  curvatureAt(z: number): number {
    const h = 2;
    const clamped = Math.max(h, z);
    const before = this.dirAt(clamped - h);
    const after = this.dirAt(clamped + h);
    const yawBefore = Math.atan2(before.x, before.z);
    const yawAfter = Math.atan2(after.x, after.z);
    let dYaw = yawAfter - yawBefore;
    while (dYaw > Math.PI) dYaw -= Math.PI * 2;
    while (dYaw < -Math.PI) dYaw += Math.PI * 2;
    return dYaw / (2 * h);
  }
}
