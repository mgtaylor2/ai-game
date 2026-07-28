import { CONFIG } from './config';

const RAD2DEG = 180 / Math.PI;

/** Compares the terrain-following vertical rate against a ballistic one to decide whether the ground has fallen away out from under the rider. */
export function checkTakeoff(
  lastVerticalVelocity: number,
  surfaceVerticalVelocity: number,
  dt: number,
): { takeoff: boolean; verticalVelocity: number } {
  const ballistic = lastVerticalVelocity - CONFIG.physics.gravity * dt;
  const dropExcess = ballistic - surfaceVerticalVelocity;
  if (dropExcess <= CONFIG.air.takeoffDropThreshold) {
    return { takeoff: false, verticalVelocity: surfaceVerticalVelocity };
  }
  const verticalVelocity = ballistic - dropExcess * CONFIG.air.takeoffKeepFraction;
  return { takeoff: true, verticalVelocity };
}

/** Angular distance (0..180 deg) between two headings, ignoring winding direction. */
export function headingDifferenceDeg(a: number, b: number): number {
  let diff = ((a - b + Math.PI) % (Math.PI * 2)) - Math.PI;
  if (diff < -Math.PI) diff += Math.PI * 2;
  return Math.abs(diff) * RAD2DEG;
}

export interface LandingClassification {
  clean: boolean;
  switchLanding: boolean;
}

/** Clean forward landing near 0 deg off travel heading, clean switch landing near 180 deg, anything between is a wipeout. */
export function classifyLanding(boardYaw: number, travelHeading: number): LandingClassification {
  const diff = headingDifferenceDeg(boardYaw, travelHeading);
  if (diff <= CONFIG.air.cleanLandingToleranceDeg) return { clean: true, switchLanding: false };
  if (diff >= CONFIG.air.switchLandingToleranceDeg) return { clean: true, switchLanding: true };
  return { clean: false, switchLanding: false };
}

/** With no spin input, the board eases toward whichever of (flight heading, flight heading + 180) is closer, so a switch landing is a deliberate no-spin option, not an accident. */
export function autoTrackTarget(currentYaw: number, flightHeading: number): number {
  const forwardDiff = headingDifferenceDeg(currentYaw, flightHeading);
  const switchHeading = flightHeading + Math.PI;
  const switchDiff = headingDifferenceDeg(currentYaw, switchHeading);
  return forwardDiff <= switchDiff ? flightHeading : switchHeading;
}

/** Shortest-path ease of an angle toward a target, at a fixed turn rate. */
export function easeAngleTowards(current: number, target: number, rate: number, dt: number): number {
  let diff = ((target - current + Math.PI) % (Math.PI * 2)) - Math.PI;
  if (diff < -Math.PI) diff += Math.PI * 2;
  const maxStep = rate * dt;
  if (diff > maxStep) diff = maxStep;
  else if (diff < -maxStep) diff = -maxStep;
  return current + diff;
}
