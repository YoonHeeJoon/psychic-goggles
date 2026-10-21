import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import {
  makeLitShader,
  VERT_HEAD,
  FRAG_HEAD,
  FRAG_TAIL,
  NOISE_GLSL,
  LIGHT_GLSL,
  TERRAIN_SAMPLE_GLSL,
} from '../render/shaders.js';
import { toonMaterial } from '../render/materials.js';
import { LANDMARKS, SPAWN, CELL, DOMAIN_REALM, BRIDGE, PORT_LEN, CAMPS, portWorld } from './Terrain.js';
import { buildHighlands, updateBoats } from './Highlands.js';
import { shared } from '../render/shaders.js';
import { mulberry32, smoothstep, lerp } from '../core/noise.js';

const V3 = THREE.Vector3;
const Y_AXIS = new V3(0, 1, 0);
const TAU = Math.PI * 2;

// ---------------------------------------------------------------------------
// Procedural canvas textures. They are kept light and neutral; vertex colours
// supply the actual hue so one texture serves many materials.
// ---------------------------------------------------------------------------
function makeCanvas(S) {
  const c = document.createElement('canvas');
  c.width = c.height = S;
  return [c, c.getContext('2d')];
}
function toTex(cv) {
  const t = new THREE.CanvasTexture(cv);
  t.colorSpace = THREE.SRGBColorSpace;
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.anisotropy = 8;
  return t;
}
// draw something that wraps around the tile edges
function wrapped(S, x, y, r, fn) {
  for (const dx of [-S, 0, S])
    for (const dy of [-S, 0, S]) {
      if (x + dx + r < 0 || x + dx - r > S || y + dy + r < 0 || y + dy - r > S) continue;
      fn(x + dx, y + dy);
    }
}
function blotches(g, S, rand, n, rMin, rMax, colors) {
  for (let i = 0; i < n; i++) {
    const x = rand() * S,
      y = rand() * S,
      r = rMin + rand() * (rMax - rMin);
    const c = colors[Math.floor(rand() * colors.length)];
    wrapped(S, x, y, r, (px, py) => {
      const gr = g.createRadialGradient(px, py, 0, px, py, r);
      gr.addColorStop(0, c);
      gr.addColorStop(1, 'rgba(0,0,0,0)');
      g.fillStyle = gr;
      g.fillRect(px - r, py - r, r * 2, r * 2);
    });
  }
}
function speckle(g, S, rand, n, color) {
  g.fillStyle = color;
  for (let i = 0; i < n; i++) g.fillRect(rand() * S, rand() * S, 1 + rand() * 1.5, 1 + rand() * 1.5);
}

function plasterTexture() {
  const S = 256;
  const [cv, g] = makeCanvas(S);
  const rand = mulberry32(31);
  g.fillStyle = '#f2ede2';
  g.fillRect(0, 0, S, S);
  blotches(g, S, rand, 160, 12, 46, ['rgba(160,140,110,0.05)', 'rgba(255,255,255,0.06)', 'rgba(140,130,120,0.04)']);
  speckle(g, S, rand, 1600, 'rgba(90,80,60,0.05)');
  speckle(g, S, rand, 600, 'rgba(255,255,255,0.08)');
  return toTex(cv);
}

function stoneTexture() {
  const S = 512;
  const [cv, g] = makeCanvas(S);
  const rand = mulberry32(57);
  g.fillStyle = '#958d80';
  g.fillRect(0, 0, S, S);
  const rows = 8;
  let y = 0;
  for (let r = 0; r < rows; r++) {
    const h = S / rows;
    let x = rand() * 60;
    const start = x;
    while (x < start + S) {
      const w = 70 + rand() * 90;
      const tone = 0.86 + rand() * 0.16;
      const c = (v) => Math.round(Math.min(255, v * tone));
      const draw = (px) => {
        const gx = px + 3,
          gy = y + 3,
          gw = w - 6,
          gh = h - 6;
        g.fillStyle = `rgb(${c(232)},${c(226)},${c(214)})`;
        g.beginPath();
        if (g.roundRect) g.roundRect(gx, gy, gw, gh, 7);
        else g.rect(gx, gy, gw, gh);
        g.fill();
        // bevel light / shade
        const gr = g.createLinearGradient(gx, gy, gx + gw * 0.3, gy + gh);
        gr.addColorStop(0, 'rgba(255,255,255,0.22)');
        gr.addColorStop(0.5, 'rgba(255,255,255,0)');
        gr.addColorStop(1, 'rgba(60,50,40,0.22)');
        g.fillStyle = gr;
        g.fill();
        // chips
        for (let k = 0; k < 4; k++) {
          g.fillStyle = `rgba(80,70,60,${0.05 + rand() * 0.08})`;
          g.beginPath();
          g.arc(gx + rand() * gw, gy + rand() * gh, 2 + rand() * 7, 0, TAU);
          g.fill();
        }
        if (rand() < 0.25) {
          g.strokeStyle = 'rgba(70,60,50,0.35)';
          g.lineWidth = 1.2;
          g.beginPath();
          let cx = gx + rand() * gw,
            cy = gy;
          g.moveTo(cx, cy);
          for (let k = 0; k < 4; k++) {
            cx += (rand() - 0.5) * 14;
            cy += gh / 4;
            g.lineTo(cx, cy);
          }
          g.stroke();
        }
      };
      draw(x % S);
      if ((x % S) + w > S) draw((x % S) - S);
      x += w;
    }
    y += h;
  }
  speckle(g, S, rand, 3000, 'rgba(60,50,40,0.06)');
  return toTex(cv);
}

function woodTexture() {
  const S = 256;
  const [cv, g] = makeCanvas(S);
  const rand = mulberry32(91);
  const planks = 5;
  const pw = S / planks;
  for (let p = 0; p < planks; p++) {
    const tone = 0.85 + rand() * 0.18;
    g.fillStyle = `rgb(${Math.round(236 * tone)},${Math.round(222 * tone)},${Math.round(200 * tone)})`;
    g.fillRect(p * pw, 0, pw, S);
    for (let k = 0; k < 16; k++) {
      g.strokeStyle = `rgba(90,60,30,${0.06 + rand() * 0.1})`;
      g.lineWidth = 0.8 + rand() * 1.4;
      g.beginPath();
      const x0 = p * pw + rand() * pw;
      g.moveTo(x0, 0);
      for (let yy = 0; yy <= S; yy += 16) g.lineTo(x0 + Math.sin(yy * 0.04 + k) * 2.5, yy);
      g.stroke();
    }
    if (rand() < 0.6) {
      const kx = p * pw + pw * (0.3 + rand() * 0.4),
        ky = rand() * S;
      g.fillStyle = 'rgba(80,50,25,0.35)';
      g.beginPath();
      g.ellipse(kx, ky, 3, 6, 0, 0, TAU);
      g.fill();
    }
    g.fillStyle = 'rgba(40,25,15,0.55)';
    g.fillRect(p * pw, 0, 2, S);
  }
  return toTex(cv);
}

function roofTexture() {
  const S = 256;
  const [cv, g] = makeCanvas(S);
  const rand = mulberry32(13);
  g.fillStyle = '#5c4a44';
  g.fillRect(0, 0, S, S);
  const rows = 6,
    cols = 8;
  const rh = S / rows,
    cw = S / cols;
  for (let r = 0; r < rows; r++) {
    const off = r % 2 ? cw / 2 : 0;
    for (let c = -1; c <= cols; c++) {
      const x = c * cw + off,
        y = r * rh;
      const tone = 0.86 + rand() * 0.2;
      const gr = g.createLinearGradient(0, y, 0, y + rh * 1.15);
      gr.addColorStop(0, `rgb(${Math.round(150 * tone)},${Math.round(140 * tone)},${Math.round(136 * tone)})`);
      gr.addColorStop(0.35, `rgb(${Math.round(240 * tone)},${Math.round(232 * tone)},${Math.round(226 * tone)})`);
      gr.addColorStop(1, `rgb(${Math.round(205 * tone)},${Math.round(195 * tone)},${Math.round(188 * tone)})`);
      g.fillStyle = gr;
      g.beginPath();
      g.moveTo(x + 2, y);
      g.lineTo(x + cw - 2, y);
      g.lineTo(x + cw - 2, y + rh * 0.8);
      g.quadraticCurveTo(x + cw / 2, y + rh * 1.18, x + 2, y + rh * 0.8);
      g.closePath();
      g.fill();
      g.strokeStyle = 'rgba(40,25,20,0.35)';
      g.lineWidth = 1.5;
      g.stroke();
    }
  }
  return toTex(cv);
}

function cobbleTexture() {
  const S = 512;
  const [cv, g] = makeCanvas(S);
  const rand = mulberry32(7);
  g.fillStyle = '#7d7468';
  g.fillRect(0, 0, S, S);
  const n = 13;
  const cs = S / n;
  for (let j = 0; j < n; j++)
    for (let i = 0; i < n; i++) {
      const x = (i + 0.5 + (rand() - 0.5) * 0.35) * cs,
        y = (j + 0.5 + (rand() - 0.5) * 0.35) * cs;
      const rx = cs * (0.4 + rand() * 0.08),
        ry = cs * (0.36 + rand() * 0.08);
      const tone = 0.82 + rand() * 0.22;
      wrapped(S, x, y, cs, (px, py) => {
        const gr = g.createRadialGradient(px - rx * 0.3, py - ry * 0.35, 1, px, py, rx * 1.1);
        gr.addColorStop(0, `rgb(${Math.round(250 * tone)},${Math.round(244 * tone)},${Math.round(232 * tone)})`);
        gr.addColorStop(1, `rgb(${Math.round(180 * tone)},${Math.round(170 * tone)},${Math.round(158 * tone)})`);
        g.fillStyle = gr;
        g.beginPath();
        g.ellipse(px, py, rx, ry, rand() * 3, 0, TAU);
        g.fill();
      });
    }
  speckle(g, S, rand, 2500, 'rgba(50,40,30,0.07)');
  return toTex(cv);
}

// ---------------------------------------------------------------------------
// Stylized prop shader: vertex colour x neutral texture, wrapped diffuse,
// contact AO + moss from the terrain height, optional night glow and sway.
// ---------------------------------------------------------------------------
const PROP_VERT = /* glsl */ `
${VERT_HEAD}
attribute vec3 aCol;
attribute float aExtra;
uniform float uTime;
uniform vec2 uWindDir;
uniform float uSway;
varying vec3 vCol;
varying vec3 vN;
varying vec3 vW;
varying vec2 vUv;
varying float vExtra;
void main(){
  vec4 worldPosition = modelMatrix * vec4(position, 1.0);
  if (uSway > 0.0) {
    float ph = uTime * 3.4 + worldPosition.x * 0.9 + worldPosition.z * 0.7;
    worldPosition.xz += uWindDir * (sin(ph) * 0.6 + 0.5) * aExtra * uSway;
    worldPosition.y += cos(ph * 1.3) * aExtra * uSway * 0.35;
  }
  vec3 transformedNormal = normalMatrix * normal;
  vN = normalize(mat3(modelMatrix) * normal);
  vW = worldPosition.xyz;
  vCol = aCol;
  vUv = uv;
  vExtra = aExtra;
  #include <shadowmap_vertex>
  vec4 mvPosition = viewMatrix * worldPosition;
  gl_Position = projectionMatrix * mvPosition;
  #include <fog_vertex>
}
`;

