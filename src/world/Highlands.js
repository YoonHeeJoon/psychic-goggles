import * as THREE from 'three';
import { Builder, M, box, cyl, beam, between } from './Structures.js';
import { BRIDGE, PORT, PORT_LOTS, PORT_LEN, PORT_DIR, CAMPS, portWorld, townHeight } from './Terrain.js';
import { mulberry32 } from '../core/noise.js';

// The autumn highlands' buildings: the long rope bridge over the gorge, the
// terraced harbour town with its quay, pier, boats and lighthouse, and the
// goblin camps with their watchtowers. Built into the Structures batches.

const V3 = THREE.Vector3;
const Y = new V3(0, 1, 0);
const TAU = Math.PI * 2;
const ROPE = '#8a6a44';
const PORT_ROOFS = ['#2e6f8e', '#c25a3a', '#3f8a78', '#d08b3a', '#7a4a8a', '#2e6f8e', '#c25a3a', '#3f8a78'];
const PORT_ACCENT = ['#2e6f8e', '#a8473a', '#3d7a5a', '#c9963a', '#5b7fb5', '#7a5a9a', '#3d7a5a', '#a8473a'];

// basis matrix: local z along `fwd`, local y up-ish
function basis(pos, fwd) {
  const f = fwd.clone().normalize();
  const r = new V3().crossVectors(Y, f).normalize();
  const u = new V3().crossVectors(f, r);
  return new THREE.Matrix4().makeBasis(r, u, f).setPosition(pos);
}

export function buildHighlands(S) {
  const rand = mulberry32(909);
  buildBridge(S, rand);
  buildPort(S, rand);
  for (const c of CAMPS) buildCamp(S, c, rand);
}

// ---------------------------------------------------------------- bridge
function buildBridge(S, rand) {
  const T = S.terrain;
  const b = new Builder();
  const A = new V3(BRIDGE.ax, T.heightAt(BRIDGE.ax, BRIDGE.az) + 0.3, BRIDGE.az);
  const B = new V3(BRIDGE.bx, T.heightAt(BRIDGE.bx, BRIDGE.bz) + 0.3, BRIDGE.bz);
  const flat = new V3(B.x - A.x, 0, B.z - A.z);
  const L = flat.length();
  flat.normalize();
  const side = new V3(-flat.z, 0, flat.x);
  const yaw = Math.atan2(flat.x, flat.z);
  const sag = 1.5;
  const deck = (t) => new V3(A.x + (B.x - A.x) * t, A.y + (B.y - A.y) * t - Math.sin(t * Math.PI) * sag, A.z + (B.z - A.z) * t);
  S.bridge = { A, B, L, deck, yaw };

  // planks
  const n = Math.round(L / 0.48);
  for (let i = 0; i <= n; i++) {
    const t = i / n;
    const p = deck(t);
    const tan = deck(Math.min(1, t + 0.01)).sub(deck(Math.max(0, t - 0.01)));
    const m = basis(p, tan);
    m.multiply(M(0, -0.12, 0, (rand() - 0.5) * 0.04, (rand() - 0.5) * 0.06, (rand() - 0.5) * 0.03));
    b.add('wood', box(2.3 + (rand() - 0.5) * 0.2, 0.1, 0.36), { m, color: rand() < 0.15 ? '#7a5636' : '#9a7048', uvScale: 0.8 });
  }
  // two stringers under the planks
  const seg = 24;
  const pts = (off, dy, extraSag = 0) => {
    const out = [];
    for (let k = 0; k <= seg; k++) {
      const t = k / seg;
      const p = deck(t).addScaledVector(side, off);
      p.y += dy - Math.sin(t * Math.PI) * extraSag;
      out.push(p);
    }
    return out;
  };
  const rope = (list, r) => {
    for (let k = 0; k < list.length - 1; k++) b.add('plain', between(list[k], list[k + 1], r, r, 5), { color: ROPE });
  };
  for (const s of [-1, 1]) {
    const under = pts(s * 0.95, -0.2);
    for (let k = 0; k < under.length - 1; k++) b.add('wood', beam(under[k], under[k + 1], 0.14, 0.14), { color: '#5d4130' });
    const top = pts(s * 1.18, 1.05, 0.25);
    const low = pts(s * 1.18, 0.05);
    rope(top, 0.04);
    rope(low, 0.03);
    // hangers + a lattice of side ropes
    for (let k = 0; k <= seg; k++) {
      rope([top[k], low[k]], 0.022);
      if (k < seg) rope([top[k], low[k + 1]], 0.015);
    }
  }
  // anchor posts with stone footings at both ends
  for (const [P, dir] of [
    [A, -1],
    [B, 1],
  ]) {
    for (const s of [-1, 1]) {
      const q = P.clone().addScaledVector(side, s * 1.4).addScaledVector(flat, dir * 0.6);
      const gy = T.heightAt(q.x, q.z);
      b.add('stone', cyl(0.5, 0.62, 0.7, 8), { m: M(q.x, gy - 0.3, q.z), color: '#b9b1a0' });
      b.add('wood', cyl(0.17, 0.2, 2.6, 8), { m: M(q.x, gy, q.z), color: '#6b4a33' });
      b.add('wood', new THREE.ConeGeometry(0.2, 0.35, 8), { m: M(q.x, gy + 2.75, q.z), color: '#6b4a33' });
      // ropes tie into the post tops
      const topEnd = P.clone().addScaledVector(side, s * 1.18);
      topEnd.y += 1.05;
      rope([topEnd, new V3(q.x, gy + 2.3, q.z)], 0.045);
      S.solids.addCircle(q.x, q.z, 0.25, gy + 2.6);
    }
    T.addBlocker(P.x - flat.x * dir * 3, P.z - flat.z * dir * 3, 7);
    S.area({ x: P.x - flat.x * dir * 4, z: P.z - flat.z * dir * 4, r: 4, soft: 3, grass: 0.4, color: '#9c8160' });
  }
  // walkable deck: short thin segments following the sag
  const nSeg = Math.ceil(L / 1.6);
  for (let k = 0; k < nSeg; k++) {
    const t0 = k / nSeg,
      t1 = (k + 1) / nSeg;
    const p = deck((t0 + t1) / 2);
    S.solids.addBox(p.x, p.z, 1.15, (L / nSeg) * 0.55, yaw, p.y - 0.05, true);
  }
  b.build(S.mats, S.group);
}

