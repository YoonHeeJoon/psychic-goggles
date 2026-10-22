import * as THREE from 'three';
import { smooth } from './geom.js';
import { clamp, smoothstep, lerp } from '../core/noise.js';

// Anime head and face. The head is a sphere reshaped into a soft cranium, a
// flat face and a narrow V-shaped jaw with a forward chin. The face is drawn
// straight onto the head in its shader from a few small textures:
//  - a shared feature mask per eye style (r: lash/line ink, g: brows,
//    b: blush, a: eye whites), one with open eyes and one with closed lids
//  - a per-character iris that slides around inside the eye whites (the eyes
//    can look at things)
//  - a shared atlas of mouth shapes (expressions).
// Coordinates are head space in units of the head radius, +z forward, +x the
// character's left.

const DEG = Math.PI / 180;

export const FACE = {
  // planar projection window
  u0: -0.8,
  u1: 0.8,
  v0: -1.0,
  v1: 0.4,
  eyeX: 0.37,
  eyeY: -0.2,
  mouthY: -0.69,
  noseY: -0.47,
};
const PX = 560; // texels per head radius
const TW = Math.round((FACE.u1 - FACE.u0) * PX);
const TH = Math.round((FACE.v1 - FACE.v0) * PX);

// eye shapes: w/h of the opening, tilt (outer corner up), lash weight, wing
// length, iris radii
export const EYE_STYLES = {
  round: { w: 0.44, h: 0.4, tilt: 0.03, lash: 0.052, wing: 0.1, lower: 0.55, rx: 0.152, ry: 0.198, brow: 0.026, browLift: 0.16, browArch: 0.05 },
  sharp: { w: 0.45, h: 0.32, tilt: 0.12, lash: 0.058, wing: 0.13, lower: 0.4, rx: 0.145, ry: 0.18, brow: 0.026, browLift: 0.13, browArch: 0.035 },
  soft: { w: 0.44, h: 0.37, tilt: -0.04, lash: 0.048, wing: 0.07, lower: 0.65, rx: 0.15, ry: 0.19, brow: 0.024, browLift: 0.17, browArch: 0.06 },
  male: { w: 0.41, h: 0.29, tilt: 0.06, lash: 0.05, wing: 0.035, lower: 0.35, rx: 0.13, ry: 0.16, brow: 0.042, browLift: 0.12, browArch: 0.02 },
  maleSharp: { w: 0.43, h: 0.26, tilt: 0.14, lash: 0.054, wing: 0.05, lower: 0.3, rx: 0.126, ry: 0.15, brow: 0.046, browLift: 0.1, browArch: 0.01 },
  elder: { w: 0.37, h: 0.2, tilt: -0.02, lash: 0.04, wing: 0.0, lower: 0.25, rx: 0.11, ry: 0.13, brow: 0.05, browLift: 0.11, browArch: 0.03 },
};

export function eyeStyleOf(cfg) {
  const f = cfg.face && cfg.face.eye;
  if (f && EYE_STYLES[f]) return f;
  return cfg.female ? 'round' : 'male';
}

// ---------------------------------------------------------------------------
// head shape
// ---------------------------------------------------------------------------
// (xn, zn): unit direction of the horizontal cross-section, ys: sphere height
export function headShape(xn, zn, ys, fem, out) {
  let Y, w, c, df, db;
  if (ys >= 0) {
    const r0 = Math.sqrt(Math.max(0, 1 - ys * ys));
    Y = ys * (1 + 0.04 * ys);
    w = 0.9 * r0;
    df = 0.95 * r0;
    db = 1.06 * r0;
    c = 0;
  } else {
    const t = -ys;
    Y = ys * (1 + 0.1 * t);
    const cut = Math.sqrt(Math.max(0, 1 - Math.pow(t, 7)));
    w = 0.9 * (1 - (fem ? 0.84 : 0.72) * Math.pow(t, fem ? 2.2 : 2.6)) * cut;
    c = (fem ? 0.5 : 0.44) * t * t;
    df = 0.95 * Math.sqrt(Math.max(0, 1 - Math.pow(t, 2.3)));
    db = 1.06 * (1 - Math.pow(t, 1.6));
  }
  // the front half of each cross-section is a superellipse: a flatter face
  const n = 2 + 0.9 * smoothstep(0.85, 0.2, ys) * smoothstep(-1.0, -0.62, ys);
  let x = xn,
    z = zn;
  if (zn > 0) {
    const e = 2 / n;
    x = Math.sign(xn) * Math.pow(Math.abs(xn), e);
    z = Math.pow(zn, e);
  }
  const X = x * w;
  let Z = zn > 0 ? c + z * df : c + z * db;
  // a small nose
  if (zn > 0) Z += 0.034 * Math.exp(-((X / 0.065) ** 2) - ((Y + 0.46) / 0.1) ** 2);
  return out.set(X, Y, Z);
}

