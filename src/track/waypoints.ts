import * as THREE from 'three';

/** A point on the racing line, in world coordinates on the ground plane. */
export interface Waypoint {
  x: number;
  z: number;
}

/**
 * Ordered loop of waypoints along the corridor midline (the rectangle x=±30, z=±17.5),
 * defining the racing direction: down the right straight (−Z), along the bottom (−X),
 * up the left straight (+Z), along the top (+X). The first waypoint, (30, 10), sits
 * just after the finish line (z=17); the finish crossing happens between the last
 * waypoint and the first.
 */
export function createRingWaypoints(): Waypoint[] {
  return [
    // Right straight, heading -Z (starts just past the finish line at z=17)
    { x: 30, z: 10 },
    { x: 30, z: 0 },
    { x: 30, z: -10 },
    { x: 30, z: -17.5 }, // bottom-right corner
    // Bottom straight, heading -X
    { x: 15, z: -17.5 },
    { x: 0, z: -17.5 },
    { x: -15, z: -17.5 },
    { x: -30, z: -17.5 }, // bottom-left corner
    // Left straight, heading +Z
    { x: -30, z: -10 },
    { x: -30, z: 0 },
    { x: -30, z: 10 },
    { x: -30, z: 17.5 }, // top-left corner
    // Top straight, heading +X
    { x: -15, z: 17.5 },
    { x: 0, z: 17.5 },
    { x: 15, z: 17.5 },
    { x: 30, z: 17.5 }, // top-right corner, just before the finish line
  ];
}

/**
 * Builds a debug visualization: one small bright sphere per waypoint, with the first
 * waypoint larger and magenta so the loop's start/direction is obvious.
 */
export function createWaypointDebugGroup(waypoints: Waypoint[]): THREE.Group {
  const group = new THREE.Group();

  waypoints.forEach((waypoint, index) => {
    const isFirst = index === 0;
    const color = isFirst ? 0xff00ff : 0x00ffff;
    const material = new THREE.MeshStandardMaterial({
      color,
      emissive: color,
      emissiveIntensity: 0.7,
    });
    const sphere = new THREE.Mesh(new THREE.SphereGeometry(isFirst ? 0.8 : 0.5, 12, 12), material);
    sphere.position.set(waypoint.x, 1, waypoint.z);
    group.add(sphere);
  });

  return group;
}
