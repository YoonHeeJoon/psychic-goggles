import * as THREE from 'three';
import { shared, VERT_HEAD, FRAG_HEAD, FRAG_TAIL, litUniforms } from './shaders.js';

// ---------------------------------------------------------------------------
// Anime toon material: two-tone ramp with tinted shadows, rim light, crisp
// specular, optional root->tip colour gradient (hair) and texture.
// ---------------------------------------------------------------------------
const TOON_VERT = /* glsl */ `
${VERT_HEAD}
attribute float aGrad;
varying vec3 vNormalW;
varying vec3 vWorldPos;
varying float vGrad;
varying vec2 vUv;
void main(){
  vec4 worldPosition = modelMatrix * vec4(position, 1.0);
  vec3 transformedNormal = normalMatrix * normal;
  vNormalW = inverseTransformDirection(transformedNormal, viewMatrix);
  vWorldPos = worldPosition.xyz;
  vGrad = aGrad;
  vUv = uv;
  #include <shadowmap_vertex>
  vec4 mvPosition = viewMatrix * worldPosition;
  gl_Position = projectionMatrix * mvPosition;
  #include <fog_vertex>
}
`;

const TOON_FRAG = /* glsl */ `
${FRAG_HEAD}
uniform vec3 uColor;
uniform vec3 uColor2;
uniform float uGradAmt;
uniform vec3 uShadowTint;
uniform vec3 uCharLit;
uniform vec3 uCharShade;
uniform vec3 uSunDir;
uniform float uRim;
uniform float uSpec;
uniform float uEmissive;
uniform float uOpacity;
uniform float uFlash;
uniform float uRampOffset;
uniform sampler2D uMap;
uniform float uUseMap;
varying vec3 vNormalW;
varying vec3 vWorldPos;
varying float vGrad;
varying vec2 vUv;
void main(){
  vec3 N = normalize(vNormalW);
  if (!gl_FrontFacing) N = -N;
  vec3 V = normalize(cameraPosition - vWorldPos);
  vec3 albedo = mix(uColor, uColor2, smoothstep(0.3, 1.0, vGrad) * uGradAmt);
  if (uUseMap > 0.5) albedo *= texture2D(uMap, vUv).rgb;
  float ndl = dot(N, uSunDir);
  float shadow = getShadowMask();
  float lit = smoothstep(uRampOffset - 0.04, uRampOffset + 0.06, ndl);
  lit *= mix(1.0, shadow, 0.9);
  vec3 litCol = albedo * uCharLit;
  vec3 shdCol = albedo * uShadowTint * uCharShade;
  vec3 col = mix(shdCol, litCol, lit);
  float fr = 1.0 - max(dot(N, V), 0.0);
  float rim = smoothstep(0.62, 0.78, fr) * (0.25 + 0.75 * lit);
  col += albedo * uCharLit * rim * uRim;
  vec3 H = normalize(uSunDir + V);
  float sp = smoothstep(0.90, 0.94, dot(N, H)) * lit;
  col += uCharLit * sp * uSpec;
  col += albedo * uEmissive;
  col = mix(col, vec3(1.0, 0.95, 0.9), uFlash);
  gl_FragColor = vec4(col, uOpacity);
  ${FRAG_TAIL}
}
`;

const toonCache = new Map();

export function toonMaterial(opts = {}) {
  const key = JSON.stringify(opts, (k, v) => (v && v.isTexture ? v.uuid : v));
  if (toonCache.has(key) && !opts.unique) return toonCache.get(key);
  const c = new THREE.Color(opts.color ?? '#ffffff');
  const c2 = new THREE.Color(opts.color2 ?? opts.color ?? '#ffffff');
  const tint = new THREE.Color(opts.shadowTint ?? '#c9b8d8');
  const uniforms = Object.assign(litUniforms(), {
    uColor: { value: c },
    uColor2: { value: c2 },
    uGradAmt: { value: opts.color2 ? 1 : 0 },
    uShadowTint: { value: tint },
    uCharLit: shared.uCharLit,
    uCharShade: shared.uCharShade,
    uSunDir: shared.uSunDir,
    uRim: { value: opts.rim ?? 0.35 },
    uSpec: { value: opts.spec ?? 0.0 },
    uEmissive: { value: opts.emissive ?? 0.0 },
    uOpacity: { value: opts.opacity ?? 1.0 },
    uFlash: { value: 0 },
    uRampOffset: { value: opts.ramp ?? 0.0 },
    uMap: { value: opts.map ?? null },
    uUseMap: { value: opts.map ? 1 : 0 },
  });
  const mat = new THREE.ShaderMaterial({
    vertexShader: TOON_VERT,
    fragmentShader: TOON_FRAG,
    uniforms,
    lights: true,
    fog: true,
    side: opts.side ?? THREE.FrontSide,
    transparent: (opts.opacity ?? 1) < 1,
  });
  if (!opts.unique) toonCache.set(key, mat);
  return mat;
}