// point on the head surface at azimuth / elevation (radians, az 0 = front)
export function headPoint(az, el, fem, out = new THREE.Vector3()) {
  return headShape(Math.sin(az), Math.cos(az), Math.sin(el), fem, out);
}

export function buildHeadGeo(R, fem) {
  const g = new THREE.SphereGeometry(1, 72, 56);
  const p = g.attributes.position;
  const uv = g.attributes.uv;
  const v = new THREE.Vector3();
  for (let i = 0; i < p.count; i++) {
    const phi = uv.getX(i) * Math.PI * 2;
    const theta = (1 - uv.getY(i)) * Math.PI;
    headShape(-Math.cos(phi), Math.sin(phi), Math.cos(theta), fem, v);
    p.setXYZ(i, v.x * R, v.y * R, v.z * R);
  }
  return smooth(g);
}

// ---------------------------------------------------------------------------
// textures
// ---------------------------------------------------------------------------
function canvas(w, h) {
  const cv = document.createElement('canvas');
  cv.width = w;
  cv.height = h;
  return cv;
}

// a 2D context drawing in head space (y up, units of head radius)
function headCtx(cv) {
  const g = cv.getContext('2d');
  g.setTransform(PX, 0, 0, -PX, -FACE.u0 * PX, FACE.v1 * PX);
  g.lineCap = 'round';
  g.lineJoin = 'round';
  return g;
}

const bez = (p0, p1, p2, p3, t) => {
  const u = 1 - t;
  return [u * u * u * p0[0] + 3 * u * u * t * p1[0] + 3 * u * t * t * p2[0] + t * t * t * p3[0], u * u * u * p0[1] + 3 * u * u * t * p1[1] + 3 * u * t * t * p2[1] + t * t * t * p3[1]];
};

function eyeCurves(S) {
  const w = S.w,
    h = S.h;
  const I = [-0.5 * w, -0.1 * h];
  const O = [0.5 * w, 0.0 * h];
  const up = [I, [-0.44 * w, 0.46 * h], [0.2 * w, 0.66 * h], O];
  const lo = [O, [0.44 * w, -0.4 * h], [-0.16 * w, -0.6 * h], I];
  return { I, O, up, lo };
}

// polygon hugging a bezier: thickness(t) outward (+normal) and inward
function ribbon(g, curve, t0, t1, thick, inner = 0.15, n = 28) {
  const pts = [],
    ins = [];
  for (let k = 0; k <= n; k++) {
    const t = lerp(t0, t1, k / n);
    const a = bez(...curve, Math.max(0, t - 0.01));
    const b = bez(...curve, Math.min(1, t + 0.01));
    const p = bez(...curve, t);
    let nx = -(b[1] - a[1]),
      ny = b[0] - a[0];
    const l = Math.hypot(nx, ny) || 1;
    nx /= l;
    ny /= l;
    const th = thick(k / n);
    pts.push([p[0] + nx * th, p[1] + ny * th]);
    ins.push([p[0] - nx * th * inner, p[1] - ny * th * inner]);
  }
  g.beginPath();
  g.moveTo(...pts[0]);
  for (const q of pts) g.lineTo(...q);
  for (let k = ins.length - 1; k >= 0; k--) g.lineTo(...ins[k]);
  g.closePath();
  g.fill();
}

