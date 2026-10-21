import * as THREE from 'three';
import { shared, NOISE_GLSL } from '../render/shaders.js';
import { Simplex, smoothstep } from '../core/noise.js';

// Distant mountain ranges and sea stacks beyond the island, drawn as three
// concentric silhouette bands (impostors). They do their own aerial
// perspective so they read as layered blue ridges in the haze, catch warm
// light on the sun side and keep snow on the far peaks.

const VERT = /* glsl */ `
attribute vec3 aInfo; // x: column top height, y: slope along the ring, z: layer 0..1
varying vec3 vWorld;
varying vec3 vInfo;
varying float vAz;
void main(){
  vec4 wp = modelMatrix * vec4(position, 1.0);
  vWorld = wp.xyz;
  vInfo = aInfo;
  vAz = atan(position.x, position.z);
  gl_Position = projectionMatrix * viewMatrix * wp;
}`;

const FRAG = /* glsl */ `
uniform vec3 uSunDir;
uniform vec3 uSunColor;
uniform vec3 uSkyAmb;
uniform vec3 uFog;
uniform vec3 uHorizon;
uniform float uNight;
varying vec3 vWorld;
varying vec3 vInfo;
varying float vAz;
${NOISE_GLSL}
void main(){
  float top = max(vInfo.x, 1.0);
  float layer = vInfo.z;
  float y = vWorld.y;
  float v = clamp(y / top, 0.0, 1.0);
  float R = length(vWorld.xz);
  float s = vAz * R; // arc length
  vec3 inward = -normalize(vec3(vWorld.x, 0.0, vWorld.z));
  vec3 T = normalize(vec3(-inward.z, 0.0, inward.x));
  // ridge creases: noise in (arc, height) bends the pseudo normal sideways
  float n1 = snoise(vec2(s * 0.004, y * 0.006 + layer * 7.0));
  float n2 = snoise(vec2(s * 0.013, y * 0.017 - layer * 3.0));
  float slope = vInfo.y * 1.6 + n1 * 0.9 + n2 * 0.35;
  vec3 N = normalize(inward + T * slope + vec3(0.0, 0.55 + 0.35 * v, 0.0));
  float ndl = dot(N, uSunDir);
  float lit = smoothstep(-0.05, 0.25, ndl);
  vec3 rock = mix(vec3(0.36, 0.42, 0.40), vec3(0.46, 0.47, 0.52), layer);
  // grassy lower slopes on the nearest band
  rock = mix(rock, vec3(0.30, 0.42, 0.28), (1.0 - layer) * smoothstep(0.55, 0.15, v + n2 * 0.1));
  // snow on the far, tall peaks
  float snowLine = mix(0.95, 0.55, layer) + n1 * 0.08;
  float snow = smoothstep(snowLine, snowLine + 0.06, v) * smoothstep(120.0, 260.0, top);
  vec3 alb = mix(rock, vec3(0.92, 0.95, 1.0), snow);
  vec3 col = alb * (uSunColor * lit * 0.7 + uSkyAmb * 0.75);
  // aerial perspective: distant bands dissolve into the horizon haze
  vec3 haze = mix(uFog, uHorizon, 0.35 * v);
  float h = mix(0.5, 0.8, layer) + (1.0 - v) * mix(0.25, 0.15, layer);
  h = clamp(h - snow * lit * 0.12, 0.0, 0.97);
  col = mix(col, haze, h);
  // warm rim where the sun grazes the ridges
  float rim = smoothstep(0.92, 1.0, v) * pow(max(dot(normalize(vWorld - cameraPosition), uSunDir), 0.0), 6.0);
  col += uSunColor * rim * 0.25 * (1.0 - uNight);
  gl_FragColor = vec4(col, 1.0);
  #include <tonemapping_fragment>
  #include <colorspace_fragment>
}`;