const PROP_FRAG = /* glsl */ `
${FRAG_HEAD}
${LIGHT_GLSL}
${NOISE_GLSL}
${TERRAIN_SAMPLE_GLSL}
uniform sampler2D uMap;
uniform float uUseMap;
uniform float uWrap;
uniform float uMoss;
uniform float uAO;
uniform float uSpec;
uniform float uNight;
uniform vec3 uGlow;
uniform float uEmitDay;
uniform float uEmitNight;
uniform float uSway;
varying vec3 vCol;
varying vec3 vN;
varying vec3 vW;
varying vec2 vUv;
varying float vExtra;
void main(){
  vec3 n = normalize(vN);
  if (!gl_FrontFacing) n = -n;
  vec3 alb = vCol;
  if (uUseMap > 0.5) alb *= texture2D(uMap, vUv).rgb;
  float above = vW.y - terrainHeight(vW.xz);
  if (uMoss > 0.0) {
    float nz = snoise(vW.xz * 0.9 + vW.y * 0.5);
    float top = smoothstep(0.55, 0.95, n.y + nz * 0.3);
    float foot = smoothstep(1.1 + nz * 0.5, 0.0, above);
    float m = clamp((top * 0.85 + foot * 0.55) * uMoss * (0.75 + 0.25 * nz), 0.0, 0.9);
    vec3 moss = vec3(0.21, 0.35, 0.12) * (0.85 + 0.3 * snoise(vW.xz * 2.3 + 4.0));
    alb = mix(alb, moss, m);
  }
  float ao = mix(uAO, 1.0, smoothstep(-0.2, 1.5, above));
  float wet = uWet * smoothstep(-0.2, 0.6, n.y + 0.3);
  alb *= 1.0 - 0.3 * wet;
  float shadow = getShadowMask() * cloudShadow(vW, uSunDir);
  vec3 col = stylize(alb, n, shadow, ao, uWrap);
  vec3 V = normalize(cameraPosition - vW);
  col += wetSheen(n, V, wet * 0.8, shadow);
  float fr = pow(1.0 - max(dot(n, V), 0.0), 4.0);
  col += uSkyAmb * alb * fr * 0.45;
  if (uSpec > 0.0) {
    vec3 H = normalize(uSunDir + V);
    float sp = pow(max(dot(n, H), 0.0), 48.0);
    col += uSunColor * sp * uSpec * shadow;
    col += uSkyAmb * fr * uSpec * 0.8;
  }
  float em = (uSway > 0.0 ? 0.0 : vExtra) * mix(uEmitDay, uEmitNight, uNight);
  col = mix(col, uGlow, clamp(em, 0.0, 1.0) * 0.85) + uGlow * max(em - 1.0, 0.0);
  gl_FragColor = vec4(col, 1.0);
  ${FRAG_TAIL}
}
`;

function propMat({ map = null, moss = 0, wrap = 0.35, ao = 0.55, spec = 0, glow = '#000000', emitDay = 0, emitNight = 0, side = THREE.FrontSide, sway = 0, offset = false } = {}) {
  const m = makeLitShader({
    vertexShader: PROP_VERT,
    fragmentShader: PROP_FRAG,
    uniforms: {
      uMap: { value: map },
      uUseMap: { value: map ? 1 : 0 },
      uMoss: { value: moss },
      uWrap: { value: wrap },
      uAO: { value: ao },
      uSpec: { value: spec },
      uGlow: { value: new THREE.Color(glow) },
      uEmitDay: { value: emitDay },
      uEmitNight: { value: emitNight },
      uSway: { value: sway },
    },
    side,
  });
  if (offset) {
    m.polygonOffset = true;
    m.polygonOffsetFactor = -2;
    m.polygonOffsetUnits = -4;
  }
  return m;
}

// ---------------------------------------------------------------------------
// Geometry helpers
// ---------------------------------------------------------------------------
const _q = new THREE.Quaternion();
const _e = new THREE.Euler();
const _s = new V3();
const _p = new V3();
export function M(x = 0, y = 0, z = 0, rx = 0, ry = 0, rz = 0, sx = 1, sy = sx, sz = sx) {
  return new THREE.Matrix4().compose(_p.set(x, y, z), _q.setFromEuler(_e.set(rx, ry, rz)), _s.set(sx, sy, sz));
}
export function cyl(rt, rb, h, seg = 12, open = false) {
  const g = new THREE.CylinderGeometry(rt, rb, h, seg, 1, open);
  g.translate(0, h / 2, 0);
  return g;
}
export function box(w, h, d) {
  const g = new THREE.BoxGeometry(w, h, d);
  g.translate(0, h / 2, 0);
  return g;
}
// cylinder spanning two points
export function between(a, b, r1, r2 = r1, seg = 8) {
  const d = new V3().subVectors(b, a);
  const L = d.length();
  const g = new THREE.CylinderGeometry(r2, r1, L, seg, 1);
  g.translate(0, L / 2, 0);
  g.applyQuaternion(new THREE.Quaternion().setFromUnitVectors(Y_AXIS, d.normalize()));
  g.translate(a.x, a.y, a.z);
  return g;
}
// beam (box) spanning two points
export function beam(a, b, t = 0.16, d = t) {
  const dir = new V3().subVectors(b, a);
  const L = dir.length();
  const g = new THREE.BoxGeometry(t, L, d);
  g.translate(0, L / 2, 0);
  g.applyQuaternion(new THREE.Quaternion().setFromUnitVectors(Y_AXIS, dir.normalize()));
  g.translate(a.x, a.y, a.z);
  return g;
}

// Accumulates geometry per material key and merges at the end.
export class Builder {
  constructor() {
    this.groups = new Map();
  }
  add(key, geo, o = {}) {
    let g = geo.index ? geo.toNonIndexed() : geo.clone();
    g.clearGroups();
    for (const name of Object.keys(g.attributes)) if (name !== 'position' && name !== 'normal' && name !== 'uv') g.deleteAttribute(name);
    if (!g.attributes.normal) g.computeVertexNormals();
    const n = g.attributes.position.count;
    const mode = o.uv ?? 'world';
    const sc = o.uvScale ?? 0.5;
    const pos = g.attributes.position;
    let extra = null;
    if (o.extraFn) {
      extra = new Float32Array(n);
      for (let i = 0; i < n; i++) extra[i] = o.extraFn(pos.getX(i), pos.getY(i), pos.getZ(i));
    }
    if (mode === 'local') {
      const uv = new Float32Array(n * 2);
      for (let i = 0; i < n; i++) {
        uv[i * 2] = pos.getX(i) * sc;
        uv[i * 2 + 1] = pos.getZ(i) * sc * (o.vFlip ? -1 : 1);
      }
      g.setAttribute('uv', new THREE.BufferAttribute(uv, 2));
    }
    if (o.m) g.applyMatrix4(o.m);
    if (mode === 'world') {
      const nn = g.attributes.normal;
      const uv = new Float32Array(n * 2);
      for (let i = 0; i < n; i++) {
        const ax = Math.abs(nn.getX(i)),
          ay = Math.abs(nn.getY(i)),
          az = Math.abs(nn.getZ(i));
        let u, v;
        if (ay >= ax && ay >= az) {
          u = pos.getX(i);
          v = pos.getZ(i);
        } else if (ax >= az) {
          u = pos.getZ(i);
          v = pos.getY(i);
        } else {
          u = pos.getX(i);
          v = pos.getY(i);
        }
        uv[i * 2] = u * sc;
        uv[i * 2 + 1] = v * sc;
      }
      g.setAttribute('uv', new THREE.BufferAttribute(uv, 2));
    }
    if (!g.attributes.uv) g.setAttribute('uv', new THREE.BufferAttribute(new Float32Array(n * 2), 2));
    const c = new THREE.Color(o.color ?? '#ffffff');
    if (o.tone) c.multiplyScalar(o.tone);
    const col = new Float32Array(n * 3);
    for (let i = 0; i < n; i++) {
      col[i * 3] = c.r;
      col[i * 3 + 1] = c.g;
      col[i * 3 + 2] = c.b;
    }
    g.setAttribute('aCol', new THREE.BufferAttribute(col, 3));
    if (!extra) extra = new Float32Array(n).fill(o.extra ?? 0);
    g.setAttribute('aExtra', new THREE.BufferAttribute(extra, 1));
    if (!this.groups.has(key)) this.groups.set(key, []);
    this.groups.get(key).push(g);
    return this;
  }
  build(mats, parent, { castShadow = true } = {}) {
    const out = [];
    for (const [key, list] of this.groups) {
      const geo = mergeGeometries(list);
      geo.computeBoundingSphere();
      const mesh = new THREE.Mesh(geo, mats[key]);
      mesh.castShadow = castShadow && key !== 'glass' && key !== 'rune';
      mesh.receiveShadow = true;
      parent.add(mesh);
      out.push(mesh);
      for (const g of list) g.dispose();
    }
    this.groups.clear();
    return out;
  }
}

// ---------------------------------------------------------------------------
// Walkable / climbable solids: footprints with a top height. The player's
// ground query takes the max of the terrain and these, so houses, statues and
// windmills can be climbed and stood on with the same code as cliffs.
// ---------------------------------------------------------------------------
export class Solids {
  constructor(cell = 16) {
    this.cell = cell;
    this.map = new Map();
    this.list = [];
  }
  key(i, j) {
    return i * 73856093 + j * 19349663;
  }
  insert(s, r) {
    this.list.push(s);
    const i0 = Math.floor((s.x - r) / this.cell),
      i1 = Math.floor((s.x + r) / this.cell);
    const j0 = Math.floor((s.z - r) / this.cell),
      j1 = Math.floor((s.z + r) / this.cell);
    for (let i = i0; i <= i1; i++)
      for (let j = j0; j <= j1; j++) {
        const k = this.key(i, j);
        if (!this.map.has(k)) this.map.set(k, []);
        this.map.get(k).push(s);
      }
    return s;
  }
  // rotated rectangle; top is a number or fn(lx, lz). A thin solid (bridge
  // deck, pier) only counts for things at or just under its top, so you can
  // pass beneath it.
  addBox(x, z, hw, hd, rot, top, thin = false) {
    return this.insert({ kind: 'box', x, z, hw, hd, cs: Math.cos(rot), sn: Math.sin(rot), top, thin }, Math.hypot(hw, hd));
  }
  // circle; top is a number or fn(dist)
  addCircle(x, z, r, top) {
    return this.insert({ kind: 'circle', x, z, r, top }, r);
  }
  heightAt(x, z, probeY = Infinity) {
    const list = this.map.get(this.key(Math.floor(x / this.cell), Math.floor(z / this.cell)));
    let best = -Infinity;
    if (!list) return best;
    for (const s of list) {
      const dx = x - s.x,
        dz = z - s.z;
      let h;
      if (s.kind === 'box') {
        const lx = dx * s.cs - dz * s.sn,
          lz = dx * s.sn + dz * s.cs;
        if (Math.abs(lx) > s.hw || Math.abs(lz) > s.hd) continue;
        h = typeof s.top === 'function' ? s.top(lx, lz) : s.top;
        if (s.thin && probeY < h - 1.3) continue;
      } else {
        const d2 = dx * dx + dz * dz;
        if (d2 > s.r * s.r) continue;
        h = typeof s.top === 'function' ? s.top(Math.sqrt(d2)) : s.top;
      }
      if (h > best) best = h;
    }
    return best;
  }
  near(x, z, pad) {
    const list = this.map.get(this.key(Math.floor(x / this.cell), Math.floor(z / this.cell)));
    if (!list) return false;
    for (const s of list) {
      const r = (s.kind === 'box' ? Math.hypot(s.hw, s.hd) : s.r) + pad;
      if ((x - s.x) ** 2 + (z - s.z) ** 2 < r * r) return true;
    }
    return false;
  }
}

// Terrain + solids, with the same query API as Terrain.
export class Ground {
  constructor(terrain, solids) {
    this.terrain = terrain;
    this.solids = solids;
    // height of whoever is asking (the player sets it), for thin solids
    this.probeY = Infinity;
  }
  heightAt(x, z) {
    const t = this.terrain.heightAt(x, z);
    const s = this.solids.heightAt(x, z, this.probeY);
    return s > t ? s : t;
  }
  // top of a structure at (x, z), or -Infinity
  solidAt(x, z) {
    const s = this.solids.heightAt(x, z, this.probeY);
    return s > this.terrain.heightAt(x, z) ? s : -Infinity;
  }
  normalAt(x, z, out = new V3()) {
    if (!this.solids.near(x, z, 0.6)) return this.terrain.normalAt(x, z, out);
    const e = 0.35;
    const hl = this.heightAt(x - e, z),
      hr = this.heightAt(x + e, z);
    const hd = this.heightAt(x, z - e),
      hu = this.heightAt(x, z + e);
    return out.set(hl - hr, 2 * e, hd - hu).normalize();
  }
}

// ---------------------------------------------------------------------------
// Static world structures
// ---------------------------------------------------------------------------
const ROOFS = ['#c2553f', '#3f6aa6', '#b8653a', '#4b8a7a', '#9b4038', '#c2553f'];
const ACCENTS = ['#3d7a5a', '#3f6aa6', '#a8473a', '#c9963a', '#5b7fb5', '#7a5a9a'];
const BUNTING = ['#e05a4a', '#f2c14e', '#4fa3d9', '#6cc28a', '#f4f1e6', '#b07ad6'];