// one layer per channel, packed into an RGBA mask afterwards
function drawMask(style, fem, closed) {
  const S = EYE_STYLES[style];
  const layers = { ink: canvas(TW, TH), brow: canvas(TW, TH), blush: canvas(TW, TH), white: canvas(TW, TH) };
  const ctx = {};
  for (const k in layers) {
    ctx[k] = headCtx(layers[k]);
    ctx[k].fillStyle = ctx[k].strokeStyle = '#fff';
  }
  const { I, O, up, lo } = eyeCurves(S);
  for (const side of [-1, 1]) {
    for (const k in ctx) {
      const g = ctx[k];
      g.save();
      g.translate(FACE.eyeX * side, FACE.eyeY);
      g.scale(side, 1); // +x = outer corner
      g.rotate(S.tilt);
    }
    const ink = ctx.ink,
      wh = ctx.white;
    if (!closed) {
      // eye white
      wh.beginPath();
      wh.moveTo(...I);
      wh.bezierCurveTo(...up[1], ...up[2], ...up[3]);
      wh.bezierCurveTo(...lo[1], ...lo[2], ...lo[3]);
      wh.closePath();
      wh.fill();
      // upper lash line: thin at the inner corner, heavy towards the outer
      ribbon(ink, up, 0.02, 1, (t) => S.lash * (0.28 + 0.72 * smoothstep(0, 0.7, t)) * (1 - 0.25 * smoothstep(0.9, 1, t)), 0.18);
      // the outer wing
      const tip = [0.5 * S.w + S.wing * 0.7 + 0.015, S.h * 0.14 + S.wing * 0.35];
      const a = bez(...up, 0.72);
      ink.beginPath();
      ink.moveTo(a[0], a[1] + S.lash * 0.9);
      ink.quadraticCurveTo(O[0] + 0.02, O[1] + S.lash * 1.4, tip[0], tip[1]);
      ink.quadraticCurveTo(O[0] + 0.01, O[1] + S.lash * 0.2, O[0] - 0.01, O[1] - S.lash * 0.35);
      ink.closePath();
      ink.fill();
      // dark outer corner where the lids meet
      ink.beginPath();
      ink.moveTo(O[0] + 0.012, O[1] + 0.01);
      ink.quadraticCurveTo(O[0] - 0.02, O[1] - S.h * 0.22, O[0] - 0.07, O[1] - S.h * 0.33);
      ink.lineTo(O[0] - 0.04, O[1] - S.h * 0.1);
      ink.closePath();
      ink.fill();
      // inner corner hook
      ink.lineWidth = S.lash * 0.35;
      ink.beginPath();
      ink.moveTo(I[0] + 0.03, I[1] + S.h * 0.18);
      ink.quadraticCurveTo(I[0] - 0.005, I[1] + 0.02, I[0] + 0.02, I[1] - 0.025);
      ink.stroke();
      // lower lash, outer half
      ink.globalAlpha = 0.7;
      ribbon(ink, lo, 0.0, S.lower, (t) => S.lash * 0.3 * (1 - t * 0.85), 0.0);
      // double-lid crease
      ink.globalAlpha = 0.32;
      const crease = up.map(([x, y], k) => [x * (k === 0 ? 0.6 : 1.03), y + S.h * 0.17 + (k === 3 ? 0.01 : 0)]);
      ribbon(ink, crease, 0.25, 0.95, (t) => 0.007 * Math.sin(t * Math.PI), 0.5);
      ink.globalAlpha = 1;
    } else {
      // closed lids: a soft downward curve with lashes at the outer end
      const c = [I, [-0.18 * S.w, -0.26 * S.h], [0.26 * S.w, -0.2 * S.h], [O[0], O[1] - 0.01]];
      ribbon(ink, c, 0.02, 1, (t) => S.lash * 0.6 * (0.4 + 0.6 * smoothstep(0, 0.7, t)), 0.4);
      ink.lineWidth = S.lash * 0.35;
      for (const k of [0.62, 0.8, 0.95]) {
        const p = bez(...c, k);
        ink.beginPath();
        ink.moveTo(p[0], p[1]);
        ink.lineTo(p[0] + 0.02 + k * 0.02, p[1] - 0.035);
        ink.stroke();
      }
    }
    // brow: tapered arc above the eye
    const b = ctx.brow;
    const by = S.h * 0.5 + S.browLift;
    const bc = [
      [-0.46 * S.w, by - 0.01],
      [-0.2 * S.w, by + S.browArch + 0.02],
      [0.25 * S.w, by + S.browArch + 0.02],
      [0.62 * S.w, by - 0.045],
    ];
    ribbon(b, bc, 0, 1, (t) => S.brow * (1 - 0.72 * t) * smoothstep(0, 0.12, t + 0.05), 1.0);
    for (const k in ctx) ctx[k].restore();
  }
  // blush with a few hatch strokes
  const bl = ctx.blush;
  for (const side of [-1, 1]) {
    const x = 0.5 * side,
      y = -0.47;
    bl.save();
    bl.translate(x, y);
    bl.scale(1.35, 0.7);
    const rg = bl.createRadialGradient(0, 0, 0, 0, 0, 0.16);
    rg.addColorStop(0, `rgba(255,255,255,${fem ? 0.55 : 0.28})`);
    rg.addColorStop(1, 'rgba(255,255,255,0)');
    bl.fillStyle = rg;
    bl.beginPath();
    bl.arc(0, 0, 0.16, 0, Math.PI * 2);
    bl.fill();
    bl.restore();
    if (fem) {
      bl.strokeStyle = 'rgba(255,255,255,0.75)';
      bl.lineWidth = 0.009;
      for (let k = -1; k <= 1; k++) {
        const cx = x + k * 0.045 * side;
        bl.beginPath();
        bl.moveTo(cx - 0.012, y - 0.03);
        bl.lineTo(cx + 0.018, y + 0.035);
        bl.stroke();
      }
    }
  }
  // nose: a tiny tick on one side
  const ink = ctx.ink;
  ink.globalAlpha = 0.45;
  ink.lineWidth = 0.013;
  ink.beginPath();
  ink.moveTo(0.035, FACE.noseY + 0.02);
  ink.quadraticCurveTo(0.03, FACE.noseY - 0.03, 0.0, FACE.noseY - 0.045);
  ink.stroke();
  ink.globalAlpha = 1;

  // pack the layers' coverage into one RGBA mask (raw data: a canvas would
  // premultiply and lose the colour channels where the alpha is zero). The
  // closed-eye variant only differs in its ink, so it is a single channel.
  // Rows are flipped so v grows upwards like head-space y.
  const read = (k) => layers[k].getContext('2d').getImageData(0, 0, TW, TH).data;
  const L = closed ? { r: read('ink') } : { r: read('ink'), g: read('brow'), b: read('blush'), a: read('white') };
  const C = closed ? 1 : 4;
  const d = new Uint8Array(TW * TH * C);
  for (let y = 0; y < TH; y++) {
    const src = (TH - 1 - y) * TW * 4,
      dst = y * TW * C;
    for (let x = 0, o = dst; x < TW * 4; x += 4, o += C) {
      d[o] = L.r[src + x + 3];
      if (!closed) {
        d[o + 1] = L.g[src + x + 3];
        d[o + 2] = L.b[src + x + 3];
        d[o + 3] = L.a[src + x + 3];
      }
    }
  }
  const tex = new THREE.DataTexture(d, TW, TH, closed ? THREE.RedFormat : THREE.RGBAFormat, THREE.UnsignedByteType);
  tex.colorSpace = THREE.NoColorSpace;
  tex.wrapS = tex.wrapT = THREE.ClampToEdgeWrapping;
  tex.magFilter = THREE.LinearFilter;
  tex.minFilter = THREE.LinearMipmapLinearFilter;
  tex.generateMipmaps = true;
  tex.unpackAlignment = 1;
  tex.anisotropy = 8;
  tex.needsUpdate = true;
  return tex;
}

