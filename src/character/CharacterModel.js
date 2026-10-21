import * as THREE from 'three';
import { mergeGeometries, mergeVertices } from 'three/addons/utils/BufferGeometryUtils.js';
import { toonMaterial, outlineMaterial, outlineColorFor, faceDecalMaterial, glowMaterial } from '../render/materials.js';
import { ELEMENTS } from './characters.js';
import { smoothstep, lerp, clamp, damp, mulberry32 } from '../core/noise.js';

const V3 = (x, y, z) => new THREE.Vector3(x, y, z);
const DEG = Math.PI / 180;

// ---------------------------------------------------------------------------
// geometry helpers
// ---------------------------------------------------------------------------
function lathe(profile, segs = 22) {
  return new THREE.LatheGeometry(
    profile.map(([r, y]) => new THREE.Vector2(Math.max(r, 1e-4), y)),
    segs
  );
}

function smooth(geo) {
  geo.deleteAttribute('normal');
  if (geo.attributes.uv) geo.deleteAttribute('uv');
  const g = mergeVertices(geo, 1e-5);
  g.computeVertexNormals();
  return g;
}

function sph(elevDeg, azDeg, r) {
  const e = elevDeg * DEG,
    a = azDeg * DEG;
  return V3(Math.sin(a) * Math.cos(e) * r, Math.sin(e) * r, Math.cos(a) * Math.cos(e) * r);
}

// Flat-ish hair ribbon with elliptical cross-section following a curve.
// `center` orients the flat side outward from the head.
function strand(points, width, thick, center, opts = {}) {
  const curve = new THREE.CatmullRomCurve3(points, false, 'catmullrom', 0.5);
  const segs = opts.segs ?? 12;
  const rad = opts.rad ?? 7;
  const pos = [],
    nor = [],
    grad = [],
    uv = [],
    idx = [];
  const P = new THREE.Vector3(),
    T = new THREE.Vector3(),
    O = new THREE.Vector3(),
    S = new THREE.Vector3(),
    tmp = new THREE.Vector3();
  const taper = opts.taper ?? ((t) => Math.max(0.04, Math.pow(1 - t, 0.85) * (1 + 0.35 * Math.sin(t * Math.PI))));
  for (let i = 0; i <= segs; i++) {
    const t = i / segs;
    curve.getPointAt(t, P);
    curve.getTangentAt(t, T);
    O.copy(P).sub(center);
    O.addScaledVector(T, -O.dot(T));
    if (O.lengthSq() < 1e-10) O.set(0, 0, 1);
    O.normalize();
    S.crossVectors(T, O).normalize();
    const k = taper(t);
    const w = width * k,
      th = thick * Math.max(k, 0.25);
    for (let j = 0; j <= rad; j++) {
      const a = (j / rad) * Math.PI * 2;
      const c = Math.cos(a),
        s = Math.sin(a);
      tmp.copy(P).addScaledVector(S, c * w).addScaledVector(O, s * th);
      pos.push(tmp.x, tmp.y, tmp.z);
      const nx = c / Math.max(w, 1e-4),
        ny = s / Math.max(th, 1e-4);
      const nl = Math.hypot(nx, ny) || 1;
      tmp.set(0, 0, 0).addScaledVector(S, nx / nl).addScaledVector(O, ny / nl).normalize();
      nor.push(tmp.x, tmp.y, tmp.z);
      grad.push(t);
      uv.push(j / rad, t);
    }
  }
  for (let i = 0; i < segs; i++)
    for (let j = 0; j < rad; j++) {
      const a = i * (rad + 1) + j,
        b = a + rad + 1;
      idx.push(a, b, a + 1, b, b + 1, a + 1);
    }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('normal', new THREE.Float32BufferAttribute(nor, 3));
  g.setAttribute('aGrad', new THREE.Float32BufferAttribute(grad, 1));
  g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
  g.setIndex(idx);
  return g;
}

function withGrad(geo, value = 0) {
  const n = geo.attributes.position.count;
  geo.setAttribute('aGrad', new THREE.Float32BufferAttribute(new Float32Array(n).fill(value), 1));
  if (!geo.attributes.uv) geo.setAttribute('uv', new THREE.Float32BufferAttribute(new Float32Array(n * 2), 2));
  return geo;
}

function deformHead(geo, R) {
  const p = geo.attributes.position;
  for (let i = 0; i < p.count; i++) {
    let x = p.getX(i),
      y = p.getY(i),
      z = p.getZ(i);
    const ny = y / R;
    if (ny < 0) {
      const t = smoothstep(0, -1, ny);
      x *= 1 - 0.34 * Math.pow(t, 1.1);
      if (z < 0) z *= 1 - 0.32 * t;
      else z *= 1 - 0.06 * t;
      y *= 1 + 0.16 * t;
    } else {
      y *= 1.03;
    }
    x *= 0.95;
    p.setXYZ(i, x, y, z);
  }
  p.needsUpdate = true;
}

// ---------------------------------------------------------------------------
// Face texture (big anime eyes drawn on a canvas, projected on the head)
// ---------------------------------------------------------------------------
const FACE_W = 1024,
  FACE_H = 576;
const PHI0 = 15,
  PHI_LEN = 150,
  TH0 = 50,
  TH_LEN = 85;

function faceMap(x, y) {
  const th = Math.acos(clamp(y, -0.999, 0.999));
  const st = Math.sin(th);
  const ph = Math.acos(clamp(-x / st, -1, 1));
  return [((ph / DEG - PHI0) / PHI_LEN) * FACE_W, ((th / DEG - TH0) / TH_LEN) * FACE_H];
}

function shade(hex, k) {
  const c = new THREE.Color(hex);
  c.convertLinearToSRGB();
  return `rgb(${Math.round(clamp(c.r * k, 0, 1) * 255)},${Math.round(clamp(c.g * k, 0, 1) * 255)},${Math.round(clamp(c.b * k, 0, 1) * 255)})`;
}

