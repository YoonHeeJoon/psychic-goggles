import * as THREE from 'three';
import { mergeGeometries, mergeVertices } from 'three/addons/utils/BufferGeometryUtils.js';
import { strand } from './geom.js';
import { headPoint } from './Face.js';
import { mulberry32, smoothstep, lerp } from '../core/noise.js';

// Anime hair built from locks: a scalp cap with ridges running down from the
// crown, a layered fringe whose locks start at the parting and end in sharp
// tips over the brows, side locks framing the face, a layer of crown locks
// for volume and long back locks that hang from the nape (on a spring chain).
// Everything is built in head-radius units around the head centre and scaled
// to size at the end.

const DEG = Math.PI / 180;
const V3 = (x = 0, y = 0, z = 0) => new THREE.Vector3(x, y, z);

// elevation (deg) of the hairline at an azimuth (deg, 0 = front)
const HAIRLINE = [
  [0, 33],
  [30, 29],
  [52, 16],
  [78, -6],
  [96, -20],
  [128, -32],
  [180, -48],
];
export function hairlineEl(azDeg) {
  const a = Math.min(180, Math.abs(azDeg));
  for (let i = 1; i < HAIRLINE.length; i++) {
    const [a0, e0] = HAIRLINE[i - 1],
      [a1, e1] = HAIRLINE[i];
    if (a <= a1) {
      const t = (a - a0) / (a1 - a0);
      return lerp(e0, e1, t * t * (3 - 2 * t) * 0.5 + t * 0.5);
    }
  }
  return HAIRLINE[HAIRLINE.length - 1][1];
}

function hash(s) {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) h = Math.imul(h ^ s.charCodeAt(i), 16777619);
  return h >>> 0;
}

// scalp cap: meridians from the crown down to the hairline, with soft ridges
function capGeo(fem, ridges) {
  const NA = 96,
    NV = 26;
  const pos = [];
  const idx = [];
  const v = V3();
  for (let j = 0; j <= NV; j++) {
    const s = j / NV;
    for (let i = 0; i < NA; i++) {
      const azd = -180 + (i / NA) * 360;
      const el = lerp(90, hairlineEl(azd) - 1.5, Math.pow(s, 0.9));
      headPoint(azd * DEG, el * DEG, fem, v);
      const tuck = smoothstep(1.0, 0.8, s);
      const ridge = Math.pow(Math.abs(Math.sin((azd * DEG * ridges) / 2)), 0.55);
      const sc = 1.012 + 0.048 * tuck + 0.02 * ridge * Math.sin(Math.PI * Math.min(1, s * 1.15)) * tuck;
      pos.push(v.x * sc, v.y * sc, v.z * sc);
    }
  }
  for (let j = 0; j < NV; j++)
    for (let i = 0; i < NA; i++) {
      const a = j * NA + i,
        b = j * NA + ((i + 1) % NA),
        c = (j + 1) * NA + i,
        d = (j + 1) * NA + ((i + 1) % NA);
      idx.push(a, c, b, b, c, d);
    }
  let g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setIndex(idx);
  g = mergeVertices(g, 1e-6);
  g.computeVertexNormals();
  const n = g.attributes.position.count;
  g.setAttribute('aGrad', new THREE.Float32BufferAttribute(new Float32Array(n), 1));
  g.setAttribute('uv', new THREE.Float32BufferAttribute(new Float32Array(n * 2), 2));
  return g;
}

// a lock that hugs the head: (az, el, scale) waypoints in degrees
function lock(fem, way, width, thick, opts = {}) {
  const pts = way.map((w) => (w.isVector3 ? w.clone() : headPoint(w[0] * DEG, w[1] * DEG, fem).multiplyScalar(w[2])));
  return strand(pts, width, thick, opts.center || V3(0, 0, 0), opts);
}

