import * as THREE from 'three';
import { createToonMaterial } from './toon';

export interface GameScene {
  scene: THREE.Scene;
  camera: THREE.PerspectiveCamera;
  renderer: THREE.WebGLRenderer;
  /** Advances purely decorative scene animation (clouds, etc); safe to call every frame regardless of screen state. */
  update: (dt: number) => void;
}

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

function createSkyDome(): THREE.Mesh {
  const canvas = document.createElement('canvas');
  canvas.width = 2;
  canvas.height = 256;
  const context = canvas.getContext('2d');
  if (!context) throw new Error('Canvas 2D context is unavailable');
  const gradient = context.createLinearGradient(0, 0, 0, 256);
  gradient.addColorStop(0, '#4fb4ea');
  gradient.addColorStop(0.55, '#8fd8f5');
  gradient.addColorStop(1, '#eaf7ff');
  context.fillStyle = gradient;
  context.fillRect(0, 0, 2, 256);
  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  const geometry = new THREE.SphereGeometry(400, 24, 16);
  const material = new THREE.MeshBasicMaterial({ map: texture, side: THREE.BackSide, fog: false });
  return new THREE.Mesh(geometry, material);
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
  scene.background = new THREE.Color(0xeaf7ff);
  scene.fog = new THREE.Fog(0x8fd8f5, 55, 160);
  scene.add(createSkyDome());

  const camera = new THREE.PerspectiveCamera(60, window.innerWidth / window.innerHeight, 0.1, 1000);
  camera.position.set(0, 8, 30);

  const renderer = new THREE.WebGLRenderer({ canvas, antialias: true });
  renderer.setSize(window.innerWidth, window.innerHeight);
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 1.15;
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = THREE.PCFSoftShadowMap;

  const hemiLight = new THREE.HemisphereLight(0xfff2d9, 0x315a43, 1.7);
  scene.add(hemiLight);

  const sunLight = new THREE.DirectionalLight(0xfff0d0, 2.3);
  sunLight.position.set(30, 50, 20);
  sunLight.castShadow = true;
  sunLight.shadow.mapSize.set(2048, 2048);
  sunLight.shadow.camera.left = -60;
  sunLight.shadow.camera.right = 60;
  sunLight.shadow.camera.top = 60;
  sunLight.shadow.camera.bottom = -60;
  sunLight.shadow.bias = -0.0005;
  scene.add(sunLight);

  const clouds = createClouds(scene);
  const update = (dt: number): void => {
    for (const cloud of clouds) {
      cloud.group.position.x += cloud.speed * dt;
      if (cloud.group.position.x > CLOUD_WRAP_LIMIT) cloud.group.position.x = -CLOUD_WRAP_LIMIT;
    }
  };

  window.addEventListener('resize', () => {
    camera.aspect = window.innerWidth / window.innerHeight;
    camera.updateProjectionMatrix();
    renderer.setSize(window.innerWidth, window.innerHeight);
  });

  return { scene, camera, renderer, update };
}