function drawFace(cfg, closed) {
  const cv = document.createElement('canvas');
  cv.width = FACE_W;
  cv.height = FACE_H;
  const g = cv.getContext('2d');
  const S = 390;
  const col = cfg.colors;
  const lash = '#2a1c26';
  const fem = cfg.female;

  // blush
  for (const s of [-1, 1]) {
    const [bx, by] = faceMap(s * 0.47, -0.36);
    const rg = g.createRadialGradient(bx, by, 0, bx, by, S * 0.14);
    rg.addColorStop(0, fem ? 'rgba(255,120,130,0.35)' : 'rgba(255,130,120,0.18)');
    rg.addColorStop(1, 'rgba(255,120,130,0)');
    g.fillStyle = rg;
    g.beginPath();
    g.ellipse(bx, by, S * 0.16, S * 0.09, 0, 0, Math.PI * 2);
    g.fill();
  }

  // eyes
  const ew = S * (fem ? 0.33 : 0.3);
  const eh = S * (fem ? 0.39 : 0.31);
  for (const s of [-1, 1]) {
    const [cx, cy] = faceMap(s * 0.37, -0.11);
    g.save();
    g.translate(cx, cy);
    g.scale(s, 1); // +x -> outer corner
    if (fem) g.rotate(-0.04);
    else g.rotate(-0.1);
    const w = ew,
      h = eh;
    if (closed) {
      g.strokeStyle = lash;
      g.lineCap = 'round';
      g.lineWidth = h * 0.075;
      g.beginPath();
      g.moveTo(-w * 0.5, h * 0.02);
      g.quadraticCurveTo(0, h * 0.2, w * 0.52, -h * 0.06);
      g.stroke();
      g.lineWidth = h * 0.05;
      g.beginPath();
      g.moveTo(w * 0.45, -h * 0.03);
      g.lineTo(w * 0.62, -h * 0.12);
      g.stroke();
    } else {
      const eyePath = () => {
        g.beginPath();
        g.moveTo(-w * 0.5, -h * 0.02);
        g.bezierCurveTo(-w * 0.36, -h * 0.56, w * 0.28, -h * 0.64, w * 0.52, -h * 0.24);
        g.bezierCurveTo(w * 0.56, h * 0.22, w * 0.18, h * 0.52, -w * 0.04, h * 0.5);
        g.bezierCurveTo(-w * 0.34, h * 0.46, -w * 0.52, h * 0.22, -w * 0.5, -h * 0.02);
        g.closePath();
      };
      eyePath();
      g.fillStyle = '#f7f6ff';
      g.fill();
      g.save();
      eyePath();
      g.clip();
      // iris
      const ix = w * 0.02,
        iy = h * 0.07;
      const irx = w * 0.4,
        iry = h * 0.47;
      const lg = g.createLinearGradient(0, iy - iry, 0, iy + iry);
      lg.addColorStop(0, shade(col.eye, 0.35));
      lg.addColorStop(0.45, shade(col.eye, 0.95));
      lg.addColorStop(1, shade(col.eye2, 1.0));
      g.fillStyle = lg;
      g.beginPath();
      g.ellipse(ix, iy, irx, iry, 0, 0, Math.PI * 2);
      g.fill();
      g.strokeStyle = shade(col.eye, 0.3);
      g.lineWidth = 4;
      g.stroke();
      // pupil
      g.fillStyle = shade(col.eye, 0.22);
      g.beginPath();
      g.ellipse(ix, iy - h * 0.04, w * 0.16, h * 0.23, 0, 0, Math.PI * 2);
      g.fill();
      // lower glow
      g.globalAlpha = 0.75;
      const rg = g.createRadialGradient(ix, iy + h * 0.3, 0, ix, iy + h * 0.3, w * 0.32);
      rg.addColorStop(0, shade(col.eye2, 1.15));
      rg.addColorStop(1, 'rgba(255,255,255,0)');
      g.fillStyle = rg;
      g.beginPath();
      g.ellipse(ix, iy + h * 0.3, w * 0.34, h * 0.18, 0, 0, Math.PI * 2);
      g.fill();
      g.globalAlpha = 1;
      // eyelid shadow
      const sg = g.createLinearGradient(0, -h * 0.6, 0, -h * 0.05);
      sg.addColorStop(0, 'rgba(60,30,60,0.65)');
      sg.addColorStop(1, 'rgba(60,30,60,0)');
      g.fillStyle = sg;
      g.fillRect(-w, -h, w * 2, h);
      g.restore();
      // highlights
      g.fillStyle = '#ffffff';
      g.beginPath();
      g.ellipse(ix - w * 0.13, iy - h * 0.16, w * 0.11, h * 0.09, -0.3, 0, Math.PI * 2);
      g.fill();
      g.globalAlpha = 0.9;
      g.beginPath();
      g.arc(ix + w * 0.17, iy + h * 0.2, w * 0.045, 0, Math.PI * 2);
      g.fill();
      g.globalAlpha = 1;
      // upper lash
      g.strokeStyle = lash;
      g.lineCap = 'round';
      g.lineJoin = 'round';
      g.lineWidth = h * (fem ? 0.085 : 0.07);
      g.beginPath();
      g.moveTo(-w * 0.5, -h * 0.0);
      g.bezierCurveTo(-w * 0.36, -h * 0.56, w * 0.28, -h * 0.64, w * 0.53, -h * 0.25);
      g.stroke();
      if (fem) {
        // outer flick
        g.fillStyle = lash;
        g.beginPath();
        g.moveTo(w * 0.36, -h * 0.47);
        g.quadraticCurveTo(w * 0.62, -h * 0.4, w * 0.7, -h * 0.2);
        g.quadraticCurveTo(w * 0.56, -h * 0.26, w * 0.5, -h * 0.18);
        g.closePath();
        g.fill();
      }
      // lower lash hint
      g.globalAlpha = 0.55;
      g.lineWidth = 3;
      g.beginPath();
      g.moveTo(w * 0.5, h * 0.06);
      g.quadraticCurveTo(w * 0.4, h * 0.42, w * 0.12, h * 0.5);
      g.stroke();
      g.globalAlpha = 1;
    }
    g.restore();

    // brows
    const [bx, by] = faceMap(s * 0.37, 0.27);
    g.save();
    g.translate(bx, by);
    g.scale(s, 1);
    g.strokeStyle = shade(col.hair, 0.45);
    g.lineWidth = fem ? 6 : 9;
    g.lineCap = 'round';
    g.beginPath();
    g.moveTo(-ew * 0.45, fem ? 6 : 10);
    g.quadraticCurveTo(0, fem ? -10 : -4, ew * 0.5, fem ? 2 : -8);
    g.stroke();
    g.restore();
  }

  // nose hint
  const [nx, ny] = faceMap(0.03, -0.34);
  g.strokeStyle = 'rgba(190,110,100,0.45)';
  g.lineWidth = 3;
  g.beginPath();
  g.moveTo(nx - 2, ny - 6);
  g.lineTo(nx + 2, ny + 3);
  g.stroke();

  // mouth
  const [mx, my] = faceMap(0, -0.56);
  g.strokeStyle = '#8f3f42';
  g.lineWidth = 4;
  g.lineCap = 'round';
  g.beginPath();
  g.moveTo(mx - S * 0.055, my - 2);
  g.quadraticCurveTo(mx, my + S * 0.03, mx + S * 0.055, my - 2);
  g.stroke();

  const tex = new THREE.CanvasTexture(cv);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.anisotropy = 8;
  return tex;
}