const maskCache = new Map();
export function faceMasks(style, fem) {
  const key = style + (fem ? 'f' : 'm');
  if (!maskCache.has(key)) maskCache.set(key, { open: drawMask(style, fem, false), closed: drawMask(style, fem, true) });
  return maskCache.get(key);
}

function css(hex, k = 1) {
  const c = new THREE.Color(hex);
  c.convertLinearToSRGB();
  return `rgb(${Math.round(clamp(c.r * k, 0, 1) * 255)},${Math.round(clamp(c.g * k, 0, 1) * 255)},${Math.round(clamp(c.b * k, 0, 1) * 255)})`;
}

// a layered anime iris: dark top under the lid, bright lower crescent,
// fine radial streaks, pupil, and two catch-lights
export function irisTexture(cfg) {
  const N = 256;
  const cv = canvas(N, N);
  const g = cv.getContext('2d');
  const col = cfg.colors;
  const c = N / 2,
    R = N * 0.47;
  g.save();
  g.beginPath();
  g.arc(c, c, R, 0, Math.PI * 2);
  g.clip();
  const lg = g.createLinearGradient(0, c - R, 0, c + R);
  lg.addColorStop(0, css(col.eye, 0.22));
  lg.addColorStop(0.32, css(col.eye, 0.55));
  lg.addColorStop(0.62, css(col.eye, 1.0));
  lg.addColorStop(1, css(col.eye2, 1.05));
  g.fillStyle = lg;
  g.fillRect(0, 0, N, N);
  // lower crescent glow
  const rg = g.createRadialGradient(c, c + R * 0.62, 0, c, c + R * 0.62, R * 0.75);
  rg.addColorStop(0, css(col.eye2, 1.2));
  rg.addColorStop(1, 'rgba(255,255,255,0)');
  g.globalAlpha = 0.85;
  g.fillStyle = rg;
  g.fillRect(0, 0, N, N);
  // radial streaks
  g.globalAlpha = 0.22;
  g.lineWidth = 2.2;
  for (let k = 0; k < 44; k++) {
    const a = (k / 44) * Math.PI * 2 + (k % 3) * 0.03;
    g.strokeStyle = k % 2 ? css(col.eye2, 1.1) : css(col.eye, 0.35);
    g.beginPath();
    g.moveTo(c + Math.cos(a) * R * 0.3, c + Math.sin(a) * R * 0.34);
    g.lineTo(c + Math.cos(a) * R * (0.78 + (k % 4) * 0.05), c + Math.sin(a) * R * (0.78 + (k % 4) * 0.05));
    g.stroke();
  }
  g.globalAlpha = 1;
  // ring around the pupil
  g.strokeStyle = css(col.eye2, 1.0);
  g.globalAlpha = 0.35;
  g.lineWidth = 7;
  g.beginPath();
  g.ellipse(c, c - R * 0.06, R * 0.36, R * 0.42, 0, 0, Math.PI * 2);
  g.stroke();
  g.globalAlpha = 1;
  // pupil
  const pg = g.createRadialGradient(c, c - R * 0.06, 0, c, c - R * 0.06, R * 0.32);
  pg.addColorStop(0, css(col.eye, 0.1));
  pg.addColorStop(1, css(col.eye, 0.22));
  g.fillStyle = pg;
  g.beginPath();
  g.ellipse(c, c - R * 0.06, R * 0.24, R * 0.31, 0, 0, Math.PI * 2);
  g.fill();
  // dark rim
  g.restore();
  g.strokeStyle = css(col.eye, 0.18);
  g.lineWidth = R * 0.075;
  g.beginPath();
  g.arc(c, c, R - R * 0.035, 0, Math.PI * 2);
  g.stroke();
  // catch-lights
  g.fillStyle = '#ffffff';
  g.save();
  g.translate(c - R * 0.36, c - R * 0.36);
  g.rotate(-0.5);
  g.beginPath();
  g.ellipse(0, 0, R * 0.25, R * 0.17, 0, 0, Math.PI * 2);
  g.fill();
  g.restore();
  g.globalAlpha = 0.9;
  g.beginPath();
  g.arc(c + R * 0.34, c + R * 0.42, R * 0.085, 0, Math.PI * 2);
  g.fill();
  // a tiny four-point sparkle
  g.globalAlpha = 0.85;
  const sx = c + R * 0.08,
    sy = c + R * 0.55,
    s = R * 0.12;
  g.beginPath();
  g.moveTo(sx, sy - s);
  g.quadraticCurveTo(sx, sy, sx + s * 0.6, sy);
  g.quadraticCurveTo(sx, sy, sx, sy + s);
  g.quadraticCurveTo(sx, sy, sx - s * 0.6, sy);
  g.quadraticCurveTo(sx, sy, sx, sy - s);
  g.fill();
  g.globalAlpha = 1;
  const tex = new THREE.CanvasTexture(cv);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.wrapS = tex.wrapT = THREE.ClampToEdgeWrapping;
  return tex;
}

