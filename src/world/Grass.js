import * as THREE from 'three';
import { mulberry32 } from '../core/noise.js';
import {
  shared,
  terrainUniforms,
  makeLitShader,
  VERT_HEAD,
  FRAG_HEAD,
  FRAG_TAIL,
  NOISE_GLSL,
  LIGHT_GLSL,
  TERRAIN_SAMPLE_GLSL,
} from '../render/shaders.js';

const VERT = /* glsl */ `
${VERT_HEAD}
${NOISE_GLSL}
${TERRAIN_SAMPLE_GLSL}
uniform vec3 uCenter;
uniform float uField;
uniform vec2 uWindDir;
uniform float uWindStrength;
uniform vec3 uPlayerPos;
uniform float uTime;
uniform float uBladeH;
attribute vec2 aOffset;
attribute vec4 aRand;
varying vec3 vAlbedo;
varying float vT;
varying vec3 vWorldPos;
varying float vWave;
varying vec3 vN;
void main(){
  vec2 rel = mod(aOffset - uCenter.xz + uField * 0.5, uField) - uField * 0.5;
  vec2 xz = uCenter.xz + rel;
  float d = length(rel);
  vec4 cd = texture2D(uColorTex, terrainUV(xz));
  float density = cd.a;
  float fade = 1.0 - smoothstep(uField * 0.3, uField * 0.48, d);
  float keep = mix(1.0, 0.28, smoothstep(10.0, uField * 0.45, d));
  float alive = step(aRand.w, density * 1.15) * step(aRand.z, keep);
  float h = uBladeH * (0.55 + aRand.y * 0.75) * fade * alive * (0.5 + 0.5 * density);
  if (h < 0.02) { gl_Position = vec4(2.0, 2.0, 2.0, 1.0); return; }

  float baseY = terrainHeight(xz);
  float side = position.x;
  float t = position.y;
  float ang = aRand.x * 6.28318;
  vec2 dir = vec2(cos(ang), sin(ang));
  float w = (0.05 + aRand.z * 0.035) * inversesqrt(keep) * (1.0 - t * 0.55);

  // wind: large travelling gust bands + local turbulence
  float wave = sin(dot(xz, uWindDir) * 0.11 - uTime * 1.7 + snoise(xz * 0.015) * 2.5) * 0.5 + 0.5;
  float gust = snoise(xz * 0.035 - uWindDir * uTime * 0.45) * 0.5 + 0.5;
  float wamt = (0.12 + 0.9 * wave * gust) * uWindStrength;
  vec2 bend = uWindDir * wamt;
  bend += 0.1 * vec2(sin(uTime * 3.3 + aRand.x * 40.0), cos(uTime * 2.9 + aRand.y * 40.0)) * (0.4 + wamt);
  bend += vec2(cos(aRand.y * 31.0), sin(aRand.y * 31.0)) * 0.22; // natural lean

  // trample around the player
  vec2 toB = xz - uPlayerPos.xz;
  float pd = length(toB);
  float push = (1.0 - smoothstep(0.25, 1.5, pd)) * step(abs(uPlayerPos.y - baseY), 1.6);
  bend += (toB / max(pd, 0.001)) * push * 1.8;

  float bl = min(length(bend), 1.6);
  vec3 p;
  p.xz = xz + dir * side * w + bend * h * t * t * 0.85;
  p.y = baseY + h * t * (1.0 - 0.33 * bl * t) - 0.02;

  vec3 nrm = normalize(vec3(bend.x * 0.25 + dir.y * side * 0.15, 1.0, bend.y * 0.25 - dir.x * side * 0.15));
  vN = nrm;
  vAlbedo = cd.rgb * (0.92 + aRand.y * 0.18);
  vT = t;
  vWave = wave * gust;

  vec4 worldPosition = vec4(p, 1.0);
  vWorldPos = p;
  vec3 transformedNormal = (viewMatrix * vec4(nrm, 0.0)).xyz;
  #include <shadowmap_vertex>
  vec4 mvPosition = viewMatrix * worldPosition;
  gl_Position = projectionMatrix * mvPosition;
  #include <fog_vertex>
}
`;