// ------------------------------------------------------------------ port
function buildPort(S, rand) {
  const T = S.terrain;
  const b = new Builder();
  const W = (s, t) => portWorld(s, t);
  const L = PORT_LEN;
  S.port = { lots: [], boats: [] };

  // houses on their terraces, each pad edged with a stone retaining wall
  PORT_LOTS.forEach((lot, i) => {
    S.buildHouse(b, { x: lot.x, z: lot.z, rot: lot.rot, w: lot.w, d: lot.d, floors: lot.floors, roof: PORT_ROOFS[i % PORT_ROOFS.length], accent: PORT_ACCENT[i % PORT_ACCENT.length], rand });
    const hs = lot.w / 2 + 2.2,
      ht = lot.d / 2 + 2.6;
    const F = S.frame(lot.x, lot.h, lot.z, PORT_DIR);
    const at = (m) => F.clone().multiply(m);
    for (const sg of [-1, 1]) {
      b.add('stone', box(ht * 2 + 0.6, 5, 0.6), { m: at(M(0, -4.65, sg * hs)), color: '#c9bfa8', uvScale: 0.45 });
      b.add('stone', box(0.6, 5, hs * 2 + 0.6), { m: at(M(sg * ht, -4.65, 0)), color: '#c9bfa8', uvScale: 0.45 });
    }
    // flower boxes / pots on the terrace
    for (let k = 0; k < 2; k++) {
      const m = at(M((rand() - 0.5) * ht * 1.4, 0, (k ? 1 : -1) * (hs - 0.9)));
      b.add('plain', cyl(0.28, 0.22, 0.4, 10), { m, color: '#b8643a' });
      b.add('plain', new THREE.IcosahedronGeometry(0.32, 1), { m: m.clone().multiply(M(0, 0.55, 0)), color: rand() < 0.5 ? '#d9572e' : '#e8b23a' });
    }
    S.port.lots.push(lot);
    S.area({ x: lot.x, z: lot.z, hw: ht + 0.2, hd: hs + 0.2, rot: PORT_DIR, soft: 0.8, grass: 0.15, color: '#b7a17c' });
  });

  // cobbled ramp street and plaza draped on the terrain
  const drape = (s0, s1, t0, t1, ns, nt) => {
    const pos = [],
      idx = [];
    for (let i = 0; i <= ns; i++)
      for (let j = 0; j <= nt; j++) {
        const [x, z] = W(s0 + ((s1 - s0) * i) / ns, t0 + ((t1 - t0) * j) / nt);
        pos.push(x, T.heightAt(x, z) + 0.05, z);
      }
    for (let i = 0; i < ns; i++)
      for (let j = 0; j < nt; j++) {
        const a = i * (nt + 1) + j,
          c = a + nt + 1;
        idx.push(a, a + 1, c, c, a + 1, c + 1);
      }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
    g.setIndex(idx);
    g.computeVertexNormals();
    const nn = g.attributes.normal;
    for (let k = 0; k < nn.count; k++) if (nn.getY(k) < 0) nn.setXYZ(k, -nn.getX(k), -nn.getY(k), -nn.getZ(k));
    return g;
  };
  const pb = new Builder();
  pb.add('cobble', drape(-6, L - 7, -3.4, 3.4, 60, 6), { color: '#ddd3c0', uvScale: 1 / 3 });
  pb.add('cobble', drape(L - 9, L + 13.5, -15, 15, 24, 30), { color: '#e2dccf', uvScale: 1 / 3 });
  pb.build(S.mats, S.group, { castShadow: false });
  {
    const [x, z] = W((L - 13) / 2, 0);
    S.area({ x, z, hw: 4.4, hd: (L + 1) / 2, rot: PORT_DIR, soft: 1.2, grass: 0, color: '#a69c88' });
    const [px, pz] = W(L + 2.5, 0);
    S.area({ x: px, z: pz, hw: 15.5, hd: 11.5, rot: PORT_DIR, soft: 1.5, grass: 0, color: '#a69c88' });
  }
  for (let s = -8; s <= L + 16; s += 7) {
    const [x, z] = W(s, 0);
    T.addBlocker(x, z, 19);
  }

  // street lamps with lantern strings across the street
  for (const s of [5, 19, 33, 47]) {
    const tops = [];
    for (const t of [-4.4, 4.4]) {
      const [x, z] = W(s, t);
      tops.push(S.buildLamp(b, x, z, PORT_DIR + (t > 0 ? -Math.PI / 2 : Math.PI / 2)));
    }
    stringLanterns(b, tops[0], tops[1], 0.9);
    S.buildBunting(b, tops[0].clone().add(new V3(0, -0.15, 0)), tops[1].clone().add(new V3(0, -0.15, 0)), rand, 1.2);
  }

  // quay wall, bollards and harbour clutter
  {
    const [qx, qz] = W(L + 14, 0);
    const F = S.frame(qx, 0, qz, PORT_DIR);
    const at = (m) => F.clone().multiply(m);
    b.add('stone', box(31, 8, 1.4), { m: at(M(0, -4.6, 0)), color: '#c4bba8', uvScale: 0.42 });
    b.add('stone', box(31.4, 0.3, 1.6), { m: at(M(0, 3.3, 0)), color: '#b3aa96' });
    for (let k = -3; k <= 3; k++) {
      if (k === 0) continue;
      b.add('metal', cyl(0.18, 0.22, 0.55, 10), { m: at(M(k * 4.2, 3.55, -0.2)), color: '#3b3a3f' });
      b.add('metal', new THREE.SphereGeometry(0.22, 10, 6), { m: at(M(k * 4.2, 4.1, -0.2)), color: '#3b3a3f' });
    }
  }
  for (const [s, t] of [
    [L + 4, -11],
    [L + 6, 10.5],
  ]) {
    const [x, z] = W(s, t);
    S.buildStall(b, x, z, PORT_DIR + Math.PI + (t > 0 ? -0.5 : 0.5), rand);
  }
  for (let k = 0; k < 16; k++) {
    const s = L - 4 + rand() * 16,
      t = (rand() < 0.5 ? -1 : 1) * (6 + rand() * 8);
    const [x, z] = W(s, t);
    if (S.solids.near(x, z, 1.0)) continue;
    const y = T.heightAt(x, z);
    if (rand() < 0.45) {
      b.add('wood', new THREE.CylinderGeometry(0.42, 0.36, 1.0, 12), { m: M(x, y + 0.5, z), color: '#8a5a36' });
      b.add('metal', new THREE.CylinderGeometry(0.43, 0.43, 0.08, 12, 1, true), { m: M(x, y + 0.3, z), color: '#4a4a52' });
      b.add('metal', new THREE.CylinderGeometry(0.43, 0.43, 0.08, 12, 1, true), { m: M(x, y + 0.75, z), color: '#4a4a52' });
      S.solids.addCircle(x, z, 0.45, y + 1.0);
    } else {
      const sz = 0.6 + rand() * 0.4;
      b.add('wood', box(sz, sz, sz), { m: M(x, y - 0.02, z, 0, rand() * 3), color: '#b08452' });
      S.solids.addCircle(x, z, sz * 0.55, y + sz);
    }
  }
  // fishing nets drying between poles
  for (const [s, t] of [
    [L - 2, 13],
    [L + 9, -13.5],
  ]) {
    const [x, z] = W(s, t);
    const y = T.heightAt(x, z);
    const F = S.frame(x, y, z, PORT_DIR + Math.PI / 2);
    const at = (m) => F.clone().multiply(m);
    for (const sx of [-1.6, 1.6]) b.add('wood', cyl(0.07, 0.08, 2.4, 6), { m: at(M(sx, 0, 0)), color: '#6b4a33' });
    const g = new THREE.PlaneGeometry(3.2, 1.6, 6, 3);
    const p = g.attributes.position;
    for (let k = 0; k < p.count; k++) p.setZ(k, Math.sin((p.getX(k) / 3.2) * Math.PI) * 0.15 - (1 - Math.abs(p.getY(k) / 0.8)) * 0.05);
    b.add('cloth', g, { m: at(M(0, 1.45, 0)), color: '#5d6a5a', extraFn: (xx, yy) => (0.8 - yy) * 0.12 });
  }

  // pier on posts, out into the harbour basin
  {
    const s0 = L + 13.6,
      s1 = L + 44,
      t = 3;
    const yTop = 3.05;
    const len = s1 - s0;
    const [cx, cz] = W((s0 + s1) / 2, t);
    const F = S.frame(cx, 0, cz, PORT_DIR);
    const at = (m) => F.clone().multiply(m);
    const n = Math.round(len / 0.45);
    for (let k = 0; k <= n; k++) b.add('wood', box(3.2, 0.12, 0.4), { m: at(M((rand() - 0.5) * 0.06, yTop - 0.12, -len / 2 + (k * len) / n, 0, (rand() - 0.5) * 0.04, 0)), color: rand() < 0.2 ? '#7a5a3c' : '#a07650', uvScale: 0.8 });
    for (let z = -len / 2 + 1; z <= len / 2; z += 3)
      for (const sx of [-1.5, 1.5]) b.add('wood', cyl(0.16, 0.18, yTop + 8, 8), { m: at(M(sx, -8, z)), color: '#5d4130' });
    for (const sx of [-1.55, 1.55]) b.add('wood', box(0.14, 0.14, len), { m: at(M(sx, yTop - 0.3, 0)), color: '#5d4130' });
    // rope rail on the open side
    for (let z = -len / 2 + 2; z <= len / 2; z += 4) b.add('wood', cyl(0.07, 0.08, 1.0, 6), { m: at(M(-1.5, yTop, z)), color: '#6b4a33' });
    S.solids.addBox(cx, cz, 1.6, len / 2, PORT_DIR, yTop, true);
    S.pier = { s0, s1, t, y: yTop };
  }

  // lighthouse on the harbour mouth
  {
    const [x, z] = W(L + 17, -19.5);
    const base = -6;
    const F = S.frame(x, 0, z, 0);
    const at = (m) => F.clone().multiply(m);
    b.add('stone', cyl(3.2, 3.6, 9.4 + 0.2, 16), { m: at(M(0, base, 0)), color: '#b9b1a0', uvScale: 0.45 });
    b.add('plaster', cyl(1.55, 2.0, 9, 16), { m: at(M(0, 3.6, 0)), color: '#f4efe2', uvScale: 0.42 });
    for (const y of [5.6, 8.6]) b.add('plain', cyl(1.75 - (y - 3.6) * 0.05, 1.8 - (y - 3.6) * 0.05, 0.9, 16), { m: at(M(0, y, 0)), color: '#c2453a' });
    b.add('stone', cyl(1.9, 1.9, 0.35, 16), { m: at(M(0, 12.6, 0)), color: '#8f8778' });
    b.add('lamp', cyl(1.0, 1.0, 1.4, 12), { m: at(M(0, 12.95, 0)), color: '#fff2c8', extra: 1 });
    for (let k = 0; k < 6; k++) {
      const a = (k / 6) * TAU;
      b.add('metal', cyl(0.05, 0.05, 1.5, 4), { m: at(M(Math.cos(a) * 1.15, 12.95, Math.sin(a) * 1.15)), color: '#2d2d33' });
    }
    b.add('roof', new THREE.ConeGeometry(1.5, 1.6, 12), { m: at(M(0, 15.15, 0)), color: '#2e6f8e', uv: 'local', uvScale: 0.6 });
    b.add('metal', new THREE.SphereGeometry(0.18, 8, 6), { m: at(M(0, 16.05, 0)), color: '#c9a050' });
    S.solids.addCircle(x, z, 3.4, 3.6);
    S.lighthouse = new V3(x, 13.6, z);
    S.lighthouseBase = new V3(x, 3.6, z);
    S.beacon = makeBeacon(S, S.lighthouse);
  }
  b.build(S.mats, S.group);

  // boats bob on their own groups
  addBoat(S, W(L + 26, 7.2), PORT_DIR + 0.08, '#2e6f8e', rand);
  addBoat(S, W(L + 36, -1.4), PORT_DIR - 0.1, '#c25a3a', rand);
  addBoat(S, W(L + 20, -6), PORT_DIR + Math.PI * 0.55, '#3f8a78', rand);
  S.ship = addShip(S, W(L + 160, -40), PORT_DIR + Math.PI);
  S.ship.berth = { pos: new V3(...withY(W(L + 33, -9.5), 0)), yaw: PORT_DIR + Math.PI * 0.5 };
  S.ship.sea = { pos: S.ship.group.position.clone(), yaw: S.ship.group.rotation.y };
}