// mouth shapes: 0 resting smile, 1 open smile (talking), 2 open shout,
// 3 hurt / effort (teeth)
export const MOUTH = { hw: 0.13, hh: 0.08 };
let mouthTex = null;
export function mouthAtlas() {
  if (mouthTex) return mouthTex;
  const CW = 208,
    CH = 128;
  const cv = canvas(CW * 4, CH);
  const g = cv.getContext('2d');
  g.lineCap = 'round';
  g.lineJoin = 'round';
  const line = '#7a3a3e',
    inside = '#5a1e2a',
    tongue = '#e0707a',
    teeth = '#fbf6f4';
  const cell = (k, f) => {
    g.save();
    g.translate(CW * k + CW / 2, CH / 2);
    // head units: the cell spans 2*hw x 2*hh
    g.scale(CW / (2 * MOUTH.hw), -CH / (2 * MOUTH.hh));
    f();
    g.restore();
  };
  // resting: small soft smile
  cell(0, () => {
    g.strokeStyle = line;
    g.lineWidth = 0.011;
    g.beginPath();
    g.moveTo(-0.045, 0.006);
    g.quadraticCurveTo(0, -0.018, 0.045, 0.006);
    g.stroke();
  });
  // talking / happy: a small open "D"
  cell(1, () => {
    g.fillStyle = inside;
    g.beginPath();
    g.moveTo(-0.05, 0.012);
    g.quadraticCurveTo(0, 0.004, 0.05, 0.012);
    g.quadraticCurveTo(0.03, -0.05, 0, -0.052);
    g.quadraticCurveTo(-0.03, -0.05, -0.05, 0.012);
    g.fill();
    g.save();
    g.clip();
    g.fillStyle = tongue;
    g.beginPath();
    g.ellipse(0, -0.05, 0.03, 0.022, 0, 0, Math.PI * 2);
    g.fill();
    g.fillStyle = teeth;
    g.fillRect(-0.05, 0.0, 0.1, 0.012);
    g.restore();
    g.strokeStyle = line;
    g.lineWidth = 0.007;
    g.stroke();
  });
  // shout: rounded open triangle
  cell(2, () => {
    g.fillStyle = inside;
    g.beginPath();
    g.moveTo(-0.05, 0.02);
    g.quadraticCurveTo(0, 0.03, 0.05, 0.02);
    g.quadraticCurveTo(0.045, -0.06, 0, -0.068);
    g.quadraticCurveTo(-0.045, -0.06, -0.05, 0.02);
    g.fill();
    g.save();
    g.clip();
    g.fillStyle = tongue;
    g.beginPath();
    g.ellipse(0, -0.068, 0.035, 0.028, 0, 0, Math.PI * 2);
    g.fill();
    g.fillStyle = teeth;
    g.fillRect(-0.05, 0.008, 0.1, 0.014);
    g.restore();
    g.strokeStyle = line;
    g.lineWidth = 0.007;
    g.stroke();
  });
  // hurt: clenched teeth, corners pulled down
  cell(3, () => {
    g.fillStyle = teeth;
    g.beginPath();
    g.moveTo(-0.055, -0.012);
    g.quadraticCurveTo(0, 0.018, 0.055, -0.012);
    g.quadraticCurveTo(0, -0.03, -0.055, -0.012);
    g.fill();
    g.strokeStyle = line;
    g.lineWidth = 0.008;
    g.stroke();
    g.lineWidth = 0.004;
    g.beginPath();
    g.moveTo(-0.05, -0.008);
    g.lineTo(0.05, -0.008);
    g.stroke();
  });
  mouthTex = new THREE.CanvasTexture(cv);
  mouthTex.colorSpace = THREE.SRGBColorSpace;
  mouthTex.wrapS = mouthTex.wrapT = THREE.ClampToEdgeWrapping;
  mouthTex.anisotropy = 4;
  return mouthTex;
}

