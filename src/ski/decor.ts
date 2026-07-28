import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';

const SNOW = new THREE.Color(0xf4f8ff);
const PINE_DARK = new THREE.Color(0x1f4d33);
const PINE_LIGHT = new THREE.Color(0x2c6944);
const TRUNK = new THREE.Color(0x4a3728);
const ROCK_GREY = new THREE.Color(0x767a7f);
const ROCK_DARK = new THREE.Color(0x53565c);
const LOG_BROWN = new THREE.Color(0x5c4330);

/** The one shared material for every decor instance (pines, rocks, logs, bushes): flat-shaded, vertex-colored. */
export const decorMaterial = new THREE.MeshStandardMaterial({ vertexColors: true, flatShading: true, roughness: 0.85 });

function paint(geometry: THREE.BufferGeometry, color: THREE.Color): THREE.BufferGeometry {
  const count = geometry.attributes.position.count;
  const colors = new Float32Array(count * 3);
  for (let i = 0; i < count; i++) colors.set([color.r, color.g, color.b], i * 3);
  geometry.setAttribute('color', new THREE.BufferAttribute(colors, 3));
  return geometry;
}

/** Stacked cones (3 tiers, shrinking upward) with a lighter snow-cap cone on each tier, on a trunk cylinder. */
export function createPineGeometry(variant: number): THREE.BufferGeometry {
  const heightScale = 1 + variant * 0.18;
  const parts: THREE.BufferGeometry[] = [];

  const trunk = new THREE.CylinderGeometry(0.12, 0.16, 0.6 * heightScale, 6);
  trunk.translate(0, 0.3 * heightScale, 0);
  parts.push(paint(trunk, TRUNK));

  const tierCount = 3;
  let y = 0.55 * heightScale;
  for (let tier = 0; tier < tierCount; tier++) {
    const radius = (1.1 - tier * 0.28) * heightScale;
    const coneHeight = (1.15 - tier * 0.2) * heightScale;
    const cone = new THREE.ConeGeometry(radius, coneHeight, 7);
    cone.translate(0, y + coneHeight / 2, 0);
    parts.push(paint(cone, tier % 2 === 0 ? PINE_DARK : PINE_LIGHT));

    const cap = new THREE.ConeGeometry(radius * 0.55, coneHeight * 0.4, 7);
    cap.translate(0, y + coneHeight - coneHeight * 0.12, 0);
    parts.push(paint(cap, SNOW));

    y += coneHeight * 0.72;
  }

  const merged = mergeGeometries(parts, false) as THREE.BufferGeometry;
  merged.computeVertexNormals();
  return merged;
}

/** Icosahedron with per-vertex radial noise displacement and snow coloring on upward-facing faces. */
export function createRockGeometry(seedRandom: () => number): THREE.BufferGeometry {
  const geometry = new THREE.IcosahedronGeometry(0.9, 1).toNonIndexed();
  const position = geometry.attributes.position as THREE.BufferAttribute;
  const displaced = new Float32Array(position.count * 3);
  const v = new THREE.Vector3();
  for (let i = 0; i < position.count; i++) {
    v.fromBufferAttribute(position, i);
    const scale = 1 + (seedRandom() * 2 - 1) * 0.28;
    v.multiplyScalar(scale);
    displaced.set([v.x, v.y, v.z], i * 3);
  }
  geometry.setAttribute('position', new THREE.BufferAttribute(displaced, 3));

  const colors = new Float32Array(position.count * 3);
  const a = new THREE.Vector3();
  const b = new THREE.Vector3();
  const c = new THREE.Vector3();
  const faceNormal = new THREE.Vector3();
  for (let i = 0; i < position.count; i += 3) {
    a.set(displaced[i * 3], displaced[i * 3 + 1], displaced[i * 3 + 2]);
    b.set(displaced[(i + 1) * 3], displaced[(i + 1) * 3 + 1], displaced[(i + 1) * 3 + 2]);
    c.set(displaced[(i + 2) * 3], displaced[(i + 2) * 3 + 1], displaced[(i + 2) * 3 + 2]);
    faceNormal.subVectors(b, a).cross(c.clone().sub(a)).normalize();
    const snowy = faceNormal.y > 0.45;
    const color = snowy ? SNOW : seedRandom() > 0.5 ? ROCK_GREY : ROCK_DARK;
    for (let j = 0; j < 3; j++) colors.set([color.r, color.g, color.b], (i + j) * 3);
  }
  geometry.setAttribute('color', new THREE.BufferAttribute(colors, 3));
  geometry.computeVertexNormals();
  return geometry;
}

/** A horizontal cylinder with a thin snow strip merged along its top. */
export function createLogGeometry(): THREE.BufferGeometry {
  const body = new THREE.CylinderGeometry(0.28, 0.28, 2.6, 8);
  body.rotateZ(Math.PI / 2);
  paint(body, LOG_BROWN);

  const strip = new THREE.BoxGeometry(2.6, 0.12, 0.3);
  strip.translate(0, 0.26, 0);
  paint(strip, SNOW);

  const merged = mergeGeometries([body, strip], false) as THREE.BufferGeometry;
  merged.computeVertexNormals();
  return merged;
}

/** A small snow-lump bush: a squashed, lightly noised icosahedron. */
export function createBushGeometry(): THREE.BufferGeometry {
  const geometry = new THREE.IcosahedronGeometry(0.45, 0);
  geometry.scale(1, 0.55, 1);
  paint(geometry, SNOW);
  geometry.computeVertexNormals();
  return geometry;
}

const HIDDEN_MATRIX = new THREE.Matrix4().makeScale(0, 0, 0);

/** A fixed-capacity InstancedMesh with a free-list, so decor/pickups/effects are pooled and never reallocated during play. */
export class InstancedPool {
  readonly mesh: THREE.InstancedMesh;
  private readonly freeIndices: number[];

  constructor(geometry: THREE.BufferGeometry, material: THREE.Material, capacity: number, castShadow = true) {
    this.mesh = new THREE.InstancedMesh(geometry, material, capacity);
    this.mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    this.mesh.castShadow = castShadow;
    this.mesh.receiveShadow = true;
    this.mesh.count = capacity;
    this.freeIndices = [];
    for (let i = capacity - 1; i >= 0; i--) {
      this.mesh.setMatrixAt(i, HIDDEN_MATRIX);
      this.freeIndices.push(i);
    }
  }

  alloc(): number | null {
    return this.freeIndices.length > 0 ? this.freeIndices.pop()! : null;
  }

  free(index: number): void {
    this.mesh.setMatrixAt(index, HIDDEN_MATRIX);
    this.freeIndices.push(index);
  }

  set(index: number, matrix: THREE.Matrix4, color?: THREE.Color): void {
    this.mesh.setMatrixAt(index, matrix);
    if (color) this.mesh.setColorAt(index, color);
  }

  setVisible(index: number, matrix: THREE.Matrix4, visible: boolean): void {
    this.mesh.setMatrixAt(index, visible ? matrix : HIDDEN_MATRIX);
  }

  flush(): void {
    this.mesh.instanceMatrix.needsUpdate = true;
    if (this.mesh.instanceColor) this.mesh.instanceColor.needsUpdate = true;
  }
}