// ---------------------------------------------------------------------------
// Hair
// ---------------------------------------------------------------------------
function buildHair(cfg, R) {
  const rand = mulberry32(cfg.id.length * 977 + 13);
  const H = cfg.hair;
  const C0 = V3(0, 0, 0);
  const front = [];
  const back = [];
  const tail = [];
  let tailAnchors = [];

  // cap
  const cap = new THREE.SphereGeometry(R * 1.075, 36, 18, 0, Math.PI * 2, 0, Math.PI * 0.6);
  cap.rotateX(-0.66);
  cap.scale(0.97, 1.0, 1.04);
  cap.translate(0, R * 0.04, -R * 0.03);
  front.push(withGrad(smooth(cap), 0));

  // bangs
  const nb = H.bangs;
  for (let i = 0; i < nb; i++) {
    const f = (i / (nb - 1)) * 2 - 1;
    const af = Math.abs(f);
    const az = f * 66 + (rand() - 0.5) * 6;
    let tipE = af > 0.82 ? -10 - rand() * 6 : 13 - (1 - af) * 6 + rand() * 4;
    if (H.spiky) tipE += 4;
    const root = sph(64, az * 0.55, R * 1.02);
    const mid = sph(40, az * 0.9, R * 1.14);
    const tip = sph(tipE, az * 1.04 + (H.spiky ? f * 6 : 0), R * (1.1 + (H.spiky ? 0.05 : 0)));
    const m2 = mid.clone().lerp(tip, 0.6).multiplyScalar(1.03);
    front.push(strand([root, mid, m2, tip], R * (af > 0.82 ? 0.22 : 0.3), R * 0.09, C0));
  }
  // side locks
  for (const s of [-1, 1]) {
    const len = H.style === 'short' ? 1.25 : H.style === 'medium' ? 1.9 : 2.5;
    front.push(
      strand(
        [sph(42, s * 76, R * 1.03), sph(2, s * 84, R * 1.12), V3(s * R * 0.98, -R * 0.9, R * 0.28), V3(s * R * 0.86, -R * len, R * 0.4)],
        R * 0.27,
        R * 0.08,
        C0
      )
    );
  }
  // ahoge
  if (H.ahoge) {
    front.push(
      strand([V3(0, R * 1.02, R * 0.12), V3(0, R * 1.42, R * 0.22), V3(R * 0.05, R * 1.55, R * 0.52), V3(R * 0.1, R * 1.36, R * 0.7)], R * 0.12, R * 0.045, V3(0, R * 1.2, 0))
    );
  }
  // back hair
  const nBack = 12;
  const L = H.length;
  for (let i = 0; i < nBack; i++) {
    const f = i / (nBack - 1);
    const az = lerp(96, 264, f) + (rand() - 0.5) * 6;
    const a = az * DEG;
    const dx = Math.sin(a),
      dz = Math.cos(a);
    const len = L * (0.9 + rand() * 0.2) * (H.spiky ? 0.8 : 1);
    const root = sph(60, az, R * 0.98);
    const mid = sph(4, az, R * 1.16);
    const p3 = V3(dx * R * 1.16, -R * (0.35 + len * 0.42), dz * R * 1.1 - R * 0.12);
    const tip = V3(dx * R * (1.15 + len * 0.06) * (H.spiky ? 1.3 : 1), -R * (0.3 + len), dz * R * 1.05 - R * (0.18 + len * 0.1));
    back.push(strand([root, mid, p3, tip], R * 0.38, R * 0.1, V3(0, -R * 0.5, 0)));
  }

  // tails
  if (H.tail === 'pony') {
    const A = V3(0, R * 0.62, -R * 0.95);
    tailAnchors.push(A);
    for (let i = 0; i < 7; i++) {
      const dx = (rand() - 0.5) * R * 0.5;
      const pts = [V3(dx * 0.3, 0, 0), V3(dx * 0.6, R * 0.3, -R * 0.55), V3(dx * 1.2, -R * 1.3, -R * 1.25), V3(dx * 1.6, -R * 3.6, -R * 1.0)];
      tail.push({ anchor: 0, g: strand(pts, R * 0.36, R * 0.13, V3(0, -R * 1.4, R * 0.4)) });
    }
  } else if (H.tail === 'twin') {
    for (const s of [-1, 1]) {
      const A = V3(s * R * 0.88, R * 0.5, -R * 0.32);
      tailAnchors.push(A);
      for (let i = 0; i < 5; i++) {
        const dz = (rand() - 0.5) * R * 0.4;
        const pts = [V3(0, 0, dz * 0.3), V3(s * R * 0.42, R * 0.1, -R * 0.18 + dz), V3(s * R * 0.75, -R * 1.4, -R * 0.35 + dz), V3(s * R * 0.62, -R * 3.5, -R * 0.2 + dz * 1.4)];
        tail.push({ anchor: tailAnchors.length - 1, g: strand(pts, R * 0.33, R * 0.12, V3(s * -R * 0.4, -R * 1.5, 0)) });
      }
    }
  }
  return {
    front: mergeGeometries(front),
    back: mergeGeometries(back),
    tails: tailAnchors.map((A, k) => ({ anchor: A, geo: mergeGeometries(tail.filter((t) => t.anchor === k).map((t) => t.g)) })),
  };
}

function skirtGeo(rTop, rBot, len, pleats = 10, depth = 0.06, squash = 0.86, open = 0) {
  const g = new THREE.CylinderGeometry(rTop, rBot, len, pleats * 4, 5, true, open / 2, Math.PI * 2 - open);
  g.translate(0, -len / 2, 0);
  const p = g.attributes.position;
  for (let i = 0; i < p.count; i++) {
    const x = p.getX(i),
      y = p.getY(i),
      z = p.getZ(i);
    const a = Math.atan2(z, x);
    const t = -y / len;
    const k = 1 + depth * t * Math.cos(a * pleats);
    const hem = t > 0.99 ? Math.sin(a * pleats * 0.5) * 0.008 : 0;
    p.setXYZ(i, x * k, y + hem, z * k * squash);
  }
  return smooth(g);
}

function capeGeo(rTop, rBot, len, arc) {
  const g = new THREE.CylinderGeometry(rTop, rBot, len, 18, 6, true, Math.PI - arc / 2, arc);
  g.translate(0, -len / 2, 0);
  const p = g.attributes.position;
  for (let i = 0; i < p.count; i++) {
    const y = p.getY(i);
    const t = -y / len;
    const a = Math.atan2(p.getX(i), p.getZ(i));
    p.setY(i, y - Math.cos(a * 5) * 0.02 * t * t);
  }
  return smooth(g);
}