export function buildHair(cfg) {
  const H = cfg.hair;
  const fem = cfg.female;
  const rand = mulberry32(hash(cfg.id || 'x'));
  const jit = (a) => (rand() - 0.5) * 2 * a;
  const spiky = !!H.spiky;
  const front = [],
    back = [],
    tail = [];
  const tailAnchors = [];

  front.push(capGeo(fem, spiky ? 22 : 18));

  // ---- fringe
  const partAz = H.part === 'center' ? 0 : H.part === 'none' ? 0 : 24;
  const nb = H.bangs;
  const tips = [];
  for (let layer = 0; layer < 2; layer++) {
    const n = layer ? nb : nb - 1;
    for (let i = 0; i < n; i++) {
      let f = (i + (layer ? 0 : 0.5)) / (nb - 1);
      f = f * 2 - 1;
      const af = Math.abs(f);
      const azT = f * 66 + jit(4) + (H.part === 'side' ? -f * 4 + 6 * (1 - af) : 0);
      // lengths: outer locks frame the temples, inner ones alternate long and short
      let elT;
      if (af > 0.8) elT = -12 - rand() * 10;
      else if (layer && i % 2 === 0) elT = -2 + jit(3);
      else elT = 8 + jit(3);
      if (layer === 0) elT += 4;
      if (spiky) elT += 8 + af * 6;
      const azR = partAz + (azT - partAz) * 0.3;
      const swoop = H.part === 'side' ? (azT - partAz) * 0.1 : 0;
      const hl = hairlineEl(azT);
      const s0 = layer ? 1.08 : 1.06;
      const way = [
        [azR, 74, 1.0],
        [lerp(azR, azT, 0.55) + swoop, 52, s0 + 0.03],
        [azT * 0.97 + swoop * 0.5, hl + 3, s0 + 0.075 + (spiky ? 0.05 : 0)],
        [azT, lerp(hl, elT, 0.55), s0 + 0.06 + (spiky ? 0.06 : 0)],
        [azT + (spiky ? f * 8 : f * 2), elT, s0 + 0.035 + (spiky ? 0.08 + af * 0.08 : 0)],
      ];
      front.push(lock(fem, way, (af > 0.8 ? 0.2 : 0.27) * (layer ? 1 : 1.25), layer ? 0.07 : 0.055));
      if (layer && af <= 0.8) tips.push(Math.sin(elT * DEG));
    }
  }
  const fringe = tips.length ? tips.reduce((a, b) => a + b, 0) / tips.length : 0.12;

  // ---- side locks framing the face
  const sideLen = spiky ? 1.0 : Math.min(2.9, 0.95 + H.length * 0.45);
  for (const s of [-1, 1]) {
    for (let k = 0; k < 2; k++) {
      const az = s * (70 + k * 16);
      const len = sideLen * (k ? 0.82 : 1) * (0.95 + rand() * 0.1);
      const p3 = headPoint(s * (86 + k * 12) * DEG, -26 * DEG, fem).multiplyScalar(1.12);
      const way = [[az, 40, 1.04], [s * (82 + k * 10), 6, 1.1], p3, V3(s * (0.93 + k * 0.05), -0.6 - len * 0.55, p3.z + 0.05), V3(s * (0.86 + k * 0.08), -0.35 - len, p3.z + 0.12 - k * 0.1)];
      front.push(lock(fem, way, 0.26 - k * 0.04, 0.07, { segs: 16 }));
    }
  }

  // ---- crown locks for volume (the sides and top; the fringe covers the front)
  const nCrown = 12;
  for (let k = 0; k < nCrown; k++) {
    const azT = -180 + ((k + 0.5) / nCrown) * 360 + jit(6);
    if (Math.abs(azT) < 52) continue;
    const elT = Math.max(hairlineEl(azT) + 6, 8) + jit(6);
    const way = [[azT * 0.6, 84, 1.0], [azT, 55, 1.075], [azT + jit(5), (55 + elT) / 2, 1.09], [azT + jit(8), elT, 1.07]];
    front.push(lock(fem, way, 0.46, 0.06, { segs: 10 }));
  }

  // ---- ahoge
  if (H.ahoge) {
    // a springy cowlick curling forward off the crown
    front.push(strand([V3(0, 1.0, -0.05), V3(0.02, 1.28, 0.02), V3(0.06, 1.46, 0.22), V3(0.1, 1.4, 0.42), V3(0.12, 1.26, 0.5)], 0.1, 0.035, V3(0, 1.1, 0.2), { segs: 14 }));
  }

  // ---- back locks: over the back of the head, then hanging from the nape
  const L = H.length;
  const long = L > 1.7;
  for (let layer = 0; layer < 2; layer++) {
    const n = layer ? 13 : 10;
    for (let i = 0; i < n; i++) {
      const f = (i + (layer ? 0 : 0.5)) / (layer ? n - 1 : n);
      let az = lerp(102, 258, f) + jit(4);
      if (az > 180) az -= 360;
      const dx = Math.sin(az * DEG),
        dz = Math.cos(az * DEG);
      const sideness = Math.abs(dx);
      const s0 = layer ? 1.1 : 1.07;
      const p0 = headPoint(az * DEG, 66 * DEG, fem).multiplyScalar(1.02);
      const p1 = headPoint(az * DEG, 18 * DEG, fem).multiplyScalar(s0 + 0.02);
      const p2 = headPoint(az * DEG, -30 * DEG, fem).multiplyScalar(s0);
      let pts;
      if (long) {
        // V-shaped hem: centre locks longest
        const len = L * (0.82 + 0.2 * (1 - sideness) + jit(0.08)) * (layer ? 1 : 0.9) * (spiky ? 0.8 : 1);
        // hang clear of the back (and of a cape, if there is one)
        const cape = cfg.outfit && cfg.outfit.cape;
        const outX = dx * (0.18 + 0.1 * layer),
          outZ = (cape ? -1.25 : -0.45) - sideness * 0.3 - layer * 0.08;
        pts = [p0, p1, p2, V3(p2.x + outX * 0.6, p2.y - len * 0.35, p2.z + outZ * 0.7), V3(p2.x + outX, p2.y - len, p2.z + outZ)];
      } else {
        const len = Math.max(0.35, L * 0.55) * (0.9 + rand() * 0.25);
        pts = [p0, p1, p2, V3(p2.x + dx * 0.08, p2.y - len, p2.z + dz * 0.1 - 0.05)];
      }
      back.push(strand(pts, (long ? 0.44 : 0.38) * (layer ? 1 : 1.2), layer ? 0.1 : 0.08, V3(0, p2.y - 0.6, 0), { segs: long ? 16 : 10 }));
    }
  }

  // ---- tails
  if (H.tail === 'pony') {
    const A = headPoint(Math.PI, 30 * DEG, fem).multiplyScalar(1.06);
    tailAnchors.push(A);
    for (let i = 0; i < 9; i++) {
      const dx = jit(0.28);
      const len = 3.4 + jit(0.4);
      const pts = [V3(dx * 0.3, 0, 0), V3(dx * 0.6, 0.14, -0.42), V3(dx * 1.1, -0.9, -0.95), V3(dx * 1.4, -len * 0.72, -1.0), V3(dx * 1.6, -len, -0.85)];
      tail.push({ anchor: 0, g: strand(pts, 0.36, 0.13, V3(0, -1.4, 0.4), { segs: 16 }) });
    }
  } else if (H.tail === 'twin') {
    for (const s of [-1, 1]) {
      const A = headPoint(s * 102 * DEG, 36 * DEG, fem).multiplyScalar(1.05);
      tailAnchors.push(A);
      for (let i = 0; i < 6; i++) {
        const dz = jit(0.2);
        const pts = [V3(0, 0, dz * 0.3), V3(s * 0.42, 0.1, -0.18 + dz), V3(s * 0.75, -1.4, -0.35 + dz), V3(s * 0.7, -2.6, -0.3 + dz * 1.2), V3(s * 0.6, -3.5, -0.2 + dz * 1.4)];
        tail.push({ anchor: tailAnchors.length - 1, g: strand(pts, 0.33, 0.12, V3(s * -0.4, -1.5, 0), { segs: 16 }) });
      }
    }
  }

  // head-space position (unit radius) for the angel-ring highlight
  const headAttr = (g, off) => {
    const p = g.attributes.position;
    const a = new Float32Array(p.count * 3);
    for (let i = 0; i < p.count; i++) {
      a[i * 3] = p.getX(i) + off.x;
      a[i * 3 + 1] = p.getY(i) + off.y;
      a[i * 3 + 2] = p.getZ(i) + off.z;
    }
    g.setAttribute('aHead', new THREE.BufferAttribute(a, 3));
    return g;
  };
  const O = V3();
  return {
    front: headAttr(mergeGeometries(front), O),
    back: headAttr(mergeGeometries(back), O),
    tails: tailAnchors.map((A, k) => ({ anchor: A, geo: headAttr(mergeGeometries(tail.filter((t) => t.anchor === k).map((t) => t.g)), A) })),
    fringe,
  };
}
