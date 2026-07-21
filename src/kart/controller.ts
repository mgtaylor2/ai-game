import type { Kart } from './kart';
import { KART_RADIUS } from './kart';
import type { InputState } from './input';
import type { Track } from '../track/track';

const MAX_REVERSE_SPEED = -10;
const BRAKE_DECELERATION = 30;
const FRICTION = 10;
const TURN_REFERENCE_SPEED = 8; // speed at which turn rate reaches turnRateMax
const TURN_RATE_MIN_FACTOR = 0.35; // fraction of turnRateMax available near-standstill
const WALL_BOUNCE_FACTOR = -0.3;
const MAX_DT = 0.05; // clamp so a stalled/backgrounded frame can't produce a huge jump
/** Speed retained by both karts after bumping into each other (a soft bump, not a wall-style bounce-back). */
const KART_BUMP_DAMPING = 0.7;
/** A kart motionless this long (seconds) despite active racing gets a small corrective nudge. */
const STUCK_SPEED_THRESHOLD = 1.5;
const STUCK_TIME_LIMIT = 1.5;
const UNSTICK_NUDGE_DISTANCE = 2;
/** How far ahead/behind to sample terrain height for the visual nose-pitch on slopes. */
const PITCH_PROBE_DISTANCE = 1.5;
const PITCH_SMOOTHING = 10;

/** Per-kart physics profile, derived from the selected character + vehicle. */
export interface KartTuning {
  maxSpeed: number;
  acceleration: number;
  turnRateMax: number; // rad/sec at full speed
}

/** The original, pre-roster feel — used until a character/vehicle combo is chosen. */
export const DEFAULT_TUNING: KartTuning = {
  maxSpeed: 26,
  acceleration: 18,
  turnRateMax: 2.4,
};

/** Advances kart physics by dtSeconds, resolves track collisions, and syncs the mesh. */
export function updateKart(kart: Kart, input: InputState, track: Track, dtSeconds: number): void {
  const dt = Math.min(dtSeconds, MAX_DT);
  const { maxSpeed, acceleration, turnRateMax } = kart.tuning;

  if (input.forward) {
    kart.speed += acceleration * dt;
  } else if (input.brake) {
    kart.speed -= BRAKE_DECELERATION * dt;
  } else if (kart.speed > 0) {
    kart.speed = Math.max(0, kart.speed - FRICTION * dt);
  } else if (kart.speed < 0) {
    kart.speed = Math.min(0, kart.speed + FRICTION * dt);
  }

  kart.speed = Math.max(MAX_REVERSE_SPEED, Math.min(maxSpeed, kart.speed));

  // Turn rate scales with speed but never drops to zero, so a near-stationary kart can still pivot.
  const speedFactor = Math.min(Math.abs(kart.speed) / TURN_REFERENCE_SPEED, 1);
  const turnRate = turnRateMax * (TURN_RATE_MIN_FACTOR + (1 - TURN_RATE_MIN_FACTOR) * speedFactor);
  const turnDirection = (input.left ? 1 : 0) - (input.right ? 1 : 0);
  if (Math.abs(kart.speed) > 0.05) {
    const reverseSign = kart.speed < 0 ? -1 : 1;
    kart.heading += turnDirection * turnRate * dt * reverseSign;
  }

  const forwardX = Math.sin(kart.heading);
  const forwardZ = Math.cos(kart.heading);
  kart.position.x += forwardX * kart.speed * dt;
  kart.position.z += forwardZ * kart.speed * dt;

  const collided = track.resolveCollision(kart.position, KART_RADIUS);
  if (collided) {
    kart.speed *= WALL_BOUNCE_FACTOR;
  }

  // Safety net against multi-kart gridlock: with no traffic-avoidance intelligence,
  // a handful of karts can end up mutually wedged (each blocking the other's escape
  // path) despite everyone "trying" to move. Rather than chase every possible
  // multi-body deadlock, nudge anyone motionless too long sideways to break it.
  if (Math.abs(kart.speed) < STUCK_SPEED_THRESHOLD) {
    kart.stuckTimer += dt;
    if (kart.stuckTimer > STUCK_TIME_LIMIT) {
      const angle = Math.random() * Math.PI * 2;
      kart.position.x += Math.cos(angle) * UNSTICK_NUDGE_DISTANCE;
      kart.position.z += Math.sin(angle) * UNSTICK_NUDGE_DISTANCE;
      track.resolveCollision(kart.position, KART_RADIUS);
      kart.stuckTimer = 0;
    }
  } else {
    kart.stuckTimer = 0;
  }

  // Physics stays a 2D (x, z) model; elevation and pitch are purely visual "hug the
  // terrain" lookups (interpolated, not snapped to the nearest sample) so hills read
  // as hills — height smoothly follows the slope, and the nose tilts to match it,
  // instead of the kart staying flat and stair-stepping up between samples.
  kart.position.y = track.getHeightAt(kart.position.x, kart.position.z);
  const aheadY = track.getHeightAt(kart.position.x + forwardX * PITCH_PROBE_DISTANCE, kart.position.z + forwardZ * PITCH_PROBE_DISTANCE);
  const behindY = track.getHeightAt(kart.position.x - forwardX * PITCH_PROBE_DISTANCE, kart.position.z - forwardZ * PITCH_PROBE_DISTANCE);
  const targetPitch = Math.atan2(aheadY - behindY, PITCH_PROBE_DISTANCE * 2);
  kart.pitch += (targetPitch - kart.pitch) * Math.min(1, PITCH_SMOOTHING * dt);

  kart.syncMesh();
}

/**
 * Pushes overlapping karts apart and dampens their speed on contact. Call once per
 * frame after every kart has moved, so bumps are order-independent.
 *
 * The speed damping only fires on the frame contact *starts* (tracked per-pair via
 * Kart#isTouching), never while two karts remain pressed together — applying it
 * every frame of sustained contact compounds multiplicatively and crushes speed to
 * zero within a fraction of a second, effectively freezing anyone stuck side by side.
 */
export function resolveKartCollisions(karts: readonly Kart[], track: Track): void {
  const minDistance = KART_RADIUS * 2;
  for (let i = 0; i < karts.length; i++) {
    for (let j = i + 1; j < karts.length; j++) {
      const a = karts[i];
      const b = karts[j];
      const dx = b.position.x - a.position.x;
      const dz = b.position.z - a.position.z;
      const distance = Math.hypot(dx, dz);

      if (distance === 0 || distance >= minDistance) {
        a.setTouching(b, false);
        b.setTouching(a, false);
        continue;
      }

      const overlap = minDistance - distance;
      const nx = dx / distance;
      const nz = dz / distance;
      a.position.x -= nx * overlap * 0.5;
      a.position.z -= nz * overlap * 0.5;
      b.position.x += nx * overlap * 0.5;
      b.position.z += nz * overlap * 0.5;

      if (!a.isTouching(b)) {
        a.speed *= KART_BUMP_DAMPING;
        b.speed *= KART_BUMP_DAMPING;
        a.setTouching(b, true);
        b.setTouching(a, true);
      }

      track.resolveCollision(a.position, KART_RADIUS);
      track.resolveCollision(b.position, KART_RADIUS);
      a.position.y = track.getHeightAt(a.position.x, a.position.z);
      b.position.y = track.getHeightAt(b.position.x, b.position.z);
      a.syncMesh();
      b.syncMesh();
    }
  }
}