// the lighthouse light: a glow and two sweeping beams, faded in when lit
function makeBeacon(S, at) {
  const grp = new THREE.Group();
  grp.position.copy(at);
  const cv = document.createElement('canvas');
  cv.width = cv.height = 64;
  const g = cv.getContext('2d');
  const gr = g.createRadialGradient(32, 32, 0, 32, 32, 32);
  gr.addColorStop(0, 'rgba(255,255,255,1)');
  gr.addColorStop(0.3, 'rgba(255,240,200,0.5)');
  gr.addColorStop(1, 'rgba(255,220,160,0)');
  g.fillStyle = gr;
  g.fillRect(0, 0, 64, 64);
  const tex = new THREE.CanvasTexture(cv);
  const glowMat = new THREE.SpriteMaterial({ map: tex, color: new THREE.Color('#ffe2a0').multiplyScalar(2.2), transparent: true, opacity: 0, blending: THREE.AdditiveBlending, depthWrite: false, fog: false });
  const glow = new THREE.Sprite(glowMat);
  glow.scale.setScalar(9);
  glow.renderOrder = 6;
  grp.add(glow);
  const beamMat = new THREE.ShaderMaterial({
    uniforms: { uK: { value: 0 }, uColor: { value: new THREE.Color('#ffe9b8') } },
    vertexShader: `varying vec2 vUv; void main(){ vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }`,
    fragmentShader: `uniform float uK; uniform vec3 uColor; varying vec2 vUv;
      void main(){ float a = pow(vUv.y, 1.6) * uK * 0.35; gl_FragColor = vec4(uColor * a, a); }`,
    transparent: true,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
    side: THREE.DoubleSide,
  });
  const spin = new THREE.Group();
  grp.add(spin);
  for (const s of [1, -1]) {
    const cone = new THREE.ConeGeometry(3.2, 46, 20, 1, true);
    cone.translate(0, -23, 0);
    const m = new THREE.Mesh(cone, beamMat);
    m.rotation.z = (s * Math.PI) / 2;
    m.rotation.x = 0.06;
    m.renderOrder = 6;
    spin.add(m);
  }
  S.group.add(grp);
  return { grp, glow, spin, beamMat, k: 0, target: 0 };
}

