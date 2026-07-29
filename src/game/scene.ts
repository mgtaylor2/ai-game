import * as THREE from 'three';
import { createToonMaterial } from './toon';

export interface GameScene {
  scene: THREE.Scene;
  camera: THREE.PerspectiveCamera;
  renderer: THREE.WebGLRenderer;
  sunLight: THREE.DirectionalLight;
  /** Advances purely decorative scene animation (clouds, etc); safe to call every frame regardless of screen state. */
  update: (dt: number) => void;
}

/**
 * Lighting and sky, calibrated the same way as Alpine Rush.
 *
 * The key lessons carried over: keep the key light well off the travel axis so surfaces are side-lit
 * and their form reads; treat the hemisphere light's colours as a pale ambient *tint* rather than the
 * literal sky colour (a full-saturation sky blue drags every shadow toward navy); and pick exposure,
 * bloom threshold and the brightest surface colour together as one budget rather than in isolation.
 */
export const SCENE_CONFIG = {
  skyTop: 0x2a7fd4,
  skyHorizon: 0xcfe9fa,
  sunHalo: 0xfff3d2,
  fogColor: 0xc9e4f5,
  fogNear: 70,
  fogFar: 260,
  /** Degrees above the horizon. High enough to light the track without staring into it. */
  sunElevationDeg: 52,
  /** Degrees around from +Z, so the key light rakes across the circuit instead of down it. */
  sunAzimuthDeg: 128,
  sunIntensity: 2.0,
  exposure: 1.05,
  hemiSky: 0xdfeaf6,
  hemiGround: 0x5c6b46,
  hemiIntensity: 0.95,
} as const;

const CLOUD_SPOTS = [
  { x: -60, y: 34, z: -40 },
  { x: -20, y: 42, z: -70 },
  { x: 30, y: 38, z: -55 },
  { x: 65, y: 30, z: -20 },
  { x: -50, y: 36, z: 30 },
  { x: 40, y: 40, z: 50 },
];
const CLOUD_WRAP_LIMIT = 90;

interface Cloud {
  group: THREE.Group;
  speed: number;
}

/**
 * Sky as a gradient shader on a back-side sphere, with a soft halo baked around the sun direction.
 * A gamma-shaped ramp rather than a linear one, so blue arrives well before the zenith -- a linear
 * ramp leaves most of a low-camera view sitting on the pale horizon colour and reads as overcast.
 */
function createSkyDome(sunDirection: THREE.Vector3): THREE.Mesh {
  const geometry = new THREE.SphereGeometry(600, 32, 20);
  const material = new THREE.ShaderMaterial({
    uniforms: {
      uTop: { value: new THREE.Color(SCENE_CONFIG.skyTop) },
      uHorizon: { value: new THREE.Color(SCENE_CONFIG.skyHorizon) },
      uHalo: { value: new THREE.Color(SCENE_CONFIG.sunHalo) },
      uSunDirection: { value: sunDirection.clone() },
    },
    vertexShader: `
      varying vec3 vDir;
      void main() {
        vDir = normalize(position);
        gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
      }
    `,
    fragmentShader: `
      uniform vec3 uTop;
      uniform vec3 uHorizon;
      uniform vec3 uHalo;
      uniform vec3 uSunDirection;
      varying vec3 vDir;
      void main() {
        float t = pow(clamp(vDir.y * 1.1 + 0.08, 0.0, 1.0), 0.62);
        vec3 color = mix(uHorizon, uTop, t);
        float sunDot = max(dot(normalize(vDir), normalize(uSunDirection)), 0.0);
        color += uHalo * pow(sunDot, 28.0) * 0.5;
        color += uHalo * pow(sunDot, 5.0) * 0.07;
        gl_FragColor = vec4(color, 1.0);
      }
    `,
    side: THREE.BackSide,
    depthWrite: false,
    fog: false,
  });
  const mesh = new THREE.Mesh(geometry, material);
  mesh.renderOrder = -1000;
  return mesh;
}

function createCloud(): THREE.Group {
  const cloud = new THREE.Group();
  const material = createToonMaterial(0xffffff);
  const puffCount = 4 + Math.floor(Math.random() * 3);
  for (let i = 0; i < puffCount; i++) {
    const puff = new THREE.Mesh(new THREE.SphereGeometry(1.2 + Math.random() * 0.6, 10, 8), material);
    puff.position.set((Math.random() - 0.5) * 3.2, (Math.random() - 0.5) * 0.6, (Math.random() - 0.5) * 1.4);
    puff.scale.y = 0.7;
    cloud.add(puff);
  }
  return cloud;
}

function createClouds(scene: THREE.Scene): Cloud[] {
  return CLOUD_SPOTS.map((spot) => {
    const group = createCloud();
    group.position.set(spot.x, spot.y, spot.z);
    group.scale.setScalar(2 + Math.random() * 1.5);
    scene.add(group);
    return { group, speed: 0.6 + Math.random() * 0.5 };
  });
}

export function createScene(canvas: HTMLCanvasElement): GameScene {
  const scene = new THREE.Scene();
  scene.background = new THREE.Color(SCENE_CONFIG.skyHorizon);
  scene.fog = new THREE.Fog(SCENE_CONFIG.fogColor, SCENE_CONFIG.fogNear, SCENE_CONFIG.fogFar);

  const elevation = THREE.MathUtils.degToRad(SCENE_CONFIG.sunElevationDeg);
  const azimuth = THREE.MathUtils.degToRad(SCENE_CONFIG.sunAzimuthDeg);
  const horizontal = Math.cos(elevation);
  const sunDirection = new THREE.Vector3(horizontal * Math.sin(azimuth), Math.sin(elevation), horizontal * Math.cos(azimuth)).normalize();

  scene.add(createSkyDome(sunDirection));

  const camera = new THREE.PerspectiveCamera(60, window.innerWidth / window.innerHeight, 0.1, 1000);
  camera.position.set(0, 8, 30);

  const renderer = new THREE.WebGLRenderer({ canvas, antialias: false });
  renderer.setSize(window.innerWidth, window.innerHeight);
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = SCENE_CONFIG.exposure;
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = THREE.PCFSoftShadowMap;

  const hemiLight = new THREE.HemisphereLight(SCENE_CONFIG.hemiSky, SCENE_CONFIG.hemiGround, SCENE_CONFIG.hemiIntensity);
  scene.add(hemiLight);

  const sunLight = new THREE.DirectionalLight(0xfff4de, SCENE_CONFIG.sunIntensity);
  sunLight.position.copy(sunDirection).multiplyScalar(90);
  sunLight.castShadow = true;
  sunLight.shadow.mapSize.set(2048, 2048);
  sunLight.shadow.camera.left = -70;
  sunLight.shadow.camera.right = 70;
  sunLight.shadow.camera.top = 70;
  sunLight.shadow.camera.bottom = -70;
  sunLight.shadow.camera.far = 300;
  sunLight.shadow.bias = -0.0006;
  sunLight.shadow.normalBias = 0.02;
  scene.add(sunLight);
  scene.add(sunLight.target);

  const clouds = createClouds(scene);
  const update = (dt: number): void => {
    for (const cloud of clouds) {
      cloud.group.position.x += cloud.speed * dt;
      if (cloud.group.position.x > CLOUD_WRAP_LIMIT) cloud.group.position.x = -CLOUD_WRAP_LIMIT;
    }
  };

  return { scene, camera, renderer, sunLight, update };
}