function swordGeo(kind) {
  const geos = [];
  const s = new THREE.Shape();
  const big = kind === 'claymore';
  const W = big ? 0.055 : 0.024,
    Lb = big ? 1.0 : 0.72;
  s.moveTo(-W, 0);
  s.lineTo(W, 0);
  s.lineTo(W * 0.92, Lb * 0.86);
  s.lineTo(0, Lb);
  s.lineTo(-W * 0.92, Lb * 0.86);
  s.closePath();
  const blade = new THREE.ExtrudeGeometry(s, { depth: big ? 0.012 : 0.006, bevelEnabled: true, bevelThickness: 0.004, bevelSize: 0.004, bevelSegments: 1 });
  blade.translate(0, 0.04, -0.003);
  return { blade, len: Lb };
}

// ---------------------------------------------------------------------------
// Character model
// ---------------------------------------------------------------------------
const JOINTS = ['hips', 'spine', 'chest', 'neck', 'head', 'uArmL', 'fArmL', 'handL', 'uArmR', 'fArmR', 'handR', 'thighL', 'shinL', 'footL', 'thighR', 'shinR', 'footR'];

export class CharacterModel {
  constructor(cfg) {
    this.cfg = cfg;
    this.el = ELEMENTS[cfg.element];
    this.root = new THREE.Group();
    this.root.name = cfg.id;
    this.body = new THREE.Group();
    this.root.add(this.body);
    this.j = {};
    this.pose = {};
    for (const n of JOINTS) {
      this.j[n] = new THREE.Group();
      this.pose[n] = new THREE.Euler();
    }
    this.t = 0;
    this.phase = 0;
    this.blinkT = 2 + Math.random() * 2;
    this.springs = [];
    this.meshes = [];
    this.build();
    this.root.scale.setScalar(cfg.scale);
  }

  mat(color, opts = {}) {
    const c = this.cfg.colors;
    const skin = color === c.skin;
    return toonMaterial({
      color,
      color2: opts.color2,
      shadowTint: opts.shadowTint ?? (skin ? '#f4b8b0' : '#b8acd6'),
      rim: opts.rim ?? 0.4,
      spec: opts.spec ?? 0,
      emissive: opts.emissive ?? 0,
      side: opts.side,
      map: opts.map,
      ramp: opts.ramp ?? 0.0,
    });
  }

  add(parent, geo, color, opts = {}) {
    const mat = opts.material ?? this.mat(color, opts);
    const mesh = new THREE.Mesh(geo, mat);
    if (opts.pos) mesh.position.copy(opts.pos);
    if (opts.rot) mesh.rotation.set(opts.rot.x, opts.rot.y, opts.rot.z);
    if (opts.scale) mesh.scale.copy(opts.scale);
    mesh.castShadow = opts.cast ?? true;
    mesh.receiveShadow = true;
    parent.add(mesh);
    if (opts.outline !== false) {
      const om = new THREE.Mesh(geo, outlineMaterial(opts.outlineColor ?? outlineColorFor(color), opts.outlineWidth ?? 1));
      om.castShadow = false;
      om.receiveShadow = false;
      mesh.add(om);
    }
    this.meshes.push(mesh);
    return mesh;
  }