export const WAYPOINTS = [
  { id: 'meadow', name: '바람의 초원', x: -14, z: 56 },
  { id: 'statue', name: '수호상의 언덕', x: 0, z: 0, statue: true },
  { id: 'lake', name: '거울 호수', x: 45, z: 82 },
  { id: 'tree', name: '천년나무 언덕', x: -122, z: -22 },
  { id: 'village', name: '풍차 마을', x: -168, z: 170 },
  { id: 'ruins', name: '잊힌 유적', x: -244, z: -84 },
  { id: 'snow', name: '설산 기슭', x: 56, z: -86 },
  { id: 'arena', name: '뇌광의 결전장', x: 334, z: -38 },
  { id: 'gate', name: '바람 그림자 회랑 입구', x: -68, z: -78 },
  { id: 'bridge', name: '바람다리', x: BRIDGE.ax - 17, z: BRIDGE.az + 5 },
  { id: 'highland', name: '단풍 고원', x: 196, z: 252 },
  { id: 'port', name: '단풍 항구', x: portWorld(PORT_LEN - 1, -9)[0], z: portWorld(PORT_LEN - 1, -9)[1] },
];

// Swirling additive portal (domain gate and the realm's exit)
const PORTAL_VERT = /* glsl */ `
varying vec2 vUv;
void main(){ vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }`;
const PORTAL_FRAG = /* glsl */ `
uniform float uTime;
uniform vec3 uA;
uniform vec3 uB;
uniform float uOpen;
varying vec2 vUv;
void main(){
  vec2 p = vUv * 2.0 - 1.0;
  p.y *= 0.8;
  float r = length(p);
  float a = atan(p.y, p.x);
  float swirl = sin(a * 5.0 + r * 9.0 - uTime * 2.4) * 0.5 + 0.5;
  float swirl2 = sin(a * 3.0 - r * 6.0 + uTime * 1.6) * 0.5 + 0.5;
  float edge = smoothstep(1.0, 0.82, r);
  float core = smoothstep(0.75, 0.0, r);
  vec3 col = mix(uA, uB, swirl * 0.7 + swirl2 * 0.3) * (0.55 + core * 0.9) + vec3(1.0) * pow(core, 3.0) * 0.6;
  float alpha = edge * (0.45 + 0.4 * swirl) * uOpen;
  gl_FragColor = vec4(col * alpha, alpha);
}`;

export class Structures {
  constructor(scene, terrain) {
    this.scene = scene;
    this.terrain = terrain;
    this.solids = new Solids();
    this.ground = new Ground(terrain, this.solids);
    this.areas = [];
    this.waypoints = [];
    this.windmills = [];
    this.group = new THREE.Group();
    scene.add(this.group);
    this.time = 0;
    const tex = {
      plaster: plasterTexture(),
      stone: stoneTexture(),
      wood: woodTexture(),
      roof: roofTexture(),
      cobble: cobbleTexture(),
    };
    this.mats = {
      stone: propMat({ map: tex.stone, moss: 0.3, wrap: 0.3 }),
      ruin: propMat({ map: tex.stone, moss: 1.0, wrap: 0.3, ao: 0.45 }),
      marble: propMat({ map: tex.plaster, moss: 0.06, wrap: 0.4, spec: 0.12, ao: 0.6 }),
      plaster: propMat({ map: tex.plaster, wrap: 0.45 }),
      wood: propMat({ map: tex.wood, wrap: 0.35 }),
      roof: propMat({ map: tex.roof, wrap: 0.3, ao: 0.7 }),
      cobble: propMat({ map: tex.cobble, wrap: 0.3, ao: 1, offset: true }),
      plain: propMat({ wrap: 0.4 }),
      metal: propMat({ wrap: 0.2, spec: 0.5 }),
      gold: propMat({ wrap: 0.25, spec: 1.1, ao: 0.7 }),
      cloth: propMat({ wrap: 0.7, side: THREE.DoubleSide, sway: 0.28 }),
      sail: propMat({ wrap: 0.7, side: THREE.DoubleSide }),
      glass: propMat({ wrap: 0.2, spec: 0.6, glow: '#ffc27a', emitDay: 0.0, emitNight: 1.25 }),
      lamp: propMat({ wrap: 0.2, spec: 0.4, glow: '#ffbe6a', emitDay: 0.15, emitNight: 2.6 }),
      rune: propMat({ wrap: 0.2, glow: '#6ff0d2', emitDay: 1.4, emitNight: 2.2 }),
      runeV: propMat({ wrap: 0.2, glow: '#c79bff', emitDay: 1.5, emitNight: 2.4 }),
    };
  }

  build() {
    this.buildStatue();
    this.buildVillage();
    this.buildRuins();
    this.buildArena();
    this.buildDomainGate();
    this.buildRealm();
    buildHighlands(this);
    this.buildWaypoints();
    this.terrain.paintAreas(this.areas);
  }

  area(a) {
    this.areas.push(a);
  }

  frame(x, y, z, rot) {
    return new THREE.Matrix4().compose(new V3(x, y, z), new THREE.Quaternion().setFromAxisAngle(Y_AXIS, rot), new V3(1, 1, 1));
  }

  portal(w, h, a = '#7ff5dc', bb = '#a98bff') {
    const mat = new THREE.ShaderMaterial({
      vertexShader: PORTAL_VERT,
      fragmentShader: PORTAL_FRAG,
      uniforms: { uTime: shared.uTime, uA: { value: new THREE.Color(a) }, uB: { value: new THREE.Color(bb) }, uOpen: { value: 1 } },
      transparent: true,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
      side: THREE.DoubleSide,
    });
    const m = new THREE.Mesh(new THREE.PlaneGeometry(w, h), mat);
    m.renderOrder = 4;
    return m;
  }

  // ------------------------------------------------------------- boss arena
  // A ring of storm-worn pillars on the eastern cliffs with a rune circle in
  // the middle where the storm core sleeps.
  buildArena() {
    const A = LANDMARKS.arena;
    const rand = mulberry32(31337);
    const b = new Builder();
    const y0 = this.terrain.heightAt(A.x, A.z);
    const top = y0 + 0.32;
    const R = 23;
    b.add('stone', cyl(R, R + 0.3, 0.9, 64), { m: M(A.x, top - 0.9, A.z), color: '#c4bca8', uvScale: 0.35 });
    // broken slabs breaking up the floor
    for (let k = 0; k < 90; k++) {
      const a = rand() * TAU,
        r = 7 + Math.sqrt(rand()) * 15;
      const s = 1.2 + rand() * 1.2;
      b.add('ruin', box(s, 0.12, s * (0.7 + rand() * 0.6)), { m: M(A.x + Math.cos(a) * r, top - 0.06 + rand() * 0.05, A.z + Math.sin(a) * r, (rand() - 0.5) * 0.04, rand() * TAU, (rand() - 0.5) * 0.04), color: '#d2cab6', tone: 0.85 + rand() * 0.2, uvScale: 0.5 });
    }
    // gold inlay rings and the violet rune circle
    for (const r of [6.5, 13, 19.5]) {
      const g = new THREE.TorusGeometry(r, 0.07, 4, 96);
      g.rotateX(Math.PI / 2);
      b.add('gold', g, { m: M(A.x, top + 0.02, A.z), color: '#d9b45a' });
    }
    for (const r of [3.2, 5.2]) {
      const g = new THREE.TorusGeometry(r, 0.09, 4, 72);
      g.rotateX(Math.PI / 2);
      b.add('runeV', g, { m: M(A.x, top + 0.04, A.z), color: '#5a3a8a', extra: 1 });
    }
    for (let k = 0; k < 6; k++) {
      const a = (k / 6) * TAU;
      const p0 = new V3(A.x + Math.cos(a) * 5.2, top + 0.04, A.z + Math.sin(a) * 5.2);
      const p1 = new V3(A.x + Math.cos(a + (2 * TAU) / 6) * 5.2, top + 0.04, A.z + Math.sin(a + (2 * TAU) / 6) * 5.2);
      b.add('runeV', beam(p0, p1, 0.1, 0.03), { color: '#5a3a8a', extra: 1, uv: 'keep' });
    }
    // curb
    for (let k = 0; k < 64; k++) {
      const a = (k / 64) * TAU;
      b.add('stone', box(2.3, 0.45, 0.6), { m: M(A.x + Math.cos(a) * (R + 0.25), top - 0.2, A.z + Math.sin(a) * (R + 0.25), 0, -a + Math.PI / 2), color: '#b7af9a', uvScale: 0.5 });
    }
    // pillar ring with lintels
    const pil = [];
    const n = 12;
    for (let k = 0; k < n; k++) {
      const a = (k / n) * TAU + 0.13;
      const x = A.x + Math.cos(a) * (R + 2.4),
        z = A.z + Math.sin(a) * (R + 2.4);
      const gy = this.terrain.heightAt(x, z) - 0.2;
      const broken = k % 4 === 2;
      const h = broken ? 3 + rand() * 2.5 : 9;
      b.add('ruin', box(2.0, 0.8, 2.0), { m: M(x, gy, z, 0, -a), color: '#bdb5a0', uvScale: 0.5 });
      b.add('stone', cyl(0.68, 0.78, h, 14), { m: M(x, gy + 0.8, z), color: '#d8d0bc', uvScale: 0.5 });
      if (!broken) b.add('ruin', box(1.9, 0.6, 1.9), { m: M(x, gy + 0.8 + h, z, 0, -a), color: '#c6bea9', uvScale: 0.5 });
      else b.add('ruin', new THREE.DodecahedronGeometry(0.8, 0), { m: M(x + 1.4, gy + 0.3, z - 0.6, rand(), rand(), rand()), color: '#c6bea9', uvScale: 0.5 });
      this.solids.addCircle(x, z, 1.0, gy + 0.8 + h + (broken ? 0 : 0.6));
      pil.push({ x, z, gy, h, broken, a });
    }
    for (let k = 0; k < n; k++) {
      const p = pil[k],
        q = pil[(k + 1) % n];
      if (p.broken || q.broken || k % 2) continue;
      const y = Math.min(p.gy, q.gy) + 0.8 + 9 + 0.6;
      b.add('ruin', beam(new V3(p.x, y + 0.35, p.z), new V3(q.x, y + 0.35, q.z), 0.7, 1.4), { color: '#cfc7b2', uvScale: 0.5, uv: 'world' });
    }
    // storm obelisks with floating crystals
    this.arenaCrystals = [];
    for (let k = 0; k < 4; k++) {
      const a = (k / 4) * TAU + Math.PI / 4;
      const x = A.x + Math.cos(a) * 17,
        z = A.z + Math.sin(a) * 17;
      b.add('marble', cyl(0.2, 0.9, 5.2, 4), { m: M(x, top, z, 0, a), color: '#e2dccb' });
      b.add('gold', cyl(0.95, 0.95, 0.25, 4), { m: M(x, top + 0.6, z, 0, a), color: '#d9b45a' });
      b.add('runeV', new THREE.OctahedronGeometry(0.55, 0), { m: M(x, top + 6.2, z, 0, a, 0, 1, 1.6, 1), color: '#6a4aa0', extra: 1.4 });
      this.solids.addCircle(x, z, 0.9, top + 5.2);
      this.arenaCrystals.push(new V3(x, top + 6.2, z));
    }
    b.build(this.mats, this.group);
    this.solids.addCircle(A.x, A.z, R + 0.5, top);
    this.terrain.addBlocker(A.x, A.z, R + 6);
    this.area({ x: A.x, z: A.z, r: R + 4, soft: 2.5, grass: 0, color: '#8f8b7c' });
    this.arena = { center: new V3(A.x, top, A.z), r: R, top };
  }

