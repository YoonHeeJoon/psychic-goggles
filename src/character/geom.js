import * as THREE from 'three';
import { mergeVertices } from 'three/addons/utils/BufferGeometryUtils.js';

const V3 = (x, y, z) => new THREE.Vector3(x, y, z);
const DEG = Math.PI / 180;

// ---------------------------------------------------------------------------
// geometry helpers
// ---------------------------------------------------------------------------
export function lathe(profile, segs = 22) {
  return new THREE.LatheGeometry(
    profile.map(([r, y]) => new THREE.Vector2(Math.max(r, 1e-4), y)),
    segs
  );
}

export function smooth(geo) {
  geo.deleteAttribute('normal');
  if (geo.attributes.uv) geo.deleteAttribute('uv');
  const g = mergeVertices(geo, 1e-5);
  g.computeVertexNormals();
  return g;
}

export function sph(elevDeg, azDeg, r) {
  const e = elevDeg * DEG,
    a = azDeg * DEG;
  return V3(Math.sin(a) * Math.cos(e) * r, Math.sin(e) * r, Math.cos(a) * Math.cos(e) * r);
}

// Flat-ish hair ribbon with elliptical cross-section following a curve.
// `center` orients the flat side outward from the head.
export function strand(points, width, thick, center, opts = {}) {
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

export function withGrad(geo, value = 0) {
  const n = geo.attributes.position.count;
  geo.setAttribute('aGrad', new THREE.Float32BufferAttribute(new Float32Array(n).fill(value), 1));
  if (!geo.attributes.uv) geo.setAttribute('uv', new THREE.Float32BufferAttribute(new Float32Array(n * 2), 2));
  return geo;
}

