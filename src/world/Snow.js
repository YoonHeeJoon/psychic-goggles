import * as THREE from 'three';
import { shared, terrainUniforms, TERRAIN_SAMPLE_GLSL } from '../render/shaders.js';

// Snowfall around the camera high on the peaks. Flakes are animated in the
// vertex shader inside a box that wraps around the camera (fall, flutter,
// gusts) and fade where they would sink into the slope; the whole effect
// grows with altitude, and blows harder near the summit.

const N = 2600;
const BOX = 40;
const H = 22;

const VERT = /* glsl */ `
#include <common>
#include <fog_pars_vertex>
attribute vec4 aSeed;
uniform float uTime;
uniform vec3 uCam;
uniform float uK;
uniform vec2 uWind;
varying float vA;
${TERRAIN_SAMPLE_GLSL}
void main(){
  float t = uTime;
  float sp = 1.1 + aSeed.w * 0.9;
  vec2 corner = uCam.xz - ${(BOX / 2).toFixed(1)};
  vec2 p = mod(aSeed.xy * ${BOX.toFixed(1)} + uWind - corner, ${BOX.toFixed(1)}) + corner;
  p += vec2(sin(t * 1.7 + aSeed.z * 41.0), cos(t * 1.3 + aSeed.z * 23.0)) * 0.35;
  float y = uCam.y + ${(H * 0.5).toFixed(1)} - mod(t * sp + aSeed.z * ${H.toFixed(1)}, ${H.toFixed(1)});
  float ground = terrainHeight(p);
  float edge = 1.0 - smoothstep(${(BOX * 0.32).toFixed(1)}, ${(BOX * 0.5).toFixed(1)}, length(p - uCam.xz));
  vec4 mvPosition = viewMatrix * vec4(p.x, y, p.y, 1.0);
  float dist = -mvPosition.z;
  // flakes right at the lens would cover the screen: fade them out
  vA = uK * edge * smoothstep(ground - 0.1, ground + 0.6, y) * smoothstep(1.2, 3.5, dist);
  gl_PointSize = min((0.9 + aSeed.w * 1.4) * 34.0 / max(dist, 0.5), 14.0) * step(0.01, vA);
  gl_Position = projectionMatrix * mvPosition;
  #include <fog_vertex>
}`;

const FRAG = /* glsl */ `
#include <common>
#include <fog_pars_fragment>
uniform vec3 uSkyAmb;
uniform vec3 uSunColor;
varying float vA;
void main(){
  float r = length(gl_PointCoord - 0.5) * 2.0;
  float a = smoothstep(1.0, 0.3, r) * vA * 0.9;
  if (a < 0.02) discard;
  vec3 col = vec3(0.95, 0.97, 1.0) * (uSkyAmb * 0.9 + uSunColor * 0.35);
  gl_FragColor = vec4(col, a);
  #include <fog_fragment>
}`;

export class Snow {
  constructor(scene) {
    const geo = new THREE.BufferGeometry();
    const seed = new Float32Array(N * 4);
    for (let i = 0; i < N * 4; i++) seed[i] = Math.random();
    geo.setAttribute('position', new THREE.BufferAttribute(new Float32Array(N * 3), 3));
    geo.setAttribute('aSeed', new THREE.BufferAttribute(seed, 4));
    this.uniforms = Object.assign(THREE.UniformsUtils.clone(THREE.UniformsLib.fog), {
      uTime: shared.uTime,
      uSkyAmb: shared.uSkyAmb,
      uSunColor: shared.uSunColor,
      uCam: { value: new THREE.Vector3() },
      uK: { value: 0 },
      uWind: { value: new THREE.Vector2() },
      ...terrainUniforms,
    });
    this.points = new THREE.Points(geo, new THREE.ShaderMaterial({ vertexShader: VERT, fragmentShader: FRAG, uniforms: this.uniforms, transparent: true, depthWrite: false, fog: true }));
    this.points.frustumCulled = false;
    this.points.renderOrder = 5;
    this.points.visible = false;
    scene.add(this.points);
    this.k = 0;
  }

  update(camera, dt) {
    const y = camera.position.y;
    const want = Math.min(1, Math.max(0, (y - 92) / 34));
    this.k += (want - this.k) * Math.min(1, dt * 1.2);
    const u = this.uniforms;
    u.uK.value = this.k;
    u.uCam.value.copy(camera.position);
    // gusts get stronger near the summit
    const gust = 1.5 + Math.max(0, y - 140) * 0.06 + Math.sin(shared.uTime.value * 0.4) * 0.8;
    // integrate the drift so changing gusts never make the flakes jump
    u.uWind.value.addScaledVector(shared.uWindDir.value, gust * dt);
    u.uWind.value.set(u.uWind.value.x % BOX, u.uWind.value.y % BOX);
    this.points.visible = this.k > 0.02;
  }
}