  build() {
    const cfg = this.cfg;
    const c = cfg.colors;
    const fem = cfg.female;
    const j = this.j;
    const R = 0.118;
    this.R = R;
    const sh = fem ? 1 : 1.12; // shoulder/torso width factor

    // hierarchy
    this.body.position.y = 0.89;
    this.body.add(j.hips);
    j.hips.add(j.spine);
    j.spine.position.y = 0.07;
    j.spine.add(j.chest);
    j.chest.position.y = 0.12;
    j.chest.add(j.neck);
    j.neck.position.y = 0.205;
    j.neck.add(j.head);
    j.head.position.y = 0.075;
    for (const [s, u, f, h] of [
      [1, 'uArmL', 'fArmL', 'handL'],
      [-1, 'uArmR', 'fArmR', 'handR'],
    ]) {
      j.chest.add(j[u]);
      j[u].position.set(s * 0.132 * sh, 0.165, -0.005);
      j[u].add(j[f]);
      j[f].position.y = -0.245;
      j[f].add(j[h]);
      j[h].position.y = -0.225;
    }
    for (const [s, t, sn, ft] of [
      [1, 'thighL', 'shinL', 'footL'],
      [-1, 'thighR', 'shinR', 'footR'],
    ]) {
      j.hips.add(j[t]);
      j[t].position.set(s * 0.076, -0.05, 0);
      j[t].add(j[sn]);
      j[sn].position.y = -0.395;
      j[sn].add(j[ft]);
      j[ft].position.y = -0.39;
    }

    // ---- torso
    const pelvis = lathe([
      [0.0, -0.1],
      [0.08, -0.095],
      [0.118, -0.05],
      [0.126, 0.0],
      [0.112, 0.08],
      [0.0, 0.09],
    ]);
    pelvis.scale(sh, 1, 0.78);
    this.add(j.hips, pelvis, c.legs === c.skin ? c.outfit : c.legs);

    const chestProfile = fem
      ? [
          [0.0, -0.13],
          [0.104, -0.13],
          [0.1, -0.05],
          [0.112, 0.04],
          [0.124, 0.11],
          [0.118, 0.17],
          [0.07, 0.215],
          [0.0, 0.225],
        ]
      : [
          [0.0, -0.13],
          [0.11, -0.13],
          [0.112, -0.04],
          [0.126, 0.06],
          [0.138, 0.14],
          [0.13, 0.19],
          [0.075, 0.22],
          [0.0, 0.228],
        ];
    const chest = lathe(chestProfile);
    chest.scale(sh, 1, 0.72);
    this.add(j.chest, chest, c.outfit);
    if (fem) {
      for (const s of [-1, 1]) {
        const b = new THREE.SphereGeometry(0.05, 16, 12);
        b.scale(1, 0.9, 0.8);
        this.add(j.chest, b, c.outfit, { pos: V3(s * 0.045, 0.08, 0.055) });
      }
    }
    // accent band + collar
    const band = new THREE.TorusGeometry(0.112 * sh, 0.012, 8, 28);
    band.rotateX(Math.PI / 2);
    band.scale(1, 1, 0.74);
    this.add(j.chest, band, c.outfit2, { pos: V3(0, -0.07, 0) });
    const collar = lathe([
      [0.07, -0.01],
      [0.075, 0.015],
      [0.05, 0.04],
    ]);
    collar.scale(1, 1, 0.85);
    this.add(j.chest, collar, c.outfit2, { pos: V3(0, 0.2, 0) });

    // belt + elemental sigil
    const belt = new THREE.TorusGeometry(0.122 * sh, 0.014, 8, 28);
    belt.rotateX(Math.PI / 2);
    belt.scale(1, 1, 0.78);
    this.add(j.hips, belt, c.gold, { pos: V3(0, 0.035, 0), spec: 0.6 });
    const gem = new THREE.OctahedronGeometry(0.026, 0);
    gem.scale(1, 1.3, 0.6);
    this.gem = this.add(j.hips, gem, this.el.color, { pos: V3(0.07 * sh, 0.0, 0.09), emissive: 0.9, spec: 1 });

    // neck
    const neck = lathe([
      [0.034, -0.03],
      [0.032, 0.05],
      [0.034, 0.1],
    ]);
    this.add(j.neck, neck, c.skin, { outline: false });

    // ---- head
    let head = new THREE.SphereGeometry(R, 40, 28);
    deformHead(head, R);
    head = smooth(head);
    const headGroup = new THREE.Group();
    headGroup.position.set(0, R * 0.95, 0.008);
    j.head.add(headGroup);
    this.headGroup = headGroup;
    this.add(headGroup, head, c.skin);
    // ears (mostly hidden by hair)
    for (const s of [-1, 1]) {
      const ear = new THREE.SphereGeometry(0.022, 10, 8);
      ear.scale(0.5, 1, 0.7);
      this.add(headGroup, ear, c.skin, { pos: V3(s * R * 0.92, -R * 0.12, -R * 0.05) });
    }
    // face decal
    const decal = new THREE.SphereGeometry(R * 1.006, 64, 36, PHI0 * DEG, PHI_LEN * DEG, TH0 * DEG, TH_LEN * DEG);
    deformHead(decal, R * 1.006);
    this.faceOpen = drawFace(cfg, false);
    this.faceClosed = drawFace(cfg, true);
    this.faceMat = faceDecalMaterial(this.faceOpen);
    const face = new THREE.Mesh(decal, this.faceMat);
    face.renderOrder = 1;
    headGroup.add(face);

    // hair
    const hair = buildHair(cfg, R);
    const hairOpts = { color2: c.hairTip, spec: 0.35, rim: 0.5, shadowTint: '#a8a0d0', outlineColor: outlineColorFor(c.hair) };
    this.add(headGroup, hair.front, c.hair, hairOpts);
    const backPivot = new THREE.Group();
    backPivot.position.set(0, R * 0.5, -R * 0.2);
    headGroup.add(backPivot);
    hair.back.translate(0, -R * 0.5, R * 0.2);
    this.add(backPivot, hair.back, c.hair, hairOpts);
    this.springs.push({ obj: backPivot, gain: 0.7, ang: V3(0, 0, 0), vel: V3(0, 0, 0), k: 60, d: 9 });
    for (const t of hair.tails) {
      const piv = new THREE.Group();
      piv.position.copy(t.anchor);
      headGroup.add(piv);
      this.add(piv, t.geo, c.hair, hairOpts);
      const tie = new THREE.TorusGeometry(R * 0.16, R * 0.06, 6, 14);
      this.add(piv, tie, c.outfit2, { pos: V3(0, 0, 0), rot: V3(0.4, 0, 0) });
      this.springs.push({ obj: piv, gain: 1.2, ang: V3(0, 0, 0), vel: V3(0, 0, 0), k: 40, d: 6 });
    }

    // ---- arms
    for (const [s, u, f, h] of [
      [1, 'uArmL', 'fArmL', 'handL'],
      [-1, 'uArmR', 'fArmR', 'handR'],
    ]) {
      const longSleeve = cfg.outfit.sleeves === 'long';
      const up = lathe([
        [0.0, -0.255],
        [0.03, -0.25],
        [0.034, -0.2],
        [0.04 * (fem ? 1 : 1.15), -0.06],
        [0.043 * (fem ? 1 : 1.15), 0.0],
        [0.03, 0.035],
        [0.0, 0.042],
      ]);
      this.add(j[u], up, longSleeve ? c.outfit : c.skin);
      if (cfg.outfit.sleeves === 'puff') {
        const puff = lathe([
          [0.0, -0.11],
          [0.045, -0.115],
          [0.068, -0.07],
          [0.066, -0.01],
          [0.046, 0.035],
          [0.0, 0.045],
        ]);
        this.add(j[u], puff, c.outfit);
        const cuff = new THREE.TorusGeometry(0.046, 0.008, 6, 16);
        cuff.rotateX(Math.PI / 2);
        this.add(j[u], cuff, c.outfit2, { pos: V3(0, -0.105, 0) });
      }
      const fore = lathe([
        [0.0, -0.235],
        [0.026, -0.23],
        [0.03, -0.17],
        [0.035 * (fem ? 1 : 1.12), -0.04],
        [0.035, 0.0],
        [0.0, 0.025],
      ]);
      this.add(j[f], fore, longSleeve ? c.outfit : fem ? c.skin : c.dark);
      if (cfg.outfit.sleeves === 'wide') {
        const ws = lathe([
          [0.095, -0.2],
          [0.085, -0.15],
          [0.06, -0.05],
          [0.042, 0.01],
        ]);
        this.add(j[f], ws, c.outfit, { side: THREE.DoubleSide });
      } else {
        // glove / bracer
        const br = lathe([
          [0.03, -0.225],
          [0.034, -0.16],
          [0.032, -0.1],
        ]);
        this.add(j[f], br, c.dark);
      }
      const hand = new THREE.SphereGeometry(1, 14, 10);
      hand.scale(0.026, 0.048, 0.018);
      this.add(j[h], hand, fem ? c.skin : c.dark, { pos: V3(0, -0.035, 0.004) });
      const thumb = new THREE.SphereGeometry(1, 8, 6);
      thumb.scale(0.009, 0.022, 0.009);
      this.add(j[h], thumb, fem ? c.skin : c.dark, { pos: V3(s * -0.012, -0.022, 0.018), rot: V3(0.3, 0, s * 0.5), outline: false });
    }

    // ---- legs
    for (const [t, sn, ft] of [
      ['thighL', 'shinL', 'footL'],
      ['thighR', 'shinR', 'footR'],
    ]) {
      const thigh = lathe([
        [0.0, -0.41],
        [0.042, -0.4],
        [0.05, -0.32],
        [0.064, -0.12],
        [0.072, -0.03],
        [0.06, 0.03],
        [0.0, 0.05],
      ]);
      this.add(j[t], thigh, c.legs);
      const shin = lathe([
        [0.0, -0.4],
        [0.035, -0.39],
        [0.04, -0.3],
        [0.05, -0.15],
        [0.045, -0.02],
        [0.0, 0.03],
      ]);
      this.add(j[sn], shin, c.legs);
      const boot = lathe([
        [0.0, -0.405],
        [0.04, -0.4],
        [0.046, -0.3],
        [0.055, -0.14],
        [0.06, -0.08],
        [0.05, -0.06],
      ]);
      this.add(j[sn], boot, c.boots);
      const bootTop = new THREE.TorusGeometry(0.055, 0.009, 6, 16);
      bootTop.rotateX(Math.PI / 2);
      this.add(j[sn], bootTop, c.gold, { pos: V3(0, -0.085, 0) });
      const foot = new THREE.SphereGeometry(1, 16, 10);
      foot.scale(0.045, 0.034, 0.1);
      this.add(j[ft], foot, c.boots, { pos: V3(0, -0.025, 0.035) });
    }

    // ---- skirt / coat / cape
    const o = cfg.outfit;
    if (o.skirt) {
      const skirtPivot = new THREE.Group();
      skirtPivot.position.y = 0.04;
      j.hips.add(skirtPivot);
      if (o.skirt === 'pleated') {
        this.add(skirtPivot, skirtGeo(0.118 * sh, 0.25, 0.27, 12, 0.07), c.outfit2, { side: THREE.DoubleSide });
        this.add(skirtPivot, skirtGeo(0.121 * sh, 0.235, 0.21, 12, 0.08), c.outfit, { side: THREE.DoubleSide });
      } else if (o.skirt === 'flare') {
        this.add(skirtPivot, skirtGeo(0.118 * sh, 0.27, 0.24, 9, 0.1), c.outfit2, { side: THREE.DoubleSide });
        this.add(skirtPivot, skirtGeo(0.12 * sh, 0.25, 0.18, 9, 0.06), c.outfit, { side: THREE.DoubleSide });
      } else if (o.skirt === 'long') {
        this.add(skirtPivot, skirtGeo(0.118 * sh, 0.28, 0.5, 8, 0.06), c.outfit, { side: THREE.DoubleSide });
        this.add(skirtPivot, skirtGeo(0.121 * sh, 0.2, 0.16, 8, 0.05), c.outfit2, { side: THREE.DoubleSide });
      } else if (o.skirt === 'coat') {
        this.add(skirtPivot, skirtGeo(0.127 * sh, 0.24, 0.44, 6, 0.05, 0.8, 1.3), c.outfit, { side: THREE.DoubleSide });
        const trim = skirtGeo(0.129 * sh, 0.205, 0.08, 6, 0.0, 0.8, 1.3);
        this.add(skirtPivot, trim, c.outfit2, { side: THREE.DoubleSide, pos: V3(0, -0.36, 0), scale: V3(1.17, 1, 1.17) });
      }
      this.springs.push({ obj: skirtPivot, gain: 0.25, ang: V3(0, 0, 0), vel: V3(0, 0, 0), k: 90, d: 12 });
    }
    if (o.cape) {
      const capePivot = new THREE.Group();
      capePivot.position.set(0, 0.19, -0.02);
      j.chest.add(capePivot);
      this.add(capePivot, capeGeo(0.11, 0.24, 0.52, Math.PI * 0.8), c.outfit2, { side: THREE.DoubleSide });
      this.springs.push({ obj: capePivot, gain: 0.8, ang: V3(0, 0, 0), vel: V3(0, 0, 0), k: 45, d: 7 });
    }
    if (o.coat) {
      // scarf
      const scarf = new THREE.TorusGeometry(0.06, 0.022, 8, 16);
      scarf.rotateX(Math.PI / 2);
      this.add(j.chest, scarf, c.outfit2, { pos: V3(0, 0.205, 0.0) });
      const tailG = strand([V3(0, 0, 0), V3(0.02, -0.05, -0.08), V3(0.05, -0.25, -0.16)], 0.035, 0.008, V3(0, -0.1, 0.2));
      const piv = new THREE.Group();
      piv.position.set(0.03, 0.2, -0.06);
      j.chest.add(piv);
      this.add(piv, withGrad(tailG), c.outfit2, { side: THREE.DoubleSide });
      this.springs.push({ obj: piv, gain: 1.1, ang: V3(0, 0, 0), vel: V3(0, 0, 0), k: 40, d: 6 });
    }

    this.buildWeapon();
    this.buildGlider();
  }

