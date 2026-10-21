import * as THREE from 'three';
import { shared, terrainUniforms, NOISE_GLSL, TERRAIN_SAMPLE_GLSL } from '../render/shaders.js';

const VERT = /* glsl */ `
#include <common>
#include <fog_pars_vertex>
varying vec3 vWorldPos;
void main(){
  vec4 wp = modelMatrix * vec4(position, 1.0);
  vWorldPos = wp.xyz;
  vec4 mvPosition = viewMatrix * wp;
  gl_Position = projectionMatrix * mvPosition;
  #include <fog_vertex>
}
`;

const FRAG = /* glsl */ `
#include <common>
#include <fog_pars_fragment>
uniform vec3 uSunDir;
uniform vec3 uSunColor;
uniform vec3 uSkyAmb;
uniform vec3 uZenith;
uniform vec3 uHorizon;
uniform float uTime;
uniform float uNight;
uniform vec3 uShallow;
uniform vec3 uDeep;
varying vec3 vWorldPos;
${NOISE_GLSL}
${TERRAIN_SAMPLE_GLSL}

float waveH(vec2 p){
  float t = uTime;
  float h = snoise(p * 0.07 + vec2(t * 0.035, t * 0.02)) * 0.55;
  h += snoise(p * 0.21 + vec2(-t * 0.06, t * 0.045)) * 0.28;
  h += snoise(p * 0.75 + vec2(t * 0.17, -t * 0.12)) * 0.09;
  return h;
}

vec3 skyCol(vec3 d){
  float h = max(d.y, 0.0);
  return mix(uHorizon, uZenith, pow(h, 0.55));
}

void main(){
  vec3 wp = vWorldPos;
  vec3 V = normalize(cameraPosition - wp);
  float dist = length(cameraPosition - wp);
  float terrainH = terrainHeight(wp.xz);
  float depth = max(0.0, wp.y - terrainH);

  // analytic-ish normal from finite differences, flattened with distance
  float e = 0.25;
  float hC = waveH(wp.xz);
  float hX = waveH(wp.xz + vec2(e, 0.0));
  float hZ = waveH(wp.xz + vec2(0.0, e));
  float strength = mix(0.5, 0.08, smoothstep(10.0, 400.0, dist));
  vec3 n = normalize(vec3((hC - hX) * strength / e, 1.0, (hC - hZ) * strength / e));

  // body colour by depth
  float dd = 1.0 - exp(-depth * 0.16);
  vec3 body = mix(uShallow, uDeep, dd);
  vec3 lightAmt = uSunColor * 0.32 * max(uSunDir.y, 0.0) + uSkyAmb * 0.75;
  body *= lightAmt;

  // reflection + fresnel
  vec3 R = reflect(-V, n);
  R.y = abs(R.y);
  vec3 refl = skyCol(R) * (1.0 - uNight * 0.6);
  float fres = 0.03 + 0.97 * pow(1.0 - max(dot(n, V), 0.0), 5.0);
  vec3 col = mix(body, refl, clamp(fres * 0.85, 0.0, 1.0));

  // sun glitter
  vec3 H = normalize(uSunDir + V);
  float spec = pow(max(dot(n, H), 0.0), 420.0) * 6.0 + pow(max(dot(n, H), 0.0), 60.0) * 0.12;
  col += uSunColor * spec;

  // shoreline foam: soft fringe + travelling lines
  float fn = snoise(wp.xz * 0.45 + uTime * 0.25) * 0.5 + 0.5;
  float fringe = smoothstep(0.35, 0.0, depth - fn * 0.18);
  float lines = smoothstep(0.72, 0.85, sin(depth * 7.0 - uTime * 1.7 + fn * 3.5) * 0.5 + 0.5);
  lines *= smoothstep(1.6, 0.25, depth) * smoothstep(0.0, 0.15, depth);
  float foam = clamp(fringe + lines * 0.65, 0.0, 1.0);
  vec3 foamCol = vec3(0.95, 0.98, 1.0) * (uSunColor * 0.33 + uSkyAmb * 0.8);
  col = mix(col, foamCol, foam);

  // caustic shimmer in shallow water
  float caus = pow(abs(snoise(wp.xz * 0.9 + uTime * 0.4) + snoise(wp.xz * 1.3 - uTime * 0.3)), 3.0);
  col += uSunColor * caus * 0.05 * smoothstep(2.5, 0.3, depth) * (1.0 - foam);

  float alpha = mix(0.42, 0.94, smoothstep(0.0, 3.5, depth));
  alpha = max(alpha, foam);
  alpha = max(alpha, clamp(fres, 0.0, 1.0));
  alpha *= smoothstep(0.0, 0.06, depth + 0.02);

  gl_FragColor = vec4(col, alpha);
  #include <tonemapping_fragment>
  #include <colorspace_fragment>
  #include <fog_fragment>
}
`;

export class Water {
  constructor(scene) {
    const geo = new THREE.PlaneGeometry(9000, 9000, 1, 1);
    geo.rotateX(-Math.PI / 2);
    const uniforms = Object.assign(THREE.UniformsUtils.clone(THREE.UniformsLib.fog), {
      uSunDir: shared.uSunDir,
      uSunColor: shared.uSunColor,
      uSkyAmb: shared.uSkyAmb,
      uZenith: shared.uZenith,
      uHorizon: shared.uHorizon,
      uTime: shared.uTime,
      uNight: shared.uNight,
      uShallow: { value: new THREE.Color('#5fe0d0') },
      uDeep: { value: new THREE.Color('#0c4e86') },
      ...terrainUniforms,
    });
    this.material = new THREE.ShaderMaterial({
      vertexShader: VERT,
      fragmentShader: FRAG,
      uniforms,
      transparent: true,
      depthWrite: false,
      fog: true,
    });
    this.mesh = new THREE.Mesh(geo, this.material);
    this.mesh.position.y = 0;
    this.mesh.renderOrder = 2;
    this.mesh.frustumCulled = false;
    scene.add(this.mesh);
  }

  update(camera) {
    // keep the plane centred under the camera (world-space shading)
    this.mesh.position.x = Math.round(camera.position.x / 50) * 50;
    this.mesh.position.z = Math.round(camera.position.z / 50) * 50;
  }
}
