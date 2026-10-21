import * as THREE from 'three';
import { mergeGeometries, mergeVertices } from 'three/addons/utils/BufferGeometryUtils.js';
import { mulberry32, Simplex, smoothstep, lerp, clamp } from '../core/noise.js';
import {
  makeLitShader,
  VERT_HEAD,
  FRAG_HEAD,
  FRAG_TAIL,
  NOISE_GLSL,
  LIGHT_GLSL,
} from '../render/shaders.js';
import { SPAWN, LANDMARKS, HALF } from './Terrain.js';

// ---------------------------------------------------------------------------
// Procedural textures
// ---------------------------------------------------------------------------
function leafClusterTexture() {
  const S = 256;
  const cv = document.createElement('canvas');
  cv.width = cv.height = S;
  const g = cv.getContext('2d');
  const rand = mulberry32(5);
  g.clearRect(0, 0, S, S);
  const leaves = 70;
  for (let i = 0; i < leaves; i++) {
    const a = rand() * Math.PI * 2;
    const r = Math.sqrt(rand()) * S * 0.36;
    const x = S / 2 + Math.cos(a) * r;
    const y = S / 2 + Math.sin(a) * r;
    const len = S * (0.09 + rand() * 0.06);
    const wid = len * (0.42 + rand() * 0.15);
    const rot = a + (rand() - 0.5) * 1.2;
    const shade = 170 + Math.floor(rand() * 85);
    g.save();
    g.translate(x, y);
    g.rotate(rot);
    g.beginPath();
    g.moveTo(-len * 0.5, 0);
    g.quadraticCurveTo(0, -wid, len * 0.55, 0);
    g.quadraticCurveTo(0, wid, -len * 0.5, 0);
    g.closePath();
    const grd = g.createLinearGradient(-len * 0.5, 0, len * 0.5, 0);
    grd.addColorStop(0, `rgb(${shade * 0.75},${shade * 0.75},${shade * 0.75})`);
    grd.addColorStop(1, `rgb(${shade},${shade},${shade})`);
    g.fillStyle = grd;
    g.fill();
    g.restore();
  }
  const tex = new THREE.CanvasTexture(cv);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.anisotropy = 4;
  return tex;
}