// ---------------------------------------------------------------------------
// Inverted-hull outline with roughly constant screen-space width.
// ---------------------------------------------------------------------------
const OUTLINE_VERT = /* glsl */ `
#include <common>
#include <fog_pars_vertex>
uniform float uWidth;
void main(){
  vec4 mvPosition = modelViewMatrix * vec4(position, 1.0);
  vec3 n = normalize(normalMatrix * normal);
  float dist = max(-mvPosition.z, 0.3);
  mvPosition.xyz += n * uWidth * clamp(dist, 0.8, 30.0) * 0.0016;
  gl_Position = projectionMatrix * mvPosition;
  #include <fog_vertex>
}
`;
const OUTLINE_FRAG = /* glsl */ `
#include <common>
#include <fog_pars_fragment>
uniform vec3 uOutlineColor;
uniform vec3 uCharLit;
uniform float uOpacity;
void main(){
  gl_FragColor = vec4(uOutlineColor * uCharLit, uOpacity);
  #include <tonemapping_fragment>
  #include <colorspace_fragment>
  #include <fog_fragment>
}
`;
const outlineCache = new Map();
export function outlineMaterial(color = '#2a2230', width = 1) {
  const key = color + '|' + width;
  if (outlineCache.has(key)) return outlineCache.get(key);
  const mat = new THREE.ShaderMaterial({
    vertexShader: OUTLINE_VERT,
    fragmentShader: OUTLINE_FRAG,
    uniforms: Object.assign(THREE.UniformsUtils.clone(THREE.UniformsLib.fog), {
      uWidth: { value: width },
      uOutlineColor: { value: new THREE.Color(color) },
      uCharLit: shared.uCharLit,
      uOpacity: { value: 1 },
    }),
    side: THREE.BackSide,
    fog: true,
  });
  outlineCache.set(key, mat);
  return mat;
}

// Darken + saturate a colour to use as its outline colour.
export function outlineColorFor(hex) {
  const c = new THREE.Color(hex);
  const hsl = {};
  c.getHSL(hsl);
  c.setHSL(hsl.h, Math.min(1, hsl.s * 1.1 + 0.1), hsl.l * 0.28);
  return '#' + c.getHexString();
}

// ---------------------------------------------------------------------------
// Face decal: unlit-ish texture tinted by character lighting.
// ---------------------------------------------------------------------------
export function faceDecalMaterial(texture) {
  return new THREE.ShaderMaterial({
    vertexShader: /* glsl */ `
      #include <common>
      #include <fog_pars_vertex>
      varying vec2 vUv;
      void main(){
        vUv = uv;
        vec4 mvPosition = modelViewMatrix * vec4(position, 1.0);
        gl_Position = projectionMatrix * mvPosition;
        #include <fog_vertex>
      }`,
    fragmentShader: /* glsl */ `
      #include <common>
      #include <fog_pars_fragment>
      uniform sampler2D uMap;
      uniform vec3 uCharLit;
      uniform vec3 uCharShade;
      varying vec2 vUv;
      void main(){
        vec4 t = texture2D(uMap, vUv);
        if (t.a < 0.03) discard;
        vec3 col = t.rgb * mix(uCharShade, uCharLit, 0.88);
        gl_FragColor = vec4(col, t.a);
        #include <tonemapping_fragment>
        #include <colorspace_fragment>
        #include <fog_fragment>
      }`,
    uniforms: Object.assign(THREE.UniformsUtils.clone(THREE.UniformsLib.fog), {
      uMap: { value: texture },
      uCharLit: shared.uCharLit,
      uCharShade: shared.uCharShade,
    }),
    transparent: true,
    depthWrite: false,
    polygonOffset: true,
    polygonOffsetFactor: -2,
    polygonOffsetUnits: -2,
    fog: true,
  });
}

// ---------------------------------------------------------------------------
// Additive glow material for VFX / gems.
// ---------------------------------------------------------------------------
export function glowMaterial(color, opacity = 1, opts = {}) {
  return new THREE.MeshBasicMaterial({
    color: new THREE.Color(color).multiplyScalar(opts.intensity ?? 2.0),
    transparent: true,
    opacity,
    blending: THREE.AdditiveBlending,
    depthWrite: false,
    side: opts.side ?? THREE.FrontSide,
    map: opts.map ?? null,
    toneMapped: true,
    fog: false,
  });
}