// GLSL: composite the face onto the skin albedo (needs vHead)
export const FACE_TEX_GLSL = /* glsl */ `
uniform sampler2D uFaceMask;
uniform sampler2D uFaceClosed;
uniform sampler2D uIris;
uniform sampler2D uMouthTex;
uniform vec4 uFaceWin;    // u0, v0, 1/(u1-u0), 1/(v1-v0)
uniform vec4 uEye;        // eye x, eye y, iris rx, iris ry
uniform vec3 uEyeShape;   // eye height, tilt, unused
uniform vec4 uMouthRect;  // x, y, half w, half h
uniform vec2 uLook;
uniform float uBlink;
uniform float uMouth;
uniform vec3 uInkCol;
uniform vec3 uBrowCol;
uniform vec3 uBlushCol;
uniform vec3 uFringe;     // fringe tip height, wave count, strength
vec3 faceComposite(vec3 skin, out float featK, out float hairSh){
  vec3 h = vHead;
  float front = smoothstep(0.12, 0.4, h.z);
  vec2 fuv = (h.xy - uFaceWin.xy) * uFaceWin.zw;
  vec4 m = texture2D(uFaceMask, fuv);
  m.r = mix(m.r, texture2D(uFaceClosed, fuv).r, uBlink);
  m.a *= 1.0 - uBlink;
  m *= front;
  vec3 col = skin;
  col = mix(col, col * uBlushCol, m.b);
  // eyes: whites with lid shadow, the iris slides inside
  float side = h.x >= 0.0 ? 1.0 : -1.0;
  vec2 ec = vec2(uEye.x * side, uEye.y);
  vec2 el = h.xy - ec;
  float ct = cos(uEyeShape.y), st = sin(uEyeShape.y);
  float ly = (-el.x * side * st + el.y * ct) / uEyeShape.x;
  vec3 white = mix(vec3(1.0, 0.99, 1.0), vec3(0.7, 0.66, 0.84), smoothstep(0.0, 0.42, ly));
  vec2 iq = (el - uLook) / uEye.zw;
  vec4 ir = texture2D(uIris, clamp(iq * 0.5 + 0.5, 0.0, 1.0));
  ir.a *= step(max(abs(iq.x), abs(iq.y)), 1.0);
  vec3 irisCol = ir.rgb * mix(1.0, 0.5, smoothstep(0.05, 0.45, ly));
  col = mix(col, mix(white, irisCol, ir.a), m.a);
  // mouth
  vec2 mq = (h.xy - uMouthRect.xy) / uMouthRect.zw;
  float inM = step(max(abs(mq.x), abs(mq.y)), 1.0);
  vec4 mt = texture2D(uMouthTex, vec2((uMouth + clamp(mq.x, -1.0, 1.0) * 0.5 + 0.5) * 0.25, clamp(mq.y, -1.0, 1.0) * 0.5 + 0.5));
  col = mix(col, mt.rgb, mt.a * inM * front);
  col = mix(col, uBrowCol, m.g);
  col = mix(col, uInkCol, m.r);
  featK = max(m.a, max(m.r, m.g) * 0.8);
  // soft shadow of the fringe on the forehead
  float zig = abs(fract(h.x * uFringe.y * 0.5 + 0.25) - 0.5) * 2.0;
  hairSh = smoothstep(uFringe.x - 0.2, uFringe.x - 0.06, h.y + zig * 0.07) * front * uFringe.z;
  return col;
}
`;