  buildWeapon() {
    const cfg = this.cfg;
    const c = cfg.colors;
    const w = new THREE.Group();
    const el = this.el;
    if (cfg.weapon === 'sword' || cfg.weapon === 'claymore') {
      const { blade, len } = swordGeo(cfg.weapon);
      this.add(w, blade, '#dfe6f2', { spec: 1.2, rim: 0.6 });
      const edge = new THREE.Mesh(blade, glowMaterial(el.color, 0.25));
      edge.scale.set(1.15, 1.0, 1.6);
      w.add(edge);
      const guard = new THREE.BoxGeometry(cfg.weapon === 'claymore' ? 0.22 : 0.15, 0.025, 0.04);
      this.add(w, guard, c.gold, { pos: V3(0, 0.03, 0), spec: 0.8 });
      const grip = new THREE.CylinderGeometry(0.014, 0.014, 0.14, 8);
      this.add(w, grip, c.dark, { pos: V3(0, -0.04, 0) });
      const pommel = new THREE.SphereGeometry(0.02, 10, 8);
      this.add(w, pommel, el.color, { pos: V3(0, -0.12, 0), emissive: 0.8 });
      this.weaponLength = len;
    } else if (cfg.weapon === 'polearm') {
      const shaft = new THREE.CylinderGeometry(0.014, 0.014, 1.7, 8);
      this.add(w, shaft, c.dark, { pos: V3(0, 0.45, 0) });
      const head = new THREE.ConeGeometry(0.04, 0.32, 4);
      head.scale(1, 1, 0.3);
      this.add(w, head, '#e6e0f2', { pos: V3(0, 1.45, 0), spec: 1 });
      const ring = new THREE.TorusGeometry(0.045, 0.012, 6, 16);
      ring.rotateX(Math.PI / 2);
      this.add(w, ring, c.gold, { pos: V3(0, 1.28, 0) });
      const tassel = new THREE.OctahedronGeometry(0.03);
      this.add(w, tassel, el.color, { pos: V3(0, 1.22, 0), emissive: 0.9 });
      this.weaponLength = 1.6;
    } else {
      // catalyst: floating crystal orb
      const orb = new THREE.IcosahedronGeometry(0.07, 1);
      this.add(w, orb, el.color, { emissive: 0.7, spec: 1, rim: 0.8 });
      const ring = new THREE.TorusGeometry(0.11, 0.008, 6, 24);
      this.add(w, ring, c.gold, { spec: 0.8 });
      this.orbRing = w.children[w.children.length - 1];
      this.weaponLength = 0;
    }
    w.visible = false;
    this.weapon = w;
    this.j.handR.add(w);
    if (cfg.weapon === 'catalyst') {
      this.j.handR.remove(w);
      this.root.add(w);
      w.position.set(0.35, 1.2, 0.15);
    } else {
      w.position.set(0, -0.055, 0.01);
      w.rotation.set(Math.PI / 2, 0, 0);
    }
  }