  // --------------------------------------------------------- domain gate
  buildDomainGate() {
    const D = LANDMARKS.domain;
    const b = new Builder();
    const y0 = this.terrain.heightAt(D.x, D.z);
    const rot = Math.atan2(SPAWN.x - D.x, SPAWN.z - D.z);
    const W = this.frame(D.x, y0, D.z, rot);
    const at = (m) => W.clone().multiply(m);
    b.add('marble', cyl(5.2, 5.6, 0.5, 40), { m: at(M(0, -0.1, 0)), color: '#e6e0d0' });
    b.add('marble', cyl(4.6, 4.8, 0.3, 40), { m: at(M(0, 0.4, 0)), color: '#efe9da' });
    for (const r of [2.4, 4.2]) {
      const g = new THREE.TorusGeometry(r, 0.06, 4, 64);
      g.rotateX(Math.PI / 2);
      b.add('rune', g, { m: at(M(0, 0.71, 0)), color: '#2b6e66', extra: 1 });
    }
    for (let s = 0; s < 3; s++) b.add('marble', box(3.2, 0.25 + s * 0.2, 0.7), { m: at(M(0, -0.1, 5.4 + (2 - s) * 0.6)), color: '#ddd6c4' });
    for (const sx of [-1, 1]) {
      b.add('stone', box(1.0, 7.2, 1.0), { m: at(M(sx * 2.9, 0.7, -1.2)), color: '#d2cab6', uvScale: 0.5 });
      b.add('gold', box(1.15, 0.3, 1.15), { m: at(M(sx * 2.9, 0.7, -1.2)), color: '#d9b45a' });
      b.add('gold', box(1.15, 0.3, 1.15), { m: at(M(sx * 2.9, 7.6, -1.2)), color: '#d9b45a' });
    }
    const arch = new THREE.TorusGeometry(2.9, 0.42, 8, 32, Math.PI);
    b.add('stone', arch, { m: at(M(0, 7.7, -1.2)), color: '#d8d0bc', uvScale: 0.5 });
    const archG = new THREE.TorusGeometry(2.9, 0.12, 6, 32, Math.PI);
    b.add('gold', archG, { m: at(M(0, 7.7, -0.75)), color: '#e2bd62' });
    b.add('rune', new THREE.OctahedronGeometry(0.5, 0), { m: at(M(0, 11.1, -1.2, 0, 0, 0, 1, 1.5, 1)), color: '#2b6e66', extra: 1.4 });
    b.build(this.mats, this.group);
    const portal = this.portal(5.0, 7.4);
    portal.position.copy(new V3(0, 4.4, -1.2).applyMatrix4(W));
    portal.rotation.y = rot;
    this.group.add(portal);
    this.solids.addCircle(D.x, D.z, 5.4, y0 + 0.7);
    for (const sx of [-1, 1]) {
      const p = new V3(sx * 2.9, 0, -1.2).applyMatrix4(W);
      this.solids.addCircle(p.x, p.z, 0.75, y0 + 8);
    }
    this.terrain.addBlocker(D.x, D.z, 8);
    this.area({ x: D.x, z: D.z, r: 8, soft: 2, grass: 0.2, color: '#9c9888' });
    this.domainGate = { pos: new V3(D.x, y0 + 0.7, D.z), portal, front: new V3(Math.sin(rot), 0, Math.cos(rot)), rot };
  }

  // ----------------------------------------------------- the floating realm
  buildRealm() {
    const D = DOMAIN_REALM;
    const rand = mulberry32(5150);
    const b = new Builder();
    const y = D.y;
    b.add('marble', cyl(D.r, D.r - 0.4, 1.0, 64), { m: M(D.x, y - 1.0, D.z), color: '#e6e0d2' });
    // rocky underside
    const under = new THREE.ConeGeometry(D.r - 0.3, 26, 24, 6, true);
    under.rotateX(Math.PI);
    const p = under.attributes.position;
    for (let i = 0; i < p.count; i++) {
      const vy = p.getY(i);
      const k = 1 + (Math.sin(i * 12.9898) * 43758.5453 - Math.floor(Math.sin(i * 12.9898) * 43758.5453) - 0.5) * 0.35 * (vy < 12 ? 1 : 0);
      p.setX(i, p.getX(i) * k);
      p.setZ(i, p.getZ(i) * k);
    }
    under.computeVertexNormals();
    b.add('ruin', under, { m: M(D.x, y - 1.0 - 13, D.z), color: '#8c8576', uvScale: 0.2 });
    for (let k = 0; k < 70; k++) {
      const a = rand() * TAU,
        r = 4 + Math.sqrt(rand()) * (D.r - 5);
      const s = 1.4 + rand();
      b.add('marble', box(s, 0.1, s), { m: M(D.x + Math.cos(a) * r, y - 0.04, D.z + Math.sin(a) * r, 0, rand() * TAU), color: '#efe9dc', tone: 0.9 + rand() * 0.15 });
    }
    for (const r of [3.5, 9, 15]) {
      const g = new THREE.TorusGeometry(r, 0.08, 4, 96);
      g.rotateX(Math.PI / 2);
      b.add(r === 9 ? 'rune' : 'gold', g, { m: M(D.x, y + 0.02, D.z), color: r === 9 ? '#2b6e66' : '#d9b45a', extra: 1 });
    }
    // broken colonnade
    for (let k = 0; k < 10; k++) {
      const a = (k / 10) * TAU;
      if (k === 0) continue; // the exit portal side
      const x = D.x + Math.cos(a) * (D.r - 1.6),
        z = D.z + Math.sin(a) * (D.r - 1.6);
      const h = k % 3 === 1 ? 2.5 + rand() * 2 : 6.5;
      b.add('marble', box(1.5, 0.5, 1.5), { m: M(x, y, z, 0, -a), color: '#ddd6c4' });
      b.add('marble', cyl(0.5, 0.58, h, 14), { m: M(x, y + 0.5, z), color: '#f0eadc' });
      if (h > 6) b.add('gold', box(1.4, 0.35, 1.4), { m: M(x, y + 0.5 + h, z, 0, -a), color: '#d9b45a' });
      this.solids.addCircle(x, z, 0.75, y + 0.5 + h);
    }
    // floating islets around it
    for (let k = 0; k < 9; k++) {
      const a = rand() * TAU,
        r = D.r + 8 + rand() * 22;
      const s = 1.5 + rand() * 3.5;
      b.add('ruin', new THREE.DodecahedronGeometry(s, 0), { m: M(D.x + Math.cos(a) * r, y - 6 + rand() * 18, D.z + Math.sin(a) * r, rand(), rand(), rand(), 1, 0.6, 1), color: '#a59e8c', uvScale: 0.3 });
    }
    b.build(this.mats, this.group);
    // exit portal on the open side (local +x)
    const portal = this.portal(3.4, 5.2);
    portal.position.set(D.x + D.r - 2.2, y + 2.7, D.z);
    portal.rotation.y = Math.PI / 2;
    portal.material.uniforms.uOpen.value = 0;
    this.group.add(portal);
    this.solids.addCircle(D.x, D.z, D.r, y);
    this.realm = { center: new V3(D.x, y, D.z), r: D.r, exit: portal, exitPos: new V3(D.x + D.r - 2.6, y, D.z) };
  }

  // ----------------------------------------------------------------- statue
  buildStatue() {
    const S = LANDMARKS.statue;
    const rot = Math.atan2(SPAWN.x - S.x, SPAWN.z - S.z);
    const y0 = this.terrain.heightAt(S.x, S.z) - 0.1;
    const W = this.frame(S.x, y0, S.z, rot);
    const at = (m) => W.clone().multiply(m);
    const b = new Builder();
    const stone = '#d5cebf';
    const gold = '#e2b552';
    // stepped octagonal platform
    const tiers = [8.2, 6.9, 5.6];
    tiers.forEach((r, i) => {
      const yb = i * 0.5 - (i === 0 ? 1.5 : 0);
      const h = 0.5 + (i === 0 ? 1.5 : 0);
      b.add('stone', cyl(r, r + 0.12, h, 8), { m: at(M(0, yb, 0, 0, Math.PI / 8)), color: stone, uvScale: 0.42 });
      b.add('gold', cyl(r + 0.03, r + 0.03, 0.07, 8, true), { m: at(M(0, i * 0.5 + 0.42, 0, 0, Math.PI / 8)), color: gold });
      this.solids.addCircle(S.x, S.z, r, y0 + (i + 1) * 0.5);
    });
    // pedestal
    const py = 1.5;
    b.add('stone', cyl(2.75, 2.85, 0.4, 8), { m: at(M(0, py, 0, 0, Math.PI / 8)), color: stone, uvScale: 0.42 });
    b.add('stone', cyl(2.45, 2.5, 2.7, 8), { m: at(M(0, py + 0.4, 0, 0, Math.PI / 8)), color: '#cbc3b2', uvScale: 0.42 });
    b.add('stone', cyl(2.8, 2.6, 0.35, 8), { m: at(M(0, py + 3.1, 0, 0, Math.PI / 8)), color: stone, uvScale: 0.42 });
    b.add('gold', cyl(2.48, 2.48, 0.1, 8, true), { m: at(M(0, py + 0.5, 0, 0, Math.PI / 8)), color: gold });
    b.add('gold', cyl(2.48, 2.48, 0.1, 8, true), { m: at(M(0, py + 2.95, 0, 0, Math.PI / 8)), color: gold });
    // front emblem
    b.add('gold', new THREE.TorusGeometry(0.62, 0.06, 6, 24), { m: at(M(0, py + 1.75, 2.42)), color: gold });
    b.add('rune', new THREE.OctahedronGeometry(0.5, 0), { m: at(M(0, py + 1.75, 2.38, 0, 0, 0, 0.7, 1, 0.12)), color: '#2b6e66', extra: 1 });
    this.solids.addCircle(S.x, S.z, 2.75, y0 + py + 3.45);

    // figure
    const fy = py + 3.45;
    const robe = new THREE.LatheGeometry(
      [
        [0.01, 0],
        [1.85, 0],
        [1.8, 0.25],
        [1.62, 0.9],
        [1.35, 1.8],
        [1.12, 2.7],
        [0.98, 3.4],
        [0.9, 3.9],
        [1.0, 4.4],
        [1.12, 4.85],
        [1.05, 5.15],
        [0.62, 5.45],
        [0.3, 5.62],
        [0.01, 5.65],
      ].map(([r, y]) => new THREE.Vector2(r, y)),
      48
    );
    {
      const p = robe.attributes.position;
      for (let i = 0; i < p.count; i++) {
        const x = p.getX(i),
          y = p.getY(i),
          z = p.getZ(i);
        const a = Math.atan2(z, x);
        const f = 1 + 0.06 * Math.sin(a * 7 + y * 0.5) * smoothstep(3.9, 0.4, y);
        p.setXYZ(i, x * f, y, z * f * 0.86);
      }
      robe.computeVertexNormals();
    }
    b.add('marble', robe, { m: at(M(0, fy, 0)), color: '#ece6d8', uvScale: 0.6 });
    b.add('gold', new THREE.TorusGeometry(0.93, 0.08, 6, 32), { m: at(M(0, fy + 3.9, 0, Math.PI / 2, 0, 0, 1, 0.86, 1)), color: gold });
    const mantle = new THREE.SphereGeometry(1.15, 32, 12, 0, TAU, 0, Math.PI * 0.42);
    b.add('marble', mantle, { m: at(M(0, fy + 4.75, -0.05, 0, 0, 0, 1.08, 0.75, 0.9)), color: '#e6dfcf' });
    b.add('marble', new THREE.SphereGeometry(0.5, 24, 16), { m: at(M(0, fy + 6.05, 0.05, 0, 0, 0, 0.9, 1.05, 0.95)), color: '#efe9dc' });
    const L = TAU * 0.7;
    const hood = new THREE.SphereGeometry(0.66, 28, 16, -Math.PI / 2 - L / 2, L, 0, Math.PI * 0.64);
    b.add('marble', hood, { m: at(M(0, fy + 6.08, -0.04, -0.12, 0, 0, 1, 1.08, 1)), color: '#e2dbcb' });
    // arms cradling the orb
    for (const s of [-1, 1]) {
      const sh = new V3(0.95 * s, fy + 5.1, 0);
      const el = new V3(0.95 * s, fy + 4.3, 0.5);
      const hd = new V3(0.36 * s, fy + 4.6, 1.05);
      b.add('marble', between(sh, el, 0.28, 0.24, 12), { m: W, color: '#e6dfcf' });
      b.add('marble', between(el, hd, 0.24, 0.34, 12), { m: W, color: '#e6dfcf' });
      b.add('marble', new THREE.SphereGeometry(0.17, 12, 8), { m: W.clone().multiply(M(hd.x * 0.85, hd.y - 0.08, hd.z + 0.08, 0, 0, 0, 1.2, 0.7, 1.3)), color: '#efe9dc' });
    }
    // wings: fanned feathers
    const featherGeo = (len, wid) => {
      const sh = new THREE.Shape();
      sh.moveTo(0, 0);
      sh.quadraticCurveTo(wid, len * 0.45, wid * 0.25, len);
      sh.quadraticCurveTo(-wid * 0.35, len * 0.55, 0, 0);
      const g = new THREE.ExtrudeGeometry(sh, { depth: 0.1, bevelEnabled: true, bevelThickness: 0.03, bevelSize: 0.03, bevelSegments: 1, curveSegments: 8 });
      g.translate(0, 0, -0.05);
      return g;
    };
    // wings: a curved bone with hanging primaries and a row of coverts
    for (const s of [-1, 1]) {
      const bone = new THREE.QuadraticBezierCurve3(new V3(0.5 * s, fy + 4.95, -0.62), new V3(1.9 * s, fy + 6.7, -0.95), new V3(3.5 * s, fy + 7.0, -1.45));
      b.add('marble', new THREE.TubeGeometry(bone, 16, 0.13, 6), { m: W, color: '#e9e2d3' });
      const rows = [
        { n: 10, len0: 1.5, len1: 3.2, wid: 0.5, z: 0, tone: '#efe9dc' },
        { n: 8, len0: 0.8, len1: 1.3, wid: 0.42, z: 0.09, tone: '#f4efe4' },
      ];
      for (const row of rows) {
        for (let k = 0; k < row.n; k++) {
          const t = (k + 0.5) / row.n;
          const p = bone.getPoint(t);
          const len = row.len0 + (row.len1 - row.len0) * Math.pow(t, 1.3);
          const phi = 0.08 + t * 0.95;
          const g = featherGeo(len, row.wid);
          if (s < 0) g.scale(-1, 1, 1);
          const rz = s > 0 ? Math.PI + phi : Math.PI - phi;
          const m = M(p.x, p.y + 0.05, p.z + row.z + 0.02 * k, 0, -s * (0.25 + t * 0.2), rz);
          b.add('marble', g, { m: at(m), color: row.tone });
        }
      }
    }
    b.add('gold', new THREE.TorusGeometry(1.05, 0.055, 8, 56), { m: at(M(0, fy + 6.15, -0.75)), color: gold });
    this.solids.addCircle(S.x, S.z, 1.5, y0 + fy + 5.3);
    this.solids.addCircle(S.x, S.z, 0.55, y0 + fy + 6.6);
    b.build(this.mats, this.group);

    // glowing orb held by the statue
    const orbPos = new V3(0, fy + 4.95, 1.25).applyMatrix4(W);
    const core = new THREE.Mesh(new THREE.IcosahedronGeometry(0.42, 3), new THREE.MeshBasicMaterial({ color: new THREE.Color('#7ff5dc').multiplyScalar(2.2) }));
    core.position.copy(orbPos);
    this.group.add(core);
    this.statue = {
      center: new V3(S.x, y0, S.z),
      orb: core,
      orbPos,
      front: new V3(Math.sin(rot), 0, Math.cos(rot)),
      rot,
      top: y0 + fy + 6.8,
    };
    this.area({ x: S.x, z: S.z, r: 8.6, soft: 1.5, grass: 0, color: '#a49a83' });
    this.terrain.addBlocker(S.x, S.z, 10);
  }