export function faceUniforms(cfg, fem) {
  const style = eyeStyleOf(cfg);
  const S = EYE_STYLES[style];
  const masks = faceMasks(style, fem);
  const c = cfg.colors;
  const hair = new THREE.Color(c.hair);
  const hsl = {};
  hair.getHSL(hsl);
  const brow = new THREE.Color().setHSL(hsl.h, Math.min(1, hsl.s * 0.9 + 0.05), Math.min(hsl.l * 0.55, 0.42));
  const ink = new THREE.Color('#2a1a24').lerp(new THREE.Color().setHSL(hsl.h, 0.5, 0.18), 0.35);
  return {
    style,
    uniforms: {
      uFaceMask: { value: masks.open },
      uFaceClosed: { value: masks.closed },
      uIris: { value: irisTexture(cfg) },
      uMouthTex: { value: mouthAtlas() },
      uFaceWin: { value: new THREE.Vector4(FACE.u0, FACE.v0, 1 / (FACE.u1 - FACE.u0), 1 / (FACE.v1 - FACE.v0)) },
      uEye: { value: new THREE.Vector4(FACE.eyeX, FACE.eyeY, S.rx, S.ry) },
      uEyeShape: { value: new THREE.Vector3(S.h, S.tilt, 0) },
      uMouthRect: { value: new THREE.Vector4(0, FACE.mouthY, MOUTH.hw, MOUTH.hh) },
      uLook: { value: new THREE.Vector2() },
      uBlink: { value: 0 },
      uMouth: { value: 0 },
      uInkCol: { value: ink },
      uBrowCol: { value: brow },
      uBlushCol: { value: new THREE.Color('#ff9a9a') },
      uFringe: { value: new THREE.Vector3(0.14, (cfg.hair && cfg.hair.bangs) || 9, 0.55) },
    },
  };
}
