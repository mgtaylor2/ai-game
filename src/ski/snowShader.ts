import * as THREE from 'three';
import type { WebGLProgramParametersWithUniforms } from 'three';
import { CONFIG } from './config';
import { snowMaterial } from './snowMaterial';

const shaderUniforms = {
  uSunDirection: { value: new THREE.Vector3(0.3, 0.8, 0.2).normalize() },
  uTime: { value: 0 },
};

const PISTE_HALF = CONFIG.terrain.pisteHalfWidth.toFixed(1);
const GROOVE_FREQ = CONFIG.snow.grooveFrequency.toFixed(1);
const SPEC_POWER = CONFIG.snow.glitterSpecularPower.toFixed(1);
const GLITTER_GATE = CONFIG.snow.glitterGate.toFixed(3);
const GLITTER_BOOST = CONFIG.snow.glitterBoost.toFixed(2);
const WRAP_STRENGTH = CONFIG.snow.wrapFillStrength.toFixed(3);

/**
 * Extends the shared snow material via onBeforeCompile: groomed-piste corduroy grooves, an off-piste
 * blue tint + micro normal jitter, view-dependent glitter sparkles, and a half-Lambert cool bounce fill
 * in shadowed snow. Everything reads the analytic `lateralDistance` vertex attribute baked in chunks.ts.
 */
snowMaterial.onBeforeCompile = (shader: WebGLProgramParametersWithUniforms) => {
  Object.assign(shader.uniforms, shaderUniforms);

  shader.vertexShader = shader.vertexShader
    .replace(
      '#include <common>',
      `#include <common>
attribute float lateralDistance;
varying float vLateralDistance;
varying vec3 vWorldPos;`,
    )
    .replace(
      '#include <begin_vertex>',
      `#include <begin_vertex>
vLateralDistance = lateralDistance;
vWorldPos = (modelMatrix * vec4(transformed, 1.0)).xyz;`,
    );

  shader.fragmentShader = shader.fragmentShader
    .replace(
      '#include <common>',
      `#include <common>
varying float vLateralDistance;
varying vec3 vWorldPos;
uniform vec3 uSunDirection;
uniform float uTime;`,
    )
    .replace(
      '#include <color_fragment>',
      `#include <color_fragment>
{
  float absLat = abs(vLateralDistance);
  float pisteHalf = ${PISTE_HALF};
  float onPiste = 1.0 - smoothstep(pisteHalf - 4.0, pisteHalf, absLat);
  // Grooves fade out with distance so the high-frequency stripe pattern never aliases into moire on
  // the far end of a chunk; they only exist inside the groomed lane in the first place.
  float grooveFade = 1.0 - smoothstep(60.0, 150.0, length(vWorldPos - cameraPosition));
  float groove = sin(vLateralDistance * ${GROOVE_FREQ}) * 0.05 * onPiste * grooveFade;

  // A distinct darker lip either side of the groomed lane. This is the single strongest read for
  // "you are on the piste" -- without it the corridor and the off-piste snow are the same white sheet.
  float edgeBand = smoothstep(pisteHalf - 2.5, pisteHalf, absLat) * (1.0 - smoothstep(pisteHalf, pisteHalf + 3.0, absLat));
  float offPiste = 1.0 - onPiste;

  diffuseColor.rgb += groove;
  diffuseColor.rgb -= edgeBand * 0.12;
  diffuseColor.rgb = mix(diffuseColor.rgb, diffuseColor.rgb * vec3(0.88, 0.94, 1.06), offPiste * 0.7);
}`,
    )
    .replace(
      'vec3 outgoingLight = totalDiffuse + totalSpecular + totalEmissiveRadiance;',
      `vec3 outgoingLight = totalDiffuse + totalSpecular + totalEmissiveRadiance;
{
  vec3 viewDir = normalize(cameraPosition - vWorldPos);
  vec3 halfDir = normalize(uSunDirection + viewDir);
  float cellHash = fract(sin(dot(floor(vWorldPos.xz * 2.2), vec2(41.3, 289.1))) * 12543.6);
  float gate = step(${GLITTER_GATE}, cellHash);
  float glitterSpec = pow(max(dot(normal, halfDir), 0.0), ${SPEC_POWER});
  float sunUp = max(dot(normal, uSunDirection), 0.0);
  vec3 glitter = vec3(1.0, 0.98, 0.9) * glitterSpec * gate * ${GLITTER_BOOST} * sunUp * (0.7 + 0.3 * sin(uTime * 3.0 + cellHash * 30.0));

  float wrap = pow(dot(normal, uSunDirection) * 0.5 + 0.5, 2.0);
  float shadowed = 1.0 - sunUp;
  vec3 bounce = vec3(0.08, 0.12, 0.2) * wrap * ${WRAP_STRENGTH} * shadowed;

  outgoingLight += glitter + bounce;
}`,
    );
};

snowMaterial.needsUpdate = true;

export function updateSnowShaderUniforms(sunDirection: THREE.Vector3, elapsedSeconds: number): void {
  shaderUniforms.uSunDirection.value.copy(sunDirection).normalize();
  shaderUniforms.uTime.value = elapsedSeconds;
}