export function setBeacon(S, on, instant = false) {
  if (!S.beacon) return;
  S.beacon.target = on ? 1 : 0;
  if (instant) S.beacon.k = S.beacon.target;
}

function withY([x, z], y) {
  return [x, y, z];
}

// paper lanterns hanging along a sagging rope
function stringLanterns(b, A, B, sag) {
  const n = 7;
  for (let i = 1; i < n; i++) {
    const t = i / n;
    const p = new V3().lerpVectors(A, B, t);
    p.y -= Math.sin(t * Math.PI) * sag + 0.32;
    b.add('lamp', new THREE.SphereGeometry(0.2, 10, 8), { m: M(p.x, p.y, p.z, 0, 0, 0, 1, 1.25, 1), color: i % 2 ? '#ffb08a' : '#ffd38a', extra: 1 });
    b.add('metal', cyl(0.13, 0.13, 0.06, 8), { m: M(p.x, p.y + 0.22, p.z), color: '#3a2a22' });
  }
}

function hullGeo(len, wid, dep) {
  const g = new THREE.SphereGeometry(1, 18, 10, 0, TAU, Math.PI / 2, Math.PI / 2);
  const p = g.attributes.position;
  for (let i = 0; i < p.count; i++) {
    const z = p.getZ(i);
    // pointed bow (+z), fuller stern
    const k = z > 0 ? 1 - Math.pow(z, 2.2) * 0.65 : 1 - Math.pow(-z, 3) * 0.25;
    p.setX(i, p.getX(i) * k);
  }
  g.scale(wid / 2, dep, len / 2);
  g.computeVertexNormals();
  return g;
}

