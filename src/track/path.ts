import type { PathPoint } from './definition';

export interface Vec2 {
  x: number;
  z: number;
}

/** Normalized forward tangent and left-hand perpendicular at every point of a closed loop. */
export interface PathGeometry {
  tangents: Vec2[];
  normals: Vec2[];
}

function normalize(x: number, z: number): Vec2 {
  const length = Math.hypot(x, z) || 1;
  return { x: x / length, z: z / length };
}

/** Computes per-point tangent/normal vectors for a closed-loop path (wraps at both ends). */
export function computePathGeometry(path: readonly PathPoint[]): PathGeometry {
  const count = path.length;
  const tangents: Vec2[] = [];
  const normals: Vec2[] = [];
  for (let i = 0; i < count; i++) {
    const prev = path[(i - 1 + count) % count];
    const next = path[(i + 1) % count];
    const tangent = normalize(next.x - prev.x, next.z - prev.z);
    tangents.push(tangent);
    normals.push({ x: -tangent.z, z: tangent.x }); // left-hand perpendicular
  }
  return { tangents, normals };
}

/** Heading matching this codebase's convention: forward = (sin(heading), cos(heading)). */
export function headingFromTangent(tangent: Vec2): number {
  return Math.atan2(tangent.x, tangent.z);
}
