import type { InputState } from '../kart/input';
import type { Kart } from '../kart/kart';
import type { Race } from '../race/race';
import type { Waypoint } from '../track/waypoints';

const TURN_DEAD_ZONE = 0.08;
const CORNER_SLOWDOWN_ANGLE = 0.55;
const HARD_BRAKE_ANGLE = 1.1;
const TARGET_REACHED_DISTANCE = 3;

/** Wraps an angle to the [-PI, PI] interval. */
function wrapAngle(angle: number): number {
  return Math.atan2(Math.sin(angle), Math.cos(angle));
}

/**
 * Turns the next racing-line waypoint into the same InputState used by a player.
 *
 * The driver intentionally owns no physics: callers feed this state into
 * updateKart just as they would InputController#getState(). Race remains the
 * authority on which waypoint is next, keeping AI and player progress aligned.
 */
export class AiDriver {
  private readonly race: Race;
  private readonly waypoints: readonly Waypoint[];

  constructor(race: Race, waypoints: readonly Waypoint[]) {
    this.race = race;
    this.waypoints = waypoints;
    if (waypoints.length === 0) {
      throw new Error('AiDriver requires at least one waypoint');
    }
  }

  getInput(kart: Kart): InputState {
    const waypoint = this.waypoints[this.race.getNextWaypointIndex(kart)];
    const dx = waypoint.x - kart.position.x;
    const dz = waypoint.z - kart.position.z;
    const distance = Math.hypot(dx, dz);
    const targetHeading = Math.atan2(dx, dz);
    const headingError = wrapAngle(targetHeading - kart.heading);
    const absoluteError = Math.abs(headingError);

    // Start turning before a tight waypoint, but avoid oscillating around a
    // waypoint that has already been reached and will advance on race.update().
    const steering = distance > TARGET_REACHED_DISTANCE ? headingError : 0;
    const sharpCorner = absoluteError > CORNER_SLOWDOWN_ANGLE;

    return {
      forward: !sharpCorner,
      brake: absoluteError > HARD_BRAKE_ANGLE && kart.speed > 8,
      left: steering > TURN_DEAD_ZONE,
      right: steering < -TURN_DEAD_ZONE,
    };
  }
}
