import * as THREE from 'three';
import { shared, terrainUniforms, NOISE_GLSL, TERRAIN_SAMPLE_GLSL } from '../render/shaders.js';

// Sea + lake surface. Right before it draws, the renderer copies the frame so
// far (colour + depth); the water refracts that copy, absorbs light per colour
// channel over the distance the view ray travels through it (clear turquoise
// shallows, deep blue depths), lays caustics on the bed, foams where it meets
// rocks, legs and shores, rolls waves up the beaches and leaves a wake behind
// swimmers. Without the copy it falls back to plain alpha blending.

const TRAIL = 20;

const VERT = /* glsl */ `
#include <common>
#include <fog_pars_vertex>
varying vec3 vWorldPos;
varying float vViewZ;
void main(){
  vec4 wp = modelMatrix * vec4(position, 1.0);
  vWorldPos = wp.xyz;
  vec4 mvPosition = viewMatrix * wp;
  vViewZ = -mvPosition.z;
  gl_Position = projectionMatrix * mvPosition;
  #include <fog_vertex>
}
`;

const FRAG = /* glsl */ `
#include <common>
#include <packing>
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
uniform sampler2D tGrab;
uniform sampler2D tGrabDepth;
uniform float uGrabOn;
uniform vec2 uGrabRes;
uniform float uNear;
uniform float uFar;
uniform vec4 uTrail[${TRAIL}];
uniform float uCloudShadow;
varying vec3 vWorldPos;
varying float vViewZ;
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

float sceneZ(vec2 uv){
  return -perspectiveDepthToViewZ(texture2D(tGrabDepth, uv).r, uNear, uFar);
}

void main(){
  vec3 wp = vWorldPos;
  vec3 V = normalize(cameraPosition - wp);
  float dist = length(cameraPosition - wp);
  float terrainH = terrainHeight(wp.xz);
  float depth = max(0.0, wp.y - terrainH);

  // normal from finite differences, flattened with distance
  float e = 0.25;
  float hC = waveH(wp.xz);
  float hX = waveH(wp.xz + vec2(e, 0.0));
  float hZ = waveH(wp.xz + vec2(0.0, e));
  float strength = mix(0.5, 0.08, smoothstep(10.0, 400.0, dist));
  vec3 n = normalize(vec3((hC - hX) * strength / e, 1.0, (hC - hZ) * strength / e));

  vec3 lightAmt = uSunColor * 0.32 * max(uSunDir.y, 0.0) + uSkyAmb * 0.75;
  float dd = 1.0 - exp(-depth * 0.16);
  vec3 body = mix(uShallow, uDeep, dd) * lightAmt;

  // ---- what lies beneath: refracted copy of the frame + absorption
  vec3 under = body;
  float edgeT = 10.0;
  if (uGrabOn > 0.5) {
    vec2 suv = gl_FragCoord.xy / uGrabRes;
    float z0 = sceneZ(suv);
    float k = clamp((z0 - vViewZ) * 0.6, 0.0, 1.0);
    vec2 off = n.xz * 0.045 * k * clamp(6.0 / vViewZ, 0.15, 1.0);
    vec2 ruv = suv + off;
    float zr = sceneZ(ruv);
    if (zr < vViewZ) { ruv = suv; zr = z0; }
    float along = max(zr - vViewZ, 0.0) * dist / max(vViewZ, 1e-3);
    edgeT = max(z0 - vViewZ, 0.0) * dist / max(vViewZ, 1e-3);
    vec3 refr = texture2D(tGrab, ruv).rgb;
    // caustics dancing on the bed of the shallows
    vec2 bed = wp.xz + (wp.xz - cameraPosition.xz) / max(dist, 1.0) * depth * 0.6;
    float caus = pow(abs(snoise(bed * 0.9 + uTime * 0.35) + snoise(bed * 1.35 - uTime * 0.28)), 3.0);
    refr *= 1.0 + caus * 0.45 * smoothstep(3.5, 0.3, depth) * max(uSunDir.y, 0.0) * (1.0 - uNight) * (1.0 - uCloudShadow * 0.5);
    vec3 T = exp(-vec3(0.34, 0.085, 0.06) * along);
    vec3 scatter = mix(uShallow, uDeep, 1.0 - exp(-along * 0.2)) * lightAmt;
    under = refr * T + scatter * (1.0 - T);
  }

  // reflection + fresnel
  vec3 R = reflect(-V, n);
  R.y = abs(R.y);
  vec3 refl = skyCol(R) * (1.0 - uNight * 0.6);
  float fres = 0.03 + 0.97 * pow(1.0 - max(dot(n, V), 0.0), 5.0);
  vec3 col = mix(under, refl, clamp(fres * 0.85, 0.0, 1.0));

  // sun glitter
  vec3 H = normalize(uSunDir + V);
  float spec = pow(max(dot(n, H), 0.0), 420.0) * 6.0 + pow(max(dot(n, H), 0.0), 60.0) * 0.12;
  col += uSunColor * spec;

  // ---- foam
  float fn = snoise(wp.xz * 0.45 + uTime * 0.25) * 0.5 + 0.5;
  float lace = snoise(wp.xz * 1.6 - uTime * 0.3) * 0.5 + 0.5;
  // distance to the waterline (depth over bed slope) keeps foam bands a
  // steady width on steep rocks and long flat beaches alike
  float hx = terrainHeight(wp.xz + vec2(0.7, 0.0));
  float hz = terrainHeight(wp.xz + vec2(0.0, 0.7));
  float slope = length(vec2(hx - terrainH, hz - terrainH)) / 0.7;
  float shoreD = depth / max(slope, 0.012);
  float fringe = smoothstep(0.5 + fn * 0.8, 0.0, shoreD) * smoothstep(0.05, 0.5, lace + 0.3);
  // rollers running up the beach
  float ph = shoreD * 0.9 + uTime * 1.5 + fn * 2.2;
  float band = pow(sin(ph) * 0.5 + 0.5, 8.0);
  float lines = band * smoothstep(16.0, 1.5, shoreD) * smoothstep(1.6, 0.15, depth) * smoothstep(0.25, 0.65, lace + 0.15);
  // contact foam around rocks, posts and wading legs
  float contact = smoothstep(0.4, 0.0, edgeT - lace * 0.15) * step(0.5, uGrabOn) * smoothstep(0.1, 0.4, depth);
  // wake behind swimmers: spreading, fading puffs along the path
  float wake = 0.0;
  for (int i = 0; i < ${TRAIL}; i++) {
    vec4 tp = uTrail[i];
    if (tp.w <= 0.0) continue;
    // each puff is an expanding ring; chained along the path they draw
    // the V of a wake, with a fresh churned patch right behind the swimmer
    float dm = length(wp.xz - tp.xy);
    float r = 0.35 + tp.z * 0.95;
    float w = 0.16 + tp.z * 0.12;
    float ring = exp(-pow((dm - r) / w, 2.0));
    float churn = exp(-dm * dm * 3.0) * exp(-tp.z * 2.5);
    wake += (ring * 0.7 + churn * 0.8) * tp.w * exp(-tp.z * 0.6);
  }
  wake = clamp(wake, 0.0, 1.0) * smoothstep(0.15, 0.55, lace * 0.7 + fn * 0.5);
  float foam = clamp(fringe + lines * 0.75 + contact * 0.8 + wake, 0.0, 1.0);
  vec3 foamCol = vec3(0.95, 0.98, 1.0) * (uSunColor * 0.33 * (1.0 - uCloudShadow * 0.3) + uSkyAmb * 0.8);
  col = mix(col, foamCol, foam);

  float alpha = 1.0;
  if (uGrabOn < 0.5) {
    // fallback: plain blending over the bed
    float caus = pow(abs(snoise(wp.xz * 0.9 + uTime * 0.4) + snoise(wp.xz * 1.3 - uTime * 0.3)), 3.0);
    col += uSunColor * caus * 0.05 * smoothstep(2.5, 0.3, depth) * (1.0 - foam);
    alpha = mix(0.42, 0.94, smoothstep(0.0, 3.5, depth));
    alpha = max(alpha, foam);
    alpha = max(alpha, clamp(fres, 0.0, 1.0));
    alpha *= smoothstep(0.0, 0.06, depth + 0.02);
  } else {
    // melt into the shore instead of a hard edge
    col = mix(under, col, smoothstep(0.0, 0.05, edgeT));
  }

  gl_FragColor = vec4(col, alpha);
  #include <tonemapping_fragment>
  #include <colorspace_fragment>
  #include <fog_fragment>
}
`;

