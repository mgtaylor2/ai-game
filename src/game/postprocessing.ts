import * as THREE from 'three';
import { EffectComposer } from 'three/examples/jsm/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/examples/jsm/postprocessing/RenderPass.js';
import { ShaderPass } from 'three/examples/jsm/postprocessing/ShaderPass.js';
import { UnrealBloomPass } from 'three/examples/jsm/postprocessing/UnrealBloomPass.js';
import { OutputPass } from 'three/examples/jsm/postprocessing/OutputPass.js';
import { SMAAPass } from 'three/examples/jsm/postprocessing/SMAAPass.js';

/**
 * The kart racer's grading chain, following the same structure as Alpine Rush's:
 * bloom -> SMAA -> ACES output -> a single "uber" grade pass.
 *
 * SMAA must run *before* OutputPass (it wants linear-sRGB input; a hard three.js constraint), and the
 * grade pass runs last so it operates on final display-referred colour.
 *
 * Deliberately lighter than the ski game's chain: no depth-of-field or god rays. A kart racer is read
 * at speed from a fixed chase camera, so the budget is better spent on speed cues than on focus.
 */

const GRADE_VERTEX = `
  varying vec2 vUv;
  void main() {
    vUv = uv;
    gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
  }
`;

const GRADE_FRAGMENT = `
  uniform sampler2D tDiffuse;
  uniform float uTime;
  uniform float uSpeed01;
  uniform float uAberration;
  uniform float uImpact;
  uniform float uEdgeProximity;
  uniform float uVignette;
  uniform float uGrain;
  uniform float uContrast;
  uniform float uSaturation;
  varying vec2 vUv;

  float hash(vec2 p) {
    return fract(sin(dot(p, vec2(12.9898, 78.233))) * 43758.5453);
  }

  vec3 grade(vec3 color) {
    // Cool lift in the shadows, warm gain in the highlights: the standard sunny-day film look, kept
    // restrained so the bright arcade palette doesn't skew muddy or jaundiced.
    float luma = dot(color, vec3(0.299, 0.587, 0.114));
    color += vec3(0.0, 0.012, 0.04) * (1.0 - smoothstep(0.0, 0.55, luma));
    color += vec3(0.04, 0.025, 0.0) * smoothstep(0.45, 1.0, luma);
    color = (color - 0.5) * uContrast + 0.5;
    float g = dot(color, vec3(0.299, 0.587, 0.114));
    return mix(vec3(g), color, uSaturation);
  }

  void main() {
    vec2 centered = vUv - 0.5;
    float dist = length(centered);
    vec2 dir = normalize(centered + 0.0001);

    // Chromatic aberration grows toward the edges, and spikes briefly on impacts.
    float amount = (uAberration + uImpact * 0.012) * (0.25 + dist * 1.5);
    vec3 color = vec3(
      texture2D(tDiffuse, vUv + dir * amount).r,
      texture2D(tDiffuse, vUv).g,
      texture2D(tDiffuse, vUv - dir * amount).b
    );

    // Radial speed streaks: zero at screen centre, ramping toward the edges with speed. This is the
    // main "you are going fast" cue now that the camera distance is fixed.
    float streak = smoothstep(0.45, 1.0, uSpeed01);
    if (streak > 0.001) {
      vec3 sum = vec3(0.0);
      for (int i = 1; i <= 4; i++) {
        float t = float(i) / 4.0;
        sum += texture2D(tDiffuse, vUv - dir * t * dist * 0.055 * streak).rgb;
      }
      color = mix(color, sum * 0.25, 0.4 * streak * smoothstep(0.15, 0.5, dist));
    }

    color = grade(color);

    // Barrier-scrape warning: a warm dusty wash as the kart drifts out toward the rail, so the
    // edge is felt before it's hit. Same idea as the ski game's off-piste vignette.
    color = mix(color, color * vec3(1.14, 0.98, 0.78), uEdgeProximity * 0.5);

    float vignette = smoothstep(0.9, 0.28, dist);
    color *= mix(1.0 - uVignette, 1.0, vignette);

    // Time is wrapped before it reaches the hash: multiplying a growing time value into UVs makes the
    // grain pattern freeze once the float loses precision, a few minutes into a session.
    float grainTime = mod(uTime * 60.0, 1000.0);
    color += (hash(vUv * 800.0 + grainTime) - 0.5) * uGrain;

    gl_FragColor = vec4(color, 1.0);
  }
`;

export interface RaceFrame {
  /** 0..1 of top speed, driving speed streaks. */
  speed01: number;
  /** 0..1 how close the player is to the road edge; drives the scrape warning tint. */
  edgeProximity: number;
  elapsed: number;
}

export const POST_CONFIG = {
  bloomThreshold: 0.85,
  bloomStrength: 0.38,
  bloomRadius: 0.5,
  aberrationBase: 0.0012,
  vignette: 0.2,
  grain: 0.016,
  contrast: 1.08,
  saturation: 1.12,
} as const;

export class RacePostProcessing {
  private readonly renderer: THREE.WebGLRenderer;
  private readonly composer: EffectComposer;
  private readonly gradePass: ShaderPass;
  private impact = 0;
  private enabled = true;

  constructor(renderer: THREE.WebGLRenderer, scene: THREE.Scene, camera: THREE.Camera, width: number, height: number) {
    this.renderer = renderer;

    const target = new THREE.WebGLRenderTarget(width, height, { type: THREE.HalfFloatType });
    this.composer = new EffectComposer(renderer, target);
    this.composer.addPass(new RenderPass(scene, camera));
    this.composer.addPass(
      new UnrealBloomPass(new THREE.Vector2(width, height), POST_CONFIG.bloomStrength, POST_CONFIG.bloomRadius, POST_CONFIG.bloomThreshold),
    );
    this.composer.addPass(new SMAAPass());
    this.composer.addPass(new OutputPass());

    this.gradePass = new ShaderPass(
      new THREE.ShaderMaterial({
        uniforms: {
          tDiffuse: { value: null },
          uTime: { value: 0 },
          uSpeed01: { value: 0 },
          uAberration: { value: POST_CONFIG.aberrationBase },
          uImpact: { value: 0 },
          uEdgeProximity: { value: 0 },
          uVignette: { value: POST_CONFIG.vignette },
          uGrain: { value: POST_CONFIG.grain },
          uContrast: { value: POST_CONFIG.contrast },
          uSaturation: { value: POST_CONFIG.saturation },
        },
        vertexShader: GRADE_VERTEX,
        fragmentShader: GRADE_FRAGMENT,
      }),
      'tDiffuse',
    );
    this.composer.addPass(this.gradePass);
  }

  setSize(width: number, height: number): void {
    this.composer.setSize(width, height);
  }

  /** Falls back to a plain forward render, for low-end devices or a debug toggle. */
  setEnabled(enabled: boolean): void {
    this.enabled = enabled;
  }

  triggerImpact(amount: number): void {
    this.impact = Math.min(1, this.impact + amount);
  }

  render(scene: THREE.Scene, camera: THREE.Camera, frame: RaceFrame): void {
    if (!this.enabled) {
      this.renderer.setRenderTarget(null);
      this.renderer.render(scene, camera);
      return;
    }

    this.impact *= 0.88;
    const uniforms = (this.gradePass.material as THREE.ShaderMaterial).uniforms;
    uniforms.uTime.value = frame.elapsed;
    uniforms.uSpeed01.value = frame.speed01;
    uniforms.uEdgeProximity.value = frame.edgeProximity;
    uniforms.uImpact.value = this.impact;

    this.composer.render();
  }
}
