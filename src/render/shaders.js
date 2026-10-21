import * as THREE from 'three';

// Uniforms shared by every stylized material. Updated once per frame by the
// Environment (time of day) and the Game (player position, time).
export const shared = {
  uTime: { value: 0 },
  uSunDir: { value: new THREE.Vector3(0.3, 0.8, 0.2).normalize() },
  uSunColor: { value: new THREE.Color(2.4, 2.25, 2.0) },
  uSkyAmb: { value: new THREE.Color(0.35, 0.48, 0.75) },
  uGroundAmb: { value: new THREE.Color(0.22, 0.22, 0.16) },
  uCharLit: { value: new THREE.Color(1.0, 0.98, 0.95) },
  uCharShade: { value: new THREE.Color(0.72, 0.72, 0.86) },
  uZenith: { value: new THREE.Color(0.1, 0.3, 0.8) },
  uHorizon: { value: new THREE.Color(0.6, 0.8, 1.0) },
  uWindDir: { value: new THREE.Vector2(0.8, 0.6).normalize() },
  uWindStrength: { value: 1.0 },
  uPlayerPos: { value: new THREE.Vector3() },
  uNight: { value: 0 },
  uWet: { value: 0 }, // rain wetness 0..1 (weather)
};

// Terrain lookup uniforms (filled in by Terrain once generated).
export const terrainUniforms = {
  uHeightTex: { value: null },
  uColorTex: { value: null },
  uWorldSize: { value: 1024 },
  uRes: { value: 513 },
};

export const NOISE_GLSL = /* glsl */ `
vec3 sw_mod289(vec3 x){ return x - floor(x * (1.0/289.0)) * 289.0; }
vec2 sw_mod289(vec2 x){ return x - floor(x * (1.0/289.0)) * 289.0; }
vec3 sw_permute(vec3 x){ return sw_mod289(((x*34.0)+1.0)*x); }
float snoise(vec2 v){
  const vec4 C = vec4(0.211324865405187, 0.366025403784439, -0.577350269189626, 0.024390243902439);
  vec2 i = floor(v + dot(v, C.yy));
  vec2 x0 = v - i + dot(i, C.xx);
  vec2 i1 = (x0.x > x0.y) ? vec2(1.0, 0.0) : vec2(0.0, 1.0);
  vec4 x12 = x0.xyxy + C.xxzz;
  x12.xy -= i1;
  i = sw_mod289(i);
  vec3 p = sw_permute(sw_permute(i.y + vec3(0.0, i1.y, 1.0)) + i.x + vec3(0.0, i1.x, 1.0));
  vec3 m = max(0.5 - vec3(dot(x0,x0), dot(x12.xy,x12.xy), dot(x12.zw,x12.zw)), 0.0);
  m = m*m; m = m*m;
  vec3 x = 2.0 * fract(p * C.www) - 1.0;
  vec3 h = abs(x) - 0.5;
  vec3 ox = floor(x + 0.5);
  vec3 a0 = x - ox;
  m *= 1.79284291400159 - 0.85373472095314 * (a0*a0 + h*h);
  vec3 g;
  g.x = a0.x * x0.x + h.x * x0.y;
  g.yz = a0.yz * x12.xz + h.yz * x12.yw;
  return 130.0 * dot(m, g);
}
float fbm3(vec2 p){
  float s = 0.0, a = 0.5;
  for (int i = 0; i < 3; i++) { s += a * snoise(p); p = p * 2.03 + 17.1; a *= 0.5; }
  return s;
}
float fbm5(vec2 p){
  float s = 0.0, a = 0.5;
  for (int i = 0; i < 5; i++) { s += a * snoise(p); p = p * 2.03 + 17.1; a *= 0.5; }
  return s;
}
float hash12(vec2 p){
  vec3 p3 = fract(vec3(p.xyx) * .1031);
  p3 += dot(p3, p3.yzx + 33.33);
  return fract((p3.x + p3.y) * p3.z);
}
`;

