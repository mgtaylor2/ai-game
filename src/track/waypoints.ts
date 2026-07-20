import * as THREE from 'three';

/** A point on the racing line, in world coordinates on the ground plane. */
export interface Waypoint {
  x: number;
  z: number;
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
