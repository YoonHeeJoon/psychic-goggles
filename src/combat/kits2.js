import * as THREE from 'three';
import { toonMaterial } from '../render/materials.js';

// Kits for the companions met on the road:
//   설하 (ice, bow)       E 서리꽃 덫 — hop back, leave a frost lotus that pulses
//                          and bursts; Q 눈보라 결계 — icicles rain on an area
//   카룬 (earth, claymore) E 바위 기둥 — slam up a stone pillar (stand on it) that
//                          pulses, plus a shield; Q 대지 붕괴 — rock spikes erupt,
//                          strong shield for the party

const TAU = Math.PI * 2;
const _a = new THREE.Vector3();
const _b = new THREE.Vector3();

function front(C, d) {
  const P = C.player;
  return new THREE.Vector3(P.pos.x + Math.sin(P.yaw) * d, P.pos.y, P.pos.z + Math.cos(P.yaw) * d);
}

// ground (or ice / water surface) height under a point
function floorAt(C, x, z) {
  return Math.max(C.g.ground.heightAt(x, z), 0.05);
}

// ------------------------------------------------------------------ meshes
let lotusParts = null;
function lotusMesh() {
  if (!lotusParts) {
    const petal = new THREE.SphereGeometry(0.5, 10, 6, 0, TAU, 0, Math.PI / 2);
    petal.scale(0.42, 1.0, 1.0);
    petal.translate(0, 0, 0.42);
    lotusParts = {
      petal,
      core: new THREE.OctahedronGeometry(0.28, 0),
      mat: toonMaterial({ color: '#eaf8ff', color2: '#7fc4ee', rim: 0.7, spec: 0.8 }),
      glow: new THREE.MeshBasicMaterial({ color: new THREE.Color('#bff0ff').multiplyScalar(2.2) }),
    };
  }
  const L = lotusParts;
  const g = new THREE.Group();
  for (let ring = 0; ring < 2; ring++) {
    for (let k = 0; k < 6; k++) {
      const p = new THREE.Mesh(L.petal, L.mat);
      p.rotation.order = 'YXZ';
      p.rotation.y = (k / 6) * TAU + ring * 0.52;
      p.rotation.x = ring ? -0.45 : -0.95;
      p.scale.setScalar(ring ? 0.7 : 1);
      p.position.y = ring * 0.08;
      g.add(p);
    }
  }
  const core = new THREE.Mesh(L.core, L.glow);
  core.position.y = 0.35;
  g.add(core);
  g.userData.core = core;
  return g;
}

let pillarParts = null;
function pillarMesh() {
  if (!pillarParts) {
    const geo = new THREE.CylinderGeometry(0.78, 0.95, 3.4, 6, 4);
    const p = geo.attributes.position;
    for (let i = 0; i < p.count; i++) {
      const y = p.getY(i);
      const k = 1 + Math.sin(y * 3.1 + p.getX(i) * 2.0) * 0.05;
      p.setX(i, p.getX(i) * k);
      p.setZ(i, p.getZ(i) * k);
    }
    geo.translate(0, 1.7, 0);
    geo.computeVertexNormals();
    const cap = new THREE.CylinderGeometry(0.62, 0.8, 0.3, 6);
    cap.translate(0, 3.55, 0);
    pillarParts = {
      geo,
      cap,
      mat: toonMaterial({ color: '#b8a17a', color2: '#7a6448', rim: 0.25, shadowTint: '#8a7a98' }),
      rune: new THREE.MeshBasicMaterial({ color: new THREE.Color('#ffd27a').multiplyScalar(2), transparent: true, opacity: 0.9 }),
    };
  }
  const P = pillarParts;
  const g = new THREE.Group();
  const body = new THREE.Mesh(P.geo, P.mat);
  body.castShadow = body.receiveShadow = true;
  const cap = new THREE.Mesh(P.cap, P.mat);
  cap.castShadow = cap.receiveShadow = true;
  g.add(body, cap);
  for (const y of [1.1, 2.4]) {
    const r = new THREE.Mesh(new THREE.TorusGeometry(0.86 - y * 0.03, 0.03, 4, 6), P.rune);
    r.rotation.x = Math.PI / 2;
    r.position.y = y;
    g.add(r);
  }
  return g;
}

