import * as THREE from 'three';
import { CONFIG } from './config';
import { noise3Octave } from './rng';

function buildSky(): THREE.Mesh {
  const geometry = new THREE.SphereGeometry(2200, 24, 16);
  const material = new THREE.ShaderMaterial({
    uniforms: {
      uTop: { value: new THREE.Color(CONFIG.visual.skyTop) },
      uHorizon: { value: new THREE.Color(CONFIG.visual.skyHorizon) },
      uHalo: { value: new THREE.Color(CONFIG.visual.sunHalo) },
      uSunDirection: { value: new THREE.Vector3(0.3, 0.4, 0.2).normalize() },
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
        float t = clamp(vDir.y * 0.6 + 0.15, 0.0, 1.0);
        vec3 color = mix(uHorizon, uTop, t);
        float sunDot = max(dot(normalize(vDir), normalize(uSunDirection)), 0.0);
        color += uHalo * pow(sunDot, 12.0) * 0.8;
        color += uHalo * pow(sunDot, 3.0) * 0.15;
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

function buildRidge(distance: number, height: number, color: THREE.Color, snowColor: THREE.Color, haze: THREE.Color, seedOffset: number): THREE.Mesh {
  const width = 5000;
  const peakCount = 48;
  const baseY = -height * 0.4;
  const positions: number[] = [];
  const colors: number[] = [];
  const indices: number[] = [];

  for (let i = 0; i <= peakCount; i++) {
    const x = -width / 2 + (i / peakCount) * width;
    const n = noise3Octave(i * 0.35 + seedOffset, seedOffset * 3.1);
    const peakHeight = baseY + height * (0.45 + 0.55 * (0.5 + 0.5 * n));

    positions.push(x, baseY, -distance);
    positions.push(x, peakHeight, -distance);

    const snowLine = baseY + height * 0.62;
    const brightnessJitter = 0.85 + 0.3 * noise3Octave(i * 1.7 + seedOffset, seedOffset);
    const baseColor = color.clone().multiplyScalar(brightnessJitter).lerp(haze, 0.35);
    const peakColor = (peakHeight > snowLine ? snowColor.clone() : color.clone().multiplyScalar(brightnessJitter)).lerp(haze, 0.35);

    colors.push(baseColor.r, baseColor.g, baseColor.b);
    colors.push(peakColor.r, peakColor.g, peakColor.b);
  }

  for (let i = 0; i < peakCount; i++) {
    const a = i * 2;
    const b = a + 1;
    const c = a + 2;
    const d = a + 3;
    indices.push(a, b, c, b, d, c);
  }

  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.BufferAttribute(new Float32Array(positions), 3));
  geometry.setAttribute('color', new THREE.BufferAttribute(new Float32Array(colors), 3));
  geometry.setIndex(indices);
  geometry.computeVertexNormals();

  const material = new THREE.MeshBasicMaterial({ vertexColors: true, fog: false, side: THREE.DoubleSide });
  const mesh = new THREE.Mesh(geometry, material);
  mesh.frustumCulled = false;
  return mesh;
}

function createCloudTexture(seed: number): THREE.Texture {
  const size = 128;
  const canvas = document.createElement('canvas');
  canvas.width = size;
  canvas.height = size;
  const ctx = canvas.getContext('2d')!;
  ctx.clearRect(0, 0, size, size);
  for (let i = 0; i < 14; i++) {
    const n = noise3Octave(i * 3.1 + seed, seed * 2.3);
    const x = size * (0.3 + 0.4 * (0.5 + 0.5 * Math.sin(i * 12.9 + seed)));
    const y = size * (0.4 + 0.3 * (0.5 + 0.5 * n));
    const r = size * (0.18 + 0.12 * Math.abs(n));
    const gradient = ctx.createRadialGradient(x, y, 0, x, y, r);
    gradient.addColorStop(0, 'rgba(255,255,255,0.55)');
    gradient.addColorStop(1, 'rgba(255,255,255,0)');
    ctx.fillStyle = gradient;
    ctx.beginPath();
    ctx.arc(x, y, r, 0, Math.PI * 2);
    ctx.fill();
  }
  const texture = new THREE.CanvasTexture(canvas);
  texture.needsUpdate = true;
  return texture;
}

/** Distant ridges, forest band, drifting cloud planes, sky gradient, and the sun (light + disc + halo). Everything here is deliberately far and slow. */
export class Scenery {
  readonly group = new THREE.Group();
  readonly sunLight: THREE.DirectionalLight;
  readonly hemiLight: THREE.HemisphereLight;
  readonly sunDirection: THREE.Vector3;

  private readonly sky: THREE.Mesh;
  private readonly skyMaterial: THREE.ShaderMaterial;
  private readonly ridgeLayers: Array<{ mesh: THREE.Mesh; followFactor: number }> = [];
  private readonly clouds: Array<{ mesh: THREE.Mesh; drift: number }> = [];
  private readonly sunDisc: THREE.Sprite;
  readonly sunHalo: THREE.Sprite;

  constructor() {
    this.sky = buildSky();
    this.skyMaterial = this.sky.material as THREE.ShaderMaterial;
    this.group.add(this.sky);

    const rockColor = new THREE.Color(0x6b6f76);
    const snowColor = new THREE.Color(CONFIG.visual.snowColor);
    const haze = new THREE.Color(CONFIG.visual.skyHorizon);
    const forestColor = new THREE.Color(0x1c3a2a);

    CONFIG.scenery.ridgeLayers.forEach((layer, i) => {
      const mesh = buildRidge(layer.distance, layer.height, rockColor, snowColor, haze, i * 17.3 + 1);
      this.group.add(mesh);
      this.ridgeLayers.push({ mesh, followFactor: layer.followFactor });
    });

    const forestMesh = buildRidge(650, 70, forestColor, forestColor, haze, 99);
    this.group.add(forestMesh);
    this.ridgeLayers.push({ mesh: forestMesh, followFactor: 0.97 });

    const elevationRad = THREE.MathUtils.degToRad(CONFIG.scenery.sunElevationDeg);
    this.sunDirection = new THREE.Vector3(Math.cos(elevationRad) * 0.5, Math.sin(elevationRad), Math.cos(elevationRad) * 0.85).normalize();

    this.sunLight = new THREE.DirectionalLight(0xfff2d6, CONFIG.scenery.sunIntensity);
    this.sunLight.castShadow = true;
    const shadowMapSize = /Mobi|Android/.test(navigator.userAgent) ? CONFIG.scenery.shadowMapMobile : CONFIG.scenery.shadowMapDesktop;
    this.sunLight.shadow.mapSize.set(shadowMapSize, shadowMapSize);
    const box = CONFIG.scenery.shadowBoxSize;
    this.sunLight.shadow.camera.left = -box;
    this.sunLight.shadow.camera.right = box;
    this.sunLight.shadow.camera.top = box;
    this.sunLight.shadow.camera.bottom = -box;
    this.sunLight.shadow.camera.near = 1;
    this.sunLight.shadow.camera.far = 400;
    this.sunLight.shadow.bias = -0.0015;
    this.sunLight.target = new THREE.Object3D();
    this.group.add(this.sunLight, this.sunLight.target);

    // Pale, desaturated versions of the sky/ground colors: HemisphereLight's full-saturation sky-dome
    // blue at any real intensity oversaturates shadowed snow into deep navy.
    this.hemiLight = new THREE.HemisphereLight(0xdce8f5, 0x554433, 0.45);
    this.group.add(this.hemiLight);

    const discMaterial = new THREE.SpriteMaterial({ map: SOFT_DOT, color: 0xfff6d8, transparent: true, depthWrite: false, fog: false });
    this.sunDisc = new THREE.Sprite(discMaterial);
    this.sunDisc.scale.set(60, 60, 1);
    const haloMaterial = new THREE.SpriteMaterial({
      map: SOFT_DOT,
      color: CONFIG.visual.sunHalo,
      transparent: true,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
      fog: false,
    });
    this.sunHalo = new THREE.Sprite(haloMaterial);
    this.sunHalo.scale.set(220, 220, 1);
    this.group.add(this.sunHalo, this.sunDisc);

    for (let i = 0; i < CONFIG.scenery.cloudCount; i++) {
      const geometry = new THREE.PlaneGeometry(900 + i * 150, 300 + i * 60);
      const material = new THREE.MeshBasicMaterial({
        map: createCloudTexture(i * 3.7),
        transparent: true,
        depthWrite: false,
        fog: false,
      });
      const mesh = new THREE.Mesh(geometry, material);
      mesh.position.set((i - 1.5) * 400, 260 + i * 40, -1600 - i * 220);
      mesh.rotation.x = -0.05;
      this.group.add(mesh);
      this.clouds.push({ mesh, drift: 1.5 + i * 0.4 });
    }
  }

  update(dt: number, cameraPosition: THREE.Vector3, riderPosition: THREE.Vector3): void {
    this.sky.position.copy(cameraPosition);

    for (const layer of this.ridgeLayers) {
      layer.mesh.position.set(cameraPosition.x * layer.followFactor, 0, cameraPosition.z * layer.followFactor);
    }
    for (const cloud of this.clouds) {
      cloud.mesh.position.x += dt * cloud.drift;
      cloud.mesh.position.set(cameraPosition.x * 0.96 + Math.sin(cloud.mesh.position.x * 0.0002) * 100, cloud.mesh.position.y, cameraPosition.z * 0.96 - 1500);
    }

    const sunDistance = 1900;
    const sunPos = cameraPosition.clone().addScaledVector(this.sunDirection, sunDistance);
    this.sunDisc.position.copy(sunPos);
    this.sunHalo.position.copy(sunPos);
    this.skyMaterial.uniforms.uSunDirection.value.copy(this.sunDirection);

    this.sunLight.position.copy(riderPosition).addScaledVector(this.sunDirection, 120);
    this.sunLight.target.position.copy(riderPosition);
  }
}

const SOFT_DOT = (() => {
  const size = 128;
  const canvas = document.createElement('canvas');
  canvas.width = size;
  canvas.height = size;
  const ctx = canvas.getContext('2d')!;
  const gradient = ctx.createRadialGradient(size / 2, size / 2, 0, size / 2, size / 2, size / 2);
  gradient.addColorStop(0, 'rgba(255,255,255,1)');
  gradient.addColorStop(0.4, 'rgba(255,255,255,0.7)');
  gradient.addColorStop(1, 'rgba(255,255,255,0)');
  ctx.fillStyle = gradient;
  ctx.fillRect(0, 0, size, size);
  const texture = new THREE.CanvasTexture(canvas);
  texture.needsUpdate = true;
  return texture;
})();
