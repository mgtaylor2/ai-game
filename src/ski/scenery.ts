import * as THREE from 'three';
import { CONFIG } from './config';
import { noise3Octave } from './rng';
import { SUN_LAYER } from './postprocessing';

/** Matches `SUN_DISTANCE` in main.ts: the sun billboard sits this far along the sun direction. */
const SUN_DISTANCE = 1900;
const SCRATCH_SUN = new THREE.Vector3();

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
        // Gamma-shaped so blue arrives well before the zenith. A near-linear ramp leaves the whole
        // upper half of a downhill-facing view sitting on the pale horizon colour, which reads as
        // overcast rather than bluebird.
        float t = pow(clamp(vDir.y * 1.15 + 0.06, 0.0, 1.0), 0.6);
        vec3 color = mix(uHorizon, uTop, t);
        float sunDot = max(dot(normalize(vDir), normalize(uSunDirection)), 0.0);
        color += uHalo * pow(sunDot, 26.0) * 0.55;
        color += uHalo * pow(sunDot, 5.0) * 0.08;
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

    // +distance, not -distance: the run always heads toward +z and the camera looks that way, so a
    // ridge at -distance sits permanently behind the player and is never seen.
    positions.push(x, baseY, distance);
    positions.push(x, peakHeight, distance);

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
  private readonly ridgeLayers: Array<{ mesh: THREE.Mesh; followFactor: number; heightOffset: number }> = [];
  private readonly clouds: Array<{ mesh: THREE.Mesh; drift: number; offsetX: number; height: number; depth: number; driftX: number }> = [];
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
      this.ridgeLayers.push({ mesh, followFactor: layer.followFactor, heightOffset: layer.heightOffset });
    });

    const forestMesh = buildRidge(650, 70, forestColor, forestColor, haze, 99);
    this.group.add(forestMesh);
    this.ridgeLayers.push({ mesh: forestMesh, followFactor: 0.97, heightOffset: -40 });

    const elevationRad = THREE.MathUtils.degToRad(CONFIG.scenery.sunElevationDeg);
    const azimuthRad = THREE.MathUtils.degToRad(CONFIG.scenery.sunAzimuthDeg);
    const horizontal = Math.cos(elevationRad);
    this.sunDirection = new THREE.Vector3(
      horizontal * Math.sin(azimuthRad),
      Math.sin(elevationRad),
      horizontal * Math.cos(azimuthRad),
    ).normalize();

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
    this.sunDisc.scale.set(70, 70, 1);
    // Own layer so the god-ray occlusion pass can draw the disc separately from the black-override world.
    this.sunDisc.layers.set(SUN_LAYER);
    const haloMaterial = new THREE.SpriteMaterial({
      map: SOFT_DOT,
      color: CONFIG.visual.sunHalo,
      transparent: true,
      opacity: 0.32,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
      fog: false,
    });
    this.sunHalo = new THREE.Sprite(haloMaterial);
    this.sunHalo.scale.set(300, 300, 1);
    this.group.add(this.sunHalo, this.sunDisc);

    for (let i = 0; i < CONFIG.scenery.cloudCount; i++) {
      const geometry = new THREE.PlaneGeometry(900 + i * 150, 300 + i * 60);
      const material = new THREE.MeshBasicMaterial({
        map: createCloudTexture(i * 3.7),
        transparent: true,
        opacity: 0.85,
        depthWrite: false,
        fog: false,
      });
      const mesh = new THREE.Mesh(geometry, material);
      mesh.rotation.x = -0.05;
      this.group.add(mesh);
      // Positive depth for the same reason as the ridges: everything scenic has to be down-slope.
      this.clouds.push({ mesh, drift: 1.5 + i * 0.4, offsetX: (i - 1.5) * 400, height: 240 + i * 55, depth: 1500 + i * 220, driftX: 0 });
    }
  }

  update(dt: number, cameraPosition: THREE.Vector3, riderPosition: THREE.Vector3): void {
    this.sky.position.copy(cameraPosition);

    for (const layer of this.ridgeLayers) {
      // Follow the camera in Y as well as X/Z. The run descends hundreds of metres, so ridges pinned to
      // world y=0 would climb out of frame and eventually sit overhead instead of on the horizon.
      layer.mesh.position.set(
        cameraPosition.x * layer.followFactor,
        cameraPosition.y + layer.heightOffset,
        cameraPosition.z * layer.followFactor,
      );
    }

    for (const cloud of this.clouds) {
      // Drift is accumulated separately: writing it into position.x and then overwriting position.x from
      // the camera (as an earlier version did) silently threw the drift away every frame.
      cloud.driftX += dt * cloud.drift;
      cloud.mesh.position.set(
        cameraPosition.x * 0.96 + cloud.offsetX + Math.sin(cloud.driftX * 0.02) * 160,
        cameraPosition.y + cloud.height,
        cameraPosition.z * 0.96 + cloud.depth,
      );
    }

    const sunPos = SCRATCH_SUN.copy(cameraPosition).addScaledVector(this.sunDirection, SUN_DISTANCE);
    this.sunDisc.position.copy(sunPos);
    this.sunHalo.position.copy(sunPos);
    this.skyMaterial.uniforms.uSunDirection.value.copy(this.sunDirection);

    this.sunLight.position.copy(riderPosition).addScaledVector(this.sunDirection, 120);
    this.sunLight.target.position.copy(riderPosition);
    this.sunLight.target.updateMatrixWorld();
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
