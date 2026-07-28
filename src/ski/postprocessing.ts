import * as THREE from 'three';
import { EffectComposer } from 'three/examples/jsm/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/examples/jsm/postprocessing/RenderPass.js';
import { ShaderPass } from 'three/examples/jsm/postprocessing/ShaderPass.js';
import { UnrealBloomPass } from 'three/examples/jsm/postprocessing/UnrealBloomPass.js';
import { OutputPass } from 'three/examples/jsm/postprocessing/OutputPass.js';
import { SMAAPass } from 'three/examples/jsm/postprocessing/SMAAPass.js';
import { FullScreenQuad } from 'three/examples/jsm/postprocessing/Pass.js';
import { CONFIG } from './config';

const UBER_A_VERTEX = `
  varying vec2 vUv;
  void main() {
    vUv = uv;
    gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
  }
`;

const UBER_A_FRAGMENT = `
  #include <packing>
  uniform sampler2D tDiffuse;
  uniform sampler2D tDepth;
  uniform sampler2D tGodray;
  uniform vec2 uResolution;
  uniform bool uDofEnabled;
  uniform bool uGodraysEnabled;
  uniform float uNear;
  uniform float uFar;
  uniform float uDofStart;
  uniform float uDofRange;
  uniform vec2 uSunScreen;
  uniform float uSunVisible;
  uniform float uSpeed01;
  uniform float uBoosting;
  varying vec2 vUv;

  float readDepth(vec2 uv) {
    float depth = unpackRGBAToDepth(texture2D(tDepth, uv));
    float viewZ = perspectiveDepthToViewZ(depth, uNear, uFar);
    return -viewZ;
  }

  void main() {
    vec4 color = texture2D(tDiffuse, vUv);

    if (uDofEnabled) {
      float dist = readDepth(vUv);
      float coc = clamp((dist - uDofStart) / uDofRange, 0.0, 1.0);
      if (coc > 0.001) {
        vec2 px = coc * 3.2 / uResolution;
        vec4 sum = color * 0.227;
        sum += texture2D(tDiffuse, vUv + vec2(0.87, 0.35) * px) * 0.11;
        sum += texture2D(tDiffuse, vUv - vec2(0.87, 0.35) * px) * 0.11;
        sum += texture2D(tDiffuse, vUv + vec2(0.35, -0.87) * px) * 0.11;
        sum += texture2D(tDiffuse, vUv - vec2(0.35, -0.87) * px) * 0.11;
        sum += texture2D(tDiffuse, vUv + vec2(1.3, 0.0) * px) * 0.086;
        sum += texture2D(tDiffuse, vUv - vec2(1.3, 0.0) * px) * 0.086;
        sum += texture2D(tDiffuse, vUv + vec2(0.0, 1.3) * px) * 0.086;
        color = mix(color, sum, coc);
      }
    }

    vec2 centered = vUv - 0.5;
    float radial = length(centered);
    float streak = smoothstep(CONFIG_SPEED_THRESHOLD, CONFIG_SPEED_THRESHOLD + 12.0, uSpeed01 * 60.0 + uBoosting * 40.0);
    if (streak > 0.0) {
      vec2 dir = normalize(centered + 0.0001);
      vec4 streakSum = vec4(0.0);
      float total = 0.0;
      for (int i = 0; i < 5; i++) {
        float t = float(i) / 4.0;
        vec2 uv = vUv - dir * t * radial * 0.06 * streak;
        streakSum += texture2D(tDiffuse, uv);
        total += 1.0;
      }
      color = mix(color, streakSum / total, 0.35 * streak);
    }

    if (uGodraysEnabled) {
      vec3 rays = texture2D(tGodray, vUv).rgb;
      float edgeFade = 1.0 - smoothstep(0.45, 0.85, radial);
      float centerDim = smoothstep(0.0, 0.08, length(vUv - uSunScreen));
      color.rgb += rays * vec3(1.0, 0.82, 0.55) * edgeFade * mix(0.3, 1.0, centerDim) * uSunVisible;
    }

    gl_FragColor = color;
  }
`.replaceAll('CONFIG_SPEED_THRESHOLD', (CONFIG.post.speedStreakThreshold - 20).toFixed(1));