const FRAG = /* glsl */ `
${FRAG_HEAD}
${LIGHT_GLSL}
varying vec3 vAlbedo;
varying float vT;
varying vec3 vWorldPos;
varying float vWave;
varying vec3 vN;
void main(){
  float shadow = getShadowMask();
  vec3 base = vAlbedo;
  vec3 tip = base * 1.32 + vec3(0.035, 0.03, 0.0);
  vec3 albedo = mix(base * 0.62, tip, smoothstep(0.0, 1.0, vT));
  albedo *= 1.0 + vWave * 0.22 * vT;
  vec3 n = normalize(vN);
  vec3 col = stylize(albedo, n, shadow, mix(0.65, 1.0, vT), 0.35);
  vec3 V = normalize(cameraPosition - vWorldPos);
  float back = pow(max(dot(-V, uSunDir), 0.0), 3.0);
  col += uSunColor * albedo * back * vT * 0.45 * shadow;
  gl_FragColor = vec4(col, 1.0);
  ${FRAG_TAIL}
}
`;

export class Grass {
  constructor(scene, count, field, maxCount = 320000) {
    this.field = field;
    this.maxCount = Math.max(count, maxCount);
    const total = this.maxCount;
    const blade = new THREE.BufferGeometry();
    const pos = [];
    const levels = [0, 0.3, 0.6, 0.85];
    for (const t of levels) pos.push(-1, t, 0, 1, t, 0);
    pos.push(0, 1, 0);
    const idx = [];
    for (let l = 0; l < levels.length - 1; l++) {
      const a = l * 2;
      idx.push(a, a + 1, a + 2, a + 1, a + 3, a + 2);
    }
    const top = levels.length * 2;
    idx.push(top - 2, top - 1, top);

    const geo = new THREE.InstancedBufferGeometry();
    geo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
    geo.setIndex(idx);
    const rand = mulberry32(99);
    const offs = new Float32Array(total * 2);
    const rnd = new Float32Array(total * 4);
    for (let i = 0; i < total; i++) {
      offs[i * 2] = rand() * field;
      offs[i * 2 + 1] = rand() * field;
      rnd[i * 4] = rand();
      rnd[i * 4 + 1] = rand();
      rnd[i * 4 + 2] = rand();
      rnd[i * 4 + 3] = rand();
    }
    this.offsetAttr = new THREE.InstancedBufferAttribute(offs, 2);
    geo.setAttribute('aOffset', this.offsetAttr);
    geo.setAttribute('aRand', new THREE.InstancedBufferAttribute(rnd, 4));
    geo.instanceCount = count;
    this.geo = geo;
    geo.boundingSphere = new THREE.Sphere(new THREE.Vector3(), 1e6);

    this.uniforms = {
      uCenter: { value: new THREE.Vector3() },
      uField: { value: field },
      uBladeH: { value: 0.62 },
    };
    this.material = makeLitShader({
      vertexShader: VERT,
      fragmentShader: FRAG,
      uniforms: this.uniforms,
      side: THREE.DoubleSide,
    });
    this.mesh = new THREE.Mesh(geo, this.material);
    this.mesh.frustumCulled = false;
    this.mesh.receiveShadow = true;
    this.mesh.castShadow = false;
    scene.add(this.mesh);
  }

  setQuality(count, field) {
    if (field !== this.field) {
      const rand = mulberry32(99);
      const a = this.offsetAttr.array;
      for (let i = 0; i < a.length; i++) a[i] = rand() * field;
      this.offsetAttr.needsUpdate = true;
      this.field = field;
      this.uniforms.uField.value = field;
    }
    this.geo.instanceCount = Math.min(count, this.maxCount);
  }

  update(center) {
    this.uniforms.uCenter.value.copy(center);
  }
}
