import type { PathPoint, StartGridSlot, TrackDefinition } from '../track/definition';
import type { Waypoint } from '../track/waypoints';
import { computePathGeometry, headingFromTangent } from '../track/path';

const SAMPLE_COUNT = 72;
const BASE_RADIUS_X = 65;
const BASE_RADIUS_Z = 45;
/** Fraction of the base radius the curve swells/pinches by, creating sweeping S-bends instead of a plain oval. */
const WOBBLE_AMPLITUDE = 0.24;
const WOBBLE_FREQUENCY = 3;
/** Gentle rolling hills (Maple-Treeway style) rather than a flat oval; visual only, physics stays 2D. */
const ELEVATION_AMPLITUDE = 9;
const ELEVATION_FREQUENCY = 2;
// 0, not PI/2: keeps the start/finish point (theta=0) at flat ground. Karts only follow
// terrain height while actively racing (see updateKart), so if the start line itself sat
// partway up a hill, karts would visibly pop from y=0 to the hill height the instant the
// countdown ends.
const ELEVATION_PHASE = 0;
const ROAD_WIDTH = 22;
/** Offsets waypoint 0 away from the start/finish point so it isn't a zero-distance target. */
const WAYPOINT_STRIDE = 4;
const WAYPOINT_OFFSET = 2;

function buildPath(): PathPoint[] {
  const points: PathPoint[] = [];
  for (let i = 0; i < SAMPLE_COUNT; i++) {
    const theta = (i / SAMPLE_COUNT) * Math.PI * 2;
    const wobble = 1 + WOBBLE_AMPLITUDE * Math.sin(theta * WOBBLE_FREQUENCY);
    const x = Math.sin(theta) * BASE_RADIUS_X * wobble;
    const z = Math.cos(theta) * BASE_RADIUS_Z * wobble;
    const y = Math.max(0, ELEVATION_AMPLITUDE * Math.sin(theta * ELEVATION_FREQUENCY + ELEVATION_PHASE));
    points.push({ x, y, z });
  }
  return points;
}

function buildWaypoints(path: PathPoint[]): Waypoint[] {
  const waypoints: Waypoint[] = [];
  for (let i = WAYPOINT_OFFSET; i < path.length; i += WAYPOINT_STRIDE) {
    waypoints.push({ x: path[i].x, z: path[i].z });
  }
  return waypoints;
}

/**
 * 3-lane x 4-row grid following the curve (row = samples behind the line, lane = lateral
 * offset). Slot 0 is centered at row 0 (lane 0), matching `start` exactly -- that's pole
 * position, reserved for the player; the other 11 slots go to CPUs.
 */
function buildStartGrid(path: PathPoint[], geometry: ReturnType<typeof computePathGeometry>): StartGridSlot[] {
  const lanes = [0, -6, 6];
  const rows = [0, -3, -6, -9];
  const slots: StartGridSlot[] = [];
  for (const rowOffset of rows) {
    for (const laneOffset of lanes) {
      const index = ((rowOffset % path.length) + path.length) % path.length;
      const p = path[index];
      const n = geometry.normals[index];
      slots.push({ x: p.x + n.x * laneOffset, z: p.z + n.z * laneOffset, heading: headingFromTangent(geometry.tangents[index]) });
    }
  }
  return slots;
}

const path = buildPath();
const pathGeometry = computePathGeometry(path);
const { tangents, normals } = pathGeometry;
const halfRoadWidth = ROAD_WIDTH / 2;
const finishTangent = tangents[0];
const finishNormal = normals[0];

/** A winding, gently hilly loop -- sweeping S-curves and rolling elevation instead of a plain oval. */
export const ringTrack: TrackDefinition = {
  id: 'ring',
  name: 'Sunset Serpentine',
  grassColor: 0x3a7d44,
  roadColor: 0x4a4a4a,
  wallColor: 0xcc3333,
  path,
  roadWidth: ROAD_WIDTH,
  waypoints: buildWaypoints(path),
  finishLine: {
    a: { x: path[0].x + finishNormal.x * halfRoadWidth, z: path[0].z + finishNormal.z * halfRoadWidth },
    b: { x: path[0].x - finishNormal.x * halfRoadWidth, z: path[0].z - finishNormal.z * halfRoadWidth },
    direction: { x: finishTangent.x, z: finishTangent.z },
  },
  startGrid: buildStartGrid(path, pathGeometry),
  start: { x: path[0].x, z: path[0].z, heading: headingFromTangent(finishTangent) },
};