export class Water {
  constructor(scene, grab) {
    const geo = new THREE.PlaneGeometry(9000, 9000, 1, 1);
    geo.rotateX(-Math.PI / 2);
    this.trail = Array.from({ length: TRAIL }, () => new THREE.Vector4());
    this.trailI = 0;
    this.trailT = 0;
    const uniforms = Object.assign(THREE.UniformsUtils.clone(THREE.UniformsLib.fog), {
      uSunDir: shared.uSunDir,
      uSunColor: shared.uSunColor,
      uSkyAmb: shared.uSkyAmb,
      uZenith: shared.uZenith,
      uHorizon: shared.uHorizon,
      uTime: shared.uTime,
      uNight: shared.uNight,
      uCloudShadow: shared.uCloudShadow,
      uShallow: { value: new THREE.Color('#5fe0d0') },
      uDeep: { value: new THREE.Color('#0c4e86') },
      tGrab: { value: grab ? grab.rt.texture : null },
      tGrabDepth: { value: grab ? grab.rt.depthTexture : null },
      uGrabOn: grab ? grab.valid : { value: 0 },
      uGrabRes: grab ? grab.res : { value: new THREE.Vector2(1, 1) },
      uNear: { value: 0.1 },
      uFar: { value: 4000 },
      uTrail: { value: this.trail },
      ...terrainUniforms,
    });
    this.material = new THREE.ShaderMaterial({
      vertexShader: VERT,
      fragmentShader: FRAG,
      uniforms,
      transparent: true,
      depthWrite: true,
      fog: true,
    });
    this.mesh = new THREE.Mesh(geo, this.material);
    this.mesh.position.y = 0;
    this.mesh.renderOrder = 2;
    this.mesh.frustumCulled = false;
    if (grab) this.mesh.onBeforeRender = (renderer, sc, camera) => {
      grab.grab(renderer);
      uniforms.uNear.value = camera.near;
      uniforms.uFar.value = camera.far;
    };
    scene.add(this.mesh);
  }