const UBER_B_FRAGMENT = `
  uniform sampler2D tDiffuse;
  uniform float uTime;
  uniform float uAberration;
  uniform float uBoosting;
  uniform float uBoundaryWarning;
  uniform float uContrast;
  uniform float uSaturation;
  uniform float uVignette;
  uniform float uGrain;
  varying vec2 vUv;

  vec3 grade(vec3 color) {
    vec3 shadows = vec3(0.0, 0.02, 0.05);
    vec3 highlights = vec3(0.06, 0.03, -0.02);
    float luma = dot(color, vec3(0.299, 0.587, 0.114));
    color += shadows * (1.0 - smoothstep(0.0, 0.5, luma));
    color += highlights * smoothstep(0.4, 1.0, luma);
    color = (color - 0.5) * uContrast + 0.5;
    float g = dot(color, vec3(0.299, 0.587, 0.114));
    color = mix(vec3(g), color, uSaturation);
    return color;
  }

  float hash(vec2 p) {
    return fract(sin(dot(p, vec2(12.9898, 78.233))) * 43758.5453);
  }

  void main() {
    vec2 centered = vUv - 0.5;
    float dist = length(centered);
    vec2 dir = normalize(centered + 0.0001);
    float amount = uAberration * (0.3 + dist * 1.4);
    float r = texture2D(tDiffuse, vUv + dir * amount).r;
    float g = texture2D(tDiffuse, vUv).g;
    float b = texture2D(tDiffuse, vUv - dir * amount).b;
    vec3 color = vec3(r, g, b);

    color = grade(color);
    color = mix(color, color * vec3(1.08, 0.98, 0.85), uBoosting * 0.5);
    color = mix(color, color * vec3(1.15, 0.9, 0.85), uBoundaryWarning * 0.35);

    float vignette = smoothstep(0.85, 0.25, dist * (1.0 + uBoundaryWarning * 0.3));
    color *= mix(1.0 - uVignette, 1.0, vignette);
    color += uBoundaryWarning * vec3(0.12, 0.0, 0.0) * (1.0 - vignette);

    float grainTime = mod(uTime * 60.0, 1000.0);
    float grain = (hash(vUv * 800.0 + grainTime) - 0.5) * uGrain;
    color += grain;

    gl_FragColor = vec4(color, 1.0);
  }
`;

const OCCLUDER_MATERIAL = new THREE.MeshBasicMaterial({ color: 0x000000 });
const DEPTH_MATERIAL = new THREE.MeshDepthMaterial({ depthPacking: THREE.RGBADepthPacking });

const GODRAY_FRAGMENT = `
  uniform sampler2D tDiffuse;
  uniform vec2 uSunScreen;
  varying vec2 vUv;
  void main() {
    vec2 dir = (uSunScreen - vUv);
    vec4 sum = vec4(0.0);
    vec2 uv = vUv;
    float decay = 1.0;
    const int SAMPLES = 32;
    for (int i = 0; i < SAMPLES; i++) {
      uv += dir * (1.0 / float(SAMPLES)) * 0.9;
      sum += texture2D(tDiffuse, uv) * decay;
      decay *= 0.94;
    }
    gl_FragColor = (sum / float(SAMPLES)) * 2.2;
  }
`;

export interface PostProcessingFrame {
  sunWorldPosition: THREE.Vector3;
  sunHalo: THREE.Object3D;
  speed01: number;
  boosting: boolean;
  boundaryWarning: number;
  impactPulse: number;
  elapsed: number;
}

/** EffectComposer chain: bloom, then a DOF+motion-blur+god-rays pass, then a chromatic-aberration/grade/vignette/grain pass, SMAA, ACES output. */
export class PostProcessing {
  private readonly renderer: THREE.WebGLRenderer;
  private readonly scene: THREE.Scene;
  private readonly camera: THREE.PerspectiveCamera;
  private readonly composer: EffectComposer;
  private readonly bloomPass: UnrealBloomPass;
  private readonly uberAPass: ShaderPass;
  private readonly uberBPass: ShaderPass;