// azimuth = atan2(x, z): 0 = +z (south), PI/2 = +x (east), +-PI = -z (north)
const RANGES = [
  // north: a broad massif behind the island's own mountain
  { a: Math.PI, w: 1.05, h: [0.6, 1.0, 1.0] },
  // north-east shoulder
  { a: 2.15, w: 0.35, h: [0.5, 0.8, 0.85] },
  // east: a chain of tall sea stacks / islands where the sun rises
  { a: 1.25, w: 0.42, h: [0.85, 0.55, 0.4] },
  { a: 0.62, w: 0.18, h: [0.55, 0.3, 0.0] },
  // south: a low far coast
  { a: 0.05, w: 0.4, h: [0.0, 0.35, 0.45] },
  // north-west, fading out before the sunset sky stays open
  { a: -2.35, w: 0.5, h: [0.45, 0.85, 0.9] },
];

function angDiff(a, b) {
  let d = a - b;
  while (d > Math.PI) d -= Math.PI * 2;
  while (d < -Math.PI) d += Math.PI * 2;
  return d;
}

export class Horizon {
  constructor(scene) {
    const simplex = new Simplex(4242);
    const layers = [
      { D: 1550, H: 170, f: 5.0 },
      { D: 2150, H: 360, f: 3.4 },
      { D: 2950, H: 560, f: 2.4 },
    ];
    const N = 900;
    const pos = [],
      info = [],
      idx = [];
    const ROWS = 4;
    layers.forEach((L, li) => {
      const heights = new Float32Array(N + 1);
      for (let i = 0; i <= N; i++) {
        const a = (i / N) * Math.PI * 2 - Math.PI;
        let m = 0;
        for (const r of RANGES) {
          const d = Math.abs(angDiff(a, r.a));
          m = Math.max(m, r.h[li] * smoothstep(r.w, r.w * 0.35, d));
        }
        const cx = Math.cos(a) * L.f,
          cz = Math.sin(a) * L.f;
        // ridged multi-octave profile
        let h = 0,
          amp = 1,
          fr = 1,
          norm = 0;
        for (let o = 0; o < 5; o++) {
          const nz = 1 - Math.abs(simplex.noise2(cx * fr + li * 31.7, cz * fr - li * 17.3));
          h += nz * nz * amp;
          norm += amp;
          amp *= 0.5;
          fr *= 2.1;
        }
        h /= norm;
        const peak = Math.pow(h, 1.6);
        heights[i] = m > 0.01 ? Math.max(0, (peak * 1.25 - 0.08) * m * L.H) : 0;
      }
      const base = pos.length / 3;
      const arc = ((Math.PI * 2) / N) * L.D;
      for (let i = 0; i <= N; i++) {
        const a = (i / N) * Math.PI * 2 - Math.PI;
        const top = heights[i];
        const slope = (heights[Math.min(N, i + 1)] - heights[Math.max(0, i - 1)]) / (2 * arc);
        // pull peaks a little closer so the band is not a perfect cylinder
        const D = L.D - top * 0.8;
        const x = Math.sin(a) * D,
          z = Math.cos(a) * D;
        for (let r = 0; r <= ROWS; r++) {
          const t = r / ROWS;
          const y = -80 + (top + 80) * t;
          pos.push(x, y, z);
          info.push(top, slope, li / 2);
        }
      }
      for (let i = 0; i < N; i++)
        for (let r = 0; r < ROWS; r++) {
          const a = base + i * (ROWS + 1) + r;
          const b = a + ROWS + 1;
          idx.push(a, a + 1, b, b, a + 1, b + 1);
        }
    });
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
    g.setAttribute('aInfo', new THREE.Float32BufferAttribute(info, 3));
    g.setIndex(idx);
    this.material = new THREE.ShaderMaterial({
      vertexShader: VERT,
      fragmentShader: FRAG,
      uniforms: {
        uSunDir: shared.uSunDir,
        uSunColor: shared.uSunColor,
        uSkyAmb: shared.uSkyAmb,
        uHorizon: shared.uHorizon,
        uNight: shared.uNight,
        uFog: { value: scene.fog ? scene.fog.color : new THREE.Color('#b8d6f4') },
      },
      side: THREE.DoubleSide,
      fog: false,
    });
    this.mesh = new THREE.Mesh(g, this.material);
    this.mesh.frustumCulled = false;
    this.mesh.renderOrder = -5;
    this.mesh.matrixAutoUpdate = false;
    scene.add(this.mesh);
  }
}
