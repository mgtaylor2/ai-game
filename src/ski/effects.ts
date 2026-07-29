import * as THREE from 'three';
import { CONFIG } from './config';

function createSoftDiscTexture(): THREE.Texture {
  const size = 64;
  const canvas = document.createElement('canvas');
  canvas.width = size;
  canvas.height = size;
  const ctx = canvas.getContext('2d')!;
  const gradient = ctx.createRadialGradient(size / 2, size / 2, 0, size / 2, size / 2, size / 2);
  gradient.addColorStop(0, 'rgba(255,255,255,1)');
  gradient.addColorStop(0.5, 'rgba(255,255,255,0.55)');
  gradient.addColorStop(1, 'rgba(255,255,255,0)');
  ctx.fillStyle = gradient;
  ctx.fillRect(0, 0, size, size);
  const texture = new THREE.CanvasTexture(canvas);
  texture.needsUpdate = true;
  return texture;
}

const SOFT_DISC = createSoftDiscTexture();

/** A fixed-capacity CPU-simulated point-sprite particle pool: never allocates during play, just recycles dead slots. */
class ParticlePool {
  readonly points: THREE.Points;
  private readonly geometry: THREE.BufferGeometry;
  private readonly positions: Float32Array;
  private readonly sizes: Float32Array;
  private readonly alphas: Float32Array;
  private readonly velocities: Float32Array;
  private readonly life: Float32Array;
  private readonly maxLife: Float32Array;
  private cursor = 0;

  constructor(capacity: number, color: THREE.ColorRepresentation, blending: THREE.Blending) {
    this.positions = new Float32Array(capacity * 3);
    this.sizes = new Float32Array(capacity);
    this.alphas = new Float32Array(capacity);
    this.velocities = new Float32Array(capacity * 3);
    this.life = new Float32Array(capacity);
    this.maxLife = new Float32Array(capacity);

    this.geometry = new THREE.BufferGeometry();
    this.geometry.setAttribute('position', new THREE.BufferAttribute(this.positions, 3));
    this.geometry.setAttribute('size', new THREE.BufferAttribute(this.sizes, 1));
    this.geometry.setAttribute('alpha', new THREE.BufferAttribute(this.alphas, 1));

    const material = new THREE.ShaderMaterial({
      uniforms: { uTexture: { value: SOFT_DISC }, uColor: { value: new THREE.Color(color) } },
      vertexShader: `
        attribute float size;
        attribute float alpha;
        varying float vAlpha;
        void main() {
          vAlpha = alpha;
          vec4 mvPosition = modelViewMatrix * vec4(position, 1.0);
          gl_PointSize = clamp(size * (280.0 / max(1.0, -mvPosition.z)), 0.0, 120.0);
          gl_Position = projectionMatrix * mvPosition;
        }
      `,
      fragmentShader: `
        uniform sampler2D uTexture;
        uniform vec3 uColor;
        varying float vAlpha;
        void main() {
          vec4 tex = texture2D(uTexture, gl_PointCoord);
          gl_FragColor = vec4(uColor, 1.0) * tex * vAlpha;
          if (gl_FragColor.a < 0.01) discard;
        }
      `,
      transparent: true,
      depthWrite: false,
      blending,
    });

    this.points = new THREE.Points(this.geometry, material);
    this.points.frustumCulled = false;
  }

  spawn(position: THREE.Vector3, velocity: THREE.Vector3, size: number, lifetime: number): void {
    const i = this.cursor;
    this.cursor = (this.cursor + 1) % this.sizes.length;
    this.positions.set([position.x, position.y, position.z], i * 3);
    this.velocities.set([velocity.x, velocity.y, velocity.z], i * 3);
    this.sizes[i] = size;
    this.life[i] = lifetime;
    this.maxLife[i] = lifetime;
    this.alphas[i] = 1;
  }

  update(dt: number, gravity: number): void {
    const count = this.sizes.length;
    for (let i = 0; i < count; i++) {
      if (this.life[i] <= 0) continue;
      this.life[i] -= dt;
      if (this.life[i] <= 0) {
        this.alphas[i] = 0;
        continue;
      }
      this.positions[i * 3] += this.velocities[i * 3] * dt;
      this.positions[i * 3 + 1] += this.velocities[i * 3 + 1] * dt;
      this.positions[i * 3 + 2] += this.velocities[i * 3 + 2] * dt;
      this.velocities[i * 3 + 1] -= gravity * dt;
      this.alphas[i] = Math.max(0, this.life[i] / this.maxLife[i]);
    }
    (this.geometry.attributes.position as THREE.BufferAttribute).needsUpdate = true;
    (this.geometry.attributes.alpha as THREE.BufferAttribute).needsUpdate = true;
  }
}