  // -------------------------------------------------------------- waypoints
  buildWaypoints() {
    const b = new Builder();
    const S = this.statue;
    for (const def of WAYPOINTS) {
      let { x, z } = def;
      if (def.statue) {
        // to the side of the statue, facing the path
        const side = new V3(S.front.z, 0, -S.front.x);
        x = S.center.x + S.front.x * 9.5 + side.x * 7;
        z = S.center.z + S.front.z * 9.5 + side.z * 7;
      }
      const y = this.terrain.heightAt(x, z) - 0.05;
      const W = this.frame(x, y, z, 0);
      const at = (m) => W.clone().multiply(m);
      b.add('stone', cyl(1.6, 1.8, 1.6, 6), { m: at(M(0, -1.05, 0)), color: '#d2cab8', uvScale: 0.42 });
      b.add('gold', cyl(1.62, 1.62, 0.08, 6, true), { m: at(M(0, 0.44, 0)), color: '#e2b552' });
      b.add('stone', cyl(1.15, 1.25, 0.18, 6), { m: at(M(0, 0.55, 0, 0, Math.PI / 6)), color: '#bfb7a5', uvScale: 0.42 });
      b.add('stone', cyl(0.3, 0.48, 2.3, 6), { m: at(M(0, 0.7, 0)), color: '#c8c0ae', uvScale: 0.5 });
      b.add('gold', cyl(0.52, 0.55, 0.14, 6), { m: at(M(0, 0.7, 0)), color: '#e2b552' });
      b.add('gold', cyl(0.38, 0.32, 0.2, 6), { m: at(M(0, 2.95, 0)), color: '#e2b552' });
      for (let k = 0; k < 3; k++) {
        const a = (k / 3) * TAU;
        const pts = [
          [0.3, 3.05],
          [0.66, 3.45],
          [0.6, 3.95],
          [0.26, 4.35],
        ].map(([r, yy]) => new V3(Math.cos(a) * r, yy, Math.sin(a) * r));
        b.add('gold', new THREE.TubeGeometry(new THREE.CatmullRomCurve3(pts), 14, 0.05, 5), { m: W, color: '#e2b552' });
      }
      // per-waypoint parts that change when activated
      const runeMat = new THREE.MeshBasicMaterial({ color: new THREE.Color('#33424c') });
      const parts = [];
      for (let k = 0; k < 6; k++) {
        const a = (k / 6) * TAU;
        const g = new THREE.BoxGeometry(0.07, 1.5, 0.04);
        const m = new THREE.Matrix4().compose(new V3(Math.cos(a) * 0.35, 1.85, Math.sin(a) * 0.35), new THREE.Quaternion().setFromEuler(new THREE.Euler(-0.068, Math.PI / 2 - a, 0, 'YXZ')), new V3(1, 1, 1));
        parts.push(g.applyMatrix4(m).toNonIndexed());
      }
      const ringGeo = new THREE.RingGeometry(1.3, 1.48, 6, 1).rotateX(-Math.PI / 2).translate(0, 0.565, 0);
      parts.push(ringGeo.toNonIndexed());
      for (const g of parts) for (const k of Object.keys(g.attributes)) if (k !== 'position') g.deleteAttribute(k);
      const runes = new THREE.Mesh(mergeGeometries(parts), runeMat);
      runes.position.set(x, y, z);
      this.group.add(runes);
      const crystal = new THREE.Mesh(new THREE.OctahedronGeometry(1, 0), toonMaterial({ color: '#8394a8', rim: 0.6, spec: 0.8, unique: true }));
      crystal.scale.set(0.3, 0.6, 0.3);
      crystal.position.set(x, y + 3.7, z);
      crystal.castShadow = true;
      this.group.add(crystal);
      this.solids.addCircle(x, z, 1.8, y + 0.55);
      this.solids.addCircle(x, z, 1.25, y + 0.73);
      this.solids.addCircle(x, z, 0.5, y + 3.15);
      this.waypoints.push({ ...def, x, z, y, pos: new V3(x, y, z), crystal, runeMat, active: false, spin: Math.random() * TAU });
      this.area({ x, z, r: 2.2, soft: 1, grass: 0, color: '#a39a86' });
      this.terrain.addBlocker(x, z, 3.5);
    }
    b.build(this.mats, this.group);
  }

  // --------------------------------------------------------------- village
  buildVillage() {
    const V = LANDMARKS.village;
    const rand = mulberry32(404);
    const b = new Builder();
    const vy = this.terrain.heightAt(V.x, V.z);
    this.villageCenter = new V3(V.x, vy, V.z);
    this.area({ x: V.x, z: V.z, r: 34, soft: 12, grass: 0.7 });
    this.terrain.addBlocker(V.x, V.z, 38);

    // houses around the plaza (path enters from the east, around -36 deg)
    const houses = [
      { a: 20, d: 21, w: 8, dd: 6, floors: 2 },
      { a: 72, d: 20, w: 7, dd: 5.5, floors: 1 },
      { a: 124, d: 22, w: 9, dd: 6.5, floors: 2 },
      { a: 178, d: 20, w: 7.5, dd: 5.5, floors: 1 },
      { a: 232, d: 21, w: 8, dd: 6, floors: 2 },
      { a: 286, d: 20.5, w: 6.5, dd: 5, floors: 1 },
    ];
    this.houses = [];
    houses.forEach((h, i) => {
      const a = (h.a * Math.PI) / 180;
      const x = V.x + Math.cos(a) * h.d,
        z = V.z + Math.sin(a) * h.d;
      const rot = Math.atan2(V.x - x, V.z - z) + (rand() - 0.5) * 0.15;
      this.buildHouse(b, { x, z, rot, w: h.w, d: h.dd, floors: h.floors, roof: ROOFS[i % ROOFS.length], accent: ACCENTS[i % ACCENTS.length], rand });
    });
    // barn on the outskirts
    {
      const a = (32 * Math.PI) / 180;
      const x = V.x + Math.cos(a) * 41,
        z = V.z + Math.sin(a) * 41;
      this.buildHouse(b, { x, z, rot: Math.atan2(V.x - x, V.z - z), w: 10, d: 7, floors: 1, floorH: 4.2, barn: true, roof: '#7d4a36', accent: '#8a3e30', rand });
      this.barn = { x, z };
      for (let k = 0; k < 5; k++) {
        const hx = x + (rand() - 0.5) * 9,
          hz = z + 6 + rand() * 3;
        const hy = this.terrain.heightAt(hx, hz);
        b.add('plain', new THREE.CylinderGeometry(0.6, 0.6, 1.1, 14), { m: M(hx, hy + 0.55, hz, 0, rand() * 3, Math.PI / 2), color: '#d9b45a' });
      }
    }
    // windmills
    const mills = [
      { a: 150, d: 40, roof: '#9b4038' },
      { a: 262, d: 38, roof: '#3f6aa6' },
    ];
    for (const m of mills) {
      const a = (m.a * Math.PI) / 180;
      const x = V.x + Math.cos(a) * m.d,
        z = V.z + Math.sin(a) * m.d;
      this.buildWindmill(b, { x, z, rot: Math.atan2(V.x - x, V.z - z) + 0.6, roof: m.roof });
    }

    // plaza: cobble disc draped on the terrain + curb
    {
      const R = 9.5,
        rings = 10,
        segs = 56;
      const pos = [],
        idx = [];
      for (let r = 0; r <= rings; r++)
        for (let s = 0; s <= segs; s++) {
          const rr = (r / rings) * R,
            a = (s / segs) * TAU;
          const x = V.x + Math.cos(a) * rr,
            z = V.z + Math.sin(a) * rr;
          pos.push(x, this.terrain.heightAt(x, z) + 0.05, z);
        }
      for (let r = 0; r < rings; r++)
        for (let s = 0; s < segs; s++) {
          const a0 = r * (segs + 1) + s,
            a1 = a0 + 1,
            b0 = a0 + segs + 1,
            b1 = b0 + 1;
          idx.push(a0, a1, b0, a1, b1, b0);
        }
      const g = new THREE.BufferGeometry();
      g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
      g.setIndex(idx);
      g.computeVertexNormals();
      const nn = g.attributes.normal;
      for (let i = 0; i < nn.count; i++) if (nn.getY(i) < 0) nn.setXYZ(i, -nn.getX(i), -nn.getY(i), -nn.getZ(i));
      const pb = new Builder();
      pb.add('cobble', g, { color: '#e2dccf', uvScale: 1 / 3 });
      pb.build(this.mats, this.group, { castShadow: false });
      for (let s = 0; s < 40; s++) {
        const a = (s / 40) * TAU;
        const x = V.x + Math.cos(a) * (R + 0.15),
          z = V.z + Math.sin(a) * (R + 0.15);
        b.add('stone', box(0.4, 0.5, 1.6), { m: M(x, this.terrain.heightAt(x, z) - 0.3, z, 0, -a, 0), color: '#c9c0ad', uvScale: 0.6 });
      }
      this.area({ x: V.x, z: V.z, r: R + 0.6, soft: 1.2, grass: 0, color: '#9d9483' });
    }

    // well at the centre
    {
      const y = vy;
      const W = this.frame(V.x, y, V.z, 0.3);
      const at = (m) => W.clone().multiply(m);
      b.add('stone', cyl(1.25, 1.35, 1.0, 16), { m: at(M(0, -0.2, 0)), color: '#cfc6b3', uvScale: 0.7 });
      b.add('plain', new THREE.CircleGeometry(1.0, 20), { m: at(M(0, 0.75, 0, -Math.PI / 2)), color: '#1d3a4d' });
      for (const s of [-1, 1]) b.add('wood', box(0.18, 2.6, 0.18), { m: at(M(1.15 * s, 0.6, 0)), color: '#6b4630' });
      b.add('wood', box(2.6, 0.16, 0.16), { m: at(M(0, 2.55, 0)), color: '#6b4630' });
      for (const s of [-1, 1]) b.add('roof', new THREE.BoxGeometry(2.9, 0.1, 1.25), { m: at(M(0, 3.0, s * 0.5, s * 0.62, 0, 0)), color: '#c2553f', uv: 'local', uvScale: 0.66, vFlip: s < 0 });
      b.add('wood', box(0.36, 0.4, 0.36), { m: at(M(0, 1.6, 0)), color: '#8a5a36' });
      this.solids.addCircle(V.x, V.z, 1.35, y + 0.8);
    }

    // lamp posts + bunting to the well roof
    const lampTops = [];
    for (let k = 0; k < 4; k++) {
      const a = ((45 + k * 90) * Math.PI) / 180;
      const x = V.x + Math.cos(a) * 10.6,
        z = V.z + Math.sin(a) * 10.6;
      lampTops.push(this.buildLamp(b, x, z, a + Math.PI));
    }
    for (const [x, z] of [
      [V.x + 26, V.z - 17],
      [V.x + 15, V.z - 10.5],
      [V.x - 2, V.z + 31],
    ])
      this.buildLamp(b, x, z, rand() * TAU);
    const wellTop = new V3(V.x, vy + 3.4, V.z);
    for (const t of lampTops) this.buildBunting(b, t, wellTop, rand);
    for (let k = 0; k < 4; k++) this.buildBunting(b, lampTops[k], lampTops[(k + 1) % 4], rand, 1.1);

    // market stall and props
    this.buildStall(b, V.x - 6.5, V.z - 4.5, 0.9, rand);
    this.buildStall(b, V.x + 4.5, V.z + 7, -2.4, rand);
    for (let k = 0; k < 18; k++) {
      const a = rand() * TAU,
        d = 12 + rand() * 18;
      const x = V.x + Math.cos(a) * d,
        z = V.z + Math.sin(a) * d;
      if (this.solids.near(x, z, 1.2)) continue;
      const y = this.terrain.heightAt(x, z);
      if (rand() < 0.5) {
        b.add('wood', new THREE.CylinderGeometry(0.42, 0.36, 1.0, 12), { m: M(x, y + 0.5, z), color: '#9a6a42' });
        b.add('metal', new THREE.CylinderGeometry(0.43, 0.43, 0.08, 12, 1, true), { m: M(x, y + 0.25, z), color: '#4a4a52' });
        b.add('metal', new THREE.CylinderGeometry(0.43, 0.43, 0.08, 12, 1, true), { m: M(x, y + 0.75, z), color: '#4a4a52' });
        this.solids.addCircle(x, z, 0.45, y + 1.0);
      } else {
        const s = 0.7 + rand() * 0.3;
        b.add('wood', box(s, s, s), { m: M(x, y - 0.02, z, 0, rand() * 3), color: '#b08452' });
        this.solids.addCircle(x, z, s * 0.55, y + s);
      }
    }

    // fenced field near the barn
    {
      const a = (60 * Math.PI) / 180;
      const fx = V.x + Math.cos(a) * 44,
        fz = V.z + Math.sin(a) * 44;
      this.buildFence(b, fx, fz, 9, 6, 0.4);
      this.area({ x: fx, z: fz, hw: 8.5, hd: 5.5, rot: 0.4, soft: 1, grass: 1.0, color: '#7fa64a', amount: 0.4 });
    }
    b.build(this.mats, this.group);
  }