  private readonly depthTarget: THREE.WebGLRenderTarget;
  private readonly occlusionTarget: THREE.WebGLRenderTarget;
  private readonly godrayTarget: THREE.WebGLRenderTarget;
  private readonly godrayQuad: FullScreenQuad;
  private readonly godrayMaterial: THREE.ShaderMaterial;

  private dofEnabled = true;
  private godraysEnabled = true;
  private impactAberration = 0;

  constructor(renderer: THREE.WebGLRenderer, scene: THREE.Scene, camera: THREE.PerspectiveCamera, width: number, height: number) {
    this.renderer = renderer;
    this.scene = scene;
    this.camera = camera;

    const renderTarget = new THREE.WebGLRenderTarget(width, height, { type: THREE.HalfFloatType });
    this.composer = new EffectComposer(renderer, renderTarget);
    this.composer.addPass(new RenderPass(scene, camera));

    this.bloomPass = new UnrealBloomPass(new THREE.Vector2(width, height), CONFIG.post.bloomStrength, CONFIG.post.bloomRadius, CONFIG.post.bloomThreshold);
    this.composer.addPass(this.bloomPass);

    this.depthTarget = new THREE.WebGLRenderTarget(Math.ceil(width / 2), Math.ceil(height / 2));
    this.occlusionTarget = new THREE.WebGLRenderTarget(Math.ceil(width / 4), Math.ceil(height / 4));
    this.godrayTarget = new THREE.WebGLRenderTarget(Math.ceil(width / 4), Math.ceil(height / 4));
    this.godrayMaterial = new THREE.ShaderMaterial({
      uniforms: { tDiffuse: { value: this.occlusionTarget.texture }, uSunScreen: { value: new THREE.Vector2(0.5, 0.5) } },
      vertexShader: UBER_A_VERTEX,
      fragmentShader: GODRAY_FRAGMENT,
    });
    this.godrayQuad = new FullScreenQuad(this.godrayMaterial);

    this.uberAPass = new ShaderPass(
      new THREE.ShaderMaterial({
        uniforms: {
          tDiffuse: { value: null },
          tDepth: { value: this.depthTarget.texture },
          tGodray: { value: this.godrayTarget.texture },
          uResolution: { value: new THREE.Vector2(width, height) },
          uDofEnabled: { value: true },
          uGodraysEnabled: { value: true },
          uNear: { value: camera.near },
          uFar: { value: camera.far },
          uDofStart: { value: CONFIG.post.dofNearStart },
          uDofRange: { value: CONFIG.post.dofNearRange },
          uSunScreen: { value: new THREE.Vector2(0.5, 0.5) },
          uSunVisible: { value: 1 },
          uSpeed01: { value: 0 },
          uBoosting: { value: 0 },
        },
        vertexShader: UBER_A_VERTEX,
        fragmentShader: UBER_A_FRAGMENT,
      }),
      'tDiffuse',
    );
    this.composer.addPass(this.uberAPass);

    // SMAA needs linear-srgb input, so it must run before OutputPass's tonemap + colorspace encode.
    const smaaPass = new SMAAPass();
    this.composer.addPass(smaaPass);

    const outputPass = new OutputPass();
    this.composer.addPass(outputPass);

    this.uberBPass = new ShaderPass(
      new THREE.ShaderMaterial({
        uniforms: {
          tDiffuse: { value: null },
          uTime: { value: 0 },
          uAberration: { value: CONFIG.post.chromaticAberrationBase },
          uBoosting: { value: 0 },
          uBoundaryWarning: { value: 0 },
          uContrast: { value: CONFIG.post.filmicContrast },
          uSaturation: { value: CONFIG.post.filmicSaturation },
          uVignette: { value: CONFIG.post.vignetteStrength },
          uGrain: { value: CONFIG.post.grainStrength },
        },
        vertexShader: UBER_A_VERTEX,
        fragmentShader: UBER_B_FRAGMENT,
      }),
      'tDiffuse',
    );
    this.composer.addPass(this.uberBPass);

    renderer.toneMapping = THREE.ACESFilmicToneMapping;
    renderer.toneMappingExposure = CONFIG.visual.exposure;
  }