const RAND = () => Math.random() * 2 - 1;
/** Lifts the carve ribbon just clear of the snow so it doesn't z-fight with the terrain. */
const TRAIL_GROUND_OFFSET = 0.05;

/** 10 pooled expanding-ring shockwave meshes, reused for landings and pickups alike. */
class ShockwavePool {
  readonly group = new THREE.Group();
  private readonly entries: Array<{ mesh: THREE.Mesh; active: boolean; age: number }> = [];
  private static readonly DURATION = 0.6;

  constructor(count: number) {
    const geometry = new THREE.RingGeometry(0.4, 0.55, 24);
    geometry.rotateX(-Math.PI / 2);
    for (let i = 0; i < count; i++) {
      const material = new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0, side: THREE.DoubleSide, depthWrite: false });
      const mesh = new THREE.Mesh(geometry, material);
      mesh.visible = false;
      this.group.add(mesh);
      this.entries.push({ mesh, active: false, age: 0 });
    }
  }

  trigger(position: THREE.Vector3, color: THREE.ColorRepresentation, scale = 1): void {
    const entry = this.entries.find((e) => !e.active) ?? this.entries[0];
    entry.active = true;
    entry.age = 0;
    entry.mesh.visible = true;
    entry.mesh.position.copy(position);
    entry.mesh.scale.setScalar(0.4 * scale);
    (entry.mesh.material as THREE.MeshBasicMaterial).color.set(color);
    (entry.mesh.material as THREE.MeshBasicMaterial).opacity = 0.85;
  }

  update(dt: number): void {
    for (const entry of this.entries) {
      if (!entry.active) continue;
      entry.age += dt;
      const t = entry.age / ShockwavePool.DURATION;
      if (t >= 1) {
        entry.active = false;
        entry.mesh.visible = false;
        continue;
      }
      entry.mesh.scale.setScalar(0.4 + t * 6);
      (entry.mesh.material as THREE.MeshBasicMaterial).opacity = 0.85 * (1 - t);
    }
  }
}

/** Ring-buffer carve trail ribbon: writes a fresh strip segment behind the board while carving, fading per-vertex over its lifetime. */
class CarveTrail {
  readonly mesh: THREE.Mesh;
  private readonly geometry: THREE.BufferGeometry;
  private readonly positions: Float32Array;
  private readonly birthTimes: Float32Array;
  private writeHead = 0;
  private readonly segments = CONFIG.effects.trailSegments;

  constructor() {
    this.positions = new Float32Array(this.segments * 2 * 3);
    this.birthTimes = new Float32Array(this.segments * 2).fill(-1000);

    const indices: number[] = [];
    for (let i = 0; i < this.segments - 1; i++) {
      const a = i * 2;
      const b = a + 1;
      const c = a + 2;
      const d = a + 3;
      indices.push(a, c, b, b, c, d);
    }

    this.geometry = new THREE.BufferGeometry();
    this.geometry.setAttribute('position', new THREE.BufferAttribute(this.positions, 3));
    this.geometry.setAttribute('birthTime', new THREE.BufferAttribute(this.birthTimes, 1));
    this.geometry.setIndex(indices);
    this.geometry.boundingSphere = new THREE.Sphere(new THREE.Vector3(), 10000);

    const material = new THREE.ShaderMaterial({
      uniforms: { uTime: { value: 0 }, uLifetime: { value: CONFIG.effects.trailLifetime } },
      vertexShader: `
        attribute float birthTime;
        varying float vAge;
        uniform float uTime;
        void main() {
          vAge = uTime - birthTime;
          gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
        }
      `,
      fragmentShader: `
        varying float vAge;
        uniform float uLifetime;
        void main() {
          float alpha = clamp(1.0 - vAge / uLifetime, 0.0, 1.0);
          if (alpha <= 0.001) discard;
          // A carve is a cut into the snow, so the ribbon is a cool shadow tone. Painting it near-white
          // makes it brighter than the slope it sits on and it reads as a stripe stuck to the board.
          gl_FragColor = vec4(0.62, 0.70, 0.84, alpha * 0.3);
        }
      `,
      transparent: true,
      depthWrite: false,
      side: THREE.DoubleSide,
    });

    this.mesh = new THREE.Mesh(this.geometry, material);
    this.mesh.frustumCulled = false;
  }