let _icG = null,
  _icM = null;
const icicleGeo = () => {
  if (!_icG) {
    _icG = new THREE.ConeGeometry(0.16, 1.3, 5);
    _icG.rotateX(Math.PI);
  }
  return _icG;
};
const icicleMat = () => _icM || (_icM = new THREE.MeshBasicMaterial({ color: new THREE.Color('#d8f6ff').multiplyScalar(1.6) }));

// a wall of wind-driven snow around the blizzard
const STORM_VERT = `varying vec2 vUv; varying float vY; void main(){ vUv = uv; vY = position.y; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }`;
const STORM_FRAG = `uniform float uTime; uniform float uK; varying vec2 vUv;
float h(vec2 p){ return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
float n(vec2 p){ vec2 i = floor(p), f = fract(p); f = f * f * (3.0 - 2.0 * f); return mix(mix(h(i), h(i + vec2(1, 0)), f.x), mix(h(i + vec2(0, 1)), h(i + vec2(1, 1)), f.x), f.y); }
void main(){
  vec2 q = vec2(vUv.x * 24.0 - uTime * 1.6, vUv.y * 3.0 + vUv.x * 6.0 - uTime * 0.7);
  float s = n(q) * 0.6 + n(q * 2.3 + 4.0) * 0.4;
  float streak = smoothstep(0.55, 0.85, s);
  float fade = smoothstep(0.0, 0.25, vUv.y) * smoothstep(1.0, 0.55, vUv.y);
  float a = (streak * 0.95 + 0.14) * fade * uK;
  gl_FragColor = vec4(vec3(0.85, 0.95, 1.0) * a * 1.9, a);
}`;
function stormMesh(R) {
  const mat = new THREE.ShaderMaterial({
    vertexShader: STORM_VERT,
    fragmentShader: STORM_FRAG,
    uniforms: { uTime: { value: 0 }, uK: { value: 0 } },
    transparent: true,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
    side: THREE.DoubleSide,
  });
  const m = new THREE.Mesh(new THREE.CylinderGeometry(R, R * 0.92, 8, 48, 1, true), mat);
  m.renderOrder = 6;
  return m;
}

