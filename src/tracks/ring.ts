import type { TrackDefinition } from '../track/definition';

const OUTER_HALF_X = 40;
const OUTER_HALF_Z = 25;
const INNER_HALF_X = 20;
const INNER_HALF_Z = 10;
const WALL_THICKNESS = 1;

/** The original rectangular ring, expressed entirely as serializable track data. */
export const ringTrack: TrackDefinition = {
  id: 'ring',
  name: 'Rectangle Ring',
  grass: { x: 0, z: 0, width: OUTER_HALF_X * 2 + 20, depth: OUTER_HALF_Z * 2 + 20, color: 0x3a7d44 },
  road: { x: 0, z: 0, width: OUTER_HALF_X * 2, depth: OUTER_HALF_Z * 2, color: 0x4a4a4a },
  islands: [{ x: 0, z: 0, width: INNER_HALF_X * 2, depth: INNER_HALF_Z * 2, height: 1, color: 0x2f6b39 }],
  walls: [
    { x: 0, z: -OUTER_HALF_Z, width: OUTER_HALF_X * 2 + WALL_THICKNESS * 2, depth: WALL_THICKNESS, color: 0xcc3333 },
    { x: 0, z: OUTER_HALF_Z, width: OUTER_HALF_X * 2 + WALL_THICKNESS * 2, depth: WALL_THICKNESS, color: 0xcc3333 },
    { x: -OUTER_HALF_X, z: 0, width: WALL_THICKNESS, depth: OUTER_HALF_Z * 2, color: 0xcc3333 },
    { x: OUTER_HALF_X, z: 0, width: WALL_THICKNESS, depth: OUTER_HALF_Z * 2, color: 0xcc3333 },
  ],
  collision: {
    boundary: { x: 0, z: 0, width: OUTER_HALF_X * 2, depth: OUTER_HALF_Z * 2 },
    solidRects: [{ x: 0, z: 0, width: INNER_HALF_X * 2, depth: INNER_HALF_Z * 2 }],
  },
  // Only spans the right straight so it cannot be crossed on both top and bottom straights.
  finishLine: { axis: 'z', coordinate: 17, min: INNER_HALF_X, max: OUTER_HALF_X, direction: -1 },
  waypoints: [
    { x: 30, z: 10 }, { x: 30, z: 0 }, { x: 30, z: -10 }, { x: 30, z: -17.5 },
    { x: 15, z: -17.5 }, { x: 0, z: -17.5 }, { x: -15, z: -17.5 }, { x: -30, z: -17.5 },
    { x: -30, z: -10 }, { x: -30, z: 0 }, { x: -30, z: 10 }, { x: -30, z: 17.5 },
    { x: -15, z: 17.5 }, { x: 0, z: 17.5 }, { x: 15, z: 17.5 }, { x: 30, z: 17.5 },
  ],
  start: { x: 30, z: 14, heading: Math.PI },
};