  buildHouse(b, h) {
    const { w, d, floors, rand } = h;
    const corners = [
      [-w / 2, -d / 2],
      [w / 2, -d / 2],
      [-w / 2, d / 2],
      [w / 2, d / 2],
    ];
    const cs = Math.cos(h.rot),
      sn = Math.sin(h.rot);
    let y = 1e9;
    for (const [lx, lz] of corners) y = Math.min(y, this.terrain.heightAt(h.x + lx * cs + lz * sn, h.z - lx * sn + lz * cs));
    y -= 0.05;
    const W = this.frame(h.x, y, h.z, h.rot);
    const at = (m) => W.clone().multiply(m);
    const timber = h.barn ? '#5a3624' : '#5a3e2b';
    const found = 0.6;
    b.add('stone', box(w + 0.4, found + 1.5, d + 0.4), { m: at(M(0, -1.5, 0)), color: '#c4bba8', uvScale: 0.42 });
    const floorH = h.floorH ?? 3.0;
    let yy = found;
    for (let f = 0; f < floors; f++) {
      const ow = f > 0 ? 0.25 : 0;
      const fw = w + ow * 2,
        fd = d + ow * 2;
      const isStone = floors > 1 && f === 0;
      const key = h.barn ? 'wood' : isStone ? 'stone' : 'plaster';
      b.add(key, box(fw, floorH, fd), { m: at(M(0, yy, 0)), color: h.barn ? '#a0583c' : isStone ? '#d8cfbd' : '#f4eedf', uvScale: key === 'wood' ? 0.8 : 0.42 });
      if (!isStone && !h.barn) this.timberFrame(b, at, fw, fd, yy, floorH, timber);
      if (h.barn) {
        for (const s of [-1, 1]) b.add('wood', box(0.22, floorH, 0.22), { m: at(M((s * fw) / 2, yy, fd / 2)), color: timber });
      }
      // windows on each wall
      const walls = [
        { face: 0, len: fw },
        { face: 1, len: fw },
        { face: 2, len: fd },
        { face: 3, len: fd },
      ];
      for (const wl of walls) {
        const n = wl.face < 2 ? Math.max(1, Math.floor(wl.len / 2.6)) : 1;
        for (let k = 0; k < n; k++) {
          const u = n === 1 ? 0 : -wl.len / 2 + ((k + 0.5) * wl.len) / n;
          if (f === 0 && wl.face === 0 && Math.abs(u) < 1.3) continue; // door
          if (h.barn && wl.face === 0) continue;
          this.window(b, at, this.wallFrame(wl.face, fw, fd, u, yy + floorH * 0.55), h, f === floors - 1 && wl.face < 2);
        }
      }
      yy += floorH;
      if (f < floors - 1) b.add('wood', box(fw + 0.62, 0.24, fd + 0.62), { m: at(M(0, yy - 0.1, 0)), color: timber });
    }
    const wallTop = yy;
    const dd = d + (floors > 1 ? 0.5 : 0);
    const ww = w + (floors > 1 ? 0.5 : 0);
    // door
    {
      const dw = h.barn ? 2.6 : 1.25,
        dh = h.barn ? 3.2 : 2.15;
      const Fm = this.wallFrame(0, w, d, 0, found);
      b.add('wood', box(dw + 0.3, dh + 0.18, 0.16), { m: at(Fm.clone().multiply(M(0, 0, 0.02))), color: timber });
      b.add('wood', box(dw, dh, 0.14), { m: at(Fm.clone().multiply(M(0, 0, 0.07))), color: h.barn ? '#8a4a32' : '#7a5234' });
      b.add('metal', new THREE.SphereGeometry(0.06, 8, 6), { m: at(Fm.clone().multiply(M(dw * 0.32, dh * 0.48, 0.16))), color: '#c9a050' });
      b.add('stone', box(dw + 0.6, found, 0.8), { m: at(M(0, 0, d / 2 + 0.45)), color: '#c4bba8', uvScale: 0.5 });
      if (!h.barn) {
        // small lantern by the door
        const lm = at(Fm.clone().multiply(M(dw * 0.5 + 0.45, dh * 0.85, 0.22)));
        b.add('metal', box(0.24, 0.05, 0.24), { m: lm.clone().multiply(M(0, 0.36, 0)), color: '#3b3a3f' });
        b.add('lamp', box(0.2, 0.3, 0.2), { m: lm.clone().multiply(M(0, 0.05, 0)), color: '#fff1d0', extra: 1 });
      }
    }
    // roof: two slabs along local x, ridge height roofH above the wall top
    const ov = 0.55;
    const roofH = h.barn ? dd * 0.48 : dd * 0.58;
    const lift = 0.12;
    const ang = Math.atan2(roofH - lift, dd / 2);
    const hd = dd / 2 + ov;
    const slabLen = hd / Math.cos(ang);
    const rw = ww + ov * 2;
    for (const s of [-1, 1]) {
      const cz = (s * hd) / 2;
      const cy = wallTop + roofH - (hd / 2) * Math.tan(ang);
      b.add('roof', new THREE.BoxGeometry(rw, 0.2, slabLen), { m: at(M(0, cy, cz, s * ang, 0, 0)), color: h.roof, uv: 'local', uvScale: 1 / 1.5, vFlip: s < 0 });
      b.add('wood', new THREE.BoxGeometry(rw + 0.02, 0.26, 0.16), { m: at(M(0, wallTop + roofH - hd * Math.tan(ang) - 0.02, s * (hd - 0.05), s * ang, 0, 0)), color: timber });
    }
    b.add('wood', new THREE.BoxGeometry(rw + 0.1, 0.24, 0.32), { m: at(M(0, wallTop + roofH + 0.06, 0)), color: timber });
    // gables
    const tri = new THREE.Shape();
    tri.moveTo(-dd / 2, 0);
    tri.lineTo(dd / 2, 0);
    tri.lineTo(0, roofH - 0.05);
    tri.closePath();
    const gable = new THREE.ExtrudeGeometry(tri, { depth: ww, bevelEnabled: false });
    gable.translate(0, 0, -ww / 2);
    gable.rotateY(Math.PI / 2);
    b.add(h.barn ? 'wood' : 'plaster', gable, { m: at(M(0, wallTop, 0)), color: h.barn ? '#a0583c' : '#f4eedf', uvScale: 0.42 });
    if (!h.barn) {
      for (const s of [-1, 1]) {
        const gx = (s * ww) / 2 + s * 0.03;
        b.add('wood', box(0.16, roofH - 0.1, 0.14), { m: at(M(gx, wallTop, 0, 0, Math.PI / 2)), color: timber });
        b.add('wood', beam(new V3(gx, wallTop + 0.1, -dd / 2 + 0.2), new V3(gx, wallTop + roofH * 0.6, 0), 0.12, 0.14), { m: W, color: timber });
        b.add('wood', beam(new V3(gx, wallTop + 0.1, dd / 2 - 0.2), new V3(gx, wallTop + roofH * 0.6, 0), 0.12, 0.14), { m: W, color: timber });
        // round attic window
        b.add('glass', new THREE.CircleGeometry(0.32, 16), { m: at(M(gx + s * 0.02, wallTop + roofH * 0.38, 0, 0, (s * Math.PI) / 2)), color: '#2d4157', extra: 1 });
      }
    }
    // chimney
    if (!h.barn) {
      const cx = ww * 0.28 * (rand() < 0.5 ? -1 : 1),
        czz = -dd * 0.18;
      const ry = wallTop + roofH * (1 - Math.abs(czz) / (dd / 2));
      b.add('stone', box(0.7, 2.0, 0.7), { m: at(M(cx, ry - 0.9, czz)), color: '#bdb3a0', uvScale: 0.6 });
      b.add('stone', box(0.86, 0.18, 0.86), { m: at(M(cx, ry + 1.1, czz)), color: '#a89e8b' });
    }
    // collision: footprint with a gable top
    this.solids.addBox(h.x, h.z, w / 2 + 0.2, d / 2 + 0.2, h.rot, (lx, lz) => y + wallTop + lift + Math.max(0, (roofH - lift) * (1 - Math.abs(lz) / (dd / 2))));
    this.area({ x: h.x, z: h.z, hw: w / 2 + 1.2, hd: d / 2 + 1.2, rot: h.rot, soft: 1.5, grass: 0, color: '#a08c68' });
    this.houses.push({ x: h.x, z: h.z, y, rot: h.rot, top: y + wallTop + roofH, w, d });
  }