  buildGlider() {
    const c = this.cfg.colors;
    const g = new THREE.Group();
    const shape = new THREE.Shape();
    shape.moveTo(0, 0.06);
    shape.bezierCurveTo(0.35, 0.2, 0.8, 0.16, 1.2, -0.02);
    shape.bezierCurveTo(1.05, -0.1, 0.96, -0.2, 0.94, -0.3);
    shape.quadraticCurveTo(0.8, -0.25, 0.66, -0.4);
    shape.quadraticCurveTo(0.5, -0.32, 0.36, -0.44);
    shape.quadraticCurveTo(0.2, -0.34, 0.0, -0.38);
    shape.lineTo(0, 0.06);
    const geo = new THREE.ShapeGeometry(shape, 14);
    const p = geo.attributes.position;
    const uv = geo.attributes.uv;
    for (let i = 0; i < p.count; i++) uv.setXY(i, p.getX(i) / 1.2, (p.getY(i) + 0.44) / 0.64);
    geo.rotateX(Math.PI / 2);
    // canvas gradient texture
    const cv = document.createElement('canvas');
    cv.width = 256;
    cv.height = 128;
    const x = cv.getContext('2d');
    const gr = x.createLinearGradient(0, 0, 256, 0);
    gr.addColorStop(0, '#f6f2ff');
    gr.addColorStop(0.55, '#c6b8ff');
    gr.addColorStop(1, '#7b6ae0');
    x.fillStyle = gr;
    x.fillRect(0, 0, 256, 128);
    x.strokeStyle = 'rgba(255,255,255,0.85)';
    x.lineWidth = 5;
    for (let i = 0; i < 5; i++) {
      x.beginPath();
      x.moveTo(0, 110);
      x.lineTo(60 + i * 45, 0);
      x.stroke();
    }
    x.fillStyle = 'rgba(255,215,120,0.9)';
    x.fillRect(0, 0, 256, 10);
    const tex = new THREE.CanvasTexture(cv);
    tex.colorSpace = THREE.SRGBColorSpace;
    const m = this.mat('#ffffff', { map: tex, side: THREE.DoubleSide, rim: 0.3 });
    for (const s of [1, -1]) {
      const wing = new THREE.Group();
      wing.scale.x = s;
      wing.rotation.z = s * 0.12;
      g.add(wing);
      this.add(wing, geo, '#ffffff', { material: m, outlineColor: '#3a2f6a', cast: true });
    }
    const bar = new THREE.CylinderGeometry(0.012, 0.012, 0.3, 6);
    bar.rotateZ(Math.PI / 2);
    this.add(g, bar, c.gold, { pos: V3(0, -0.03, -0.05) });
    g.position.set(0, 1.78, 0.32);
    g.scale.setScalar(0.001);
    g.visible = false;
    this.glider = g;
    this.gliderOpen = 0;
    this.root.add(g);
  }

  setFlash(v) {
    for (const m of this.meshes) if (m.material.uniforms && m.material.uniforms.uFlash) m.material.uniforms.uFlash.value = v;
  }