  write(center: THREE.Vector3, lateralDir: THREE.Vector3, width: number, time: number): void {
    const i = this.writeHead;
    this.writeHead = (this.writeHead + 1) % this.segments;

    const half = width / 2;
    const lx = center.x - lateralDir.x * half;
    const lz = center.z - lateralDir.z * half;
    const rx = center.x + lateralDir.x * half;
    const rz = center.z + lateralDir.z * half;
    const y = center.y + TRAIL_GROUND_OFFSET;

    const base = i * 6;
    this.positions[base] = lx;
    this.positions[base + 1] = y;
    this.positions[base + 2] = lz;
    this.positions[base + 3] = rx;
    this.positions[base + 4] = y;
    this.positions[base + 5] = rz;
    this.birthTimes[i * 2] = time;
    this.birthTimes[i * 2 + 1] = time;

    // Collapse the seam quad. The strip joins consecutive indices, so the pair just ahead of the write
    // head still holds the *oldest* sample -- hundreds of metres away -- and the quad bridging them
    // renders as a long bright streak pinned to the rider. Copying this frame's sample into it makes
    // that quad zero-area until the head advances and overwrites it with real data.
    const next = this.writeHead;
    const nextBase = next * 6;
    this.positions[nextBase] = lx;
    this.positions[nextBase + 1] = y;
    this.positions[nextBase + 2] = lz;
    this.positions[nextBase + 3] = rx;
    this.positions[nextBase + 4] = y;
    this.positions[nextBase + 5] = rz;
    this.birthTimes[next * 2] = time;
    this.birthTimes[next * 2 + 1] = time;

    (this.geometry.attributes.position as THREE.BufferAttribute).needsUpdate = true;
    (this.geometry.attributes.birthTime as THREE.BufferAttribute).needsUpdate = true;
  }

  setTime(time: number): void {
    (this.mesh.material as THREE.ShaderMaterial).uniforms.uTime.value = time;
  }

  /** Ages every segment out instantly, so a restart doesn't leave a ribbon stretched across the mountain. */
  clear(): void {
    this.birthTimes.fill(-1000);
    (this.geometry.attributes.birthTime as THREE.BufferAttribute).needsUpdate = true;
  }
}

/** Ambient snowfall wrapped around the camera in 3 parallax layers, so flakes always surround the player without ever being spawned/despawned. */
class Snowfall {
  readonly group = new THREE.Group();
  private readonly layers: Array<{ points: THREE.Points; positions: Float32Array; speed: number; box: THREE.Vector3 }> = [];

  constructor() {
    const box = new THREE.Vector3(CONFIG.effects.snowBoxSize.x, CONFIG.effects.snowBoxSize.y, CONFIG.effects.snowBoxSize.z);
    const layerDefs = [
      { count: 900, speed: 2.2, size: 2.0, opacity: 0.35 },
      { count: 700, speed: 3.6, size: 2.8, opacity: 0.45 },
      { count: 400, speed: 5.2, size: 3.8, opacity: 0.55 },
    ];
    for (const def of layerDefs) {
      const positions = new Float32Array(def.count * 3);
      for (let i = 0; i < def.count; i++) {
        positions[i * 3] = RAND() * box.x * 0.5;
        positions[i * 3 + 1] = RAND() * box.y * 0.5;
        positions[i * 3 + 2] = RAND() * box.z * 0.5;
      }
      const geometry = new THREE.BufferGeometry();
      geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));
      const material = new THREE.ShaderMaterial({
        uniforms: { uTexture: { value: SOFT_DISC }, uSize: { value: def.size }, uOpacity: { value: def.opacity }, uBox: { value: box } },
        vertexShader: `
          uniform float uSize;
          uniform vec3 uBox;
          varying float vFade;
          void main() {
            vec4 mvPosition = modelViewMatrix * vec4(position, 1.0);
            float dist = length(mvPosition.xyz);
            // Fade out flakes very close to the lens as well as at the box edge -- a flake a metre away
            // otherwise covers a huge screen area and reads as a smeared blob rather than snowfall.
            vFade = smoothstep(3.0, 11.0, dist) * (1.0 - smoothstep(uBox.z * 0.42, uBox.z * 0.5, dist));
            gl_PointSize = clamp(uSize * (110.0 / max(2.0, -mvPosition.z)), 0.0, 14.0);
            gl_Position = projectionMatrix * mvPosition;
          }
        `,
        fragmentShader: `
          uniform sampler2D uTexture;
          uniform float uOpacity;
          varying float vFade;
          void main() {
            vec4 tex = texture2D(uTexture, gl_PointCoord);
            gl_FragColor = vec4(1.0, 1.0, 1.0, 1.0) * tex * uOpacity * vFade;
            if (gl_FragColor.a < 0.01) discard;
          }
        `,
        transparent: true,
        depthWrite: false,
      });
      const points = new THREE.Points(geometry, material);
      points.frustumCulled = false;
      this.group.add(points);
      this.layers.push({ points, positions, speed: def.speed, box });
    }
  }

  update(dt: number, cameraPosition: THREE.Vector3): void {
    // The whole snow volume is parented to the camera, so flakes always surround the rider and never
    // need spawning or despawning -- they just wrap around inside the box as they fall.
    this.group.position.copy(cameraPosition);

    for (const layer of this.layers) {
      const halfX = layer.box.x * 0.5;
      const halfY = layer.box.y * 0.5;
      const halfZ = layer.box.z * 0.5;
      const positions = layer.positions;
      const fall = layer.speed * dt;
      for (let i = 0; i < positions.length; i += 3) {
        positions[i + 1] -= fall;
        if (positions[i] < -halfX) positions[i] += layer.box.x;
        else if (positions[i] > halfX) positions[i] -= layer.box.x;
        if (positions[i + 1] < -halfY) positions[i + 1] += layer.box.y;
        else if (positions[i + 1] > halfY) positions[i + 1] -= layer.box.y;
        if (positions[i + 2] < -halfZ) positions[i + 2] += layer.box.z;
        else if (positions[i + 2] > halfZ) positions[i + 2] -= layer.box.z;
      }
      (layer.points.geometry.attributes.position as THREE.BufferAttribute).needsUpdate = true;
    }
  }
}