export const LIGHT_GLSL = /* glsl */ `
uniform vec3 uSunDir;
uniform vec3 uSunColor;
uniform vec3 uSkyAmb;
uniform vec3 uGroundAmb;
uniform float uTime;
uniform float uWet;
uniform vec3 uZenith;
uniform vec3 uHorizon;
vec3 ambientLight(vec3 n){ return mix(uGroundAmb, uSkyAmb, n.y * 0.5 + 0.5); }
// Rain-soaked look: darker albedo, sky sheen at grazing angles, sharp sun glint.
vec3 wetSheen(vec3 n, vec3 V, float k, float shadow){
  float fr = pow(1.0 - max(dot(n, V), 0.0), 4.0);
  vec3 H = normalize(uSunDir + V);
  vec3 sky = mix(uHorizon, uZenith, 0.35);
  return (sky * (0.06 + 0.5 * fr) + uSunColor * pow(max(dot(n, H), 0.0), 90.0) * 1.1 * shadow) * k;
}
// Soft "painterly" diffuse: wrapped lambert pushed through an S-curve.
vec3 stylize(vec3 albedo, vec3 n, float shadow, float ao, float wrap){
  float ndl = dot(n, uSunDir);
  float d = clamp((ndl + wrap) / (1.0 + wrap), 0.0, 1.0);
  d = smoothstep(0.0, 1.0, d);
  vec3 direct = uSunColor * d * shadow;
  return albedo * (direct + ambientLight(n) * ao);
}
`;

export const TERRAIN_SAMPLE_GLSL = /* glsl */ `
uniform sampler2D uHeightTex;
uniform sampler2D uColorTex;
uniform float uWorldSize;
uniform float uRes;
float terrainHeight(vec2 xz){
  vec2 g = (xz / uWorldSize + 0.5) * (uRes - 1.0);
  g = clamp(g, vec2(0.0), vec2(uRes - 1.001));
  vec2 i = floor(g);
  vec2 f = g - i;
  ivec2 ii = ivec2(i);
  float a = texelFetch(uHeightTex, ii, 0).r;
  float b = texelFetch(uHeightTex, ii + ivec2(1, 0), 0).r;
  float c = texelFetch(uHeightTex, ii + ivec2(0, 1), 0).r;
  float d = texelFetch(uHeightTex, ii + ivec2(1, 1), 0).r;
  return mix(mix(a, b, f.x), mix(c, d, f.x), f.y);
}
vec2 terrainUV(vec2 xz){
  vec2 g = (xz / uWorldSize + 0.5) * (uRes - 1.0);
  return (g + 0.5) / uRes;
}
`;

// Shadow + fog boilerplate for custom ShaderMaterials.
export const VERT_HEAD = /* glsl */ `
#include <common>
#include <fog_pars_vertex>
#include <shadowmap_pars_vertex>
`;
export const FRAG_HEAD = /* glsl */ `
#include <common>
#include <packing>
#include <fog_pars_fragment>
#include <bsdfs>
#include <lights_pars_begin>
#include <shadowmap_pars_fragment>
#include <shadowmask_pars_fragment>
`;
export const FRAG_TAIL = /* glsl */ `
#include <tonemapping_fragment>
#include <colorspace_fragment>
#include <fog_fragment>
`;

export function litUniforms(extra = {}) {
  return THREE.UniformsUtils.merge([THREE.UniformsLib.lights, THREE.UniformsLib.fog]);
}

// Build a ShaderMaterial that participates in scene lights (for shadow maps)
// and fog, while sharing the global stylized-lighting uniforms by reference.
export function makeLitShader({ vertexShader, fragmentShader, uniforms = {}, ...rest }) {
  const base = litUniforms();
  const mat = new THREE.ShaderMaterial({
    vertexShader,
    fragmentShader,
    uniforms: Object.assign(base, shared, terrainUniforms, uniforms),
    lights: true,
    fog: true,
    ...rest,
  });
  return mat;
}
