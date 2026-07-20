import type { Kart } from './kart';
import { KART_RADIUS } from './kart';
import type { InputState } from './input';
import type { Track } from '../track/track';

const MAX_SPEED = 26;
const MAX_REVERSE_SPEED = -10;
const ACCELERATION = 18;
const BRAKE_DECELERATION = 30;
const FRICTION = 10;
const TURN_RATE_MAX = 2.4; // rad/sec at full speed
const TURN_REFERENCE_SPEED = 8; // speed at which turn rate reaches TURN_RATE_MAX
const TURN_RATE_MIN_FACTOR = 0.35; // fraction of TURN_RATE_MAX available near-standstill
const WALL_BOUNCE_FACTOR = -0.3;
const MAX_DT = 0.05; // clamp so a stalled/backgrounded frame can't produce a huge jump

/** Advances kart physics by dtSeconds, resolves track collisions, and syncs the mesh. */
export function updateKart(kart: Kart, input: InputState, track: Track, dtSeconds: number): void {
  const dt = Math.min(dtSeconds, MAX_DT);

  if (input.forward) {
    kart.speed += ACCELERATION * dt;
  } else if (input.brake) {
    kart.speed -= BRAKE_DECELERATION * dt;
  } else if (kart.speed > 0) {
    kart.speed = Math.max(0, kart.speed - FRICTION * dt);
  } else if (kart.speed < 0) {
    kart.speed = Math.min(0, kart.speed + FRICTION * dt);
  }

  kart.speed = Math.max(MAX_REVERSE_SPEED, Math.min(MAX_SPEED, kart.speed));

  // Turn rate scales with speed but never drops to zero, so a near-stationary kart can still pivot.
  const speedFactor = Math.min(Math.abs(kart.speed) / TURN_REFERENCE_SPEED, 1);
  const turnRate = TURN_RATE_MAX * (TURN_RATE_MIN_FACTOR + (1 - TURN_RATE_MIN_FACTOR) * speedFactor);
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

  kart.syncMesh();
}
