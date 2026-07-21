import type { Waypoint } from './waypoints';

/** A point on the track centerline; y gives elevation (visual only, physics stays 2D). */
export interface PathPoint {
  x: number;
  y: number;
  z: number;
}

/** A finish-line gate: a segment across the road, plus the tangent direction of legal travel. */
export interface FinishLineDefinition {
  a: { x: number; z: number };
  b: { x: number; z: number };
  direction: { x: number; z: number };
}

export interface StartGridSlot {
  x: number;
  z: number;
  heading: number;
}

export interface TrackDefinition {
  id: string;
  name: string;
  grassColor: number;
  roadColor: number;
  wallColor: number;
  /** Dense closed-loop centerline; consecutive points are close enough that straight
   *  segments between them read as a smooth curve. */
  path: PathPoint[];
  roadWidth: number;
  /** Sparser subset of `path`, in the {x,z} shape Race/AiDriver expect. */
  waypoints: Waypoint[];
  finishLine: FinishLineDefinition;
  /** Grid positions for all racers, index 0 is pole position (the player). Follows the
   *  curve (row = distance behind the line along the path, lane = lateral offset), since
   *  a straight-line offset grid doesn't make sense on a curved track. */
  startGrid: StartGridSlot[];
  start: { x: number; z: number; heading: number };
}