  // ---- animation ----------------------------------------------------------
  update(dt, st) {
    this.t += dt;
    const P = this.pose;
    for (const n of JOINTS) P[n].set(0, 0, 0);
    let hipsY = 0,
      pitch = 0,
      blend = 12;
    const t = this.t;
    const mode = st.mode;
    const sp = st.speed || 0;

    if (mode === 'run' || mode === 'walk') {
      const s = clamp((sp - 2) / 7, 0, 1);
      const stride = 1.1 + sp * 0.42;
      this.phase += (dt * Math.PI * 2 * sp) / stride;
      const ph = this.phase;
      const AL = lerp(0.42, 0.85, s),
        AA = lerp(0.3, 0.95, s);
      for (const [side, thigh, shin, foot, ua, fa, off] of [
        [1, 'thighL', 'shinL', 'footL', 'uArmL', 'fArmL', 0],
        [-1, 'thighR', 'shinR', 'footR', 'uArmR', 'fArmR', Math.PI],
      ]) {
        const p = ph + off;
        P[thigh].x = -AL * Math.sin(p) - 0.08 * s;
        P[shin].x = 0.12 + (0.5 + 1.0 * s) * Math.max(0, Math.cos(p)) + 0.15 * s;
        P[foot].x = -0.25 * Math.sin(p) * s + 0.1;
        P[ua].x = AA * Math.sin(p) * 0.9;
        P[ua].z = side * (0.13 + 0.08 * s);
        P[fa].x = -(0.35 + 0.75 * s) - 0.25 * Math.max(0, -Math.sin(p));
      }
      const lean = lerp(0.07, 0.3, s);
      P.spine.x = lean;
      P.spine.y = 0.14 * Math.sin(ph) * (0.6 + s);
      P.hips.y = -0.12 * Math.sin(ph);
      P.hips.z = 0.04 * Math.sin(ph);
      P.neck.x = -lean * 0.6;
      hipsY = -0.025 - 0.02 * s + (0.035 + 0.03 * s) * Math.abs(Math.sin(ph));
      blend = 14;
    } else if (mode === 'jump' || mode === 'fall') {
      const up = mode === 'jump';
      P.thighL.x = up ? -0.95 : -0.45;
      P.shinL.x = up ? 1.25 : 0.65;
      P.thighR.x = up ? 0.25 : 0.12;
      P.shinR.x = up ? 0.55 : 0.35;
      P.uArmL.z = up ? 0.5 : 1.05;
      P.uArmR.z = up ? -0.5 : -1.05;
      P.uArmL.x = up ? -0.35 : 0.1;
      P.uArmR.x = up ? 0.35 : 0.1;
      P.fArmL.x = -0.6;
      P.fArmR.x = -0.6;
      P.spine.x = up ? 0.12 : -0.06;
      P.neck.x = up ? -0.05 : 0.08;
      blend = 9;
    } else if (mode === 'glide') {
      pitch = 0.95;
      P.uArmL.x = 2.55;
      P.uArmR.x = 2.55;
      P.uArmL.z = 0.32;
      P.uArmR.z = -0.32;
      P.fArmL.x = -0.25;
      P.fArmR.x = -0.25;
      P.thighL.x = 0.25 + Math.sin(t * 2) * 0.05;
      P.thighR.x = 0.32 - Math.sin(t * 2) * 0.05;
      P.shinL.x = 0.35;
      P.shinR.x = 0.45;
      P.neck.x = -0.75;
      P.head.x = -0.2;
      blend = 7;
    } else if (mode === 'climb') {
      if (st.climbMoving) this.phase += dt * 6.5;
      const ph = this.phase;
      const sn = Math.sin(ph);
      P.uArmL.x = -2.55 + 0.45 * sn;
      P.uArmR.x = -2.55 - 0.45 * sn;
      P.uArmL.z = 0.32;
      P.uArmR.z = -0.32;
      P.fArmL.x = -0.55 - 0.35 * Math.max(0, -sn);
      P.fArmR.x = -0.55 - 0.35 * Math.max(0, sn);
      P.thighL.x = -0.75 + 0.45 * sn;
      P.thighR.x = -0.75 - 0.45 * sn;
      P.shinL.x = 1.15 - 0.35 * sn;
      P.shinR.x = 1.15 + 0.35 * sn;
      P.thighL.z = 0.22;
      P.thighR.z = -0.22;
      P.spine.x = 0.12;
      P.neck.x = -0.25;
      hipsY = -0.05;
      blend = 12;
    } else if (mode === 'swim') {
      this.phase += dt * (st.moving ? 4.5 : 1.5);
      const ph = this.phase;
      pitch = st.moving ? 1.2 : 0.35;
      const stroke = Math.sin(ph) * 0.5 + 0.5;
      P.uArmL.x = st.moving ? -2.4 + 0.9 * Math.cos(ph) : -0.4;
      P.uArmR.x = P.uArmL.x;
      P.uArmL.z = 0.35 + 0.7 * stroke;
      P.uArmR.z = -(0.35 + 0.7 * stroke);
      P.fArmL.x = -0.5;
      P.fArmR.x = -0.5;
      P.thighL.x = 0.15 + 0.3 * Math.sin(ph * 2);
      P.thighR.x = 0.15 - 0.3 * Math.sin(ph * 2);
      P.shinL.x = 0.4 + 0.3 * Math.sin(ph * 2 + 1);
      P.shinR.x = 0.4 - 0.3 * Math.sin(ph * 2 + 1);
      P.neck.x = st.moving ? -0.9 : -0.2;
      P.head.x = st.moving ? -0.25 : 0;
      hipsY = Math.sin(t * 2.2) * 0.02;
      blend = 6;
    } else if (mode === 'land') {
      P.thighL.x = -0.75;
      P.thighR.x = -0.6;
      P.shinL.x = 1.2;
      P.shinR.x = 1.05;
      P.footL.x = -0.45;
      P.footR.x = -0.45;
      P.spine.x = 0.35;
      P.uArmL.z = 0.6;
      P.uArmR.z = -0.6;
      P.fArmL.x = -0.5;
      P.fArmR.x = -0.5;
      hipsY = -0.2;
      blend = 22;
    } else {
      // idle
      const b = Math.sin(t * 2.1);
      P.chest.x = 0.025 * b - 0.02;
      P.neck.x = 0.03;
      P.head.x = -0.02 * b;
      P.head.y = 0.12 * Math.sin(t * 0.37);
      P.head.z = 0.04 * Math.sin(t * 0.23);
      P.uArmL.z = 0.11 + 0.012 * b;
      P.uArmR.z = -0.11 - 0.012 * b;
      P.uArmL.x = 0.06;
      P.uArmR.x = 0.06;
      P.fArmL.x = -0.22;
      P.fArmR.x = -0.22;
      P.thighL.z = 0.035;
      P.thighR.z = -0.03;
      P.thighR.x = -0.04;
      P.shinR.x = 0.08;
      P.hips.z = 0.02;
      hipsY = -0.004 * b;
      blend = 6;
    }
    if (st.override) st.override(P, this);

    const a = 1 - Math.exp(-dt * blend);
    const q = this._q || (this._q = new THREE.Quaternion());
    for (const n of JOINTS) {
      q.setFromEuler(P[n]);
      this.j[n].quaternion.slerp(q, a);
    }
    this.j.hips.position.y = damp(this.j.hips.position.y, hipsY, 18, dt);
    this.body.rotation.x = damp(this.body.rotation.x, pitch, 7, dt);
    this.body.rotation.z = damp(this.body.rotation.z, st.lean || 0, 6, dt);

    // glider open/close
    const wantG = mode === 'glide' ? 1 : 0;
    this.gliderOpen = damp(this.gliderOpen, wantG, wantG ? 10 : 14, dt);
    this.glider.visible = this.gliderOpen > 0.02;
    const gs = smoothstep(0, 1, this.gliderOpen);
    this.glider.scale.set(gs, 0.4 + 0.6 * gs, gs);

    // catalyst orb bob
    if (this.cfg.weapon === 'catalyst' && this.weapon.visible) {
      this.weapon.position.y = 1.25 + Math.sin(t * 2.5) * 0.05;
      this.weapon.rotation.y += dt * 1.5;
    }

    // secondary motion
    this.updateSprings(dt, st);

    // blinking
    this.blinkT -= dt;
    if (this.blinkT < 0) {
      this.faceMat.uniforms.uMap.value = this.faceClosed;
      if (this.blinkT < -0.12) {
        this.faceMat.uniforms.uMap.value = this.faceOpen;
        this.blinkT = 2 + Math.random() * 3.5;
      }
    }
  }

  updateSprings(dt, st) {
    const fwd = st.localVel ? st.localVel.z : 0;
    const side = st.localVel ? st.localVel.x : 0;
    const vy = st.localVel ? st.localVel.y : 0;
    let tx = clamp(fwd * 0.07 + Math.max(-vy, 0) * 0.05, -0.2, 1.0);
    if (st.mode === 'glide') tx = 1.0;
    if (st.mode === 'swim') tx = 0.3;
    const tz = clamp(-side * 0.05, -0.4, 0.4);
    const steps = Math.min(4, Math.ceil(dt / (1 / 120)));
    const h = dt / steps;
    for (const s of this.springs) {
      const targetX = tx * s.gain + Math.sin(this.t * 1.7 + s.gain) * 0.02;
      const targetZ = tz * s.gain;
      for (let i = 0; i < steps; i++) {
        s.vel.x += (s.k * (targetX - s.ang.x) - s.d * s.vel.x) * h;
        s.vel.z += (s.k * (targetZ - s.ang.z) - s.d * s.vel.z) * h;
        s.ang.x += s.vel.x * h;
        s.ang.z += s.vel.z * h;
      }
      s.obj.rotation.x = clamp(s.ang.x, -0.5, 1.3);
      s.obj.rotation.z = clamp(s.ang.z, -0.6, 0.6);
    }
  }
}