function flowerTexture() {
  const S = 128;
  const cv = document.createElement('canvas');
  cv.width = cv.height = S;
  const g = cv.getContext('2d');
  // stem
  g.strokeStyle = '#3f7a2a';
  g.lineWidth = 5;
  g.beginPath();
  g.moveTo(S / 2, S);
  g.quadraticCurveTo(S / 2 + 6, S * 0.7, S / 2, S * 0.38);
  g.stroke();
  // leaves
  g.fillStyle = '#4d8a33';
  g.beginPath();
  g.ellipse(S / 2 - 12, S * 0.78, 12, 4, -0.5, 0, Math.PI * 2);
  g.fill();
  // petals (white - tinted by instance colour)
  const cx = S / 2,
    cy = S * 0.3;
  for (let i = 0; i < 6; i++) {
    const a = (i / 6) * Math.PI * 2;
    g.save();
    g.translate(cx + Math.cos(a) * 13, cy + Math.sin(a) * 13);
    g.rotate(a);
    g.fillStyle = '#ffffff';
    g.beginPath();
    g.ellipse(0, 0, 14, 9, 0, 0, Math.PI * 2);
    g.fill();
    g.restore();
  }
  g.fillStyle = '#ffd34a';
  g.beginPath();
  g.arc(cx, cy, 8, 0, Math.PI * 2);
  g.fill();
  const tex = new THREE.CanvasTexture(cv);
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

// ---------------------------------------------------------------------------
// Geometry helpers
// ---------------------------------------------------------------------------
function taperedTube(points, r0, r1, radial = 7, segs = 8, color) {
  const curve = new THREE.CatmullRomCurve3(points);
  const pos = [],
    nor = [],
    col = [],
    uv = [],
    idx = [];
  const frames = curve.computeFrenetFrames(segs, false);
  const P = new THREE.Vector3();
  for (let i = 0; i <= segs; i++) {
    const t = i / segs;
    curve.getPointAt(t, P);
    const r = lerp(r0, r1, Math.pow(t, 0.8));
    const N = frames.normals[i],
      B = frames.binormals[i];
    for (let k = 0; k <= radial; k++) {
      const a = (k / radial) * Math.PI * 2;
      const nx = Math.cos(a) * N.x + Math.sin(a) * B.x;
      const ny = Math.cos(a) * N.y + Math.sin(a) * B.y;
      const nz = Math.cos(a) * N.z + Math.sin(a) * B.z;
      pos.push(P.x + nx * r, P.y + ny * r, P.z + nz * r);
      nor.push(nx, ny, nz);
      col.push(color.r, color.g, color.b);
      uv.push(k / radial, t);
    }
  }
  for (let i = 0; i < segs; i++)
    for (let k = 0; k < radial; k++) {
      const a = i * (radial + 1) + k;
      const b = a + radial + 1;
      idx.push(a, b, a + 1, b, b + 1, a + 1);
    }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('normal', new THREE.Float32BufferAttribute(nor, 3));
  g.setAttribute('aNormal2', new THREE.Float32BufferAttribute(nor.slice(), 3));
  g.setAttribute('aColor', new THREE.Float32BufferAttribute(col, 3));
  g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
  g.setIndex(idx);
  return g;
}

// Billboard-ish leaf cards scattered over a set of blobs, with "fluffy"
// normals pointing away from the canopy centre for soft cloud-like shading.
function leafCards(blobs, canopyCenter, rand, baseColor, cardSize = 1.5, density = 9) {
  const pos = [],
    nor = [],
    col = [],
    uv = [],
    idx = [];
  const tmp = new THREE.Vector3();
  const nrm = new THREE.Vector3();
  const t1 = new THREE.Vector3(),
    t2 = new THREE.Vector3();
  const canopyR = Math.max(...blobs.map((b) => b.c.distanceTo(canopyCenter) + b.r));
  let v = 0;
  for (const b of blobs) {
    const count = Math.round(density * b.r * b.r);
    for (let i = 0; i < count; i++) {
      // fibonacci-ish sphere point
      const y = 1 - ((i + 0.5) / count) * 2;
      const rr = Math.sqrt(1 - y * y);
      const phi = i * 2.399963 + rand() * 0.6;
      const dir = new THREE.Vector3(Math.cos(phi) * rr, y, Math.sin(phi) * rr);
      const p = b.c.clone().addScaledVector(dir, b.r * (0.72 + rand() * 0.25));
      // skip cards buried deep inside other blobs
      let buried = false;
      for (const o of blobs) if (o !== b && p.distanceTo(o.c) < o.r * 0.6) buried = true;
      if (buried) continue;
      nrm.copy(p).sub(canopyCenter).normalize().lerp(dir, 0.5).normalize();
      // card plane basis: face roughly outward, random roll
      const n = dir.clone().lerp(new THREE.Vector3(rand() - 0.5, rand() - 0.5, rand() - 0.5), 0.5).normalize();
      t1.set(0, 1, 0);
      if (Math.abs(n.y) > 0.9) t1.set(1, 0, 0);
      t2.crossVectors(n, t1).normalize();
      t1.crossVectors(t2, n).normalize();
      const roll = rand() * Math.PI * 2;
      const ca = Math.cos(roll),
        sa = Math.sin(roll);
      const ax = t1.clone().multiplyScalar(ca).addScaledVector(t2, sa);
      const ay = t1.clone().multiplyScalar(-sa).addScaledVector(t2, ca);
      const s = cardSize * (0.75 + rand() * 0.5) * 0.5;
      const ao = 0.55 + 0.45 * smoothstep(-1.0, 0.9, (p.y - canopyCenter.y) / canopyR);
      const outer = 0.85 + 0.15 * smoothstep(0.5, 1.0, p.distanceTo(canopyCenter) / canopyR);
      const shade = ao * outer * (0.92 + rand() * 0.16);
      const corners = [
        [-1, -1],
        [1, -1],
        [1, 1],
        [-1, 1],
      ];
      for (const [cx, cy] of corners) {
        tmp.copy(p).addScaledVector(ax, cx * s).addScaledVector(ay, cy * s);
        pos.push(tmp.x, tmp.y, tmp.z);
        nor.push(nrm.x, nrm.y, nrm.z);
        col.push(baseColor.r * shade, baseColor.g * shade, baseColor.b * shade);
        uv.push((cx + 1) / 2, (cy + 1) / 2);
      }
      idx.push(v, v + 1, v + 2, v, v + 2, v + 3);
      v += 4;
    }
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('normal', new THREE.Float32BufferAttribute(nor, 3));
  g.setAttribute('aNormal2', new THREE.Float32BufferAttribute(nor.slice(), 3));
  g.setAttribute('aColor', new THREE.Float32BufferAttribute(col, 3));
  g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
  g.setIndex(idx);
  return g;
}

function blobCore(blobs, canopyCenter, color) {
  const geos = [];
  for (const b of blobs) {
    const g = new THREE.IcosahedronGeometry(b.r * 0.78, 2);
    g.translate(b.c.x, b.c.y, b.c.z);
    const p = g.attributes.position;
    const n2 = [],
      col = [];
    const tmp = new THREE.Vector3();
    for (let i = 0; i < p.count; i++) {
      tmp.fromBufferAttribute(p, i).sub(canopyCenter).normalize();
      n2.push(tmp.x, tmp.y, tmp.z);
      col.push(color.r * 0.55, color.g * 0.55, color.b * 0.55);
    }
    g.setAttribute('aNormal2', new THREE.Float32BufferAttribute(n2, 3));
    g.setAttribute('aColor', new THREE.Float32BufferAttribute(col, 3));
    geos.push(g);
  }
  return mergeGeometries(geos);
}

// ---------------------------------------------------------------------------
// Shaders
// ---------------------------------------------------------------------------
const FOLIAGE_VERT = /* glsl */ `
${VERT_HEAD}
uniform float uTime;
uniform vec2 uWindDir;
uniform float uWindStrength;
uniform float uSway;
uniform float uFlutter;
attribute vec3 aColor;
attribute vec3 aNormal2;
varying vec3 vColor;
varying vec3 vN;
varying vec3 vWorldPos;
varying vec2 vUv;
varying float vH;
void main(){
  vec3 pos = position;
  mat4 im = mat4(1.0);
  #ifdef USE_INSTANCING
    im = instanceMatrix;
  #endif
  vec4 base = modelMatrix * im * vec4(0.0, 0.0, 0.0, 1.0);
  float ph = base.x * 0.07 + base.z * 0.05;
  float sway = sin(uTime * 1.2 + ph) * 0.6 + sin(uTime * 2.3 + ph * 1.7) * 0.3;
  float hf = max(pos.y, 0.0);
  pos.xz += uWindDir * sway * hf * hf * 0.0035 * uSway * uWindStrength;
  pos += uFlutter * 0.05 * vec3(sin(uTime * 4.1 + pos.y * 2.7 + ph), cos(uTime * 3.4 + pos.x * 3.1), sin(uTime * 3.8 + pos.z * 2.9));
  vec4 worldPosition = modelMatrix * im * vec4(pos, 1.0);
  vWorldPos = worldPosition.xyz;
  vN = normalize(mat3(modelMatrix * im) * aNormal2);
  vColor = aColor;
  #ifdef USE_INSTANCING_COLOR
    vColor *= instanceColor;
  #endif
  vUv = uv;
  vH = pos.y;
  vec3 transformedNormal = (viewMatrix * vec4(vN, 0.0)).xyz;
  #include <shadowmap_vertex>
  vec4 mvPosition = viewMatrix * worldPosition;
  gl_Position = projectionMatrix * mvPosition;
  #include <fog_vertex>
}
`;

const FOLIAGE_FRAG = /* glsl */ `
${FRAG_HEAD}
${LIGHT_GLSL}
${NOISE_GLSL}
uniform sampler2D uLeafTex;
uniform float uWrap;
uniform float uTranslucency;
uniform float uIsRock;
varying vec3 vColor;
varying vec3 vN;
varying vec3 vWorldPos;
varying vec2 vUv;
varying float vH;
void main(){
  vec3 albedo = vColor;
  float alpha = 1.0;
  #ifdef LEAF
    vec4 tex = texture2D(uLeafTex, vUv);
    albedo *= 0.7 + 0.45 * tex.r;
    #ifdef ALPHA_TO_COVERAGE
      alpha = clamp((tex.a - 0.45) / max(fwidth(tex.a), 1e-4) + 0.5, 0.0, 1.0);
      if (alpha < 0.01) discard;
    #else
      if (tex.a < 0.5) discard;
    #endif
  #endif
  vec3 n = normalize(vN);
  if (uIsRock > 0.5) {
    float m = smoothstep(0.45, 0.8, n.y + snoise(vWorldPos.xz * 0.8) * 0.15);
    float v = snoise(vWorldPos.xz * 0.35 + vWorldPos.y * 0.3) * 0.08;
    albedo = mix(albedo * (1.0 + v), vec3(0.17, 0.33, 0.08) * (1.0 + v), m * 0.85);
  }
  float shadow = getShadowMask();
  vec3 col = stylize(albedo, n, shadow, 1.0, uWrap);
  vec3 V = normalize(cameraPosition - vWorldPos);
  float back = pow(max(dot(-V, uSunDir), 0.0), 4.0);
  col += uSunColor * albedo * back * uTranslucency * (0.4 + 0.6 * shadow);
  float rim = pow(1.0 - max(dot(n, V), 0.0), 3.0);
  col += albedo * uSkyAmb * rim * 0.25 * uTranslucency;
  gl_FragColor = vec4(col, alpha);
  ${FRAG_TAIL}
}
`;

export const LEAF_MATERIALS = [];
export function setLeafCoverage(on) {
  for (const m of LEAF_MATERIALS) {
    if (m.alphaToCoverage !== on) {
      m.alphaToCoverage = on;
      m.needsUpdate = true;
    }
  }
}

function foliageMaterial({ leaf = false, leafTex = null, wrap = 0.5, trans = 0, sway = 1, flutter = 0, rock = false, a2c = false }) {
  const mat = makeLitShader({
    vertexShader: FOLIAGE_VERT,
    fragmentShader: FOLIAGE_FRAG,
    uniforms: {
      uLeafTex: { value: leafTex },
      uWrap: { value: wrap },
      uTranslucency: { value: trans },
      uSway: { value: sway },
      uFlutter: { value: flutter },
      uIsRock: { value: rock ? 1 : 0 },
    },
    side: leaf ? THREE.DoubleSide : THREE.FrontSide,
    defines: leaf ? { LEAF: '' } : {},
  });
  if (leaf && a2c) mat.alphaToCoverage = true;
  if (leaf) LEAF_MATERIALS.push(mat);
  return mat;
}

// ---------------------------------------------------------------------------
// Static collision (circles) in a spatial hash
// ---------------------------------------------------------------------------
export class Colliders {
  constructor(cell = 16) {
    this.cell = cell;
    this.map = new Map();
    this.list = [];
  }
  key(i, j) {
    return i * 73856093 + j * 19349663;
  }
  add(x, z, r, top = 1e9, bottom = -1e9) {
    const c = { x, z, r, top, bottom };
    this.list.push(c);
    const i0 = Math.floor((x - r) / this.cell),
      i1 = Math.floor((x + r) / this.cell);
    const j0 = Math.floor((z - r) / this.cell),
      j1 = Math.floor((z + r) / this.cell);
    for (let i = i0; i <= i1; i++)
      for (let j = j0; j <= j1; j++) {
        const k = this.key(i, j);
        if (!this.map.has(k)) this.map.set(k, []);
        this.map.get(k).push(c);
      }
    return c;
  }
  query(x, z) {
    return this.map.get(this.key(Math.floor(x / this.cell), Math.floor(z / this.cell))) || [];
  }
  // push a circle (player) out of static circles
  resolve(pos, radius) {
    const near = this.query(pos.x, pos.z);
    let hit = false;
    for (const c of near) {
      if (pos.y > c.top || pos.y + 1.6 < c.bottom) continue;
      const dx = pos.x - c.x,
        dz = pos.z - c.z;
      const d = Math.hypot(dx, dz);
      const m = c.r + radius;
      if (d < m && d > 1e-5) {
        pos.x = c.x + (dx / d) * m;
        pos.z = c.z + (dz / d) * m;
        hit = true;
      }
    }
    return hit;
  }
}

// ---------------------------------------------------------------------------
// Vegetation manager
// ---------------------------------------------------------------------------
export class Vegetation {
  constructor(scene, terrain, quality) {
    this.scene = scene;
    this.terrain = terrain;
    this.q = quality;
    this.colliders = new Colliders();
    this.leafTex = leafClusterTexture();
    this.flowerTex = flowerTexture();
    this.rand = mulberry32(2024);
    this.noise = new Simplex(77);
    this.meshes = [];
  }

  build() {
    this.buildTreeTypes();
    this.placeTrees();
    this.buildRocks();
    this.buildFlowers();
    this.buildGiantTree();
  }

  buildTreeTypes() {
    const rand = mulberry32(11);
    const trunkCol = new THREE.Color('#6b4a33');
    const leafCol = new THREE.Color('#5fa83a');
    this.types = [];
    const a2c = this.q.msaa > 0;
    this.leafMat = foliageMaterial({ leaf: true, leafTex: this.leafTex, wrap: 0.6, trans: 0.55, sway: 1, flutter: 1, a2c });
    this.trunkMat = foliageMaterial({ wrap: 0.3, sway: 1 });
    this.coreMat = foliageMaterial({ wrap: 0.6, trans: 0.2, sway: 1 });
    this.pineMat = foliageMaterial({ wrap: 0.45, trans: 0.15, sway: 0.6 });
    this.rockMat = foliageMaterial({ wrap: 0.3, sway: 0, rock: true });
    this.leafDepth = new THREE.MeshDepthMaterial({ depthPacking: THREE.RGBADepthPacking, map: this.leafTex, alphaTest: 0.5 });

    // three broadleaf variants
    for (let v = 0; v < 3; v++) {
      const h = 3.6 + v * 0.7 + rand();
      const lean = (rand() - 0.5) * 0.6;
      const trunkPts = [
        new THREE.Vector3(0, -0.3, 0),
        new THREE.Vector3(lean * 0.3, h * 0.35, 0.1),
        new THREE.Vector3(lean * 0.8, h * 0.7, -0.1),
        new THREE.Vector3(lean, h, 0),
      ];
      const geos = [taperedTube(trunkPts, 0.36, 0.14, 8, 8, trunkCol)];
      const cc = new THREE.Vector3(lean, h + 1.4, 0);
      const blobs = [{ c: cc.clone().add(new THREE.Vector3(0, 0.5, 0)), r: 2.1 + rand() * 0.4 }];
      const nb = 5 + Math.floor(rand() * 3);
      for (let i = 0; i < nb; i++) {
        const a = (i / nb) * Math.PI * 2 + rand();
        const d = 1.4 + rand() * 0.6;
        const c = cc.clone().add(new THREE.Vector3(Math.cos(a) * d, -0.5 + rand() * 1.1, Math.sin(a) * d));
        blobs.push({ c, r: 1.3 + rand() * 0.6 });
        // branch to blob
        geos.push(
          taperedTube(
            [new THREE.Vector3(lean * 0.7, h * 0.72, 0), c.clone().lerp(new THREE.Vector3(lean, h * 0.75, 0), 0.5).add(new THREE.Vector3(0, 0.3, 0)), c.clone().multiplyScalar(1)],
            0.12,
            0.04,
            5,
            4,
            trunkCol
          )
        );
      }
      const trunk = mergeGeometries(geos.map((g) => g.toNonIndexed ? g : g));
      const leaves = leafCards(blobs, cc, rand, leafCol, 1.7, 10);
      const core = blobCore(blobs, cc, leafCol);
      this.types.push({ kind: 'broad', trunk, leaves, core, radius: 0.45, height: h + 3.5 });
    }

    // pine variant
    {
      const geos = [];
      const h = 9;
      geos.push(taperedTube([new THREE.Vector3(0, -0.3, 0), new THREE.Vector3(0, h * 0.5, 0), new THREE.Vector3(0, h, 0)], 0.3, 0.05, 7, 4, trunkCol));
      const pineCol = new THREE.Color('#2f6b3a');
      const tiers = 6;
      const coneGeos = [];
      for (let t = 0; t < tiers; t++) {
        const y = 2.2 + t * 1.2;
        const r = 2.6 * (1 - t / (tiers + 0.6)) + 0.4;
        const cg = new THREE.ConeGeometry(r, 2.4, 12, 2, true);
        cg.translate(0, y + 1.2, 0);
        // jagged rim
        const p = cg.attributes.position;
        for (let i = 0; i < p.count; i++) {
          const yy = p.getY(i);
          if (yy < y + 0.2) {
            const a = Math.atan2(p.getZ(i), p.getX(i));
            p.setY(i, yy - 0.25 * (0.5 + 0.5 * Math.sin(a * 6 + t)) - rand() * 0.15);
          }
        }
        const n2 = [],
          col = [];
        const tmp = new THREE.Vector3();
        for (let i = 0; i < p.count; i++) {
          tmp.set(p.getX(i), (p.getY(i) - y) * 0.6 + 1.1, p.getZ(i)).normalize();
          n2.push(tmp.x, tmp.y, tmp.z);
          const shade = 0.7 + 0.3 * (t / tiers);
          col.push(pineCol.r * shade, pineCol.g * shade, pineCol.b * shade);
        }
        cg.deleteAttribute('uv');
        cg.setAttribute('uv', new THREE.Float32BufferAttribute(new Float32Array(p.count * 2), 2));
        cg.setAttribute('aNormal2', new THREE.Float32BufferAttribute(n2, 3));
        cg.setAttribute('aColor', new THREE.Float32BufferAttribute(col, 3));
        coneGeos.push(cg);
      }
      this.types.push({ kind: 'pine', trunk: mergeGeometries(geos), cones: mergeGeometries(coneGeos), radius: 0.4, height: 10 });
    }

    // bush
    {
      const blobs = [
        { c: new THREE.Vector3(0, 0.55, 0), r: 0.85 },
        { c: new THREE.Vector3(0.6, 0.4, 0.2), r: 0.6 },
        { c: new THREE.Vector3(-0.5, 0.42, -0.25), r: 0.62 },
      ];
      const cc = new THREE.Vector3(0, 0.3, 0);
      const bushCol = new THREE.Color('#57a03a');
      this.bush = {
        leaves: leafCards(blobs, cc, rand, bushCol, 0.9, 16),
        core: blobCore(blobs, cc, bushCol),
      };
    }
  }

  canPlant(x, z, minGrass = 0.45) {
    const t = this.terrain;
    const h = t.heightAt(x, z);
    if (h < 2.2) return false;
    const n = t.normalAt(x, z);
    if (n.y < 0.82) return false;
    if (t.grassAt(x, z) < minGrass && h < 60) return false;
    if (t.pathDistance(x, z) < 4.5) return false;
    return true;
  }

  placeTrees() {
    const rand = this.rand;
    const t = this.terrain;
    const mul = this.q.trees;
    const broad = [[], [], []];
    const pines = [];
    const bushes = [];
    const occupied = new Map();
    const occKey = (x, z) => Math.floor(x / 5) * 10007 + Math.floor(z / 5);
    const tryOcc = (x, z) => {
      const k = occKey(x, z);
      if (occupied.has(k)) return false;
      occupied.set(k, 1);
      return true;
    };
    const total = Math.floor(26000 * mul);
    for (let i = 0; i < total; i++) {
      const x = (rand() - 0.5) * 2 * (HALF - 20);
      const z = (rand() - 0.5) * 2 * (HALF - 20);
      const sd = Math.hypot(x - SPAWN.x, z - SPAWN.z);
      if (sd < 22) continue;
      if (Math.hypot(x - LANDMARKS.statue.x, z - LANDMARKS.statue.z) < 30) continue;
      if (Math.hypot(x - LANDMARKS.giantTree.x, z - LANDMARKS.giantTree.z) < 26) continue;
      const h = t.heightAt(x, z);
      const forest = t.forestAt(x, z);
      const alpine = smoothstep(40, 70, h);
      let p = forest * 0.55 + 0.012;
      if (rand() > p + alpine * 0.25) continue;
      if (!this.canPlant(x, z, alpine > 0.5 ? 0.0 : 0.35)) continue;
      if (h > 125) continue;
      if (!tryOcc(x, z)) continue;
      const isPine = rand() < alpine * 0.9 + (forest > 0.5 ? 0.12 : 0.0);
      const s = 0.85 + rand() * 0.5;
      const rot = rand() * Math.PI * 2;
      const item = { x, y: h, z, s, rot };
      if (isPine) pines.push(item);
      else broad[Math.floor(rand() * 3)].push(item);
      this.colliders.add(x, z, (isPine ? 0.4 : 0.45) * s, h + 8, h - 2);
    }
    // bushes
    const bushTotal = Math.floor(9000 * mul);
    for (let i = 0; i < bushTotal; i++) {
      const x = (rand() - 0.5) * 2 * (HALF - 20);
      const z = (rand() - 0.5) * 2 * (HALF - 20);
      const forest = t.forestAt(x, z);
      if (rand() > forest * 0.4 + 0.04) continue;
      if (Math.hypot(x - SPAWN.x, z - SPAWN.z) < 10) continue;
      if (!this.canPlant(x, z, 0.4)) continue;
      const h = t.heightAt(x, z);
      if (h > 70) continue;
      bushes.push({ x, y: h, z, s: 0.7 + rand() * 0.7, rot: rand() * Math.PI * 2 });
    }

    const color = new THREE.Color();
    const addInstanced = (geo, mat, items, opts = {}) => {
      if (!items.length) return null;
      const mesh = new THREE.InstancedMesh(geo, mat, items.length);
      const m = new THREE.Matrix4();
      const q = new THREE.Quaternion();
      const sc = new THREE.Vector3();
      const ps = new THREE.Vector3();
      items.forEach((it, i) => {
        q.setFromAxisAngle(new THREE.Vector3(0, 1, 0), it.rot);
        sc.setScalar(it.s);
        ps.set(it.x, it.y, it.z);
        m.compose(ps, q, sc);
        mesh.setMatrixAt(i, m);
        if (opts.tint) {
          opts.tint(color, it);
          mesh.setColorAt(i, color);
        }
      });
      mesh.instanceMatrix.needsUpdate = true;
      if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
      mesh.castShadow = opts.cast ?? true;
      mesh.receiveShadow = true;
      if (opts.depth) mesh.customDepthMaterial = opts.depth;
      mesh.computeBoundingSphere();
      this.scene.add(mesh);
      this.meshes.push(mesh);
      return mesh;
    };
    const leafTint = (c, it) => {
      const n = this.noise.noise2(it.x * 0.01, it.z * 0.01);
      c.setRGB(1, 1, 1);
      c.offsetHSL((n * 0.04) + (rand() - 0.5) * 0.03, (rand() - 0.5) * 0.1, (rand() - 0.5) * 0.08 + n * 0.04);
    };
    broad.forEach((items, v) => {
      const ty = this.types[v];
      addInstanced(ty.trunk, this.trunkMat, items);
      addInstanced(ty.core, this.coreMat, items, { tint: leafTint, cast: false });
      addInstanced(ty.leaves, this.leafMat, items, { tint: leafTint, depth: this.leafDepth });
    });
    const pine = this.types[3];
    addInstanced(pine.trunk, this.trunkMat, pines);
    addInstanced(pine.cones, this.pineMat, pines, { tint: leafTint });
    addInstanced(this.bush.core, this.coreMat, bushes, { tint: leafTint, cast: false });
    addInstanced(this.bush.leaves, this.leafMat, bushes, { tint: leafTint, depth: this.leafDepth });
    this.treeCount = broad.reduce((a, b) => a + b.length, 0) + pines.length;
  }

  buildRocks() {
    const rand = mulberry32(31);
    const noise = new Simplex(9);
    const variants = [];
    for (let v = 0; v < 4; v++) {
      let g = new THREE.IcosahedronGeometry(1, 3);
      g.deleteAttribute('uv');
      g.deleteAttribute('normal');
      g = mergeVertices(g);
      const p = g.attributes.position;
      const tmp = new THREE.Vector3();
      for (let i = 0; i < p.count; i++) {
        tmp.fromBufferAttribute(p, i);
        const d = 1 + noise.noise2(tmp.x * 1.3 + v * 10, tmp.y * 1.3 + tmp.z) * 0.22 + noise.noise2(tmp.x * 3.1, tmp.z * 3.1 + v) * 0.07;
        tmp.multiplyScalar(d);
        // flatten bottom, facet top
        if (tmp.y < -0.2) tmp.y = -0.2 + (tmp.y + 0.2) * 0.3;
        tmp.y *= 0.72;
        p.setXYZ(i, tmp.x * (1.1 + v * 0.1), tmp.y, tmp.z);
      }
      g.computeVertexNormals();
      const nrm = g.attributes.normal.array.slice();
      const col = [];
      const base = new THREE.Color('#8f8a80');
      for (let i = 0; i < p.count; i++) col.push(base.r, base.g, base.b);
      g.setAttribute('aNormal2', new THREE.Float32BufferAttribute(nrm, 3));
      g.setAttribute('aColor', new THREE.Float32BufferAttribute(col, 3));
      g.setAttribute('uv', new THREE.Float32BufferAttribute(new Float32Array(p.count * 2), 2));
      variants.push(g);
    }
    const t = this.terrain;
    const buckets = [[], [], [], []];
    const total = Math.floor(3500 * this.q.trees);
    for (let i = 0; i < total; i++) {
      const x = (rand() - 0.5) * 2 * (HALF - 20);
      const z = (rand() - 0.5) * 2 * (HALF - 20);
      const h = t.heightAt(x, z);
      if (h < 0.5) continue;
      if (Math.hypot(x - SPAWN.x, z - SPAWN.z) < 12) continue;
      const n = t.normalAt(x, z);
      const steep = 1 - n.y;
      const pr = 0.05 + steep * 0.7 + smoothstep(50, 110, h) * 0.2;
      if (rand() > pr) continue;
      if (t.pathDistance(x, z) < 3) continue;
      const big = rand() < 0.15;
      const s = big ? 1.8 + rand() * 2.2 : 0.3 + rand() * 0.9;
      buckets[Math.floor(rand() * 4)].push({ x, y: h - s * 0.15, z, s, rot: rand() * Math.PI * 2, n });
      if (s > 0.6) this.colliders.add(x, z, s * 1.05, h + s * 0.9, h - 1);
    }
    const color = new THREE.Color();
    buckets.forEach((items, v) => {
      if (!items.length) return;
      const mesh = new THREE.InstancedMesh(variants[v], this.rockMat, items.length);
      const m = new THREE.Matrix4();
      const q = new THREE.Quaternion();
      const up = new THREE.Vector3(0, 1, 0);
      items.forEach((it, i) => {
        q.setFromUnitVectors(up, it.n.clone().lerp(up, 0.5).normalize());
        q.multiply(new THREE.Quaternion().setFromAxisAngle(up, it.rot));
        m.compose(new THREE.Vector3(it.x, it.y, it.z), q, new THREE.Vector3(it.s, it.s, it.s));
        mesh.setMatrixAt(i, m);
        color.setRGB(1, 1, 1).offsetHSL(0, (rand() - 0.5) * 0.05, (rand() - 0.5) * 0.12);
        mesh.setColorAt(i, color);
      });
      mesh.castShadow = true;
      mesh.receiveShadow = true;
      mesh.computeBoundingSphere();
      this.scene.add(mesh);
      this.meshes.push(mesh);
    });
  }

  buildFlowers() {
    const rand = mulberry32(55);
    const t = this.terrain;
    const items = [];
    const total = Math.floor(9000 * this.q.trees);
    const palette = ['#f2f0ea', '#ffd95a', '#ff8fbd', '#a993ff', '#7fc6ff', '#ffa55a'].map((c) => new THREE.Color(c).multiplyScalar(0.75));
    // clustered flowers
    let tries = 0;
    while (items.length < total && tries < total * 8) {
      tries++;
      const cx = (rand() - 0.5) * 2 * (HALF - 40);
      const cz = (rand() - 0.5) * 2 * (HALF - 40);
      const sd = Math.hypot(cx - SPAWN.x, cz - SPAWN.z);
      const bias = sd < 160 ? 0.9 : 0.2;
      if (rand() > bias) continue;
      if (t.grassAt(cx, cz) < 0.6) continue;
      const col = palette[Math.floor(rand() * palette.length)];
      const n = 6 + Math.floor(rand() * 18);
      for (let k = 0; k < n; k++) {
        const x = cx + (rand() - 0.5) * 7;
        const z = cz + (rand() - 0.5) * 7;
        if (t.grassAt(x, z) < 0.5) continue;
        items.push({ x, y: t.heightAt(x, z) - 0.03, z, s: 0.22 + rand() * 0.16, rot: rand() * Math.PI, col });
      }
    }
    // crossed quad geometry
    const q1 = new THREE.PlaneGeometry(1, 1);
    q1.translate(0, 0.5, 0);
    const q2 = q1.clone().rotateY(Math.PI / 2);
    const geo = mergeGeometries([q1, q2]);
    const p = geo.attributes.position;
    const n2 = [],
      col = [];
    for (let i = 0; i < p.count; i++) {
      n2.push(0, 1, 0);
      col.push(1, 1, 1);
    }
    geo.setAttribute('aNormal2', new THREE.Float32BufferAttribute(n2, 3));
    geo.setAttribute('aColor', new THREE.Float32BufferAttribute(col, 3));
    const mat = foliageMaterial({ leaf: true, leafTex: this.flowerTex, wrap: 0.6, trans: 0.3, sway: 30, flutter: 0.3, a2c: this.q.msaa > 0 });
    const mesh = new THREE.InstancedMesh(geo, mat, items.length);
    const m = new THREE.Matrix4();
    const qq = new THREE.Quaternion();
    items.forEach((it, i) => {
      qq.setFromAxisAngle(new THREE.Vector3(0, 1, 0), it.rot);
      m.compose(new THREE.Vector3(it.x, it.y, it.z), qq, new THREE.Vector3(it.s, it.s * 1.15, it.s));
      mesh.setMatrixAt(i, m);
      mesh.setColorAt(i, it.col);
    });
    mesh.castShadow = false;
    mesh.receiveShadow = true;
    mesh.computeBoundingSphere();
    this.scene.add(mesh);
    this.meshes.push(mesh);
    this.flowerItems = items;
  }

  // Landmark: an enormous tree on the western hill (visible from far away).
  buildGiantTree() {
    const rand = mulberry32(808);
    const { x, z } = LANDMARKS.giantTree;
    const y = this.terrain.heightAt(x, z) - 1;
    const trunkCol = new THREE.Color('#5d4130');
    const geos = [];
    const H = 28;
    // twisted trunk made of several intertwined tubes
    for (let k = 0; k < 4; k++) {
      const a0 = (k / 4) * Math.PI * 2;
      const pts = [];
      for (let i = 0; i <= 6; i++) {
        const t = i / 6;
        const a = a0 + t * 2.2;
        const r = lerp(2.4, 0.9, t);
        pts.push(new THREE.Vector3(Math.cos(a) * r, -2 + t * H, Math.sin(a) * r));
      }
      geos.push(taperedTube(pts, 2.0, 0.9, 10, 16, trunkCol));
    }
    // roots
    for (let k = 0; k < 7; k++) {
      const a = (k / 7) * Math.PI * 2 + rand() * 0.4;
      geos.push(
        taperedTube(
          [new THREE.Vector3(Math.cos(a) * 1.5, 3, Math.sin(a) * 1.5), new THREE.Vector3(Math.cos(a) * 5, 0.6, Math.sin(a) * 5), new THREE.Vector3(Math.cos(a) * 9, -1.2, Math.sin(a) * 9)],
          1.3,
          0.25,
          8,
          8,
          trunkCol
        )
      );
    }
    // big branches
    const blobs = [];
    const cc = new THREE.Vector3(0, H + 6, 0);
    blobs.push({ c: cc.clone().add(new THREE.Vector3(0, 4, 0)), r: 10 });
    for (let k = 0; k < 9; k++) {
      const a = (k / 9) * Math.PI * 2 + rand() * 0.3;
      const d = 10 + rand() * 4;
      const c = new THREE.Vector3(Math.cos(a) * d, H + 2 + rand() * 6, Math.sin(a) * d);
      blobs.push({ c, r: 6.5 + rand() * 2.5 });
      geos.push(taperedTube([new THREE.Vector3(0, H - 6, 0), new THREE.Vector3(c.x * 0.5, H + 1, c.z * 0.5), c.clone()], 1.1, 0.3, 8, 8, trunkCol));
    }
    const trunk = mergeGeometries(geos);
    const leafCol = new THREE.Color('#62ad3c');
    const leaves = leafCards(blobs, cc, rand, leafCol, 5.5, 1.6);
    const core = blobCore(blobs, cc, leafCol);
    const group = new THREE.Group();
    const mk = (g, m, depth) => {
      const mesh = new THREE.Mesh(g, m);
      mesh.castShadow = true;
      mesh.receiveShadow = true;
      if (depth) mesh.customDepthMaterial = depth;
      group.add(mesh);
      return mesh;
    };
    const mt = foliageMaterial({ wrap: 0.3, sway: 0.05 });
    const ml = foliageMaterial({ leaf: true, leafTex: this.leafTex, wrap: 0.6, trans: 0.55, sway: 0.08, flutter: 1, a2c: this.q.msaa > 0 });
    const mc = foliageMaterial({ wrap: 0.6, trans: 0.2, sway: 0.08 });
    mk(trunk, mt);
    const coreMesh = mk(core, mc);
    coreMesh.castShadow = false;
    mk(leaves, ml, this.leafDepth);
    group.position.set(x, y, z);
    this.scene.add(group);
    this.colliders.add(x, z, 3.2, y + 40, y - 5);
    this.giantTree = group;
  }
}
