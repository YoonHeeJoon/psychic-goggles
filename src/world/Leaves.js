import * as THREE from 'three';
import { shared, terrainUniforms, TERRAIN_SAMPLE_GLSL } from '../render/shaders.js';

// Maple leaves drifting down around the camera in the autumn highlands.
// Every leaf is animated in the vertex shader (fall, sway, tumble) inside a
// box that wraps around the camera, so there is no per-frame CPU work; the
// whole system fades with how deep into the highlands the camera is.

const N = 460;
const BOX = 46;
const H = 20;

const VERT = /* glsl */ `
#include <common>
#include <fog_pars_vertex>
attribute vec4 aSeed;
uniform float uTime;
uniform vec3 uCam;
uniform float uK;
uniform vec2 uWind;
uniform vec3 uSunDir;
varying vec2 vUv;
varying vec3 vCol;
varying float vLight;
${TERRAIN_SAMPLE_GLSL}
void main(){
  vUv = uv;
  float t = uTime;
  float sp = 0.75 + aSeed.w * 0.6;
  // horizontal position wraps inside a box centred on the camera
  vec2 corner = uCam.xz - ${(BOX / 2).toFixed(1)};
  vec2 p = mod(aSeed.xy * ${BOX.toFixed(1)} + uWind * t * 1.4 - corner, ${BOX.toFixed(1)}) + corner;
  p += vec2(sin(t * 1.1 + aSeed.z * 31.0), cos(t * 0.9 + aSeed.z * 17.0)) * 0.7;
  float y = uCam.y + ${(H * 0.45).toFixed(1)} - mod(t * sp + aSeed.z * ${H.toFixed(1)}, ${H.toFixed(1)});
  float ground = terrainHeight(p);
  // tumble
  float a = t * (1.6 + aSeed.w * 2.2) + aSeed.z * 40.0;
  float b = t * (1.1 + aSeed.x * 1.7) + aSeed.w * 25.0;
  vec3 q = vec3(position.xy * 0.21, 0.0);
  q.yz = mat2(cos(a), sin(a), -sin(a), cos(a)) * q.yz;
  q.xz = mat2(cos(b), sin(b), -sin(b), cos(b)) * q.xz;
  vec3 n = vec3(0.0, 0.0, 1.0);
  n.yz = mat2(cos(a), sin(a), -sin(a), cos(a)) * n.yz;
  n.xz = mat2(cos(b), sin(b), -sin(b), cos(b)) * n.xz;
  float edge = 1.0 - smoothstep(${(BOX * 0.36).toFixed(1)}, ${(BOX * 0.5).toFixed(1)}, max(abs(p.x - uCam.x), abs(p.y - uCam.z)));
  float vis = uK * edge * smoothstep(ground - 0.05, ground + 0.4, y);
  q *= vis;
  vec3 wp = vec3(p.x, y, p.y) + q;
  vLight = 0.55 + 0.45 * abs(dot(n, uSunDir));
  vec3 c1 = vec3(0.86, 0.26, 0.12), c2 = vec3(0.95, 0.52, 0.14), c3 = vec3(0.96, 0.74, 0.22);
  vCol = aSeed.w < 0.4 ? c1 : aSeed.w < 0.75 ? c2 : c3;
  vec4 mvPosition = viewMatrix * vec4(wp, 1.0);
  gl_Position = projectionMatrix * mvPosition;
  #include <fog_vertex>
}`;

const FRAG = /* glsl */ `
#include <common>
#include <fog_pars_fragment>
uniform vec3 uSunColor;
uniform vec3 uSkyAmb;
varying vec2 vUv;
varying vec3 vCol;
varying float vLight;
void main(){
  // five-lobed maple outline
  vec2 d = vUv - vec2(0.5, 0.45);
  float r = length(d);
  float ang = atan(d.x, d.y);
  float lobe = 0.3 + 0.13 * pow(abs(cos(ang * 2.5)), 0.6);
  if (r > lobe || (d.y < -0.25 && abs(d.x) > 0.03)) discard;
  vec3 col = vCol * (uSkyAmb * 0.7 + uSunColor * 0.45 * vLight);
  col *= 0.85 + 0.3 * smoothstep(0.05, 0.0, abs(d.x));
  gl_FragColor = vec4(col, 1.0);
  #include <tonemapping_fragment>
  #include <colorspace_fragment>
  #include <fog_fragment>
}`;

export class Leaves {
  constructor(scene, terrain) {
    this.terrain = terrain;
    const base = new THREE.PlaneGeometry(1, 1);
    const geo = new THREE.InstancedBufferGeometry();
    geo.index = base.index;
    geo.setAttribute('position', base.attributes.position);
    geo.setAttribute('uv', base.attributes.uv);
    const seed = new Float32Array(N * 4);
    for (let i = 0; i < N * 4; i++) seed[i] = Math.random();
    geo.setAttribute('aSeed', new THREE.InstancedBufferAttribute(seed, 4));
    geo.instanceCount = N;
    this.uniforms = Object.assign(THREE.UniformsUtils.clone(THREE.UniformsLib.fog), {
      uTime: shared.uTime,
      uSunDir: shared.uSunDir,
      uSunColor: shared.uSunColor,
      uSkyAmb: shared.uSkyAmb,
      uCam: { value: new THREE.Vector3() },
      uK: { value: 0 },
      uWind: { value: new THREE.Vector2() },
      ...terrainUniforms,
    });
    this.mesh = new THREE.Mesh(
      geo,
      new THREE.ShaderMaterial({ vertexShader: VERT, fragmentShader: FRAG, uniforms: this.uniforms, side: THREE.DoubleSide, fog: true })
    );
    this.mesh.frustumCulled = false;
    this.mesh.visible = false;
    scene.add(this.mesh);
    this.k = 0;
    this.checkT = 0;
    this.want = 0;
  }

  update(camera, dt) {
    this.checkT -= dt;
    if (this.checkT <= 0) {
      this.checkT = 0.5;
      this.want = this.terrain.autumnAt(camera.position.x, camera.position.z);
    }
    this.k += (this.want - this.k) * Math.min(1, dt * 1.5);
    const u = this.uniforms;
    u.uK.value = this.k;
    u.uCam.value.copy(camera.position);
    u.uWind.value.copy(shared.uWindDir.value).multiplyScalar(0.6 + shared.uWindStrength.value * 0.5);
    this.mesh.visible = this.k > 0.02;
  }
}