function addBoat(S, [x, z], yaw, stripe, rand) {
  const b = new Builder();
  const len = 5.2 + rand() * 1.2,
    wid = 1.9,
    dep = 0.85;
  b.add('wood', hullGeo(len, wid, dep), { m: M(0, 0.3, 0), color: '#8a5a36', uvScale: 0.9 });
  const rim = new THREE.TorusGeometry(1, 0.06, 6, 28);
  rim.rotateX(Math.PI / 2);
  b.add('wood', rim, { m: M(0, 0.3, 0, 0, 0, 0, wid / 2 - 0.02, 1, len / 2 - 0.1), color: stripe });
  for (const zz of [-0.9, 0.5]) b.add('wood', box(wid * 0.85, 0.08, 0.32), { m: M(0, 0.05, zz * len * 0.4), color: '#a07650' });
  b.add('wood', cyl(0.06, 0.07, 3.6, 6), { m: M(0, -0.2, len * 0.12), color: '#6b4a33' });
  b.add('sail', cyl(0.13, 0.13, 2.2, 8), { m: M(0, 1.2, len * 0.12 - 0.12, 0.08, 0, 0), color: '#efe6d2' });
  const grp = new THREE.Group();
  grp.position.set(x, 0, z);
  grp.rotation.y = yaw;
  b.build(S.mats, grp);
  S.group.add(grp);
  S.port.boats.push({ grp, ph: rand() * TAU, amp: 0.05 + rand() * 0.04 });
}