/** Owns every particle/trail/shockwave system in the game: the visible "feel" layer on top of physics. */
export class SkiEffects {
  readonly group = new THREE.Group();
  readonly trail = new CarveTrail();
  private readonly spray = new ParticlePool(CONFIG.effects.sprayPoolSize, 0xffffff, THREE.AdditiveBlending);
  private readonly powder = new ParticlePool(CONFIG.effects.powderPoolSize, 0xf4f8ff, THREE.NormalBlending);
  readonly shockwaves = new ShockwavePool(CONFIG.effects.shockwavePoolSize);
  readonly snowfall = new Snowfall();
  private time = 0;
  private sprayAccumulator = 0;
  private powderAccumulator = 0;

  constructor() {
    this.group.add(this.trail.mesh, this.spray.points, this.powder.points, this.shockwaves.group, this.snowfall.group);
  }

  update(
    dt: number,
    riderPosition: THREE.Vector3,
    boardLateral: THREE.Vector3,
    boardForward: THREE.Vector3,
    edgeAngle: number,
    slipFactor: number,
    speed: number,
    grounded: boolean,
    cameraPosition: THREE.Vector3,
  ): void {
    this.time += dt;
    this.trail.setTime(this.time);

    if (grounded && speed > CONFIG.effects.trailMinSpeed) {
      const width = 0.35 + (Math.abs(edgeAngle) / CONFIG.physics.maxEdgeAngle) * 0.95;
      this.trail.write(riderPosition, boardLateral, width, this.time);

      const edgeSign = Math.sign(edgeAngle) || 1;
      const sprayRate = 20 + slipFactor * 220 + speed * 3;
      this.sprayAccumulator += sprayRate * dt;
      while (this.sprayAccumulator > 1) {
        this.sprayAccumulator -= 1;
        const origin = riderPosition.clone().addScaledVector(boardLateral, edgeSign * 0.35);
        const vel = boardLateral
          .clone()
          .multiplyScalar(edgeSign * (1.5 + Math.random() * 2))
          .addScaledVector(boardForward, -Math.random() * 1.5)
          .add(new THREE.Vector3(0, 1.5 + Math.random() * 1.5, 0));
        this.spray.spawn(origin, vel, 0.4 + Math.random() * 0.4, 0.5 + Math.random() * 0.3);
      }

      const powderRate = 6 + speed * 1.2;
      this.powderAccumulator += powderRate * dt;
      while (this.powderAccumulator > 1) {
        this.powderAccumulator -= 1;
        const origin = riderPosition.clone().addScaledVector(boardForward, -0.6);
        const vel = boardForward
          .clone()
          .multiplyScalar(-1 - Math.random())
          .add(new THREE.Vector3((Math.random() * 2 - 1) * 1.2, 0.6 + Math.random(), (Math.random() * 2 - 1) * 1.2));
        this.powder.spawn(origin, vel, 1 + Math.random() * 1.2, 0.9 + Math.random() * 0.6);
      }
    }

    this.spray.update(dt, 4);
    this.powder.update(dt, 1.5);
    this.shockwaves.update(dt);
    this.snowfall.update(dt, cameraPosition);
  }

  /** Clears carried-over state between runs (currently just the carve ribbon; particles age out on their own). */
  reset(): void {
    this.trail.clear();
  }

  burst(position: THREE.Vector3, count: number, heavy: boolean): void {
    for (let i = 0; i < count; i++) {
      const angle = Math.random() * Math.PI * 2;
      const speed = (heavy ? 4 : 2) + Math.random() * (heavy ? 5 : 3);
      const vel = new THREE.Vector3(Math.cos(angle) * speed, 2 + Math.random() * 3, Math.sin(angle) * speed);
      this.powder.spawn(position, vel, 0.8 + Math.random(), 0.6 + Math.random() * 0.5);
    }
  }

  triggerShockwave(position: THREE.Vector3, color: THREE.ColorRepresentation, scale = 1): void {
    this.shockwaves.trigger(position, color, scale);
  }
}