  // wall-local frame: x along the wall, y up, z out of the wall
  wallFrame(face, w, d, u, y) {
    if (face === 0) return M(u, y, d / 2, 0, 0, 0);
    if (face === 1) return M(-u, y, -d / 2, 0, Math.PI, 0);
    if (face === 2) return M(w / 2, y, -u, 0, Math.PI / 2, 0);
    return M(-w / 2, y, u, 0, -Math.PI / 2, 0);
  }

  timberFrame(b, at, w, d, y0, h, color) {
    const t = 0.17;
    for (let face = 0; face < 4; face++) {
      const len = face < 2 ? w : d;
      const F = (u, yy) => at(this.wallFrame(face, w, d, u, yy));
      // sill and plate
      b.add('wood', box(len + t, t, 0.1), { m: F(0, y0).multiply(M(0, 0, 0.03)), color });
      b.add('wood', box(len + t, t, 0.1), { m: F(0, y0 + h - t).multiply(M(0, 0, 0.03)), color });
      const n = Math.max(2, Math.round(len / 1.9));
      for (let k = 0; k <= n; k++) {
        const u = -len / 2 + (k * len) / n;
        b.add('wood', box(t, h, 0.1), { m: F(u, y0).multiply(M(0, 0, 0.035)), color });
      }
      // diagonal braces in the end panels
      const pw = len / n;
      for (const s of [-1, 1]) {
        const u0 = (s * len) / 2,
          u1 = s * (len / 2 - pw);
        const a = new V3(u0 - s * 0.05, 0.12, 0.04),
          c = new V3(u1 + s * 0.05, h * 0.62, 0.04);
        b.add('wood', beam(a, c, 0.13, 0.08), { m: F(0, y0), color });
      }
    }
  }

  window(b, at, Fm, h, flowers) {
    const ww = 0.95,
      wh = 1.15;
    const m = (x, y, z, sx = 1, sy = 1, sz = 1) => at(Fm.clone().multiply(M(x, y - wh / 2, z, 0, 0, 0, sx, sy, sz)));
    b.add('wood', box(ww + 0.22, wh + 0.22, 0.12), { m: m(0, -0.11, 0.04), color: '#5a3e2b' });
    b.add('glass', box(ww, wh, 0.08), { m: m(0, 0, 0.08), color: '#2d4157', extra: 1 });
    b.add('wood', box(ww, 0.07, 0.06), { m: m(0, wh / 2 - 0.03, 0.13), color: '#e8dcc4' });
    b.add('wood', box(0.07, wh, 0.06), { m: m(0, 0, 0.13), color: '#e8dcc4' });
    for (const s of [-1, 1]) b.add('wood', box(0.48, wh + 0.1, 0.07), { m: m(s * (ww / 2 + 0.36), -0.05, 0.08), color: h.accent });
    b.add('wood', box(ww + 0.35, 0.09, 0.3), { m: m(0, -0.2, 0.14), color: '#d9cdb3' });
    if (flowers) {
      b.add('wood', box(ww + 0.1, 0.24, 0.3), { m: m(0, -0.45, 0.24), color: '#7a5234' });
      const cols = ['#e8506a', '#f2a03d', '#f7e04f', '#d86ad1', '#ffffff'];
      for (let k = 0; k < 6; k++) {
        const fx = -ww / 2 + 0.1 + (k / 5) * (ww - 0.2);
        b.add('plain', new THREE.IcosahedronGeometry(0.1, 0), { m: m(fx, -0.17 + (k % 2) * 0.05, 0.27), color: '#4f8a3a' });
        b.add('plain', new THREE.IcosahedronGeometry(0.075, 0), { m: m(fx + 0.03, -0.1 + (k % 2) * 0.06, 0.33), color: cols[(k + Math.floor(h.x)) % cols.length] });
      }
    }
  }

  buildLamp(b, x, z, rot) {
    const y = this.terrain.heightAt(x, z);
    const W = this.frame(x, y, z, rot);
    const at = (m) => W.clone().multiply(m);
    b.add('stone', cyl(0.24, 0.3, 0.35, 8), { m: at(M(0, -0.1, 0)), color: '#bdb5a3' });
    b.add('metal', cyl(0.055, 0.075, 3.3, 8), { m: at(M(0, 0.2, 0)), color: '#34343b' });
    b.add('metal', box(0.07, 0.07, 0.7), { m: at(M(0, 3.25, 0.3)), color: '#34343b' });
    b.add('metal', new THREE.SphereGeometry(0.1, 8, 6), { m: at(M(0, 3.52, 0)), color: '#34343b' });
    const lm = at(M(0, 2.78, 0.6));
    b.add('metal', box(0.36, 0.05, 0.36), { m: lm.clone().multiply(M(0, 0.0, 0)), color: '#34343b' });
    b.add('lamp', box(0.28, 0.4, 0.28), { m: lm.clone().multiply(M(0, 0.05, 0)), color: '#fff1d0', extra: 1 });
    b.add('metal', new THREE.ConeGeometry(0.3, 0.26, 4), { m: lm.clone().multiply(M(0, 0.58, 0, 0, Math.PI / 4)), color: '#34343b' });
    this.solids.addCircle(x, z, 0.3, y + 0.25);
    return new V3(x, y + 3.3, z);
  }

  buildBunting(b, A, B, rand, sag = 0.7) {
    const L = A.distanceTo(B);
    const n = Math.max(2, Math.floor(L / 0.55));
    const pts = [];
    for (let i = 0; i <= n; i++) {
      const t = i / n;
      const p = new V3().lerpVectors(A, B, t);
      p.y -= Math.sin(t * Math.PI) * sag;
      pts.push(p);
    }
    for (let i = 0; i < n; i++) b.add('plain', beam(pts[i], pts[i + 1], 0.025, 0.025), { color: '#4a3a2a' });
    const off = Math.floor(rand() * BUNTING.length);
    for (let i = 1; i < n; i++) {
      const p = pts[i];
      const dir = new V3().subVectors(pts[i + 1], pts[i - 1]).normalize();
      const tri = new THREE.BufferGeometry();
      tri.setAttribute('position', new THREE.Float32BufferAttribute([-0.19, 0, 0, 0.19, 0, 0, 0, -0.44, 0], 3));
      tri.computeVertexNormals();
      const m = new THREE.Matrix4().makeBasis(dir, Y_AXIS.clone(), new V3().crossVectors(dir, Y_AXIS).normalize());
      m.setPosition(p);
      b.add('cloth', tri, { m, color: BUNTING[(i + off) % BUNTING.length], extraFn: (x, y) => Math.min(1, -y / 0.44) });
    }
  }

  buildStall(b, x, z, rot, rand) {
    const y = this.terrain.heightAt(x, z);
    const W = this.frame(x, y, z, rot);
    const at = (m) => W.clone().multiply(m);
    const w = 2.8,
      d = 1.6;
    for (const sx of [-1, 1])
      for (const sz of [-1, 1]) b.add('wood', box(0.12, sz > 0 ? 2.2 : 2.6, 0.12), { m: at(M((sx * w) / 2, 0, (sz * d) / 2)), color: '#6b4630' });
    b.add('wood', box(w, 0.9, 0.7), { m: at(M(0, 0, d / 2 - 0.35)), color: '#9a6a42' });
    // striped awning
    const stripes = 7;
    for (let k = 0; k < stripes; k++) {
      const sw = (w + 0.4) / stripes;
      const g = new THREE.PlaneGeometry(sw, d + 0.6, 1, 2);
      g.rotateX(-Math.PI / 2 + 0.24);
      b.add('cloth', g, {
        m: at(M(-w / 2 - 0.2 + sw * (k + 0.5), 2.45, 0)),
        color: k % 2 ? '#f4efe2' : rand() < 0.5 ? '#d9543f' : '#3f7ab8',
        extraFn: (xx, yy, zz) => Math.max(0, zz / (d + 0.6) + 0.5) * 0.25,
      });
    }
    const fruits = ['#e8463a', '#f2a03d', '#9ccf4a', '#f7e04f', '#b05ad6'];
    for (let k = 0; k < 14; k++) {
      b.add('plain', new THREE.IcosahedronGeometry(0.11, 1), { m: at(M(-1.1 + (k % 7) * 0.36, 0.98 + Math.floor(k / 7) * 0.05, d / 2 - 0.5 + Math.floor(k / 7) * 0.28)), color: fruits[(k + Math.floor(rand() * 3)) % fruits.length] });
    }
    b.add('wood', box(0.6, 0.45, 0.45), { m: at(M(-w / 2 - 0.6, 0, 0.3, 0, 0.3)), color: '#b08452' });
    this.solids.addBox(x, z, w / 2 + 0.1, 0.4, rot, y + 0.9);
  }

  buildFence(b, cx, cz, hw, hd, rot) {
    const cs = Math.cos(rot),
      sn = Math.sin(rot);
    const P = (lx, lz) => {
      const x = cx + lx * cs + lz * sn,
        z = cz - lx * sn + lz * cs;
      return new V3(x, this.terrain.heightAt(x, z), z);
    };
    const corners = [
      [-hw, -hd],
      [hw, -hd],
      [hw, hd],
      [-hw, hd],
    ];
    for (let s = 0; s < 4; s++) {
      const [ax, az] = corners[s],
        [bx, bz] = corners[(s + 1) % 4];
      const L = Math.hypot(bx - ax, bz - az);
      const n = Math.ceil(L / 2.2);
      let prev = null;
      for (let k = 0; k <= n; k++) {
        const t = k / n;
        if (s === 0 && k > n * 0.4 && k < n * 0.6) {
          prev = null;
          continue; // gate gap
        }
        const p = P(lerp(ax, bx, t), lerp(az, bz, t));
        b.add('wood', box(0.13, 1.05, 0.13), { m: M(p.x, p.y - 0.1, p.z, 0, rot), color: '#7a5636' });
        if (prev) {
          for (const hy of [0.4, 0.78]) b.add('wood', beam(new V3(prev.x, prev.y + hy, prev.z), new V3(p.x, p.y + hy, p.z), 0.07, 0.11), { color: '#8a6440' });
        }
        prev = p;
      }
    }
  }

