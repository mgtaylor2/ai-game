import type { Waypoint } from './waypoints';

/** Axis-aligned rectangle described by its centre and full dimensions. */
export interface RectangleDefinition {
  x: number;
  z: number;
  width: number;
  depth: number;
}

export interface SurfaceDefinition extends RectangleDefinition {
  color: number;
}

export interface WallDefinition extends RectangleDefinition {
  color: number;
}

export interface IslandDefinition extends RectangleDefinition {
  height: number;
  color: number;
}

/** A finish line may run across either a horizontal or vertical straight. */
export interface FinishLineDefinition {
  axis: 'x' | 'z';
  coordinate: number;
  min: number;
  max: number;
  /** Sign of legal travel across the line along `axis`. */
  direction: 1 | -1;
}

export interface TrackDefinition {
  id: string;
  name: string;
  grass: SurfaceDefinition;
  road: SurfaceDefinition;
  islands: IslandDefinition[];
  walls: WallDefinition[];
  /** The outer playable boundary and solid rectangular obstacles for collision. */
  collision: {
    boundary: RectangleDefinition;
    solidRects: RectangleDefinition[];
  };
  finishLine: FinishLineDefinition;
  waypoints: Waypoint[];
  start: {
    x: number;
    z: number;
    heading: number;
  };
}