// ------------------------------------------------------------------ kits
export const NEW_KITS = {
  seolha: {
    skill: {
      cd: 10,
      def: () => ({
        pose: 'castL',
        dur: 0.55,
        w: 0.06,
        s: 0.24,
        events: [
          {
            t: 0.02,
            fn: (C) => {
              const P = C.player;
              C.iframe = Math.max(C.iframe, 0.4);
              const pos = P.pos.clone();
              pos.y = floorAt(C, pos.x, pos.z);
              P.forced = { x: -Math.sin(P.yaw) * 12, z: -Math.cos(P.yaw) * 12, t: 0.2 };
              const g = lotusMesh();
              g.position.copy(pos);
              g.scale.setScalar(0.01);
              C.scene.add(g);
              C.vfx.ring(pos, '#bff0ff', 4.2, 0.5, { inner: 0.85 });
              C.vfx.burst(_a.copy(pos).setY(pos.y + 0.5), '#e8fbff', 36, { speed: 6, size: 0.24, life: 0.6, up: 0.8 });
              C.aoe(pos.x, pos.z, 4, { mult: 1.6, el: 'ice', knock: 3, particles: 3, kind: 'skill' });
              if (C.g.frost) C.g.frost.freezeArea(pos.x, pos.z, 5, 8);
              let t = 0,
                tick = 1.2;
              C.fields.push({
                update: (dt) => {
                  t += dt;
                  g.scale.setScalar(Math.min(1, t * 5) * (t > 6.2 ? Math.max(0.01, 1 - (t - 6.2) * 5) : 1));
                  g.rotation.y += dt * 0.8;
                  g.userData.core.position.y = 0.35 + Math.sin(t * 3) * 0.06;
                  if (Math.random() < dt * 14) {
                    const a = Math.random() * TAU,
                      r = 0.3 + Math.random() * 1.2;
                    _a.set(pos.x + Math.cos(a) * r, pos.y + 0.2, pos.z + Math.sin(a) * r);
                    C.vfx.particles.spawn(_a, _b.set(0, 1.2, 0), C.vfx.color.set('#dff6ff'), 0.12, 0.8, { drag: 1 });
                  }
                  tick -= dt;
                  if (tick <= 0 && t < 6) {
                    tick = 1.5;
                    C.vfx.ring(pos, '#9fe8ff', 4, 0.4, { inner: 0.9 });
                    for (const e of C.enemies.near(pos.x, pos.z, 4)) C.damage(e, { mult: 0.55, el: 'ice', quiet: true, noCrit: true, kind: 'skill' });
                  }
                  if (t >= 6.4) {
                    // the lotus bursts into a bloom of frost
                    C.scene.remove(g);
                    C.vfx.explosion(_a.copy(pos).setY(pos.y + 0.6), '#bff0ff', 4.2, 0.5);
                    C.vfx.burst(_a, '#ffffff', 40, { speed: 8, size: 0.24, life: 0.7, up: 0.7, gravity: 5 });
                    C.aoe(pos.x, pos.z, 4.5, { mult: 1.8, el: 'ice', knock: 4, kind: 'skill' });
                    C.g.sfx.reaction('freeze');
                    return false;
                  }
                  return true;
                },
              });
            },
          },
        ],
      }),
    },
    burst: {
      cd: 15,
      name: '눈보라 결계',
      def: () => ({
        pose: 'castUp',
        dur: 0.9,
        w: 0.15,
        s: 0.42,
        events: [
          {
            t: 0.4,
            fn: (C) => {
              const P = C.player;
              const p = P.pos.clone();
              p.y = floorAt(C, p.x, p.z);
              const R = 8;
              C.vfx.ring(p, '#9fe8ff', R, 10, { static: true, inner: 0.94, opacity: 0.8 });
              C.vfx.explosion(_a.copy(p).setY(p.y + 1.2), '#bff0ff', 3.6, 0.5);
              C.g.flashScreen('#dff6ff', 0.18);
              if (C.g.frost) C.g.frost.freezeArea(p.x, p.z, R, 10);
              let t = 0,
                shard = 0,
                tick = 0;
              const icicles = [];
              const storm = stormMesh(R);
              storm.position.set(p.x, p.y + 3.8, p.z);
              C.scene.add(storm);
              C.fields.push({
                update: (dt) => {
                  t += dt;
                  // snow swirling in the circle, thickest at the rim
                  for (let i = 0; i < 16; i++) {
                    const a = Math.random() * TAU,
                      r = i < 8 ? R * (0.85 + Math.random() * 0.2) : Math.sqrt(Math.random()) * R;
                    _a.set(p.x + Math.cos(a) * r, p.y + 0.3 + Math.random() * (i < 8 ? 7 : 4), p.z + Math.sin(a) * r);
                    C.vfx.particles.spawn(_a, _b.set(-Math.sin(a) * 7, -1, Math.cos(a) * 7), C.vfx.color.set('#f2fbff'), i < 8 ? 0.16 : 0.1, 0.9, { drag: 0.3 });
                  }
                  // a cold cloud overhead
                  if (Math.random() < 0.5) {
                    const a = Math.random() * TAU,
                      r = Math.sqrt(Math.random()) * R * 0.8;
                    _a.set(p.x + Math.cos(a) * r, p.y + 8.5 + Math.random(), p.z + Math.sin(a) * r);
                    C.vfx.particles.spawn(_a, _b.set(0, 0, 0), C.vfx.color.set('#cfe8ff'), 1.4, 1.2, { drag: 1, intensity: 0.5 });
                  }
                  // icicles fall from above
                  shard -= dt;
                  if (shard <= 0) {
                    shard = 0.14;
                    const list = C.enemies.near(p.x, p.z, R);
                    const e = list.length && Math.random() < 0.6 ? list[Math.floor(Math.random() * list.length)] : null;
                    let x, z;
                    if (e) (x = e.pos.x + (Math.random() - 0.5)), (z = e.pos.z + (Math.random() - 0.5));
                    else {
                      const a = Math.random() * TAU,
                        r = Math.sqrt(Math.random()) * R;
                      (x = p.x + Math.cos(a) * r), (z = p.z + Math.sin(a) * r);
                    }
                    const gy = floorAt(C, x, z);
                    const m = new THREE.Mesh(icicleGeo(), icicleMat());
                    m.position.set(x, gy + 10, z);
                    C.scene.add(m);
                    icicles.push({ m, gy });
                  }
                  for (let i = icicles.length - 1; i >= 0; i--) {
                    const ic = icicles[i];
                    ic.m.position.y -= 34 * dt;
                    if (ic.m.position.y <= ic.gy + 0.4) {
                      C.vfx.burst(_a.set(ic.m.position.x, ic.gy + 0.2, ic.m.position.z), '#ffffff', 7, { speed: 3.2, size: 0.15, life: 0.35, up: 0.7, gravity: 8 });
                      C.scene.remove(ic.m);
                      icicles.splice(i, 1);
                    }
                  }
                  tick -= dt;
                  if (tick <= 0) {
                    tick = 0.7;
                    for (const e of C.enemies.near(p.x, p.z, R)) C.damage(e, { mult: 0.62, el: 'ice', quiet: true, kind: 'burst' });
                  }
                  storm.material.uniforms.uTime.value = t;
                  storm.material.uniforms.uK.value = Math.min(1, t * 2) * Math.min(1, (10 - t) * 1.5);
                  storm.rotation.y -= dt * 0.6;
                  if (t >= 10) {
                    for (const ic of icicles) C.scene.remove(ic.m);
                    icicles.length = 0;
                    C.scene.remove(storm);
                    storm.geometry.dispose();
                    storm.material.dispose();
                  }
                  return t < 10;
                },
              });
            },
          },
        ],
      }),
    },
  },
  karun: {
    skill: {
      cd: 12,
      def: () => ({
        pose: 'heavyOverhead',
        dur: 0.85,
        w: 0.32,
        s: 0.46,
        events: [
          {
            t: 0.44,
            fn: (C) => {
              const P = C.player;
              const p = front(C, 2.6);
              p.y = C.g.terrain.heightAt(p.x, p.z);
              // one pillar at a time: the old one crumbles
              if (C.pillar) C.pillar.end();
              C.vfx.ring(_a.copy(p), '#f0b84a', 3.6, 0.45, { inner: 0.82 });
              C.vfx.burst(_a.copy(p).setY(p.y + 0.4), '#c9b89a', 30, { speed: 7, size: 0.3, life: 0.7, up: 1.2, gravity: 12 });
              C.aoe(p.x, p.z, 3.6, { mult: 2.3, el: 'earth', knock: 5, heavy: true, particles: 3, kind: 'skill' });
              C.g.cameraCtl.shake(0.35, 0.3);
              C.g.sfx.land(8, 'stone');
              const c = C.player.current;
              C.shields.give(c.maxHp * 0.13 * (c.skillMul || 1), 'earth', 12);
              const g = pillarMesh();
              g.position.set(p.x, p.y - 3.6, p.z);
              g.rotation.y = P.yaw;
              C.scene.add(g);
              const solid = C.g.structures.solids.addCircle(p.x, p.z, 0.85, p.y - 3);
              let t = 0,
                tick = 2,
                done = false;
              const pillar = {
                end: () => (done = true),
              };
              C.pillar = pillar;
              C.fields.push({
                update: (dt) => {
                  t += dt;
                  const rise = Math.min(1, t / 0.25);
                  const sink = done ? Math.min(1, (pillar.sinkT = (pillar.sinkT || 0) + dt) / 0.4) : 0;
                  const top = p.y - 3.6 + 3.7 * (rise * (2 - rise)) * (1 - sink);
                  g.position.y = top;
                  solid.top = top + 3.68;
                  tick -= dt;
                  if (tick <= 0 && !done) {
                    tick = 2;
                    C.vfx.ring(_a.copy(p), '#f0b84a', 3.2, 0.4, { inner: 0.88 });
                    for (const e of C.enemies.near(p.x, p.z, 3.2)) C.damage(e, { mult: 0.75, el: 'earth', quiet: true, noCrit: true, kind: 'skill' });
                  }
                  if (t > 16) done = true;
                  if (done && sink >= 1) {
                    C.scene.remove(g);
                    C.g.structures.solids.remove(solid);
                    C.vfx.burst(_a.copy(p).setY(p.y + 0.4), '#c9b89a', 20, { speed: 4, size: 0.3, life: 0.6, up: 1, gravity: 10 });
                    if (C.pillar === pillar) C.pillar = null;
                    return false;
                  }
                  return true;
                },
              });
            },
          },
        ],
      }),
    },
    burst: {
      cd: 16,
      name: '대지 붕괴',
      def: () => ({
        pose: 'heavyOverhead',
        dur: 1.3,
        w: 0.6,
        s: 0.82,
        events: [
          {
            t: 0.06,
            fn: (C) => {
              const P = C.player;
              C.vfx.burst(new THREE.Vector3(P.pos.x, P.pos.y + 1, P.pos.z), '#ffd27a', 40, { speed: 5, size: 0.28, life: 0.8, gravity: -3 });
            },
          },
          {
            t: 0.8,
            fn: (C) => {
              const P = C.player;
              const p = front(C, 1.8);
              p.y = C.g.terrain.heightAt(p.x, p.z);
              C.vfx.explosion(_a.copy(p).setY(p.y + 0.5), '#f0b84a', 7, 0.7);
              C.vfx.ring(_a.copy(p), '#ffd27a', 8, 0.6, { inner: 0.75 });
              C.aoe(p.x, p.z, 7.5, { mult: 5.6, el: 'earth', knock: 8, heavy: true, stop: 0.12, kind: 'burst' });
              C.g.cameraCtl.shake(0.7, 0.55);
              C.g.flashScreen('#ffe6a0', 0.2);
              const c = C.player.current;
              C.shields.give(c.maxHp * 0.3 * (c.burstMul || 1), 'earth', 20);
              // rings of rock spikes burst out of the ground
              const spikes = [];
              const mat = pillarParts ? pillarParts.mat : toonMaterial({ color: '#b8a17a', color2: '#7a6448', rim: 0.25 });
              for (let ring = 0; ring < 3; ring++) {
                const n = 8 + ring * 5;
                for (let k = 0; k < n; k++) {
                  const a = (k / n) * TAU + ring * 0.3;
                  const r = 2.4 + ring * 2.1;
                  const x = p.x + Math.cos(a) * r,
                    z = p.z + Math.sin(a) * r;
                  const m = new THREE.Mesh(new THREE.ConeGeometry(0.35 + Math.random() * 0.2, 1.4 + Math.random() * 1.2, 5), mat);
                  m.position.set(x, C.g.terrain.heightAt(x, z) - 1.6, z);
                  m.rotation.set(Math.sin(a) * 0.35, Math.random(), -Math.cos(a) * 0.35);
                  m.castShadow = true;
                  C.scene.add(m);
                  spikes.push({ m, delay: ring * 0.12 + Math.random() * 0.05, base: m.position.y });
                }
              }
              let t = 0;
              C.fields.push({
                update: (dt) => {
                  t += dt;
                  for (const s of spikes) {
                    const k = Math.max(0, t - s.delay);
                    const up = Math.min(1, k / 0.12);
                    const down = Math.max(0, (t - 1.6 - s.delay) / 0.5);
                    s.m.position.y = s.base + 1.6 * up * (1 - Math.min(1, down));
                    if (k > 0 && k - dt <= 0) C.vfx.burst(_a.copy(s.m.position).setY(s.base + 1.6), '#c9b89a', 3, { speed: 3, size: 0.2, life: 0.4, up: 1, gravity: 10 });
                  }
                  if (t > 2.3) {
                    for (const s of spikes) {
                      C.scene.remove(s.m);
                      s.m.geometry.dispose();
                    }
                    return false;
                  }
                  return true;
                },
              });
            },
          },
        ],
        tick: (C, a) => {
          a.lift = a.t < 0.75 ? Math.sin((a.t / 0.75) * Math.PI) * 1.1 : -0.1;
        },
      }),
    },
  },
};