// a two-masted trading ship (sails in during the port quest)
function addShip(S, [x, z], yaw) {
  const b = new Builder();
  const len = 15,
    wid = 4.6,
    dep = 2.0;
  b.add('wood', hullGeo(len, wid, dep), { m: M(0, 0.9, 0), color: '#6e4630', uvScale: 0.6 });
  b.add('wood', box(wid * 0.82, 0.25, len * 0.84), { m: M(0, 0.75, -0.2), color: '#a07650', uvScale: 0.8 });
  const rim = new THREE.TorusGeometry(1, 0.1, 6, 36);
  rim.rotateX(Math.PI / 2);
  b.add('plain', rim, { m: M(0, 1.05, 0, 0, 0, 0, wid / 2 - 0.05, 1, len / 2 - 0.2), color: '#2e6f8e' });
  b.add('wood', box(wid * 0.7, 1.4, 3.0), { m: M(0, 0.95, -len * 0.33), color: '#8a5a36' });
  b.add('roof', box(wid * 0.78, 0.18, 3.3), { m: M(0, 2.35, -len * 0.33), color: '#c25a3a', uv: 'local', uvScale: 0.6 });
  for (const [mz, mh, sw] of [
    [len * 0.16, 9.5, 4.6],
    [-len * 0.12, 8.0, 3.9],
  ]) {
    b.add('wood', cyl(0.14, 0.18, mh, 8), { m: M(0, 0.9, mz), color: '#5d4130' });
    for (const [sy, sh, k] of [
      [mh * 0.42, mh * 0.34, 1],
      [mh * 0.78, mh * 0.2, 0.75],
    ]) {
      b.add('wood', cyl(0.07, 0.07, sw * k + 0.4, 6), { m: M(-(sw * k + 0.4) / 2, 0.9 + sy + sh / 2, mz, 0, 0, -Math.PI / 2), color: '#5d4130' });
      const g = new THREE.PlaneGeometry(sw * k, sh, 6, 4);
      const p = g.attributes.position;
      for (let i = 0; i < p.count; i++) {
        const u = p.getX(i) / (sw * k),
          v = p.getY(i) / sh;
        p.setZ(i, Math.cos(u * Math.PI) * 0.45 * (0.6 + (0.5 - v) * 0.6));
      }
      g.computeVertexNormals();
      b.add('sail', g, { m: M(0, 0.9 + sy, mz + 0.25), color: '#f2ead8' });
    }
    b.add('cloth', new THREE.PlaneGeometry(1.1, 0.5), { m: M(0.55, 0.9 + mh + 0.2, mz, 0, Math.PI / 2, 0), color: '#c25a3a', extraFn: (xx) => (xx + 0.55) * 0.5 });
  }
  b.add('wood', cyl(0.1, 0.14, 5, 6), { m: M(0, 1.6, len * 0.42, -1.1, 0, 0), color: '#5d4130' });
  const grp = new THREE.Group();
  grp.position.set(x, 0, z);
  grp.rotation.y = yaw;
  b.build(S.mats, grp);
  S.group.add(grp);
  const ship = { group: grp, ph: 0, amp: 0.12 };
  S.port.boats.push({ grp, ph: 1.3, amp: 0.1, ship: true });
  return ship;
}