  setSize(width: number, height: number): void {
    this.composer.setSize(width, height);
    this.depthTarget.setSize(Math.ceil(width / 2), Math.ceil(height / 2));
    this.occlusionTarget.setSize(Math.ceil(width / 4), Math.ceil(height / 4));
    this.godrayTarget.setSize(Math.ceil(width / 4), Math.ceil(height / 4));
    (this.uberAPass.material as THREE.ShaderMaterial).uniforms.uResolution.value.set(width, height);
  }

  setDofEnabled(enabled: boolean): void {
    this.dofEnabled = enabled;
    (this.uberAPass.material as THREE.ShaderMaterial).uniforms.uDofEnabled.value = enabled;
  }

  setGodraysEnabled(enabled: boolean): void {
    this.godraysEnabled = enabled;
    (this.uberAPass.material as THREE.ShaderMaterial).uniforms.uGodraysEnabled.value = enabled;
  }

  setPixelRatio(ratio: number): void {
    this.renderer.setPixelRatio(ratio);
  }

  triggerImpact(amount: number): void {
    this.impactAberration = Math.min(0.06, this.impactAberration + amount);
  }

  setBloomStrength(strength: number): void {
    this.bloomPass.strength = strength;
  }

  private renderDepthPrepass(): void {
    this.scene.overrideMaterial = DEPTH_MATERIAL;
    this.renderer.setRenderTarget(this.depthTarget);
    this.renderer.clear();
    this.renderer.render(this.scene, this.camera);
    this.scene.overrideMaterial = null;
  }

  private renderGodRays(sunHalo: THREE.Object3D, sunScreen: THREE.Vector2): void {
    const wasVisible = sunHalo.visible;
    sunHalo.visible = false;
    this.scene.overrideMaterial = OCCLUDER_MATERIAL;
    this.renderer.setRenderTarget(this.occlusionTarget);
    this.renderer.clear();
    this.renderer.render(this.scene, this.camera);
    this.scene.overrideMaterial = null;
    sunHalo.visible = wasVisible;

    this.godrayMaterial.uniforms.uSunScreen.value.copy(sunScreen);
    this.renderer.setRenderTarget(this.godrayTarget);
    this.godrayQuad.render(this.renderer);
  }

  render(frame: PostProcessingFrame): void {
    if (this.dofEnabled) this.renderDepthPrepass();

    const projected = frame.sunWorldPosition.clone().project(this.camera);
    const sunScreen = new THREE.Vector2((projected.x + 1) / 2, (projected.y + 1) / 2);
    const sunInFrontOfCamera = projected.z < 1;
    const sunVisible = sunInFrontOfCamera ? 1 : 0;

    if (this.godraysEnabled && sunInFrontOfCamera) this.renderGodRays(frame.sunHalo, sunScreen);

    this.renderer.setRenderTarget(null);

    const uberA = (this.uberAPass.material as THREE.ShaderMaterial).uniforms;
    uberA.uSunScreen.value.copy(sunScreen);
    uberA.uSunVisible.value = sunVisible;
    uberA.uSpeed01.value = frame.speed01;
    uberA.uBoosting.value = frame.boosting ? 1 : 0;

    this.impactAberration *= 0.9;
    const uberB = (this.uberBPass.material as THREE.ShaderMaterial).uniforms;
    uberB.uTime.value = frame.elapsed;
    uberB.uAberration.value = CONFIG.post.chromaticAberrationBase + this.impactAberration * CONFIG.post.chromaticAberrationImpact * 10;
    uberB.uBoosting.value = frame.boosting ? 1 : 0;
    uberB.uBoundaryWarning.value = frame.boundaryWarning;

    this.composer.render();
  }
}