  // drop a wake puff (swimming, wading, splashing down)
  puff(x, z, k = 1) {
    const t = this.trail[this.trailI];
    t.set(x, z, 0, k);
    this.trailI = (this.trailI + 1) % TRAIL;
  }

  update(camera, dt = 0, player = null) {
    // keep the plane centred under the camera (world-space shading)
    this.mesh.position.x = Math.round(camera.position.x / 50) * 50;
    this.mesh.position.z = Math.round(camera.position.z / 50) * 50;
    // gentle swash: the waterline creeps up and down the beaches
    const t = shared.uTime.value;
    this.mesh.position.y = Math.sin(t * 0.55) * 0.035 + Math.sin(t * 1.3 + 1.7) * 0.012;
    for (const p of this.trail) if (p.w > 0) {
      p.z += dt;
      if (p.z > 5) p.w = 0;
    }
    if (!player) return;
    const P = player.pos;
    const sp = Math.hypot(player.vel.x, player.vel.z);
    const inWater = player.state === 'swim' || (player.state !== 'air' && P.y < -0.15); // swimming or wading
    this.trailT -= dt;
    if (inWater && this.trailT <= 0 && (sp > 0.6 || player.state === 'swim')) {
      this.trailT = sp > 0.6 ? 0.2 : 0.6;
      this.puff(P.x - player.vel.x * 0.05, P.z - player.vel.z * 0.05, Math.min(1, 0.35 + sp * 0.12));
    }
  }
}