// ------------------------------------------------------------------ camps
function buildCamp(S, c, rand) {
  const T = S.terrain;
  const b = new Builder();
  const y = T.heightAt(c.x, c.z);
  c.y = y;
  S.area({ x: c.x, z: c.z, r: 11, soft: 4, grass: 0.35, color: '#9a7a52' });
  T.addBlocker(c.x, c.z, 15);

  // watchtower: plank-walled lower storey, open lookout, hide roof
  const tx = c.x + 4.5,
    tz = c.z - 3.5;
  const ty = T.heightAt(tx, tz) - 0.2;
  const F = S.frame(tx, ty, tz, rand() * TAU);
  const at = (m) => F.clone().multiply(m);
  const H = 4.4;
  for (const sx of [-1, 1])
    for (const sz of [-1, 1]) b.add('wood', cyl(0.16, 0.2, H + 3.0, 7), { m: at(M(sx * 1.55, -0.3, sz * 1.55)), color: '#5d4130' });
  b.add('wood', box(3.2, H, 3.2), { m: at(M(0, 0, 0)), color: '#8a6440', uvScale: 0.8 });
  b.add('wood', box(3.9, 0.22, 3.9), { m: at(M(0, H, 0)), color: '#6b4a33' });
  for (const sg of [-1, 1]) {
    b.add('wood', box(3.9, 0.12, 0.12), { m: at(M(0, H + 1.0, sg * 1.9)), color: '#6b4a33' });
    b.add('wood', box(0.12, 0.12, 3.9), { m: at(M(sg * 1.9, H + 1.0, 0)), color: '#6b4a33' });
    b.add('wood', beam(new V3(-1.55, 0.3, sg * 1.62), new V3(1.55, H - 0.3, sg * 1.62), 0.12, 0.12), { m: F, color: '#5d4130' });
  }
  b.add('roof', new THREE.ConeGeometry(3.0, 1.7, 4), { m: at(M(0, H + 3.4, 0, 0, Math.PI / 4)), color: '#7a4a2e', uv: 'local', uvScale: 0.6 });
  b.add('cloth', new THREE.PlaneGeometry(1.0, 1.6), { m: at(M(0, H + 4.9, 0, 0, 0.6, 0)), color: '#a8463a', extraFn: (xx) => (xx + 0.5) * 0.6 });
  b.add('wood', cyl(0.04, 0.04, 1.4, 4), { m: at(M(0, H + 4.1, 0)), color: '#5d4130' });
  S.solids.addBox(tx, tz, 1.75, 1.75, 0, ty + H + 0.22);
  c.tower = new V3(tx, ty + H + 0.22, tz);

  // tents around the fire
  for (let k = 0; k < 3; k++) {
    const a = 2.2 + k * 1.1 + rand() * 0.3;
    const x = c.x + Math.cos(a) * 6.5,
      z = c.z + Math.sin(a) * 6.5;
    const gy = T.heightAt(x, z) - 0.05;
    b.add('cloth', new THREE.ConeGeometry(1.9, 2.6, 7, 1, true), { m: M(x, gy + 1.3, z, 0, rand() * 3), color: k === 1 ? '#a88454' : '#9a7448', extraFn: (xx, yy) => (1.3 - yy) * 0.08 });
    for (let p = 0; p < 4; p++) {
      const pa = (p / 4) * TAU + 0.3;
      b.add('wood', between(new V3(x + Math.cos(pa) * 0.15, gy + 2.2, z + Math.sin(pa) * 0.15), new V3(x - Math.cos(pa) * 0.35, gy + 3.1, z - Math.sin(pa) * 0.35), 0.04, 0.03, 5), { color: '#5d4130' });
    }
    S.solids.addCircle(x, z, 1.5, gy + 1.2);
  }
  // campfire
  for (let k = 0; k < 9; k++) {
    const a = (k / 9) * TAU;
    b.add('stone', new THREE.IcosahedronGeometry(0.28, 0), { m: M(c.x + Math.cos(a) * 0.9, y + 0.05, c.z + Math.sin(a) * 0.9, rand(), rand(), 0, 1, 0.7, 1), color: '#8f877a' });
  }
  for (let k = 0; k < 4; k++) b.add('wood', between(new V3(c.x + Math.cos(k * 1.6) * 0.6, y + 0.05, c.z + Math.sin(k * 1.6) * 0.6), new V3(c.x, y + 0.55, c.z), 0.08, 0.06, 6), { color: '#4a3020' });
  b.add('lamp', new THREE.ConeGeometry(0.42, 1.0, 7), { m: M(c.x, y + 0.6, c.z), color: '#ffb05a', extra: 1 });
  c.fire = new V3(c.x, y + 0.9, c.z);
  // palisade of sharpened logs, open towards the road
  const open = Math.atan2(-1, -0.4);
  for (let k = 0; k < 30; k++) {
    const a = (k / 30) * TAU;
    let da = Math.abs(((a - open + Math.PI) % TAU + TAU) % TAU - Math.PI);
    if (da < 0.45) continue;
    const r = 12 + Math.sin(k * 1.7) * 0.4;
    const x = c.x + Math.cos(a) * r,
      z = c.z + Math.sin(a) * r;
    const gy = T.heightAt(x, z);
    const h = 2.0 + rand() * 0.5;
    const lean = 0.18;
    b.add('wood', cyl(0.17, 0.2, h, 7), { m: M(x, gy - 0.3, z, Math.sin(a) * lean, 0, -Math.cos(a) * lean), color: '#7a5636' });
    b.add('wood', new THREE.ConeGeometry(0.17, 0.45, 7), { m: M(x + Math.cos(a) * lean * h, gy - 0.3 + h + 0.2, z + Math.sin(a) * lean * h, Math.sin(a) * lean, 0, -Math.cos(a) * lean), color: '#c7a27a' });
    S.solids.addCircle(x, z, 0.3, gy + h - 0.4);
  }
  // supply clutter
  for (let k = 0; k < 6; k++) {
    const a = rand() * TAU,
      d = 3 + rand() * 6;
    const x = c.x + Math.cos(a) * d,
      z = c.z + Math.sin(a) * d;
    if (S.solids.near(x, z, 0.8)) continue;
    const gy = T.heightAt(x, z);
    const sz = 0.55 + rand() * 0.35;
    b.add('wood', box(sz, sz, sz), { m: M(x, gy - 0.02, z, 0, rand() * 3), color: '#9a7048' });
    S.solids.addCircle(x, z, sz * 0.5, gy + sz);
  }
  b.build(S.mats, S.group);
}

// gentle bobbing for everything afloat
export function updateBoats(S, t) {
  if (!S.port) return;
  const B = S.beacon;
  if (B) {
    const dt = Math.min(0.1, t - (B.lastT ?? t));
    B.lastT = t;
    B.k += Math.sign(B.target - B.k) * Math.min(Math.abs(B.target - B.k), dt * 0.8);
    B.glow.material.opacity = B.k;
    B.beamMat.uniforms.uK.value = B.k;
    B.spin.rotation.y = t * 0.7;
    B.grp.visible = B.k > 0.001;
  }
  for (const bt of S.port.boats) {
    const g = bt.grp;
    g.position.y = Math.sin(t * 0.9 + bt.ph) * bt.amp - (bt.ship ? 0.4 : 0.15);
    g.rotation.z = Math.sin(t * 0.7 + bt.ph * 2) * bt.amp * 0.6;
    g.rotation.x = Math.sin(t * 0.55 + bt.ph) * bt.amp * 0.35;
  }
}