  buildWindmill(b, wm) {
    const y = this.terrain.heightAt(wm.x, wm.z) - 0.1;
    const W = this.frame(wm.x, y, wm.z, wm.rot);
    const at = (m) => W.clone().multiply(m);
    const timber = '#5a3e2b';
    b.add('stone', cyl(3.15, 3.3, 3.2, 14), { m: at(M(0, -1.6, 0)), color: '#c9c0ad', uvScale: 0.42 });
    const H = 10.2,
      r0 = 2.95,
      r1 = 2.7;
    b.add('plaster', cyl(r1, r0, H, 16), { m: at(M(0, 1.6, 0)), color: '#f2ecdd', uvScale: 0.42 });
    for (const [hy, r] of [
      [1.6, r0],
      [5.0, lerp(r0, r1, 3.4 / H)],
      [8.4, lerp(r0, r1, 6.8 / H)],
      [11.6, r1],
    ])
      b.add('wood', cyl(r + 0.06, r + 0.06, 0.24, 16, true), { m: at(M(0, hy, 0)), color: timber });
    for (let k = 0; k < 8; k++) {
      const a = (k / 8) * TAU;
      b.add('wood', beam(new V3(Math.sin(a) * (r0 + 0.04), 1.6, Math.cos(a) * (r0 + 0.04)), new V3(Math.sin(a) * (r1 + 0.04), 11.7, Math.cos(a) * (r1 + 0.04)), 0.14, 0.08), { m: W, color: timber });
    }
    // windows
    for (const [a, hy] of [
      [0.9, 6.6],
      [-2.2, 9.6],
      [2.6, 4.0],
    ]) {
      const r = lerp(r0, r1, (hy - 1.6) / H) + 0.02;
      const F = M(Math.sin(a) * r, hy, Math.cos(a) * r, 0, a, 0);
      b.add('wood', box(0.9, 1.1, 0.12), { m: at(F.clone().multiply(M(0, -0.55, 0))), color: timber });
      b.add('glass', box(0.7, 0.9, 0.1), { m: at(F.clone().multiply(M(0, -0.45, 0.04))), color: '#2d4157', extra: 1 });
    }
    // door
    b.add('wood', box(1.5, 2.3, 0.2), { m: at(M(0, 1.6, r0 - 0.04)), color: timber });
    b.add('wood', box(1.2, 2.1, 0.2), { m: at(M(0, 1.6, r0 + 0.02)), color: '#7a5234' });
    // cap
    b.add('roof', new THREE.ConeGeometry(3.45, 3.8, 16, 1, true), { m: at(M(0, 11.7 + 1.9, 0)), color: wm.roof, uvScale: 0.66 });
    b.add('plaster', new THREE.CircleGeometry(3.4, 16), { m: at(M(0, 11.72, 0, Math.PI / 2)), color: '#d8cfbd' });
    b.add('gold', cyl(0.06, 0.12, 1.4, 6), { m: at(M(0, 15.4, 0)), color: '#d8a948' });
    b.add('gold', new THREE.SphereGeometry(0.16, 10, 8), { m: at(M(0, 16.85, 0)), color: '#d8a948' });
    // hub
    const hub = new V3(0, 12.4, 3.15);
    b.add('wood', new THREE.CylinderGeometry(0.5, 0.6, 1.5, 12), { m: at(M(0, 12.4, 2.6, Math.PI / 2, 0, 0)), color: '#6b4630' });
    // sails rotate as their own group
    const sb = new Builder();
    for (let k = 0; k < 4; k++) {
      const R = M(0, 0, 0, 0, 0, (k * Math.PI) / 2);
      const add = (key, g, m, color) => sb.add(key, g, { m: R.clone().multiply(m), color });
      add('wood', new THREE.BoxGeometry(0.24, 9.2, 0.22), M(0, 4.6, 0), '#7a5636');
      for (let j = 0; j < 9; j++) add('wood', new THREE.BoxGeometry(2.0, 0.08, 0.09), M(1.0, 1.9 + j * 0.85, 0.05), '#8a6440');
      add('wood', new THREE.BoxGeometry(0.09, 7.0, 0.09), M(2.0, 5.3, 0.05), '#8a6440');
      add('sail', new THREE.PlaneGeometry(1.8, 6.8), M(1.0, 5.3, 0.09), '#efe6cf');
    }
    sb.add('wood', new THREE.CylinderGeometry(0.42, 0.42, 0.5, 10), { m: M(0, 0, 0, Math.PI / 2, 0, 0), color: '#5a3e2b' });
    const pivot = new THREE.Group();
    pivot.position.copy(hub).applyMatrix4(W);
    pivot.quaternion.setFromAxisAngle(Y_AXIS, wm.rot);
    const spin = new THREE.Group();
    pivot.add(spin);
    sb.build(this.mats, spin);
    this.group.add(pivot);
    this.windmills.push({ spin, speed: 0.45 + Math.random() * 0.15, x: wm.x, z: wm.z, top: y + 16.9 });
    // climbable tower with a cone cap
    this.solids.addCircle(wm.x, wm.z, 3.25, y + 1.6);
    this.solids.addCircle(wm.x, wm.z, 2.82, (d) => y + 11.7 + Math.max(0, 3.8 * (1 - d / 3.45)));
    this.area({ x: wm.x, z: wm.z, r: 4.6, soft: 1.5, grass: 0, color: '#a08c68' });
    this.terrain.addBlocker(wm.x, wm.z, 8);
  }

  // ----------------------------------------------------------------- ruins
  buildRuins() {
    const R = LANDMARKS.ruins;
    const rand = mulberry32(777);
    const b = new Builder();
    const y0 = this.terrain.heightAt(R.x, R.z);
    const rot = 0.35;
    const W = this.frame(R.x, y0, R.z, rot);
    const at = (m) => W.clone().multiply(m);
    const stone = '#cfc8b4';
    // raised platform of broken slabs
    const P = 7,
      ph = 0.8;
    b.add('ruin', box(P * 2, ph + 1.5, P * 2), { m: at(M(0, -1.5, 0)), color: '#bdb6a2', uvScale: 0.42 });
    for (let i = -3; i <= 3; i++)
      for (let j = -3; j <= 3; j++) {
        if (rand() < 0.12) continue;
        const tilt = rand() < 0.15 ? (rand() - 0.5) * 0.12 : 0;
        b.add('ruin', box(1.9, 0.16, 1.9), { m: at(M(i * 2, ph + (rand() - 0.5) * 0.05, j * 2, tilt, 0, tilt * 0.5)), color: stone, tone: 0.92 + rand() * 0.12, uvScale: 0.5 });
      }
    // steps toward the path (local +z)
    for (let s = 0; s < 3; s++) b.add('ruin', box(5, ph - s * 0.27, 0.9), { m: at(M(0, -0.2, P + 0.45 + s * 0.9)), color: stone, uvScale: 0.5 });
    this.solids.addBox(R.x, R.z, P, P, rot, y0 + ph + 0.1);
    for (let s = 0; s < 3; s++) {
      const lz = P + 0.45 + s * 0.9;
      const wx = R.x + lz * Math.sin(rot),
        wz = R.z + lz * Math.cos(rot);
      this.solids.addBox(wx, wz, 2.5, 0.45, rot, y0 - 0.2 + ph - s * 0.27);
    }
    // colonnade
    const colGeo = (h) => {
      const g = new THREE.CylinderGeometry(0.5, 0.56, h, 16, Math.max(1, Math.round(h * 2)));
      const p = g.attributes.position;
      for (let i = 0; i < p.count; i++) {
        const x = p.getX(i),
          z = p.getZ(i);
        const a = Math.atan2(z, x);
        const f = 1 - 0.05 * Math.max(0, Math.cos(a * 16));
        p.setX(i, x * f);
        p.setZ(i, z * f);
      }
      g.translate(0, h / 2, 0);
      g.computeVertexNormals();
      return g;
    };
    const n = 10;
    for (let k = 0; k < n; k++) {
      const a = (k / n) * TAU + 0.2;
      const lx = Math.cos(a) * 10.5,
        lz = Math.sin(a) * 10.5;
      if (lz > 8 && Math.abs(lx) < 4) continue; // entrance
      const wx = R.x + lx * Math.cos(rot) + lz * Math.sin(rot),
        wz = R.z - lx * Math.sin(rot) + lz * Math.cos(rot);
      const gy = this.terrain.heightAt(wx, wz) - 0.3;
      const fallen = k === 3 || k === 7;
      if (fallen) {
        const len = 4 + rand() * 2;
        const fa = rand() * TAU;
        b.add('ruin', colGeo(len), { m: M(wx, gy + 0.75, wz, 0, fa, Math.PI / 2), color: stone, uvScale: 0.5 });
        b.add('ruin', box(1.4, 0.5, 1.4), { m: M(wx, gy, wz, 0, fa), color: stone, uvScale: 0.5 });
        this.solids.addCircle(wx, wz, 0.8, gy + 0.8);
        continue;
      }
      const h = rand() < 0.4 ? 2 + rand() * 2.5 : 6.2;
      b.add('ruin', box(1.4, 0.6, 1.4), { m: M(wx, gy, wz, 0, -a), color: stone, uvScale: 0.5 });
      b.add('ruin', colGeo(h), { m: M(wx, gy + 0.6, wz), color: stone, uvScale: 0.5 });
      if (h > 6) b.add('ruin', box(1.5, 0.45, 1.5), { m: M(wx, gy + 0.6 + h, wz, 0, -a), color: stone, uvScale: 0.5 });
      else b.add('ruin', new THREE.ConeGeometry(0.52, 0.5, 16, 1), { m: M(wx, gy + 0.6 + h + 0.2, wz, rand() * 0.4, 0, rand() * 0.4), color: stone });
      this.solids.addCircle(wx, wz, 0.7, gy + 0.6 + h + (h > 6 ? 0.45 : 0.2));
    }
    // lintels across the two tallest neighbours
    // arch gateway at the entrance
    {
      const gz = 12.2;
      for (const s of [-1, 1]) {
        b.add('ruin', box(1.3, 6.4, 1.3), { m: at(M(s * 2.9, -0.3, gz)), color: stone, uvScale: 0.42 });
        const wx = R.x + s * 2.9 * Math.cos(rot) + gz * Math.sin(rot),
          wz = R.z - s * 2.9 * Math.sin(rot) + gz * Math.cos(rot);
        this.solids.addBox(wx, wz, 0.65, 0.65, rot, y0 + 6.1);
      }
      const segs = 9;
      for (let k = 0; k < segs; k++) {
        if (k === 6) continue; // missing keystone neighbour
        const a0 = (k / segs) * Math.PI,
          a1 = ((k + 1) / segs) * Math.PI;
        const am = (a0 + a1) / 2;
        b.add('ruin', new THREE.BoxGeometry(1.25, 0.75, 1.2), { m: at(M(Math.cos(am) * 2.9, 6.1 + Math.sin(am) * 2.6, gz, 0, 0, am - Math.PI / 2)), color: stone, uvScale: 0.5 });
      }
    }
    // the great ring monument with glowing runes
    {
      const ringM = at(M(0, ph + 0.2 + 3.0, -3.2, 0.12, 0, 0.05));
      const ring = new THREE.TorusGeometry(3.3, 0.5, 8, 40);
      b.add('ruin', ring, { m: ringM, color: '#c3bca6', uvScale: 0.6 });
      b.add('rune', new THREE.TorusGeometry(3.3, 0.08, 4, 40, Math.PI * 1.3), { m: ringM.clone().multiply(M(0, 0, 0.5, 0, 0, 0.6)), color: '#2b6e66', extra: 1 });
      b.add('rune', new THREE.TorusGeometry(3.3, 0.08, 4, 40, Math.PI * 0.9), { m: ringM.clone().multiply(M(0, 0, -0.5, 0, 0, 2.6)), color: '#2b6e66', extra: 1 });
      b.add('ruin', box(2.4, 1.0, 1.6), { m: at(M(0, ph, -3.2)), color: stone, uvScale: 0.5 });
      const wx = R.x - 3.2 * Math.sin(rot),
        wz = R.z - 3.2 * Math.cos(rot);
      this.solids.addBox(wx, wz, 1.2, 0.8, rot, y0 + ph + 1.0);
      const rc = y0 + ph + 3.2;
      this.ringBase = new V3(wx, y0 + ph, wz);
      this.ringCenter = new V3(wx, rc, wz);
      this.solids.addBox(wx, wz, 3.75, 0.45, rot, (lx) => rc + Math.sqrt(Math.max(0, 3.8 * 3.8 - lx * lx)));
      this.ringTop = new V3(0, ph + 3.2 + 3.8, -3.2).applyMatrix4(W);
    }
    // rubble
    for (let k = 0; k < 26; k++) {
      const a = rand() * TAU,
        d = 8 + rand() * 9;
      const x = R.x + Math.cos(a) * d,
        z = R.z + Math.sin(a) * d;
      const s = 0.4 + rand() * 0.9;
      b.add('ruin', new THREE.BoxGeometry(s * 1.4, s, s), { m: M(x, this.terrain.heightAt(x, z) + s * 0.25, z, rand(), rand() * 3, rand() * 0.5), color: stone, tone: 0.85 + rand() * 0.2, uvScale: 0.5 });
    }
    b.build(this.mats, this.group);
    this.ruins = { center: new V3(R.x, y0 + ph, R.z), rot };
    this.area({ x: R.x, z: R.z, hw: P + 1, hd: P + 1, rot, soft: 2, grass: 0, color: '#8d8a72' });
    this.area({ x: R.x, z: R.z, r: 16, soft: 6, grass: 0.55, color: '#5f7a3c', amount: 0.5 });
    this.terrain.addBlocker(R.x, R.z, 15);
  }

  // ---------------------------------------------------------------- update
  update(dt, wind = 1) {
    this.time += dt;
    for (const w of this.windmills) w.spin.rotation.z -= dt * w.speed * (0.6 + wind * 0.5);
    for (const wp of this.waypoints) {
      wp.spin += dt * (wp.active ? 1.2 : 0.35);
      wp.crystal.rotation.y = wp.spin;
      wp.crystal.position.y = wp.y + 3.7 + Math.sin(this.time * 1.6 + wp.x) * 0.08;
    }
    if (this.statue) {
      const s = 1 + Math.sin(this.time * 2.2) * 0.06;
      this.statue.orb.scale.setScalar(s);
    }
    updateBoats(this, this.time);
  }
}
